# MCP Studio

**A visual pipeline builder for MCP tools.** Drag Model Context Protocol
tool-nodes onto a canvas, wire their inputs and outputs together, configure each
one with your own API credentials, and run the pipeline — Blender / ComfyUI
style, but MCP-native.

It's an **integrator, not a wrapper**: the platform never holds a shared API
key, never bills usage on your behalf, and never takes custody of your accounts.
Credentials are yours (BYOK), encrypted at rest, and never leave your instance.
Sharing a pipeline means exporting a file and handing it to someone — there is
no hosted registry, gallery, or account system.

The reference pipeline the whole thing is being built to run end-to-end:
*YouTube scraper → relevance filter → trim/clip → caption generator → format
converter → upload to YouTube Shorts.*

---

## Status

**In active development — not yet a working end-to-end product.** It is being
built in the open, one vertical phase at a time (6 phases total, currently in
Phase 2 of 6).

A first end-to-end proof of concept (lecture video to emailed notes, across YouTube, ffmpeg,
Groq, Gemini and Gmail) is built and runs headlessly with the paid vendors faked. See
[docs/POC.md](docs/POC.md) for how it works and how to run it.

### Working and verified

| Area | What's there |
|------|--------------|
| **Proto contract** | One set of `.proto` files generating compiling Go, TypeScript, and Python clients via `buf`, with CI gates (`buf lint` / `buf breaking` + a generated-code staleness check) that block schema drift before merge. |
| **Cross-language transport** | A Go ⇄ Python gRPC round-trip (`scripts/roundtrip.sh`) proving the generated `Runner` contract works across languages, not just that each side compiles. |
| **Node-manifest registry** | A live Connect-RPC endpoint (`orchestrator/cmd/orchestrator`) serving the node definitions whose sockets deliberately exercise all four cases the compatibility engine must resolve — exact match, shape adapter, multi-hop converter chain, and a genuinely incompatible pair. |
| **Secrets vault** | A stdlib-only AES-256-GCM envelope-encryption package (`orchestrator/internal/vault`), unit-tested for nonce uniqueness across 1,000 calls, tamper detection, wrong-key rejection, and key-size enforcement. Not yet wired to storage — that's Phase 3. |
| **Canvas** | A React Flow canvas fed entirely from a Zustand store: drag nodes from a category-grouped palette, move / select / delete them, and wire sockets. An exact content-type-and-schema match connects silently; an unreconcilable pair is refused with a reason anchored to the socket you aimed at. |
| **Compatibility engine** | A pure, framework-free resolver: it digs each socket down to a concrete `{ contentType, schemaJson }`, then decides `direct` / `shapeAdapter` / `converterPath` / `blocked` as a discriminated union. The `direct` and `blocked` paths are wired into the canvas; the rule-based field mapper (exact then case-insensitive name matching, no fuzzy) is done, and caching its result on the wire is in progress. |

### Not built yet

The shape-adapter wire UI, the config panel, the converter-chain BFS, saving and
running pipelines, and executing real nodes end-to-end.

---

## How it works

```
  ┌─────────────┐   Connect-RPC    ┌──────────────────┐   gRPC (streaming)   ┌──────────────┐
  │  Frontend   │ ───────────────► │   Orchestrator   │ ───────────────────► │   Runners    │
  │  React +    │                  │   (Go)           │                      │  Python /    │
  │  React Flow │                  │                  │                      │  TypeScript  │
  │  + Zustand  │ ◄─────────────── │  DAG scheduling, │ ◄─────────────────── │              │
  └─────────────┘                  │  fan-out streams │                      └──────┬───────┘
                                   └──────────────────┘                             │ MCP
                                                                                    │ (JSON-RPC / SSE)
                                                                             ┌──────▼───────┐
                                                                             │  3rd-party   │
                                                                             │  MCP tool    │
                                                                             │  servers     │
                                                                             └──────────────┘

        one proto contract  ──►  buf generate  ──►  Go + TypeScript + Python stubs
```

Three languages, one contract. The frontend, the Go orchestrator, and the
Python / TypeScript runners all talk over interfaces defined once as
[Protocol Buffers](https://protobuf.dev/) and compiled with
[buf](https://buf.build/).

### The proto contract

```
proto/                   source of truth — hand-written .proto files
  mcpstudio/v1/*.proto
gen/                      generated code — committed, never hand-edited
  go/                       Go structs + gRPC / Connect service stubs
  ts/                       TypeScript types + Connect-RPC client stubs
  python/                   Python protobuf messages + gRPC stubs
```

Nothing outside `proto/` is edited by hand. A message, field, or RPC change
happens in the `.proto` file first, then `buf generate` rewrites `gen/`.
**Generated code is committed to git** — deliberately: a plain `git diff` shows
schema drift directly, and anyone can clone and build without buf installed.

### CI gates

Every pull request runs two required status checks
([`.github/workflows/proto.yml`](.github/workflows/proto.yml)):

- **`buf-lint-breaking`** — `buf lint` plus `buf breaking` against `main`. Fails
  if a change would break an already-generated client (removing a field,
  changing a field number or type, renaming an RPC).
- **`gen-not-stale`** — re-runs `buf generate` from a clean checkout and fails if
  the output differs from what's committed under `gen/`. Catches both a
  hand-edited generated file and a `.proto` change nobody regenerated for.

Neither can be merged past on `main`.

---

## Running it locally

### Prerequisites

- **Go** 1.26+
- **Node** 22+ and **pnpm** 11 (`corepack enable`)
- **buf** 1.72+ — *optional*, only needed to regenerate proto stubs

### The canvas

```bash
pnpm install
scripts/dev.sh           # postgres + python runner + go orchestrator + frontend
                         # MCPSTUDIO_DRY_RUN=1 scripts/dev.sh to rehearse with no API keys
                         # full walkthrough of the demo pipeline: docs/POC.md
```

### Proofs and tests

```bash
bash scripts/roundtrip.sh      # Go <-> Python gRPC round-trip over the generated contract
bash scripts/manifests.sh      # the node-manifest registry, end to end
go test ./orchestrator/...     # includes the AES-256-GCM vault suite
pnpm test                      # frontend unit tests
```

---

## Repo layout

```
proto/                       hand-written contracts (source of truth)
gen/                         generated Go / TS / Python stubs (committed, never hand-edited)
orchestrator/
  cmd/orchestrator/          Connect-RPC server: registry, pipelines, vault, runs
  cmd/roundtrip/             cross-language gRPC round-trip client
  internal/vault/            AES-256-GCM envelope encryption
runners/python/              runner stub (gRPC server)
frontend/
  src/compatibility/         wire-compatibility engine (pure, framework-free)
  src/store/                 Zustand graph store
  src/canvas/                React Flow canvas, node cards, edge components
  src/palette/               node palette
scripts/                     roundtrip.sh, manifests.sh
.github/workflows/           proto drift CI gates
```

---

## How this is built — a note on AI assistance

This project is built in a deliberate pair-programming rhythm with
[Claude Code](https://claude.com/claude-code). The division of labour is
consistent and drawn on one line: **if writing something teaches me the domain
or the algorithm, I write it by hand; if it's framework boilerplate or test
plumbing that I could write but wouldn't learn from, Claude writes it and I
review it against the spec.**

### Written by hand

Every unit with domain logic, an algorithm, or a security-relevant decision:

- **The proto contracts** — `proto/mcpstudio/v1/*.proto`
- **The AES-256-GCM vault and its test suite** — `orchestrator/internal/vault/`
  (crypto tests are worth internalising, so this suite is hand-written too)
- **The Go manifest server and fixtures** — `orchestrator/internal/registry/`,
  `orchestrator/cmd/roundtrip/`
- **The compatibility engine** — socket resolution, the `resolveCompatibility`
  decision function, and the rule-based field mapper —
  `frontend/src/compatibility/{sockets,resolve,fieldMapping}.ts`
- **The graph store logic** — the Zustand slices and the `onConnect` connection
  handler — `frontend/src/store/graphStore.ts`
- **Client-side derivations** — e.g. `frontend/src/palette/displayName.ts`

### Written by Claude, reviewed by me

Scaffolding and coverage that is mechanical rather than instructive:

- **Frontend workspace bootstrap** — Vite / pnpm / Turborepo / Tailwind /
  shadcn config
- **The generated-client wrapper** — `frontend/src/rpc/orchestratorClient.ts`
- **React Flow component chrome** — the node card, canvas wrapper, edge
  components, and the blocked-connection popover — `frontend/src/canvas/`
  (`Palette.tsx` was drafted by Claude, then walked through mechanism by
  mechanism)
- **The frontend test suites** — ~50 Vitest unit tests across the resolver,
  store, palette, and canvas. Each is written from the plan's explicit
  behaviour spec, then reviewed against it.

Phase 1 (the proto toolchain) predates this split and was more blended —
hand-written proto with Claude assisting on `buf` lint-rule debugging, done
alongside a line-by-line walkthrough of the generated code to learn the
Go / gRPC / protobuf chain.

---

## License

TBD — this is pre-release. An OSI-approved license will be added before the
first tagged version.
