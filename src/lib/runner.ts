import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { AgentBrowserClient, retryOnTransient } from "./agentBrowser"
import { runCommand } from "./shell"
import { loadScenario, resolveScenarioPath, type Scenario } from "./scenario"

export interface RunScenarioOptions {
  extensionPath?: string
  session?: string
  onLog?: (line: string) => void
}

export interface ScenarioRunResult {
  ok: boolean
  scenario: Scenario
  scenarioPath: string
  startedAt: string
  finishedAt: string
  durationMs: number
  logs: string[]
  error?: string
}

interface SnapshotPayload {
  success?: boolean
  data?: {
    snapshot?: string
    refs?: Record<string, { name?: string; role?: string }>
  }
  error?: string | null
}

interface ConsolePayload {
  success?: boolean
  data?: {
    messages?: Array<{ type?: string; text?: string; timestamp?: number }>
    errors?: Array<{ message?: string; stack?: string; timestamp?: number }>
  }
  error?: string | null
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start >= 0 && end > start) {
      const slice = trimmed.slice(start, end + 1)
      return JSON.parse(slice)
    }
    throw new Error(`Could not parse JSON from output: ${trimmed.slice(0, 200)}`)
  }
}

function formatCommandForLog(args: string[]): string {
  return `agent-browser ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
}

function isDaemonConflictError(text: string): boolean {
  const value = text.toLowerCase()
  return value.includes("--extension ignored") || value.includes("daemon already running")
}

async function hardResetAgentBrowser(log?: (line: string) => void): Promise<void> {
  try {
    await runCommand(["pkill", "-f", "agent-browser/dist/daemon.js"], 10_000)
    log?.("pkill -f agent-browser/dist/daemon.js completed")
  } catch {
    log?.("no running agent-browser daemon process found")
  }

  try {
    await runCommand(["pkill", "-f", "chrome-headless-shell-linux64/chrome-headless-shell"], 10_000)
    log?.("pkill stale headless shell processes completed")
  } catch {
    log?.("no stale headless shell processes found")
  }
}

function resolveChromePath(): string {
  const fromEnv = process.env.CHROME_PATH?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv

  const home = process.env.HOME ?? ""
  const playwrightCache = resolve(home, ".cache/ms-playwright")
  if (existsSync(playwrightCache)) {
    const chromiumDirs = readdirSync(playwrightCache)
      .filter((name) => name.startsWith("chromium-"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

    for (const dir of chromiumDirs) {
      const chromePathA = resolve(playwrightCache, dir, "chrome-linux64/chrome")
      const chromePathB = resolve(playwrightCache, dir, "chrome-linux/chrome")
      if (existsSync(chromePathA)) return chromePathA
      if (existsSync(chromePathB)) return chromePathB
    }
  }

  const candidates = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error("Could not find Chromium binary. Set CHROME_PATH and retry.")
}

async function launchChromiumWithExtension(opts: {
  chromePath: string
  extensionPath: string
  cdpPort: number
  profilePath: string
  logPath: string
}): Promise<number> {
  mkdirSync(opts.profilePath, { recursive: true })

  const pythonScript = `
import subprocess
chrome = ${JSON.stringify(opts.chromePath)}
profile = ${JSON.stringify(opts.profilePath)}
ext = ${JSON.stringify(opts.extensionPath)}
log = ${JSON.stringify(opts.logPath)}
port = ${JSON.stringify(String(opts.cdpPort))}
cmd = [
  chrome,
  f'--user-data-dir={profile}',
  f'--remote-debugging-port={port}',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
  f'--disable-extensions-except={ext}',
  f'--load-extension={ext}',
  'about:blank'
]
with open(log, 'ab') as f:
  p = subprocess.Popen(cmd, stdout=f, stderr=f, start_new_session=True)
print(p.pid)
`

  const res = await runCommand(["python", "-c", pythonScript], 20_000)
  if (res.exitCode !== 0) {
    throw new Error(res.stderr.trim() || res.stdout.trim() || "Failed to launch Chromium")
  }

  const pid = Number((res.stdout || "").trim().split(/\s+/).pop())
  if (!Number.isFinite(pid)) {
    throw new Error(`Could not parse Chromium PID from launcher output: ${res.stdout.trim()}`)
  }

  return pid
}

async function waitForCdpReady(port: number, timeoutMs = 30_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const probe = await runCommand(["agent-browser", "--cdp", String(port), "get", "url"], 3_000)
    if (probe.exitCode === 0) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 300))
  }

  throw new Error(`Timed out waiting for CDP on port ${port}`)
}

function scenarioNeedsExtensionPage(scenario: Scenario): boolean {
  if ((scenario.settings?.url ?? "").startsWith("chrome-extension://")) {
    return true
  }

  return scenario.steps.some((step) => (step.url ?? "").startsWith("chrome-extension://"))
}

export async function runScenario(
  scenarioInputPath: string,
  opts: RunScenarioOptions = {},
): Promise<ScenarioRunResult> {
  const logs: string[] = []

  const log = (line: string) => {
    logs.push(line)
    opts.onLog?.(line)
  }

  const started = Date.now()
  const startedAt = new Date(started).toISOString()
  const scenarioPath = resolveScenarioPath(scenarioInputPath)
  const scenario = await loadScenario(scenarioPath)

  const extensionPath = resolve(process.cwd(), opts.extensionPath ?? "100x-extension-build")
  const session = opts.session ?? `workflow-test-${Date.now()}`
  const headed = true
  const needsExtensionTab = scenarioNeedsExtensionPage(scenario)
  const cdpPort = Number(process.env.RUNNER_CDP_PORT ?? 9223)

  let externalChromePid: number | null = null

  let client: AgentBrowserClient

  if (needsExtensionTab) {
    const chromePath = resolveChromePath()
    const profilePath = resolve(process.cwd(), `artifacts/runner-profile-${Date.now()}`)
    const logPath = resolve(process.cwd(), "artifacts/runner-chrome.log")

    try {
      await runCommand(["pkill", "-f", `remote-debugging-port=${cdpPort}`], 10_000)
      log(`cleared old CDP browser on port ${cdpPort}`)
      await new Promise((r) => setTimeout(r, 500))
    } catch {
      log(`no existing CDP browser to clear on port ${cdpPort}`)
    }

    externalChromePid = await launchChromiumWithExtension({
      chromePath,
      extensionPath,
      cdpPort,
      profilePath,
      logPath,
    })
    await waitForCdpReady(cdpPort)

    client = new AgentBrowserClient({
      cdpPort,
      timeoutMs: 90_000,
    })

    log(`Using CDP mode for extension tabs on port ${cdpPort}`)
    log(`Launched Chromium: ${chromePath}`)
  } else {
    await hardResetAgentBrowser(log)

    client = new AgentBrowserClient({
      session,
      extensionPath,
      headed,
    })
  }

  let lastSnapshot = ""

  log(`Starting scenario: ${scenario.name}`)
  log(`Scenario file: ${scenarioPath}`)
  log(`Extension path: ${extensionPath}`)
  if (needsExtensionTab) {
    log(`Session mode: CDP ${cdpPort} | Headed: yes (enforced)`)
  } else {
    log(`Session: ${session} | Headed: yes (enforced)`)
  }

  try {
    for (let i = 0; i < scenario.steps.length; i += 1) {
      const step = scenario.steps[i]
      const prefix = `[${i + 1}/${scenario.steps.length}] ${step.action}`

      switch (step.action) {
        case "open": {
          const url = step.url ?? scenario.settings?.url
          if (!url) throw new Error(`${prefix}: missing url in step/settings`)
          const isExtensionPage = url.startsWith("chrome-extension://")

          if (isExtensionPage) {
            log(`${prefix}: opening extension URL in a new tab`)
            log(`${prefix}: ${formatCommandForLog(["tab", "new", url])}`)
          } else {
            log(`${prefix}: ${formatCommandForLog(["open", url])}`)
          }

          let res = isExtensionPage ? await client.openNewTab(url) : await client.open(url)
          if (res.exitCode !== 0) {
            const rawError = `${res.stderr}\n${res.stdout}`
            if (isExtensionPage && isDaemonConflictError(rawError)) {
              log(`${prefix}: daemon conflict detected, forcing restart and retrying once`)
              await hardResetAgentBrowser(log)
              const seedOpen = await client.open("https://example.com")
              if (seedOpen.exitCode !== 0) {
                throw new Error(`${prefix} retry seed open failed: ${seedOpen.stderr || seedOpen.stdout}`)
              }
              res = await client.openNewTab(url)
            }
          }
          if (res.exitCode !== 0) throw new Error(`${prefix} failed: ${res.stderr || res.stdout}`)
          log(`${prefix}: opened ${url}`)
          break
        }

        case "openNewTab": {
          const url = step.url
          if (!url) throw new Error(`${prefix}: missing url`)
          log(`${prefix}: ${formatCommandForLog(["tab", "new", url])}`)
          let res = await client.openNewTab(url)
          if (res.exitCode !== 0) {
            const rawError = `${res.stderr}\n${res.stdout}`
            const isExtensionPage = url.startsWith("chrome-extension://")
            if (isExtensionPage && isDaemonConflictError(rawError)) {
              log(`${prefix}: daemon conflict detected, forcing restart and retrying once`)
              await hardResetAgentBrowser(log)
              const seedOpen = await client.open("https://example.com")
              if (seedOpen.exitCode !== 0) {
                throw new Error(`${prefix} retry seed open failed: ${seedOpen.stderr || seedOpen.stdout}`)
              }
              res = await client.openNewTab(url)
            }
          }
          if (res.exitCode !== 0) throw new Error(`${prefix} failed: ${res.stderr || res.stdout}`)
          log(`${prefix}: opened new tab ${url}`)
          break
        }

        case "snapshot": {
          log(`${prefix}: ${formatCommandForLog(["snapshot", "-i", "--json"])}`)
          const res = await client.snapshot(step.interactive ?? true)
          if (res.exitCode !== 0) throw new Error(`${prefix} failed: ${res.stderr || res.stdout}`)

          const payload = parseJsonFromText(res.stdout) as SnapshotPayload
          if (!payload?.success) {
            throw new Error(`${prefix} returned unsuccessful snapshot: ${payload?.error ?? "unknown error"}`)
          }

          const text = payload.data?.snapshot ?? ""
          lastSnapshot = text
          const lineCount = text.split("\n").filter(Boolean).length
          log(`${prefix}: captured snapshot (${lineCount} interactive lines)`)
          break
        }

        case "assertSnapshotContains": {
          const needle = step.text ?? ""
          if (!needle) throw new Error(`${prefix}: missing text`)
          if (!lastSnapshot.includes(needle)) {
            if (step.optional) {
              log(`${prefix}: optional assertion not met (${needle})`)
              break
            }
            throw new Error(`${prefix}: expected snapshot to contain: ${needle}`)
          }
          log(`${prefix}: assertion passed (${needle})`)
          break
        }

        case "consoleLogs": {
          log(`${prefix}: collecting console + page errors`)

          const consoleRes = await client.console(step.clear ?? false)
          if (consoleRes.exitCode !== 0) {
            throw new Error(`${prefix} console failed: ${consoleRes.stderr || consoleRes.stdout}`)
          }

          const errorsRes = await client.errors(false)
          if (errorsRes.exitCode !== 0) {
            throw new Error(`${prefix} errors failed: ${errorsRes.stderr || errorsRes.stdout}`)
          }

          const consolePayload = parseJsonFromText(consoleRes.stdout) as ConsolePayload
          const errorsPayload = parseJsonFromText(errorsRes.stdout) as ConsolePayload
          const messages = consolePayload?.data?.messages ?? []
          const pageErrors = errorsPayload?.data?.errors ?? []

          if (step.path) {
            const outPath = resolve(process.cwd(), step.path)
            await mkdir(dirname(outPath), { recursive: true })
            await writeFile(
              outPath,
              JSON.stringify(
                {
                  capturedAt: new Date().toISOString(),
                  messages,
                  pageErrors,
                },
                null,
                2,
              ),
              "utf8",
            )
            log(`${prefix}: saved console logs -> ${outPath} (${messages.length} messages, ${pageErrors.length} errors)`)
          } else {
            log(`${prefix}: ${messages.length} console messages, ${pageErrors.length} page errors`)
          }

          break
        }

        case "clickRef": {
          if (!step.ref) throw new Error(`${prefix}: missing ref`)
          log(`${prefix}: ${formatCommandForLog(["click", step.ref])}`)
          const res = await client.click(step.ref)
          if (res.exitCode !== 0) throw new Error(`${prefix} failed: ${res.stderr || res.stdout}`)
          log(`${prefix}: clicked ${step.ref}`)
          break
        }

        case "fillRef": {
          if (!step.ref || step.value == null) throw new Error(`${prefix}: missing ref/value`)
          log(`${prefix}: ${formatCommandForLog(["fill", step.ref, step.value])}`)
          const res = await client.fill(step.ref, step.value)
          if (res.exitCode !== 0) throw new Error(`${prefix} failed: ${res.stderr || res.stdout}`)
          log(`${prefix}: filled ${step.ref}`)
          break
        }

        case "typeRef": {
          if (!step.ref || step.value == null) throw new Error(`${prefix}: missing ref/value`)
          log(`${prefix}: ${formatCommandForLog(["type", step.ref, step.value])}`)
          const res = await client.type(step.ref, step.value)
          if (res.exitCode !== 0) throw new Error(`${prefix} failed: ${res.stderr || res.stdout}`)
          log(`${prefix}: typed into ${step.ref}`)
          break
        }

        case "wait": {
          const waitFor = step.waitFor ?? 500
          log(`${prefix}: ${formatCommandForLog(["wait", String(waitFor)])}`)
          const res = await client.wait(waitFor)
          if (res.exitCode !== 0) throw new Error(`${prefix} failed: ${res.stderr || res.stdout}`)
          log(`${prefix}: waited ${waitFor}`)
          break
        }

        case "screenshot": {
          const outPath = resolve(process.cwd(), step.path ?? `artifacts/${scenario.name}-${Date.now()}.png`)
          await mkdir(dirname(outPath), { recursive: true })
          log(`${prefix}: ${formatCommandForLog(["screenshot", outPath])}`)
          const res = await retryOnTransient(() => client.screenshot(outPath), 3, 500)
          if (res.exitCode !== 0) throw new Error(`${prefix} failed: ${res.stderr || res.stdout}`)
          log(`${prefix}: saved screenshot -> ${outPath}`)
          break
        }

        case "eval": {
          if (!step.code) throw new Error(`${prefix}: missing code`)
          log(`${prefix}: eval step`)
          const res = await client.eval(step.code)
          if (res.exitCode !== 0) throw new Error(`${prefix} failed: ${res.stderr || res.stdout}`)
          log(`${prefix}: eval completed`)
          if (res.stdout.trim()) {
            log(`${prefix}: result ${res.stdout.trim()}`)
          }
          break
        }

        case "close": {
          log(`${prefix}: ${formatCommandForLog(["close"])}`)
          const res = await client.close()
          if (res.exitCode !== 0) throw new Error(`${prefix} failed: ${res.stderr || res.stdout}`)
          log(`${prefix}: browser closed`)
          break
        }

        default:
          throw new Error(`${prefix}: unsupported action`)
      }
    }

    const finished = Date.now()
    const finishedAt = new Date(finished).toISOString()
    const durationMs = finished - started
    log(`Scenario passed in ${durationMs}ms`)

    if (externalChromePid) {
      try {
        await runCommand(["kill", "-TERM", String(externalChromePid)], 10_000)
      } catch {
        // ignore cleanup failures
      }
    }

    return {
      ok: true,
      scenario,
      scenarioPath,
      startedAt,
      finishedAt,
      durationMs,
      logs,
    }
  } catch (error) {
    const finished = Date.now()
    const finishedAt = new Date(finished).toISOString()
    const durationMs = finished - started
    const message = error instanceof Error ? error.message : String(error)
    log(`Scenario failed: ${message}`)

    try {
      await client.close()
    } catch {
      // ignore cleanup failures
    }

    if (externalChromePid) {
      try {
        await runCommand(["kill", "-TERM", String(externalChromePid)], 10_000)
      } catch {
        // ignore cleanup failures
      }
    }

    return {
      ok: false,
      scenario,
      scenarioPath,
      startedAt,
      finishedAt,
      durationMs,
      logs,
      error: message,
    }
  }
}
