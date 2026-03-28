import { randomUUID } from "node:crypto"
import { runScenario } from "@/src/lib/runner"

export type RunJobStatus = "running" | "passed" | "failed"

export interface RunJob {
  id: string
  status: RunJobStatus
  scenarioPath: string
  session?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  logs: string[]
  error?: string
}

const MAX_STORED_JOBS = 30
const MAX_LOG_LINES = 400
const jobs = new Map<string, RunJob>()

function trimStore() {
  if (jobs.size <= MAX_STORED_JOBS) return

  const oldest = [...jobs.values()]
    .sort((a, b) => {
      const left = new Date(a.startedAt).getTime()
      const right = new Date(b.startedAt).getTime()
      return left - right
    })
    .slice(0, jobs.size - MAX_STORED_JOBS)

  for (const job of oldest) {
    jobs.delete(job.id)
  }
}

export function createRunJob(input: { scenarioPath: string; session?: string; extensionPath?: string }): RunJob {
  const now = new Date().toISOString()
  const id = randomUUID()
  const job: RunJob = {
    id,
    status: "running",
    scenarioPath: input.scenarioPath,
    session: input.session,
    startedAt: now,
    logs: [],
  }

  jobs.set(id, job)

  void (async () => {
    try {
      const result = await runScenario(input.scenarioPath, {
        session: input.session,
        extensionPath: input.extensionPath,
        onLog: (line) => {
          const current = jobs.get(id)
          if (!current) return
          current.logs = [...current.logs, line].slice(-MAX_LOG_LINES)
        },
      })

      const current = jobs.get(id)
      if (!current) return

      current.status = result.ok ? "passed" : "failed"
      current.startedAt = result.startedAt
      current.finishedAt = result.finishedAt
      current.durationMs = result.durationMs
      current.logs = result.logs.slice(-MAX_LOG_LINES)
      current.error = result.error
    } catch (issue) {
      const current = jobs.get(id)
      if (!current) return

      const message = issue instanceof Error ? issue.message : String(issue)
      current.status = "failed"
      current.finishedAt = new Date().toISOString()
      current.durationMs = Math.max(0, Date.now() - new Date(current.startedAt).getTime())
      current.error = message
      current.logs = [...current.logs, `Scenario failed: ${message}`].slice(-MAX_LOG_LINES)
    } finally {
      trimStore()
    }
  })()

  return job
}

export function getRunJob(id: string): RunJob | undefined {
  return jobs.get(id)
}
