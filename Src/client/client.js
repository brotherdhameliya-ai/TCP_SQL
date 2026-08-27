const net    = require("net");
const path   = require("path");
const fs     = require("fs");
const db     = require("../config/db");
const logger = require("../services/logger");
const { insertNotification } = require(path.resolve(__dirname, "../../TCP-Email/src/utils/notifyDB"));

const RECONNECT_DELAY = Number(process.env.RECONNECT_DELAY || 5000);
const INITIAL_MESSAGE = process.env.INITIAL_MESSAGE || "";

// key: "userId:host:port" -> { socket, timer }
const connections    = new Map();
// users who have explicitly logged out — suppress reconnect
const loggedOut      = new Set();

// ── 30ms Matching Setup ─────────────────────────────────────────────────────
// key: "userId:host:port" -> { text, port, timer, timestamp }
const MATCHING_WINDOW  = Number(process.env.TCP_MATCHING_WINDOW || 30);
const pendingMessages  = new Map();

function connKey(userId, host, port) {
  return `${userId}:${host}:${port}`;
}

function getKolkataTimeStr(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type) => parts.find(p => p.type === type).value;
  return `${getPart("year")}-${getPart("month")}-${getPart("day")} ${getPart("hour")}:${getPart("minute")}:${getPart("second")}`;
}

let userLabels = new Map();

async function refreshUserLabels() {
  try {
    const [rows] = await db.execute("SELECT host, port FROM user_tcp_configs ORDER BY id");
    const newLabels = new Map();
    let index = 1;
    for (const r of rows) {
      const k = `${r.host}:${r.port}`;
      if (!newLabels.has(k)) {
        newLabels.set(k, `user${index}`);
        index++;
      }
    }
    userLabels = newLabels;
  } catch (e) {
    logger.error(`Error refreshing user labels: ${e.message}`);
  }
}

function notify(severity, title, message) {
  insertNotification({ service_name: "TCP Node", severity, title, message, company_id: 1 }).catch(() => {});
}

async function findMatchingImage(folderPath, identifier) {
  if (!folderPath || !identifier) return null;
  const cleanFolder = folderPath.trim();
  const rawIdent    = identifier.trim();
  const identName   = path.parse(rawIdent).name.toLowerCase();

  try {
    if (!fs.existsSync(cleanFolder)) {
      logger.warn(`[image-search] Folder does not exist: ${cleanFolder}`);
      return null;
    }
    const files = fs.readdirSync(cleanFolder);
    // 1. Check exact name match (case-insensitive)
    // 2. Check full filename match (case-insensitive, in case message includes .jpg)
    const match = files.find(f => {
      const fName = path.parse(f).name.toLowerCase();
      const fFullName = f.toLowerCase();
      return fName === identName || fFullName === rawIdent.toLowerCase();
    });
    return match || null;
  } catch (e) {
    logger.warn(`[image-search] Cannot read folder ${cleanFolder}: ${e.message}`);
    return null;
  }
}

// ── processMessage ──────────────────────────────────────────────────────────
// port1/text1 = the port we're processing from; port2/text2 = optional paired port
// The "source port" for zone/folder lookup is the port that carries the barcode (OK)
// or the port that carries NR — each looks up its own IP's folder.
async function processMessage(userId, host, port1, text1, port2, text2) {
  try {
    const parsePart = (msg) => {
      const idx   = msg.indexOf("|");
      const ident = idx === -1 ? msg : msg.substring(0, idx);
      const val   = idx === -1 ? null : msg.substring(idx + 1);
      return { ident, val };
    };

    const p1 = parsePart(text1);
    let targetText, targetPort, barcode, identifier;

    if (text2 !== undefined) {
      // ── Paired mode ─────────────────────────────────────────────────────
      const p2           = parsePart(text2);
      const isP1Barcode  = p1.val && p1.val !== "NR";
      const isP2Barcode  = p2.val && p2.val !== "NR";

      if (isP2Barcode) {
        barcode = p2.val; targetText = text2; targetPort = port2; identifier = p2.ident;
      } else if (isP1Barcode) {
        barcode = p1.val; targetText = text1; targetPort = port1; identifier = p1.ident;
      } else {
        // Both NR or empty — default to text1
        barcode = null; targetText = text1; targetPort = port1; identifier = p1.ident;
      }
    } else {
      // ── Unpaired mode ────────────────────────────────────────────────────
      barcode    = (p1.val && p1.val !== "NR") ? p1.val : null;
      targetText = text1;
      targetPort = port1;
      identifier = p1.ident;
    }

    // ── Look up per-IP OK/NR folders and zone_id ────────────────────────
    const [[config]] = await db.execute(
      "SELECT folder_path_ok, folder_path_nr, zone_id FROM user_tcp_configs WHERE user_id = ? AND host = ? AND port = ? LIMIT 1",
      [userId, host, Number(targetPort)]
    );

    const folderPath = barcode
      ? (config?.folder_path_ok || null)   // barcode → OK folder
      : (config?.folder_path_nr || null);  // NR / no barcode → NR folder
    const zoneId     = config?.zone_id || null;

    const userLabel = userLabels.get(`${host}:${targetPort}`) || `user${userId}`;

    const matchedImage = await findMatchingImage(folderPath, identifier);
    if (matchedImage)
      logger.info(`[${userLabel}][${targetPort}] Image matched: ${matchedImage} in ${folderPath}`);
    else if (folderPath)
      logger.info(`[${userLabel}][${targetPort}] No image match for "${identifier}" in ${folderPath}`);

    console.log(`🗂️  [${userLabel}][${targetPort}] folder=${folderPath} | matched=${matchedImage} | barcode=${barcode} | zone=${zoneId}`);

    await db.execute(
      `INSERT INTO tcp_messages
         (message, company_id, port, image, folder_path, barcode, zone_id, received_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
      [targetText, Number(targetPort), matchedImage, folderPath, barcode, zoneId, getKolkataTimeStr()]
    );
    logger.info(`[${userLabel}][${targetPort}] Saved → image=${matchedImage} barcode=${barcode} zone=${zoneId}`);
  } catch (e) {
    const userLabel = userLabels.get(`${host}:${port1}`) || `user${userId}`;
    logger.error(`[${userLabel}][${port1}] DB ERROR in processMessage: ${e.message}`);
  }
}

// ── connectOne ───────────────────────────────────────────────────────────────
function connectOne(userId, host, port) {
  if (loggedOut.has(userId)) return;
  const key = connKey(userId, host, port);
  if (connections.has(key)) return;

  const socket = new net.Socket();
  let isConnected = false;
  connections.set(key, { socket, timer: null });

  const userLabel = userLabels.get(`${host}:${port}`) || `user${userId}`;

  logger.info(`[${userLabel}] CONNECTING ${host}:${port}`);
  console.log(`🔄 [${userLabel}] Connecting ${host}:${port}`);

  socket.connect(Number(port), host, () => {
    isConnected = true;
    logger.info(`[${userLabel}] CONNECTED ${host}:${port}`);
    console.log(`✅ [${userLabel}] Connected ${host}:${port}`);
    notify("info", "TCP Connected", `User ${userLabel} connected to ${host}:${port}`);
    if (INITIAL_MESSAGE) socket.write(INITIAL_MESSAGE + "\r\n");
  });

  socket.on("data", async (data) => {
    if (!isConnected) return;
    const text = data.toString().trim();
    if (!text) return;
    logger.info(`[${userLabel}][${host}:${port}] ${text}`);
    console.log(`📩 [${userLabel}][${port}]`, text);

    try {
      // ── Zone-based 30ms pair matching ──────────────────────────────────
      // Ports in the same Zone with the same host are matched within the window.
      const [[myRow]] = await db.execute(
        "SELECT zone_id, is_active FROM user_tcp_configs WHERE user_id = ? AND host = ? AND port = ? LIMIT 1",
        [userId, host, Number(port)]
      );

      if (!myRow || !myRow.is_active) {
        // Port deactivated — process unpaired
        await processMessage(userId, host, Number(port), text);
        return;
      }

      const zoneId = myRow.zone_id;

      if (!zoneId) {
        // Port has no zone — process immediately, no pairing
        await processMessage(userId, host, Number(port), text);
        return;
      }

      // Find the OTHER port(s) in the same Zone + same host
      const [pairRows] = await db.execute(
        "SELECT port FROM user_tcp_configs WHERE user_id = ? AND host = ? AND zone_id = ? AND port != ? AND is_active = 1",
        [userId, host, zoneId, Number(port)]
      );

      if (pairRows.length === 1) {
        // Exactly one partner → 30ms matching window (unchanged logic)
        const currentPort = Number(port);
        const otherPort   = Number(pairRows[0].port);
        const otherKey    = `${userId}:${host}:${otherPort}`;
        const myKey       = `${userId}:${host}:${currentPort}`;

        const pending = pendingMessages.get(otherKey);
        if (pending) {
          clearTimeout(pending.timer);
          pendingMessages.delete(otherKey);
          logger.info(`[${userLabel}] PAIRED ports ${currentPort} & ${otherPort} (zone=${zoneId}) within ${MATCHING_WINDOW}ms`);
          await processMessage(userId, host, currentPort, text, otherPort, pending.text);
        } else {
          const timer = setTimeout(async () => {
            if (pendingMessages.has(myKey)) {
              pendingMessages.delete(myKey);
              logger.info(`[${userLabel}][${currentPort}] Matching window expired → processing unpaired`);
              await processMessage(userId, host, currentPort, text);
            }
          }, MATCHING_WINDOW);
          pendingMessages.set(myKey, { text, port: currentPort, timer, timestamp: Date.now() });
        }
      } else {
        // 0 or 2+ partners — process immediately without pairing
        await processMessage(userId, host, Number(port), text);
      }
    } catch (e) {
      logger.error(`[${userLabel}][${port}] Pairing logic error: ${e.message}`);
    }
  });

  socket.on("end", () => {
    logger.info(`[${userLabel}][${host}:${port}] server ended connection`);
  });

  socket.on("close", () => {
    isConnected = false;
    logger.info(`[${userLabel}][${host}:${port}] closed — retrying in ${RECONNECT_DELAY}ms`);
    console.log(`❌ [${userLabel}][${port}] disconnected`);
    socket.removeAllListeners();
    socket.destroy();

    if (loggedOut.has(userId) || !connections.has(key)) return;
    notify("warning", "TCP Closed", `${host}:${port} closed for user ${userLabel}`);

    db.execute(
      "SELECT is_active FROM user_tcp_configs WHERE user_id = ? AND host = ? AND port = ? LIMIT 1",
      [userId, host, Number(port)]
    ).then(([[cfg]]) => {
      if (!cfg || !cfg.is_active || loggedOut.has(userId) || !connections.has(key)) {
        connections.delete(key);
        console.log(`🔒 [${userLabel}][${port}] is_active=0 or logged out — reconnect suppressed`);
        return;
      }
      const timer = setTimeout(() => {
        connections.delete(key);
        connectOne(userId, host, port);
      }, RECONNECT_DELAY);
      connections.set(key, { socket: null, timer });
    }).catch(() => { connections.delete(key); });
  });

  socket.on("error", (err) => {
    logger.error(`[${userLabel}][${host}:${port}] ERROR: ${err.message}`);
    console.log(`🚨 [${userLabel}][${port}] ERROR:`, err.message);
  });
}

function disconnectUser(userId, host, port) {
  const key   = connKey(userId, host, port);
  const entry = connections.get(key);
  if (!entry) return;
  if (entry.timer)  clearTimeout(entry.timer);
  if (entry.socket) { entry.socket.removeAllListeners(); entry.socket.destroy(); }
  connections.delete(key);
  const userLabel = userLabels.get(`${host}:${port}`) || `user${userId}`;
  logger.info(`[${userLabel}] Disconnected ${host}:${port}`);
}

function disconnectAllForUser(userId) {
  loggedOut.delete(userId);
  for (const key of connections.keys()) {
    if (key.startsWith(`${userId}:`)) {
      const entry = connections.get(key);
      if (entry.timer)  clearTimeout(entry.timer);
      connections.delete(key);
      if (entry.socket) { entry.socket.removeAllListeners(); entry.socket.destroy(); }
    }
  }
}

function logoutUser(userId) {
  loggedOut.add(userId);
  for (const key of [...connections.keys()]) {
    if (key.startsWith(`${userId}:`)) {
      const entry = connections.get(key);
      if (entry.timer)  clearTimeout(entry.timer);
      connections.delete(key);
      if (entry.socket) { entry.socket.removeAllListeners(); entry.socket.destroy(); }
    }
  }
  const userLabel = `user${userId}`;
  logger.info(`[${userLabel}] logged out — all TCP connections stopped`);
  console.log(`🔒 [${userLabel}] logged out — TCP connections stopped`);
}

async function loadAndConnectUser(userId) {
  loggedOut.delete(userId);
  try {
    await refreshUserLabels();
    const [rows] = await db.execute(
      "SELECT host, port FROM user_tcp_configs WHERE user_id = ? AND is_active = 1",
      [userId]
    );
    rows.forEach(({ host, port }) => connectOne(userId, host, port));
    return rows;
  } catch (e) {
    logger.error(`Failed to load TCP config for user ${userId}: ${e.message}`);
    return [];
  }
}

async function loadAll() {
  try {
    await refreshUserLabels();
    const [rows] = await db.execute(
      "SELECT DISTINCT user_id, host, port FROM user_tcp_configs WHERE is_active = 1"
    );
    rows.forEach(({ user_id, host, port }) => connectOne(user_id, host, port));
    logger.info(`TCP client: loaded ${rows.length} connection(s) from DB`);
  } catch (e) {
    logger.error(`TCP client loadAll error: ${e.message}`);
  }
}

function stopAll() {
  for (const [, entry] of connections.entries()) {
    if (entry.timer)  clearTimeout(entry.timer);
    if (entry.socket) { entry.socket.removeAllListeners(); entry.socket.destroy(); }
  }
  connections.clear();
}

module.exports = {
  connectOne,
  disconnectUser,
  disconnectAllForUser,
  logoutUser,
  loadAndConnectUser,
  loadAll,
  stopAll,
  refreshUserLabels
};
