import { NextResponse } from "next/server"
import { createWorkflowJob } from "@/src/server/workflow-jobs"
import { discoverWorkflowSchema } from "@/src/server/workflow-automation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  const job = createWorkflowJob({
    workflowId: id,
    kind: "discover-schema",
    run: async (log) => {
      const workflow = await discoverWorkflowSchema(id, log)
      return {
        workflowId: workflow.id,
        schemaDiscoveredAt: workflow.schema?.discoveredAt,
      }
    },
  })

  return NextResponse.json({ job })
}
