# GridWise — Smart Campus Energy Optimization (BUP CSE Fest 2026, Online Preliminary)

An HTTP API that reads natural-language campus operator notes, converts them into
machine-checkable energy directives with an LLM, validates those directives with
deterministic guardrails, and then solves a 24-hour cost-minimization schedule with
linear programming.

---

The service exposes exactly the two endpoints the judging harness uses:

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Readiness probe — returns `{"status":"ok"}` |
| `/optimize-energy` | POST | Operator-note interpretation + 24-hour optimized plan |

---

## Architecture

```
operator_notes ──▶ Tier 1: LLM interpreter      (NVIDIA NIM / OpenAI / Gemini)
                        │  structured directives
                        ▼
                   Tier 2: deterministic guardrails  (lib/guardrails.ts)
                        │  validated, clamped, note-index aligned directives
                        ▼
                   Tier 3: LP optimizer              (lib/lp-optimizer.ts)
                        │  javascript-lp-solver
                        ▼
                   Post-Solve Verification           (lib/pipeline.ts: verifyDirectivesApplied)
                        │  ensures 100% directive compliance & battery neutrality
                        ▼
                   24-hour plan + totals + summary
```

1. **Tier 1 — LLM interpretation** (`lib/llm-interpreter.ts`).
   The operator notes **and the scenario's battery configuration** are sent to the
   model, which returns one structured directive per note. The battery context is
   required so relative notes such as *"keep at least 50% of the battery capacity in
   reserve"* can be resolved into absolute kWh. Providers are tried in order
   (NVIDIA NIM → OpenAI → Gemini). Each provider has an 8s timeout with `maxRetries=0`
   keeping total chain execution well under 30s. If every provider fails, times out,
   or returns unusable output, a deterministic rule-based parser produces the
   interpretation instead.

2. **Tier 2 — deterministic guardrails** (`lib/guardrails.ts`).
   LLM output is treated as untrusted until it passes validation: unknown directive
   types are rejected, each note is mapped to exactly one interpretation in
   `note_index` order, hours are filtered to unique integers `0..23` and sorted
   ascending, `factor` is clamped to `[0,1]`, reserve values are clamped to
   `[0, capacity]`, and every `no_op` is forced to `applies=false` with
   `structured_adjustment=null`. A directive that cannot be validated becomes
   `no_op` rather than inventing a constraint.

3. **Tier 3 — LP optimizer & post-solve verification** (`lib/lp-optimizer.ts`, `lib/pipeline.ts`).
   A linear program over 24 hours minimizes `Σ grid_kwh[h] × tariff[h]` subject to:
   hourly energy balance (`grid + solar_used + discharge = demand + charge`),
   effective solar after `solar_reduction`, battery state transitions, battery
   bounds (base minimum, or a higher directive reserve), hourly charge/discharge
   rate limits, `no_charge_window` / `no_discharge_window`, `max_grid_window`, and
   end-of-day neutrality (`battery_energy[23] == initial_energy_kwh`).
   After solving, `verifyDirectivesApplied()` programmatically verifies that all
   applied directives and end-of-day battery neutrality were structurally satisfied.

---

## Quickstart (clean environment)

```bash
# 0. clone
git clone https://github.com/razin1325/gridwise-bup-cse-fest-2026.git
cd gridwise-bup-cse-fest-2026

# 1. install (must include dev dependencies: tailwindcss/postcss are devDeps)
npm install --include=dev

# 2. configure
cp .env.example .env      # then fill in your key(s) - .env is git-ignored

# 3. build and run
npm run build
npm start                 # serves on PORT (default 3000), bound to 0.0.0.0
```

For development with hot reload, `npm run dev` (also honours `PORT`).

Verify:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

On Windows shells use `set PORT=3100&& npm start` to override the port.

---

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | Port the service binds to (all interfaces) |
| `LLM_PROVIDER` | no | `auto` | `nvidia`, `openai`, `gemini`, or `auto` |
| `NVIDIA_API_KEY` | yes for the primary provider | — | NVIDIA NIM API key |
| `NVIDIA_MODEL` | no | `mistralai/mistral-nemotron` | NVIDIA NIM model id |
| `OPENAI_API_KEY` | optional | — | Enables the OpenAI fallback provider |
| `OPENAI_MODEL` | no | `gpt-4o-mini` | OpenAI model id |
| `GEMINI_API_KEY` | optional | — | Enables the Gemini fallback provider |
| `GEMINI_MODEL` | no | `gemini-1.5-flash` | Gemini model id |

`LLM_PROVIDER=nvidia` is the primary tested configuration. With `auto`, providers are tried
in the order NVIDIA → OpenAI → Gemini → deterministic parser, skipping any provider
whose key is unset.

**Model availability is per account.** `meta/llama-3.1-8b-instruct` reached end of life on
2026-08-26 and now returns `HTTP 410 Gone` — a deployment pinned to it silently degrades to
the rule-based parser. Check which models your key can actually call before deploying:

```bash
curl -H "Authorization: Bearer $NVIDIA_API_KEY" https://integrate.api.nvidia.com/v1/models
```

Verified working: `mistralai/mistral-nemotron` (default),
`meta/llama-3.2-11b-vision-instruct`, `nvidia/nemotron-3-super-120b-a12b`.
Adding an `OPENAI_API_KEY` or `GEMINI_API_KEY` enables an automatic second provider, which
is the cheapest insurance against a single provider outage during evaluation.

---

## API contract & Error Classification

### `GET /health`

```bash
curl http://localhost:3000/health
```
```json
{ "status": "ok" }
```

### `POST /optimize-energy`

Request: `scenario_id`, 1–3 `operator_notes`, exactly 24 `hours`
(`hour`, `demand_kwh`, `solar_kwh`, `tariff_bdt_per_kwh`), and a `battery` object
(`capacity_kwh`, `initial_energy_kwh`, `minimum_energy_kwh`,
`max_charge_kwh_per_hour`, `max_discharge_kwh_per_hour`).

```bash
curl -X POST http://localhost:3000/optimize-energy \
  -H "Content-Type: application/json" \
  -d '{
    "scenario_id": "DEMO-1",
    "operator_notes": [
      "Facilities will wash the rooftop solar panels from noon until 2 PM. During cleaning, usable solar should be treated as roughly 25% of the forecast.",
      "Keep at least 50% of the battery capacity stored in the battery from 6 PM until 9 PM for emergency operations.",
      "The sports office moved next month registration deadline."
    ],
    "hours": [
      {"hour": 0, "demand_kwh": 90, "solar_kwh": 0, "tariff_bdt_per_kwh": 6},
      {"hour": 12, "demand_kwh": 185, "solar_kwh": 180, "tariff_bdt_per_kwh": 15},
      {"hour": 23, "demand_kwh": 105, "solar_kwh": 0, "tariff_bdt_per_kwh": 7}
    ],
    "battery": {
      "capacity_kwh": 220,
      "initial_energy_kwh": 110,
      "minimum_energy_kwh": 40,
      "max_charge_kwh_per_hour": 50,
      "max_discharge_kwh_per_hour": 50
    }
  }'
```

Response shape:

```json
{
  "scenario_id": "DEMO-1",
  "directive_interpretation": [
    {
      "note_index": 0,
      "applies": true,
      "directive_type": "solar_reduction",
      "structured_adjustment": { "hours": [12, 13], "factor": 0.25 },
      "explanation": "Solar availability is reduced to 25% during the cleaning window."
    },
    {
      "note_index": 2,
      "applies": false,
      "directive_type": "no_op",
      "structured_adjustment": null,
      "explanation": "This note does not affect today's energy schedule."
    }
  ],
  "hourly_plan": [
    { "hour": 0, "grid_kwh": 90, "solar_used_kwh": 0, "battery_action": "idle",
      "battery_kwh": 0, "battery_energy_after_kwh": 110 }
  ],
  "total_grid_kwh": 2692.5,
  "total_cost_bdt": 38365,
  "peak_grid_kwh": 175,
  "plan_summary": "Optimized energy schedule applying 2 operator directive(s)."
}
```

#### Status Codes & Classification:
- **`200 OK`**: Successfully generated valid energy plan.
- **`400 Bad Request`**: Malformed JSON, missing required fields (`scenario_id`, `operator_notes`, `hours`), or non-string/invalid array elements (`ValidationError`).
- **`500 Internal Server Error`**: Controlled internal error (LLM exception, infeasible LP scenario, or post-solve directive assertion failure) without leaking stack traces (`InternalOptimizationError`).

---

## Validation & Benchmark Results

### 1. Sample Case Validation
Run sample validation against local or remote service:

```bash
npm run test:samples                        # defaults to http://localhost:3000
npm run test:samples -- http://localhost:3100
```

Result on the 10 public test cases:
```text
valid plans      : 10/10
total team cost  : 377973.00 BDT
reference cost   : 377973.00 BDT
overall quality  : 1.000
```

### 2. Reliability & Latency Stress Test
Run the stress test suite for edge case crash resilience & p95 latency benchmark:

```bash
npm run test:reliability
```

Result:
- **Pass Rate**: 100% (10/10 sample cases PASS, 7/7 crash edge cases cleanly handled)
- **Crashes / Failures**: 0
- **p95 Latency**: **950 ms** (Target: ≤ 5000 ms — **> 5x faster than required limit**)
- **p50 Latency**: 325 ms
- **Min Latency**: 200 ms

---

## Docker Deployment

Registry reference (public, no login required):

```text
toriqulhaque/gridwise-app:1.0.0
toriqulhaque/gridwise-app@sha256:e2f9ff416b25ec98a3e6f3a795515737fd421fb7cf208a84c128149c931580ea
```

Multi-stage build (`Dockerfile`): dependencies → Next.js standalone build → minimal `node:22-alpine` runtime running as non-root. Exposed port is **3000** and server binds to `0.0.0.0`.

```bash
# build locally
docker build -t gridwise-app:1.0.0 .

# or run submitted image
docker run -d --name gridwise \
  -p 3000:3000 \
  -e LLM_PROVIDER=nvidia \
  -e NVIDIA_API_KEY="<your-key>" \
  -e NVIDIA_MODEL=mistralai/mistral-nemotron \
  toriqulhaque/gridwise-app:1.0.0

# verify health
curl http://localhost:3000/health
```

`docker-compose.yml` is also provided:

```bash
NVIDIA_API_KEY="<your-key>" docker compose up --build -d
```

---

## Deploy on Vercel

1. Push repository to GitHub.
2. In Vercel, **Add New → Project**, import repository.
3. Add environment variables (`LLM_PROVIDER`, `NVIDIA_API_KEY`, `NVIDIA_MODEL`).
4. Deploy and test `/health` and `/optimize-energy`.

---

## Known limitations

- **Provider latency is the main variable.** The NVIDIA NIM free tier occasionally stalls
  for several seconds on roughly 1 request in 10. Each provider is capped at an 8s timeout
  with `maxRetries=0`, so the total chain stays far inside the 30s per-request limit; a
  stalled call falls through to the deterministic parser, which keeps the response valid
  and cost-optimal on the public cases.
- **Fallback parsing is phrase-based.** The deterministic parser covers the directive
  phrasings in the public pack, but it is a safety net, not a substitute for the LLM.
  Paraphrase robustness on unseen notes rests on the model answering.
- **Model choice materially affects interpretation.** A small 8B model mis-translated some
  time windows during testing (for example reading *"from 10 AM until noon"* as 10:00–23:00);
  end-exclusive windows are the most likely failure mode on hidden cases.
- **The service is stateless** — no cache and no database, so identical requests re-invoke
  the provider every time.
- **Vercel:** do not set `PORT` (the platform assigns it). Function duration defaults to
  300s on Hobby with fluid compute, so the 8s provider timeout is not a constraint there.

## Security & secret handling

- No API keys, tokens, or `.env` files are committed. `.env` is git-ignored and listed in
  `.dockerignore`.
- Next.js copies `.env` into `.next/standalone` during a build. The `Dockerfile` deletes
  those files inside the build stage, so credentials cannot reach an image layer. Verified:
  the published image contains no `.env` and no `nvapi-` string.
- API responses never contain stack traces or configuration values. Provider errors are
  caught and fail over; internal failures return a controlled `500` with a generic message.
- Only synthetic challenge data is used — no live campus, utility, billing, or personal data.
- **Operational note:** rotate the `NVIDIA_API_KEY` if it has ever been pasted into a shared
  channel, log, or commit. Keys are supplied at runtime via `docker run -e` or the hosting
  platform's environment settings, never baked into artifacts.

---

## Dependencies & Credits

| Component | Library |
|---|---|
| Web framework / API routes | Next.js 15 (App Router), React 19 |
| Solver | `javascript-lp-solver` |
| LLM SDKs | `openai` (NVIDIA NIM is OpenAI-compatible), `@google/generative-ai` |
| UI (dashboard) | Tailwind CSS, Recharts, lucide-react |
| Benchmark runners | `test-runner.js`, `test-reliability.js` |

Only synthetic challenge data is used; no live campus, utility, billing, or personal data is involved.
