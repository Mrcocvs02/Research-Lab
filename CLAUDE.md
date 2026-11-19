# Research Lab — guida per Claude Code

App desktop (Electron + React + TypeScript, monorepo npm) che organizza librerie di documenti di ricerca. Piano completo in `docs/PLAN.md` (fasi 0–8 con criteri di accettazione).

## Da dove ripartire (sempre, anche dopo una compattazione del contesto)
1. `docs/STATUS.md`: fase, onda, cosa è fatto, in corso, bloccato, prossimo.
2. `docs/HISTORY.md`: cronologia sintetica di fasi, revisioni ed eventi.
3. `docs/RULES.md`: regole assolute, generalità, commit, risorse della macchina, leggerezza.
4. `docs/DECISIONS.md`: decisioni numerate (D-xxx); `docs/ARCHITECTURE.md`, `docs/TESTING.md`.
5. `CLAUDE.local.md` (non versionato): dettagli di questa macchina.

## Come si lavora
- L'agente principale solo supervisiona: scrive gli incarichi, integra, verifica i diff, fa commit e push. Non scrive funzioni né test.
- Modelli, scelti per compito:
  - **Sonnet** (subagent) per logica, interfacce, revisioni e sicurezza. Nel dubbio, Sonnet.
  - **Haiku** (subagent) per il lavoro meccanico: worktree e junction di `node_modules`, controlli di budget e generalità, traduzioni it ↔ en, aggiornamento di STATUS, HISTORY, HANDOFF e DECISIONS da un elenco di fatti dato dall'agente principale.
  - **Coppia Opus** (architetto e revisore avversario visivo) solo per le decisioni di design dell'interfaccia; poi Sonnet implementa. Al massimo 2 round di design; i testid si fissano nel piano di design.
- Ogni incarico è autosufficiente (obiettivo, contesto, file di proprietà, criteri, vincoli, rapporto di massimo 150 parole). Il brief rimanda solo a `CLAUDE.md` e alla sezione di design del task. I subagent non fanno mai push.
- Al massimo 2 subagent insieme, su file disgiunti. Se si raggiunge il limite d'uso di Claude, si riprende lo stesso subagent con SendMessage dopo il ripristino, senza avviarne uno nuovo.
- Worktree in `C:\dev\rl-wt\<ramo>`, su un ramo dedicato. In ogni worktree `node_modules` è una junction verso quello del repository principale (`New-Item -ItemType Junction`); non cancellarla mai. Poiché `node_modules/@rl/*` punta ai pacchetti del repository principale, un task che cambia `packages/*` verifica typecheck e build con alias temporanei, che rimuove prima di consegnare.
- Merge su `main` da parte dell'agente principale, con solo `npm run typecheck`, `npm run build`, `npm run check:budget`, `npm run check:generality`. In caso di conflitto di merge in elenchi di canali o di handler si tengono entrambi i lati.
- Regola dei test (D-443): durante le ondate si eseguono solo quei quattro comandi. I task scrivono i loro test ma non li eseguono. Revisioni, correzioni e tutti i test si fanno una volta sola alla fine dell'implementazione; i test pesanti uno alla volta. Prima controllare la RAM libera; dopo gli e2e chiudere gli `electron.exe` rimasti da `C:\dev\research-lab\node_modules\electron`.
- Budget: l'app deve restare il più leggera possibile, ma i tetti in KiB non sono vincolanti (D-487): un tetto si alza quando serve, con una voce in `docs/DECISIONS.md`. Tetti attuali (KiB): JS iniziale del renderer 396, entry del main 1120, JS totale del renderer 2250, totale del renderer 2420, lazy del main 475. Ogni nuovo chunk del renderer ha un tetto di 16 KiB in `renderer.chunkCapsKB` (D-465). Il codice nuovo del main va in chunk pigri quando è naturale (≤ 30 KiB ciascuno).
- Nessuna domanda bloccante quando si lavora senza supervisione (per esempio di notte): decidere, registrare in `docs/DECISIONS.md`, proseguire.
- Aggiornare `docs/STATUS.md`, `docs/HISTORY.md` e `docs/HANDOFF.md` una sola volta per onda (non a ogni merge), alla fine dell'onda e prima di fermarsi.
- A fine di ogni fase: reviewer indipendente e security (potere di blocco), correzioni, suite completa, tag `phase-N`.

## Commit
- Remoto `origin` (GitHub), ramo `main`; push dopo ogni merge o correzione.
- Mai righe `Co-Authored-By` né Claude indicato come coautore. Identità git: quella locale del repository.
- Codice, commenti e commit in inglese; documentazione in italiano.

## Comandi
- `npm test` — unitari (Vitest, max 3 worker, controllo memoria).
- `npm run test:e2e` — Playwright su Electron (finestre fuori schermo; `RL_E2E_SHOW=1` per vederle).
- `npm run test:heavy`, `npm run test:e2e:heavy` — benchmark e file ostili (`RL_HEAVY_TESTS=1`), uno alla volta.
- `npm run typecheck`, `npm run build`, `npm run dev`, `npm run check:generality`.
- In Git Bash: `export PATH="/c/Program Files/nodejs:$PATH"` prima di node/npm.

## Vincoli che non si negoziano
Originali mai spostati, rinominati o cancellati e mai alterati, salvo l'aggiunta incrementale di annotazioni PDF standard fatte dall'utente nel lettore (D-316, scelta dell'utente: prefisso originale intatto, copia di sicurezza, ripristino sempre possibile); scritture solo nella cartella dati della libreria (eccezioni: la copia confermata dalla cartella di arrivo, D-217, e le annotazioni nel PDF, D-316); segreti solo nell'archivio sicuro; invio all'AI solo per cartelle abilitate; output AI separato dalle note dell'utente; nessun nome, percorso o cartella reale nel codice e nei test; codice leggero ed efficiente, ma la funzionalità viene prima della leggerezza.

## Compattazione automatica
Configurata in `.claude/settings.local.json` (non versionato) della cartella di lavoro: soglia al 60% del contesto (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`), compattazione anche durante l'inattività. L'hook `tools/claude-hooks/compact-hook.mjs` salva lo stato in `.claude/last-compact.md` prima di compattare (PreCompact) e lo restituisce con l'elenco dei file da rileggere subito dopo (SessionStart `compact`).

## Compact instructions
Quando compatti il contesto conserva, in quest'ordine:
- fase e onda correnti (fase 8: prova di installazione in corso; ondate 1–12 unite, verifica finale fatta), ultimo commit su `main` (`6d2018e`) e tag di fase già creati (`phase-0`..`phase-3`, `phase-6`, `phase-7`; `phase-4`, `phase-5`, `phase-8` senza tag; poi `phase-8` e `v1.0.0`);
- nessun subagent in corso e nessun ramo non unito; funzione 49 rinviata dopo 1.0 (D-472, D-475);
- difetti aperti dalle revisioni (lacune di M4, X7, X8, w12 in `docs/HANDOFF.md`, sezione 5);
- preferenze dell'utente: subagent Sonnet per logica, interfacce, revisioni e sicurezza; Haiku per il lavoro meccanico (worktree, controlli, docs di stato, traduzioni); coppia Opus solo per il design; al massimo 2 subagent insieme; test solo alla fine, quelli pesanti uno alla volta; niente coautore Claude nei commit, identità locale, push a ogni passo; nessuna domanda bloccante; app leggera ma senza togliere funzioni utili;
- decisioni prese nella sessione ma non ancora scritte in `docs/DECISIONS.md`.
Tralascia l'output completo di test, diff e log: restano in git e nei file `docs/`.
