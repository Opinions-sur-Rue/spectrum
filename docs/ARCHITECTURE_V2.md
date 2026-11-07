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

### Local voice development

Voice is off by default (`SPECTRUM_VOICE_ENABLED=false`); the UI hides every audio control while it is disabled.

```bash
SPECTRUM_VOICE_ENABLED=true docker compose -f docker-compose.dev.yaml --profile voice up -d --build
python3 dev/check-livekit.py        # STUN, auth, room lifecycle, retired-token rejection
npm run test:e2e:voice              # Chromium + Firefox, synthetic audio, no real microphone
```

- SFU signalling: `ws://127.0.0.1:7880`; media: `7882/udp` and `7881/tcp`; STUN: `127.0.0.1:3478` (coturn, STUN-only, no relay).
- The dev credentials in `dev/livekit.yaml` are public fixtures. Production must inject `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` and terminate TLS.
- Firefox hides host ICE candidates behind mDNS names that the containerised SFU cannot resolve, so local Firefox runs need `media.peerconnection.ice.obfuscate_host_addresses=false` (already set in `playwright.voice.config.ts`).
- Rebuilding the backend wipes ephemeral rooms; create a new room before retesting.

## 7. Transcription

### Implementation status

An opt-in **browser-local prototype** is available through
`docker-compose.browser-stt.yaml`: each participant transcribes their own microphone
with self-hosted Whisper Tiny/Base Q8 WASM assets, optional hardware WebGPU FP16,
or GPU-only Small, and shares unverified text. A local Silero neural gate rejects
non-speech candidates before decoding. GPU selection is explicit, requires a
hardware FP16 adapter and never falls back silently. Microphone
consent and transcription consent are independent; unsupported/slow devices retain
voice, with explicit partial coverage. Chromium FR/EN/auto CPU inference and
Small/WebGPU live flow are verified; Firefox has capacity limits and no WebGPU,
and mobile/Safari remain untested. Setup, rollback,
protocol boundaries and limitations: [`BROWSER_STT.md`](BROWSER_STT.md).
Browser mode excludes server-worker admission; there is no automatic fallback.

The following describes the retained **server mode**, not browser processing.
The default remains faster-whisper small on CPU int8. A reversible CPU-only
Nemotron 3.5 ASR Streaming 0.6B Q8 experiment is available through
`docker-compose.nemotron.yaml`; setup, rollback, privacy boundaries and initial
measurements are in [`services/transcription/README.md`](../services/transcription/README.md).
It currently reuses utterance/draft segmentation, not native stateful streaming.
Weights are pinned and unmodified; no French fine-tuning is claimed.

Transcription is opt-in. The `transcription` Compose profile runs a listen-only
LiveKit worker with local `faster-whisper` (multilingual small, CPU int8) and
WebRTC VAD followed by a packaged local Silero ONNX speech gate. No room audio is written to disk or sent to a cloud service. Public
model weights must be downloaded once; recognition then runs offline.

```bash
# From the repository root; first run only (downloads public model weights).
docker compose -f docker-compose.dev.yaml --profile transcription build stt
docker compose -f docker-compose.dev.yaml --profile transcription run --rm --no-deps stt python download.py

# Enabling either flag requires recreating the backend (ephemeral rooms reset).
SPECTRUM_VOICE_ENABLED=true SPECTRUM_TRANSCRIPTION_ENABLED=true \
  docker compose -f docker-compose.dev.yaml --profile transcription up -d --build
```

Open `http://localhost:5173/v2` in Chromium, create a room, open **Transcript**,
then **Join audio → Enable microphone → accept transcription**. Expect short
text updates after a few seconds, not word-by-word dictation. Spectators see the
same transcript without joining audio. Admins can pause transcription in room
options; changing it retires the voice room and stops everyone's microphones.

The worker processes at most eight rooms, one inference at a time, with four CPU
threads. VAD bounds each utterance to twelve seconds, emits provisional results
at 1.6 and 4.8 seconds and finalizes after 800 ms of silence (or a shorter 200 ms pause
after eight seconds). Final recognition uses deterministic beam search (width 5),
while provisional results use width 1. Decoder time is additional to those
buffering delays; these are not wall-clock latency guarantees. Newer drafts and
finals supersede queued older drafts, and provisional updates are skipped under
backlog to prioritize useful results. This avoids most arbitrary mid-sentence
four-second cuts without allowing unbounded audio buffers. Its inference queue holds
at most 24 chunks; overload drops chunks, rather than storing a growing audio
backlog. This is a local development baseline, not a capacity guarantee for six
simultaneous speakers. Recognition defaults to **French**, not per-clip automatic
detection. Admins can choose Français, English, or explicit Auto (FR/EN) in room
options. A language change retires the voice room, discards old-language work,
and requires renewed microphone consent. Whisper always uses `task=transcribe`,
never `translate`. Short/noisy speech and chunk boundaries can still reduce
accuracy; provisional text is not a verified verbatim quote.

The worker prepares a listen-only SFU connection when audio is joined, but only
subscribes to explicitly consenting speakers. Control polls run every 250 ms to
reduce first-word loss while microphone permission is being established. Within
the eight-room cap, rooms with consenting speakers take precedence over idle
prepared listeners.

Noise can cause Whisper hallucinations. Silero rejects non-speech before model
decoding. A narrow normalized exact-match filter additionally suppresses known
standalone Amara auto-caption credits (including an actual verbatim spoken
credit); longer sentences discussing Amara are not filtered. These safeguards
reduce false captions, not guarantee their absence. If final recognition rejects
a previously displayed draft, the worker sends a versioned `discarded` tombstone
with empty text instead of promoting the draft to a final quote. Clients hide
tombstones but retain their versions within the bounded history so stale
snapshots cannot revive rejected captions. A discard cannot remove an established
final quote or another speaker's utterance.

Model files now live at `/models/whisper-small`. When upgrading an existing dev
stack, rerun the model download command above before restarting the worker. The
old public base weights can remain cached; they are no longer used at runtime.

- `transcript.get {after?, limit?}` returns the latest bounded page (200 by
  default, at most 500 utterances). The room retains at most 5000 utterances in
  memory, deleted with the room. This is a recent-history page, not lossless
  pagination of the full buffer.
- `transcript.segment` broadcasts partial/final text to every room member,
  including spectators. Each update advances its sequence; clients merge by
  utterance ID and reject older versions.
- `POST /spectrum/transcript` is a trusted-worker ingestion boundary. It returns
  404 unless `SPECTRUM_TRANSCRIPTION_TOKEN` is configured, then requires a Bearer
  token. It accepts only consenting current stage speakers, identified by public
  member ID, with matching `voiceRoomId` and `generation`. Results from a retired
  physical voice room cannot enter a new room generation.
  Never expose the worker token in the browser.
- `GET /spectrum/transcription/jobs` uses the same worker token and grants only
  listen-only SFU credentials. A successful poll is the worker heartbeat shown
  in the panel. Production must replace the public dev token with a secret.
- Role revocation and transcription toggles clear consent and retire the SFU
  room. Microphones do not resume automatically. Worker disconnection/room
  retirement discards queued audio and provisional text; any in-flight CPU result
  is dropped on completion.
- Worker unit tests: `docker compose -f docker-compose.dev.yaml --profile transcription run --rm --no-deps stt python -m unittest discover`.
- Speech integration test (from `frontend/`):
  `SPECTRUM_TEST_SPEECH=/absolute/path/to/english-speech.wav npm run test:e2e:transcription`.
  The test selects English explicitly; set `SPECTRUM_TEST_LANGUAGE=fr` and
  `SPECTRUM_TEST_EXPECT='expected French phrase'` for a French fixture.
  A public test fixture is `samples/jfk.wav` in `ggml-org/whisper.cpp`; the test
  publishes that fixture instead of accessing a real microphone.

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

### v1 parity checkpoint — before resuming M7

The `/v2` route is not yet at full v1 feature parity. Keep v1 usable and close
these gaps before making the facilitator the primary implementation priority.

| v1 capability | v2 status |
| --- | --- |
| Spectrum with 3 / 5 / 7 / 9 slices | Available at creation and in admin room options; synchronized, without resetting positions |
| Optional central neutral circle | Available at creation and in admin room options; both rendering and hit detection follow the setting |
| Initial discussion topic | Available at creation; editable by admin afterwards |
| Nicknames, positions, chat, hide/reveal, reset | Implemented through v2 role-derived permissions |
| Event journal | Implemented: claims, observed joins/departures, settled opinions, role/nickname changes, visibility/layout changes and reconnection; local to each tab, as in v1 |
| Voice | LiveKit instead of PeerJS; local Firefox needs the documented WebRTC workaround |
| Leave room / stop session UI | Implemented with confirmation. Leaving reassigns admin to a remaining stage member; with no stage/admin left, room closes for spectators too. Stop erases the room for everyone |
| Kick participant / appoint another admin UI | Implemented: admin can remove participants/spectators and transfer administration to a participant. Former admin remains a participant. Self-kick/admin-kick are rejected |
| Raised hands and emoji reactions | Implemented for all roles: ordered hand queue, own/admin lowering, six allowlisted reactions with server cooldown. Hands survive reconnect; reaction overlays expire after four seconds |
| Per-participant volume and speaking indicators | Implemented via LiveKit. Local 0–100% volume per remote stage member survives audio reconnect; active speakers appear in People and on visible pellets |
| Live-platform controls, live participants/votes, streamer presentation | Implemented with offline backend tests and protocol-fixture browser coverage, not real-platform validation. TikTok requires an explicitly configured compatible signer; no implicit hosted EulerStream. Presentation follows spectator visibility without changing role |
| Invite/share controls and QR code | Canonical room URL, clipboard/fallback and locally generated QR; lobby accepts a code or URL |
| Full language/theme/help controls and translated v2 UI | Language switching, persistent lofi/light/dark theme and translated help/controls available. Some server-originated errors remain English; not a complete localization audit |

Parity does not reintroduce v1 microphone overrides: v2 publication stays
role-derived, with explicit local microphone/transcription consent. Likewise,
joining as spectator rather than immediately taking a pellet is intentional.

#### First UI/UX pass

- One persistent discussion dock groups Chat, Activity and Transcript. Desktop
  docking resizes the canvas; mobile uses a bottom sheet. Chat drafts and pending
  acknowledgments survive tab switches and closing/reopening the dock.
- Tabs support arrow keys, Home/End and roving focus. Escape/close restores focus
  to the discussion toggle. Unread chat/activity counts appear on tabs and toggle.
- Room identity/settings/sharing, audio controls, and content actions are separated.
  The claim sits above the canvas, independent of pan/zoom, with explicit save and
  Ctrl/Cmd+Enter. Role guidance and audio/microphone state remain visible.
- Zoom controls sit on the canvas. Auto-fit follows viewport/dock resize until
  the user pans or zooms; reset restores auto-fit. Own pellet has a larger hit area.
- Creation/joining moved to a responsive lobby. Transient toolbar popovers dismiss
  on outside interaction and Escape without unmounting the discussion dock.
- This is an interaction/layout pass, not final visual design or an accessibility
  audit. Remaining work includes server-error localization,
  touch/keyboard canvas navigation, visual contrast,
  note/edge discoverability and usability testing with actual discussions.

#### Activity journal semantics

`ActivityTracker` derives events only from server-confirmed room/roster and
audience-filtered spectrum snapshots/deltas. The v1 references are the `log(...)`
handlers in `routes/[[id]]/+page.svelte` and `validateOpinion()` in
`lib/canvas/manager.svelte.ts`. This is not an authoritative shared room history:
each tab retains at most 200 observed events in memory, cleared on reload, room
closure/switch or component destruction. No localStorage, database, transcript
export, or extra server event stream is introduced.

- Initial rosters establish a baseline, not fictitious arrivals or historical
  votes. Real roster differences distinguish arrival, departure, rename and role
  change. An expired/disconnected member is announced as departed when the
  server actually removes them, respecting its reconnection grace period.
- Claims are logged once after server acceptance, not for each typed character.
  Movement settles for 500 ms before an opinion is recorded; further movements
  within the same cell do not duplicate it. The waiting cell is not an opinion.
  A new claim permits a subsequent movement to reaffirm the same cell.
- Layout/visibility changes and reconnection cancel pending movement timers and
  establish a new position baseline. Revealing positions does not retrospectively
  announce previously hidden movements as new opinions.
- Hiding positions or losing a role also removes no-longer-permitted opinion
  entries from the local view. Opinions observed with admin-only visibility stay
  marked private and cannot survive demotion merely because positions were
  subsequently revealed. Membership/topic events remain public.
- Rendering uses FR/EN log and opinion translations, plain escaped text, stable
  local event IDs and receipt timestamps. Confirmed hand changes and observed
  reactions are journalled, without replaying existing hands on initial join.
   Observed live connected/disconnected transitions are journalled by platform,
   without importing voter credentials or replaying initial/reconnected state.

#### Live platforms, sharing and presentation

- `live.get/connect/disconnect/select` reuse platform adapters with admin-only
  connection and selection. Latest vote per account wins, at most 1,000 voters
  and 20 selected pellets. Commands use `spectrum -N` through `spectrum N`, plus
  `spectrum i`. Indifferent votes do not contribute to directional averages;
  an all-indifferent audience displays its aggregate at the indifferent position.
- Raw platform IDs stay server-side, replaced by room-local random IDs. Avatars
  are not fetched. Only admins receive the voter list; client revision fences,
  room filtering and role changes prevent stale voter details from being reused.
- Platform connections contact external public platforms, never exporting room
  audio, chat, notes or transcripts. Real Twitch/YouTube/TikTok streams have not
  been validated. Twitch SDK v4.4.1 has non-context-aware initial/reconnect dials;
  cancellation fences room callbacks and disconnects on late readiness, but does
  not guarantee prompt termination of a pending SDK dial.
- TikTok v2 refuses connection unless `SPECTRUM_TIKTOK_SIGNER_URL` names an
  operator-provided compatible signing endpoint. Dev Compose forwards this value
  and defaults to empty. Example: set it to `http://your-signer:port` on the
  operator's private network before recreating the backend. No signer image or
  self-hosted deployment is supplied here; this is a deployment prerequisite,
  not operational TikTok parity. Legacy v1 retains its existing adapter default.
- Share links and QR images are generated locally. Only theme/locale preferences
  persist; room content and drafts remain ephemeral.
- Presentation hides private/pending/unrevealed notes and their edges, plus all
  pellets when positions or spectator pellets are hidden. Mounted editors and
  drafts survive entry/exit; unsaved note content is never projected. Escape or
  the exit button restores menu focus. This is a visual audience mode, not a
  substitute for server authorization or a separate spectator browser session.

#### Session and social controls

- `room.leave`, `room.stop`, `room.kick`, `room.transfer` validate membership and
  authority server-side. All targets use public room-scoped member IDs, not
  signin IDs or pellet colors. Transfer requires an existing participant and
  relinquishes the requester's admin role; it never promotes a spectator or
  grants additional microphone permission.
- Leave/stop/kick retire the physical SFU room before committing removal. A
  failed revocation leaves membership unchanged and surfaces an error. Remaining
  listeners reconnect; microphone capture never resumes automatically.
- Kick is removal, not a persistent ban. The confirmation explicitly warns that
  someone holding the link can rejoin. A successful leave clears tab-local room
  state/URL and suppresses automatic rejoin, while allowing an explicit rejoin.
- `room.hand` stores current raised-hand timestamps in room memory. Raising is
  idempotent; only the member can raise their hand. Admin can lower any hand.
  Departure clears that member's hand. Promotion does not silently lower it.
- `room.react` allows only 👍 / 👎 / ❤️ / 👏 / 🤔 / 😂, at most one per member
  per second. Broadcasts carry room/public member IDs, pseudonym and emoji, no
  coordinates. No server reaction history; client shows at most five overlays.
  The bounded tab-local journal may retain observed reactions until reload/close.
- Speaking comes from SFU active-speaker events, not inferred from mic permission.
  Local volumes never mute another person's microphone or change their role;
  settings are in memory for this voice component only, never persisted to disk.

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
