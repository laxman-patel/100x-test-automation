import { runScenario, preflight } from "./lib/runner"

const HELP = `
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

Examples:
  bun run test
  bun run test scenarios/smoke-extension-toggle.json
  bun run test scenarios/my-flow.json --headless --retry 2
  bun run test --session my-session --timeout 120000
`.trim()

interface CliArgs {
  scenario: string
  session?: string
  headed: boolean
  stepRetries: number
  timeout?: number
  skipPreflight: boolean
  help: boolean
}

function parseArgs(args: string[]): CliArgs {
  const parsed: CliArgs = {
    scenario: "scenarios/smoke-extension-toggle.json",
    headed: true,
    stepRetries: 0,
    skipPreflight: false,
    help: false,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    switch (arg) {
      case "-h":
      case "--help":
        parsed.help = true
        break
      case "--session":
        parsed.session = args[++i]
        break
      case "--headless":
        parsed.headed = false
        break
      case "--retry":
        parsed.stepRetries = Math.max(0, Number(args[++i]) || 0)
        break
      case "--timeout":
        parsed.timeout = Math.max(1000, Number(args[++i]) || 90_000)
        break
      case "--skip-preflight":
        parsed.skipPreflight = true
        break
      default:
        if (!arg.startsWith("--")) {
          parsed.scenario = arg
        }
    }
  }

  return parsed
}

// ── Pretty output helpers ──────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ── Main ───────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(HELP)
  process.exit(0)
}

console.log(
  `${C.cyan}${C.bold}▶ Scenario:${C.reset} ${args.scenario}` +
    `${C.dim}  (headed=${args.headed}, retries=${args.stepRetries})${C.reset}`,
)

// Pre-flight
if (!args.skipPreflight) {
  try {
    await preflight((line) => console.log(`${C.dim}  ${line}${C.reset}`))
  } catch (err) {
    console.error(`\n${C.red}${C.bold}✘ Pre-flight check failed${C.reset}`)
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

// Run
const result = await runScenario(args.scenario, {
  session: args.session,
  headed: args.headed,
  stepRetries: args.stepRetries,
  onLog: (line) => console.log(line),
})

// Summary
console.log("")
if (result.ok) {
  console.log(
    `${C.green}${C.bold}✔ PASSED${C.reset}  ${C.bold}${result.scenario.name}${C.reset}` +
      `  ${C.dim}(${result.scenario.steps.length} steps in ${formatDuration(result.durationMs)})${C.reset}`,
  )
} else {
  console.log(
    `${C.red}${C.bold}✘ FAILED${C.reset}  ${C.bold}${result.scenario.name}${C.reset}` +
      `  ${C.dim}(${formatDuration(result.durationMs)})${C.reset}`,
  )
  console.log(`${C.red}  Error: ${result.error}${C.reset}`)
}

if (!result.ok) {
  process.exitCode = 1
}
