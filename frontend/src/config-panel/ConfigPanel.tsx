import { X } from "lucide-react";
import {
  ConfigFieldValueType,
  type ConfigFieldDef,
} from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORY_COLOR, CATEGORY_ICON } from "@/lib/categoryStyle";
import { displayName } from "@/palette/displayName";
import { useGraphStore } from "@/store/graphStore";
import { useConfigStore } from "./configStore";
import { SecretField } from "./SecretField";

// One non-secret field row. The widget comes from the field's declared value
// type; UNSPECIFIED (and anything unrecognised) falls through to a text input,
// which is the whole reason the zero value exists (D-04).
function FieldRow({ nodeId, field }: { nodeId: string; field: ConfigFieldDef }) {
  const value = useConfigStore((s) => s.values[nodeId]?.[field.name]);
  const setValue = useConfigStore((s) => s.setValue);
  const id = `${nodeId}-${field.name}`;

  let control: React.ReactNode;
  switch (field.valueType) {
    case ConfigFieldValueType.NUMBER:
      control = (
        <Input
          id={id}
          type="number"
          value={value === undefined ? "" : String(value)}
          onChange={(e) =>
            setValue(
              nodeId,
              field.name,
              e.target.value === "" ? "" : e.target.valueAsNumber,
            )
          }
        />
      );
      break;
    case ConfigFieldValueType.BOOLEAN:
      control = (
        <Checkbox
          id={id}
          checked={value === true}
          onCheckedChange={(checked) =>
            setValue(nodeId, field.name, checked === true)
          }
        />
      );
      break;
    case ConfigFieldValueType.ENUM:
      control = (
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={(v) => setValue(nodeId, field.name, v)}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {field.enumValues.map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    default:
      control = (
        <Input
          id={id}
          type="text"
          value={value === undefined ? "" : String(value)}
          onChange={(e) => setValue(nodeId, field.name, e.target.value)}
        />
      );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-normal text-neutral-500">
        {field.name}
      </Label>
      {control}
    </div>
  );
}

// Fixed 320px right column. Selection is owned by the graph store; this panel
// only reads it (and clears it via the close button).
export function ConfigPanel() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId);
  const node = useGraphStore((s) =>
    s.nodes.find((n) => n.id === s.selectedNodeId),
  );
  const manifest = useGraphStore((s) =>
    node ? s.manifestRegistry.find((m) => m.id === node.data.manifestId) : undefined,
  );

  if (!selectedNodeId || !node || !manifest) {
    return (
      <aside className="flex w-[320px] shrink-0 items-center justify-center border-l border-border bg-card p-4">
        <p className="text-center text-sm text-neutral-500">
          Select a node to configure it.
        </p>
      </aside>
    );
  }

  const Icon = CATEGORY_ICON[manifest.category];

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border p-4">
        {Icon && (
          <Icon
            size={16}
            style={{ color: CATEGORY_COLOR[manifest.category] }}
            aria-hidden
          />
        )}
        <h2 className="flex-1 truncate text-base font-semibold">
          {displayName(manifest.id)}
        </h2>
        <button
          type="button"
          aria-label="Close config panel"
          onClick={() => setSelectedNodeId(null)}
          className="flex size-11 items-center justify-center text-neutral-400 hover:text-foreground"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {manifest.configFields.map((f) =>
          f.secret ? (
            <SecretField key={f.name} nodeId={selectedNodeId} field={f} />
          ) : (
            <FieldRow key={f.name} nodeId={selectedNodeId} field={f} />
          ),
        )}
      </div>
    </aside>
  );
}
