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
