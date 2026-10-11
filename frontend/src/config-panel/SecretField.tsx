import { useState } from "react";
import type { ConfigFieldDef } from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfigStore } from "./configStore";

export function SecretField({
  nodeId,
  field,
}: {
  nodeId: string;
  field: ConfigFieldDef;
}) {
  const [buffer, setBuffer] = useState(""); //the raw credential lives here and nowhere else, gone on unmount (D-07)
  const configured = useConfigStore(
    (s) => s.configured[nodeId]?.[field.name] === true, //node may have no entry yet, so ?. then === true makes it a plain boolean
  );
  const setConfigured = useConfigStore((s) => s.setConfigured);
  const id = `${nodeId}-${field.name}`; //ties the label to the input

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setBuffer(next);
    setConfigured(nodeId, field.name, next !== ""); //only a boolean leaves this component, never the characters
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
            Value entered {/* states a fact, claims nothing about storage (pre-vault) */}
          </span>
        )}
      </div>
      <Input
        id={id}
        type="password" //display-only masking, the write-only part is the local buffer
        value={buffer} //controlled by local state, so a fresh mount is always empty
        onChange={handleChange}
      />
    </div>
  );
}
