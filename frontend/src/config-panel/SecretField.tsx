import { useState } from "react";
import type { ConfigFieldDef } from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orchestratorClient } from "@/rpc/orchestratorClient";
import { useConfigStore } from "./configStore";

export function SecretField({
  nodeId,
  field,
}: {
  nodeId: string;
  field: ConfigFieldDef;
}) {
  const [buffer, setBuffer] = useState(""); //the raw credential lives here and nowhere else, gone on unmount (D-07)
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const configured = useConfigStore(
    (s) => s.configured[nodeId]?.[field.name] === true, //node may have no entry yet, so ?. then === true makes it a plain boolean
  );
  const setConfigured = useConfigStore((s) => s.setConfigured);
  const id = `${nodeId}-${field.name}`; //ties the label to the input

  // the one and only place a credential leaves this component: sent once to the orchestrator, which encrypts it in the vault.
  // nothing ever sends it back, the server's answer is just "configured"
  async function save() {
    if (buffer === "" || saving) return;
    setSaving(true);
    setError(null);
    try {
      await orchestratorClient.setSecret({ nodeId, field: field.name, value: buffer });
      setConfigured(nodeId, field.name, true); //a boolean, never the characters
      setBuffer(""); //it's in the vault now, so the page forgets it
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save"); //keep the buffer so retrying is one click
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs font-normal text-neutral-500">
          {field.name}
        </Label>
        {configured && ( //false && x renders nothing
          <span className="flex items-center gap-1.5 rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600">
            <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
            Saved to vault
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password" //display-only masking, the write-only part is the local buffer
          autoComplete="off"
          value={buffer} //controlled by local state, so a fresh mount is always empty
          onChange={(e) => setBuffer(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
        />
        <Button variant="outline" disabled={buffer === "" || saving} onClick={() => void save()}>
          {saving ? "Saving…" : configured ? "Replace" : "Save"}
        </Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
