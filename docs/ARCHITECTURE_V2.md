# Spectrum v2 — Architecture

Status: draft, decisions in progress.

## 1. Goals

v2 keeps everything that works in v1 (spectrum, voice, chat, live platforms, i18n, ephemeral rooms) and adds:

1. **A full-screen infinite canvas** that hosts the spectrum plus notes placed and linked around it.
2. **A stage model**: everyone joins as a spectator, admins promote people to participants.
3. **A moderation workflow for notes**: participants may propose, admins approve/reject and control when notes become visible.
4. **Real-time transcription** of the voice room, self-hosted, FR + EN.
5. **An AI facilitator** that suggests topics, re-engages the conversation from the transcript, and eventually speaks in the room.

Non-goals for v2.0: persistent accounts, stored history across sessions, mobile-native rewrite.

## 2. Invariants

- **Ephemeral by design.** No database, no recording on disk. Everything lives in memory and is wiped when the room closes.
- **Pseudonymous.** No accounts, no email, no password. Users pick a nickname; the UI warns against sharing private data.
- **Self-hosted.** No third-party cloud for audio, transcription, or LLM.
- **Incremental migration.** v1 keeps working while v2 is built. No big-bang rewrite.

## 3. Roles and the stage

Three roles, stored per room:

| Role | Pellet | Voice publish | Chat | Notes |
| --- | --- | --- | --- | --- |
| `admin` | yes | yes | yes | create, edit, approve, reveal, link |
| `participant` | yes | yes | yes | propose (queued), edit own pending note |
| `spectator` | no | no (listen only) | only if `spectatorChatEnabled` | read visible notes only |

Rules:

- **Everyone joins as `spectator`.** Admins promote to `participant` ("bring on stage").
- Participant slots are bounded (default 6, matching the spectrum slices). Spectator count is bounded separately and is not counted against participant slots.
- Demoting a participant releases the slot and removes the pellet.
- Admin role is reassigned automatically when the last admin leaves (already implemented in v1).
- **No separate mic permission.** A spectator who wants to speak must be promoted to `participant` by an admin. Demotion puts them back on the bench. There is no "temporary publish" override: voice permission is strictly derived from the role.

Room settings added in v2:

```
participantSlots            int  // default 6
spectatorLimit              int  // default 50
spectatorChatEnabled        bool // default false
pelletsVisibleToSpectators  bool // default true
notesVisibleToSpectators    bool // default false
transcriptionEnabled        bool // default true
```

## 4. Canvas

### 4.1 Rendering

- **Konva** replaces Fabric.js for the workspace. Fabric v7 stays out of v2.
- Infinite canvas with **bounded pan/zoom**: world is clamped to `[-WORLD_W/2, WORLD_W/2] × [-WORLD_H/2, WORLD_H/2]` (proposal: 12000 × 8000 world units), zoom clamped to `[0.2, 3]`.
- The **spectrum is a fixed zone** at the origin: it does not move and cannot be resized. Its internal geometry (slices, pellets) is unchanged from v1.
- Notes live in the surrounding space and are freely draggable.
- Rich text is edited in an **HTML overlay** positioned over the Konva node (Konva cannot do contenteditable). See §4.5.

### 4.2 Data model (server-authoritative)

```go
type Canvas struct {
    Objects map[string]CanvasObject
}

type Note struct {
    ID        string
    X, Y      float64
    W, H      float64
    Z         int
    Title     string
    Markdown  string
    Color     string
    AuthorID  string
    CreatedAt time.Time
    UpdatedAt time.Time
    Version   int
    // moderation and visibility are orthogonal
    Moderation ModerationState // pending | approved | rejected
    Visible    bool            // admin reveal toggle
}

type Edge struct {
    ID       string
    From     string // note ID
    To       string // note ID
    Relation Relation // supports | contradicts | questions | extends | related
    Label    string
    Version  int
}
```

The backend owns the truth. Clients apply optimistic updates and reconcile on the next broadcast. Concurrency is low (<= 6 editors), so no CRDT: per-object `version` + last-write-wins, plus an explicit edit lock while a note is open in the WYSIWYG editor.

### 4.3 Moderation and reveal

`Moderation` and `Visible` are independent:

- A participant creates a note → `pending`, `Visible=false`, only the author and admins see it.
- Admin approves → `approved`. Still `Visible=false` until the admin reveals it.
- Admin reveals → `Visible=true`, broadcast to the room (spectators included if `notesVisibleToSpectators`).
- Rejected notes are kept for the author only, so they can revise and resubmit.
- Edits to an approved note after reveal require admin re-approval (configurable, default on).

### 4.4 Typed edges

Relations: `supports`, `contradicts`, `questions`, `extends`, `related`. Each has its own color/dash/arrowhead. Edges are created by dragging from a note's connector handle to another note. Edges are auto-hidden when either endpoint is hidden from the viewer.

### 4.5 Markdown WYSIWYG

- Editor: **TipTap** (ProseMirror) with a markdown serialization layer. Rendered in an HTML overlay above the Konva canvas, positioned from the node's world coordinates.
- Rendering in read mode: markdown → HTML through the same pipeline, sanitized (DOMPurify).
- Note constraints: title (plain text, 80 chars), body (markdown, 4000 chars), no embedded HTML, images deferred.
- Editing UX: double-click a note → overlay editor; click outside or `Esc` → save + broadcast.

## 5. Protocol

v1 uses flat positional RPC:

```json
{"procedure": "update", "arguments": ["431,582"]}
```

v2 adds a versioned, structured envelope on the same websocket, dispatched alongside legacy procedures:

```json
{"v": 2, "op": "note.update", "id": "req-uuid", "payload": {"noteId": "...", "markdown": "...", "version": 3}}
```

Server → client events keep the same envelope with `op` and `payload`. The dispatcher routes on `v == 2` first, then falls back to the legacy `procedure` path, so v1 clients keep working during the migration.

Canvas ops (proposal):

```
canvas.get            -> full snapshot (on join)
canvas.snapshot       -> server event
note.create/update/move/delete
note.moderate         (admin: approve | reject)
note.reveal           (admin: visible true/false)
edge.create/update/delete
```

## 6. Voice

Current v1 voice is a PeerJS mesh: every client connects to every other client.

That model cannot support v2:

- spectators would need N connections each (mesh is O(N×M)),
- server-side transcription needs the audio to reach the server,
- the AI facilitator needs to publish audio into the room.

**Decision: migrate to a self-hosted SFU (LiveKit).**

- LiveKit server is written in Go, Apache-2.0, self-hostable.
- Clients publish one track, subscribe to the rest. Spectators subscribe only.
- Server-side audio enables transcription and agent injection.
- LiveKit Agents (Python) provides STT/LLM/TTS pipelines with turn detection, and Alkove ships an official LiveKit plugin.
- `lib/voice` is rewritten behind the existing interface; PeerJS stays behind a feature flag until the migration is validated.

## 7. Transcription

- **Self-hosted STT**, FR + EN. Candidates: `faster-whisper` (better CPU throughput) or `whisper.cpp` server; streaming partials through a chunked pipeline (2-4 s windows, VAD-gated).
- Speaker attribution: one STT stream per published track, so the speaker is known by construction. No diarization needed.
- Transport: audio never leaves the host. The STT service runs next to the backend.
- Output: ordered transcript events `{speakerId, nickname, text, start, end, isFinal}` broadcast to the room and kept in a bounded in-memory ring buffer (proposal: last 2 h or 5000 segments). **Visible to everyone** in the room, spectators included.
- Consent: a modal before the first mic publish, explicit mention that audio is transcribed, admin can disable transcription per room.
- Alkove's `Cue` can replace the STT's internal VAD for cleaner turn boundaries; `Focus` improves per-client uplink quality in the existing per-microphone model.

## 8. AI facilitator

Staged delivery:

1. **Text, admin-only (v2.0).** Suggestions of topics before the spectrum starts, then re-engagement questions generated from the last N transcript segments. Always a suggestion the admin can edit, never auto-posted.
2. **Text, room-visible (v2.1).** The admin can publish a suggestion as a "facilitator note" on the canvas.
3. **Audio (v2.2).** A LiveKit agent joins as a listener, speaks on demand (admin trigger or wake word), TTS in FR/EN (Piper or Kokoro, self-hosted).
4. **Individual questioning.** The facilitator addresses one participant with an epistemic-interview style question, based on their own statements.

LLM: pluggable provider interface. Default for self-host: a local model behind an OpenAI-compatible API (Strata is available on the LAN during development). Prompts are versioned in the repo.

Guardrails: the facilitator never states facts as an authority, never takes a position on the claim, always asks. Suggestions are rate-limited and capped per room.

## 9. Backend changes

```
backend/
  api/            ws handlers, new v2 dispatcher
  domain/
    spectrum/     room, roles, stage, settings (refactor)
    canvas/       NEW: canvas state, notes, edges, moderation
    transcript/   NEW: ring buffer, segment ingestion
    facilitator/  NEW: prompt building, LLM provider, suggestion lifecycle
    social/       unchanged
```

`Room` grows: `roles map[string]Role`, `settings RoomSettings`, `canvas *canvas.Canvas`, `transcript *transcript.Buffer`.

Everything stays behind the existing `Hub` mutex. No new persistence.

## 10. Frontend changes

```
frontend/src/lib/
  canvas/          Konva stage, layers, camera, note node, edge node
  notes/           TipTap editor, markdown render/sanitize, moderation UI
  stage/           role store, promotion UI, spectator controls
  voice/           LiveKit adapter (replaces PeerJS)
  transcript/      transcript panel, live segments
  facilitator/     suggestion panel
  spectrum/        unchanged store shape, extended with role/canvas state
```

`routes/[[id]]/+page.svelte` (1560 lines today) is split: `CanvasWorkspace`, `AdminToolbar`, `ChatPanel`, `VoicePanel`, `TranscriptPanel`, `SpectatorBar`.

## 11. Privacy

- No disk writes for room data, audio, transcripts, or canvas state.
- Rooms, canvas, and transcripts are freed when the room closes, when the last admin leaves, or on server shutdown.
- Transcript ring buffer is bounded and never exported by default. Admin can export a session summary as a local download (client-side, optional, explicit).
- No third-party calls: STT, LLM, TTS, and SFU are all self-hosted.
- UI copy keeps the v1 warning: use a pseudonym, do not share private data.
- `TRANSCRIPTION_ENABLED=false` disables the whole pipeline at the deployment level.

## 12. Milestones

| # | Scope | Outcome |
| --- | --- | --- |
| M0 | Role model, v2 protocol envelope, room settings, docs | Backend ready, v1 unaffected |
| M1 | Konva canvas, infinite pan/zoom, fixed spectrum zone, notes + typed edges, server sync | Playable workspace without moderation |
| M2 | Stage UI, promotion/demotion, spectator chat toggle, visibility controls | Full 3-role experience |
| M3 | Moderation queue, reveal controls, re-approval on edit | Notes workflow complete |
| M4 | TipTap WYSIWYG overlay, markdown rendering, drag-to-link | Notes feel finished |
| M5 | LiveKit migration, spectators listen-only | Voice scales |
| M6 | Self-hosted STT, live transcript panel, consent flow | Transcription live |
| M7 | AI facilitator: text suggestions, then audio agent | AI in the room |
| M8 | E2E, perf (200+ notes), a11y, i18n, privacy audit | v2.0 release |

## 13. Open decisions

Decided:

1. **Voice: LiveKit SFU** (self-hosted).
2. **Transcript visibility: everyone** in the room, spectators included.
3. **Spectator limit: 50** by default.
4. **Voice permission is strictly role-derived.** No mic override for spectators; speaking requires promotion to `participant`.

Still open:

1. Canvas world bounds and default zoom (proposal: 12000 × 8000, zoom 0.2–3).
2. Note editing after reveal: re-approval required (default) or free for the author?
3. TTS engine choice for FR (Piper vs Kokoro vs cloud).
