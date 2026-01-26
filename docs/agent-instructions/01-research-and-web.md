# Research and Web Guidelines

## The Prime Directive

> **The internet is a first-class tool. Use it before you code.**

## Principle 1: Internet is First-Class

### Why Research First?

- APIs change frequently
- Best practices evolve
- Libraries are deprecated
- New solutions emerge
- Documentation may be outdated

### Mandatory Research Triggers

You **MUST** perform web research before:

- Using any external library or API
- Implementing security-sensitive code
- Making architectural decisions
- Choosing between multiple approaches
- Working with unfamiliar technologies

### Research Sources

Prioritize in this order:

1. **Official documentation** - Always check first
2. **GitHub repositories** - Check issues, discussions, recent commits
3. **Stack Overflow** - Verified solutions (check dates!)
4. **Technical blogs** - From reputable sources
5. **Community forums** - For edge cases

## Principle 2: Validation Protocol

### Library Validation

Before using any library, validate:

```markdown
## Library Validation: [library-name]

### Basic Information

- Name: [npm/pip/etc package name]
- Current Version: [latest stable]
- Last Updated: [date]
- Weekly Downloads: [number]

### Health Indicators

- [ ] Active maintenance (commits in last 6 months)
- [ ] Responsive to issues
- [ ] No critical security vulnerabilities
- [ ] Compatible with our stack
- [ ] License is acceptable

### Version Check

- Documentation version: [what docs say]
- Actual latest version: [from package registry]
- Breaking changes in recent versions: [yes/no, details]

### Validation Method

[How I verified this information]
```

### API Validation

Before using any external API:

```markdown
## API Validation: [API Name]

### Endpoint

- URL: [base URL]
- Documentation: [link]
- Last verified: [date]

### Authentication

- Method: [API key, OAuth, etc.]
- Rate limits: [requests per minute/hour]

### Response Format

- Verified structure matches docs: [yes/no]
- Sample response: [example]

### Error Handling

- Known error codes: [list]
- Retry strategy: [description]
```

## Principle 3: Information Saturation

### The Saturation Point

Research until you reach **information saturation**—the point where additional research yields no new insights.

### Signs of Saturation

✅ Multiple sources agree on the approach  
✅ You understand the trade-offs  
✅ Edge cases are identified  
✅ No conflicting information remains unresolved  
✅ You can explain the solution without notes

### Signs You Need More Research

❌ Conflicting information from sources  
❌ Uncertainty about best practices  
❌ Unfamiliar with failure modes  
❌ Can't answer "why this approach?"  
❌ Only found one source

### Research Depth by Task Type

| Task Type         | Minimum Research                         |
| ----------------- | ---------------------------------------- |
| Bug fix           | Check if known issue, existing solutions |
| New feature       | Full saturation required                 |
| Dependency update | Changelog review, breaking changes       |
| Security fix      | Critical - extensive research required   |
| Refactor          | Understand all affected patterns         |

## Principle 4: No Hallucination Policy

### The Rule

> **Never guess. Never assume. Always verify.**

### What Constitutes Hallucination?

- Making up API endpoints
- Assuming function signatures
- Inventing configuration options
- Guessing at library behavior
- Fabricating version numbers

### When Uncertain

1. **Stop** - Don't proceed with uncertainty
2. **Research** - Use web search to verify
3. **Confirm** - Find authoritative source
4. **Document** - Record your finding

### Verification Template

```markdown
## Verification Record

### Claim

[What I'm verifying]

### Source

[Authoritative source URL]

### Verification Date

[When I checked]

### Confidence Level

[High/Medium/Low with explanation]
```

## Research Workflow

### Step-by-Step Process

```
1. Identify what you need to know
         ↓
2. Search official documentation first
         ↓
3. Cross-reference with multiple sources
         ↓
4. Check recency of information
         ↓
5. Validate version compatibility
         ↓
6. Document findings
         ↓
7. Proceed only with verified information
```

### Documentation of Research

Always document your research in your work:

```markdown
## Research Summary

### Topic

[What I researched]

### Key Findings

- [Finding 1]
- [Finding 2]

### Sources

- [URL 1] - [What I learned]
- [URL 2] - [What I learned]

### Decision

[Based on research, I will...]

### Confidence

[High/Medium/Low] because [reason]
```

## Summary

1. **Research before coding** - Internet is a tool, use it
2. **Validate everything** - Libraries, APIs, versions
3. **Reach saturation** - Don't stop until you truly understand
4. **Never hallucinate** - Verify or don't proceed
