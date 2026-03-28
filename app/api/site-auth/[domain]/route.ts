import { NextResponse } from "next/server"
import {
  cancelSiteAuthCapture,
  finishSiteAuthCapture,
  getSiteAuthStatus,
  startSiteAuthCapture,
} from "@/src/server/site-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface SiteAuthBody {
  action?: unknown
  startUrl?: unknown
}

export async function GET(_request: Request, context: { params: Promise<{ domain: string }> }) {
  const { domain } = await context.params
  const status = await getSiteAuthStatus(decodeURIComponent(domain))
  return NextResponse.json({ siteAuth: status })
}

export async function POST(request: Request, context: { params: Promise<{ domain: string }> }) {
  const { domain: rawDomain } = await context.params
  const domain = decodeURIComponent(rawDomain)

  let body: SiteAuthBody = {}
  try {
    body = (await request.json()) as SiteAuthBody
  } catch {
    // allow empty body
  }

  const action = typeof body.action === "string" ? body.action : "start"

  try {
    let siteAuth
    if (action === "finish") {
      siteAuth = await finishSiteAuthCapture(domain)
    } else if (action === "cancel") {
      siteAuth = await cancelSiteAuthCapture(domain)
    } else {
      const startUrl = typeof body.startUrl === "string" ? body.startUrl : `https://${domain}`
      siteAuth = await startSiteAuthCapture(domain, startUrl)
    }
    return NextResponse.json({ siteAuth })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Site auth capture failed"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
