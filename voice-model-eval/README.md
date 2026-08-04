# Cantarella voice benchmark

This directory contains a controlled two-pass voice-model benchmark. Version 2
tests casual phone-text delivery and unrestricted user-authored voice styles.

- `benchmark.mjs` runs five identical scenarios across the approved model roster.
- `judge.mjs` scores every anonymous candidate with three independent judges.
- `.env.local` contains the temporary OpenRouter key and is ignored by Git.
- `results.json` is a resumable raw result file generated after each batch.
- `judgments.json` contains judge-level scores and the aggregate ranking.
- `generate-viewer.mjs` creates the self-contained finalist comparison interface.
- `serve.mjs` serves the interface locally on port 4173.
- The benchmark has a hard internal cost ceiling of USD 3.
- `archive/prose-pass-2026-07-28/` preserves the frozen first-pass benchmark.

The thought pass supplies structured meaning only. The voice pass accepts any
custom style description and returns one visual message bubble per non-empty
line, with no fixed bubble-count limit.

The active viewer narrows the complete 25-model result set to five unique
finalists from the automated and manual top threes. It shows actual model
identities plus the style input, thought JSON, conversation JSON, raw output,
provider usage, automated scores, and human review controls. The raw benchmark
and judgment files still contain all 25 models.

The runner never prints or copies the API key into its output.

Run:

```bash
node voice-model-eval/benchmark.mjs
node voice-model-eval/judge.mjs
node voice-model-eval/generate-viewer.mjs
node voice-model-eval/serve.mjs
```
