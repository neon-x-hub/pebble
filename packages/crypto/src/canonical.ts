/**
 * Canonical JSON encoding.
 *
 * Produces a deterministic byte representation of any plain object by:
 *   1. Recursively sorting object keys alphabetically
 *   2. Serializing to compact JSON (no whitespace)
 *   3. Encoding as UTF-8
 *
 * This is the foundation of every signature in Pebble. Both mutation signing
 * and credential signing funnel through this function, ensuring two nodes
 * always produce identical bytes for the same logical value.
 *
 * Rules:
 *   - Object keys are sorted at every level (not just the top level)
 *   - Arrays preserve their order (reordering array elements changes the encoding)
 *   - `null` values are preserved
 *   - Numbers are not coerced
 *   - `undefined` values are omitted (standard JSON.stringify behaviour)
 */

/**
 * A JSON-serialisable value. Defined explicitly so TypeScript catches attempts
 * to pass non-serialisable things (functions, class instances, etc.).
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Recursively sort all object keys and return a plain object ready for
 * JSON.stringify. Arrays are traversed but their element order is preserved.
 */
function sortKeys(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const sorted: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(value).sort()) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    sorted[key] = sortKeys(value[key]!);
  }
  return sorted;
}

/**
 * Canonically encode a plain JSON-serialisable object to a UTF-8 Buffer.
 *
 * @param fields - Any plain object. Must not contain non-JSON-serialisable
 *                 values (functions, class instances, etc.).
 * @returns A Buffer containing the canonical UTF-8 JSON representation.
 *
 * @example
 * // Property insertion order does not matter:
 * canonicalEncode({ b: 1, a: 2 }) // → Buffer for '{"a":2,"b":1}'
 * canonicalEncode({ a: 2, b: 1 }) // → same Buffer
 */
export function canonicalEncode(fields: Record<string, JsonValue>): Buffer {
  return Buffer.from(JSON.stringify(sortKeys(fields as JsonValue)), "utf8");
}
