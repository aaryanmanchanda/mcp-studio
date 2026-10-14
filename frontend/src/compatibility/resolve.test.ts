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

// The real shape-adapter pair from orchestrator/cmd/manifestserver/fixtures.go:
// relevance-filter.clips_out -> trim-clip.clips_in. Same content type; field
// names differ only in case for two of three fields; `score` has no target and
// `DurationSec` has no source.
const schemaRelevanceOut = JSON.stringify({
  type: "object",
  properties: {
    videoid: { type: "string" },
    sourceurl: { type: "string" },
    score: { type: "number" },
  },
});
const schemaTrimIn = JSON.stringify({
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
    outputs: [{ name: "clips_out", contentType: CLIP_LIST, schemaJson: schemaRelevanceOut }],
  },
  {
    id: "trim-clip",
    inputs: [{ name: "clips_in", contentType: CLIP_LIST, schemaJson: schemaTrimIn }],
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

  it("shape adapter: relevance-filter.clips_out -> trim-clip.clips_in (same type, schema differs by case)", () => {
    const nodes = [place("relevance-filter", "r"), place("trim-clip", "t")];
    const res = resolveCompatibility(conn("r", "clips_out", "t", "clips_in"), nodes, MANIFESTS);

    expect(res.kind).toBe("shapeAdapter");
    if (res.kind === "shapeAdapter") {
      expect(res.mapping).toEqual([
        { from: "videoid", to: "VideoId", via: "caseInsensitive" },
        { from: "sourceurl", to: "SourceUrl", via: "caseInsensitive" },
      ]);
      expect(res.unmappedSource).toEqual(["score"]);
      expect(res.unmappedTarget).toEqual(["DurationSec"]);
    }
  });

  it("direct, not a zero-length shape adapter: same type, schemas structurally equivalent but key order differs", () => {
    const jumbledA = JSON.stringify({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
    });
    const jumbledB = JSON.stringify({
      type: "object",
      properties: { b: { type: "number" }, a: { type: "string" } },
    });
    const manifests = [
      { id: "x", inputs: [], outputs: [{ name: "out", contentType: "text/x", schemaJson: jumbledA }] },
      { id: "y", inputs: [{ name: "in", contentType: "text/x", schemaJson: jumbledB }], outputs: [] },
    ] as unknown as NodeManifest[];
    const nodes = [place("x"), place("y")];

    const res = resolveCompatibility(conn("x", "out", "y", "in"), nodes, manifests);
    expect(res).toEqual({ kind: "direct" });
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

  it("a malformed schema_json on the same-type path returns a Resolution rather than throwing", () => {
    // Same content type, neither blob, both schemas unparseable — the resolver
    // hands them to buildFieldMapping, which parses inside a guard (T-02-23) and
    // returns an empty mapping. The result is a shape adapter that maps nothing,
    // and whose (empty) unmapped lists still tell the truth.
    const manifests = [
      { id: "a", inputs: [], outputs: [{ name: "out", contentType: "text/x", schemaJson: "{ not json" }] },
      { id: "b", inputs: [{ name: "in", contentType: "text/x", schemaJson: "also { bad" }], outputs: [] },
    ] as unknown as NodeManifest[];
    const nodes = [place("a"), place("b")];
    expect(() =>
      resolveCompatibility(conn("a", "out", "b", "in"), nodes, manifests),
    ).not.toThrow();
    const res = resolveCompatibility(conn("a", "out", "b", "in"), nodes, manifests);
    expect(res.kind).toBe("shapeAdapter");
    if (res.kind === "shapeAdapter") {
      expect(res.mapping).toEqual([]);
      expect(res.unmappedSource).toEqual([]);
      expect(res.unmappedTarget).toEqual([]);
    }
  });

  it("blocked: different content types with malformed schemas still does not throw", () => {
    const manifests = [
      { id: "a", inputs: [], outputs: [{ name: "out", contentType: "text/x", schemaJson: "{ not json" }] },
      { id: "b", inputs: [{ name: "in", contentType: "text/y", schemaJson: "also { bad" }], outputs: [] },
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

// the converter branch (02-07): a registry that also holds the fixture converter
const CONVERTER = {
  id: "format-converter",
  inputs: [{ name: "media_in", contentType: "application/x-mcpstudio-converter-wildcard", schemaJson: "" }],
  outputs: [{ name: "media_out", contentType: "application/x-mcpstudio-converter-wildcard", schemaJson: "" }],
  converts: [
    { from: "video/quicktime", to: "video/mp4" },
    { from: "video/mp4", to: "video/webm" },
  ],
} as unknown as NodeManifest;
const WITH_CONVERTER = [...MANIFESTS, CONVERTER];

describe("resolveCompatibility: converter path and blocked", () => {
  it("converter: trim-clip.clip -> upload-post.video_in is two ordered hops", () => {
    const nodes = [place("trim-clip", "t"), place("upload-post", "u")];
    const res = resolveCompatibility(conn("t", "clip", "u", "video_in"), nodes, WITH_CONVERTER);
    expect(res.kind).toBe("converterPath");
    if (res.kind === "converterPath") {
      expect(res.hops.map((h) => [h.from, h.to])).toEqual([
        ["video/quicktime", "video/mp4"],
        ["video/mp4", "video/webm"],
      ]);
    }
  });

  it("blocked: captions -> upload-post still has no route, and the reason names both types", () => {
    const nodes = [place("caption-generator", "c"), place("upload-post", "u")];
    const res = resolveCompatibility(conn("c", "captions", "u", "video_in"), nodes, WITH_CONVERTER);
    expect(res.kind).toBe("blocked");
    if (res.kind === "blocked") {
      expect(res.reason).toContain("application/vnd.mcpstudio.captions+json");
      expect(res.reason).toContain("video/webm");
    }
  });

  it("blocked (not a throw): an unresolvable handle id says which side", () => {
    const nodes = [place("trim-clip", "t"), place("upload-post", "u")];
    const res = resolveCompatibility(conn("t", "nope", "u", "video_in"), nodes, WITH_CONVERTER);
    expect(res.kind).toBe("blocked");
    if (res.kind === "blocked") expect(res.reason).toContain("source");
  });

  it("blocked: a socket with an empty content type never reaches the search", () => {
    const manifests = [
      { id: "x", inputs: [], outputs: [{ name: "out", contentType: "", schemaJson: "" }] },
      { id: "y", inputs: [{ name: "in", contentType: "video/webm", schemaJson: "" }], outputs: [] },
      CONVERTER,
    ] as unknown as NodeManifest[];
    const res = resolveCompatibility(conn("x1", "out", "y1", "in"), [place("x", "x1"), place("y", "y1")], manifests);
    expect(res.kind).toBe("blocked");
    if (res.kind === "blocked") expect(res.reason).toContain("no content type");
  });

  it("a same-type pair is direct and never touches the converter search", () => {
    const nodes = [place("trim-clip", "t"), place("caption-generator", "c")];
    expect(resolveCompatibility(conn("t", "clip", "c", "video_in"), nodes, WITH_CONVERTER)).toEqual({ kind: "direct" });
  });

  it("all four resolution kinds are reachable from fixture inputs", () => {
    const kinds = new Set([
      resolveCompatibility(conn("s", "clips", "r", "clips_in"), [place("youtube-scraper", "s"), place("relevance-filter", "r")], WITH_CONVERTER).kind,
      resolveCompatibility(conn("r", "clips_out", "t", "clips_in"), [place("relevance-filter", "r"), place("trim-clip", "t")], WITH_CONVERTER).kind,
      resolveCompatibility(conn("t", "clip", "u", "video_in"), [place("trim-clip", "t"), place("upload-post", "u")], WITH_CONVERTER).kind,
      resolveCompatibility(conn("c", "captions", "u", "video_in"), [place("caption-generator", "c"), place("upload-post", "u")], WITH_CONVERTER).kind,
    ]);
    expect([...kinds].sort()).toEqual(["blocked", "converterPath", "direct", "shapeAdapter"]);
  });
});
