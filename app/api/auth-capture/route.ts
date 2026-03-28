import { NextResponse } from "next/server"
import { cancelAuthCapture, finishAuthCapture, getAuthCaptureStatus, startAuthCapture } from "@/src/server/auth-capture"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface AuthCaptureBody {
  action?: unknown
}

export async function GET() {
  const status = await getAuthCaptureStatus()
  return NextResponse.json({ authCapture: status })
}

export async function POST(request: Request) {
  let body: AuthCaptureBody = {}

  try {
    body = (await request.json()) as AuthCaptureBody
  } catch {
    // allow empty body
  }

  const action = typeof body.action === "string" ? body.action : "start"

  try {
    const authCapture =
      action === "finish"
        ? await finishAuthCapture()
        : action === "cancel"
          ? await cancelAuthCapture()
          : await startAuthCapture()

    return NextResponse.json({ authCapture })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication capture failed"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
