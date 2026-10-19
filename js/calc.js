// Calcoli puri: profitto, Kelly, Masaniello, statistiche, quote.

export const STATUSES = {
  pending: 'In corso',
  won: 'Vinta',
  lost: 'Persa',
  void: 'Rimborsata',
  half_won: 'Mezza vinta',
  half_lost: 'Mezza persa',
  cashout: 'Cashout',
};

export function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// Profitto netto di una scommessa (0 se ancora in corso).
export function betProfit(b) {
  const s = +b.stake || 0;
  const o = +b.odds || 0;
  switch (b.status) {
    case 'won': return s * (o - 1);
    case 'lost': return -s;
    case 'half_won': return (s / 2) * (o - 1);
    case 'half_lost': return -s / 2;
    case 'cashout': return (+b.payout || 0) - s;
    default: return 0;
  }
}

export function isSettled(b) {
  return b.status && b.status !== 'pending';
}

// Kelly: p probabilità (0-1), odds quota decimale.
export function kelly(p, odds, fraction = 1, capPct = 100) {
  const b = odds - 1;
  if (!(p > 0 && p < 1) || !(b > 0)) return { full: 0, pct: 0, edge: 0, valid: false };
  const edge = p * odds - 1;
  const full = (b * p - (1 - p)) / b;
  let pct = Math.max(0, full) * fraction * 100;
  const capped = pct > capPct;
  if (capped) pct = capPct;
  return { full, pct, edge, capped, valid: true };
}

// ---------- Masaniello ----------
// Tabella f(i, w): frazione di capitale "di valore" nello stato con i eventi giocati e w vinte,
// normalizzata con valore 1 al raggiungimento delle K vittorie. Gioco equo alla quota q.
export function masanielloTable(N, K, q) {
  const f = [];
  for (let i = N; i >= 0; i--) {
    f[i] = [];
    for (let w = Math.min(i, K); w >= 0; w--) {
      if (w >= K) f[i][w] = 1;
      else if (i - w > N - K) f[i][w] = 0;
      else f[i][w] = (f[i + 1][w + 1] + (q - 1) * f[i + 1][w]) / q;
    }
  }
  return f;
}

export function masanielloPlan({ capital, events: N, wins: K, odds: q }) {
  N = +N; K = +K; q = +q; capital = +capital;
  if (!(N >= 1 && K >= 1 && K <= N && q > 1 && capital > 0)) return null;
  const f = masanielloTable(N, K, q);
  const f0 = f[0][0];
  const target = capital / f0;
  return { f, f0, target, multiplier: 1 / f0, N, K, q, capital };
}

// Stato corrente di un Masaniello dato l'elenco delle scommesse collegate (in ordine).
export function masanielloState(m, linkedBets) {
  const plan = masanielloPlan(m);
  if (!plan) return null;
  let i = 0, w = 0, capital = +m.capital;
  const history = [];
  for (const b of linkedBets) {
    if (!isSettled(b)) continue;
    const p = betProfit(b);
    capital += p;
    if (p > 0) { i++; w++; history.push('W'); }
    else if (p < 0) { i++; history.push('L'); }
    else history.push('V');
  }
  const losses = i - w;
  let status = 'active';
  if (w >= plan.K) status = 'won';
  else if (losses > plan.N - plan.K || capital <= 0.005) status = 'lost';
  const pending = linkedBets.filter((b) => !isSettled(b));
  return { plan, i, w, losses, capital, status, history, pending };
}

// Puntata suggerita nello stato corrente; actualOdds = quota reale dell'evento (default quota del piano).
export function masanielloStake(state, actualOdds) {
  if (!state || state.status !== 'active') return 0;
  const { plan, i, w, capital } = state;
  const fi = plan.f[i][w];
  if (!fi) return 0;
  const winRatio = plan.f[i + 1][w + 1] / fi;
  const q = actualOdds > 1 ? actualOdds : plan.q;
  const stake = (capital * winRatio - capital) / (q - 1);
  return Math.max(0, Math.min(stake, capital));
}

// Griglia delle puntate teoriche (righe: vittorie, colonne: perdite) secondo il piano.
export function masanielloGrid(plan) {
  const { f, f0, capital, N, K, q } = plan;
  const rows = [];
  for (let w = 0; w < K; w++) {
    const row = [];
    for (let l = 0; l <= N - K; l++) {
      const i = w + l;
      const fi = f[i][w];
      const X = (capital * fi) / f0;
      const A = (capital * f[i + 1][w + 1]) / f0;
      row.push({ capital: X, stake: (A - X) / (q - 1) });
    }
    rows.push(row);
  }
  return rows;
}

// ---------- Quote ----------
export function impliedProb(odds) {
  return odds > 1 ? 1 / odds : 0;
}

export function overround(oddsList) {
  const sum = oddsList.reduce((a, o) => a + 1 / o, 0);
  return { sum, margin: sum - 1, fair: oddsList.map((o) => (1 / o / sum)) };
}

export function surebet(oddsList, total) {
  const { sum } = overround(oddsList);
  const stakes = oddsList.map((o) => total / o / sum);
  const ret = total / sum;
  return { isArb: sum < 1, stakes, ret, profit: ret - total, roi: (ret - total) / total };
}

// ---------- Statistiche ----------
export function summarize(bets) {
  const settled = bets.filter(isSettled);
  const counted = settled.filter((b) => b.status !== 'void');
  let staked = 0, profit = 0, wins = 0, oddsSum = 0, clvSum = 0, clvN = 0, evSum = 0, evN = 0;
  for (const b of settled) {
    const p = betProfit(b);
    profit += p;
    if (b.status !== 'void') { staked += +b.stake; oddsSum += +b.odds; }
    if (p > 0) wins++;
    if (+b.closingOdds > 1) { clvSum += +b.odds / +b.closingOdds - 1; clvN++; }
    if (+b.prob > 0) { evSum += ((+b.prob / 100) * +b.odds - 1) * +b.stake; evN++; }
  }
  const pending = bets.filter((b) => !isSettled(b));
  return {
    count: bets.length,
    settled: settled.length,
    pending: pending.length,
    pendingStake: pending.reduce((a, b) => a + (+b.stake || 0), 0),
    staked,
    profit,
    yield: staked ? profit / staked : 0,
    winRate: counted.length ? wins / counted.length : 0,
    avgOdds: counted.length ? oddsSum / counted.length : 0,
    avgStake: counted.length ? staked / counted.length : 0,
    clv: clvN ? clvSum / clvN : null,
    clvN,
    ev: evN ? evSum : null,
  };
}

export function groupBy(bets, keyFn) {
  const map = new Map();
  for (const b of bets.filter(isSettled)) {
    const k = keyFn(b) || '—';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(b);
  }
  return [...map.entries()]
    .map(([key, list]) => ({ key, ...summarize(list) }))
    .sort((a, b) => b.profit - a.profit);
}

export function oddsBucket(o) {
  o = +o;
  if (o < 1.5) return '1.01–1.49';
  if (o < 2) return '1.50–1.99';
  if (o < 3) return '2.00–2.99';
  if (o < 5) return '3.00–4.99';
  return '5.00+';
}

// Profitto atteso di una scommessa chiusa: dalla probabilità stimata o, in mancanza,
// dalla quota di chiusura (CLV). null se non c'è una stima.
export function betExpected(b) {
  if (!isSettled(b) || b.status === 'void') return null;
  const s = +b.stake || 0;
  const o = +b.odds || 0;
  if (+b.prob > 0) return ((+b.prob / 100) * o - 1) * s;
  if (+b.closingOdds > 1) return (o / +b.closingOdds - 1) * s;
  return null;
}

// Fortuna rispetto all'atteso, solo sulle scommesse con una stima.
export function luck(bets) {
  let actual = 0, expected = 0, n = 0;
  for (const b of bets) {
    const e = betExpected(b);
    if (e == null) continue;
    actual += betProfit(b);
    expected += e;
    n++;
  }
  return { n, actual, expected, luck: actual - expected };
}

// Drawdown massimo (sul profitto cumulato) di una serie di punti, con l'intervallo picco → minimo.
export function maxDrawdownRange(points) {
  let peak = -Infinity, peakT = null, best = 0, range = null;
  for (const p of points) {
    if (p.profit > peak) { peak = p.profit; peakT = p.t; }
    const dd = peak - p.profit;
    if (dd > best) { best = dd; range = { t0: peakT, t1: p.t }; }
  }
  return { maxDrawdown: best, range };
}

// Serie temporale del bankroll (movimenti + scommesse chiuse), con linea attesa e drawdown massimo.
export function bankrollSeries(bets, transactions) {
  const events = [];
  for (const t of transactions) {
    const d = t.type === 'withdrawal' ? -t.amount : +t.amount;
    events.push({ date: t.date, delta: d, ev: d, kind: 'tx', order: t.createdAt || 0 });
  }
  for (const b of bets.filter(isSettled)) {
    const p = betProfit(b);
    const e = betExpected(b);
    events.push({ date: b.settledDate || b.date, delta: p, ev: e == null ? p : e, kind: 'bet', order: b.updatedAt || b.createdAt || 0 });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
  const perDay = new Map();
  for (const e of events) perDay.set(e.date, (perDay.get(e.date) || 0) + 1);
  const seen = new Map();
  let bal = 0, evBal = 0, cumProfit = 0;
  const points = [];
  for (const e of events) {
    bal += e.delta;
    evBal += e.ev;
    if (e.kind === 'bet') cumProfit += e.delta;
    const k = seen.get(e.date) || 0;
    seen.set(e.date, k + 1);
    const t = Date.parse(e.date + 'T00:00:00') + ((k + 1) * 864e5) / (perDay.get(e.date) + 1);
    points.push({ date: e.date, t, value: bal, ev: evBal, profit: cumProfit });
  }
  const { maxDrawdown, range } = maxDrawdownRange(points);
  return { points, maxDrawdown, ddRange: range };
}

export function streaks(bets) {
  const list = bets.filter((b) => isSettled(b) && b.status !== 'void')
    .sort((a, b) => ((a.settledDate || a.date) < (b.settledDate || b.date) ? -1 : 1));
  let curW = 0, curL = 0, maxW = 0, maxL = 0;
  for (const b of list) {
    const p = betProfit(b);
    if (p > 0) { curW++; curL = 0; } else if (p < 0) { curL++; curW = 0; }
    maxW = Math.max(maxW, curW); maxL = Math.max(maxL, curL);
  }
  return { current: curW ? `${curW}V` : curL ? `${curL}P` : '—', maxW, maxL };
}
