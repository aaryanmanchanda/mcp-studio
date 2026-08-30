import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { useGraphStore } from "@/store/graphStore";
import { Canvas } from "./Canvas";
import { PALETTE_DRAG_TYPE } from "@/palette/Palette";

// Mock React Flow down to a passthrough. These tests exercise Canvas's own
// wiring (drop -> addNodeFromManifest, the empty-state overlay), not React
// Flow's rendering — and RF's real DOM/canvas code doesn't run under jsdom.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    children,
    onDrop,
    onDragOver,
  }: {
    children?: React.ReactNode;
    onDrop?: (e: unknown) => void;
    onDragOver?: (e: unknown) => void;
  }) => (
    <div data-testid="rf" onDrop={onDrop} onDragOver={onDragOver}>
      {children}
    </div>
  ),
  ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Background: () => null,
  MiniMap: () => null,
  useReactFlow: () => ({
    // identity transform — screen coords are flow coords in the test
    screenToFlowPosition: (p: { x: number; y: number }) => p,
  }),
  // referenced by PipelineNode.tsx / BlockedConnectionMessage.tsx at import
  // time, unused in these tests
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  useNodeConnections: () => [],
  useConnection: () => ({ inProgress: false }),
  ViewportPortal: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

function dropManifest(manifestId: string) {
  fireEvent.drop(screen.getByTestId("rf"), {
    dataTransfer: {
      getData: (type: string) => (type === PALETTE_DRAG_TYPE ? manifestId : ""),
    },
  });
}

describe("Canvas", () => {
  beforeEach(() => {
    useGraphStore.setState({ nodes: [], edges: [], selectedNodeId: null });
  });

  it("renders the empty-state copy when there are no nodes", () => {
    render(<Canvas />);
    expect(screen.getByText("Your canvas is empty")).toBeInTheDocument();
    expect(
      screen.getByText("Drag a node from the palette on the left to get started."),
    ).toBeInTheDocument();
  });

  it("a palette drop adds a node from that manifest to the store", () => {
    render(<Canvas />);
    dropManifest("youtube-scraper");

    const { nodes } = useGraphStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.manifestId).toBe("youtube-scraper");
  });

  it("hides the empty-state copy once a node exists", () => {
    render(<Canvas />);
    dropManifest("trim-clip");
    expect(screen.queryByText("Your canvas is empty")).toBeNull();
  });

  it("a drop carrying no manifest id adds nothing", () => {
    render(<Canvas />);
    dropManifest(""); // getData returns "" for the drag key
    expect(useGraphStore.getState().nodes).toHaveLength(0);
  });
});
