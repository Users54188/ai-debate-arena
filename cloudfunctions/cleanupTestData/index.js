/**
 * cleanupTestData — 调试工具：清理测试期数据污染
 *
 * 场景：开发期 dailyQuota=999 / ENFORCE_QUOTA=false 时堆积了大量测试 sessions，
 *       导致配额恢复后正常调试时按钮被禁用。本云函数用于一键清理。
 *
 * ⚠️ 危险操作：本云函数会删除真实数据，仅供开发者本人调试使用！
 *    - 不要在生产环境部署
 *    - 不要配置定时触发器
 *    - 调用前先 dryRun 预览
 *
 * 接口：
 *   {} 或 { dryRun: true }
 *     → 默认预览模式：只统计不删除，返回各集合的待删记录数
 *
 *   { dryRun: false, confirm: "DELETE_MY_TEST_DATA" }
 *     → 实删模式：必须传 confirm 字段防止误调用
 *
 *   { dryRun: false, confirm: "DELETE_MY_TEST_DATA", days: 7 }
 *     → 只清理最近 7 天的数据（默认 30 天，与 cleanupData 对齐）
 *
 *   { dryRun: false, confirm: "DELETE_MY_TEST_DATA", openid: "xxx" }
 *     → 只清理某个用户的数据（不传则清所有用户）
 *
 *   { dryRun: false, confirm: "DELETE_MY_TEST_DATA", collections: ["sessions"] }
 *     → 只清理指定集合（默认全清：sessions/reports/votes/token_usage/eval_runs）
 *
 * 清理范围（默认）：
 *   - sessions：会话记录（核心污染源，配额按此计数）
 *   - reports：报告记录（与 sessions 级联）
 *   - votes：投票记录（与 sessions 级联）
 *   - token_usage：Token 用量记录（调试期堆积，影响运营统计）
 *   - eval_runs：评测运行记录（可选清理）
 *
 * 不清理：
 *   - users：保留段位档案（清理后下次进入会自动 ensureUser 重建）
 *   - topics_v1：白名单数据（运营资产）
 *
 * 部署后调用：
 *   方式1（开发者工具）：右键 cleanupTestData 文件夹 → 上传并部署 →
 *                       云开发控制台 → 云函数 → cleanupTestData → 测试 →
 *                       输入 {} 预览 → 输入 {dryRun:false, confirm:"DELETE_MY_TEST_DATA"} 实删
 *   方式2（前端调试）：在微信开发者工具 Console 执行：
 *     wx.cloud.callFunction({name:"cleanupTestData"}).then(r=>console.log(r))
 *     wx.cloud.callFunction({name:"cleanupTestData", data:{dryRun:false, confirm:"DELETE_MY_TEST_DATA"}}).then(r=>console.log(r))
 *
 * 调用后清理验证：
 *   getQuota 应该返回 used=0, available=true；socrates/dual/debate 按钮恢复正常。
 */

const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// P0 安全修复（上线审计 2026-08-24）：本函数可删除真实数据，原实现仅靠硬编码
// confirm 短语防误调用——该短语在源码/文档中公开，任何小程序用户都能直接
// callFunction 清空全站近 N 天数据（不传 openid 即删所有用户）。
// 现强制 openid 白名单（与 evalRunner.allowedOpenids 同机制），白名单外一律拒绝。
const ALLOWED_OPENIDS = ["oT6sTxiwsX1eg7tIu81T5SBn5DaI"]; // 与 evalRunner/config.json 保持一致；上线前按需增删

const CONFIRM_PHRASE = "DELETE_MY_TEST_DATA";
const DEFAULT_DAYS = 30;
const BATCH_LIMIT = 500; // 单批扫描上限（云数据库 where+get 默认 100，显式 limit 最多 1000）

const OFFSET = 8 * 3600 * 1000; // 北京时间偏移

function bjCutoff(days) {
  const cutoffBj = new Date(Date.now() + OFFSET - days * 86400000);
  return new Date(cutoffBj.getTime() - OFFSET); // 转回 UTC 与 serverDate() 对齐
}

async function countSessions(filter) {
  const res = await db.collection("sessions").where(filter).count();
  return res.total || 0;
}

async function listSessionIds(filter) {
  const ids = [];
  const batchSize = 100;
  let skip = 0;
  while (true) {
    let batch;
    try {
      const res = await db
        .collection("sessions")
        .where(filter)
        .skip(skip)
        .limit(batchSize)
        .field({ _id: true })
        .get();
      batch = res.data || [];
    } catch (e) {
      if (e && /collection not exists|ResourceNotFound|Db or Table not exist/i.test(e.errMsg || e.message || "")) {
        console.warn("[cleanupTestData] sessions collection not exists, treating as empty");
        return [];
      }
      throw e;
    }
    for (const d of batch) ids.push(d._id);
    if (batch.length < batchSize) break;
    skip += batchSize;
    if (skip >= BATCH_LIMIT) {
      console.warn(`[cleanupTestData] session list truncated at ${BATCH_LIMIT}`);
      break;
    }
  }
  return ids;
}

async function countByFilter(collection, filter) {
  try {
    const res = await db.collection(collection).where(filter).count();
    return res.total || 0;
  } catch (e) {
    // 集合不存在（未自动创建）视为 0，不阻断清理流程
    if (e && /collection not exists|ResourceNotFound|Db or Table not exist/i.test(e.errMsg || e.message || "")) {
      console.warn(`[cleanupTestData] collection ${collection} not exists, treating as 0`);
      return 0;
    }
    throw e;
  }
}

async function deleteByFilter(collection, filter) {
  // 云数据库没有 deleteMany，只能先查再逐条删
  let deleted = 0;
  let skip = 0;
  const batchSize = 100;
  while (true) {
    let batch;
    try {
      const res = await db
        .collection(collection)
        .where(filter)
        .skip(skip)
        .limit(batchSize)
        .field({ _id: true })
        .get();
      batch = res.data || [];
    } catch (e) {
      if (e && /collection not exists|ResourceNotFound|Db or Table not exist/i.test(e.errMsg || e.message || "")) {
        console.warn(`[cleanupTestData] collection ${collection} not exists, treating as 0 deletes`);
        return 0;
      }
      throw e;
    }
    if (batch.length === 0) break;
    for (const d of batch) {
      try {
        await db.collection(collection).doc(d._id).remove();
        deleted++;
      } catch (e) {
        console.warn(`[cleanupTestData] ${collection} ${d._id} remove failed:`, e && e.message);
      }
    }
    // 因为每次删了一条，skip 不变，重新从头查（避免漏删并发新增的；本工具是调试用，串行无所谓）
    if (batch.length < batchSize) break;
    if (deleted > BATCH_LIMIT) {
      console.warn(`[cleanupTestData] ${collection} delete truncated at ${BATCH_LIMIT}`);
      break;
    }
  }
  return deleted;
}

exports.main = async (event = {}) => {
  // P0 安全修复：白名单鉴权先于一切业务逻辑（含 dryRun 预览，避免向攻击者泄露数据量）
  const { OPENID } = cloud.getWXContext();
  if (!ALLOWED_OPENIDS.includes(OPENID || "")) {
    console.warn(`[cleanupTestData] unauthorized call blocked, openid=${OPENID || "none"}`);
    return { code: -1, msg: "unauthorized" };
  }

  const dryRun = event.dryRun !== false;
  const days = Math.max(1, Number(event.days) || DEFAULT_DAYS);
  const confirm = String(event.confirm || "");
  const openidFilter = event.openid ? String(event.openid) : null;
  const requestedCollections = Array.isArray(event.collections)
    ? event.collections
    : ["sessions", "reports", "votes", "token_usage", "eval_runs"];

  console.log(
    `[cleanupTestData] dryRun=${dryRun}, days=${days}, openid=${openidFilter || "ALL"}, collections=${requestedCollections.join(",")}`
  );

  if (!dryRun && confirm !== CONFIRM_PHRASE) {
    return {
      code: -1,
      msg: `确认失败：实删模式必须传 confirm: "${CONFIRM_PHRASE}" 防止误调用`,
    };
  }

  const cutoff = bjCutoff(days);
  const summary = {
    sessions: 0,
    reports: 0,
    votes: 0,
    token_usage: 0,
    eval_runs: 0,
  };

  try {
    // 构造 sessions 过滤条件
    const sessionFilter = Object.assign(
      { createdAt: _.gte(cutoff) },
      openidFilter ? { openid: openidFilter } : {}
    );

    // 先列出来要删的 sessionIds（reports 和 votes 按 sessionId 级联删）
    const sessionIds = await listSessionIds(sessionFilter);
    summary.sessions = sessionIds.length;

    if (dryRun) {
      // 预览模式：统计级联数量（容错缺失集合）
      if (sessionIds.length > 0 && requestedCollections.includes("reports")) {
        summary.reports = await countByFilter("reports", { sessionId: _.in(sessionIds) });
      }
      if (sessionIds.length > 0 && requestedCollections.includes("votes")) {
        summary.votes = await countByFilter("votes", { sessionId: _.in(sessionIds) });
      }
      if (requestedCollections.includes("token_usage")) {
        const usageFilter = Object.assign(
          { createdAt: _.gte(cutoff) },
          openidFilter ? { openid: openidFilter } : {}
        );
        summary.token_usage = await countByFilter("token_usage", usageFilter);
      }
      if (requestedCollections.includes("eval_runs")) {
        const eFilter = Object.assign(
          { createdAt: _.gte(cutoff) },
          openidFilter ? { openid: openidFilter } : {}
        );
        summary.eval_runs = await countByFilter("eval_runs", eFilter);
      }

      return {
        code: 0,
        data: {
          dryRun: true,
          cutoff: cutoff.toISOString(),
          days,
          openidFilter: openidFilter || "ALL",
          summary,
          hint: `实删请传 {dryRun:false, confirm:"${CONFIRM_PHRASE}"}`,
        },
      };
    }

    // 实删模式
    // 1. 删 reports（按 sessionId 级联）
    if (requestedCollections.includes("reports") && sessionIds.length > 0) {
      summary.reports = await deleteByFilter("reports", { sessionId: _.in(sessionIds) });
    }
    // 2. 删 votes（按 sessionId 级联）
    if (requestedCollections.includes("votes") && sessionIds.length > 0) {
      summary.votes = await deleteByFilter("votes", { sessionId: _.in(sessionIds) });
    }
    // 3. 删 sessions 本身
    if (requestedCollections.includes("sessions")) {
      summary.sessions = await deleteByFilter("sessions", sessionFilter);
    }
    // 4. 删 token_usage（按时间和 openid 过滤）
    if (requestedCollections.includes("token_usage")) {
      const usageFilter = Object.assign(
        { createdAt: _.gte(cutoff) },
        openidFilter ? { openid: openidFilter } : {}
      );
      summary.token_usage = await deleteByFilter("token_usage", usageFilter);
    }
    // 5. 删 eval_runs（按时间和 openid 过滤）
    if (requestedCollections.includes("eval_runs")) {
      const eFilter = Object.assign(
        { createdAt: _.gte(cutoff) },
        openidFilter ? { openid: openidFilter } : {}
      );
      summary.eval_runs = await deleteByFilter("eval_runs", eFilter);
    }

    console.log(`[cleanupTestData] done: ${JSON.stringify(summary)}`);
    return {
      code: 0,
      data: {
        dryRun: false,
        cutoff: cutoff.toISOString(),
        days,
        openidFilter: openidFilter || "ALL",
        deleted: summary,
      },
    };
  } catch (e) {
    console.error("[cleanupTestData] failed:", e);
    return { code: -1, msg: "cleanup failed", error: e && e.message };
  }
};
