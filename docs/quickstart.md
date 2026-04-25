# Quickstart (source)

1. **Prerequisites**
   - Node.js 20+
   - [GitHub CLI `gh`](https://cli.github.com/) installed and logged in: `gh auth login`
   - A [Cursor](https://cursor.com/) API key: `export CURSOR_API_KEY=...` (or a `.env` file in the AgentLedger project)

2. **Install dependencies**

   ```bash
   cd agentledger
   npm install
   npm run build
   ```

3. **Point at a local clone and an issue**

   ```bash
   node dist/index.js run \
     --issue https://github.com/org/repo/issues/1 \
     --repo /path/to/clone
   ```

4. **Artifacts** land under the target repo in `.agent-ledger/runs/<run-id>/`.

5. **Split flow** (interpret then code later)

   ```bash
   node dist/index.js interpret --issue ... --repo ...
   node dist/index.js execute --run-id <run-id-from-output> --repo ...
   ```

See [commands.md](commands.md) for all options.
