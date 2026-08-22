/**
 * SQLite database adapter (better-sqlite3) — TCP-node-cleanup service
 *
 * Shares the same database file as the main app (tcp_logs.db at the project root).
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const path     = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.resolve(__dirname, "../../../tcp_logs.db");

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

function isWriteStatement(sql) {
  return /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|REPLACE)\s/i.test(sql);
}

function flattenParams(sql, params) {
  if (!params || params.length === 0) return { sql, params: [] };

  const flat = [];
  let i = 0;
  const newSql = sql.replace(/\?/g, () => {
    const p = params[i++];
    if (Array.isArray(p)) {
      p.forEach(v => flat.push(v));
      return p.map(() => "?").join(",");
    }
    flat.push(p);
    return "?";
  });

  return { sql: newSql, params: flat };
}

function run(sql, params = []) {
  const { sql: finalSql, params: finalParams } = flattenParams(sql, params);

  return new Promise((resolve, reject) => {
    try {
      const stmt = sqlite.prepare(finalSql);

      if (isWriteStatement(finalSql)) {
        const info = stmt.run(...finalParams);
        resolve([
          {
            insertId:     info.lastInsertRowid,
            affectedRows: info.changes,
            changedRows:  info.changes,
          },
          undefined,
        ]);
      } else {
        const rows = stmt.all(...finalParams);
        resolve([rows, undefined]);
      }
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  execute: (sql, params) => run(sql, params),
  query:   (sql, params) => run(sql, params),
  _sqlite: sqlite,
};
