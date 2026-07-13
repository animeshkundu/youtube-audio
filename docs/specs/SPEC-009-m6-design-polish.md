# Specification: M6 Design Polish

## Overview

M6 turns the extension-owned popup and options documents into one cohesive, dark-first control system while preserving every existing feature and instant-apply behavior. Desktop users get a focused 320px popup; Android users get the same essential controls pinned at the top of the full settings page.

## Goals

- Define shared color, typography, spacing, radius, elevation, and motion tokens with dark and light themes.
- Keep the desktop popup to one master hero, two frequent playback toggles, glanceable protection status, and one settings link.
- Present every shipped setting in searchable, grouped options sections with advanced settings disclosed progressively.
- Make the options page a complete Android primary surface with touch targets of at least 44px.
- Show a respectful one-screen introduction once, without requiring setup or interrupting working defaults.
- Give audio-only and download player buttons one native `ytp-button`-compatible visual language.
- Provide keyboard operation, visible focus, semantic switch state, non-color state cues, and reduced-motion handling.

## Non-Goals

- No feature behavior, defaults, permissions, host matches, network flows, or storage schema changes.
- No multi-step tour, save/apply workflow, remote assets, analytics, or new dependency in production code.
- No invented live counters. Popup protection status reflects configured state rather than claiming measured totals.

## Technical Design

### Shared control kit

`entrypoints/ui/` owns `tokens.css`, reusable `Switch`, `SettingRow`, `SectionHeader`, brand header, status row, onboarding panel, and quick-controls composition. Popup and options import this kit; host-page code remains framework-free.

A switch is a native button with `role="switch"`, `aria-checked`, an accessible name, and a visible On/Off label in addition to thumb position and color. Settings rows preserve a 44px minimum target and expose their descriptions through `aria-describedby`.

### Popup

The popup is exactly 320px wide. Its master control maps to the existing global `enabled` setting. Audio-only and background play remain separate instant controls. Read-only rows summarize segment skipping and ad/privacy protection from current settings. Header and footer both open the full options page.

### Options

The options document provides a sticky search field, desktop navigation rail, and grouped sections for Quick Controls, Playback, Protection & Ghost, Enhancers, Music, and Advanced. All existing settings remain represented. Rare or potentially disruptive controls are inside native disclosure elements. Search filters rows across sections and expands matching advanced groups.

### Onboarding

The options page checks a dedicated `seenOnboarding` local-storage key. When absent, a compact one-screen introduction states that useful defaults are already active and offers dismiss, open YouTube, and continue-to-settings actions. Any action marks the introduction seen. The feature does not alter the existing settings object.

### In-player controls

Audio-only and download buttons continue to use YouTube's `ytp-button` class and existing click behavior. A small extension-owned style element provides consistent native-font glyph alignment, 44px minimum targets, visible focus, active aqua state, and reduced-motion handling. State is conveyed with `aria-pressed`, title/label text, and color.

## Error Handling

Settings remain optimistic and storage-backed. Popup errors are displayed inline. Onboarding persistence failure dismisses the panel for the current document without affecting settings. Player-control styling is best effort and never affects playback.

## Testing Strategy

- jsdom Vitest tests render popup and options components directly.
- Tests assert sections, labels, switch semantics, search filtering, one-time onboarding, and immediate setter calls.
- Existing unit coverage, all 20 packaged-extension bench cases, strict typecheck, zero-warning lint, gate-weakener scan, production build, and exact four-match manifest inspection remain release gates.

## Accessibility and Responsive Design

- Every interactive target is at least 44px in either dimension.
- Focus-visible rings use the accent hover token and do not rely on browser defaults alone.
- Text and UI colors use the documented contrast-safe palette.
- State has text and semantic attributes in addition to color and geometry.
- Motion uses named tokens and collapses under `prefers-reduced-motion`.
- `prefers-contrast: more` strengthens boundaries.
- Below 720px, options become one column and the pinned Quick Controls section is the primary surface.

## Rollout and Rollback

M6 is presentation-only. Removing the shared UI files and restoring the prior popup/options documents rolls back the visual layer without migrating settings or changing feature state.
