import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { useGraphStore } from "@/store/graphStore";
import { ConverterPreviewDialog } from "./ConverterPreviewDialog";

const hop = (from: string, to: string) => ({ nodeManifestId: "format-converter", from, to });
const wire = { source: "a", sourceHandle: "o", target: "b", targetHandle: "i" };

function stage(hops: ReturnType<typeof hop>[]) {
  useGraphStore.setState({ pendingConverter: { hops, connection: wire } });
}

beforeEach(() => {
  useGraphStore.setState({ nodes: [], edges: [], pendingConverter: null });
});

describe("ConverterPreviewDialog", () => {
  it("renders nothing while no path is staged", () => {
    render(<ConverterPreviewDialog />);
    expect(screen.queryByText("Insert converter path")).toBeNull();
  });

  it("one hop: one card, singular copy", () => {
    stage([hop("video/mp4", "audio/mpeg")]);
    render(<ConverterPreviewDialog />);
    expect(screen.getAllByTestId("hop-card")).toHaveLength(1);
    expect(screen.getByText(/1 node/)).toBeTruthy();
    expect(screen.getByText(/video\/mp4 → audio\/mpeg/)).toBeTruthy();
  });

  it("two hops: two cards, plural copy", () => {
    stage([hop("video/quicktime", "video/mp4"), hop("video/mp4", "video/webm")]);
    render(<ConverterPreviewDialog />);
    expect(screen.getAllByTestId("hop-card")).toHaveLength(2);
    expect(screen.getByText(/2 nodes/)).toBeTruthy();
  });

  it("cancel clears the staged path without inserting", () => {
    stage([hop("video/mp4", "audio/mpeg")]);
    render(<ConverterPreviewDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useGraphStore.getState().pendingConverter).toBeNull();
    expect(useGraphStore.getState().nodes).toHaveLength(0);
  });

  it("the confirm button calls insert, not cancel", () => {
    let inserted = 0;
    useGraphStore.setState({ insertConverterPath: () => { inserted++; } });
    stage([hop("video/mp4", "audio/mpeg")]);
    render(<ConverterPreviewDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Insert converter" }));
    expect(inserted).toBe(1);
  });
});
