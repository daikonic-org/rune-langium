# Testing Guide

This repo uses Vitest for unit/integration coverage, Playwright for browser
coverage, and a dedicated production verification flow for deployed endpoints
and post-deploy UI smoke tests.

## Production Verification

### Endpoint smoke checks

```bash
# Default production endpoint checks.
pnpm run verify:prod

# Include telemetry once that worker is expected to be live.
ENABLE_TELEMETRY=1 pnpm run verify:prod

# Target a staging or preview deployment.
BASE=https://staging.example/rune-studio pnpm run verify:prod
```

What `verify:prod` covers:

- Studio HTML reachability
- Curated mirror manifests for `cdm`, `fpml`, and `rune-dsl`
- Curated `latest.tar.gz` archive reachability for those same models
- GitHub auth `device-init`
- Codegen worker `/api/generate/health`
- Same-origin Pages Function probes for `/api/lsp/health`, `/api/lsp/session`, and `/api/parse`

Telemetry probes are currently **optional** and are only included when
`ENABLE_TELEMETRY=1`.

### Browser smoke checks

```bash
# Run the dedicated production Playwright smoke against the default deploy.
pnpm run verify:prod:ui

# Override the deployed Studio origin explicitly.
PLAYWRIGHT_BASE_URL=https://www.daikonic.dev/rune-studio/studio/ pnpm run verify:prod:ui

# Run both endpoint and browser production checks.
pnpm run verify:prod:all
```

The prod Playwright smoke is isolated from the normal E2E suite. It uses
`apps/studio/playwright.prod.config.ts` and only runs specs under
`apps/studio/test/prod-smoke/`, so setting `PLAYWRIGHT_BASE_URL` for a prod
check does **not** accidentally point the full local E2E suite at production.

The current smoke flow:

1. Opens the deployed Studio in a fresh browser context
2. Loads the CDM curated bundle
3. Navigates one enum and one data type from the namespace explorer
4. Verifies Structure and Inspector update
5. Verifies Source opens the original read-only curated file when selecting a reference type

### Full checkout harness (`test:prod-ux`)

```bash
# Run the full 22-journey (J00-J21) checkout harness against the default deploy.
pnpm --filter @rune-langium/studio run test:prod-ux

# Keep the existing report intact during focused production triage.
ENABLE_TELEMETRY=1 PROD_UX_REPORT_DIR="$PWD/dist/prod-ux-followups" \
  pnpm --filter @rune-langium/studio run test:prod-ux --grep "J9|J20|J21" --reporter=list
```

This is the superset harness (spec: `docs/superpowers/specs/2026-07-16-prod-ux-checkout-harness.md`)
that exercises every perspective, dialog, and mutation loop the smoke check
above does not. It writes an evidence bundle — `run-manifest.json`
(per-journey verdicts, opLog streams, budget-aware timings), screenshots,
request timing/document counts, known issue ledger, traces, and axe results — to `apps/studio/test/prod-ux/report/`, meant to be
read by the `prod-ux-review` agent skill (`.agents/skills/prod-ux-review/`),
with every checkpoint image reviewed.

J19 adds seven expression workspace cases: private Builder drafts, Apply/Undo,
independent Data conditions, both split-file dispatch orders with trailing
comments and Source navigation, a pinned ten-operation CDM implementation,
hosted curated read-only projections, and the compact Builder at the largest
pane font size, with an additional 125% root text scale for the portal dialog.
The helper verifies computed text growth before accessibility and viewport scans.
Dispatch cases assert the retained signature and absence of completion/resize
exceptions. J8 correlates attribute, cardinality and rename saves before verifying
the renamed declaration after reload; it does not claim graph undo coverage.
Local acceptance and production share the editor setup helpers and
integrity-checked upstream fixtures. Each case has a distinct manifest ID;
dialog axe results are retained under `report/axe/J19/attempt<N>/`.

J16 holds an on-demand namespace response while closing the workspace, then
opens a blank replacement and checks that the late response cannot populate it.
Reload intentionally restores the most recent workspace; the journey verifies
that this is the blank replacement, without the cancelled curated namespace. J20 checks cold/warm JSON
and original source reuse through normal Explorer navigation after reload.
J21 exercises date, time, local timestamp, offset timestamp and enum values
through the preview validation/execution boundary. Date uses the native date
picker; the other temporal inputs currently use text controls.

J17 retains full axe JSON under `report/axe/J17/attempt<N>/`. Global setup copies
`test/prod-ux/known-issues.json` into each bundle; its entries include a reason,
review expiry and an issue URL where one exists. A known issue does not suppress
a failed assertion. Review expired entries and do not treat a coverage gap as
a passing feature.

Each journey's `network` records cover parse, lazy source and codegen responses.
They retain request-relative time to headers, total/transfer time, payload size,
operation ID and available Server-Timing, plus advertised receipts and returned
document counts for parse. These are browser measurements, not Worker CPU
time. Missing response details remain unknown rather than becoming zero
documents. `formRender` is the selection-to-preview interval and includes
namespace hydration; compare it with network and existing operation spans
before attributing a slow result to rendering. `ENABLE_TELEMETRY=1` opts in via
Settings before curated loading; no application environment flag is required.

**Nightly automation:** `.github/workflows/prod-ux-nightly.yml` runs this on
a schedule (04:41 UTC) and uploads `report/` as the `prod-ux-report` build
artifact — this job never fails the build; a red journey is evidence, not a
gate. A separate scheduled Claude Code routine picks up the latest artifact
and runs the `prod-ux-review` skill against it (see that skill's `SKILL.md`
for the review procedure); it files a GitHub issue when it finds a genuine
regression, as distinct from a corpus-drift or known-issue finding.

For focused triage, pass Playwright's `--grep` and `--reporter=list` options
to `test:prod-ux`. Use an absolute `PROD_UX_REPORT_DIR` for focused runs or archive the current
report first: each run resets its manifest, including a filtered run. Review screenshots and failure snapshots
alongside assertions before attributing a timeout to product behavior.

Pages Function diagnostic spans use the shared instrumentation wrapper and are
off by default. Each independently bundled Pages route configures its own edge
sink before running its instrumented handler. `INSTRUMENTATION_ENABLED=true` enables it;
`INSTRUMENTATION_LEVEL=trace` includes nested fetch spans (the default threshold
is `info`). For a focused curated-load investigation, set
`INSTRUMENTATION_OPS=onRequestPost,loadCuratedWorkspace,fetchCuratedManifest,fetchCuratedNamespace`
and `INSTRUMENTATION_TIMING_ONLY=true` in the Pages build environment before
`pnpm run build:cloudflare`. The combined build copies these non-secret values
into the generated root `wrangler.toml`, which supplies the Pages Function
bindings for direct Wrangler uploads. Rebuild before deploying when changing
them; dashboard-only changes may not reach the deployed Function. The
timing-only format keeps operation names, elapsed milliseconds, error signatures,
and timestamps without captured request or model payloads. These are Pages
runtime settings, separate from Studio's `VITE_ENABLE_TELEMETRY` build flag and
per-user telemetry opt-in. The same level, operation-list, and timing-only
settings are shared by the Studio browser and workers with a `VITE_` prefix;
production browser builds must also set `VITE_ENABLE_INSTRUMENTATION=true` at
build time, and browser records still require the Studio user opt-in. When
diagnostics are omitted from a production Vite build, untagged calls retain
their original function with no instrumentation wrapper. At runtime, a disabled
or excluded call bypasses timing and capture.
The default Pages build returns original untagged functions and route handlers;
turning Pages diagnostics on or off therefore requires a rebuild and redeploy.
Remove temporary diagnostic settings and rebuild/redeploy after the run.
J04b records `curatedNamespaceHydration` from Counterparty selection through
populated Inspector attributes, even when an assertion fails; compare that
wall-clock duration with the Pages Function spans for the same run.

Hover an Activity or Output entry in Studio to inspect its local message,
operation, duration, signature, and correlation ID when present. Cloudflare
telemetry span logs carry the operation, level, duration, signature, Studio
version, browser class, and correlation ID; only validated curated model IDs
may appear as subjects. Raw messages and workspace paths remain local to Studio.
Output's **Export debug info** action downloads those local logs, current
diagnostics, exact curated bundle versions, workspace file summaries, and
whitelisted environment/settings fields. Source contents are excluded unless
explicitly selected, and unloaded curated files are not fetched. Nothing is
uploaded by this action; review the report before sharing because logs and
file names can contain private information.
Telemetry retries only explicit 429 rejections, at most three attempts, honoring
Retry-After. The bounded queue is memory-only and is discarded on opt-out or
teardown. Fetch and response-body reads have a ten-second deadline.
Visibility/page-hide flushes use keepalive; ambiguous network failures
are not replayed. This is best-effort delivery, not durable delivery.

Production evidence retains raw Output/Activity lines and stamps their navigation
generation. Timing rollups count each operation/correlation ID once per journey
and generation; mirrors remain available as raw evidence. Capture the log before
reload or workspace teardown, then mark the completed navigation, so cleared
errors and reused IDs remain attributable.

Inspector hydration checks share `test/prod-ux/readiness.ts` and require a
populated **Attributes (N)** group. Accessibility sweeps use the same module
to wait for finite entrance animations before scanning and taking checkpoints; perpetual spinners
remain active and serious/critical contrast violations still fail. Form
validation checks use generated Zod semantics: a fractional `int` is invalid,
while an empty `string` is valid unless the model adds a length constraint.

Closure walks require `deferred: false` from the type-graph bridge before inspecting
members. `EvidenceCollector.measure` and `recordTiming` record journey wall-clock
measurements in the existing timing rollup. Measure through visible completion;
model registration alone does not measure hydration. Cancellation journeys that
cannot reach a cancel operation report BLOCKED rather than PASS.

Curated download verification should cover both a valid namespace ZIP and the
whole selection's diagnostics. `cdm.base.datetime` provides a compact download
check. Keep generation errors visible: an HTTP 400 with model diagnostics is
different from an edge 503 or a worker timeout. Publication changes also require
an authenticated `curated-artifacts.yml` run; local mocked uploads only verify
script behavior. The publisher reads the build's Langium version from
`artifact-meta.json`, retains full Wrangler errors, and fails if manifest fetching
fails.

Artifact builds select production model directories through
`@rune-langium/curated-schema`, link all three bundles together, and reject parser
or lexer errors before publication. Namespace URLs include the artifact hash so
same-day rebuilds do not reuse immutable cached URLs. The manifest's
`dependencies` field lets download workers discover required companion bundles.
An R2 authentication failure requires repairing the workflow credentials; a
successful local build does not mean the published manifests changed.

### Operational note

If we want a published status page later, the clean next step is to have
`verify:prod` / `verify:prod:ui` emit machine-readable summaries (JSON or
Markdown) and publish those from CI. For now, `docs/TESTING.md` is the primary
operator entrypoint and the spec markdown remains historical/spec context.

## Unit & Integration Testing

### Running Tests

```bash
# Run all tests once
pnpm run test

# Watch mode (re-run on file changes)
pnpm run test:watch

# Run with coverage
pnpm run test:coverage

# Run specific test file
pnpm run test src/core.test.ts

# Run tests matching pattern
pnpm run test -- --grep "string utility"

# Interactive UI
pnpm run test:ui
```

### Writing Tests

Create a test file next to your source:

```typescript
// src/string-utils.ts
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// src/string-utils.test.ts
import { describe, it, expect } from 'vitest';
import { capitalize } from './string-utils';

describe('String Utils', () => {
  describe('capitalize', () => {
    it('should capitalize first letter', () => {
      expect(capitalize('hello')).toBe('Hello');
    });

    it('should handle empty strings', () => {
      expect(capitalize('')).toBe('');
    });
  });
});
```

### Coverage Thresholds

Current configuration requires:
- **80%** line coverage
- **80%** function coverage
- **75%** branch coverage
- **80%** statement coverage

Configure in [vitest.config.ts](../vitest.config.ts).

### Using Test Utilities

If you create a shared test utilities package, import helpers from it:

```typescript
import { describe, it, expect } from 'vitest';
import { createMockUser, createMockApiResponse, createMockFn, spyOn } from '@rune-langium/test-utils';

describe('User API', () => {
  it('should fetch user', async () => {
    const mockUser = createMockUser({ name: 'John' });
    const mockFn = createMockFn();

    mockFn.mockResolvedValue(mockUser);

    const result = await mockFn();
    expect(result.name).toBe('John');
  });

  it('should spy on console', () => {
    const consoleSpy = spyOn(console, 'log');

    console.log('test');

    expect(consoleSpy).toHaveBeenCalledWith('test');
  });
});
```

### Cross-Package Testing

Test integration between packages in `integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isValidEmail, createSuccessResponse } from '@rune-langium/core';
import { capitalize } from '@rune-langium/utils';

describe('Cross-Package Integration', () => {
  it('should combine utilities', () => {
    const response = createSuccessResponse({
      email: 'john@example.com',
      isValid: isValidEmail('john@example.com'),
      displayName: capitalize('john'),
    });

    expect(response.success).toBe(true);
    expect(response.data?.isValid).toBe(true);
  });
});
```

## Performance Benchmarking

### Running Benchmarks

```bash
# Run all benchmarks
pnpm run test vitest.benchmark.config.ts

# Run specific benchmark
pnpm run test -- bench "Array Operations"
```

### Writing Benchmarks

Create benchmark files (usually separate from unit tests):

```typescript
// vitest.benchmark.config.ts
import { bench, describe } from 'vitest';
import { unique, flatten } from '@rune-langium/utils';

describe('Benchmarks', () => {
  const largeArray = Array.from({ length: 10000 }, (_, i) => i % 100);

  bench('unique - large array', () => {
    unique(largeArray);
  });

  bench('flatten - deep array', () => {
    flatten(Array(100).fill([1, [2, [3]]]), 2);
  });
});
```

## End-to-End Testing

### Running E2E Tests

```bash
# Run all E2E tests
pnpm exec playwright test

# Run in headed mode (see browser)
pnpm exec playwright test --headed

# Run specific file
pnpm exec playwright test e2e/example.spec.ts

# Run in debug mode
pnpm exec playwright test --debug

# View test report
pnpm exec playwright show-report
```

### Writing E2E Tests

Create test files in `e2e/` directory:

```typescript
// e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should login successfully', async ({ page }) => {
    // Fill login form
    await page.fill('input[name="email"]', 'user@example.com');
    await page.fill('input[name="password"]', 'password123');

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for redirect and verify
    await page.waitForURL('/dashboard');
    expect(page.url()).toContain('/dashboard');
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.fill('input[name="email"]', 'user@example.com');
    await page.fill('input[name="password"]', 'wrong');
    await page.click('button[type="submit"]');

    const errorMessage = page.locator('[role="alert"]');
    await expect(errorMessage).toContainText('Invalid credentials');
  });
});
```

### Multi-Browser Testing

Tests run against Chromium, Firefox, and WebKit by default. Configure in [playwright.config.ts](../playwright.config.ts).

### Visual Regression Testing

```typescript
test('should render correctly', async ({ page }) => {
  await page.goto('/');

  // Take screenshot
  await expect(page).toHaveScreenshot();
});
```

Run with `--update-snapshots` to create baseline screenshots.

## Testing Best Practices

### 1. Test Naming

```typescript
✅ Good: Describes what should happen
it('should return capitalized string when input is lowercase', () => {})

❌ Bad: Vague or implementation-focused
it('test capitalize function', () => {})
```

### 2. Arrange-Act-Assert Pattern

```typescript
it('should process user data', () => {
  // Arrange: Set up test data
  const user = createMockUser({ name: 'John' });

  // Act: Call the function
  const result = processUser(user);

  // Assert: Verify the result
  expect(result.displayName).toBe('John');
});
```

### 3. Avoid Test Interdependence

```typescript
❌ Bad: Tests depend on execution order
let user;
test('create user', () => {
  user = createUser({ name: 'John' });
});
test('update user', () => {
  updateUser(user);
});

✅ Good: Each test is independent
test('can create user', () => {
  const user = createUser({ name: 'John' });
  expect(user.name).toBe('John');
});
test('can update user', () => {
  const user = createMockUser();
  const updated = updateUser(user);
  expect(updated.name).toBe('John');
});
```

### 4. Use Fixtures for Common Setup

```typescript
// test-utils/fixtures.ts
export function createMockUser(overrides?: Partial<User>): User {
  return {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    ...overrides,
  };
}

// In tests
const user = createMockUser({ name: 'John' });
```

### 5. Test Behavior, Not Implementation

```typescript
✅ Good: Testing what the function does
it('should return unique items', () => {
  expect(unique([1, 1, 2, 3])).toEqual([1, 2, 3]);
});

❌ Bad: Testing how it's implemented
it('should create a Set internally', () => {
  // Don't test internal implementation
});
```

## Coverage Reports

Generate and view coverage reports:

```bash
# Generate coverage
pnpm run test:coverage

# View HTML report
open coverage/index.html
```

Coverage is automatically tracked and must meet thresholds before passing CI.

## CI/CD Integration

Tests run automatically on:
- **Pre-commit**: Type checking and linting
- **Push**: All tests, coverage, and build validation
- **Pull Request**: Same checks plus coverage reports

See [.github/workflows/ci.yml](../.github/workflows/ci.yml) for details.

## Troubleshooting

### "Module not found" in tests

```bash
# Rebuild packages
pnpm run build

# Clear Vitest cache
rm -rf node_modules/.vitest
```

### Tests timeout

```typescript
// Increase timeout for slow tests
it('slow test', async () => {
  // ...
}, { timeout: 10000 });
```

### Coverage not showing accurate results

```bash
# Clear coverage cache and regenerate
rm -rf coverage
pnpm run test:coverage
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Library Best Practices](https://testing-library.com/)
