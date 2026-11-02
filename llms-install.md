# Installing mi-sii-mcp (guide for AI agents)

mi-sii-mcp is a local, read-only MCP server (stdio) for Chile's tax service (SII). It is published on npm as `mi-sii-mcp`, so there is nothing to clone or build. Talk to the user in Spanish unless they write in another language.

## 1. Check Node.js

Run `node --version`. It must be 22.12 or newer. If it is missing or older, ask the user to install the LTS version from https://nodejs.org and stop until they confirm.

## 2. Register the server

Add this entry to the MCP settings of the client (for Cline: `cline_mcp_settings.json`; for clients that use the `mcpServers` format, the same entry). Keep any other servers that are already there.

```json
{
  "mcpServers": {
    "mi-sii-mcp": {
      "command": "npx",
      "args": ["-y", "mi-sii-mcp@latest", "mcp"]
    }
  }
}
```

No environment variables or API keys are needed. Optional: `MI_SII_MCP_HOME` changes the data folder (default `~/.mi-sii-mcp`).

Client-specific notes:

- **Codex:** prefer the plugin (`codex plugin marketplace add Taksuma-0/mi-sii-mcp`, then `codex plugin add mi-sii-mcp@mi-sii-mcp`). If you register only the server in `~/.codex/config.toml`, add `startup_timeout_sec = 120` and `tool_timeout_sec = 900`: Codex defaults to 10 s and 60 s, and a 12-month sync takes longer.
- **Grok Build:** `grok mcp add mi-sii-mcp -- npx -y mi-sii-mcp@latest mcp`. It also loads what is already configured in Claude Code.
- **Claude Code:** `/plugin install mi-sii-mcp --marketplace Taksuma-0/mi-sii-mcp` installs the server and its skill.
- **Gemini CLI:** `gemini extensions install https://github.com/Taksuma-0/mi-sii-mcp` installs the server and its skill.

## 3. Connect the SII account (the user does this, not you)

Never ask for the SII password (clave tributaria) or ClaveÚnica, and never type it for the user.

Once the server is connected, call the `cuenta_conectar` tool: it opens a local page in the user's browser where they type their RUT and password and tick «Mantener conectada», or log in with ClaveÚnica. If the MCP connection is not ready yet, ask the user to run `npx -y mi-sii-mcp@latest conectar` in their own terminal, which opens the same page.

Terminal-only alternative, replacing the example RUT with theirs:

```bash
npx -y mi-sii-mcp@latest login 11111111-1 --guardar-clave
```

The program asks for the password with hidden input and stores it in the operating system's credential store, so the session renews itself. With ClaveÚnica (experimental): `npx -y mi-sii-mcp@latest login-navegador --rut 11111111-1`, which opens Edge or Chrome on the real SII page.

## 4. Verify

Restart or reload the MCP servers, then call the `perfiles_listar` tool: the user's RUT should appear with an active session. Then call `sii_panorama` for that RUT. If a tool returns `SESION_REQUERIDA`, call `cuenta_conectar` again.

## Notes

- Read-only: the server never files returns or issues documents in the SII.
- Data stays on the user's computer, in SQLite. What the tools return goes into the conversation.
- Not affiliated with the SII; not tax advice.
- Full documentation: https://github.com/Taksuma-0/mi-sii-mcp (README in Spanish) and https://taksuma-0.github.io/mi-sii-mcp/
