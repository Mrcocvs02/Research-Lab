# Passaggio di consegne (HANDOFF)

Questo file serve a riprendere il lavoro su Research Lab da una chat nuova di Claude Code, che non conosce la sessione precedente.

## 1. Scopo del file

Stato di passaggio per riprendere il lavoro. Prima di fare qualunque cosa, leggere in quest'ordine:

1. `CLAUDE.md` (regole di lavoro, modelli per compito, commit, comandi);
2. `docs/STATUS.md` (fase, onda, fatto, in corso, bloccato, prossimo);
3. `docs/HANDOFF.md` (questo file);
4. `docs/DECISIONS.md` (le ultime voci: D-429..D-451);
5. `docs/design/ARCHITETTURA-UI.md` §14 e §14.1 (ondate di implementazione e funzioni nuove);
6. `docs/HISTORY.md` (facoltativo: cronologia).

Se questo file e `docs/STATUS.md` non coincidono, vale `docs/STATUS.md`; questo file va poi aggiornato.

## 2. Aggiornato

- Data: 2026-11-18 (sera).
- Ultimo merge su `main`: `8a42f58` (`g4a`). Questo aggiornamento è un commit dopo `8a42f58`.
- Branch uniti e pubblicati: `h0`, `r0`, `s1`, `s2`, `w1-contracts`, `a1`, `b1`, `c2`, `a2`, `audit2`, `r2`, `fix-real`, `f4`, `tokcap`, `d3`, `g4b`, `e3`, `g4a`.
- Ramo aperto: `m4` (worktree `C:\dev\rl-wt\m4`, subagent Sonnet in corso). Da unire dopo i quattro controlli (sezione 5).
- Worktree ancora su disco sotto `C:\dev\rl-wt`: rimuovibili tutti tranne `m4`.
- Tag: `phase-0`..`phase-3`, `phase-6`, `phase-7` pubblicati; `phase-4`, `phase-5`, `phase-8` senza tag.
- Installer di rilascio costruito prima della riprogettazione (131 MB, non firmato): da rifare dopo le ondate.

## 3. Cosa è successo in questa sessione

- P0 approvato dall'utente (D-383). Scelte delle funzioni nuove (D-389..D-409) e critica del giro 4 chiusa (D-410..D-428).
- Onda 0 unita: H0 (stretch PDF), R0 (riparazione headless, D-429, D-430), S1 (spike di autenticazione della CLI, D-431), S2 (prototipo di scrittura PDF, D-432), contratti (D-433).
- Onde 1 e 2 unite: A1 (token), B1 (account Claude, scansione, lingua al primo avvio), C2 (impostazioni), A2 (shell, barra laterale, Attività, tavolozza). Audit visivo round 5 (D-441) e correzioni R2.
- Prova con dati reali (`fix-real`): bug corretti; le copie dei file di prova e il rapporto stanno in una cartella temporanea fuori dal repository.
- Onda 3 unita: F4 (lettore), D3 (libreria), E3 (hub "Da rivedere"), G4b (identità del contenuto dei PDF). Tetto dei token con estensione (`tokcap`, D-442).
- Risposte dell'utente: D-436, D-439, D-440, D-446. D-446 apre il compito T1 "pipeline di analisi".
- G4a unita (`g4a`, merge `8a42f58`, 10 commit), ripresa in una chat nuova dopo lo stop del subagent con 2 commit: scrittore incrementale sincrono con consenso; `PDF_WRITE_ENABLED` resta `false` fino alla revisione di sicurezza (D-449..D-451).
- Revisioni e test rimandati alla verifica finale (D-443).

## 4. Test: eseguiti

- Dal D-443 nessun test è stato eseguito (anche i test scritti in G4a, vedi sotto). Durante le ondate si eseguono solo `npm run typecheck`, `npm run build`, `npm run check:budget` e `npm run check:generality`. I task scrivono i test ma non li eseguono.
- Ultimi test noti, su `main` dopo H0 (2026-11-18): unitari 1707 passati, 12 saltati, 1 fallimento instabile in `McpSection.test.ts` (PORT_IN_USE con poca RAM; passa 17/17 da solo); e2e `reader-geometry` 4/4, `study-ui` 1/1, `smoke` 4/4.
- Problemi noti da chiudere nella verifica finale (D-429, D-443, D-444): `McpSection` PORT_IN_USE; `export.test` sotto poca RAM; `ui-library.spec.ts` si blocca; 2 test di `reader.test.ts` rotti da D3; `design-audit.spec.ts` con testid cambiati; `firstContentMs` da rimisurare su macchina scarica.
- G4a (D-449..D-451), da verificare nel passaggio finale: test scritti e non eseguiti (scrittore: oggetti, doc, geometria, scrittura con la proprietà del prefisso, riconciliazione, rifiuti, 500 mutazioni ostili; `pdf-sync.test.ts`; asserzioni di handler e procedura guidata; `e2e/pdf-annot.spec.ts`). Punti aperti: riscrittura completa di un PDF da un altro programma con lo stesso testo (D-445, regola 3) non gestita, trattata come cambiata (sicuro); lista "Da controllare" in Attività mancante (le scelte stanno nel pannello Info del lettore); `expectedWrites` riempito ma non letto; dubbi: l'e2e del pixel in una BrowserWindow nascosta può non disegnare (salta con nota), soglie del test ostile stimate, file ibridi e con predittore PNG affidati alla lettura dell'aggiornamento da parte di pdf.js.
- Se la RAM libera non basta, la suite si ferma da sola: rieseguire solo i test mancanti, mai due pesanti insieme.

## 5. Stato e prossimi passi

In corso: M4 (Mappa, giocosa, reti per tag, temi e autori) in un subagent Sonnet, worktree `C:\dev\rl-wt\m4`, ramo `m4`. G4a è unita (`8a42f58`): nessun lavoro aperto, resta la verifica finale (sezione 4).

Passi, in ordine:
1. Unire `m4` (solo typecheck, build, check:budget, check:generality), poi G4c ∥ N4 (attenzione al tetto di ingresso del main, D-449: il codice nuovo va pigro dove possibile). `PDF_WRITE_ENABLED` resta `false`.
2. Ondata 5: I5 (chat, export, viste secondarie) ∥ H5 (progetti e Scopri), poi J5. Il responsabile della guida i18n dell'ondata 5 applica le frasi in sospeso dai rapporti di F4 ed E3 (D-444, D-446): strumenti prima del lettore, Spazio, colori 1-5, barra laterale che si riduce durante la lettura, conferma della gomma oltre 3 annotazioni, "Solo nell'app" in Studio; schede "Nuovi file" e "Proposte di Claude" di Da rivedere, chip Modello e Ragionamento, Ignora/Conferma, "Segna tutti come visti", copie di conflitto, ✓/✗ per campo, "Accettate finora".
3. T1 pipeline di analisi (D-446).
4. Ondate 7-10: funzioni nuove X1..X8 (§14.1).
5. Ondata 12: funzioni confermate (PRISMA, D-439; copia BibTeX/RIS, D-436; funzione 49).
6. Verifica finale, una sola volta: revisione indipendente e revisione di sicurezza dedicata a G4a, G4b e G4c; correzioni; poi attivare `PDF_WRITE_ENABLED`; tutti i test, quelli pesanti uno alla volta, con RAM libera controllata (sezione 4). Punti aperti di G4a: in sezione 4.
7. Fase 8: prova di installazione fatta dall'agente (installazione silenziosa in cartella temporanea, avvio, disinstallazione, controllo dei dati, con le impostazioni dell'account dell'utente salvate e ripristinate prima). Poi tag `phase-8` e versione 1.0.0 (D-262).

Budget (`check:budget` verde): JS iniziale del renderer 352,9/396 KiB; JS totale 1765,7/1785 KiB; totale 1877,8/1905 KiB; main entry 1093,8/1096 KiB, main lazy 42,5/120 KiB (chunk `writer` 42,5, tetto 44; D-449); preload 3,8/8 KiB.

## 6. Come lavorare (regole di lavoro dell'utente)

- L'agente principale solo supervisiona: scrive gli incarichi, integra, verifica i diff, fa commit e push. Non scrive funzioni né test.
- Modelli per costo:
  - Sonnet per logica, interfacce, revisioni e sicurezza. Nel dubbio, Sonnet.
  - Haiku per il lavoro meccanico: worktree e junction, controlli di budget e generalità, traduzioni, aggiornamento di STATUS, HISTORY, HANDOFF e DECISIONS.
  - Coppia Opus (architetto e revisore avversario visivo) solo per le decisioni di design dell'interfaccia; al massimo 2 round.
- Al massimo 2 subagent insieme, su file disgiunti. Se si raggiunge il limite d'uso di Claude, si riprende lo stesso subagent con SendMessage dopo il ripristino.
- Worktree in `C:\dev\rl-wt\<ramo>`. `node_modules` è una junction verso il repository principale (`New-Item -ItemType Junction`): non cancellarla mai. `node_modules/@rl/*` punta ai pacchetti del repository principale: un task che cambia `packages/*` verifica con alias temporanei che poi rimuove.
- Test (D-443): durante le ondate solo typecheck, build, check:budget e check:generality. Verifica finale una volta sola, pesanti uno alla volta, RAM libera controllata; dopo gli e2e chiudere gli `electron.exe` rimasti da `C:\dev\research-lab\node_modules\electron`.
- Budget: alzare un tetto richiede una voce in `docs/DECISIONS.md`. Funzionalità prima della leggerezza, ma avvio (JS iniziale) e memoria a riposo non devono crescere: il codice nuovo si carica in modo pigro.
- Nessuna domanda bloccante: decidere, registrare in `docs/DECISIONS.md`, proseguire.
- Commit: nessun `Co-Authored-By` e nessun coautore Claude; identità git locale; push su `origin main` a ogni passo. I subagent non fanno mai push.
- Non togliere funzioni per fare spazio alla leggerezza.
- Codice, commenti e commit in inglese; documentazione in italiano.
- Aggiornare STATUS, HISTORY e HANDOFF a ogni fine onda.

Comandi utili (in Git Bash, prima: `export PATH="/c/Program Files/nodejs:$PATH"`):

- `npm run typecheck`, `npm run build`, `npm run check:generality`, `npm run check:budget`;
- `npm test` (unitari); `npm run test:e2e` (Playwright su Electron, finestre fuori schermo; `RL_E2E_SHOW=1` per vederle).

## 7. Domande aperte per l'utente

Non bloccanti: decidere quanto possibile e registrare.

- Confermati dall'utente (D-448): accento Petrolio; nessun nome autore nelle annotazioni PDF; copia di sicurezza nella cartella dati sincronizzata; Esc non chiude il lettore. Tag pesati e senza limite di numero (D-447).
- Ancora provvisorio: nell'Account Claude il consumo del mese mostra la libreria attiva (totale di tutte le librerie al clic).
- Funzione 49 generalizzata oltre la tesi: confermare (D-399, D-422).
- Funzione 26 (operatori di ricerca): da decidere.
- Fase 4, criteri su dati reali (poi tag `phase-4`):
  - 5 paper campione con almeno l'80% dei tag accettati (lavoro AI con Claude vero e revisione);
  - un PDF vero trascinato nella cartella di arrivo in meno di un minuto, con i metadati giusti;
  - prova della chat su una cartella reale della libreria, scelta dall'utente.
- Fase 5 (poi tag `phase-5`): prova sulla libreria reale. Il consenso a mandare i DOI a OpenAlex è dato (D-440); la prova resta da fare.
- Fase 7, facoltativa: prova con Claude Code vero (export aperto da Claude Code e server MCP aggiunto con la riga copiata). Usa l'account dell'utente: chiedere prima.
- Installer (fase 8): includere o no l'eseguibile di Claude Code da ~356 MB dell'Agent SDK (D-203, D-261). Non includerlo senza conferma. Nella cartella di rilascio, `default_app.asar` di Electron è innocuo e si può escludere.
- Aperte da prima: certificato di firma, icona definitiva, cifratura dei backup.

Nota: con Haiku a ragionamento basso, una domanda breve in inglese può ricevere risposta in italiano; controllare la lingua.
