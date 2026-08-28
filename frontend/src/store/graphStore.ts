import { create } from 'zustand';
import { orchestratorClient } from '@/rpc/orchestratorClient';
import type { NodeManifest } from '@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb';

type RegistryStatus = "idle" | "loading" | "ready" | "error";

interface GraphState{
  manifestRegistry: NodeManifest[];
  registryStatus: RegistryStatus;
  registryError: string | null;
  fetchRegistry: () => Promise<void>;
}

export const useGraphStore = create<GraphState>((set, get) => ({  //zustand
  manifestRegistry: [],
  registryStatus: "idle",
  registryError: null,
  fetchRegistry: async () => {
    if (get().registryStatus === "loading"){
      return;
    }
    set({ registryStatus: 'loading', registryError: null });

    try {
      const response = await orchestratorClient.listNodeManifests({}); //empty bc list function takes no inputs
      set({manifestRegistry: response.manifests, registryStatus: 'ready'})
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({registryStatus: "error", registryError: message})
    }
  },
}))
