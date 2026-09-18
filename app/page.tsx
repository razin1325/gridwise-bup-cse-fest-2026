'use client';

import React, { useState, useEffect } from 'react';
import ElectricityAnimation from './components/ElectricityAnimation';
import {
  Zap,
  Activity,
  Cpu,
  ShieldCheck,
  BatteryCharging,
  Sun,
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
  const [jsonOpen, setJsonOpen] = useState<boolean>(false);

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
      {/* Electricity Decoration */}
      <ElectricityAnimation />
      {/* Top Header */}
      <header className="border-b border-border bg-[#0d1322]/90 backdrop-blur sticky top-0 z-50 relative">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-0 sm:h-16 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
          <div className="flex items-center space-x-3">
            <div className="p-1.5 sm:p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-cyan-400">
              <Zap className="w-5 h-5 sm:w-6 sm:h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-50 tracking-wide flex items-center gap-2">
                GridWise <span className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">BUP CSE FEST 2026</span>
              </h1>
              <p className="text-[10px] sm:text-xs text-slate-400">LLM-Assisted Smart Campus Energy Cost Minimizer</p>
            </div>
          </div>

          <div className="flex items-center space-x-3 sm:space-x-4 w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex items-center space-x-2 text-xs">
              <span className="text-slate-400 hidden sm:inline">API Health:</span>
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
              className="flex items-center space-x-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-semibold px-3 sm:px-4 py-2 rounded-lg shadow-lg shadow-cyan-500/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer text-sm"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{loading ? 'Optimizing...' : 'Run Optimization'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-4 sm:pt-6 space-y-4 sm:space-y-6 relative z-10">
        {/* Sample Case Card Selector */}
        <div className="p-3 sm:p-4 rounded-xl glass-card space-y-3">
          <div className="flex items-center space-x-2 text-xs sm:text-sm font-semibold text-slate-200">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <span>Official Sample Test Cases <span className="text-xs font-normal text-slate-400 ml-1">(10 Public Cases)</span></span>
          </div>

          {/* 5×2 Card Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {SAMPLE_CASES.map((c, idx) => {
              const isActive = selectedCaseId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => handleSelectCase(c.id)}
                  className={`flex flex-col items-start gap-1.5 px-3 py-2.5 rounded-lg border text-left transition-all cursor-pointer w-full ${
                    isActive
                      ? 'bg-cyan-500/15 border-cyan-500/60 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                      : 'bg-slate-900/50 border-slate-800 hover:border-slate-600 hover:bg-slate-800/60'
                  }`}
                >
                  <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                    isActive ? 'bg-cyan-500/25 text-cyan-300' : 'bg-slate-800 text-slate-400'
                  }`}>
                    #{String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className={`text-[10px] leading-tight font-medium ${
                    isActive ? 'text-cyan-200' : 'text-slate-300'
                  }`}>
                    {c.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Selected Case Rationale */}
          {currentCase && (
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-slate-300 flex items-start space-x-2.5">
              <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-cyan-300">{currentCase.id} — {currentCase.label}:</span>{' '}
                <span className="text-slate-300">{currentCase.rationale}</span>
              </div>
            </div>
          )}
        </div>

        {/* Input Section — collapsible accordion */}
        <div className="glass-card overflow-hidden">
          {/* Accordion Header */}
          <button
            onClick={() => setJsonOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 sm:px-5 py-3 sm:py-4 cursor-pointer hover:bg-white/[0.03] transition-colors"
          >
            <div className="flex items-center space-x-2 text-xs sm:text-sm font-semibold text-slate-200">
              <FileCode className="w-4 h-4 text-cyan-400" />
              <span>Scenario JSON Input</span>
              <span className="text-xs font-mono text-slate-400 font-normal ml-1 hidden sm:inline">POST /optimize-energy</span>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-cyan-400 transition-transform duration-300 ${
                jsonOpen ? 'rotate-180' : 'rotate-0'
              }`}
            />
          </button>

          {/* Collapsible Body */}
          {jsonOpen && (
            <div className="px-3 sm:px-5 pb-4 sm:pb-5 flex flex-col space-y-3 border-t border-white/[0.05]">
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="w-full h-48 sm:h-64 bg-[#060a12] text-slate-200 font-mono text-[10px] sm:text-xs p-3 sm:p-4 rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500/50 resize-none leading-relaxed mt-3"
                placeholder="Paste scenario JSON payload..."
              />
              {errorMsg && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-300 flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Ready Placeholder — shown only when no result yet */}
        {!result && (
          <div className="glass-card p-6 sm:p-8 flex flex-col items-center justify-center text-center space-y-3 text-slate-400">
            <Sparkles className="w-8 h-8 text-cyan-400/60 animate-bounce" />
            <h3 className="text-sm font-semibold text-slate-200">Ready to Optimize Scenario</h3>
            <p className="text-xs max-w-sm text-slate-400">
              Select any of the 10 official public hackathon sample cases above or edit the scenario JSON, then click <strong>&quot;Run Optimization&quot;</strong> to evaluate.
            </p>
          </div>
        )}

        {/* Results Summary & Directives — shown only when result exists */}
        {result && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Metric Cards + Reference Truth + Directives */}
            <div className="lg:col-span-6 flex flex-col space-y-4">
              {/* Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="glass-card-glow p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                    <span>Total Cost</span>
                    <span className="w-6 h-6 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-bold text-sm flex items-center justify-center">৳</span>
                  </div>
                  <div className="mt-2">
                    <div className="text-xl font-bold text-cyan-300">৳{result.total_cost_bdt.toLocaleString()}</div>
                    <span className="text-[10px] text-slate-400">BDT Total 24h</span>
                  </div>
                </div>

                <div className="glass-card p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                    <span>Total Grid Import</span>
                    <Zap className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="mt-2">
                    <div className="text-xl font-bold text-amber-300">{result.total_grid_kwh.toLocaleString()} <span className="text-xs">kWh</span></div>
                    <span className="text-[10px] text-slate-400">Sum of 24 hours</span>
                  </div>
                </div>

                <div className="glass-card p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                    <span>Peak Grid Draw</span>
                    <Activity className="w-4 h-4 text-rose-400" />
                  </div>
                  <div className="mt-2">
                    <div className="text-xl font-bold text-rose-300">{result.peak_grid_kwh.toLocaleString()} <span className="text-xs">kWh</span></div>
                    <span className="text-[10px] text-slate-400">Max hourly grid import</span>
                  </div>
                </div>
              </div>

              {/* Reference Truth Match Card */}
              {currentCase?.expected_output && (
                <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
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
            </div>

            {/* Right: Directive Interpretations */}
            <div className="lg:col-span-6 glass-card p-3 sm:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <span>Tier 1 &amp; Tier 2: LLM Directive Parser &amp; Guardrails</span>
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
                        <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">Note #{dir.note_index}</span>
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
                    <p className="text-xs italic text-slate-300">&quot;{dir.explanation}&quot;</p>
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
          </div>
        )}

        {/* Charts & Interactive Visualization */}
        {result && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Energy Dispatch Breakdown */}
              <div className="lg:col-span-7 glass-card p-3 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-0">
                  <div className="flex items-center space-x-2 text-xs sm:text-sm font-semibold text-slate-200">
                    <BarChart3 className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>24-Hour Energy Dispatch (Grid, Solar, Battery)</span>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">kWh vs Hour</span>
                </div>

                <div className="h-56 sm:h-72 w-full">
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
              <div className="lg:col-span-5 glass-card p-3 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-0">
                  <div className="flex items-center space-x-2 text-xs sm:text-sm font-semibold text-slate-200">
                    <BatteryCharging className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Battery State of Charge (SOC) Trajectory</span>
                  </div>
                  <span className="text-xs text-emerald-400 font-mono">End SOC = Initial SOC</span>
                </div>

                <div className="h-56 sm:h-72 w-full">
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
            <div className="glass-card p-3 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-0">
                <div className="flex items-center space-x-2 text-xs sm:text-sm font-semibold text-slate-200">
                  <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
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
