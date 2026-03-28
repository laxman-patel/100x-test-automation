import { NextResponse } from "next/server"
import { createRunJob } from "@/src/server/run-jobs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface RunRequestBody {
  scenarioPath?: unknown
  session?: unknown
  extensionPath?: unknown
}

export async function POST(request: Request) {
  let body: RunRequestBody

  try {
    body = (await request.json()) as RunRequestBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (typeof body.scenarioPath !== "string" || body.scenarioPath.trim().length === 0) {
    return NextResponse.json({ error: "scenarioPath is required" }, { status: 400 })
  }

  const normalizedScenario = body.scenarioPath.replaceAll("\\", "/").trim()
  if (!normalizedScenario.startsWith("scenarios/") || normalizedScenario.includes("..")) {
    return NextResponse.json({ error: "scenarioPath must point to scenarios/*.json" }, { status: 400 })
  }

  const session = typeof body.session === "string" && body.session.trim().length > 0 ? body.session.trim() : undefined
  const extensionPath =
    typeof body.extensionPath === "string" && body.extensionPath.trim().length > 0
      ? body.extensionPath.trim()
      : undefined

  const job = createRunJob({
    scenarioPath: normalizedScenario,
    session,
    extensionPath,
  })

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      scenarioPath: job.scenarioPath,
      session: job.session,
      startedAt: job.startedAt,
    },
  })
}
