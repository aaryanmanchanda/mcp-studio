import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CATEGORY_COLOR } from "@/lib/categoryStyle";
import { displayName } from "@/palette/displayName";
import { useGraphStore } from "@/store/graphStore";

// D-09: nothing is added until the user sees exactly which converter nodes would land and says yes.
// shows only while a path is staged, and it renders the staged hops, never a fresh search
export function ConverterPreviewDialog() {
  const pending = useGraphStore((s) => s.pendingConverter);
  const insert = useGraphStore((s) => s.insertConverterPath);
  const cancel = useGraphStore((s) => s.cancelConverterPath);

  const hops = pending?.hops ?? [];
  const n = hops.length;

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) cancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert converter path</DialogTitle>
          <DialogDescription>
            Inserting this path will add <strong>{n} {n === 1 ? "node" : "nodes"}</strong> to your canvas.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-col">
          {hops.map((hop, i) => (
            <li key={`${hop.nodeManifestId}-${i}`} className="flex flex-col items-center">
              <div className="flex w-full items-center gap-3 rounded-lg border border-border p-3" data-testid="hop-card">
                <RefreshCw size={16} style={{ color: CATEGORY_COLOR.Convert }} aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-semibold">{displayName(hop.nodeManifestId)}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {hop.from} → {hop.to}
                  </span>
                </div>
                <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600">Free</span>
              </div>
              {i < n - 1 && <div aria-hidden className="h-3 w-px bg-border" />}
            </li>
          ))}
        </ol>

        <DialogFooter>
          <Button variant="outline" onClick={cancel}>Cancel</Button>
          <Button onClick={insert}>Insert converter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
