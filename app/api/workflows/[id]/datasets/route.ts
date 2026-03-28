import { NextResponse } from "next/server"
import { createWorkflowJob } from "@/src/server/workflow-jobs"
import { generateWorkflowDatasets, generateWorkflowDatasetsLive } from "@/src/server/workflow-automation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface GenerateBody {
  count?: unknown
  mode?: unknown
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  let body: GenerateBody = {}

  try {
    body = (await request.json()) as GenerateBody
  } catch {
    // allow empty body
  }

  const requestedCount = typeof body.count === "number" && Number.isFinite(body.count) ? body.count : 3
  const mode = body.mode === "live-extraction" ? "live-extraction" : "extension"

  const job = createWorkflowJob({
    workflowId: id,
    kind: mode === "live-extraction" ? "generate-datasets-live" : "generate-datasets",
    run: async (log) => {
      const generate = mode === "live-extraction" ? generateWorkflowDatasetsLive : generateWorkflowDatasets
      const workflow = await generate(id, requestedCount, log)
      return {
        workflowId: workflow.id,
        datasetCount: workflow.datasets.length,
      }
    },
  })

  return NextResponse.json({ job })
}
