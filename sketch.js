// ─── Config ───────────────────────────────────────────────────────────────────
const WEBCAM_SCALE      = 0.6;   // processing resolution as fraction of screen (CSS stretches to fullscreen)
const PLAYBACK_RATE     = 1.0;   // video speed (0.5 = half, 2.0 = double)
const VIGNETTE_STRENGTH = 0.6; // vignette edge darkening (0 = off, higher = stronger)

// ─── Dynamic webcam dimensions ────────────────────────────────────────────────
let WEBCAM_W = Math.round(window.innerWidth  * WEBCAM_SCALE);
let WEBCAM_H = Math.round(window.innerHeight * WEBCAM_SCALE);

// ─── State ────────────────────────────────────────────────────────────────────
let capture;
let bodyPose;
let poses = [];

let currentMaskIndex  = 0;
let maskIsPlaying     = false;
let prevObserverCount = -1;    // triggers next video when observer count changes

const maskVideos = [
  document.getElementById('mask1'),
  document.getElementById('mask2'),
  document.getElementById('mask3'),
];

const webcamContainer    = document.getElementById('webcam-container');
const webcamCanvas       = document.getElementById('webcam-canvas');
const webcamCtx          = webcamCanvas.getContext('2d');
const detectionCanvas    = document.getElementById('detection-overlay');
const detectionCtx       = detectionCanvas.getContext('2d');

const offscreen = document.createElement('canvas');
const offCtx    = offscreen.getContext('2d', { willReadFrequently: true });

function applyCanvasSize() {
  webcamCanvas.width      = WEBCAM_W;
  webcamCanvas.height     = WEBCAM_H;
  offscreen.width         = WEBCAM_W;
  offscreen.height        = WEBCAM_H;
  detectionCanvas.width   = window.innerWidth;
  detectionCanvas.height  = window.innerHeight;
}

// ─── Mask video setup ─────────────────────────────────────────────────────────

// Show first frame of mask1 on load
maskVideos[0].addEventListener('loadeddata', () => {
  maskVideos[0].currentTime = 0;
  maskVideos[0].pause();
}, { once: true });

// When a video finishes, allow next trigger
maskVideos.forEach(v => {
  v.addEventListener('ended', () => {
    maskIsPlaying = false;
  });
});

// ─── p5 sketch ────────────────────────────────────────────────────────────────
new p5(function (p) {

  p.setup = function () {
    let canvas = p.createCanvas(1, 1);
    canvas.hide();

    applyCanvasSize();

    capture = p.createCapture(p.VIDEO, { flipped: true });
    capture.size(WEBCAM_W, WEBCAM_H);
    capture.hide();

    showMask(0);
    setStatus('Loading model…');

    bodyPose = ml5.bodyPose('MoveNet', { flipped: true }, () => {
      setStatus('Ready — show yourself');
      bodyPose.detectStart(capture, onPoses);
    });
  };

  p.draw = function () {
    drawWebcamPreview();
    drawDetectionOverlay();
  };

  p.windowResized = function () {
    WEBCAM_W = Math.round(window.innerWidth  * WEBCAM_SCALE);
    WEBCAM_H = Math.round(window.innerHeight * WEBCAM_SCALE);
    applyCanvasSize();
    if (capture) capture.size(WEBCAM_W, WEBCAM_H);
  };

});

// ─── Pose callback ────────────────────────────────────────────────────────────
const OBSERVER_MESSAGES = {
  0: "When i'm alone",
  1: "When I'm with my lover",
  2: "When i'm with my besties",
  3: "When i'm with my client",
};

function onPoses(results) {
  poses = results;
  const count = poses.length;

  webcamContainer.classList.toggle('detected', count > 0);

  if (count !== prevObserverCount) {
    prevObserverCount = count;
    tryAdvanceMask();
  }

  updateBottomBar(count);
}

function updateBottomBar(count) {
  const leftEl  = document.getElementById('bottom-left');
  const rightEl = document.getElementById('bottom-right');

  if (count === 0) {
    leftEl.textContent = '—';
  } else {
    leftEl.innerHTML = Array.from({ length: count }, (_, i) =>
      `<span>Observer ${i + 1}</span>`
    ).join('');
  }

  rightEl.textContent = OBSERVER_MESSAGES[Math.min(count, 3)] ?? '';
}

// ─── Mask video control ───────────────────────────────────────────────────────
function showMask(index) {
  maskVideos.forEach((v, i) => {
    v.classList.toggle('active', i === index);
    if (i !== index) v.pause();
  });
}

function tryAdvanceMask() {
  if (maskIsPlaying) return;

  currentMaskIndex = (currentMaskIndex + 1) % maskVideos.length;
  maskIsPlaying = true;

  const v = maskVideos[currentMaskIndex];
  v.playbackRate = PLAYBACK_RATE;

  // Seek to frame 0 while still hidden, show + play only after seek is ready
  const startPlay = () => {
    showMask(currentMaskIndex);
    v.play().catch(() => {});
    setStatus(`Playing mask ${currentMaskIndex + 1}`);
  };

  if (v.currentTime === 0) {
    startPlay();
  } else {
    v.addEventListener('seeked', startPlay, { once: true });
    v.currentTime = 0;
  }
}

// ─── Webcam preview draw — grayscale invert + vignette ───────────────────────
function drawWebcamPreview() {
  if (!capture || !capture.elt) return;

  // Draw mirrored frame to offscreen — cover crop to preserve aspect ratio
  const srcW = capture.elt.videoWidth  || WEBCAM_W;
  const srcH = capture.elt.videoHeight || WEBCAM_H;
  const srcAspect = srcW / srcH;
  const dstAspect = WEBCAM_W / WEBCAM_H;
  let sx, sy, sw, sh;
  if (srcAspect > dstAspect) {
    sh = srcH; sw = srcH * dstAspect; sx = (srcW - sw) / 2; sy = 0;
  } else {
    sw = srcW; sh = srcW / dstAspect; sx = 0; sy = (srcH - sh) / 2;
  }
  offCtx.save();
  offCtx.scale(-1, 1);
  offCtx.drawImage(capture.elt, sx, sy, sw, sh, -WEBCAM_W, 0, WEBCAM_W, WEBCAM_H);
  offCtx.restore();

  const id = offCtx.getImageData(0, 0, WEBCAM_W, WEBCAM_H);
  const px = id.data;
  const cx = WEBCAM_W / 2;
  const cy = WEBCAM_H / 2;

  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;

    const idx = i >> 2;
    const dx = ((idx % WEBCAM_W) - cx) / cx;
    const dy = ((idx / WEBCAM_W | 0) - cy) / cy;
    const vignette = Math.max(0, 1 - (dx * dx + dy * dy) * VIGNETTE_STRENGTH);
    const gv = (g * vignette) | 0;

    px[i] = px[i + 1] = px[i + 2] = gv;
  }

  webcamCtx.putImageData(id, 0, 0);
}

// ─── Detection overlay — bounding boxes + labels ─────────────────────────────
const FACE_KPS = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear'];

function drawDetectionOverlay() {
  const W = detectionCanvas.width;
  const H = detectionCanvas.height;
  detectionCtx.clearRect(0, 0, W, H);
  if (!poses.length) return;

  const scaleX = W / WEBCAM_W;
  const scaleY = H / WEBCAM_H;

  poses.forEach((pose, i) => {
    const pts = pose.keypoints.filter(k => FACE_KPS.includes(k.name) && k.confidence > 0.25);
    if (pts.length < 2) return;

    const xs = pts.map(k => k.x * scaleX);
    const ys = pts.map(k => k.y * scaleY);
    const x1 = Math.min(...xs);
    const y1 = Math.min(...ys);
    const x2 = Math.max(...xs);
    const y2 = Math.max(...ys);

    // Expand box around face
    const padX = (x2 - x1) * 0.2;
    const padY = (y2 - y1) * 0.6;
    const rx = x1 - padX;
    const ry = y1 - padY;
    const rw = (x2 - x1) + padX * 2;
    const rh = (y2 - y1) + padY * 2;

    // Box — iOS style rounded rect
    detectionCtx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    detectionCtx.lineWidth = 1;
    detectionCtx.beginPath();
    detectionCtx.roundRect(rx, ry, rw, rh, 10);
    detectionCtx.stroke();

    // Label pill
    const label = `Observer ${i + 1}`;
    detectionCtx.font = '500 12px -apple-system, BlinkMacSystemFont, sans-serif';
    const tw = detectionCtx.measureText(label).width;
    const lw = tw + 20;
    const lh = 26;
    const lx = rx;
    const ly = ry - lh - 6;

    detectionCtx.fillStyle = 'rgba(30, 30, 30, 0.7)';
    detectionCtx.beginPath();
    detectionCtx.roundRect(lx, ly, lw, lh, 8);
    detectionCtx.fill();

    detectionCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    detectionCtx.lineWidth = 1;
    detectionCtx.stroke();

    detectionCtx.fillStyle = '#ffffff';
    detectionCtx.fillText(label, lx + 10, ly + 17);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const statusLog = document.getElementById('status-log');
const LOG_MAX   = 5;

let _lastStatus = '';
function setStatus(msg) {
  if (msg === _lastStatus) return;
  _lastStatus = msg;

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = msg;
  statusLog.appendChild(entry);

  while (statusLog.children.length > LOG_MAX) {
    statusLog.removeChild(statusLog.firstChild);
  }
}
