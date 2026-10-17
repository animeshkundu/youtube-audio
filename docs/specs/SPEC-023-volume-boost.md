# SPEC-023: Volume boost

**Status:** Draft
**Date:** 2026-10-17
**Depends on:** SPEC-007 (YouTube Music extras), ADR-0015 (coexistence)
**Relates to:** Research 07 (distribution), Research 10 (QoL UX) §5

## 1. Goal

Add a volume boost feature (amplify audio beyond normal levels, up to 2x) as an opt-in Advanced setting. Uses the existing Web Audio graph (GainNode + DynamicsCompressorNode limiter). Fail-open: if boost fails, native playback continues at unity.

## 2. Non-goals

- No top-level toggle (Advanced slider only).
- No boost beyond 2x (clipping risk).
- No UI in popup (settings-only).

## 3. Design

### 3.1 Settings model

- `volumeBoostEnabled: boolean` (default false)
- `volumeBoostAmount: number` (default 1.0, clamped [1.0, 2.0] in UI, [1.0, 3.0] in code safety bound)

### 3.2 Audio graph

- `createAudioGraph` creates a `DynamicsCompressorNode` always (fail-open: if creation fails, graph degrades to gain → destination).
- Compressor acts as limiter: when boost enabled (amount > 1), threshold -24dB, ratio 4:1, attack 0.003s, release 0.25s. When disabled, passthrough (threshold 0, ratio 1).
- `applyGraphSettings` computes `gain = loudnessGain * boostMultiplier`, clamped [0.5, 2.0]. Calls `setGain(gain)` then `setBoost(enabled, amount)`.
- `setBoost` configures compressor only (gain already set by `setGain`).
- `dispose()` resets gain to 1, EQ to 0, compressor to passthrough. Graph stays connected.

### 3.3 Settings diffing

- `volumeBoostEnabled` and `volumeBoostAmount` included in `pageSubsystemReArm` `graph` re-arm condition.

### 3.4 Fail-open

- If compressor creation fails, graph degrades to gain → destination (no limiter, but gain still applied).
- If AudioContext resume fails, dry path (source → destination) stays connected.
- If boost fails mid-playback, `dispose()` resets to unity; native playback continues.

## 4. Test strategy

- Unit: gain clamping with boost, limiter insertion, dispose safety.
- Bench: toggle cycle (boost on → off → on) with no position jump.
- Matrix: volumeBoostEnabled alone, with loudness, with EQ, with both.

## 5. UI (minimal surface)

- Advanced section: "Volume boost" toggle (off by default) + "Boost amount" slider (0-100%, default 0, visible only when enabled).
- No popup surface. No onboarding mention.

---

_Spec written per "no spec, no code" rule._
