import {
  Handle,
  Position,
  useConnection,
  useNodeConnections,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import { X } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { resolveCompatibility } from "@/compatibility/resolve";
import { CATEGORY_COLOR, CATEGORY_ICON } from "@/lib/categoryStyle";
import { displayName } from "@/palette/displayName";
import { StatusIcon } from "@/run/RunBar";
import { useRunStore } from "@/run/runStore";
import { useGraphStore, type PipelineNode as PipelineNodeType } from "@/store/graphStore";

// One input/output socket row. The row is `relative` so the React Flow Handle
// (which RF positions `absolute`) anchors to this row's vertical centre rather
// than the card's — that is what spaces multiple handles down one edge.
function SocketRow({
  nodeId,
  name,
  side,
}: {
  nodeId: string;
  name: string;
  side: "source" | "target";
}) {
  const connections = useNodeConnections({ handleType: side, handleId: name });
  const connected = connections.length > 0;

  // While a wire is being dragged, preview whether dropping it on this handle
  // would connect or block — run through the same pure resolver `onConnect` uses.
  const connection = useConnection();
  const nodes = useGraphStore((s) => s.nodes);
  const registry = useGraphStore((s) => s.manifestRegistry);

  let drag: "none" | "valid" | "invalid" = "none";
  if (
    connection.inProgress &&
    connection.fromHandle.type !== side &&
    connection.fromHandle.nodeId !== nodeId
  ) {
    const from = connection.fromHandle;
    const pending: Connection =
      from.type === "source"
        ? { source: from.nodeId, sourceHandle: from.id ?? null, target: nodeId, targetHandle: name }
        : { source: nodeId, sourceHandle: name, target: from.nodeId, targetHandle: from.id ?? null };
    drag =
      resolveCompatibility(pending, nodes, registry).kind === "blocked"
        ? "invalid"
        : "valid";
  }

  const borderColor =
    drag === "invalid"
      ? "#dc2626"
      : drag === "valid" || connected
        ? "#171717"
        : "#a1a1a1";

  return (
    <div
      className={`relative flex min-h-[24px] items-center ${
        side === "target" ? "justify-start" : "justify-end"
      }`}
    >
      <Handle
        type={side}
        position={side === "target" ? Position.Left : Position.Right}
        id={name}
        style={{
          width: 10,
          height: 10,
          borderWidth: 2,
          borderColor,
          background: connected ? "#171717" : "#ffffff",
        }}
      />
      <span
        className={`truncate font-mono text-xs text-muted-foreground ${
          side === "target" ? "pl-4" : "pr-4"
        }`}
      >
        {name}
      </span>
    </div>
  );
}

export function PipelineNode({ id, data, selected }: NodeProps<PipelineNodeType>) {
  const manifest = useGraphStore((s) =>
    s.manifestRegistry.find((m) => m.id === data.manifestId),
  );
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const nodeRun = useRunStore((s) => s.nodeRuns[id]); //undefined until a run touches this node

  // Registry not loaded, or an unknown manifest id — render something inert
  // rather than throwing inside React Flow's render loop.
  if (!manifest) {
    return (
      <div className="w-[220px] rounded-lg border border-destructive bg-card p-3 text-sm text-muted-foreground">
        Unknown node: {data.manifestId}
      </div>
    );
  }

  const Icon = CATEGORY_ICON[manifest.category];
  const tint = CATEGORY_COLOR[manifest.category];
  const label = displayName(manifest.id);

  return (
    <div
      className={`group relative w-[220px] rounded-lg border border-border bg-card ${
        selected ? "ring-2 ring-primary ring-offset-2" : ""
      }`}
      style={{ borderLeftColor: tint, borderLeftWidth: 3 }}
    >
      <div className="flex h-10 items-center gap-2 px-3">
        {Icon ? (
          <Icon size={16} className="shrink-0" style={{ color: tint }} aria-hidden />
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate text-sm font-semibold">{label}</span>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </div>

      {/* 44px hit target; visible on hover or while selected. Positioned out of
          flow so it does not stretch the 40px header. */}
      <button
        type="button"
        aria-label="Delete node"
        onClick={() => deleteNode(id)}
        className={`absolute right-0 top-0 flex size-11 items-center justify-center text-neutral-400 transition-opacity hover:text-destructive ${
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <X size={16} />
      </button>

      {/* full-bleed rows so each Handle lands on the card edge; labels are
          inset past the dot in SocketRow */}
      {nodeRun && ( //live run status, mirrors the results panel
        <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          <StatusIcon status={nodeRun.status} />
          <span className={nodeRun.status === "failed" ? "text-destructive" : ""}>{nodeRun.status}</span>
        </div>
      )}

      <div className="flex flex-col gap-1 py-2">
        {manifest.inputs.map((s) => (
          <SocketRow key={`in-${s.name}`} nodeId={id} name={s.name} side="target" />
        ))}
        {manifest.outputs.map((s) => (
          <SocketRow key={`out-${s.name}`} nodeId={id} name={s.name} side="source" />
        ))}
      </div>
    </div>
  );
}
