# MCP Pipeline Builder (mcp_studio)

## What This Is

An open-source, self-hostable visual pipeline builder that lets users compose automations out of MCP (Model Context Protocol) tools using a node-and-wire canvas — Blender/ComfyUI-style, but MCP-native. Users drag MCP-wrapped tool nodes onto a canvas, wire inputs/outputs together, configure each node with their own enterprise API credentials (BYOK), and run the pipeline. It's an integrator, not a wrapper: it never holds a shared platform API key, never bills usage on the user's behalf, and never takes custody of enterprise accounts.

## Core Value

A user can compose, configure (BYOK), and run a working pipeline — starting with the reference YouTube-to-shorts pipeline — end to end, with the platform never touching their credentials or billing on their behalf.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Node canvas: add, move, delete, wire/unwire nodes (FR-1)
- [ ] Wire-compatibility checking on connect: exact content-type+schema match → connect; same type/different schema → shape adapter; different type → converter search; no relation → block (FR-2)
- [ ] Shape adapters: rule-based field-mapping proposal on the wire, cached in saved graph JSON, never re-inferred at runtime (FR-3a)
- [ ] Converter node search: BFS over the converter registry's `converts` pairs, inserts real cost-estimated converter nodes on the wire (FR-3b)
- [ ] Pipelines save/load as serializable graph JSON (nodes, positions, wires, shape-adapter mappings, config references — never raw secrets) (FR-4)
- [ ] Node config panel: per-node BYOK credential + parameter entry from manifest-declared fields (FR-5)
- [ ] Credential fields masked in UI, never rendered back in plaintext (FR-6)
- [ ] Credentials encrypted at rest (AES-256-GCM envelope encryption), scoped to owning user, excluded from exported graph JSON (FR-7)
- [ ] Nodes with missing/invalid config visually flagged before run (FR-8)
- [ ] Cost estimator: per-node pricing manifest, summed and displayed pre-run as a clearly-labeled estimate (FR-9, FR-10)
- [ ] Execution engine: topological sort of graph wiring, supports branching and fan-in (FR-12)
- [ ] Orchestrator↔runner communication over gRPC, streamed status/output per node (FR-13)
- [ ] Large binary payloads passed as object-storage references, never inlined (FR-14)
- [ ] Node failure surfaces clearly on that node in the canvas; default failure policy halts the run (FR-15)
- [ ] Run history retained per pipeline: start/end time, per-node status, error messages (FR-16)
- [ ] First-party v1 node set: YouTube scraper (yt-dlp), relevance/segment filter (Groq), trim/clip tool (ffmpeg), caption generator (Soundverse), format/aspect-ratio converter (ffmpeg/sharp), upload/post tool (YouTube Data API)
- [ ] Hosted demo deployable via `git clone && docker compose up`

### Out of Scope

- Third-party node publishing/marketplace, sandboxed execution of untrusted code, review/moderation — deferred to Phase 3, a separate future track (SRS 3.8)
- Platform-side billing, metering enforcement, invoicing, payment processing, platform-enforced spend limits — never in scope; contradicts the BYOK/integrator positioning (SRS 3.3)
- Team/org accounts — explicitly out of scope for the initial build (SRS 1.4)
- Real-time multi-user collaborative editing — single-user pipelines for v1 (SRS 2.4)
- LLM-assisted shape-adapter mapping suggestions — deferred to v1.1, ships after rule-based matching proves out (SRS FR-3a)
- External KMS dependency (Vault/Infisical) for self-host — app-level envelope encryption is sufficient for v1; named only as a self-hoster upgrade path (locked decision, see Key Decisions)
- Actual post-run cost display from MCP usage data — optional secondary figure, not required for v1 (FR-11)
- Phase 2 scope (hardened secrets vault, multi-user auth, run-history/error-surfacing polish, transcode concurrency throttling) — deferred until Phase 1 ships and informs Phase 2 scoping (locked decision, see Key Decisions)

## Context

- Two-person team; Phase 1 (Public MVP) targeted at 6-8 weeks.
- Reference pipeline that must work end-to-end: YouTube scraper → relevance filter → trim/clip → caption generator → format converter → upload/post (YouTube Shorts).
- No personal/employee vendor credentials are ever committed to the repo, seed data, or the hosted demo — even the team's own dev credentials are entered at runtime through the same BYOK config panel a user would use.
- Converter nodes (ffmpeg via `fluent-ffmpeg`, `sharp` for images) run local/self-hosted compute — free in the cost estimate, no vendor dependency, ffmpeg bundled into the converter-runner's Docker image.
- Subtitle/caption format reshaping (`.srt` ↔ `.vtt`) is a shape adapter (structured text), not a converter node.
- **Accepted deviation:** the SRS's vendor shortlist (3.6) restricts Soundverse to the music/audio-gen row specifically *because* it has no confirmed public free tier, with the explicit constraint that it "must not be the node the public demo depends on to run end-to-end." Caption generation was assigned to Soundverse anyway (team preference, developer access already in hand). Caption generation is on the reference pipeline's critical path, so **the public hosted demo may not be runnable end-to-end without a paid Soundverse key.** Revisit if a free-tier path opens up, or fall back to ElevenLabs (has an official MCP server) / OpenAI Whisper for the demo-facing caption node.
- Known scaling risk, not solved in Phase 1: ffmpeg transcoding is CPU-heavy; concurrent video nodes in one pipeline need queue throttling, deferred to Phase 2.

## Constraints

- **Tech stack**: Frontend React+TypeScript+React Flow+Zustand+Tailwind; Orchestrator in Go; Runners in Python (media/ML nodes) or TypeScript (simple API-passthrough nodes); Frontend↔Orchestrator via Connect-RPC; Orchestrator↔Runner via gRPC/protobuf generated with `buf`; Runner↔third-party tool server via MCP (JSON-RPC over HTTP/SSE) — locked per SRS section 7, chosen to fit a 2-person/6-8 week scope.
- **Deliberately avoided**: Kubernetes, Temporal, HashiCorp Vault, microservices-per-node-type — disproportionate operational overhead for this team size and timeline (SRS 7).
- **Database**: PostgreSQL for pipelines, run history, node manifests, wire mappings.
- **Secrets**: AES-256-GCM app-level envelope encryption, ciphertext in Postgres, no external KMS dependency for v1 (locked decision).
- **Object storage**: MinIO for self-host, S3 or R2 for the hosted demo.
- **Job orchestration**: BullMQ + Redis — retries and per-step state, and where transcode concurrency throttling will eventually live (Phase 2).
- **Auth**: Lucia or Auth.js — lightweight, self-hostable.
- **Monorepo**: pnpm workspaces + Turborepo.
- **Deployment**: Docker Compose self-host + a single small VPS/Fly.io for the hosted demo.
- **Security**: credentials encrypted at rest, never logged, never included in exported graphs, TLS everywhere.
- **Timeline**: 6-8 weeks for Phase 1, 2-person team.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Failure policy defaults to halting the whole run on a node failure | Simpler to reason about and debug for v1; partial results still preserved | — Pending |
| Self-host secrets use app-level AES-256-GCM envelope encryption in Postgres, no external KMS | Sufficient for v1; matches the `docker compose up` self-host goal; Vault/Infisical stays a named upgrade path, not a requirement | — Pending |
| GSD roadmap scoped to Phase 1 (Public MVP) only for now | Phase 2 scope depends on what's learned building Phase 1; avoids over-planning around untested assumptions | — Pending |
| Audit trail logs which NodeConfig/key was used per RunStep, with no spend tracking | Answers "who used which key, when" without the platform becoming a billing system in disguise | — Pending |
| YouTube scraper node uses yt-dlp, self-hosted | Free, no API quota limits, keeps the public demo runnable without a paid key | — Pending |
| Relevance/segment filter node uses Groq | Free-tier credits available; fastest inference among the three LLM options considered | — Pending |
| Caption generation node uses Soundverse | Team preference, existing developer access — **overrides the SRS's explicit constraint** that Soundverse must not be demo-critical; public hosted demo may not run end-to-end without a paid key for this node | ⚠️ Revisit |
| Upload/post node targets the YouTube Data API upload endpoint | Matches the reference pipeline (YouTube-to-shorts), free with developer app registration | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-18 after initialization*
