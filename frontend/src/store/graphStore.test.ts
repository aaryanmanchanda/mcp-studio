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

describe('graphStore — graph slice', () => {
  beforeEach(() => {
    useGraphStore.setState({ nodes: [], edges: [], selectedNodeId: null });
  });

  it('addNodeFromManifest: two drops of the same manifest are two independent nodes', () => {
    const { addNodeFromManifest } = useGraphStore.getState();
    addNodeFromManifest('youtube-scraper', { x: 0, y: 0 });
    addNodeFromManifest('youtube-scraper', { x: 100, y: 100 });

    const { nodes } = useGraphStore.getState();
    expect(nodes).toHaveLength(2);
    expect(nodes[0].id).not.toBe(nodes[1].id);
    expect(nodes[0].data.manifestId).toBe('youtube-scraper');
    expect(nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(nodes[1].position).toEqual({ x: 100, y: 100 });
  });

  it('deleteNode: an unknown id leaves state untouched and does not throw', () => {
    useGraphStore.getState().addNodeFromManifest('trim-clip', { x: 0, y: 0 });
    const before = useGraphStore.getState().nodes;

    expect(() => useGraphStore.getState().deleteNode('does-not-exist')).not.toThrow();
    // same array reference — the early return means no set() fired
    expect(useGraphStore.getState().nodes).toBe(before);
  });

  it('deleteNode: removes every edge incident to the deleted node', () => {
    const s = useGraphStore.getState();
    s.addNodeFromManifest('youtube-scraper', { x: 0, y: 0 });
    s.addNodeFromManifest('relevance-filter', { x: 200, y: 0 });
    s.addNodeFromManifest('trim-clip', { x: 400, y: 0 });
    const [a, b, c] = useGraphStore.getState().nodes;

    // seed edges directly — onConnect doesn't exist until Task 3
    useGraphStore.setState({
      edges: [
        { id: 'e1', source: a.id, target: b.id }, // a -> b  (incident to a)
        { id: 'e2', source: b.id, target: a.id }, // b -> a  (incident to a)
        { id: 'e3', source: b.id, target: c.id }, // b -> c  (untouched)
      ],
    });

    useGraphStore.getState().deleteNode(a.id);

    const { nodes, edges } = useGraphStore.getState();
    expect(nodes.map((n) => n.id)).toEqual([b.id, c.id]);
    expect(edges.map((e) => e.id)).toEqual(['e3']);
  });

  it('deleteNode: clears the selection when the deleted node was selected', () => {
    useGraphStore.getState().addNodeFromManifest('upload-post', { x: 0, y: 0 });
    const [node] = useGraphStore.getState().nodes;
    useGraphStore.getState().setSelectedNodeId(node.id);

    useGraphStore.getState().deleteNode(node.id);

    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });
});
