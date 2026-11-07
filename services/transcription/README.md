# Local transcription: Whisper and experimental Nemotron CPU

Base `docker-compose.dev.yaml` still uses **faster-whisper small, CPU int8**.
The optional override tests **Nemotron 3.5 ASR Streaming 0.6B, Q8**, through
NeMo-Speech.cpp v0.3.0. No model weights are edited or fine-tuned.

The first adapter reuses the existing bounded utterance/draft queue and Silero
speech gate. It sends each chunk as an in-memory WAV to a persistent local CPU
recognizer. **It does not yet use Nemotron's stateful cache-aware streaming**;
the existing 1.6/4.8-second provisional buffers still limit first-caption latency.
Do not interpret NVIDIA's 80/160 ms model chunk sizes as Spectrum's latency.

## Setup (explicit downloads, once)

From the repository root, with the existing voice/transcription stack running:

```sh
docker compose -f docker-compose.dev.yaml -f docker-compose.nemotron.yaml --profile transcription build stt nemotron
docker compose -f docker-compose.dev.yaml --profile transcription run --rm --no-deps stt python download_nemotron.py
```

Runtime archive and model SHA-256 are pinned. Public model weights are about
742 MB and use the [OpenMDW-1.1 license](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b).
The runtime archive is CPU-only Linux x86_64; this override is not an ARM build.
Model weights persist in the existing `stt-models` volume alongside Whisper.
Neither download command handles room audio.

## Switch on / roll back

Only restart the transcription worker and optional recognizer, not the backend:
no room wipe. An in-flight utterance can be lost when switching; mute first.

```sh
# Opt in: start the CPU recognizer, then replace the worker.
docker compose -f docker-compose.dev.yaml -f docker-compose.nemotron.yaml --profile transcription up -d --no-deps --wait nemotron
docker compose -f docker-compose.dev.yaml -f docker-compose.nemotron.yaml --profile transcription up -d --no-deps stt

# Roll back: base configuration removes STT_ENGINE=nemotron.
docker compose -f docker-compose.dev.yaml --profile transcription up -d --no-deps stt
docker compose -f docker-compose.dev.yaml -f docker-compose.nemotron.yaml --profile transcription stop nemotron
```

If Whisper weights were never downloaded, run the existing `download.py` setup
first. Never run a second active worker beside `stt` against the same backend.
Use `--no-deps` when switching so Compose does not recreate the backend with
different feature flags. Selecting an unknown engine fails rather than silently
switching providers.

The Nemotron service has no published port, no Internet route, a read-only
filesystem/model volume, no container log storage, and only a private network
shared with the worker. CPU is explicitly selected and checked at readiness.
No inference-time model downloads, disk audio uploads, cloud ASR, or automatic
fallback. The worker remains responsible for consent, speaker authorization,
bounded queues, discarded stale results and ephemeral transcripts.

## CPU measurements and tests

`benchmark.py` reads an explicitly supplied public/consented fixture, not room
audio. Use 16 kHz mono PCM16 WAV, 0–60 seconds. Models are warmed once; the report
includes three inference durations and their median. Recognition timing includes
VAD and, for Nemotron, local HTTP, but excludes server startup/model loading,
audio capture, utterance buffering and backend delivery. RTF below 1 means
faster than real time. Run engines sequentially to avoid CPU contention.

```sh
# Put a public fixture in the container without requiring Docker /tmp sharing.
docker cp /path/to/public-fixture.wav spectrum-stt-1:/models/benchmark.wav

docker compose -f docker-compose.dev.yaml -f docker-compose.nemotron.yaml --profile transcription run --rm --no-deps stt python benchmark.py /models/benchmark.wav --engine whisper --language fr
docker compose -f docker-compose.dev.yaml -f docker-compose.nemotron.yaml --profile transcription run --rm --no-deps stt python benchmark.py /models/benchmark.wav --engine nemotron --language fr

# Unit coverage: network responses mocked, no model download/inference.
docker compose -f docker-compose.dev.yaml --profile transcription run --rm --no-deps stt python -m unittest test_nemotron test_worker test_segmenter

# With the desired engine running: actual LiveKit + browser + CPU ASR.
# Run from frontend/; use --language fr fixtures with appropriate expected words.
SPECTRUM_TEST_SPEECH=/path/to/public-fixture.wav SPECTRUM_TEST_LANGUAGE=fr SPECTRUM_TEST_EXPECT='expected|words' npm run test:e2e:transcription
```

Use `--show-text` only when explicitly wanting fixture text printed. Optional
`--reference /path/to/verified.txt` reports normalized word error rate; a good
reference must be human-verified, not copied from another model's prediction.
WER normalizes case/punctuation, not spelling or accents. It is not a semantic
quality score. Synthetic or clean short clips cannot establish accuracy for
spontaneous French, accents, overlap, noise or long sessions.

### Initial observations — 2026-11-06

Ryzen AI 9 HX 370, four inference threads per engine, warmed, three runs,
prebuilt NeMo-Speech.cpp CPU runtime. Other development services remained up.

| Public fixture | Audio duration | Whisper small int8 median | Nemotron Q8 median |
| --- | --- | --- | --- |
| whisper.cpp JFK English sample | 11.00 s | 1.096 s | 0.799 s |
| sherpa-onnx French `test_wavs/0.wav`, resampled from 22050 Hz | 4.97 s | 1.074 s | 0.458 s |

French fixture source: `sherpa-onnx-streaming-zipformer-fr-kroko-2025-08-06.tar.bz2`
from [sherpa-onnx public ASR assets](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models).
English fixture: [whisper.cpp JFK sample](https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav).
Both engines produced matching word sequences on these two samples (punctuation
differs); no representative French WER evaluation or fine-tuning is claimed.
Actual Nemotron browser tests passed in FR and EN, including consent and history
sharing. First provisional captions were approximately 1.6 seconds after speech
started in these runs; this is an observation, not a latency guarantee.

### Improving French

Selecting `fr-FR` is already explicit for French rooms. Q8 is quantization for
CPU memory/compute, not French specialization. Reading weights does not reveal
which numbers to change to fix recognition. Fine-tuning needs licensed,
consented French audio plus verified transcripts, a held-out evaluation set,
training and regression tests (including English). CPU training is possible in
principle but expensive for this size. Vocabulary boosting or native streaming
can be evaluated separately before considering any weight training.

## Native CPU/iGPU load experiment

`load_test.py` uses only Python's standard library and `segmenter.py`. It starts
an isolated native NeMo-Speech.cpp HTTP server on a random **loopback-only** port,
checks the requested backend at readiness and terminates it afterward. It does
not change the running Spectrum worker, drivers, Docker or system settings.
No room audio is captured; use an explicitly selected public/consented fixture.
Reports contain aggregate metrics, never recognized text. Existing local model
weights are required; the load script itself performs no downloads.

First run `nemo-speech doctor` to verify Vulkan device 0 is the intended physical
GPU, not a software Vulkan implementation. Select `cpu` for the baseline and
`vulkan:0` for the iGPU. Use the same Vulkan-enabled runtime for both, running
sequentially to avoid resource contention. On Windows the runtime path ends in
`nemo-speech.exe`; this harness has so far been exercised only on Linux.

```sh
python3 services/transcription/load_test.py /path/to/public-fr-16khz.wav \
  --runtime /path/to/nemo-speech --model /path/to/nemotron.q8_0.gguf \
  --device cpu --batching disabled --streams 6,12,18 --seconds 20

python3 services/transcription/load_test.py /path/to/public-fr-16khz.wav \
  --runtime /path/to/nemo-speech --model /path/to/nemotron.q8_0.gguf \
  --device vulkan:0 --batching disabled --streams 6,12,18 --seconds 20

python3 -m unittest discover -s services/transcription -p test_load_test.py
```

The test repeats a short WAV as synchronized all-active speakers, with 800 ms
trailing silence per utterance. It uses actual Segmenter provisional offsets
and reproduces the current 24-slot worker admission policy (superseded drafts,
draft suppression under backlog, final drops at saturation). The default is one
in-flight request, matching today's serial worker. `--inflight 6` separately
probes engine concurrency; it does **not** modify production concurrency.

This is a short chunked inference/queue test, **not** 18 LiveKit clients or native
cache-aware streaming. It excludes WebRTC, real VAD inference, backend delivery,
independent recordings/languages and long-run thermal behavior. Synchronized
speakers create intentionally harsh bursts; identical fixtures are not a
representative accuracy dataset. Completion latency is measured **after each
chunk becomes available**, so final numbers exclude the 800 ms endpointing
wait and prior audio capture. Drain time measures pending work after arrivals
stop. Missing finals must not be hidden behind latency averages.

### Radeon 890M observations — 2026-11-06

Laptop: Ryzen AI 9 HX 370, Radeon 890M integrated/shared memory, Mesa RADV
26.1.6. Vulkan runtime v0.3.0 archive SHA-256:
`2a8b2ca4610b6ea5d659ba10794526f6e5a77fb1623d52c35272a9fd1f74abac`.
Same pinned Q8 weights and 4.97-second French fixture as above. Four CPU threads,
20 seconds of arrivals per scenario, one in-flight request, batching explicitly
disabled on **both** backends. Warmed, sequential tests, development stack idle
but still running. These are single short runs, not capacity guarantees.

| Active streams | CPU final delay p95 | CPU finals completed | 890M final delay p95 | 890M finals completed |
| --- | --- | --- | --- | --- |
| 6 | 3.48 s | 18/18 | 5.97 s | 18/18 |
| 12 | 7.46 s | 36/36 | 20.40 s | 36/36 |
| 18 | 11.70 s | 46/54 | 21.59 s | 37/54 |

At 18 speakers, the CPU dropped 8 final chunks and the iGPU 17. Most provisional
drafts were deliberately suppressed by the existing global backlog policy.
A separate 6-in-flight/6-speaker iGPU probe (12 seconds of arrivals) completed
12/12 finals but had 7.53 s p95 final delay and 6.27 s drain time: it did not
solve this burst workload. Do not generalize this result to discrete GPUs,
native streaming, or different implementations.

The v0.3.0 Vulkan server aborted during automatic-batching warmup on this machine
with `GGML_ASSERT(ne1 == ne11)` in `ggml-cpu.c`. Explicitly disabling batching
allowed the above tests to run without request errors. No driver changes,
permission/ptrace changes or model edits were made. This limits confidence in
this runtime's Vulkan path; no iGPU production switch is recommended yet.

A Radeon RX 6750 XT (12 GB dedicated VRAM) is a separate promising test target,
not benchmarked here. It would use Vulkan rather than NVIDIA CUDA. More VRAM
alone does not establish throughput; replay the same test before deployment.
