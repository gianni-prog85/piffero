# Tasks: Query JSONPath complete nei filtri e riferimento alla root (`$`) (#21)

- [x] Aggiungere il nodo AST `{ type: "query"; isRoot: boolean; steps: JsonPathStep[] }` in `src/conditioneval/conditioneval.ts` e aggiornare `ExprParser` per parsare segmenti completi dopo `@` e `$` (inclusi `..`, `*`, slice, unioni, filtri annidati).
- [x] Mantenere un fast-path diretto per catene semplici `@.a.b` senza allocare array nodelist, usando `evaluateStepsOnValue` per query complesse (`*`, `..`, slice, filtri).
- [x] Aggiungere `usesRoot(ast)` in `ConditionEval` per attivare la cattura della root in `StreamingPathEngine` solo quando strettamente necessario.
- [x] Estendere `PrunedJsBuilder` / `StreamingPathEngine` per costruire una proiezione potata della root (`rootProjection`) quando i filtri accedono a percorsi statici di `$` (es. `$.config.maxPrice`), evitando di caricare l'intero JSON in memoria.
- [x] Gestire il caso in cui l'elemento filtrato arrivi prima della proprietà `$.maxPrice` nello stream (accodamento dei candidati in `PendingSlot` fino alla disponibilità del valore root).
- [x] Aggiungere unit test per `$[?(@..price > 10)]`, `$[?(@.tags[*])]`, `$[?(@.price < $.maxPrice)]` (sia con `maxPrice` prima che dopo l'array nello stream).
