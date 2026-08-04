# Cantarella Thought-model decision benchmark

> **Superseded:** This benchmark mainly measured structured-output reliability and direct operational judgment. It did not adequately measure adversarial psychological judgment. Do not use its Gemma recommendation as the final Thought-model decision; see `psych-report.md`.

Run date: 2026-08-03

## Outcome

**Production pick: Gemma 4 31B.** It was the best overall balance of judgment, grounding, price, and exact contract reliability. It returned 24 valid responses from 24 calls and avoided every catastrophic safety/ambiguity failure in the suite.

**Raw-judgment alternative: Qwen 3.7 Plus.** It produced richer decisions than Gemma in several cases and also returned 24/24 valid responses, but averaged about 33 seconds per Thought call. It also repeatedly invented causal framing in the harmful-person scenario and added unwanted coaching to the casual-chat scenario.

There is no flawless model in this roster. Gemma's recurring weakness is under-answering: both runs omitted the final deploy step from the dependency plan. That failure needs a regression case before changing the backend model.

## Test design

- Nine model families; no DeepSeek models.
- Twelve adversarial scenarios per model.
- The top four repeated all twelve scenarios.
- 156 total generation calls.
- No repair calls or hidden retries.
- Exact production `replyPoints`/`question` contract.
- Judgment correctness was primary; latency and price were reported separately.
- Total OpenRouter spend: **$0.1249** against a **$0.30** ceiling.

## Operational results

| Model | Calls | Valid contract | Average latency | Cost | Disposition |
|---|---:|---:|---:|---:|---|
| Gemma 4 31B | 24 | 24/24 | 8.93s | $0.003474 | Production pick |
| Qwen 3.7 Plus | 24 | 24/24 | 32.97s | $0.063469 | Best richer alternative; too slow |
| MiniMax M3 | 24 | 16/24 | 2.61s | $0.008474 | Good judgment, unreliable contract |
| Mistral Small 4 | 24 | 24/24 | 1.42s | $0.001478 | Fast, but failed genuine ambiguity twice |
| GPT-OSS 120B | 12 | 12/12 | 1.52s | $0.002833 | Clean JSON, several bad decisions |
| GLM 5.2 | 12 | 6/12 | 3.48s | $0.031718 | Truncation/language leakage and wrong step order |
| GPT-5.6 Luna | 12 | 3/12 | 3.78s | $0.004342 | Semantically promising, contract incompatible |
| Llama 4 Maverick | 12 | 12/12 | 0.84s | $0.002472 | Fast but shallow and unsafe on schedule logic |
| Inkling | 12 | 0/12 | 1.24s | $0.006635 | Invalid JSON on every call |

## Failure evidence that changed the ranking

### Gemma 4 31B

- Correctly updated priorities after a user correction in both runs.
- Correctly rejected the CORS misdiagnosis in both runs.
- Respected the remembered no-advice boundary in both runs.
- Asked what the user meant by “quit” rather than assuming a job or relationship.
- Correctly stopped work when the user was exhausted.
- Repeated weakness: backup → migration → smoke test, but omitted the final deploy action twice.
- Often supplied a safe minimum rather than the richest useful judgment.

### Qwen 3.7 Plus

- Strong on correction handling, stopping, ambiguity, remembered boundaries, and priority tradeoffs.
- Repeated dependency-planning error: treated the ten remaining minutes as a complete buffer without accounting for unknown deploy duration; one run omitted deploy entirely.
- Repeatedly described harmful attachment as a “trauma response” or cycle mechanism without evidence in context.
- Added prevention advice to a casual debugging joke in both runs despite the explicit no-coaching test.
- The roughly 33-second Thought latency would make every chat reply visibly slow before Aion even starts.

### MiniMax M3

- Often made the clearest technical and priority decisions.
- Violated reply-point length limits in eight of 24 calls.
- First ambiguity run assumed job-like facts before asking what the user meant; the repeat corrected this.
- Twice suggested visiting the pharmacy after the appointment even though the pharmacy would already be closed.

### Mistral Small 4

- Very fast and perfectly contract-valid.
- Twice answered “should I quit?” as though a job and replacement plan were already established, without asking what the user meant.
- Added coaching to the casual-chat scenario twice.
- First priority run put a cosmetic bug ahead of the portfolio case study.

### Other eliminations

- GPT-OSS told an exhausted user to rest briefly and then keep working, assumed “quit” meant a job, and put the cosmetic bug before the portfolio.
- GLM placed deploy before smoke testing, leaked malformed multilingual fragments, and violated the point limit in half its calls.
- Luna's JSON fallback omitted required fields in most calls and also placed smoke testing after deploy.
- Llama proposed an impossible pharmacy schedule and inserted irrelevant coaching.
- Inkling appended a provider end token to every response, making all twelve results invalid JSON.

## Recommended next action

Do not switch the backend model silently. Add the twelve scenarios as regression fixtures first, then test Gemma through the real pipeline with Aion. The dependency-plan omission is the first prompt/model regression to solve or explicitly accept.
