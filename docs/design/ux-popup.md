# UX Design Review: The Toolbar Popup

Scope: the Firefox toolbar-button popup only (`entrypoints/popup/`, composed from `entrypoints/ui/`). Judged against the Jobs/Ive bar in `docs/research/14-design-language-and-ux.md` and the intent in `docs/specs/SPEC-009-m6-design-polish.md`. Date: 2026-07-11.

Design ethos being held to: reductive, simple-by-default and powerful-on-demand, instant-apply (no Save), dark-first, one accent ("Live" aqua `#22D3B4`) used only for active state.

---

## 1. Current-state assessment

### 1.1 What the popup renders today

Source: `entrypoints/popup/App.tsx`, `entrypoints/ui/components.tsx`, `entrypoints/popup/style.css`.

```
Header (56px):  ♪ YouTube Audio                         [ ⌘ ]   ← button, aria "Open settings"
────────────────────────────────────────────────────────────────
QuickControls card (gradient + breathing aqua dot):
   YouTube Audio                                        [ ● ]    ← HERO, master `enabled`
   "Active · your preferences apply instantly"
   Audio-only            [Recommended]                  [ ● ]    ← toggle
   "On · saving video data and battery"
   Background play       [Recommended]                  [ ● ]    ← toggle
   "On · keeps playing when hidden"

CURRENT PAGE
   ♪  Audio-only                              Active / Off       ← read-only StatusRow
   ↗  Segment skipping                        Ready / Off        ← read-only StatusRow

PROTECTING YOU
   ✓  Ads and tracking                        On / "N of 2"      ← read-only StatusRow

Footer (44px):  Protection active / paused              Settings →
```

Fixed geometry: `width: 320px; min-height: 560px; grid-template-rows: 56px 1fr 44px`.

### 1.2 The core failure: the popup is blind to the tab it is supposed to describe

This is the headline problem and it undermines the whole surface.

- **No tab awareness at all.** `browser.tabs.query` / `activeTab` appears nowhere in `entrypoints/popup/`. The only `browser.tabs` call in the codebase is `browser.tabs.create` in the options page. The popup renders byte-for-byte identically on `youtube.com/watch`, `music.youtube.com`, and `example.com`.
- **"Current page" is a false label.** The `CURRENT PAGE` section shows global settings, not the current page. `Audio-only: Active` is computed from `audioOnlyEnabledSignal.value`, the stored preference, not from what the active video is actually doing (`App.tsx:74`).
- **The real per-video state already exists and is thrown away.** `entrypoints/main-world.ts:33` defines `type PlaybackStatus = 'idle' | 'fetching' | 'active' | 'fallback' | 'disabled'` and `emitStatus()` (`:97`) fires it with honest reasons: `live`, `no-direct-audio`, `unplayable`, `http-<code>`, `not-a-watch-page`, `media-attach-failed`. This is exactly "is audio-only active on THIS video, or did it fall back?" The content script even mirrors it to `document.documentElement.dataset.ytaStatus` / `ytaReason` (`content.ts:425-428`). The popup consumes none of it.
- **This makes the popup actively dishonest, not just thin.** Per the `credentialless-first` direction, auth-required, live, and undownloadable videos are _expected_ to fall back to normal playback. On those videos the popup will still say `Audio-only: Active` in green while the user is watching full video. A status surface that lies on its most important line fails the Jobs/Ive bar before any pixel polish matters.

The design system anticipated all of this and it was not built: SPEC-009 and `14-design-language-and-ux.md` §3.2 both call for a contextual "This video" section that only renders on a watch/music page, and §6.7 specifies a non-YouTube empty state ("Open YouTube to start"). Neither exists.

### 1.3 Redundancy and competing heroes

- **Audio-only is shown twice.** Once as a live toggle in QuickControls (`components.tsx:135`), then again immediately below as a read-only `Audio-only: Active` StatusRow (`App.tsx:71-75`). The status row is a verbatim echo of the toggle 40px above it. Pure duplication.
- **The footer echoes the hero.** Footer left text `Protection active / paused` (`App.tsx:95`) restates the hero sub-copy `Active · …`. Two glances, same fact.
- **Three things fight to be the hero.** R1 of the design language is "exactly one hero action." Today the master `enabled` (large hero row), Audio-only (Recommended row), and Background play (Recommended row) all read at near-equal weight. A first-time user cannot answer "what is the one thing this popup is for?" in two seconds.
- **The master/audio-only split contradicts the doc.** §3.2 is explicit: the single large element is "the master/audio-only state ... if they split later, audio-only stays hero and master becomes the header context." The build did the opposite: it made master the hero and audio-only a secondary row.

### 1.4 Honesty of the accent and motion

- **The now-playing pulse is always on and often a lie.** `.now-playing` breathes on a 2s infinite loop (`components.css:191-199`) with zero dependence on `enabled`, on audio-only, or on whether any audio is playing. R6 reserves the accent strictly for active/now-playing meaning. When the extension is paused, the hero still shows an aqua gradient wash plus a pulsing aqua dot. The one glow the doc permits (the now-playing indicator, §5.5) is being spent unconditionally.
- **The hero gradient** (`linear-gradient(135deg, var(--accent-wash), transparent)`, `components.css:183`) paints accent on resting UI regardless of state, again against R6.

### 1.5 Iconography and copy

- **The settings glyph is the Command key.** The header button renders the literal character `⌘` (`App.tsx:52`) with `aria-label="Open settings"`. That is a macOS modifier symbol, not a gear, and it is meaningless on the Firefox/Windows/Android audience this ships to.
- **Status glyphs are placeholder text** (`♪`, `↗`, `✓`) with no shared visual system.
- **"Ready" is mechanism-flavored non-copy.** `Segment skipping: Ready` (`App.tsx:37`) tells the user nothing. R4 bans this: status must be an outcome.
- **"N of 2" leaks internals.** `Ads and tracking: 1 of 2` (`App.tsx:84`) exposes that two independent settings were summed into a fraction. It reads like a diagnostic, not a reassurance.

### 1.6 Layout and space

- **560px of height for ~360px of content.** With `grid-template-rows: 56px 1fr 44px`, the `1fr` middle stretches and leaves dead space above the footer. A Jobs/Ive popup sizes to its content; this one reserves a fixed tall frame and pads it with air.
- **Recommended badges add noise in the popup.** The `[Recommended]` pill (`components.tsx:64`) is right for the Settings page (where you are deciding) but is clutter next to an already-on switch in the quick surface (R11 deference).

### 1.7 Accessibility and theming (the genuinely good parts, and the gaps)

Good, keep it:

- `Switch` is a real `role="switch"` with `aria-checked`, an accessible name, and a visible `On`/`Off` text label, so state is conveyed by position and text, not color alone (`components.tsx:10-32`). This satisfies R10's "never rely on color alone."
- Touch targets are honored: switch `min 52x44`, rows `64px`, icon button `44x44`.
- Global `:focus-visible` is a real 2px `--accent-hover` outline (`tokens.css:117`); `prefers-reduced-motion` and `prefers-contrast: more` are handled globally, and the now-playing animation is disabled under reduced motion.
- Dark and light themes are fully tokenized (`tokens.css`).

Gaps:

- **Row focus ring is too weak.** `.setting-row:focus-within` uses `box-shadow: inset 0 0 0 2px var(--accent-wash)` (`components.css:129-132`), a 14%-opacity aqua that falls well under the 3:1 non-text contrast floor. The inner switch's real focus ring rescues keyboard users, so this decorative row ring should either be strengthened to `--accent-hover` or removed to avoid a misleadingly faint indicator.
- **Small-caption secondary text is at the contrast margin.** StatusRow values render at `--type-caption` (11px) in `--text-secondary` (`#AAAAAA`) on `--surface-2`, which sits right around the 4.5:1 line for small text and dips further on `:hover` (surface-3). Any status text that carries meaning should be `--text-primary` or a larger size.
- **Theme follows OS, not the page.** R9 wants the popup color-matched to the active YouTube page (dark watch page vs light), falling back to `prefers-color-scheme`. The popup only ever reads `prefers-color-scheme`. Minor, because most of YouTube is dark, but noted.
- **Whole-row click is mouse-only.** `SettingRow` is a `role="group"` div with an `onClick` (`components.tsx:55-59`); the row-as-target convenience is not keyboard-operable (the inner switch is, so it is acceptable, but the row is not itself announced as actionable).

### 1.8 Instant-apply and error states (mostly right)

- Instant-apply is correct: every control calls its setter on change, `persistSettings` applies optimistically and rolls back on storage failure (`config.ts:191-201`). No Save button anywhere. This is R5, done well.
- Errors are caught and shown inline with `role="alert"` (`App.tsx:32-35, 87-91`), which is the honest failure path SPEC-009 asked for. The only nit: the alert renders at the very bottom under three status cards, far from the control that failed.
- There is no flash-of-default on open because `main.tsx` awaits `initializeSettings()` before rendering. Good.

---

## 2. Prioritized recommendations

Severity is about distance from the design bar and user impact, not implementation cost.

### P0 - the popup must tell the truth about the current tab

**P0-1. Wire the popup to the active tab and to the real playback status.**

Before: the popup imports only config signals; it has no idea what tab is in front of it.

After: on open, resolve the active tab and its live state, and branch the entire layout on it.

- Query the active tab (`browser.tabs.query({ active: true, currentWindow: true })`), classify the host into `watch` (`youtube.com`, `youtube-nocookie.com`, `m.youtube.com`) / `music` (`music.youtube.com`) / `other`.
- On a YouTube tab, read the real per-video status. The content script already has it; add a tiny request/response (popup asks the content script, content script replies with the last `{status, reason}` it saw from `main-world`). No new detection logic is needed, only relaying the value that `emitStatus()` already produces (`main-world.ts:97`).
- Drive the hero sub-copy and the accent from that status, not from the stored toggle.

This single change converts the popup from a settings mirror into a status instrument, which is the entire reason a toolbar popup exists.

**P0-2. Make the hero honest about fallback.**

Before: `Audio-only: Active` whenever the toggle is on.

After: the hero reflects `PlaybackStatus` for this video, with copy that never claims audio-only when the video fell back:

| State (from `main-world`)                                | Hero sub-copy                                                 | Accent         |
| -------------------------------------------------------- | ------------------------------------------------------------- | -------------- |
| `active`                                                 | "Audio-only on. Video muted, battery saved."                  | aqua, pulse    |
| `fetching`                                               | "Switching to audio-only…"                                    | aqua, no pulse |
| `fallback` + `live`                                      | "Live stream, playing normally."                              | none           |
| `fallback` + `no-direct-audio` / `unplayable` / `http-*` | "Audio-only isn't available on this video. Playing normally." | none           |
| `disabled` (toggle off)                                  | "Audio-only off. Video plays normally."                       | none           |
| not a watch page (on YouTube)                            | "Play a video to use audio-only."                             | none           |

The pulse and the aqua wash appear only in the `active` row. Everywhere else the hero is graphite. This restores R6 and turns the accent back into a signal.

**P0-3. Delete the duplicate "Current page" status card; the hero is the current-page status.**

Before: a `CURRENT PAGE` section whose two rows echo the Audio-only toggle and a "Ready" label.

After: remove the section entirely. Audio-only's true current-page state now lives in the hero (P0-2). Segment skipping, if it stays in the popup at all, becomes a single honest per-video line ("2 segments skipped on this video" only when the content script actually reports segments; otherwise it is Settings-only status, not a popup row). No read-only row may restate a toggle that is visible three lines above it.

**P0-4. One hero, and make it audio-only for this tab. Demote master to a quiet pause.**

Before: master `enabled` is the large hero; audio-only and background are equal-weight rows.

After, matching §3.2 verbatim ("audio-only stays hero and master becomes the header context"):

- **Hero = Audio-only for the current tab**, big switch plus the live P0-2 status line.
- **Master on/off becomes a quiet control**, a slim "Pause YouTube Audio" affordance in the header or footer, not a full-width hero. It is a rarely-touched kill switch, so it should not occupy the most valuable pixels or invite an accidental full-disable on a large tap target.
- **Background play stays as the single secondary toggle.**

Net: the two-second question "is this video audio-only right now, and can I flip it?" is answered by the top third of the popup, with one obvious control.

### P1 - honesty, clarity, and polish

**P1-1. Fix the always-on pulse.** Gate `.now-playing` (and the hero gradient) on `status === 'active'`. When paused or in fallback, no pulse, no aqua wash. Under `prefers-reduced-motion`, the active state is a static aqua dot (already handled) rather than a breathing one.

**P1-2. Replace the `⌘` glyph with a real gear (or the word "Settings").** The header action must read as settings to a Windows/Android/Firefox audience. Adopt one small icon set for the header gear and any retained status glyph, or drop glyphs entirely and rely on labels. Do not ship a macOS Command symbol as a settings button.

**P1-3. Collapse "Protecting you" to one calm, honest line.** Before: `Ads and tracking: 1 of 2`. After: a single read-only line, "Ads and trackers blocked. Ghost on." when both are on, degrading to "Ads blocked. Ghost off." style plain language when they differ. No fractions, no counts the extension cannot measure (SPEC-009 forbids invented counters, correctly). The whole line taps through to the Protection group in Settings.

**P1-4. De-duplicate the footer.** Drop the footer status text; it repeats the hero. Keep the footer as a single quiet "Settings" link (or, if a glance stat is ever backed by a real measured number, one stat plus the link, never invented totals).

**P1-5. Size the popup to its content.** Remove the fixed `min-height: 560px`; let the shell be `grid-template-rows: 56px auto 44px` (or `auto 1fr auto` with the content as `auto`) so there is no dead band above the footer. Target roughly 380 to 460px tall depending on state, 320px wide.

**P1-6. Drop the Recommended badges from the popup.** Keep them in Settings where a decision is being made. In the quick surface an on switch is its own endorsement.

**P1-7. Strengthen or remove the row focus-within ring.** Use `--accent-hover` for the row indicator or delete it and let the switch's own 2px ring carry focus. A 14%-opacity ring is worse than none because it looks like a rendering bug.

### P2 - refinements

**P2-1. Add the non-YouTube empty state (§6.7).** On an `other` tab the popup collapses to: header, one line "Open YouTube to start", a primary "Open YouTube" button (reuse the existing `openYouTube` action pattern from options), and a "Tune settings" text link. No status cards, no toggles that cannot apply to the current tab. This is calmer and more honest than showing global switches that have no visible effect on the tab in front of the user.

**P2-2. Add a brief "Checking this tab…" state.** While the popup awaits the content-script status reply, show a neutral hero sub-line rather than defaulting to a claim. It resolves in well under a frame in the common case; the state exists only so the popup never shows a stale or optimistic label first.

**P2-3. Match the popup theme to the page when cheap.** When the active tab is YouTube, prefer the page's dark/light state over `prefers-color-scheme` (the tab query already tells you the host; the content script can include the page theme in its status reply). Falls back to `prefers-color-scheme` off-YouTube.

**P2-4. Move the inline error next to the control that failed**, or render it as a slim banner directly under the hero, so the retry affordance is where the eye already is.

**P2-5. Consider a single current-video action once status is wired.** With the tab known, one genuinely contextual action earns its place: a "Skip sponsor" affordance when a segment is live, or a "Download audio" entry when downloads are enabled and the video is downloadable. Add at most one, only when the content script reports it is currently applicable, so it is never a dead control.

---

## 3. North-star popup

A single well-made card that answers, in one glance, "what is this tab doing, and what is the one thing I might flip?" and gets out of the way.

```
┌───────────────────────────────────────────────┐  320px
│  ♪ YouTube Audio        music ·  ⏻      ⚙      │  Header: brand · context chip · pause · gear
├───────────────────────────────────────────────┤
│                                                 │
│   Audio-only                          [   ON ● ] │  HERO: this tab's audio-only, big switch
│   ● Audio-only on. Video muted, battery saved.  │  live status from PlaybackStatus (aqua when active)
│                                                 │
│   Background play                     [   ON ● ] │  the one secondary toggle
│                                                 │
│   Ads and trackers blocked. Ghost on.       ›   │  one calm read-only line → Settings
│                                                 │
├───────────────────────────────────────────────┤
│                                     Settings →  │  footer: one quiet link
└───────────────────────────────────────────────┘
```

Behavioral spine:

- **The hero is the tab, not the setting.** Its status line is fed by the `active | fetching | fallback | disabled` signal the extension already emits, so it is correct on live streams, auth-required videos, and non-watch pages, and it never claims audio-only during a fallback.
- **Accent means active, only.** The aqua dot and any wash appear in the `active` state and nowhere else.
- **Master is a quiet pause, not a hero.** A small power control in the header dims the whole card to a single "Paused. YouTube works normally." line when off.
- **Off-YouTube, the card collapses** to a one-line "Open YouTube to start" with a primary Open button. No toggles that cannot bite the current tab.
- **Everything else lives in Settings.** Segment categories, EQ, lyrics, quality caps, distraction hiding, downloads, aggressive telemetry: all already grouped and searchable in the options page. The popup stays at four zones plus header/footer, well inside the budget of six.

Two-audience contract, honored: the 90% open the popup, read one true status line, and close it; the 10% tap the gear. Nothing was removed, only placed where it belongs.

---

## 4. Micro-copy reference

Replace mechanism and filler language with outcomes.

| Location             | Before                                      | After                                                                       |
| -------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Hero sub-copy        | "Active · your preferences apply instantly" | state-driven, per the P0-2 table                                            |
| Audio-only, on       | "On · saving video data and battery"        | "On. Video muted on this tab."                                              |
| Audio-only, fallback | (not shown)                                 | "Audio-only isn't available on this video. Playing normally."               |
| Background play, on  | "On · keeps playing when hidden"            | "On. Keeps playing in the background."                                      |
| Segment skipping     | "Ready"                                     | omit; show "2 skipped on this video" only when measured, else Settings-only |
| Protection           | "Ads and tracking: 1 of 2"                  | "Ads blocked. Ghost off." (plain, no fraction)                              |
| Master off           | "Paused · YouTube works normally"           | keep, and dim the card to match                                             |
| Empty (off-YouTube)  | (not shown)                                 | "Open YouTube to start." + [Open YouTube]                                   |
| Settings button      | "⌘" glyph                                   | gear icon or the word "Settings"                                            |

---

## 5. Summary of the argument

The popup is competently built at the component level (real switches, tokenized theme, instant-apply, reduced-motion, sensible targets) but it is solving the wrong problem: it is a second, smaller copy of the settings page rather than a status instrument for the current tab. The single highest-value change is to wire it to the active tab and to the `PlaybackStatus` the extension already emits, then let one honest hero (audio-only for this video) carry the surface, demote master to a quiet pause, and delete every row that merely echoes a toggle or invents a count. That collapses the popup to four calm zones, makes the accent mean something again, and lets it tell the truth on the fallback videos where it currently lies.
