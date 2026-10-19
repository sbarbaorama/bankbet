// Grafici minimi su canvas (linea e barre), con supporto HiDPI e tema.

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const color = (n) => css.getPropertyValue(n).trim();
  return { ctx, w, h, color };
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
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(0) + 'k';
  return Math.round(v * 100) / 100 + '';
}

function axes(ctx, w, h, pad, ticks, y, color) {
  ctx.font = '11px system-ui, sans-serif';
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
    ctx.fillText(fmtTick(t), pad.l - 6, py);
  }
}

export function lineChart(canvas, points, { emptyText = 'Nessun dato' } = {}) {
  const { ctx, w, h, color } = setup(canvas);
  if (points.length < 2) {
    ctx.fillStyle = color('--muted');
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(emptyText, w / 2, h / 2);
    return;
  }
  const pad = { l: 48, r: 12, t: 12, b: 22 };
  const vals = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const ymin = ticks[0], ymax = ticks[ticks.length - 1];
  const x = (i) => pad.l + (i / (points.length - 1)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - ymin) / (ymax - ymin)) * (h - pad.t - pad.b);
  axes(ctx, w, h, pad, ticks, y, color);

  // Etichette data (prima e ultima)
  ctx.textBaseline = 'top';
  ctx.fillStyle = color('--muted');
  ctx.textAlign = 'left';
  ctx.fillText(points[0].label || '', pad.l, h - pad.b + 6);
  ctx.textAlign = 'right';
  ctx.fillText(points[points.length - 1].label || '', w - pad.r, h - pad.b + 6);

  const accent = color('--accent');
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, accent + '55');
  grad.addColorStop(1, accent + '00');
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.value)) : ctx.moveTo(x(i), y(p.value))));
  ctx.lineTo(x(points.length - 1), h - pad.b);
  ctx.lineTo(x(0), h - pad.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.value)) : ctx.moveTo(x(i), y(p.value))));
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function barChart(canvas, bars, { emptyText = 'Nessun dato' } = {}) {
  const { ctx, w, h, color } = setup(canvas);
  if (!bars.length) {
    ctx.fillStyle = color('--muted');
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(emptyText, w / 2, h / 2);
    return;
  }
  const pad = { l: 48, r: 12, t: 12, b: 22 };
  const vals = bars.map((b) => b.value);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const ymin = ticks[0], ymax = ticks[ticks.length - 1];
  const y = (v) => pad.t + (1 - (v - ymin) / (ymax - ymin)) * (h - pad.t - pad.b);
  axes(ctx, w, h, pad, ticks, y, color);
  const slot = (w - pad.l - pad.r) / bars.length;
  const bw = Math.max(2, Math.min(36, slot * 0.7));
  const showEvery = Math.ceil(bars.length / Math.max(1, Math.floor((w - pad.l) / 48)));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  bars.forEach((b, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const y0 = y(0), y1 = y(b.value);
    ctx.fillStyle = b.value >= 0 ? color('--pos') : color('--neg');
    ctx.fillRect(cx - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
    if (i % showEvery === 0) {
      ctx.fillStyle = color('--muted');
      ctx.fillText(b.label, cx, h - pad.b + 6);
    }
  });
}
