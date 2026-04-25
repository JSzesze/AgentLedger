# Contributing

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Pull requests

- Keep changes focused on one problem or feature.
- Run `npm run typecheck` and `npm test` before submitting.
- If you add behavior, add or extend tests under `src/**/*.test.ts`.

## Interpreter and Cursor

Issue interpretation and coding runs are powered by the Cursor API (`@cursor/february`) and a `CURSOR_API_KEY`. The repository does not accept keys or other secrets in code or in PR descriptions.
