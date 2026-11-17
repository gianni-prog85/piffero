# Tasks: Unioni eterogenee e ordine/duplicati dei selettori (#22)

- [x] Aggiungere `{ kind: "union"; selectors: JsonPathStep[]; recursive?: boolean }` a `JsonPathStep` in `src/handler/jsonpathEngine.ts`.
- [x] Aggiornare `splitOutsideQuotes` / `parseBracketSubscript` per suddividere i selettori rispettando anche parentesi tonde `(...)` e quadre `[...]` annidate (es. `[?(@.a > 1), 0:2]`).
- [x] Mantenere il fast-path streaming per unioni semplici (`index` positivi ordinati senza duplicati, `unionKeys` senza duplicati) e instradare su `union` generale solo quando necessario.
- [x] Aggiornare `evaluateSingleStepOnValue` e `StreamingPathEngine` (incluso `ArrayCollector` / `PendingSlot`) per emettere i risultati nell'ordine dei selettori preservando i duplicati.
- [x] Aggiungere unit test per `$[2, 0, 2]`, `$['b', 'a', 'b']`, `$[0, 2:4, *]`, `$['name', ?(@.active)]`.
