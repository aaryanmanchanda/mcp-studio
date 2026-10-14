import { beforeEach, describe, expect, it } from "vitest";

import { storageDump } from "@/test/storage";
import { useConfigStore } from "./configStore";

beforeEach(() => {
  localStorage.clear();
  useConfigStore.setState({ values: {}, configured: {} });
});

describe("configStore persistence boundary", () => {
  it("persists non-secret values and nothing else, under exactly one storage key", () => {
    useConfigStore.getState().setValue("n1", "model", "whisper-large-v3-turbo");
    useConfigStore.getState().setConfigured("n1", "groq_api_key", true);

    expect(Object.keys(storageDump())).toEqual(["mcpstudio-config"]);
    const payload = JSON.parse(localStorage.getItem("mcpstudio-config")!);
    expect(payload.state.values.n1.model).toBe("whisper-large-v3-turbo");
    expect(payload.state).not.toHaveProperty("configured"); //the vault is the source of truth for these, rebuilt on load
  });

  it("replaceConfigured rebuilds the flags from the vault's list", () => {
    useConfigStore.getState().replaceConfigured([
      { nodeId: "a", field: "groq_api_key" },
      { nodeId: "a", field: "other" },
      { nodeId: "b", field: "gemini_api_key" },
    ]);
    expect(useConfigStore.getState().configured).toEqual({
      a: { groq_api_key: true, other: true },
      b: { gemini_api_key: true },
    });
  });

  it("clearNode drops both maps for that node only", () => {
    const s = useConfigStore.getState();
    s.setValue("a", "x", 1);
    s.setValue("b", "x", 2);
    s.setConfigured("a", "k", true);
    s.clearNode("a");
    expect(useConfigStore.getState().values).toEqual({ b: { x: 2 } });
    expect(useConfigStore.getState().configured).toEqual({});
  });
});
