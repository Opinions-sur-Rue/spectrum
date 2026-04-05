# Changelog

All notable changes to **Spectrum** are documented in this file.

## [Unreleased]

### Added
- Admin can globally hide/show all participants on the canvas (#398, #405)
- Configurable central neutral circle (#399, #402)
- **Capacitor / Android APK** — native Android build with foreground audio service (#327, #386)
- **Admin auto-reassign** — admin role reassigned automatically when current admin disconnects or last admin leaves (#300, #374)
- **Stop Spectrum** — any admin can now stop and delete a running spectrum room; all participants are ejected (#410, #442)
- Confirmation dialog before kicking a participant (#411, #440)
- Confirmation dialog before making a participant admin — action is irreversible (#412, #441)
- Loading state on JoinSpectrumModal while awaiting server confirmation (#408, #443)
- Subtle drag hint after 4s of inactivity when pellet has not been moved; hidden after first drag and persisted in localStorage per spectrum (#414, #444, #446)

### Fixed
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
- CI: name APK artifact by branch/PR and keep main builds 90 days (#401)
- Start/Join button colors corrected: Start → `btn-success`, Join → `btn-neutral` for semantic clarity (#409, #439)
- Admin toolbar buttons now have DaisyUI tooltips visible at all breakpoints including tablet (#413, #438)
- Header made more compact (`text-2xl`, reduced padding/margin) — improves mobile layout (#447)
- Claim field placeholder updated to 'Entrez le claim du spectrum ici' for better discoverability (#447)
- vitest: renamed deprecated `test.workspace` to `test.projects`

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
