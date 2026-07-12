# UX Design Review: Onboarding (First-Run)

Scope: the first-run experience of YouTube Audio on Firefox desktop and Android. Reviewed against the product's own bar (reductive, respectful, one-screen, dark-first, "Live aqua" `#22D3B4`) and the Jobs/Ive standard of anticipating the one real moment of friction and addressing exactly that, nothing more.

Reference material read: `entrypoints/options/App.tsx`, `entrypoints/options/main.tsx`, `entrypoints/popup/App.tsx`, `entrypoints/ui/components.tsx`, `entrypoints/ui/components.css`, `entrypoints/content.ts`, `entrypoints/background.ts`, `src/shared/config.ts`, `wxt.config.ts`, `docs/research/14-design-language-and-ux.md` (§6.7, §8), `docs/specs/SPEC-009-m6-design-polish.md`.

---

## 1. Top-line verdict

The written intent (research §8) is right: respectful, seconds-to-value, nothing required. The **implementation undershoots that intent in one decisive way and overshoots it in another**:

- **Undershoots delivery.** The welcome only appears when the user manually opens the Settings page. Nothing opens on install, so the typical desktop user who installs and goes straight to YouTube **never sees onboarding at all**, and is never taught the one control they need. The welcome that exists is effectively unreachable for most first-run sessions.
- **Overshoots the surface.** The welcome renders as a modal dialog floating over the entire, fully-populated Settings page (nav rail, search, six sections of toggles). That is the opposite of the calm one-screen "You're all set" the doc describes. The busy page reads through the scrim and undercuts the "nothing to configure" message on the very screen that claims it.

Both are fixable with a small, high-leverage change. The correct minimal onboarding is: **one calm welcome screen opened once on install, plus one in-player coach tooltip on the first video, plus a quiet desktop pin tip. No wizard, no carousel, no configuration, no required clicks.**

---

## 2. Current state

### 2.1 What is implemented

| Element | Location | Behavior |
|---|---|---|
| Welcome card | `entrypoints/ui/components.tsx` `Onboarding` | Modal: `.onboarding-backdrop` (translucent `--scrim`) over a centered `role="dialog" aria-modal="true"` card. |
| Trigger | `entrypoints/options/main.tsx` + `App.tsx` | On options load, `hasSeenOnboarding()` reads the `seenOnboarding` local-storage key; if unset, the modal is shown over Settings. |
| Persistence | `App.tsx` `markOnboardingSeen` | Any action (Open YouTube, Tune settings) writes `seenOnboarding = true`. Shows once. |
| Copy | `Onboarding` | Title "You're all set." Body "Audio-only, ad blocking, and background play are already on. Nothing else is required." Primary "Open YouTube" (opens `youtube.com` + marks seen). Secondary "Tune settings" (dismiss). |

### 2.2 What is missing versus the design intent (research §8)

- **No install trigger.** `entrypoints/background.ts` has no `runtime.onInstalled` handler. Research §8 step 1 ("On install: open one welcome tab") is not wired. The welcome is reachable only through the popup gear / footer or the Extensions menu into Settings.
- **No in-player coach tooltip.** Research §8 step 2 (a one-time tooltip anchored to the in-player audio-only button) does not exist. The in-player button is created in `content.ts` (`createPlayerButton(BUTTON_ID, 'Toggle audio-only playback', '♪')`) with only a static `title`/`aria-label`. Nothing points a first-run user at it.
- **No pin nudge.** Nothing tells a Firefox desktop user to pin the toolbar button (Firefox does not pin extensions automatically and offers no API to do it, so this can only be taught).
- **No popup empty state.** `entrypoints/popup/App.tsx` never queries the active tab. On a non-YouTube tab it shows live-looking controls rather than the calm "Open YouTube" panel that research §6.7 designed to double as an always-available front door.

### 2.3 Defaults (the reason onboarding can be tiny)

`src/shared/config.ts` `DEFAULT_SETTINGS`: `enabled`, `audioOnlyEnabled`, `backgroundPlayEnabled`, `ghostEnabled`, `adBlockEnabled`, `segmentSkipEnabled`, `loudnessNormalization` are all **on** out of the box. The product delivers full value with zero configuration. Onboarding therefore has no setup job at all; its only jobs are reassurance, one lesson, and one nudge.

---

## 3. Is onboarding necessary at all?

Mostly no, and that is the point. Because value is on by default, onboarding must not sell features, must not configure anything, and must not gate the product behind clicks. A multi-slide tour here would be pure friction.

But "zero onboarding" is also wrong, for one reason: **the product deliberately does one surprising thing.** When audio-only is on, the first video the user opens does not show moving video. That is the intended, valuable behavior, but to a brand-new user it can read as "the video is broken." Left unexplained, that single moment is the most likely cause of a day-one uninstall. Everything else about the product is invisible and needs no explanation.

So the entire justification for onboarding collapses to one job: **pre-empt the "where did my video go?" moment by teaching the one control that reverses it.** That is a Jobs/Ive framing: find the single point of friction the product creates and resolve exactly that. Reassurance and the pin tip ride along quietly; they do not earn screens of their own.

---

## 4. The ONE thing the user must learn

**Audio-only is already on, and the `♪` button in the player switches between audio and video at any time.**

Not "here are our six features." Not "open Settings to configure." One control, taught at the one moment it matters (the first video). The popup and Settings are progressive discovery for the 10% who go looking; they are not day-one lessons.

---

## 5. Proposed minimal onboarding

Three touchpoints, one of which is a real screen. Nothing is required; the product is already working before any of it is read.

### 5.1 Screen 0: the product itself (no UI)

Defaults are on. The user installs and audio-only, background play, ad and tracker blocking, segment skipping, and loudness normalization are already active. This is the primary "onboarding": the thing works. Preserve it. Do not add a permissions pre-prompt, an account step, or a "get started" gate in front of it.

### 5.2 Screen 1: one welcome, opened once on install

Open the welcome **on install** via `runtime.onInstalled` (reason `install` only, never on update), as a single calm full-surface screen, not a modal floating over the populated Settings page. Reuse the existing options entrypoint and the `seenOnboarding` key; render the welcome as an **opaque full view** with Settings not shown behind it, so the screen honestly looks like "nothing to configure." Dismissing lands the user on Settings.

Exact copy (desktop):

```
   ♪

   You're all set.

   Audio-only, background play, and ad blocking are on.
   Nothing to set up.

   While a video plays, tap  ♪  in the player to switch
   between audio and video.

   [  Open YouTube  ]        <- primary, Live aqua
   Explore settings          <- quiet text button

   Runs without your account, and sends nothing about you anywhere.
   Pin it: click the puzzle-piece Extensions icon in your toolbar,
   then pin YouTube Audio.                      <- desktop only, quiet
```

Rationale for each line:
- **"You're all set."** Reassurance first. The user did the work by installing; there is nothing left to do.
- **One line of what is on.** Three outcomes the user cares about (audio-only, background, ad blocking), not the full six-item default list, and not a single mechanism word. Ghost, segment-skip, and loudness are quietly also on and are discoverable in Settings / About; naming all six here would trade calm for completeness.
- **One teaching line.** This is the load-bearing sentence. It names the exact glyph (`♪`) and the exact action so the first no-video moment is already explained before it happens.
- **One primary CTA: "Open YouTube."** It moves the user to where value happens and where the coach tooltip (5.3) will fire. Exactly one primary action per the popup/one-path rule.
- **"Explore settings"** is the quiet door for the 10%. It never competes with the primary.
- **Privacy line.** The credentialless posture (media fetch uses `credentials: "omit"`, the extension never needs the user's login) is a genuine differentiator; state it once, plainly, as a benefit, not a technical note.
- **Pin line, desktop only, quiet, last.** Teaches the one thing Firefox will not do automatically. It is a tip, not a task; the product works unpinned.

### 5.3 The in-player coach tooltip (first watch page, no screen)

The highest-leverage element and currently absent. On the **first** watch/music page after install, show a one-time tooltip anchored to the `♪` button (`#yta-audio-only-toggle`), in YouTube's own tooltip styling, auto-dismissing on tap or after one view, stored so it never repeats.

Exact copy:

```
Audio-only is on. Tap here for video.
```

This teaches the one control in context, at the exact instant the user notices the video is not playing, with zero screens and zero interruption to playback. It respects reduced motion (fade, no bounce) per the design system. It is the piece that makes the welcome screen optional rather than essential: even a user who dismisses or never sees the welcome still learns the one thing.

### 5.4 What onboarding must NOT do

- No multi-slide carousel, no feature tour, no "rate us" on day one, no forced Settings visit, no permission pre-prompt with marketing copy (research §8 anti-patterns).
- **No ad-block caveat on the welcome.** Ad blocking adapts to YouTube's changes and can occasionally lapse. That honesty belongs in the Settings "Protection & Ghost" description and the About "what's on" summary, not on the first screen. Leading a "you're all set" moment with a warning undercuts the reassurance and trains the user to distrust the product before it has done anything. Suggested placement (Settings description, not onboarding): "Ad blocking adapts to YouTube's changes. If an ad slips through, it usually clears within a day."
- No listing of all six defaults, no counts or stats the product cannot truthfully measure yet (SPEC-009 non-goal: no invented live counters).

---

## 6. Permission and expectation setting

- **Logged-out / account-free is a feature, say it once.** "Runs without your account" on the welcome sets the right expectation: the extension does its work on the media layer, not on the user's identity, and auth-required videos simply fall back to normal playback. This pre-empts "do I need to log in / will this touch my account?"
- **Privacy / credentialless as a selling point, not fine print.** One plain benefit line ("sends nothing about you anywhere") is more persuasive than a privacy policy link on a first screen. Keep it to one line; depth lives in About.
- **Ad-block risk: honest, but not on the front door.** Frame it where a curious user looks (Settings / About), calmly and factually, as in 5.4. Never alarm on install.
- **Firefox's own permission grant is enough.** Do not add a second, extension-branded permission explainer. The manifest requests are already scoped; Firefox shows its own dialog.

---

## 7. Android notes

Firefox for Android has no toolbar popup (`wxt.config.ts` ships `browser_action` for the button, and the options page is `open_in_tab: true`). The Android quick surface is the options page's pinned Quick Controls card plus the in-player button (research §7.2).

- **Welcome:** same single screen, opened once. On Android the options page already opens in a tab, so the `onInstalled` welcome lands naturally as a full page. Good.
- **Drop the pin line on Android.** There is no toolbar to pin to. Gate the pin tip behind a desktop check (for example, hide it when the platform is Android) so the Android welcome is the desktop welcome minus that one line. Keep the privacy line.
- **Coach tooltip is even more important on Android**, because there is no popup fallback: the in-player `♪` button is the day-to-day surface. The same one-time tooltip applies on `m.youtube.com` / `music.youtube.com`, with a >=44px touch target (already required in the design system) and touch-dismiss.
- **No popup empty state on Android** (there is no popup); the options welcome and the in-player tooltip carry the whole first-run.

---

## 8. Prioritized recommendations

### P0 (must fix: onboarding currently does not reach most users)

1. **Trigger the welcome on install.** Add a `runtime.onInstalled` handler (reason `install` only) that opens the welcome once. Without this, the desktop first-run user never sees onboarding and is never taught the `♪` toggle. This is the single change that makes everything else matter. `entrypoints/background.ts`.
2. **Make the welcome a calm full screen, not a modal over Settings.** Render the welcome as an opaque full-surface view (Settings not shown behind a scrim) so "nothing to set up" is visually true. Reuse the `seenOnboarding` plumbing; change the presentation only. `entrypoints/ui/components.tsx` (`Onboarding`), `entrypoints/ui/components.css` (`.onboarding-backdrop` -> opaque `--surface-0`), `entrypoints/options/App.tsx` (render welcome instead of, not over, the settings tree until dismissed).
3. **Add the in-player coach tooltip.** One-time, anchored to `#yta-audio-only-toggle`, copy "Audio-only is on. Tap here for video.", auto-dismiss on tap or after one view, stored so it never repeats, reduced-motion safe. `entrypoints/content.ts`. This is the piece that actually teaches the one thing at the one moment.

### P1 (high polish: completes the intended experience)

4. **Add the desktop pin tip** to the welcome (quiet, last line, desktop only): "Pin it: click the puzzle-piece Extensions icon in your toolbar, then pin YouTube Audio." Hidden on Android.
5. **Add the privacy / account-free reassurance line** to the welcome: "Runs without your account, and sends nothing about you anywhere."
6. **Give the popup a non-YouTube empty state** (research §6.7): on a non-YouTube tab, show the calm "You're all set / Open YouTube" panel instead of dead controls. This is a second, always-available front door and matches the design system. `entrypoints/popup/App.tsx` (query the active tab).
7. **Tighten the welcome copy** to the exact strings in 5.2 (rename "Tune settings" -> "Explore settings"; add the teaching line; drop "Nothing else is required" in favor of "Nothing to set up").

### P2 (nice to have)

8. **Popup header context chip** (`youtube.com` / `music` / `not YouTube`) per research §6.4, tied to the empty state in P1-6.
9. **About "what's on" summary** in Settings: a quiet checklist of everything already active, plus the honest ad-block-adapts note, so the curious user can see the value they are already getting without any of it being pushed at install.
10. **Consider a distinct in-player "audio-only" glyph** rather than reusing the brand `♪`, so the active state reads unambiguously in the player (in-player scope, not strictly onboarding).

---

## 9. Consolidated copy deck

| Surface | String |
|---|---|
| Welcome, title | You're all set. |
| Welcome, what's on | Audio-only, background play, and ad blocking are on. Nothing to set up. |
| Welcome, teach | While a video plays, tap ♪ in the player to switch between audio and video. |
| Welcome, primary CTA | Open YouTube |
| Welcome, secondary | Explore settings |
| Welcome, privacy line | Runs without your account, and sends nothing about you anywhere. |
| Welcome, pin tip (desktop only) | Pin it: click the puzzle-piece Extensions icon in your toolbar, then pin YouTube Audio. |
| In-player coach tooltip | Audio-only is on. Tap here for video. |
| Settings ad-block description (not onboarding) | Ad blocking adapts to YouTube's changes. If an ad slips through, it usually clears within a day. |

---

## 10. Screen count and call to action (summary)

- **Screens the user is shown:** one (the welcome), opened once on install, dismissible in a single click. Plus one contextual tooltip that is not a screen.
- **Screens the user is required to click through:** zero. The product works before any of it is read.
- **Single call to action:** Open YouTube.

---

## 11. Testability

Every element above is verifiable on the local fake-YouTube E2E bench (live YouTube canary-only), matching the testability mandate:

- `onInstalled` opens exactly one welcome surface on `install` and not on `update`.
- The welcome shows once: after any dismiss action, `seenOnboarding` is persisted and the welcome does not reappear on the next options load.
- The welcome renders no Settings firehose behind it (assert the settings sections are not present while the welcome is shown).
- The coach tooltip appears once on the first watch page (the bench already loads the player and references `#yta-audio-only-toggle`), dismisses on tap, and never reappears on subsequent navigations.
- The pin line is present on desktop and absent on the Android layout.
- The popup empty state renders the "Open YouTube" panel on a non-YouTube tab and the live controls on a YouTube tab.
