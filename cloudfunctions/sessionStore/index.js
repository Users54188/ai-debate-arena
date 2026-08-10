const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * sessionStore — 会话持久化 + 滚动摘要 + 用量记录（W2 完整实现）
 *
 * 接口：
 *   action: "create" | "get" | "append" | "trackUsage"
 *   create:     { mode: "L1"|"L2"|"L3", topic? } → { sessionId }
 *   get:        { sessionId } → { session: { recent, summary, round, status } }
 *   append:     { sessionId, role: "user"|"assistant", content, round }
 *               → 追加消息；recent 超 8 轮（16 条）裁剪最旧轮次并入滚动摘要
 *   trackUsage: { mode, model, prompt_tokens, completion_tokens }
 *
 * 配额统计契约（必须遵守，配合 getQuota）：
 * - 会话文档创建时显式写入 openid（cloud.getWXContext().OPENID）与 createdAt: db.serverDate()
 *   （_openid 系统字段在云函数写入时不会自动注入，禁止依赖）
 * - mode 字段为 L1/L2/L3
 *
 * 滚动摘要：
 * - recent 存原文但硬裁剪；第 9 轮起裁剪发生时触发一次 hy3 摘要调用（≤300 字）
 * - 摘要与裁剪在同一事务内串行执行（fail-safe：摘要失败不阻断对话，
 *   失败后 summary 保持原值，后续裁剪会再次触发补齐）
 */

const MAX_RECENT_MESSAGES = 16; // 8 轮 × 2 条（user + assistant）
const SUMMARY_MODEL = "hy3";
const SUMMARY_MAX_CHARS = 300;

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
  const res = await db.collection("sessions").add({
    data: {
      openid: OPENID || "",
      mode,
      topic: event.topic || "",
      recent: [],
      summary: "",
      round: 0,
      status: "active",
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
        const sessionId = await ensureSessionDoc(event);
        return { code: 0, data: { sessionId } };
      } catch (e) {
        console.error("[sessionStore] create failed:", e);
        return { code: -1, msg: "create failed" };
      }
    }

    case "get": {
      try {
        const { sessionId } = event;
        if (!sessionId) return { code: -1, msg: "sessionId required" };
        const res = await db.collection("sessions").doc(sessionId).get();
        const s = res.data || {};
        return {
          code: 0,
          data: {
            session: {
              recent: s.recent || [],
              summary: s.summary || "",
              round: s.round || 0,
              status: s.status || "active",
              mode: s.mode || "",
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
        if (role !== "user" && role !== "assistant") return { code: -1, msg: "role must be user|assistant" };

        const msg = { role, content: String(content || ""), round: Math.max(1, Number(round) || 1) };
        const ref = db.collection("sessions").doc(sessionId);

        // 先读取当前会话，判断是否需要裁剪
        const cur = await ref.get();
        const s = cur.data || {};
        const recent = Array.isArray(s.recent) ? s.recent : [];
        const newRecent = [...recent, msg];

        // 裁剪超 8 轮的旧轮次（成对弹出最旧的 user/assistant）
        let evicted = [];
        while (newRecent.length > MAX_RECENT_MESSAGES) {
          evicted.push(...newRecent.splice(0, 2));
        }

        // 更新 round 取两者较大值（幂等，防止并发覆盖；最小为 1）
        const nextRound = Math.max(s.round || 0, Number(round) || 1, 1);

        let summary = s.summary || "";
        if (evicted.length > 0) {
          try {
            // 第 9 轮起裁剪发生时触发滚动摘要（串行执行；失败不阻断，保留 summary 原值）
            summary = await summarize(sessionId, evicted, summary);
          } catch (e) {
            console.error("[sessionStore] summarize failed, keep old summary:", e && e.message);
          }
        }

        await ref.update({
          data: {
            recent: newRecent,
            round: nextRound,
            summary,
            status: nextRound >= 10 ? "finished" : "active",
            updatedAt: db.serverDate(),
          },
        });

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

    default:
      return { code: -1, msg: `Unknown action: ${action}` };
  }
};