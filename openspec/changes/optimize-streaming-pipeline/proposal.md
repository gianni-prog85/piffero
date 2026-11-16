# Proposal: Optimize Streaming Pipeline

## Why
L'analisi del codice attuale (`v1.1.13`) ha evidenziato cinque colli di bottiglia prestazionali e strutturali che penalizzano l'uso di Piffero su file JSON molto grandi o con query condizionali:
1. Doppio parsing ricorsivo (`MasterHandler` + `CStream`) quando una condizione precede altri segmenti (#1).
2. Allocazioni frequenti di stringhe (`+=`) e chiamate `stream.push()` per singoli token (#2).
3. Allocazione O(N) di `indexes` per slice grandi e lookup O(N) via `indexOf` (#3).
4. Assenza di gestione della backpressure sugli stream e decodifica UTF-8 manuale in `CStream` (#4).
5. Dipendenze non necessarie (`underscore`), parser pesante per condizioni semplici (`esprima`/`static-eval`) ed eccezioni sincrone dentro callback stream (#5).

## What Changes
- **Single-pass condition traversal**: eliminare l'istanza ricorsiva di `MasterHandler` per path con condizioni seguite da altri segmenti.
- **Buffered output**: accumulo in `string[]` e chunking minimo prima di `push()`.
- **O(1) index matching**: calcolo matematico diretto per slice e `Set<number>` per unioni.
- **Stream backpressure & UTF-8**: `PassThrough`/`Readable` con `pause()`/`resume()` e `StringDecoder` nativo in `CStream`.
- **Lean dependencies & safe errors**: rimozione `underscore`, valutazione leggera per condizioni statiche e `output.destroy(err)`.

## Impact
- **Affected specs**: `stream-parser`
- **Affected code**: `src/handler/mastehandler.ts`, `src/libs/clarinet/cstream.ts`, `src/conditioneval/conditioneval.ts`, `package.json`
- **Breaking changes**: Nessuno sull'API pubblica (`Piffero.findByPath`, `findAsString`, `findAsPromise`).
