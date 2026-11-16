# Stato

- **Fase:** 3 — lettore PDF, annotazioni, note, miniature (da avviare)
- **Onda:** 3.1 — lettore, annotazioni, note (contratti D-184 su main)
- **Fatto:**
  - Fasi 0, 1 e 2 chiuse (tag `phase-0`, `phase-1`, `phase-2`).
  - Fase 2: backend (tassonomia a livelli liberi, tag in blocco, modifica documenti, apertura file con lista permessa, annulla/ripeti, progetti e collezioni, albero cartelle), interfaccia completa, ordinamento per dimensione, filtri lato server, correzioni da reviewer e security.
  - Giro di leggerezza (D-170..D-177) unito: JS iniziale del renderer 1202 -> 350 KiB, viste su richiesta, dizionario solo della lingua attiva, worker avviato su richiesta e chiuso dopo 60 s di inattività, canale `documents:ids`, interruttore "Mostra documenti mancanti", budget automatici (`npm run check:budget`, `e2e/qa-budget.spec.ts`). Nessuna funzione tolta; main non minificato per stack trace leggibili; pannello di dettaglio prelevato a riposo.
  - Azioni in blocco su selezioni grandi (D-178..D-181): tag fino a 50000 documenti in una sola modifica con un solo annulla, progetti fino a 20000 membri con messaggio chiaro, avviso se Ctrl+A supera 50000, stato di attesa; nel registro il riassunto compare una volta per gruppo, `undoOf` su ogni voce.
  - Revisione del delta (leggerezza e azioni in blocco): nessun bloccante; corretti gruppi del registro letti a metà (mai annullati a metà, D-182), ErrorBoundary e un nuovo tentativo per le viste su richiesta, ciclo di vita del worker (D-183).
  - Verifiche finali di fase 2 (2026-11-16): 747 test unitari verdi; e2e 38/38 (inclusa importazione reale); budget rispettati (JS iniziale 353 KiB, memoria a riposo ~435 MB, primo contenuto ~430 ms, misurato come il migliore di due avvii).
- **In corso:** due subagent in parallelo (junction in `node_modules` da rimuovere con `rmdir` prima di togliere i worktree):
  - `p3-main` (`../rl-wt/p3-main`): main e dati — schema `rl-doc` con intervalli e confinamento, `reader:open`/`openLink`, note con conflitto, annotazioni con flag sottolineato, reindicizzazione, e2e `study-data` (unico che esegue e2e). Decisioni D-185..D-189.
  - `p3-ui` (`../rl-wt/p3-ui`): renderer — lettore pdf.js su richiesta, evidenziazioni/sottolineature, note per file e pagina, stato di studio, etichette dei risultati nelle note; scrive `e2e/study-ui.spec.ts` senza eseguirlo. Decisioni da D-190.
- **Bloccato:** —
- **Prossimo (in ordine):**
  1. Merge di `p3-main` e `p3-ui`, e2e `study-data` e `study-ui`, suite completa; poi onda 3.2: miniature della griglia (contratti da scrivere), revisione e security di fase 3, tag `phase-3`.
- **Da ricordare:** installer (fase 8): `pdfjs-dist` e `fflate` esterni al bundle del main (D-052), Fuses di Electron; test pesanti solo uno alla volta; con poca RAM libera la suite e2e si ferma da sola (mem-sample): far liberare memoria all'utente e rieseguire solo i test mancanti.
