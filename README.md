# 100x Extension Test Automation

Next.js web UI + workflow test lab for browser-driven extension workflows.

## What is included

- Next.js app router web UI with shadcn-style components.
- Workflow catalog sourced from `Website based workflow structures - Website L0-L1 steps.csv`.
- Persistent workflow schema and dataset storage in `artifacts/workflow-lab/state.json`.
- API routes to discover workflow input/output schemas through the extension agent.
- API routes to generate datasets via extension execution or live website extraction.
- API routes to list scenario files and run scenarios.
- Per-workflow **Clear** button to reset schema, datasets, and run history.
- Live log polling and status reporting (running/passed/failed).
- CLI test runner with pre-flight checks, step-level retry, and graceful shutdown.

## Prerequisites

- Bun installed (`bun --version`)
- `agent-browser` installed and available in `PATH`
- Chromium binaries available for `agent-browser`

If browser binaries are missing:

```bash
agent-browser install
```

## Install dependencies

```bash
bun install
```

## Run the web UI

```bash
bun run dev
```

Open `http://localhost:3000`, choose a workflow, and use the action buttons:

- **Discover schema** — extract input/output parameters via the extension agent
- **Generate datasets** — create test datasets via extension execution
- **Generate (live)** — navigate to real websites and extract structured data with Claude
- **Run tests** — replay saved datasets and compare live output with expected output
- **Clear** — reset all schema, datasets, and run history for a workflow

Workflow state is saved to:

```bash
artifacts/workflow-lab/state.json
```

## Build for production

```bash
bun run build
bun run start
```

## Run a scenario from CLI

```bash
bun run test
```

Full usage:

```
Usage: bun run test [scenario-file] [options]

Arguments:
  scenario-file          Path to a scenario JSON file
                         (default: scenarios/smoke-extension-toggle.json)

Options:
  --session <name>       Custom session name for this run
  --headless             Run browser in headless mode (default: headed)
  --retry <n>            Retry each step up to <n> times on transient errors (default: 0)
  --timeout <ms>         Override the default agent-browser timeout (default: 90000)
  --skip-preflight       Skip the pre-flight dependency check
  -h, --help             Show this help message
```

Examples:

```bash
bun run test scenarios/smoke-extension-toggle.json
bun run test scenarios/my-flow.json --headless --retry 2
bun run test --session my-session --timeout 120000
```

The legacy `bun run run:scenario` alias still works.

If a scenario contains `chrome-extension://...` URLs, the runner auto-switches to CDP mode and launches Chromium with the unpacked extension preloaded. Override the port with `RUNNER_CDP_PORT`.

## Open extension page and type into prompt

```bash
bun run run:extension-prompt
bun run run:extension-prompt "Create an L0 workflow for form filling"
EXTENSION_ID=your_real_extension_id bun run run:extension-prompt "Create an L0 workflow for form filling"
CHROME_PATH=/path/to/chrome CDP_PORT=9222 EXTENSION_ID=your_real_extension_id bun run run:extension-prompt "Create an L0 workflow for form filling"
AUTH_TOKEN=your_jwt AUTH_EMAIL=you@example.com bun run run:extension-prompt "Create an L0 workflow for form filling"
KEEP_OPEN=1 bun run run:extension-prompt "Create an L0 workflow for form filling"
KEEP_OPEN=1 AUTO_SEND=1 bun run run:extension-prompt "Create an L0 workflow for form filling"
CAPTURE_CONSOLE=1 CONSOLE_OUT=artifacts/extension-console.json bun run run:extension-prompt "Create an L0 workflow for form filling"
```

## Capture login state (manual once, replay later)

```bash
bun run capture:auth-state
```

Generated files:

- `artifacts/auth-state-before.json`
- `artifacts/auth-state-after.json`
- `artifacts/extension-auth-state.json`
- `artifacts/extension-auth-state.diff.json`
- `artifacts/extension-auth-candidates.json`

## Scenario format

Each scenario has `name`, optional `settings`, and `steps`.

Supported step actions:

- `open`
- `openNewTab`
- `snapshot`
- `assertSnapshotContains`
- `consoleLogs`
- `clickRef`
- `fillRef`
- `typeRef`
- `wait`
- `screenshot`
- `eval`
- `close`
