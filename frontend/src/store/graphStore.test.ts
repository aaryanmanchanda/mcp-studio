import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('graphStore — onConnect', () => {
  const CLIP_LIST = 'application/vnd.mcpstudio.clip-list+json';
  const clipSchema = JSON.stringify({
    type: 'object',
    properties: {
      video_id: { type: 'string' },
      source_url: { type: 'string' },
      duration_sec: { type: 'number' },
    },
  });
  // relevance-filter.clips_out and trim-clip.clips_in per fixtures.go — same
  // content type, field names differ only in case for two of three fields.
  const schemaRelevanceOut = JSON.stringify({
    type: 'object',
    properties: {
      videoid: { type: 'string' },
      sourceurl: { type: 'string' },
      score: { type: 'number' },
    },
  });
  const schemaTrimIn = JSON.stringify({
    type: 'object',
    properties: {
      VideoId: { type: 'string' },
      SourceUrl: { type: 'string' },
      DurationSec: { type: 'number' },
    },
  });

  // fixture-shaped manifests — only the fields the resolver reads
  const MANIFESTS = [
    {
      id: 'youtube-scraper',
      inputs: [],
      outputs: [{ name: 'clips', contentType: CLIP_LIST, schemaJson: clipSchema }],
    },
    {
      id: 'relevance-filter',
      inputs: [{ name: 'clips_in', contentType: CLIP_LIST, schemaJson: clipSchema }],
      outputs: [{ name: 'clips_out', contentType: CLIP_LIST, schemaJson: schemaRelevanceOut }],
    },
    {
      id: 'trim-clip',
      inputs: [{ name: 'clips_in', contentType: CLIP_LIST, schemaJson: schemaTrimIn }],
      outputs: [{ name: 'clip', contentType: 'video/quicktime', schemaJson: '' }],
    },
    {
      id: 'caption-generator',
      inputs: [{ name: 'video_in', contentType: 'video/quicktime', schemaJson: '' }],
      outputs: [
        { name: 'captions', contentType: 'application/vnd.mcpstudio.captions+json', schemaJson: '{}' },
      ],
    },
    {
      id: 'upload-post',
      inputs: [{ name: 'video_in', contentType: 'video/webm', schemaJson: '' }],
      outputs: [],
    },
  ] as unknown as NodeManifest[];

  beforeEach(() => {
    useGraphStore.setState({
      manifestRegistry: MANIFESTS,
      nodes: [],
      edges: [],
      selectedNodeId: null,
      blockedMessage: null,
    });
  });

  function place(manifestId: string, id: string) {
    useGraphStore.setState({
      nodes: [
        ...useGraphStore.getState().nodes,
        { id, type: 'pipelineNode', position: { x: 0, y: 0 }, data: { manifestId } },
      ] as never,
    });
  }

  it('a direct-match connection adds exactly one edge, and repeating it adds no second', () => {
    place('youtube-scraper', 's');
    place('relevance-filter', 'r');
    const conn = { source: 's', sourceHandle: 'clips', target: 'r', targetHandle: 'clips_in' };

    useGraphStore.getState().onConnect(conn);
    expect(useGraphStore.getState().edges).toHaveLength(1);
    expect(useGraphStore.getState().blockedMessage).toBeNull();

    useGraphStore.getState().onConnect(conn);
    expect(useGraphStore.getState().edges).toHaveLength(1);
  });

  it('a shape-adapter connection creates one edge that already carries the mapping and both unmapped lists', () => {
    place('relevance-filter', 'r');
    place('trim-clip', 't');
    const conn = { source: 'r', sourceHandle: 'clips_out', target: 't', targetHandle: 'clips_in' };

    useGraphStore.getState().onConnect(conn);

    const { edges, blockedMessage } = useGraphStore.getState();
    expect(edges).toHaveLength(1);
    expect(blockedMessage).toBeNull();

    const edge = edges[0];
    expect(edge.type).toBe('shapeAdapter');
    // the mapping is present in the same tick the edge first appears — never a
    // half-populated edge, never a pending state
    expect(edge.data).toEqual({
      mapping: [
        { from: 'videoid', to: 'VideoId', via: 'caseInsensitive' },
        { from: 'sourceurl', to: 'SourceUrl', via: 'caseInsensitive' },
      ],
      unmappedSource: ['score'],
      unmappedTarget: ['DurationSec'],
    });

    // re-drawing the identical wire adds no second edge
    useGraphStore.getState().onConnect(conn);
    expect(useGraphStore.getState().edges).toHaveLength(1);
  });

  it('the store never re-infers a mapping: no buildFieldMapping reference, no infer/remap/recompute action', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/store/graphStore.ts'), 'utf8');
    // the mapping is computed once, inside resolveCompatibility, and only read here
    expect(src).not.toMatch(/buildFieldMapping/);

    const state = useGraphStore.getState() as unknown as Record<string, unknown>;
    const actionNames = Object.keys(state).filter((k) => typeof state[k] === 'function');
    expect(actionNames.filter((n) => /infer|remap|recompute/i.test(n))).toEqual([]);
  });

  it('a blocked connection adds no edge and sets blockedMessage anchored at the target', () => {
    place('caption-generator', 'c');
    place('upload-post', 'u');

    useGraphStore.getState().onConnect({
      source: 'c',
      sourceHandle: 'captions',
      target: 'u',
      targetHandle: 'video_in',
    });

    const { edges, blockedMessage } = useGraphStore.getState();
    expect(edges).toHaveLength(0);
    expect(blockedMessage).not.toBeNull();
    expect(blockedMessage?.nodeId).toBe('u');
    expect(blockedMessage?.handleId).toBe('video_in');
    expect(blockedMessage?.fromType).toBe('application/vnd.mcpstudio.captions+json');
    expect(blockedMessage?.toType).toBe('video/webm');
  });

  it('a second blocked attempt replaces the message rather than stacking, and dismiss clears it', () => {
    place('caption-generator', 'c');
    place('upload-post', 'u');
    place('relevance-filter', 'r');

    useGraphStore.getState().onConnect({ source: 'c', sourceHandle: 'captions', target: 'u', targetHandle: 'video_in' });
    const first = useGraphStore.getState().blockedMessage;

    useGraphStore.getState().onConnect({ source: 'c', sourceHandle: 'captions', target: 'r', targetHandle: 'clips_in' });
    const second = useGraphStore.getState().blockedMessage;

    expect(second).not.toBe(first);       // replaced, not appended (it's a single field)
    expect(second?.nodeId).toBe('r');

    useGraphStore.getState().dismissBlockedMessage();
    expect(useGraphStore.getState().blockedMessage).toBeNull();
  });
});
