'use strict';
const post = (name, data = {}) =>
  fetch(`https://${GetParentResourceName()}/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  }).catch(() => {});
const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

const EQ_FREQS = [50, 120, 316, 1000, 2000, 5000, 10000];
const EQ_LABELS = ['50Hz', '120Hz', '316Hz', '1K', '2K', '5K', '10K'];

let library = [];
let currentNet = null;
let uiOpen = false;
let settings = defaultSettings();
let serverState = null;           // estado del vehiculo actual
const sources = {};               // netId -> fuente de audio
let AC = null;

function defaultSettings() {
  return {
    master: 0.7,
    amps: [0, 1, 2].map(() => ({ vol: 0.5, fader: 0.5, sub: 0.5, freq: 0.4, eq: EQ_FREQS.map(() => 0.5) }))
  };
}

/* ============================ Knobs ============================ */
let activeDrag = null;
window.addEventListener('mousemove', (e) => {
  if (!activeDrag) return;
  const k = activeDrag;
  k.set(clamp(k.startV + (k.startY - e.clientY) / 150)); k.draw(); k.onChange();
});
window.addEventListener('mouseup', () => { activeDrag = null; });

function makeKnob(el, get, set, onChange) {
  if (!el.firstChild) el.innerHTML = '<i class="ring"></i><i class="cap"><i class="ptr"></i></i>';
  const draw = () => {
    el.style.setProperty('--a', `${-135 + get() * 270}deg`);
    el.style.setProperty('--p', get());
  };
  draw();
  el.addEventListener('mousedown', (e) => {
    activeDrag = { set, draw, onChange, startY: e.clientY, startV: get() };
    e.preventDefault();
  });
  el.addEventListener('wheel', (e) => { set(clamp(get() - Math.sign(e.deltaY) * 0.04)); draw(); onChange(); });
  el.addEventListener('dblclick', () => { set(0.5); draw(); onChange(); });
}

const knobs = [];
function buildAmps() {
  const host = $('amps');
  host.innerHTML = '';
  settings.amps.forEach((amp, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'amp';
    wrap.innerHTML = `<div class="amphead"><b>TARAMPS</b><span class="meta"><i class="led pwr"></i><i class="led clip"></i>TEQ7.4</span></div><div class="knobs"></div>
      <div class="eqtag">7 BAND GRAPHIC EQUALIZER</div>`;
    const row = wrap.querySelector('.knobs');
    const cell = (label, getter, setter, cls = '') => {
      const c = document.createElement('div');
      c.className = 'kcell ' + cls;
      c.innerHTML = `<div class="knob"></div><span>${label}</span>`;
      row.appendChild(c);
      makeKnob(c.firstChild, getter, setter, onKnob);
      knobs.push(c.firstChild);
    };
    cell('VOL', () => amp.vol, (v) => (amp.vol = v));
    cell('FADER', () => amp.fader, (v) => (amp.fader = v));
    cell('SUB VOL', () => amp.sub, (v) => (amp.sub = v), 'sub gap');
    cell('FREQ', () => amp.freq, (v) => (amp.freq = v), 'sub');
    EQ_LABELS.forEach((l, b) =>
      cell(l, () => amp.eq[b], (v) => (amp.eq[b] = v), b === 0 ? 'gap' : ''));
    host.appendChild(wrap);
  });
}

let sendTimer = null;
function onKnob() {
  updateVolPill();
  const own = sources[currentNet];
  if (own) { own.settings = settings; applySource(own); }
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => post('settings', settings), 120);
}
function updateVolPill() { $('volPill').textContent = Math.round(settings.master * 100) + '%'; }

/* ============================ Audio ============================ */
function getCtx() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
  return AC;
}

function newSource(netId) {
  const s = { netId, el: null, url: null, fx: true, factor: 0, settings: defaultSettings(), nodes: null,
              playing: false, pendingSeek: null, target: 0 };
  buildElement(s, true);
  sources[netId] = s;
  return s;
}

function buildElement(s, fx) {
  if (s.el) { s.el.pause(); s.el.removeAttribute('src'); s.el.load(); }
  const el = new Audio();
  el.preload = 'auto';
  if (fx) el.crossOrigin = 'anonymous';
  s.el = el; s.fx = fx; s.nodes = null;

  el.addEventListener('loadedmetadata', () => {
    if (s.pendingSeek != null) { el.currentTime = Math.min(s.pendingSeek, el.duration || s.pendingSeek); s.pendingSeek = null; }
  });
  el.addEventListener('error', () => {
    if (el !== s.el || !el.getAttribute('src')) return;
    // Si el servidor remoto no permite CORS, reproducimos sin efectos (EQ desactivado)
    if (!s.fx && s.netId === currentNet) post('audioError', { msg: ERR[el.error ? el.error.code : 4] });
    if (s.fx && s.url) { const t = el.currentTime; buildElement(s, false); loadUrl(s, s.url, t); applySource(s); if (s.playing) s.el.play().catch(() => {}); }
  });
  el.addEventListener('ended', () => {
    if (s.netId === currentNet && uiOpen) autoNext(); else if (s.netId === currentNet) post('ended');
  });

  if (fx) {
    const c = getCtx();
    const src = c.createMediaElementSource(el);
    let node = src;
    const stages = [];
    for (let a = 0; a < 3; a++) {
      const trim = c.createGain(), vol = c.createGain(), sub = c.createBiquadFilter();
      sub.type = 'lowshelf';
      const eq = EQ_FREQS.map((f) => { const b = c.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.1; return b; });
      node.connect(trim); trim.connect(vol); vol.connect(sub);
      let n = sub; eq.forEach((b) => { n.connect(b); n = b; });
      node = n; stages.push({ trim, vol, sub, eq });
    }
    const comp = c.createDynamicsCompressor(), master = c.createGain(), analyser = c.createAnalyser();
    analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.6;
    node.connect(comp); comp.connect(master); master.connect(analyser); analyser.connect(c.destination);
    s.nodes = { stages, master, analyser };
  }
}

function loadUrl(s, url, seek) {
  s.url = url;
  s.pendingSeek = seek || 0;
  s.el.src = url;
}

function applySource(s) {
  const st = s.settings;
  const level = clamp(st.master) * s.factor;
  if (!s.nodes) { s.el.volume = clamp(level); return; }
  const t = AC.currentTime;
  s.nodes.master.gain.setTargetAtTime(level * 1.2, t, 0.05);
  s.nodes.stages.forEach((g, i) => {
    const a = st.amps[i];
    g.vol.gain.setTargetAtTime(a.vol * 2, t, 0.05);
    g.trim.gain.setTargetAtTime(a.fader * 2, t, 0.05);
    g.sub.gain.setTargetAtTime((a.sub - 0.5) * 24, t, 0.05);
    g.sub.frequency.setTargetAtTime(40 + a.freq * 160, t, 0.05);
    g.eq.forEach((b, k) => b.gain.setTargetAtTime((a.eq[k] - 0.5) * 24, t, 0.05));
  });
}

function syncSource(netId, state, serverNow) {
  const s = sources[netId] || newSource(netId);
  s.settings = state.settings || defaultSettings();
  const pos = state.position + (state.playing ? (serverNow - state.updatedAt) / 1000 : 0);
  if (s.url !== state.url) loadUrl(s, state.url, pos);
  else if (Math.abs(s.el.currentTime - pos) > 1.5) {
    if (s.el.readyState >= 1) s.el.currentTime = pos; else s.pendingSeek = pos;
  }
  s.playing = state.playing;
  state.playing ? s.el.play().catch((e) => { if (netId === currentNet && e.name === 'NotAllowedError') post('audioError', { msg: 'el navegador bloqueo la reproduccion (' + e.name + ')' }); }) : s.el.pause();
  applySource(s);

  if (netId === currentNet) {
    serverState = state;
    if (!isDragging) { settings = JSON.parse(JSON.stringify(s.settings)); refreshKnobs(); }
    refreshDisplay();
  }
  renderSongs();
}

function removeSource(netId) {
  const s = sources[netId];
  if (s) { s.el.pause(); s.el.removeAttribute('src'); delete sources[netId]; }
  if (netId === currentNet) { serverState = null; refreshDisplay(); renderSongs(); }
}

let isDragging = false;
window.addEventListener('mousedown', (e) => { isDragging = !!e.target.closest('.knob'); });
window.addEventListener('mouseup', () => { isDragging = false; });

/* ============================ UI ============================ */
function refreshKnobs() {
  // los knobs leen `settings` por referencia; reconstruimos para enlazar a los nuevos objetos
  knobs.length = 0; buildAmps(); bindMaster(); updateVolPill();
}
function bindMaster() {
  const el = $('knob-master');
  const fresh = el.cloneNode(false);
  el.replaceWith(fresh);
  makeKnob(fresh, () => settings.master, (v) => (settings.master = v), onKnob);
}

function fmt(t) {
  if (!isFinite(t)) t = 0;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
}

function refreshDisplay() {
  const st = serverState;
  $('status').textContent = !st ? 'STOPPED' : st.playing ? 'PLAYING' : 'PAUSED';
  $('track').textContent = st ? st.title : '—';
  const idx = st ? library.findIndex((s) => s.url === st.url) : -1;
  $('trk').textContent = 'TR ' + String(idx + 1).padStart(2, '0');
  $('bPlay').classList.toggle('lit', !!(st && st.playing));
  $('bPause').classList.toggle('lit', !!(st && !st.playing));
  $('ledPwr').classList.toggle('on', !!st);
  $('ledUsb').classList.toggle('on', !!(st && st.playing));
  document.querySelectorAll('.led.pwr').forEach((l) => l.classList.toggle('on', !!(st && st.playing)));
  $('npTitle').textContent = st ? st.title : 'Nada sonando';
  $('npState').textContent = !st ? 'DETENIDO' : st.playing ? 'REPRODUCIENDO' : 'EN PAUSA';
  $('npDisc').classList.toggle('spin', !!(st && st.playing));
  const tr = $('track');
  tr.classList.remove('marquee');
  requestAnimationFrame(() => tr.classList.toggle('marquee', tr.scrollWidth > tr.parentElement.clientWidth));
}

function renderSongs() {
  const host = $('songs');
  if (!library.length) { host.innerHTML = '<div class="empty">Tu biblioteca está vacía</div>'; return; }
  host.innerHTML = '';
  library.forEach((s) => {
    const d = document.createElement('div');
    d.className = 'song' + (serverState && serverState.url === s.url ? ' active' : '');
    d.innerHTML = `<div><b></b><small>Memoria Radio</small></div><button class="del" title="Eliminar">&#128465;</button>`;
    d.querySelector('b').textContent = s.title;
    d.addEventListener('click', () => playSong(s));
    d.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); post('removeSong', { id: s.id }); });
    host.appendChild(d);
  });
}

// Convierte enlaces de "compartir" comunes en enlaces directos
function normalizeUrl(u) {
  u = u.trim();
  const d = u.match(/drive\.google\.com\/file\/d\/([^/?]+)/);
  if (d) return `https://drive.google.com/uc?export=download&id=${d[1]}`;
  if (/dropbox\.com/.test(u)) return u.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace(/([?&])dl=0/, '$1raw=1');
  return u;
}
const ERR = { 1: 'carga cancelada', 2: 'error de red al descargar el archivo', 3: 'el archivo esta danado o su formato no se puede decodificar',
              4: 'el enlace no es un archivo de audio directo, esta caido, o es http:// (usa https://)' };

const playSong = (s) => { getCtx(); post('play', { url: s.url, title: s.title }); };
function step(dir) {
  if (!library.length) return;
  const i = serverState ? library.findIndex((s) => s.url === serverState.url) : -1;
  playSong(library[(i + dir + library.length) % library.length]);
}
function autoNext() { if (library.length > 1) step(1); else post('ended'); }

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ============================ Botones ============================ */
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => post('close')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') post('close'); });

$('btnSave').onclick = () => {
  const url = $('songUrl').value.trim();
  if (!url) return toast('Pega un enlace directo');
  post('addSong', { title: $('songTitle').value.trim(), url: normalizeUrl(url) });
  $('songUrl').value = ''; $('songTitle').value = '';
};
$('btnClone').onclick = () => post('clone', { title: $('songTitle').value.trim() });
$('btnQuick').onclick = () => {
  const url = $('quickUrl').value.trim();
  if (!url) return;
  getCtx(); post('play', { url: normalizeUrl(url), title: 'Reproducción rápida' }); $('quickUrl').value = '';
};
$('bPlay').onclick = () => {
  getCtx();
  if (!serverState) { if (library[0]) playSong(library[0]); }
  else if (!serverState.playing) post('resume');
};
$('bPause').onclick = () => post('pause');
$('bStop').onclick = () => post('stop');
$('bPrev').onclick = () => step(-1);
$('bNext').onclick = () => step(1);
$('seek').addEventListener('change', () => {
  const s = sources[currentNet];
  if (s && s.el.duration) post('seek', { time: ($('seek').value / 1000) * s.el.duration });
});

/* ============================ Bucle de pantalla ============================ */
const cv = $('spectrum'), cx = cv.getContext('2d');
const BARS = 34, SEG_H = 5, peaks = new Array(BARS).fill(0);
const bassMeter = $('bassMeter');
for (let i = 0; i < 12; i++) bassMeter.appendChild(document.createElement('i'));
const npBars = [...$('npBars').children];
const fbuf = new Uint8Array(256);
let ownBass = 0;

function frame() {
  const s = sources[currentNet];
  if (uiOpen) {
    if (s && s.el.duration) {
      $('time').textContent = `${fmt(s.el.currentTime)} / ${fmt(s.el.duration)}`;
      if (document.activeElement !== $('seek')) $('seek').value = (s.el.currentTime / s.el.duration) * 1000;
    } else $('time').textContent = '00:00 / 00:00';

    cx.clearRect(0, 0, cv.width, cv.height);
    const live = s && s.nodes && s.playing;
    if (live) s.nodes.analyser.getByteFrequencyData(fbuf);
    const bw = cv.width / BARS;
    for (let i = 0; i < BARS; i++) {
      // escala logaritmica: pocas bines para graves, muchos para agudos
      const lo = Math.floor(Math.pow(i / BARS, 2) * 200), hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / BARS, 2) * 200));
      let v = 0;
      if (live) { for (let k = lo; k < hi; k++) v = Math.max(v, fbuf[k]); v /= 255; }
      const segs = Math.round(v * (cv.height / SEG_H));
      peaks[i] = Math.max(segs, peaks[i] - 0.25);
      for (let g = 0; g < segs; g++) {
        const t = g / (cv.height / SEG_H);
        cx.fillStyle = t > 0.8 ? '#ff4d6d' : t > 0.55 ? '#ffd83a' : '#35d0ff';
        cx.shadowColor = cx.fillStyle; cx.shadowBlur = 6;
        cx.fillRect(i * bw + 1, cv.height - (g + 1) * SEG_H, bw - 2, SEG_H - 1.5);
      }
      if (peaks[i] > 1) { cx.fillStyle = '#e8f4ff'; cx.shadowBlur = 4; cx.fillRect(i * bw + 1, cv.height - (peaks[i] + 1) * SEG_H, bw - 2, 2); }
    }
    cx.shadowBlur = 0;

    // medidor de bajo, LEDs de clip y barras del "now playing"
    [...bassMeter.children].forEach((l, i) => {
      const on = ownBass * 12 > i;
      l.className = on ? 'on' + (i > 9 ? ' r' : i > 6 ? ' y' : '') : '';
    });
    document.querySelectorAll('.led.clip').forEach((l) => l.classList.toggle('on', ownBass > 0.88));
    npBars.forEach((b, i) => { b.style.height = (live ? 4 + Math.max(0, Math.min(1, ownBass + Math.sin(performance.now() / (120 + i * 40)) * 0.2)) * 18 : 4) + 'px'; });
    $('unit').style.setProperty('--bass', Math.max(0, (ownBass - 0.35) / 0.65).toFixed(3));
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ============ Analisis de graves -> vibracion de pantalla (cliente Lua) ============ */
let lastBass = 0;
setInterval(() => {
  let max = 0, own = 0;
  for (const id in sources) {
    const src = sources[id];
    if (!src.nodes || !src.playing || src.factor < 0.02) continue;
    src.nodes.analyser.getByteFrequencyData(fbuf);
    const b = (fbuf[0] * 0.35 + fbuf[1] * 0.4 + fbuf[2] * 0.25) / 255;
    if (b > max) max = b;
    if (String(id) === String(currentNet)) own = b;
  }
  ownBass = ownBass * 0.5 + own * 0.5;
  if (Math.abs(max - lastBass) > 0.03 || (max === 0 && lastBass !== 0)) { lastBass = max; post('bass', { level: max }); }
}, 60);

/* ============================ Mensajes del juego ============================ */
window.addEventListener('message', ({ data: d }) => {
  switch (d.action) {
    case 'open':
      uiOpen = true; currentNet = d.netId; $('app').classList.remove('hidden');
      serverState = null;
      if (sources[currentNet]) settings = JSON.parse(JSON.stringify(sources[currentNet].settings));
      else settings = defaultSettings();
      refreshKnobs(); refreshDisplay(); renderSongs();
      break;
    case 'close':
      uiOpen = false; $('app').classList.add('hidden'); break;
    case 'library':
      library = d.list || []; renderSongs(); refreshDisplay(); break;
    case 'sync':
      syncSource(d.netId, d.state, d.serverNow); break;
    case 'remove':
      removeSource(d.netId); break;
    case 'tick':
      Object.entries(d.factors).forEach(([id, f]) => {
        const s = sources[id]; if (!s) return;
        if (Math.abs(s.factor - f) > 0.01) { s.factor = f; applySource(s); }
      });
      $('temp').textContent = Math.round(d.temp) + '°C';
      $('volt').textContent = (d.volt + (sources[currentNet] && sources[currentNet].playing ? settings.master * -0.4 : 0)).toFixed(1);
      break;
  }
});

function fit() { document.documentElement.style.setProperty('--fit', Math.min(1, innerHeight / 740, innerWidth / 1000)); }
window.addEventListener('resize', fit); fit();

// primer render para que el DOM exista aunque el panel este oculto
buildAmps(); bindMaster(); updateVolPill(); renderSongs();
