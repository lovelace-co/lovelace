# Lovelace Design System

Reference implementation: `lovelace-ui-v4.html`. This document explains the system behind it so the visual language can be applied to the existing UX rather than adopting the mockup's layout. Where this doc and the HTML disagree, the HTML wins — it is the source of truth for exact values.

## 1. Design intent

Lovelace is a calm instrument for developers working alongside AI agents. The design reduces sensory load in three ways:

1. **No borders.** Separation comes from changes in tone (background colour steps) and from whitespace, never from lines.
2. **One electric signal.** A single high-saturation cyan is reserved for the few places that genuinely need attention — agent activity, selection, focus. It is never used as a background fill of any element.
3. **Heritage as interaction language.** Ada Lovelace / Jacquard loom: *weaving* is the continuous (motion, the circling thread, tonal bands), *punchcards* are the discrete (clicks, progress holes). Fluid things animate fluidly; state changes feel mechanical and stepped.

A useful test for any new element: does it demand attention the user didn't ask for? If yes, remove or quiet it.

## 2. Colour tokens

All colour is expressed as CSS custom properties on `:root`, overridden by `[data-theme="light"]`. Components never reference raw hex values — only tokens. This is what makes light mode a zero-component-change feature (see §8).

### Dark theme (default)

| Token | Value | Role |
|---|---|---|
| `--bg-0` | `#14181D` | Sidebar / deepest surface |
| `--bg-1` | `#171C22` | Main canvas |
| `--band` | `rgba(214,230,242,0.018)` | Alternating column bands ("weft") |
| `--raise` | `rgba(214,230,242,0.03)` | Card resting background |
| `--raise-2` | `rgba(214,230,242,0.055)` | Live (agent-active) card background |
| `--ink` | `#DFE5EB` | Primary text — titles, headers |
| `--slate` | `#79838F` | Secondary text — metadata, done titles |
| `--mist` | `#4C555F` | Tertiary — chrome, labels, counts, IDs |
| `--current` | `#22D3EE` | The electric signal |
| `--current-soft` | `#67E8F9` | Lighter end of the signal (thread tail) |
| `--wash` | `rgba(34,211,238,0.06)` | Hover background (signal at low alpha) |

### Light theme

| Token | Value |
|---|---|
| `--bg-0` | `#EDF1F6` |
| `--bg-1` | `#F7F9FC` |
| `--band` | `rgba(72,101,140,0.035)` |
| `--raise` | `rgba(72,101,140,0.05)` |
| `--raise-2` | `rgba(72,101,140,0.085)` |
| `--ink` | `#2A313B` |
| `--slate` | `#6E7987` |
| `--mist` | `#9AA4B0` |
| `--current` | `#0BA5C9` |
| `--current-soft` | `#22D3EE` |
| `--wash` | `rgba(11,165,201,0.07)` |

Note the accent darkens in light mode (`#0BA5C9`): full electric cyan is illegible on white, so light mode trades a little voltage for contrast. Decorative uses (the circling thread) may still use the brighter `--current-soft`.

### Pill tokens

Pills are washes (low-alpha backgrounds) with desaturated text — never bordered, never saturated fills.

| Token | Dark | Light |
|---|---|---|
| `--pill-epic-bg` / `-fg` | `rgba(125,170,215,0.10)` / `#9DC2DF` | `rgba(60,110,160,0.09)` / `#4A7396` |
| `--pill-high-bg` / `-fg` | `rgba(248,113,113,0.09)` / `#DE9C9C` | `rgba(190,70,70,0.08)` / `#A95F5F` |
| `--pill-med-bg` / `-fg` | `rgba(251,191,36,0.08)` / `#D2B584` | `rgba(180,130,30,0.09)` / `#94732F` |
| `--pill-low-bg` / `-fg` | `rgba(116,200,150,0.07)` / `#97C3A6` | `rgba(50,130,85,0.08)` / `#4D7E61` |

Epic pills use the brand's soft steel blue — deliberately a step below `--current` in saturation so they never compete with the signal.

### Status dots (column hues)

Flat, solid, 7px circles. One hue per column/status, kept out of the urgency pills' hue families:

| Status | Hue |
|---|---|
| Backlog | `#6B7686` (slate grey) |
| In progress | `var(--current)` (theme-aware cyan) |
| In review | `#8F87D8` (muted periwinkle) |
| Done | `#6CA98A` (desaturated sage) |

These hues must be reused identically in every view that shows status (lists, search, open ticket), so the mapping is learned once.

## 3. Typography

- **UI / content face:** Geist (proportional). Weights 400, 450, 500, 600, 700. Never bolder than 700.
- **Code face:** Geist Mono is *only* for code: fenced and inline code, shell commands, file paths, and preformatted machine output (logs and the agent digest in their `<pre>`). IDs, counts, dates, statuses, labels, agent names and other utility text are Geist Sans, never mono. For numeric alignment use tabular figures, not a switch to mono.
- **Tabular figures** (`font-variant-numeric: tabular-nums`) on anything numeric in a column: counts, fractions, dates.

### Scale — exactly four sizes, 28 → 12

| Size | Weight | Use |
|---|---|---|
| 28px | 700 | Page/view title (one per screen) |
| 18px | 600–700 | Section anchors: column headers, project name |
| 14px | 450 | Body: ticket titles, nav items, epic names |
| 12px | 400 | Utility text in sans: labels, pills, counts, metadata (mono only when the content is code) |

In the absence of borders, this scale *is* the hierarchy. Do not introduce intermediate sizes; if something feels like it needs 16px, it actually needs to be reassigned to a tier.

Mobile: the 28px tier drops to 24px, the 18px tier to 16px. The two lower tiers don't change.

## 4. Spacing

Whitespace scales with type size. Rules of thumb baked into the mockup:

- **Space below a heading ≈ 1–1.5× its font size.** (28px title → ~30px clear below; 18px column head → 32px below.)
- **Space between sibling items ≈ 0.5× their font size.** (14px cards → 8px gaps.)
- Page gutters: 56px desktop, 24px mobile. Sidebar padding 38/28px.
- Card padding: 15px × 18px (16×18 on touch).

When adding new screens, apply the ratios, not the pixel values.

## 5. Components

### Ticket / card

Anatomy is fixed at **title row + one meta row**. A ticket is never taller than this; new metadata must compete for the meta line, not stack.

```
[dot]  Ticket title (14px ink, wraps)
       [epic pill] [urgency pill]            id · context →
```

- Resting background `--raise`, radius 12px, no border.
- Hover: background becomes `--wash` (the signal at 6–7% alpha). Tone shift, not elevation.
- Selected: also `--wash`, ID visible.
- The dot is top-left, aligned to the title's first line (7px circle, 7px top margin). Everything below the title indents 17px so card content keeps one clean left edge and the dot reads as marginal annotation.
- Meta row: `display:flex`, pills on the left, identifier pushed right with `margin-left:auto`. Pills may shrink/ellipsize; the identifier is `nowrap` + `flex-shrink:0` and always survives. The line never wraps.
- IDs are hover-revealed on pointer devices, always visible at low emphasis on touch.
- Done tickets: title in `--slate`, sage dot, epic pill kept, urgency pill dropped (urgency on finished work is noise).

### The thread (live agent state)

The signature element. A ticket an agent is actively working on gets a single strand of `--current` → `--current-soft` slowly circling its edge — **not** a static glow or pulsing halo.

Implementation: an absolutely-positioned `::after` covering the card, 1.25px `padding`, an animated `conic-gradient` driven by a registered custom property, masked to a ring:

```css
@property --orbit { syntax: '<angle>'; initial-value: 0deg; inherits: false; }

.card.live::after {
  content: ''; position: absolute; inset: 0;
  border-radius: inherit; padding: 1.25px;
  background: conic-gradient(from var(--orbit),
    transparent 0turn .80turn,
    var(--current) .92turn, var(--current-soft) .96turn,
    transparent 1turn);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  animation: orbit 7s linear infinite;
  pointer-events: none;
}
@keyframes orbit { to { --orbit: -1turn; } }   /* counterclockwise */
```

Direction is counterclockwise; period ~7s (slow = calm). The live card also sits on `--raise-2` and shows its elapsed time in `--current` in the meta row. Do not repeat the agent's name on the ticket — the thread already says "working"; the sidebar says who.

`@property` requires a Chromium/WebKit-class engine — fine inside Tauri. Fallback and `prefers-reduced-motion`: replace the animation with a static ring at `rgba(34,211,238,0.25)`.

### The punch (click feedback)

Clicks feel like a card passing through the machine — discrete, mechanical, fast:

1. On `pointerdown`, the card depresses: `translateY(1px) scale(0.994)` with `transition: transform 80ms steps(2, jump-end)` — *steps, not ease*. Released on `pointerup`/`pointerleave`.
2. A "punch mark" — an 8px `--current`-ringed circle — appears at the click coordinates, animated over 420ms with `steps(4)`, then removes itself.

The punch must never block or delay the actual action; it accompanies it. Total feel budget: under half a second.

### Punch rows (progress)

Epic/aggregate progress renders as a literal punchcard: one 6px hole per task, 5px gaps. Punched (done) = solid fill; unpunched = 1px ring in `--hole-rim`; the hole "the head is reading now" (current work) = ring in `--current`. Use wherever a progress bar would otherwise appear.

### Pills

12px text, `border-radius: 99px`, padding 4px 11px, wash background + desaturated foreground from the pill tokens. No borders, no icons inside pills.

### Columns / regions

- No column borders. Alternating columns sit on `--band` (radius 16px) — the weave's over/under.
- Region separation (sidebar vs canvas) is purely `--bg-0` vs `--bg-1`.

## 6. Motion rules

- Continuous states (the thread) move fluidly and slowly: linear, ≥6s loops.
- State changes (clicks, presses) move discretely: `steps()` easing, ≤450ms.
- Everything else: simple 120–180ms ease transitions on `background`/`color`/`opacity` only. No springs, no slides, no entrance animations.
- `prefers-reduced-motion: reduce` must disable the orbit (static ring), collapse the punch to ~1ms, and kill transitions.

## 7. Responsive behaviour

Breakpoint at 800px:

- Sidebar collapses to a compact header: project name + horizontal nav + single-line agent status. Epic punch rows hide.
- The board becomes a horizontally swiped deck: `display:flex`, columns at `flex: 0 0 84%`, `scroll-snap-type: x mandatory`, `scroll-snap-align: start` — one status column per swipe.
- Body switches from fixed-height app shell (`overflow:hidden`) to normal vertical scroll.
- Hover-gated metadata becomes always-visible at reduced emphasis (no hover on touch).

## 8. Implementing light mode

The entire theme is the token table; light mode is one attribute flip.

1. **Define both palettes as custom properties.** `:root` (and/or `[data-theme="dark"]`) carries the dark values; `[data-theme="light"]` overrides the same property names with the light values from §2. Nothing else in the stylesheet mentions a literal colour.

2. **Toggle by setting `data-theme` on `<html>`:**

```js
document.documentElement.dataset.theme = 'light'; // or 'dark'
```

3. **Soften the switch** with `transition: background 300ms ease, color 300ms ease` on `body` and the major surfaces (`.sidebar`, `.main`). Don't transition every element — the big surfaces carry the effect.

4. **Set the background explicitly on `html` and the main content region** (`background: var(--bg-1)`), so overscroll and unstyled regions never fall through to the browser default.

5. **Respect the OS preference on first load**, then persist the user's explicit choice:

```js
const stored = localStorage.getItem('theme');
const preferred = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
document.documentElement.dataset.theme = stored ?? preferred;
```

(In the Tauri build, persist to the app's settings store rather than `localStorage`.)

6. **The two semantic adjustments light mode makes** — already encoded in the tokens, listed here so they aren't "fixed" away:
   - The accent darkens (`#22D3EE` → `#0BA5C9`) for legibility on white; decorative uses (the thread) may keep the bright value via `--current-soft`.
   - Tonal alphas roughly double (e.g. `--raise` 0.03 → 0.05), because light surfaces need slightly stronger steps to read as separation.

7. **Also set `color-scheme: light dark`** on `:root` so native scrollbars and form controls follow the active theme.

## 9. Accessibility floor

- Body text (`--ink` on `--bg-1`) meets WCAG AA in both themes. Low contrast is spent on chrome (`--mist`), never on ticket titles.
- Visible keyboard focus everywhere: `outline: 1.5px solid var(--current); outline-offset: 2px`.
- Reduced motion respected as in §6.
- Status is never colour-alone: dots are reinforced by column position / status text in any single-ticket view.

## 10. Things to resist

- Adding borders "just to clarify" — fix it with tone or space instead.
- A second metadata line on tickets.
- Using `--current` for anything decorative or for any background fill.
- New font sizes between the four tiers.
- Speeding up the thread or smoothing the punch — the loom is slow, the machine is stepped.
