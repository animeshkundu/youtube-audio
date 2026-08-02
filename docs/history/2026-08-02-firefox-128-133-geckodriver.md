# Firefox 128-133 desktop E2E driver qualification

## Scope

Qualify the bottom of the declared Firefox desktop support range, where Selenium could start Firefox but `driver.installAddon()` failed before the hermetic suites ran.

## Findings

- With the npm-provided geckodriver 0.37.1, temporary add-on installation fails with an empty `InvalidArgumentError` on Firefox 128 ESR and Firefox 133.
- The exact Firefox breakpoint is 134. Direct installation probes with the same bench XPI and geckodriver 0.37.1 failed on 133 and succeeded on every release from 134 through 139.
- The failure is a driver/protocol compatibility regression, not an extension manifest rejection. Geckodriver 0.36.0 installs the same XPI successfully on Firefox 128 ESR, 133, and 139.
- Geckodriver 0.35.0 and older do not accept the required `--allow-system-access` argument, so 0.36.0 is the clean compatibility pin for this harness.

## Changes

- `tests/e2e/bench/run-bench.mjs` now accepts `GECKODRIVER_BIN` and passes it explicitly to Selenium's `ServiceBuilder` while retaining the required `--allow-system-access` service argument.
- Both Firefox 128/133 CI bench and settings-matrix legs download geckodriver 0.36.0, verify SHA-256 `0bde38707eb0a686a20c6bd50f4adcc7d60d4f73c60eb83ee9e0db8f65823e04`, and export `GECKODRIVER_BIN`. Newer Firefox legs continue to use the npm-provided current driver.
- `docs/ci-cd.md` and SPEC-013 document the split.

## Verification

Installation probes used the real `dist/youtube-audio-bench.xpi`:

- Firefox 128 ESR + geckodriver 0.37.1: `InvalidArgumentError`, empty message.
- Firefox 128 ESR + geckodriver 0.36.0: installed.
- Firefox 133 + geckodriver 0.37.1: `InvalidArgumentError`, empty message.
- Firefox 133 + geckodriver 0.36.0: installed.
- Firefox 134, 135, 136, 137, 138, and 139 + geckodriver 0.37.1: installed.

Full-suite outcomes after the driver fix:

- Firefox 128 ESR: the XPI installs, then the first control-session fixture navigation times out after 300 seconds. The runner exits with `verdict: "ERROR"` before recording any assertions, so the real count is 0 passed / 0 failed / 52 not run.
- Firefox 133: the XPI installs, then the same first control-session fixture navigation times out after 300 seconds. The runner exits with `verdict: "ERROR"` before recording assertions, so the real count is 0 passed / 0 failed / 52 not run.

This navigation hang is a distinct old-Firefox harness/product compatibility finding. It is no longer an add-on-install failure, and it was not misreported as a pass.
