# Tasks: Escape Unicode e validazione lessicale RFC 9535 (#25)

- [ ] Aggiornare `tryUnquoteString` in `src/handler/jsonpathEngine.ts` con fast-path `indexOf("\\") === -1` e decodifica completa `\b`, `\f`, `\n`, `\r`, `\t`, `\/`, `\uXXXX` + surrogate pairs.
- [ ] Allineare `unescapeStringLiteral` in `src/conditioneval/conditioneval.ts` per gestire correttamente le coppie surrogate UTF-16 e rifiutare sequenze `\u` malformate.
- [ ] Aggiungere validazione limiti interi I-JSON `[-(2^53)+1, (2^53)-1]` in `parseBracketSubscript` per indici e slice.
- [ ] Validare `member-name-shorthand` secondo RFC 9535 §2.5.1.1 in `tokenizeJsonPath`.
- [ ] Aggiungere unit test per chiavi con emoji/surrogate (`$['\uD83D\uDE00']`), escape `\b`/`\f`/`\/` e errori su indici fuori range I-JSON.
