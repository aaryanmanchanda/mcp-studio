import { X } from "lucide-react";
import { useReactFlow, ViewportPortal } from "@xyflow/react";

import { useGraphStore } from "@/store/graphStore";

// D-11: a connection the resolver refused. Rendered inside the viewport (so it
// pans/zooms with the canvas), floating just above the target node — clear of
// the input sockets the user dropped on — never a global toast. Dismisses on
// its own ×, on a pane click, or when a new connection gesture starts (Canvas
// wires those); never on a timer.
export function BlockedConnectionMessage() {
  const message = useGraphStore((s) => s.blockedMessage);
  const dismiss = useGraphStore((s) => s.dismissBlockedMessage);
  const { getNode } = useReactFlow();

  if (!message) return null;
  const node = getNode(message.nodeId);
  if (!node) return null;

  const unresolved =
    message.fromType === "unknown" || message.toType === "unknown";

  return (
    <ViewportPortal>
      <div
        style={{
          position: "absolute",
          // sit above the node: move to the node's top-left, then shift up by
          // this box's own height + an 8px gap
          transform: `translate(${node.position.x}px, ${node.position.y}px) translate(0, calc(-100% - 8px))`,
          width: 260,
          background: "#ffffff",
        }}
        className="pointer-events-auto rounded-lg border border-destructive p-3 text-xs leading-relaxed text-foreground shadow-sm"
      >
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="absolute right-1 top-1 text-neutral-400 hover:text-foreground"
        >
          <X size={12} />
        </button>

        <div className="flex gap-2 pr-3">
          <span
            aria-hidden
            className="mt-1 size-1.5 shrink-0 rounded-full bg-destructive"
          />
          {unresolved ? (
            <p>{message.reason}</p>
          ) : (
            <p>
              No conversion path exists between{" "}
              <span className="font-mono">{message.fromType}</span> and{" "}
              <span className="font-mono">{message.toType}</span>. Try wiring
              compatible sockets, or check the palette for a converter that
              bridges these two types.
            </p>
          )}
        </div>
      </div>
    </ViewportPortal>
  );
}
