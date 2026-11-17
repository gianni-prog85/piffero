# Proposal: Semantica RFC 9535 per esistenza, confronti e `Nothing` nei filtri

- **Issue**: #24
- **Spec RFC 9535**: §2.3.5.2 (Semantics of Filter Expressions)

## Why
`ConditionEval.evalAst` in `src/conditioneval/conditioneval.ts` adotta attualmente la semantica JavaScript anziché quella definita da RFC 9535:
1. **Test di esistenza (`?@.prop`)**: usa `Boolean(val)`, quindi valori falsy validi (`false`, `0`, `""`, `null`) fanno fallire il filtro anche se la proprietà esiste.
2. **Uguaglianza (`==`, `!=`)**: usa la coercizione JS (`"1" == 1` → `true`, `undefined == null` → `true`) e il confronto per riferimento su oggetti/array. In RFC 9535 non esiste coercizione, `Nothing != null`, `Nothing == Nothing` è `true` e oggetti/array si confrontano per uguaglianza strutturale profonda.
3. **Confronti ordinati (`<`, `<=`, `>`, `>=`)**: validi solo tra `number` e `number` oppure `string` e `string` (es. `"2" > 1` è `false`).

## What Changes
- Introdurre un simbolo sentinella interno `NOTHING` in `ConditionEval` distinto da `null` e da qualsiasi valore JSON valido.
- Implementare `isTruthyLogical(node, ...)` / valutazione booleana per test di esistenza basata su `val !== NOTHING` (o nodelist non vuota).
- Implementare `rfc9535Equals(a, b)` (uguaglianza stretta senza coercizione + deep structural equality per array e oggetti) e confronti ordinati type-safe.
- Mantenere `===` e `!==` come estensione retrocompatibile per query Goessner esistenti.

## Performance Focus
- **Sentinella `NOTHING` a zero allocazioni**: usare un `const NOTHING = Symbol("NOTHING")` singleton invece di allocare wrapper `{ value, exists }` per ogni nodo valutato.
- **Fast-path sui tipi primitivi**: in `rfc9535Equals`, verificare `if (a === b) return true;` e `typeof a !== typeof b` prima di scendere nella ricorsione strutturale su oggetti/array.
- **Preservare `PrunedJsBuilder` (`usedAsTruthiness`)**: nel builder potato di `jsonpathEngine.ts`, continuare a fermarsi al primo token di un ramo usato solo per esistenza (`?@.details`), poiché basta sapere che la chiave esiste (`!== NOTHING`) senza materializzare il sotto-albero.

## Impact
- **Affected code**: `src/conditioneval/conditioneval.ts`, `src/handler/jsonpathEngine.ts`, `spec/conditioneval/`, `spec/piffero/`
- **Breaking changes**: Cambia il comportamento di `?(@.prop)` quando `prop` è `false`/`0`/`""`/`null` e di `==` con coercizione JS (allineamento allo standard RFC 9535).
