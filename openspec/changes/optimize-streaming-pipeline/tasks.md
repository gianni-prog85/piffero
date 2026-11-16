# Tasks: Optimize Streaming Pipeline

## 1. Index & Slice Optimization (Issue #3)
- [ ] Aggiornare `buildParsedPath` in `src/handler/mastehandler.ts` per non popolare `indexes` sugli slice `[start:end:step]`.
- [ ] Sostituire `indexes: number[]` con `Set<number>` per le unioni esplicite (`[1,2,3]`) e aggiornare `PifferoStatus.checkIndex()`.
- [ ] Aggiungere unit test per slice ampi (es. `[0:1000000:10]`).

## 2. Output Buffering & String Allocations (Issue #2)
- [ ] Sostituire `outputString += value` e `status.temp += ...` in `SingleStepHandler` con array di stringhe (`string[]`) + `join("")`.
- [ ] Introdurre un buffer di uscita con soglia minima di chunk prima di invocare `this._output.push(...)`.
- [ ] Verificare il miglioramento con la suite in `benchmarking/`.

## 3. Single-Pass Condition Traversal (Issue #1)
- [ ] Rimuovere la creazione ricorsiva di `MasterHandler` in `MasterHandler.parse` quando `parsedPath.hascondtion` è `true` e `parsedPath.next` è presente.
- [ ] Propagare i nodi che superano `verifyCondition` direttamente ai `SingleStepHandler` successivi.
- [ ] Verificare tutti i test in `spec/piffero/condtionsTestSpec.ts` e `spec/piffero/pifferoSpec.ts`.

## 4. Backpressure & Native UTF-8 Decoder (Issue #4)
- [ ] Sostituire `new Stream.Transform()` senza `_transform` con `PassThrough` (o `Readable` dedicato).
- [ ] Gestire il valore di ritorno `false` di `output.push()` mettendo in pausa lo stream sorgente e riprendendo su evento `drain`.
- [ ] Sostituire il decoder UTF-8 manuale (`tbbis`) in `CStream._write` con `StringDecoder` (`string_decoder`).

## 5. Dependencies & Stream Error Propagation (Issue #5)
- [ ] Rimuovere `underscore` dalle `dependencies` in `package.json`.
- [ ] Semplificare `ConditionEval` sostituendo/rendendo opzionale `esprima` + `static-eval` per literal e confronti semplici.
- [ ] Aggiornare `MasterHandler.onerror` per propagare gli errori tramite `this.output.destroy(this.error)` in modalità stream.
- [ ] Verificare `spec/piffero/errorSpec.ts`.
