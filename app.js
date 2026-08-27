const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "./.env"), override: true });

const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const logger      = require("./Src/services/logger");
const tcpService  = require("./Src/services/tcpServer.service");
const tcpClient   = require("./Src/client/client");
const cameraRoutes  = require("./Src/routes/camera.routes");
const migrateRoute  = require("./Src/routes/migrate.routes");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// Serve matched TCP images from any absolute folder path on disk
// e.g. GET /api/tcp-image?file=ABC123.jpg&folder=C:/images
app.get("/api/tcp-image", (req, res) => {
  let { file, folder } = req.query;
  if (!file || !folder) return res.status(400).end();
  
  // Remove surrounding quotes that might have been saved in DB
  folder = folder.trim().replace(/^["']|["']$/g, '');
  file = file.trim().replace(/^["']|["']$/g, '');

  // Basic path traversal guard
  const resolved = require("path").resolve(folder, file);
  if (!resolved.startsWith(require("path").resolve(folder))) return res.status(403).end();
  res.sendFile(resolved, (err) => { if (err) res.status(404).end(); });
});

app.use("/api", cameraRoutes);
app.use("/api", migrateRoute);
app.get("/api/statuses", (_req, res) => res.json(tcpService.getStatuses()));

io.on("connection", (socket) => {
  socket.emit("init_statuses", tcpService.getStatuses());
});

tcpService.setIO(io);

const API_PORT = Number(process.env.API_PORT) || 4000;

server.listen(API_PORT, async () => {
  logger.info(`API + Socket.IO server running on port ${API_PORT}`);
  console.log(`🚀 API server running on http://localhost:${API_PORT}`);

  await tcpService.startAll();
  await tcpClient.loadAll();   // load user TCP configs from DB
});

process.on("SIGINT", () => {
  logger.info("APPLICATION STOPPED");
  tcpClient.stopAll();
  process.exit();
});
