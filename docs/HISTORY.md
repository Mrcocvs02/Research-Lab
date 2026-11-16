# Cronologia

Sintesi per fasi e onde; i dettagli stanno in git, `DECISIONS.md` e `STATUS.md`.

## 2026-11-15
- Avvio dal piano: repository in `C:\dev\research-lab`, Node.js 26 LTS installato con winget, piano copiato in `docs/PLAN.md`.
- **Fase 0, onda 0.1 (architect):** monorepo npm, contratti zod in `packages/core`, IPC tipizzato e validato, guscio Electron sicuro (contextIsolation, sandbox, CSP, protocollo `rl-app://`), spike SQLite: `node:sqlite` con FTS5 funziona in Node e in Electron (D-007).
- **Fase 0, onda 0.2:** archivio dati e importatore del vecchio indice (`packages/data`); procedura guidata e impostazioni; testkit, verifiche di generalità e non distruzione.
- **Fase 0, revisione:** reviewer e security senza bloccanti; corretti patch parziali delle impostazioni, collisioni di slug, scritture concorrenti, variabili di test e URL di sviluppo attivi nell'app installata. Tag `phase-0`.
- **Fase 1, onda 1.1:** scanner incrementale, estrattore (pdfjs-dist, fflate), osservatore; indice FTS5 con pagine; runtime nel main con worker; vista di ricerca; corpus sintetico da 1000 documenti.

## 2026-11-16
- **Fase 1, revisione:** il security trova 4 bloccanti da documenti ostili (worker senza watchdog, ReDoS su DOI e docx/pptx, zip bomb); corretti in tre rami e ricontrollati.
- **Crash del PC** durante la suite e2e in parallelo con prove "bomba" del security: introdotti controllo della memoria (`tools/mem-guard.mjs`, `tools/mem-sample.mjs`), test pesanti dietro `RL_HEAVY_TESTS`, regola "uno alla volta".
- **GitHub:** storia riscritta senza righe `Co-Authored-By`, agganciata al commit iniziale del repository remoto e pubblicata; da qui push a ogni passo. Tag `phase-1`.
- Nuove regole dell'utente: subagent Haiku per compiti molto semplici; app il più leggera possibile; finestre dei test e2e fuori schermo (nascoste del tutto rallentavano i test di 10 volte).
- **Fase 2:** contratti (tassonomia, cronologia, progetti, modifica e apertura documenti, albero cartelle); backend con annulla/ripeti e progetti archiviabili; interfaccia di navigazione (elenco/griglia virtualizzati, filtri, tag in blocco, gestione tassonomia, scheda documento, cronologia, progetti con piano di lettura); ordinamento per dimensione, filtri lato server, cache invalidata.
- **Fase 2, revisione:** nessun bloccante; corretti apertura file con lista permessa, annulla limitato ai campi utente e senza cicli o tag orfani, indice aggiornato dopo cambi di tassonomia da un altro PC, letture limitate, tag in blocco per id, coda delle scritture di tassonomia, selezione per id, piano di lettura coerente.
- Line ending normalizzati a LF (`.gitattributes`). Il test di importazione reale ora distingue i documenti importati da quelli arrivati dopo il vecchio indice.
- Regola dell'utente: la funzionalità viene prima della leggerezza (RULES.md). **Giro di leggerezza** unito: JS iniziale 1202 -> 350 KiB, worker su richiesta, budget automatici; main lasciato leggibile negli stack trace (D-177). Trovato un limite preesistente: le azioni in blocco accettano 5000 documenti mentre Ctrl+A ne seleziona fino a 50000; correzione affidata al ramo `p2-bulk`.
- **Azioni in blocco** unite (`p2-bulk`): limiti condivisi senza zod nel renderer, tag su 50000 documenti con lettura a gruppi, riassunto del registro una volta per gruppo; in revisione corretto `undoOf` (resta su ogni voce perché la catena annulla/ripeti non si rompa). Suite completa verde: 734 unitari, 38/38 e2e.
