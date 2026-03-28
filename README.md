# 100x Extension Test Automation

Next.js web UI + workflow test lab for browser-driven extension workflows.

## What is included

- Next.js app router web UI with shadcn-style components.
- Workflow catalog sourced from `Website based workflow structures - Website L0-L1 steps.csv`.
- Persistent workflow schema and dataset storage in `artifacts/workflow-lab/state.json`.
- API routes to discover workflow input/output schemas through the extension agent.
- API routes to generate live workflow datasets and replay them as tests.
- API routes to list scenario files and run scenarios.
- Live log polling and status reporting (running/passed/failed).
- Existing CLI scripts for direct terminal execution.

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

Open `http://localhost:3000`, choose a scenario, and click **Run Scenario**.

The main web UI now focuses on workflow testing:

- browse workflows from the CSV catalog
- add workflows that are not in the CSV yet
- start a manual authentication capture, log in in the opened Chrome window, and save replay tokens for future runs
- discover workflow input/output schema through the extension agent
- generate at least 3 datasets per workflow when the extension can execute them
- rerun saved datasets and compare live RAW JSON output with the saved expected output

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
bun run run:scenario
```

Custom scenario/session examples:

```bash
bun run run:scenario scenarios/smoke-extension-toggle.json --session my-test-session
```

If a scenario contains `chrome-extension://...` URLs, the runner auto-switches to CDP mode and launches Chromium with the unpacked extension preloaded. You can override the port with `RUNNER_CDP_PORT`.

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
