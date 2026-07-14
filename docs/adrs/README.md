# Architecture Decision Records (ADRs)

## Purpose

Some choices are worth remembering the reasoning behind, not just the
outcome. This folder holds the ones that mattered: what we chose, what we
weighed against it, and why, so a future change does not accidentally undo a
decision nobody remembers making.

## What is an ADR?

An Architecture Decision Record is a short document that captures an important architectural decision made along with its context and consequences.

## When to Create an ADR

- When making a significant technical choice
- When changing technology or framework
- When establishing patterns or conventions
- When deprecating existing approaches

## How to Use

1. Copy `0000-template.md` to a new file with the next sequential number
2. Fill in all sections thoroughly
3. Submit as part of your PR for review
4. Update status as the decision evolves

## File Naming Convention

- Format: `NNNN-short-title.md`
- Example: `0001-use-manifest-v3.md`

## ADR Statuses

- **Proposed**: Under discussion
- **Accepted**: Approved and in effect
- **Deprecated**: No longer applicable
- **Superseded**: Replaced by a newer ADR
