# Clean tab — banner picture by time, text by state

The live content has no time-slab list yet, only `morning_switch_time`. The app will read it in the shape below once Command Center adds it. Until then it uses its own built-in skies.

## How the banner is chosen
1. **Campaign active** (`campaign.active`): the campaign's own picture, title and sub-line are used. Nothing else applies.
2. **Otherwise the picture** is the time slab that matches the current India time. A slab may cross midnight (for example 21:00–05:00). The slab also sets whether the text is light or dark.
3. **Otherwise the text** comes from the state:

```text
holiday today                         -> holiday text
open + Book Now allowed               -> open_available text
open + Book Now full                  -> open_busy text
closed, from morning switch to open   -> closed_morning text
closed, any other time                -> closed_evening text
```

## Text colour
- **Light slab** (on dark pictures): yellow title, white sub-line, soft shadow.
- **Dark slab** (on bright pictures): charcoal title and sub-line, no shadow.

## Filled-in words
- {greeting}: Good morning 05–12, Good afternoon 12–17, Good evening 17–21, Good night 21–05. In Marathi: सुप्रभात, शुभ दुपार, शुभ संध्याकाळ, शुभ रात्री.
- {name}: the customer's first name. For guests the name and the comma before it are dropped.
- {day}: today / tomorrow / the date, relative to the next opening.
- {open_time}: the opening time, for example 10 AM.
- {next_slot}: the next free half-hour from the full-slot list (today, or tomorrow's first).

## Built-in fallback (no slabs in Command Center)
| Time (India) | Look | Text |
|---|---|---|
| 05–08 | Sunrise | dark |
| 08–17 | Day | dark |
| 17–21 | Evening | light |
| 21–05 | Night | light |

## Technical details
- Expected field: `time_slabs: [{ from: "HH:MM", to: "HH:MM", image_url, text_tone: "light" | "dark" }]` at the top level of `app_service_content`. A slab matches when `from <= now < to`. If `from > to`, it matches when `now >= from || now < to`.
- Add `time_slabs` to the `ServiceContent` type.
- Split the current `pickBanner` into two parts:
  - `pickStateText`: holiday, open_available or open_busy, and closed_morning or closed_evening using `morning_switch_time`.
  - `pickSlab`: the picture and tone, from Command Center slabs or the built-in table.
- Add tokens in `styles.css`: `--hero-sunrise`, `--hero-day`, `--hero-evening`, `--hero-night` (gradients), plus `--hero-title-dark` (charcoal). Add a `hero-text-light` / `hero-text-dark` pair of utilities.
- The `{greeting}`, `{name}`, `{day}`, `{open_time}` and `{next_slot}` logic already exists and is reused unchanged.
- Checks: typecheck, and a Playwright screenshot with the clock mocked to 03:00, 07:00, 14:00 and 19:00 IST.
