import { NextResponse } from "next/server"
import { getRunJob } from "@/src/server/run-jobs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const job = getRunJob(id)

  if (!job) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 })
  }

  return NextResponse.json({ job })
}
