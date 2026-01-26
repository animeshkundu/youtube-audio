# Testing and Validation Guidelines

## The Prime Directive

> **If it's not tested, it doesn't work. Period.**

## Principle 1: The 90% Rule

### Code Coverage Mandate

All code contributions **MUST** achieve a minimum of **90% code coverage** for:

- Unit tests
- Integration tests

### What This Means

```
Lines of code written: 100
Lines covered by tests: 90+ (minimum)
```

### Coverage Metrics

Track these metrics:

- **Line coverage**: % of lines executed by tests
- **Branch coverage**: % of conditional branches tested
- **Function coverage**: % of functions called by tests

### Exceptions (Rare)

Coverage below 90% may be acceptable only for:

- Trivial getters/setters (document why)
- Third-party integration code (mock instead)
- Legacy code being refactored (with improvement plan)

**All exceptions require documented justification.**

## Principle 2: Test-Driven Development

### The TDD Workflow

```
1. Write the test FIRST
         ↓
2. Run test (it should FAIL)
         ↓
3. Write minimal code to pass
         ↓
4. Run test (it should PASS)
         ↓
5. Refactor if needed
         ↓
6. Repeat
```

### Why Tests First?

- Forces clear understanding of requirements
- Ensures testable code design
- Documents expected behavior
- Prevents feature creep
- Provides immediate feedback

### Test Structure (AAA Pattern)

```javascript
describe('Feature', () => {
  it('should do something specific', () => {
    // Arrange - Set up test conditions
    const input = 'test data';

    // Act - Execute the code being tested
    const result = functionUnderTest(input);

    // Assert - Verify the outcome
    expect(result).toBe('expected output');
  });
});
```

## Principle 3: Test Types

### Unit Tests

**Scope**: Single function or method  
**Isolation**: No external dependencies  
**Speed**: Fast (< 100ms each)

```javascript
// Example: Testing URL parameter removal
describe('removeURLParameters', () => {
  it('should remove specified parameters from URL', () => {
    const url = 'https://example.com?a=1&b=2&c=3';
    const result = removeURLParameters(url, ['b']);
    expect(result).toBe('https://example.com?a=1&c=3');
  });

  it('should handle URL without parameters', () => {
    const url = 'https://example.com';
    const result = removeURLParameters(url, ['any']);
    expect(result).toBe('https://example.com');
  });
});
```

### Integration Tests

**Scope**: Multiple components together  
**Isolation**: May use real dependencies or mocks  
**Speed**: Moderate (< 5s each)

```javascript
// Example: Testing browser storage integration
describe('Settings Integration', () => {
  it('should persist and retrieve settings', async () => {
    await saveSettings(true);
    const result = await loadSettings();
    expect(result.youtube_audio_state).toBe(true);
  });
});
```

### End-to-End Tests

**Scope**: Full user workflows  
**Isolation**: Real browser environment  
**Speed**: Slow (acceptable)

## Principle 4: Self-Correction

### Before Committing

Every agent **MUST** run tests locally before committing:

```bash
# Run the validation script
./scripts/validate.sh
```

### Self-Correction Workflow

```
1. Write code
         ↓
2. Run tests locally
         ↓
3. Tests fail?
    YES → Fix code, return to step 2
    NO  → Continue
         ↓
4. Run linter
         ↓
5. Linter errors?
    YES → Fix issues, return to step 4
    NO  → Continue
         ↓
6. Check coverage
         ↓
7. Coverage < 90%?
    YES → Add more tests, return to step 2
    NO  → Ready to commit
```

### When Tests Fail

1. **Read the error message** carefully
2. **Identify the root cause** (not just symptoms)
3. **Fix the code** (not the test, usually)
4. **Add regression test** if needed
5. **Re-run all tests** to ensure no regressions

## Test File Organization

### Structure

```
project/
├── js/
│   ├── global.js
│   └── youtube_audio.js
├── tests/
│   ├── unit/
│   │   ├── global.test.js
│   │   └── youtube_audio.test.js
│   └── integration/
│       └── extension.test.js
├── jest.config.js
└── package.json
```

### Naming Conventions

- Test files: `[module].test.js` or `[module].spec.js`
- Test descriptions: Should read like documentation
- Test function names: `should [expected behavior] when [condition]`

## Coverage Reporting

### Generating Reports

```bash
# Run tests with coverage
npm test -- --coverage

# View coverage report
open coverage/lcov-report/index.html
```

### Interpreting Reports

- 🟢 Green: Covered lines
- 🔴 Red: Uncovered lines
- 🟡 Yellow: Partially covered branches

### Coverage Goals by File Type

| File Type        | Target Coverage |
| ---------------- | --------------- |
| Core logic       | 95%+            |
| Utilities        | 90%+            |
| UI handlers      | 85%+            |
| Config/constants | N/A             |

## Testing Best Practices

### Do

✅ Test edge cases  
✅ Test error conditions  
✅ Use descriptive test names  
✅ Keep tests independent  
✅ Test one thing per test  
✅ Use meaningful assertions

### Don't

❌ Test implementation details  
❌ Use magic numbers without explanation  
❌ Write tests that depend on order  
❌ Skip tests without documentation  
❌ Test external libraries  
❌ Write flaky tests

## Summary

1. **90% coverage minimum** - Non-negotiable
2. **Tests before code** - TDD is the way
3. **Self-validate always** - Run tests before committing
4. **Fix code, not tests** - Tests define expected behavior
