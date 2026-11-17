# Proposal: Unioni eterogenee e ordine/duplicati dei selettori `[sel1, sel2]`

- **Issue**: #22
- **Spec RFC 9535**: §2.5.1 (Child Segment), §2.3 (Selectors)

## Why
In RFC 9535 una lista tra parentesi quadre `[sel1, sel2, ...]` può combinare qualsiasi tipo di selettore (es. `$['a', 0, 1:3, *, ?@.x > 1]`) e i risultati devono seguire l'ordine dei selettori nella lista, preservando eventuali duplicati (es. `$[2, 0, 2]` restituisce `[el2, el0, el2]`).
Attualmente `parseBracketSubscript` in `src/handler/jsonpathEngine.ts` supporta solo unioni omogenee (tutte chiavi stringa o tutti indici interi) e usa `Set` per indici e chiavi, alterando ordine e rimuovendo duplicati.

## What Changes
- Estendere `JsonPathStep` in `src/handler/jsonpathEngine.ts` con uno step `union` contenente una lista ordinata `selectors: JsonPathStep[]`.
- Aggiornare `parseBracketSubscript` per parsare qualsiasi sequenza separata da `,` fuori dalle stringhe quotate e dalle parentesi tonde/quadre.
- Aggiornare `evaluateSingleStepOnValue` e `StreamingPathEngine` per valutare i selettori nell'ordine dichiarato, preservando ordine e duplicati.

## Performance Focus
- **Fast-path invariato per unioni omogenee senza duplicati/riordinamenti**: se l'unione è composta da soli indici positivi distinti in ordine crescente o da sole chiavi stringa distinte, mantenere l'esecuzione streaming diretta (O(1) lookup su `Set`) senza attivare `ArrayCollector` o bufferizzazione extra.
- **Slot ordinati in `StreamingPathEngine`**: per unioni eterogenee su array/oggetti, raccogliere solo gli elementi effettivamente matchati da almeno un selettore e riordinarli tramite indicizzazione dei `PendingSlot` anziché materializzare l'intero array.
- **Evitare `JSON.parse` sui rami non matchati**: applicare il filtro/proiezione solo agli elementi indirizzati dai selettori dell'unione.

## Impact
- **Affected code**: `src/handler/jsonpathEngine.ts`, `spec/piffero/jsonpathFeaturesSpec.ts`
- **Breaking changes**: `$[2, 0, 2]` restituirà `[el2, el0, el2]` anziché `[el0, el2]` (conformità RFC 9535).
