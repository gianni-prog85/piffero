# Proposal: Filtri RFC 9535 senza parentesi tonde `?[...]`

- **Issue**: #20
- **Spec RFC 9535**: §2.3.5 (Filter Selector)

## Why
In RFC 9535 le parentesi tonde attorno all'espressione filtro sono opzionali (`$[?@.price < 10]` è valido tanto quanto `$[?(@.price < 10)]`). Attualmente `parseBracketSubscript` in `src/handler/jsonpathEngine.ts` richiede obbligatoriamente `?(...)` e lancia `PifferoJsonPathError` in assenza di parentesi.

## What Changes
- Aggiornare `parseBracketSubscript` in `src/handler/jsonpathEngine.ts` per accettare sia `?(expr)` sia `?expr`.
- Gestire correttamente il bilanciamento di parentesi, stringhe quotate e operatori logici all'interno dell'espressione senza creare allocazioni extra.

## Performance Focus
- **Zero overhead a runtime**: la normalizzazione avviene esclusivamente una volta in fase di parsing (`tokenizeJsonPath` / `parseBracketSubscript`), lasciando invariato l'AST compilato e il percorso hot di `StreamingPathEngine` / `PrunedJsBuilder`.
- **AST Cache hit**: normalizzare l'espressione (trim) prima della lookup in `ConditionEval.astCache` per massimizzare il riuso dell'AST compilato.

## Impact
- **Affected code**: `src/handler/jsonpathEngine.ts`, `spec/piffero/jsonpathFeaturesSpec.ts`
- **Breaking changes**: Nessuno (retrocompatibile al 100% con `?(...)`).
