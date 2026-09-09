---
name: "sleep"
description: "Reports Mozecek's nightly memory consolidation from stats and explains how the operator triggers one out of turn. Use when memory feels unconsolidated, after a large import, or when someone asks when the agent last slept."
compatibility: "Claude Code (headless -p i interaktivně)"
metadata:
  author: "Prokop Simek"
  version: "0.2.0"
argument-hint: "[--wait]"
---

<input>
Bez argumentů vrátí stav poslední konsolidace hned. S `--wait` počká, jestli se během
několika minut objeví nový běh — na použití ve chvíli, kdy spánek právě spouští operátor.

<no-args-guard>
Použití: /mozecek:sleep [--wait]

Řekne, kdy paměť naposledy spala a co to udělalo, a když je potřeba spustit spánek mimo
pořadí, ukáže přesný příkaz pro operátora. Sám nic nespouští.
Tenhle blok je jen nápověda, běh pokračuje.
</no-args-guard>

Vstup: **$ARGUMENTS**
</input>

<dependencies>
- @file ../../references/agent-charter.md — společné hodnoty a pořadí autorit. **Načti vždy.**
- @file ../../references/security-rules.md — bezpečnostní pravidla. **Načti vždy.**
- @file ../../references/memory-model.md — co spánek dělá s vrstvami a rozpory.
- @file ../../references/tool-cheatsheet.md — `mozecek_stats` a jeho pole.
</dependencies>

<rules>
- **Tenhle skill spánek nespouští.** Je to admin operace pod admin tokenem služby, a ten
  v prostředí agenta nikdy není — drží ho jen služba a operátor. Klíč agenta se scope `admin`
  na to stačí taky, ale běžný klíč ho nemá. Skill čte `mozecek_stats` a hlásí; spuštění je
  krok pro operátora.
- **Admin token nehledej.** Nečti konfigurační soubory, proměnné prostředí ani nastavení
  služby, abys ho našel. Kdyby v prostředí náhodou byl, stejně ho nepoužij a nahlas to jako
  nález — je to chyba nastavení.
- **Token nikdy nevypisuj**, ani jeho část, ani v příkazu, který ukazuješ. V ukázce
  je to vždycky proměnná prostředí.
- **Datum nevymýšlej.** Když `stats` žádný běh neuvádí, napiš, že žádný neproběhl.
- Read-only: neupravuješ ani nemažeš žádnou vzpomínku. To dělá spánek na serveru.
</rules>

<workflow>
1. `mozecek_stats` — vezmi počty podle vrstev (`short`, `long`) a `sleep_runs`
   (kdy, jak dlouho, co běh udělal).
2. Rozhodni, jestli má smysl spánek mimo pořadí:
   - poslední běh je starší než 24 h, nebo
   - `short` je nezvykle nafouklé (typicky po velkém importu nebo po backfillu).
   Když nic z toho neplatí, jen ohlas stav a skonči — pravidelný běh v **03:30** stačí.
3. Když spánek mimo pořadí dává smysl, vypiš obě cesty pro operátora, ať si vybere. Slug
   agenta vezmi z `mozecek_stats`, nevymýšlej ho. V terminálu služby:
   ```bash
   node packages/cli/dist/main.js sleep --agent <slug> --wait
   ```
   Nebo HTTP, z prostředí, kde je admin token:
   ```bash
   curl -sS -X POST \
     -H "Authorization: Bearer $MOZECEK_ADMIN_TOKEN" \
     "$MOZECEK_URL/api/admin/agents/<slug>/sleep"
   ```
   Když paměť neobsluhuješ ty, je tohle krok pro toho, kdo instanci provozuje.
4. S `--wait` opakuj `mozecek_stats` po ~60 s, nejvýš třikrát, a skonči ve chvíli, kdy se
   `sleep_runs` změní. Když se nezmění, řekni to — neznamená to chybu, jen že spánek zatím
   nikdo nespustil.
5. Když `mozecek_stats` selže, řekni to a skonči. Je-li v pracovním adresáři
   uveď to ve výstupu jako nález.
</workflow>

<output-format>
## Spánek paměti

{Jedna věta: kdy paměť naposledy spala a jestli je potřeba běh mimo pořadí.}

### Poslední běh
{Datum a čas, trvání, co udělal: povýšeno do `long` n, navrženo `supersede` n, `expired` n.
Když žádný běh není: „Zatím neproběhl žádný spánek.“}

### Stav paměti
| vrstva | vzpomínek |
|---|---|
| short | {n} |
| long | {n} |

{S `--wait` a změnou během čekání: druhý sloupec „po“ se stavem po novém běhu.}

### Co dál
{Buď „Pravidelný běh v 03:30 stačí, nic nedělej.“, nebo oba příkazy z kroku 3 s vysvětlením,
proč spánek mimo pořadí navrhuji.}
</output-format>
