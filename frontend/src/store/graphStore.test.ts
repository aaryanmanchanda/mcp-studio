import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NodeManifest } from '@mcpstudio/gen-ts/mcpstudio/v1/manifest_pb';
import { useGraphStore } from './graphStore';
import { orchestratorClient } from '@/rpc/orchestratorClient';

// Replace the whole RPC-client module. vi.mock is hoisted above the imports,
// so the real orchestratorClient.ts (which builds a Connect transport at
// import time) never loads — these tests need no running server.
vi.mock('@/rpc/orchestratorClient', () => ({
  orchestratorClient: { listNodeManifests: vi.fn() },
}));

const listManifests = vi.mocked(orchestratorClient.listNodeManifests);

// The generated response is a protobuf Message (it carries a `$typeName` brand
// and more). The store only touches `.manifests`, so we build a minimal object
// and cast it to the real return type rather than hand-construct a full Message.
type ListResponse = Awaited<
  ReturnType<typeof orchestratorClient.listNodeManifests>
>;
const sixManifests = Array.from(
  { length: 6 },
  (_, i) => ({ id: `node-${i}` }) as NodeManifest,
);
const okResponse = { manifests: sixManifests } as ListResponse;

describe('graphStore — registry slice', () => {
  beforeEach(() => {
    // The store is a module singleton shared by every test in this file.
    // Reset it to its initial shape and clear mock call history so each
    // test starts from `idle` with a fresh spy.
    useGraphStore.setState({
      manifestRegistry: [],
      registryStatus: 'idle',
      registryError: null,
    });
    vi.clearAllMocks();
  });

  it('success path: idle → loading → ready, and stores the manifests', async () => {
    listManifests.mockResolvedValueOnce(okResponse);

    expect(useGraphStore.getState().registryStatus).toBe('idle');

    // Don't await yet — fetchRegistry flips status to 'loading' synchronously
    // before it hits its first await, so we can observe the intermediate state.
    const pending = useGraphStore.getState().fetchRegistry();
    expect(useGraphStore.getState().registryStatus).toBe('loading');

    await pending;

    const state = useGraphStore.getState();
    expect(state.registryStatus).toBe('ready');
    expect(state.manifestRegistry).toHaveLength(6);
    expect(state.registryError).toBeNull();
  });

  it('error path: a rejected call sets status error and records the message', async () => {
    listManifests.mockRejectedValueOnce(new Error('registry unreachable'));

    await useGraphStore.getState().fetchRegistry();

    const state = useGraphStore.getState();
    expect(state.registryStatus).toBe('error');
    expect(state.registryError).toBe('registry unreachable');
    expect(state.manifestRegistry).toHaveLength(0);
  });

  it('retry: calling fetchRegistry again after an error re-issues the RPC', async () => {
    listManifests
      .mockRejectedValueOnce(new Error('registry unreachable'))
      .mockResolvedValueOnce(okResponse);

    await useGraphStore.getState().fetchRegistry();
    expect(useGraphStore.getState().registryStatus).toBe('error');

    // This is exactly what Task 3's Retry button does — call the action again.
    await useGraphStore.getState().fetchRegistry();

    expect(listManifests).toHaveBeenCalledTimes(2);
    expect(useGraphStore.getState().registryStatus).toBe('ready');
    expect(useGraphStore.getState().manifestRegistry).toHaveLength(6);
  });

  it('concurrent guard: a second call while one is in flight does not issue a second RPC', async () => {
    let resolve!: (value: ListResponse) => void;
    listManifests.mockReturnValueOnce(
      new Promise<ListResponse>((r) => {
        resolve = r;
      }),
    );

    const first = useGraphStore.getState().fetchRegistry();
    const second = useGraphStore.getState().fetchRegistry(); // bails on the loading guard

    resolve(okResponse);
    await Promise.all([first, second]);

    expect(listManifests).toHaveBeenCalledTimes(1);
    expect(useGraphStore.getState().registryStatus).toBe('ready');
  });
});
