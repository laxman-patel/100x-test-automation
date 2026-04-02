import { NextResponse } from "next/server"
import { clearWorkflowData } from "@/src/lib/workflows"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  try {
    const workflow = await clearWorkflowData(id)
    return NextResponse.json({ workflow })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear workflow data" },
      { status: 500 },
    )
  }
}
