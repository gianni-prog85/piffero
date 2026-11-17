# Proposal: Semantica Slice RFC 9535 (`step < 0`, `step === 0`, `end === 0`)

- **Issue**: #23
- **Spec RFC 9535**: §2.3.4 (Array Slice Selector)

## Why
L'implementazione attuale in `src/handler/jsonpathEngine.ts` presenta tre divergenze rispetto a RFC 9535:
1. `step <= 0` lancia `PifferoJsonPathError` invece di supportare `step < 0` (slice inverso, es. `$[::-1]`) e restituire nodelist vuota per `step === 0`.
2. `end === 0` in `resolveSliceBounds` e `evaluateArrayElementSteps` viene trattato come `end = length`, facendo restituire tutto l'array a `$[0:0]` invece di `[]`.
3. Il fast-path legacy (`SingleStepHandler` / `PifferoStatus`) tratta anch'esso `range.end <= 0` come fine array.

## What Changes
- Implementare l'algoritmo ufficiale `Bounds(start, end, step, len)` di RFC 9535 §2.3.4.2.2 in `resolveSliceBounds`.
- Distinguere esplicitamente `end === undefined` da `end === 0` in `LegacyParsedPath.range`, `SingleStepHandler`, `evaluateArrayElementSteps` e `StreamingPathEngine`.
- Supportare `step < 0` in `StreamingPathEngine` tramite `ArrayCollector` (con supporto all'early-exit quando `start >= 0` e `end >= 0` non richiedono la lunghezza totale).

## Performance Focus
- **Fast-path O(1) preservato**: per `step > 0` con `start >= 0` ed `end` assente o `> 0`, mantenere lo streaming diretto senza buffering (`needsStreamingEngine` non deve attivarsi inutilmente, né allocare `ArrayCollector`).
- **Early-exit su `step === 0`**: terminare immediatamente senza scansionare l'array (o saltando direttamente lo stream quando possibile).
- **Ring-buffer O(k) per tail reverse slice**: per slice inversi su coda finita (es. `$[-3::-1]`), riutilizzare il meccanismo `tailKeep` di `ActiveArrayCollector` per evitare di bufferizzare l'intero array in RAM su file da 200+ MiB.

## Impact
- **Affected code**: `src/handler/jsonpathEngine.ts`, `src/handler/mastehandler.ts`, `spec/piffero/`
- **Breaking changes**: `$[0:0]` restituirà `[]` anziché l'intero array (allineamento allo standard RFC 9535).
