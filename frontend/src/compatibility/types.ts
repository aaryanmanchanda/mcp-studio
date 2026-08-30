export const CONVERTER_WILDCARD = "application/x-mcpstudio-converter-wildcard"; //converter sockets declare this, real type comes from the node's hop (mirrors fixtures.go)

export interface ResolvedSocket{ //one end of a candidate wire, dug out to concrete values
  nodeId: string;
  handleId: string;
  contentType: string;
  schemaJson: string;
}

export interface FieldMapping { //one auto-matched field pair, 02-05 builds these
  from: string;
  to: string;
  via: "exact" | "caseInsensitive";
}

export interface ConverterHop { //one converter node to drop on the wire, 02-07 builds these
  nodeManifestId: string;
  from: string;
  to: string;
}

export interface PlacedNode { //the slice of a canvas node the resolver reads — keeps compatibility/ from importing the store
  id: string;
  data: { manifestId: string; hop?: { from: string; to: string } };
}

// "can these two sockets connect, and how?" — discriminated union on `kind`,
// so a switch over it can be made exhaustive and the compiler yells if a branch is missed.
// only direct + blocked are reachable this plan, 02-05 adds shapeAdapter, 02-07 converterPath.
export type Resolution =
  | {kind: "direct"} //exact match, wire it straight, no fuss
  | {
    kind: "shapeAdapter"; //same type diff schema — map the fields onto the wire
    mapping: FieldMapping[];
    unmappedSource: string[]; //fields with nowhere to go
    unmappedTarget: string[]; //fields left unfilled
  }
  | {kind: "converterPath"; hops: ConverterHop[] } //diff types, BFS found a path
  | {kind: "blocked"; reason: string; fromType: string; toType: string} //no dice, tell the user why
