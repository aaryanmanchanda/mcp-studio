import { describe, it, expect } from "vitest";
import type { NodeManifest } from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";
import { buildConverterGraph, findConverterPath, findConverterPathCached } from "./bfs";

// a registry entry that only declares conversions, the rest of a manifest is irrelevant here
const conv = (id: string, ...pairs: [string, string][]) =>
  ({ id, converts: pairs.map(([from, to]) => ({ from, to })) }) as unknown as NodeManifest;

// the fixture converter: quicktime -> mp4 -> webm, plus the demo's mp4 -> mp3
const FIXTURE = [conv("format-converter", ["video/quicktime", "video/mp4"], ["video/mp4", "video/webm"], ["video/mp4", "audio/mpeg"])];

const find = (registry: NodeManifest[], from: string, to: string) =>
  findConverterPath(from, to, buildConverterGraph(registry));

describe("findConverterPath", () => {
  it("one declared pair is a one-hop path", () => {
    const path = find(FIXTURE, "video/mp4", "audio/mpeg");
    expect(path).toEqual([{ nodeManifestId: "format-converter", from: "video/mp4", to: "audio/mpeg" }]);
  });

  it("quicktime -> webm is two hops, in order, each naming its converter", () => {
    const path = find(FIXTURE, "video/quicktime", "video/webm");
    expect(path?.map((h) => [h.from, h.to])).toEqual([
      ["video/quicktime", "video/mp4"],
      ["video/mp4", "video/webm"],
    ]);
    expect(path?.every((h) => h.nodeManifestId === "format-converter")).toBe(true);
  });

  it("the shorter route wins when two exist", () => {
    const registry = [
      conv("slow", ["a", "b"], ["b", "c"], ["c", "d"]),
      conv("fast", ["a", "d"]),
    ];
    expect(find(registry, "a", "d")).toHaveLength(1);
  });

  it("no route returns null", () => {
    expect(find(FIXTURE, "audio/mpeg", "video/webm")).toBeNull();
  });

  it("a cycle terminates (and still finds the way out)", { timeout: 1000 }, () => {
    const registry = [conv("loop", ["a", "b"], ["b", "a"], ["b", "c"])];
    expect(find(registry, "a", "c")).toHaveLength(2);
    expect(find(registry, "a", "zzz")).toBeNull(); // the unreachable case is the one that would hang without a visited set
  });

  it("same type is an empty path, not a self hop", () => {
    expect(find(FIXTURE, "video/mp4", "video/mp4")).toEqual([]);
  });

  it("an empty registry, a conversion-less registry and an unknown source return null without throwing", () => {
    expect(find([], "a", "b")).toBeNull();
    expect(find([conv("none")], "a", "b")).toBeNull();
    expect(find(FIXTURE, "nope/unknown", "video/webm")).toBeNull();
  });

  it("types that differ only in case are different nodes", () => {
    expect(find(FIXTURE, "video/MP4", "video/webm")).toBeNull();
  });
});

describe("findConverterPathCached", () => {
  it("agrees with the uncached search, including for 'no route'", () => {
    expect(findConverterPathCached("video/quicktime", "video/webm", FIXTURE)).toEqual(find(FIXTURE, "video/quicktime", "video/webm"));
    expect(findConverterPathCached("audio/mpeg", "video/webm", FIXTURE)).toBeNull();
    expect(findConverterPathCached("audio/mpeg", "video/webm", FIXTURE)).toBeNull(); // second call is the memo hit
  });

  it("does not serve a stale answer after the registry changes", () => {
    const before = [conv("one", ["a", "b"])];
    expect(findConverterPathCached("a", "c", before)).toBeNull();
    const after = [conv("one", ["a", "b"], ["b", "c"])]; // a new array, like fetchRegistry produces
    expect(findConverterPathCached("a", "c", after)).toHaveLength(2);
  });
});
