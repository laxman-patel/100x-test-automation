import { existsSync, mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { dirname, resolve } from "node:path"
import { type JsonValue } from "./json"

const WORKFLOW_CSV_PATH = resolve(process.cwd(), "Website based workflow structures - Website L0-L1 steps.csv")
const WORKFLOW_STATE_PATH = resolve(process.cwd(), "artifacts/workflow-lab/state.json")
const LEVEL_ORDER = new Map([
  ["L0", 0],
  ["L1", 1],
  ["L2", 2],
  ["L3", 3],
])

export interface WorkflowDefinitionInput {
  domain: string
  level: string
  workflowName: string
  description?: string
  status?: string
}

export interface WorkflowDefinition extends WorkflowDefinitionInput {
  id: string
  workflowRef: string
  source: "csv" | "custom"
  exists: boolean
  description: string
  status: string
}

export interface WorkflowParameter {
  name: string
  type?: string
  required?: boolean
  description?: string
}

export interface WorkflowSchemaRecord {
  discoveredAt: string
  prompt: string
  rawResponse: string
  parsed: JsonValue
  inputParameters: WorkflowParameter[]
  outputParameters: WorkflowParameter[]
}

export interface WorkflowDatasetRunRecord {
  ranAt: string
  success: boolean
  actualOutput?: JsonValue
  rawResponse: string
  diff?: string
  error?: string
}

export interface WorkflowDatasetRecord {
  id: string
  createdAt: string
  source: "generated" | "manual" | "live-extraction"
  input: JsonValue
  expectedOutput: JsonValue
  candidatePrompt?: string
  executionPrompt?: string
  rawExecutionResponse?: string
  notes?: string
  lastRun?: WorkflowDatasetRunRecord
}

export interface WorkflowStateRecord {
  schema?: WorkflowSchemaRecord
  datasets: WorkflowDatasetRecord[]
  updatedAt?: string
}

interface WorkflowStateFile {
  version: 1
  customWorkflows: WorkflowDefinitionInput[]
  workflowState: Record<string, WorkflowStateRecord>
}

export interface WorkflowRecord extends WorkflowDefinition {
  schema?: WorkflowSchemaRecord
  datasets: WorkflowDatasetRecord[]
  updatedAt?: string
}

function slugifySegment(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function toWorkflowId(input: WorkflowDefinitionInput): string {
  return `${slugifySegment(input.domain)}__${slugifySegment(input.level)}__${slugifySegment(input.workflowName)}`
}

function toWorkflowRef(input: WorkflowDefinitionInput): string {
  const domain = input.domain.trim().toLowerCase()
  const workflowName = input.workflowName.trim().replace(/^\/+/, "")
  return `${domain}/${workflowName}`
}

function looksLikeExists(status: string): boolean {
  return status.trim().toLowerCase().includes("exist")
}

function normalizeWorkflowInput(input: WorkflowDefinitionInput, source: "csv" | "custom"): WorkflowDefinition {
  const normalized: WorkflowDefinitionInput = {
    domain: input.domain.trim(),
    level: input.level.trim() || "L0",
    workflowName: input.workflowName.trim().replace(/^\/+/, ""),
    description: input.description?.trim() || "",
    status: input.status?.trim() || "Unknown",
  }

  return {
    ...normalized,
    id: toWorkflowId(normalized),
    workflowRef: toWorkflowRef(normalized),
    source,
    exists: looksLikeExists(normalized.status ?? ""),
    description: normalized.description ?? "",
    status: normalized.status ?? "Unknown",
  }
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let currentCell = ""
  let currentRow: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        currentCell += "\""
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell)
      currentCell = ""
      continue
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1
      }
      currentRow.push(currentCell)
      rows.push(currentRow)
      currentCell = ""
      currentRow = []
      continue
    }

    currentCell += char
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell)
    rows.push(currentRow)
  }

  return rows
}

// Convert JSON Schema {type: "object", properties: {...}, required: [...]} to WorkflowParameter[]
function extractFromJsonSchema(value: unknown): WorkflowParameter[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const record = value as Record<string, unknown>

  // Check if this looks like JSON Schema: has "properties" object
  if (!record.properties || typeof record.properties !== "object" || Array.isArray(record.properties)) return []

  const props = record.properties as Record<string, unknown>
  const requiredList = Array.isArray(record.required) ? (record.required as string[]) : []

  return Object.entries(props)
    .map(([name, propValue]) => {
      if (!propValue || typeof propValue !== "object" || Array.isArray(propValue)) {
        return { name }
      }
      const prop = propValue as Record<string, unknown>
      return {
        name,
        type: typeof prop.type === "string" ? prop.type : undefined,
        required: requiredList.includes(name) ? true : undefined,
        description: typeof prop.description === "string" ? prop.description : undefined,
      }
    })
    .filter((p) => p.name.trim() !== "")
}

function extractParameterArray(value: unknown): WorkflowParameter[] {
  // Handle JSON Schema format: {type: "object", properties: {...}}
  const schemaParams = extractFromJsonSchema(value)
  if (schemaParams.length > 0) return schemaParams

  if (!Array.isArray(value)) return []

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return { name: entry.trim() }
      }

      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>
        const name =
          typeof record.name === "string"
            ? record.name
            : typeof record.key === "string"
              ? record.key
              : typeof record.field === "string"
                ? record.field
                : ""

        if (!name.trim()) return null

        return {
          name: name.trim(),
          type: typeof record.type === "string" ? record.type : undefined,
          required: typeof record.required === "boolean" ? record.required : undefined,
          description: typeof record.description === "string" ? record.description : undefined,
        }
      }

      return null
    })
    .filter((entry): entry is WorkflowParameter => Boolean(entry))
}

function extractSchemaArrays(parsed: JsonValue): {
  inputParameters: WorkflowParameter[]
  outputParameters: WorkflowParameter[]
} {
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return {
      inputParameters: [],
      outputParameters: [],
    }
  }

  const record = parsed as Record<string, JsonValue>

  const inputCandidates = [
    extractParameterArray(record.inputParameters),
    extractParameterArray(record.inputs),
    extractParameterArray(record.input),
  ]
  const outputCandidates = [
    extractParameterArray(record.outputParameters),
    extractParameterArray(record.outputs),
    extractParameterArray(record.output),
  ]

  const inputParameters = inputCandidates.find((entry) => entry.length > 0) ?? []
  const outputParameters = outputCandidates.find((entry) => entry.length > 0) ?? []

  return {
    inputParameters,
    outputParameters,
  }
}

async function ensureStateDir(): Promise<void> {
  mkdirSync(dirname(WORKFLOW_STATE_PATH), { recursive: true })
}

async function loadStateFile(): Promise<WorkflowStateFile> {
  if (!existsSync(WORKFLOW_STATE_PATH)) {
    return {
      version: 1,
      customWorkflows: [],
      workflowState: {},
    }
  }

  const raw = await readFile(WORKFLOW_STATE_PATH, "utf8")
  const parsed = JSON.parse(raw) as Partial<WorkflowStateFile>

  return {
    version: 1,
    customWorkflows: Array.isArray(parsed.customWorkflows) ? parsed.customWorkflows : [],
    workflowState: parsed.workflowState && typeof parsed.workflowState === "object" ? parsed.workflowState : {},
  }
}

async function saveStateFile(state: WorkflowStateFile): Promise<void> {
  await ensureStateDir()
  await writeFile(WORKFLOW_STATE_PATH, JSON.stringify(state, null, 2), "utf8")
}

async function loadCsvWorkflows(): Promise<WorkflowDefinition[]> {
  const raw = await readFile(WORKFLOW_CSV_PATH, "utf8")
  const rows = parseCsvRows(raw.replace(/^\uFEFF/, ""))

  return rows
    .slice(1)
    .map((row) => ({
      domain: row[0] ?? "",
      level: row[1] ?? "",
      workflowName: row[2] ?? "",
      description: row[3] ?? "",
      status: row[4] ?? "",
    }))
    .filter((row) => row.domain.trim() && row.workflowName.trim())
    .map((row) => normalizeWorkflowInput(row, "csv"))
}

function mergeWorkflowState(definition: WorkflowDefinition, state?: WorkflowStateRecord): WorkflowRecord {
  return {
    ...definition,
    schema: state?.schema,
    datasets: state?.datasets ?? [],
    updatedAt: state?.updatedAt,
  }
}

function compareWorkflowOrder(left: WorkflowDefinition, right: WorkflowDefinition): number {
  const domainCompare = left.domain.localeCompare(right.domain)
  if (domainCompare !== 0) return domainCompare

  const leftLevel = LEVEL_ORDER.get(left.level) ?? 99
  const rightLevel = LEVEL_ORDER.get(right.level) ?? 99
  if (leftLevel !== rightLevel) return leftLevel - rightLevel

  return left.workflowName.localeCompare(right.workflowName)
}

export async function listWorkflows(): Promise<WorkflowRecord[]> {
  const [csvWorkflows, state] = await Promise.all([loadCsvWorkflows(), loadStateFile()])
  const custom = state.customWorkflows.map((entry) => normalizeWorkflowInput(entry, "custom"))
  const merged = new Map<string, WorkflowDefinition>()

  for (const workflow of [...csvWorkflows, ...custom]) {
    merged.set(workflow.id, workflow)
  }

  return [...merged.values()]
    .sort(compareWorkflowOrder)
    .map((workflow) => mergeWorkflowState(workflow, state.workflowState[workflow.id]))
}

export async function getWorkflowById(id: string): Promise<WorkflowRecord> {
  const workflows = await listWorkflows()
  const workflow = workflows.find((entry) => entry.id === id)
  if (!workflow) {
    throw new Error(`Workflow not found: ${id}`)
  }
  return workflow
}

export async function addCustomWorkflow(input: WorkflowDefinitionInput): Promise<WorkflowRecord> {
  if (!input.domain.trim()) {
    throw new Error("domain is required")
  }
  if (!input.workflowName.trim()) {
    throw new Error("workflowName is required")
  }

  const state = await loadStateFile()
  const normalized = normalizeWorkflowInput(input, "custom")
  const exists = state.customWorkflows.some((entry) => toWorkflowId(entry) === normalized.id)
  if (exists) {
    throw new Error("A workflow with the same domain, level, and workflow name already exists.")
  }

  state.customWorkflows.push({
    domain: normalized.domain,
    level: normalized.level,
    workflowName: normalized.workflowName,
    description: normalized.description,
    status: normalized.status,
  })
  state.workflowState[normalized.id] = state.workflowState[normalized.id] ?? {
    datasets: [],
    updatedAt: new Date().toISOString(),
  }

  await saveStateFile(state)

  return mergeWorkflowState(normalized, state.workflowState[normalized.id])
}

export async function saveWorkflowSchema(id: string, input: {
  prompt: string
  rawResponse: string
  parsed: JsonValue
}): Promise<WorkflowRecord> {
  const workflow = await getWorkflowById(id)
  const state = await loadStateFile()
  const current = state.workflowState[id] ?? { datasets: [] }
  const extracted = extractSchemaArrays(input.parsed)

  state.workflowState[id] = {
    ...current,
    schema: {
      discoveredAt: new Date().toISOString(),
      prompt: input.prompt,
      rawResponse: input.rawResponse,
      parsed: input.parsed,
      inputParameters: extracted.inputParameters,
      outputParameters: extracted.outputParameters,
    },
    updatedAt: new Date().toISOString(),
  }

  await saveStateFile(state)
  return mergeWorkflowState(workflow, state.workflowState[id])
}

export async function replaceWorkflowDatasets(id: string, datasets: WorkflowDatasetRecord[]): Promise<WorkflowRecord> {
  const workflow = await getWorkflowById(id)
  const state = await loadStateFile()
  const current = state.workflowState[id] ?? { datasets: [] }

  state.workflowState[id] = {
    ...current,
    datasets,
    updatedAt: new Date().toISOString(),
  }

  await saveStateFile(state)
  return mergeWorkflowState(workflow, state.workflowState[id])
}

export async function updateWorkflowDatasetRun(
  workflowId: string,
  datasetId: string,
  run: WorkflowDatasetRunRecord,
): Promise<WorkflowRecord> {
  const workflow = await getWorkflowById(workflowId)
  const state = await loadStateFile()
  const current = state.workflowState[workflowId] ?? { datasets: [] }

  current.datasets = current.datasets.map((dataset) =>
    dataset.id === datasetId
      ? {
          ...dataset,
          lastRun: run,
        }
      : dataset,
  )
  current.updatedAt = new Date().toISOString()
  state.workflowState[workflowId] = current

  await saveStateFile(state)
  return mergeWorkflowState(workflow, current)
}

export function createGeneratedDataset(input: {
  source?: "generated" | "manual" | "live-extraction"
  payload: JsonValue
  expectedOutput: JsonValue
  candidatePrompt?: string
  executionPrompt?: string
  rawExecutionResponse?: string
  notes?: string
}): WorkflowDatasetRecord {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    source: input.source ?? "generated",
    input: input.payload,
    expectedOutput: input.expectedOutput,
    candidatePrompt: input.candidatePrompt,
    executionPrompt: input.executionPrompt,
    rawExecutionResponse: input.rawExecutionResponse,
    notes: input.notes,
  }
}
