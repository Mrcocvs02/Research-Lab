# Audit di design di Research Lab (stato attuale, main c1b9ac2)

Autore: agente "designer avversario". Data: 2026-11-17. Stato del documento: **completo**. Quello che non si è potuto provare è elencato in "Limiti di questo audit", con il motivo.

Metodo: `e2e/design-audit.spec.ts` (saltato senza `RL_DESIGN_AUDIT=1`; cartella di uscita con `RL_DESIGN_AUDIT_OUT`) avvia l'app compilata su librerie sintetiche (`it`, `en`) con il fornitore AI simulato e la rete tagliata, attraversa la procedura guidata e tutte le viste raggiungibili, salva uno screenshot per schermata in `audit-shots/<esecuzione>/` (ignorata da git, mai committata) e misura per schermata: clic dalla Libreria, controlli visibili, errori di console, elementi tagliati o fuori finestra, contrasto WCAG del testo, ordine del Tab. In più misura la geometria del lettore, la posizione delle evidenziazioni rispetto ai glifi disegnati, le regole di `pdf_viewer.css` che colpiscono elementi dell'app e lo stile calcolato di barra laterale e dialoghi prima e dopo il lettore.

Esecuzioni (cartelle di `audit-shots/`):
- `run1/` — italiano, 141 schermate, `run1/metrics-it.json` (passi della scheda del documento falliti per un errore dello script).
- `run2-partial/` — seconda esecuzione interrotta di proposito (16 schermate, `run2.log`).
- `run3-aborted/` — fermata: un dialogo rimasto aperto bloccava i passi successivi (lo script ora lo chiude; il dialogo restava aperto per un difetto dell'app, N7).
- `run3/` — **italiano completo, 183 schermate** (`it-001…it-181` più due ritagli), `run3/metrics-it.json`: scheda del documento, simili, citazioni, export completo, MCP acceso, registratore delle scorciatoie, backup verso una cartella valida e ripristino completo, evidenziazione a 1920×1080, contaminazione CSS, matrice tema × dimensioni.
- `run4-en/` — **inglese completo, 161 schermate**, `run4-en/metrics-en.json` (il lettore non è stato raggiunto per un passo della tassonomia fallito, vedi Limiti).
- `run5-en-reader/` — inglese, giro base con il lettore (63 schermate, `metrics-en.json`).

Correzioni allo script rispetto alla prima esecuzione (solo `e2e/design-audit.spec.ts`): la scheda si apre con il pulsante "Scheda" (il secondo clic sulla riga non la apre: misurato, N2); "Simili" e "Citazioni" si raggiungono scorrendo la scheda; l'export aspetta la conferma in linea; il server MCP si accende con un clic e si aspetta lo stato (la casella è controllata dal processo principale: `check()` di Playwright falliva per questo); il ripristino non apre mai la finestra nativa dei file (nessun aggancio di test) ma parte dall'elenco dei backup, e le cartelle si scelgono con le variabili di test del processo principale; un passo fallito chiude anche un dialogo rimasto aperto. Build: `apps/desktop/out` compilato dallo stesso sorgente (nessuna modifica all'app dopo l'ultima build), quindi non ricompilato per risparmiare memoria.

Macchina di misura: finestra fuori schermo, `devicePixelRatio` = 1,198 (scala di Windows frazionaria). Misure in pixel CSS salvo dove indicato. Gravità: **bloccante** (impedisce un compito o danneggia dati), **importante** (rallenta o confonde in un compito frequente), **minore** (rifinitura).

---

## Sintesi: i 15 problemi più gravi (per impatto)

1. **bloccante — Il PDF nel lettore è deformato e le evidenziazioni vengono salvate nel posto sbagliato.** La regola globale `.page { max-width: 860px; padding: … }` dell'app (`apps/desktop/src/renderer/src/styles.css:451-454`) colpisce anche i `div.page` di pdf.js. A 1920×1080 la pagina è 860×1815 invece di 1285×1815 (scala orizzontale 0,669) mentre lo strato di testo resta largo 1285 px. **Misura** (`reader-1920-selection-vs-mark` in `run3/metrics-it.json`, identica in `run5-en-reader/metrics-en.json`): un'evidenziazione creata selezionando una riga a 1920 px copre x 569-1030, mentre i glifi sono disegnati in x 529-837: **40 px di scarto a sinistra, 192 px oltre la fine del testo, solo il 58% dell'evidenziazione sta sul testo**. L'annotazione è **salvata** con quelle coordinate, quindi resta storta riaprendo il documento a 1024 o 1280 px (`run3/it-062-reader-open-fit-light-1024x700.png`: il rettangolo blu parte a metà di "arXiv:2401" e va oltre la riga) e resterà storta dopo la correzione del CSS. Evidenze: `run3/it-061-reader-1920-after-highlight-light-1920x1080.png`, `run5-en-reader/en-058-reader-1920-after-highlight-light-1920x1080.png`; barra di scorrimento orizzontale (`reader-1920-scroll`: 1497 su 1285 px).
2. **bloccante — `pdf_viewer.css` contamina tutta l'app dopo la prima apertura del lettore.** **Misura** (`pdfjs-css-rules-outside-reader`, `styles-before/after-reader-*`): il foglio del lettore ha 156 regole e condivide con l'app i nomi `.dialog`, `.page`, `.selected`, `.sidebar`, `.textLayer`. Dopo il lettore la barra laterale passa da raggio 0 a 8 px, ombra doppia, bordo, `padding` da 16 a 5/16 px, larghezza da 236 a 239 px, `position: relative`; i dialoghi passano da raggio 8 a 4 px, `padding` da 16 a 12/16 px, ombra diversa e bordo bianco. Resta così fino al riavvio. Evidenze: `run3/it-064-library-after-reader-light-1280x800.png` e `run3/it-065-guide-dialog-after-reader-light-1280x800.png` contro `run3/it-010-library-home-light-1280x800.png` e `run3/it-042-guide-dialog-light-1280x800.png`.
3. **bloccante — Sottolineare ed evidenziare: "prima seleziono, poi scelgo", nessuno strumento** (richiesta dell'utente). Nessuna modalità strumento, nessuno Spazio per alternare: si trascina, compare una barra in fondo alla finestra con due pulsanti primari identici, 5 pallini e un campo commento (`run3/it-049-reader-selection-bar-light-1280x800.png`). Ogni annotazione costa 3 azioni lontane dal testo; dopo la selezione la vista può saltare alla pagina successiva e la riga selezionata non è più visibile (`run5-en-reader/en-046-reader-selection-bar-light-1280x800.png`: barra con "Ada Placeholder, Ben Sample", pagina mostrata la 2).
4. **importante — Impostazioni: una pagina di 8142 px in italiano e 8309 px in inglese (10,9-11,1 schermate a 1280×800), 10 sezioni, 125 controlli, senza indice né ricerca** (`post-settings-length`). Impostazioni da sviluppatore (id dei modelli, porta MCP, token, nomi degli strumenti MCP) mescolate con quelle di tutti; lingua presente due volte. Evidenze: `run3/it-125…138-post-settings-*`, `run4-en/en-103…116-post-settings-*`.
5. **importante — Cambiare account Claude non si può dall'app.** Solo "Fornitore / Accesso / Disponibile" in un elenco senza stile e un rimando alla riga di comando; nessun "Cambia account", "Esci", "Accedi", nessuna indicazione dell'account in uso; la chiave API sta più in basso, dopo "Modelli e limiti" (`run3/it-123-settings-ai-account-area-light-1280x800.png`, `run4-en/en-101-settings-ai-account-area-light-1280x800.png`).
6. **importante — Il badge "Arrivi"/"Inbox" non dice cosa conta.** Un PDF scaricato nella cartella della libreria compare subito in Libreria **e** accende il badge; nessun tooltip (`inbox-badge`: `title` nullo, solo `aria-label` "1 file nella posta in arrivo" / "1 file in the inbox"); tre nomi per la stessa cosa (it: Arrivi, Arrivi, Posta in arrivo; en: Inbox, Arrivals, "Go to Arrivals"); le proposte dell'AI non sono contate. Evidenze: `run3/it-085-inbox-badge-hover-light-1280x800.png`, `run4-en/en-064-inbox-flagged-library-file-light-1280x800.png`.
7. **importante — Le evidenziazioni non sono nel PDF e l'app non lo dice; la guida dice il contrario.** Nessuna riga nel lettore lo spiega; la guida dice "I tuoi originali non vengono mai modificati" accanto alle annotazioni (`run3/it-042-guide-dialog-light-1280x800.png`); "Sottolineato · dalle tue evidenziazioni" fa credere che il documento sia stato sottolineato. Decisione dell'utente: scriverle nel PDF (vedi "Attacco al progetto", B.2).
8. **importante — Scansionare è nascosto.** "Scansiona ora" è un pulsante generico accanto a "Tassonomia", "Ricostruisci l'indice" un link isolato; durante la scansione il pulsante cambia nome e sposta la barra; nessuna voce nella tavolozza (`run3/it-010-…`, `run1/it-025-taxonomy-node-editor-light-1280x800.png`).
9. **importante — Nel lettore lo spazio per il PDF è minimo.** Barra su due righe, riga "studio" e un paragrafo di scorciatoie di 4 righe: 265 px di intestazione su 700 a 1024×700, area del PDF 405×389 px (`run3/it-062-…`).
10. **importante — La barra di stato fa da area di notifica; i toast attraversano le viste.** Due righe a 1280 px ("Proposte AI pronte: 5/5 · <$0.01 Rivedi Nascondi", "Aggiornamento delle citazioni fallito… Nascondi"), 100 px a 1024 (`run3/it-164-m-library-detail-light-1024x700.png`). Il toast "Proposta accettata · Annulla" resta visibile dopo due cambi di sezione, sopra le impostazioni MCP (`run3/it-114-settings-mcp-enabled-light-1280x800.png`).
11. **importante — Con la chat aperta la Libreria si rompe e la chat stessa trabocca.** Ricerca larga 120-190 px, filtri a capo, titoli troncati; due "Cronologia/History" con significati diversi; in inglese il blocco strumento della risposta è più largo del pannello (barra di scorrimento orizzontale, badge "Done" tagliato) (`run3/it-044-chat-open-no-folders-light-1280x800.png`, `run4-en/en-084-chat-answer-light-1280x800.png`, `run3/it-170-m-chat-light-1024x700.png`).
12. **importante — La scheda del documento è difficile da aprire e da usare.** Il secondo clic sulla riga **non** la apre (`detail-opens-on-second-click` = falso in it e en; correzione della versione parziale di questo audit): solo "Scheda/Details" o Invio; il doppio clic apre il programma esterno mentre la guida dice "lettore". Aperta, a 1280 px **nasconde il pannello Cartelle/Tag/Filtri** senza dirlo (`styles.css:1846-1851`), è un modulo di modifica di 2319 px (3,9 schermate) e i pulsanti d'azione vanno a capo su tre righe. Evidenze: `run3/it-013-…`, `run3/it-014-library-detail-light-1280x800.png`, `run3/it-015-library-detail-bottom-light-1280x800.png`, `run4-en/en-014-library-detail-light-1280x800.png`.
13. **importante — Export: dopo "Esporta" il fuoco si perde e la conferma è sotto la piega.** Dialogo di 1253 px in 688 visibili; dopo "Esporta" il fuoco va su `body` (`export-focus-after-run`, it e en), quindi **Esc non chiude più il dialogo** (il gestore è sul dialogo) e "Esporta comunque" compare fuori vista mentre "Esporta" diventa grigio: sembra che non succeda nulla. Avviso ripetuto due volte, due "Annulla", gergo ("circa 1095 token (indice 91)"). Evidenze: `run3/it-024-…`, `run3/it-025-export-confirm-light-1280x800.png`, `run4-en/en-025-export-confirm-light-1280x800.png`. È il difetto che ha bloccato `run3-aborted/`.
14. **importante — Ripristino: pulsanti finali tagliati e risultato senza via d'uscita.** A 1280×800 il dialogo è più alto della finestra: "Annulla"/"Ripristina" tagliati dal bordo (`run3/it-176-restore-root-not-empty-light-1280x800.png`, `run4-en/en-154-…`); la radice della libreria esistente è accettata come destinazione senza avviso; a ripristino finito ci sono **due librerie con lo stesso nome** e nessun "Apri la libreria ripristinata" (`run3/it-179-restore-done-light-1280x800.png`, `run3/it-181-after-restore-library-light-1280x800.png`).
15. **importante — Gerarchia piatta, stati dei controlli ambigui, testi sbagliati.** Tutti i pulsanti hanno lo stesso peso; un secondario con fuoco o al passaggio è grigio pieno e sembra **disattivato** (`run3/it-016-…` "Nascondi i paper simili", `run3/it-018-…` "Aggiorna", `run3/it-176-…` "Cambia cartella…", `run4-en/en-098-…` "Change"); gli elenchi chiave–valore (`<dl class="facts">`) sono senza stile con i rientri del browser (scheda, export, MCP, AI). Testi: "Close but do not look it" (en, sgrammaticato) e "Vicini ma non sembra" (it) come titolo di sezione; "second brain" nella guida italiana; "Questa sezione arriverà in una fase successiva" dietro la procedura guidata (`run3/it-124-wizard-again-from-sidebar-light-1280x800.png`).

### Nuovi risultati di questa esecuzione (non già nella sintesi)

| Id | Gravità | Risultato | Evidenza |
| --- | --- | --- | --- |
| N1 | bloccante | Annotazioni salvate con coordinate sbagliate quando la pagina è deformata (sintesi 1): la correzione del CSS deve includere una **riparazione** delle annotazioni già salvate (ricalcolo dei rettangoli dal testo citato e dalla pagina), altrimenti restano storte e, con la scrittura nel PDF, finiscono storte anche in Chrome | `run3/it-062-…`, `reader-1920-selection-vs-mark` |
| N2 | importante | Il secondo clic sulla riga non apre la scheda; unico modo visibile: "Scheda" nella barra di selezione | `detail-opens-on-second-click`, `run3/it-013-…` |
| N3 | importante | La scheda aperta nasconde il pannello Cartelle/Tag/Filtri a 1280 px | `run3/it-014-…` contro `run3/it-013-…` |
| N4 | importante | Scheda: 9 sezioni in 2319 px, parte in modifica (Titolo, Autori, Anno…), pulsanti su 3 righe ("Apri / il / file"), "Proponi con l'AI…" ripetuto in barra e scheda; in inglese "Your values win over the ones read from the file." | `run3/it-014-…`, `run3/it-015-…`, `run4-en/en-014-…`, `detail-pane-geometry` |
| N5 | importante | "Paper simili": sottosezione "Vicini ma non sembra" / "Close but do not look it" (testo rotto in entrambe le lingue); chip "70%" e "testo" senza spiegazione; il simile è un link che apre il lettore senza dirlo | `run3/it-016-library-detail-similar-light-1280x800.png`, `run4-en/en-016-library-detail-similar-light-1280x800.png` |
| N6 | importante | "Citazioni": due clic per vedere qualcosa ("Mostra le citazioni", poi "Aggiorna"); offline l'errore rosso sta **sopra** la spiegazione, che è un paragrafo di 4 righe sulla privacy | `run3/it-018-library-detail-citations-refresh-offline-light-1280x800.png` |
| N7 | importante | Export: fuoco perso dopo "Esporta", Esc inefficace, conferma fuori vista, "Esporta" grigio (sintesi 13) | `export-focus-after-run` = `body` (it, en) |
| N8 | minore | Export: percorso assoluto mostrato due volte in monospazio; "Dimensione per un agente / Size for an agent … (index 108)"; risultato in un `<dl>` senza stile; "Mostra la cartella" più piccolo degli altri pulsanti | `run3/it-023-…`, `run3/it-027-export-result-light-1280x800.png` |
| N9 | importante | Ripristino: pulsanti tagliati, nessun avviso sulla cartella non vuota alla scelta, due librerie omonime, nessun "Apri la libreria ripristinata" (sintesi 14) | `run3/it-175…181-*`, `run4-en/en-153…159-*` |
| N10 | minore | Ripristino riuscito: "Le tue impostazioni attuali sono state mantenute." fuori dal riquadro e senza margine | `run3/it-179-…` |
| N11 | minore | Backup: "Backup automatici da conservare" grigio quando la frequenza è "Spento", senza motivo; titolo "Backup" dentro "Backup e ripristino"; 4 pulsanti uguali per backup ("Ripristina…" pari a "Rimuovi") | `run3/it-171-…`, `run3/it-174-settings-backup-list-light-1280x800.png` |
| N12 | minore | Console: `MaxListenersExceededWarning: 11 rl:event listeners added` durante il backup (possibile perdita di ascoltatori a ogni apertura della sezione) | record di `run3/it-172-settings-backup-running-…` |
| N13 | importante | MCP acceso: nomi tecnici degli strumenti (`search_library, get_document, read_pages…`) tra le impostazioni normali; avviso di sicurezza sulla porta senza un'azione; campo porta largo 540 px per 5 cifre; "PROPORRE" in maiuscolo; stato in `<dl>` senza stile | `run3/it-114-…`, `run3/it-115-…`, `run4-en/en-093-…` |
| N14 | minore | Scorciatoie: avviando la registrazione la colonna "Tasto" cambia larghezza e la tabella salta (x 597 → 551); "Cambia" resta grigio pieno; solo "Ripristina tutte", nessun "Annulla le modifiche". Il conflitto è invece chiaro (riga rossa + riquadro "Two commands cannot share a key") | `run3/it-118-…`, `run3/it-119-…`, `run4-en/en-098-settings-shortcut-conflict-light-1280x800.png` |
| N15 | minore | Riga della Libreria con un tag: il chip copre il percorso del file (altezza fissa) | `run3/it-181-…`, `run3/it-140-m-library-detail-dark-1280x800.png` |
| N16 | minore | Il pannello Cronologia non si chiude con Esc (`history-panel-closes-on-escape` = falso) | `run3/it-039-history-panel-light-1280x800.png` |
| N17 | minore | Lettore: il campo pagina dice "2 di 2" mentre è visibile l'inizio della pagina 1 | `run3/it-061-…`, `run3/it-062-…` |
| N18 | minore | Guida: "second brain" in italiano; "doppio clic per aprirlo nel lettore" falso; "I tuoi originali non vengono mai modificati" da rivedere con la scrittura nel PDF | `run3/it-042-…` |
| N19 | minore | Contrasto: i soli testi sotto WCAG AA restano i badge di formato ("MD" 4,37 e 3,67; "PDF" 3,05 e 2,5 in scuro), uguali in it e en | `metrics-it.json`, `metrics-en.json` |
| N20 | importante | Prima schermata sempre in italiano ("Benvenuto", "Avanti") anche per chi usa il sistema in inglese: la lingua iniziale non segue quella del sistema | `run4-en/en-001-wizard-step1-Benvenuto-light-1280x800.png` |
| N21 | importante | Le scorciatoie di sezione non seguono l'ordine della barra laterale: Alt+1 Libreria, Alt+2 Progetti, **Alt+3 Rete**, Alt+4 Arrivi, Alt+5 Proposte; Scopri (terza voce) non ne ha | `run4-en/en-098-…` |
| N22 | importante | Arrivi/Inbox: menu "Modello" e "Ragionamento" in testa alla vista senza dire a cosa servono; il nome del file è mostrato in MAIUSCOLO ("NEW-ARRIVAL.PDF"), cosa scorretta per un nome di file | `run4-en/en-064-…`, `run3/it-086-…` |
| N23 | minore | Impostazioni AI: "Salva" attaccato al titolo della sezione successiva ("API KEY (OPTIONAL)") senza spazio | `run4-en/en-101-…` |

---

## Lettore PDF

### Causa della deformazione (confermata e quantificata)

- `apps/desktop/src/renderer/src/styles.css:451-454`:
  ```css
  .page { max-width: 860px; padding: var(--space-5) var(--space-6) var(--space-6); }
  ```
  È la classe delle pagine dell'app, ma pdf.js chiama `page` ogni pagina del documento. Con `box-sizing: border-box` globale il div della pagina riceve `max-width: 860px` e un padding di 24/32 px (`pageRulesFromAppCss` elenca la regola dell'app e le due di pdf.js sullo stesso elemento).
- pdf.js imposta larghezza e altezza in linea (`width: round(down, var(--total-scale-factor) * 595px, var(--scale-round-x))`) e la tela è `position:absolute; width:100%; height:100%` del riquadro. Oltre 860 px `max-width` taglia la larghezza, l'altezza resta: la bitmap viene stirata in un riquadro più stretto. Lo strato di testo non ha la classe `page` e mantiene la larghezza vera. Il `canvasWrapper` misura 796×1759 (riquadro meno il padding).
- `apps/desktop/src/renderer/src/views/reader/engine.ts:2` importa `pdfjs-dist/web/pdf_viewer.css` intero. Vite lo mette nel chunk pigro `ReaderView-*.css`, che resta nel documento dopo la prima apertura: 156 regole valide per tutta l'app. Classi in comune misurate: `.dialog`, `.page`, `.selected`, `.sidebar`, `.textLayer`. A lettore aperto la regola `.sidebar` di pdf.js colpisce `aside.sidebar` dell'app; a dialogo aperto anche `.dialog`.

| Finestra | Area del PDF | Riquadro pagina | Tela CSS | Bitmap | Strato di testo | Rapporto | Effetto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1280×800, adatta (81%) | 661×557 | 645×910 | 645×910 | 768×1092 | 645×910 | 0,709 | +0,8% in larghezza (arrotondamento a 5 px con DPR 1,198) |
| 1280×800, 100% | — | 790×1120 | 790×1120 | 948×1344 | 790×1120 | 0,705 | quasi esatto |
| 1024×700, adatta (49%) | 405×389 | 390×550 | 390×550 | 462×660 | 390×550 | 0,709 | +1,3% in larghezza |
| 1920×1080, adatta (162%) | 1300×895 | **860×1815** | **860×1815** | 1536×2178 | **1285×1815** | **0,474** | glifi al 66,9% in larghezza |

Evidenziazione a 1920×1080: selezione e annotazione coincidono tra loro (x 569, larghezza 460) ma i glifi sono in x 529, larghezza 308: scarto 40 px a sinistra, 192 px a destra, sovrapposizione 58%. L'annotazione salvata conserva lo scarto a ogni dimensione (N1).

Come dovrebbe essere: nessuna classe globale generica (`.page`, `.sidebar`, `.dialog`, `.selected`); il CSS di pdf.js ridotto a ciò che serve e limitato al lettore; un e2e che confronta il rapporto della pagina con la MediaBox (tolleranza 0,5%: va trattato anche l'arrotondamento per DPR frazionario), uno che verifica che nessuna regola del foglio del lettore colpisca elementi fuori dall'area del PDF (la funzione `leakedRules` dello script è già quel controllo), e la riparazione N1.

### Altri risultati del lettore

- **importante** — Barra su due righe a 1280 px ("Note ed evidenziazioni"/"Notes and highlights" va a capo); campo pagina largo come un campo di testo; "di 2"/"of 2" su due righe; titolo troncato (`run3/it-045-…`, `run5-en-reader/en-046-…`).
- **importante** — Riga "studio" più un paragrafo di scorciatoie di 4 righe sempre visibile: documentazione, non interfaccia.
- **importante** — Annotazione: barra in fondo alla finestra; "Evidenzia" e "Sottolinea" entrambi primari; colore scelto dopo; nessuna anteprima; sottolineatura di 2 px quasi invisibile a zoom basso (`run3/it-051-reader-after-underline-light-1280x800.png`). Come dovrebbe essere: strumenti a stato (Seleziona `V`, Evidenzia `H`, Sottolinea `U`, colore attivo visibile), trascinamento che crea subito l'annotazione, Spazio per alternare strumento corrente e ultimo, Esc che torna a Seleziona, commento in un popover accanto all'annotazione.
- **importante** — Clic su un'annotazione: la barra di modifica è in fondo, non vicino al segno (`run3/it-052-…`).
- **minore** — Ricerca nel documento: 7 controlli con etichette lunghe (`run3/it-053-reader-find-light-1280x800.png`). Funzione potente: da tenere.
- **minore** — 4 schede del pannello su due righe a 340 px (`run3/it-054…057-*`).
- **importante** — Il lettore resta "dentro" Libreria; "← Torna alla libreria" è l'unica uscita visibile.
- **minore** — Pagina bianca senza bordo né ombra su fondo quasi bianco o quasi nero (`run3/it-063-reader-open-fit-dark-1280x800.png`).
- **minore** — A 1920 px barra di scorrimento orizzontale dovuta allo strato di testo più largo.

### Evidenziazioni e PDF originale (punto dell'utente)

Oggi: annotazioni nella cartella dati (`.lab/`), mai nel PDF; nessuna spiegazione nel lettore; guida in contraddizione. Decisione dell'utente: le evidenziazioni vanno **scritte nel PDF originale**. Requisiti di design: lo stato "nel PDF / solo nell'app / in attesa / rifiutato (motivo)" visibile per documento nel lettore; la riparazione N1 prima della prima scrittura; i rischi tecnici in B.2.

---

## Navigazione e struttura generale

- **importante** — Barra laterale: 6 voci solo testo; sopra un `<select>` "Libreria attiva" e un link "Nuova libreria"; in fondo un secondo selettore della lingua.
- **importante** — Chat chiusa: aletta di 44 px con un solo "‹", senza etichetta.
- **importante** — Annulla / Ripeti / Cronologia ripetuti nelle barre di Libreria, Progetti e Proposte; Cronologia non si chiude con Esc (N16).
- **importante** — Scorciatoie Alt+N non nell'ordine della barra laterale (N21).
- **minore** — Tavolozza: le prime 9 voci sono richieste all'AI che riempiono il campo della chat; "Esporta il secondo cervello" ed "Esporta come secondo cervello…" convivono (`run3/it-040-…`, `run3/it-041-…`).
- **importante** — Toast che attraversano i cambi di sezione (sintesi 10).
- **minore** — Ordine di tabulazione corretto e fuoco visibile ovunque misurato: da tenere.

## Procedura guidata (primo avvio)

- 7 passi, 11 clic fino alla libreria (`wizard-clicks` = 11, it e en). Prima schermata sempre in italiano (N20).
- **minore** — "Chi sei" chiede ORCID e id OpenAlex al primo minuto (`run3/it-002-…`, `run4-en/en-002-wizard-step2-About_you-light-1280x800.png`).
- **minore** — Passo AI: casella obbligatoria "Ho capito che per ora nulla verrà inviato a Claude" (`run3/it-007-…`).
- **minore** — "Scegli un'altra cartella…" incollato al percorso; percorso assoluto completo in monospazio (`run3/it-004-…`).
- **minore** — Riaperta dalla barra laterale: "Annulla" come link e, dietro, testo obsoleto (`run3/it-124-…`).
- **minore** — Carta di benvenuto di 250 px sopra la Libreria; tre "Nascondi" (`run3/it-009-…`).

## Libreria

- **importante** — Tre righe di barra; "Chiedi a Claude"/"Ask Claude" accanto alla ricerca apre la ricerca AI, non la chat (`run3/it-033-advanced-search-dialog-light-1280x800.png`).
- **minore** — Sintassi di ricerca sempre visibile: rumorosa ma utile; **da non perdere**.
- **importante** — Barra di selezione: 6 azioni uguali su due righe (tre a 1024 px, 130 px) che spingono giù l'elenco (`run3/it-019-…`, `run3/it-164-…`).
- **minore** — Icone di riga (≡ ↗ ⌂) piccole, senza etichetta, solo al passaggio.
- **importante** — "Aggiorna citazioni" offline: toast "avviato, seguilo nella barra di stato" e insieme "fallito 0/4" (`run3/it-028-…`).
- **minore** — Griglia: miniature piccole in carte grandi (`run3/it-011-…`). Chip del tag sul percorso (N15).
- Ricerca: immediata, sintassi ricca, indica dove ha trovato il testo (`run3/it-029-…`, `run3/it-030-…`, `run4-en/en-029-…`): **da tenere**.

### Scheda del documento

- Apertura: N2; doppio clic = programma esterno; pannello di sinistra nascosto (N3).
- Contenuto (`detail-pane-geometry`): Dati, Studio, Note sul file, La mia descrizione, Tag, Citazioni, Paper simili, File; 2319 px in 593 visibili; parte in modifica (N4). Per l'uso quotidiano serve prima una vista di lettura (titolo, autori, stato, tag, azioni) e la modifica su richiesta.
- "Paper simili" (N5), "Citazioni" (N6). Il riquadro "Generato dall'AI" vuoto occupa 130 px per dire "nessun contenuto".
- Sezione File: `<dl>` senza stile (`run3/it-015-…`).

## Tassonomia

- **importante** — Modalità della Libreria, non un luogo (`run3/it-034-…`, `run4-en/en-035-taxonomy-new-form-light-1280x800.png`); in inglese il modulo "New top-level tag" ha "Create" grigio accanto al campo vuoto e "Find a tag" con un campo largo la metà.
- **importante** — Editor del nodo lungo e denso (`run3/it-036-taxonomy-node-editor-light-1280x800.png`).
- **minore** — Creare due tag ha avviato una scansione.

## Progetti, Scopri, Rete

- **importante** — Progetto: "Tutti i progetti" a sinistra del titolo, due badge ed "Esporta come secondo cervello…" sulla stessa riga; progetto vuoto senza "Aggiungi documenti…" (`run3/it-067…070-*`).
- **minore** — "Progetto"/"Collezione" senza spiegazione (`run3/it-066-…`, `run3/it-071-…`).
- **importante** — Scopri: quattro schede vuote finché non si aggiornano le citazioni dalla Libreria, senza il pulsante nello stato vuoto (`run3/it-072…076-*`).
- **importante** — Rete: "Seme" in primo piano; mappa con quadratini di 4 px; scheda "Rete" con 3 selettori, 6 caselle e 5 pulsanti disattivati prima del grafo vuoto; "Qui non c'è nulla." (`run3/it-077…082-*`, `run4-en/en-055…060-*`).
- **minore** — Dialogo delle etichette: "Livello 1" come pulsante, "nessuno(1)" incollato (`run3/it-112-…`).

## Arrivi e proposte dell'AI

- Badge: sintesi 6.
- **importante** — "Trovato nella libreria" e "trascinato" hanno lo stesso modulo; per il primo l'azione richiesta non è spiegata (`run3/it-086-…`, `run3/it-087-…`, `run3/it-inbox-card-detail.png`).
- **importante** — Ogni arrivo è un modulo più alto di una schermata; nessun "conferma tutto"; Modello/Ragionamento in testa senza spiegazione e nome del file in maiuscolo (N22).
- **minore** — Offline: "senza connessione · Riprova" come badge grigio poco visibile.
- **importante** — Proposte dell'AI: carte grandi, Accetta/Modifica/Rifiuta ripetuti per campo; utile la marcatura viola (`run3/it-110-…`, `run3/it-111-…`).

## Chat, AI, lavori in blocco

- **importante** — Pannello chat: "Modello" e "Ragionamento" come due grandi menu, "Invia" piccolo, riga di scorciatoie fissa (`run3/it-104-…`, `run4-en/en-084-…`); blocco strumento più largo del pannello in inglese (sintesi 11).
- **importante** — Anteprima "Inviare a Claude?" a ogni messaggio senza "non chiedere più per questa conversazione" (`run3/it-105-…`).
- **minore** — Blocco strumento con nome tecnico `search_library` e testo inglese nell'interfaccia italiana (fornitore simulato) (`run3/it-106-…`).
- **importante** — "Proponi con l'AI": conferma sotto la piega; senza cartelle abilitate il dialogo si apre e dice in fondo "non c'è nulla da inviare" (`run3/it-108-…`, `run3/it-021-…`).

## Esportazione (flusso completo)

Percorso: seleziona › "Esporta come secondo cervello…" › "Cambia cartella…" › nome › "Esporta" › "Esporta comunque" › risultato: 8 clic.
- **importante** — 1253 px in 688 visibili; l'intestazione scorre via (nessun titolo né × a metà dialogo) (`run3/it-023-…`).
- **importante** — N7 (fuoco, Esc, conferma fuori vista); avviso due volte e due "Annulla" (`run3/it-025-…`).
- **minore** — N8.
- Risultato chiaro con contatori, "Esporta di nuovo" e "Mostra la cartella" (`run3/it-027-…`): da tenere.

## Impostazioni (punto dell'utente)

- **importante** — Pagina unica (sintesi 4). Per sezione (altezza px / controlli, prima dell'AI, italiano): Tu e l'interfaccia 759/8, Librerie 227/3, Impostazioni della libreria 602/6, Fonti online 325/4, Claude (AI) 1378/24, Server MCP 1177/7 (1183/7 acceso), Chiavi API 199/3, Backup 883/6, Scorciatoie 1242/50, Manutenzione 852/8.
- **importante** — Stati AI e MCP in `<dl>` senza stile (`run3/it-115-…`, `run3/it-123-…`).
- **importante** — Modelli: id ed etichetta a mano con "Rimuovi" (`run4-en/en-101-…`): da sviluppatore.
- **importante** — Tre posti per le chiavi (Anthropic, OpenAlex, Gemini).
- **importante** — Backup con destinazione nella libreria: errore rosso più "Scegli prima una cartella" (messaggi in conflitto) (`run3/it-117-…`).
- **minore** — Salvataggio misto ("Salva" per alcune sezioni, applicazione immediata per altre); N23.
- **importante** — MCP acceso: N13; posto giusto: "Sviluppatore / Avanzate" con una riga di spiegazione.
- **minore** — Scorciatoie: N14; 17 righe × 3 pulsanti; registrazione, Esc e conflitto funzionano (`run3/it-119-…`, `run4-en/en-098-…`).
- **minore** — Manutenzione: diagnostica leggibile ma tecnica (`run3/it-122-…`).

### Backup e ripristino (flusso completo)

- Backup verso una cartella valida: 3 clic, stima prima e verifica dopo (`run3/it-171…174-*`): **da tenere**. N11, N12.
- Ripristino: N9, N10. Il testo introduttivo è buono; il consiglio finale ("ripristina in una cartella diversa e poi togli dall'elenco la libreria che non vuoi più") descrive un flusso in tre passi che l'app potrebbe offrire come azione.

### Inventario completo delle impostazioni attuali

Legenda "chi": T = tutti, P = utente esperto, S = sviluppatore. Fonte: `packages/core/src/settings.ts`, `apps/desktop/src/renderer/src/settings/*.tsx`, schermate `run3/it-089…138`.

| Impostazione | Dove (sezione) | Predefinito | Ambito di salvataggio | Chi |
| --- | --- | --- | --- | --- |
| Lingua dell'interfaccia | Tu e l'interfaccia; barra laterale; procedura guidata | `it` | app (questo computer) | T |
| Aspetto (sistema/chiaro/scuro) | Tu e l'interfaccia | `system` | app | T |
| Nome | Tu e l'interfaccia; procedura guidata | vuoto | app | T |
| Nomi con cui compari tra gli autori | Tu e l'interfaccia; procedura guidata | vuoto | app | P |
| Email | Tu e l'interfaccia | vuoto | app | P |
| ORCID | Tu e l'interfaccia | vuoto | app | P |
| Id autore OpenAlex | Tu e l'interfaccia | vuoto | app | P |
| Elenco librerie: attiva, rinomina, rimuovi dall'elenco, nuova | Librerie; selettore nella barra laterale | — | app | T |
| Cartella dati della libreria (`dataDirName`) | solo procedura guidata | `.lab` | app | S |
| Nome della libreria | Impostazioni della libreria | dal nome scelto | library.json | T |
| Lingua dei documenti | Impostazioni della libreria; procedura guidata | `it` | library.json | T |
| Cartelle escluse | Impostazioni della libreria | nessuna | library.json | P |
| Preset di export | Impostazioni della libreria; dialogo export | nessuno | library.json | P |
| Estensioni scansionate | nessuna interfaccia | pdf, md, txt, tex, rst, docx, pptx, ipynb | library.json | S |
| Estensioni solo per nome | nessuna interfaccia | nessuna | library.json | S |
| Giorni prima di eliminare i record dei file cancellati | nessuna interfaccia | 30 | library.json | S |
| Invia a OpenAlex l'email del profilo | Fonti online | spento | app | P |
| Chiave API OpenAlex | Fonti online | non salvata | archivio sicuro | P |
| Programma Claude Code | Claude (AI) | automatico | app | S |
| Fornitore AI | Claude (AI) (solo stato) | `claude-agent-sdk` | library.json | S |
| Chiave API Anthropic | Claude (AI) | non salvata | archivio sicuro (app) | P |
| Cartelle abilitate a Claude | Claude (AI); procedura guidata | nessuna | library.json | T |
| Conferma con anteprima prima di ogni invio | Claude (AI) | acceso | library.json | T |
| Modelli (id, etichetta; prezzi solo nei dati) | Claude (AI) | Haiku 5.5, Sonnet 5.5, Opus 5.5 | library.json | S |
| Modello predefinito | Claude (AI) | `claude-haiku-5-5` | library.json | P |
| Ragionamento predefinito | Claude (AI) | `low` | library.json | P |
| Tetto di spesa mensile (USD) | Claude (AI) | nessuno | library.json | P |
| Conferma i lavori in blocco sopra (USD) | Claude (AI) | 0,50 | library.json | P |
| Registro degli invii a Claude | Claude (AI) | — | locale | P |
| Server MCP acceso | Server MCP | spento | library.json | P |
| Scrittura MCP (proposte di campi AI) | Server MCP (con conferma) | spenta | library.json | S |
| Porta MCP | Server MCP | automatica | locale | S |
| Copia comando / voce `.mcp.json` | Server MCP | — | — | S |
| Cambia il token MCP | Server MCP (con conferma) | — | archivio sicuro | S |
| Registro chiamate MCP | Server MCP | — | locale | S |
| Chiave API Gemini | Chiavi API | non salvata | archivio sicuro (libreria) | S |
| Cartella di destinazione dei backup | Backup e ripristino | nessuna | app | T |
| Backup automatico | Backup e ripristino | spento | app | T |
| Backup automatici da conservare | Backup e ripristino | 5 (1-50) | app | P |
| Includi cronologia chat, contatori e stato di lettura | Backup e ripristino | acceso | per esecuzione | P |
| Ripristino (radice, nome, impostazioni, dati locali) | dialogo di ripristino | — | — | P |
| Scorciatoie (17 comandi) | Scorciatoie da tastiera | `packages/core/src/shortcuts.ts` | app | P |
| Diagnostica, log, memoria, pulizia, rapporto | Manutenzione e prestazioni | — | — | S |
| Benvenuto visto / suggerimenti chiusi | carta di benvenuto | falso / nessuno | app | T (implicito) |
| Vista Libreria, scheda laterale, chat aperta, pannello del lettore | `localStorage` (`rl.libraryView`, `rl.libraryTab`, `rl.chatOpen`, `rl.readerSide`) | elenco, cartelle, chiusa, aperto | browser locale | T (implicito) |
| Variabili d'ambiente `RL_*` | nessuna interfaccia | — | ambiente | S (solo sviluppo/test) |

Raggruppamento proposto: **Generale** (lingua, aspetto, profilo essenziale), **Libreria** (nome, lingua documenti, cartelle escluse, scansione), **Claude** (account e accesso, cartelle abilitate, conferma, tetto di spesa), **Backup**, **Scorciatoie**, **Sviluppatore / Avanzate** (programma Claude Code, fornitore, modelli e prezzi, MCP completo, chiave Gemini, estensioni, giorni di pulizia, cartella dati, manutenzione e diagnostica, registri).

---

## Interfaccia inglese

Schermate `run4-en/en-001…159` e `run5-en-reader/en-042…062`. Struttura e difetti uguali all'italiano (stesse misure di contrasto, stessa deformazione del lettore, stessa contaminazione CSS, stesso fuoco perso nell'export, stesso ripristino tagliato); in più:
- **importante** — Prima schermata in italiano (N20).
- **importante** — Testi rotti: "Close but do not look it" (`run4-en/en-016-…`); "Your values win over the ones read from the file." (`run4-en/en-014-…`).
- **importante** — Tre nomi per la cartella di arrivo: "Inbox" (barra laterale), "Arrivals" (scheda), "Go to Arrivals" (scorciatoia); "AI proposals" vs "Go to AI proposals to review" (`run4-en/en-064-…`, `run4-en/en-098-…`).
- **minore** — Gergo e calchi: "Propose with AI…" (meglio "Suggest with AI…"), "Export second brain…" nella barra e "Export as second brain…" altrove, "Size for an agent: about 1,176 tokens (index 108)", "Rebuild index" come link, "Show missing documents" (meglio "Show missing files").
- **minore** — I testi inglesi sono più lunghi: impostazioni 8309 px contro 8142; "Show in folder" e "Propose with AI…" vanno a capo su tre righe nella scheda; nessun titolo tagliato in modo illeggibile, ma 8 schermate su 159 hanno titoli con puntini (chat aperta, 1024 px).
- **minore** — Date e numeri seguono la lingua (11/17/2026, 10:36:07 PM; 1,176): corretto.
- Chiari e da tenere: il conflitto delle scorciatoie ("Two commands cannot share a key. Fix this to save"), l'introduzione del ripristino, le frasi sull'AI ("Written by the AI, read-only. Your own fields are kept apart.").

---

## Temi e dimensioni (matrice)

Schermate `run3/it-139…170-m-*` e `run4-en/en-117…148-m-*` (scuro 1280×800, chiaro e scuro 1920×1080, chiaro 1024×700).
- **importante** — 1024×700: barra di stato di 100 px su 5 righe, barra di selezione su 3 righe, elenco con 2,5 righe visibili (`run3/it-164-…`).
- **importante** — Dopo il lettore la barra laterale è una "carta" fluttuante in tutte le schermate della matrice (sintesi 2).
- **minore** — Scuro: contrasto buono tranne i badge di formato (N19); pagina PDF bianca senza bordo.
- **minore** — 1920×1080: pagine dell'app larghe 860 px a sinistra con 800 px vuoti a destra (`run3/it-153-m-settings-light-1920x1080.png`, `run3/it-149-m-projects-light-1920x1080.png`).
- **minore** — A 1024 px la finestra risulta larga 1025 px (scala frazionaria): misure valide.

## Cosa funziona e va tenuto

- La **ricerca**: immediata, sintassi ricca, indica dove ha trovato il testo, stato vuoto chiaro (richiesta dell'utente: va tenuta).
- **Contrasto e fuoco**: in 344 schermate (it + en) i soli testi sotto WCAG AA sono i badge di formato; fuoco sempre visibile, Tab in ordine.
- **Trasparenza sull'AI**: anteprima, costo, registro, marcatura "Generato dall'AI".
- **Backup**: stima prima, verifica dopo, ripristino come nuova libreria senza sovrascrivere.
- **Export**: risultato con contatori e protezione delle modifiche fatte a mano; avviso prima di esportare documenti non abilitati all'AI.
- **Scorciatoie**: registrazione, Esc e conflitti chiari.
- Procedura guidata breve con passo e totale; temi coerenti nei token; Annulla/Ripeti con cronologia.

## Limiti di questo audit (cosa non si è potuto provare e perché)

- **Vero trascinamento di file dal sistema**: Playwright non trascina file del sistema operativo in Electron; provati la sovrapposizione con un evento simulato e l'aggiunta via IPC.
- **Finestre native** ("Apri un file di backup…", "Scegli…" dell'eseguibile di Claude Code): nessun aggancio di test; con la finestra fuori schermo bloccherebbero l'esecuzione.
- **Tassonomia in inglese**: il passo dello script fallisce dopo il primo tag (il pulsante "Create" è attivo; il secondo inserimento non trova il campo): difetto dello script non risolto; la tassonomia è coperta in italiano.
- **Account Claude e fornitore reali**: solo fornitore simulato (regola 6).
- **PDF protetto, danneggiato o scansionato senza testo**: le librerie sintetiche non ne contengono; lo stato d'errore del lettore non è stato visto.
- **Rete reale** (citazioni, Scopri con dati): prove offline per regola.
- **DPR 1, 1,25, 1,5**: la macchina ha 1,198; la deformazione residua (+0,8/+1,3%) va rimisurata con altre scale.
- **Librerie grandi, progetti pieni**: fuori dallo scopo delle librerie sintetiche (4-6 documenti); i carichi sono in `qa-*`.

---

## Attacco al progetto dell'architetto

Oggetto: `docs/design/ARCHITETTURA-UI.md` sul ramo `design-arch` (5d56f8b; il documento è identico a 32e13c8, 1026 righe) **più** le decisioni D-325…D-344 dello stesso ramo, che descrivono il "giro 2". Riferimenti "§" al documento, "D-" alle decisioni.

Giudizio sintetico: la struttura (Libreria, Da rivedere, Progetti, Scopri, Mappa + Claude/Aiuto/Impostazioni; chip Attività; Impostazioni a 7 sezioni con "Sviluppatore / Avanzate"; lettore a strumenti) risponde alle richieste dell'utente, e il giro 2 corregge molte debolezze del primo (CSS di pdf.js, Invio e doppio clic, Annulla in un posto solo, disposizione adattiva, salvataggio uniforme). Restano tre punti deboli: (1) la scrittura nei PDF è progettata come problema di formato e non di **consenso, cartella sincronizzata e dati già storti**; (2) il documento sul ramo non contiene ancora il giro 2 (D-325 parla di una tabella "§0" che nel file non c'è): oggi due fonti si contraddicono, e un compito che legge solo il documento implementerà il primo giro; (3) l'ordine delle onde lega correzioni urgenti e semplici a parti rischiose.

**Problema 0 (importante): due fonti in disaccordo.** Esempi: §8.1 rinomina solo `.page`, D-326 rinomina sette classi e usa `@layer`; §4.3 lascia la barra di studio come menu, D-332 cambia i tasti; §8.3.7 `author: 'profile'`, D-328 `'none'`; §6 sezioni con "Salva", D-336 salvataggio automatico. Correzione: riscrivere il documento con il giro 2 **prima** di assegnare qualsiasi compito, e togliere dal documento ciò che le decisioni superano.

### A. I risultati dell'audit: il progetto li risolve?

| # | Risultato | Risolto? | Dove | Cosa manca |
| --- | --- | --- | --- | --- |
| S1 | PDF deformato, evidenziazioni fuori posto | **sì** per il CSS | §8.1, D-326 | **No** per le annotazioni già salvate storte (N1): nessuna riparazione prevista |
| S2 | `pdf_viewer.css` contamina l'app | **sì** (giro 2) | D-326 (rinomine, `@import … layer(pdfjs)`, test delle classi e dello stile della barra laterale) | Il documento §8.1 non lo dice ancora; `@layer` fa vincere l'app nei conflitti ma **non impedisce** alle regole di pdf.js di applicarsi a proprietà che l'app non imposta (es. `--sidebar-*`, `position`): serve anche `@scope (.reader-pages)` o un foglio filtrato. `.textLayer` "voluta" va verificata: l'app la usa per la ricerca? |
| S3 | Annotazione senza strumenti | **sì** | §8.2, D-332 | Vedi B.5 |
| S4 | Impostazioni in una pagina | **sì** | §6, §4.6-4.8, D-336, D-341 | Stato "salvato/errore" per campo non disegnato |
| S5 | Account Claude | **sì, con rischi** | §10, D-330 | B.4 |
| S6 | Badge Arrivi | **sì** | §7.1, D-338 | B.3 (badge che diventa enorme) |
| S7 | Scansione nascosta | **sì** | §9 | — |
| S8 | Evidenziazioni non nel PDF | **sì (decisione dell'utente)** | §8.3, D-316…D-318, D-331 | B.2 (consenso, sincronizzazione, dati storti) |
| S9 | Poco spazio per il PDF | **parzialmente** | §4.3 | La barra in alto del guscio aggiunge una riga sopra il lettore; la barra del lettore resta su due righe (B.6) |
| S10 | Barra di stato come notifiche, toast | **sì** | §7 | Tabella evento → mezzo mancante (B.3) |
| S11 | Chat che rompe la Libreria | **sì** | D-335 | Soglie da verificare (B.6) |
| S12 | Scheda difficile da aprire | **sì** | D-333 | Con "un clic mostra la scheda" a 1280 px **ogni** clic nasconderebbe il pannello di sinistra (N3) se la soglia di D-335 non scatta prima: va misurato |
| S13 | Export: fuoco perso, conferma fuori vista | **parzialmente** | D-339 (piede sempre visibile) | Fuoco dopo "Esporta" e Esc non citati: il piede fisso non basta se il fuoco resta su `body` |
| S14 | Ripristino tagliato, librerie omonime | **parzialmente** | D-339 (piede visibile nei dialoghi lunghi: export e lavori AI) | Il dialogo di ripristino non è citato; nomi duplicati e "Apri la libreria ripristinata" mancano |
| S15 | Gerarchia, stati dei pulsanti, `<dl>`, testi | **parzialmente** | §5.5, D-340 (livelli di pulsante), §11 | Stati hover/fuoco/disattivato e componente chiave–valore assenti (B.9); testi rotti N5 non citati |
| N2-N4 | Scheda: apertura, pannello nascosto, modulo lungo | **parzialmente** | D-333 | La scheda resta un modulo di modifica (§4.2 mostra una vista di lettura, ma nessuna regola dice "lettura prima, modifica su richiesta") |
| N5-N6 | Simili e Citazioni | **no** | — | Testi e "due clic per vedere le citazioni" non trattati |
| N9-N11 | Ripristino e backup | **no** | §6 sposta il backup ma non lo ridisegna | Pulsanti tagliati, campo grigio senza motivo, 4 pulsanti uguali |
| N12 | Avviso di ascoltatori in console | **no** | — | Da correggere nel compito che tocca `lib/events` |
| N13 | MCP tecnico tra le impostazioni normali | **sì** | §6.2 (Avanzate) | — |
| N14 | Scorciatoie: tabella che salta | **no** | — | Larghezze di colonna fisse |
| N15 | Chip del tag sul percorso | **parzialmente** | §5.3 (righe 36/56 px) | Con tag e frammento serve una terza altezza o il troncamento del chip |
| N16 | Cronologia non si chiude con Esc | **sì** | D-334 | — |
| N20 | Prima schermata in italiano | **no** | — | Lingua iniziale dal sistema (`app.getLocale()`), "Benvenuto/Welcome" nella lingua rilevata |
| N21 | Alt+N fuori ordine | **sì** | §2, A2 (Alt+1…5 nell'ordine nuovo) | — |
| N22 | Modello/Ragionamento in Arrivi, nome in maiuscolo | **parzialmente** | D-338 (righe compatte) | Non detto dove vanno modello e ragionamento della cartella di arrivo |
| N23 | Spaziatura di "Salva" | **sì** | D-336 (niente pulsanti Salva) | — |

### B. Problemi del progetto (con correzione proposta)

#### B.1 CSS del lettore (importante)
- D-326 è la correzione giusta, ma `@layer` regola solo chi vince nei conflitti: le dichiarazioni di pdf.js su proprietà che l'app non tocca continuano a valere su ogni elemento con quella classe. Le rinomine bastano solo se **nessuna** classe dell'app coincide con una di pdf.js, oggi e domani. Correzione: `@scope (.reader-pages) { @import … }` (o foglio filtrato a build time) **e** il test delle classi; il test `leakedRules` di questo audit come e2e permanente.
- §8.1 dice che la scala frazionaria "non è la causa": vero per il fattore 0,67, ma resta una deformazione di +0,8/+1,3% a DPR 1,198 (arrotondamento a 5 px separato sui due assi). Il criterio "entro 0,5%" di D-326 **fallirà** su questa macchina se non si tratta anche questo (altezza derivata dalla larghezza arrotondata, non arrotondata a parte).
- Manca la riparazione N1: un compito che, all'apertura di un documento, ricalcola i rettangoli delle annotazioni salvate con la pagina deformata (si riconoscono confrontandoli con le posizioni del testo citato nello strato di testo) e lo dice all'utente ("3 evidenziazioni riposizionate"). Va fatto **prima** della prima scrittura nel PDF.

#### B.2 Scrittura nei PDF originali (bloccante prima dell'onda 4)
Il formato è progettato con cura e il giro 2 aggiunge riconciliazione, giornale dei temporanei, rifiuto dei segnaposto di OneDrive e gestione delle copie in conflitto (D-331). Restano:
1. **Consenso.** `writeToPdf` predefinito acceso (D-316) anche per le librerie esistenti; il banner "primo uso" (§8.3.5) arriva **dopo** la prima scrittura. La regola 1 è tra i "Vincoli che non si negoziano" di `CLAUDE.md`: l'utente l'ha cambiata, ma deve vederlo prima che succeda al singolo file. Correzione: alla prima evidenziazione di ogni libreria un dialogo "Salvare le evidenziazioni anche dentro i PDF?" con [Sì, anche nel PDF] predefinito e [Solo nell'app]; nelle librerie nuove un passo della procedura guidata. Mai una scrittura senza quel clic.
2. **Lotti ogni 4 s in una cartella sincronizzata.** `copyFile` + `rename` a ogni lotto = il servizio di sincronizzazione ricarica **l'intero file** a ogni lotto (un libro da 80 MB evidenziato per un'ora = decine di caricamenti completi), e ogni sostituzione durante un caricamento può generare una copia in conflitto (D-331 la riconosce, ma meglio non crearla). Correzione: lotti alla chiusura del documento, al cambio di documento e dopo 60 s di inattività (non 4 s); valutare nello spike S2 la scrittura in coda sul file stesso (`r+`, scrittura alla fine, `fsync`) dopo la verifica del prefisso, che non cambia identità del file né attributi e riduce i conflitti.
3. **Due computer.** La regola dello scanner (§8.3.4 punto 2: "prefisso uguale al vecchio hash") tratta come "contenuto cambiato" il file in cui **l'altro** computer ha scritto prima della sincronizzazione del record se anche questo computer ha scritto: le annotazioni diventano "non allineate" e spariscono dal lettore. La riconciliazione di D-331 aggiusta il PDF ma non l'identità. Correzione: classificare un aggiornamento incrementale come "solo annotazioni" **leggendo la revisione aggiunta** (solo `/Annot`, aspetti e pagine in cui cambia solo `/Annots`), indipendentemente da chi l'ha scritta: vale per l'altro computer e per Acrobat, e non serve rileggere il testo.
4. **PDF cifrati con password utente vuota** (permessi dell'editore): molto comuni negli articoli scaricati. Il rifiuto totale (D-331) escluderebbe una parte grande di una libreria reale con un "solo nell'app" che l'utente non capisce. Correzione: nello spike S2 contare la quota su una libreria reale (conteggio locale, nessun nome committato); se rilevante, supportare RC4/AES con password vuota, altrimenti rendere **obbligatoria** "Esporta copia annotata" (oggi facoltativa in onda 5) e scrivere il motivo nel chip ("PDF protetto dall'editore").
5. **Firmati.** Rifiutare solo con una firma presente (`/V`) o `/Perms /DocMDP`, non per `/SigFlags` con campi firma vuoti (moduli).
6. **"Dati dopo `%%EOF`" rifiutati** (D-331): frequenti nei PDF scaricati; si può aggiungere dopo senza toccarli. Correzione: accettarli; supportare `/XRefStm` (xref ibride, non citate).
7. **Ripristino distruttivo.** "Ripristina il PDF originale" e "Ripristina e riscrivi in una revisione" (D-331, al limite di 200) troncano il file e perdono le annotazioni di altri programmi. Correzione: azione principale "Togli dal PDF le evidenziazioni di Research Lab" (una revisione che toglie solo gli oggetti `rl-`); il troncamento in Avanzate.
8. **Copia di sicurezza nella cartella dati sincronizzata** (D-327, provvisoria): raddoppia lo spazio cloud dei PDF annotati. Il prefisso garantito rende il troncamento sufficiente quasi sempre. Correzione: predefinito `'local'`, `'data'` come scelta.
9. **Osservatore dei file.** La propria scrittura arriva all'osservatore prima che `own` sia aggiornato (§8.3.3 punto 8). Correzione: hash atteso registrato in memoria prima della rinomina; evento corrispondente ignorato.
10. **Colori in tema scuro.** §5.2: `screen` al 35% in scuro, ma la pagina PDF resta **bianca**: `screen` su bianco dà bianco, le evidenziazioni spariscono. Correzione: `multiply` sempre sulla pagina.

#### B.3 Notifiche e "Da rivedere" (importante)
- Il badge somma file nuovi e documenti con proposte (§7.1): dopo "Proponi con l'AI" su 300 documenti vale 300 e resta lì; contraddice "i numeri chiedono una decisione". Correzione: numero = file nuovi; per le proposte un punto e il numero sulla scheda interna.
- Manca una tabella evento → mezzo (chip, banner, toast, dialogo) per ogni evento esistente (scansione, citazioni, lavori AI, backup automatico, export, MCP, scritture PDF, tetto di spesa): senza, ogni compito deciderà a modo suo e tornerà la barra di stato. Correzione: la tabella nel documento.

#### B.4 Account Claude (importante)
- "Cambia account…" apre una **console** con `claude auth login` (§10.2): per un utente non tecnico la parte più confusa dell'app, mentre la richiesta era "facilmente". Correzione: il dialogo dice cosa apparirà (finestra di Claude Code, poi il browser); se la CLI lo consente (spike S1) login con URL nel browser senza console; account corrente anche nell'intestazione del pannello Claude.
- L'osservatore di `~/.claude` presume un file di credenziali: dove la CLI usa il Gestore credenziali l'evento non arriva. "Ho finito, verifica" deve essere il pulsante **primario**.
- "Esci da Claude Code…" esce anche dal terminale dell'utente e non serve per cambiare account: nel menu ⋯, non nel flusso principale.
- "Prova la connessione" spende denaro senza anteprima: scriverlo sul pulsante ("Prova · circa 0,001 $").

#### B.5 Lettore a strumenti (importante)
- **Spazio**: D-332 esclude "Spazio tenuto = mano" e Spazio non scorre più. Va bene per la richiesta dell'utente, ma ogni lettore PDF (Chrome compreso) scorre con Spazio: va detto la prima volta (suggerimento "Spazio cambia strumento; per scorrere usa PagGiù") e Maiusc+Spazio/PagGiù devono restare.
- **Tasti a lettera singola** "solo con il fuoco nella regione del lettore" (D-332): dopo un clic nel pannello note o nella ricerca il fuoco cambia regione senza segnale; serve un indicatore dello strumento vicino al punto di lavoro (bordo della pagina o cursore), non solo il pulsante premuto nella barra flottante.
- La barra flottante **sopra** le pagine copre le prime righe a inizio pagina. Correzione: nella barra del lettore o `scroll-padding-top` pari alla sua altezza.
- Gomma con trascinamento (§8.2): un gesto sbagliato cancella molte annotazioni, scritte anche nel PDF. Correzione: oltre 3 annotazioni chiede conferma; Annulla sempre disponibile.

#### B.6 Spazio e finestre piccole (importante)
- D-335 mette il pannello Claude in sovrapposizione sotto 1180 px; tra 1180 e ~1500 px con Claude aperto e la scheda aperta restano circa 300 px per l'elenco (barra laterale 232 + Claude 380 + scheda 360). Correzione: scheda e Claude mai affiancati sotto 1600 px (uno dei due sovrapposto).
- Lettore: barra del guscio + barra del lettore su **due** righe (§4.3) + barra flottante. Correzione: nel lettore la barra del guscio si fonde con quella del lettore in una riga.
- Nessuna larghezza minima della finestra dichiarata (D-335 dichiara solo la vista ≥ 640 px): dire cosa succede a 1024×700.

#### B.7 Cose che confonderanno l'utente
- **"Mappa" contiene "Rete"** (§2): sezione Mappa con schede Mappa e Rete. Correzione: schede "Argomenti", "Citazioni", "Esplora", "Vicini inattesi".
- **"Chiedi a Claude"** nella barra della Libreria apre la ricerca AI, "Claude" nella barra laterale la chat (§4.2 lo mantiene). Correzione: "Cerca con Claude".
- **"Sottolineato"** come stato di studio convive con le sottolineature vere scritte nel PDF: ancora più ambiguo. Correzione: rinominarlo ("Studiato a fondo") o derivarlo dalle annotazioni.
- **Anteprima in linea dopo la prima conferma** (D-339): utile, ma la regola 4 chiede la conferma "di default" prima di ogni invio; un utente può non notare che un turno successivo include un documento nuovo della stessa cartella. Correzione: l'anteprima in linea elenca i documenti **nuovi** rispetto al turno precedente in grassetto, e qualunque documento nuovo (non solo una cartella nuova) riporta il dialogo.
- **Libreria omonima dopo il ripristino**: il progetto non tratta i nomi duplicati nel selettore di libreria (popover §2). Correzione: suffisso automatico "(ripristinata il …)" e cartella radice mostrata nel popover.

#### B.8 Funzioni dimenticate o a rischio (bloccante: nessuna funzione si toglie)
| Funzione di oggi | Nel progetto | Correzione |
| --- | --- | --- |
| Riga della **sintassi di ricerca** | la ricerca passa nella barra in alto (§3); la riga non è citata | menu della ricerca vuota con la sintassi + guida; lo spostamento della ricerca (la funzione che l'utente vuole tenere) va provato con `search-basic`/`qa-search-perf` e a 1024 px |
| Schede **Nota di pagina / Nota del file / Tutte le note** | diventano "Note" (§4.3) | selettore Pagina / File / Tutte dentro "Note" |
| Icone di riga **Leggi / Apri il file / Mostra nella cartella** | D-333: "Leggi, Scheda, ⋯" | "Mostra nella cartella" deve stare nel menu ⋯, scritto |
| Barra di stato: "Invio a Claude: N cartelle", "Indice aggiornato: N documenti", lingua dei documenti | §2 la toglie; cita libreria, AI, versione | "Indice: N documenti" nel popover Attività; cartelle abilitate nell'intestazione Claude |
| **Seme** della mappa | D-344 (menu "Opzioni del modello") | ok |
| **Includi sottocartelle** | non citato | resta nel pannello Cartelle |
| Esportazione da **cluster** della mappa | non citata | menu ⋯ del cluster |
| **Selettori modello e ragionamento** nella cartella di arrivo (N22) | non citati | tenerli come chip nella barra di "Da rivedere", con la spiegazione "per le proposte di Claude sui file nuovi" |
| "**Proponi di nuovo**" e i 5 campi del dialogo dei lavori AI | non citati | restano nel dialogo con il piede fisso (D-339) |
| **Registrazione delle scorciatoie con conflitti** | §6 "editor esistente" | ok; aggiungere "Annulla le modifiche" (N14) |

#### B.9 Sistema visivo (minore)
- `--text-muted` (#5A5D65) e `--text-subtle` (#62656D) quasi uguali: due token per una differenza invisibile. Correzione: un solo grigio secondario; il terzo livello con dimensione e peso.
- `--accent` blu e `--ai` viola si confondono con deuteranopia/protanopia; il bordo AI di 3 px e il bordo del campo attivo si somigliano. Correzione: l'icona ✦ in ogni blocco AI, non solo nell'etichetta.
- Stati dei pulsanti (riposo, hover, premuto, fuoco, disattivato, in corso) non tabellati: oggi il fuoco sembra "disattivato" (sintesi 15). Correzione: tabella degli stati per ogni variante.
- Nessun componente chiave–valore (§5.5): i `<dl>` restano senza stile in scheda, export, AI, MCP. Correzione: `KeyValue` a due colonne.
- Pagina PDF: D-340 aggiunge token per ombra e bordo della pagina: bene, ma §5.3 va aggiornato.

#### B.10 Leggerezza e budget (importante)
- JS iniziale stimato 386-390 KiB su 391 (D-342): 1-5 KiB di margine per guscio, briciole, chip, popover, icone, tavolozza con documenti e indice delle impostazioni. Correzione: l'indice delle impostazioni (`settingsIndex.ts`, etichette in due lingue) si carica con la tavolozza, mai dal guscio; budget per file nel compito A2.
- Verifica della scrittura "con pdf.js nel worker" a ogni lotto: per un PDF da 80 MB un picco di memoria e CPU ogni pochi secondi. Correzione: verifica leggera a ogni lotto (coda e oggetti nuovi col parser proprio), pdf.js solo alla prima scrittura di un file.
- Il CSS diviso per vista non libera memoria dopo la prima apertura dei chunk: non contarlo come risparmio senza misura.

#### B.11 Ordine delle onde (importante)
1. Il **PDF stirato** sta in A1 con il rifacimento di tutto il CSS. Correzione: compito **H0 in onda 0**, da solo (rinomine di D-326, `@layer`/`@scope`, test di geometria e di contaminazione, riparazione N1), unito subito.
2. Il **lettore a strumenti** (F4, solo renderer) aspetta l'onda 4 perché condivide l'onda con lo scrittore. Correzione: F4 in onda 3; il chip "PDF" arriva in onda 4.
3. **G4b dopo G4a**: tra i due merge `main` avrebbe la scrittura accesa e l'identità del contenuto non adattata → ogni evidenziazione renderebbe il documento "cambiato" e le annotazioni "non allineate". Correzione: G4b prima di G4a, o `writeToPdf` dietro un interruttore spento fino al merge di G4b.
4. Onda 2: A2 e C2 in parallelo toccano entrambi `ai-ui.spec.ts`, `helpers/ui.ts` e testid che passano dall'uno all'altro (`status-ai`, `language-select`). Correzione: proprietà dei file e2e scritta per compito, o C2 dopo A2.
5. La guida d'uso non ha un compito: cambiano nomi, Esc, Invio, strumenti, scrittura nel PDF, e la guida oggi ha già contraddizioni (N18). Correzione: ogni compito aggiorna la guida per il comportamento che cambia (criterio di accettazione).
6. D-325 rimanda all'onda 6 le verifiche che questo audit ha ora fatto (inglese, scheda, export, MCP, backup, scorciatoie): i risultati sono qui sopra; vanno assegnati ai compiti delle onde 2-3, non all'onda 6.

#### B.12 Stati mancanti
- Lettore: PDF che non si apre (danneggiato, password di apertura), PDF senza testo (gli strumenti non possono funzionare: la barra deve dirlo), file mancante sul disco.
- Scrittura PDF: una frase per l'utente per ogni motivo di rifiuto (§8.3.8 elenca solo codici).
- Account: CLI non installata, CLI senza `auth`, offline durante "Prova".
- Da rivedere: "Tutto fatto" quando è vuoto; metadati non trovati offline.
- Impostazioni: ricerca senza risultati; "Valori diversi dal predefinito" vuoto; errore di salvataggio automatico (D-336).
- Backup e ripristino: cartella non vuota alla scelta, ripristino riuscito con "Apri la libreria ripristinata", librerie omonime.
- Prima apertura in una lingua diversa dall'italiano (N20).

---

## Critica del progetto finale (giro 3)

Oggetto: `docs/design/ARCHITETTURA-UI.md` sul ramo `design-arch` a 23a7610 ("finale (giro 3)", 1878 righe) e `docs/DECISIONS.md` D-310…D-367. Revisione solo sui documenti; le prove dell'app di oggi sono le schermate di `audit-shots/` già citate sopra; la fattibilità è controllata sul codice dove indicato. Riferimenti "§" al documento dell'architetto.

**Verdetto.** Il progetto finale è serio e quasi completo: chiude con soluzioni concrete la grande maggioranza dei risultati di questo audit e dei punti B.1-B.12 (CSS di pdf.js filtrato e prefissato, riparazione delle annotazioni, consenso prima della prima scrittura, scritture alla chiusura, classificazione delle revisioni per contenuto, "Togli dal PDF" non distruttivo, barra unica del lettore, badge che conta solo i file, tabella evento → mezzo, ordine delle onde). Restano **3 problemi bloccanti** (funzioni della Libreria perse; criteri di area del lettore impossibili da rispettare; perdita silenziosa di annotazioni quando un altro programma riscrive o ripulisce il PDF), una decina di problemi importanti e alcune incoerenze interne. La richiesta "grafica moderna" è soddisfatta come **ordine**, non ancora come **aspetto**: il sistema visivo è pulito ma generico, e nessuno lo vedrà disegnato prima che sia implementato. La Mappa è ben progettata come motore, ma il divertimento sta quasi tutto nella scheda Citazioni, che non è quella che si apre per prima.

### C.1 Tracciabilità: le affermazioni di §0 reggono?

Ho ricontrollato ogni riga di §0.3 e §0.4 contro la sezione indicata. Reggono, salvo queste (le altre sono coperte dal testo):

| Affermazione | Dove | Cosa dice davvero il testo | Gravità | Correzione |
| --- | --- | --- | --- | --- |
| A9: "a 1024×700 area utile ≥ 600×600 (criterio)" | §0.1 | §4.3 chiede invece **≥ 1000×640** a 1024×700 e **≥ 900×740** a 1280×800 con il pannello aperto. Entrambi impossibili: a 1024 la barra laterale compressa occupa 56 px (resta 968 < 1000); a 1280 la barra laterale è estesa (§3.2: estesa sopra 1100 px) e il pannello del lettore è 340 px: 1280 − 232 − 340 = 708 < 900 | **bloccante** (il criterio di accettazione di F4 non si può soddisfare: un compito o fallisce o aggira il criterio) | decidere: o il lettore comprime la barra laterale a 56 px (modo concentrato, da scrivere in §3.2 e §4.3) e allora i valori corretti sono ≥ 960×640 a 1024×700 e ≥ 880×740 a 1280×800 con il pannello aperto; oppure abbassare i criteri a ≥ 950×640 e ≥ 700×740. Un solo numero in §0.1 e §4.3 |
| A9: "una sola barra da 44 px" | §0.1, §5.3 ("barra del lettore 44") | §4.3: "una sola riga da 48 px" | minore | un valore (48, come la barra del guscio che sostituisce) |
| B.3 / D-358: badge = solo file nuovi | §7.1 | la tabella generale di §7 (riga "Badge numerico") dice ancora "file da confermare + documenti con proposte di Claude" | minore | aggiornare la riga di §7 |
| B.2.4: cifrati "supporto in G4c se ≥ 2%" | §0.4, §8.3.5 | sotto il 2% l'utente non ha **nessuna** via per vedere le evidenziazioni in Chrome: §8.3.14 esclude proprio i cifrati da "Esporta copia annotata", e quella funzione è facoltativa (J5) | importante | vedi C.5.4 |
| B.8: "nessuna funzione persa" | §4.18 | la riga dei filtri della Libreria (§4.2) perde il facet **Autori** e non dice nulla dei filtri di tag **escludi** e **tutti / almeno uno** di oggi | **bloccante** | vedi C.2.1 |
| B.6: "una riga nel lettore" a 1024 | §4.3 | la somma dei gruppi ridotti (948 px) è calcolata su 1024 − 16, senza i 56 px della barra laterale compressa: lo spazio vero è 952 px, margine di 4 px | importante | ricalcolare con la barra laterale e prevedere che anche "Pagine" si riduca (campo senza "/ 38") sotto 1100 px |
| N3: la scheda "non nasconde mai in silenzio" Cartelle/Tag | §3.2, §4.14 | con D-333 un clic su una riga mostra la scheda se il pannello è aperto; a 1180-1439 px la scheda si sovrappone **all'elenco** (cassetto da destra) a ogni clic | importante | vedi C.2.3 |

Il punto "Problema 0" (documento e decisioni in disaccordo) è ora risolto: il documento contiene il giro 3 e le decisioni lo riassumono.

### C.2 Composizione (§1.1) e posizione delle azioni

1. **bloccante — Funzioni della Libreria perse nella riga dei filtri.** Oggi la scheda "Filtri" ha sette facet con i conteggi (Tag, **Autori**, Tipi, Riviste, Stato di studio, Anni, Cartelle: `i18n/locales/it.json` `search.facet`) e il filtro dei tag ha **includi** con modo "tutti / almeno uno" e **escludi** (`views/library/FilterBar.tsx`, `run3/it-032-library-filters-tab-light-1280x800.png`). La riga di §4.2 mostra `[Stato ▾] [Tipo ▾] [Anno ▾] [Rivista ▾] [Tag ▾]`: niente Autori, niente conteggi, niente esclusione né modo. La regola "nessuna funzione si toglie" lo vieta. Correzione: riga dei filtri con `Stato ▾ Tipo ▾ Anno ▾ Rivista ▾ Autori ▾ Tag ▾` (+ `⋯ Altri filtri` sotto 1280 px); ogni menu mostra i valori con il conteggio di oggi; il menu Tag ha "Includi / Escludi" per voce e il selettore "Tutti / Almeno uno"; riga aggiunta in §4.18.
2. **importante — Le intestazioni violano la regola di §1.1.** Regola 1: "un solo primario a destra; accanto al primario al massimo due secondari e poi ⋯"; "una riga di filtri, mai due". Libreria (§4.2): Elenco/Griglia, Ordina e ◫ = tre secondari. Mappa (§4.20): campo "Vai a un documento", cursore degli anni, Tag ▾ nell'intestazione (filtri fuori dalla riga dei filtri) più Mescola, Sorprendimi, Adatta nella riga delle schede: a 1280 px con la barra laterale estesa restano circa 1048 px per titolo e conteggio (~250), campo (~240), cursore (~200), Tag (~80), primario (~170) e ⋯: non entra. Correzione: Libreria: Ordina dentro il controllo Elenco/Griglia come menu "Vista ▾" (vista + ordinamento), ◫ come IconButton a destra del ⋯ (le icone di pannello non contano come azioni: dirlo nella regola); Mappa: intestazione con titolo, conteggio, primario, ⋯; sotto le schede **una** riga con campo "Vai a…", Anni, Tag e, a destra, Mescola · Sorprendimi · Adatta come IconButton con etichetta nel tooltip.
3. **importante — Un clic = scheda a 1180-1439 px copre l'elenco.** D-333 e D-363 insieme: chi scorre l'elenco cliccando righe vede a ogni clic un cassetto di 360 px che si apre sopra i risultati. Correzione: sotto 1440 px il clic seleziona soltanto; la scheda si apre con Maiusc+Invio, il pulsante [Scheda] della riga o ◫, e resta aperta finché l'utente la chiude (comportamento "pannello fissato"); sopra 1440 px come D-333.
4. **minore — ✦ usato per Scopri.** Nel wireframe della barra laterale (§4.1) Scopri ha l'icona ✦, che §5.5.1 e il principio 8 riservano a Claude e al contenuto AI. Correzione: bussola per Scopri, come in §5.4.
5. **minore — Duplicati di posizione.** "+ Aggiungi PDF" è primario sia in Libreria sia in Da rivedere (va bene, porta allo stesso posto), ma "Mostra i file mancanti" è nel ⋯ della vista secondo §1.1 e come casella nella riga dei filtri secondo §4.2. Correzione: un posto (casella nella riga dei filtri, perché è un filtro).
6. **minore — Barra in alto a 1024 px.** ‹ › (72) + ricerca (min 280) + ↶ ↷ 🕘 (104) + ⌘K (32) + chip Attività (~120) + spazi ≈ 640 su 968: alle briciole restano ~300 px, il titolo di un documento sparisce. Correzione: sotto 1100 px le briciole mostrano solo l'ultimo segmento e la Cronologia passa nel ⋯ della barra.
7. Funzioni controllate e presenti (nessuna perdita): azioni della barra di selezione, icone di riga, Scheda, griglia, sintassi di ricerca, note di pagina/file/tutte, ricerca nel documento con "Evidenzia il risultato", studio, Esc e uscita dal lettore, Includi sottocartelle, seme, export da cluster, MCP, scorciatoie, backup e ripristino.

### C.3 Mappa (§4.20, D-367): sarà bella e divertente?

Il motore è credibile e leggero (canvas 2D, Barnes-Hut, camera con inerzia, archi assottigliati, involucri, livelli di dettaglio, minimappa, tastiera, movimento ridotto): 10-14 KiB per tutto è realistico, e 800 nodi con un passo ≤ 4 ms sono alla portata di un quadtree scritto bene. I problemi sono di **esperienza** e di **verifica**:

1. **importante — La scheda che si apre per prima è la meno giocabile.** "Argomenti" ha coordinate fisse calcolate nel main: niente fisica, niente trascinamento; "Mescola" lì rifà solo l'animazione d'ingresso (un trucco che si vede una volta). Tutta la fisica sta in "Citazioni", che però parte vuota ("Scegli un documento da cui partire"). Correzione: (a) in Argomenti, **zoom semantico**: un doppio clic su un involucro fa "esplodere" l'argomento (i suoi punti si allargano con una simulazione locale di collisione e si possono trascinare; Esc li richiude); (b) trascinamento di un intero argomento con gli altri che si scostano (collisione tra involucri, poche decine di corpi: costo trascurabile); (c) Citazioni non parte mai vuota: si apre sul documento più collegato della libreria (o sull'ultimo letto) già espanso a un passo.
2. **importante — Colori che cambiano a ogni "Aggiorna la mappa".** I colori sono "per argomento del livello corrente" (§4.20): dopo una ricostruzione gli indici dei cluster cambiano e "Ottica" passa da blu ad arancione; la mappa mentale dell'utente si rompe. Con più di 10 argomenti le tinte si ripetono, anche tra argomenti vicini. Correzione: assegnare le tinte per **continuità** (ogni cluster nuovo eredita la tinta del cluster vecchio con cui condivide più documenti, assegnazione golosa) e, a parità, per hash stabile dei termini principali; tra argomenti adiacenti (involucri che si toccano) mai la stessa tinta (colorazione golosa del grafo di adiacenza); oltre 10 argomenti: tinta + motivo (contorno tratteggiato) per i ripetuti.
3. **importante — Grafi piccoli (3-10 documenti).** Lo stato "meno di 3 documenti" c'è; da 3 a ~30 documenti la scheda Argomenti è quella vista oggi (`run3/it-078-network-built-light-1280x800.png`: quattro quadratini e un'etichetta): con 1-2 punti per argomento l'inviluppo convesso degenera (un punto, un segmento) e "Adatta" ingrandisce un vuoto. Correzione: sotto 30 documenti Argomenti usa la stessa simulazione di Citazioni (nodi raggruppati per argomento con una forza verso il baricentro dell'argomento); involucro di 1 punto = cerchio di 24 px, di 2 punti = capsula; zoom massimo di "Adatta" tale che il nodo più grande non superi 40 px.
4. **importante — Il tetto di 800 nodi senza stato.** Che cosa succede quando "Espandi" supererebbe 800 nodi? Non è scritto. Correzione: l'espansione aggiunge i vicini più pesanti fino al tetto e il cartellino del nodo dice "+37 non mostrati (tetto 800) · Mostra solo questi"; il sottotitolo mostra "800 di 1 240".
5. **importante — Tema scuro.** Riempimento degli involucri al 7% e archi a opacità `0,12 + 0,5·peso` mescolati con `--text-muted`: su `#121316` gli archi leggeri e gli involucri spariscono. L'alone a gradiente radiale disegnato in modo normale scurisce invece di illuminare. Correzione: opacità per tema (involucri 12% e contorno 35% in scuro; minimo degli archi 0,22 in scuro); aloni con `globalCompositeOperation = 'lighter'` in scuro e `'source-over'` in chiaro; un test che misura il contrasto medio arco/fondo nei due temi.
6. **importante — Le prove di prestazione non provano l'affermazione.** "60 fps fino a 20 000 punti" è il criterio, ma il test è "disegno di 20 000 punti in un canvas finto ≤ 16 ms" (un canvas finto non rasterizza: misura solo il JavaScript) e l'e2e misura ≥ 50 fps con 5000 punti. Inoltre costruire la mappa di 5000 documenti sintetici nel main è una prova pesante su questa macchina (regola delle risorse). Correzione: criterio reale = "≥ 55 fps medi in panoramica con 20 000 punti e ≥ 30 fps con 60 000" misurato in Electron con un modello di punti **precalcolato** caricato da una fixture (nessun calcolo nel main), sotto `RL_HEAVY_TESTS=1`, una prova alla volta; il test con il canvas finto si toglie o si chiama per quello che è (tempo di preparazione dei percorsi).
7. **importante — M4 non garantisce un risultato curato.** Il compito è specificato bene nei numeri, ma l'aspetto di una mappa si regola guardandola (spessori, opacità, tempi): un subagent Sonnet senza un riferimento visivo e senza una verifica a vista consegnerà qualcosa di corretto e piatto. Correzione: (a) prima di M4, un prototipo statico (HTML + canvas, dati sintetici, nessun file dell'app) con i parametri di §4.20, in chiaro e scuro, approvato dall'utente; (b) criterio di M4: schermate a seme fisso (3 dimensioni × 2 temi × 4 stati: vuoto, piccolo, medio, grande) rivedute dalla coppia di design (architetto + auditor visivo) prima del merge, con al massimo due giri di ritocchi dei soli parametri.
8. **minore — Accessibilità.** `role="application"` toglie al lettore di schermo la navigazione normale: va bene solo se l'elenco Esplora è raggiungibile con un tasto dalla tela (es. `L` = "Mostra come elenco") e lo dice l'annuncio iniziale. Gli argomenti si distinguono solo per colore dentro la tela: l'etichetta al baricentro c'è a zoom basso ma sparisce avvicinandosi; correzione: il cartellino e l'annuncio dicono sempre l'argomento.
9. **minore — "Mescola" e i nodi fissati.** Non è scritto se Mescola libera le puntine. Correzione: le puntine restano, e "Libera tutti" nel ⋯.

### C.4 Sistema visivo (§5): moderno o generico?

È coerente, accessibile e misurato (contrasti verificati, stati dei controlli, nessuna cornice annidata): risolve la "gerarchia piatta" e gli stati ambigui. Ma l'insieme — Segoe UI di sistema, neutri caldi, un blu `#2B50C8` standard, titoli di 20 px, icone Lucide, carte bianche con ombra leggera — è la ricetta di qualunque applicazione da ufficio del 2020: **ordinato, non attraente**. L'utente ha scritto "grafica poco attraente"; ordinare non basta.

1. **importante — Nessuno ha ancora visto il progetto disegnato.** Tutto il sistema visivo esiste come tabelle e wireframe ASCII; la prima volta che l'utente lo vedrà sarà dopo A1-A2-D3. Correzione: compito **P0 in onda 0** (parallelo a S1/S2): una pagina HTML statica (`docs/design/prototype/`, solo token e CSS, nessun file dell'app) con tre schermate — Libreria con scheda, Lettore con strumenti, Mappa — in chiaro e scuro; approvazione dell'utente prima di A1; ogni ritocco ai token si fa lì.
2. **importante — Gerarchia tipografica troppo piatta.** Titolo di vista 20 px su corpo 14 px: rapporto 1,43, la pagina sembra un modulo. Correzione: `--fs-title` 26/32 in "Segoe UI Variable Display" 600 con `letter-spacing: -0,015em`; `--fs-display` 32/40 per stati vuoti e procedura guidata; conteggi accanto ai titoli in `--fs-body` `--text-muted` con cifre tabellari.
3. **importante — Un'identità.** Proposte concrete, a scelta dell'utente nel prototipo P0: (a) accento meno "blu di sistema": inchiostro indaco `#3D4EDB` / scuro `#9AA6FF`, oppure verde-petrolio `#0F6E78` / `#5CC6CF` (si distingue meglio dal viola di Claude anche con deuteranopia); (b) barra laterale sullo stesso fondo `--bg` della vista, senza bordo, con la voce attiva come pillola `--surface` con `--e-1` (meno "pannello grigio", più leggera); (c) stati vuoti con piccole illustrazioni a tratto (SVG in linea, ≤ 1 KiB l'una, 6 in tutto: libreria vuota, tutto fatto, mappa da costruire, nessun risultato, nessun backup, offline) invece dell'icona in un cerchio; (d) segno del prodotto: logo da 20 px con la tinta della libreria attiva; (e) microanimazioni con un significato: la riga confermata in Da rivedere che scivola via (180 ms), il chip Attività che si "riempie" alla fine di una scansione, il pallino del colore che "salta" sul pennello scelto.
4. **minore — Incoerenze nei token.** Disattivato: §5.5 dice "opacità .45" e §5.5.1 dà colori espliciti (fondo `--surface-3`, testo `--text-muted`); vale una sola regola (quella di §5.5.1). La palette `--cat-1..10` sta "in `tokens.css` come nomi" (A1) e "in `views/network/palette.css`" (M4): un solo posto (`tokens.css`, con i valori). `--e-2` cita ancora la "barra strumenti del lettore", che non galleggia più.

### C.5 Scrittura nel PDF (§8.3) e riparazione (§8.1.2): buchi rimasti

1. **bloccante — Un altro programma che riscrive o ripulisce il PDF fa sparire le annotazioni dell'utente.** (a) Tabella a tre di §8.3.7: "app uguale, **sparita dal PDF** → adotta l'eliminazione nell'app". Se un programma salva il PDF senza le annotazioni (stampa in PDF sopra lo stesso nome, "ottimizza", un editor che appiattisce o toglie i commenti), l'app **cancella** le evidenziazioni dell'utente e lascia solo una riga in Attività. (b) Salvataggio completo (Chrome/Edge "Salva" dopo aver aggiunto un commento, Acrobat "Salva con nome"): il prefisso cambia, si passa a "contenuto cambiato davvero" (§8.3.6 punto 3, rischio 5 di §15): `pdfWrite` azzerato, annotazioni "non allineate" e nascoste, mentre gli oggetti `rl-` sono ancora nel file; alla riconciliazione successiva (annotazioni senza `pdf` valido) si **riaggiungono** e il PDF le ha due volte. Correzione: (a) mai adottare un'eliminazione in automatico: le annotazioni assenti dal PDF vanno nel gruppo "Da controllare" con [Riscrivi nel PDF] [Elimina anche qui]; (b) con un salvataggio completo: se il testo estratto è uguale alla cache (stesso contenuto), si tratta come "solo annotazioni" — `pdfWrite.base` = il nuovo file **senza** perdere le annotazioni — e si riagganciano le nostre per `/NM (rl-…)` già presenti, mai riaggiungendole; test con un file riscritto per intero da pdf-lib con gli stessi `/NM`.
2. **importante — La vista si ricarica dopo la propria scrittura?** `rl-doc://…?v=<hash8>` è versionato con l'hash del **file** (§8.3.6), che cambia dopo ogni scrittura; le scritture "dopo 120 s senza modifiche" avvengono a documento aperto. Se il lettore reagisce al cambio di URL ricaricando il documento, la pagina salta o lampeggia mentre l'utente legge (oggi `reader.test.ts` apre `rl-doc://doc/<id>?v=<hash8>`). Non è scritto. Correzione: il lettore usa `contentHashOf` per l'URL e **non** ricarica per una scrittura propria (evento `annotations:pdfProgress` con `own: true`); test e2e: scrittura a documento aperto → stessa pagina, stesso scorrimento, nessuna nuova richiesta del documento.
3. **importante — La riparazione richiede di aprire ogni documento.** §8.1.2 ripara solo "nel lettore, dopo il disegno corretto di ogni pagina"; la migrazione salta i documenti con candidate non riparate ("12 documenti da aprire una volta nel lettore"). Con centinaia di documenti annotati prima di H0 l'utente dovrebbe aprirli uno per uno, pagina per pagina, prima di poter scrivere nei PDF. Correzione: riparazione **senza interfaccia** nel worker: pdf.js `getTextContent()` dà posizione e larghezza di ogni frammento di testo nello spazio della pagina, quindi i rettangoli si ricalcolano senza disegnare; il lettore resta solo per i casi ambigui ("Da controllare"). Un lavoro in Attività "Controllo delle evidenziazioni: 214 documenti" all'avvio dopo H0, annullabile.
4. **importante — Cifrati con password vuota.** Se S2 misura meno del 2% G4c non si fa, e quei file non hanno nemmeno "Esporta copia annotata" (esclusi da §8.3.14): l'utente che apre l'articolo in Chrome non vede nulla, contro la sua richiesta. 6-8 KiB nel main per supportarli sono poca cosa rispetto a una richiesta esplicita. Correzione: G4c **sempre** (dopo G4a); in alternativa minima, "Esporta copia annotata" anche per i cifrati con password vuota e permessi che ammettono le annotazioni (copia decifrata nella cartella di export).
5. **importante — Consenso che interrompe il primo tratto.** Il dialogo modale compare "alla prima creazione o modifica di un'annotazione": l'utente ha appena scelto Evidenzia e sta lavorando con Spazio e i tasti; un dialogo modale ruba il fuoco e interrompe il gesto. Le scritture avvengono comunque solo alla chiusura o dopo 120 s. Correzione: alla prima annotazione un **banner nel lettore** (non modale, nel `banner-slot`, con le due scelte); la scrittura aspetta la risposta; se alla chiusura del documento non c'è risposta, il dialogo compare **allora** (una volta), quando il lavoro è finito.
6. **minore — Adozione di colori e commenti da altri programmi.** "PDF cambiato → adotta nell'app": un colore scelto in Acrobat non è uno dei 5 dell'app; un commento modificato in Acrobat può stare in `/RC` (testo ricco) con `/Contents` vecchio. Correzione: colore adottato = il più vicino dei 5 (distanza in OKLab), con il valore originale conservato; leggere `/RC` (testo puro estratto) quando è più recente di `/Contents`.
7. **minore — Verifica nei lettori esterni solo a mano.** S2 e V3 chiedono di aprire i file in Edge e Chrome "a mano". Electron ha lo stesso PDFium di Chrome: si può automatizzare. Correzione: e2e che apre il PDF scritto in una `BrowserWindow` nascosta con il visualizzatore PDF integrato (`plugins: true`), fa uno screenshot e verifica il colore dei pixel nel rettangolo atteso (giallo per l'evidenziazione, tratto scuro per la sottolineatura).
8. **minore — Consenso implicito nella procedura guidata.** Completare la procedura con l'interruttore acceso vale come consenso (§4.11): va bene perché è la decisione dell'utente, ma la riga deve essere nel corpo del Riepilogo, non in fondo sotto la piega, e ripetuta nella frase del pulsante finale ("Crea la libreria").

### C.6 Piano a onde, file, test, budget

1. **importante — Budget del main in contraddizione.** §13: scrittore + classificatore 36-45, account 4-6, rapporto e uso 2-3 → 1052-1060 (tetto 1060). §14: B1 +7-10, G4b +4-6, G4a +34-42 → +45-58 → **1054-1067**, oltre il tetto prima ancora di G4c. Correzione: una sola tabella per compito; o tetto 1070 (1078 con G4c) motivato in DECISIONS, o lo scrittore senza il classificatore duplicato (G4a riusa `classify.ts` di G4b: dirlo e togliere i 2-3 KiB da G4a).
2. **importante — JS iniziale.** 379,5 + A1 (+3-5) + A2 (+5-8, −2) = 385,5-390,5 su 391: margine tra 0,5 e 5,5 KiB per tutte le onde successive che toccano il guscio (F4 tocca `shell/Topbar*`). Correzione: rendere pigro `Drawer` e il popover della libreria **subito** (non "se si supera"), e un controllo per compito "iniziale ≤ 388".
3. **importante — Prove mancanti.** (a) e2e "il lettore non si ricarica dopo una scrittura propria" (C.5.2); (b) e2e Spazio reale nel lettore (alternanza, scorrimento con Maiusc+Spazio, nessuno scambio nei campi) — oggi solo unitari sulla macchina a stati; (c) verifica automatica nel visualizzatore PDF integrato (C.5.7); (d) prova del facet Autori e dell'esclusione dei tag dopo D3 (C.2.1); (e) prova "un clic non apre il cassetto sotto 1440 px" (C.2.3).
4. **minore — Coppie con dipendenze.** E3 ∥ G4b: E3 deve mostrare le "righe di copia in conflitto pronte (dati da G4b)" mentre G4b le sta scrivendo in parallelo. Correzione: E3 usa un dato finto da `mockRl` e la verifica con i dati veri passa a V1; oppure G4b prima di E3.
5. **minore — M4 e la regola delle risorse.** L'e2e di M4 con 5000 punti e il futuro test con 20 000 vanno in `test:e2e:heavy` (C.3.6), mai mentre G4a esegue le sue e2e.
6. **minore — V3 tocca una copia della libreria reale in una cartella sincronizzata.** Va bene, ma va scritto che la copia sta fuori dal repository e fuori dalla cartella reale, e che il rapporto contiene solo conteggi (regola di generalità).
7. Corretto e da tenere: H0 da solo in onda 0, F4 in onda 3 senza scrittura, G4b prima di G4a, `PDF_WRITE_ENABLED = false` fino alla revisione security, proprietà dei file e2e per onda, guida aggiornata in ogni compito.

### C.7 Elenco riassuntivo per gravità

- **Bloccanti (3):** C.1/C.2.1 facet Autori ed esclusione dei tag persi; C.1 criteri di area del lettore impossibili; C.5.1 annotazioni cancellate o duplicate quando un altro programma riscrive o ripulisce il PDF.
- **Importanti (18):** C.1 barra del lettore a 1024 con 4 px di margine; C.1/C.2.3 cassetto della scheda a ogni clic; C.2.2 intestazioni fuori regola (Libreria, Mappa); C.3.1 Argomenti statica e Citazioni vuota; C.3.2 colori instabili; C.3.3 grafi piccoli; C.3.4 tetto di 800 senza stato; C.3.5 tema scuro della mappa; C.3.6 prove di prestazione che non provano; C.3.7 M4 senza verifica a vista; C.4.1 nessun prototipo visivo; C.4.2 tipografia piatta; C.4.3 nessuna identità; C.5.2 ricarica del lettore dopo la scrittura; C.5.3 riparazione che richiede di aprire ogni documento; C.5.4 cifrati senza via d'uscita; C.5.5 consenso che interrompe il gesto; C.6.1-C.6.3 budget e prove mancanti (contati come uno).
- **Minori (13):** C.1 valori 44/48 e riga di §7; C.2.4 ✦ per Scopri; C.2.5 "Mostra mancanti" in due posti; C.2.6 barra in alto a 1024; C.3.8 elenco accessibile dalla tela; C.3.9 Mescola e puntine; C.4.4 incoerenze dei token; C.5.6 colori e `/RC`; C.5.7 verifica automatica in PDFium; C.5.8 consenso nella procedura guidata; C.6.4-C.6.6 coppie, prove pesanti, V3.

## Critica delle funzioni aggiunte (giro 4)

Oggetto: `docs/design/ARCHITETTURA-UI.md` §17 (funzioni aggiunte, D-395 … D-409), §17.3 (affollamento), §14.1 (onde 7-11), §13 (budget), `docs/design/PROPOSTE-FUNZIONI.md` (scelte dell'utente, giri 1 e 2). Revisione solo sui documenti, nessuna esecuzione; base visiva: il prototipo approvato P0 (`docs/design/prototipo/index.html`) e le schermate dei giri 1-2. Vincolo dell'utente da cui parto: «I do not want the graphics to be crowded with functionalities».

**Verdetto sull'affollamento: non promosso.** Le regole di §17.1 sono giuste (nessuna vista nuova, ✦ = Claude, rivelazione progressiva, stati vuoti che insegnano, prova automatica), ma la tabella §17.3 non è onesta in due righe, la regola 2 conta solo i controlli visibili e quindi spinge tutto nei menu, che diventano cassetti (12 voci nella selezione, 10 nel `⋯` del progetto) con voci che compaiono e spariscono. La barra del lettore era già la zona più affollata del P0 e il progetto la dichiara "invariata" mentre cresce. Correggibile senza togliere funzioni: servono un tetto per i menu, tagli nella barra del lettore e qualche spostamento.

### D.1 Affollamento: conteggi, menu, rivelazione

1. **bloccante — Il conteggio della barra del lettore (§17.3, "24 → 24") non corrisponde al P0.** Nel P0 la barra ha **22** controlli (chiudi; 4 strumenti; 5 colori; ‹, campo pagina, ›; −, 110 %, +, adatta; cerca; chip "Nel PDF ▾"; "Studio ▾"; Annulla; Pannello; `⋯`) e **non ha** un pulsante Cronologia: il compenso "Ritaglia +36 px / Cronologia −36 px" toglie un controllo che nel riferimento approvato non c'è. Dopo X2 i controlli sono **23**, non 24 → 24. E il punto vero è un altro: 22-23 controlli in una riga da 48 px non sono "calmi" già oggi (a 1024 il margine era 4 px, C.1). Correzione, nella barra (§7, §17.4.8):
   - colori: 5 pallini → **1 pallino del colore attivo** con popover dei 5 (tasti 1-5 invariati): −4;
   - zoom: −, +, adatta → **"110 % ▾"** (menu: Adatta alla larghezza, Adatta alla pagina, 100 %, 150 %; Ctrl+rotella e Ctrl±): −2;
   - pagine: via le frecce ‹ › (resta il campo "12 / 40"; PagSu/PagGiù, N/P): −2;
   - chip "Nel PDF ▾" dentro il menu Studio (riga di stato in cima al menu, con un punto sul pulsante Studio solo in caso di errore): −1;
   - Annulla: Ctrl+Z e voce del `⋯` (il toast "Annulla" dopo un'eliminazione resta): −1.
   Risultato: **13** controlli con Ritaglia (chiudi, 5 strumenti, colore, pagina, zoom, cerca, Studio, Pannello, `⋯`). La tabella §17.3 riporta "22 (P0) → 13", e `crowding.spec.ts` confronta con i numeri del P0, non con quelli del documento.
2. **importante — "Progetto: 2 + 3 → 2 + 3 (fino a 5)" è contato come invariato (§17.3, §17.4.13, §17.4.15).** È una crescita di due schede, proprio dove l'utente scrive. La rivelazione progressiva non la annulla: dopo il primo uso le schede restano per sempre. Correzione: **una sola scheda "Schema"** che contiene anche le prove (ogni domanda dello schema ha sotto le sue affermazioni e prove; una vista "Solo prove" è un filtro della scheda, non una scheda). Massimo 2 + 4; la tabella dice "3 → 4 dopo il primo uso".
3. **importante — I menu diventano cassetti (§1.1 tabella delle azioni, §17.1 regola 3).** Voci contate dai §17.4 e dalla tabella §1.1:

   | Menu | Voci | Problema |
   | --- | --- | --- |
   | `✦ Claude ▾` della selezione | 6 | "Estendi la bibliografia" non usa Claude (D.1.4); "Trova un ponte" esiste solo con 2 documenti |
   | `⋯` della selezione | 6 | "Leggi affiancati" solo con 2; "Linea del tempo"; "Esporta la bibliografia" |
   | `⋯` del progetto | 10 + riga "Aggiornato alle 10:42" | schema, manoscritto, .bib, esportazione, tabella, resoconto, suggerimenti, estendi: nessun ordine |
   | `⋯` del lettore | 7 (fino a ~11 a 1024 con le voci ridotte della barra e "Scorrimento legato") | Cronologia, file, tasti, export, affianca, guida ✦ |
   | `⋯` della scheda | 6 | — |
   | popover della selezione nel lettore | 4 | Evidenzia e Sottolinea duplicano gli strumenti (D.1.7) |

   Correzione (nuova regola 8 di §17.1, verificata da `crowding.spec.ts`, che apre ogni menu e conta):
   - **al massimo 7 voci per menu**, un solo livello, gruppi separati da un divisore con al massimo 3 gruppi;
   - **niente voci che compaiono e spariscono** con la dimensione della selezione: la voce c'è sempre, disattivata con il motivo nel tooltip ("Seleziona 2 documenti");
   - una voce che serve una volta (Collega un manoscritto, Scrivi lo schema) non sta nel `⋯`: sta nello stato vuoto del posto dove serve (regola 6) e nella tavolozza;
   - le righe di stato ("Aggiornato alle 10:42") non stanno nei menu: vanno nel tooltip della voce o in Attività.
4. **importante — ✦ usato per una funzione che non usa Claude (§17.5 "Estendi la bibliografia: selezione ✦", regola 5).** Estendi la bibliografia è bibliometrica, Claude è facoltativo. Metterla in `✦ Claude ▾` insegna che ✦ vuol dire "funzioni avanzate" e fa temere un costo che non c'è. Correzione: Estendi nel `⋯` della selezione e in Scopri › Nuova ricerca; in `✦ Claude ▾` solo ciò che invia **sempre** (note di letteratura, tabella con celle ✦, sintesi). Lo stesso per Trova un ponte: l'ingresso è senza ✦, la classificazione è un secondo passo ✦ nel risultato.
5. **importante — `⋯` del progetto (§17.4.7, §17.4.13, §17.4.19, §17.4.20).** Riordino concreto a 7 voci in 3 gruppi: *Bibliografia* (Collega un file .bib…, Esporta la bibliografia…); *Con Claude ✦* (Resoconto…, Tabella di confronto…, Suggerimenti di citazione…); *Progetto* (Rinomina, Archivia). "Scrivi lo schema" e "Collega un manoscritto…" escono dal menu (stato vuoto della scheda Note e della scheda Schema). "Estendi la bibliografia" del progetto si raggiunge da Scopri con il progetto come ambito.
6. **importante — "Riprendi" come banner all'avvio (§17.5 riga 25) contraddice §17.3 ("non come pulsante").** Un banner a ogni sessione è cromatura che si ripete e che l'utente impara a chiudere. Correzione: niente banner; "Riprendi: *Titolo* · p. 12" è la prima riga del menu del campo di ricerca vuoto e della tavolozza; il banner solo dopo una chiusura non pulita (l'app si è chiusa con un documento aperto).
7. **importante — La calma del lettore (§17.4.10, §17.4.18).** (a) Schede delle citazioni: sottolineatura punteggiata su **ogni** riferimento e scheda dopo 500 ms al passaggio del mouse = rumore su tutta la pagina e schede che saltano fuori mentre si muove il mouse per leggere. Correzione: nessun segno a riposo; la scheda si apre al **clic** sul riferimento (o Ctrl + passaggio), mai con uno strumento di disegno attivo; il riferimento si sottolinea solo sotto il puntatore. (b) Popover della selezione a 4 voci: in modo strumento non compare affatto (lo strumento ha già agito); in modo Seleziona bastano **Copia · Evidenzia (colore attivo) · ✦ Spiega** (3).
8. **minore — Scopri (§17.3 riga Scopri).** "Fonti seguite" passa da scheda a voce del `⋯`: chi l'ha configurata non la ritrova. Correzione: le fonti seguite si gestiscono dalla scheda Novità (riga "Da 4 fonti seguite · Gestisci"), non dal `⋯`. "Nuova ricerca ▾" con tre flussi diversi va bene se ogni voce ha una frase sotto il nome (che cosa fa, se usa Claude).
9. **minore — Scopribilità senza cromatura.** Tavolozza e stati vuoti bastano per l'uso quotidiano, ma 25 funzioni nuove arrivano in 5 onde senza che l'utente sappia dove cercarle. Correzione: una pagina "Novità" nella Guida (una riga per funzione: dove sta, tasto), aperta una volta dalla nota di versione; nessun badge, nessun giro guidato.

### D.2 Evidenziazioni guida (30, D-401, §17.4.21): giudizio del disegno

1. **importante — Contorni tratteggiati sul testo si confondono con i segni dell'utente.** Nel lettore ci sarebbero tre tipi di linee sul testo: le sottolineature dell'utente, le punteggiature delle citazioni (D.1.7) e i contorni `--ai` della guida. In scala di grigi e con deuteranopia un contorno viola tratteggiato e una sottolineatura colorata si distinguono a fatica, e 5-12 rettangoli per paper sono rumore su pagine che l'utente vuole pulite. Correzione: la guida **non tocca il testo**: una barra verticale sottile nel margine della pagina, allineata alle righe del passaggio, con una lettera (C contributo, M metodo, R risultato, L limite); al passaggio del mouse o al fuoco, una velatura leggera sul passaggio e il motivo in un tooltip; elenco dei passaggi nel pannello Annotazioni.
2. **importante — Accensione e spegnimento in posti diversi.** Si accende dal `⋯` del lettore e si spegne da un chip in cima al pannello Annotazioni, che può essere chiuso. Correzione: la stessa voce del `⋯` è una casella ("✓ Guida ✦") che accende e spegne, più un tasto (G); il chip nel pannello è un secondo ingresso, non l'unico.
3. **importante — Quando parte l'invio.** "Per il paper aperto, Claude propone…" non dice se a funzione accesa ogni paper aperto invia (≈ 12-15 mila token ciascuno: con un uso limitato, 10 paper al giorno consumano una quota seria). Correzione: lo strato acceso **non** invia mai da solo: su un paper senza guida compare nel margine una sola riga "Guida ✦ non ancora preparata · Prepara (≈ 14 000 token)"; si mostra senza invio quando c'è la cache o la nota di letteratura.
4. **minore — "Tieni".** Dire che cosa diventa: un'evidenziazione nel colore attivo, con "origine: guida ✦" nella cronologia; scompare dalla guida.
5. **minore — Criteri di §17.4.21 non misurabili.** "Usata in almeno metà delle letture" non dice chi la usa né come si conta; manca il costo; manca il comportamento a funzione spenta. Sostituiti dal protocollo di D.6.

### D.3 Esperienza delle singole funzioni

1. **importante — Costo e consenso, regola comune (§17.2, §17.4.9).** L'anteprima `AiCostPreview` a ogni azione diventa un dialogo che si chiude senza leggere; per Spiega il documento prevede l'anteprima "solo alla prima richiesta del giorno", che è un'eccezione alla regola. Correzione: una regola sola: **dialogo** quando la stima supera una soglia scelta dall'utente (predefinita 5 000 token) o quando si invia testo del documento la prima volta per quella cartella; **sotto soglia**, una riga nel pulsante stesso ("✦ Spiega · ≈ 900 token · Haiku"). In ogni anteprima, la quota residua del giorno ("Oggi: 38 % del tetto usato").
2. **importante — Spiega (31) e testo del documento (§17.4.9, regola 4).** La selezione è testo del documento: se la cartella non è abilitata, Spiega non può inviare. Lo stato manca. Correzione: voce attiva con la spiegazione "La cartella di questo documento non è abilitata per l'invio del testo · Abilita…"; la risposta appare in un popover ancorato **sotto** il passaggio, senza coprirlo, con "Copia nella nota".
3. **importante — Note di letteratura (2, §17.4.6).** (a) Dalla selezione "Scrivi le note di letteratura…" su 20 documenti sono 20 testi interi: l'anteprima deve mostrare il totale e proporre al massimo 5 per volta; (b) stato "Bozza ✦ da approvare" visibile nella scheda (la regola 5 dice che diventa dell'utente solo dopo l'approvazione, ma non c'è lo stato nella scheda); (c) cartella non abilitata → "solo da titolo e abstract" con l'avviso che la nota sarà povera.
4. **importante — Ricerca approfondita (41, §17.4.17).** Fino a 50 abstract = 5 richieste per una domanda. Correzione: l'elenco senza sintesi è il risultato **predefinito** (il ripiego diventa la norma); la sintesi ✦ è un pulsante nel risultato con la scelta 10 / 20 / 50 e la stima.
5. **importante — Trova un ponte (42, §17.4.17).** Stati mancanti: uno dei due documenti senza DOI o identificativo OpenAlex ("Manca l'identificativo di *Titolo* · Completa i dati"), fuori linea, nessun candidato bibliometrico (diverso da "Nessun ponte convincente", che è il giudizio di Claude). La voce c'è sempre (D.1.3) e spiega quando serve.
6. **importante — `.bib` collegato riscritto a ogni cambiamento (52, §17.4.7).** Un file scelto dall'utente, che lui o un altro programma (l'editor LaTeX, Zotero) possono modificare, viene sovrascritto: le modifiche a mano si perdono senza avviso. Correzione: l'app scrive solo se l'hash del file è quello della sua ultima scrittura; altrimenti banner nel progetto "Il file .bib è stato modificato fuori dall'app" [Sovrascrivi] [Scollega]; prima riga del file `% Generato da Research Lab: le modifiche qui verranno sovrascritte`.
7. **importante — Funzioni "da confermare" già in onda (D-399, 49 in X7; 13 in X1).** Lo schema del manoscritto (49) e l'esportazione in più formati (13) sono ancora da confermare in §17.5 e PROPOSTE, ma hanno file e budget assegnati. Correzione: X7 costruisce solo 40 e 54; 49 e 13 entrano in un'onda solo dopo la risposta dell'utente, scritta in DECISIONS.
8. **importante — Suggerimenti di citazione (51, §17.4.19).** Inviano i paragrafi dell'utente (testo inedito della tesi), che non è coperto dal consenso per cartella dei PDF. Correzione: consenso a parte ("Invia i miei paragrafi a Claude"), anteprima con il testo esatto, mai l'intero manoscritto: un paragrafo o una sezione scelti.
9. **importante — Affermazioni e prove (40, §17.4.15).** L'ingresso principale è "Usa come prova…" nel `⋯` del popover dell'annotazione (due livelli) e la scheda Prove compare solo dopo il primo uso: chi non sa che esiste non la trova mai. Correzione: con la scheda unica di D.1.2, lo stato vuoto dello Schema dice "Collega le evidenziazioni alle domande: nel lettore, popover dell'evidenziazione › Usa come prova"; nel popover la voce sta al primo livello **al posto** di una voce meno usata, non in aggiunta.
10. **minore — Tabella di confronto (16).** Le celle riempite da Claude portano ✦ una per una; l'anteprima conta le celle mancanti (documenti × colonne), non i documenti.
11. **minore — Lettura affiancata (3).** A 1024 due PDF affiancati sono illeggibili: sotto 1280 px "Affianca" apre il secondo come scheda alternata (Ctrl+Tab), con il motivo.
12. **minore — Ritaglia (27).** Dire dove va il ritaglio con una sola risposta predefinita: negli appunti e nelle note della pagina, con un toast "Ritaglio copiato · Annulla".
13. **minore — Risorse (48) e importazione da URL (23).** Leggere il titolo di una pagina contatta il sito: dirlo nella riga del dialogo; la risorsa nell'elenco ha un'icona del tipo, nessun colore nuovo.
14. **minore — Link `[[` e collegamenti in entrata (38).** I link si salvano per identificativo e mostrano il titolo: rinominare una nota non li rompe. LaTeX (37): una formula non capita si mostra com'è, con un segno discreto, mai un errore rosso.
15. **minore — Testi.** "Estendi la bibliografia" e "Aggiorna le citazioni" sembrano la stessa cosa: sotto ciascuna una frase ("Cerca citanti e citati di questi documenti, una volta" / "Controlla le novità delle fonti seguite"). "Già pronto, 0 invii" va bene; in inglese "Already done, nothing sent" → "Ready · nothing sent".

### D.4 Budget e onde (§13, §14.1)

1. **importante — X3 rompe la regola dei 16 KiB per chunk (§17.2).** Budget renderer di X3: 19-23 KiB. Correzione: tre chunk (editor delle note con LaTeX e `[[`; nota di letteratura; collegamenti in entrata), e `check:budget` con il tetto per singolo chunk del renderer, non solo per il totale.
2. **importante — Margini al limite.** Somme delle stime di §14.1: renderer totale 1714-1769 su 1775 (6 KiB di margine nel caso alto, per 5 onde), main iniziale 1066-1085 su 1090, main pigro 76-111 su 120. Le stime di questo progetto nei giri precedenti sono state superate più spesso che no. Correzione: `check:budget` in ogni compito (non solo in Y2) e un ordine di rinuncia scritto prima di cominciare: se un'onda supera la stima alta, si rimandano nell'ordine 30, 51, 54, 16.
3. **importante — Voce morta tra due onde.** X5 (onda 9) aggiunge "Linea del tempo" al `⋯` della selezione, ma la disposizione per anno è di X8 (onda 10): per un'onda la voce apre la Mappa senza fare niente. Correzione: la voce la aggiunge X8.
4. **importante — X1 è troppo grande.** Moduli pigri del main, divisione di `check-budget`, `crowding.spec.ts` e Zotero/BibTeX in un compito. Correzione: l'infrastruttura e `crowding.spec.ts` (con i conteggi del P0 e il tetto dei menu di D.1.3) li fa l'agente principale prima dell'onda 7, come i contratti; X1 resta solo Zotero e BibTeX.
5. **minore — Y1 costa quota Claude e richiede dati.** L'esperimento 30 su 10 paper sono ≈ 150 mila token Haiku. Correzione: 10 paper open access in una libreria sintetica (mai la cartella reale), risposte di Claude registrate una volta con il consenso dell'utente e poi rigiocate come fixture; Y1 non parte in parallelo a nessuna e2e pesante.

### D.5 Elenco per gravità

- **Bloccante (1):** D.1.1 conteggio della barra del lettore falso rispetto al P0 e barra già troppo piena (22 → 23; proposta 13).
- **Importanti (22):** D.1.2 schede del progetto; D.1.3 menu senza tetto e voci che compaiono e spariscono; D.1.4 ✦ su Estendi; D.1.5 `⋯` del progetto; D.1.6 banner Riprendi; D.1.7 schede delle citazioni e popover; D.2.1 contorni sul testo; D.2.2 accensione e spegnimento; D.2.3 invio della guida; D.3.1-D.3.9 costo e consenso, Spiega, note di letteratura, ricerca approfondita, Trova un ponte, `.bib` sovrascritto, funzioni da confermare in onda, suggerimenti di citazione, prove; D.4.1-D.4.4 chunk di X3, margini, voce morta, X1.
- **Minori (11):** D.1.8, D.1.9, D.2.4, D.2.5, D.3.10-D.3.15, D.4.5.

### D.6 Protocollo dell'esperimento 30 (onda 11, Y1)

**Preparazione.**
- Libreria sintetica con 10 paper open access (4 empirici, 2 rassegne, 2 teorici, 1 breve di 4 pagine, 1 scansione con livello di testo), cartella abilitata per l'invio del testo; mai la cartella reale.
- **Riferimento cieco:** prima di accendere la guida, per ogni paper segno a mano i passaggi di contributo, metodo, risultato chiave e limite (fixture `e2e/fixtures/guides-reference.json`).
- Risposte di Claude registrate una volta (Haiku, con il consenso dell'utente) e rigiocate; il costo misurato è quello della registrazione.

**Schermate** (1024×700, 1280×800, 1920×1080; chiaro e scuro; italiano e inglese): funzione spenta; sperimentali accese con guida spenta; "non ancora preparata"; in scrittura; attiva a riposo; passaggio al fuoco; dopo "Tieni"; "Nessun passaggio sicuro"; guida e evidenziazioni dell'utente sulla stessa pagina; lettore in modo strumento con la guida attiva.

**Misure e soglie** (una soglia per riga; le righe 1-4 e 7 sono **vincolanti**: una sola non superata e la funzione si toglie):

| # | Misura | Passa se |
| --- | --- | --- |
| 1 | Traccia a funzione spenta | 0 nodi dello strato nel DOM; conteggio della barra uguale al P0 corretto; differenza di pixel dell'area della pagina = 0 rispetto alla schermata senza la funzione |
| 2 | Affollamento | nessun controllo nuovo nella barra; `⋯` del lettore ≤ 7 voci; un solo chip, solo a strato attivo |
| 3 | Inchiostro | a riposo nessun segno sopra il testo (solo margine); segni ≤ 12 per paper; area dei segni ≤ 2 % della pagina |
| 4 | Confusione con i segni dell'utente | 0 sovrapposizioni tra rettangoli della guida e evidenziazioni dell'utente; in scala di grigi i due tipi si distinguono (la guida non ha riempimento né sottolineatura); nome accessibile "Passaggio guida ✦: risultato" |
| 5 | Precisione | ≥ 60 % dei passaggi proposti coincide (≥ 50 % del testo in comune) con un passaggio del riferimento; il "risultato chiave" trovato in ≥ 7 paper su 10; 0 passaggi da bibliografia, intestazioni o didascalie |
| 6 | Utilità | in ≥ 6 paper su 10 almeno un passaggio è usato (Tieni o salto dall'elenco); poi l'utente prova la guida su 3 paper suoi e risponde sì/no a "la terresti accesa?": il suo no toglie la funzione |
| 7 | Costo | nessun invio senza conferma o fuori soglia; token per paper ≤ stima dell'anteprima + 15 %; riapertura = 0 invii; paper con nota di letteratura = 0 invii; tetto del giorno rispettato |
| 8 | Prestazioni | disegno dello strato ≤ 16 ms per pagina; fps di scorrimento entro il 5 % della guida spenta; nessuno spostamento del testo |
| 9 | Comandi | accendere e spegnere dallo stesso posto in ≤ 2 azioni, e con G; Esc non spegne lo strato; l'elenco dei passaggi si percorre da tastiera |
| 10 | Stati | presenti e con testo: spenta, non preparata, in scrittura (annullabile in Attività), attiva, nessun passaggio sicuro, fuori linea, cartella non abilitata, scansione senza testo |

**Esito.** Rapporto in `docs/design/` con i numeri per riga e i nomi delle schermate (le schermate restano in `audit-shots/`, non committate). Tutte le righe superate: la guida resta **sperimentale**, D-401 aggiornata. Una riga vincolante non superata, oppure il no dell'utente alla riga 6: la voce sparisce, il codice resta spento e D-401 registra il motivo. Righe 5, 8, 9 o 10 non superate: una correzione e una seconda prova sola; poi stessa regola.

---

## Audit dopo le onde 1-2 (giro 5)

Oggetto: `main` a 42fb7f9 (onda 1: A1 token e componenti, B1 account; onda 2: C2 impostazioni, A2 guscio), app compilata e guardata a vista. Riferimento visivo: il prototipo approvato P0 (`docs/design/prototipo/index.html`), fotografato con lo stesso Electron (`audit-shots/run6-w2/P0-*.png`, conteggi in `P0-counts.json`). Nota: nel P0 la vista Libreria lancia un errore a fine disegno (riga 372: `$('[data-detail]').forEach` invece di `$$`); la pagina si vede comunque, solo il pulsante "Scheda" del P0 non funziona.

Metodo: nuovo giro "wave 2" in `e2e/design-audit.spec.ts` (`-g "wave 2"`, saltato senza `RL_DESIGN_AUDIT=1`; righe dei lavori nel popover Attività, impostazioni per sezione con `settings-nav-<sezione>` e `settings-fold-<gruppo>`). Librerie sintetiche `it` ed `en`, fornitore AI simulato, rete tagliata, Claude Code **simulato** (`RL_E2E_CLAUDE_SIM`, come `ai-account.spec.ts`: mai il programma né l'account reali). Schermate in `audit-shots/run6-w2/` (non committate): `w2it-*` (112) e `w2en-*` (98) a 1280×800 chiaro, poi scuro 1280×800, chiaro e scuro 1920×1080; ritagli della scheda Account `w2*-card-*.png`; misure in `metrics-w2it.json` e `metrics-w2en.json` (conteggi per zona `count-*`, geometria del guscio e del lettore, regole di pdf.js fuori dal lettore, console). Una prima esecuzione italiana è stata scartata: una finestra di prova del P0 aperta nello stesso processo riceveva i cambi di dimensione e tutte le schermate uscivano a 1296×838; quella buona è la seconda, senza quella finestra.

**Verdetto.** L'aspetto è quello del P0: fondo carta, barra laterale con la pillola bianca sulla voce attiva, badge petrolio, popover e toast con l'elevazione giusta, tema scuro coerente. Le impostazioni sono finalmente chiare (7 sezioni, ricerca, Sviluppatore / Avanzate a gruppi chiusi) e cambiare account Claude costa tre clic con un dialogo che dice cosa succede. **Nessun problema bloccante.** Ci sono però difetti di rifinitura che il P0 non aveva e che si vedono subito: la barra in alto che finisce sotto il pannello Claude a 1280 px, la scheda Account che esce dal suo riquadro, stati dell'account contraddittori o vecchi, pulsanti disattivati che sembrano più "pieni" di quelli attivi, la barra in alto che salta quando cambia il testo di Attività. Sono correzioni piccole, da fare prima che D3 ed F4 costruiscano sopra il guscio.

### E.1 Risultati

Gravità come sopra. "Correzione subito" = prima dell'onda 3 (file di A2/C2 già uniti); altrimenti il compito di §14 che la deve fare.

| Id | Gravità | Schermata | Evidenza | Cosa non va (contro P0 o regola) | Correzione · chi |
| --- | --- | --- | --- | --- | --- |
| W1 | importante | Guscio con il pannello Claude aperto, 1180-1439 px | `w2it-061-view-library-chat-light-1280x800.png`, `w2en-060-view-library-chat-light-1280x800.png` | La barra in alto non si stringe: "Comandi" è tagliato e il chip Attività ("1 da guardare", anello rosso e puntino) è disegnato **sopra** l'intestazione del pannello ("C̶laude", "No check…ending to Claude"). A 1920 è corretto (`w2en-082-…`). Il pannello di uno dei compiti principali si apre con l'intestazione illeggibile | `.topbar { overflow: hidden }` e una container query sulla barra: sotto ~760 px "Comandi" solo icona, chip solo anello + testo corto con `max-width` ed ellissi, ricerca ridotta a icona sotto ~640 px; prova e2e a 1280×800 con il pannello aperto: nessun figlio della barra fuori dal suo rettangolo. **Correzione subito** (A2) |
| W2 | importante | Impostazioni › Claude, scheda Account (it, en, ogni dimensione) | `w2it-card-account-connected-light.png` (il ritaglio taglia pulsante e scelta), `w2it-029-settings-claude-light-1280x800.png`, `w2en-029-…` | Il riquadro è largo ~544 px, il contenuto ~608: "Prova la connessione · circa 0,001 $" e la scelta "Automatico · Accesso di Claude Code · Chiave API" escono di ~64 px dal bordo destro. Nel P0 il riquadro è largo quanto la colonna (~720 px) e tutto sta dentro (`P0-settings-light-1280x800.png`) | Riquadri delle impostazioni larghi quanto la colonna del contenuto (max 760, §4.6, come il P0); nelle righe `min-width: 0` e `flex-wrap` sui controlli; prova: nessun discendente di `[data-testid=ai-account]` fuori dal suo rettangolo a 1024, 1280 e 1920. **Correzione subito** (C2) |
| W3 | importante | Account, modo "Chiave API" senza chiave | `w2it-card-account-apikey-mode-no-key-light.png`, `w2en-052-account-apikey-mode-no-key-light-1280x800.png` | Quattro messaggi che si contraddicono nello stesso riquadro: "● Non collegato", sotto l'email e il piano dell'account, "✓ Funziona · 0.0 s · Haiku 5.5" (prova di prima), "Collegato come second@…" (nota del cambio di account); il primario diventa "Cambia account…", che in questo modo non risolve nulla | Al cambio di `effective` si cancellano esito della prova e nota; in modo Chiave API senza chiave l'identità di Claude Code si mostra in grigio con "(non usato)" oppure si nasconde, e il primario è "Aggiungi chiave…" ("Cambia account…" torna secondario). **Correzione subito** (C2) |
| W4 | importante | Account dopo un'uscita fatta fuori dall'app | `w2it-card-account-not-logged-in-same-page-light.png` contro `w2it-054-account-not-logged-in-light-1280x800.png` | `claude auth status` si legge solo all'apertura della pagina delle impostazioni (`SettingsProvider`): se l'utente esce da Claude Code nel terminale, la scheda continua a dire "Collegato con l'accesso di Claude Code · second@…" finché non lascia la pagina. Lasciando la pagina lo stato è giusto e ben fatto ("Non collegato" + primario "Accedi con Claude Code…") | Rileggere `ai:account` quando si entra nella sezione Claude e al ritorno del fuoco sulla finestra (al massimo una volta ogni 30 s); voce "Ricontrolla" nel `⋯` dell'account. **Correzione subito** (C2) |
| W5 | importante | Barra in alto all'avvio e in ogni vista | `w2it-010-shell-library-light-1280x800.png` (‹ › ↶ ↷), `w2it-024-settings-general-p2-light-1280x800.png` (← piatto, → incorniciato) | I pulsanti icona **disattivati** hanno un bordo (la regola di base `button:disabled { border-color: var(--border) }` vince sul bordo trasparente di `.rl-iconbtn`), quelli attivi sono piatti: l'utente vede in rilievo proprio ciò che non può usare. Contro §5.5.1 (il disattivato è l'unico stato che **perde** contrasto) | `button.rl-iconbtn:disabled { border-color: transparent }` e un caso in `components/states.test.ts` (bordo del disattivato = bordo a riposo). **Correzione subito** (A1/A2) |
| W6 | importante | Barra in alto, ogni vista | `w2it-010-…` contro `w2it-018-shell-toast-light-1280x800.png`; `w2en-034-settings-shortcuts-light-1280x800.png` | Il testo del chip cambia lunghezza ("Indice aggiornato: 4 documenti" ↔ "1 da guardare") e con lui si spostano di ~100 px ricerca, Annulla, Ripeti, Cronologia e Comandi; quando una vista scorre, tutta la barra si sposta di 15 px per la barra di scorrimento. Un'interfaccia calma non sposta i comandi sotto il mouse. Il P0 usava un testo corto e fisso ("Aggiornata · 14:32") | Chip a larghezza massima fissa (~180 px) con testi corti come nel P0 ("Aggiornata · 10:00", "In corso 45 %", "1 da guardare"), dettaglio nel tooltip e nel popover; `scrollbar-gutter: stable` sul contenitore che scorre. **Correzione subito** (A2) |
| W7 | importante | Tavolozza dei comandi | `w2it-015-shell-palette-light-1280x800.png`, `w2it-079-shell-palette-light-1920x1080.png`, `w2en-064-shell-palette-dark-1280x800.png` | Campo di ricerca largo ~160 px in un dialogo di 520 (segnaposto tagliato "Cerca un comando o u"); in fondo "Scegliere un comando riempie la casella del messaggio…" anche per "Vai a" e "Azioni", dove è falso; barra di scorrimento nativa con le frecce; manca "Recenti" (§3.4); "Vai a Da rivedere" / "Go to To review" | Campo a tutta larghezza; la frase in fondo solo quando la voce attiva è del gruppo Claude; barra di scorrimento sottile coi token; gruppo "Recenti"; testi "Apri Da rivedere" / "Open To review". **Correzione subito** (A2) |
| W8 | importante | Impostazioni › Avanzate | console registrata con `w2it-038-settings-advanced-light-1280x800.png` e `w2en-038-…` | `MaxListenersExceededWarning: 11 rl:event listeners added` all'apertura di Avanzate: N12 non è chiuso, benché fosse un criterio di C2 ("nessun avviso dopo 20 aperture") | Trovare chi si iscrive a `rl:event` senza disiscriversi (sezioni di Avanzate: `SavedKeys`, `McpSection`, `MaintenanceSection`) e aggiungere la prova delle 20 aperture. **Correzione subito** (C2) |
| W9 | importante | Avanzate › Manutenzione e › Server MCP | `w2en-045-advanced-maintenance-light-1280x800.png`, `w2en-042-advanced-mcp-light-1280x800.png` | Dimensioni e stati sono ancora un `<dl>` senza stile (etichetta e valore su due righe con il rientro del browser: Z1, §4.8 "gli stati usano KeyValue"); "PROPORRE"/"PROPOSE" in maiuscolo (N13); "Stato / Chiamate" del server allineati male | `KeyValue` ovunque in Avanzate; testo senza maiuscolo. **Correzione subito** (C2) |
| W10 | importante | Lettore nel guscio nuovo | `w2it-062-reader-light-1280x800.png`, `w2en-061-reader-light-1280x800.png`, `w2en-083-reader-light-1920x1080.png` contro `P0-reader-light-1280x800.png` | **Il PDF non è stirato**: pagina 694×982 a 1280 e 1333×1886 a 1920, rapporto 0,7067 = MediaBox 595×842; nessuna regola di pdf.js tocca l'app, barra laterale identica prima e dopo il lettore. Ma lo spazio è peggiore del P0: barra laterale estesa (232 px, scelta di A2 in D-438), barra in alto, barra del lettore su **due righe** in italiano, riga di studio e un paragrafo di tasti di 4 righe: 247 px di intestazione su 800, area del PDF 709×553. Nel P0: barra laterale compressa a 56, una barra da 48, area ~910×650, pagina con bordo e ombra su fondo `--bg` (nell'app pagina bianca su bianco). Titolo del lettore tagliato a 241 px anche a 1920 | F4 come da §4.3 / D-410 (barra unica di 13 controlli, tasti nel `?`), **più** la barra laterale compressa nel lettore (si torna al disegno: si adegua la tolleranza di `reader-geometry`, non il guscio) e la pagina su `--bg` con `--page-shadow`. **F4** |
| W11 | importante | Barra in alto e Libreria | `w2it-010-…`, `count-topbar-*` | Due ricerche della libreria visibili insieme (pulsante nella barra in alto + campo nella vista): previsto da A2 fino a D3. Ma il conto: oggi la barra ha 8 controlli (‹ › ricerca ↶ ↷ 🕘 Comandi Attività); quando D3 aggiunge `?` e `✦` nel campo diventano **10**, contro i **9** del P0 e di §17.3 (il P0 non ha Ripeti) | Decidere **prima di D3**: Ripeti fuori dalla barra (Ctrl+Y, voce nel popover Cronologia e nella tavolozza), così la barra resta a 9 come il P0. Campo vero nella barra in alto e niente campo nella vista: **D3** |
| W12 | minore | Impostazioni, briciole | `w2it-029-…` contro `P0-settings-light-1280x800.png` | Le briciole dicono solo "Impostazioni"; §3 e il P0: "Impostazioni › Claude" | Segmento della sezione. **Correzione subito** (A2/C2) |
| W13 | minore | Impostazioni, campo di ricerca | `w2it-023-settings-general-light-1280x800.png` | Campo nudo senza icona, angoli e altezza diversi dagli altri campi; nel P0 ha la lente e il fondo `--surface` | Stesso disegno della ricerca del P0. **Correzione subito** (C2) |
| W14 | minore | Impostazioni a 1920 | `w2it-081-settings-claude-light-1920x1080.png`, `w2en-074-…` | Sottonavigazione e contenuto attaccati a sinistra con ~800 px vuoti a destra. Lo fa anche il P0 (`P0-settings-light-1920x1080.png`), ma §5.3 chiede di centrarli ("mai contenuto stretto a sinistra con il vuoto a destra") | Centrare il blocco nav + contenuto nello spazio libero sopra 1600 px: una regola CSS. **Correzione subito** (C2) |
| W15 | minore | Claude › Cosa può leggere Claude | `w2it-030-settings-claude-p2-light-1280x800.png`, `w2en-074-…` | L'etichetta "Cartelle abilitate a Claude" è centrata in verticale, 120 px sotto l'inizio del suo controllo; avviso in riquadro + caselle + albero in una cornice dentro la scheda (cornici annidate, §1.1 regola 5). Il P0 usa una riga di chip ("✓ Capitolo 1 · ✓ Capitolo 2 · Bozze · Riservato") | Righe allineate in alto (`align-items: start`); chip per cartella fino a ~8 cartelle, albero solo oltre; "nessuna cartella" come testo di aiuto, non riquadro. Allineamento **correzione subito**; chip: C2 al primo ritocco o I5 |
| W16 | minore | Popover Attività con un errore | `w2it-020-shell-activity-with-rows-light-1280x800.png` | "0/1 fatti, 1 falliti" (plurale sbagliato); solo "Nascondi", manca [Riprova] di §4.10; il toast "Aggiornamento delle citazioni avviato" resta mentre la riga dice già "fallito" | Plurali i18next, [Riprova] come azione della riga, il toast "Avviato" si chiude quando il lavoro finisce. **Correzione subito** (A2) |
| W17 | minore | Chip Attività dopo la procedura guidata | `w2it-010-…`, `w2en-010-…` | Puntino "risultato non visto" subito dopo la prima scansione: la prima scansione è la libreria, non una novità (stesso principio di §7.1 per il badge) | La procedura segna come visto l'esito della prima scansione. **D3** (procedura guidata) |
| W18 | minore | Avanzate › Claude, modelli e prezzi | `w2it-041-advanced-claude-light-1280x800.png` | Tre campi impilati per modello senza etichette visibili ("0.1", "0.5"), "Rimuovi" come testo isolato | Una riga per modello: id · etichetta · in $/M · out $/M · 🗑, con una riga d'intestazione. C2 al primo ritocco (onda 5 al più tardi) |
| W19 | minore | Testi e formati | `w2it-card-account-tested-light.png`, tavolozza, `w2it-046-…` | "0.0 s" con il punto in italiano accanto a "0,001 $"; tasti in monospazio nella tavolozza e in sans nella barra laterale (`Kbd` deve essere uguale ovunque); "Calcola il totale di tutte le librerie" in grassetto senza aspetto di pulsante o link | `Intl.NumberFormat` per i secondi; un solo stile `Kbd`; il totale come pulsante terziario. **Correzione subito** |
| W20 | minore | Pannello Claude | `w2it-061-…`, `w2en-082-…` | L'account in uso non compare nell'intestazione del pannello (§10.5) | **I5** |
| W21 | minore | Barra laterale compressa | `w2it-022-shell-review-badge-collapsed-light-1280x800.png` | Voce attiva e voce sotto il mouse hanno lo stesso riquadro bianco: non si capisce dove si è | Da compressa: attiva con `--accent-soft` e icona `--accent-text`, passaggio `--surface-2`. **Correzione subito** (A2) |
| W22 | minore | Impostazioni › Libreria | `w2it-027-settings-library-light-1280x800.png` | Percorso completo in monospazio (§4.6: abbreviato "…\Tesi"; il monospazio solo in Avanzate); "Scansiona ora" in tre posti (intestazione della Libreria, Impostazioni, Attività) | Percorso abbreviato con il completo nel tooltip. **Correzione subito**; il pulsante della Libreria se ne va con **D3** |

**Viste non ancora migrate** (cosa devono sistemare le onde 3+, confermato a vista):
- **Libreria (D3):** 15 controlli fra intestazione e filtri (P0: 4 + 8 nella riga dei filtri), "Chiedi a Claude", "Tassonomia", "Scansiona ora" e "Ricostruisci l'indice" ancora in testa; barra di selezione di 6 pulsanti su **due righe** a 1280 (`w2it-018-…`; P0 e §17.3: 5 su una riga); riga attiva con tre icone minuscole senza etichetta; scheda del documento con pulsanti su tre righe ("Show / in / folder", `w2en-059-…`) e modulo di modifica aperto. Righe, badge e tipografia sono già quelli del P0.
- **Da rivedere (E3):** Modello e Ragionamento in testa alla vista, in italiano l'etichetta "Modello" separata dal suo menu che va a capo (`w2it-070-view-review-dark-1280x800.png`); nome del file in maiuscolo ("DOWNLOAD.PDF", N22); tre nomi (barra laterale "Da rivedere", scheda "Arrivi", briciole "Nuovi file"); modulo lungo a tutta pagina.
- **Progetti (H5):** "Crea" grigio disattivato accanto al campo vuoto (contro §5.5.1), modulo fisso in alto invece del primario "+ Nuovo progetto" (`w2en-056-…`).
- **Scopri (H5):** schede "Leggi dopo · Nuovi · Pubblicati · Fonti" invece di "Ricerche · Da leggere dopo · Novità · Pubblicati" (§17.3, D-427).
- **Mappa (M4):** campo "Seme" nell'intestazione (va nelle Opzioni del modello) e due "Costruisci il modello" uno sopra l'altro (`w2en-058-…`).
- **Pannello Claude (I5):** Modello e Ragionamento come menu a tutta larghezza sotto il campo, due pulsanti di testa, paragrafo di tasti in fondo (`w2en-082-…`).
- **Lettore (F4):** vedi W10; 17 controlli contro i 13 previsti.

### E.2 Affollamento: conteggi contro §17.3 (1280×800, controlli visibili)

| Zona | P0 | §17.3 | Misurato | Esito |
| --- | --- | --- | --- | --- |
| Barra laterale | 8 (5 + 3) + selettore | 5 + 3 | 10 = [≡] + selettore + 5 + 3 | in regola ([≡] e selettore sono di §4.1) |
| Barra in alto | 9 (‹ › ricerca ? ✦ ↶ 🕘 Comandi Attività) | 9 | 8 (‹ › ricerca ↶ **↷** 🕘 Comandi Attività) | in regola oggi; **10 dopo D3** se Ripeti resta (W11) |
| Popover Attività | — | — | 1 a riposo (Scansiona ora), 2 con un errore | in regola (§4.10) |
| Popover della libreria | — | — | 3 voci (libreria attiva, Nuova libreria, Gestisci librerie…) | in regola |
| Tavolozza | — | — | 17 voci senza testo (Vai a 7, Azioni, voci disattivate col motivo) | in regola come elenco; manca "Recenti" (W7) |
| Impostazioni | 7 sezioni | 7 | 7 + ricerca | in regola |
| Impostazioni, per sezione (visibili senza scorrere) | — | — | Generale 6 · Profilo 6 · Libreria 7 · Claude 9 · Backup 1 · Scorciatoie 13 (righe con `⋯`) · Avanzate 8 (3 chiavi + 5 gruppi chiusi) | calme; Backup ha **un** primario, come chiede §4.6 |
| Scheda Account | 8 (prova, 3 modi, Cambia, `⋯`, Aggiungi chiave, totale) | — | 8 | uguale al P0 (W2 è un difetto di disposizione, non di numero) |
| Menu `⋯` dell'Account | 1 | — | 1 (Esci da Claude Code…, in rosso) | in regola |
| Gruppi di Avanzate aperti | — | — | Claude 20 (editor dei modelli), MCP 5 (+ testo lungo), Scansione 5, Esportazione 2, Manutenzione 1 | ammesso perché chiusi per impostazione; W18 |
| Libreria · intestazione + filtri | 4 + 8 | 4 + 8 | 15 | **troppi** (D3) |
| Libreria · barra di selezione | 5 | 5 | 6, su due righe | **troppi** (D3) |
| Lettore · barra | 22 | 13 | 17 (più la riga di studio) | **troppi** (F4) |

Nessuna zona di A2 o C2 supera il P0. Le zone in eccesso sono tutte di viste non ancora migrate, e i compiti che le possiedono hanno già il numero giusto nei criteri.

### E.3 Cosa è chiaramente meglio di prima

- **Impostazioni:** da una pagina di 8142 px con 125 controlli a 7 sezioni brevi, con sottonavigazione fissa e ricerca che mostra "Sezione › Gruppo" (`w2en-040-settings-search-light-1280x800.png`); Sviluppatore / Avanzate separato, con le chiavi salvate in cima e cinque gruppi chiusi (`w2it-038-…`); Backup con un solo messaggio e un solo primario; ⚠ sulla sezione Claude quando non è collegato.
- **Account Claude:** stato in una frase con punto colorato, email e piano; "Cambia account…" → dialogo che dice cosa succede → attesa con il primario "Ho finito, verifica" → "Collegato come …" (`w2it-049-…`, `w2it-050-…`, `w2it-card-account-switched-light.png`); "Esci da Claude Code…" nel `⋯`, in rosso; stato "Non collegato" con il primario "Accedi con Claude Code…". Prima non si poteva cambiare account dall'app.
- **Notifiche:** barra di stato tolta; chip Attività con anello e popover a gruppi; badge di "Da rivedere" che conta solo i file, con tooltip e `aria-label` "Da rivedere: 1 file nuovo · Alt+2" (prima `title` nullo e tre nomi); toast in basso a destra con un'azione ("Vedi in Attività").
- **Navigazione:** Alt+1…5 nell'ordine della barra laterale (N21 chiuso), indietro/avanti, briciole, selettore della libreria a popover, barra laterale comprimibile, tavolozza a gruppi con i tasti e le voci disattivate col motivo.
- **Lettore:** il PDF non è più stirato (rapporto pagina/MediaBox esatto a 1280 e 1920) e il suo CSS non contamina più l'app (barra laterale identica prima e dopo il lettore).
- **Sistema visivo:** token del P0 in tutta l'app, anche nelle viste vecchie; tema scuro coerente; nessun testo sotto il contrasto AA nelle misure di questo giro.

### E.4 Correzioni prima dell'onda 3, in ordine

1. **W1** barra in alto che finisce sotto il pannello Claude tra 1180 e 1439 px (overflow nascosto e barra compatta).
2. **W2** scheda Account che esce dal riquadro (riquadri larghi quanto la colonna, come il P0).
3. **W3 + W4** stati dell'account coerenti e aggiornati (pulire prova e nota al cambio di modo, primario giusto, rilettura all'ingresso nella sezione e al ritorno del fuoco).
4. **W5** pulsanti icona disattivati senza bordo.
5. **W6 + W7** barra in alto che non salta (chip a larghezza fissa, `scrollbar-gutter`) e tavolozza rifinita (campo largo, frase giusta, Recenti).
6. **W8 + W9** ascoltatori di `rl:event` e `KeyValue` in Avanzate (criteri di C2 non chiusi).
7. Decisione **W11** (Ripeti fuori dalla barra in alto) scritta in DECISIONS prima di D3.

I minori marcati "correzione subito" (W12-W16, W19, W21, W22) stanno negli stessi file e vanno nello stesso compito: un compito unico ("R2": `shell/**`, `settings/**`, `views/chat/Palette.tsx`, `components/controls.css`) prima di F4, che tocca `shell/Topbar*`; può andare in parallelo con D3 se D3 non tocca la barra in alto. **Nulla blocca l'avvio dell'onda 3.**

## Audit finale (giro 6)

Oggetto: ramo `audit3` a dabc8b7 (tutte le onde unite, fino a w12: RIS, CSL JSON, PRISMA). Riferimento visivo: il P0 (`docs/design/prototipo/index.html`, foto in `audit2/audit-shots/run6-w2/P0-*.png`). Metodo: nuovo giro "final" in `e2e/design-audit.spec.ts` (`-g "final"`, saltato senza `RL_DESIGN_AUDIT=1`), su un corpus sintetico di 220 documenti in italiano (`{ corpus: 220, language: 'it' }`: cartelle, autori e anni bastano alla Mappa), fornitore AI simulato, rete tagliata, Claude Code **simulato** (`RL_E2E_CLAUDE_SIM`, mai il programma né l'account reali). 110 schermate in `audit-shots/run8-final/` (non committate): `fit-001…083` a 1280×800 chiaro (procedura guidata, Libreria con menu e selezione, note di letteratura, tabella di confronto, esportazione, scheda, lettore con menu, pannello e lettura affiancata, Da rivedere, Mappa con le quattro schede e le reti per entità, Scopri, progetto con Schema, PRISMA ed esportazione, impostazioni con il tetto dei token, Attività, tavolozza, pannello Claude), poi `fit-084…110` per le viste principali in scuro 1280, chiaro 1920 e scuro 1920. Misure in `metrics-fit.json` (conteggi `count-*`, contrasto, ritagli, console). Inglese: non rieseguito; il controllo statico delle chiavi (sotto, Z1) vale per entrambe le lingue, che hanno la stessa struttura dei file.

**Verdetto.** Il guscio, la Libreria, la scheda, il lettore a barra unica, Da rivedere, i progetti e le impostazioni hanno ora l'aspetto e i conteggi del P0: è il salto più grande dall'inizio. Restano due problemi **bloccanti**: 43 chiavi di testo che compaiono crude (in italiano e in inglese) in menu e dialoghi di funzioni nuove, e la scheda Collegamenti della Mappa, che con 31 controlli è l'opposto di "non affollato". La Mappa nel complesso è la vista più debole: la Panorama non è bella né divertente come nel P0, e Esplora, Vicini inattesi e la rete degli autori hanno stati vuoti contraddittori. Il resto sono rifiniture.

### F.1 Risultati

| Id | Gravità | Schermata | Evidenza | Cosa non va | Correzione · file |
| --- | --- | --- | --- | --- | --- |
| Z1 | **bloccante** | Selezione ⋯, lettura affiancata, ⋯ del progetto, Avanzate, tabella di confronto, schede delle citazioni, guida | `fit-019` ("library.selSideBySide"), `fit-038` ("reader.split.pickTitle", "reader.split.pickSearch"), `fit-064` ("projects.bib.link"), `fit-078` ("settings.advanced.experimental"), `fit-021`/`fit-022` ("compare.preview", "compare.what") | **43 chiavi** usate dal codice non esistono nel dizionario unito (core + parti), uguali in `it` e `en`: `library.selSideBySide/selSideReason`, `projects.bib.*` (6), `settings.advanced.experimental`, `settings.experimental.label/help`, `reader.cite.*` (8), `reader.guide.*` (14), `reader.split.*` (9), `reader.unsplit`. Causa: nei file `locales/parts/<lng>/{library,projects,settings,reader}.json` le chiavi stanno alla **radice** del file invece che dentro lo spazio dei nomi (es. `"selSideBySide"` dopo la chiusura di `"library"`, `"bib": {…}` fuori da `"projects"`, `"advanced"` fuori da `"settings"`). In più `compare.preview` e `compare.what` esistono solo come plurali (`_one/_other`) ma il codice passa `requests`/`cells` invece di `count` | Spostare le chiavi dentro il loro spazio dei nomi nelle due lingue; in `CompareView.tsx` passare `count`; aggiungere `i18n/usedKeys.test.ts`: ogni `t('a.b')` letterale del renderer deve risolversi (o come plurale) nel dizionario unito `it` ed `en`, così l'errore non torna. File: `i18n/locales/parts/{it,en}/*.json`, `i18n/usedKeys.test.ts` (nuovo), `views/compare/CompareView.tsx` |
| Z2 | **bloccante** | Mappa › Collegamenti | `fit-044`, `fit-097`; `count-map-network` = 31 | Due righe di controlli (Rete di ×4, "M cambia modo", Vai a, Parti dal documento scelto, Parti da una cartella, Parti da un tag, Vicini, 6 caselle "Espandi per", Espandi, Comprimi, Rimuovi nodo, Azzera, 3 icone, ⋯), una legenda, un paragrafo di istruzioni di due righe; il grafo resta un gomitolo di 300 px con etichette sovrapposte. Il P0 della Mappa ha ~12 controlli in tutto. Contro §1.1 regole 1 e 5 e la richiesta esplicita dell'utente | Una riga sola: `Rete di` (Segmented) · Vai a · chip "Partenza ▾" (documento, cartella, tag, vicini) · chip "Espandi per ▾" (le 6 caselle) · icone a destra · ⋯ (Comprimi, Rimuovi nodo, Azzera, Libera i nodi fissati). Espandi sul cartellino del nodo (doppio clic resta). Istruzioni nel `?` della vista e nel suggerimento al primo uso. Il grafo occupa tutta l'altezza e adatta la vista (fit) dopo ogni espansione; etichette con anticollisione. Obiettivo: ≤ 12 controlli. File: `views/network/LinksPanel.tsx`, `GraphNet.tsx`, `NetworkView.tsx`, `network.css` |
| Z3 | importante | Mappa › Panorama | `fit-043`, `fit-087`, `fit-096`, `fit-055` contro `P0-map-light-1280x800.png` | Non è bella né divertente: sette inviluppi traslucidi sovrapposti fanno una macchia marrone, i nodi sono quadratini di 4 px, solo 4 cluster su 7 hanno l'etichetta, la legenda taglia i nomi e ha un link "Esporta" per riga con una barra di scorrimento orizzontale (in `fit-055` è scorsa e i nomi sono tagliati a sinistra), la minimappa è un riquadro bianco. Il P0: gruppi separati, nodi tondi, nome del gruppo nel suo colore. (Il corpus sintetico ha testi casuali e si sovrappone più di una libreria vera, ma le scelte di disegno peggiorano il risultato) | Inviluppo pieno solo per il cluster sotto il mouse o a fuoco, gli altri con un alone leggero (opacità ≤ 0,06) o solo il bordo; nodi tondi 6-8 px con un anello bianco, grandezza per citazioni; etichetta di ogni cluster nel suo colore al baricentro, con anticollisione; legenda a larghezza fissa con ellissi e tooltip, senza scorrimento orizzontale, "Esporta come secondo cervello…" nel ⋯ del cluster; minimappa su `--surface` traslucido col bordo `--border`; animazione d'ingresso breve (i nodi che si assestano) per il "divertente". File: `views/network/MapCanvas.tsx`, `MapPanel.tsx`, `hulls.ts`, `labelsLod.ts`, `MiniMap.tsx`, `network.css`, `palette.css` |
| Z4 | importante | Mappa, intestazione e barra | `fit-042`, `fit-043`, `fit-051`; `count-map-head` = 16 | Il campo **Seme** è ancora in testa e lo stato vuoto ha **due** "Costruisci il modello" (già in giro 5); "Etichetta i cluster con Claude" è un pulsante grande nella barra; "Colora per" va a capo; il ⋯ ha solo 2 caselle (§17.3: Opzioni del modello, Disponi per anno, Esporta l'immagine, ✦ Etichette con Claude…); stato "Modello aggiornato (220 documenti). · costruito 2026-11-19 00:57" (punto spurio, data ISO) | Come §17.3: in testa solo "Costruisci la mappa" (primario se manca o è vecchia, altrimenti "Aggiorna" secondario) e ⋯; Seme in ⋯ › Opzioni del modello; Etichette ✦ ed Esporta l'immagine nel ⋯; Ambito e Colora per come chip; nello stato vuoto un solo primario; data con `Intl.DateTimeFormat`. File: `views/network/NetworkView.tsx`, `MapPanel.tsx` |
| Z5 | importante | Mappa: Autori, Esplora, Vicini inattesi | `fit-045`, `fit-098` (stato "Allarga i filtri" **sopra** un grafo che disegna 2 nodi), `fit-049` ("Qui non c'è nulla." e 5 pulsanti disattivati), `fit-050` | Stati che si contraddicono; Esplora vuota senza spiegazione né azione (non ci sono temi senza tag); Vicini inattesi mostra id esadecimali ("c94cbbe0", "75688792") al posto dei titoli e una pagina di link sottolineati | Stato vuoto **al posto** del canvas (non sopra); Esplora: stato vuoto con il motivo e l'azione ("Crea i primi tag" / passa ad Autori), pulsanti nascosti finché non c'è una scelta; Vicini: titolo o nome del file, mai l'id; righe a due livelli (coppia, poi termini in `--text-muted`) senza sottolineatura a riposo. File: `views/network/EntityNet.tsx`, `Explore.tsx`, `NetworkView.tsx`, `entityData.ts` |
| Z6 | importante | Barra in alto, 1280 | `fit-040` ("Da rivedere › Nu…"), `fit-063` ("Progetti ›" / "Capitolo 2 · Met…" su **due righe**), `fit-075`; ritaglio di `act-chip__text` in ogni schermata | Le briciole non hanno spazio: si troncano o vanno a capo e spostano la barra; il chip Attività è ancora "Indice aggiornato: 22…" con l'ellissi (W6 di giro 5 non chiuso) | Briciole su una riga (`white-space: nowrap`), ellissi solo sull'ultimo segmento con `min-width: 160px`; la ricerca si stringe prima delle briciole; chip con testi corti del P0 ("Aggiornata · 01:56", "In corso 45 %", "1 da guardare"), dettaglio nel tooltip. File: `shell/Topbar.tsx`, `shell/ActivityChip.tsx`, `shell/topsearch.css` e il CSS del guscio |
| Z7 | importante | Lettore | `fit-029`, `fit-094` contro `P0-reader-light-1280x800.png`; `fit-039` | La pagina è bianca su fondo bianco: non si vede dove finisce la pagina (il P0: fondo `--bg` e pagina con ombra; W10 lo chiedeva). Nella lettura affiancata due barre di scorrimento orizzontali native con le frecce anche ad "adatta alla larghezza", e zoom al 75 % | `[data-testid=reader-pages-area] { background: var(--bg) }`, `.page { box-shadow: var(--page-shadow); margin: 16px auto }`; nell'affiancata `overflow-x: hidden` quando lo zoom è "adatta", barre sottili coi token. File: `views/reader/reader.css`, `split.css` |
| Z8 | importante | Lettore, menu Studio e ⋯ | `fit-031`, `fit-032` | Studio ▾ ha **8 voci** (tetto 7; §17.3: 5): ci sono anche "Sottolineato" ed "Esporta una copia annotata…", che qui è attiva mentre la stessa voce nel ⋯ è disattivata; "Salva anche nel PDF" disattivata senza motivo; aprendo il ⋯ il fuoco cade su "Annulla" disattivato | Esporta solo nel ⋯ con un solo stato; "Sottolineato" resta nella scheda e in Info; voci disattivate con il motivo nel tooltip; fuoco sulla prima voce attiva. File: `views/reader/ReaderBar.tsx`, `ReaderMenu.tsx` |
| Z9 | importante | Tabella di confronto | `fit-021`, `fit-023` | Si apre a tutta finestra **senza** barra laterale né barra in alto: unica vista che toglie il guscio (contro §1 principio 6); "Chiudi" come testo; tabella con 2 righe e 500 px bianchi sotto | Montarla nell'area del contenuto come vista (briciole "Libreria › Tabella di confronto", guscio visibile), altezza al contenuto, "Chiudi" come icona ✕ nell'intestazione. File: `views/compare/CompareView.tsx`, `views/compare/*.css`, `views/library/SelectionBar.tsx` (punto di montaggio) |
| Z10 | importante | Esporta (dalla selezione e dal progetto) | `fit-025`, `fit-071`; `count-export-dialog` = 22 | Titolo "Esporta come secondo cervello" anche se la scelta "Cosa esportare" porta a BibTeX/RIS/CSL JSON; "Cosa esportare" due volte (etichetta della scelta e titolo di sezione in maiuscolo); 22 controlli in un dialogo che scorre dentro sé stesso con la barra nativa | Titolo "Esporta…"; il formato come `Segmented` in cima (Secondo cervello · BibTeX · RIS · CSL JSON) e sotto solo le opzioni di quel formato; sezione "Quali documenti"; destinazione subito dopo; opzioni avanzate in un `Fold` chiuso; titoli senza maiuscolo. File: `views/export/*.tsx`, `views/export/*.css` |
| Z11 | importante | Impostazioni › Claude | `fit-079`, `fit-075` | Il tetto dei token occupa 7 controlli per **una** impostazione (campo con il segnaposto tagliato "Nessun tetto", 5 preset come link, "Nessun tetto" ripetuto); la scelta "Usa" (Automatico · Accesso di Claude Code · Chiave API) esce di ~16 px dal riquadro (W2 tornato); "0,00 USD" accanto a "0,001 $" | Un `SelectField` (Nessun tetto · 100 K · 250 K · 500 K · 1 Mln · 2 Mln · Personalizzato…) che mostra il campo solo per "Personalizzato"; `Segmented` con `min-width: 0` e a capo sotto i 560 px; un solo formato di valuta (`Intl.NumberFormat`, `currency: 'USD'`). File: `settings/TokenCapRow.tsx`, `settings/AccountCard.tsx`, `settings/settings.css` |
| Z12 | importante | Scopri › Nuova ricerca ▾ | `fit-058` | Ogni voce è preceduta da un'intestazione in maiuscolo che ripete il nome e la descrizione ("DA UNA DOMANDA: CERCA IN LIBRERIA…" poi "Da una domanda…"): 6 righe gridate per 3 scelte. §17.3: "il nome con una frase sotto" | Voci a due righe: nome in `--fs-body` 600, frase in `--text-muted` `--fs-small`, senza intestazioni di gruppo. File: `views/discover/DiscoverView.tsx`, `discover.css` |
| Z13 | importante | Progetto › Diagramma PRISMA | `fit-069` | Le caselle della colonna destra escono dal riquadro e tagliano il testo ("…con i motivi (n = " tagliato, "Record rimossi prima della selezione" oltre il bordo); "Record identificati da (n = 0)" senza la fonte | Larghezza delle caselle calcolata dal testo con a capo (`<tspan>`), colonna destra dentro la `viewBox`; fonte di ripiego ("da OpenAlex e dalla libreria"). File: `views/projects/PrismaDialog.tsx`, `prismaModel.ts`, `prisma.css` |
| Z14 | importante | Libreria | `fit-010`, `fit-083` | Una casella di selezione **sempre visibile** su ogni riga (220 caselle): nel P0 non c'è, la selezione si fa col clic; con il pannello Claude aperto la riga dei filtri si taglia ("Tag" a metà, "Risorse" sparita) | Casella solo su riga al passaggio, a fuoco o quando c'è già una selezione; riga dei filtri che, stretta, raccoglie gli ultimi facet in "+2 ▾" invece di tagliarli. File: `views/library/DocViews.tsx`, `FacetBar.tsx`, `library.css` |
| Z15 | importante | Pannello Claude | `fit-083`; `count-chat-panel` = 7 | Ancora com'era in giro 5 (W/I5): due pulsanti contornati "Nuova conversazione" e "Conversazioni" in cima, Modello e Ragionamento come `<select>` nativi in fondo ("Ragionamento: ba" tagliato), "Questo mese: $0.00" in formato americano, intestazione "Invio a Claude: 7 cartelle a…" tagliata | Come §1.1: chip Modello e Ragionamento (lo stesso `ChoiceChip` di Da rivedere) accanto a Invia; Nuova e Conversazioni nel ⋯ del pannello; spesa con `Intl`; intestazione su due righe o tooltip. File: `views/chat/ChatPanel.tsx`, `views/chat/chat.css` |
| Z16 | minore | Procedura guidata | `fit-001`, `fit-007`, `fit-008` | Passo 1 con "Indietro" disattivato; Riepilogo con il percorso completo in monospazio e la stessa frase sull'evidenziazione detta due volte; passo 7 con i pulsanti nel corpo e un piede vuoto sotto; "Continua in background"; "Elenco dei file 180 file" mentre le impronte sono 180/220 | Niente Indietro al passo 1; percorso abbreviato; togliere la frase ripetuta; pulsanti nel piede; "Continua in sottofondo"; conteggio coerente. File: `wizard/*` |
| Z17 | minore | Libreria, griglia e liste | `fit-010`, `fit-014`, `fit-093` | Freccina dei facet attaccata al testo ("Stato⌄"); nelle schede della griglia il titolo è centrato se sta su una riga e a sinistra se ne prende due; barre di scorrimento native con le frecce; a 1920 le righe sono larghe 1300 px (titolo lontano dallo stato) | `gap: 4px` nel chip; titolo sempre a sinistra; barra sottile coi token; `max-width` della lista ~1100 px centrata. File: `views/library/FacetBar.tsx`, `DocViews.tsx`, `library.css` |
| Z18 | minore | Selezione › ✦ Claude | `fit-018` | 5 voci (§17.3: 4, con "Chiedi a Claude…" in più) e "Panoramica dei gruppi di ricerc…" tagliata | Menu largo 260 px; aggiornare §17.3 se "Chiedi a Claude…" resta. File: `views/library/SelectionBar.tsx` |
| Z19 | minore | Dialoghi di invio a Claude | `fit-020`, `fit-022` | "≈ 1.5k token · ≈ <$0.01" non in italiano; "Annulla" a sinistra del piede (§1.1: a destra, prima del primario); il titolo "Inviare a Claude?" non dice per quale funzione | `Intl` per numeri e valuta; Annulla accanto al primario; titolo "Note di letteratura: inviare a Claude?" ecc. File: `components/AiCostPreview.tsx` (T3) |
| Z20 | minore | Scheda del documento | `fit-026` | La scheda galleggia **sopra** l'elenco e copre la colonna dello stato; badge "impostato a mano" accanto a "Sottolineato" non spuntato; sezioni "Note sul file" e "Risorse collegate" (§17.3: "Note", "File e risorse") | Pannello che restringe l'elenco (come il P0) sopra 1180 px; badge dell'origine solo se il valore è vero; nomi di §17.3. File: `views/library/DocPanel.tsx`, `LibraryView.tsx`, `library.css` |
| Z21 | minore | Da rivedere | `fit-040`, `fit-041` | Proposte: filtro come `<select>` nativo a tutta larghezza; "1 file nuovo" resta nell'intestazione anche nella scheda Proposte; ogni riga dei nuovi file ha "Conferma" pieno più il primario della vista (con 10 file, 11 pulsanti pieni) | Filtro come chip; conteggio della scheda attiva; "Conferma" della riga secondario. File: `views/review/*`, `views/inbox/InboxCard.tsx`, `inbox.css` |
| Z22 | minore | Progetto | `fit-063`, `fit-065`, `fit-068`, `fit-064` | "Attivo ▾" e la parola "Progetto" ridondanti; Piano vuoto: suggerimento di trascinamento più cinque link sottolineati "Aggiungi: …"; domande dello Schema in maiuscolo; "popover dell'evidenziazione" (gergo) nel suggerimento; il ⋯ ha "Diagramma PRISMA…" e non "Tabella di confronto…" | Togliere "Progetto"; Piano vuoto con un solo pulsante e l'elenco come righe con "+"; domande in tondo; "nel lettore: clic su un'evidenziazione › Usa come prova"; aggiornare §17.3 (PRISMA al posto della Tabella, che resta nella barra di selezione). File: `views/projects/ProjectDetailView.tsx`, `ReadingPlanPanel.tsx`, `SchemaTab.tsx`, `projects.css` |
| Z23 | minore | Lettore, pannello; ricerca | `fit-034`, `fit-082` | Un ⋯ isolato in cima al pannello Annotazioni; al fuoco il campo di ricerca apre un menu vuoto (una striscia sotto il campo) | ⋯ accanto al titolo della scheda; il menu si apre solo se ha righe (Riprendi, recenti). File: `views/reader/AnnotationParts.tsx` (T3); `shell/TopSearch.tsx` (T1) |
| Z24 | minore | Mappa › reti per entità | `fit-047` | Cursori nativi blu (non `--accent`); 3 nodi su 7 senza etichetta; le icone a destra vanno a capo in modo diverso per ogni rete | `accent-color: var(--accent)`; etichette per tutti sotto i 30 nodi; stessa riga per tutte le reti (con Z2). File: `views/network/EntityNet.tsx`, `network.css` |

Non verificato (passi del giro falliti, da riprovare col giro corretto): il popover dell'annotazione (il clic su Seleziona non è passato), le sezioni aperte della scheda, la tabella di confronto riempita (il pulsante di conferma ha un selettore diverso), il ponte sulla Mappa fino al risultato (il secondo clic non ha preso un nodo), la ricerca "Trova un ponte" di Scopri (il menu della ricerca copriva la riga) e le schede di Scopri (non sono `role=tab`). Inglese: solo il controllo statico delle chiavi.

### F.2 Affollamento: conteggi contro §17.3 (1280×800, controlli visibili)

| Zona | P0 | §17.3 | Misurato | Esito |
| --- | --- | --- | --- | --- |
| Barra laterale | 5 + 3 | 5 + 3 | 10 = [≡] + selettore + 5 + 3 | in regola |
| Barra in alto | 9 | 9 | 9 (‹ › ricerca ? ✦ ↶ 🕘 Comandi Attività) | in regola (Ripeti tolto: W11 chiuso) |
| Libreria · intestazione | 4 | 4 (pulsante diviso) | 6 (Cartelle e tag, Vista, Aggiungi, ▾, ⋯, ◫) | +1 (il pulsante delle cartelle); accettabile |
| Libreria · filtri | 8 | 8 | 8 | in regola; Z14 a 1280 col pannello |
| Libreria · selezione | 5 | 5 | 5, una riga | in regola |
| Libreria · riga attiva | 3 | 3 | 3 (+ la casella sempre visibile, Z14) | in regola |
| Scheda | 3 + 5 | 3 + 5 | 3 + 5 | in regola |
| Lettore · barra | 22 | 13 | **13** | in regola (era 17) |
| Menu: ⋯ selezione / ⋯ lettore / ⋯ progetto / + Aggiungi | — | 7 / 6 / 7 / 4 | 7 / 6 / 7 / 4 | in regola |
| Menu: ✦ Claude / Studio ▾ / ⋯ Mappa / Nuova ricerca ▾ | — | 4 / 5 / 4 / 3 | 5 / **8** / 2 / 3 (+3 intestazioni) | Studio oltre il tetto (Z8); Mappa con le voci fuori posto (Z4); Z12 |
| Da rivedere · intestazione | invariata | invariata | 3 (Modello, Ragionamento, + Aggiungi PDF) | in regola |
| Scopri · intestazione e schede | 2 + 4 | 2 + 4 | 2 + 3 (+ Filtri) | in regola ("Ricerche" compare dopo la prima ricerca) |
| Progetto · intestazione e schede | 2 + 3 | 2 + 3 / 2 + 4 | 3 (Stato, primario, ⋯) + 3, poi + 4 | in regola |
| Mappa · Panorama | ~12 | invariata | **16** | troppi (Z4) |
| Mappa · Collegamenti | ~12 | invariata | **31** (22 nelle reti per entità) | **troppi** (Z2, bloccante) |
| Pannello Claude | — | invariato (Invia, 2 chip, ⋯) | 7 | +2 (Z15) |
| Impostazioni | 7 sezioni | 7 | 7 + ricerca; Claude 15 (scheda Account 8 + tetto 7) | tetto dei token da semplificare (Z11) |
| Esporta (dialogo) | — | — | 22 | troppi per un dialogo (Z10) |
| Tabella di confronto | — | — | 15 con 5 colonne | in regola come contenuto; Z9 è la cornice |

### F.3 Cosa è chiaramente meglio di prima

- **Lettore:** barra unica di 13 controlli come il P0 (`fit-029`), barra laterale compressa a 56 px, niente barra in alto, popover dei menu ordinati; la lettura affiancata c'è e si capisce quale riquadro è attivo.
- **Libreria:** intestazione, riga dei filtri, barra di selezione su una riga al posto dei filtri, riga attiva "Leggi/Apri · Scheda · ⋯" e menu entro il tetto, tutti come il P0 e §17.3 (`fit-017`, `fit-019`). Il menu "+ Aggiungi ▾" è pulito (`fit-011`).
- **Barra in alto:** 9 controlli; con il pannello Claude aperto si compatta (ricerca a icona, Comandi a icona) senza finire sotto il pannello (W1 chiuso, `fit-083`); tavolozza a tutta larghezza con "Riprendi la lettura" e gruppi (W7 chiuso, `fit-081`); popover Attività chiaro con l'ultima scansione e un solo primario (`fit-080`).
- **Da rivedere:** un hub con due schede contate e i chip Modello e Ragionamento in testa, come chiedeva §17.3 (`fit-040`).
- **Scheda del documento:** tre azioni, stato come `Segmented`, sezioni chiuse; nessun modulo aperto (`fit-026`).
- **Progetti:** intestazione con stato, primario e ⋯; quarta scheda Schema solo dopo il primo uso; PRISMA leggibile a colpo d'occhio a parte Z13 (`fit-063`, `fit-068`, `fit-069`).
- **Mappa:** la rete degli argomenti (`fit-047`) e il cartellino del nodo (`fit-052`) hanno già la leggerezza del P0: sono il modello per sistemare il resto della vista.
- **Tema scuro e contrasto:** coerente in tutte le viste (`fit-084…092`, `fit-102…110`), nessun testo sotto AA (minimo 6,2), nessun errore in console tranne uno di Playwright.

### F.4 Correzioni, in ordine, in 3 compiti con file disgiunti

Ordine: 1 Z1 · 2 Z2 · 3 Z3 + Z4 + Z5 · 4 Z6 · 5 Z7 · 6 Z9 · 7 Z10 · 8 Z11 · 9 Z8 · 10 Z12 · 11 Z13 · 12 Z14 · 13 Z15 · poi i minori.

1. **T1 · Testi, guscio, impostazioni, Claude, procedura** — `i18n/locales/**` e `i18n/usedKeys.test.ts` (nuovo), `shell/**`, `settings/**`, `views/chat/**`, `wizard/**`. Corregge Z1 (parte dei testi), Z6, Z11, Z15, Z16, Z23 (menu di ricerca vuoto). Va per primo: Z1 è bloccante e piccolo.
2. **T2 · Mappa** — solo `views/network/**`. Corregge Z2, Z3, Z4, Z5, Z24. Disegno con la coppia Opus prima dell'implementazione (Z2 e Z3 cambiano la composizione della vista); prova: `count-map-network` ≤ 12 e `count-map-head` ≤ 12 nel giro "final".
3. **T3 · Viste** — `views/reader/**`, `views/library/**`, `views/compare/**`, `views/export/**`, `views/discover/**`, `views/projects/**`, `views/review/**`, `views/inbox/**`, `components/AiCostPreview.tsx`. Corregge Z1 (plurali di `CompareView.tsx`), Z7, Z8, Z9, Z10, Z12, Z13, Z14, Z17-Z22, Z23 (⋯ del pannello Annotazioni).

T1 e T3 si toccano solo se T3 cambia testi: i testi nuovi di T3 vanno nelle **parti** della sua vista (`locales/parts/*/<vista>.json`) solo dopo che T1 è unito, oppure T3 consegna l'elenco delle chiavi e T1 le scrive. Dopo le correzioni: rieseguire il giro "final" (una sola esecuzione, `RL_DESIGN_AUDIT_OUT=run9`) e il controllo delle chiavi.

## Audit §18 (dati reali)

Oggetto: ramo `audit49` (= `main` a 64e5479), app compilata, guidata con uno script Playwright `_electron` fuori dal repository, rete tagliata, nessuna chiamata all'AI. Dati: **copia** temporanea di una cartella reale di 21 PDF insieme alla copia della cartella dati della libreria che la contiene (tassonomia e tag veri dell'utente, importati a suo tempo da un vecchio indice); originali mai toccati, copia e dati temporanei cancellati alla fine. Qui solo numeri aggregati e osservazioni anonime: nessun titolo, nome, tag o percorso.

**Verdetto.** Funziona e a questa scala non diventa troppo complesso: Automatica separa bene, Trova collegamenti è misurato, la matrice si legge. Il punto debole era il colore per Topic su una tassonomia reale quasi piatta (centinaia di tag radice tipo parola chiave accanto a poche macro-aree vere): **206 macro-aree**, "Altre 199 aree", tinte date a parole chiave a caso. Corretto (D-490): ora 20 aree e le 7 tinte vanno alle macro-aree vere. Restano i colori spenti (quasi ogni lavoro sta in 2-3 aree: è vero, ma il colore dice poco) e la scarsità di famiglie: senza livelli né gruppi la libreria offre solo Topic, due famiglie da suggerimento di gruppo e Automatica.

### Numeri

| Misura | Valore |
| --- | --- |
| Documenti | 21 (17 con tag, 4 aggiunti dopo l'ultima etichettatura e senza tag) |
| Tassonomia | 220 nodi, nessun livello (`level`), 23 nodi con un genitore; suggerimenti di gruppo: 11 "macro", 23 "micro", 186 "extra:…" |
| Tag diretti per documento | 3-80 (mediana 26); 210 tag distinti usati, circa la metà su un solo documento |
| Copertura per gruppo di tag | macro 17/17 (2-3 per lavoro) · micro 17/17 (1-6) · extra principale 10/17 (22-70 per lavoro, tipo parole chiave) · extra secondario 5/17 (1) |
| Famiglie offerte | Topic (17 doc) · 2 da suggerimento di gruppo (10 e 5 doc) · Automatica; **niente** Metodologia (nessun nodo `method`) né Gruppo (nessuna istituzione: rete spenta, DOI su 7/17) |
| Topic prima / dopo D-490 | 206 / 20 aree; quota dell'area principale 34-64 % / 34-78 %; 4 nodi senza area (i 4 senza tag) |
| Famiglia "extra" principale | 7 cluster + altro, 9 lavori su 10 in più cluster, quota principale 34 % (tutti tenui) |
| Automatica | 3 comunità (9 · 7 · 5) su tutti i 21 lavori (anche i 4 senza tag), nessuna in "altro"; nomi dai tag lunghi 38-63 caratteri |
| Archi "simili" (Collegamenti) | 270 (135 coppie su 210 possibili), grado 3-17, peso p10 0,04 · mediana 0,06 · p90 0,17 · max 0,32 |
| Trova collegamenti, 5 partenze × 3 soglie | τ normale 0,15 (pavimento: la mediana dei vicini è 0,06), rigorosa 0,25, ampia 0,10; sopra la soglia per partenza: rigorosa 0-3, normale 2-4, ampia 2-6; mai metà libreria, mai zero a soglia normale; motivi sempre "termini + tag" (+ autori in 2 casi) |
| Matrice | 25 sezioni × 21 paper, 51 assegnazioni; 3 buchi e 2 fonti non usate visibili a colpo d'occhio a 1024 × 700 |

### Risultati

| Id | Gravità | Dove | Cosa non va | Esito |
| --- | --- | --- | --- | --- |
| R1 | **bloccante** | Mappa, Topic (Panorama e Collegamenti) | Le radici senza figli (parole chiave) diventano macro-aree: 206 aree, le 7 tinte a parole chiave scelte per numero di documenti, il resto grigio | **corretto** (D-490): con una gerarchia (≥ 2 radici con figli) una radice senza figli è un tag sciolto e colora solo i lavori che non raggiungono un'area vera |
| R2 | importante | Collegamenti | Legenda delle aree e riquadro "N nodi · documento · cartella · tag" sovrapposti in basso a sinistra (la riga "pieno/tenue" coperta) | **corretto**: una colonna sola (`.net-bl`) |
| R3 | importante | Trova collegamenti | Il dialogo (520 px) è più stretto del suo contenuto (560 px; titoli lunghi senza `minmax(0, 1fr)`): Partenza, pesi e motivi tagliati, barra orizzontale | **corretto**: dialogo a 640 px, righe che si accorciano |
| R4 | importante | Trova collegamenti | Ripetendo una ricerca compare "Nessun collegamento sopra la soglia" anche se 4 sono sopra ma già collegati | **corretto**: "Nessun collegamento nuovo: quelli sopra la soglia ci sono già (N)" |
| R5 | importante | Matrice | Con autori scritti "Cognome I." la colonna diceva "R. 2026" (l'iniziale presa per cognome): 8 colonne su 14 | **corretto**: l'iniziale si salta (test unitario) |
| R6 | minore | Panorama | "Raggruppato per X" incollato all'angolo del riquadro, dove sta anche la pillola del suggerimento | **corretto**: pillola in alto a destra |
| R7 | minore | Matrice | "⚠Sezione" senza spazio (lo spazio finale si perde nella riga flessibile) | **corretto** |
| R8 | minore | Collegamenti | Dopo R1 i tag sciolti senza area venivano disegnati col colore del testo (rombi neri pesanti) | **corretto**: grigio tenue |
| R9 | importante | Collegamenti | Espandere un lavoro con 26-80 tag aggiunge fino a 50 rombi (`rec.tags.slice(0, limit)`, in ordine di inserimento): una stella di tag a una sola foglia, non una rete | aperto: prima i tag condivisi da ≥ 2 lavori e i più specifici, tetto ~10 con "+N tag" |
| R10 | importante | Panorama | La legenda (240 px, alta fino a 400) copre i punti in basso a sinistra; l'inquadratura non ne tiene conto | aperto: margine sinistro dell'inquadratura pari alla legenda, o legenda richiudibile |
| R11 | importante | Topic | Colori spenti: 13 lavori su 17 hanno 3 aree; una macro-area copre il 76 % (sotto la soglia di discesa dell'80 %) | aperto: opzione "colore dell'area principale" (senza mescolanza) o soglia di discesa al 60-70 %, da provare su più librerie |
| R12 | minore | Automatica | Le etichette sulla tela (termini dei cluster della mappa) e i nomi in legenda (tag della comunità) sono due nomi diversi per gli stessi gruppi; la striscia "pieno/tenue" non serve (ogni lavoro è al 100 % in una comunità) | aperto |
| R13 | minore | Esporta | Stessa regola "ultima parola = cognome" in `familyName` delle chiavi di citazione (`packages/export/src/citekeys.ts`) | aperto: cambia chiavi già esportate, da decidere |
| R14 | minore | Daltonismo | Simulazione Machado: in deuteranopia e protanopia la terza tinta (magenta) diventa grigia, vicina ad "altro"; si distingue per luminosità, ma con "altro" presente conviene la legenda. Tritanopia non ottimizzata (già nota) | nota |
| R15 | — | Tema scuro | Panorama, Collegamenti e matrice leggibili, nodi ben contrastati | va bene |

### Più tag? Famiglie consigliate

Il problema non è il numero dei tag (già tanti, fino a 80 per lavoro) ma la loro forma: due livelli utili (11 macro-aree, 23 sottotemi) e una lunga coda di parole chiave su uno o due lavori, che per la Mappa sono rumore (servono alla ricerca). Mancano famiglie **ortogonali** con un solo valore per lavoro, quelle che danno cluster netti e colori pieni. Per una libreria di questo tipo (lavori di ricerca su metodi e sistemi):

1. **Metodologia** (`level: method`): 4-8 valori, uno per lavoro (per esempio simulazione numerica, metodo analitico, apprendimento automatico, analisi di dati sperimentali).
2. **Sistema o modello studiato**: la classe di sistemi (5-8 valori).
3. **Tecnica**: lo strumento principale (rete neurale, rete tensoriale, Monte Carlo, …).
4. **Tipo di dati**: simulati, sperimentali, teorici, misure campionate.
5. **Tipo di lavoro**: articolo di metodo, applicazione, rassegna, tesi, appunti.

Regola pratica: ogni famiglia con 3-8 valori e un valore per lavoro su almeno l'80 % dei lavori; mettere i tag anche ai 4 lavori nuovi. Automatica trova già 3 comunità coerenti che coprono anche i lavori senza tag: è il punto di partenza per nominarle ("Dai un nome con Claude", non provato qui sui dati veri) e poi trasformarle in una famiglia.

**Proposte economiche nell'app** (nessuna costruita):
- **Famiglia da un nodo**: nella gestione dei tag, "Usa i figli come famiglia" su un nodo radice. Oggi `level` non si imposta da nessuna parte dell'interfaccia e il suggerimento di gruppo solo alla creazione: Metodologia si raggiunge solo importando una tassonomia.
- **Offrire come famiglia anche i suggerimenti di gruppo diversi da `extra:`** (qui "micro": 23 sottotemi su 17/17 lavori).
- **"✦ Proponi i tag di una famiglia…"**: il percorso delle proposte di tag dell'AI con un vincolo (una famiglia, 3-8 valori, uno per lavoro), con anteprima e accettazione come oggi.
- **Da Automatica a famiglia**: "Salva questi cluster come famiglia" (crea i nodi e mette i tag, annullabile).
- In Collegamenti, tag ordinati per utilità e con tetto (R9). In Trova collegamenti i tag radice restano esclusi dal segnale dei tag: giusto per le parole chiave radice di questa libreria, da rivedere se le famiglie nuove saranno radici senza figli.

## Diagnosi rete e libreria (post 1.0)

Oggetto: `main` a `v1.0.0` (ramo `diag2`), app compilata guidata con uno script Playwright `_electron` fuori dal repository (finestra nascosta, fotogrammi guidati da un timer perché la finestra nascosta non ne produce), rete tagliata, nessuna chiamata all'AI. Dati: **copia** temporanea di una cartella reale di 21 PDF con la copia della cartella dati della libreria (tag, tassonomia e documenti veri; 25 documenti nel modello, 4 fuori dalla cartella). Schermate della Mappa (Panorama, Collegamenti in tutti i modi, Esplora) per ogni famiglia di "Raggruppa per", a 1280×800 e 1920×1080, chiaro e scuro; griglia della libreria e multi-selezione. Misure prese dalla rete viva (nodi e archi letti dall'oggetto della simulazione, etichette registrate da `fillText` nell'ultimo fotogramma, riquadri sovrapposti alla tela). Qui solo numeri aggregati e schemi generici: nessun titolo, nome, tag o percorso. Copie, schermate e dati temporanei cancellati alla fine.

**Verdetto.** L'utente ha ragione su tutti e quattro i punti, e le cause sono strutturali, non di rifinitura: (1) "Rete di: Tag" disegna 364 archi fra 84 tag con 11 incroci per arco, perché lega tag che co-occorrono anche su **un solo** lavoro e perché il vocabolario è pieno di doppioni e di parole chiave che viaggiano in blocco; (2) "Raggruppa per" non produce gruppi visibili (le famiglie offerte non sono a un valore per lavoro e la forza di gruppo è debole) e la Mappa mescola lavori con nodi di altro tipo (tag, cartelle); (3) la scheda della griglia ha la forma sbagliata e una regola CSS tardiva la centra: la miniatura è un francobollo e **il titolo è tagliato ai due lati in 20 schede su 25**; (4) la multi-selezione mostra l'**unione** dei tag (87 righe per 5 lavori, nessuna comune a tutti), non quello che i lavori hanno in comune.

### Numeri

| Misura | Valore |
| --- | --- |
| Documenti | 25 nel modello (21 PDF della cartella + 4 altri), 5 senza tag |
| Tag | 220 nella tassonomia, 214 usati; per lavoro 0-80 (mediana 5); 126 su un solo lavoro (59 %) |
| Famiglie offerte da "Raggruppa per" | Topic (20 lavori, **22 aree**), 2 famiglie da suggerimento di gruppo (10 e 5 lavori), Automatica (25 lavori, 4 cluster) |
| Quota dell'area principale per lavoro | Topic: mediana 50 %, 19/20 lavori in più aree · famiglia 1: **34 %**, 9/10 in più cluster · famiglia 2: un solo cluster · Automatica: 100 %, 0 in più cluster |
| Panorama | 25 punti, 4 cluster di posizione (10 · 8 · 4 · 3); inviluppi = 25 % del riquadro dei punti; distanza dal vicino mediana 11 % dell'estensione; **0 etichette di lavoro**, 4 etichette di cluster (terne di termini) |
| Rete di: Documenti (avvio) | 18 nodi (17 lavori + 1 cartella), 20 archi (16 simili, 3 citazioni, 1 contiene); a 1280 2 nodi fuori tela; titoli tagliati a 32 caratteri (mediana dei titoli 57) |
| Un'espansione di un lavoro (25 lavori, tipi predefiniti, limite 25) | aggiunge mediana 21 nodi: 14 archi "simili" (peso mediano **0,063**, p10 0,036), 0-8 citazioni, 0-8 rombi di tag, 1 cartella; fino a 72 tag nascosti dietro "+N" |
| Dopo la seconda espansione | 28 nodi di **3 tipi** (19 lavori, 8 tag, 1 cartella), 53 archi di **4 tipi** (33 simili, 10 citazioni, 8 tag, 2 contiene); riquadri sopra la tela 31-41 %, **11-14 nodi coperti** |
| Rete di: Tag (predefinito, almeno 2 lavori) | 84 nodi, 364 archi (+4 "implica"), densità 0,10, grado mediano 9 (max 19); **11 incroci per arco**; 24 etichette su 84 nodi (29 %) a 1280, 33 a 1920; 84 archi poggiano su **un solo lavoro in comune**, 47 hanno peso 1 |
| Rete di: Tag con "almeno 1 lavoro" | 210 nodi, 778 archi, componente gigante di 145 nodi |
| Rete di: Argomenti | 3 nodi e 3 archi (l'intestazione dice 4 argomenti) |
| Rete di: Autori | 15 nodi, 42 archi (densità 0,40), 33 archi su un solo lavoro in comune |
| Riquadri sopra la tela (legenda, conteggio, minimappa) | 1280: 16-20 % della tela · 1920: 3-9 % |
| Griglia della libreria | 1280: 2 colonne di schede 344×184 (rapporto 1,87, orizzontale) · 1920: 5 colonne 261×184 (1,42); miniatura **54×76 px** = 6-9 % della scheda; bitmap 287×407 mostrata al 19 % del suo lato |
| Titoli nelle schede | 14 px/650, 2 righe; **tagliati a sinistra e a destra** in 7/9 schede misurate a 1280 e 20/25 a 1920; contenuto più largo della scheda di 119-383 px |
| Multi-selezione (pannello) | 2 lavori: 8 righe di tag · 5 lavori: **87 righe**, 0 comuni a tutti, pannello alto 3064 px (quasi 4 schermate) |

### Qualità dei tag (richiesta dell'utente)

| Misura | Valore |
| --- | --- |
| Totale | 220 nodi (214 usati, 6 mai usati); per lavoro min 0 · mediana 5 · max 80; 5 lavori senza tag |
| Singoletti | 126 tag su un solo lavoro (59 %), 13 su due; 1 solo tag su metà dei lavori o più |
| Per gruppo di suggerimento | macro: 7 usati, 2-3 per lavoro, nessun singoletto · micro: 21 usati, mediana 2 per lavoro, 7 singoletti · **parole chiave ("extra")**: 186 tag (87 %), 119 singoletti, fino a 71 su un lavoro, 422 assegnazioni su 521 (81 %) |
| Gerarchia | profondità massima **1**; 23 tag con un genitore, **18 con più genitori**; 197 radici, solo 8 con figli; 7 con "implica", 33 con alias; nessun `level` né colore |
| Stile dei nomi | 147 in `parola_parola`, 39 in minuscolo con spazi, 26 con iniziale maiuscola, 8 "Nome (SIGLA)": quattro convenzioni insieme |
| Provenienza | tutti i 220 nodi importati dal vecchio indice; 20 lavori con registro "fonte: contenuto, confidenza alta, origine sconosciuta"; **nessuna distinzione conservata fra tag dell'AI e tag messi a mano**, nessun tag messo a mano nell'app; parole chiave AI dell'app su 15 lavori (campo separato, non tag) |
| Quasi-doppioni (rilevatore a regole, rivisti a mano) | 56 coppie candidate su 78 tag: 4 di maiuscole, separatore o plurale (es. `concetto` ↔ `concetti`, `2x` ↔ `2-x`) tutte vere; 14 sigla ↔ forma estesa (es. `ABC` ↔ `alfa_beta_gamma`), 12 vere; 4 "refusi" (1 vero: grafia britannica e americana); 34 di inclusione (es. `X` ↔ `X_metodi`, `Y` ↔ `Y_di_Z`): ~10 sinonimi, ~24 coppie più generale/più specifico **senza** legame di genitore |
| Concetti duplicati | circa **16 concetti scritti in 2-5 forme** (il peggiore: 5 tag per una sola sigla, fra sigla, plurale, forma estesa e due grafie), cioè ~24 tag ridondanti; 2 concetti sono metadati (rivista, stato di preprint) usati come tag, ciascuno in 2-3 forme |
| Sempre insieme | 13 gruppi, **66 tag** con esattamente gli stessi lavori (≥ 2), il più grande di 11: sono blocchi di parole chiave copiati sugli stessi lavori |
| Taglio dei 30 tag | 8 lavori hanno più di 30 tag: per le coppie la rete tiene i primi 30 **in ordine di id**, cioè a caso |

**Quanto pesa ciascun difetto sul gomitolo** (rete dei tag rifatta fuori dall'app con le stesse regole: 88 nodi e 369 archi contro 84 e 364 dell'app; 1170 coppie prima del tetto di 8 archi per nodo):

| Intervento sulla rete di oggi (88 nodi, 369 archi) | Nodi | Archi | Note |
| --- | --- | --- | --- |
| Archi che toccano una parola chiave "extra" | — | **333 (90 %)** | il grosso del gomitolo |
| Togliere le parole chiave, tenere macro e micro | 21 | 73 | densità 0,35: piccola e leggibile |
| Unire quasi-doppioni e tag sempre insieme | 39 | 189 | −49 % di archi, peso 1 da 50 a 1 |
| Archi su un solo lavoro in comune | — | 85 (23 %) | rumore puro con 25 lavori |
| Archi di peso 1 (tag gemelli) | — | 50 (14 %) | spariscono unendo i gemelli |
| Togliere il tag su metà dei lavori | 87 | 379 | non aiuta: il problema non sono gli hub |
| Soglia "almeno 3 lavori" | 75 | 400 | non aiuta: il tetto per nodo riempie di nuovo |

### Risultati

| Id | Gravità | Dove | Problema | Causa | Evidenza |
| --- | --- | --- | --- | --- | --- |
| N1 | **bloccante** | Collegamenti, Rete di: Tag | Gomitolo: non si capisce nulla, tutto collegato | `tagNetwork` (`packages/graph/src/entity-network.ts`) lega ogni coppia di tag sullo stesso lavoro con il coseno degli insiemi di lavori: con 25 lavori un solo lavoro in comune basta (peso fino a 1); `topEdges` tiene 8 archi per nodo "se uno dei due capi lo vuole" (grado misurato fino a 19); `minWeight` 0; tetto di 30 tag per lavoro in ordine di id; nessuna distinzione fra macro, micro e parole chiave | 84 nodi, 364 archi, 11 incroci per arco, 90 % degli archi su parole chiave, 23 % su un solo lavoro |
| N2 | **bloccante** | Mappa, tutte le viste | Con "Raggruppa per" l'utente vuole vedere **lavori** raggruppati, non nodi di famiglie o di tag | La famiglia cambia solo colore e una debole attrazione (`GROUP_PULL` 0,012, `CLUSTER_PULL` pesata dalle quote); in Collegamenti la rete mescola lavori, rombi di tag e quadrati di cartella; "Rete di: Tag/Argomenti" mostra solo nodi di entità | Rete dei documenti dopo due espansioni: 3 tipi di nodo, 4 tipi di arco; raggruppata per famiglia 1 la rete si stringe (riquadro dal 64 al 24 % della tela) ma non si separa: un solo grumo grigio |
| N3 | **bloccante** | "Raggruppa per" | Famiglie che non raggruppano | `listFamilies` offre ogni suggerimento di gruppo `extra:` e "Topic" senza controllare che siano a un valore per lavoro: la famiglia 1 ha 8 cluster su 10 lavori con quota principale 34 % (tutti "altro"/tenui), la famiglia 2 un cluster solo, Topic 22 aree per 20 lavori | Solo Automatica (4 cluster, 100 % a un cluster, coincide con le posizioni) dà gruppi netti |
| N4 | importante | Panorama | I lavori sono punti anonimi; colori e posizioni dicono cose diverse | Nessuna etichetta di lavoro a nessuno zoom iniziale; la posizione viene dai cluster di testo (4), il colore dalle macro-aree (22, legenda "Altre 15 aree"); con una famiglia attiva i cluster prendono il nome dell'area maggioritaria, spesso "altro" | 0 titoli visibili; a 1920 la vista non si reinquadra dopo il ridimensionamento (punti in circa un decimo della tela) |
| N5 | importante | Collegamenti, Documenti | La rete dei lavori è una stella di archi deboli | Gli archi "simili" non hanno soglia: si disegnano i 25 vicini più vicini qualunque sia il peso (mediana 0,063); citazioni, link, tag e cartella sono tutti accesi di serie (`DEFAULT_KINDS`) | 14 archi simili per espansione, 4 tipi di arco dopo due espansioni |
| N6 | importante | Tutta la Mappa a 1280 | Riquadri sopra la tela | Legenda (240 px, alta fino a 400), conteggio, minimappa e note sono assoluti sopra la tela e l'inquadratura non ne tiene conto (R10 ancora aperto) | 16-20 % della tela coperta; 11-14 nodi su 28 sotto un riquadro dopo due espansioni |
| N7 | minore | Rete di: Argomenti | 3 nodi (4 nell'intestazione): vista quasi vuota a questa scala | un solo livello di cluster | — |
| L1 | **bloccante** | Libreria, griglia | Titoli tagliati ai due lati | In `library.css` la regola `.doc { align-items: center }` (riga ~834) viene dopo `.doc-card { align-items: stretch }` (riga ~383) e la vince: la scheda diventa una colonna centrata; `.doc-sub .doc-tags { flex: none; flex-wrap: nowrap }` allarga il contenuto alla riga dei tag, che resta centrato e tagliato da `overflow: hidden` | 20/25 schede a 1920, 7/9 a 1280; contenuto 119-383 px più largo della scheda |
| L2 | **bloccante** | Libreria, griglia | Miniatura "lontana", rimpicciolita | `.doc-thumb { height: 76px }` e `object-fit: contain` in una scheda orizzontale (`ROW_HEIGHT.card` 188, `CARD_MIN_WIDTH` 236): la pagina A4 (1:1,41) entra in 54×76 px; la bitmap è disegnata a 240 px di larghezza CSS (`THUMB_CSS_WIDTH`) e mostrata al 19 % | 6-9 % dell'area della scheda; a 1280 due colonne di schede larghe 344 px con la miniatura al centro e ai lati vuoto |
| L3 | importante | Libreria, griglia | Al passaggio i pulsanti Leggi/Scheda/⋯ coprono la miniatura e lo stato | `.doc-side` assoluto in alto a destra sopra la miniatura | schermata della selezione |
| L4 | importante | Multi-selezione | Mostra le informazioni di ogni lavoro invece di quelle comuni | `BulkTagEditor` elenca l'**unione** dei tag diretti e impliciti, ordinata per conteggio, con "su k di N" e "Togli…" per riga; nessun campo comune (autori, anno, rivista, cartella, stato) | 5 lavori: 87 righe, 0 su tutti, 3064 px |
| T1 | **bloccante** (a monte di N1) | Tag | Vocabolario sporco | import automatico dal vecchio indice di parole chiave per lavoro, senza unificazione né gerarchia; l'app non conserva la provenienza e non segnala doppioni | 59 % singoletti, ~16 concetti in 2-5 forme, 66 tag gemelli, profondità 1, 4 stili di nome |

### Direzione per il ridisegno

**Rete: cosa mostrare di serie.**
1. Una sola vista principale "Lavori": **ogni nodo è un lavoro**, sempre, in tutte le famiglie di "Raggruppa per". Niente nodi di tag, cartella o famiglia nella vista di serie; tag e cartelle diventano filtri o chip del lavoro selezionato. "Rete di: Tag/Argomenti/Autori" esce dalla barra principale (in "Esplora", o come vista avanzata), mai la prima cosa che si vede.
2. **Raggruppare senza nodi di famiglia**: ogni valore della famiglia è un'isola (regione con contorno morbido e nome grande sopra, colore del valore); i lavori si dispongono **dentro** l'isola del valore principale (posizione = famiglia, non solo una spinta), vicini per somiglianza all'interno; isola "senza valore" a parte e più piccola. Un lavoro con più valori sta nell'isola principale con piccoli punti colorati degli altri valori; al passaggio si accendono le altre isole. Disposizione delle isole: impacchettamento di cerchi o griglia proporzionale al numero di lavori, stabile fra le famiglie (le isole si spostano, i lavori volano). Etichetta di ogni lavoro: titolo breve (prime 4-6 parole, ~28 caratteri), visibile per tutti fino a ~40 lavori in vista, poi per i più centrali di ogni isola con la griglia anti-collisione già presente.
3. **Archi nascosti di serie.** Si vedono solo per il lavoro selezionato o al passaggio: i 3-5 vicini più forti, con soglia **relativa alla libreria** (peso ≥ 75° percentile dei pesi della libreria, mai il solo 0,06 di oggi). Un tipo di arco alla volta con un interruttore (Citazioni / Somiglianza / Link miei), citazioni e link prima perché espliciti. Fra isole diverse: un solo arco aggregato fra le isole (spessore = numero di coppie, solo se ≥ 2), mai le singole linee.
4. **Famiglie offerte solo se raggruppano**: una famiglia entra nel menu se almeno il 60-80 % dei lavori ha un valore principale con quota ≥ 60 % e se ha 2-12 valori; altrimenti grigia con il motivo ("quasi ogni lavoro ha molti valori"). Le parole chiave (`extra:`) non sono famiglie. Automatica resta e va proposta come predefinita quando Topic non passa la prova.
5. **Panorama** = la stessa vista "Lavori" senza famiglia (isole = cluster di testo); il colore segue la stessa partizione della posizione, oppure è spento. Reinquadrare a ogni ridimensionamento. Legenda richiudibile e fuori dalla tela (colonna a lato a ≥ 1440, in alto ripiegata a 1280), mai sopra i nodi; la minimappa solo oltre ~150 nodi.

**Se resta una rete dei tag** (vista avanzata): solo tag di famiglie (macro e micro) o con almeno max(2, 10 % dei lavori); arco solo con ≥ 2 lavori in comune e misura che sconta il caso (lift o PMI, non il coseno) sopra soglia; scheletro: albero di copertura massimo più al massimo 2 archi forti per nodo; quasi-doppioni e tag gemelli fusi in un nodo; tetto 30-40 nodi con "+N"; il tetto di 30 tag per lavoro per peso e diffusione, non per id. Stima su questi dati: da 84 nodi e 364 archi a circa 20-40 nodi e 40-80 archi.

**Tag (a monte).** Pulizia assistita nella gestione dei tag: proposte di fusione per maiuscole, separatori, plurali, sigle ↔ forme estese, grafie e tag sempre insieme (con anteprima e annullamento; alias al tag tenuto); proposta di genitore per le coppie generale/specifico; un solo stile di nome; segnare la provenienza (AI, mano, import) e mostrarla; i metadati (rivista, stato) non come tag. Le parole chiave restano per la ricerca, non per la Mappa.

**Libreria.**
- Correggere L1 nella regola giusta: la scheda è colonna con `align-items: stretch` (specificità sopra `.doc`), `.doc-main` con `width: 100%`/`min-width: 0`, riga dei tag che va a capo o si taglia con "+N" dentro la scheda; titolo allineato a sinistra, 2-3 righe, 14-15 px.
- Scheda **verticale**: rapporto vicino a 0,75-0,8 (es. 200-220 × 270-290); in alto la miniatura a tutta larghezza, ritagliata alla **parte alta della pagina** (`object-fit: cover; object-position: top`, area 4:3 ≈ 45 % superiore di una A4, dove stanno titolo e autori), così la pagina si legge invece di essere rimpicciolita; sotto titolo, autori · anno, al massimo 2 chip. Bitmap già sufficiente (240 px CSS); `ROW_HEIGHT.card` e `CARD_MIN_WIDTH` da rifare insieme. Azioni al passaggio in una barra in basso sulla miniatura, non sopra lo stato. Copertine non A4 (slide, poster): `contain` su fondo neutro.
- **Multi-selezione = solo ciò che è comune**: intestazione "N lavori"; campi mostrati solo se uguali in tutti (rivista, tipo, cartella comune più profonda, autori comuni a tutti), altrimenti un riassunto (anni "2017-2025", "3 da leggere · 2 letti"); tag "in tutti" come chip modificabili; "in alcuni (k)" ripiegato, con conteggio e al massimo 10 visibili; impliciti nascosti; azioni di massa invariate. Mai un elenco per lavoro.

### Limiti

Una sola libreria reale piccola (25 lavori, 1 livello di cluster): soglie e famiglie vanno riprovate su librerie da centinaia di lavori (corpus sintetico del repository). La rete dei tag "senza parole chiave" e "con doppioni uniti" è una ricostruzione fuori dall'app con le stesse regole (scarto di 4 nodi e 5 archi rispetto all'app). Il rilevatore di quasi-doppioni è a regole e rivisto a mano: le coppie di inclusione sono candidate, non decisioni. L'espansione a più passi è stata misurata su due passi.

## Verifica onda 14 (dati reali)

Oggetto: ramo `ver14` (= `main` a a2ec88c), app compilata guidata con uno script Playwright `_electron` fuori dal repository (finestra fuori schermo, sonda `__rlMapProbe` con `RL_E2E=1`), rete tagliata, nessuna cartella abilitata all'AI, nessuna chiamata all'AI. Dati: **copia** temporanea della stessa cartella reale delle diagnosi precedenti con la copia della cartella dati della libreria (25 documenti nel modello, 220 tag importati dal vecchio indice). Percorso dell'utente: riordino guidato con i predefiniti (Accetta le sicure, famiglie proposte), poi Mappa in ogni opzione di "Raggruppa per", Vicinato, percorso, Vocabolario, griglia della libreria a 1280 e 1920 in chiaro e scuro, selezione di 5 lavori. Qui solo numeri aggregati e schemi generici; copie, schermate e dati temporanei cancellati alla fine. Correzioni in D-505 … D-507.

**Verdetto.** Così come era stata consegnata, l'onda 14 **peggiorava** la libreria dell'utente: il riordino con i predefiniti fondeva due tag diversi fra le sicure e una macro-area dentro una parola chiave fra le probabili spuntate, mandava 8 sotto-aree e 2 macro-aree in Parole chiave insieme ai loro gemelli e trasformava 124 parole chiave in una famiglia "a più valori"; la Mappa mostrava "Keywords" come blocco di Topic (il 90 % di "chiarezza" era quell'artefatto) e, dopo il riordino, Automatica metteva 21 lavori su 25 in "Senza valore". Con le correzioni il vocabolario è pulito e la Mappa è **chiara e utile**: 3 blocchi con nomi di temi veri (13 · 8 · 4), tutti i 25 titoli a 1280 e 1920, nessuna collisione, archi solo su richiesta. Resta un limite dei dati più che dell'app: **Topic non raggruppa** (48 % dei lavori in un blocco chiaro) perché una macro-area sta sull'80 % dei lavori e un'altra sul 60 %; la Mappa ripiega su Automatica, come previsto, ma l'app potrebbe aiutare di più (W11).

### Numeri (prima → dopo, contro §19.5)

| Misura | Prima | Consegnata | Con D-505 … D-507 | Obiettivo |
| --- | --- | --- | --- | --- |
| Fusioni sicure / sbagliate | — | 5 / 1 | 3 / 0 | nessuna sbagliata |
| Probabili spuntate / sbagliate | — | 2 / 1 (macro-area fusa in una parola chiave) | 6 / 0 | — |
| Concetti doppi uniti dalle fusioni | ~18 concetti | ~5 | ~9 (il resto: varianti mandate in Parole chiave dai gemelli o tolte come metadati); 0 doppioni nelle famiglie | richiamo ≥ 90 % |
| Tag delle famiglie su un solo lavoro | 59 % (di tutti) | 84 % | 25 % (7 di 28) | ≤ 25 % |
| Gemelli nelle famiglie · Da sistemare · stili | 13 · 220 · 5 | 0 · 0 · 3 | 1 · 0 · 1 | 0 · 0 · 1 |
| Topic: profondità · valori di livello 1 | 1 · — | 2 · 10 | 2 · 11 | ≥ 2 · 4-8 |
| Proposte · applicare un passo · Annulla tutto | — | 0,61 s · 0,9-1,5 s · 3,1 s | uguale | ≤ 1 s · ≤ 2 s · identico |
| Mappa: nodi non-lavoro | — | 0 | 0 | 0 |
| Topic, lavori in un blocco chiaro | — | 90 % (falso: blocco "Keywords") | 48 % (non idonea → Automatica) | ≥ 80 % |
| Automatica dopo il riordino | 13 · 8 · 4 | 2 · 2 · 21 "Senza valore" | 13 · 8 · 4 | — |
| Titoli visibili (25 lavori) 1280 · 1920 · collisioni | — | 5-6 · 25 · 0 | 25 · 25 · 0 | 25 · 25 · 0 |
| Archi: selezionato · Forti (grado massimo) | — | ≤ 4 · 2 | uguale | ≤ 5 · ≤ 2 |
| Cornice sopra la tela (Mappa) | 16-20 % | 0 | 0 | 0 |
| Vicinato: nodi · Allarga · incroci | — | 9 · 24 · 0 (stella sul centro) | uguale, senza minimappa | ≤ 4 archi per nodo, ≤ 1 incrocio |
| Vocabolario: nodi · archi a riposo | — | 28 · 0 | uguale | ≤ 40 · 0 |
| Scheda: rapporto · miniatura · titoli tagliati | 1,42-1,87 · 6-9 % · 20/25 | 0,76-0,77 · 56-57 % · 0 | uguale | 0,72-0,80 · ≥ 45 % · 0 |
| Selezione di 5 lavori | 3064 px, 87 righe | 388 px, 16 righe, 2 tag in tutti, 10 in alcuni ripiegati | uguale | ≤ 800 px |

"Annulla tutto" ripristina tassonomia e tag di ogni documento; cambiano solo i contatori (`revision`, `updatedAt`) e la migrazione una tantum della provenienza (`tagOrigin`), che resta.

### Risultati

| Id | Gravità | Dove | Problema | Esito |
| --- | --- | --- | --- | --- |
| W1 | **bloccante** | Riordino, passi 1-2 | R4 prendeva la sigla anche dagli alias: due forme estese con le stesse iniziali (una con la sigla come alias) diventavano "sicure"; una macro-area finiva fusa in una parola chiave | **corretto** (D-505): sigla solo dall'etichetta; da alias, da "(S)" o ambigua = forse |
| W2 | **bloccante** | Riordino, passo 3 | I gemelli andavano tutti in Parole chiave, temi compresi: 8 sotto-aree e 2 macro-aree sparivano dalla Mappa | **corretto** (D-506): i temi restano, vanno solo le parole chiave; gruppi di soli temi lasciati |
| W3 | **bloccante** | Riordino, passo 4 | Il gruppo `extra:` del vecchio indice (124 parole chiave) diventava una famiglia a più valori | **corretto** (D-506): oltre 12 valori è un elenco di parole chiave |
| W4 | **bloccante** | Mappa, Topic | La radice Parole chiave era un'area: blocco "Keywords" con 10 lavori | **corretto** (D-507) |
| W5 | **bloccante** | Mappa, Automatica | Dopo il riordino i lavori con tag cambiati erano esclusi: 21 su 25 "Senza valore" | **corretto** (D-507) |
| W6 | importante | Mappa a 1280 | 5-6 titoli su 25 (soglia della cella 110 px) | **corretto**: 90 px (riga di 32 px per un'etichetta di 30) |
| W7 | importante | Raggruppa per | Le famiglie del vocabolario (`family`) non erano offerte; i gruppi `extra:` già migrati sì | **corretto** (`root:<id>`, D-507) |
| W8 | minore | Riordino, nomi | `msm` → "Msm"; "Nome (SIGLA)" contato come secondo stile | **corretto** (D-505) |
| W9 | minore | Vicinato | Minimappa su 9 nodi (copriva un'etichetta); "Raggruppato per X" due volte; nomi dei gruppi di Automatica da parole chiave grezze | **corretto** (D-507) |
| W10 | minore | Barra della Mappa | A 1280 il menu "Raggruppa per" si riduceva alla freccia | **corretto** (128-200 px) |
| W11 | importante | Topic | 48 % di lavori chiari: una macro-area generica (80 % dei lavori) e una larga (60 %); a pari peso il valore principale si sceglie per id | aperto: nel passo 4 proporre di togliere, o rendere famiglia a sé, un valore oltre il 50 % (il controllo `generic` lo trova già); nei blocchi scegliere il valore principale per specificità (peso × log(N / lavori del valore)) |
| W12 | importante | Vicinato | Legenda e conteggio assoluti sopra la tela (3-4 nodi coperti); etichette tagliate al bordo | aperto: stessa striscia / colonna della Mappa; inquadratura con margine per le etichette |
| W13 | importante | Barra della Mappa | A 1280 con Automatica "Dai un nome con Claude" spinge ricerca e Filtri fuori dallo schermo (barra orizzontale) | aperto: il pulsante nel popover della striscia sotto 1440 px |
| W14 | minore | Dettaglio del lavoro | "Tag in comune" elenca anche le parole chiave coi nomi grezzi | aperto: filtrare la famiglia Parole chiave |
| W15 | minore | Riordino | ~20 tag "cognome_iniziale" (autori usati come tag) non sono riconosciuti come metadati; finiscono in Parole chiave | aperto: regola metadati "autore" contro gli autori dei documenti |
| W16 | minore | Topic | 11 valori di livello 1 (le macro-aree dell'utente); le sotto-aree vanno alla macro con P massima, spesso la più grande | aperto: scegliere per lift fra quelle con P ≥ 0,5 |
| W17 | minore | Mappa | Dopo il riordino l'intestazione dice "20 documenti nuovi": sono cambiati, non nuovi; la pillola "Riordina i tag" apre le Impostazioni invece del riordino | aperto |
| W18 | minore | Libreria | Nessuna taglia S/M/L delle schede; la riga dei chip si taglia a metà parola senza "+N" | aperto |
| W19 | minore | Nessuno (disposizione libera) | A 1280 la legenda occupa una fascia sopra la tela e un nome di cluster si sovrappone a un titolo | aperto |

### Limiti

Una sola libreria reale piccola; il corpus di 300 lavori non è stato rifatto qui. Il percorso nell'interfaccia (Maiusc+clic) non è stato provato fino in fondo dallo script: `graph:path` trova una catena di 2 passi per una coppia su tre e "Nessun percorso" per le altre a soglia normale. Il richiamo dei concetti è contato a mano su ~18 concetti ricostruiti dai nomi. Le correzioni dei pacchetti sono state provate nell'app con alias temporanei (tolti); typecheck con alias temporanei, test unitari toccati (405), check:budget e check:generality verdi.
