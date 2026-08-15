/**
 * cleanupData — 用户数据 TTL 清理（合规整改 2026-08-16）
 *
 * 合规依据：
 * - 《个人信息保护法》第四十七条：处理目的已实现、无法实现或者为实现处理目的不再必要，
 *   个人信息处理者应当主动删除个人信息文件。
 * - 《生成式人工智能服务管理暂行办法》第十一条：提供者应当对使用者的输入信息
 *   履行保护义务，不得非法向他人提供。
 *
 * 实现：
 * - 定时触发（默认每日凌晨 3:00 北京时间）：扫描所有 sessions 及其级联数据
 * - 删除范围：createdAt 早于 N 天前（默认 30）的 sessions / reports / votes
 * - token_usage / eval_runs 不删（运营统计与评测基线，不含个人对话原文）
 * - users 文档不删（保留段位与配额档案，用户主动注销走另一路径）
 *
 * 部署：
 * - 上传该云函数后在云开发控制台 → 云函数 → cleanupData → 触发器
 *   添加定时触发器：{"name":"daily","type":"timer","config":"0 0 3 * * * *"}
 *   或者上传时由 config.json 的 triggers 字段自动创建（部分控制台支持）
 *
 * 验证：
 * - 上线前先手动调用一次（event.dryRun=true）查看将被删除的数量
 * - 确认无误后去掉 dryRun，让定时触发器自动执行
 *
 * 接口：
 *   {} 或 { dryRun: true, retentionDays: 30 } → { code, data: { deleted, dryRun } }
 */

const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const DEFAULT_RETENTION_DAYS = 30;
const BATCH_LIMIT = 100; // 单次扫描上限，避免一次删太多导致超时

exports.main = async (event = {}) => {
  const dryRun = event.dryRun === true;
  const retentionDays = Math.max(1, Number(event.retentionDays) || DEFAULT_RETENTION_DAYS);

  // 北京时间（UTC+8）计算截止时刻
  const OFFSET = 8 * 3600 * 1000;
  const now = Date.now() + OFFSET;
  const cutoffBj = new Date(now - retentionDays * 86400000);
  // 转回 UTC 与数据库 serverDate()（UTC）比较
  const cutoff = new Date(cutoffBj.getTime() - OFFSET);

  console.log(`[cleanupData] cutoff=${cutoff.toISOString()}, dryRun=${dryRun}, retention=${retentionDays}d`);

  const summary = {
    sessions: 0,
    reports: 0,
    votes: 0,
  };

  try {
    // 第一步：扫描过期的 sessions
    const sessRes = await db
      .collection("sessions")
      .where({ createdAt: _.lt(cutoff) })
      .limit(BATCH_LIMIT)
      .field({ _id: true })
      .get();

    const expiredSessionIds = (sessRes.data || []).map((d) => d._id);
    summary.sessions = expiredSessionIds.length;

    if (dryRun) {
      // 干跑：仅统计级联数量，不删除
      if (expiredSessionIds.length > 0) {
        const repRes = await db
          .collection("reports")
          .where({ sessionId: _.in(expiredSessionIds) })
          .count();
        summary.reports = repRes.total || 0;
        const voteRes = await db
          .collection("votes")
          .where({ sessionId: _.in(expiredSessionIds) })
          .count();
        summary.votes = voteRes.total || 0;
      }
      return {
        code: 0,
        data: { dryRun: true, cutoff: cutoff.toISOString(), retentionDays, expired: summary },
      };
    }

    // 实删：逐个删除（云数据库批量删 API 不统一，逐个最稳）
    for (const sid of expiredSessionIds) {
      try {
        // 级联删 reports
        try {
          const reps = await db.collection("reports").where({ sessionId: sid }).get();
          for (const r of reps.data || []) {
            await db.collection("reports").doc(r._id).remove();
            summary.reports += 1;
          }
        } catch (e) {
          console.warn(`[cleanupData] reports for ${sid} failed:`, e && e.message);
        }
        // 级联删 votes
        try {
          const vt = await db.collection("votes").where({ sessionId: sid }).get();
          for (const v of vt.data || []) {
            await db.collection("votes").doc(v._id).remove();
            summary.votes += 1;
          }
        } catch (e) {
          console.warn(`[cleanupData] votes for ${sid} failed:`, e && e.message);
        }
        // 删 session 本身
        await db.collection("sessions").doc(sid).remove();
      } catch (e) {
        console.error(`[cleanupData] session ${sid} remove failed:`, e && e.message);
      }
    }

    console.log(`[cleanupData] done: ${JSON.stringify(summary)}`);
    return {
      code: 0,
      data: {
        dryRun: false,
        cutoff: cutoff.toISOString(),
        retentionDays,
        deleted: summary,
      },
    };
  } catch (e) {
    console.error("[cleanupData] failed:", e);
    return { code: -1, msg: "cleanup failed", error: e && e.message };
  }
};
