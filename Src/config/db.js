/**
 * SQLite database adapter using sql.js (pure JavaScript — no native compilation)
 *
 * sql.js runs SQLite compiled to WebAssembly. It is 100% JS, requires no Python,
 * no node-gyp, and no C++ compiler — works on any platform out of the box.
 *
 * The database is loaded from disk into memory on first use, and flushed back
 * to disk after every write operation so data is never lost.
 *
 * Public API mirrors mysql2/promise so all existing callers work unchanged:
 *   db.execute(sql, params) → Promise<[rows | ResultSetHeader, undefined]>
 *   db.query(sql, params)   → same
 */

const path = require("path");
const fs   = require("fs");

const DB_PATH = path.resolve(__dirname, "../../tcp_logs.db");

// ── Lazy singleton ─────────────────────────────────────
// We initialise sql.js asynchronously once and cache the result.
let _dbPromise = null;

function getDb() {
  if (!_dbPromise) {
    _dbPromise = (async () => {
      const initSqlJs = require("sql.js");
      const SQL = await initSqlJs();

      // Load existing file or start fresh
      const fileBuffer = fs.existsSync(DB_PATH)
        ? fs.readFileSync(DB_PATH)
        : null;

      const db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

      // Performance pragmas
      db.run("PRAGMA journal_mode = WAL;");
      db.run("PRAGMA foreign_keys = ON;");

      return db;
    })();
  }
  return _dbPromise;
}

// ── Persist to disk ────────────────────────────────────
function persist(db) {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Helpers ────────────────────────────────────────────
function isWriteStatement(sql) {
  return /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)\s/i.test(sql);
}

/**
 * Expand array params for IN (?) — flattens nested arrays.
 */
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
    flat.push(p ?? null);
    return "?";
  });

  return { sql: newSql, params: flat };
}

// ── Core runner ────────────────────────────────────────
async function run(sql, params = []) {
  const db = await getDb();
  const { sql: finalSql, params: finalParams } = flattenParams(sql, params);

  if (isWriteStatement(finalSql)) {
    db.run(finalSql, finalParams);
    persist(db);
    // Retrieve last insert info via sql.js helper properties
    const insertId     = db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0][0] ?? 0;
    const affectedRows = db.getRowsModified();
    return [{ insertId, affectedRows, changedRows: affectedRows }, undefined];
  } else {
    const result = db.exec(finalSql, finalParams);
    if (!result.length) return [[], undefined];

    const { columns, values } = result[0];
    const rows = values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
    return [rows, undefined];
  }
}

// ── Public API ─────────────────────────────────────────
module.exports = {
  execute: (sql, params) => run(sql, params),
  query:   (sql, params) => run(sql, params),

  /** Expose the raw sql.js DB instance for schema init (synchronous DDL) */
  _getDb: getDb,
  _persist: () => getDb().then(db => persist(db)),
};
