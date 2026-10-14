import { describe, expect, it } from "vitest";
import { ConfigFieldValueType, type NodeManifest } from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";

import type { PipelineNode } from "@/store/graphStore";
import { fromGraphJson, toGraphJson } from "./serialize";

const registry = [
  {
    id: "groq-transcribe",
    configFields: [
      { name: "model", valueType: ConfigFieldValueType.ENUM },
      { name: "min_score", valueType: ConfigFieldValueType.NUMBER },
      { name: "strict", valueType: ConfigFieldValueType.BOOLEAN },
    ],
  },
] as unknown as NodeManifest[];

const node = { id: "n1", type: "pipelineNode", position: { x: 1, y: 2 }, data: { manifestId: "groq-transcribe" } } as PipelineNode;
const edge = { id: "e1", source: "n1", sourceHandle: "o", target: "n2", targetHandle: "i", type: "shapeAdapter", data: { mapping: [{ from: "a", to: "b", via: "exact" }] } };

describe("pipeline serialize", () => {
  it("round-trips nodes, edges (with the frozen mapping) and typed config values", () => {
    const json = toGraphJson([node], [edge], { n1: { model: "whisper-large-v3", min_score: 0.5, strict: true } });
    const back = fromGraphJson(json, registry);

    expect(back.nodes).toEqual([node]);
    expect(back.edges[0].data).toEqual(edge.data);
    expect(back.values.n1).toEqual({ model: "whisper-large-v3", min_score: 0.5, strict: true });
  });

  it("writes config as strings, because the runner contract is map<string,string>", () => {
    const parsed = JSON.parse(toGraphJson([node], [], { n1: { min_score: 3, strict: false } }));
    expect(parsed.nodes[0].config).toEqual({ min_score: "3", strict: "false" });
  });

  it("leaves unset (empty) values out entirely", () => {
    const parsed = JSON.parse(toGraphJson([node], [], { n1: { model: "" } }));
    expect(parsed.nodes[0].config).toEqual({});
  });

  it("a saved pipeline has no place to carry a credential", () => {
    const json = toGraphJson([node], [], { n1: { model: "x" } });
    expect(json).not.toMatch(/api_key|password|secret/i);
  });
});
