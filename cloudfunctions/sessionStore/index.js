const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * sessionStore — 会话持久化 + 滚动摘要 + 用量记录 + 投票记录（W2-W5 完整实现）
 *
 * 接口：
 *   action: "create" | "get" | "append" | "trackUsage" | "trackVote"
 *   create:     { mode: "L1"|"L2"|"L3", topic? } → { sessionId }
 *   get:        { sessionId } → { session: { recent, summary, round, status } }
 *   append:     { sessionId, role: "user"|"assistant"|"affirmative"|"negative"|"judge", content, round }
 *               → 追加消息；recent 满 8 轮（16 条）裁剪最旧轮次并入滚动摘要；
 *                 transcript 同步追加同一条消息（只增不裁，供报告生成引用原话）
 *   trackUsage: { mode, model, prompt_tokens, completion_tokens }
 *   trackVote:  { sessionId, round, side: "affirmative"|"negative" }  → L3 用户围观投票
 *
 * transcript（W3 新增）：
 * - 与 recent 同源的消息数组，但永不裁剪、不压缩，保存全量原文（≤16KB/会话）
 * - get 默认不返回，需显式传 withTranscript: true（避免普通对话读取带全量记录）
 *
 * 配额统计契约（必须遵守，配合 getQuota）：
 * - 会话文档创建时显式写入 openid（cloud.getWXContext().OPENID）与 createdAt: db.serverDate()
 *   （_openid 系统字段在云函数写入时不会自动注入，禁止依赖）
 * - mode 字段为 L1/L2/L3
 *
 * 滚动摘要：
 * - recent 存原文但硬裁剪；第 9 轮起裁剪发生时触发一次 hy3 摘要调用（≤300 字）
 * - 裁剪与摘要先读后写串行执行（非数据库事务；fail-safe：摘要失败不阻断对话，
 *   失败后 summary 保持原值，后续裁剪会再次触发补齐）
 *
 * 安全（W7 + 2026-08-16 合规整改）：
 * - get/append/trackVote 均校验 openid 归属（IDOR 防护，他人 sessionId 一律拒绝）
 * - create 在 mode=L3 时强制调用 topics 云函数 validate，服务端兜底白名单
 *   （前端白名单校验可被绕过：攻击者可直接调 sessionStore.create 传任意敏感议题）
 *   topics.validate 故障时保守拒绝，避免非白名单话题流过
 */

const MAX_RECENT_MESSAGES = 16; // 8 轮 × 2 条（user + assistant）
const SUMMARY_MODEL = "hy3";
const SUMMARY_MAX_CHARS = 300;
const CONTENT_MAX_CHARS = 2000; // 单条消息硬截断（防文档膨胀/拖慢读取/耗数据库点池）
const TRANSCRIPT_ALERT_CHARS = 8000; // transcript 总长报警阈值（超限打日志，便于运维介入）
const APPEND_MAX_RETRIES = 3; // 乐观锁冲突重试上限

// 服务端配额强校验开关：测试期关闭（保持临时放开）；上线前置 true 启用。
const ENFORCE_QUOTA = false;

// 测试期配额全放开：强制按 beta 档（999）计算，与 getQuota / userProfile 的
// 同名开关保持同步；⚠️ 上线前三处一并改回 false 还原正式配额
const QUOTA_BYPASS = true;

// 段位分档（与 userProfile / getQuota 保持一致）
const TIERS = {
  new:      { daily: { L1: 3,  L2: 2,  L3: 1 },  maxRounds: 10 },
  bronze:   { daily: { L1: 5,  L2: 3,  L3: 2 },  maxRounds: 12 },
  silver:   { daily: { L1: 8,  L2: 5,  L3: 3 },  maxRounds: 15 },
  gold:     { daily: { L1: 12, L2: 8,  L3: 5 },  maxRounds: 20 },
  platinum: { daily: { L1: 20, L2: 12, L3: 8 },  maxRounds: 30 },
  diamond:  { daily: { L1: 30, L2: 20, L3: 12 }, maxRounds: 40 },
  king:     { daily: { L1: 50, L2: 30, L3: 20 }, maxRounds: 60 },
  beta:     { daily: { L1: 999, L2: 999, L3: 999 }, maxRounds: 999 },
};

function bjTodayRange() {
  const OFFSET = 8 * 3600 * 1000;
  const bjDayStartUtc = Math.floor((Date.now() + OFFSET) / 86400000) * 86400000 - OFFSET;
  return { today: new Date(bjDayStartUtc), tomorrow: new Date(bjDayStartUtc + 86400000) };
}

async function getUserClassify(OPENID) {
  try {
    const u = await db.collection("users").doc(OPENID || "").get();
    return (u.data && u.data.classify) || "new";
  } catch (e) {
    return "new";
  }
}

// 创建会话前强校验：按 openid+日 统计场次与总轮次，超限拒绝。ENFORCE_QUOTA=false 时放行。
async function enforceQuotaBeforeCreate(OPENID, mode) {
  if (!ENFORCE_QUOTA) return { ok: true };
  const classify = await getUserClassify(OPENID);
  const tier = QUOTA_BYPASS ? TIERS.beta : (TIERS[classify] || TIERS.new);
  const limit = tier.daily[mode] || 3;
  const maxRounds = tier.maxRounds;
  const { today, tomorrow } = bjTodayRange();

  const sessRes = await db
    .collection("sessions")
    .where({ openid: OPENID || "", mode, createdAt: _.gte(today).and(_.lt(tomorrow)) })
    .count();
  const used = sessRes.total || 0;
  if (used >= limit) {
    return { ok: false, reason: "daily", used, limit, msg: "今日该模式次数已用完" };
  }

  let totalRounds = 0;
  try {
    const agg = await db
      .collection("sessions")
      .where({ openid: OPENID || "", createdAt: _.gte(today).and(_.lt(tomorrow)) })
      .aggregate()
      .group({ _id: null, totalRounds: db.command.aggregate.sum("$round") })
      .end();
    if (agg.list && agg.list[0]) totalRounds = agg.list[0].totalRounds || 0;
  } catch (e) {
    console.error("[sessionStore] round aggregate failed:", e);
  }
  if (totalRounds >= maxRounds) {
    return { ok: false, reason: "rounds", used: totalRounds, limit: maxRounds, msg: "今日总轮次已达上限" };
  }
  return { ok: true };
}

/**
 * P1 修复（服务端白名单兜底）：mode=L3 时强制校验 topic 必须在白名单
 * 前端 topics 云函数的 validate 可被绕过（攻击者直接调 sessionStore.create），
 * 所以服务端必须再做一次校验。topics.validate 故障时保守拒绝。
 */
async function enforceTopicWhitelist(mode, topic) {
  if (mode !== "L3") return { ok: true };
  const title = String(topic || "").trim();
  if (!title) {
    return { ok: false, msg: "L3 会话必须传入辩题" };
  }
  if (title.length > 80) {
    return { ok: false, msg: "辩题过长（≤80 字）" };
  }
  try {
    const v = await cloud.callFunction({
      name: "topics",
      data: { action: "validate", title },
    });
    const vData = (v.result && v.result.data) || {};
    if (vData.valid) return { ok: true };
    return { ok: false, msg: vData.msg || "话题不在白名单，请从辩题库选择" };
  } catch (e) {
    console.error("[sessionStore] topics.validate failed:", e);
    return { ok: false, msg: "辩题校验服务暂时不可用，请稍后重试" };
  }
}

async function trackUsage(mode, model, usage) {
  try {
    const u = usage || {};
    await db.collection("token_usage").add({
      data: {
        openid: cloud.getWXContext().OPENID || "",
        mode,
        model,
        prompt_tokens: u.prompt_tokens || 0,
        completion_tokens: u.completion_tokens || 0,
        total_tokens: (u.prompt_tokens || 0) + (u.completion_tokens || 0),
        createdAt: db.serverDate(),
      },
    });
  } catch (e) {
    console.error("[sessionStore] trackUsage failed:", e);
  }
}

/** 滚动摘要：把被裁剪的最旧轮次并入 summary（hy3 一次调用，≤300 字） */
async function summarize(sessionId, evictedMessages, oldSummary) {
  const ai = cloud.ai();
  const model = ai.createModel("cloudbase");
  const evictedText = evictedMessages
    .map((m) => `${m.role === "user" ? "用户" : "苏格拉底"}：${m.content}`)
    .join("\n");

  const res = await model.generateText({
    model: SUMMARY_MODEL,
    messages: [
      {
        role: "system",
        content: `你是会话摘要助手。把对话压缩为不超过 ${SUMMARY_MAX_CHARS} 字的中文摘要，保留关键观点、追问要点与用户原话的要点。只输出摘要正文。`,
      },
      {
        role: "user",
        content: `已有摘要：${oldSummary || "（无）"}\n新增对话：\n${evictedText}`,
      },
    ],
  });

  let newSummary = ((res && res.text) || "").trim();
  if (newSummary.length > 600) {
    newSummary = newSummary.slice(0, 600); // 防御性截断
  }
  await trackUsage("summary", SUMMARY_MODEL, res.usage);
  return newSummary || oldSummary;
}

async function ensureSessionDoc(event) {
  const { OPENID } = cloud.getWXContext();
  const mode = event.mode || "L1";
  // P1 修复（分享防泄露）：一次性分享令牌，分享链接只带 token 不带 sessionId。
  // token 每会话唯一且不可枚举，仅可只读查看报告（generateReport 校验），拿不到 transcript
  // P2 加固（上线审计 2026-08-24）：Math.random 非密码学安全，升级 crypto.randomUUID
  // （Node 14.17+/16+ 内置），128 bit 随机熵，杜绝 token 可预测/可碰撞
  const shareToken =
    event.shareToken ||
    require("crypto").randomUUID().replace(/-/g, "");
  const res = await db.collection("sessions").add({
    data: {
      openid: OPENID || "",
      mode,
      topic: event.topic || "",
      recent: [],
      transcript: [],
      summary: "",
      round: 0,
      status: "active",
      version: 0,
      shareToken,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  return res._id;
}

exports.main = async (event) => {
  const { action } = event;

  switch (action) {
    case "create": {
      try {
        const { OPENID } = cloud.getWXContext();
        const mode = event.mode || "L1";

        // P1 修复（服务端白名单兜底）：L3 辩题必须经过 topics 云函数 validate
        // 必须先于配额校验执行：避免恶意请求既绕过白名单又消耗一次配额计数
        const topicCheck = await enforceTopicWhitelist(mode, event.topic);
        if (!topicCheck.ok) {
          return { code: -1, msg: topicCheck.msg };
        }

        const q = await enforceQuotaBeforeCreate(OPENID || "", mode);
        if (!q.ok) {
          return {
            code: -2,
            msg: q.msg,
            data: { reason: q.reason, used: q.used, limit: q.limit },
          };
        }
        const sessionId = await ensureSessionDoc(event);
        // 同时返回 shareToken：分享链接只带 token 不带 sessionId（P1 防泄露策略）
        const sessionDoc = (await db.collection("sessions").doc(sessionId).get()).data || {};
        return { code: 0, data: { sessionId, shareToken: sessionDoc.shareToken || "" } };
      } catch (e) {
        console.error("[sessionStore] create failed:", e);
        return { code: -1, msg: "create failed" };
      }
    }

    case "get": {
      try {
        const { sessionId } = event;
        if (!sessionId) return { code: -1, msg: "sessionId required" };
        const { OPENID } = cloud.getWXContext();
        const res = await db.collection("sessions").doc(sessionId).get();
        const s = res.data || {};
        // P0 修复（IDOR/隐私泄露）：归属校验，他人 sessionId 一律拒绝
        if (!s || !s.openid || s.openid !== OPENID) {
          return { code: -1, msg: "session not found or not owned" };
        }
        return {
          code: 0,
          data: {
            session: {
              recent: s.recent || [],
              summary: s.summary || "",
              round: s.round || 0,
              status: s.status || "active",
              mode: s.mode || "",
              // W3: 仅报告等需要全量原文的场景显式要求时返回
              ...(event.withTranscript ? { transcript: s.transcript || [] } : {}),
            },
          },
        };
      } catch (e) {
        console.error("[sessionStore] get failed:", e);
        return { code: -1, msg: "get failed" };
      }
    }

    case "append": {
      try {
        const { sessionId, role, content, round } = event;
        if (!sessionId) return { code: -1, msg: "sessionId required" };
        // 兼容业务角色：affirmative/negative/judge 在 transcript/recent 里保留业务角色名
        // （供报告页渲染角色标签），但写入时映射为标准 role 名
        const VALID_BUSINESS_ROLES = ["user", "assistant", "affirmative", "negative", "judge"];
        if (!VALID_BUSINESS_ROLES.includes(role)) {
          return { code: -1, msg: "invalid role" };
        }
        const { OPENID } = cloud.getWXContext();

        // P1 修复：内容硬截断，防超长消息撑爆文档（转码后按字符计）
        const rawContent = String(content || "");
        const msg = {
          role,
          content: rawContent.length > CONTENT_MAX_CHARS ? rawContent.slice(0, CONTENT_MAX_CHARS) : rawContent,
          round: Math.max(1, Number(round) || 1),
        };
        // status 权威维护（上线审计修正）：原实现仅在裁剪+摘要分支写回，
        // 导致 status 形同虚设；现随每次 append 按轮次无条件推进
        const sessionStatus = msg.round >= 10 ? "finished" : "active";
        const ref = db.collection("sessions").doc(sessionId);

        // P1 修复（并发丢消息）：recent/transcript 用 _.push 原子追加，round 用 _.max
        // 原子推进，杜绝读-改-写覆盖；归属校验在读库时一并完成
        const cur = await ref.get();
        const s = cur.data || {};
        if (!s || !s.openid || s.openid !== OPENID) {
          // P0 修复（IDOR）：归属校验，他人 sessionId 一律拒绝
          return { code: -1, msg: "session not found or not owned" };
        }
        await ref.update({
          data: {
            recent: _.push([msg]),
            transcript: _.push([msg]),
            round: _.max([msg.round]),
            status: s.status === "finished" ? "finished" : sessionStatus,
            version: _.inc(1),
            updatedAt: db.serverDate(),
          },
        });

        // 版本门控裁剪：读取最新 recent，超限时弹出最旧轮次。
        // 用 where(_id + version) 条件更新防覆盖：若裁剪期间有并发追加，
        // version 已变则本次裁剪失败重试（最多 N 次，让位于并发写入）
        let evicted = [];
        let lastTranscript = [];
        for (let i = 0; i < APPEND_MAX_RETRIES; i++) {
          const cur2 = await ref.get();
          const s2 = cur2.data || {};
          lastTranscript = Array.isArray(s2.transcript) ? s2.transcript : [];
          let recent = Array.isArray(s2.recent) ? s2.recent : [];
          if (recent.length <= MAX_RECENT_MESSAGES) break;
          // 成对弹出最旧轮次：头部必须是 user+assistant 才算一对；
          // 某轮 assistant 落库失败导致头部不成对时，按 1 条弹出，避免破坏交替顺序
          let removed = [];
          while (recent.length > MAX_RECENT_MESSAGES) {
            const first = recent[0] || {};
            const second = recent[1];
            const isPair = first.role === "user" && second && second.role === "assistant";
            const n = isPair ? 2 : 1;
            removed.push(...recent.slice(0, n));
            recent = recent.slice(n);
          }
          // 兼容历史文档（无 version 字段）与新建文档：version 缺失或等于读到的版本才允许裁剪
          const gate = _.or([
            { _id: sessionId, version: s2.version || 0 },
            { _id: sessionId, version: _.exists(false) },
          ]);
          const trimRes = await db
            .collection("sessions")
            .where(gate)
            .update({ data: { recent, updatedAt: db.serverDate() } });
          if (trimRes.stats.updated === 1) {
            evicted = removed; // 覆盖而非累加：重试时以最后一次实际弹出的对为准
            break; // 裁剪成功
          }
          // version 冲突（期间有并发追加），重读重试
        }

        // P1 修复：transcript 只增不裁，但超长需报警（运维阈值，不阻断）。
        // 复用裁剪循环中最后一次读取的文档（追加后、裁剪前的完整 transcript），
        // 省一次独立读取；文档被并发删除时按空数组处理，不会 TypeError
        const totalChars = lastTranscript.reduce(
          (n, m) => n + (m.content ? m.content.length : 0),
          0
        );
        if (totalChars > TRANSCRIPT_ALERT_CHARS) {
          console.error(`[sessionStore] transcript oversized: session=${sessionId} chars=${totalChars}`);
        }

        const nextRound = Math.max(s.round || 0, msg.round, 1);

        let summary = s.summary || "";
        if (evicted.length > 0) {
          try {
            // 第 9 轮起裁剪发生时触发滚动摘要（失败不阻断，保留 summary 原值）
            summary = await summarize(sessionId, evicted, summary);
            // version 门控写回：两轮并发裁剪时只允许基于最新版本写入，
            // 防止互相覆盖对方刚生成的摘要
            let written = false;
            for (let i = 0; i < APPEND_MAX_RETRIES && !written; i++) {
              const latest = await ref.get();
              const ls = latest.data || {};
              const gate = _.or([
                { _id: sessionId, version: ls.version || 0 },
                { _id: sessionId, version: _.exists(false) },
              ]);
              const up = await db.collection("sessions").where(gate).update({
                data: {
                  summary,
                  status: nextRound >= 10 ? "finished" : "active",
                  updatedAt: db.serverDate(),
                },
              });
              written = up.stats.updated === 1;
            }
            if (!written) {
              console.error("[sessionStore] summary write conflict after retries, keep latest");
            }
          } catch (e) {
            console.error("[sessionStore] summarize failed, keep old summary:", e && e.message);
          }
        }

        return { code: 0, data: { ok: true, round: nextRound, summaryUpdated: evicted.length > 0 } };
      } catch (e) {
        console.error("[sessionStore] append failed:", e);
        return { code: -1, msg: "append failed" };
      }
    }

    case "trackUsage": {
      try {
        const { OPENID } = cloud.getWXContext();
        await db.collection("token_usage").add({
          data: {
            openid: OPENID || "",
            mode: event.mode || "unknown",
            model: event.model || "",
            prompt_tokens: event.prompt_tokens || 0,
            completion_tokens: event.completion_tokens || 0,
            total_tokens: (event.prompt_tokens || 0) + (event.completion_tokens || 0),
            createdAt: db.serverDate(),
          },
        });
        return { code: 0, data: { ok: true } };
      } catch (e) {
        console.error("[sessionStore] trackUsage failed:", e);
        return { code: -1, msg: "trackUsage failed" };
      }
    }

    case "trackVote": {
      // L3 围观投票：记录到 votes 表（用户行为数据，不影响 AI 发言）
      try {
        const { OPENID } = cloud.getWXContext();
        const { sessionId, round, side } = event;
        if (!sessionId) return { code: -1, msg: "sessionId required" };
        if (side !== "affirmative" && side !== "negative") {
          return { code: -1, msg: "side must be affirmative|negative" };
        }
        // 归属校验：只能为自己会话投票（防止刷票）
        const sessionRes = await db.collection("sessions").doc(sessionId).get();
        const s = sessionRes.data || {};
        if (!s || !s.openid || s.openid !== OPENID) {
          return { code: -1, msg: "session not found or not owned" };
        }
        if ((s.mode || "L1") !== "L3") {
          return { code: -1, msg: "vote only for L3" };
        }
        // P1 修复（上线审计 2026-08-24）：一轮一票防刷——原实现可对同一轮重复投票，
        // 刷高 votes 数量直接影响报告 voteScore 评分
        const r = Math.max(1, Number(round) || 1);
        const dup = await db
          .collection("votes")
          .where({ openid: OPENID, sessionId, round: r })
          .count();
        if ((dup.total || 0) > 0) {
          return { code: -1, msg: "already voted this round" };
        }
        await db.collection("votes").add({
          data: {
            openid: OPENID,
            sessionId,
            round: r,
            side,
            createdAt: db.serverDate(),
          },
        });
        return { code: 0, data: { ok: true } };
      } catch (e) {
        console.error("[sessionStore] trackVote failed:", e);
        return { code: -1, msg: "trackVote failed" };
      }
    }

    case "delete": {
      // P1 修复（上线审计 2026-08-24）：会话删除收敛到服务端。
      // 原前端直查直删的问题：① votes 由云函数写入、创建者不是用户，
      // 小程序端"仅创建者可读写"权限下删不掉 → 孤儿投票数据残留；
      // ② reports 同理存在删除失败风险。统一在此归属校验后级联删除
      try {
        const { sessionId } = event;
        if (!sessionId) return { code: -1, msg: "sessionId required" };
        const { OPENID } = cloud.getWXContext();
        const res = await db.collection("sessions").doc(sessionId).get();
        const s = res.data || {};
        if (!s || !s.openid || s.openid !== OPENID) {
          return { code: -1, msg: "session not found or not owned" };
        }
        // 级联删 reports / votes（逐条删，量级小；单条失败不阻断整体）
        for (const col of ["reports", "votes"]) {
          try {
            const sub = await db.collection(col).where({ sessionId }).get();
            for (const d of sub.data || []) {
              await db.collection(col).doc(d._id).remove();
            }
          } catch (e) {
            console.warn(`[sessionStore] delete cascade ${col} failed:`, e && e.message);
          }
        }
        await db.collection("sessions").doc(sessionId).remove();
        return { code: 0, data: { ok: true } };
      } catch (e) {
        console.error("[sessionStore] delete failed:", e);
        return { code: -1, msg: "delete failed" };
      }
    }

    default:
      return { code: -1, msg: `Unknown action: ${action}` };
  }
};
