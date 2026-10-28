'use strict';
const RES = typeof GetParentResourceName === 'function' ? GetParentResourceName() : 'flow-billing';
const post = (name, data = {}) =>
  fetch(`https://${RES}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => {});
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/>',
  medic: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5"/><path d="M14.5 6.5L17 4l3 3-2.5 2.5"/>',
  car: '<path d="M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16M4 16h16v3H4zM7 19v1M17 19v1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>'
};
const svg = (k) => `<svg viewBox="0 0 24 24">${ICONS[k] || ICONS.receipt}</svg>`;

let D = null;                  // datos del servidor
let tab = 'mine';
let mineFilter = 'unpaid', coFilter = 'all';
let selBill = null;
let target = null, nearby = [];
let preset = null;
let payMethod = 'bank';
let kind = 'job';
let clockOffset = 0;

const cur = () => (D && D.currency) || '$';
const money = (n) => cur() + Math.floor(Number(n) || 0).toLocaleString('en-US');
const nowS = () => Date.now() / 1000 + clockOffset;
const fdate = (t) => {
  const d = new Date((t - clockOffset) * 1000);
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) + ' · ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
};
const ago = (t) => { const s = nowS() - t; return s < 60 ? 'ahora' : s < 3600 ? `hace ${Math.floor(s / 60)} min` : s < 86400 ? `hace ${Math.floor(s / 3600)} h` : `hace ${Math.floor(s / 86400)} d`; };
const jobOf = (b) => (D && D.jobs[b.job]) || { label: b.jobLabel, color: '#FF2D78', icon: 'receipt' };
const pad = (n) => String(n).padStart(6, '0');
const STATUS = { unpaid: 'PENDIENTE', paid: 'PAGADA', cancelled: 'ANULADA', overdue: 'VENCIDA' };
const overdue = (b) => b.status === 'unpaid' && b.due > 0 && nowS() > b.due;
const statusOf = (b) => (overdue(b) ? 'overdue' : b.status);
const owed = (b) => b.amount + (b.status === 'unpaid' ? (b.fee || 0) : 0);
const paidTotal = (b) => b.amount + (b.fee || 0);
const left = (t) => { const s = t - nowS(); if (s <= 0) return 'vencida'; const h = Math.floor(s / 3600); return h >= 24 ? `en ${Math.floor(h / 24)} d ${h % 24} h` : h > 0 ? `en ${h} h` : `en ${Math.ceil(s / 60)} min`; };
const cfgFor = (k) => (k === 'personal' ? D.personal : D.job);

/* ============================ cabecera ============================ */
function renderHead() {
  const me = D.me;
  $('meLine').textContent = `${me.name} · ${me.jobLabel || 'Ciudadano'}`;
  $('meBank').textContent = money(me.bank);
  $('meCash').textContent = money(me.cash);
  const unpaid = D.myBills.filter((b) => b.status === 'unpaid').length;
  $('unpaidBadge').textContent = unpaid;
  $('unpaidBadge').classList.toggle('hidden', !unpaid);
  const canCreate = me.canBillJob || me.canBillPersonal || (D.job && me.jobBlocked);
  $('tabCreateBtn').classList.toggle('hidden', !canCreate);
  $('tabCompanyBtn').classList.toggle('hidden', !me.isBoss);
  if ((tab === 'create' && !canCreate) || (tab === 'company' && !me.isBoss)) setTab('mine');
}
function setTab(t) {
  tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  ['mine', 'create', 'company'].forEach((x) => $('tab-' + x).classList.toggle('hidden', x !== t));
  if (t === 'create') { renderCreate(); if (!nearby.length) askNearby(); }
  if (t === 'company') renderCompany();
}
document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

/* ============================ recibo ============================ */
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const fday = (t) => new Date((t - clockOffset) * 1000).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
// codigo de transaccion estable a partir del id
const txCode = (id) => { let h = 2166136261 ^ id; for (let i = 0; i < 6; i++) h = Math.imul(h ^ (h >>> 13), 16777619); return 'FB-' + pad(id) + '-' + ((h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 4)); };
// QR decorativo (21x21) con sus tres marcas de esquina, siempre igual para la misma factura
function qrSvg(seed) {
  const n = 21; let x = (seed * 9301 + 49297) % 233280 || 7;
  const rnd = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  let cells = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!finder(r, c) && rnd() > 0.52) cells += `M${c} ${r}h1v1h-1z`;
  const box = (r, c) => `M${c} ${r}h7v7h-7zM${c + 1} ${r + 1}v5h5v-5zM${c + 2} ${r + 2}h3v3h-3z`;
  return `<svg class="qr" viewBox="-1 -1 23 23" shape-rendering="crispEdges"><rect x="-1" y="-1" width="23" height="23" fill="#fff" rx="1"/>
    <path fill-rule="evenodd" fill="#0b0a0c" d="${box(0, 0)}${box(0, n - 7)}${box(n - 7, 0)}${cells}"/></svg>`;
}
function dueHtml(b) {
  if (b.status !== 'unpaid' || !b.due) return '';
  const total = b.due - b.created, gone = nowS() - b.created;
  const pct = Math.max(0, Math.min(100, (gone / total) * 100));
  return `<div class="rc-due ${overdue(b) ? 'late' : ''}">
    <div class="rc-due-top"><span>${overdue(b) ? 'Vencida' : 'Tiempo para pagar'}</span><b data-countdown="${b.due}">${countdown(b.due)}</b></div>
    <div class="rc-bar"><i style="width:${pct}%"></i></div></div>`;
}
function countdown(t) {
  let s = Math.floor(t - nowS());
  const late = s < 0; s = Math.abs(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const str = d > 0 ? `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return late ? `hace ${str}` : str;
}
setInterval(() => document.querySelectorAll('[data-countdown]').forEach((el) => { el.textContent = countdown(Number(el.dataset.countdown)); }), 1000);

function receiptHtml(b, opts = {}) {
  const j = opts.job || jobOf(b);
  const st = opts.preview ? 'draft' : statusOf(b);
  const total = b.status === 'paid' ? paidTotal(b) : owed(b);
  const lateHours = b.due ? Math.max(0, Math.floor((nowS() - b.due) / 3600)) : 0;
  const stLabel = { draft: 'BORRADOR', unpaid: 'PENDIENTE', overdue: 'VENCIDA', paid: 'PAGADA', cancelled: 'ANULADA' }[st];
  return `<div class="rcpt st-${st}" style="--jc:${j.color}">
    <div class="rc-wm">${svg(j.icon)}</div>
    <div class="rc-top">
      <div class="rc-brand"><span class="rc-logo">${svg(j.icon)}</span><div><b>${esc(j.label)}</b><small>${esc(j.company || 'Factura oficial')}</small></div></div>
      <div class="rc-no"><small>FACTURA</small><b>#${pad(b.id || 0)}</b></div>
    </div>
    <div class="rc-meta">
      <div><small>Emitida</small><b>${b.created ? fday(b.created) : 'Hoy'}</b></div>
      <div><small>${b.status === 'paid' ? 'Pagada' : 'Vence'}</small><b>${b.status === 'paid' && b.paidAt ? fday(b.paidAt) : b.due ? fday(b.due) : opts.preview && D && D.dueHours ? `en ${D.dueHours} h` : '—'}</b></div>
      <div><small>Estado</small><b class="rc-pill">${stLabel}</b></div>
    </div>
    <div class="rc-parties">
      <div><small>Emitido por</small><p><span class="av">${initials(b.issuerName)}</span><b>${esc(b.issuerName)}</b></p></div>
      <div><small>Facturado a</small><p><span class="av b">${initials(b.receiverName)}</span><b>${esc(b.receiverName)}</b></p></div>
    </div>
    <div class="rc-items">
      <div class="rc-ih"><span>Concepto</span><span>Cant.</span><span>Importe</span></div>
      <div class="rc-it"><span><b>${esc(b.reason || 'Sin concepto')}</b>${b.note ? `<small>${esc(b.note)}</small>` : ''}</span><span>1</span><span>${money(b.amount)}</span></div>
      ${(b.fee || 0) > 0 ? `<div class="rc-it late"><span><b>Recargo por atraso</b><small>${D && D.lateFee ? `${D.lateFee.perHour}%/h · ${lateHours} h vencida` : 'Pago fuera de plazo'}</small></span><span>1</span><span>+${money(b.fee)}</span></div>` : ''}
    </div>
    <div class="rc-sum">
      <div><span>Subtotal</span><b>${money(b.amount)}</b></div>
      ${(b.fee || 0) > 0 ? `<div class="late"><span>Recargos</span><b>+${money(b.fee)}</b></div>` : ''}
      <div class="rc-total"><span>${b.status === 'paid' ? 'Total pagado' : 'Total a pagar'}</span><b>${money(total)}</b></div>
      ${b.status === 'paid' ? `<div class="rc-paid"><span>Método</span><b>${b.paidBy === 'cash' ? 'Efectivo' : b.paidBy === 'auto' ? 'Cobro automático (banco)' : 'Transferencia bancaria'}</b></div>` : ''}
    </div>
    ${opts.preview ? '' : dueHtml(b)}
    <div class="rc-tear"></div>
    <div class="rc-foot">
      ${qrSvg((b.id || 1) * 7919)}
      <div class="rc-codes">
        <div class="barcode"></div>
        <span class="tx">${b.id ? txCode(b.id) : 'FB-BORRADOR'}</span>
        <small>${b.status === 'paid' ? '✓ Pago verificado · comprobante válido' : st === 'cancelled' ? 'Factura anulada por la empresa' : 'Documento generado por ' + esc(j.label)}</small>
      </div>
    </div>
    ${opts.preview ? '' : `<span class="stamp ${st}">${stLabel}</span>`}
  </div>`;
}

/* ============================ mis facturas ============================ */
function renderMine() {
  const bills = D.myBills;
  const unpaid = bills.filter((b) => b.status === 'unpaid');
  $('stDue').textContent = money(unpaid.reduce((a, b) => a + owed(b), 0));
  $('stUnpaid').textContent = unpaid.length;
  $('stPaid').textContent = bills.filter((b) => b.status === 'paid').length;
  const list = bills.filter((b) => mineFilter === 'all' || b.status === mineFilter);
  const host = $('mineList');
  host.innerHTML = '';
  if (!list.length) {
    host.innerHTML = `<div class="empty"><b>${mineFilter === 'unpaid' ? '¡Estás al día!' : 'No hay facturas'}</b>${mineFilter === 'unpaid' ? 'No tienes facturas pendientes de pago.' : 'Aquí aparecerán tus facturas.'}</div>`;
  }
  list.forEach((b, i) => {
    const j = jobOf(b);
    const el = document.createElement('button');
    el.className = `bill tile ${b.status}` + (selBill === b.id ? ' on' : '');
    el.style.setProperty('--jc', j.color);
    el.style.animationDelay = Math.min(i * 0.03, 0.4) + 's';
    el.innerHTML = `<span class="bi">${svg(j.icon)}</span>
      <div class="bt"><b>${esc(b.reason)}</b><small>${esc(j.label)} · ${esc(b.issuerName)} · ${ago(b.created)}</small></div>
      <div class="ba"><strong>${money(b.status === 'paid' ? paidTotal(b) : owed(b))}</strong>${(b.fee || 0) > 0 && b.status === 'unpaid' ? `<span class="fee">+${money(b.fee)} recargo</span>` : ''}<span class="st ${statusOf(b)}">${STATUS[statusOf(b)]}</span></div>`;
    el.onclick = () => { selBill = b.id; renderMine(); };
    host.appendChild(el);
  });
  if (!list.some((b) => b.id === selBill)) selBill = list[0] ? list[0].id : null;
  if (selBill && !host.querySelector('.bill.on')) { const idx = list.findIndex((b) => b.id === selBill); if (host.children[idx]) host.children[idx].classList.add('on'); }
  renderMineSide();
}
function renderMineSide() {
  const side = $('mineSide');
  const b = D.myBills.find((x) => x.id === selBill);
  if (!b) {
    side.innerHTML = '<div class="empty big"><div class="hex ghosthex">' + svg('receipt') + '</div><b>Sin factura seleccionada</b><small>Elige una de la lista para ver el detalle</small></div>';
    return;
  }
  const lateInfo = D.lateFee && b.status === 'unpaid'
    ? (overdue(b)
      ? `<div class="latebox">${svg('alert')}Vencida: suma ${D.lateFee.perHour}% por hora (máx. ${D.lateFee.max}%). ${D.autopay ? 'Se cobrará sola de tu banco.' : ''}</div>`
      : `<div class="latebox" style="color:var(--t2);background:var(--tile);border-color:var(--dash)">${svg('alert')}Vence ${left(b.due)}. Después ${D.autopay ? 'se cobra sola del banco y ' : ''}suma ${D.lateFee.perHour}%/h de recargo.</div>`)
    : '';
  side.innerHTML = '<div class="sectlbl"><span>Detalle</span></div>' + receiptHtml(b) + lateInfo +
    `<div class="raction">${b.status === 'unpaid' ? `<button class="primary big" id="btnPay">${svg('card')}Pagar ${money(owed(b))}</button>` : ''}
      <button class="ghostbtn tile big" id="btnShow" title="Enseñar el recibo al jugador más cercano">${svg('eye')}Enseñar</button></div>`;
  if ($('btnPay')) $('btnPay').onclick = () => openPay(b);
  $('btnShow').onclick = () => post('show', { id: b.id });
}
document.querySelectorAll('#mineFilters button').forEach((b) => (b.onclick = () => {
  mineFilter = b.dataset.f;
  document.querySelectorAll('#mineFilters button').forEach((x) => x.classList.toggle('on', x === b));
  selBill = null; renderMine();
}));

/* pagar */
let paying = null;
function openPay(b) {
  paying = b;
  $('payId').textContent = '#' + pad(b.id);
  $('payWhat').textContent = `${jobOf(b).label} · ${b.reason}`;
  $('payAmount').textContent = money(owed(b));
  const pf = document.querySelector('.payfee'); if (pf) pf.remove();
  if ((b.fee || 0) > 0) $('payAmount').insertAdjacentHTML('afterend', `<div class="payfee">Incluye ${money(b.fee)} de recargo por atraso</div>`);
  $('pmBank').textContent = money(D.me.bank);
  $('pmCash').textContent = money(D.me.cash);
  const t = owed(b);
  document.querySelector('[data-m=bank]').classList.toggle('low', D.me.bank < t);
  document.querySelector('[data-m=cash]').classList.toggle('low', D.me.cash < t);
  setMethod(D.me.bank >= t || D.me.cash < t ? 'bank' : 'cash');
  $('payModal').classList.remove('hidden');
}
function setMethod(m) {
  payMethod = m;
  document.querySelectorAll('.paymethods button').forEach((x) => x.classList.toggle('on', x.dataset.m === m));
}
document.querySelectorAll('.paymethods button').forEach((x) => (x.onclick = () => setMethod(x.dataset.m)));
$('payConfirm').onclick = () => { if (paying) post('pay', { id: paying.id, method: payMethod }); $('payModal').classList.add('hidden'); };
document.querySelectorAll('[data-mclose]').forEach((b) => (b.onclick = () => b.closest('.modal').classList.add('hidden')));

/* ============================ crear factura ============================ */
function askNearby() { $('btnNearby').classList.add('busy'); post('nearby'); }
$('btnNearby').onclick = askNearby;

function renderPeople() {
  const host = $('people');
  host.innerHTML = '';
  if (!nearby.length) { host.innerHTML = '<span class="nobody">No hay nadie cerca. Acércate al cliente o usa su ID.</span>'; return; }
  nearby.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'person tile' + (target && target.id === p.id ? ' on' : '');
    b.style.animationDelay = i * 0.04 + 's';
    b.innerHTML = `<span class="idpill">${p.id}</span>${esc(p.name)}`;
    b.onclick = () => { target = p; $('targetId').value = ''; renderPeople(); renderPreview(); };
    host.appendChild(b);
  });
}
$('targetId').addEventListener('input', () => {
  const id = Number($('targetId').value);
  target = id > 0 ? (nearby.find((p) => p.id === id) || { id, name: `Jugador con ID ${id}` }) : null;
  renderPeople(); renderPreview();
});

function renderKinds() {
  const me = D.me;
  const hasJob = !!D.job, hasPersonal = !!D.personal;
  if (kind === 'job' && !(hasJob && me.canBillJob) && hasPersonal) kind = 'personal';
  if (kind === 'personal' && !hasPersonal) kind = 'job';
  $('kinds').classList.toggle('single', !(hasJob && hasPersonal));
  $('kindJob').classList.toggle('hidden', !hasJob);
  $('kindPersonal').classList.toggle('hidden', !hasPersonal);
  if (hasJob) {
    const blocked = !me.canBillJob;
    $('kindJob').style.setProperty('--kc', D.job.color);
    $('kindJob').innerHTML = `<span class="ki">${svg(D.job.icon)}</span><div><b>Factura ${esc(D.job.label)}</b><small>${blocked ? (me.jobBlocked === 'grade' ? `Necesitas rango ${me.minGrade}+` : 'Fuera de servicio') : `Oficial · comisión ${D.job.commission}%`}</small></div>`;
    $('kindJob').classList.toggle('blocked', blocked);
  }
  if (hasPersonal) {
    $('kindPersonal').style.setProperty('--kc', D.personal.color);
    $('kindPersonal').innerHTML = `<span class="ki">${svg(D.personal.icon)}</span><div><b>Factura ${esc(D.personal.label)}</b><small>De jugador a jugador · 100% para ti</small></div>`;
  }
  document.querySelectorAll('#kinds button').forEach((x) => x.classList.toggle('on', x.dataset.k === kind));
}
document.querySelectorAll('#kinds button').forEach((x) => (x.onclick = () => {
  if (x.classList.contains('blocked')) return toast(D.me.jobBlocked === 'grade' ? `Necesitas rango ${D.me.minGrade} o más para facturar como ${D.job.label}` : 'Debes estar de servicio', 'error');
  if (kind !== x.dataset.k) { kind = x.dataset.k; preset = null; $('reason').value = ''; $('amount').value = ''; }
  renderCreate();
}));

function renderCreate() {
  renderKinds();
  const j = cfgFor(kind);
  if (!j) return;
  const blocked = kind === 'job' && !D.me.canBillJob;
  const card = $('jobCard');
  card.style.setProperty('--jc', j.color);
  card.innerHTML = blocked
    ? `<span class="ji" style="background:#555">${svg(j.icon)}</span><div><b>${esc(j.label)}</b><small>${D.me.jobBlocked === 'grade' ? `Tu rango no puede emitir facturas oficiales (mínimo ${D.me.minGrade})` : 'Debes estar de servicio para facturar'}</small></div>`
    : kind === 'personal'
      ? `<span class="ji">${svg(j.icon)}</span><div><b>Factura ${esc(j.label)}</b><small>Como ${esc(D.me.name)} · máx. ${money(j.maxAmount)}</small></div><em>Recibes el 100%</em>`
      : `<span class="ji">${svg(j.icon)}</span><div><b>${esc(j.label)}</b><small>Facturando como ${esc(D.me.name)}</small></div><em>Tu comisión ${j.commission}%</em>`;
  $('curSign').textContent = cur();
  $('byIdRow').classList.toggle('hidden', !D.allowById);
  const host = $('presets');
  host.innerHTML = '';
  (j.presets || []).forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'preset tile' + (preset === i ? ' on' : '');
    b.style.animationDelay = i * 0.03 + 's';
    b.innerHTML = `<b>${esc(p.label)}</b><span>${money(p.amount)}</span>`;
    b.onclick = () => {
      preset = preset === i ? null : i;
      if (preset !== null) { $('reason').value = p.label; $('amount').value = p.amount; }
      renderCreate();
    };
    host.appendChild(b);
  });
  $('reason').readOnly = $('amount').readOnly = !j.allowCustom;
  renderPeople();
  renderPreview();
}
['reason', 'amount', 'note'].forEach((id) => $(id).addEventListener('input', () => {
  if (id !== 'note' && preset !== null) {
    const p = cfgFor(kind).presets[preset];
    if ($('reason').value !== p.label || Number($('amount').value) !== p.amount) { preset = null; document.querySelectorAll('.preset').forEach((x) => x.classList.remove('on')); }
  }
  renderPreview();
}));

function renderPreview() {
  const j = D && cfgFor(kind);
  if (!j) return;
  const amount = Math.floor(Number($('amount').value) || 0);
  const bill = { job: j.key, jobLabel: j.label, issuerName: D.me.name, receiverName: target ? target.name : '—',
    reason: $('reason').value.trim(), amount, note: $('note').value.trim() };
  const earn = kind === 'personal' ? amount : amount * j.commission / 100;
  $('createPreview').innerHTML = receiptHtml(bill, { preview: true }) +
    `<div class="commission" style="margin-top:calc(var(--u)*.5)"><span>${kind === 'personal' ? 'Recibes (100%)' : `Tu comisión (${j.commission}%)`}</span><b>${money(earn)}</b></div>`;
  const blocked = kind === 'job' && !D.me.canBillJob;
  $('btnCreate').disabled = blocked || !target || !bill.reason || amount <= 0 || amount > j.maxAmount;
}
$('btnCreate').onclick = () => {
  if ($('btnCreate').disabled) return;
  post('create', { kind: kind === 'personal' ? 'personal' : 'job', target: target.id, reason: $('reason').value.trim(), amount: Math.floor(Number($('amount').value)), note: $('note').value.trim() });
  $('reason').value = ''; $('amount').value = ''; $('note').value = ''; preset = null;
  renderCreate();
};

/* ============================ empresa ============================ */
function renderCompany() {
  const bills = D.companyBills || [];
  const sum = (f) => bills.filter(f).reduce((a, b) => a + b.amount, 0);
  $('coTotal').textContent = money(sum((b) => b.status !== 'cancelled'));
  $('coPaid').textContent = money(sum((b) => b.status === 'paid'));
  $('coDue').textContent = money(bills.filter((b) => b.status === 'unpaid').reduce((a, b) => a + owed(b), 0));
  $('coCount').textContent = bills.length;
  const q = $('coSearch').value.trim().toLowerCase();
  const list = bills.filter((b) => (coFilter === 'all' || b.status === coFilter) &&
    (!q || [b.receiverName, b.issuerName, b.reason, String(b.id)].some((x) => String(x).toLowerCase().includes(q))));
  const host = $('coList');
  host.innerHTML = list.length ? '' : '<div class="empty" style="margin:calc(var(--u)*.6)"><b>Sin facturas</b>Las facturas que emita tu empresa aparecerán aquí.</div>';
  list.forEach((b, i) => {
    const r = document.createElement('div');
    r.className = 'trow';
    r.style.animationDelay = Math.min(i * 0.02, 0.4) + 's';
    r.innerHTML = `<span class="n">${b.id}</span><span>${esc(b.receiverName)}</span><span>${esc(b.reason)}</span><span>${esc(b.issuerName)}</span>
      <span class="d">${fdate(b.created)}</span><span class="a">${money(b.status === 'paid' ? paidTotal(b) : owed(b))}</span><span><span class="st ${statusOf(b)}">${STATUS[statusOf(b)]}</span></span>
      <span>${b.status === 'unpaid' ? '<button class="void">Anular</button>' : ''}</span>`;
    const v = r.querySelector('.void');
    if (v) v.onclick = () => { if (v.dataset.sure) post('cancel', { id: b.id }); else { v.dataset.sure = 1; v.textContent = '¿Seguro?'; setTimeout(() => { v.textContent = 'Anular'; delete v.dataset.sure; }, 2500); } };
    host.appendChild(r);
  });
}
document.querySelectorAll('#coFilters button').forEach((b) => (b.onclick = () => {
  coFilter = b.dataset.f;
  document.querySelectorAll('#coFilters button').forEach((x) => x.classList.toggle('on', x === b));
  renderCompany();
}));
$('coSearch').addEventListener('input', renderCompany);

/* ============================ aviso de factura nueva ============================ */
let popTimer = null;
function showPopup(b, command) {
  const p = $('popup');
  p.classList.remove('hidden', 'out');
  void p.offsetWidth;
  $('popBadge').innerHTML = svg(b.icon) + esc(b.jobLabel);
  $('popBadge').style.setProperty('--jc', b.color);
  $('popReason').textContent = b.reason;
  $('popFrom').textContent = 'De ' + b.issuerName;
  $('popAmount').textContent = money(b.amount);
  $('popCmd').textContent = '/' + (command || 'facturas');
  if (!p.querySelector('.popbar')) p.insertAdjacentHTML('beforeend', '<div class="popbar"><i></i></div>');
  const bar = p.querySelector('.popbar i'); bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
  clearTimeout(popTimer);
  popTimer = setTimeout(() => { p.classList.add('out'); setTimeout(() => p.classList.add('hidden'), 350); }, 9000);
}

/* ============================ pago aprobado ============================ */
function showPaid(m) {
  const o = $('paidOverlay');
  $('poAmount').textContent = money(m.total);
  $('poMethod').textContent = m.method === 'cash' ? 'Pagado en efectivo' : 'Transferencia bancaria';
  $('poTx').textContent = txCode(m.id);
  o.classList.remove('hidden');
  o.style.animation = 'none'; void o.offsetWidth; o.style.animation = '';
  clearTimeout(showPaid.t);
  showPaid.t = setTimeout(() => o.classList.add('hidden'), 2600);
}
$('paidOverlay').onclick = () => $('paidOverlay').classList.add('hidden');

/* ============================ recibo que te enseñan ============================ */
function showViewer(m) {
  const prevOffset = clockOffset;
  if (!D) clockOffset = m.serverNow - Date.now() / 1000;
  if (m.currency && !D) D = { currency: m.currency, jobs: {} };
  $('vwBy').textContent = m.shownBy;
  $('vwBody').innerHTML = receiptHtml(m.bill, { job: m.job });
  const v = $('viewer');
  v.classList.remove('hidden', 'out');
  const bar = v.querySelector('.vwbar i'); bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
  clearTimeout(showViewer.t);
  showViewer.t = setTimeout(() => { v.classList.add('out'); setTimeout(() => v.classList.add('hidden'), 350); }, 12000);
  if (D && D.me) clockOffset = prevOffset;
}

/* ============================ comun ============================ */
function toast(msg, kind = 'info') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = `<i></i><span>${esc(msg)}</span>`;
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 3600);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => post('close')));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('app').classList.contains('hidden')) return;
  if (!$('payModal').classList.contains('hidden')) return $('payModal').classList.add('hidden');
  post('close');
});

window.addEventListener('message', ({ data: m }) => {
  switch (m.action) {
    case 'data':
      D = m.data;
      clockOffset = D.serverNow - Date.now() / 1000;
      if (D.open) {
        $('app').classList.remove('hidden');
        const a = $('app'); a.style.animation = 'none'; void a.offsetWidth; a.style.animation = '';
        $('popup').classList.add('hidden');
        if (!D.myBills.some((b) => b.status === 'unpaid')) mineFilter = mineFilter === 'unpaid' ? 'all' : mineFilter;
        document.querySelectorAll('#mineFilters button').forEach((x) => x.classList.toggle('on', x.dataset.f === mineFilter));
      }
      renderHead(); renderMine();
      if (tab === 'create') renderCreate();
      if (tab === 'company') renderCompany();
      break;
    case 'nearby':
      nearby = m.list || [];
      $('btnNearby').classList.remove('busy');
      if (target && !nearby.some((p) => p.id === target.id) && !$('targetId').value) target = null;
      renderPeople(); renderPreview();
      break;
    case 'received':
      if ($('app').classList.contains('hidden')) showPopup(m.bill, m.command);
      else toast(`Nueva factura de ${m.bill.jobLabel}: ${m.bill.reason} · ${money(m.bill.amount)}`, 'info');
      break;
    case 'paid':
      showPaid(m);
      break;
    case 'viewReceipt':
      showViewer(m);
      break;
    case 'notify':
      toast(m.msg, m.kind);
      break;
    case 'close':
      $('app').classList.add('hidden');
      $('payModal').classList.add('hidden');
      break;
  }
});
