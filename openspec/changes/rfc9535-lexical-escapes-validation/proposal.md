# Proposal: Escape Unicode e validazione lessicale RFC 9535

- **Issue**: #25
- **Spec RFC 9535**: §2.1 (Overview / I-JSON), §2.3.1.1 (String Literals), §2.5.1.1 (Member Name Shorthand)

## Why
Per la piena conformità lessicale a RFC 9535:
1. `tryUnquoteString` in `src/handler/jsonpathEngine.ts` gestisce solo `\n`, `\r`, `\t` nei selettori `['...']`, ignorando `\b`, `\f`, `\/`, `\uXXXX` e le coppie surrogate UTF-16 (`\uD83D\uDE00`).
2. `unescapeStringLiteral` in `src/conditioneval/conditioneval.ts` gestisce `\uXXXX` singoli ma non valida/combina le coppie surrogate UTF-16 né i limiti di codice.
3. Mancano i controlli sui limiti interi I-JSON `[-(2^53)+1, (2^53)-1]` per indici e slice, e la validazione rigorosa di `member-name-shorthand` (es. caratteri di controllo o spazi non ammessi).

## What Changes
- Unificare/allineare la decodifica delle stringhe quotate tra `jsonpathEngine.ts` e `conditioneval.ts` con supporto completo a `\b`, `\f`, `\n`, `\r`, `\t`, `\/`, `\\`, `\'`, `\"` e `\uXXXX` (incluse coppie surrogate high+low).
- Validare i limiti I-JSON (`Number.isSafeInteger`) per gli indici e gli estremi degli slice.
- Validare gli identificatori `member-name-shorthand` secondo la grammatica ABNF di RFC 9535 §2.5.1.1.

## Performance Focus
- **Fast-path senza backslash**: mantenere il controllo `if (raw.indexOf("\\") === -1)` per evitare regex o cicli carattere-per-carattere nel 99% dei selettori privi di escape.
- **Validazione esclusivamente a compile-time**: tutti i controlli lessicali avvengono in `tokenizeJsonPath` (una sola volta per query), con **zero impatto** sul loop di parsing SAX.

## Impact
- **Affected code**: `src/handler/jsonpathEngine.ts`, `src/conditioneval/conditioneval.ts`, `spec/piffero/errorSpec.ts`, `spec/piffero/jsonpathFeaturesSpec.ts`
- **Breaking changes**: Query sintatticamente non valide secondo RFC 9535 (es. indici fuori range I-JSON) lanceranno `PifferoJsonPathError`.
