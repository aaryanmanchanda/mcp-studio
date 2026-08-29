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

const SIX_FIXTURES = [
  manifest("youtube-scraper", "Sources"),
  manifest("relevance-filter", "Processing"),
  manifest("trim-clip", "Processing"),
  manifest("caption-generator", "Processing"),
  manifest("format-converter", "Convert"),
  manifest("upload-post", "Sinks"),
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

  it("populated state groups the six fixtures into four sections in fixed order", () => {
    h.state.registryStatus = "ready";
    h.state.manifestRegistry = SIX_FIXTURES;
    renderPalette();

    const headers = screen.getAllByRole("heading").map((el) => el.textContent);
    expect(headers).toEqual(["Sources", "Processing", "Convert", "Sinks"]);
    expect(screen.getByText("YouTube Scraper")).toBeInTheDocument();
  });

  it("a category with zero manifests renders no section header", () => {
    h.state.registryStatus = "ready";
    h.state.manifestRegistry = [
      manifest("youtube-scraper", "Sources"),
      manifest("upload-post", "Sinks"),
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
