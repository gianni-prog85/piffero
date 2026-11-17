# Tasks: Filtri RFC 9535 senza parentesi tonde `?[...]` (#20)

- [x] Aggiornare `parseBracketSubscript` in `src/handler/jsonpathEngine.ts` per supportare `?expr` senza parentesi esterne oltre a `?(expr)`.
- [x] Gestire il caso in cui l'espressione inizi con `(` ma contenga operatori esterni (es. `?[(@.a > 1) && (@.b < 2)]`) evitando di rimuovere erroneamente la prima `(` come wrapper esterno.
- [x] Verificare che le espressioni vuote (`?[ ]`, `?()`) continuino a lanciare `PifferoJsonPathError`.
- [x] Aggiungere unit test per `$[?@.price < 10]`, `$[?@.active && !@.deleted]`, `$[?(@.a || @.b) && @.c]`.
