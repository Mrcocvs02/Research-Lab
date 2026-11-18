# Spike S1 — comandi di autenticazione della CLI Claude Code

Versione provata: `claude --version` → `2.1.326 (Claude Code)`, Windows 11. Tutte le uscite sono anonimizzate
(`<email>`, `<org>`, `<uuid>`, `<user>`). Nessun login o logout reale è stato eseguito, nessuna configurazione modificata,
nessun prompt inviato al modello.

## Quale eseguibile chiama l'app

`packages/ai/src/claude.ts` (`findClaudeExecutable`) risolve, in ordine: percorso nelle impostazioni, `claude.exe` nel PATH,
`~/.local/bin/claude.exe`, poi quello del pacchetto SDK (solo sviluppo). Sulla macchina di prova il binario è
`C:\Users\<user>\.local\bin\claude` (installazione nativa), quindi è lo stesso che userebbero i comandi `claude auth ...`.
L'app deve invocare i comandi di auth con **lo stesso percorso risolto** (non un `claude` generico), senza shell.

## Comandi

### `claude auth` (gruppo)
- Esiste: sì. Sottocomandi: `login`, `logout`, `status`, `help`. Exit 0, ~0,2 s.

### `claude auth status`
- Esiste: sì. Sintassi: `claude auth status [--json | --text]`. **Il default è già JSON**; `--json` è identico.
- Exit code: 0 (con account collegato). Non provato lo stato scollegato (richiederebbe logout); dalla CLI ci si aspetta
  `"loggedIn": false` con exit 1, **da trattare come non verificato**: l'app deve leggere `loggedIn` dal JSON, non l'exit code.
- Durata: 0,26 s a caldo, 0,86 s alla prima chiamata. Timeout consigliato: 10 s.
- Uscita (anonimizzata):

```json
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "C:\Users\<user>\.claude\projects",
  "configDirectory": "C:\Users\<user>\.claude",
  "loginExpiresAt": "2026-12-15T18:51:49.413Z",
  "consoleProfileSignInOffered": true,
  "email": "<email>",
  "orgId": "<uuid>",
  "orgName": "<org>",
  "subscriptionType": "team",
  "storedClaudeAiLogin": true,
  "planTier": "other"
}
```

- `--text`: righe `Login method: Claude Team account`, `Organization: <org>`, `Email: <email>`,
  `Anthropic base URL: https://api.anthropic.com`, `Sign-in ends: ... (<iso>)`. Exit 0.
- Decisione: **usare** `claude auth status` (JSON) per `ai:account`. Campi utili: `loggedIn`, `authMethod`, `email`,
  `orgName`, `subscriptionType`, `loginExpiresAt`. Parsing tollerante (campi opzionali, ignorare quelli sconosciuti).
  Non mostrare `orgId` né i percorsi. Ripiego se il comando manca o il JSON non è valido: "Collegato, account non noto"
  se la prova di connessione riesce, altrimenti "Non collegato".

### `claude auth login`
- Esiste: sì (solo `--help` eseguito). Sintassi: `claude auth login [--claudeai | --console] [--email <email>] [--sso]`.
  - `--claudeai` abbonamento Claude (default); `--console` fatturazione API Console; `--email` precompila l'email; `--sso` accesso SSO.
- Nel testo di aiuto **non compare** alcuna opzione per stampare solo un URL, per un codice di dispositivo o per non aprire
  il browser. È un flusso interattivo che di norma apre il browser e attende il ritorno OAuth; l'app non può
  confermare senza eseguirlo che stampi l'URL su stdout in modo leggibile.
- Exit code e durata: non misurati (vietato eseguirlo). Durata attesa: dipende dall'utente (fino a minuti).
- Alternativa: `claude setup-token` ("token di lunga durata", richiede abbonamento) esiste ma produce un token da incollare
  e gestire: sensibile, **non** adatto al ripiego (l'app non deve maneggiare token).
- Decisione: **usare** `claude auth login --claudeai` come previsto nell'architettura, in una console visibile
  (nessun login con URL senza console dimostrato). L'app non passa mai `--console`/chiavi.
  Passare `--email` solo se l'utente lo digita (opzionale). Se in una versione futura un esperimento mostrasse che
  `auth login` a stdout non interattivo stampa l'URL, lo si potrà adottare: oggi no.

### `claude auth logout`
- Esiste: sì. Sintassi: `claude auth logout` (nessuna opzione oltre `-h`). Non eseguito.
- Exit code e durata: non misurati. Non è interattivo secondo l'aiuto.
- Decisione: **usare** come da architettura (non interattivo, uscita catturata, timeout 20 s), dopo la conferma;
  poi richiamare `auth status` per verificare `loggedIn: false`, senza fidarsi dell'exit code.

## Dove sono le credenziali (Windows)

- Esiste il file `~/.claude/.credentials.json` (692 byte, modificato il 2026-11-18 04:33): contenuto **non letto**.
  Quindi su questa installazione la CLI usa un file in `~/.claude`, non (solo) il Gestore credenziali:
  `cmdkey /list` non mostra voci con "claude". `auth status` conferma `"storedClaudeAiLogin": true`.
- Il timestamp 04:33 è successivo ad altri file di `~/.claude`: il file viene riscritto, probabilmente al rinnovo del
  token OAuth, non solo al login. Conseguenza: un osservatore sul file vede **sia login che rinnovi automatici**.
- `~/.claude.json` (1074 byte) è un altro file di stato; `settings.json`, `policy-limits.json`, `remote-settings.json` si
  modificano per altre ragioni.

## Osservatore di `~/.claude`

- Un watcher sul nome `.credentials.json` vedrebbe un login (file riscritto) e un logout (file cancellato o svuotato).
  Ma: (1) rinnovi del token generano eventi spuri; (2) su altre installazioni o versioni le credenziali possono stare
  nel Gestore credenziali/Keychain e l'evento non arriva; (3) scritture atomiche (file temporaneo + rename) possono
  comparire come eventi di altri nomi.
- Decisione: l'osservatore è solo un acceleratore. Ad ogni evento (anche rumoroso, con debounce ~500 ms) l'app richiama
  `claude auth status` e confronta `email`/`orgName`/`loggedIn`. Il pulsante primario "Ho finito, verifica" resta
  obbligatorio, come già scritto in ARCHITETTURA-UI. Mai leggere il contenuto del file.

## Decisione per la schermata Account Claude

| Azione | Cosa chiama l'app |
|---|---|
| Stato / identità | `<claude> auth status` (JSON di default), timeout 10 s, lettura di `loggedIn`, `authMethod`, `email`, `orgName`, `subscriptionType`, `loginExpiresAt` |
| Cambia account | console visibile con `<claude> auth login --claudeai` (nessun URL-senza-console disponibile) + osservatore + "Ho finito, verifica" che richiama `auth status` |
| Esci | `<claude> auth logout` non interattivo, timeout 20 s, poi `auth status` per verifica |
| Login con URL senza console | **Non possibile con le opzioni documentate** in 2.1.326 (nessun flag per stampare l'URL o il codice). Si resta sul ripiego della console visibile. |

`<claude>` è il percorso risolto da `findClaudeExecutable`. Da ripetere la prova se cambia la versione maggiore della CLI.
Non verificati per il divieto di eseguirli: exit code e durata di `login`/`logout`, forma di `auth status` da scollegati.
