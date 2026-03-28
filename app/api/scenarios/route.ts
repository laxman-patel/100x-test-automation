import { readdir } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function collectScenarioPaths(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const found: string[] = []

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await collectScenarioPaths(fullPath)
      found.push(...nested)
      continue
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      found.push(relative(process.cwd(), fullPath).replaceAll("\\", "/"))
    }
  }

  return found
}

export async function GET() {
  try {
    const scenariosDir = resolve(process.cwd(), "scenarios")
    const scenarios = (await collectScenarioPaths(scenariosDir)).sort((a, b) => a.localeCompare(b))
    return NextResponse.json({ scenarios })
  } catch {
    return NextResponse.json({ scenarios: [] })
  }
}
