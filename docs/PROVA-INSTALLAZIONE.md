# Prova di installazione pulita (secondo account Windows)

Lista di controllo per la prova finale della fase 8 (D-259, D-263, D-291). Serve un secondo account Windows senza amministratore, mai usato con Research Lab. Segna ogni voce; se qualcosa non va, annota il passo e il messaggio.

## 0. Preparazione (account principale)
- [ ] `npm run build` e `npm run dist` dalla radice del repository: crea `apps/desktop/release/ResearchLab-Setup-<versione>.exe`.
  - Se la costruzione si ferma con un errore su un collegamento simbolico ("privilegio non posseduto"): attiva la Modalità sviluppatore di Windows (Impostazioni, Privacy e sicurezza, Per sviluppatori) o apri il terminale come amministratore, e ripeti.
- [ ] Copia l'installer in una cartella leggibile da tutti gli account (per esempio `C:\Users\Public\`).
- [ ] Prepara una cartella di prova con alcuni PDF (non i documenti veri) in un percorso accessibile al secondo account.

## 1. Installazione
- [ ] Accedi al secondo account e avvia l'installer. Windows (SmartScreen) avverte che l'editore è sconosciuto: normale, l'app non è firmata (D-259). "Ulteriori informazioni", poi "Esegui comunque".
- [ ] L'installer NON chiede la password di amministratore.
- [ ] La lingua dell'installer segue quella del sistema (italiano o inglese).
- [ ] Puoi scegliere la cartella di installazione (predefinita: sotto il profilo dell'utente).
- [ ] Al termine ci sono il collegamento nel menu Start e quello sul desktop, con nome "Research Lab" e l'icona segnaposto.

## 2. Primo avvio
- [ ] L'app si apre senza errori e mostra la procedura guidata di primo avvio.
- [ ] Crea una libreria sulla cartella di prova (lingua a scelta); i documenti vengono trovati e indicizzati.
- [ ] Ricerca, lettura di un PDF, note ed evidenziazioni funzionano.
- [ ] Sezione AI: senza Claude Code installato compare la spiegazione su come installarlo o sceglierne l'eseguibile (D-261); il resto dell'app funziona.
- [ ] Impostazioni, Manutenzione: i numeri del rapporto sono plausibili; "Copia diagnostica" produce un testo senza percorsi né nomi.

## 3. Backup e ripristino
- [ ] Impostazioni, Backup: scegli una cartella fuori dalla libreria e crea un backup; compare un file `.rlbackup`. La verifica dice 0 problemi.
- [ ] Scegliendo una cartella dentro la libreria come destinazione, l'app la rifiuta.
- [ ] Ripristina il backup in una nuova cartella vuota: nasce una libreria nuova, con gli stessi documenti e la stessa tassonomia; l'elenco dice quali chiavi (segreti) rimettere.

## 4. Dati e disinstallazione
- [ ] Chiudi l'app e riaprila: libreria e impostazioni ci sono ancora.
- [ ] Disinstalla da "App installate". La disinstallazione non chiede conferme strane e NON cancella: la cartella `.lab` della libreria, i documenti, i backup, le impostazioni (`%APPDATA%\Research Lab`) e i dati locali (`%LOCALAPPDATA%\ResearchLab`).
- [ ] Reinstalla: l'app ritrova impostazioni e libreria.

## 5. Account principale
- [ ] Controlla che l'installazione del secondo account non abbia toccato le impostazioni o le librerie dell'account principale.

## Da annotare
- Tempo di avvio percepito, memoria a riposo (Gestione attività, somma dei processi "Research Lab"), eventuali avvisi di antivirus.
- Domande aperte in D-263: installer con Claude Code incluso, firma del codice, icona e nome definitivi, cifratura dei backup.
