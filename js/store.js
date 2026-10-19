// Stato dell'app, persistenza locale e merge per la sincronizzazione.

const KEY = 'bankbet.data.v1';
const COLLECTIONS = ['bets', 'transactions', 'masaniello'];
const listeners = new Set();

export function emptyData() {
  return {
    version: 1,
    settings: {
      currency: '€',
      kellyFraction: 0.25,
      kellyCap: 5,
      flatPct: 2,
      dailyStopLoss: 0,
      weeklyStopLoss: 0,
      updatedAt: 0,
    },
    bets: [],
    transactions: [],
    masaniello: [],
    deleted: {},
  };
}

function normalize(d) {
  const base = emptyData();
  d = d && typeof d === 'object' ? d : {};
  return {
    version: 1,
    settings: { ...base.settings, ...(d.settings || {}) },
    bets: Array.isArray(d.bets) ? d.bets : [],
    transactions: Array.isArray(d.transactions) ? d.transactions : [],
    masaniello: Array.isArray(d.masaniello) ? d.masaniello : [],
    deleted: d.deleted && typeof d.deleted === 'object' ? d.deleted : {},
  };
}

let data = load();

function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return emptyData();
  }
}

function persist(fromSync = false) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    alert('Impossibile salvare i dati localmente: ' + e.message);
  }
  for (const fn of listeners) fn({ fromSync });
}

export function onChange(fn) {
  listeners.add(fn);
}

export function get() {
  return data;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function upsert(collection, item) {
  const now = Date.now();
  const list = data[collection];
  if (!item.id) {
    item = { ...item, id: uid(), createdAt: now };
  }
  item.updatedAt = now;
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...item };
  else list.push(item);
  persist();
  return item;
}

export function remove(collection, id) {
  data[collection] = data[collection].filter((x) => x.id !== id);
  data.deleted[id] = Date.now();
  persist();
}

export function updateSettings(patch) {
  data.settings = { ...data.settings, ...patch, updatedAt: Date.now() };
  persist();
}

export function replaceAll(newData) {
  data = normalize(newData);
  persist();
}

export function exportJSON() {
  return JSON.stringify(data, null, 2);
}

// Merge last-write-wins per record, con tombstone per le cancellazioni.
export function merge(a, b) {
  a = normalize(a);
  b = normalize(b);
  const deleted = { ...a.deleted };
  for (const [id, ts] of Object.entries(b.deleted)) deleted[id] = Math.max(deleted[id] || 0, ts);
  const out = {
    version: 1,
    settings: (b.settings.updatedAt || 0) > (a.settings.updatedAt || 0) ? b.settings : a.settings,
    deleted,
  };
  for (const c of COLLECTIONS) {
    const map = new Map();
    for (const item of [...a[c], ...b[c]]) {
      const cur = map.get(item.id);
      if (!cur || (item.updatedAt || 0) > (cur.updatedAt || 0)) map.set(item.id, item);
    }
    out[c] = [...map.values()]
      .filter((x) => !(deleted[x.id] >= (x.updatedAt || 0)))
      .sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0) || (x.id < y.id ? -1 : 1));
  }
  // Pulisce tombstone più vecchi di 180 giorni.
  const limit = Date.now() - 180 * 864e5;
  for (const [id, ts] of Object.entries(out.deleted)) if (ts < limit) delete out.deleted[id];
  return out;
}

export function applyMerged(merged) {
  data = normalize(merged);
  persist(true);
}

// Stato corrente "firma" per capire se qualcosa è cambiato.
export function fingerprint(d = data) {
  return JSON.stringify(d);
}
