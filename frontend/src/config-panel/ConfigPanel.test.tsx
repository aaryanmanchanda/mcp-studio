import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ConfigFieldValueType,
  type ConfigFieldDef,
  type NodeManifest,
} from "@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb";

import { useGraphStore, type PipelineNode } from "@/store/graphStore";
import { ConfigPanel } from "./ConfigPanel";
import { useConfigStore } from "./configStore";

const field = (
  name: string,
  valueType: ConfigFieldValueType,
  extra: Partial<ConfigFieldDef> = {},
) => ({ name, secret: false, authType: "none", valueType, enumValues: [], ...extra }) as ConfigFieldDef;

const manifest = {
  id: "relevance-filter",
  category: "Processing",
  inputs: [],
  outputs: [],
  converts: [],
  configFields: [
    field("model", ConfigFieldValueType.ENUM, { enumValues: ["1.2", "1.3"] }),
    field("min_score", ConfigFieldValueType.NUMBER),
    field("strict_mode", ConfigFieldValueType.BOOLEAN),
    field("note", ConfigFieldValueType.STRING),
    field("legacy", ConfigFieldValueType.UNSPECIFIED),
  ],
} as unknown as NodeManifest;

const node = {
  id: "n1",
  type: "pipelineNode",
  position: { x: 0, y: 0 },
  data: { manifestId: "relevance-filter" },
} as PipelineNode;

function select(nodeId: string | null) {
  useGraphStore.setState({
    manifestRegistry: [manifest],
    nodes: [node],
    selectedNodeId: nodeId,
  });
}

beforeEach(() => {
  localStorage.clear();
  useConfigStore.setState({ values: {}, configured: {} });
  select(null);
});

describe("ConfigPanel", () => {
  it("shows the placeholder when no node is selected", () => {
    render(<ConfigPanel />);
    expect(screen.getByText("Select a node to configure it.")).toBeTruthy();
  });

  it("renders the selected node's fields in manifest order", () => {
    select("n1");
    render(<ConfigPanel />);
    const labels = Array.from(document.querySelectorAll("label")).map(
      (l) => l.textContent,
    );
    expect(labels).toEqual(["model", "min_score", "strict_mode", "note", "legacy"]);
  });

  it("picks the widget for each declared value type", () => {
    select("n1");
    render(<ConfigPanel />);
    expect(screen.getByRole("combobox")).toBeTruthy(); // enum -> select
    expect(
      (screen.getByLabelText("min_score") as HTMLInputElement).type,
    ).toBe("number");
    expect(screen.getByRole("checkbox")).toBeTruthy(); // boolean
    expect((screen.getByLabelText("note") as HTMLInputElement).type).toBe("text");
  });

  it("renders an unspecified value type as a text input", () => {
    select("n1");
    render(<ConfigPanel />);
    expect((screen.getByLabelText("legacy") as HTMLInputElement).type).toBe("text");
  });

  it("closes via the close button", () => {
    select("n1");
    render(<ConfigPanel />);
    fireEvent.click(screen.getByLabelText("Close config panel"));
    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });

  it("round-trips a non-secret value through the persisted payload", () => {
    select("n1");
    render(<ConfigPanel />);
    fireEvent.change(screen.getByLabelText("note"), { target: { value: "hello" } });

    // grab what actually hit localStorage, wipe memory (which itself rewrites
    // storage), put the payload back, then rehydrate from it
    const payload = localStorage.getItem("mcpstudio-config")!;
    useConfigStore.setState({ values: {} });
    localStorage.setItem("mcpstudio-config", payload);
    useConfigStore.persist.rehydrate();
    expect(useConfigStore.getState().values.n1.note).toBe("hello");
  });
});
