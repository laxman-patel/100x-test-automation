import { NextResponse } from "next/server"
import { listSiteAuthDomains } from "@/src/server/site-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const domains = await listSiteAuthDomains()
  return NextResponse.json({ domains })
}
