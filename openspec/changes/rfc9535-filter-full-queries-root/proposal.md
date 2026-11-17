# Proposal: Query JSONPath complete nei filtri e riferimento alla root (`$`)

- **Issue**: #21
- **Spec RFC 9535**: §2.3.5.1 (Filter Selector Syntax — `filter-query`, `rel-query`, `jsonpath-query`)

## Why
In RFC 9535 una `filter-query` dentro un filtro può essere una qualsiasi query relativa (`@` + segmenti) o assoluta (`$` + segmenti), includendo wildcard (`*`), recursive descent (`..`), slice, unioni e filtri annidati (es. `$[?(@..price > 10)]`, `$[?(@.price < $.maxPrice)]`).
Attualmente:
1. `ExprParser.parsePostfix()` in `src/conditioneval/conditioneval.ts` supporta solo `.ident` e `[expr]`.
2. `StreamingPathEngine` in `src/handler/jsonpathEngine.ts` non cattura né passa `rootValue` (`$`) a `ConditionEval.evalAst`.

## What Changes
- Estendere `ExprNode` e `ExprParser` per rappresentare nodi `query` (`relQuery` su `@` e `rootQuery` su `$`) compilati una sola volta tramite `tokenizeJsonPath` (o parser condiviso) in `JsonPathStep[]`.
- Valutare tali query tramite `evaluateStepsOnValue` restituendo la nodelist risultante (per `count()`, `value()`, test di esistenza o confronto singolare).
- Gestire `rootValue` in `StreamingPathEngine` quando una query contiene riferimenti a `$` dentro un filtro.

## Performance Focus
- **Compilazione una-tantum della sub-query**: i segmenti di `@...` e `$...` vengono compilati in `JsonPathStep[]` al momento del `compile()` e memorizzati in `astCache`, evitando re-parsing per ogni elemento.
- **Fast-path senza root-buffering**: analizzare l'AST a compile-time (`usesRoot(ast)`). Se il filtro **non** usa `$`, mantenere lo streaming puro O(1) RAM senza toccare la root.
- **Proiezione mirata sulla root (`buildRootProjection`)**: quando il filtro usa `$.qualcosa`, costruire una `FilterProjectionNode` anche per la root (come già fatto da `PrunedJsBuilder` per `@`), così da catturare in RAM solo i rami effettivamente letti da `$...` invece dell'intero documento da 200+ MiB!
- **Valutazione anticipata / two-pass o streaming lazy**: se il filtro usa solo `@.a` (senza `*`/`..`/`slice`), mantenere la valutazione diretta O(1) senza allocare nodelist intermedie.

## Impact
- **Affected code**: `src/conditioneval/conditioneval.ts`, `src/handler/jsonpathEngine.ts`, `spec/piffero/`
- **Breaking changes**: Nessuno.
