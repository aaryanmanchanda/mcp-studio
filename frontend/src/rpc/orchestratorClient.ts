import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { Orchestrator } from "@mcpstudio/gen-ts/mcpstudio/v1/orchestrator_pb";

// Proxied to the Go manifest server by vite.config.ts's server.proxy —
// keeps every RPC call same-origin in dev, no CORS needed on the Go side.
const transport = createConnectTransport({ baseUrl: "/rpc" });

export const orchestratorClient = createClient(Orchestrator, transport);
