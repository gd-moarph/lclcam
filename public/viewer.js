const cameraGrid = document.getElementById("cameraGrid");
const emptyState = document.getElementById("emptyState");
const qrModal = document.getElementById("qrModal");
const guideModal = document.getElementById("guideModal");
const historyModal = document.getElementById("historyModal");
const qrCode = document.getElementById("qrCode");
const phoneLink = document.getElementById("phoneLink");
const newQrButton = document.getElementById("newQrButton");
const closeQrModal = document.getElementById("closeQrModal");
const closeGuideModal = document.getElementById("closeGuideModal");
const closeHistoryModal = document.getElementById("closeHistoryModal");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const expiresText = document.getElementById("expiresText");
const detailName = document.getElementById("detailName");
const detailStatus = document.getElementById("detailStatus");
const detailResolution = document.getElementById("detailResolution");
const detailRuntime = document.getElementById("detailRuntime");
const statPhones = document.getElementById("statPhones");
const statPlan = document.getElementById("statPlan");
const guideTitle = document.getElementById("guideTitle");
const guideSteps = document.getElementById("guideSteps");
const historyLink = document.getElementById("historyLink");
const historyList = document.getElementById("historyList");
const historyPageList = document.getElementById("historyPageList");
const phonesList = document.getElementById("phonesList");
const cameraSettingsModal = document.getElementById("cameraSettingsModal");
const closeCameraSettingsModal = document.getElementById("closeCameraSettingsModal");
const cameraSettingsTitle = document.getElementById("cameraSettingsTitle");
const cameraOrientation = document.getElementById("cameraOrientation");
const cameraFit = document.getElementById("cameraFit");
const cameraRotation = document.getElementById("cameraRotation");
const brightnessRange = document.getElementById("brightnessRange");
const contrastRange = document.getElementById("contrastRange");
const saturationRange = document.getElementById("saturationRange");
const grayscaleRange = document.getElementById("grayscaleRange");
const brightnessValue = document.getElementById("brightnessValue");
const contrastValue = document.getElementById("contrastValue");
const saturationValue = document.getElementById("saturationValue");
const grayscaleValue = document.getElementById("grayscaleValue");
const copyObsUrlButton = document.getElementById("copyObsUrlButton");
const regenerateObsUrlButton = document.getElementById("regenerateObsUrlButton");

const peerConfig = { iceServers: [], iceTransportPolicy: "all" };
const cameras = new Map();
const peers = new Map();
let socket;
let selectedCameraId = null;
let currentPlan = "free";
let editingCameraId = null;

const defaultCameraSettings = {
  orientation: "portrait",
  fit: "contain",
  rotation: 0,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: 0
};

const guides = {
  obs: {
    title: "Use a phone camera in OBS",
    steps: [
      "Connect a phone camera from the dashboard.",
      "Click Open on the camera tile to launch a clean camera tab.",
      "In OBS, add a Browser Source for that camera URL.",
      "Set the Browser Source width and height to match the phone camera resolution, for example 1920 width and 1080 height for 1080p.",
      "Start OBS Virtual Camera if you want to use it in other apps."
    ]
  },
  discord: {
    title: "Use a phone camera in Discord",
    steps: [
      "Connect the phone camera and open it in a clean tab.",
      "Open OBS and capture that camera tab.",
      "Start OBS Virtual Camera.",
      "In Discord, choose OBS Virtual Camera as your camera device."
    ]
  },
  slack: {
    title: "Use a phone camera in Slack",
    steps: [
      "Open the camera in a clean tab from the dashboard.",
      "Capture the tab in OBS.",
      "Start OBS Virtual Camera.",
      "In Slack call settings, select OBS Virtual Camera."
    ]
  }
};

function updateYearRanges() {
  document.querySelectorAll("[data-current-year-range]").forEach((element) => {
    const year = new Date().getFullYear();
    element.textContent = year > 2026 ? `2026 - ${year}` : "2026";
  });
}

function setStatus(text, state = "idle") {
  statusText.textContent = text;
  statusDot.dataset.state = state;
}

function formatRuntime(startedAt) {
  const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return formatDuration(total);
}

function formatDuration(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatResolution(width, height) {
  const shortSide = Math.min(Number(width || 0), Number(height || 0));
  if (!shortSide) return "Detecting";
  if (shortSide >= 2160) return "4K";
  if (shortSide >= 1440) return "1440p";
  if (shortSide >= 1080) return "1080p";
  if (shortSide >= 720) return "720p";
  return `${width} x ${height}`;
}

function formatStreamQuality(resolution = {}, video) {
  const sourceWidth = Number(resolution.width || 0);
  const sourceHeight = Number(resolution.height || 0);
  const decodedWidth = Number(video?.videoWidth || 0);
  const decodedHeight = Number(video?.videoHeight || 0);
  const width = sourceWidth || decodedWidth;
  const height = sourceHeight || decodedHeight;
  const frameRate = Number(resolution.frameRate || 0);
  if (!width || !height) return "Detecting";
  const label = formatResolution(width, height);
  const fps = frameRate ? ` at ${Math.round(frameRate)} FPS` : "";
  return `${label}${fps}`;
}

function getSettingsKey(phoneId) {
  return `lclcam-camera-settings-${phoneId}`;
}

function loadCameraSettings(phoneId) {
  try {
    const stored = JSON.parse(localStorage.getItem(getSettingsKey(phoneId)) || "{}");
    const settings = { ...defaultCameraSettings, ...stored };
    if (settings.orientation === "auto") settings.orientation = "portrait";
    if (settings.orientation === "portrait") settings.fit = "contain";
    return settings;
  } catch {
    return { ...defaultCameraSettings };
  }
}

function saveCameraSettings(camera) {
  if (!camera?.phoneId) return;
  localStorage.setItem(getSettingsKey(camera.phoneId), JSON.stringify(camera.settings));
}

async function saveCameraSettingsToServer(camera) {
  if (!camera?.savedCameraId) return;
  await fetch("/api/saved-camera-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      savedCameraId: camera.savedCameraId,
      settings: camera.settings
    })
  });
}

function clampPercent(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getFilterStyle(settings = defaultCameraSettings) {
  return [
    `brightness(${clampPercent(settings.brightness, 100)}%)`,
    `contrast(${clampPercent(settings.contrast, 100)}%)`,
    `saturate(${clampPercent(settings.saturation, 100)}%)`,
    `grayscale(${clampPercent(settings.grayscale, 0)}%)`
  ].join(" ");
}

function getResolvedOrientation(camera) {
  const requested = camera?.settings?.orientation || "auto";
  if (requested !== "auto") return requested;
  const width = camera?.resolution?.width || camera?.video?.videoWidth || 0;
  const height = camera?.resolution?.height || camera?.video?.videoHeight || 0;
  return height > width ? "portrait" : "landscape";
}

function applyCameraSettings(camera) {
  if (!camera?.video) return;
  const settings = camera.settings || { ...defaultCameraSettings };
  const orientation = getResolvedOrientation(camera);
  const rotation = Number(settings.rotation || 0);
  const needsRotatedFill = orientation === "landscape" && settings.fit === "cover" && [90, 270].includes(rotation);
  const media = camera.tile.querySelector(".camera-media");
  if (media) media.dataset.orientation = orientation;
  camera.video.dataset.rotatedFill = needsRotatedFill ? "true" : "false";
  camera.video.style.objectFit = settings.fit || "contain";
  camera.video.style.filter = getFilterStyle(settings);
  camera.video.style.transform = `rotate(${rotation}deg)${needsRotatedFill ? " scale(1.78)" : ""}`;
}

function createCameraSettings(phoneId) {
  return loadCameraSettings(phoneId);
}

function getCurrentPage() {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path.endsWith("/phones")) return "phones";
  if (path.endsWith("/history")) return "history";
  if (path.endsWith("/obs")) return "obs";
  if (path.endsWith("/videocalls")) return "videocalls";
  return "dashboard";
}

function updatePageTitle(page) {
  const titles = {
    dashboard: "LCLCam.com - Studio",
    phones: "LCLCam.com - Phones Linked",
    history: "LCLCam.com - History Sessions",
    obs: "LCLCam.com - OBS Tutorial",
    videocalls: "LCLCam.com - Discord & Slack Tutorial"
  };
  document.title = titles[page] || "LCLCam.com - Studio";
}

function activatePage() {
  const page = getCurrentPage();
  updatePageTitle(page);
  document.querySelectorAll("[data-page]").forEach((section) => {
    section.classList.toggle("active", section.dataset.page === page);
  });
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === page);
  });
  if (page === "history") openHistory({ inline: true });
  if (page === "phones") renderPhonesList();
  if (page === "dashboard" && selectedCameraId) requestCameraPreview(selectedCameraId);
}

function selectCamera(cameraId) {
  selectedCameraId = cameraId;
  for (const [id, camera] of cameras.entries()) {
    camera.tile.classList.toggle("selected", id === cameraId);
  }
  updateDetails();
  renderPhonesList();
  requestCameraPreview(cameraId);
}

function requestCameraPreview(cameraId) {
  const camera = cameras.get(cameraId);
  if (!socket?.connected || !camera?.phoneId) return;
  socket.emit("request-phone", { phoneId: camera.phoneId });
}

function updateDetails() {
  statPhones.textContent = String(cameras.size);
  statPlan.textContent = "Open Source";
  const camera = cameras.get(selectedCameraId) || cameras.values().next().value;

  if (!camera) {
    detailName.textContent = "No phone connected";
    detailStatus.textContent = "Disconnected";
    detailResolution.textContent = "-";
    detailRuntime.textContent = "00:00";
    renderPhonesList();
    return;
  }

  const width = camera.resolution?.width || camera.video.videoWidth || 0;
  const height = camera.resolution?.height || camera.video.videoHeight || 0;
  detailName.textContent = camera.name;
  detailStatus.textContent = camera.status.textContent || "Connected";
  detailResolution.textContent = formatStreamQuality(camera.resolution, camera.video);
  detailRuntime.textContent = formatRuntime(camera.startedAt);
  renderPhonesList();
}

function upsertPhoneMeta(meta = {}) {
  if (!meta.phoneSocketId) return;
  const existing = cameras.get(meta.phoneSocketId);
  if (existing) {
    existing.name = meta.deviceName || existing.name;
    existing.phoneId = meta.phoneId || existing.phoneId;
    existing.savedCameraId = meta.savedCameraId || existing.savedCameraId;
    existing.obsPath = meta.obsPath || existing.obsPath;
    existing.startedAt = Number(meta.startedAt || existing.startedAt);
    existing.resolution = meta.resolution || existing.resolution;
    existing.paused = Boolean(meta.paused);
    existing.settings = meta.settings ? { ...defaultCameraSettings, ...meta.settings } : existing.settings;
    existing.status.textContent = existing.status.textContent || "Connected";
    existing.tile.querySelector(".camera-title strong").textContent = existing.name;
    applyCameraSettings(existing);
  } else {
    cameras.set(meta.phoneSocketId, createPhoneOnlyTile(meta.phoneSocketId, meta));
    if (!selectedCameraId) selectedCameraId = meta.phoneSocketId;
    applyCameraSettings(cameras.get(meta.phoneSocketId));
  }
  updateEmptyState();
}

function renderPhonesList() {
  if (!phonesList) return;
  if (!cameras.size) {
    phonesList.innerHTML = "<p class=\"hint\">No linked phones are online right now.</p>";
    return;
  }

  phonesList.innerHTML = "";
  for (const [cameraId, camera] of cameras.entries()) {
    const width = camera.resolution?.width || camera.video.videoWidth || 0;
    const height = camera.resolution?.height || camera.video.videoHeight || 0;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "phone-list-item";
    item.innerHTML = "<span class=\"phone-status-pill\">Connected</span><strong></strong><span></span><small></small>";
    item.querySelector("strong").textContent = camera.name;
    item.querySelector("span:not(.phone-status-pill)").textContent = formatStreamQuality(camera.resolution, camera.video);
    item.querySelector("small").textContent = `Runtime ${formatRuntime(camera.startedAt)}`;
    item.addEventListener("click", () => {
      selectCamera(cameraId);
      history.pushState(null, "", "/studio");
      activatePage();
      requestCameraPreview(cameraId);
    });
    phonesList.append(item);
  }
}

function toggleCameraPause(cameraId, button) {
  const camera = cameras.get(cameraId);
  if (!camera || !socket?.connected) return;
  const nextPaused = !camera.paused;
  camera.paused = nextPaused;
  button.textContent = nextPaused ? "Resume" : "Pause";
  socket.emit("set-phone-paused", { phoneId: camera.phoneId, paused: nextPaused });
}
function updateEmptyState() {
  emptyState.hidden = cameras.size > 0;
  setStatus(cameras.size ? `${cameras.size} active camera${cameras.size === 1 ? "" : "s"}` : "Waiting for phone", cameras.size ? "live" : "idle");
  if (!cameras.has(selectedCameraId)) {
    selectedCameraId = cameras.keys().next().value || null;
  }
  updateDetails();
  renderPhonesList();
}

function createCameraTile(cameraId, meta, track) {
  const name = meta.deviceName || "Phone camera";
  const tile = document.createElement("article");
  tile.className = "camera-card";
  tile.dataset.cameraId = cameraId;

  const media = document.createElement("div");
  media.className = "camera-media";

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;

  const toolbar = document.createElement("div");
  toolbar.className = "camera-toolbar";

  const title = document.createElement("div");
  title.className = "camera-title";
  title.innerHTML = "<strong></strong><span>Connecting</span>";
  title.querySelector("strong").textContent = name || "Phone camera";

  const actions = document.createElement("div");
  actions.className = "camera-actions";

  const fullscreenButton = document.createElement("button");
  fullscreenButton.type = "button";
  fullscreenButton.className = "icon-button";
  fullscreenButton.textContent = "Full";

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "icon-button";
  settingsButton.textContent = "Controls";
  settingsButton.dataset.cameraControls = cameraId;

  const pauseButton = document.createElement("button");
  pauseButton.type = "button";
  pauseButton.className = "icon-button";
  pauseButton.textContent = "Pause";
  pauseButton.dataset.pauseCamera = cameraId;
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "icon-button";
  copyButton.textContent = "Copy OBS URL";

  fullscreenButton.addEventListener("click", () => {
    if (media.requestFullscreen) media.requestFullscreen();
  });
  copyButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await copyCameraUrl(cameraId, copyButton);
  });
  tile.addEventListener("click", () => selectCamera(cameraId));

  actions.append(fullscreenButton, settingsButton, pauseButton, copyButton);
  toolbar.append(title, actions);
  media.append(video, toolbar);
  tile.append(media);
  cameraGrid.append(tile);

  video.srcObject = new MediaStream([track]);
  video.onloadedmetadata = () => {
    updateDetails();
    const camera = cameras.get(cameraId);
    if (camera) applyCameraSettings(camera);
  };
  video.play().catch(() => undefined);

  return {
    tile,
    video,
    status: title.querySelector("span"),
    name,
    phoneId: meta.phoneId || cameraId,
    savedCameraId: meta.savedCameraId || "",
    obsPath: meta.obsPath || "",
    resolution: meta.resolution || { width: 0, height: 0 },
    startedAt: Number(meta.startedAt || Date.now()),
    settings: meta.settings ? { ...defaultCameraSettings, ...meta.settings } : createCameraSettings(meta.phoneId || cameraId),
    paused: Boolean(meta.paused)
  };
}

function createPhoneOnlyTile(cameraId, meta = {}) {
  const tile = document.createElement("article");
  tile.className = "camera-card";
  tile.dataset.cameraId = cameraId;

  const media = document.createElement("div");
  media.className = "camera-media";

  const placeholder = document.createElement("div");
  placeholder.className = "camera-tile-placeholder";
  placeholder.textContent = "Reconnecting preview";

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;

  const toolbar = document.createElement("div");
  toolbar.className = "camera-toolbar";

  const title = document.createElement("div");
  title.className = "camera-title";
  title.innerHTML = "<strong></strong><span>Connected</span>";
  title.querySelector("strong").textContent = meta.deviceName || "Phone camera";

  const actions = document.createElement("div");
  actions.className = "camera-actions";

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "icon-button";
  settingsButton.textContent = "Controls";
  settingsButton.dataset.cameraControls = cameraId;

  const pauseButton = document.createElement("button");
  pauseButton.type = "button";
  pauseButton.className = "icon-button";
  pauseButton.textContent = "Pause";
  pauseButton.dataset.pauseCamera = cameraId;
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "icon-button";
  copyButton.textContent = "Copy OBS URL";
  copyButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await copyCameraUrl(cameraId, copyButton);
  });

  tile.addEventListener("click", () => selectCamera(cameraId));
  actions.append(settingsButton, pauseButton, copyButton);
  toolbar.append(title, actions);
  media.append(placeholder, video, toolbar);
  tile.append(media);
  cameraGrid.append(tile);

  return {
    tile,
    video,
    placeholder,
    status: title.querySelector("span"),
    name: meta.deviceName || "Phone camera",
    phoneId: meta.phoneId || cameraId,
    savedCameraId: meta.savedCameraId || "",
    obsPath: meta.obsPath || "",
    resolution: meta.resolution || { width: 0, height: 0 },
    startedAt: Number(meta.startedAt || Date.now()),
    settings: meta.settings ? { ...defaultCameraSettings, ...meta.settings } : createCameraSettings(meta.phoneId || cameraId),
    paused: Boolean(meta.paused)
  };
}

function getCameraUrl(cameraId) {
  const camera = cameras.get(cameraId);
  return camera?.obsPath || `/camera.html?camera=${encodeURIComponent(camera?.phoneId || cameraId)}`;
}

async function copyCameraUrl(cameraId, button) {
  const url = new URL(getCameraUrl(cameraId), window.location.origin).toString();
  await navigator.clipboard.writeText(url);
  const original = button.textContent;
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = original;
  }, 1400);
}

function saveHistory(camera) {
  return camera;
}

function removeCamera(cameraId) {
  const camera = cameras.get(cameraId);
  if (camera) {
    saveHistory(camera);
    camera.tile.remove();
    cameras.delete(cameraId);
  }
  const peer = peers.get(cameraId);
  if (peer) {
    peer.close();
    peers.delete(cameraId);
  }
  updateEmptyState();
}

function getOrCreatePeer(phoneSocketId, meta = {}) {
  if (peers.has(phoneSocketId)) return peers.get(phoneSocketId);

  const peer = new RTCPeerConnection(peerConfig);
  peers.set(phoneSocketId, peer);

  peer.ontrack = (event) => {
    const [stream] = event.streams;
    const [track] = stream ? stream.getVideoTracks() : [event.track];
    if (!track) return;

    if (!cameras.has(phoneSocketId)) {
      cameras.set(phoneSocketId, createCameraTile(phoneSocketId, meta, track));
      applyCameraSettings(cameras.get(phoneSocketId));
      selectCamera(phoneSocketId);
    } else {
      const camera = cameras.get(phoneSocketId);
      camera.name = meta.deviceName || camera.name;
      camera.phoneId = meta.phoneId || camera.phoneId;
      camera.savedCameraId = meta.savedCameraId || camera.savedCameraId;
      camera.obsPath = meta.obsPath || camera.obsPath;
      camera.startedAt = Number(meta.startedAt || camera.startedAt);
      camera.resolution = meta.resolution || camera.resolution;
      camera.paused = Boolean(meta.paused);
      camera.settings = meta.settings ? { ...defaultCameraSettings, ...meta.settings } : camera.settings;
      camera.video.srcObject = stream || new MediaStream([track]);
      if (camera.placeholder) camera.placeholder.hidden = true;
      applyCameraSettings(camera);
      camera.video.play().catch(() => undefined);
    }
    if (qrModal.open) qrModal.close();

    updateEmptyState();
  };

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", {
        targetId: phoneSocketId,
        payload: { type: "ice-candidate", candidate: event.candidate }
      });
    }
  };

  peer.onconnectionstatechange = () => {
    const camera = cameras.get(phoneSocketId);
    if (camera) {
      camera.status.textContent = peer.connectionState === "connected" ? "Connected" : peer.connectionState;
      updateDetails();
    }
    if (peer.connectionState === "failed") {
      setStatus("Local connection failed. Check same Wi-Fi.", "warning");
    }
    if (peer.connectionState === "closed") {
      removeCamera(phoneSocketId);
    }
  };

  return peer;
}

async function createQrCode() {
  setStatus("Creating QR code", "idle");
  const response = await fetch("/api/pairing", { method: "POST" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    setStatus(body.error || "Could not create QR code", "warning");
    return;
  }

  const pairing = await response.json();
  qrCode.src = pairing.qrDataUrl;
  phoneLink.href = pairing.phoneUrl;
  expiresText.textContent = `QR expires at ${new Date(pairing.expiresAt).toLocaleTimeString()}.`;
  qrModal.showModal();
  setStatus("Waiting for phone", "idle");
}

async function loadPlan() {
  const response = await fetch("/api/plan");
  if (!response.ok) return;
  const data = await response.json();
  currentPlan = "open-source";
  updateDetails();
}

async function getViewerToken() {
  const response = await fetch("/api/viewer-token", { method: "POST" });
  if (!response.ok) throw new Error("Could not start Studio viewer");
  const data = await response.json();
  return data.token;
}

async function connectViewer() {
  const viewerToken = await getViewerToken();
  socket = io({ auth: { role: "viewer", viewerToken } });

  socket.on("connect", () => {
    setStatus("Ready for local phones", "idle");
    socket.emit("request-phone");
  });

  socket.on("phone-ready", (meta = {}) => {
    setStatus("Phone found. Connecting locally.", "idle");
    upsertPhoneMeta(meta);
    socket.emit("request-phone", { phoneId: meta.phoneId });
  });

  socket.on("phone-meta", (meta = {}) => {
    for (const camera of cameras.values()) {
      if (camera.phoneId === meta.phoneId) {
        camera.name = meta.deviceName || camera.name;
        camera.savedCameraId = meta.savedCameraId || camera.savedCameraId;
        camera.obsPath = meta.obsPath || camera.obsPath;
        camera.resolution = meta.resolution || camera.resolution;        camera.paused = Boolean(meta.paused);
        camera.settings = meta.settings ? { ...defaultCameraSettings, ...meta.settings } : camera.settings;
        camera.startedAt = Number(meta.startedAt || camera.startedAt);
        camera.tile.querySelector(".camera-title strong").textContent = camera.name;
        applyCameraSettings(camera);
      }
    }
    updateDetails();
  });

  socket.on("camera-settings-updated", ({ savedCameraId, settings } = {}) => {
    for (const camera of cameras.values()) {
      if (camera.savedCameraId === savedCameraId) {
        camera.settings = { ...defaultCameraSettings, ...settings };
        applyCameraSettings(camera);
      }
    }
    updateDetails();
  });

  socket.on("camera-obs-url-regenerated", ({ savedCameraId, obsPath } = {}) => {
    for (const camera of cameras.values()) {
      if (camera.savedCameraId === savedCameraId) {
        camera.obsPath = obsPath || camera.obsPath;
      }
    }
    renderPhonesList();
  });

  socket.on("signal", async ({ fromId, payload }) => {
    if (payload.type === "offer") {
      const peer = getOrCreatePeer(fromId, payload);
      await peer.setRemoteDescription(new RTCSessionDescription(payload.description));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("signal", {
        targetId: fromId,
        payload: { type: "answer", description: peer.localDescription, phoneId: payload.phoneId }
      });
      return;
    }

    const peer = peers.get(fromId);
    if (!peer) return;
    if (payload.type === "ice-candidate") {
      await peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
    }
  });

  socket.on("peer-left", ({ socketId, role }) => {
    if (role === "phone") removeCamera(socketId);
  });

  socket.on("connect_error", (error) => {
    setStatus(error.message || "Connection error", "warning");
  });
}

function openGuide(kind) {
  const guide = guides[kind] || guides.obs;
  guideTitle.textContent = guide.title;
  guideSteps.innerHTML = "";
  for (const step of guide.steps) {
    const li = document.createElement("li");
    li.textContent = step;
    guideSteps.append(li);
  }
  guideModal.showModal();
}

async function openHistory(options = {}) {
  const target = options.inline ? historyPageList : historyList;
  if (!target) return;
  target.innerHTML = "<p class=\"hint\">Loading sessions...</p>";
  if (!options.inline) historyModal.showModal();
  const response = await fetch("/api/history-sessions");
  if (!response.ok) {
    target.innerHTML = "<p class=\"hint\">Could not load history.</p>";
    return;
  }

  const { sessions } = await response.json();
  if (!sessions.length) {
    target.innerHTML = "<p class=\"hint\">No saved sessions yet.</p>";
    return;
  }

  target.innerHTML = "";
  for (const session of sessions) {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = "<strong></strong><div class=\"history-meta\"><span></span><span></span><span></span></div>";
    const resolution = session.resolution || {};
    item.querySelector("strong").textContent = session.deviceName || "Phone camera";
    const spans = item.querySelectorAll("span");
    spans[0].textContent = `Started ${new Date(session.startedAt).toLocaleString()}`;
    spans[1].textContent = `Runtime ${formatDuration(session.durationSeconds)}`;
    spans[2].textContent = `Resolution ${formatResolution(resolution.width, resolution.height)}`;
    target.append(item);
  }
}

function updateRangeLabels() {
  if (brightnessValue) brightnessValue.textContent = `${brightnessRange.value}%`;
  if (contrastValue) contrastValue.textContent = `${contrastRange.value}%`;
  if (saturationValue) saturationValue.textContent = `${saturationRange.value}%`;
  if (grayscaleValue) grayscaleValue.textContent = `${grayscaleRange.value}%`;
}

function openCameraSettings(cameraId) {
  const camera = cameras.get(cameraId);
  if (!camera || !cameraSettingsModal) return;
  editingCameraId = cameraId;
  const settings = camera.settings || { ...defaultCameraSettings };
  cameraSettingsTitle.textContent = `${camera.name} output controls`;
  cameraOrientation.value = settings.orientation || "portrait";
  cameraFit.value = settings.fit || "contain";
  cameraRotation.value = String(Number(settings.rotation || 0));
  brightnessRange.value = String(clampPercent(settings.brightness, 100));
  contrastRange.value = String(clampPercent(settings.contrast, 100));
  saturationRange.value = String(clampPercent(settings.saturation, 100));
  grayscaleRange.value = String(clampPercent(settings.grayscale, 0));
  updateRangeLabels();
  syncCameraControls();
  cameraSettingsModal.showModal();
}

function updateCameraSetting(key, value) {
  const camera = cameras.get(editingCameraId);
  if (!camera) return;
  const nextValue = key === "orientation" || key === "fit" ? value : Number(value);
  camera.settings = {
    ...(camera.settings || defaultCameraSettings),
    [key]: nextValue
  };
  if (key === "orientation" && nextValue === "portrait") {
    camera.settings.fit = "contain";
    cameraFit.value = "contain";
  }
  saveCameraSettings(camera);
  applyCameraSettings(camera);
  saveCameraSettingsToServer(camera).catch(() => setStatus("Could not save camera controls", "warning"));
  syncCameraControls();
  renderPhonesList();
}

async function regenerateObsUrl() {
  const camera = cameras.get(editingCameraId);
  if (!camera?.savedCameraId || !regenerateObsUrlButton) return;
  const original = regenerateObsUrlButton.textContent;
  regenerateObsUrlButton.disabled = true;
  regenerateObsUrlButton.textContent = "Regenerating";
  try {
    const response = await fetch("/api/saved-camera-obs-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ savedCameraId: camera.savedCameraId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not regenerate OBS URL");
    camera.obsPath = data.obsPath;
    regenerateObsUrlButton.textContent = "New URL ready";
    renderPhonesList();
  } catch (error) {
    setStatus(error.message || "Could not regenerate OBS URL", "warning");
    regenerateObsUrlButton.textContent = original;
  } finally {
    window.setTimeout(() => {
      regenerateObsUrlButton.disabled = false;
      regenerateObsUrlButton.textContent = original;
    }, 1400);
  }
}

async function copyEditingObsUrl() {
  if (!editingCameraId || !copyObsUrlButton) return;
  await copyCameraUrl(editingCameraId, copyObsUrlButton);
}

function syncCameraControls() {
  const isPortrait = cameraOrientation?.value === "portrait";
  if (cameraFit) {
    cameraFit.disabled = isPortrait;
    if (isPortrait) cameraFit.value = "contain";
  }
}

newQrButton.addEventListener("click", createQrCode);
closeQrModal.addEventListener("click", () => qrModal.close());
closeGuideModal.addEventListener("click", () => guideModal.close());
closeHistoryModal.addEventListener("click", () => historyModal.close());
historyLink.addEventListener("click", (event) => {
  if (historyLink.getAttribute("href") === "#") {
    event.preventDefault();
    openHistory();
  }
});
document.querySelectorAll("[data-guide]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    openGuide(button.dataset.guide);
  });
});
document.addEventListener("click", (event) => {
  const controlsButton = event.target.closest("[data-camera-controls]");
  if (controlsButton) {
    event.preventDefault();
    event.stopPropagation();
    openCameraSettings(controlsButton.dataset.cameraControls);
    return;
  }

  const pauseButton = event.target.closest("[data-pause-camera]");
  if (pauseButton) {
    event.preventDefault();
    event.stopPropagation();
    toggleCameraPause(pauseButton.dataset.pauseCamera, pauseButton);
    return;
  }

  const walletButton = event.target.closest("[data-copy-wallet]");
  if (walletButton) {
    event.preventDefault();
    navigator.clipboard.writeText(walletButton.dataset.copyWallet || walletButton.textContent.trim()).then(() => {
      const original = walletButton.textContent;
      walletButton.textContent = "Wallet copied";
      window.setTimeout(() => {
        walletButton.textContent = original;
      }, 1400);
    });
    return;
  }

});

closeCameraSettingsModal?.addEventListener("click", () => cameraSettingsModal.close());
copyObsUrlButton?.addEventListener("click", copyEditingObsUrl);
regenerateObsUrlButton?.addEventListener("click", regenerateObsUrl);
cameraOrientation?.addEventListener("change", () => updateCameraSetting("orientation", cameraOrientation.value));
cameraFit?.addEventListener("change", () => {
  if (cameraOrientation.value === "portrait") {
    cameraFit.value = "contain";
    return;
  }
  updateCameraSetting("fit", cameraFit.value);
});
cameraRotation?.addEventListener("change", () => updateCameraSetting("rotation", cameraRotation.value));
brightnessRange?.addEventListener("input", () => {
  updateRangeLabels();
  updateCameraSetting("brightness", brightnessRange.value);
});
contrastRange?.addEventListener("input", () => {
  updateRangeLabels();
  updateCameraSetting("contrast", contrastRange.value);
});
saturationRange?.addEventListener("input", () => {
  updateRangeLabels();
  updateCameraSetting("saturation", saturationRange.value);
});
grayscaleRange?.addEventListener("input", () => {
  updateRangeLabels();
  updateCameraSetting("grayscale", grayscaleRange.value);
});
setInterval(updateDetails, 1000);

updateYearRanges();
activatePage();
loadPlan()
  .then(connectViewer)
  .catch((error) => setStatus(error.message || "Connection error", "warning"));









