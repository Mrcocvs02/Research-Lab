# Passaggio di consegne (HANDOFF)

Questo file serve a riprendere il lavoro su Research Lab da una chat nuova di Claude Code, che non conosce la sessione precedente.

## 1. Scopo del file

Stato di passaggio per riprendere il lavoro dalla chat originale. Prima di fare qualunque cosa, leggere in quest'ordine:

1. `CLAUDE.md` (regole di lavoro, modelli per compito, commit, comandi);
2. `docs/STATUS.md` (fase, onda, fatto, in corso, bloccato, prossimo);
3. `docs/HISTORY.md` (cronologia di fasi, revisioni ed eventi);
4. `docs/DECISIONS.md` (le ultime voci: D-280..D-306, D-310..D-382 per il design dell'interfaccia, D-383..D-428 per P0 e le funzioni nuove, D-429 per R0).

Se questo file e `docs/STATUS.md` non coincidono, vale `docs/STATUS.md`; questo file va poi aggiornato.

## 2. Aggiornato

- Data: 2026-11-18 (notte).
- Ultimo merge su `main`: `dc1170f` (merge di `h0`: correzione dello stretch del PDF, D-346, D-347, D-354), preceduto da `14ceee1` (merge di `design-arch`) e `8000850` (merge di `design-audit`). Dopo H0: typecheck e `check:generality` verdi. Ramo `h0` pubblicato. Tag `phase-6` e `phase-7` su `c40cb01`, pubblicati su `origin`.
- Installer di rilascio costruito (`apps/desktop/release/ResearchLab-Setup-0.0.0.exe`, 131 MB, non firmato) e copiato in `C:UsersPublic`, con due librerie di prova generate in `C:UsersPublicRL-prova` (`libreria-it`, `libreria-en`). Costruito prima della progettazione, quindi da rifare dopo le ondate.
- Nessun ramo di lavoro aperto: `design-arch`, `design-audit` e `h0` sono uniti in `main`. Worktree ancora presenti, tutti già uniti e rimuovibili: `C:\dev\rl-wt\design-arch`, `C:\dev\rl-wt\design-audit`, `C:\dev\rl-wt\h0`.

## 3. Cosa e successo in questa sessione

La chat originale ha esaurito i crediti; questa sessione di ripresa ha fatto quanto segue.

- Le istruzioni incollate dall'utente erano vecchie: l'onda 4.2 era gia unita (2c51120 e b98783d), le e2e `inbox.spec.ts` e `ai-review.spec.ts` esistono gia e i worktree p42 sono gia stati rimossi. Si e ripartiti dallo stato reale del repository, non dalle istruzioni incollate.
- Fase 6: revisione indipendente e di sicurezza rifatte (0 bloccanti, 10 importanti), tutte corrette in `p6-fix` (D-248, D-249).
- Fase 7, lato main: export del second brain e server MCP (D-246, D-247). Lato interfaccia: D-250, D-251. Revisioni: 1 bloccante e 15 importanti, con scelte di prodotto in D-252 e D-253 e correzioni in D-254.
- Fase 8 (D-280..D-300): implementata, revisionata e corretta; unita in `main`. Il primo giro e2e su `main` ha trovato 4 fallimenti (scheda di benvenuto sopra i controlli, primo contenuto 650 ms contro 530): corretti in `p8-fix-e2e` (D-305, D-306), unito in `c40cb01`.
- Verifica finale del 2026-11-17 su `c40cb01`, un test pesante alla volta: unitari 1687 passati / 12 saltati; `network.spec.ts` verde; e2e completo 50 passati / 6 saltati (quelli saltati girano a parte o chiedono la libreria reale o Claude vero); test pesanti verdi; app impacchettata e release verdi. Budget rispettati, con il main quasi al limite (~1009/1010 KiB). Dettagli in `docs/HISTORY.md`.

## 4. Test: eseguiti

I test rimandati nelle versioni precedenti del file sono stati eseguiti il 2026-11-17 su `c40cb01`, con esito verde (dettagli in `docs/STATUS.md`). Restano da fare solo le prove dell'utente.

Dopo H0 (2026-11-18, un test pesante alla volta): unitari 1707 passati, 12 saltati, 1 fallimento instabile in `McpSection.test.ts` (PORT_IN_USE, con 2,1 GB di RAM libera; passa 17/17 da solo, da sistemare in R0); e2e `reader-geometry` 4/4, `study-ui` 1/1, `smoke` 4/4.

Se in futuro la RAM libera non basta, la suite si ferma da sola: rieseguire solo i test mancanti, mai due pesanti insieme.

## 5. Progettazione dell'interfaccia: chiusa (2026-11-17 notte)

La fase di progettazione è chiusa e non ci sono subagent attivi. P0 è approvato dall'utente (D-383). Wave H0 è fatta e unita (`dc1170f`). Il prossimo passo è R0, poi S1 ∥ S2 e le ondate 7-12 (punto 2 sotto).

Documenti:
- `docs/design/AUDIT.md`: audit dell'app con Playwright su librerie sintetiche, run in italiano e in inglese (run3 183 screenshot, run4-en 161, run5-en-reader). Gli screenshot stanno solo su disco in `C:\dev\rl-wt\design-audit\audit-shots`, non sono versionati.
- `docs/design/ARCHITETTURA-UI.md`: architettura finale (stato "finale", giro 3 chiuso), decisioni D-310..D-382 in `docs/DECISIONS.md`. Ondate di implementazione al §14; principi di composizione §1.1 (D-366); Mappa §4.20 (D-367, task M4).
- `docs/design/prototipo/index.html`: prototipo statico P0, un solo file, dati sintetici. Pubblicato all'utente come artifact privato.
- `RULES.md` e `CLAUDE.md`: regola 1 aggiornata per scrivere le annotazioni nel PDF originale (decisione dell'utente).

Risultati da non dimenticare:
- Le evidenziazioni fatte con la pagina stirata a 1920 px sono salvate con coordinate sbagliate (40 px a sinistra, 192 px oltre il testo, 58% di sovrapposizione). R0 è la prossima ondata (D-347, known issues in D-429); nessuna scrittura nei PDF prima di R0.
- Il CSS di pdf.js filtra nell'app: il foglio va prefissato con `.reader-scroll` (D-346).
- Lo stretch si corregge per primo, da solo (H0, D-354): fatto e unito in `dc1170f`.
- Scrittura nel PDF: su chiusura del documento o dopo 120 s di inattività (non ogni pochi secondi, per limitare gli upload di OneDrive); consenso per libreria con banner non modale prima della prima scrittura; mai cancellazione automatica delle annotazioni rimosse da altri programmi ("Da controllare"); flag di compilazione fino alla revisione di sicurezza.

Default provvisori per le 4 domande, da confermare con l'utente (non ancora risposte):
1. Copia di sicurezza dei PDF annotati nella cartella dati sincronizzata (si può passare alla cartella locale).
2. Nessun nome autore nelle annotazioni PDF (opt-in).
3. Esc non chiude il lettore.
4. Nell'Account Claude il consumo del mese mostra la libreria attiva (totale di tutte al clic).

Accento: "Petrolio" (teal) provvisorio oppure "Indaco". Lo sceglie l'utente.

Budget proposti dal design, non ancora applicati a `tools/budgets.json`: main 1080 KiB, renderer iniziale 391 KiB, renderer totale 1655 KiB.

Passi successivi, in ordine:
1. Utente: conferma le 4 domande e sceglie l'accento. Non bloccante: P0 è approvato (D-383).
2. Implementazione: R0 per prima (known issues in D-429), poi S1 ∥ S2 (`ARCHITETTURA-UI.md` §14), poi le ondate 7-12 delle funzioni nuove (§14.1). Subagent Sonnet, al massimo 2 insieme e su file disgiunti. H0 è fatta.
3. Revisione indipendente e revisione di sicurezza dedicata alla scrittura nei PDF originali; la scrittura resta dietro il flag di compilazione finché la sicurezza non passa.
4. Test finali, uno alla volta.
5. Fase 8: i test di installazione li fa l'agente (installazione silenziosa in una cartella temporanea, avvio, disinstallazione, controllo dei dati; impostazioni dell'account dell'utente salvate e ripristinate prima). Poi tag `phase-8` e versione 1.0.0 (D-262).

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

- Fase 8, prova di installazione: la fa l'agente (sezione 5, punto 5), non più un secondo account Windows. Poi tag `phase-8` e versione 1.0.0 (D-262).
- Fase 4, criteri su dati reali:
  - 5 paper campione con almeno l'80% dei tag accettati (lavoro AI con Claude vero e revisione);
  - un PDF vero trascinato nella cartella di arrivo in meno di un minuto, con i metadati giusti;
  - prova della chat su una cartella reale della libreria, scelta dall'utente.
- Fase 5, prova sulla libreria reale: mandare i DOI dei paper dell'utente a OpenAlex. Serve il consenso dell'utente.
- Prova facoltativa di fase 7 con Claude Code vero (export aperto da Claude Code e server MCP aggiunto con la riga copiata): usa l'account dell'utente, quindi chiedere prima.
- Installer (fase 8): includere o no l'eseguibile di Claude Code da circa 356 MB dell'Agent SDK (D-203). Non includerlo senza conferma. Nel frattempo la cartella di rilascio contiene anche `default_app.asar` di Electron: innocuo, si puo escludere.
- Aperte da prima: certificato di firma, icona definitiva, cifratura dei backup.
- Funzioni nuove (D-389..D-428), non bloccanti; ogni domanda ha già un default nei documenti: modello locale come fornitore facoltativo (Ollama o llama.cpp): sì o no; funzione 43 (screening e PRISMA): sì o no (D-409); funzione 49 generalizzata oltre la tesi: confermare (D-399, D-422); funzione 13 (esportazione BibTeX/RIS) con la 7: confermare (D-422); funzione 26 (operatori di ricerca): da decidere; accento (Petrolio provvisorio o Indaco); i 4 default provvisori della sezione 5.

Nota: con Haiku a ragionamento basso, una domanda breve in inglese puo ricevere risposta in italiano; controllare la lingua.
