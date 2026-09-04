/**
 * escape-xml.js — XML 特殊字符转义（与云函数端 escapeXml 行为一致）
 *
 * 用途：前端组装 LLM messages 时，把用户输入用 <user_data>...</user_data>
 * 标签包裹，并对标签内字符串做 XML 五字符转义，杜绝原文中字面 </tag>
 * 破坏标签闭合（与 evalRunner / generateReport 的注入隔离策略对齐）。
 *
 * 服务端 evalRunner / generateReport 已实现等价 escapeXml；前端补齐是为了
 * 让生产路径与评测路径在 prompt 注入防御上保持一致——同一份 prompt，
 * eval 路径硬隔离、生产路径同样硬隔离。
 */

/**
 * 转义 XML 五个特殊字符
 * @param {string} s
 * @returns {string}
 */
function escapeXml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 把用户输入包裹为 <user_data>...</user_data> 标签并转义内部字符
 * 用于组装 LLM messages 中 role=user 的 content 字段
 * @param {string} s
 * @returns {string}
 */
function wrapUserData(s) {
  return `<user_data>${escapeXml(s)}</user_data>`;
}

module.exports = { escapeXml, wrapUserData };
