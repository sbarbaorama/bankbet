// Metodi di staking aggiuntivi, cicli progressivi e simulatore Monte Carlo (funzioni pure).
import { betProfit, isSettled } from './calc.js';

// ---------- Unità a fiducia ----------
// points: serie del bankroll (calc.bankrollSeries). L'unità vale unitPct% di un bankroll di riferimento:
// - 'month': il bankroll all'inizio del mese corrente;
// - 'change': il bankroll dell'ultima volta in cui è variato di almeno unitChangePct% dal riferimento precedente.
export function unitValue(settings, points, balanceNow, monthStart) {
  const pct = Math.max(0, +settings.unitPct || 1) / 100;
  let base;
  if (settings.unitRecalc === 'change') {
    const th = Math.max(1, +settings.unitChangePct || 10) / 100;
    for (const p of points) {
      if (base == null) { if (p.value > 0) base = p.value; continue; }
      if (Math.abs(p.value / base - 1) >= th) base = p.value;
    }
  } else {
    const before = points.filter((p) => p.date < monthStart);
    base = before.length ? before[before.length - 1].value : points.length ? points[0].value : undefined;
  }
  if (!(base > 0)) base = Math.max(0, balanceNow);
  return { unit: base * pct, base };
}

// ---------- Profitto fisso ----------
export function targetStake(target, odds) {
  return odds > 1 && target > 0 ? target / (odds - 1) : 0;
}

// ---------- Kelly con incertezza ----------
// Affidabilità delle stime (0–1): quanto del profitto atteso dalle tue probabilità si è realizzato,
// con un'ipotesi prudente del 50% che pesa come 150 scommesse e si diluisce man mano che lo storico cresce.
export function estimateReliability(bets, { prior = 0.5, weight = 150 } = {}) {
  let n = 0, exp = 0, act = 0;
  for (const b of bets) {
    if (!isSettled(b) || b.status === 'void' || b.freebet || !(+b.prob > 0)) continue;
    exp += ((+b.prob / 100) * +b.odds - 1) * +b.stake;
    act += betProfit(b);
    n++;
  }
  const perf = exp > 0 ? Math.max(0, Math.min(1, act / exp)) : prior;
  const w = (n * perf + weight * prior) / (n + weight);
  return { n, w, perf, exp, act };
}

// Avvicina la probabilità stimata a quella implicita della quota in proporzione all'affidabilità.
export function shrinkProb(p, odds, w) {
  const imp = 1 / odds;
  return imp + w * (p - imp);
}

// ---------- Cicli progressivi ----------
export const CYCLE_TYPES = {
  ladder: {
    name: 'Scalata',
    desc: "Si parte da una puntata base e, a ogni vincita, si rigioca tutto l'incasso. Una sola perdita chiude il ciclo e costa la puntata iniziale.",
  },
  fibonacci: {
    name: 'Fibonacci',
    desc: 'Dopo una perdita si avanza di un passo nella serie 1-1-2-3-5-8…, dopo una vincita si torna indietro di due. Il ciclo si chiude al raggiungimento del profitto obiettivo.',
  },
  dalembert: {
    name: "D'Alembert",
    desc: "Dopo una perdita la puntata sale di un'unità, dopo una vincita scende di un'unità. Progressione più lenta della Fibonacci.",
  },
  labouchere: {
    name: 'Labouchère',
    desc: "Si scrive una sequenza (es. 1-2-3): si punta la somma del primo e dell'ultimo numero. Se vinci li cancelli, se perdi aggiungi in fondo le unità perse. Il ciclo si chiude quando la sequenza è vuota.",
  },
};

const FIB = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597];

export function parseSequence(s) {
  const seq = String(s || '').split(/[^0-9.]+/).map((x) => parseFloat(x)).filter((x) => x > 0);
  return seq.length ? seq : [1, 2, 3];
}

// Stato di un ciclo dato l'elenco ordinato delle scommesse collegate.
export function cycleState(c, linked) {
  const base = +c.base;
  const budget = +c.budget;
  const maxStake = +c.maxStake > 0 ? +c.maxStake : Infinity;
  const target = +c.target > 0 ? +c.target : base;
  const steps = Math.max(1, parseInt(c.steps, 10) || 4);
  let profit = 0, idx = 0, level = 1, list = parseSequence(c.sequence), ladder = base, played = 0;
  let status = 'active', reason = '';
  const history = [];
  for (const b of linked) {
    if (!isSettled(b) || status !== 'active') continue;
    const p = betProfit(b);
    if (Math.abs(p) < 0.005) { history.push('V'); continue; }
    profit += p;
    played++;
    const win = p > 0;
    history.push(win ? 'W' : 'L');
    if (c.type === 'fibonacci') idx = win ? Math.max(0, idx - 2) : Math.min(idx + 1, FIB.length - 1);
    else if (c.type === 'dalembert') level = win ? Math.max(1, level - 1) : level + 1;
    else if (c.type === 'labouchere') {
      const units = list.length > 1 ? list[0] + list[list.length - 1] : list[0] || 1;
      list = win ? list.slice(1, -1) : [...list, units];
    } else if (c.type === 'ladder') {
      if (!win) { status = 'lost'; reason = 'Una perdita chiude la scalata.'; }
      else ladder = (+b.stake || 0) + p;
    }
    if (status !== 'active') break;
    if (c.type === 'labouchere') { if (!list.length) { status = 'won'; reason = 'Sequenza completata.'; } }
    else if (c.type === 'ladder') { if (profit >= target - 0.005 || played >= steps) { status = 'won'; reason = 'Obiettivo della scalata raggiunto.'; } }
    else if (profit >= target - 0.005) { status = 'won'; reason = 'Profitto obiettivo raggiunto.'; }
  }
  let next = 0, units = 0;
  if (c.type === 'fibonacci') { units = FIB[idx]; next = base * units; }
  else if (c.type === 'dalembert') { units = level; next = base * level; }
  else if (c.type === 'labouchere') { units = list.length > 1 ? list[0] + list[list.length - 1] : list[0] || 0; next = base * units; }
  else if (c.type === 'ladder') next = ladder;
  const capital = budget + profit;
  if (status === 'active') {
    if (next > maxStake + 0.005) { status = 'stopped'; reason = `La prossima puntata (${next.toFixed(2)}) supererebbe il tetto di ${maxStake.toFixed(2)}: ciclo fermato.`; }
    else if (c.type !== 'ladder' && next > capital + 0.005) { status = 'stopped'; reason = 'Il budget rimasto non copre la prossima puntata: ciclo fermato.'; }
  }
  if (c.closed && status === 'active') status = 'closed';
  return { status, reason, profit, capital, next: status === 'active' ? next : 0, units, history, played, list, target, steps,
    pending: linked.filter((b) => !isSettled(b)) };
}

// ---------- Simulatore Monte Carlo ----------
export const SIM_STRATEGIES = [
  ['flat', 'Flat % del bankroll'],
  ['fixed', 'Unità fisse'],
  ['kelly', 'Kelly frazionato'],
  ['target', 'Profitto fisso'],
  ['fibonacci', 'Fibonacci'],
  ['dalembert', "D'Alembert"],
  ['martingale', 'Martingala'],
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Tutte le strategie giocano gli stessi esiti casuali (stesso seme), così il confronto è equo.
 * p: probabilità reale di vincita; pEst: quella che stimi (usata solo da Kelly).
 * stakePct: % del bankroll iniziale usata come puntata/unità base dalle strategie a importo fisso.
 */
export function simulate({ bank, n, odds, p, pEst, sims, stakePct, kellyFrac, strategies, seed = 12345, checkpoints = 60 }) {
  const rnd = mulberry32(seed);
  const unit = (bank * stakePct) / 100;
  const ruinAt = bank * 0.01;
  const cpEvery = Math.max(1, Math.floor(n / checkpoints));
  const cpCount = Math.floor(n / cpEvery) + 1;
  const b = odds - 1;
  const kellyF = Math.max(0, (b * pEst - (1 - pEst)) / b) * kellyFrac;
  const out = {};
  for (const s of strategies) out[s] = { finals: new Float64Array(sims), dd: new Float64Array(sims), ruined: 0, paths: Array.from({ length: cpCount }, () => new Float64Array(sims)) };
  const wins = new Uint8Array(n);
  for (let k = 0; k < sims; k++) {
    for (let i = 0; i < n; i++) wins[i] = rnd() < p ? 1 : 0;
    for (const s of strategies) {
      const o = out[s];
      let bal = bank, peak = bank, maxDD = 0, ruined = false;
      let fi = 0, level = 1, mult = 1, cycleProfit = 0;
      o.paths[0][k] = bal;
      for (let i = 0; i < n; i++) {
        if (!ruined) {
          let stake;
          switch (s) {
            case 'flat': stake = (bal * stakePct) / 100; break;
            case 'fixed': stake = unit; break;
            case 'kelly': stake = bal * kellyF; break;
            case 'target': stake = unit / b; break;
            case 'fibonacci': stake = unit * FIB[fi]; break;
            case 'dalembert': stake = unit * level; break;
            case 'martingale': stake = unit * mult; break;
            default: stake = 0;
          }
          if (stake > bal) stake = bal;
          const win = wins[i] === 1;
          const pr = win ? stake * b : -stake;
          bal += pr;
          cycleProfit += pr;
          if (s === 'fibonacci') { fi = win ? Math.max(0, fi - 2) : Math.min(fi + 1, FIB.length - 1); if (cycleProfit >= unit) { fi = 0; cycleProfit = 0; } }
          else if (s === 'dalembert') { level = win ? Math.max(1, level - 1) : level + 1; if (cycleProfit >= unit) { level = 1; cycleProfit = 0; } }
          else if (s === 'martingale') { mult = win ? 1 : mult * 2; }
          if (bal > peak) peak = bal;
          const dd = peak > 0 ? (peak - bal) / peak : 0;
          if (dd > maxDD) maxDD = dd;
          if (bal <= ruinAt || (s !== 'flat' && s !== 'kelly' && bal < 0.01)) { ruined = true; maxDD = Math.max(maxDD, peak > 0 ? (peak - bal) / peak : 1); }
        }
        if ((i + 1) % cpEvery === 0) o.paths[(i + 1) / cpEvery][k] = bal;
      }
      o.finals[k] = bal;
      o.dd[k] = maxDD;
      if (ruined) o.ruined++;
    }
  }
  const res = [];
  for (const s of strategies) {
    const o = out[s];
    const f = Array.from(o.finals).sort((x, y) => x - y);
    const dd = Array.from(o.dd).sort((x, y) => x - y);
    let prof = 0;
    for (const v of f) if (v > bank) prof++;
    res.push({
      key: s,
      median: quantile(f, 0.5), p10: quantile(f, 0.1), p90: quantile(f, 0.9),
      ruin: o.ruined / sims, profitProb: prof / sims, medianDD: quantile(dd, 0.5),
      path: o.paths.map((arr, i) => ({ i: i * cpEvery, v: quantile(Array.from(arr).sort((x, y) => x - y), 0.5) })),
    });
  }
  return { results: res, ev: p * odds - 1, kellyF, unit };
}
