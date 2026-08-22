const net    = require("net");
const path   = require("path");
const fs     = require("fs");
const db     = require("../config/db");
const logger = require("../services/logger");
const { insertNotification } = require(path.resolve(__dirname, "../../TCP-Email/src/utils/notifyDB"));

const RECONNECT_DELAY = Number(process.env.RECONNECT_DELAY || 5000);
const INITIAL_MESSAGE = process.env.INITIAL_MESSAGE || "";

// key: "userId:host:port" -> { socket, timer }
const connections = new Map();
// users who have explicitly logged out — suppress reconnect
const loggedOut = new Set();

// ── 2-Port Pair Matching Setup ─────────────────────────
const MATCHING_WINDOW = Number(process.env.TCP_MATCHING_WINDOW || 30);
const pendingMessages = new Map(); // key: "userId:host:port" -> { text, port, timer, timestamp }

function connKey(userId, host, port) {
  return `${userId}:${host}:${port}`;
}

function notify(severity, title, message) {
  insertNotification({ service_name: "TCP Node", severity, title, message, company_id: 1 }).catch(() => {});
}

async function findMatchingImage(folderPath, identifier) {
  if (!folderPath) return null;
  try {
    const files = fs.readdirSync(folderPath);
    const match = files.find(f => path.parse(f).name === identifier);
    return match || null;
  } catch (e) {
    logger.warn(`[image-search] Cannot read folder ${folderPath}: ${e.message}`);
    return null;
  }
}

async function processMessage(userId, host, port1, text1, port2, text2) {
  try {
    // Look up folder_path for this user
    const [[config]] = await db.execute(
      "SELECT folder_path FROM user_tcp_configs WHERE user_id = ? AND host = ? AND port = ? LIMIT 1",
      [userId, host, Number(port1)]
    );
    const folderPath = config?.folder_path || null;

    let targetText = text1;
    let targetPort = port1;
    let barcode = null;
    let identifier = text1;

    const parsePart = (msg) => {
      const idx = msg.indexOf("|");
      const ident = idx === -1 ? msg : msg.substring(0, idx);
      const val = idx === -1 ? null : msg.substring(idx + 1);
      return { ident, val };
    };

    const p1 = parsePart(text1);
    
    if (text2 !== undefined) {
      // Paired message mode
      const p2 = parsePart(text2);
      
      // Determine which one is the barcode record
      const isP1Barcode = p1.val && p1.val !== "NR";
      const isP2Barcode = p2.val && p2.val !== "NR";

      if (isP2Barcode) {
        barcode = p2.val;
        targetText = text2;
        targetPort = port2;
        identifier = p2.ident;
      } else if (isP1Barcode) {
        barcode = p1.val;
        targetText = text1;
        targetPort = port1;
        identifier = p1.ident;
      } else {
        // Both are NR or empty, default to text1
        barcode = null;
        targetText = text1;
        targetPort = port1;
        identifier = p1.ident;
      }
    } else {
      // Unpaired message mode
      if (p1.val && p1.val !== "NR") {
        barcode = p1.val;
      } else {
        barcode = null;
      }
      identifier = p1.ident;
    }

    const matchedImage = await findMatchingImage(folderPath, identifier);
    if (matchedImage)
      logger.info(`[User:${userId}][${targetPort}] Image matched: ${matchedImage}`);
    else if (folderPath)
      logger.info(`[User:${userId}][${targetPort}] No image match for "${identifier}" in ${folderPath}`);

    console.log(`🗂️  [User:${userId}][${targetPort}] folder_path=${folderPath} | matched=${matchedImage} | barcode=${barcode}`);

    await db.execute(
      "INSERT INTO tcp_messages (message, company_id, port, image, folder_path, barcode, received_at) VALUES (?, 1, ?, ?, ?, ?, datetime('now'))",
      [targetText, Number(targetPort), matchedImage, folderPath, barcode]
    );
    logger.info(`[User:${userId}][${targetPort}] Saved to tcp_messages image=${matchedImage} barcode=${barcode}`);
  } catch (e) {
    logger.error(`[User:${userId}][${port1}] DB ERROR in processMessage: ${e.message}`);
  }
}

function connectOne(userId, host, port) {
  if (loggedOut.has(userId)) return; // user is logged out, do not reconnect
  const key = connKey(userId, host, port);
  if (connections.has(key)) return; // already connected

  const socket = new net.Socket();
  let isConnected = false;
  connections.set(key, { socket, timer: null });

  logger.info(`[User:${userId}] CONNECTING ${host}:${port}`);
  console.log(`🔄 [User:${userId}] Connecting ${host}:${port}`);

  socket.connect(Number(port), host, () => {
    isConnected = true;
    logger.info(`[User:${userId}] CONNECTED ${host}:${port}`);
    console.log(`✅ [User:${userId}] Connected ${host}:${port}`);
    notify("info", "TCP Connected", `User ${userId} connected to ${host}:${port}`);

    if (INITIAL_MESSAGE) socket.write(INITIAL_MESSAGE + "\r\n");
  });

  socket.on("data", async (data) => {
    if (!isConnected) return; // ignore data after disconnect
    const text = data.toString().trim();
    if (!text) return;
    logger.info(`[User:${userId}][${host}:${port}] ${text}`);
    console.log(`📩 [User:${userId}][${port}]`, text);
    try {
      // 1. Get all active ports for this user + host to check if it's a 2-port pair
      const [rows] = await db.execute(
        "SELECT port FROM user_tcp_configs WHERE user_id = ? AND host = ? AND is_active = 1",
        [userId, host]
      );
      
      const activePorts = rows.map(r => Number(r.port));
      
      if (activePorts.length === 2) {
        // We have a 2-port pair!
        const currentPort = Number(port);
        const otherPort = activePorts.find(p => p !== currentPort);
        const otherKey = `${userId}:${host}:${otherPort}`;
        const myKey = `${userId}:${host}:${currentPort}`;
        
        const pending = pendingMessages.get(otherKey);
        
        if (pending) {
          // Found paired message within window!
          clearTimeout(pending.timer);
          pendingMessages.delete(otherKey);
          
          logger.info(`[User:${userId}] PAIRED ports: ${currentPort} & ${otherPort} within matching window.`);
          await processMessage(userId, host, currentPort, text, otherPort, pending.text);
        } else {
          // No paired message yet, hold this one in queue
          const timer = setTimeout(async () => {
            if (pendingMessages.has(myKey)) {
              pendingMessages.delete(myKey);
              logger.info(`[User:${userId}][${currentPort}] Matching window expired. Processing as unpaired.`);
              await processMessage(userId, host, currentPort, text);
            }
          }, MATCHING_WINDOW);
          
          pendingMessages.set(myKey, {
            text,
            port: currentPort,
            timer,
            timestamp: Date.now()
          });
        }
      } else {
        // Not a 2-port configuration, process immediately without pairing logic
        await processMessage(userId, host, Number(port), text);
      }
    } catch (e) {
      logger.error(`[User:${userId}][${port}] Pairing data logic error: ${e.message}`);
    }
  });


  socket.on("end", () => {
    logger.info(`[User:${userId}][${host}:${port}] server ended connection`);
  });

  socket.on("close", () => {
    isConnected = false;
    logger.info(`[User:${userId}][${host}:${port}] closed — retrying in ${RECONNECT_DELAY}ms`);
    console.log(`❌ [User:${userId}][${port}] disconnected`);

    socket.removeAllListeners();
    socket.destroy();

    // If user logged out or entry was removed, do NOT reconnect
    if (loggedOut.has(userId) || !connections.has(key)) return;

    notify("warning", "TCP Closed", `${host}:${port} closed for user ${userId}`);

    // Double-check DB is_active before scheduling reconnect
    db.execute(
      "SELECT is_active FROM user_tcp_configs WHERE user_id = ? AND host = ? AND port = ? LIMIT 1",
      [userId, host, Number(port)]
    ).then(([[cfg]]) => {
      if (!cfg || !cfg.is_active || loggedOut.has(userId) || !connections.has(key)) {
        connections.delete(key);
        console.log(`🔒 [User:${userId}][${port}] is_active=0 or logged out — reconnect suppressed`);
        return;
      }
      const timer = setTimeout(() => {
        connections.delete(key);
        connectOne(userId, host, port);
      }, RECONNECT_DELAY);
      connections.set(key, { socket: null, timer });
    }).catch(() => {
      connections.delete(key);
    });
  });

  socket.on("error", (err) => {
    logger.error(`[User:${userId}][${host}:${port}] ERROR: ${err.message}`);
    console.log(`🚨 [User:${userId}][${port}] ERROR:`, err.message);
  });
}

function disconnectUser(userId, host, port) {
  const key = connKey(userId, host, port);
  const entry = connections.get(key);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.socket) { entry.socket.removeAllListeners(); entry.socket.destroy(); }
  connections.delete(key);
  logger.info(`[User:${userId}] Disconnected ${host}:${port}`);
}

function disconnectAllForUser(userId) {
  loggedOut.delete(userId); // clear logout flag when explicitly disconnecting for config update
  for (const key of connections.keys()) {
    if (key.startsWith(`${userId}:`)) {
      const entry = connections.get(key);
      if (entry.timer) clearTimeout(entry.timer);
      connections.delete(key); // delete BEFORE destroy so close handler sees no entry
      if (entry.socket) { entry.socket.removeAllListeners(); entry.socket.destroy(); }
    }
  }
}

function logoutUser(userId) {
  loggedOut.add(userId); // mark as logged out — suppresses all reconnects
  for (const key of [...connections.keys()]) {
    if (key.startsWith(`${userId}:`)) {
      const entry = connections.get(key);
      if (entry.timer) clearTimeout(entry.timer);
      connections.delete(key); // delete BEFORE destroy
      if (entry.socket) { entry.socket.removeAllListeners(); entry.socket.destroy(); }
    }
  }
  logger.info(`[User:${userId}] logged out — all TCP connections stopped`);
  console.log(`🔒 [User:${userId}] logged out — TCP connections stopped`);
}

async function loadAndConnectUser(userId) {
  loggedOut.delete(userId); // clear logout flag on reconnect
  try {
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
  for (const [key, entry] of connections.entries()) {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.socket) { entry.socket.removeAllListeners(); entry.socket.destroy(); }
  }
  connections.clear();
}

module.exports = { connectOne, disconnectUser, disconnectAllForUser, logoutUser, loadAndConnectUser, loadAll, stopAll };
