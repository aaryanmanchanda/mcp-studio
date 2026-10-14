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
import {assertNever, type ConverterHop} from "@/compatibility/types";

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

// a converter path the user hasn't confirmed yet: the exact hops that were previewed, plus the wire they were dropped on
export interface PendingConverter {
  hops: ConverterHop[];
  connection: Connection;
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

  pendingConverter: PendingConverter | null; //set by onConnect, consumed by insert (confirm) or cancel
  insertConverterPath: () => void;
  cancelConverterPath: () => void;
  loadGraph: (nodes: PipelineNode[], edges: Edge[]) => void; //replace the canvas with a saved pipeline

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
  pendingConverter: null,

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
      case "converterPath": //stage it, nothing touches the graph until the user confirms the preview (D-09)
        set({ pendingConverter: { hops: resolution.hops, connection }, blockedMessage: null });
        return;
      default:
        assertNever(resolution); //unreachable today; compile error the day a 5th kind shows up
    }
  },

  dismissBlockedMessage: () => set({blockedMessage: null}), //the message's × , or a click elsewhere on the canvas

  cancelConverterPath: () => set({ pendingConverter: null }), //nothing was changed, so nothing to undo

  insertConverterPath: () => {
    const { pendingConverter, nodes, edges, manifestRegistry } = get();
    if (!pendingConverter) return; //a second confirm, or a confirm after cancel, is a no-op
    const { hops, connection } = pendingConverter;
    const src = nodes.find((n) => n.id === connection.source);
    const dst = nodes.find((n) => n.id === connection.target);
    if (!src || !dst || !connection.sourceHandle || !connection.targetHandle) {
      set({ pendingConverter: null });
      return;
    }

    // one ordinary node per hop (D-10: no group node), laid out along the line between the two ends
    const added: PipelineNode[] = [];
    for (let i = 0; i < hops.length; i++) {
      const t = (i + 1) / (hops.length + 1);
      added.push({
        id: crypto.randomUUID(),
        type: "pipelineNode",
        position: {
          x: src.position.x + (dst.position.x - src.position.x) * t,
          y: src.position.y + (dst.position.y - src.position.y) * t,
        },
        data: { manifestId: hops[i].nodeManifestId, hop: { from: hops[i].from, to: hops[i].to } }, //the hop is what gives the wildcard sockets a real type
      });
    }

    // wire source -> hop 1 -> ... -> hop N -> target, using each converter's own socket names
    const inName = (n: PipelineNode) => manifestRegistry.find((m) => m.id === n.data.manifestId)?.inputs[0]?.name;
    const outName = (n: PipelineNode) => manifestRegistry.find((m) => m.id === n.data.manifestId)?.outputs[0]?.name;
    const chain = [{ id: src.id, out: connection.sourceHandle }, ...added.map((n) => ({ id: n.id, out: outName(n) }))];
    const newEdges: Edge[] = [];
    for (let i = 0; i < added.length; i++) {
      const to = inName(added[i]);
      const from = chain[i].out;
      if (!to || !from) { //converter manifest missing its sockets: bail without a half-built chain
        set({ pendingConverter: null });
        return;
      }
      newEdges.push({ id: crypto.randomUUID(), source: chain[i].id, sourceHandle: from, target: added[i].id, targetHandle: to });
    }
    const last = chain[chain.length - 1];
    if (!last.out) {
      set({ pendingConverter: null });
      return;
    }
    newEdges.push({ id: crypto.randomUUID(), source: last.id, sourceHandle: last.out, target: dst.id, targetHandle: connection.targetHandle });

    //all in one update, and the pending slot clears in the same breath so a double click can't insert twice
    set({ nodes: [...nodes, ...added], edges: [...edges, ...newEdges], pendingConverter: null, blockedMessage: null });
  },

  loadGraph: (nodes, edges) => set({ nodes, edges, selectedNodeId: null, blockedMessage: null, pendingConverter: null }),


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
