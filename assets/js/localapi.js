'use strict';
// Browser-only version of api.php, used when PHP/MySQL is not available
// (index.html opened directly, GitHub Pages, VS Code Live Server).
// Same routes, rules and JSON shapes as the PHP modules; data is kept in this browser's localStorage.
window.KristwinLocal = (() => {
  const DB_KEY = 'kc_local_db';
  const SESSION_KEY = 'kc_local_user';
  const LOW_DEMAND_UNITS = 500;
  const REORDER_SOON_MARGIN = 0.10;
  const SAMPLE_PASSWORDS = { admin: 'admin123', staff: 'staff123' };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const CATEGORIES = ['School Supplies', 'Office Supplies', 'Custom Souvenirs', 'Craft Products'];
  const CHANNELS = ['In-store', 'Messenger'];
  const ROLES = ['admin', 'staff'];
  const PO_FLOW = {
    Pending: ['In Progress', 'Delivered', 'Cancelled'],
    'In Progress': ['Delivered', 'Cancelled'],
    Delivered: [],
    Cancelled: [],
  };

  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  // ---------------------------------------------------------------- storage

  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable: data lasts until the tab closes */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };

  let db = null;
  let sessionUserId = null;

  function seedDb() {
    const seed = window.KRISTWIN_SEED;
    const out = {};
    for (const [table, { cols, rows }] of Object.entries(seed)) {
      out[table] = rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
    }
    // The SQL file stores bcrypt hashes, which browsers cannot check; re-hash the sample passwords.
    for (const u of out.users) u.password_hash = hashPassword(SAMPLE_PASSWORDS[u.username] || 'changeme');
    out.purchase_order_items.forEach((it, i) => { it.id = i + 1; });
    return out;
  }

  function load() {
    if (db) return db;
    try { db = JSON.parse(ls.get(DB_KEY)); } catch { db = null; }
    if (!db || !Array.isArray(db.users)) { db = seedDb(); save(); }
    const id = Number(ls.get(SESSION_KEY));
    sessionUserId = id || null;
    return db;
  }

  function save() { ls.set(DB_KEY, JSON.stringify(db)); }

  function reset() {
    db = seedDb();
    save();
  }

  const nextId = (table) => db[table].reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const byId = (table, id) => db[table].find((r) => r.id === Number(id)) || null;
  const nowStamp = () => `${today()} ${new Date().toTimeString().slice(0, 8)}`;

  function today() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  /** Runs fn on a copy of the data and keeps it only if fn succeeds (like a database transaction). */
  function transaction(fn) {
    const backup = JSON.stringify(db);
    try {
      const result = fn();
      save();
      return result;
    } catch (e) {
      db = JSON.parse(backup);
      throw e;
    }
  }

  // ---------------------------------------------------------------- password hashing (SHA-256, synchronous)

  function sha256(str) {
    const bytes = new TextEncoder().encode(str);
    const K = [];
    const H = [];
    const isPrime = (n) => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
    const frac = (x) => ((x - Math.floor(x)) * 0x100000000) >>> 0;
    for (let n = 2, i = 0; i < 64; n++) {
      if (!isPrime(n)) continue;
      if (i < 8) H[i] = frac(Math.pow(n, 1 / 2));
      K[i++] = frac(Math.pow(n, 1 / 3));
    }
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const msg = new Uint8Array(total);
    msg.set(bytes);
    msg[len] = 0x80;
    const view = new DataView(msg.buffer);
    view.setUint32(total - 8, Math.floor(len / 0x20000000));
    view.setUint32(total - 4, (len * 8) >>> 0);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  const hashPassword = (pw) => 'sha256:' + sha256('kristwin:' + pw);

  // ---------------------------------------------------------------- validation (same messages as bootstrap.php)

  function text(value, label, required = true, max = 120) {
    const s = String(value ?? '').trim();
    if (required && s === '') throw new HttpError(400, `${label} is required.`);
    if ([...s].length > max) throw new HttpError(400, `${label} must be at most ${max} characters.`);
    return s;
  }

  function number(value, label, min = 0, integer = false) {
    const s = typeof value === 'string' ? value.trim() : value;
    if (s === '' || s === null || s === undefined || typeof s === 'boolean' || !isFinite(Number(s))) throw new HttpError(400, `${label} must be a number.`);
    const n = Number(s);
    if (integer && Math.floor(n) !== n) throw new HttpError(400, `${label} must be a whole number.`);
    if (n < min) throw new HttpError(400, `${label} must be at least ${min}.`);
    return integer ? n : Math.round(n * 100) / 100;
  }

  function dateStr(value, label) {
    const s = String(value ?? '');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!d || d.toISOString().slice(0, 10) !== s) throw new HttpError(400, `${label} must be a valid date.`);
    return s;
  }

  function oneOf(value, list, label) {
    if (!list.includes(value)) throw new HttpError(400, `${label} must be one of: ${list.join(', ')}.`);
    return value;
  }

  function findOr404(table, id, label) {
    const r = byId(table, id);
    if (!r) throw new HttpError(404, `${label} not found.`);
    return r;
  }

  const lower = (s) => String(s).toLowerCase();
  const round2 = (n) => Math.round(n * 100) / 100;

  // ---------------------------------------------------------------- auth

  function currentUser() {
    const user = sessionUserId ? byId('users', sessionUserId) : null;
    if (!user) throw new HttpError(401, 'Please log in.');
    return user;
  }

  function requireAdmin(user) {
    if (user.role !== 'admin') throw new HttpError(403, 'Only an administrator can do this.');
  }

  // ---------------------------------------------------------------- views

  function stockStatus(stock, reorder) {
    if (stock <= 0) return 'Out of Stock';
    if (stock < reorder) return 'Low Stock';
    if (stock <= Math.ceil(reorder * (1 + REORDER_SOON_MARGIN))) return 'Reorder Soon';
    return 'In Stock';
  }

  const productView = (p) => ({
    id: p.id, code: p.code, name: p.name, category: p.category, unit: p.unit,
    price: Number(p.price), stock: Number(p.stock), reorderLevel: Number(p.reorder_level),
    status: stockStatus(Number(p.stock), Number(p.reorder_level)),
  });

  function saleView(s) {
    const p = byId('products', s.product_id);
    return {
      id: s.id, txnNo: s.txn_no, date: s.sale_date, productId: s.product_id,
      productName: p ? p.name : '(deleted product)', unit: p ? p.unit : '',
      qty: s.qty, unitPrice: Number(s.unit_price), discount: Number(s.discount), amount: Number(s.amount),
      customer: s.customer, channel: s.channel, createdBy: s.created_by,
    };
  }

  const supplierView = (s) => ({
    id: s.id, name: s.name, contactPerson: s.contact_person, phone: s.phone, email: s.email, address: s.address,
    poCount: db.purchase_orders.filter((po) => po.supplier_id === s.id).length,
  });

  const userView = (u) => ({ id: u.id, username: u.username, name: u.full_name, role: u.role, createdAt: u.created_at });

  function poView(po) {
    const supplier = byId('suppliers', po.supplier_id);
    const items = db.purchase_order_items.filter((it) => it.po_id === po.id).sort((a, b) => a.id - b.id).map((it) => {
      const p = byId('products', it.product_id);
      return {
        productId: it.product_id, productName: p ? p.name : '(deleted product)', unit: p ? p.unit : '',
        qty: it.qty, unitCost: Number(it.unit_cost), lineTotal: round2(it.qty * it.unit_cost),
      };
    });
    return {
      id: po.id, poNo: po.po_no, supplierId: po.supplier_id, supplierName: supplier ? supplier.name : '(deleted supplier)',
      date: po.order_date, status: po.status, notes: po.notes, deliveredAt: po.delivered_at,
      items, itemCount: items.length,
      totalQty: items.reduce((t, it) => t + it.qty, 0),
      totalCost: round2(items.reduce((t, it) => t + it.lineTotal, 0)),
    };
  }

  const byDateDesc = (dateField) => (a, b) => (a[dateField] < b[dateField] ? 1 : a[dateField] > b[dateField] ? -1 : b.id - a.id);

  // ---------------------------------------------------------------- routes

  const ROUTES = [];
  function route(method, pattern, handler, auth = true) {
    const names = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    ROUTES.push({ method, regex, names, handler, auth });
  }

  // auth.php
  route('POST', '/login', ({ body }) => {
    const username = lower(String(body.username ?? '').trim());
    const user = db.users.find((u) => lower(u.username) === username);
    if (!user || user.password_hash !== hashPassword(String(body.password ?? ''))) {
      throw new HttpError(401, 'Incorrect username or password.');
    }
    sessionUserId = user.id;
    ls.set(SESSION_KEY, String(user.id));
    return { user: userView(user) };
  }, false);

  route('POST', '/logout', () => {
    sessionUserId = null;
    ls.del(SESSION_KEY);
    return { ok: true };
  }, false);

  route('GET', '/me', ({ user }) => ({ user: userView(user) }));

  // dashboard.php
  route('GET', '/dashboard', ({ query }) => {
    const now = new Date();
    const curYear = now.getFullYear();
    let years = [...new Set(db.sales.map((s) => Number(s.sale_date.slice(0, 4))))].sort((a, b) => b - a);
    if (!years.length) years = [curYear];
    const year = years.includes(Number(query.year)) ? Number(query.year) : years[0];
    const monthsCount = year === curYear ? now.getMonth() + 1 : 12;
    const inYear = db.sales.filter((s) => Number(s.sale_date.slice(0, 4)) === year);

    const months = Array(12).fill(0);
    for (const s of inYear) months[Number(s.sale_date.slice(5, 7)) - 1] += Number(s.amount);
    for (let i = 0; i < 12; i++) months[i] = round2(months[i]);
    const total = round2(months.reduce((t, m) => t + m, 0));

    let highest = { month: 0, total: months[0] };
    let lowest = { month: 0, total: months[0] };
    for (let i = 1; i < monthsCount; i++) {
      if (months[i] > highest.total) highest = { month: i, total: months[i] };
      if (months[i] < lowest.total) lowest = { month: i, total: months[i] };
    }

    const peaks = months.map((t, i) => ({ t, i })).filter((m) => m.t > 0)
      .sort((a, b) => b.t - a.t || a.i - b.i).slice(0, 2).map((m) => m.i).sort((a, b) => a - b);

    const perProduct = db.products.map((p) => {
      const mine = inYear.filter((s) => s.product_id === p.id);
      return {
        name: p.name,
        amount: round2(mine.reduce((t, s) => t + Number(s.amount), 0)),
        units: mine.reduce((t, s) => t + Number(s.qty), 0),
      };
    });

    const selling = perProduct.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
    const byProduct = selling.slice(0, 5).map((r) => ({ name: r.name, amount: r.amount }));
    const rest = selling.slice(5).reduce((t, r) => t + r.amount, 0);
    if (rest > 0) byProduct.push({ name: 'Other Products', amount: round2(rest), other: true });
    for (const b of byProduct) b.pct = total ? b.amount / total * 100 : 0;

    const lowDemand = LOW_DEMAND_UNITS * monthsCount / 12;
    const lowPerforming = [...perProduct]
      .sort((a, b) => a.amount - b.amount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, 4)
      .map((r) => ({ ...r, status: r.units === 0 ? 'No Sales' : r.units < lowDemand ? 'Low Demand' : 'Slow Moving' }));

    const recent = [...db.purchase_orders].sort(byDateDesc('order_date')).slice(0, 5).reverse();

    return {
      year,
      years,
      periodLabel: monthsCount === 1 ? `Jan ${year}` : `Jan–${MONTHS[monthsCount - 1]} ${year}`,
      months,
      peaks,
      kpis: { total, average: round2(total / monthsCount), avgMonths: monthsCount, highest, lowest },
      byProduct,
      inventory: [...db.products].sort((a, b) => a.id - b.id).map(productView),
      procurement: recent.map(poView),
      lowPerforming,
    };
  });

  // products.php
  function productInput(b, existingId = 0) {
    const p = {
      code: text(b.code, 'Product code', true, 20),
      name: text(b.name, 'Product name', true, 80),
      category: oneOf(b.category ?? '', CATEGORIES, 'Category'),
      unit: text(b.unit, 'Unit', true, 20),
      price: number(b.price ?? '', 'Selling price'),
      stock: number(b.stock ?? '', 'Current stock', 0, true),
      reorder_level: number(b.reorderLevel ?? '', 'Reorder level', 0, true),
    };
    const clash = db.products.find((x) => x.id !== existingId && (lower(x.code) === lower(p.code) || lower(x.name) === lower(p.name)));
    if (clash) throw new HttpError(409, `A product with that ${lower(clash.code) === lower(p.code) ? 'code' : 'name'} already exists.`);
    return p;
  }

  route('GET', '/products', () => [...db.products].sort((a, b) => a.id - b.id).map(productView));

  route('POST', '/products', ({ body }) => transaction(() => {
    const p = { id: nextId('products'), ...productInput(body), created_at: nowStamp() };
    db.products.push(p);
    return productView(p);
  }));

  route('PUT', '/products/:id', ({ body, params }) => transaction(() => {
    const existing = findOr404('products', params.id, 'Product');
    Object.assign(existing, productInput(body, existing.id));
    return productView(existing);
  }));

  route('DELETE', '/products/:id', ({ params, user }) => transaction(() => {
    requireAdmin(user);
    const p = findOr404('products', params.id, 'Product');
    if (db.sales.some((s) => s.product_id === p.id) || db.purchase_order_items.some((it) => it.product_id === p.id)) {
      throw new HttpError(409, `${p.name} has sales or purchase records and cannot be deleted.`);
    }
    db.products = db.products.filter((x) => x.id !== p.id);
    return { ok: true };
  }));

  // sales.php
  route('GET', '/sales', () => [...db.sales].sort(byDateDesc('sale_date')).map(saleView));

  route('POST', '/sales', ({ body: b, user }) => transaction(() => {
    const product = byId('products', Number(b.productId ?? 0));
    if (!product) throw new HttpError(404, 'Product not found.');
    const qty = number(b.qty ?? '', 'Quantity', 1, true);
    const unitPrice = number((b.unitPrice ?? '') === '' ? product.price : b.unitPrice, 'Unit price');
    const discount = number((b.discount ?? '') === '' ? 0 : b.discount, 'Discount');
    const amount = round2(qty * unitPrice - discount);
    if (amount < 0) throw new HttpError(400, 'Discount cannot be larger than the sale amount.');
    if (qty > product.stock) throw new HttpError(400, `Not enough stock. Only ${product.stock} ${product.unit} of ${product.name} left.`);
    const id = nextId('sales');
    const sale = {
      id,
      txn_no: `TXN-${String(id).padStart(5, '0')}`,
      sale_date: dateStr(b.date || today(), 'Date'),
      product_id: product.id,
      qty,
      unit_price: unitPrice,
      discount,
      amount,
      customer: text(b.customer, 'Customer', false, 80) || 'Walk-in',
      channel: oneOf(b.channel || 'In-store', CHANNELS, 'Channel'),
      created_by: user.full_name,
      created_at: nowStamp(),
    };
    db.sales.push(sale);
    product.stock -= qty;
    return saleView(sale);
  }));

  route('DELETE', '/sales/:id', ({ params, user }) => transaction(() => {
    requireAdmin(user);
    const sale = byId('sales', params.id);
    if (!sale) throw new HttpError(404, 'Sale not found.');
    const p = byId('products', sale.product_id);
    if (p) p.stock += sale.qty;
    db.sales = db.sales.filter((s) => s.id !== sale.id);
    return { ok: true };
  }));

  // suppliers.php
  function supplierInput(b, existingId = 0) {
    const s = {
      name: text(b.name, 'Supplier name', true, 80),
      contact_person: text(b.contactPerson, 'Contact person', false, 80),
      phone: text(b.phone, 'Phone', false, 40),
      email: text(b.email, 'Email / Messenger', false, 120),
      address: text(b.address, 'Address', false, 160),
    };
    if (db.suppliers.some((x) => x.id !== existingId && lower(x.name) === lower(s.name))) {
      throw new HttpError(409, 'A supplier with that name already exists.');
    }
    return s;
  }

  route('GET', '/suppliers', () => [...db.suppliers].sort((a, b) => a.id - b.id).map(supplierView));

  route('POST', '/suppliers', ({ body }) => transaction(() => {
    const s = { id: nextId('suppliers'), ...supplierInput(body), created_at: nowStamp() };
    db.suppliers.push(s);
    return supplierView(s);
  }));

  route('PUT', '/suppliers/:id', ({ body, params }) => transaction(() => {
    const existing = findOr404('suppliers', params.id, 'Supplier');
    Object.assign(existing, supplierInput(body, existing.id));
    return supplierView(existing);
  }));

  route('DELETE', '/suppliers/:id', ({ params, user }) => transaction(() => {
    requireAdmin(user);
    const s = findOr404('suppliers', params.id, 'Supplier');
    if (db.purchase_orders.some((po) => po.supplier_id === s.id)) throw new HttpError(409, `${s.name} has purchase orders and cannot be deleted.`);
    db.suppliers = db.suppliers.filter((x) => x.id !== s.id);
    return { ok: true };
  }));

  // purchases.php
  function purchaseInput(b) {
    const supplier = findOr404('suppliers', b.supplierId ?? 0, 'Supplier');
    const lines = b.items;
    if (!Array.isArray(lines) || !lines.length) throw new HttpError(400, 'Add at least one item.');
    const seen = new Set();
    const items = lines.map((it, i) => {
      const n = i + 1;
      const product = findOr404('products', (it && it.productId) ?? 0, `Product on line ${n}`);
      if (seen.has(product.id)) throw new HttpError(400, `${product.name} is listed more than once.`);
      seen.add(product.id);
      return {
        product_id: product.id,
        qty: number(it.qty ?? '', `Quantity on line ${n}`, 1, true),
        unit_cost: number(it.unitCost ?? '', `Unit cost on line ${n}`),
      };
    });
    return {
      supplier_id: supplier.id,
      order_date: dateStr(b.date || today(), 'Date'),
      notes: text(b.notes, 'Notes', false, 300),
      items,
    };
  }

  function savePoItems(poId, items) {
    db.purchase_order_items = db.purchase_order_items.filter((it) => it.po_id !== poId);
    for (const it of items) db.purchase_order_items.push({ id: nextId('purchase_order_items'), po_id: poId, ...it });
  }

  route('GET', '/purchases', () => [...db.purchase_orders].sort(byDateDesc('order_date')).map(poView));

  route('POST', '/purchases', ({ body }) => transaction(() => {
    const input = purchaseInput(body);
    const year = input.order_date.slice(0, 4);
    const last = db.purchase_orders
      .filter((po) => po.po_no.startsWith(`PO-${year}-`))
      .reduce((m, po) => Math.max(m, Number(po.po_no.split('-').pop()) || 0), 0);
    const po = {
      id: nextId('purchase_orders'),
      po_no: `PO-${year}-${String(last + 1).padStart(3, '0')}`,
      supplier_id: input.supplier_id,
      order_date: input.order_date,
      status: 'Pending',
      notes: input.notes,
      stock_applied: 0,
      delivered_at: null,
      created_at: nowStamp(),
    };
    db.purchase_orders.push(po);
    savePoItems(po.id, input.items);
    return poView(po);
  }));

  route('PUT', '/purchases/:id', ({ body, params }) => transaction(() => {
    const po = findOr404('purchase_orders', params.id, 'Purchase order');
    if (!PO_FLOW[po.status].length) throw new HttpError(409, `${po.status} purchase orders can no longer be edited.`);
    const input = purchaseInput(body);
    Object.assign(po, { supplier_id: input.supplier_id, order_date: input.order_date, notes: input.notes });
    savePoItems(po.id, input.items);
    return poView(po);
  }));

  route('PATCH', '/purchases/:id/status', ({ body, params }) => transaction(() => {
    const status = String(body.status ?? '');
    const po = byId('purchase_orders', params.id);
    if (!po) throw new HttpError(404, 'Purchase order not found.');
    if (!PO_FLOW[po.status].includes(status)) throw new HttpError(409, `Cannot change status from ${po.status} to ${status || '(blank)'}.`);
    po.status = status;
    if (status === 'Delivered' && !po.stock_applied) {
      for (const it of db.purchase_order_items.filter((x) => x.po_id === po.id)) {
        const p = byId('products', it.product_id);
        if (p) p.stock += it.qty;
      }
      po.stock_applied = 1;
      po.delivered_at = today();
    }
    return poView(po);
  }));

  route('DELETE', '/purchases/:id', ({ params, user }) => transaction(() => {
    requireAdmin(user);
    const po = findOr404('purchase_orders', params.id, 'Purchase order');
    if (po.status === 'Delivered') throw new HttpError(409, 'Delivered purchase orders cannot be deleted.');
    db.purchase_orders = db.purchase_orders.filter((x) => x.id !== po.id);
    db.purchase_order_items = db.purchase_order_items.filter((it) => it.po_id !== po.id);
    return { ok: true };
  }));

  // users.php
  route('GET', '/users', ({ user }) => {
    requireAdmin(user);
    return [...db.users].sort((a, b) => a.id - b.id).map(userView);
  });

  route('POST', '/users', ({ body: b, user }) => transaction(() => {
    requireAdmin(user);
    const username = lower(text(b.username, 'Username', true, 30));
    if (!/^[a-z0-9._-]+$/.test(username)) throw new HttpError(400, 'Username may only use letters, numbers, dots, dashes and underscores.');
    if (db.users.some((u) => lower(u.username) === username)) throw new HttpError(409, 'That username is already taken.');
    const password = String(b.password ?? '');
    if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
    const u = {
      id: nextId('users'),
      username,
      full_name: text(b.name, 'Full name', true, 80),
      role: oneOf(b.role ?? '', ROLES, 'Role'),
      password_hash: hashPassword(password),
      created_at: nowStamp(),
    };
    db.users.push(u);
    return userView(u);
  }));

  route('PUT', '/users/:id', ({ body: b, params, user }) => transaction(() => {
    requireAdmin(user);
    const target = findOr404('users', params.id, 'User');
    const role = oneOf(b.role ?? '', ROLES, 'Role');
    if (target.id === user.id && role !== 'admin') throw new HttpError(400, 'You cannot remove your own administrator role.');
    target.full_name = text(b.name, 'Full name', true, 80);
    target.role = role;
    if (b.password) {
      if (String(b.password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
      target.password_hash = hashPassword(String(b.password));
    }
    return userView(target);
  }));

  route('DELETE', '/users/:id', ({ params, user }) => transaction(() => {
    requireAdmin(user);
    const target = findOr404('users', params.id, 'User');
    if (target.id === user.id) throw new HttpError(400, 'You cannot delete your own account.');
    db.users = db.users.filter((u) => u.id !== target.id);
    return { ok: true };
  }));

  // ---------------------------------------------------------------- dispatcher

  /** Handles one API call. Returns { status, data } like an HTTP response. */
  function request(method, fullPath, body) {
    load();
    const [rawPath, qs = ''] = fullPath.split('?');
    const path = '/' + rawPath.replace(/^\/+|\/+$/g, '');
    const query = Object.fromEntries(new URLSearchParams(qs));
    try {
      for (const r of ROUTES) {
        const m = r.method === method && r.regex.exec(path);
        if (!m) continue;
        const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
        const user = r.auth ? currentUser() : null;
        // Handlers get a deep copy of the body so they cannot be affected by later UI changes.
        const data = r.handler({ body: body ? JSON.parse(JSON.stringify(body)) : {}, params, query, user });
        return { status: 200, data: data ?? { ok: true } };
      }
      throw new HttpError(404, 'Not found.');
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, data: { error: e.message } };
      console.error(e);
      return { status: 500, data: { error: 'Something went wrong.' } };
    }
  }

  return { request, reset };
})();
