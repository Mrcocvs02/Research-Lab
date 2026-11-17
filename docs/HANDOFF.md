# Passaggio di consegne (HANDOFF)

Questo file serve a riprendere il lavoro su Research Lab da una chat nuova di Claude Code, che non conosce la sessione precedente.

## 1. Scopo del file

Stato di passaggio per riprendere il lavoro dalla chat originale. Prima di fare qualunque cosa, leggere in quest'ordine:

1. `CLAUDE.md` (regole di lavoro, modelli per compito, commit, comandi);
2. `docs/STATUS.md` (fase, onda, fatto, in corso, bloccato, prossimo);
3. `docs/HISTORY.md` (cronologia di fasi, revisioni ed eventi);
4. `docs/DECISIONS.md` (le ultime voci D-280..D-300 e quelle successive).

Se questo file e `docs/STATUS.md` non coincidono, vale `docs/STATUS.md`; questo file va poi aggiornato.

## 2. Aggiornato

- Data: 2026-11-17.
- Ultimo merge su `main` con codice di fase 8: `838945d` (p8-fix-final). I file di stato sono stati aggiornati con il commit "docs: phase 8 implemented, reviewed and fixed; unit suite green; e2e pending"; il suo hash si legge con `git -C C:/dev/research-lab log --oneline -1`.
- Commit non pubblicato: il push su `origin` non e stato fatto in questa sessione.

## 3. Cosa e successo in questa sessione

La chat originale ha esaurito i crediti; questa sessione di ripresa ha fatto quanto segue.

- Le istruzioni incollate dall'utente erano vecchie: l'onda 4.2 era gia unita (2c51120 e b98783d), le e2e `inbox.spec.ts` e `ai-review.spec.ts` esistono gia e i worktree p42 sono gia stati rimossi. Si e ripartiti dallo stato reale del repository, non dalle istruzioni incollate.
- Fase 6: revisione indipendente e di sicurezza rifatte (0 bloccanti, 10 importanti), tutte corrette in `p6-fix` (D-248, D-249).
- Fase 7, lato main: export del second brain e server MCP (D-246, D-247). Lato interfaccia: D-250, D-251. Revisioni: 1 bloccante e 15 importanti, con scelte di prodotto in D-252 e D-253 e correzioni in D-254. L'e2e del criterio di fase 7, `e2e/export-mcp.spec.ts`, e verde.
- Verifiche: 1592 unitari verdi, typecheck e build verdi, budget rispettati (JS iniziale 373,6/391 KiB; renderer 1500/1560 KiB; main 940/950 KiB).
- Fase 8 (D-280..D-300): implementata, revisionata e corretta; unita in `main` (e1de2a6, e9294e7, 2148e89, 838945d). Suite unitaria 1687 passati, 12 saltati, 0 falliti; typecheck, build e generalita verdi; budget rispettati (JS iniziale 379,5/391 KiB, renderer 1573,6/1600 KiB, main 1007/1010 KiB: margine del main di soli 3 KiB). Worktree temporanei rimossi; `C:\dev\rl-wt` vuota.

## 4. Test rimandati alla fine

Decisione dell'utente del 2026-11-17. Eseguirli quando la macchina ha almeno circa 4 GiB di RAM libera (chiudere Chrome e VS Code), in quest'ordine:

1. `e2e/network.spec.ts`: esteso in `p6-fix`, mai eseguito; con 2,5 GiB liberi si ferma da solo.
2. La suite completa `npm run test:e2e`, mai eseguita dopo i merge di fase 6, 7 e 8 (include il nuovo `e2e/backup-restore.spec.ts`).
3. I test pesanti (`npm run test:heavy`, `npm run test:e2e:heavy`), uno alla volta, con `RL_HEAVY_TESTS=1`.
4. `npm run dist:test-dir` e poi `e2e/packaged-app.spec.ts` (build di prova dell'app impacchettata).
5. Poi i tag `phase-6`, `phase-7` e `phase-8` (e versione 1.0.0 secondo D-262) se verdi.

Se la RAM libera non basta, la suite si ferma da sola: rieseguire solo i test mancanti, mai due pesanti insieme.

## 5. In corso

Nessun lavoro in corso. Fase 8 implementata, revisionata e corretta; restano le verifiche della sezione 4.

Prima di riprendere, verificare lo stato reale: controllare `git branch`, `git status` e `git log` su `main`, e che non ci siano worktree residui.

## 6. Come lavorare (preferenze dell'utente)

- L'agente principale fa solo da supervisore: scrive gli incarichi, integra, verifica i diff, fa commit e push.
- Il lavoro lo fanno subagent scelti per costo:
  - Haiku per il meccanico: stato, worktree, esecuzione dei test, aggiornamento di STATUS, HISTORY e DECISIONS;
  - Sonnet per logica, interfaccia, revisioni e sicurezza. Nel dubbio, Sonnet.
- Al massimo 2 subagent insieme; uno solo con test pesanti.
- Commit: mai la riga `Co-Authored-By` e mai Claude indicato come coautore. Identita git: quella locale del repository.
- Push su `origin main` a ogni passo (commit piccoli, uno per volta).
- Nessuna domanda bloccante: decidere, registrare in `docs/DECISIONS.md` e `docs/STATUS.md`, proseguire.
- Questo file va aggiornato a ogni traguardo, da un subagent Haiku.
- Codice, commenti e commit in inglese; documentazione in italiano.
- L'app deve restare leggera: poche dipendenze, viste caricate su richiesta, worker su richiesta, budget misurati. Verifica: `npm run check:budget`.
- Non togliere funzioni per fare spazio alla leggerezza.

Comandi utili (in Git Bash, prima: `export PATH="/c/Program Files/nodejs:$PATH"`):

- `npm test` (unitari);
- `npm run typecheck`, `npm run build`, `npm run check:generality`;
- `npm run test:e2e` (Playwright su Electron, finestre fuori schermo; `RL_E2E_SHOW=1` per vederle).

## 7. Domande aperte per l'utente

Da porre all'utente quando serve, senza bloccare il lavoro: decidere quanto possibile e registrare.

- Fase 4, criteri su dati reali:
  - 5 paper campione con almeno l'80% dei tag accettati (lavoro AI con Claude vero e revisione);
  - un PDF vero trascinato nella cartella di arrivo in meno di un minuto, con i metadati giusti;
  - prova della chat su una cartella reale della libreria, scelta dall'utente.
- Fase 5, prova sulla libreria reale: mandare i DOI dei paper dell'utente a OpenAlex. Serve il consenso dell'utente.
- Prova facoltativa di fase 7 con Claude Code vero (export aperto da Claude Code e server MCP aggiunto con la riga copiata): usa l'account dell'utente, quindi chiedere prima.
- Installer (fase 8): includere o no l'eseguibile di Claude Code da circa 356 MB dell'Agent SDK (D-203). Non includerlo senza conferma.

Nota: con Haiku a ragionamento basso, una domanda breve in inglese puo ricevere risposta in italiano; controllare la lingua.
