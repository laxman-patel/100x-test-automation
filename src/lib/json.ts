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

/**
 * Check that every key/value in `expected` exists in `actual`.
 * Extra keys in `actual` are ignored. Arrays must match length and each element is subset-matched.
 */
export function jsonSubsetMatch(actual: JsonValue, expected: JsonValue): boolean {
  if (expected === null || typeof expected !== "object") {
    if (actual === null || typeof actual !== "object") {
      // Coerce number/string for loose comparison (e.g. "42" vs 42)
      // eslint-disable-next-line eqeqeq
      return actual == expected
    }
    return false
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false
    return expected.every((item, i) => jsonSubsetMatch(actual[i], item))
  }

  // expected is an object
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false
  const actualObj = actual as Record<string, JsonValue>
  const expectedObj = expected as Record<string, JsonValue>
  return Object.keys(expectedObj).every((key) =>
    key in actualObj && jsonSubsetMatch(actualObj[key], expectedObj[key]),
  )
}

export type FieldDiffEntry = {
  path: string
  expected?: JsonValue
  actual?: JsonValue
  status: "match" | "mismatch" | "missing" | "extra"
}

/**
 * Produce a field-level diff between actual and expected JSON values.
 * Walks the expected structure; extra keys in actual are reported as "extra".
 */
export function fieldDiff(actual: JsonValue, expected: JsonValue, path = "$"): FieldDiffEntry[] {
  if (expected === null || typeof expected !== "object") {
    // eslint-disable-next-line eqeqeq
    const match = actual == expected
    return [{ path, expected, actual, status: match ? "match" : "mismatch" }]
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return [{ path, expected, actual, status: "mismatch" }]
    }
    const entries: FieldDiffEntry[] = []
    const maxLen = Math.max(expected.length, actual.length)
    for (let i = 0; i < maxLen; i++) {
      if (i >= expected.length) {
        entries.push({ path: `${path}[${i}]`, actual: actual[i], status: "extra" })
      } else if (i >= actual.length) {
        entries.push({ path: `${path}[${i}]`, expected: expected[i], status: "missing" })
      } else {
        entries.push(...fieldDiff(actual[i], expected[i], `${path}[${i}]`))
      }
    }
    return entries
  }

  // expected is object
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    return [{ path, expected, actual, status: "mismatch" }]
  }

  const actualObj = actual as Record<string, JsonValue>
  const expectedObj = expected as Record<string, JsonValue>
  const entries: FieldDiffEntry[] = []

  for (const key of Object.keys(expectedObj)) {
    if (!(key in actualObj)) {
      entries.push({ path: `${path}.${key}`, expected: expectedObj[key], status: "missing" })
    } else {
      entries.push(...fieldDiff(actualObj[key], expectedObj[key], `${path}.${key}`))
    }
  }

  for (const key of Object.keys(actualObj)) {
    if (!(key in expectedObj)) {
      entries.push({ path: `${path}.${key}`, actual: actualObj[key], status: "extra" })
    }
  }

  return entries
}
