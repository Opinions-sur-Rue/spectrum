# Browser-local transcription prototype

Current code offers **Parakeet Redux and Whisper Base only**. Tiny and Small
have been retired from the picker, worker and setup commands at user request.
Older benchmark sections below retain their historical model names; they are
not a list of currently supported choices. Existing production asset releases
are retained for rollback, not deleted in place. Stale tabs should reload the
released frontend rather than assume retired choices remain available.

## Beta.25 (deployed and publicly validated)

Compatible hardware GPU is selected by default before download consent; CPU can
still be chosen manually. One visible CPU recovery is allowed after GPU engine
or device loss, never after integrity/download/consent failures. It retires the
old worker/capture lease and starts a fresh session only for a currently published
track. No microphone acquisition or model download precedes explicit consent.

Parakeet retains identical pinned weights and its 255 MB GPU/recovery budget.
Base discloses a combined 290 MB budget: FP16 initially, q8 fetched only if CPU
recovery is needed. Persistent notice reports the actual backend and warns that
speech during interruption can be lost; old audio is not replayed. Actual AMD
device-loss recovery and new GPU/CPU captions pass for both models locally.

The beta.24 query gate/no-retry policy below is historical. Beta.25 complete CI,
strict activity-gated paired deployment and public CPU/GPU/recovery smokes pass.
Public recovery was injected at the worker boundary, followed by real CPU
captions without recapturing voice. Actual hardware destruction was validated
locally; physical devices and representative accuracy remain open. See
`SUIVI_FEEDBACK_UI_UX.md` for publication status.

## Preparation without microphone (beta.24)

Deployed on 18 November 2026 after complete CI and strict zero-activity paired
rollout. Public Chromium CPU and hardware-GPU room smokes pass: microphone-free
preparation with the menu closed, shared captions, spectator history and safe
independent stop with voice preserved. These checks do not close the physical
device, sustained-performance or representative-accuracy acceptance work below.

New rooms enable the room-level transcription option by default. An explicit
`SPECTRUM_TRANSCRIPTION_ENABLED=false` still overrides it; the availability kill
switch remains independent. This never grants individual microphone or model
download consent.

After explicit confirmation, model preparation does not require joining audio
or opening a microphone. Closing Audio options, muting or replacing the local
track keeps the worker/model alive. Once prepared, status reads “waiting for
your microphone”; no transcript session or capture starts until an existing
published microphone track is present. Capture loss immediately retires the
session and detaches ASR without stopping the voice track. Resumption requests
a new session; old inference text and late admissions cannot cross that boundary.
Room, generation, role, availability and language changes still cancel preparation.

An explicit experimental Parakeet GPU option uses the same pinned w2a8 encoder
and int8 joint weights. Only the encoder is GPU-accelerated; mel, joint and VAD
remain CPU. The trial isolates mel's plain runtime from the encoder's asyncify
runtime, raising the consent estimate from ~225 MB CPU to ~255 MB GPU without
larger model weights. Confirmed hardware is required;
Whisper Base additionally requires FP16. No silent whole-session CPU retry.
Exact installed-runtime encoder probing on AMD RDNA-3 confirmed real Q2 GPU
dispatches and finite output, with small numerical differences from CPU. This
alone is not real-speech, sustained-realtime or phone acceptance.

Parakeet GPU stays behind `?stt-gpu=1` on the page URL, plus explicit checkbox
selection and download consent. Without this trial flag, Parakeet remains CPU.
The full worker now recognizes real EN/FR audio, rejects silence and reports GPU
device loss without retrying CPU. English matched CPU on the fixture; French did
not: `lois fiscales` became `loin fiscales`, with another near-homophone change.
Exact transcript parity is therefore not claimed. A 12-second non-VAD comparison
did match, illustrating why full-worker/VAD validation is a separate gate.
Verified GPU assets total 251,784,339 raw bytes, excluding application/module JS;
the consent dialog conservatively rounds to 255 MB. No external requests or
duplicate model downloads were observed. Physical devices, sustained accuracy
and end-to-end speed remain unaccepted; this is an explicitly gated experiment.

The actual Vite room suite passes 3/3 with forced cold dependency optimization:
real VAD rejection, explicit CPU/GPU fixture comparison and shared room captions
after microphone-free preparation with the menu closed. Pre-optimize both ORT
entrypoints to avoid Vite discovering them late and reloading the page mid-load.
Single-fixture inference measured 2,980 ms CPU / 631 ms GPU on the AMD test machine;
French wording still differs, and this is neither broad accuracy acceptance nor
an end-to-end/phone speed claim.

## Loading feedback and slow links

Microphone device, push-to-talk, level and local transcription share one
**Audio options** menu. Preparation reports decoded model/runtime bytes and a
percentage while downloading, then explicit cache/check and initialization
states. A compact status remains visible with the menu closed.

The controller now distinguishes a 90-second stalled download from a
180-second initialization stall, with a hard 30-minute overall startup bound.
Actual download progress extends the inactivity deadline: progressing large
models no longer fail solely because two minutes elapsed. Errors distinguish
transport interruption, missing/corrupt assets and engine initialization from
recognition capacity failure; all leave voice usable. Startup cancellation
still terminates the worker and prevents late capture/publication.

Public runtime, VAD and Parakeet files use same-origin SHA-256-keyed Cache API
entries, verified before use. Completed files can be reused across workers and
tabs; private-mode/quota failures degrade to uncached recognition, not audio
failure. No audio, captions, room ID or nickname enters that cache. Incomplete
downloads are not advertised as resumable. Browser stream byte counts are
decoded bytes, not compressed `Content-Length`.

### Targeted cache clearing (local UI/UX backlog batch, not yet deployed)

**Audio options → Clear model cache** requires confirmation and is disabled while
this tab prepares or uses a model. Model preparation stays disabled until deletion
settles. It deletes only `spectrum-stt-public-v1` and same-origin
`/stt/models/whisper-base/` entries in the Transformers library's
`transformers-cache`; other library-cache entries and other named caches remain.
Neither localStorage nor sessionStorage is touched: private notes, identity and
preferences are preserved. Private notes have their own per-room confirmed clear.

This is application-cache deletion, not deletion of browser-managed HTTP caches
or another tab's in-memory model. Close other Spectrum tabs using a model first;
they could repopulate the cache. Network/quota/security failures report an error,
not false success; already-absent entries count as successfully cleared.

Parakeet's default CPU path uses the stock **CPU-only** ORT WASM build (~14 MB raw)
rather than the larger JSEP build; its model/VAD/runtime budget is about 225 MB raw. This reduces
download size, but does not itself solve Firefox's observed slow inference.
The 20-second live inference/backlog safeguards remain separate from loading.

### Earlier loading/cache validation (beta.22)

- Merged-menu push-to-talk, tiny French viewport and targeted admin mute checks:
  6/6 Chromium/Firefox with real local SFU fixtures.
- Parakeet recognition, silence gate, automatic-language rejection and model
  reload pass in Chromium/Firefox/WebKit. Chromium and Firefox reuse all six
  public assets from cache. WebKit may resolve cache writes but discard them;
  readback now detects this and reports uncached operation rather than promising
  retention. Injected silent-discard/read-error/write-error regression passes.
- A real short-utterance Firefox room test requires and obtains shared captions,
  spectator history and independent stop with microphone preserved. Six-second
  Firefox worker inference remains ~31 seconds: this is not sustained realtime
  acceptance. Base also hit the capacity guard on the short-room fixture; no
  successful Firefox/Base realtime result is claimed.
- Base's clean six-second French comparison decoded but failed its expected-word
  accuracy assertion. That failure was not hidden or counted as quality success.
  Parakeet is therefore the FR/EN default; Base remains the explicit alternative
  and automatic-language choice.
- Cold public Parakeet/VAD files were downloaded and raw fingerprints verified
  in a dedicated test browser profile: 307 seconds total on the measured link,
  including 279 seconds for the encoder. This independently confirms that a
  progressing download can exceed the old 120-second startup limit. It is not
  itself a successful production speech-recognition result.

### Hosting measurements

No CDN/Hugging Face browser switch has been made. One 1 MiB range sample of the
same pinned encoder returned identical bytes from france and Hugging Face;
measured times were 7.6 and 7.8 seconds respectively on this client link. A small
range sample is not a full-file throughput benchmark. A future CDN should use
an assets-only hostname; proxying the entire voice hostname through an HTTP CDN
could break raw TURN/TLS. Preserve revision/raw-hash verification and separately
measure compression, CORS, privacy and cold/warm latency before switching.

**Experimental, low-priority feature; shipment is not yet committed.** It must
not block the core debate, notes or audio experience.

Opt-in alternative to the server Whisper/Nemotron workers. Each participant
transcribes only their own published microphone on their device; Spectrum receives
text, not ASR audio. Voice still traverses the self-hosted LiveKit SFU. No cloud
ASR or hidden server fallback. Unsupported devices can still use voice.

## Setup and rollback

### Parakeet Redux w2a8: read-only host assets (option A)

Parakeet is an additional explicit CPU option, not a change to room defaults.
The production overlay sets `SPECTRUM_TRANSCRIPTION_AVAILABLE=true` and
`SPECTRUM_TRANSCRIPTION_MODE=browser`, while keeping
`SPECTRUM_TRANSCRIPTION_ENABLED=false` for new rooms. The availability flag is
a separate deployment kill switch; when absent, legacy deployments retain the
old availability behavior based on `SPECTRUM_TRANSCRIPTION_ENABLED`.
Transcription remains admin-enabled and individually consented. Set the room
language to French or English; Redux has no automatic language detector. Parakeet
is the default for French/English, Base for automatic language detection. The
choice is shown before download consent, not silently substituted during use. WebGPU remains
a Whisper-only option: the pinned Redux export is documented as CPU-only.

Prepare a **new** directory on a trusted build machine with the release's locked
dependencies. Do not overwrite a directory mounted by a running frontend:

```sh
cd frontend
npm ci
# Prepare the default Base choice too; use a NEW release directory.
npm run setup:browser-stt -- --model=base --root=/tmp/opencode/stt-next
npm run setup:browser-stt -- --model=parakeet --root=/tmp/opencode/stt-next
node scripts/verify-parakeet-assets.mjs --root=/tmp/opencode/stt-next
```

Setup pins the model revision and four SHA-256 fingerprints, verifies VAD and
the exact ORT binaries, writes precompressed `.gz` siblings, attribution and
`SHA256SUMS.parakeet`. All browsers fetch the same-origin uncompressed URL;
nginx negotiates `gzip_static` transparently. Missing assets must return 404,
including runtime `.mjs` (the `/stt/` location has `^~` priority).
If nginx proxies to the frontend container, its `/stt/` upstream must use
`proxy_http_version 1.1`; HTTP/1.0 suppresses the container's default
`gzip_static` negotiation even when the browser advertises gzip. Verify the
public HTTPS response, not just a loopback request to the container.
The Parakeet verifier covers Parakeet and shared assets, not Whisper's config
files. Whisper setup separately checks its pinned ONNX files. Absent tiers must fail
explicitly, never silently substitute a model.

Copy the prepared directory to a **new** release directory under
`/opt/spectrum/stt/` on france. Copy the verification scripts from this same
reviewed revision too; do not trust a manifest supplied separately from code.
Run the verifier there, and `sha256sum -c SHA256SUMS.parakeet` from the asset
directory. Make files world-readable and directories traversable, but writable
only by the deploy operator/root. Only public model files belong here, no
secrets or microphone data.

Set `SPECTRUM_STT_ASSET_DIR` to that verified absolute release path in the
root-only deployment environment. Apply `docker-compose.stt-assets.yaml` after
the production compose file; it enables the browser engine without opting rooms
in and adds a read-only frontend bind mount at
`/usr/share/nginx/html/stt` and refuses an absent host directory. The overlay
must be included in **every subsequent deploy and rollback** command. Update
the reviewed deployment runner accordingly; an ad-hoc `docker compose up` with
the overlay omitted would remove the mount. This is a pending rollout gate,
not an operation already applied to beta.19.

Before recreating anything: green release CI, approved digest-pinned frontend
and backend, retained previous environment/compose/asset path, and observed
inactivity gate. Preserve LiveKit/PeerJS/TURN; retain v1 `/` and v2 `/v2`.
Mounting assets requires frontend recreation and must use that same gate.

After rollout, verify a known weight's content hash over HTTPS, content type,
gzip negotiation (`Content-Encoding: gzip`, `Vary: Accept-Encoding`) and a missing
`.onnx` **and** `.mjs` returning 404 rather than HTML/200. Test actual worker
recognition and microphone lifecycle, not HTTP status alone. Roll back to the
previous pinned pair **and its previous asset path/overlay** through the reviewed
runner if acceptance fails. Keep old asset directories until old tabs/rollback
no longer need them.

Parakeet weights: 208,330,200 bytes raw / 147,981,061 bytes gzip. Including VAD
and the pinned CPU-only runtime: 224,948,018 bytes raw / 153,629,140 bytes gzip
(plus application JavaScript). The consent budget is conservative
raw size, not a promise of gzip negotiation. CC-BY-4.0 attribution ships beside
the model and appears in the consent dialog.

Inference-only browser test (no backend/SFU; public fixture ≤12 seconds):

```sh
npm run setup:browser-stt -- --model=parakeet
SPECTRUM_TEST_SPEECH=/path/to/public.wav SPECTRUM_TEST_LANGUAGE=en \
  SPECTRUM_TEST_EXPECT=country npm run test:e2e:parakeet
```

2026-11-17 initial public JFK fixture: identical full text on Chromium, Firefox
and WebKit. Chromium/WebKit ~6 seconds for 11 seconds of audio; Firefox ~60
seconds, **not realtime-capable** in this environment. This test invokes the
worker directly; the production controller's 20-second capacity timeout would
stop Firefox transcription while leaving voice active. Silence rejection and
automatic-language rejection pass. This is not yet phone, sustained-room,
representative French WER or peak-memory acceptance.

Local room/SFU follow-up passes on Chromium: French captions published, history
visible to a new spectator, independent stop preserving the microphone, and no
late publication. Firefox's capacity-stop/voice-preservation path also passes;
it is explicitly not counted as a successful realtime captioning result. The
existing room smoke needed Audio options reopened before clicking Stop and a
hidden capacity-alert check after Discussion closed that popover.

### Existing Whisper tiers

From `frontend/`:

```sh
npm ci
npm run setup:browser-stt
# Full menu: Base CPU/GPU and Parakeet CPU.
npm run setup:browser-stt -- --model=all
```

The default setup prepares both supported choices. `--model=base` prepares only
Base CPU/GPU, `--model=parakeet` only Parakeet, and `--model=all` prepares both. Setup downloads public
Xenova/Olicorne multilingual weights and copies the
installed ONNX WASM runtimes into `frontend/static/stt/` (gitignored):

- Base Q8: revision `64da57285918e20ea79ea5c88eed7197933abaa8`.
- Base GPU uses FP16 files from the same revision (not Q8).
- Silero VAD v5.1.2, commit `6478567951ae5c9979ad7b234185b5515f4be7a1`.

All ONNX SHA-256 checksums are pinned in
`frontend/scripts/setup-browser-stt.mjs`; Transformers is pinned to 4.3.2 and
ONNX Runtime Web to the version already used by Transformers. The Silero MIT
license is copied alongside its weights. Run setup before building the production
frontend, and deploy those static assets. Do not rewrite missing `/stt/` files to
an HTML application fallback.

Transformers v4 loads each component using an explicit `/stt/models/whisper-*`
path, not a bare model name: bare names do not resolve through `localModelPath`
in this version. Existing split encoder/merged-decoder assets remain compatible;
no directory rename or new download is required for this fix.

From repository root, using the existing development stack:

```sh
docker compose -f docker-compose.dev.yaml stop stt
docker compose -f docker-compose.dev.yaml -f docker-compose.nemotron.yaml stop stt
docker compose -f docker-compose.dev.yaml -f docker-compose.browser-stt.yaml --profile voice up -d --build backend
```

The override enables voice and browser transcription. **Recreating the backend
deletes ephemeral rooms.** It does not automatically stop previously running STT
containers; stop those explicitly. No worker token is needed in the browser.
Use HTTPS in deployment (localhost is accepted for development).

### WebGPU availability

The GPU option appears only when the browser exposes a **hardware** WebGPU adapter
with `shader-f16`. A software fallback adapter and adapters without FP16 are
rejected, and the option stays hidden. There is no silent GPU-to-CPU fallback:
if the selected GPU fails, transcription stops and the UI asks the user to restart
without GPU; voice remains active. Parakeet is CPU-only.

On Linux Chromium, WebGPU may remain disabled in the normal profile even though
the GPU is usable. The tested command is:

```sh
google-chrome --enable-features=Vulkan
```

`--enable-unsafe-webgpu` alone produced only a software fallback without FP16 and
is not accepted. Firefox did not expose WebGPU in the tested automation and hides
the option. Windows/macOS behaviour depends on the browser and driver; it is not
claimed as validated.

Rollback: omit `docker-compose.browser-stt.yaml`, recreate the backend with the
desired voice/transcription flags and start the original `transcription` profile.
For Nemotron also include `docker-compose.nemotron.yaml`; see
[`services/transcription/README.md`](../services/transcription/README.md).
Existing workers and model volumes remain available; no GPU provisioning needed.

## User flow and privacy

1. Join audio, then enable microphone. This alone does **not** opt into ASR.
2. Open **Audio options**, where local transcription is labelled experimental.
   Choose local transcription, select Parakeet (FR/EN default, CPU only) or Base
   (alternative and automatic-language choice),
   then accept its separate consent dialog. Selecting or cancelling alone
   downloads nothing.
3. Only then load the selected model, VAD and runtime from the same origin:
   approximately 110 MB Base/CPU, 180 MB Base/GPU or 225 MB Parakeet/CPU.
   Shared public assets may be cached. GPU use for Base requires explicit opt-in.
4. Stop local transcription independently; microphone stays live. Muting, leaving,
    role revocation, room/generation/language changes or lost connection stop ASR.
   The audio-options summary indicates when experimental captions are active even
   when its popover is closed. Closing that popover alone does not stop ASR.

Public model files may remain in the browser cache. Audio and captions are not
persisted by this feature: audio buffers stay in client RAM, shared transcript
history in server RAM. Captions are visible to all room members, including
spectators. Model caching is distinct from room-data retention.

The transcript shows opted-in/stage-member coverage and a partial-transcript
warning. Browser captions are explicitly labelled **unverified submissions**, not
authenticated quotations. A modified client can submit invented words as itself;
server checks cannot prove that text came from a microphone or from Whisper.

## Processing and protocol

- Dedicated Web Worker. CPU mode is single-threaded WASM; GPU mode is optional
  hardware WebGPU with FP16, not a requirement for voice or default CPU ASR.
- Existing microphone track reused, no second `getUserMedia` call.
- AudioWorklet resamples supported 16–96 kHz input to 16 kHz mono.
- Energy-gated segmentation, up to 8 seconds, finalized after 800 ms silence.
  Candidate chunks then pass through real **Silero neural VAD before Whisper**.
  The gate uses 512-sample windows, 64-sample context and recurrent state reset
  for each candidate. Require at least 256 ms above speech probability 0.5 and
  10% speech in the candidate; otherwise skip decoding, with no text published.
  Decode the first-to-last detected speech with 200 ms padding. This is a second
  gate, not continuous neural-VAD segmentation or word-by-word streaming. Initial
  energy segmentation and forced eight-second cuts remain; very short/quiet
  utterances can be missed. Only final chunks are shared.
- One inference and one pending chunk; overload or 20-second inference timeout
  explicitly stops transcription, not voice. Loading uses the separate progress
  and inactivity budgets described above, not the live inference timeout.
- French default; English or Auto (FR/EN) selectable by admin. Auto predicts a
  language token before decoding; other detected languages produce no caption.
- `transcript.start` requires explicit consent, current stage membership and voice
  generation. `transcript.started` returns a connection-owned random session ID.
- `transcript.publish` accepts ordered text-only results. Server sets speaker,
  room, timestamp epoch and segment IDs, enforces content/time/rate limits and
  rejects stale, cross-member or cross-connection submissions.
- `transcript.keepalive` renews a 15-second lease (client interval 5 seconds);
  `transcript.stop` retires it. Late admission after cancellation is retired too.
- Browser mode denies server-worker admission. History uses the existing bounded
  `transcript.get`/`transcript.segment` path.

## Validation and limits — 2026-11-06

Before adding VAD/Base, real public-WAV inference in desktop Chromium passed French, English and French
auto-detection, including shared spectator history and stopping without muting.
Firefox passed the short French fixture; continuous English and auto-detection
hit the capacity safeguard, with microphone remaining live. Those capacity-stop
checks are **not** successful inference results, even though the safety tests pass.

VAD/Base follow-up: both desktop browsers rejected deterministic silence, a
440 Hz tone, white noise and brief clicks **before Whisper decoding**. This is
not a representative real-environment noise test. On the identical complete
4.97-second clean French public fixture, Tiny and Base returned the same words
(only initial capitalization differed), so that fixture cannot demonstrate an
accuracy gain. Measured single-run decode times including VAD were 1.55/2.68 s in
headless Chromium and 16.93/35.87 s in headless Firefox, Tiny/Base CPU. These
automated runs do not establish a general browser performance ranking; the user's
interactive Chrome/Firefox trial showed no noticeable difference.

WebGPU follow-up, same 4.97-second fixture, single run including VAD:

| Model | CPU WASM | WebGPU FP16 | Result |
|---|---:|---:|---|
| Tiny | 1.48 s | 1.38 s | correct clean text |
| Base | 2.65 s | 1.92 s | correct clean text |
| Small | not offered | 3.85 s | correct clean text |

Quantized Base failed on WebGPU with `multiple calls to initWasm()` because it
fell back internally after the VAD session had initialized WASM. FP16 weights
avoid that path. No silent fallback is implemented.

Clean speech does not reveal the user's reported accuracy problem. The same
French fixture was mixed with reproducible white noise and all three GPU models
were compared on identical audio:

- **10 dB SNR**: Tiny produced wrong words; Base heard “fille” instead of
  “pays”; Small was almost exact.
- **5 dB SNR**: Tiny hallucinated a long repetition of “sous”; Base remained
  wrong; Small stayed close to the expected sentence.

This is a synthetic robustness check, not a French WER benchmark or a claim about
real rooms. It is, however, evidence that **Small can materially outperform Tiny
and Base on degraded speech**, at the cost of a large download and GPU dependency.

Real UI/voice/microphone consent flow then passed in Chromium with **Small/WebGPU**
and shared captions/history (24.5 s test). The backend still labels these captions
unverified. A separate final CPU run passed **6/6** in Chromium and Firefox for the
French clean fixture, including live Firefox transcription (25.2 s test). Earlier
continuous English/auto Firefox runs hit the capacity safeguard, so Firefox remains
CPU-only with a real capacity risk, not a general performance guarantee.

After fixing v4 local-path resolution, fresh checks confirmed:

- Hardware WebGPU FP16: Tiny/Base/Small returned the full clean French fixture
  correctly in 1.33/1.83/3.71 seconds, including VAD (single run).
- French auto-detection: Tiny and Base returned correct clean text on both WebGPU
  and WASM. This checks model inference, not continuous live capacity.
- English: all three WebGPU models returned the complete public Kennedy excerpt
  correctly (2.08/1.93/3.74 seconds for Tiny/Base/Small, single run).
- Tiny and Small WebGPU passed the real consent/microphone/shared-history flow.
- WASM: Chromium passed live French transcription; Firefox stopped explicitly
  for capacity with voice still active. Both rejected the four non-speech fixtures.
- One initial Chromium UI rerun stopped during loading without an ASR alert;
  the subsequent isolated run passed. Its cause remains unconfirmed.
- Separate voice E2E passed in Chromium and Firefox; 19 targeted STT unit tests,
  Svelte checks, targeted ESLint and the production build also passed. Build still
  warns about large chunks.

To compare the current models, use `SPECTRUM_TEST_COMPARE=true`,
`SPECTRUM_TEST_MODELS=base,parakeet` and `SPECTRUM_TEST_BACKENDS=wasm` in the
command below. For hardware GPU, test Base only with
`SPECTRUM_TEST_MODELS=base`, `SPECTRUM_TEST_BACKENDS=webgpu` and
`SPECTRUM_TEST_WEBGPU=true`; `SPECTRUM_TEST_MODEL=base` exercises it through the
actual voice/consent/history UI. The comparison bypasses live chunk buffering and permits
up to 120 seconds per request; it is an offline quality check, not a live-capacity
pass. Public-fixture results attach to Playwright artifacts, not application logs.

For a short-utterance Firefox room check, use a public short WAV plus
`SPECTRUM_TEST_SPEECH_ONCE=true` and
`SPECTRUM_TEST_REQUIRE_TRANSCRIPTION=true`. That fixture starts speaking only
after ASR is ready, rather than finishing while the model is still loading.
The assertion requires actual shared captions, not a capacity-stop safety pass.
It does not establish continuous-speech realtime performance.

Mobile, Safari, low-memory devices, representative French accuracy/WER and sustained
multi-speaker use remain untested. WebGPU was validated only on the AMD Radeon 890M
under Linux Chromium with Vulkan; other GPUs, browsers and drivers are unverified.
Any Whisper model can omit, mistranscribe or hallucinate speech; neural VAD reduces
non-speech decoding but cannot eliminate false positives. Download size, CPU, GPU
memory, power, battery, warmup and chunk latency make this a prototype, not a broad
compatibility promise.

From `frontend/`, with browser-mode backend and local assets running:

```sh
SPECTRUM_TEST_SPEECH=/absolute/path/to/public-16khz.wav SPECTRUM_TEST_LANGUAGE=fr SPECTRUM_TEST_EXPECT='expected phrase' npm run test:e2e:browser-stt
```

Repeat with `en` or `auto` and suitable expected text. Tests block external HTTPS,
check no extra microphone request/model fetch before consent, and distinguish
Firefox capacity stops through `capacity-limit` annotations and console output.
Legacy app font/CSS requests exist independently; this is not a claim that the
whole application has no external assets.

## Deferred plan: French specialization — 2026-11-06

**Recorded only; do not start training, install dependencies or run GPU tests
until the user explicitly asks to resume.**

### Context and goal

- User reports Firefox transcription no longer feels usable or is very slow;
  Whisper Base on Chrome is reasonably good, but French accuracy needs improvement.
- Specializing a model and fixing Firefox throughput are separate tasks. Fine-tuning
  does not inherently speed up WASM inference. Keep voice usable independently.
- Available training hardware: Radeon RX 6750 XT, 12 GB VRAM. User has already
  used ROCm and PyTorch on this PC with ComfyUI. Reuse that known-working setup
  as a reference rather than assuming ROCm must be installed from scratch.
- Prior GPU inference is not proof that Whisper training works. This card is
  outside official ROCm support; record working versions/settings when resuming.
- Prefer local training and browser-local inference, with self-hosted weights;
  no rented GPU, cloud ASR or hidden server fallback.

### Proposed sequence when resumed

1. Build a representative held-out French evaluation set: spontaneous speech,
   accents, varied microphones, background noise, hesitations and non-speech.
   Separate speakers/recordings between training, validation and final test sets.
   Measure WER, hallucinations, omissions and live latency, not just clean fixtures.
2. Benchmark existing Base and Small/WebGPU on identical audio. French-specialized
   models are candidates, not guaranteed improvements. Large French Whisper and
   distilled variants remain heavy for browsers. Moonshine Tiny FR ONNX is a
   possible lightweight comparison, not an established quality upgrade over Base.
3. Start adaptation with multilingual **Whisper Base + LoRA**. Its current browser
   cost is acceptable to the user. Use accurately transcribed, appropriately
   licensed French data plus explicitly consented, representative recordings.
   Never silently retain participant microphone audio for training.
4. Before a full run, perform a short forward/backward training smoke test using
   the existing ROCm/PyTorch reference. Measure VRAM, step time and stability.
   Use a small batch, gradient accumulation and gradient checkpointing as needed.
   Twelve GB is a plausible budget for Base/LoRA, not a measured guarantee;
   consider Small/LoRA only after measuring capacity and quality.
5. Train with French transcription targets, validate regularly and stop on
   overfitting/regression. The existing inference setting `language: 'fr'` already
   forces French; it is not model specialization. Preserve English/Auto behaviour
   or make a French-only model choice explicit if those capabilities regress.
6. Merge LoRA adapters, export browser-compatible ONNX components, prepare Q8 CPU
   and FP16 WebGPU weights, then re-evaluate after export/quantization. Pin assets
   and checksums; preserve opt-in downloads, original models and rollback.
7. Adopt only if representative quality improves within download, memory and
   latency budgets. Address Firefox CPU capacity separately; do not disguise
   overload as successful transcription or silently switch to cloud/server ASR.

References:

- [Whisper fine-tuning guide](https://huggingface.co/blog/fine-tune-whisper)
- [Whisper Large V3 French](https://huggingface.co/bofenghuang/whisper-large-v3-french)
- [French distilled decoder-2 variant](https://huggingface.co/bofenghuang/whisper-large-v3-french-distil-dec2)
- [Moonshine Tiny FR ONNX](https://huggingface.co/onnx-community/moonshine-tiny-fr-ONNX)
