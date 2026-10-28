'use strict';
const RES = typeof GetParentResourceName === 'function' ? GetParentResourceName() : 'flow-reports';
const post = (name, data = {}) =>
  fetch(`https://${RES}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => {});
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  bug: '<path d="M8 8h8v8a4 4 0 0 1-8 0zM9 4l2 2M15 4l-2 2M4 12h4M16 12h4M5 18l3-2M19 18l-3-2M5 7l3 2M19 7l-3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
  car: '<path d="M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16M4 16h16v3H4zM7 19v1M17 19v1"/>',
  other: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>'
};
const svg = (k) => `<svg viewBox="0 0 24 24">${ICONS[k] || ICONS.other}</svg>`;
const two = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
const clock = (secs) => secs >= 3600 ? `${Math.floor(secs / 3600)}h ${two((secs % 3600) / 60)}m` : `${two(secs / 60)}:${two(secs % 60)}`;
const ago = (secs) => secs < 60 ? 'ahora' : secs < 3600 ? `hace ${Math.floor(secs / 60)} min` : `hace ${Math.floor(secs / 3600)} h`;

let view = null;
let categories = [];
let selCat = null;
let minLen = 10, maxLen = 500;
let report = null;            // reporte propio (jugador)
let clockOffset = 0;          // serverNow - Date.now()/1000
let reports = [];             // admin
let me = null;
let selected = null;
let tab = 'all';
let isAdmin = false;
let seen = new Set();
let scaleMin = 0.5, scaleMax = 1.5;
const serverTime = () => Date.now() / 1000 + clockOffset;

/* ============================ jugador ============================ */
function renderCats() {
  const host = $('cats');
  host.innerHTML = '';
  categories.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'cat tile' + (selCat === c.id ? ' on' : '');
    b.style.animationDelay = 0.06 + i * 0.04 + 's';
    b.innerHTML = `<span class="ci">${svg(c.icon)}</span><b>${esc(c.label)}</b>`;
    b.onclick = () => { selCat = c.id; renderCats(); validate(); };
    host.appendChild(b);
  });
}
function validate() {
  const n = $('msg').value.trim().length;
  $('charCount').textContent = `${$('msg').value.length} / ${maxLen}`;
  $('btnSend').disabled = !selCat || n < minLen;
}
$('msg').addEventListener('input', validate);
$('btnSend').onclick = () => {
  if ($('btnSend').disabled) return;
  post('create', { category: selCat, message: $('msg').value.trim() });
};

function chatHtml(messages, mySide) {
  return messages.map((m, i) => {
    if (m.from === 'system') return `<div class="msg sys" style="animation-delay:${Math.min(i * 0.02, .3)}s"><div class="bubble">${esc(m.text)}</div></div>`;
    const mine = m.from === mySide;
    return `<div class="msg ${mine ? 'me' : 'them'} ${m.from}" style="animation-delay:${Math.min(i * 0.02, .3)}s">
      <span class="who">${esc(m.name)}${m.from === 'admin' && !mine ? ' · Admin' : ''}</span><div class="bubble">${esc(m.text)}</div></div>`;
  }).join('');
}
function scrollEnd(el) { requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; }); }

function renderPlayerReport() {
  if (!report) return;
  const cat = categories.find((c) => c.id === report.category);
  $('prId').textContent = '#' + report.id;
  $('prCat').textContent = cat ? cat.label : report.category;
  const claimed = report.status === 'claimed';
  $('prStatus').classList.toggle('claimed', claimed);
  $('prPos').textContent = claimed ? '✓' : report.position;
  $('prState').textContent = claimed ? `${report.admin} está atendiendo tu reporte` : `Posición #${report.position} en la cola`;
  $('prSub').textContent = claimed ? 'Puedes escribirle por aquí' : 'Esperando por respuesta de administrador';
  const chat = $('prChat');
  const before = chat.childElementCount;
  chat.innerHTML = chatHtml(report.messages, 'player');
  if (chat.childElementCount !== before) scrollEnd(chat);
}
$('prSend').onclick = () => {
  const t = $('prInput').value.trim();
  if (t) { post('playerMessage', { text: t }); $('prInput').value = ''; }
};
$('prInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('prSend').click(); });
$('prCancel').onclick = () => post('cancel');

let lastAdminMsgs = 0;
function renderWaitbar() {
  const wb = $('waitbar');
  if (!report || view === 'player') { if (!wb.classList.contains('done')) wb.classList.add('hidden'); return; }
  wb.classList.remove('hidden', 'done');
  const adminMsgs = report.messages.filter((m) => m.from === 'admin').length;
  const unread = adminMsgs > lastAdminMsgs;
  wb.classList.toggle('claimed', report.status === 'claimed');
  wb.classList.toggle('reply', unread);
  if (unread) {
    $('wTitle').textContent = `${report.admin || 'Un admin'} te respondió`;
    $('wSub').textContent = 'Usa /reportar para leer y contestar';
  } else if (report.status === 'claimed') {
    $('wTitle').textContent = `${report.admin} está atendiendo tu reporte`;
    $('wSub').textContent = `Reporte #${report.id} · /reportar para chatear`;
  } else {
    $('wTitle').textContent = 'Esperando por respuesta de administrador';
    $('wSub').textContent = `Posición #${report.position} en la cola · /reportar para ver`;
  }
}

function showDone(text) {
  const wb = $('waitbar');
  wb.classList.remove('hidden', 'claimed', 'reply');
  wb.classList.add('done');
  $('wTitle').textContent = text;
  $('wSub').textContent = 'Gracias por reportar';
  clearTimeout(showDone.t);
  showDone.t = setTimeout(() => { wb.classList.add('hidden'); wb.classList.remove('done'); }, 6000);
}

/* ============================ admin ============================ */
function filtered() {
  const q = $('aSearch').value.trim().toLowerCase();
  return reports.filter((r) => {
    if (tab === 'open' && r.status !== 'open') return false;
    if (tab === 'mine' && !(r.claimedBy && me && r.claimedBy.src === me.id)) return false;
    if (!q) return true;
    return String(r.id) === q.replace('#', '') || String(r.src) === q || r.name.toLowerCase().includes(q) || r.message.toLowerCase().includes(q);
  });
}

function renderList() {
  const open = reports.filter((r) => r.status === 'open').length;
  const claimed = reports.length - open;
  $('aSub').textContent = `${open} en cola · ${claimed} atendiendo`;
  const host = $('rList');
  host.innerHTML = '';
  const list = filtered();
  if (!list.length) { host.innerHTML = '<div class="empty"><b>No hay reportes</b>Todo tranquilo por ahora.</div>'; return; }
  list.forEach((r, i) => {
    const b = document.createElement('button');
    b.className = 'rep tile' + (selected === r.id ? ' on' : '') + (!seen.has(r.id) ? ' new' : '');
    b.style.animationDelay = Math.min(i * 0.03, 0.4) + 's';
    const st = r.offline ? '<span class="chip off">Desconectado</span>'
      : r.status === 'claimed' ? `<span class="chip st-claimed">${esc(r.claimedBy.name)}</span>` : '<span class="chip st-open">En cola</span>';
    b.innerHTML = `<div class="rtop"><span class="idpill">#${r.id}</span><b>${esc(r.name)} <small>(ID ${r.src})</small></b><small>${ago(serverTime() - r.created)}</small></div>
      <p>${esc(r.message)}</p><div class="rbot"><span class="chip">${svg(r.icon)}${esc(r.categoryLabel)}</span>${st}</div>`;
    b.onclick = () => { selected = r.id; seen.add(r.id); renderList(); renderDetail(true); };
    host.appendChild(b);
  });
}

function renderDetail(fresh) {
  const r = reports.find((x) => x.id === selected);
  $('aEmpty').classList.toggle('hidden', !!r);
  $('aDetail').classList.toggle('hidden', !r);
  if (!r) return;
  const mine = r.claimedBy && me && r.claimedBy.src === me.id;
  $('dId').textContent = '#' + r.id;
  $('dName').textContent = `${r.name}  ·  ID ${r.src}`;
  $('dMeta').textContent = `${r.categoryLabel} · creado ${ago(serverTime() - r.created)}`;
  const badge = $('dBadge');
  badge.className = 'badge' + (r.offline ? ' off' : r.status === 'claimed' ? ' claimed' : '');
  badge.textContent = r.offline ? 'DESCONECTADO' : r.status === 'claimed' ? (mine ? 'ATENDIENDO' : r.claimedBy.name.toUpperCase()) : 'EN COLA';
  $('dClaim').classList.toggle('hidden', r.status === 'claimed');
  $('dUnclaim').classList.toggle('hidden', !mine);
  $('actions').classList.toggle('locked', !!r.offline);
  const chat = $('aChat');
  const before = chat.childElementCount;
  chat.innerHTML = chatHtml(r.messages, 'admin');
  if (fresh || chat.childElementCount !== before) scrollEnd(chat);
  if (fresh) $('aInput').value = '';
}

document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => {
  tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  renderList();
}));
$('aSearch').addEventListener('input', renderList);
$('dClaim').onclick = () => post('claim', { id: selected });
$('dUnclaim').onclick = () => post('unclaim', { id: selected });
$('dClose').onclick = () => post('closeReport', { id: selected });
$('aSend').onclick = () => {
  const t = $('aInput').value.trim();
  if (t && selected) { post('reply', { id: selected, text: t }); $('aInput').value = ''; }
};
$('aInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('aSend').click(); });

document.querySelectorAll('#actions button').forEach((b) => (b.onclick = () => {
  const act = b.dataset.act;
  const r = reports.find((x) => x.id === selected);
  if (!r) return;
  if (act === 'scale') return openModal('scaleModal');
  if (act === 'kick') { $('kickName').textContent = r.name; $('kickReason').value = ''; return openModal('kickModal'); }
  post('action', { id: selected, action: act });
}));

/* ventanas */
function openModal(id) { $(id).classList.remove('hidden'); if (id === 'scaleModal') setScale(1); }
document.querySelectorAll('[data-mclose]').forEach((b) => (b.onclick = () => b.closest('.modal').classList.add('hidden')));
function setScale(v) {
  v = Math.min(scaleMax, Math.max(scaleMin, Number(v)));
  $('scaleRange').value = v;
  $('scaleRange').style.setProperty('--fill', ((v - scaleMin) / (scaleMax - scaleMin)) * 100 + '%');
  $('scaleVal').textContent = v.toFixed(2) + 'x';
  $('scalePed').style.transform = `scale(${v})`;
  document.querySelectorAll('.presets button').forEach((p) => p.classList.toggle('on', Number(p.dataset.s) === v));
}
$('scaleRange').addEventListener('input', (e) => setScale(e.target.value));
document.querySelectorAll('.presets button').forEach((p) => (p.onclick = () => setScale(p.dataset.s)));
$('scaleApply').onclick = () => { post('action', { id: selected, action: 'scale', value: Number($('scaleRange').value) }); $('scaleModal').classList.add('hidden'); };
$('kickApply').onclick = () => { post('action', { id: selected, action: 'kick', value: $('kickReason').value.trim() }); $('kickModal').classList.add('hidden'); };

function renderPill() {
  const open = reports.filter((r) => r.status === 'open').length;
  const pill = $('adminPill');
  pill.classList.toggle('hidden', !isAdmin || view === 'admin' || open === 0);
  $('adminPillText').textContent = `${open} ${open === 1 ? 'reporte abierto' : 'reportes abiertos'}`;
}

/* ============================ comun ============================ */
function show(v) {
  view = v;
  $('pForm').classList.toggle('hidden', !(v === 'player' && !report));
  $('pReport').classList.toggle('hidden', !(v === 'player' && report));
  $('admin').classList.toggle('hidden', v !== 'admin');
  ['pForm', 'pReport', 'admin'].forEach((id) => { const el = $(id); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
  document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
  renderWaitbar(); renderPill();
}

function toast(msg, kind = 'info', title) {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = `<i></i><span>${title ? `<b>${esc(title)}</b>` : ''}${esc(msg)}</span>`;
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, kind === 'report' ? 6000 : 3400);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => post('close')));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !view) return;
  const m = [...document.querySelectorAll('.modal')].find((x) => !x.classList.contains('hidden'));
  if (m) return m.classList.add('hidden');
  post('close');
});

// relojes (espera del jugador y "hace X min" del admin)
setInterval(() => {
  if (report) {
    const t = clock(serverTime() - report.created);
    $('prTimer').textContent = t; $('wTimer').textContent = t;
  }
  if (view === 'admin') document.querySelectorAll('.rep .rtop > small').forEach((el, i) => {
    const r = filtered()[i]; if (r) el.textContent = ago(serverTime() - r.created);
  });
}, 1000);

window.addEventListener('message', ({ data: d }) => {
  switch (d.action) {
    case 'openPlayer':
      categories = d.categories || categories; minLen = d.min || minLen; maxLen = d.max || maxLen;
      $('msg').maxLength = maxLen;
      report = d.report || null;
      if (report) { clockOffset = report.serverNow - Date.now() / 1000; lastAdminMsgs = report.messages.filter((m) => m.from === 'admin').length; renderPlayerReport(); }
      else { selCat = null; $('msg').value = ''; renderCats(); validate(); }
      show('player');
      break;
    case 'playerUpdate': {
      const r = d.report;
      if (!r || r.status === 'closed') {
        const wasOpen = !!report;
        report = null;
        if (view === 'player') show('player');
        if (wasOpen && r) showDone(r.messages[r.messages.length - 1].text);
        break;
      }
      const isNew = !report;
      report = r;
      clockOffset = r.serverNow - Date.now() / 1000;
      if (view === 'player') {
        lastAdminMsgs = r.messages.filter((m) => m.from === 'admin').length;
        if (isNew) { show('player'); toast('Reporte enviado. Te avisaremos cuando un admin lo tome.', 'success'); }
        renderPlayerReport();
      }
      renderWaitbar();
      break;
    }
    case 'openAdmin':
      isAdmin = true; me = d.me; reports = d.reports || [];
      clockOffset = d.serverNow - Date.now() / 1000;
      scaleMin = d.scaleMin || scaleMin; scaleMax = d.scaleMax || scaleMax;
      $('scaleRange').min = scaleMin; $('scaleRange').max = scaleMax;
      if (!reports.some((r) => r.id === selected)) selected = null;
      show('admin'); renderList(); renderDetail(true);
      break;
    case 'adminUpdate':
      isAdmin = true; reports = d.reports || [];
      clockOffset = d.serverNow - Date.now() / 1000;
      if (d.newReport) toast(`${d.newReport.name} (ID ${d.newReport.src}): ${d.newReport.message.slice(0, 60)}`, 'report', `Nuevo reporte #${d.newReport.id} · ${d.newReport.categoryLabel}`);
      if (view === 'admin') { renderList(); renderDetail(false); }
      renderPill();
      break;
    case 'notify':
      toast(d.msg, d.kind);
      break;
    case 'close':
      if (view === 'player' && report) lastAdminMsgs = report.messages.filter((m) => m.from === 'admin').length;
      show(null);
      break;
  }
});
