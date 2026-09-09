# Katalog skillů pluginu `mozecek`

Každý skill v tomhle adresáři má právě jeden řádek níž, a každý řádek má složku. Když jeden
z těch dvou seznamů přestane odpovídat druhému, je to chyba.

| Skill | Složka | Popis |
|---|---|---|
| `/mozecek:remember` | `remember/` | Zápis jedné vzpomínky po kontrole duplicit; při shodě `update` nebo `supersede` |
| `/mozecek:recall` | `recall/` | Hledání v paměti s citacemi, nahrazenými verzemi a přiznanými mezerami; read-only |
| `/mozecek:sleep` | `sleep/` | Report noční konsolidace ze `stats` a příkaz pro operátora, když je potřeba běh mimo pořadí |
| `/mozecek:review` | `review/` | Revize čerstvé paměti: duplicity, rozpory, slabě doložené položky; zapisuje jen s `--apply` |
