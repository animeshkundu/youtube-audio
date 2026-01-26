# Core Philosophy

## The Prime Directive
> **Documentation equals code. No documentation, no code.**

## Principle 1: Docs = Code

### The Rule
Every piece of code **MUST** have corresponding documentation. This is not optional—it is the foundation of how we work.

### Before Writing Code
1. Write or update the specification in `docs/specs/`
2. Ensure architecture diagrams in `docs/architecture/` reflect your changes
3. Check `docs/adrs/` for relevant past decisions

### After Writing Code
1. Update `docs/history/` with a handoff record
2. Verify all documentation is synchronized with implementation
3. Document any deviations from the original spec

### Documentation Types
| Code Change | Required Documentation |
|-------------|----------------------|
| New feature | Spec + Architecture update |
| Bug fix | Note in history, update spec if needed |
| Refactor | Architecture update, ADR if significant |
| Dependency change | ADR required |

## Principle 2: The CEO Model

### Hierarchy
When working on complex tasks, agents operate in a hierarchical model:

```
CEO Agent (Initiator)
├── Worker Agent 1 (Subtask A)
├── Worker Agent 2 (Subtask B)
└── Worker Agent 3 (Subtask C)
```

### CEO Responsibilities
- Decompose the task into subtasks
- Delegate to specialized workers
- Synthesize results
- Make final decisions
- Ensure documentation compliance

### Worker Responsibilities
- Execute assigned subtasks
- Report progress and blockers
- Request clarification when needed
- Follow all protocols strictly

### Communication
- Workers report to CEO, not to each other
- CEO maintains context across all workers
- Handoffs between workers go through CEO

## Principle 3: First Principles Reasoning

### The Process
Before implementing anything:

1. **Understand** - What is the actual problem?
2. **Decompose** - Break into fundamental components
3. **Research** - Gather relevant information
4. **Plan** - Create a step-by-step approach
5. **Validate** - Check plan against requirements
6. **Execute** - Implement with continuous verification

### Anti-Patterns to Avoid
❌ Copying code without understanding  
❌ Assuming solutions based on pattern matching  
❌ Implementing without a plan  
❌ Skipping research phase  
❌ Ignoring edge cases  

### Thinking Process
Document your reasoning explicitly:

```markdown
## Reasoning

### Problem Understanding
[What I understand the problem to be]

### Key Constraints
[Limitations and requirements]

### Approach
[My planned solution and why]

### Risks
[What could go wrong]

### Validation
[How I will verify success]
```

## Principle 4: Synchronization

### The Sync Workflow
After completing any work:

1. **Review** all files changed
2. **Update** corresponding documentation
3. **Record** handoff in `docs/history/`
4. **Verify** no documentation drift

### Documentation Drift
Documentation drift occurs when code and docs become out of sync. This is a **critical failure**.

To prevent drift:
- Always update docs in the same PR as code
- Review docs during code review
- Automate checks where possible

### Checklist Before Completing Work
- [ ] Spec reflects implementation
- [ ] Architecture diagrams are accurate
- [ ] ADRs are current
- [ ] Handoff recorded in history
- [ ] No undocumented assumptions

## Summary
1. **Write docs first**, then code
2. **CEO delegates**, workers execute
3. **Reason from first principles**, not patterns
4. **Keep everything synchronized**, always
