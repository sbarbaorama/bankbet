// Grafici su canvas (linea interattiva e barre), con supporto HiDPI e tema.

const FONT = '"IBM Plex Sans", system-ui, sans-serif';

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const color = (n) => css.getPropertyValue(n).trim();
  return { ctx, w, h, color };
}

// Converte qualunque colore CSS in rgba() con l'opacità indicata (funziona anche con rgb(), hsl(), nomi).
function rgba(ctx, color, a) {
  ctx.fillStyle = '#000';
  ctx.fillStyle = color;
  const c = ctx.fillStyle;
  if (c[0] === '#') {
    const n = parseInt(c.slice(1, 7), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = c.match(/[\d.]+/g);
  return m ? `rgba(${m[0]},${m[1]},${m[2]},${a})` : color;
}

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function fmtTick(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(0) + 'k';
  return (Math.round(v * 100) / 100).toLocaleString('it-IT');
}

function emptyMsg(ctx, w, h, color, text) {
  ctx.fillStyle = color('--muted');
  ctx.font = `13px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
}

// Posiziona il riquadro accanto al punto (px, py) senza coprirlo: in diagonale, sul lato
// dove c'è più spazio (destra/sinistra) e sopra o sotto il punto a seconda di dove passa la linea.
// Con side=true resta di fianco alla linea verticale, utile quando i punti sono più d'uno.
function placeTip(tip, px, py, w, h, side = false, hw = 0) {
  const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 14;
  const right = px + hw + gap + tw <= w - 2 && (px < w * 0.6 || px - hw - gap - tw < 2);
  let left = right ? px + hw + gap : px - hw - gap - tw;
  left = Math.min(Math.max(2, left), w - tw - 2);
  let top;
  if (side) top = Math.min(Math.max(2, py - th / 2), h - th - 2);
  else {
    const above = py - gap - th >= 2 && (py > h * 0.45 || py + gap + th > h - 2);
    top = above ? py - gap - th : py + gap;
    top = Math.min(Math.max(2, top), h - th - 2);
  }
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function tipEl(canvas) {
  const wrap = canvas.parentElement;
  let tip = wrap.querySelector(':scope > .chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    wrap.append(tip);
  }
  return tip;
}

/**
 * Grafico a linea su asse temporale.
 * points: [{ t: ms, value, ev? }]
 * opts: { emptyText, fmtValue(v), fmtDate(t), fmtTipDate(t), ddRange: {t0, t1}, compact }
 */
export function lineChart(canvas, points, opts = {}) {
  canvas._lc = { points, opts };
  if (!canvas._lcBound) {
    canvas._lcBound = true;
    const move = (e) => {
      const r = canvas.getBoundingClientRect();
      drawLine(canvas, e.clientX - r.left);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', move);
    canvas.addEventListener('pointerleave', () => drawLine(canvas, null));
  }
  drawLine(canvas, null);
}

function drawLine(canvas, hoverX) {
  const { points, opts } = canvas._lc;
  const { ctx, w, h, color } = setup(canvas);
  const tip = tipEl(canvas);
  if (points.length < 2) {
    tip.hidden = true;
    emptyMsg(ctx, w, h, color, opts.emptyText || 'Nessun dato');
    return;
  }
  const compact = opts.compact ?? w < 480;
  const pad = compact ? { l: 4, r: 8, t: 10, b: 20 } : { l: 54, r: 12, t: 12, b: 26 };
  const hasEv = points.some((p) => p.ev != null && Math.abs(p.ev - p.value) > 1e-9);
  const vals = points.map((p) => p.value).concat(hasEv ? points.map((p) => p.ev ?? p.value) : []);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const ymin = ticks[0], ymax = ticks[ticks.length - 1];
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t > t0 ? points[points.length - 1].t : t0 + 1;
  const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - ymin) / (ymax - ymin)) * (h - pad.t - pad.b);
  const fmtDate = opts.fmtDate || ((t) => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }));

  // Griglia ed etichette asse Y
  ctx.font = `11px ${FONT}`;
  ctx.lineWidth = 1;
  ctx.strokeStyle = color('--grid');
  ctx.fillStyle = color('--muted');
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const tk of ticks) {
    const py = Math.round(y(tk)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, py);
    ctx.lineTo(w - pad.r, py);
    ctx.stroke();
    if (!compact) ctx.fillText(fmtTick(tk), pad.l - 8, py);
  }

  // Banda del drawdown massimo
  if (opts.ddRange && opts.ddRange.t1 > opts.ddRange.t0) {
    ctx.fillStyle = rgba(ctx, color('--neg'), 0.12);
    const a = x(Math.max(t0, opts.ddRange.t0)), b = x(Math.min(t1, opts.ddRange.t1));
    ctx.fillRect(a, pad.t, Math.max(2, b - a), h - pad.t - pad.b);
  }

  // Etichette asse X (date)
  ctx.fillStyle = color('--muted');
  ctx.textBaseline = 'top';
  const nLabels = compact ? 2 : Math.max(2, Math.min(6, Math.floor((w - pad.l) / 110)));
  for (let i = 0; i < nLabels; i++) {
    const t = t0 + ((t1 - t0) * i) / (nLabels - 1);
    ctx.textAlign = i === 0 ? 'left' : i === nLabels - 1 ? 'right' : 'center';
    ctx.fillText(fmtDate(t), x(t), h - pad.b + 8);
  }

  const accent = color('--accent');
  const path = (key) => {
    ctx.beginPath();
    points.forEach((p, i) => {
      const v = key === 'ev' ? (p.ev ?? p.value) : p.value;
      if (i) ctx.lineTo(x(p.t), y(v)); else ctx.moveTo(x(p.t), y(v));
    });
  };

  // Area sotto la linea reale
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, rgba(ctx, accent, 0.26));
  grad.addColorStop(1, rgba(ctx, accent, 0));
  path('value');
  ctx.lineTo(x(points[points.length - 1].t), h - pad.b);
  ctx.lineTo(x(points[0].t), h - pad.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Linea attesa (EV)
  if (hasEv) {
    path('ev');
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = color('--ev');
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Linea reale: i tratti dovuti a depositi/prelievi (p.tx) non fanno parte della linea delle scommesse,
  // vengono disegnati a parte come gradino tratteggiato con etichetta.
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i && !p.tx) ctx.lineTo(x(p.t), y(p.value)); else ctx.moveTo(x(p.t), y(p.value));
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  const steps = points.map((p, i) => (i && p.tx ? { prev: points[i - 1], p } : null)).filter(Boolean);
  if (steps.length) {
    const dep = color('--deposit') || color('--ev');
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = dep;
    ctx.lineWidth = 2.5;
    for (const { prev, p } of steps) {
      ctx.beginPath();
      ctx.moveTo(x(prev.t), y(prev.value));
      ctx.lineTo(x(prev.t), y(p.value));
      ctx.lineTo(x(p.t), y(p.value));
      ctx.stroke();
    }
    ctx.restore();
    // Etichette solo dove c'è spazio: con troppi movimenti, o se due etichette dalla stessa parte
    // (sopra per i depositi, sotto per i prelievi) si sovrapporrebbero, resta solo il pallino.
    const label = opts.fmtTx || ((tx) => (tx.delta >= 0 ? '+' : '') + tx.delta.toFixed(2));
    ctx.font = `600 11.5px ${FONT}`;
    const showLabels = steps.length <= (compact ? 3 : 6);
    const placed = [];
    for (const { prev, p } of steps) {
      const sx = x(prev.t), sy = y(p.value), up = p.tx.delta >= 0;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fillStyle = dep;
      ctx.fill();
      if (!showLabels) continue;
      const text = label(p.tx);
      const tw = ctx.measureText(text).width + 18;
      const bx = Math.min(Math.max(sx - tw / 2, pad.l), w - pad.r - tw);
      const by = up ? Math.max(pad.t, sy - 30) : Math.min(h - pad.b - 22, sy + 10);
      if (placed.some((r) => bx < r.x + r.w + 4 && r.x < bx + tw + 4 && by < r.y + 24 && r.y < by + 24)) continue;
      placed.push({ x: bx, y: by, w: tw });
      ctx.font = `600 11.5px ${FONT}`;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, tw, 20, 10); else ctx.rect(bx, by, tw, 20);
      ctx.fillStyle = color('--bg');
      ctx.fill();
      ctx.strokeStyle = dep;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = dep;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + tw / 2, by + 10.5);
    }
  }

  const dot = (p, r) => {
    ctx.beginPath();
    ctx.arc(x(p.t), y(p.value), r, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color('--surface');
    ctx.stroke();
  };

  if (hoverX == null) {
    dot(points[points.length - 1], 4.5);
    tip.hidden = true;
    return;
  }

  // Punto più vicino al cursore
  let best = 0, bestD = Infinity;
  points.forEach((p, i) => {
    const d = Math.abs(x(p.t) - hoverX);
    if (d <= bestD) { bestD = d; best = i; }
  });
  const p = points[best];
  const px = x(p.t);
  ctx.beginPath();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = color('--faint');
  ctx.lineWidth = 1;
  ctx.moveTo(Math.round(px) + 0.5, pad.t);
  ctx.lineTo(Math.round(px) + 0.5, h - pad.b);
  ctx.stroke();
  ctx.setLineDash([]);
  if (hasEv && p.ev != null) {
    ctx.beginPath();
    ctx.arc(px, y(p.ev), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color('--ev');
    ctx.fill();
  }
  dot(p, 5);

  const fv = opts.fmtValue || ((v) => v.toFixed(2));
  const fd = opts.fmtTipDate || ((t) => new Date(t).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' }));
  const txLine = p.tx ? `<div class="x">${(opts.fmtTx || ((tx) => tx.delta.toFixed(2)))(p.tx)}</div>` : '';
  tip.innerHTML = `<div class="d">${fd(p.t)}</div><b>${fv(p.value)}</b>${txLine}${hasEv && p.ev != null && !p.tx ? `<div class="e">atteso ${fv(p.ev)}</div>` : ''}`;
  tip.hidden = false;
  placeTip(tip, px, y(p.value), w, h);
}

export function barChart(canvas, bars, opts = {}) {
  canvas._bc = { bars, opts };
  if (!canvas._bcBound) {
    canvas._bcBound = true;
    const move = (e) => { const r = canvas.getBoundingClientRect(); drawBars(canvas, e.clientX - r.left); };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', move);
    canvas.addEventListener('pointerleave', () => drawBars(canvas, null));
  }
  drawBars(canvas, null);
}

function drawBars(canvas, hoverX) {
  const { bars, opts } = canvas._bc;
  const { ctx, w, h, color } = setup(canvas);
  const tip = tipEl(canvas);
  if (!bars.length) { tip.hidden = true; emptyMsg(ctx, w, h, color, opts.emptyText || 'Nessun dato'); return; }
  const pad = { l: 54, r: 12, t: 12, b: 24 };
  const vals = bars.map((b) => b.value);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const ymin = ticks[0], ymax = ticks[ticks.length - 1];
  const y = (v) => pad.t + (1 - (v - ymin) / (ymax - ymin)) * (h - pad.t - pad.b);
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = color('--muted');
  ctx.strokeStyle = color('--grid');
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of ticks) {
    const py = Math.round(y(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, py);
    ctx.lineTo(w - pad.r, py);
    ctx.stroke();
    ctx.fillText(fmtTick(t), pad.l - 8, py);
  }
  const slot = (w - pad.l - pad.r) / bars.length;
  const bw = Math.max(2, Math.min(36, slot * 0.7));
  const showEvery = Math.ceil(bars.length / Math.max(1, Math.floor((w - pad.l) / 48)));
  const hover = hoverX == null ? -1 : Math.floor((hoverX - pad.l) / slot);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  bars.forEach((b, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const y0 = y(0), y1 = y(b.value);
    if (i === hover) {
      ctx.fillStyle = rgba(ctx, color('--text'), 0.06);
      ctx.fillRect(pad.l + slot * i, pad.t, slot, h - pad.t - pad.b);
    }
    ctx.fillStyle = b.value >= 0 ? color('--pos') : color('--neg');
    const top = Math.min(y0, y1), hh = Math.max(1, Math.abs(y1 - y0));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - bw / 2, top, bw, hh, 3); else ctx.rect(cx - bw / 2, top, bw, hh);
    ctx.fill();
    if (i % showEvery === 0) {
      ctx.fillStyle = color('--muted');
      ctx.fillText(b.label, cx, h - pad.b + 8);
    }
  });
  if (hover < 0 || hover >= bars.length) { tip.hidden = true; return; }
  const b = bars[hover];
  const fv = opts.fmtValue || ((v) => v.toFixed(2));
  const fl = opts.fmtLabel || ((l) => l);
  tip.innerHTML = `<div class="d">${fl(b.label)}</div><b class="${b.value >= 0 ? 'pos' : 'neg'}">${fv(b.value)}</b>`;
  tip.hidden = false;
  const cx = pad.l + slot * hover + slot / 2;
  // nella colonna del mese, nello spazio libero sopra o sotto la barra: così non copre nessuna barra
  const th = tip.offsetHeight, tw = tip.offsetWidth, g = 8, y0 = y(0), yv = y(b.value);
  const hi = Math.min(y0, yv), lo = Math.max(y0, yv);
  const tops = b.value >= 0 ? [hi - g - th, lo + g] : [lo + g, hi - g - th];
  const top = tops.find((t) => t >= 2 && t + th <= h - pad.b + 2);
  if (top != null) {
    tip.style.left = `${Math.round(Math.min(Math.max(2, cx - tw / 2), w - tw - 2))}px`;
    tip.style.top = `${Math.round(top)}px`;
  } else placeTip(tip, cx, hi, w, h, false, bw / 2);
}

/**
 * Più linee sullo stesso asse (es. confronto strategie). series: [{ name, color, points: [{ x, y }] }]
 * opts: { fmtValue(v), fmtX(x), baseline }
 */
export function multiLineChart(canvas, series, opts = {}) {
  canvas._ml = { series, opts };
  if (!canvas._mlBound) {
    canvas._mlBound = true;
    const move = (e) => { const r = canvas.getBoundingClientRect(); drawMulti(canvas, e.clientX - r.left); };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', move);
    canvas.addEventListener('pointerleave', () => drawMulti(canvas, null));
  }
  drawMulti(canvas, null);
}

function drawMulti(canvas, hoverX) {
  const { series, opts } = canvas._ml;
  const { ctx, w, h, color } = setup(canvas);
  const tip = tipEl(canvas);
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) { tip.hidden = true; emptyMsg(ctx, w, h, color, 'Nessun dato'); return; }
  const pad = { l: 58, r: 12, t: 12, b: 26 };
  const ys = all.map((p) => p.y).concat(opts.baseline != null ? [opts.baseline] : []);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const ymin = ticks[0], ymax = ticks[ticks.length - 1];
  const xmin = Math.min(...all.map((p) => p.x)), xmax = Math.max(...all.map((p) => p.x)) || 1;
  const x = (v) => pad.l + ((v - xmin) / (xmax - xmin || 1)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - ymin) / (ymax - ymin)) * (h - pad.t - pad.b);
  ctx.font = `11px ${FONT}`;
  ctx.lineWidth = 1;
  ctx.strokeStyle = color('--grid');
  ctx.fillStyle = color('--muted');
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of ticks) {
    const py = Math.round(y(t)) + 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(w - pad.r, py); ctx.stroke();
    ctx.fillText(fmtTick(t), pad.l - 8, py);
  }
  ctx.textBaseline = 'top';
  const fx = opts.fmtX || ((v) => String(Math.round(v)));
  ctx.textAlign = 'left'; ctx.fillText(fx(xmin), pad.l, h - pad.b + 8);
  ctx.textAlign = 'right'; ctx.fillText(fx(xmax), w - pad.r, h - pad.b + 8);
  if (opts.baseline != null) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = color('--faint');
    const by = Math.round(y(opts.baseline)) + 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, by); ctx.lineTo(w - pad.r, by); ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const s of series) {
    ctx.beginPath();
    s.points.forEach((p, i) => (i ? ctx.lineTo(x(p.x), y(p.y)) : ctx.moveTo(x(p.x), y(p.y))));
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  if (hoverX == null) { tip.hidden = true; return; }
  const ref = series[0].points;
  let best = 0, bestD = Infinity;
  ref.forEach((p, i) => { const d = Math.abs(x(p.x) - hoverX); if (d <= bestD) { bestD = d; best = i; } });
  const px = x(ref[best].x);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = color('--faint');
  ctx.beginPath(); ctx.moveTo(Math.round(px) + 0.5, pad.t); ctx.lineTo(Math.round(px) + 0.5, h - pad.b); ctx.stroke();
  ctx.setLineDash([]);
  const rows = [];
  for (const s of series) {
    const p = s.points[best];
    if (!p) continue;
    ctx.beginPath(); ctx.arc(px, y(p.y), 4, 0, Math.PI * 2); ctx.fillStyle = s.color; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = color('--surface'); ctx.stroke();
    rows.push({ s, v: p.y });
  }
  rows.sort((a, b) => b.v - a.v);
  const fv = opts.fmtValue || ((v) => v.toFixed(2));
  tip.innerHTML = `<div class="d">${fx(ref[best].x)}</div>` + rows.map((r) =>
    `<div style="display:flex;align-items:center;gap:6px;justify-content:space-between"><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:10px;height:3px;border-radius:2px;background:${r.s.color};display:inline-block"></i>${r.s.name}</span><strong style="font-family:var(--font-num);font-size:1rem">${fv(r.v)}</strong></div>`).join('');
  tip.hidden = false;
  const rys = rows.map((r) => y(r.v));
  placeTip(tip, px, (Math.min(...rys) + Math.max(...rys)) / 2, w, h, true);
}
