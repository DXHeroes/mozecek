# Paměťový model Mozečku

Co je vzpomínka, jak stárne a co znamenají pole, která nástroje `mozecek_*` vracejí.

## Contents
- [Vrstvy (tier)](#vrstvy-tier)
- [Druhy (kind)](#druhy-kind)
- [Stav (status) a řetěz nahrazení](#stav-status-a-řetěz-nahrazení)
- [Viditelnost](#viditelnost)
- [Bitemporalita a `as_of`](#bitemporalita-a-as_of)
- [Confidence](#confidence)
- [Citace](#citace)
- [Spánek (sleep)](#spánek-sleep)
- [Workspace](#workspace)

## Vrstvy (tier)

| tier | co v něm žije | jak dlouho |
|---|---|---|
| `short` | co se právě děje: stav rozdělané práce, čerstvý kontext session | dny; spánek ji povýší, nebo jí vyprší TTL |
| `long` | ustálený fakt, postup, preference; sem patří i identita a tvrdá pravidla | trvale, dokud ji něco nenahradí |

Vrstvy jsou jen dvě. Nová vzpomínka bez `tier` padá do `short`. Do `long` ji posune buď spánek
(opakovaný výskyt, potvrzení), nebo `remember --long` u věci, o které je jasné, že platí dál.

## Druhy (kind)

- `semantic` — fakt o světě, firmě, člověku („Heureka fakturuje kvartálně“).
- `procedural` — jak se něco dělá („nasazení jde přes Coolify, auto-deploy je vypnutý“).
- `episodic` — co se stalo, s časem („7. 9. 2026 jsme se dohodli…“).
- `note` — poznámka bez nároku na pravdivost, nápad.

Dokumenty ze synchronizace brainu mají vlastní druhy, které nástroje vracejí ve výsledcích:
`fact` (položka L3), `summary` (L2), `evidence` (L4 originál), `profile`, `note`, `entity`.
Ty se přes `remember` nezapisují — vznikají synchronizací a jejich pravda je v repu.

## Stav (status) a řetěz nahrazení

**Nahrazení není status.** `status` nabývá těchhle hodnot:

| status | co znamená |
|---|---|
| `active` | platná vzpomínka — patří sem i ta, kterou už něco nahradilo |
| `expired` | krátkodobé vzpomínce vypršelo TTL a spánek ji nepovýšil |
| `archived` | odložená stranou: z běžného hledání zmizí, v auditu zůstává |
| `forgotten` | zapomenutá přes `forget`; nevrací se, z auditu nemizí |

- `supersede(old_id, content, reason)` vytvoří novou vzpomínku a té staré doplní
  `superseded_by: <nové id>` a `valid_until`. **Status staré vzpomínky zůstane `active`** —
  nepřestala být pravdivá, jen přestala platit k dnešku. Původní text zůstává čitelný;
  historie rozhodnutí je taky informace.
- `forget(id, reason)` přepne status na `forgotten`. Poslední možnost.
- Když nález nese `superseded_by`, uveď v odpovědi obojí: co platí teď a co platilo dřív
  (do `valid_until`). Nesmiřuj to do jedné věty.
- Běžné hledání nahrazené verze nevrací. `include_superseded: true` je pro otázky typu
  „co jsme si mysleli v červnu“, ne pro běžné hledání.

## Viditelnost

`visibility` odděluje, co smí ven z agenta: `private` (jen tenhle agent), `workspace`
(sdílené mezi agenty stejného workspace). Výchozí je `private` — sdílení je vědomé
rozhodnutí, ne default. `include_workspace: true` u hledání přibere sdílené vzpomínky
ostatních agentů workspace.

## Bitemporalita a `as_of`

Každá vzpomínka nese dva časy:

- `observed_at` — kdy platilo to, co vzpomínka tvrdí (čas světa).
- `recorded_at` — kdy se to Mozeček dozvěděl (čas systému).

Proto lze klást dvě různé otázky: „co platilo k 1. 7.“ (`as_of: "2026-07-01"` filtruje podle
`observed_at`) a „co jsme věděli k 1. 7.“ (co mělo do té doby `recorded_at`). `from`/`to`
zužují `observed_at`. Když zdroj čas neuvádí, `observed_at` je `null` — nedopočítávej ho.

## Confidence

Číslo 0–1. Popisky, které používej v odpovědích:

| rozsah | popisek |
|---|---|
| ≥ 0.75 | high |
| ≥ 0.45 a < 0.75 | medium |
| < 0.45 | low |

`min_confidence` u hledání odfiltruje slabé nálezy. Nízká confidence se v odpovědi přiznává,
neschovává. Co v citaci explicitně není, má low — nedomýšlej.

## Citace

Nástroje vracejí u každého nálezu `{ memory_id, path, line, line_end, quote, timestamp, url,
sha256, observed_at, recorded_at, confidence }`. `path` a `line` ukazují do repa, když
vzpomínka vznikla synchronizací souborů — tam se dá citace ověřit na disku:

```bash
sed -n '17,25p' <cesta z citace>
```

Bez citace není nález. Když nástroj citaci nevrátil, řekni to místo toho, abys ji doplnil.

## Spánek (sleep)

Noční konsolidace (03:30). Co dělá: povyšuje opakované `short` vzpomínky do `long`, hledá
rozpory a navrhuje `supersede`, přepočítává profil agenta a na `short` vzpomínky, které nikdo
nepotvrdil, pouští TTL (skončí jako `expired`). Vzpomínky ze synchronizovaného brainu
(`source.type: brain`) spánek nikdy neslučuje ani nevyřazuje; jejich pravdou je soubor. Slouží
jen jako podklad souhrnů per entita a tag. Výsledek je vidět ve `stats` jako `sleep_runs`.
Ruční spuštění popisuje skill `/mozecek:sleep`.

## Workspace

Workspace sdružuje agenty jednoho člověka nebo týmu; kdo do něj nepatří, dostane vlastní
workspace, takže na sebe navzájem nevidí. Každý agent má vlastní paměť; sdílené je jen to, co má
`visibility: workspace`.
