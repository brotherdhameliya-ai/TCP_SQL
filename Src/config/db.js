/**
 * SQLite database adapter using sql.js (pure JavaScript — no native compilation)
 *
 * MULTI-PROCESS READ STRATEGY:
 * - Writes: use in-memory singleton, persist to disk immediately after each write
 * - Reads:  reload from disk first so we always see writes from other processes
 *
 * This means:
 *   app.js writes tcp_messages → persists to disk
 *   TCP-Email reads tcp_messages → reloads from disk → sees new rows ✓
 */

const path = require("path");
const fs   = require("fs");

const DB_PATH = path.resolve(__dirname, "../../tcp_logs.db");

let _SQL  = null;   // WASM module, loaded once
let _db   = null;   // in-memory DB instance

async function getSQL() {
  if (!_SQL) {
    const initSqlJs = require("sql.js");
    _SQL = await initSqlJs();
  }
  return _SQL;
}

// Load (or reload) the DB from disk
async function reloadDb() {
  const SQL = await getSQL();
  if (_db) { try { _db.close(); } catch (_) {} }
  const buf = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  _db = buf ? new SQL.Database(buf) : new SQL.Database();
  _db.run("PRAGMA foreign_keys = ON;");
  return _db;
}

// Persist current in-memory state to disk
function persist() {
  if (!_db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
}

// ── Helpers ────────────────────────────────────────────
function isWriteStatement(sql) {
  return /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)\s/i.test(sql);
}

function flattenParams(sql, params) {
  if (!params || params.length === 0) return { sql, params: [] };
  const flat = [];
  let i = 0;
  const newSql = sql.replace(/\?/g, () => {
    const p = params[i++];
    if (Array.isArray(p)) { p.forEach(v => flat.push(v)); return p.map(() => "?").join(","); }
    flat.push(p ?? null);
    return "?";
  });
  return { sql: newSql, params: flat };
}

// ── Core runner ────────────────────────────────────────
async function run(sql, params = []) {
  const { sql: finalSql, params: finalParams } = flattenParams(sql, params);

  if (isWriteStatement(finalSql)) {
    // Write: use current in-memory instance (or reload if not loaded yet)
    if (!_db) await reloadDb();
    _db.run(finalSql, finalParams);
    persist();  // flush to disk immediately so other processes see it
    const insertId     = _db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0][0] ?? 0;
    const affectedRows = _db.getRowsModified();
    return [{ insertId, affectedRows, changedRows: affectedRows }, undefined];
  } else {
    // Read: always reload from disk to see other processes' writes
    const db = await reloadDb();
    const result = db.exec(finalSql, finalParams);
    if (!result.length) return [[], undefined];
    const { columns, values } = result[0];
    const rows = values.map(row => {
      const obj = {};
      columns.forEach((col, idx) => { obj[col] = row[idx]; });
      return obj;
    });
    return [rows, undefined];
  }
}

// ── Public API ─────────────────────────────────────────
module.exports = {
  execute: (sql, params) => run(sql, params),
  query:   (sql, params) => run(sql, params),
  _getDb:   async () => { if (!_db) await reloadDb(); return _db; },
  _persist: async () => persist(),
};
