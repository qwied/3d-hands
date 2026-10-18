// Classic script + dynamic import(): works on GitHub Pages and when index.html is opened from disk.
(async () => {
const note = document.getElementById('note');
let THREE, Muxer, ArrayBufferTarget, GIFEncoder, quantize, applyPalette;
try {
  [THREE, { Muxer, ArrayBufferTarget }, { GIFEncoder, quantize, applyPalette }] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'),
    import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm'),
    import('https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm'),
  ]);
} catch (e) {
  console.error(e);
  note.textContent = 'Could not load the 3D libraries. Check your internet connection and reload.';
  return;
}

// ---------- Settings ----------
const PERIOD = 6;           // seconds per full turn — constant speed
const MEDIA_SIZE = 1.2;     // max width/height of the media (frame is 6.4 × 3.6)
const MP4_FPS = 30, GIF_FPS = 20;
const AUDIO_RATE = 48000;
const QUALITIES = {         // height → width, 16:9 (widths kept even for H.264)
  144: 256, 240: 426, 360: 640, 480: 854, 720: 1280, 1080: 1920, 1440: 2560, 2160: 3840,
};
const qualityName = h => (h >= 2160 ? '4K' : h + 'p');

// Frame in world units: 6.4 × 3.6 (16:9) at z = 0; 100 px of the original 640-px video = 1 unit.
const FRAME_W = 6.4, FRAME_H = 3.6, CAM_Z = 10;

// ---------- Quality ----------
const qualitySel = document.getElementById('quality');
let quality = 1080;
try { const q = +localStorage.getItem('quality'); if (QUALITIES[q]) quality = q; } catch {}
qualitySel.value = String(quality);
const sizeOf = h => [QUALITIES[h], h];

// ---------- Renderer & scene ----------
const stage = document.getElementById('stage');
let exporting = false;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(1);
stage.prepend(renderer.domElement);
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const maxTex = renderer.capabilities.maxTextureSize;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(2 * Math.atan(FRAME_H / 2 / CAM_Z) * 180 / Math.PI, FRAME_W / FRAME_H, 0.1, 100);
camera.position.z = CAM_Z;

// The preview renders at exactly the chosen quality; CSS scales it to the stage.
function fitPreview() { const [w, h] = sizeOf(quality); renderer.setSize(w, h, false); }
fitPreview();

function updateLabels() {
  for (const el of document.querySelectorAll('[data-q]')) el.textContent = qualityName(quality);
}
updateLabels();
qualitySel.addEventListener('change', () => {
  quality = +qualitySel.value;
  try { localStorage.setItem('quality', quality); } catch {}
  if (!exporting) fitPreview();
  updateLabels();
});

// ---------- Hands (from the original video, smoothed) ----------
function hand(src, w, h, x, y) {
  const img = new Image();
  const tex = new THREE.Texture(img);
  img.onload = () => { tex.needsUpdate = true; };
  img.src = src;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.position.set(x, y, 0);
  m.renderOrder = -1;
  scene.add(m);
}
// Same boxes as in the source video: left x 0–256 / y 128–208, right x 384–640 / y 122–216.
hand(window.HANDS.left, 2.56, 0.80, -3.2 + 1.28, 1.68 - 1.68);
hand(window.HANDS.right, 2.56, 0.94, -3.2 + 5.12, 1.68 - 1.69);

// ---------- Soundtrack (from the reference clip) ----------
const soundBytes = Uint8Array.from(atob(window.SOUNDTRACK), c => c.charCodeAt(0));
const soundEl = new Audio(URL.createObjectURL(new Blob([soundBytes], { type: 'video/mp4' })));
soundEl.loop = true;
let soundBuf = null;
const soundReady = new OfflineAudioContext(1, 1, AUDIO_RATE)
  .decodeAudioData(soundBytes.slice().buffer)
  .then(b => { soundBuf = b; })
  .catch(e => console.error('soundtrack', e));
const soundBtn = document.getElementById('sound');
let soundOn = true;
function syncSound() {
  soundBtn.classList.toggle('muted', !soundOn);
  if (soundOn && !exporting) soundEl.play().catch(() => {}); else soundEl.pause();
}
soundBtn.addEventListener('click', () => { soundOn = !soundOn; syncSound(); });

// ---------- Media object ----------
const pivot = new THREE.Group();
scene.add(pivot);
const faceMat = new THREE.MeshBasicMaterial();
const sideMat = new THREE.MeshBasicMaterial();     // left/right sides
const capMat = new THREE.MeshBasicMaterial();      // top/bottom sides
let mediaTex = null, mediaVideo = null, mediaUrl = null;

function setMap(tex, alpha) {
  for (const m of [faceMat, sideMat, capMat]) {
    m.map = tex;
    m.alphaTest = alpha ? 0.5 : 0;
    m.side = alpha && m !== faceMat ? THREE.DoubleSide : THREE.FrontSide;
    m.needsUpdate = true;
  }
}

// Solid block: front and back show the media, the sides stretch its edge pixels,
// so the depth stays crisp at any resolution.
function buildBlock(w, h, depth) {
  const geo = new THREE.BoxGeometry(w, h, depth);
  const uv = geo.attributes.uv;
  const e = 0.0005;
  for (let i = 0; i < 4; i++) {
    uv.setX(0 * 4 + i, 1 - e);   // +x side → right column
    uv.setX(1 * 4 + i, e);       // −x side → left column
    uv.setY(2 * 4 + i, 1 - e);   // +y side → top row
    uv.setY(3 * 4 + i, e);       // −y side → bottom row
  }
  uv.needsUpdate = true;
  pivot.add(new THREE.Mesh(geo, [sideMat, sideMat, capMat, capMat, faceMat, faceMat]));
}

// Cut-out shapes (transparent PNG, SVG…): stack thin layers so the outline itself is extruded.
function buildLayers(w, h, depth) {
  const layers = 220;
  const geo = new THREE.PlaneGeometry(w, h);
  for (let i = 0; i < layers; i++) {
    const edge = i === 0 || i === layers - 1;
    const m = new THREE.Mesh(geo, edge ? faceMat : sideMat);
    m.position.z = -depth / 2 + depth * i / (layers - 1);
    if (i === 0) m.rotation.y = Math.PI;   // back face reads the right way round
    pivot.add(m);
  }
}

function buildMedia(tex, aspect, alpha) {
  pivot.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  pivot.clear();
  if (mediaTex) mediaTex.dispose();
  mediaTex = tex;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  setMap(tex, alpha);
  const w = aspect >= 1 ? MEDIA_SIZE : MEDIA_SIZE * aspect;
  const h = aspect >= 1 ? MEDIA_SIZE / aspect : MEDIA_SIZE;
  if (alpha) buildLayers(w, h, 0.25 * Math.max(w, h));
  else buildBlock(w, h, 0.1 * Math.max(w, h));
}

// Draw any image into a canvas no larger than the GPU allows; SVGs are rasterised big.
function rasterise(img, isSvg) {
  let w = img.naturalWidth || 2048, h = img.naturalHeight || 2048;
  const target = isSvg ? 4096 : Math.max(w, h);
  const s = Math.min(maxTex, target) / Math.max(w, h);
  w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return c;
}

function hasTransparency(canvas) {
  const s = 256 / Math.max(canvas.width, canvas.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * s)); c.height = Math.max(1, Math.round(canvas.height * s));
  const g = c.getContext('2d');
  g.drawImage(canvas, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) clear++;
  return clear / (d.length / 4) > 0.01;
}

function placeholder() {
  const c = document.createElement('canvas');
  c.width = c.height = 2048;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = 150;
  g.beginPath(); g.arc(1024, 1024, 800, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 190;
  g.beginPath(); g.moveTo(1024, 600); g.lineTo(1024, 1448); g.moveTo(600, 1024); g.lineTo(1448, 1024); g.stroke();
  buildMedia(new THREE.CanvasTexture(c), 1, true);
}
placeholder();

// Animated images (GIF, animated WebP/PNG): frames are decoded up front and
// drawn into the texture canvas for whatever time is being rendered.
let anim = null;
function updateAnim(t) {
  if (!anim) return;
  const ms = (t * 1000) % anim.total;
  let i = anim.frames.findIndex(f => ms < f.start + f.dur);
  if (i < 0) i = anim.frames.length - 1;
  if (i === anim.cur) return;
  anim.cur = i;
  anim.ctx.clearRect(0, 0, anim.canvas.width, anim.canvas.height);
  anim.ctx.drawImage(anim.frames[i].bitmap, 0, 0, anim.canvas.width, anim.canvas.height);
  anim.tex.needsUpdate = true;
}

function renderAt(t) {
  updateAnim(t);
  // Push the current video frame every render instead of waiting for the browser's
  // frame callback, which some browsers don't fire for off-screen videos.
  if (mediaVideo && mediaVideo.readyState >= 2) mediaTex.needsUpdate = true;
  const a = (t / PERIOD) * Math.PI * 2;
  pivot.rotation.y = a;
  // Sides catch more light the more they face the camera.
  const s = 0.38 + 0.42 * Math.abs(Math.sin(a));
  sideMat.color.setRGB(s, s, s);
  capMat.color.setRGB(0.45, 0.45, 0.45);
  renderer.render(scene, camera);
}

const t0 = performance.now();
(function loop() {
  if (!exporting) {
    // Browsers may pause a muted background video on their own; keep it running.
    if (mediaVideo && mediaVideo.paused && !mediaVideo.ended) mediaVideo.play().catch(() => {});
    renderAt((performance.now() - t0) / 1000);
  }
  requestAnimationFrame(loop);
})();

// ---------- Attaching media ----------
const downloads = document.getElementById('downloads');

// File type from the browser, or guessed from the extension when the browser doesn't know it.
const EXT_TYPES = {
  gif: 'image/gif', png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg',
  txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', js: 'text/javascript',
  ts: 'text/plain', py: 'text/plain', html: 'text/html', css: 'text/css', xml: 'text/xml', log: 'text/plain',
};
const extOf = name => (name.split('.').pop() || '').toLowerCase();

// Real type from the first bytes — a ".gif" from a chat app is often an MP4 inside, and
// some systems report no type at all. Falls back to the browser's type, then the extension.
async function typeOf(file) {
  const b = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const str = (o, n) => String.fromCharCode(...b.slice(o, o + n));
  if (str(0, 4) === 'GIF8') return 'image/gif';
  if (b[0] === 0x89 && str(1, 3) === 'PNG') return 'image/png';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (str(0, 4) === 'RIFF' && str(8, 4) === 'WEBP') return 'image/webp';
  if (str(0, 4) === 'RIFF' && str(8, 4) === 'AVI ') return 'video/x-msvideo';
  if (str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE') return 'audio/wav';
  if (str(4, 4) === 'ftyp') {
    const brand = str(8, 4);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1') return 'image/heic';
    if (brand.startsWith('M4A')) return 'audio/mp4';
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'video/webm';
  if (str(0, 4) === 'OggS') return file.type.startsWith('video/') ? 'video/ogg' : 'audio/ogg';
  if (str(0, 3) === 'ID3' || str(0, 4) === 'fLaC') return 'audio/mpeg';
  return file.type || EXT_TYPES[extOf(file.name)] || '';
}

// GIF fallback for browsers without ImageDecoder: parse and composite frames in JS.
async function decodeGifJs(file) {
  const { parseGIF, decompressFrames } = await import('https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm');
  const gif = parseGIF(await file.arrayBuffer());
  const raw = decompressFrames(gif, true);
  if (raw.length < 2) return null;
  const W = gif.lsd.width, H = gif.lsd.height;
  const full = document.createElement('canvas'); full.width = W; full.height = H;
  const fg = full.getContext('2d');
  const patch = document.createElement('canvas'); const pg = patch.getContext('2d');
  const frames = []; let total = 0;
  for (const f of raw.slice(0, 1500)) {
    const { width, height, top, left } = f.dims;
    patch.width = width; patch.height = height;
    pg.putImageData(new ImageData(f.patch, width, height), 0, 0);
    fg.drawImage(patch, left, top);
    let dur = f.delay || 100;
    if (dur < 20) dur = 100;
    frames.push({ bitmap: await createImageBitmap(full), start: total, dur });
    total += dur;
    if (f.disposalType === 2) fg.clearRect(left, top, width, height);
  }
  return { frames, total };
}

async function decodeAnimated(file, type) {
  if (!type.startsWith('image/')) return null;
  if (typeof ImageDecoder === 'undefined') return type === 'image/gif' ? decodeGifJs(file).catch(() => null) : null;
  try { if (!(await ImageDecoder.isTypeSupported(type))) return null; } catch { return null; }
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type });
  try {
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    if (!track || !track.animated) return null;
    await dec.completed;
    const count = Math.min(track.frameCount, 1500);
    if (count < 2) return null;
    const frames = []; let total = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      let dur = image.duration ? image.duration / 1000 : 100;
      if (dur < 20) dur = 100;   // browsers play near-zero GIF delays at 100 ms
      frames.push({ bitmap: await createImageBitmap(image), start: total, dur });
      image.close();
      total += dur;
    }
    return { frames, total };
  } finally { dec.close(); }
}

// A tidy card for files that have no picture of their own (documents, archives, audio…).
function fileCard(file, lines, wave) {
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 1200;
  const g = c.getContext('2d');
  const r = 70;
  g.fillStyle = '#121216';
  g.beginPath(); g.roundRect(0, 0, c.width, c.height, r); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 6;
  g.beginPath(); g.roundRect(3, 3, c.width - 6, c.height - 6, r); g.stroke();
  const ext = (extOf(file.name) || 'file').slice(0, 6).toUpperCase();
  g.fillStyle = '#fff'; g.font = '600 64px Inter, system-ui, sans-serif'; g.textBaseline = 'top';
  g.fillText(ext, 90, 80);
  g.fillStyle = '#8a8a96'; g.font = '500 44px Inter, system-ui, sans-serif';
  let name = file.name;
  while (g.measureText(name).width > c.width - 180 && name.length > 4) name = name.slice(0, -2);
  if (name !== file.name) name = name.slice(0, -1) + '…';
  g.fillText(name, 90, 170);
  const kb = file.size / 1024;
  g.fillText(kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(kb)) + ' KB', 90, 230);
  if (lines) {
    g.fillStyle = '#d6d6de'; g.font = '36px ui-monospace, Consolas, monospace';
    lines.slice(0, 18).forEach((l, i) => {
      let s = l.replace(/\t/g, '  ');
      while (g.measureText(s).width > c.width - 180 && s.length) s = s.slice(0, -1);
      g.fillText(s, 90, 340 + i * 46);
    });
  } else if (wave) {
    g.strokeStyle = '#fff'; g.lineWidth = 6; g.lineCap = 'round';
    const n = 120, mid = 760, w = (c.width - 180) / n;
    for (let i = 0; i < n; i++) {
      const h = Math.max(6, wave[i] * 300);
      g.beginPath(); g.moveTo(90 + i * w + w / 2, mid - h); g.lineTo(90 + i * w + w / 2, mid + h); g.stroke();
    }
  } else {
    // simple document icon
    g.strokeStyle = '#fff'; g.lineWidth = 16; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(640, 380); g.lineTo(890, 380); g.lineTo(1010, 500); g.lineTo(1010, 1000); g.lineTo(640, 1000); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(890, 380); g.lineTo(890, 500); g.lineTo(1010, 500); g.stroke();
  }
  return c;
}

async function textLines(file) {
  if (file.size > 2_000_000) return null;
  const text = await file.text();
  const bad = (text.slice(0, 4000).match(/[\u0000-\u0008\u000E-\u001F�]/g) || []).length;
  return bad > 8 ? null : text.split(/\r?\n/);
}

async function audioWave(file) {
  try {
    const buf = await new OfflineAudioContext(1, 1, AUDIO_RATE).decodeAudioData(await file.arrayBuffer());
    const d = buf.getChannelData(0), n = 120, step = Math.floor(d.length / n) || 1, out = [];
    let max = 0;
    for (let i = 0; i < n; i++) { let p = 0; for (let j = i * step; j < (i + 1) * step && j < d.length; j += 16) p = Math.max(p, Math.abs(d[j])); out.push(p); max = Math.max(max, p); }
    return out.map(v => v / (max || 1));
  } catch { return null; }
}

function loadImage(url) {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}

function loadVideo(url) {
  const v = document.createElement('video');
  v.loop = true; v.playsInline = true; v.muted = true;   // the soundtrack plays instead
  v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
  // Kept in the page (tiny, practically invisible): browsers pause muted videos that aren't on the page.
  v.className = 'media-src';
  document.body.appendChild(v);
  v.src = url;
  return new Promise((res, rej) => {
    const fail = err => { clearTimeout(timer); v.remove(); rej(err); };
    const timer = setTimeout(() => fail(new Error('timeout')), 10000);
    v.onloadeddata = () => { clearTimeout(timer); v.videoWidth ? res(v) : fail(new Error('no picture')); };
    v.onerror = () => fail(new Error('video'));
  });
}

function videoTexture(v) {
  const tex = new THREE.Texture(v);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function clearMedia() {
  if (mediaVideo) { mediaVideo.pause(); mediaVideo.removeAttribute('src'); mediaVideo.load(); mediaVideo.remove(); mediaVideo = null; }
  if (anim) { for (const f of anim.frames) f.bitmap.close(); anim = null; }
}

let attachId = 0;
async function attach(file) {
  if (!file) return;
  const id = ++attachId;
  const url = URL.createObjectURL(file);
  note.textContent = '';
  stage.classList.add('loading');
  let pendingVideo = null;
  try {
    const type = await typeOf(file);
    let built = null;   // () => void, applied only if this is still the latest attach
    const useVideo = v => () => {
      mediaVideo = v;
      v.play().catch(() => {});
      buildMedia(videoTexture(v), v.videoWidth / v.videoHeight, false);
    };

    // 1. video — first whenever the bytes say it's a video, whatever the file is called
    if (type.startsWith('video/')) {
      pendingVideo = await loadVideo(url).catch(() => null);
      if (pendingVideo) built = useVideo(pendingVideo);
    }
    // 2. animated image (GIF, animated WebP/PNG/AVIF) — plays like a video, solid block like a video
    if (!built) {
      const a = await decodeAnimated(file, type).catch(() => null);
      if (a) {
        const f0 = a.frames[0].bitmap;
        const s = Math.min(1, maxTex / Math.max(f0.width, f0.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(f0.width * s); canvas.height = Math.round(f0.height * s);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(f0, 0, 0, canvas.width, canvas.height);
        built = () => {
          const tex = new THREE.CanvasTexture(canvas);
          tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
          buildMedia(tex, canvas.width / canvas.height, false);
          anim = { ...a, canvas, ctx, tex, cur: 0 };
        };
      }
    }
    // 3. still image
    if (!built && !type.startsWith('video/') && !type.startsWith('audio/')) {
      const img = await loadImage(url).catch(() => null);
      if (img) {
        const canvas = rasterise(img, type.includes('svg'));
        built = () => {
          const tex = new THREE.CanvasTexture(canvas);
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          buildMedia(tex, canvas.width / canvas.height, hasTransparency(canvas));
        };
      }
    }
    // 4. last try as a video (unknown or mislabelled files)
    if (!built && !type.startsWith('video/') && !type.startsWith('text/') && !type.startsWith('audio/')) {
      pendingVideo = await loadVideo(url).catch(() => null);
      if (pendingVideo) built = useVideo(pendingVideo);
    }
    // 5. anything else: a card with the file's name, text preview or waveform
    if (!built) {
      const lines = type.startsWith('audio/') ? null : await textLines(file).catch(() => null);
      const wave = lines ? null : await audioWave(file);
      const canvas = fileCard(file, lines, wave);
      built = () => {
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        buildMedia(tex, canvas.width / canvas.height, true);
      };
    }

    if (id !== attachId) {   // a newer file was attached meanwhile
      if (pendingVideo) pendingVideo.remove();
      URL.revokeObjectURL(url);
      return;
    }
    clearMedia();
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = url;
    built();
    downloads.classList.add('on');
    soundBtn.hidden = false;
    syncSound();
  } catch (e) {
    console.error(e);
    if (id === attachId) note.textContent = 'This file could not be opened.';
  } finally {
    if (id === attachId) stage.classList.remove('loading');
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
  btnMp4.disabled = btnGif.disabled = qualitySel.disabled = true;
  if (mediaVideo) mediaVideo.pause();
  soundEl.pause();
  busyLabel.textContent = label; barFill.style.width = '0%'; busy.classList.add('on');
  note.textContent = '';
  try { await fn(p => { barFill.style.width = (p * 100).toFixed(1) + '%'; }); }
  catch (e) { console.error(e); note.textContent = 'Export failed: ' + (e.message || e); }
  busy.classList.remove('on');
  btnMp4.disabled = btnGif.disabled = qualitySel.disabled = false;
  if (mediaVideo) mediaVideo.play().catch(() => {});
  fitPreview();
  exporting = false;
  syncSound();
}

function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

const tick = () => new Promise(r => setTimeout(r, 0));

// Highest H.264 profile/level the browser accepts at this size.
async function videoEncoderFor(width, height) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of ['avc1.640033', 'avc1.4d0033', 'avc1.640028', 'avc1.42002a', 'avc1.42001f', 'avc1.42000c']) {
    const cfg = { codec, width, height, bitrate: Math.max(400_000, Math.round(width * height * 5)), framerate: MP4_FPS };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch {}
  }
  return null;
}

async function audioEncoderFor(channels) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, muxCodec] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate: AUDIO_RATE, numberOfChannels: channels, bitrate: 192000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, muxCodec }; } catch {}
  }
  return null;
}

async function encodeAudio(buf, channels, enc) {
  const planes = Array.from({ length: channels }, (_, c) => buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)));
  const total = buf.length, CHUNK = 4800;
  for (let start = 0; start < total; start += CHUNK) {
    const n = Math.min(CHUNK, total - start);
    const data = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) data.set(planes[c].subarray(start, start + n), c * n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: AUDIO_RATE, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round(start * 1e6 / AUDIO_RATE), data });
    enc.encode(ad);
    ad.close();
    if (enc.encodeQueueSize > 16) await tick();
  }
  await enc.flush();
}

btnMp4.addEventListener('click', () => runExport('Rendering MP4…', async progress => {
  // Try the chosen size; step down only if this GPU can't encode it.
  const heights = Object.keys(QUALITIES).map(Number).filter(h => h <= quality).sort((a, b) => b - a);
  let cfg = null;
  for (const h of heights) { cfg = await videoEncoderFor(...sizeOf(h)); if (cfg) break; }
  if (!cfg) throw new Error('this browser cannot encode MP4 — please use Chrome or Edge');
  const { width: W, height: H } = cfg;
  if (H !== quality) note.textContent = `This device can't encode ${qualityName(quality)} — saved as ${qualityName(H)}.`;
  busyLabel.textContent = `Rendering MP4 · ${qualityName(H)}…`;

  // Same length as the reference clip, so its soundtrack plays exactly once.
  await soundReady;
  const seconds = soundBuf ? soundBuf.duration : PERIOD * 2;
  const N = Math.round(MP4_FPS * seconds);
  const channels = soundBuf ? Math.min(2, soundBuf.numberOfChannels) : 0;
  const audio = soundBuf ? await audioEncoderFor(channels) : null;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    audio: audio ? { codec: audio.muxCodec, sampleRate: AUDIO_RATE, numberOfChannels: channels } : undefined,
    fastStart: 'in-memory',
  });

  let encErr = null;
  if (audio) {
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { encErr = e; } });
    aenc.configure(audio.cfg);
    await encodeAudio(soundBuf, channels, aenc);
    aenc.close();
  }

  renderer.setSize(W, H, false);
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { encErr = e; } });
  enc.configure(cfg);
  for (let i = 0; i < N; i++) {
    if (encErr) throw encErr;
    await prepareFrame(i / MP4_FPS);
    const frame = new VideoFrame(renderer.domElement, { timestamp: Math.round(i * 1e6 / MP4_FPS), duration: Math.round(1e6 / MP4_FPS) });
    enc.encode(frame, { keyFrame: i % MP4_FPS === 0 });
    frame.close();
    while (enc.encodeQueueSize > 4) await tick();
    progress((i + 1) / N);
    if (i % 2 === 0) await tick();
  }
  await enc.flush();
  if (encErr) throw encErr;
  muxer.finalize();
  save(new Blob([muxer.target.buffer], { type: 'video/mp4' }), `3d-hands-${qualityName(H)}.mp4`);
}));

btnGif.addEventListener('click', () => runExport(`Rendering GIF · ${qualityName(quality)}…`, async progress => {
  const [GW, GH] = sizeOf(quality);
  // Render up to twice as big, then downscale with high-quality smoothing for clean edges.
  const ss = Math.min(2, maxTex / GW, 3840 / GW);
  renderer.setSize(Math.round(GW * ss), Math.round(GH * ss), false);
  const N = GIF_FPS * PERIOD;   // one full turn → seamless loop
  const c = document.createElement('canvas'); c.width = GW; c.height = GH;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  const gif = GIFEncoder();
  for (let i = 0; i < N; i++) {
    await prepareFrame(i / GIF_FPS);
    g.drawImage(renderer.domElement, 0, 0, GW, GH);
    const { data } = g.getImageData(0, 0, GW, GH);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), GW, GH, { palette, delay: 1000 / GIF_FPS });
    progress((i + 1) / N);
    await tick();
  }
  gif.finish();
  save(new Blob([gif.bytes()], { type: 'image/gif' }), `3d-hands-${qualityName(quality)}.gif`);
}));
})();
