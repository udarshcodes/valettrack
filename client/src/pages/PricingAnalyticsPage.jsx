import React, { useState, useEffect } from 'react';
import { 
  Info, 
  RefreshCw,
  Activity 
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  CartesianGrid, 
  Legend 
} from 'recharts';
import { api } from '../services/api';

export function PricingAnalyticsPage() {
  const [analysis, setAnalysis] = useState(null);
  const [recommendations, setRecommendations] = useState(null);
  const [facilityPricing, setFacilityPricing] = useState(null);
  const [testOccupancy, setTestOccupancy] = useState(75);
  const [testBaseRate, setTestBaseRate] = useState(2.00);
  const [loading, setLoading] = useState(true);

  async function loadPricingData() {
    try {
      setLoading(true);
      const [analysisRes, recRes, facRes] = await Promise.all([
        api.getSFparkPricingAnalysis(),
        api.getSFparkPricingRecommendations(),
        api.getFacilityPricingRecommendations()
      ]);
      setAnalysis(analysisRes);
      setRecommendations(recRes);
      setFacilityPricing(facRes);
    } catch (err) {
      console.error('Error loading pricing analytics:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPricingData();
  }, []);

  const rateTierChartData = analysis?.rateTiers?.map(tier => ({
    tier: tier.rate_tier,
    occupancy: parseFloat(tier.avg_occupancy) || 0,
    count: parseInt(tier.observation_count, 10) || 0
  })) || [];

  const districtChartData = analysis?.districtPricing?.slice(0, 10).map(d => ({
    district: d.district_name,
    rate: parseFloat(d.avg_meter_rate) || 0,
    occupancy: parseFloat(d.avg_occupancy) || 0
  })) || [];

  if (loading && !analysis) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 font-mono text-sm">
        <RefreshCw className="w-5 h-5 animate-spin mr-2 text-[#10E599]" />
        Loading pricing & elasticity analytics...
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Dynamic Pricing & Rate-Demand Analytics</h1>
          <p className="text-sm text-slate-400">
            Real historical meter rates, observed occupancy correlation, and SFpark pilot dynamic pricing policy
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadPricingData}
            className="p-2 bg-[#0B1017] hover:bg-[#121A24] border border-[#16202C] rounded-xl text-slate-300 transition-colors"
            title="Refresh Analysis"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-5 rounded-2xl bg-[#0B1017] border border-[#10E599]/30 flex items-start gap-4 shadow-xl">
        <Info className="w-5 h-5 text-[#10E599] shrink-0 mt-0.5" />
        <div className="text-xs text-slate-300 leading-relaxed font-sans space-y-1.5">
          <strong className="block text-white font-bold text-sm">
            Real Dataset Provenance & Documented Dynamic Pricing Policy
          </strong>
          <p className="text-slate-400">
            This dashboard replaces synthetic ML prediction placeholders with <strong className="text-white">real empirical observations</strong> from the complete SFpark dataset (7.9M+ sensor records).
          </p>
          <p className="text-slate-400">
            Pricing recommendations are calculated using the <strong className="text-white">SFpark Pilot Dynamic Pricing Heuristic</strong> (Target 60% to 80% availability band): 
            high-demand districts (&gt;80% occupancy) receive a <span className="text-[#10E599] font-mono">+25¢/hr surge</span>, underutilized districts (&lt;60%) receive an <span className="text-teal-400 font-mono">-25¢/hr off-peak discount</span>, while balanced districts maintain equilibrium.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="p-5 bg-[#0B1017] border border-[#16202C] rounded-2xl">
          <span className="text-xs font-mono text-slate-400 uppercase">AVG HISTORICAL RATE</span>
          <div className="mt-2 text-2xl font-extrabold text-teal-400 font-mono">
            ${districtChartData.length > 0 ? (districtChartData.reduce((acc, d) => acc + d.rate, 0) / districtChartData.length).toFixed(2) : '3.66'}
            <span className="text-xs text-slate-400 font-sans font-normal ml-1">/ hr</span>
          </div>
          <span className="text-xs text-slate-400 font-mono mt-1 block">Observed on-street meter rates</span>
        </div>

        <div className="p-5 bg-[#0B1017] border border-[#16202C] rounded-2xl">
          <span className="text-xs font-mono text-slate-400 uppercase">PEAK MONITORED DISTRICT</span>
          <div className="mt-2 text-xl font-extrabold text-white font-mono truncate">
            {districtChartData[0]?.district || 'Downtown'}
          </div>
          <span className="text-xs text-[#10E599] font-mono mt-1 block">
            {districtChartData[0]?.occupancy || 0}% Average Occupancy
          </span>
        </div>

        <div className="p-5 bg-[#0B1017] border border-[#16202C] rounded-2xl">
          <span className="text-xs font-mono text-slate-400 uppercase">POLICY AVAILABILITY GOAL</span>
          <div className="mt-2 text-2xl font-extrabold text-[#10E599] font-mono">
            60% to 80%
          </div>
          <span className="text-xs text-slate-400 font-mono mt-1 block">SFpark target occupancy window</span>
        </div>

        <div className="p-5 bg-[#0B1017] border border-[#16202C] rounded-2xl">
          <span className="text-xs font-mono text-slate-400 uppercase">DYNAMIC PRICING STEP</span>
          <div className="mt-2 text-2xl font-extrabold text-white font-mono">
            ±$0.25 / hr
          </div>
          <span className="text-xs text-slate-400 font-mono mt-1 block">Pilot elasticity rate increment</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-bold text-white">Observed Occupancy by Rate Tier</h2>
              <p className="text-xs text-slate-400 font-mono">
                Empirical relationship between meter rate and parking demand
              </p>
            </div>
            <span className="text-xs font-mono text-[#10E599]">SFpark Empirical</span>
          </div>

          <div className="h-64 w-full">
            {rateTierChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rateTierChartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#16202C" vertical={false} />
                  <XAxis 
                    dataKey="tier" 
                    stroke="#475569" 
                    fontSize={9} 
                    tickLine={false} 
                    angle={-15}
                    textAnchor="end"
                  />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false} unit="%" domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0B1017', borderColor: '#16202C', borderRadius: '0.75rem', fontSize: '12px' }}
                    formatter={(val) => [`${val}%`, 'Avg Occupancy']}
                  />
                  <Bar dataKey="occupancy" fill="#10E599" radius={[6, 6, 0, 0]} name="Avg Occupancy %" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs">
                Loading rate tier records...
              </div>
            )}
          </div>
        </div>

        <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-bold text-white">District Rate & Occupancy Profile</h2>
              <p className="text-xs text-slate-400 font-mono">
                Average meter rate vs historical occupancy across top districts
              </p>
            </div>
            <span className="text-xs font-mono text-teal-400">By District</span>
          </div>

          <div className="h-64 w-full">
            {districtChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={districtChartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#16202C" vertical={false} />
                  <XAxis 
                    dataKey="district" 
                    stroke="#475569" 
                    fontSize={9} 
                    tickLine={false}
                    angle={-15}
                    textAnchor="end" 
                  />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0B1017', borderColor: '#16202C', borderRadius: '0.75rem', fontSize: '12px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="rate" fill="#14B8A6" radius={[4, 4, 0, 0]} name="Avg Meter Rate ($)" />
                  <Bar dataKey="occupancy" fill="#10E599" radius={[4, 4, 0, 0]} name="Avg Occupancy (%)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs">
                Loading district records...
              </div>
            )}
          </div>
        </div>

      </div>

      <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-base font-bold text-white">SFpark Dynamic Pricing Policy Recommendations</h2>
            <p className="text-xs text-slate-400 font-mono">
              Calculated adjustments based on observed demand vs 60% to 80% target availability band
            </p>
          </div>
          <span className="text-xs px-3 py-1 rounded-full bg-[#10E599]/10 text-[#10E599] border border-[#10E599]/30 font-mono">
            Documented Heuristic Algorithm
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#06090D] text-slate-400 border-b border-[#16202C]">
              <tr>
                <th className="py-3 px-4 font-medium whitespace-nowrap">District</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Observed Occupancy</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Historical Avg Rate</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Policy Action</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Adjustment</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Recommended Target Rate</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Availability Objective</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#16202C] text-slate-300">
              {recommendations?.recommendations?.map((row) => {
                const occ = parseFloat(row.observed_avg_occupancy);
                const isSurge = occ > 80;
                const isDiscount = occ < 60;
                const isOptimal = !isSurge && !isDiscount;

                return (
                  <tr key={row.district_name} className="hover:bg-[#121A24]/40 transition-colors">
                    <td className="py-3 px-4 font-bold text-white whitespace-nowrap">{row.district_name}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`font-bold ${isSurge ? 'text-amber-400' : isOptimal ? 'text-[#10E599]' : 'text-teal-400'}`}>
                        {row.observed_avg_occupancy}%
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">${row.observed_avg_rate} / hr</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-sans font-semibold ${
                        isSurge 
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' 
                          : isDiscount
                          ? 'bg-teal-500/10 text-teal-400 border border-teal-500/30'
                          : 'bg-[#10E599]/10 text-[#10E599] border border-[#10E599]/30'
                      }`}>
                        {row.policy_action}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-bold">
                      {row.rate_adjustment > 0 ? `+${row.rate_adjustment}` : row.rate_adjustment < 0 ? `${row.rate_adjustment}` : '$0.00'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-bold text-white">
                      ${row.recommended_rate} / hr
                    </td>
                    <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                      {isSurge ? 'Free up spaces (>80% occupied)' : isDiscount ? 'Attract demand (<60% occupied)' : 'Equilibrium achieved (60-80%)'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ValetTrack Facility Live Dynamic Pricing Section */}
      <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-base font-bold text-white">ValetTrack Facility Dynamic Pricing Recommendations</h2>
            <p className="text-xs text-slate-400 font-mono">
              Live facility occupancy by slot type evaluated against dynamic elasticity pricing tiers
            </p>
          </div>
          <span className="text-xs px-3 py-1 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/30 font-mono">
            Facility Operational Rates (₹)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#06090D] text-slate-400 border-b border-[#16202C]">
              <tr>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Slot Category</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Total Capacity</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Occupied Spaces</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Live Occupancy</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Base Business Rate</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Elasticity Policy</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Adjustment</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Suggested Dynamic Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#16202C] text-slate-300">
              {facilityPricing?.recommendations?.map((item) => (
                <tr key={item.slot_type_id} className="hover:bg-[#121A24]/40 transition-colors">
                  <td className="py-3 px-4 font-bold text-white whitespace-nowrap">{item.type_name}</td>
                  <td className="py-3 px-4 whitespace-nowrap">{item.total_slots} bays</td>
                  <td className="py-3 px-4 whitespace-nowrap">{item.occupied_slots} occupied</td>
                  <td className="py-3 px-4 whitespace-nowrap font-bold text-[#10E599]">{item.occupancy_pct}%</td>
                  <td className="py-3 px-4 whitespace-nowrap">₹{item.baselineRate.toFixed(2)} / hr</td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded text-[11px] font-sans font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                      {item.policyAction}
                    </span>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap font-bold">
                    {item.adjustment > 0 ? `+₹${item.adjustment}` : item.adjustment < 0 ? `-₹${Math.abs(item.adjustment)}` : '₹0.00'}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap font-bold text-[#10E599]">
                    ₹{item.recommendedRate.toFixed(2)} / hr
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Interactive SFpark Dynamic Pricing Policy Simulator */}
      <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <Activity className="w-5 h-5 text-[#10E599]" />
          <div>
            <h2 className="text-base font-bold text-white">SFpark Dynamic Pricing Policy Boundary Simulator</h2>
            <p className="text-xs text-slate-400 font-mono">
              Evaluate exact policy adjustments across boundary conditions (0%, 29.99%, 30%, 59.99%, 60%, 80%, 80.01%, 100%)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">
                Target Occupancy Percentage: <span className="text-[#10E599] font-bold">{testOccupancy}%</span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={testOccupancy}
                onChange={(e) => setTestOccupancy(parseFloat(e.target.value))}
                className="w-full accent-[#10E599]"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
                <span>0%</span>
                <span>30%</span>
                <span>60%</span>
                <span>80%</span>
                <span>100%</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">
                Base Hourly Rate ($):
              </label>
              <input
                type="number"
                min="0.25"
                max="10.00"
                step="0.25"
                value={testBaseRate}
                onChange={(e) => setTestBaseRate(parseFloat(e.target.value) || 2.00)}
                className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-[#10E599]"
              />
            </div>

            <div className="flex flex-wrap gap-1.5 pt-2">
              {[0, 29.99, 30, 59.99, 60, 80, 80.01, 100].map(val => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setTestOccupancy(val)}
                  className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono rounded text-slate-300"
                >
                  {val}%
                </button>
              ))}
            </div>
          </div>

          <div className="md:col-span-2 p-5 bg-[#06090D] border border-[#16202C] rounded-xl space-y-4 font-mono text-xs">
            {(() => {
              const occ = Number(testOccupancy);
              const base = Number(testBaseRate);
              let adj = 0;
              let action = '';
              let tierDesc = '';

              if (occ > 80.0) {
                adj = 0.25;
                action = 'Demand Surge (+25¢)';
                tierDesc = 'High Occupancy (>80%): Increase meter rate to free up curbside availability.';
              } else if (occ >= 60.0 && occ <= 80.0) {
                adj = 0.00;
                action = 'Target Equilibrium (Maintain)';
                tierDesc = 'Optimal Band (60%-80%): Equilibrium achieved; meter rate maintained.';
              } else if (occ >= 30.0 && occ < 60.0) {
                adj = -0.25;
                action = 'Off-Peak Incentive (-25¢)';
                tierDesc = 'Moderate Demand (30%-<60%): Decrease meter rate by $0.25 to attract parkers.';
              } else {
                adj = -0.50;
                action = 'Underutilized Discount (-50¢)';
                tierDesc = 'Low Demand (<30%): Deep discount of -$0.50 to stimulate parking utilization.';
              }

              const raw = base + adj;
              const rec = Math.max(0.25, Math.min(6.00, Number(raw.toFixed(2))));
              const floorTriggered = raw < 0.25;

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Policy Band Triggered:</span>
                    <span className="text-[#10E599] font-bold">{action}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Calculated Adjustment:</span>
                    <span className="font-bold text-white">{adj > 0 ? `+$${adj.toFixed(2)}` : adj < 0 ? `-$${Math.abs(adj).toFixed(2)}` : '$0.00'}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Base Rate Input:</span>
                    <span className="text-white">${base.toFixed(2)} / hr</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Final Recommended Rate:</span>
                    <span className="text-lg font-extrabold text-[#10E599]">${rec.toFixed(2)} / hr</span>
                  </div>
                  <div className="text-[11px] text-slate-400 pt-1">
                    <p className="text-slate-300 font-sans">{tierDesc}</p>
                    {floorTriggered && (
                      <p className="text-amber-400 font-sans mt-1">⚠️ Minimum rate floor applied: rate cannot drop below $0.25/hr.</p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
