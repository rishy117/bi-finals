'use strict';
// Hand-drawn SVG charts styled after the Power BI prototype. No external libraries,
// so the system works without internet.
window.Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const COLORS = { bar: '#9dc3e6', peak: '#1f3864', grid: '#e9edf2', axis: '#5f6b7a', label: '#3c4653' };
  const DONUT_COLORS = ['#1f3864', '#2e75b6', '#5b9bd5', '#9dc3e6', '#f4b183'];
  const OTHER_COLOR = '#c4c4c4';

  const peso = (n) => '₱' + Math.round(n).toLocaleString('en-US');

  function short(v) {
    if (v >= 1e6) return '₱' + (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (v >= 1e3) return '₱' + (v % 1000 === 0 || v >= 1e4 ? Math.round(v / 1e3) : (v / 1e3).toFixed(1)) + 'K';
    return '₱' + Math.round(v);
  }

  function niceStep(raw) {
    if (raw <= 0) return 1000;
    const exp = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / exp;
    return [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find((x) => x >= f) * exp;
  }

  function el(name, attrs = {}, text) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text != null) node.textContent = text;
    return node;
  }

  // ---- tooltip shared by all charts
  const tip = () => document.getElementById('tooltip');
  function bindTip(node, html) {
    node.addEventListener('mousemove', (e) => {
      const t = tip();
      t.innerHTML = html;
      t.classList.add('show');
      const x = Math.min(e.clientX + 14, window.innerWidth - t.offsetWidth - 8);
      t.style.left = x + 'px';
      t.style.top = (e.clientY - t.offsetHeight - 10) + 'px';
    });
    node.addEventListener('mouseleave', () => tip().classList.remove('show'));
  }

  function bar(container, values, { peaks = [], year = '' } = {}) {
    const W = 660, H = 250, m = { t: 22, r: 8, b: 28, l: 46 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(...values, 0);
    const step = niceStep(max / 4);
    const yMax = step * 4;
    const y = (v) => m.t + ih - (v / yMax) * ih;
    const slot = iw / values.length;
    const bw = slot * 0.62;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Monthly sales bar chart' });
    for (let i = 0; i <= 4; i++) {
      const v = step * i;
      svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: COLORS.grid, 'stroke-width': 1 }));
      svg.append(el('text', { x: m.l - 8, y: y(v) + 3.5, 'text-anchor': 'end', 'font-size': 10, fill: COLORS.axis }, v === 0 && yMax >= 1e4 ? '₱0K' : short(v)));
    }
    values.forEach((v, i) => {
      const x = m.l + slot * i + (slot - bw) / 2;
      const isPeak = peaks.includes(i);
      const h = Math.max(0, m.t + ih - y(v));
      const rect = el('rect', { class: 'bar', x, y: y(v), width: bw, height: h, fill: isPeak ? COLORS.peak : COLORS.bar });
      bindTip(rect, `<b>${MONTHS_LONG[i]} ${year}</b><br>${peso(v)}${isPeak ? ' · Peak month' : ''}`);
      svg.append(rect);
      if (v > 0) svg.append(el('text', { x: x + bw / 2, y: y(v) - 5, 'text-anchor': 'middle', 'font-size': 9.5, fill: COLORS.label }, short(v)));
      svg.append(el('text', { x: x + bw / 2, y: H - m.b + 16, 'text-anchor': 'middle', 'font-size': 11, fill: COLORS.label }, MONTHS[i]));
    });
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, stroke: '#c9d1db', 'stroke-width': 1 }));
    container.replaceChildren(svg);
  }

  // Segments run counter-clockwise starting at 3 o'clock, as in the prototype.
  function donut(container, legendEl, segments, total) {
    const S = 220, c = S / 2, R = 96, r = 58;
    const svg = el('svg', { viewBox: `0 0 ${S} ${S}`, role: 'img', 'aria-label': 'Sales by product donut chart' });
    const pt = (deg, rad) => [c + rad * Math.sin(deg * Math.PI / 180), c - rad * Math.cos(deg * Math.PI / 180)];
    const color = (s, i) => (s.other ? OTHER_COLOR : DONUT_COLORS[i % DONUT_COLORS.length]);

    if (!total) {
      svg.append(el('circle', { cx: c, cy: c, r: (R + r) / 2, fill: 'none', stroke: '#eef1f5', 'stroke-width': R - r }));
    }
    let angle = 90;
    segments.forEach((s, i) => {
      const sweep = Math.min(359.999, (s.amount / total) * 360);
      if (sweep <= 0) return;
      const a0 = angle, a1 = angle - sweep;
      const large = sweep > 180 ? 1 : 0;
      const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r), [x3, y3] = pt(a0, r);
      const d = `M${x0},${y0} A${R},${R} 0 ${large} 0 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 1 ${x3},${y3} Z`;
      const path = el('path', { d, fill: color(s, i), stroke: '#fff', 'stroke-width': 2 });
      bindTip(path, `<b>${s.name}</b><br>${peso(s.amount)} (${s.pct.toFixed(1)}%)`);
      svg.append(path);
      if (s.pct >= 4) {
        const [lx, ly] = pt(a0 - sweep / 2, (R + r) / 2);
        const dark = ['#9dc3e6', '#f4b183', OTHER_COLOR].includes(color(s, i));
        svg.append(el('text', {
          x: lx, y: ly + 3.5, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 600,
          fill: dark ? '#2b3440' : '#fff', 'pointer-events': 'none',
        }, s.pct.toFixed(1) + '%'));
      }
      angle = a1;
    });
    svg.append(el('text', { x: c, y: c - 6, 'text-anchor': 'middle', 'font-size': 10, fill: '#5f6b7a' }, 'Total'));
    svg.append(el('text', { x: c, y: c + 13, 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 600, fill: '#1f3864' }, short(total)));
    container.replaceChildren(svg);

    legendEl.innerHTML = segments.length
      ? segments.map((s, i) => `
        <div class="row">
          <span class="sw" style="background:${color(s, i)}"></span>
          <span>${s.name.replace(/[<&]/g, '')}</span>
          <span class="val">${peso(s.amount)} (${s.pct.toFixed(1)}%)</span>
        </div>`).join('')
      : '<div class="muted">No sales recorded for this period.</div>';
  }

  return { bar, donut, short };
})();
