import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FieldMapping } from "@/compatibility/types";

// What onConnect parks on the edge (graphStore, shapeAdapter arm). Frozen at
// connect time on purpose (T-02-21), so this component only ever reads it.
export type ShapeAdapterEdgeData = {
  mapping: FieldMapping[];
  unmappedSource: string[];
  unmappedTarget: string[];
};

export type ShapeAdapterEdgeType = Edge<ShapeAdapterEdgeData, "shapeAdapter">;

export function badgeText(count: number): string {
  return `${count} ${count === 1 ? "field" : "fields"} mapped`;
}

// T-02-20: the badge count alone would hide dropped fields, so the inspector
// always lists what was left unmapped on both sides. Read-only by design.
function MappingInspector({ data }: { data: ShapeAdapterEdgeData }) {
  const { mapping, unmappedSource, unmappedTarget } = data;

  return (
    <ScrollArea className="max-h-64">
      <div className="flex flex-col gap-3 pr-2 text-xs">
        {mapping.length === 0 ? (
          <p className="text-muted-foreground">No fields auto-matched</p>
        ) : (
          <section>
            <h3 className="mb-1 font-medium">Mapped</h3>
            <ul className="flex flex-col gap-0.5 font-mono">
              {mapping.map((m) => (
                <li key={`${m.from}->${m.to}`}>
                  {m.from} → {m.to}
                  {m.via === "caseInsensitive" && (
                    <span className="ml-1 font-sans text-muted-foreground">
                      (case differs)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {unmappedSource.length > 0 && (
          <section>
            <h3 className="mb-1 font-medium">Source fields with nowhere to go</h3>
            <ul className="flex flex-col gap-0.5 font-mono">
              {unmappedSource.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </section>
        )}

        {unmappedTarget.length > 0 && (
          <section>
            <h3 className="mb-1 font-medium">Target fields left unfilled</h3>
            <ul className="flex flex-col gap-0.5 font-mono">
              {unmappedTarget.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ScrollArea>
  );
}

export function ShapeAdapterEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<ShapeAdapterEdgeType>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const mappedCount = data?.mapping.length ?? 0;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: "#171717", // neutral-900 accent: marks this wire as adapted
          strokeWidth: selected ? 3 : 1.5,
        }}
      />
      <EdgeLabelRenderer>
        <div
          // .nopan/.nodrag: clicks on the badge must not pan or drag the canvas
          className="nopan nodrag absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
        >
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded-full border border-neutral-900 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-900 shadow-sm hover:bg-neutral-100"
              >
                {badgeText(mappedCount)}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              {data ? (
                <MappingInspector data={data} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  No fields auto-matched
                </p>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
