# BUP CSE FEST 2026: GridWise LLM Smart Campus Energy Optimization Challenge

Production-ready solution for the **GridWise LLM Smart Campus Energy Optimization Challenge**.

GridWise is an intelligent, 3-tier energy management engine that accepts natural language operator notes, extracts structured operational directives using an LLM, sanitizes directives through deterministic guardrails, and solves a 24-hour campus electricity cost minimization problem using Linear Programming (LP).

---

## 🚀 Core Architecture Pipeline

```
[ Operator Notes ] ---> ( Tier 1: LLM Interpreter )
                                |
                                v
                       ( Tier 2: Deterministic Guardrails )
                                |
                                v
                       ( Tier 3: LP Math Optimizer ) ---> [ Optimal 24-Hour Plan JSON ]
```

1. **Tier 1: LLM Interpreter**: Accepts 1–3 operator notes and extracts structured energy directives using OpenAI (`gpt-4o` / `gpt-4o-mini`), Google Gemini (`gemini-1.5-flash`), or built-in deterministic fallback parsing.
2. **Tier 2: Deterministic Guardrails**: Validates and sanitizes directive JSON outputs (enforces valid hour ranges `[0..23]`, numeric bounds, directive enum types, and sets `applies = false` for `no_op`).
3. **Tier 3: LP Math Optimizer**: Formulates and solves a 24-hour Linear Programming model using `javascript-lp-solver` considering solar availability, battery state transitions, battery rate limits, grid import caps, directive windows, and end-of-day battery state neutrality (`battery_energy[23] === initial_energy_kwh`).

---

## 🛠 Tech Stack

- **Backend**: Node.js (Express.js & Next.js API Routes)
- **Frontend**: Next.js 15 (App Router), Tailwind CSS, Lucide Icons, Recharts
- **Optimization Library**: `javascript-lp-solver`
- **LLM Integrations**: OpenAI API / Google Gemini API / Rule-based Fallback Parser
- **Containerization**: Docker (Multi-stage build)

---

## 📦 Quickstart (Local Setup)

### 1. Clone & Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Set your API keys (optional; rule fallback parser operates automatically if omitted):
```env
OPENAI_API_KEY=your_openai_key
# or
GEMINI_API_KEY=your_gemini_key
```

### 3. Run Development Server
```bash
npm run dev
```
Open `http://localhost:3000` to access the interactive web dashboard and API endpoints.

Alternatively, to run the standalone Express server:
```bash
npm run server
```

---

## 🐳 Docker Deployment

### Build Container
```bash
docker build -t gridwise-app .
```

### Run Container
```bash
docker run -d \
  -p 3000:3000 \
  -e OPENAI_API_KEY="your_api_key_here" \
  --name gridwise-container \
  gridwise-app
```

### Docker Compose
```bash
docker-compose up --build -d
```

---

## 📡 API Contract & Endpoints

### 1. `GET /health`
- **Response** (HTTP 200 within 60s of container startup):
```json
{
  "status": "ok"
}
```

### 2. `POST /optimize-energy`
- **Request Body**:
```json
{
  "scenario_id": "GRID-101",
  "operator_notes": [
    "Facilities will wash the rooftop solar panels from noon until 2 PM. Usable solar should be treated as roughly 25% of forecast.",
    "The sports office moved next month's registration deadline."
  ],
  "hours": [
    { "hour": 0, "demand_kwh": 90, "solar_kwh": 0, "tariff_bdt_per_kwh": 6 },
    { "hour": 12, "demand_kwh": 185, "solar_kwh": 180, "tariff_bdt_per_kwh": 15 },
    { "hour": 23, "demand_kwh": 105, "solar_kwh": 0, "tariff_bdt_per_kwh": 7 }
  ],
  "battery": {
    "capacity_kwh": 220,
    "initial_energy_kwh": 110,
    "minimum_energy_kwh": 40,
    "max_charge_kwh_per_hour": 50,
    "max_discharge_kwh_per_hour": 50
  }
}
```

- **Response Body** (HTTP 200):
```json
{
  "scenario_id": "GRID-101",
  "directive_interpretation": [
    {
      "note_index": 0,
      "applies": true,
      "directive_type": "solar_reduction",
      "structured_adjustment": { "hours": [12, 13], "factor": 0.25 },
      "explanation": "Usable solar reduced to 25% during specified window."
    },
    {
      "note_index": 1,
      "applies": false,
      "directive_type": "no_op",
      "structured_adjustment": null,
      "explanation": "Note does not contain operational energy directives for today."
    }
  ],
  "hourly_plan": [
    {
      "hour": 0,
      "grid_kwh": 90,
      "solar_used_kwh": 0,
      "battery_action": "idle",
      "battery_kwh": 0,
      "battery_energy_after_kwh": 110
    }
  ],
  "total_grid_kwh": 2692.5,
  "total_cost_bdt": 38365,
  "peak_grid_kwh": 175,
  "plan_summary": "Optimized energy schedule applying 1 operator directive(s)."
}
```

---

## 🧪 Testing with cURL

### Health Check Test
```bash
curl -X GET http://localhost:3000/health
```

### Scenario Optimization Test
```bash
curl -X POST http://localhost:3000/optimize-energy \
  -H "Content-Type: application/json" \
  -d '{
    "scenario_id": "GRID-TEST-1",
    "operator_notes": ["Facilities will wash the rooftop solar panels from noon until 2 PM. Usable solar should be treated as roughly 25% of the forecast."],
    "hours": [
      {"hour": 0, "demand_kwh": 90, "solar_kwh": 0, "tariff_bdt_per_kwh": 6},
      {"hour": 1, "demand_kwh": 85, "solar_kwh": 0, "tariff_bdt_per_kwh": 6},
      {"hour": 2, "demand_kwh": 80, "solar_kwh": 0, "tariff_bdt_per_kwh": 5},
      {"hour": 3, "demand_kwh": 80, "solar_kwh": 0, "tariff_bdt_per_kwh": 5},
      {"hour": 4, "demand_kwh": 85, "solar_kwh": 0, "tariff_bdt_per_kwh": 5},
      {"hour": 5, "demand_kwh": 95, "solar_kwh": 0, "tariff_bdt_per_kwh": 6},
      {"hour": 6, "demand_kwh": 110, "solar_kwh": 5, "tariff_bdt_per_kwh": 8},
      {"hour": 7, "demand_kwh": 130, "solar_kwh": 20, "tariff_bdt_per_kwh": 10},
      {"hour": 8, "demand_kwh": 150, "solar_kwh": 50, "tariff_bdt_per_kwh": 12},
      {"hour": 9, "demand_kwh": 165, "solar_kwh": 90, "tariff_bdt_per_kwh": 14},
      {"hour": 10, "demand_kwh": 175, "solar_kwh": 130, "tariff_bdt_per_kwh": 16},
      {"hour": 11, "demand_kwh": 180, "solar_kwh": 160, "tariff_bdt_per_kwh": 16},
      {"hour": 12, "demand_kwh": 185, "solar_kwh": 180, "tariff_bdt_per_kwh": 15},
      {"hour": 13, "demand_kwh": 180, "solar_kwh": 170, "tariff_bdt_per_kwh": 14},
      {"hour": 14, "demand_kwh": 170, "solar_kwh": 140, "tariff_bdt_per_kwh": 13},
      {"hour": 15, "demand_kwh": 165, "solar_kwh": 90, "tariff_bdt_per_kwh": 14},
      {"hour": 16, "demand_kwh": 170, "solar_kwh": 45, "tariff_bdt_per_kwh": 18},
      {"hour": 17, "demand_kwh": 185, "solar_kwh": 10, "tariff_bdt_per_kwh": 22},
      {"hour": 18, "demand_kwh": 205, "solar_kwh": 0, "tariff_bdt_per_kwh": 28},
      {"hour": 19, "demand_kwh": 215, "solar_kwh": 0, "tariff_bdt_per_kwh": 30},
      {"hour": 20, "demand_kwh": 205, "solar_kwh": 0, "tariff_bdt_per_kwh": 26},
      {"hour": 21, "demand_kwh": 175, "solar_kwh": 0, "tariff_bdt_per_kwh": 18},
      {"hour": 22, "demand_kwh": 135, "solar_kwh": 0, "tariff_bdt_per_kwh": 10},
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
