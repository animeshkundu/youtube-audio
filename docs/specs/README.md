# Technical Specifications

## Purpose

This folder contains technical specifications that **MUST** be written before any code implementation.

## The Specification-First Workflow

> **"No spec, no code."**

1. **Before writing any code**, create a specification document here
2. Get the spec reviewed (by humans or agents)
3. Only after spec approval, begin implementation
4. Update the spec if implementation reveals necessary changes

## When to Write a Spec

- New features or components
- Significant refactoring
- API changes
- Integration with external services
- Database schema changes
- Performance optimizations

## Spec Template

```markdown
# Specification: [Feature Name]

## Overview

Brief description of what this spec covers.

## Goals

- What are we trying to achieve?
- What problem does this solve?

## Non-Goals

- What is explicitly out of scope?

## Technical Design

### Architecture

Describe the high-level architecture.

### Data Flow

Describe how data moves through the system.

### API/Interface Design

Define any APIs or interfaces.

### Error Handling

How will errors be handled?

## Testing Strategy

- Unit tests required
- Integration tests required
- Edge cases to cover

## Security Considerations

- Authentication/Authorization
- Data validation
- Potential vulnerabilities

## Performance Considerations

- Expected load
- Scalability concerns
- Resource usage

## Dependencies

- External libraries
- Services
- Other components

## Rollout Plan

- Phased deployment approach
- Feature flags
- Rollback strategy

## Open Questions

- List any unresolved questions
```

## File Naming Convention

- Format: `SPEC-NNN-feature-name.md`
- Example: `SPEC-001-manifest-v3-migration.md`
