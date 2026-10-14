import type { Edge } from "@xyflow/react";
import { ConfigFieldValueType, type NodeManifest } from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";

import type { ConfigValue } from "@/config-panel/configStore";
import type { PipelineNode } from "@/store/graphStore";

type Values = Record<string, Record<string, ConfigValue>>;

// the pipeline as saved to postgres and read by the go executor: react flow's own nodes and edges,
// plus each node's non-secret config as strings. credentials are never in here, they live in the vault keyed by node id
export function toGraphJson(nodes: PipelineNode[], edges: Edge[], values: Values): string {
  return JSON.stringify({
    nodes: nodes.map((n) => {
      const config: Record<string, string> = {};
      for (const [field, v] of Object.entries(values[n.id] ?? {})) {
        if (v !== "") config[field] = String(v); //the runner config is map<string,string>, empty means "not set"
      }
      return { id: n.id, type: n.type, position: n.position, data: n.data, config };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      type: e.type,
      data: e.data, //carries the frozen shape-adapter mapping, so a loaded wire behaves exactly as when it was made (T-02-21)
    })),
  });
}

// the way back: strings become typed values again, using each field's declared type so the widgets keep working
export function fromGraphJson(json: string, registry: NodeManifest[]): { nodes: PipelineNode[]; edges: Edge[]; values: Values } {
  const parsed = JSON.parse(json) as { nodes?: any[]; edges?: Edge[] };
  const nodes: PipelineNode[] = [];
  const values: Values = {};

  for (const n of parsed.nodes ?? []) {
    nodes.push({ id: n.id, type: n.type ?? "pipelineNode", position: n.position, data: n.data });
    const fields = registry.find((m) => m.id === n.data?.manifestId)?.configFields ?? [];
    for (const [name, raw] of Object.entries((n.config ?? {}) as Record<string, string>)) {
      const type = fields.find((f) => f.name === name)?.valueType;
      const v: ConfigValue =
        type === ConfigFieldValueType.NUMBER ? Number(raw) : type === ConfigFieldValueType.BOOLEAN ? raw === "true" : raw;
      values[n.id] = { ...values[n.id], [name]: v };
    }
  }
  return { nodes, edges: parsed.edges ?? [], values };
}
