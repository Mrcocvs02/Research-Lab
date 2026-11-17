# Passaggio di consegne (HANDOFF)

Questo file serve a riprendere il lavoro su Research Lab da una chat nuova di Claude Code, che non conosce la sessione precedente.

## 1. Scopo del file

Stato di passaggio per riprendere il lavoro dalla chat originale. Prima di fare qualunque cosa, leggere in quest'ordine:

1. `CLAUDE.md` (regole di lavoro, modelli per compito, commit, comandi);
2. `docs/STATUS.md` (fase, onda, fatto, in corso, bloccato, prossimo);
3. `docs/HISTORY.md` (cronologia di fasi, revisioni ed eventi);
4. `docs/DECISIONS.md` (le ultime voci D-280..D-306 e quelle successive).

Se questo file e `docs/STATUS.md` non coincidono, vale `docs/STATUS.md`; questo file va poi aggiornato.

## 2. Aggiornato

- Data: 2026-11-17.
- Ultimo merge su `main`: `c40cb01` (p8-fix-e2e, D-305, D-306), verifica finale verde su questo commit. Tag `phase-6` e `phase-7` creati su `c40cb01` e pubblicati su `origin`.
- Installer di rilascio costruito (`apps/desktop/release/ResearchLab-Setup-0.0.0.exe`, 131 MB, non firmato) e copiato in `C:UsersPublic`, con due librerie di prova generate in `C:UsersPublicRL-prova` (`libreria-it`, `libreria-en`).
- Rami di lavoro aperti (NON uniti): `design-arch` e `design-audit`, pubblicati su `origin` come copia di sicurezza.

## 3. Cosa e successo in questa sessione

La chat originale ha esaurito i crediti; questa sessione di ripresa ha fatto quanto segue.

- Le istruzioni incollate dall'utente erano vecchie: l'onda 4.2 era gia unita (2c51120 e b98783d), le e2e `inbox.spec.ts` e `ai-review.spec.ts` esistono gia e i worktree p42 sono gia stati rimossi. Si e ripartiti dallo stato reale del repository, non dalle istruzioni incollate.
- Fase 6: revisione indipendente e di sicurezza rifatte (0 bloccanti, 10 importanti), tutte corrette in `p6-fix` (D-248, D-249).
- Fase 7, lato main: export del second brain e server MCP (D-246, D-247). Lato interfaccia: D-250, D-251. Revisioni: 1 bloccante e 15 importanti, con scelte di prodotto in D-252 e D-253 e correzioni in D-254.
- Fase 8 (D-280..D-300): implementata, revisionata e corretta; unita in `main`. Il primo giro e2e su `main` ha trovato 4 fallimenti (scheda di benvenuto sopra i controlli, primo contenuto 650 ms contro 530): corretti in `p8-fix-e2e` (D-305, D-306), unito in `c40cb01`.
- Verifica finale del 2026-11-17 su `c40cb01`, un test pesante alla volta: unitari 1687 passati / 12 saltati; `network.spec.ts` verde; e2e completo 50 passati / 6 saltati (quelli saltati girano a parte o chiedono la libreria reale o Claude vero); test pesanti verdi; app impacchettata e release verdi. Budget rispettati, con il main quasi al limite (~1009/1010 KiB). Dettagli in `docs/HISTORY.md`.

## 4. Test: eseguiti

I test rimandati nelle versioni precedenti del file sono stati eseguiti il 2026-11-17 su `c40cb01`, con esito verde (dettagli in `docs/STATUS.md`). Restano da fare solo le prove dell'utente.

Se in futuro la RAM libera non basta, la suite si ferma da sola: rieseguire solo i test mancanti, mai due pesanti insieme.

## 5. In corso: riprogettazione dell'interfaccia (2026-11-17 sera)

Richieste dell'utente dopo aver provato l'app (da soddisfare tutte):
- grafica poco attraente; impostazioni molto confuse; navigazione difficile; tutto piu chiaro e ordinato;
- una sezione "Sviluppatore / Avanzate" con tutte le impostazioni non predefinite e tecniche;
- cambiare account Claude in modo facile; scansione piu facile da trovare e fare;
- la notifica sulla cartella di arrivo non si capisce;
- lettore: il PDF appare stirato in orizzontale (difetto); annotazioni a STRUMENTI: prima si sceglie lo strumento (sposta, evidenziatore, sottolineatura, colore) poi si passa sul testo; la barra spaziatrice alterna lo strumento attuale e l'ultimo usato;
- **DECISIONE DELL UTENTE**: evidenziazioni e sottolineature vanno SCRITTE NEL PDF ORIGINALE (devono vedersi in Chrome). Cambia la regola 1 solo per questo caso: aggiunta in coda di annotazioni PDF standard (aggiornamento incrementale, byte esistenti mai riscritti), copia di sicurezza dell'originale prima della prima scrittura, scrittura atomica, PDF cifrati/firmati esclusi, interruttore per libreria (acceso di default), comando "ripristina originale". Attenzione all'identita per hash (annotazioni, miniature, cache, duplicati). Area da revisione di sicurezza dedicata. RULES.md e CLAUDE.md vanno aggiornati con l'eccezione.
- la ricerca funziona bene: va tenuta.
- "fai tu i test della fase 8": l'agente fara installazione silenziosa in una cartella temporanea, avvio, disinstallazione e controllo dei dati (salvando e ripristinando prima le impostazioni dell'account dell'utente); il secondo account Windows non e accessibile all'agente.

Metodo scelto dall'utente: le scelte di struttura e grafica le fanno DUE subagent **Opus 5.5**:
1. **architetto designer**, worktree `C:devl-wtdesign-arch` (ramo `design-arch`): scrive `docs/design/ARCHITETTURA-UI.md` (architettura dell'informazione, navigazione, sistema visivo, mappa delle impostazioni vecchie -> nuove, account Claude, scansione, notifiche, lettore a strumenti, scrittura nel PDF, piano di implementazione a ondate per subagent Sonnet), decisioni da D-310; nessuna modifica al codice dell'app in questo giro;
2. **designer avversario**, worktree `C:devl-wtdesign-audit` (ramo `design-audit`): avvia l'app con Playwright su librerie sintetiche, fotografa ogni vista e dialogo (chiaro/scuro, 1280x800, 1920x1080, 1024x700; immagini in `audit-shots/`, mai committate), prova ogni funzione, scrive `docs/design/AUDIT.md` e `e2e/design-audit.spec.ts` (saltato senza `RL_DESIGN_AUDIT=1`), con la causa del PDF stirato.

Stato al momento della pausa (tutto salvato e pubblicato su `origin`):
- `design-arch` @ `32e13c8`: `ARCHITETTURA-UI.md` COMPLETO, decisioni D-310..D-324, regola 1 riscritta in `RULES.md` e `CLAUDE.md` del ramo (D-316, scelta dell'utente). Causa del PDF stirato: la classe `.page` dell'app (`styles.css` ~451-454, max-width 860px) si scontra con quella di pdf.js; inoltre `pdf_viewer.css`, importato globalmente in `engine.ts:2`, cambia gli stili `.sidebar` e `.dialog` dell'app. Piano in 7 ondate (0..6); budget proposti: main 1060 KiB, renderer 1640 KiB.
- `design-audit` @ `7243a1e`: `AUDIT.md` PARZIALE (marcato DA COMPLETARE) ed `e2e/design-audit.spec.ts`; 141 screenshot del giro italiano in `C:\dev\rl-wt\design-audit\audit-shots\run1\` (non versionati). Mancano: giro inglese, pannello di dettaglio del documento, misura dello spostamento delle evidenziazioni a 1920, export completo, MCP acceso, backup e ripristino, registratore delle scorciatoie. Per riprendere: spostare gli screenshot esistenti in una sottocartella, `npm run build`, poi `RL_DESIGN_AUDIT=1 npx playwright test -c e2e/playwright.config.ts e2e/design-audit.spec.ts`.
- Domande dell'architetto per l'utente, ancora senza risposta: (1) copia di sicurezza dei PDF annotati nella cartella dati sincronizzata o nella cartella locale dell'app; (2) nome dell'utente come autore nelle annotazioni, o nessun nome; (3) Esc non chiude piu il lettore; (4) consumo del mese nell'Account Claude per la libreria attiva o per tutte.

Passi successivi, in ordine:
1. completare i due documenti (riprendere i subagent Opus con il contenuto dei rami);
2. secondo giro: l'architetto rivede il progetto con AUDIT.md; il designer avversario attacca il progetto rivisto; versione finale;
3. implementazione a ondate con subagent Sonnet (al massimo 2 insieme, file distinti), poi revisioni indipendente e di sicurezza (scrittura nei PDF!);
4. test finali uno alla volta, poi i test di fase 8 fatti dall'agente, poi tag `phase-8` e versione 1.0.0.

Prima di riprendere, verificare lo stato reale: `git worktree list`, `git log` dei rami `design-arch` e `design-audit`.

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

- Fase 8, prova di installazione: `npm run dist` (installer mai costruito finora) e `docs/PROVA-INSTALLAZIONE.md` su un secondo account Windows. Poi tag `phase-8` e versione 1.0.0 (D-262).
- Fase 4, criteri su dati reali:
  - 5 paper campione con almeno l'80% dei tag accettati (lavoro AI con Claude vero e revisione);
  - un PDF vero trascinato nella cartella di arrivo in meno di un minuto, con i metadati giusti;
  - prova della chat su una cartella reale della libreria, scelta dall'utente.
- Fase 5, prova sulla libreria reale: mandare i DOI dei paper dell'utente a OpenAlex. Serve il consenso dell'utente.
- Prova facoltativa di fase 7 con Claude Code vero (export aperto da Claude Code e server MCP aggiunto con la riga copiata): usa l'account dell'utente, quindi chiedere prima.
- Installer (fase 8): includere o no l'eseguibile di Claude Code da circa 356 MB dell'Agent SDK (D-203). Non includerlo senza conferma. Nel frattempo la cartella di rilascio contiene anche `default_app.asar` di Electron: innocuo, si puo escludere.
- Aperte da prima: certificato di firma, icona definitiva, cifratura dei backup.

Nota: con Haiku a ragionamento basso, una domanda breve in inglese puo ricevere risposta in italiano; controllare la lingua.
