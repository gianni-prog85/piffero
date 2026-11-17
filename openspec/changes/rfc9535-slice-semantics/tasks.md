# Tasks: Semantica Slice RFC 9535 (#23)

- [ ] Distinguere `end?: number` (`undefined` = fine array) da `end === 0` in `LegacyParsedPath.range`, `PifferoStatus.checkIndex()`, `extractFromParsed` e `evaluateArrayElementSteps`.
- [ ] Implementare `Bounds(start, end, step, len)` conforme a RFC 9535 §2.3.4.2.2 in `resolveSliceBounds`.
- [ ] Rimuovere il blocco `if (step <= 0)` in `parseBracketSubscript` e gestire `step === 0` (risultato vuoto) e `step < 0` (iterazione inversa).
- [ ] Attivare `ArrayCollector` in `StreamingPathEngine` quando `step < 0` (con ottimizzazione `tailKeep` quando possibile, es. `$[-k::-1]`).
- [ ] Aggiungere unit test per `$[::-1]`, `$[5:1:-2]`, `$[0:0]`, `$[0:5:0]` e benchmark di non-regressione su slice positivi O(1).
