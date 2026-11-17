# Proposal: Funzioni standard RFC 9535 (`length`, `count`, `match`, `search`, `value`)

- **Issue**: #19
- **Spec RFC 9535**: §2.4 (Function Extensions)

## Why
RFC 9535 definisce un sistema estensibile di funzioni nei filtri con 5 funzioni standard obbligatorie (`length`, `count`, `match`, `search`, `value`). Attualmente `ExprParser` in `src/conditioneval/conditioneval.ts` non supporta le chiamate a funzione `ident(...)`.

## What Changes
- Estendere `ExprToken` / `ExprParser` per riconoscere le chiamate a funzione `name(arg1, arg2, ...)` e validare la firma/tipizzazione secondo RFC 9535 §2.4.1 (`ValueType`, `LogicalType`, `NodesType`).
- Implementare le 5 funzioni standard:
  - `length(ValueType)`: lunghezza in Unicode scalar values per stringhe (`[...str].length`), lunghezza per array, numero di chiavi per oggetti, `Nothing` altrimenti.
  - `count(NodesType)`: numero di nodi in una nodelist.
  - `match(ValueType, ValueType)`: match completo I-Regexp (ancorato `^(?:...)$`, RFC 9485).
  - `search(ValueType, ValueType)`: match parziale I-Regexp.
  - `value(NodesType)`: valore singolo se `nodelist.length === 1`, altrimenti `Nothing`.

## Performance Focus
- **Cache delle RegExp precompilate**: per `match(str, literal)` e `search(str, literal)` con pattern letterale costante, compilare e validare la I-Regexp **una sola volta** a compile-time (memorizzandola nel nodo AST o in una `Map` bounded), evitando `new RegExp(...)` per ogni record su stream da 200+ MiB.
- **Fast-path ASCII per `length(str)`**: verificare rapidamente se la stringa è solo ASCII (es. `!/[^\x00-\x7F]/.test(s)` o scansione senza surrogate) per restituire `str.length` in O(1) senza allocare l'array `[...str]`; calcolare i code point solo in presenza di coppie surrogate.
- **Integrazione con `PrunedJsBuilder`**: insegnare a `collectExprProjection` a tracciare gli argomenti delle funzioni (es. `length(@.tags)` cattura `tags`, `count(@.items[*])` cattura `items`) mantenendo lo skipping dei rami non usati.

## Impact
- **Affected code**: `src/conditioneval/conditioneval.ts`, `src/handler/jsonpathEngine.ts`, `spec/conditioneval/`, `spec/piffero/`
- **Breaking changes**: Nessuno.
