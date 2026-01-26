# History & Handoff Documentation

## Purpose

This folder records important historical context, handoffs between agents/developers, and deprecated logic.

## When to Document Here

### Agent Handoffs

When an AI agent completes work and another agent (or human) will continue:

```markdown
# Handoff: [Task Name]

## Date

YYYY-MM-DD

## Completed By

[Agent/Developer Name]

## Summary

Brief description of what was accomplished.

## Key Changes

- List of significant changes made
- Files modified
- New patterns introduced

## Known Issues

- Any issues discovered but not addressed
- Technical debt introduced

## Next Steps

- What should the next developer/agent do?
- Priorities and recommendations

## Context for Continuation

- Important decisions made and why
- Things that were tried but didn't work
- Relevant conversations or references
```

### Deprecated Logic

When code patterns or approaches are deprecated:

```markdown
# Deprecated: [Feature/Pattern Name]

## Date Deprecated

YYYY-MM-DD

## Reason

Why was this deprecated?

## Replacement

What should be used instead?

## Migration Guide

Steps to migrate from old to new approach.

## Removal Timeline

When will this be fully removed?
```

### Historical Decisions

Important historical context that doesn't fit in ADRs:

```markdown
# Historical Note: [Topic]

## Date

YYYY-MM-DD

## Context

What was happening at this time?

## Relevance

Why is this important to remember?

## References

Links to relevant PRs, issues, or discussions.
```

## File Naming Convention

- Handoffs: `HANDOFF-YYYY-MM-DD-topic.md`
- Deprecated: `DEPRECATED-feature-name.md`
- Historical: `HISTORY-topic.md`
