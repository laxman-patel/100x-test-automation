import { NextResponse } from "next/server"
import { createWorkflowJob } from "@/src/server/workflow-jobs"
import { runWorkflowTests } from "@/src/server/workflow-automation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface RunBody {
  datasetId?: unknown
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  let body: RunBody = {}

  try {
    body = (await request.json()) as RunBody
  } catch {
    // allow empty body
  }

  const datasetId = typeof body.datasetId === "string" && body.datasetId.trim() ? body.datasetId.trim() : undefined

  const job = createWorkflowJob({
    workflowId: id,
    kind: "run-tests",
    run: async (log) => {
      return await runWorkflowTests(id, datasetId, log)
    },
  })

  return NextResponse.json({ job })
}
