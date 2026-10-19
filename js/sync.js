// Sincronizzazione con un repository GitHub privato tramite Contents API.
// Il token resta solo su questo dispositivo (localStorage), mai nei dati sincronizzati.

import * as store from './store.js';

const KEY = 'bankbet.sync.v1';
const API = 'https://api.github.com';

export function getConfig() {
  try {
    return { path: 'bankbet.json', branch: 'main', auto: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { path: 'bankbet.json', branch: 'main', auto: true };
  }
}

export function setConfig(patch) {
  const cfg = { ...getConfig(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(cfg));
  return cfg;
}

export function isConfigured(cfg = getConfig()) {
  return !!(cfg.owner && cfg.repo && cfg.token && cfg.path);
}

function headers(cfg) {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function fileUrl(cfg) {
  const path = cfg.path.split('/').map(encodeURIComponent).join('/');
  return `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
}

async function ghError(res) {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const j = await res.json();
    if (j.message) msg += ` — ${j.message}`;
  } catch { /* ignore */ }
  if (res.status === 401) msg += ' (token non valido o scaduto)';
  if (res.status === 404) msg += ' (repository non trovato o token senza accesso)';
  return new Error(msg);
}

export async function pull(cfg = getConfig()) {
  const res = await fetch(`${fileUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`, {
    headers: headers(cfg),
    cache: 'no-store',
  });
  if (res.status === 404) {
    // Distingue "file mancante" da "repo inaccessibile".
    const repo = await fetch(`${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`, { headers: headers(cfg) });
    if (!repo.ok) throw await ghError(repo);
    return { data: null, sha: null };
  }
  if (!res.ok) throw await ghError(res);
  const j = await res.json();
  let text;
  if (j.content) {
    text = b64decode(j.content);
  } else {
    // File > 1MB: si scarica il blob.
    const blob = await fetch(j.git_url, { headers: headers(cfg) });
    if (!blob.ok) throw await ghError(blob);
    text = b64decode((await blob.json()).content);
  }
  return { data: JSON.parse(text), sha: j.sha };
}

export async function push(data, sha, cfg = getConfig()) {
  const body = {
    message: `bankbet sync ${new Date().toISOString()}`,
    content: b64encode(JSON.stringify(data, null, 1)),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(fileUrl(cfg), { method: 'PUT', headers: headers(cfg), body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await ghError(res);
    err.status = res.status;
    throw err;
  }
  return (await res.json()).content.sha;
}

let running = null;

// Pull + merge + push. Ritorna una descrizione dell'esito.
export function sync() {
  if (running) return running;
  running = (async () => {
    try {
      return await doSync();
    } catch (e) {
      setConfig({ lastError: e.message });
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

async function doSync() {
  const cfg = getConfig();
  if (!isConfigured(cfg)) throw new Error('Sincronizzazione non configurata');
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await pull(cfg);
    const local = store.get();
    const merged = remote.data ? store.merge(local, remote.data) : store.merge(local, store.emptyData());
    const changedLocal = store.fingerprint(merged) !== store.fingerprint(store.merge(local, store.emptyData()));
    const changedRemote = !remote.data || store.fingerprint(merged) !== store.fingerprint(store.merge(remote.data, store.emptyData()));
    if (changedRemote) {
      try {
        await push(merged, remote.sha, cfg);
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt < 2) continue; // file cambiato nel frattempo: riprova
        throw e;
      }
    }
    // Rimerge con lo stato attuale: preserva modifiche fatte mentre la richiesta era in corso.
    if (changedLocal) store.applyMerged(store.merge(store.get(), merged));
    setConfig({ lastSync: Date.now(), lastError: null });
    return { pulled: changedLocal, pushed: changedRemote };
  }
  throw new Error('Conflitto di sincronizzazione ripetuto, riprova');
}
