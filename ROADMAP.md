# Piffero Roadmap

Questo documento definisce la roadmap evolutiva di **Piffero**, il parser JSON SAX-like basato su stream con supporto JSONPath.

---

## Stato attuale (`v1.1.13`)
- Parsing incrementale via `CStream` (porting TypeScript di Clarinet).
- API pubblica: `Piffero.findByPath`, `Piffero.findAsString`, `Piffero.findAsPromise`.
- Supporto JSONPath base: `$`, `.`, `[index]`, `[i,j]`, `[start:end:step]`, filtri di uguaglianza semplici `[?(@.prop===val)]`.
- Interruzione anticipata dello stream per query non-bulk.

---

## Fase 1 — Ottimizzazione Core & Affidabilità (v1.2.0)
Focus su prestazioni su file di grandi dimensioni, riduzione allocazioni e gestione corretta degli stream Node.js.

- [x] **#1 — Eliminare il doppio parsing ricorsivo nei JSONPath con condizioni**
  Evitare la creazione di un secondo `MasterHandler` + `CStream` quando una condizione è seguita da ulteriori segmenti di percorso.
- [x] **#2 — Sostituire concatenazioni di stringhe (`+=`) e `push()` per singolo token**
  Introdurre bufferizzazione basata su array (`string[]` + `join`) e chunking minimo configurabile prima di `stream.push()`.
- [x] **#3 — Calcolo O(1) per slice/unioni in `buildParsedPath`**
  Eliminare la materializzazione dell'array `indexes` per i range `[start:end:step]` e usare `Set<number>` per le unioni esplicite.
- [x] **#4 — Gestione backpressure e `StringDecoder` nativo in `CStream`**
  Rispettare il valore di ritorno di `output.push()` con `pause()`/`resume()` sullo stream sorgente e sostituire il decoder UTF-8 manuale con `string_decoder`.
- [x] **#5 — Pulizia dipendenze e propagazione errori su stream**
  Rimuovere `underscore` (inutilizzato), alleggerire `ConditionEval` (riducendo la dipendenza da `esprima`/`static-eval`) e propagare gli errori tramite `output.destroy(err)` in modalità stream.

---

## Fase 2 — Completamento Sintassi JSONPath (v1.3.0)
Allineamento alle specifiche JSONPath complete descritte nel `README.md` (OpenSpec `complete-jsonpath-syntax`):

- [x] **#8 — Wildcard `*`** (es. `$.employees[*].name`, `$.*`).
- [x] **#9 — Recursive descent `..`** (es. `$..phoneNumbers`, `$.employees..type`).
- [x] **#10 — Filtri completi `?()`**: supporto a operatori di confronto (`!=`, `!==`, `==`, `>`, `<`, `>=`, `<=`), operatori logici (`&&`, `||`, `!`) e verifica di esistenza proprietà.
- [x] **#11 — Operatore elemento corrente `@`**: riferimento diretto su primitivi (`[?(@ > 10)]`) e proprietà annidate (`@.address.city`).
- [x] **#12 — Script expression `()`**: valutazione espressioni subscript (es. `[(1+1)]`, `[(@.length-1)]`).

---

## Fase 3 — Modernizzazione, DX & CI (v1.4.0)
- [ ] Migrazione da `tslint` (deprecato) a `eslint` + `@typescript-eslint`.
- [ ] Supporto dual-package ESM / CommonJS e aggiornamento target TypeScript / `@types/node`.
- [ ] Migrazione CI da Travis CI (`.travis.yml`) a GitHub Actions (test, coverage, benchmark regression check).
- [ ] Aggiornamento del `README.md` per allineare la tabella delle feature effettivamente supportate.
