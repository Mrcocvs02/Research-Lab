# Architettura dell'interfaccia e sistema visivo (riprogettazione)

> **DA COMPLETARE (stato del lavoro):** documento completo in tutte le sezioni; restano da scrivere le decisioni D-310…D-324 in `docs/DECISIONS.md` e il testo nuovo della regola 1 in `docs/RULES.md` e in `CLAUDE.md` (§8.3.1 ne dà il contenuto).

Stato: proposta dell'architetto (2026-11-17), ramo `design-arch` da `main` c1b9ac2. Primo giro: scritto dal codice, dai documenti e dalle richieste dell'utente; il rapporto dell'auditor visivo arriverà al secondo giro e potrà correggere dettagli (non la struttura). Decisioni: D-310 … D-324 in `docs/DECISIONS.md`.

Le richieste dell'utente a cui risponde questo documento:

| # | Richiesta | Dove |
| --- | --- | --- |
| 1 | Grafica poco attraente → sistema visivo coerente | §5 |
| 2 | Impostazioni confuse → poche sezioni chiare + "Sviluppatore / Avanzate" | §6 |
| 3 | Navigazione difficile → nuova architettura dell'informazione | §2, §3, §4 |
| 4 | Cambiare account Claude facilmente | §10 |
| 5 | Scansione facile e visibile | §9 |
| 6 | Notifica degli Arrivi poco chiara | §7 |
| 7a | PDF stirato orizzontalmente | §8.1 |
| 7b | Annotazione per strumento (pennello), Spazio, tasti | §8.2 |
| 7c | Sottolineature visibili negli altri lettori → **scrittura nei PDF originali** (decisione dell'utente, D-316) | §8.3 |
| 8 | Tutto più chiaro e ordinato | tutto; §11 testi |

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
│     ├── barra: ricerca, Chiedi a Claude, filtri, Elenco|Griglia, ordina, + Aggiungi PDF
│     ├── pannello sinistro: Cartelle | Tag (› Gestisci tag = editor della tassonomia, sottovista)
│     ├── risultati (elenco virtuale o griglia)
│     ├── pannello destro: Scheda documento (metadati, stato, tag, area AI, citazioni)
│     └── Lettore (sottovista a tutta area: Libreria › Titolo)
│           ├── barra del lettore + barra strumenti flottante
│           └── pannello destro: Annotazioni | Note | Info (stato di studio) | Citazioni
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

### Gesti per i compiti principali

| Compito | Gesti | Come |
| --- | --- | --- |
| Trovare un paper | 2 | Ctrl+L, scrivere, Invio sul risultato (o frecce) |
| Leggere e annotare | 2 | Invio/R apre il lettore; H (evidenzia) e trascinare sul testo |
| Aggiungere paper | 2 | trascinare PDF sulla finestra → "Da rivedere" si apre → Conferma |
| Chiedere a Claude | 1-2 | Ctrl+J e scrivere; con documenti selezionati la domanda li include |
| Rivedere proposte | 2 | Alt+2 → "Accetta" (o A/R da tastiera sulla voce attiva) |
| Backup | 2-3 | Ctrl+K "backup" Invio, oppure Impostazioni › Backup › Esegui ora |

### 4. Wireframe

#### 4.1 Guscio

```
+----------------------+--------------------------------------------------------------------------+------------------------+
| (≡) Research Lab     | [<][>]  Libreria › Capitolo 2            [ Cerca nella libreria… Ctrl+L ]  | Claude            [×]  |
|                      |                                          [⌘ Comandi Ctrl+K] (● Aggiornata) |  ● Pronto · Haiku 5.5  |
| [■ Tesi       ▾]     +--------------------------------------------------------------------------+  2 cartelle abilitate  |
|                      | [banner: es. "Ultimo backup 34 giorni fa"   (Esegui ora) (×)]            | ---------------------- |
|  ▣ Libreria          +--------------------------------------------------------------------------+  conversazione…        |
|  ⇩ Da rivedere   15  |                                                                          |                        |
|  ▤ Progetti          |                         CONTENUTO DELLA VISTA                            |                        |
|  ✦ Scopri         4  |                                                                          |                        |
|  ◎ Mappa             |                                                                          |                        |
|                      |                                                                          |                        |
|                      |                                                                          |                        |
|  ─────────────       |                                                                          | [ Chiedi a Claude… ]   |
|  ◐ Claude    Ctrl+J  |                                                                          | [/ comandi] [Invia]    |
|  ? Aiuto        F1   |                                                                          |                        |
|  ⚙ Impostazioni      |                                                     [toast: Tag aggiunto · Annulla]      |
+----------------------+--------------------------------------------------------------------------+------------------------+
```

- Barra laterale 232 px; comprimibile a 56 px (solo icone, etichette nei tooltip) con il pulsante (≡) o automaticamente sotto i 1100 px di finestra. Le voci sono `nav-<id>`.
- Pannello Claude 380 px, ridimensionabile 320-560 px trascinando il bordo; chiuso non occupa spazio (oggi lascia una striscia).
- Il chip Attività (`scan-status`) mostra la cosa più importante in corso, nell'ordine: errore › scrittura PDF in attesa › scansione › lavoro AI › backup › export › "Aggiornata hh:mm".

#### 4.2 Libreria

```
+--------------------------------------------------------------------------------------------------------------+
| Libreria                                                         [Chiedi a Claude] [+ Aggiungi PDF]          |
| [Stato ▾] [Tipo ▾] [Anno ▾] [Rivista ▾] [+ Tag]   (×Da leggere) (×macro: Ottica)  Pulisci   [≡|▦] [Ordina ▾] |
+--------------------+------------------------------------------------------+----------------------------------+
| Cartelle | Tag     | 214 documenti                    □ Mostra mancanti   | Scheda                      [×] |
| ---------------    | -------------------------------------------------- |  Titolo del paper                 |
| ▾ Tutta la libreria| □ ▤ Titolo del primo paper          Autore A · 2021  |  Autore A, Autore B · Rivista     |
|   ▸ Capitolo 1  42 |      …frammento con la parola cercata…   p. 3  p. 7  |  [Leggi]  [Chiedi a Claude] [⋯]  |
|   ▾ Capitolo 2  80 | □ ▤ Titolo del secondo paper        Autore C · 2019  |  Stato: (Da leggere|In lettura|Letto)
|      ▸ Fonti    12 |      ● in lettura · 3 evidenziazioni                 |  Tag: [Ottica ×] [+]             |
|   ▸ Bozze        6 | ■ ▤ Titolo selezionato              …                |  ── Generato dall'AI ──────────   |
|                    |                                                      |  Descrizione proposta  [Rivedi]  |
| [Gestisci tag]     | (3 selezionati: Tag ▾  Progetto ▾  Claude ▾  ⋯)      |  Citazioni: 12 in libreria / 30  |
+--------------------+------------------------------------------------------+----------------------------------+
```

- La barra delle azioni di selezione compare al posto del sommario quando ci sono elementi selezionati (non sotto).
- "Gestisci tag" apre la sottovista `taxonomy` (briciole: Libreria › Tag); `open-taxonomy` resta come testid del pulsante.
- La scansione non ha più pulsanti qui (§9): solo il chip Attività. Un filtro "Dalla scansione: 3 nuovi" compare come chip quando lo si apre dal rapporto.

#### 4.3 Lettore con barra strumenti

```
+--------------------------------------------------------------------------------------------------------------+
| [← Libreria]  Titolo del paper (troncato)   ‹ [ 12 ] / 38 ›   [−] 110% [+] [⇔ Adatta]  [⌕]  [◫ Pannello] [⋯] |
|                                                         PDF: ✓ Nel PDF  ▾        Stato: [In lettura ▾]      |
+-----------------------------------------------------------------------------+--------------------------------+
|                 +-------------------------------------------+               | Annotazioni | Note | Info | Cit.|
|                 | [↖ V] [▌H] [_U] [⌫ E] | ● ● ● ● ●  | [?]     |  ← flottante  | ---------------------------- |
|                 +-------------------------------------------+               | Pagina 3                       |
|        +-----------------------------------------------+                    |  ▌ "testo evidenziato…"   ⋯   |
|        |                                               |                    |  _ "testo sottolineato…"  ⋯   |
|        |   Testo della pagina con ▌evidenziazione▐     |                    | Pagina 7                       |
|        |   e una frase sottolineata________            |                    |  ▌ "…" · commento             |
|        |                                               |                    | ---------------------------- |
|        |         [popover: ● ● ● ● ● | ▌ _ | 💬 | 🗑]    |                    | Dal PDF (altri programmi)      |
|        |                                               |                    |  ◇ Nota di Acrobat · p. 2  ⓘ  |
|        +-----------------------------------------------+                    |                                |
+-----------------------------------------------------------------------------+--------------------------------+
```

- La barra di studio di oggi (stato, "sottolineato", riga di tasti) esce dalla barra: lo stato è un menu compatto nella barra (`reader-study-*` restano come voci del menu), il flag "sottolineato" e l'origine vanno nella scheda Info del pannello, l'elenco dei tasti nel pulsante [?] della barra strumenti (apre la scheda tasti del lettore).
- Il chip "PDF:" mostra lo stato di scrittura nel PDF originale (§8.3) con un menu: Scrivi ora · Scrivi le annotazioni già fatte · Ripristina il PDF originale… · Mantieni solo nell'app per questo documento · Perché?
- Il popover di un'annotazione appare accanto all'annotazione (non più in un riquadro in fondo); con il tasto Tab ci si entra; Esc lo chiude.

#### 4.4 Da rivedere — Nuovi file

```
+--------------------------------------------------------------------------------------------------------------+
| Da rivedere                                                                        [+ Aggiungi PDF…]          |
| ( Nuovi file  3 ) ( Proposte di Claude  12 )                                                                  |
+--------------------------------------------------------------------------------------------------------------+
| DA AGGIUNGERE ALLA LIBRERIA (file trascinati da fuori)                                                        |
| +----------------------------------------------------------------------------------------------------------+ |
| | ▤ nome-file.pdf    → Proposta: "Autore 2024 - Titolo.pdf" in  Capitolo 2 / Fonti   [Cartella ▾]          | |
| |   Metadati: trovati (OpenAlex) · Possibile duplicato di "Titolo…" [Confronta]                              | |
| |   Tag proposti: [Ottica ✓] [Laser ✓] [+]                         [Ignora]  [Copia nella libreria ✓]       | |
| +----------------------------------------------------------------------------------------------------------+ |
| TROVATI DALLA SCANSIONE (già nella libreria: conferma metadati e tag)              [Segna tutti come visti]   |
| | ▤ Capitolo 1/nuovo.pdf     Metadati: trovati · Tag proposti: [Ottica]          [Più tardi] [Conferma]     | |
+--------------------------------------------------------------------------------------------------------------+
```

#### 4.5 Da rivedere — Proposte di Claude

```
+--------------------------------------------------------------------------------------------------------------+
| ( Nuovi file  3 ) ( Proposte di Claude  12 )     Filtra: [Tutte ▾]   Accettate finora: 84%   [Accetta pagina] [Rifiuta pagina] |
+--------------------------------------------------------------------------------------------------------------+
| ▸ Titolo del paper A                                                            [Apri] [Leggi]               |
|   Tag proposti   [Ottica ✓] [Laser ✓] [Fibra ✗]                    (A) Accetta  (R) Rifiuta  (E) Modifica    |
|   Descrizione    «Testo proposto…»                                  ── Generato dall'AI ──                   |
| ▸ Titolo del paper B …                                                                                       |
|                                                       ‹ Pagina 1 di 3 ›                                       |
+--------------------------------------------------------------------------------------------------------------+
```

Tasti nella vista: J/K voce successiva/precedente, A accetta la voce, R rifiuta, E modifica (dove ammesso), O apre la scheda. Solo fuori dai campi di testo.

#### 4.6 Impostazioni (home)

```
+------------------------+-------------------------------------------------------------------------------------+
| Impostazioni           |  Generale                                                                           |
| [ Cerca impostazioni ] |  ---------------------------------------------------------------------------------  |
|                        |  Lingua dell'interfaccia     [Italiano ▾]                                           |
|  ● Generale            |  Aspetto                     (Sistema | Chiaro | Scuro)                             |
|    Profilo             |  Guida                       [Mostra di nuovo i suggerimenti]  [Apri la guida F1]   |
|    Libreria            |  Informazioni                Research Lab 0.8.0 · [Copia informazioni]              |
|    Claude              |                                                                                     |
|    Backup        ⚠     |                                                                                     |
|    Scorciatoie         |                                                                                     |
|  ─────────────         |                                                                                     |
|    Sviluppatore /      |                                                                                     |
|    Avanzate            |                                                                                     |
+------------------------+-------------------------------------------------------------------------------------+
```

Ogni sezione salva da sola i campi semplici (interruttori, scelte) al cambio, con conferma "Salvato" accanto; i moduli con più campi validati (profilo, libreria) hanno un pulsante Salva fisso in fondo alla sezione, attivo solo se ci sono modifiche, e un avviso se si esce con modifiche non salvate.

#### 4.7 Impostazioni › Claude › Account Claude

```
+------------------------------------------------------------------------------------------------------------+
| Claude                                                                                                     |
| ┌ Account Claude ─────────────────────────────────────────────────────────────────────────────────────────┐ |
| │ ● Collegato con l'accesso di Claude Code                                                                 │ |
| │   Account: nome@example.org · piano Pro            (dai dati di `claude auth status`, se disponibili)   │ |
| │   Uso di questo mese (libreria "Tesi"): 0,42 $ su 5,00 $ · 37 invii             [Vedi il registro]      │ |
| │                                                                                                          │ |
| │   Usa:  (•) Automatico  ( ) Accesso di Claude Code  ( ) Chiave API                                       │ |
| │   [Prova la connessione]  [Cambia account…]  [Esci da Claude Code…]                                      │ |
| │                                                                                                          │ |
| │   Chiave API Anthropic:  non salvata            [Aggiungi chiave…]                                       │ |
| │   (salvata nell'archivio sicuro di Windows; mai mostrata, mai sincronizzata)                             │ |
| └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘ |
| ┌ Cosa può leggere Claude ─────────┐  ┌ Modello e spesa ─────────────────────────────────────────────────┐ |
| │ □ Tutta la libreria             │  │ Modello predefinito [Haiku 5.5 ▾]  Ragionamento [Basso ▾]        │ |
| │ ▸ ☑ Capitolo 1  ▸ □ Riservato   │  │ Tetto mensile [ 5,00 ] $        ☑ Chiedi conferma prima di inviare │ |
| └──────────────────────────────────┘  └──────────────────────────────────────────────────────────────────┘ |
| ▸ Registro degli invii (cosa è partito, quando, verso quale modello)                                       |
+------------------------------------------------------------------------------------------------------------+
```

#### 4.8 Impostazioni › Sviluppatore / Avanzate

```
+------------------------------------------------------------------------------------------------------------+
| Sviluppatore / Avanzate                                                                                    |
| Queste opzioni non servono per l'uso normale. Cambiarle può rendere l'app più lenta o meno sicura.         |
| ┌ Valori diversi dal predefinito (3) ────────────────────────────────────────────────────────────────────┐ |
| │ Eseguibile di Claude Code: scelto a mano  [Ripristina]   Porta MCP: 41234 [Ripristina]   …             │ |
| └────────────────────────────────────────────────────────────────────────────────────────────────────────┘ |
| ▸ Claude: fornitore, eseguibile di Claude Code, elenco modelli e prezzi, soglia di conferma dei lavori      |
| ▸ Server MCP per Claude Code: attiva, scrittura, porta, copia configurazione, nuovo token, registro        |
| ▸ Scansione: estensioni indicizzate, solo per nome, giorni prima di dimenticare i mancanti, ricostruisci indice |
| ▸ Annotazioni nel PDF: copie degli originali, spazio occupato, elimina le copie                           |
| ▸ Servizi online: chiave API di OpenAlex                                                                   |
| ▸ Esportazione: preset                                                                                     |
| ▸ Sperimentale: chiave Gemini (fornitore non ancora disponibile)                                           |
| ▸ Manutenzione e diagnostica: dimensioni, pulizia, log, diagnostica, memoria, processi attivi, id dispositivo |
+------------------------------------------------------------------------------------------------------------+
```

Ogni gruppo è un `<details>` chiuso per default (si apre se la ricerca o un link della tavolozza punta lì).

---

## 5. Sistema visivo

### 5.1 Carattere

Nessun font remoto (CSP). Pila: `"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif`; titoli con `"Segoe UI Variable Display"` in testa; monospazio `"Cascadia Mono", Consolas, ui-monospace, monospace`. Cifre tabellari (`font-variant-numeric: tabular-nums`) in conteggi, pagine, prezzi.

| Token | Dimensione / interlinea | Peso | Uso |
| --- | --- | --- | --- |
| `--fs-display` | 24 / 32 px | 600 | titolo della procedura guidata, stati vuoti |
| `--fs-title` | 20 / 28 px | 600 | titolo di vista (uno per vista) |
| `--fs-heading` | 16 / 24 px | 600 | titolo di sezione, di pannello, di dialogo |
| `--fs-body` | 14 / 21 px | 400 | testo, campi, pulsanti (500) |
| `--fs-small` | 13 / 19 px | 400 | righe dense, metadati, tooltip |
| `--fs-caption` | 12 / 16 px | 500 | etichette, badge, intestazioni di gruppo (maiuscoletto con `letter-spacing: .04em`) |

Niente testo sotto 12 px. Il maiuscolo continuo solo nelle etichette di gruppo da `--fs-caption`.

### 5.2 Colori (chiaro e scuro)

Tutti i valori sono token su `:root`; il tema scuro vale per `[data-theme="dark"]` e per `prefers-color-scheme: dark` se non è scelto `light` (come oggi, D-281). Contrasto misurato con la formula WCAG 2.x (script nel ramo di design): ogni token di testo ha almeno 4,5:1 sul fondo peggiore su cui è ammesso.

| Token | Chiaro | Scuro | Uso |
| --- | --- | --- | --- |
| `--bg` | `#F6F6F3` | `#131417` | fondo della finestra |
| `--surface` | `#FFFFFF` | `#1A1B1F` | pannelli, schede, campi |
| `--surface-2` | `#F0F0EC` | `#222328` | barra laterale, intestazioni, hover |
| `--surface-3` | `#E6E6E1` | `#2B2C32` | selezione neutra, premuto, fondo dei PDF |
| `--border` | `#DEDDD8` | `#34363D` | bordi (non testo: ≥ 1,3:1 voluto, decorativo) |
| `--border-strong` | `#C4C3BC` | `#4A4C55` | bordi dei campi (≥ 3:1 sul fondo, WCAG 1.4.11) |
| `--text` | `#1B1C1F` | `#ECECEF` | testo principale (min 13,6 / 11,8) |
| `--text-muted` | `#5A5D65` | `#A6A9B2` | testo secondario (min 5,3 / 5,9) |
| `--text-subtle` | `#62656D` | `#9599A3` | suggerimenti, segnaposto (min 4,7 / 4,9) |
| `--accent` | `#2B50C8` | `#8CA4FF` | pulsante primario, selezione, link (fondo) |
| `--on-accent` | `#FFFFFF` | `#0E1330` | testo su `--accent` (6,8 / 7,7) |
| `--accent-text` | `#2448B8` | `#9DB1FF` | link e testo accentato (min 6,2 / 6,7) |
| `--accent-soft` | `#E7ECFB` | `#232B4A` | riga selezionata, voce attiva della barra |
| `--focus` | `#2B50C8` | `#9DB1FF` | anello di fuoco 2 px + 2 px di distanza |
| `--danger` / `--danger-soft` | `#B42318` / `#FDECEA` | `#FF8B80` / `#3A1D1A` | errori, azioni distruttive (5,3 / 6,1 min) |
| `--warning` / `--warning-soft` | `#8A5300` / `#FDF1DC` | `#F2B755` / `#33270F` | avvisi (5,1 / 7,7) |
| `--success` / `--success-soft` | `#1B6E38` / `#E5F4EA` | `#6BD394` / `#16301F` | esito positivo (5,0 / 7,5) |
| `--info` | `#1F5FA8` | `#7FB3F5` | informazioni neutre (5,1 / 6,4) |
| `--ai` / `--ai-soft` | `#6B3FC0` / `#F0EAFB` | `#C3A6FF` / `#2B2240` | **tutto ciò che è generato dall'AI** (regola 5): bordo sinistro 3 px `--ai`, etichetta "Generato dall'AI" (5,4 / 6,8) |

Regole: il colore non è mai l'unico segnale (icona o testo accanto); `--accent` è riservato a un'azione primaria per area; il viola `--ai` solo per contenuto AI (mai decorativo), così si riconosce "a colpo d'occhio" (piano §5).

**Colori delle annotazioni** (sovrapposizione nell'app con `mix-blend-mode: multiply` in chiaro, `screen` al 35% in scuro; e valori scritti nel PDF in `/C`, RGB 0-1):

| Nome (`color`) | Schermo | `/C` nel PDF |
| --- | --- | --- |
| `yellow` | `#F7D046` | `[0.969 0.816 0.275]` |
| `green` | `#7BD389` | `[0.482 0.827 0.537]` |
| `blue` | `#7DB7F2` | `[0.490 0.718 0.949]` |
| `pink` | `#F29AC1` | `[0.949 0.604 0.757]` |
| `orange` | `#F6A85B` | `[0.965 0.659 0.357]` |

### 5.3 Spaziatura, raggi, elevazione, movimento

- Spaziatura (griglia da 4 px): `--sp-0: 0`, `--sp-1: 2px`, `--sp-2: 4px`, `--sp-3: 8px`, `--sp-4: 12px`, `--sp-5: 16px`, `--sp-6: 20px`, `--sp-7: 24px`, `--sp-8: 32px`, `--sp-9: 48px`. Le vecchie `--space-1..6` restano come alias (4, 8, 12, 16, 24, 32) finché tutte le viste non sono migrate, poi si tolgono.
- Altezze dei controlli: `--h-sm: 28px` (righe dense, chip), `--h-md: 32px` (pulsanti, campi), `--h-lg: 40px` (azione primaria di una procedura). Righe dei risultati: 36 px (elenco compatto) / 56 px (con frammento).
- Raggi: `--r-xs: 4px` (chip, badge), `--r-sm: 6px` (pulsanti, campi), `--r-md: 10px` (schede, pannelli, popover), `--r-lg: 14px` (dialoghi), `--r-pill: 999px`.
- Elevazione (chiaro / scuro):
  - `--e-0`: nessuna (contenuto nel flusso; si separa con `--border`).
  - `--e-1`: `0 1px 2px rgb(20 22 28 / .06), 0 1px 1px rgb(20 22 28 / .04)` / `0 1px 2px rgb(0 0 0 / .5)` — schede, barra strumenti flottante.
  - `--e-2`: `0 4px 16px rgb(20 22 28 / .12)` / `0 6px 20px rgb(0 0 0 / .55)` — popover, menu, toast.
  - `--e-3`: `0 12px 40px rgb(20 22 28 / .20)` / `0 16px 48px rgb(0 0 0 / .65)` — dialoghi, tavolozza.
  - Scrim dei dialoghi: `rgb(15 17 22 / .40)` / `rgb(0 0 0 / .60)`.
- Movimento: `--dur-fast: 120ms`, `--dur: 180ms`, `--ease: cubic-bezier(.2,.0,.0,1)`; solo opacità e trasformazioni; con `prefers-reduced-motion: reduce` tutte le durate a 0 (la regola esiste già).
- Larghezze: barra laterale 232 / 56 px; pannello di dettaglio 360 px (300-480); pannello Claude 380 px (320-560); testo lungo max 72 caratteri; pagine di impostazioni max 760 px di contenuto.

### 5.4 Icone

- Insieme proprio di **~36 icone SVG in linea** in `components/icons.tsx` (funzioni React senza dipendenze): griglia 24, tratto 1,75 px, `stroke="currentColor"`, angoli arrotondati; dimensioni 16 (in riga), 20 (barre), 24 (stati vuoti). Disegni derivati da Lucide (licenza ISC: si copia la nota di licenza in testa al file; nessun pacchetto npm).
- Divise in due moduli per la leggerezza: `icons-shell.tsx` (le ~12 della prima schermata: libreria, da rivedere, progetti, scopri, mappa, claude, aiuto, impostazioni, indietro, avanti, cerca, comando) e `icons.tsx` (il resto, caricato con le viste).
- Elenco: library, inbox-review, folder, folder-open, tag, project, discover, map, claude (scintilla), help, settings, back, forward, search, command, plus, close, chevron, more, check, alert, info, error, sync/scan, backup, export, read (libro), highlight (pennarello), underline, eraser, cursor (seleziona), comment, page, pdf-written, lock, external, trash, undo.
- Ogni pulsante con sola icona ha `aria-label` e tooltip con il tasto, se esiste.

### 5.5 Componenti (inventario minimo)

In `components/ui.tsx` (già esiste per i campi) e `components/`:

| Componente | Varianti | Note |
| --- | --- | --- |
| `Button` | `primary`, `secondary` (predefinito), `ghost`, `danger`; `sm`/`md`/`lg`; con icona | uno solo `primary` per area |
| `IconButton` | `ghost`, `secondary`; `aria-label` obbligatorio | tooltip col tasto |
| `Segmented` | 2-5 opzioni | sostituisce `radio-chip` e i `toggle on` |
| `Tabs` | sottolineate | `role=tablist`, frecce per muoversi |
| `Chip` | filtro (rimovibile), stato, tag (col colore del nodo) | |
| `Badge` | numero (`--accent`), avviso (`--warning`), AI (`--ai`) | solo per §7 |
| `Card` / `Panel` | con intestazione, azioni, corpo scorrevole | pannello di dettaglio unico (`DetailPanel`) |
| `Popover` / `Menu` | ancorati, chiusi con Esc e clic fuori, trappola del fuoco nei menu | nessuna libreria: ~2 KiB |
| `Banner` | info, avviso, errore; azione primaria + chiudi | nel flusso, mai sopra altri controlli (D-305) |
| `Toast` | info, errore; azione (Annulla) | regione `aria-live` |
| `Dialog` | normale, conferma distruttiva | già esiste (`Dialog.tsx`) |
| `EmptyState` | icona 24, titolo, testo, azione | ogni vista vuota ne ha uno |
| `Kbd` | | tasti mostrati uguali ovunque |

### 5.6 Organizzazione del CSS

`styles.css` (2556 righe, tutto nel primo caricamento) si divide in: `styles/tokens.css` + `styles/base.css` + `styles/shell.css` (prima schermata) e un file per vista importato dal suo modulo pigro (`views/library/library.css`, `views/reader/reader.css`, `views/review/review.css`, `settings/settings.css`, …): Vite li mette nei chunk delle viste. Nessun colore letterale fuori da `tokens.css` (controllo con una regola grep in `check:generality` o un test: `#[0-9a-f]{3,6}` vietato fuori dai token, eccetto le icone).

---

## 6. Impostazioni: nuova struttura e mappa completa

### 6.1 Sezioni

| Sezione (`SettingsSectionId`) | Per chi | Contenuto |
| --- | --- | --- |
| `general` Generale | tutti | lingua interfaccia, tema, guida e suggerimenti, informazioni (versione, copia informazioni) |
| `profile` Profilo | tutti | nome, varianti come autore, email, ORCID, id OpenAlex, invio dell'email a OpenAlex |
| `library` Libreria | tutti | elenco librerie (attiva, rinomina, dimentica, nuova); per la libreria attiva: nome, lingua dei documenti, cartella radice (sola lettura), cartelle escluse, scansione (ultima, scansiona ora), **annotazioni nel PDF** |
| `claude` Claude | tutti | Account Claude (§10), cosa può leggere, modello e ragionamento predefiniti, tetto mensile, conferma prima di inviare, registro degli invii |
| `backup` Backup | tutti | cartella, cadenza, quanti tenere, includi dati locali, esegui ora, elenco, verifica, ripristina, apri file |
| `shortcuts` Scorciatoie | tutti | editor esistente (globali, lettore, strumenti del lettore) |
| `advanced` Sviluppatore / Avanzate | esperti | tutto il resto (sotto) |

La voce `backup` mostra ⚠ nella sottonavigazione se l'ultimo backup ha più di 30 giorni o l'ultimo automatico è fallito.

### 6.2 Mappa vecchio → nuovo (ogni impostazione)

Fonte: `packages/core/src/settings.ts` (`AppSettings`, `LibraryConfig`), segreti in `settings/*Section.tsx`, canali `ai:*`, `mcp:*`, `backup:*`, `maintenance:*`.

| Impostazione (campo / canale) | Dove oggi | Dove va | Note |
| --- | --- | --- | --- |
| `uiLanguage` | barra laterale + Profilo | Generale | anche tavolozza "Cambia lingua" |
| `appearance.theme` | Profilo | Generale | `Segmented` Sistema/Chiaro/Scuro |
| `guide.welcomeSeen`, `guide.dismissedTips` | nascosti | Generale › "Mostra di nuovo i suggerimenti" | azzera entrambi |
| versione (`app:info`) | barra di stato | Generale › Informazioni | |
| `firstRunDone` | nascosto | resta nascosto | interno |
| `deviceId` | nascosto | Avanzate › Diagnostica (sola lettura) | |
| `user.name`, `user.authorVariants`, `user.email`, `user.orcid`, `user.openAlexId` | Profilo | Profilo | |
| `network.openAlexEmail` | Rete | Profilo (sotto l'email) | è una scelta di privacy sull'email |
| segreto `openalex-api-key` (app) | Rete | Avanzate › Servizi online | |
| `libraries[]` (attiva, rinomina, dimentica, nuova) | Librerie | Libreria › Le tue librerie | anche dal selettore |
| `libraries[].rootPath` | non mostrato | Libreria (sola lettura) + "Apri cartella" | |
| `libraries[].dataDirName` | non mostrato | Avanzate › Scansione (sola lettura) | |
| `activeLibraryId` | selettore | selettore | |
| `name` (library.json) | Libreria | Libreria | |
| `language` (library.json) | Libreria | Libreria | |
| `excludedFolders` | Libreria | Libreria › Cartelle escluse | |
| `scan.extensions` | non esposto | Avanzate › Scansione | nuovo controllo (elenco di estensioni) |
| `scan.nameOnlyExtensions` | non esposto | Avanzate › Scansione | nuovo |
| `scan.pruneDeletedDays` | non esposto | Avanzate › Scansione | nuovo |
| ricostruisci indice (`scan:start {full}`) | barra della libreria | Avanzate › Scansione | con spiegazione |
| scansiona ora (`scan:start`) | barra della libreria | chip Attività + Libreria › Scansione | |
| `exportPresets[]` | Libreria | Avanzate › Esportazione | il dialogo di export resta il posto dove si usano |
| `aiEnabledFolders` | Claude | Claude › Cosa può leggere | |
| `ai.confirmBeforeSend` | Claude | Claude › Modello e spesa | |
| `ai.defaultModel`, `ai.defaultReasoning` | Claude | Claude › Modello e spesa | |
| `ai.usageCap.monthlyUsd` | Claude | Claude › Modello e spesa | |
| `ai.usageCap.confirmBatchAboveUsd` | Claude | Avanzate › Claude | |
| `ai.models[]` (id, etichetta, prezzi) | Claude | Avanzate › Claude | i prezzi oggi non sono modificabili: si aggiungono i due campi |
| `ai.provider` | non modificabile (solo mostrato) | Avanzate › Claude (sola lettura + "Gemini: non disponibile") | |
| `ai.claudeCodePath` (`ai:chooseExecutable`, `ai:clearExecutable`) | Claude › Stato | Avanzate › Claude, e link "Cambia eseguibile" nell'Account | |
| **nuovo** `ai.authMode` | — | Claude › Account | §10 |
| segreto `anthropic-api-key` (app) | Claude | Claude › Account | |
| stato AI (`ai:status`) | Claude | Claude › Account + intestazione del pannello Claude | |
| registro invii (`ai:log`) | Claude | Claude › Registro degli invii | privacy: resta tra le normali |
| uso del mese (`ai:usage`) | contatore della chat | Claude › Account + chat | |
| segreto `gemini-api-key` (libreria) | Chiavi | Avanzate › Sperimentale | il fornitore non esiste ancora |
| `mcp.enabled` (`mcp:setEnabled`) | MCP | Avanzate › Server MCP | |
| `mcp.writeEnabled` | MCP | Avanzate › Server MCP | conferma come oggi |
| porta MCP (`mcp:setPort`) | MCP | Avanzate › Server MCP | |
| copia configurazione, nuovo token, registro MCP | MCP | Avanzate › Server MCP | |
| `backup.destination`, `backup.auto`, `backup.keep` | Backup | Backup | `keep` in "Opzioni" chiuse |
| includi dati locali | Backup | Backup › Opzioni | |
| backup ora, elenco, verifica, ripristina, apri file, rimuovi | Backup | Backup | |
| `shortcuts[]` | Scorciatoie | Scorciatoie | + scope `reader-tool` |
| manutenzione: dimensioni, memoria, processi | Manutenzione | Avanzate › Manutenzione e diagnostica | |
| pulizia (`maintenance:clean`) | Manutenzione | Avanzate › Manutenzione e diagnostica | |
| log, copia diagnostica | Manutenzione | Avanzate › Manutenzione e diagnostica | |
| **nuovo** `annotations.writeToPdf` (library.json) | — | Libreria › Annotazioni nel PDF | predefinito attivo (D-316) |
| **nuovo** `annotations.author` (library.json) | — | Libreria › Annotazioni nel PDF | `profile` (predefinito) o `none` |
| **nuovo** copie degli originali (spazio, elimina) | — | Avanzate › Annotazioni nel PDF | |
| variabili `RL_*` di sviluppo | — | non sono impostazioni | restano solo d'ambiente (D-014); non mostrate |
| limiti dei worker (`idleCloseMs`) e budget | costanti | Avanzate › Diagnostica, **sola lettura** | non diventano impostazioni (nessun bisogno dell'utente; evita configurazioni rotte) |

"Valori diversi dal predefinito" in cima ad Avanzate: confronto puro con `defaultAppSettings()` / `defaultLibraryConfig()` sui campi elencati come avanzati; ogni riga ha "Ripristina" (una patch con il valore predefinito, o il canale dedicato per percorsi e porta).

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

### 7.2 Il popover Attività (centro notifiche)

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

### 8.2 Annotazione per strumento

**Strumenti** (uno attivo alla volta; lo stato è per finestra, si ricorda tra un documento e l'altro nella sessione):

| Strumento | Tasto | Comportamento |
| --- | --- | --- |
| Seleziona (`select`) | V | selezione del testo come oggi (copia); clic su un'annotazione la seleziona; con testo selezionato appare un mini popover "Evidenzia / Sottolinea" (percorso compatibile: `ann-highlight` resta) |
| Evidenzia (`highlight`) | H | trascinare sul testo → al rilascio si crea subito un'evidenziazione col colore corrente, senza barre di conferma; la selezione si cancella |
| Sottolinea (`underline`) | U | come sopra, sottolineatura |
| Gomma (`eraser`) | E | clic su un'annotazione la elimina (toast con Annulla); trascinare cancella quelle toccate |
| Colore | 1…5 | sceglie il colore corrente; se un'annotazione è selezionata ne cambia il colore |
| Commento | C | con un'annotazione selezionata apre il campo commento nel popover |
| Alterna pennello | Spazio | scambia lo strumento corrente con il precedente (vedi sotto) |

**Spazio:**
- scambia `tool` e `previousTool` (all'inizio `previousTool = highlight`), quindi Seleziona ↔ ultimo pennello, oppure Evidenzia ↔ Sottolinea se sono gli ultimi due usati; mostra per 1 s una piccola etichetta "Sottolinea" vicino alla barra strumenti (anche `aria-live`);
- **nei campi di testo** (numero di pagina, ricerca, commento, note, chat, qualsiasi `input`/`textarea`/`contenteditable`): scrive uno spazio, nessuno scambio (`skipInText`);
- **durante un trascinamento** (pulsante del mouse premuto): ignorato; lo scambio vale dal tratto successivo;
- **ripetizione automatica** (tasto tenuto giù, `event.repeat`): ignorata, un solo scambio per pressione;
- **scorrimento:** nel lettore Spazio non scorre più la pagina (si impedisce il comportamento del browser); per scorrere restano rotella, PagSu/PagGiù, frecce, N/P (pagina successiva/precedente), J/K. Maiusc+Spazio non fa nulla (riservato);
- con un dialogo, la tavolozza o un popover aperto: nessun effetto.

**Altri tasti:** Esc risale una catena: annulla il tratto in corso › chiude il popover › deseleziona › torna a Seleziona › chiude la ricerca. **Esc non chiude più il lettore** (oggi sì: troppo facile perderlo per sbaglio); si chiude con ×, Alt+← o Ctrl+W. Ctrl+Z / Ctrl+Y annullano e ripetono la creazione, modifica ed eliminazione di annotazioni (si appoggia a `history` se le annotazioni vi entrano, altrimenti una pila locale del lettore per la sessione). Ctrl+F ricerca, Ctrl+Maiusc+H / U evidenzia o sottolinea il risultato della ricerca (come oggi).

**Tasti personalizzabili:** i tasti singoli richiedono un nuovo scope `reader-tool` in `@rl/core` `shortcuts.ts` (e nella copia `shortcutDefs.ts`): in questo scope `normalizeAccelerator` accetta anche un tasto senza modificatori (lettere, cifre, `Space`); i conflitti si controllano solo dentro lo scope e con `reader`. Id: `reader.tool.select` (V), `reader.tool.highlight` (H), `reader.tool.underline` (U), `reader.tool.eraser` (E), `reader.tool.swap` (Space), `reader.color.1..5` (1-5), `reader.comment` (C). N/P/J/K restano fissi come oggi.

**Barra strumenti flottante** (`reader-toolbar`, `role="toolbar"`, frecce per muoversi tra i pulsanti): centrata in alto sull'area delle pagine, 40 px, `--e-1`, sfondo `--surface` al 92%; si sposta al bordo sinistro in verticale se il pannello è stretto (< 560 px). Pulsanti: Seleziona, Evidenzia, Sottolinea, Gomma | 5 colori (`ann-color-*`) | [?] tasti. Lo strumento attivo ha `aria-pressed="true"` e fondo `--accent-soft`. Cursore: `text` con Evidenzia/Sottolinea, `default` con Seleziona, `pointer` con Gomma su un'annotazione (niente cursori in `data:` URI, la CSP non li prevede).

**Macchina a stati** (`views/reader/toolMachine.ts`, pura e testata):

```
Stati:  Idle{tool, prev, color}
        Stroking{tool, color, startedOn: page}          (pulsante premuto con un pennello o gomma)
        Selected{tool, prev, color, annId}              (annotazione selezionata, popover aperto)
        Commenting{…Selected, draft}                    (campo commento con il fuoco)

Idle      --key V/H/U/E-->           Idle{tool=X, prev=tool se X≠tool}
Idle      --Space (non in campo, non repeat)--> Idle{tool=prev, prev=tool}
Idle      --pointerdown su testo, tool∈{H,U}--> Stroking
Idle      --pointerdown, tool=E--> Stroking (cancella ciò che tocca)
Idle      --click su annotazione, tool=V--> Selected
Stroking  --pointerup con selezione non vuota--> crea annotazione(tool,color) → Idle
Stroking  --pointerup senza testo--> Idle (nulla)
Stroking  --Esc--> annulla il tratto → Idle
Stroking  --Space--> ignorato
Selected  --1..5--> cambia colore → Selected
Selected  --C--> Commenting
Selected  --Canc / Backspace--> elimina (toast Annulla) → Idle
Selected  --Esc o clic fuori--> Idle
Commenting--Invio / blur--> salva commento → Selected
Commenting--Esc--> salva se cambiato (come D-199) → Selected
qualsiasi --cambio documento--> Idle (tool e colore restano)
```

La creazione usa il percorso di oggi (`viewer.readSelection()` → `annotations:save`), quindi le regole di D-188/D-198/D-199 (limiti, pagine multiple, errori) non cambiano.

### 8.3 Scrittura delle annotazioni nel PDF originale (decisione dell'utente)

> Decisione dell'utente (2026-11-17, riportata dal coordinatore): «highlights and underlines must be WRITTEN INTO THE ORIGINAL PDF so they show in Chrome and other readers». Cambia la regola assoluta 1 solo per questo caso (D-316). **Area sensibile per la sicurezza:** revisione indipendente e security obbligatorie.

#### 8.3.1 Regola

Gli originali non si spostano, non si rinominano, non si cancellano e il loro contenuto non si altera mai; l'unica scrittura ammessa è l'**aggiunta incrementale** di oggetti di annotazione PDF standard creati da un gesto esplicito dell'utente nel lettore: `/Highlight`, `/Underline` (in futuro `/StrikeOut`), con il commento nel campo `/Contents` dell'annotazione stessa (gli altri lettori lo mostrano come popup); niente `/Text` né `/Popup` separati (le note per pagina restano Markdown nell'app: sono lunghe e non hanno una posizione). Testo nuovo per `docs/RULES.md` e `CLAUDE.md` in questo ramo.

#### 8.3.2 Cosa si scrive

Per ogni annotazione dell'app (`Annotation`):

```
N 0 obj
<< /Type /Annot /Subtype /Highlight            % o /Underline
   /Rect [x1 y1 x2 y2]                         % riquadro dei quadrilateri, spazio utente della pagina
   /QuadPoints [ … 8 numeri per rettangolo … ]  % ordine: in alto a sinistra, in alto a destra, in basso a sinistra, in basso a destra
   /C [r g b]  /CA 1                            % colore da §5.2
   /P <ref della pagina>  /F 4                  % stampabile
   /NM (rl-<annotationId>)                      % nome unico: lega l'oggetto all'annotazione dell'app
   /T (<nome dal profilo>)                      % solo se annotations.author = 'profile' e il nome esiste
   /Contents (<commento>)                       % solo se c'è un commento; stringa UTF-16BE con BOM se non ASCII
   /CreationDate (D:…) /M (D:…)
   /AP << /N M 0 R >>                           % aspetto: Chrome/PDFium e Preview lo usano
>>
M 0 obj  % Form XObject: per Highlight quadrilateri pieni con /ExtGState /BM /Multiply; per Underline una linea (spessore = 1/14 dell'altezza, min 0,5 pt) sotto ogni rettangolo
```

Conversione delle coordinate: i rettangoli dell'app sono normalizzati 0..1 con origine in alto a sinistra **della pagina come la mostra pdf.js** (dopo `/Rotate` e sul `CropBox`). Si convertono con la matrice della vista di pdf.js inversa: `CropBox` (o `MediaBox`), `/Rotate` (0/90/180/270) e `/UserUnit`. La funzione è pura (`toPdfQuads(rects, pageGeom)`) e testata con le quattro rotazioni e un `CropBox` spostato.

#### 8.3.3 Come si scrive (aggiornamento incrementale)

Scrittore proprio in `packages/data/src/pdf-annot/` (solo Node, nessuna dipendenza nuova; `node:zlib` per gli stream compressi):

1. **Lettura della coda:** `startxref` dagli ultimi 1024 byte; tabella xref classica o stream xref (`/W`, `/Index`, `/Prev`, catena completa; flate con predittore PNG 12 come nelle xref stream); stream di oggetti (`/ObjStm`) per gli oggetti compressi. Lettura ad accesso casuale con `fh.read` (mai tutto il file in memoria).
2. **Controlli di rifiuto** (risposta `refused` con motivo, l'annotazione resta nell'app): `/Encrypt` nel trailer (`encrypted`); campi firma con `/V` o `/SigFlags` con bit 1, `/Perms` (`signed`); `/XFA` nell'`/AcroForm` (`xfa`); xref illeggibile, `startxref` assente, oggetto pagina non trovato, generazioni incoerenti, dati dopo l'ultimo `%%EOF` che non sono spazi (`damaged`); file con attributo sola lettura (`read-only`); oltre `PDF_WRITE_LIMITS.maxBytes` = 512 MiB (`too-large`); più di `PDF_WRITE_LIMITS.maxRevisions` = 200 revisioni nostre (`too-many-revisions`); pagina con `/Annots` non risolvibile (`damaged`). Documento non PDF o fuori dalla libreria: mai considerato.
3. **Costruzione dell'aggiornamento:** oggetti nuovi con numeri da `/Size`; per ogni pagina toccata, la pagina riscritta con lo **stesso numero e generazione** e `/Annots` aggiornato (se `/Annots` è un riferimento indiretto a un array, si riscrive quell'array); eliminazione = la pagina senza il riferimento + voce `f` nell'xref per l'annotazione e il suo aspetto (generazione +1); modifica (colore, tipo, commento, rettangoli) = nuova versione dello stesso oggetto. Nuova sezione xref dello **stesso tipo** dell'ultima (tabella classica se l'ultima lo era; stream xref non compresso con `/Type /XRef` altrimenti), con `/Prev` all'xref precedente, `/Root`, `/Info` e `/ID` (primo elemento invariato, secondo nuovo) copiati; `startxref` e `%%EOF`. I byte esistenti non si toccano: **il file originale resta un prefisso esatto**.
4. **Scrittura atomica:** `copyFile(originale → temporaneo nella stessa cartella, nome nascosto `.<nome>.rl-<rand>.tmp`)`, `appendFile(aggiornamento)`, `fsync`; **verifica** del temporaneo nel worker (pdf.js lo apre, stesso numero di pagine, le annotazioni nuove ci sono con i riferimenti attesi, nessuna eccezione); **ricontrollo** che l'originale abbia ancora dimensione, `mtime` e hash del prefisso letti al passo 1 (TOCTOU, stesso spirito di D-200); `rename(temporaneo → originale)` con nuovi tentativi su `EPERM`/`EBUSY`/`EACCES` (200, 600, 1500 ms, come `atomicWriteJson`); in caso di errore il temporaneo si cancella. Il temporaneo è l'unico altro file mai creato nella cartella della libreria, e vive pochi istanti.
5. **Copia di sicurezza prima della PRIMA scrittura di ogni file:** `<dataDir>/pdf-originals/<docId>-<hash8>.pdf` con il suo SHA-256 registrato nel record (`pdfWrite.base`). Scrittura atomica, confinata con `resolveInRoot`. Si fa una volta per contenuto (se il contenuto originale cambia davvero, nuova copia).
6. **File aperto in un altro programma:** se la rinomina fallisce dopo i tentativi, stato `pending` con motivo `locked`; nuovi tentativi alla chiusura del lettore, al ritorno del fuoco sulla finestra, alla modifica successiva e all'avvio; mai un ciclo di polling. Dopo 10 minuti di `pending`, banner nel lettore e riga nel popover Attività.
7. **Quando si scrive:** non a ogni clic. L'annotazione si salva subito nell'app (come oggi, veloce e sicuro); la scrittura nel PDF si fa a **lotti**: 4 s dopo l'ultima modifica, alla chiusura del lettore, al cambio di documento o di libreria, alla chiusura dell'app (attesa massima 5 s, poi resta `pending` e riparte all'avvio). Un lotto = una revisione incrementale (pochi KiB). Una coda per documento serializza i lotti (la stessa coda di `annotations:save`, D-188).
8. **Dopo la scrittura:** il record del documento aggiorna `hash` (hash attuale del file) e aggiunge l'hash a `pdfWrite.own`; le annotazioni ricevono `pdf: { objNum, gen, rev }`; evento `library:changed` con `kind: 'annotations'` e `pdfWrite:progress` per il chip.

#### 8.3.4 Identità del documento

Oggi molte cose dipendono dall'hash del contenuto: id del documento (D-006, stabile), `hash` e `previousHashes` del record, `forHash` delle annotazioni (annotazioni "non allineate"), URL `rl-doc://…?v=<hash8>`, miniature (`rl-thumb://…?v=<hash8>`), cache del testo estratto, cache dell'AI, input del grafo, duplicati della cartella di arrivo, criterio della fase 3 "hash identico".

Regola: **si distingue l'hash del file dall'hash del contenuto.**

- `hash` resta l'hash del file attuale (serve a versionare `rl-doc`, a riconoscere il file nella scansione).
- Nuovo `pdfWrite` nel record (`documents/<id>.json`, sincronizzato):
  ```ts
  pdfWrite?: {
    base: { hash: Sha256; size: number };            // il contenuto: i byte prima della nostra prima aggiunta
    own: Array<{ hash: Sha256; size: number; at: IsoDate }>; // file prodotti dalle nostre scritture, gli ultimi 20
    backup?: { file: RelativePath; hash: Sha256 };   // copia in pdf-originals/
  }
  ```
- Funzione in `@rl/core`: `contentHashOf(doc) = doc.pdfWrite?.base.hash ?? doc.hash`. **Tutti** i consumatori legati al contenuto passano a `contentHashOf`: miniature, cache del testo, cache AI, `forHash` delle annotazioni (confronto), input del grafo, duplicati della cartella di arrivo (che confrontano anche `hash`, `previousHashes` e gli hash di `own`).
- **Regola dell'aggiunta (scanner):** quando la scansione o l'osservatore trova un file con dimensione/`mtime` cambiati:
  1. se il nuovo hash è in `pdfWrite.own` → è una nostra scrittura: aggiorna `hash`, nessun "cambiato", niente estrazione;
  2. altrimenti, se il file è **cresciuto** e lo SHA-256 dei primi `vecchia dimensione` byte è uguale al vecchio `hash` (o i primi `base.size` byte danno `base.hash`) → è un **aggiornamento incrementale** (nostro su un'altra macchina prima che arrivi il record sincronizzato, oppure di Acrobat o un altro programma): `pdfWrite.base` = il vecchio contenuto se non c'era, `hash` aggiornato; per prudenza si **rilegge il testo** e, se il testo estratto differisce dalla cache, si tratta come contenuto cambiato (un altro programma potrebbe aver modificato il testo con un aggiornamento incrementale);
  3. altrimenti → contenuto cambiato davvero (logica di oggi: `previousHashes`, annotazioni non allineate, `pdfWrite` azzerato e la copia di sicurezza resta finché l'utente non la toglie).
  Il costo è un hash del prefisso, lo stesso di un hash completo, solo per i file cambiati.
- Il criterio della fase 3 diventa: con `writeToPdf` spento l'hash del PDF resta identico; con `writeToPdf` acceso i byte originali sono un prefisso esatto del file e `contentHashOf` non cambia (test in `study-data.spec.ts` e `check-nondestructive.mjs --allow-pdf-append`, che accetta solo file cresciuti con prefisso identico e un'annotazione nostra registrata).

#### 8.3.5 Sincronia app ↔ PDF

- **Fonte di verità:** il file `annotations/<docId>.json` dell'app (veloce, con commenti, colori e testo). Il PDF ne è una proiezione per gli altri lettori. Ogni annotazione dell'app ha `pdf?: { objNum, gen, rev }` quando è stata scritta.
- **Modifica/eliminazione nell'app** → nuovo lotto che riscrive o toglie l'oggetto (§8.3.3 punto 3).
- **Annotazioni di altri programmi** (oggetti senza `/NM` che inizia con `rl-`, o con `objNum` non nostro): il lettore le legge con pdf.js (`page.getAnnotations()`, solo per le pagine visibili) e le elenca nel pannello "Dal PDF (altri programmi)" in sola lettura, con tipo, pagina, autore (`/T`) e testo (`/Contents`, mostrato come testo puro). pdf.js le disegna già nel canvas. Azione futura (onda 5, facoltativa): "Importa nell'app" → crea un'annotazione dell'app legata a quell'oggetto.
- **Doppio disegno:** le nostre annotazioni già scritte comparirebbero due volte (canvas di pdf.js + sovrapposizione dell'app). Si nascondono dal canvas marcandole `noView` nell'`annotationStorage` di pdf.js per i riferimenti noti (da verificare nello spike S2 su pdfjs-dist 6.5; ripiego: `annotationMode` che non disegna le annotazioni con `/NM` `rl-` tramite il filtro dell'`AnnotationLayer`).
- **Annotazioni già fatte nell'app (migrazione):** **mai** scritte in silenzio tutte insieme. Nel lettore, un documento con annotazioni solo nell'app mostra nel chip "PDF: 12 solo nell'app ▾ · Scrivile nel PDF"; in Impostazioni › Libreria › Annotazioni nel PDF c'è "Scrivi nei PDF le annotazioni esistenti (N documenti)…" con dialogo di conferma (numero di file, spazio stimato delle copie di sicurezza) e avanzamento nel popover Attività (lavoro annullabile, un file alla volta). Le annotazioni non allineate (`staleIds`) non si scrivono mai.
- **Primo uso:** la prima volta che una libreria scrive in un PDF, un banner nel lettore spiega: "Le evidenziazioni ora si salvano anche dentro il PDF, così le vedi in Chrome e negli altri lettori. Il testo del PDF non cambia e puoi ripristinare l'originale. [Impostazioni] [Ho capito]".

#### 8.3.6 Ripristino ("Annulla scritture nel PDF")

Nel menu del chip PDF e in Avanzate (per tutti i documenti): **Ripristina il PDF originale…** Dialogo: "Il file tornerà esattamente com'era prima delle evidenziazioni scritte da Research Lab. Le evidenziazioni restano nell'app. Le annotazioni fatte nel frattempo da altri programmi in questo file andranno perse." Esecuzione: temporaneo = primi `base.size` byte; verifica SHA-256 = `base.hash`; se non coincide si usa la copia in `pdf-originals/` (verificata col suo hash); rinomina atomica; il documento passa a `pdfMode: 'app-only'` (override per documento, così non riscrive subito); annotazioni senza `pdf`. Se le annotazioni di altri programmi erano presenti, il dialogo le conta e lo dice.

#### 8.3.7 Impostazioni

- `library.json` › `annotations: { writeToPdf: boolean (predefinito true), author: 'profile' | 'none' (predefinito 'profile') }` (sincronizzato: la stessa libreria si comporta allo stesso modo su ogni computer).
- Override per documento nel file delle annotazioni: `pdfMode?: 'app-only'` (dal ripristino o da "Mantieni solo nell'app per questo documento").
- Spegnere `writeToPdf` non cancella nulla dai PDF: chiede "Vuoi anche ripristinare gli originali già modificati (N)?" con le due scelte.

#### 8.3.8 Contratti (`@rl/core`, da scrivere dall'agente principale prima dell'onda 4)

```ts
// model/document.ts (additivo)
pdfWrite: pdfWriteSchema.optional()                 // §8.3.4
export function contentHashOf(d: Pick<DocumentRecord,'hash'|'pdfWrite'>): string

// model/annotation.ts (additivo)
annotationSchema.extend({ pdf: z.object({ objNum: int>0, gen: int>=0, rev: sha256 }).optional() })
annotationFileSchema.extend({ pdfMode: z.enum(['app-only']).optional() })

// settings.ts (additivo, con default)
libraryConfig.annotations = { writeToPdf: boolean = true, author: 'profile'|'none' = 'profile' }

// limits.ts
PDF_WRITE_LIMITS = { maxBytes: 512 MiB, maxRevisions: 200, batchDelayMs: 4000, lockedBannerMs: 600000, ownHashes: 20 }

// ipc/channels/annotations.ts (nuovi canali)
'annotations:pdfState'  { docId } → { mode: 'write'|'app-only'|'off', state: 'synced'|'pending'|'writing'|'refused'|'none',
                                     reason?: 'encrypted'|'signed'|'xfa'|'damaged'|'read-only'|'too-large'|'too-many-revisions'|'locked'|'changed',
                                     appOnly: number /* annotazioni non scritte */, external: number, lastWrittenAt?: IsoDate }
'annotations:writeNow'  { docId } → pdfState                       // scrive il lotto in attesa o le annotazioni solo nell'app
'annotations:setPdfMode'{ docId, mode: 'write'|'app-only' } → pdfState
'annotations:restoreOriginal' { docId } → { restored: boolean, droppedExternal: number }
'annotations:migrate'   { } → { jobId }                            // tutta la libreria; avanzamento con l'evento sotto
'annotations:migrateCancel' { jobId } → {}
evento 'annotations:pdfProgress' { docId?, jobId?, state, reason?, done?, total? }
```

Errori: `PERMISSION_DENIED` con `details.reason` per i rifiuti, `CONFLICT` (`changed`) se il file è cambiato tra lettura e rinomina.

#### 8.3.9 Dipendenze: scrittore proprio contro librerie

| Opzione | Peso | Aggiornamento incrementale (prefisso intatto) | Esito |
| --- | --- | --- | --- |
| **Scrittore proprio** in `packages/data/src/pdf-annot/` (parser di oggetti, xref classica e stream, stream di oggetti, scrittore, aspetti) | stimato 30-45 KiB non minificati nel main (D-177), ~1500 righe con i test | sì, per costruzione | **scelto** |
| pdf-lib 1.17 | ~700 KiB non minificati, non mantenuto dal 2021 | no: riscrive il file intero (il fork con salvataggio incrementale non è mantenuto) | scartato: viola "prefisso intatto" |
| `saveDocument()` di pdf.js (già presente nel main) | 0 KiB in più | sì | scartato come motore principale: crea solo `/Highlight` (non `/Underline`), il formato serializzato degli editor è interno e cambia tra versioni, e richiede di caricare il documento intero nel worker. Resta come **verificatore** (apre il risultato) |
| muhammara (ex HummusJS) | binario nativo ~10 MB | sì | scartato: nativo, peso, superficie d'attacco |

Budget: il main ha ~1 KiB di margine (1009/1010); **si alza a 1060 KiB** (D-319) per lo scrittore e i contratti nuovi (account, rapporto di scansione). Funzione utile chiesta dall'utente: la regola "la funzionalità viene prima della leggerezza" vale.

#### 8.3.10 Sicurezza (per le revisioni)

- Il parser legge **dati ostili**: limiti su profondità di annidamento (64), lunghezza di stringhe e nomi (64 KiB), numero di oggetti per stream di oggetti (100 000), dimensione decompressa degli stream (64 MiB, con `maxOutputLength` di zlib), catene `/Prev` (al massimo 1000, con rilevamento di cicli); tempo massimo per file (10 s, nel worker con il watchdog esistente).
- Nessun percorso dal renderer: solo `docId`; percorso risolto nel main con `resolveInRoot` e ricontrollato (D-200) prima della rinomina.
- Testo scritto nel PDF (`/Contents`, `/T`) codificato come stringa PDF con escape di `(`, `)`, `\` o in esadecimale; mai interpolato come sintassi.
- Prove con il corpus ostile (`security-hostile-scan.spec.ts`): file troncati, xref ciclici, stream bomba, `/Annots` ricorsivo, oggetti pagina mancanti.
- `check:nondestructive` aggiornato (prefisso intatto e solo file annotati).

#### 8.3.11 Alternativa secondaria: "Esporta copia annotata"

Con lo stesso scrittore, il menu del chip PDF offre "Esporta una copia annotata…" (scelta della cartella con `dialog:chooseFolder`, scopo `export-destination`, D-017): utile in modalità solo-app o per condividere. Onda 5, facoltativa.

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

## 13. Leggerezza e budget

| Voce | Oggi | Stima dopo | Note |
| --- | --- | --- | --- |
| JS iniziale renderer | 379,5 / 391 KiB | 384-388 KiB | +guscio nuovo, `nav.tsx`, `icons-shell.tsx`, popover (~8 KiB); −barra di stato, −selettore lingua (~2 KiB). Se supera 391: si sposta il popover Attività in un chunk pigro (si carica al primo clic) |
| JS totale renderer | 1574 / 1600 KiB | 1600-1625 KiB | impostazioni riorganizzate e Account (+8), lettore a strumenti (+6), componenti e icone (+6), Da rivedere unificato (~0). **Budget proposto 1640** (D-322) |
| CSS | tutto iniziale | ~35% iniziale | divisione per vista (§5.6): meno CSS al primo avvio, stesso totale |
| JS main | 1009 / 1010 KiB | 1045-1055 KiB | scrittore PDF (30-45), account (~5), rapporto di scansione (~2). **Budget 1060** (D-319) |
| Memoria a riposo | 501 MB tetto | invariata | nessun processo nuovo; la console di login è esterna e solo su richiesta; la scrittura PDF usa il worker esistente per la verifica |
| Primo contenuto | 530 ms tetto | invariato | il guscio nuovo non fa richieste in più all'avvio (i conteggi già esistono); Account, Attività e popover non chiamano nulla finché non si aprono |
| Disco della libreria | — | + copie degli originali annotati | una per file annotato, nella cartella dati (sincronizzata); mostrate in Manutenzione, eliminabili in Avanzate |

Nessuna dipendenza nuova: icone in linea (derivate da Lucide, ISC), popover e menu scritti a mano, scrittore PDF proprio.

---

## 14. Piano di implementazione a onde

Regole comuni a tutti i compiti: lavoro in `../rl-wt/<ramo>` dal `main` aggiornato; **al massimo 2 compiti in parallelo e con file disgiunti**; un solo compito alla volta esegue e2e (e solo le spec indicate); niente push; commit con l'identità locale e **senza** `Co-Authored-By`; testi it + en; `npm run typecheck`, `npm test` del pacchetto toccato e `npm run check:budget` prima del rapporto; rapporto breve (cosa, file, testid cambiati, budget misurato, rischi). I contratti in `@rl/core` li scrive **l'agente principale** prima dell'onda che li usa (come D-184, D-202, D-218, D-255); i compiti non cambiano `packages/core` se non è scritto nel compito.

### Onda 0 — prove (seriali, piccole)

| Id | Obiettivo | File | Criteri | Modello |
| --- | --- | --- | --- | --- |
| S1 | Verificare `claude auth status --json`, `auth login`, `auth logout` sulla CLI installata (nomi, uscita, codici, comportamento senza login) | solo `docs/design/spike-auth.md` | documento con esempi di uscita **anonimizzati**, decisione sul ripiego | Sonnet |
| S2 | Prototipo dello scrittore incrementale su PDF **sintetici generati** (xref classica, xref stream + ObjStm, linearizzato, ruotato 90°, con `CropBox` spostato, cifrato, con campo firma) e verifica: pdf.js lo apre, Chrome/Edge mostrano evidenziazione e sottolineatura, prefisso intatto; prova di `noView` per il doppio disegno | `tools/spikes/pdf-annot/**` | rapporto in `tools/spikes/pdf-annot/README.md` con dimensioni del codice e casi rifiutati; nessun PDF reale committato | Sonnet |

### Onda 1 — fondamenta (2 in parallelo)

**A1 · Token, CSS e componenti di base (renderer)**
- Obiettivo: §5 intero; correzione del PDF stirato (§8.1).
- File: `styles.css` → `styles/tokens.css`, `styles/base.css`, `styles/shell.css` + CSS per vista (`views/*/<vista>.css`, `settings/settings.css`); `components/ui.tsx`, nuovi `components/{Button,Popover,Menu,Banner,EmptyState,Segmented}.tsx`, `components/icons-shell.tsx`, `components/icons.tsx`; `main.tsx` (import CSS); rinomina `className="page"` → `"view"` nei 9 file elencati in §8.1 (solo quella riga, nessun altro cambiamento in quei file).
- Contratti: nessuno.
- Criteri: nessun colore letterale fuori da `tokens.css` (test); contrasto dei token in un test unitario (lo script di §5.2); `.pdfViewer .page` senza `max-width`/`padding` (test sul CSS); `check:budget` verde; aspetto invariato nelle viste non ancora migrate (alias `--space-*`).
- e2e: nessuna da cambiare (i testid non cambiano); eseguire `study-ui.spec.ts` (lettore) e `smoke.spec.ts`.

**B1 · Contratti e main per account, scansione, conteggi, scope dei tasti** (dopo che l'agente principale ha scritto i contratti di §7.1, §9, §10.3 e lo scope `reader-tool`)
- Obiettivo: realizzare nel main `ai:account`, `ai:setAuthMode`, `ai:login`, `ai:loginDone`, `ai:logout`, `ai:test`, evento `ai:accountChanged`; `authMode` in `@rl/ai` (`detectAccess`, `buildQueryOptions`); `scan:report` e il file del rapporto; `inbox:count` con `dropped`/`library`; `review:stats.pendingDocs`; "segna come visti" per gli elementi `library` della prima scansione.
- File: `packages/ai/src/claude.ts` (+test), `apps/desktop/src/main/ai/**` (nuovo `account.ts`), `main/ipc/handlers/{ai,scan,inbox,review}-handlers.ts`, `main/library/library-runtime.ts` (solo il rapporto), `main/inbox/service.ts` (solo conteggi e "visti"), `main/ai/review.ts` (solo `pendingDocs`), `renderer/src/testing/mockRl.ts`.
- Criteri: test unitari per ogni canale con il fornitore simulato; nessun segreto né output di `auth status` nei log; il renderer non passa mai percorsi o argomenti; `main` ≤ budget corrente + quanto motivato.
- e2e: nessuna da cambiare; nuova `e2e/ai-account.spec.ts` (fornitore simulato: cambio modo, test connessione, chiave salvata/rimossa) — scritta qui, eseguita alla fine dell'onda.

### Onda 2 — guscio e impostazioni (2 in parallelo)

**A2 · Guscio, navigazione, notifiche**
- Obiettivo: §2, §3, §4.1, §7 (badge, chip Attività, popover, banner, toast); selettore di libreria a popover; sezioni `library | review | projects | discover | map | settings`; `lib/nav.tsx` con indietro/avanti e briciole; barra di stato rimossa; tavolozza con documenti e voci delle impostazioni.
- File: `App.tsx`, `shell/**`, nuovo `lib/nav.tsx`, `lib/aiUi.tsx` (navigazione → `navigate`), `lib/notify.tsx`, `components/NoticeBanner.tsx`, `lib/keymap.tsx` e `lib/shortcutDefs.ts` (id `nav.*` rinumerati: Alt+1 Libreria, Alt+2 Da rivedere, Alt+3 Progetti, Alt+4 Scopri, Alt+5 Mappa; `nav.history.back/forward`), `views/chat/Palette.tsx`, `views/chat/paletteModel.ts`, `lib/jobs.tsx` e `lib/citationJobs.tsx` (solo per esporre le righe del popover), dizionari principali `i18n/locales/{it,en}.json`.
- Contratti: `shortcuts.ts` in core (id nuovi), scritti dall'agente principale.
- Criteri: ogni compito principale nei gesti di §3; Alt+←/→; badge con tooltip §7.1; JS iniziale ≤ 391 KiB; nessuna richiesta nuova all'avvio (test con `mockRl` che conta le chiamate).
- Testid: **tenuti** `shell`, `nav-library`, `nav-projects`, `nav-discover`, `nav-settings`, `inbox-badge`, `discover-badge`, `chat-toggle`, `chat-panel`, `palette-open`, `scan-status` (sul chip, stessi `data-state`/`data-phase`), `drop-hint`, `notice-banner`, `app-title`, `library-switcher` (ora pulsante: le spec che usano `selectOption` vanno cambiate), `language-select` (spostato in Impostazioni › Generale). **Rinominati** `nav-inbox` → `nav-review`, `nav-network` → `nav-map`. **Spostati** `status-library` (testo del selettore), `status-ai` (intestazione del pannello Claude). **Tolto** `statusbar`.
- e2e da aggiornare: `smoke.spec.ts` (lingua), `ui-first-run.spec.ts` (selettore), `inbox.spec.ts` (`nav-review`), `network.spec.ts` (`nav-map`), `ai-ui.spec.ts` (`status-ai`), `helpers/phase1.ts`/`helpers/ui.ts` se toccano la navigazione; `qa-budget.spec.ts` da rieseguire.

**C2 · Impostazioni riorganizzate e Account Claude**
- Obiettivo: §6 e §10.2 (UI); `Settings({ section, anchor, onSection })` con sottonavigazione e ricerca; sezioni Generale, Profilo, Libreria, Claude (con Account), Backup, Scorciatoie, Sviluppatore / Avanzate con "Valori diversi dal predefinito"; nuovi controlli di `scan.*` e prezzi dei modelli.
- File: `settings/**` (nuovi `GeneralSection.tsx`, `ClaudeSection.tsx`, `AccountCard.tsx`, `AdvancedSection.tsx`, `settingsIndex.ts` per la ricerca e la tavolozza; quelli esistenti spostati o divisi), parti i18n `settings`, `settings-wizard` (solo chiavi delle impostazioni), `aiSettings`, `mcp`, `backup`, `shortcuts`.
- Contratti: quelli di B1 (già realizzati), `annotations` in `library.json` (solo il controllo, che resta disattivato con "disponibile presto" finché l'onda 4 non arriva? **No**: il controllo si aggiunge nell'onda 4, compito G4a, per non mostrare un'opzione senza effetto).
- Criteri: ogni riga della mappa §6.2 ha il suo controllo e un test che lo trova nella sezione giusta; navigazione profonda da tavolozza; avviso di modifiche non salvate; sezioni pigre come oggi (nessun peso nella prima schermata).
- Testid: **tenuti** tutti quelli delle sezioni (`ai-settings`, `ai-exe*`, `ai-apikey*`, `ai-status*`, `mcp-*`, `backup-*`, `maintenance-*`, `shortcut*`, `library-config`, `config-*`, `settings-network`/`net-*`, `secret-*`, `settings-profile-*`, `settings-theme`, `library-list`, `library-item`, `settings-new-library`); **nuovi** `settings-nav-<section>`, `settings-search`, `ai-account`, `ai-auth-mode-<mode>`, `ai-login`, `ai-logout`, `ai-test`, `ai-test-result`, `advanced-nondefault`. Le spec che aprono le impostazioni e cercano una sezione ora devono cliccare `settings-nav-<section>`: helper nuovo `openSettings(window, section)` in `e2e/helpers/ui.ts` (questo compito possiede l'helper).
- e2e da aggiornare: `ai-live`, `ai-review`, `ai-search`, `ai-ui`, `export-mcp`, `packaged-app`, `backup-restore` (aprire la sezione giusta), più `ai-account.spec.ts` di B1.

### Onda 3 — viste principali (2 in parallelo)

**D3 · Libreria, scansione, procedura guidata**
- Obiettivo: §4.2 con i componenti nuovi; ricerca nella barra in alto (il campo della pagina sparisce, `search-input` passa al campo della barra: coordinare con A2, già fatto in onda 2 se A2 ha messo il campo con quel testid); "Gestisci tag"; filtro `docIds` dal rapporto; popover Scansione dentro Attività (componente `ScanReport` usato da A2); passo "Prima scansione" nella procedura guidata.
- File: `views/library/**`, `wizard/**`, parti i18n `doc`, `doc-reader` (solo chiavi della libreria), `taxonomy`, `wizard`.
- Contratti: `scan:report`, filtro `docIds` (core, agente principale).
- Criteri: chip "Dalla scansione" filtra esattamente gli id; procedura guidata mostra le fasi e "Continua in background"; nessuna regressione della ricerca (`search-basic.spec.ts`, `qa-search-perf.spec.ts`).
- Testid: tenuti `search-input`, `search-result(s)`, `search-summary`, `results-pane`, `folder-pane`, `tag-pane`, `manage-taxonomy`, `open-taxonomy`, `show-missing`, `scan-cancel`, `scan-start` (nel popover), `index-rebuild` (in Avanzate: la spec che lo usa deve aprire Avanzate); nuovi `wizard-scan`, `wizard-scan-continue`, `scan-report`, `scan-report-<kind>`.
- e2e da aggiornare: `ui-library.spec.ts`, `ui-first-run.spec.ts`, `helpers/phase1.ts` (attesa della scansione nel nuovo passo), `search-basic.spec.ts`, `qa-watcher.spec.ts`.

**E3 · Da rivedere (Arrivi + Proposte)**
- Obiettivo: §4.4, §4.5, §7.1; un'unica vista `review` con schede `files` e `proposals`, gruppi "Da aggiungere" e "Trovati dalla scansione", "Segna tutti come visti", tasti J/K/A/R/E/O.
- File: `views/inbox/**`, `views/review/**` (nuovo `views/review/ReviewHub.tsx`), `lib/inbox.tsx` (conteggi per il badge), parti i18n `inbox`, `review`, `doc-review`.
- Contratti: `inbox:count` esteso, `review:stats.pendingDocs` (B1).
- Criteri: badge = somma; tooltip con dettaglio; la vista si apre sulla scheda con elementi; le decisioni come oggi (D-221, D-223, D-230).
- Testid: tenuti `inbox-view`, `review-view`, `inbox-add`, `inbox-empty`, `inbox-refused*`, `review-*`; `inbox-tab-arrivals`/`inbox-tab-proposals` → `review-tab-files`/`review-tab-proposals` (rinominati); `section-inbox` → `section-review`.
- e2e da aggiornare: `inbox.spec.ts`, `ai-review.spec.ts`.

### Onda 4 — lettore e scrittura nel PDF (G4a e F4 in parallelo, G4b dopo G4a)

Prima: l'agente principale scrive i contratti di §8.3.8 e lo scope `reader-tool`, aggiorna `docs/RULES.md`/`CLAUDE.md` (fatto in questo ramo) e `check-nondestructive.mjs` (`--allow-pdf-append`).

**F4 · Lettore a strumenti (renderer)**
- Obiettivo: §4.3, §8.1 (verifica), §8.2; barra strumenti flottante, macchina a stati, Spazio, popover dell'annotazione accanto all'annotazione, stato di studio nel menu e nella scheda Info, chip "PDF:" e banner del primo uso (chiamano i canali di §8.3.8: con `mockRl` finché G4a non è unito), pannello "Dal PDF (altri programmi)" con `page.getAnnotations()`, nascondere le nostre dal canvas.
- File: `views/reader/**` (nuovi `toolMachine.ts`, `ReaderToolbar.tsx`, `AnnotationPopover.tsx`, `PdfWriteChip.tsx`, `ExternalAnnotations.tsx`), `views/notes/**` (solo layout nel pannello), `lib/reader.tsx`, parti i18n `reader`, `doc-projects-reader` (chiavi del lettore), `settings/ShortcutsSection.tsx` (solo lo scope nuovo — **unico file di settings toccato, C2 è già unito**).
- Criteri: macchina a stati con test per ogni transizione (§8.2); Spazio ignorato nei campi, nei trascinamenti e nella ripetizione; Esc non chiude il lettore; rapporto canvas/box entro 0,5% a DPR 1/1,25/1,5; tutte le annotazioni raggiungibili da tastiera.
- Testid: tenuti `reader`, `reader-close`, `reader-title`, `reader-page-input`, `reader-pages`, `reader-prev/next`, `reader-zoom*`, `reader-fit`, `reader-find*`, `reader-side*`, `reader-tab-*`, `reader-study-*` (ora voci del menu: la spec apre il menu `reader-study-menu`), `reader-underlined` (ora nella scheda Info), `annotation-bar` (= popover), `annotation-mark`, `annotation-item`, `ann-highlight`, `ann-comment`, `ann-color-*`; nuovi `reader-toolbar`, `reader-tool-<tool>`, `reader-pdf-chip`, `reader-pdf-menu`, `reader-external-annotations`.
- e2e da aggiornare: `study-ui.spec.ts` (stato di studio nel menu, Esc, strumenti), `study-data.spec.ts` (solo la parte UI, la parte hash è di G4b).

**G4a · Scrittore incrementale e servizio di sincronia (main + data)**
- Obiettivo: §8.3.2-8.3.3, §8.3.5-8.3.7 lato main; controllo "Salva le evidenziazioni anche nel PDF" e migrazione in Impostazioni › Libreria (unica eccezione di file renderer: `settings/LibraryAnnotationsGroup.tsx` nuovo, montato da `LibrarySection` con una riga).
- File: `packages/data/src/pdf-annot/**` (nuovo: `lexer.ts`, `objects.ts`, `xref.ts`, `objstm.ts`, `writer.ts`, `appearance.ts`, `geometry.ts`, test con PDF sintetici generati dal codice), `apps/desktop/src/main/study/pdf-sync.ts` (nuovo: lotti, coda, tentativi, copia di sicurezza, ripristino, migrazione), `main/ipc/handlers/study-handlers.ts` (canali nuovi), `main/library/worker-protocol.ts` + `worker-service.ts` (verifica con pdf.js nel worker), `settings/LibraryAnnotationsGroup.tsx`, parti i18n `settings` (solo il gruppo).
- Contratti: §8.3.8 (agente principale).
- Criteri: prefisso intatto byte per byte in tutti i test; ogni motivo di rifiuto provato; rinomina con `EPERM` simulato → `pending` → riuscita al tentativo successivo; ripristino restituisce l'hash base; corpus ostile senza blocchi né eccezioni non gestite; budget main ≤ 1060.
- e2e: nuova `e2e/pdf-annot.spec.ts` (crea, modifica, elimina, file bloccato simulato, ripristino; PDF sintetici).
- **Area sensibile**: revisione Sonnet indipendente + security prima del merge.

**G4b · Identità del contenuto (dopo G4a)**
- Obiettivo: §8.3.4 in tutti i consumatori.
- File: `packages/data/src/scanner.ts`, `packages/data/src/extract/text-extractor.ts` (chiave della cache), `apps/desktop/src/main/thumbs.ts`, `main/graph/inputs.ts`, `main/inbox/service.ts` (duplicati), `main/ai/tools-host.ts` e cache AI, `main/ipc/handlers/study-handlers.ts` (confronto `forHash` con `contentHashOf`; coordinare: G4a già unito), `main/ipc/handlers/doc-files.ts`, `packages/search/src/sqlite-index.ts` se usa l'hash come chiave di contenuto, `tools/check-nondestructive.mjs`.
- Criteri: dopo una scrittura nostra la scansione non segnala "cambiato" e le annotazioni non diventano "non allineate"; aggiornamento incrementale esterno riconosciuto (con rilettura del testo); un file davvero cambiato si comporta come oggi; miniature, cache testo e AI non si rigenerano per una nostra scrittura.
- e2e da aggiornare: `study-data.spec.ts` (hash: due casi, spento e acceso), `qa-scan-nondestructive.spec.ts`, `thumbs.spec.ts`, `inbox.spec.ts` (duplicato di un PDF annotato).

### Onda 5 — viste secondarie e rifinitura (2 in parallelo)

**H5 · Progetti, Scopri, Mappa nello stile nuovo** — `views/projects/**`, `views/discover/**`, `views/network/**` (+ i loro CSS), parti i18n relative. Pannello di dettaglio unico, stati vuoti, schede `Tabs`. e2e: `ui-projects.spec.ts`, `citations.spec.ts`, `network.spec.ts` (testid tenuti; solo selettori di navigazione).
**I5 · Chat, tavolozza, guida, esporta** — `views/chat/**` (escluso `Palette*` già di A2: solo stile), `views/guide/**`, `views/export/**`; intestazione del pannello Claude con lo stato (`status-ai`); aggiornare la guida (compiti, tasti nuovi, scrittura nel PDF); facoltativo: "Esporta copia annotata" (§8.3.11) e "Importa nell'app" per annotazioni esterne. e2e: `ai-chat.spec.ts`, `ai-ui.spec.ts`, `export-mcp.spec.ts`.

### Onda 6 — verifica

1. Rapporto dell'auditor visivo (secondo giro) applicato come correzioni puntuali (token, spaziature, testi).
2. Revisione indipendente (Sonnet) di tutto il ramo; **security** con potere di blocco su: scrittore PDF, `ai:login/logout` (processi esterni), osservatore di `~/.claude`, `check-nondestructive`.
3. Budget (`check:budget`, `qa-budget.spec.ts`) e aggiornamento di `tools/budgets.json` solo con le decisioni D-319/D-322.
4. Suite e2e completa **una spec alla volta** (regola delle risorse), poi `test:e2e:heavy` da solo.
5. Aggiornare `docs/STATUS.md`, `docs/HISTORY.md`, `docs/PLAN.md` (criterio della fase 3), guida d'uso.

### Riepilogo dei testid

| Testid | Esito |
| --- | --- |
| `nav-inbox` | → `nav-review` |
| `nav-network` | → `nav-map` |
| `section-inbox` | → `section-review` |
| `inbox-tab-arrivals`, `inbox-tab-proposals` | → `review-tab-files`, `review-tab-proposals` |
| `statusbar` | tolto (nessuna spec lo usa per asserzioni oltre all'esistenza: verificare `qa-*`) |
| `status-library` | sul pulsante del selettore di libreria |
| `status-ai` | nell'intestazione del pannello Claude |
| `scan-status` | sul chip Attività, stessi attributi |
| `library-switcher` | pulsante + popover (voci `library-switcher-item`) |
| `language-select` | in Impostazioni › Generale |
| `index-rebuild` | in Avanzate › Scansione |
| `reader-study-*` | voci del menu `reader-study-menu` |
| `reader-underlined` | scheda Info del pannello del lettore |
| tutti gli altri | invariati |

---

## 15. Domande aperte per l'utente

1. **Copia di sicurezza degli originali annotati:** nella cartella dati (sincronizzata: raddoppia lo spazio dei PDF annotati) come chiesto, oppure nella cartella locale dell'app (non sincronizzata, ma il ripristino per troncamento basta quasi sempre)?
2. **Nome dell'autore scritto nelle annotazioni del PDF** (visibile a chi riceve il file): predefinito il nome del profilo, oppure nessun nome?
3. **Esc nel lettore** non chiude più il documento (si chiude con ×, Alt+← o Ctrl+W): va bene?
4. **Uso del mese nell'Account:** basta quello della libreria attiva, o serve il totale di tutte le librerie (richiede di leggere i registri di librerie non aperte)?
