# MCP Pipeline Builder (mcp_studio)

## What This Is

An open-source, self-hostable visual pipeline builder that lets users compose automations out of MCP (Model Context Protocol) tools using a node-and-wire canvas — Blender/ComfyUI-style, but MCP-native. Users drag MCP-wrapped tool nodes onto a canvas, wire inputs/outputs together, configure each node with their own enterprise API credentials (BYOK), and run the pipeline. It's an integrator, not a wrapper: it never holds a shared platform API key, never bills usage on the user's behalf, and never takes custody of enterprise accounts.

There is no ownership or account model — it's a local sandbox for tinkering, not a multi-tenant SaaS. Sharing a pipeline with someone else means exporting it as a portable file and handing it to them directly; the platform never hosts a registry, gallery, or social layer.

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
- [ ] Pipelines save/load as serializable graph JSON (nodes, positions, wires, shape-adapter mappings, config references — never raw secrets); this is also the exact file format used for export/import sharing and for local "recent pipelines" persistence (FR-4)
- [ ] Export/import pipeline as a portable graph-JSON file: a CTA downloads the current pipeline, and importing it elsewhere reconstructs the same node layout and wiring exactly (positions are stored, not re-derived). Node types missing from the local install surface as flagged, unresolved placeholder nodes rather than failing the import. No hosted sharing/registry — the platform never stores or indexes who has which file (added post-brainstorm, 2026-07-30)
- [ ] Local persistence of recently-opened/saved pipelines, scoped to an opaque per-browser session token (no login, no account) rather than a user account — supports a "recent pipelines" list without any ownership model (added post-brainstorm, 2026-07-30)
- [ ] Node config panel: per-node BYOK credential + parameter entry from manifest-declared fields (FR-5)
- [ ] Credential fields masked in UI, never rendered back in plaintext (FR-6)
- [ ] Credentials encrypted at rest (AES-256-GCM envelope encryption), scoped to the local browser session (no login/account), excluded from exported graph JSON (FR-7)
- [ ] Nodes with missing/invalid config visually flagged before run (FR-8)
- [ ] Cost estimator: per-node pricing manifest, summed and displayed pre-run as a clearly-labeled estimate (FR-9, FR-10)
- [ ] Execution engine: topological sort of graph wiring, supports branching and fan-in (FR-12)
- [ ] Orchestrator↔runner communication over gRPC, streamed status/output per node (FR-13)
- [ ] Large binary payloads passed as object-storage references, never inlined (FR-14)
- [ ] Node failure surfaces clearly on that node in the canvas; default failure policy halts the run (FR-15)
- [ ] Run history retained per pipeline: start/end time, per-node status, error messages (FR-16)
- [ ] First-party v1 node set: YouTube scraper (yt-dlp), relevance/segment filter (Groq), trim/clip tool (ffmpeg), caption generator (vendor-swappable: ElevenLabs/Whisper default, Soundverse available via BYOK), format/aspect-ratio converter (ffmpeg/sharp), upload/post tool (YouTube Data API)
- [ ] Hosted demo deployable via `git clone && docker compose up`
- [ ] Single-node test execution: run one node in isolation (validate a BYOK credential/config) without executing the whole pipeline — added post-research (SRS gap, directly supports the cost estimator's value)
- [ ] Basic global concurrency cap on the ffmpeg transcode queue — a semaphore limiting simultaneous transcodes, added post-research to prevent the hosted demo crashing under a few concurrent visitors. Full smart throttling/prioritization stays deferred to Phase 2.

### Out of Scope

- Third-party node publishing/marketplace, sandboxed execution of untrusted code, review/moderation — deferred to Phase 3, a separate future track (SRS 3.8)
- Platform-side billing, metering enforcement, invoicing, payment processing, platform-enforced spend limits — never in scope; contradicts the BYOK/integrator positioning (SRS 3.3)
- Team/org accounts — explicitly out of scope for the initial build (SRS 1.4)
- Real-time multi-user collaborative editing — single-user pipelines for v1 (SRS 2.4)
- LLM-assisted shape-adapter mapping suggestions — deferred to v1.1, ships after rule-based matching proves out (SRS FR-3a)
- External KMS dependency (Vault/Infisical) for self-host — app-level envelope encryption is sufficient for v1; named only as a self-hoster upgrade path (locked decision, see Key Decisions)
- Actual post-run cost display from MCP usage data — optional secondary figure, not required for v1 (FR-11)
- Phase 2 scope (hardened secrets vault, richer run-history/error-surfacing polish, transcode concurrency throttling) — deferred until Phase 1 ships and informs Phase 2 scoping (locked decision, see Key Decisions). Multi-user auth/accounts is no longer part of any planned phase — see the no-ownership decision below, not a deferral.
- Hosted pipeline sharing/discovery (registry, public gallery, accounts-based ownership) — mcp_studio has no accounts model; sharing is peer-to-peer via exported graph-JSON files, and the platform never stores or indexes who has which pipeline (locked decision, see Key Decisions)

## Context

- Two-person team; Phase 1 (Public MVP) targeted at 6-8 weeks.
- Reference pipeline that must work end-to-end: YouTube scraper → relevance filter → trim/clip → caption generator → format converter → upload/post (YouTube Shorts).
- No personal/employee vendor credentials are ever committed to the repo, seed data, or the hosted demo — even the team's own dev credentials are entered at runtime through the same BYOK config panel a user would use.
- Converter nodes (ffmpeg via `fluent-ffmpeg`, `sharp` for images) run local/self-hosted compute — free in the cost estimate, no vendor dependency, ffmpeg bundled into the converter-runner's Docker image.
- Subtitle/caption format reshaping (`.srt` ↔ `.vtt`) is a shape adapter (structured text), not a converter node.
- **Resolved deviation (post-research):** the SRS's vendor shortlist (3.6) restricts Soundverse to the music/audio-gen row specifically *because* it has no confirmed public free tier, with the explicit constraint that it "must not be the node the public demo depends on to run end-to-end." Caption generation was initially assigned to Soundverse anyway (team preference, developer access already in hand), which put the accepted risk on the reference pipeline's critical path. Resolved by making the caption node **vendor-swappable**: the public hosted demo defaults to ElevenLabs (has an official MCP server) or OpenAI Whisper, while Soundverse remains available as a BYOK option for anyone with their own key. The demo now runs end-to-end without a paid key.
- Known scaling risk, not solved in Phase 1: ffmpeg transcoding is CPU-heavy; concurrent video nodes in one pipeline need queue throttling, deferred to Phase 2.
- **Sandbox positioning, no ownership model (resolved via brainstorm, 2026-07-30):** mcp_studio is a local tinkering tool, not a multi-tenant SaaS. There's no `users`/login table — pipelines and credentials are scoped to an opaque per-browser `local_sessions` token (no signup, no password), purely to support a local "recent pipelines" list. Sharing a pipeline happens entirely through exporting/importing the graph-JSON file (FR-4) — the platform never hosts a registry, gallery, or any record of who shared what with whom. Imported files are treated as untrusted input (schema/version validation, node types allowlisted against the local manifest registry, graph size capped).

## Constraints

- **Tech stack**: Frontend React+TypeScript+React Flow+Zustand+Tailwind; Orchestrator in Go; Runners in Python (media/ML nodes) or TypeScript (simple API-passthrough nodes); Frontend↔Orchestrator via Connect-RPC; Orchestrator↔Runner via gRPC/protobuf generated with `buf`; Runner↔third-party tool server via MCP (JSON-RPC over HTTP/SSE) — locked per SRS section 7, chosen to fit a 2-person/6-8 week scope.
- **Deliberately avoided**: Kubernetes, Temporal, HashiCorp Vault, microservices-per-node-type — disproportionate operational overhead for this team size and timeline (SRS 7).
- **Database**: PostgreSQL for pipelines, run history, node manifests, wire mappings — all scoped to an opaque `local_sessions` token, not a user-accounts table.
- **Secrets**: AES-256-GCM app-level envelope encryption, ciphertext in Postgres, no external KMS dependency for v1 (locked decision).
- **Object storage**: MinIO for self-host, S3 or R2 for the hosted demo.
- **Job orchestration**: BullMQ + Redis — retries and per-step state, and where transcode concurrency throttling will eventually live (Phase 2).
- **Auth**: None — mcp_studio has no login/account system. Pipelines and credentials are scoped to an opaque per-browser session token (`local_sessions.session_token`, generated client-side, no signup/password). Better Auth was originally locked in for this slot but is no longer needed now that ownership is out of scope (superseded decision, see Key Decisions).
- **Monorepo**: pnpm workspaces + Turborepo.
- **Deployment**: Docker Compose self-host + a single small VPS/Fly.io for the hosted demo.
- **Security**: credentials encrypted at rest, never logged, never included in exported graphs, TLS everywhere; imported pipeline files are treated as untrusted input — strict schema/version validation, node types allowlisted against the local manifest registry, graph size capped, nothing from the file is ever dynamically executed.
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
| Caption generation node is vendor-swappable: ElevenLabs/Whisper default, Soundverse via BYOK | Resolves the earlier Soundverse-only override of the SRS's "must not be demo-critical" constraint; hosted demo now runs end-to-end without a paid key, Soundverse still usable by anyone with their own key | ✓ Good |
| Upload/post node targets the YouTube Data API upload endpoint | Matches the reference pipeline (YouTube-to-shorts), free with developer app registration | — Pending |
| Auth uses Better Auth instead of the SRS's Lucia/Auth.js | Lucia deprecated by its maintainer (Mar 2025); Auth.js now security-patch-only under the Better Auth org, which itself points newcomers to Better Auth | ⊘ Superseded — see no-ownership decision below |
| Basic global concurrency cap added to the ffmpeg transcode queue in Phase 1 | Research found the hosted demo can crash with as few as 2 concurrent visitors without it; a semaphore is nearly free to add. Full smart throttling stays Phase 2 | — Pending |
| Single-node test execution added to Phase 1 scope | SRS gap identified by research; lets users validate one node's BYOK config without a full paid run, directly supporting the cost estimator's value | — Pending |
| No ownership/accounts model — pipelines and credentials scoped to an opaque per-browser `local_sessions` token instead of a `users` table | mcp_studio is a sandbox for tinkering, not a multi-tenant SaaS; sharing happens via file export/import (FR-4), not a hosted/owned pipeline registry | ✓ Good |
| Better Auth dropped — no login/account system needed | Directly follows from the no-ownership decision above; a full auth library has no job to do once there's no account to log into | ✓ Good |
| Pipeline export/import file format is the same graph JSON already required by FR-4, with an added schema-version header | Avoids maintaining two serialization formats; also means the importer must resolve missing node types gracefully rather than hard-failing, since files circulate outside the platform (Discord, GitHub, etc.) between installs with different node sets | ✓ Good |

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
*Last updated: 2026-07-30 after resolving the no-ownership/sandbox positioning and export/import sharing model*
