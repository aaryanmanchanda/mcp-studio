import { Check, Loader2, Play, Save, X, CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { displayName } from "@/palette/displayName";
import { useGraphStore } from "@/store/graphStore";
import { useRunStore } from "./runStore";

// save / run controls plus the live results list. lives above the canvas, outside react flow
export function RunBar() {
  const { phase, message, nodeRuns, panelOpen, save, run, closePanel } = useRunStore();
  const nodes = useGraphStore((s) => s.nodes);
  const busy = phase === "saving" || phase === "running";

  const rows = nodes.filter((n) => nodeRuns[n.id]); //only nodes that took part, in canvas order

  return (
    <div className="absolute left-3 top-3 z-10 flex w-[380px] max-w-[calc(100%-1.5rem)] flex-col gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
        <Button size="sm" onClick={() => void run()} disabled={busy || nodes.length === 0}>
          {busy ? <Loader2 className="animate-spin" /> : <Play />}
          {phase === "running" ? "Running" : "Run"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void save()} disabled={busy}>
          <Save /> Save
        </Button>
        <span
          role="status"
          className={`min-w-0 flex-1 truncate text-xs ${phase === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          title={message}
        >
          {message}
        </span>
      </div>

      {panelOpen && (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-card p-3 text-xs shadow-sm" aria-label="Run results">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">Run results</span>
            <button type="button" aria-label="Close run results" onClick={closePanel} className="text-neutral-400 hover:text-foreground">
              <X size={14} />
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {rows.map((n) => {
              const r = nodeRuns[n.id];
              return (
                <li key={n.id} className="flex gap-2">
                  <span className="mt-0.5 shrink-0"><StatusIcon status={r.status} /></span>
                  <div className="min-w-0">
                    <div className="font-medium">{displayName(n.data.manifestId)}</div>
                    {r.detail && (
                      <div className={`break-words ${r.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{r.detail}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function StatusIcon({ status }: { status: string }) {
  if (status === "running") return <Loader2 size={14} className="animate-spin text-neutral-900" aria-label="running" />;
  if (status === "succeeded") return <Check size={14} className="text-emerald-600" aria-label="succeeded" />;
  if (status === "failed") return <CircleAlert size={14} className="text-destructive" aria-label="failed" />;
  return <span aria-label="queued" className="inline-block size-2.5 rounded-full border border-neutral-400" />;
}
