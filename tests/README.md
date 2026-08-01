# Tests

```bash
npm test               # all tests with coverage
npm run test:unit      # unit tests only
```

- Tests must run with `NODE_ENV=test` (enforced by `tests/setup.js`).
- No real network calls: the TCP client accepts an injectable `createConnection`, and unit tests use a fake socket.
- Coverage threshold: 80% (branches/functions/lines/statements) on the testable core.
