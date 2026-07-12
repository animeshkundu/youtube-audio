# UX Design Review: Options / Settings Page

Status: review (not yet implemented). Scope: `entrypoints/options/` and the shared kit in
`entrypoints/ui/`. Reviewed against the design system in
`docs/research/14-design-language-and-ux.md`, the QoL research in
`docs/research/10-quality-of-life-ux.md`, and the M6 spec `docs/specs/SPEC-009-m6-design-polish.md`.
Bar: Jobs/Ive reductive, simple-by-default and powerful-on-demand, instant-apply, dark-first,
one accent ("Live" aqua `#22D3B4`). The options page is also the **primary Android surface** (no
popup on Firefox for Android), so it must carry the quick-controls and status a desktop user gets
from the popup.

Any recommendation that changes a stored default or the settings schema reopens a SPEC-009 explicit
non-goal ("No feature behavior, defaults, permissions, host matches, network flows, or storage
schema changes", SPEC-009 line 19) and so needs a fresh spec plus an ADR per the repo's "no spec, no
code" rule. Most fixes below are presentation-only and do not touch `DEFAULT_SETTINGS`. One IA
constraint to keep in view: the Download control is off by default **and gated out of the listed /
AMO build** (ADR-0003), so the Downloads group must render conditionally and will be absent in that
build.

Location note: the repo's documented doc categories are Architecture / Specifications / ADRs /
Research / History / Agent Instructions / Testing (see `mkdocs.yml` nav); design/UX writing has so
far lived in `docs/research/NN-topic.md` (e.g. `14-design-language-and-ux.md`). This file sits at the
path the task named (`docs/design/ux-options.md`); if it should follow convention instead, relocate
to a numbered research note (next free is `15-`) or fold decisions into an ADR, and add it to the
`mkdocs.yml` nav.

---

## 1. Top recommendations (the short version)

1. **Kill the duplicate toggles.** Audio-only and Background play render twice on one screen
   (pinned "Quick Controls" card **and** the "Playback" section). Pick one home. This is the single
   most un-Jobs thing on the page. **[P0]**
2. **Make disclosure follow dependency.** SponsorBlock category rows show even when Skip segments
   is off; the Equalizer band sliders open even when the EQ is off; Aggressive telemetry sits in a
   generic "Advanced" drawer instead of under Ghost. Dependent controls should appear/enable only
   when their parent is on. **[P0/P1]**
3. **Finish instant-apply.** Only the Quick-Controls rows echo state ("On - saving video data and
   battery"); every other row has a static description and the options page swallows setter failures
   silently (no error path, unlike the popup). State must be the receipt, and failure must be
   honest. **[P1]**
4. **Frame the two risky toggles.** Block ads and Aggressive telemetry read like every other row.
   Give them a distinct "high-impact" treatment (warning accent + honest one-line consequence),
   never a scary modal. **[P1]**
5. **Fix search's dead ends.** No-match shows a blank page (the `.empty-search` style exists but is
   never rendered); the nav rail keeps showing sections that have been filtered to nothing and has no
   active indicator. **[P1]**
6. **Regroup for meaning.** "Enhancers" is a grab-bag (segment-skip + hide-shorts/recs/comments);
   Download is buried with Aggressive telemetry. Split into intent-named groups: Playback, Privacy &
   Blocking, Cleaner YouTube, Music, Downloads, Advanced. **[P1]**
7. **Give Android the full quick surface.** The pinned card is only 3 toggles; Android users lose
   the segment/protection status the desktop popup shows and the card does not stay pinned on scroll.
   **[P1]**

---

## 2. Current-state assessment

### 2.1 What is on the page today

Source: `entrypoints/options/App.tsx`. Nav rail + search + six sections:

| Section (nav) | Rows, in order | Control | Disclosure |
|---|---|---|---|
| **Quick Controls** (pinned card) | Master (`enabled`), Audio-only, Background play | switches | none |
| **Playback** | Audio-only *(again)*, Background & lock-screen play *(again)*, Disable autoplay next, Maximum video quality | switches + native `<select>` | none |
| **Protection & Ghost** | Block ads, Ghost mode | switches | none |
| **Enhancers** | Skip segments, Sponsored segments*, Non-music segments*, Hide Shorts, Hide recommendations, Hide comments | switches (2 nested with `↳`) | none |
| **Music** | Normalize loudness, Equalizer, Synced lyrics | switches | `<details>` "Equalizer bands" (5 sliders) |
| **Advanced** | Download audio, Aggressive telemetry blocking | switches | `<details>` "Power-user controls" |

The shared kit (`entrypoints/ui/components.tsx` + `components.css` + `tokens.css`) is genuinely
good and worth defending: a real `Switch` (`role="switch"`, `aria-checked`, `aria-describedby`,
visible On/Off text so state is not color-only), a `SettingRow` whose whole body is clickable, a
tokenized dark-first theme with a light mirror, 44px targets, `prefers-reduced-motion` and
`prefers-contrast` handling, and a spring-thumb switch. The bones match the design system. The
problems are almost all in the options **composition**, not the primitives.

### 2.2 What works (keep)

- **Token system and switch primitive** faithfully implement `docs/research/14` sections 5-6.
- **Quick-Controls rows are live**: descriptions echo settle state and the master line reads
  "Active - your preferences apply instantly" / "Paused - YouTube works normally". This is the
  instant-apply model done right, and it should be the template for every other row.
- **Search auto-opens advanced disclosures** while filtering (`open={normalizedQuery.length > 0}`),
  which is the correct progressive-disclosure-under-search behavior.
- **Android plumbing exists**: `options/index.html` sets `manifest.open_in_tab`, `wxt.config.ts`
  declares `gecko_android`, and the layout collapses to one column with a horizontal nav strip below
  720px.
- **A11y baseline is real**: focus-visible rings from a token, `visually-hidden` search label,
  `aria-label` on range inputs, tabular-nums on the EQ output.

### 2.3 What is off the bar (findings, with severity)

**F1 - Duplicate Audio-only / Background play [P0].** Both appear in the pinned Quick-Controls
card and again in Playback. They stay in sync through signals, so it is not a data bug, but on one
scroll a user sees the same two switches twice. It reads like a mistake, doubles the toggle budget,
and violates "one obvious path per surface" (R1). See `App.tsx:149-183`.

**F2 - Dependent controls are not gated [P0/P1].**
- SponsorBlock category rows (Sponsored / Non-music, `App.tsx:263-275`) always render, even when
  `segmentSkipEnabled` is false. The design intent (14 section 3.3) is categories only when Skip is
  on. Today you can toggle categories that do nothing.
- Equalizer band sliders (`App.tsx:349-374`) live in a `<details>` that is present regardless of
  `equalizerEnabled`. You can open and drag bands with the EQ off. The dependency (bands only when
  EQ on) is not expressed.
- Aggressive telemetry (`App.tsx:396-403`) is nested under a generic "Advanced -> Power-user
  controls" drawer next to Download, and is not gated on `ghostEnabled`, even though it is
  conceptually a *sub-mode of Ghost* ("also block watch-time stats"). With Ghost off it is orphaned.

**F3 - Instant-apply is half-built [P1].** Only Quick-Controls rows echo state. Every
`SettingRow` in Playback/Protection/Enhancers/Music/Advanced passes a static description, so the
row does not confirm the change beyond the thumb moving. Worse, the options page has **no error
handling**: setters are fired as `void actions.setX(...)` and a rejected `persistSettings` is
silently dropped (`config.ts:191-201` rolls back state but the UI never tells the user). The popup
already models the honest path (`popup/App.tsx` `apply()` -> inline "Couldn't apply that change.").
Options should match.

**F4 - Risky toggles have no framing [P1].** Block ads and Aggressive telemetry are visually
identical to Hide comments. Ad-block carries breakage and store-policy weight; aggressive telemetry
can break history/resume (the copy admits it). The `--warning`/`--danger` tokens exist but are unused
in options. There is no non-modal "this is high-impact" cue.

**F5 - Search dead ends [P1].** `matchesSearch` filters rows and sections, but:
- A query that matches nothing renders an empty `<main>` (header + nav only). `.empty-search` is
  defined in `style.css:254-259` and never used in `App.tsx`.
- The nav rail (`App.tsx:127-143`) always lists all six sections; when search hides a section's
  content, its nav link scrolls to nothing.
- The nav has **no active-section indicator** (the design showed a `●` on the current group) and no
  `aria-current`.
- Keywords are hard-coded magic strings per row (`settingVisible('audio only playback data
  battery')`), which will silently drift from labels as copy changes.

**F6 - Grouping is vague [P1].** "Enhancers" mixes segment-skipping (a watch-time cleanup) with
site decluttering (hide shorts/recs/comments) - different jobs under a marketing word (R4 bans
jargon). Download sits inside "Advanced" paired with Aggressive telemetry, an unrelated and much
riskier control. There is no Reset-to-defaults, no About/what's-on, no import/export.

**F7 - Android quick surface is thin [P1].** The pinned card is master + audio-only + background
only. The desktop popup additionally shows segment-skip status and an ads/tracking protection glance
(`popup/App.tsx` StatusRows). On Android, where this page is the *only* surface, users get less
status than desktop popup users. The card is also not actually pinned - it is just the first section
and scrolls away, and on mobile the horizontal nav strip sits *above* it, pushing the hero down.

**F8 - Copy leans on mechanism, not outcome [P1].** Several descriptions break R4:
- Ghost mode: "Reduce safe first-party quality and instrumentation tracking." - near-meaningless to
  a user.
- Block ads: "Remove known ad interruptions from player responses." - "player responses" is
  internal jargon.
- Audio-only: "Play the direct audio track and stop video bytes." - "video bytes" is jargon.
Copy should state the outcome ("Blocks ads before they play", "Stops video from loading to save
data and battery").

**F9 - Now-playing pulse always animates [P2].** `QuickControls` renders the breathing aqua
`.now-playing` dot unconditionally (`components.tsx:123`), so it keeps pulsing even when the master
is Paused. The pulse means "active"; it should be gated on `enabled` (and drop to a static dot under
reduced motion, which it already does).

**F10 - Force-quality select is a default no-op [P2].** "Maximum video quality" is prominent in
Playback but only matters when Audio-only is off; with the shipped default (audio-only on) it does
nothing. Its own copy says so, but it still occupies a top-level row. It belongs behind Playback ->
Advanced with a "applies when Audio-only is off" note.

**F11 - Small glyph/polish nits [P2].** The popup's settings button uses `⌘` (the Mac Command
symbol) as a gear (`popup/App.tsx`); the options search uses `⌕`. Neither is a standard
gear/magnifier and `⌘` is actively misleading on non-Mac. The nested-category `↳` prefix is a crude
hierarchy cue versus an indent + hairline. Onboarding is `role="dialog" aria-modal` but has no focus
trap, no initial focus move, and no Escape handler.

---

## 3. Proposed IA (grouped, searchable, progressively disclosed)

One pinned quick surface, then intent-named groups. Every stored setting has exactly one home; no
setting appears twice. Defaults shown in *italics*.

| Group (nav) | Rows (default) | Control | Disclosed / dependent |
|---|---|---|---|
| **Quick Controls** (pinned) | Master *(on)*; Audio-only *(on)*; Background play *(on)*; live status: Skipping, Ads & tracking | switches + read-only status rows | - |
| **Playback** | Disable autoplay-next *(off; see note)*; | switch | **Advanced:** Max video quality / Data saver `<select>` *(Automatic)* - "applies when Audio-only is off" |
| **Privacy & Blocking** | Block ads *(on, high-impact)*; Ghost mode *(on, recommended)* | switches | Under Ghost: **Aggressive telemetry** *(off, high-impact)* - enabled only when Ghost is on |
| **Skipping** | Skip segments *(on)* | switch | Category rows Sponsored / Non-music - shown only when Skip is on |
| **Cleaner YouTube** | Hide Shorts *(off)*; Hide recommendations *(off)*; Hide comments *(off)* | switches | - |
| **Music** | Normalize loudness *(on)*; Equalizer *(off)*; Synced lyrics *(off)* | switches | EQ band sliders - shown only when Equalizer is on |
| **Downloads** | Download audio *(off; absent in the AMO/listed build per ADR-0003)* | switch | **Advanced (later):** format / filename |
| **Advanced / About** | Reset to defaults; (later) import/export; version + "what's on" checklist | button + text | - |

Notes:
- Audio-only and Background play live **only** in the pinned Quick Controls (they are the two most
  touched controls and the Android hero). Playback then holds the less-frequent playback tuning. This
  removes F1 without losing anything.
- `disableAutoplayNext` default is a product call: `docs/research/10` (sections 1, 8) calls
  autoplay-next the single highest-value default and argues it should ship **on**. Flipping it needs
  an ADR; flagged here, not silently changed.

### Control types

- **Binary settings -> `Switch`** (existing primitive). Keep whole-row activation.
- **Quality cap -> native `<select>`** (existing). Native is more robust than a custom listbox and
  is fine; just relocate it behind Playback -> Advanced.
- **EQ bands -> range sliders** (existing) inside the EQ's own disclosure.
- **Reset -> a text/secondary button** that triggers a single confirming toast ("Reset to
  defaults"), the one place a toast is justified (14 section 6.8).

### Disclosure rules (make dependency literal)

1. **Parent off -> children hidden, not just present.** Category rows render only when
   `segmentSkipEnabled`; EQ sliders render only when `equalizerEnabled`; Aggressive telemetry is
   inside the Ghost block and `disabled` (dimmed, `aria-disabled`, with a one-line "Turn on Ghost to
   use") when `ghostEnabled` is false. Reveal on parent-on with a `--dur-2` height+fade (14 section
   9, item 8), collapse instantly under reduced motion.
2. **Search overrides disclosure** (already true): typing expands matching advanced blocks so a
   hidden child is still findable.
3. **Advanced drawers hold only genuinely rare/tuning controls** (quality cap, EQ bands, download
   format), never a *different feature* (Download is its own group, not "Advanced").

### Micro-copy (outcome, not mechanism)

| Row | Before | After |
|---|---|---|
| Audio-only | "Play the direct audio track and stop video bytes." | "Stops video from loading. Saves data and battery." |
| Background play | "Keep playing when YouTube is hidden." | keep (already outcome-first) |
| Block ads | "Remove known ad interruptions from player responses." | "Blocks ads before they play. May rarely affect playback." |
| Ghost mode | "Reduce safe first-party quality and instrumentation tracking." | "Blocks YouTube's tracking. Playback stays normal." |
| Aggressive telemetry | "Also block watch-time statistics; history and resume may be affected." | "Also blocks watch-time stats. Your history and resume-where-you-left-off may stop working." |
| Skip segments | "Privately look up and skip enabled categories." | "Skips sponsored and non-music parts. Lookups are anonymous." |
| Synced lyrics | "Opt in to an anonymous LRCLIB lookup." | "Shows time-synced lyrics from LRCLIB. Anonymous lookup." |

### Risky-toggle framing (non-modal)

Add a `high-impact` variant of `SettingRow`: a small `--warning` chip next to the label ("High
impact") and, when the switch is on, a one-line `--warning`-tinted consequence under the description.
No confirmation modal, no red-alert - honest, quiet, reversible. Applies to Block ads and Aggressive
telemetry. This is color **plus text** (R10: never color alone).

---

## 4. Prioritized recommendations with before/after

### P0

**P0-1. De-duplicate (F1).** Remove the Audio-only and Background rows from the Playback section;
keep them only in the pinned Quick-Controls card.
- Before: Quick Controls {master, audio-only, background}; Playback {audio-only, background, autoplay,
  quality}.
- After: Quick Controls {master, audio-only, background, +status}; Playback {autoplay; Advanced:
  quality}.

**P0-2. Gate segment categories on the master (F2).** Render Sponsored/Non-music rows only when
`segmentSkipEnabled` is true.
- Before: `sponsorRows.filter(...).map(...)` always runs (`App.tsx:263-275`).
- After: `{segmentSkipEnabledSignal.value && sponsorRows...}` inside the Skipping group; reveal with
  `--dur-2` height+fade.

**P0-3. Gate EQ bands on the EQ toggle (F2).** Render the bands disclosure only when
`equalizerEnabled`.
- Before: `<details class="advanced-disclosure">` always present in Music (`App.tsx:349-374`).
- After: `{equalizerEnabledSignal.value && <details ...>}` - and consider making it inline (no
  `<details>`) once the EQ is on, since a visible-EQ-with-hidden-bands is an extra needless click.

### P1

**P1-1. Move Aggressive telemetry under Ghost, gate it (F2, F6).** Nest it directly beneath the
Ghost row in Privacy & Blocking; `disabled` with "Turn on Ghost to use" when Ghost is off. Remove the
"Advanced -> Power-user controls" drawer entirely (Download becomes its own group).

**P1-2. Finish instant-apply + honest failure (F3).** Give every row a live description that echoes
state (mirror `QuickControls`), and wrap options setters in the popup's `apply()` pattern so a
rejected write surfaces an inline `role="alert"` message instead of vanishing.
- Before: `onChange={(checked) => void actions.setAdBlockEnabled(checked)}`, static description.
- After: shared `apply()` with try/catch -> inline error; description switches on `checked`.

**P1-3. Risky-toggle framing (F4).** Add the `high-impact` row variant (section 3) for Block ads and
Aggressive telemetry using `--warning`.

**P1-4. Search empty-state + nav sync (F5).** Render `.empty-search` ("No settings match
'<query>'. Clear search.") when every group is filtered out; hide nav links whose section is filtered
away; add an active-section indicator (`aria-current` + the `●`). Consider deriving each row's search
text from its label+description instead of hard-coded strings.

**P1-5. Regroup (F6).** Adopt the section-3 group set: Playback, Privacy & Blocking, Skipping,
Cleaner YouTube, Music, Downloads, Advanced/About. Rename the "Enhancers" grab-bag out of existence.

**P1-6. Copy pass (F8).** Apply the section-3 micro-copy table across all rows.

### P2

**P2-1. Android quick surface (F7 - also section 5).** Extend the pinned card with read-only status
rows (Skipping, Ads & tracking) and make it truly sticky on scroll below 720px; move the mobile nav
strip below the hero.

**P2-2. Relocate quality select (F10).** Into Playback -> Advanced disclosure with an "applies when
Audio-only is off" note.

**P2-3. Now-playing honesty (F9).** Gate `.now-playing` on `enabled`.

**P2-4. Reset-to-defaults + About (F6).** Add Reset (with one confirming toast) and a quiet
"what's on" checklist so users see the value they already get (14 section 8). Reset touches settings,
so it needs a spec note.

**P2-5. Polish (F11).** Replace `⌘`/`⌕` with a proper gear/magnifier glyph or inline SVG; swap the
`↳` category prefix for an indent + left hairline; add focus-trap + initial-focus + Escape to the
onboarding dialog.

---

## 5. Android considerations (no popup - this page carries everything)

Constraints (from `docs/research/14` section 7 and `docs/research/10` section 7): Firefox for
Android has no toolbar popup; the options page (`open_in_tab: true`) reached via the Extensions menu
is the primary surface, and the in-player button is the real day-to-day control. Stay MV2.

1. **The pinned card must equal the desktop popup.** Same component tree, `layout="page"`. It needs
   master + audio-only + background **and** the popup's status rows (Skipping, Ads & tracking) so an
   Android user gets the same glance. Today the card is missing the status (F7).
2. **Actually pin it.** Below 720px, make the Quick-Controls section `position: sticky; top: 0` so it
   stays reachable while scrolling long settings, and render the horizontal nav strip **below** the
   hero, not above it, so the first screenful is the hero (matches "first screenful on Android == the
   popup on desktop").
3. **Touch geometry is already right**: switches go to 52x32 and rows to ~68px below 600/720px;
   keep every target >= 44px (verified in `components.css` and `style.css`).
4. **Do not rely on desktop-only affordances.** Hover is meaningless on touch; the row's own
   `:active`/`focus-within` states carry feedback. Keep it.
5. **Reduced-motion / contrast** already branch globally; the sticky card and disclosure reveals must
   respect them (instant, no height animation) - the global `prefers-reduced-motion` block covers
   transitions, but any JS-driven height reveal must check it too.

---

## 6. Accessibility and visual checklist (verify on implementation)

- [ ] Switch keeps `role="switch"` + `aria-checked` + non-color On/Off text (already good).
- [ ] Dependent controls that are visible-but-inactive use `aria-disabled` + a text reason, not just
      dimming.
- [ ] Search empty-state is announced (`role="status"`), and the nav's active item uses
      `aria-current="true"`.
- [ ] Error path uses `role="alert"` (match popup).
- [ ] Onboarding dialog: focus moves in on open, is trapped, returns on close, Escape dismisses.
- [ ] Risky-toggle warning is color **plus** text/glyph (R10).
- [ ] Contrast holds for any new `--warning` text on `--surface-1` in both themes (spot-check
      `#8a5200` light / `#ffc043` dark).
- [ ] `.now-playing` pulse only when active; static dot under reduced motion.
- [ ] All targets >= 44px after regrouping (nested rows included).

---

## 7. Effort map

- **Presentation-only (no schema/default change):** F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11.
  These are composition and copy changes in `entrypoints/options/App.tsx`, small additions to the
  shared kit (a `high-impact` row variant, status rows on the card), and CSS. Safe to land under M6's
  "presentation-only" rollback story (SPEC-009).
- **Needs a fresh spec + ADR (reopens SPEC-009 line 19 non-goal):** flipping `disableAutoplayNext`
  to on by default; adding Reset-to-defaults (writes settings); any default cap for `forceQualityMax`
  on metered/mobile. Keep the Downloads group build-gated so it never appears in the AMO/listed build
  (ADR-0003).

The primitives are already at the bar. The work is disciplined composition: one home per setting,
disclosure that mirrors dependency, state as the receipt everywhere, honest framing for the two
controls that carry real consequences, and an Android hero that truly stands in for the popup.
