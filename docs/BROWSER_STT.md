# Browser-local transcription prototype

**Experimental, low-priority feature; shipment is not yet committed.** It must
not block the core debate, notes or audio experience.

Opt-in alternative to the server Whisper/Nemotron workers. Each participant
transcribes only their own published microphone on their device; Spectrum receives
text, not ASR audio. Voice still traverses the self-hosted LiveKit SFU. No cloud
ASR or hidden server fallback. Unsupported devices can still use voice.

## Setup and rollback

From `frontend/`:

```sh
npm ci
npm run setup:browser-stt
# Full menu: Tiny + Base on CPU/GPU and Small on GPU.
npm run setup:browser-stt -- --model=all
```

The default setup prepares Tiny for CPU and GPU. `--model=base` or `--model=small`
prepares only that model; `--model=all` is required if the interface must offer
every choice. Setup downloads public Xenova multilingual weights and copies the
installed ONNX WASM runtimes into `frontend/static/stt/` (gitignored):

- Tiny Q8: revision `5332fcc35e32a33b86612b9a57a89be7906102b1`.
- Base Q8: revision `64da57285918e20ea79ea5c88eed7197933abaa8`.
- Small FP16 only: revision `2d67713f236afa48a18992566e7647f6ca848e13`.
- GPU variants use FP16 files from the same revisions (not Q8). Small is
  intentionally GPU-only; no unquantized CPU download is offered.
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
without GPU; voice remains active. Small requires GPU.

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
   Choose local transcription, select Tiny (default), Base, or Small (GPU only),
   then accept its separate consent dialog. Selecting or cancelling alone
   downloads nothing.
3. Only then load the selected model, VAD and runtime from the same origin:
   approximately 75 MB Tiny/CPU, 110 MB Tiny/GPU, 110 MB Base/CPU, 180 MB
   Base/GPU, or 515 MB Small/GPU. Shared assets may be cached. Asking for GPU is
   explicit and checked by the user; Small checks it automatically.
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
  explicitly stops transcription, not voice. Model startup timeout: 120 seconds.
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

To repeat the identical-fixture comparison, use `SPECTRUM_TEST_COMPARE=true`,
`SPECTRUM_TEST_MODELS=tiny,base,small`, `SPECTRUM_TEST_BACKENDS=webgpu`, and
`SPECTRUM_TEST_WEBGPU=true` in the command below. Use `SPECTRUM_TEST_MODEL=small`
with `SPECTRUM_TEST_WEBGPU=true` to exercise Small through the actual
voice/consent/history UI. The comparison bypasses live chunk buffering and permits
up to 120 seconds per request; it is an offline quality check, not a live-capacity
pass. Public-fixture results attach to Playwright artifacts, not application logs.

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
