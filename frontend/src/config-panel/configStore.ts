import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ConfigValue = string | number | boolean; //string(text,enum), number(number), boolean(checkbox)

type ByNode<T> = Record<string, Record<string, T>>; //{nodeid, {fieldname, value}}

interface ConfigState {
  values: ByNode<ConfigValue>; //non-secret field values
  configured: ByNode<boolean>; // was a secret field entered/set?

  setValue: (nodeId: string, field: string, value: ConfigValue) => void;
  setConfigured: (nodeId: string, field: string, configured: boolean) => void; //bool so we don't store any secret user creds
  clearNode: (nodeId: string) => void;
}

export const useConfigStore = create<ConfigState>()( // workaround for ts to infer both state and middleware type
  persist(
    (set) => ({
      values: {},
      configured: {},

      setValue: (nodeId, field, value) =>
        set((state) => ({
          values: {
            ...state.values,
            [nodeId]: {...state.values[nodeId], [field]: value}, // copy each changed level instead of mutating
          },
        })),

      setConfigured: (nodeId, field, configured) =>
        set((state) => ({
          configured: {
            ...state.configured,
            [nodeId]: {...state.configured[nodeId], [field]: configured},
          },
        })),

      clearNode: (nodeId) =>
        set((state) => {
          const { [nodeId]: _values, ...restValues } = state.values;
          const { [nodeId]: _configured, ...restConfigured } = state.configured;
          return { values: restValues, configured: restConfigured };
        }),
    }),
    {name: "mcpstudio-config", partialize: (state)=> ({values: state.values})}, //only public field values persist
  ),
);
