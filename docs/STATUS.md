# Stato

> Passaggio di consegne: vedi `docs/HANDOFF.md`.

- **Fase:** 8 completa, tag `phase-8` creato. Tag pubblicati: `phase-0`..`phase-3`, `phase-6`, `phase-7`, `phase-8`; `phase-4` e `phase-5` senza tag. Versione 1.0.0 (D-262) da fare.
- **Onda:** ondate 1–13 unite in `main`. Ondata 13 (D-477..D-491): gap di X7, X8 e w12, funzione 49 (Z1), Mappa (K1, L1, K2), gruppi di ricerca, "Raggruppa per", famiglie di tag. Nessun lavoro in corso.
- **HEAD:** `main` a `c2ce253` (ultimo commit pubblicato). Il commit di documentazione di questo aggiornamento viene subito dopo.
- **Fatto** (in `main` fino a `c2ce253`):
  - Fasi 0–8 complete nel codice; fasi 0–3, 6, 7 e 8 con tag. Dettagli in `docs/HISTORY.md`.
  - Ondata 13: lacune di X7 (Cerca prove, PDF del resoconto, scelta del modello), X8 (istituzioni e menu dei gruppi) e w12 (motivo di esclusione) chiuse (D-477).
  - Funzione 49 fatta (Z1a–Z1c): manoscritto ↔ fonti, con proposte di sezioni dall'AI (`docs/design/ARCHITETTURA-UI.md` §18, D-478..D-485).
  - Mappa: molle pesate, archi per peso, contorni tolti, colori per macro-area (K1); trovatore di collegamenti locale con soglia, collegamenti rimovibili, avanzamento e annullamento (L1); lacune di M4 chiuse (K2).
  - Gruppi di ricerca come tag `grp:` (D-488); "Raggruppa per" con famiglie, incluse Automatica (Louvain + TF-IDF) e "Dai un nome con Claude" (D-489).
  - Verifica su una copia dei dati reali: macro-aree casuali da tassonomia piatta corrette (D-490).
  - Famiglie di tag nella gestione dei tag, limite di 8 tag nella Mappa con "+N", legenda ripiegabile, colori dominanti più marcati, un solo nome per cluster (D-491).
  - Budget non più vincolanti (D-487); test di bomba zip/stream rimossi (D-476); scrittura PDF attiva (D-473); eseguibile di Claude non incluso (D-474); prove su dati reali tolte dalla to-do (D-475).
  - Test: unitari ed e2e verdi tranne `qa-budget` `firstContentMs` (instabile, noto); heavy verdi.
- **In corso:** nulla.
- **Bloccato:** nulla di bloccante. Le domande aperte all'utente non bloccano (`docs/HANDOFF.md`, sezione 7).
- **Prossimo (in ordine):**
  1. Installer finale (rifare `npm run dist` con la versione finale; senza eseguibile di Claude, D-474).
  2. Versione 1.0.0 (D-262).
  3. Tag `v1.0.0`.
  - Dopo 1.0: piccole lacune note e feedback dell'utente (`docs/HANDOFF.md`, sezione 5; D-475).
- **Budget:** tetti in `CLAUDE.md`, non più rigidi (D-487); ogni nuovo chunk del renderer ha un tetto di 16 KiB (`renderer.chunkCapsKB`, D-465).
- **Da ricordare:** test pesanti solo uno alla volta; e2e in parallelo solo con cartelle `--output` separate; con poca RAM libera la suite e2e si ferma da sola (mem-sample). Installer: `pdfjs-dist` e `fflate` esterni al bundle del main (D-052), Fuses di Electron; eseguibile di Claude Code non incluso (D-474).
