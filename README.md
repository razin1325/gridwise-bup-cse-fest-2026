# GridWise — Smart Campus Energy Optimization (BUP CSE Fest 2026, Online Preliminary)

An HTTP API that reads natural-language campus operator notes, converts them into
machine-checkable energy directives with an LLM, validates those directives with
deterministic guardrails, and then solves a 24-hour cost-minimization schedule with
linear programming.

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
                   24-hour plan + totals + summary
```

1. **Tier 1 — LLM interpretation** (`lib/llm-interpreter.ts`).
   The operator notes **and the scenario's battery configuration** are sent to the
   model, which returns one structured directive per note. The battery context is
   required so relative notes such as *"keep at least 50% of the battery capacity in
   reserve"* can be resolved into absolute kWh. Providers are tried in order
   (NVIDIA NIM → OpenAI → Gemini). If every provider fails, times out, or returns
   unusable structured output, a deterministic rule-based parser produces the
   interpretation instead, so the endpoint never fails because of a model outage.

2. **Tier 2 — deterministic guardrails** (`lib/guardrails.ts`).
   LLM output is treated as untrusted until it passes validation: unknown directive
   types are rejected, each note is mapped to exactly one interpretation in
   `note_index` order, hours are filtered to unique integers `0..23` and sorted
   ascending, `factor` is clamped to `[0,1]`, reserve values are clamped to
   `[0, capacity]`, and every `no_op` is forced to `applies=false` with
   `structured_adjustment=null`. A directive that cannot be validated becomes
   `no_op` rather than inventing a constraint.

3. **Tier 3 — LP optimizer** (`lib/lp-optimizer.ts`).
   A linear program over 24 hours minimizes `Σ grid_kwh[h] × tariff[h]` subject to:
   hourly energy balance (`grid + solar_used + discharge = demand + charge`),
   effective solar after `solar_reduction`, battery state transitions, battery
   bounds (base minimum, or a higher directive reserve), hourly charge/discharge
   rate limits, `no_charge_window` / `no_discharge_window`, `max_grid_window`, and
   end-of-day neutrality (`battery_energy[23] == initial_energy_kwh`).

---

## Quickstart (clean environment)

```bash
# 1. install
npm install

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

`LLM_PROVIDER=nvidia` is the tested configuration. With `auto`, providers are tried
in the order NVIDIA → OpenAI → Gemini → deterministic parser, skipping any provider
whose key is unset.

> **Model availability is per-account.** `meta/llama-3.1-8b-instruct` reached end of
> life on 2026-08-26 and now returns `HTTP 410 Gone`, which silently degrades the
> service to the rule-based parser. Check the models your key can actually call:
>
> ```bash
> curl -H "Authorization: Bearer $NVIDIA_API_KEY" https://integrate.api.nvidia.com/v1/models
> ```
>
> Verified working with this key: `mistralai/mistral-nemotron`,
> `meta/llama-3.2-11b-vision-instruct`, `nvidia/nemotron-3-super-120b-a12b`.
> `mistralai/mistral-nemotron` is the default because it reproduced the reference
> optimum on all 10 public cases.

---

## API contract

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

Directive types and their exact `structured_adjustment` shape:

| `directive_type` | `structured_adjustment` |
|---|---|
| `solar_reduction` | `{"hours":[...], "factor": <usable fraction 0..1>}` |
| `minimum_battery_reserve` | `{"hours":[...], "minimum_energy_kwh": <kWh>}` |
| `no_charge_window` | `{"hours":[...]}` |
| `no_discharge_window` | `{"hours":[...]}` |
| `max_grid_window` | `{"hours":[...], "max_grid_kwh": <kWh>}` |
| `no_op` | `null` (with `applies: false`) |

Status codes: `200` success, `400` malformed JSON or structurally invalid request,
`500` controlled internal error (no secrets or stack traces are returned).

Time windows are start-inclusive and end-exclusive: *1 PM to 3 PM* → `[13, 14]`.

---

## Validate against the public sample cases

Start the service, then in a second terminal:

```bash
npm run test:samples                        # defaults to http://localhost:3000
npm run test:samples -- http://localhost:3100
```

`test-runner.js` calls the live API with `BUP_CSE_FEST_2026_Preli_Public_Sample_Cases.json`
and checks the response the way the judge does: schema and directive shape, hour
validity, effective-solar limits, energy balance, battery transitions/bounds/rate
limits, directive application, end-of-day neutrality, recomputed totals, and cost
quality against the published reference optimum.

Expected result on the 10 public cases:

```
valid plans      : 10/10
total team cost  : 377973.00 BDT
reference cost   : 377973.00 BDT
overall quality  : 1.000
```

---

## Docker fallback

Registry reference (public):

```
toriqulhaque/gridwise-app:1.0.0
toriqulhaque/gridwise-app@sha256:23fce654e3124a6d04cdb6bc92bd12c5501c7cd7ae4e599e1377889495b5458a
```

Multi-stage build (`Dockerfile`): dependencies → Next.js standalone build → minimal
`node:22-alpine` runtime running as a non-root user. Exposed port is **3000** and the
server binds to `0.0.0.0`. The image contains no `.env` and no API keys;
configuration is supplied at run time.

```bash
# build locally
docker build -t gridwise-app:1.0.0 .

# or pull the submitted image (public, no login required)
docker pull toriqulhaque/gridwise-app:1.0.0

docker run -d --name gridwise \
  -p 3000:3000 \
  -e LLM_PROVIDER=nvidia \
  -e NVIDIA_API_KEY="<your-key>" \
  -e NVIDIA_MODEL=mistralai/mistral-nemotron \
  toriqulhaque/gridwise-app:1.0.0

# wait for the HEALTHCHECK to report healthy, then:
curl http://localhost:3000/health
```

The container listens on **port 3000** bound to `0.0.0.0`. If host port 3000 is
already taken, map another host port, e.g. `-p 3100:3000`.

`docker-compose.yml` is also provided:

```bash
NVIDIA_API_KEY="<your-key>" docker compose up --build -d
```

---

## Deploy on Vercel

The repository is a standard Next.js app, so it deploys without extra configuration:

1. Push the repository to GitHub.
2. In Vercel, **Add New → Project**, import the repository.
3. Add the environment variables (`LLM_PROVIDER`, `NVIDIA_API_KEY`, `NVIDIA_MODEL`)
   for the Production environment.
4. Deploy, then smoke test
   `https://<project>.vercel.app/health` and `POST /optimize-energy`.

`/health` and `/optimize-energy` are wired with `next.config.js` rewrites, which
Vercel honours, so the judge-facing paths match the specification exactly. Do not
set `PORT` on Vercel — the platform manages it.

---

## Known limitations

- **Provider latency.** The NVIDIA NIM free tier occasionally stalls for 9–12 s on
  roughly 1 request in 10 (typical response is 2–3 s). Requests are capped at a 12 s
  model timeout with retries disabled, so the p95 stays well inside the 30 s
  per-request limit; a stalled call falls through to the deterministic parser, which
  keeps the response valid and near-optimal.
- **Model choice matters.** A small 8B model mis-translated some time windows
  (for example *"from 10 AM until noon"*) during testing; the configured
  `mistralai/mistral-nemotron` reproduced the reference optimum on all 10 public
  cases, but hidden paraphrases may still be mistranslated.
- The rule-based fallback covers the directive phrasings in the public pack, but it is
  a safety net, not a replacement for the LLM.
- The service is stateless; it holds no cache and no database.

---

## Security & secret handling

- No keys, tokens, or `.env` files are committed — `.env` is git-ignored and listed in
  `.dockerignore`.
- Next.js copies `.env` into `.next/standalone` at build time; the `Dockerfile`
  deletes those files inside the build stage so credentials cannot reach an image layer.
- API responses never include stack traces or configuration values; provider errors
  are swallowed and fail over to the deterministic parser.

---

## Dependencies & credits

| Component | Library |
|---|---|
| Web framework / API routes | Next.js 15 (App Router), React 19 |
| Solver | `javascript-lp-solver` |
| LLM SDKs | `openai` (NVIDIA NIM is OpenAI-compatible), `@google/generative-ai` |
| UI (dashboard) | Tailwind CSS, Recharts, lucide-react |
| Standalone server (secondary) | Express, cors |

Only synthetic challenge data is used; no live campus, utility, billing, or personal
data is involved.
