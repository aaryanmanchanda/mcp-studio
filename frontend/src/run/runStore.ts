import { create } from "zustand";
import { ConnectError, Code } from "@connectrpc/connect";

import { useConfigStore } from "@/config-panel/configStore";
import { fromGraphJson, toGraphJson } from "@/pipeline/serialize";
import { orchestratorClient } from "@/rpc/orchestratorClient";
import { useGraphStore } from "@/store/graphStore";

// one saved pipeline slot for the PoC. the orchestrator keys pipelines by id, so more slots later is just more ids
export const PIPELINE_ID = "default";

export type RunPhase = "idle" | "saving" | "running" | "succeeded" | "failed";
export interface NodeRun {
  status: string; //queued | running | succeeded | failed
  detail: string; //an output preview, or the error
}

interface RunState {
  phase: RunPhase;
  message: string; //one line for the bar: "Saved", an error, the run verdict
  nodeRuns: Record<string, NodeRun>; //by node id, drives the badges on the canvas and the results panel
  panelOpen: boolean;

  save: () => Promise<boolean>;
  load: () => Promise<void>;
  refreshSecrets: () => Promise<void>;
  run: () => Promise<void>;
  closePanel: () => void;
}

// connect errors carry the server's plain message in rawMessage (no "[invalid_argument]" prefix)
const messageOf = (e: unknown) => (e instanceof ConnectError ? e.rawMessage : e instanceof Error ? e.message : String(e));

export const useRunStore = create<RunState>((set, get) => ({
  phase: "idle",
  message: "",
  nodeRuns: {},
  panelOpen: false,

  save: async () => {
    const { nodes, edges } = useGraphStore.getState();
    const graphJson = toGraphJson(nodes, edges, useConfigStore.getState().values);
    try {
      await orchestratorClient.savePipeline({ pipeline: { id: PIPELINE_ID, graphJson } });
      set({ message: "Saved" });
      return true;
    } catch (e) {
      set({ phase: "failed", message: `Could not save: ${messageOf(e)}` });
      return false;
    }
  },

  refreshSecrets: async () => {
    try {
      const res = await orchestratorClient.listSecretStatus({});
      useConfigStore.getState().replaceConfigured(res.configured.map((c) => ({ nodeId: c.nodeId, field: c.field })));
    } catch {
      // no database configured yet: nothing is saved, so nothing is flagged
    }
  },

  load: async () => {
    try {
      const res = await orchestratorClient.getPipeline({ id: PIPELINE_ID });
      const { nodes, edges, values } = fromGraphJson(res.pipeline?.graphJson ?? "{}", useGraphStore.getState().manifestRegistry);
      useGraphStore.getState().loadGraph(nodes, edges);
      useConfigStore.getState().replaceValues(values);
      set({ message: `Loaded ${nodes.length} node${nodes.length === 1 ? "" : "s"}` });
    } catch (e) {
      if (e instanceof ConnectError && e.code === Code.NotFound) return; //nothing saved yet is normal
      set({ message: `Could not load: ${messageOf(e)}` });
    }
    await get().refreshSecrets();
  },

  run: async () => {
    if (get().phase === "running" || get().phase === "saving") return;
    set({ phase: "saving", message: "Saving…", nodeRuns: {}, panelOpen: true });
    if (!(await get().save())) return;

    try {
      const { runId } = await orchestratorClient.startRun({ pipelineId: PIPELINE_ID });
      set({ phase: "running", message: "Running…" });
      for await (const ev of orchestratorClient.watchRun({ runId })) {
        if (ev.nodeId === "") { //an event about the run itself is its final verdict
          set({ phase: ev.status === "succeeded" ? "succeeded" : "failed", message: ev.detail });
        } else {
          set((s) => ({ nodeRuns: { ...s.nodeRuns, [ev.nodeId]: { status: ev.status, detail: ev.detail } } }));
        }
      }
    } catch (e) {
      set({ phase: "failed", message: messageOf(e) }); //validation errors from StartRun land here, e.g. "input x is not connected"
    }
  },

  closePanel: () => set({ panelOpen: false }),
}));
