require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Dynamic import / require for tsx or node environment
let processEnergyOptimizationScenario;
try {
  processEnergyOptimizationScenario = require('./lib/pipeline').processEnergyOptimizationScenario;
} catch (e) {
  processEnergyOptimizationScenario = require('./lib/pipeline.ts').processEnergyOptimizationScenario;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// GET /health
app.get('/health', (req, res) => {
  return res.status(200).json({ status: 'ok' });
});

// POST /optimize-energy
app.post('/optimize-energy', async (req, res) => {
  try {
    const result = await processEnergyOptimizationScenario(req.body);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Express Error in /optimize-energy:', error);
    return res.status(400).json({
      error: 'Scenario Processing Failed',
      message: error.message || 'An unexpected error occurred during optimization.',
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GridWise Smart Energy Optimization Server listening on http://0.0.0.0:${PORT}`);
});
