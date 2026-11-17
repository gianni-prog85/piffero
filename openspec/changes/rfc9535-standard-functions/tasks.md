# Tasks: Funzioni standard RFC 9535 (#19)

- [x] Aggiungere il token virgola `,` e il nodo AST `{ type: "call"; name: string; args: ExprNode[]; compiledRegex?: RegExp | null }` in `src/conditioneval/conditioneval.ts`.
- [x] Validare a compile-time numero e tipo degli argomenti (`ValueType`, `LogicalType`, `NodesType`) secondo RFC 9535 §2.4.1 (lanciando `PifferoJsonPathError` su firme non valide).
- [x] Implementare `length()` con fast-path O(1) su stringhe ASCII e conteggio code-point solo per surrogate UTF-16.
- [x] Implementare `count()` e `value()` operando sulle nodelist prodotte dai `query` node.
- [x] Implementare `match()` e `search()` con traduttore/validatore I-Regexp (RFC 9485) e precompilazione `RegExp` a compile-time per pattern letterali.
- [x] Aggiornare `collectExprProjection` in `src/handler/jsonpathEngine.ts` per supportare le chiamate a funzione in `PrunedJsBuilder`.
- [x] Aggiungere unit test e benchmark dedicati su filtri con `length()`, `count()`, `match()`, `search()`, `value()`.
