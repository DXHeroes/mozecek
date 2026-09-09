# Pravidla pro agenty

Tenhle repozitář je veřejný a obsahuje dvě věci: plugin pro Claude Code (`plugin/`) a návod
na self-host (`README.md`, `compose.yml`). Služba samotná tady není.

- **Nic o konkrétním nasazení.** Žádná adresa instance, žádný slug agenta, žádné jméno klienta
  v kódu ani v příkladech. Příklady používají `mozecek.example.com` a `<agent>`.
- **Žádná výchozí adresa.** `plugin/.mcp.json` a `plugin/hooks/capture.mjs` nesmějí nést
  fallback URL. Bez `MOZECEK_URL` se plugin nepřipojí, a to je správně.
- **Verzi zvedej.** `plugin/.claude-plugin/plugin.json` — marketplace ho servíruje doslova
  a Claude Code drží plugin v cache podle verze.
- Konvence pro skilly a subagenty jsou v [`plugin/AGENTS.md`](plugin/AGENTS.md).

## Ověření

```bash
claude plugin validate ./plugin
claude plugin validate .
node --test plugin/hooks/capture.test.mjs
```
