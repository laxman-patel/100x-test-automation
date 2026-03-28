import { NextResponse } from "next/server"
import { addCustomWorkflow, listWorkflows } from "@/src/lib/workflows"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface WorkflowCreateBody {
  domain?: unknown
  level?: unknown
  workflowName?: unknown
  description?: unknown
  status?: unknown
}

export async function GET() {
  const workflows = await listWorkflows()
  return NextResponse.json({ workflows })
}

export async function POST(request: Request) {
  let body: WorkflowCreateBody

  try {
    body = (await request.json()) as WorkflowCreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  try {
    const workflow = await addCustomWorkflow({
      domain: typeof body.domain === "string" ? body.domain : "",
      level: typeof body.level === "string" ? body.level : "L0",
      workflowName: typeof body.workflowName === "string" ? body.workflowName : "",
      description: typeof body.description === "string" ? body.description : "",
      status: typeof body.status === "string" ? body.status : "Exists",
    })

    return NextResponse.json({ workflow })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create workflow"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
