# Tasks: Unioni eterogenee e ordine/duplicati dei selettori (#22)

- [ ] Aggiungere `{ kind: "union"; selectors: JsonPathStep[]; recursive?: boolean }` a `JsonPathStep` in `src/handler/jsonpathEngine.ts`.
- [ ] Aggiornare `splitOutsideQuotes` / `parseBracketSubscript` per suddividere i selettori rispettando anche parentesi tonde `(...)` e quadre `[...]` annidate (es. `[?(@.a > 1), 0:2]`).
- [ ] Mantenere il fast-path streaming per unioni semplici (`index` positivi ordinati senza duplicati, `unionKeys` senza duplicati) e instradare su `union` generale solo quando necessario.
- [ ] Aggiornare `evaluateSingleStepOnValue` e `StreamingPathEngine` (incluso `ArrayCollector` / `PendingSlot`) per emettere i risultati nell'ordine dei selettori preservando i duplicati.
- [ ] Aggiungere unit test per `$[2, 0, 2]`, `$['b', 'a', 'b']`, `$[0, 2:4, *]`, `$['name', ?(@.active)]`.
