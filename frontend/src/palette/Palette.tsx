import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CATEGORIES, CATEGORY_COLOR, CATEGORY_ICON } from "@/lib/categoryStyle";
import { useGraphStore } from "@/store/graphStore";
import type { NodeManifest } from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";
import { displayName } from "./displayName";

// The key the palette writes the manifest id under on a drag. Plan 02-04's
// canvas reads exactly this key on drop — it is a contract, not a loose string.
export const PALETTE_DRAG_TYPE = "application/x-mcpstudio-node-id";

// Fixed section order (UI-SPEC D-03). A section renders only if it has >=1 node;
// the layout must not assume exactly these four are always populated.
const SECTION_ORDER = CATEGORIES;

// Nodes kept in the registry (the converter search and node rendering need them) but not offered for dragging.
// the first five are the canvas-only stubs from phase 2 with no runner behind them yet, so dragging one in can only fail at run time.
// format-converter is inserted by the converter search, never dragged by hand.
// to bring one back, delete its line here
const HIDDEN_FROM_PALETTE = new Set([
  "youtube-scraper",
  "relevance-filter",
  "trim-clip",
  "caption-generator",
  "upload-post",
  "format-converter",
]);

// ---------------------------------------------------------------------------

function PaletteRow({ manifest }: { manifest: NodeManifest }) {
  const Icon = CATEGORY_ICON[manifest.category];
  const label = displayName(manifest.id);

  return (
    <div
      draggable
      // Canvas onDrop (02-04) reads manifest.id back off this exact key.
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_DRAG_TYPE, manifest.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="flex h-10 cursor-grab items-center gap-2 px-2 hover:bg-accent"
    >
      {Icon ? (
        <Icon
          size={16}
          className="shrink-0"
          style={{ color: CATEGORY_COLOR[manifest.category] }}
          aria-hidden
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="truncate text-sm">{label}</span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function SkeletonSection() {
  return (
    <div className="px-2 py-2" data-testid="palette-skeleton">
      <div className="mb-2 h-3 w-16 animate-pulse rounded bg-muted" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-1 h-10 animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

function PaletteShell({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea className="h-full w-[240px] shrink-0 border-r border-border bg-card">
      {children}
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------

export function Palette() {
  const status = useGraphStore((s) => s.registryStatus);
  const registry = useGraphStore((s) => s.manifestRegistry);
  const manifests = registry.filter((m) => !HIDDEN_FROM_PALETTE.has(m.id)); //the store keeps the full list, only the palette trims it
  const registryError = useGraphStore((s) => s.registryError);
  const fetchRegistry = useGraphStore((s) => s.fetchRegistry);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  if (status === "idle" || status === "loading") {
    return (
      <PaletteShell>
        {SECTION_ORDER.map((section) => (
          <SkeletonSection key={section} />
        ))}
      </PaletteShell>
    );
  }

  if (status === "error") {
    // Raw transport detail goes to the console, never into the UI (T-02-13).
    if (registryError) console.error("[palette] registry load failed:", registryError);
    return (
      <PaletteShell>
        <div className="flex flex-col gap-2 p-4 text-sm">
          <p className="font-semibold">Couldn&apos;t load the node registry.</p>
          <p className="text-muted-foreground">
            Make sure the manifest server is running, then retry.
          </p>
          {/* Retry re-issues the RPC — not just an error clear (graphStore.test.ts). */}
          <Button variant="outline" size="sm" onClick={() => fetchRegistry()}>
            Retry
          </Button>
        </div>
      </PaletteShell>
    );
  }

  // status === "ready"
  if (manifests.length === 0) {
    return (
      <PaletteShell>
        <p className="p-4 text-sm text-muted-foreground">
          No nodes available in the registry.
        </p>
      </PaletteShell>
    );
  }

  return (
    <PaletteShell>
      {SECTION_ORDER.map((section) => {
        const inSection = manifests.filter((m) => m.category === section);
        if (inSection.length === 0) return null;
        return (
          <div key={section} className="py-2">
            <h2
              className="px-2 py-2 text-xs font-semibold uppercase tracking-wide"
              style={{ color: CATEGORY_COLOR[section] }}
            >
              {section}
            </h2>
            {inSection.map((m) => (
              <PaletteRow key={m.id} manifest={m} />
            ))}
          </div>
        );
      })}
    </PaletteShell>
  );
}
