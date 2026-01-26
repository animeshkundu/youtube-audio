# Claude Agents Configuration

This folder is a placeholder for Claude-specific agent configurations.

## Purpose

This folder will contain configurations for Claude AI agents working on this repository:

- Agent personality definitions
- Task-specific prompts
- Workflow configurations
- Memory and context settings

## Current Status

This folder is prepared for future use. As Anthropic develops more sophisticated agent capabilities, this structure will accommodate those configurations.

## Expected Future Contents

```
agents/
├── code-agent.md        # Code generation agent config
├── review-agent.md      # Code review agent config
├── docs-agent.md        # Documentation agent config
└── test-agent.md        # Testing agent config
```

## Integration

Claude agents should:
1. Read `docs/agent-instructions/` before any task
2. Follow the protocols defined there
3. Use configurations in this folder for task-specific behavior

## References

- [Claude Documentation](https://docs.anthropic.com/)
- [Claude for Work](https://www.anthropic.com/claude-for-work)
