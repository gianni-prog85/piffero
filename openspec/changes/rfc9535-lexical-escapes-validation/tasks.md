# Tasks: Escape Unicode e validazione lessicale RFC 9535 (#25)

- [x] Aggiornare `tryUnquoteString` in `src/handler/jsonpathEngine.ts` con fast-path `indexOf("\\") === -1` e decodifica completa `\b`, `\f`, `\n`, `\r`, `\t`, `\/`, `\uXXXX` + surrogate pairs.
- [x] Allineare `unescapeStringLiteral` in `src/conditioneval/conditioneval.ts` per gestire correttamente le coppie surrogate UTF-16 e rifiutare sequenze `\u` malformate.
- [x] Aggiungere validazione limiti interi I-JSON `[-(2^53)+1, (2^53)-1]` in `parseBracketSubscript` per indici e slice.
- [x] Validare `member-name-shorthand` secondo RFC 9535 §2.5.1.1 in `tokenizeJsonPath`.
- [x] Aggiungere unit test per chiavi con emoji/surrogate (`$['\uD83D\uDE00']`), escape `\b`/`\f`/`\/` e errori su indici fuori range I-JSON.
