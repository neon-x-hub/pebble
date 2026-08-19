import { readFile } from "node:fs/promises";
import type { ClusterConfig, NodeConfig, ProtocolLimits } from "@pebbl/types";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const val = obj[key];
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`${ctx}: "${key}" must be a non-empty string`);
  }
  return val;
}

function requirePositiveNumber(obj: Record<string, unknown>, key: string, ctx: string): number {
  const val = obj[key];
  if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
    throw new Error(`${ctx}: "${key}" must be a positive number`);
  }
  return val;
}

function validateLimits(raw: unknown, ctx: string): ProtocolLimits {
  if (!isRecord(raw)) throw new Error(`${ctx}.limits must be an object`);
  return {
    maxMessageBytes:        requirePositiveNumber(raw, "maxMessageBytes",        ctx + ".limits"),
    maxMutationsPerMessage: requirePositiveNumber(raw, "maxMutationsPerMessage", ctx + ".limits"),
    maxRangesPerRequest:    requirePositiveNumber(raw, "maxRangesPerRequest",    ctx + ".limits"),
    maxKeyBytes:            requirePositiveNumber(raw, "maxKeyBytes",            ctx + ".limits"),
    maxValueBytes:          requirePositiveNumber(raw, "maxValueBytes",          ctx + ".limits"),
  };
}

function validateNodes(raw: unknown, ctx: string): Record<string, NodeConfig> {
  if (!isRecord(raw)) throw new Error(`${ctx}.nodes must be an object`);
  const result: Record<string, NodeConfig> = {};
  for (const [nodeId, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) throw new Error(`${ctx}.nodes.${nodeId} must be an object`);
    const publicKey = entry["publicKey"];
    if (typeof publicKey !== "string" || publicKey.length === 0) {
      throw new Error(`${ctx}.nodes.${nodeId}.publicKey must be a non-empty string`);
    }
    result[nodeId] = { publicKey };
  }
  if (Object.keys(result).length === 0) {
    throw new Error(`${ctx}.nodes must contain at least one node`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a raw (parsed JSON) value as a ClusterConfig.
 * Throws a descriptive Error on any validation failure.
 *
 * NOTE: There is no `clients` field in ClusterConfig. Client access is
 * managed via signed credentials issued by the moderator. Adding or removing
 * a client does not require touching this config.
 */
export function validateConfig(raw: unknown): ClusterConfig {
  const ctx = "ClusterConfig";
  if (!isRecord(raw)) throw new Error(`${ctx} must be a JSON object`);

  const clusterId         = requireString(raw, "clusterId", ctx);
  const moderatorPublicKey = requireString(raw, "moderatorPublicKey", ctx);
  const nodes             = validateNodes(raw["nodes"], ctx);
  const gossipIntervalMs  = requirePositiveNumber(raw, "gossipIntervalMs", ctx);
  const pingIntervalMs    = requirePositiveNumber(raw, "pingIntervalMs", ctx);
  const unhealthyThresholdMs = requirePositiveNumber(raw, "unhealthyThresholdMs", ctx);
  const gossipPort        = requirePositiveNumber(raw, "gossipPort", ctx);
  const clientPort        = requirePositiveNumber(raw, "clientPort", ctx);
  const limits            = validateLimits(raw["limits"], ctx);

  return {
    clusterId,
    moderatorPublicKey,
    nodes,
    gossipIntervalMs,
    pingIntervalMs,
    unhealthyThresholdMs,
    gossipPort,
    clientPort,
    limits,
  };
}

/**
 * Read and validate a cluster config JSON file.
 * @param path - Absolute or relative path to `cluster.json`
 */
export async function loadConfig(path: string): Promise<ClusterConfig> {
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse config file at "${path}": ${String(err)}`);
  }
  return validateConfig(parsed);
}
