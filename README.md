# BankBet

Web app (PWA) per registrare scommesse e gestire il bankroll. Funziona su PC e su Android (installabile come app), anche offline.

## Funzioni

- **Registro scommesse (schedine)**: evento, sport, competizione, mercato, selezione, bookmaker, quota, puntata, esito (vinta, persa, rimborsata, mezza vinta/persa, cashout), tag e note. Chiusura rapida dell'esito con un tocco o con uno swipe su telefono (destra = vinta, sinistra = persa), con **Annulla** subito dopo. Ricerca, filtri, duplicazione.
- **Multiple**: ogni selezione con la sua quota ed esito; quota totale ed esito della multipla calcolati in automatico. In Statistiche, la % di selezioni vinte per mercato confrontata con quella implicita nelle quote.
- **Freebet e bonus**: la freebet perde zero e incassa solo la vincita netta; i bonus accreditati sono un movimento a parte. Lo yield considera solo le giocate con denaro reale.
- **Bankroll e conti**: depositi, prelievi, bonus e trasferimenti tra conti; saldo e disponibile per ogni bookmaker, con avviso se la puntata supera il saldo del conto.
- **Home**: bankroll con grafico interattivo (linea attesa EV, drawdown massimo), "fortuna vs EV", KPI, limiti e obiettivi, calendario del profitto giornaliero, schedine in corso, cicli attivi, promemoria per le giocate rimaste in corso da giorni.
- **Staking**: puntata suggerita in base alla strategia scelta:
  - *Flat*: percentuale fissa del bankroll;
  - *Kelly*: frazione configurabile con tetto massimo; opzionale *Kelly con incertezza*, che avvicina la tua probabilità a quella della quota in base a quanto le tue stime hanno funzionato finora;
  - *Unità a fiducia*: 1–10 unità, con l'unità ricalcolata a inizio mese o quando il bankroll varia di una soglia;
  - *Profitto fisso*: puntata = obiettivo ÷ (quota − 1);
  - *Masaniello*: cicli con N eventi / K vincenti / quota media, puntate ricalcolate dopo ogni esito e sulla quota reale;
  - *Cicli progressivi*: scalata, Fibonacci, D'Alembert, Labouchère, sempre con budget, tetto alla puntata e arresto automatico;
  - *Esposizione massima*: limite opzionale alla somma delle puntate in corso.
- **Simulatore Monte Carlo**: confronta le strategie (martingala compresa) sugli stessi esiti casuali: bankroll mediano, scenari peggiori e migliori, probabilità di chiudere in utile, rischio di rovina, drawdown.
- **Segnali da Telegram**: i bot TotalCorner e Betwin aggiungono ai messaggi il link *Registra su BankBet*, che apre la nuova scommessa già compilata (partita, campionato, mercato, selezione, quota, probabilità, note); le bollette di Betwin arrivano come multipla con tutte le selezioni. In alternativa *Incolla segnale* legge il testo copiato da Telegram (anche più partite nello stesso messaggio) e, con l'app installata su Android, BankBet compare nel menu *Condividi*. La fonte resta sulla scommessa ed è analizzabile in Statistiche.
- **Strumenti**: calcolatore Kelly, margine del bookmaker e quote eque, valore atteso (EV), surebet/dutching.
- **Statistiche**: yield, ROI, win rate, drawdown massimo, serie, CLV e confronto tra profitto atteso e reale; profitto mensile; analisi per sport, competizione, mercato, bookmaker, strategia, fascia di quota, tag, giorno della settimana.
- **Gestione del rischio**: stop-loss giornaliero e settimanale, stop-win giornaliero, obiettivo mensile.
- **Aspetto**: tema scuro predefinito, chiaro o automatico.
- **Dati**: salvati nel browser; backup/ripristino JSON, esportazione CSV (compatibile con Excel in italiano), sincronizzazione opzionale tra dispositivi tramite un repository GitHub privato.

## Link per i segnali

Qualsiasi script può aprire BankBet con una scommessa precompilata usando un link così (parametri tutti facoltativi, valori codificati per URL):

```
https://sbarbaorama.github.io/bankbet/#new?src=totalcorner&ev=Inter%20-%20Milan&comp=Serie%20A&sport=Calcio&mkt=1X2&sel=1&odds=1.85&prob=58&date=2026-10-19&tags=live&note=...&book=Snai
```

Per una multipla si aggiunge `legs`, un array JSON di selezioni `{"e": evento, "m": mercato, "s": scelta, "o": quota}` (almeno due): BankBet apre il modulo con *Multipla* attiva e la quota totale calcolata.

## Dove stanno i dati

Il codice dell'app è pubblico, i dati no: vivono nel browser di ogni dispositivo e, se attivi la sincronizzazione, in un file `bankbet.json` dentro un **repository privato** separato. Il token GitHub è salvato solo sul dispositivo e non finisce mai nei dati sincronizzati.

Configurazione della sincronizzazione (in app: *Bankroll → Sincronizzazione GitHub*):

1. Crea un repository **privato** (es. `bankbet-data`) con un README, così esiste il branch `main`.
2. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
3. *Repository access*: solo il repository dei dati. *Permissions → Contents*: **Read and write**. Nient'altro.
4. Inserisci utente, repository e token nell'app, su ogni dispositivo.

Le modifiche fatte su dispositivi diversi vengono unite record per record (vince la modifica più recente); anche le cancellazioni si propagano.

## Installazione

- **PC**: apri l'indirizzo dell'app in Chrome o Edge e usa l'icona "Installa" nella barra degli indirizzi.
- **Android**: apri l'indirizzo in Chrome → menu ⋮ → *Aggiungi a schermata Home* / *Installa app*.

## Sviluppo locale

Nessuna dipendenza né build: sono file statici.

```bash
python -m http.server 8765
```

Poi apri http://localhost:8765. Dopo aver pubblicato una nuova versione, aggiorna `CACHE` in `sw.js`; l'app si aggiorna al riavvio successivo.

---

Gioca responsabilmente. Nessun metodo di staking crea un vantaggio: Kelly, Masaniello e i cicli gestiscono il rischio (le progressioni lo aumentano), ma il risultato atteso dipende solo dal valore delle tue giocate. Il simulatore serve proprio a vederlo prima di rischiare denaro vero.
