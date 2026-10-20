import * as store from './store.js';
import * as sync from './sync.js';
import * as C from './calc.js';
import * as S from './staking.js';
import * as SG from './signals.js';
import { lineChart, barChart, multiLineChart } from './chart.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view');
const dialog = $('#dialog');
const dlgForm = $('#dialogForm');

// ---------- Utility ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const nf2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (x) => nf2.format(x || 0);
const money = (x) => `${fmt(x)} ${store.get().settings.currency}`;
const signed = (x) => `${x > 0 ? '+' : ''}${money(x)}`;
const pct = (x, d = 1) => `${(x * 100).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
const cls = (x) => (x > 0.004 ? 'pos' : x < -0.004 ? 'neg' : '');
const isoDate = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 6e4);
  return z.toISOString().slice(0, 10);
};
const today = () => isoDate();
const daysAgo = (n) => isoDate(new Date(Date.now() - n * 864e5));
const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};
const dateHead = (s) => new Date(s + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

let toastTimer;
function toast(msg, undo) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Annulla</button>' : ''}`;
  t.classList.toggle('act', !!undo);
  if (undo) t.querySelector('button').onclick = () => { t.classList.remove('show', 'act'); undo(); toast('Operazione annullata'); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show', 'act'), undo ? 6000 : 2600);
}

function settleBet(id, status) {
  const b = store.get().bets.find((x) => x.id === id);
  if (!b) return;
  const prev = { ...b };
  store.upsert('bets', { ...b, status, settledDate: today() });
  toast(`Esito: ${C.STATUSES[status]}`, () => store.upsert('bets', prev));
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- Derivati ----------
const txDelta = (t) => (t.type === 'transfer' ? 0 : t.type === 'withdrawal' ? -t.amount : +t.amount);
const TX_TYPES = { deposit: 'Deposito', withdrawal: 'Prelievo', bonus: 'Bonus accreditato', transfer: 'Trasferimento' };
const NO_ACCOUNT = 'Non assegnato';

function balances() {
  const d = store.get();
  const tx = d.transactions.reduce((a, t) => a + txDelta(t), 0);
  const bonus = d.transactions.filter((t) => t.type === 'bonus').reduce((a, t) => a + +t.amount, 0);
  const profit = d.bets.reduce((a, b) => a + C.betProfit(b), 0);
  const pendingStake = d.bets.filter((b) => !C.isSettled(b)).reduce((a, b) => a + C.realStake(b), 0);
  const balance = tx + profit;
  return { balance, available: balance - pendingStake, pendingStake, deposited: tx - bonus, bonus, profit };
}

// Saldo per conto (bookmaker): movimenti, trasferimenti e scommesse con quel bookmaker.
function accounts() {
  const d = store.get();
  const map = new Map();
  const acc = (name) => {
    const k = (name || '').trim() || NO_ACCOUNT;
    if (!map.has(k)) map.set(k, { name: k, cash: 0, profit: 0, pending: 0, bets: 0 });
    return map.get(k);
  };
  for (const t of d.transactions) {
    if (t.type === 'transfer') { acc(t.from).cash -= +t.amount; acc(t.to).cash += +t.amount; }
    else acc(t.bookmaker).cash += txDelta(t);
  }
  for (const b of d.bets) {
    const a = acc(b.bookmaker);
    a.bets++;
    a.profit += C.betProfit(b);
    if (!C.isSettled(b)) a.pending += C.realStake(b);
  }
  return [...map.values()].map((a) => ({ ...a, balance: a.cash + a.profit, available: a.cash + a.profit - a.pending }))
    .sort((a, b) => (a.name === NO_ACCOUNT) - (b.name === NO_ACCOUNT) || b.balance - a.balance);
}

function usesAccounts() {
  return store.get().transactions.some((t) => t.type === 'transfer' || (t.bookmaker || '').trim());
}

function lossSince(fromDate) {
  const p = store.get().bets
    .filter((b) => C.isSettled(b) && (b.settledDate || b.date) >= fromDate)
    .reduce((a, b) => a + C.betProfit(b), 0);
  return p < 0 ? -p : 0;
}

function stopLossAlerts() {
  const s = store.get().settings;
  const out = [];
  const day = lossSince(today());
  const week = lossSince(daysAgo(6));
  if (s.dailyStopLoss > 0 && day >= s.dailyStopLoss) out.push(`Stop-loss giornaliero raggiunto: perdita oggi ${money(day)} (limite ${money(s.dailyStopLoss)}). Fermati per oggi.`);
  else if (s.dailyStopLoss > 0 && day >= s.dailyStopLoss * 0.75) out.push(`Attenzione: perdita oggi ${money(day)}, vicina al limite di ${money(s.dailyStopLoss)}.`);
  if (s.weeklyStopLoss > 0 && week >= s.weeklyStopLoss) out.push(`Stop-loss settimanale raggiunto: perdita ultimi 7 giorni ${money(week)} (limite ${money(s.weeklyStopLoss)}).`);
  return out;
}

function infoAlerts() {
  const d = store.get();
  const s = d.settings;
  const out = [];
  const todayP = d.bets.filter((b) => C.isSettled(b) && (b.settledDate || b.date) === today()).reduce((a, b) => a + C.betProfit(b), 0);
  if (s.dailyStopWin > 0 && todayP >= s.dailyStopWin) out.push(`Obiettivo di giornata raggiunto (${signed(todayP)}): è un buon momento per fermarti.`);
  const stale = d.bets.filter((b) => !C.isSettled(b) && b.date < daysAgo(2)).length;
  if (stale) out.push(`<span>${stale === 1 ? 'Una scommessa è' : `${stale} scommesse sono`} ancora "in corso" da più di due giorni: aggiorna l'esito.</span> <a href="#bets" data-action="show-pending">Aggiorna</a>`);
  return out;
}

function masanielloInfo(m) {
  const linked = store.get().bets
    .filter((b) => b.masanielloId === m.id)
    .sort((a, b) => ((a.settledDate || a.date) + (a.createdAt || 0) < (b.settledDate || b.date) + (b.createdAt || 0) ? -1 : 1));
  const state = C.masanielloState(m, linked);
  if (state && m.closed && state.status === 'active') state.status = 'closed';
  return { state, linked };
}

const MSTATUS = { active: 'Attivo', won: 'Completato ✓', lost: 'Fallito', closed: 'Chiuso' };

function currentUnit() {
  const d = store.get();
  const { points } = C.bankrollSeries(d.bets, d.transactions);
  return S.unitValue(d.settings, points, balances().balance, today().slice(0, 8) + '01');
}

// Limite all'esposizione totale (puntate in corso + nuova) come % del saldo.
function exposureCap(amount, existingId) {
  const s = store.get().settings;
  if (!(s.maxExposurePct > 0) || !(amount > 0)) return { amount, capped: false };
  const b = balances();
  const own = existingId ? +(store.get().bets.find((x) => x.id === existingId && !C.isSettled(x) && !x.freebet)?.stake || 0) : 0;
  const room = Math.max(0, (b.balance * s.maxExposurePct) / 100 - (b.pendingStake - own));
  return amount > room ? { amount: room, capped: true } : { amount, capped: false };
}

function suggestStake(v, existingId) {
  const d = store.get();
  const s = d.settings;
  const { available } = balances();
  const odds = num(v.odds);
  const capped = (r) => {
    const c = exposureCap(r.amount, existingId);
    return c.capped ? { amount: c.amount, text: `${r.text} · ridotta per l'esposizione massima (${s.maxExposurePct}% del saldo)` } : r;
  };
  if (v.strategy === 'flat') {
    return capped({ amount: (available * s.flatPct) / 100, text: `Flat ${s.flatPct}% del disponibile` });
  }
  if (v.strategy === 'kelly') {
    let p = num(v.prob) / 100;
    if (!(odds > 1) || !(p > 0)) return { amount: null, text: 'Inserisci quota e probabilità stimata' };
    let note = '';
    if (s.kellyAdaptive) {
      const r = S.estimateReliability(d.bets);
      p = S.shrinkProb(p, odds, r.w);
      note = ` · stima corretta a ${pct(p)} (affidabilità ${Math.round(r.w * 100)}%)`;
    }
    const k = C.kelly(p, odds, s.kellyFraction, s.kellyCap);
    if (k.full <= 0) return { amount: 0, text: `Nessun valore (EV ${pct(k.edge)}): Kelly consiglia di non giocare${note}` };
    return capped({ amount: (available * k.pct) / 100, text: `Kelly ${({ 1: 'pieno', 0.5: '½', 0.25: '¼', 0.1: '1/10' })[+s.kellyFraction] || '×' + s.kellyFraction}: ${pct(k.pct / 100, 2)} del disponibile${k.capped ? ' (limitato dal tetto)' : ''}${note}` });
  }
  if (v.strategy === 'units') {
    const conf = num(v.confidence);
    const u = currentUnit();
    if (!(conf > 0)) return { amount: null, text: `1 unità = ${money(u.unit)}: scegli la fiducia` };
    return capped({ amount: conf * u.unit, text: `${conf} ${conf === 1 ? 'unità' : 'unità'} × ${money(u.unit)}` });
  }
  if (v.strategy === 'target') {
    if (!(odds > 1)) return { amount: null, text: `Inserisci la quota (obiettivo ${money(s.targetWin)})` };
    return capped({ amount: S.targetStake(+s.targetWin, odds), text: `Per vincere ${money(s.targetWin)} a quota ${fmtOdds(odds)}` });
  }
  if (v.strategy === 'masaniello') {
    const m = d.masaniello.find((x) => x.id === v.masanielloId);
    if (!m) return { amount: null, text: 'Seleziona un Masaniello' };
    const { state } = masanielloInfo(m);
    if (!state || state.status !== 'active') return { amount: 0, text: `Masaniello ${MSTATUS[state?.status] || ''}` };
    const amt = C.masanielloStake(state, odds);
    return { amount: amt, text: `Masaniello evento ${state.i + 1}/${state.plan.N} (${state.w}/${state.plan.K} vinte) a quota ${odds > 1 ? odds : state.plan.q}` };
  }
  if (v.strategy === 'cycle') {
    const c = d.cycles.find((x) => x.id === v.cycleId);
    if (!c) return { amount: null, text: 'Seleziona un ciclo' };
    const { state } = cycleInfo(c);
    if (state.status !== 'active') return { amount: 0, text: `Ciclo ${CSTATUS[state.status]}` };
    const other = state.pending.filter((b) => b.id !== existingId).length;
    return { amount: state.next, text: `${S.CYCLE_TYPES[c.type].name}, passo ${state.played + 1}${other ? ' (attenzione: c\'è già una giocata in corso nel ciclo)' : ''}` };
  }
  return { amount: null, text: '' };
}

// ---------- Router ----------
const ui = {
  betFilter: { q: '', status: '', sport: '', period: '' },
  betLimit: 100,
  toolTab: 'kelly',
  statGroup: 'sport',
  openMasaniello: null,
  openCycle: null,
  sim: null,
  simResult: null,
  homePeriod: '30',
  txType: 'deposit',
  calMonth: null,
};

const views = { home: renderHome, bets: renderBets, tools: renderTools, stats: renderStats, bankroll: renderBankroll };

function current() {
  const v = location.hash.slice(1);
  return views[v] ? v : 'home';
}

function render() {
  const name = current();
  for (const a of $$('#tabs a')) a.classList.toggle('active', a.dataset.view === name);
  document.body.classList.toggle('on-home', name === 'home');
  const scroll = window.scrollY;
  const focusId = document.activeElement?.id;
  views[name]();
  if (ui.storeError) view.insertAdjacentHTML('afterbegin', `<div class="alert danger" style="margin-bottom:16px">${esc(ui.storeError)}</div>`);
  renderTop();
  if (focusId && document.getElementById(focusId)) {
    const el = document.getElementById(focusId);
    el.focus();
    if (el.setSelectionRange && el.type === 'text') el.setSelectionRange(el.value.length, el.value.length);
  }
  window.scrollTo(0, scroll);
}

function renderTop() {
  const b = balances();
  $('#topBalance').innerHTML = `${money(b.balance)}<small>disponibile ${money(b.available)}</small>`;
}

window.addEventListener('hashchange', () => { if (handleIncoming()) return; render(); window.scrollTo(0, 0); });

// ---------- HOME ----------
const PERIODS = [['7', '7G', 7], ['30', '30G', 30], ['90', '3M', 90], ['365', 'Anno', 365], ['all', 'Tutto', 0]];
const fmtOdds = (o) => (+o || 0).toFixed(2).replace('.', ',');
const STRAT_LABEL = { flat: 'Flat', kelly: 'Kelly', units: 'Unità', target: 'Profitto fisso', masaniello: 'Masaniello', cycle: 'Ciclo' };

function greeting() {
  const h = new Date().getHours();
  return h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
}

function profitBetween(from, to = '9999-12-31') {
  return store.get().bets
    .filter((b) => C.isSettled(b) && (b.settledDate || b.date) >= from && (b.settledDate || b.date) <= to)
    .reduce((a, b) => a + C.betProfit(b), 0);
}

function bigMoney(x) {
  return `${fmt(x)} <span class="cur">${esc(store.get().settings.currency)}</span>`;
}

function renderHome() {
  const d = store.get();
  if (!d.transactions.length && !d.bets.length) {
    view.innerHTML = `
      <div class="card stack" style="max-width:520px;margin:24px auto">
        <h2>Benvenuto in BankBet</h2>
        <p class="muted" style="margin:0">Per iniziare imposta il bankroll iniziale: è la cifra che dedichi alle scommesse, separata dal resto delle tue finanze.</p>
        <label class="field">Bankroll iniziale (${esc(d.settings.currency)})
          <input id="initBank" inputmode="decimal" placeholder="es. 500">
        </label>
        <button class="btn primary" data-action="init-bank">Inizia</button>
        <p class="hint" style="margin:0">Hai già dei dati su un altro dispositivo? Vai su <a href="#bankroll">Bankroll → Sincronizzazione</a> o importa un backup.</p>
      </div>`;
    return;
  }
  const b = balances();
  const sum = C.summarize(d.bets);
  const st = C.streaks(d.bets);
  const alerts = stopLossAlerts();
  const series = C.bankrollSeries(d.bets, d.transactions);
  const per = PERIODS.find((p) => p[0] === ui.homePeriod) || PERIODS[1];
  const from = per[2] ? daysAgo(per[2] - 1) : '';

  // Serie nel periodo, con la linea attesa riallineata all'inizio del periodo.
  let pts = series.points;
  if (from) {
    const before = pts.filter((p) => p.date < from);
    const start = before[before.length - 1];
    pts = (start ? [{ ...start, date: from, t: Date.parse(from + 'T00:00:00') }] : []).concat(pts.filter((p) => p.date >= from));
  }
  if (pts.length) {
    const off = pts[0].value - pts[0].ev;
    pts = pts.map((p) => ({ ...p, ev: p.ev + off }));
    const last = pts[pts.length - 1];
    if (last.t < Date.now()) pts.push({ ...last, date: today(), t: Date.now() });
  }
  const dd = C.maxDrawdownRange(pts);
  const windowBets = d.bets.filter((x) => C.isSettled(x) && (!from || (x.settledDate || x.date) >= from));
  const lk = C.luck(windowBets);
  const hasEst = d.bets.some((x) => C.betExpected(x) != null);
  const todayP = profitBetween(today());
  const todayN = d.bets.filter((x) => C.isSettled(x) && (x.settledDate || x.date) === today()).length;
  const periodP = profitBetween(from || '0000-00-00');
  const monthStart = today().slice(0, 8) + '01';
  const monthP = profitBetween(monthStart);
  const monthN = d.bets.filter((x) => C.isSettled(x) && (x.settledDate || x.date) >= monthStart).length;
  const pending = d.bets.filter((x) => !C.isSettled(x)).sort((a, z) => (a.date < z.date ? -1 : 1));
  const activeM = d.masaniello.map((m) => ({ m, ...masanielloInfo(m) })).filter((x) => x.state?.status === 'active');
  const activeC = d.cycles.map((c) => ({ c, ...cycleInfo(c) })).filter((x) => x.state.status === 'active');
  const when = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const arrow = (x) => (x > 0.004 ? '▲ ' : x < -0.004 ? '▼ ' : '');

  view.innerHTML = `
    <div class="stack">
      <div class="home-head">
        <div><div class="when">${esc(when.charAt(0).toUpperCase() + when.slice(1))}</div><h1>${greeting()}</h1></div>
        <div class="actions">
          <button class="btn" data-action="paste-signal">Incolla segnale</button>
          <button class="btn primary" data-action="new-bet"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Nuova scommessa</button>
        </div>
      </div>
      ${alerts.map((a) => `<div class="alert danger">${esc(a)}</div>`).join('')}
      ${infoAlerts().map((a) => `<div class="alert">${a}</div>`).join('')}
      <div class="home-row">
        <section class="card hero home-main" style="gap:0">
          <div class="hero-top">
            <div>
              <div class="label-caps">Bankroll</div>
              <div class="hero-value">${bigMoney(b.balance)}</div>
              <div class="hero-pills">
                <span class="pill ${cls(todayP)}">${todayN ? `${arrow(todayP)}${signed(todayP)} oggi` : 'Nessun esito oggi'}</span>
                <span class="pill">${signed(periodP)} ${per[2] ? `in ${per[2] === 365 ? 'un anno' : per[2] + ' giorni'}` : 'in totale'}</span>
              </div>
            </div>
            <div class="hero-tools">
              <div class="seg" role="group" aria-label="Periodo">${PERIODS.map(([k, l]) => `<button class="${k === per[0] ? 'on' : ''}" data-action="home-period" data-period="${k}" aria-pressed="${k === per[0]}">${l}</button>`).join('')}</div>
              <div class="legend">
                <span><i></i>Bankroll reale</span>
                ${hasEst ? '<span><i class="ev"></i>Atteso (EV)</span>' : ''}
                ${dd.range ? '<span><i class="dd"></i>Drawdown max</span>' : ''}
              </div>
            </div>
          </div>
          <div class="chart-wrap"><canvas class="chart" id="chBank" role="img" aria-label="Andamento del bankroll nel periodo selezionato"></canvas></div>
          <div class="hero-foot">
            <div><div class="label-caps">Disponibile</div><div class="v">${money(b.available)}</div></div>
            <div><div class="label-caps">In gioco</div><div class="v">${money(b.pendingStake)} <small class="muted">· ${pending.length} ${pending.length === 1 ? 'giocata' : 'giocate'}</small></div></div>
            ${lk.n ? `<div title="Profitto reale meno profitto atteso, sulle ${lk.n} scommesse del periodo con probabilità stimata o quota di chiusura"><div class="label-caps">Fortuna vs EV</div><div class="v ${cls(lk.luck)}">${signed(lk.luck)}</div></div>` : ''}
          </div>
        </section>
        <div class="home-side">
          <div class="kpis two">
            ${kpi('Yield', `<span class="${cls(sum.yield)}">${sum.yield > 0 ? '+' : ''}${pct(sum.yield)}</span>`, `su ${money(sum.staked)} giocati`)}
            ${kpi('Win rate', pct(sum.winRate, 0), `${sum.settled} chiuse · q. media ${sum.avgOdds ? fmtOdds(sum.avgOdds) : '—'}`)}
            ${kpi('Profitto del mese', `<span class="${cls(monthP)}">${signed(monthP)}</span>`, `${monthN} ${monthN === 1 ? 'chiusa' : 'chiuse'} da inizio mese`)}
            ${kpi('Max drawdown', `<span class="${series.maxDrawdown > 0 ? 'neg' : ''}">${series.maxDrawdown > 0 ? '−' : ''}${money(series.maxDrawdown)}</span>`, `serie attuale ${st.current}`)}
          </div>
          ${limitsCard()}
        </div>
      </div>
      <div class="home-row">
        <section class="home-main">
          <div class="card">
            <div class="card-head"><h2>In corso <span class="muted" style="font-weight:400">· ${pending.length}</span></h2>${pending.length ? '<a href="#bets" data-action="show-pending">Tutte</a>' : ''}</div>
            ${pending.length ? '<div class="hint swipe-hint">Scorri una schedina: a destra vinta, a sinistra persa.</div>' : ''}
            ${pending.length ? `<div class="bet-list">${pending.slice(0, 6).map(betItem).join('')}</div>` : '<div class="empty">Nessuna scommessa in corso. Tocca + per aggiungerne una.</div>'}
          </div>
        </section>
        <div class="home-side">
          ${calendarCard()}
          <div class="card">
            <div class="card-head"><span class="label-caps">Cicli attivi</span><a href="#tools" data-action="tool-tab" data-tab="${activeM.length || !activeC.length ? 'masaniello' : 'cycles'}">Gestisci</a></div>
            ${activeM.length || activeC.length ? activeM.map(masanielloMini).join('') + activeC.map(cycleMini).join('') : '<div class="hint">Nessun Masaniello o ciclo progressivo attivo.</div>'}
          </div>
        </div>
      </div>
    </div>`;

  lineChart($('#chBank'), pts, {
    emptyText: 'Nessun movimento nel periodo',
    fmtValue: money,
    ddRange: dd.maxDrawdown > 0 ? dd.range : null,
    fmtDate: (t) => new Date(t).toLocaleDateString('it-IT', per[2] > 90 || !per[2] ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }),
  });
}

function limitsCard() {
  const s = store.get().settings;
  if (!(s.dailyStopLoss > 0) && !(s.weeklyStopLoss > 0) && !(s.monthlyGoal > 0)) {
    return `<div class="card"><div class="card-head"><span class="label-caps">Limiti e obiettivi</span><a href="#bankroll">Imposta</a></div>
      <div class="hint">Nessun limite impostato. Uno stop-loss giornaliero o settimanale ti aiuta a fermarti nelle giornate storte.</div></div>`;
  }
  const monthP = profitBetween(today().slice(0, 8) + '01');
  const meter = (label, used, limit) => {
    const w = Math.min(100, (used / limit) * 100);
    return `<div class="meter ${used >= limit ? 'over' : ''}">
      <div class="top"><span>${label}</span><span class="big-num">${fmt(used)} / ${money(limit)}</span></div>
      <div class="bar" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(w)}"><div style="width:${w}%"></div></div></div>`;
  };
  const goal = s.monthlyGoal > 0 ? `<div class="meter goal ${monthP >= s.monthlyGoal ? 'done' : ''}">
      <div class="top"><span>Obiettivo del mese</span><span class="big-num ${cls(monthP)}">${signed(monthP)} / ${money(s.monthlyGoal)}</span></div>
      <div class="bar" role="progressbar" aria-label="Obiettivo del mese" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.max(0, Math.min(100, (monthP / s.monthlyGoal) * 100)))}"><div style="width:${Math.max(0, Math.min(100, (monthP / s.monthlyGoal) * 100))}%"></div></div></div>` : '';
  return `<div class="card"><div class="card-head"><span class="label-caps">Limiti e obiettivi</span><a href="#bankroll">Modifica</a></div>
    ${s.dailyStopLoss > 0 ? meter('Perdita oggi', lossSince(today()), s.dailyStopLoss) : ''}
    ${s.weeklyStopLoss > 0 ? meter('Perdita ultimi 7 giorni', lossSince(daysAgo(6)), s.weeklyStopLoss) : ''}
    ${goal}</div>`;
}

function calendarCard() {
  const nowMonth = today().slice(0, 7);
  const base = ui.calMonth || nowMonth;
  const [Y, M] = base.split('-').map(Number);
  const first = new Date(Y, M - 1, 1);
  const days = new Date(Y, M, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const daily = new Map();
  for (const x of store.get().bets) {
    if (!C.isSettled(x)) continue;
    const k = x.settledDate || x.date;
    if (k.slice(0, 7) === base) daily.set(k, (daily.get(k) || 0) + C.betProfit(x));
  }
  const maxAbs = Math.max(0, ...[...daily.values()].map(Math.abs));
  const total = [...daily.values()].reduce((a, v) => a + v, 0);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="day out" aria-hidden="true"></div>');
  for (let dd = 1; dd <= days; dd++) {
    const iso = `${base}-${String(dd).padStart(2, '0')}`;
    const v = daily.get(iso);
    let c = '', tip = 'Nessuna giocata chiusa';
    if (iso > today()) { c = 'future'; tip = ''; }
    else if (v != null) {
      const strong = maxAbs > 0 && Math.abs(v) >= maxAbs / 2 ? 2 : 1;
      c = v > 0.004 ? `p${strong}` : v < -0.004 ? `n${strong}` : '';
      tip = signed(v);
    }
    if (iso === today()) c += ' today';
    cells.push(`<div class="day ${c}" title="${esc(fmtDate(iso) + (tip ? ' · ' + tip : ''))}">${dd}</div>`);
  }
  while (cells.length % 7) cells.push('<div class="day out" aria-hidden="true"></div>');
  const label = first.toLocaleDateString('it-IT', { month: 'long', year: base.slice(0, 4) === nowMonth.slice(0, 4) ? undefined : 'numeric' });
  return `<div class="card">
    <div class="card-head">
      <div><div class="label-caps">${esc(label)}</div><div class="big-num ${cls(total)}" style="font-size:1.25rem;font-weight:600;white-space:nowrap">${signed(total)}</div></div>
      <div class="cal-nav">
        <button data-action="cal-move" data-step="-1" aria-label="Mese precedente">‹</button>
        <button data-action="cal-move" data-step="1" aria-label="Mese successivo" ${base >= nowMonth ? 'disabled' : ''}>›</button>
      </div>
    </div>
    <div class="cal">${['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((x) => `<div class="dow">${x}</div>`).join('')}${cells.join('')}</div>
    <div class="cal-legend"><span>perdita</span><i style="background:var(--heat-neg2)"></i><i style="background:var(--heat-neg1)"></i><i style="background:var(--heat-0)"></i><i style="background:var(--heat-pos1)"></i><i style="background:var(--heat-pos2)"></i><span>vincita</span></div>
  </div>`;
}

function masanielloMini({ m, state }) {
  const { plan } = state;
  const seq = state.history.filter((h) => h !== 'V');
  const cells = [];
  for (let i = 0; i < plan.N; i++) {
    if (i < seq.length) cells.push(`<span class="${seq[i]}">${seq[i] === 'W' ? 'V' : 'P'}</span>`);
    else if (i === seq.length) cells.push(`<span class="cur">${i + 1}</span>`);
    else cells.push(`<span class="next">${i + 1}</span>`);
  }
  return `<div class="mcard">
    <div class="spread"><strong>${esc(m.name)}</strong><span class="big-num" style="font-size:1.25rem;font-weight:600">${money(state.capital)}</span></div>
    <div class="mpath" aria-label="Esiti del ciclo">${cells.join('')}</div>
    <div class="spread hint"><span>${state.w}/${plan.K} vinte · ${state.losses}/${plan.N - plan.K} errori</span>
    <span>Prossima <strong class="big-num" style="font-size:1.05rem;color:var(--text)">${money(C.masanielloStake(state))}</strong> @${fmtOdds(plan.q)}</span></div>
  </div>`;
}

function cycleMini({ c, state }) {
  const seq = state.history.filter((h) => h !== 'V').slice(-11);
  const cells = seq.map((h) => `<span class="${h}">${h === 'W' ? 'V' : 'P'}</span>`).concat(`<span class="cur">${state.played + 1}</span>`);
  return `<div class="mcard">
    <div class="spread"><strong>${esc(c.name)}</strong><span class="big-num" style="font-size:1.25rem;font-weight:600">${money(state.capital)}</span></div>
    <div class="mpath" aria-label="Esiti del ciclo">${cells.join('')}</div>
    <div class="spread hint"><span>${S.CYCLE_TYPES[c.type].name} · <span class="${cls(state.profit)}">${signed(state.profit)}</span></span>
    <span>Prossima <strong class="big-num" style="font-size:1.05rem;color:var(--text)">${money(state.next)}</strong></span></div>
  </div>`;
}

function kpi(label, value, sub) {
  return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
}

function betItem(b) {
  const settled = C.isSettled(b);
  const p = C.betProfit(b);
  const head = [b.sport, b.competition, fmtDate(b.date)].filter(Boolean).join(' · ');
  const isMulti = !!(b.legs && b.legs.length);
  const pick = isMulti
    ? [b.legs.map((l) => `${l.status === 'won' ? '✓' : l.status === 'lost' ? '✕' : l.status === 'void' ? '↺' : '○'} ${l.selection || l.event}`).join(', '), b.bookmaker].filter(Boolean).join(' · ')
    : [[b.market, b.selection].filter(Boolean).join(': '), b.bookmaker].filter(Boolean).join(' · ');
  const strat = [isMulti ? `Multipla ×${b.legs.length}` : '', b.freebet ? 'Freebet' : '', STRAT_LABEL[b.strategy] || ''].filter(Boolean)
    .map((x) => `<span class="chip strat">${x}</span>`).join('');
  return `
    <div class="bet ${settled ? 'settled' : ''}" data-action="edit-bet" data-id="${b.id}"${!settled && !(b.legs && b.legs.length) ? ' data-swipe' : ''}>
      <div class="t-head"><span>${esc(head)}</span><span class="chips">${strat}<span class="chip ${b.status}">${C.STATUSES[b.status]}</span></span></div>
      <div class="t-body">
        <div style="min-width:0"><div class="title">${esc(b.event || b.selection || 'Scommessa')}</div>${pick ? `<div class="pick">${esc(pick)}</div>` : ''}</div>
        <div class="odds">${fmtOdds(b.odds)}</div>
      </div>
      <div class="t-foot"><span>Puntata <b>${money(b.stake)}</b></span>${settled
        ? `<span>Esito <b class="${cls(p)}">${signed(p)}</b></span>`
        : `<span>Vincita <b>${money((+b.stake || 0) * ((+b.odds || 0) - (b.freebet ? 1 : 0)))}</b></span>`}</div>
      ${!settled && !isMulti ? `<div class="quick">
        <button class="btn ok" data-action="settle" data-id="${b.id}" data-status="won">✓ Vinta</button>
        <button class="btn ko" data-action="settle" data-id="${b.id}" data-status="lost">✕ Persa</button>
        <button class="btn vd" data-action="settle" data-id="${b.id}" data-status="void">↺ Rimb.</button>
      </div>` : ''}
    </div>`;
}

// ---------- SCOMMESSE ----------
function filteredBets() {
  const f = ui.betFilter;
  const q = f.q.trim().toLowerCase();
  let from = '';
  if (f.period === '7') from = daysAgo(6);
  if (f.period === '30') from = daysAgo(29);
  if (f.period === 'month') from = today().slice(0, 8) + '01';
  if (f.period === 'year') from = today().slice(0, 5) + '01-01';
  return store.get().bets
    .filter((b) => !f.status || (f.status === 'settled' ? C.isSettled(b) : b.status === f.status))
    .filter((b) => !f.sport || b.sport === f.sport)
    .filter((b) => !from || b.date >= from)
    .filter((b) => !q || [b.event, b.selection, b.market, b.competition, b.bookmaker, b.tags, b.notes, b.sport]
      .join(' ').toLowerCase().includes(q))
    .sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
}

function distinct(field) {
  return [...new Set(store.get().bets.map((b) => b[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function renderBets() {
  const f = ui.betFilter;
  const list = filteredBets();
  const s = C.summarize(list);
  const shown = list.slice(0, ui.betLimit);
  let lastDate = '';
  const items = shown.map((b) => {
    const head = b.date !== lastDate ? `<div class="date-head">${esc(dateHead(b.date))}</div>` : '';
    lastDate = b.date;
    return head + betItem(b);
  }).join('');
  view.innerHTML = `
    <div class="stack">
      <div class="spread"><h2>Schedine</h2>
        <div class="row"><button class="btn small" data-action="paste-signal">Incolla segnale</button>
        <button class="btn small" data-action="export-csv">Esporta CSV</button>
        <button class="btn small primary" data-action="new-bet">+ Nuova</button></div></div>
      <div class="filters">
        <input class="search" id="fQ" type="text" placeholder="Cerca evento, selezione, tag…" value="${esc(f.q)}">
        <select id="fStatus">
          <option value="">Tutti gli esiti</option>
          <option value="pending" ${f.status === 'pending' ? 'selected' : ''}>In corso</option>
          <option value="settled" ${f.status === 'settled' ? 'selected' : ''}>Chiuse</option>
          ${Object.entries(C.STATUSES).filter(([k]) => k !== 'pending').map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <select id="fSport"><option value="">Tutti gli sport</option>${distinct('sport').map((x) => `<option ${f.sport === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <select id="fPeriod">
          ${[['', 'Sempre'], ['7', 'Ultimi 7 giorni'], ['30', 'Ultimi 30 giorni'], ['month', 'Questo mese'], ['year', "Quest'anno"]]
            .map(([k, v]) => `<option value="${k}" ${f.period === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="card row" style="justify-content:space-around;text-align:center;padding:10px">
        <div><div class="hint">Scommesse</div><strong>${s.count}</strong></div>
        <div><div class="hint">Giocato</div><strong class="num">${money(s.staked)}</strong></div>
        <div><div class="hint">Profitto</div><strong class="num ${cls(s.profit)}">${signed(s.profit)}</strong></div>
        <div><div class="hint">Yield</div><strong class="num ${cls(s.yield)}">${pct(s.yield)}</strong></div>
      </div>
      ${list.length ? `<div class="bet-list">${items}</div>` : '<div class="empty">Nessuna scommessa. Tocca + per aggiungerne una.</div>'}
      ${list.length > shown.length ? `<button class="btn" data-action="more-bets">Mostra altre (${list.length - shown.length})</button>` : ''}
    </div>`;
  const bind = (id, key) => $(id).addEventListener(id === '#fQ' ? 'input' : 'change', (e) => {
    ui.betFilter[key] = e.target.value;
    ui.betLimit = 100;
    render();
  });
  bind('#fQ', 'q'); bind('#fStatus', 'status'); bind('#fSport', 'sport'); bind('#fPeriod', 'period');
}

function exportCSV() {
  const rows = [['Data', 'Data esito', 'Sport', 'Competizione', 'Evento', 'Mercato', 'Selezione', 'Bookmaker', 'Quota', 'Quota chiusura', 'Puntata', 'Esito', 'Cashout', 'Profitto', 'Strategia', 'Prob. stimata %', 'Freebet', 'Selezioni multipla', 'Tag', 'Note']];
  const n = (x) => (x === '' || x == null || Number.isNaN(+x) ? '' : String(+x).replace('.', ','));
  for (const b of filteredBets()) {
    rows.push([b.date, b.settledDate || '', b.sport, b.competition, b.event, b.market, b.selection, b.bookmaker,
      n(b.odds), n(b.closingOdds), n(b.stake), C.STATUSES[b.status], n(b.payout), n(C.round2(C.betProfit(b))), b.strategy, n(b.prob), b.freebet ? 'sì' : '',
      (b.legs || []).map((l) => `${l.event} ${l.market} ${l.selection} @${String(l.odds).replace('.', ',')} (${C.LEG_STATUSES[l.status] || ''})`).join(' | '), b.tags, b.notes]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(`bankbet-scommesse-${today()}.csv`, '﻿' + csv, 'text/csv');
}

// ---------- Dialog scommessa ----------
let dlgSubmit = null;
// I listener dei singoli dialoghi vengono rimossi all'apertura del successivo (il form è sempre lo stesso).
let dlgCtl = new AbortController();
const dlgOn = () => ({ signal: dlgCtl.signal });

function openDialog(title, body, foot, onSubmit) {
  dlgForm.innerHTML = `
    <div class="dlg-head"><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Chiudi">✕</button></div>
    <div class="dlg-body">${body}</div>
    <div class="dlg-foot">${foot}</div>`;
  dlgSubmit = onSubmit;
  dlgCtl.abort();
  dlgCtl = new AbortController();
  if (!dialog.open) dialog.showModal();
}

dlgForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (dlgSubmit && dlgSubmit(e.submitter?.value || 'save') !== false) dialog.close();
});
dlgForm.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) dialog.close();
});
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

function datalist(id, field) {
  return `<datalist id="${id}">${distinct(field).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
}

// ---------- Menù a tendina con "Altro" (sport, bookmaker) ----------
const OTHER = '__altro';
const LISTS = { sports: { def: 'defaultSport', title: 'Sport' }, bookmakers: { def: 'defaultBookmaker', title: 'Bookmaker' } };

function listOf(key) {
  const l = store.get().settings[key];
  return Array.isArray(l) && l.length ? l : store.emptyData().settings[key];
}

function defaultOf(key) {
  const l = listOf(key);
  const d = store.get().settings[LISTS[key].def];
  return l.includes(d) ? d : l[0];
}

// Menù con le voci della lista più "Altro"; un valore non in elenco apre "Altro" già compilato.
function choiceField(label, name, list, value, placeholder) {
  const isOther = value != null && !list.includes(value);
  return `<div class="field-stack">
    <label class="field">${label}
      <select name="${name}Sel" data-choice="${name}">${list.map((x) => `<option ${x === value ? 'selected' : ''}>${esc(x)}</option>`).join('')}
        <option value="${OTHER}" ${isOther ? 'selected' : ''}>Altro</option></select></label>
    <input name="${name}Other" value="${isOther ? esc(value) : ''}" placeholder="${placeholder}" aria-label="${label}: altro" ${isOther ? '' : 'hidden'}>
  </div>`;
}

const choiceValue = (fd, name) => (fd[`${name}Sel`] === OTHER ? fd[`${name}Other`] || '' : fd[`${name}Sel`] || '').trim();

function legRow(l = {}) {
  return `<div class="leg">
    <input data-leg="event" value="${esc(l.event || '')}" placeholder="Evento" aria-label="Evento">
    <input data-leg="market" value="${esc(l.market || '')}" placeholder="Mercato" list="dlMarket" aria-label="Mercato">
    <input data-leg="selection" value="${esc(l.selection || '')}" placeholder="Selezione" aria-label="Selezione">
    <input data-leg="odds" value="${l.odds ? String(l.odds).replace('.', ',') : ''}" inputmode="decimal" placeholder="Quota" aria-label="Quota">
    <select data-leg="status" aria-label="Esito">${Object.entries(C.LEG_STATUSES).map(([k, t]) => `<option value="${k}" ${(l.status || 'pending') === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <button type="button" class="btn small ghost" data-leg-del aria-label="Rimuovi selezione">✕</button>
  </div>`;
}

function readLegs(f) {
  return $$('.leg', f).map((row) => ({
    event: row.querySelector('[data-leg="event"]').value.trim(),
    market: row.querySelector('[data-leg="market"]').value.trim(),
    selection: row.querySelector('[data-leg="selection"]').value.trim(),
    odds: num(row.querySelector('[data-leg="odds"]').value),
    status: row.querySelector('[data-leg="status"]').value,
  })).filter((l) => l.event || l.selection || l.odds > 0);
}

function openBet(id, preset = {}) {
  const d = store.get();
  const existing = id ? d.bets.find((b) => b.id === id) : null;
  const b = existing || {
    date: today(), status: 'pending', strategy: d.settings.lastStrategy || 'flat',
    sport: defaultOf('sports'), bookmaker: defaultOf('bookmakers'), ...preset,
  };
  const activeM = d.masaniello.filter((m) => masanielloInfo(m).state?.status === 'active' || m.id === b.masanielloId);
  const activeC = d.cycles.filter((c) => cycleInfo(c).state.status === 'active' || c.id === b.cycleId);
  const v = (k) => esc(b[k] ?? '');
  const isMulti = !!(b.legs && b.legs.length);
  const legsInit = isMulti ? b.legs : [{}, {}];
  const body = `
    <div class="form-grid three">
      <label class="field">Data<input type="date" name="date" value="${v('date')}" required></label>
      ${choiceField('Sport', 'sport', listOf('sports'), b.sport ?? '', 'Scrivi lo sport')}
      <label class="field">Competizione<input name="competition" list="dlComp" value="${v('competition')}" placeholder="Serie A"></label>
      <label class="row full" style="font-size:.9rem;gap:16px">
        <span class="row" style="gap:6px"><input type="checkbox" name="isMulti" value="1" ${isMulti ? 'checked' : ''} style="width:auto;min-height:0"> Multipla</span>
        <span class="row" style="gap:6px"><input type="checkbox" name="freebet" value="1" ${b.freebet ? 'checked' : ''} style="width:auto;min-height:0"> Freebet (puntata non tua)</span>
      </label>
      <label class="field full">Evento<input name="event" value="${v('event')}" placeholder="${isMulti ? 'Nome della multipla (opz.)' : 'Inter – Milan'}" autocomplete="off"></label>
      <div class="full" id="legsBox" ${isMulti ? '' : 'hidden'}>
        <div class="legs">${legsInit.map(legRow).join('')}</div>
        <button type="button" class="btn small" data-leg-add>+ Selezione</button>
      </div>
      <label class="field single">Mercato<input name="market" list="dlMarket" value="${isMulti ? '' : v('market')}" placeholder="1X2"></label>
      <label class="field single">Selezione<input name="selection" value="${isMulti ? '' : v('selection')}" placeholder="1"></label>
      ${choiceField('Bookmaker', 'bookmaker', listOf('bookmakers'), b.bookmaker ?? '', 'Scrivi il bookmaker')}
      <label class="field">Quota<input name="odds" inputmode="decimal" value="${v('odds')}" required placeholder="1,85"></label>
      <label class="field" id="probF">Prob. stimata %<input name="prob" inputmode="decimal" value="${v('prob')}" placeholder="per Kelly"></label>
    </div>
    <div class="form-grid">
      <label class="field">Strategia
        <select name="strategy">
          ${[['flat', 'Flat (% fissa)'], ['kelly', 'Kelly'], ['units', 'Unità a fiducia'], ['target', 'Profitto fisso'], ['masaniello', 'Masaniello'], ['cycle', 'Ciclo progressivo'], ['manual', 'Manuale']]
            .map(([k, l]) => `<option value="${k}" ${b.strategy === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      <label class="field" id="mSel">Masaniello
        <select name="masanielloId"><option value="">—</option>
          ${activeM.map((m) => `<option value="${m.id}" ${b.masanielloId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
        </select></label>
      <label class="field" id="cSel">Ciclo
        <select name="cycleId"><option value="">—</option>
          ${activeC.map((c) => `<option value="${c.id}" ${b.cycleId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></label>
      <label class="field" id="confF">Fiducia
        <select name="confidence">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}" ${(+b.confidence || 1) === n ? 'selected' : ''}>${n} ${n === 1 ? 'unità' : 'unità'}</option>`).join('')}</select></label>
    </div>
    <div class="suggest" id="suggest"></div>
    <div id="evLine" class="hint"></div>
    <div class="form-grid three">
      <label class="field">Puntata (${esc(d.settings.currency)})<input name="stake" inputmode="decimal" value="${v('stake')}" required></label>
      <label class="field">Esito
        <select name="status">${Object.entries(C.STATUSES).map(([k, l]) => `<option value="${k}" ${b.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" id="payoutF">Incasso cashout<input name="payout" inputmode="decimal" value="${v('payout')}"></label>
      <label class="field" id="settledF">Data esito<input type="date" name="settledDate" value="${v('settledDate')}"></label>
    </div>
    <div id="retLine" class="hint"></div>
    <div class="form-grid">
      <label class="field full">Tag<input name="tags" value="${v('tags')}" placeholder="es. live, multipla, tipster X"></label>
      <label class="field full">Note<textarea name="notes">${v('notes')}</textarea></label>
    </div>
    ${datalist('dlComp', 'competition')}${datalist('dlMarket', 'market')}`;
  const foot = `
    ${existing ? `<button type="submit" value="delete" class="btn danger left" formnovalidate>Elimina</button>
      <button type="submit" value="dup" class="btn">Duplica</button>` : ''}
    <button type="button" class="btn" data-close>Annulla</button>
    <button type="submit" value="save" class="btn primary">Salva</button>`;

  openDialog(existing ? 'Modifica scommessa' : 'Nuova scommessa', body, foot, (action) => {
    const fd = Object.fromEntries(new FormData(dlgForm));
    if (action === 'delete') {
      if (!confirm('Eliminare questa scommessa?')) return false;
      const copy = { ...existing };
      store.remove('bets', existing.id);
      toast('Scommessa eliminata', () => store.restore('bets', copy));
      return;
    }
    const legs = fd.isMulti ? readLegs(dlgForm) : [];
    if (fd.isMulti && (legs.length < 2 || legs.some((l) => !(l.odds > 1)))) { alert('Una multipla ha bisogno di almeno 2 selezioni, ognuna con quota > 1'); return false; }
    const odds = num(fd.odds), stake = num(fd.stake);
    if (!(odds > 1)) { alert('Inserisci una quota valida (> 1)'); return false; }
    if (!(stake > 0)) { alert('Inserisci una puntata valida'); return false; }
    if (fd.strategy === 'masaniello' && !fd.masanielloId) { alert('Seleziona il Masaniello a cui collegare la scommessa'); return false; }
    if (fd.strategy === 'cycle' && !fd.cycleId) { alert('Seleziona il ciclo a cui collegare la scommessa'); return false; }
    const item = {
      ...(existing || {}),
      date: fd.date || today(), sport: choiceValue(fd, 'sport'), competition: fd.competition.trim(),
      event: fd.event.trim() || (legs.length ? legs.map((l) => l.event || l.selection).filter(Boolean).join(' + ') : ''),
      market: legs.length ? 'Multipla' : fd.market.trim(), selection: legs.length ? `${legs.length} selezioni` : fd.selection.trim(), bookmaker: choiceValue(fd, 'bookmaker'),
      odds: legs.length ? C.round2(C.legsOdds(legs)) : odds, stake: C.round2(stake), prob: num(fd.prob) || '', closingOdds: existing?.closingOdds ?? '',
      strategy: fd.strategy, masanielloId: fd.strategy === 'masaniello' ? fd.masanielloId : '',
      cycleId: fd.strategy === 'cycle' ? fd.cycleId : '', confidence: fd.strategy === 'units' ? +fd.confidence || 1 : '',
      status: fd.status, payout: fd.status === 'cashout' ? num(fd.payout) || 0 : '',
      settledDate: fd.status === 'pending' ? '' : fd.settledDate || today(),
      tags: fd.tags.trim(), notes: fd.notes.trim(),
      freebet: !!fd.freebet, legs, source: b.source || '',
    };
    if (action === 'dup') {
      delete item.id; delete item.createdAt;
      Object.assign(item, { status: 'pending', settledDate: '', payout: '', closingOdds: '', date: today(), freebet: false,
        legs: item.legs.map((l) => ({ ...l, status: 'pending' })) });
    }
    store.upsert('bets', item);
    // Il Masaniello si sceglie dalla sua scheda: non diventa la strategia predefinita.
    const lastStrategy = item.strategy === 'masaniello' || item.strategy === 'cycle' ? d.settings.lastStrategy : item.strategy;
    if (d.settings.lastStrategy !== lastStrategy || d.settings.lastBookmaker !== item.bookmaker) {
      store.updateSettings({ lastStrategy, lastBookmaker: item.bookmaker });
    }
    toast(action === 'dup' ? 'Scommessa duplicata' : 'Scommessa salvata');
  });

  const f = dlgForm;
  const hadProb = !!b.prob;
  const update = () => {
    const fd = Object.fromEntries(new FormData(f));
    for (const sel of $$('select[data-choice]', f)) {
      const other = f[`${sel.dataset.choice}Other`];
      const show = sel.value === OTHER;
      if (show && other.hidden) setTimeout(() => other.focus(), 0);
      other.hidden = !show;
    }
    $('#probF').style.display = fd.strategy === 'kelly' || hadProb || num(fd.prob) > 0 ? '' : 'none';
    const multi = !!fd.isMulti;
    $('#legsBox').hidden = !multi;
    for (const el of $$('.single', f)) el.style.display = multi ? 'none' : '';
    f.odds.readOnly = multi;
    f.event.placeholder = multi ? 'Nome della multipla (opz.)' : 'Inter – Milan';
    if (multi) {
      const legs = readLegs(f);
      if (legs.length) {
        const tot = C.legsOdds(legs);
        if (tot > 1) f.odds.value = String(C.round2(tot)).replace('.', ',');
        if (fd.status !== 'cashout') f.status.value = C.legsStatus(legs);
      }
    }
    $('#mSel').style.display = fd.strategy === 'masaniello' ? '' : 'none';
    $('#cSel').style.display = fd.strategy === 'cycle' ? '' : 'none';
    $('#confF').style.display = fd.strategy === 'units' ? '' : 'none';
    $('#payoutF').style.display = fd.status === 'cashout' ? '' : 'none';
    $('#settledF').style.display = fd.status === 'pending' ? 'none' : '';
    const sg = suggestStake(fd, existing?.id);
    lastSuggest = sg.amount;
    const box = $('#suggest');
    if (fd.strategy === 'manual' || !sg.text) box.style.display = 'none';
    else {
      box.style.display = '';
      const html = `<span>${esc(sg.text)}${sg.amount != null ? `: <strong>${money(sg.amount)}</strong>` : ''}</span>
        ${sg.amount > 0 ? `<button type="button" class="btn small" data-use-suggest>Usa</button>` : ''}`;
      // Non ridisegnare se invariato: altrimenti il click su "Usa" si perde dopo il blur di un campo.
      if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
    }
    const odds = num(fd.odds), p = num(fd.prob) / 100, stake = num(fd.stake);
    $('#evLine').textContent = odds > 1
      ? `Prob. implicita ${pct(1 / odds)}${p > 0 ? ` · EV ${pct(p * odds - 1)} ${p * odds > 1 ? '✓ value bet' : '✗ senza valore'}` : ''}`
      : '';
    let ret = odds > 1 && stake > 0
      ? (fd.freebet ? `Freebet: se vince incassi ${money(stake * (odds - 1))}, se perde non perdi nulla` : `Vincita potenziale ${money(stake * odds)} (netto ${signed(stake * (odds - 1))})`)
      : '';
    const book = choiceValue(fd, 'bookmaker');
    if (book && usesAccounts()) {
      const a = accounts().find((x) => x.name === book);
      const own = existing && !C.isSettled(existing) && existing.bookmaker === book ? C.realStake(existing) : 0;
      const avail = (a ? a.available : 0) + own;
      ret += `${ret ? ' · ' : ''}Disponibile su ${book}: ${money(avail)}${!fd.freebet && stake > avail + 0.005 ? ' ⚠ saldo del conto insufficiente' : ''}`;
    }
    $('#retLine').textContent = ret;
  };
  let lastSuggest = null;
  $('#suggest').addEventListener('click', (e) => {
    if (!e.target.closest('[data-use-suggest]') || !(lastSuggest > 0)) return;
    f.stake.value = String(C.round2(lastSuggest)).replace('.', ',');
    update();
  });
  f.addEventListener('input', update, dlgOn());
  f.addEventListener('change', update, dlgOn());
  $('#legsBox').addEventListener('click', (e) => {
    if (e.target.closest('[data-leg-add]')) { $('.legs', f).insertAdjacentHTML('beforeend', legRow()); update(); }
    const del = e.target.closest('[data-leg-del]');
    if (del) { del.closest('.leg').remove(); update(); }
  });
  update();
  if (!existing) setTimeout(() => (b.event ? f.odds : f.event).focus(), 50);
}

// ---------- Segnali dai bot (link e testo incollato) ----------
function openSignal(preset) {
  const d = store.get();
  const dup = preset.event && d.bets.find((b) => b.event === preset.event && (b.market || '') === (preset.market || '')
    && b.date >= (preset.date || today()).slice(0, 10) && !C.isSettled(b));
  openBet(null, { strategy: d.settings.lastStrategy || 'flat', ...preset });
  const src = SG.SOURCES[preset.source] || 'segnale';
  toast(dup ? `Attenzione: hai già una scommessa in corso su ${preset.event}` : `Dati da ${src}: controlla quota e puntata, poi salva`);
}

function openPaste(initial = '') {
  const body = `
    <label class="field">Testo del messaggio
      <textarea id="pasteText" style="min-height:160px" placeholder="Incolla qui il messaggio di Telegram (TotalCorner, Betwin o un testo con partita e quota)">${esc(initial)}</textarea></label>
    <div id="pasteOut" class="stack" style="gap:8px"></div>`;
  openDialog('Incolla segnale', body, '<button type="button" class="btn" data-close>Chiudi</button>', () => false);
  let found = [];
  const parse = () => {
    found = SG.parseText($('#pasteText').value);
    const out = $('#pasteOut');
    if (!$('#pasteText').value.trim()) { out.innerHTML = '<div class="hint">In Telegram tieni premuto il messaggio → Copia, poi incollalo qui.</div>'; return; }
    if (!found.length) { out.innerHTML = '<div class="hint">Non ho riconosciuto partita o quota in questo testo.</div>'; return; }
    out.innerHTML = `<div class="hint">${found.length === 1 ? 'Trovato un segnale' : `Trovati ${found.length} segnali: scegli quale registrare`}</div>` +
      found.map((p, i) => `<div class="suggest"><span><strong>${esc(p.event || 'Partita non riconosciuta')}</strong><br>
        <span class="hint">${esc([SG.SOURCES[p.source], p.legs ? `Multipla ×${p.legs.length}: ${p.legs.map((l) => l.selection).join(' + ')}` : '', p.competition, [p.market, p.selection].filter(Boolean).join(': '), p.prob ? `prob. ${String(p.prob).replace('.', ',')}%` : '', p.odds ? `@${fmtOdds(p.odds)}` : '', p.date ? fmtDate(p.date) : ''].filter(Boolean).join(' · '))}</span></span>
        <button type="button" class="btn small primary" data-use-signal="${i}">Registra</button></div>`).join('');
  };
  $('#pasteText').addEventListener('input', parse, dlgOn());
  $('#pasteOut').addEventListener('click', (e) => {
    const b = e.target.closest('[data-use-signal]');
    if (b) openSignal(found[+b.dataset.useSignal]);
  }, dlgOn());
  parse();
  if (!initial && navigator.clipboard?.readText) {
    navigator.clipboard.readText().then((t) => {
      if (t && !$('#pasteText')?.value && SG.parseText(t).length) { $('#pasteText').value = t; parse(); }
    }).catch(() => {});
  }
  setTimeout(() => $('#pasteText')?.focus(), 50);
}

// Link "#new?..." dai bot e testo condiviso da Android (share target): apre il modulo già compilato.
function handleIncoming() {
  const h = location.hash;
  const q = new URLSearchParams(location.search);
  if (h.startsWith('#new?')) {
    const preset = SG.fromParams(new URLSearchParams(h.slice(5)));
    history.replaceState(null, '', location.pathname + '#home');
    render();
    openSignal(preset);
    return true;
  }
  const shared = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n');
  if (shared) {
    history.replaceState(null, '', location.pathname + (h || '#home'));
    render();
    const found = SG.parseText(shared);
    if (found.length === 1) openSignal(found[0]); else openPaste(shared);
    return true;
  }
  return false;
}

// ---------- STRUMENTI ----------
function renderTools() {
  const tabs = [['kelly', 'Kelly'], ['masaniello', 'Masaniello'], ['cycles', 'Cicli progressivi'], ['sim', 'Simulatore'], ['value', 'Valore e margine'], ['surebet', 'Surebet']];
  view.innerHTML = `
    <div class="stack">
      <h2>Strumenti</h2>
      <div class="sub-tabs">${tabs.map(([k, l]) => `<button class="btn small ${ui.toolTab === k ? 'primary' : ''}" data-action="tool-tab" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="toolBody"></div>
    </div>`;
  ({ kelly: toolKelly, masaniello: toolMasaniello, cycles: toolCycles, sim: toolSim, value: toolValue, surebet: toolSurebet })[ui.toolTab]($('#toolBody'));
}

function toolKelly(el) {
  const s = store.get().settings;
  const { available } = balances();
  el.innerHTML = `
    <div class="grid grid-2">
      <div class="card stack">
        <h3>Criterio di Kelly</h3>
        <div class="form-grid">
          <label class="field">Probabilità stimata %<input id="kP" inputmode="decimal" placeholder="55"></label>
          <label class="field">Quota<input id="kO" inputmode="decimal" placeholder="2,00"></label>
          <label class="field">Bankroll<input id="kB" inputmode="decimal" value="${String(C.round2(available)).replace('.', ',')}"></label>
          <label class="field">Frazione
            <select id="kF">${[[1, 'Kelly pieno'], [0.5, '½ Kelly'], [0.25, '¼ Kelly'], [0.1, '1/10 Kelly']].map(([v, l]) => `<option value="${v}" ${+s.kellyFraction === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">Tetto massimo %<input id="kC" inputmode="decimal" value="${s.kellyCap}"></label>
        </div>
        <div id="kOut"></div>
      </div>
      <div class="card stack hint">
        <h3 style="color:var(--text)">Come funziona</h3>
        <p style="margin:0">Kelly calcola la frazione di bankroll che massimizza la crescita nel lungo periodo: <strong>f = (b·p − q) / b</strong>, con <em>b</em> = quota − 1, <em>p</em> la tua probabilità stimata e <em>q</em> = 1 − p.</p>
        <p style="margin:0">Se la tua stima è sbagliata, Kelly pieno è molto aggressivo: per questo si usa quasi sempre una frazione (½ o ¼) e un tetto massimo per singola puntata.</p>
        <p style="margin:0">Kelly ha senso solo se <em>p</em> è maggiore della probabilità implicita della quota (1/quota): altrimenti la puntata consigliata è zero.</p>
      </div>
    </div>`;
  const calc = () => {
    const p = num($('#kP').value) / 100, o = num($('#kO').value), bank = num($('#kB').value);
    const out = $('#kOut');
    if (!(o > 1) || !(p > 0 && p < 1)) { out.innerHTML = '<div class="hint">Inserisci probabilità e quota.</div>'; return; }
    const k = C.kelly(p, o, +$('#kF').value, num($('#kC').value) || 100);
    const stake = bank > 0 ? (bank * k.pct) / 100 : 0;
    out.innerHTML = `
      <table>
        <tr><td>Probabilità implicita</td><td>${pct(1 / o)}</td></tr>
        <tr><td>Valore atteso (EV)</td><td class="${cls(k.edge)}">${pct(k.edge)}</td></tr>
        <tr><td>Kelly pieno</td><td>${(Math.max(0, k.full) * 100).toFixed(2)}%</td></tr>
        <tr><td>Puntata consigliata</td><td><strong>${k.pct.toFixed(2)}%${k.capped ? ' (tetto)' : ''}</strong></td></tr>
        <tr><td>Importo</td><td><strong style="font-size:1.2rem">${money(stake)}</strong></td></tr>
      </table>
      ${k.full <= 0 ? '<div class="alert">Nessun valore: con questa stima Kelly consiglia di non giocare.</div>' : ''}`;
  };
  el.addEventListener('input', calc);
  el.addEventListener('change', calc);
  calc();
}

function toolMasaniello(el) {
  const d = store.get();
  const list = d.masaniello.map((m) => ({ m, ...masanielloInfo(m) }))
    .sort((a, b) => (a.state?.status === 'active' ? -1 : 0) - (b.state?.status === 'active' ? -1 : 0) || (b.m.createdAt || 0) - (a.m.createdAt || 0));
  el.innerHTML = `
    <div class="stack">
      <div class="spread">
        <p class="hint" style="margin:0;max-width:640px">Il Masaniello distribuisce un capitale su <strong>N</strong> eventi puntando a vincerne almeno <strong>K</strong> a una quota media. Le puntate si ricalcolano dopo ogni esito; se gli errori superano N−K il capitale del ciclo è perso.</p>
        <button class="btn primary" data-action="new-masaniello">+ Nuovo Masaniello</button>
      </div>
      ${list.length ? list.map(masanielloCard).join('') : '<div class="card empty">Nessun Masaniello. Creane uno per iniziare.</div>'}
    </div>`;
}

function masanielloCard({ m, state, linked }) {
  if (!state) return '';
  const { plan } = state;
  const open = ui.openMasaniello === m.id;
  const next = C.masanielloStake(state);
  const profit = state.capital - m.capital;
  let grid = '';
  if (open) {
    const rows = C.masanielloGrid(plan);
    grid = `
      <div class="table-wrap"><table>
        <tr><th>Vinte \\ Errori</th>${rows[0].map((_, l) => `<th>${l}</th>`).join('')}</tr>
        ${rows.map((r, w) => `<tr><td>${w}</td>${r.map((c, l) => `<td class="${state.status === 'active' && w === state.w && l === state.losses ? 'cur' : ''}">${fmt(c.stake)}</td>`).join('')}</tr>`).join('')}
      </table></div>
      <div class="hint">Puntate teoriche a quota ${plan.q} per ogni combinazione vinte/errori. Se giochi a quote diverse, la puntata reale viene ricalcolata in base al capitale effettivo.</div>
      <h3>Scommesse collegate (${linked.length})</h3>
      ${linked.length ? `<div class="bet-list">${linked.slice().reverse().map(betItem).join('')}</div>` : '<div class="hint">Nessuna scommessa collegata.</div>'}
      <div class="row">
        ${state.status === 'active' ? `<button class="btn" data-action="m-close" data-id="${m.id}">Chiudi ciclo</button>` : ''}
        ${m.closed ? `<button class="btn" data-action="m-reopen" data-id="${m.id}">Riapri</button>` : ''}
        <button class="btn danger" data-action="m-delete" data-id="${m.id}">Elimina</button>
      </div>`;
  }
  return `
    <div class="card stack" style="gap:10px">
      <div class="spread">
        <div><strong>${esc(m.name)}</strong> <span class="chip ${state.status === 'won' ? 'won' : state.status === 'lost' ? 'lost' : state.status === 'active' ? 'pending' : 'void'}">${MSTATUS[state.status]}</span>
        <div class="hint">${plan.N} eventi · ${plan.K} vincenti · quota ${plan.q} · capitale ${money(m.capital)} → obiettivo ${money(plan.target)} (×${plan.multiplier.toFixed(2)})</div></div>
        <button class="btn small ghost" data-action="m-toggle" data-id="${m.id}">${open ? 'Chiudi dettagli' : 'Dettagli'}</button>
      </div>
      <div class="progress"><div style="width:${(Math.min(state.w, plan.K) / plan.K) * 100}%"></div></div>
      <div class="spread">
        <div class="hist">${state.history.map((h) => `<span class="${h}">${h === 'W' ? 'V' : h === 'L' ? 'P' : 'R'}</span>`).join('') || '<span class="hint" style="width:auto;color:var(--muted)">Nessun esito</span>'}</div>
        <div class="num">Capitale <strong>${money(state.capital)}</strong> <span class="${cls(profit)}">(${signed(profit)})</span></div>
      </div>
      ${state.status === 'active' ? `<div class="suggest">
        <span>Evento ${state.i + 1}/${plan.N} · ${state.w}/${plan.K} vinte · ${state.losses}/${plan.N - plan.K} errori${state.pending.length ? ` · ${state.pending.length} in corso` : ''}<br>
        Prossima puntata a quota ${plan.q}: <strong>${money(next)}</strong></span>
        <button class="btn small primary" data-action="m-bet" data-id="${m.id}">+ Scommessa</button>
      </div>` : ''}
      ${grid}
    </div>`;
}

function openMasanielloForm() {
  const { available } = balances();
  const body = `
    <div class="form-grid">
      <label class="field full">Nome<input name="name" value="Masaniello ${store.get().masaniello.length + 1}" required></label>
      <label class="field">Capitale<input name="capital" inputmode="decimal" value="${String(C.round2(Math.max(0, available * 0.1))).replace('.', ',')}" required></label>
      <label class="field">Quota media<input name="odds" inputmode="decimal" value="1,80" required></label>
      <label class="field">Eventi totali (N)<input name="events" inputmode="numeric" value="10" required></label>
      <label class="field">Vincenti richiesti (K)<input name="wins" inputmode="numeric" value="6" required></label>
    </div>
    <div id="mPrev"></div>`;
  const foot = `<button type="button" class="btn" data-close>Annulla</button><button type="submit" class="btn primary">Crea</button>`;
  const read = () => {
    const fd = Object.fromEntries(new FormData(dlgForm));
    return { name: fd.name.trim(), capital: num(fd.capital), odds: num(fd.odds), events: parseInt(fd.events, 10), wins: parseInt(fd.wins, 10) };
  };
  openDialog('Nuovo Masaniello', body, foot, () => {
    const m = read();
    const plan = C.masanielloPlan(m);
    if (!plan) { alert('Parametri non validi: servono capitale > 0, quota > 1 e 1 ≤ K ≤ N.'); return false; }
    if (m.events > 60) { alert('Massimo 60 eventi.'); return false; }
    const saved = store.upsert('masaniello', { ...m, name: m.name || 'Masaniello' });
    ui.openMasaniello = saved.id;
    toast('Masaniello creato');
  });
  const prev = () => {
    const m = read();
    const plan = m.events <= 60 ? C.masanielloPlan(m) : null;
    const el = $('#mPrev');
    if (!plan) { el.innerHTML = '<div class="hint">Parametri non validi (capitale > 0, quota > 1, 1 ≤ K ≤ N ≤ 60).</div>'; return; }
    const first = (m.capital * (plan.f[1][1] / plan.f0) - m.capital) / (plan.q - 1);
    el.innerHTML = `
      <table>
        <tr><td>Obiettivo finale</td><td><strong>${money(plan.target)}</strong></td></tr>
        <tr><td>Profitto se riesce</td><td class="pos">${signed(plan.target - m.capital)} (×${plan.multiplier.toFixed(3)})</td></tr>
        <tr><td>Prima puntata</td><td>${money(first)} (${pct(first / m.capital)})</td></tr>
        <tr><td>Errori concessi</td><td>${plan.N - plan.K}</td></tr>
        <tr><td>% vincenti richiesta</td><td>${pct(plan.K / plan.N, 0)} (implicita quota ${pct(1 / plan.q, 0)})</td></tr>
      </table>
      <div class="hint">Il Masaniello non crea valore: il risultato atteso dipende solo da quanto la tua % di successo reale supera quella implicita nelle quote.</div>`;
  };
  dlgForm.addEventListener('input', prev, dlgOn());
  prev();
}

function toolValue(el) {
  el.innerHTML = `
    <div class="grid grid-2">
      <div class="card stack">
        <h3>Margine del bookmaker e quote eque</h3>
        <div class="form-grid three">
          <label class="field">Quota 1<input class="vo" inputmode="decimal" placeholder="2,10"></label>
          <label class="field">Quota X<input class="vo" inputmode="decimal" placeholder="3,30"></label>
          <label class="field">Quota 2<input class="vo" inputmode="decimal" placeholder="3,60"></label>
        </div>
        <div class="hint">Lascia vuota la terza per mercati a due esiti.</div>
        <div id="vOut"></div>
      </div>
      <div class="card stack">
        <h3>Valore atteso di una giocata</h3>
        <div class="form-grid">
          <label class="field">Quota offerta<input id="eO" inputmode="decimal"></label>
          <label class="field">Tua probabilità %<input id="eP" inputmode="decimal"></label>
          <label class="field">Puntata<input id="eS" inputmode="decimal" value="10"></label>
        </div>
        <div id="eOut"></div>
      </div>
    </div>`;
  const calc = () => {
    const odds = $$('.vo', el).map((i) => num(i.value)).filter((o) => o > 1);
    const out = $('#vOut');
    if (odds.length >= 2) {
      const r = C.overround(odds);
      out.innerHTML = `<table><tr><th>Esito</th><th>Quota</th><th>Prob. equa</th><th>Quota equa</th></tr>
        ${odds.map((o, i) => `<tr><td>${i + 1}</td><td>${o.toFixed(2)}</td><td>${pct(r.fair[i])}</td><td>${(1 / r.fair[i]).toFixed(2)}</td></tr>`).join('')}
        <tr><td colspan="3">Margine (aggio)</td><td><strong>${pct(r.margin, 2)}</strong></td></tr></table>`;
    } else out.innerHTML = '';
    const o = num($('#eO').value), p = num($('#eP').value) / 100, s = num($('#eS').value);
    const eo = $('#eOut');
    if (o > 1 && p > 0) {
      const ev = p * o - 1;
      eo.innerHTML = `<table>
        <tr><td>Prob. implicita</td><td>${pct(1 / o)}</td></tr>
        <tr><td>Quota equa per te</td><td>${(1 / p).toFixed(2)}</td></tr>
        <tr><td>EV %</td><td class="${cls(ev)}"><strong>${pct(ev)}</strong></td></tr>
        ${s > 0 ? `<tr><td>EV in ${esc(store.get().settings.currency)}</td><td class="${cls(ev)}">${signed(ev * s)}</td></tr>` : ''}
      </table>`;
    } else eo.innerHTML = '';
  };
  el.addEventListener('input', calc);
}

function toolSurebet(el) {
  el.innerHTML = `
    <div class="card stack" style="max-width:640px">
      <h3>Calcolatore surebet / dutching</h3>
      <div class="form-grid three">
        <label class="field">Quota A<input class="so" inputmode="decimal"></label>
        <label class="field">Quota B<input class="so" inputmode="decimal"></label>
        <label class="field">Quota C<input class="so" inputmode="decimal" placeholder="opz."></label>
        <label class="field">Totale da puntare<input id="sT" inputmode="decimal" value="100"></label>
      </div>
      <div id="sOut"></div>
      <div class="hint">Distribuisce l'importo in modo che il ritorno sia uguale qualunque sia l'esito. Se la somma delle probabilità implicite è sotto il 100% c'è un profitto garantito (arbitraggio).</div>
    </div>`;
  el.addEventListener('input', () => {
    const odds = $$('.so', el).map((i) => num(i.value)).filter((o) => o > 1);
    const tot = num($('#sT').value);
    const out = $('#sOut');
    if (odds.length < 2 || !(tot > 0)) { out.innerHTML = ''; return; }
    const r = C.surebet(odds, tot);
    out.innerHTML = `
      <div class="${r.isArb ? 'alert' : 'hint'}" style="${r.isArb ? 'color:var(--pos);border-color:var(--pos)' : ''}">${r.isArb ? 'Surebet trovata ✓' : 'Nessun arbitraggio: il risultato è una perdita certa (dutching).'}</div>
      <table><tr><th>Esito</th><th>Quota</th><th>Puntata</th><th>Ritorno</th></tr>
      ${odds.map((o, i) => `<tr><td>${'ABC'[i]}</td><td>${o.toFixed(2)}</td><td><strong>${money(r.stakes[i])}</strong></td><td>${money(r.stakes[i] * o)}</td></tr>`).join('')}
      <tr><td colspan="3">Profitto</td><td class="${cls(r.profit)}"><strong>${signed(r.profit)} (${pct(r.roi, 2)})</strong></td></tr></table>`;
  });
}

// ---------- Cicli progressivi ----------
const CSTATUS = { active: 'Attivo', won: 'Completato ✓', lost: 'Perso', stopped: 'Fermato', closed: 'Chiuso' };
const CCHIP = { active: 'pending', won: 'won', lost: 'lost', stopped: 'lost', closed: 'void' };

function cycleInfo(c) {
  const linked = store.get().bets
    .filter((b) => b.cycleId === c.id)
    .sort((a, b) => ((a.settledDate || a.date) + (a.createdAt || 0) < (b.settledDate || b.date) + (b.createdAt || 0) ? -1 : 1));
  return { state: S.cycleState(c, linked), linked };
}

function cycleGoal(c, state) {
  if (c.type === 'labouchere') return `sequenza ${esc(c.sequence || '1,2,3')}`;
  if (c.type === 'ladder') return `obiettivo ${money(state.target)} o ${state.steps} vincite`;
  return `obiettivo ${money(state.target)}`;
}

function toolCycles(el) {
  const list = store.get().cycles.map((c) => ({ c, ...cycleInfo(c) }))
    .sort((a, b) => (a.state.status === 'active' ? -1 : 0) - (b.state.status === 'active' ? -1 : 0) || (b.c.createdAt || 0) - (a.c.createdAt || 0));
  el.innerHTML = `
    <div class="stack">
      <div class="spread">
        <p class="hint" style="margin:0;max-width:680px">I cicli progressivi aumentano la puntata dopo le perdite per recuperarle. <strong>Non cambiano il valore atteso</strong>: rendono frequenti i piccoli guadagni e rare ma pesanti le perdite. Usa sempre un budget dedicato e un tetto alla puntata, e prova prima la strategia nel <a href="#tools" data-action="tool-tab" data-tab="sim">simulatore</a>.</p>
        <button class="btn primary" data-action="new-cycle">+ Nuovo ciclo</button>
      </div>
      ${list.length ? list.map(cycleCard).join('') : '<div class="card empty">Nessun ciclo. Creane uno per iniziare.</div>'}
    </div>`;
}

function cycleCard({ c, state, linked }) {
  const open = ui.openCycle === c.id;
  const T = S.CYCLE_TYPES[c.type] || { name: c.type };
  const hist = state.history.map((h) => `<span class="${h}">${h === 'W' ? 'V' : h === 'L' ? 'P' : 'R'}</span>`).join('');
  let more = '';
  if (open) {
    more = `
      <h3>Scommesse collegate (${linked.length})</h3>
      ${linked.length ? `<div class="bet-list">${linked.slice().reverse().map(betItem).join('')}</div>` : '<div class="hint">Nessuna scommessa collegata.</div>'}
      <div class="row">
        ${state.status === 'active' ? `<button class="btn" data-action="c-close" data-id="${c.id}">Chiudi ciclo</button>` : ''}
        ${c.closed ? `<button class="btn" data-action="c-reopen" data-id="${c.id}">Riapri</button>` : ''}
        <button class="btn danger" data-action="c-delete" data-id="${c.id}">Elimina</button>
      </div>`;
  }
  return `
    <div class="card stack" style="gap:10px">
      <div class="spread">
        <div><strong>${esc(c.name)}</strong> <span class="chip ${CCHIP[state.status]}">${CSTATUS[state.status]}</span>
        <div class="hint">${T.name} · base ${money(c.base)} · budget ${money(c.budget)} · tetto ${+c.maxStake > 0 ? money(c.maxStake) : 'nessuno'} · ${cycleGoal(c, state)}</div></div>
        <button class="btn small ghost" data-action="c-toggle" data-id="${c.id}">${open ? 'Chiudi dettagli' : 'Dettagli'}</button>
      </div>
      <div class="spread">
        <div class="hist">${hist || '<span class="hint" style="width:auto;color:var(--muted)">Nessun esito</span>'}</div>
        <div class="num">Capitale <strong>${money(state.capital)}</strong> <span class="${cls(state.profit)}">(${signed(state.profit)})</span></div>
      </div>
      ${state.reason ? `<div class="${state.status === 'won' ? 'hint' : 'alert'}">${esc(state.reason)}</div>` : ''}
      ${state.status === 'active' ? `<div class="suggest">
        <span>Passo ${state.played + 1}${state.units ? ` · ${fmt(state.units).replace(',00', '')} unità` : ''}${c.type === 'labouchere' ? ` · sequenza ${state.list.map((x) => fmt(x).replace(',00', '')).join('-')}` : ''}${state.pending.length ? ` · ${state.pending.length} in corso` : ''}<br>
        Prossima puntata: <strong>${money(state.next)}</strong></span>
        <button class="btn small primary" data-action="c-bet" data-id="${c.id}">+ Scommessa</button>
      </div>` : ''}
      ${more}
    </div>`;
}

// Puntate che il ciclo richiederebbe con una serie di perdite consecutive.
function lossRun(c) {
  const fake = [];
  const stakes = [];
  for (let i = 0; i < 40; i++) {
    const st = S.cycleState(c, fake);
    if (st.status !== 'active') break;
    stakes.push(st.next);
    fake.push({ status: 'lost', stake: st.next, odds: 2 });
  }
  return stakes;
}

function openCycleForm() {
  const { available } = balances();
  const base = Math.max(1, C.round2(available * 0.01));
  const dec = (x) => String(C.round2(x)).replace('.', ',');
  const body = `
    <div class="form-grid">
      <label class="field full">Nome<input name="name" value="Ciclo ${store.get().cycles.length + 1}" required></label>
      <label class="field full">Tipo
        <select name="type">${Object.entries(S.CYCLE_TYPES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('')}</select></label>
      <div class="hint full" id="cDesc"></div>
      <label class="field">Puntata base / unità<input name="base" inputmode="decimal" value="${dec(base)}" required></label>
      <label class="field">Budget del ciclo<input name="budget" inputmode="decimal" value="${dec(base * 20)}" required></label>
      <label class="field">Tetto puntata<input name="maxStake" inputmode="decimal" value="${dec(base * 8)}" placeholder="0 = nessuno"></label>
      <label class="field" id="cTarget">Profitto obiettivo<input name="target" inputmode="decimal" value="${dec(base)}"></label>
      <label class="field" id="cSeq">Sequenza (unità)<input name="sequence" value="1,2,3"></label>
      <label class="field" id="cSteps">Vincite da concatenare<input name="steps" inputmode="numeric" value="3"></label>
    </div>
    <div id="cPrev"></div>`;
  const foot = `<button type="button" class="btn" data-close>Annulla</button><button type="submit" class="btn primary">Crea</button>`;
  const read = () => {
    const fd = Object.fromEntries(new FormData(dlgForm));
    return { name: fd.name.trim() || 'Ciclo', type: fd.type, base: num(fd.base), budget: num(fd.budget), maxStake: num(fd.maxStake) || 0,
      target: num(fd.target) || 0, sequence: fd.sequence.trim(), steps: parseInt(fd.steps, 10) || 3 };
  };
  openDialog('Nuovo ciclo progressivo', body, foot, () => {
    const c = read();
    if (!(c.base > 0) || !(c.budget >= c.base)) { toast('Servono una puntata base > 0 e un budget almeno pari alla base'); return false; }
    const saved = store.upsert('cycles', { ...c, base: C.round2(c.base), budget: C.round2(c.budget) });
    ui.openCycle = saved.id;
    toast('Ciclo creato');
  });
  const prev = () => {
    const c = read();
    $('#cDesc').textContent = S.CYCLE_TYPES[c.type].desc;
    $('#cTarget').style.display = c.type === 'labouchere' ? 'none' : '';
    $('#cSeq').style.display = c.type === 'labouchere' ? '' : 'none';
    $('#cSteps').style.display = c.type === 'ladder' ? '' : 'none';
    const el = $('#cPrev');
    if (!(c.base > 0) || !(c.budget > 0)) { el.innerHTML = ''; return; }
    if (c.type === 'ladder') {
      el.innerHTML = `<div class="hint">Rischio massimo per ciclo: la puntata iniziale (${money(c.base)}). Con quota 2,00 e ${c.steps} vincite di fila l'incasso sarebbe ${money(c.base * 2 ** c.steps)}, ma la probabilità di centrarle tutte scende rapidamente (al 50% per giocata: ${pct(0.5 ** c.steps)}).</div>`;
      return;
    }
    const run = lossRun(c);
    el.innerHTML = `<div class="suggest" style="display:block">Con perdite consecutive le puntate sarebbero: <strong>${run.slice(0, 10).map((x) => fmt(x)).join(' · ')}${run.length > 10 ? ' …' : ''}</strong><br>
      Il ciclo regge <strong>${run.length}</strong> perdite di fila prima di fermarsi per budget o tetto${run.length ? `, con una perdita massima di ${money(run.reduce((a, x) => a + x, 0))}` : ''}.</div>`;
  };
  dlgForm.addEventListener('input', prev, dlgOn());
  dlgForm.addEventListener('change', prev, dlgOn());
  prev();
}

// ---------- Simulatore ----------
function simDefaults() {
  const d = store.get();
  const s = d.settings;
  const sum = C.summarize(d.bets);
  const odds = sum.avgOdds > 1 ? C.round2(sum.avgOdds) : 2;
  const p = sum.settled >= 50 ? C.round2(sum.winRate * 100) : C.round2(100 / odds + 2);
  return {
    bank: Math.max(100, Math.round(balances().balance)) || 1000, n: 500, odds, p, pEst: p, sims: 1000,
    stakePct: +s.flatPct || 2, kellyFrac: +s.kellyFraction || 0.25, strategies: ['flat', 'kelly', 'fibonacci', 'martingale'],
  };
}

function toolSim(el) {
  const v = ui.sim || (ui.sim = simDefaults());
  const dec = (x) => String(x).replace('.', ',');
  el.innerHTML = `
    <div class="stack">
      <div class="card stack">
        <h3>Simulatore Monte Carlo</h3>
        <p class="hint" style="margin:0">Simula migliaia di sequenze di giocate e confronta le strategie sugli <strong>stessi esiti casuali</strong>. La probabilità reale decide i risultati; quella stimata serve solo a Kelly, così puoi vedere cosa succede se sopravvaluti le tue giocate.</p>
        <div class="form-grid three">
          <label class="field">Bankroll iniziale<input id="simBank" inputmode="decimal" value="${dec(v.bank)}"></label>
          <label class="field">Giocate per simulazione<input id="simN" inputmode="numeric" value="${v.n}"></label>
          <label class="field">Simulazioni<select id="simSims">${[500, 1000, 2000, 5000].map((x) => `<option ${+v.sims === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label class="field">Quota media<input id="simOdds" inputmode="decimal" value="${dec(v.odds)}"></label>
          <label class="field">Probabilità reale %<input id="simP" inputmode="decimal" value="${dec(v.p)}"></label>
          <label class="field">Probabilità stimata % (Kelly)<input id="simPEst" inputmode="decimal" value="${dec(v.pEst)}"></label>
          <label class="field">Puntata / unità base (% bankroll)<input id="simStake" inputmode="decimal" value="${dec(v.stakePct)}"></label>
          <label class="field">Frazione Kelly
            <select id="simKF">${[[1, 'Pieno'], [0.5, '½'], [0.25, '¼'], [0.1, '1/10']].map(([x, l]) => `<option value="${x}" ${+v.kellyFrac === x ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <div class="row" role="group" aria-label="Strategie da confrontare">
          ${S.SIM_STRATEGIES.map(([k, l], i) => `<label class="pill" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;min-height:36px">
            <input type="checkbox" class="simS" value="${k}" ${v.strategies.includes(k) ? 'checked' : ''} style="width:auto;min-height:0">
            <i style="width:12px;height:3px;border-radius:2px;background:var(--s${i + 1})"></i>${l}</label>`).join('')}
        </div>
        <div class="hint" id="simEv"></div>
        <div class="row"><button class="btn primary" data-action="sim-run">Avvia simulazione</button></div>
      </div>
      <div id="simOut"></div>
    </div>`;
  const evLine = () => {
    const o = num($('#simOdds').value), p = num($('#simP').value) / 100;
    $('#simEv').textContent = o > 1 && p > 0 ? `Valore atteso per giocata: ${pct(p * o - 1)} (probabilità implicita della quota ${pct(1 / o)})${p * o < 1 ? ' — con EV negativo nessuna strategia può guadagnare nel lungo periodo.' : ''}` : '';
  };
  el.addEventListener('input', evLine);
  evLine();
  if (ui.simResult) drawSim();
}

function runSim() {
  const v = {
    bank: num($('#simBank').value), n: parseInt($('#simN').value, 10), sims: parseInt($('#simSims').value, 10),
    odds: num($('#simOdds').value), p: num($('#simP').value), pEst: num($('#simPEst').value),
    stakePct: num($('#simStake').value), kellyFrac: +$('#simKF').value,
    strategies: $$('.simS').filter((x) => x.checked).map((x) => x.value),
  };
  if (!(v.bank > 0) || !(v.n >= 10 && v.n <= 5000) || !(v.odds > 1) || !(v.p > 0 && v.p < 100) || !(v.pEst > 0 && v.pEst < 100) || !(v.stakePct > 0 && v.stakePct <= 100)) {
    toast('Controlla i parametri: giocate tra 10 e 5000, quota > 1, probabilità tra 0 e 100');
    return;
  }
  if (!v.strategies.length) { toast('Scegli almeno una strategia'); return; }
  ui.sim = v;
  ui.simResult = S.simulate({ ...v, p: v.p / 100, pEst: v.pEst / 100 });
  render();
}

function drawSim() {
  const r = ui.simResult, v = ui.sim;
  const name = Object.fromEntries(S.SIM_STRATEGIES);
  const slot = (k) => S.SIM_STRATEGIES.findIndex(([x]) => x === k) + 1;
  const css = getComputedStyle(document.documentElement);
  $('#simOut').innerHTML = `
    <div class="card stack">
      <div class="card-head" style="margin:0"><h3>Andamento mediano del bankroll</h3><span class="hint">${v.sims} simulazioni × ${v.n} giocate</span></div>
      <div class="legend">${r.results.map((x) => `<span><i style="background:var(--s${slot(x.key)})"></i>${name[x.key]}</span>`).join('')}</div>
      <div class="chart-wrap"><canvas class="chart" id="chSim" style="height:260px" role="img" aria-label="Bankroll mediano per strategia lungo le giocate"></canvas></div>
      <div class="table-wrap"><table>
        <tr><th>Strategia</th><th>Mediana finale</th><th>10% peggiori</th><th>10% migliori</th><th>Chiude in utile</th><th>Rovina</th><th>Drawdown mediano</th></tr>
        ${r.results.map((x) => `<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;background:var(--s${slot(x.key)})"></i>${name[x.key]}</td>
          <td class="${cls(x.median - v.bank)}">${money(x.median)}</td><td>${money(x.p10)}</td><td>${money(x.p90)}</td>
          <td>${pct(x.profitProb, 0)}</td><td class="${x.ruin > 0.05 ? 'neg' : ''}">${pct(x.ruin, 1)}</td><td>${pct(x.medianDD, 0)}</td></tr>`).join('')}
      </table></div>
      <div class="hint">Rovina = bankroll sceso sotto l'1% di quello iniziale. Kelly punta ${pct(r.kellyF, 2)} del bankroll a giocata con la probabilità stimata. Le progressioni usano ${money(r.unit)} come unità e ripartono dopo aver recuperato un'unità di profitto; la martingala raddoppia dopo ogni perdita senza tetto.</div>
    </div>`;
  multiLineChart($('#chSim'), r.results.map((x) => ({ name: name[x.key], color: css.getPropertyValue(`--s${slot(x.key)}`).trim(), points: x.path.map((p) => ({ x: p.i, y: p.v })) })), {
    fmtValue: money, fmtX: (x) => `giocata ${Math.round(x)}`, baseline: v.bank,
  });
}

// ---------- STATISTICHE ----------
function renderStats() {
  const d = store.get();
  const bets = d.bets;
  const s = C.summarize(bets);
  const st = C.streaks(bets);
  const { maxDrawdown } = C.bankrollSeries(bets, d.transactions);
  const groups = {
    sport: ['Sport', (b) => b.sport],
    competition: ['Competizione', (b) => b.competition],
    market: ['Mercato', (b) => b.market],
    bookmaker: ['Bookmaker', (b) => b.bookmaker],
    strategy: ['Strategia', (b) => ({ flat: 'Flat', kelly: 'Kelly', units: 'Unità a fiducia', target: 'Profitto fisso', masaniello: 'Masaniello', cycle: 'Ciclo progressivo', manual: 'Manuale' }[b.strategy])],
    source: ['Fonte', (b) => SG.SOURCES[b.source] || b.source || 'Manuale'],
    odds: ['Fascia di quota', (b) => C.oddsBucket(b.odds)],
    tag: ['Tag', null],
    weekday: ['Giorno', (b) => new Date(b.date + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long' })],
  };
  let rows;
  if (ui.statGroup === 'tag') {
    const expanded = [];
    for (const b of bets) for (const t of String(b.tags || '').split(',').map((x) => x.trim()).filter(Boolean)) expanded.push({ ...b, _tag: t });
    rows = C.groupBy(expanded, (b) => b._tag);
  } else rows = C.groupBy(bets, groups[ui.statGroup][1]);
  const legs = bets.filter((b) => b.legs && b.legs.length).flatMap((b) => b.legs).filter((l) => l.status === 'won' || l.status === 'lost');
  const legGroups = [...legs.reduce((m, l) => {
    const k = l.market || '—';
    const g = m.get(k) || { key: k, n: 0, won: 0, odds: 0 };
    g.n++; g.odds += +l.odds || 0; if (l.status === 'won') g.won++;
    return m.set(k, g);
  }, new Map()).values()].sort((a, b) => b.n - a.n);
  const bonusTot = d.transactions.filter((t) => t.type === 'bonus').reduce((a, t) => a + +t.amount, 0);
  const withProb = bets.filter((b) => C.isSettled(b) && +b.prob > 0 && b.status !== 'void');
  const actualProb = withProb.reduce((a, b) => a + C.betProfit(b), 0);

  view.innerHTML = `
    <div class="stack">
      <h2>Statistiche</h2>
      <div class="kpis">
        ${kpi('Profitto', `<span class="${cls(s.profit)}">${signed(s.profit)}</span>`, `${s.settled} scommesse chiuse`)}
        ${kpi('Yield', `<span class="${cls(s.yield)}">${pct(s.yield, 2)}</span>`, `giocato ${money(s.staked)}`)}
        ${kpi('Puntata media', money(s.avgStake), `quota media ${s.avgOdds ? s.avgOdds.toFixed(2) : '—'}`)}
        ${kpi('Serie', st.current, `max ${st.maxW} vinte · ${st.maxL} perse`)}
        ${s.clvN ? kpi('CLV medio', `<span class="${cls(s.clv)}">${pct(s.clv, 2)}</span>`, `su ${s.clvN} scommesse`) : kpi('Win rate', pct(s.winRate, 0), `quota media ${s.avgOdds ? fmtOdds(s.avgOdds) : '—'}`)}
        ${kpi('Max drawdown', money(maxDrawdown), 'dal picco di profitto')}
      </div>
      <div class="card"><h3>Profitto mensile</h3><canvas class="chart" id="chMonth"></canvas></div>
      ${bonusTot || s.freebetN ? `<div class="card"><h3>Bonus e freebet</h3><p class="hint" style="margin:0">Bonus accreditati <strong>${money(bonusTot)}</strong> · freebet giocate <strong>${s.freebetN}</strong> con profitto <strong class="${cls(s.freebetProfit)}">${signed(s.freebetProfit)}</strong>. Lo yield considera solo le giocate con denaro reale.</p></div>` : ''}
      ${legGroups.length ? `<div class="card"><h3>Selezioni delle multiple</h3>
        <div class="table-wrap"><table><tr><th>Mercato</th><th>Selezioni</th><th>Vinte</th><th>% vinte</th><th>Quota media</th><th>% implicita</th></tr>
        ${legGroups.map((g) => `<tr><td>${esc(g.key)}</td><td>${g.n}</td><td>${g.won}</td><td class="${cls(g.won / g.n - g.n / g.odds)}">${pct(g.won / g.n, 0)}</td><td>${fmtOdds(g.odds / g.n)}</td><td>${pct(g.n / g.odds, 0)}</td></tr>`).join('')}
        </table></div><div class="hint">Confronta la % di selezioni vinte con quella implicita nelle quote: se è più bassa, quel mercato ti fa perdere valore nelle multiple.</div></div>` : ''}
      ${withProb.length ? `<div class="card"><h3>Le tue stime funzionano?</h3>
        <p class="hint" style="margin:0">Sulle ${withProb.length} scommesse con probabilità stimata, il profitto atteso era <strong>${signed(s.ev)}</strong>, quello reale <strong class="${cls(actualProb)}">${signed(actualProb)}</strong>.
        Con pochi campioni la varianza domina: valuta il dato dopo almeno 200–300 scommesse. Il CLV positivo è l'indicatore più rapido di un vantaggio reale.</p></div>` : ''}
      <div class="card">
        <div class="sub-tabs" style="margin-bottom:12px">${Object.entries(groups).map(([k, [l]]) => `<button class="btn small ${ui.statGroup === k ? 'primary' : ''}" data-action="stat-group" data-group="${k}">${l}</button>`).join('')}</div>
        ${rows.length ? `<div class="table-wrap"><table>
          <tr><th>${groups[ui.statGroup][0]}</th><th>N</th><th>Giocato</th><th>Profitto</th><th>Yield</th><th>Win%</th><th>Quota m.</th></tr>
          ${rows.map((r) => `<tr><td>${esc(r.key)}</td><td>${r.settled}</td><td>${fmt(r.staked)}</td><td class="${cls(r.profit)}">${fmt(r.profit)}</td><td class="${cls(r.yield)}">${pct(r.yield)}</td><td>${pct(r.winRate, 0)}</td><td>${r.avgOdds ? r.avgOdds.toFixed(2) : '—'}</td></tr>`).join('')}
        </table></div>` : '<div class="empty">Nessuna scommessa chiusa</div>'}
      </div>
    </div>`;
  const months = new Map();
  for (const x of bets.filter(C.isSettled)) {
    const k = (x.settledDate || x.date).slice(0, 7);
    months.set(k, (months.get(k) || 0) + C.betProfit(x));
  }
  const bars = [...months.entries()].sort().slice(-12).map(([k, v]) => ({ label: k.slice(5) + '/' + k.slice(2, 4), value: v }));
  barChart($('#chMonth'), bars, { emptyText: 'Nessuna scommessa chiusa' });
}

// ---------- BANKROLL / IMPOSTAZIONI ----------
function renderBankroll() {
  const d = store.get();
  const s = d.settings;
  const b = balances();
  const cfg = sync.getConfig();
  const txs = d.transactions.slice().sort((a, z) => (a.date < z.date ? 1 : -1));
  const theme = localStorage.getItem('bankbet.theme') || 'dark';
  view.innerHTML = `
    <div class="stack">
      <h2>Bankroll e impostazioni</h2>
      <div class="kpis">
        ${kpi('Saldo', money(b.balance), `disponibile ${money(b.available)}`)}
        ${kpi('Depositato netto', money(b.deposited), 'depositi − prelievi')}
        ${kpi('Profitto', `<span class="${cls(b.profit)}">${signed(b.profit)}</span>`, b.bonus ? `dalle scommesse · bonus ${money(b.bonus)}` : 'dalle scommesse')}
      </div>
      ${accountsCard()}
      <div class="grid grid-2">
        <div class="card stack">
          <h3>Movimenti</h3>
          <div class="form-grid">
            <label class="field">Tipo<select id="txType">${Object.entries(TX_TYPES).map(([k, l]) => `<option value="${k}" ${ui.txType === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field">Importo<input id="txAmount" inputmode="decimal"></label>
            ${ui.txType === 'transfer' ? `
            <label class="field">Da<input id="txFrom" list="dlAcc" placeholder="${NO_ACCOUNT}"></label>
            <label class="field">A<input id="txTo" list="dlAcc" placeholder="es. Snai"></label>` : `
            <label class="field full">Conto (bookmaker)<input id="txBook" list="dlAcc" placeholder="opz. es. Snai"></label>`}
            <label class="field">Data<input id="txDate" type="date" value="${today()}"></label>
            <label class="field">Nota<input id="txNote" placeholder="opz."></label>
          </div>
          <datalist id="dlAcc">${[...new Set([...distinct('bookmaker'), ...d.transactions.flatMap((t) => [t.bookmaker, t.from, t.to])].filter(Boolean))].sort().map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
          <button class="btn primary" data-action="add-tx">Registra movimento</button>
          ${txs.length ? `<div class="table-wrap"><table>
            ${txs.map((t) => `<tr><td>${fmtDate(t.date)} <span class="muted">${esc(t.type === 'transfer' ? `${t.from || NO_ACCOUNT} → ${t.to || NO_ACCOUNT}` : [TX_TYPES[t.type] !== 'Deposito' && TX_TYPES[t.type] !== 'Prelievo' ? TX_TYPES[t.type] : '', t.bookmaker].filter(Boolean).join(' · '))} ${esc(t.note || '')}</span></td>
              <td class="${t.type === 'transfer' ? '' : t.type === 'withdrawal' ? 'neg' : 'pos'}">${t.type === 'transfer' ? '⇄ ' : t.type === 'withdrawal' ? '−' : '+'}${money(t.amount)}</td>
              <td style="width:1%"><button class="btn small ghost" data-action="del-tx" data-id="${t.id}" aria-label="Elimina">✕</button></td></tr>`).join('')}
          </table></div>` : ''}
        </div>
        <div class="card stack">
          <h3>Gestione del rischio</h3>
          <div class="form-grid">
            <label class="field">Puntata flat (% bankroll)<input data-setting="flatPct" inputmode="decimal" value="${s.flatPct}"></label>
            <label class="field">Frazione Kelly
              <select data-setting="kellyFraction">${[[1, 'Pieno'], [0.5, '½'], [0.25, '¼'], [0.1, '1/10']].map(([v, l]) => `<option value="${v}" ${+s.kellyFraction === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field">Tetto Kelly (% bankroll)<input data-setting="kellyCap" inputmode="decimal" value="${s.kellyCap}"></label>
            <label class="field">Valuta<input data-setting="currency" value="${esc(s.currency)}" maxlength="4"></label>
            <label class="field">Stop-loss giornaliero<input data-setting="dailyStopLoss" inputmode="decimal" value="${s.dailyStopLoss || ''}" placeholder="0 = off"></label>
            <label class="field">Stop-loss settimanale<input data-setting="weeklyStopLoss" inputmode="decimal" value="${s.weeklyStopLoss || ''}" placeholder="0 = off"></label>
            <label class="field">Stop-win giornaliero<input data-setting="dailyStopWin" inputmode="decimal" value="${s.dailyStopWin || ''}" placeholder="0 = off"></label>
            <label class="field">Obiettivo mensile<input data-setting="monthlyGoal" inputmode="decimal" value="${s.monthlyGoal || ''}" placeholder="0 = off"></label>
            <label class="field">Esposizione massima (% saldo)<input data-setting="maxExposurePct" inputmode="decimal" value="${s.maxExposurePct || ''}" placeholder="0 = off"></label>
            <label class="field">Kelly con incertezza
              <select data-setting="kellyAdaptive" data-type="bool"><option value="0" ${!s.kellyAdaptive ? 'selected' : ''}>No</option><option value="1" ${s.kellyAdaptive ? 'selected' : ''}>Sì</option></select></label>
          </div>
          <div class="hint">Le percentuali si applicano al bankroll disponibile (saldo meno le puntate in corso). L'esposizione massima limita la somma delle puntate in corso più la nuova. Kelly con incertezza avvicina la tua probabilità a quella della quota in base a quanto le tue stime hanno funzionato finora (affidabilità attuale ${Math.round(S.estimateReliability(d.bets).w * 100)}%).</div>
          <h3 style="margin-top:6px">Unità e profitto fisso</h3>
          <div class="form-grid">
            <label class="field">1 unità (% bankroll)<input data-setting="unitPct" inputmode="decimal" value="${s.unitPct}"></label>
            <label class="field">Ricalcolo unità
              <select data-setting="unitRecalc" data-type="text"><option value="month" ${s.unitRecalc !== 'change' ? 'selected' : ''}>A inizio mese</option><option value="change" ${s.unitRecalc === 'change' ? 'selected' : ''}>A variazione del bankroll</option></select></label>
            ${s.unitRecalc === 'change' ? `<label class="field">Soglia di ricalcolo (%)<input data-setting="unitChangePct" inputmode="decimal" value="${s.unitChangePct}"></label>` : ''}
            <label class="field">Profitto fisso per giocata<input data-setting="targetWin" inputmode="decimal" value="${s.targetWin}"></label>
          </div>
          <div class="hint">Oggi 1 unità vale <strong>${money(currentUnit().unit)}</strong> (riferimento ${money(currentUnit().base)}). Con il profitto fisso la puntata è obiettivo ÷ (quota − 1).</div>
        </div>
      </div>
      <div class="grid grid-2">
        <div class="card stack">
          <div class="spread"><h3>Sincronizzazione GitHub</h3>${sync.isConfigured(cfg) ? '<span class="chip won">attiva</span>' : '<span class="chip void">non configurata</span>'}</div>
          <div class="hint">I dati vengono salvati in un file JSON in un <strong>repository privato</strong>. Il token resta solo su questo dispositivo.</div>
          <div class="form-grid">
            <label class="field">Utente GitHub<input id="sOwner" value="${esc(cfg.owner || '')}" autocapitalize="off" autocomplete="off"></label>
            <label class="field">Repository privato<input id="sRepo" value="${esc(cfg.repo || '')}" placeholder="bankbet-data" autocapitalize="off" autocomplete="off"></label>
            <label class="field">File<input id="sPath" value="${esc(cfg.path)}"></label>
            <label class="field">Branch<input id="sBranch" value="${esc(cfg.branch)}"></label>
            <label class="field full">Token (fine-grained, Contents: read & write)<input id="sToken" type="password" value="${esc(cfg.token || '')}" autocomplete="off"></label>
            <label class="row full" style="font-size:.9rem"><input id="sAuto" type="checkbox" style="width:auto;min-height:0" ${cfg.auto ? 'checked' : ''}> Sincronizza automaticamente</label>
          </div>
          <div class="row">
            <button class="btn primary" data-action="save-sync">Salva e sincronizza</button>
            ${sync.isConfigured(cfg) ? '<button class="btn danger" data-action="forget-sync">Scollega</button>' : ''}
          </div>
          <div class="hint">${cfg.lastSync ? `Ultima sincronizzazione: ${new Date(cfg.lastSync).toLocaleString('it-IT')}` : ''}
          ${cfg.lastError ? `<br><span class="neg">Errore: ${esc(cfg.lastError)}</span>` : ''}</div>
          <details class="hint"><summary>Come creare il token</summary>
            <ol style="padding-left:18px">
              <li>Crea su GitHub un repository <strong>privato</strong> vuoto (es. <code>bankbet-data</code>), con un README così ha il branch <code>main</code>.</li>
              <li>Vai su Settings → Developer settings → Personal access tokens → <strong>Fine-grained tokens</strong> → Generate new token.</li>
              <li>Repository access: <em>Only select repositories</em> → solo il repo dei dati.</li>
              <li>Permissions → Repository → <strong>Contents: Read and write</strong>. Nient'altro.</li>
              <li>Incolla il token qui, su ogni dispositivo (PC e telefono).</li>
            </ol></details>
        </div>
        <div class="card stack">
          <h3>Menù della scheda scommessa</h3>
          ${listEditor('sports')}
          ${listEditor('bookmakers')}
          <div class="hint">★ indica la voce precompilata in una nuova scommessa. "Altro" è sempre disponibile e apre un campo libero. Togliere una voce non cambia le scommesse già registrate.</div>
        </div>
        <div class="card stack">
          <h3>Backup e aspetto</h3>
          <div class="row">
            <button class="btn" data-action="export-json">Esporta backup JSON</button>
            <button class="btn" data-action="import-json">Importa backup</button>
            <button class="btn" data-action="export-csv">Esporta CSV</button>
          </div>
          <input type="file" id="importFile" accept="application/json,.json" hidden>
          <label class="field">Tema
            <select id="themeSel">${[['dark', 'Scuro'], ['light', 'Chiaro'], ['auto', 'Automatico (come il sistema)']].map(([k, l]) => `<option value="${k}" ${theme === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <div class="hint">I dati sono salvati nel browser di questo dispositivo. Senza sincronizzazione, esporta periodicamente un backup.</div>
          <button class="btn danger" data-action="reset">Cancella tutti i dati locali</button>
        </div>
      </div>
      <p class="hint" style="text-align:center">Gioca responsabilmente. Nessun metodo di staking crea un vantaggio: protegge il bankroll solo se le tue giocate hanno valore. Se il gioco smette di essere un divertimento, chiedi aiuto (Telefono Verde Nazionale per le problematiche legate al Gioco d'Azzardo: 800 558822).</p>
    </div>`;

  for (const inp of $$('[data-setting]')) {
    inp.addEventListener('change', () => {
      const k = inp.dataset.setting;
      const type = inp.dataset.type;
      const val = k === 'currency' ? inp.value.trim() || '€' : type === 'text' ? inp.value : type === 'bool' ? inp.value === '1' : Math.max(0, num(inp.value) || 0);
      store.updateSettings({ [k]: val });
      toast('Impostazione salvata');
    });
  }
  $('#txType').addEventListener('change', (e) => { ui.txType = e.target.value; render(); });
  for (const inp of $$('input[id^="add-"]')) {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.nextElementSibling.click(); } });
  }
  $('#themeSel').addEventListener('change', (e) => { localStorage.setItem('bankbet.theme', e.target.value); applyTheme(); render(); });
  $('#importFile').addEventListener('change', importJSON);
}

function listEditor(key) {
  const list = listOf(key);
  const def = defaultOf(key);
  return `<div class="stack" style="gap:8px">
    <div class="label-caps">${LISTS[key].title}</div>
    <div class="row" style="gap:6px">${list.map((x, i) => `<span class="chip-edit">
      <button type="button" class="star ${x === def ? 'on' : ''}" data-action="list-default" data-list="${key}" data-i="${i}" aria-label="Precompila ${esc(x)}" aria-pressed="${x === def}">${x === def ? '★' : '☆'}</button>
      <span>${esc(x)}</span>
      <button type="button" data-action="list-del" data-list="${key}" data-i="${i}" aria-label="Togli ${esc(x)}" ${list.length < 2 ? 'disabled' : ''}>✕</button></span>`).join('')}
      <span class="chip-edit muted"><span>Altro</span></span></div>
    <div class="row" style="flex-wrap:nowrap"><input id="add-${key}" placeholder="Nuova voce" maxlength="40" style="max-width:240px"><button type="button" class="btn small" data-action="list-add" data-list="${key}">Aggiungi</button></div>
  </div>`;
}

function accountsCard() {
  const list = accounts().filter((a) => Math.abs(a.balance) > 0.004 || a.pending > 0 || a.bets);
  if (!list.length) return '';
  const unassigned = list.find((a) => a.name === NO_ACCOUNT);
  return `<div class="card">
    <div class="card-head"><h3>Conti per bookmaker</h3><span class="hint">${list.filter((a) => a.name !== NO_ACCOUNT).length} conti</span></div>
    <div class="table-wrap"><table>
      <tr><th>Conto</th><th>Saldo</th><th>In gioco</th><th>Disponibile</th><th>Profitto scommesse</th><th>Scommesse</th></tr>
      ${list.map((a) => `<tr><td>${esc(a.name)}</td><td><strong>${money(a.balance)}</strong></td><td>${money(a.pending)}</td>
        <td class="${a.available < -0.004 ? 'neg' : ''}">${money(a.available)}</td><td class="${cls(a.profit)}">${signed(a.profit)}</td><td>${a.bets}</td></tr>`).join('')}
    </table></div>
    ${unassigned && list.length > 1 ? `<div class="hint" style="margin-top:8px">Se un conto risulta negativo, registra il deposito su quel bookmaker o un trasferimento da "${NO_ACCOUNT}" verso di esso.</div>` : ''}
  </div>`;
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then((t) => {
    let incoming;
    try { incoming = JSON.parse(t); } catch { alert('File non valido'); return; }
    if (!incoming || !Array.isArray(incoming.bets)) { alert('Il file non sembra un backup BankBet'); return; }
    if (confirm('Unire il backup ai dati attuali?\nOK = unisci · Annulla = sostituisci tutto')) {
      store.applyMerged(store.merge(store.get(), incoming));
      store.updateSettings({});
    } else if (confirm('Sostituire TUTTI i dati attuali con il backup?')) {
      store.replaceAll(incoming);
    } else return;
    toast('Backup importato');
  });
  e.target.value = '';
}

// ---------- Azioni ----------
const actions = {
  'init-bank'() {
    const v = num($('#initBank').value);
    if (!(v > 0)) { alert('Inserisci un importo valido'); return; }
    store.upsert('transactions', { type: 'deposit', amount: C.round2(v), date: today(), note: 'Bankroll iniziale' });
  },
  'new-bet'() { openBet(); },
  'edit-bet'(el) { openBet(el.dataset.id); },
  settle(el) { settleBet(el.dataset.id, el.dataset.status); },
  'more-bets'() { ui.betLimit += 100; render(); },
  'home-period'(el) { ui.homePeriod = el.dataset.period; render(); },
  'cal-move'(el) {
    const [y, m] = (ui.calMonth || today().slice(0, 7)).split('-').map(Number);
    const d = new Date(y, m - 1 + +el.dataset.step, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    ui.calMonth = k >= today().slice(0, 7) ? null : k;
    render();
  },
  'show-pending'() {
    ui.betFilter = { q: '', status: 'pending', sport: '', period: '' };
    if (current() === 'bets') render(); else location.hash = 'bets';
  },
  'export-csv': exportCSV,
  'list-add'(el) {
    const key = el.dataset.list;
    const inp = $(`#add-${key}`);
    const v = inp.value.trim();
    const list = listOf(key);
    if (!v) return;
    if (v.toLowerCase() === 'altro' || list.some((x) => x.toLowerCase() === v.toLowerCase())) { toast('Voce già presente'); return; }
    store.updateSettings({ [key]: [...list, v] });
    toast(`Aggiunto: ${v}`);
  },
  'list-del'(el) {
    const key = el.dataset.list;
    const list = listOf(key);
    if (list.length < 2) return;
    const gone = list[+el.dataset.i];
    const prevDef = defaultOf(key);
    const next = list.filter((_, i) => i !== +el.dataset.i);
    store.updateSettings({ [key]: next, [LISTS[key].def]: prevDef === gone ? next[0] : prevDef });
    toast(`Tolto: ${gone}`, () => store.updateSettings({ [key]: list, [LISTS[key].def]: prevDef }));
  },
  'list-default'(el) {
    const key = el.dataset.list;
    store.updateSettings({ [LISTS[key].def]: listOf(key)[+el.dataset.i] });
  },
  'paste-signal'() { openPaste(); },
  'tool-tab'(el) { ui.toolTab = el.dataset.tab; if (current() === 'tools') render(); },
  'stat-group'(el) { ui.statGroup = el.dataset.group; render(); },
  'new-masaniello': openMasanielloForm,
  'new-cycle': openCycleForm,
  'sim-run': runSim,
  'c-toggle'(el) { ui.openCycle = ui.openCycle === el.dataset.id ? null : el.dataset.id; render(); },
  'c-bet'(el) { openBet(null, { strategy: 'cycle', cycleId: el.dataset.id }); },
  'c-close'(el) {
    const c = store.get().cycles.find((x) => x.id === el.dataset.id);
    store.upsert('cycles', { ...c, closed: true });
  },
  'c-reopen'(el) {
    const c = store.get().cycles.find((x) => x.id === el.dataset.id);
    store.upsert('cycles', { ...c, closed: false });
  },
  'c-delete'(el) {
    if (!confirm('Eliminare il ciclo? Le scommesse collegate restano ma perdono il collegamento.')) return;
    const id = el.dataset.id;
    for (const b of store.get().bets.filter((x) => x.cycleId === id)) store.upsert('bets', { ...b, cycleId: '', strategy: 'manual' });
    store.remove('cycles', id);
  },
  'm-toggle'(el) { ui.openMasaniello = ui.openMasaniello === el.dataset.id ? null : el.dataset.id; render(); },
  'm-bet'(el) { openBet(null, { strategy: 'masaniello', masanielloId: el.dataset.id }); },
  'm-close'(el) {
    if (!confirm('Chiudere questo ciclo Masaniello? Le scommesse collegate restano registrate.')) return;
    const m = store.get().masaniello.find((x) => x.id === el.dataset.id);
    store.upsert('masaniello', { ...m, closed: true });
  },
  'm-reopen'(el) {
    const m = store.get().masaniello.find((x) => x.id === el.dataset.id);
    store.upsert('masaniello', { ...m, closed: false });
  },
  'm-delete'(el) {
    if (!confirm('Eliminare il Masaniello? Le scommesse collegate restano ma perdono il collegamento.')) return;
    const id = el.dataset.id;
    for (const b of store.get().bets.filter((x) => x.masanielloId === id)) store.upsert('bets', { ...b, masanielloId: '', strategy: 'manual' });
    store.remove('masaniello', id);
  },
  'add-tx'() {
    const amount = num($('#txAmount').value);
    if (!(amount > 0)) { alert('Inserisci un importo valido'); return; }
    const type = $('#txType').value;
    const base = { type, amount: C.round2(amount), date: $('#txDate').value || today(), note: $('#txNote').value.trim() };
    if (type === 'transfer') {
      const from = $('#txFrom').value.trim(), to = $('#txTo').value.trim();
      if (from === to) { alert('Scegli due conti diversi'); return; }
      store.upsert('transactions', { ...base, from, to });
    } else store.upsert('transactions', { ...base, bookmaker: $('#txBook').value.trim() });
    toast('Movimento registrato');
  },
  'del-tx'(el) {
    const t = store.get().transactions.find((x) => x.id === el.dataset.id);
    if (!t || !confirm('Eliminare il movimento?')) return;
    store.remove('transactions', t.id);
    toast('Movimento eliminato', () => store.restore('transactions', { ...t }));
  },
  'save-sync'() {
    const cfg = sync.setConfig({
      owner: $('#sOwner').value.trim(), repo: $('#sRepo').value.trim(), path: $('#sPath').value.trim() || 'bankbet.json',
      branch: $('#sBranch').value.trim() || 'main', token: $('#sToken').value.trim(), auto: $('#sAuto').checked,
    });
    if (!sync.isConfigured(cfg)) { alert('Compila utente, repository e token'); return; }
    runSync(true);
  },
  'forget-sync'() {
    if (!confirm('Rimuovere la configurazione di sincronizzazione da questo dispositivo? I dati locali restano.')) return;
    sync.setConfig({ token: '', lastSync: null, lastError: null });
    updateSyncBtn();
    render();
  },
  'export-json'() { download(`bankbet-backup-${today()}.json`, store.exportJSON(), 'application/json'); },
  'import-json'() { $('#importFile').click(); },
  reset() {
    if (!confirm('Cancellare tutti i dati su questo dispositivo? (Il file sincronizzato su GitHub non viene toccato, ma alla prossima sincronizzazione i dati verranno riscaricati.)')) return;
    if (!confirm('Sei sicuro? L\'operazione non è reversibile senza backup.')) return;
    store.replaceAll(store.emptyData());
  },
};

let suppressClick = false;
view.addEventListener('click', (e) => {
  if (suppressClick) { e.preventDefault(); return; }
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  if (el.tagName === 'A' && el.dataset.action === 'tool-tab') ui.toolTab = el.dataset.tab;
  else e.preventDefault();
  actions[el.dataset.action](el);
});
dlgForm.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) { e.preventDefault(); actions[el.dataset.action](el); }
});
$('#fab').addEventListener('click', () => openBet());

// Swipe sulle schedine in corso (touch): destra = vinta, sinistra = persa.
let swipe = null;
view.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  const el = e.target.closest('.bet[data-swipe]');
  if (!el || e.target.closest('button')) return;
  swipe = { el, x: e.clientX, y: e.clientY, dx: 0, active: false, id: e.pointerId };
});
view.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
    if (Math.abs(dx) < 12) return;
    swipe.active = true;
  }
  swipe.dx = dx;
  swipe.el.style.transform = `translateX(${dx}px)`;
  swipe.el.dataset.dir = dx > 0 ? 'won' : 'lost';
  swipe.el.classList.toggle('armed', Math.abs(dx) > 90);
});
const endSwipe = () => {
  if (!swipe) return;
  const { el, dx, active } = swipe;
  swipe = null;
  if (!active) return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 60);
  el.style.transition = 'transform .15s';
  if (Math.abs(dx) > 90) {
    el.style.transform = `translateX(${dx > 0 ? 110 : -110}%)`;
    setTimeout(() => settleBet(el.dataset.id, dx > 0 ? 'won' : 'lost'), 150);
  } else {
    el.style.transform = '';
    setTimeout(() => { el.style.transition = ''; delete el.dataset.dir; el.classList.remove('armed'); }, 160);
  }
};
view.addEventListener('pointerup', endSwipe);
view.addEventListener('pointercancel', endSwipe);

// ---------- Sync ----------
const syncBtn = $('#syncBtn');
function updateSyncBtn(state) {
  const cfg = sync.getConfig();
  syncBtn.hidden = !sync.isConfigured(cfg);
  syncBtn.classList.toggle('spin', state === 'run');
  syncBtn.classList.toggle('err', state === 'err' || (!state && !!cfg.lastError));
  syncBtn.title = cfg.lastError ? `Errore: ${cfg.lastError}` : cfg.lastSync ? `Sincronizzato ${new Date(cfg.lastSync).toLocaleString('it-IT')}` : 'Sincronizza';
}

async function runSync(verbose = false) {
  if (!sync.isConfigured() || !navigator.onLine) return;
  updateSyncBtn('run');
  try {
    const r = await sync.sync();
    updateSyncBtn();
    if (verbose) toast(r.pulled || r.pushed ? 'Sincronizzato ✓' : 'Già aggiornato ✓');
  } catch (e) {
    updateSyncBtn('err');
    if (verbose) alert('Sincronizzazione non riuscita: ' + e.message);
  }
  if (current() === 'bankroll') render();
}
syncBtn.addEventListener('click', () => runSync(true));

store.onError((e) => {
  ui.storeError = `Impossibile salvare i dati su questo dispositivo (${e.name === 'QuotaExceededError' ? 'memoria del browser piena' : e.message}). Esporta subito un backup da Bankroll → Backup.`;
  render();
});

let syncTimer;
store.onChange(({ fromSync }) => {
  if (!dialog.open || fromSync) render();
  if (!fromSync && sync.getConfig().auto) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => runSync(false), 2500);
  }
});
dialog.addEventListener('close', () => render());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sync.getConfig().auto) runSync(false);
});
window.addEventListener('online', () => sync.getConfig().auto && runSync(false));

// ---------- Tema / avvio ----------
function applyTheme() {
  const t = localStorage.getItem('bankbet.theme');
  if (t === 'light' || t === 'auto') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); render(); });
// Ridisegna i grafici solo quando cambia la larghezza (non per la barra degli indirizzi su mobile).
let resizeT, lastW = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    if (current() === 'home' || current() === 'stats') render();
  }, 150);
});

applyTheme();
if (!handleIncoming()) render();
updateSyncBtn();
if (sync.getConfig().auto) runSync(false);
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
