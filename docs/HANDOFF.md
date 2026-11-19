# Passaggio di consegne (HANDOFF)

Questo file serve a riprendere il lavoro su Research Lab da una chat nuova di Claude Code, che non conosce la sessione precedente.

## 1. Scopo del file

Stato di passaggio per riprendere il lavoro. Prima di fare qualunque cosa, leggere in quest'ordine:

1. `CLAUDE.md` (regole di lavoro, modelli per compito, commit, comandi);
2. `docs/STATUS.md` (fase, onda, fatto, in corso, bloccato, prossimo);
3. `docs/HANDOFF.md` (questo file);
4. `docs/DECISIONS.md` (le ultime voci: D-446..D-469);
5. `docs/design/ARCHITETTURA-UI.md` §14 e §14.1 (ondate di implementazione e funzioni nuove);
6. `docs/HISTORY.md` (facoltativo: cronologia).

Se questo file e `docs/STATUS.md` non coincidono, vale `docs/STATUS.md`; questo file va poi aggiornato.

## 2. Aggiornato

- Data: 2026-11-19.
- HEAD di codice su `main`: `2cce6b4` (budget per le ondate 9-10, pubblicato). Ultimo merge su `main`: `c20886d` (X3). Il commit di documentazione di questo aggiornamento viene dopo `2cce6b4`.
- Branch uniti e pubblicati: `h0`, `r0`, `s1`, `s2`, `w1-contracts`, `a1`, `b1`, `c2`, `a2`, `audit2`, `r2`, `fix-real`, `f4`, `tokcap`, `d3`, `g4b`, `e3`, `g4a`, `m4`, `g4c`, `n4`, `h5`, `i5`, `j5`, `t1`, `x1`, `x2`, `x4`, `slim`, `x3`.
- In corso, ondata 9, nessun merge ancora: `x5` (worktree `C:\dev\rl-wt\x5`) e `x6` (worktree `C:\dev\rl-wt\x6`). Lo stato dei due subagent non è registrato in questo file: verificarlo con `git status` e `git log` nei due worktree prima di riprendere.
- Worktree ancora su disco sotto `C:\dev\rl-wt` (circa 35 vecchi): tutti rimuovibili tranne `x5` e `x6`. Non cancellare mai una junction `node_modules`.
- Tag: `phase-0`..`phase-3`, `phase-6`, `phase-7` pubblicati; `phase-4`, `phase-5`, `phase-8` senza tag.
- Installer di rilascio costruito prima della riprogettazione (131 MB, non firmato): da rifare dopo le ondate.

## 3. Cosa è successo in questa sessione

- P0 approvato dall'utente (D-383). Scelte delle funzioni nuove (D-389..D-409) e critica del giro 4 chiusa (D-410..D-428).
- Onda 0 unita: H0 (stretch PDF), R0 (riparazione headless, D-429, D-430), S1 (spike di autenticazione della CLI, D-431), S2 (prototipo di scrittura PDF, D-432), contratti (D-433).
- Onde 1 e 2 unite: A1 (token), B1 (account Claude, scansione, lingua al primo avvio), C2 (impostazioni), A2 (shell, barra laterale, Attività, tavolozza). Audit visivo round 5 (D-441) e correzioni R2.
- Prova con dati reali (`fix-real`): bug corretti; le copie dei file di prova e il rapporto stanno in una cartella temporanea fuori dal repository.
- Onda 3 unita: F4 (lettore), D3 (libreria), E3 (hub "Da rivedere"), G4b (identità del contenuto dei PDF). Tetto dei token con estensione (`tokcap`, D-442).
- Risposte dell'utente: D-436, D-439, D-440, D-446. D-446 apre il compito T1 "pipeline di analisi".
- Onda 4 completa (D-449..D-457):
  - G4a unita (`g4a`, merge `8a42f58`): scrittore incrementale sincrono con consenso; `PDF_WRITE_ENABLED` resta `false` fino alla revisione di sicurezza.
  - M4 unita (`m4`, poi `38415f0`): Mappa giocabile, simulazione Barnes-Hut, archi, contorni, etichette, minimappa, ricerca, schede, reti, Separa/Unisci, tastiera, movimento ridotto. Totali del renderer alzati (D-452). Lacune di M4 in sezione 5, passo 3.
  - G4c unita (`g4c`, merge `87a4848`): PDF cifrati con password utente vuota (`crypt.ts`, chunk pigro; D-455). Punti di revisione in sezione 4.
  - N4 unita (`n4`, merge `a584868`): reti di entità (tag, temi, autori) con `graph:entityNetwork` in `main`, alias in `author-aliases.json`, filtro `topic` e `docIds` (D-456). Tetto del main alzato a 1110 KiB (D-457). Punti di revisione in sezione 4.
- Onda 5 unita (D-459, D-460): H5 (progetti e Scopri, merge `a7e8d21`), I5 (chat, export, guida in 10 sezioni, finestre, merge `ee36263`), J5 (copia annotata e importazione di annotazioni esterne, merge `44558e0`).
- T1 unita (`t1`, merge `0d63cdb`; D-446, D-461): pipeline di analisi con tassonomia a candidati, tag pesati, chiusura gerarchica, nota di letteratura v0.2 in `literature/<id>.md`, citazioni per rilevanza.
- J5 e T1 si sono fermate una volta per il limite d'uso e sono riprese.
- Tetti del renderer alzati per le ondate 5-12 (D-458); poi aggiornati da D-464.
- Ondate 7 e 8 unite (D-462..D-469):
  - X1 unita (`x1`, merge `91c98d0`): import da Zotero e BibTeX, `.bib` gestito del progetto, copia BibTeX.
  - X2 unita (`x2`, merge `8c6c3d7`): Ritaglia nel lettore, ✦ Spiega con stima e tetto giornaliero, significati dei colori, anteprima dei costi condivisa.
  - X4 unita (`x4`, merge `4f2359d`): risorse, import da DOI/arXiv/URL, banner Riprendi dopo chiusura non pulita.
  - SLIM unita (`slim`, feature `277d8b7`, merge `023981e`): backup e manutenzione caricati in modo pigro; poi tetto del main abbassato a 1110 KiB (`22e2213`).
  - X3 unita (`x3`, merge `c20886d`): note di letteratura, modelli, LaTeX, collegamenti per identificatore.
- Budget: `88e9ca1` (tetti del main per le ondate rimanenti), `2cce6b4` (totali per le ondate 9-10), `renderer.chunkCapsKB` (D-465). Numeri in sezione 5.
- Revisioni e test rimandati alla verifica finale (D-443).

## 4. Test: eseguiti

- Dal D-443 nessun test è stato eseguito (anche i test scritti in G4a, G4c, N4 e nelle ondate 7-8, vedi sotto). Durante le ondate si eseguono solo `npm run typecheck`, `npm run build`, `npm run check:budget` e `npm run check:generality`. I task scrivono i test ma non li eseguono.
- Ultimi test noti, su `main` dopo H0 (2026-11-18): unitari 1707 passati, 12 saltati, 1 fallimento instabile in `McpSection.test.ts` (PORT_IN_USE con poca RAM; passa 17/17 da solo); e2e `reader-geometry` 4/4, `study-ui` 1/1, `smoke` 4/4.
- Problemi noti da chiudere nella verifica finale (D-429, D-443, D-444): `McpSection` PORT_IN_USE; `export.test` sotto poca RAM; `ui-library.spec.ts` si blocca; 2 test di `reader.test.ts` rotti da D3; `design-audit.spec.ts` con testid cambiati; `firstContentMs` da rimisurare su macchina scarica.
- G4a (D-449..D-451), da verificare nel passaggio finale: test scritti e non eseguiti (scrittore: oggetti, doc, geometria, scrittura con la proprietà del prefisso, riconciliazione, rifiuti, 500 mutazioni ostili; `pdf-sync.test.ts`; asserzioni di handler e procedura guidata; `e2e/pdf-annot.spec.ts`). Punti aperti: riscrittura completa di un PDF da un altro programma con lo stesso testo (D-445, regola 3) non gestita, trattata come cambiata (sicuro); lista "Da controllare" in Attività mancante (le scelte stanno nel pannello Info del lettore); `expectedWrites` riempito ma non letto; dubbi: l'e2e del pixel in una BrowserWindow nascosta può non disegnare (salta con nota), soglie del test ostile stimate, file ibridi e con predittore PNG affidati alla lettura dell'aggiornamento da parte di pdf.js.
- G4c (D-455), test scritti e non eseguiti: `crypt.test.ts` (RC4 40/128, AES-128, AES-256 R5/R6, tabella e xref stream con ObjStm, `/P`, password non vuota, varianti non supportate, lunghezze AES ostili, round trip). Punti per la revisione di sicurezza:
  1. possibile off-by-one nell'hash R6 (Algoritmo 2.B), corretto a memoria come pdf.js/pypdf, non confrontato con un'altra implementazione (il fixture R6 usa la stessa funzione);
  2. test mai eseguiti;
  3. password del proprietario mai provate e `/Perms` non validato;
  4. decifratura AES tollerante a padding e lunghezze errate, non lancia mai; filtri `/Crypt` non supportati (segnalati come `damaged`);
  5. un `/Encrypt` non leggibile finisce in `handler`.
- N4 (D-456), test scritti e non eseguiti: `entity-network.test.ts` (con test pesante sotto `RL_HEAVY_TESTS`), `author-aliases.test.ts`, `graph-entity.test.ts`, casi in `graph-handlers.test.ts` e `sqlite-index.test.ts`; vecchi test di derivazione rimossi da `m4.test.ts`. Dubbi per la revisione:
  1. affinità dei temi per coseno dei tag (non per similarità del modello né per citazioni);
  2. calcolo che può bloccare il main fino a ~1,5 s con 10 000 documenti (valutare lo spostamento nel worker grafico);
  3. documenti più recenti del modello senza tema.
- M4 (D-443): test scritti e non eseguiti: `views/network/m4.test.ts`, `useCanvasView.test.ts`, `e2e/network.spec.ts` aggiornato.
- Ondata 5 (D-459, D-460; test non eseguiti, D-443). Punti per la verifica finale:
  1. H5: `design-audit.spec.ts` deve cliccare `project-new` prima di `project-create-name`; `project-back`, `discover-tab-sources` e il rinomina inline non esistono più.
  2. J5 (sicurezza): le annotazioni esterne importate possono duplicarsi quando la scrittura è attiva; il rinomino finale nella cartella di destinazione non è sicuro rispetto alle corse (race).
  3. I5: i riepiloghi degli strumenti da `packages/ai` sono solo in inglese, tradotti per nome dello strumento.
- T1 (D-446, D-461; test non eseguiti, D-443). Lasciti: nessuna UI per avviare il lavoro `jobs:taxonomy`; pesi non mostrati né portati ai tag dell'utente (Map, fasce); nessuna UI per rivedere la nota di letteratura.
- Ondate 7-8 (D-462..D-469; test non eseguiti, D-443): test scritti per X1, X2, X4, X3 e SLIM. Punti per la verifica finale:
  1. SLIM: la prima chiamata di backup o manutenzione carica un chunk; `backup:status` è ora asincrono: controllare i chiamanti nella suite completa.
  2. X4 (sicurezza): l'anteprima dei link raggiunge host pubblici arbitrari (senza cookie, 512 KB): includerla nella revisione di sicurezza.
  3. X1-X3: i lasciti di ogni task sono in sezione 5.
- Se la RAM libera non basta, la suite si ferma da sola: rieseguire solo i test mancanti, mai due pesanti insieme.

## 5. Stato e prossimi passi

In corso, ondata 9 (avviata dopo `2cce6b4`): X5 (lettura affiancata, schede di citazione, evidenziazioni della guida) in un subagent Sonnet, worktree `C:\dev\rl-wt\x5`, branch `x5`; X6 (motore di scoperta: Estendi la bibliografia, ricerca profonda, Trova un ponte) in un subagent Sonnet, worktree `C:\dev\rl-wt\x6`, branch `x6`. Briefs in `docs/design/ARCHITETTURA-UI.md`, sezione "Onda 9". Nessun merge ancora. Verificare lo stato dei due worktree prima di riprendere (sezione 2).

Passi, in ordine:
1. Onda 9 (in corso): X5 ∥ X6, poi merge su `main` (solo typecheck, build, check:budget, check:generality).
2. Onda 10: X7 (contorno del progetto, evidenze e suggerimenti di citazione) ∥ X8 (tabella di confronto, gruppi di ricerca, contesto delle citazioni, cronologia).
3. Lacune di M4 e revisione a vista della coppia di design (D-379): trascinamento dell'etichetta di un tema e dei punti in un tema aperto; contorni e colore dei temi in modalità documenti; ⋯ "Dimensione per" e "Mostra temi in comune"; "Vai a" per i nodi tagliati dal limite di 800; "ultimo letto" come documento di partenza; volo reale di 300 ms tra le modalità (ora la simulazione si assesta dai centroidi del Panorama); probe di fps pesanti (solo con `RL_HEAVY_TESTS=1`).
4. Ondata 11: Y1 (designer avversario) e Y2 (budget e suite completa).
5. Ondata 12: funzioni confermate (PRISMA, D-439; copia BibTeX/RIS, D-436; funzione 49), solo dopo conferma dell'utente.
6. Verifica finale, una sola volta: revisione indipendente e revisione di sicurezza dedicata a G4a, G4b, G4c e X4; correzioni; poi attivare `PDF_WRITE_ENABLED`; tutti i test, quelli pesanti uno alla volta, con RAM libera controllata (sezione 4). Punti da verificare: l'elenco completo è in sezione 4 (G4a, G4c, N4, M4, H5, J5, I5, T1, ondate 7-8).
7. Fase 8: prova di installazione fatta dall'agente (installazione silenziosa in cartella temporanea, avvio, disinstallazione, controllo dei dati, con le impostazioni dell'account dell'utente salvate e ripristinate prima). Poi tag `phase-8` e versione 1.0.0 (D-262).

Stima data all'utente: 6–9 ore di lavoro degli agenti, più le pause per il limite d'uso. La verifica finale è il blocco più grande e meno certo.

Lasciti per task (non ancora fatti):
- X1: scelta BibTeX in "Esporta…"; voce nella tavolozza; avanzamento nel chip Attività.
- X2: "includi l'immagine" (il provider accetta solo testo); ritagli nella nota di letteratura e in `![[…]]`; nessuna aggiunta a `study-ui.spec` né a crowding.
- X4: scheda "Scheda" per le risorse; suggerimenti di link dal testo; risorse nei Documenti di progetto; faccetta "Risorse" dentro Tipo; e2e per il banner di ripresa.
- X3: estrazione delle immagini incorporate nel PDF (messaggio del worker); "Rigenera una sezione"; chip Attività (la coda di selezione sta nella sua finestra).
- X5, X6: lasciti da leggere nei rapporti dei subagent quando arrivano.

Budget (`check:budget` verde, dopo X3): JS iniziale del renderer 358,6/396 KiB; JS totale 1989,4/2110 KiB (totale del renderer con tetto 2230 KiB); entry del main 1079,3/1110 KiB; lazy del main 268,2/340 KiB; ogni nuovo chunk del renderer ha un tetto di 16 KiB in `renderer.chunkCapsKB` (NoteRich 12,7, LiteratureNote 9,1, IncomingLinks 1,2); preload sotto 8 KiB.

## 6. Come lavorare (regole di lavoro dell'utente)

- L'agente principale solo supervisiona: scrive gli incarichi, integra, verifica i diff, fa commit e push. Non scrive funzioni né test.
- Modelli per costo:
  - Sonnet per logica, interfacce, revisioni e sicurezza. Nel dubbio, Sonnet.
  - Haiku per il lavoro meccanico: worktree e junction, controlli di budget e generalità, traduzioni, aggiornamento di STATUS, HISTORY, HANDOFF e DECISIONS.
  - Coppia Opus (architetto e revisore avversario visivo) solo per le decisioni di design dell'interfaccia; al massimo 2 round.
- Al massimo 2 subagent insieme, su file disgiunti. Se si raggiunge il limite d'uso di Claude, si riprende lo stesso subagent con SendMessage dopo il ripristino.
- Brief dei subagent: autosufficienti, e rimandano solo a `CLAUDE.md` e alla sezione di design del task. Rapporto finale di massimo 150 parole.
- Worktree in `C:\dev\rl-wt\<ramo>`. `node_modules` è una junction verso il repository principale (`New-Item -ItemType Junction`): non cancellarla mai. `node_modules/@rl/*` punta ai pacchetti del repository principale: un task che cambia `packages/*` verifica con alias temporanei che poi rimuove.
- Conflitti di merge in elenchi di canali o di handler: il supervisore tiene entrambi i lati.
- Test (D-443): durante le ondate solo typecheck, build, check:budget e check:generality. Verifica finale una sola volta, pesanti uno alla volta, RAM libera controllata; dopo gli e2e chiudere gli `electron.exe` rimasti da `C:\dev\research-lab\node_modules\electron`.
- Budget: alzare un tetto richiede una voce in `docs/DECISIONS.md`. I tetti si alzano una volta per le ondate rimanenti, non a ogni merge. I tetti di avvio (JS iniziale del renderer 396 KiB, entry del main 1110 KiB) non si alzano mai. Ogni nuovo chunk del renderer ha una voce di 16 KiB in `renderer.chunkCapsKB`. Una modifica di budget di una riga non richiede altri controlli. Funzionalità prima della leggerezza, ma avvio (JS iniziale) e memoria a riposo non devono crescere: il codice nuovo si carica in modo pigro.
- Nessuna domanda bloccante: decidere, registrare in `docs/DECISIONS.md`, proseguire.
- Commit: nessun `Co-Authored-By` e nessun coautore Claude; identità git locale; push su `origin main` a ogni passo. I subagent non fanno mai push.
- Non togliere funzioni per fare spazio alla leggerezza.
- Codice, commenti e commit in inglese; documentazione in italiano.
- Un solo aggiornamento di STATUS, HISTORY, HANDOFF e DECISIONS per onda, alla fine dell'onda, non a ogni merge.

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
