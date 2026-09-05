import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

import { buildFieldMapping } from "./fieldMapping";

// A JSON-Schema-ish object literal with the given property names, each typed
// `string` unless overridden. Property order in the object literal is the
// declaration order buildFieldMapping must respect.
function schema(props: Record<string, string>): string {
  return JSON.stringify({
    type: "object",
    properties: Object.fromEntries(
      Object.entries(props).map(([name, type]) => [name, { type }]),
    ),
  });
}

// The real shape-adapter pair from orchestrator/cmd/manifestserver/fixtures.go:
//   relevance-filter.clips_out  ->  trim-clip.clips_in
// same content type, schemas differ only in field-name casing, plus one field
// on each side that has no counterpart (score / DurationSec).
const RELEVANCE_FILTER_OUT = schema({
  videoid: "string",
  sourceurl: "string",
  score: "number",
});
const TRIM_CLIP_IN = schema({
  VideoId: "string",
  SourceUrl: "string",
  DurationSec: "number",
});

describe("buildFieldMapping", () => {
  it("identical property sets: every field maps via the exact rule, both unmapped lists empty", () => {
    const s = schema({ a: "string", b: "number", c: "string" });
    const res = buildFieldMapping(s, s);

    expect(res.mapping).toEqual([
      { from: "a", to: "a", via: "exact" },
      { from: "b", to: "b", via: "exact" },
      { from: "c", to: "c", via: "exact" },
    ]);
    expect(res.unmappedSource).toEqual([]);
    expect(res.unmappedTarget).toEqual([]);
  });

  it("the fixture pair: exactly two case-insensitive mappings, one unmapped source, one unfilled target", () => {
    const res = buildFieldMapping(RELEVANCE_FILTER_OUT, TRIM_CLIP_IN);

    expect(res.mapping).toEqual([
      { from: "videoid", to: "VideoId", via: "caseInsensitive" },
      { from: "sourceurl", to: "SourceUrl", via: "caseInsensitive" },
    ]);
    expect(res.mapping).toHaveLength(2);
    expect(res.unmappedSource).toEqual(["score"]);
    expect(res.unmappedTarget).toEqual(["DurationSec"]);
  });

  it("an exact match wins over an available case-insensitive one for the same target", () => {
    // target `Foo`: source has both `foo` (case-insensitive candidate) and
    // `Foo` (exact). The exact pass must claim `Foo` and leave `foo` unmapped.
    const source = schema({ foo: "string", Foo: "string" });
    const target = schema({ Foo: "string" });
    const res = buildFieldMapping(source, target);

    expect(res.mapping).toEqual([{ from: "Foo", to: "Foo", via: "exact" }]);
    expect(res.unmappedSource).toEqual(["foo"]);
    expect(res.unmappedTarget).toEqual([]);
  });

  it("case-only collision resolves by source declaration order, deterministically across repeated calls", () => {
    // target `foo` (lowercased "foo"); sources `FOO` then `Foo` both qualify.
    // First in source declaration order (`FOO`) wins; `Foo` is reported unmapped.
    const source = schema({ FOO: "string", Foo: "string" });
    const target = schema({ foo: "string" });

    const first = buildFieldMapping(source, target);
    const second = buildFieldMapping(source, target);

    expect(first.mapping).toEqual([
      { from: "FOO", to: "foo", via: "caseInsensitive" },
    ]);
    expect(first.unmappedSource).toEqual(["Foo"]);
    expect(first).toEqual(second);
  });

  it("one source cannot satisfy two targets", () => {
    // both targets lowercase to "x"; the single source `x` maps to the first
    // target only, the second target is left unfilled.
    const source = schema({ x: "string" });
    const target = schema({ x: "string", X: "string" });
    const res = buildFieldMapping(source, target);

    expect(res.mapping).toEqual([{ from: "x", to: "x", via: "exact" }]);
    expect(res.unmappedTarget).toEqual(["X"]);
    expect(res.unmappedSource).toEqual([]);
  });

  describe("degenerate schemas yield an empty mapping and never throw", () => {
    const cases: Array<[string, string]> = [
      ["empty string", ""],
      ["unparseable", "{ not json"],
      ["no properties key", JSON.stringify({ type: "object" })],
      ["empty properties object", JSON.stringify({ type: "object", properties: {} })],
      ["properties is not an object", JSON.stringify({ properties: "nope" })],
      ["a JSON array", JSON.stringify(["a", "b"])],
      ["the literal null", "null"],
    ];

    for (const [label, bad] of cases) {
      it(`${label} on the source side`, () => {
        const good = schema({ a: "string" });
        expect(() => buildFieldMapping(bad, good)).not.toThrow();
        const res = buildFieldMapping(bad, good);
        expect(res.mapping).toEqual([]);
        expect(res.unmappedSource).toEqual([]);
        expect(res.unmappedTarget).toEqual(["a"]);
      });

      it(`${label} on the target side`, () => {
        const good = schema({ a: "string" });
        expect(() => buildFieldMapping(good, bad)).not.toThrow();
        const res = buildFieldMapping(good, bad);
        expect(res.mapping).toEqual([]);
        expect(res.unmappedSource).toEqual(["a"]);
        expect(res.unmappedTarget).toEqual([]);
      });
    }

    it("both sides degenerate: everything empty", () => {
      const res = buildFieldMapping("", "{ also bad");
      expect(res).toEqual({ mapping: [], unmappedSource: [], unmappedTarget: [] });
    });
  });

  it("a single-property schema against an empty one reports the property on the correct side", () => {
    const one = schema({ only: "string" });

    const sourceHasIt = buildFieldMapping(one, "");
    expect(sourceHasIt.mapping).toEqual([]);
    expect(sourceHasIt.unmappedSource).toEqual(["only"]);
    expect(sourceHasIt.unmappedTarget).toEqual([]);

    const targetHasIt = buildFieldMapping("", one);
    expect(targetHasIt.mapping).toEqual([]);
    expect(targetHasIt.unmappedSource).toEqual([]);
    expect(targetHasIt.unmappedTarget).toEqual(["only"]);
  });

  it("names differing only in Unicode composition form do NOT match (no normalization)", () => {
    // "éclair": NFC (single U+00E9) on the target, NFD (e + U+0301) on the source.
    const source = schema({ "éclair": "string" });
    const target = schema({ "éclair": "string" });
    const res = buildFieldMapping(source, target);

    expect(res.mapping).toEqual([]);
    expect(res.unmappedSource).toEqual(["éclair"]);
    expect(res.unmappedTarget).toEqual(["éclair"]);
  });

  it("names differing only in surrounding whitespace do NOT match (no trimming)", () => {
    const source = schema({ " name": "string" });
    const target = schema({ name: "string" });
    const res = buildFieldMapping(source, target);

    expect(res.mapping).toEqual([]);
    expect(res.unmappedSource).toEqual([" name"]);
    expect(res.unmappedTarget).toEqual(["name"]);
  });

  it("does not mutate its input strings and is referentially stable across calls", () => {
    const source = RELEVANCE_FILTER_OUT;
    const target = TRIM_CLIP_IN;
    const sourceBefore = source;
    const targetBefore = target;

    const r1 = buildFieldMapping(source, target);
    const r2 = buildFieldMapping(source, target);

    expect(source).toBe(sourceBefore);
    expect(target).toBe(targetBefore);
    expect(r1).toEqual(r2);
  });

  it("uses no fuzzy / edit-distance / string-similarity dependency", () => {
    // Run from the frontend package dir (pnpm --filter sets cwd there).
    const src = readFileSync(
      resolve(process.cwd(), "src/compatibility/fieldMapping.ts"),
      "utf8",
    );
    expect(src).not.toMatch(
      /fuse|levenshtein|jaro|winkler|damerau|string-similarity|fast-fuzzy|dice|trigram/i,
    );

    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(allDeps)) {
      expect(name).not.toMatch(/fuzz|levenshtein|jaro|damerau|string-similarity|fuse\.js/i);
    }
  });
});
