const db = require("../config/db");

// ── Helper ─────────────────────────────────────────────
function shouldFilter(isSuperAdmin, companyId) {
  if (isSuperAdmin && !companyId) return false;
  return true;
}

// ── Messages Trend (last 24 h) ─────────────────────────
async function getMessagesTrend(companyId, isSuperAdmin = false) {
  const filter = shouldFilter(isSuperAdmin, companyId);
  const where = ["received_at >= datetime('now', '-24 hours')"];
  const params = [];

  if (filter) {
    where.push("company_id = ?");
    params.push(companyId || 1);
  }

  // SQLite: strftime('%H:00', received_at) for the label
  const [rows] = await db.execute(`
    SELECT
      strftime('%H:00', received_at)  AS hour,
      CAST(strftime('%H', received_at) AS INTEGER) AS hour_num,
      COUNT(*)                        AS count
    FROM tcp_messages
    WHERE ${where.join(" AND ")}
    GROUP BY strftime('%H', received_at)
    ORDER BY hour_num ASC
  `, params);

  return rows.map(r => ({ hour: r.hour, count: Number(r.count) }));
}

// ── Email Status Distribution ──────────────────────────
async function getEmailStatusDistribution(companyId, isSuperAdmin = false) {
  const filter = shouldFilter(isSuperAdmin, companyId);
  const whereClause = filter ? "WHERE company_id = ?" : "";
  const params = filter ? [companyId || 1] : [];

  const [rows] = await db.execute(`
    SELECT
      SUM(CASE WHEN email_sent = 1 THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN email_sent = 0 THEN 1 ELSE 0 END) AS pending
    FROM tcp_messages
    ${whereClause}
  `, params);

  const r = rows[0] || {};
  return [
    { name: "Sent",    value: Number(r.sent    ?? 0) },
    { name: "Pending", value: Number(r.pending ?? 0) },
  ];
}

// ── Daily Records (last 30 days) ───────────────────────
async function getDailyRecords(companyId, isSuperAdmin = false) {
  const filter = shouldFilter(isSuperAdmin, companyId);
  const where = ["received_at >= date('now', '-30 days')"];
  const params = [];

  if (filter) {
    where.push("company_id = ?");
    params.push(companyId || 1);
  }

  // SQLite: strftime('%d %m', ...) — we format the label in JS for readability
  const [rows] = await db.execute(`
    SELECT
      date(received_at)                                 AS date,
      strftime('%d', received_at) || ' ' ||
        CASE strftime('%m', received_at)
          WHEN '01' THEN 'Jan' WHEN '02' THEN 'Feb' WHEN '03' THEN 'Mar'
          WHEN '04' THEN 'Apr' WHEN '05' THEN 'May' WHEN '06' THEN 'Jun'
          WHEN '07' THEN 'Jul' WHEN '08' THEN 'Aug' WHEN '09' THEN 'Sep'
          WHEN '10' THEN 'Oct' WHEN '11' THEN 'Nov' WHEN '12' THEN 'Dec'
        END                                             AS label,
      COUNT(*)                                          AS count
    FROM tcp_messages
    WHERE ${where.join(" AND ")}
    GROUP BY date(received_at)
    ORDER BY date(received_at) ASC
  `, params);

  return rows.map(r => ({ date: r.label, count: Number(r.count) }));
}

// ── Email History (last 30 days) ───────────────────────
async function getEmailHistory(companyId, isSuperAdmin = false) {
  const filter = shouldFilter(isSuperAdmin, companyId);
  const where = ["status = 'success'", "sent_at >= date('now', '-30 days')"];
  const params = [];

  if (filter) {
    where.push("company_id = ?");
    params.push(companyId || 1);
  }

  const [rows] = await db.execute(`
    SELECT
      date(sent_at)                                     AS date,
      strftime('%d', sent_at) || ' ' ||
        CASE strftime('%m', sent_at)
          WHEN '01' THEN 'Jan' WHEN '02' THEN 'Feb' WHEN '03' THEN 'Mar'
          WHEN '04' THEN 'Apr' WHEN '05' THEN 'May' WHEN '06' THEN 'Jun'
          WHEN '07' THEN 'Jul' WHEN '08' THEN 'Aug' WHEN '09' THEN 'Sep'
          WHEN '10' THEN 'Oct' WHEN '11' THEN 'Nov' WHEN '12' THEN 'Dec'
        END                                             AS label,
      COUNT(*)                                          AS emails,
      SUM(record_count)                                 AS records_sent
    FROM email_logs
    WHERE ${where.join(" AND ")}
    GROUP BY date(sent_at)
    ORDER BY date(sent_at) ASC
  `, params);

  return rows.map(r => ({ date: r.label, emails: Number(r.emails), records: Number(r.records_sent ?? 0) }));
}

// ── Busy Hours ─────────────────────────────────────────
async function getBusyHours(companyId, isSuperAdmin = false) {
  const filter = shouldFilter(isSuperAdmin, companyId);
  const whereClause = filter ? "WHERE company_id = ?" : "";
  const params = filter ? [companyId || 1] : [];

  const [rows] = await db.execute(`
    SELECT
      strftime('%H:00', received_at)  AS hour,
      CAST(strftime('%H', received_at) AS INTEGER) AS hour_num,
      COUNT(*)                        AS count
    FROM tcp_messages
    ${whereClause}
    GROUP BY strftime('%H', received_at)
    ORDER BY count DESC
    LIMIT 12
  `, params);

  return rows.map(r => ({ hour: r.hour, count: Number(r.count) }));
}

// ── Enhanced Stats ─────────────────────────────────────
async function getEnhancedStats(companyId, isSuperAdmin = false) {
  const filter = shouldFilter(isSuperAdmin, companyId);
  const cid = companyId || 1;

  let base, emailsToday, activeScheds, totalEmails;

  if (filter) {
    [[base]] = await db.execute(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN email_sent = 1 THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN email_sent = 0 THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN date(received_at) = date('now') THEN 1 ELSE 0 END) AS today
       FROM tcp_messages WHERE company_id = ?`,
      [cid]
    );
    [[emailsToday]] = await db.execute(
      `SELECT COUNT(*) AS count FROM email_logs WHERE date(sent_at) = date('now') AND status = 'success' AND company_id = ?`,
      [cid]
    );
    [[activeScheds]] = await db.execute(
      `SELECT COUNT(*) AS count FROM email_schedules WHERE active = 1 AND company_id = ?`,
      [cid]
    );
    [[totalEmails]] = await db.execute(
      `SELECT COUNT(*) AS count FROM email_logs WHERE status = 'success' AND company_id = ?`,
      [cid]
    );
  } else {
    [[base]] = await db.execute(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN email_sent = 1 THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN email_sent = 0 THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN date(received_at) = date('now') THEN 1 ELSE 0 END) AS today
       FROM tcp_messages`
    );
    [[emailsToday]] = await db.execute(
      `SELECT COUNT(*) AS count FROM email_logs WHERE date(sent_at) = date('now') AND status = 'success'`
    );
    [[activeScheds]] = await db.execute(
      `SELECT COUNT(*) AS count FROM email_schedules WHERE active = 1`
    );
    [[totalEmails]] = await db.execute(
      `SELECT COUNT(*) AS count FROM email_logs WHERE status = 'success'`
    );
  }

  return {
    total:           Number(base.total          ?? 0),
    sent:            Number(base.sent           ?? 0),
    pending:         Number(base.pending        ?? 0),
    today:           Number(base.today          ?? 0),
    emailsToday:     Number(emailsToday.count   ?? 0),
    activeSchedules: Number(activeScheds.count  ?? 0),
    emailSuccess:    Number(totalEmails.count   ?? 0),
    pendingEmails:   Number(base.pending        ?? 0),
  };
}

module.exports = {
  getMessagesTrend,
  getEmailStatusDistribution,
  getDailyRecords,
  getEmailHistory,
  getBusyHours,
  getEnhancedStats,
};
