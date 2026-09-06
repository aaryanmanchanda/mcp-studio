import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type XYPosition,
  type Connection,
} from '@xyflow/react';
import { orchestratorClient } from '@/rpc/orchestratorClient';
import type { NodeManifest } from '@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb';
import { resolveCompatibility } from "@/compatibility/resolve";
import {assertNever} from "@/compatibility/types";

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

export interface BlockedMessage{ //a refused connection — rendered as a popover pinned to the target socket (D-11)
  nodeId: string; //node the user dropped on
  handleId: string | null; //socket on that node
  reason: string;
  fromType: string; //content types shown mono in the message copy
  toType: string;
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

  // --- connect gesture (Plan 02-04 Task 3) ----------------------------
  blockedMessage: BlockedMessage | null; //null = nothing refused right now
  onConnect: (connection: Connection) => void; //resolver -> wire it or block it
  dismissBlockedMessage: () => void;

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
  blockedMessage: null,

  onNodesChange: (changes) => set({
    nodes: applyNodeChanges(changes, get().nodes)
  }),

  onEdgesChange: (changes) => set({
    edges: applyEdgeChanges(changes, get().edges)
  }),

  onConnect: (connection) => { //fires when the user drops a wire from one socket onto another
    const {nodes, manifestRegistry, edges} = get();
    const resolution = resolveCompatibility(connection, nodes, manifestRegistry); //ask the pure resolver, once

    switch (resolution.kind){ //every kind has a case — default hits assertNever if one's ever missed
      case "direct": {
        const dup = edges.some((e) => //are these exact two sockets already wired?
            e.source === connection.source &&
            e.sourceHandle === connection.sourceHandle &&
            e.target === connection.target &&
            e.targetHandle === connection.targetHandle
        );
        if (dup) return; //don't stack a second identical edge
        set({edges: addEdge(connection, edges), blockedMessage: null}); //wire it, clear any stale message
        return;
      }
      case "blocked": //no wire — pin an explanation to the socket they dropped on
        set({
          blockedMessage: {
            nodeId: connection.target,
            handleId: connection.targetHandle,
            reason: resolution.reason,
            fromType: resolution.fromType,
            toType: resolution.toType,
          },
        });
        return;
        case "shapeAdapter": { //same type, differing schema, carry the field mapping on the edge
                const dup = edges.some((e) =>
                    e.source === connection.source &&
                    e.sourceHandle === connection.sourceHandle &&
                    e.target === connection.target &&
                    e.targetHandle === connection.targetHandle
                );
                if (dup) return; //identical wire already exists
                set({
                  edges: addEdge(
                    {
                      ...connection,
                      type: "shapeAdapter",
                      data: {
                        mapping: resolution.mapping,
                        unmappedSource: resolution.unmappedSource,
                        unmappedTarget: resolution.unmappedTarget,
                      },
                    },
                    edges,
                  ),
                  blockedMessage: null,
                });
                return;
              }
      case "converterPath": //02-07 fills this in
        throw new Error("converterPath resolution not implemented yet");
      default:
        assertNever(resolution); //unreachable today; compile error the day a 5th kind shows up
    }
  },

  dismissBlockedMessage: () => set({blockedMessage: null}), //the message's × , or a click elsewhere on the canvas


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
