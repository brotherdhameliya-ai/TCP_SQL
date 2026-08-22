/**
 * SQLite database adapter using sql.js (pure JavaScript — no native compilation)
 * TCP-node-cleanup service — shares tcp_logs.db at the project root.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });

const path = require("path");
const fs   = require("fs");

const DB_PATH = path.resolve(__dirname, "../../../tcp_logs.db");

let _dbPromise = null;

function getDb() {
  if (!_dbPromise) {
    _dbPromise = (async () => {
      const initSqlJs = require("sql.js");
      const SQL = await initSqlJs();

      const fileBuffer = fs.existsSync(DB_PATH)
        ? fs.readFileSync(DB_PATH)
        : null;

      const db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();
      db.run("PRAGMA journal_mode = WAL;");
      db.run("PRAGMA foreign_keys = ON;");
      return db;
    })();
  }
  return _dbPromise;
}

function persist(db) {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

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

async function run(sql, params = []) {
  const db = await getDb();
  const { sql: finalSql, params: finalParams } = flattenParams(sql, params);

  if (isWriteStatement(finalSql)) {
    db.run(finalSql, finalParams);
    persist(db);
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

module.exports = {
  execute: (sql, params) => run(sql, params),
  query:   (sql, params) => run(sql, params),
  _getDb:  getDb,
};
