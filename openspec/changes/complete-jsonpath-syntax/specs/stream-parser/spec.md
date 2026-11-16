# Spec Delta: Stream Parser & JSONPath Engine (`complete-jsonpath-syntax`)

## ADDED Requirements

### Requirement: Wildcard Operator (`*`)
Il parser e il motore streaming DEVONO supportare l'operatore wildcard `*` sia come selettore di proprietà (`.*`) sia come selettore di elementi di array (`[*]`), restituendo un array JSON valido con tutti i valori corrispondenti in ordine di apparizione nel documento.

#### Scenario: Wildcard su elementi di un array
- **GIVEN** uno stream JSON contenente un array `employees` di oggetti con proprietà `name`
- **WHEN** viene invocato `Piffero.findByPath(stream, "$.employees[*].name")`
- **THEN** lo stream risultante emette un array JSON valido contenente il `name` di ciascun elemento nell'ordine originale.

#### Scenario: Wildcard su proprietà di primo livello
- **GIVEN** uno stream JSON avente un oggetto root con più proprietà
- **WHEN** viene invocato `Piffero.findAsPromise(stream, "$.*")`
- **THEN** la Promise si risolve con una stringa JSON rappresentante l'array dei valori di tutte le proprietà di primo livello.

---

### Requirement: Recursive Descent Operator (`..`)
Il parser e il motore streaming DEVONO supportare l'operatore di discesa ricorsiva `..` per individuare tutte le occorrenze di una proprietà o sotto-percorso a qualsiasi profondità di annidamento nel documento JSON, senza caricare l'intero documento in memoria.

#### Scenario: Discesa ricorsiva dalla root
- **GIVEN** uno stream JSON con proprietà `number` presenti a diversi livelli di annidamento
- **WHEN** viene invocato `Piffero.findByPath(stream, "$..number")`
- **THEN** lo stream risultante emette tutti i valori associati alla chiave `number` in ordine di attraversamento depth-first.

#### Scenario: Discesa ricorsiva da un sotto-percorso
- **GIVEN** uno stream JSON con un array `employees` contenente oggetti annidati
- **WHEN** viene invocato `Piffero.findByPath(stream, "$.employees..type")`
- **THEN** vengono emessi i soli valori `type` contenuti all'interno del sotto-albero `employees`.

---

### Requirement: Current Element Reference (`@`)
Il motore JSONPath DEVE supportare `@` come riferimento all'elemento corrente sia all'interno di filtri su oggetti (incluse proprietà annidate come `@.address.city`) sia direttamente su elementi primitivi in un array (es. `[?(@ > 10)]`).

#### Scenario: Filtro su array di primitivi con `@`
- **GIVEN** uno stream JSON con `"scores": [5, 12, 8, 20]`
- **WHEN** viene invocato `Piffero.findByPath(stream, "$.scores[?(@ > 10)]")`
- **THEN** lo stream emette `[12,20]`.

#### Scenario: Accesso a proprietà annidata con `@`
- **GIVEN** uno stream JSON con oggetti contenenti `"address": { "city": "Rome" }`
- **WHEN** viene invocato `Piffero.findByPath(stream, "$.users[?(@.address.city==='Rome')].name")`
- **THEN** vengono estratti i soli nomi degli utenti con `address.city === "Rome"`.

---

### Requirement: Complete Filter Expressions (`?()`)
Il motore DEVE supportare espressioni filtro `?()` complete comprendenti operatori di confronto (`===`, `!==`, `==`, `!=`, `>`, `<`, `>=`, `<=`), operatori logici (`&&`, `||`, `!`) e verifica di esistenza della proprietà (`[?(@.prop)]`).

#### Scenario: Filtro composto con operatori di confronto e logici
- **GIVEN** uno stream JSON con un array `items` di oggetti aventi `price` e `inStock`
- **WHEN** viene invocato `Piffero.findByPath(stream, "$.items[?(@.price >= 10 && @.inStock === true)]")`
- **THEN** vengono emessi i soli oggetti di `items` che soddisfano entrambe le condizioni.

#### Scenario: Filtro di esistenza proprietà
- **GIVEN** uno stream JSON con oggetti in cui solo alcuni possiedono la chiave `isbn`
- **WHEN** viene invocato `Piffero.findByPath(stream, "$.books[?(@.isbn)]")`
- **THEN** vengono emessi i soli oggetti che contengono la proprietà `isbn`.

---

### Requirement: Script Expressions (`()`)
Il parser DEVE supportare espressioni script `(...)` nei segmenti subscript per il calcolo di indici tramite valutazione statica o riferimenti all'elemento corrente (es. `@.length`).

#### Scenario: Espressione aritmetica statica come indice
- **GIVEN** uno stream JSON contenente un array `employees` di almeno 3 elementi
- **WHEN** viene invocato `Piffero.findByPath(stream, "$.employees[(1+1)]")`
- **THEN** viene emesso l'elemento all'indice `2`.

#### Scenario: Espressione basata su `@.length`
- **GIVEN** uno stream JSON contenente un array `employees`
- **WHEN** viene invocato `Piffero.findByPath(stream, "$.employees[(@.length-1)]")`
- **THEN** viene emesso l'ultimo elemento dell'array `employees`.
