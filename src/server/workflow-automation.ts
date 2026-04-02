import { AgentBrowserClient } from "@/src/lib/agentBrowser"
import { extractDataWithClaude, generateCandidateInputs, generateLiveExtractionCandidates } from "@/src/lib/claude-generate"
import { ExtensionAgentSession } from "@/src/lib/extension-agent"
import { jsonSubsetMatch, fieldDiff, parseJsonFromText, stableStringify, type JsonValue } from "@/src/lib/json"
import {
  createGeneratedDataset,
  getWorkflowById,
  replaceWorkflowDatasets,
  saveWorkflowSchema,
  updateWorkflowDatasetRun,
  type WorkflowDatasetRecord,
  type WorkflowRecord,
} from "@/src/lib/workflows"
import { assertNoActiveAuthCapture } from "@/src/server/auth-capture"
import { buildSiteAuthReplayScript, loadSiteAuth } from "@/src/server/site-auth"

function formatInputForPrompt(input: JsonValue): string {
  return stableStringify(input)
}

function buildSchemaPrompt(workflow: WorkflowRecord): string {
  return [
    `@workflow:${workflow.workflowRef}`,
    `List every input parameter and every output parameter for this workflow.`,
    `Return a single RAW JSON object (no markdown, no explanation) with this exact structure:`,
    `{"inputParameters": [{"name": "...", "type": "string|number|boolean|object|array", "required": true/false, "description": "..."}], "outputParameters": [{"name": "...", "type": "...", "required": true/false, "description": "..."}]}`,
    `IMPORTANT: Include ALL fields for every parameter — do not abbreviate, truncate, or use "..." placeholders. Expand every nested field. Output the complete JSON.`,
  ].join(" ")
}

function buildCandidatePrompt(workflow: WorkflowRecord, count: number): string {
  const schemaHint = workflow.schema
    ? `The workflow input parameters are ${stableStringify(workflow.schema.inputParameters as unknown as JsonValue)}.`
    : "Infer the input parameters from the workflow."

  return [
    `@workflow:${workflow.workflowRef} ${schemaHint}`,
    `Generate ${count} public, deterministic sample input payloads that can be executed right now for this workflow.`,
    "Return RAW JSON only as an array.",
    "Each array item must use this exact shape:",
    `{"input": { ... }, "notes": "short reason why this input is stable"}`,
  ].join(" ")
}

function buildExecutionPrompt(workflow: WorkflowRecord, input: JsonValue): string {
  return [
    `@workflow:${workflow.workflowRef}`,
    "execute the workflow for these input parameters.",
    `RAW_INPUT_JSON=${formatInputForPrompt(input)}`,
    "Give RAW JSON output only.",
  ].join(" ")
}

function asCandidateInputs(value: JsonValue): Array<{ input: JsonValue; notes?: string }> {
  if (Array.isArray(value)) {
    const candidates: Array<{ input: JsonValue; notes?: string }> = []

    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue
      }

      const record = entry as Record<string, JsonValue>
      if ("input" in record) {
        candidates.push({
          input: record.input,
          notes: typeof record.notes === "string" ? record.notes : undefined,
        })
        continue
      }

      candidates.push({
        input: entry,
      })
    }

    return candidates
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, JsonValue>
    if (Array.isArray(record.datasets)) {
      return asCandidateInputs(record.datasets)
    }
    if (Array.isArray(record.samples)) {
      return asCandidateInputs(record.samples)
    }
  }

  return []
}

export async function discoverWorkflowSchema(workflowId: string, log?: (line: string) => void): Promise<WorkflowRecord> {
  await assertNoActiveAuthCapture()
  const workflow = await getWorkflowById(workflowId)
  const prompt = buildSchemaPrompt(workflow)
  const session = new ExtensionAgentSession()

  try {
    await session.start(log)
    const response = await session.prompt(prompt, log)
    log?.(`Raw response (${response.responseText.length} chars): ${response.responseText.slice(0, 500)}`)
    const parsed = parseJsonFromText(response.responseText)
    log?.("Schema response parsed as JSON")
    return await saveWorkflowSchema(workflowId, {
      prompt,
      rawResponse: response.responseText,
      parsed,
    })
  } finally {
    await session.close()
  }
}

export async function generateWorkflowDatasets(
  workflowId: string,
  count = 3,
  log?: (line: string) => void,
): Promise<WorkflowRecord> {
  await assertNoActiveAuthCapture()
  let workflow = await getWorkflowById(workflowId)

  // Phase 1: Discover schema via extension if missing
  if (!workflow.schema) {
    log?.("No saved schema found. Discovering schema first via extension agent.")
    const schemaSession = new ExtensionAgentSession()
    try {
      await schemaSession.start(log)
      const schemaResponse = await schemaSession.prompt(buildSchemaPrompt(workflow), log)
      const parsedSchema = parseJsonFromText(schemaResponse.responseText)
      workflow = await saveWorkflowSchema(workflowId, {
        prompt: buildSchemaPrompt(workflow),
        rawResponse: schemaResponse.responseText,
        parsed: parsedSchema,
      })
    } finally {
      await schemaSession.close()
    }
  }

  // Phase 2: Generate candidate inputs via Claude API (no browser needed)
  const requestCount = Math.max(count + 2, 5)
  const candidates = await generateCandidateInputs(workflow, requestCount, log)

  if (candidates.length === 0) {
    throw new Error("Claude did not return any candidate input payloads.")
  }

  // Phase 3: Execute each candidate via extension agent to capture expected output
  const session = new ExtensionAgentSession()
  try {
    await session.start(log)

    const generated: WorkflowDatasetRecord[] = []
    for (const candidate of candidates) {
      if (generated.length >= count) break

      const executionPrompt = buildExecutionPrompt(workflow, candidate.input)
      log?.(`Executing sample dataset ${generated.length + 1}/${count}`)

      try {
        const executionResponse = await session.prompt(executionPrompt, log)
        const parsedOutput = parseJsonFromText(executionResponse.responseText)
        generated.push(
          createGeneratedDataset({
            payload: candidate.input,
            expectedOutput: parsedOutput,
            candidatePrompt: `[Claude API] Generated ${requestCount} candidates`,
            executionPrompt,
            rawExecutionResponse: executionResponse.responseText,
            notes: candidate.notes,
          }),
        )
      } catch (error) {
        log?.(`Dataset candidate failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (generated.length === 0) {
      throw new Error("No datasets could be generated from the candidate inputs.")
    }

    if (generated.length < count) {
      log?.(`Generated ${generated.length} datasets instead of ${count}.`)
    }

    return await replaceWorkflowDatasets(workflowId, generated)
  } finally {
    await session.close()
  }
}

/**
 * Generate datasets by navigating to real websites with agent-browser and extracting
 * structured data using Claude, rather than asking the extension to execute the workflow.
 */
export async function generateWorkflowDatasetsLive(
  workflowId: string,
  count = 3,
  log?: (line: string) => void,
): Promise<WorkflowRecord> {
  await assertNoActiveAuthCapture()
  let workflow = await getWorkflowById(workflowId)

  // Phase 1: Discover schema via extension if missing
  if (!workflow.schema) {
    log?.("No saved schema. Discovering schema first via extension agent.")
    const schemaSession = new ExtensionAgentSession()
    try {
      await schemaSession.start(log)
      const schemaResponse = await schemaSession.prompt(buildSchemaPrompt(workflow), log)
      const parsedSchema = parseJsonFromText(schemaResponse.responseText)
      workflow = await saveWorkflowSchema(workflowId, {
        prompt: buildSchemaPrompt(workflow),
        rawResponse: schemaResponse.responseText,
        parsed: parsedSchema,
      })
    } finally {
      await schemaSession.close()
    }
  }

  const outputSchema = workflow.schema?.outputParameters ?? workflow.schema?.parsed
  if (!outputSchema) {
    throw new Error("No output schema available. Cannot extract data without knowing what to look for.")
  }

  // Phase 2: Generate candidates with start URLs via Claude API
  const requestCount = Math.max(count + 2, 5)
  const candidates = await generateLiveExtractionCandidates(workflow, requestCount, log)

  if (candidates.length === 0) {
    throw new Error("Claude did not return any live-extraction candidates.")
  }

  // Phase 3: For each candidate, navigate with agent-browser and extract data with Claude
  const browser = new AgentBrowserClient({ session: `live-extract-${workflowId}`, headed: true, timeoutMs: 120_000 })
  const generated: WorkflowDatasetRecord[] = []

  // Load site auth for this workflow's domain
  const siteAuth = await loadSiteAuth(workflow.domain)
  if (siteAuth) {
    log?.(`Loaded site auth for ${workflow.domain} (${siteAuth.cookies.length} cookies, ${Object.keys(siteAuth.localStorage).length} localStorage keys)`)
  } else {
    log?.(`No site auth found for ${workflow.domain} — proceeding without authentication`)
  }

  try {
    for (const candidate of candidates) {
      if (generated.length >= count) break

      log?.(`[${generated.length + 1}/${count}] Navigating to ${candidate.startUrl}`)

      try {
        // Navigate to the page — first open the domain root to establish a session,
        // then navigate via JS so that non-2xx responses don't abort the run.
        const domainUrl = new URL(candidate.startUrl).origin
        const seedResult = await browser.open(domainUrl)
        if (seedResult.exitCode !== 0) {
          log?.(`Failed to open domain root ${domainUrl}: ${seedResult.stderr}`)
          // Try the direct URL as fallback
          const directResult = await browser.open(candidate.startUrl)
          if (directResult.exitCode !== 0) {
            log?.(`Failed to open ${candidate.startUrl}: ${directResult.stderr}`)
            continue
          }
        } else {
          // Navigate to the actual URL via JS — this doesn't fail on non-2xx status codes
          await browser.eval(`window.location.href = ${JSON.stringify(candidate.startUrl)}; 'navigating'`)
          await browser.wait(3000)
        }

        // Replay site auth (cookies via agent-browser, localStorage via eval) then reload
        if (siteAuth) {
          for (const cookie of siteAuth.cookies) {
            if (!cookie?.name) continue
            const cookieArgs = ["cookies", "set", cookie.name, cookie.value]
            if (cookie.domain) cookieArgs.push("--domain", cookie.domain)
            if (cookie.path) cookieArgs.push("--path", cookie.path)
            if (cookie.httpOnly) cookieArgs.push("--httpOnly")
            if (cookie.secure) cookieArgs.push("--secure")
            if (cookie.sameSite) cookieArgs.push("--sameSite", cookie.sameSite)
            if (cookie.expires) cookieArgs.push("--expires", String(cookie.expires))
            try {
              await browser.raw(cookieArgs)
            } catch {
              // ignore partial cookie failures
            }
          }
          await browser.eval(buildSiteAuthReplayScript(siteAuth))
          // Reload to apply auth
          await browser.eval("location.reload(); 'reloaded'")
          log?.("Replayed site auth and reloaded page")
        }

        // Wait for page to load
        await browser.wait(3000)

        // Take a snapshot of the page content
        const snapshotResult = await browser.snapshot(false)
        if (snapshotResult.exitCode !== 0) {
          log?.(`Failed to snapshot ${candidate.startUrl}: ${snapshotResult.stderr}`)
          continue
        }

        const pageSnapshot = snapshotResult.stdout

        // If snapshot is too short, page probably didn't load — try interactive snapshot
        if (pageSnapshot.length < 200) {
          log?.("Static snapshot too short, trying interactive snapshot")
          const interactiveSnap = await browser.snapshot(true)
          if (interactiveSnap.exitCode === 0 && interactiveSnap.stdout.length > pageSnapshot.length) {
            // use the better one
            const extractedOutput = await extractDataWithClaude(
              interactiveSnap.stdout,
              candidate.startUrl,
              outputSchema as JsonValue,
              log,
            )

            generated.push(
              createGeneratedDataset({
                source: "live-extraction",
                payload: candidate.input,
                expectedOutput: extractedOutput,
                candidatePrompt: `[Claude API] Generated ${requestCount} live-extraction candidates`,
                executionPrompt: `Navigated to ${candidate.startUrl}, extracted via Claude`,
                rawExecutionResponse: interactiveSnap.stdout.slice(0, 5000),
                notes: candidate.notes,
              }),
            )
            log?.(`Dataset ${generated.length} extracted from ${candidate.startUrl}`)
            continue
          }
        }

        // Extract structured data from snapshot using Claude
        const extractedOutput = await extractDataWithClaude(
          pageSnapshot,
          candidate.startUrl,
          outputSchema as JsonValue,
          log,
        )

        generated.push(
          createGeneratedDataset({
            source: "live-extraction",
            payload: candidate.input,
            expectedOutput: extractedOutput,
            candidatePrompt: `[Claude API] Generated ${requestCount} live-extraction candidates`,
            executionPrompt: `Navigated to ${candidate.startUrl}, extracted via Claude`,
            rawExecutionResponse: pageSnapshot.slice(0, 5000),
            notes: candidate.notes,
          }),
        )
        log?.(`Dataset ${generated.length} extracted from ${candidate.startUrl}`)
      } catch (error) {
        log?.(`Live extraction failed for ${candidate.startUrl}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (generated.length === 0) {
      throw new Error("No datasets could be generated via live extraction.")
    }

    if (generated.length < count) {
      log?.(`Generated ${generated.length} datasets instead of ${count}.`)
    }

    return await replaceWorkflowDatasets(workflowId, generated)
  } finally {
    await browser.close().catch(() => {})
  }
}

export async function runWorkflowTests(
  workflowId: string,
  datasetId: string | undefined,
  log?: (line: string) => void,
): Promise<{
  workflow: WorkflowRecord
  summary: { total: number; passed: number; failed: number }
}> {
  await assertNoActiveAuthCapture()
  let workflow = await getWorkflowById(workflowId)
  const datasets = datasetId ? workflow.datasets.filter((dataset) => dataset.id === datasetId) : workflow.datasets

  if (datasets.length === 0) {
    throw new Error("No datasets available for this workflow.")
  }

  const session = new ExtensionAgentSession()
  let passed = 0
  let failed = 0

  try {
    await session.start(log)

    for (const dataset of datasets) {
      const executionPrompt = buildExecutionPrompt(workflow, dataset.input)
      log?.(`Running dataset ${dataset.id}`)

      try {
        const response = await session.prompt(executionPrompt, log)
        const actualOutput = parseJsonFromText(response.responseText)
        const success = jsonSubsetMatch(actualOutput, dataset.expectedOutput)

        let artifacts: { screenshotPath?: string; domSnapshot?: string } = {}
        if (!success) {
          artifacts = await session.captureFailureArtifacts(dataset.id)
        }

        workflow = await updateWorkflowDatasetRun(workflowId, dataset.id, {
          ranAt: new Date().toISOString(),
          success,
          actualOutput,
          rawResponse: response.responseText,
          diff: success ? undefined : fieldDiff(actualOutput, dataset.expectedOutput),
          ...(!success && artifacts.screenshotPath ? { screenshotPath: artifacts.screenshotPath } : {}),
          ...(!success && artifacts.domSnapshot ? { domSnapshot: artifacts.domSnapshot } : {}),
        })

        if (success) {
          passed += 1
          log?.(`Dataset ${dataset.id} passed`)
        } else {
          failed += 1
          log?.(`Dataset ${dataset.id} failed due to JSON mismatch`)
        }
      } catch (error) {
        let artifacts: { screenshotPath?: string; domSnapshot?: string } = {}
        try { artifacts = await session.captureFailureArtifacts(dataset.id) } catch { /* ignore */ }

        failed += 1
        workflow = await updateWorkflowDatasetRun(workflowId, dataset.id, {
          ranAt: new Date().toISOString(),
          success: false,
          rawResponse: "",
          error: error instanceof Error ? error.message : String(error),
          ...(artifacts.screenshotPath ? { screenshotPath: artifacts.screenshotPath } : {}),
          ...(artifacts.domSnapshot ? { domSnapshot: artifacts.domSnapshot } : {}),
        })
        log?.(`Dataset ${dataset.id} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } finally {
    await session.close()
  }

  return {
    workflow,
    summary: {
      total: datasets.length,
      passed,
      failed,
    },
  }
}
