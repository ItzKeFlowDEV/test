'use strict';
const RES = typeof GetParentResourceName === 'function' ? GetParentResourceName() : 'flow-peds';
const post = (name, data = {}) =>
  fetch(`https://${RES}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    .then((r) => r.json()).catch(() => ({}));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let view = null;
let peds = [];
let current = null;
let players = [];
let selected = null;
let imageUrl = 'https://docs.fivem.net/peds/%s.webp';
let customImages = {};

const imgFor = (model) => customImages[model] || imageUrl.replace('%s', encodeURIComponent(model));
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>';

function pedCard(p, i, opts = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (p.model === current && !opts.admin ? ' on' : '');
  el.style.animationDelay = Math.min(0.08 + i * 0.03, 0.5) + 's';
  el.innerHTML = `<span class="pill">EN USO</span>${opts.admin ? `<button class="rm" title="Quitar acceso">${ICON_X}</button>` : ''}
    <div class="img"><img alt="" loading="lazy"><span class="sil"></span></div>
    <div class="meta"><b>${esc(p.label || p.model)}</b><small>${esc(p.model)}</small></div>`;
  const img = el.querySelector('img');
  img.onerror = () => el.querySelector('.img').classList.add('noimg');
  img.src = imgFor(p.model);
  return el;
}

/* ============================ menu del jugador ============================ */
function renderMenu() {
  const q = $('menuSearch').value.trim().toLowerCase();
  const grid = $('pedGrid');
  grid.innerHTML = '';
  $('btnNormal').classList.toggle('on', !current);
  $('menuCount').textContent = peds.length;
  $('menuSub').textContent = current ? `Usando: ${(peds.find((p) => p.model === current) || {}).label || current}` : 'Usando tu personaje normal';
  const list = peds.filter((p) => !q || p.model.includes(q) || (p.label || '').toLowerCase().includes(q));
  if (!peds.length) {
    grid.innerHTML = '<div class="empty"><b>Aún no tienes peds</b>Pide a un administrador que te dé acceso a alguno.</div>';
    return;
  }
  if (!list.length) { grid.innerHTML = '<div class="empty"><b>Sin resultados</b>Prueba con otro nombre.</div>'; return; }
  list.forEach((p, i) => {
    const c = pedCard(p, i);
    c.onclick = () => { if (p.model !== current) post('use', { model: p.model }); };
    grid.appendChild(c);
  });
}
$('menuSearch').addEventListener('input', renderMenu);
$('btnNormal').onclick = () => { if (current) post('normal'); };

/* ============================ panel admin ============================ */
function renderPlayers() {
  const q = $('playerSearch').value.trim().toLowerCase();
  const host = $('playerList');
  host.innerHTML = '';
  $('playerCount').textContent = players.length;
  const list = players.filter((p) => !q || String(p.id) === q || p.name.toLowerCase().includes(q));
  if (!list.length) { host.innerHTML = '<div class="empty"><b>Nadie encontrado</b></div>'; return; }
  list.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'player tile' + (selected === p.id ? ' on' : '');
    b.style.animationDelay = Math.min(i * 0.025, 0.4) + 's';
    b.innerHTML = `<span class="idpill">${p.id}</span><b>${esc(p.name)}</b><small>${p.peds.length} ${p.peds.length === 1 ? 'ped' : 'peds'}</small>`;
    b.onclick = () => { selected = p.id; renderPlayers(); renderSelected(true); };
    host.appendChild(b);
  });
}

function renderSelected(fresh) {
  const p = players.find((x) => x.id === selected);
  $('selEmpty').classList.toggle('hidden', !!p);
  $('selContent').classList.toggle('hidden', !p);
  if (!p) return;
  $('selId').textContent = '#' + p.id;
  $('selName').textContent = p.name;
  $('selInfo').textContent = `${p.peds.length} ${p.peds.length === 1 ? 'ped asignado' : 'peds asignados'}`;
  $('selCount').textContent = p.peds.length;
  if (fresh) { $('grantModel').value = ''; $('grantLabel').value = ''; updatePreview(); }
  const grid = $('selGrid');
  grid.innerHTML = '';
  if (!p.peds.length) { grid.innerHTML = '<div class="empty"><b>Sin peds</b>Escribe un modelo arriba para darle acceso.</div>'; return; }
  p.peds.forEach((ped, i) => {
    const c = pedCard(ped, i, { admin: true });
    c.querySelector('.rm').onclick = (e) => { e.stopPropagation(); post('revoke', { target: p.id, model: ped.model }); };
    grid.appendChild(c);
  });
}

let prevTimer = null;
function updatePreview() {
  const m = $('grantModel').value.trim().toLowerCase();
  const box = $('grantPrev'), img = $('grantImg');
  $('grantModel').parentElement.classList.remove('bad');
  clearTimeout(prevTimer);
  box.classList.remove('noimg');
  if (!m) { box.classList.add('empty-prev'); img.removeAttribute('src'); return; }
  prevTimer = setTimeout(() => {
    box.classList.remove('empty-prev');
    img.onerror = () => box.classList.add('noimg');
    img.src = imgFor(m);
  }, 250);
}
$('grantModel').addEventListener('input', updatePreview);
$('playerSearch').addEventListener('input', renderPlayers);

async function grant() {
  const model = $('grantModel').value.trim().toLowerCase();
  if (!selected || !model) { $('grantModel').parentElement.classList.add('bad'); return; }
  const r = await post('grant', { target: selected, model, label: $('grantLabel').value.trim() });
  if (r && r.ok === false) {
    $('grantModel').parentElement.classList.add('bad');
    toast(r.msg || 'Modelo no válido', 'error');
    return;
  }
  $('grantModel').value = ''; $('grantLabel').value = ''; updatePreview();
}
$('btnGrant').onclick = grant;
['grantModel', 'grantLabel'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') grant(); }));
$('btnRefresh').onclick = () => post('refresh');

/* ============================ comun ============================ */
function show(v) {
  view = v;
  $('menu').classList.toggle('hidden', v !== 'menu');
  $('admin').classList.toggle('hidden', v !== 'admin');
  // reinicia las animaciones de entrada
  ['menu', 'admin'].forEach((id) => { const el = $(id); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
}

function toast(msg, kind = 'info') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = `<i></i><span>${esc(msg)}</span>`;
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 3200);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => post('close')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && view) post('close'); });

window.addEventListener('message', ({ data: d }) => {
  if (d.imageUrl) imageUrl = d.imageUrl;
  if (d.customImages) customImages = d.customImages;
  switch (d.action) {
    case 'openMenu':
      peds = d.peds || []; current = d.current || null;
      $('menuSearch').value = '';
      show('menu'); renderMenu();
      break;
    case 'openAdmin':
      players = d.players || []; current = d.current || null;
      if (!players.some((p) => p.id === selected)) selected = null;
      $('playerSearch').value = '';
      show('admin'); renderPlayers(); renderSelected(true);
      break;
    case 'adminData':
      players = d.players || [];
      renderPlayers(); renderSelected(false);
      break;
    case 'myPeds':
      peds = d.peds || [];
      if (view === 'menu') renderMenu();
      break;
    case 'current':
      current = d.current || null;
      if (view === 'menu') renderMenu();
      break;
    case 'notify':
      toast(d.msg, d.kind);
      break;
    case 'close':
      show(null);
      break;
  }
});
