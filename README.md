# BankBet

Web app (PWA) per registrare scommesse e gestire il bankroll. Funziona su PC e su Android (installabile come app), anche offline.

## Funzioni

- **Registro scommesse**: evento, sport, competizione, mercato, selezione, bookmaker, quota, puntata, esito (vinta, persa, rimborsata, mezza vinta/persa, cashout), tag e note. Chiusura rapida dell'esito con un tocco, ricerca e filtri, duplicazione.
- **Bankroll**: depositi e prelievi, saldo e disponibile (al netto delle puntate in corso), grafico dell'andamento e profitto mensile.
- **Staking**: puntata suggerita in base alla strategia scelta:
  - *Flat*: percentuale fissa del bankroll;
  - *Kelly*: frazione configurabile (pieno, ½, ¼, 1/10) con tetto massimo;
  - *Masaniello*: cicli con N eventi / K vincenti / quota media, puntate ricalcolate dopo ogni esito e sulla quota reale, griglia completa delle puntate.
- **Strumenti**: calcolatore Kelly, margine del bookmaker e quote eque, valore atteso (EV), surebet/dutching.
- **Statistiche**: yield, ROI, win rate, drawdown massimo, serie, CLV (closing line value) e confronto tra profitto atteso e reale; analisi per sport, competizione, mercato, bookmaker, strategia, fascia di quota, tag, giorno della settimana.
- **Gestione del rischio**: stop-loss giornaliero e settimanale con avviso.
- **Dati**: salvati nel browser; backup/ripristino JSON, esportazione CSV (compatibile con Excel in italiano), sincronizzazione opzionale tra dispositivi tramite un repository GitHub privato.

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

Gioca responsabilmente. Nessun metodo di staking crea un vantaggio: Kelly e Masaniello gestiscono il rischio, ma il risultato dipende solo dal valore delle tue giocate.
