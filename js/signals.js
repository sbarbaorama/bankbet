// Segnali in arrivo: link "#new?..." dai bot Telegram e lettura del testo incollato.
//
// Formato del link (tutti i parametri sono facoltativi):
//   https://sbarbaorama.github.io/bankbet/#new?src=totalcorner&ev=Inter%20-%20Milan&comp=Serie%20A
//     &sport=Calcio&mkt=Prossimo%20gol&sel=Inter&odds=1.85&prob=62.5&date=2026-10-19&tags=live&note=...&book=Snai

const clip = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const numOrEmpty = (s) => {
  const n = parseFloat(String(s ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : '';
};
const isoDate = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : '');

export const SOURCES = { totalcorner: 'TotalCorner', betwin: 'Betwin', incolla: 'Testo incollato' };

export function fromParams(params) {
  const g = (k) => params.get(k);
  const odds = numOrEmpty(g('odds'));
  const prob = numOrEmpty(g('prob'));
  const preset = {
    source: clip(g('src'), 40).toLowerCase(),
    sport: clip(g('sport'), 40),
    competition: clip(g('comp'), 80),
    event: clip(g('ev'), 120),
    market: clip(g('mkt'), 60),
    selection: clip(g('sel'), 80),
    bookmaker: clip(g('book'), 40),
    odds: odds > 1 ? odds : '',
    prob: prob > 0 && prob < 100 ? prob : '',
    tags: clip(g('tags'), 120),
    notes: clip(g('note'), 400),
  };
  const date = isoDate(g('date'));
  if (date) preset.date = date;
  // Multipla: legs=[{"e":evento,"m":mercato,"s":scelta,"o":quota}, ...]
  try {
    const raw = JSON.parse(g('legs') || 'null');
    if (Array.isArray(raw)) {
      const legs = raw.slice(0, 20).map((l) => ({
        event: clip(l.e, 120), market: clip(l.m, 60), selection: clip(l.s, 80),
        odds: numOrEmpty(l.o) > 1 ? numOrEmpty(l.o) : '', status: 'pending',
      })).filter((l) => l.event || l.selection);
      if (legs.length >= 2) {
        preset.legs = legs;
        if (!preset.odds && legs.every((l) => l.odds)) preset.odds = Math.round(legs.reduce((a, l) => a * l.odds, 1) * 100) / 100;
      }
    }
  } catch { /* parametro non valido: ignorato */ }
  for (const k of Object.keys(preset)) if (preset[k] === '') delete preset[k];
  return preset;
}

// Riconosce i messaggi dei bot (anche più partite nello stesso messaggio) e, in mancanza,
// prova a estrarre partita e quota da un testo qualsiasi. Restituisce un elenco di preset.
export function parseText(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  const link = text.match(/#new\?([^\s"'<>]+)/);
  if (link) return [fromParams(new URLSearchParams(link[1]))];

  const out = [];
  const headDate = (text.match(/(\d{2})-(\d{2})-(\d{4})/) || []);
  const day = headDate[3] ? `${headDate[3]}-${headDate[2]}-${headDate[1]}` : '';
  // Righe "1) 18:00 Casa – Ospite" seguite da "SCELTA @1.85 · prob. 52%"
  const legRe = /^\s*\d+\)\s*(\d{2}:\d{2})?\s*(.+?)\s+[–-]\s+(.+?)\s*$/;
  const pickRe = /^\s*(.+?)\s+@\s*(\d+[.,]\d+)(?:.*?prob\.\s*([\d.,]+)%)?/;
  const readLegs = (block) => {
    const ls = block.split('\n');
    const res = [];
    for (let i = 0; i < ls.length; i++) {
      const m = ls[i].match(legRe);
      if (!m) continue;
      let league = '', pick = null;
      for (let j = i + 1; j < Math.min(i + 4, ls.length); j++) {
        if (legRe.test(ls[j])) break;
        const pm = ls[j].match(pickRe);
        if (pm) { pick = pm; break; }
        if (ls[j].trim() && !league) league = ls[j].trim();
      }
      if (!pick) continue;
      res.push({ hour: m[1] || '', event: `${m[2].trim()} - ${m[3].trim()}`, league, selection: pick[1].trim(),
        odds: numOrEmpty(pick[2]), prob: numOrEmpty(pick[3]) });
    }
    return res;
  };
  const marketOf = (sel) => (/^(Over|Under)/.test(sel) ? 'Over/Under' : /^(1|X|2)$/.test(sel) ? '1X2'
    : /^(1X|X2|12)$/.test(sel) ? 'Doppia chance' : /^(Goal|No goal)$/i.test(sel) ? 'Goal/No goal' : '');

  // --- Betwin: bolletta (una multipla per ogni versione ① ② ③)
  if (/B O L L E T T A|🎫/.test(text)) {
    const parts = text.split(/(?=^[①②③].*$)/m).slice(1);
    for (const part of parts) {
      const title = part.split('\n')[0].trim();
      const legs = readLegs(part);
      if (legs.length < 2) continue;
      const tot = (part.match(/Quota totale\s*([\d.,]+)/) || [])[1];
      const prob = (part.match(/probabilit[aà] stimata\s*([\d.,]+)%/) || [])[1];
      out.push({
        source: 'betwin', sport: 'Calcio', event: `Bolletta ${title}`, date: day,
        odds: numOrEmpty(tot) || Math.round(legs.reduce((a, l) => a * (l.odds || 1), 1) * 100) / 100, prob: numOrEmpty(prob),
        legs: legs.map((l) => ({ event: l.event, market: marketOf(l.selection), selection: l.selection, odds: l.odds, status: 'pending' })),
        tags: 'betwin, bolletta', notes: `Orari: ${legs.map((l) => l.hour).filter(Boolean).join(', ')}`,
      });
    }
    if (out.length) return out.map(clean);
  }
  // --- Betwin: singole del bankroll
  if (/S I N G O L E|💰/.test(text)) {
    for (const l of readLegs(text)) {
      out.push({ source: 'betwin', sport: 'Calcio', event: l.event, competition: l.league, market: marketOf(l.selection),
        selection: l.selection, odds: l.odds, prob: l.prob, date: day, tags: 'betwin, singola',
        notes: l.hour ? `Calcio d'inizio ${l.hour}` : '' });
    }
    if (out.length) return out.map(clean);
  }

  // --- TotalCorner: "⭐ Favorita che spinge" / "🔥 0-0 sotto pressione"
  const tcRe = /(Favorita che spinge|0-0 sotto pressione)/g;
  const tcStarts = [...text.matchAll(tcRe)].map((m) => m.index);
  tcStarts.forEach((start, i) => {
    const block = text.slice(start, tcStarts[i + 1] ?? text.length);
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const fav = /^Favorita che spinge/.test(lines[0]) || /Favorita che spinge/.test(lines[0]);
    const minute = (lines[0].match(/(\d+)'\s*(\((?:1|2)T\))?/) || []);
    const teams = lines[1] || '';
    const league = lines[2] && !/^(Favorita|Ultimi|Ritmo|Linea|Handicap|Spinge|Indice)/.test(lines[2]) ? lines[2] : '';
    const who = fav ? (block.match(/Favorita:\s*(.+?)\s*\(/) || [])[1] : (block.match(/Spinge di più:\s*(.+)/) || [])[1];
    if (!/\S\s+-\s+\S/.test(teams)) return;
    out.push({
      source: 'totalcorner', sport: 'Calcio', event: clip(teams, 120), competition: clip(league, 80),
      market: 'Prossimo gol', selection: who && who !== 'entrambe' ? clip(who, 80) : '',
      tags: `totalcorner, live, ${fav ? 'favorita' : 'pressione'}`,
      notes: minute[1] ? `Segnale ${fav ? 'favorita che spinge' : '0-0 sotto pressione'} al ${minute[1]}'${minute[2] ? ' ' + minute[2] : ''}` : '',
    });
  });
  if (out.length) return out.map(clean);

  // --- Betwin: blocchi che iniziano con "🏃 Casa - Ospite"
  if (/🏃/.test(text) && /over 1\.5/i.test(text)) {
    for (const block of text.split('🏃').slice(1)) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const teams = lines[0] || '';
      if (!/\S\s+-\s+\S/.test(teams)) continue;
      const when = (block.match(/📅\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/) || []);
      const league = (block.match(/League:\s*(.+)/) || [])[1] || '';
      const country = (block.match(/Country:\s*(.+)/) || [])[1] || '';
      const p = (block.match(/over 1\.5:\s*([\d.,]+)/i) || [])[1];
      out.push({
        source: 'betwin', sport: 'Calcio', event: clip(teams, 120),
        competition: clip([country, league].filter(Boolean).join(' · '), 80),
        market: 'Over/Under', selection: 'Over 1.5', prob: numOrEmpty(p),
        date: when[1] || '', tags: 'betwin, over 1.5', notes: when[2] ? `Calcio d'inizio ${when[2]}` : '',
      });
    }
    if (out.length) return out.map(clean);
  }

  // --- Testo generico: prima riga "Squadra A - Squadra B" (o "vs") e una quota "@1.85" / "quota 1,85"
  // nome squadra: parole che iniziano con maiuscola o cifra (es. "Real Madrid", "Paris Saint-Germain", "1860 Monaco")
  const name = "[\\p{Lu}\\p{N}][\\p{L}\\p{N}.'’-]*(?: [\\p{Lu}\\p{N}][\\p{L}\\p{N}.'’-]*){0,3}";
  const tm = text.match(new RegExp(`(${name})\\s+(?:-|–|vs\\.?|v)\\s+(${name})`, 'u'));
  const teamLine = tm ? `${tm[1]} - ${tm[2]}` : '';
  const om = text.match(/@\s*(\d+(?:[.,]\d+)?)|quota\s*:?\s*(\d+[.,]\d+)/i);
  const odds = om ? om[1] || om[2] : undefined;
  if (teamLine || odds) {
    out.push({ source: 'incolla', event: clip((teamLine || '').replace(/\s+(?:–|vs\.?|v)\s+/i, ' - '), 120), odds: numOrEmpty(odds) > 1 ? numOrEmpty(odds) : '', notes: clip(text, 400) });
  }
  return out.map(clean);
}

function clean(p) {
  const o = { ...p };
  for (const k of Object.keys(o)) if (o[k] === '' || o[k] == null) delete o[k];
  return o;
}

// Costruisce un link (utile per test e per altri script).
export function signalLink(base, preset) {
  const map = { source: 'src', event: 'ev', competition: 'comp', sport: 'sport', market: 'mkt', selection: 'sel', odds: 'odds', prob: 'prob', date: 'date', tags: 'tags', notes: 'note', bookmaker: 'book' };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(map)) if (preset[k] !== undefined && preset[k] !== '') q.set(v, preset[k]);
  return `${base.split('#')[0]}#new?${q.toString()}`;
}
