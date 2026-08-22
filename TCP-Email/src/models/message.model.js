const db = require("../config/db");

// ── Helper ─────────────────────────────────────────────
function shouldFilter(isSuperAdmin, companyId) {
  if (isSuperAdmin && !companyId) return false;
  return true;
}

// ── Unsent Records ─────────────────────────────────────
async function getUnsentRecords(companyId) {
  const [rows] = await db.execute(
    "SELECT id, received_at, message, port, image, folder_path, barcode FROM tcp_messages WHERE email_sent = 0 AND company_id = ? ORDER BY received_at ASC",
    [companyId]
  );
  return rows;
}

// ── Mark as Sent ───────────────────────────────────────
async function markAsSent(ids) {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  await db.execute(
    `UPDATE tcp_messages SET email_sent = 1, email_sent_at = datetime('now') WHERE id IN (${placeholders})`,
    ids
  );
}

// ── Stats ──────────────────────────────────────────────
async function getStats(companyId, isSuperAdmin = false) {
  const filter = shouldFilter(isSuperAdmin, companyId);
  const cid = companyId || 1;

  if (filter) {
    const [[total]]   = await db.execute("SELECT COUNT(*) as count FROM tcp_messages WHERE company_id = ?", [cid]);
    const [[sent]]    = await db.execute("SELECT COUNT(*) as count FROM tcp_messages WHERE email_sent = 1 AND company_id = ?", [cid]);
    const [[pending]] = await db.execute("SELECT COUNT(*) as count FROM tcp_messages WHERE email_sent = 0 AND company_id = ?", [cid]);
    const [[today]]   = await db.execute("SELECT COUNT(*) as count FROM tcp_messages WHERE date(received_at) = date('now') AND company_id = ?", [cid]);
    return { total: total.count, sent: sent.count, pending: pending.count, today: today.count };
  } else {
    const [[total]]   = await db.execute("SELECT COUNT(*) as count FROM tcp_messages");
    const [[sent]]    = await db.execute("SELECT COUNT(*) as count FROM tcp_messages WHERE email_sent = 1");
    const [[pending]] = await db.execute("SELECT COUNT(*) as count FROM tcp_messages WHERE email_sent = 0");
    const [[today]]   = await db.execute("SELECT COUNT(*) as count FROM tcp_messages WHERE date(received_at) = date('now')");
    return { total: total.count, sent: sent.count, pending: pending.count, today: today.count };
  }
}

// ── Pending Paginated ──────────────────────────────────
async function getPendingPaginated({ page = 1, limit = 20, search = "" }, companyId, isSuperAdmin = false) {
  const offset = (page - 1) * limit;
  const filter = shouldFilter(isSuperAdmin, companyId);

  const where = ["email_sent = 0"];
  const params = [];

  if (filter) {
    where.push("company_id = ?");
    params.push(companyId || 1);
  }

  if (search) {
    where.push("(message LIKE ? OR CAST(id AS TEXT) LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereClause = `WHERE ${where.join(" AND ")}`;

  const [rows] = await db.execute(
    `SELECT id, received_at, message, port, image, folder_path, barcode FROM tcp_messages ${whereClause} ORDER BY received_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [[{ count }]] = await db.execute(
    `SELECT COUNT(*) as count FROM tcp_messages ${whereClause}`,
    params
  );

  return { rows, total: count, page, limit };
}

// ── Time Range Helper ──────────────────────────────────
const TIME_RANGE_SQL = {
  "1h":  "received_at >= datetime('now', '-1 hour')",
  "6h":  "received_at >= datetime('now', '-6 hours')",
  "24h": "received_at >= datetime('now', '-24 hours')",
  "7d":  "received_at >= datetime('now', '-7 days')",
  "30d": "received_at >= datetime('now', '-30 days')",
};

// ── Records (paginated, filterable) ───────────────────
async function getRecords({ page = 1, limit = 20, emailStatus = "all", timeRange = "all", search = "" }, companyId, isSuperAdmin = false) {
  const offset = (page - 1) * limit;
  const filter = shouldFilter(isSuperAdmin, companyId);

  const where = [];
  const params = [];

  if (filter) {
    where.push("company_id = ?");
    params.push(companyId || 1);
  }

  if (emailStatus === "sent")    where.push("email_sent = 1");
  if (emailStatus === "pending") where.push("email_sent = 0");

  if (TIME_RANGE_SQL[timeRange]) where.push(TIME_RANGE_SQL[timeRange]);

  if (search) {
    where.push("(message LIKE ? OR CAST(id AS TEXT) LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows] = await db.query(
    `SELECT id, received_at, message, port, image, folder_path, barcode, email_sent, email_sent_at FROM tcp_messages ${whereClause} ORDER BY received_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ count }]] = await db.query(
    `SELECT COUNT(*) as count FROM tcp_messages ${whereClause}`,
    params
  );

  return { records: rows, total: Number(count), page, pages: Math.ceil(count / limit) };
}

// ── Recent Records ─────────────────────────────────────
async function getRecentRecords(limit = 20, companyId, isSuperAdmin = false) {
  const filter = shouldFilter(isSuperAdmin, companyId);

  if (filter) {
    const [rows] = await db.execute(
      "SELECT id, received_at, message, port, image, folder_path, barcode, email_sent FROM tcp_messages WHERE company_id = ? ORDER BY received_at DESC LIMIT ?",
      [companyId || 1, limit]
    );
    return rows;
  }

  const [rows] = await db.execute(
    "SELECT id, received_at, message, port, image, folder_path, barcode, email_sent FROM tcp_messages ORDER BY received_at DESC LIMIT ?",
    [limit]
  );
  return rows;
}

// ── Records By IDs ─────────────────────────────────────
async function getRecordsByIds(ids, companyId = null, isSuperAdmin = true) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const filter = shouldFilter(isSuperAdmin, companyId);

  if (filter && companyId) {
    const [rows] = await db.query(
      `SELECT id, received_at, message, port, image, folder_path, barcode, email_sent, email_sent_at FROM tcp_messages WHERE id IN (${placeholders}) AND company_id = ? ORDER BY received_at DESC`,
      [...ids, companyId]
    );
    return rows;
  }

  const [rows] = await db.query(
    `SELECT id, received_at, message, port, image, folder_path, barcode, email_sent, email_sent_at FROM tcp_messages WHERE id IN (${placeholders}) ORDER BY received_at DESC`,
    ids
  );
  return rows;
}

// ── Records By Filter ──────────────────────────────────
async function getRecordsByFilter({ emailStatus = "all", timeRange = "all", search = "" }, companyId, isSuperAdmin = false) {
  const filter = shouldFilter(isSuperAdmin, companyId);

  const where = [];
  const params = [];

  if (filter) {
    where.push("company_id = ?");
    params.push(companyId || 1);
  }

  if (emailStatus === "sent")    where.push("email_sent = 1");
  if (emailStatus === "pending") where.push("email_sent = 0");
  if (TIME_RANGE_SQL[timeRange]) where.push(TIME_RANGE_SQL[timeRange]);

  if (search) {
    where.push("(message LIKE ? OR CAST(id AS TEXT) LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await db.query(
    `SELECT id, received_at, message, port, image, folder_path, barcode, email_sent, email_sent_at FROM tcp_messages ${whereClause} ORDER BY received_at DESC`,
    params
  );
  return rows;
}

module.exports = {
  getUnsentRecords,
  markAsSent,
  getStats,
  getPendingPaginated,
  getRecords,
  getRecentRecords,
  getRecordsByIds,
  getRecordsByFilter,
};
