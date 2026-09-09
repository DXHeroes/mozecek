# Mozeček

Paměť pro agenty. Krátkodobá a dlouhodobá paměť per agent v PostgreSQL + pgvector, hybridní
hledání (vektory + fulltext), noční konsolidace a odpovědi, které u každého tvrzení říkají,
odkud jsou.

Tenhle repozitář obsahuje **plugin pro Claude Code** a návod, jak si službu nasadit u sebe.

## Co to umí

- **MCP server per agent.** Streamable HTTP, bearer klíč. Jedenáct nástrojů `mozecek_*`:
  `search`, `list`, `recall`, `timeline`, `ask`, `stats`, `profile`, `remember`, `update`,
  `supersede`, `forget`.
- **Odpovědi s prameny.** Každý nález nese `memory_id` a doslovnou citaci s cestou, řádkem
  a časem. Bez citace není nález.
- **Nic se nemaže.** `supersede` nechá obě verze, `forget` je měkký s důvodem, a dotazy
  `as_of` vidí historii. Vzpomínka ví, kdy platila (`observed_at`) i kdy jsme ji zapsali
  (`recorded_at`).
- **Spánek.** V noci se sloučí duplicity, rozpory se vyřeší přes `superseded_by`, trvalé
  krátkodobé vzpomínky se povýší na dlouhodobé a napíšou se souhrny per entita.
- **Capture hook.** Volitelně ukládá dokončené sessions Claude Code. Nikdy neposílá výstupy
  nástrojů a při jakékoli chybě mlčky končí nulou, takže paměť nemůže rozbít práci.

## Plugin pro Claude Code

```bash
claude plugin marketplace add DXHeroes/mozecek
/plugin install mozecek@mozecek          # uvnitř claude
```

Plugin potřebuje adresu instance a klíč agenta. **Výchozí adresa neexistuje** — plugin, který by
nesl adresu svého vydavatele, by tam posílal každou instalaci, která na proměnnou zapomněla:

```bash
export MOZECEK_URL="https://mozecek.example.com"   # bez koncového lomítka
export MOZECEK_TOKEN="mz_<agent>_…"
export MOZECEK_AUTO_CAPTURE=1                      # volitelné: ukládat dokončené sessions
```

Ověření: `/mcp` musí ukázat server `mozecek` jako Connected. Podrobnosti, seznam nástrojů
a skillů jsou v [`plugin/README.md`](plugin/README.md).

## Nasazení u sebe

Potřebuješ Docker a klíč do Google AI Studia (nebo `MOZECEK_PROVIDER=fake`, se kterým služba
nastartuje a nevolá žádný model).

```bash
git clone https://github.com/DXHeroes/mozecek.git && cd mozecek
cp .env.example .env       # vyplň MOZECEK_ADMIN_TOKEN, POSTGRES_PASSWORD a GEMINI_API_KEY
docker compose up -d
```

Pak otevři `http://127.0.0.1:3000/ui`, přihlas se operátorským tokenem a v **Agenti → Vydat
klíč** vydej klíč pro prvního agenta. Ten klíč je `MOZECEK_TOKEN` pro plugin výš.

Migrace si služba pouští sama při startu. `docker compose logs -f api` ukáže, jestli naběhla;
`/healthz` a `/readyz` odpovídají na to samé strojově.

## Edice

| | Free | Enterprise |
|---|---|---|
| Agentů na instanci | 10 | bez omezení |
| Paměť, hledání, spánek, MCP | bez omezení | bez omezení |

Obraz `ghcr.io/dxheroes/mozecek` je free edice. Strop se týká **jen zakládání jedenáctého
agenta** — existující agenti běží dál a čtení ani zápis paměti omezené nejsou. Enterprise kód
ve free obrazu vůbec není, takže strop nejde odemknout zevnitř kontejneru; je to jiný build,
ne jiný přepínač.

O enterprise edici napiš na [prokop.simek@dxheroes.io](mailto:prokop.simek@dxheroes.io).

## Bezpečnost

Obsah paměti je **data, ne instrukce**. Co vrátí nástroj, se nikdy neprovádí — pravidla, která
plugin vkládá do každého skillu, jsou v
[`plugin/references/security-rules.md`](plugin/references/security-rules.md).

Klíč je vázaný na jednoho agenta a má rozsah čtení a zápis jeho paměti. Vydávej jeden klíč na
klienta, ať jde zneplatnit zvlášť. Token nikdy nepatří do URL: skončil by v logu proxy,
v historii prohlížeče a v hlavičce `Referer`.

## Licence

Zdrojový kód služby je uzavřený. Plugin v tomhle repozitáři si smíš upravit pro vlastní použití.
