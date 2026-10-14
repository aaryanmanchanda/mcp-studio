# The proof of concept, explained

This is the map of the first working demo. Read top to bottom once; after that use it as a reference.
Every section ends with where the code lives, so you can open the file and read it next to the explanation.

- [1. What the demo does](#1-what-the-demo-does)
- [2. Run it](#2-run-it)
- [3. The big picture](#3-the-big-picture)
- [4. The life of one run, step by step](#4-the-life-of-one-run-step-by-step)
- [5. The ideas, one at a time](#5-the-ideas-one-at-a-time)
- [6. File map](#6-file-map)
- [7. Data formats](#7-data-formats)
- [8. Security model](#8-security-model)
- [9. Tests, and what is not tested](#9-tests-and-what-is-not-tested)
- [10. Deliberate cuts and how to extend](#10-deliberate-cuts-and-how-to-extend)
- [11. Troubleshooting](#11-troubleshooting)
- [12. Demo-day checklist](#12-demo-day-checklist)

---

## 1. What the demo does

A weekly, repeatable job: **a lecture on YouTube becomes lecture notes in your inbox.**

```
YouTube Download ──mp4──▶ Format Converter ──mp3──▶ Groq Transcribe ──transcript──▶ Gemini Notes ──email──▶ Email Send
   (yt-dlp, no key)        (ffmpeg, no key)          (Whisper, key #1)   shape adapter   (Gemini, key #2)      (Gmail, app password)
```

You build it on the canvas by dragging nodes and wiring them. Two of the wires are not plain:

| Wire | What happens | Why it is the interesting part |
|---|---|---|
| YouTube Download → Groq Transcribe | video/mp4 does not fit an audio/mpeg socket, so the app searches for a chain of converters, shows a preview, and on confirm **inserts a real Format Converter node** | the compatibility engine's converter branch (BFS) |
| Groq Transcribe → Gemini Notes | same content type, different field names, so the app **maps the fields** and tells you which were dropped | the compatibility engine's shape-adapter branch |

Three credentials are needed and none of them ever lives in the browser after you press Save: they go to the orchestrator, which encrypts them into Postgres (the vault).

Vendors used, chosen as the cheapest that work: Groq Whisper (about $0.04 per audio hour, free tier available), Gemini Flash-Lite (free tier available), Gmail SMTP (free). YouTube download uses yt-dlp (free).

---

## 2. Run it

### Prerequisites

| Need | Check | Install |
|---|---|---|
| Go 1.26+ | `go version` | |
| Node 22+ and pnpm | `pnpm -v` | `corepack enable` |
| Docker (for Postgres) | `docker ps` | Docker Desktop |
| ffmpeg | `ffmpeg -version` | `brew install ffmpeg` |
| Python 3.12 | `python3 --version` | |

### Rehearse with no keys (dry run)

```bash
pnpm install
MCPSTUDIO_DRY_RUN=1 scripts/dev.sh
```

Open the URL it prints (normally http://localhost:5173; vite picks the next free port if that one is busy).
Dry run fakes **only** the three paid steps (Groq, Gemini, Gmail). The download (or a local file), the ffmpeg conversion, Postgres, the vault and the orchestrator-to-runner gRPC are all real.
In dry run the email is written to `data/artifacts/<run>/<node>/email.eml` instead of being sent.

For a fully headless version of the same thing, with no browser: `bash scripts/e2e.sh`.

### Run for real

```bash
scripts/dev.sh
```

First run creates `.env` with a new vault master key. **Back that file up.** Losing the key makes every stored credential unreadable (you would just re-enter them, nothing else is lost).

Keys you need, all free to create:

| Key | Where | Goes into node field |
|---|---|---|
| Groq API key | console.groq.com, API Keys | `groq_api_key` on Groq Transcribe |
| Gemini API key | aistudio.google.com, Get API key | `gemini_api_key` on Gemini Notes |
| Gmail app password | Google Account, Security, turn on 2-Step Verification, then App passwords | `gmail_app_password` on Email Send |

Also set `from_address` (your Gmail) and `to_address` on Email Send.

### Build the pipeline on the canvas

1. Drag **Youtube Download**, **Groq Transcribe**, **Gemini Notes**, **Email Send** from the palette.
2. Select Youtube Download, set `url` (a YouTube link, **or a path to a video file on your machine**, handy if the venue wifi is bad) and `max_minutes`.
3. Wire `video_out` to Groq's `audio_in`. A dialog previews the converter. Click **Insert converter**.
4. Wire Groq's `transcript` to Gemini's `transcript_in`. A badge on the wire says how many fields were mapped; click it to see what was dropped.
5. Wire Gemini's `email_out` to Email Send's `email_in`.
6. For each secret field type the key and press **Save**. The badge turns to "Saved to vault" and the box empties.
7. Press **Run**. Each node shows a live status, and the results panel shows a preview of each output.

The canvas is saved to Postgres when you press Save or Run, and restored when you reload the page.

---

## 3. The big picture

```
┌────────────────────────── browser (React) ───────────────────────────┐
│  canvas + palette + config panel + run bar                            │
│  zustand stores: graphStore (nodes/edges)  configStore  runStore      │
└───────────────┬───────────────────────────────────────────────────────┘
                │ Connect-RPC over HTTP  (vite proxies /rpc → :8787)
┌───────────────▼────────────── orchestrator (Go) ──────────────────────┐
│  server: ListNodeManifests  SavePipeline/GetPipeline                  │
│          SetSecret/ListSecretStatus   StartRun/WatchRun               │
│  registry (node definitions)   exec.Manager (the run engine)          │
│  store ──▶ Postgres  [pipelines, secrets(ciphertext)]   vault (AES)   │
└───────────────┬───────────────────────────────────────────────────────┘
                │ gRPC  (Runner.ExecuteNode, streams events back)
┌───────────────▼─────────────── runner (Python) ───────────────────────┐
│  one function per node type in nodes/                                 │
│  youtube.py  converter.py  groq.py  gemini.py  email_send.py          │
│  files go to data/artifacts/<run>/<node>/                             │
└───────────────┬───────────────────────────────────────────────────────┘
                │ HTTPS (direct vendor APIs; MCP wrapping is a later step)
            YouTube · ffmpeg · Groq · Gemini · Gmail
```

Three ideas hold it together:

1. **The registry is the single source of truth for node types.** The canvas, the validator and the runner all agree because the Go `registry` package defines the nodes once (sockets, content types, config fields) and serves them over RPC.
2. **The contract is protobuf.** `proto/mcpstudio/v1/*.proto` is the only hand-written interface. `buf generate` makes the Go, TypeScript and Python code from it, so the three languages cannot drift.
3. **The orchestrator never does vendor work; the runner never knows about pipelines.** The orchestrator decides *what runs when*; the runner is told "run this one node with these inputs and this config" and reports back.

---

## 4. The life of one run, step by step

You press **Run**. This is everything that happens, in order.

1. **Save.** `runStore.run()` calls `save()`: `toGraphJson` turns the canvas into JSON (react-flow nodes and edges, plus each node's non-secret config as strings) and `SavePipeline` upserts it into the `pipelines` table under the id `default`. *(frontend/src/run/runStore.ts, frontend/src/pipeline/serialize.ts, orchestrator/internal/store)*
2. **StartRun.** The orchestrator loads the saved graph and `exec.Manager.Start` does three checks *before* anything runs, so mistakes come back as a readable error and not a half-finished run:
   - **Parse** the JSON.
   - **Validate**: every node type exists in the registry; every wire points at real nodes; every declared input socket has a wire into it ("`groq-transcribe`: input `audio_in` is not connected").
   - **Order** the nodes (Kahn's algorithm): a node runs only after everything feeding it. A cycle is an error.
   *(orchestrator/internal/exec/graph.go)*
3. **A run id comes back** and the browser opens `WatchRun`, a server-streaming RPC. The run executes in a background goroutine; watchers get every event, including ones from before they connected (replay).
4. **For each node, in order**, `Manager.buildRequest` assembles one `ExecuteNodeRequest`:
   - **inputs**: for every wire into the node, take the upstream node's output for that socket. If the wire is a shape adapter, rename the fields using the mapping frozen on the wire; fields with no mapping are dropped (`ApplyMapping`).
   - **config**: the node's non-secret values, plus `hop_from`/`hop_to` for converter nodes.
   - **secrets**: for each config field the manifest marks secret, decrypt it from the vault (`store.GetSecret`). If it is missing the run fails with "groq_api_key is not set, enter it in the config panel".
5. **Call the runner** over gRPC. The runner dispatches on `manifest_id` (`server.py: NODES`), runs the node's `run(ctx)`, and streams back `RUNNING` then `SUCCEEDED` (with outputs and a short human `detail`) or `FAILED` (with a plain-language error).
6. **Report.** Each state change becomes a `RunEvent{node_id, status, detail}` that the browser receives live and paints on the node (spinner, tick, error) and in the results panel. A failed node stops the run; nothing downstream starts.
7. **Verdict.** The last event has `node_id = ""` and status `succeeded` or `failed`. That empty node id is the convention for "this event is about the run itself".

Outputs between nodes: small JSON is passed as `json_value`; big files (video, audio) are passed as a `blob_ref` holding a `file://` path on disk. The orchestrator never reads the files, it only passes the references along.

---

## 5. The ideas, one at a time

### 5.1 The compatibility engine (the canvas deciding if a wire is allowed)

`frontend/src/compatibility/resolve.ts` is one pure, synchronous function. Given two sockets it returns one of four answers:

| Answer | When | What the app does |
|---|---|---|
| `direct` | same content type and same shape (or a blob with no schema) | wires it |
| `shapeAdapter` | same content type, different field names | wires it and attaches a field mapping |
| `converterPath` | different content types, and a chain of converter nodes bridges them | previews the chain, inserts it on confirm |
| `blocked` | none of the above | refuses and explains, naming both types |

It checks them in that order, so the cheapest, most faithful answer wins.

### 5.2 The converter search (BFS)

`frontend/src/compatibility/bfs.ts`. Think of content types as **places** and each converter's declared pair (`video/mp4 → audio/mpeg`) as a **one-way road**. "Can I connect A to B?" is "is there a route from A to B?".

- `buildConverterGraph` turns the registry into a map: content type → roads leaving it.
- `findConverterPath` is **breadth-first search**: try every 1-road route, then every 2-road route, and so on. The first route that arrives is therefore a shortest one (fewest converter nodes).
- The **visited set** is what stops a loop in the registry (A→B, B→A) from hanging the page.
- Return values matter: `[]` = same type, nothing to do; `null` = no route.
- `findConverterPathCached` memoises answers per registry. It is only speed; delete it and everything still works.

Today one manifest, `format-converter`, declares all the roads (`quicktime→mp4`, `mp4→webm`, `mp4→audio/mpeg`). Add a road by adding a `ConverterPair` to a manifest in `orchestrator/internal/registry/phase2.go` **and** teaching `runners/python/nodes/converter.py` the target type.

### 5.3 Inserting converters (and why it asks first)

When `onConnect` gets a `converterPath` it only **stages** it (`graphStore.pendingConverter`). The dialog (`ConverterPreviewDialog.tsx`) renders exactly the staged hops. Only the **Insert converter** button calls `insertConverterPath`, which in one update adds one ordinary node per hop and the wires between them, then clears the staged path (so a double click cannot insert twice, and cancel changes nothing). The inserted nodes are normal nodes: you can select and delete each one. There is deliberately no "group node".

Each inserted node carries its `hop` (`{from, to}`). That is what turns the converter's wildcard sockets into real types, so every wire in the chain type-checks as a plain direct wire, and it is what the runner reads (`hop_to`) to know what to produce.

### 5.4 The shape adapter

Same content type, different field names (`text, language, duration_sec` out; `text, language, title` in). `buildFieldMapping` matches fields by exact name, then case-insensitively. The result `{mapping, unmappedSource, unmappedTarget}` is computed **once**, when you draw the wire, and **frozen onto the wire** (`edge.data`). It is never recomputed later, so a saved pipeline behaves identically even if node definitions change. The badge shows the count and the popover lists what was dropped, so nothing disappears silently. At run time the Go executor applies the same mapping (`exec.ApplyMapping`).

### 5.5 The vault and write-only credentials

Two halves that must both be true:

- **Browser side (`SecretField.tsx`).** The typed characters live only in that component's own `useState`. They go nowhere until you press Save, which calls `SetSecret` once; then the box is emptied. The shared store only ever receives a boolean ("configured"). Reselect the node and you get a fresh, empty box, with a badge saying it is saved. There is no show/reveal control and no RPC returns a credential.
- **Server side (`store.go` + `vault.go`).** `SetSecret` encrypts with AES-256-GCM (random nonce per value) using a master key from the `MCPSTUDIO_MASTER_KEY` environment variable and stores only ciphertext. The one place a credential is decrypted is `exec.Manager.buildRequest`, in memory, for exactly one node call. Verify yourself: `docker compose exec postgres psql -U mcpstudio -c "select node_id, field, encode(ciphertext,'hex') from secrets;"` shows unreadable bytes.

On page load `runStore.load` calls `ListSecretStatus`, which returns only *which* (node, field) pairs have a credential, to repaint the badges.

### 5.6 The runner

`runners/python/server.py` is a gRPC server. To add a node: write `nodes/<name>.py` with `run(ctx) -> (outputs, detail)`, register it in `NODES`. `ctx` gives you `config`, `input_blob(name)` (a path), `input_json(name)` (a dict) and a scratch folder. Raise `NodeError("plain message")` for anything the user can fix; the message is shown in the UI. The runner never logs request contents (they hold credentials) and scrubs secret-looking values out of error text.

### 5.7 Live status

`WatchRun` is a server-streaming RPC. The Go side keeps each run's event list in memory behind a mutex and condition variable, so a watcher first replays everything so far, then waits for more. The browser consumes it with `for await` and updates `runStore.nodeRuns`; `PipelineNode` and `RunBar` both read from there.

---

## 6. File map

### Contracts
| File | What |
|---|---|
| `proto/mcpstudio/v1/orchestrator.proto` | canvas ↔ orchestrator API (manifests, pipelines, runs, secrets) |
| `proto/mcpstudio/v1/runner.proto` | orchestrator ↔ runner API (`ExecuteNode` streaming) |
| `proto/mcpstudio/v1/nodeio.proto` | the value that flows on a wire: JSON or a blob reference |
| `proto/mcpstudio/v1/manifest.proto` | what a node type is (sockets, config fields, converter pairs) |
| `buf.gen.yaml` | codegen; plugin versions are **pinned** so regenerating can't outrun the runtime packages |
| `gen/` | generated, committed, never hand-edited (`buf generate` to refresh) |

### Orchestrator (Go) `orchestrator/`
| File | What |
|---|---|
| `cmd/orchestrator/main.go` | the server and all RPC handlers; works without a database (registry only) |
| `internal/registry/phase2.go` | the original canvas-only fixture nodes |
| `internal/registry/demo.go` | the four demo nodes (the definitions the whole app reads) |
| `internal/exec/graph.go` | parse, validate, order a pipeline; apply field mappings |
| `internal/exec/manager.go` | the run engine: build each node's request, call the runner, stream events |
| `internal/exec/grpc_runner.go` | the real runner client (tests use a fake) |
| `internal/store/store.go` | Postgres: pipelines and encrypted secrets |
| `internal/vault/vault.go` | AES-256-GCM encrypt / decrypt |
| `cmd/e2e/main.go` | headless stand-in for the canvas, used by `scripts/e2e.sh` |

### Runner (Python) `runners/python/`
| File | What |
|---|---|
| `server.py` | gRPC server, `NODES` table, error handling |
| `common.py` | `Ctx`, blob/JSON helpers, `NodeError`, dry-run flag, secret scrubbing |
| `nodes/youtube.py` | yt-dlp download (or copy a local file) |
| `nodes/converter.py` | one ffmpeg call for any conversion; audio targets become mono 16 kHz mp3 so an hour fits Groq's 25 MB limit |
| `nodes/groq.py` | Whisper transcription |
| `nodes/gemini.py` | summarise a transcript into `{subject, body}` |
| `nodes/email_send.py` | Gmail SMTP |

### Frontend `frontend/src/`
| File | What |
|---|---|
| `compatibility/resolve.ts` | the four-way decision |
| `compatibility/bfs.ts` | converter search |
| `compatibility/fieldMapping.ts` | shape-adapter matching |
| `store/graphStore.ts` | nodes, edges, registry, `onConnect`, staged converter, insert |
| `canvas/Canvas.tsx` | the React Flow surface; mounts the edge type, dialog, run bar |
| `canvas/edges/ShapeAdapterEdge.tsx` | the wire with the "N fields mapped" badge and inspector |
| `canvas/ConverterPreviewDialog.tsx` | the confirm-before-insert dialog |
| `canvas/nodes/PipelineNode.tsx` | a node card, with live run status |
| `config-panel/ConfigPanel.tsx` | the right column; widget per field type |
| `config-panel/SecretField.tsx` | the write-only credential input |
| `config-panel/configStore.ts` | non-secret values (persisted) + "configured" flags (memory only) |
| `pipeline/serialize.ts` | canvas ↔ saved JSON |
| `run/runStore.ts` | save, load, run, and the live event stream |
| `run/RunBar.tsx` | Run / Save buttons and the results panel |

### Scripts and infra
| File | What |
|---|---|
| `scripts/dev.sh` | start everything (postgres, runner, orchestrator, frontend) |
| `scripts/e2e.sh` | offline end-to-end rehearsal, exits non-zero on failure |
| `scripts/manifests.sh` | checks the registry is served |
| `scripts/roundtrip.sh` | checks Go ↔ Python gRPC |
| `docker-compose.yml` | Postgres on host port 5433 |
| `.env` / `.env.example` | database url and vault master key |

---

## 7. Data formats

### The saved pipeline (`pipelines.graph_json`)

```json
{
  "nodes": [
    { "id": "n-yt", "type": "pipelineNode", "position": {"x": 0, "y": 0},
      "data": { "manifestId": "youtube-download" },
      "config": { "url": "https://youtu.be/...", "max_minutes": "10" } },
    { "id": "n-conv", "data": { "manifestId": "format-converter",
                               "hop": { "from": "video/mp4", "to": "audio/mpeg" } }, "config": {} }
  ],
  "edges": [
    { "id": "e1", "source": "n-yt", "sourceHandle": "video_out", "target": "n-conv", "targetHandle": "media_in" },
    { "id": "e3", "source": "n-groq", "sourceHandle": "transcript", "target": "n-gem", "targetHandle": "transcript_in",
      "type": "shapeAdapter",
      "data": { "mapping": [ {"from": "text", "to": "text"}, {"from": "language", "to": "language"} ] } }
  ]
}
```
No credential can appear here: `toGraphJson` only writes non-secret config, and credentials are keyed by `(node id, field)` in a different table.

### RunEvent

`{ node_id, status, detail }`. `status` is `queued | running | succeeded | failed`. `node_id == ""` means the run itself. `detail` is a short output preview on success, or the error message on failure.

### Postgres

```
pipelines(id PK, graph_json, updated_at)
secrets(node_id, field, ciphertext BYTEA, updated_at, PK(node_id, field))   -- ciphertext = 12-byte nonce || AES-GCM output
```
Tables are created on startup if missing (no migration tool yet).

---

## 8. Security model

What is guaranteed today, and where it is enforced:

| Guarantee | Enforced by |
|---|---|
| A credential is never in the browser's storage | only the non-secret `values` map is persisted (`partialize`); a test asserts the typed string is absent from localStorage and the store |
| A credential is never returned by any RPC | no such RPC exists; `ListSecretStatus` returns names only |
| A credential is stored encrypted | `store.SetSecret` encrypts before the SQL runs; the database never sees plaintext |
| A credential is not in a saved pipeline | `toGraphJson` has no path to read one; a test asserts this |
| A credential is not logged | the runner logs node ids only; errors are scrubbed |
| The decrypted key lives only for one node call | `buildRequest` decrypts into the request and nothing keeps it |

Honest limits (fine for a local PoC, fix before any hosted use):

- **The master key is an environment variable.** Anyone who can read the orchestrator's environment and the database can decrypt. A real deployment wants a KMS or similar.
- **Ciphertext is not bound to its row.** Someone with database write access could swap two ciphertexts. Fix: pass `node_id/field` as AES-GCM additional data.
- **No authentication.** Anyone who can reach port 8787 can read status and run pipelines. It binds to 127.0.0.1 only. Secrets are keyed by node id, not by user.
- **No TLS** on localhost hops. Required before this leaves your machine.
- **The credential travels browser → orchestrator in a request body** over plain HTTP on localhost. This is the one deliberate exception to "never leaves the browser"; it is what makes a real vault possible.
- **The runner receives the plaintext key** over unauthenticated local gRPC.

---

## 9. Tests, and what is not tested

```bash
pnpm --filter @mcpstudio/frontend test --run     # 112 tests: engine, BFS, store, dialog, secret field, serializer
pnpm --filter @mcpstudio/frontend typecheck
go test ./orchestrator/...                       # executor (order, validation, mapping, failure, replay) and the vault
bash scripts/e2e.sh                              # whole pipeline, headless, dry-run vendors
bash scripts/roundtrip.sh                        # Go ↔ Python gRPC
bash scripts/manifests.sh                        # registry served: 10 manifests, 4 categories
```

Verified by hand while building: real yt-dlp download of a YouTube clip; real ffmpeg conversion; real Postgres with confirmed ciphertext at rest; run events streaming through the Vite proxy.

**Not verified, you must try these with real keys before the demo:**
- the actual Groq, Gemini and Gmail calls (their request shapes follow each vendor's docs but have never hit the real services);
- Gemini model names (`gemini-2.5-flash-lite`, `gemini-2.5-flash`) may have moved on; they are a dropdown on the node, change them in `demo.go` if a call returns "doesn't know the model";
- the browser UI end to end (the browser automation was unavailable here): dragging, the converter dialog, the secret flow, live badges. The components are unit-tested, the wiring between them is not.

---

## 10. Deliberate cuts and how to extend

Cut for the deadline, on purpose:

| Cut | Today | Later |
|---|---|---|
| MCP wrapping of vendor calls | the runner calls vendor APIs directly, one module each | wrap each module behind an MCP server; the node functions are the seam |
| Job queue / retries (BullMQ + Redis) | one in-process sequential executor, no retries | queue per node, retries, concurrency caps |
| Object storage (MinIO / S3) | files on local disk, referenced as `file://` | change `blob_out` / `path_from_uri` in `common.py` |
| Branching and fan-in | linear order only (the validator allows DAGs, the executor runs them one at a time) | parallel levels |
| Several saved pipelines | one slot, id `default` | list/rename UI; the API already keys by id |
| Run history | runs live in memory | a `runs` table |
| Cost estimate | none | per-node pricing in the manifest |

### Add a node in four steps

1. **Define it** in `orchestrator/internal/registry/demo.go`: id, category, sockets (content type + optional JSON schema), config fields (`secret(...)` for credentials).
2. **Implement it** in `runners/python/nodes/<name>.py` as `run(ctx)`; register it in `server.py: NODES`.
3. Bump the count in `scripts/manifests.sh`.
4. Nothing in the frontend changes: the palette, config panel and validation are driven by the manifest.

### Add a converter road

Add a `ConverterPair` to the converter manifest, then handle the target in `nodes/converter.py` (`EXT`). The BFS will pick it up and chain it automatically.

---

## 11. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Palette shows an error / is empty | orchestrator not running, or the vite proxy points elsewhere (`frontend/vite.config.ts` → `127.0.0.1:8787`) |
| "no database configured" | `DATABASE_URL` not set; use `scripts/dev.sh`, which loads `.env` |
| `MCPSTUDIO_MASTER_KEY must be 32 bytes` | `.env` has an empty key; `openssl rand -base64 32` |
| Port 5173 busy, vite moves to 5174 | an older dev server is running; stop it, or use the printed URL |
| "`x`: input `y` is not connected" when running | a required input socket has no wire |
| "`groq_api_key` is not set" | press Save in the secret field for that node (the badge must say Saved) |
| yt-dlp fails or is blocked | YouTube sometimes throttles; use a local video path in the `url` field |
| "audio is N MB, over groq's 25 MB limit" | lower `max_minutes` on Youtube Download |
| Gmail "rejected the login" | needs an **app password** (2-Step Verification on), not your normal password |
| Credentials gone after changing `.env` | a new master key can't read old ciphertext; re-enter them |
| Port 8080 taken | something else (a docker container) owns it; this project uses 8787 on purpose |

---

## 12. Demo-day checklist

- [ ] `docker ps` shows postgres healthy; `.env` exists and is backed up
- [ ] Run the full pipeline **once with real keys** on the venue's network the day before
- [ ] A local copy of the lecture video, and its path ready to paste in `url` as the fallback
- [ ] Short clip (5 to 10 min, English) so the live run takes a minute or two
- [ ] Keys already saved to the vault (the badges say "Saved to vault") so nobody watches you paste secrets
- [ ] Gmail app password works: send one test run to yourself first
- [ ] Pipeline saved; reload the page once to confirm it restores
- [ ] A dry-run screen recording as a backup if something external fails
- [ ] Close the `data/` folder and any terminals that show `.env`
