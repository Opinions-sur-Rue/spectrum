# Resume: finish v1 → v2 parity

## beta.19 production acceptance — 2026-11-17

Deployed as a digest-pinned pair (frontend `sha256:5fb10a70…`, backend
`sha256:12823242…`, source `fb941d4`), after an observed idle gate
(`sfuRooms 0 / sfuParticipants 0 / backendEstablishedConnections 0`), with the
rollback snapshot `/opt/spectrum/deploy-v2.0.0-beta.19-20261117T092326Z` and
LiveKit, v1 PeerJS and v1 TURN left untouched (same digests, same start times).

Evidence, all against production:

- Existing release smokes, run sequentially: notes attribution / author-only
  content / revalidation / no-unreviewed-leak / mobile resume / multiline claim
  on Chromium **and** WebKit; French mobile UI (profile, contained scroll,
  no overlapping toolbar, short viewport, chat draft preserved, inline help, v1
  restored) on Chromium **and** WebKit; voice over direct UDP and over
  TURN/TLS, each including the v1 route + PeerJS check.
- New beta.19 acceptance probe (`france-beta19-smoke.mjs voice`), 11/11:
  transcript tab absent while the room is opted out; per-role channel strips
  (admin 3, participant 2, spectator none) and audience isolation with stage and
  admin text never delivered to a lower audience; masked removal visible to
  author and admin with the original text gone after a reload; private notes
  restored locally with no frame ever leaving the browser and no canvas note
  created; additive co-admin appointment then voluntary step-down with the
  last-admin guard; shared speaking time visible to the other client;
  push-to-talk capturing only while held with exactly one capture; targeted
  mute stopping only that microphone while the member stays connected and on
  stage, with resume available solely to its owner and no unmute affordance
  anywhere in the admin's panel.
- First probe runs of these two scripts failed, and in every case the cause was
  the **test tooling**, not the product: an ambiguous `textarea` selector in the
  mobile smoke once the Notes tab added a second one; a spectator joined via a
  URL read before the client had written `?room=`; a `chat.remove` assertion that
  read once instead of waiting for the reloaded snapshot; an `async` helper that
  wrapped a Locator in a Promise. Each was fixed in the scripts and re-run.
- Two deployment gaps found during this work, both recorded in
  `BROWSER_ASR_PARAKEET.md`: browser transcription assets were never served
  (excluded from the image, and every `/stt/` path fell through to the SPA shell,
  returning HTML with a 200), now fixed to 404 with `gzip_static`; and the
  deployed nginx has no zstd/brotli module, so download-size promises must be
  measured with gzip rather than taken from the model repo's `.zst` sizes.
- Still open: real-device acceptance on iPhone/Android. Every result above comes
  from local or CI browsers, and CI's "WebKit" is not real Safari.

## Tiny-screen chrome regression found by CI — fixed and deployed in beta.19

- beta.18 CI (run 44043444880) failed twice, and neither failure was a
  configuration quirk to wave away:
  - `backend`: 14 `goconst` findings. CI pins golangci-lint **v2.15.0** while the
    local tool was 2.5.0, so earlier "0 issues" claims were meaningless; the
    beta.17 baseline is clean under v2.15.0, which proved the new tests caused
    it by repeating JSON field keys. Fixed by reusing the repository's field
    constants instead of relaxing the linter (commit 7f7cd61).
  - `frontend`: the last voice scenario failed at 320×568 in French because the
    board kept only 58.5 px against the project's > 80 px invariant (the same
    class of defect that blocked beta.15). Locally the same test measured 121 px;
    the difference is CI font metrics.
- Root cause of the layout failure, measured rather than guessed: at 320 px the
  header's session menus wrapped into **three rows (94 px)**, the claim block
  cost 136 px, help 44 px and the action bar 113 px, so the chrome consumed
  nearly the whole viewport.
- Fix: below 359 px the session menu row becomes one horizontally scrollable
  row (nothing is removed from the tab order or hit targets). Measured after the
  change: menus 44 px, board **121 → 171 px**, document width still bounded. The
  voice scenario now also asserts menu height ≤ 48 so this cannot silently
  return.
- Re-validation with the CSS change (global to mobile): PTT 320×568
  Chromium+Firefox 2/2, **220 unit tests**, **124/124** Chromium+Firefox UI,
  **62/62** WebKit UI, **18/18** real-SFU voice.
- beta.18 published nothing (`publish` needs backend+frontend), so it stays a
  dead marker and the release continues as beta.19. Real-device Safari/Android
  acceptance is still outstanding and cannot be covered here.

## Old Spectrum host decommissioned — 2026-11-17

- Evidence first: `spectrum.utile.space` and `api.spectrum.utile.space` resolve to
  the france host; the utile nginx logs show zero requests for those hosts today
  and yesterday (only historical rotations had hits); zero established sockets on
  2001/3001/9000/3478/5349; utile's peerjs log contained only external probes and
  coturn only rejected `test` credential scans. The old containers had no volumes,
  and the shared `.env` held no Spectrum secrets, so there was nothing to migrate
  (v1 rooms are memory-only).
- Removed on `utile`: `utile-compose-spectrum-frontend-1` and
  `utile-compose-spectrum-backend-1` (stopped then removed), plus stopped
  `peerjs` and `coturn` with `--restart=no` so they stay down across reboots.
  France already runs its own v1 PeerJS, TURN and LiveKit, and the bundle served
  by france references only `spectrum.utile.space` / `api.spectrum.utile.space`,
  so nothing current depended on the old pair.
- nginx on `utile`: the two Spectrum 443 vhosts now `return 410` instead of
  proxying to 2001/3001/9000. TLS blocks and the port-80 Certbot redirects were
  left intact, the Let's Encrypt certificate for `spectrum.utile.space` was NOT
  deleted, `nginx -t` passed before reload, and the other sites were re-checked
  after reload (utile.space 200, card.n9n1.tech 200, alvesdi.as 403, Spectrum
  410). Old ports are no longer listening.
- Local images `ghcr.io/opinions-sur-rue/spectrum-{frontend,backend}:latest` were
  removed from utile only. Registry packages, the `latest` tag in GHCR and the
  france production stack are untouched.
- Restore material in `/root/decommission-spectrum-20261117/` (mode 700, files
  600): nginx config before, the compose file before, the peerjs compose and
  turnserver config, `docker ps`/`inspect` dumps, image list, and a restore
  README. Only environment variable *names* were recorded, never values.
- Two residual resurrection paths, deliberately left for a separate decision:
  the utile compose checkout still declares the two Spectrum services, and the
  committed `main` copy of `.github/workflows/publish-images-utile.yml` still
  dispatches `deploy-spectrum-*` to `SonnyAD/utile-compose`. The working copy of
  that workflow already removes the deploy job but is uncommitted, so until it
  lands on `main` a future `main` push can recreate the containers. Durable
  removal belongs in the `utile-compose` repository, outside this workspace.
- Certificate renewal note: because DNS no longer points at utile, a renewal
  attempt for `spectrum.utile.space` on that machine will fail (the cert is valid
  until 2026-12-14). Removing the vhosts plus `certbot delete` would be the
  follow-up, not done here without separate approval.

## Chat channels (Room / Stage / Admin) and masked moderation — deployed in beta.19

- Three room-scoped channels with separate histories and one shared send
  cooldown per member, so switching channels cannot bypass the rate limit and a
  busy channel cannot evict another one's history. `chat.send` carries a
  channel; an omitted channel means the room channel, so older clients keep
  working.
- Audiences are enforced server-side, never in the UI: the room channel follows
  the existing role plus spectator-chat rule, the stage channel is read and
  written only by people on stage, and the admin channel only by admins. Because
  filtering happens before delivery, a spectator cannot even count stage or
  admin messages, and stage/admin content never reaches the v1 chat bridge.
- `chat.remove` is admin moderation that **masks** rather than deletes: the
  entry keeps its id and position so the conversation does not silently shift,
  while the text is dropped server-side and cannot be re-read by any client,
  including after a reload. Clients show a localized "message removed" line.
- Role changes re-fetch and replace the cached history instead of merging it, so
  a promoted member receives earlier stage messages and a demoted member stops
  reading them. A channel the member lost is removed from the selector and the
  selection falls back to the room channel.
- Participants UI: a per-channel selector with unread counts, separate drafts per
  channel, an audience description (visible on desktop, screen-reader only on
  short mobile layouts where the extra line pushed the composer out of the
  keyboard-visible viewport), and a two-step remove control for admins.
- Fixed while validating: a channel with no messages serialized Go `nil` into
  `chat.snapshot` as `messages: null`, which left clients stuck on "Loading
  messages". Empty histories now serialize as `[]` and the client merge tolerates
  either shape.
- Validation: backend race suite and lint (0 issues), frontend check/lint/build
  and **220 unit tests**, **124/124** Chromium+Firefox and **62/62** WebKit UI
  scenarios, **18/18** real-SFU voice scenarios. New coverage proves channel
  audiences across three clients, masked removal visible to author and admin,
  role-change refetch, per-channel drafts, and the demotion fallback.


## Additive co-admins and voluntary step-down — deployed in beta.19

- Replace the v2 `room.transfer` op (which handed authority over and silently
  stripped the caller) with two ops:
  - `room.appoint` — admin-only, target must be a current on-stage participant,
    and is additive: the caller keeps administration. Repeat appointments and
    spectator/outside/self selectors are refused, and nothing about microphone
    rights changes.
  - `room.abdicate` — self-only voluntary step-down; the caller stays on stage as
    a participant. Refused with a distinct error while they are the last admin,
    so a room can never lose its moderation authority by accident.
- Participants panel: a crown "Make {name} admin" action per participant, and a
  "Give up my admin rights" action that only appears once another admin exists.
  Both go through the existing destructive-confirmation dialog, and a pending
  appointment is cancelled if the target leaves the stage or the caller loses
  authority. The last-admin error has its own actionable copy.
- Protocol change note: `room.transfer` is gone from the v2 handler table, so
  this batch must deploy frontend and backend together. v1 keeps its own
  administration path untouched. Rooms are in-memory, so a backend restart
  already resets them.
- Validation: fresh `go test -race ./...` plus lint (0 issues), frontend
  check/lint/build and **207 unit tests**, **122/122** Chromium+Firefox,
  **61/61** WebKit and **18/18** real-SFU voice scenarios. The three rewritten
  sessions scenarios cover additive appointment, the refused last-admin
  step-down, a co-admin keeping real authority, and the claim draft surviving
  appointment but not an actual authority change.


## Private notes and opt-in transcription tab — deployed in beta.19

- Discussion gains a **Notes** tab holding the member's own scratchpad. It is
  written only to `localStorage` under `spectrum-personal-notes:<roomId>` and is
  never sent over the application WebSocket, so it is private by construction
  from admins and from the room record. Autosave is debounced, reports
  "Saved on this device", states explicitly when storage is unavailable instead
  of pretending success, flushes pending text before a room switch, and offers an
  explicit delete action.
- Transcription becomes opt-in: room defaults now ship `transcriptionEnabled`
  false, so the Transcript tab (and its empty panel) disappears until an admin
  turns transcription on in Room options. `SPECTRUM_TRANSCRIPTION_ENABLED` still
  overrides the deployment default.
- Consequence to confirm at rollout: restarting the beta backend resets existing
  rooms to the new default, so a room that had transcription on comes back with
  the tab hidden until the admin re-enables it. Mic publishing is unaffected:
  with the room setting off, on-stage members publish without the transcript
  consent step.
- e2e fixtures that assert the tab order now tolerate a room with and without
  the transcript tab instead of assuming the deployment default, and the dense
  mobile-panel fixture opts in explicitly to keep testing the widest tab strip.
- Validation: fresh backend race suite plus lint (0 issues), frontend
  check/lint/build and **207 unit tests**, **122/122** Chromium+Firefox and
  **61/61** WebKit UI scenarios, and **18/18** real-SFU voice scenarios. One
  push-to-talk scenario needed its chat input selector narrowed because the
  private-notes textarea is now a second textarea inside the Discussion panel;
  the assertion it makes is unchanged.
- Not deployed. Production remains beta.17, so transcription is still on by
  default there until this ships.

## Shared speaking time — deployed in beta.19

- Track per-member speaking totals in the Room, keyed by the room-scoped public
  member ID. Only the caller's own membership is addressable; the request carries
  a boolean turn boundary, never a target, audio, or transcript.
- Publish rights gate the counter: an off-stage member, a moderation-muted member
  and a closed room cannot accrue time, and a duplicate start never reopens or
  resets a running turn. Totals accumulate across demotion/promotion within the
  same Spectrum rather than being wiped by stage changes.
- An open turn is closed by self-report, mute, stage change, kick/leave (through
  the existing voice clear) and by socket unregister, so a suspended tab cannot
  accrue during its grace period. Each interval is capped at 90 minutes to bound
  clock skew and a client that never reports its release.
- Totals ship in `room.state` members (`speakingSeconds`) and a `voice.speaking`
  event at turn end, so every client shares the same numbers without polling.
  Participants shows the duration per on-stage member with an accessible title;
  nothing is stored after the room ends.
- Existing SFU fixtures issue two-minute tokens, so the long membership-expiry
  scenario can legitimately overlap the surviving admin's own token refresh. Its
  two post-expiry status checks now allow 30 s instead of 5 s. The invariants the
  scenario guards are unchanged: no new capture, same live tracks, role preserved.

## Targeted admin microphone mute — deployed in beta.19

- Add `voice.mute` for admins using only room-scoped public member IDs. Revoke
  publishing for the targeted on-stage participant through the existing SFU
  barrier; preserve their role, the physical room and all other peers'
  permissions/tokens. Co-admins are not mute targets, matching stage moderation.
- Keep a room-local moderation flag and fence old publishing admissions, including
  cached/refreshed tokens. Normal joins, consent requests, app reconnects and
  transcription-policy retirement do not clear the flag.
- Add `voice.resume` scoped exclusively to the caller's own membership and fresh
  publishing request. Apply current role and server-transcription consent checks.
  There is no admin action/API to reactivate somebody else's microphone.
- Participants shows a distinct admin microphone action and moderated-state badge,
  separate from listener-local volume. Owner sees a self-resume control. Normal
  mic intent is cleared on moderation; hold mode requires a new press even after
  self-resume. Errors reach the appropriate room/microphone alert.
- Backend race-enabled tests/lint plus frontend check/lint/build and **205 unit
  tests** pass. Full batch validation: **180/180** UI scenarios across
  Chromium/Firefox/WebKit and **18/18** real-SFU voice scenarios twice in a row.
  Actual-SFU integration covers targeted cutoff, no unrelated reconnect,
  old-token rejection, sticky moderation across reconnect, explicit self-resume,
  and fresh-press behavior in hold mode. Co-admin selectors are rejected by the
  server and hidden from the admin's People panel.
- Two apparent failures of the long membership-expiry voice scenario reproduced
  only while concurrent check/build/edit commands reloaded the shared Vite dev
  server; the tree-untouched runs were green. No product reconnect limit was
  relaxed by that diagnosis.


## Voice ergonomics follow-up — push-to-talk, deployed in beta.19

User requested continuing the remaining improvements after beta.17. First sublot
is opt-in push-to-talk; targeted admin noise mute and per-Spectrum speaking times
remain subsequent work, followed by private Discussion/channels/co-admin changes.

- Opt-in microphone option, default off and held only in tab memory. With audio
  joined and current publish authorization, hold the button (touch/mouse) or
  Space outside editing/interactive controls; focused hold button also supports
  Enter. No capture occurs merely by selecting the mode.
- Release, pointer cancellation/lost capture, focus change, window blur,
  backgrounding/pagehide, room readiness loss or role/voice permission loss mute
  local capture. Re-entry/reconnect requires a fresh press; held intent is never
  restored like the normal continuous microphone. Normal mic mode stays default.
- A generation-checked microphone cancellation path handles late permission and
  publication completions, avoids overwriting a newer capture, and prevents a
  delayed input-device restart after release. Server consent remains required;
  accepting consent in hold mode grants access but does not start capture.
- Narrow French layouts keep a short hold label and named icon-only leave-audio
  control; the redundant microphone summary remains screen-reader accessible.
  The new 320×568 connected-audio test retains the existing canvas-space minimum
  (>80 px), rather than weakening it to fit additional controls.
- Final validation: check/lint including E2E, build and **197 unit tests** pass.
  Complete UI suite passed **180/180** across Chromium/Firefox/WebKit; real SFU
  fixture voice suite passed **14/14** across Chromium/Firefox, including hold,
  typing, blur, app reconnect, late permissions, narrow French UI, moderation,
  cached-token revocation and expiration without disrupting another mic.
  Component tests additionally verify fresh-press requirements after readiness
  or role changes, and consent without automatic capture in hold mode.
- The existing controlled-disconnection fixture now refuses retries while paused
  rather than holding mock sockets past the bounded signin deadline. No runtime
  reconnect limit or assertion was weakened. Logs/screenshots are under
  `/tmp/opencode/spectrum-mobile-pass/ptt-complete-*` and `ptt-unit-complete.log`.
  Physical-device audio acceptance remains outstanding.
- No production change: beta.17 remains deployed. This sublot does not implement
  remote mute/unmute or shared speaking-time accounting.

## Readability and notes (group 2) — beta.17 deployed

User requested group 2 before deploying it together with mobile reliability.
Combined production rollout completed November 16, 2026 at 15:19 UTC:

- Release CI **43886973997** succeeded for source
  `4cfc83b8e83d53c55c5255fde9ca4d53d319be9a`.
- Frontend:
  `ghcr.io/opinions-sur-rue/spectrum-frontend@sha256:d0e01d6a6b6e0dbe65999302afd7b9c0dce5e3b6014a207bff1080d2c8ebe636`.
- Backend:
  `ghcr.io/opinions-sur-rue/spectrum-backend@sha256:a0ae10ae21e1acc515d188f00c12c2b4f9a6254f418d86316d29449b94a1d6a0`.
- Snapshot: `/opt/spectrum/deploy-v2.0.0-beta.17-20261116T151900Z`.
- The activity gate observed 100 seconds without established backend connections
  or SFU rooms/participants before restart. No active meeting was terminated.
- Frontend started `2026-11-16T15:19:05.882703545Z`; backend started
  `2026-11-16T15:19:04.286619151Z`. LiveKit, PeerJS and TURN images/start times
  stayed unchanged.
- Production checks passed: group-2 notes/attribution/revalidation/no private
  revision leak, half-open mobile resume and multiline claims on Chromium and
  WebKit; French mobile panels/profile/drafts/v1 restoration on both engines;
  direct UDP and forced TURN/TLS playback/moderation/revoked-token/mic restoration
  plus v1 PeerJS. Initial parallel smokes timed out while guests booted; a clean
  two-client diagnostic and the complete sequential rerun passed without product
  changes. Logs: `/tmp/opencode/spectrum-mobile-pass/beta17-*-retry.log`.
- Real iPhone/Android physical-device acceptance remains outstanding.

- Show pseudonyms above all v2 pellets, with ellipsis and full names retained in
  accessible labels/tooltips. Preserve the own-pellet marker and v1 behavior.
- Attribute notes visibly to their author using room-scoped public IDs and names,
  with a stored creation-name fallback; never expose signin identifiers.
- Enforce author-only content editing, including for admins. Keep admin layout,
  deletion and moderation capabilities separate. On-stage authors can revise
  approved notes; a changed approved content revision atomically returns to
  pending review and hidden visibility. Color/layout/no-op updates do not revoke
  approval. Invalidate prior viewers' snapshots and filter incident edges.
- New notes send empty Markdown. Empty title/body prompts are visual editor
  placeholders, not persisted seed text; default title remains a navigation label.
- Center claim display and preserve explicit newlines. Enter adds a newline;
  Ctrl/Cmd+Enter submits, Escape cancels, and IME composition must not submit.
- Validation: check/lint including E2E, build, **179 unit tests**, full backend
  race-enabled tests and backend lint pass. Final complete browser suite passed
  **180/180**: Chromium/Firefox 120/120, WebKit 60/60 (one worker, software GL).
  Tests explicitly cover author-only edits, hidden revalidation until reapproval
  and reveal, no unreviewed text leak, blank persisted notes, pseudonym ellipsis,
  centered multiline claim editing and the mobile reliability regressions.
- Initial runs exposed test assumptions about seed text/old permissions and a
  real keyboard-focus issue on read-only admin editors, all corrected. A later
  run suffered CDN stylesheet timeouts and local WebKit graphics instability.
  Test fixtures now isolate only legacy Google Fonts/unpkg imports from the
  network, including secondary contexts; production/v1 styles are unchanged.
  Final isolated runs pass without weakening assertions.
- User explicitly approved combined production deployment. Release CI must pass
  first; the prepared root-only deployment script checks pinned image metadata,
  snapshots the prior image environment, and requires 100 seconds without SFU
  rooms/participants or established backend connections before restarting only
  frontend/backend. LiveKit, PeerJS and TURN must remain unchanged.

## Mobile reliability follow-up — deployed with beta.17

Started after beta.16 rollout, in the order requested by the user.

- Server disconnect cleanup now checks ownership of the user-to-client mapping:
  an old socket closing after a replacement signin cannot unlink the replacement
  or start its grace period. Cleanup of browser transcription sessions remains
  scoped to the socket that owned them. Unsigned and duplicate closes are safe.
- V2 client bounds stalled connection/signin attempts at 10 seconds. On visible
  page return, `pageshow` or network `online`, it probes an existing signed-in
  socket with the existing application ping/pong protocol. After 5 seconds without
  the matching pong, it retires the half-open transport and reconnects using the
  same tab identity and room. Healthy probes refresh server-authoritative room
  state without replacing the WebSocket or voice connection.
- Late events from retired sockets are ignored; duplicate reconnect timers,
  resume listeners and probe timers are cleaned up. Hidden pages do not trigger
  resume probes. Explicitly left/closed rooms are not automatically rejoined.
- Reconnection grace remains **60 seconds**; stage authority is always restored
  from the server, never inferred from cached role. Existing sessionStorage
  identity remains tab-scoped; reopening a completely new tab is not a promise
  of identity recovery, nor is returning beyond grace a promise of stage recovery.
- Validation: check/lint (including E2E), production build, **172 unit tests**,
  full `go test -race ./...` and backend lint pass. Final browser regression run
  passed **45/45** across Chromium/Firefox/WebKit, covering half-open resume,
  reload identity/nickname/stage restoration, offline demotion, note drafts,
  authority refresh, mobile panels and activity deduplication. An initial run
  overlapped local source edits and had two failures; the unchanged-source final
  run passed all cases. Logs: `/tmp/opencode/spectrum-mobile-pass/reliability-*`.
  Real iPhone/Android suspension and keyboard/audio acceptance still
  require physical devices; emulation does not establish these guarantees.
- This changes backend as well as frontend. The user subsequently requested a
  combined rollout after group 2. Plan the backend restart around in-memory rooms;
  do not assume the earlier frontend-only room-survival guarantee still applies.

Browser-local transcription research is recorded separately in
`docs/TRANSCRIPTION_BROWSER_RESEARCH.md`; it is not part of this implementation.

## Mobile session-feedback pass — beta.16 deployed

User supplied iOS Safari/Android Chrome screenshots after the November 15
meeting and approved the first mobile UI batch, then explicitly approved its
deployment. Scope is frontend-only: publish beta.16, retain the running beta.14
backend and unchanged LiveKit/PeerJS/TURN containers so in-memory rooms survive.

Production rollout completed November 16, 2026 at 09:36 UTC:

- Release CI **43838375365** succeeded for source
  `dfa715671a0c9da23ca20a7f8bb8bbeb59f593ac`.
- Frontend pinned to
  `ghcr.io/opinions-sur-rue/spectrum-frontend@sha256:0e2beaba27f32b4e504d2d2475fd19ac802614355f638e3217196018102888ac`.
- Snapshot: `/opt/spectrum/deploy-frontend-beta16-20261116T093616Z`.
- Existing probe room and admin identity survived rollout and reload. Backend,
  LiveKit, PeerJS and TURN images/start times stayed unchanged from beta.14.
- Production French mobile UI smoke passed Chromium and WebKit, including long
  member-list scrolling, profile editing, short viewport, draft preservation,
  inline help and restoration of v1 layout. Initial smoke helper timed out with
  parallel joins; sequential helper joins passed without product changes.
- Direct UDP and forced TURN/TLS voice smoke passed: playback, moderation without
  reconnects, revoked-token rejection, microphone restoration and v1 PeerJS.
- Real-device iPhone/Android acceptance is still outstanding.

Beta.15 (`46dcfb2`, CI 43834063702) did not publish: its new 320×568 canvas-space
assertion caught a real dense-toolbar case when voice/browser-transcription
options are enabled. Beta.16 keeps closed help/audio options icon-only on narrow
screens (named controls remain accessible), and below 360 px uses icon-labelled
note/discussion actions plus a role badge beside the brand. The room code stays
available in the invitation dialog. The canvas minimum-space assertion is kept,
and local fixtures now force the densest toolbar regardless of backend flags.

- Participants becomes a visible-viewport-sized modal sheet below 1024 CSS px,
  with a fixed heading/close button, clearly labelled pseudonym form at the top,
  and an independently scrolling member list. Desktop retains its popover.
  A persistent "My pseudonym" entry point opens and focuses the profile form.
  Empty per-member audio rows no longer reserve space; mobile controls receive
  44 px minimum targets. Existing role/admin actions are not changed in this pass.
- Discussion follows `visualViewport` size and offsets, including a simulated
  keyboard and panning, rather than relying on `100dvh` alone. Flex min-widths,
  textarea width, and long-message wrapping prevent horizontal expansion.
- V2 alone owns safe-area padding and page scroll locking; it no longer adds a
  full-height shell on top of global body safe-area padding. Mobile inputs use
  at least 16 CSS px without disabling pinch zoom. V1 regains its original page
  styles when navigating back.
- The "Three things to try / Got it" floating card is replaced by reusable,
  initially collapsed "Getting started" help in document flow. Opening help
  reduces canvas space rather than covering controls; closing restores focus.
- Both mobile sheets isolate background controls. Native confirmation dialogs
  can still open above them. Participants restores focus only after releasing
  background inertness, including Escape through the shared toolbar action.
  Its parent/header stacking contexts are raised while modal, preventing later
  toolbar/audio controls from painting over the sheet.
- Validation: check/lint (including E2E eslint), build and 166 unit tests pass.
  Initial full Chromium/Firefox/WebKit run passed 167/171 cases: three failures
  were a pre-existing test's hardcoded backend port (3000 versus isolated 3002),
  and one checked language state before the reload completed. The test now uses
  the app's actual WebSocket URL and explicitly awaits the locale reload.
  Final targeted regression run passed **39/39**, including all four failed
  cases, keyboard/viewport/profile/help/v1-style restoration, accessibility,
  crowded menus, and short/landscape screens on all three engines. Screenshots
  and logs are under `/tmp/opencode/spectrum-mobile-pass/`. Linux WebKit and
  simulated keyboard bounds are not real iPhone/Safari acceptance. Backend and
  grace period are unchanged; production frontend is beta.16, backend beta.14.

Remaining agreed feedback, intentionally outside this first UI batch:

Status update: items 1–2 shipped in beta.17 (see sections above). Items 3–4 are
now implemented, committed and fully validated locally on `v2` but **not yet
deployed**: push-to-talk, targeted admin mute with self-only resume, shared
speaking time, private browser-only notes, opt-in transcription tab, additive
co-admins with voluntary step-down, and the Room/Stage/Admin chat channels with
masked admin moderation. What remains from this list is physical-device
acceptance (real iPhone/Safari and Android keyboards, app-switch and audio) and
the rollout itself.

Execution order confirmed by the user: finish the approved production rollout,
then mobile reliability (item 1), then readability and notes (item 2).
Approved decision: editing an approved note's content must return it to pending
validation. Moderation and layout changes remain distinct from content editing.

1. Preserve identity/pseudonym and stage membership across mobile suspension or
   reload, retaining the existing 60-second grace and respecting admin demotion;
   display ellipsized pseudonyms above pellets.
2. Show note authors clearly; only authors edit content, with separate admin
   moderation/layout rights. Empty new notes use placeholders, not saved seed
   text. Center the claim in its top bar and verify multiline editing behavior.
3. Push-to-talk (desktop key/mobile walkie-talkie button), targeted admin mute
   for accidental background noise (never remote unmute), and ephemeral speaking
   time beside pseudonyms for the current Spectrum only.
4. Personal notes in Discussion private even from admins; hide transcription tab
   for now; admin/participant/spectator chat channels with admin moderation access.
   Replace transfer-oriented admin UI with additive "Name admin" and voluntary
   self-removal of admin rights, protecting the last admin. The server model
   already supports several admins.

## Voice incident follow-up — 2026-11-16 (beta.14 deployed)

The real-device meeting on November 15 (~14:45–15:25 UTC,
`OSR-JGPZJ4DBZ9B1`) experienced repeated voice interruptions. LiveKit logs
showed successive physical rooms and participant restart failures. Code review
identified two application-level amplification paths: `VoiceMenu` disconnected
LiveKit whenever Spectrum's WebSocket reconnected, and leave/expiration retired
the entire SFU room. Logs were not detailed enough to attribute each retirement
to a particular operation. No LiveKit process restart or UDP receive-buffer
overflow was observed during the incident.

Approved implementation scope: frontend, backend, and LiveKit configuration;
restore a previously active microphone after involuntary rejoin if fresh
credentials still allow publication. User explicitly approved deployment after
the complete local validation. Beta.14 is deployed; release details follow below.
Beta.13 (`0f73e09`, CI 43805245204) passed the full frontend/voice jobs but did
not publish: CI's newer golangci-lint 2.15.0 required string constants and an
explicit test request context. These mechanical fixes pass that exact linter
locally and the full Go race suite; tags are not rewritten.

- Frontend: Spectrum readiness no longer belongs to the LiveKit lifetime key.
  Lost credential requests retry when Spectrum is ready; final established SDK
  disconnections request a fresh join only after local cleanup. Initial failures
  remain errors rather than triggering a retry loop. Successful microphone intent
  survives an involuntary rejoin, but explicit mute, leaving audio, changing room
  identity, demotion, or a server-transcription consent-policy change clears it.
  Restoration waits for readiness and a fresh publishing grant, with one capture
  attempt per join (no permission-denied loop). Admin/participant transfers do not
  reconnect voice because both roles may publish. Promotion/demotion now also
  preserve the target's connection: SDK permission events update local publishing
  rights, and demotion stops capture without disconnecting listening audio.
- Backend: leave/expiration/kick uses room-scoped `RemoveParticipant` and
  preserves the physical room and generation for other members. SFU operations
  remain behind the token-issuance barrier, outside the hub data lock; failed
  removals postpone membership changes. Cleanup removes only members selected
  before SFU calls and rechecks expiration afterward. Final membership/owner
  closure still retires the room, including stranded spectators. Retirement and
  participant-removal logs include a reason, never bearer tokens or secrets.
- User corrected moderation scope: routine promotion/demotion and kick must not
  interrupt other participants. Stage changes now use `UpdateParticipant` with
  explicit microphone-only publishing permission; only closure and transcription
  policy changes still retire the physical room. Promotion never opens a mic.
- Admission security: public `/livekit/rtc*` must route through backend
  `/spectrum/voice/rtc*`, never directly to native port 7880. The gateway verifies
  signed/expiring JWTs, exact audio-only grants, current membership/role/consent,
  and a signed per-member admission epoch. Demotion/removal revokes that epoch,
  including for refreshed tokens and later membership rejoin. The barrier spans
  upstream admission through HTTP 101 (LiveKit 1.13.11 registers the participant
  before upgrading), but is released for the WebSocket lifetime. Thus a pending
  join cannot race past targeted revocation. Only `/rtc`, `/rtc/v1`, and
  `/rtc/validate` are proxied; Twirp/admin endpoints stay private. Signal query
  strings contain JWTs: Nginx examples disable access logs on these locations.
- Transcription: targeted role/membership changes advance a separate worker
  revision and clear only affected speaker consent/browser sessions. Worker
  restarts its listener on revision change and drops stale queued/in-flight work;
  ordinary audio participants keep their connections and voice generation.
- LiveKit: `departure_timeout` changes from 10 to 25 seconds in the development
  config, France example, and backend `CreateRoom` request. Important correction:
  this is the room's post-departure empty lifetime, **not** an individual
  participant's reconnection timeout. France now uses the same 25-second value.
- Validation: `go test -race ./...`, frontend check/lint/build, 165 frontend
  unit/component tests, and 24 Python transcription tests pass. All ten gated
  Chromium/Firefox voice E2E cases pass against local LiveKit 1.13.11: app
  reconnect, single-member leave, automatic microphone
  restoration after real SFU retirement, permission retry, listening/publication,
  cached-token rejection after demotion, and expiration of another active speaker
  without recapturing or ending the remaining microphone. Expiration validation
  uses a three-second local membership grace and the normal cleanup routine;
  production grace remains unchanged. Targeted two-cycle promotion/demotion plus
  kick tests pass on Chromium and Firefox, checking unchanged connection/capture
  counts and replay rejection. Native
  loopback Firefox tests enable `media.peerconnection.ice.loopback`; no production
  browser/network configuration was modified. Local test evidence lives under
  `/tmp/opencode/spectrum-voice-regression/`.
- Deployment requires a new reviewed release and pinned digests, explicit user
  approval, and a quiet-room window: backend restart clears in-memory rooms and
  LiveKit restart interrupts voice. Do not deploy frontend-only as if it fixes
  backend-triggered room retirement. Real Safari/iOS/Android and cross-network
  acceptance remains necessary; synthetic browser microphones cannot prove it.
  **The new backend must ship with the Nginx gateway routing change**; private
  native signalling must not be exposed as an alternate route.

### Approved deployment — beta.14

- Source `1c14b08c75ecd5638e1090495edd3968723d8e14`, tag
  `v2.0.0-beta.14`; full release CI **43807137652** succeeded, including backend
  lint/race tests, v1 regression, v2 Chromium/Firefox/WebKit, voice tests, image
  publication/smokes, and aggregate digest manifest. No `main` push.
- Frontend:
  `ghcr.io/opinions-sur-rue/spectrum-frontend@sha256:0f7070e3afa6b9ce107f1fd2c0df443da13341251069b24b4e69374cb3f22d74`.
- Backend:
  `ghcr.io/opinions-sur-rue/spectrum-backend@sha256:c31ea1c7ef119dd9d4db32a4ac8f67392688e871f84e6fa9951a63c56a4d1b2c`.
- Manual deployment started at **2026-11-16 05:16 UTC** after checking zero SFU
  rooms/participants and zero established backend connections, then rechecking
  after image pulls. Both image source labels matched the exact release commit.
  Snapshot: `/opt/spectrum/deploy-voice-beta14-20261116T051602Z` (root-only),
  including previous image references, `beta.env`, LiveKit config, Compose, and
  the original Spectrum Nginx site. No runtime secrets or migration files were
  added to Git.
- Changed Spectrum's public signalling route to the backend gateway first
  (fail-closed while the old backend lacked that route), disabled signal access
  logs on both public hosts, validated/reloaded Nginx, applied the 25-second
  departure window, and recreated only LiveKit/backend/frontend. LiveKit retained
  pinned image `sha256:25cd902de7cacbd5f1f779f6a6ac1eae20ba8f56b0935934ce6b0ab80d1e3d20`.
  Backend/frontend started at 05:16:32/05:16:33 UTC. PeerJS and v1 TURN image
  references and `StartedAt` were unchanged; no other application was recreated.
- Public Chromium production checks passed in direct UDP mode and forced
  TURN/TLS mode (`iceTransportPolicy=relay`, selected `relayProtocol=tls`):
  v1 `/` and PeerJS OPEN, v2 room create/join, real remote audio playback from
  synthetic microphones, two promotion/demotion cycles without reconnecting
  target or other listeners, unchanged admin capture, kick affecting only target,
  stale/current kicked-token rejection, application-WS reconnect preserving mic,
  and automatic mic restoration after an intentional test-room SFU retirement.
  Initial five-second remote guest-join assertion timed out; independent baseline
  smoke and rerun with a 20-second network allowance passed. No product change
  was made for that assertion timeout.
- Security HTTP checks: `/` and `/v2` returned 200; unauthenticated signalling on
  both public hosts returned 403; Twirp/admin paths returned 404. Nginx config
  passed validation. Runtime secret/env files remain root-owned mode 0600,
  transcription remains disabled, and test rooms were explicitly stopped.
  Final activity check returned zero rooms, participants, and backend connections;
  all Spectrum containers had zero restart counts.
- Rollback requires the saved image pair **and** original Nginx/LiveKit config,
  not merely one image: old backend does not implement the admission gateway.
  Backend restart cannot recover ephemeral room state. Real Safari/iOS/Android
  microphones and multiple physical networks remain acceptance work.

## Active UI/UX follow-up — second pass

### Six quick wins — 2026-11-11 (beta.9, frontend only)

User asked for the whole "A" batch from the improvement list. All frontend-only,
no protocol or backend change, so the deployment recreated only the frontend:

- Tab title: composed from room and timer (`⏱ 4:32 · Spectrum v2`, `Time is up`,
  room code, default). Silent; no notification permission. Module is SSR-safe
  and idempotent, timer value refreshes with the existing 200 ms tick.
- Note navigator: `Ctrl/Cmd+K` opens and focuses search (ignored in editors,
  inputs and open dialogs), `Enter` opens the first result, matches are
  highlighted in the title with an accented-aware matcher, and a body snippet is
  shown only when the title does not match.
- Lobby: last valid room code stored locally (never notes or credentials) with a
  one-click rejoin and a forget button; storage failures are silent.
- Missing room: the actionable alert now also offers "create a new room instead"
  which scrolls to and focuses the create form (reduced-motion aware).
- Theme: no saved choice follows `prefers-color-scheme` and live system changes;
  an explicit choice always wins and stays persisted.
- App menu: link back to v1 at `/`.
- Checks: lint, type-check, build, 141 unit tests, and 12 Chromium/Firefox/WebKit
  cases (timer title, note shortcut/highlight/Enter, lobby recent room, v1 link,
  system theme) passed. Local backend/Vite only; production untouched.
- User approved deployment. Committed with the preceding lobby/note-search pass
  in `f036f5c` (19 frontend files, no main push, no deployment files/secrets),
  tagged `v2.0.0-beta.9`. The first CI run was cancelled at 35 min because the
  Azure apt mirror stalled during `playwright install --with-deps`; rerunning the
  failed jobs passed (run 43046003050). Manifest verified.
- Deployed frontend `sha256:82050ffa206851fb514e9f0a588266eca921330130d88962d1c1290ba12f7d63`
  only. Backend kept beta.8 `sha256:eb4fbc1e…` because the release changes no
  backend code: `StartedAt` unchanged, so in-memory rooms survived. LiveKit,
  PeerJS and coturn untouched. Rollback snapshot `/opt/spectrum/pre-uiux-a-20261111T151232Z`.
  Production smoke passed system theme, room/countdown title, `Ctrl/Cmd+K`
  highlight/Enter, remembered room, v1 link, missing-room create action, timer
  regression and forced TLS audio.

### Group D — 2026-11-15 (local, frontend only)

User asked to close the remaining polish items, with emphasis on spacing and
typography:

- UI scale: added `--v2-text-*` and `--v2-radius-*` tokens in `app.css` and
  replaced every hardcoded font size and border radius in the v2 components.
  Tokens are the exact 1:1 rem equivalents of the previous pixel values, so the
  default rendering is unchanged but the UI now follows browser font-size
  preferences.
- Radius harmonization: four steps only (4/8/12/16px + pill). Lobby card,
  onboarding card, note card top corners, canvas tools and status chips now use
  the same scale instead of 5/6/10/14/15/20px one-offs.
- Chrome spacing: top bar, offline banner and action bar share one 16px
  horizontal rhythm; toolbar summaries use the 4px icon gap; lobby header,
  forms and privacy block snapped to a 24px desktop / 20px mobile grid.
- Generic recovery copy: unmapped lower-case protocol messages no longer show
  raw English codes; they map to "action did not go through" guidance (EN/FR).
  Readable sentences and known errors are untouched.
- Touch labels were reviewed and left icon-only on narrow screens: the top bar
  already wraps, visible labels would crowd the canvas, and every control keeps
  an accessible name plus a title.
- Checks: lint, type-check, build, 155 unit tests and the full Chromium/Firefox/
  WebKit suite (159/159) pass.
- User approved deployment. Committed frontend only in `431b600` (16 files, no
  main push, no deployment files/secrets), tagged `v2.0.0-beta.12`, pushed `v2`.
  CI run 43721249839 green; manifest frontend
  `sha256:bf37fdd41566653cc316efdbe0bd67f9ea5447749333cbd62315ca2b60101f4b`.
- Deployed frontend only; backend kept beta.8 `sha256:eb4fbc1e…` with its
  `StartedAt`, so rooms survived. Snapshot `/opt/spectrum/deploy-frontend-beta12-20261115T141046Z`.
- Production smoke passed the rem scale (including a 20px root font size),
  16px chrome rhythm, single radius scale, localized generic error fallback,
  plus the A, B, C, timer and forced-TLS audio regressions.
- Ops follow-up outside the app: LiveKit warned that the UDP receive buffer
  (`425984` bytes) was below the suggested `5000000`. Docker refused the
  container-scoped `sysctls` (`unsafe procfs detected`), so the host now has
  `/etc/sysctl.d/99-webrtc.conf` with `net.core.rmem_max`/`wmem_max = 5000000`;
  LiveKit was recreated, the warning is gone and TURN/TLS audio still passes.

### Group C — 2026-11-14 (beta.11, frontend only)

User asked for the "C" batch after beta.10. Two of the four proposed items were
already delivered and are covered by existing tests, so this pass ships the
remaining two plus the copy polish:

- Microphone retry: the obsolete permission alert is already cleared on a
  successful publish (`voice-connection.ts` + `e2e/voice.test.ts`); no change.
- Resize camera policy: a viewport change still keeps a deliberate pan/zoom,
  but a resize can no longer leave the canvas showing nothing. New pure helpers
  `isContentVisible`/`keepContentVisible` pan minimally to the nearest note or
  the spectrum zone, preserving scale; wired into the workspace resize handler
  and unit-tested.
- Localized recovery errors: `operation not allowed for this role` and
  `already in a room` now map to actionable copy (EN/FR) instead of the raw
  server string, with a browser regression that injects the protocol error.
- Vocabulary polish: the v2 activity journal says "proposition" (FR) instead of
  the leftover "claim", and the newer lobby strings now use "salle" like the
  rest of v2. The microphone options trigger uses a microphone icon so it no
  longer duplicates the room-settings gear on touch layouts.
- Also already covered before this pass: persistent note status, mobile claim
  display/edit, Chat-first Discussion, dialog focus return, journal contrast.
- Checks: lint, type-check, build, 154 unit tests and the full Chromium/Firefox/
  WebKit suite (159/159) pass.
- User approved deployment. Committed frontend only in `85101d3` (11 files, no
  main push, no deployment files/secrets), tagged `v2.0.0-beta.11`, pushed `v2`.
  CI run 43602483531 green; manifest frontend
  `sha256:4049de2a420bfaff152da2f1b81b5a3c3c904c3278e0a844f3075d51cb1fca8d`,
  backend `sha256:09525326…`.
- Deployed frontend only; backend kept beta.8 `sha256:eb4fbc1e…` with its
  `StartedAt`, so rooms survived. Snapshot `/opt/spectrum/pre-uiux-c-20261114T141735Z`,
  path in `/opt/spectrum/uiux-c-backup-path`.
- Production smoke passed the localized in-room invitation error, responsive
  resize with reachable actions, plus the A, B, timer and forced-TLS audio
  regressions.

### Group B — 2026-11-13 (beta.10, frontend only)

User asked to continue with the "B" batch. Five items, all client-side, no
protocol or backend change:

- Export notes: new "Export notes (.md)" entry in the app menu, room-only. The
  Markdown is built from the notes and links already present in the last
  authorized snapshot (no extra request, no hidden note), sorted by title,
  flags non-approved notes, keeps unknown link targets by identifier, and is
  downloaded as `spectrum-<room>-<date>.md` through a Blob. Disabled with an
  explicit hint when nothing is visible.
- Microphone picker and input meter: listener-local device list from
  `enumerateDevices()` (refreshed on `devicechange`), persisted in
  `localStorage` under `spectrum-mic-device`, applied through the single
  `createLocalAudioTrack` path and only restarting capture when the mic is
  already live. Names stay hidden until permission is granted; the meter is an
  AnalyserNode RMS bar with a "no signal" hint after 2.5 s.
- Offline banner: shown after the first successful connection whenever the room
  status is not `Connected`, explaining that changes are paused and that drafts
  stay local. Hidden in presentation mode.
- Timer for non-admins: already visible read-only with the shared countdown;
  covered by the existing timer regression, no change needed.
- Canvas onboarding: one-time non-blocking card with three gestures (note and
  Markdown, linking notes, raise hand/spectator). `pointer-events: none` except
  its dismiss button, so it cannot intercept canvas or e2e clicks; dismissed
  state kept in `localStorage`.
- Also fixed a pre-existing WCAG AA contrast failure on `.audio-unavailable`
  (opacity 0.5 → 0.7) found by the accessibility suite with voice disabled.
- Checks: lint, type-check, build and 146 unit tests pass; the full Chromium/
  Firefox/WebKit suite passed (156/156) including onboarding, offline banner
  (WebSocket close), export download, and the lobby/note/search/room-sharing/
  timer/accessibility regressions.
- User approved deployment. Committed frontend only in `b76b1cf` (14 files, no
  main push, no deployment files/secrets), tagged `v2.0.0-beta.10`, pushed `v2`.
  CI run 43345223344 green (release, backend, frontend, both publishes,
  manifest); manifest frontend
  `sha256:ea556ab55e71d08ee25fbe6c9bf2b3fa1cdd7f0eb6c85470cac73c3908d36d5d`,
  backend `sha256:5c1d0748…`.
- Deployed frontend only. Backend kept beta.8 `sha256:eb4fbc1e…` and its
  `StartedAt`, so ephemeral rooms survived; LiveKit/PeerJS/coturn untouched.
  Snapshot `/opt/spectrum/pre-uiux-b-20261113T054235Z`, path recorded in
  `/opt/spectrum/uiux-b-backup-path`.
- Production smoke passed onboarding once, Markdown export, mic options panel,
  offline banner, plus the A batch, timer and forced-TLS audio regressions. The
  transit to the host was intermittently slow during smoke, so the temporary
  scripts now use a longer default timeout; server-side responses stayed fast
  and no product regression was involved.

### General UI/UX mini-pass — 2026-11-11 (shipped in beta.9)

User clarified the mini-pass should cover v2 beyond the timer. Two targeted
improvements, with no backend/protocol changes:

- Lobby invitations: normalize lowercase codes, optional OSR prefix, v2 links
  and legacy OSR path links. Reject malformed invitations locally with a focused,
  described inline error; clear it on edit. Never navigate to/fetch pasted URLs.
- Note navigator: search title and content, case/accent-insensitive; focus search
  on open, show result count/no-match guidance, clear query and focus selected
  note. Filter only the currently authorized list; no extra request or hidden
  note retrieval. Empty views keep their existing explanation.
- Lint/check/build and 132 unit tests passed. Chromium/Firefox/WebKit passed
  both new mobile flows plus the existing note-visibility/zoom regression
  (9 browser cases). Temporary backend/Vite instances only; production untouched.
  Shipped together with the six quick wins in `f036f5c` / `v2.0.0-beta.9`.

### Timer UX follow-up — beta.8

- Added 1/3/5-minute presets which only fill the form; they never start or replace
  the shared timer without pressing Start. Controls remain admin-only and disabled
  when disconnected. Added a visible localized completion label, including for
  late joins, without replaying the animation or adding sound.
- Local checks passed: lint, type-check, build, 123 unit tests, and targeted
  Chromium/Firefox/WebKit mobile/reduced-motion/reload flow.
- User approved deployment. Only five timer frontend/test/catalog files were
  committed in `99ceefc`, tagged `v2.0.0-beta.8`; no main push or migration files.
  Hosted CI 42966728357 passed, paired manifest verified. Both beta.8 digests
  were deployed manually on france; rollback snapshot is recorded privately in
  `/opt/spectrum/timer-ux-backup-path`. Runtime secrets, Compose and voice
  configuration were verified unchanged; only frontend/backend were recreated.
  Frontend digest `sha256:74ea335418a00c37436915de56bff9156cc0817616bb2387fa9620f8be9f0c2c`;
  backend `sha256:eb4fbc1efa3531bebab1c0ee333f81e213e5fc2b2fa0af46c604d2bc9346f754`.
  Production smoke passed presets without auto-start, shared countdown, visible
  silent completion, mobile/reduced-motion support, reload and clear. Forced
  TURN/TLS audio also passed. No LiveKit/PeerJS/coturn restart or main push.

### Shared silent timer — 2026-11-11 (beta.7 deployed)

- Added `room.timer` with integer `durationSeconds` (1–86400; 0 clears). Server
  checks actual room admin membership under the room lock; participants and
  spectators cannot start, replace or clear a timer. No client-supplied deadline.
- Room snapshots include timer revision, deadline and server time. Countdown
  uses a monotonic client clock anchored to server time, survives reconnect and
  late joins, and needs no ticking server goroutine. Mutation invalidates room
  state and advances the shared revision, so existing stale-snapshot protection
  applies to timer changes too.
- Header minuteur controls are admin-only, localized FR/EN, with minutes/seconds
  fields and clear action. All roles see the countdown. At zero: one subtle
  visual pulse, no sound; reduced-motion users receive a static finished state.
  Expired timers restored after reload do not replay the completion animation.
  No per-second live-region announcements. Header controls wrap on mobile.
- Validation: Go race suite and golangci-lint 2.15.0 (0 issues); frontend
  lint/check (0 errors/warnings), 122 unit tests and production build. Targeted
  Playwright test passes Chromium, Firefox and WebKit: mobile admin, spectator
  sharing, completion, reduced motion, reload without replay and clearing.
- Local port 5173 belonged to another project, so browser validation used an
  isolated Vite instance on 5174 and a temporary local backend; unrelated dev
  server was not modified.
- User subsequently approved committing/pushing the timer only and deploying it.
  Commit `40dfdda`, tag `v2.0.0-beta.7`; CI run 42942567523 passed all jobs and
  emitted a valid paired manifest. Deployment was manual on `ssh france`.
  Frontend digest `sha256:8e7f6c9598b4ef5dce36ad10e9f11e259d15d5e94ef61aafa7ca58f9285016b9`;
  backend `sha256:94482f0bf4e4c73d64edc854b12b630d995e84b1e4a011f0c9fad98ea4830570`.
  Only frontend/backend were recreated. Runtime, Compose, LiveKit secrets/config
  unchanged; LiveKit, PeerJS and coturn were not restarted. Voice stays enabled;
  transcription stays disabled. Prior beta.6 refs/config are backed up privately
  under the path recorded in `/opt/spectrum/timer-backup-path`.
- Public production smoke passed: mobile admin controls, shared countdown,
  silent finish, reduced motion, reload without animation replay and clear.
  `/`, `/v2`, API docs return 200. Forced TURN/TLS audio smoke also passed.
  Migration files and their documentation remain uncommitted; no main push.

### Manifest job checkout — beta.6 follow-up

Beta.6 run 42485640357 passed every validation job and both publish jobs. Its
artifacts contain correct, pullable references:

- frontend `ghcr.io/opinions-sur-rue/spectrum-frontend@sha256:a19df5ef…b7df5`
- backend `ghcr.io/opinions-sur-rue/spectrum-backend@sha256:7282f819…44b32`

Both the release tag and `beta-sha-5ad5b0e…` published the same digest per image.
The log shows only those two tags per component: no `latest`/`main`, no deployment
dispatch. The `manifest` job alone failed (exit 127) because it called
`.github/scripts/write-beta-manifest.sh` without checking the repository out.
Add the missing checkout at the release SHA. No rebuild or new tag: the image
artifacts are authoritative and the corrected `beta-images.json` was assembled
and validated with the same script.

### Deployment preparation — compose overlay and manual gate

`utile-compose` is the production stack. Prepare (do not deploy):

- `docker-compose.spectrum-beta.yml` overlay pinning both beta.6 digests, used
  with the base file so the ordinary `:latest` flow is untouched.
- Manual `deploy-spectrum-beta` workflow using the existing `utile-space`
  approval environment. It writes `.env.spectrum-beta` (voice LiveKit values,
  transcription forced off), records the running image refs for rollback, deploys
  only the two Spectrum services, then checks `/`, `/v2` and backend docs.
- Rollback re-runs the workflow with the previous refs as inputs; images are not
  pruned.
- Voice needs a real LiveKit server with TLS (`wss://`) and TURN; until those
  secrets exist the workflow can deploy with `enable_voice: false`.

Merging or dispatching that preparation is a separate explicit approval.

### Digest-pinned release manifest — beta.6

Beta.5 hosted run 42431955718 passed every validation and publish job and
published both images, but `beta-images.json` named them as
`spectrum-beta-smoke@sha256:…`. The publish step read `RepoDigests[0]` from the
local image, which still pointed at the pre-publish smoke tag. The digests
themselves were correct and both release/commit tags published the same digest.

- `push-digest.sh` pushes a tag and prints only the digest reported by that push;
  it fails when no digest is reported or the push fails. Never read local
  `RepoDigests`, which can contain non-pullable repository names.
- The publish step requires the release tag and `beta-sha-<commit>` tag to report
  the same digest, then cross-checks it with `docker buildx imagetools inspect`
  against the registry before writing `image@sha256:…`.
- `write-beta-manifest.sh` validates both references against the exact
  `ghcr.io/<repo>/<component>@sha256:<64 hex>` form before producing the manifest.
- Local tests cover realistic push output (build vs push digest), missing digest,
  failed push, valid manifest assembly, rejection of the local smoke tag, mutable
  tags/wrong component and missing inputs: 7 passed. actionlint and diff checks pass.
- Recovered beta.5 registry references from its successful push logs (both tags
  agreed): frontend `sha256:3e41a434…76ee`, backend `sha256:acdf5aa1…033a`.
  They remain valid for deployment if beta.5 is chosen, but its stored artifact
  is wrong; prefer the beta.6 artifact.

Rebuilt images and a verified manifest require a new candidate: `v2.0.0-beta.6`.
No application, container or test behaviour changed; earlier tags stay immutable.

### Container startup readiness — beta.5

Beta.4 hosted run 42390728875 passed backend validation and the complete frontend
job, including both Firefox voice scenarios after isolated PulseAudio setup.
Both production images built. Backend smoke/publishing succeeded, but frontend
smoke failed with curl 56 (connection reset) immediately after `docker run`;
Nginx logs show normal startup/worker initialization, not a configuration crash.
No paired release manifest was emitted. The backend beta.4 image alone exists
in GHCR and is not a complete deployable release; no deployment was triggered.

- Shared `.github/scripts/wait-for-http.sh` retries startup errors including
  connection resets, with finite attempts, connect/request timeouts and retry
  time budget. Used for CI backend startup and both production smoke containers.
- Frontend route HTTP/content checks and post-readiness backend check remain
  strict, without retries. No application, Nginx config or test exclusions changed.
- Added local HTTP-server tests: first response resets the connection (curl 56)
  then succeeds; permanent HTTP 503 still fails within the bounded wait. Both
  tests passed; also run in the beta workflow before validation jobs. bash syntax,
  actionlint and diff checks passed. Full container checks remain hosted gates.

Correction uses new `v2.0.0-beta.5` tag; preserve beta.4 and earlier candidates.

### Headless Firefox audio output — beta.4

Beta.3 hosted run 42388033858 passed backend and v2 UI checks but failed both
Firefox voice scenarios (Chromium passed). Failure artifacts show a disabled
microphone button with “Enabling microphone…”: publication was pending rather
than rejected. Local Firefox reproduction without a PulseAudio server hangs in
the synthetic fixture's `AudioContext.resume()`.

- Added `.github/scripts/start-ci-audio.sh`: isolated runtime/socket, private
  PulseAudio daemon, virtual 48 kHz null sink/monitor, no physical device modules
  or changes to the desktop server. Beta CI installs PulseAudio utilities, starts
  this server before voice tests, records its log and stops it afterward.
- No application code, microphone-consent logic, voice assertions, browser
  exclusions or timeouts changed. Preserve voice as a release gate.
- Local isolated-server checks passed in Chromium and Firefox: AudioContext
  running, one live synthetic audio track. bash syntax, actionlint and diff checks
  passed. Full local voice attempts could not complete because the Docker daemon
  and backend were stopped; no services restarted. Test-created Vite process and
  isolated audio servers were stopped. Hosted CI must verify end-to-end audio.

Correction uses new `v2.0.0-beta.4` tag. Earlier candidate tags stay immutable;
beta.3 publishing/manifest jobs were skipped, so no image or deployment resulted.

### Browser runner compatibility — beta.3

Beta.2 hosted run 42387696719 passed backend lint/race tests and frontend
generation/check/lint/unit gates, then failed browser installation: the moving
`ubuntu-latest` label selected Ubuntu 26.04, unsupported by Playwright 1.60.0.
Publishing and manifest jobs were skipped; no images or deployment resulted.

Pin the beta frontend and PR frontend jobs to `ubuntu-24.04`. PR browser setup
also installs required OS dependencies explicitly, as the beta job already does.
No Playwright upgrade, browser-test exclusion or production workflow change.
Validate YAML with actionlint and diff checks; publish correction under new
`v2.0.0-beta.3` tag, preserving previous candidate tags. Hosted browser execution
remains the verification gate, not a claim of local Ubuntu-runner validation.

### First hosted CI corrections — beta.2

Beta.1 (`ca4fe1f`, tag `v2.0.0-beta.1`) was pushed on branch `v2`; hosted run
42386544054 failed before publishing. No images or release manifest were emitted,
and no production deployment occurred. Two clean-runner differences were found:

- CI installed golangci-lint 2.15.0 while local lint was 2.5.0. Keep all rules
  enabled; factor repeated fixture values/wire keys into test constants, name the
  repeated live-disconnected state, and use `httptest.NewRequestWithContext` with
  `t.Context()`. Pin both backend CI workflows to 2.15.0; downloaded/verified that
  exact binary locally and obtained 0 issues plus passing full Go race tests.
- A fresh checkout lacked generated Paraglide modules. `npm run check` and
  `check:watch` now compile translations explicitly before Svelte synchronization
  and type checking. Verified in a temporary clean git archive without generated
  source or local .env, reusing only installed dependencies: 0 errors/warnings.

Local frontend full lint/check and 115 unit tests passed. actionlint and staged
diff checks also passed. Corrected candidate uses a new `v2.0.0-beta.2` tag rather
than moving beta.1. No backend restart or deployment is part of this correction.

### Beta CI and Node 24 preparation — 2026-11-07

- GitHub setup completed after user confirmation: repository variables
  `BETA_API_URL=https://api.spectrum.utile.space` and
  `BETA_PUBLIC_URL=https://spectrum.utile.space`; environment `beta` created with
  **no approval gate**, as requested. Settings verified through the GitHub API.
  Repository workflow-token default remains read-only; only publish job requests
  package-write scope. Injected `GITHUB_TOKEN` was invalid; commands used the
  existing SonnyAD keyring login via `env -u GITHUB_TOKEN`, without changing
  credentials. No code/tag push or workflow run performed. GHCR permissions and
  container builds still require verification on the first hosted run.
- Node 24 aligned across frontend Docker builder, PR CI, Android CI and
  `frontend/.nvmrc`/package engines; `@types/node` aligned to major 24 and lockfile
  updated. Dev Compose already used Node 24. Backend builder pinned to Go 1.25.8
  to match `go.mod` rather than floating `golang:alpine`.
- Added `.github/workflows/release-v2-beta.yml`: beta-tag push or manual existing
  beta tag; resolves one exact commit; validates repository HTTPS origin variables
  `BETA_API_URL`/`BETA_PUBLIC_URL`; full Go race/lint, frontend lint/check/unit/v1,
  v2 three-engine UI and Chromium/Firefox voice gates using isolated CI fixtures.
  Browser-ASR inference remains outside release gates.
- The `beta` environment groups GHCR publishing (approval is optional; current
  user choice is no gate). Both component images
  are built, production-container smoke-tested, then pushed without a rebuild.
  Tags are beta version + beta SHA; neither latest/main nor external deployment
  dispatches are touched. Successful paired publishing emits `beta-images.json`
  with exact image digests, commit and public origins. Use those digests for any
  later approved deployment and fresh version tags for new candidates.
- IMPORTANT: existing Utile workflow still auto-deploys pushes to main. Use a
  beta branch/tag before a main merge if production must stay unchanged. GitHub
  variables/environment are now configured; the first hosted run is pending.
- Frontend Docker context excludes host dependency/build/test caches, Android and
  local experimental STT assets. Default v1 E2E config now has a preview base URL
  and excludes browser inference tests, which have their own opt-in config.
- Full lint found two prior blockers: member volume now uses writable `$derived`
  instead of effect copying; v1 feedback link has a narrowly documented external-
  URL lint exemption (no routing behaviour change). Voice regression passed 4/4.
- README documents setup, source/digest provenance, no-auto-deploy behaviour,
  disabled initial transcription, missing real-device checks and rollback limits.

Validation on Node 24.22.1: full frontend lint, E2E ESLint, check 0/0, 115 unit tests,
v1 E2E 1/1, voice 4/4, Go race tests, actionlint 1.7.12 on modified workflows and
`git diff --check` passed. Production frontend build passed as part of v1 E2E.
Docker builds could NOT be validated locally: npm registry idle timeout and Go
proxy DNS timeout inside Docker; a host-network retry also timed out. These
remain required gates on the first GitHub run; no image publication/deployment,
live-stack restart or commit was performed. Dependency audit still reports 34
findings (including 4 critical); triage is pending, no broad upgrades performed.

### Canvas navigation — 2026-11-07

- Added localized **Find a note / Retrouver une note** menu beside zoom controls.
  It lists only current authorized snapshot notes, never a separate cache or
  historical/private index. Spectator tests cover hidden → revealed → hidden.
  Navigator is not mounted in presentation mode.
- Selecting a note frames its real width/height, reserves room for canvas controls
  and focuses the existing card with `preventScroll`. No duplicate editor,
  automatic edit or draft reset. Pending-note jumps use the same size-aware path
  instead of forcing at least 80% zoom regardless of card dimensions.
- Renamed reset to **Recenter spectrum / Recentrer le spectrum** and updated help.
  This remains spectrum-only, not “fit all”. An unrestricted fit-all overview is
  deferred: widely separated content can require zoom below the existing 20%
  minimum; this pass does not change camera bounds/zoom policy or claim all such
  content can fit simultaneously.
- Discussion toggle disables follow-spectrum automatic fitting before the canvas
  resizes, preserving world centre and zoom. Existing manually positioned views
  remain stable. Zoom buttons disable at the 20%/300% limits. Mobile status moves
  above the bottom toolbar to avoid overlap with the new navigator.

Validation: full v2 **90/90** Chromium + Firefox; WebKit **45/45**; unit/component
tests **115/115** (four added note-framing cases); Svelte check 0/0; targeted
ESLint/Prettier, production build and `git diff --check` passed. Axe scans include
the new menu. Browser navigation tests cover a resized offscreen note at desktop
and mobile sizes, preserved unsaved content/focus, sidebar camera context,
spectator index privacy and both zoom limits. Artifacts:
`/tmp/opencode/spectrum-navigation-{full,webkit}/`, build log:
`/tmp/opencode/spectrum-navigation-build.log`. No backend restart or commits.

### Network and stale moderation confirmations — 2026-11-07

- `PeopleMenu` discards pending kick/transfer confirmations when admin authority
  is lost, the target leaves, or a transfer target is no longer a participant.
  `SessionMenu` discards pending room closure on loss of admin authority.
- `ConfirmAction` discards every pending action when `ready` becomes false;
  reconnecting cannot silently re-arm a destructive confirmation. Existing
  `dialogFocus` returns focus to the menu summary if the invoking button vanished.
- Added six E2E scenarios: real target departure; role/target changes injected as
  authoritative room snapshots (frontend behaviour, not a server ACL test);
  disconnection with room closure awaiting confirmation; delayed note-save
  acknowledgment followed by newer typing; dropped save before delivery; and save
  accepted by server with acknowledgment lost. Both uncertain-delivery scenarios
  include two more reconnects and a final reload after successful save.
- Existing RAM-only note draft logic passed these scenarios unchanged. An older
  acknowledged revision does not overwrite new typing: it conservatively presents
  a conflict for explicit resolution. Confirmed saves restore as clean; undelivered
  saves restore as unsaved drafts, never automatically replayed.

Validation: full v2 **86/86** Chromium + Firefox, **43/43** WebKit, **111/111**
unit/component tests, Svelte check 0/0, targeted ESLint/Prettier, production build
and `git diff --check` passed. Initial combined run had a Firefox room-create
timeout; an isolated full rerun passed without retries. Artifacts/logs:
`/tmp/opencode/spectrum-network-{full-final,webkit}/`,
`/tmp/opencode/spectrum-network-build.log`. No backend restart, server changes,
voice/STT work or commits. Server ACLs remain enforced independently of UI guards.

### Accessibility and edge cases — 2026-11-07

- Added dev-only `@axe-core/playwright` checks for WCAG A/AA rules on the lobby,
  room, note, People/Room/App menus (lofi/light/dark), and mobile Discussion.
  Automated checks are not a screen-reader audit or a WCAG compliance claim.
- Fixed literal `%paraglide.lang%` in the document: static SPA hosting had no
  replacement hook. HTML has a valid French fallback and the root layout applies
  `getLocale()` after hydration, so screen readers receive the selected language.
- Fixed dark-theme text contrast on the admin badge and selected Discussion tab;
  retain tinted backgrounds but use theme foreground for text.
- Discussion now moves focus inside when a desktop nonmodal panel becomes a
  mobile modal panel while focus is outside. Tab panels are keyboard-focusable,
  including read-only scrollable content. Tests cover arrows, Tab and Escape.
- Share and confirmation dialogs have viewport-limited height/internal scrolling;
  long confirmation headings wrap. Tests exercise reaching the bottom actions,
  Escape/focus restoration, 80 fixture spectators, a 500-character unbroken
  proposition and a 1000-character chat message at 640×450 CSS pixels. This is
  1280×900 at 200%-equivalent reflow, not actual browser/OS zoom or a load test.
- Full regression exposed intermittent lost Reveal clicks: focusing an above-card
  dock exposes advanced controls, changes its height and can move the button
  between pointerdown and click. `noteDock` freezes placement while held down,
  then reflows after release. Added a held-pointer regression; affected note
  scenarios passed 12/12 on repeated Chromium/Firefox runs.

Final validation: v2 **74/74** Chromium + Firefox; WebKit **37/37**; unit/component
tests **111/111**; Svelte check 0 errors/warnings; targeted ESLint/Prettier, build
and `git diff --check` passed. Initial runs caught the dock issue; an earlier
parallel production build also triggered a Vite reload during an axe scan. Final
browser suites ran without concurrent build, with no retries. Logs/artifacts:
`/tmp/opencode/spectrum-a11y-{regression,webkit-regression,dock-final}/`.
No backend restart, voice/STT changes or commits. Real Safari, physical mobile,
actual zoom controls and screen-reader checks remain pending. npm install still
reports 34 dependency audit findings; no broad audit-fix performed.

### Hardening pass — keyboard, edges, reconnection — 2026-11-07

Continued without new features, transcription work or commits. The only backend
restart was explicitly authorized to activate the reaction guard.

Implemented:

- Shared screen-space `floatingLayout` keeps note docks and toolbar popovers inside
  the visible viewport (including `visualViewport` offsets/zoom): clamps both axes,
  flips above/below the anchor, limits size, scrolls overflow and wraps long text.
  The note dock also avoids the bottom navigation/status strip, keeps its pointer
  bridge while hovered/focused, and retains editor focus after save so it cannot
  collapse under the pointer.
- Mobile Discussion now marks sibling regions inert while open and restores their
  previous inert state on close/destroy. Close returns focus only after the panel
  has actually closed.
- Proposition editing: Escape cancels even when the draft is unchanged; an explicit
  Cancel button is always available; focus returns to the edit control. Losing
  admin authority immediately drops the local draft and exits editing.
- Reconnection safety: room controls (`ready`) now require a fresh `room.state`
  after socket `signin`, not only a connected socket. A formerly admitted room
  that can no longer be re-joined is retired back to the lobby instead of leaving
  stale admin controls enabled. Unit and browser tests cover delayed snapshots and
  failed re-admission.
- Muted copy raised from 0.5/0.55 opacity to 0.75 in chat footer, lobby, room code,
  privacy note and claim metadata. Native select centering fix remains central.

Validation: **111** unit/component tests (+7), Svelte check 0 errors/0 warnings,
targeted ESLint/Prettier, `git diff --check`, production build, full v2 regression
**68/68** (Chromium + Firefox) and voice **4/4** passed after the backend restart.
Backend: `go test -race ./...` passed and `golangci-lint` reported 0 issues; image
rebuilt, container restarted with explicit user approval (ephemeral rooms wiped).
The new browser test bypasses the UI over a raw WebSocket and confirms the live
server rejects a spectator `room.react` with `reaction_failed`. Regression
artifacts: `/tmp/opencode/spectrum-backend-activation-full/`, targeted:
`/tmp/opencode/spectrum-backend-reaction-guard/`, build log:
`/tmp/opencode/spectrum-ui-hardening-build.log`. Changes remain uncommitted.

Safari approximation: added `playwright.webkit.config.ts` and
`npm run test:e2e:webkit`. Full v2 UI suite passed **34/34** on Playwright WebKit
26.4 after installing the missing `libwoff1`; this is the closest Safari engine on
Linux, **not macOS/iOS Safari**. It found one test-only fragility: WebKit
serialized note coordinates with different precision, so the cross-engine test now
compares parsed pixel values with tolerance instead of exact style strings. The
voice suite does **not** pass on WebKitGTK: microphone publication stays unavailable
with the synthetic track, so Safari voice remains unverified. Physical-device,
real-Safari and screen-reader checks are still pending.

### Follow-up: visual feedback — 2026-11-07

User requested animated participant-only emoji reactions, no hand-raise burst,
clearer own/speaking pellets, SVG labels above collision highlight, vertically
centered select values, a transparent floating note dock with subtle motion and
theme-aware notes.

Implemented:

- Emoji bursts with bounded particles/lifetime; no hand-raise animation added.
  Only on-stage users (participants and admin) see the sending menu; all members
  can still see reactions. Spectators retain hand raising. Reduced-motion mode
  replaces bursts with a static emoji and disables speaking/dock animation.
- Server `room.react` now revalidates stage membership under the room lock,
  including after demotion. Go tests cover spectator denial, participant/admin
  admission, demotion, emoji validation, cooldown and public-ID audience scoping.
  The rebuilt image was activated on 2026-11-07 after explicit approval; the
  restart wiped ephemeral rooms as warned. A raw-WebSocket browser test now
  bypasses the hidden UI and confirms the running server returns
  `reaction_failed` for a spectator.
- Own pellet has a persistent localized You/Vous badge at fixed screen text size,
  plus a distinct center mark. Speaking uses a larger pulsing green ring with
  screen-sized thickness and static fallback for reduced motion.
- Added an image layer containing original SVG labels above highlight and below
  pellets. Labels can be outlined paths; remove only known cell geometry from a
  derived copy. Original shared v1 SVGs remain unchanged. Neutral-circle masking
  also applies to this label layer; FR/EN 3/5/7/9 variants covered by tests.
- Native select block padding/line-height corrected centrally to avoid Forms/
  DaisyUI fixed-height conflicts. Native option menus are retained.
- Notes and mobile inspector follow Lofi/Light/Dark variables, including headers,
  editor content, inputs and controls. Removed the attached solid footer: floating
  translucent dock groups on a transparent root, soft hover/press movement and
  fade-out/in; pointer bridge and keyboard focus keep actions reachable. Mobile
  inspector keeps actions immediately visible and at least 44px.

Validation: 104 frontend unit/component tests, Svelte check, targeted ESLint,
production build, spectrum Go race tests and golangci-lint passed. Separate voice
suite passed 4/4 on Chromium/Firefox, including the actual speaking-ring state.
Full v2 regression passed **58/58**, including the role-gated reaction menu,
bursts/expiry, label layering, fixed-size own marker badge, select metrics,
light/dark cards/inspector and floating dock fade/reduced-motion behaviour.
Visual artifacts: `/tmp/opencode/spectrum-ui-feedback-visual/`; regression
artifacts: `/tmp/opencode/spectrum-ui-feedback-final-{v2,voice}/`. Existing build
large-chunk and legacy jsdom WebRTC warnings remain. Physical-device/Safari checks
remain unclaimed. Backend activation is still pending; no commits or room reset.

### Implementation authorized — 2026-11-07

User approved proceeding after Lot A. Current implementation includes:

- RAM-only note draft recovery, pruned by fresh authorized snapshots and cleared
  on room/identity/authority changes; concurrent content is a conflict, not an
  automatic overwrite. Disconnect still clears rendered private cards.
- Successful microphone publication clears obsolete permission errors.
- Journal uses normal-contrast text with semantic border accents; invite/help/
  confirmation dialogs restore invoking focus.
- Participation controls moved below the canvas. Proposition is readable by
  default with explicit edit/focus/save mode. Room/app controls look distinct.
- Mobile Discussion occupies the viewport, has keyboard focus containment and
  preserves drafts. Chat opens first; passive activity no longer increments the
  global Discussion badge. Added jump-to-latest without forced scrolling.
- Mobile notes open the **same mounted editor** in a native dialog outside the
  canvas transform; actions stay at least 44px. Escape/close returns to the card;
  note state is visible at rest, with read-only approval feedback. Position arrows
  and numeric dimensions preserve mobile layout editing; pinned notes stay locked.
- Experimental local transcription sits in audio options; active status remains
  visible on the summary. Separate consent and no-download-before-consent remain.
  No ASR/model work or backend restart is part of this UI pass.
- Known room-not-found/full errors have localized actionable copy inside the lobby.
  Failed admission no longer refreshes a nonexistent canvas and overwrites the
  useful error with `not_in_room`.
- Existing camera policy remains: follow auto-fit until the user changes view;
  preserve deliberate pan/zoom thereafter, with explicit recenter available. A
  general offscreen-content navigation redesign is not part of this slice.

Final validation for this UI slice:

- **96/96 frontend unit/component tests passed.** Existing legacy jsdom WebRTC
  warning remains; it did not fail the suite.
- **54/54 v2 E2E passed**, Chromium and Firefox, including reconnection during
  presentation, mobile inspector teardown on disconnect/revocation, concurrent
  text conflict, mobile move/resize without losing unsaved text, short-screen
  Discussion, audio-options geometry and French invalid-room recovery.
- **4/4 self-hosted voice E2E passed**, Chromium and Firefox, including permission
  retry. This final run supersedes the audit's earlier Firefox timeout, without
  establishing that timeout's cause or universal browser reliability.
- Svelte check: **0 errors/warnings**; targeted ESLint and diff whitespace check
  passed. Production build passed with existing large-chunk warnings.
- No real ASR inference rerun in this UI slice; its consent component tests pass,
  the optional inference E2E selector now opens audio options, and no model/runtime
  algorithm changed. Do not claim a new ASR performance or compatibility result.
- Visual artifacts: `/tmp/opencode/spectrum-ui-pass2-visual/`. Final regression
  artifacts: `/tmp/opencode/spectrum-ui-pass2-final-{v2,voice}/`; build log:
  `/tmp/opencode/spectrum-ui-pass2-build.log`.
- No backend restart, commit or broad working-tree cleanup. No background job left.

Remaining: physical mobile/OS keyboard and Safari checks, screen-reader review,
broader offscreen-content navigation and optional visual refinements. Earlier Lot A
findings below describe the audit baseline, not a claim that every item is fixed.

Historical initial approval was **Lot A only**: audit the existing v2 interface and propose a
layout/direction for review before implementing UI changes. **Lot A is now
complete within the scope documented below; its initial approval covered audit
only. Implementation was subsequently authorized as recorded above.**

- Audit admin, participant and spectator journeys: create/join, understand role,
  position on the spectrum, notes, audio/microphone, discussion, moderation,
  invitation, presentation, leaving and connection recovery.
- Inspect desktop/mobile, empty/loading/error states, keyboard access and visual
  hierarchy. Distinguish observed usability problems from code-based hypotheses.
- Deliver prioritized friction findings and proposed layouts in chat for approval.
  Lots B–D were not authorized at that point; subsequent approval is recorded above.
- **Transcription is experimental, delivery is uncertain and UI/UX priority is
  low.** Do not treat it as a launch requirement or let its controls dominate the
  interface. Audit it only enough to preserve clear consent, honest experimental
  status and independence from voice. Prioritize core debate, notes, participation
  and audio journeys. No model training or ASR expansion in this lot.
- Preserve existing permissions, privacy, drafts and uncommitted work. No backend
  restart or room reset is required for the audit.

### Lot A: initial visual inspection

Local Chromium inspection used a separate disposable audit room, French locale,
admin/participant/spectator views, 1440×900 desktop, 390×844 portrait and 844×390
landscape. Captures/geometry are in `/tmp/opencode/spectrum-ui-audit/` (temporary
artifacts, not versioned). No app code changed. This is not a completed usability,
keyboard, real-device or cross-browser audit.

Observed priorities for the proposed layout:

1. Portrait admin controls and claim consume roughly 383 of 844 px before the
   canvas starts. The inactive experimental transcription control alone occupies
   an extra button row and explanatory text. Move it out of primary participation
   controls; keep separate consent and an explicit experimental label when opened.
2. In 844×390 landscape with Discussion open, its header/tabs consume nearly all
   remaining panel height. Propose a compact/mobile full-height discussion view
   with an obvious return to the canvas, rather than squeezing under every bar.
3. Resizing from desktop to portrait can leave the spectrum offscreen despite a
   reduced zoom. Explicit recenter restores it. Define resize/orientation camera
   behaviour without indiscriminately resetting intentional user pan/zoom.
4. Admin claim input clips the example sentence in portrait, while the spectator
   heading wraps it. Propose readable wrapped display plus explicit edit mode.
5. Several unlabeled header icons, including two gear-like controls, require
   discovery. Propose clear room/app grouping and labels for primary actions.
6. Discussion initially opens Journal; its own system events also produce unread
   attention. Propose Chat as initial tab and separate message/moderation attention
   from lower-priority activity. Preserve drafts, scroll and user tab choice.

Direction for review: compact room header, readable claim, focused canvas, one
participation bar (audio/mic, hand, note, Discussion); administration secondary.
Transcription remains an optional experimental entry inside audio options, not
part of the required core layout. Desktop Discussion can remain a side panel;
mobile Discussion should prioritize readable content.

The remaining desktop/emulated-viewport checks were completed in the follow-up
below. Actual mobile keyboard/device behaviour remains outside this audit.

### Lot A completed: findings and proposed second-pass scope

#### Method and evidence

- Independent local audit rooms only; no backend restart, configuration change,
  model download, ASR training or app-source edit. Synthetic audio only: no capture
  from a person's microphone. No real external live platform was connected.
- Visual/interaction inspection in Chromium, FR and EN, three roles, Lofi/Light/
  Dark, desktop and emulated portrait/landscape/touch. A short 390×480 viewport
  approximates reduced space, not an actual OS keyboard or browser-zoom test.
- Follow-up covered listening/microphone on/off, denied permission then retry,
  empty/read-only chat, keyboard tabs/Escape, preserved chat drafts, invite QR/link
  and short-dialog scrolling, participant note save/approval/reveal/audience gates,
  presentation/privacy/drafts, controlled WebSocket interruption/recovery,
  cancel/confirm leave, and invalid room errors.
- Eight follow-up scenarios completed. Scenario completion does not imply absence
  of defects: the reconnection scenario explicitly records lost note content.
- Existing v2 regression suite: **40/40 passed**, Chromium and Firefox. Separate
  self-hosted voice suite: Chromium passed; **Firefox exceeded 120 seconds**, with
  cleanup obscuring the original wait. Voice regression is not fully green; do
  not attribute the timeout to transcription or declare its cause established.
- Artifacts: `/tmp/opencode/spectrum-ui-audit/`, including `follow-up/results.json`,
  `follow-up/details.json`, screenshots and separate regression output folders.
  These are temporary local evidence, not committed fixtures or permanent docs.
- Exclusions: physical phones, Safari, screen-reader user testing, comprehensive
  WCAG conformance, real browser zoom at 200%, real-room acoustic conditions,
  external live integrations and production-network reliability. These exclusions
  do not leave an automated audit running; no background work remains.

#### Prioritized observed findings

**P1 — preserve work and make core actions usable**

1. **Unsaved note text is lost on connection recovery.** Reproduction: create a
   note, change its heading without saving, interrupt its room WebSocket, allow
   reconnect. The note returns with its last saved heading (`New note`), not the
   draft. During disconnect all note cards are removed. `room-client.ts` onclose
   sends an empty canvas snapshot; keyed NoteCards unmount and their local drafts
   disappear. Chat draft survives the same interruption. Proposed fix direction:
   separate unsaved editor state from snapshot lifetime, in client RAM only;
   revalidate role/visibility/version before restoring. Never retain/render
   revoked private content simply to preserve a draft. Acceptance: transient
   reconnection preserves authorized drafts and surfaces genuine conflicts.
2. **Mobile note controls scale with the canvas.** At ~80% zoom, note action
   buttons measured ~24×24 CSS px; at ~36% on 390px touch viewport they measured
   ~10.7×10.7, resize handle ~8.6×8.6. Proposed direction: screen-space selected-note
   inspector/editor on small screens; world-space card remains on canvas.
   Acceptance: essential controls target at least 44×44 CSS px independent of
   camera scale, with keyboard alternatives and explicit drag/edit distinction.
3. **Mobile layout leaves too little room for the actual task.** FR admin chrome
   uses ~383/844px before the canvas; landscape Discussion shows essentially just
   header/tabs. In the short portrait viewport its chat section collapses to zero
   client height. Proposed direction: compact context and full-height mobile
   Discussion/editor mode with an obvious return, not a panel squeezed beneath
   all bars. Acceptance: conversation, composer and close/back controls remain
   reachable at 844×390 and 390×480 without losing drafts.
4. **Microphone error contradicts recovered state.** After a synthetic
   `NotAllowedError`, retry successfully publishes audio and shows `Microphone on`,
   but `Microphone unavailable or permission denied` remains visible. Proposed
   direction: clear obsolete operation errors on successful retry; show a useful
   recovery action. Acceptance: no stale alert contradicts current audio state.
5. **Journal text fails basic contrast in Lofi.** Measured full-opacity text
   colors for join/topic entries against white: approximately 1.27:1 and 1.47:1
   at 14px. Proposed direction: normal readable text plus semantic icon/accent,
   not pale green/yellow body text. Acceptance: normal text >=4.5:1 against actual
   backgrounds across supported themes. This is a sampled finding, not a full
   accessibility certification.

**P2 — comprehension, navigation and feedback**

6. **Note state disappears at rest.** Pending/hidden/revealed and unsaved indicators
   show on hover/focus only. Approval makes an author's note read-only without an
   explicit explanatory transition. Proposed direction: persistent concise status,
   separate moderation from audience visibility, explain when editing becomes
   unavailable. Keep the verified two-step reveal + spectator-audience policy.
7. **Admin claim clips on mobile.** The one-row editable textarea clips the
   French example while the spectator heading wraps. Proposed direction: readable
   display by default, explicit edit mode; offer expand/collapse for long claims,
   never silently hide the proposition needed to participate.
8. **Room/app controls share gear icons without visible labels.** Accessible
   names exist, but touch users cannot rely on hover titles. Proposed direction:
   room-specific administration together; language/theme/help in a distinct app
   menu; label primary actions. Preserve confirmation for destructive session
   actions and make labels contextual (`Leave room` / `End session`, not only
   generic `Confirm`).
9. **Invite dialog loses return focus on Escape.** Focus landed on `body`, not
   Invite. Discussion tabs/close and presentation exit correctly restored focus
   in checked paths. Proposed direction: one consistent dialog focus-return
   contract. Short invite dialog can scroll to its buttons: not a blocked action,
   but reduce QR dominance on short screens.
10. **Discussion attention is noisy.** Opens Activity/Journal by default and
    counts own/system activity alongside messages in its main badge. Proposed
    direction: Chat initially, then preserve user's tab choice; separate new
    messages/actionable moderation from passive activity. Sticky scrolling already
    respects reading position; add a clear jump-to-latest action rather than
    replacing that behaviour with forced scrolling.
11. **Recovery/error language is technical or inconsistent.** Invalid room
    displays raw `room not found`, including in French UI, in a remote global
    banner. Proposed direction: localized, field-adjacent explanation and clear
    next action. Align French `claim`, `proposition` and role terminology without
    changing domain/protocol names.
12. **Resize can leave the spectrum offscreen.** Seen on desktop-to-portrait
    resize; explicit recenter restores it. Define a camera policy for viewport/
    orientation changes that keeps usable content visible without resetting a
    deliberate user pan/zoom on every UI update. Also distinguish fit spectrum
    from finding an offscreen note.

**Low priority — experimental extras and polish**

- Transcription is experimental, shipment uncertain, and not a release gate.
  Its inactive button/help occupy primary space today. Proposed layout puts an
  optional `Experimental transcription` entry in audio options, with explicit
  consent and independent status/stop if used. This is de-emphasis, not an ASR
  expansion or a reason to postpone core UI improvements. Do not start inference
  just to audit or render the main interface.
- Keep advanced live configuration secondary. Harmonize spacing/type/buttons
  after core fixes; no rebranding or complete canvas redesign is proposed.

#### Proposed layout for approval (not implemented)

Desktop:

```text
Room identity / role      Invite · People · Room admin · App
Readable proposition                                      Edit (admin)
Canvas / notes                         Discussion (optional side panel)
                                       Chat · Activity · Extras
Listen / Mic · Raise hand · New note · Discussion       View controls
```

Mobile:

```text
Compact room identity / role                      People · More
Readable proposition                              Expand / Edit
Canvas (or focused Discussion / note editor with Back)
Listen / Mic · Hand · Note · Discussion
```

- Keep listening and microphone publication distinct even if their controls are
  grouped. All core controls stay screen-sized; only canvas content scales.
- Mobile Discussion/editor prioritizes its own content area; does not leave
  full room bars stacked above a tiny composer. Preserve input, scroll, selected
  tab and return focus when moving between these views.
- Spectator view explains read-only access and raising a hand; no misleading
  suggestion that joining audio alone grants stage/microphone rights.
- Audio/transcription extras and external live integrations do not shape the
  core release layout. Hidden capability must not be required by empty states.

#### Recommended implementation order, pending user approval

1. Reliability/accessibility slice: note draft recovery with privacy fences,
   stale microphone error, Lofi contrast and dialog return focus. Add regression
   tests for each newly observed defect (existing green tests did not cover them).
2. Core layout slice: compact room/proposition hierarchy, mobile Discussion,
   fixed-size note inspector/actions and camera resize policy. Validate all roles,
   FR/EN, desktop/portrait/landscape, including long content and denied capabilities.
3. Clarity/polish slice: persistent note state, meaningful badges, moderation
   feedback, localized errors and coherent visual tokens. Preserve current
   permissions, consent, privacy, ephemeral retention and working keyboard flows.

No implementation or model training was started as part of Lot A. The subsequent
implementation approval and progress are recorded above.

## Current follow-up — browser-local transcription, 2026-11-06

### Accuracy follow-up

User reported hallucinations on noise and poor word accuracy, accepted a VAD/Base
trial, and saw no noticeable performance difference in interactive Chrome/Firefox.
Do not generalize headless fixture timings into a browser compatibility ranking.

- Added local Silero v5.1.2 neural gate before decoding energy-gated candidates,
  with silence trimming/padding. This is not continuous neural-VAD segmentation;
  eight-second forced cuts remain. Speech below 256 ms can be rejected.
- Consent dialog offers Tiny (default), Base, or Small (GPU only), with model and
  backend shown while active. Approximate client downloads: 75/110 MB Tiny CPU/GPU,
  110/180 MB Base CPU/GPU, 515 MB Small GPU. Changing model or backend requires
  renewed consent; no server fallback.
- Added explicit hardware WebGPU path (FP16) with no silent fallback to CPU. The
  option is hidden unless a non-fallback adapter exposes `shader-f16`; a backend
  mismatch or GPU error stops ASR and asks the user to restart without GPU. Small
  is rejected on WASM/CPU.
- All model sets, FP16 variants, VAD and both WASM runtimes prepared locally. Setup
  supports `--model=tiny|base|all|small`; revisions/checksums pinned and VAD MIT
  license retained. Default setup prepares Tiny CPU+GPU only; `--model=all` is
  required to offer every UI choice.
- WebGPU Base exposed an ORT `multiple calls to initWasm()` failure with Q8 weights
  after the VAD session; FP16 avoids it. Tiny Q8 WebGPU happened to work, but GPU
  mode now consistently selects FP16.
- Real noise gate passed both browsers for deterministic silence/tone/noise/clicks.
  On the clean French fixture, Tiny/Base/Small all produced the same words; no
  accuracy claim from clean audio. On the same fixture mixed with 10 dB white noise,
  Tiny and Base made word errors while Small stayed nearly exact; at 5 dB Tiny
  hallucinated repeated words and Small remained close. Synthetic robustness only,
  not a real-room WER benchmark.
- Single-run GPU decode including VAD on the 4.97 s fixture: Tiny 1.38 s, Base
  1.92 s, Small 3.85 s; CPU WASM Tiny 1.48 s and Base 2.65 s. Chromium live
  UI/microphone consent flow passed with Small/WebGPU (23.6 s test), sharing
  captions/history; Firefox remains CPU-only and capacity-limited.
- Final browser-STT suite: 3/3 passed with Small/WebGPU on the noisy French fixture.
  Canvas tests: **83 passed** (80 server, 3 component); check 0 errors/warnings,
  targeted ESLint and production build passed with existing chunk-size warnings.
- Linux Chrome normally exposed no WebGPU adapter here; `--enable-features=Vulkan`
  made the hardware AMD adapter available. `--enable-unsafe-webgpu` alone yielded
  only a software fallback without FP16 and is rejected. This remains an explicit
  browser launch requirement, not something Spectrum can bypass.
- Post-change Chromium live Tiny EN/auto passed on CPU; Firefox capacity safety
  checks passed without inference. Earlier standalone voice rerun was not fully
  green: Firefox passed, Chromium twice exceeded its 120-second budget, with
  cleanup errors obscuring the original wait. Browser-ASR tests independently verify
  that stopping/capacity shutdown preserve the microphone. Do not call the complete
  voice regression green.
- No backend restart was performed at this checkpoint; the rebuilt image stayed
  inactive while the user might be testing. Superseded by the approved
  2026-11-07 restart above. No commits.

### Earlier prototype validation

User rejected GPU/cloud costs and redirected to opt-in transcription on each
participant's device. Earlier CPU/iGPU notes below are historical, not next steps.
Remote `ssh rog` experiment cleaned up: transfer stopped, temporary experiment
directory removed; no drivers, packages or services changed there.

- Browser prototype implemented with Whisper tiny Q8, Transformers 4.3.2,
  self-hosted model/runtime (~75 MB), single-threaded WASM in a dedicated worker.
- Separate explicit transcription consent; existing microphone reused. Voice works
  without ASR. Bounded audio, overload shutdown, language/generation/track fencing,
  cancellation/late-admission handling, heartbeat and partial-coverage UI included.
- Backend owns attribution/session/order/rate/limits. Browser text is unverified,
  labelled as browser supplied; no server/cloud fallback in browser mode.
- Clean real-fixture rerun: Chromium FR/EN/auto inference passed; Firefox short FR
  inference passed, EN/auto capacity-stop safety checks passed **without inference**.
  A preceding Firefox FR run transcribed then exhausted capacity during spectator
  startup; the history test now stops ASR before opening spectator and checks 0/1.
- Frontend: 73 server unit tests plus a component test for late admission after
  cancellation; microphone-ended tests cover both normal and pending publication.
  Check 0 errors/warnings, targeted ESLint, production build
  passed (chunk-size warnings). Go race suite and lint passed after latest refactor.
- First full v2 rerun hit two journal timeouts and the 300-second command limit.
  Second full rerun completed **37/40**, with a Chromium journal timeout and
  Chromium/Firefox viewport navigation timeouts. Voice suite did not start because
  it was chained with `&&`; no full-green regression claim. Latest backend image
  built successfully, activation pending. Do not reset a user's trial room.
- Guide: `docs/BROWSER_STT.md`. Mobile/Safari, representative accuracy and sustained
  use untested. No production-readiness or universal compatibility claim.
- All changes uncommitted; preserve earlier parity and server experiments.

## Historical follow-up — local iGPU load, 2026-11-06

User clarified target is 6 speakers per Spectrum, 2–3 rooms (12–18 streams),
asked to test laptop iGPU first, then mentioned another machine with a Radeon
RX 6750 XT, 12 GB VRAM. Other machine's OS/access is not yet provided. Do not
scan/connect to LAN machines or provision cloud GPUs without user direction.

- Laptop Vulkan detects physical Radeon 890M (RADV STRIX1), not just llvmpipe.
  Native NeMo-Speech.cpp v0.3.0 Vulkan runtime downloaded and SHA-256 verified
  under `/tmp/opencode/spectrum-nemotron-vulkan/`. No system install/driver edits.
- Added standard-library `services/transcription/load_test.py` and 4 unit tests.
  Isolated loopback server, real-time scheduled public WAV chunks, admission
  policy matching worker's 24 slots/draft suppression. No room capture, no cloud,
  no model edits. Native server processes terminated after each run.
- Automatic Vulkan batching aborted at warmup (`GGML_ASSERT(ne1 == ne11)`).
  Explicit `--batching disabled` worked. No ptrace/permission changes attempted.
- CPU versus iGPU tests ran sequentially, same runtime/weights, 4 CPU threads,
  one in-flight request, 20 seconds per 6/12/18-speaker scenario. At 18 speakers:
  CPU final p95 11.70 s, 46/54 finals; 890M p95 21.59 s, 37/54 finals. Delays are
  after chunk release, not speech onset; dropped finals are queue saturation.
- A 6-in-flight iGPU probe did not improve this burst workload (6 speakers,
  12-second arrivals, p95 final 7.53 s). This is NOT a native-streaming capacity
  test or evidence about the RX 6750 XT / RTX 3060 Ti.
- Full methodology, commands and table: `services/transcription/README.md`.
  Production Docker Spectrum remained unchanged: **Nemotron CPU still active**.
  Next: ask OS/access for the RX 6750 XT machine, test there, and evaluate native
  streaming/batching reliability before promising 12–18-stream capacity.

## Current experiment — Nemotron CPU, 2026-11-06

User requested reversible Nemotron trial, CPU only, and asked whether directly
inspecting/editing weights could improve French. Explained that meaningful
fine-tuning requires consented/licensed data, verified transcripts, training
and held-out evaluation; no direct weight edits or training performed.

- Base Compose still defaults to Whisper. Optional `docker-compose.nemotron.yaml`
  switches only `stt` to a private CPU-only NeMo-Speech.cpp v0.3.0 service.
  **Nemotron is currently active for user trials.** Backend was not restarted.
- Runtime/model checksums and model revision pinned. Public Q8 model downloaded
  and verified, stored alongside Whisper in `stt-models`. Runtime has no egress,
  published ports or log storage; in-memory WAVs only, no room audio files.
- Existing bounded queue, consent, membership fencing, VAD, drafts and transcript
  protocol retained. This adapter is chunked HTTP, NOT native cache-aware live
  streaming. Existing first-draft buffering remains 1.6 seconds.
- Unit tests: 19 passed. Actual Nemotron browser transcription passed in English
  and French. Switched back to Whisper and passed real transcription again,
  then reactivated Nemotron and passed French again. Rollback verified.
- Sequential warmed CPU benchmarks (4 threads, 3 runs): English JFK 11 s,
  Whisper median 1.096 s vs Nemotron 0.799 s; French public fixture 4.97 s,
  Whisper 1.074 s vs Nemotron 0.458 s. Word sequences match on these samples;
  no representative WER/quality claim. Native streaming remains future work.
- Commands, limitations and benchmark tool: `services/transcription/README.md`.
  New code: `nemotron.py`, `download_nemotron.py`, `benchmark.py`, tests and
  `Dockerfile.nemotron`; worker adds an explicit opt-in engine branch.
- Public test fixtures are under `/tmp/opencode/spectrum-nemotron-cpu/` and
  `/models/benchmark-{en,fr}.wav` in the model volume. They are not room audio.
  Browser artifacts: `/tmp/opencode/spectrum-nemotron-e2e-{en,fr}`,
  `/tmp/opencode/spectrum-whisper-rollback`, `/tmp/opencode/spectrum-nemotron-final-fr`.

## Latest checkpoint — 2026-11-06

Resumed at the user's request. Local parity batch validation is now complete:

- Full Chromium/Firefox v2 suite: **40/40 passed**.
- Previously timing-out hand/reaction test: **6/6 repeated runs passed**.
  No code change was needed. Earlier run overlapped source/build activity;
  reload interference is plausible, not a proven root cause. Keep frontend
  sources/build generation stable while running browser tests.
- Frontend server unit tests: **60/60 passed**; check: **0 errors/warnings**.
- Go race tests and golangci-lint: **passed**; diff whitespace check: **passed**.
- Real self-hosted voice: **2/2 passed** (Chromium and Firefox).
- Real English CPU Whisper transcription/history sharing: **1/1 passed**.
  Voice/STT artifacts: `/tmp/opencode/spectrum-voice-final` and
  `/tmp/opencode/spectrum-transcription-final`.
- Production build passed at the preceding checkpoint (large-chunk warning).

Activated the already-built latest backend image with voice/transcription
enabled, including the all-indifferent aggregate fix. Local stack is running.
No commits created; no existing changes discarded.

Remaining limitations below still apply: external live-platform validation,
operator-provided TikTok signer, Twitch pending-dial cancellation, server-error
localization and broader accessibility/usability audit. Do not present local
fixture coverage as operational validation of external platforms.

## Resumed follow-up — 2026-11-05

User requested continuation. Prior pause notes below are historical, not current
instructions to stop. No commits created; preserve the existing working tree.

Implemented since resuming:

- Presentation closes the app popover, focuses exit, and restores menu focus on
  Escape/button exit. Renderer-only spectator policy hides private notes and
  their edges, hidden/spectator-disabled pellets and unsaved note content.
  Mounted editors/drafts are preserved. Added audience-policy unit tests and
  Chromium/Firefox draft/privacy/focus E2E coverage.
- Live menu clears credentials on platform change and distinguishes disconnected
  from connecting. Client filters stale/other-room snapshots and removes voter
  details immediately on authority transfer, including late admin snapshots.
- All-indifferent live votes retain an aggregate at (490,450); latest-vote
  behavior covered by a Go test.
- Live connect/disconnect transitions now appear in the tab-local journal,
  without replaying initial/reconnect state. Added unit coverage.
- Local voice failures use FR/EN catalogs. Session navigation has a distinct
  accessible label (avoids colliding with the Room options popover).
- Dev Compose forwards the optional signer URL. Architecture parity table and
  signer/lifetime limitations updated honestly.

Validation so far: Go race tests and golangci-lint pass; frontend check reports
0 errors/warnings; 60 server unit tests pass; production build passes (existing
large-chunk warning). Targeted presentation/live browser tests pass in both
browsers; both real voice tests and real English CPU Whisper test pass. The
speech fixture was absent after restart and was downloaded again from the
public whisper.cpp JFK sample to `/tmp/opencode/spectrum-stt-speech.wav`.
That day's full rerun ended at 39/40 with a Chromium timeout; the latest
checkpoint above records the successful clean rerun.

Backend container was rebuilt with voice/transcription enabled during this
follow-up. The later all-indifferent aggregate image was built then and
activated at the 2026-11-06 checkpoint above.

Still not claimed: real external-platform validation, operational TikTok without
an operator-provided compatible signer, complete server-error translation,
accessibility/usability audit. Inspected go-twitch-irc v4.4.1: initial/reconnect
dials use a non-context-aware net.Dialer without an explicit timeout;
Disconnect refuses before connActive. Late OnConnect cancellation fences room
state, but pending SDK dial lifetime remains an acknowledged limitation.

## Historical pause point

User explicitly paused work to do something else. **Do not resume automatically.**
Continue when asked, on branch `v2` in `/home/sonnyad/1_Projects/spectrum`.
No commits created during this task. Working tree contains substantial earlier
v2 work as well as this unfinished batch; do not reset or discard it.

Latest request before pause: finish remaining v1 parity. Current batch is
**implemented in draft form, not yet validated end-to-end or declared complete**.

At pause: `npm run check` reports **0 errors / 0 warnings**;
`git diff --check` passes. No build/test command left running by this session.

## Previously completed and validated

- First UI/UX pass: unified Chat/Journal/Transcript dock, stable claim bar,
  responsive lobby, clearer role/microphone state, canvas zoom controls.
- Session/social batch: leave, stop, kick, transfer admin; confirmations;
  raised-hand queue and reactions; local participant volume and speaking state.
- At that checkpoint: Go race tests/lint, build, 56 unit tests, 34 Chrome/Firefox
  E2E tests, two real voice tests, real English transcription E2E all passed.
- Relevant baseline overview: `docs/ARCHITECTURE_V2.md`, parity table §12.
  Its remaining-parity rows have **not yet been updated for the current draft**.

## Explicit TikTok decision — important

User proposed migrating to
`https://github.com/EulerStream/TikTok-Live-Api/tree/master/sdk/go`.
Verified SDK README: managed EulerStream backend, account/API key required.
Asked whether to authorize that external backend; user selected
**“Rester sans service tiers”**. Do not migrate or implicitly activate EulerStream.

Further inspection found existing `gotiktoklive@v0.0.4` already defaults to a
hosted signing endpoint (`https://tiktok.eulerstream.com`). User was informed.
Current v2 draft therefore blocks TikTok connections unless
`SPECTRUM_TIKTOK_SIGNER_URL` is explicitly configured on the server. This allows
an operator-provided/self-hosted compatible signer; **no signer is provided or
configured locally yet**. Do not claim operational TikTok parity without that.
Legacy v1 keeps its existing default behavior; the adapter can use the configured
override. Audio, STT, notes and room chat must remain self-hosted/ephemeral.

## Current draft: backend

### `backend/domain/spectrum/v2_live.go` (new)

- Operations: `live.get`, `live.connect`, `live.disconnect`, `live.select`.
- Admin-only connection/selection, membership revalidation.
- Reuses existing Twitch/YouTube/TikTok adapters; injectable `Hub.liveFactory`
  enables offline tests. No real external live was connected during development.
- Accepts `spectrum -N` … `spectrum N` and `spectrum i`, matching 3/5/7/9 slices.
- Latest vote per external account, max 1,000 tracked users, max 20 selected.
- External IDs stay server-side; wire IDs are random `l_…`; avatars are not loaded.
- Aggregate/selected pellets are added by `spectrumFor` with normal hide/spectator
  visibility rules. Selected external voters are NOT voice/stage members.
- Refresh fan-out coalesced at 250 ms. Callbacks fenced by session pointer;
  disconnect/stop/close/shutdown cancel context and pending timers.
- Live snapshots carry spectrum revision; only admins receive voter list/votes.
- Secrets never included in snapshots; errors sanitized.

### Other backend changes this batch

- `room.go`: room-local live state and cancellation on Close.
- `hub.go`: cancellation on stop/ownerless close/shutdown, injectable factory.
- `v2_room.go`: room.get also sends a role-filtered live snapshot.
- `v2_spectrum.go`: append live pellets only for authorized audiences.
- `domain/social/{twitch,youtube,tiktok}.go`: readiness callbacks, safer cancel
  handling; YouTube context-aware requests/nil guards; TikTok stream Close/nil
  guards/signing override; removed chat-content debug logs from these adapters.
- `v2_live_test.go`: offline tests for parsing/caps, public IDs, role/visibility,
  stale callbacks, cancellation and no implicit TikTok cloud.
- Go race tests and golangci-lint passed during this batch. Re-run after changes.

## Current draft: frontend

- `AppMenu.svelte`: language selection (normal Paraglide reload with draft warning),
  persistent lofi/light/dark theme, translated help dialog, presentation toggle.
- `ShareDialog.svelte`: canonical `/v2?room=…` link, clipboard, local QR generation.
- `LiveMenu.svelte`: platform/channel/credential form, connection state, voting
  instructions, bounded voter list/search and selection controls. TikTok disabled
  without server capability flag.
- `labels.ts`: translated role/relation labels.
- `room-client.ts`: live snapshots/events, revision fences and room filtering.
- `routes/v2/+page.svelte`: wires these components and a draft presentation mode.
- Existing People/NoteCard/PendingNotes/SpectrumBoard/VoiceMenu/RoomOptions/RoomLobby
  labels migrated to FR/EN catalogs. Voice transcription-consent dialog now follows
  locale. English role labels deliberately remain lowercase for existing tests.
- `frontend/package.json` + lockfile: added `qrcode`, dev `@types/qrcode`.
  QR is generated locally, no remote QR API. npm install reported 34 audit findings
  across the dependency tree; baseline attribution not investigated. No audit-fix
  or broad dependency upgrades authorized/performed.

## First tasks on resume

1. **Finish presentation-mode behavior before declaring it ready.**
   - `AppMenu` presentation button currently does not explicitly close its details
     popover. After Escape, it may still be open; next click can close it instead of
     opening it. Close the menu when activating presentation; test focus/exit.
   - Current presentation CSS hides admin controls but can still display admin-only
     hidden pellets, unrevealed/pending notes and their edges. For public/streamer
     projection, filter visuals to the spectator-visible policy, without changing
     actual server role/permissions.
   - Preserve mounted NoteCards/drafts when hiding private notes: do not simply
     unmount them on entry. Existing `editable={canEdit(note) && !presentation}` and
     `admin={admin && !presentation}` already prevent note editing/tools.
   - Konva edge layer must also exclude edges to hidden notes. See
     `CanvasWorkspace.refreshEdges()`; HTML notes are separate, noteLayer is hidden.
   - Consider adding a renderer-only visible-note-ID filter rather than rebuilding
     all notes every drag. No such filter has been implemented yet.
   - Consider masking all pellets during presentation when positions are hidden or
     spectator pellet visibility is off; admin data must not accidentally project.

2. Check remaining UI details/translations:
   - `LiveMenu` treats any nonempty platform as an active session so naturally ended
     connections can still be explicitly disconnected before retrying. Its status
     text should render `disconnected` distinctly rather than “connecting”.
   - Clear live credential field when switching platform; do not retain unnecessary
     YouTube/TikTok credentials if user switches to Twitch.
   - Some low-level error messages in `voice-connection.ts` / server failures remain
     English. Audit user-facing labels/errors before claiming full translation.
   - Recheck mobile toolbar geometry after adding live/app-menu buttons.
   - Aggregate currently disappears if every voter says `i`; consider indifferent
     aggregate at (490,450), retaining latest-vote semantics and documented behavior.

3. Validate this batch:
   - New tests at top of `frontend/e2e/v2.test.ts`: local QR/help/theme/language/
     presentation; live UI via intercepted protocol fixtures (not a real platform).
     **These new E2E tests have not been run yet.**
   - `frontend/e2e/transcription.test.ts` consent selectors updated from French to
     English for English test locale. Re-run actual transcription test.
   - Add client unit coverage for live revision/room filtering and stale admin
     snapshots after demotion/transfer. Backend privacy tests already exist.
   - Update journal live connect/disconnect events if required for v1 journal parity.
   - Review Twitch cancellation during initial/reconnecting dial. Existing SDK
     `Disconnect()` only succeeds after connection becomes active; readiness
     callback handles late cancellation but a pending SDK dial is not context-aware.
     Do not claim fully audited adapter lifetime without checking this.
   - Add env examples/documentation for self-hosted TikTok signer and its deployment
     limitation. `docker-compose.dev.yaml` does not yet forward the signer env var.
   - Update architecture parity table honestly: distinguish code/test-fixture parity
     from real-platform validation and the unconfigured TikTok signer.

## Local stack and commands

Dev services still running: frontend `http://localhost:5173`, backend
`http://localhost:3000`, LiveKit `127.0.0.1:7880`, STT worker.
**Backend was rebuilt and restarted on 2026-11-07** with the live/social,
transcript and reaction-guard batch; ephemeral rooms were wiped at that point.
Frontend Vite hot reloads source. Any later backend source change still requires
a rebuild and another restart, which wipes rooms again.

```sh
# Repository root
SPECTRUM_VOICE_ENABLED=true SPECTRUM_TRANSCRIPTION_ENABLED=true \
  docker compose -f docker-compose.dev.yaml --profile transcription up -d --build backend

# backend/
go test -race ./...
golangci-lint run

# frontend/
npm run check
npx vitest run --project server
npm run build
npm run test:e2e:v2
npm run test:e2e:webkit   # Playwright WebKit, not real Safari; install-deps may be needed
npm run test:e2e:voice
SPECTRUM_TEST_SPEECH=/tmp/opencode/spectrum-stt-speech.wav \
  SPECTRUM_TEST_LANGUAGE=en SPECTRUM_TEST_EXPECT='country|americans' \
  npm run test:e2e:transcription

# Repository root
git diff --check
```

Earlier validation logs/screenshots are under `/tmp/opencode/spectrum-*`.
Do not infer they validate the unfinished live/share/preferences draft.
