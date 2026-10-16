# ADR-0013: Scriptlet coexistence is additive chaining, not a blanket skip

## Status

Accepted. Supersedes the coexistence heuristic described in SPEC-004 ("non-native
`JSON.parse`/`JSON.stringify` means a page-context blocker is present, so apply no scriptlets").

## Date

2026-10-15

## Context

The bundled page-world scriptlets (inline `ytInitialPlayerResponse` accessor, `JSON.parse` wrap,
`fetch`/`Response.json` prune) were guarded by a heuristic: if `JSON.parse` or `JSON.stringify`
looked non-native, `applyScriptletOperations` returned `applied: 0` and installed nothing, to avoid
fighting another content blocker. The heuristic was always best-effort (wrappers can be
indistinguishable from native code, and native code can look non-native), but the failure mode is
the bad one: stock YouTube replaces or freezes JSON serialization on some pages, so the guard
false-positives on YouTube itself and silently disables every scriptlet, including the ones that
prune ads from responses the extension already fetches. The background `filterResponseData` pruner
is independent and was unaffected, but the page-world half of the feature could stand down on
exactly the pages that need it, with no user-visible signal.

The operations were written to be additive: each one captures the current implementation, installs
a wrapper that calls through to it, prunes only the value it produced, and cleanup restores the
captured implementation only when the operation still owns the installed value. None of them
depends on being the only wrapper in the chain.

## Decision

Remove the skip heuristic entirely. Coexistence is additive chaining:

- Each scriptlet wraps whatever implementation is currently installed, calls through to it, and
  prunes only what it produced; multiple wrappers chain in installation order.
- Cleanup restores the captured prior implementation only if the operation's own wrapper is still
  installed; if something wrapped us later, we leave their wrapper (which still wraps ours) alone.
- Every operation remains individually try/caught, and a JSON target that cannot be wrapped is a
  silent no-op, so the failure mode stays fail-open.
- Foreign non-native JSON is no longer treated as a signal of anything.

## Consequences

- Scriptlets now apply on pages where they previously stood down, including stock YouTube pages
  that replace JSON serialization and pages running other extensions' hooks.
- Pruning is idempotent (already-pruned objects contain no ad keys and pass through unchanged), so
  chained wrappers cannot double-mutate a response into a different shape.
- Unit tests pin the new contract: with a foreign `JSON.stringify`/`JSON.parse` installed, the
  operations still apply (red on the old heuristic) and cleanup does not clobber the foreign hook.
- No user-visible setting changes; the `adBlockEnabled` toggle and the background pruner are
  untouched.

## Related

- SPEC-004 (updated coexistence section), `src/shared/scriptlets.ts`,
  `tests/unit/scriptlets.test.ts`, ADR-0010/ADR-0011 (filter-chain ordering and idempotent pruning).
