# Architettura dell'interfaccia e sistema visivo (riprogettazione)

Stato: **rivisto (giro 2)**, 2026-11-17, ramo `design-arch`. Primo giro scritto dal codice, dai documenti e dalle richieste dell'utente (D-310 … D-324); secondo giro rivisto con l'audit del designer avversario (`docs/design/AUDIT.md` sul ramo `design-audit`, parziale, 138 schermate misurate) e con nuove verifiche nel codice (D-325 … D-344). Le quattro domande del primo giro hanno ora una risposta **provvisoria, da confermare con l'utente** (§15): nessuna blocca il lavoro.

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
| A8 | Evidenziazioni non nel PDF e l'app non lo dice; "Sottolineato" ambiguo (alto) | le annotazioni si scrivono nel PDF (D-316), chip "PDF:" con lo stato, banner del primo uso; la casella diventa "Annotato" nella scheda Info | §8.3, §4.3, §11.1 |
| A9 | Lettore: 200 px di barre su 800, a 1024×700 l'area del PDF è 405×389 (alto) | una sola barra da 44 px, stato di studio in un menu, tasti nel pulsante [?], pannello a 3 schede; a 1024×700 area utile ≥ 600×600 (criterio) | §4.3 |
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
| X1 | Non ancora coperto dall'audit: inglese, scheda del documento, export, MCP acceso, backup valido, scorciatoie, PDF protetto/danneggiato, dialoghi dopo il lettore | verifiche dell'onda 6 (V1) con lo stesso script dell'audit | §14 |

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
│     ├── barra: filtri, Elenco|Griglia, ordina, + Aggiungi PDF (ricerca e "Cerca con Claude" nella barra in alto)
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
│     └── progetto: membri, piano di lettura, note, esporta
│
├── 4 Scopri (Alt+4)
│     ├── Da leggere dopo | Novità | Pubblicati | Fonti seguite
│
├── 5 Mappa (Alt+5)                 ex "Rete"
│     ├── Mappa | Rete | Esplora | Vicini inattesi
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
  | { view: 'map'; tab: 'map' | 'network' | 'explore' | 'surprising' }
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
|  ✦ Scopri         4  |                                                                    |                           |
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
| Libreria  214 documenti                                          [≡ Elenco|▦ Griglia]  [Ordina: Titolo ▾]  [[+ Aggiungi PDF]] [◫] |  56
| [Stato ▾] [Tipo ▾] [Anno ▾] [Rivista ▾] [Tag ▾]   (× Da leggere) (× Ottica)   (Pulisci)        □ Mostra mancanti |  40
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

### 4.3 Lettore

```
+--------------------------------------------------------------------------------------------------------------+
| [×]  Libreria › Titolo del paper…   │ ‹ [ 12 ] / 38 › │ [−] 110% [+] [⇔] │ [⌕] │ PDF: ✓ Nel PDF ▾ │ [Studio: In lettura ▾] [◫] [⋯] |  44
+----------------------------------------------------------------------------------+---------------------------+
|                 ┌──────────────────────────────────────────────────┐              | Annotazioni · Note · Info |  40
|                 │ [↖] [▌●] [U●] [⌫] │ ● ● ● ● ● │ [?]               │  ← barra    | ------------------------- |
|                 └──────────────────────────────────────────────────┘    strumenti | Pagina 3                  |
|        ┌───────────────────────────────────────────────────┐                      |  ▌ «testo evidenziato…» ⋯ |
|        │  Testo della pagina con ▌evidenziazione▐          │  ← --page-shadow     |  _ «testo sottolineato» ⋯ |
|        │  e una frase sottolineata_______                 │                      | Pagina 7                  |
|        │            ┌──────────────────────────────────┐   │                      |  ▌ «…» · 💬 commento      |
|        │            │ ● ● ● ● ● │ ▌ _ │ 💬 │ 🗑         │   │ ← popover accanto    | ------------------------- |
|        │            └──────────────────────────────────┘   │                      | Dal PDF (altri programmi) |
|        └───────────────────────────────────────────────────┘                      |  ◇ Nota · p. 2 · Autore   |
+----------------------------------------------------------------------------------+---------------------------+
```

**Barra del lettore** (44 px, `--surface`, bordo basso `--border`; L1, A9): gruppi separati da divisori verticali 1×20 `--border`; ogni gruppo ha larghezza fissa, nulla va a capo.

| Gruppo | Contenuto e misure | Sotto 1100 px di area |
| --- | --- | --- |
| Uscita e titolo | `[×]` IconButton (`reader-close`, tooltip "Chiudi · Alt+← · Ctrl+W"); briciole con il titolo troncato a `min(40ch, 30%)` e tooltip completo (`reader-title`) | solo × e titolo |
| Pagine | `‹` · campo 48 px (`reader-page-input`, cifre tabellari, centrato) · `/ 38` (`reader-pages`) · `›` | uguale |
| Zoom | `[−] 110% [+] [⇔ Adatta]` (`reader-zoom*`, `reader-fit`), percentuale 44 px cifre tabellari | `[⇔]` solo icona |
| Ricerca | `[⌕]` apre la barra di ricerca sotto (`reader-find*`) | uguale |
| PDF | chip `PDF: ✓ Nel PDF ▾` (`reader-pdf-chip`, §8.3) | solo icona di stato |
| Studio | menu `Studio: In lettura ▾` (`reader-study-menu`; voci Da leggere / In lettura / Letto = `reader-study-*`) | icona libro + stato |
| Pannello e altro | `[◫]` pannello (`reader-side`), `[⋯]` (Apri con il programma predefinito, Mostra nella cartella, Scorciatoie del lettore, Esporta copia annotata…) | uguale |

**Barra strumenti** (`reader-toolbar`, `role="toolbar"`): flottante, centrata in alto sull'area delle pagine a 12 px dal bordo, altezza 40, `--surface` al 94% con `backdrop-filter: blur(6px)`, `--r-md`, `--e-2`; pulsanti 32×32. Strumento attivo: fondo `--accent-soft`, icona `--accent-text`, `aria-pressed="true"`; sui pennelli un pallino 8 px col colore corrente in basso a destra dell'icona. Colori: 5 pallini 20 px con anello 2 px `--text` sul corrente (`ann-color-*`, `aria-checked`). [?] apre il foglio "Tasti del lettore". Se l'area delle pagine è più stretta di 560 px la barra diventa verticale sul bordo sinistro (40 px di larghezza). Non copre mai il testo selezionato: durante un trascinamento sotto la barra la barra si dissolve al 30% (`--dur-fast`).

**Area delle pagine:** fondo `--surface-3`; ogni pagina ha `box-shadow: var(--page-shadow)` e contorno 1 px `--page-edge` (L8); 16 px tra le pagine; nessuno scorrimento orizzontale con "Adatta".

**Barra di ricerca** (L5): sotto la barra del lettore, 40 px: campo 240 px · "3 di 17" · `‹ ›` · `Aa` (maiuscole) · `⋯` (Evidenzia il risultato · Ctrl+Maiusc+H, Sottolinea il risultato · Ctrl+Maiusc+U) · ×. Testid di oggi tenuti.

**Pannello destro** 340 px (280-480), `Tabs`: **Annotazioni** (elenco per pagina; ogni voce: segno del tipo e colore, citazione su 2 righe, commento, ⋯ con Colore/Tipo/Commento/Elimina; in fondo il gruppo "Dal PDF (altri programmi)" in sola lettura), **Note** (un editor con un `Segmented` "Pagina · File · Tutte"; testid `reader-tab-*` tenuti come valori del selettore), **Info** (stato di studio, "Annotato" = vecchio "Sottolineato" con la sua origine, scrittura nel PDF con le stesse azioni del chip, citazioni del documento). Tre schede stanno su una riga a 280 px (L6).

**Popover dell'annotazione** (L4): ancorato al primo rettangolo dell'annotazione (sopra; sotto se manca spazio), 8 px di distanza, `--e-2`, `--r-md`, altezza 40: 5 colori · tipo (▌/_) · 💬 commento · 🗑. Con 💬 si allarga a un campo di 3 righe (320 px). Tab entra nel popover, Esc lo chiude e torna all'annotazione.

**Area utile misurata** (criterio di F4): a 1024×700 con il pannello chiuso l'area delle pagine è almeno 960×600; a 1280×800 con il pannello aperto almeno 860×700.

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

Dialogo 640 × fino a 640 px, `--r-lg`, `--e-3`; intestazione "Passo 3 di 7 · Dettagli" (`wizard-step-title`), corpo, piede fisso con (Annulla) a sinistra (pulsante terziario, non link: W4) e [Indietro] [[Avanti]] a destra. Passi: Benvenuto e lingua › Cartella (riquadro del percorso abbreviato al centro, 12 px di spazio, [Scegli un'altra cartella…] sotto; "Opzioni avanzate" chiuse con la cartella dati) › Dettagli (nome della libreria, lingua dei documenti, il tuo nome facoltativo) › Tag di partenza ((Salta)) › Claude (cartelle; frase "Finché non abiliti una cartella non viene inviato nulla", nessuna casella obbligatoria) › Riepilogo › Prima scansione. Clic minimi fino alla libreria: 7.

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
- **Mappa:** "Costruisci il modello" primario; seme nel menu ⋯ "Opzioni del modello"; nodi ≥ 8 px (raggio per numero di documenti), etichette `--fs-small` fuori dai nodi con contrasto ≥ 4,5:1; "Esporta" pulsante; scheda Rete con i controlli in un pannello a sinistra comprimibile (240 px); Esplora vuoto con un'azione; "Colora per" con etichetta su una riga.
- **Tassonomia** (sottovista "Libreria › Tag"): albero a sinistra, editor del nodo a destra a sezioni (Nome e colore aperta; Nomi alternativi, Relazioni, Unisci e ritira chiuse), colori come 12 pallini 20 px in una griglia 6×2.

---

## 5. Sistema visivo

**Carattere dell'insieme:** "carta e inchiostro". Fondi neutri caldi e chiari (la carta), testo quasi nero, un solo blu inchiostro per l'azione, il viola solo per Claude, colori di stato sobri. Densità da strumento di lavoro (righe 28-56 px), molto spazio bianco tra i gruppi, nessun bordo dove basta lo spazio, ombre solo per ciò che galleggia. Tutto è un token in `styles/tokens.css`: chi implementa non sceglie colori, misure o durate.

### 5.1 Carattere tipografico

Nessun font remoto (CSP). Pila: `"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif`; titoli con `"Segoe UI Variable Display"` in testa; monospazio `"Cascadia Mono", Consolas, ui-monospace, monospace` (solo percorsi in Avanzate, id, codice). Cifre tabellari (`font-variant-numeric: tabular-nums`) in conteggi, pagine, percentuali e prezzi. `-webkit-font-smoothing` non si tocca (Windows usa ClearType).

| Token | Dimensione / interlinea | Peso | Spaziatura | Uso |
| --- | --- | --- | --- | --- |
| `--fs-display` | 24 / 32 px | 600 | -0,01em | titolo della procedura guidata, stati vuoti grandi |
| `--fs-title` | 20 / 28 px | 600 | -0,005em | titolo di vista (uno per vista) |
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
| `--text-subtle` | `#5E626A` | `#9599A3` | aiuti, segnaposto, separatori delle briciole |
| `--accent` | `#2B50C8` | `#8CA4FF` | pulsante primario, barra della voce attiva, anelli di selezione |
| `--on-accent` | `#FFFFFF` | `#0E1330` | testo e icone su `--accent` |
| `--accent-text` | `#2446B5` | `#9DB1FF` | link, testo accentato, icona dello strumento attivo |
| `--accent-soft` | `#E8EDFC` | `#212A48` | riga attiva, voce attiva, filtro attivo |
| `--focus` | `#2B50C8` | `#9DB1FF` | anello di fuoco 2 px a 2 px di distanza |
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
| `--text-subtle` | 4,8:1 | 4,9:1 | 4,5 |
| `--accent-text` | 6,2:1 | 6,8:1 | 4,5 |
| `--danger` / `--warning` / `--success` / `--info` / `--ai` | 5,1 / 4,9 / 4,9 / 5,0 / 5,3 | 6,2 / 7,8 / 7,6 / 6,5 / 6,9 | 4,5 |
| stato sul proprio `-soft` (danger, warning, success, info, ai) | 5,7 / 5,7 / 5,5 / 5,6 / 5,9 | 6,7 / 8,0 / 7,7 / 7,0 / 7,4 | 4,5 |
| `--on-accent` su `--accent` | 6,8:1 | 7,7:1 | 4,5 |
| `--accent` su `--bg` (non testo) | 6,2:1 | 7,8:1 | 3 |
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
- **Altezze dei controlli:** `--h-sm: 28px` (chip, righe dense, pulsanti delle righe), `--h-md: 32px` (pulsanti, campi), `--h-lg: 40px` (primario della procedura guidata, selettore di libreria). Barra in alto 48, barra del lettore 44, barra strumenti 40, voci della barra laterale 36.
- **Raggi:** `--r-xs: 4px` (badge, `Kbd`), `--r-sm: 6px` (pulsanti, campi, chip quadrati), `--r-md: 10px` (schede, popover, barra strumenti, miniature), `--r-lg: 14px` (dialoghi, cassetti), `--r-pill: 999px` (chip filtro, badge numerici, barre di avanzamento).
- **Elevazione** (chiaro / scuro):
  - `--e-0`: nessuna; si separa con `--border` o con lo spazio.
  - `--e-1`: `0 1px 2px rgb(20 22 28 / .06), 0 1px 1px rgb(20 22 28 / .04)` / `0 1px 2px rgb(0 0 0 / .5)` — schede (`Card`), riga attiva trascinata.
  - `--e-2`: `0 4px 16px rgb(20 22 28 / .12), 0 1px 3px rgb(20 22 28 / .08)` / `0 6px 20px rgb(0 0 0 / .55)` — popover, menu, toast, barra strumenti del lettore.
  - `--e-3`: `0 12px 40px rgb(20 22 28 / .20)` / `0 16px 48px rgb(0 0 0 / .65)` — dialoghi, tavolozza, cassetti sovrapposti.
  - In scuro i livelli si distinguono anche per il fondo: popover e dialoghi usano `--surface` con bordo 1 px `--border`.
- **Movimento:** `--dur-fast: 120ms` (hover, pressione, dissolvenze), `--dur: 180ms` (popover, toast, cambio di scheda), `--dur-slow: 240ms` (cassetti, dialoghi); `--ease: cubic-bezier(.2, 0, 0, 1)` (entrata), `--ease-exit: cubic-bezier(.4, 0, 1, 1)` (uscita). Solo `opacity` e `transform` (popover: da `translateY(-4px)` e opacità 0; cassetti: `translateX(16px)`; toast: dal basso 8 px). Niente animazioni di larghezza o altezza. Con `prefers-reduced-motion: reduce` tutte le durate a 0 (la regola esiste già).
- **Larghezze:** barra laterale 232 / 56; pannello di dettaglio 360 (300-480); pannello Claude 380 (320-560); pannello del lettore 340 (280-480); sottonavigazione delle impostazioni 220; contenuto delle impostazioni max 760; dialoghi 480 (conferma), 640 (moduli), 880 (export, ripristino); popover 280-420.

### 5.4 Icone

- Insieme proprio di **40 icone SVG in linea** in `components/icons-shell.tsx` (13, prima schermata) e `components/icons.tsx` (27, caricate con le viste): funzioni React senza dipendenze, `viewBox="0 0 24 24"`, tratto 1,75 px, `stroke="currentColor"`, `fill="none"`, `stroke-linecap/linejoin="round"`; dimensioni 16 (in riga e nei pulsanti `sm`), 20 (barre e barra laterale), 24 (stati vuoti). Disegni derivati da Lucide (licenza ISC: nota di licenza in testa ai due file; nessun pacchetto npm).
- Prima schermata (13): library, review (vassoio con freccia), project, discover (bussola), map, claude (scintilla ✦), help, settings, back, forward, search, command, activity (anello).
- Resto (27): folder, folder-open, tag, plus, close, chevron-down, chevron-right, more, check, alert, info, error, undo, redo, history, backup, export, read (libro aperto), cursor (seleziona), highlighter, underline, eraser, comment, page, pdf-written (pagina con spunta), lock, trash.
- Regole: ogni pulsante con sola icona ha `aria-label` e tooltip con il tasto (`Kbd`); icona e testo nello stesso colore; le icone di stato prendono il colore dello stato.

### 5.5 Componenti

In `components/ui.tsx` (campi, già esiste) e `components/*.tsx`; ognuno ha stati hover, premuto, fuoco (`:focus-visible`, anello `--focus`), disabilitato (opacità .45, `cursor: not-allowed`, nessun hover).

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
| **Badge numerico** sulla voce di navigazione | ci sono elementi che **aspettano una decisione dell'utente** | Da rivedere: file da confermare + documenti con proposte di Claude; Scopri: opere nuove non ancora viste | numero esatto fino a 99, poi "99+"; tooltip e `aria-label` con il dettaglio; mai per avanzamento o errori; sparisce quando il numero è 0 |
| **Chip Attività** (barra in alto) | lavoro in corso o appena finito | scansione 45%, 3 proposte in preparazione, backup in corso, scrittura PDF in attesa | un solo chip; puntino se c'è un risultato non visto; rosso se c'è un errore; clic apre il popover con tutte le attività e l'ultimo esito |
| **Toast** | conferma di un'azione appena fatta, con eventuale Annulla | "Tag aggiunto a 3 documenti · Annulla", "Copia creata in Capitolo 2" | 6 s, al massimo 3; gli errori di un'azione restano finché chiusi; mai per eventi non causati dall'utente |
| **Banner** nel flusso (sopra il contenuto) | condizione persistente che richiede attenzione o blocca | impostazioni ripristinate o in sola lettura, backup automatico fallito, ultimo backup > 30 giorni, libreria non raggiungibile, scrittura nel PDF impossibile (file bloccato da più di 10 minuti), primo uso della scrittura nel PDF | al massimo 2 visibili, ordinati per gravità; ognuno con una sola azione primaria e (se non bloccante) "Chiudi" che lo nasconde fino al prossimo cambiamento |
| **Dialogo** | conferma di un'azione distruttiva, di un invio, di un'operazione lunga | dimentica libreria, ripristina backup, ripristina il PDF originale, invio a Claude con anteprima | mai per informare |
| Notifiche di sistema | mai | — | l'app non le usa |

### 7.1 Il badge di "Da rivedere"

- **Significato:** "ci sono N cose che aspettano una tua decisione". N = file nuovi (da fuori + trovati dalla scansione) + documenti con proposte di Claude in attesa.
- **Tooltip e `aria-label`:** "Da rivedere: 3 file nuovi, 12 documenti con proposte di Claude" (`review.badge`, plurali i18next); se una delle due parti è 0 si omette.
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

---

## 8. Lettore

### 8.1 Il PDF appare stirato: causa e correzione

**Causa (dal codice):** collisione di nomi di classe CSS. Il foglio dell'app definisce `.page { max-width: 860px; padding: 24px 32px 32px; }` (`styles.css` riga 451) per il contenitore delle viste; pdf.js usa la stessa classe `page` per il `div` di ogni pagina dentro `.pdfViewer` (`pdf_viewer.css`: `.pdfViewer .page { width; height; position: relative; … }`, larghezza e altezza messe in linea da pdf.js con `round(var(--total-scale-factor) * Wpx, …)`). Effetti:

1. `max-width: 860px` vince sulla larghezza in linea quando la pagina dovrebbe essere più larga (pannello ampio con "Adatta alla larghezza", o zoom ≥ ~110%): il `div` resta largo 860 px ma alto quanto previsto; il `canvas` (assoluto, `width: 100%; height: 100%` della pagina) disegna la bitmap renderizzata per la larghezza vera dentro una scatola più stretta, quindi **le proporzioni cambiano** (l'immagine è deformata in un asse) e lo strato del testo, che usa `--total-scale-factor` e non la larghezza della scatola, **non coincide più** con il disegno: selezioni ed evidenziazioni risultano spostate o "più larghe" del testo. A seconda della finestra la deformazione si percepisce come stiramento.
2. Il `padding` con `box-sizing: border-box` riduce il riquadro del contenuto di 64 × 56 px: `canvasWrapper` (`width/height: 100%` del contenuto) diventa più piccolo del canvas, e lo sfondo bianco della pagina (`background-clip: content-box`) lascia bordi del colore del fondo.

**Verifica (prima della correzione, nel compito F4):** in DevTools, per una pagina, confrontare `canvas.width / canvas.height` con `getBoundingClientRect()` del canvas: con il difetto i due rapporti differiscono; con la correzione coincidono entro 0,5%. Controllare anche con `devicePixelRatio` 1, 1,25 e 1,5 (impostazione di scala di Windows), perché pdf.js usa `--scale-round-x/y` e `outputScale` per la nitidezza (non per le proporzioni: non è la causa, ma va escluso).

**Correzione:**
- rinominare la classe di contenitore delle viste da `.page` a `.view` (tutti i `className="page …"`: `App.tsx`, `settings/Settings.tsx`, `views/discover/DiscoverView.tsx`, `views/inbox/InboxView.tsx`, `views/library/DocViews.tsx`, `views/library/LibraryView.tsx`, `views/library/ResultList.tsx`, `views/projects/ProjectsView.tsx`, `views/review/ReviewView.tsx`, e i selettori in CSS: `.page.library-page`, `.page.projects-page`, `.main:has(.library-page)`); `.page-chip` non cambia;
- regola di guardia in `reader.css`: `.pdfViewer .page { max-width: none; padding: 0; }` (difesa se una classe globale ricompare);
- test unitario: nessun selettore CSS globale dell'app che inizi con `.page` (eccetto `.page-chip`), e un e2e che misura il rapporto di cui sopra (aggiunta a `study-ui.spec.ts`).

**Misure dell'audit (conferma):** a 1920×1080 con "Adatta" la scatola della pagina è 860×1815 invece di 1285×1815 (rapporto 0,474 contro 0,707), lo strato del testo resta largo 1285 px; sotto la soglia di 860 px resta un allargamento dello 0,8-1,3% dovuto a `--scale-round-x/y` che pdf.js calcola per un `devicePixelRatio` frazionario (1,198 nella macchina di misura) e applica separatamente a larghezza e altezza.

**Arrotondamento con DPR frazionario (seconda causa, piccola):** nel compito F4 si prova a fissare `--scale-round-x: 1px; --scale-round-y: 1px` su `.pdfViewer` (con la stessa specificità di pdf.js, dentro il layer dell'app): la scatola si arrotonda al pixel e il rapporto resta entro 0,2%; la tela può risultare sfocata di una frazione di pixel. Criterio: rapporto entro 0,5% a DPR 1, 1,198 (o 1,25) e 1,5, e nitidezza giudicata su uno screenshot ingrandito. Se la nitidezza peggiora, si tiene l'arrotondamento di pdf.js e si accetta la tolleranza di 1,5% solo per DPR frazionari (deciso dal compito, riportato in DECISIONS).

#### 8.1.1 Il CSS di pdf.js contamina l'app (audit, problema 2; D-326)

**Causa:** `views/reader/engine.ts` importa `pdfjs-dist/web/pdf_viewer.css` intero (6483 righe, il CSS del visualizzatore completo di Firefox, con barra laterale, dialoghi, editor). Il CSS entra nel chunk del lettore, ma una volta caricato resta nel documento: le sue regole di primo livello valgono per tutta l'app. Classi in comune misurate (estrazione dei selettori `.nome` dai due insiemi di CSS): `.dialog`, `.dragging`, `.page`, `.radio`, `.selected`, `.sidebar`, `.swatch` (più `.textLayer`, voluta). Effetti visti dall'audit: barra laterale con ombra e bordi arrotondati in tutte le viste dopo la prima apertura di un PDF, dialoghi da verificare.

**Correzione (tre difese):**
1. **Rinomina** delle classi dell'app in collisione: `.page` → `.view` (§8.1), `.sidebar` → `.app-sidebar`, `.dialog` → `.rl-dialog` (con `.rl-dialog-head`, `-body`, ecc. solo se il nome intero coincide), `.dragging` → `.is-dragging`, `.selected` → `.is-selected`, `.radio` → `.rl-radio`, `.swatch` → `.rl-swatch`. Rinomina meccanica, file per file, nel compito A1.
2. **Livello:** il CSS di pdf.js si importa da `views/reader/reader.css` con `@import 'pdfjs-dist/web/pdf_viewer.css' layer(pdfjs);` e i CSS dell'app restano senza livello, quindi in caso di conflitto sulla stessa proprietà vince sempre l'app. (Il livello da solo non basta: le proprietà che l'app non imposta, come l'ombra, passerebbero; per questo la rinomina è la difesa principale.)
3. **Test di collisione** (`styles/pdfjs-collision.test.ts`): estrae i nomi di classe dai selettori di `pdf_viewer.css` (installato) e dai CSS e `className` dell'app; fallisce se l'intersezione non è `{ textLayer }` (più un elenco esplicito di eccezioni commentate). Così un aggiornamento di pdf.js o una classe nuova dell'app non reintroducono il difetto.

Verifica e2e (in `study-ui.spec.ts`): stile calcolato di `.app-sidebar` (`box-shadow`, `border-radius`, `width`) uguale prima e dopo aver aperto e chiuso un PDF; un dialogo aperto dopo il lettore ha la stessa larghezza di prima.

Facoltativo (onda 5, se il budget del lettore serve): sostituire l'import intero con un sottoinsieme generato (`tools/vendor-pdfjs-css.mjs`: solo `.pdfViewer`, `.page`, `.canvasWrapper`, `.textLayer`, `.annotationLayer` e le variabili usate), circa −150 KiB di CSS del lettore; con test che il file generato sia aggiornato rispetto alla versione installata.

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
- Nel lettore Spazio non scorre (si impedisce il default solo quando lo scambio avviene); Maiusc+Spazio non fa nulla. Nessuna "mano tenendo premuto Spazio": entrerebbe in conflitto con lo scambio; si scorre con rotella, touchpad, PagSu/PagGiù, frecce, J/K.
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

### 8.3 Scrittura delle annotazioni nel PDF originale (decisione dell'utente)

> Decisione dell'utente (2026-11-17, riportata dal coordinatore): «highlights and underlines must be WRITTEN INTO THE ORIGINAL PDF so they show in Chrome and other readers». Cambia la regola assoluta 1 solo per questo caso (D-316). **Area sensibile: richiede una revisione security dedicata** (oltre alla revisione indipendente) prima del merge di G4a e G4b, con potere di blocco; il prototipo dell'onda 0 la prepara.

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

1. **Lotto** (main, `main/study/pdf-sync.ts`): l'annotazione si salva subito nell'app (come oggi). Il lotto per documento parte 4 s dopo l'ultima modifica, alla chiusura del lettore, al cambio di documento o di libreria, alla chiusura dell'app (attesa massima 5 s, poi resta `pending`). Una coda per documento serializza i lotti (la stessa di `annotations:save`, D-188). Un lotto = una revisione incrementale.
2. **Controlli preliminari** (main): percorso con `resolveInRoot` + `realpath` dentro la radice; `stat` (dimensione, `mtimeMs`), scrivibilità (`fs.access W_OK`), dimensione ≤ `maxBytes`; `pdfMode` del documento e `writeToPdf` della libreria.
3. **Analisi e piano** (worker, `pdf-annot/plan.ts`): lettura ad accesso casuale (mai tutto il file in memoria): `startxref` dagli ultimi 1024 byte, catena delle sezioni xref (tabella classica, stream xref con `/W` `/Index` e predittore PNG, file ibridi con `/XRefStm`, `/Prev` con rilevamento di cicli), stream di oggetti (`/ObjStm`) per gli oggetti compressi; controlli di rifiuto (§8.3.5); albero delle pagine fino alla pagina toccata (con `/Count` e protezione dai cicli); `/Annots` della pagina. **Riconciliazione:** si leggono le annotazioni con `/NM (rl-…)` di quelle pagine e si confrontano con quelle dell'app (§8.3.7); il risultato è un piano di aggiunte, modifiche e rimozioni e i byte dell'aggiornamento:
   - oggetti nuovi numerati da `/Size`;
   - **`/Annots` sempre indiretto**: alla prima scrittura su una pagina, se `/Annots` è in linea o manca, si riscrive la pagina (stesso numero e generazione, dizionario ricopiato elemento per elemento con lo stesso serializzatore testato) con `/Annots N 0 R`; dalle volte successive si riscrive solo l'array `N`, mai più la pagina; gli altri riferimenti dell'array restano nello stesso ordine e i nostri si aggiungono in fondo;
   - modifica = nuova versione dello stesso oggetto (stesso numero, stessa generazione) e del suo aspetto;
   - rimozione = l'array `/Annots` senza quel riferimento; l'oggetto resta nel file senza riferimenti (nessuna voce libera nell'xref: meno casi, nessun rischio sulla catena dei liberi);
   - nuova sezione xref dello **stesso tipo** dell'ultima (tabella classica se l'ultima lo era, anche per i file ibridi; stream xref **non compresso** `/Type /XRef /W [1 4 2]` altrimenti), con `/Prev`, `/Root`, `/Info`, `/Size` aggiornato e `/ID` (primo elemento invariato, secondo nuovo); `startxref`, `%%EOF`, a capo prima dell'aggiornamento se il file non termina con `\n`.
4. **Copia di sicurezza alla prima scrittura del file** (main): SHA-256 completo dell'originale, che deve coincidere con `hash` del record (altrimenti `changed`: prima si lascia lavorare la scansione); copia atomica in `pdfBackupDir(...)/<docId>-<hash8>.pdf` (temporaneo, `fsync`, verifica dell'hash, rinomina), confinata con `resolveInRoot` della cartella dati; poi si scrive nel record `pdfWrite.base = { hash, size }` e `pdfWrite.backup` (**prima** di toccare l'originale: chi legge il record sa sempre come tornare indietro). Una sola copia per contenuto: se esiste già con lo stesso hash non si rifà.
5. **Temporaneo** (main): voce nel registro `<localData>/pdf-write/journal.json` (percorso del temporaneo, `docId`, ora; scrittura atomica); `copyFile(originale, temporaneo, COPYFILE_EXCL)` nella stessa cartella con nome nascosto `.<nome>.rl-<8 hex>.tmp` (su Windows CopyFileW copia anche i flussi alternativi, come il contrassegno di provenienza, e gli attributi; la data di creazione diventa quella della copia: accettato); apertura `r+`, scrittura dell'aggiornamento alla posizione = vecchia dimensione, `fsync`, chiusura.
6. **Verifica** (worker): (a) strutturale, sempre: dal nuovo `startxref` si risolvono la nuova sezione, ogni oggetto nostro e l'array `/Annots` di ogni pagina toccata, e ogni `/NM` atteso c'è una volta sola; (b) i primi `vecchia dimensione` byte del temporaneo hanno lo stesso hash dell'originale (si calcola nella stessa lettura sequenziale che produce lo SHA-256 del temporaneo, che serve al passo 8); (c) con pdf.js, per i file entro il limite di dimensione dell'estrazione del testo: apertura, stesso numero di pagine, `getAnnotations()` delle pagine toccate contiene i nostri `/NM` con il sottotipo giusto. Una verifica fallita = `refused: verify-failed`, temporaneo cancellato, nessuna scrittura (e un rapporto nella diagnostica, senza contenuto del PDF).
7. **Ricontrollo e rinomina** (main): l'originale deve avere ancora dimensione e `mtimeMs` del passo 2 e lo stesso SHA-256 dei primi e degli ultimi 64 KiB (TOCTOU, spirito di D-200); altrimenti `CONFLICT` (`changed`), temporaneo cancellato, il lotto riparte dopo la scansione. Poi `rename(temporaneo, originale)` (MoveFileExW con sostituzione) con nuovi tentativi su `EPERM`/`EBUSY`/`EACCES` a 200, 600, 1500 ms (come `atomicWriteJson`).
8. **Dopo la rinomina**: record del documento con `hash` = SHA-256 del nuovo file e la coppia aggiunta a `pdfWrite.own` (ultimi 20); annotazioni dell'app con `pdf: { objNum, gen, rev }` (`rev` = hash del contenuto semantico scritto, §8.3.7); voce tolta dal registro; eventi `library:changed` (`kind: 'annotations'`) e `annotations:pdfProgress`.

Dopo un arresto a metà: all'avvio e all'apertura di una libreria si leggono le voci del registro e si cancellano **solo** i temporanei elencati che esistono ancora, hanno il nome atteso e stanno nella radice della libreria (mai altri file). La rinomina è atomica: l'originale è o quello vecchio o quello nuovo. Se l'arresto è avvenuto tra la rinomina e l'aggiornamento del record, la scansione vede un file cresciuto con il prefisso uguale al vecchio `hash` e lo riconosce come aggiornamento incrementale (§8.3.6); la riconciliazione successiva ritrova le annotazioni dal loro `/NM`.

`fsync` della cartella non esiste su Windows: si accetta (il contenuto del temporaneo è già su disco; NTFS registra la rinomina nel suo giornale).

#### 8.3.4 File occupati, sincronizzazione, più computer

- **File aperto in un altro programma** (Acrobat e altri tengono il file senza condivisione di cancellazione): la rinomina fallisce anche dopo i tentativi → stato `pending`, motivo `locked`; nuovi tentativi alla chiusura del lettore, al ritorno del fuoco sulla finestra, alla modifica successiva e all'avvio, **mai** un ciclo di polling. Dopo 10 minuti di `pending`: riga "Da guardare" in Attività e banner nel lettore se il documento è aperto ("Il file è aperto in un altro programma. Chiudilo: le evidenziazioni si scriveranno da sole. [Riprova]").
- **Il lettore dell'app** non deve tenere il file aperto (da verificare nella prova S2: il protocollo `rl-doc://` legge a intervalli e chiude); se lo tenesse, la scrittura si farebbe alla chiusura del lettore.
- **Servizio di sincronizzazione al lavoro** (es. OneDrive che carica il file): stesso trattamento di `locked` (tentativi, poi `pending`). Un file non scaricato (solo nel cloud) si scarica alla lettura; se non è disponibile (rete assente) il lotto resta `pending` con motivo `unavailable`, non è un rifiuto.
- **Due computer**: ogni computer scrive solo ciò che manca rispetto allo stato dell'app (riconciliazione), quindi quando il PDF e il file delle annotazioni arrivano sincronizzati non si riscrive nulla. Se due computer scrivono lo stesso PDF prima di sincronizzarsi, il servizio crea una **copia in conflitto** (nome con il computer): la scansione la riconosce perché il suo prefisso è `pdfWrite.base` di un documento esistente (candidati: documenti con `pdfWrite` e nome di file contenuto nel nome nuovo; poi verifica dell'hash del prefisso) e la mette in Da rivedere come "Copia in conflitto di «Titolo»" con [Confronta] [Tieni come documento separato] [Ignora]; l'app non la cancella mai (regola 1). Il PDF "vincitore" riceve le annotazioni mancanti alla riconciliazione successiva.

#### 8.3.5 Rifiuti e messaggi

Un rifiuto non perde nulla: l'annotazione resta nell'app; il chip "PDF:" mostra "Solo nell'app" con l'icona ⓘ e il motivo; nessun nuovo tentativo finché il file non cambia.

| Motivo (`reason`) | Quando | Testo per l'utente (chip ⓘ, Info) |
| --- | --- | --- |
| `encrypted` | `/Encrypt` in un trailer della catena | "Questo PDF è protetto: le evidenziazioni restano in Research Lab." |
| `signed` | `/SigFlags` con bit 1, un campo `/FT /Sig` con `/V`, o `/Perms` | "Questo PDF è firmato digitalmente: scriverci renderebbe la firma non valida. Le evidenziazioni restano in Research Lab." |
| `xfa` | `/XFA` nell'`/AcroForm` | "Questo è un modulo XFA: non si può annotare in modo sicuro." |
| `damaged` | `startxref` assente o fuori dal file, oggetto non trovato all'offset, cicli, generazioni incoerenti, pagina o `/Annots` non risolvibili, dati non vuoti dopo l'ultimo `%%EOF` | "Il PDF ha una struttura danneggiata: per sicurezza non lo modifichiamo." |
| `read-only` | attributo di sola lettura o cartella non scrivibile | "Il file è in sola lettura." |
| `too-large` | oltre `maxBytes` (512 MiB) | "Il file è troppo grande per scriverci in sicurezza." |
| `too-many-revisions` | più di `maxRevisions` (200) revisioni nostre | "Molte modifiche accumulate: [Ripristina e riscrivi in una revisione]" (ripristino + un lotto unico, il prefisso resta intatto) |
| `verify-failed` | la verifica del passo 6 non passa | "Non siamo riusciti a scrivere in modo verificabile: le evidenziazioni restano in Research Lab." |
| `pending: locked` / `pending: unavailable` | §8.3.4 | "In attesa: il file è aperto in un altro programma" / "In attesa: il file non è disponibile" |

Il prototipo dell'onda 0 misura, in sola lettura, la percentuale di rifiuti per motivo sulla libreria di prova dell'utente (`RL_FIXTURE_LIBRARY`, solo conteggi, nessun nome nel rapporto): se `damaged` supera il 5%, si rivede la regola "dati dopo `%%EOF`" prima dell'onda 4.

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
- **Regola della scansione** quando dimensione o `mtime` cambiano: (1) nuovo hash in `pdfWrite.own` → scrittura nostra: aggiorna `hash`, nessun "cambiato", nessuna estrazione; (2) altrimenti, file **cresciuto** e SHA-256 dei primi `vecchia dimensione` byte = vecchio `hash` (o dei primi `base.size` byte = `base.hash`) → aggiornamento incrementale (nostro da un altro computer o di un altro programma): `pdfWrite.base` = vecchio contenuto se mancava, `hash` aggiornato; per prudenza si rilegge il testo e, se differisce dalla cache, si tratta come contenuto cambiato; (3) altrimenti contenuto cambiato davvero (logica di oggi: `previousHashes`, annotazioni non allineate, `pdfWrite` azzerato; la copia di sicurezza resta finché l'utente non la toglie). Costo: un hash del prefisso, solo per i file cambiati.
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
| uguale | sparita dal PDF | **adotta** l'eliminazione nell'app, recuperabile: riga in Attività con [Ripristina] (la riscrive) |
| cambiata | cambiata o sparita | vince l'app (modifica più recente fatta qui); riga in Attività |
| eliminata nell'app | presente | togli il riferimento |
| presente, senza `pdf` | assente | aggiungi |

- **Annotazioni di altri programmi** (senza `/NM (rl-…)`): mai modificate, spostate o tolte (l'array `/Annots` le conserva nello stesso ordine). Il lettore le legge con pdf.js (`page.getAnnotations()`, solo pagine visibili) e le elenca nel pannello "Dal PDF (altri programmi)" in sola lettura: tipo, pagina, autore (`/T`) e testo (`/Contents`, come testo puro). pdf.js le disegna già nella tela. Facoltativo (onda 5): "Importa nell'app" crea un'annotazione dell'app con un `/NM` nuovo e lascia l'originale com'è.
- **Doppio disegno** delle nostre annotazioni già scritte (tela di pdf.js + sovrapposizione dell'app): la prova S2 sceglie tra (a) nasconderle dalla tela con l'`annotationStorage` di pdf.js per i riferimenti noti, (b) disegnare la tela con `annotationMode` che salta gli oggetti `/NM (rl-…)` (filtro sugli `annotationId` restituiti da `getAnnotations()`), (c) non sovrapporre le annotazioni scritte e usare la sovrapposizione solo per il clic e per quelle in attesa, ridisegnando la pagina dopo ogni scrittura. Criterio: nessun doppio disegno visibile, anche durante i 4 s del lotto.
- **Migrazione delle annotazioni già fatte:** mai in silenzio. Nel lettore il chip dice "PDF: 12 solo nell'app ▾ · Scrivile nel PDF"; in Impostazioni › Libreria › Annotazioni nel PDF "Scrivile nei PDF…" con dialogo (numero di file, spazio stimato delle copie) e avanzamento in Attività (annullabile, un file alla volta). Le annotazioni non allineate (`staleIds`) non si scrivono mai.
- **Primo uso:** banner nel lettore alla prima scrittura della libreria: "Le evidenziazioni ora si salvano anche dentro il PDF, così le vedi in Chrome e negli altri lettori. Il testo del PDF non cambia e puoi ripristinare l'originale. [Impostazioni] [Ho capito]".

#### 8.3.8 Ripristino

Menu del chip PDF, scheda Info e Avanzate (per tutti i documenti, lavoro annullabile): **Ripristina il PDF originale…** Dialogo: "Il file tornerà esattamente com'era prima delle evidenziazioni scritte da Research Lab. Le evidenziazioni restano nell'app." e, se presenti, "Si perderanno anche N annotazioni aggiunte nel frattempo da altri programmi." (conteggio dalle revisioni successive a `base`). Esecuzione con lo stesso percorso di §8.3.3 (registro, temporaneo, ricontrollo, rinomina): temporaneo = primi `base.size` byte dell'originale; SHA-256 = `base.hash`, altrimenti la copia di sicurezza (verificata con il suo hash); poi il documento passa a `pdfMode: 'app-only'` e le annotazioni perdono `pdf`. "Elimina le copie degli originali" (Avanzate) chiede conferma e avvisa che il ripristino userà solo il troncamento.

#### 8.3.9 Impostazioni

- `library.json` › `annotations: { writeToPdf: boolean = true, author: 'profile' | 'none' = 'none', backupLocation: 'data' | 'local' = 'data' }` (sincronizzato: la libreria si comporta allo stesso modo su ogni computer). Predefiniti di `author` e `backupLocation` provvisori (D-327, D-328): si cambiano solo nello schema.
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
PDF_WRITE_LIMITS = { maxBytes: 512 MiB, maxRevisions: 200, batchDelayMs: 4000, closeWaitMs: 5000, lockedBannerMs: 600000,
                     ownHashes: 20, maxDepth: 64, maxStringBytes: 65536, maxObjStmObjects: 100000,
                     maxInflatedBytes: 64 MiB, maxPrevChain: 1000, workerTimeoutMs: 10000, maxContentsChars: 8000 }

// ipc/channels/annotations.ts (canali nuovi)
'annotations:pdfState'  { docId } → { mode: 'write'|'app-only'|'off',
                                     state: 'synced'|'pending'|'writing'|'refused'|'none',
                                     reason?: 'encrypted'|'signed'|'xfa'|'damaged'|'read-only'|'too-large'|'too-many-revisions'
                                            |'verify-failed'|'locked'|'unavailable'|'changed',
                                     appOnly: number, external: number, lastWrittenAt?: IsoDate }
'annotations:writeNow'  { docId } → pdfState
'annotations:setPdfMode'{ docId, mode: 'write'|'app-only' } → pdfState
'annotations:restoreOriginal' { docId } → { restored: boolean, droppedExternal: number }
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

**Budget del main** (somma dei `.js` di `out/main`, worker compreso): oggi 1009/1010 KiB. Aggiunte: scrittore 34-42, account Claude 4-6, rapporto di scansione e `ai:usageAll` 2-3 → **1049-1060**. Si propone **1060** (D-319, confermato in D-342): funzione chiesta esplicitamente dall'utente, nessuna dipendenza, codice non minificato per diagnosi leggibili (D-177). Lo scrittore è un chunk separato caricato con `import()` nel worker alla prima scrittura: avvio, memoria a riposo e primo contenuto invariati. Se la prova S2 misura più di 46 KiB, il compito G4a si ferma e lo riporta prima di proseguire.

#### 8.3.12 Sicurezza (revisione security dedicata)

- Il parser legge **dati ostili**: limiti di `PDF_WRITE_LIMITS` (annidamento 64, stringhe e nomi 64 KiB, oggetti per stream 100 000, decompressione 64 MiB con `maxOutputLength` di zlib, catene `/Prev` 1000 con rilevamento di cicli), tempo massimo 10 s per file nel worker con il watchdog; nessuna ricorsione senza profondità massima; ogni offset controllato contro la dimensione del file.
- Nessun percorso dal renderer: solo `docId`; percorso risolto nel main con `resolveInRoot` + `realpath` e ricontrollato prima della rinomina (D-200); temporanei solo nella cartella del file, con nome casuale e `COPYFILE_EXCL`; pulizia solo dei temporanei registrati.
- Testo scritto nel PDF sempre codificato (§8.3.2); nessun contenuto del PDF nei log (solo motivo, dimensione, numero di oggetti).
- La verifica rifiuta ogni risultato che non si rilegge esattamente.
- Prove con il corpus ostile (`security-hostile-scan.spec.ts` esteso) e con mutazioni casuali dei PDF sintetici (troncamenti, byte cambiati, `/Prev` ciclici, stream bomba, `/Annots` ricorsivo, pagine mancanti): nessuna eccezione non gestita, nessuna scrittura.
- `check:nondestructive` aggiornato (prefisso intatto, solo file con un nostro `/NM` registrato).
- Domande per la revisione: rischio della riscrittura del dizionario della pagina alla prima scrittura; trattamento di file ibridi e linearizzati; copia dei flussi alternativi (contrassegno di provenienza) e attributi; comportamento con antivirus che bloccano la rinomina; sufficienza del ricontrollo TOCTOU a campioni.

#### 8.3.13 Prototipo (onda 0) e test

**Prova S2** (`tools/spikes/pdf-annot/**`, nessun file dell'app): scrittore minimo (aggiunta e rimozione, tabella classica e stream xref), PDF sintetici generati con pdf-lib nel test (tabella classica; stream xref con stream di oggetti; ruotato 90 e 270; `CropBox` spostato; `UserUnit` 2) e scritti a mano come testo (ibrido con `/XRefStm`; linearizzato minimo; con `/Encrypt`; con `/SigFlags 3`; con `/XFA`; troncato; con `/Prev` ciclico). Rapporto in `tools/spikes/pdf-annot/README.md`: righe e KiB del codice, tempo per scrittura su 1, 20 e 100 MB, rifiuti per motivo sulla libreria di prova in sola lettura (solo conteggi), scelta per il doppio disegno (§8.3.7), verifica che `rl-doc://` non tenga il file aperto, e una lista di file sintetici da aprire **a mano** in Edge e Chrome (l'agente principale o l'utente) per confermare che evidenziazione e sottolineatura si vedono con il colore giusto.

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
| Rifiuti | ogni motivo di §8.3.5 su un file sintetico |
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
| ripristina originale | Ripristina il PDF originale | Restore the original PDF |
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

## 13. Leggerezza e budget (D-342)

| Voce | Oggi | Stima dopo | Note |
| --- | --- | --- | --- |
| JS iniziale renderer | 379,5 / 391 KiB | 386-390 KiB | guscio nuovo, `nav.tsx` (~2), `icons-shell.tsx` (~3), `Popover`/`Menu`/`Drawer` (~3), chip Attività (~2); −barra di stato, −selettore lingua (~2). Il popover Attività e la Cronologia sono chunk pigri (caricati al primo clic). Se si supera 391: anche `Drawer` diventa pigro |
| JS totale renderer | 1574 / 1600 KiB | 1605-1630 KiB | impostazioni riorganizzate e Account (+10), lettore a strumenti e macchina a stati (+8), componenti e icone (+6), Da rivedere a righe (~+2), Attività (+3). **Tetto 1640** (D-322) |
| CSS | tutto nel primo caricamento | ~35% nel primo | divisione per vista; il CSS di pdf.js resta nel chunk del lettore (−150 KiB facoltativi con il sottoinsieme, §8.1.1) |
| JS main (con worker) | 1009 / 1010 KiB | 1049-1060 KiB | scrittore PDF 34-42 (chunk pigro del worker), account 4-6, rapporto di scansione e `ai:usageAll` 2-3. **Tetto 1060** (D-319, D-342) |
| Preload | ≤ 8 KiB | invariato | i canali nuovi passano dal ponte generico |
| Memoria a riposo | tetto 501 MB | invariata | nessun processo nuovo; lo scrittore si carica alla prima scrittura nel worker esistente (che si chiude da solo quando è inattivo); la console di login è esterna e solo su richiesta |
| Primo contenuto | tetto 530 ms | invariato | nessuna richiesta nuova all'avvio (i conteggi esistono già); Account, Attività e Cronologia non chiamano nulla finché non si aprono |
| Disco della libreria | — | + copie degli originali annotati | una per file annotato, nella cartella dati (D-327, provvisoria); spazio mostrato in Avanzate |

Regola per ogni compito: `npm run check:budget` prima del rapporto; se una voce supera la stima di questa tabella di oltre il 10% il compito si ferma e lo riporta (non alza budget da solo). Nessuna dipendenza nuova: icone in linea, popover e cassetti scritti a mano, scrittore PDF proprio.

---

## 14. Piano di implementazione a onde (giro 2, D-343)

Regole comuni a tutti i compiti:
- Subagent **Sonnet** (Haiku solo per traduzioni di massa e spostamenti meccanici); lavoro in `../rl-wt/<id-compito>` dal `main` aggiornato; **al massimo 2 compiti in parallelo e con file disgiunti** (gli elenchi "File" sotto sono esclusivi: un file non elencato non si tocca; se serve, il compito si ferma e lo chiede).
- I contratti in `@rl/core` li scrive **l'agente principale** prima dell'onda (come D-184, D-202, D-218, D-255); i compiti non toccano `packages/core`.
- Prima del rapporto: `npm run typecheck`, `npm test` del pacchetto toccato, `npm run check:budget`, `npm run check:generality`. **e2e solo quelle elencate, una spec alla volta, e mai mentre un altro compito esegue e2e** (regola delle risorse); `test:e2e:heavy` solo nell'onda 6.
- Niente push; commit piccoli con l'identità locale e **senza** `Co-Authored-By`; testi it + en; rapporto breve (cosa, file, testid cambiati, budget misurato, rischi).
- Merge nell'ordine indicato; dopo ogni merge l'agente principale esegue `smoke.spec.ts`.

### Onda 0 — prove (S1 ∥ S2)

| Id | Obiettivo | File (esclusivi) | Criteri di accettazione | Test | Budget |
| --- | --- | --- | --- | --- | --- |
| S1 | Verificare `claude auth status --json`, `auth login`, `auth logout` sulla CLI installata (nomi, uscita, codici, comportamento senza login, campi disponibili) | `docs/design/spike-auth.md` | esempi di uscita **anonimizzati** (nessuna email o organizzazione reale); decisione sul ripiego per ogni comando; nessun logout reale senza conferma dell'utente (si prova solo `status`; `login`/`logout` si leggono dall'aiuto `--help`) | nessuno | 0 |
| S2 | Prototipo dello scrittore incrementale (§8.3.13) | `tools/spikes/pdf-annot/**` | rapporto con righe e KiB, tempi, rifiuti per motivo sulla libreria di prova (solo conteggi), scelta per il doppio disegno, `rl-doc://` e file aperti; prefisso intatto su tutti i sintetici; nessun PDF reale committato | Vitest nella cartella della prova | 0 (fuori dall'app) |

Dopo l'onda 0 l'agente principale scrive i contratti di §7.1, §9, §10.3, §10.4, lo scope `reader-tool` e gli id `nav.*`, e decide il doppio disegno con il rapporto di S2.

### Onda 1 — fondamenta (A1 ∥ B1)

**A1 · Token, CSS, componenti, PDF stirato e CSS di pdf.js** (renderer)
- File: `styles.css` → `styles/tokens.css`, `styles/base.css`, `styles/shell.css` e i CSS per vista (`views/*/<vista>.css`, `settings/settings.css`); `main.tsx` (import CSS); `components/ui.tsx`, nuovi `components/{Button,IconButton,Segmented,Switch,Tabs,Chip,Badge,KeyValue,Popover,Menu,Drawer,Banner,Toast,EmptyState,Kbd,Progress}.tsx`, `components/icons-shell.tsx`, `components/icons.tsx`; `views/reader/engine.ts` (solo la riga dell'import CSS) e nuovo `views/reader/reader.css`; **solo i `className`** in collisione (§8.1.1) nei file che li usano (`App.tsx`, `shell/**`, `settings/Settings.tsx`, `views/**/*.tsx`, `components/Dialog.tsx`, `views/guide/*.tsx`) — nessun altro cambiamento in quei file; nuovi test `styles/tokens.contrast.test.ts`, `styles/pdfjs-collision.test.ts`, `styles/no-literal-colors.test.ts`.
- Criteri: contrasti di §5.2 nel test; nessuna classe in collisione con pdf.js; `.pdfViewer .page` senza `max-width`/`padding`; nessun colore letterale fuori dai token; aspetto delle viste non migrate invariato (alias `--space-*`); i componenti nuovi hanno test di rendering minimi (stati, `aria-*`).
- Test e2e: `study-ui.spec.ts` (con le due misure nuove di §8.1/§8.1.1: rapporto pagina/MediaBox a 1280 e 1920, stile della barra laterale prima/dopo il lettore), `smoke.spec.ts`.
- Budget: iniziale +3-5 KiB (componenti usati dal guscio, icone della prima schermata), CSS iniziale −50-60%.

**B1 · Main: account, scansione, conteggi** (main e `@rl/ai`)
- File: `packages/ai/src/claude.ts` (+test), `apps/desktop/src/main/ai/**` (nuovo `account.ts`, `usage-all.ts`), `main/ipc/handlers/{ai,scan,inbox,review}-handlers.ts`, `main/library/library-runtime.ts` (solo il rapporto di scansione), `main/inbox/service.ts` (solo conteggi e "visti"), `main/ai/review.ts` (solo `pendingDocs`), `renderer/src/testing/mockRl.ts`.
- Criteri: ogni canale nuovo con test unitario e fornitore simulato; `authMode` rispettato nell'ambiente del figlio (test sull'ambiente costruito); nessun segreto né uscita di `auth status` nei log; argomenti fissi per i processi esterni; il renderer non passa percorsi.
- Test e2e: nuova `e2e/ai-account.spec.ts` (fornitore simulato: cambio modo, prova della connessione, chiave salvata e rimossa) scritta qui, eseguita alla fine dell'onda.
- Budget: main +7-10 KiB.

### Onda 2 — guscio e impostazioni (A2 ∥ C2)

**A2 · Guscio, navigazione, notifiche, Attività**
- File: `App.tsx`, `shell/**`, nuovi `lib/nav.tsx`, `shell/ActivityChip.tsx`, `shell/ActivityPopover.tsx` (pigro), `shell/HistoryButtons.tsx`; `lib/history.tsx` (solo dove si monta), `lib/HistoryPanel.tsx` (popover, Esc), `lib/aiUi.tsx` (navigazione → `navigate`), `lib/notify.tsx` (toast in basso a destra), `components/NoticeBanner.tsx`, `lib/keymap.tsx`, `lib/shortcutDefs.ts`, `views/chat/Palette.tsx`, `views/chat/paletteModel.ts` (+test), `lib/jobs.tsx` e `lib/citationJobs.tsx` (solo l'esposizione delle righe per Attività), dizionari principali `i18n/locales/{it,en}.json`, `e2e/helpers/ui.ts` (solo funzioni di navigazione).
- Criteri: §2, §3 (3.1-3.4), §4.1, §4.10, §7; gesti di §3.1; Alt+←/→ e tasti laterali; badge con tooltip; barra di stato tolta con ogni contenuto ricollocato (§7.3); disposizione adattiva del guscio (pannello Claude accanto/sovrapposto); nessuna richiesta nuova all'avvio (test con `mockRl` che conta le chiamate); JS iniziale ≤ 391.
- Testid: tenuti `shell`, `nav-library`, `nav-projects`, `nav-discover`, `nav-settings`, `inbox-badge`, `discover-badge`, `chat-toggle`, `chat-panel`, `palette-open`, `scan-status`, `drop-hint`, `notice-banner`, `app-title`, `library-switcher` (pulsante + voci `library-switcher-item`), `history-panel`; rinominati `nav-inbox` → `nav-review`, `nav-network` → `nav-map`; spostati `status-library`, `status-ai`; tolto `statusbar`; nuovi `activity-chip` (= `scan-status`), `activity-popover`, `nav-back`, `nav-forward`, `topbar-search`.
- Test e2e: `smoke.spec.ts`, `ui-first-run.spec.ts` (selettore), `inbox.spec.ts` e `network.spec.ts` (solo selettori di navigazione), `qa-budget.spec.ts`.
- Budget: iniziale +5-8 KiB, −2 KiB.

**C2 · Impostazioni e Account Claude**
- File: `settings/**` (compresi `ShortcutsSection.tsx` e `shortcuts.css` per la nuova presentazione a righe; lo scope `reader-tool` lo aggiunge F4 nell'onda 4), nuovi `GeneralSection.tsx`, `ClaudeSection.tsx`, `AccountCard.tsx`, `AdvancedSection.tsx`, `SavedKeys.tsx`, `settingsIndex.ts` (+test), `useAutoSave.ts`; parti i18n `settings`, `settings-wizard` (solo chiavi delle impostazioni), `aiSettings`, `mcp`, `backup`, `shortcuts`; `e2e/helpers/settings.ts` (nuovo `openSettings(window, section)`).
- Criteri: §4.6-§4.8, §6 (ogni riga della mappa con il controllo nella sezione giusta: test su `settingsIndex.ts`), §10.2 e §10.4 lato interfaccia; salvataggio automatico (D-336) con test di validazione; stati del Backup; sezioni pigre (nessun peso nella prima schermata).
- Testid: tenuti tutti quelli delle sezioni (`ai-settings`, `ai-exe*`, `ai-apikey*`, `ai-status*`, `mcp-*`, `backup-*`, `maintenance-*`, `shortcut*`, `library-config`, `config-*`, `settings-network`/`net-*`, `secret-*`, `settings-profile-*`, `settings-theme`, `library-list`, `library-item`, `settings-new-library`, `language-select`); nuovi `settings-nav-<section>`, `settings-search`, `ai-account`, `ai-auth-mode-<mode>`, `ai-login`, `ai-logout`, `ai-test`, `ai-test-result`, `ai-usage-all`, `advanced-nondefault`, `saved-keys`. I pulsanti Salva tolti: le spec che li cliccano attendono "Salvato".
- Test e2e: `ai-account.spec.ts`, `ai-ui.spec.ts`, `backup-restore.spec.ts`, `export-mcp.spec.ts`, `ai-live.spec.ts` (solo se le chiamate reali sono richieste: altrimenti saltata), una alla volta.
- Budget: totale +10-12 KiB, iniziale 0.

### Onda 3 — viste principali (D3 ∥ E3)

**D3 · Libreria, tassonomia, scansione, procedura guidata**
- File: `views/library/**` (compresi `TaxonomyManager.tsx`, `ScanStatusText.tsx`, `useScanStatus.ts`), `wizard/**`, `views/guide/WelcomeCard.tsx` (→ "Per iniziare"), nuovo `views/library/ScanReport.tsx` (montato da A2 nel popover Attività tramite un import pigro già predisposto), parti i18n `doc`, `doc-reader` (solo chiavi della libreria), `taxonomy`, `wizard`, `guide` (solo le frasi su doppio clic e scansione).
- Criteri: §3.2 (clic, tastiera, disposizione adattiva della Libreria), §4.2, §4.9, §4.11, §4.13 (tassonomia); una sola riga di barra; chip "Dalla scansione" filtra esattamente gli id; procedura guidata con 7 passi e "Continua in background"; salvare la tassonomia non avvia una scansione (T3, test); nessuna regressione della ricerca; a 1024×700 con la chat aperta campo di ricerca ≥ 280 px e righe ≥ 420 px (e2e).
- Testid: tenuti `search-input` (ora nella barra in alto, creato da A2), `search-result(s)`, `search-summary`, `results-pane`, `folder-pane`, `tag-pane`, `manage-taxonomy`, `open-taxonomy`, `show-missing`, `scan-cancel`, `scan-start` (nel popover); `index-rebuild` resta in Avanzate (C2); nuovi `wizard-scan`, `wizard-scan-continue`, `scan-report`, `scan-report-<kind>`, `row-read`, `row-detail`, `row-more`, `getting-started`.
- Test e2e: `ui-library.spec.ts`, `ui-first-run.spec.ts`, `search-basic.spec.ts`, `qa-watcher.spec.ts`, `qa-search-perf.spec.ts`, `thumbs.spec.ts` (griglia), una alla volta; `helpers/phase1.ts` (attesa della scansione nel nuovo passo) è di questo compito.
- Budget: totale ±3 KiB (righe e griglia ridisegnate, barra più semplice).

**E3 · Da rivedere**
- File: `views/inbox/**`, `views/review/**`, nuovo `views/review/ReviewHub.tsx`, `lib/inbox.tsx` (conteggi per il badge), parti i18n `inbox`, `review`, `doc-review`.
- Criteri: §4.4, §4.5, §7.1, D-338; righe compatte (64-84 px chiuse); "Conferma i selezionati"; gruppi "Da aggiungere" e "Già nella libreria" con testi propri; righe di problema con pulsante (I2); copie in conflitto previste come tipo di riga (attivo dopo G4b); tasti J/K/A/R/E/O; le decisioni come oggi (D-221, D-223, D-230).
- Testid: tenuti `inbox-view`, `review-view`, `inbox-add`, `inbox-empty`, `inbox-refused*`, `review-*`; rinominati `inbox-tab-arrivals`/`inbox-tab-proposals` → `review-tab-files`/`review-tab-proposals`, `section-inbox` → `section-review`; nuovi `review-row`, `review-row-confirm`, `review-confirm-selected`.
- Test e2e: `inbox.spec.ts`, `ai-review.spec.ts`, una alla volta.
- Budget: totale +1-3 KiB.

### Onda 4 — lettore e scrittura nel PDF (F4 ∥ G4a, poi G4b)

Prima: l'agente principale scrive i contratti di §8.3.10 e aggiorna `check-nondestructive.mjs` (`--allow-pdf-append`).

**F4 · Lettore a strumenti** (renderer)
- File: `views/reader/**` (nuovi `toolMachine.ts` + test, `ReaderToolbar.tsx`, `AnnotationPopover.tsx`, `PdfWriteChip.tsx`, `ExternalAnnotations.tsx`, `FindBar.tsx`, `cursors.css`), `views/notes/**` (solo disposizione nella scheda Note), `lib/reader.tsx`, `settings/ShortcutsSection.tsx` (solo lo scope `reader-tool`; C2 è unito), parti i18n `reader`, `doc-projects-reader` (chiavi del lettore).
- Criteri: §4.3, §8.1 (arrotondamento DPR), §8.2 intero; un test per ogni riga della tabella di §8.2.4; Spazio ignorato nei campi, nei trascinamenti, nella ripetizione e con il fuoco fuori; Esc secondo `ESC_AT_ROOT`; la vista non si sposta dopo una creazione; area utile di §4.3 a 1024×700 e 1280×800; tutte le annotazioni raggiungibili da tastiera; chip PDF e banner con `mockRl` finché G4a non è unito.
- Testid: tenuti `reader`, `reader-close`, `reader-title`, `reader-page-input`, `reader-pages`, `reader-prev/next`, `reader-zoom*`, `reader-fit`, `reader-find*`, `reader-side*`, `reader-tab-*`, `reader-study-*` (voci del menu `reader-study-menu`), `reader-underlined` (scheda Info), `annotation-bar` (= popover), `annotation-mark`, `annotation-item`, `ann-highlight`, `ann-comment`, `ann-color-*`; nuovi `reader-toolbar`, `reader-tool-<tool>`, `reader-pdf-chip`, `reader-pdf-menu`, `reader-external-annotations`, `reader-root-hint`.
- Test e2e: `study-ui.spec.ts`, poi `study-data.spec.ts` (solo la parte UI).
- Budget: totale +6-9 KiB (chunk del lettore).

**G4a · Scrittore incrementale e servizio di sincronia** (data + main) — **area sensibile**
- File: `packages/data/src/pdf-annot/**` (nuovo: `lexer.ts`, `objects.ts`, `serialize.ts`, `xref.ts`, `objstm.ts`, `pages.ts`, `geometry.ts`, `plan.ts`, `reconcile.ts`, `appearance.ts`, `verify.ts`, test e generatori di PDF sintetici), `apps/desktop/src/main/study/pdf-sync.ts` (nuovo: lotti, coda, registro, copia, rinomina, ripristino, migrazione, conflitti), `main/ipc/handlers/study-handlers.ts` (solo i canali nuovi), `main/library/worker-protocol.ts` e `worker-service.ts` (messaggi `pdfPlan`/`pdfVerify`, import pigro), nuovo `settings/LibraryAnnotationsGroup.tsx` (montato da `LibraryConfigSection` con una riga: unico file di settings toccato), parti i18n `settings` (solo il gruppo).
- Criteri: tutti i test di §8.3.13 tranne "Identità"; prefisso intatto in ogni test; budget main ≤ 1060 (se lo scrittore supera 46 KiB: stop e rapporto).
- Test e2e: nuova `e2e/pdf-annot.spec.ts`, poi `security-hostile-scan.spec.ts` (da solo: è pesante).
- Revisione: Sonnet indipendente **e security dedicata** prima del merge.
- Budget: main +34-42 KiB.

**G4b · Identità del contenuto** (dopo il merge di G4a)
- File: `packages/data/src/scanner.ts`, `packages/data/src/extract/text-extractor.ts` (chiave della cache), `apps/desktop/src/main/thumbs.ts`, `main/graph/inputs.ts`, `main/inbox/service.ts` (duplicati e copie in conflitto), `main/ai/tools-host.ts` e la cache AI, `main/ipc/handlers/study-handlers.ts` (solo il confronto `forHash`), `main/ipc/handlers/doc-files.ts`, `packages/search/src/sqlite-index.ts` (se usa l'hash come chiave di contenuto), `tools/check-nondestructive.mjs`.
- Criteri: i test "Identità" di §8.3.13; un file davvero cambiato si comporta come oggi.
- Test e2e: `study-data.spec.ts` (due casi, scrittura spenta e accesa), `qa-scan-nondestructive.spec.ts`, `thumbs.spec.ts`, `inbox.spec.ts`, una alla volta.
- Revisione: security insieme a G4a (stessa revisione, dopo G4b).
- Budget: main +1-2 KiB.

### Onda 5 — viste secondarie e rifinitura (H5 ∥ I5, poi J5)

**H5 · Progetti, Scopri, Mappa** — File: `views/projects/**`, `views/discover/**`, `views/network/**`, `views/citations/**` (solo stile), i loro CSS e parti i18n. Criteri: §4.13 e D-344 (intestazione di vista, stati vuoti con azione, seme nel menu, nodi ≥ 8 px), Annulla/Cronologia tolti dalle barre (sono in alto). Test e2e: `ui-projects.spec.ts`, `citations.spec.ts`, `network.spec.ts`. Budget ±2 KiB.

**I5 · Pannello Claude, lavori AI, guida, esportazione** — File: `views/chat/**` esclusi `Palette.tsx` e `paletteModel.ts` (A2), `views/ai/**`, `views/guide/**` escluso `WelcomeCard.tsx` (D3), `views/export/**`. Criteri: §4.12, D-339 (anteprima in linea con test sulle condizioni che riportano il dialogo; regola 4), etichette degli strumenti tradotte, piede fisso nei dialoghi, guida aggiornata (strumenti, Spazio, scrittura nel PDF, doppio clic). Test e2e: `ai-chat.spec.ts`, `ai-ui.spec.ts`, `ai-search.spec.ts`, `export-mcp.spec.ts`. Budget +2-4 KiB.

**J5 · Facoltativi** (dopo H5 e I5; uno alla volta) — "Esporta copia annotata" (§8.3.14: `main/study/pdf-sync.ts`, `views/reader/PdfWriteChip.tsx`), "Importa nell'app" per le annotazioni esterne (`views/reader/ExternalAnnotations.tsx`), sottoinsieme del CSS di pdf.js (`tools/vendor-pdfjs-css.mjs`, `views/reader/reader.css`). Ogni voce con i suoi test; la prima passa dalla revisione security.

### Onda 6 — verifica

| Id | Compito | Criteri |
| --- | --- | --- |
| V1 | Secondo giro dell'auditor con lo script `e2e/design-audit.spec.ts` (ramo `design-audit`), **in italiano e in inglese**, più i punti X1 non coperti (scheda del documento, export, MCP acceso, backup valido, scorciatoie, PDF protetto o danneggiato, dialoghi dopo il lettore, trascinamento reale fatto a mano) | ogni riga di §0 chiusa o con un compito correttivo; nessun testo sotto 4,5:1; nessun elemento tagliato a 1024×700 |
| V2 | Revisione indipendente (Sonnet) del ramo; **security** con potere di blocco su scrittore PDF, `ai:login/logout` (processi esterni), osservatore di `~/.claude`, `check-nondestructive` | rapporti in `docs/` e correzioni unite |
| V3 | Budget: `check:budget`, `qa-budget.spec.ts`; `tools/budgets.json` aggiornato solo come D-319/D-322/D-342 | misure riportate in `docs/STATUS.md` |
| V4 | Suite e2e completa **una spec alla volta**, poi `test:e2e:heavy` da solo | verde |
| V5 | `docs/STATUS.md`, `docs/HISTORY.md`, `docs/PLAN.md` (criterio della fase 3), guida d'uso; conferma delle quattro scelte provvisorie (§15) con l'utente | scelte confermate o cambiate (un valore ciascuna) |

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
| `reader-study-*` | voci del menu `reader-study-menu` |
| `reader-underlined` | scheda Info del pannello del lettore (etichetta "Annotato") |
| tutti gli altri | invariati |

---

## 15. Scelte provvisorie (da confermare con l'utente)

Le quattro domande del primo giro non hanno ancora risposta; per non bloccare il lavoro ognuna ha un valore predefinito **provvisorio, da confermare con l'utente** (in DECISIONS), e il progetto rende il cambio un'operazione da un valore.

| # | Domanda | Scelta provvisoria | Perché | Come si cambia |
| --- | --- | --- | --- | --- |
| 1 | Copia di sicurezza dei PDF annotati: cartella dati sincronizzata o cartella locale dell'app? | **cartella dati** (`<dataDir>/pdf-originals/`), una copia per contenuto (D-327) | è il testo della regola 1; la copia c'è su ogni computer e dopo un conflitto di sincronizzazione; costo limitato ai PDF annotati, visibile ed eliminabile in Avanzate | `annotations.backupLocation` (`'data'`/`'local'`), un solo punto (`pdfBackupDir`) |
| 2 | Nome dell'autore nelle annotazioni del PDF: nome del profilo o nessuno? | **nessuno** (D-328) | il PDF esce dall'app quando lo si condivide; un dato personale si aggiunge solo se l'utente lo sceglie ("Firma le annotazioni con il mio nome") | valore predefinito di `annotations.author` |
| 3 | Esc non chiude più il lettore: va bene? | **sì, non chiude**; alla fine della catena un suggerimento una volta per sessione (D-329) | con gli strumenti Esc si preme spesso; chiudere per sbaglio fa perdere il punto; ×, Alt+←, Ctrl+W e le briciole chiudono | costante `ESC_AT_ROOT` (`'hint'`/`'close'`), test per entrambi |
| 4 | Uso del mese nell'Account: libreria attiva o tutte? | **libreria attiva**, con "Calcola il totale di tutte le librerie" su richiesta (D-330) | stessa unità del tetto di spesa; nessuna lettura di cartelle di altre librerie all'apertura | costante `ACCOUNT_USAGE_SCOPE` |

Rischi aperti (per l'agente principale): (a) la scrittura nel PDF tocca file reali dell'utente: prima della prima scrittura reale, backup della cartella dati (regola 1) e revisione security; (b) il servizio di sincronizzazione può creare copie in conflitto o tenere i file occupati (§8.3.4): il comportamento è progettato ma va provato su un computer reale con una libreria di prova; (c) il doppio disegno delle annotazioni dipende dalla prova S2; (d) la percentuale di PDF rifiutati per `damaged` sulla libreria reale è sconosciuta fino alla prova S2; (e) il budget del main (1060) ha 0-11 KiB di margine dopo le stime; (f) l'audit è parziale: l'onda 6 completa i punti X1.
