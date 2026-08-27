require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env"), override: true });
const cron = require("node-cron");
const db = require("../config/db");
const logger = require("../services/logger");

const RETENTION_DAYS = Number(process.env.DATA_RETENTION_DAYS || 15);
const ENABLE = process.env.ENABLE_AUTO_CLEANUP === "true";
const CLEANUP_TIME = process.env.CLEANUP_TIME || "00:00";

function getCutoffDate() {
  const date = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  date.setDate(date.getDate() - RETENTION_DAYS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function cleanDatabase() {
  const cutoff = getCutoffDate();
  const [result] = await db.execute(
    "DELETE FROM tcp_messages WHERE date(received_at) < ?",
    [cutoff]
  );
  logger.info(`SQLite cleaned before: ${cutoff} | rows deleted: ${result.affectedRows}`);
}

async function runCleanup() {
  if (!ENABLE) {
    logger.warn("Auto cleanup is DISABLED, skipping.");
    return;
  }

  logger.info(`Cleanup started | retention: ${RETENTION_DAYS} days | cutoff: ${getCutoffDate()}`);
  try {
    await cleanDatabase();
    logger.info("Cleanup finished.");
  } catch (err) {
    logger.error(`Cleanup failed: ${err.message}`, { stack: err.stack });
  }
}

function convertToCron(time) {
  const [hour, minute] = time.split(":");
  return `${minute} ${hour} * * *`;
}

const cronTime = convertToCron(CLEANUP_TIME);
cron.schedule(cronTime, () => runCleanup());

logger.info(`Cleanup scheduled | ENABLE=${ENABLE} | RETENTION_DAYS=${RETENTION_DAYS} | CLEANUP_TIME=${CLEANUP_TIME} | cron=${cronTime}`);

module.exports = runCleanup;
