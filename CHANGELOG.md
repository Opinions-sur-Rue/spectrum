# Changelog

All notable changes to **Spectrum** are documented in this file.

## [Unreleased]

### Added
- Add an opt-in Parakeet Redux w2a8 CPU transcription choice, independently implemented greedy TDT decoding, same-origin revision-pinned weights, CC-BY-4.0 attribution, SHA-256 verification and gzip asset preparation. French or English must be configured explicitly; no automatic-language or GPU fallback is claimed for this export. Tiny remains the default pending phone validation.
- Add a read-only host-assets Compose overlay and offline verification command for separately provisioned transcription weights, VAD and pinned ORT runtimes. Production activation remains gated on release and room/voice acceptance.

### Fixed
- Serve browser transcription assets without lying: `/stt/...` now returns 404 for a missing weight instead of falling through to the SPA `index.html`. Previously every `/stt/` request — including a nonexistent model — answered with the app shell (`Content-Type: text/html`), so a browser model download would fail with an opaque inference error rather than a clear missing-file one.

## [v2.0.0-beta.19] - 2026-11-17

Deployed to the france host as a digest-pinned frontend/backend pair; LiveKit, v1 PeerJS and v1 TURN were left untouched.

### Added
- Add targeted admin microphone muting without demotion or disruption to other voice participants. Only the muted member can explicitly restore publishing; cached publishing tokens stay revoked. Muting is limited to participants, never co-admins.
- Add shared per-member speaking time for a Spectrum, accumulated by the server from self-reported turn boundaries and shown in the Participants panel. Turns stop on mute, stage change, or disconnect.
- Add a private Notes tab in Discussion, stored only in this browser per room and never sent to the server, so it stays unreadable by admins; pending text is flushed when switching rooms.
- Add Room / Stage / Admin chat channels with separate histories, a shared per-member send cooldown, and server-side audience filtering (spectators never receive stage or admin content, and neither reaches the v1 chat bridge). Admins can mask a message with `chat.remove`, which keeps its place while dropping the text for everyone.
- Add opt-in push-to-talk with a held pointer or Space outside text/interactive controls. Release, cancellation, backgrounding or lost authorization stops capture; reconnects require a new press in hold mode.
- Cancel pending microphone permission/publication and delayed device restarts when a hold is released. Keep the default continuous microphone mode unchanged.

### Changed
- Administration is now additive: "Transfer administration" becomes "Make {name} admin", which adds a co-admin without taking anything from the caller, plus a voluntary "Give up my admin rights" action that is refused for the last admin. `room.transfer` is gone, so frontend and backend ship together.
- Transcription is now opt-in per room: `transcriptionEnabled` defaults to false, so the Discussion Transcript tab stays hidden until an admin turns it on. `SPECTRUM_TRANSCRIPTION_ENABLED` still overrides the deployment default.

### Fixed
- Keep the board visible on very small screens: below 359 px the header's session menus no longer wrap into three rows but form one scrollable row, restoring ~50 px of canvas height (121 → 171 px measured at 320×568) and satisfying the > 80 px tiny-screen invariant that CI re-broke under different font metrics.
- Name repeated chat/voice JSON payload keys in the backend test suite so it passes the CI-pinned golangci-lint v2.15.0 (`goconst`) without relaxing the linter.

### Fixed in v2.0.0-beta.17
- Recover suspended mobile WebSockets without changing tab identity, the 60-second grace period, or server-authoritative stage roles; ignore late events from replaced connections.
- Keep replacement server connections registered when old sockets close late.
- Show truncated pseudonyms above v2 pellets and visible author attribution on notes.
- Restrict note content editing to its on-stage author while preserving separate admin layout and moderation controls. Changed approved content returns to pending review and hidden visibility until approved and revealed again.
- Create empty notes with visual title/body placeholders rather than saved example text; center the claim and preserve multiline editing and display.

### Fixed in v2.0.0-beta.16
- Keep mobile Participants and Discussion panels inside the visible viewport, including keyboard and safe-area changes, with internal scrolling and accessible close controls.
- Make pseudonym editing visible and keep its form above the participant list.
- Replace the floating onboarding card with collapsed, reusable help in document flow; improve touch targets and restore focus after closing mobile panels.
- Keep v2 page-scroll handling scoped so the v1 route retains its existing layout.

### Fixed in v2.0.0-beta.14
- Keep v2 audio alive across application WebSocket reconnects and restore an active microphone after involuntary voice rejoin when publication is still authorized.
- Update only the promoted/demoted participant's voice permissions; leave, expiration and kick no longer retire other participants' audio sessions.
- Reject cached/refreshed voice tokens after targeted revocation through the backend signaling gateway and signed membership epochs. Deploy public signaling routing through that gateway with this backend.
- Increase empty-room departure grace to 25 seconds and fence delayed transcription work independently from ordinary audio sessions.

### Added
- **v2 foundation** — stage role model (`admin`, `participant`, `spectator`), per-room settings, and a versioned `{v:2, op, payload}` protocol envelope dispatched alongside the legacy RPC format. v1 clients are unaffected.
- Room settings: participant slots, spectator limit, spectator chat, pellet/note visibility for spectators, transcription toggle. Defaults overridable with `SPECTRUM_PARTICIPANT_SLOTS`, `SPECTRUM_SPECTATOR_LIMIT`, `SPECTRUM_SPECTATOR_CHAT`, `SPECTRUM_TRANSCRIPTION_ENABLED`.
- Spectators are real room members: they receive room messages and are evicted by the same grace period as participants.
- `docs/ARCHITECTURE_V2.md` — canvas, roles, protocol, voice, transcription and AI facilitator design.

### Changed
- WebSocket read limit raised from 512 bytes to 64 KiB to carry v2 canvas payloads.
- `Room.AddUser` now assigns the pellet color on the user and enforces the participant slot limit.

## [1.1.0] - 2026-05-10

### Added
- **Welcome screen** — onboarding modal for first-time users with Start / Join CTAs and inline language selector (#406, #495)
- **Configurable spectrum size** — admins can choose 3 / 5 / 7 / 9 slices when creating a room, with matching SVG backgrounds in EN and FR (#461, #487)
- **Stop Spectrum** — any admin can now stop and delete a running spectrum room; all participants are ejected (#410, #442)
- **Admin auto-reassign** — admin role reassigned automatically when the current admin disconnects or the last admin leaves (#300, #374)
- Admin can globally hide/show all participants on the canvas (#398, #405)
- Configurable central neutral circle (#399, #402)
- **Capacitor / Android APK** — native Android build with foreground audio service (#327, #386)
- Nightly APK published to GitHub Releases on each push to `main` (#450)
- Confirmation dialog before kicking a participant (#411, #440)
- Confirmation dialog before making a participant admin — action is irreversible (#412, #441)
- Loading state on JoinSpectrumModal while awaiting server confirmation (#408, #443)
- Subtle drag hint after 4s of inactivity when pellet has not been moved; hidden after first drag and persisted in localStorage per spectrum (#414, #444, #446)

### Fixed
- Pellet collision detection (#494)
- Canvas now waits for `bind:clientWidth` to measure actual container width before drawing (#449)
- Header `resolve()` no longer rewrites external URLs (#481)
- Compact header and icon-only Start/Join buttons on mobile (#454)
- Drag-hint overlapping the footer — only the canvas is wrapped in the relative container (#446)
- Missing Android permissions for audio/microphone (#390)
- Hardcoded `'fr-FR'` locale in timestamp formatting replaced with `getLocale()` (#422, #431)
- Hardcoded French nack error message replaced with i18n key `error_nack` (#421, #430)
- Hardcoded French label 'Plate-forme' in ConnectLiveModal replaced with `m.platform()` (#425, #429)
- Inline validation errors on empty required fields in Join/Create modals (#407, #433)
- Theme preference now persisted in localStorage across page loads (#423, #434)
- `dialog.show()` replaced with `showModal()` in all modals for correct a11y focus trap and backdrop (#416, #436)
- `aria-label` moved from `<li>` to `<button>` for emoji buttons; hand-raise button now has dynamic `aria-label` (#418, #435)
- Participant color dots now have `role="img"` and `aria-label` with nickname for screen readers (#419, #437)
- Volume control dropdown changed from `dropdown-hover` to `dropdown-click` — works on touch/mobile (#424, #445)
- Issues #427 and #428 (participantsHidden sync and myposition self-send) were already fixed in #405

### Changed
- Start/Join button colors corrected: Start → `btn-success`, Join → `btn-neutral` for semantic clarity (#409, #439)
- Admin toolbar buttons now have DaisyUI tooltips visible at all breakpoints including tablet (#413, #438)
- Header made more compact (`text-2xl`, reduced padding/margin) — improves mobile layout (#447)
- Claim field placeholder updated for better discoverability (#447)
- vitest: renamed deprecated `test.workspace` to `test.projects`
- CI: name APK artifact by branch/PR and keep main builds 90 days (#401)
- CI: backend Go toolchain bumped to 1.24
- Repeated strings extracted to constants in `utils_test.go` (#480)

### Build / Dependencies
- ~130 Dependabot updates across frontend (Svelte 5.55.x, SvelteKit 2.59.x, Tailwind 4.1.x, Vite 7.3.x, fabric 7.3.x, Capacitor 8.3.x, paraglide-js, eslint, prettier, typescript-eslint, jsdom, vitest 3.2.x) and backend (`google.golang.org/api`, Go modules)

---

## [1.0.0] - 2025-07-18

First stable release of Spectrum.

### Added
- **Live streaming integration** — YouTube, TikTok, and Twitch chat listeners that add live viewers as participants (#71, #115, #145)
- **Audio communication** — PeerJS-based voice chat with voice detection, mute/unmute, and microphone gain control (#36, #57)
- **Raise hand** — animated raise/lower hand with persistent state visible to admin (#331, #383)
- **Chat** — in-app chat for participants (#99)
- **Localization** — English translation and language selector (#99)
- **Theme selector** — light/dark mode support (#130)
- **Streamer mode** — dedicated UI mode for live streaming setups
- **WebSocket reconnection** — graceful reconnect on foreground return with user feedback (#329, #353, #389)
- **Graceful server shutdown** — clean SIGTERM/SIGINT handling (#343)
- **Configurable logging** — LOG_LEVEL env var and VITE_DEBUG for frontend (#338, #341)

### Changed
- Migrated UI framework from W3.CSS to Tailwind CSS + DaisyUI (#29)
- Migrated frontend to SvelteKit with Svelte 5 runes mode
- Switched to adapter-static with SPA fallback (#385)
- Upgraded Fabric.js from v5 to v7 with pellet layout rework (#357, #366, #371, #372)
- Inverted spectrum axis — disagree on the left (#153)
- Removed TikTok-specific frontend (main platform supports all features)
- Removed ENABLE_AUDIO feature flag — audio always enabled (#378)

### Refactored
- Extracted canvas manager for pellet lifecycle (#301 step 4, #377)
- Extracted RPC dispatch from parseCommand (#301 step 3, #376)
- Extracted room state into `$lib/spectrum/room` store (#375)
- Extracted voice/PeerJS logic into `$lib/voice` module (#373)
- Added Participant interface and typed `others` map, removed @ts-nocheck (#368)
- Removed dead code — oldPellet() and commented-out blocks (#364)

### Fixed
- Footer buttons misaligned on Chrome (#380)
- Position cleared when SetAdmin promotes a participant (#379)
- Pellet layout corrections for Fabric 7 coordinate system (#366, #371, #372)
- FontAwesome dependency alignment and svelte-check errors (#367, #382)
- Concurrent map access data race in Hub (RWMutex) (#337)
- Race condition on Hub initialization (sync.Once) (#336)
- Replaced panic()/log.Fatal() with proper error returns (#335)
- Admin creating pellet incorrectly (#88)
- Negative coordinate handling
- Mobile responsiveness improvements

---

## [0.1.0] - 2025-02-01

### Added
- Initial commit — Go backend with WebSocket hub, SvelteKit frontend with Fabric.js canvas
- Real-time participant positioning on an opinion spectrum
- Admin room management
- Docker image CI pipeline
