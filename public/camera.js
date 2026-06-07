const obsVideo = document.getElementById("obsVideo");
const obsPlaceholder = document.getElementById("obsPlaceholder");
const query = new URLSearchParams(window.location.search);
let cameraId = query.get("camera");
const obsSecret = window.location.pathname.startsWith("/o/")
  ? decodeURIComponent(window.location.pathname.replace(/^\/o\//, ""))
  : "";

const peerConfig = {
  iceServers: [],
  iceTransportPolicy: "all"
};
const peers = new Map();
let activePhoneId = null;
let socket;
let outputSettings = {
  orientation: query.get("orientation") === "landscape" ? "landscape" : "portrait",
  fit: query.get("fit") === "cover" ? "cover" : "contain",
  rotation: Number(query.get("rotate") || 0),
  brightness: getPercent("brightness", 100),
  contrast: getPercent("contrast", 100),
  saturation: getPercent("saturation", 100),
  grayscale: getPercent("grayscale", 0)
};

function getPercent(name, fallback) {
  const value = Number(query.get(name));
  return Number.isFinite(value) ? value : fallback;
}

function applyOutputSettings() {
  const safeRotate = Number.isFinite(Number(outputSettings.rotation)) ? Number(outputSettings.rotation) : 0;
  const needsRotatedFill = outputSettings.orientation === "landscape" && outputSettings.fit === "cover" && [90, 270].includes(safeRotate);
  obsVideo.style.objectFit = outputSettings.fit;
  obsVideo.style.transform = `rotate(${safeRotate}deg)${needsRotatedFill ? " scale(1.78)" : ""}`;
  obsVideo.style.filter = [
    `brightness(${outputSettings.brightness}%)`,
    `contrast(${outputSettings.contrast}%)`,
    `saturate(${outputSettings.saturation}%)`,
    `grayscale(${outputSettings.grayscale}%)`
  ].join(" ");
}

function showWaiting() {
  obsPlaceholder.hidden = false;
  obsVideo.srcObject = null;
}

applyOutputSettings();

function closePeer(phoneSocketId) {
  const peer = peers.get(phoneSocketId);
  if (peer) {
    peer.close();
    peers.delete(phoneSocketId);
  }
}

function getOrCreatePeer(phoneSocketId) {
  if (peers.has(phoneSocketId)) return peers.get(phoneSocketId);

  const peer = new RTCPeerConnection(peerConfig);
  peers.set(phoneSocketId, peer);

  peer.ontrack = (event) => {
    if (activePhoneId && activePhoneId !== phoneSocketId) return;

    const [stream] = event.streams;
    activePhoneId = phoneSocketId;
    obsVideo.srcObject = stream || new MediaStream([event.track]);
    obsVideo.play().catch(() => undefined);
    obsPlaceholder.hidden = true;
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
    if (["failed", "closed", "disconnected"].includes(peer.connectionState) && activePhoneId === phoneSocketId) {
      activePhoneId = null;
      showWaiting();
    }
  };

  return peer;
}

async function getViewerToken() {
  const response = await fetch("/api/camera-viewer-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obsSecret ? { obsSecret } : { phoneId: cameraId })
  });
  if (!response.ok) throw new Error("Camera is not online");
  const data = await response.json();
  cameraId = data.phoneId || cameraId;
  if (data.settings) {
    outputSettings = { ...outputSettings, ...data.settings };
    applyOutputSettings();
  }
  return data.token;
}

async function connectCameraView() {
  const viewerToken = await getViewerToken();
  socket = io({ auth: { role: "viewer", viewerToken } });

  socket.on("connect", () => {
    socket.emit("request-phone", { phoneId: cameraId });
  });

  socket.on("phone-ready", (meta = {}) => {
    if (meta.phoneId === cameraId) {
      socket.emit("request-phone", { phoneId: cameraId });
    }
  });

  socket.on("camera-settings-updated", ({ settings } = {}) => {
    if (!settings) return;
    outputSettings = { ...outputSettings, ...settings };
    applyOutputSettings();
  });

  socket.on("signal", async ({ fromId, payload }) => {
    if (cameraId && payload.phoneId !== cameraId) return;

    if (payload.type === "offer") {
      const peer = getOrCreatePeer(fromId);
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

  socket.on("peer-left", ({ socketId, role, phoneId }) => {
    if (role === "phone" && (!cameraId || phoneId === cameraId)) {
      closePeer(socketId);
      if (activePhoneId === socketId) {
        activePhoneId = null;
        showWaiting();
      }
    }
  });
}

connectCameraView().catch(showWaiting);
