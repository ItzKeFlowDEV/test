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
  if (k.abs) return k.abs(e.clientY);
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
const MODELS = ['TEQ 7.4 · FRONT', 'TEQ 7.4 · MIDS', 'TEQ 7.4 · SUBS'];

// Deslizador vertical con LEDs (ecualizador grafico de carro)
function makeSlider(el, get, set, onChange) {
  el.innerHTML = '<div class="trk">' + '<i></i>'.repeat(10) + '<b class="scap"></b></div>';
  const trk = el.firstChild, leds = [...trk.querySelectorAll('i')], cap = trk.querySelector('.scap');
  const draw = () => {
    const v = get();
    cap.style.bottom = `calc(${v} * (100% - 12px))`;
    const lit = Math.round(v * 10);
    leds.forEach((l, i) => { l.className = i < lit ? (i >= 8 ? 'on hot' : i >= 6 ? 'on warm' : 'on') : ''; });
  };
  draw();
  const fromY = (y) => { const r = trk.getBoundingClientRect(); return clamp(1 - (y - r.top - 6) / (r.height - 12)); };
  el.addEventListener('mousedown', (e) => {
    activeDrag = { abs: (y) => { set(fromY(y)); draw(); onChange(); } };
    activeDrag.abs(e.clientY);
    e.preventDefault();
  });
  el.addEventListener('wheel', (e) => { set(clamp(get() - Math.sign(e.deltaY) * 0.04)); draw(); onChange(); });
  el.addEventListener('dblclick', () => { set(0.5); draw(); onChange(); });
}

function buildAmps() {
  const host = $('amps');
  host.innerHTML = '';
  settings.amps.forEach((amp, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'amp';
    wrap.innerHTML = `
      <div class="fins"></div>
      <div class="amphead">
        <b>TARAMPS</b><em>${MODELS[i]}</em>
        <span class="meta"><span><i class="led pwr"></i>PWR</span><span><i class="led clip"></i>CLIP</span></span>
      </div>
      <div class="ampbody">
        <div class="kgroup main"></div>
        <div class="kgroup subs"></div>
        <div class="eqs"><div class="scale"><span>+12</span><span>0</span><span>-12</span></div></div>
      </div>
      <div class="eqtag"><span>CH ${i + 1}</span>7 BAND GRAPHIC EQUALIZER</div>`;
    const cell = (host, label, getter, setter, cls = '') => {
      const c = document.createElement('div');
      c.className = 'kcell ' + cls;
      c.innerHTML = `<div class="knob"></div><span>${label}</span>`;
      host.appendChild(c);
      makeKnob(c.firstChild, getter, setter, onKnob);
      knobs.push(c.firstChild);
    };
    const main = wrap.querySelector('.main'), subs = wrap.querySelector('.subs'), eqs = wrap.querySelector('.eqs');
    cell(main, 'VOL', () => amp.vol, (v) => (amp.vol = v));
    cell(main, 'FADER', () => amp.fader, (v) => (amp.fader = v));
    cell(subs, 'SUB VOL', () => amp.sub, (v) => (amp.sub = v), 'sub');
    cell(subs, 'FREQ', () => amp.freq, (v) => (amp.freq = v), 'sub');
    EQ_LABELS.forEach((l, b) => {
      const col = document.createElement('div');
      col.className = 'slcol';
      col.innerHTML = `<div class="sl"></div><span>${l}</span>`;
      eqs.appendChild(col);
      const c = col.firstChild;
      makeSlider(c, () => amp.eq[b], (v) => (amp.eq[b] = v), onKnob);
    });
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
  const s = { kind: 'audio', yt: null, netId, el: null, url: null, fx: true, factor: 0, settings: defaultSettings(), nodes: null,
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
    const muffle = c.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000; muffle.Q.value = 0.7;
    const pan = c.createStereoPanner();
    analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.6;
    node.connect(comp); comp.connect(muffle); muffle.connect(master); master.connect(pan); pan.connect(analyser); analyser.connect(c.destination);
    s.nodes = { stages, master, analyser, muffle, pan };
  }
}

// Si el AudioContext no arranca (politica de autoplay), reproducimos sin efectos para que al menos suene
function ensureCtxRunning(s) {
  if (!AC || AC.state === 'running' || !s.fx || !s.playing || sources[s.netId] !== s) return;
  AC.resume().catch(() => {}).finally(() => setTimeout(() => {
    if (AC.state === 'running' || !s.fx || sources[s.netId] !== s) return;
    const t = s.el.currentTime;
    buildElement(s, false); loadUrl(s, s.url, t); applySource(s);
    if (s.playing) s.el.play().catch(() => {});
    if (s.netId === currentNet) post('audioError', { msg: 'audio en modo simple (sin ecualizador): el motor de audio no pudo iniciarse' });
  }, 300));
}

function loadUrl(s, url, seek) {
  s.url = url;
  s.pendingSeek = seek || 0;
  s.el.src = url;
}

function applySource(s) {
  if (s.kind === 'yt') return ytVolume(s);
  const st = s.settings;
  const level = clamp(st.master) * s.factor;
  if (!s.nodes) { s.el.volume = clamp(level); return; }
  const t = AC.currentTime;
  s.nodes.master.gain.setTargetAtTime(level * 1.2, t, 0.05);
  s.nodes.pan.pan.setTargetAtTime(clamp(s.pan || 0, -1, 1), t, 0.1);
  // 0 = limpio (20 kHz), 1 = muy apagado (~250 Hz): fuera del carro solo retumba el bajo
  s.nodes.muffle.frequency.setTargetAtTime(20000 * Math.pow(250 / 20000, clamp(s.muffle || 0)), t, 0.1);
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
  const vid = ytId(state.url);
  s.playing = state.playing;
  if (vid) {
    if (s.kind !== 'yt') { s.el.pause(); s.kind = 'yt'; }
    syncYT(s, vid, state, pos);
  } else {
  if (s.kind === 'yt') { ytStop(s); s.kind = 'audio'; }
  if (s.url !== state.url) loadUrl(s, state.url, pos);
  else if (Math.abs(s.el.currentTime - pos) > 1.5) {
    if (s.el.readyState >= 1) s.el.currentTime = pos; else s.pendingSeek = pos;
  }
  if (s.fx && state.playing) setTimeout(() => ensureCtxRunning(s), 800);
  state.playing ? s.el.play().catch((e) => { if (netId === currentNet && e.name === 'NotAllowedError') post('audioError', { msg: 'el navegador bloqueo la reproduccion (' + e.name + ')' }); }) : s.el.pause();
  }
  applySource(s);

  if (netId === currentNet) {
    serverState = state;
    $('unit').classList.toggle('yt', s.kind === 'yt');
    if (!isDragging) { settings = JSON.parse(JSON.stringify(s.settings)); refreshKnobs(); }
    refreshDisplay();
  }
  renderSongs();
}

function removeSource(netId) {
  const s = sources[netId];
  if (s) { s.el.pause(); s.el.removeAttribute('src'); ytStop(s); delete sources[netId]; }
  if (netId === currentNet) { serverState = null; refreshDisplay(); renderSongs(); }
}

let isDragging = false;
window.addEventListener('mousedown', (e) => { isDragging = !!e.target.closest('.knob, .sl'); });
window.addEventListener('mouseup', () => { isDragging = false; });

/* ============================ YouTube (sin ecualizador) ============================ */
function ytId(u) {
  const m = String(u).match(/^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : null;
}
const cur = (s) => (s.kind === 'yt' ? (s.yt && s.yt.ready ? s.yt.player.getCurrentTime() || 0 : 0) : s.el.currentTime);
const dur = (s) => (s.kind === 'yt' ? (s.yt && s.yt.ready ? s.yt.player.getDuration() || 0 : 0) : s.el.duration);

let ytApi = null;
function loadYtApi() {
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve();
    window.onYouTubeIframeAPIReady = resolve;
    const t = document.createElement('script');
    t.src = 'https://www.youtube.com/iframe_api';
    t.onerror = () => { ytApi = null; post('audioError', { msg: 'no se pudo cargar el reproductor de YouTube (sin internet o bloqueado)' }); };
    document.head.appendChild(t);
  });
  return ytApi;
}

function ytWanted(s) {            // posicion actual segun el ultimo estado recibido
  const w = s.yt.want;
  return w.state.position + (w.state.playing ? w.pos0 - w.state.position + (performance.now() - w.recv) / 1000 : 0);
}

function ytApply(s) {
  const y = s.yt;
  if (!y.ready || !y.want) return;
  const { state } = y.want, p = y.player;
  if (y.id !== y.want.id) { y.id = y.want.id; p.loadVideoById({ videoId: y.id, startSeconds: ytWanted(s) }); }
  else if (Math.abs((p.getCurrentTime() || 0) - ytWanted(s)) > 2) p.seekTo(ytWanted(s), true);
  state.playing ? p.playVideo() : p.pauseVideo();
  ytVolume(s);
}

function ytVolume(s) {
  if (!s.yt || !s.yt.ready) return;
  s.yt.player.setVolume(Math.round(clamp(s.settings.master * s.factor) * 100));
}

function syncYT(s, id, state, pos) {
  if (!s.yt) s.yt = { ready: false, player: null, id: null, want: null };
  s.yt.want = { id, state, pos0: pos, recv: performance.now() };
  if (s.yt.player) return ytApply(s);
  s.yt.creating = true;
  loadYtApi().then(() => {
    if (s.yt.player || sources[s.netId] !== s) return;
    const host = document.createElement('div');
    host.id = 'yt-' + s.netId;
    $('ytHost').appendChild(host);
    s.yt.player = new YT.Player(host.id, {
      width: 200, height: 120, videoId: id,
      playerVars: { autoplay: 1, controls: 0, playsinline: 1, disablekb: 1, start: Math.floor(ytWanted(s)) },
      events: {
        onReady: () => { s.yt.ready = true; s.yt.id = id; ytApply(s); },
        onStateChange: (e) => {
          if (e.data === 1 || e.data === 5) {
            const d = s.yt.player.getVideoData && s.yt.player.getVideoData();
            if (d && d.title && s.ytTitle !== d.title) { s.ytTitle = d.title; if (s.netId === currentNet) refreshDisplay(); }
          }
          if (e.data === 0 && s.netId === currentNet) { if (uiOpen) autoNext(); else post('ended'); }
        },
        onError: (e) => {
          if (s.netId !== currentNet) return;
          const msg = { 2: 'enlace de YouTube invalido', 5: 'error del reproductor de YouTube', 100: 'el video no existe o es privado',
                        101: 'el dueño del video no permite reproducirlo fuera de YouTube', 150: 'el dueño del video no permite reproducirlo fuera de YouTube' };
          post('audioError', { msg: msg[e.data] || 'error de YouTube ' + e.data });
        }
      }
    });
  });
}

function ytStop(s) {
  if (!s.yt) return;
  try { s.yt.player && s.yt.player.destroy(); } catch (e) {}
  s.yt = null; s.ytTitle = null;
}

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
  const ys = sources[currentNet];
  $('track').textContent = st ? ((ys && ys.ytTitle) || st.title) : '—';
  document.querySelector('.icons').textContent = ys && ys.kind === 'yt' ? '\u25B6 YOUTUBE' : '\u266B USB';
  const idx = st ? library.findIndex((s) => s.url === st.url) : -1;
  $('trk').textContent = 'TR ' + String(idx + 1).padStart(2, '0');
  $('bPlay').classList.toggle('lit', !!(st && st.playing));
  $('bPause').classList.toggle('lit', !!(st && !st.playing));
  $('ledPwr').classList.toggle('on', !!st);
  $('ledUsb').classList.toggle('on', !!(st && st.playing));
  document.querySelectorAll('.led.pwr').forEach((l) => l.classList.toggle('on', !!(st && st.playing)));
  $('npTitle').textContent = st ? ((ys && ys.ytTitle) || st.title) : 'Nada sonando';
  $('npState').textContent = !st ? 'DETENIDO' : st.playing ? 'REPRODUCIENDO' : 'EN PAUSA';
  document.body.classList.toggle('playing', !!(st && st.playing));
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

function titleFromUrl(u) {
  try {
    const f = decodeURIComponent(new URL(u).pathname.split('/').pop() || '').replace(/\.(mp3|wav|ogg)$/i, '').replace(/[_+-]+/g, ' ').trim();
    return f ? f.slice(0, 40) : 'Reproducción rápida';
  } catch (e) { return 'Reproducción rápida'; }
}

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
document.addEventListener('mousedown', () => { if (AC && AC.state === 'suspended') AC.resume(); });
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
  getCtx(); { const u = normalizeUrl(url); post('play', { url: u, title: titleFromUrl(u) }); } $('quickUrl').value = '';
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
  if (s && dur(s)) post('seek', { time: ($('seek').value / 1000) * dur(s) });
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
    if (s && dur(s)) {
      $('time').textContent = `${fmt(cur(s))} / ${fmt(dur(s))}`;
      if (document.activeElement !== $('seek')) $('seek').value = (cur(s) / dur(s)) * 1000;
    } else $('time').textContent = '00:00 / 00:00';

    cx.clearRect(0, 0, cv.width, cv.height);
    const live = s && s.kind !== 'yt' && s.nodes && s.playing;
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
        cx.fillStyle = t > 0.8 ? '#ff4d6d' : t > 0.55 ? '#ffd83a' : accent;
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
    document.documentElement.style.setProperty('--bass', Math.max(0, (ownBass - 0.35) / 0.65).toFixed(3));
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
    case 'debug':
      post('debugInfo', {
        ctx: AC ? AC.state : 'sin-contexto', currentNet,
        sources: Object.values(sources).map((s) => ({ net: s.netId, kind: s.kind, fx: s.fx, factor: s.factor, playing: s.playing,
          paused: s.el.paused, t: s.el.currentTime, readyState: s.el.readyState, elVol: s.el.volume, muted: s.el.muted, url: s.url,
          master: s.nodes ? s.nodes.master.gain.value : null, pan: s.nodes ? s.nodes.pan.pan.value : null, lp: s.nodes ? Math.round(s.nodes.muffle.frequency.value) : null }))
      });
      break;
    case 'remove':
      removeSource(d.netId); break;
    case 'tick':
      if (AC && AC.state === 'suspended') AC.resume();
      if (d.inside != null && d.factors) d.factors[d.inside] = { f: 1, p: 0, m: 0 };   // dentro del vehiculo: sonido completo
      Object.entries(d.factors || {}).forEach(([id, v]) => {
        const s = sources[id]; if (!s || !v) return;
        if (typeof v === 'number') v = { f: v, p: 0, m: 0 };
        if (Math.abs(s.factor - v.f) > 0.01 || Math.abs((s.pan || 0) - v.p) > 0.03 || Math.abs((s.muffle || 0) - v.m) > 0.02) {
          s.factor = v.f; s.pan = v.p; s.muffle = v.m; applySource(s);
        }
      });
      $('temp').textContent = Math.round(d.temp) + '°C';
      $('volt').textContent = (d.volt + (sources[currentNet] && sources[currentNet].playing ? settings.master * -0.4 : 0)).toFixed(1);
      break;
  }
});

/* ============ Iluminacion (como las radios Pioneer de colores) ============ */
const THEMES = { azul: ['#35b5ff', '#1f6bff'], rojo: ['#ff4060', '#d0102e'], verde: ['#3dff8f', '#0fb25a'],
                 ambar: ['#ffb43a', '#e07800'], morado: ['#c27bff', '#7b2cff'], rosa: ['#ff5ad1', '#d4149e'] };
let accent = THEMES.azul[0];
function setTheme(name) {
  const t = THEMES[name] || THEMES.azul;
  accent = t[0];
  document.documentElement.style.setProperty('--cyan', t[0]);
  document.documentElement.style.setProperty('--blue', t[1]);
  document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s.dataset.t === name));
  try { localStorage.setItem('chipeo_theme', name); } catch (e) {}
}
document.querySelectorAll('.swatch').forEach((s) => { s.style.background = THEMES[s.dataset.t][0]; s.onclick = () => setTheme(s.dataset.t); });
let savedTheme = 'azul';
try { savedTheme = localStorage.getItem('chipeo_theme') || 'azul'; } catch (e) {}
setTheme(savedTheme);
$('bIllum').onclick = () => { const k = Object.keys(THEMES); setTheme(k[(k.indexOf(savedTheme = k[(k.indexOf(savedTheme) + 1) % k.length]))]); };

function fit() { document.documentElement.style.setProperty('--fit', Math.min(1, innerHeight / 760, innerWidth / 1030)); }
window.addEventListener('resize', fit); fit();

// primer render para que el DOM exista aunque el panel este oculto
buildAmps(); bindMaster(); updateVolPill(); renderSongs();
