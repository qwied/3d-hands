import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { Muxer, ArrayBufferTarget } from 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm';
import { GIFEncoder, quantize, applyPalette } from 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm';

const HAND_L = 'assets/hand-left.png';
const HAND_R = 'assets/hand-right.png';

// Output size keeps the source video's 640:336 frame.
const W = 1280, H = 672;
const PERIOD = 6;          // seconds per full turn — constant speed
const SLICES = 72;         // layers that build the extruded depth
const MEDIA_SIZE = 1.0;    // world units (frame is 6.4 × 3.36)

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
const CAM_Z = 10;
const camera = new THREE.PerspectiveCamera(2 * Math.atan(1.68 / CAM_Z) * 180 / Math.PI, W / H, 0.1, 100);
camera.position.z = CAM_Z;

const loader = new THREE.TextureLoader();
function handPlane(src, w, h, x, y) {
  const tex = loader.load(src);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.position.set(x, y, 0);
  m.renderOrder = -1;
  scene.add(m);
}
// Pixel boxes from the source frame, 100 px = 1 unit.
handPlane(HAND_L, 2.56, 0.80, -3.2 + 1.28, 1.68 - 1.68);
handPlane(HAND_R, 2.56, 0.94, -3.2 + 5.12, 1.68 - 1.69);

const pivot = new THREE.Group();
scene.add(pivot);
const sideMat = new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide });
const faceMat = new THREE.MeshBasicMaterial({ alphaTest: 0.5 });

let mediaTex = null, mediaVideo = null, mediaUrl = null;

function buildMedia(tex, aspect) {
  pivot.clear();
  if (mediaTex) mediaTex.dispose();
  mediaTex = tex;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  faceMat.map = tex; sideMat.map = tex;
  faceMat.needsUpdate = sideMat.needsUpdate = true;

  const w = aspect >= 1 ? MEDIA_SIZE : MEDIA_SIZE * aspect;
  const h = aspect >= 1 ? MEDIA_SIZE / aspect : MEDIA_SIZE;
  const depth = 0.3 * Math.max(w, h);
  const geo = new THREE.PlaneGeometry(w, h);
  for (let i = 0; i < SLICES; i++) {
    const edge = i === 0 || i === SLICES - 1;
    const m = new THREE.Mesh(geo, edge ? faceMat : sideMat);
    m.position.z = -depth / 2 + depth * i / (SLICES - 1);
    // Back face turned around so the picture reads the right way from behind too.
    if (i === 0) m.rotation.y = Math.PI;
    pivot.add(m);
  }
}

// Placeholder shown until something is attached.
function placeholderTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = 46;
  g.beginPath(); g.arc(256, 256, 200, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 56;
  g.beginPath(); g.moveTo(256, 150); g.lineTo(256, 362); g.moveTo(150, 256); g.lineTo(362, 256); g.stroke();
  return new THREE.CanvasTexture(c);
}
buildMedia(placeholderTexture(), 1);

function renderAt(t) {
  const a = (t / PERIOD) * Math.PI * 2;
  pivot.rotation.y = a;
  // Sides catch more light the more they face the camera.
  const s = 0.42 + 0.38 * Math.abs(Math.sin(a));
  sideMat.color.setRGB(s, s, s);
  renderer.render(scene, camera);
}

let exporting = false;
const t0 = performance.now();
(function loop() {
  if (!exporting) renderAt((performance.now() - t0) / 1000);
  requestAnimationFrame(loop);
})();

// ---------- Attaching media ----------
const note = document.getElementById('note');
const downloads = document.getElementById('downloads');

async function attach(file) {
  if (!file) return;
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) { note.textContent = 'Нужна картинка или видео'; return; }
  if (mediaVideo) { mediaVideo.pause(); mediaVideo = null; }
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = URL.createObjectURL(file);
  note.textContent = '';
  try {
    if (isImage) {
      const img = new Image();
      img.src = mediaUrl;
      await img.decode();
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      buildMedia(tex, img.naturalWidth / img.naturalHeight);
    } else {
      const v = document.createElement('video');
      v.src = mediaUrl; v.muted = true; v.loop = true; v.playsInline = true;
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; });
      await v.play().catch(() => {});
      mediaVideo = v;
      buildMedia(new THREE.VideoTexture(v), v.videoWidth / v.videoHeight);
    }
    downloads.classList.add('on');
  } catch (e) {
    note.textContent = 'Не удалось открыть этот файл';
  }
}

const fileInput = document.getElementById('file');
fileInput.addEventListener('change', () => { attach(fileInput.files[0]); fileInput.value = ''; });
stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('drag'); });
stage.addEventListener('dragleave', () => stage.classList.remove('drag'));
stage.addEventListener('drop', e => { e.preventDefault(); stage.classList.remove('drag'); attach(e.dataTransfer.files[0]); });

// ---------- Export ----------
const busy = document.getElementById('busy');
const busyLabel = document.getElementById('busyLabel');
const barFill = document.getElementById('barFill');
const btnMp4 = document.getElementById('dlMp4');
const btnGif = document.getElementById('dlGif');

async function prepareFrame(t) {
  if (mediaVideo && mediaVideo.duration) {
    mediaVideo.currentTime = t % mediaVideo.duration;
    await new Promise(r => mediaVideo.addEventListener('seeked', r, { once: true }));
    mediaTex.needsUpdate = true;
  }
  renderAt(t);
}

async function runExport(label, fn) {
  exporting = true;
  btnMp4.disabled = btnGif.disabled = true;
  if (mediaVideo) mediaVideo.pause();
  busyLabel.textContent = label; barFill.style.width = '0%'; busy.classList.add('on');
  note.textContent = '';
  try { await fn(p => { barFill.style.width = (p * 100).toFixed(1) + '%'; }); }
  catch (e) { console.error(e); note.textContent = 'Ошибка экспорта: ' + (e.message || e); }
  busy.classList.remove('on');
  btnMp4.disabled = btnGif.disabled = false;
  if (mediaVideo) mediaVideo.play().catch(() => {});
  exporting = false;
}

function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

const tick = () => new Promise(r => setTimeout(r, 0));

async function pickCodec() {
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.42001f']) {
    const cfg = { codec, width: W, height: H, bitrate: 10_000_000, framerate: 30 };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch {}
  }
  return null;
}

btnMp4.addEventListener('click', () => runExport('Рендер MP4…', async progress => {
  const FPS = 30, TURNS = 2, N = FPS * PERIOD * TURNS;
  const cfg = typeof VideoEncoder !== 'undefined' ? await pickCodec() : null;
  if (!cfg) throw new Error('браузер не умеет кодировать MP4 — откройте сайт в Chrome или Edge');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' });
  let encErr = null;
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { encErr = e; } });
  enc.configure(cfg);
  for (let i = 0; i < N; i++) {
    if (encErr) throw encErr;
    await prepareFrame(i / FPS);
    const frame = new VideoFrame(renderer.domElement, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    enc.encode(frame, { keyFrame: i % FPS === 0 });
    frame.close();
    while (enc.encodeQueueSize > 8) await tick();
    progress((i + 1) / N);
    if (i % 4 === 0) await tick();
  }
  await enc.flush();
  muxer.finalize();
  save(new Blob([muxer.target.buffer], { type: 'video/mp4' }), 'creation-3d.mp4');
}));

btnGif.addEventListener('click', () => runExport('Рендер GIF…', async progress => {
  const FPS = 20, N = FPS * PERIOD, GW = 640, GH = 336;
  const c = document.createElement('canvas'); c.width = GW; c.height = GH;
  const g = c.getContext('2d', { willReadFrequently: true });
  const gif = GIFEncoder();
  for (let i = 0; i < N; i++) {
    await prepareFrame(i / FPS);
    g.drawImage(renderer.domElement, 0, 0, GW, GH);
    const { data } = g.getImageData(0, 0, GW, GH);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), GW, GH, { palette, delay: 1000 / FPS });
    progress((i + 1) / N);
    await tick();
  }
  gif.finish();
  save(new Blob([gif.bytes()], { type: 'image/gif' }), 'creation-3d.gif');
}));
