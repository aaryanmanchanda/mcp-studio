import type { NodeManifest } from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";
import { CONVERTER_WILDCARD, type PlacedNode, type ResolvedSocket} from "./types";

export function resolveSocket(
  nodeId: string,
  handleId: string,
  side: "source"|"target",
  nodes: PlacedNode[],
  registry: NodeManifest[],
): ResolvedSocket | null{
  // resolve nodeId and manifestId for fetch
  const node = nodes.find((n)=>n.id === nodeId)
  if (!node) return null;
  const manifest = registry.find((m)=>m.id === node.data.manifestId);
  if (!manifest) return null;
  // pick socket list based on side
  const sockets = (side === "source") ? manifest.outputs : manifest.inputs;
  // resolve socket
  const socket = sockets.find((s)=>s.name===handleId)
  if (!socket) return null;

  // for converter blocks currently defined as CONVERTER_WILDCARD ( to be added later)
  let contentType = socket.contentType;
  if (contentType === CONVERTER_WILDCARD){
    const hop = node.data.hop;
    if (!hop) return null;
    contentType = (side==="target") ? hop.from : hop.to; // each converter node carries config hop(to,from)
  }

  return {nodeId, handleId, contentType, schemaJson: socket.schemaJson};
}
