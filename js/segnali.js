// Scheda Segnali: pronostici di betting_max (Betwin, TotalCorner, BasketBet) e stato della VM.
//
// La VM scrive pronostici.json e stato.json nello stesso repository privato della sincronizzazione
// (stesso utente, repository, branch e token): qui si leggono soltanto, mai si scrivono.
// Con la scheda aperta si ricontrollano ogni minuto; GitHub risponde "non cambiato" (304) senza
// riscaricare il file finché la VM non pubblica qualcosa di nuovo.

import * as sync from './sync.js';
import * as SG from './signals.js';

const API = 'https://api.github.com';
const CACHE_KEY = 'bankbet.segnali.v1';
const SEEN_KEY = 'bankbet.segnali.visti';
const POLL_MS = 60000;
const FILES = { pronostici: 'pronostici.json', stato: 'stato.json' };
const PROJECTS = {
  betwin: { label: 'Betwin', short: 'Betwin', color: 'var(--s1)', desc: 'calcio pre-partita' },
  totalcorner: { label: 'TotalCorner', short: 'TotalCorner', color: 'var(--s2)', desc: 'calcio live' },
  basketbet: { label: 'BasketBet', short: 'Basket', color: 'var(--s4)', desc: 'NBA' },
};
const ESITO = { won: ['✓', 'pos', 'centrato'], lost: ['✗', 'neg', 'sbagliato'], void: ['–', 'muted', 'nullo'] };
const PERIODS = [['7', '7 gg'], ['30', '30 gg'], ['90', '3 mesi'], ['tutto', 'Tutto']];
const JOB_LABEL = {
  'betwin-previsioni': 'Betwin previsioni', 'betwin-prepartita': 'Betwin pre-partita', 'betwin-risultati': 'Betwin risultati',
  'basket-previsioni': 'Basket previsioni', 'basket-prepartita': 'Basket pre-partita', 'basket-verifica': 'Basket verifica',
  'bankbet-esiti': 'Esiti BankBet', monitor: 'Monitoraggio', backup: 'Backup', manutenzione: 'Manutenzione',
};
const PART_LABEL = { totalcorner: 'TotalCorner', 'bot-betwin': 'Bot Betwin', 'bot-basketbet': 'Bot BasketBet' };

let deps = null;        // { esc, fmtOdds, openSignal, getBets, rerender, isActive, setNavDot }
let state = { pronostici: null, stato: null, etag: {}, loaded: 0, error: null, loading: false };
let timer = null;
export const ui = { sub: 'feed', filter: 'all', period: '30', days: 3 };

try {
  const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  if (c) state = { ...state, pronostici: c.pronostici || null, stato: c.stato || null, loaded: c.loaded || 0 };
} catch { /* cache illeggibile: si riparte da zero */ }

export function init(d) { deps = d; }

// ---------- dati ----------
async function fetchFile(cfg, path, etag) {
  const url = `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`;
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (etag) headers['If-None-Match'] = etag;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (res.status === 304) return { same: true };
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}${res.status === 401 ? ' (token non valido)' : ''}`);
  return { data: await res.json(), etag: res.headers.get('ETag') };
}

export async function load() {
  const cfg = sync.getConfig();
  if (!sync.isConfigured(cfg) || state.loading) return;
  state.loading = true;
  let changed = false;
  try {
    for (const [key, path] of Object.entries(FILES)) {
      const r = await fetchFile(cfg, path, state[key] ? state.etag[key] : null);
      if (r.same) continue;
      state[key] = r.missing ? null : r.data;
      state.etag[key] = r.etag || null;
      changed = true;
    }
    state.error = null;
    state.loaded = Date.now();
    if (changed) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ pronostici: state.pronostici, stato: state.stato, loaded: state.loaded })); } catch { /* spazio pieno: pazienza */ }
    }
  } catch (e) {
    state.error = navigator.onLine === false ? 'Sei offline: dati dell\'ultimo aggiornamento' : e.message;
  } finally {
    state.loading = false;
  }
  updateDot();
  if (deps?.isActive()) deps.rerender();
}

export function startPolling() {
  if (timer) return;
  if (Date.now() - state.loaded > 15000) load();
  timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
}

export function stopPolling() {
  clearInterval(timer);
  timer = null;
}

// Pallino sulla scheda quando è arrivato un segnale TotalCorner che non hai ancora visto.
function newestSignal() {
  const list = state.pronostici?.progetti?.totalcorner?.pronostici || [];
  return list.reduce((m, p) => (p.quando > m ? p.quando : m), '');
}

function updateDot() {
  if (!deps) return;
  const newest = newestSignal();
  if (deps.isActive()) {
    if (newest) localStorage.setItem(SEEN_KEY, newest);
    deps.setNavDot(false);
  } else {
    deps.setNavDot(!!newest && newest > (localStorage.getItem(SEEN_KEY) || ''));
  }
}

export function onShow() {
  updateDot();
  startPolling();
}

// ---------- utilità ----------
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const pct = (x, d = 0) => (x == null ? '–' : `${x.toLocaleString('it-IT', { maximumFractionDigits: d, minimumFractionDigits: d })}%`);
const sgn = (x, d = 1) => (x == null ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString('it-IT', { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const cls = (x) => (x == null ? '' : x > 0 ? 'pos' : x < 0 ? 'neg' : '');
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
const hhmm = (s) => String(s || '').slice(11, 16);
const dayLabel = (iso) => {
  const t = localIso().slice(0, 10);
  const y = localIso(new Date(Date.now() - 864e5)).slice(0, 10);
  if (iso === t) return 'Oggi';
  if (iso === y) return 'Ieri';
  return new Date(iso + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
};
const ago = (iso) => {
  if (!iso) return 'mai';
  const t = new Date(String(iso).replace(' ', 'T'));
  const m = Math.round((Date.now() - t.getTime()) / 6e4);
  if (!Number.isFinite(m)) return '';
  if (m < 1) return 'adesso';
  if (m < 90) return `${m} min fa`;
  if (m < 48 * 60) return `${Math.round(m / 60)} ore fa`;
  return `${Math.round(m / 1440)} giorni fa`;
};

function allItems() {
  const out = [];
  for (const [k, sec] of Object.entries(state.pronostici?.progetti || {})) {
    for (const p of sec?.pronostici || []) out.push({ ...p, progetto: p.progetto || k });
  }
  return out;
}

// Una scelta è "registrata" se in BankBet c'è già una scommessa con lo stesso riferimento e la stessa
// scelta (per le multiple: le stesse selezioni).
function isRegistered(choice, bets) {
  const p = choice.bankbet || {};
  if (p.legs) {
    let key;
    try { key = JSON.parse(p.legs).map((l) => `${l.r || norm(l.e)}|${norm(l.s)}`).sort().join(','); } catch { return false; }
    return bets.some((b) => b.legs?.length && b.legs.map((l) => `${l.ref || norm(l.event)}|${norm(l.selection)}`).sort().join(',') === key);
  }
  if (p.ref) return bets.some((b) => b.ref === p.ref && norm(b.market) === norm(p.mkt) && norm(b.selection) === norm(p.sel));
  return bets.some((b) => norm(b.event) === norm(p.ev) && norm(b.selection) === norm(p.sel) && (b.date || '') >= (p.date || ''));
}

function decided(item) {
  if (item.progetto === 'totalcorner') return item.finita || item.scelte.every((c) => c.esito);
  return item.scelte.every((c) => c.esito);
}

// ---------- azioni ----------
export const actions = {
  'sg-sub'(el) { ui.sub = el.dataset.sub; deps.rerender(); },
  'sg-filter'(el) { ui.filter = el.dataset.f; deps.rerender(); },
  'sg-period'(el) { ui.period = el.dataset.p; deps.rerender(); },
  'sg-more'() { ui.days += 7; deps.rerender(); },
  'sg-refresh'() { load(); },
  'sg-reg'(el) {
    const item = allItems().find((p) => p.id === el.dataset.id);
    const choice = item?.scelte?.[+el.dataset.k];
    if (!choice?.bankbet) return;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(choice.bankbet)) if (v != null && v !== '') params.set(k, String(v));
    deps.openSignal(SG.fromParams(params));
  },
};

// ---------- vista ----------
export function render(view) {
  const { esc } = deps;
  const cfg = sync.getConfig();
  const st = state.stato;
  const vmBad = st && (!st.ok || stale(st));
  const head = `
    <div class="spread"><h2>Segnali</h2>
      <span class="hint">${state.loading ? 'aggiorno…' : state.loaded ? `controllato ${ago(new Date(state.loaded).toISOString())}` : ''}
        <button class="btn small ghost" data-action="sg-refresh" aria-label="Aggiorna adesso">Aggiorna</button></span></div>
    <div class="seg sg-tabs" role="tablist" aria-label="Sezione">
      ${[['feed', 'Feed'], ['rend', 'Rendimento'], ['vm', 'VM']].map(([k, l]) => `<button role="tab" aria-selected="${ui.sub === k}" class="${ui.sub === k ? 'on' : ''}" data-action="sg-sub" data-sub="${k}">${l}${k === 'vm' && vmBad ? ' <i class="sg-alert-dot" aria-label="problemi"></i>' : ''}</button>`).join('')}
    </div>`;
  let body;
  if (!sync.isConfigured(cfg)) {
    body = `<div class="card stack"><h3>Collega la VM</h3><p class="hint" style="margin:0">I pronostici arrivano dallo stesso repository GitHub privato della sincronizzazione. Configurala in <a href="#settings">Impostazioni → Sincronizzazione GitHub</a> e poi torna qui.</p></div>`;
  } else if (!state.pronostici && !state.stato) {
    body = state.error ? `<div class="alert danger">${esc(state.error)}</div>`
      : `<div class="card hint">${state.loading || !state.loaded ? 'Carico i pronostici…' : 'Nessun pronostico pubblicato dalla VM: controlla la sezione [pronostici] del config.ini e che il lavoro core.pronostici sia girato almeno una volta.'}</div>`;
  } else {
    body = (state.error ? `<div class="alert">${esc(state.error)}</div>` : '') +
      (ui.sub === 'rend' ? renderRend() : ui.sub === 'vm' ? renderVm() : renderFeed());
  }
  view.innerHTML = `<div class="stack sg">${head}${body}</div>`;
  updateDot();
}

function projDot(k) {
  return `<i class="sg-dot" style="background:${PROJECTS[k]?.color || 'var(--muted)'}" aria-hidden="true"></i>`;
}

function choiceButton(item, c, k, bets) {
  const { esc } = deps;
  const reg = isRegistered(c, bets);
  const e = ESITO[c.esito];
  if (e) {
    return `<span class="sg-choice done ${e[1]}"><span>${esc(c.etichetta)}</span><small>${e[0]} ${e[2]}${reg ? ' · registrata' : ''}</small></span>`;
  }
  if (reg) return `<span class="sg-choice reg"><span>${esc(c.etichetta)}</span><small>✓ Registrata</small></span>`;
  return `<button class="sg-choice" data-action="sg-reg" data-id="${esc(item.id)}" data-k="${k}"><span>${esc(c.etichetta)}</span><small>Registra</small></button>`;
}

function itemCard(item, bets) {
  const { esc, fmtOdds } = deps;
  const proj = PROJECTS[item.progetto] || { label: item.progetto };
  const live = item.progetto === 'totalcorner' && item.acceso;
  let when;
  if (item.progetto === 'totalcorner') when = `${item.minuto ?? '–'}' ${esc(item.tempo || '')}`;
  else when = hhmm(item.quando) || '';
  const headLeft = [proj.label, item.progetto === 'totalcorner' ? item.info : null, item.comp].filter(Boolean).map(esc).join(' · ');
  let sub = '';
  let main = '';
  if (item.progetto === 'totalcorner') {
    const bits = [];
    if (item.gol) bits.push(`gol ${esc(item.gol.squadra)} al ${esc(item.gol.minuto)}'`);
    if (item.risultato) bits.push(`finale ${esc(item.risultato)}`);
    else if (!live && item.chiusura) bits.push(`segnale ${esc(item.chiusura)}`);
    sub = bits.length ? `<div class="sg-sub">${bits.join(' · ')}</div>` : '';
    main = `<div class="sg-choices">${item.scelte.map((c, k) => choiceButton(item, c, k, bets)).join('')}</div>`;
  } else {
    const c = item.scelte[0];
    const quota = c.quota ? `<b class="sg-odds">@${fmtOdds(c.quota_agg || c.quota)}</b>${c.quota_agg ? ` <s class="muted" title="quota del mattino">${fmtOdds(c.quota)}</s>` : ''}` : '<span class="muted">quota da inserire</span>';
    const what = item.tipo === 'bolletta' ? esc(c.etichetta) : `${esc(c.mercato)} · ${esc(c.selezione)}`;
    const extra = [c.prob ? `prob ${String(c.prob).replace('.', ',')}%` : '', c.quota_agg_ora ? `quota agg. ${hhmm(c.quota_agg_ora)}` : '', item.risultato ? `finale ${esc(item.risultato)}` : ''].filter(Boolean).join(' · ');
    const legs = item.selezioni ? `<ul class="sg-legs">${item.selezioni.map((s) => {
      const e = ESITO[s.esito];
      return `<li><span>${esc(hhmm(s.quando))}</span><span>${esc(s.evento)} · <b>${esc(s.selezione)}</b>${s.quota ? ` @${fmtOdds(s.quota)}` : ''}</span><span class="${e ? e[1] : 'muted'}">${e ? e[0] : '·'}${s.risultato ? ` ${esc(s.risultato)}` : ''}</span></li>`;
    }).join('')}</ul>` : '';
    const reg = isRegistered(c, bets);
    const e = ESITO[c.esito];
    const action = e ? `<span class="chip ${c.esito}">${e[0]} ${e[2]}</span>`
      : reg ? '<span class="pill pos">✓ Registrata</span>'
        : `<button class="btn small" data-action="sg-reg" data-id="${esc(item.id)}" data-k="0">Registra</button>`;
    main = `<div class="sg-line"><div class="sg-what">${what} ${quota}${extra ? `<div class="hint">${extra}</div>` : ''}</div>${action}</div>${legs}`;
  }
  return `<article class="card sg-item${live ? ' live' : ''}">
    <div class="sg-head"><span>${projDot(item.progetto)}${headLeft}</span><span class="${live ? 'sg-live' : ''}">${live ? 'LIVE · ' : ''}${when}</span></div>
    <div class="sg-title">${esc(item.evento)}</div>${sub}${main}</article>`;
}

function renderFeed() {
  const bets = deps.getBets();
  const items = allItems();
  const counts = { all: items.length };
  for (const p of items) counts[p.progetto] = (counts[p.progetto] || 0) + 1;
  const sel = items.filter((p) => ui.filter === 'all' || p.progetto === ui.filter);
  const now = localIso();
  const today = now.slice(0, 10);
  const minDay = localIso(new Date(Date.now() - (ui.days - 1) * 864e5)).slice(0, 10);
  const live = sel.filter((p) => p.progetto === 'totalcorner' && p.acceso);
  const open = sel.filter((p) => !live.includes(p) && !decided(p) && (p.giorno >= today || (p.quando || '') >= localIso(new Date(Date.now() - 6 * 36e5))))
    .sort((a, b) => (a.quando || '').localeCompare(b.quando || ''));
  const closed = sel.filter((p) => !live.includes(p) && !open.includes(p) && p.giorno >= minDay)
    .sort((a, b) => (b.quando || '').localeCompare(a.quando || ''));
  const byDay = new Map();
  for (const p of closed) {
    if (!byDay.has(p.giorno)) byDay.set(p.giorno, []);
    byDay.get(p.giorno).push(p);
  }
  const chips = [['all', 'Tutti'], ...Object.entries(PROJECTS).map(([k, v]) => [k, v.short])]
    .map(([k, l]) => `<button class="sg-chip${ui.filter === k ? ' on' : ''}" data-action="sg-filter" data-f="${k}" aria-pressed="${ui.filter === k}">${l}${counts[k] ? ` <span>${counts[k]}</span>` : ''}</button>`).join('');
  let html = `<div class="sg-chips">${chips}</div>`;
  if (live.length) html += `<div class="date-head">Live ora</div><div class="bet-list">${live.map((p) => itemCard(p, bets)).join('')}</div>`;
  if (open.length) html += `<div class="date-head">In attesa · ${open.length}</div><div class="bet-list">${open.map((p) => itemCard(p, bets)).join('')}</div>`;
  for (const [day, list] of byDay) {
    const choices = list.flatMap((p) => p.scelte).filter((c) => c.esito === 'won' || c.esito === 'lost');
    const ok = choices.filter((c) => c.esito === 'won').length;
    html += `<div class="date-head spread"><span>${deps.esc(dayLabel(day))}</span><span>${choices.length ? `${ok} su ${choices.length} centrati` : ''}</span></div>
      <div class="bet-list">${list.map((p) => itemCard(p, bets)).join('')}</div>`;
  }
  if (!live.length && !open.length && !byDay.size) html += '<div class="card hint">Nessun pronostico in questo periodo.</div>';
  if (items.some((p) => p.giorno < minDay)) html += '<button class="btn" data-action="sg-more">Mostra altri giorni</button>';
  return html;
}

function spark(series, color) {
  if (!series || series.length < 2) return '';
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const span = max - min || 1;
  const w = 300;
  const h = 44;
  const x = (i) => (i / (series.length - 1)) * w;
  const y = (v) => h - 3 - ((v - min) / span) * (h - 6);
  const last = series[series.length - 1];
  return `<svg class="sg-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Profitto cumulato: ${sgn(last, 2)} unità">
    <line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" stroke="var(--grid)" stroke-width="1"/>
    <polyline fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" points="${series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/></svg>`;
}

function kpi(label, value, extra = '') {
  return `<div><div class="label-caps">${label}</div><div class="big-num sg-kpi ${extra}">${value}</div></div>`;
}

function renderRend() {
  const { esc } = deps;
  const progetti = state.pronostici?.progetti || {};
  const seg = `<div class="seg" role="group" aria-label="Periodo">${PERIODS.map(([k, l]) => `<button class="${ui.period === k ? 'on' : ''}" data-action="sg-period" data-p="${k}" aria-pressed="${ui.period === k}">${l}</button>`).join('')}</div>`;
  const cards = Object.entries(PROJECTS).map(([k, meta]) => {
    const sec = progetti[k];
    const head = `<div class="spread"><span class="sg-proj-title">${projDot(k)}${esc(meta.label.toUpperCase())}</span><span class="hint">${esc(meta.desc)}${sec?.aggiornato ? ` · agg. ${hhmm(sec.aggiornato)}` : ''}</span></div>`;
    const r = sec?.rendimento?.[ui.period];
    if (!r) return `<div class="card stack">${head}<div class="hint">Nessun dato.</div></div>`;
    if (k === 'totalcorner') {
      const rows = Object.values(r.scelte || {}).map((s) => {
        const p = s.chiusi ? Math.round((s.centrati / s.chiusi) * 100) : null;
        return `<div class="sg-bar"><span>${esc(s.etichetta)}</span><span class="bar" role="img" aria-label="${p ?? 0}% centrati"><span style="width:${p ?? 0}%;background:${meta.color}"></span></span><b class="big-num">${pct(p)}</b><small class="muted">${s.centrati}/${s.chiusi}</small></div>`;
      }).join('');
      return `<div class="card stack">${head}<div class="hint"><b>${r.segnali}</b> segnali · % centrati per scelta (i segnali non hanno quota live)</div>${rows || '<div class="hint">Nessun segnale chiuso.</div>'}</div>`;
    }
    const hit = r.chiusi ? Math.round((r.centrati / r.chiusi) * 100) : null;
    return `<div class="card stack">${head}
      <div class="sg-kpis">${kpi('Pronostici', r.pronostici)}${kpi('Centrati', pct(hit))}${kpi('ROI', r.roi == null ? '–' : `${sgn(r.roi)}%`, cls(r.roi))}${kpi('CLV', r.clv == null ? '–' : `${sgn(r.clv)}%`, 'ev')}</div>
      ${spark(r.serie, meta.color)}
      <div class="hint">${r.chiusi} chiusi · profitto ${sgn(r.profitto, 2)} u${r.clv_n ? ` · CLV su ${r.clv_n}` : ''}</div></div>`;
  }).join('');
  return `<div class="spread">${seg}</div>
    <div class="hint">Rendimento dei pronostici, 1 unità sulla quota segnalata. Le tue giocate sono in <a href="#stats">Statistiche</a>.</div>
    <div class="grid sg-rend">${cards}</div>`;
}

function stale(st) {
  const t = new Date(String(st.generato || '').replace(' ', 'T'));
  return !Number.isFinite(t.getTime()) || Date.now() - t.getTime() > 75 * 6e4;
}

function meter(label, value, warn) {
  const v = value ?? 0;
  return `<div class="meter${warn ? ' over' : ''}"><div class="top"><span>${label}</span><span class="big-num">${value == null ? '–' : `${v}%`}</span></div><div class="bar"><div style="width:${Math.min(100, v)}%"></div></div></div>`;
}

function renderVm() {
  const { esc } = deps;
  const st = state.stato;
  if (!st) return '<div class="card hint">La VM non ha ancora pubblicato stato.json: arriva al prossimo giro del monitoraggio (ogni 10 minuti).</div>';
  const old = stale(st);
  const banner = st.ok && !old
    ? `<div class="card sg-ok"><div class="big-num">TUTTO OK</div><div class="hint">ultimo controllo ${esc(ago(st.generato))} · nessun problema aperto</div></div>`
    : `<div class="card sg-bad stack"><div class="big-num">${old ? 'STATO VECCHIO' : `${st.problemi.length} PROBLEM${st.problemi.length === 1 ? 'A' : 'I'}`}</div>
        ${old ? `<div>La VM non aggiorna lo stato da ${esc(ago(st.generato))}: potrebbe essere ferma o senza rete.</div>` : ''}
        ${st.problemi.map((p) => `<div>• ${esc(p.testo)} <span class="hint">dal ${esc(hhmm(p.dal))}</span></div>`).join('')}</div>`;
  const parts = st.servizio?.parti || {};
  // ok: true = verde, false = rosso, null = nessun dato (grigio)
  const tile = (label, ok, text) => `<div class="kpi"><div class="label">${label}</div><div class="sg-tile ${ok == null ? 'na' : ok ? 'pos' : 'neg'}">● <span>${esc(text)}</span></div></div>`;
  const tiles = [
    tile('Servizio', st.servizio?.avvio ? !st.problemi.some((p) => p.chiave.startsWith('servizio')) : null, st.servizio?.avvio ? `attivo dal ${String(st.servizio.avvio).slice(8, 10)}/${String(st.servizio.avvio).slice(5, 7)} ${hhmm(st.servizio.avvio)}` : 'stato sconosciuto'),
    ...Object.entries(PART_LABEL).map(([k, l]) => tile(l, parts[k]?.ok || st.problemi.some((p) => p.chiave === k) ? !st.problemi.some((p) => p.chiave === k) : null, parts[k]?.ok ? `ok ${ago(parts[k].ok)}` : 'nessun dato')),
  ];
  const q = st.quota_api || {};
  const qLow = st.problemi.some((p) => p.chiave === 'quota-api');
  tiles.push(`<div class="kpi"><div class="label">API-Football oggi</div><div class="sg-tile ${qLow ? 'neg' : ''}">${q.rimaste == null ? '–' : `${q.rimaste} / ${q.limite} rimaste`}</div></div>`);
  const r = st.risorse || {};
  const res = `<div class="card stack"><h3>Risorse</h3>
    ${meter('Disco', r.disco_pct, st.problemi.some((p) => p.chiave === 'disco'))}
    ${meter('RAM', r.ram_pct, false)}
    ${meter('Swap', r.swap_pct, st.problemi.some((p) => p.chiave === 'swap'))}
    <div class="hint">Libero ${r.disco_libero_gb ?? '–'} GB · database ${Object.entries(st.database_mb || {}).map(([k, v]) => `${esc(k)} ${v.toLocaleString('it-IT')} MB`).join(' · ') || '–'}<br>
    Ultimo backup ${st.backup?.ora ? `${esc(ago(st.backup.ora))} (${esc(st.backup.mb)} MB)` : 'mai'} · pronostici pubblicati ${esc(ago(st.pronostici?.ora))}</div></div>`;
  const last = (j) => [j.fine, j.controllo, j.inizio].filter(Boolean).sort().pop() || '';
  const jobs = [...(st.lavori || [])].sort((a, b) => last(b).localeCompare(last(a))).map((j) => {
    let txt; let c = '';
    const running = j.inizio && (!j.fine || j.inizio > j.fine);
    if (running) { txt = 'in corso'; c = 'ev'; } else if (j.fine && j.esito !== 0 && j.esito != null && (!j.controllo || j.fine >= j.controllo)) { txt = `errore (${j.esito})`; c = 'neg'; } else if (j.saltato && j.controllo && (!j.fine || j.controllo > j.fine)) { txt = 'niente da fare'; c = 'muted'; } else if (j.fine) { txt = `ok${j.durata_s != null ? ` ${j.durata_s < 90 ? `${j.durata_s}s` : `${Math.round(j.durata_s / 60)}m`}` : ''}`; c = 'pos'; } else { txt = 'mai eseguito'; c = 'muted'; }
    const t = last(j);
    return `<li><span class="mono">${t ? `${t.slice(8, 10)}/${t.slice(5, 7)} ${hhmm(t)}` : '–'}</span><span title="${esc(j.descrizione)}">${esc(JOB_LABEL[j.nome] || j.nome)}</span><span class="${c}">${esc(txt)}</span></li>`;
  }).join('');
  return `${banner}<div class="kpis sg-tiles">${tiles.join('')}</div>
    <div class="grid grid-2">${res}<div class="card stack"><h3>Lavori</h3><ul class="sg-jobs">${jobs}</ul></div></div>
    <div class="hint">Stato pubblicato dalla VM ${esc(ago(st.generato))}: si aggiorna quando un problema nasce o si risolve, e comunque ogni ora.</div>`;
}
