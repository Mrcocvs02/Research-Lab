# Passaggio di consegne (HANDOFF)

Questo file serve a riprendere il lavoro su Research Lab da una chat nuova di Claude Code, che non conosce la sessione precedente.


## Ripresa (2026-11-20, sera) — leggere per primo

- Rilasciata **v1.2.0** (`7a3246a`, tag `v1.2.0`), installer `apps/desktop/release/ResearchLab-Setup-1.2.0.exe` (125 MB, senza Claude Code, non provato con installazione). Test: unitari 3044/3044, pesanti verdi, e2e verdi tranne `qa-budget` (instabile noto).
- **In corso, non uniti** (worktree sotto `C:\dev\rl-wt`, rami non spinti):
  - `hk1` (Sonnet): "Lascia decidere a Haiku" con avanzamento visibile ("120/600", chip Attività, Annulla che tiene il parziale, riepilogo), tutte le domande in una corsa (anteprima con costo totale e tetto), prompt condiviso inviato una volta con cache e domande a centinaia per chiamata (riportare i token prima/dopo), "Vai al documento"/"Inizia da qui" spostati a destra nel vicinato. D-515.
  - `vpack` **unito** (`9a57b84`): vocabolario di base (topic 161 con 12 macro-aree, method 79, system 42, paperType 12; termini scritti da zero, solo categorie arXiv come indizi; PhySH non usato: licenza non dichiarata) del campo dell'utente (fisica, informazione quantistica, molti corpi, materia condensata, metodi numerici, AI, fisica matematica) in `packages/core/src/vocab/packs/physics-qi-manybody.json` + schema zod + test + `docs/design/vocab-packs.md`; licenze da verificare (PhySH CC0?).
  - Se una sessione si è chiusa: controllare `git status`/`git log main..<ramo>` nel worktree; un agente interrotto si riprende con un nuovo agente che parte dal lavoro non committato.
- **Prossimi passi:**
  1. Unire `hk1` (`vpack` già unito) (controllo diff, niente Co-Authored-By, typecheck/build/check:budget/check:generality, push).
  2. Progetto Opus: il vocabolario di base guida tagging, macro-aree e blocchi (il Vocabolario mostra solo i concetti usati in libreria; il vocabolario evolve con i paper); correzioni a mano nella panoramica a blocchi (trascinare un paper in un altro blocco = cambia il valore della famiglia, rinominare/unire blocchi); migliorare la scelta delle macro-aree. **La panoramica a blocchi va tenuta** (piace all'utente).
  3. Sonnet implementa; Opus verifica su una copia della cartella UL (sola lettura, copia temporanea, niente percorso nei file).
  4. Giro completo dei test (unitari; e2e due alla volta, ognuno con `--output` suo; pesanti), documenti, versione 1.3.0.
- Regole operative ricordate dall'utente: costo in token prima del tempo; agenti al massimo 2; test bomba vietati (D-476); tetti in KiB non vincolanti ma app leggera (D-487); niente Co-Authored-By.

## 1. Scopo del file

Stato di passaggio per riprendere il lavoro. Prima di fare qualunque cosa, leggere in quest'ordine:

1. `CLAUDE.md` (regole di lavoro, modelli per compito, commit, comandi);
2. `docs/STATUS.md` (fase, onda, fatto, in corso, bloccato, prossimo);
3. `docs/HANDOFF.md` (questo file);
4. `docs/DECISIONS.md` (le ultime voci: D-492..D-514);
5. `docs/design/ARCHITETTURA-UI.md` §14 e §14.1 (ondate di implementazione e funzioni nuove);
6. `docs/HISTORY.md` (facoltativo: cronologia).

Se questo file e `docs/STATUS.md` non coincidono, vale `docs/STATUS.md`; questo file va poi aggiornato.

## 2. Aggiornato

- Data: 2026-11-20.
- HEAD: vedi `git log`. Ondate 1–13 unite su `main`; onda 14 unita. Documentazione del lavoro dopo la 1.1.0 sul ramo `docs15`, non ancora unita.
- Onda 14 (dopo la 1.0) fatta; versione 1.1.0 rilasciata (tag `v1.1.0`); dopo la 1.1.0 altri lavori su `main` non rilasciati (sezione 3). Nessun lavoro di ondata in corso. Fase 8 completa con tag `phase-8`.
- Worktree vecchi ancora su disco: rimuovibili. Non cancellare mai una junction `node_modules`.
- Tag: `phase-0`..`phase-3`, `phase-6`, `phase-7`, `phase-8` pubblicati; `phase-4`, `phase-5` senza tag.
- Installer: non rifatto per il lavoro dopo la 1.1.0 (si farà con la versione 1.2.0).

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
- Ondata 13 unita (D-477..D-491): gap di X7, X8, w12; funzione 49 (Z1a–Z1c) fatta; Mappa K1, L1, K2; gruppi di ricerca come tag `grp:` (D-488); "Raggruppa per" con famiglie (D-489); audit su copia di dati reali (D-490); famiglie di tag (D-491). Budget non più vincolanti (D-487).
- Dopo la 1.1.0, su `main`, non rilasciato (D-511..D-514):
  - Lettore: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z e Annulla/Ripeti nel menu Altro per le annotazioni (diario, poi cronologia della libreria); riassunto strutturato ("Riassunto ✦" sulla scheda e in Altro).
  - Rete: tutte le famiglie di "Raggruppa per" selezionabili (blocchi parziali, Riordina i tag, 0 % nascosto; gruppi da fonte dei tag rimossi); percorso di vicinato; Allarga/Restringi; Indietro/Avanti nella sezione.
  - Tag: "Accetta tutte (N)"; quattro modalità di accettazione automatica; "Lascia decidere a Haiku" (D-512); gestore dei tag dalla barra laterale, Alt+6, comandi della tavolozza, "Gestisci i tag…".
  - Pannelli laterali ridimensionabili con tastiera, reset con doppio clic, larghezze ricordate (D-513).
  - Tetti di budget alzati (D-511, D-514); valori in `CLAUDE.md`.
- Onda 14, dopo la 1.0 (D-492..D-510). Feedback dell'utente: rete illeggibile, schede della libreria illeggibili, multi-selezione che mostrava tutto, Sorprendimi con collegamenti noti, Discover con classici banali; priorità alla qualità dei tag. Fatto:
  - Sorprendimi e Discover (D-492), con "Includi classici" spento di default.
  - Diagnosi su dati reali (audit "Diagnosi rete e libreria (post 1.0)"); design §19 (D-493..D-501).
  - Vocabolario controllato con alias, quasi-duplicati, controlli di salute, pulizia guidata in 6 passi con "Annulla tutto" (D-504), provenienza mano/AI/import, import e tagging AI legati al vocabolario.
  - Mappa su carta con archi di evidenza, vicinato, percorso, Indietro/Avanti, vista Vocabolario, apertura per Automatica (D-510); schede in verticale; multi-selezione solo sui condivisi.
  - Verifiche dell'auditor Opus su dati reali (D-505..D-509): 0 fusioni errate, 25/25 titoli a 1280 e 1920.
  - Tetti di budget alzati (D-501..D-503); valori in `CLAUDE.md`.
- Revisioni e test rimandati alla verifica finale (D-443).

## 4. Test: eseguiti

- **Verifica finale (D-443), su `main` a `6d2018e`:** unitari 2708 passati, 1 instabile (`export.test.ts` "cancelled or failed", passa da solo); e2e uno alla volta 40 su 42 verdi, con `qa-budget` `firstContentMs` instabile (534, 604 contro 530, non alzato); heavy tutti verdi (6 file unitari, `qa-search-perf`, `security-hostile-scan`). Le sezioni seguenti descrivono lo stato prima di questa verifica e restano come storia dei punti di revisione.
- Dopo la 1.1.0 (D-511..D-514): la suite completa non è stata rifatta dopo questi merge; ogni agente ha eseguito i test unitari e gli e2e dei file che ha toccato. Da fare nella verifica finale.
- Onda 14: unitari 3005/3005; heavy verdi; e2e verdi tranne `qa-budget` `firstContentMs` (instabile, noto).
- Ondata 13: unitari ed e2e verdi tranne `qa-budget` `firstContentMs` (instabile, noto); heavy verdi.
- Prima della verifica finale, dal D-443 nessun test era stato eseguito (anche i test scritti in G4a, G4c, N4 e nelle ondate 7-8, vedi sotto). Durante le ondate si eseguono solo `npm run typecheck`, `npm run build`, `npm run check:budget` e `npm run check:generality`. I task scrivono i test ma non li eseguono.
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

Ondate 1–13 unite su `main`; onda 14 (dopo la 1.0) fatta; versione 1.1.0 rilasciata (tag `v1.1.0`). Fase 8 completa con tag `phase-8`. `PDF_WRITE_ENABLED` è acceso (D-473); nei test e2e di sviluppo resta spento salvo `RL_E2E_PDF_WRITE=1`.

Lavoro dopo la 1.1.0 (sezione 3): su `main`, non rilasciato.

Passi, in ordine:
1. Verifica finale completa (D-443) su `main`, pesanti uno alla volta.
2. Versione 1.2.0, quando l'utente è pronto; installer senza eseguibile di Claude Code (D-474).

Lacune note dopo l'onda 14 (da chiudere con il feedback, non bloccano la 1.1.0):
- Duplicati: concetti duplicati risolti ~12 su 18 sulla libreria reale (obiettivo 90%).
- Topic chiarisce il 52% dei blocchi: macro-aree generiche e piccole dell'utente. L'utente può unirle; Automatica è il default (D-510).
- Selettore delle famiglie di tag: aggiunge un tag alla volta.
- "✦ Suggerisci famiglie" (serve un nuovo prompt AI).
- Rinomina sulla scheda del tema (manca un canale di rinomina del tema).
- Cronologia per annullare i collegamenti aggiunti.
- Dimensioni delle schede S/M/L.
- Stato di studio in batch.

Lasciti per task (non ancora fatti):
- X1: scelta BibTeX in "Esporta…"; voce nella tavolozza; avanzamento nel chip Attività.
- X2: "includi l'immagine" (il provider accetta solo testo); ritagli nella nota di letteratura e in `![[…]]`; nessuna aggiunta a `study-ui.spec` né a crowding.
- X4: scheda "Scheda" per le risorse; suggerimenti di link dal testo; risorse nei Documenti di progetto; faccetta "Risorse" dentro Tipo; e2e per il banner di ripresa.
- X3: estrazione delle immagini incorporate nel PDF (messaggio del worker); "Rigenera una sezione"; chip Attività (la coda di selezione sta nella sua finestra).
- X5, X6: lasciti da leggere nei rapporti dei subagent quando arrivano.

Budget: i tetti di `CLAUDE.md` non sono più vincolanti (D-487); misure da rilevare con `check:budget`. Ogni nuovo chunk del renderer ha un tetto di 16 KiB in `renderer.chunkCapsKB` (D-465); preload sotto 8 KiB.

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
- Budget: alzare un tetto richiede una voce in `docs/DECISIONS.md` (D-487: i tetti non sono più vincolanti, si alzano quando serve). Ogni nuovo chunk del renderer ha una voce di 16 KiB in `renderer.chunkCapsKB`. Una modifica di budget di una riga non richiede altri controlli. Funzionalità prima della leggerezza, ma avvio (JS iniziale) e memoria a riposo non devono crescere: il codice nuovo si carica in modo pigro.
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
- Funzione 26 (operatori di ricerca): da decidere.
- Fase 7, facoltativa: prova con Claude Code vero (export aperto da Claude Code e server MCP aggiunto con la riga copiata). Usa l'account dell'utente: chiedere prima.
- Nella cartella di rilascio, `default_app.asar` di Electron è innocuo e si può escludere.
- Aperte da prima: certificato di firma, icona definitiva, cifratura dei backup.

Nota: con Haiku a ragionamento basso, una domanda breve in inglese può ricevere risposta in italiano; controllare la lingua.
