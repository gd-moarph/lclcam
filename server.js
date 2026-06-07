const crypto = require("crypto");
const http = require("http");
const path = require("path");

const dotenv = require("dotenv");
const express = require("express");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = normalizeBaseUrl(process.env.PUBLIC_BASE_URL || "");
const LOCAL_USER_ID = "local-studio";

const pairings = new Map();
const viewerTokens = new Map();
const socketsByUser = new Map();
const savedCameras = new Map();
const historySessions = [];

const defaultCameraSettings = {
  orientation: "portrait",
  fit: "contain",
  rotation: 0,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: 0
};

function normalizeBaseUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    console.warn("Ignoring invalid PUBLIC_BASE_URL:", value);
    return "";
  }
}

function publicUrl(req, pathname) {
  if (PUBLIC_BASE_URL) return new URL(pathname, PUBLIC_BASE_URL).toString();
  const protocol = req.get("x-forwarded-proto") || req.protocol;
  return `${protocol}://${req.get("host")}${pathname}`;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("base64url")}`;
}

function cleanPairings() {
  const now = Date.now();
  for (const [token, pairing] of pairings.entries()) if (pairing.expiresAt < now) pairings.delete(token);
  for (const [token, viewerToken] of viewerTokens.entries()) if (viewerToken.expiresAt < now) viewerTokens.delete(token);
}

function getUserRoom(userId) {
  return `user:${userId}`;
}

function createViewerToken(userId = LOCAL_USER_ID, phoneId = "", savedCameraId = "", cameraOnly = false, obsViewer = false, settings = null) {
  const token = crypto.randomBytes(24).toString("base64url");
  viewerTokens.set(token, { userId, phoneId, savedCameraId, cameraOnly, obsViewer, settings, expiresAt: Date.now() + 1000 * 60 * 10 });
  return token;
}

function getPhoneSocketIds(userId, phoneId) {
  const ids = socketsByUser.get(userId) || new Set();
  return [...ids].filter((id) => {
    const socket = io.sockets.sockets.get(id);
    return socket?.data.role === "phone" && (!phoneId || socket.data.phoneId === phoneId);
  });
}

function getViewerSocketIds(userId) {
  const ids = socketsByUser.get(userId) || new Set();
  return [...ids].filter((id) => io.sockets.sockets.get(id)?.data.role === "viewer");
}

function cleanDeviceName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function cleanPhoneKey(value) {
  const key = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{12,80}$/.test(key) ? key : `phone_${crypto.randomBytes(16).toString("base64url")}`;
}

function clampSetting(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanCameraSettings(value = {}) {
  const orientation = value.orientation === "landscape" ? "landscape" : "portrait";
  const fit = orientation === "portrait" ? "contain" : value.fit === "cover" ? "cover" : "contain";
  const rotation = [0, 90, 180, 270].includes(Number(value.rotation)) ? Number(value.rotation) : 0;
  return {
    orientation,
    fit,
    rotation,
    brightness: clampSetting(value.brightness, 50, 150, 100),
    contrast: clampSetting(value.contrast, 50, 180, 100),
    saturation: clampSetting(value.saturation, 0, 200, 100),
    grayscale: clampSetting(value.grayscale, 0, 100, 0)
  };
}

function cleanResolution(value) {
  const width = Number(value?.width || 0);
  const height = Number(value?.height || 0);
  const frameRate = Number(value?.frameRate || 0);
  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
    frameRate: Number.isFinite(frameRate) ? frameRate : 0
  };
}

function createObsSecret() {
  return crypto.randomBytes(48).toString("base64url");
}

function createObsPath(secret) {
  return `/o/${encodeURIComponent(secret)}`;
}

function getOrCreateSavedCamera(userId, phoneKey, deviceName) {
  const key = `${userId}:${phoneKey}`;
  const existing = savedCameras.get(key);
  if (existing) {
    existing.displayName = cleanDeviceName(deviceName) || existing.displayName;
    existing.lastConnectedAt = Date.now();
    return existing;
  }
  const obsSecret = createObsSecret();
  const camera = {
    id: createId("cam"),
    userId,
    phoneKey,
    displayName: cleanDeviceName(deviceName) || "Phone camera",
    obsSecret,
    settings: { ...defaultCameraSettings },
    createdAt: Date.now(),
    lastConnectedAt: Date.now()
  };
  savedCameras.set(key, camera);
  return camera;
}

function findOnlineCameraByObsSecret(obsSecret) {
  for (const [userId, ids] of socketsByUser.entries()) {
    for (const id of ids) {
      const socket = io.sockets.sockets.get(id);
      if (socket?.data.role === "phone" && socket.data.obsSecret === obsSecret) return { userId, phoneSocket: socket };
    }
  }
  return null;
}

function getPhonePayload(socket) {
  return {
    phoneSocketId: socket.id,
    phoneId: socket.data.phoneId,
    savedCameraId: socket.data.savedCameraId,
    phoneKey: socket.data.phoneKey,
    deviceName: socket.data.deviceName,
    startedAt: socket.data.startedAt,
    resolution: socket.data.resolution,
    settings: socket.data.cameraSettings,
    obsPath: socket.data.obsPath,
    paused: Boolean(socket.data.paused)
  };
}

function emitPhoneInventory(viewerSocket) {
  if (viewerSocket.data.role !== "viewer") return;
  for (const phoneSocketId of getPhoneSocketIds(viewerSocket.data.userId, viewerSocket.data.phoneId)) {
    const phoneSocket = io.sockets.sockets.get(phoneSocketId);
    if (phoneSocket) viewerSocket.emit("phone-ready", getPhonePayload(phoneSocket));
  }
}

function saveHistorySession(userId, session) {
  historySessions.unshift({
    id: createId("hist"),
    userId,
    phoneId: session.phoneId || "",
    savedCameraId: session.savedCameraId || "",
    deviceName: cleanDeviceName(session.deviceName) || "Phone camera",
    startedAt: new Date(Number(session.startedAt || Date.now())).toISOString(),
    endedAt: new Date(Number(session.endedAt || Date.now())).toISOString(),
    durationSeconds: Math.max(0, Number(session.durationSeconds || 0)),
    resolution: cleanResolution(session.resolution)
  });
  historySessions.splice(100);
}

function createPairing(userId) {
  const token = crypto.randomBytes(24).toString("base64url");
  pairings.set(token, { userId, phoneId: crypto.randomUUID(), createdAt: Date.now(), expiresAt: Date.now() + 1000 * 60 * 15 });
  return token;
}

app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use((req, res, next) => {
  if (req.path === "/" || /\.(html|js|css)$/i.test(req.path)) res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "app.html")));
app.get("/studio", (req, res) => res.sendFile(path.join(__dirname, "public", "app.html")));
app.get("/studio/:page", (req, res) => res.sendFile(path.join(__dirname, "public", "app.html")));
app.get("/camera.html", (req, res) => res.sendFile(path.join(__dirname, "public", "camera.html")));
app.get("/o/:obsSecret", (req, res) => res.sendFile(path.join(__dirname, "public", "camera.html")));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/plan", (req, res) => res.json({ plan: "open-source" }));
app.post("/api/viewer-token", (req, res) => {
  cleanPairings();
  res.json({ token: createViewerToken(LOCAL_USER_ID) });
});

app.post("/api/camera-viewer-token", (req, res) => {
  cleanPairings();
  const phoneId = String(req.body.phoneId || "").trim();
  const obsSecret = String(req.body.obsSecret || "").trim();
  if (obsSecret) {
    const match = findOnlineCameraByObsSecret(obsSecret);
    if (!match) return res.status(404).json({ error: "Camera is not online" });
    const { phoneSocket } = match;
    return res.json({ token: createViewerToken(match.userId, phoneSocket.data.phoneId, phoneSocket.data.savedCameraId, true, true, phoneSocket.data.cameraSettings), phoneId: phoneSocket.data.phoneId, settings: phoneSocket.data.cameraSettings || defaultCameraSettings });
  }
  if (!phoneId) return res.status(400).json({ error: "Missing camera id" });
  for (const [userId] of socketsByUser.entries()) {
    if (getPhoneSocketIds(userId, phoneId).length) return res.json({ token: createViewerToken(userId, phoneId, "", true) });
  }
  res.status(404).json({ error: "Camera is not online" });
});

app.patch("/api/saved-camera-settings", (req, res) => {
  const savedCameraId = String(req.body.savedCameraId || "").trim();
  const settings = cleanCameraSettings(req.body.settings || {});
  let cameraRecord;
  for (const camera of savedCameras.values()) if (camera.id === savedCameraId) cameraRecord = camera;
  if (!cameraRecord) return res.status(404).json({ error: "Saved camera not found" });
  cameraRecord.settings = settings;
  for (const phoneSocketId of getPhoneSocketIds(cameraRecord.userId)) {
    const phoneSocket = io.sockets.sockets.get(phoneSocketId);
    if (phoneSocket?.data.savedCameraId === savedCameraId) phoneSocket.data.cameraSettings = settings;
  }
  io.to(getUserRoom(cameraRecord.userId)).emit("camera-settings-updated", { savedCameraId, settings });
  res.json({ settings });
});

app.post("/api/saved-camera-obs-url", (req, res) => {
  const savedCameraId = String(req.body.savedCameraId || "").trim();
  let cameraRecord;
  for (const camera of savedCameras.values()) if (camera.id === savedCameraId) cameraRecord = camera;
  if (!cameraRecord) return res.status(404).json({ error: "Saved camera not found" });
  cameraRecord.obsSecret = createObsSecret();
  for (const phoneSocketId of getPhoneSocketIds(cameraRecord.userId)) {
    const phoneSocket = io.sockets.sockets.get(phoneSocketId);
    if (phoneSocket?.data.savedCameraId === savedCameraId) {
      phoneSocket.data.obsSecret = cameraRecord.obsSecret;
      phoneSocket.data.obsPath = createObsPath(cameraRecord.obsSecret);
    }
  }
  for (const socketId of socketsByUser.get(cameraRecord.userId) || []) {
    const viewerSocket = io.sockets.sockets.get(socketId);
    if (viewerSocket?.data.obsViewer && viewerSocket.data.savedCameraId === savedCameraId) viewerSocket.disconnect(true);
  }
  io.to(getUserRoom(cameraRecord.userId)).emit("camera-obs-url-regenerated", { savedCameraId, obsPath: createObsPath(cameraRecord.obsSecret) });
  res.json({ obsPath: createObsPath(cameraRecord.obsSecret) });
});

app.post("/api/pairing", async (req, res, next) => {
  try {
    cleanPairings();
    const token = createPairing(LOCAL_USER_ID);
    const phoneUrl = publicUrl(req, `/phone.html?token=${encodeURIComponent(token)}`);
    const qrDataUrl = await QRCode.toDataURL(phoneUrl, { errorCorrectionLevel: "M", margin: 1, width: 360 });
    res.json({ token, phoneUrl, qrDataUrl, expiresAt: pairings.get(token).expiresAt });
  } catch (error) {
    next(error);
  }
});

app.get("/api/history-sessions", (req, res) => {
  res.json({ sessions: historySessions.slice(0, 50) });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Server error" });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: false } });

io.use((socket, next) => {
  cleanPairings();
  const { role, token, viewerToken, deviceName, phoneKey } = socket.handshake.auth || {};
  if (role === "viewer") {
    const stored = viewerTokens.get(String(viewerToken || ""));
    if (!stored?.userId) return next(new Error("Invalid viewer token"));
    viewerTokens.delete(viewerToken);
    socket.data.role = "viewer";
    socket.data.userId = stored.userId;
    socket.data.phoneId = stored.phoneId || "";
    socket.data.savedCameraId = stored.savedCameraId || "";
    socket.data.cameraSettings = stored.settings || null;
    socket.data.cameraOnly = Boolean(stored.cameraOnly);
    socket.data.obsViewer = Boolean(stored.obsViewer);
    return next();
  }
  if (role === "phone") {
    const pairing = pairings.get(String(token || ""));
    if (!pairing) return next(new Error("Pairing code expired or invalid"));
    const savedCamera = getOrCreateSavedCamera(pairing.userId, cleanPhoneKey(phoneKey), deviceName);
    socket.data.role = "phone";
    socket.data.userId = pairing.userId;
    socket.data.token = token;
    socket.data.phoneId = pairing.phoneId;
    socket.data.phoneKey = savedCamera.phoneKey;
    socket.data.savedCameraId = savedCamera.id;
    socket.data.cameraSettings = cleanCameraSettings(savedCamera.settings || defaultCameraSettings);
    socket.data.obsSecret = savedCamera.obsSecret;
    socket.data.obsPath = createObsPath(savedCamera.obsSecret);
    socket.data.deviceName = cleanDeviceName(deviceName) || "Phone camera";
    socket.data.startedAt = Date.now();
    socket.data.resolution = { width: 0, height: 0, frameRate: 0 };
    socket.data.paused = false;
    return next();
  }
  next(new Error("Invalid connection role"));
});

io.on("connection", (socket) => {
  const room = getUserRoom(socket.data.userId);
  socket.join(room);
  if (!socketsByUser.has(socket.data.userId)) socketsByUser.set(socket.data.userId, new Set());
  socketsByUser.get(socket.data.userId).add(socket.id);

  if (socket.data.role === "viewer") {
    socket.emit("viewer-ready");
    if (socket.data.obsViewer && socket.data.savedCameraId) socket.emit("camera-settings-updated", { savedCameraId: socket.data.savedCameraId, settings: socket.data.cameraSettings || defaultCameraSettings });
    emitPhoneInventory(socket);
  }

  if (socket.data.role === "phone") {
    pairings.delete(socket.data.token);
    const payload = getPhonePayload(socket);
    socket.to(room).emit("phone-ready", payload);
    for (const viewerSocketId of getViewerSocketIds(socket.data.userId)) {
      const viewer = io.sockets.sockets.get(viewerSocketId);
      if (!viewer?.data.phoneId || viewer.data.phoneId === socket.data.phoneId) socket.emit("viewer-ready", { viewerSocketId, deviceName: socket.data.deviceName, phoneId: socket.data.phoneId });
    }
    socket.emit("phone-accepted");
  }

  socket.on("phone-meta", ({ deviceName, resolution } = {}) => {
    if (socket.data.role !== "phone") return;
    socket.data.deviceName = cleanDeviceName(deviceName) || socket.data.deviceName;
    socket.data.resolution = cleanResolution(resolution);
    socket.to(room).emit("phone-meta", getPhonePayload(socket));
  });

  socket.on("signal", ({ targetId, payload }) => {
    if (!targetId || !payload) return;
    const nextPayload = socket.data.role === "phone" ? { ...payload, ...getPhonePayload(socket) } : payload;
    io.to(targetId).emit("signal", { fromId: socket.id, role: socket.data.role, payload: nextPayload });
  });

  socket.on("request-phone", ({ phoneId } = {}) => {
    for (const phoneSocketId of getPhoneSocketIds(socket.data.userId, phoneId || socket.data.phoneId)) {
      io.to(phoneSocketId).emit("viewer-ready", { viewerSocketId: socket.id, phoneId: phoneId || socket.data.phoneId });
    }
  });

  socket.on("set-phone-paused", ({ phoneId, paused } = {}) => {
    if (socket.data.role !== "viewer") return;
    for (const phoneSocketId of getPhoneSocketIds(socket.data.userId, phoneId || socket.data.phoneId)) {
      io.to(phoneSocketId).emit("set-paused", { paused: Boolean(paused) });
      const phoneSocket = io.sockets.sockets.get(phoneSocketId);
      if (phoneSocket) {
        phoneSocket.data.paused = Boolean(paused);
        io.to(room).emit("phone-meta", getPhonePayload(phoneSocket));
      }
    }
  });

  socket.on("disconnect", () => {
    const set = socketsByUser.get(socket.data.userId);
    if (set) {
      set.delete(socket.id);
      if (!set.size) socketsByUser.delete(socket.data.userId);
    }
    socket.to(room).emit("peer-left", { socketId: socket.id, role: socket.data.role, phoneId: socket.data.phoneId });
    if (socket.data.role === "phone") {
      saveHistorySession(socket.data.userId, {
        phoneId: socket.data.phoneId,
        savedCameraId: socket.data.savedCameraId,
        deviceName: socket.data.deviceName,
        startedAt: socket.data.startedAt,
        endedAt: Date.now(),
        durationSeconds: Math.floor((Date.now() - socket.data.startedAt) / 1000),
        resolution: socket.data.resolution
      });
    }
  });
});

httpServer.listen(PORT, () => console.log(`LCLCam standalone running on http://localhost:${PORT}`));
