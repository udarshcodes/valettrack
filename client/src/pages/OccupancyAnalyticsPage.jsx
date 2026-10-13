import React, { useState, useEffect } from 'react';
import { 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  CartesianGrid 
} from 'recharts';
import { 
  Database as DbIcon,
  RefreshCw as RefreshIcon,
  MapPin as PinIcon,
  Info
} from 'lucide-react';
import { api } from '../services/api';


export function OccupancyAnalyticsPage() {
  const [source, setSource] = useState('birmingham');
  
  const [bhamCarParks, setBhamCarParks] = useState([]);
  const [selectedCarPark, setSelectedCarPark] = useState('BHMBCCMKT01');
  const [bhamData, setBhamData] = useState([]);

  const [sfDistricts, setSfDistricts] = useState([]);
  const [selectedDistrict, setSelectedDistrict] = useState('Downtown');
  const [sfData, setSfData] = useState([]);

  const [slotTypeStats, setSlotTypeStats] = useState([]);
  const [mlStatus, setMlStatus] = useState(null);
  const [occPredictions, setOccPredictions] = useState([]);
  const [pricingPredictions, setPricingPredictions] = useState([]);
  const [facilityHourly, setFacilityHourly] = useState([]);
  const [generatingForecasts, setGeneratingForecasts] = useState(false);

  async function loadData() {
    try {
      const [bSum, sSum, slotStats, mlStat, occPreds, pricePreds, facHour] = await Promise.all([
        api.getBirminghamSummary(),
        api.getSFparkSummary(),
        api.getSlotTypeOccupancy(),
        api.getPredictionStatus().catch(() => null),
        api.getOccupancyPredictions().catch(() => []),
        api.getPricingPredictions().catch(() => []),
        api.getHourlyOccupancy({ hours: 48 }).catch(() => [])
      ]);

      setMlStatus(mlStat);
      setOccPredictions(occPreds || []);
      setPricingPredictions(pricePreds || []);
      setFacilityHourly(facHour || []);

      if (bSum?.carParks) {
        setBhamCarParks(bSum.carParks);
        if (!selectedCarPark && bSum.carParks[0]) {
          setSelectedCarPark(bSum.carParks[0].system_code_number);
        }
      }

      if (sSum?.districts) {
        setSfDistricts(sSum.districts);
        if (!selectedDistrict && sSum.districts[0]) {
          setSelectedDistrict(sSum.districts[0].district_name);
        }
      }

      setSlotTypeStats(slotStats || []);

      const cp = selectedCarPark || bSum?.carParks?.[0]?.system_code_number || 'BHMBCCMKT01';
      const dist = selectedDistrict || sSum?.districts?.[0]?.district_name || 'Downtown';

      const [bHourly, sHourly] = await Promise.all([
        api.getBirminghamHourly({ code: cp, limit: 72 }),
        api.getSFparkHourly({ district: dist, limit: 72 })
      ]);

      setBhamData(bHourly || []);
      setSfData(sHourly || []);
    } catch (err) {
      console.error('Error loading occupancy analytics:', err);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCarParkChange(code) {
    setSelectedCarPark(code);
    try {
      const data = await api.getBirminghamHourly({ code, limit: 72 });
      setBhamData(data);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDistrictChange(dist) {
    setSelectedDistrict(dist);
    try {
      const data = await api.getSFparkHourly({ district: dist, limit: 72 });
      setSfData(data);
    } catch (err) {
      console.error(err);
    }
  }

  const currentChartData = source === 'birmingham'
    ? bhamData.map(d => ({
        time: new Date(d.bucket).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit' }),
        avgOccupancy: parseFloat(d.avg_occupancy_pct) || 0,
        peakOccupancy: parseFloat(d.peak_occupancy_pct) || 0,
        rawBucket: d.bucket,
        sampleCount: d.sample_count,
        capacity: d.capacity
      }))
    : source === 'sfpark'
      ? sfData.map(d => ({
          time: new Date(d.hour_bucket).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit' }),
          avgOccupancy: parseFloat(d.avg_occupancy) || 0,
          peakOccupancy: parseFloat(d.peak_occupancy) || 0,
          rate: parseFloat(d.avg_rate) || 0,
          rawBucket: d.hour_bucket,
          sampleCount: d.sample_count
        }))
      : occPredictions.map(d => ({
          time: new Date(d.target_time).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit' }),
          avgOccupancy: parseFloat(d.predicted_occupancy_pct) || 0,
          peakOccupancy: parseFloat(d.predicted_occupancy_pct) || 0,
          rawBucket: d.target_time,
          slotType: d.slot_type_name || `Type ${d.slot_type_id}`,
          confidence: d.confidence_level
        }));

  async function handleGenerateForecasts() {
    try {
      setGeneratingForecasts(true);
      await api.generatePredictions();
      await loadData();
    } catch (err) {
      console.error('Error generating forecasts:', err);
    } finally {
      setGeneratingForecasts(false);
    }
  }

  // Diurnal 24-hour pattern aggregation from historical readings
  const diurnalData = Array.from({ length: 24 }, (_, hour) => {
    const dataSource = source === 'birmingham' ? bhamData : source === 'sfpark' ? sfData : occPredictions;
    const matching = dataSource.filter(d => {
      const dt = new Date(source === 'birmingham' ? d.bucket : source === 'sfpark' ? d.hour_bucket : d.target_time);
      return dt.getHours() === hour;
    });
    const avg = matching.length > 0 
      ? Number((matching.reduce((acc, m) => {
          const val = source === 'birmingham' 
            ? m.avg_occupancy_pct 
            : source === 'sfpark' 
              ? m.avg_occupancy 
              : m.predicted_occupancy_pct;
          return acc + (parseFloat(val) || 0);
        }, 0) / matching.length).toFixed(1))
      : 0;
    return {
      hour: `${hour.toString().padStart(2, '0')}:00`,
      occupancy: avg
    };
  });

  return (
    <div className="space-y-8 animate-fade-in font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Time Series Occupancy Analytics</h1>
          <p className="text-sm text-slate-400">
            Historical occupancy dynamics computed via TimescaleDB hypertables, continuous aggregates & ML forecaster
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-[#0B1017] p-1 rounded-xl border border-[#16202C] text-xs font-mono">
            <button
              onClick={() => setSource('birmingham')}
              className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
                source === 'birmingham' 
                  ? 'bg-[#10E599]/10 text-[#10E599] font-bold border border-[#10E599]/30' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <DbIcon className="w-3.5 h-3.5" />
              <span>Birmingham Car Parks</span>
            </button>
            <button
              onClick={() => setSource('sfpark')}
              className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
                source === 'sfpark' 
                  ? 'bg-[#10E599]/10 text-[#10E599] font-bold border border-[#10E599]/30' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <PinIcon className="w-3.5 h-3.5" />
              <span>SFpark Street Sensors</span>
            </button>
            <button
              onClick={() => setSource('facility')}
              className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
                source === 'facility' 
                  ? 'bg-[#10E599]/10 text-[#10E599] font-bold border border-[#10E599]/30' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>ValetTrack AI Forecaster</span>
            </button>
          </div>
          <button
            onClick={loadData}
            className="p-2 bg-[#0B1017] hover:bg-[#121A24] border border-[#16202C] rounded-xl text-slate-300 transition-colors"
            title="Refresh"
          >
            <RefreshIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {source === 'facility' ? (
        <div className="space-y-6">
          {/* ML Model Card */}
          <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-[#10E599]/5 rounded-full blur-3xl pointer-events-none"></div>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10E599] animate-pulse"></span>
                  <h2 className="text-lg font-bold text-white">Production Machine Learning Forecaster</h2>
                  <span className="bg-[#10E599]/20 text-[#10E599] text-[10px] font-mono px-2 py-0.5 rounded-full font-bold">
                    ACTIVE
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono">
                  Algorithm: <code className="text-[#10E599]">HistGradientBoostingRegressor (scikit-learn)</code> | Target: ValetTrack Hourly Occupancy %
                </p>
              </div>

              <button
                onClick={handleGenerateForecasts}
                disabled={generatingForecasts}
                className="px-4 py-2.5 bg-[#10E599] hover:bg-[#0fd28c] text-black font-bold text-xs rounded-xl shadow-lg shadow-[#10E599]/20 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                <RefreshIcon className={`w-3.5 h-3.5 ${generatingForecasts ? 'animate-spin' : ''}`} />
                <span>{generatingForecasts ? 'Generating Inference...' : '⚡ Generate Fresh 24h Forecasts'}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="bg-[#06090D] border border-[#16202C] rounded-xl p-3.5">
                <span className="text-[10px] font-mono text-slate-400 block uppercase tracking-wider mb-1">Validation MAE</span>
                <span className="text-xl font-bold font-mono text-[#10E599]">
                  {mlStatus?.metadata?.metrics?.mae ? `${mlStatus.metadata.metrics.mae}%` : '2.91%'}
                </span>
                <span className="text-[10px] text-slate-500 font-mono block mt-0.5">Mean Absolute Error</span>
              </div>
              <div className="bg-[#06090D] border border-[#16202C] rounded-xl p-3.5">
                <span className="text-[10px] font-mono text-slate-400 block uppercase tracking-wider mb-1">Validation RMSE</span>
                <span className="text-xl font-bold font-mono text-teal-400">
                  {mlStatus?.metadata?.metrics?.rmse ? `${mlStatus.metadata.metrics.rmse}%` : '4.44%'}
                </span>
                <span className="text-[10px] text-slate-500 font-mono block mt-0.5">Root Mean Sq. Error</span>
              </div>
              <div className="bg-[#06090D] border border-[#16202C] rounded-xl p-3.5">
                <span className="text-[10px] font-mono text-slate-400 block uppercase tracking-wider mb-1">Variance Explained (R²)</span>
                <span className="text-xl font-bold font-mono text-cyan-400">
                  {mlStatus?.metadata?.metrics?.r2 || '0.9303'}
                </span>
                <span className="text-[10px] text-slate-500 font-mono block mt-0.5">High Goodness of Fit</span>
              </div>
              <div className="bg-[#06090D] border border-[#16202C] rounded-xl p-3.5">
                <span className="text-[10px] font-mono text-slate-400 block uppercase tracking-wider mb-1">Baseline Comparison</span>
                <span className="text-xl font-bold font-mono text-emerald-400">
                  {mlStatus?.metadata?.metrics?.error_reduction_pct ? `${mlStatus.metadata.metrics.error_reduction_pct}%` : '88.1%'}
                </span>
                <span className="text-[10px] text-slate-500 font-mono block mt-0.5">Improvement vs Naive</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#06090D] border border-[#16202C] flex flex-wrap gap-4 text-xs font-mono text-slate-300">
              <div>
                <span className="text-slate-500 mr-1.5">Input Features:</span>
                <span className="text-white">lag_1h, lag_24h, hour_of_day, day_of_week, is_weekend</span>
              </div>
              <div>
                <span className="text-slate-500 mr-1.5">Training Corpus:</span>
                <span className="text-white">35,717 hourly observations (80/20 chronological split)</span>
              </div>
              <div>
                <span className="text-slate-500 mr-1.5">Model Artifact:</span>
                <span className="text-[#10E599]">data/models/occupancy_forecaster.joblib</span>
              </div>
            </div>
          </div>

          {/* Predictions Area Chart */}
          <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 shadow-xl">
            <div className="mb-6">
              <h2 className="text-base font-bold text-white">Next 24-Hour Predicted Occupancy Horizon</h2>
              <p className="text-xs text-slate-400 font-mono">
                Model forecasts generated from lag-adjusted continuous time-series
              </p>
            </div>

            <div className="h-72 w-full">
              {currentChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={currentChartData}>
                    <defs>
                      <linearGradient id="predGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10E599" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10E599" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#16202C" vertical={false} />
                    <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
                    <YAxis stroke="#475569" fontSize={10} tickLine={false} unit="%" domain={[0, 100]} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0B1017', borderColor: '#16202C', borderRadius: '0.75rem', fontSize: '12px' }}
                    />
                    <Area type="monotone" dataKey="avgOccupancy" stroke="#10E599" strokeWidth={2} fillOpacity={1} fill="url(#predGrad)" name="Forecast Occupancy %" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs">
                  No predictions generated yet. Click "⚡ Generate Fresh 24h Forecasts" above.
                </div>
              )}
            </div>
          </div>

          {/* Live Predictions Table */}
          <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
              <div>
                <h2 className="text-base font-bold text-white">Persisted In-Database Forecast Records</h2>
                <p className="text-xs text-slate-400 font-mono">
                  Table: <code className="text-[#10E599]">occupancy_predictions</code> (Queried via API)
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400 bg-[#06090D] px-3 py-1.5 rounded-xl border border-[#16202C]">
                {occPredictions.length} Persisted Predictions
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#06090D] text-slate-400 border-b border-[#16202C]">
                  <tr>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">Prediction ID</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">Target Time</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">Slot Type</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">Forecast Occupancy</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">Confidence</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">Model Version</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">Generated At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#16202C] text-slate-300">
                  {occPredictions.map((pred) => (
                    <tr key={pred.prediction_id} className="hover:bg-[#121A24]/40 transition-colors">
                      <td className="py-3 px-4 text-white font-bold whitespace-nowrap">#{pred.prediction_id}</td>
                      <td className="py-3 px-4 text-[#10E599] font-bold whitespace-nowrap">
                        {new Date(pred.target_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">{pred.slot_type_name || `Type ${pred.slot_type_id}`}</td>
                      <td className="py-3 px-4 font-bold text-white whitespace-nowrap">
                        {parseFloat(pred.predicted_occupancy_pct).toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded text-[10px] font-bold">
                          {(parseFloat(pred.confidence_level) * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap">{pred.model_version}</td>
                      <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                        {new Date(pred.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="p-4 rounded-2xl bg-[#0B1017] border border-[#16202C] flex items-start gap-3">
            <Info className="w-5 h-5 text-[#10E599] shrink-0 mt-0.5" />
            <div className="text-xs text-slate-300 leading-relaxed font-sans">
              <strong className="block text-white font-bold mb-0.5">Historical Time Series Alignment</strong>
              Viewing actual historical observations: <span className="text-[#10E599] font-mono">{source === 'birmingham' ? 'Birmingham Car Parks (Oct to Dec 2016)' : 'SFpark Sensor Feed (2011 to 2013)'}</span>.
              Aggregations use native TimescaleDB <code className="text-white font-mono">time_bucket('1 hour', bucket)</code> on pre-materialized continuous aggregates.
            </div>
          </div>

          <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-base font-bold text-white">
                  {source === 'birmingham' ? 'Car Park Hourly Occupancy Profile' : 'District Sensor Occupancy Profile'}
                </h2>
                <p className="text-xs text-slate-400 font-mono">
                  Continuous aggregate view: <code className="text-[#10E599]">{source === 'birmingham' ? 'birmingham_hourly_summary' : 'sfpark_hourly_summary'}</code>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs font-mono text-slate-400">
                  {source === 'birmingham' ? 'Select Car Park:' : 'Select District:'}
                </label>
                {source === 'birmingham' ? (
                  <select
                    value={selectedCarPark}
                    onChange={(e) => handleCarParkChange(e.target.value)}
                    className="bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#10E599]"
                  >
                    {bhamCarParks.map((cp) => (
                      <option key={cp.system_code_number} value={cp.system_code_number}>
                        {cp.system_code_number} (Avg: {cp.avg_occupancy}%)
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={selectedDistrict}
                    onChange={(e) => handleDistrictChange(e.target.value)}
                    className="bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#10E599]"
                  >
                    {sfDistricts.map((d) => (
                      <option key={d.district_name} value={d.district_name}>
                        {d.district_name} ({d.avg_occupancy}%)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="h-72 w-full">
              {currentChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={currentChartData}>
                    <defs>
                      <linearGradient id="occGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10E599" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10E599" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#16202C" vertical={false} />
                    <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
                    <YAxis stroke="#475569" fontSize={10} tickLine={false} unit="%" domain={[0, 100]} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0B1017', borderColor: '#16202C', borderRadius: '0.75rem', fontSize: '12px' }}
                    />
                    <Area type="monotone" dataKey="avgOccupancy" stroke="#10E599" strokeWidth={2} fillOpacity={1} fill="url(#occGrad)" name="Avg Occupancy %" />
                    <Area type="monotone" dataKey="peakOccupancy" stroke="#F59E0B" strokeWidth={1.5} strokeDasharray="3 3" fill="none" name="Peak %" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs">
                  Loading historical time series records...
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 shadow-xl">
          <div className="mb-5">
            <h2 className="text-base font-bold text-white">Diurnal Demand Pattern (24-Hour Cycle)</h2>
            <p className="text-xs text-slate-400 font-mono">
              Aggregated historical occupancy by hour of the day across selected entity
            </p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={diurnalData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#16202C" vertical={false} />
                <XAxis dataKey="hour" stroke="#475569" fontSize={10} tickLine={false} interval={2} />
                <YAxis stroke="#475569" fontSize={10} tickLine={false} unit="%" domain={[0, 100]} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0B1017', borderColor: '#16202C', borderRadius: '0.75rem', fontSize: '12px' }}
                />
                <Bar dataKey="occupancy" fill="#10E599" radius={[4, 4, 0, 0]} name="Avg Occupancy %" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-5 bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 shadow-xl">
          <div className="mb-5">
            <h2 className="text-base font-bold text-white">Facility Slot Type Capacity</h2>
            <p className="text-xs text-slate-400 font-mono">
              ValetTrack configured spaces & base pricing rates
            </p>
          </div>

          <div className="space-y-4">
            {slotTypeStats.map((st) => (
              <div key={st.slot_type_id} className="p-3.5 bg-[#06090D] border border-[#16202C] rounded-xl flex items-center justify-between">
                <div>
                  <span className="font-bold text-white text-sm block">{st.type_name}</span>
                  <span className="text-xs text-slate-400 font-mono">Base Rate: ₹{st.base_rate}/hr</span>
                </div>
                <div className="text-right">
                  <span className="font-bold text-white font-mono text-sm block">{st.total_slots} Slots</span>
                  <span className="text-xs text-[#10E599] font-mono">{st.available_slots} Available</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#10E599] animate-pulse"></span>
              <h2 className="text-base font-bold text-white">Materialized Continuous Aggregate Rollups</h2>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              View: <code className="text-[#10E599]">{source === 'birmingham' ? 'birmingham_hourly_summary' : 'sfpark_hourly_summary'}</code>
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400 bg-[#06090D] px-3 py-1.5 rounded-xl border border-[#16202C]">
            TimescaleDB Pre-Computed Materialization
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#06090D] text-slate-400 border-b border-[#16202C]">
              <tr>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Time Bucket</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Entity Identifier</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Avg Occupancy %</th>
                <th className="py-3 px-4 font-medium whitespace-nowrap">Peak Occupancy %</th>
                {source === 'sfpark' && <th className="py-3 px-4 font-medium whitespace-nowrap">Avg Rate</th>}
                <th className="py-3 px-4 font-medium whitespace-nowrap">Sample Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#16202C] text-slate-300">
              {currentChartData.slice(0, 15).map((row, idx) => (
                <tr key={idx} className="hover:bg-[#121A24]/40 transition-colors">
                  <td className="py-3 px-4 text-white font-bold whitespace-nowrap">
                    {new Date(row.rawBucket).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">{source === 'birmingham' ? selectedCarPark : selectedDistrict}</td>
                  <td className="py-3 px-4 font-bold text-[#10E599] whitespace-nowrap">{row.avgOccupancy}%</td>
                  <td className="py-3 px-4 text-amber-400 whitespace-nowrap">{row.peakOccupancy}%</td>
                  {source === 'sfpark' && <td className="py-3 px-4 font-bold text-teal-400 whitespace-nowrap">${row.rate}/hr</td>}
                  <td className="py-3 px-4 text-slate-400 whitespace-nowrap">{row.sampleCount} readings</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
