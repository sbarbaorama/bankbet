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
