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
| Vocabulary | `vocab.txt` 93 939 B, 8 198 logits |
| **Total per participant** | **≈ 208 Mo raw / ≈ 148 Mo over the wire (zstd)** |
| French quality (your harness, 10 clips) | WER 3,52 %, 4,1× realtime, `ort=wasm` |
| License | `cc-by-4.0` (also the base model `moondream/parakeet-redux`) — commercial use allowed, attribution required |
| Languages | 33 including `fr` and `en` |

The size is inside the ≤ 350 MB budget that earlier research could only reach
with a 4-bit Parakeet build, and the French accuracy is far above Whisper
`tiny`/`base`, which is what Spectrum's browser path uses today.

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
  was single-threaded (the probe lacked cross-origin isolation), so real
  multi-threaded numbers will be better, not worse.
- **WebGPU stays unverified here**: the probe environment reported
  `No available adapters`, so the GPU path must be measured on a machine with a
  real adapter before we quote GPU numbers. Parakeet Web's upstream notes say the
  GPU EP runs MatMulNBits natively, which matches the op being standard.

## Graph contract for the Spectrum implementation

Read from the sessions themselves rather than hardcoded — the decoder declares
its own extra outputs, and that declaration is what distinguishes the optimized
build from a stock one:

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
- `vocab.txt` is 8 198 lines; blank/duration/until-token indices come from the
  TDT config (`config.json`: `nemo-conformer-tdt`, 128 features, subsampling 8).

## Integration plan for Spectrum

Spectrum is GPLv3 and the reference Parakeet Web implementation is AGPLv3, so the
decoder loop is written fresh against the contract above rather than ported. The
weights and runtime stay same-origin, matching the current
`env.allowRemoteModels = false` stance:

1. **Assets** — extend `scripts/setup-browser-stt.mjs` to fetch the four files
   into `public/stt/parakeet/…` with pinned sha256 checksums, plus zstd
   precompression and `Content-Encoding` serving, so a participant downloads
   ≈ 148 Mo once and the browser cache holds it afterwards.
2. **Worker path** — a second inference path in `browser-stt-worker.ts`: instead
   of `WhisperForConditionalGeneration`, three plain `ort.InferenceSession`s and
   a greedy TDT step loop (argmax over `outputs`, `duration_logits` for
   skips/timestamps, states carried between steps), reusing the existing
   segmenter/VAD so chunking, partial replacement and turn boundaries stay as
   they are.
3. **Model picker** — offer Parakeet as the recommended French/English tier with
   its real download size shown before consent, keep Whisper `tiny`/`base` as the
   smaller/no-WebGPU fallback, and refuse to start a tier whose weights are not
   present on the server rather than falling back silently.
4. **Timing budget** — TDT emits per-frame durations, so word timing becomes
   available for the transcript panel without a second model.
5. **Attribution** — CC-BY-4.0 requires credit for the model; add it to
   `frontend/public/stt/` alongside the existing third-party notices and name the
   upstream repo in the About/help text.
6. **Verification before any rollout** — WER and real-time factor measured in the
   browser (not Node) on the existing French clips, on both WASM and WebGPU, plus
   memory high-water per tab; Parakeet only becomes the default once it also
   holds up on a phone.

## Still open

- Real-device memory/CPU headroom: 190 Mo of weights plus activations per
  participant tab, and what that means on mid-range Android.
- WebGPU measurements (no adapter available in this environment).
- Whether to keep any Whisper tier at all once Parakeet works on both backends.
- Bandwidth: 148 Mo per first-time participant on our own host needs a decision
  on serving (see the deployment note about self-hosted weights).
