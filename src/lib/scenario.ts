import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

export type ScenarioStepAction =
  | "open"
  | "openNewTab"
  | "snapshot"
  | "assertSnapshotContains"
  | "consoleLogs"
  | "clickRef"
  | "fillRef"
  | "typeRef"
  | "wait"
  | "screenshot"
  | "eval"
  | "close"

export interface ScenarioStep {
  action: ScenarioStepAction
  id?: string
  optional?: boolean
  url?: string
  interactive?: boolean
  ref?: string
  text?: string
  value?: string
  waitFor?: string | number
  path?: string
  code?: string
  storeAs?: string
  clear?: boolean
}

export interface Scenario {
  name: string
  description?: string
  settings?: {
    url?: string
  }
  steps: ScenarioStep[]
}

export function resolveScenarioPath(inputPath: string): string {
  if (inputPath.startsWith("/")) return inputPath
  return resolve(process.cwd(), inputPath)
}

export async function loadScenario(filePath: string): Promise<Scenario> {
  const fullPath = resolveScenarioPath(filePath)
  let raw: string

  try {
    raw = await readFile(fullPath, "utf8")
  } catch {
    throw new Error(`Scenario file not found: ${fullPath}`)
  }

  const parsed = JSON.parse(raw) as Scenario

  if (!parsed?.name) {
    throw new Error(`Invalid scenario: missing name in ${fullPath}`)
  }

  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error(`Invalid scenario: missing steps in ${fullPath}`)
  }

  return parsed
}
