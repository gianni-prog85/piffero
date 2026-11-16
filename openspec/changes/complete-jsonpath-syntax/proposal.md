# Proposal: Complete JSONPath Syntax

## Why
La tabella delle funzionalità nel `README.md` (basata sulla specifica di Stefan Goessner) e la Fase 2 della `ROADMAP.md` indicano cinque funzionalità JSONPath non ancora implementate o solo parzialmente supportate nell'engine streaming attuale (`src/handler/mastehandler.ts` e `src/conditioneval/conditioneval.ts`):
1. **Operatore wildcard `*`** (#8): selezione di tutti i figli/elementi indipendentemente dal nome della proprietà o dall'indice (`$.*`, `$.employees[*].name`).
2. **Operatore recursive descent `..`** (#9): ricerca ricorsiva a qualsiasi profondità nel documento JSON (`$..phoneNumbers`, `$.employees..type`). Attualmente `ParsedPath.recursiveDescendant` è definito come stub (`false`).
3. **Filtri completi `?()`** (#10): attualmente `checkCondition()` e `SingleStepHandler.verifyCondition()` supportano solo uguaglianze semplici su proprietà dirette (`[?(@.prop===val)]`), senza operatori di confronto (`!=`, `!==`, `==`, `>`, `<`, `>=`, `<=`), operatori logici (`&&`, `||`, `!`), proprietà annidate o controlli di esistenza.
4. **Operatore elemento corrente `@`** (#11): supporto completo a `@` sia come riferimento al valore corrente (es. su array di primitivi `[?(@ > 10)]`), sia su proprietà annidate (`@.a.b`) e dentro le espressioni.
5. **Script expression `()`** (#12): valutazione di espressioni tra parentesi nei segmenti subscript (es. `$.employees[(1+1)]`, `$.employees[(@.length-1)]`).

## What Changes
- **Parser JSONPath (`parse` / `buildParsedPath`)**:
  - Estendere la tokenizzazione evitando lo split ingenuo su `.` che rompe `..` e le proprietà annidate nei filtri/espressioni.
  - Supportare `*` come membro (`.*`) e come subscript (`[*]`), impostando il flag wildcard su `ParsedPath` e trattando il risultato come risposta bulk.
  - Supportare `..` impostando `recursiveDescendant: true` sul segmento target.
  - Riconoscere espressioni subscript `(...)` distinte dai filtri `?(`...`)`.
- **Motore SAX (`MasterHandler` / `SingleStepHandler` / `PifferoStatus`)**:
  - Gestire il matching wildcard `*` su chiavi oggetto e indici array.
  - Gestire la discesa ricorsiva `..` tracciando uno stack di profondità/contesti per emettere tutti i sotto-alberi corrispondenti a qualsiasi livello.
  - Estendere il buffering temporaneo per valutare filtri composti/annidati e riferimenti `@` mantenendo il comportamento streaming per il resto del documento.
- **Valutatore espressioni (`ConditionEval`)**:
  - Estendere `ConditionEval` con un valutatore sicuro (senza `eval` arbitrario su input non fidato) per confronti, operatori logici, accesso a proprietà annidate di `@` ed espressioni script `()`.
- **Documentazione & Test**:
  - Aggiungere test unitari dedicati in `spec/` per ogni nuovo operatore e combinazione.
  - Aggiornare la tabella delle funzionalità nel `README.md` con `✅` al completamento di ciascuna feature.

## Impact
- **Affected specs**: `stream-parser`
- **Affected code**: `src/handler/mastehandler.ts`, `src/conditioneval/conditioneval.ts`, `README.md`, `spec/`
- **Tracked issues**: #8 (`*`), #9 (`..`), #10 (`?()`), #11 (`@`), #12 (`()`)
- **Breaking changes**: Nessuno sull'API pubblica (`Piffero.findByPath`, `Piffero.findAsString`, `Piffero.findAsPromise`). Le query già supportate mantengono semantica e ordinamento di output invariati.
