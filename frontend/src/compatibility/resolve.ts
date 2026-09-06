import type {Connection} from "@xyflow/react";
import type {NodeManifest} from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";
import {resolveSocket} from "./sockets";
import type { PlacedNode, Resolution } from "./types";
import { buildFieldMapping } from "./fieldMapping";

//try to pull properties from schemaJson, if not found return null, pls dont throw
function parseProps(schemaJson:string): Record<string, {type?:string}> | null{
  try {
    const parsed = JSON.parse(schemaJson);
    return parsed?.properties ?? null;
  } catch{
    return null;
  }
}

//lucky case where the types are compatible just jumbled
function sameShape(a: string, b: string): boolean {

  const pa = parseProps(a);
  const pb = parseProps(b);
  if (!pa || !pb) return false;

  const ka = Object.keys(pa).sort();
  const kb = Object.keys(pb).sort();

  if (ka.length !== kb.length) return false;
  return ka.every((k,i) => k === kb[i] && pa[k]?.type === pb[k].type);
}

export function resolveCompatibility(
  connection: Connection,
  nodes: PlacedNode[],
  registry: NodeManifest[]
): Resolution{

  // get exact from and to sockets from source/target .Handle from react flow
  const from = connection.sourceHandle ?
              resolveSocket(connection.source, connection.sourceHandle, "source", nodes, registry)
              : null;
  const to = connection.targetHandle ?
              resolveSocket(connection.target, connection.targetHandle, "target", nodes, registry)
              : null;

  // if either doesn't resolve it's a blocked connection boo hoo
  if ( !from || !to ){
    return {
      kind: "blocked",
      reason: "One or both sockets could not be resolved against the registry.",
      fromType: from?.contentType ?? "unknown",
      toType: to?.contentType ?? "unknown"
    };
  }

  // lucky case: compatible shapes, jumbled or otherwise
  if (from.contentType === to.contentType) {
    // if either has an empty schema just let the matching from/to suffice
    const eitherBlob = from.schemaJson === "" || to.schemaJson === "";
    //if schemas are available, check shape
    if (eitherBlob || sameShape(from.schemaJson, to.schemaJson)) {
      return {
        kind: "direct"
      }
    }
    const { mapping, unmappedSource, unmappedTarget } =
      buildFieldMapping(from.schemaJson, to.schemaJson);
    return { kind: "shapeAdapter", mapping, unmappedSource, unmappedTarget };
  }
// ==== this is where all other conversions for the Compatibility Engine go ==========
// ====================================================================================
  return {
    kind: "blocked",
    reason: `No conversion path exists between ${from.contentType} and ${to.contentType}.`,
    fromType: from.contentType,
    toType: to.contentType
  };
}
