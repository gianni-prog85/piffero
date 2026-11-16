# Tasks: Complete JSONPath Syntax

## 1. Operatore Wildcard `*` (Issue #8)
- [x] Estendere `ParsedPath` e `buildParsedPath` in `src/handler/mastehandler.ts` per riconoscere `.*` e `[*]`.
- [x] Aggiornare `SingleStepHandler` / `PifferoStatus` per abbinare qualsiasi chiave oggetto o indice array e gestire output bulk multipli.
- [x] Aggiungere unit test per `$.*`, `$.employees[*].name`, `$.employees[0].*` con `findByPath`, `findAsString` e `findAsPromise`.
- [x] Aggiornare la riga `*` nel `README.md` (✅).

## 2. Operatore Recursive Descent `..` (Issue #9)
- [x] Aggiornare `parse()` e `buildParsedPath()` per preservare `..` e valorizzare `ParsedPath.recursiveDescendant = true`.
- [x] Implementare il matching a profondità arbitraria in `SingleStepHandler` (oggetti annidati e array di oggetti) mantenendo l'approccio SAX streaming.
- [x] Gestire la composizione con segmenti successivi (es. `$.employees..type`, `$..phoneNumbers[0]`).
- [x] Aggiungere unit test per `$..phoneNumbers`, `$..number`, `$.employees..type` e casi limite.
- [x] Aggiornare la riga `..` nel `README.md` (✅).

## 3. Operatore Elemento Corrente `@` (Issue #11)
- [x] Estendere il parser dei filtri/espressioni per supportare il riferimento diretto a `@` (valori primitivi in array, es. `[?(@ > 10)]`, `[?(@ === 'foo')]`).
- [x] Supportare l'accesso a proprietà annidate tramite `@` (es. `@.address.city`) senza ricorrere alla sostituzione naive `@.` -> `!`.
- [x] Aggiungere unit test su array di primitivi e oggetti annidati.
- [x] Aggiornare la riga `@` nel `README.md` (✅).

## 4. Filtri Completi `?()` (Issue #10)
- [x] Estendere `ConditionEval` in `src/conditioneval/conditioneval.ts` per valutare operatori di confronto (`===`, `!==`, `==`, `!=`, `>`, `<`, `>=`, `<=`), operatori logici (`&&`, `||`, `!`) e verifica di esistenza (`[?(@.prop)]`).
- [x] Aggiornare `SingleStepHandler` per raccogliere i campi necessari dell'elemento candidato (incluse proprietà annidate) e decidere l'emissione del buffer al termine dell'oggetto/valore.
- [x] Aggiungere unit test per confronti numerici/stringa/booleani, combinazioni logiche e proprietà annidate.
- [x] Aggiornare la riga `?()` nel `README.md` (✅).

## 5. Script Expression `()` (Issue #12)
- [x] Riconoscere le espressioni subscript `(...)` senza prefisso `?` in `buildParsedPath`.
- [x] Valutare espressioni statiche aritmetiche (es. `[(1+1)]`) e riferimenti contestuali su `@` (es. `[(@.length-1)]` ove applicabile con buffering mirato dell'array).
- [x] Aggiungere unit test per espressioni aritmetiche e indicizzazione dinamica.
- [x] Aggiornare la riga `()` nel `README.md` (✅).
