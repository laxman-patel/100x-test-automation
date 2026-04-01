import { runCommand, type CommandResult } from "./shell"

const TRANSIENT_PATTERNS = [
  "temporarily unavailable",
  "os error 11",
  "EAGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "connection reset",
]

function isTransientError(text: string): boolean {
  const lower = text.toLowerCase()
  return TRANSIENT_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
}

export async function retryOnTransient(
  fn: () => Promise<CommandResult>,
  maxAttempts = 3,
  delayMs = 500,
  log?: (line: string) => void,
): Promise<CommandResult> {
  let last: CommandResult | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await fn()
    if (last.exitCode === 0) return last
    const output = `${last.stderr}\n${last.stdout}`
    if (!isTransientError(output) || attempt === maxAttempts) return last
    const backoff = delayMs * attempt
    log?.(`transient error on attempt ${attempt}/${maxAttempts}, retrying in ${backoff}ms`)
    await new Promise((r) => setTimeout(r, backoff))
  }
  return last!
}

export interface AgentBrowserClientOptions {
  session?: string
  extensionPath?: string
  cdpPort?: number
  headed?: boolean
  timeoutMs?: number
}

export class AgentBrowserClient {
  private readonly session?: string
  private readonly extensionPath?: string
  private readonly cdpPort?: number
  private readonly headed: boolean
  private readonly timeoutMs: number

  constructor(opts: AgentBrowserClientOptions) {
    this.session = opts.session
    this.extensionPath = opts.extensionPath
    this.cdpPort = opts.cdpPort
    this.headed = opts.headed ?? false
    this.timeoutMs = opts.timeoutMs ?? 90_000

    if (!this.cdpPort && (!this.session || !this.extensionPath)) {
      throw new Error("AgentBrowserClient requires either cdpPort or session+extensionPath")
    }
  }

  async raw(args: string[]): Promise<CommandResult> {
    const base = ["agent-browser"]

    if (this.cdpPort) {
      base.push("--cdp", String(this.cdpPort))
    } else {
      base.push("--session", this.session!, "--extension", this.extensionPath!)
      if (this.headed) {
        base.push("--headed")
      }
    }

    return runCommand([...base, ...args], this.timeoutMs)
  }

  async open(url: string): Promise<CommandResult> {
    return this.raw(["open", url])
  }

  async openNewTab(url: string): Promise<CommandResult> {
    return this.raw(["tab", "new", url])
  }

  async snapshot(interactive = true): Promise<CommandResult> {
    const args = ["snapshot"]
    if (interactive) args.push("-i")
    args.push("--json")
    return this.raw(args)
  }

  async click(ref: string): Promise<CommandResult> {
    return this.raw(["click", ref])
  }

  async fill(ref: string, value: string): Promise<CommandResult> {
    return this.raw(["fill", ref, value])
  }

  async type(ref: string, value: string): Promise<CommandResult> {
    return this.raw(["type", ref, value])
  }

  async wait(waitFor: string | number): Promise<CommandResult> {
    return this.raw(["wait", String(waitFor)])
  }

  async screenshot(path: string): Promise<CommandResult> {
    return this.raw(["screenshot", path])
  }

  async eval(code: string): Promise<CommandResult> {
    return this.raw(["eval", code])
  }

  async console(clear = false): Promise<CommandResult> {
    const args = ["console", "--json"]
    if (clear) args.push("--clear")
    return this.raw(args)
  }

  async errors(clear = false): Promise<CommandResult> {
    const args = ["errors", "--json"]
    if (clear) args.push("--clear")
    return this.raw(args)
  }

  async close(): Promise<CommandResult> {
    return this.raw(["close"])
  }
}
