'use strict';
const RES = typeof GetParentResourceName === 'function' ? GetParentResourceName() : 'flow-dj';
const post = (name, data = {}) =>
  fetch(`https://${RES}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    .then((r) => r.json()).catch(() => ({}));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const ytId = (u) => { const m = String(u).match(/^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i); return m ? m[1] : null; };
const kindOf = (u) => (!u ? '' : ytId(u) ? 'yt' : /^https?:\/\//i.test(u) ? 'file' : 'bad');
// Lua puede mandar las tablas vacias como {} en vez de []
const arr = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);
const norm = (st) => { if (st) { st.queue = arr(st.queue); st.history = arr(st.history); } return st; };
const setFill = (el) => el.style.setProperty('--fill', ((el.value - el.min) / (el.max - el.min)) * 100 + '%');

let view = null;
let booths = [];
let states = {};          // [id] = estado del servidor
let offset = 0;           // serverNow(ms) - performance.now()
let djId = null;
let qtab = 'queue';
let mix = {};
let AC = null;

/* =====================================================================
   MOTOR DE AUDIO: una fuente por cabina (YouTube o archivo)
   ===================================================================== */
const sources = {};
const ctx = () => { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; };
const serverMs = () => performance.now() + offset;
const wantPos = (cur) => (cur ? cur.position + (cur.playing ? (serverMs() - cur.updatedAt) / 1000 : 0) : 0);

let ytApi = null;
function loadYt() {
  if (ytApi) return ytApi;
  ytApi = new Promise((res) => {
    if (window.YT && window.YT.Player) return res();
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytApi = null; };
    document.head.appendChild(s);
  });
  return ytApi;
}

function src(id) {
  if (!sources[id]) sources[id] = { id, key: null, kind: null, el: null, nodes: null, yt: null, f: 0, pan: 0, muffle: 0 };
  return sources[id];
}

function destroy(s) {
  if (s.el) { s.el.pause(); s.el.removeAttribute('src'); s.el = null; s.nodes = null; }
  if (s.yt) { try { s.yt.player && s.yt.player.destroy(); } catch (e) {} s.yt = null; }
  s.key = null; s.kind = null;
}

function buildFile(s, url, pos, fx = true) {
  const el = new Audio();
  el.preload = 'auto';
  if (fx) el.crossOrigin = 'anonymous';
  s.el = el; s.kind = 'file'; s.nodes = null;
  el.addEventListener('loadedmetadata', () => { if (s.seekTo != null) { el.currentTime = Math.min(s.seekTo, el.duration || s.seekTo); s.seekTo = null; } });
  el.addEventListener('error', () => {
    if (el !== s.el) return;
    if (fx) { const t = el.currentTime; buildFile(s, url, t, false); s.seekTo = t; apply(s); if (states[s.id] && states[s.id].current && states[s.id].current.playing) s.el.play().catch(() => {}); }
    else if (s.id === djId) toast('No se pudo cargar el audio (enlace caído o no es directo)', 'error');
  });
  el.addEventListener('ended', () => { if (s.key) post('ended', { id: s.id, key: s.key }); });
  if (fx) {
    const c = ctx();
    const node = c.createMediaElementSource(el);
    const bq = (type, f, q) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q) n.Q.value = q; return n; };
    const low = bq('lowshelf', 120), mid = bq('peaking', 1000, 0.9), high = bq('highshelf', 6000);
    const fLow = bq('lowpass', 20000, 0.8), fHigh = bq('highpass', 10, 0.8);       // filtro DJ (barrido)
    const lp = bq('lowpass', 20000);                                               // apagado por distancia
    const gain = c.createGain(), pan = c.createStereoPanner(), an = c.createAnalyser();
    an.fftSize = 256; an.smoothingTimeConstant = 0.7;
    [node, low, mid, high, fLow, fHigh, lp, gain, pan, an].reduce((a, b) => { a.connect(b); return b; });
    an.connect(c.destination);
    s.nodes = { lp, gain, pan, an, low, mid, high, fLow, fHigh };
  }
  s.seekTo = pos;
  el.src = url;
}

function buildYt(s, vid, pos) {
  s.kind = 'yt';
  s.yt = { ready: false, player: null, vid };
  loadYt().then(() => {
    if (!s.yt || s.yt.vid !== vid) return;
    const host = document.createElement('div');
    host.id = 'yt-' + s.id + '-' + Date.now();
    $('ytHost').appendChild(host);
    s.yt.player = new YT.Player(host.id, {
      width: 200, height: 120, videoId: vid,
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, start: Math.floor(wantPos(states[s.id] && states[s.id].current)) },
      events: {
        onReady: () => { if (!s.yt) return; s.yt.ready = true; sync(s.id); },
        onStateChange: (e) => { if (e.data === 0 && s.key) post('ended', { id: s.id, key: s.key }); },
        onError: () => { if (s.id === djId) toast('Ese video no se puede reproducir fuera de YouTube', 'error'); if (s.key) post('ended', { id: s.id, key: s.key }); }
      }
    });
  });
}

function vol(s) {
  const st = states[s.id];
  return st ? clamp((st.djVolume ?? 0.8) * s.f) : 0;
}

function apply(s) {
  const v = vol(s);
  if (s.kind === 'yt') { if (s.yt && s.yt.ready) s.yt.player.setVolume(Math.round(v * 100)); return; }
  if (!s.el) return;
  if (!s.nodes) { s.el.volume = v; return; }
  const t = AC.currentTime;
  s.nodes.gain.gain.setTargetAtTime(v, t, 0.08);
  s.nodes.pan.pan.setTargetAtTime(clamp(s.pan, -1, 1), t, 0.15);
  s.nodes.lp.frequency.setTargetAtTime(20000 * Math.pow(400 / 20000, clamp(s.muffle)), t, 0.15);
  const eq = (states[s.id] && states[s.id].eq) || {};
  const db = (v) => (Number(v) || 0) * ((Number(v) || 0) < 0 ? 26 : 9);           // corta hasta -26 dB, sube hasta +9 dB
  s.nodes.low.gain.setTargetAtTime(db(eq.low), t, 0.05);
  s.nodes.mid.gain.setTargetAtTime(db(eq.mid), t, 0.05);
  s.nodes.high.gain.setTargetAtTime(db(eq.high), t, 0.05);
  const f = Number(eq.filter) || 0;
  s.nodes.fLow.frequency.setTargetAtTime(f < -0.02 ? 20000 * Math.pow(120 / 20000, -f) : 20000, t, 0.05);
  s.nodes.fHigh.frequency.setTargetAtTime(f > 0.02 ? 10 * Math.pow(6000 / 10, f) : 10, t, 0.05);
}

const curTime = (s) => (s.kind === 'yt' ? (s.yt && s.yt.ready ? s.yt.player.getCurrentTime() || 0 : 0) : s.el ? s.el.currentTime : 0);
const durTime = (s) => (s.kind === 'yt' ? (s.yt && s.yt.ready ? s.yt.player.getDuration() || 0 : 0) : s.el ? s.el.duration || 0 : 0);

function sync(id) {
  const st = states[id];
  const s = src(id);
  const cur = st && st.current;
  if (!cur) { destroy(s); return; }
  // solo cargamos la cancion si alguien la puede oir o si es tu cabina
  const audible = s.f > 0.001 || id === djId;
  if (!audible) { if (s.key) destroy(s); return; }
  if (s.key !== cur.key) {
    destroy(s);
    s.key = cur.key;
    const vid = cur.kind === 'yt' ? ytId(cur.url) : null;
    if (vid) buildYt(s, vid, wantPos(cur)); else buildFile(s, cur.url, wantPos(cur));
  }
  const pos = wantPos(cur);
  if (s.kind === 'yt' && s.yt && s.yt.ready) {
    const p = s.yt.player;
    if (Math.abs((p.getCurrentTime() || 0) - pos) > 2.5) p.seekTo(pos, true);
    cur.playing ? p.playVideo() : p.pauseVideo();
  } else if (s.kind === 'file' && s.el) {
    if (s.el.readyState >= 1 && Math.abs(s.el.currentTime - pos) > 2) s.el.currentTime = pos; else if (s.el.readyState < 1) s.seekTo = pos;
    cur.playing ? s.el.play().catch(() => {}) : s.el.pause();
  }
  apply(s);
}

/* =====================================================================
   PANEL DE DJ
   ===================================================================== */
const boothOf = (id) => booths.find((b) => b.id === id);

/* hot cues (solo para el DJ, por cancion) */
const cues = {};
const cueKey = () => { const st = states[djId]; return st && st.current ? st.current.url : null; };
document.querySelectorAll('#pads button').forEach((p) => {
  p.onclick = () => {
    const k = cueKey(), s = sources[djId];
    if (!k || !s) return toast('No hay nada sonando', 'error');
    cues[k] = cues[k] || [];
    const i = Number(p.dataset.p);
    if (cues[k][i] == null) { cues[k][i] = curTime(s); renderPads(); }
    else post('control', { action: 'seek', value: cues[k][i] });
  };
  p.oncontextmenu = (e) => { e.preventDefault(); const k = cueKey(); if (k && cues[k]) { cues[k][Number(p.dataset.p)] = null; renderPads(); } };
});
function renderPads() {
  const list = cues[cueKey()] || [];
  document.querySelectorAll('#pads button').forEach((p) => {
    const v = list[Number(p.dataset.p)];
    p.classList.toggle('set', v != null);
    p.querySelector('span').textContent = v != null ? fmt(v) : '—';
    p.title = v != null ? 'Clic: saltar · clic derecho: borrar' : 'Clic: marcar este punto';
  });
}

/* perillas del mixer (EQ + filtro) */
let eqDraft = { low: 0, mid: 0, high: 0, filter: 0 }, eqTimer = null, drag = null;
function drawKnob(el) {
  const v = eqDraft[el.dataset.eq] || 0;
  const ang = v * 135;
  el.style.setProperty('--a', ang + 'deg');
  // arco desde el centro (12 en punto) hasta el valor
  if (v >= 0) { el.style.setProperty('--arcA', ang + 'deg'); el.style.setProperty('--arcB', '360deg'); }
  else { el.style.setProperty('--arcA', '0deg'); el.style.setProperty('--arcB', (360 + ang) + 'deg'); }
}
document.querySelectorAll('.knob').forEach((k) => {
  k.innerHTML = '<i></i>';
  k.addEventListener('mousedown', (e) => { drag = { k, y: e.clientY, v: eqDraft[k.dataset.eq] || 0 }; e.preventDefault(); });
  k.addEventListener('dblclick', () => setEq(k.dataset.eq, 0));
  k.addEventListener('wheel', (e) => setEq(k.dataset.eq, (eqDraft[k.dataset.eq] || 0) - Math.sign(e.deltaY) * 0.05));
  drawKnob(k);
});
function setEq(key, v) {
  v = clamp(v, -1, 1); if (Math.abs(v) < 0.04) v = 0;
  eqDraft[key] = v;
  document.querySelectorAll('.knob').forEach(drawKnob);
  const st = states[djId]; if (st) { st.eq = { ...eqDraft }; if (sources[djId]) apply(sources[djId]); }
  clearTimeout(eqTimer); eqTimer = setTimeout(() => post('control', { action: 'eq', value: eqDraft }), 120);
}

/* fader vertical (master) */
let faderDrag = false, volTimer = null;
function setVol(v, send = true) {
  v = clamp(v);
  const st = states[djId]; if (st) { st.djVolume = v; if (sources[djId]) apply(sources[djId]); }
  $('vcap').style.top = `calc(${(1 - v) * 100}% * 0.86 + 7%)`;
  $('vfill').style.height = v * 100 + '%';
  $('volVal').textContent = Math.round(v * 100) + '%';
  if (send) { clearTimeout(volTimer); volTimer = setTimeout(() => post('control', { action: 'volume', value: v }), 120); }
}
const faderFromY = (y) => { const r = $('vfader').getBoundingClientRect(); return 1 - (y - r.top - r.height * 0.07) / (r.height * 0.86); };
$('vfader').addEventListener('mousedown', (e) => { faderDrag = true; setVol(faderFromY(e.clientY)); e.preventDefault(); });
$('vfader').addEventListener('wheel', (e) => setVol(((states[djId] && states[djId].djVolume) ?? 0.8) - Math.sign(e.deltaY) * 0.04));
window.addEventListener('mousemove', (e) => {
  if (faderDrag) setVol(faderFromY(e.clientY));
  if (drag) setEq(drag.k.dataset.eq, drag.v + (drag.y - e.clientY) / 120);
});
window.addEventListener('mouseup', () => { faderDrag = false; drag = null; });

/* onda de la cancion (real con MP3, generada con YouTube) */
const waves = {};
function seeded(str, n) {
  let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = []; let x = h >>> 0, prev = 0.5;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x ^ (x >>> 15), 2246822519) + 3266489917) >>> 0;
    const r = x / 4294967296, sec = Math.sin(i / n * Math.PI);
    prev = prev * 0.55 + (0.25 + r * 0.75) * 0.45;
    out.push(clamp(prev * (0.55 + sec * 0.5) * (i % 16 < 2 ? 1.15 : 1)));
  }
  return out;
}
async function loadWave(cur) {
  if (waves[cur.url]) return;
  waves[cur.url] = seeded(cur.url, 300);
  if (cur.kind !== 'file') return;
  try {
    const buf = await (await fetch(cur.url)).arrayBuffer();
    const audio = await ctx().decodeAudioData(buf);
    const data = audio.getChannelData(0), n = 300, step = Math.floor(data.length / n), peaks = [];
    let max = 0;
    for (let i = 0; i < n; i++) { let m = 0; for (let k = i * step; k < (i + 1) * step; k += 32) m = Math.max(m, Math.abs(data[k])); peaks.push(m); max = Math.max(max, m); }
    waves[cur.url] = peaks.map((p) => p / (max || 1));
  } catch (e) { /* sin CORS: se queda la onda generada */ }
}
const wcv = $('waveCv'), wcx = wcv.getContext('2d');
function drawWave(prog) {
  const st = states[djId], cur = st && st.current;
  const W = wcv.width, H = wcv.height;
  wcx.clearRect(0, 0, W, H);
  if (!cur) return;
  const w = waves[cur.url] || seeded(cur.url, 300), n = w.length, bw = W / n;
  const playedX = prog * W;
  for (let i = 0; i < n; i++) {
    const x = i * bw, h = Math.max(2, w[i] * (H - 6));
    const played = x < playedX;
    wcx.fillStyle = played ? (i % 2 ? '#ff9ccd' : '#ff2e93') : (i % 2 ? '#3a2f39' : '#2c232c');
    wcx.fillRect(x, (H - h) / 2, Math.max(1, bw - 1), h);
  }
  // marcas de hot cue
  (cues[cur.url] || []).forEach((v, i) => {
    if (v == null) return;
    const s = sources[djId], d = s ? durTime(s) : 0; if (!d) return;
    wcx.fillStyle = ['#ff2e93', '#ffc2e0', '#ffffff', '#c13dff'][i];
    wcx.fillRect((v / d) * W - 1, 0, 3, H);
  });
}
$('wave').addEventListener('click', (e) => {
  const s = sources[djId], d = s ? durTime(s) : 0; if (!d) return;
  const r = $('wave').getBoundingClientRect();
  post('control', { action: 'seek', value: ((e.clientX - r.left) / r.width) * d });
});

function renderDJ() {
  if (view !== 'dj') return;
  const b = boothOf(djId) || {};
  const st = states[djId] || { queue: [], history: [] };
  const cur = st.current;
  $('djName').textContent = (b.name || 'CABINA DJ').toUpperCase();
  $('djSub').textContent = st.dj ? `DJ en cabina: ${st.dj.name}` : 'Cabina libre';
  $('hsRadius').textContent = Math.round(b.radius || 0);
  document.body.classList.toggle('playing', !!(cur && cur.playing));
  $('nowTitle').textContent = cur ? cur.title : 'Nada sonando';
  $('nowAuthor').textContent = cur ? (cur.author || (cur.kind === 'yt' ? 'YouTube' : 'Audio')) : 'Añade una canción de YouTube o un enlace .mp3';
  $('nowBy').textContent = cur ? 'Puesta por ' + cur.by : '—';
  const chip = $('srcChip');
  chip.className = 'cdj-src ' + (cur ? cur.kind : '');
  chip.textContent = cur ? (cur.kind === 'yt' ? 'YOUTUBE' : 'MP3') : 'NO TRACK';
  const img = cur && cur.thumb ? `url("${cur.thumb}")` : '';
  $('art').style.backgroundImage = img; $('jogArt').style.backgroundImage = img;
  if (cur) loadWave(cur);
  // EQ / filtro
  if (!drag) { eqDraft = { low: 0, mid: 0, high: 0, filter: 0, ...(st.eq || {}) }; document.querySelectorAll('.knob').forEach(drawKnob); }
  const eqOff = cur && cur.kind === 'yt';
  document.querySelectorAll('.knob').forEach((k) => k.classList.toggle('off', !!eqOff));
  $('eqNote').textContent = eqOff ? 'YouTube: EQ y filtro no disponibles' : 'Doble clic: resetear';
  if (!faderDrag) setVol(st.djVolume ?? 0.8, false);
  renderPads();
  // cola / historial
  $('qCount').textContent = st.queue.length;
  const host = $('qList');
  const list = qtab === 'queue' ? st.queue : st.history;
  host.innerHTML = list.length ? '' : `<div class="empty"><b>${qtab === 'queue' ? 'La cola está vacía' : 'Sin historial'}</b>${qtab === 'queue' ? 'Pega un enlace arriba para añadir canciones.' : 'Aquí salen las canciones que ya sonaron.'}</div>`;
  list.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'track tile';
    el.style.animationDelay = Math.min(i * 0.03, 0.4) + 's';
    el.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}</span><span class="thumb" ${t.thumb ? `style="background-image:url('${esc(t.thumb)}')"` : ''}>${t.thumb ? '' : '♫'}</span>
      <div class="ti"><b>${esc(t.title)}</b><small><span class="mini ${t.kind}">${t.kind === 'yt' ? 'YT' : 'MP3'}</span>${esc(t.by || '')}</small></div>
      <div class="tacts">${qtab === 'queue'
        ? `<button data-a="playIndex" title="Poner ya">▶</button>${i ? '<button data-a="up" title="Subir">▲</button>' : ''}<button data-a="remove" class="rm" title="Quitar">✕</button>`
        : '<button data-a="replay" title="Volver a poner">↻</button>'}</div>`;
    el.querySelectorAll('[data-a]').forEach((btn) => (btn.onclick = () => post('control', { action: btn.dataset.a, value: i + 1 })));
    host.appendChild(el);
  });
}

function updKind() {
  const k = kindOf($('url').value.trim());
  $('urlKind').className = 'kind ' + k;
  $('urlKind').textContent = { yt: 'YOUTUBE', file: 'AUDIO', bad: 'NO VÁLIDO' }[k] || 'LINK';
}
$('url').addEventListener('input', updKind);
function addUrl(now) {
  const u = $('url').value.trim();
  if (kindOf(u) !== 'yt' && kindOf(u) !== 'file') return toast('Pega un enlace de YouTube o un .mp3 / .wav directo', 'error');
  ctx();
  post('add', { url: u, now });
  $('url').value = ''; updKind();
}
$('bAdd').onclick = () => addUrl(false);
$('bNow').onclick = () => addUrl(true);
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') addUrl(false); });
$('bPlay').onclick = () => {
  ctx();
  const st = states[djId];
  if (!st || !st.current) return toast('La cola está vacía', 'error');
  post('control', { action: st.current.playing ? 'pause' : 'resume' });
};
$('bStop').onclick = () => post('control', { action: 'stop' });
$('bSkip').onclick = () => post('control', { action: 'skip' });
$('bClear').onclick = () => post('control', { action: 'clear' });
$('bClear2').onclick = () => post('control', { action: 'clear' });
document.querySelectorAll('.qtabs [data-q]').forEach((b) => (b.onclick = () => {
  qtab = b.dataset.q;
  document.querySelectorAll('.qtabs [data-q]').forEach((x) => x.classList.toggle('on', x === b));
  renderDJ();
}));

// VU metros
const VU = 18;
['vuL', 'vuR'].forEach((id) => { for (let i = 0; i < VU; i++) $(id).appendChild(document.createElement('i')); });
const fbuf = new Uint8Array(128);
function levelOf(s) {
  if (!s) return 0;
  if (s.nodes) { s.nodes.an.getByteFrequencyData(fbuf); let m = 0; for (let i = 0; i < 24; i++) m = Math.max(m, fbuf[i]); return m / 255; }
  const st = states[s.id];
  return st && st.current && st.current.playing ? 0.45 + Math.random() * 0.4 : 0;     // YouTube no deja leer el audio: animacion
}

/* =====================================================================
   ADMIN
   ===================================================================== */
let adm = { sel: null, draft: null, defaults: {}, maxRadius: 250 };

function renderBooths() {
  $('admSub').textContent = `${booths.length} ${booths.length === 1 ? 'cabina' : 'cabinas'}`;
  const host = $('bList');
  host.innerHTML = booths.length ? '' : '<div class="empty"><b>No hay cabinas</b>Ponte en el sitio y pulsa “Nueva cabina aquí”.</div>';
  booths.forEach((b, i) => {
    const st = states[b.id];
    const live = st && st.current;
    const el = document.createElement('button');
    el.className = 'booth tile' + (adm.sel === b.id ? ' on' : '');
    el.style.animationDelay = Math.min(i * 0.04, 0.4) + 's';
    el.innerHTML = `<div class="btop"><b>${esc(b.name)}</b><span class="chip">${Math.round(b.radius)} m</span><span class="chip ${live ? 'live' : 'off'}">${live ? 'SONANDO' : 'LIBRE'}</span></div>
      <p>${live ? '♫ ' + esc(st.current.title) : 'Sin música'}</p>
      <small>${b.coords.x.toFixed(1)}, ${b.coords.y.toFixed(1)}, ${b.coords.z.toFixed(1)} · ${{ all: 'Todos', job: 'Trabajo: ' + (b.job || '—'), admin: 'Solo admins' }[b.access]}</small>`;
    el.onclick = () => edit(b);
    host.appendChild(el);
  });
}

function edit(b) {
  adm.sel = b ? b.id : null;
  adm.draft = b ? JSON.parse(JSON.stringify(b)) : null;
  $('edEmpty').classList.toggle('hidden', !!b);
  $('edForm').classList.toggle('hidden', !b);
  renderBooths();
  if (!b) { post('editing', {}); return; }
  const d = adm.draft;
  $('fName').value = d.name || '';
  $('fRadius').max = adm.maxRadius;
  $('fRadius').value = d.radius; $('fVolume').value = Math.round(d.volume * 100); $('fInteract').value = d.interact;
  $('fJob').value = d.job || ''; $('fBlip').checked = !!d.blip;
  $('bDel').classList.toggle('hidden', !d.id);
  $('bMute').classList.toggle('hidden', !d.id);
  setAccess(d.access || 'all');
  updForm();
}
function setAccess(a) {
  adm.draft.access = a;
  document.querySelectorAll('#fAccess button').forEach((x) => x.classList.toggle('on', x.dataset.a === a));
  $('jobField').classList.toggle('hidden', a !== 'job');
}
function updForm() {
  const d = adm.draft; if (!d) return;
  d.name = $('fName').value; d.radius = Number($('fRadius').value); d.volume = $('fVolume').value / 100;
  d.interact = Number($('fInteract').value); d.job = $('fJob').value; d.blip = $('fBlip').checked;
  ['fRadius', 'fVolume', 'fInteract'].forEach((id) => setFill($(id)));
  $('vRadius').textContent = d.radius + ' m'; $('vVolume').textContent = Math.round(d.volume * 100) + '%'; $('vInteract').textContent = d.interact + ' m';
  $('fCoords').textContent = `${d.coords.x.toFixed(2)}, ${d.coords.y.toFixed(2)}, ${d.coords.z.toFixed(2)}`;
  $('rLbl').textContent = d.radius + ' m';
  $('zone').style.setProperty('--zs', (18 + (d.radius / adm.maxRadius) * 80) + '%');
  post('editing', { coords: d.coords, radius: d.radius });
}
['fName', 'fRadius', 'fVolume', 'fInteract', 'fJob'].forEach((id) => $(id).addEventListener('input', updForm));
$('fBlip').addEventListener('change', updForm);
document.querySelectorAll('#fAccess button').forEach((x) => (x.onclick = () => setAccess(x.dataset.a)));
$('bNew').onclick = async () => {
  const here = await post('here');
  const d = adm.defaults;
  edit({ name: 'Nueva cabina', coords: here && here.x ? here : { x: 0, y: 0, z: 0 }, radius: d.radius || 40, volume: d.volume || 0.85, interact: d.interact || 2.5, access: d.access || 'all', job: '', blip: d.blip !== false });
};
$('bHere').onclick = async () => { const here = await post('here'); if (here && here.x !== undefined) { adm.draft.coords = here; updForm(); } };
$('bTp').onclick = () => post('teleport', { coords: adm.draft.coords });
$('bSave').onclick = () => { updForm(); post('saveBooth', adm.draft); };
$('bDel').onclick = () => {
  const b = $('bDel');
  if (!b.dataset.sure) { b.dataset.sure = 1; b.lastChild.textContent = '¿Seguro?'; setTimeout(() => { delete b.dataset.sure; b.lastChild.textContent = 'Eliminar'; }, 2500); return; }
  post('deleteBooth', { id: adm.draft.id }); edit(null);
};
$('bMute').onclick = () => post('adminStop', { id: adm.draft.id });

/* =====================================================================
   SONANDO AHORA (para los que escuchan) + bucle
   ===================================================================== */
function renderNowCard() {
  let best = null;
  for (const b of booths) {
    const st = states[b.id], m = mix[b.id];
    if (st && st.current && m && m.f > 0.02 && (!best || m.f > best.m.f)) best = { b, st, m };
  }
  const card = $('nowcard');
  if (!best || view) { card.classList.add('hidden'); return; }
  const wasHidden = card.classList.contains('hidden');
  card.classList.remove('hidden');
  if (wasHidden) { card.style.animation = 'none'; void card.offsetWidth; card.style.animation = ''; }
  $('ncTitle').textContent = best.st.current.title;
  $('ncMeta').textContent = `${best.b.name} · ${best.st.current.playing ? (best.st.dj ? best.st.dj.name : best.st.current.by) : 'En pausa'}`;
  $('ncDist').textContent = best.m.d + ' m';
  $('ncDisc').style.setProperty('--ncimg', best.st.current.thumb ? `url("${best.st.current.thumb}")` : '');
  $('ncDisc').style.animationPlayState = best.st.current.playing ? 'running' : 'paused';
}

function frame() {
  if (view === 'dj') {
    const s = sources[djId];
    const d = s ? durTime(s) : 0, c = s ? curTime(s) : 0, prog = d ? clamp(c / d) : 0;
    $('tCur').textContent = fmt(c); $('tDur').textContent = fmt(d); $('tRem').textContent = '-' + fmt(Math.max(0, d - c));
    document.documentElement.style.setProperty('--prog', prog.toFixed(4));
    $('wHead').style.left = prog * 100 + '%';
    drawWave(prog);
    const m = mix[djId]; $('hsListeners').textContent = m && m.n != null ? m.n : 0;
    const lv = levelOf(s) * ((states[djId] && states[djId].djVolume) ?? 0.8);
    ['vuL', 'vuR'].forEach((id, k) => [...$(id).children].forEach((el, i) => {
      const on = (lv + (k ? 0.03 : 0)) * VU > i;
      el.className = on ? 'on' + (i >= VU - 2 ? ' r' : i >= VU - 5 ? ' y' : '') : '';
    }));
    document.documentElement.style.setProperty('--beat', lv.toFixed(2));
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ============================ comun ============================ */
function show(v) {
  view = v;
  $('dj').classList.toggle('hidden', v !== 'dj');
  $('admin').classList.toggle('hidden', v !== 'admin');
  ['dj', 'admin'].forEach((id) => { const el = $(id); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
  if (v) $('prompt').classList.add('hidden');
  if (v !== 'dj') document.body.classList.remove('playing');
  renderNowCard();
}
function toast(msg, kind = 'info') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = `<i></i><span>${esc(msg)}</span>`;
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 3400);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => post('close')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && view) post('close'); });
document.addEventListener('mousedown', () => { if (AC && AC.state === 'suspended') AC.resume(); });

window.addEventListener('message', ({ data: m }) => {
  switch (m.action) {
    case 'booths':
      booths = arr(m.booths);
      if (view === 'admin') renderBooths();
      break;
    case 'state':
      if (m.serverNow) offset = m.serverNow - performance.now();
      if (m.state) states[m.id] = norm(m.state); else delete states[m.id];
      if (m.booth && !boothOf(m.id)) booths.push(m.booth);
      sync(m.id);
      if (view === 'dj' && m.id === djId) renderDJ();
      if (view === 'admin') renderBooths();
      renderNowCard();
      break;
    case 'mix':
      mix = m.mix || {};
      for (const id of Object.keys(states)) {
        const s = src(Number(id)), v = mix[id] || { f: 0, p: 0, m: 0 };
        const wasSilent = s.f <= 0.001;
        s.f = v.f; s.pan = v.p; s.muffle = v.m;
        if (wasSilent && s.f > 0.001 && !s.key) sync(Number(id));   // entraste en el radio: cargar la cancion
        else if (s.f <= 0.001 && s.key && Number(id) !== djId) destroy(s);   // saliste: liberar
        else apply(s);
      }
      renderNowCard();
      break;
    case 'openDJ':
      djId = m.id; offset = m.serverNow - performance.now();
      if (m.booth && !boothOf(m.id)) booths.push(m.booth);
      states[m.id] = norm(m.state);
      qtab = 'queue'; document.querySelectorAll('.qtabs [data-q]').forEach((x) => x.classList.toggle('on', x.dataset.q === 'queue'));
      show('dj'); sync(m.id); renderDJ();
      break;
    case 'openAdmin':
      booths = arr(m.booths); offset = m.serverNow - performance.now();
      for (const [k, v] of Object.entries(m.states || {})) states[k] = norm(v);
      adm.defaults = m.defaults || {}; adm.maxRadius = m.maxRadius || 250;
      show('admin');
      edit(adm.sel ? boothOf(adm.sel) : null);
      renderBooths();
      break;
    case 'adminSaved':
      adm.sel = m.id; setTimeout(() => { const b = boothOf(m.id); if (b && view === 'admin') edit(b); }, 150);
      break;
    case 'prompt':
      $('prompt').classList.toggle('hidden', !m.show || !!view);
      if (m.name) $('promptName').textContent = m.name;
      break;
    case 'notify':
      toast(m.msg, m.kind);
      break;
    case 'close':
      if (view === 'dj' && djId != null) { const id = djId; djId = null; if (sources[id] && (mix[id] || { f: 0 }).f <= 0.001) destroy(sources[id]); }
      show(null);
      break;
  }
});
