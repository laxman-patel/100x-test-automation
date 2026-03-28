import Anthropic from "@anthropic-ai/sdk"
import { type JsonValue } from "./json"
import { stableStringify } from "./json"
import type { WorkflowRecord } from "./workflows"

const client = new Anthropic()

export interface CandidateResult {
  input: JsonValue
  notes?: string
}

export interface LiveExtractionCandidate extends CandidateResult {
  startUrl: string
}

export async function generateCandidateInputs(
  workflow: WorkflowRecord,
  count: number,
  log?: (line: string) => void,
): Promise<CandidateResult[]> {
  const schemaSection = workflow.schema
    ? `Input parameters:\n${stableStringify(workflow.schema.inputParameters as unknown as JsonValue)}\n\nOutput parameters:\n${stableStringify(workflow.schema.outputParameters as unknown as JsonValue)}`
    : "No schema discovered yet — infer reasonable input parameters from the workflow name and domain."

  const prompt = [
    `Workflow: ${workflow.workflowRef}`,
    `Domain: ${workflow.domain}`,
    `Level: ${workflow.level}`,
    workflow.description ? `Description: ${workflow.description}` : null,
    "",
    schemaSection,
    "",
    `Generate ${count} sample input payloads for this workflow.`,
    "Requirements:",
    "- Inputs must be public, deterministic, and executable right now (no auth-gated or ephemeral data)",
    "- Cover diverse cases: typical usage, edge cases, boundary values",
    "- Each input should be realistic for the domain",
    "",
    "Return ONLY a JSON array. Each item must have this exact shape:",
    '{"input": { ... }, "notes": "short reason why this input is stable and what it tests"}',
    "",
    "No markdown fences, no explanation — raw JSON array only.",
  ]
    .filter((line) => line !== null)
    .join("\n")

  log?.(`Generating ${count} candidate inputs via Claude API`)

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  })

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")

  log?.(`Claude response: ${text.length} chars`)

  // Parse JSON array from response
  const trimmed = text.trim()
  let parsed: JsonValue | undefined

  const candidates = [trimmed]
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) candidates.push(fencedMatch[1].trim())
  const startArray = trimmed.indexOf("[")
  const endArray = trimmed.lastIndexOf("]")
  if (startArray >= 0 && endArray > startArray) {
    candidates.push(trimmed.slice(startArray, endArray + 1))
  }

  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate) as JsonValue
      break
    } catch {
      // try next
    }
  }

  if (!parsed) {
    throw new Error(`Could not parse candidate inputs from Claude response: ${trimmed.slice(0, 300)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array from Claude, got ${typeof parsed}`)
  }

  const results: CandidateResult[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const record = entry as Record<string, JsonValue>
    if ("input" in record) {
      results.push({
        input: record.input,
        notes: typeof record.notes === "string" ? record.notes : undefined,
      })
    } else {
      results.push({ input: entry })
    }
  }

  log?.(`Parsed ${results.length} candidate inputs`)
  return results
}

/**
 * Generate candidate inputs WITH a start URL for live browser extraction.
 * Claude figures out which URL to navigate to for each input based on the workflow domain.
 */
export async function generateLiveExtractionCandidates(
  workflow: WorkflowRecord,
  count: number,
  log?: (line: string) => void,
): Promise<LiveExtractionCandidate[]> {
  const schemaSection = workflow.schema
    ? `Input parameters:\n${stableStringify(workflow.schema.inputParameters as unknown as JsonValue)}\n\nOutput parameters:\n${stableStringify(workflow.schema.outputParameters as unknown as JsonValue)}`
    : "No schema discovered yet — infer reasonable input parameters from the workflow name and domain."

  const prompt = [
    `Workflow: ${workflow.workflowRef}`,
    `Domain: ${workflow.domain}`,
    `Level: ${workflow.level}`,
    workflow.description ? `Description: ${workflow.description}` : null,
    "",
    schemaSection,
    "",
    `Generate ${count} sample inputs for this workflow. For each input, also provide the exact URL a browser should navigate to in order to extract the expected output data.`,
    "Requirements:",
    "- Inputs must be public, deterministic, and accessible right now (no auth-gated or ephemeral data)",
    "- The startUrl must be the real, publicly accessible page where the output data can be found",
    "- Cover diverse cases: typical usage, edge cases, boundary values",
    "",
    "Return ONLY a JSON array. Each item must have this exact shape:",
    '{"input": { ... }, "startUrl": "https://...", "notes": "short reason"}',
    "",
    "No markdown fences, no explanation — raw JSON array only.",
  ]
    .filter((line) => line !== null)
    .join("\n")

  log?.(`Generating ${count} live-extraction candidates via Claude API`)

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  })

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")

  log?.(`Claude response: ${text.length} chars`)

  const trimmed = text.trim()
  let parsed: JsonValue | undefined

  const tryParse = [trimmed]
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) tryParse.push(fencedMatch[1].trim())
  const startArray = trimmed.indexOf("[")
  const endArray = trimmed.lastIndexOf("]")
  if (startArray >= 0 && endArray > startArray) {
    tryParse.push(trimmed.slice(startArray, endArray + 1))
  }

  for (const candidate of tryParse) {
    try {
      parsed = JSON.parse(candidate) as JsonValue
      break
    } catch {
      // try next
    }
  }

  if (!parsed || !Array.isArray(parsed)) {
    throw new Error(`Could not parse live-extraction candidates: ${trimmed.slice(0, 300)}`)
  }

  const results: LiveExtractionCandidate[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const record = entry as Record<string, JsonValue>
    const startUrl = typeof record.startUrl === "string" ? record.startUrl : undefined
    if (!startUrl) continue
    results.push({
      input: "input" in record ? record.input : entry,
      startUrl,
      notes: typeof record.notes === "string" ? record.notes : undefined,
    })
  }

  log?.(`Parsed ${results.length} live-extraction candidates`)
  return results
}

/**
 * Use Claude with computer-use style tool loop to extract structured data from a page snapshot.
 * The agent-browser provides the page content; Claude extracts based on the output schema.
 */
export async function extractDataWithClaude(
  pageSnapshot: string,
  pageUrl: string,
  outputSchema: JsonValue,
  log?: (line: string) => void,
): Promise<JsonValue> {
  const prompt = [
    `You are extracting structured data from a web page snapshot.`,
    ``,
    `Page URL: ${pageUrl}`,
    ``,
    `Expected output schema:`,
    stableStringify(outputSchema),
    ``,
    `Page content snapshot:`,
    pageSnapshot,
    ``,
    `Extract the data matching the output schema from this page. Return ONLY raw JSON matching the schema. No explanation, no markdown fences.`,
  ].join("\n")

  log?.(`Asking Claude to extract data from ${pageUrl}`)

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  })

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")

  const trimmed = text.trim()
  const tryParse = [trimmed]
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) tryParse.push(fencedMatch[1].trim())
  const startObj = trimmed.indexOf("{")
  const endObj = trimmed.lastIndexOf("}")
  if (startObj >= 0 && endObj > startObj) {
    tryParse.push(trimmed.slice(startObj, endObj + 1))
  }
  const startArr = trimmed.indexOf("[")
  const endArr = trimmed.lastIndexOf("]")
  if (startArr >= 0 && endArr > startArr) {
    tryParse.push(trimmed.slice(startArr, endArr + 1))
  }

  for (const candidate of tryParse) {
    try {
      return JSON.parse(candidate) as JsonValue
    } catch {
      // try next
    }
  }

  throw new Error(`Could not parse extraction result: ${trimmed.slice(0, 300)}`)
}
