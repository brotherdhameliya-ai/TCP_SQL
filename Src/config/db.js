/**
 * SQLite database adapter (better-sqlite3)
 *
 * Wraps the synchronous better-sqlite3 API in an async-compatible shim so all
 * existing callers that use `await db.execute(sql, params)` or
 * `await db.query(sql, params)` continue to work without changes.
 *
 * Return shape mirrors mysql2/promise:
 *   execute / query → Promise<[rows, fields]>
 *   execute (INSERT/UPDATE/DELETE) → Promise<[ResultSetHeader, fields]>
 */

const path    = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.resolve(__dirname, "../../tcp_logs.db");

// Open (or create) the database file. WAL mode for better concurrency.
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// ── Helpers ────────────────────────────────────────────

/**
 * Detect whether a SQL string is a write statement.
 * Used to choose between .run() and .all() on the prepared statement.
 */
function isWriteStatement(sql) {
  return /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|REPLACE)\s/i.test(sql);
}

/**
 * mysql2 passes arrays directly for IN (?) e.g. `WHERE code IN (?)`.
 * SQLite needs the array flattened and the single `?` expanded to `(?,?,?)`.
 * Also replaces all `?` with `?` (no-op here, but we handle nested arrays).
 */
function flattenParams(sql, params) {
  if (!params || params.length === 0) return { sql, params: [] };

  const flat = [];
  let newSql = sql;

  // Replace each `?` with potentially multiple `?` if the matching param is an array
  let i = 0;
  newSql = newSql.replace(/\?/g, () => {
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

/**
 * Core execute function — returns a promise that resolves to [rows|header, undefined].
 */
function run(sql, params = []) {
  const { sql: finalSql, params: finalParams } = flattenParams(sql, params);

  return new Promise((resolve, reject) => {
    try {
      const stmt = sqlite.prepare(finalSql);

      if (isWriteStatement(finalSql)) {
        const info = stmt.run(...finalParams);
        // Return a mysql2-style ResultSetHeader
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

// ── Public API ──────────────────────────────────────────

module.exports = {
  /** Run a parameterized query. Mirrors mysql2 pool.execute() */
  execute: (sql, params) => run(sql, params),

  /** Alias – some callers use .query() for dynamic queries */
  query:   (sql, params) => run(sql, params),

  /** Expose the raw better-sqlite3 instance for migrations / transactions */
  _sqlite: sqlite,
};
