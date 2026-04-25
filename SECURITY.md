# Security

## Reporting a vulnerability

Please **do not** file a public GitHub issue for security problems.

- Email the maintainers or open a private report if that option is available in this repository.
- Include steps to reproduce, impact, and any suggested fix you may have.

## Secret handling

- `CURSOR_API_KEY` is a secret. Do not commit it, paste it in issues, or check it into logs.
- The CLI loads `.env` at startup via `dotenv` when present. Keep `.env` in `.gitignore` (it is, by default here).

## Third-party access

- AgentLedger calls **GitHub** via the `gh` CLI and the **Cursor** API via `@cursor/february` using your `CURSOR_API_KEY`.
- Review the [Cursor terms of service](https://cursor.com/terms-of-service) and your GitHub / organization policies before use.
