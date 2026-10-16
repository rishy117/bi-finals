'use strict';
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS = MONTHS_LONG.map((m) => m.slice(0, 3));
  const CATEGORIES = ['School Supplies', 'Office Supplies', 'Custom Souvenirs', 'Craft Products'];
  const CHANNELS = ['In-store', 'Messenger'];
  const BADGE = {
    'In Stock': 'green', Delivered: 'green',
    'Reorder Soon': 'yellow', 'In Progress': 'yellow', 'Slow Moving': 'yellow',
    'Low Stock': 'red', 'Out of Stock': 'red', Pending: 'red', 'Low Demand': 'red', 'No Sales': 'red',
    Cancelled: 'gray',
  };

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };

  const state = { user: null, year: Number(store.get('kc_year')) || null };
  const isAdmin = () => state.user && state.user.role === 'admin';

  // ------------------------------------------------------------ helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const peso = (n) => '₱' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const peso2 = (n) => '₱' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (n) => (Number(n) || 0).toLocaleString('en-US');
  const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${MONTHS[m - 1]} ${Number(d)}, ${y}`; };
  const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const badge = (s) => `<span class="badge ${BADGE[s] || 'gray'}"><i></i>${esc(s)}</span>`;

  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(`api.php${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Cannot reach the server. Start Apache and MySQL in XAMPP, then open http://localhost/kristwin/');
    }
    const data = await res.json().catch(() => null);
    if (!data) {
      // api.php was not executed by PHP: the page was opened with VS Code Live Server, file://, or a wrong folder.
      if (res.status === 404 || res.status === 405 || location.port) {
        throw new Error('PHP is not running for this page. Start Apache and MySQL in XAMPP, then open http://localhost/kristwin/ (VS Code Live Server cannot run PHP).');
      }
      throw new Error(`Server error (HTTP ${res.status}). Make sure Apache and MySQL are running in XAMPP.`);
    }
    if (res.status === 401 && path !== '/login' && path !== '/me') {
      signOutLocal();
      throw new Error('Your session has ended. Please log in again.');
    }
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  let toastTimer;
  function toast(message, isError = false) {
    const t = $('#toast');
    t.textContent = message;
    t.classList.toggle('error', isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function downloadCsv(filename, rows, columns) {
    const cell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => c.value(r)))];
    const blob = new Blob(['﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------ table
  function dataTable(container, { columns, rows, pageSize = 15, empty = 'No records found.', footer }) {
    let page = 1;
    const head = `<thead><tr>${columns.map((c) => `<th class="${c.align || ''}">${c.label}</th>`).join('')}</tr></thead>`;
    function draw() {
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      page = Math.min(page, pages);
      const slice = rows.slice((page - 1) * pageSize, page * pageSize);
      const body = slice.length
        ? slice.map((r) => `<tr>${columns.map((c) => `<td class="${c.align || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${columns.length}" class="empty">${empty}</td></tr>`;
      container.innerHTML = `
        <div class="table-wrap"><table class="tbl">${head}<tbody>${body}</tbody>${footer && rows.length ? `<tfoot>${footer}</tfoot>` : ''}</table></div>
        ${pages > 1 ? `
        <div class="pager">
          <span>Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, rows.length)} of ${num(rows.length)}</span>
          <div>
            <button class="btn sm" data-page="-1" ${page === 1 ? 'disabled' : ''}>‹ Prev</button>
            <span>Page ${page} of ${pages}</span>
            <button class="btn sm" data-page="1" ${page === pages ? 'disabled' : ''}>Next ›</button>
          </div>
        </div>` : ''}`;
      $$('[data-page]', container).forEach((b) => { b.onclick = () => { page += Number(b.dataset.page); draw(); }; });
    }
    draw();
  }

  // ------------------------------------------------------------ modal
  let pendingConfirm = null;

  function closeModal() {
    if (pendingConfirm) { const resolve = pendingConfirm; pendingConfirm = null; resolve(false); }
    const m = $('#modal');
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    m.innerHTML = '';
  }

  function openModal({ title, body, footer, wide = false, onReady }) {
    const m = $('#modal');
    m.innerHTML = `
      <div class="modal-box ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="x" type="button" data-close aria-label="Close">×</button></div>
        ${body}
        ${footer || ''}
      </div>`;
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    $$('[data-close]', m).forEach((b) => { b.onclick = closeModal; });
    m.onmousedown = (e) => { if (e.target === m) closeModal(); };
    const first = $('input:not([type=hidden]), select, textarea', m);
    if (first) first.focus();
    if (onReady) onReady(m);
    return m;
  }

  function field(f) {
    const v = f.value ?? '';
    const req = f.required ? 'required' : '';
    let input;
    if (f.type === 'select') {
      input = `<select name="${f.name}" ${req}>${f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : ''}${f.options.map((o) => {
        const [val, label] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
      }).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea name="${f.name}" ${req}>${esc(v)}</textarea>`;
    } else {
      const extra = f.type === 'number' ? `step="${f.step || 'any'}" min="${f.min ?? 0}"` : '';
      input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${extra} ${req} ${f.attrs || ''}>`;
    }
    return `<label class="${f.full ? 'full' : ''}">${esc(f.label)}${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
  }

  function openForm({ title, fields, extra = '', submitLabel = 'Save', onSubmit, onReady, wide }) {
    const m = openModal({
      title,
      wide,
      body: `<form class="modal-form" novalidate><div class="modal-content"><div class="form-grid">${fields.map(field).join('')}${extra}</div><div class="form-error"></div></div>
        <div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${esc(submitLabel)}</button></div></form>`,
      onReady,
    });
    const form = $('form', m);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', form);
      const err = $('.form-error', form);
      err.textContent = '';
      btn.disabled = true;
      try {
        await onSubmit(Object.fromEntries(new FormData(form)), form);
        closeModal();
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        btn.disabled = false;
      }
    };
    return m;
  }

  function confirmBox(message, { okLabel = 'Delete', danger = true } = {}) {
    return new Promise((resolve) => {
      const m = openModal({
        title: 'Please confirm',
        body: `<div class="modal-content">${esc(message)}</div>`,
        footer: `<div class="modal-foot"><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button></div>`,
      });
      pendingConfirm = resolve;
      const done = (v) => { pendingConfirm = null; closeModal(); resolve(v); };
      $('[data-yes]', m).onclick = () => done(true);
      $('[data-no]', m).onclick = () => done(false);
      $('[data-yes]', m).focus();
    });
  }

  async function guarded(fn, successMessage) {
    try {
      await fn();
      if (successMessage) toast(successMessage);
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ------------------------------------------------------------ auth
  function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    closeModal();
    setTimeout(() => $('#loginForm [name=username]').focus(), 0);
  }

  function signOutLocal() {
    state.user = null;
    showLogin();
  }

  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const err = $('#loginError');
    err.textContent = '';
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const { user } = await api('/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      form.reset();
      enterApp(user);
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  };

  $('#logoutBtn').onclick = async () => {
    try { await api('/logout', { method: 'POST' }); } catch { /* already signed out */ }
    signOutLocal();
  };

  function enterApp(user) {
    state.user = user;
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#userName').textContent = user.name;
    $('#userRole').textContent = user.role === 'admin' ? 'Administrator' : 'Staff';
    $('#userInitial').textContent = user.name.trim().charAt(0).toUpperCase();
    $$('[data-admin]').forEach((a) => { a.hidden = !isAdmin(); });
    route();
  }

  // ------------------------------------------------------------ router
  const routes = {
    dashboard: renderDashboard,
    sales: renderSales,
    inventory: renderInventory,
    procurement: renderProcurement,
    suppliers: renderSuppliers,
    users: renderUsers,
  };

  async function route() {
    let name = location.hash.replace(/^#\/?/, '') || 'dashboard';
    if (!routes[name] || (name === 'users' && !isAdmin())) {
      name = 'dashboard';
      history.replaceState(null, '', '#/dashboard');
    }
    $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
    $('#navTools').innerHTML = '';
    const view = $('#view');
    view.innerHTML = '<div class="loading">Loading…</div>';
    try {
      await routes[name](view);
    } catch (e) {
      if (state.user) view.innerHTML = `<div class="container"><div class="card error-box">${esc(e.message)}</div></div>`;
    }
  }
  window.addEventListener('hashchange', () => { if (state.user) route(); });

  // ------------------------------------------------------------ dashboard
  const kpi = (label, value, sub, cls = '') => `
    <div class="kpi ${cls}"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="sub">${esc(sub)}</div></div>`;

  async function renderDashboard(view) {
    const d = await api(`/dashboard${state.year ? `?year=${state.year}` : ''}`);
    state.year = d.year;
    $('#periodLabel').textContent = `Data Period: ${d.periodLabel}`;

    $('#navTools').innerHTML = `
      <select class="compact" id="yearSel" aria-label="Year">${d.years.map((y) => `<option ${y === d.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <button class="btn sm" id="printBtn">Print</button>`;
    $('#yearSel').onchange = (e) => { state.year = Number(e.target.value); store.set('kc_year', state.year); renderDashboard(view); };
    $('#printBtn').onclick = () => window.print();

    const k = d.kpis;
    const peakNames = d.peaks.map((i) => MONTHS[i]).join(', ') || '—';
    view.innerHTML = `
      <div class="container">
        <section class="kpis">
          ${kpi('Total Estimated Sales', peso(k.total), d.periodLabel)}
          ${kpi('Average Monthly Sales', peso(k.average), `${k.avgMonths}-month average`)}
          ${kpi('Highest Sales Month', peso(k.highest.total), MONTHS_LONG[k.highest.month])}
          ${kpi('Lowest Sales Month', peso(k.lowest.total), MONTHS_LONG[k.lowest.month])}
        </section>

        <section class="grid-charts">
          <div class="card">
            <div class="card-head"><h2>Estimated Monthly Sales</h2><span class="chip">Simulated Sales Data</span></div>
            <div class="card-body">
              <div class="legend-inline">
                <span><i class="sw" style="background:#9dc3e6"></i>Regular month</span>
                <span><i class="sw" style="background:#1f3864"></i>Peak month (${peakNames})</span>
              </div>
              <div class="chart" id="barChart"></div>
              <p class="footnote">Sales figures are simulated estimates for BI prototype purposes.</p>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Estimated Sales by Product</h2><span class="chip">Simulated Sales Data</span></div>
            <div class="donut-wrap">
              <div class="donut chart" id="donutChart"></div>
              <div class="donut-legend" id="donutLegend"></div>
            </div>
          </div>
        </section>

        <section class="grid-3">
          <div class="card">
            <div class="card-head"><h2>Inventory Status</h2></div>
            <div class="table-wrap dash-table">
              <table class="tbl">
                <thead><tr><th>Product</th><th class="r">Current Stock</th><th class="r">Reorder Level</th><th>Status</th></tr></thead>
                <tbody>${d.inventory.map((p) => `
                  <tr><td>${esc(p.name)}</td><td class="r">${num(p.stock)}</td><td class="r">${num(p.reorderLevel)}</td><td>${badge(p.status)}</td></tr>`).join('')
                  || '<tr><td colspan="4" class="empty">No products yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Procurement Summary</h2></div>
            <div class="table-wrap dash-table">
              <table class="tbl">
                <thead><tr><th>Supplier</th><th class="r">Items</th><th>Status</th></tr></thead>
                <tbody>${d.procurement.map((po) => `
                  <tr><td title="${esc(po.poNo)}">${esc(po.supplierName)}</td><td class="r">${po.itemCount}</td><td>${badge(po.status)}</td></tr>`).join('')
                  || '<tr><td colspan="3" class="empty">No purchase orders yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Low-Performing Products</h2></div>
            <div class="table-wrap dash-table">
              <table class="tbl">
                <thead><tr><th>Product</th><th class="r">Estimated Sales</th><th>Status</th></tr></thead>
                <tbody>${d.lowPerforming.map((p) => `
                  <tr><td>${esc(p.name)}</td><td class="r" title="${num(p.units)} units sold">${peso(p.amount)}</td><td>${badge(p.status)}</td></tr>`).join('')
                  || '<tr><td colspan="3" class="empty">No products yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>`;

    Charts.bar($('#barChart'), d.months, { peaks: d.peaks, year: d.year });
    Charts.donut($('#donutChart'), $('#donutLegend'), d.byProduct, k.total);
  }

  // ------------------------------------------------------------ sales
  async function renderSales(view) {
    let sales = [];
    let products = [];
    view.innerHTML = `
      <div class="container">
        <div class="page-head">
          <div><h2>Sales Transactions</h2><p>Record product sales. Recording a sale deducts the quantity from stock automatically.</p></div>
          <div class="actions">
            <button class="btn" id="exportBtn">Export CSV</button>
            <button class="btn primary" id="addBtn">+ Record Sale</button>
          </div>
        </div>
        <div class="card">
          <div class="filters">
            <input type="search" id="fQ" placeholder="Search transaction no., product, customer…">
            <input type="month" id="fMonth" aria-label="Month">
            <select id="fProduct" aria-label="Product"><option value="">All products</option></select>
            <select id="fChannel" aria-label="Channel"><option value="">All channels</option>${CHANNELS.map((c) => `<option>${c}</option>`).join('')}</select>
          </div>
          <div class="summary-line" id="summary"></div>
          <div id="table"></div>
        </div>
      </div>`;

    const filtered = () => {
      const q = $('#fQ').value.trim().toLowerCase();
      const month = $('#fMonth').value;
      const pid = Number($('#fProduct').value);
      const channel = $('#fChannel').value;
      return sales.filter((s) => (!month || s.date.startsWith(month))
        && (!pid || s.productId === pid)
        && (!channel || s.channel === channel)
        && (!q || `${s.txnNo} ${s.productName} ${s.customer}`.toLowerCase().includes(q)));
    };

    function draw() {
      const rows = filtered();
      const total = rows.reduce((a, s) => a + s.amount, 0);
      const units = rows.reduce((a, s) => a + s.qty, 0);
      $('#summary').innerHTML = `<span>Transactions <b>${num(rows.length)}</b></span><span>Units sold <b>${num(units)}</b></span><span>Total sales <b>${peso2(total)}</b></span>`;
      dataTable($('#table'), {
        rows,
        columns: [
          { label: 'Txn No.', render: (s) => `<span class="nowrap">${esc(s.txnNo)}</span>` },
          { label: 'Date', render: (s) => `<span class="nowrap">${fmtDate(s.date)}</span>` },
          { label: 'Product', key: 'productName' },
          { label: 'Customer', key: 'customer' },
          { label: 'Channel', key: 'channel' },
          { label: 'Qty', align: 'r', render: (s) => num(s.qty) },
          { label: 'Unit Price', align: 'r', render: (s) => peso2(s.unitPrice) },
          { label: 'Discount', align: 'r', render: (s) => (s.discount ? peso2(s.discount) : '<span class="muted">—</span>') },
          { label: 'Amount', align: 'r', render: (s) => `<b>${peso2(s.amount)}</b>` },
          ...(isAdmin() ? [{ label: '', align: 'r', render: (s) => `<div class="row-actions"><button class="link-btn danger" data-void="${s.id}">Void</button></div>` }] : []),
        ],
      });
    }

    async function load() {
      [sales, products] = await Promise.all([api('/sales'), api('/products')]);
      const sel = $('#fProduct');
      const current = sel.value;
      sel.innerHTML = '<option value="">All products</option>' + products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
      sel.value = current;
      draw();
    }

    ['#fQ', '#fMonth', '#fProduct', '#fChannel'].forEach((id) => { $(id).oninput = draw; });

    $('#table').onclick = async (e) => {
      const b = e.target.closest('[data-void]');
      if (!b) return;
      const sale = sales.find((s) => s.id === Number(b.dataset.void));
      if (!(await confirmBox(`Void ${sale.txnNo} (${sale.productName}, ${peso2(sale.amount)})? ${sale.qty} ${sale.unit} will be returned to stock.`, { okLabel: 'Void sale' }))) return;
      guarded(async () => { await api(`/sales/${sale.id}`, { method: 'DELETE' }); await load(); }, 'Sale voided and stock restored.');
    };

    $('#exportBtn').onclick = () => downloadCsv(`sales-${todayStr()}.csv`, filtered(), [
      { label: 'Txn No', value: (s) => s.txnNo }, { label: 'Date', value: (s) => s.date },
      { label: 'Product', value: (s) => s.productName }, { label: 'Customer', value: (s) => s.customer },
      { label: 'Channel', value: (s) => s.channel }, { label: 'Qty', value: (s) => s.qty },
      { label: 'Unit Price', value: (s) => s.unitPrice }, { label: 'Discount', value: (s) => s.discount },
      { label: 'Amount', value: (s) => s.amount }, { label: 'Recorded By', value: (s) => s.createdBy },
    ]);

    $('#addBtn').onclick = () => saleForm(products, load);
    await load();
  }

  function saleForm(products, onSaved) {
    const available = products.filter((p) => p.stock > 0);
    openForm({
      title: 'Record Sale',
      submitLabel: 'Save Sale',
      fields: [
        { name: 'date', label: 'Date', type: 'date', value: todayStr(), required: true },
        { name: 'productId', label: 'Product', type: 'select', required: true, placeholder: 'Select product…', options: available.map((p) => [p.id, `${p.name} (${p.stock} ${p.unit} left)`]) },
        { name: 'qty', label: 'Quantity', type: 'number', value: 1, min: 1, step: 1, required: true },
        { name: 'unitPrice', label: 'Unit Price (₱)', type: 'number', step: '0.01', required: true },
        { name: 'discount', label: 'Discount (₱)', type: 'number', value: 0, step: '0.01' },
        { name: 'channel', label: 'Channel', type: 'select', options: CHANNELS, value: 'In-store' },
        { name: 'customer', label: 'Customer', value: 'Walk-in', full: true },
      ],
      extra: '<div class="info-line" id="saleInfo">Select a product to see available stock.</div>',
      onReady(m) {
        const f = $('form', m);
        const update = () => {
          const p = products.find((x) => x.id === Number(f.productId.value));
          if (!p) { $('#saleInfo', m).innerHTML = 'Select a product to see available stock.'; return; }
          const amount = (Number(f.qty.value) || 0) * (Number(f.unitPrice.value) || 0) - (Number(f.discount.value) || 0);
          const after = p.stock - (Number(f.qty.value) || 0);
          $('#saleInfo', m).innerHTML = `<span>Available: <b>${num(p.stock)} ${esc(p.unit)}</b></span><span>Stock after sale: <b style="color:${after < 0 ? 'var(--red)' : after < p.reorderLevel ? 'var(--yellow)' : 'inherit'}">${num(after)}</b></span><span>Amount: <b>${peso2(amount)}</b></span>`;
        };
        f.productId.onchange = () => {
          const p = products.find((x) => x.id === Number(f.productId.value));
          if (p) f.unitPrice.value = p.price;
          update();
        };
        ['qty', 'unitPrice', 'discount'].forEach((n) => { f[n].oninput = update; });
      },
      async onSubmit(v) {
        if (!v.productId) throw new Error('Please select a product.');
        const sale = await api('/sales', { method: 'POST', body: v });
        toast(`${sale.txnNo} saved — ${peso2(sale.amount)}.`);
        await onSaved();
      },
    });
  }

  // ------------------------------------------------------------ inventory
  async function renderInventory(view) {
    let products = [];
    view.innerHTML = `
      <div class="container">
        <div class="page-head">
          <div><h2>Inventory</h2><p>Centralized product list with stock levels and reorder points.</p></div>
          <div class="actions">
            <button class="btn" id="exportBtn">Export CSV</button>
            <button class="btn primary" id="addBtn">+ Add Product</button>
          </div>
        </div>
        <section class="kpis small" id="invKpis"></section>
        <div class="card">
          <div class="filters">
            <input type="search" id="fQ" placeholder="Search code or product name…">
            <select id="fCat" aria-label="Category"><option value="">All categories</option>${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select>
            <select id="fStatus" aria-label="Status"><option value="">All statuses</option>${['In Stock', 'Reorder Soon', 'Low Stock', 'Out of Stock'].map((c) => `<option>${c}</option>`).join('')}</select>
          </div>
          <div id="table"></div>
        </div>
      </div>`;

    const filtered = () => {
      const q = $('#fQ').value.trim().toLowerCase();
      const cat = $('#fCat').value;
      const st = $('#fStatus').value;
      return products.filter((p) => (!cat || p.category === cat) && (!st || p.status === st)
        && (!q || `${p.code} ${p.name}`.toLowerCase().includes(q)));
    };

    function draw() {
      const count = (s) => products.filter((p) => p.status === s).length;
      const value = products.reduce((a, p) => a + p.stock * p.price, 0);
      $('#invKpis').innerHTML = [
        kpi('Total Products', num(products.length), `${CATEGORIES.length} categories`),
        kpi('Low / Out of Stock', num(count('Low Stock') + count('Out of Stock')), 'Below reorder level', 'warn'),
        kpi('Reorder Soon', num(count('Reorder Soon')), 'At or near reorder level', 'amber'),
        kpi('Stock Value (at selling price)', peso(value), `${num(products.reduce((a, p) => a + p.stock, 0))} units on hand`, 'ok'),
      ].join('');
      dataTable($('#table'), {
        rows: filtered(),
        pageSize: 20,
        columns: [
          { label: 'Code', key: 'code' },
          { label: 'Product', render: (p) => `<b>${esc(p.name)}</b>` },
          { label: 'Category', key: 'category' },
          { label: 'Unit', key: 'unit' },
          { label: 'Selling Price', align: 'r', render: (p) => peso2(p.price) },
          { label: 'Current Stock', align: 'r', render: (p) => num(p.stock) },
          { label: 'Reorder Level', align: 'r', render: (p) => num(p.reorderLevel) },
          { label: 'Status', render: (p) => badge(p.status) },
          {
            label: '', align: 'r',
            render: (p) => `<div class="row-actions"><button class="link-btn" data-edit="${p.id}">Edit</button>${isAdmin() ? `<button class="link-btn danger" data-del="${p.id}">Delete</button>` : ''}</div>`,
          },
        ],
      });
    }

    async function load() { products = await api('/products'); draw(); }

    ['#fQ', '#fCat', '#fStatus'].forEach((id) => { $(id).oninput = draw; });

    function productForm(p) {
      openForm({
        title: p ? `Edit ${p.name}` : 'Add Product',
        fields: [
          { name: 'code', label: 'Product Code', value: p ? p.code : `KC-${String(products.length + 1).padStart(3, '0')}`, required: true },
          { name: 'name', label: 'Product Name', value: p?.name, required: true },
          { name: 'category', label: 'Category', type: 'select', options: CATEGORIES, value: p?.category, required: true },
          { name: 'unit', label: 'Unit', value: p ? p.unit : 'pc', required: true, hint: 'e.g. pc, box, ream, pack' },
          { name: 'price', label: 'Selling Price (₱)', type: 'number', step: '0.01', value: p?.price, required: true },
          { name: 'stock', label: 'Current Stock', type: 'number', step: 1, value: p ? p.stock : 0, required: true, hint: p ? 'Changing this records a manual stock adjustment.' : '' },
          { name: 'reorderLevel', label: 'Reorder Level', type: 'number', step: 1, value: p ? p.reorderLevel : 10, required: true, full: true, hint: 'The product is flagged "Low Stock" when stock falls below this number.' },
        ],
        async onSubmit(v) {
          await api(p ? `/products/${p.id}` : '/products', { method: p ? 'PUT' : 'POST', body: v });
          toast(p ? 'Product updated.' : 'Product added.');
          await load();
        },
      });
    }

    $('#addBtn').onclick = () => productForm(null);
    $('#table').onclick = async (e) => {
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      if (edit) productForm(products.find((p) => p.id === Number(edit.dataset.edit)));
      if (del) {
        const p = products.find((x) => x.id === Number(del.dataset.del));
        if (!(await confirmBox(`Delete ${p.name}? This cannot be undone.`))) return;
        guarded(async () => { await api(`/products/${p.id}`, { method: 'DELETE' }); await load(); }, 'Product deleted.');
      }
    };
    $('#exportBtn').onclick = () => downloadCsv(`inventory-${todayStr()}.csv`, filtered(), [
      { label: 'Code', value: (p) => p.code }, { label: 'Product', value: (p) => p.name },
      { label: 'Category', value: (p) => p.category }, { label: 'Unit', value: (p) => p.unit },
      { label: 'Selling Price', value: (p) => p.price }, { label: 'Current Stock', value: (p) => p.stock },
      { label: 'Reorder Level', value: (p) => p.reorderLevel }, { label: 'Status', value: (p) => p.status },
    ]);
    await load();
  }

  // ------------------------------------------------------------ procurement
  async function renderProcurement(view) {
    let pos = [];
    let suppliers = [];
    let products = [];
    view.innerHTML = `
      <div class="container">
        <div class="page-head">
          <div><h2>Procurement</h2><p>Purchase orders from suppliers. Marking an order <b>Delivered</b> adds its items to stock.</p></div>
          <div class="actions">
            <button class="btn" id="exportBtn">Export CSV</button>
            <button class="btn primary" id="addBtn">+ New Purchase Order</button>
          </div>
        </div>
        <section class="kpis small" id="poKpis"></section>
        <div class="card">
          <div class="filters">
            <input type="search" id="fQ" placeholder="Search PO no. or supplier…">
            <select id="fStatus" aria-label="Status"><option value="">All statuses</option>${['Pending', 'In Progress', 'Delivered', 'Cancelled'].map((s) => `<option>${s}</option>`).join('')}</select>
          </div>
          <div id="table"></div>
        </div>
      </div>`;

    const filtered = () => {
      const q = $('#fQ').value.trim().toLowerCase();
      const st = $('#fStatus').value;
      return pos.filter((po) => (!st || po.status === st) && (!q || `${po.poNo} ${po.supplierName}`.toLowerCase().includes(q)));
    };

    function draw() {
      const by = (s) => pos.filter((po) => po.status === s);
      const open = [...by('Pending'), ...by('In Progress')];
      $('#poKpis').innerHTML = [
        kpi('Pending', num(by('Pending').length), 'Awaiting quotation / approval', 'warn'),
        kpi('In Progress', num(by('In Progress').length), 'Ordered, not yet received', 'amber'),
        kpi('Delivered', num(by('Delivered').length), 'Received and added to stock', 'ok'),
        kpi('Open Order Value', peso(open.reduce((a, po) => a + po.totalCost, 0)), `${open.length} open purchase order(s)`),
      ].join('');
      dataTable($('#table'), {
        rows: filtered(),
        columns: [
          { label: 'PO No.', render: (po) => `<b class="nowrap">${esc(po.poNo)}</b>` },
          { label: 'Date', render: (po) => `<span class="nowrap">${fmtDate(po.date)}</span>` },
          { label: 'Supplier', key: 'supplierName' },
          { label: 'Items', align: 'r', render: (po) => po.itemCount },
          { label: 'Total Qty', align: 'r', render: (po) => num(po.totalQty) },
          { label: 'Total Cost', align: 'r', render: (po) => peso2(po.totalCost) },
          { label: 'Status', render: (po) => badge(po.status) },
          { label: '', align: 'r', render: (po) => `<div class="row-actions"><button class="link-btn" data-view="${po.id}">View</button></div>` },
        ],
      });
    }

    async function load() {
      [pos, suppliers, products] = await Promise.all([api('/purchases'), api('/suppliers'), api('/products')]);
      draw();
    }

    ['#fQ', '#fStatus'].forEach((id) => { $(id).oninput = draw; });

    function poDetail(po) {
      const next = { Pending: ['In Progress', 'Delivered', 'Cancelled'], 'In Progress': ['Delivered', 'Cancelled'] }[po.status] || [];
      const m = openModal({
        title: `Purchase Order ${po.poNo}`,
        wide: true,
        body: `
          <div class="modal-content">
            <div class="detail-grid">
              <div><span>Supplier</span>${esc(po.supplierName)}</div>
              <div><span>Order Date</span>${fmtDate(po.date)}</div>
              <div><span>Status</span>${badge(po.status)}</div>
              ${po.deliveredAt ? `<div><span>Delivered On</span>${fmtDate(po.deliveredAt)}</div>` : ''}
              ${po.notes ? `<div style="grid-column:1/-1"><span>Notes</span>${esc(po.notes)}</div>` : ''}
            </div>
            <div class="card table-wrap">
              <table class="tbl">
                <thead><tr><th>Product</th><th class="r">Qty</th><th class="r">Unit Cost</th><th class="r">Line Total</th></tr></thead>
                <tbody>${po.items.map((it) => `<tr><td>${esc(it.productName)}</td><td class="r">${num(it.qty)} ${esc(it.unit)}</td><td class="r">${peso2(it.unitCost)}</td><td class="r">${peso2(it.lineTotal)}</td></tr>`).join('')}</tbody>
                <tfoot><tr><td>Total</td><td class="r">${num(po.totalQty)}</td><td></td><td class="r">${peso2(po.totalCost)}</td></tr></tfoot>
              </table>
            </div>
          </div>`,
        footer: `
          <div class="modal-foot">
            ${isAdmin() && po.status !== 'Delivered' ? '<button class="btn danger" data-act="delete">Delete</button>' : ''}
            ${next.length ? '<button class="btn" data-act="edit">Edit</button>' : ''}
            <span class="spacer"></span>
            ${next.map((s) => `<button class="btn ${s === 'Delivered' ? 'primary' : s === 'Cancelled' ? 'danger' : ''}" data-status="${s}">${s === 'Cancelled' ? 'Cancel Order' : `Mark ${s}`}</button>`).join('')}
            <button class="btn" data-close>Close</button>
          </div>`,
      });
      $$('[data-status]', m).forEach((b) => {
        b.onclick = async () => {
          const status = b.dataset.status;
          if (status === 'Delivered' && !(await confirmBox(`Mark ${po.poNo} as Delivered? ${num(po.totalQty)} units will be added to inventory.`, { okLabel: 'Mark Delivered', danger: false }))) return;
          if (status === 'Cancelled' && !(await confirmBox(`Cancel ${po.poNo}?`, { okLabel: 'Cancel Order' }))) return;
          closeModal();
          guarded(async () => { await api(`/purchases/${po.id}/status`, { method: 'PATCH', body: { status } }); await load(); },
            status === 'Delivered' ? 'Order delivered — stock updated.' : `Order marked ${status}.`);
        };
      });
      const edit = $('[data-act=edit]', m);
      if (edit) edit.onclick = () => poForm(po);
      const del = $('[data-act=delete]', m);
      if (del) {
        del.onclick = async () => {
          if (!(await confirmBox(`Delete purchase order ${po.poNo}?`))) return;
          guarded(async () => { await api(`/purchases/${po.id}`, { method: 'DELETE' }); await load(); }, 'Purchase order deleted.');
        };
      }
    }

    function poForm(po) {
      const productOptions = (selected) => `<option value="">Select product…</option>${products.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} (stock ${p.stock})</option>`).join('')}`;
      const lineRow = (it = {}) => `
        <tr>
          <td><select name="productId">${productOptions(it.productId)}</select></td>
          <td style="width:110px"><input name="qty" type="number" min="1" step="1" value="${it.qty ?? 1}"></td>
          <td style="width:130px"><input name="unitCost" type="number" min="0" step="0.01" value="${it.unitCost ?? ''}"></td>
          <td class="r nowrap" data-line style="width:120px">₱0.00</td>
          <td style="width:40px"><button type="button" class="link-btn danger" data-remove aria-label="Remove line">✕</button></td>
        </tr>`;
      if (!suppliers.length) { toast('Add a supplier first (Suppliers tab).', true); return; }
      openForm({
        title: po ? `Edit ${po.poNo}` : 'New Purchase Order',
        submitLabel: po ? 'Save Changes' : 'Create Purchase Order',
        wide: true,
        fields: [
          { name: 'supplierId', label: 'Supplier', type: 'select', required: true, placeholder: 'Select supplier…', options: suppliers.map((s) => [s.id, s.name]), value: po?.supplierId },
          { name: 'date', label: 'Order Date', type: 'date', value: po ? po.date : todayStr(), required: true },
          { name: 'notes', label: 'Notes (quotation details, Messenger reference, etc.)', type: 'textarea', value: po?.notes, full: true },
        ],
        extra: `
          <div class="full">
            <div class="card table-wrap">
              <table class="tbl items-table">
                <thead><tr><th>Product</th><th>Qty</th><th>Unit Cost (₱)</th><th class="r">Line Total</th><th></th></tr></thead>
                <tbody id="lines">${(po ? po.items : [{}]).map(lineRow).join('')}</tbody>
                <tfoot><tr><td colspan="3"><button type="button" class="btn sm" id="addLine">+ Add item</button></td><td class="r" id="poTotal">₱0.00</td><td></td></tr></tfoot>
              </table>
            </div>
          </div>`,
        onReady(m) {
          const lines = $('#lines', m);
          const recalc = () => {
            let total = 0;
            $$('tr', lines).forEach((tr) => {
              const line = (Number($('[name=qty]', tr).value) || 0) * (Number($('[name=unitCost]', tr).value) || 0);
              total += line;
              $('[data-line]', tr).textContent = peso2(line);
            });
            $('#poTotal', m).textContent = peso2(total);
          };
          $('#addLine', m).onclick = () => { lines.insertAdjacentHTML('beforeend', lineRow()); recalc(); };
          lines.onclick = (e) => {
            if (e.target.closest('[data-remove]') && lines.children.length > 1) { e.target.closest('tr').remove(); recalc(); }
          };
          lines.oninput = recalc;
          recalc();
        },
        async onSubmit(v, form) {
          const items = $$('#lines tr', form).map((tr) => ({
            productId: $('[name=productId]', tr).value,
            qty: $('[name=qty]', tr).value,
            unitCost: $('[name=unitCost]', tr).value,
          })).filter((it) => it.productId);
          if (!v.supplierId) throw new Error('Please select a supplier.');
          if (!items.length) throw new Error('Add at least one product.');
          const saved = await api(po ? `/purchases/${po.id}` : '/purchases', {
            method: po ? 'PUT' : 'POST',
            body: { supplierId: v.supplierId, date: v.date, notes: v.notes, items },
          });
          toast(po ? `${saved.poNo} updated.` : `${saved.poNo} created.`);
          await load();
        },
      });
    }

    $('#addBtn').onclick = () => poForm(null);
    $('#table').onclick = (e) => {
      const b = e.target.closest('[data-view]');
      if (b) poDetail(pos.find((po) => po.id === Number(b.dataset.view)));
    };
    $('#exportBtn').onclick = () => downloadCsv(`purchase-orders-${todayStr()}.csv`,
      filtered().flatMap((po) => po.items.map((it) => ({ po, it }))), [
        { label: 'PO No', value: (r) => r.po.poNo }, { label: 'Date', value: (r) => r.po.date },
        { label: 'Supplier', value: (r) => r.po.supplierName }, { label: 'Status', value: (r) => r.po.status },
        { label: 'Product', value: (r) => r.it.productName }, { label: 'Qty', value: (r) => r.it.qty },
        { label: 'Unit Cost', value: (r) => r.it.unitCost }, { label: 'Line Total', value: (r) => r.it.lineTotal },
      ]);
    await load();
  }

  // ------------------------------------------------------------ suppliers
  async function renderSuppliers(view) {
    let suppliers = [];
    view.innerHTML = `
      <div class="container">
        <div class="page-head">
          <div><h2>Suppliers</h2><p>One place for supplier contacts instead of scattered Messenger threads.</p></div>
          <div class="actions"><button class="btn primary" id="addBtn">+ Add Supplier</button></div>
        </div>
        <div class="card">
          <div class="filters"><input type="search" id="fQ" placeholder="Search supplier or contact person…"></div>
          <div id="table"></div>
        </div>
      </div>`;

    function draw() {
      const q = $('#fQ').value.trim().toLowerCase();
      dataTable($('#table'), {
        rows: suppliers.filter((s) => !q || `${s.name} ${s.contactPerson}`.toLowerCase().includes(q)),
        columns: [
          { label: 'Supplier', render: (s) => `<b>${esc(s.name)}</b>` },
          { label: 'Contact Person', key: 'contactPerson' },
          { label: 'Phone', render: (s) => `<span class="nowrap">${esc(s.phone)}</span>` },
          { label: 'Email / Messenger', key: 'email' },
          { label: 'Address', key: 'address' },
          { label: 'Purchase Orders', align: 'r', render: (s) => s.poCount },
          {
            label: '', align: 'r',
            render: (s) => `<div class="row-actions"><button class="link-btn" data-edit="${s.id}">Edit</button>${isAdmin() ? `<button class="link-btn danger" data-del="${s.id}">Delete</button>` : ''}</div>`,
          },
        ],
      });
    }

    async function load() { suppliers = await api('/suppliers'); draw(); }

    function supplierForm(s) {
      openForm({
        title: s ? `Edit ${s.name}` : 'Add Supplier',
        fields: [
          { name: 'name', label: 'Supplier Name', value: s?.name, required: true, full: true },
          { name: 'contactPerson', label: 'Contact Person', value: s?.contactPerson },
          { name: 'phone', label: 'Phone', value: s?.phone },
          { name: 'email', label: 'Email / Messenger', value: s?.email, full: true },
          { name: 'address', label: 'Address', value: s?.address, full: true },
        ],
        async onSubmit(v) {
          await api(s ? `/suppliers/${s.id}` : '/suppliers', { method: s ? 'PUT' : 'POST', body: v });
          toast(s ? 'Supplier updated.' : 'Supplier added.');
          await load();
        },
      });
    }

    $('#fQ').oninput = draw;
    $('#addBtn').onclick = () => supplierForm(null);
    $('#table').onclick = async (e) => {
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      if (edit) supplierForm(suppliers.find((s) => s.id === Number(edit.dataset.edit)));
      if (del) {
        const s = suppliers.find((x) => x.id === Number(del.dataset.del));
        if (!(await confirmBox(`Delete supplier ${s.name}?`))) return;
        guarded(async () => { await api(`/suppliers/${s.id}`, { method: 'DELETE' }); await load(); }, 'Supplier deleted.');
      }
    };
    await load();
  }

  // ------------------------------------------------------------ users
  async function renderUsers(view) {
    let users = [];
    view.innerHTML = `
      <div class="container">
        <div class="page-head">
          <div><h2>User Accounts</h2><p>Administrators can manage everything; staff can record sales, products, suppliers and purchase orders but cannot delete records.</p></div>
          <div class="actions"><button class="btn primary" id="addBtn">+ Add User</button></div>
        </div>
        <div class="card"><div id="table"></div></div>
      </div>`;

    async function load() {
      users = await api('/users');
      dataTable($('#table'), {
        rows: users,
        columns: [
          { label: 'Full Name', render: (u) => `<b>${esc(u.name)}</b>${u.id === state.user.id ? ' <span class="chip">You</span>' : ''}` },
          { label: 'Username', key: 'username' },
          { label: 'Role', render: (u) => (u.role === 'admin' ? 'Administrator' : 'Staff') },
          { label: 'Created', render: (u) => fmtDate(u.createdAt.slice(0, 10)) },
          {
            label: '', align: 'r',
            render: (u) => `<div class="row-actions"><button class="link-btn" data-edit="${u.id}">Edit</button>${u.id !== state.user.id ? `<button class="link-btn danger" data-del="${u.id}">Delete</button>` : ''}</div>`,
          },
        ],
      });
    }

    function userForm(u) {
      openForm({
        title: u ? `Edit ${u.name}` : 'Add User',
        fields: [
          { name: 'name', label: 'Full Name', value: u?.name, required: true, full: true },
          ...(u ? [] : [{ name: 'username', label: 'Username', required: true }]),
          { name: 'role', label: 'Role', type: 'select', options: [['staff', 'Staff'], ['admin', 'Administrator']], value: u ? u.role : 'staff' },
          { name: 'password', label: u ? 'New Password' : 'Password', type: 'password', required: !u, hint: u ? 'Leave blank to keep the current password.' : 'At least 6 characters.', full: !!u },
        ],
        async onSubmit(v) {
          await api(u ? `/users/${u.id}` : '/users', { method: u ? 'PUT' : 'POST', body: v });
          toast(u ? 'User updated.' : 'User added.');
          if (u && u.id === state.user.id) { state.user.name = v.name; $('#userName').textContent = v.name; }
          await load();
        },
      });
    }

    $('#addBtn').onclick = () => userForm(null);
    $('#table').onclick = async (e) => {
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      if (edit) userForm(users.find((u) => u.id === Number(edit.dataset.edit)));
      if (del) {
        const u = users.find((x) => x.id === Number(del.dataset.del));
        if (!(await confirmBox(`Delete the account of ${u.name}?`))) return;
        guarded(async () => { await api(`/users/${u.id}`, { method: 'DELETE' }); await load(); }, 'User deleted.');
      }
    };
    await load();
  }

  // ------------------------------------------------------------ boot
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal').classList.contains('open')) closeModal(); });

  (async function boot() {
    try {
      const { user } = await api('/me');
      enterApp(user);
      return;
    } catch (e) {
      showLogin();
      // Not logged in is normal; anything else (MySQL off, database missing) is shown on the login card.
      if (!/log in/i.test(e.message)) $('#loginError').textContent = e.message;
    }
  })();
})();
