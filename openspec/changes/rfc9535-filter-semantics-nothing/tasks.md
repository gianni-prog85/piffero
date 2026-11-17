# Tasks: Semantica RFC 9535 per esistenza, confronti e `Nothing` (#24)

- [x] Introdurre il singleton `NOTHING` in `src/conditioneval/conditioneval.ts` e restituirlo per accessi a proprietà/indici inesistenti.
- [x] Implementare `evalLogical` / `evaluateFilter` distinguendo i test di esistenza (`val !== NOTHING`) dai valori booleani/falsy (`false`, `0`, `""`, `null`).
- [x] Implementare `rfc9535Equals(a, b)` (no coercizione, `NOTHING == NOTHING`, `NOTHING != null`, deep equality iterativa/ricorsiva per array e oggetti) per `==` e `!=`.
- [x] Implementare confronti ordinati type-safe (`<`, `<=`, `>`, `>=` solo per `number`/`number` e `string`/`string`).
- [x] Verificare che `PrunedJsBuilder` in `src/handler/jsonpathEngine.ts` continui a saltare il sotto-albero quando `usedAsTruthiness` è attivo, impostando un valore sentinella presente (non `NOTHING`).
- [x] Aggiungere unit test su tutti i casi della tabella RFC 9535 §2.3.5.2.2 e verificare la regressione sui benchmark con filtri.
