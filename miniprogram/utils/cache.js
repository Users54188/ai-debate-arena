/**
 * 本地缓存封装 —— 带 TTL 的简单 localStorage
 *
 * 用于"二次进 tab 秒开"：第一次进入页面正常走骨架屏 + 云函数；
 * 加载成功后把结果写入缓存；下次进入先用缓存渲染（loading=false），
 * 再后台调云函数刷新并覆盖缓存。
 *
 * 用法：
 *   const cache = require("./cache");
 *   cache.set("history:sessions", arr);       // 写
 *   const v = cache.get("history:sessions");  // 读（过期返回 null）
 *   cache.del("history:sessions");            // 删
 *
 * 注意：小程序 wx.setStorageSync 单 key 上限 1MB，整体存储上限 10MB。
 * 这里只缓存会话列表（≤50 项）/ profile 对象（小），不会超限。
 */

const DEFAULT_TTL = 10 * 60 * 1000; // 10 分钟

exports.set = function (key, value, ttl) {
  try {
    wx.setStorageSync("cache:" + key, {
      value: value,
      expireAt: Date.now() + (typeof ttl === "number" ? ttl : DEFAULT_TTL),
    });
  } catch (e) {
    // 容量超限或序列化失败：静默降级（缓存只是优化，不应阻塞功能）
    console.warn("[cache] set failed:", key, e && e.message);
  }
};

exports.get = function (key) {
  try {
    const item = wx.getStorageSync("cache:" + key);
    if (!item || typeof item !== "object") return null;
    if (!item.expireAt || item.expireAt < Date.now()) {
      // 过期：清理并返回 null（静默不打断 UI）
      try { wx.removeStorageSync("cache:" + key); } catch (e2) {}
      return null;
    }
    return item.value;
  } catch (e) {
    return null;
  }
};

exports.del = function (key) {
  try { wx.removeStorageSync("cache:" + key); } catch (e) {}
};

exports.DEFAULT_TTL = DEFAULT_TTL;
