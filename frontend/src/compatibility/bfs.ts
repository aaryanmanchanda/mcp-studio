import type { NodeManifest } from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";
import type { ConverterHop } from "./types";

// content type -> the one-way hops leaving it. keys are the raw manifest strings, so "video/MP4" and "video/mp4" are different places
export type ConverterGraph = Map<string, ConverterHop[]>;

export function buildConverterGraph(registry: NodeManifest[]): ConverterGraph {
  const graph: ConverterGraph = new Map();
  for (const manifest of registry) {
    for (const pair of manifest.converts ?? []) { //?? [] because stand-in manifests in tests can omit it. one manifest can declare several pairs, that's how format-converter covers two steps
      const hop: ConverterHop = { nodeManifestId: manifest.id, from: pair.from, to: pair.to };
      const leaving = graph.get(pair.from);
      if (leaving) leaving.push(hop);
      else graph.set(pair.from, [hop]);
    }
  }
  return graph;
}

// breadth-first: all 1-hop routes, then all 2-hop routes... so the first arrival is a shortest path.
// [] means "same type, nothing to do", null means "no route", the resolver relies on that difference
export function findConverterPath(from: string, to: string, graph: ConverterGraph): ConverterHop[] | null {
  if (from === to) return [];

  const visited = new Set<string>([from]); //load-bearing: without it a cyclic registry (a->b, b->a) hangs the tab
  const queue: { type: string; path: ConverterHop[] }[] = [{ type: from, path: [] }];

  while (queue.length > 0) {
    const { type, path } = queue.shift()!; //shift() takes the front, which is what makes this breadth-first
    for (const hop of graph.get(type) ?? []) { //a type with no outgoing hops just has nothing to walk
      if (visited.has(hop.to)) continue;
      const next = [...path, hop];
      if (hop.to === to) return next;
      visited.add(hop.to); //marked when queued, not when processed, so nothing is queued twice
      queue.push({ type: hop.to, path: next });
    }
  }
  return null;
}

// the graph and the answers are cached per registry array: fetchRegistry makes a new array, so a changed registry can never see old answers.
// pure performance, in memory only, correctness never depends on it
const caches = new WeakMap<NodeManifest[], { graph: ConverterGraph; memo: Map<string, ConverterHop[] | null> }>();

export function findConverterPathCached(from: string, to: string, registry: NodeManifest[]): ConverterHop[] | null {
  let entry = caches.get(registry);
  if (!entry) {
    entry = { graph: buildConverterGraph(registry), memo: new Map() };
    caches.set(registry, entry);
  }
  const key = JSON.stringify([from, to]); //content types contain / ; = so a plain separator could collide
  if (entry.memo.has(key)) return entry.memo.get(key)!; //has() first so a remembered "no route" (null) counts as a hit
  const result = findConverterPath(from, to, entry.graph);
  entry.memo.set(key, result);
  return result;
}
