import { useCallback, useEffect } from "react";
import {
  Background,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
  type OnSelectionChangeParams,
} from "@xyflow/react";

import { PALETTE_DRAG_TYPE } from "@/palette/Palette";
import { useGraphStore } from "@/store/graphStore";
import { BlockedConnectionMessage } from "./BlockedConnectionMessage";
import { ShapeAdapterEdge } from "./edges/ShapeAdapterEdge";
import { PipelineNode } from "./nodes/PipelineNode";

// Stable references — React Flow warns (and re-inits) if these change identity.
const nodeTypes: NodeTypes = { pipelineNode: PipelineNode };
const edgeTypes: EdgeTypes = { shapeAdapter: ShapeAdapterEdge };

function CanvasInner() {
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const addNodeFromManifest = useGraphStore((s) => s.addNodeFromManifest);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId);
  const onConnect = useGraphStore((s) => s.onConnect);
  const dismissBlockedMessage = useGraphStore((s) => s.dismissBlockedMessage);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const manifestId = e.dataTransfer.getData(PALETTE_DRAG_TYPE);
      if (!manifestId) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNodeFromManifest(manifestId, position);
    },
    [screenToFlowPosition, addNodeFromManifest],
  );

  // React Flow re-runs this on every selection change — memoise so it doesn't
  // churn the ReactFlow subtree.
  const onSelectionChange = useCallback(
    ({ nodes: sel }: OnSelectionChangeParams) =>
      setSelectedNodeId(sel[0]?.id ?? null),
    [setSelectedNodeId],
  );

  // Own the delete keys so every deletion routes through the store's deleteNode
  // (which also drops incident edges and clears the selection). React Flow's
  // built-in delete is disabled below via deleteKeyCode={null}.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (selectedNodeId) {
        e.preventDefault();
        deleteNode(selectedNodeId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNodeId, deleteNode]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={dismissBlockedMessage}
        onPaneClick={dismissBlockedMessage}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onSelectionChange={onSelectionChange}
        deleteKeyCode={null}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <MiniMap position="bottom-right" pannable zoomable />
        <BlockedConnectionMessage />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm font-semibold">Your canvas is empty</p>
          <p className="text-sm text-muted-foreground">
            Drag a node from the palette on the left to get started.
          </p>
        </div>
      )}
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
