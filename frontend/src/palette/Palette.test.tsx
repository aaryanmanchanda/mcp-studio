import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { NodeManifest } from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Palette } from "./Palette";

// A single mutable fake store state. vi.hoisted runs before the vi.mock factory
// (which is itself hoisted above the imports), so the factory can close over it.
const h = vi.hoisted(() => ({
  state: {
    registryStatus: "ready" as "idle" | "loading" | "ready" | "error",
    manifestRegistry: [] as NodeManifest[],
    registryError: null as string | null,
    fetchRegistry: vi.fn(),
  },
}));

vi.mock("@/store/graphStore", () => ({
  // The component calls useGraphStore((s) => s.someSlice) four times; each call
  // just runs the selector against our fake state.
  useGraphStore: (selector: (s: typeof h.state) => unknown) => selector(h.state),
}));

const manifest = (id: string, category: string) =>
  ({ id, category }) as NodeManifest;

// the demo nodes the palette offers, plus the Convert category which is empty once format-converter is hidden
const DEMO_NODES = [
  manifest("youtube-download", "Sources"),
  manifest("groq-transcribe", "Processing"),
  manifest("gemini-notes", "Processing"),
  manifest("email-send", "Sinks"),
];

function renderPalette() {
  return render(
    <TooltipProvider>
      <Palette />
    </TooltipProvider>,
  );
}

describe("Palette", () => {
  beforeEach(() => {
    h.state.registryStatus = "ready";
    h.state.manifestRegistry = [];
    h.state.registryError = null;
    h.state.fetchRegistry.mockClear();
  });

  it("loading state renders skeleton placeholders, no node content", () => {
    h.state.registryStatus = "loading";
    renderPalette();

    expect(screen.getAllByTestId("palette-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("YouTube Scraper")).toBeNull();
  });

  it("error state renders the registry-load-failure copy", () => {
    h.state.registryStatus = "error";
    h.state.registryError = "connect ECONNREFUSED 127.0.0.1:8080";
    renderPalette();

    expect(
      screen.getByText("Couldn't load the node registry."),
    ).toBeInTheDocument();
    // raw transport detail must not leak into the UI (T-02-13)
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();
  });

  it("empty state (ready, zero manifests) renders its own distinct copy", () => {
    h.state.registryStatus = "ready";
    h.state.manifestRegistry = [];
    renderPalette();

    expect(
      screen.getByText("No nodes available in the registry."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't load the node registry."),
    ).toBeNull();
  });

  it("populated state groups the demo nodes into sections in fixed order", () => {
    h.state.registryStatus = "ready";
    h.state.manifestRegistry = DEMO_NODES;
    renderPalette();

    const headers = screen.getAllByRole("heading").map((el) => el.textContent);
    expect(headers).toEqual(["Sources", "Processing", "Sinks"]);
    expect(screen.getByText("Youtube Download")).toBeInTheDocument();
  });

  it("hides nodes with no runner behind them, and the converter that is only ever auto-inserted", () => {
    h.state.registryStatus = "ready";
    h.state.manifestRegistry = [
      ...DEMO_NODES,
      manifest("youtube-scraper", "Sources"),
      manifest("relevance-filter", "Processing"),
      manifest("trim-clip", "Processing"),
      manifest("caption-generator", "Processing"),
      manifest("upload-post", "Sinks"),
      manifest("format-converter", "Convert"),
    ];
    renderPalette();

    for (const hidden of ["YouTube Scraper", "Relevance Filter", "Trim Clip", "Caption Generator", "Upload/Post", "Format Converter"]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    expect(screen.queryByRole("heading", { name: "Convert" })).toBeNull();
    expect(screen.getByText("Groq Transcribe")).toBeInTheDocument();
  });

  it("a category with zero manifests renders no section header", () => {
    h.state.registryStatus = "ready";
    h.state.manifestRegistry = [
      manifest("youtube-download", "Sources"),
      manifest("email-send", "Sinks"),
    ];
    renderPalette();

    expect(screen.queryByRole("heading", { name: "Processing" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Convert" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sources" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sinks" })).toBeInTheDocument();
  });

  it("clicking Retry re-invokes fetchRegistry", async () => {
    h.state.registryStatus = "error";
    renderPalette();
    h.state.fetchRegistry.mockClear(); // ignore the one mount-effect call

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(h.state.fetchRegistry).toHaveBeenCalledTimes(1);
  });
});
