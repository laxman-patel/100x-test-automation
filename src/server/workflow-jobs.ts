import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

export type WorkflowJobKind = "discover-schema" | "generate-datasets" | "generate-datasets-live" | "run-tests"
export type WorkflowJobStatus = "running" | "passed" | "failed"

export interface WorkflowJob {
  id: string
  workflowId: string
  kind: WorkflowJobKind
  status: WorkflowJobStatus
  startedAt: string
  finishedAt?: string
  durationMs?: number
  logs: string[]
  error?: string
  result?: unknown
}

const MAX_STORED_JOBS = 40
const MAX_LOG_LINES = 500
const JOBS_FILE = resolve(process.cwd(), "artifacts/workflow-jobs.json")

// Use globalThis to survive Next.js HMR — module-level `const` gets wiped on hot reload
const globalKey = "__workflow_jobs_map__" as const
const globalTimerKey = "__workflow_jobs_persist_timer__" as const

function getJobsMap(): Map<string, WorkflowJob> {
  const g = globalThis as Record<string, unknown>
  if (!g[globalKey]) {
    g[globalKey] = new Map<string, WorkflowJob>()
  }
  return g[globalKey] as Map<string, WorkflowJob>
}

function loadJobsFromDisk(): void {
  const jobs = getJobsMap()
  if (jobs.size > 0) return
  try {
    if (existsSync(JOBS_FILE)) {
      const raw = readFileSync(JOBS_FILE, "utf8")
      const entries = JSON.parse(raw) as WorkflowJob[]
      const now = Date.now()
      for (const job of entries) {
        // Only mark stale running jobs as failed (started > 5 min ago)
        if (job.status === "running") {
          const age = now - new Date(job.startedAt).getTime()
          if (age > 5 * 60 * 1000) {
            job.status = "failed"
            job.error = "Process restarted while job was running"
            job.finishedAt = new Date().toISOString()
          }
        }
        jobs.set(job.id, job)
      }
    }
  } catch {
    // ignore corrupt file
  }
}

function persistJobsToDisk(): void {
  try {
    const dir = resolve(process.cwd(), "artifacts")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const jobs = getJobsMap()
    writeFileSync(JOBS_FILE, JSON.stringify([...jobs.values()], null, 2), "utf8")
  } catch {
    // ignore write failures
  }
}

// Hydrate on module load
loadJobsFromDisk()

function persistJobsToDiskThrottled(): void {
  const g = globalThis as Record<string, unknown>
  if (g[globalTimerKey]) return
  g[globalTimerKey] = setTimeout(() => {
    g[globalTimerKey] = null
    persistJobsToDisk()
  }, 2000)
}

function trimJobs() {
  const jobs = getJobsMap()
  if (jobs.size <= MAX_STORED_JOBS) return

  const oldest = [...jobs.values()]
    .filter((j) => j.status !== "running")
    .sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime())
    .slice(0, jobs.size - MAX_STORED_JOBS)

  for (const job of oldest) {
    jobs.delete(job.id)
  }
}

export function createWorkflowJob(input: {
  workflowId: string
  kind: WorkflowJobKind
  run: (log: (line: string) => void) => Promise<unknown>
}): WorkflowJob {
  const jobs = getJobsMap()
  const now = new Date().toISOString()
  const id = randomUUID()
  const job: WorkflowJob = {
    id,
    workflowId: input.workflowId,
    kind: input.kind,
    status: "running",
    startedAt: now,
    logs: [],
  }

  jobs.set(id, job)
  persistJobsToDisk()

  void (async () => {
    try {
      const result = await input.run((line) => {
        const current = jobs.get(id)
        if (!current) return
        current.logs = [...current.logs, line].slice(-MAX_LOG_LINES)
        persistJobsToDiskThrottled()
      })

      const current = jobs.get(id)
      if (!current) return

      current.status = "passed"
      current.finishedAt = new Date().toISOString()
      current.durationMs = Math.max(0, Date.now() - new Date(current.startedAt).getTime())
      current.result = result
    } catch (error) {
      const current = jobs.get(id)
      if (!current) return

      current.status = "failed"
      current.finishedAt = new Date().toISOString()
      current.durationMs = Math.max(0, Date.now() - new Date(current.startedAt).getTime())
      current.error = error instanceof Error ? error.message : String(error)
      current.logs = [...current.logs, `Job failed: ${current.error}`].slice(-MAX_LOG_LINES)
    } finally {
      trimJobs()
      persistJobsToDisk()
    }
  })()

  return job
}

export function getWorkflowJob(id: string): WorkflowJob | undefined {
  const jobs = getJobsMap()
  return jobs.get(id)
}
