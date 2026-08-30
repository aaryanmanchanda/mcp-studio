import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type XYPosition,
} from '@xyflow/react';
import { orchestratorClient } from '@/rpc/orchestratorClient';
import type { NodeManifest } from '@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb';

type RegistryStatus = "idle" | "loading" | "ready" | "error";

// Data carried on every placed canvas node. `hop` is only set on converter-node
// instances inserted in Plan 02-07 (it pins the concrete from/to content types
// for a wildcard-typed converter socket) — left undefined for every normal node.
// React Flow v12 constrains node data to Record<string, unknown>; the index
// signature satisfies that while keeping our two real fields typed.
export interface PipelineNodeData extends Record<string, unknown> {
  manifestId: string;
  hop?: { from: string; to: string };
}

export type PipelineNode = Node<PipelineNodeData>;

interface GraphState {
  // --- registry slice (Plan 02-03) --------------------------------------
  manifestRegistry: NodeManifest[];
  registryStatus: RegistryStatus;
  registryError: string | null;
  fetchRegistry: () => Promise<void>;

  // --- graph slice (Plan 02-04 Task 1) ---------------------------------
  nodes: PipelineNode[];
  edges: Edge[];
  selectedNodeId: string | null;

  onNodesChange: (changes: NodeChange<PipelineNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  addNodeFromManifest: (manifestId: string, position: XYPosition) => void;
  deleteNode: (nodeId: string) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
}

export const useGraphStore = create<GraphState>((set, get) => ({
  // --- registry slice (Plan 02-03) --------------------------------------
  manifestRegistry: [],
  registryStatus: "idle",
  registryError: null,
  fetchRegistry: async () => {
    if (get().registryStatus === "loading") {
      return;
    }
    set({ registryStatus: 'loading', registryError: null });

    try {
      const response = await orchestratorClient.listNodeManifests({});
      set({ manifestRegistry: response.manifests, registryStatus: 'ready' });
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ registryStatus: "error", registryError: message });
    }
  },

  // --- graph slice (Plan 02-04 Task 1) ---------------------------------
  nodes: [],
  edges: [],
  selectedNodeId: null,

  onNodesChange: (changes) => set({
    nodes: applyNodeChanges(changes, get().nodes)
  }),

  onEdgesChange: (changes) => set({
    edges: applyEdgeChanges(changes, get().edges)
  }),


  addNodeFromManifest: (manifestId, position) => {
    const node: PipelineNode = {
      id: crypto.randomUUID(),
      type: 'pipelineNode',
      position,
      data: { manifestId },
    };
    set({ nodes: [...get().nodes, node] });
  },


  deleteNode: (nodeId) => {
    const { nodes, edges, selectedNodeId } = get();
    if (!nodes.some((n) => n.id === nodeId)) return; //doesn't exist? no problemo
    set({
      nodes: nodes.filter((n) => n.id !== nodeId), //filtered
      edges: edges.filter((e) => e.source !== nodeId && e.target !== nodeId), //from conns, to conns removed
      selectedNodeId: selectedNodeId === nodeId ? null : selectedNodeId, //won't call a ghost
    });
  },

  setSelectedNodeId: (nodeId) => {
    set({ selectedNodeId: nodeId })
  },
}));
