# Changelog

All notable changes to **Spectrum** are documented in this file.

## [Unreleased]

### Added
- Admin can globally hide/show all participants on the canvas (#398, #405)
- Configurable central neutral circle (#399, #402)

### Fixed
- Missing Android permissions for audio/microphone (#390)

### Changed
- CI: name APK artifact by branch/PR and keep main builds 90 days (#401)

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
- **Capacitor / Android APK** — native Android build with foreground audio service (#327, #386)
- **WebSocket reconnection** — graceful reconnect on foreground return with user feedback (#329, #353, #389)
- **Admin auto-reassign** — admin role reassigned automatically when current admin disconnects or last admin leaves (#300, #374)
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
