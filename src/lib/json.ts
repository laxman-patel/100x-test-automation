export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

// Convert single-quoted JSON-like text to valid double-quoted JSON.
// Handles: {'key': 'value'} → {"key": "value"}
function singleToDoubleQuotes(text: string): string {
  // Replace single-quoted keys/values with double-quoted ones.
  // This is a best-effort heuristic for LLM output that uses single quotes.
  return text.replace(/'/g, '"')
}

// Replace common unicode quote characters with ASCII quotes
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // smart single quotes → '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')   // smart double quotes → "
}

export function parseJsonFromText(text: string): JsonValue {
  const trimmed = normalizeQuotes(text.trim())
  if (!trimmed) {
    throw new Error("Response was empty.")
  }

  const candidates = [trimmed]

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) {
    candidates.push(fencedMatch[1].trim())
  }

  const startObject = trimmed.indexOf("{")
  const endObject = trimmed.lastIndexOf("}")
  if (startObject >= 0 && endObject > startObject) {
    candidates.push(trimmed.slice(startObject, endObject + 1))
  }

  const startArray = trimmed.indexOf("[")
  const endArray = trimmed.lastIndexOf("]")
  if (startArray >= 0 && endArray > startArray) {
    candidates.push(trimmed.slice(startArray, endArray + 1))
  }

  // Try each candidate as-is first
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as JsonValue
    } catch {
      // try next candidate
    }
  }

  // Retry with single→double quote conversion (common in rendered DOM text)
  for (const candidate of candidates) {
    try {
      return JSON.parse(singleToDoubleQuotes(candidate)) as JsonValue
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Could not parse JSON from response: ${trimmed.slice(0, 500)}`)
}

export function normalizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJson(entry))
  }

  if (value && typeof value === "object") {
    const sorted = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .reduce<Record<string, JsonValue>>((acc, [key, entry]) => {
        acc[key] = normalizeJson(entry)
        return acc
      }, {})

    return sorted
  }

  return value
}

export function stableStringify(value: JsonValue): string {
  return JSON.stringify(normalizeJson(value), null, 2)
}

export function jsonDeepEqual(left: JsonValue, right: JsonValue): boolean {
  return stableStringify(left) === stableStringify(right)
}
