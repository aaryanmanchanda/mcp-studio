# mcp_studio

An open-source, self-hostable visual pipeline builder that lets users compose
automations out of MCP (Model Context Protocol) tools using a node-and-wire
canvas. Users drag MCP-wrapped tool nodes onto a canvas, wire inputs/outputs
together, configure each node with their own enterprise API credentials
(BYOK), and run the pipeline. It's an integrator, not a wrapper: the platform
never holds a shared API key, never bills usage on the user's behalf, and
never takes custody of enterprise accounts.

## Status

**In active development — not yet a working end-to-end product.** What's built
and verified so far:

- A single proto contract (`proto/`) generating compiling Go, TypeScript, and
  Python clients via `buf`, with CI gates (`buf lint`/`buf breaking`,
  generated-code staleness) blocking schema drift before merge
- A cross-language gRPC round-trip proof (`scripts/roundtrip.sh`) between the
  Go orchestrator and a Python runner stub
- A live Connect-RPC node-manifest registry (`orchestrator/cmd/manifestserver`)
  serving six fixture node definitions, purpose-built so their sockets exercise
  all four cases the canvas's compatibility engine will need to resolve: exact
  content-type/schema match, a rule-based shape adapter, a multi-hop converter
  chain, and a genuinely incompatible pair — proven live with
  `scripts/manifests.sh`

**Not built yet:** the canvas itself, the compatibility resolver, a secrets
vault, the config panel, and running real nodes end-to-end. Currently in
Phase 2 of a six-phase build.

## Proto contract

The frontend, orchestrator (Go), and runners (Python/TypeScript) all talk to
each other over a single set of contracts defined once, in one language:
[Protocol Buffers](https://protobuf.dev/), compiled with
[buf](https://buf.build/).

### Layout

```
proto/                  <- source of truth: .proto files, hand-written
  mcpstudio/v1/*.proto
gen/                     <- generated code, committed, never hand-edited
  go/                     Go structs + gRPC/Connect service stubs
  ts/                     TypeScript types + Connect-RPC client stubs
  python/                 Python protobuf messages + gRPC stubs
```

Nothing outside `proto/` is ever edited by hand. If a message, field, or RPC
needs to change, it changes in the `.proto` file first, then gets
regenerated.

### Regenerating

```bash
buf generate
```

Run from the repo root. Reads `buf.yaml` (the workspace/module config) and
`buf.gen.yaml` (which plugins to run, and where each language's output
lands), and rewrites everything under `gen/`. **Generated code is committed
to git** — this is deliberate, not an oversight: it lets a plain `git diff`
show schema drift directly, and lets someone pull the repo and build without
needing buf installed at all. It also means the one rule that matters is:
**never hand-edit anything under `gen/`.** Change the `.proto` source and
regenerate instead.

### CI gates

Every pull request runs two required checks, defined in
[`.github/workflows/proto.yml`](.github/workflows/proto.yml):

- **`buf-lint-breaking`** — runs `buf lint` (style/consistency rules) and
  `buf breaking` against the schema on `main`. Fails the build if a proto
  change would break an already-generated client (e.g. removing a field,
  changing a field's number or type, renaming an RPC).
- **`gen-not-stale`** — re-runs `buf generate` from a clean checkout and
  fails if the freshly generated output differs from what's committed under
  `gen/`. This catches both a hand-edited generated file and a `.proto`
  change that someone forgot to regenerate for.

Both gates are enforced as **required status checks** on `main` (configured
in GitHub branch protection, not in the workflow file itself) — a PR that
fails either one cannot be merged.

### Cross-language round-trip proof

```bash
bash scripts/roundtrip.sh
```

Starts a throwaway Python gRPC server implementing the generated `Runner`
service, runs a Go client against it over the generated `ExecuteNode`
contract, and exits with the client's exit code. This is the concrete proof
that the proto contract actually works end-to-end across languages, not just
that each language's generated code compiles in isolation.
