"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Database, KeyRound, LoaderCircle, Play, Plus, RefreshCw, Search, Trash2, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

interface WorkflowParameter {
  name: string
  type?: string
  required?: boolean
  description?: string
}

interface WorkflowSchemaRecord {
  discoveredAt: string
  inputParameters: WorkflowParameter[]
  outputParameters: WorkflowParameter[]
  parsed: JsonValue
}

interface FieldDiffEntry {
  path: string
  expected?: JsonValue
  actual?: JsonValue
  status: "match" | "mismatch" | "missing" | "extra"
}

interface WorkflowDatasetRunRecord {
  ranAt: string
  success: boolean
  actualOutput?: JsonValue
  diff?: string | FieldDiffEntry[]
  error?: string
  screenshotPath?: string
  domSnapshot?: string
}

interface WorkflowDatasetRecord {
  id: string
  createdAt: string
  source: "generated" | "manual" | "live-extraction"
  input: JsonValue
  expectedOutput: JsonValue
  notes?: string
  lastRun?: WorkflowDatasetRunRecord
}

interface WorkflowRecord {
  id: string
  domain: string
  level: string
  workflowName: string
  workflowRef: string
  description: string
  status: string
  source: "csv" | "custom"
  exists: boolean
  schema?: WorkflowSchemaRecord
  datasets: WorkflowDatasetRecord[]
  updatedAt?: string
}

type WorkflowJobStatus = "running" | "passed" | "failed"

interface WorkflowJob {
  id: string
  workflowId: string
  kind: "discover-schema" | "generate-datasets" | "generate-datasets-live" | "run-tests"
  status: WorkflowJobStatus
  startedAt: string
  finishedAt?: string
  durationMs?: number
  logs: string[]
  error?: string
  result?: unknown
}

interface AuthCaptureState {
  status: "idle" | "awaiting-user" | "saving" | "completed" | "failed"
  startedAt?: string
  finishedAt?: string
  error?: string
  extensionUrl: string
  artifacts: {
    beforePath: string
    afterPath: string
    replayPath: string
    diffPath: string
    candidatesPath: string
  }
  savedAuthState?: {
    exists: boolean
    capturedAt?: string
    updatedAt?: string
    hasReplayableToken?: boolean
  }
}

interface SiteAuthStatus {
  domain: string
  status: "idle" | "awaiting-user" | "saving" | "completed" | "failed"
  startedAt?: string
  finishedAt?: string
  error?: string
  savedState?: {
    exists: boolean
    capturedAt?: string
    updatedAt?: string
    cookieCount?: number
    localStorageKeyCount?: number
  }
}

function badgeVariantForState(state: string) {
  if (state === "passed" || state === "completed") return "success"
  if (state === "failed") return "danger"
  if (state === "running") return "warning"
  if (state === "saving" || state === "awaiting-user") return "warning"
  return "secondary"
}

function formatJson(value: JsonValue | undefined): string {
  if (typeof value === "undefined") return "-"
  return JSON.stringify(value, null, 2)
}

function formatDate(value?: string): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

const EMPTY_WORKFLOW_FORM = {
  domain: "",
  level: "L0",
  workflowName: "",
  description: "",
  status: "Exists",
}

function SidebarSectionToggle(props: {
  title: string
  meta: string
  open: boolean
  onToggle: () => void
  icon: LucideIcon
}) {
  const Icon = props.icon

  return (
    <button
      type="button"
      onClick={props.onToggle}
      className="flex w-full items-start justify-between gap-4 px-1 py-1 text-left transition-colors hover:bg-muted/20"
    >
      <div className="flex min-w-0 items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border bg-muted/20 text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="space-y-1">
            <span className="block text-[1.05rem] font-semibold text-foreground">{props.title}</span>
            <span className="block text-xs text-muted-foreground">{props.meta}</span>
          </div>
        </div>
      </div>
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground">
        {props.open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </div>
    </button>
  )
}

export function RunnerDashboard() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([])
  const [loadingWorkflows, setLoadingWorkflows] = useState(true)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("")
  const [query, setQuery] = useState("")
  const [domainFilter, setDomainFilter] = useState("all")
  const [error, setError] = useState<string | null>(null)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [activeJob, setActiveJob] = useState<WorkflowJob | null>(null)
  const [workflowForm, setWorkflowForm] = useState(EMPTY_WORKFLOW_FORM)
  const [savingWorkflow, setSavingWorkflow] = useState(false)
  const [authCapture, setAuthCapture] = useState<AuthCaptureState | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authActionLoading, setAuthActionLoading] = useState<"start" | "finish" | "cancel" | null>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [addWorkflowOpen, setAddWorkflowOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [datasetMode, setDatasetMode] = useState<"extension" | "live-extraction">("extension")
  const [siteAuth, setSiteAuth] = useState<SiteAuthStatus | null>(null)
  const [siteAuthLoading, setSiteAuthLoading] = useState(false)
  const [siteAuthActionLoading, setSiteAuthActionLoading] = useState<string | null>(null)

  const loadWorkflows = async () => {
    setLoadingWorkflows(true)
    setError(null)

    try {
      const res = await fetch("/api/workflows", { cache: "no-store" })
      const payload = (await res.json()) as { workflows?: WorkflowRecord[]; error?: string }
      if (!res.ok) {
        throw new Error(payload.error ?? "Could not load workflows")
      }
      const next = payload.workflows ?? []
      setWorkflows(next)
      setSelectedWorkflowId((current) => current || next[0]?.id || "")
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not load workflows")
    } finally {
      setLoadingWorkflows(false)
    }
  }

  useEffect(() => {
    void loadWorkflows()
  }, [])

  const loadAuthCapture = async () => {
    setAuthLoading(true)
    try {
      const res = await fetch("/api/auth-capture", { cache: "no-store" })
      const payload = (await res.json()) as { authCapture?: AuthCaptureState; error?: string }
      if (!res.ok || !payload.authCapture) {
        throw new Error(payload.error ?? "Could not load auth capture state")
      }
      setAuthCapture(payload.authCapture)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not load auth capture state")
    } finally {
      setAuthLoading(false)
    }
  }

  useEffect(() => {
    void loadAuthCapture()
  }, [])

  useEffect(() => {
    if (!activeJobId) return

    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`/api/workflow-jobs/${activeJobId}`, { cache: "no-store" })
        const payload = (await res.json()) as { job?: WorkflowJob; error?: string }
        if (!res.ok) {
          throw new Error(payload.error ?? "Could not load job")
        }
        if (cancelled) return

        if (payload.job) {
          setActiveJob(payload.job)
          if (payload.job.status !== "running") {
            setActiveJobId(null)
            void loadWorkflows()
          }
        }
      } catch (issue) {
        if (cancelled) return
        setError(issue instanceof Error ? issue.message : "Job polling failed")
        setActiveJobId(null)
      }
    }

    void poll()
    const timer = window.setInterval(poll, 1500)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeJobId])

  useEffect(() => {
    if (!authCapture || (authCapture.status !== "awaiting-user" && authCapture.status !== "saving")) return

    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch("/api/auth-capture", { cache: "no-store" })
        const payload = (await res.json()) as { authCapture?: AuthCaptureState; error?: string }
        if (!res.ok || !payload.authCapture) {
          throw new Error(payload.error ?? "Could not load auth capture state")
        }
        if (!cancelled) {
          setAuthCapture(payload.authCapture)
        }
      } catch {
        // keep last known state during polling
      }
    }

    const timer = window.setInterval(poll, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [authCapture])

  // Fetch site auth when selected workflow changes
  useEffect(() => {
    const wf = workflows.find((w) => w.id === selectedWorkflowId)
    if (!wf) {
      setSiteAuth(null)
      return
    }

    let cancelled = false
    setSiteAuthLoading(true)

    void (async () => {
      try {
        const res = await fetch(`/api/site-auth/${encodeURIComponent(wf.domain)}`, { cache: "no-store" })
        const payload = (await res.json()) as { siteAuth?: SiteAuthStatus }
        if (!cancelled && payload.siteAuth) setSiteAuth(payload.siteAuth)
      } catch {
        if (!cancelled) setSiteAuth(null)
      } finally {
        if (!cancelled) setSiteAuthLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [selectedWorkflowId, workflows])

  // Poll site auth during active capture
  useEffect(() => {
    if (!siteAuth || (siteAuth.status !== "awaiting-user" && siteAuth.status !== "saving")) return
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`/api/site-auth/${encodeURIComponent(siteAuth.domain)}`, { cache: "no-store" })
        const payload = (await res.json()) as { siteAuth?: SiteAuthStatus }
        if (!cancelled && payload.siteAuth) setSiteAuth(payload.siteAuth)
      } catch {
        // keep last known state
      }
    }

    const timer = window.setInterval(poll, 2000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [siteAuth])

  const domains = useMemo(() => ["all", ...new Set(workflows.map((workflow) => workflow.domain))], [workflows])

  const filteredWorkflows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return workflows.filter((workflow) => {
      const domainMatch = domainFilter === "all" || workflow.domain === domainFilter
      if (!domainMatch) return false
      if (!normalizedQuery) return true

      const haystack = `${workflow.domain} ${workflow.level} ${workflow.workflowName} ${workflow.description}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [domainFilter, query, workflows])

  useEffect(() => {
    if (!filteredWorkflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId(filteredWorkflows[0]?.id ?? "")
    }
  }, [filteredWorkflows, selectedWorkflowId])

  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null
  const activeWorkflowJob = activeJob && selectedWorkflow?.id === activeJob.workflowId ? activeJob : null
  const busy = activeJob?.status === "running"

  const groupedWorkflows = useMemo(() => {
    const groups: { domain: string; workflows: typeof filteredWorkflows }[] = []
    const map = new Map<string, typeof filteredWorkflows>()
    for (const wf of filteredWorkflows) {
      let list = map.get(wf.domain)
      if (!list) {
        list = []
        map.set(wf.domain, list)
        groups.push({ domain: wf.domain, workflows: list })
      }
      list.push(wf)
    }
    return groups
  }, [filteredWorkflows])

  const counts = useMemo(() => {
    const withSchema = workflows.filter((workflow) => workflow.schema).length
    const withDatasets = workflows.filter((workflow) => workflow.datasets.length > 0).length
    return {
      total: workflows.length,
      withSchema,
      withDatasets,
    }
  }, [workflows])

  const startJob = async (url: string, body?: Record<string, unknown>) => {
    setError(null)

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      })
      const payload = (await res.json()) as { job?: WorkflowJob; error?: string }
      if (!res.ok || !payload.job) {
        throw new Error(payload.error ?? "Could not start job")
      }

      setActiveJob(payload.job)
      setActiveJobId(payload.job.id)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not start job")
    }
  }

  const runAuthAction = async (action: "start" | "finish" | "cancel") => {
    setAuthActionLoading(action)
    setError(null)

    try {
      const res = await fetch("/api/auth-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const payload = (await res.json()) as { authCapture?: AuthCaptureState; error?: string }
      if (!res.ok || !payload.authCapture) {
        throw new Error(payload.error ?? "Could not update authentication capture")
      }
      setAuthCapture(payload.authCapture)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not update authentication capture")
    } finally {
      setAuthActionLoading(null)
    }
  }

  const runSiteAuthAction = async (domain: string, action: "start" | "finish" | "cancel", startUrl?: string) => {
    setSiteAuthActionLoading(action)
    setError(null)

    try {
      const res = await fetch(`/api/site-auth/${encodeURIComponent(domain)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, startUrl }),
      })
      const payload = (await res.json()) as { siteAuth?: SiteAuthStatus; error?: string }
      if (!res.ok || !payload.siteAuth) {
        throw new Error(payload.error ?? "Site auth action failed")
      }
      setSiteAuth(payload.siteAuth)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Site auth action failed")
    } finally {
      setSiteAuthActionLoading(null)
    }
  }

  const createWorkflow = async () => {
    setSavingWorkflow(true)
    setError(null)

    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workflowForm),
      })
      const payload = (await res.json()) as { workflow?: WorkflowRecord; error?: string }
      if (!res.ok || !payload.workflow) {
        throw new Error(payload.error ?? "Could not create workflow")
      }

      setWorkflowForm(EMPTY_WORKFLOW_FORM)
      await loadWorkflows()
      setSelectedWorkflowId(payload.workflow.id)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not create workflow")
    } finally {
      setSavingWorkflow(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="border-b border-border pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Workflow test lab</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Load workflow definitions from the CSV catalog, ask the extension for workflow schemas, generate live test
              datasets, and verify workflow execution against saved JSON outputs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span>{counts.total} workflows</span>
            <span>{counts.withSchema} with schema</span>
            <span>{counts.withDatasets} with datasets</span>
          </div>
        </div>
      </header>

      <main id="main-content" className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <SidebarSectionToggle
                title="Catalog"
                meta={`${counts.total} workflows`}
                open={catalogOpen}
                onToggle={() => setCatalogOpen((current) => !current)}
                icon={Database}
              />
            </CardHeader>
            {catalogOpen ? (
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search workflows" />
                </div>

                <div className="space-y-2">
                  <label htmlFor="domain-filter" className="text-sm font-medium text-foreground">
                    Domain
                  </label>
                  <select
                    id="domain-filter"
                    value={domainFilter}
                    onChange={(event) => setDomainFilter(event.target.value)}
                    className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {domains.map((domain) => (
                      <option key={domain} value={domain}>
                        {domain === "all" ? "All domains" : domain}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{filteredWorkflows.length} visible</p>
                  <Button variant="outline" size="sm" onClick={() => void loadWorkflows()} disabled={loadingWorkflows}>
                    <RefreshCw className="mr-2 size-4" />
                    Reload
                  </Button>
                </div>

                <div className="max-h-[520px] overflow-y-auto border border-border">
                  {loadingWorkflows ? (
                    <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      Loading workflows
                    </div>
                  ) : null}

                  {!loadingWorkflows && filteredWorkflows.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">No workflows matched the current filters.</div>
                  ) : null}

                  {groupedWorkflows.map((group) => (
                    <div key={group.domain}>
                      <div className="sticky top-0 z-10 border-b border-border bg-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                        {group.domain}
                        <span className="ml-2 font-normal normal-case tracking-normal">{group.workflows.length}</span>
                      </div>
                      {group.workflows.map((workflow) => {
                        const selected = workflow.id === selectedWorkflowId
                        return (
                          <button
                            key={workflow.id}
                            type="button"
                            onClick={() => setSelectedWorkflowId(workflow.id)}
                            className={`w-full border-b border-border px-4 py-2.5 text-left transition-colors ${
                              selected ? "bg-muted" : "bg-background hover:bg-muted/60"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-foreground">{workflow.workflowName}</p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{workflow.level}</p>
                              </div>
                              <Badge variant={workflow.datasets.length > 0 ? "success" : "secondary"}>
                                {workflow.datasets.length}
                              </Badge>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <SidebarSectionToggle
                title="Add workflow"
                meta="Custom entry"
                open={addWorkflowOpen}
                onToggle={() => setAddWorkflowOpen((current) => !current)}
                icon={Plus}
              />
            </CardHeader>
            {addWorkflowOpen ? (
              <CardContent className="space-y-3">
                <Input
                  placeholder="Domain"
                  value={workflowForm.domain}
                  onChange={(event) => setWorkflowForm((current) => ({ ...current, domain: event.target.value }))}
                />
                <div className="grid gap-3 sm:grid-cols-[100px_minmax(0,1fr)]">
                  <select
                    value={workflowForm.level}
                    onChange={(event) => setWorkflowForm((current) => ({ ...current, level: event.target.value }))}
                    className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="L0">L0</option>
                    <option value="L1">L1</option>
                    <option value="L2">L2</option>
                  </select>
                  <Input
                    placeholder="workflow/path/name"
                    value={workflowForm.workflowName}
                    onChange={(event) => setWorkflowForm((current) => ({ ...current, workflowName: event.target.value }))}
                  />
                </div>
                <textarea
                  value={workflowForm.description}
                  onChange={(event) => setWorkflowForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Description"
                  className="min-h-24 w-full border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <Input
                  placeholder="Status"
                  value={workflowForm.status}
                  onChange={(event) => setWorkflowForm((current) => ({ ...current, status: event.target.value }))}
                />
                <Button onClick={() => void createWorkflow()} disabled={savingWorkflow} className="w-full">
                  {savingWorkflow ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Database className="mr-2 size-4" />}
                  Save workflow
                </Button>
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <SidebarSectionToggle
                title="Authentication"
                meta={authCapture?.savedAuthState?.exists ? "Tokens saved" : "Not configured"}
                open={authOpen}
                onToggle={() => setAuthOpen((current) => !current)}
                icon={KeyRound}
              />
            </CardHeader>
            {authOpen ? (
              <CardContent className="space-y-4">
                {authLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />
                    Loading authentication state
                  </div>
                ) : null}

                {!authLoading && authCapture ? (
                  <>
                    <div className="space-y-1 text-sm">
                      <p className="text-muted-foreground">
                        State: <span className="font-medium text-foreground">{authCapture.savedAuthState?.exists ? "Saved" : "Missing"}</span>
                        {authCapture.savedAuthState?.updatedAt ? ` · ${formatDate(authCapture.savedAuthState.updatedAt)}` : null}
                      </p>
                      {authCapture.status !== "idle" ? (
                        <p className="text-muted-foreground">
                          Capture: <Badge variant={badgeVariantForState(authCapture.status)}>{authCapture.status}</Badge>
                        </p>
                      ) : null}
                      {authCapture.error ? <p className="text-foreground">{authCapture.error}</p> : null}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Start → log in via Chrome → finish to save tokens.
                    </p>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => void runAuthAction("start")}
                        disabled={busy || authActionLoading !== null || authCapture.status === "awaiting-user" || authCapture.status === "saving"}
                      >
                        {authActionLoading === "start" ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <KeyRound className="mr-2 size-4" />}
                        Start capture
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runAuthAction("finish")}
                        disabled={authActionLoading !== null || authCapture.status !== "awaiting-user"}
                      >
                        {authActionLoading === "finish" ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                        Finish &amp; save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void runAuthAction("cancel")}
                        disabled={authActionLoading !== null || (authCapture.status !== "awaiting-user" && authCapture.status !== "saving")}
                      >
                        {authActionLoading === "cancel" ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : null}
              </CardContent>
            ) : null}
          </Card>
        </section>

        <section className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <CardTitle>{selectedWorkflow ? selectedWorkflow.workflowName : "Select a workflow"}</CardTitle>
                  <CardDescription>
                    {selectedWorkflow
                      ? `${selectedWorkflow.domain} · ${selectedWorkflow.level} · ${selectedWorkflow.workflowRef}`
                      : "Pick a workflow from the catalog to inspect schema, datasets, and test runs."}
                  </CardDescription>
                </div>
                {selectedWorkflow ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => void startJob(`/api/workflows/${selectedWorkflow.id}/schema`)}
                      disabled={busy}
                    >
                      {busy && activeWorkflowJob?.kind === "discover-schema" ? (
                        <LoaderCircle className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Search className="mr-2 size-4" />
                      )}
                      Discover schema
                    </Button>
                    <div className="flex items-center gap-0">
                      <Button
                        variant="outline"
                        className="rounded-r-none"
                        onClick={() =>
                          void startJob(`/api/workflows/${selectedWorkflow.id}/datasets`, {
                            count: 3,
                            mode: datasetMode,
                          })
                        }
                        disabled={busy}
                      >
                        {busy && (activeWorkflowJob?.kind === "generate-datasets" || activeWorkflowJob?.kind === "generate-datasets-live") ? (
                          <LoaderCircle className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Database className="mr-2 size-4" />
                        )}
                        {datasetMode === "live-extraction" ? "Generate (live)" : "Generate datasets"}
                      </Button>
                      <Button
                        variant={datasetMode === "live-extraction" ? "default" : "outline"}
                        className="rounded-l-none border-l-0 px-2 text-xs"
                        onClick={() => setDatasetMode((m) => (m === "extension" ? "live-extraction" : "extension"))}
                        disabled={busy}
                        title={datasetMode === "extension" ? "Switch to live extraction (navigate & scrape)" : "Switch to extension execution"}
                      >
                        {datasetMode === "live-extraction" ? "LIVE" : "EXT"}
                      </Button>
                    </div>
                    <Button onClick={() => void startJob(`/api/workflows/${selectedWorkflow.id}/run`)} disabled={busy}>
                      {busy && activeWorkflowJob?.kind === "run-tests" ? (
                        <LoaderCircle className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Play className="mr-2 size-4" />
                      )}
                      Run tests
                    </Button>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        setError(null)
                        try {
                          const res = await fetch(`/api/workflows/${selectedWorkflow.id}/clear`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                          })
                          if (!res.ok) {
                            const payload = (await res.json()) as { error?: string }
                            throw new Error(payload.error ?? "Failed to clear workflow data")
                          }
                          await loadWorkflows()
                        } catch (issue) {
                          setError(issue instanceof Error ? issue.message : "Failed to clear workflow data")
                        }
                      }}
                      disabled={busy}
                    >
                      <Trash2 className="mr-2 size-4" />
                      Clear
                    </Button>
                  </div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {error ? <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground">{error}</p> : null}

              {!selectedWorkflow ? <p className="text-sm text-muted-foreground">No workflow selected.</p> : null}

              {selectedWorkflow ? (
                <>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                    <span>Source: <span className="font-medium text-foreground">{selectedWorkflow.source}</span></span>
                    <span>Status: <span className="font-medium text-foreground">{selectedWorkflow.status}</span></span>
                    <span>Schema: <span className="font-medium text-foreground">{selectedWorkflow.schema ? formatDate(selectedWorkflow.schema.discoveredAt) : "None"}</span></span>
                    <span>Datasets: <span className="font-medium text-foreground">{selectedWorkflow.datasets.length}</span></span>
                  </div>

                  <div className="space-y-2">
                    <h2 className="text-base font-semibold text-foreground">Description</h2>
                    <p className="text-sm leading-6 text-muted-foreground">{selectedWorkflow.description || "No description provided."}</p>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-semibold text-foreground">Schema</h2>
                      {selectedWorkflow.schema ? (
                        <Badge variant="success">{selectedWorkflow.schema.inputParameters.length} inputs</Badge>
                      ) : (
                        <Badge variant="secondary">Missing</Badge>
                      )}
                    </div>

                    {!selectedWorkflow.schema ? (
                      <p className="text-sm text-muted-foreground">
                        Run schema discovery to ask the extension for the workflow input and output parameters.
                      </p>
                    ) : (
                      <div className="grid gap-6 xl:grid-cols-2">
                        <div className="font-mono text-[13px]">
                          <p className="text-muted-foreground">input/</p>
                          {selectedWorkflow.schema.inputParameters.length === 0 ? (
                            <p className="pl-4 text-muted-foreground">{"  (empty)"}</p>
                          ) : (
                            selectedWorkflow.schema.inputParameters.map((param, i) => {
                              const isLast = i === selectedWorkflow.schema!.inputParameters.length - 1
                              return (
                                <div key={param.name} className="flex items-baseline">
                                  <span className="select-none text-muted-foreground/50">{isLast ? "└─ " : "├─ "}</span>
                                  <span className="font-medium text-foreground">{param.name}</span>
                                  {param.type ? (
                                    <span className="ml-2 text-xs text-muted-foreground">{param.type}</span>
                                  ) : null}
                                  {param.required ? (
                                    <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-amber-500">req</span>
                                  ) : null}
                                </div>
                              )
                            })
                          )}
                        </div>
                        <div className="font-mono text-[13px]">
                          <p className="text-muted-foreground">output/</p>
                          {selectedWorkflow.schema.outputParameters.length === 0 ? (
                            <p className="pl-4 text-muted-foreground">{"  (empty)"}</p>
                          ) : (
                            selectedWorkflow.schema.outputParameters.map((param, i) => {
                              const isLast = i === selectedWorkflow.schema!.outputParameters.length - 1
                              return (
                                <div key={param.name} className="flex items-baseline">
                                  <span className="select-none text-muted-foreground/50">{isLast ? "└─ " : "├─ "}</span>
                                  <span className="font-medium text-foreground">{param.name}</span>
                                  {param.type ? (
                                    <span className="ml-2 text-xs text-muted-foreground">{param.type}</span>
                                  ) : null}
                                  {param.required ? (
                                    <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-amber-500">req</span>
                                  ) : null}
                                </div>
                              )
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-semibold text-foreground">Site Authentication</h2>
                      <Badge variant={siteAuth?.savedState?.exists ? "success" : "secondary"}>
                        {siteAuth?.savedState?.exists ? "Saved" : "Not configured"}
                      </Badge>
                    </div>

                    <p className="text-sm text-muted-foreground">
                      Capture login tokens for <span className="font-medium text-foreground">{selectedWorkflow.domain}</span> so live extraction can access authenticated pages.
                    </p>

                    {siteAuthLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" /> Loading
                      </div>
                    ) : siteAuth ? (
                      <>
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                          <span>
                            Tokens:{" "}
                            <span className="font-medium text-foreground">
                              {siteAuth.savedState?.exists
                                ? `${siteAuth.savedState.cookieCount ?? 0} cookies, ${siteAuth.savedState.localStorageKeyCount ?? 0} storage keys`
                                : "None"}
                            </span>
                          </span>
                          {siteAuth.savedState?.updatedAt ? <span>Updated {formatDate(siteAuth.savedState.updatedAt)}</span> : null}
                          {siteAuth.status !== "idle" ? (
                            <span>
                              Capture: <Badge variant={badgeVariantForState(siteAuth.status)}>{siteAuth.status}</Badge>
                            </span>
                          ) : null}
                        </div>
                        {siteAuth.error ? <p className="text-sm text-foreground">{siteAuth.error}</p> : null}

                        <p className="text-xs text-muted-foreground">
                          Start → log in at {selectedWorkflow.domain} → finish to save cookies for replay.
                        </p>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void runSiteAuthAction(selectedWorkflow.domain, "start", `https://${selectedWorkflow.domain}`)}
                            disabled={busy || siteAuthActionLoading !== null || siteAuth.status === "awaiting-user" || siteAuth.status === "saving"}
                          >
                            {siteAuthActionLoading === "start" ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <KeyRound className="mr-2 size-4" />}
                            Start site login
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void runSiteAuthAction(selectedWorkflow.domain, "finish")}
                            disabled={siteAuthActionLoading !== null || siteAuth.status !== "awaiting-user"}
                          >
                            {siteAuthActionLoading === "finish" ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                            Finish &amp; save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void runSiteAuthAction(selectedWorkflow.domain, "cancel")}
                            disabled={siteAuthActionLoading !== null || (siteAuth.status !== "awaiting-user" && siteAuth.status !== "saving")}
                          >
                            {siteAuthActionLoading === "cancel" ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : null}
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-semibold text-foreground">Datasets</h2>
                      <Badge variant={selectedWorkflow.datasets.length > 0 ? "success" : "secondary"}>
                        {selectedWorkflow.datasets.length} saved
                      </Badge>
                    </div>

                    {selectedWorkflow.datasets.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No datasets have been generated yet. Use the generate action to ask the extension for inputs and live outputs.
                      </p>
                    ) : null}

                    <div className="divide-y divide-border">
                      {selectedWorkflow.datasets.map((dataset, index) => (
                        <div key={dataset.id} className="py-4 first:pt-0">
                          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                            <p className="text-sm text-muted-foreground">
                              <span className="font-medium text-foreground">Dataset {index + 1}</span>
                              {" · "}{formatDate(dataset.createdAt)} · {dataset.source}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              {dataset.lastRun ? (
                                <Badge variant={dataset.lastRun.success ? "success" : "danger"}>
                                  {dataset.lastRun.success ? "Passed" : "Failed"}
                                </Badge>
                              ) : (
                                <Badge variant="secondary">Not run</Badge>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void startJob(`/api/workflows/${selectedWorkflow.id}/run`, { datasetId: dataset.id })}
                                disabled={busy}
                              >
                                Run
                              </Button>
                            </div>
                          </div>
                          {dataset.notes ? <p className="mt-1 text-xs text-muted-foreground">{dataset.notes}</p> : null}
                          <div className="mt-3 grid gap-4 xl:grid-cols-2">
                            <div>
                              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Input</h3>
                              <pre className="overflow-x-auto bg-muted/40 p-3 text-xs leading-6 text-foreground">
                                {formatJson(dataset.input)}
                              </pre>
                            </div>
                            <div>
                              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Expected output</h3>
                              <pre className="overflow-x-auto bg-muted/40 p-3 text-xs leading-6 text-foreground">
                                {formatJson(dataset.expectedOutput)}
                              </pre>
                            </div>
                          </div>
                          {dataset.lastRun?.diff ? (
                            <div className="mt-3">
                              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Last mismatch</h3>
                              {Array.isArray(dataset.lastRun.diff) ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-border text-left text-muted-foreground">
                                        <th className="px-2 py-1">Path</th>
                                        <th className="px-2 py-1">Expected</th>
                                        <th className="px-2 py-1">Actual</th>
                                        <th className="px-2 py-1">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(dataset.lastRun.diff as FieldDiffEntry[])
                                        .filter((e) => e.status !== "match")
                                        .map((entry, i) => (
                                          <tr key={i} className="border-b border-border/50">
                                            <td className="px-2 py-1 font-mono">{entry.path}</td>
                                            <td className="px-2 py-1 font-mono text-red-400">
                                              {entry.expected !== undefined ? JSON.stringify(entry.expected) : "—"}
                                            </td>
                                            <td className="px-2 py-1 font-mono text-green-400">
                                              {entry.actual !== undefined ? JSON.stringify(entry.actual) : "—"}
                                            </td>
                                            <td className="px-2 py-1">
                                              <span className={
                                                entry.status === "mismatch" ? "text-red-400" :
                                                entry.status === "missing" ? "text-yellow-400" :
                                                "text-blue-400"
                                              }>
                                                {entry.status}
                                              </span>
                                            </td>
                                          </tr>
                                        ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <pre className="overflow-x-auto bg-muted/40 p-3 text-xs leading-6 text-foreground">
                                  {dataset.lastRun.diff}
                                </pre>
                              )}
                            </div>
                          ) : null}
                          {dataset.lastRun?.screenshotPath ? (
                            <div className="mt-3">
                              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Failure screenshot</h3>
                              <a
                                href={`/api/artifacts/${dataset.lastRun.screenshotPath.split("failure-captures/").pop()}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <img
                                  src={`/api/artifacts/${dataset.lastRun.screenshotPath.split("failure-captures/").pop()}`}
                                  alt="Failure screenshot"
                                  className="max-h-48 rounded border border-border"
                                />
                              </a>
                            </div>
                          ) : null}
                          {dataset.lastRun?.domSnapshot ? (
                            <details className="mt-3">
                              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                                DOM snapshot
                              </summary>
                              <pre className="mt-1 max-h-48 overflow-auto bg-muted/40 p-3 text-xs leading-6 text-foreground">
                                {dataset.lastRun.domSnapshot.slice(0, 5000)}
                              </pre>
                            </details>
                          ) : null}
                          {dataset.lastRun?.error ? (
                            <p className="mt-2 text-sm text-foreground">{dataset.lastRun.error}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Job output</CardTitle>
              <CardDescription>Long-running schema, dataset, and test operations stream their logs here.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!activeJob ? <p className="text-sm text-muted-foreground">No job has been run in this session.</p> : null}
              {activeJob ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={badgeVariantForState(activeJob.status)}>{activeJob.status}</Badge>
                    <span className="text-sm text-muted-foreground">{activeJob.kind}</span>
                    <span className="text-sm text-muted-foreground">{formatDate(activeJob.startedAt)}</span>
                    <span className="text-sm text-muted-foreground">
                      {typeof activeJob.durationMs === "number" ? `${activeJob.durationMs} ms` : "Running"}
                    </span>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto border border-border bg-muted/30">
                    {activeJob.logs.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground">No logs yet.</p>
                    ) : (
                      <div className="space-y-0 border-t-0">
                        {activeJob.logs.map((line, index) => (
                          <p key={`${index}-${line.slice(0, 24)}`} className="border-b border-border px-4 py-2 font-mono text-xs text-foreground">
                            {line}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  {activeJob.error ? <p className="text-sm text-foreground">{activeJob.error}</p> : null}
                </>
              ) : null}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  )
}
