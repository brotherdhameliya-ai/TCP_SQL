/**
 * GET  /api/migrate?key=<MIGRATE_API_KEY>   ← browser-friendly
 * POST /api/migrate  (X-Migrate-Key: <key>) ← programmatic / curl
 *
 * Runs all database schema setup and migrations for the entire project.
 * Uses SQLite (better-sqlite3) — no MySQL connection required.
 *
 * Safe to call multiple times – every statement is idempotent (CREATE TABLE IF NOT EXISTS,
 * INSERT OR IGNORE, column-existence checks).
 *
 * Security: key is read from MIGRATE_API_KEY env var (default: "tcp_migrate_secret").
 */

const router     = require("express").Router();
const initSchema = require("../../TCP-Email/src/models/schema");

// ── Auth ────────────────────────────────────────────────────────────────────

const MIGRATE_KEY = process.env.MIGRATE_API_KEY || "tcp_migrate_secret";

function resolveKey(req) {
  return req.query.key || req.headers["x-migrate-key"] || null;
}

function requireMigrateKey(req, res, next) {
  const key = resolveKey(req);
  if (!key || key !== MIGRATE_KEY) {
    return res.status(401).json({
      success:             false,
      error:               "Missing or invalid migration key.",
      hint:                "GET ?key=<MIGRATE_API_KEY>  or  POST with X-Migrate-Key header.",
      default_credentials: { email: "superadmin@tcp.com", password: "Password123" },
    });
  }
  next();
}

// ── Migration handler ───────────────────────────────────────────────────────

async function handleMigrate(req, res) {
  const started = Date.now();
  const DEFAULT_CREDENTIALS = { email: "superadmin@tcp.com", password: "Password123" };

  try {
    await initSchema();
    const elapsed = Date.now() - started;

    return res.status(200).json({
      success:             true,
      message:             "All migrations applied successfully (SQLite).",
      elapsed_ms:          elapsed,
      default_credentials: DEFAULT_CREDENTIALS,
    });
  } catch (err) {
    const elapsed = Date.now() - started;
    console.error("[migrate] Error:", err);

    return res.status(500).json({
      success:             false,
      message:             "Migration failed. See error for details.",
      error:               err.message,
      elapsed_ms:          elapsed,
      default_credentials: DEFAULT_CREDENTIALS,
    });
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.get("/migrate",  requireMigrateKey, handleMigrate);
router.post("/migrate", requireMigrateKey, handleMigrate);

module.exports = router;
