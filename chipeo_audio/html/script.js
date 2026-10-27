'use strict';
const post = (name, data = {}) =>
  fetch(`https://${GetParentResourceName()}/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  }).catch(() => {});
const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

const EQ_FREQS = [50, 125, 320, 750, 2200, 6000, 16000];
const EQ_LABELS = ['50Hz', '125Hz', '320Hz', '750Hz', '2.2KHz', '6KHz', '16KHz'];

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
    bassBoost: false,
    mode8d: false,
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

const KNOB_HTML = { vk: '<i class="ring"></i><i class="rot"></i>', pk: '<i class="pled"></i><i class="prot"></i>' };
function makeKnob(el, get, set, onChange) {
  if (!el.firstChild) el.innerHTML = KNOB_HTML[el.className.split(' ')[0]] || '';
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

const UNITS = ['FRONT', 'MIDS', 'SUBS'];
function buildAmps() {
  const host = $('amps');
  host.innerHTML = '';
  settings.amps.forEach((amp, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'equnit';
    wrap.innerHTML = `<div class="eqmodel">EQ7-15<span>${UNITS[i]}</span></div><div class="eqrow"></div><div class="eqbrand">PRV</div>`;
    const row = wrap.querySelector('.eqrow');
    const cell = (label, getter, setter, scale) => {
      const c = document.createElement('div');
      c.className = 'kc';
      c.innerHTML = `<span class="kl">${label}</span><div class="pk"></div><div class="sc">${scale.map((s) => `<i>${s}</i>`).join('')}</div>`;
      row.appendChild(c);
      makeKnob(c.querySelector('.pk'), getter, setter, onKnob);
    };
    cell('Sub level', () => amp.sub, (v) => (amp.sub = v), ['-12', '0', '+12']);
    cell('Volume', () => amp.vol, (v) => (amp.vol = v), ['0', '', '10']);
    const aux = document.createElement('div');
    aux.className = 'aux';
    aux.innerHTML = '<span class="kl">AUX</span><div class="jack"></div>';
    row.appendChild(aux);
    cell('FADER', () => amp.fader, (v) => (amp.fader = v), ['R', '', 'F']);
    EQ_LABELS.forEach((l, b) => cell(l, () => amp.eq[b], (v) => (amp.eq[b] = v), ['-12', '0', '+12']));
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
    const boost = c.createBiquadFilter(); boost.type = 'lowshelf'; boost.frequency.value = 80;
    node.connect(boost); node = boost;
    const comp = c.createDynamicsCompressor(), master = c.createGain(), analyser = c.createAnalyser();
    const muffle = c.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000; muffle.Q.value = 0.7;
    const pan = c.createStereoPanner();
    analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.6;
    // 8D: el sonido gira alrededor de la cabeza (panorama con LFO) + un poco de sala
    const pan8 = c.createStereoPanner(), lfo = c.createOscillator(), lfoAmt = c.createGain();
    lfo.frequency.value = 0.12; lfoAmt.gain.value = 0; lfo.connect(lfoAmt); lfoAmt.connect(pan8.pan); lfo.start();
    const verb = c.createConvolver(), wet = c.createGain(), dry = c.createGain();
    verb.buffer = roomImpulse(c); wet.gain.value = 0; dry.gain.value = 1;
    node.connect(comp); comp.connect(dry); comp.connect(verb); verb.connect(wet);
    dry.connect(pan8); wet.connect(pan8);
    pan8.connect(muffle); muffle.connect(master); master.connect(pan); pan.connect(analyser); analyser.connect(c.destination);
    // golpes medidos ANTES del volumen por distancia: la fuerza por cercania la aplica el cliente Lua
    const beatAn = c.createAnalyser(); beatAn.fftSize = 512; beatAn.smoothingTimeConstant = 0.15;
    comp.connect(beatAn);
    s.nodes = { stages, master, analyser, muffle, pan, boost, beatAn, lfoAmt, wet, dry };
    s.beat = { hist: [0], prev: 0, last: 0 };
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

function roomImpulse(c) {
  const len = Math.floor(c.sampleRate * 1.8), buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
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
  s.nodes.boost.gain.setTargetAtTime(st.bassBoost ? 9 : 0, t, 0.1);
  s.nodes.lfoAmt.gain.setTargetAtTime(st.mode8d ? 0.95 : 0, t, 0.3);
  s.nodes.wet.gain.setTargetAtTime(st.mode8d ? 0.35 : 0, t, 0.3);
  s.nodes.dry.gain.setTargetAtTime(st.mode8d ? 0.85 : 1, t, 0.3);
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
window.addEventListener('mousedown', (e) => { isDragging = !!e.target.closest('.pk, .vk'); });
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
  buildAmps(); bindMaster(); updateVolPill();
  $('bBass').classList.toggle('on', !!settings.bassBoost);
  $('b8d').classList.toggle('on', !!settings.mode8d);
}
function bindMaster() {
  const el = $('knob-master');
  const fresh = el.cloneNode(false);
  el.replaceWith(fresh);
  makeKnob(fresh, () => settings.master, (v) => (settings.master = v), () => { lcdFlash('VOLUME ' + volNum()); onKnob(); });
}
const volNum = () => String(Math.round(settings.master * 40)).padStart(2, ' ');

function fmt(t) {
  if (!isFinite(t)) t = 0;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
}

/* ---- pantalla de 14 segmentos ---- */
const LCD_N = 11;
let lcdMsg = null, lcdUntil = 0, scrollPos = 0, lastScroll = 0, dispMode = 0, lastLcdBase = '';
let shuffle = false, repeat = false, premute = null;
function lcdFlash(t, ms = 1400) { lcdMsg = t; lcdUntil = performance.now() + ms; }
const lcdClean = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 \-.:/']/g, ' ');
function currentTitle() {
  const st = serverState, ys = sources[currentNet];
  return st ? ((ys && ys.ytTitle) || st.title) : '';
}
function lcdRender(now) {
  const st = serverState, s = sources[currentNet];
  let base;
  if (now < lcdUntil) base = lcdMsg;
  else if (!st) base = premute != null ? 'MUTE' : 'USB';
  else if (!st.playing) base = 'PAUSE';
  else if (dispMode === 1) base = (s ? fmt(cur(s)) : '00:00') + ' TR' + String(Math.max(0, library.findIndex((x) => x.url === st.url) + 1)).padStart(2, '0');
  else base = currentTitle();
  base = lcdClean(base);
  if (base !== lastLcdBase) { lastLcdBase = base; scrollPos = 0; lastScroll = now + 900; }
  let out = base;
  if (base.length > LCD_N) {
    if (now - lastScroll > 330) { scrollPos++; lastScroll = now; }
    const loop = base + '    ';
    out = (loop + loop).substr(scrollPos % loop.length, LCD_N);
  } else out = base.length < LCD_N ? base.padEnd(LCD_N, ' ') : base;
  $('lcdText').textContent = out.replace(/ /g, '!');   // '!' = segmento vacio en DSEG
  $('lcd').classList.toggle('dim', dispMode === 2);
}

function refreshDisplay() {
  const st = serverState;
  const ys = sources[currentNet];
  $('bPlay').classList.toggle('lit', !!(st && st.playing));
  $('bPause').classList.toggle('lit', !!(st && !st.playing));
  $('bShuf').classList.toggle('lit', shuffle); $('icShuf').classList.toggle('on', shuffle);
  $('bRep').classList.toggle('lit', repeat); $('icRep').classList.toggle('on', repeat);
  $('bMute').classList.toggle('on', premute != null);
  $('ledPwr').classList.toggle('on', !!st);
  $('ledUsb').classList.toggle('on', !!(st && st.playing));
  $('npTitle').textContent = st ? currentTitle() : 'Nada sonando';
  $('npSrc').textContent = st ? sourceLabel(st.url) : 'Elige una canción o pega un enlace';
  $('npState').textContent = !st ? 'DETENIDO' : st.playing ? 'REPRODUCIENDO' : 'EN PAUSA';
  document.body.classList.toggle('playing', !!(st && st.playing));
  if (ys && ys.kind === 'yt') document.querySelector('.model').textContent = 'YOUTUBE'; else document.querySelector('.model').textContent = 'MVH-S235BT';
}

const ICON_DEL = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
function kindOf(u) {
  if (!u) return '';
  if (ytId(u)) return 'yt';
  if (/^https?:\/\//i.test(u)) return 'file';
  return 'bad';
}
function sourceLabel(u) {
  if (ytId(u)) return 'YouTube';
  const ext = (u.split(/[?#]/)[0].match(/\.(mp3|wav|ogg)$/i) || [])[1];
  return (ext ? ext.toUpperCase() + ' · ' : '') + hostOf(u);
}

function renderSongs() {
  const host = $('songs');
  const q = ($('search').value || '').trim().toLowerCase();
  $('libCount').textContent = `USB · ${library.length} ${library.length === 1 ? 'canción' : 'canciones'}`;
  if (!library.length) {
    host.innerHTML = '<div class="empty"><b>&#9835;</b>Tu biblioteca está vacía.<br>Pega un enlace arriba y pulsa <u>Guardar</u>.</div>';
    return;
  }
  host.innerHTML = '';
  let shown = 0;
  library.forEach((s, i) => {
    if (q && !s.title.toLowerCase().includes(q)) return;
    shown++;
    const k = kindOf(s.url);
    const d = document.createElement('div');
    d.className = 'song' + (serverState && serverState.url === s.url ? ' active' : '');
    d.innerHTML = `<span class="idx">${String(i + 1).padStart(2, '0')}</span><span class="pl">&#9654;</span><span class="eqa"><i></i><i></i><i></i></span>
      <span class="stype ${k}">${k === 'yt' ? 'YT' : 'MP3'}</span><div class="info"><b></b><small></small></div>
      <button class="del" title="Eliminar">${ICON_DEL}</button>`;
    d.querySelector('b').textContent = s.title;
    d.querySelector('small').textContent = sourceLabel(s.url);
    d.addEventListener('click', () => playSong(s));
    d.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); post('removeSong', { id: s.id }); });
    host.appendChild(d);
  });
  if (!shown) host.innerHTML = '<div class="empty">Sin resultados</div>';
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
  if (shuffle && library.length > 1) {
    let r; do { r = Math.floor(Math.random() * library.length); } while (r === i);
    return playSong(library[r]);
  }
  playSong(library[(i + dir + library.length) % library.length]);
}
function autoNext() {
  if (repeat && serverState) return post('seek', { time: 0 });
  if (library.length > 1 || (library.length === 1 && serverState && library[0].url !== serverState.url)) step(1); else post('ended');
}

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
  if (!url) return toast('Pega un enlace de YouTube o .mp3');
  post('addSong', { title: $('songTitle').value.trim(), url: normalizeUrl(url) });
  $('songUrl').value = ''; $('songTitle').value = ''; updateKind();
};
$('btnClone').onclick = () => post('clone', { title: $('songTitle').value.trim() });
$('btnQuick').onclick = () => {
  const url = $('songUrl').value.trim();
  if (!url) return toast('Pega un enlace de YouTube o .mp3');
  getCtx();
  const u = normalizeUrl(url);
  post('play', { url: u, title: $('songTitle').value.trim() || titleFromUrl(u) });
  $('songUrl').value = ''; $('songTitle').value = ''; updateKind();
};
function updateKind() {
  const k = kindOf($('songUrl').value.trim());
  const el = $('urlKind');
  el.className = 'kind ' + k;
  el.textContent = { yt: 'YOUTUBE', file: 'AUDIO', bad: 'NO VÁLIDO' }[k] || 'LINK';
}
$('songUrl').addEventListener('input', updateKind);
$('songUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnQuick').click(); });
$('search').addEventListener('input', renderSongs);
$('bPlay').onclick = () => {
  getCtx();
  if (!serverState) { if (library[0]) playSong(library[0]); else lcdFlash('NO MUSIC'); }
  else if (!serverState.playing) post('resume');
};
$('bPause').onclick = () => post('pause');
$('bSrc').onclick = () => { post('stop'); lcdFlash('SRC OFF'); };
$('bPrev').onclick = () => step(-1);
$('bNext').onclick = () => step(1);
const nudgeVol = (d) => { settings.master = clamp(settings.master + d); bindMaster(); lcdFlash('VOLUME ' + volNum()); onKnob(); };
$('bVolUp').onclick = () => nudgeVol(0.025);
$('bVolDn').onclick = () => nudgeVol(-0.025);
$('bShuf').onclick = () => { shuffle = !shuffle; lcdFlash(shuffle ? 'SHUFFLE ON' : 'SHUFFLE OFF'); refreshDisplay(); };
$('bRep').onclick = () => { repeat = !repeat; lcdFlash(repeat ? 'REPEAT ONE' : 'REPEAT OFF'); refreshDisplay(); };
$('bDisp').onclick = () => { dispMode = (dispMode + 1) % 3; lcdFlash(['TITLE', 'TIME', 'DISP OFF'][dispMode], 900); };
$('b8d').onclick = () => {
  settings.mode8d = !settings.mode8d;
  $('b8d').classList.toggle('on', settings.mode8d);
  lcdFlash(settings.mode8d ? '8D AUDIO ON' : '8D AUDIO OFF'); onKnob();
};
$('bBass').onclick = () => {
  settings.bassBoost = !settings.bassBoost;
  $('bBass').classList.toggle('on', settings.bassBoost);
  lcdFlash(settings.bassBoost ? 'BASS BOOST 9' : 'BASS BOOST 0'); onKnob();
};
$('bMute').onclick = () => {
  if (premute == null) { premute = settings.master; settings.master = 0; lcdFlash('MUTE'); }
  else { settings.master = premute; premute = null; lcdFlash('VOLUME ' + volNum()); }
  bindMaster(); onKnob(); refreshDisplay();
};
$('seek').addEventListener('change', () => {
  const s = sources[currentNet];
  if (s && dur(s)) post('seek', { time: ($('seek').value / 1000) * dur(s) });
});
$('lcdGhost').textContent = '~'.repeat(LCD_N);

/* ============================ Bucle de pantalla ============================ */
const npBars = [...$('npBars').children];
const fbuf = new Uint8Array(256);
let ownBass = 0;

function frame(now) {
  const s = sources[currentNet];
  if (uiOpen) {
    lcdRender(now);
    if (s && dur(s) && document.activeElement !== $('seek')) {
      const p = (cur(s) / dur(s)) * 1000;
      $('seek').value = p; $('seek').style.setProperty('--prog', p / 10 + '%');
    } else if (!s) $('seek').style.setProperty('--prog', '0%');
    const d = s ? dur(s) : 0;
    $('npProg').style.width = d ? (cur(s) / d) * 100 + '%' : '0%';
    $('npCur').textContent = fmt(s && d ? cur(s) : 0).replace(/^0/, '');
    $('npDur').textContent = fmt(d).replace(/^0/, '');
    const live = s && s.playing;
    npBars.forEach((b, i) => { b.style.height = (live ? 3 + Math.max(0, Math.min(1, ownBass + Math.sin(now / (120 + i * 40)) * 0.3)) * 11 : 3) + 'px'; });
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
    detectBeat(src, id);
    if (b > max) max = b;
    if (String(id) === String(currentNet)) own = b;
  }
  ownBass = ownBass * 0.5 + own * 0.5;
  if (Math.abs(max - lastBass) > 0.03 || (max === 0 && lastBass !== 0)) { lastBass = max; post('bass', { level: max }); }
}, 40);

// golpe de bajo (kick / 808): subida brusca respecto al minimo de los ultimos ~200 ms
function detectBeat(src, id) {
  const bt = src.beat;
  src.nodes.beatAn.getByteFrequencyData(fbuf);
  const k = (fbuf[0] * 0.35 + fbuf[1] * 0.4 + fbuf[2] * 0.25) / 255;
  const now = performance.now();
  if (k > 0.3 && k - Math.min(...bt.hist) > 0.15 && k >= bt.prev && now - bt.last > 170) {
    bt.last = now;
    // el volumen general del equipo tambien cuenta (con el equipo bajito casi no se mueve)
    post('beat', { netId: Number(id), level: k * clamp(src.settings.master * 1.4) });
  }
  bt.hist.push(k); if (bt.hist.length > 5) bt.hist.shift();
  bt.prev = k;
}

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
const THEMES = { rojo: ['#ff3b30', '#e0101a'], naranja: ['#ff8a1f', '#e85d00'], blanco: ['#f4f6ff', '#b9c0d4'],
                 azul: ['#35b5ff', '#1f6bff'], verde: ['#3dff8f', '#0fb25a'], morado: ['#c27bff', '#7b2cff'] };
let theme = 'rojo';
function setTheme(name) {
  if (!THEMES[name]) name = 'rojo';
  theme = name;
  const t = THEMES[name];
  document.documentElement.style.setProperty('--cyan', t[0]);
  document.documentElement.style.setProperty('--blue', t[1]);
  document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s.dataset.t === name));
  try { localStorage.setItem('chipeo_theme', name); } catch (e) {}
}
document.querySelectorAll('.swatch').forEach((s) => { s.style.background = THEMES[s.dataset.t][0]; s.onclick = () => setTheme(s.dataset.t); });
try { theme = localStorage.getItem('chipeo_theme') || 'rojo'; } catch (e) {}
setTheme(theme);
$('bIllum').onclick = () => { const k = Object.keys(THEMES); setTheme(k[(k.indexOf(theme) + 1) % k.length]); lcdFlash('COLOR ' + theme.toUpperCase()); };

function fit() { document.documentElement.style.setProperty('--fit', Math.min(1, innerHeight / 760, innerWidth / 1030)); }
window.addEventListener('resize', fit); fit();

// primer render para que el DOM exista aunque el panel este oculto
buildAmps(); bindMaster(); updateVolPill(); renderSongs();
