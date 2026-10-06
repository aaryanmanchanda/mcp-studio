import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ShapeAdapterEdge, badgeText } from "./ShapeAdapterEdge";

// React Flow's edge primitives need a live viewport; stub them to plain DOM.
vi.mock("@xyflow/react", () => ({
  BaseEdge: ({ style }: { style?: React.CSSProperties }) => (
    <div data-testid="base-edge" style={style} />
  ),
  EdgeLabelRenderer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  getBezierPath: () => ["M0,0", 10, 20],
}));

function renderEdge(
  data: {
    mapping: { from: string; to: string; via: "exact" | "caseInsensitive" }[];
    unmappedSource: string[];
    unmappedTarget: string[];
  },
  selected = false,
) {
  // Only the props the component reads; the rest of EdgeProps is irrelevant here.
  const props = {
    id: "e1",
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: "right",
    targetPosition: "left",
    data,
    selected,
  } as unknown as Parameters<typeof ShapeAdapterEdge>[0];
  return render(<ShapeAdapterEdge {...props} />);
}

describe("badgeText", () => {
  it("pluralises, including zero", () => {
    expect(badgeText(0)).toBe("0 fields mapped");
    expect(badgeText(1)).toBe("1 field mapped");
    expect(badgeText(3)).toBe("3 fields mapped");
  });
});

describe("ShapeAdapterEdge", () => {
  it("shows the mapped-field count on the badge", () => {
    renderEdge({
      mapping: [
        { from: "a", to: "a", via: "exact" },
        { from: "B", to: "b", via: "caseInsensitive" },
      ],
      unmappedSource: [],
      unmappedTarget: [],
    });
    expect(screen.getByRole("button", { name: "2 fields mapped" })).toBeTruthy();
  });

  it("badge says 0 fields mapped and the inspector shows the empty copy", () => {
    renderEdge({ mapping: [], unmappedSource: ["x"], unmappedTarget: ["y"] });
    const badge = screen.getByRole("button", { name: "0 fields mapped" });
    fireEvent.click(badge);
    expect(screen.getByText("No fields auto-matched")).toBeTruthy();
  });

  it("inspector lists mapped pairs and both unmapped lists, with no edit controls", () => {
    renderEdge({
      mapping: [{ from: "url", to: "link", via: "exact" }],
      unmappedSource: ["extra_src"],
      unmappedTarget: ["missing_tgt"],
    });
    fireEvent.click(screen.getByRole("button", { name: "1 field mapped" }));

    expect(screen.getByText(/url → link/)).toBeTruthy();
    expect(screen.getByText("extra_src")).toBeTruthy();
    expect(screen.getByText("missing_tgt")).toBeTruthy();
    // the badge trigger is the only button — nothing editable inside
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("thickens the stroke when selected", () => {
    const empty = { mapping: [], unmappedSource: [], unmappedTarget: [] };
    const { unmount } = renderEdge(empty, false);
    expect(screen.getByTestId("base-edge").style.strokeWidth).toBe("1.5");
    unmount();
    renderEdge(empty, true);
    expect(screen.getByTestId("base-edge").style.strokeWidth).toBe("3");
  });
});
