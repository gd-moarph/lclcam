const localVideo = document.getElementById("localVideo");
const startButton = document.getElementById("startButton");
const switchButton = document.getElementById("switchButton");
const endButton = document.getElementById("endButton");
const previewToggle = document.getElementById("previewToggle");
const phoneStatus = document.getElementById("phoneStatus");
const deviceNameInput = document.getElementById("deviceName");
const qualitySelect = document.getElementById("qualitySelect");
const fpsSelect = document.getElementById("fpsSelect");
const detectCapabilitiesButton = document.getElementById("detectCapabilitiesButton");
const capabilityStatus = document.getElementById("capabilityStatus");

const token = new URLSearchParams(window.location.search).get("token");
const peerConfig = {
  iceServers: [],
  iceTransportPolicy: "all"
};
const peers = new Map();
const viewerCameraKeys = new Map();
const pendingViewers = new Set();
const phoneKeyStorageKey = "lclcam-phone-key";
let socket;
let localStream;
let facingMode = "environment";
let previewVisible = false;
let verifiedCapabilityMap = null;

const qualityProfiles = {
  "720p": { label: "720p", width: 1280, height: 720, shortSide: 720 },
  "1080p": { label: "1080p", width: 1920, height: 1080, shortSide: 1080 },
  "1440p": { label: "1440p", width: 2560, height: 1440, shortSide: 1440 },
  "4k": { label: "4K", width: 3840, height: 2160, shortSide: 2160 }
};

deviceNameInput.value = localStorage.getItem("phonecamera-device-name") || "";
qualitySelect.value = localStorage.getItem("phonecamera-quality") || "1080p";
fpsSelect.value = localStorage.getItem("phonecamera-fps") || "30";
localVideo.hidden = true;

function getPhoneKey() {
  let phoneKey = localStorage.getItem(phoneKeyStorageKey);
  if (!phoneKey) {
    phoneKey = `phone_${crypto.randomUUID().replace(/-/g, "")}`;
    localStorage.setItem(phoneKeyStorageKey, phoneKey);
  }
  return phoneKey;
}

function setPhoneStatus(text) {
  phoneStatus.textContent = text;
}

function getCameraApi() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is blocked because this page is not opened from a trusted HTTPS browser page. Open LCLCam through the Cloudflare Tunnel HTTPS URL, create a new QR code there, then scan the new QR code.");
  }
  return navigator.mediaDevices;
}

function getDeviceName() {
  return deviceNameInput.value.trim() || "Phone camera";
}

function getResolution() {
  const track = localStream?.getVideoTracks()[0];
  const settings = track?.getSettings?.() || {};
  return {
    width: settings.width || localVideo.videoWidth || 0,
    height: settings.height || localVideo.videoHeight || 0,
    frameRate: settings.frameRate || 0
  };
}

function formatActualQuality(resolution) {
  if (!resolution.width || !resolution.height) return "selected quality";
  const fps = resolution.frameRate ? ` at ${Math.round(resolution.frameRate)} FPS` : "";
  return `${resolution.width} x ${resolution.height}${fps}`;
}

function getVideoConstraints() {
  const quality = qualitySelect.value || "1080p";
  const fps = Number(fpsSelect.value || 30);
  const size = qualityProfiles[quality] || qualityProfiles["1080p"];

  localStorage.setItem("phonecamera-quality", quality);
  localStorage.setItem("phonecamera-fps", String(fps));

  return {
    facingMode,
    width: { ideal: size.width },
    height: { ideal: size.height },
    frameRate: { ideal: fps, max: fps }
  };
}

function setCapabilityStatus(text) {
  if (capabilityStatus) capabilityStatus.textContent = text;
}

function replaceSelectOptions(select, options, fallbackValue) {
  const previous = select.value || fallbackValue;
  select.innerHTML = "";
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  }
  select.value = options.some((option) => option.value === previous) ? previous : options[0]?.value || fallbackValue;
}

function updateFpsOptionsForQuality() {
  if (!verifiedCapabilityMap) return;
  const profileFps = verifiedCapabilityMap.get(qualitySelect.value) || verifiedCapabilityMap.values().next().value || new Set(["30"]);
  replaceSelectOptions(
    fpsSelect,
    [...profileFps].sort((a, b) => Number(a) - Number(b)).map((value) => ({ value, label: `${value} FPS` })),
    "30"
  );
}

function isProfileDelivered(profile, settings, fps) {
  const width = Number(settings.width || 0);
  const height = Number(settings.height || 0);
  const deliveredShortSide = Math.min(width, height);
  const deliveredFps = Number(settings.frameRate || 0);
  const resolutionOk = deliveredShortSide >= profile.shortSide * 0.95;
  const fpsOk = fps <= 30 || deliveredFps >= fps * 0.85;
  return resolutionOk && fpsOk;
}

async function probeProfile(profileKey, fps) {
  const profile = qualityProfiles[profileKey];
  const stream = await getCameraApi().getUserMedia({
    audio: false,
    video: {
      facingMode,
      width: { exact: profile.width },
      height: { exact: profile.height },
      frameRate: { ideal: fps, max: fps }
    }
  });
  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings?.() || {};
  stream.getTracks().forEach((trackItem) => trackItem.stop());
  return isProfileDelivered(profile, settings, fps);
}

async function detectCameraCapabilities() {
  detectCapabilitiesButton.disabled = true;
  setCapabilityStatus("Testing camera modes on this phone...");
  const verifiedProfiles = [];
  const nextCapabilityMap = new Map();
  const profileKeys = Object.keys(qualityProfiles);

  for (const profileKey of profileKeys) {
    for (const fps of [30, 60]) {
      try {
        setCapabilityStatus(`Testing ${qualityProfiles[profileKey].label} at ${fps} FPS...`);
        const supported = await probeProfile(profileKey, fps);
        if (supported) {
          verifiedProfiles.push(profileKey);
          if (!nextCapabilityMap.has(profileKey)) nextCapabilityMap.set(profileKey, new Set());
          nextCapabilityMap.get(profileKey).add(String(fps));
        }
      } catch {
        // Unsupported modes are expected on many phones and browsers.
      }
    }
  }

  const uniqueProfiles = [...new Set(verifiedProfiles)];
  if (uniqueProfiles.length) {
    verifiedCapabilityMap = nextCapabilityMap;
    replaceSelectOptions(
      qualitySelect,
      uniqueProfiles.map((value) => ({ value, label: qualityProfiles[value].label })),
      "1080p"
    );
    updateFpsOptionsForQuality();
    setCapabilityStatus(`Verified ${uniqueProfiles.map((value) => qualityProfiles[value].label).join(", ")} on this browser. Actual stream quality is shown after Start stream.`);
  } else {
    verifiedCapabilityMap = null;
    setCapabilityStatus("Could not verify advanced modes. The browser will use the closest available camera quality.");
  }

  detectCapabilitiesButton.disabled = false;
}

function emitMeta() {
  if (!socket?.connected) return;
  socket.emit("phone-meta", {
    deviceName: getDeviceName(),
    resolution: getResolution()
  });
}

async function startCamera() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }

  localStorage.setItem("phonecamera-device-name", getDeviceName());
  localStream = await getCameraApi().getUserMedia({
    audio: false,
    video: getVideoConstraints()
  });
  localVideo.srcObject = localStream;
  localVideo.onloadedmetadata = () => {
    const resolution = getResolution();
    setPhoneStatus(`Camera ready at ${formatActualQuality(resolution)}. Waiting for desktop.`);
    emitMeta();
  };
  localVideo.play().catch(() => undefined);
  setPhoneStatus("Camera ready. Waiting for desktop.");
  emitMeta();
}

async function replaceTracksForViewers() {
  const [videoTrack] = localStream.getVideoTracks();
  for (const peer of peers.values()) {
    const sender = peer.getSenders().find((item) => item.track?.kind === "video");
    if (sender && videoTrack) {
      await sender.replaceTrack(videoTrack);
    }
  }
  emitMeta();
}

function closePeer(viewerSocketId) {
  const peer = peers.get(viewerSocketId);
  if (peer) {
    peer.close();
    peers.delete(viewerSocketId);
  }
}

function createPeer(viewerSocketId) {
  closePeer(viewerSocketId);
  const peer = new RTCPeerConnection(peerConfig);
  peers.set(viewerSocketId, peer);

  localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", {
        targetId: viewerSocketId,
        payload: { type: "ice-candidate", candidate: event.candidate }
      });
    }
  };

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected") {
      setPhoneStatus("Streaming locally to desktop.");
    }

    if (peer.connectionState === "connecting") {
      setPhoneStatus("Reconnecting camera stream.");
    }

    if (peer.connectionState === "failed") {
      setPhoneStatus("Local connection failed. Check same Wi-Fi.");
    }
  };

  return peer;
}

async function sendOffer(viewerSocketId) {
  if (!localStream) {
    pendingViewers.add(viewerSocketId);
    setPhoneStatus("Desktop is waiting. Tap Start stream.");
    return;
  }

  const peer = createPeer(viewerSocketId);
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  socket.emit("signal", {
    targetId: viewerSocketId,
      payload: {
        type: "offer",
        description: peer.localDescription,
        deviceName: getDeviceName(),
        cameraKey: viewerCameraKeys.get(viewerSocketId)
      }
  });
}

function connectSocket() {
  if (!token) {
    setPhoneStatus("Missing pairing token.");
    return;
  }

  socket = io({
    auth: {
      role: "phone",
      token,
      deviceName: getDeviceName(),
      phoneKey: getPhoneKey()
    }
  });

  socket.on("connect", () => {
    setPhoneStatus("Paired. Starting camera.");
  });

  socket.on("phone-accepted", () => {
    setPhoneStatus("Connected to Studio. Keep this page open.");
    emitMeta();
  });

  socket.on("viewer-ready", async ({ viewerSocketId } = {}) => {
    if (!viewerSocketId) return;
    try {
      await sendOffer(viewerSocketId);
    } catch (error) {
      setPhoneStatus(error.message || "Could not start local stream.");
    }
  });

  socket.on("signal", async ({ fromId, payload }) => {
    const peer = peers.get(fromId);
    if (!peer) return;

    if (payload.type === "answer") {
      if (payload.cameraKey) {
        viewerCameraKeys.set(fromId, payload.cameraKey);
      }
      await peer.setRemoteDescription(new RTCSessionDescription(payload.description));
      return;
    }

    if (payload.type === "ice-candidate") {
      await peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
    }
  });

  socket.on("set-paused", ({ paused } = {}) => {
    const [track] = localStream?.getVideoTracks?.() || [];
    if (track) track.enabled = !paused;
    setPhoneStatus(paused ? "Camera hidden. Stream remains connected." : "Streaming locally to desktop.");
  });
  socket.on("peer-left", ({ socketId }) => {
    closePeer(socketId);
  });

  socket.on("connect_error", (error) => {
    setPhoneStatus(error.message || "Pairing failed.");
  });
}

startButton.addEventListener("click", async () => {
  try {
    await startCamera();
    await replaceTracksForViewers();
    for (const viewerSocketId of [...pendingViewers]) {
      pendingViewers.delete(viewerSocketId);
      await sendOffer(viewerSocketId);
    }
  } catch (error) {
    setPhoneStatus(error.message || "Camera permission was denied.");
  }
});

endButton.addEventListener("click", () => {
  for (const viewerSocketId of [...peers.keys()]) closePeer(viewerSocketId);
  pendingViewers.clear();
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  setPhoneStatus("Stream ended.");
});

switchButton.addEventListener("click", async () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  try {
    await startCamera();
    await replaceTracksForViewers();
  } catch (error) {
    setPhoneStatus(error.message || "Could not switch camera.");
  }
});

previewToggle.addEventListener("click", () => {
  previewVisible = !previewVisible;
  localVideo.hidden = !previewVisible;
  previewToggle.textContent = previewVisible ? "Hide preview" : "See preview";
});

deviceNameInput.addEventListener("change", () => {
  localStorage.setItem("phonecamera-device-name", getDeviceName());
  emitMeta();
});

async function restartWithSelectedQuality() {
  if (!localStream) return;
  try {
    await startCamera();
    await replaceTracksForViewers();
  } catch (error) {
    setPhoneStatus(error.message || "Could not apply camera quality.");
  }
}

qualitySelect.addEventListener("change", () => {
  updateFpsOptionsForQuality();
  restartWithSelectedQuality();
});
fpsSelect.addEventListener("change", restartWithSelectedQuality);
detectCapabilitiesButton.addEventListener("click", detectCameraCapabilities);

connectSocket();
