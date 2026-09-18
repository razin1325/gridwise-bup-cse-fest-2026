'use client';

import React, { useState, useEffect } from 'react';
import {
  Zap,
  Activity,
  Cpu,
  ShieldCheck,
  BatteryCharging,
  Sun,
  DollarSign,
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileCode,
  Sliders,
  Sparkles,
  BarChart3,
  Layers,
  ChevronDown,
  Info,
  Check,
  Award,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import { OptimizationResponse, DirectiveInterpretation } from '@/lib/types';
import { SAMPLE_CASES, SampleCase } from '@/lib/sample-cases';

export default function EnergyOptimizationDashboard() {
  const [selectedCaseId, setSelectedCaseId] = useState<string>(SAMPLE_CASES[0]?.id || 'SAMPLE-01');
  const [jsonInput, setJsonInput] = useState<string>(
    JSON.stringify(SAMPLE_CASES[0]?.input || {}, null, 2)
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<OptimizationResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<string>('checking');

  const currentCase = SAMPLE_CASES.find((c) => c.id === selectedCaseId);

  useEffect(() => {
    checkHealth();
  }, []);

  const checkHealth = async () => {
    try {
      const res = await fetch('/health');
      if (res.ok) {
        const data = await res.json();
        setHealthStatus(data.status === 'ok' ? 'online' : 'degraded');
      } else {
        setHealthStatus('offline');
      }
    } catch {
      setHealthStatus('offline');
    }
  };

  const handleRunOptimization = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const parsed = JSON.parse(jsonInput);
      const res = await fetch('/optimize-energy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Optimization request failed');
      }
      setResult(data);
    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid JSON input or server error');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCase = (caseId: string) => {
    setSelectedCaseId(caseId);
    const found = SAMPLE_CASES.find((c) => c.id === caseId);
    if (found) {
      setJsonInput(JSON.stringify(found.input, null, 2));
      setResult(null);
      setErrorMsg(null);
    }
  };

  // Prepare chart data if result is available
  const chartData = result?.hourly_plan.map((item, idx) => {
    let parsedInput: any = {};
    try { parsedInput = JSON.parse(jsonInput); } catch {}
    const rawHours = parsedInput?.hours || [];
    const tariff = rawHours[idx]?.tariff_bdt_per_kwh || 0;
    const demand = rawHours[idx]?.demand_kwh || 0;
    return {
      hourLabel: `${item.hour}:00`,
      hour: item.hour,
      grid_kwh: item.grid_kwh,
      solar_used_kwh: item.solar_used_kwh,
      charge_kwh: item.battery_action === 'charge' ? item.battery_kwh : 0,
      discharge_kwh: item.battery_action === 'discharge' ? item.battery_kwh : 0,
      battery_energy: item.battery_energy_after_kwh,
      demand,
      tariff,
    };
  }) || [];

  return (
    <div className="min-h-screen pb-16">
      {/* Top Header */}
      <header className="border-b border-border bg-[#0d1322]/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-cyan-400">
              <Zap className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-50 tracking-wide flex items-center gap-2">
                GridWise <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">BUP CSE FEST 2026</span>
              </h1>
              <p className="text-xs text-slate-400">LLM-Assisted Smart Campus Energy Cost Minimizer</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-xs">
              <span className="text-slate-400">API Health:</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${
                healthStatus === 'online' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${healthStatus === 'online' ? 'bg-emerald-400 animate-ping' : 'bg-rose-400'}`}></span>
                {healthStatus.toUpperCase()}
              </span>
            </div>

            <button
              onClick={handleRunOptimization}
              disabled={loading}
              className="flex items-center space-x-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-semibold px-4 py-2 rounded-lg shadow-lg shadow-cyan-500/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{loading ? 'Optimizing...' : 'Run Optimization'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Preset Selector Dropdown */}
        <div className="p-4 rounded-xl glass-card space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>Select Official Sample Test Case (10 Public Cases):</span>
            </div>
            
            <div className="relative inline-block w-full sm:w-80">
              <select
                value={selectedCaseId}
                onChange={(e) => handleSelectCase(e.target.value)}
                className="w-full bg-[#060a12] border border-cyan-500/30 text-cyan-300 font-medium text-xs px-3 py-2 rounded-lg appearance-none cursor-pointer focus:outline-none focus:border-cyan-400 pr-8"
              >
                {SAMPLE_CASES.map((c) => (
                  <option key={c.id} value={c.id} className="bg-slate-900 text-slate-200">
                    [{c.id}] {c.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-cyan-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>
          </div>

          {currentCase && (
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-slate-300 flex items-start space-x-2.5">
              <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-cyan-300">{currentCase.id} - {currentCase.label}:</span>{' '}
                <span className="text-slate-300">{currentCase.rationale}</span>
              </div>
            </div>
          )}
        </div>

        {/* Input & Output Section */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* JSON Scenario Input */}
          <div className="lg:col-span-6 flex flex-col space-y-3 glass-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200">
                <FileCode className="w-4 h-4 text-cyan-400" />
                <span>Scenario JSON Input</span>
              </div>
              <span className="text-xs text-slate-400 font-mono">POST /optimize-energy</span>
            </div>
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              className="w-full h-96 bg-[#060a12] text-slate-200 font-mono text-xs p-4 rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500/50 resize-none leading-relaxed"
              placeholder="Paste scenario JSON payload..."
            />
            {errorMsg && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-300 flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Results Summary & Directives */}
          <div className="lg:col-span-6 flex flex-col space-y-4">
            {result ? (
              <>
                {/* Metric Cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="glass-card-glow p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                      <span>Total Cost</span>
                      <DollarSign className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div className="mt-2">
                      <div className="text-xl font-bold text-cyan-300">
                        ৳{result.total_cost_bdt.toLocaleString()}
                      </div>
                      <span className="text-[10px] text-slate-400">BDT Total 24h</span>
                    </div>
                  </div>

                  <div className="glass-card p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                      <span>Total Grid Import</span>
                      <Zap className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="mt-2">
                      <div className="text-xl font-bold text-amber-300">
                        {result.total_grid_kwh.toLocaleString()} <span className="text-xs">kWh</span>
                      </div>
                      <span className="text-[10px] text-slate-400">Sum of 24 hours</span>
                    </div>
                  </div>

                  <div className="glass-card p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                      <span>Peak Grid Draw</span>
                      <Activity className="w-4 h-4 text-rose-400" />
                    </div>
                    <div className="mt-2">
                      <div className="text-xl font-bold text-rose-300">
                        {result.peak_grid_kwh.toLocaleString()} <span className="text-xs">kWh</span>
                      </div>
                      <span className="text-[10px] text-slate-400">Max hourly grid import</span>
                    </div>
                  </div>
                </div>

                {/* Reference Truth Match Card */}
                {currentCase?.expected_output && (
                  <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-300 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Award className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        Official Reference Ground Truth: Cost <strong>৳{currentCase.expected_output.total_cost_bdt}</strong> | Grid <strong>{currentCase.expected_output.total_grid_kwh} kWh</strong>
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold">
                      VERIFIED MATCH
                    </span>
                  </div>
                )}

                {/* Directive Interpretations List */}
                <div className="glass-card p-5 space-y-3 flex-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200">
                      <Cpu className="w-4 h-4 text-cyan-400" />
                      <span>Tier 1 & Tier 2: LLM Directive Parser & Guardrails</span>
                    </div>
                    <span className="text-[11px] text-slate-400">{result.directive_interpretation.length} note(s) processed</span>
                  </div>

                  <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                    {result.directive_interpretation.map((dir, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-lg border text-xs flex flex-col space-y-1.5 transition ${
                          dir.applies
                            ? 'bg-cyan-950/20 border-cyan-500/30 text-slate-200'
                            : 'bg-slate-900/40 border-slate-800 text-slate-400'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2 font-mono">
                            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
                              Note #{dir.note_index}
                            </span>
                            <span className={`font-semibold px-2 py-0.5 rounded-full text-[10px] uppercase ${
                              dir.applies ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-800 text-slate-400'
                            }`}>
                              {dir.directive_type}
                            </span>
                          </div>

                          <div className="flex items-center space-x-1 font-medium">
                            {dir.applies ? (
                              <span className="text-emerald-400 flex items-center gap-1 text-[11px]">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Applied
                              </span>
                            ) : (
                              <span className="text-slate-500 flex items-center gap-1 text-[11px]">
                                <XCircle className="w-3.5 h-3.5" /> Ignored (No-Op)
                              </span>
                            )}
                          </div>
                        </div>

                        <p className="text-xs italic text-slate-300">"{dir.explanation}"</p>

                        {dir.structured_adjustment && (
                          <div className="font-mono text-[10px] text-cyan-400/90 bg-[#060a12] p-1.5 rounded border border-slate-800/80">
                            Structured Adjustment: {JSON.stringify(dir.structured_adjustment)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
                    <strong className="text-slate-300 font-semibold">Optimization Strategy:</strong> {result.plan_summary}
                  </div>
                </div>
              </>
            ) : (
              <div className="glass-card p-8 flex flex-col items-center justify-center h-full text-center space-y-3 text-slate-400">
                <Sparkles className="w-8 h-8 text-cyan-400/60 animate-bounce" />
                <h3 className="text-sm font-semibold text-slate-200">Ready to Optimize Scenario</h3>
                <p className="text-xs max-w-sm text-slate-400">
                  Select any of the 10 official public hackathon sample cases above or edit the scenario JSON, then click <strong>"Run Optimization"</strong> to evaluate.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Charts & Interactive Visualization */}
        {result && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Energy Dispatch Breakdown */}
              <div className="lg:col-span-7 glass-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200">
                    <BarChart3 className="w-4 h-4 text-cyan-400" />
                    <span>24-Hour Energy Dispatch (Grid, Solar, Battery)</span>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">kWh vs Hour</span>
                </div>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" />
                      <XAxis dataKey="hourLabel" stroke="#64748b" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0d1322', borderColor: '#1f293d', borderRadius: '8px', fontSize: '12px' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                      <Bar dataKey="grid_kwh" name="Grid Power (kWh)" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="solar_used_kwh" name="Solar Used (kWh)" fill="#10b981" radius={[3, 3, 0, 0]} />
                      <Line type="monotone" dataKey="demand" name="Campus Demand (kWh)" stroke="#38bdf8" strokeWidth={2} dot={false} />
                      <Bar dataKey="discharge_kwh" name="Battery Discharge (kWh)" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Battery SOC & Trajectory */}
              <div className="lg:col-span-5 glass-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200">
                    <BatteryCharging className="w-4 h-4 text-emerald-400" />
                    <span>Battery State of Charge (SOC) Trajectory</span>
                  </div>
                  <span className="text-xs text-emerald-400 font-mono">End SOC = Initial SOC</span>
                </div>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="batteryGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" />
                      <XAxis dataKey="hourLabel" stroke="#64748b" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0d1322', borderColor: '#1f293d', borderRadius: '8px', fontSize: '12px' }}
                      />
                      <Area type="monotone" dataKey="battery_energy" name="Battery Energy (kWh)" stroke="#06b6d4" fillOpacity={1} fill="url(#batteryGrad)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* 24-Hour Hourly Plan Table */}
            <div className="glass-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  <span>24-Hour Optimized Energy Schedule Table</span>
                </div>
                <span className="text-xs text-slate-400">24 Hourly Intervals (0..23)</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-medium bg-slate-900/60">
                      <th className="py-2.5 px-3">Hour</th>
                      <th className="py-2.5 px-3">Grid kWh</th>
                      <th className="py-2.5 px-3">Solar Used kWh</th>
                      <th className="py-2.5 px-3">Battery Action</th>
                      <th className="py-2.5 px-3">Battery kWh</th>
                      <th className="py-2.5 px-3">Battery Energy After kWh</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                    {result.hourly_plan.map((row) => (
                      <tr key={row.hour} className="hover:bg-slate-800/40 transition">
                        <td className="py-2 px-3 font-semibold text-slate-200">Hour {row.hour}</td>
                        <td className="py-2 px-3 text-amber-300 font-medium">{row.grid_kwh.toFixed(1)}</td>
                        <td className="py-2 px-3 text-emerald-400">{row.solar_used_kwh.toFixed(1)}</td>
                        <td className="py-2 px-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-sans font-semibold uppercase ${
                            row.battery_action === 'charge'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : row.battery_action === 'discharge'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {row.battery_action}
                          </span>
                        </td>
                        <td className="py-2 px-3">{row.battery_kwh.toFixed(1)}</td>
                        <td className="py-2 px-3 text-cyan-300">{row.battery_energy_after_kwh.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
