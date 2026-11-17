# Browser-local transcription research

> **Status update 2026-11-17:** the open questions in this file (model size
> against the download budget, and whether a self-compiled runtime is required)
> are answered with measurements for `parakeet-tdt-0.6b-v3-redux` w2a8 in
> [`BROWSER_ASR_PARAKEET.md`](BROWSER_ASR_PARAKEET.md): ≈ 208 MB raw /
> ≈ 148 MB transferred, and Spectrum's stock `onnxruntime-web` WASM build already
> executes the MatMulNBits encoder. This file stays as the research record; no
> production integration is approved yet.

## User intent and scope

- Run transcription on each participant's own PC or mobile browser, without an
  external transcription API. Prefer processing each participant's microphone
  locally and sharing only resulting text through Spectrum.
- Download budget: at most 350 MB for the model (initially 200 MB).
- Research only: no model download, training, transcription activation or
  production integration approved as part of this discussion.
- Current implementation priority remains production mobile rollout, mobile
  reliability, then readability and notes. This research is a later track.

## Candidate

https://huggingface.co/Archime/parakeet-tdt-0.6b-v3-fr-tv-media/

Model card consulted November 16, 2026: French media fine-tune of NVIDIA
Parakeet-TDT-0.6b-v3, approximately 627M parameters, about 2.5 GB in its NeMo
checkpoint. Card reports improved French media results, but these are author
reported and do not establish quality on mobile microphones or Spectrum debates.
Overlapping voices, noise and non-French speech remain concerns. Review model,
base-model and runtime licenses before distribution.

Approximate weight-only sizes, excluding metadata and mixed-precision layers:

| Precision | Decimal size |
| --- | --- |
| FP32 | 2.5 GB |
| FP16 | 1.25 GB |
| INT8 | 627 MB |
| 4-bit | 314 MB |
| 2-bit | 157 MB |

200 MB requires less than about 2.6 bits per parameter on average; significant
quality and runtime-support risk. 350 MB makes 4-bit weights theoretically
plausible but leaves little overhead. Actual exported size must be measured.
ZIP compression reduces transfer size, not necessarily working memory.
Quantization requires supported execution kernels; distillation instead trains
a smaller model and is a separate, substantially larger project.

## Browser execution approach

- A `.nemo` file is not directly browser-executable. Convert outside browser,
  export encoder/decoder/joint and evaluate quantization compatibility.
- Prefer an existing runtime such as ONNX Runtime Web if required operations,
  graph export and quantized execution are supported. Compatibility of this
  exact model and its 4-bit form has NOT been established.
- WebGPU is the preferred acceleration candidate; WASM/SIMD, optionally threads,
  is a CPU fallback to benchmark, not a promise of mobile real-time performance.
  Browser/device support and cross-origin-isolation requirements need checking.
- Implement orchestration, audio preprocessing and the TDT decoding loop as
  needed; write missing WASM kernels or WebGPU shaders only if justified.
- AudioWorklet for microphone handling; resample to model's required rate;
  perform inference in a Web Worker and cache versioned assets with user control.
- File size is not peak RAM. Activations, runtime buffers and possible weight
  expansion can dominate; measure latency, memory, battery and thermal behavior.
- Segment-based transcription is not equivalent to native streaming. Verify
  context boundaries, partial-result stability, accuracy and latency explicitly.

## Proposed feasibility gate (not yet implemented)

1. Export and run a prerecorded French audio sample in a standalone browser test.
2. Measure actual artifact size, peak memory, speed and French error rate against
   an unquantized baseline and a smaller multilingual model (e.g. Whisper base
   quantized). Do not assume equal quality or universal backend availability.
3. Test representative PC, Android/Chrome and iPhone/Safari hardware, including
   unsupported WebGPU, memory pressure and browser suspension.
4. Only if acceptable, add microphone capture, silence detection, cancellation,
   privacy controls, download consent and cache eviction handling.
5. Integrate into Spectrum later with explicit activation; do not replace current
   production transcription behavior during mobile reliability work.
