# Browser ASR: Parakeet TDT 0.6B v3 redux (w2a8) in Spectrum

Measured on 2026-11-17 against `Olicorne/parakeet-tdt-0.6b-v3-redux-onnx`
(commit `de66c10f18f6d94cb3e910e48034e45ce51109bc`), local copies under
`~/1_Projects/parakeet/models/redux-onnx`. This replaces the earlier
"350 MB budget, unproven" note in `TRANSCRIPTION_BROWSER_RESEARCH.md` for the
same model family.

## Why this model

| Fact | Measured |
| --- | --- |
| Encoder weights | `w2a8/encoder-model.w2a8.onnx` 189 893 007 B (190 Mo) |
| Encoder, zstd | 134 781 584 B |
| Decoder/joiner | `int8/decoder_joint-model.int8.onnx` 18 203 490 B (zstd 12 731 860 B) |
| Mel front-end | `nemo128.onnx` 139 764 B |
| Vocabulary | `vocab.txt` 93 939 B, 8 193 tokens including blank |
| **Model files** | **208 330 200 B raw / 147 981 061 B gzip**, measured with setup script; runtime and VAD are additional |
| Model + CPU-only runtime + VAD (current code) | 224 948 018 B raw / 153 629 140 B gzip (excluding application JS) |
| French quality (your harness, 10 clips) | WER 3,52 %, 4,1× realtime, `ort=wasm` |
| License | `cc-by-4.0` (also the base model `moondream/parakeet-redux`) — commercial use allowed, attribution required |
| Languages | 33 including `fr` and `en` |

The size is inside the ≤ 350 MB budget. The local French sample is encouraging,
but is not a representative quality benchmark or a paired Whisper comparison.

## Runtime feasibility (the open question, now answered)

Probed in a real browser page with Spectrum's own pinned
`onnxruntime-web@1.31.0-dev.20260914-8d85527a0`, **stock build, no custom
compilation**, 11 s clip (`samples/jfk.wav` resampled to 16 kHz mono):

| Step | Result |
| --- | --- |
| `nemo128.onnx` session | inputs `waveforms`, `waveforms_lens`; outputs `features`, `features_lens` |
| Mel run | features `[1, 128, 1101]`, lengths `[1101]`, sane range (−4,76 … 5,73) |
| **w2a8 encoder run (WASM)** | **executes**: output `[1, 1024, 138]`, all sampled values finite and non-zero, 5,4 s for 11 s of audio single-threaded |
| Decoder/joiner run (WASM) | executes: logits `[1, 138, 1, 8198]` plus `duration_logits`, `topk_logits`/`topk_ids`, `lse_token`/`lse_duration`, `prednet_lengths`, `output_states_1/2` |

Two consequences worth stating plainly:

- **The self-compiled MatMulNBits WASM runtime is not needed.** The stock WASM
  build in Spectrum already registers *and executes* the `MatMulNBits` encoder.
  That removes an entire build-and-verify pipeline from the plan. The measurement
  was single-threaded; the implementation deliberately stays single-threaded
  without changing cross-origin isolation for the rest of Spectrum.
- **Beta.22 runs this export on WASM.** A later exact-export probe with the
  installed ORT asyncify/WebGPU runtime demonstrated real hardware Q2 dispatches
  on AMD RDNA-3. Generic operator support alone was not sufficient evidence;
  neither are model-card CUDA limitations proof of WebGPU incompatibility.
  The unreleased explicit GPU path keeps the same weights and accelerates only
  the encoder; CPU remains the default. See `BROWSER_STT.md` for follow-up scope.

## Graph contract for the Spectrum implementation

The implementation targets the pinned graph contract, not arbitrary TDT models:

- Mel front-end: `waveforms [1, samples] float32` + `waveforms_lens [1] int64`
  → `features [1, 128, T] float32` + `features_lens [1] int64`.
- Encoder: `audio_signal [1, 128, T] float32` + a `*length*` int64 →
  `outputs [1, 1024, T']` + `encoded_lengths`.
- Decoder/joiner per greedy step: `encoder_outputs`, `targets` **int32**
  `[1, 1]`, `target_length` **int32** `[1]`, `input_states_1` and
  `input_states_2` as `float32 [2, 1, 640]` (the shape was read out of the
  runtime's own dimension error, not guessed) → `outputs`, `prednet_lengths`,
  `output_states_1/2`, `lse_token`, `lse_duration`, `topk_logits`, `topk_ids`,
  `duration_logits`.
- Dtypes matter: passing int64 for `targets`/`target_length` is rejected, so the
  decode loop must build int32 tensors.
- `vocab.txt` has 8 193 entries, blank ID 8192. The joint's 8 198 logits are
  8 193 token scores followed by five duration scores (0–4 encoder frames).
  The minimal `config.json` does **not** encode these IDs or durations.
- Each greedy step receives exactly one gathered encoder frame `[1,1024,1]`.
  Nonblank updates prediction state and previous token; blank preserves both.
  Zero-duration nonblank symbols may share a frame; zero-duration blank must
  advance. Pathological zero-duration loops fail explicitly.

## Production blocker found while measuring

The beta.19 image does **not** serve browser transcription assets:

- `frontend/.dockerignore` and `.gitignore` both exclude `static/stt/`, which is
  where `npm run setup:browser-stt` puts the Whisper weights, the Silero VAD and
  the ORT runtime files. The deployed frontend image is 93.6 MB and contains no
  `stt` directory (`docker inspect` shows no mounts either), so nothing to serve.
- `frontend/nginx.conf` only has the SPA fallback
  `location / { try_files $uri $uri/ /index.html; }`. `.onnx` is not in the
  cached-asset regex, so **every `/stt/...` request falls through to
  `index.html`**. Verified against production:
  `GET https://spectrum.utile.space/stt/vad/silero_vad.onnx` → `Content-Type:
  text/html`, 1831 bytes — the shell, not a model.
- Consequence: with the feature switched on in a browser today, ORT/Transformers
  would receive HTML where a model is expected and fail with an opaque error.
  `docs/BROWSER_STT.md` already warns "Do not rewrite missing `/stt/` files to
  index.html", which is precisely what the shipped config does.

User approved option A: a separately provisioned read-only asset mount. The
image remains small. The next image uses an explicit high-priority location
(including runtime `.mjs`, which must not fall into the generic asset regex):

```
location ^~ /stt/ { try_files $uri =404; gzip_static on; }
```

so a missing asset fails loudly instead of masquerading as the app. Compression has to follow what the deployed nginx can actually do, and that was
measured here: the frontend image's `nginx -V` lists
`--with-http_gzip_static_module` and `--with-http_slice_module`, **no zstd and no
brotli**. So the weight pipeline should ship `.onnx.gz` siblings and rely on
`gzip_static on` (already added to the `/stt/` block), not on the `.zst` files the
Hugging Face repo publishes. Gzip has now been measured: 147 981 061 bytes for
the four model files. Consent uses a conservative raw budget including runtime
and VAD, rather than promising a particular browser's negotiated compression.

## Implementation and rollout

Spectrum is GPLv3 and the reference Parakeet Web implementation is AGPLv3, so the
decoder loop is written fresh against the contract above rather than ported. The
weights and runtime stay same-origin, matching the current
`env.allowRemoteModels = false` stance:

1. **Assets** — extend `scripts/setup-browser-stt.mjs` to fetch the four files
   into the served `stt` root with pinned sha256 checksums, plus `.gz` siblings
   for `gzip_static` (the deployed nginx has no zstd/brotli module), so a
   participant downloads the weights once and the browser cache holds them
   afterwards. Measured sizes, not the repo's zstd numbers, go into the consent
   text.
2. **Worker path** — a second inference path in `browser-stt-worker.ts`: instead
   of `WhisperForConditionalGeneration`, three plain `ort.InferenceSession`s and
   a greedy TDT step loop (argmax over `outputs`, `duration_logits` for
   skips/timestamps, states carried between steps), reusing the existing
   segmenter/VAD so chunking, partial replacement and turn boundaries stay as
   they are.
3. **Model picker** — explicit Parakeet CPU option, with raw download budget;
   Parakeet is the visible FR/EN default, Base the automatic-language choice;
   Tiny and Small are retired. Beta.22 has no Parakeet GPU or automatic language
   detection for Redux. Rooms must pin French or English; this is a configured
   language label, not proof of language detection. Missing weights fail without
   silent fallback. Existing microphone consent and stop rules remain intact.
4. **Timing** — TDT durations drive frame advancement only. The existing
   segment boundaries remain; word timestamps are not implemented.
5. **Attribution** — CC-BY-4.0 requires credit for the model; add it to
   versioned asset directory alongside the weights and name upstream in the
   model consent dialog.
6. **Verification before any rollout** — WER and real-time factor measured in the
   browser (not Node) on the existing French clips using WASM, plus
   memory high-water per tab. Default selection does not establish phone
   acceptance; the model remains explicitly consented and experimental.

## Still open

- Real-device memory/CPU headroom: 190 Mo of weights plus activations per
  participant tab, and what that means on mid-range Android.
- Representative French accuracy, room/voice integration and sustained memory
  measurements for this independent decoder.
- Production acceptance beyond HTTP readiness: beta.20 now serves the option
  from the verified read-only host mount; see `RESUME_V2_PARITY.md` for rollout
  and post-deployment smoke results, and `BROWSER_STT.md` for mount procedure.

## Independent implementation validation — 2026-11-17

- Public JFK (11 seconds), real Spectrum worker: identical full English text on
  Chromium (5.9 s), WebKit (6.1 s) and Firefox (60.2 s). All three reject silence,
  reject automatic language, and complete without external requests.
- Public Google FLEURS `fr_fr/validation` row 1 (6 seconds): Chromium 3.4 s,
  WebKit 3.9 s, Firefox 31.7 s. Same French output on all three, with an actual
  recognition error (`ni ascète` for `ni à celles`). These smoke assertions
  establish execution, not a representative WER or perfect French recognition.
- Firefox worker correctness is **not** realtime acceptance: the production
  controller stops inference after 20 seconds and keeps voice active.
- Real local room/SFU integration passes: Chromium publishes French text,
  spectator sees retained history, stopping ASR leaves microphone live and no
  late transcript is published. Firefox hits the explicit capacity stop with
  microphone still live (safety pass, not successful transcription).
- Lint, production build, TypeScript (zero diagnostics) and 226 frontend unit
  tests pass. One full-unit attempt hit the existing root-page test's asynchronous
  Node/jsdom WebSocket Event-realm exception; a full rerun passed without ignored
  errors or changes to that test.
- Model/VAD/runtime SHA-256 verifier passes and rejects a corrupt asset.
- Actual nginx container: absent ONNX and MJS return 404, MJS has JavaScript
  MIME, WASM has `application/wasm`, gzip has `Vary: Accept-Encoding`, and
  decompressed encoder hash matches its pin. The explicit MIME map matters:
  nginx 1.27's default MJS response was `application/octet-stream`.
- Those initial local checks changed no production state. Beta.20 was deployed
  subsequently; new rooms still start with transcription off and individuals
  still explicitly consent before model loading or publication.
