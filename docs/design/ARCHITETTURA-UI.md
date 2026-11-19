# Architettura dell'interfaccia e sistema visivo (riprogettazione)

Stato: **finale (giro 3)**, giro 3 chiuso con la critica del progetto finale (§16, D-368 … D-382); prototipo P0 **approvato dall'utente** per la grafica (D-383); reti per tag, argomenti e autori aggiunte su richiesta dell'utente (§4.21, D-384 … D-388), 2026-11-17; funzioni scelte dall'utente integrate senza affollare l'interfaccia (§17, onde 7-12 in §14.1, budget in §13, D-395 … D-409), chiusa la critica del giro 4 con la barra del lettore da 13 controlli e il tetto dei menu (§17.7, D-410 … D-428), 2026-11-18, ramo `design-arch`. Il giro 3 integra l'audit completo (ramo `design-audit` 8c0d950, italiano e inglese) e due richieste nuove dell'utente (composizione moderna e minimale; mappa bella e giocabile): §0.3-§0.5, §1.1, §4.14-§4.20, §8.1.2, §8.3 rivisto, §14 riordinato, decisioni D-345 … D-367. In caso di dubbio vale questo documento. Primo giro scritto dal codice, dai documenti e dalle richieste dell'utente (D-310 … D-324); secondo giro rivisto con l'audit del designer avversario (`docs/design/AUDIT.md` sul ramo `design-audit`, parziale, 138 schermate misurate) e con nuove verifiche nel codice (D-325 … D-344). Le quattro domande del primo giro hanno ora una risposta **provvisoria, da confermare con l'utente** (§15): nessuna blocca il lavoro.

Le richieste dell'utente a cui risponde questo documento:

| # | Richiesta | Dove |
| --- | --- | --- |
| 1 | Grafica poco attraente → sistema visivo coerente | §5, wireframe §4 |
| 2 | Impostazioni confuse → poche sezioni chiare + "Sviluppatore / Avanzate" | §6, §4.6-§4.8 |
| 3 | Navigazione difficile → nuova architettura dell'informazione | §2, §3, §4 |
| 4 | Cambiare account Claude facilmente | §10, §4.7 |
| 5 | Scansione facile e visibile | §9, §4.9 |
| 6 | Notifica degli Arrivi poco chiara | §7, §4.4, §4.10 |
| 7a | PDF stirato orizzontalmente | §8.1 (con §8.1.1: CSS di pdf.js) |
| 7b | Annotazione per strumento (pennello), Spazio, tasti | §8.2, §4.3 |
| 7c | Sottolineature visibili negli altri lettori → **scrittura nei PDF originali** (decisione dell'utente, D-316) | §8.3 |
| 8 | Tutto più chiaro e ordinato | tutto; §11 testi |

---

## 0. Riscontro dell'audit → sezione del progetto

Ogni riscontro dell'audit (problemi numerati 1-15 della sintesi e risultati per area) ha qui la sua soluzione. Le sigle servono ai compiti dell'onda 6 per verificare la chiusura. "Da tenere" = l'audit lo indica come buono e il progetto non lo cambia.

### 0.1 I quindici problemi principali

| # | Riscontro (gravità) | Come si risolve | Sezione |
| --- | --- | --- | --- |
| A1 | PDF deformato e evidenziazioni fuori posto: `.page` dell'app su `div.page` di pdf.js (critico) | classe `.view`, guardia `.pdfViewer .page`, test CSS, e2e del rapporto pagina/MediaBox a 1280 e 1920 px; arrotondamento per DPR frazionario trattato a parte | §8.1 |
| A2 | `pdf_viewer.css` globale contamina barra laterale e dialoghi dopo la prima apertura del lettore (critico) | 7 classi in collisione misurate e rinominate, `@import … layer(pdfjs)`, test di collisione automatico, e2e sullo stile della barra laterale prima/dopo il lettore | §8.1.1, D-326 |
| A3 | Nessuno strumento, "prima seleziono poi scelgo", 3 azioni per annotazione, la vista salta pagina (critico) | barra strumenti con Seleziona/Evidenzia/Sottolinea/Gomma, colore corrente, Spazio, macchina a stati; la vista resta ferma dopo la creazione (criterio di test) | §8.2, §4.3 |
| A4 | Impostazioni: una pagina di 7981 px, 119 controlli, nessun indice (alto) | 7 sezioni con sottonavigazione e ricerca, Avanzate separate, salvataggio uniforme | §6, §4.6, D-336 |
| A5 | Account Claude: nessun "Cambia account", "Esci", identità; stato come `<dl>` non stilizzato (alto) | scheda Account con stato in una frase, modo di accesso, Cambia account, Esci, Prova la connessione, chiave | §10, §4.7 |
| A6 | Badge "Arrivi" senza tooltip, conta solo i file, stesso documento in due posti (alto) | sezione "Da rivedere", badge = decisioni in attesa, tooltip con il dettaglio, i file della scansione spiegati come "Già nella libreria" | §7.1, §4.4, D-338 |
| A7 | Scansione nascosta, barra che si sposta, nessuna voce nella tavolozza (alto) | chip Attività sempre visibile, popover Scansione con l'ultimo esito, passo nella procedura guidata, "Scansiona ora" nella tavolozza; "Ricostruisci indice" in Avanzate | §9, §4.9 |
| A8 | Evidenziazioni non nel PDF e l'app non lo dice; "Sottolineato" ambiguo (alto) | le annotazioni si scrivono nel PDF (D-316), chip "PDF:" con lo stato, consenso prima della prima scrittura (D-348); la casella diventa "Annotato" nella scheda Info | §8.3, §4.3, §11.1 |
| A9 | Lettore: 200 px di barre su 800, a 1024×700 l'area del PDF è 405×389 (alto) | una sola barra da 48 px, barra laterale compressa nel lettore, stato di studio in un menu, tasti nel pulsante [?], pannello a 3 schede; area delle pagine ≥ 960×640 a 1024×700 (pannello chiuso) e ≥ 880×740 a 1280×800 (pannello aperto) (D-370) | §4.3 |
| A10 | Barra di stato usata come area di notifica, alta fino a 100 px (alto) | barra di stato tolta; chip Attività + popover (centro notifiche), toast solo per azioni dell'utente, banner nel flusso | §7, §4.10 |
| A11 | Con la chat aperta la Libreria si rompe; due "Cronologia" (alto) | disposizione adattiva con `@container`, pannello Claude sovrapposto sotto 1180 px, Cartelle/Tag in cassetto; "Conversazioni" | §3.2, §4.1, D-335, D-334 |
| A12 | Scheda del documento con un secondo clic non scoperto; doppio clic contraddice la guida (medio) | clic = selezione + scheda nel pannello; doppio clic/Invio = lettore; Ctrl+Invio = programma esterno; guida aggiornata | §3.2, D-333 |
| A13 | Gerarchia visiva piatta, barre affollate, niente icone, titoli incoerenti (medio) | livelli di pulsante, intestazione di vista unica, icone nella barra laterale, Libreria con una sola riga di barra | §5.5, §5.6, §4.2 |
| A14 | Testi obsoleti, "Chiedi a Claude" che apre la ricerca AI, doppioni nella tavolozza (medio) | tabella delle correzioni dei testi, "Cerca con Claude" dentro il campo di ricerca, tavolozza senza doppioni | §11.1, §3.4 |
| A15 | Cartella di arrivo: ogni file è un modulo lungo una schermata (medio) | righe compatte con proposta riassunta, Modifica in linea, "Conferma i selezionati" | §4.4, D-338 |

### 0.2 Risultati per area

| # | Area · riscontro | Come si risolve | Sezione |
| --- | --- | --- | --- |
| L1 | Lettore · barra su due righe, campo pagina largo, "di 2" a capo, titolo troncato a 241 px | barra a larghezze fisse: campo pagina 48 px, "/ 38" nello stesso gruppo senza a capo, titolo nelle briciole con tooltip | §4.3 |
| L2 | Lettore · riga "studio" e paragrafo di 4 righe di scorciatoie sempre visibili | stato nel menu `reader-study-menu`, scorciatoie nel pulsante [?] e nella guida | §4.3 |
| L3 | Lettore · barra di annotazione in fondo, due primari blu, colore scelto dopo, sottolineatura da 2 px quasi invisibile | strumenti a stato, popover accanto all'annotazione, colore scelto prima; tratto scuro ≥ 3:1 e spessore minimo | §8.2, §5.2.3 |
| L4 | Lettore · clic su un'annotazione apre la barra in fondo | popover accanto al segno | §4.3, §8.2 |
| L5 | Lettore · ricerca con 7 controlli dalle etichette lunghe | barra di ricerca compatta (campo, n/N, ‹ ›, Aa, ⋯); "Evidenzia/Sottolinea il risultato" nel menu ⋯ e con i tasti di oggi | §4.3 |
| L6 | Lettore · 4 schede su due righe a 340 px | 3 schede: Annotazioni · Note (selettore Pagina/File/Tutte) · Info | §4.3 |
| L7 | Lettore · uscita solo da "← Torna alla libreria"; Esc nascosto | briciole "Libreria › Titolo", ×, Alt+←, Ctrl+W, tasto laterale del mouse; Esc non chiude (provvisoria) | §3, §8.2, D-329 |
| L8 | Lettore · pagina senza bordo né ombra in chiaro e in scuro | token `--page-edge` e `--page-shadow`, fondo dell'area `--surface-3` | §5.2, §5.3 |
| N1 | Navigazione · voci senza icone, lingua nella barra laterale, `<select>` per la libreria | icone, lingua in Generale, selettore a popover | §4.1 |
| N2 | Navigazione · aletta della chat da 44 px con "‹" | il pannello chiuso non occupa spazio; "Claude" nella barra laterale e Ctrl+J | §4.1 |
| N3 | Navigazione · Annulla/Ripeti/Cronologia ripetuti in tre viste; Cronologia non si chiude con Esc | una volta sola nella barra in alto, popover chiuso da Esc | §3.3, D-334 |
| N4 | Tavolozza · prime 9 voci sono richieste AI che riempiono la casella; doppione "secondo cervello" | ordine: Documenti, Azioni, Impostazioni, poi "Chiedi a Claude: …" con icona e descrizione "scrive la richiesta nella chat"; doppione tolto | §3.4, §11.1 |
| N5 | Toast che si accumulano al centro e coprono contenuto | in basso a destra sopra il bordo della vista, al massimo 3, mai sopra il compositore della chat | §7.3 |
| N6 | Ordine del Tab e fuoco visibile buoni | da tenere | §12 |
| W1 | Procedura guidata · 7 passi, 11 clic; "Chi sei" chiede ORCID e OpenAlex al primo minuto | 6 passi + Prima scansione, al massimo 7 clic; campi da esperto in Profilo | §4.11, D-337 |
| W2 | Procedura guidata · casella obbligatoria "Ho capito…" nel passo Claude | tolta: la frase resta come testo | §4.11 |
| W3 | Procedura guidata · "Scegli un'altra cartella" incollato, percorso completo monospazio | riquadro del percorso con spazio, percorso abbreviato al centro con tooltip | §4.11 |
| W4 | Procedura guidata · "Annulla" come link; testo obsoleto "arriverà in una fase successiva" dietro | Annulla come pulsante secondario nel piede; testo segnaposto tolto | §4.11, §11.1 |
| W5 | Carta di benvenuto alta 250 px con tre "Nascondi" | lista "Per iniziare" compatta (3 voci con spunta), una sola chiusura | §4.11 |
| B1 | Libreria · tre righe di barra; "Chiedi a Claude" = ricerca AI | una riga: titolo, conteggio, filtri, Elenco/Griglia, Ordina, + Aggiungi PDF; la ricerca è nella barra in alto; "Cerca con Claude" dentro il campo | §4.2 |
| B2 | Libreria · suggerimento della sintassi sempre visibile | pulsante "?" nel campo con la sintassi in un popover; il segnaposto dice "Cerca… (? per la sintassi)" | §4.1, §4.2 |
| B3 | Libreria · barra di selezione con 6 pulsanti uguali su due righe | 3 azioni visibili (Tag, Progetto, Claude) + ⋯ per le altre, una riga | §4.2 |
| B4 | Libreria · icone di riga piccole e solo al passaggio | sempre visibili sulla riga attiva, con etichetta nel tooltip | §4.2, D-333 |
| B5 | Libreria · "Aggiorna citazioni" senza rete: toast e barra di stato in contraddizione | un solo esito, nella riga del popover Attività; toast solo "Avviato · Vedi in Attività" | §7.3 |
| B6 | Libreria · badge "MD" 4,37:1 e "PDF" 2,5:1 in scuro sulla selezione | token `--type-*` calcolati (≥ 5,5:1) | §5.2.2 |
| B7 | Libreria · griglia con miniature 70×75 in carte 330×180 | griglia a carte verticali 168 px di larghezza, miniatura 168×220 | §4.2 |
| B8 | Libreria · ricerca immediata con sintassi ricca | da tenere | §4.2 |
| T1 | Tassonomia · "modalità" della Libreria, non un luogo | sottovista "Libreria › Tag" con briciole, "Gestisci tag" nel pannello Tag e nella tavolozza | §2, §4.2 |
| T2 | Tassonomia · editor del nodo lungo e denso | editor a sezioni: Nome e colore (aperta), Nomi alternativi, Relazioni, Unisci e ritira (chiuse) | §4.13 |
| T3 | Tassonomia · creare due tag ha avviato una scansione | difetto da verificare nell'onda 3 (D3): salvare la tassonomia non deve avviare la scansione (test) | §9, §14 |
| P1 | Progetti · intestazione con "Tutti i progetti" a sinistra e due badge | intestazione di vista unica con briciole "Progetti › Nome" | §4.13 |
| P2 | Progetti · progetto vuoto senza azione diretta | stato vuoto con "Aggiungi documenti…" | §4.13, D-344 |
| P3 | Progetti · Progetto/Collezione senza spiegazione | `Segmented` con la frase di ciascuno sotto | §4.13 |
| S1 | Scopri · quattro schede vuote senza un pulsante per aggiornare | stato vuoto con "Aggiorna le citazioni" | §4.13 |
| S2 | Scopri · controlli prima dei contenuti | filtri in una riga sotto le schede, comprimibili | §4.13 |
| R1 | Rete · "Seme" in primo piano | nel menu "Opzioni del modello" | §4.13 |
| R2 | Rete · nodi da 4 px ed etichetta al centro | nodi ≥ 8 px, etichette fuori dai nodi, "Esporta" come pulsante | §4.13 |
| R3 | Rete · scheda Rete: 3 selettori, 6 caselle e 5 pulsanti prima del grafo vuoto; Esplora vuoto | controlli in un pannello comprimibile, stati vuoti con azione | §4.13 |
| R4 | Rete · "Colora per" su due righe; "nessuno(1)" incollato | etichette con larghezza minima, spazio fra testo e conteggio | §4.13 |
| I1 | Arrivi · file trovato nella libreria e file trascinato con lo stesso modulo | due gruppi, etichette e azioni diverse | §4.4 |
| I2 | Arrivi · "senza connessione" come badge grigio | riga di stato `--warning` con "Riprova" come pulsante | §4.4 |
| I3 | Proposte · carte grandi con azioni ripetute, titolo ripetuto | gruppo per documento, una riga per campo | §4.5 |
| I4 | Arrivi · sovrapposizione di trascinamento da verificare | verifica manuale nell'onda 6 | §14 |
| C1 | Chat · "Modello" e "Ragionamento" come due menu grandi; riga di scorciatoie fissa | chip compatti nel compositore; scorciatoie nel tooltip di Invia | §4.12, D-339 |
| C2 | Chat · anteprima a ogni messaggio senza scorciatoia | anteprima in linea dopo la prima conferma della conversazione (regola 4 rispettata) | §4.12, D-339 |
| C3 | Chat · blocco strumento con nome tecnico e testo inglese | etichette tradotte per strumento ("Ricerca nella libreria: 'documento' · 0 risultati") | §4.12 |
| C4 | Lavori AI · conferma sotto la piega; dialogo che si apre senza cartelle | piede del dialogo fisso; senza cartelle avviso con link | §4.12 |
| Z1 | Impostazioni · stati AI e MCP come `<dl>` non stilizzati | componente `KeyValue` (griglia a due colonne) | §5.5 |
| Z2 | Impostazioni · id e etichette dei modelli modificabili tra le normali | in Avanzate › Claude | §6.2 |
| Z3 | Impostazioni · chiavi in tre posti | riquadro "Chiavi salvate" in Avanzate + chiave Anthropic anche nell'Account | §6.3, D-341 |
| Z4 | Impostazioni · Backup con messaggi in conflitto dopo una destinazione rifiutata | stati del riquadro Backup definiti (nessuna, rifiutata, valida) con un solo messaggio | §4.6 |
| Z5 | Impostazioni · Salva per sezione e applicazione immediata mescolati | salvataggio automatico uniforme | §6.4, D-336 |
| Z6 | Impostazioni · scorciatoie: 17 righe × 3 pulsanti | una riga per comando con il tasto e un menu ⋯ (Cambia, Spegni, Predefinito), ricerca e gruppi | §4.6 |
| K1 | Da tenere · ricerca, contrasto e fuoco, trasparenza AI, sicurezza dei dati, procedura breve, temi coerenti, Annulla con cronologia | invariati; la cronologia cambia solo posto | §3.3, §12 |
| X1 | Non ancora coperto dall'audit: inglese, scheda del documento, export, MCP acceso, backup valido, scorciatoie, PDF protetto/danneggiato, dialoghi dopo il lettore | coperti dall'audit finale: righe di §0.3 | §0.3 |

### 0.3 Audit completo (giro 3): risultati nuovi, inglese, matrice

L'audit finale (italiano 183 schermate, inglese 161 + 63 del lettore, matrice temi × dimensioni) conferma i problemi di §0.1-§0.2 con le stesse misure in entrambe le lingue e aggiunge questi risultati. Le righe di §0.1-§0.2 restano valide; dove qui la soluzione è diversa, vale questa.

| # | Riscontro (gravità) | Come si risolve | Sezione |
| --- | --- | --- | --- |
| N1 | Annotazioni **salvate** storte a pagina deformata (40 px a sinistra, 192 px oltre il testo, 58% di sovrapposizione a 1920 px); restano storte dopo la correzione del CSS (bloccante) | riparazione dal testo citato all'apertura nel lettore, `geom: 2`; mai scritte nel PDF prima della riparazione | §8.1.2, D-347 |
| A1′ | Sintesi 1-2 rimisurate: foglio del lettore con 156 regole; dopo il lettore barra laterale e dialoghi cambiano raggio, ombra, padding, larghezza | correzione H0 da sola in onda 0: rinomine, foglio di pdf.js filtrato e prefissato, e2e `leakedRules` | §8.1.1, D-346, §14 |
| N2 | Il secondo clic sulla riga non apre la scheda | un clic seleziona e mostra la scheda | §3.2, D-333 |
| N3 | La scheda aperta nasconde Cartelle/Tag/Filtri a 1280 px | la scheda si sovrappone quando lo spazio non basta; mai nascosto in silenzio | §3.2, §4.14, D-355 |
| N4 | Scheda: 9 sezioni in 2319 px, in modifica, pulsanti su 3 righe, "Proponi con l'AI" ripetuto | vista di lettura prima, "Modifica i dati" su richiesta, sezioni chiuse, azioni su una riga | §4.14, D-355 |
| N5 | "Vicini ma non sembra" / "Close but do not look it"; chip "70%" e "testo" senza spiegazione; il simile apre il lettore senza dirlo | testi nuovi, tooltip dei chip, titolo → scheda, "Leggi" → lettore | §4.14, §11.1 |
| N6 | Citazioni: due clic; errore offline sopra un paragrafo di 4 righe | un clic (dalla cache), errore sotto una spiegazione di una riga | §4.14 |
| N7 | Export: fuoco su `body` dopo "Esporta", Esc inefficace, conferma fuori vista | fuoco alla conferma in linea nel piede fisso, Esc sempre attivo | §4.15, D-356 |
| N8 | Export: percorso due volte in monospazio, "token (indice 108)", `<dl>` senza stile, "Mostra la cartella" più piccolo | percorso una volta, dimensione in parole, `KeyValue`, pulsanti della stessa taglia | §4.15 |
| N9-N10 | Ripristino: pulsanti tagliati, cartella non vuota accettata, librerie omonime, nessun "Apri", messaggio fuori dal riquadro | dialogo a piede fisso, avviso alla scelta, suffisso "(ripristinata il …)", [[Apri la libreria ripristinata]] | §4.16, D-356 |
| N11 | Backup: campo grigio senza motivo, titolo ripetuto, 4 pulsanti uguali | campo attivo con aiuto, Rimuovi nel ⋯ | §4.16 |
| N12 | `MaxListenersExceededWarning` durante il backup | ascoltatori tolti allo smontaggio, test 20 aperture | §4.16, D-356 |
| N13 | MCP acceso: nomi degli strumenti, avviso senza azione, campo porta 540 px, "PROPORRE" | in Avanzate, strumenti in un dettaglio chiuso, campo 96 px, avviso con azione, niente maiuscolo | §4.17, D-362 |
| N14 | Scorciatoie: la colonna salta durante la registrazione, "Cambia" grigio, manca "Annulla le modifiche" | colonne fisse, stati dei pulsanti, "Annulla le modifiche" | §4.6, §4.17 |
| N15 | Il chip del tag copre il percorso nella riga | terza altezza di riga, chip in riga con troncamento | §4.2, D-355 |
| N16 | Cronologia non si chiude con Esc | popover nella barra in alto | §3.3 |
| N17 | Campo pagina "2 di 2" con la pagina 1 visibile | pagina con più area visibile | §4.3, D-360 |
| N18 | Guida: "second brain" in italiano, doppio clic falso, "originali mai modificati" | ogni compito aggiorna la guida (criterio); testi in §11.1 | §11.1, §14 |
| N19 | Badge "MD"/"PDF" sotto AA (3,05 e 2,5 in scuro) | token `--type-*` ≥ 5,5:1 | §5.2.2 |
| N20 | Prima schermata sempre in italiano | lingua iniziale da `app.getLocale()` | §4.11, D-357 |
| N21 | Alt+N fuori dall'ordine della barra laterale; Scopri senza tasto | Alt+1…5 nell'ordine nuovo (Libreria, Da rivedere, Progetti, Scopri, Mappa) | §2, §14 (A2) |
| N22 | Da rivedere: Modello e Ragionamento in testa senza spiegazione; nome del file in MAIUSCOLO | due chip spiegati nella barra della vista; nomi mai in maiuscolo | §4.4, D-362 |
| N23 | "Salva" attaccato al titolo successivo | niente pulsanti Salva (salvataggio automatico) | §6.4 |
| E1 | Inglese: tre nomi per la cartella di arrivo, "Your values win…", "Propose with AI…", "Export second brain…", "Size for an agent… (index)", "Show missing documents" | glossario e correzioni in §11.1 | §11.1, D-362 |
| E2 | Inglese: blocco strumento della chat più largo del pannello, "Done" tagliato | blocchi a capo (`overflow-wrap: anywhere`), stato come icona + testo che va a capo | §4.12 |
| E3 | Inglese: "Show in folder" e "Propose with AI…" su tre righe nella scheda | azioni della scheda su una riga con ⋯ | §4.14 |
| E4 | Inglese: tassonomia, "Create" grigio accanto al campo vuoto, "Find a tag" largo metà | stati dei pulsanti (§5.5.1), campi a tutta larghezza | §4.13, §5.5.1 |
| M1 | Matrice 1024×700: barra di stato di 100 px, barra di selezione su 3 righe, 2,5 righe visibili | barra di stato tolta, selezione su una riga, almeno 7 righe | §3.2, D-363 |
| M2 | Matrice 1920×1080: viste larghe 860 px a sinistra con 800 px vuoti | larghezze delle viste per tipo di contenuto | §5.3, D-361 |
| M3 | Toast che restano dopo due cambi di sezione, sopra le impostazioni | i toast appartengono alla vista | §7.3, D-358 |
| M4 | Stati dei pulsanti: fuoco e hover in grigio pieno sembrano disattivati | tabella degli stati, mai grigio pieno per fuoco e hover | §5.5.1, D-361 |
| M5 | Elenchi chiave–valore (`<dl class="facts">`) senza stile in scheda, export, AI, MCP | componente `KeyValue` ovunque | §5.5 |
| K2 | Da tenere (audit finale): conflitto delle scorciatoie chiaro, introduzione del ripristino, frasi sull'AI, risultato dell'export, backup con stima e verifica, date e numeri nella lingua | invariati | — |

### 0.4 L'"Attacco al progetto" dell'audit, punto per punto

L'attacco è stato scritto contro 5d56f8b (documento ancora al primo giro); ogni punto è stato ricontrollato contro c215a10.

| Punto | Stato in c215a10 | Soluzione finale | Sezione |
| --- | --- | --- | --- |
| Problema 0: documento e decisioni in disaccordo | già risolto (documento riscritto al giro 2) | il documento è la fonte; le decisioni lo riassumono | — |
| B.1 `@layer` non basta; arrotondamento DPR; riparazione N1 | `@layer` + rinomine; DPR provato in F4; nessuna riparazione | foglio filtrato e prefissato, e2e `leakedRules`, altezza dalla larghezza, riparazione | §8.1, D-346, D-347 |
| B.2.1 consenso | banner dopo la prima scrittura | banner non modale nel lettore **prima** della prima scrittura per libreria, dialogo solo alla chiusura senza risposta (D-374); riga nel corpo del Riepilogo della procedura guidata | §8.3.7, D-348 |
| B.2.2 lotti ogni 4 s in cartella sincronizzata | lotti ogni 4 s, copia + rinomina | scrittura alla chiusura, al cambio, dopo 120 s senza modifiche (max una ogni 10 min), oltre 50 MB solo alla chiusura; prova dell'aggiunta in coda | §8.3.3, D-349 |
| B.2.3 due computer, annotazioni "non allineate" | regola del prefisso + `own` | classificazione della revisione aggiunta per contenuto | §8.3.6, D-350 |
| B.2.4 cifrati con password vuota | rifiuto | supporto in G4c se ≥ 2% sulla libreria di prova; permessi rispettati | §8.3.5, D-351 |
| B.2.5 firmati | rifiuto anche con campi vuoti | rifiuto solo con firma presente o `/DocMDP` | §8.3.5, D-351 |
| B.2.6 dati dopo `%%EOF`, xref ibride | rifiuto; ibride già supportate | accettati; ibride supportate | §8.3.3, §8.3.5 |
| B.2.7 ripristino distruttivo | troncamento come azione principale | "Togli dal PDF le evidenziazioni di Research Lab" (revisione); troncamento in Avanzate | §8.3.8, D-352 |
| B.2.8 copia di sicurezza nella cartella sincronizzata | `data` provvisoria | resta provvisoria `data` (testo della regola 1); l'alternativa `local` è un valore e l'argomento dell'audit è riportato in §15 | §15, D-327 |
| B.2.9 osservatore e propria scrittura | non trattato | hash atteso registrato in memoria prima della rinomina | §8.3.3, D-349 |
| B.2.10 `screen` in tema scuro | già `multiply` in entrambi i temi (§5.2.3) | confermato, con test | §5.2.3, D-353 |
| B.3 badge enorme; tabella evento → mezzo | badge = somma | numero = file nuovi, punto per le proposte; tabella in §7.4 | §7.1, §7.4, D-358 |
| B.4 Account: console, osservatore, logout, costo della prova | console, osservatore, logout in vista | dialogo che spiega, "Ho finito, verifica" primario, logout nel ⋯, costo sul pulsante, account nel pannello Claude | §10.5, D-359 |
| B.5 Spazio, fuoco, barra flottante, gomma | barra flottante, nessun suggerimento | barra unica con gli strumenti, cursore e bordo dello strumento, suggerimento di Spazio, conferma della gomma oltre 3 | §4.3, §8.2.7, D-360 |
| B.6 spazio a 1180-1600 px; due righe nel lettore; finestra minima | scheda e Claude affiancabili; due righe | mai affiancati sotto 1600 px; una riga nel lettore; minimo 1024×700 | §3.2, §4.3, D-363 |
| B.7 Mappa/Rete, "Chiedi a Claude", "Sottolineato", anteprima in linea, omonimi | "Cerca con Claude" e "Annotato" già al giro 2 | schede di Mappa rinominate; anteprima: ogni documento nuovo riporta il dialogo; suffisso per le librerie ripristinate | §4.13, §4.16, D-362, D-364 |
| B.8 funzioni dimenticate | in parte | tabella §4.18: nessuna funzione persa (sintassi di ricerca, note, Mostra nella cartella, indice, sottocartelle, export da cluster, modello e ragionamento in Da rivedere, Proponi di nuovo, scorciatoie) | §4.18 |
| B.9 grigi, viola/blu, stati, `KeyValue`, pagina | `KeyValue` e token della pagina già al giro 2 | un solo grigio secondario, ✦ in ogni blocco AI, tabella degli stati | §5.2.1, §5.5.1, D-361 |
| B.10 budget iniziale, verifica pesante, CSS diviso | indice delle impostazioni non specificato; pdf.js a ogni lotto | indice con la tavolozza; pdf.js solo alla prima scrittura; il CSS diviso non conta come risparmio di memoria | §13, D-365 |
| B.11 ordine delle onde | stirato in A1, F4 in onda 4, G4b dopo G4a, e2e condivisi | H0 da solo in onda 0; F4 in onda 3; G4b prima di G4a; e2e di un solo compito; guida in ogni compito | §14, D-354 |
| B.12 stati mancanti | in parte | tabella degli stati in §4.19 | §4.19 |

### 0.5 Richieste dell'utente del giro 3

| Richiesta | Soluzione | Sezione |
| --- | --- | --- |
| Posizione di funzioni e pulsanti e grafica in una struttura moderna, minimale ma completa | principi di composizione e tabella della posizione delle azioni per ogni vista; stati dei controlli; silenzio visivo | §1.1, §5.5.1, D-366 |
| Rete/mappa bella da guardare e divertente da esplorare | Mappa ridisegnata: colori per argomento, archi curvi e assottigliati, aloni, involucri, simulazione viva, volo, percorso, filtri animati, minimappa, Mescola e Sorprendimi; compito M4 | §4.20, §14, D-367 |

---

## 1. Principi

1. **Un posto per ogni cosa, un nome per ogni posto.** Ogni funzione vive in una sola sezione; la tavolozza dei comandi la raggiunge da ovunque, ma non la duplica. Il nome di sezione è lo stesso nel menu, nel titolo, nelle briciole, nella tavolozza e nella guida.
2. **Le cinque azioni principali a due gesti al massimo:** trovare un paper, leggerlo e annotarlo, aggiungere paper nuovi, chiedere a Claude, rivedere le proposte di Claude; il backup a tre.
3. **Lo stato si vede senza cercarlo.** Scansione, lavori AI, backup e scritture nel PDF hanno un indicatore sempre visibile (il chip Attività nella barra in alto) e un solo posto dove vedere i dettagli.
4. **I numeri chiedono una decisione.** Un badge numerico compare solo se c'è qualcosa che aspetta una scelta dell'utente; l'avanzamento non è mai un badge (§7).
5. **Normale prima, tecnico dopo.** Le impostazioni normali stanno in sezioni brevi; tutto ciò che è tecnico, sperimentale o diagnostico sta in "Sviluppatore / Avanzate", che non serve mai per l'uso quotidiano.
6. **Pannelli coerenti.** Tre zone fisse: navigazione a sinistra, contenuto al centro, Claude a destra; i dettagli di un elemento aprono sempre un pannello a destra del contenuto (scheda documento, scheda progetto, scheda nodo), mai una finestra modale.
7. **Nessuna sorpresa sui file.** L'app dice sempre cosa scrive e dove: la cartella dati, la copia dalla cartella di arrivo, le annotazioni nel PDF (con ripristino).
8. **Leggero per costruzione.** Token CSS, icone SVG in linea, nessuna libreria di componenti, viste caricate su richiesta (§13).
9. **Tastiera e lettori di schermo come cittadini di prima classe** (§12).
10. **Generalità invariata:** nessun nome, percorso o cartella reale nei testi, nei test o negli esempi.

### 1.1 Principi di composizione (giro 3, D-366)

Richiesta dell'utente: "moderna, minimale ma completa". Regole valide per **ogni** vista, dialogo e pannello; ogni compito le verifica nella sua vista.

1. **Intestazione di vista uguale ovunque:** titolo a sinistra (`--fs-title`), conteggio o sottotitolo accanto in `--text-muted`; **un solo primario a destra**; accanto al primario al massimo due secondari e poi `⋯` con tutto il resto; i pulsanti che aprono o chiudono un pannello (◫) non sono azioni e stanno dopo il `⋯` (D-377). Sotto, se servono, le schede (`Tabs`), poi **una riga di filtri** (chip), mai due.
2. **Una sola azione primaria per vista** (e per dialogo: nel piede, a destra). Tutto il resto è secondario (contorno) o terziario (testo); le azioni distruttive sono `danger` solo nel dialogo di conferma.
3. **Azioni contestuali dove serve, quando serve:** la barra di selezione compare **al posto** della riga dei filtri quando c'è una selezione multipla (stessa posizione in Libreria, Da rivedere, Progetti, Scopri); le azioni di un elemento stanno sull'elemento attivo (riga, nodo, annotazione) o nel suo menu ⋯; un popover compare accanto all'oggetto, mai in fondo alla finestra.
4. **Posizioni fisse:** navigazione a sinistra; dettagli a destra (scheda, progetto, nodo); Claude a destra del tutto; Attività, Annulla, Cronologia e Comandi nella barra in alto; conferme e risultati nel piede dei dialoghi; toast in basso a destra.
5. **Silenzio visivo:** separazione con lo spazio prima che con i bordi (bordi solo tra zone fisse e nei campi); niente cornici annidate (una `Card` non contiene un'altra `Card`); ombre solo per ciò che galleggia; un colore pieno per area (il primario); icone sottili 1,75 px; massimo tre pesi tipografici per schermata.
6. **Spazio generoso e ritmo:** 24 px tra gruppi, 12 tra righe di un modulo, 8 tra controlli; padding delle viste 24/32; righe dense solo negli elenchi.
7. **Completa:** nessuna funzione tolta; ogni funzione ha un posto visibile **o** è nel ⋯ dell'oggetto a cui si applica **e** nella tavolozza (Ctrl+K). La tabella sotto è il contratto: un compito che sposta un comando aggiorna la riga.
8. **Stessa cosa, stesso posto, stesso nome** in ogni vista (es. "Proponi con Claude…" è sempre nel ⋯ dell'oggetto o nella barra di selezione, sempre con ✦).

**Posizione delle azioni per vista**

| Vista | Primario (destra dell'intestazione o piede) | Secondari visibili | Nel ⋯ della vista | Contestuali (selezione o elemento) | Spostati da dove sono oggi |
| --- | --- | --- | --- | --- | --- |
| Guscio | — | ‹ ›, ricerca, ↶ ↷ 🕘, Comandi, Attività (barra in alto) | — | — | lingua → Impostazioni › Generale; barra di stato → Attività/pannello Claude; Annulla/Cronologia dalle viste → barra in alto |
| Libreria | + Aggiungi ▾ (PDF, DOI/arXiv/URL, Zotero/BibTeX, Risorsa; §17.4.1) | Vista ▾ (Elenco/Griglia e ordinamento), poi ◫ scheda dopo il ⋯ | Gestisci tag, Esporta come secondo cervello…, Scansiona ora | riga dei filtri con tutti i facet e "Mostra i file mancanti" (D-369); barra di selezione: Tag, Progetto, ✦ Claude ▾ (Proponi… · Note di letteratura…, Tabella di confronto…, Gruppi di ricerca…), ⋯ (Aggiorna citazioni, Esporta…, Apri con il programma predefinito · Leggi affiancati, Linea del tempo · Estendi la bibliografia…, Trova un ponte; voci con 2 documenti disattivate con il motivo); riga attiva: Leggi (Apri per una risorsa), Scheda, ⋯ | "Chiedi a Claude" → ✦ "Cerca con Claude" nel campo di ricerca; Scansiona/Ricostruisci → Attività/Avanzate; Tassonomia → Gestisci tag; scheda "Filtri" → riga dei filtri |
| Scheda del documento | Leggi | ✦ Chiedi a Claude | Apri con il programma predefinito, Mostra nella cartella · Aggiorna citazioni, Esporta… · ✦ Proponi con Claude…, ✦ Panoramica dei gruppi di ricerca… | Modifica i dati (sezione), Aggiorna (Citazioni) | modulo di modifica → "Modifica i dati" chiuso |
| Lettore | — (la lettura è l'azione) | 13 controlli (D-410): chiudi, 5 strumenti (con Ritaglia), pallino del colore, campo pagina, 110 % ▾, cerca, Studio ▾ (con lo stato del PDF), ◫, ⋯ | Annulla, Cronologia, Affianca un altro paper… · Apri con il programma predefinito, Mostra nella cartella, Esporta copia annotata… · ☐ Guida ✦ (sperimentale) | popover dell'annotazione (5 colori, 💬, Usa come prova…, 🗑); popover della selezione solo in Seleziona (Copia, Evidenzia, ✦ Spiega); schede delle citazioni al clic sui riferimenti | barra di studio → menu Studio; scorciatoie → [?]/⋯; barra di annotazione in fondo → popover |
| Da rivedere · Nuovi file | + Aggiungi PDF… | Modello e Ragionamento (chip) | Segna tutti come visti | riga: Conferma, Ignora, Modifica; selezione: Conferma i selezionati | Modello/Ragionamento dalla testa della vista → chip spiegati |
| Da rivedere · Proposte | Accetta tutte (pagina) | Filtra, Rifiuta tutte | — | gruppo: Accetta il documento; campo: ✓ ✗ Modifica | Annulla/Cronologia → barra in alto |
| Progetti (elenco) | + Nuovo progetto | Mostra gli archiviati (filtro) | — | riga: Apri, ⋯ (Archivia, Esporta…) | creazione dal modulo fisso in alto → popover |
| Progetto | Aggiungi documenti… | Piano di lettura, Note (schede); Schema dopo il primo uso (al massimo 4 schede, D-411) | Collega un file .bib…, Esporta… (secondo cervello e bibliografia) · ✦ Resoconto del periodo…, ✦ Tabella di confronto…, ✦ Suggerimenti di citazione… · Rinomina, Archivia (7 voci, D-412); "Scrivi lo schema della ricerca" ed "Estendi la bibliografia" negli stati vuoti | barra di selezione dei membri | "Tutti i progetti" → briciole |
| Scopri | Nuova ricerca ▾ (Da una domanda…, Estendi la bibliografia…, Trova un ponte…; §17.4.17) | schede (Ricerche · Da leggere dopo · Novità · Pubblicati), filtri (riga); Fonti seguite dalla riga in cima a Novità | Aggiorna le citazioni, Elimina le ricerche vecchie | riga: Leggi dopo, Importa, Scarta, Apri, ⋯ | stato vuoto senza azione → con il primario |
| Mappa | Costruisci / Aggiorna la mappa | cerca un nodo, filtri (anni, tag), schede | Opzioni del modello (seme, livelli), Disponi per anno, Esporta l'immagine, Etichette con Claude… | nodo: scheda nel pannello, Leggi, Espandi, Fissa, ⋯ (Trova un ponte con…); cluster: ⋯ (Esporta come secondo cervello…, Rinomina) | Seme → Opzioni del modello; Esporta del cluster da link → ⋯ |
| Pannello Claude | Invia | Modello, Ragionamento (chip) | Conversazioni, Nuova, Registro degli invii | blocco: copia, apri il documento | Cronologia → Conversazioni |
| Impostazioni | — (salvataggio automatico) | sottonavigazione, ricerca | — | riga: controllo e "Ripristina" (Avanzate) | pagina unica → 7 sezioni |
| Procedura guidata | Avanti / Crea | Indietro | — | — | Annulla da link → pulsante terziario nel piede |
| Dialoghi | nel piede a destra | Annulla nel piede a destra, prima del primario | — | conferme in linea nel piede | conferme fuori vista → piede fisso |

---

## 2. Architettura dell'informazione (mappa del sito)

```
Research Lab
├── [Libreria attiva ▾]  selettore in cima alla barra laterale (popover)
│     ├── elenco librerie (attiva ✓, n. documenti, cartella radice abbreviata)
│     ├── Nuova libreria…            → procedura guidata (dialogo a schermo pieno)
│     └── Gestisci librerie…         → Impostazioni › Libreria
│
├── 1 Libreria (Alt+1)              vista iniziale
│     ├── barra: filtri, Elenco|Griglia, ordina, + Aggiungi ▾ (PDF, DOI, Zotero/BibTeX, risorse; ricerca e "Cerca con Claude" nella barra in alto)
│     ├── pannello sinistro: Cartelle | Tag (› Gestisci tag = editor della tassonomia, sottovista)
│     ├── risultati (elenco virtuale o griglia)
│     ├── pannello destro: Scheda documento (metadati, stato, tag, area AI, citazioni)
│     └── Lettore (sottovista a tutta area: Libreria › Titolo)
│           ├── barra del lettore + barra strumenti flottante
│           └── pannello destro: Annotazioni | Note | Info (stato di studio, citazioni)
│
├── 2 Da rivedere (Alt+2)           ex "Arrivi" + "Proposte AI"
│     ├── Nuovi file    (da fuori: da copiare; trovati dalla scansione: da confermare)
│     └── Proposte di Claude (tag, descrizioni, parole chiave, relazioni)
│
├── 3 Progetti (Alt+3)
│     ├── elenco progetti
│     └── progetto: membri, piano di lettura, note, esporta; Schema (con domande e prove) dopo il primo uso (§17.4.13)
│
├── 4 Scopri (Alt+4)
│     ├── Ricerche | Da leggere dopo | Novità | Pubblicati   (Fonti seguite dalla riga di Novità; §17.4.17)
│
├── 5 Mappa (Alt+5)                 ex "Rete"
│     ├── Panorama | Collegamenti (rete di Documenti · Tag · Argomenti · Autori) | Esplora | Vicini inattesi (§4.20, §4.21)
│
├── (in basso) Claude  (Ctrl+J)     apre/chiude il pannello di destra
├── (in basso) Aiuto   (F1)         guida, scorciatoie (Ctrl+/)
└── (in basso) Impostazioni (Ctrl+,)
      ├── Generale · Profilo · Libreria · Claude · Backup · Scorciatoie
      └── Sviluppatore / Avanzate
```

Superfici trasversali:

| Superficie | Cos'è | Si apre con |
| --- | --- | --- |
| Barra in alto | indietro/avanti, briciole, ricerca globale, tavolozza, chip Attività | sempre visibile |
| Tavolozza dei comandi | vai a / fai / cerca documenti, comandi per Claude, voci delle impostazioni | Ctrl+K o il pulsante nella barra |
| Pannello Claude | chat, comandi, stato dell'accesso | Ctrl+J, pulsante in basso nella barra laterale |
| Attività (popover) | scansione, lavori AI, citazioni, backup, export, scritture nei PDF; ultimo risultato | clic sul chip Attività |
| Banner (nel flusso) | condizioni persistenti (§7) | automatico |
| Toast | conferme brevi con Annulla | automatico |
| Dialoghi | solo conferme distruttive o di invio, procedura guidata, ripristino, export | da un'azione |

Cosa cambia rispetto a oggi:

| Oggi | Nuovo | Perché |
| --- | --- | --- |
| Sezioni: Libreria, Progetti, Scopri, Rete, Arrivi, Impostazioni | Libreria, Da rivedere, Progetti, Scopri, Mappa + (Claude, Aiuto, Impostazioni in basso) | ordine per frequenza d'uso; "Arrivi" mescolava due cose |
| Arrivi con schede Arrivi / Proposte AI, badge = solo file | "Da rivedere" con due elenchi e un badge che conta tutto ciò che aspetta una decisione, con dettaglio nel tooltip | §7 |
| Selettore libreria = `<select>` con etichetta | pulsante con nome e popover | più chiaro, più spazio |
| Lingua nella barra laterale | Impostazioni › Generale (e tavolozza "Cambia lingua") | non è un'azione frequente |
| Barra di stato in fondo | chip Attività in alto + stato Claude nel pannello Claude; versione in Generale | uno solo posto per lo stato |
| Scansione: pulsante nella barra della libreria | chip Attività + popover Scansione + passo nella procedura guidata | §9 |
| Editor tassonomia: interruttore nella barra della libreria | "Gestisci tag" nell'intestazione del pannello Tag | vicino a ciò che modifica |
| Impostazioni: una pagina lunga con 10 riquadri | 7 sezioni con sottonavigazione + ricerca | §6 |

---

## 3. Modello di navigazione

**Cronologia propria (senza router).** Un piccolo modulo `lib/nav.tsx` (≈2 KiB, prima schermata) tiene la posizione corrente `NavLocation` e due pile (indietro, avanti, al massimo 50 voci):

```ts
type NavLocation =
  | { view: 'library'; docId?: string }                       // docId: scheda aperta
  | { view: 'reader'; docId: string; page?: number }          // sottovista della Libreria
  | { view: 'taxonomy' }                                      // sottovista della Libreria
  | { view: 'review'; tab: 'files' | 'proposals' }
  | { view: 'projects'; projectId?: string }
  | { view: 'discover'; tab: 'readnext' | 'new' | 'published' | 'sources' }
  | { view: 'map'; tab: 'overview' | 'links' | 'explore' | 'surprising'; mode?: 'docs' | 'tag' | 'topic' | 'author' }
  | { view: 'settings'; section: SettingsSectionId; anchor?: string };
```

- `navigate(loc)` spinge la posizione corrente; `back()` / `forward()`; Alt+← / Alt+→ e i tasti laterali del mouse (pulsanti 3 e 4); il pulsante ← della barra in alto.
- Il lettore è una **sottovista della Libreria**: chiuderlo (×, ←, Alt+←) torna all'elenco con la stessa selezione e lo stesso scorrimento (la Libreria resta montata e nascosta, come oggi).
- Briciole nella barra in alto: `Libreria › <cartella filtrata> › <titolo>`; `Impostazioni › Claude › Account`; ogni segmento è un pulsante.
- La tavolozza e i link della chat (`lab://…`, `aiUi.navigation`) passano tutti da `navigate`: un solo percorso, quindi indietro funziona anche dopo un link della chat.
- Cambio di libreria: salva le note aperte (`flushAll`, come oggi), chiude il lettore, **azzera le pile** (una posizione di un'altra libreria non ha senso) e riapre la stessa vista principale nella nuova libreria; filtri e scheda per libreria si ricordano in memoria per la sessione (`Map<libraryId, LibraryViewState>`).
- Lo stato di ogni vista (filtro, scheda, scorrimento) resta finché l'app è aperta; niente URL, niente persistenza su disco (leggerezza).

**Tavolozza dei comandi (Ctrl+K)**: è il "vai ovunque". Gruppi nell'ordine: (1) Documenti (titoli dalla ricerca, al massimo 8, Invio apre il lettore, Maiusc+Invio la scheda), (2) Comandi per Claude (come oggi), (3) Azioni dell'app (viste, nuova libreria, scansiona ora, backup ora, aggiungi PDF, cambia lingua, tema), (4) Impostazioni (ogni voce indicizzata per etichetta e sinonimi: "chiave", "account", "login", "MCP", "porta"… → apre la sezione e scorre all'ancora). I documenti si cercano solo se il testo ha almeno 2 caratteri, con ritardo di 150 ms.

**Ricerca globale (Ctrl+L)**: il campo nella barra in alto è la ricerca della Libreria. Se si scrive da un'altra vista, Invio porta alla Libreria con la query. In Libreria è lo stesso campo (non ce n'è un secondo nella pagina).

### 3.1 Gesti per i compiti principali

| Compito | Gesti | Come |
| --- | --- | --- |
| Trovare un paper | 2 | Ctrl+L, scrivere, Invio sul risultato (o frecce) |
| Leggere e annotare | 2 | Invio/R apre il lettore; H (evidenzia) e trascinare sul testo |
| Aggiungere paper | 2 | trascinare PDF sulla finestra → "Da rivedere" si apre → Conferma |
| Chiedere a Claude | 1-2 | Ctrl+J e scrivere; con documenti selezionati la domanda li include |
| Rivedere proposte | 2 | Alt+2 → "Accetta" (o A/R da tastiera sulla voce attiva) |
| Backup | 2-3 | Ctrl+K "backup" Invio, oppure Impostazioni › Backup › Esegui ora |

### 3.2 Interazioni comuni (giro 2)

**Clic nella Libreria (D-333, supera D-127 dove diverso):**

| Gesto | Effetto |
| --- | --- |
| clic su una riga | la seleziona (unica) e, se il pannello di destra è aperto, ne mostra la scheda; il pannello si apre/chiude con il pulsante ◫ della barra e resta come lo si lascia (`rl.detailOpen`) |
| Ctrl+clic / Maiusc+clic, casella della riga | selezione multipla; il pannello mostra il riepilogo della selezione |
| doppio clic, Invio, R | PDF → lettore; altri tipi → programma predefinito (come oggi) |
| Maiusc+Invio, pulsante "Scheda" della riga | apre il pannello sulla scheda (se era chiuso) |
| Ctrl+Invio, ⋯ › "Apri con il programma predefinito" | file nel programma esterno |
| Canc / Backspace | come D-127: apre il pannello dei tag, nulla si cancella |

La guida e il testo dello stato vuoto si aggiornano di conseguenza ("Doppio clic per leggere").

**Disposizione adattiva (D-335).** Larghezze fisse: barra laterale 232 px (56 compressa), pannello Claude 380 px (320-560), pannello di dettaglio 360 px (300-480), vista minima 640 px.

| Larghezza della finestra | Barra laterale | Pannello Claude aperto | Libreria |
| --- | --- | --- | --- |
| ≥ 1440 | estesa | accanto alla vista | Cartelle/Tag + risultati + scheda affiancati |
| 1180-1439 | estesa | accanto | scheda sovrapposta (cassetto da destra) se la vista utile < 1000 px |
| 1100-1179 | estesa | **sovrapposto** (cassetto con `--e-3`, Esc o clic fuori lo chiude, il fuoco torna al pulsante) | come sopra |
| < 1100 | compressa (icone) | sovrapposto | sotto 900 px utili Cartelle/Tag diventa un cassetto aperto dal pulsante "▤ Cartelle" a sinistra del conteggio |

Si realizza con `container-type: inline-size` su `.view` e regole `@container` nei CSS delle viste; il guscio decide "accanto/sovrapposto" con una media query sulla finestra. Nessuna misura in JavaScript. Criterio (e2e a 1024×700 e 1280×800 con la chat aperta): il campo di ricerca è largo almeno 280 px, nessun controllo della barra della vista va a capo, le righe dei risultati sono larghe almeno 420 px.

**Giro 3 (D-363):** la scheda del documento e il pannello Claude non sono mai affiancati sotto 1600 px di finestra: l'ultimo aperto si sovrappone come cassetto. La finestra ha una dimensione minima di 1024×700 (`minWidth`/`minHeight`); a 1024×700 la barra laterale è compressa, il pannello Claude e la scheda sono sovrapposti, la Libreria mostra almeno 7 righe e la barra di selezione sta su una riga; il lettore usa la barra unica (§4.3).

### 3.3 Annulla, Ripeti, Cronologia (D-334)

Una sola volta, nella barra in alto a destra delle briciole: `[↶] [↷] [🕘]` (pulsanti icona, tooltip "Annulla: Tag aggiunto a 3 documenti · Ctrl+Z"). La cronologia è un popover ancorato (420 × fino a 480 px) con le ultime modifiche e "Annulla fino a qui"; si chiude con Esc, clic fuori o un secondo clic; non resta mai sotto la tavolozza o la guida (z-index dei popover sotto quello dei dialoghi). Il modulo `lib/history.tsx` non cambia: cambia solo dove si monta `HistoryPanel`. Testid tenuti (`history-panel`, `history-empty`, quelli dei pulsanti) e spostati nella barra.

### 3.4 Tavolozza dei comandi: ordine e voci

Ordine dei gruppi: (1) Documenti (dalla ricerca, con 2+ caratteri), (2) Vai a (viste, sezioni delle impostazioni), (3) Azioni (Scansiona ora, Esegui un backup ora, Aggiungi PDF, Nuova libreria, Cambia lingua, Tema, Annulla/Ripeti), (4) Chiedi a Claude (le richieste predefinite, con icona ✦ e la descrizione "scrive la richiesta nella chat: la invii tu"). Senza testo digitato si mostrano solo "Recenti" (`rl.paletteRecent`) e i gruppi 2-3. Ogni voce mostra il suo tasto se esiste. Il doppione "Esporta il secondo cervello" / "Esporta come secondo cervello…" diventa una voce sola "Esporta come secondo cervello…".

---

## 4. Wireframe e specifiche delle schermate

Convenzioni: misure in px CSS; colori e misure con i token di §5; `[Testo]` pulsante secondario, `[[Testo]]` primario, `(Testo)` terziario senza bordo, `▾` menu, `⋯` menu di altre azioni, `◫` apre/chiude un pannello. Ogni schermata elenca le misure che il compito deve rispettare: chi implementa non sceglie colori, spazi o pesi.

### 4.1 Guscio

```
 232                     flessibile (min 640)                                                  380 (320-560)
+----------------------+--------------------------------------------------------------------+---------------------------+
| ◧ Research Lab   [≡] | [‹][›]  Libreria › Capitolo 2        [⌕ Cerca nella libreria… ?  ✦] | ✦ Claude            [×]   |  48
|                      |                                      [↶][↷][🕘]  [⌘K]  (⟳ 45%  ●) | ● Pronto · Haiku 5.5 ▾    |
| [■ Tesi          ▾]  +--------------------------------------------------------------------+---------------------------+
|                      | ⚠ Ultimo backup 34 giorni fa.               [Esegui ora]  (Chiudi) |  conversazione            |  banner
|  ▣ Libreria          +--------------------------------------------------------------------+                           |
|  ⇩ Da rivedere   15  |                                                                    |                           |
|  ▤ Progetti          |                      CONTENUTO DELLA VISTA (.view)                  |                           |
|  ◈ Scopri         4  |                                                                    |                           |
|  ◎ Mappa             |                                                                    |                           |
|                      |                                                                    |                           |
|  ──────────────      |                                                                    | [Chiedi a Claude…      ]  |
|  ✦ Claude   Ctrl+J   |                                                                    | (Haiku ▾)(Basso ▾)  [[↑]] |
|  ? Aiuto        F1   |                                              [toast · Annulla] ↘   |                           |
|  ⚙ Impostazioni      |                                                                    |                           |
+----------------------+--------------------------------------------------------------------+---------------------------+
```

Struttura (HTML indicativo, i `data-testid` sono quelli di §14):

```html
<div class="shell" data-testid="shell">                       <!-- grid: [sidebar] [main] [claude?] ; righe: [topbar 48] [banner auto] [view 1fr] -->
  <nav class="app-sidebar" aria-label="Sezioni">…</nav>         <!-- --surface-2, bordo destro --border -->
  <header class="topbar">…</header>                            <!-- --surface, bordo basso --border, altezza 48 -->
  <div class="banner-slot" aria-live="polite">…</div>          <!-- D-305, al massimo 2 banner -->
  <main class="view" id="main" tabindex="-1">…</main>          <!-- --bg, container-type: inline-size -->
  <aside class="claude-panel" data-testid="chat-panel">…</aside>
  <div class="toast-region" aria-live="polite">…</div>         <!-- in basso a destra della .view, 16 px dai bordi -->
</div>
```

Barra laterale:
- Intestazione 48 px: logo 20 px + "Research Lab" `--fs-heading` 600; pulsante [≡] (`IconButton` ghost) per comprimere.
- Selettore di libreria: pulsante a tutta larghezza meno 2×12 px, altezza 40, `--surface`, bordo `--border`, `--r-sm`; quadratino 10×10 `--r-xs` col colore della libreria (dal nome: una delle 8 tinte di `--lib-1..8`), nome `--fs-body` 600 troncato, sotto il numero di documenti `--fs-caption` `--text-muted`; `▾`. Popover 300 px: elenco librerie (✓ sull'attiva, cartella abbreviata al centro `…\Tesi`), separatore, "Nuova libreria…", "Gestisci librerie…".
- Voci: altezza 36, padding 0 12, icona 20 + 12 di spazio + etichetta `--fs-body` 500; hover `--surface-3`; attiva `--accent-soft` con testo `--accent-text` e barra di 3 px `--accent` a sinistra (`aria-current="page"`); badge a destra (`Badge` numero: 20 px di altezza, `--r-pill`, `--accent` con `--on-accent`, `--fs-caption`).
- In basso: separatore, Claude (con `Kbd` Ctrl+J a destra, `--text-subtle`), Aiuto, Impostazioni. La lingua non è più qui.
- Compressa (56 px): solo icone centrate, badge come puntino 8 px con il numero nel tooltip.

Barra in alto (48 px, `--surface`, padding 0 16, gap 8):
- `[‹][›]` IconButton 32; briciole `--fs-body`, ultimo segmento 600, separatore `›` `--text-subtle`; troncamento del segmento centrale per primo.
- Ricerca globale: campo 32 px, larghezza `clamp(280px, 32vw, 440px)`, icona ⌕ a sinistra, a destra due pulsanti icona interni: `?` (popover della sintassi di ricerca, testo di oggi) e `✦` "Cerca con Claude" (apre la ricerca AI di oggi con la query); segnaposto "Cerca nella libreria…  Ctrl+L".
- A destra: Annulla/Ripeti/Cronologia (§3.3), `[⌘K]` (testo "Comandi" sopra 1280 px, solo icona sotto), chip Attività (§4.10).
- Il pannello Claude chiuso **non occupa spazio** (nessuna aletta): si apre da "Claude" nella barra laterale, Ctrl+J o dai pulsanti "Chiedi a Claude".

### 4.2 Libreria

```
+--------------------------------------------------------------------------------------------------------------+
| Libreria  214 documenti                                                     [Vista: Elenco · Titolo ▾]  [[+ Aggiungi PDF]]  [⋯]  [◫] |  56
| [Stato ▾] [Tipo ▾] [Anno ▾] [Rivista ▾] [Autori ▾] [Tag ▾]  (× Da leggere) (⊘ Bozze) (Pulisci)  □ Mostra i file mancanti |  40
+--------------------+---------------------------------------------------------+---------------------------------+
| [Cartelle | Tag ]  |  ☐ ▤ Titolo del primo paper                Autore A · 2021 |  Scheda                    [×] |
| ---------------    |       Rivista · Capitolo 1/paper-1.pdf          ● In lettura |  Titolo del paper               |
| ▾ Tutta la libreria 214 ║ ☐ ▤ Titolo del secondo paper (attiva)  [Leggi][Scheda][⋯] |  Autore A, Autore B · 2021      |
|   ▸ Capitolo 1   42 |       …frammento con la parola cercata… p. 3 · p. 7      |  [[Leggi]] [✦ Chiedi a Claude] [⋯] |
|   ▾ Capitolo 2   80 |  ☐ ▤ Titolo del terzo paper                   …          |  Stato  (Da leggere|In lettura|Letto) |
|      ▸ Fonti     12 |                                                         |  Tag    [Ottica ×] [+ Tag]      |
|   ▸ Bozze         6 |                                                         |  ┃ Generato dall'AI             |
| □ Includi sottocartelle                                                       |  ┃ Descrizione proposta [Rivedi] |
| (Gestisci tag)     | 3 selezionati  [Tag ▾] [Progetto ▾] [✦ Claude ▾] [⋯]  (Deseleziona) | Citazioni 12 in libreria · 30 |
+--------------------+---------------------------------------------------------+---------------------------------+
```

- **Intestazione di vista** (uguale in tutte le viste, D-344): riga 56 px con titolo `--fs-title` 600, sottotitolo/conteggio `--fs-small` `--text-muted` sulla stessa linea di base, azioni a destra (al massimo un primario: qui "+ Aggiungi PDF"); riga dei filtri 40 px con `Chip` filtro (altezza 28, `--r-pill`, `--surface`, bordo `--border-strong`; attivo: `--accent-soft`, testo `--accent-text`, × per togliere).
- **Una sola barra** (B1): la ricerca è nella barra in alto; la scansione è nel chip Attività; "Tassonomia" è "(Gestisci tag)" in fondo al pannello Tag; "Ricostruisci l'indice" è in Avanzate; Annulla/Ripeti/Cronologia nella barra in alto.
- Pannello sinistro 240 px (200-320), `Tabs` "Cartelle | Tag" (la scheda "Filtri" di oggi diventa la riga dei filtri sopra); righe dell'albero 28 px, conteggio a destra `--text-subtle` cifre tabellari.
- **Righe dei risultati:** 56 px (due righe di testo) o 76 px con il frammento; titolo `--fs-body` 600, seconda riga `--fs-small` `--text-muted`; icona del tipo 24 px con il badge del tipo (§5.2.2); stato di studio come puntino 8 px + testo a destra. Riga attiva: fondo `--accent-soft`, bordo sinistro 3 px `--accent`, e le azioni **sempre visibili** `[Leggi] [Scheda] [⋯]` (pulsanti `sm` secondari) — B4, D-333. Hover: `--surface-2`.
- **Griglia** (B7): carte 168 px di larghezza (gap 16), miniatura 168×220 `--r-md` con `--page-edge`, sotto titolo su 2 righe e autore·anno; selezione con anello 2 px `--accent`.
- **Barra di selezione** (B3): sostituisce la riga dei filtri quando c'è una selezione multipla; 3 azioni visibili + ⋯ ("Aggiorna citazioni", "Esporta come secondo cervello…", "Apri con il programma predefinito"); "Deseleziona" terziario; una sola riga a ogni larghezza (le azioni passano nel ⋯ da destra se manca spazio).
- **Scheda** (pannello 360 px): intestazione con titolo `--fs-heading`, autori e rivista `--fs-small`; un primario "Leggi"; sezioni separate da 16 px con etichette `--fs-caption` maiuscole; contenuto AI con bordo sinistro 3 px `--ai`, fondo `--ai-soft` e l'etichetta "Generato dall'AI".
- Stati vuoti (`EmptyState`): libreria vuota ("Trascina qui i PDF o [[+ Aggiungi PDF]]"), ricerca senza risultati (testo di oggi, da tenere), filtro "Dalla scansione: 3 nuovi" con chip.

### 4.3 Lettore (giro 3: una sola barra)

Nel lettore la barra in alto del guscio **diventa** la barra del lettore (D-360): una sola riga da 48 px, nessuna barra flottante sopra le pagine (copriva le prime righe), nessuna riga di studio.

```
+--------------------------------------------------------------------------------------------------------------+
|[×] Libreria › Titolo del paper… │[↖][▌●][U●][⌗][⌫] (●) │ [ 12 ]/38 │ 110 % ▾ [⌕] │ Studio ▾ │                [◫][⋯]|  48
+==============================================================================+-------------------------------+  ← bordo 2 px nel colore
|        ┌───────────────────────────────────────────────────┐                  | Annotazioni · Note · Info     |    dello strumento (non Seleziona)
|        │  Testo della pagina con ▌evidenziazione▐          │ ← --page-shadow  | ----------------------------- |
|        │  e una frase sottolineata_______                 │                  | Pagina 3                      |
|        │            ┌──────────────────────────────────┐   │                  |  ▌ «testo evidenziato…»  ⋯    |
|        │            │ ● ● ● ● ● │ ▌ _ │ 💬 │ 🗑         │   │ ← popover        |  _ «testo sottolineato»  ⋯    |
|        │            └──────────────────────────────────┘   │                  | ⚠ 2 da controllare (Riposiziona) |
|        └───────────────────────────────────────────────────┘                  | Dal PDF (altri programmi)     |
+------------------------------------------------------------------------------+-------------------------------+
```

**Barra** (48 px, `--surface`, bordo basso `--border`): gruppi separati da divisori 1×20 `--border`, larghezze fisse, nulla va a capo. A ogni larghezza da 1024 px in su la barra resta intera; sotto 1024 px solo il titolo si accorcia.

**13 controlli** (D-410, critica del giro 4): il P0 approvato ne aveva 22; il prototipo P0 è aggiornato con questa barra.

| Gruppo | Contenuto | Controlli | Larghezza |
| --- | --- | --- | --- |
| Uscita e titolo | `[×]` (`reader-close`, tooltip "Chiudi · Alt+← · Ctrl+W"); briciole con titolo troncato e tooltip (`reader-title`, non è un controllo) | 1 | 32 + titolo `min(32ch, 24%)`; 1280: titolo 16ch |
| Strumenti | `reader-toolbar` (`role="toolbar"`): Seleziona V, Evidenzia H, Sottolinea U, **Ritaglia R** (§17.4.8), Gomma E (32×32; attivo `--accent-soft` + `aria-pressed`; pallino 7 px del colore sui pennelli) e il **pallino del colore attivo** (`ann-color`, 32×32 con un disco di 16 px) che apre un popover con i 5 colori (`ann-color-*`, `aria-checked`, tooltip con il nome e il significato, §17.4.10); tasti 1-5 invariati | 6 | 6×32 + 5×2 |
| Pagina | campo `[ 12 ]` (`reader-page-input`) con `/ 38` (`reader-pages`, etichetta); niente frecce: PagSu/PagGiù, N/P, Home/Fine; il campo mostra la pagina con più area visibile (N17) | 1 | 84 |
| Zoom e ricerca | `110 % ▾` (`reader-zoom`): menu Adatta alla larghezza (Ctrl+0), Adatta alla pagina, 100 %, 150 %; Ctrl± e Ctrl+rotella; `[⌕]` apre la barra di ricerca sotto (`reader-find*`) | 2 | 64 + 32 |
| Studio | menu `Studio ▾` (`reader-study-menu`): gruppo "Stato di studio" (voci `reader-study-*`) e gruppo PDF con l'intestazione di stato "Nel PDF ✓ · scritto alle 10:42" (`reader-pdf-status`, ex chip `reader-pdf-chip`) e le voci "✓ Salva anche nel PDF" e "Togli dal PDF…" (§8.3); un punto `--warning` sul pulsante solo con un errore o una scrittura in attesa | 1 | 88-140 |
| Fine | `[◫]` pannello (`reader-side`), `[⋯]` (`reader-more`): Annulla (Ctrl+Z), Cronologia (Ctrl+H), Affianca un altro paper… ┃ Apri con il programma predefinito, Mostra nella cartella, Esporta copia annotata… ┃ ☐ Guida ✦ (sperimentale, G) | 2 | 2×32 |

Annulla non è più nella barra: Ctrl+Z, la voce del `⋯` e il toast "Annulla" dopo un'eliminazione restano. Tasti del lettore: tasto `?`, Aiuto e tavolozza. Il chip PDF è dentro Studio: lo stato si legge nel menu e nella scheda Info; il punto sul pulsante Studio e il chip Attività (che nel lettore compare solo con un errore) segnalano i problemi.

Nel lettore la barra laterale si comprime a 56 px ("modo lettura") e torna com'era all'uscita (D-370). A 1024 px tutta la barra sta in una riga senza ridurre nulla: spazio 1024 − 56 − 16 = 952 px; somma dei gruppi con il titolo a 16ch ≈ 820 px, margine ≥ 120 px (misurato sul P0 aggiornato: la barra non scorre a 1024×700). Ricerca globale, Comandi e chip Attività del guscio restano raggiungibili con Ctrl+L, Ctrl+K e dalla voce "Attività" della tavolozza; il chip Attività compare nella barra del lettore solo quando c'è un errore o una scrittura in attesa.

**Indicazione dello strumento vicino al lavoro** (attacco B.5): cursore della forma dello strumento con il pallino del colore; bordo superiore di 2 px dell'area delle pagine nel colore del tratto (`--ann-*-stroke`) quando lo strumento non è Seleziona; se il fuoco esce dalla regione del lettore il bordo diventa `--border` e i pulsanti degli strumenti si attenuano (opacità .6), così si vede che le lettere non agiscono.

**Area delle pagine:** fondo `--surface-3`; ogni pagina con `--page-shadow` e contorno 1 px `--page-edge`; 16 px tra le pagine; nessuno scorrimento orizzontale con "Adatta". **Barra di ricerca** (40 px sotto la barra): campo 240, "3 di 17", `‹ ›`, `Aa`, `⋯` (Evidenzia il risultato · Ctrl+Maiusc+H, Sottolinea il risultato · Ctrl+Maiusc+U), ×.

**Pannello destro** 340 px (280-480): **Annotazioni** (per pagina; voce = segno, citazione su 2 righe, commento, ⋯ con Colore/Tipo/Commento/Elimina; gruppo "Da controllare" per le annotazioni non riparate, §8.1.2; gruppo "Dal PDF (altri programmi)" in sola lettura), **Note** (`Segmented` Pagina · File · Tutte; i `reader-tab-*` di oggi sono i valori), **Info** (stato di studio, "Annotato" con l'origine, stato della scrittura nel PDF con le azioni del chip, citazioni del documento).

**Popover dell'annotazione:** ancorato al primo rettangolo (sopra, sotto se manca spazio), 8 px, `--e-2`, `--r-md`, 40 px: colori · tipo · 💬 · 🗑; Tab ci entra, Esc lo chiude.

**Area utile misurata** (criterio di F4, D-370; barra laterale compressa a 56 px): a 1024×700 con il pannello chiuso almeno 960×640; a 1280×800 con il pannello aperto (340 px) almeno 880×740 (oggi 405×389 e 661×557).

### 4.4 Da rivedere — Nuovi file

```
+--------------------------------------------------------------------------------------------------------------+
| Da rivedere                                                                          [[+ Aggiungi PDF…]]       |
| [ Nuovi file 3 ][ Proposte di Claude 12 ]                                                                      |
+--------------------------------------------------------------------------------------------------------------+
| DA AGGIUNGERE ALLA LIBRERIA · trascinati o scelti da fuori                       ☐ Tutti  [Conferma i selezionati] |
| ☐ ▤ download.pdf  1,8 MB                                                                                      |
|      → «Sample 2025 - Titolo.pdf» in Capitolo 2 › Fonti      Dati: trovati (OpenAlex) · Tag: Ottica, Laser     |
|      ⚠ Possibile duplicato di «Titolo…» (Confronta)                         (Modifica) [Ignora] [[Conferma]]    |
| ☐ ▤ scan-003.pdf  0,4 MB                                                                                      |
|      → «scan-003.pdf» in (radice)  ⚠ Senza connessione: dati non cercati  [Riprova]   (Modifica) [Ignora] [[Conferma]] |
|                                                                                                              |
| GIÀ NELLA LIBRERIA · trovati dalla scansione: controlla i dati trovati               [Segna tutti come visti] |
| ▤ Capitolo 1/nuovo.pdf   Dati: trovati · Tag proposti: Ottica                   (Modifica) [Più tardi] [[Conferma i dati]] |
+--------------------------------------------------------------------------------------------------------------+
```

- Una riga chiusa è alta 64-84 px (A15): nome del file `--fs-body` 600 + dimensione; riga della proposta `--fs-small`; problemi come riga con icona e colore di stato (`--warning` per duplicato e assenza di rete, I2) con l'azione come pulsante, non come badge grigio.
- "(Modifica)" apre i campi nella riga (Dati, Proposta, Tag: gli stessi componenti di oggi, in due colonne); "Modello" e "Ragionamento" stanno nella riga dell'azione AI dentro la modifica, mai staccati dal loro menu.
- I due gruppi hanno etichette `--fs-caption` maiuscole e testo d'aiuto diverso (I1). Il file trovato dalla scansione non ha "Copia nella libreria" (è già lì) ma "Conferma i dati".
- Trascinamento: sovrapposizione `drop-hint` a tutta finestra con bordo tratteggiato 2 px `--accent`, testo `--fs-title` "Rilascia per aggiungere a Da rivedere"; al rilascio la vista si apre e le righe nuove hanno fondo `--accent-soft` per 2 s.

### 4.5 Da rivedere — Proposte di Claude

```
+--------------------------------------------------------------------------------------------------------------+
| [ Nuovi file 3 ][ Proposte di Claude 12 ]   Filtra: [Tutte ▾]   Accettate finora: 84%       [Accetta tutte] [Rifiuta tutte] |
+--------------------------------------------------------------------------------------------------------------+
| ┃ Titolo del paper A                                              (Apri la scheda) (Leggi)  [Accetta il documento] |
| ┃   Tag          [Ottica ✓] [Laser ✓] [Fibra ✗]                                   (Modifica) [✗] [✓]       |
| ┃   Descrizione  «Testo proposto…»                                                 (Modifica) [✗] [✓]       |
| ┃ Generato dall'AI                                                                                          |
| ┃ Titolo del paper B …                                                                                      |
|                                                   ‹ Pagina 1 di 3 ›                                           |
+--------------------------------------------------------------------------------------------------------------+
```

Un gruppo per documento con bordo sinistro 3 px `--ai` (I3); titolo una volta sola, `--fs-body` 600 (niente maiuscolo grigio né chip col titolo); una riga per campo con ✓/✗ (IconButton con `aria-label` "Accetta i tag", "Rifiuta la descrizione"). "Accetta tutte/Rifiuta tutte" agiscono sulla pagina visibile (come oggi "Accetta pagina"), con conferma se più di 20 elementi. Tasti J/K/A/R/E/O come nel primo giro.

### 4.6 Impostazioni

```
+--------------------------+-----------------------------------------------------------------------------------+
| Impostazioni             |  Libreria                                                                         |
| [⌕ Cerca impostazioni  ] |  Le impostazioni della libreria «Tesi» valgono su ogni computer.                  |
|                          |  ───────────────────────────────────────────────────────────────────────────────  |
|   Generale               |  LE TUE LIBRERIE                                                                  |
|   Profilo                |   ■ Tesi (attiva) · 214 documenti · …\Tesi        [Apri cartella] [⋯]            |
| ▌ Libreria               |   ■ Corso · 31 documenti · …\Corso               [Rendi attiva] [⋯]              |
|   Claude                 |   (+ Nuova libreria…)                                                             |
|   Backup            ⚠    |  QUESTA LIBRERIA                                                                  |
|   Scorciatoie            |   Nome                       [Tesi                    ]  ✓ Salvato                |
|  ─────────────           |   Lingua dei documenti       [Italiano ▾]                                         |
|   Sviluppatore /         |   Cartelle escluse           Bozze/old  ×   (+ Escludi una cartella)              |
|   Avanzate               |  SCANSIONE                                                                        |
|                          |   Ultima: oggi 14:32 · +3 nuovi        [Scansiona ora]  (Vedi il rapporto)        |
|                          |  ANNOTAZIONI NEL PDF                                                              |
|                          |   [■■] Salva le evidenziazioni anche nel PDF                                      |
|                          |        Così le vedi in Chrome e negli altri lettori. Il testo non cambia e puoi   |
|                          |        ripristinare l'originale.                                                  |
|                          |   [□ ] Firma le annotazioni con il mio nome                                       |
|                          |   12 annotazioni in 3 documenti solo nell'app   [Scrivile nei PDF…]               |
+--------------------------+-----------------------------------------------------------------------------------+
```

- Sottonavigazione 220 px (`settings-nav-<section>`), voce attiva come nella barra laterale; contenuto max 760 px, padding 24 32.
- Gruppi con etichetta `--fs-caption` maiuscola, righe a due colonne: etichetta 220 px `--fs-body` 500 (+ aiuto `--fs-small` `--text-muted` sotto), controllo a destra. Salvataggio automatico (D-336): "✓ Salvato" `--success` `--fs-small` per 2 s accanto al controllo; errore sotto il campo `--danger` con icona.
- Ricerca: filtra le righe di tutte le sezioni per etichetta, aiuto e sinonimi (`settingsIndex.ts`); i risultati mostrano "Sezione › Gruppo"; Invio apre e porta il fuoco al controllo.
- **Backup** (Z4): tre stati, un solo messaggio ciascuno — *nessuna destinazione*: "Scegli dove salvare i backup" + [[Scegli cartella…]]; *destinazione rifiutata* (dentro una libreria, non scrivibile): errore sotto il percorso con il motivo + [[Scegli un'altra cartella…]], "Esegui ora" nascosto; *valida*: percorso abbreviato + (Cambia), cadenza `Segmented` Spento/Giornaliero/Settimanale/Mensile, [[Esegui il backup ora]], elenco dei backup con Verifica / Ripristina… / Apri; "Quanti tenere" e "Includi cronologia chat…" in "Opzioni".
- **Scorciatoie** (Z6): campo di ricerca, gruppi Globali / Lettore / Strumenti del lettore; una riga per comando 40 px: nome · `Kbd` del tasto (o "spenta") · ⋯ (Cambia… / Spegni / Ripristina il predefinito); "Cambia…" mette la riga in ascolto ("Premi i tasti… Esc annulla") e mostra i conflitti sotto la riga.

### 4.7 Impostazioni › Claude › Account Claude

```
+------------------------------------------------------------------------------------------------------------+
| Claude                                                                                                     |
| ┌ Account Claude ──────────────────────────────────────────────────────────────────────── (data-testid=ai-account) ┐
| │  ●  Collegato con l'accesso di Claude Code                                       [Prova la connessione] │
| │     nome@example.org · piano Pro                                                 ✓ Funziona · 1,2 s      │
| │     Claude Code 2.x trovato automaticamente                                                             │
| │  ───────────────────────────────────────────────────────────────────────────────────────────────────── │
| │  Usa   ( Automatico | Accesso di Claude Code | Chiave API )                                             │
| │        Automatico: la chiave API se è salvata, altrimenti l'accesso di Claude Code.                     │
| │  [Cambia account…]   (Esci da Claude Code…)                                                             │
| │  ───────────────────────────────────────────────────────────────────────────────────────────────────── │
| │  Chiave API Anthropic   Non salvata · conservata solo nell'archivio sicuro di Windows   [Aggiungi chiave…] │
| │  ───────────────────────────────────────────────────────────────────────────────────────────────────── │
| │  Uso di questo mese · libreria «Tesi»   0,42 $ su 5,00 $   ▓▓░░░░░░░░ 8%   37 invii   (Vedi il registro) │
| │  (Calcola il totale di tutte le librerie)                                                               │
| └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
| COSA PUÒ LEGGERE CLAUDE        □ Tutta la libreria  □ File nella radice  ▸ ☑ Capitolo 1  ▸ □ Riservato      |
| MODELLO E SPESA                Modello predefinito [Haiku 5.5 ▾]   Ragionamento [Basso ▾]                    |
|                                Tetto mensile [ 5,00 ] $      [■■] Chiedi conferma con anteprima prima di inviare |
| ▸ REGISTRO DEGLI INVII                                                                                      |
+------------------------------------------------------------------------------------------------------------+
```

- Riquadro `Card` con `--e-1`; il puntino di stato 10 px: `--success` collegato, `--warning` collegato ma con avviso (es. chiave salvata ma non usata), `--danger` non collegato; la frase di stato `--fs-heading`. L'identità viene solo da `claude auth status` (mai da file di credenziali). Barra dell'uso 6 px `--r-pill`: `--accent`, `--warning` sopra l'80%, `--danger` al 100%.
- Stati: *non collegato* → frase "Non collegato" + [[Accedi con Claude Code…]] + (Usa una chiave API); *CLI non trovata* → "Claude Code non è installato o non è stato trovato" + (Scegli il programma…) che porta ad Avanzate › Claude; *login in corso* → riga "Completa l'accesso nella finestra di Claude Code…" con spinner e [Ho finito, verifica]; *prova fallita* → riga `--danger` con il motivo tradotto.

### 4.8 Impostazioni › Sviluppatore / Avanzate

```
+------------------------------------------------------------------------------------------------------------+
| Sviluppatore / Avanzate                                                                                    |
| Queste opzioni non servono per l'uso normale. Cambiarle può rendere l'app più lenta o meno sicura.         |
| ┌ Valori diversi dal predefinito (3) ────────────────────────────────────────────────────────────────────┐ |
| │ Eseguibile di Claude Code: scelto a mano  (Ripristina)  ·  Porta MCP: 41234 (Ripristina)  ·  …          │ |
| └────────────────────────────────────────────────────────────────────────────────────────────────────────┘ |
| ┌ Chiavi salvate (archivio sicuro) ───────────────────────────────────────────────────────────────────────┐ |
| │ Anthropic   salvata     [Sostituisci…] (Rimuovi)   ·  OpenAlex  non salvata [Aggiungi…]  ·  Gemini  …  │ |
| └────────────────────────────────────────────────────────────────────────────────────────────────────────┘ |
| ▸ Claude: fornitore, eseguibile, modelli e prezzi, soglia di conferma dei lavori in blocco                 |
| ▸ Server MCP per Claude Code: attiva, scrittura, porta, configurazione, nuovo token, registro              |
| ▸ Scansione: estensioni, solo per nome, giorni prima di dimenticare i mancanti, cartella dati, ricostruisci indice |
| ▸ Annotazioni nel PDF: posizione e spazio delle copie degli originali, elimina le copie, ripristina tutti   |
| ▸ Servizi online: (la chiave è sopra) · invii a OpenAlex                                                   |
| ▸ Esportazione: preset                                                                                     |
| ▸ Sperimentale: fornitore Gemini (non ancora disponibile)                                                  |
| ▸ Manutenzione e diagnostica: dimensioni, pulizia, log, diagnostica, memoria, processi, limiti (sola lettura), id dispositivo |
+------------------------------------------------------------------------------------------------------------+
```

Ogni gruppo è un `<details>` chiuso (si apre se la ricerca o la tavolozza punta lì); gli stati usano `KeyValue` (Z1).

### 4.9 Scansione

Passo "Prima scansione" della procedura guidata (`wizard-scan`):

```
+--------------------------------------------------------------+
| Passo 7 di 7 · Prima scansione                               |
| Sto leggendo la cartella della libreria.                     |
|  ✓ Elenco dei file           412 file                        |
|  ✓ Impronte                  412 / 412                       |
|  ⟳ Estrazione del testo      120 / 400   ▓▓▓▓░░░░░░  30%     |
|  ○ Indice                                                    |
| Puoi chiudere: la scansione continua e la vedi in alto.      |
|                      [Continua in background]  [[Apri la libreria]] (attivo alla fine) |
+--------------------------------------------------------------+
```

A fine scansione: "Trovati 214 documenti · 3 non leggibili (si cercano per nome)". Il popover Scansione è la prima riga del popover Attività (§4.10); il chip ha questi stati:

| Stato (`data-state`) | Chip | Colore |
| --- | --- | --- |
| `idle` | `✓ Aggiornata · 14:32` | testo `--text-muted`, nessun fondo |
| `running` | anello di avanzamento 16 px + `Scansione · 45%` (fase in `data-phase`) | `--accent-text` |
| `idle` con novità non viste | `✓ Aggiornata · 3 nuovi` + puntino 8 px `--accent` | |
| `error` | `⚠ Scansione non riuscita` | fondo `--danger-soft`, testo `--danger` |
| altro lavoro in corso | il più importante nell'ordine: errore › scrittura PDF in attesa › scansione › lavoro AI › citazioni › backup › export › "Aggiornata" | come `running` |

### 4.10 Attività (centro notifiche)

```
                                                           ┌ Attività ─────────────────────────────── 400 ┐
                                                           │ IN CORSO                                       │
                                                           │ ⟳ Scansione · Estrazione del testo 120/400 ▓▓░ │
                                                           │                                    (Annulla)  │
                                                           │ ⟳ Proposte di Claude · 3 di 18 · ~0,02 $ (Annulla)│
                                                           │ DA GUARDARE                                    │
                                                           │ ⚠ PDF in attesa: «Titolo…» è aperto in un altro│
                                                           │   programma.                       [Riprova]  │
                                                           │ ⚠ Citazioni: nessuna rete (0 di 4)  [Riprova] │
                                                           │ RECENTI                                        │
                                                           │ ✓ Proposte pronte per 18 documenti  [Rivedi]  │
                                                           │ ✓ Backup · ieri 18:02           (Apri Backup) │
                                                           │ ─────────────────────────────────────────────  │
                                                           │ Ultima scansione · oggi 14:32                  │
                                                           │ +3 nuovi · 1 cambiato · 2 mancanti · 1 non leggibile │
                                                           │ (Mostra i nuovi) (I mancanti) (I non leggibili) │
                                                           │                              [Scansiona ora]  │
                                                           └────────────────────────────────────────────────┘
```

Popover 400 px, max 70% dell'altezza con scorrimento, `--e-2`; tre gruppi fissi (In corso, Da guardare, Recenti: al massimo 5, poi "Mostra tutte"); ogni riga 1-2 linee `--fs-small` con icona di stato 16 px colorata e un'azione. Le righe "Da guardare" restano finché non si risolvono o si chiudono (×). Il chip mostra un puntino rosso se "Da guardare" non è vuoto. Si apre con un clic sul chip o con la tavolozza ("Attività").

### 4.11 Procedura guidata e primo avvio (D-337)

Dialogo 640 × fino a 640 px, `--r-lg`, `--e-3`; intestazione "Passo 3 di 7 · Dettagli" (`wizard-step-title`), corpo, piede fisso con (Annulla) a sinistra (pulsante terziario, non link: W4) e [Indietro] [[Avanti]] a destra. Passi: Benvenuto e lingua › Cartella (riquadro del percorso abbreviato al centro, 12 px di spazio, [Scegli un'altra cartella…] sotto; "Opzioni avanzate" chiuse con la cartella dati) › Dettagli (nome della libreria, lingua dei documenti, il tuo nome facoltativo) › Tag di partenza ((Salta)) › Claude (cartelle; frase "Finché non abiliti una cartella non viene inviato nulla", nessuna casella obbligatoria) › Riepilogo (con l'interruttore "Salva le evidenziazioni anche dentro i PDF", acceso e spiegato: completare vale come consenso, D-348) › Prima scansione. Clic minimi fino alla libreria: 7.

Dopo la procedura: al posto della carta di benvenuto (W5), un riquadro "Per iniziare" nel `banner-slot` alto al massimo 96 px con tre voci a spunta automatica (Apri un PDF e prova Evidenzia · Chiedi qualcosa a Claude · Imposta un backup) e una sola (Chiudi). Il testo segnaposto "Questa sezione arriverà in una fase successiva" sparisce dal codice (W4).

### 4.12 Pannello Claude

- Intestazione 48 px: "✦ Claude", stato (`status-ai`: puntino + "Pronto · Haiku 5.5"), (Conversazioni) (ex Cronologia), (Nuova), ×.
- Compositore in fondo: campo 3-8 righe; sotto una riga di 32 px con due chip-menu `(Haiku 5.5 ▾)` `(Ragionamento: basso ▾)` e il pulsante primario Invia ↑ 32×32 (tooltip "Invia · Invio; a capo · Maiusc+Invio") (C1). "Questo mese: 0,42 $" `--fs-caption` a sinistra nella stessa riga.
- Anteprima in linea (C2, D-339): dopo la prima conferma, sopra il campo una riga `--surface-2` "Partirà: la domanda + 3 documenti (Capitolo 1) · ~0,01 $ (Dettagli)"; se l'insieme cambia, torna il dialogo di conferma.
- Blocchi degli strumenti (C3): icona + etichetta tradotta per strumento (`search_library` → "Ricerca nella libreria"), riassunto tradotto ("'documento' · 0 risultati"), dettagli tecnici chiusi.
- Dialoghi lunghi (C4): `Dialog` con corpo scorrevole e piede fisso; "Proponi con Claude" senza cartelle abilitate non si apre: toast con azione "Abilita le cartelle" → Impostazioni › Claude.

### 4.13 Viste secondarie (D-344)

- **Progetti:** intestazione di vista "Progetti" con [[+ Nuovo progetto]]; elenco a righe 56 px (nome, tipo, documenti, ultima modifica); creazione in un popover con nome e `Segmented` Progetto/Collezione con una frase sotto ciascuno ("Progetto: documenti, note e piano di lettura"; "Collezione: solo un insieme di documenti"). Dettaglio: briciole "Progetti › Nome", un badge di stato, azioni a destra (Esporta come secondo cervello… nel ⋯); progetto vuoto: `EmptyState` con [[Aggiungi documenti…]] (apre la Libreria con una barra "Scegli i documenti per «Nome»" e [[Aggiungi N]]).
- **Scopri:** schede sotto l'intestazione, filtri (Ambito, Minimo di documenti citanti) in una riga sotto, chiusa se non usata; stati vuoti con [[Aggiorna le citazioni]] e la spiegazione.
- **Mappa:** progetto completo in §4.20 (D-367).
- **Tassonomia** (sottovista "Libreria › Tag"): albero a sinistra, editor del nodo a destra a sezioni (Nome e colore aperta; Nomi alternativi, Relazioni, Unisci e ritira chiuse), colori come 12 pallini 20 px in una griglia 6×2.


### 4.14 Scheda del documento (D-355)

```
+------------------------------------------- 360 ---+
| Scheda                                    [⋯] [×] |
| Titolo del paper su due righe al massimo           |
| Autore A, Autore B · 2021 · Rivista                |
| [[Leggi]] [✦ Chiedi a Claude] [⋯]                  |  ⋯: Apri con il programma predefinito, Mostra nella cartella,
| Stato   (Da leggere | In lettura | Letto)          |     Proponi con Claude…, Aggiorna citazioni, Esporta…
| Tag     [Ottica ×] [+ Tag]                         |
| ┃✦ Generato dall'AI · Descrizione   (Rivedi)       |  (riga sola se vuoto: "Nessun contenuto AI · Proponi…")
| ▸ Dati del documento              (Modifica i dati)|  chiusa: KeyValue in lettura; "Modifica i dati" apre i campi
| ▸ Note sul file                                    |
| ▸ Citazioni · 12 in libreria · 30 in totale        |  un clic: elenco dalla cache; (Aggiorna) a parte
| ▸ Simili nel contenuto · 5                         |
| ▸ File · Capitolo 1/paper-1.pdf · 1,8 MB           |  KeyValue
+---------------------------------------------------+
```

- Vista di lettura: titolo `--fs-heading`, metadati `--fs-small`, un primario "Leggi"; le sezioni chiuse sono righe di 36 px con conteggio; la sezione aperta si ricorda per la sessione.
- "Modifica i dati": i campi di oggi (Titolo, Autori, Anno, Rivista, DOI, arXiv) in due colonne, salvataggio automatico (§6.4), "I tuoi dati prevalgono su quelli letti dal file" / "Your edits take priority over the data read from the file".
- Citazioni (N6): un clic apre l'elenco dalla cache; "Aggiorna" è un pulsante della sezione; offline: spiegazione in una riga ("Le citazioni arrivano da OpenAlex con il DOI del documento. (Perché?)") e **sotto** l'errore `--warning` con [Riprova].
- Simili (N5): sottosezioni "Molto simili" e "Simili nel contenuto, diversi nelle parole" / "Very similar" e "Similar in content, worded differently"; chip con tooltip ("70%: quanto è simile", "testo: trovato confrontando il testo"); il titolo apre la scheda di quel documento, "Leggi" il lettore.
- Larghezza 360; a 1280 px con Cartelle/Tag aperto la scheda si sovrappone (cassetto da destra) invece di nascondere il pannello (N3); mai affiancata al pannello Claude sotto 1600 px (D-363).

### 4.15 Esportazione (D-356)

Dialogo 880 × max 90% della finestra: intestazione fissa (titolo, ×), corpo scorrevole, **piede fisso** con [Annulla] e [[Esporta]]. Corpo: destinazione (percorso abbreviato una volta, (Cambia cartella…)), nome, preset, opzioni; avviso sui documenti non abilitati a Claude **una volta**, nel corpo, come `Banner` avviso. Dopo [[Esporta]], se serve conferma, il piede diventa "Ci sono 2 documenti non abilitati a Claude. [Annulla] [[Esporta comunque]]" e il fuoco va su "Esporta comunque" (N7); Esc chiude sempre il dialogo (gestore sul contenitore, fuoco mai su `body`). Risultato nel corpo con `KeyValue` (documenti, note, annotazioni, file copiati), "Dimensione per un assistente AI: piccola (circa 1 100 token)" con tooltip, e nel piede [Mostra la cartella] [Esporta di nuovo] [[Chiudi]] della stessa taglia.

### 4.16 Backup e ripristino (D-356)

- Backup: titolo di sezione "Backup" una volta; stati di §4.6; "Backup automatici da conservare" sempre attivo con aiuto "vale quando il backup automatico è acceso" (N11); elenco dei backup in righe 48 px: data, dimensione, esito della verifica, [Verifica] [Ripristina…] e ⋯ (Apri il file, Rimuovi…).
- Ripristino: dialogo 640 × max 90%, piede fisso; scelta della cartella con avviso immediato sotto il campo se non è vuota o è la radice di una libreria ("Scegli una cartella vuota: il ripristino crea una libreria nuova"), [[Ripristina]] disattivato con il motivo accanto; avanzamento; risultato dentro il riquadro: "Libreria «Tesi (ripristinata il 17/11/2026)» creata. Le tue impostazioni attuali sono state mantenute." con [[Apri la libreria ripristinata]] [Chiudi]; il consiglio "togli dall'elenco la libreria che non vuoi più" diventa l'azione (Gestisci librerie…).
- Ascoltatori `rl:event` della sezione tolti allo smontaggio (N12).

### 4.17 Avanzate: MCP e scorciatoie

- **Server MCP** (N13) in Avanzate › Server MCP: interruttore "Server per Claude Code" con una frase; stato in `KeyValue` (indirizzo, porta, ultime chiamate); campo porta 96 px; avviso sulla porta come `Banner` con un'azione ("Usa una porta automatica"); "Strumenti disponibili" in un `<details>` chiuso con i nomi tecnici; nessun maiuscolo continuo fuori dalle etichette di gruppo; "Proporre campi" (scrittura) con la conferma di oggi.
- **Scorciatoie** (N14): colonne a larghezza fissa (comando flessibile, tasto 160 px, azioni 40 px) così la registrazione non sposta la tabella; durante la registrazione la cella del tasto mostra "Premi i tasti… · Esc annulla" nello stesso spazio; in fondo [Annulla le modifiche] (torna allo stato all'apertura della sezione) e (Ripristina tutte).

### 4.18 Funzioni da non perdere (attacco B.8)

| Funzione di oggi | Dove sta nel progetto |
| --- | --- |
| Riga della sintassi di ricerca | pulsante "?" nel campo di ricerca con la sintassi in un popover; con il campo vuoto e il fuoco, la sintassi compare sotto il campo come suggerimento; nella guida |
| Note di pagina, del file, tutte | scheda Note del lettore con `Segmented` Pagina · File · Tutte |
| Icone di riga Leggi / Apri il file / Mostra nella cartella | riga attiva: [Leggi] [Scheda] [⋯]; ⋯ = Apri con il programma predefinito, Mostra nella cartella, Aggiungi al progetto…, Proponi con Claude… |
| Barra di stato: indice, cartelle abilitate, lingua dei documenti | "Indice: 214 documenti · aggiornato 14:32" nella sezione Scansione del popover Attività; cartelle abilitate nell'intestazione del pannello Claude; lingua dei documenti in Impostazioni › Libreria e nella scheda |
| Scheda "Filtri" con sette facet e conteggi (Tag, Autori, Tipi, Riviste, Stato di studio, Anni, Cartelle); tag inclusi con "tutti / almeno uno" ed esclusi (`FilterBar.tsx`) | riga dei filtri `Stato ▾ Tipo ▾ Anno ▾ Rivista ▾ Autori ▾ Tag ▾` con i conteggi in ogni menu e ricerca interna; Tag con tre stati per voce (nessuno → includi ✓ → escludi ⊘) e "Tutti / Almeno uno"; Cartelle nel pannello di sinistra; sotto 1280 px Rivista e Autori in "⋯ Altri filtri" (D-369) |
| Includi sottocartelle | casella in fondo al pannello Cartelle |
| Esportazione da un cluster della mappa | menu ⋯ del cluster |
| Modello e ragionamento nella cartella di arrivo | due chip nella barra di Da rivedere: "Modello per le proposte sui file nuovi" (N22) |
| "Proponi di nuovo" e i campi del dialogo dei lavori AI | invariati nel dialogo a piede fisso |
| Registrazione delle scorciatoie con conflitti | invariata, più "Annulla le modifiche" |
| Seme della mappa | menu "Opzioni del modello" |

### 4.19 Stati da disegnare (attacco B.12)

| Dove | Stato | Cosa si vede |
| --- | --- | --- |
| Lettore | PDF danneggiato o non apribile | `EmptyState` "Questo PDF non si apre" con il motivo, [Apri con il programma predefinito], [Mostra nella cartella] |
| Lettore | PDF con password di apertura | "Questo PDF è protetto da password: aprilo con il programma predefinito"; strumenti assenti |
| Lettore | PDF senza testo (scansione) | barra con gli strumenti attenuati e il tooltip "Questo PDF non contiene testo selezionabile: evidenziare non è possibile"; nota di pagina disponibile |
| Lettore | file mancante sul disco | "Il file non c'è più in «Capitolo 1/…»" con [Mostra i mancanti] |
| Scrittura PDF | ogni motivo di rifiuto | frase di §8.3.5 nel chip ⓘ e nella scheda Info |
| Account | CLI non installata; CLI senza `auth`; offline durante la prova | §4.7; "Sei offline: la prova non è partita" |
| Da rivedere | vuota | `EmptyState` "Tutto fatto" con [+ Aggiungi PDF] |
| Da rivedere | metadati non trovati offline | riga `--warning` con [Riprova] (I2) |
| Impostazioni | ricerca senza risultati | "Nessuna impostazione per «…»" + (Cerca nella guida) |
| Impostazioni | "Valori diversi dal predefinito" vuoto | riga "Tutto ai valori predefiniti" |
| Impostazioni | errore di salvataggio automatico | sotto il campo `--danger` "Non salvato: <motivo>" con [Riprova]; il valore resta nel campo |
| Backup e ripristino | cartella non vuota, riuscito, omonime | §4.16 |
| Primo avvio | sistema in inglese | procedura guidata in inglese (D-357) |

### 4.20 Mappa: bella da guardare, divertente da esplorare (D-367)

Richiesta dell'utente: "The graph network should be nice and fun to look and play with". Oggi (`views/network/**`, 3077 righe, D-245): **canvas 2D** scritto a mano, nessuna libreria di grafi; scheda Mappa = punti con disposizione calcolata nel main (vettori TF-IDF, cluster a più livelli, fino a 60 000 documenti, D-243/D-249) disegnati come un percorso per colore con esclusione fuori vista e griglia per i clic; scheda Rete = rete espandibile (documento, cartella, tag; archi simile/cita/tag/contiene) con un passo di forze incrementale O(n²) e al massimo 800 nodi (`forceSim.ts`); Esplora e Vicini inattesi come elenchi. Si resta su **canvas 2D senza dipendenze** (d3-force + d3-quadtree costerebbero ~20 KiB minificati per ciò che si scrive in ~4 KiB; WebGL/sigma.js ~120 KiB non serve sotto le decine di migliaia di punti): tutto nel chunk pigro della vista.

Schede (D-384, supera D-362): **Panorama** (la mappa dei punti, ex Argomenti), **Collegamenti** (la rete, con il modo Documenti · Tag · Argomenti · Autori di §4.21; ex Citazioni), **Esplora**, **Vicini inattesi**.

```
+--------------------------------------------------------------------------------------------------------------+
| Mappa  214 documenti · 9 argomenti                                                        [[Aggiorna la mappa]]  [⋯] |
| ( Panorama | Collegamenti | Esplora | Vicini inattesi )                                                                  |
| [⌕ Vai a un documento…]  [Anni 2015 ━━●━━━●━ 2024]  [Tag ▾]                                       [✧] [✦?] [⤢]  |   ← una riga: filtri a sinistra, Mescola · Sorprendimi · Adatta come IconButton (D-377)
+----------------------------------------------------------------------------------------------+---------------+
|            ╭─ Ottica ────────╮                    ╭─ Reti neurali ──────╮                      | Scheda del    |
|           ·  ●   ●·  ●        ·                 ·   ◉ ←hover            ·                     | nodo (360)    |
|          ·  ●  ●   ●   ●       ·       ~~~~~~~~·  ●   ●  ┌───────────────────────┐             | Titolo        |
|           ·   ●  ●  ●         ·      archi curvi  ● ●  ● │ Titolo del paper      │             | Autori · anno |
|            ╰─────────────────╯       e sfumati     ●     │ Autore A, B · 2021    │             | [[Leggi]]     |
|                     ╭─ Serie temporali ─╮                │ Ottica · 12 citazioni │             | Vicini (8)    |
|                    ·  ●  ●   ●  ●       ·                └───────────────────────┘             | ...           |
|                     ╰───────────────────╯                                        ┌──────────┐ |               |
|                                                                                  │ minimappa│ |               |
|                                                                                  │  [▭]     │ |               |
|                                                                                  └──────────┘ |               |
+----------------------------------------------------------------------------------------------+---------------+
```

**Stile (chiaro e scuro)**
- Fondo `--bg`; una leggera griglia di punti `--border` ogni 32 px dello schermo che segue la panoramica (dà il senso del movimento), disattivata sopra 5000 punti visibili.
- **Colore dei nodi per argomento** (cluster del livello corrente; nella scheda Citazioni per argomento del documento, cartelle e tag con forme diverse): tavolozza categorica `--cat-1..10` definita in `tokens.css`, ogni tinta ≥ 3:1 sul fondo in entrambi i temi (test), più grigio `--text-muted` per "senza argomento". Chiaro: `#3E63DD #1F9D6B #D9822B #8E4EC6 #D6409F #0F9FB0 #B5A000 #E5484D #5B6B8C #6E56CF`; scuro: le stesse schiarite del 20% in OKLCH (calcolate e fissate nei token).
- **Dimensione** per importanza: raggio `4 + 10·√(g/gmax)` px dello schermo con `g` = grado nella rete o citazioni nella libreria (scelta nel ⋯ "Dimensione per": collegamenti | citazioni | uguale); bordo 1,5 px `--bg` per staccare i nodi sovrapposti.
- **Archi** curvi (curva quadratica con freccia di 0,15 della lunghezza, sempre dallo stesso lato) e **assottigliati** (larghezza da 2,5 px all'origine a 0,8 px alla fine, un triangolo curvo riempito: si legge la direzione delle citazioni senza frecce); opacità `0,12 + 0,5·peso`; colore del nodo di origine mescolato al 50% con `--text-muted`. Sopra 3000 archi visibili: linee dritte da 1 px e opacità fissa.
- **Alone al passaggio:** sprite di un gradiente radiale per colore, disegnato una volta su un canvas fuori schermo e riusato; il nodo sotto il puntatore cresce del 25% (120 ms) e i vicini si illuminano.
- **Involucri degli argomenti:** inviluppo convesso dei punti di ogni cluster allargato di 16 px con angoli arrotondati (curve di Chaikin, 2 passaggi), riempimento del colore al 7% e contorno al 25%; etichetta dell'argomento al baricentro, `--fs-small` 600 con alone del fondo (testo con tratto 3 px `--bg`). Sotto il livello di zoom in cui i punti si separano, si vedono solo involucri ed etichette.
- **Etichette con livello di dettaglio:** a zoom basso solo le etichette degli argomenti; aumentando lo zoom le etichette dei nodi più grandi che non si sovrappongono (griglia di collisione 1 cella = 120×20 px, priorità per dimensione); al passaggio e per i nodi selezionati sempre; testo troncato a 32 caratteri con alone.
- `prefers-reduced-motion`: nessuna inerzia, nessuna animazione di zoom o di filtro, la simulazione si assesta fuori schermo e si disegna il risultato.

**Movimento e gioco**
- **Zoom e panoramica fluidi:** rotella e pizzico del touchpad centrati sul puntatore con interpolazione verso lo zoom obiettivo (`k += (target − k)·0,25` per frame); trascinamento con **inerzia** (velocità che decade di 0,92 per frame, stop sotto 0,05 px); doppio clic sul vuoto = zoom ×2 animato; `⤢ Adatta` riporta tutto in vista (600 ms, `--ease`).
- **Simulazione viva** nella scheda Citazioni: forze di molla sugli archi (lunghezza 60 px del mondo, rigidità per peso), repulsione con approssimazione di **Barnes-Hut** su un quadtree (θ = 0,9), gravità verso il centro dei componenti, smorzamento; "temperatura" `alpha` che decade da 1 a 0,001 in ~300 passi e poi la simulazione **si ferma** (nessun ciclo di animazione a riposo). Trascinare un nodo lo tiene fermo e riscalda leggermente (`alpha = 0,3`): i vicini lo seguono come elastici; al rilascio il nodo resta **fissato** (puntina disegnata accanto) e un clic sulla puntina lo libera; doppio clic su un nodo = **mette a fuoco il vicinato** (nodi oltre 2 passi al 12% di opacità, zoom animato sul vicinato; Esc o clic sul vuoto lo toglie).
- Nella scheda Argomenti i punti hanno coordinate fisse dal main; al primo disegno entrano con un'apparizione dal baricentro del loro argomento (400 ms, solo opacità e posizione) e i filtri li fanno **svanire e rimpicciolire** (240 ms) invece di toglierli di colpo.
- **Cartellino al passaggio** (dopo 150 ms fermi): titolo (2 righe), autori · anno, argomento, numero di citazioni nella libreria; `--surface`, `--e-2`, `--r-md`, 280 px, segue il nodo e non esce dalla vista. **Clic** = scheda del nodo nel pannello di destra (la stessa scheda del documento, §4.14, con in più "Vicini" e "Espandi"); il nodo resta evidenziato con un anello 2 px `--accent`.
- **Vai a un documento** (campo nella barra della vista, stessa ricerca dei titoli della tavolozza): Invio fa **volare** la camera sul nodo (interpolazione di centro e zoom, 700 ms, curva "zoom out poi in" quando la distanza è grande) e il nodo pulsa due volte.
- **Percorso:** Maiusc+clic su un secondo nodo evidenzia il percorso più breve (BFS sugli archi visibili) con archi spessi `--accent` e sbiadisce il resto; Esc lo toglie.
- **Vicini e attenuazione:** passando su un nodo i suoi archi e vicini restano al 100% e il resto scende al 35% (120 ms).
- **Filtri** per anni (cursore a due maniglie) e per tag (menu con chip): i nodi esclusi svaniscono; il numero "214 → 87 documenti" si aggiorna nel sottotitolo.
- **Minimappa** 160×120 in basso a destra (`--surface` al 90%, `--e-1`): tutti gli argomenti come macchie di colore, il rettangolo della vista trascinabile; si nasconde con il ⋯ e sotto 900 px di larghezza.
- **Azioni giocose:** `✧ Mescola` (Citazioni: posizioni casuali e simulazione riscaldata, i nodi si riorganizzano davanti agli occhi; Argomenti: riprende l'apparizione), `✦ Sorprendimi` ("Vicini inattesi" in primo piano: sceglie a caso una coppia simile nel contenuto ma lontana negli argomenti, vola su di essa, la evidenzia con un arco tratteggiato e un cartellino "Perché sono vicini: parole in comune …" dai motivi già calcolati).
- **Tastiera:** la tela ha il fuoco (`tabindex=0`, `role="application"` con `aria-roledescription="mappa"`); frecce = nodo più vicino in quella direzione (cursore visibile come anello tratteggiato), Invio = scheda, Maiusc+Invio = Leggi, +/− zoom, 0 Adatta, F o / = "Vai a un documento", P = fissa/libera, Esc = toglie fuoco o percorso; una regione `aria-live` annuncia il nodo corrente ("Titolo, 2021, Ottica, 8 vicini"); l'elenco Esplora resta l'alternativa accessibile.

**Prestazioni (criteri)**
- Argomenti: 60 fps in panoramica e zoom fino a 20 000 punti visibili su un portatile medio (punti come rettangoli 2×2 sotto una soglia di zoom, un percorso per colore, esclusione fuori vista già esistente); oltre: niente archi né aloni, etichette solo degli argomenti, ≥ 30 fps.
- Citazioni: passo di simulazione ≤ 4 ms con 800 nodi (Barnes-Hut, test di misura con margine in Vitest), disegno ≤ 8 ms; con più di 400 nodi la simulazione fa più passi per frame finché `alpha` è alto e poi uno; nessun Web Worker (non serve sotto il tetto di 800 nodi; se il tetto salisse, il passo della simulazione andrebbe in un worker che restituisce le posizioni in un `Float32Array` trasferito con `postMessage`).
- A riposo nessun `requestAnimationFrame` (si ridisegna solo su eventi): batteria e memoria invariate.

**Stati:** modello non costruito → `EmptyState` "Costruisci la mappa dei tuoi documenti" con [[Costruisci la mappa]] e la stima del tempo; Citazioni senza un punto di partenza → "Scegli un documento da cui partire" con il campo "Vai a un documento" e i 5 documenti più citati come chip; meno di 3 documenti → spiegazione con [+ Aggiungi PDF]; costruzione in corso → avanzamento per fasi nel corpo e nel chip Attività.

**Peso:** +12-16 KiB (con le aggiunte di D-379) nel chunk pigro della vista Mappa (quadtree e Barnes-Hut ~2, archi curvi e assottigliati ~1, involucri e Chaikin ~1, livello di dettaglio delle etichette ~1, camera con inerzia e volo ~1,5, minimappa ~1,5, cartellino, filtri animati e azioni ~3, tastiera ~1); nessun peso nella prima schermata.


### 4.21 Reti per tag, argomenti e autori (D-384 … D-388)

Richiesta dell'utente (dopo l'approvazione del prototipo P0): «The network should be implemented as both tags topics authors». Oggi la rete (`views/network/GraphNet.tsx`, `forceSim.ts`) ha nodi documento, cartella e tag con archi simile, cita, tag, contiene, espandibili da un punto di partenza; la mappa (`graph:map`) ha i cluster del modello a più livelli; Esplora (`explore:level/documents/related`, `packages/graph/src/explore.ts`) ha già le dimensioni `topic`, `author`, `venue` con la chiave d'autore normalizzata. Tutto resta; si aggiunge un modo di costruzione della rete.

**Schede della sezione Mappa (D-384):** **Panorama** (la mappa dei documenti colorata per argomento: la scheda giocabile che si apre per prima, ex "Argomenti") · **Collegamenti** (la rete, con il selettore del modo; ex "Citazioni") · **Esplora** · **Vicini inattesi**. Il nome "Argomenti" resta per il modo della rete, così non indica due cose.

**Un solo controllo per il modo:** nella riga sotto le schede di Collegamenti, a sinistra, un `Segmented` "Rete di: **Documenti · Tag · Argomenti · Autori**" (tasto `M` per passare al successivo; il modo si ricorda per libreria nella sessione). Il resto della riga (Vai a…, Anni, filtri del modo, Mescola · Sorprendimi · Adatta) non cambia posto.

```
| Mappa  214 documenti · 9 argomenti · 38 tag · 312 autori                         [[Aggiorna la mappa]]  [⋯] |
| ( Panorama | Collegamenti | Esplora | Vicini inattesi )                                                      |
| Rete di: (Documenti | Tag | Argomenti | Autori)   [⌕ Vai a…]  [Anni ━●━━●━]  [Almeno 2 documenti ▾]  [Legami ━━●] [✧][✦][⤢] |
+--------------------------------------------------------------------------------------------+-----------------+
|        ╭ Gruppo di A. Esempio ─╮              ●  B. Prova                                   | Autore          |
|       ·   ◎ Tu        ●        ·          ╱                                                 | Anna Esempio    |
|      ·  ●═════◉ A. Esempio ────●  C. Finta   ┌──────────────────────────────┐               | anche: A. Esempio|
|       ·      ●        ●       ·              │ Anna Esempio  (2 forme)      │               | 14 documenti    |
|        ╰──────────────────────╯              │ 14 documenti · 2016–2025 ▁▃▅▇▅ │             | [[Apri nella    |
|                                              │ Argomento: Serie temporali   │               |   Libreria]]    |
|                                              │ Coautori: B. Prova (6), …     │               | Documenti …     |
|                                              └──────────────────────────────┘               | Argomenti …     |
+--------------------------------------------------------------------------------------------+-----------------+
```

#### 4.21.1 I quattro modi

| Modo | Nodi | Archi (peso) | Colore | Dimensione | Involucri | Clic | Doppio clic |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Documenti** (oggi) | documenti, cartelle, tag (come oggi) | simile, cita, tag, contiene (come oggi) | argomento del documento (tinte stabili, D-379) | collegamenti o citazioni | argomenti | scheda del documento | vicinato |
| **Tag** | tag della tassonomia usati da almeno N documenti (livello: tutti, o solo i rami principali) | **co-occorrenza**: documenti che hanno entrambi i tag, forza `co / √(nA·nB)` (coseno); in più gli archi "implica" della tassonomia, tratteggiati e leggeri | colore del ramo principale (il colore che l'utente ha dato al nodo, se ha ≥ 3:1 sul fondo; altrimenti la tinta `--cat-*` più vicina) | √ documenti | rami principali della tassonomia | Libreria filtrata con il tag incluso (D-369) | "apre" il tag: i suoi documenti compaiono attorno come punti piccoli (vista bipartita), di nuovo per richiuderli |
| **Argomenti** | argomenti del modello al livello scelto (cursore "Livello 1 … L", come la mappa), etichetta di Claude o i tre termini principali | **affinità**: somma delle somiglianze tra documenti dei due argomenti normalizzata per le dimensioni + citazioni tra i due gruppi (cita vale 2) | tinta stabile dell'argomento (D-379) | √ documenti | argomento padre quando il livello > 1 | Libreria filtrata sui documenti dell'argomento (filtro `docIds`, oltre 500 con il filtro di argomento nuovo `topic` del modello) | scende di livello: l'argomento si divide nei sottoargomenti (zoom semantico, animato) |
| **Autori** | autori normalizzati (§4.21.2) con almeno N documenti nella libreria (predefinito 2) | **coautorialità**: numero di documenti in comune, forza `log(1 + co)`; facoltativo (⋯ "Mostra temi in comune") archi leggeri tra autori con lo stesso argomento principale che non hanno mai scritto insieme | argomento prevalente dei suoi documenti | √ documenti (o citazioni, ⋯ "Dimensione per") | comunità (propagazione delle etichette, 10 passi) con l'etichetta "Gruppo di <autore più centrale>" | Libreria filtrata con il facet Autori (tutte le forme del nome) | vicinato di coautori a due passi |

In ogni modo valgono stile, livelli di dettaglio, cartellino, volo, percorso più breve, filtri animati, minimappa, tastiera e movimento ridotto di §4.20 e §16.3; i nodi entità sono cerchi pieni, i documenti nella vista bipartita punti di 3-4 px senza bordo; il nodo dell'utente in modo Autori (nome e varianti del profilo) ha un anello `--accent` e l'etichetta "Tu".

**Passaggio tra i modi (divertente, non disorientante):** le posizioni iniziali vengono dal Panorama — un tag o un argomento nasce nel baricentro dei suoi documenti, un autore nel baricentro dei suoi —, quindi cambiando modo i punti "volano" verso il loro nodo (300 ms, solo trasformazioni) e la simulazione si assesta da lì; con il movimento ridotto il cambio è immediato. La camera tiene il centro.

**Sorprendimi per modo:** Tag → la coppia con co-occorrenza molto più alta dell'attesa ma in rami diversi ("Ottica e Statistica compaiono insieme in 7 documenti"); Argomenti → due argomenti lontani nel Panorama con una citazione o una somiglianza forte tra i loro documenti; Autori → due autori con lo stesso argomento e molte citazioni reciproche che non hanno mai scritto insieme ("Potrebbero conoscersi"). Ogni frase dice il motivo con i numeri.

#### 4.21.2 Autori: normalizzazione e omonimie

- Chiave come in Esplora (`packages/graph/src/explore.ts`): cognome + iniziale del nome, senza accenti e maiuscole, "Cognome, Nome" e "Nome Cognome" uguali; il nome mostrato è la forma più completa e più frequente.
- Se una chiave raccoglie nomi propri diversi (es. "Anna" e "Andrea" con la stessa iniziale), il cartellino dice "Possibile omonimia: 2 forme del nome" e la scheda le elenca con il numero di documenti; un ORCID diverso nei dati del documento (quando presente) separa sempre.
- Correzioni dell'utente: nella scheda dell'autore "Separa queste forme" e "Unisci con…" scrivono `<dataDir>/graph/author-aliases.json` (sincronizzato, scrittura atomica, regola 2), letto dalla costruzione e da Esplora; nessuna modifica ai metadati dei documenti.
- Lavori con moltissimi autori (oltre 25 per documento: consorzi): contano per ogni autore ma **non** creano archi di coautorialità (altrimenti un solo documento collega tutto); la legenda lo dice.

#### 4.21.3 Limiti, filtri e prestazioni

- Contratto nuovo (agente principale): `graph:entityNetwork { mode: 'tag' | 'topic' | 'author', level?, scope? (come graph:map), years?: [from, to], minDocs = 2, minWeight = 0, limit = 800 } → { nodes: [{ id, label, count, years: number[10], colorKey, group, variants? }], edges: [{ a, b, w, n }], total: number, truncated: boolean }`, calcolato nel main (worker del grafo) dai record e dal modello, in cache per versione del modello e della libreria; gli id sono quelli di Esplora (`author:<chiave>`, nodo di tassonomia, cluster) così "Correlati" (`explore:related`) funziona dalla scheda dell'entità.
- Tetto 800 nodi (i più grandi) e al più 8 archi per nodo (i più pesanti, unione dei due lati): ≤ 3 200 archi. Sottotitolo "800 di 3 120 autori"; cursore "Almeno N documenti" e cursore "Legami" (peso minimo) nella riga dei filtri; i nodi tagliati si raggiungono con "Vai a…" (il volo aggiunge il nodo e i suoi vicini).
- Filtri del modo nella stessa riga: Anni (contano solo i documenti nel periodo), ambito (cartella, progetto, tag come `graph:map`), e in Autori e Argomenti "Tag ▾".
- Prestazioni: gli stessi obiettivi di §4.20 (passo Barnes-Hut ≤ 4 ms a 800 nodi, ≥ 55 fps); costruzione nel main ≤ 1,5 s per 10 000 documenti (prova sotto `RL_HEAVY_TESTS=1`), coppie per documento limitate (30 tag, 25 autori).

#### 4.21.4 Cartellino e scheda dell'entità

- Cartellino: nome (e "anche: …" per le varianti), numero di documenti, anni con un istogramma di 10 barre (`--accent` al 60%), argomento o ramo, i tre collegamenti più forti con il numero ("Coautori: B. Prova (6)", "Spesso con: Laser (9)").
- Scheda nel pannello di destra (stesso `DetailPanel`): titolo, conteggi, [[Apri nella Libreria]] (filtro del modo), elenco dei documenti (virtuale, ordinato per anno, clic = scheda del documento, "Leggi"), "Correlati" dalle altre dimensioni (`explore:related`: per un autore i suoi argomenti e tag; per un tag gli autori e gli argomenti), e per un autore "Separa"/"Unisci con…".

#### 4.21.5 Stati vuoti e accessibilità

- Tag senza tag: illustrazione "mappa da costruire" + "Non ci sono ancora tag" [[Gestisci tag]] (Proponi tag con Claude…). Argomenti senza modello: [[Costruisci la mappa]]. Autori senza autori nei dati: "I documenti non hanno autori" [Completa i dati] (Da rivedere) e (Aggiorna le citazioni). Meno di 3 nodi dopo i filtri: "Allarga i filtri" con [Togli i filtri].
- Tastiera: `M` cambia modo, il resto come §4.20; l'annuncio dice tipo e numeri ("Autore Anna Esempio, 14 documenti, 5 coautori"); `L` apre Esplora sulla stessa dimensione (Tag → la tassonomia nell'elenco di Esplora, Argomenti → `topic`, Autori → `author`).
- Movimento ridotto: niente volo tra i modi né apertura animata dei tag, la simulazione si assesta fuori schermo.

#### 4.21.6 Peso e prove

- Renderer: +5-7 KiB nel chunk pigro della Mappa (selettore del modo, stili dei nodi entità e della vista bipartita, cartellino e scheda dell'entità, passaggio animato, Sorprendimi per modo). Main: +4-6 KiB (`packages/graph/src/entity-network.ts`, alias degli autori, gestore del canale).
- Prove: unitarie per la costruzione (pesi di co-occorrenza e coautorialità, consorzi esclusi dagli archi, unione e separazione degli autori, alias, tetto e top-k, anni), per la colorazione dei tag (colori dell'utente sotto 3:1 → tinta vicina) e per la propagazione delle etichette; e2e `network.spec.ts`: cambio dei quattro modi, cartellino di un autore, clic che apre la Libreria con il filtro dell'autore, doppio clic su un tag che apre i documenti, `M` e movimento ridotto; prova di costruzione con 10 000 documenti sintetici in `test:e2e:heavy`.

### 4.22 Mappa semplificata (giro 6)

Corregge Z2, Z3, Z4, Z5, Z24 dell'audit finale (T2, solo `views/network/**`). Riferimento: P0 (`P0-map-light-1280x800.png`, 12 controlli). Prevale su §4.20 e §4.21 dove li contraddice; stile, movimento, quattro modi e prestazioni restano quelli. Principio: **una riga sola sopra una tela a tutta altezza**; quello che non si usa a ogni visita sta in un chip con popover o nel `⋯`; avvisi e conteggi sono sovrapposti alla tela, mai paragrafi che la spingono giù.

**Composizione (tutte le schede)**

```
| Mappa  220 documenti · 7 argomenti · aggiornata il 19 nov, 00:57          [[Aggiorna la mappa]]  [⋯] |  ← primario solo se manca o è vecchia
| (Panorama|Collegamenti|Esplora|Vicini inattesi) [Rete di: Autori ▾] [⌕ Vai a…] [Filtri ▾]   [✧][✦][⤢] |  ← una riga; ✧ ✦ ⤢ solo nelle schede con la tela
+-------------------------------------------------------------------------------------------------------+
| (pillola di stato, in alto a sinistra)                                                                |
|                       tela a tutta altezza (≥ 70 % della finestra a 1280×800)                          |
| [legenda sovrapposta, in basso a sinistra, 240 px]                              [minimappa 160×120]  |
+-------------------------------------------------------------------------------------------------------+
```

- **Intestazione:** titolo + sottotitolo + al più un pulsante + `⋯`. Sottotitolo: conteggi e "aggiornata il …" con `Intl.DateTimeFormat` (`dateStyle: 'medium', timeStyle: 'short'`), senza punto né seme; "vecchia" = "12 documenti nuovi · [[Aggiorna la mappa]]" (primario, `graph-build`); aggiornata = **nessun pulsante** ("Ricostruisci" è nel `⋯`); in costruzione = fasi + `Annulla` (`graph-cancel`); modello assente = nessun pulsante in testa (il solo primario è nel corpo, `graph-build-empty`).
- **Seme** fuori dalla testa: `⋯` › "Opzioni del modello…" apre un dialogo (Seme `graph-seed`, livelli, [[Ricostruisci]] `graph-build-options`). Il seme resta solo in `data-seed` di `map-info`.
- **Schede** come `Segmented` a sinistra della riga (P0), `role=tab`, testid `net-tab-*` invariati. La riga è la stessa in ogni scheda con la tela: cambiano solo i chip.
- **Un solo `⋯`**, nell'intestazione, con le voci della scheda e del modo correnti; testid secondo il contesto: `map-more` (Panorama), `net-more` (Collegamenti › Documenti), `ent-more` (Tag, Argomenti, Autori), `map-more` anche in Esplora e Vicini (solo il gruppo del modello).
- **Pillola di stato** (`.map-pill`, una alla volta, priorità: scelta del ponte › nota del ponte › Sorprendimi › filtri attivi › tetto o omessi › suggerimento del primo uso): sostituisce `map-surprise-note`, `map-timeline-label`, `map-bridge-note`, `map-omitted`, `net-note`, `ent-note`, `net-surprise-note`, `ent-surprise-note` (testid invariati sull'elemento della pillola), con al più un link e `✕`. Il conteggio della tela ("22 nodi", "7 argomenti · 220 documenti") va in `net-count`/`ent-count`, testo nella legenda.
- **Istruzioni:** il paragrafo di due righe sparisce; il suggerimento del primo uso è una pillola ("Trascina, rotella per lo zoom, doppio clic per aprire · ✕") mostrata una volta per installazione (`localStorage` in try/catch); i tasti sono nella pagina Mappa dell'Aiuto (F1).

**Controlli visibili per scheda e modo** (1280×800 e 1024×700; ⋯ conta 1)

| Zona | Prima | Dopo | Elenco |
| --- | --- | --- | --- |
| Modello assente (ogni scheda) | 7 (Costruisci ×2, Seme) | **6** | ⋯, 4 schede, [[Costruisci la mappa]] nel corpo |
| Panorama | 16 | **11** (10 aggiornata) | Aggiorna, ⋯, 4 schede, Vai a, Filtri ▾, ✧ ✦ ⤢ |
| Collegamenti › Documenti | 31 | **12** (11) | Aggiorna, ⋯, 4 schede, Rete di ▾, Vai a, Partenza ▾, ✧ ✦ ⤢ |
| Collegamenti › Tag · Argomenti · Autori | 22 | **12** (11) | Aggiorna, ⋯, 4 schede, Rete di ▾, Vai a, Filtri ▾, ✧ ✦ ⤢ |
| Esplora | 13 (4 disattivati) | **9**, 10 in profondità | Aggiorna, ⋯, 4 schede, Temi · Autori · Riviste; Indietro solo sotto la radice |
| Vicini inattesi | 6 + 2 link sottolineati per riga | **6** + righe | Aggiorna, ⋯, 4 schede |

**Cosa si sposta dove**

| Controllo di oggi | Dove va | Testid |
| --- | --- | --- |
| Seme, Ricostruisci | `⋯` › Opzioni del modello… (dialogo) · `⋯` › Ricostruisci la mappa | `graph-seed`, `graph-build-options`, `map-rebuild` (nuovo) |
| Ambito (2 select), Anni (2 cursori) | chip **Filtri ▾** (popover): Ambito, Anni; sezione "Aspetto": Colora per livello | `map-filters` (nuovo), `map-scope-kind`, `map-scope-value`, `map-years`, `map-year-from/to`, `map-level` |
| Etichetta i cluster con Claude | `⋯` › ✦ Etichette con Claude… | `map-label-clusters` |
| Esporta (link per riga della legenda) | `⋯` del cartellino del cluster: Esporta come secondo cervello…, Rinomina | `cluster-export` |
| Rete di (4 pulsanti) + "M cambia modo" | chip **Rete di: Documenti ▾**: menu a 4 voci radio, ognuna con una frase, `M` scritto a destra | `net-mode` (nuovo), voci `net-mode-<m>` |
| Parti dal documento / da cartella / da tag, Vicini, 6 caselle Espandi per | chip **Partenza ▾** (popover in due sezioni: "Parti da" documento scelto · cartella · tag; "A ogni espansione" vicini 10/25/50 + 6 chip a scelta) | `net-start` (nuovo), `net-start-doc/folder/tag`, `net-limit`, `net-kinds`, `net-kind-*` |
| Espandi, Comprimi, Rimuovi nodo | pannello del nodo: [Leggi] [Espandi] + ⋯ (Comprimi · Rimuovi dalla rete · Trova un ponte con…); doppio clic sul nodo resta "espandi" | `net-expand`, `net-collapse`, `net-remove` |
| Azzera, Libera i nodi fissati, Minimappa | `⋯` della vista | `net-reset`, `net-unpin-all`, `net-minimap-toggle` |
| Almeno N documenti, Legami, Livello, Rami | chip **Filtri ▾** (entità); il chip dice "Filtri · 2" se non predefiniti | `ent-filters` (nuovo), `ent-min-docs`, `ent-min-weight`, `ent-level`, `ent-tag-scope`, `ent-years` |
| Dimensione per, Mostra temi in comune | Filtri ▾ › sezione "Aspetto" (Segmented Documenti · Citazioni · Uguale; casella temi solo in Autori) | `ent-size-by`, `ent-themes-toggle` |
| Disponi per anno, Minimappa (Panorama) | `⋯` della vista | `map-timeline-toggle`, `map-minimap-toggle` |
| Trova un ponte | resta nel `⋯` del cartellino; la scelta del secondo nodo e il risultato sono pillole | `map-card-more`, `map-bridge-pick`, `map-bridge-note`, `map-bridge-close` |
| Legenda a destra (Panorama), legenda in riga (Documenti) | sovrapposta in basso a sinistra, 240 px, ≤ 8 righe + "altri N", ellissi con `title`, mai scorrimento orizzontale | `cluster-legend`, `cluster-item`, `net-legend` |

**Menu `⋯`** (≤ 7 voci, ≤ 3 gruppi): Panorama **6** · 3 = Opzioni del modello… · Ricostruisci la mappa ┃ Disponi per anno · ☐ Minimappa ┃ Esporta l'immagine · ✦ Etichette con Claude…; Documenti **6** · 3 = Azzera la rete · Libera i nodi fissati ┃ ☐ Minimappa · Esporta l'immagine ┃ Opzioni del modello… · Ricostruisci; entità **5** · 2 = Libera i nodi fissati · ☐ Minimappa · Esporta l'immagine ┃ Opzioni del modello… · Ricostruisci; Esplora e Vicini **2** · 1 = Opzioni del modello… · Ricostruisci. Rete di ▾ **4** · 1. Cartellino del nodo **1**; pannello del nodo (Documenti) **3**.

**Panorama: involucri che non si sovrappongono (Z3)**
- **Separazione dei gruppi:** ogni argomento è approssimato da un cerchio (baricentro, raggio = 80° percentile delle distanze); 60 passi di repulsione tra cerchi (distacco 24 px del mondo, spostamento rigido dei loro punti), poi 2 passi di collisione tra punti sul quadtree (distanza minima = diametro + 2 px). Calcolo una volta per disposizione, in cache, in `hulls.ts` (`separateClusters`) e `quadtree.ts`; sopra 5000 punti solo la separazione dei gruppi. La "Disponi per anno" non la usa.
- **Involucro dal nucleo:** inviluppo dei punti entro il raggio dell'80° percentile (i lontani non lo gonfiano), Chaikin come oggi.
- **A riposo:** riempimento solo dei gruppi che dopo la separazione non toccano altri nuclei e sono tra gli 8 più grandi: 5 % (scuro 8 %), **nessun contorno**; gli altri senza involucro, solo punti ed etichetta. **Al passaggio o a fuoco** (anche dalla legenda o con la tastiera): involucro del gruppo 12 % e contorno 1,5 px al 40 %, il resto al 35 %.
- **Nodi:** cerchi, raggio `3 + 3·√(c/cmax)` px dello schermo (6-12 px di diametro), anello 1,5 px `--bg`; mai quadratini sotto i 5000 punti visibili.
- **Etichette:** ogni argomento ha l'etichetta nel suo colore (testo con alone `--bg` 3 px), posta sopra il nucleo; anticollisione tra etichette di argomento provando sopra · sotto · destra · sinistra, poi si nasconde la più piccola fino allo zoom successivo; ≤ 12 argomenti = tutte visibili ad "Adatta". Titoli dei documenti solo da zoom ≥ 2,5, ≤ 30 alla volta, griglia di `labelsLod.ts`; tronca a 28 caratteri.
- **Minimappa:** `--surface` all'85 %, bordo `--border`, `--r-md`, macchie dei gruppi e rettangolo della vista; nascosta sotto 900 px e sotto 30 documenti.
- **Divertente:** ingresso di 400 ms (punti dal baricentro, poi l'assestamento della separazione visibile); con movimento ridotto si disegna il risultato.

**Collegamenti (Z2, Z24):** la tela prende tutta l'altezza; dopo ogni espansione o cambio di modo "Adatta" animato (400 ms); etichette con la stessa anticollisione e tutte visibili sotto i 30 nodi; cursori nei popover con `accent-color: var(--accent)`; la riga non va mai a capo (a 1024 "Vai a" diventa un'icona che si apre in campo, sempre 1 controllo).

**Stati vuoti (Z5): uno schema solo** — `EmptyState` **al posto** della tela o dell'elenco (la tela è `hidden`, mai sotto o sopra), con illustrazione "mappa da costruire", titolo, una frase col motivo, **un** primario, al più un link secondario.

| Caso | Titolo · motivo | Azione | Testid |
| --- | --- | --- | --- |
| Modello assente (Panorama, Argomenti, Esplora › Temi, Vicini) | Costruisci la mappa dei tuoi documenti · stima del tempo, nulla va online | [[Costruisci la mappa]] | `graph-empty`, `graph-build-empty` (in ogni scheda lo stesso) |
| Meno di 3 documenti | Servono almeno 3 documenti | [+ Aggiungi PDF] | `map-few` |
| Autori con filtri predefiniti < 3 nodi | nessuno stato: si abbassa una volta "Almeno N" a 1 e la pillola lo dice ("Mostro anche gli autori con 1 documento") | — | `ent-note` |
| Filtri dell'utente < 3 nodi | Nessun <autore/tag/argomento> con questi filtri · "con almeno 2 documenti ce ne sono 2" | [Togli i filtri] | `ent-clear-filters` |
| Tag assenti · autori assenti | Non ci sono ancora tag · I documenti non hanno autori | [[Gestisci tag]] · [[Completa i dati]] | `ent-empty-tags`, `ent-empty-review` |
| Esplora, dimensione vuota | Nessun tema: i temi vengono dai tag · Nessuna rivista nei dati | [[Crea i primi tag]] / [[Completa i dati]], link "Esplora per autori" | `explore-empty` |
| Vicini inattesi vuoto | Nessun vicino inatteso · servono documenti con testo | [Torna al Panorama] | `surprising-empty` |

- **Esplora:** si apre sulla prima dimensione non vuota (Temi › Autori › Riviste); "Ingrandisci" e "Mostra correlati" non sono più una barra disattivata in fondo ma azioni della riga selezionata (compaiono al passaggio e sulla riga attiva); "Indietro" solo sotto la radice. Testid invariati (`explore-zoom`, `explore-related-*`, `explore-back`, `explore-actions` sulla riga).
- **Vicini inattesi:** titolo o nome del file, **mai l'id** (senza entrambi: "Documento senza titolo"); righe a due livelli: "Titolo A ↔ Titolo B" `--fs-body` senza sottolineatura a riposo, "39 %" a destra; sotto, in `--text-muted`, "Parole in comune: …" (≤ 5); al passaggio "Mostra nella mappa" porta al Panorama ed esegue la stessa evidenziazione di Sorprendimi. Testid `surprising-pair`, `surprising-all`.

**Prove di accettazione** (giro "final", `RL_DESIGN_AUDIT_OUT=run9`, e unitarie)
- `count-map-head` ≤ 11 e `count-map-network` ≤ 12 in **ognuno** dei quattro modi, a 1280×800 e 1024×700, chiaro e scuro; Esplora ≤ 10, Vicini ≤ 6 escluse le righe; modello assente ≤ 6 con **un solo** elemento visibile che contiene "Costruisci".
- Ogni `⋯`, `Rete di ▾` e cartellino entro i numeri sopra (`countMenu`); nessun testo "Seme" visibile fuori dal dialogo; sottotitolo senza `T`, senza ". ·" e senza seme.
- Tela ≥ 70 % dell'altezza della finestra in Panorama e Collegamenti; legenda con `scrollWidth ≤ clientWidth`; riga dei controlli alta una riga (nessun a capo) a 1024.
- Unitarie (`m4.test.ts`/`mapfix.test.ts`): dopo `separateClusters` nessuna coppia di nuclei si sovrappone (gruppi sintetici intrecciati); l'insieme degli involucri a riposo è a coppie disgiunto; con ≤ 12 argomenti tutte le etichette piazzate senza collisioni; raggio dei nodi tra 3 e 6 px.
- Stati: mai `ent-empty-*`, `ent-clear-filters` o `explore-empty` insieme a una tela o a un elenco visibili; nessuna riga di Vicini con testo `/^[0-9a-f]{8}$/`; Esplora non mostra mai "Qui non c'è nulla".
- e2e da aggiornare (agente principale, fuori da `views/network/**`): aprire `net-mode` prima di `net-mode-<m>`, `net-start` prima di `net-start-folder`/`net-limit`, `ent-filters` prima di `ent-min-docs`, `map-more` prima di `map-label-clusters`, `net-more` prima di `net-reset`, il dialogo delle opzioni prima di `graph-seed`.
- Peso: ≤ +3 KiB nel chunk pigro (separazione, pillola, popover), nessuna dipendenza nuova; `check:budget` verde.

---

## 5. Sistema visivo

**Carattere dell'insieme:** "carta e inchiostro". Fondi neutri caldi e chiari (la carta), testo quasi nero, un solo blu inchiostro per l'azione, il viola solo per Claude, colori di stato sobri. Densità da strumento di lavoro (righe 28-56 px), molto spazio bianco tra i gruppi, nessun bordo dove basta lo spazio, ombre solo per ciò che galleggia. Tutto è un token in `styles/tokens.css`: chi implementa non sceglie colori, misure o durate.

### 5.1 Carattere tipografico

Nessun font remoto (CSP). Pila: `"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif`; titoli con `"Segoe UI Variable Display"` in testa; monospazio `"Cascadia Mono", Consolas, ui-monospace, monospace` (solo percorsi in Avanzate, id, codice). Cifre tabellari (`font-variant-numeric: tabular-nums`) in conteggi, pagine, percentuali e prezzi. `-webkit-font-smoothing` non si tocca (Windows usa ClearType).

| Token | Dimensione / interlinea | Peso | Spaziatura | Uso |
| --- | --- | --- | --- | --- |
| `--fs-display` | 32 / 40 px | 600 | -0,015em | titolo della procedura guidata, stati vuoti grandi |
| `--fs-title` | 26 / 32 px | 600 | -0,015em | titolo di vista (uno per vista) |
| `--fs-heading` | 16 / 24 px | 600 | 0 | titolo di sezione, pannello, dialogo, scheda |
| `--fs-body` | 14 / 21 px | 400 (500 nei pulsanti e nelle etichette) | 0 | testo, campi, pulsanti |
| `--fs-small` | 13 / 19 px | 400 | 0 | righe dense, metadati, tooltip, aiuti |
| `--fs-caption` | 12 / 16 px | 500 (600 maiuscolo) | 0,04em in maiuscolo | etichette di gruppo, badge, `Kbd` |

Niente testo sotto 12 px; maiuscolo continuo solo nelle etichette di gruppo `--fs-caption`; corsivo solo per citazioni dal PDF nel pannello Annotazioni; massimo 72 caratteri per riga di testo lungo.

### 5.2 Colori

Tutti i valori sono token su `:root`; il tema scuro vale per `[data-theme="dark"]` e per `prefers-color-scheme: dark` se non è scelto `light` (D-281). Contrasti calcolati con la formula WCAG 2.x (luminanza relativa sRGB) per **ogni** fondo su cui il token è ammesso; lo stesso calcolo diventa un test unitario (`tokens.contrast.test.ts`) che legge `tokens.css`.

#### 5.2.1 Neutri, accento, stati

| Token | Chiaro | Scuro | Uso |
| --- | --- | --- | --- |
| `--bg` | `#F6F5F1` | `#121316` | fondo della finestra e delle viste |
| `--surface` | `#FFFFFF` | `#1A1B1F` | pannelli, schede, campi, barra in alto, popover |
| `--surface-2` | `#EFEEE9` | `#212227` | barra laterale, intestazioni di gruppo, hover |
| `--surface-3` | `#E5E3DC` | `#2A2B31` | premuto, selezione neutra, fondo dell'area PDF |
| `--border` | `#DEDCD5` | `#33353C` | divisori e contorni decorativi (non informativi) |
| `--border-strong` | `#86847C` | `#6A6D77` | bordi di campi, caselle, chip filtro (≥ 3:1, WCAG 1.4.11) |
| `--text` | `#1B1C1F` | `#ECECEF` | testo principale |
| `--text-muted` | `#555963` | `#A9ACB5` | testo secondario |
| `--text-subtle` | = `--text-muted` | = `--text-muted` | alias tenuto per compatibilità (D-361): un solo grigio secondario; il terzo livello si fa con `--fs-small` o `--fs-caption`, non con un altro grigio |
| `--accent` (petrolio, provvisorio D-378) | `#0F6E78` | `#5CC6CF` | pulsante primario, barra della voce attiva, anelli di selezione |
| `--on-accent` | `#FFFFFF` | `#062328` | testo e icone su `--accent` |
| `--accent-text` | `#0B5F68` | `#6FD0D8` | link, testo accentato, icona dello strumento attivo |
| `--accent-soft` | `#E3F1F2` | `#15302F` | riga attiva, voce attiva, filtro attivo |
| `--focus` | `#0B5F68` | `#6FD0D8` | anello di fuoco 2 px a 2 px di distanza |
| `--danger` / `--danger-soft` | `#B42318` / `#FCEBE9` | `#FF8B80` / `#3A1D1B` | errori, azioni distruttive |
| `--warning` / `--warning-soft` | `#8A5300` / `#FCF1DD` | `#F2B755` / `#33280F` | avvisi |
| `--success` / `--success-soft` | `#1B6E38` / `#E6F3EA` | `#6BD394` / `#15301F` | esito positivo |
| `--info` / `--info-soft` | `#1F5FA8` / `#E7F0FA` | `#7FB3F5` / `#16263A` | informazioni neutre |
| `--ai` / `--ai-soft` | `#6B3FC0` / `#F2ECFC` | `#C3A6FF` / `#2A2140` | **solo** contenuto generato dall'AI e Claude (regola 5) |
| `--scrim` | `rgb(15 17 22 / .40)` | `rgb(0 0 0 / .60)` | fondo dei dialoghi e dei cassetti |

Contrasti misurati (minimo sui fondi ammessi `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--accent-soft`):

| Coppia | Chiaro | Scuro | Soglia |
| --- | --- | --- | --- |
| `--text` | 13,3:1 | 12,0:1 | 4,5 |
| `--text-muted` | 5,5:1 | 6,2:1 | 4,5 |
| `--text-subtle` (alias) | 5,5:1 | 6,2:1 | 4,5 |
| `--accent-text` | 5,7:1 | 7,8:1 | 4,5 |
| `--danger` / `--warning` / `--success` / `--info` / `--ai` | 5,1 / 4,9 / 4,9 / 5,0 / 5,3 | 6,2 / 7,8 / 7,6 / 6,5 / 6,9 | 4,5 |
| stato sul proprio `-soft` (danger, warning, success, info, ai) | 5,7 / 5,7 / 5,5 / 5,6 / 5,9 | 6,7 / 8,0 / 7,7 / 7,0 / 7,4 | 4,5 |
| `--on-accent` su `--accent` | 6,0:1 | 8,2:1 | 4,5 |
| `--accent` su `--bg` (non testo) | 4,6:1 | 7,0:1 | 3 |

Alternativa mostrata nel prototipo P0 (D-378): indaco `#3D4EDB` / `#9AA6FF`. Se l'utente la sceglie, i valori e i contrasti si ricalcolano con lo stesso test prima di A1. Gli altri token del giro 2 (`--info` blu) restano: con l'accento petrolio informazione e azione non si confondono più.
| `--border-strong` su `--surface` / `--bg` / `--surface-2` | 3,8 / 3,4 / 3,2 | 3,3 / 3,6 / 3,1 | 3 |

Regole: il colore non è mai l'unico segnale (icona o testo accanto); `--accent` solo per **un** primario per area e per la selezione; `--ai` mai decorativo; i fondi `-soft` solo con il testo del loro stato o `--text`; `--text-subtle` non va su `--surface-3` in chiaro sotto i 13 px.

#### 5.2.2 Badge del tipo di file e tinte delle librerie

| Token | Chiaro (testo / fondo, contrasto) | Scuro (testo / fondo, contrasto) | Tipi |
| --- | --- | --- | --- |
| `--type-pdf` | `#A3261B` / `#FCEBE9` (6,4) | `#FF9C92` / `#3A1D1B` (7,6) | pdf |
| `--type-md` | `#1B6E38` / `#E6F3EA` (5,5) | `#7FDCA3` / `#15301F` (8,6) | md, txt, rst, tex |
| `--type-office` | `#1F5FA8` / `#E7F0FA` (5,6) | `#7FB3F5` / `#16263A` (7,0) | docx, pptx, ipynb, altri |

Il badge ha sempre il suo fondo, quindi il contrasto non dipende dalla riga selezionata (B6). Tinte delle librerie `--lib-1..8` (quadratino del selettore, non testo): in chiaro `#2B50C8 #1B8A5A #B4531A #8E44AD #C0392B #127C8C #7A6A00 #5D6470`, in scuro `#8CA4FF #6BD394 #F2A15B #C3A6FF #FF8B80 #6CC7D3 #D9C35A #A9ACB5`; la tinta si sceglie con un hash dell'id della libreria (stabile, nessuna impostazione nuova).

#### 5.2.3 Annotazioni e pagina

La pagina PDF resta bianca anche nel tema scuro (la disegna pdf.js), quindi le annotazioni dell'app usano `mix-blend-mode: multiply` in entrambi i temi.

| Nome (`color`) | Riempimento evidenziazione (schermo e `/C` nel PDF) | Tratto della sottolineatura (schermo e `/C` nel PDF) | Testo nero sul riempimento |
| --- | --- | --- | --- |
| `yellow` | `#F7D046` · `[0.969 0.816 0.275]` | `#A67C00` · `[0.651 0.486 0]` (3,8:1 sul bianco) | 11,4:1 |
| `green` | `#7BD389` · `[0.482 0.827 0.537]` | `#2E8B45` · `[0.180 0.545 0.271]` (4,3:1) | 9,4:1 |
| `blue` | `#7DB7F2` · `[0.490 0.718 0.949]` | `#2F6FD0` · `[0.184 0.435 0.816]` (4,9:1) | 8,1:1 |
| `pink` | `#F29AC1` · `[0.949 0.604 0.757]` | `#C2407F` · `[0.761 0.251 0.498]` (4,9:1) | 8,3:1 |
| `orange` | `#F6A85B` · `[0.965 0.659 0.357]` | `#C25E0A` · `[0.761 0.369 0.039]` (4,3:1) | 8,7:1 |

Sottolineatura a schermo: spessore `max(1.5px, 0.08 × altezza del rettangolo)`, a 1 px sotto la linea di base del rettangolo (L3: oggi 2 px di bordo, quasi invisibile a zoom basso). Nel PDF: linea di spessore `max(0,75 pt, altezza/14)`. Annotazione selezionata: contorno 2 px `--accent` a 2 px di distanza. Tratto del trascinamento in corso: la selezione nativa colorata con il riempimento al 40% (`::selection`).

| Token della pagina | Chiaro | Scuro |
| --- | --- | --- |
| `--page-edge` | `#B9B6AD` (1 px) | `#3A3C44` |
| `--page-shadow` | `0 1px 3px rgb(20 22 28 / .10), 0 4px 12px rgb(20 22 28 / .06)` | `0 2px 8px rgb(0 0 0 / .6)` |
| fondo dell'area | `--surface-3` | `--surface-3` |

### 5.3 Spaziatura, misure, raggi, elevazione, movimento

- **Spaziatura** (griglia da 4 px): `--sp-1: 2px`, `--sp-2: 4px`, `--sp-3: 8px`, `--sp-4: 12px`, `--sp-5: 16px`, `--sp-6: 20px`, `--sp-7: 24px`, `--sp-8: 32px`, `--sp-9: 48px`. Uso: dentro un controllo 4-8; tra controlli di un gruppo 8; tra righe di un modulo 12; tra gruppi 24; padding delle viste 24 (orizzontale 32 sopra 1280 px). Le vecchie `--space-1..6` restano alias fino alla fine dell'onda 5.
- **Altezze dei controlli:** `--h-sm: 28px` (chip, righe dense, pulsanti delle righe), `--h-md: 32px` (pulsanti, campi), `--h-lg: 40px` (primario della procedura guidata, selettore di libreria). Barra in alto 48, barra del lettore 48 (la sostituisce), voci della barra laterale 36.
- **Raggi:** `--r-xs: 4px` (badge, `Kbd`), `--r-sm: 6px` (pulsanti, campi, chip quadrati), `--r-md: 10px` (schede, popover, barra strumenti, miniature), `--r-lg: 14px` (dialoghi, cassetti), `--r-pill: 999px` (chip filtro, badge numerici, barre di avanzamento).
- **Elevazione** (chiaro / scuro):
  - `--e-0`: nessuna; si separa con `--border` o con lo spazio.
  - `--e-1`: `0 1px 2px rgb(20 22 28 / .06), 0 1px 1px rgb(20 22 28 / .04)` / `0 1px 2px rgb(0 0 0 / .5)` — schede (`Card`), riga attiva trascinata.
  - `--e-2`: `0 4px 16px rgb(20 22 28 / .12), 0 1px 3px rgb(20 22 28 / .08)` / `0 6px 20px rgb(0 0 0 / .55)` — popover, menu, toast, cartellino della Mappa.
  - `--e-3`: `0 12px 40px rgb(20 22 28 / .20)` / `0 16px 48px rgb(0 0 0 / .65)` — dialoghi, tavolozza, cassetti sovrapposti.
  - In scuro i livelli si distinguono anche per il fondo: popover e dialoghi usano `--surface` con bordo 1 px `--border`.
- **Movimento:** `--dur-fast: 120ms` (hover, pressione, dissolvenze), `--dur: 180ms` (popover, toast, cambio di scheda), `--dur-slow: 240ms` (cassetti, dialoghi); `--ease: cubic-bezier(.2, 0, 0, 1)` (entrata), `--ease-exit: cubic-bezier(.4, 0, 1, 1)` (uscita). Solo `opacity` e `transform` (popover: da `translateY(-4px)` e opacità 0; cassetti: `translateX(16px)`; toast: dal basso 8 px). Niente animazioni di larghezza o altezza. Con `prefers-reduced-motion: reduce` tutte le durate a 0 (la regola esiste già).
- **Larghezze:** barra laterale 232 / 56; pannello di dettaglio 360 (300-480); pannello Claude 380 (320-560); pannello del lettore 340 (280-480); sottonavigazione delle impostazioni 220; contenuto delle impostazioni max 760; dialoghi 480 (conferma), 640 (moduli), 880 (export, ripristino); popover 280-420. **Viste a 1920 px** (M2, D-361): Libreria, lettore e Mappa occupano tutta la larghezza; elenchi di Progetti, Scopri e Da rivedere max 1200 px centrati; Impostazioni: sottonavigazione + contenuto max 760 centrati nello spazio restante; mai contenuto stretto a sinistra con il vuoto a destra.

### 5.4 Icone

- Insieme proprio di **40 icone SVG in linea** in `components/icons-shell.tsx` (13, prima schermata) e `components/icons.tsx` (27, caricate con le viste): funzioni React senza dipendenze, `viewBox="0 0 24 24"`, tratto 1,75 px, `stroke="currentColor"`, `fill="none"`, `stroke-linecap/linejoin="round"`; dimensioni 16 (in riga e nei pulsanti `sm`), 20 (barre e barra laterale), 24 (stati vuoti). Disegni derivati da Lucide (licenza ISC: nota di licenza in testa ai due file; nessun pacchetto npm).
- Prima schermata (13): library, review (vassoio con freccia), project, discover (bussola), map, claude (scintilla ✦), help, settings, back, forward, search, command, activity (anello).
- Resto (27): folder, folder-open, tag, plus, close, chevron-down, chevron-right, more, check, alert, info, error, undo, redo, history, backup, export, read (libro aperto), cursor (seleziona), highlighter, underline, eraser, comment, page, pdf-written (pagina con spunta), lock, trash.
- Regole: ogni pulsante con sola icona ha `aria-label` e tooltip con il tasto (`Kbd`); icona e testo nello stesso colore; le icone di stato prendono il colore dello stato.

### 5.5 Componenti

In `components/ui.tsx` (campi, già esiste) e `components/*.tsx`; ognuno ha stati hover, premuto, fuoco (`:focus-visible`, anello `--focus`), disabilitato (`cursor: not-allowed`, nessun hover; colori della tabella di §5.5.1, unica regola).

| Componente | Varianti e misure | Note |
| --- | --- | --- |
| `Button` | `primary` (fondo `--accent`, testo `--on-accent`; hover: luminosità .92), `secondary` (predefinito: `--surface`, bordo 1 px `--border-strong`, testo `--text`; hover `--surface-2`), `ghost`/terziario (nessun bordo, testo `--text`, hover `--surface-2`), `danger` (fondo `--danger`, testo bianco/`#1A0B09` in scuro); taglie `sm` 28 (padding 0 10), `md` 32 (0 14), `lg` 40 (0 18); icona 16 a 6 px dal testo | un solo `primary` per area (A13) |
| `IconButton` | `ghost`, `secondary`; 28 / 32; `aria-label` obbligatorio | tooltip con tasto |
| `Segmented` | 2-5 opzioni, altezza 28/32, fondo `--surface-2`, opzione attiva `--surface` con `--e-1` | sostituisce `radio-chip` e i `toggle on` |
| `Switch` | 32×18, pallino 14; acceso `--accent` | interruttori delle impostazioni |
| `Tabs` | testo `--fs-body` 500, attiva con linea 2 px `--accent` sotto; `role=tablist`, frecce | |
| `Chip` | filtro (rimovibile), stato, tag (pallino col colore del nodo) | 28 px, `--r-pill` |
| `Badge` | numero (`--accent`/`--on-accent`), avviso (`--warning-soft`/`--warning`), AI (`--ai-soft`/`--ai`), tipo di file (§5.2.2) | numeri solo per §7 |
| `Card` / `Panel` | intestazione 48, azioni a destra, corpo scorrevole; `DetailPanel` unico per scheda documento, progetto, nodo | |
| `KeyValue` | griglia 2 colonne (etichetta 180 px `--text-muted`, valore `--text`), righe 28 px | sostituisce i `<dl>` non stilizzati (Z1) |
| `Popover` / `Menu` | ancorati (sotto, poi sopra se manca spazio), chiusi con Esc e clic fuori; menu con frecce e trappola del fuoco | ~2 KiB, nessuna libreria |
| `Drawer` | cassetto da destra o sinistra, `--e-3`, `--scrim` leggero (.2), Esc chiude | pannello Claude e scheda sovrapposti |
| `Banner` | info, avviso, errore; icona, testo, un'azione primaria, (Chiudi) | nel flusso (D-305) |
| `Toast` | info, successo, errore; testo + azione (Annulla); 360 px max | §7.3 |
| `Dialog` | normale, conferma distruttiva; piede fisso | esiste (`Dialog.tsx`) |
| `EmptyState` | icona 24 in cerchio 48 `--surface-2`, titolo `--fs-heading`, testo, un'azione | ogni vista vuota |
| `Kbd` | `--fs-caption`, bordo `--border`, `--r-xs`, padding 0 4 | tasti uguali ovunque |
| `ProgressRing` / `ProgressBar` | 16 px / 6 px | chip Attività, scansione, uso |

#### 5.5.1 Stati dei controlli (D-361, audit sintesi 15)

Oggi un pulsante secondario con il fuoco o al passaggio è grigio pieno e sembra disattivato. Regola: **hover e fuoco non usano mai un fondo grigio pieno senza bordo**; il disattivato è l'unico stato che perde contrasto.

| Variante | Riposo | Hover | Premuto | Fuoco (`:focus-visible`) | Disattivato | In corso |
| --- | --- | --- | --- | --- | --- | --- |
| `primary` | fondo `--accent`, testo `--on-accent` | fondo `--accent` con `filter: brightness(.92)` | `brightness(.85)` | anello 2 px `--focus` a 2 px | fondo `--surface-3`, testo `--text-muted`, nessun anello | spinner 16 px al posto dell'icona, testo invariato, `aria-busy` |
| `secondary` | `--surface`, bordo `--border-strong`, testo `--text` | `--surface`, bordo `--text-muted`, ombra `--e-1` | `--surface-2` | anello `--focus` (fondo invariato) | bordo `--border`, testo `--text-muted` al 70%, nessuna ombra | come primary |
| `ghost` | trasparente, testo `--text` | `--surface-2` **con** testo `--text` e icona piena | `--surface-3` | anello `--focus` | testo `--text-muted` al 70% | come primary |
| `danger` | fondo `--danger`, testo bianco (scuro: `#1A0B09`) | `brightness(.92)` | `brightness(.85)` | anello `--focus` | come primary disattivato | come primary |
| campo | `--surface`, bordo `--border-strong` | bordo `--text-muted` | — | bordo `--accent` + anello `--focus` | fondo `--surface-2`, testo `--text-muted` | — |

Un controllo disattivato ha sempre un motivo vicino (aiuto o tooltip); un pulsante non si disattiva per un campo vuoto se il motivo non è visibile ("Create" grigio accanto al campo vuoto, E4: il pulsante resta attivo e un clic mostra l'errore sul campo). Test di componente: ogni variante in ogni stato ha un contrasto ≥ 3:1 tra riposo e hover/fuoco, e il disattivato è distinguibile dal fuoco (anello presente solo nel fuoco).

**Contenuto AI:** ogni blocco generato dall'AI ha bordo sinistro 3 px `--ai`, fondo `--ai-soft` **e** l'icona ✦ con l'etichetta "Generato dall'AI" in testa (per chi non distingue blu e viola).

### 5.6 Organizzazione del CSS

`styles.css` (oggi tutto nel primo caricamento) si divide in `styles/tokens.css` + `styles/base.css` + `styles/shell.css` (prima schermata) e un file per vista importato dal suo modulo pigro (`views/library/library.css`, `views/reader/reader.css`, `views/review/review.css`, `settings/settings.css`, …): Vite li mette nei chunk delle viste. Nessun colore letterale fuori da `tokens.css` (test: `#[0-9a-fA-F]{3,8}` e `rgb(` vietati fuori dai token, eccetto le icone e il CSS di pdf.js). **Nessuna classe generica senza prefisso** che possa collidere con librerie (`.page`, `.sidebar`, `.dialog`, `.selected`, `.dragging`, `.radio`, `.swatch`: §8.1.1); stati con il prefisso `is-` (`.is-selected`, `.is-dragging`).

---

## 6. Impostazioni: nuova struttura e mappa completa

### 6.1 Sezioni

| Sezione (`SettingsSectionId`) | Per chi | Contenuto |
| --- | --- | --- |
| `general` Generale | tutti | lingua dell'interfaccia, tema, guida e suggerimenti, informazioni (versione, copia informazioni) |
| `profile` Profilo | tutti | nome, nomi con cui compari tra gli autori, email, ORCID, id OpenAlex (con aiuto "Cos'è?"), invio dell'email a OpenAlex |
| `library` Libreria | tutti | le tue librerie; per la libreria attiva: nome, lingua dei documenti, cartella radice (sola lettura, "Apri cartella"), cartelle escluse, scansione (ultima, Scansiona ora, rapporto), **annotazioni nel PDF** (scrittura, firma, migrazione) |
| `claude` Claude | tutti | Account Claude (§10), cosa può leggere, modello e ragionamento predefiniti, tetto mensile, conferma prima di inviare, registro degli invii |
| `backup` Backup | tutti | destinazione, cadenza, esegui ora, elenco, verifica, ripristina, apri; "Opzioni": quanti tenere, includi dati locali |
| `shortcuts` Scorciatoie | tutti | globali, lettore, strumenti del lettore (§4.6) |
| `advanced` Sviluppatore / Avanzate | esperti | valori diversi dal predefinito, chiavi salvate, e i gruppi di §4.8 |

`backup` mostra ⚠ nella sottonavigazione se l'ultimo backup ha più di 30 giorni o l'ultimo automatico è fallito; `claude` mostra ⚠ se non collegato.

### 6.2 Mappa vecchio → nuovo (ogni impostazione)

Fonti: `packages/core/src/settings.ts` (`AppSettings`, `LibraryConfig`), `settings/*Section.tsx`, `wizard/**`, canali `ai:*`, `mcp:*`, `backup:*`, `maintenance:*`, `localStorage` del renderer, e l'inventario dell'audit (stessa lista, stessi valori predefiniti). **Nessuna impostazione viene tolta.** La colonna "Oggi" usa i nomi delle sezioni attuali.

| Impostazione (campo / canale) | Oggi | Nuovo posto | Predefinito | Salvata in | Note |
| --- | --- | --- | --- | --- | --- |
| `uiLanguage` | Tu e l'interfaccia + barra laterale + procedura guidata | Generale; procedura guidata (Benvenuto); tavolozza "Cambia lingua" | `it` | app | `language-select` si sposta |
| `appearance.theme` | Tu e l'interfaccia | Generale | `system` | app | `Segmented` |
| `guide.welcomeSeen`, `guide.dismissedTips` | nascosti (carta di benvenuto) | Generale › "Mostra di nuovo i suggerimenti" | falso / nessuno | app | azzera entrambi |
| versione (`app:info`) | barra di stato | Generale › Informazioni | — | — | |
| `firstRunDone` | nascosto | resta nascosto | falso | app | interno |
| `deviceId` | nascosto | Avanzate › Manutenzione e diagnostica (sola lettura) | generato | app | |
| `user.name` | Tu e l'interfaccia; procedura guidata (Chi sei) | Profilo; procedura guidata (Dettagli, facoltativo) | vuoto | app | |
| `user.authorVariants` | Tu e l'interfaccia; procedura guidata | Profilo | vuoto | app | fuori dalla procedura (D-337) |
| `user.email` | Tu e l'interfaccia; procedura guidata | Profilo | vuoto | app | fuori dalla procedura |
| `user.orcid` | Tu e l'interfaccia; procedura guidata | Profilo | vuoto | app | fuori dalla procedura |
| `user.openAlexId` | Tu e l'interfaccia; procedura guidata | Profilo (con aiuto) | vuoto | app | fuori dalla procedura |
| `network.openAlexEmail` | Fonti online | Profilo (sotto l'email) | spento | app | scelta di privacy sull'email |
| segreto `openalex-api-key` (app) | Fonti online | Avanzate › Chiavi salvate | non salvata | archivio sicuro | |
| `libraries[]` (attiva, rinomina, dimentica, nuova) | Librerie + selettore | Libreria › Le tue librerie; selettore a popover | — | app | |
| `libraries[].rootPath` | non mostrato | Libreria (sola lettura + "Apri cartella") | — | app | |
| `libraries[].dataDirName` | solo procedura guidata (`wizard-data-dir`) | procedura guidata › Cartella › Opzioni avanzate; Avanzate › Scansione (sola lettura) | `.lab` | app | |
| `activeLibraryId` | selettore | selettore; Libreria › "Rendi attiva" | null | app | |
| `name` (library.json) | Impostazioni della libreria | Libreria › Questa libreria | dal nome scelto | library.json | |
| `language` (library.json) | Impostazioni della libreria; procedura guidata | Libreria; procedura guidata (Dettagli) | `it` | library.json | |
| `excludedFolders` | Impostazioni della libreria | Libreria › Cartelle escluse | nessuna | library.json | |
| `scan.extensions` | nessuna interfaccia | Avanzate › Scansione | pdf, md, txt, tex, rst, docx, pptx, ipynb | library.json | controllo nuovo |
| `scan.nameOnlyExtensions` | nessuna interfaccia | Avanzate › Scansione | nessuna | library.json | controllo nuovo |
| `scan.pruneDeletedDays` | nessuna interfaccia | Avanzate › Scansione | 30 | library.json | controllo nuovo |
| scansiona ora (`scan:start`) | barra della Libreria | chip Attività, popover, Libreria › Scansione, tavolozza | — | — | |
| ricostruisci indice (`scan:start {full}`) | barra della Libreria | Avanzate › Scansione | — | — | con spiegazione |
| `exportPresets[]` | Impostazioni della libreria; dialogo export | Avanzate › Esportazione; dialogo export (dove si usano) | nessuno | library.json | |
| `aiEnabledFolders` | Claude (AI); procedura guidata | Claude › Cosa può leggere; procedura guidata (Claude) | nessuna | library.json | |
| `ai.confirmBeforeSend` | Claude (AI) | Claude › Modello e spesa | acceso | library.json | regola 4 |
| `ai.defaultModel` | Claude (AI) | Claude › Modello e spesa | `claude-haiku-5-5` | library.json | |
| `ai.defaultReasoning` | Claude (AI); menu di chat e dialoghi | Claude › Modello e spesa; chip del compositore | `low` | library.json | |
| `ai.usageCap.monthlyUsd` | Claude (AI) | Claude › Modello e spesa | nessuno | library.json | |
| `ai.usageCap.confirmBatchAboveUsd` | Claude (AI) | Avanzate › Claude | 0,50 | library.json | |
| `ai.models[]` (id, etichetta) | Claude (AI) | Avanzate › Claude | Haiku, Sonnet, Opus 5.5 | library.json | Z2 |
| `ai.models[].inputPerMTok/outputPerMTok` | solo nei dati | Avanzate › Claude (due campi nuovi per modello) | da `DEFAULT_MODELS` | library.json | |
| `ai.provider` | Claude (AI), solo stato | Avanzate › Claude (sola lettura; "Gemini: non disponibile") | `claude-agent-sdk` | library.json | |
| `ai.claudeCodePath` (`ai:chooseExecutable/clearExecutable`) | Claude (AI) › Stato | Avanzate › Claude; link dall'Account se non trovato | automatico | app | |
| **nuovo** `ai.authMode` | — | Claude › Account | `auto` | app | §10 |
| segreto `anthropic-api-key` (app) | Claude (AI) | Claude › Account e Avanzate › Chiavi salvate | non salvata | archivio sicuro | stesso componente |
| stato AI (`ai:status`) | Claude (AI) + barra di stato | Claude › Account; intestazione del pannello Claude | — | — | |
| registro invii (`ai:log`) | Claude (AI) | Claude › Registro degli invii | — | locale | |
| uso del mese (`ai:usage`) | contatore della chat | Claude › Account; compositore della chat | — | locale | §10.4 |
| segreto `gemini-api-key` (libreria) | Chiavi API | Avanzate › Chiavi salvate (gruppo Sperimentale) | non salvata | archivio sicuro | |
| `mcp.enabled` (`mcp:setEnabled`) | Server MCP | Avanzate › Server MCP | spento | library.json | |
| `mcp.writeEnabled` | Server MCP (con conferma) | Avanzate › Server MCP (con conferma) | spento | library.json | |
| porta MCP (`mcp:setPort`) | Server MCP | Avanzate › Server MCP | automatica | locale | |
| copia comando / `.mcp.json`, nuovo token, registro MCP | Server MCP | Avanzate › Server MCP | — | archivio sicuro / locale | |
| `backup.destination` | Backup e ripristino | Backup | nessuna | app | stati di §4.6 |
| `backup.auto` | Backup e ripristino | Backup | spento | app | |
| `backup.keep` | Backup e ripristino | Backup › Opzioni | 5 | app | |
| includi cronologia chat, contatori, stato di lettura (per esecuzione) | Backup e ripristino | Backup › Opzioni (vale per "Esegui ora") | acceso | — | |
| ripristino: radice, nome, impostazioni, segreti, dati locali | dialogo di ripristino | dialogo di ripristino (invariato) da Backup › elenco › Ripristina… | — | — | |
| backup ora, elenco, verifica, apri, rimuovi | Backup e ripristino | Backup; tavolozza "Esegui un backup ora" | — | — | |
| `shortcuts[]` | Scorciatoie da tastiera | Scorciatoie (+ scope `reader-tool`) | `shortcuts.ts` | app | |
| manutenzione: dimensioni, memoria, processi, pulizia, log, diagnostica, rapporto | Manutenzione e prestazioni | Avanzate › Manutenzione e diagnostica | — | — | |
| limiti dei worker (`idleCloseMs`) e budget | costanti | Avanzate › Manutenzione e diagnostica (sola lettura) | — | — | non diventano impostazioni |
| **nuovo** `annotations.writeToPdf` (library.json) | — | Libreria › Annotazioni nel PDF | acceso (D-316) | library.json | |
| **nuovo** `annotations.author` | — | Libreria › Annotazioni nel PDF ("Firma con il mio nome") | `none` (D-328, provvisoria) | library.json | |
| **nuovo** `annotations.backupLocation` | — | Avanzate › Annotazioni nel PDF | `data` (D-327, provvisoria) | library.json | |
| **nuovo** copie degli originali (spazio, elimina, ripristina tutti) | — | Avanzate › Annotazioni nel PDF | — | — | |
| **nuovo** `pdfMode` per documento | — | menu del chip PDF nel lettore; scheda Info | assente (= segue la libreria) | file delle annotazioni | |
| `rl.libraryView` (elenco/griglia) | `localStorage` | invariato (pulsante della vista) | elenco | browser | preferenza, non impostazione |
| `rl.libraryTab` (cartelle/tag/filtri) | `localStorage` | invariato (valori `folders`/`tags`; `filters` → riga dei filtri) | cartelle | browser | |
| `rl.chatOpen` | `localStorage` | invariato | chiusa | browser | |
| `rl.readerSide` | `localStorage` | invariato (+ scheda attiva) | aperto | browser | |
| `rl.paletteRecent` | `localStorage` | invariato (gruppo "Recenti") | vuoto | browser | |
| **nuovo** `rl.detailOpen`, `rl.readerTool` | — | pannello di dettaglio aperto; ultimo strumento e colore del lettore | aperto; Seleziona + giallo | browser | |
| variabili `RL_*` | ambiente | invariate, non mostrate | — | ambiente | D-014 |

"Valori diversi dal predefinito" (in cima ad Avanzate): confronto puro con `defaultAppSettings()` / `defaultLibraryConfig()` sui campi della colonna "Avanzate"; ogni riga ha "Ripristina" (una patch con il valore predefinito, o il canale dedicato per percorsi e porta). Un test verifica che ogni riga di questa tabella abbia un controllo raggiungibile nella sezione indicata (`settingsIndex.ts` è la fonte).

### 6.3 Chiavi salvate (Z3)

Le tre chiavi restano dove si usano (Anthropic nell'Account, OpenAlex con i servizi online, Gemini nello sperimentale) **e** sono elencate insieme nel riquadro "Chiavi salvate" in cima ad Avanzate: nome, stato (salvata / non salvata), ambito (app o libreria), azioni. Un solo componente `SecretRow` (già esiste come `secret-*`), usato in entrambi i posti; testid invariati. Le chiavi non si mostrano mai, nemmeno in parte.

### 6.4 Salvataggio (Z5, D-336)

Un solo comportamento: ogni controllo salva da solo. Interruttori, scelte e menu al cambio; campi di testo alla perdita del fuoco o 600 ms dopo l'ultima battuta, solo se validi; elenchi (cartelle escluse, estensioni) a ogni aggiunta o rimozione. Dopo il salvataggio "✓ Salvato" accanto al controllo per 2 s (`aria-live="polite"`); per i cambi con effetto ampio (lingua dei documenti, cartelle escluse, estensioni) toast "Salvato · Annulla". Gli errori restano sul campo e bloccano solo quel campo. Uscendo dalla sezione con un campo non valido: avviso nel campo, nessun dialogo. Le conferme esistenti per le scelte rischiose restano dialoghi. Contratti: invariati (`settings:set` e `library:setConfig` accettano già patch parziali).

---

## 7. Notifiche

| Mezzo | Quando | Esempi | Regole |
| --- | --- | --- | --- |
| **Badge numerico** sulla voce di navigazione | ci sono elementi che **aspettano una decisione dell'utente** | Da rivedere: solo i file nuovi (le proposte di Claude danno un punto, D-358); Scopri: opere nuove non ancora viste | numero esatto fino a 99, poi "99+"; tooltip e `aria-label` con il dettaglio; mai per avanzamento o errori; sparisce quando il numero è 0 |
| **Chip Attività** (barra in alto) | lavoro in corso o appena finito | scansione 45%, 3 proposte in preparazione, backup in corso, scrittura PDF in attesa | un solo chip; puntino se c'è un risultato non visto; rosso se c'è un errore; clic apre il popover con tutte le attività e l'ultimo esito |
| **Toast** | conferma di un'azione appena fatta, con eventuale Annulla | "Tag aggiunto a 3 documenti · Annulla", "Copia creata in Capitolo 2" | 6 s, al massimo 3; gli errori di un'azione restano finché chiusi; mai per eventi non causati dall'utente |
| **Banner** nel flusso (sopra il contenuto) | condizione persistente che richiede attenzione o blocca | impostazioni ripristinate o in sola lettura, backup automatico fallito, ultimo backup > 30 giorni, libreria non raggiungibile, scrittura nel PDF impossibile (file bloccato da più di 10 minuti); tabella completa in §7.4 | al massimo 2 visibili, ordinati per gravità; ognuno con una sola azione primaria e (se non bloccante) "Chiudi" che lo nasconde fino al prossimo cambiamento |
| **Dialogo** | conferma di un'azione distruttiva, di un invio, di un'operazione lunga | dimentica libreria, ripristina backup, ripristina il PDF originale, invio a Claude con anteprima | mai per informare |
| Notifiche di sistema | mai | — | l'app non le usa |

### 7.1 Il badge di "Da rivedere"

- **Significato (giro 3, D-358):** il numero conta **solo i file nuovi** (da fuori + trovati dalla scansione), cioè decisioni rapide; i documenti con proposte di Claude in attesa danno un **punto** 8 px `--ai` accanto al badge (o al posto del badge se i file sono 0) e il loro numero sta sulla scheda "Proposte di Claude". Così il badge non resta a 300 dopo un lavoro in blocco.
- **Tooltip e `aria-label`:** "Da rivedere: 3 file nuovi · proposte di Claude per 12 documenti" (`review.badge`, plurali i18next); se una delle due parti è 0 si omette.
- **Clic:** apre "Da rivedere" sulla scheda che ha elementi (Nuovi file prima); la scheda mostra lo stesso numero.
- **Trascinamento di PDF:** come oggi il suggerimento a tutta finestra (`drop-hint`), poi la vista si apre su Nuovi file con le schede nuove evidenziate per 2 s; toast "2 file aggiunti a Da rivedere" solo se la vista non era già aperta.
- **File trovati dalla scansione:** contano nel badge solo finché non sono confermati o "Segnati come visti" (un'azione in blocco). Così il badge non resta alto per sempre dopo una prima scansione grande: la procedura guidata segna come visti i file della **prima** scansione (sono la libreria, non arrivi).
- **Contratto:** `inbox:count` restituisce anche `{ dropped, library }` (additivo); `review:stats` aggiunge `pendingDocs` (documenti con almeno una proposta in attesa); evento `review:changed` già coperto da `library:changed`? Se non basta, il conteggio si ricarica dopo ogni `review:decide*` e alla fine di un lavoro AI (evento `jobs:progress` con stato finale).

### 7.2 Il popover Attività (centro notifiche; versione completa in §4.10)

```
+-------------------------------------------------------------+
| Attività                                                    |
| ⟳ Scansione in corso — estrazione del testo 120 / 400  [Annulla] |
| ✓ Proposte di Claude: 18 documenti pronti      [Rivedi]     |
| ⚠ PDF in attesa: "Titolo…" è aperto in un altro programma  [Riprova] |
| ✓ Backup di ieri 18:02                         [Apri Backup] |
| ─────────────────────────────────────────────────────────── |
| Ultima scansione (oggi 14:32): +3 nuovi · 1 cambiato · 2 mancanti · 1 non leggibile |
|   [Mostra i nuovi] [Mostra i mancanti] [Mostra i non leggibili]   [Scansiona ora] |
+-------------------------------------------------------------+
```

Le righe vengono dai provider esistenti (`useScanStatus`, `JobIndicator`, `CitationIndicator`, backup) più `pdfWrite` (§8.3); nessun polling nuovo, solo eventi.

### 7.3 Correzioni del giro 2

- **Toast** (N5): regione in basso a destra della vista, 16 px dai bordi, colonna di al massimo 3 (il più nuovo in basso), larghezza 360; non coprono mai il compositore della chat (con il pannello Claude accanto stanno nella vista, con il pannello sovrapposto si nascondono finché è aperto e riprendono dopo); durata 6 s, in pausa al passaggio del mouse e con il fuoco dentro; gli errori di un'azione restano finché chiusi.
- **Un solo esito per lavoro** (B5, A10): un lavoro avviato dall'utente mostra al massimo il toast "Avviato · (Vedi in Attività)"; l'esito (riuscito, parziale, fallito) sta **solo** nella sua riga del popover Attività (gruppo "Da guardare" se fallito o parziale) e nel puntino del chip. Mai "seguilo nella barra di stato".
- **Barra di stato tolta**: ogni suo contenuto ha un posto — libreria attiva (selettore), lingua dei documenti (Impostazioni › Libreria e scheda), cartelle abilitate (intestazione del pannello Claude: "2 cartelle"), stato dell'indice (chip Attività), errori dei lavori (Attività), versione (Generale › Informazioni).
- **Popover e pannelli si chiudono con Esc** (N3) e con un clic fuori; la cronologia, il popover Attività e i menu non restano mai aperti sotto un dialogo (si chiudono quando se ne apre uno).

### 7.4 Evento → mezzo (D-358, attacco B.3)

Ogni evento esistente ha un mezzo e uno solo per tipo di informazione; nessun compito ne inventa altri.

| Evento | Chip Attività | Riga del popover | Badge | Toast | Banner | Dialogo |
| --- | --- | --- | --- | --- | --- | --- |
| Scansione in corso / finita | stato e % / "Aggiornata · N nuovi" | In corso → ultimo esito con i filtri | file nuovi in Da rivedere | — | radice non raggiungibile | — |
| Scansione fallita | rosso | Da guardare + [Riprova] | — | — | — | — |
| File trascinati o aggiunti | — | — | +N | "N file aggiunti a Da rivedere" solo se la vista non è aperta | — | — |
| Lavoro AI (proposte) avviato dall'utente | stato | In corso → Recenti "Proposte pronte" [Rivedi] | punto `--ai` | "Avviato · Vedi in Attività" | — | conferma del costo (come oggi) |
| Lavoro AI fallito o tetto raggiunto | rosso | Da guardare con il motivo | — | — | tetto di spesa raggiunto (finché non cambia il mese o il tetto) | — |
| Aggiornamento delle citazioni | stato | In corso → esito; offline in Da guardare | Scopri: opere nuove | "Avviato · Vedi in Attività" | — | — |
| Backup manuale | stato | In corso → Recenti [Apri Backup] | — | — | — | — |
| Backup automatico fallito; ultimo > 30 giorni | — | Da guardare | ⚠ su Impostazioni › Backup | — | sì, con [Esegui ora] | — |
| Export | — | Recenti con [Mostra la cartella] | — | — | — | il dialogo stesso (§4.15) |
| Server MCP: avvio, errore di porta | — | Da guardare se errore | — | — | — | — |
| Scrittura nel PDF in attesa > 10 min / rifiutata | puntino | Da guardare [Riprova] / riga informativa una volta per documento | — | — | nel lettore, se il documento è aperto | — |
| Prima scrittura nel PDF di una libreria | — | — | — | — | banner nel lettore (consenso, §8.3.7) | solo se alla chiusura del documento non c'è risposta |
| Annotazioni riposizionate (§8.1.2) | — | — | — | "3 evidenziazioni riposizionate · Annulla" (nel lettore) | — | — |
| Azione dell'utente con Annulla (tag, proposta accettata, eliminazione) | — | — | — | sì, legato alla vista | — | — |
| Impostazioni ripristinate o in sola lettura; libreria non raggiungibile | — | — | — | — | sì | — |
| Distruttive (dimentica libreria, ripristino, troncamento del PDF) | — | — | — | — | — | conferma |

---

## 8. Lettore

### 8.1 Il PDF appare stirato: causa e correzione (compito H0, onda 0)

**Causa (confermata dall'audit con le misure):** la classe globale dell'app `.page { max-width: 860px; padding: … }` (`styles.css` 451-454) è anche la classe che pdf.js dà a ogni pagina dentro `.pdfViewer`. pdf.js imposta in linea larghezza e altezza della pagina; `max-width` taglia la larghezza oltre 860 px mentre l'altezza resta; la tela (assoluta, 100% della scatola) stira la bitmap; lo strato del testo, che usa la scala vera, resta largo quanto previsto. A 1920×1080 con "Adatta": scatola 860×1815 invece di 1285×1815 (rapporto 0,474 contro 0,707), glifi al 66,9% in larghezza, strato del testo 1,49 volte la tela, barra di scorrimento orizzontale. Il `padding` riduce anche `canvasWrapper` (796×1759).

**Seconda causa, piccola:** con un `devicePixelRatio` frazionario (1,198 nella macchina di misura) pdf.js arrotonda larghezza e altezza separatamente al passo `--scale-round-x/y` (5 px): +0,8% in larghezza a 1280×800, +1,3% a 1024×700.

**Correzione:**
1. rinomina della classe di contenitore delle viste `.page` → `.view` e delle altre classi in collisione (§8.1.1);
2. guardia nel foglio del lettore: `.reader-scroll .pdfViewer .page { max-width: none; padding: 0; }`;
3. arrotondamento: per ogni pagina `--page-ratio` = larghezza/altezza della vista pdf.js e `.reader-scroll .pdfViewer .page { height: auto; aspect-ratio: var(--page-ratio); }` (l'altezza deriva dalla larghezza arrotondata); in alternativa `--scale-round-x/y: 1px`. H0 sceglie la variante che resta nitida (screenshot ingrandito) e tiene il rapporto entro 0,5%;
4. test: unitario sul CSS (nessun selettore globale `.page`), e2e del rapporto scatola/MediaBox e tela/scatola a 1024, 1280 e 1920 px (tolleranza 0,5%), e2e `leakedRules` (§8.1.1), e2e della posizione di un'evidenziazione nuova a 1920 px (sovrapposizione con i glifi ≥ 95%, come la misura `reader-1920-selection-vs-mark` dell'audit). Le misure a DPR 1 e 1,5 si fanno con `--force-device-scale-factor` nell'e2e.

#### 8.1.1 Il CSS di pdf.js contamina l'app (D-346)

**Causa:** `views/reader/engine.ts` importa `pdfjs-dist/web/pdf_viewer.css` intero (il visualizzatore completo di Firefox: barra laterale, dialoghi, editor). Vite lo mette nel chunk del lettore, che resta nel documento dopo la prima apertura: 156 regole valgono per tutta l'app. Classi in comune: `.dialog`, `.dragging`, `.page`, `.radio`, `.selected`, `.sidebar`, `.swatch`, `.textLayer`. Effetti misurati: barra laterale con raggio 8 px, ombra doppia, bordo, padding 5/16, larghezza 239, `position: relative`; dialoghi con raggio 4 px, padding 12/16, ombra diversa e bordo bianco, fino al riavvio.

**Correzione (tre difese):**
1. **Rinomina** delle classi dell'app in collisione: `.page` → `.view`, `.sidebar` → `.app-sidebar`, `.dialog` → `.rl-dialog` (e le classi composte solo se il nome intero coincide), `.dragging` → `.is-dragging`, `.selected` → `.is-selected`, `.radio` → `.rl-radio`, `.swatch` → `.rl-swatch`. `.textLayer` **non** è dell'app: è l'elemento di pdf.js che l'app usa per la selezione e la ricerca (`views/reader/selection.ts` legge `.textLayer`; `styles.css` ha `.reader-scroll .textLayer`): resta, solo sotto il prefisso.
2. **Foglio filtrato e prefissato** al posto dell'import intero: `tools/vendor-pdfjs-css.mjs` legge `pdf_viewer.css` della versione installata e scrive `views/reader/pdfjs-viewer.css` con le sole regole i cui selettori iniziano con `.pdfViewer`, `.page`, `.canvasWrapper`, `.textLayer`, `.annotationLayer`, `.hiddenCanvasElement` e le proprietà personalizzate che usano; ogni selettore riceve il prefisso `.reader-scroll `, `:root` diventa `.reader-scroll`; restano fuori barra laterale, dialoghi, editor, barre. Il file generato è committato; un test lo rigenera e fallisce se differisce (un aggiornamento di pdf.js non passa in silenzio). Circa −150 KiB di CSS nel chunk del lettore. `@layer pdfjs` resta come seconda difesa (vince l'app nei conflitti). `@scope` da solo non basta: non può contenere `@import`, e senza il filtro le regole fuori ambito resterebbero comunque scaricate.
3. **Test permanenti:** (a) unitario: intersezione tra classi di primo livello del foglio generato e classi dei CSS e `className` dell'app = `{ textLayer, page }` con `page` ammessa solo sotto `.reader-scroll`; (b) e2e `leakedRules` (la funzione dell'audit): nessuna regola del foglio del lettore corrisponde a elementi fuori da `.reader-scroll`; (c) e2e: stile calcolato di `.app-sidebar` e di un dialogo uguale prima e dopo il lettore.

#### 8.1.2 Riparazione delle annotazioni salvate storte (D-347)

**Problema (audit N1):** le annotazioni create mentre la pagina era deformata sono state salvate con le coordinate dello strato di testo rapportate alla scatola stretta: a 1920 px 40 px di scarto a sinistra, 192 px oltre il testo, 58% di sovrapposizione; i valori oltre 1 sono stati limitati dallo schema (`normRect` 0..1). Restano storte a ogni dimensione e dopo la correzione del CSS; scritte nel PDF, sarebbero storte anche in Chrome.

**Perché non basta un fattore:** la deformazione dipendeva dalla larghezza della finestra e dallo zoom al momento della creazione (non registrati), e i valori limitati a 1 hanno perso informazione. L'asse **verticale** invece non era deformato (l'altezza della scatola era giusta).

**Algoritmo** (`views/reader/repair.ts`, puro sulla parte di confronto, eseguito nel lettore dopo il disegno corretto di ogni pagina):
1. Candidate: annotazioni senza `geom` (tutte quelle create prima della correzione). Le annotazioni create dopo H0 nascono con `geom: 2`.
2. Per ogni candidata con `text` non vuoto: normalizzazione degli spazi e dei trattini di fine riga; ricerca del testo nello strato del testo della pagina (stessa funzione della ricerca nel documento); se le occorrenze sono più di una si sceglie quella con il centro verticale più vicino a quello salvato. Le annotazioni su più pagine si trattano pezzo per pezzo.
3. Rettangoli nuovi = quelli dell'intervallo trovato, calcolati come alla creazione (`readRange`), normalizzati sulla scatola corretta.
4. Se l'intersezione sull'unione tra vecchi e nuovi è ≥ 0,9 l'annotazione era già giusta (finestre strette): si segna `geom: 2` senza cambiare i rettangoli. Altrimenti si sostituiscono, `geom: 2`, e si conserva il vecchio valore nella pila di Annulla.
5. Testo vuoto, non trovato o ambiguo (due occorrenze a meno di una riga): l'annotazione va nel gruppo "Da controllare" del pannello con [Riposiziona] (l'utente riseleziona il testo con lo strumento attivo: i rettangoli nuovi sostituiscono i vecchi) e [Va bene così] (segna `geom: 2`).
6. Un toast nel lettore: "3 evidenziazioni riposizionate dopo una correzione del lettore · Annulla" (una volta per documento).

**Rapporto con la scrittura nel PDF:** una annotazione senza `geom: 2` **non si scrive mai** in un PDF originale (controllo nel servizio di sincronia, non solo nell'interfaccia). La migrazione di massa (§8.3.7) salta i documenti con candidate non riparate ("12 documenti da aprire una volta nel lettore per controllare le evidenziazioni" con un elenco). Poiché H0 è nell'onda 0 e la scrittura nell'onda 4, tutte le annotazioni nuove nascono giuste.

**Contratto:** `annotationSchema.geom: z.literal(2).optional()` (additivo); il salvataggio esistente (`annotations:save`) accetta il campo; nessun canale nuovo.

**Test:** unitari sul confronto (una o due occorrenze, testo su due righe, trattino di fine riga, pagine multiple, testo vuoto); e2e con un file di annotazioni sintetico costruito con rettangoli storti come quelli misurati (fattore 1,49 e limite a 1) → dopo l'apertura sovrapposizione ≥ 95% e `geom: 2`.

### 8.2 Annotazione per strumento (giro 2, D-332)

#### 8.2.1 Strumenti e tasti

| Strumento (`Tool`) | Tasto | Con il trascinamento sul testo | Clic senza trascinare | Cursore |
| --- | --- | --- | --- | --- |
| Seleziona `select` | V | selezione nativa (copia); al rilascio mini popover "Evidenzia · Sottolinea · Copia" accanto alla selezione (`ann-highlight` resta) | su un'annotazione: la seleziona (popover) | `default`; `text` sul testo |
| Evidenzia `highlight` | H | al rilascio crea subito l'evidenziazione col colore corrente | su un'annotazione: la seleziona | SVG "evidenziatore" (punta in basso a sinistra, hotspot 3,21), ripiego `text` |
| Sottolinea `underline` | U | al rilascio crea subito la sottolineatura | su un'annotazione: la seleziona | SVG "sottolinea", ripiego `text` |
| Gomma `eraser` | E | elimina ogni annotazione toccata dal tratto (contorno `--danger` al passaggio) | su un'annotazione: la elimina | SVG "gomma", ripiego `pointer` |

- **Colore** (non è uno strumento): uno solo, corrente, per entrambi i pennelli; tasti 1-5 o i pallini; mostrato come pallino sulle icone dei pennelli. Con un'annotazione selezionata 1-5 ne cambia il colore invece del colore corrente. Si ricorda con lo strumento (`rl.readerTool`).
- **Doppio e triplo clic** con un pennello: la selezione nativa di parola o riga, poi la creazione al rilascio (un solo oggetto: il primo rilascio con selezione vuota non crea nulla).
- **C** con un'annotazione selezionata apre il commento; **Canc/Backspace** la elimina (toast con Annulla); **Ctrl+Z / Ctrl+Y** annullano e ripetono creazione, modifica ed eliminazione (pila del lettore per la sessione se `history` non copre le annotazioni).
- Restano: N/P pagina, J/K scorrimento, PagSu/PagGiù, frecce, Ctrl+F, Ctrl+G, Ctrl+più/meno/0, Ctrl+Maiusc+H/U sul risultato della ricerca.
- I cursori sono SVG 24 px in `data:` URI dentro `reader.css` (la CSP ammette `img-src 'self' data:`; il primo giro diceva il contrario: corretto).

#### 8.2.2 Spazio

- Scambia `tool` e `prev`. `prev` cambia solo quando lo strumento cambia davvero (da A a B con A ≠ B: `prev = A`); all'avvio `tool = select`, `prev = highlight` (o lo stato ricordato). Quindi: Seleziona ↔ ultimo pennello; Evidenzia ↔ Sottolinea se sono gli ultimi due scelti.
- Dopo lo scambio un'etichetta 1 s accanto alla barra strumenti ("Sottolinea") e lo stesso testo in `aria-live="polite"`.
- Ignorato: nei campi di testo (lì scrive uno spazio), durante un trascinamento o un tratto della gomma, con `event.repeat`, con un dialogo, la tavolozza o un menu aperti, con il fuoco fuori dalla regione del lettore (es. nella chat).
- Nel lettore Spazio non scorre (si impedisce il default solo quando lo scambio avviene); Maiusc+Spazio scorre indietro di una schermata (come in Chrome, §8.2.7). Nessuna "mano tenendo premuto Spazio": entrerebbe in conflitto con lo scambio; si scorre con rotella, touchpad, PagSu/PagGiù, frecce, J/K.
- Sulla barra strumenti con il fuoco su un pulsante (uso da tastiera) Spazio e Invio attivano **quel** pulsante (comportamento standard di una `toolbar`); per non creare l'ambiguità con il mouse, i pulsanti della barra non prendono il fuoco al clic (`mousedown` con `preventDefault`), quindi dopo un clic il fuoco resta sulle pagine e Spazio scambia.

#### 8.2.3 Fuoco della tastiera

Regione del lettore = `section.reader` (`role="region"`, `aria-label` col titolo). Il contenitore delle pagine ha `tabindex="0"` e prende il fuoco all'apertura del documento e a ogni clic sulle pagine. I tasti dello scope `reader-tool` (§8.2.6) valgono solo se `document.activeElement` è dentro la regione, non è un campo di testo, e non c'è un dialogo, la tavolozza o un menu aperti. F6 passa alla zona successiva (pannello del lettore, pannello Claude) come nel resto dell'app. Dopo la creazione o l'eliminazione di un'annotazione il fuoco resta sulle pagine; aprendo il commento va al campo, chiudendolo torna alle pagine.

#### 8.2.4 Macchina a stati (`views/reader/toolMachine.ts`, pura)

```ts
type Tool = 'select' | 'highlight' | 'underline' | 'eraser';
type Ctx = { tool: Tool; prev: Tool; color: 1|2|3|4|5; tempFrom?: Tool };   // tempFrom: gomma della penna
type Mode =
  | { m: 'idle'; hasSelection: boolean }                       // hasSelection: selezione nativa non vuota (strumento select)
  | { m: 'selecting' }                                         // select + pulsante premuto sul testo
  | { m: 'stroking'; kind: 'highlight' | 'underline'; pointerId: number }
  | { m: 'erasing'; pointerId: number; erased: string[] }
  | { m: 'selected'; annId: string }                           // popover aperto
  | { m: 'commenting'; annId: string; draft: string; original: string };
type Ev =
  | { e: 'tool'; tool: Tool } | { e: 'swap'; repeat: boolean } | { e: 'color'; n: 1|2|3|4|5 }
  | { e: 'down'; on: 'text' | 'annotation' | 'empty'; annId?: string; pointerId: number; pen: 'mouse'|'touch'|'pen'; eraserButton: boolean }
  | { e: 'move'; annIdsUnder: string[] } | { e: 'up'; selectionText: string; annId?: string } | { e: 'cancel' }
  | { e: 'comment' } | { e: 'delete' } | { e: 'esc' } | { e: 'commit-comment' } | { e: 'blur' } | { e: 'doc-change' };
type Effect = 'create' | 'delete' | 'recolor' | 'save-comment' | 'clear-selection' | 'show-popover' | 'hide-popover'
            | 'announce' | 'close-find' | 'root-hint' | 'close-reader';
function step(ctx: Ctx, mode: Mode, ev: Ev, env: { inTextField: boolean; overlayOpen: boolean; findOpen: boolean }):
  { ctx: Ctx; mode: Mode; effects: Effect[] };
```

| Da | Evento (guardia) | A | Effetti |
| --- | --- | --- | --- |
| qualsiasi | evento di tastiera con `inTextField` o `overlayOpen` | invariato | nessuno (il tasto va al campo o al dialogo) |
| `idle` | `tool` X (X ≠ tool) | `idle` | `prev = tool`, `tool = X`, announce |
| `idle` | `swap` (non `repeat`) | `idle` | scambia `tool`/`prev`, announce |
| `idle` | `color` n | `idle` | `color = n` |
| `idle` | `down` su testo, tool `select` | `selecting` | — |
| `idle` | `down` su testo o annotazione, tool pennello | `stroking` | — |
| `idle` | `down`, tool `eraser`, oppure `eraserButton` della penna | `erasing` | con `eraserButton`: `tempFrom = tool`, `tool = eraser` |
| `idle` | `down` su vuoto, tool `select` o pennello | `idle` | clear-selection (clic fuori) |
| `selecting` | `up` con testo | `idle{hasSelection}` | show-popover (mini popover della selezione) |
| `selecting` | `up` senza testo su annotazione | `selected` | show-popover |
| `selecting` | `up` senza testo altrove | `idle` | — |
| `stroking` | `up` con testo | `idle` | create(kind, color), clear-selection; **lo scorrimento non cambia** |
| `stroking` | `up` senza testo, `annId` presente | `selected` | show-popover |
| `stroking` | `up` senza testo altrove, o `cancel` | `idle` | clear-selection |
| `stroking`, `selecting` | `esc` | `idle` | clear-selection |
| `stroking`, `selecting`, `erasing` | `swap`, `tool`, `color` | invariato | nessuno (vale dal gesto successivo) |
| `erasing` | `move` con annotazioni sotto | `erasing` | delete (ognuna una volta), `erased` += id |
| `erasing` | `up` / `cancel` / `esc` | `idle` | toast "N annotazioni eliminate · Annulla" se N > 0; se `tempFrom`: `tool = tempFrom` |
| `selected` | `color` n | `selected` | recolor |
| `selected` | `comment` | `commenting` | — |
| `selected` | `delete` | `idle` | delete, hide-popover, toast con Annulla |
| `selected` | `esc`, `down` fuori dal popover | `idle` | hide-popover (il `down` poi si rielabora da `idle`) |
| `selected` | `swap` / `tool` | `idle` | hide-popover, poi come da `idle` |
| `commenting` | `commit-comment` (Invio senza Maiusc, perdita del fuoco) | `selected` | save-comment se cambiato |
| `commenting` | `esc` | `selected` | save-comment se cambiato (come D-199) |
| `idle{hasSelection}` | `esc` | `idle` | clear-selection |
| `idle`, tool ≠ `select` | `esc` | `idle` | `prev = tool`, `tool = select`, announce |
| `idle`, tool `select`, `findOpen` | `esc` | `idle` | close-find |
| `idle`, tool `select`, nulla aperto | `esc` | `idle` | `ESC_AT_ROOT = 'hint'`: root-hint (una volta per sessione); `'close'`: close-reader (D-329) |
| qualsiasi | `blur` (finestra senza fuoco) o `doc-change` | `idle` | annulla tratti e popover; `tool`, `prev`, `color` restano |

Test: una prova per riga della tabella più le proprietà "Spazio due volte = stato iniziale", "nessun effetto `create` senza testo", "nessun evento cambia `tool` durante `stroking`".

#### 8.2.5 Tocco, penna, touchpad

- **Touchpad di precisione** (eventi `mouse`/`wheel`): due dita scorrono; pizzico = `wheel` con `ctrlKey` → zoom centrato sul puntatore (fattore `exp(-deltaY × 0,01)`, limiti 25-400%), con trasformazione CSS immediata e nuovo disegno di pdf.js 150 ms dopo l'ultimo evento; il clic e il trascinamento fisico o "tocca e trascina" sono un normale trascinamento (tratto con i pennelli).
- **Schermo tattile** (`pointerType: 'touch'`): con Seleziona si scorre e si pizzica (`touch-action: pan-x pan-y pinch-zoom`); con un pennello o la gomma `touch-action: none` sulle pagine e il trascinamento disegna. Poiché il trascinamento tattile non crea una selezione nativa, la macchina costruisce l'intervallo con `document.caretRangeFromPoint` all'inizio e a ogni `move` e lo imposta come selezione; il resto del percorso (`readSelection` → `annotations:save`) è lo stesso.
- **Penna**: come il tocco; pulsante gomma (`buttons & 32`) = Gomma temporanea (`tempFrom`).
- Pulsanti laterali del mouse: indietro chiude il lettore e torna all'elenco (navigazione, §3).

#### 8.2.6 Tasti personalizzabili

Scope nuovo `reader-tool` in `@rl/core` `shortcuts.ts` (e nella copia `shortcutDefs.ts`): accetta un tasto senza modificatori (lettere, cifre, `Space`, `Delete`); i conflitti si controllano dentro lo scope e con `reader`. Id: `reader.tool.select` (V), `reader.tool.highlight` (H), `reader.tool.underline` (U), `reader.tool.eraser` (E), `reader.tool.swap` (Space), `reader.color.1..5` (1-5), `reader.comment` (C), `reader.annotation.delete` (Delete). Nello scope `reader`: `reader.close` (Ctrl+W). N/P/J/K restano fissi.

La creazione usa il percorso di oggi (`viewer.readSelection()` → `annotations:save`): le regole di D-188/D-198/D-199 (limiti, pagine multiple, errori) non cambiano. Difetto misurato dall'audit da correggere e coprire con un test: dopo il salvataggio la vista non deve spostarsi (si conserva `scrollTop` del contenitore e la pagina corrente; e2e: crea un'evidenziazione a pagina 1 e verifica che la pagina visibile resti 1).


#### 8.2.7 Correzioni del giro 3 (D-360)

- Gli strumenti stanno nella barra unica del lettore (§4.3), non in una barra flottante; la macchina a stati non cambia.
- **Spazio e scorrimento:** la prima volta (per profilo) che Spazio cambia strumento compare accanto agli strumenti per 6 s "Spazio cambia strumento. Per scorrere: PagGiù, o Maiusc+Spazio per tornare su." con (Ho capito); Maiusc+Spazio scorre indietro di una schermata come in Chrome; PagGiù/PagSu, frecce, J/K restano.
- **Gomma con trascinamento:** se un tratto tocca più di 3 annotazioni, al rilascio non si elimina nulla e compare il popover "Eliminare 5 annotazioni? [Elimina] [Annulla]" accanto al punto di rilascio; fino a 3 si eliminano con il toast "Annulla". (Nuova riga della tabella di §8.2.4: `erasing` + `up` con più di 3 → `idle` con effetto `confirm-erase`.)
- **Indicazione dello strumento:** cursore con forma e pallino del colore, bordo superiore dell'area delle pagine nel colore del tratto, strumenti attenuati quando il fuoco è fuori dalla regione (§4.3).
- **Annotazioni da controllare** (§8.1.2): non si scrivono nel PDF e compaiono nel gruppo "Da controllare".

### 8.3 Scrittura delle annotazioni nel PDF originale (decisione dell'utente)

Nota del giro 4 (D-410): il chip PDF della barra del lettore è diventato il gruppo PDF del menu Studio (intestazione di stato e voci); dove questa sezione dice "chip PDF" o "menu del chip PDF" si intende quel gruppo.

> Decisione dell'utente (2026-11-17, riportata dal coordinatore): «highlights and underlines must be WRITTEN INTO THE ORIGINAL PDF so they show in Chrome and other readers». Cambia la regola assoluta 1 solo per questo caso (D-316). **Area sensibile: richiede una revisione security dedicata** (oltre alla revisione indipendente) prima del merge di G4a e G4b, con potere di blocco; il prototipo dell'onda 0 la prepara. Finché la revisione non dà il via, tutto il percorso resta spento da una costante di compilazione `PDF_WRITE_ENABLED = false` (D-354): le annotazioni restano nell'app e il chip dice "Solo nell'app".

#### 8.3.1 Regola

Gli originali non si spostano, non si rinominano, non si cancellano e il loro contenuto non si altera mai; l'unica scrittura ammessa è l'**aggiunta incrementale** di oggetti di annotazione PDF standard creati da un gesto esplicito dell'utente nel lettore: `/Highlight`, `/Underline` (in futuro `/StrikeOut`), con il commento nel campo `/Contents` dell'annotazione stessa (gli altri lettori lo mostrano come popup); niente `/Text` né `/Popup` separati (le note per pagina restano Markdown nell'app). I byte originali restano un **prefisso esatto** del file, sempre ripristinabile. Testo in `docs/RULES.md` e `CLAUDE.md` (già aggiornati in questo ramo).

#### 8.3.2 Cosa si scrive

Per ogni annotazione dell'app (`Annotation`), due oggetti nuovi:

```
A 0 obj
<< /Type /Annot /Subtype /Highlight            % o /Underline
   /Rect [x1 y1 x2 y2]                         % unione dei quadrilateri, spazio utente della pagina, 2 decimali
   /QuadPoints [ … 8 numeri per rettangolo … ]  % per rettangolo: x1 y2  x2 y2  x1 y1  x2 y1 (alto-sx, alto-dx, basso-sx, basso-dx)
   /C [r g b] /CA 1                             % riempimento (Highlight) o tratto (Underline) da §5.2.3
   /P P 0 R  /F 4                               % pagina; stampabile
   /NM (rl-<annotationId>)                      % nome unico: lega l'oggetto all'annotazione dell'app
   /T (<nome>)                                  % solo se annotations.author = 'profile' e il nome esiste (D-328: predefinito 'none')
   /Contents (<commento>)                       % solo se c'è un commento
   /CreationDate (D:YYYYMMDDHHmmSSZ) /M (D:…)   % /M aggiornata a ogni modifica
   /AP << /N B 0 R >>                           % aspetto: Chrome/PDFium, Edge, Preview e Acrobat lo usano
>>
B 0 obj  % Form XObject /BBox = /Rect; Highlight: rettangoli pieni nel colore con /Resources << /ExtGState << /G0 << /BM /Multiply /CA 1 >> >> >>;
         % Underline: per ogni rettangolo una linea di spessore max(0,75 pt, altezza/14) a 1/7 dell'altezza dal basso
```

- Stringhe di testo (`/Contents`, `/T`) in UTF-16BE con BOM se non ASCII, altrimenti stringa letterale con `\(`, `\)`, `\\` e caratteri di controllo in ottale; mai interpolate come sintassi; lunghezza massima 8000 caratteri (oltre: troncate con "…" e la nota "testo completo in Research Lab").
- **Geometria:** i rettangoli dell'app sono normalizzati 0..1 con origine in alto a sinistra della pagina **come la mostra pdf.js** (dopo `/Rotate`, sul `CropBox`). `toPdfQuads(rects, geom)` (pura) inverte la trasformazione della vista: `CropBox` (ripiego `MediaBox`, ereditati dal nodo `/Pages` se mancano), `/Rotate` (0/90/180/270, ereditato, normalizzato modulo 360), `/UserUnit`. Test con le quattro rotazioni, `CropBox` spostato e non all'origine, `UserUnit` 2, e confronto con `page.getViewport().convertToPdfPoint` di pdf.js su PDF sintetici.

#### 8.3.3 Percorso di una scrittura (worker + main)

Il codice che legge byte del PDF (dati ostili) gira **nel worker** (processo separato con il watchdog esistente; modulo `pdf-annot` caricato con `import()` solo alla prima scrittura); copie, rinomine e registri restano **nel main**. Il renderer passa solo `docId`.

1. **Quando** (main, `main/study/pdf-sync.ts`; D-349): l'annotazione si salva subito nell'app (come oggi). Nel PDF si scrive **una revisione che raccoglie tutte le modifiche** dall'ultima scrittura, solo in questi momenti: chiusura del documento nel lettore, cambio di documento o di libreria, chiusura dell'app (attesa massima 5 s, poi `pending` e ripresa all'avvio), e, a documento aperto, dopo 120 s senza modifiche alle annotazioni, al massimo una volta ogni 10 minuti; per i file oltre 50 MB niente scritture a documento aperto. Perché: ogni scrittura fa ricaricare **l'intero file** al servizio di sincronizzazione (un libro da 80 MB annotato per un'ora: con lotti ogni 4 s centinaia di caricamenti, così 1-3) e ogni sostituzione durante un caricamento rischia una copia in conflitto. Una coda per documento serializza le scritture (la stessa di `annotations:save`, D-188). Le annotazioni senza `geom: 2` (§8.1.2) non entrano mai nel piano.
   Prima di tutto: il consenso della libreria (§8.3.7). Senza `writeToPdfConfirmedAt` non si va oltre questo passo.
2. **Controlli preliminari** (main): percorso con `resolveInRoot` + `realpath` dentro la radice; `stat` (dimensione, `mtimeMs`), scrivibilità (`fs.access W_OK`), dimensione ≤ `maxBytes`; `pdfMode` del documento e `writeToPdf` della libreria.
3. **Analisi e piano** (worker, `pdf-annot/plan.ts`): lettura ad accesso casuale (mai tutto il file in memoria): l'ultimo `startxref` cercato negli ultimi 64 KiB (i dati dopo l'ultimo `%%EOF` sono ammessi e restano dove sono, D-351); se il trailer ha `/Encrypt` con password utente vuota e G4c è presente, chiave del file dal gestore standard (R2-R6) e decifratura delle stringhe e degli stream letti, cifratura con la chiave per oggetto di quelli scritti; altrimenti rifiuto (§8.3.5); catena delle sezioni xref (tabella classica, stream xref con `/W` `/Index` e predittore PNG, file ibridi con `/XRefStm`, `/Prev` con rilevamento di cicli), stream di oggetti (`/ObjStm`) per gli oggetti compressi; controlli di rifiuto (§8.3.5); albero delle pagine fino alla pagina toccata (con `/Count` e protezione dai cicli); `/Annots` della pagina. **Riconciliazione:** si leggono le annotazioni con `/NM (rl-…)` di quelle pagine e si confrontano con quelle dell'app (§8.3.7); il risultato è un piano di aggiunte, modifiche e rimozioni e i byte dell'aggiornamento:
   - oggetti nuovi numerati da `/Size`;
   - **`/Annots` sempre indiretto**: alla prima scrittura su una pagina, se `/Annots` è in linea o manca, si riscrive la pagina (stesso numero e generazione, dizionario ricopiato elemento per elemento con lo stesso serializzatore testato) con `/Annots N 0 R`; dalle volte successive si riscrive solo l'array `N`, mai più la pagina; gli altri riferimenti dell'array restano nello stesso ordine e i nostri si aggiungono in fondo;
   - modifica = nuova versione dello stesso oggetto (stesso numero, stessa generazione) e del suo aspetto;
   - rimozione = l'array `/Annots` senza quel riferimento; l'oggetto resta nel file senza riferimenti (nessuna voce libera nell'xref: meno casi, nessun rischio sulla catena dei liberi);
   - nuova sezione xref dello **stesso tipo** dell'ultima (tabella classica se l'ultima lo era, anche per i file ibridi; stream xref **non compresso** `/Type /XRef /W [1 4 2]` altrimenti), con `/Prev`, `/Root`, `/Info`, `/Size` aggiornato e `/ID` (primo elemento invariato, secondo nuovo); `startxref`, `%%EOF`, a capo prima dell'aggiornamento se il file non termina con `\n`.
4. **Copia di sicurezza alla prima scrittura del file** (main): SHA-256 completo dell'originale, che deve coincidere con `hash` del record (altrimenti `changed`: prima si lascia lavorare la scansione); copia atomica in `pdfBackupDir(...)/<docId>-<hash8>.pdf` (temporaneo, `fsync`, verifica dell'hash, rinomina), confinata con `resolveInRoot` della cartella dati; poi si scrive nel record `pdfWrite.base = { hash, size }` e `pdfWrite.backup` (**prima** di toccare l'originale: chi legge il record sa sempre come tornare indietro). Una sola copia per contenuto: se esiste già con lo stesso hash non si rifà.
5. **Temporaneo** (main): voce nel registro `<localData>/pdf-write/journal.json` (percorso del temporaneo, `docId`, ora; scrittura atomica); `copyFile(originale, temporaneo, COPYFILE_EXCL)` nella stessa cartella con nome nascosto `.<nome>.rl-<8 hex>.tmp` (su Windows CopyFileW copia anche i flussi alternativi, come il contrassegno di provenienza, e gli attributi; la data di creazione diventa quella della copia: accettato); apertura `r+`, scrittura dell'aggiornamento alla posizione = vecchia dimensione, `fsync`, chiusura.
6. **Verifica** (worker): (a) strutturale, sempre: dal nuovo `startxref` si risolvono la nuova sezione, ogni oggetto nostro e l'array `/Annots` di ogni pagina toccata, e ogni `/NM` atteso c'è una volta sola; (b) i primi `vecchia dimensione` byte del temporaneo hanno lo stesso hash dell'originale (si calcola nella stessa lettura sequenziale che produce lo SHA-256 del temporaneo, che serve al passo 8); (c) con pdf.js **solo alla prima scrittura di un file** (e dopo un ripristino), entro il limite di dimensione dell'estrazione del testo: apertura, stesso numero di pagine, `getAnnotations()` delle pagine toccate contiene i nostri `/NM` con il sottotipo giusto. Una verifica fallita = `refused: verify-failed`, temporaneo cancellato, nessuna scrittura (e un rapporto nella diagnostica, senza contenuto del PDF).
7. **Ricontrollo e rinomina** (main): l'originale deve avere ancora dimensione e `mtimeMs` del passo 2 e lo stesso SHA-256 dei primi e degli ultimi 64 KiB (TOCTOU, spirito di D-200); altrimenti `CONFLICT` (`changed`), temporaneo cancellato, il lotto riparte dopo la scansione. Prima della rinomina l'hash e la dimensione attesi si registrano in memoria (`expectedWrites`), così l'evento dell'osservatore dei file che arriva prima dell'aggiornamento del record si riconosce e si ignora (attacco B.2.9). Poi `rename(temporaneo, originale)` (MoveFileExW con sostituzione) con nuovi tentativi su `EPERM`/`EBUSY`/`EACCES` a 200, 600, 1500 ms (come `atomicWriteJson`).
8. **Dopo la rinomina**: record del documento con `hash` = SHA-256 del nuovo file e la coppia aggiunta a `pdfWrite.own` (ultimi 20); annotazioni dell'app con `pdf: { objNum, gen, rev }` (`rev` = hash del contenuto semantico scritto, §8.3.7); voce tolta dal registro; eventi `library:changed` (`kind: 'annotations'`) e `annotations:pdfProgress`.

Dopo un arresto a metà: all'avvio e all'apertura di una libreria si leggono le voci del registro e si cancellano **solo** i temporanei elencati che esistono ancora, hanno il nome atteso e stanno nella radice della libreria (mai altri file). La rinomina è atomica: l'originale è o quello vecchio o quello nuovo. Se l'arresto è avvenuto tra la rinomina e l'aggiornamento del record, la scansione vede un file cresciuto con il prefisso uguale al vecchio `hash` e lo riconosce come aggiornamento incrementale (§8.3.6); la riconciliazione successiva ritrova le annotazioni dal loro `/NM`.

`fsync` della cartella non esiste su Windows: si accetta (il contenuto del temporaneo è già su disco; NTFS registra la rinomina nel suo giornale).

#### 8.3.4 File occupati, sincronizzazione, più computer

- **File aperto in un altro programma** (Acrobat e altri tengono il file senza condivisione di cancellazione): la rinomina fallisce anche dopo i tentativi → stato `pending`, motivo `locked`; nuovi tentativi alla chiusura del lettore, al ritorno del fuoco sulla finestra, alla modifica successiva e all'avvio, **mai** un ciclo di polling. Dopo 10 minuti di `pending`: riga "Da guardare" in Attività e banner nel lettore se il documento è aperto ("Il file è aperto in un altro programma. Chiudilo: le evidenziazioni si scriveranno da sole. [Riprova]").
- **Il lettore dell'app** non deve tenere il file aperto (da verificare nella prova S2: il protocollo `rl-doc://` legge a intervalli e chiude); se lo tenesse, la scrittura si farebbe alla chiusura del lettore.
- **Servizio di sincronizzazione al lavoro** (es. OneDrive che carica il file): stesso trattamento di `locked` (tentativi, poi `pending`). Un file non scaricato (solo nel cloud) si scarica alla lettura; se non è disponibile (rete assente) il lotto resta `pending` con motivo `unavailable`, non è un rifiuto.
- **Modo di commit** (`commitStrategy`, D-349): `'rename'` (temporaneo + rinomina, sopra) è il predefinito perché il file diventa visibile solo dopo la verifica. La prova S2 misura con il servizio di sincronizzazione anche `'append'`: dopo la verifica del prefisso e una voce nel registro con la vecchia dimensione, apertura `r+` dell'originale, scrittura in coda, `fsync`; dopo un arresto il registro tronca alla vecchia dimensione. Conserva identità, flussi alternativi, attributi e data di creazione e non crea l'evento "sostituito" che può generare copie in conflitto; non è atomico (un lettore che apre il file durante i pochi millisecondi della scrittura vede la vecchia revisione più byte incompleti, che i lettori PDF ignorano cercando l'ultimo `startxref` valido). Il passaggio a `'append'` richiede una decisione nuova e la revisione security.
- **Due computer**: ogni computer scrive solo ciò che manca rispetto allo stato dell'app (riconciliazione), quindi quando il PDF e il file delle annotazioni arrivano sincronizzati non si riscrive nulla. Se due computer scrivono lo stesso PDF prima di sincronizzarsi, il servizio crea una **copia in conflitto** (nome con il computer): la scansione la riconosce perché il suo prefisso è `pdfWrite.base` di un documento esistente (candidati: documenti con `pdfWrite` e nome di file contenuto nel nome nuovo; poi verifica dell'hash del prefisso) e la mette in Da rivedere come "Copia in conflitto di «Titolo»" con [Confronta] [Tieni come documento separato] [Ignora]; l'app non la cancella mai (regola 1). Il PDF "vincitore" riceve le annotazioni mancanti alla riconciliazione successiva.

#### 8.3.5 Rifiuti e messaggi

Un rifiuto non perde nulla: l'annotazione resta nell'app; il chip "PDF:" mostra "Solo nell'app" con l'icona ⓘ e il motivo; nessun nuovo tentativo finché il file non cambia.

| Motivo (`reason`) | Quando | Testo per l'utente (chip ⓘ, Info) |
| --- | --- | --- |
| `encrypted` | `/Encrypt` con password utente non vuota, gestore diverso dallo standard, oppure password vuota finché G4c non c'è | password vuota senza G4c: "PDF protetto dall'editore: le evidenziazioni restano in Research Lab."; altrimenti "Questo PDF è protetto da password: le evidenziazioni restano in Research Lab." |
| `permission` | cifrato con password vuota e `/P` senza il bit 6 (l'editore vieta di aggiungere annotazioni) | "L'editore di questo PDF non permette di aggiungere annotazioni: restano in Research Lab." |
| `signed` | una firma presente (`/V` in un campo `/FT /Sig`) o `/Perms` con `/DocMDP`; i campi firma vuoti e `/SigFlags` da soli **non** bastano (D-351) | "Questo PDF è firmato digitalmente: scriverci renderebbe la firma non valida. Le evidenziazioni restano in Research Lab." |
| `xfa` | `/XFA` nell'`/AcroForm` | "Questo è un modulo XFA: non si può annotare in modo sicuro." |
| `damaged` | `startxref` assente negli ultimi 64 KiB o fuori dal file, oggetto non trovato all'offset, cicli, generazioni incoerenti, pagina o `/Annots` non risolvibili (i dati dopo `%%EOF` **non** sono un motivo) | "Il PDF ha una struttura danneggiata: per sicurezza non lo modifichiamo." |
| `read-only` | attributo di sola lettura o cartella non scrivibile | "Il file è in sola lettura." |
| `too-large` | oltre `maxBytes` (512 MiB) | "Il file è troppo grande per scriverci in sicurezza." |
| `too-many-revisions` | più di `maxRevisions` (200) revisioni nostre (raro con le scritture alla chiusura) | senza annotazioni di altri programmi dopo `base`: "Molte modifiche accumulate: [Riscrivi in una revisione]" (troncamento + una revisione, il prefisso resta intatto); con annotazioni di altri programmi: scrittura sospesa, "[Esporta una copia annotata…]" (D-352) |
| `verify-failed` | la verifica del passo 6 non passa | "Non siamo riusciti a scrivere in modo verificabile: le evidenziazioni restano in Research Lab." |
| `pending: locked` / `pending: unavailable` | §8.3.4 | "In attesa: il file è aperto in un altro programma" / "In attesa: il file non è disponibile" |

Il prototipo dell'onda 0 misura, in sola lettura, la percentuale di rifiuti per motivo sulla libreria di prova dell'utente (`RL_FIXTURE_LIBRARY`, solo conteggi, nessun nome nel rapporto), separando i cifrati con password vuota: se superano il 2% si fa G4c (D-351); se `damaged` supera il 5% si studiano i casi prima dell'onda 4.

#### 8.3.6 Identità del documento (hash del file e hash del contenuto)

Molte cose dipendono dall'hash del contenuto: id del documento (D-006, stabile), `hash` e `previousHashes` del record, `forHash` delle annotazioni, URL `rl-doc://…?v=<hash8>`, miniature, cache del testo, cache AI, input del grafo, duplicati della cartella di arrivo, criterio della fase 3 "hash identico".

- `hash` resta l'hash del **file attuale** (versiona `rl-doc` e riconosce il file).
- Nuovo `pdfWrite` nel record (`documents/<id>.json`, sincronizzato):
  ```ts
  pdfWrite?: {
    base: { hash: Sha256; size: number };                      // i byte prima della nostra prima aggiunta
    own: Array<{ hash: Sha256; size: number; at: IsoDate }>;   // file prodotti dalle nostre scritture (ultimi 20)
    backup?: { file: RelativePath; hash: Sha256; location: 'data' | 'local' };
  }
  ```
- `contentHashOf(doc) = doc.pdfWrite?.base.hash ?? doc.hash` in `@rl/core`. **Tutti** i consumatori legati al contenuto passano a `contentHashOf`: miniature (non si rigenerano), cache del testo (non si riestrae), cache AI, `forHash` delle annotazioni (non diventano "non allineate"), input del grafo, duplicati della cartella di arrivo (che confrontano `hash`, `previousHashes`, `base.hash` e gli hash di `own`: trascinare la versione non annotata dello stesso articolo è riconosciuto come duplicato).
- **Regola della scansione** quando dimensione o `mtime` cambiano (D-350: si classifica **il contenuto** della revisione aggiunta, non chi l'ha scritta):
  1. scorciatoia: nuovo hash in `expectedWrites` (in memoria) o in `pdfWrite.own` → scrittura nostra: aggiorna `hash`, nessun "cambiato", nessuna estrazione;
  2. altrimenti, file **cresciuto** e SHA-256 dei primi `vecchia dimensione` byte = vecchio `hash` (o dei primi `base.size` byte = `base.hash`) → aggiornamento incrementale. Il worker legge **solo le sezioni aggiunte** (dal vecchio `startxref` in avanti) e le classifica: se contengono soltanto oggetti `/Annot`, XObject di modulo puntati da `/AP` di quelle annotazioni, array `/Annots`, pagine il cui dizionario differisce dalla versione precedente solo in `/Annots`, il dizionario `/Info` e lo stream `/Metadata`, è **"solo annotazioni"**: `pdfWrite.base` = vecchio contenuto se mancava, `hash` aggiornato, nessuna estrazione, le annotazioni restano allineate, le miniature non cambiano (vale per l'altro computer prima che arrivi il record sincronizzato, per Acrobat e per ogni altro programma); se contiene altro (stream di contenuto, font, pagine nuove o tolte, campi di modulo), si rilegge il testo e, se differisce dalla cache, si tratta come contenuto cambiato;
  3. **salvataggio completo** (prefisso cambiato) con testo estratto uguale alla cache: "solo annotazioni" anche così (D-371): `pdfWrite.base` passa al nuovo file (la copia di sicurezza vecchia resta), le nostre annotazioni si riagganciano per `/NM (rl-…)` (o, se `/NM` è stato tolto, per sottotipo e `/QuadPoints` entro 1 pt) aggiornando numero e generazione, mai riaggiunte; quelle che mancano vanno in "Da controllare";
  4. altrimenti contenuto cambiato davvero (logica di oggi: `previousHashes`, annotazioni non allineate, `pdfWrite` azzerato; la copia di sicurezza resta finché l'utente non la toglie).
  Costo: un hash del prefisso e la lettura delle sole sezioni aggiunte (pochi KiB), solo per i file cambiati. Il classificatore (`pdf-annot/classify.ts`) sta nello stesso chunk pigro dello scrittore.
- Criterio della fase 3: con `writeToPdf` spento l'hash resta identico; acceso, i byte originali sono un prefisso esatto e `contentHashOf` non cambia (`study-data.spec.ts`, `check-nondestructive.mjs --allow-pdf-append`: accetta solo file cresciuti con prefisso identico e un `/NM (rl-…)` registrato).

#### 8.3.7 Riconciliazione, modifiche, eliminazioni, altri programmi

- **Fonte di verità:** `annotations/<docId>.json` dell'app. Il PDF è una proiezione per gli altri lettori.
- **Contenuto semantico** di un'annotazione nel PDF: sottotipo, `/QuadPoints` arrotondati a 0,01, `/C`, `/Contents`, `/T`. `rev` = SHA-256 di questo contenuto serializzato in modo canonico; si salva nell'annotazione dell'app dopo ogni scrittura.
- **Confronto a tre** per ogni `/NM (rl-<id>)` (stato dell'app, stato nel PDF, `rev` dell'ultima scrittura):

| App rispetto a `rev` | PDF rispetto a `rev` | Azione |
| --- | --- | --- |
| uguale | uguale | nulla |
| cambiata | uguale | scrivi la nuova versione |
| uguale | cambiata (colore o commento cambiati in un altro programma) | **adotta** nell'app (l'utente l'ha cambiata altrove); riga in Attività "1 annotazione aggiornata da un altro programma" |
| uguale | sparita dal PDF | **mai adottata in automatico** (D-371): l'annotazione va in "Da controllare" e in Attività con [Riscrivi nel PDF] [Elimina anche qui]; nessuna scrittura finché l'utente non sceglie |
| cambiata | cambiata | vince l'app (modifica più recente fatta qui); riga in Attività |
| cambiata | sparita | "Da controllare" come sopra |
| eliminata nell'app | presente | togli il riferimento |
| presente, senza `pdf` | assente | aggiungi |

- **Annotazioni di altri programmi** (senza `/NM (rl-…)`): mai modificate, spostate o tolte (l'array `/Annots` le conserva nello stesso ordine). Il lettore le legge con pdf.js (`page.getAnnotations()`, solo pagine visibili) e le elenca nel pannello "Dal PDF (altri programmi)" in sola lettura: tipo, pagina, autore (`/T`) e testo (`/Contents`, come testo puro). pdf.js le disegna già nella tela. Facoltativo (onda 5): "Importa nell'app" crea un'annotazione dell'app con un `/NM` nuovo e lascia l'originale com'è.
- **Doppio disegno** delle nostre annotazioni già scritte (tela di pdf.js + sovrapposizione dell'app): la prova S2 sceglie tra (a) nasconderle dalla tela con l'`annotationStorage` di pdf.js per i riferimenti noti, (b) disegnare la tela con `annotationMode` che salta gli oggetti `/NM (rl-…)` (filtro sugli `annotationId` restituiti da `getAnnotations()`), (c) non sovrapporre le annotazioni scritte e usare la sovrapposizione solo per il clic e per quelle in attesa, ridisegnando la pagina dopo ogni scrittura. Criterio: nessun doppio disegno visibile, anche mentre una modifica aspetta la scrittura successiva.
- **Migrazione delle annotazioni già fatte:** mai in silenzio. Nel lettore il chip dice "PDF: 12 solo nell'app ▾ · Scrivile nel PDF"; in Impostazioni › Libreria › Annotazioni nel PDF "Scrivile nei PDF…" con dialogo (numero di file, spazio stimato delle copie, documenti saltati perché hanno annotazioni da controllare, §8.1.2) e avanzamento in Attività (annullabile, un file alla volta). Le annotazioni non allineate (`staleIds`) e quelle senza `geom: 2` non si scrivono mai.
- **Consenso prima della prima scrittura, per libreria** (D-348). Il predefinito resta acceso (scelta dell'utente), ma nessun PDF di una libreria si modifica finché `annotations.writeToPdfConfirmedAt` è vuoto.
  - Librerie esistenti (D-374): alla **prima** creazione o modifica di un'annotazione nella libreria compare nel `banner-slot` del lettore un **banner non modale**, che non prende il fuoco e non interrompe il gesto (Spazio e i tasti degli strumenti continuano a funzionare):
    ```
    ┃ Salvare le evidenziazioni anche dentro i PDF?  Così le vedi anche in Chrome, Edge e negli altri lettori;    ┃
    ┃ il testo non cambia, si scrive quando chiudi il documento e puoi sempre toglierle.  (Come funziona)          ┃
    ┃                                                              [Solo nell'app]  [[Sì, anche nel PDF]]       ┃
    ```
    La scrittura aspetta la risposta. Se alla chiusura del documento non c'è risposta, compare **allora**, una volta, un dialogo con lo stesso testo e le stesse due scelte; chiuderlo senza scegliere = nessuna scrittura e il banner torna alla prossima annotazione. "Sì" scrive `writeToPdfConfirmedAt`; "Solo nell'app" mette `writeToPdf = false` (si cambia in Impostazioni › Libreria). Il valore è nel `library.json` sincronizzato: la scelta vale su ogni computer.
  - Librerie nuove: nel **corpo** del Riepilogo della procedura guidata, visibile senza scorrere, una riga con interruttore acceso "Salva le evidenziazioni anche dentro i PDF (le vedi in Chrome e negli altri lettori; il testo non cambia)"; il pulsante finale "Crea la libreria" ha sotto la frase "Le evidenziazioni si salveranno anche dentro i PDF" (o "solo nell'app"); completare con l'interruttore acceso scrive `writeToPdfConfirmedAt`.
  - Il banner "primo uso" del giro 2 non c'è più: l'informazione arriva prima, non dopo.

#### 8.3.8 Ripristino

Due azioni, la prima non distruttiva (D-352):

1. **Togli dal PDF le evidenziazioni di Research Lab** (chip PDF, scheda Info; in Avanzate per tutti i documenti, lavoro annullabile): una revisione incrementale che toglie dagli array `/Annots` solo i riferimenti `/NM (rl-…)`; le annotazioni di altri programmi restano, il prefisso resta intatto. Poi `pdfMode: 'app-only'` e le annotazioni perdono `pdf`. Dialogo di conferma breve ("Le evidenziazioni restano nell'app").
2. **Ripristina il file esattamente com'era…** (menu ⋯ del chip, Avanzate): troncamento ai byte originali. Dialogo: "Il file tornerà byte per byte com'era prima della prima scrittura di Research Lab." e, se presenti, in evidenza "Si perderanno anche N annotazioni aggiunte nel frattempo da altri programmi." (conteggio dalle revisioni successive a `base`), con il pulsante che ripete l'azione. Esecuzione con lo stesso percorso di §8.3.3: temporaneo = primi `base.size` byte; SHA-256 = `base.hash`, altrimenti la copia di sicurezza (verificata con il suo hash); poi `pdfMode: 'app-only'`.

"Elimina le copie degli originali" (Avanzate) chiede conferma e avvisa che il ripristino esatto userà solo il troncamento.

#### 8.3.9 Impostazioni

- `library.json` › `annotations: { writeToPdf: boolean = true, writeToPdfConfirmedAt: IsoDate | null = null, author: 'profile' | 'none' = 'none', backupLocation: 'data' | 'local' = 'data' }` (sincronizzato: la libreria si comporta allo stesso modo su ogni computer). Si scrive solo con `writeToPdf && writeToPdfConfirmedAt` (D-348). Predefiniti di `author` e `backupLocation` provvisori (D-327, D-328): si cambiano solo nello schema.
- Override per documento nel file delle annotazioni: `pdfMode?: 'app-only'` (dal ripristino o da "Mantieni solo nell'app per questo documento").
- Spegnere `writeToPdf` non tocca i PDF: dialogo "Vuoi anche ripristinare gli originali già modificati (N)?" con [Ripristina N file] e [Lasciali così].

#### 8.3.10 Contratti (`@rl/core`, scritti dall'agente principale prima dell'onda 4)

```ts
// model/document.ts (additivo)
pdfWrite: pdfWriteSchema.optional()                                  // §8.3.6
export function contentHashOf(d: Pick<DocumentRecord, 'hash' | 'pdfWrite'>): string

// model/annotation.ts (additivo)
annotationSchema.extend({ pdf: z.object({ objNum: int>0, gen: int>=0, rev: sha256 }).optional() })
annotationFileSchema.extend({ pdfMode: z.enum(['app-only']).optional() })

// settings.ts (additivo, con predefiniti)
libraryConfig.annotations = { writeToPdf = true, author: 'profile'|'none' = 'none', backupLocation: 'data'|'local' = 'data' }

// limits.ts
PDF_WRITE_ENABLED = false                          // costante di compilazione (D-354), accesa dopo la revisione security
annotationSchema.extend({ geom: z.literal(2).optional() })            // §8.1.2 (scritto prima, in H0)
PDF_WRITE_LIMITS = { maxBytes: 512 MiB, maxRevisions: 200, idleWriteMs: 120000, minIntervalMs: 600000,
                     idleWriteMaxBytes: 50 MiB, closeWaitMs: 5000, lockedBannerMs: 600000, tailSearchBytes: 65536,
                     ownHashes: 20, maxDepth: 64, maxStringBytes: 65536, maxObjStmObjects: 100000,
                     maxInflatedBytes: 64 MiB, maxPrevChain: 1000, workerTimeoutMs: 10000, maxContentsChars: 8000 }

// ipc/channels/annotations.ts (canali nuovi)
'annotations:pdfState'  { docId } → { mode: 'write'|'app-only'|'off',
                                     state: 'synced'|'pending'|'writing'|'refused'|'none',
                                     needsConsent: boolean, needsRepair: number,
                                     reason?: 'encrypted'|'permission'|'signed'|'xfa'|'damaged'|'read-only'|'too-large'|'too-many-revisions'
                                            |'verify-failed'|'locked'|'unavailable'|'changed',
                                     appOnly: number, external: number, lastWrittenAt?: IsoDate }
'annotations:writeNow'  { docId } → pdfState
'annotations:setPdfMode'{ docId, mode: 'write'|'app-only' } → pdfState
'annotations:confirmPdfWrite' { choice: 'pdf' | 'app-only' } → pdfState      // dialogo del consenso (§8.3.7)
'annotations:removeFromPdf'   { docId } → pdfState                              // azione non distruttiva (§8.3.8)
'annotations:restoreOriginal' { docId } → { restored: boolean, droppedExternal: number }   // troncamento
'annotations:migrate'   { } → { jobId }            // tutta la libreria, un file alla volta
'annotations:restoreAll' { } → { jobId }
'annotations:jobCancel' { jobId } → {}
'annotations:backups'   { } → { count, bytes, location }       // Avanzate
'annotations:deleteBackups' { } → { deleted: number }          // con conferma nel renderer
evento 'annotations:pdfProgress' { docId?, jobId?, state, reason?, done?, total? }
```

Errori: `PERMISSION_DENIED` con `details.reason` per i rifiuti, `CONFLICT` (`changed`) se il file è cambiato tra lettura e rinomina.

#### 8.3.11 Libreria o scrittore proprio, e peso

| Opzione | Peso | Aggiornamento incrementale (prefisso intatto) | Esito |
| --- | --- | --- | --- |
| **Scrittore proprio** `packages/data/src/pdf-annot/` | stima ~1350 righe di codice (lexer 250, oggetti e serializzatore 200, xref classica/stream/ibrida 300, stream di oggetti 80, pagine e geometria 150, piano e riconciliazione 250, aspetti 120): **34-42 KiB** non minificati senza JSDoc (D-177, D-233) | sì, per costruzione | **scelto** |
| pdf-lib 1.17 (già in `packages/testkit` solo per i test) | ~700 KiB non minificati, non mantenuto dal 2021 | no: riscrive il file intero | scartato per l'app (resta per **generare** i PDF sintetici dei test) |
| `saveDocument()` di pdf.js (già presente) | 0 | sì | scartato come motore: crea solo `/Highlight` (non `/Underline`), formato degli editor interno e instabile, carica il documento intero; resta come **verificatore** |
| muhammara, qpdf (nativo o wasm) | 2-10 MB | sì | scartati: peso, binari, superficie d'attacco |

**Budget del main** (somma dei `.js` di `out/main`, worker compreso): oggi 1009/1010 KiB. Aggiunte: scrittore 34-42 con il classificatore delle revisioni (2-3, stesso chunk), account Claude 4-6, rapporto di scansione e `ai:usageAll` 2-3 → **1052-1060**; con G4c (PDF cifrati con password vuota: gestore standard R2-R6 con `node:crypto`, nessuna dipendenza) +6-8 → 1060-1068. Con il riuso di `classify.ts` (G4b) lo scrittore di G4a pesa 32-40 KiB; G4c si fa sempre (D-375). Totale per compito in D-380: main **1060-1076, tetto 1080**: funzione chiesta esplicitamente dall'utente, nessuna dipendenza, codice non minificato per diagnosi leggibili (D-177). Lo scrittore è un chunk separato caricato con `import()` nel worker alla prima scrittura: avvio, memoria a riposo e primo contenuto invariati. Se la prova S2 misura più di 44 KiB per lo scrittore, il compito G4a si ferma e lo riporta prima di proseguire.

#### 8.3.12 Sicurezza (revisione security dedicata)

- Il parser legge **dati ostili**: limiti di `PDF_WRITE_LIMITS` (annidamento 64, stringhe e nomi 64 KiB, oggetti per stream 100 000, decompressione 64 MiB con `maxOutputLength` di zlib, catene `/Prev` 1000 con rilevamento di cicli), tempo massimo 10 s per file nel worker con il watchdog; nessuna ricorsione senza profondità massima; ogni offset controllato contro la dimensione del file.
- Nessun percorso dal renderer: solo `docId`; percorso risolto nel main con `resolveInRoot` + `realpath` e ricontrollato prima della rinomina (D-200); temporanei solo nella cartella del file, con nome casuale e `COPYFILE_EXCL`; pulizia solo dei temporanei registrati.
- Testo scritto nel PDF sempre codificato (§8.3.2); nessun contenuto del PDF nei log (solo motivo, dimensione, numero di oggetti).
- La verifica rifiuta ogni risultato che non si rilegge esattamente.
- Prove con il corpus ostile (`security-hostile-scan.spec.ts` esteso) e con mutazioni casuali dei PDF sintetici (troncamenti, byte cambiati, `/Prev` ciclici, `/Annots` ricorsivo, pagine mancanti): nessuna eccezione non gestita, nessuna scrittura.
- `check:nondestructive` aggiornato (prefisso intatto, solo file con un nostro `/NM` registrato).
- Domande per la revisione: rischio della riscrittura del dizionario della pagina alla prima scrittura; trattamento di file ibridi e linearizzati; copia dei flussi alternativi (contrassegno di provenienza) e attributi; comportamento con antivirus che bloccano la rinomina; sufficienza del ricontrollo TOCTOU a campioni.

#### 8.3.13 Prototipo (onda 0) e test

**Prova S2** (`tools/spikes/pdf-annot/**`, nessun file dell'app): scrittore minimo (aggiunta e rimozione, tabella classica e stream xref), PDF sintetici generati con pdf-lib nel test (tabella classica; stream xref con stream di oggetti; ruotato 90 e 270; `CropBox` spostato; `UserUnit` 2) e scritti a mano come testo (ibrido con `/XRefStm`; linearizzato minimo; con `/Encrypt`; con `/SigFlags 3`; con `/XFA`; troncato; con `/Prev` ciclico). Rapporto in `tools/spikes/pdf-annot/README.md`: righe e KiB del codice, tempo per scrittura su 1, 20 e 100 MB, rifiuti per motivo sulla libreria di prova in sola lettura (solo conteggi), scelta per il doppio disegno (§8.3.7), verifica che `rl-doc://` non tenga il file aperto, quota di PDF cifrati con password vuota e di file con dati dopo `%%EOF`, confronto `commitStrategy` `'rename'`/`'append'` con una cartella sincronizzata di prova (copie in conflitto, cronologia delle versioni, attributi), e una lista di file sintetici da aprire **a mano** in Edge e Chrome (l'agente principale o l'utente) per confermare che evidenziazione e sottolineatura si vedono con il colore giusto.

**Test dell'onda 4** (unitari salvo dove indicato):

| Area | Test |
| --- | --- |
| Lexer e oggetti | numeri, stringhe letterali con escape e annidamento, esadecimali, nomi con `#xx`, array, dizionari, riferimenti, commenti; ogni limite di §8.3.12 |
| Xref | tabella classica con sottosezioni; stream xref con `/W` vari, `/Index`, predittore PNG; ibrido `/XRefStm`; catena `/Prev`; cicli; offset fuori dal file; `startxref` mancante |
| Stream di oggetti | oggetto compresso letto; oggetto compresso riscritto come oggetto normale nell'aggiornamento |
| Pagine | albero con `/Kids` annidati, attributi ereditati, `/Count` incoerente → `damaged`, cicli |
| Geometria | 4 rotazioni, `CropBox` spostato, `UserUnit`, confronto con `convertToPdfPoint` di pdf.js |
| Scrittura | prefisso intatto byte per byte (proprietà su tutti i casi); `/Annots` in linea → indiretto alla prima scrittura e mai più la pagina; aggiunta, modifica, rimozione; ordine e presenza delle annotazioni di altri programmi invariati; `/ID`, `/Size`, `/Prev` corretti; tipo di xref uguale all'ultimo |
| Riconciliazione | ogni riga della tabella a tre di §8.3.7; idempotenza (due lotti con lo stesso stato = un aggiornamento solo); due "computer" simulati |
| Testo | `/Contents` e `/T` con parentesi, barre, a capo, caratteri non latini, emoji; troncamento a 8000 |
| Rifiuti | ogni motivo di §8.3.5 su un file sintetico; **accettati**: dati dopo `%%EOF`, campi firma vuoti con `/SigFlags`, xref ibrida; con G4c: cifrato RC4, AES-128, AES-256 con password vuota (scrittura e rilettura con pdf.js), `/P` senza bit 6 → `permission` |
| Classificazione (D-350) | revisione con sole annotazioni (nostra, di "un altro computer", stile Acrobat con `/Info` e `/Metadata`) → nessun "cambiato", nessuna estrazione; revisione con uno stream di contenuto o una pagina nuova → testo riletto |
| Quando si scrive (D-349) | nessuna scrittura durante l'annotazione; una alla chiusura; una dopo 120 s di inattività e non prima di 10 minuti dalla precedente; nessuna a documento aperto oltre 50 MB; tutte le modifiche in una revisione; evento dell'osservatore della propria scrittura ignorato |
| Consenso (D-348) | senza `writeToPdfConfirmedAt` nessuna scrittura (anche con `writeToPdf` acceso); "Solo nell'app" spegne; la procedura guidata lo imposta |
| Riparazione (D-347) | un'annotazione senza `geom: 2` non entra mai nel piano; la migrazione salta i documenti con annotazioni da controllare |
| Togli dal PDF (D-352) | toglie solo i `/NM (rl-…)`, le altre annotazioni restano, prefisso intatto |
| Atomicità (main) | `EPERM` simulato alla rinomina → `pending` → riuscita al tentativo successivo; file cambiato tra i passi 2 e 7 → `CONFLICT`; arresto simulato dopo il passo 5 → il temporaneo registrato viene pulito, nient'altro; arresto tra rinomina e record → la scansione riconosce l'aggiornamento |
| Copia e ripristino | copia una volta per contenuto; ripristino per troncamento = `base.hash`; ripristino dalla copia quando il troncamento non coincide; `backupLocation` `data` e `local` |
| Identità (G4b) | dopo una scrittura nostra: nessun "cambiato", nessuna estrazione, miniature e cache invariate, annotazioni non "non allineate"; aggiornamento incrementale esterno con testo uguale e con testo diverso; duplicato in arrivo della versione non annotata; copia in conflitto riconosciuta |
| Ostili | corpus ostile esteso e 500 mutazioni casuali deterministiche (seme fisso): nessuna eccezione non gestita, nessuna scrittura |
| e2e | `pdf-annot.spec.ts`: crea, modifica, elimina, file bloccato simulato, ripristino, migrazione, rifiuto di un cifrato con il messaggio giusto (PDF sintetici, una spec alla volta) |

#### 8.3.14 Esporta copia annotata

Con lo stesso scrittore, il menu del chip PDF e il ⋯ del lettore offrono "Esporta una copia annotata…" (scelta della cartella con `dialog:chooseFolder`, scopo `export-destination`, D-017): utile con i PDF rifiutati per `read-only`, `too-many-revisions` o in modalità solo nell'app, e per condividere. Per i file `encrypted`, `signed`, `xfa` e `damaged` non si offre. Onda 5, facoltativa.

---

## 9. Scansione

**Obiettivo:** che si veda sempre se la libreria è aggiornata, che la prima scansione avvenga nella procedura guidata, e che dopo ogni scansione si sappia cosa è successo.

1. **Procedura guidata:** dopo "Riepilogo → Crea", un passo nuovo **"Prima scansione"** (`wizard-scan`): barra di avanzamento con le fasi (Elenco dei file › Impronte › Estrazione del testo › Indice) e i conteggi (`scan:progress`, già emesso perché `library:create` avvia `sync({ autoScan: true })`); pulsanti "Continua in background" (chiude la procedura, la scansione prosegue e si vede nel chip) e, a fine scansione, il riepilogo "Trovati 214 documenti · 3 non leggibili (si cercano per nome)" con "Apri la libreria". I file trovati in questa prima scansione **non** finiscono nel badge di "Da rivedere" (§7.1).
2. **Chip Attività:** `Aggiornata · 14:32` (inattiva) · `Scansione · 45%` con anello di avanzamento · `Scansione · 3 nuovi` (puntino) dopo una scansione con novità non viste. Testid `scan-status` con `data-state` e `data-phase` come oggi.
3. **Popover Scansione** (nel popover Attività, §7.2): fase e conteggi, Annulla; ultimo esito con `aggiunti / cambiati / spostati / mancanti / non leggibili` e un pulsante per ciascuno che apre la Libreria filtrata su quei documenti; "Scansiona ora" (`scan-start`); "Le modifiche nelle cartelle si rilevano da sole: scansiona a mano solo se qualcosa manca."
4. **Ricostruisci indice** (`index-rebuild`): solo in Avanzate › Scansione con la spiegazione ("rilegge il testo di tutti i documenti: può richiedere minuti").
5. **Errori:** scansione fallita → chip rosso + riga nel popover con il messaggio e "Riprova"; cartella radice non raggiungibile → banner.

Contratti (`@rl/core`):

```ts
// ipc/channels/scan.ts (nuovo canale, additivo)
'scan:report' { libraryId? } → {
  finishedAt: IsoDate | null, summary: ScanSummary | null, firstScan: boolean,
  added: DocumentId[], changed: DocumentId[], moved: DocumentId[], missing: DocumentId[], failed: DocumentId[],
  truncated: boolean                    // ogni elenco al massimo SCAN_LIMITS.reportIds = 500
}
// il main tiene l'ultimo rapporto per libreria in <localData>/scan/<libraryId>-report.json (scrittura atomica)

// search filters (additivo): docIds?: DocumentId[] (max 500) → la Libreria filtra su un insieme esplicito
```

---

## 10. Account Claude

### 10.1 Cosa c'è oggi

- `@rl/ai` `detectAccess`: chiave API salvata › variabile `ANTHROPIC_API_KEY` dell'utente › `CLAUDE_CODE_OAUTH_TOKEN` › esistenza di `~/.claude/.credentials.json` (senza leggerlo). **La chiave API vince sempre**: non si può scegliere di usare il login di Claude Code se una chiave è salvata.
- `buildQueryOptions` passa la chiave salvata solo nell'`env` del processo figlio; l'allow-list dell'ambiente lascia passare `ANTHROPIC_*` e `CLAUDE_*` dell'utente.
- `ai:status` (fornitore, accesso, disponibilità, motivo, cartelle, spesa del mese, tetto, eseguibile e sua origine), `ai:usage`, `ai:log`, `ai:chooseExecutable`, `ai:clearExecutable`; la chiave con `secrets:set/has/delete` (ambito `app`, nome `anthropic-api-key`, D-208). Eseguibile: CLI installata dall'utente (D-261), ricerca: scelto › PATH › `~/.local/bin` › copia dell'SDK.
- Manca: scelta esplicita del modo di accesso, avvio del login e del logout di Claude Code, prova della connessione, identità dell'account.

### 10.2 Flusso per l'utente

1. **Vedere:** la scheda Account dice in una frase come è collegato ("Collegato con l'accesso di Claude Code", "Collegato con una chiave API", "Non collegato"), l'account se noto (email e piano da `claude auth status`), l'eseguibile ("Claude Code 2.x trovato nel PATH" con link a Avanzate), l'uso del mese della libreria attiva e il tetto.
2. **Scegliere il modo:** `Automatico` (oggi: chiave se c'è, altrimenti login), `Accesso di Claude Code` (la chiave salvata e `ANTHROPIC_API_KEY` dell'ambiente vengono ignorate), `Chiave API` (il login viene ignorato: niente `CLAUDE_CODE_OAUTH_TOKEN` al figlio). Cambio immediato, nessun riavvio; la chat in corso finisce il turno con il modo vecchio.
3. **Cambiare account Claude Code:** "Cambia account…" → dialogo: "Si aprirà una finestra di Claude Code per accedere. Completa l'accesso nel browser, poi torna qui." → il main apre una console visibile con `claude auth login` → l'app osserva la cartella `~/.claude` (solo l'evento di modifica del file delle credenziali, mai il contenuto) per al massimo 10 minuti → appena cambia, ricontrolla (`ai:account`) e mostra "Collegato come …". Pulsante "Ho finito, verifica" per chi chiude prima.
4. **Uscire:** "Esci da Claude Code…" → conferma: "Uscirai da Claude Code su questo computer, anche nel terminale e in altre app che lo usano." → `claude auth logout` (non interattivo, uscita catturata, timeout 20 s).
5. **Chiave API:** "Aggiungi chiave…" / "Sostituisci chiave…" / "Rimuovi chiave" (come oggi, mai mostrata); avviso se il modo è "Accesso di Claude Code" ("la chiave è salvata ma non viene usata").
6. **Provare:** "Prova la connessione" → una richiesta minima a Haiku senza strumenti né documenti ("Rispondi solo: OK"), registrata nel registro degli invii come `connection-test`, conteggiata nell'uso (< 0,001 $): esito "Funziona · 1,2 s · Haiku 5.5" o l'errore tradotto (accesso negato, offline, tetto raggiunto, eseguibile non trovato). Il clic dell'utente è il consenso: non serve l'anteprima perché non parte nessun contenuto della libreria.
7. **Eseguibile:** "Scegli…"/"Automatico" in Avanzate › Claude; dall'Account solo il link quando non è trovato.

### 10.3 Contratti per il main

```ts
// settings.ts (AppSettings, per macchina, additivo)
ai.authMode: z.enum(['auto','claude-code','api-key']).default('auto')   // cambiato solo con ai:setAuthMode

// ipc/channels/ai.ts (nuovi canali)
'ai:account' {} → {
  authMode: 'auto'|'claude-code'|'api-key',
  effective: 'claude-code'|'api-key'|'none',          // cosa userebbe ora il processo figlio
  apiKey: { stored: boolean; envVar: boolean },        // chiave salvata; ANTHROPIC_API_KEY presente nell'ambiente
  claudeCode: {
    path: string|null, source: 'settings'|'path'|'local-bin'|'sdk'|'none', version: string|null,
    loggedIn: boolean|null,                            // null: non determinabile
    account: { email?: string; organization?: string; plan?: string } | null   // solo da `auth status`, mai da file di credenziali
    supportsAuthCommands: boolean                      // la CLI installata ha `auth login|logout|status`
  }
}
'ai:setAuthMode' { mode } → ai:account
'ai:login'  {} → { started: true }       // apre una console visibile: `<exe> auth login` (ripiego: `<exe>` e istruzione "/login")
'ai:loginDone' {} → ai:account           // ricontrollo manuale
'ai:logout' {} → ai:account              // `<exe> auth logout`; ripiego: istruzioni
'ai:test'   {} → { ok: boolean; ms: number; model: string; usd: number|null; error?: { code: string } }
evento 'ai:accountChanged' ai:account    // emesso dall'osservatore temporaneo e da setAuthMode/logout
```

Realizzazione nel main (`main/ai/account.ts`, nuovo):
- **Eseguibile:** si usa solo quello risolto da `resolveExecutable` (D-261); argomenti fissi; il renderer non passa mai stringhe né percorsi. La console si apre con `spawn('cmd.exe', ['/c', 'start', '""', exe, 'auth', 'login'], { detached: true, windowsHide: false, env: childEnv(...) })` su Windows (equivalenti `open -a Terminal` / `x-terminal-emulator` documentati ma non necessari ora); la riga di comando non contiene dati dell'utente.
- **`auth status`:** `execFile(exe, ['auth', 'status', '--json'], { timeout: 10 s })`; si leggono solo i campi elencati (email, organizzazione, piano, loggedIn); l'output intero non va nei log (contiene dati personali). Se il comando non esiste (`supportsAuthCommands = false`): `loggedIn` da `detectAccess`, nessuna identità, e il login apre `exe` interattivo con l'istruzione "scrivi /login".
- **`detectAccess`/`buildQueryOptions` con `authMode`:** in `claude-code` si toglie `ANTHROPIC_API_KEY` dall'ambiente del figlio e non si passa la chiave salvata; in `api-key` si toglie `CLAUDE_CODE_OAUTH_TOKEN` e si passa la chiave (se manca: `no-access`); `auto` come oggi.
- **Osservatore del login:** `fs.watch(~/.claude)` filtrato sul nome del file credenziali, attivo solo dopo `ai:login`, chiuso dopo il primo evento + 2 s o dopo 10 minuti (niente polling, niente lettura del file).
- **Test:** `completeStructured`/`chat` minimale del provider con `maxBudgetUsd` 0,01, scritto nel registro AI della libreria attiva (scopo `connection-test`); senza libreria attiva: non registrato e non conteggiato, con la nota "nessuna libreria attiva: uso non registrato".
- **Da verificare (spike S1):** nomi e output di `claude auth status|login|logout` sulla versione installata; se mancano, il ripiego sopra.

### 10.4 Uso del mese (D-330, provvisoria)

La scheda Account mostra l'uso della **libreria attiva** (`ai:usage`, come oggi il contatore della chat): è la stessa unità del tetto (`usageCap` in `library.json`) e non richiede di leggere le cartelle di altre librerie. Sotto, "(Calcola il totale di tutte le librerie)" chiama `ai:usageAll` **solo al clic**: il main legge i registri d'uso delle librerie note (`<localData>`/cartella dati di ognuna, sola lettura), salta quelle non raggiungibili e lo dice ("2 librerie, 1 non raggiungibile: 0,61 $"). Contratto additivo: `'ai:usageAll' {} → { totalUsd: number, sends: number, libraries: Array<{ libraryId, usd: number|null, reachable: boolean }> }`. Si cambia con la costante `ACCOUNT_USAGE_SCOPE` in `settings/AccountCard.tsx`.

### 10.5 Correzioni del giro 3 (D-359)

- **Cambia account…** apre prima un dialogo che dice cosa succederà: "Si aprirà una finestra di Claude Code e poi il browser per accedere. Quando hai finito torna qui." Se la prova S1 trova un login che apre direttamente il browser (URL) senza console, si usa quello. Durante l'attesa il pulsante **primario** è [[Ho finito, verifica]] (l'osservatore di `~/.claude` è solo un aiuto: dove la CLI tiene le credenziali nel Gestore credenziali l'evento può non arrivare), con (Annulla).
- **Esci da Claude Code…** passa nel menu ⋯ della scheda Account con l'avviso "Uscirai anche nel terminale e nelle altre app che usano Claude Code"; non serve per cambiare account.
- **Prova la connessione · circa 0,001 $**: il costo è scritto sul pulsante; offline: "Sei offline: la prova non è partita" senza spesa.
- L'account in uso (email o "chiave API") compare anche nell'intestazione del pannello Claude, sotto lo stato.

---

## 11. Testi e terminologia (it / en)

Regole:
- Frasi brevi, verbo all'inizio per le azioni ("Scansiona ora", "Scan now"); niente punti esclamativi; niente gergo tecnico nelle sezioni normali (MCP, token, worker, hash, FTS solo in Avanzate).
- Pulsanti: verbo + oggetto quando serve chiarezza ("Copia nella libreria", non "OK"). Conferme distruttive: il pulsante ripete l'azione ("Dimentica la libreria"), mai "Sì".
- Errori: cosa è successo + cosa fare ("Il file è aperto in un altro programma. Chiudilo e riprova." / "The file is open in another program. Close it and try again."). Mai codici grezzi; il codice va solo nella diagnostica.
- Numeri con plurali i18next (`_one`, `_other`); date con `Intl` nella lingua dell'interfaccia; valute "0,42 $" (it) / "$0.42" (en).
- Il contenuto AI si chiama sempre "Generato dall'AI" / "AI-generated"; Claude si chiama "Claude" (non "l'AI") quando si parla dell'assistente.
- Seconda persona informale in italiano ("Scegli", "Trascina"), imperativo in inglese.

Glossario (chiave → it / en):

| Concetto | Italiano | English |
| --- | --- | --- |
| sezione `review` | Da rivedere | To review |
| file nuovi | Nuovi file | New files |
| proposte AI | Proposte di Claude | Claude's suggestions |
| sezione `map` | Mappa | Map |
| attività | Attività | Activity |
| scansione | Scansione / Scansiona ora | Scan / Scan now |
| libreria attiva | Libreria attiva | Active library |
| cartella dati | Cartella dati della libreria | Library data folder |
| originale | PDF originale | Original PDF |
| annotazioni nel PDF | Salva le evidenziazioni anche nel PDF | Also save highlights in the PDF |
| solo nell'app | Solo nell'app | In the app only |
| togliere dal PDF / ripristinare | Togli dal PDF le evidenziazioni di Research Lab · Ripristina il file esattamente com'era | Remove Research Lab highlights from the PDF · Restore the file exactly as it was |
| strumento | Seleziona · Evidenzia · Sottolinea · Gomma | Select · Highlight · Underline · Eraser |
| account | Account Claude | Claude account |
| modo di accesso | Automatico · Accesso di Claude Code · Chiave API | Automatic · Claude Code sign-in · API key |
| prova | Prova la connessione | Test connection |
| avanzate | Sviluppatore / Avanzate | Developer / Advanced |
| tavolozza | Comandi | Commands |

Le stringhe nuove vanno nelle parti per vista (`i18n/locales/parts/<lang>/<parte>.json`); le chiavi della prima schermata (guscio) nei dizionari principali. Ogni compito porta it **e** en (Haiku per la traduzione di massa, revisione Sonnet).

### 11.1 Correzioni dei testi dall'audit

| Oggi | Nuovo (it / en) | Perché |
| --- | --- | --- |
| "Arrivi", scheda "Arrivi", tablist "Posta in arrivo", "Proposte dell'AI" | "Da rivedere" › "Nuovi file" / "Proposte di Claude" (To review › New files / Claude's suggestions) | un nome per un posto (A6) |
| `aria-label` del badge "1 file nella posta in arrivo" | "Da rivedere: 1 file nuovo, 12 documenti con proposte di Claude" + `title` uguale | A6 |
| "Chiedi a Claude" accanto alla ricerca (apre la ricerca AI) | "Cerca con Claude" (Search with Claude), icona ✦ dentro il campo | A14 |
| "Esporta il secondo cervello" e "Esporta come secondo cervello…" | solo "Esporta come secondo cervello…" | doppione (N4) |
| "Questa sezione arriverà in una fase successiva." | tolto (testo segnaposto) | W4 |
| "Seguilo nella barra di stato" | "Vedi in Attività" (See in Activity) | A10 |
| "Sottolineato" (casella di studio) | "Annotato" (Annotated), con "dalle tue evidenziazioni" o "a mano" | A8 |
| "Torna alla libreria" | × con tooltip "Chiudi · Alt+← · Ctrl+W"; briciole "Libreria" | L7 |
| "Cronologia" nella chat | "Conversazioni" (Conversations) | A11 |
| "Note ed evidenziazioni" (pulsante del lettore) | icona ◫ "Pannello" con tooltip | L1 |
| "Evidenzia il risultato" / "Sottolinea il risultato" | nel menu ⋯ della ricerca, stesse etichette | L5 |
| "Fai doppio clic su un documento per aprirlo nel lettore" (guida, oggi falso) | resta: ora è vero (D-333) | A12 |
| "Ho capito che per ora nulla verrà inviato a Claude" (casella) | frase senza casella: "Finché non abiliti una cartella non viene inviato nulla." | W2 |
| `search_library`, "Searched the library for…" | "Ricerca nella libreria", "«documento» · 0 risultati" | C3 |
| "Seme" in primo piano | "Seme casuale" nel menu "Opzioni del modello" | R1 |

Glossario aggiuntivo: Conversazioni / Conversations; Attività / Activity; Annotato / Annotated; Cerca con Claude / Search with Claude; Copia in conflitto / Sync conflict copy; Solo nell'app / In the app only; In attesa / Waiting.

Correzioni aggiunte dal giro 3 (audit finale, D-362):

| Oggi (it / en) | Nuovo (it / en) | Riscontro |
| --- | --- | --- |
| "Vicini ma non sembra" / "Close but do not look it" | "Simili nel contenuto, diversi nelle parole" / "Similar in content, worded differently" | N5 |
| — / "Your values win over the ones read from the file." | "I tuoi dati prevalgono su quelli letti dal file." / "Your edits take priority over the data read from the file." | N4 |
| "Proponi con l'AI…" / "Propose with AI…" | "Proponi con Claude…" / "Suggest with Claude…" | E1 |
| "Esporta il secondo cervello" / "Export second brain…" | "Esporta come secondo cervello…" / "Export as second brain…" | E1, N4 |
| "second brain" nella guida italiana | "secondo cervello" | N18 |
| "Dimensione per un agente: circa 1095 token (indice 91)" / "Size for an agent … (index 108)" | "Dimensione per un assistente AI: piccola (circa 1 100 token)" / "Size for an AI assistant: small (about 1,100 tokens)"; l'indice solo in diagnostica | N8 |
| "Mostra documenti mancanti" / "Show missing documents" | "Mostra i file mancanti" / "Show missing files" | E1 |
| "Ricostruisci l'indice" / "Rebuild index" come link | pulsante in Avanzate › Scansione | E1 |
| Inbox · Arrivals · "Go to Arrivals"; "AI proposals" · "Go to AI proposals to review" | "To review" › "New files" · "Claude's suggestions"; scorciatoia "Go to To review" | E1 |
| "I tuoi originali non vengono mai modificati" (guida, accanto alle annotazioni) | "Research Lab non sposta, non rinomina e non cancella i tuoi file. Le evidenziazioni si aggiungono dentro il PDF solo se lo scegli, e puoi toglierle." | N18, §8.3 |
| "PROPORRE" e altri maiuscoli nelle impostazioni MCP; "NEW-ARRIVAL.PDF" | maiuscolo solo nelle etichette di gruppo; nomi di file, titoli e percorsi mai trasformati | N13, N22 |
| Sezione Mappa con schede "Mappa", "Rete", "Esplora", "Vicini inattesi" | "Panorama · Collegamenti · Esplora · Vicini inattesi" / "Overview · Connections · Explore · Unexpected neighbours" (D-384); modi della rete "Documenti · Tag · Argomenti · Autori" / "Documents · Tags · Topics · Authors" | attacco B.7 |

---

## 12. Accessibilità

- Contrasto: testi ≥ 4,5:1 (§5.2), bordi dei controlli e icone informative ≥ 3:1, anello di fuoco 2 px sempre visibile (`:focus-visible`).
- Ordine di tabulazione: link "salta al contenuto" › barra laterale › barra in alto › contenuto › pannello di dettaglio › pannello Claude. F6 / Maiusc+F6 passano da una zona all'altra (`role="region"` con `aria-label`).
- Barra laterale `nav` con `aria-current="page"`; badge con `aria-label` completo (§7.1); briciole in `nav aria-label="Percorso"`.
- Barra strumenti del lettore `role="toolbar"` con frecce; strumenti `aria-pressed`; lo scambio con Spazio annunciato in `aria-live="polite"`; ogni annotazione raggiungibile dal pannello Annotazioni (che è l'alternativa da tastiera al disegno col mouse: "Evidenzia il risultato della ricerca" resta).
- Popover e menu: fuoco al primo elemento, Esc chiude e riporta il fuoco al pulsante d'origine; dialoghi modali con trappola del fuoco (già in `Dialog.tsx`).
- Toast in `aria-live="polite"`, errori in `role="alert"`; nessuna informazione solo a colori; `prefers-reduced-motion` rispettato.
- Bersagli minimi 28 × 28 px (32 nei pulsanti principali); zoom dell'interfaccia di Chromium fino al 200% senza perdere funzioni (la barra laterale si comprime).
- Lingua del documento (`lang`) aggiornata al cambio (già fatto).

---

## 13. Leggerezza e budget (giro 3, D-365)

| Voce | Oggi | Stima dopo | Note |
| --- | --- | --- | --- |
| JS iniziale renderer | 379,5 / 391 KiB | 385,5-389 KiB | H0 0, A1 +3-5, A2 +3-5 netti (−2 barra di stato e lingua); `Drawer`, popover del selettore di libreria, popover Attività, Cronologia e indice delle impostazioni pigri **da subito** (D-380); controllo per compito "iniziale ≤ 388" dopo A2 |
| JS totale renderer | 1574 / 1600 KiB | 1625-1650 KiB | per compito (D-380, D-388): H0 2-3, A1 5-7, A2 4-6, C2 10-12, D3 3-5, F4 6-9, E3 1-3, G4a 1-2, M4 17-23 (con i modi Tag, Argomenti, Autori), I5 2-4, H5 0-2. **Tetto 1655** |
| CSS | tutto nel primo caricamento | ~35% nel primo | divisione per vista: riduce il CSS **del primo avvio**, non la memoria dopo che le viste sono state aperte (non conta come risparmio di memoria) |
| Risorse del lettore | tetto 2760 KiB | −150 KiB circa | foglio di pdf.js filtrato (§8.1.1) |
| JS main (con worker) | 1009 / 1010 KiB | 1064-1082 KiB | per compito (D-380, D-388): B1 7-10, R0 2-3, G4b 4-6 (classificatore, solo qui), G4a 32-40 (riusa `classify.ts`), G4c 6-8 (sempre), N4 4-6 (reti per entità). **Tetto 1085** |
| Preload | ≤ 8 KiB | invariato | canali nuovi dal ponte generico |
| Memoria a riposo | tetto 501 MB | invariata | nessun processo nuovo; scrittore caricato alla prima scrittura nel worker esistente; pdf.js per la verifica solo alla prima scrittura di un file |
| Primo contenuto | tetto 530 ms | invariato | nessuna richiesta nuova all'avvio |
| Cartella sincronizzata | — | una scrittura per documento per sessione di lettura (non ogni 4 s); copie degli originali annotati (D-327, provvisoria) | §8.3.3 |

**Funzioni aggiunte (§17, D-407).** Le funzioni scelte dall'utente non toccano la prima schermata né l'avvio:

| Voce | Dopo le onde del design | Stima dopo le onde 7-10 | Tetto | Come |
| --- | --- | --- | --- | --- |
| JS main caricato all'avvio (`main.entryJsKB`) | 1064-1082 KiB | 1066-1085 KiB | **1096** (stima alta + 1 %, D-426) | solo il registro `main/features/registry.ts` (+2-3); schemi delle funzioni in `@rl/core/features/*` importati dai moduli pigri |
| JS main su richiesta (`main.lazyJsKB`) | 0 | 70-103 KiB (onde 7-10) | **120** (ogni modulo ≤ 30) | un modulo per funzione con `import()` al primo uso: bib 15-20, discover 14-20, literature 8-12, project 5-8, resources 5-8, synthesis 4-6, importId 4-6, refs 3-4, links 3-5, crops ed explain 3-5, guides 2-3, ai 2-3, citectx 2-3 |
| JS iniziale renderer | 385,5-389 KiB | 386-389,5 KiB | 391 (invariato) | solo la voce Riprendi nel menu della ricerca (+0,5) |
| JS totale renderer | 1625-1650 KiB | 1711-1765 KiB (onde 7-10) | **1785** (stima alta + 1 %, D-426) | chunk pigri **≤ 16 KiB ciascuno**, controllato per chunk: X1 7-9, X2 8-11, X3 19-23 (tre chunk), X4 9-12, X5 10-14, X6 10-14, X7 12-16, X8 11-16; onda 12 (solo se confermata) 7-10 in più, con un tetto alzato da una decisione |
| Memoria a riposo, primo contenuto | tetti 501 MB, 530 ms | invariati | invariati | nessun modulo caricato prima del primo uso; nessuna richiesta di rete all'avvio |
| Dipendenze | — | nessuna nuova | — | LaTeX con un convertitore proprio (D-406); `.docx` con un lettore ZIP minimo su `zlib`; WebP dalla tela del lettore |

Margini (D-426): ogni tetto è la stima alta + 1 %; `check:budget` gira in ogni compito; se un'onda supera la somma delle stime alte si applica l'ordine di rinuncia (30, 51, 54, 16) prima di toccare un tetto.

Perché due voci per il main: il tetto unico di 1085 KiB misurava tutto il JS del main, ma il costo che conta (avvio, memoria a riposo) dipende solo dal codice caricato all'avvio. Il codice su richiesta ha un tetto proprio, così ogni funzione resta misurata. `tools/check-budget.mjs` riporta le due voci separate (X1); un modulo che entra nel grafo statico fa fallire il controllo.

Regola per ogni compito: `npm run check:budget` prima del rapporto; oltre la stima di più del 10% il compito si ferma e lo riporta (non alza budget da solo). Nessuna dipendenza nuova.

---

## 14. Piano di implementazione a onde (giro 3, D-354)

Regole comuni a tutti i compiti:
- Subagent **Sonnet** (Haiku solo per traduzioni di massa e spostamenti meccanici); lavoro in `../rl-wt/<id-compito>` dal `main` aggiornato; **al massimo 2 compiti in parallelo e con file disgiunti**: gli elenchi "File" sono esclusivi (un file non elencato non si tocca; se serve, il compito si ferma e lo chiede).
- I contratti in `@rl/core` li scrive **l'agente principale** prima del compito che li usa; i compiti non toccano `packages/core`.
- Prima del rapporto: `npm run typecheck`, `npm test` del pacchetto toccato, `npm run check:budget`, `npm run check:generality`. **e2e solo quelle del compito, una alla volta, mai mentre l'altro compito della coppia esegue e2e** (regola delle risorse); `test:e2e:heavy` solo nell'onda 6.
- **Proprietà dei file e2e**: in ogni onda un file e2e (e un helper) appartiene a un solo compito (tabelle sotto). Se un compito rompe una spec dell'altro, lo riporta e la correzione la fa il proprietario dopo il merge.
- **Guida d'uso**: ogni compito scrive nel rapporto le frasi della guida che il suo cambiamento rende false o nuove (it + en); in ogni onda un solo compito possiede la parte i18n `guide` e applica anche quelle dell'altro dopo il merge (criterio di accettazione: nessuna frase falsa nella guida).
- Niente push; commit piccoli con l'identità locale e **senza** `Co-Authored-By`; testi it + en; rapporto breve (cosa, file, testid cambiati, budget misurato, rischi).
- Dopo ogni merge l'agente principale esegue `smoke.spec.ts`.

### Onda 0 — correzione urgente e prove (H0 da solo, poi S1 ∥ S2)

| Id | Obiettivo | File (esclusivi) | Criteri di accettazione | Test | Budget |
| --- | --- | --- | --- | --- | --- |
| **H0** | PDF stirato, CSS di pdf.js isolato, riparazione delle annotazioni (§8.1, §8.1.1, §8.1.2) — **unito subito, da solo** | `styles.css` (solo i selettori delle classi rinominate e la regola `.page`), i `className` delle classi in collisione in `App.tsx`, `shell/**`, `settings/Settings.tsx`, `components/Dialog.tsx`, `views/**/*.tsx` (solo quella riga), `views/reader/engine.ts`, nuovi `views/reader/pdfjs-viewer.css` (generato), `tools/vendor-pdfjs-css.mjs` (+test), `views/reader/repair.ts` (+test), `views/reader/ReaderView.tsx` (solo l'aggancio della riparazione e `--page-ratio`), `views/reader/AnnotationList*` (solo il gruppo "Da controllare"), parti i18n `reader` (solo le frasi nuove), nuova `e2e/reader-geometry.spec.ts`, `e2e/helpers/leaked-rules.ts` | rapporti pagina/MediaBox e tela/scatola entro 0,5% a 1024, 1280, 1920 px e DPR 1, 1,198, 1,5; nessuna regola del foglio del lettore fuori da `.reader-scroll`; barra laterale e dialoghi uguali prima e dopo il lettore; evidenziazione nuova a 1920 px sovrapposta ai glifi ≥ 95%; annotazioni storte sintetiche riparate (≥ 95%) e `geom: 2`; nuove annotazioni con `geom: 2` | `reader-geometry.spec.ts`, `study-ui.spec.ts`, `smoke.spec.ts` (una alla volta) | renderer +3 KiB (chunk del lettore); CSS del lettore −150 KiB |
| S1 | Prova di `claude auth status --json`, `auth login`, `auth logout` (solo `status` e `--help`, nessun logout reale) e di un login con URL senza console | `docs/design/spike-auth.md` | uscite **anonimizzate**; decisione sul ripiego per ogni comando | nessuno | 0 |
| S2 | Prototipo dello scrittore e del classificatore (§8.3.13) | `tools/spikes/pdf-annot/**` | rapporto con righe e KiB, tempi, rifiuti per motivo, quota di cifrati con password vuota e di dati dopo `%%EOF` sulla libreria di prova (solo conteggi), confronto `rename`/`append` con una cartella sincronizzata di prova, scelta per il doppio disegno; nessun PDF reale committato | Vitest nella cartella | 0 |
| **R0** | Riparazione senza interfaccia delle annotazioni storte (D-373), dopo H0, da solo | `main/study/repair-job.ts` (nuovo), `main/library/worker-protocol.ts` e `worker-service.ts` (messaggio `repairAnnotations`), `packages/data/src/extract/pdf-geometry.ts` (nuovo: rettangoli dal testo con `getTextContent()`, +test), `main/ipc/handlers/study-handlers.ts` (solo l'avvio del lavoro), parti i18n `reader` (riga di Attività) | lavoro in Attività al primo avvio dopo l'aggiornamento, annullabile; sovrapposizione ≥ 90% con i glifi sulle annotazioni sintetiche storte; casi ambigui lasciati al lettore | Vitest con PDF sintetici; `reader-geometry.spec.ts` (caso del lavoro) | main +2-3 KiB |
| **P0** | Prototipo visivo statico per l'approvazione dell'utente (D-382) — **fatto** in questo ramo | `docs/design/prototipo/index.html` | l'utente lo approva o chiede ritocchi ai token **prima dell'onda 1**; ogni ritocco si fa lì e poi nei token | a vista | 0 (fuori dall'app) |

Prima di H0 l'agente principale aggiunge `geom` all'`annotationSchema`. Dopo l'onda 0 scrive i contratti di §7.1, §9, §10.3-§10.4, D-357 (`defaultAppSettings({ locale })`), lo scope `reader-tool` e gli id `nav.*`; decide G4c, `commitStrategy` e il doppio disegno con i rapporti di S1 e S2.

### Onda 1 — fondamenta (A1 ∥ B1)

**A1 · Token, CSS diviso, componenti** (renderer) — File: `styles.css` → `styles/tokens.css`, `styles/base.css`, `styles/shell.css` e i CSS per vista (`views/*/<vista>.css`, `settings/settings.css`); `main.tsx` (import CSS); `components/ui.tsx`, nuovi `components/{Button,IconButton,Segmented,Switch,Tabs,Chip,Badge,KeyValue,Popover,Menu,Drawer,Banner,Toast,EmptyState,Kbd,Progress}.tsx` con i test degli stati (§5.5.1), `components/icons-shell.tsx`, `components/icons.tsx`; test `styles/tokens.contrast.test.ts`, `styles/no-literal-colors.test.ts`. Criteri: §5 intero; contrasti; stati dei controlli (fuoco e hover mai grigio pieno); aspetto delle viste non migrate invariato. e2e (proprietà): `smoke.spec.ts`. Budget: iniziale +3-5 KiB.

**B1 · Main: account, scansione, conteggi, lingua iniziale** — File: `packages/ai/src/claude.ts` (+test), `apps/desktop/src/main/ai/**` (nuovi `account.ts`, `usage-all.ts`), `main/ipc/handlers/{ai,scan,inbox,review}-handlers.ts`, `main/library/library-runtime.ts` (solo il rapporto di scansione), `main/inbox/service.ts` (solo conteggi e "visti"), `main/ai/review.ts` (solo `pendingDocs`), `main/settings/**` (solo la lingua iniziale da `app.getLocale()`), `renderer/src/testing/mockRl.ts`. Criteri: canali con test e fornitore simulato; `authMode` nell'ambiente del figlio; nessun segreto né uscita di `auth status` nei log; argomenti fissi; primo avvio in inglese con sistema inglese. e2e (proprietà): nuova `ai-account.spec.ts`, `ui-first-run.spec.ts` (solo il caso della lingua). Budget: main +7-10 KiB.

### Onda 2 — guscio e impostazioni (A2 ∥ C2)

**A2 · Guscio, navigazione, notifiche, Attività** — File: `App.tsx`, `shell/**`, nuovi `lib/nav.tsx`, `shell/ActivityChip.tsx`, `shell/ActivityPopover.tsx` (pigro), `shell/HistoryButtons.tsx`; `lib/history.tsx` (solo il montaggio), `lib/HistoryPanel.tsx`, `lib/aiUi.tsx`, `lib/notify.tsx` (toast legati alla vista), `components/NoticeBanner.tsx`, `lib/keymap.tsx`, `lib/shortcutDefs.ts`, `views/chat/Palette.tsx`, `views/chat/paletteModel.ts`, `lib/jobs.tsx` e `lib/citationJobs.tsx` (solo le righe di Attività), dizionari principali `i18n/locales/{it,en}.json`, parte i18n `guide`. Criteri: §2, §3, §4.1, §4.10, §7 (badge D-358, tabella §7.4, toast della vista), Alt+1…5 nell'ordine della barra laterale (N21), disposizione adattiva del guscio (D-363), nessuna richiesta nuova all'avvio, JS iniziale ≤ 391. Testid come al giro 2 (§14 riepilogo). e2e (proprietà): `smoke.spec.ts`, `inbox.spec.ts` e `network.spec.ts` (solo navigazione), `ai-ui.spec.ts`, `qa-budget.spec.ts`, `e2e/helpers/ui.ts`. Budget: iniziale +5-8 KiB, −2.

**C2 · Impostazioni, Account, Backup e ripristino, MCP, Scorciatoie** — File: `settings/**` (compresi `RestoreDialog.tsx`, `BackupSection.tsx`, `McpSection.tsx`, `ShortcutsSection.tsx`, `useBackupJob.ts`), nuovi `GeneralSection.tsx`, `ClaudeSection.tsx`, `AccountCard.tsx`, `AdvancedSection.tsx`, `SavedKeys.tsx`, `settingsIndex.ts` (+test, importato solo dalla tavolozza e dalle impostazioni), `useAutoSave.ts`; `lib/events.tsx` (solo la pulizia degli ascoltatori, N12); parti i18n `settings`, `settings-wizard` (solo chiavi delle impostazioni), `aiSettings`, `mcp`, `backup`, `shortcuts`; nuovo `e2e/helpers/settings.ts`. Criteri: §4.6-§4.8, §4.16, §4.17, §6, §10.2, §10.4, §10.5; ogni riga di §6.2 raggiungibile (test su `settingsIndex.ts`); stati di errore del salvataggio automatico; ripristino con piede fisso, avviso sulla cartella, suffisso e "Apri la libreria ripristinata"; nessun avviso di ascoltatori dopo 20 aperture. e2e (proprietà): `ai-account.spec.ts` (aggiornata), `backup-restore.spec.ts`, `export-mcp.spec.ts` (solo la parte MCP). Budget: totale +10-12 KiB.

### Onda 3 — viste principali e lettore (D3 ∥ F4, poi E3 ∥ G4b)

**D3 · Libreria, scheda, tassonomia, scansione, procedura guidata** — File: `views/library/**` (compresi `DocPanel.tsx`, `TaxonomyManager.tsx`, `ScanStatusText.tsx`, `useScanStatus.ts`), `views/citations/**` (scheda: Citazioni e Simili), `wizard/**`, `views/guide/WelcomeCard.tsx`, nuovo `views/library/ScanReport.tsx`, parti i18n `doc`, `doc-reader` (solo chiavi della Libreria), `taxonomy`, `wizard`, `guide`. Criteri: §3.2, §4.2, §4.9, §4.11, §4.13 (tassonomia), §4.14, §4.18, §4.19 (Libreria); una riga di barra; scheda in lettura che non nasconde Cartelle/Tag; selezione su una riga a 1024 px; almeno 7 righe a 1024×700; procedura in 7 passi con il consenso nel Riepilogo (D-348, solo l'interruttore che scrive `writeToPdfConfirmedAt`); salvare la tassonomia non avvia una scansione; nessuna regressione della ricerca. e2e (proprietà): `ui-library.spec.ts`, `ui-first-run.spec.ts`, `search-basic.spec.ts`, `qa-watcher.spec.ts`, `qa-search-perf.spec.ts`, `thumbs.spec.ts`, `citations.spec.ts`, `helpers/phase1.ts`. Budget: totale +3-5 KiB.

**F4 · Lettore a strumenti** (renderer, senza scrittura nel PDF) — File: `views/reader/**` esclusi i file di H0 già uniti salvo dove serve la barra unica (nuovi `toolMachine.ts` + test, `ReaderBar.tsx`, `AnnotationPopover.tsx`, `FindBar.tsx`, `ExternalAnnotations.tsx`, `cursors.css`), `views/notes/**` (solo la disposizione), `lib/reader.tsx`, `shell/Topbar*.tsx` **solo** il punto in cui il lettore sostituisce la barra (A2 è unito), parti i18n `reader`, `doc-projects-reader` (chiavi del lettore). `settings/ShortcutsSection.tsx` non si tocca: lo scope `reader-tool` è nei contratti e la sezione lo elenca da sola (C2 la legge dai contratti). Criteri: §4.3, §8.2 (con §8.2.7); un test per riga della tabella §8.2.4; Spazio e suggerimento; conferma della gomma oltre 3; area utile di §4.3; pagina con più area visibile nel campo; barra di **13 controlli** (D-410, §4.3: pallino del colore con popover, campo pagina senza frecce, menu dello zoom, stato del PDF dentro Studio, Annulla nel ⋯, posto per Ritaglia) confrontata con il P0 aggiornato (test del conteggio nella spec del lettore); il gruppo PDF di Studio dice "Solo nell'app" (`PDF_WRITE_ENABLED = false`). e2e (proprietà): `study-ui.spec.ts`, `reader-geometry.spec.ts` (solo le aree utili). Budget: totale +6-9 KiB.

**E3 · Da rivedere** — File: `views/inbox/**`, `views/review/**`, nuovo `views/review/ReviewHub.tsx`, `lib/inbox.tsx`, parti i18n `inbox`, `review`, `doc-review`. Criteri: §4.4, §4.5, §7.1, D-338, N22 (chip Modello e Ragionamento spiegati, nomi mai in maiuscolo), righe di copia in conflitto pronte (dati da G4b). e2e (proprietà): `inbox.spec.ts`, `ai-review.spec.ts`. Budget: +1-3 KiB.

**G4b · Identità del contenuto** (prima dello scrittore) — File: `packages/data/src/scanner.ts`, nuovo `packages/data/src/pdf-annot/classify.ts` con il lexer e la lettura xref minimi che servono (+test; G4a li estende senza cambiarne l'interfaccia), `packages/data/src/extract/text-extractor.ts` (chiave della cache), `apps/desktop/src/main/thumbs.ts`, `main/graph/inputs.ts`, `main/inbox/service.ts` (duplicati e copie in conflitto), `main/ai/tools-host.ts` e la cache AI, `main/ipc/handlers/study-handlers.ts` (solo il confronto `forHash`), `main/ipc/handlers/doc-files.ts`, `packages/search/src/sqlite-index.ts` (se usa l'hash come chiave di contenuto), `tools/check-nondestructive.mjs`. Contratti: `pdfWrite`, `contentHashOf` (agente principale). Criteri: test "Identità" e "Classificazione" di §8.3.13 con file sintetici annotati da "un altro programma" (scritti dal generatore dei test); un file davvero cambiato si comporta come oggi. e2e (proprietà): `study-data.spec.ts`, `qa-scan-nondestructive.spec.ts`. Budget: main +4-6 KiB (classificatore).

### Onda 4 — scrittura nel PDF e Mappa (G4a ∥ M4, poi G4c ∥ N4)

**G4a · Scrittore incrementale, sincronia, consenso** — **area sensibile** — File: `packages/data/src/pdf-annot/**` esclusa l'interfaccia di `classify.ts` (nuovi `objects.ts`, `serialize.ts`, `xref.ts`, `objstm.ts`, `pages.ts`, `geometry.ts`, `plan.ts`, `reconcile.ts`, `appearance.ts`, `verify.ts`, test e generatori), `apps/desktop/src/main/study/pdf-sync.ts` (nuovo: momenti di scrittura, coda, registro, `expectedWrites`, copia, rinomina, togli dal PDF, troncamento, migrazione, consenso), `main/ipc/handlers/study-handlers.ts` (solo i canali nuovi), `main/library/worker-protocol.ts` e `worker-service.ts` (messaggi e import pigro), `views/reader/PdfWriteChip.tsx` e nuovo `views/reader/PdfConsentDialog.tsx` (F4 è unito), nuovo `settings/LibraryAnnotationsGroup.tsx` (montato da `LibraryConfigSection` con una riga), parti i18n `settings` (solo il gruppo) e `reader` (solo chip e consenso). Criteri: tutti i test di §8.3.13 tranne Identità e Classificazione (di G4b); prefisso intatto in ogni test; nessuna scrittura senza consenso e senza `geom: 2`; momenti di scrittura di D-349; `PDF_WRITE_ENABLED` resta `false` nel merge (i test lo accendono localmente); main ≤ 1068 dopo G4a (riga di D-380; se lo scrittore supera 44 KiB: stop e rapporto); riusa `classify.ts` di G4b senza duplicarlo. e2e (proprietà): nuova `pdf-annot.spec.ts`, poi da sola `security-hostile-scan.spec.ts`. Revisione: Sonnet indipendente **e security dedicata** (con G4b) prima di accendere `PDF_WRITE_ENABLED`. Budget: main +32-40 KiB.

**M4 · Mappa bella e giocabile, con le reti per tag, argomenti e autori** (D-367, D-384 … D-388) — Criteri in più: tutto §4.21 lato interfaccia (selettore del modo e `M`, nodi entità, vista bipartita dei tag, discesa di livello degli argomenti, comunità degli autori e anello "Tu", cartellino con l'istogramma degli anni, scheda dell'entità con "Apri nella Libreria" e "Correlati", Separa/Unisci, volo tra i modi, Sorprendimi per modo, stati vuoti), con i dati di `graph:entityNetwork` da `mockRl` finché N4 non è unito; prove di §4.21.6. File: `views/network/**` (nuovi `camera.ts` con inerzia e volo, `quadtree.ts` + Barnes-Hut in `forceSim.ts`, `edges.ts` per archi curvi e assottigliati, `hulls.ts` con Chaikin, `labelsLod.ts`, `MiniMap.tsx`, `HoverCard.tsx`, `NodeSearch.tsx`, `playful.ts` per Mescola e Sorprendimi, `mapKeyboard.ts`; `MapCanvas.tsx`, `GraphNet.tsx`, `NetworkView.tsx`, `network.css`), i token `--cat-1..10` in un file della vista (`views/network/palette.css`, importato dalla vista; A1 li ha già previsti in `tokens.css` come nomi), parti i18n `network`. Criteri: tutto §4.20; schede rinominate; involucri, etichette con livello di dettaglio, cartellino, scheda al clic (usa il `DetailPanel` di D3), volo, percorso, filtri animati, minimappa, Mescola e Sorprendimi, tastiera con annunci, movimento ridotto, stati vuoti con azione; nessun `requestAnimationFrame` a riposo (test con un contatore); prestazioni: test Vitest con margine (passo Barnes-Hut 800 nodi ≤ 4 ms sulla macchina di CI, energia che scende e assestamento entro 400 passi; disegno di 20 000 punti in un canvas finto ≤ 16 ms), e2e con misura dei frame in panoramica (≥ 50 fps medi su 2 s con la libreria sintetica moltiplicata a 5000 punti). Test unitari: quadtree, Barnes-Hut contro somma esatta (errore < 5% con θ 0,9), inviluppo e Chaikin, scelta delle etichette senza sovrapposizioni, camera (inerzia che si ferma, volo che arriva), percorso BFS, colori della tavolozza ≥ 3:1 nei due temi. e2e (proprietà): `network.spec.ts` (aggiornata: schede, cartellino, volo, tastiera, movimento ridotto). Budget: +17-23 KiB nel chunk pigro (12-16 per §4.20 e §16.3, 5-7 per §4.21), tetto totale 1655 (D-380, D-388). Criteri aggiunti da D-379 (Argomenti giocabile, Citazioni mai vuota, grafi piccoli, tetto di 800 con stato, colori stabili, opacità del tema scuro, misura vera dei fps sotto `RL_HEAVY_TESTS=1` in `test:e2e:heavy`, revisione a vista prima del merge con il prototipo P0 come riferimento).

**H5 · Progetti e Scopri** (onda 5) — File: `views/projects/**`, `views/discover/**`, i loro CSS e parti i18n. Criteri: §1.1 (tabella delle azioni), §4.13, D-344, Annulla/Cronologia tolti dalle barre. e2e (proprietà): `ui-projects.spec.ts`. Budget ±2 KiB.

**N4 · Reti per entità nel main** (D-387, in parallelo con G4c: file disgiunti) — File: nuovo `packages/graph/src/entity-network.ts` (+test), `packages/graph/src/explore.ts` (solo la lettura degli alias), nuovo `apps/desktop/src/main/graph/author-aliases.ts`, `main/graph/host.ts` e `main/ipc/handlers/graph-handlers.ts` (solo il canale nuovo), `packages/search/src/query.ts` (solo il filtro `topic`). Criteri: §4.21.3 (pesi, top-k, tetto, consorzi esclusi, alias, cache, ≤ 1,5 s per 10 000 documenti sotto `RL_HEAVY_TESTS=1`). e2e (proprietà): nessuna nuova; `network.spec.ts` resta di M4 e si riesegue con i dati veri in V1. Budget: main +4-6 KiB (tetto 1085, D-388).

**G4c · PDF cifrati con password utente vuota** (sempre, D-375; dopo G4a, da solo rispetto alle e2e, prima dell'accensione; in parallelo solo con N4) — File: nuovo `packages/data/src/pdf-annot/crypt.ts` (+test con RC4, AES-128, AES-256), una riga in `plan.ts` e `verify.ts`. Criteri: test di §8.3.13 sui cifrati; `/P` rispettato. Revisione security. Budget: main +6-8 KiB (tetto 1080, D-380).

### Onda 5 — chat, export, viste secondarie, facoltativi (I5 ∥ H5, poi J5)

**I5 · Pannello Claude, lavori AI, guida, esportazione** — File: `views/chat/**` esclusi `Palette.tsx` e `paletteModel.ts`, `views/ai/**`, `views/guide/**` escluso `WelcomeCard.tsx`, `views/export/**`, parte i18n `guide`. Criteri: §4.12 (blocchi che vanno a capo in inglese), §4.15 (fuoco, Esc, piede fisso, testi), D-339 con D-364 (ogni documento nuovo riporta il dialogo), guida completa e senza frasi false (N18). e2e (proprietà): `ai-chat.spec.ts`, `ai-search.spec.ts`, `export-mcp.spec.ts` (parte export). Budget +2-4 KiB.

**J5 · Facoltativi** — "Esporta una copia annotata" (§8.3.14: `main/study/pdf-sync.ts`, `views/reader/PdfWriteChip.tsx`; revisione security), "Importa nell'app" per le annotazioni esterne (`views/reader/ExternalAnnotations.tsx`). e2e (proprietà): `pdf-annot.spec.ts` (casi nuovi).

### Onda 6 — verifica e accensione

| Id | Compito | Criteri |
| --- | --- | --- |
| V1 | Terzo giro dell'auditor con `e2e/design-audit.spec.ts` in italiano e in inglese (compresi il lettore in inglese e la tassonomia in inglese) | ogni riga di §0 chiusa; nessun testo sotto 4,5:1; nessun elemento tagliato a 1024×700; `leakedRules` vuoto |
| V2 | Revisione indipendente del ramo; **security** con potere di blocco su scrittore e classificatore, consenso, `ai:login/logout`, osservatore di `~/.claude`, `check-nondestructive` | rapporti in `docs/`, correzioni unite |
| V3 | Accensione della scrittura: backup della cartella dati della libreria di prova (regola 1), `PDF_WRITE_ENABLED = true`, prova su una **copia** della libreria reale in una cartella sincronizzata di prova (Edge e Chrome a mano) | evidenziazioni visibili negli altri lettori, nessuna copia in conflitto in una sessione normale, nessun "cambiato" dopo la scansione |
| V4 | Budget (`check:budget`, `qa-budget.spec.ts`; `tools/budgets.json` secondo D-319/D-322/D-365); suite e2e completa **una spec alla volta**, poi `test:e2e:heavy` da solo | verde |
| V5 | `docs/STATUS.md`, `docs/HISTORY.md`, `docs/PLAN.md` (criterio della fase 3), guida; conferma delle scelte provvisorie (§15) con l'utente | scelte confermate o cambiate (un valore ciascuna) |

### Riepilogo dei testid

| Testid | Esito |
| --- | --- |
| `nav-inbox` | → `nav-review` |
| `nav-network` | → `nav-map` |
| `section-inbox` | → `section-review` |
| `inbox-tab-arrivals`, `inbox-tab-proposals` | → `review-tab-files`, `review-tab-proposals` |
| `statusbar` | tolto (verificare `qa-*`) |
| `status-library` | sul pulsante del selettore di libreria |
| `status-ai` | nell'intestazione del pannello Claude |
| `scan-status` | sul chip Attività, stessi attributi |
| `library-switcher` | pulsante + popover (voci `library-switcher-item`) |
| `language-select` | in Impostazioni › Generale |
| `index-rebuild` | in Avanzate › Scansione |
| `history-panel` | popover dalla barra in alto |
| `reader-toolbar` | gruppo degli strumenti nella barra unica del lettore (non più flottante) |
| `reader-study-*` | voci del menu `reader-study-menu` |
| `reader-underlined` | scheda Info del pannello del lettore (etichetta "Annotato") |
| nuovi del giro 3 | `reader-geometry-*` (solo e2e), `annotation-needs-review`, `annotation-reposition`, `pdf-consent`, `pdf-consent-yes`, `pdf-consent-app-only`, `pdf-remove`, `restore-open-library`, `detail-edit-data` |
| tutti gli altri | invariati |

### 14.1 Onde 7-12: funzioni aggiunte (D-408, rivista con D-422 e D-426)

Dopo l'onda 6 (accensione), con le stesse regole comuni di §14. In più:

- **Al massimo 2 compiti Sonnet in parallelo, con file disgiunti.**
- **Ogni compito**, non solo Y2, esegue `npm run check:budget` (voci `main.entryJsKB`, `main.lazyJsKB`, renderer iniziale e totale, tetto per singolo chunk del renderer 16 KiB e per singolo modulo del main 30 KiB) ed `e2e/crowding.spec.ts`. Oltre la stima alta di più del 10 %, o con un conteggio di §17.3 cresciuto, il compito si ferma e lo riporta.
- **Ordine di rinuncia scritto prima di cominciare** (D-426): se dopo un'onda la somma misurata supera la somma delle stime alte, si rimandano le funzioni in quest'ordine, finché si rientra: 30 (evidenziazioni guida), 51 (suggerimenti di citazione), 54 (resoconto), 16 (tabella di confronto). Rimandare vuol dire togliere l'ingresso e lasciare il codice spento, con una riga in DECISIONS.
- **Le funzioni da confermare non entrano in un'onda** prima della risposta dell'utente scritta in DECISIONS (D-422): la 49 (manoscritto ↔ fonti) e la 13 (RIS, CSL JSON e schema delle chiavi scelto dall'utente) sono nell'onda 12.

**Prima dell'onda 7, l'agente principale** (lavoro piccolo, nessun compito in parallelo; D-426 toglie questa parte da X1):

1. scrive i contratti in `@rl/core/features/*` (un sottopercorso per funzione, importato solo dal modulo pigro e dal chunk del renderer che lo usano);
2. scrive il registro `apps/desktop/src/main/features/registry.ts`:
   - una riga per funzione `nome → () => import('./<nome>/index')`, con i moduli vuoti che rispondono "non ancora disponibile";
   - il canale generico `feature:<nome>:<azione>` sul ponte esistente;
   - la validazione dell'involucro `{ canale, dati }` nel registro e quella dei dati nel modulo;
3. aggiorna `tools/check-budget.mjs` (+test) e `tools/budgets.json`:
   - `main.entryJsKB` (chunk raggiungibili per import statico da `out/main/index.js` e dai worker) e `main.lazyJsKB` (il resto);
   - tetto per singolo modulo del main e per singolo chunk del renderer;
   - un modulo di `features/*` che entra nel grafo statico fa fallire il controllo;
   - `apps/desktop/electron.vite.config.ts`, solo `output.chunkFileNames` del main e la verifica che gli `import()` restino chunk separati;
4. scrive `e2e/crowding.spec.ts` ed `e2e/helpers/visible-controls.ts` con i numeri del P0 di §17.3 (controlli visibili, voci e gruppi di ogni menu, voci mai nascoste);
5. con Haiku (spostamento meccanico), divide la scheda e i menu in file per parte, così due compiti della stessa onda non toccano lo stesso file:
   - `views/library/docpanel/{Notes,Files,Citations}Section.tsx`;
   - `views/library/selection/{ClaudeMenu,MoreMenu}.tsx`;
   - `views/reader/menus/{ReaderMoreMenu,StudyMenu}.tsx`;
   - `views/projects/ProjectMoreMenu.tsx`;
   - le voci del `⋯` della selezione che arrivano in onde diverse (Leggi affiancati, Linea del tempo, Estendi la bibliografia…, Trova un ponte) scritte subito, **disattivate con il motivo** "Non ancora disponibile" (le voci non compaiono e non spariscono, §17.1 regola 7); ogni compito accende solo la sua, in un file proprio (`views/library/selection/actions/<voce>.ts`).

La barra del lettore da 13 controlli (D-410, §4.3) è un criterio di **F4** (onda 3). Se F4 è già unito quando si arriva qui, la riduzione è un compito a sé (**R4**, `views/reader/ReaderBar.tsx`, `views/reader/menus/**`, `study-ui.spec.ts`) prima dell'onda 7, da solo.

#### Onda 7 (X1 ∥ X2)

**X1 · Zotero e BibTeX gestito direttamente (7, 52)**

- **File:**
  - `main/features/bib/**` (+test con file sintetici BibTeX, BibLaTeX, CSL JSON in lettura, RDF);
  - nuovi `views/import/**` (dialogo in tre passi) e `views/library/AddMenu.tsx` (pulsante diviso, con PDF e Zotero);
  - una riga nell'intestazione della Libreria (`views/library/LibraryHeader.tsx`);
  - `views/projects/ProjectMoreMenu.tsx` (Collega un file .bib…; la scelta BibTeX in Esporta…);
  - `views/library/selection/MoreMenu.tsx` (la scelta BibTeX in Esporta…);
  - parti i18n `import`.
- **Criteri:**
  - §17.4.1, §17.4.2;
  - gli originali mai spostati;
  - chiavi stabili (servono al `.bib` collegato);
  - `.bib` scritto in modo atomico solo nella cartella di export, **solo se l'hash è quello dell'ultima scrittura dell'app** (D-421, test con un file cambiato fuori);
  - il main all'avvio non carica `features/bib`.
- **e2e (proprietà):** nuova `import-bib.spec.ts`.
- **Budget:** renderer 7-9; main lazy 15-20.

**X2 · Strumenti del lettore: Ritaglia (27), ✦ Spiega (31), significato dei colori (36), componente comune dei costi**

- **File:**
  - `views/reader/toolMachine.ts` (+test; stato `crop`);
  - `views/reader/ReaderBar.tsx` (solo il quinto strumento: la barra da 13 è già di F4 o R4);
  - nuovi `views/reader/CropLayer.tsx` ed `ExplainCard.tsx`;
  - `views/reader/SelectionPopover.tsx` (Copia · Evidenzia · ✦ Spiega, solo in Seleziona);
  - `views/reader/AnnotationList*` (miniature dei ritagli, filtro per significato);
  - nuovo `components/AiCostPreview.tsx` (+test: soglia, dialogo, stima nel pulsante, quota del giorno);
  - nuovi `settings/ColorMeaningsGroup.tsx` e `settings/ClaudeSpendGroup.tsx` (soglia e tetto; una riga ciascuno in `LibraryConfigSection.tsx` e `ClaudeSection.tsx`);
  - `main/features/crops/**`, `main/features/explain/**`;
  - `main/features/ai/batch.ts` (+test: blocchi, cache per hash, stima, soglia, tetto; interfaccia fissa per i compiti successivi);
  - parti i18n `reader` (solo le voci nuove).
- **Criteri:**
  - §17.4.8-§17.4.10;
  - tabella §8.2.4 estesa con le righe di Ritaglia (un test per riga);
  - barra del lettore di 13 controlli a 1024 e 1280 px;
  - stato "cartella non abilitata" di Spiega;
  - regola unica del costo (D-416);
  - cache verificata (seconda richiesta uguale: 0 invii).
- **e2e (proprietà):** `study-ui.spec.ts`, nuova `reader-crop.spec.ts`.
- **Budget:** renderer 8-11; main lazy 5-8.

#### Onda 8 (X3 ∥ X4)

**X3 · Note di letteratura (2), modelli (35), LaTeX (37), link e collegamenti in entrata (38)**

- **File:**
  - `views/notes/**`;
  - nuovi `views/literature/**` e `lib/mathml.ts` (+test con una tabella di casi LaTeX → MathML e casi non capiti);
  - `views/library/docpanel/NotesSection.tsx`;
  - `views/library/selection/ClaudeMenu.tsx` (Scrivi le note di letteratura…);
  - nuovo `settings/NoteTemplatesGroup.tsx` (una riga in `LibraryConfigSection.tsx`);
  - `main/features/literature/**` (estrazione delle immagini incorporate nel worker esistente, con un messaggio nuovo in `worker-protocol.ts` e `worker-service.ts`);
  - `main/features/links/**`, `main/features/templates/**`;
  - parti i18n `notes`, `literature`.
- **Criteri:**
  - §17.4.6;
  - **tre chunk** del renderer, ciascuno ≤ 16 KiB (D-426): editor delle note con LaTeX, `[[` e modelli (10-13); nota di letteratura (7-8); collegamenti in entrata (2);
  - stato "Bozza ✦ da approvare" nella scheda;
  - al massimo 5 note per invio dalla selezione;
  - cartella non abilitata → nota "solo da titolo e abstract" con l'avviso;
  - link salvati per identificativo (una nota rinominata non li rompe);
  - LaTeX senza dipendenze, una formula non capita mostrata com'è con un segno discreto.
- **e2e (proprietà):** nuova `literature-note.spec.ts`, `notes.spec.ts` se esiste.
- **Budget:** renderer 19-23 (in tre chunk); main lazy 11-17.

**X4 · Risorse (48), importazione da DOI, arXiv o URL (23), Riprendi (25)**

- **File:**
  - `main/features/resources/**`, `main/features/importId/**`;
  - nuovi `views/resources/**`;
  - `views/library/AddMenu.tsx` (voci nuove);
  - `views/library/docpanel/FilesSection.tsx`;
  - `views/library/ResultRow*.tsx` (icona del tipo, "Apri");
  - il facet Tipo (`views/library/facets*`);
  - `shell/SearchMenu*.tsx` (Riprendi e DOI incollato);
  - `views/chat/paletteModel.ts` (solo le voci nuove);
  - stato di studio (`lastPage`, `lastOpenedAt`) e segno di chiusura non pulita in `main/study/**` (solo quei campi);
  - parti i18n `resources`, `library` (voci nuove).
- **Criteri:**
  - §17.4.3-§17.4.5;
  - `openExternal` solo `http/https` (test);
  - anteprima senza cookie, con il limite di dimensione e la frase "contatta il sito" nel dialogo (test con un server locale finto);
  - nessun download senza conferma;
  - nessun banner di Riprendi all'avvio normale (solo dopo una chiusura non pulita).
- **e2e (proprietà):** `ui-library.spec.ts`, nuova `resources.spec.ts`.
- **Budget:** renderer 9-12 (iniziale +0,5); main lazy 9-14.

#### Onda 9 (X5 ∥ X6)

**X5 · Lettura affiancata (3), schede delle citazioni (29), esperimento delle evidenziazioni guida (30)**

- **File:**
  - `views/reader/**`, esclusi `toolMachine.ts`, `CropLayer.tsx` e `SelectionPopover.tsx` (nuovi `SplitReader.tsx`, `CitationCard.tsx`, `GuideMargin.tsx`);
  - `views/reader/menus/ReaderMoreMenu.tsx` (Affianca, Guida ✦);
  - `lib/reader.tsx`;
  - `views/library/selection/actions/sideBySide.ts` (accende Leggi affiancati);
  - `main/features/refs/**`, `main/features/guides/**`;
  - una riga in `settings/AdvancedSection.tsx` (Funzioni sperimentali);
  - parti i18n `reader`.
- **Criteri:**
  - §17.4.11, §17.4.12, §17.4.21;
  - una sola barra con il fuoco visibile;
  - sotto 1280 px il secondo paper come scheda alternata (Ctrl+Tab), con il motivo;
  - schede delle citazioni **solo al clic** (o Ctrl + passaggio), mai con uno strumento di disegno attivo, nessun segno a riposo;
  - guida: segni solo nel margine, casella nel `⋯` e tasto G, nessun invio automatico, nessuna traccia a funzione spenta (riga 1 di §17.4.21).
- **e2e (proprietà):** `reader-geometry.spec.ts` (caso affiancato), nuova `reader-refs.spec.ts`.
- **Budget:** renderer 10-14; main lazy 5-7.

**X6 · Motore di scoperta: Estendi la bibliografia, ricerca approfondita (41), Trova un ponte (42 + nuova)**

- **File:**
  - `views/discover/**` (scheda Ricerche, primario "Nuova ricerca ▾", `⋯` di Scopri, riga "Fonti seguite · Gestisci" in Novità);
  - `views/library/selection/actions/{extend,bridge}.ts` (accende Estendi la bibliografia… e Trova un ponte);
  - `views/network/BridgePath.ts` e il `⋯` del cartellino (`views/network/HoverCard.tsx`, solo la voce);
  - `main/features/discover/**` (+test con un OpenAlex finto: "nessun candidato", "nessun ponte convincente", identificativo mancante, esclusione dei documenti in libreria, motivi);
  - parti i18n `discover`.
- **Criteri:**
  - §17.4.17;
  - risultato predefinito senza Claude; sintesi ✦ con la scelta 10 / 20 / 50 e la stima;
  - ritrovamento senza Claude; nessun download;
  - Scopri con lo stesso numero di controlli.
- **e2e (proprietà):** nuova `discover-runs.spec.ts`, `network.spec.ts` (solo il percorso del ponte).
- **Budget:** renderer 10-14; main lazy 14-20.

#### Onda 10 (X7 ∥ X8)

**X7 · Progetto: scheda Schema con schema della ricerca e prove (40, 54), suggerimenti di citazione (51)**

- **File:**
  - `views/projects/**` (scheda Schema con Ricerca e Prove, filtro "Solo prove", resoconto, suggerimenti, elenco di tabelle e resoconti nelle Note, stati vuoti con "Scrivi lo schema della ricerca");
  - `views/reader/AnnotationPopover.tsx` (solo "Usa come prova" al primo livello e il tipo spostato nel `⋯` della voce del pannello; X5 è unito);
  - `main/features/project/**` (+test);
  - parti i18n `projects`.
- **Criteri:**
  - §17.4.13 (senza la parte Manoscritto), §17.4.14-§17.4.16;
  - progetto con al massimo 4 schede;
  - "Resoconto" disattivato senza schema, con il motivo;
  - suggerimenti di citazione con il **consenso a parte** e l'anteprima del testo esatto (D-423), un paragrafo o una sezione alla volta, solo sulle note del progetto finché la 49 non è confermata.
- **e2e (proprietà):** `ui-projects.spec.ts`, nuova `project-outline.spec.ts`.
- **Budget:** renderer 12-16; main lazy 5-8.

**X8 · Sintesi: tabella di confronto (16), gruppi di ricerca (12), contesto delle citazioni (11), linea del tempo (19)**

- **File:**
  - nuovi `views/compare/**` e `views/groups/**`;
  - `views/library/selection/ClaudeMenu.tsx` (Tabella di confronto…, Panoramica dei gruppi…);
  - `views/library/selection/actions/timeline.ts` (accende "Linea del tempo": la voce e la disposizione arrivano insieme, D-426);
  - `views/library/docpanel/CitationsSection.tsx`;
  - `views/network/timeline.ts`, con il `⋯` della Mappa (`views/network/NetworkView.tsx`, solo la voce) e il parametro di apertura con una selezione;
  - `main/features/synthesis/**`, `main/features/citectx/**`;
  - parti i18n `compare`, `groups`, `network` (voci nuove).
- **Criteri:**
  - §17.4.7, §17.4.18-§17.4.20;
  - celle riusate dalle note di letteratura senza invii (test); anteprima che conta le celle mancanti; ✦ per cella;
  - "Disponi per anno" con il movimento ridotto;
  - tabella salvata nel progetto.
- **e2e (proprietà):** nuova `compare-table.spec.ts`; `citations.spec.ts` (solo il contesto).
- **Budget:** renderer 11-16; main lazy 6-9.

#### Onda 11: verifica (Y1, poi Y2)

| Id | Compito | Criteri |
| --- | --- | --- |
| Y1 | **Designer avversario** sulle funzioni aggiunte, in italiano e in inglese:<ul><li>conteggi di §17.3 (controlli e voci dei menu) contro il P0;</li><li>giro di schermate (1024×700, 1280×800, 1920×1080, chiaro e scuro);</li><li>**esperimento 30 con il protocollo di §17.4.21** (libreria sintetica di 10 paper open access, mai la cartella reale; risposte di Claude registrate una volta con il consenso dell'utente e rigiocate come fixture);</li><li>ogni funzione raggiungibile dalla tavolozza.</li></ul>Non parte in parallelo a nessuna e2e pesante. | nessun conteggio cresciuto; esperimento 30 stabile come sperimentale o tolto, con il motivo in D-401; rapporto in `docs/design/` |
| Y2 | Budget e suite completa:<ul><li>`check:budget` con `main.entryJsKB` ≤ 1096, `main.lazyJsKB` ≤ 120, renderer iniziale ≤ 391, totale ≤ 1785 e ogni chunk ≤ 16 KiB;</li><li>memoria a riposo e primo contenuto invariati (`qa-budget.spec.ts`);</li><li>e2e una spec alla volta, poi `test:e2e:heavy` da solo;</li><li>`docs/STATUS.md`, `docs/HISTORY.md` e la pagina "Novità" della Guida aggiornati.</li></ul> | verde |

#### Onda 12: solo dopo la conferma dell'utente (D-422)

| Id | Compito | Condizione | Budget |
| --- | --- | --- | --- |
| Z1 | Manoscritto ↔ fonti (49): valore "Manoscritto" della scheda Schema, titoli da `.md`, `.tex`, `.docx` (lettore ZIP minimo su `zlib`), vista Matrice, suggerimenti di citazione sui paragrafi del manoscritto | risposta dell'utente su D-399 scritta in DECISIONS | renderer 6-8 (chunk proprio); main lazy 3-4; tetti alzati con una decisione |
| Z2 | Esportazione RIS e CSL JSON, schema delle chiavi scelto dall'utente (13) | risposta dell'utente su D-391 (13) scritta in DECISIONS | renderer 1-2; main lazy 3-4 |

---

## 15. Scelte provvisorie (da confermare con l'utente)

Le quattro domande del primo giro non hanno ancora risposta dall'utente; ognuna ha un valore **provvisorio, da confermare con l'utente** (in DECISIONS) e il cambio è un solo valore.

| # | Domanda | Scelta provvisoria | Perché | Come si cambia |
| --- | --- | --- | --- | --- |
| 1 | Copia di sicurezza dei PDF annotati: cartella dati sincronizzata o cartella locale? | **cartella dati** (`<dataDir>/pdf-originals/`), una copia per contenuto (D-327) | è il testo della regola 1; c'è su ogni computer e dopo un conflitto di sincronizzazione. L'audit propone `local` (non raddoppia lo spazio nel cloud; il prefisso intatto e "Togli dal PDF" rendono la copia un'ultima risorsa): è un'alternativa ragionevole da proporre all'utente insieme alla domanda | `annotations.backupLocation` (`'data'`/`'local'`), un solo punto (`pdfBackupDir`); passare a `local` richiede anche di aggiornare la regola 1 |
| 2 | Nome dell'autore nelle annotazioni del PDF | **nessuno** (D-328) | il PDF esce dall'app quando lo si condivide | predefinito di `annotations.author` |
| 3 | Esc non chiude più il lettore | **non chiude**; suggerimento a fine catena (D-329) | con gli strumenti Esc si preme spesso | costante `ESC_AT_ROOT` |
| 4 | Uso del mese nell'Account | **libreria attiva**, totale su richiesta (D-330) | stessa unità del tetto | costante `ACCOUNT_USAGE_SCOPE` |

La scrittura nei PDF originali **accesa per impostazione predefinita** non è una scelta provvisoria: è la decisione dell'utente (D-316); il giro 3 aggiunge solo che l'utente la vede e la conferma **prima** della prima scrittura in ogni libreria (D-348).

Rischi aperti (per l'agente principale):
1. La scrittura tocca file reali: prima dell'accensione (V3) backup della cartella dati e revisione security; fino ad allora `PDF_WRITE_ENABLED = false`.
2. Servizio di sincronizzazione: con le scritture alla chiusura il carico scende molto, ma copie in conflitto e file occupati vanno provati su un computer reale con una cartella di prova (S2, V3); `append` contro `rename` è ancora da decidere.
3. Riparazione: le annotazioni senza testo o con testo ripetuto restano "da controllare" e richiedono l'utente; quante siano nella libreria reale si sa solo aprendo i documenti.
4. Quota reale di PDF cifrati con password vuota e di PDF danneggiati: nota solo dopo S2; da essa dipendono G4c e il tetto del main (1060 o 1070).
5. Classificazione delle revisioni: un programma che cambia anche il contenuto della pagina in una revisione "di annotazioni" fa rileggere il testo (corretto ma più lento); un programma che riscrive il file per intero (salvataggio completo) fa perdere `base` e torna alla logica di "contenuto cambiato".
6. Budget: JS iniziale 1-5 KiB di margine; main 0-8 KiB di margine nel tetto 1060.
7. Doppio disegno delle annotazioni scritte: dipende dalla prova S2.

---

## 16. Chiusura del giro 3: la critica del progetto finale (D-368 … D-382)

La critica dell'auditor (`AUDIT.md`, sezione "Critica del progetto finale (giro 3)") ha trovato 3 problemi bloccanti, 18 importanti e 13 minori. Tutti sono accolti; le sezioni indicate sono già state corrette nel testo (questa tabella è il riscontro, non un'aggiunta da applicare dopo). Nessun punto respinto; la scelta dell'accento passa all'utente nel prototipo P0.

| Punto | Gravità | Soluzione | Dove |
| --- | --- | --- | --- |
| C.2.1 Autori, conteggi, includi/escludi e "tutti / almeno uno" persi | bloccante | riga dei filtri con tutti i facet, conteggi, tre stati per tag, modo; "Altri filtri" sotto 1280 px; e2e | §4.2, §4.18, D-369 |
| C.1 criteri di area del lettore impossibili | bloccante | barra laterale compressa nel lettore; ≥ 960×640 a 1024×700 e ≥ 880×740 a 1280×800 con il pannello; barra a 48 px; somma ricalcolata con 56 px | §0.1, §4.3, §5.3, D-370 |
| C.5.1 annotazioni cancellate o duplicate da altri programmi | bloccante | mai eliminazioni adottate in automatico ("Da controllare" con Riscrivi/Elimina); salvataggio completo a testo invariato = solo annotazioni, riaggancio per `/NM` o per geometria, mai riaggiunta | §8.3.6, §8.3.7, D-371 |
| C.5.2 ricarica del lettore dopo la scrittura propria | importante | URL con `contentHashOf`, evento `own: true`, e2e | D-372, §16.2 |
| C.5.3 riparazione che richiede di aprire ogni documento | importante | compito R0: riparazione nel worker con `getTextContent()`, lavoro in Attività | §14 (onda 0), D-373 |
| C.5.5, C.5.8 consenso modale a metà gesto; riga sotto la piega | importante, minore | banner non modale; dialogo solo alla chiusura senza risposta; riga nel corpo del Riepilogo e frase sotto "Crea la libreria" | §8.3.7, §7.4, D-374 |
| C.5.4 cifrati con password vuota senza via d'uscita | importante | G4c sempre, prima dell'accensione; anche "Esporta copia annotata" | §14, D-375 |
| C.1, C.2.3 un clic = cassetto sopra l'elenco a 1180-1439 px | importante | sotto 1440 px il clic seleziona; scheda "fissata" aperta da Scheda, Maiusc+Invio o ◫; e2e | D-376, §16.2 |
| C.2.2 intestazioni fuori regola (Libreria, Mappa) | importante | ◫ fuori dal conteggio delle azioni; Libreria con "Vista ▾"; Mappa con filtri e azioni giocose in una riga sotto le schede | §1.1, §4.2, §4.20, D-377 |
| C.1 barra del lettore con 4 px di margine | importante | spazio 952 px, Pagine ridotto sotto 1100 px, margine ≥ 72 px | §4.3, D-370 |
| C.3.1 Argomenti statica, Citazioni vuota | importante | zoom semantico che "apre" un argomento, trascinamento di argomenti, Citazioni sul documento più collegato | §16.3, D-379 |
| C.3.2 colori instabili e ripetuti | importante | eredità per sovrapposizione, colorazione golosa degli adiacenti, contorno tratteggiato oltre 10 | §16.3, D-379 |
| C.3.3 grafi piccoli | importante | simulazione sotto 30 documenti, cerchio e capsula per involucri degeneri, zoom massimo di Adatta | §16.3, D-379 |
| C.3.4 tetto di 800 senza stato | importante | "+37 non mostrati (tetto 800)" e "800 di 1 240" | §16.3, D-379 |
| C.3.5 tema scuro della mappa | importante | opacità per tema, aloni `lighter` in scuro, test di contrasto | §16.3, D-379 |
| C.3.6 prove di prestazione che non provano | importante | fps misurati in Electron con un modello precalcolato (≥ 55 fps a 20 000 punti, ≥ 30 a 60 000) in `test:e2e:heavy` | §14 (M4), D-379 |
| C.3.7 M4 senza verifica a vista | importante | prototipo P0 come riferimento; schermate a seme fisso rivedute dalla coppia di design prima del merge | §14 (M4), D-379, D-382 |
| C.4.1 nessun prototipo | importante | **P0 fatto**: `docs/design/prototipo/index.html` | §16.4, D-382 |
| C.4.2 tipografia piatta | importante | titoli 26/32, display 32/40 | §5.1, D-378 |
| C.4.3 nessuna identità | importante | accento petrolio provvisorio (alternativa indaco nel prototipo), barra laterale senza pannello grigio, illustrazioni a tratto, logo con la tinta della libreria, microanimazioni con un significato | §5.2.1, §16.4, D-378 |
| C.6.1-C.6.2 budget in contraddizione; iniziale al limite | importante | tabella per compito; main 1060-1076 su 1080; totale 1620-1643 su 1655; iniziale 385,5-389 su 391 con pigri da subito | §13, §14, D-380 |
| C.6.3, C.5.7 prove mancanti; verifica a mano nei lettori esterni | importante, minore | e2e di Spazio, nessuna ricarica, PDFium automatico, facet Autori ed esclusione, clic sotto 1440 px | §16.2, D-381 |
| C.1 righe 44/48 e badge nella tabella di §7 | minore | 48 ovunque; riga del badge aggiornata | §5.3, §7 |
| C.2.4 ✦ per Scopri | minore | bussola ◈ | §4.1, D-377 |
| C.2.5 "Mostra i file mancanti" in due posti | minore | solo nella riga dei filtri | §1.1, §4.2 |
| C.2.6 barra in alto a 1024 px | minore | sotto 1100 px solo l'ultimo segmento delle briciole e Cronologia nel ⋯ | D-377 |
| C.3.8 accessibilità della tela | minore | `L` apre l'elenco; l'annuncio dice sempre l'argomento | D-379 |
| C.3.9 Mescola e puntine | minore | le puntine restano; "Libera tutti" nel ⋯ | D-379 |
| C.4.4 incoerenze dei token | minore | una regola per il disattivato; `--cat-*` solo in `tokens.css`; `--e-2` senza barra flottante | §5.3, §5.5, D-378 |
| C.5.6 colori e `/RC` adottati da altri programmi | minore | colore più vicino in OKLab con l'originale conservato; `/RC` se più recente | D-371 |
| C.6.4-C.6.6 coppie, prove pesanti, V3 | minore | dati finti in E3; prove pesanti di M4 in `test:e2e:heavy`; copia della libreria fuori dal repository e rapporti solo con conteggi | D-381 |

### 16.1 Filtri della Libreria (D-369)

```
[Stato ▾] [Tipo ▾] [Anno ▾] [Rivista ▾] [Autori ▾] [Tag ▾]   (× In lettura) (✓ Ottica) (⊘ Bozze)  (Pulisci)   □ Mostra i file mancanti
                                                   ┌ Tag ─────────────────────── 300 ┐
                                                   │ [⌕ Cerca un tag…            ]   │
                                                   │ Inclusi: ( Tutti | Almeno uno ) │
                                                   │ ✓ Ottica                   42   │  clic: nessuno → ✓ includi → ⊘ escludi → nessuno
                                                   │ ⊘ Bozze                     6   │
                                                   │   Laser                    17   │
                                                   │   Serie temporali          11   │
                                                   └─────────────────────────────────┘
```

Ogni menu: valori ordinati per conteggio, conteggi con cifre tabellari a destra (gli stessi di oggi, calcolati sul risultato corrente), ricerca interna sopra 8 valori, più valori con la casella nei facet a scelta multipla (Tipo, Rivista, Autori, Stato) e cursore a due maniglie per Anno. I chip attivi mostrano ✓ per gli inclusi e ⊘ per gli esclusi. Sotto 1280 px di vista "⋯ Altri filtri" raccoglie Rivista e Autori con lo stesso contenuto.

### 16.2 Prove aggiunte (D-372, D-376, D-381)

| Prova | Dove | Criterio |
| --- | --- | --- |
| Spazio reale nel lettore | `study-ui.spec.ts` (F4) | Spazio alterna Seleziona ↔ Evidenzia; nei campi scrive uno spazio; Maiusc+Spazio scorre indietro; nessuno scambio durante un trascinamento |
| Nessuna ricarica dopo una scrittura propria | `pdf-annot.spec.ts` (G4a) | a documento aperto una scrittura dopo 120 s: stessa pagina, stesso `scrollTop`, nessuna nuova richiesta `rl-doc` |
| Visibile in un lettore PDF standard | `pdf-annot.spec.ts` (G4a), anche in V3 | `BrowserWindow` nascosta con `plugins: true` sul PDF scritto, screenshot: pixel gialli nel rettangolo dell'evidenziazione, tratto scuro sotto la riga della sottolineatura |
| Altri programmi | `pdf-annot.spec.ts` (G4a) | riscrittura completa da pdf-lib con gli stessi `/NM` → nessun doppione, nessuna annotazione persa; file "ripulito" → "Da controllare", nulla eliminato |
| Facet Autori ed esclusione dei tag | `ui-library.spec.ts` (D3) | filtra per un autore; esclude un tag; "Almeno uno" con due tag |
| Clic sotto 1440 px | `ui-library.spec.ts` (D3) | a 1280 px un clic seleziona senza aprire il cassetto; [Scheda] lo apre e resta aperto cambiando riga |
| Riparazione di massa | R0 (Vitest) e `reader-geometry.spec.ts` | ≥ 90% di sovrapposizione senza aprire il lettore |

### 16.3 Mappa: integrazioni (D-379)

- **Argomenti giocabile:** doppio clic su un involucro = l'argomento si "apre": i suoi punti si allargano con una simulazione locale (collisione + richiamo verso la posizione originale, `alpha` 0,6 → 0) e si trascinano come nella scheda Citazioni; Esc o doppio clic sul vuoto lo richiudono. Trascinare l'etichetta di un argomento sposta l'intero involucro e gli altri si scostano (collisione tra cerchi che approssimano gli involucri: decine di corpi).
- **Citazioni mai vuota:** si apre sul documento più collegato della libreria (o sull'ultimo letto, se ha collegamenti) già espanso di un passo.
- **Grafi piccoli** (< 30 documenti): anche Argomenti usa la simulazione, con una forza verso il baricentro dell'argomento; involucro di 1 punto = cerchio di 24 px, di 2 = capsula; "Adatta" non ingrandisce oltre un nodo di 40 px.
- **Tetto di 800 nodi:** "Espandi" aggiunge i vicini più pesanti fino al tetto; cartellino "+37 non mostrati (tetto 800) · Mostra solo questi" (sostituisce la rete con il nodo e i suoi vicini); sottotitolo "800 di 1 240".
- **Colori stabili:** all'aggiornamento della mappa ogni argomento nuovo eredita la tinta dell'argomento vecchio con cui condivide più documenti (assegnazione golosa per sovrapposizione decrescente); i rimanenti per hash dei tre termini principali; argomenti con involucri che si toccano mai con la stessa tinta (colorazione golosa del grafo di adiacenza con 10 tinte); oltre 10 argomenti adiacenti tra loro: tinta ripetuta con contorno tratteggiato.
- **Tema scuro:** involucri 12% di riempimento e 35% di contorno, archi con opacità ≥ 0,22, aloni con `globalCompositeOperation = 'lighter'` (in chiaro `source-over`); test che misura il contrasto medio arco/fondo nei due temi (≥ 1,6:1 per gli archi leggeri).
- **Misura vera:** modello di 20 000 e 60 000 punti precalcolato in una fixture generata da script (nessun calcolo nel main), e2e in Electron sotto `RL_HEAVY_TESTS=1` che registra i frame di 3 s di panoramica (≥ 55 e ≥ 30 fps medi); il vecchio test con canvas finto si chiama "tempo di preparazione dei percorsi".
- **Revisione a vista prima del merge:** schermate a seme fisso (1024×700, 1280×800, 1920×1080 × chiaro/scuro × vuoto, 8 nodi, 200, 5000) rivedute dalla coppia di design con il prototipo P0 accanto; al massimo due giri di ritocchi dei soli parametri (spessori, opacità, tempi).
- **Accessibilità e puntine:** `L` dalla tela apre l'elenco Esplora; l'annuncio e il cartellino dicono sempre l'argomento; Mescola lascia le puntine, "Libera tutti" nel ⋯.

### 16.4 Identità visiva e prototipo P0 (D-378, D-382)

- **Accento:** petrolio (provvisorio) o indaco: l'utente sceglie nel prototipo con l'interruttore "Accento"; i valori sono in §5.2.1.
- **Barra laterale leggera:** stesso fondo `--bg` della vista, nessun bordo; voce attiva = pillola `--surface` con `--e-1` e testo `--accent-text`; selettore di libreria con il quadratino della tinta e il logo da 20 px nella stessa tinta.
- **Stati vuoti illustrati:** sei disegni a tratto 1,75 px in `--text-muted` con un dettaglio nella tinta dell'accento, 96×72 px, SVG in linea ≤ 1 KiB l'uno, in `components/illustrations.tsx` (pigro con le viste): libreria vuota (scaffale con un foglio che entra), tutto fatto (vassoio vuoto con una spunta), mappa da costruire (tre punti che si collegano), nessun risultato (lente su un foglio bianco), nessun backup (scatola aperta), offline (nuvola con una linea interrotta).
- **Microanimazioni con un significato** (`--dur`, mai con `prefers-reduced-motion`): riga confermata in Da rivedere che scivola a destra e svanisce; chip Attività il cui anello si chiude a fine scansione; pallino del colore che "salta" (scala 1 → 1,25 → 1) sul pennello scelto.
- **Prototipo:** `docs/design/prototipo/index.html`, un solo file (CSS e JS in linea, nessuna rete, dati sintetici, nessun nome reale), con i token di §5 e gli interruttori Tema e Accento; schermate: guscio con chip Attività, Libreria (filtri, elenco, barra di selezione), Lettore (barra unica in modo strumento), Impostazioni (sezioni, Avanzate), Account Claude, Mappa dal vivo (~40 nodi, forze, trascinamento con puntina, cartellino, Mescola, Sorprendimi). L'utente lo approva prima dell'onda 1; i ritocchi ai token si fanno prima nel prototipo, poi in `tokens.css` (A1).

---

## 17. Funzioni aggiunte (scelte dell'utente, D-389 … D-409)

Funzioni scelte dall'utente nei due giri di `docs/design/PROPOSTE-FUNZIONI.md`, collocate nell'interfaccia del giro 3 **senza affollarla**. Vincolo dell'utente: «I do not want the graphics to be crowded with functionalities» (D-402). Le onde che le costruiscono sono in §14.1 e il peso in §13.

### 17.1 Regole contro l'affollamento (D-402, D-412)

1. **Nessuna voce nuova nella barra laterale** e nessuna vista principale nuova. Le funzioni sono azioni su qualcosa che c'è già: un documento, una selezione, un progetto, una ricerca.
2. **Il conteggio dei controlli sempre visibili non supera quello del P0 approvato** (`docs/design/prototipo/index.html`) in nessuna vista principale. Il riferimento è il P0, non questo documento: i numeri di §17.3 sono contati sul P0.
3. **Ingressi contestuali, nell'ordine di preferenza:**
   - l'oggetto stesso (popover, cartellino del nodo, riga attiva);
   - il `⋯` o il menu dell'oggetto;
   - una sezione **chiusa** della scheda;
   - lo stato vuoto del posto dove la funzione serve;
   - la tavolozza (Ctrl+K), che elenca **tutte** le funzioni.
4. **Rivelazione progressiva, ma senza crescita permanente:** una scheda che compare dopo il primo uso conta nel conteggio (§17.3 "dopo il primo uso").
5. **✦ solo per ciò che invia sempre a Claude** (D-413). Una funzione che funziona anche senza Claude non sta nel menu `✦ Claude ▾`: il passo ✦ è un pulsante dentro il suo risultato.
6. **Stati vuoti che insegnano:** le azioni che si fanno una volta (scrivere lo schema, collegare un manoscritto) stanno nello stato vuoto del posto dove servono e nella tavolozza, non in un `⋯`.
7. **Menu (D-412):**
   - al massimo **7 voci** per menu, un solo livello, al massimo **3 gruppi** separati da un divisore;
   - le voci **non compaiono e non spariscono** con il contesto (dimensione della selezione, tipo di documento): una voce che non si può usare è disattivata con il motivo nel tooltip ("Seleziona 2 documenti"). L'unica eccezione è la voce dell'esperimento 30, che esiste solo con Impostazioni › Avanzate › Funzioni sperimentali acceso: è una scelta dell'utente, non un contesto;
   - le righe di stato ("Aggiornato alle 10:42") non sono voci: vanno nel tooltip della voce, in un'intestazione di gruppo o in Attività.
8. **Criterio di accettazione:** `e2e/crowding.spec.ts` (scritta dall'agente principale prima dell'onda 7, §14.1) conta i controlli visibili per vista a 1280×800 e a 1024×700, **apre ogni menu e conta le voci e i gruppi**, e confronta con i numeri del P0 di §17.3. Un compito che fa crescere un numero non si unisce.

### 17.2 Uso di Claude, dati e peso in comune

**Claude (D-404, regola unica di costo D-416).** L'uso di Claude dell'utente è limitato, quindi ogni funzione ✦ segue queste regole:

- **Solo su richiesta.** Nessun invio automatico, nemmeno in background, nemmeno a funzione accesa (vale anche per l'esperimento 30).
- **Modello:**
  - Haiku come predefinito, con il chip Modello nel dialogo (lo stesso del pannello Claude);
  - Sonnet proposto solo dove la qualità conta molto (note di letteratura, resoconto), sempre scelto dall'utente.
- **Invii in blocco:** fino a 10 abstract per richiesta (sintesi dei candidati, classificazione dei ponti, tabelle).
- **Cache** per `hash(contenuto) + modello + versione del prompt`, nella cartella cache locale (non sincronizzata). Una richiesta già fatta non si ripete e lo dice ("Già pronto, 0 invii" / "Ready · nothing sent").
- **Una sola regola per l'anteprima del costo**, uguale per ogni funzione:
  - **dialogo `AiCostPreview`** quando la stima supera la soglia scelta dall'utente (Impostazioni › Claude, predefinita **5 000 token**), oppure quando si invia per la prima volta il testo dei documenti di una cartella, oppure quando si invia testo scritto dall'utente (consenso a parte, D-423);
  - **sotto la soglia**, nessun dialogo: la stima sta nel pulsante stesso ("✦ Spiega · ≈ 900 token · Haiku");
  - il dialogo mostra cosa si invia, quante richieste, token stimati (o il costo in valuta con una chiave API) e la quota del giorno ("Oggi: 38 % del tetto usato").
- **Tetto di spesa** per il giorno, in Impostazioni › Claude. Oltre il tetto, il dialogo propone meno elementi o Haiku.
- **Cartella non abilitata** (regola 4): ogni funzione che manda testo dei documenti ha lo stesso stato, "La cartella di questo documento non è abilitata per l'invio del testo · Abilita…", e dove ha senso un ripiego dichiarato (solo titolo e abstract).
- **Marcatura:** ogni testo prodotto porta ✦, il modello e la data (regola 5). Diventa dell'utente solo quando lui lo approva o lo riscrive.
- **Ripiego senza Claude:** ogni funzione che ha un risultato utile anche senza Claude lo mostra comunque, ed è il risultato **predefinito** dove l'invio è grande (ricerca approfondita, Trova un ponte, Estendi la bibliografia).

**Dati (D-405, regola 1).**

- Tutto ciò che è testo dell'utente o di Claude è un file Markdown nella cartella dati della libreria, uno per elemento, scritto in modo atomico.
- Indici e cache sono locali e rigenerabili.
- Nessuna funzione scrive fuori dalla cartella dati, tranne due casi, sempre scelti dall'utente:
  - il `.bib` collegato a un progetto (7, nella cartella di export scelta dall'utente; mai sopra modifiche esterne, D-421);
  - le esportazioni.

**Peso (D-407, D-426).**

- **Renderer:** ogni funzione ha chunk pigri, **ciascuno ≤ 16 KiB** (tetto per chunk controllato da `check:budget`), caricati all'apertura del dialogo o pannello.
- **Main:** ogni funzione ha un modulo caricato su richiesta (`import()` al primo uso, ≤ 30 KiB) dietro il registro `main/features/registry.ts`.
- La prima schermata, l'avvio e la memoria a riposo non cambiano.

### 17.3 Affollamento per vista: conteggi onesti sul P0 (D-410 … D-412)

Conteggio dei controlli **sempre visibili**: pulsanti, campi, schede e chip fissi; un'etichetta che non si clicca non conta; non contano le righe di contenuto. Misura sul P0 approvato a 1280×800, nello stato normale, senza selezione salvo dove indicato. "Doc" è il numero che il progetto prevedeva prima di questa revisione, quando diverso dal P0.

**Controlli sempre visibili**

| Vista (zona) | P0 | Dopo le funzioni | Come |
| --- | --- | --- | --- |
| Barra laterale | 5 sezioni + 3 in basso | **5 + 3** | nessuna voce nuova |
| Barra in alto del guscio | 9 (‹ ›, campo di ricerca, ?, ✦ Cerca con Claude, ↶, 🕘, Comandi, Attività) | **9** | Riprendi è la prima riga del menu del campo di ricerca vuoto (al fuoco), non un pulsante né un banner (D-414) |
| Libreria · intestazione | 4 (Vista ▾, + Aggiungi PDF, ⋯, ◫) | **4** | "+ Aggiungi PDF" → "+ Aggiungi ▾", pulsante diviso |
| Libreria · riga dei filtri | 8 (6 facet, Pulisci, Mostra i file mancanti) | **8** | "Risorse" è un valore del facet Tipo |
| Libreria · barra di selezione | 5 (Tag, Progetto, ✦ Claude, ⋯, Deseleziona) | **5** | voci nuove dentro i due menu, nei limiti di §17.1 regola 7 |
| Libreria · riga attiva | 3 (Leggi, Scheda, ⋯) | **3** | una risorsa mostra "Apri" al posto di "Leggi" |
| Scheda del documento | 3 azioni + 5 sezioni chiuse | **3 + 5** | "Note sul file" → "Note" (file, letteratura ✦, collegamenti in entrata); "File" → "File e risorse" |
| **Lettore · barra** | **22** (chiudi; 4 strumenti; 5 colori; ‹, campo pagina, ›; −, +, adatta; cerca; chip PDF; Studio; Annulla; Pannello; ⋯) — doc: "24" | **13** (chiudi; 5 strumenti con Ritaglia; pallino del colore; campo pagina; "110 % ▾"; cerca; Studio ▾; Pannello; ⋯) | D-410: −4 colori, −2 frecce, −2 zoom (un menu), −1 chip PDF (dentro Studio), −1 Annulla (Ctrl+Z e ⋯), +1 Ritaglia |
| Lettore · popover della selezione (solo in Seleziona, con testo selezionato) | 0 (non c'era) — doc: 3 | **3** (Copia · Evidenzia nel colore attivo · ✦ Spiega) | D-415: con uno strumento attivo non compare; Sottolinea è lo strumento U |
| Lettore · popover dell'annotazione | 7 (5 colori, 💬, 🗑) — doc: 9 (con il tipo ▌ _) | **8** (5 colori, 💬, Usa come prova, 🗑) | D-424: il cambio di tipo passa nel `⋯` della voce nel pannello Annotazioni; "Usa come prova" al primo livello |
| Lettore · pannello | 3 schede | **3** | "Letteratura ✦" è un valore del `Segmented` Note (Pagina · File · Letteratura · Tutte) |
| Lettore · segni sul testo a riposo | evidenziazioni e sottolineature dell'utente | **le stesse** | nessun segno delle citazioni (D-415) né della guida (D-425) sul testo |
| Da rivedere | invariata | **invariata** | nessuna funzione nuova qui |
| Scopri · intestazione e schede | 2 (primario, ⋯) + 4 schede | **2 + 4** | primario "Nuova ricerca ▾"; scheda "Ricerche" al posto di "Fonti seguite", che si gestiscono dalla riga in cima a Novità (D-427) |
| Progetto · intestazione e schede | 2 (primario, ⋯) + 3 schede | **2 + 3**, **2 + 4 dopo il primo uso** | una sola scheda "Schema" che contiene anche domande, affermazioni e prove (D-411) |
| Mappa | invariata | **invariata** | Disponi per anno nel `⋯` della vista; Trova un ponte con… nel `⋯` del cartellino |
| Pannello Claude | invariato | **invariato** | le funzioni ✦ usano i loro dialoghi o la stima nel pulsante |
| Impostazioni | 7 sezioni | **7** | gruppi nuovi dentro sezioni esistenti: Libreria › Modelli di nota e Significato dei colori; Claude › Soglia e tetto di spesa; Avanzate › Funzioni sperimentali |

Totale dei controlli sempre visibili nelle viste principali: **−9 rispetto al P0** (tutti nella barra del lettore). Crescite: popover dell'annotazione +1 (compare solo su un'annotazione), popover della selezione 3 (nuovo, compare solo con un testo selezionato in Seleziona), progetto +1 scheda dopo il primo uso.

**Voci dei menu** (tetto 7 voci, 3 gruppi; misurate da `crowding.spec.ts`)

| Menu | P0 / doc prima | Dopo | Gruppi e voci |
| --- | --- | --- | --- |
| `+ Aggiungi ▾` | — | **4** · 1 gruppo | PDF… · Da DOI, arXiv o URL… · Da Zotero o BibTeX… · Risorsa o link… |
| `⋯` della Libreria | 3 | **3** · 1 | Gestisci tag · Esporta… · Scansiona ora |
| `✦ Claude ▾` della selezione | doc 6 | **4** · 2 | Proponi con Claude… ┃ Scrivi le note di letteratura… · Tabella di confronto… · Panoramica dei gruppi di ricerca… |
| `⋯` della selezione | doc 6 | **7** · 3 | Aggiorna citazioni · Esporta… (secondo cervello e bibliografia) · Apri con il programma predefinito ┃ Leggi affiancati (2) · Linea del tempo ┃ Estendi la bibliografia… · Trova un ponte (2) |
| `⋯` della scheda | doc 6 | **6** · 3 | Apri con il programma predefinito · Mostra nella cartella ┃ Aggiorna citazioni · Esporta… ┃ ✦ Proponi con Claude… · ✦ Panoramica dei gruppi… |
| `⋯` del lettore | doc 7 (fino a ~11 a 1024) | **6**, **7** con Funzioni sperimentali · 3 | Annulla · Cronologia · Affianca un altro paper… ┃ Apri con il programma predefinito · Mostra nella cartella · Esporta copia annotata… ┃ ☐ Guida ✦ (sperimentale) · G. A 1024 px la barra non riduce più nulla nel `⋯`. Tasti del lettore: tasto `?`, Aiuto e tavolozza |
| `Studio ▾` del lettore | doc: Studio e chip PDF separati | **5** · 2 | Stato di studio: Da leggere · In lettura · Letto ┃ intestazione "Nel PDF ✓ · scritto alle 10:42": ✓ Salva anche nel PDF · Togli dal PDF… |
| `110 % ▾` del lettore | — | **4** · 1 | Adatta alla larghezza · Adatta alla pagina · 100 % · 150 % (Ctrl±, Ctrl+rotella) |
| `Nuova ricerca ▾` di Scopri | — | **3** · 1 | Da una domanda… · Estendi la bibliografia… · Trova un ponte…, ognuna con una frase sotto il nome |
| `⋯` di Scopri | doc 3 | **2** · 1 | Aggiorna le citazioni · Elimina le ricerche vecchie |
| `⋯` del progetto | doc 10 + una riga di stato | **7** · 3 | Collega un file .bib… · Esporta… (secondo cervello e bibliografia) ┃ ✦ Resoconto del periodo… · ✦ Tabella di confronto… · ✦ Suggerimenti di citazione… ┃ Rinomina · Archivia |
| `⋯` della Mappa | 3 | **4** · 2 | Opzioni del modello · Disponi per anno ┃ Esporta l'immagine · ✦ Etichette con Claude… |
| `⋯` del cartellino del nodo | doc 0 | **1** | Trova un ponte con… |

### 17.4 Le funzioni, una per una

Schema di ogni voce: **Dove** (superficie e ingresso), **Stati**, **Claude**, **Dati**, **Peso** (R = chunk pigro del renderer, M = modulo pigro del main), **Carico visivo**.

#### 17.4.1 Aggiungere: il menu "+ Aggiungi ▾" (7, 23, 48)

```
[[+ Aggiungi ▾]]
 ┌───────────────────────────────────┐
 │ PDF…                       Ctrl+O │  ← come oggi (clic sul corpo del pulsante)
 │ Da DOI, arXiv o URL…              │  23
 │ Da Zotero o BibTeX…               │  7
 │ Risorsa o link…                   │  48: codice, dati, pagina web, notebook, cartella
 └───────────────────────────────────┘
```

Pulsante diviso: il corpo aggiunge un PDF come oggi, la freccia apre il menu. Lo stesso menu è nello stato vuoto della Libreria e nella tavolozza ("Aggiungi da DOI…", "Importa da Zotero…", "Aggiungi una risorsa…").

#### 17.4.2 Importazione da Zotero e BibTeX gestito direttamente (7, con 52; 13 da confermare, onda 12)

- **Dove:** "+ Aggiungi ▾ › Da Zotero o BibTeX…" apre un dialogo in tre passi:
  1. scegli il file (BibTeX/BibLaTeX, CSL JSON, RDF di Zotero);
  2. abbinamento ai PDF per percorso o hash, con conteggi ("212 con file · 9 senza file · 4 già in libreria");
  3. riepilogo con tag, collezioni → progetti o tag (scelta), note → note sul file.
- **BibTeX gestito:**
  - nel `⋯` del progetto, "Collega un file .bib…" sceglie un file nella cartella di export scelta dall'utente; l'app lo riscrive a ogni cambiamento del progetto (52: sempre aggiornato), in modo atomico, **solo se l'hash del file è quello della sua ultima scrittura** (D-421). Se il file è stato cambiato fuori dall'app (a mano, dall'editor LaTeX, da Zotero), non scrive e mostra nel progetto il banner "Il file .bib è stato modificato fuori dall'app" [Sovrascrivi] [Scollega]. La prima riga del file è `% Generato da Research Lab: le modifiche qui verranno sovrascritte`;
  - "Esporta…" del progetto e della selezione (un solo dialogo con il secondo cervello) offre BibTeX; RIS, CSL JSON e lo schema delle chiavi scelto dall'utente arrivano con la 13, **da confermare** (onda 12, D-422);
  - chiavi stabili `autoreAnnoParola`, salvate nei dati del documento, che non cambiano più dopo la prima scrittura (servono al `.bib` collegato).
- **Stati:**
  - analisi del file, con avanzamento nel chip Attività;
  - anteprima;
  - importazione annullabile, con il ripristino come nella Cronologia;
  - errori per voce in un elenco "Non importate (motivo)";
  - `.bib` collegato: "Aggiornato alle 10:42" nel tooltip della voce "Collega un file .bib…" (mai una riga di stato nel menu, §17.1 regola 7) e nella riga di Attività; modifiche esterne o errore di scrittura: banner nel progetto.
- **Claude:** nessuno.
- **Dati:**
  - i documenti come oggi;
  - il collegamento `.bib` in `projects/<id>/project.json` (`bibLink`: percorso relativo alla cartella di export);
  - le chiavi in `docs/<id>.json` (`citeKey`);
  - gli originali non si spostano mai.
- **Peso:** R 6-8 (dialogo); M 15-20 (`features/bib`: lettura di BibTeX, BibLaTeX, CSL JSON e RDF minimo, scrittura BibTeX, abbinamento); la 13 aggiunge 3-4 nell'onda 12.
- **Carico visivo:** nessun controllo nuovo visibile; una voce di menu e una voce nel `⋯` del progetto.

#### 17.4.3 Importazione da DOI, arXiv o URL (23)

- **Dove:** "+ Aggiungi ▾ › Da DOI, arXiv o URL…" apre un popover con un campo che accetta più righe.
- **Comportamento:**
  - i dati arrivano da OpenAlex e arXiv, già consentiti;
  - il PDF aperto, se esiste, si scarica **solo dopo conferma**, nella cartella di arrivo;
  - senza PDF il documento entra come voce "solo dati", con lo stato "Senza file" (facet Stato).
  - Incollare un DOI nel campo di ricerca propone la stessa azione nel menu del campo.
- **Stati:** riconosciuto (titolo, autori, anno) · già in libreria (link) · non trovato · offline (spiegazione e Riprova).
- **Claude:** nessuno.
- **Dati:** `docs/<id>.json` come oggi, `source: "doi"|"arxiv"|"url"`.
- **Peso:** R 2-3; M 4-6.
- **Carico visivo:** zero controlli visibili.

#### 17.4.4 Risorse oltre i PDF (48 generalizzata, D-398)

```
Libreria (facet Tipo: Risorse)
| ⌘ repo   Codice del metodo X            github.com · collegata a 2 paper     [Apri][Scheda][⋯] |
| ▦ dati   Dataset delle misure 2019       zenodo.org · collegata al progetto P   |
| ◫ nb     Analisi preliminare.ipynb       cartella locale                        |

Scheda › File e risorse
| ▤ paper-1.pdf · 1,8 MB · Capitolo 1/                                          |
| ⌘ Codice del metodo X · github.com                         (Apri) (⋯)          |
| Trovati nel testo: 2 link a codice o dati   (Rivedi)                          |  ← suggerimenti, mai aggiunti da soli
| (+ Collega una risorsa)                                                       |
```

- **Dove:**
  - "+ Aggiungi ▾ › Risorsa o link…";
  - nella Libreria, le risorse sono righe con l'icona del tipo (nessun colore nuovo) e il facet Tipo "Risorse";
  - scheda del documento › "File e risorse": risorse collegate, suggerimenti dal testo, "+ Collega una risorsa";
  - progetto › Documenti: le risorse del progetto in fondo all'elenco, con lo stesso badge.
- **Anteprima:**
  - a richiesta ("Carica l'anteprima · contatta il sito"), dalla pagina indicata dall'utente; il dialogo dice in una riga che leggere il titolo contatta il sito;
  - richiesta senza cookie, limite di 512 KB, solo `<title>` e la descrizione meta;
  - nessuna immagine remota (icona generica per tipo).
- **Apri:** `shell.openExternal` solo per `http/https`; una cartella o un notebook locale si apre con il programma predefinito.
- **Stati:** senza anteprima · anteprima caricata · link non raggiungibile (avviso, la risorsa resta) · file locale mancante (come i file mancanti).
- **Claude:** nessuno.
- **Dati:** `resources/<id>.json` con tipo, URL o percorso relativo, titolo, descrizione, collegamenti `{docs:[], projects:[]}`, anteprima e data.
- **Peso:** R 6-8; M 5-8 (rilevamento dei link nel testo già estratto, anteprima con limiti).
- **Carico visivo:** nessun controllo nuovo nelle barre; "Apri" sostituisce "Leggi" sulla riga attiva di una risorsa.

#### 17.4.5 Riprendi da dove avevo lasciato (25, D-414)

- **Dove:**
  - il campo di ricerca della barra in alto, **vuoto e col fuoco**, mostra come prima riga del suo menu "Riprendi: *Titolo* · p. 12 · ieri" e sotto gli ultimi 3 documenti;
  - la tavolozza ha "Riprendi la lettura" come prima voce quando è vuota (Ctrl+Maiusc+R);
  - **nessun banner all'avvio normale.** Solo dopo una chiusura non pulita (l'app si è chiusa con un documento aperto, per esempio un arresto) compare una volta il `Banner` "Il lettore si è chiuso mentre leggevi *Titolo* (p. 12). Riprendi".
- **Stati:** nessuna lettura recente → la riga non c'è (è contenuto del menu, non una voce di comando).
- **Claude:** nessuno.
- **Dati:** la posizione di lettura già salvata; se manca, due campi nello stato di studio del documento (`lastPage`, `lastOpenedAt`) e un segno di sessione aperta, tolto alla chiusura normale.
- **Peso:** R iniziale +0,5 (riga del menu di ricerca, che è già nel primo caricamento).
- **Carico visivo:** zero controlli e zero banner nell'uso normale.

#### 17.4.6 Note di letteratura estese (2, D-390) con modelli (35), LaTeX (37) e link (38)

```
Scheda › ▾ Note
| Note sul file          (2)                        (Apri) |
| ┃✦ Nota di letteratura · Haiku · 18/11  (Approva)(⋯)    |  ← "Scrivi la nota di letteratura ✦" se non c'è
| Collegamenti in entrata (3)                              |  ← note che puntano a questo paper con [[ ]]

Nota di letteratura (pannello del lettore › Note › Letteratura, o "Apri" a tutta area)
# Titolo del paper
## Problema           ✦ … (p. 2)
## Contributo         ✦ …
## Metodo             ✦ … (p. 4-5)
## Risultati          ✦ … (p. 7)  «evidenziazione dell'utente» (p. 7)
## Dati usati         ✦ … · ⌘ Codice del metodo X (risorsa)
## Figure e grafici   [miniatura Fig. 3, p. 6] didascalia…
## Limiti e prospettive ✦ …
```

- **Dove:**
  - scheda del documento › sezione "Note", che unisce le note sul file, la nota di letteratura e i collegamenti in entrata;
  - nel lettore, valore "Letteratura" del `Segmented` della scheda Note;
  - per più paper, nella barra di selezione, `✦ Claude ▾ › Scrivi le note di letteratura…`: l'anteprima mostra il totale (documenti, token) e propone **al massimo 5 per volta** (D-418).
- **Generazione:**
  1. anteprima con `AiCostPreview` (una nota è sempre sopra la soglia di D-416);
  2. un paper alla volta, in coda nel chip Attività, annullabile;
  3. il testo arriva solo dalle cartelle abilitate (regola 4); con la cartella non abilitata la nota si può scrivere **solo da titolo e abstract**, con l'avviso che sarà povera;
  4. le figure sono quelle incorporate nel PDF (estratte così come sono) o la zona della pagina resa dal lettore in WebP (stessa via del Ritaglio, 17.4.8);
  5. ogni affermazione ha il link `lab://doc/<id>?page=N`, e le evidenziazioni dell'utente entrano come citazioni con pagina.
- **Modelli di nota (35):** Impostazioni › Libreria › "Modelli di nota" (elenco di `.md` con segnaposto `{{titolo}}`, `{{autori}}`, `{{anno}}`, `{{evidenziazioni}}`). La nota di letteratura usa il modello "Letteratura", con le 7 sezioni predefinite, modificabile. "Nuova nota" propone il modello solo se ce n'è più di uno (menu del pulsante).
- **LaTeX (37, D-406):** `$…$` e `$$…$$` nelle note, resi in MathML dal convertitore proprio quando la riga non ha il fuoco; una formula non capita si mostra com'è, con un segno discreto (punto `--text-subtle` e tooltip "Formula non resa"), mai un errore rosso, e "Copia LaTeX".
- **Link (38):** `[[` apre il completamento (documenti, note, progetti, risorse); un link si salva per **identificativo** e mostra il titolo attuale (`[[Titolo|lab://doc/<id>]]`, il titolo si aggiorna alla lettura), quindi rinominare non rompe i link. I "Collegamenti in entrata" stanno nella sezione Note della scheda e in fondo a ogni nota.
- **Stati:**
  - nessuna nota (riga con "Scrivi la nota di letteratura ✦");
  - in coda;
  - in scrittura (le sezioni arrivano una alla volta);
  - **"Bozza ✦ da approvare"**, scritto nella riga della scheda e nel pannello del lettore (bordo `--ai`, pulsante Approva);
  - approvata (bordo normale, ✦ resta nei metadati);
  - cartella non abilitata (spiegazione e "Abilita la cartella");
  - errore (Riprova).
- **Claude:**
  - Haiku predefinito, Sonnet a scelta;
  - circa 12-18 mila token in ingresso e 1,5-2 mila in uscita per paper;
  - cache per hash del testo;
  - "Rigenera una sezione" invia solo quella sezione e il contesto.
- **Dati:**
  - `literature/<docId>.md`, con le figure in `literature/<docId>/fig-<n>.webp` (≤ 300 KB ciascuna);
  - modelli in `templates/*.md`;
  - indice dei link nella cache SQLite locale, rigenerato dalle note.
- **Peso:** R 19-23 in **tre chunk** ≤ 16 KiB (D-426): editor delle note con LaTeX, `[[` e modelli 10-13; nota di letteratura 7-8; collegamenti in entrata 2. M literature 8-12, links 3-5.
- **Carico visivo:** nessuna sezione nuova nella scheda (due sezioni unite in una); nessun pulsante nuovo nel lettore.

#### 17.4.7 Tabella di confronto (16)

```
Progetto P › Note › Tabella: Metodi a confronto                         [Esporta CSV] [⋯]
| Paper            | Problema ✦ | Metodo ✦ | Dati ✦      | Risultati ✦ | Limiti ✦ | + colonna |
| Autore A 2021    | …   p. 2   | …   p. 4 | Dataset X   | … p. 7      | …        |           |
| Autore B 2019    | …          | …        | non dichiarato | …        | …        |           |
```

- **Dove:**
  - barra di selezione `✦ Claude ▾ › Tabella di confronto…`, da 2 a 30 paper;
  - nel progetto, `⋯ › ✦ Tabella di confronto…`.
- **Comportamento:**
  - si apre a tutta area, come il lettore, con le briciole "Progetto › Tabella";
  - colonne predefinite dal modello "Letteratura", aggiungibili con un nome libero ("Dimensione del campione");
  - ogni cella ha il link alla pagina;
  - le celle già presenti nella nota di letteratura del paper **si riusano senza invii**;
  - la tabella si salva nel progetto scelto (o in un progetto nuovo dal dialogo).
- **Stati:** celle in attesa (grigie), in scrittura, pronte (✦), modificate dall'utente (senza ✦), "non trovato nel testo".
- **Claude:** solo le celle mancanti, in blocchi (fino a 10 paper per colonna per richiesta), Haiku; ogni cella scritta da Claude porta il suo ✦. L'anteprima conta le **celle** (documenti × colonne), non i documenti: "18 celle già pronte dalle note, 42 da scrivere: 6 richieste".
- **Dati:** `projects/<id>/tables/<id>.md` (tabella Markdown e metadati in testa); CSV solo su "Esporta CSV".
- **Peso:** R 6-8; M parte di `features/synthesis` (4-6 con gruppi e linea del tempo).
- **Carico visivo:** una voce del menu ✦; la tabella vive nel progetto, non in una vista nuova.
- **Rinuncia:** quarta nell'ordine di rinuncia (D-426).

#### 17.4.8 Ritaglio di figure, tabelle ed equazioni (27)

- **Dove:** quinto strumento del lettore, "Ritaglia" (tasto `R`). Si trascina un rettangolo; al rilascio il ritaglio va **in una sola destinazione predefinita**, le note della pagina (e l'elenco delle Annotazioni), con il toast "Ritaglio salvato nelle note della pagina · Copia · Annulla". Un clic sul ritaglio apre il suo popover: tipo (Figura · Tabella · Equazione · Altro), didascalia, Copia immagine, ✦ Spiega. Gli appunti non si toccano senza "Copia" (D-427, scelta diversa dalla critica: vedi §17.7).
- **Comportamento:**
  - il ritaglio è un'annotazione di tipo `area`, nell'elenco delle Annotazioni con la miniatura;
  - entra nella nota di letteratura (sezione Figure) e nelle note con `![[ritaglio]]`.
- **Stati:** trascinamento (rettangolo tratteggiato `--accent`) · salvato · rettangolo troppo piccolo (< 24 px, ignorato) · pagina non ancora resa (attesa).
- **Claude:** nessuno, salvo "✦ Spiega" (17.4.9).
- **Dati:** `crops/<docId>/<annId>.webp` (resa dal lettore con la tela di pdf.js, `toBlob('image/webp')`, ≤ 300 KB, alla risoluzione della pagina × 2); l'annotazione negli annotazioni del documento come oggi (`kind: "area"`, `geom: 2`). Non entra nel PDF (le aree non sono nel piano della scrittura, §8.3).
- **Peso:** R 3-4 (chunk del lettore); M 1-2 (salvataggio, in `features/crops`).
- **Carico visivo:** strumenti da 4 a 5, dentro la barra da 13 controlli di D-410 (§4.3, §17.3).

#### 17.4.9 Spiega formula, tabella o figura (31)

```
┌ ✦ Spiega · Haiku ───────────────────────────── × ┐
│ Cosa dice: …                                     │
│ Simboli: α = …, β = …                            │
│ Nel paper: serve a … (p. 5)                      │
│ (Copia) (Aggiungi alle note) (Più dettagli ✦)     │
└──────────────────────────────────────────────────┘
```

- **Dove:**
  - popover della selezione del lettore in modo Seleziona (Copia · Evidenzia · ✦ Spiega, D-415), su testo selezionato;
  - popover di un ritaglio, "✦ Spiega" (su una figura o tabella);
  - menu contestuale di un'equazione ritagliata.
- **Comportamento:** la spiegazione appare in una carta ancorata **sotto** il passaggio, senza coprirlo, con "Copia nella nota" (D-417).
- **Stati:** in attesa (righe scheletro) · pronta · **cartella non abilitata**: la voce resta attiva e la carta dice "La cartella di questo documento non è abilitata per l'invio del testo · Abilita…" senza inviare nulla · limite raggiunto (con il tetto).
- **Claude:**
  - Haiku;
  - si inviano il testo selezionato e il paragrafo intorno (≤ 1.500 token);
  - per una figura, la didascalia e il testo intorno; l'immagine solo se l'utente sceglie "Includi l'immagine" (il costo cresce ed è mostrato);
  - regola unica del costo (D-416): sotto la soglia la stima sta nel pulsante ("✦ Spiega · ≈ 900 token · Haiku"), sopra la soglia (per esempio con l'immagine) il dialogo;
  - cache per hash della selezione.
- **Dati:** niente di salvato salvo "Copia nella nota": un blocco marcato ✦ nella nota della pagina.
- **Peso:** R 2-3; M 2-3 (`features/explain`).
- **Carico visivo:** una delle 3 voci del popover della selezione, che compare solo in Seleziona con un testo selezionato.

#### 17.4.10 Colori con un significato (36)

- **Dove:**
  - Impostazioni › Libreria › "Significato dei colori": 5 righe "● Giallo — *Risultato chiave*";
  - nel lettore i nomi compaiono nel tooltip del pallino del colore e dei 5 colori del suo popover, e nel popover dell'annotazione;
  - nel pannello Annotazioni c'è un filtro per significato, un menu dentro il `⋯` del pannello.
- **Stati:** nessun significato (tooltip con il solo nome del colore, come oggi).
- **Claude:** nessuno.
- **Dati:** `library.json`, `annotations.colorMeanings` (5 stringhe).
- **Peso:** R 2.
- **Carico visivo:** zero controlli nuovi.

#### 17.4.11 Lettura affiancata (3)

```
| [×] Libreria › A ⇄ B │ strumenti … │ [⇆ Scambia] [◫] [⋯] |
+--------------------------------+--------------------------------+
|  Paper A (fuoco: bordo --accent) |  Paper B                       |
|  pagine…                         |  pagine…                       |
+--------------------------------+--------------------------------+
```

- **Dove:**
  - nel `⋯` del lettore, "Affianca un altro paper…" (scelta con la ricerca della tavolozza);
  - nel `⋯` della barra di selezione, "Leggi affiancati", attiva con esattamente 2 selezionati e altrimenti disattivata con il motivo "Seleziona 2 documenti".
- **Comportamento:**
  - una barra sola, che agisce sul lato con il fuoco (bordo 2 px `--accent` sul lato attivo);
  - divisore trascinabile;
  - `Ctrl+Alt+←/→` sposta il fuoco;
  - "Scorrimento legato" è un piccolo interruttore sul divisore (e `Ctrl+Alt+L`), spento di base: non sta nel `⋯`;
  - sotto 1280 px "Affianca" apre il secondo paper come scheda alternata (`Ctrl+Tab`), con il motivo in un toast ("Finestra stretta: i due paper si alternano").
- **Stati:** un lato in caricamento · un file mancante (stato vuoto in quel lato) · larghezza insufficiente (schede).
- **Claude:** nessuno.
- **Dati:** nessuno di nuovo (posizioni come per ogni lettura).
- **Peso:** R 5-7.
- **Carico visivo:** la barra resta una, da 13 controlli; "⇆ Scambia" sta sul divisore, non nella barra.

#### 17.4.12 Schede delle citazioni nel lettore (29, D-415)

```
… come mostrato in [12] …        ← a riposo nessun segno; sottolineato solo sotto il puntatore
        ┌──────────────────────────────────────────┐
        │ Autore C, Autore D · 2018 · Rivista      │   ← al clic
        │ Titolo del lavoro citato                 │
        │ ✓ in libreria (Apri)  oppure  (Leggi dopo) (Importa) │
        └──────────────────────────────────────────┘
```

- **Dove:** al **clic** su un riferimento nel testo (`[12]`, "Autore, 2018") in modo Seleziona, oppure con Ctrl + passaggio del mouse; mai con uno strumento di disegno attivo (Evidenzia, Sottolinea, Ritaglia, Gomma), dove il clic appartiene allo strumento. Tastiera: dal testo, `Alt+C` sul riferimento più vicino al fuoco, poi `Tab` tra i riferimenti della pagina.
- **Riconoscimento:**
  1. elenco dei riferimenti dal testo estratto;
  2. abbinamento ai riferimenti di OpenAlex già in cache (o con "Aggiorna citazioni");
  3. un riferimento non abbinato mostra il testo grezzo della bibliografia.
- **Stati:** riconosciuto in libreria · riconosciuto fuori libreria · solo testo · bibliografia non trovata (il clic non fa nulla di speciale).
- **Claude:** nessuno.
- **Dati:** mappa dei riferimenti in cache locale (`refs` nella cache SQLite, rigenerabile).
- **Peso:** R 3-4; M 3-4 (`features/refs`).
- **Carico visivo:** nessun controllo, **nessun segno a riposo**; il riferimento si sottolinea (`--text-subtle`, punteggiato) solo mentre è sotto il puntatore e il cursore diventa una mano.

#### 17.4.13 Scheda Schema del progetto: schema della ricerca, domande e prove (40, 54; manoscritto 49 da confermare, D-411)

```
Progetto P   [Documenti] [Piano di lettura] [Note] [Schema]                [[Aggiungi documenti…]] [⋯]
Schema   ( Ricerca | Manoscritto · da confermare )                           [ Solo prove ☐ ]
Idea ……………………………………………………………………………………………………………………………… (Modifica)
Domanda 1: Il metodo X funziona con pochi dati?
  Affermazione: «Con meno di 100 campioni l'errore cresce»   sostiene: A 2021 p. 7 ▌ · C 2018 p. 3
                                                             contraddice: B 2019 p. 9 ▌     (+ prova) (⋯)
Domanda 2: …   (nessuna affermazione · nel lettore: popover dell'evidenziazione › Usa come prova)
Ipotesi (2) · Piano
```

- **Dove:**
  - **una sola scheda "Schema"**, che compare quando si scrive lo schema o alla prima affermazione: il progetto ha al massimo **4 schede** (Documenti, Piano di lettura, Note, Schema);
  - l'ingresso per crearla è lo **stato vuoto** della scheda Note ("Scrivi lo schema della ricerca: idea, domande, ipotesi, piano") e la tavolozza, non il `⋯` del progetto (azione che si fa una volta, §17.1 regola 6);
  - le domande, le affermazioni e le prove (17.4.15) stanno **sotto le domande** dello schema; "Solo prove" è un filtro della scheda, non una scheda;
  - il valore **Manoscritto** del `Segmented` (sezioni lette in sola lettura dai titoli di un `.md`, `.tex` o `.docx` scelto dall'utente, vista Elenco o Matrice sezioni × fonti) esiste solo dopo la conferma dell'utente su D-399 (onda 12, Z1); fino ad allora il `Segmented` non c'è.
- **Stati:**
  - nessuno schema (la scheda non c'è; invito nello stato vuoto delle Note);
  - schema vuoto (inviti per ogni parte);
  - domanda senza affermazioni (con la frase che dice dove si crea una prova);
  - dopo Z1: manoscritto collegato e cambiato su disco ("Aggiorna le sezioni"), sezione sparita ("Senza sezione").
- **Claude:** nessuno di base. Dopo Z1, "✦ Proponi le assegnazioni" invia titoli e sezioni, mai il manoscritto intero.
- **Dati:** `projects/<id>/outline.md` (sezione "Ricerca"; la sezione "Manoscritto" e i blocchi `lab:assign` solo dopo Z1). Il manoscritto collegato è solo un percorso relativo: l'app non lo scrive mai.
- **Peso:** R 3-4 (schema) + 4-5 (prove, 17.4.15); dopo Z1 + 6-8 (matrice, chunk proprio). M parte di `features/project`; dopo Z1 + 3-4 (titoli da `.tex`, `.md`, `.docx` con un lettore ZIP minimo su `zlib`).
- **Carico visivo:** 3 schede finché lo schema non serve, 4 dopo; i filtri stanno nella scheda, non nell'intestazione.
- **Da confermare** con l'utente (D-399, D-422): la parte Manoscritto e la generalizzazione oltre la tesi.

#### 17.4.14 Resoconto per il relatore o il gruppo di lettura (54, D-400)

- **Dove:** nel `⋯` del progetto, "✦ Resoconto del periodo…". Il dialogo propone un periodo (ultime 2 settimane), un pubblico (relatore · gruppo di lettura · me) e le parti (letture, evidenziazioni chiave, note, affermazioni e prove, paper aggiunti, prossimi passi).
- **Condizione:**
  - richiede lo schema della ricerca (17.4.13) con almeno l'idea;
  - altrimenti la voce è disattivata con il motivo "Serve lo schema della ricerca del progetto", collegato a "Scrivilo ora".
- **Stati:** anteprima di cosa si invia · in scrittura · pronto (Markdown modificabile, marcato ✦) · esportato (Markdown o PDF via stampa).
- **Claude:**
  - Sonnet proposto, Haiku a scelta;
  - si inviano lo schema, i titoli e le note e citazioni del periodo (non i PDF), circa 3-6 mila token in ingresso.
- **Dati:** `projects/<id>/reports/<AAAA-MM-GG>.md`, elencato nella scheda Note del progetto.
- **Peso:** R 2-3; M parte di `features/project`.
- **Carico visivo:** una voce nel `⋯` del progetto.
- **Rinuncia:** terza nell'ordine di rinuncia (D-426).

#### 17.4.15 Domande, affermazioni e prove (40, D-424)

- **Dove:**
  - dentro la scheda Schema (17.4.13), sotto la domanda a cui rispondono;
  - un'affermazione si crea dal popover di un'evidenziazione nel lettore, con **"Usa come prova…" al primo livello** del popover (il cambio di tipo Evidenzia ↔ Sottolinea passa nel `⋯` della voce nel pannello Annotazioni, dove c'era già), dalla barra di selezione delle Annotazioni o da "+ Affermazione" nella scheda;
  - "Usa come prova…" c'è sempre: se il documento non è in un progetto, chiede in quale progetto e domanda metterla.
  - Lo stato vuoto della scheda Schema dice dove nasce una prova: "Collega le evidenziazioni alle domande: nel lettore, popover dell'evidenziazione › Usa come prova".
- **Stati:** domanda senza affermazioni · affermazione senza prove (`--warning` leggero) · prove in contrasto (etichetta "In discussione").
- **Claude:** facoltativo, "✦ Cerca prove · ≈ N token" per un'affermazione (regola unica del costo, D-416):
  1. ricerca locale nell'indice (nessun invio);
  2. Haiku classifica i 10 passaggi migliori come sostiene, contraddice o non pertinente;
  3. ogni proposta resta tale finché l'utente non la accetta.
- **Dati:** `projects/<id>/claims/<id>.md` (affermazione, domanda, prove con `lab://doc/<id>?page=N&ann=<annId>`).
- **Peso:** R 4-5; M parte di `features/project`.
- **Carico visivo:** nessuna scheda propria; nel popover dell'annotazione una voce al posto del cambio di tipo (P0 7 → 8 controlli, doc 9 → 8).

#### 17.4.16 Suggerimenti di citazione dentro un progetto (51, D-423)

- **Dove:** su una nota del progetto (e, dopo Z1, su una sezione del manoscritto collegato), "✦ Suggerisci citazioni…" nel `⋯` della nota o della sezione, e nel `⋯` del progetto (gruppo "Con Claude ✦").
- **Consenso a parte:** i paragrafi sono testo inedito dell'utente, non coperto dal consenso per cartella dei PDF. Il primo uso chiede "Invia i miei paragrafi a Claude" (consenso per progetto, revocabile in Impostazioni › Claude); ogni invio mostra il **testo esatto** che parte; si invia **un paragrafo o una sezione scelti**, mai la nota o il manoscritto interi.
- **Comportamento:**
  - per ogni paragrafo scelto senza citazione, fino a 3 candidati, prima dalla libreria e dal progetto, poi (a scelta) da OpenAlex;
  - motivo leggibile e il passaggio con pagina;
  - "Assegna alla domanda", "Copia la chiave" (`\cite{chiave}` o `[@chiave]`).
- **Stati:** consenso non dato (spiegazione e "Dai il consenso") · nessun paragrafo da coprire · suggerimenti · nessun candidato convincente (detto chiaramente).
- **Claude:**
  - recupero locale senza invii;
  - Haiku riordina i candidati di ogni paragrafo, a blocchi di 10 paragrafi;
  - dialogo sempre (testo dell'utente, D-416), con il testo esatto.
- **Dati:** nessun file nuovo; le assegnazioni accettate vanno in `outline.md`; il consenso in `projects/<id>/project.json` (`aiParagraphConsentAt`).
- **Peso:** R 3-4; M parte di `features/project`.
- **Carico visivo:** voci di menu solo dentro il progetto.
- **Rinuncia:** seconda nell'ordine di rinuncia (D-426).

#### 17.4.17 Scopri › Ricerche: Estendi la bibliografia, ricerca approfondita, Trova un ponte

L'intestazione di Scopri ha un solo primario, "Nuova ricerca ▾":

```
Scopri                                                                  [[Nuova ricerca ▾]] [⋯]
( Ricerche | Da leggere dopo | Novità | Pubblicati )
┌ Ricerche ───────────────────────────────────────────────────────────────────────────────┐
│ ▸ Estendi la bibliografia · Progetto P · 18/11 · 42 candidati, 6 nuovi da ieri   (Riesegui) │
│ ▾ Da una domanda: «metodi di stima con pochi dati» · 30 migliori · [✦ Sintesi: 10 · 20 · 50 · ≈ 7 000 token] │
│   1  Titolo del candidato · Autore E 2022 · pertinenza 0,86                         │
│      Problema: …   Metodo: …   Risultati: …   Dati: …   Limiti: non dichiarato       │
│      (Leggi dopo) (Importa) (Scarta) (Apri la fonte)                                │
│ ▸ Ponte tra A 2021 e B 2019 · 3 ponti                                               │
└─────────────────────────────────────────────────────────────────────────────────────┘
⋯: Aggiorna le citazioni · Elimina le ricerche vecchie
Novità: riga in cima "Da 4 fonti seguite · Gestisci"
```

Ogni voce di "Nuova ricerca ▾" ha una frase sotto il nome (D-427): "Da una domanda: cerca in libreria e su OpenAlex, sintesi ✦ a richiesta"; "Estendi la bibliografia: cerca citanti e citati di questi documenti, una volta"; "Trova un ponte: un lavoro che collega due paper o due insiemi". "Aggiorna le citazioni" (nel `⋯`) ha "Controlla le novità delle fonti seguite".

Ogni ricerca è una riga apribile: si vede l'elenco solo di quella aperta. La scheda "Ricerche" è la prima solo se esiste almeno una ricerca; altrimenti la prima è "Da leggere dopo", come oggi.

**a. Estendi la bibliografia (D-392, indispensabile)**

- **Dove:**
  - Scopri, "Nuova ricerca ▾ › Estendi la bibliografia…" (scelta del progetto o della selezione);
  - barra di selezione, `⋯ › Estendi la bibliografia…` (**senza ✦**: il ritrovamento non usa Claude, D-413);
  - stato vuoto della scheda Documenti del progetto e Scopri con il progetto come ambito (non più nel `⋯` del progetto, D-412);
  - cartellino del cluster nella Mappa (`⋯`).
- **Candidati:**
  - da riferimenti, citazioni, co-citazione, accoppiamento e somiglianza (OpenAlex già consentito, ripieghi come oggi);
  - esclusi i documenti già in libreria;
  - motivo bibliometrico leggibile ("citato da 4 dei tuoi 12 paper, cita 3 dei tuoi");
  - mai scaricati da soli.
  - "Riesegui" sostituisce il digest periodico: all'apertura di Scopri, solo se l'utente lo ha acceso per quella ricerca, si mostrano i nuovi con il badge "nuovi" sulla riga.
- **Claude:** nessuno di base; "✦ Riassumi i migliori" usa le sintesi strutturate di b.

**b. Ricerca approfondita da una domanda (41, D-397)**

- **Dove:** "Nuova ricerca ▾ › Da una domanda…" e la tavolozza.
- **Comportamento:**
  - ritrovamento senza Claude (indice locale e OpenAlex);
  - **il risultato predefinito è l'elenco senza sintesi** (D-419), con pertinenza e motivo;
  - nel risultato, il pulsante "✦ Sintesi" con la scelta 10 / 20 / 50 e la stima scrive per i migliori N la sintesi strutturata su 5 righe (problema, metodo, risultati, dati, limiti), dal solo abstract pubblico, con "non dichiarato nell'abstract" quando manca;
  - pertinenza e motivo.
- **Claude:** Haiku, blocchi da 10 abstract (20 candidati = 2 richieste, circa 7 mila token in ingresso e 3 mila in uscita), cache per abstract (lo stesso candidato in un'altra ricerca non costa).

**c. Trova un ponte (nuova, unita alla 42, D-396)**

```
Ponte tra  A 2021 (metodo)  e  B 2019 (dominio)
1  Titolo del ponte · Autore F 2020          forza ●●●○
   Applica il metodo di A al dominio di B · cita entrambi · ✦ dal suo abstract
   (Leggi dopo) (Importa) (Mostra nella Mappa)
2  …
— oppure —
Nessun ponte convincente. I candidati più vicini condividono solo l'argomento generale.
Prova con due insiemi più ampi (progetti o tag) o (Mostra i candidati deboli).
```

- **Dove:**
  - nella barra di selezione, `⋯ › Trova un ponte` (**senza ✦**; attiva con 2 selezionati, altrimenti disattivata con "Seleziona 2 documenti", D-413);
  - nella Mappa, `⋯` del cartellino del nodo › "Trova un ponte con…", poi clic sul secondo nodo (il cursore lo indica, Esc annulla);
  - per due insiemi (progetti, tag, selezioni), "Nuova ricerca ▾ › Trova un ponte…".
- **Candidati:** lavori che citano entrambi, citati da entrambi, co-citati, con riferimenti in comune, sul percorso più breve nel grafo delle citazioni, vicini nel contenuto a entrambi.
- **Classifica:**
  - punteggio combinato;
  - il risultato predefinito è bibliometrico, con il motivo leggibile ("cita entrambi", "co-citato con entrambi");
  - **secondo passo ✦** nel risultato: "✦ Classifica i legami · ≈ N token" (Haiku, un blocco dei primi 20) dà il tipo di legame dai soli titoli e abstract; sotto la soglia di Claude, l'esito è **"Nessun ponte convincente"**, con i candidati deboli nascosti dietro un link.
- **Stati propri** (D-420): uno dei due senza DOI o identificativo OpenAlex ("Manca l'identificativo di *Titolo* · Completa i dati"); fuori linea (nessuna ricerca possibile, detto); **nessun candidato bibliometrico** ("Nessun lavoro cita o è citato da entrambi", diverso da "Nessun ponte convincente", che è il giudizio di Claude).
- **Nella Mappa:** "Mostra nella Mappa" disegna il percorso A → ponte → B tratteggiato in `--accent`, con il ponte come nodo fantasma (fuori libreria, contorno tratteggiato) finché non si importa.

**Stati comuni:**

- in corso (chip Attività, annullabile);
- pronta;
- senza risultati (spiegazione);
- offline (ricerca locale soltanto, detto);
- limite di Claude (risultati senza sintesi, con "Aggiungi le sintesi più tardi").

**Dati:** `discover/runs/<id>.json` (parametri, candidati, punteggi, motivi, stato di ogni candidato); le sintesi ✦ in cache per abstract. "Elimina le ricerche vecchie" (`⋯`) toglie quelle oltre 90 giorni, con conferma.

**Peso:** R 10-14 (scheda Ricerche, righe con sintesi, percorso nella Mappa); M 14-20 (`features/discover`: candidati, punteggi, soglie, cache).

**Carico visivo:** Scopri ha lo stesso numero di controlli (primario sostituito, una scheda al posto di un'altra, Fonti seguite dalla riga di Novità); la Mappa non ha controlli nuovi.

#### 17.4.18 Contesto delle citazioni (11)

- **Dove:** scheda del documento › sezione "Citazioni" (già presente). Ogni lavoro che cita il documento ha sotto una riga con la frase in cui lo cita ("…come proposto da [Autore A 2021], …") e la pagina, quando il lavoro citante è in libreria (dal testo) o quando OpenAlex fornisce il contesto. Il filtro "Con il contesto" è un `Chip` dentro la sezione aperta.
- **Stati:** contesto disponibile · solo citazione (nessuna riga) · in calcolo (scheletro, per i documenti in libreria).
- **Claude:** nessuno.
- **Dati:** cache locale (`citeContext`), rigenerabile.
- **Peso:** R 1-2; M 2-3 (`features/citectx`, riusa `features/refs`).
- **Carico visivo:** contenuto dentro una sezione chiusa; nessun controllo fuori.

#### 17.4.19 Gruppi di ricerca su richiesta (12, D-393)

- **Dove:**
  - barra di selezione `✦ Claude ▾ › Panoramica dei gruppi di ricerca…`;
  - `⋯` della scheda del documento;
  - nella Mappa, modo Autori, `⋯` della scheda dell'entità.
- **Comportamento:**
  - una panoramica in Markdown (autori, istituzioni, coautori ricorrenti, temi, lavori principali, con link) dai dati già scaricati e da OpenAlex;
  - la panoramica comprende sempre la sintesi dei temi scritta da Claude (✦), per questo sta nel menu `✦ Claude ▾`; se Claude non è disponibile, la parte dei dati si salva lo stesso con "sintesi non scritta".
- **Stati:** dati incompleti (detto per autore) · pronta · aggiornata (data).
- **Claude:** Haiku, circa 3 mila token (sotto la soglia: stima nella voce).
- **Dati:** `notes/groups/<id>.md`.
- **Peso:** R 1-2; M parte di `features/synthesis`.
- **Carico visivo:** voci di menu.

#### 17.4.20 Linea del tempo su richiesta (19)

- **Dove:**
  - nel `⋯` della Mappa, "Disponi per anno" (nei modi Documenti e Collegamenti), che porta i nodi su un asse orizzontale degli anni con il volo animato;
  - con una selezione, nel `⋯` della barra di selezione, "Linea del tempo", che apre la Mappa con solo la selezione disposta per anno (la voce e la disposizione arrivano insieme in X8, D-426).
  - Si esce con lo stesso comando o con Esc.
- **Stati:** documenti senza anno (raccolti a destra in "Senza anno") · movimento ridotto (nessun volo).
- **Claude:** nessuno.
- **Dati:** nessuno.
- **Peso:** R 3-4 (nel chunk della Mappa).
- **Carico visivo:** nessun controllo nuovo; un'etichetta "Per anno · Esc per uscire" in alto a sinistra mentre è attiva.

#### 17.4.21 Evidenziazioni guida, esperimento (30, D-401, D-425)

```
 margine │ testo della pagina
    C ▏  │ Proponiamo uno stimatore regolarizzato che …        ← barra sottile nel margine, lettera del tipo
         │ …
    R ▏  │ Sotto le cinquanta osservazioni il modello …         ← al passaggio o al fuoco: velatura leggera
    R ▏  │ … è il più stabile.                                     sul passaggio e motivo nel tooltip
```

- **Dove:**
  - esiste solo con Impostazioni › Avanzate › "Funzioni sperimentali" acceso;
  - allora il `⋯` del lettore ha la casella **"☐ Guida ✦ (sperimentale) · G"**, che accende e spegne lo strato; il tasto **G** fa lo stesso; un chip "Guida ✦ ×" in cima al pannello Annotazioni, a strato acceso, è un secondo modo per spegnerla, non l'unico. Esc non spegne lo strato.
- **Comportamento:**
  - **la guida non tocca il testo:** una barra verticale sottile (2 px, `--ai`) nel margine della pagina, allineata alle righe del passaggio, con una lettera (C contributo, M metodo, R risultato, L limite); nessun riempimento, nessun contorno, nessuna sottolineatura sul testo;
  - al passaggio del mouse o al fuoco, una velatura leggera sul passaggio e il motivo in un tooltip; nome accessibile "Passaggio guida ✦: risultato";
  - elenco dei passaggi nel pannello Annotazioni, gruppo "Guida ✦", percorribile da tastiera;
  - **nessun invio automatico, nemmeno a strato acceso:** su un paper senza guida, il margine mostra una sola riga "Guida ✦ non ancora preparata · Prepara (≈ 14 000 token)"; la guida si mostra senza invio quando c'è la cache o la nota di letteratura del paper;
  - **"Tieni"** trasforma un passaggio in un'evidenziazione dell'utente nel colore attivo, con "origine: guida ✦" nella Cronologia; il passaggio scompare dalla guida.
- **Stati:** spenta · non preparata · in scrittura (annullabile in Attività) · attiva · nessun passaggio sicuro · fuori linea · cartella non abilitata · scansione senza testo.
- **Claude:** Haiku, circa 12-15 mila token in ingresso, cache per hash del testo, dialogo del costo (sopra la soglia di D-416); 0 invii con la nota di letteratura.
- **Dati:** `guides/<docId>.json` (marcato AI).
- **Peso:** R 2-3; M 2-3 (`features/guides`).
- **Carico visivo:** zero a funzione spenta (nessun nodo nel DOM); a strato acceso solo segni nel margine e un chip.
- **Prima nell'ordine di rinuncia** (D-426).

**Protocollo dell'esperimento (Y1, §14.1; dalla critica del giro 4, AUDIT D.6).**

- **Preparazione:**
  - libreria sintetica con 10 paper open access (4 empirici, 2 rassegne, 2 teorici, 1 breve di 4 pagine, 1 scansione con livello di testo), cartella abilitata per l'invio del testo; **mai la cartella reale**;
  - riferimento cieco: prima di accendere la guida, per ogni paper si segnano a mano i passaggi di contributo, metodo, risultato chiave e limite (`e2e/fixtures/guides-reference.json`);
  - risposte di Claude registrate una volta (Haiku, con il consenso dell'utente) e rigiocate come fixture; il costo misurato è quello della registrazione.
- **Schermate** (1024×700, 1280×800, 1920×1080; chiaro e scuro; italiano e inglese): funzione spenta; sperimentali accese con guida spenta; non preparata; in scrittura; attiva a riposo; passaggio al fuoco; dopo "Tieni"; nessun passaggio sicuro; guida ed evidenziazioni dell'utente sulla stessa pagina; lettore in modo strumento con la guida attiva.
- **Misure e soglie** (le righe 1-4 e 7 sono **vincolanti**: una sola non superata e la funzione si toglie):

| # | Misura | Passa se |
| --- | --- | --- |
| 1 | Traccia a funzione spenta | 0 nodi dello strato nel DOM; barra del lettore di 13 controlli; differenza di pixel dell'area della pagina = 0 rispetto alla schermata senza la funzione |
| 2 | Affollamento | nessun controllo nuovo nella barra; `⋯` del lettore ≤ 7 voci; un solo chip, solo a strato attivo |
| 3 | Inchiostro | a riposo nessun segno sopra il testo (solo margine); segni ≤ 12 per paper; area dei segni ≤ 2 % della pagina |
| 4 | Confusione con i segni dell'utente | 0 sovrapposizioni tra i segni della guida e le evidenziazioni dell'utente; in scala di grigi i due tipi si distinguono; nome accessibile "Passaggio guida ✦: risultato" |
| 5 | Precisione | ≥ 60 % dei passaggi proposti coincide (≥ 50 % del testo in comune) con un passaggio del riferimento; il risultato chiave trovato in ≥ 7 paper su 10; 0 passaggi da bibliografia, intestazioni o didascalie |
| 6 | Utilità | in ≥ 6 paper su 10 almeno un passaggio è usato (Tieni o salto dall'elenco); poi l'utente prova la guida su 3 paper suoi e risponde sì/no a "la terresti accesa?": il suo no toglie la funzione |
| 7 | Costo | nessun invio senza conferma o fuori soglia; token per paper ≤ stima dell'anteprima + 15 %; riapertura = 0 invii; paper con nota di letteratura = 0 invii; tetto del giorno rispettato |
| 8 | Prestazioni | disegno dello strato ≤ 16 ms per pagina; fps di scorrimento entro il 5 % della guida spenta; nessuno spostamento del testo |
| 9 | Comandi | accendere e spegnere dallo stesso posto in ≤ 2 azioni, e con G; Esc non spegne lo strato; l'elenco dei passaggi si percorre da tastiera |
| 10 | Stati | presenti e con testo: spenta, non preparata, in scrittura (annullabile in Attività), attiva, nessun passaggio sicuro, fuori linea, cartella non abilitata, scansione senza testo |

- **Esito:** rapporto in `docs/design/` con i numeri per riga e i nomi delle schermate (le schermate restano in `audit-shots/`, non committate). Tutte le righe superate: la guida resta **sperimentale** e D-401 si aggiorna. Una riga vincolante non superata, oppure il no dell'utente alla riga 6: la voce sparisce, il codice resta spento e D-401 registra il motivo. Righe 5, 8, 9 o 10 non superate: una correzione e una sola seconda prova, poi la stessa regola.

### 17.5 Dove vive ogni funzione (riepilogo, dopo la critica del giro 4)

| N. | Funzione | Ingresso principale | Altri ingressi | Claude |
| --- | --- | --- | --- | --- |
| 2 | Note di letteratura | Scheda › Note | lettore › Note › Letteratura; selezione `✦ Claude ▾` (al massimo 5 per invio) | sì, su richiesta |
| 3 | Lettura affiancata | `⋯` del lettore | selezione › `⋯` (disattivata se non sono 2) | no |
| 7 (+52) | Zotero e BibTeX | + Aggiungi ▾ | `⋯` del progetto (Collega un file .bib…, Esporta…) | no |
| 13 | RIS, CSL JSON, schema delle chiavi | **da confermare**, onda 12 | — | no |
| 11 | Contesto delle citazioni | Scheda › Citazioni | — | no |
| 12 | Gruppi di ricerca | selezione `✦ Claude ▾` | `⋯` della scheda; Mappa › Autori | sì (sintesi dei temi) |
| 16 | Tabella di confronto | selezione `✦ Claude ▾` | `⋯` del progetto | sì (celle mancanti) |
| 19 | Linea del tempo | `⋯` della Mappa | selezione › `⋯` | no |
| 23 | DOI, arXiv, URL | + Aggiungi ▾ | DOI incollato nella ricerca | no |
| 25 | Riprendi | prima riga del menu del campo di ricerca | tavolozza; banner solo dopo una chiusura non pulita | no |
| — | Estendi la bibliografia | Scopri › Nuova ricerca | selezione › `⋯` (senza ✦); cluster della Mappa; stato vuoto del progetto con il progetto come ambito | facoltativo (sintesi nel risultato) |
| 27 | Ritaglio | strumento del lettore (R) | — | no |
| 29 | Schede delle citazioni | clic sul riferimento nel testo | Ctrl + passaggio; Alt+C | no |
| 30 | Evidenziazioni guida (esperimento) | casella nel `⋯` del lettore e tasto G (con Funzioni sperimentali) | chip nel pannello per spegnere | sì, solo con "Prepara" |
| 31 | Spiega | popover della selezione (Seleziona) | popover del ritaglio | sì |
| 35 | Modelli di nota | Impostazioni › Libreria | menu di "Nuova nota" | no |
| 36 | Significato dei colori | Impostazioni › Libreria | tooltip del pallino e dei colori | no |
| 37 | LaTeX nelle note | editor delle note | — | no |
| 38 | Link e collegamenti in entrata | `[[` nell'editor | Scheda › Note | no |
| 40 | Domande, affermazioni e prove | Progetto › Schema | popover dell'evidenziazione › Usa come prova (primo livello) | facoltativo |
| 41 | Ricerca approfondita | Scopri › Nuova ricerca | tavolozza | facoltativo (sintesi 10 / 20 / 50 nel risultato) |
| 42 + nuova | Trova un ponte | selezione › `⋯` (disattivata se non sono 2) | cartellino della Mappa; Scopri › Nuova ricerca | facoltativo (classificazione nel risultato) |
| 48 | Risorse | + Aggiungi ▾ | Scheda › File e risorse; Libreria (Tipo) | no |
| 49 | Manoscritto ↔ fonti | **da confermare**, onda 12 (Progetto › Schema › Manoscritto) | — | facoltativo |
| 51 | Suggerimenti di citazione | `⋯` di una nota del progetto | `⋯` del progetto | sì, con il consenso a parte |
| 54 | Resoconto | `⋯` del progetto | — | sì |

### 17.6 Testi nuovi (it / en, estratto)

| Italiano | English |
| --- | --- |
| + Aggiungi ▾ · Da DOI, arXiv o URL… · Da Zotero o BibTeX… · Risorsa o link… | + Add ▾ · From DOI, arXiv or URL… · From Zotero or BibTeX… · Resource or link… |
| Riprendi: *Titolo* · p. 12 | Resume: *Title* · p. 12 |
| Scrivi la nota di letteratura ✦ | Write the literature note ✦ |
| Collegamenti in entrata | Backlinks |
| Ritaglia (R) | Crop (R) |
| ✦ Spiega | ✦ Explain |
| Affianca un altro paper… | Read side by side… |
| Nuova ricerca ▾ · Da una domanda… · Estendi la bibliografia… · Trova un ponte… | New search ▾ · From a question… · Extend the bibliography… · Find a bridge… |
| Nessun ponte convincente. | No convincing bridge found. |
| Schema · Ricerca · Manoscritto · Solo prove | Outline · Research · Manuscript · Evidence only |
| Serve lo schema della ricerca del progetto. Scrivilo ora | This needs the project's research outline. Write it now |
| Disponi per anno | Arrange by year |
| Funzioni sperimentali | Experimental features |
| Già pronto, 0 invii | Ready · nothing sent |
| Usa come prova… | Use as evidence… |
| Guida ✦ non ancora preparata · Prepara (≈ 14 000 token) | Guide ✦ not prepared yet · Prepare (≈ 14,000 tokens) |
| Il file .bib è stato modificato fuori dall'app | The .bib file was changed outside the app |
| Invia i miei paragrafi a Claude | Send my paragraphs to Claude |
| Seleziona 2 documenti | Select 2 documents |

### 17.7 Chiusura della critica del giro 4 (D-410 … D-428)

Critica: `docs/design/AUDIT.md`, "Critica delle funzioni aggiunte (giro 4)" (1 bloccante, 22 importanti, 11 minori, protocollo dell'esperimento 30). L'utente vuole una linea dura contro l'affollamento: le correzioni sull'affollamento sono accettate tutte. Una sola minore è accolta in parte (D.3.12, motivo sotto).

| Punto | Gravità | Esito | Dove |
| --- | --- | --- | --- |
| D.1.1 barra del lettore (P0 22, non 24) | bloccante | **accolto**: 13 controlli; P0 aggiornato | D-410, §4.3, §17.3, prototipo |
| D.1.2 schede del progetto | importante | accolto: una scheda Schema con le prove, al massimo 4 schede | D-411, §17.4.13, §17.4.15 |
| D.1.3 menu come cassetti | importante | accolto: ≤ 7 voci, ≤ 3 gruppi, voci mai nascoste, azioni una tantum negli stati vuoti, stato fuori dai menu; `crowding.spec.ts` conta le voci contro il P0. Precisazione: la voce dell'esperimento 30 esiste solo con Funzioni sperimentali acceso (scelta dell'utente, non contesto) | D-412, §17.1, §17.3 |
| D.1.4 ✦ su Estendi | importante | accolto: Estendi e Trova un ponte nel `⋯` senza ✦; ✦ solo per ciò che invia sempre | D-413, §17.4.17 |
| D.1.5 `⋯` del progetto | importante | accolto: 7 voci in 3 gruppi; "Esporta…" unico (secondo cervello e bibliografia) per stare nel tetto | D-412, §17.3 |
| D.1.6 banner Riprendi | importante | accolto: nessun banner all'avvio normale; solo dopo una chiusura non pulita | D-414, §17.4.5 |
| D.1.7 citazioni e popover | importante | accolto: schede al clic, nessun segno a riposo; popover Copia · Evidenzia · ✦ Spiega solo in Seleziona | D-415, §17.4.12, §17.4.9 |
| D.1.8 Fonti seguite | minore | accolto: riga "Da 4 fonti seguite · Gestisci" in Novità; frase sotto ogni voce di Nuova ricerca | D-427, §17.4.17 |
| D.1.9 scopribilità | minore | accolto: pagina "Novità" della Guida, aperta una volta dalla nota di versione; nessun badge, nessun giro guidato | D-427, Y2 |
| D.2.1 segni sul testo | importante | accolto: segni solo nel margine | D-425, §17.4.21 |
| D.2.2 accensione e spegnimento | importante | accolto: casella nel `⋯` e tasto G; chip come secondo ingresso | D-425 |
| D.2.3 invio della guida | importante | accolto: mai automatico, "Prepara (≈ 14 000 token)" | D-425 |
| D.2.4 "Tieni" | minore | accolto | §17.4.21 |
| D.2.5 criteri non misurabili | minore | accolto: protocollo D.6 adottato come specifica di Y1 | D-425, §17.4.21, §14.1 |
| D.3.1 costo e consenso | importante | accolto: regola unica (soglia 5 000 token, stima nel pulsante, quota del giorno) | D-416, §17.2 |
| D.3.2 Spiega e cartella | importante | accolto | D-417, §17.4.9 |
| D.3.3 note di letteratura | importante | accolto: 5 per invio, "Bozza ✦ da approvare", ripiego da abstract | D-418, §17.4.6 |
| D.3.4 ricerca approfondita | importante | accolto: elenco senza sintesi come predefinito, sintesi 10 / 20 / 50 | D-419, §17.4.17 |
| D.3.5 Trova un ponte | importante | accolto: tre stati nuovi, voce sempre presente | D-420, §17.4.17 |
| D.3.6 `.bib` sovrascritto | importante | accolto: scrittura solo con l'hash dell'ultima scrittura, banner, riga di avviso nel file | D-421, §17.4.2 |
| D.3.7 funzioni da confermare in onda | importante | accolto: 49 e 13 nell'onda 12, dopo la risposta dell'utente | D-422, §14.1 |
| D.3.8 suggerimenti di citazione | importante | accolto: consenso a parte, testo esatto, un paragrafo o una sezione | D-423, §17.4.16 |
| D.3.9 affermazioni e prove | importante | accolto: "Usa come prova" al primo livello al posto del cambio di tipo; stato vuoto che lo insegna | D-424, §17.4.15 |
| D.3.10 tabella di confronto | minore | accolto | D-427, §17.4.7 |
| D.3.11 affiancata a 1024 | minore | accolto (Ctrl+Tab, motivo nel toast) | D-427, §17.4.11 |
| D.3.12 ritaglio negli appunti | minore | **accolto in parte**: una sola destinazione predefinita (le note della pagina) con "Copia" nel toast; **non** negli appunti a ogni ritaglio | D-428, §17.4.8 |
| D.3.13 risorse e URL | minore | accolto | D-427, §17.4.4 |
| D.3.14 link e LaTeX | minore | accolto | D-427, §17.4.6 |
| D.3.15 testi | minore | accolto | D-427, §17.4.17, §17.6 |
| D.4.1 chunk di X3 | importante | accolto: tre chunk, tetto per chunk in `check:budget` | D-426 |
| D.4.2 margini | importante | accolto: `check:budget` in ogni compito, ordine di rinuncia 30, 51, 54, 16; in più tetti a stima alta + 1 % | D-426, §13 |
| D.4.3 voce morta | importante | accolto: "Linea del tempo" la accende X8; le voci della selezione scritte prima, disattivate con il motivo | D-426, §14.1 |
| D.4.4 X1 troppo grande | importante | accolto: infrastruttura, `check:budget` e `crowding.spec.ts` all'agente principale | D-426, §14.1 |
| D.4.5 Y1 e quota Claude | minore | accolto: libreria sintetica, risposte registrate e rigiocate | D-425, §17.4.21 |

**Perché D.3.12 è accolto solo in parte.** Scrivere negli appunti a ogni ritaglio sostituisce senza chiedere quello che l'utente aveva copiato, ed è un effetto invisibile che la regola "nessuna sorpresa" (§1 principio 7) esclude. La parte giusta della critica, una sola destinazione predefinita detta con un toast, è accolta.
