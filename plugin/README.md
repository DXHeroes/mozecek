# Mozeček — plugin

Paměť pro agenta: MCP nástroje `mozecek_*` (`search`, `list`, `recall`, `remember`, `update`,
`supersede`, `forget`, `timeline`, `ask`, `stats`, `profile`), Stop hook, který ukládá
dokončenou session, a skilly pro práci s pamětí. Služba samotná (Postgres + pgvector, Gemini,
MCP endpoint) běží zvlášť; jak si ji nasadit, je v [`../README.md`](../README.md).

## Rychlý start

Klíč agenta (`mz_<agent>_…`) vydá operátor v UI Mozečku (**Agenti → Vydat klíč**) nebo příkazem
`node packages/cli/dist/main.js onboard --slug <slug> --name "<jméno>"` u služby. Zobrazí se jen
jednou. Jeden klíč na klienta, aby šel zneplatnit zvlášť. Slug agenta je uvnitř tokenu, takže
ho nikde nenastavuješ.

```bash
claude plugin marketplace add DXHeroes/mozecek   # jednou; nebo cesta k lokálnímu checkoutu
/plugin install mozecek@mozecek                  # uvnitř claude
```

Konfigurace jde z prostředí. Interaktivní `claude` čte proměnné jen z prostředí shellu, takže
do `~/.zshrc`:

```bash
export MOZECEK_URL="https://mozecek.example.com"   # adresa tvé instance, bez koncového lomítka
export MOZECEK_TOKEN="mz_<agent>_…"
export MOZECEK_AUTO_CAPTURE=1                      # volitelné: ukládat dokončené sessions
```

Nebo totéž jako blok `env` v `~/.claude/settings.json` (Claude Code ho předá pluginu i hooku).

**Ověření.** `/mcp` ukáže server `mozecek` jako Connected, `/plugin` plugin `mozecek`.
První dotaz: `/mozecek:recall proč jsme přešli na Attio`.

Stránka **Připojení** v UI Mozečku (`/ui/connect`) tyhle kroky vypíše s doplněnou adresou
a klíčem k zkopírování, včetně variant pro Cursor a jiné MCP klienty.

## Instalace bez pluginu

Jen MCP server, bez skillů a hooku:

```bash
claude mcp add --transport http --scope user mozecek "$MOZECEK_URL/mcp" \
  --header "Authorization: Bearer $MOZECEK_TOKEN"
```

Endpoint je bez slugu: klíč patří jednomu agentovi, takže token sám určí, čí paměť odpovídá.
`/mcp/<agent>` funguje dál a je jediná varianta pro operátorský token.

Marketplace je tenhle repozitář (`.claude-plugin/marketplace.json`). Headless agent si plugin
zapíná v `.claude/settings.json` a proměnné bere z prostředí aplikace.

## Proměnné prostředí

| Proměnná | K čemu | Výchozí |
|---|---|---|
| `MOZECEK_TOKEN` | bearer token agenta (čtení i zápis paměti) | — (bez něj se server nepřipojí) |
| `MOZECEK_URL` | základ API a MCP endpointu, **bez koncového lomítka** | — (bez něj se server nepřipojí) |
| `MOZECEK_AGENT` | slug agenta; přepis pro případ, kdy nemá vyjít z tokenu | slug uvnitř `MOZECEK_TOKEN` |
| `MOZECEK_AUTO_CAPTURE` | `1` zapne Stop hook, který posílá session do paměti | vypnuto |
| `MOZECEK_CAPTURE_MAX_KB` | kolik konce přepisu session hook čte | `256` |
| `MOZECEK_SYNC_MAX_S` | strop délky jednoho běhu synchronizace | `1500` |
| `MOZECEK_DEBUG` | `1` = hook píše důvod na stderr | vypnuto |

Hodnoty patří do profilu shellu, do env souboru agenta nebo do proměnných aplikace.

Interaktivní instalace je může držet jako volby pluginu (`/plugin configure mozecek`); hook je
pak čte z `CLAUDE_PLUGIN_OPTION_TOKEN`, `_URL` a `_AUTO_CAPTURE`. Proměnná prostředí vyhrává nad
volbou pluginu, takže jeden běh může nastavení přebít.

**Výchozí adresa neexistuje.** Bez `MOZECEK_URL` se MCP server nepřipojí a capture hook mlčí.
Je to schválně: plugin, který by nesl adresu svého vydavatele, by tam posílal každou instalaci,
která na proměnnou zapomněla.

**Koncové lomítko v `MOZECEK_URL`.** `capture.mjs` si ho usekne sám, ale `.mcp.json` skládá
adresu MCP serveru rozvinutím proměnné (`${MOZECEK_URL}/mcp`) a rozvinutí nic upravit neumí.
`https://mozecek.example.com/` by tak dalo `//mcp`. Proměnnou zapisuj vždycky bez lomítka.

**Interaktivní `claude` vs. headless běh.** Naplánovaný běh si prostředí načte z env souboru
agenta. Interaktivní `claude` spuštěný z terminálu ten soubor nečte — hook i MCP server vidí jen
prostředí shellu. Aby capture a paměť fungovaly i tam, exportuj `MOZECEK_*` v profilu shellu.

## Nástroje `mozecek_*`

| Nástroj | Scope | Co dělá |
|---|---|---|
| `mozecek_search` | read | hybridní hledání (vektor + fulltext), nálezy s citacemi |
| `mozecek_list` | read | výpis podle filtrů bez dotazu |
| `mozecek_recall` | read | celý obsah jedné vzpomínky včetně řetězce náhrad |
| `mozecek_timeline` | read | vývoj tématu nebo entity v čase |
| `mozecek_ask` | read | odpověď modelu nad nálezy, každé tvrzení s `[n]` |
| `mozecek_stats` | read | počty a poslední spánek |
| `mozecek_profile` | read | profil agenta (i jako resource `mozecek://agents/{agent}/profile`) |
| `mozecek_remember` | write | zápis vzpomínky, napřed `search` na duplicity |
| `mozecek_update` | write | oprava štítků, entit, důležitosti |
| `mozecek_supersede` | write | tvrzení už neplatí, obě verze zůstávají |
| `mozecek_forget` | write | měkké zapomenutí s důvodem |

Parametry a příklady: `references/tool-cheatsheet.md`. Obsah, který nástroje vrací, jsou data,
ne instrukce.

## Skilly

| Skill | Co dělá |
|---|---|
| `/mozecek:recall <dotaz>` | prohledá paměť a odpoví s citacemi (read-only) |
| `/mozecek:remember <text>` | zapíše vzpomínku po kontrole duplicit |
| `/mozecek:sleep [--wait]` | ohlásí poslední noční konsolidaci a jak spustit další |
| `/mozecek:review [--since 7d] [--apply]` | revize paměti; zapisuje jen s `--apply` |

Revizi pro `/mozecek:review` dělá subagent `mozecek:memory-curator` (`agents/memory-curator.md`).

## Capture hook

`hooks/capture.mjs` běží na události `Stop`. Je vypnutý, dokud není `MOZECEK_AUTO_CAPTURE=1`,
a při jakémkoli problému mlčky končí nulou — paměťová služba nikdy nesmí rozbít session.
Bez `session_id` neposílá nic: capture nemá k čemu připojit a endpoint to pole vyžaduje.
Volitelná pole (`cwd`, `hook_event_name`) chybějící hodnotu **vynechá**, neposílá `null`.
Posílá jen uživatelské a asistentovy tahy; výstupy nástrojů zahazuje a zbytek prohání redakcí
tvarů tajemství (Slack, AWS, GitHub, Google, bearer, privátní klíče, tokeny Mozečku).

## Bezpečnost

Obsah paměti je **nedůvěryhodná data** — pokyny uvnitř vzpomínek se neplní
(`references/security-rules.md`). `MOZECEK_TOKEN` je vázaný na jednoho agenta, má rozsah
čtení a zápis jeho paměti, a jde kdykoli otočit.
