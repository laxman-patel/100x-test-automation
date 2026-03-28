import { spawn } from "node:child_process"

export interface CommandResult {
  command: string[]
  stdout: string
  stderr: string
  exitCode: number
}

export async function runCommand(command: string[], timeoutMs = 60_000): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolveResult, rejectResult) => {
    const proc = spawn(command[0], command.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })

    let stdout = ""
    let stderr = ""
    let settled = false

    const finalize = (cb: () => void) => {
      if (settled) return
      settled = true
      cb()
    }

    const timeoutId = setTimeout(() => {
      try {
        proc.kill("SIGTERM")
      } catch {
        // ignore kill failures
      }

      finalize(() => {
        rejectResult(new Error(`Command timed out after ${timeoutMs}ms: ${command.join(" ")}`))
      })
    }, timeoutMs)

    proc.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })

    proc.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    proc.once("error", (error) => {
      clearTimeout(timeoutId)
      finalize(() => {
        rejectResult(error)
      })
    })

    proc.once("close", (code) => {
      clearTimeout(timeoutId)
      finalize(() => {
        resolveResult({
          command,
          stdout,
          stderr,
          exitCode: code ?? 1,
        })
      })
    })
  })
}
