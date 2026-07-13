# 14 — Design Language & UX System

The single source of truth for how every YouTube Audio surface looks, moves, and behaves. This is a **system**, not a mockup: tokens, component specs, IA, and interaction rules that each feature (audio-only, background play, ad/telemetry blocking, ghost, segment skipping, quality-of-life toggles, YouTube Music extras, downloads) plugs into without re-litigating design.

- Date: 2026-07-11.
- Scope: Firefox WebExtension (MV2), desktop + Android, on `youtube.com` / `m.youtube.com` / `music.youtube.com`.
- North star: **one-stop shop for YouTube — invisible for the 90%, deep for the 10%.** Great defaults, zero required configuration, power on demand.
- Reference code cloned `--depth 1` to `/tmp/yta-research/14-design/`: `darkreader/darkreader@696d3be`, `ajayyy/SponsorBlock@4a118fb`, `gorhill/uBlock@697b2f1`.

---

## 0. Reading order for implementers

1. §1 Principles → the rules everything else obeys.
2. §5 Design language (tokens) → paste these values into a `:root` and never hardcode again.
3. §6 Component specs → build these once, reuse everywhere.
4. §3 IA + §4 in-player → where the components go.

---

## 1. Principles → concrete, enforceable rules

The Jobs/Ive/HIG philosophy, translated into rules a developer can pass or fail a PR against. Vague adjectives are banned; each rule is testable.

### 1.1 Ruthless reduction (Jobs: "say no to 1,000 things")

- **R1. One obvious path per surface.** The popup has exactly **one hero action** (the audio-only/master state). Everything else is secondary or contextual. If a second thing competes for "primary," cut it or move it to Settings.
- **R2. Defaults over configuration.** Every feature ships **on with a sensible default**. A first-run user who never opens Settings must get the full value (audio-only, ad-block, background play, sensible skips) automatically. Settings only *tune*, never *enable-from-zero*.
- **R3. The popup budget is 6.** No more than **6 interactive zones** in the popup (see §3.2). New features do not get a popup slot by default — they earn one by being touched often; otherwise they live in Settings.
- **R4. No dead ends, no jargon.** No empty tables, no `webRequest`/`itag`/`InnerTube` language in the UI. Status is phrased in outcomes ("Ads blocked", "Background play on"), never mechanisms.

### 1.2 Material honesty & restraint (Ive)

- **R5. State is the confirmation.** Instant-apply everywhere. **No Save button, ever.** The control's own visual state *is* the receipt. (Dark Reader models this: control `onChange` dispatches straight to state with no save step — `darkreader/src/ui/popup/main-page/app-switch.tsx:25`.)
- **R6. One accent, used sparingly.** The chromatic accent ("Live" aqua, §5.1) appears **only** for active/on/now-playing meaning. Resting UI is graphite + white. A screen where more than ~10% of pixels are accent-colored is wrong.
- **R7. Honest motion.** Motion communicates causality (this changed *because* you did that) and continuity (where a panel came from). No decorative animation, no fake depth. Elevation on dark is expressed with **light hairline borders**, not heavy drop shadows (§5.5).
- **R8. Native, not skinned.** In-player controls inherit YouTube's own control classes and font so they read as part of the player, not bolted on (§4). Chrome (popup/options) uses the OS system font so it reads as part of Firefox.

### 1.3 Clarity, deference, depth (Apple HIG)

- **R9. Dark-first.** YouTube is dark by default; our default theme is dark and color-matched to YouTube's surfaces (§5.1) so the extension feels like it *belongs*. Light theme is a first-class mirror, auto-selected from the page/OS.
- **R10. Accessibility is non-negotiable (pass/fail):**
  - Body text ≥ **4.5:1** contrast; large text (≥18.66px/24px bold) and UI component boundaries ≥ **3:1** (WCAG 1.4.3 / 1.4.11).
  - Every interactive target ≥ **44×44 px** hit area (extend padding beyond the visual bounds where needed).
  - Visible focus ring on every focusable control; full keyboard operability; `role`/`aria-checked` on custom switches.
  - **Never rely on color alone** — pair color with position/glyph/text (e.g., a switch shows thumb position *and* optional check, not just track color).
  - Honor `prefers-reduced-motion` and `prefers-contrast` (§5.6).
- **R11. Deference.** Chrome recedes; content (the user's video/music) leads. The popup is small, quiet, and gets out of the way. Progressive disclosure hides depth until asked (§3.3).

### 1.4 The two-audience contract

| | The 90% (never opens Settings) | The 10% (power user) |
|---|---|---|
| Gets value from | Great defaults, one toggle, in-player button | Per-category skip control, ghost internals, EQ, downloads |
| Surface | Popup + in-player | Settings page (searchable, progressive disclosure) |
| Rule | Must never *need* Settings | Must never hit a ceiling |

Design tension resolves in favor of the 90% for **placement** (what's front-and-center) and the 10% for **capability** (nothing is removed, only relocated behind disclosure).

---

## 2. Reference-extension teardown — steal / avoid (with evidence)

Five references, read as real source where open, or as documented product behavior where not. `repo/path:line` = code I read in the local clones.

### 2.1 Dark Reader — the gold standard for instant-apply + a mature control kit ✅ STEAL

- **A real component library, not ad-hoc markup.** `darkreader/src/ui/controls/index.ts:1-45` exports 21 reusable controls: `Button, CheckBox, CheckButton, ColorDropDown, ColorPicker, ControlGroup, DropDown, MessageBox, MultiSwitch, NavButton, Overlay, ResetButton, Select, Shortcut, Slider, TabPanel, TextBox, TextList, TimeRangePicker, Toggle, UpDown`. **Lesson:** build a small kit first; features compose from it. We adopt this (§6).
- **The `ControlGroup` = the settings-row primitive.** `darkreader/src/ui/controls/control-group/control-group.tsx:1-32` is just `{control}` + `{description}` in a wrapper, with `ControlGroup.Control` and `ControlGroup.Description` sub-parts. Dark Reader's own master switch composes from it (`app-switch.tsx:66-91`). **We copy this exact shape** (§6.2): a row is a control plus a one-line human description.
- **Instant-apply, no Save.** The master control's `onChange` calls `changeSettings({enabled: true, ...})` directly (`app-switch.tsx:25-42`) — no form, no submit. **This is R5.**
- **Tri-state master via MultiSwitch.** Their top control is not a binary switch but **On / Auto / Off** (`app-switch.tsx:18-23`), with a live description underneath ("Extension is enabled", "Switches according to system dark mode" — `:44-52`). **Steal the pattern** for a master that has an "Auto" mode later, but our v1 master stays binary for R1 simplicity.
- **A tokenized theme.** `darkreader/src/ui/theme.less:1-45` is a compact token file: `@color-back:#141e24; @color-fore:#53a1b3; @color-control-hover:#193945; @color-control-active:#316e7d; @color-heading:#e96c4c; @time-fast:125ms; @time-slow:250ms; @indent-large:.75rem; @indent-small:.5rem;`. **Lesson:** the whole UI is driven by ~20 variables and two durations. We do the same (§5) — and our motion durations (§5.6) are deliberately near theirs.
- ⚠️ **Avoid:** Dark Reader's default popup is fairly **dense** (filter sliders, engine switch, font settings, site toggles all on one page). For *us* that's too much for the hero surface — their density is justified by a per-site theming tool; ours is a set-and-forget audio tool. Keep the popup lighter.

### 2.2 SponsorBlock — the reference for tasteful in-player integration ✅ STEAL

- **Inherit YouTube's own button class.** The in-player skip button is created and given YouTube's native class: `this.skipIcon.classList.add("ytp-button")` (`SponsorBlock/src/js-components/skipButtonControlBar.ts:54`). That's how it gets native hover, opacity, and hit-area for free. **This is R8; we do exactly this** (§4.1).
- **Mount into the real control cluster.** It targets `document.querySelector(".ytp-left-controls")` (`skipButtonControlBar.ts:112`) and inserts via `appendChild`/`insertBefore` relative to existing nodes (`:95,:97`). **Lesson:** find YouTube's control bar and join it; don't float a foreign widget.
- **Match the player's font + relative sizing.** In-player text uses `font-family: Roboto, Arial, Helvetica, sans-serif` (`SponsorBlock/public/content.css:246`) and the icon is sized *relative to the bar*: `.playerButtonImage { height: 60% }` (`content.css:184`). **We copy both** (§4).
- **Motion that matches YouTube's control bar.** The auto-hiding uses `transition: transform 0.2s, width 0.2s, opacity .1s cubic-bezier(0.4,0.0,1,1)` (`content.css:230,236`) — the same exit curve YouTube uses. **We reuse this exact easing for in-player exits** (§5.6).
- **Mobile is a first-class branch, not an afterthought.** The button container gets a `.mobile` class when `onMobileYouTube` (`skipButtonControlBar.ts:50`) and wires `touchstart`/swipe handlers (`:78-79`). **Lesson:** the in-player layer must know it's on mobile (§4.2).
- **Category-color system (a cautionary lesson in restraint).** Each segment category has a saturated hue in `SponsorBlock/src/config.ts:501-589`: sponsor `#00d400`, self-promo `#ffff00`, interaction `#cc00ff`, intro `#00ffff`, outro `#0202ed`, preview `#008fd6`, music/off-topic `#ff9900`, poi-highlight `#ff1684`, filler `#7300FF`, chapter `#ffd983`. On the timeline this rainbow is *useful* (dense info in a tiny bar). ⚠️ **But do not let that palette leak into the chrome** — in the popup/Settings we render categories in neutral rows with a **small color chip only** (the hue as identity, not as the row's fill), so our UI stays calm (R6).

### 2.3 uBlock Origin — great glanceable popup, cautionary dashboard ✅ STEAL popup / ⚠️ AVOID dashboard sprawl

- **Fenix (mobile) popup = one big power button + a tool row + a counter.** `uBlock/src/popup-fenix.html:26` is a single large `#switch` power button (`role="button"`, keyboard-focusable); `:47-51` is a compact row of toggles (`no-popups`, `no-large-media`, `no-cosmetic-filtering`, `no-remote-fonts`, `no-scripting`); `:55,:57` show "blocked on this page / since install" counters. **This is the ideal quick surface:** one dominant state control, a few glanceable toggles, one stat. **We model our popup on this** (§3.2).
- ⚠️ **The dashboard is the cautionary tale.** `uBlock/src/dashboard.html` is a multi-tab shell (Settings, Filter lists, My filters, My rules, Trusted sites, …) that is *powerful but intimidating* — the "Filter lists" tab alone lists dozens of subscriptions, and the dynamic-filtering matrix has a real learning curve. It even has an **"unsaved changes" warning** (`data-i18n="dashboardUnsavedWarning"`), i.e. a Save/Apply model. **We reject both:** (a) no firehose of options on one screen — we group + search + progressively disclose (§3.3); (b) no Save model — instant-apply (R5). uBlock's audience *wants* the matrix; ours does not.

### 2.4 1Password (browser extension) — onboarding & "quiet luxury" ✅ STEAL (product study, not source)

- Closed source; studied as shipping product + design writing. Take: **calm density** — generous spacing, a single accent (its blue), strong type hierarchy, and an unlock/landing state that shows *one* primary action. **Lesson for us:** the popup should feel like a well-made single card, not a control panel. Search-first settings. (See references.)

### 2.5 Raindrop.io / Arc / Linear-class settings — the IA bar ✅ STEAL (product study)

- Take: **left nav rail + right content**, a persistent **search** over settings, sections with quiet headers, and **inline "instant" toggles**. Advanced/rarely-used options collapsed behind disclosure. This is the exact IA we adopt for our options page (§3.3). **Lesson:** searchable + grouped + progressive disclosure is how you hold many features without an "everything at once" wall.

**Net synthesis:** Dark Reader gives us the **kit + instant-apply**; SponsorBlock gives us **native in-player integration + mobile branch**; uBlock gives us the **glanceable popup pattern and a vivid warning about dashboard sprawl**; 1Password/Raindrop set the **calm, searchable IA bar**.

---

## 3. Information architecture — popup vs. settings

### 3.1 The split rule

- **Popup (desktop) / Quick-Controls card (Android):** the **3–6 things touched often** + glanceable status. Optimized for a 2-second in-and-out.
- **Settings (options page):** everything, **grouped + searchable + progressively disclosed**. Optimized for occasional deep tuning.
- A feature appears in the popup **only** if a typical user touches it more than ~once per session *and* it's contextual to "right now." Everything else is status (read-only glance in popup) or Settings-only.

### 3.2 Popup layout (the quick surface)

Target width **320px** (Firefox desktop popup sweet spot; never exceed ~400px). Max 6 zones (R3). Dark-first.

```
┌──────────────────────────────────────────────┐  320px wide
│  ◈ YouTube Audio            youtube.com  ⚙︎    │  ← Header (56px): brand · context chip · gear
├──────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐  │
│  │  Audio-only                    [ ●———]  │  │  ← ZONE 1 · HERO (master state)
│  │  Optimizing this tab · saving battery   │  │     big switch + live status line
│  └────────────────────────────────────────┘  │
│                                                │
│  THIS VIDEO                                    │  ← section header (only when a video is open)
│  ⏭  Skip segments            3 found   ›       │  ← ZONE 2 · SponsorBlock status + tap to skip/detail
│  ⟳  Loop                          [———○]      │  ← ZONE 3 · quick QoL toggle
│  ⏩  Speed                    ‹  1.0×  ›       │  ← ZONE 4 · stepper
│                                                │
│  PROTECTING YOU                                │  ← section header
│  ✓ Ads & trackers blocked        12   ›       │  ← ZONE 5 · read-only status, tap → detail
│  ✓ Background play · Ghost on         ›       │  ←        (status, not a frequent toggle)
├──────────────────────────────────────────────┤
│  12 blocked · 3 skipped today      Settings →  │  ← Footer (44px): glance stat · link
└──────────────────────────────────────────────┘
```

Rules:
- **Zone 1 is the only large element.** It's the master/audio-only state (for v1 these are the same idea; if they split later, audio-only stays hero and master becomes the header context). Big switch (§6.1), a one-line **live status** underneath that changes with state (mirrors Dark Reader's `app-switch` description, `app-switch.tsx:44-52`).
- **"This video" section is contextual** — it only renders when the active tab is a watch/music page. On a non-YouTube tab, the popup collapses to Header + a single "Open YouTube to start" line (§6.7 empty state).
- **"Protecting you" rows are status, not switches** — they show a checkmark + count and disclose detail on tap. This keeps set-and-forget features out of the toggle budget while still being *visible* (trust).
- **Footer** = one glance stat + text link to Settings. No icon grid.

### 3.3 Settings (options page) — grouped, searchable, progressive

Desktop: **left nav rail (200px) + right content**. Mobile/Android: single column with the **Quick-Controls card pinned at top** (§7.2), nav rail collapses to a top segmented list or accordion.

```
┌───────────────────────────────────────────────────────────────┐
│  ◈ YouTube Audio · Settings           [ 🔍 Search settings…  ] │  ← sticky header + search
├───────────────┬───────────────────────────────────────────────┤
│  Playback   ● │   PLAYBACK                                     │
│  Skipping     │   ┌─────────────────────────────────────────┐ │
│  Privacy      │   │ Audio-only            recommended  [●——] │ │  ← settings rows (§6.2)
│  Distraction  │   │ Play only audio; disables the video feed │ │
│  Music        │   ├─────────────────────────────────────────┤ │
│  Downloads    │   │ Background & lock-screen play      [●——] │ │
│  Advanced     │   │ Keep playing when you switch tabs/lock   │ │
│  About        │   ├─────────────────────────────────────────┤ │
│               │   │ Disable “autoplay next”            [——○] │ │
│               │   │ Default speed                ‹ 1.0× ›    │ │
│               │   │ Force quality / Data saver   Auto  ▾     │ │
│               │   └─────────────────────────────────────────┘ │
│               │       ⌄ Advanced playback   (collapsed)       │  ← progressive disclosure
└───────────────┴───────────────────────────────────────────────┘
```

**Exact feature grouping** (every feature from the north-star surface has one home):

| Group (nav) | Rows (default state) | Advanced disclosure |
|---|---|---|
| **Playback** | Audio-only *(on)*, Background & lock-screen play *(on)*, Disable autoplay-next *(on)*, Default speed *(1.0×)*, Loop memory *(off)* | Force quality / Data-saver, per-site audio-only overrides |
| **Skipping** (SponsorBlock) | Master *(on, auto-skip)*; per-category rows: Sponsor, Self-promo, Interaction, Intro, Outro, Preview, Music/off-topic, Filler, Highlight — each **Auto-skip / Show / Off** | Min-segment duration, show unsubmitted, mute vs skip, category color chips |
| **Privacy & Blocking** | Block ads *(on)*, Block telemetry & trackers *(on)*, Ghost mode *(on)* | Tracking-param strip list, beacon blocking, stealth/anti-detection, signed-in safety |
| **Distraction-free** | Hide Shorts *(off)*, Hide comments *(off)*, Hide recommendations *(off)*, Hide end-cards *(off)* | Cinema/focus mode, custom hide rules |
| **YouTube Music** | Lyrics *(on)*, Persistent queue *(on)*, Equalizer *(off)* | EQ bands/presets, crossfade, normalize loudness |
| **Downloads** *(if shipped)* | Audio download *(off)* | Format (m4a/opus), quality, filename template |
| **Advanced** | Import/export settings, Reset to defaults, Keyboard shortcuts | Diagnostics, update channel |
| **About** | Version, what's-on summary ("one-stop" checklist), links | — |

Rules:
- **Search is always present** and filters rows across all groups (matches Raindrop/Linear IA). Typing "skip" surfaces the Skipping category rows regardless of current nav.
- **Every group opens with defaults visible and everything advanced collapsed** (R2 + R11). A user scanning the page sees ~5 rows per group, not 20.
- **Recommended badge** on the rows we want people to keep on (Audio-only, Background, Ghost) — a quiet pill, not a nag.
- **No Save button anywhere.** Each row applies on change; the row's description line echoes the settled state (§6.8).

---

## 4. In-player UI (desktop + mobile)

The in-player layer is where the 90% actually live. It must be **indistinguishable from a native YouTube control**.

### 4.1 Desktop player button

- **What:** a single **audio-only toggle button** in the bottom control bar, plus a contextual **skip button** during a skippable segment.
- **Where:** append into YouTube's real control cluster. Prefer the **right cluster** (`.ytp-right-controls`, next to the settings gear) for our persistent audio-only toggle so it sits with player-level settings; the contextual skip button follows SponsorBlock into `.ytp-left-controls` (`SponsorBlock/src/js-components/skipButtonControlBar.ts:112`) or as a bottom-right slide-in card.
- **How (non-negotiable):**
  - Create a `<button>`/`<img>` and add class **`ytp-button`** so it inherits YouTube's 48×48 hit target, hover opacity, and focus (evidence: `skipButtonControlBar.ts:54`). Do **not** restyle padding/size beyond what `ytp-button` gives.
  - Icon sized **relative to the bar**: `height: 60%` of the control-bar height (evidence: `content.css:184`), centered.
  - Icon: a clean **audio-only glyph** (a play triangle with a small sound-wave, or a "video-off" mark). **Off state:** white glyph at YouTube's default control opacity. **On/active state:** glyph tinted **Live aqua** (`--accent`, §5.1) + tooltip "Audio-only on" using YouTube's own tooltip styling.
  - Font for any in-player text: **`Roboto, Arial, Helvetica, sans-serif`** (evidence: `content.css:246`) — matches YouTube exactly.
- **Skip button (contextual):** appears only during a segment; a small pill/button that slides in from the bar edge using YouTube's exit/enter curve `transform .2s, opacity .1s cubic-bezier(0.4,0,1,1)` (evidence: `content.css:230`). Auto-hides with the control bar. Label: "Skip sponsor" (category-named), with the tiny category color chip as identity.
- **Focus/keyboard:** because we reuse `ytp-button`, Tab reaches it and YouTube's focus ring applies; ensure `aria-pressed` reflects on/off and `aria-label` describes it.

### 4.2 Mobile player (m.youtube.com / music.youtube.com)

- The mobile player DOM differs and the control overlay is transient. Follow SponsorBlock: **tag the container `.mobile`** when on mobile (evidence: `skipButtonControlBar.ts:50`) and branch layout; wire `touchstart`/swipe (evidence: `:78-79`).
- **Touch targets ≥ 44×44px** (R10) — the visual glyph can be 24px but the tappable area must be padded to 44.
- Place the audio-only toggle in the **mobile control overlay** (the same overlay that holds fullscreen/settings). The skip button appears as a **bottom-anchored pill** large enough to thumb-tap, auto-dismissing with the overlay.
- On **YouTube Music mobile**, the "video" is already an audio surface; the audio-only toggle still shows current state and the skip/QoL controls apply. Re-arm on SPA track changes (per `docs/research/09` skip logic).
- **Suppress the legacy injected banner** on `m.`/`music.` hosts (the current `youtube_audio.js` banner mis-parents on mobile; `docs/research/03 §4.3`). The in-player button *is* the mobile affordance now.

---

## 5. Design language — tokens with real values

Paste these into a single `tokens.css` `:root` (dark) + `[data-theme="light"]` override. **Nothing in the codebase hardcodes a color, size, or duration** — everything references a token.

### 5.1 Color

Dark-first, **surface-matched to YouTube** so the extension feels native (YouTube dark base is `#0F0F0F`, elevated `#212121/#272727`, primary text `#F1F1F1`, secondary `#AAAAAA`).

**Dark theme (default)**
```css
:root {
  /* Surfaces — ascend with elevation */
  --surface-0:      #0F0F0F;  /* page / matches YouTube dark base */
  --surface-1:      #181818;  /* popup body, card */
  --surface-2:      #212121;  /* raised row, control track (off) */
  --surface-3:      #272727;  /* hover, menu */
  --surface-4:      #3A3A3A;  /* pressed / high raise */
  --scrim:          rgba(0,0,0,0.55);

  /* Hairlines (elevation via light borders, not heavy shadow) */
  --border-subtle:  rgba(255,255,255,0.10);
  --border-strong:  rgba(255,255,255,0.18);
  --divider:        rgba(255,255,255,0.08);

  /* Text */
  --text-primary:   #F1F1F1;  /* 15.3:1 on surface-0 */
  --text-secondary: #AAAAAA;  /* 6.6:1 on surface-0 — AA body */
  --text-tertiary:  #717171;  /* 3.6:1 — large/decorative ONLY */
  --text-disabled:  rgba(255,255,255,0.30);
  --text-on-accent: #06201B;  /* near-black for text/glyph on aqua fill */

  /* Accent — "Live" aqua. ONLY for active/on/now-playing. */
  --accent:         #22D3B4;  /* primary active fill / on-state track */
  --accent-hover:   #3FE0C4;  /* hover, focus ring */
  --accent-press:   #17B89A;  /* pressed */
  --accent-text:    #5FEAD2;  /* accent as text/icon on dark (≥4.5:1) */
  --accent-wash:    rgba(34,211,180,0.14); /* 10–14% fills, focus halo */

  /* Semantic */
  --danger:         #FF5B57;  /* errors/destructive (distinct from YT red) */
  --warning:        #FFC043;
  --success:        var(--accent); /* aqua reads as “active/ok” */

  /* Reserved brand — YouTube red. ONLY brand glyph + “LIVE” badge. */
  --brand-yt:       #FF0033;
}
```

**Light theme (auto when page/OS is light)**
```css
[data-theme="light"] {
  --surface-0:#FFFFFF; --surface-1:#F9F9F9; --surface-2:#F2F2F2;
  --surface-3:#E8E8E8; --surface-4:#DCDCDC; --scrim:rgba(0,0,0,0.32);
  --border-subtle:rgba(0,0,0,0.10); --border-strong:rgba(0,0,0,0.20); --divider:rgba(0,0,0,0.08);
  --text-primary:#0F0F0F; --text-secondary:#606060; --text-tertiary:#909090;
  --text-disabled:rgba(0,0,0,0.30); --text-on-accent:#FFFFFF;
  --accent:#0E9E86; --accent-hover:#12B39A; --accent-press:#0B7E6C;
  --accent-text:#0B7E6C; --accent-wash:rgba(14,158,134,0.12);
  --danger:#D32F2F; --warning:#B26A00;
}
```

**Accent rationale (opinionated):** YouTube owns red; red also means *destructive/error*, so we **do not** use it as our "on" color. Green is SponsorBlock's; system-blue is generic; Dark Reader owns teal-as-text. We take a **brighter, greener aqua used only as an active/now-playing signal** — it reads as "sound/live," passes contrast on near-black, and stays out of the resting UI (R6). YouTube red is kept as a **reserved** token for the brand mark and a genuine "LIVE" badge only. **Theme auto-detection:** match `music/watch` page theme; fall back to `prefers-color-scheme`.

### 5.2 Typography

- **Chrome font (popup/options):** system stack — feels native to Firefox, zero web-font cost:
  `--font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;`
- **In-player font:** `--font-player: Roboto, Arial, Helvetica, sans-serif;` (matches YouTube; evidence `content.css:246`).
- **Weights:** 400 / 500 / 600 only (700 is too heavy on dark). Antialiased.

**Type scale** (px / line-height / weight / token):

| Token | Size/LH | Weight | Use |
|---|---|---|---|
| `--type-display` | 20 / 28 | 600 | popup hero label, page title |
| `--type-title` | 15 / 20 | 600 | card titles |
| `--type-body` | 14 / 20 | 500 | row labels, primary controls |
| `--type-desc` | 12 / 16 | 400 | descriptions, secondary (color `--text-secondary`) |
| `--type-section` | 12 / 16 | 600 | SECTION HEADERS — uppercase, `letter-spacing:0.06em`, `--text-secondary` |
| `--type-caption` | 11 / 14 | 500 | meta, footer stat |
| `--type-numeric` | 22 / 28 | 600 | counters — `font-variant-numeric: tabular-nums` |

### 5.3 Spacing (4px base grid)

```css
--space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px;
--space-5:20px; --space-6:24px; --space-8:32px; --space-10:40px;
```
Rules: popup outer padding **16** (`--space-4`); row vertical padding **12**, horizontal **16**; gap between groups **24** (`--space-6`); gap between a control and its description **4**; icon-to-label gap **12**.

### 5.4 Radius

```css
--radius-sm:6px;   /* chips, inputs, small buttons */
--radius-md:10px;  /* cards, rows, buttons, popup zones */
--radius-lg:16px;  /* popup container, sheets, dialogs */
--radius-pill:999px; /* switch track, status pills, segmented */
```
In-player elements use **no custom radius** — they inherit `ytp-button` geometry (R8).

### 5.5 Elevation (dark = hairline + soft shadow, restrained)

```css
--elev-0: none;                                            /* flat on page */
--elev-1: 0 1px 2px rgba(0,0,0,.40), 0 8px 24px rgba(0,0,0,.36);   /* popup, card */
--elev-2: 0 4px 12px rgba(0,0,0,.50), 0 16px 48px rgba(0,0,0,.44); /* menu, dialog, overlay */
```
Always pair a shadow with a `1px solid var(--border-subtle)` on dark (the border does the depth work; the shadow only separates from busy content). **No inner shadows, no fake bevels** (R7). The **only** glow allowed is the now-playing indicator: `box-shadow: 0 0 0 3px var(--accent-wash)`.

### 5.6 Motion

```css
--dur-press:90ms; --dur-1:120ms; --dur-2:180ms; --dur-3:240ms;
--ease-standard: cubic-bezier(0.2, 0, 0, 1);     /* most enter/change */
--ease-emphasized: cubic-bezier(0.3, 0, 0, 1);   /* popup/sheet enter */
--ease-exit: cubic-bezier(0.4, 0, 1, 1);         /* exits — MATCHES YouTube (content.css:230) */
--ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1); /* switch thumb only, subtle */
```
- Precedent: Dark Reader uses `125ms/250ms` (`theme.less:43-44`); ours (`120/180/240`) are deliberately adjacent so we feel of-a-piece with well-made extensions.
- **Durations by use:** press feedback `--dur-press`; toggle thumb / hover `--dur-1`; row/control state + disclosure `--dur-2`; popup & page transitions `--dur-3`.
- **Reduced motion (mandatory):**
  ```css
  @media (prefers-reduced-motion: reduce) {
    *{ animation-duration:.001ms!important; animation-iteration-count:1!important;
       transition-duration:.001ms!important; }
  }
  ```
  Replace transforms/springs/pulses with **opacity crossfades**; the now-playing pulse becomes a **static aqua dot**. `prefers-contrast: more` → swap `--border-subtle`→`--border-strong`, drop translucency in text tokens.

---

## 6. Component specs (states + a11y)

Every component lists **default / hover / focus / active / disabled** and its a11y contract. Build these once (mirroring Dark Reader's `controls/` kit) and compose all features from them.

### 6.1 Toggle / Switch (the workhorse)

**Choice:** an iOS-style **pill switch** for binary instant-apply settings (clearer "on/off at a glance" than Dark Reader's segmented ON|OFF; we reserve a **segmented control** only for a genuine 3-state like a future master On/Auto/Off, per §2.1).

- **Geometry:** desktop track **40×24**, thumb **20** (2px inset), travel **16**. Mobile track **52×32**, thumb **28**. Hit area padded to **≥44×44** regardless (R10).
- **States:**
  - *Off* — track `--surface-2` + `1px --border-strong`; thumb `--text-primary`; thumb left.
  - *On* — track `--accent`; thumb `#FFFFFF`; thumb right; optional 10px check glyph in `--text-on-accent`.
  - *Hover* — track lightens one step (`off→--surface-3`); cursor pointer.
  - *Focus* — 2px `--accent-hover` ring, 2px offset (`box-shadow:0 0 0 2px var(--surface-1),0 0 0 4px var(--accent-hover)`).
  - *Active/press* — thumb squishes to width +3 for `--dur-press`.
  - *Disabled* — 40% opacity, no pointer, `aria-disabled`.
- **Motion:** thumb `transform --dur-1 --ease-spring`; track `background --dur-2 --ease-standard`. Reduced-motion → crossfade, no spring.
- **A11y:** `role="switch"`, `aria-checked`, `aria-label` (or labelled row); state conveyed by **position + optional glyph**, never color alone (R10). Whole enclosing row is clickable (§6.2) to enlarge the target.

### 6.2 Settings row (`ControlGroup`)

Directly adopts Dark Reader's `ControlGroup` shape (`control-group.tsx:1-32`): a **control** + a **one-line description**.

```
[ 20px icon ]  Label (--type-body)                         [ trailing control ]
               Description (--type-desc, --text-secondary)
```
- **Geometry:** min-height desktop **48**, mobile **56**; padding `12 16`; icon-label gap 12; radius `--radius-md` when standalone.
- **States:** default transparent; *hover* `--surface-2`; *focus-within* 2px inset `--accent-wash` ring; *pressed* `--surface-3`; *disabled* dim + lock glyph + reason on hover/long-press.
- **Whole-row activation:** if the trailing control is a switch, clicking anywhere in the row toggles it (bigger target, HIG). Steppers/selects keep their own hit area.
- **Description is live:** it states the current effect and echoes settle state ("On · saving…" → "On", §6.8).
- **A11y:** row is a labelled group; description is `aria-describedby` for the control; `recommended` badge is decorative (`aria-hidden`) with the meaning in text.

### 6.3 Section header

- `--type-section` (uppercase, tracked, `--text-secondary`), padding `24 16 8`. Optional trailing **count badge** (pill, `--surface-3`, `--type-caption`) and/or an **Advanced disclosure** chevron that rotates `--dur-2`. Purely structural — not focusable unless it's a disclosure toggle (then `role="button"` + `aria-expanded`).

### 6.4 Popup header & footer

- **Header (56px):** left brand mark (aqua audio glyph, 20px) + wordmark (`--type-title`); right a **context chip** (`youtube.com` / `music` / `not YouTube`, `--type-caption` in `--surface-2` pill) + **gear** button (opens Settings). Bottom `1px --divider`.
- **Footer (44px):** left glance stat (`--type-caption`, e.g. "12 blocked · 3 skipped today"); right **"Settings →"** text button. Top `1px --divider`. No icon grid, no social links.

### 6.5 In-player button

Spec in §4.1/§4.2. Component contract: `class="ytp-button"` (inherit native), icon `height:60%`, active tint `--accent`, tooltip via YouTube's tooltip DOM, `aria-pressed`, ≥44px touch on mobile. **Never** apply chrome tokens (surfaces/radius) to in-player elements — they must read as YouTube's.

### 6.6 Stepper & Select

- **Stepper** (speed): `‹ 1.0× ›` — two 44px tap zones flanking a tabular-num value; press repeats; wraps at bounds with a subtle bump (no wrap). Hover highlights the active arrow only.
- **Select** (quality, format): a `--radius-sm` field, `--surface-2`, chevron; opens a `--elev-2` menu with `role="listbox"`; selected row shows a check + `--accent-text`. Keyboard arrow navigation.

### 6.7 Empty / first-run state (popup on a non-YouTube tab)

```
┌──────────────────────────────────────────────┐
│  ◈ YouTube Audio                        ⚙︎     │
│                                                │
│            ◈  (aqua audio glyph, 40px)         │
│      You're all set.                           │
│      Audio-only, ad-blocking & background      │
│      play are ON by default.                   │
│                                                │
│      [   Open YouTube   ]   ← primary          │
│      Tune settings →        ← secondary        │
└──────────────────────────────────────────────┘
```
- Calm, one illustration, **one primary action**. No checklist, no "get started" gauntlet (R2/R11). Same panel doubles as onboarding (§8).

### 6.8 Instant-apply feedback

- **No Save button** (R5). On change:
  1. control animates to new state (`--dur-1`);
  2. the row **description echoes** settle: e.g. "On" → "On · saving…" for ≤400ms → "On" (or, on failure, `--danger` "Couldn't apply — retry"); this is optimistic UI with an honest failure path;
  3. the **in-player** state reflects immediately (the real receipt);
  4. counters tick via `--type-numeric` tabular-nums so digits don't jitter.
- **No global toast** for routine changes — state *is* the confirmation. Toasts (`--elev-2`, bottom, auto-dismiss 4s) are reserved for **cross-surface** events (e.g., "Settings imported", "Reset to defaults").

---

## 7. Firefox: one system, two surfaces (desktop + Android)

The constraint (from `docs/research/03`): **desktop has a toolbar popup; Android has no toolbar and no popup** — controls reach users via the **Extensions menu → options page** and via **in-player** controls. We design both from the *same* components; only the container changes.

### 7.1 Desktop

- `browser_action.default_popup` → **the popup** (§3.2) is the quick surface. Gear → `options_ui` page (§3.3).
- In-player button present on every watch/music page (§4.1).

### 7.2 Android (Firefox for Android / Fenix)

- **No popup.** Per task constraint, do **not** rely on a `default_popup` as the Android quick surface. Instead:
  - `options_ui` with **`open_in_tab: true`** (small screens; `docs/research/03 §5`) is the primary control surface, reached via ☰ → Extensions → YouTube Audio → Settings.
  - **Pin a "Quick-Controls card" at the very top of the options page** that *is* the popup's Zone 1–4 content (hero audio-only switch + This-video controls + status). So the first screenful on Android == the popup on desktop. Same components, different host.
  - The **in-player controls are the real day-to-day surface** on mobile (§4.2) — most Android users never open the options page after setup.
- **Touch:** every target ≥44×44 (R10); switches use the 52×32 mobile geometry (§6.1); rows 56px tall (§6.2).
- `browserAction.onClicked` (bare toggle) still fires from the Extensions menu as a **fallback**; keep the icon state (`setIcon`) meaningful, but the in-player button + options card are the designed path.

**One-system guarantee:** the popup and the Android quick-controls card render from the **same component tree** with a `layout: "popup" | "page"` prop controlling width/padding only. No forked UI.

---

## 8. Onboarding / first-run

Respectful, seconds-to-value, **nothing required** (R2).

1. **On install:** open **one** welcome tab (not a wizard). Content = the §6.7 panel, full-page: "You're all set. Audio-only, ad-blocking, and background play are already on." One primary **[Open YouTube]**, secondary **[Tune settings]**. No account, no permissions gauntlet beyond Firefox's own grant dialog.
2. **First watch page:** a **one-time coach tooltip** anchored to the in-player audio-only button — "Tap here to toggle audio-only anytime." Auto-dismiss on tap or after one view; stored so it never repeats. Uses YouTube's tooltip styling; respects reduced-motion (fades, no bounce).
3. **That's it.** No step 3. The product is working before onboarding finishes. If the user opens Settings, the **About** group shows a quiet "what's on" checklist so they can see the value they're already getting.

**Anti-patterns banned:** multi-slide carousels, "rate us" on day one, feature tours that block content, forced Settings visit, permission pre-prompts with marketing copy.

---

## 9. Prioritized "delight" list (microinteractions worth doing)

Each has a reduced-motion fallback (R10). Ordered by value/effort.

**P0 — do first (define the product's feel):**
1. **Instant-apply everywhere** (R5) — the single biggest "it just works" signal. (Fallback: n/a.)
2. **In-player button that's truly native** — inherits `ytp-button` hover/opacity/hit so it feels like YouTube shipped it (§4.1). (Fallback: n/a — it's structural.)
3. **Switch thumb spring** — `--ease-spring`, 120ms, +3px press squish (§6.1). (Reduced: crossfade.)
4. **Now-playing aqua pulse** on the hero when audio-only is active — a slow 2s breathing `--accent-wash` halo. (Reduced: static aqua dot.)
5. **Master power morph** — the header/toolbar glyph morphs video→audio-wave when toggled. (Reduced: instant swap.)

**P1 — high polish:**
6. **Skip button slide-in** matching YouTube's exit curve (`content.css:230`) so it feels part of the player (§4.1). (Reduced: fade.)
7. **Counter tick-up** — blocked/skips count animates with tabular-nums, no layout jitter (§6.8). (Reduced: set final value.)
8. **Contextual "This video" reveal** — the section expands only when a video is open, `--dur-2` height+fade. (Reduced: appears/disappears.)
9. **Row settle echo** — "On · saving…" → "On" (§6.8). (Reduced: text change only.)
10. **Popup enter** — 240ms scale(0.98→1)+fade from the top-right (toward the toolbar icon origin) via `--ease-emphasized`. (Reduced: fade.)

**P2 — nice to have:**
11. **First-run coach tooltip** (§8). 12. **Auto theme match** to the page (dark/light handoff). 13. **EQ mini-visualizer** in the Music group when EQ is on. 14. **Category color chips** as quiet identity in skip rows (never full-row fills).

---

## 10. References

**Reference code (cloned `--depth 1`, 2026-07-11):**
- Dark Reader — `darkreader/darkreader@696d3be`: control kit inventory `src/ui/controls/index.ts:1-45`; settings-row primitive `src/ui/controls/control-group/control-group.tsx:1-32`; toggle component `src/ui/controls/toggle/index.tsx`, `src/ui/controls/toggle/style.less`; instant-apply master `src/ui/popup/main-page/app-switch.tsx:18-52`; **token file** `src/ui/theme.less:1-45` (colors, `@time-fast:125ms`/`@time-slow:250ms`, indents). https://github.com/darkreader/darkreader
- SponsorBlock — `ajayyy/SponsorBlock@4a118fb`: in-player button native class + mount `src/js-components/skipButtonControlBar.ts:50,54,95,97,112`; in-player CSS `public/content.css:184` (icon `height:60%`), `:230,236` (YouTube-matched motion), `:246` (`Roboto` font); category colors `src/config.ts:501-589`. https://github.com/ajayyy/SponsorBlock
- uBlock Origin — `gorhill/uBlock@697b2f1`: glanceable Fenix popup `src/popup-fenix.html:26` (power button), `:47-51` (tool switches), `:55,57` (counters); cautionary dashboard `src/dashboard.html` (multi-tab + `dashboardUnsavedWarning` Save model). https://github.com/gorhill/uBlock

**Product studies (no source; shipping-product + design writing):**
- 1Password browser extension — calm single-card popup, search-first settings. https://1password.com
- Raindrop.io / Linear / Arc — nav-rail + searchable, progressively-disclosed settings IA. https://raindrop.io · https://linear.app

**Design-system & standards:**
- Firefox **Photon** color tokens (verified hex, e.g. Blue-50 `#0A84FF`, Grey-90 `#0C0C0D`, Red-60 `#D70022`) — https://github.com/FirefoxUX/photon-colors/blob/master/photon-colors.scss ; Photon visuals https://design.firefox.com/photon/visuals/color.html
- Firefox **Acorn** (current design system, supersedes Photon) — https://acorn.firefox.com/
- Apple **Human Interface Guidelines** — Toggles https://developer.apple.com/design/human-interface-guidelines/toggles ; Motion/Accessibility (Reduce Motion) https://developer.apple.com/design/human-interface-guidelines/accessibility ; 44pt minimum target (Layout). *(HIG toggle/44pt guidance summarized from Apple's published guidance; the live Toggles page is JS-rendered and not quoted verbatim here.)*
- **WCAG 2.1** contrast — 1.4.3 (text 4.5:1 / large 3:1) & 1.4.11 (non-text/UI 3:1). https://www.w3.org/WAI/WCAG21/quickref/
- YouTube dark-surface reference values (`#0F0F0F`, `#212121`, `#F1F1F1`, `#AAAAAA`) observed on youtube.com.

**Our codebase & prior research:**
- `manifest.json` (MV2, `browser_action`, `options_ui`), `js/global.js` (toggle + `setIcon`), `js/youtube_audio.js` (video swap + legacy banner), `css/youtube_audio.css` (current `#272b2e`/`#cc6633` banner — to be retired for tokens).
- `docs/research/03-firefox-mobile-support.md` (no-toolbar Android surface, `open_in_tab`, in-player is primary), `docs/research/09-segment-skipping.md` (categories, auto/manual skip, notice), `docs/research/05-ghost-mode-anti-tracking.md`, `docs/research/01-disable-video-audio-only.md`, `docs/research/06-background-playback-media-controls.md`, `docs/research/02-youtube-ad-blocking.md`.

---

## 11. Implementation checklist (for the first UI PR)

1. Add `tokens.css` (§5) — dark `:root` + `[data-theme="light"]`; wire theme auto-detect.
2. Build the control kit (§6): `Switch`, `Row` (`ControlGroup`), `SectionHeader`, `Stepper`, `Select`, `PopupHeader/Footer`, `StatusRow`, `EmptyState`. Mirror `darkreader/src/ui/controls/`.
3. Popup (`default_popup`, desktop) rendering the §3.2 layout from the kit; `layout="popup"`.
4. Options page (§3.3) with nav-rail + search + progressive disclosure; `layout="page"`; pin the Quick-Controls card at top for Android.
5. In-player module (§4): `ytp-button` audio-only toggle (right cluster) + contextual skip button; mobile `.mobile` branch; retire the legacy banner.
6. Motion + reduced-motion + prefers-contrast (§5.6). Onboarding welcome tab + one-time coach tooltip (§8).
7. A11y pass: contrast audit against §5.1 numbers, 44px targets, focus rings, `role="switch"`/`aria-*`, keyboard traversal.
