import { describe, it, expect } from "vitest";
import type { Connection } from "@xyflow/react";
import type { NodeManifest } from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";

import { resolveCompatibility } from "./resolve";
import type { PlacedNode } from "./types";

const CLIP_LIST = "application/vnd.mcpstudio.clip-list+json";

const schemaSnake = JSON.stringify({
  type: "object",
  properties: {
    video_id: { type: "string" },
    source_url: { type: "string" },
    duration_sec: { type: "number" },
  },
});
const schemaPascal = JSON.stringify({
  type: "object",
  properties: {
    VideoId: { type: "string" },
    SourceUrl: { type: "string" },
    DurationSec: { type: "number" },
  },
});

// Minimal stand-ins for the manifestserver fixtures — only the fields the
// resolver reads (id, inputs/outputs -> name/contentType/schemaJson).
const MANIFESTS = [
  {
    id: "youtube-scraper",
    inputs: [],
    outputs: [{ name: "clips", contentType: CLIP_LIST, schemaJson: schemaSnake }],
  },
  {
    id: "relevance-filter",
    inputs: [{ name: "clips_in", contentType: CLIP_LIST, schemaJson: schemaSnake }],
    outputs: [{ name: "clips_out", contentType: CLIP_LIST, schemaJson: schemaPascal }],
  },
  {
    id: "trim-clip",
    inputs: [{ name: "clips_in", contentType: CLIP_LIST, schemaJson: schemaSnake }],
    outputs: [{ name: "clip", contentType: "video/quicktime", schemaJson: "" }],
  },
  {
    id: "caption-generator",
    inputs: [{ name: "video_in", contentType: "video/quicktime", schemaJson: "" }],
    outputs: [
      {
        name: "captions",
        contentType: "application/vnd.mcpstudio.captions+json",
        schemaJson: JSON.stringify({ type: "object", properties: { text: { type: "string" } } }),
      },
    ],
  },
  {
    id: "upload-post",
    inputs: [{ name: "video_in", contentType: "video/webm", schemaJson: "" }],
    outputs: [],
  },
] as unknown as NodeManifest[];

function place(manifestId: string, id = manifestId): PlacedNode {
  return { id, data: { manifestId } };
}

function conn(
  source: string,
  sourceHandle: string | null,
  target: string,
  targetHandle: string | null,
): Connection {
  return { source, sourceHandle, target, targetHandle };
}

describe("resolveCompatibility", () => {
  it("exact match: scraper.clips -> relevance-filter.clips_in wires direct", () => {
    const nodes = [place("youtube-scraper", "s"), place("relevance-filter", "r")];
    const res = resolveCompatibility(conn("s", "clips", "r", "clips_in"), nodes, MANIFESTS);
    expect(res).toEqual({ kind: "direct" });
  });

  it("exact match: trim-clip.clip -> caption-generator.video_in is direct on content type alone (blob)", () => {
    const nodes = [place("trim-clip", "t"), place("caption-generator", "c")];
    const res = resolveCompatibility(conn("t", "clip", "c", "video_in"), nodes, MANIFESTS);
    expect(res).toEqual({ kind: "direct" });
  });

  it("blocked: caption-generator.captions -> upload-post.video_in has no path", () => {
    const nodes = [place("caption-generator", "c"), place("upload-post", "u")];
    const res = resolveCompatibility(conn("c", "captions", "u", "video_in"), nodes, MANIFESTS);
    expect(res.kind).toBe("blocked");
    if (res.kind === "blocked") {
      expect(res.fromType).toBe("application/vnd.mcpstudio.captions+json");
      expect(res.toType).toBe("video/webm");
      expect(res.reason).toContain("No conversion path");
    }
  });

  it("blocked: same content type, incompatible schema (shape adapter lands in 02-05)", () => {
    const nodes = [place("relevance-filter", "r"), place("trim-clip", "t")];
    // clips_out is PascalCase-keyed, clips_in is snake_case-keyed — same type, different shape
    const res = resolveCompatibility(conn("r", "clips_out", "t", "clips_in"), nodes, MANIFESTS);
    expect(res.kind).toBe("blocked");
  });

  it("blocked: a handle id that isn't declared on the manifest", () => {
    const nodes = [place("youtube-scraper", "s"), place("relevance-filter", "r")];
    const res = resolveCompatibility(conn("s", "not-a-socket", "r", "clips_in"), nodes, MANIFESTS);
    expect(res.kind).toBe("blocked");
    if (res.kind === "blocked") expect(res.fromType).toBe("unknown");
  });

  it("blocked: a null handle on the connection", () => {
    const nodes = [place("youtube-scraper", "s"), place("relevance-filter", "r")];
    const res = resolveCompatibility(conn("s", null, "r", "clips_in"), nodes, MANIFESTS);
    expect(res.kind).toBe("blocked");
  });

  it("a malformed schema_json returns a Resolution rather than throwing", () => {
    const manifests = [
      { id: "a", inputs: [], outputs: [{ name: "out", contentType: "text/x", schemaJson: "{ not json" }] },
      { id: "b", inputs: [{ name: "in", contentType: "text/x", schemaJson: "also { bad" }], outputs: [] },
    ] as unknown as NodeManifest[];
    const nodes = [place("a"), place("b")];
    expect(() =>
      resolveCompatibility(conn("a", "out", "b", "in"), nodes, manifests),
    ).not.toThrow();
    expect(resolveCompatibility(conn("a", "out", "b", "in"), nodes, manifests).kind).toBe("blocked");
  });

  it("pure: two calls are deeply equal and neither input array is mutated", () => {
    const nodes = [place("youtube-scraper", "s"), place("relevance-filter", "r")];
    const registry = MANIFESTS;
    const nodesBefore = JSON.stringify(nodes);
    const registryBefore = JSON.stringify(registry);
    const c = conn("s", "clips", "r", "clips_in");

    const r1 = resolveCompatibility(c, nodes, registry);
    const r2 = resolveCompatibility(c, nodes, registry);

    expect(r1).toEqual(r2);
    expect(JSON.stringify(nodes)).toBe(nodesBefore);
    expect(JSON.stringify(registry)).toBe(registryBefore);
  });
});
