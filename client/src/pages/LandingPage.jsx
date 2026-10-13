import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Hls from 'hls.js';
import { 
  ArrowRight, 
  Car, 
  CheckCircle2, 
  Clock, 
  Database, 
  Layers, 
  ShieldCheck, 
  Zap, 
  Menu,
  X,
  ChevronRight
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { api } from '../services/api';

export function LandingPage() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [slots, setSlots] = useState([]);
  const [chartData, setChartData] = useState([]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const streamUrl = 'https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8';

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: false,
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });

      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {});
      });
    }
  }, []);

  const [datasetSummary, setDatasetSummary] = useState(null);

  useEffect(() => {
    async function loadLandingData() {
      try {
        const [sumRes, slotsRes, dsRes, bhamHourly] = await Promise.all([
          api.getDashboardSummary(),
          api.getSlots(),
          api.getDatasetsGlobalSummary(),
          api.getBirminghamHourly({ limit: 12 })
        ]);
        setSummary(sumRes);
        setSlots(slotsRes.slice(0, 16));
        setDatasetSummary(dsRes);
        
        if (bhamHourly && bhamHourly.length > 0) {
          const formatted = bhamHourly.map(item => ({
            time: new Date(item.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            occupancy: parseFloat(item.avg_occupancy_pct) || 0,
            peak: parseFloat(item.peak_occupancy_pct) || 0
          }));
          setChartData(formatted);
        }
      } catch (err) {
        console.error('Error fetching landing page data:', err);
      }
    }
    loadLandingData();
  }, []);

  const metrics = summary?.metrics || {
    totalSlots: slots.length,
    availableSlots: slots.filter(s => s.status === 'Available').length,
    occupiedSlots: slots.filter(s => s.status === 'Occupied').length,
    reservedSlots: slots.filter(s => s.status === 'Reserved').length,
    occupancyPercentage: slots.length > 0 ? Number(((slots.filter(s => s.status === 'Occupied').length / slots.length) * 100).toFixed(1)) : 0,
    activeTickets: 0,
    totalRevenue: 0
  };


  return (
    <div className="relative min-h-screen bg-[#070b0a] text-white selection:bg-[#5ed29c]/30 selection:text-[#5ed29c] font-sans overflow-x-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          className="w-full h-full object-cover opacity-90 transition-opacity duration-500"
          style={{ filter: 'brightness(1.2) contrast(1.15) saturate(1.2)' }}
        />
        <div 
          className="absolute inset-0 pointer-events-none bg-[#070b0a]/30" 
        />
        <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[700px] sm:w-[950px] h-[360px] mix-blend-screen opacity-70">
          <svg viewBox="0 0 950 360" className="w-full h-full">
            <defs>
              <filter id="valetEllipseGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="25" />
              </filter>
              <radialGradient id="valetCyanGreenGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#00f5a0" stopOpacity="0.45" />
                <stop offset="40%" stopColor="#00d9f5" stopOpacity="0.25" />
                <stop offset="80%" stopColor="#5ed29c" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#070b0a" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse cx="475" cy="160" rx="420" ry="120" fill="url(#valetCyanGreenGlow)" filter="url(#valetEllipseGlow)" />
          </svg>
        </div>
      </div>

      <header className="sticky top-0 z-50 w-full bg-[#070b0a]/75 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center text-[#070b0a] font-extrabold text-lg tracking-tighter shadow-[0_0_15px_rgba(255,255,255,0.2)]">
              VT
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-xl tracking-tight text-white group-hover:text-[#5ed29c] transition-colors leading-none">
                ValetTrack
              </span>
              <span className="text-[10px] text-white/50 font-mono tracking-widest uppercase mt-1">
                TimescaleDB Core
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-[16px] font-sans text-white/90">
            {[
              { label: 'FEATURES', href: '#features' },
              { label: 'HOW IT WORKS', href: '#how-it-works' },
              { label: 'ANALYTICS', href: '#analytics' },
              { label: 'DATASETS', href: '#datasets' },
              { label: 'ARCHITECTURE', href: '#technology' },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="tracking-wide hover:text-[#5ed29c] transition-colors font-medium text-sm lg:text-[15px]"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden sm:flex items-center gap-3">
            <Link
              to="/dashboard"
              className="px-5 py-2.5 rounded-full bg-[#5ed29c] hover:bg-[#4ec08b] text-[#070b0a] text-xs font-bold uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(94,210,156,0.3)] flex items-center gap-2"
            >
              <span>Live Dashboard</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-white hover:text-[#5ed29c] transition-colors"
            aria-label="Toggle Menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-[#070b0a]/95 backdrop-blur-xl flex flex-col justify-center items-center gap-8 md:hidden p-6 animate-fade-in">
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="absolute top-6 right-6 p-2 text-white hover:text-[#5ed29c]"
          >
            <X className="w-7 h-7" />
          </button>
          
          <nav className="flex flex-col items-center gap-6 text-lg font-sans tracking-wide">
            {[
              { label: 'FEATURES', href: '#features' },
              { label: 'HOW IT WORKS', href: '#how-it-works' },
              { label: 'ANALYTICS', href: '#analytics' },
              { label: 'DATASETS', href: '#datasets' },
              { label: 'ARCHITECTURE', href: '#technology' },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className="hover:text-[#5ed29c] transition-colors font-medium"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex flex-col items-center gap-3 w-full max-w-xs pt-4 border-t border-white/10">
            <Link
              to="/dashboard"
              onClick={() => setMobileMenuOpen(false)}
              className="w-full py-3 rounded-full bg-[#5ed29c] text-[#070b0a] font-bold uppercase text-center text-sm"
            >
              Open Live Dashboard
            </Link>
          </div>
        </div>
      )}

      <section className="relative z-10 min-h-[90vh] flex items-center justify-center overflow-hidden">
        <div className="relative z-10 max-w-7xl mx-auto px-6 pt-16 pb-20 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            
            <div className="lg:col-span-7 flex flex-col items-start justify-center">
              <div className="space-y-6 max-w-2xl">
                <h1 className="font-extrabold uppercase tracking-tight text-[40px] sm:text-[58px] lg:text-[72px] leading-[1.05] text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]">
                  PARKING, ORCHESTRATED<span className="text-[#5ed29c]">.</span>
                </h1>

                <p className="text-[14px] text-white/90 max-w-[512px] leading-relaxed font-sans drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">
                  Smarter slot allocation. Predictive occupancy. Dynamic pricing. One intelligent parking system powered by TimescaleDB time series hypertables.
                </p>

                <div className="pt-2 flex flex-wrap items-center gap-4">
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center gap-2.5 px-8 py-4 rounded-full bg-[#5ed29c] hover:bg-[#4ec08b] text-[#070b0a] font-bold text-sm uppercase tracking-wider transition-all shadow-[0_0_25px_rgba(94,210,156,0.35)] hover:shadow-[0_0_35px_rgba(94,210,156,0.5)] group"
                  >
                    <span>Launch Dashboard</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </Link>

                  <a
                    href="#features"
                    className="inline-flex items-center gap-2 px-6 py-4 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 text-white/90 text-sm font-medium transition-all"
                  >
                    <span>Explore Features</span>
                  </a>
                </div>

                <div className="pt-6 grid grid-cols-3 gap-4 border-t border-white/10 text-left">
                  <div>
                    <div className="text-xl sm:text-2xl font-bold font-mono text-white">
                      {datasetSummary?.totalObservations ? `${(datasetSummary.totalObservations).toLocaleString()}+` : '7.9M+'}
                    </div>
                    <div className="text-xs text-white/50">Real observations</div>
                  </div>
                  <div>
                    <div className="text-xl sm:text-2xl font-bold font-mono text-[#5ed29c]">ACID</div>
                    <div className="text-xs text-white/50">{metrics.totalSlots} Managed spots</div>
                  </div>
                  <div>
                    <div className="text-xl sm:text-2xl font-bold font-mono text-white">
                      {datasetSummary?.sfpark?.entities_count ? `${datasetSummary.sfpark.entities_count} Districts` : '21 Districts'}
                    </div>
                    <div className="text-xs text-white/50">Benchmark sensors</div>
                  </div>
                </div>


              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="bg-[#0B1017]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl relative overflow-hidden glow-lime">
                <div className="flex items-center justify-between pb-4 border-b border-white/10">
                  <div>
                    <span className="text-xs font-mono text-[#5ed29c] uppercase tracking-wider">Facility Live Status</span>
                    <h2 className="text-base font-bold text-white">Main Parking Grid</h2>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-[#5ed29c]/10 text-[#5ed29c] border border-[#5ed29c]/30 text-xs font-mono flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#5ed29c] animate-pulse"></span>
                    {metrics.occupancyPercentage}% Occupied
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2.5 my-5">
                  {slots.slice(0, 16).map((slot) => {
                    const isAvail = slot.status === 'Available';
                    const isOcc = slot.status === 'Occupied';

                    return (
                      <div
                        key={slot.slot_id}
                        className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                          isAvail
                            ? 'bg-[#5ed29c]/5 border-[#5ed29c]/30 hover:border-[#5ed29c]'
                            : isOcc
                            ? 'bg-amber-500/10 border-amber-500/40'
                            : 'bg-indigo-500/10 border-indigo-500/40'
                        }`}
                        onClick={() => navigate('/dashboard/slots')}
                      >
                        <div className="text-[10px] font-mono text-white/50">P-{slot.slot_id}</div>
                        <div className={`text-xs font-bold mt-1 ${
                          isAvail ? 'text-[#5ed29c]' : isOcc ? 'text-amber-400' : 'text-indigo-400'
                        }`}>
                          {isAvail ? 'OPEN' : isOcc ? 'BUSY' : 'RSVD'}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="bg-[#070b0a] border border-white/10 rounded-xl p-3 grid grid-cols-3 gap-2 text-center text-xs font-mono">
                  <div>
                    <span className="text-white/40 block text-[10px]">AVAILABLE</span>
                    <span className="text-[#5ed29c] font-bold text-sm">{metrics.availableSlots}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[10px]">OCCUPIED</span>
                    <span className="text-amber-400 font-bold text-sm">{metrics.occupiedSlots}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[10px]">REVENUE</span>
                    <span className="text-white font-bold text-sm">₹{metrics.totalRevenue}</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs text-white/50">
                  <span>Regular (₹50) • Covered (₹80) • EV (₹120)</span>
                  <Link to="/dashboard/slots" className="text-[#5ed29c] hover:underline flex items-center gap-1 font-medium">
                    Expand <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      <section id="features" className="relative z-10 py-24 border-t border-white/10 bg-[#070b0a]/60 backdrop-blur-[2px]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
            <span className="text-xs font-mono uppercase tracking-widest text-[#5ed29c]">Core Capabilities</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
              Engineered for Precision Parking Operations
            </h2>
            <p className="text-white/60 text-base">
              ValetTrack eliminates parking congestion and revenue leakage using ACID compliant transactions, 
              automated stay duration rounding, and continuous time series rollups.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-[#0B1017]/80 backdrop-blur-md border border-white/10 rounded-2xl p-6 hover:border-[#5ed29c]/40 hover:bg-[#0B1017]/90 transition-all group">
              <div className="w-12 h-12 rounded-xl bg-[#5ed29c]/10 border border-[#5ed29c]/30 flex items-center justify-center text-[#5ed29c] mb-5 group-hover:scale-105 transition-transform">
                <Car className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Smart Slot Allocation</h3>
              <p className="text-sm text-white/60 leading-relaxed">
                Prevents double booking via PostgreSQL row locking (<code className="text-white/80">FOR UPDATE</code>) and database triggers. Allocates Regular, Covered, and EV spots dynamically.
              </p>
            </div>

            <div className="bg-[#0B1017] border border-white/10 rounded-2xl p-6 hover:border-[#5ed29c]/40 transition-all group">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-5 group-hover:scale-105 transition-transform">
                <Clock className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Automated Billing Rules</h3>
              <p className="text-sm text-white/60 leading-relaxed">
                Enforces project billing rules: duration rounded up to full hours (<code className="text-white/80">CEIL</code>), 1-hour minimum charge, and base rate multiplication.
              </p>
            </div>

            <div className="bg-[#0B1017] border border-white/10 rounded-2xl p-6 hover:border-[#5ed29c]/40 transition-all group">
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400 mb-5 group-hover:scale-105 transition-transform">
                <Database className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">TimescaleDB Hypertables</h3>
              <p className="text-sm text-white/60 leading-relaxed">
                Stores high frequency sensor readings partitioned across time chunks. Demonstrates scalable time series storage and query velocity.
              </p>
            </div>

            <div className="bg-[#0B1017] border border-white/10 rounded-2xl p-6 hover:border-[#5ed29c]/40 transition-all group">
              <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-5 group-hover:scale-105 transition-transform">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Dynamic Surge Pricing</h3>
              <p className="text-sm text-white/60 leading-relaxed">
                Integrates ML prediction feeds to suggest dynamic pricing based on anticipated facility occupancy while preserving base-rate integrity for actual ticket billing.
              </p>
            </div>

            <div className="bg-[#0B1017] border border-white/10 rounded-2xl p-6 hover:border-[#5ed29c]/40 transition-all group">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-5 group-hover:scale-105 transition-transform">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Continuous Aggregates</h3>
              <p className="text-sm text-white/60 leading-relaxed">
                Pre-materializes hourly rollups (<code className="text-white/80">hourly_occupancy_summary</code>) with automatic refresh policies, providing instant analytical dashboard loading.
              </p>
            </div>

            <div className="bg-[#0B1017] border border-white/10 rounded-2xl p-6 hover:border-[#5ed29c]/40 transition-all group">
              <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-5 group-hover:scale-105 transition-transform">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">BCNF Normalized Core</h3>
              <p className="text-sm text-white/60 leading-relaxed">
                Fully normalized relational schema with verified Boyce-Codd Normal Form decomposition, preventing update redundancies and transitive dependencies.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="analytics" className="relative z-10 py-24 border-t border-white/10 bg-[#070b0a]/60 backdrop-blur-[2px]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-5 space-y-5">
              <span className="text-xs font-mono uppercase tracking-widest text-[#5ed29c]">Time Series Intelligence</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
                Live Occupancy Trends & Peak Detection
              </h2>
              <p className="text-white/65 text-sm sm:text-base leading-relaxed">
                Using TimescaleDB's native <code className="text-[#5ed29c]">time_bucket()</code> function, ValetTrack dynamically groups 15-minute sensor intervals into hourly rolling demand profiles.
              </p>
              
              <ul className="space-y-3 pt-2 text-sm text-white/80">
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#5ed29c]" />
                  <span>2,016 timestamped readings across 7 days</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#5ed29c]" />
                  <span>Real time continuous aggregate materialized rollups</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#5ed29c]" />
                  <span>Accurate peak hour demand curve modeling</span>
                </li>
              </ul>

              <div className="pt-4">
                <Link
                  to="/dashboard/occupancy"
                  className="inline-flex items-center gap-2 text-[#5ed29c] hover:underline font-semibold text-sm"
                >
                  View full analytics suite <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            <div className="lg:col-span-7 bg-[#0B1017]/85 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-sm font-bold text-white">Facility Occupancy Profile (Past 24 Hours)</h3>
                  <p className="text-xs text-white/50">Aggregated via time_bucket('1 hour', reading_time)</p>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="flex items-center gap-1.5 text-[#5ed29c]">
                    <span className="w-2 h-2 rounded-full bg-[#5ed29c]"></span> Avg Occ
                  </span>
                  <span className="flex items-center gap-1.5 text-amber-400">
                    <span className="w-2 h-2 rounded-full bg-amber-400"></span> Peak Occ
                  </span>
                </div>
              </div>

              <div className="h-64 w-full">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="limeGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#5ed29c" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#5ed29c" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="time" stroke="#475569" fontSize={11} tickLine={false} />
                      <YAxis stroke="#475569" fontSize={11} tickLine={false} unit="%" domain={[0, 100]} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0B1017', borderColor: '#16202C', borderRadius: '0.75rem', fontSize: '12px' }}
                      />
                      <Area type="monotone" dataKey="occupancy" stroke="#5ed29c" strokeWidth={2} fillOpacity={1} fill="url(#limeGrad)" />
                      <Area type="monotone" dataKey="peak" stroke="#F59E0B" strokeWidth={1.5} strokeDasharray="3 3" fill="none" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-white/50 text-sm font-mono">
                    Loading time series records...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="datasets" className="relative z-10 py-24 border-t border-white/10 bg-[#070b0a]/65 backdrop-blur-[2px]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
            <span className="text-xs font-mono uppercase tracking-widest text-[#5ed29c]">Benchmark Datasets</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
              Integrated Real World Parking Datasets
            </h2>
            <p className="text-white/60 text-base">
              ValetTrack benchmarks its local facility against two massive open parking datasets imported directly into TimescaleDB hypertables.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-[#0B1017]/85 backdrop-blur-md border border-white/10 rounded-2xl p-6 sm:p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-mono px-2.5 py-1 rounded bg-[#5ed29c]/10 text-[#5ed29c] border border-[#5ed29c]/30">
                    UCI ML Repository
                  </span>
                  <span className="text-xs font-mono text-white/50">
                    {datasetSummary?.birmingham?.total_readings ? `${parseInt(datasetSummary.birmingham.total_readings).toLocaleString()} rows` : '35,717 rows'}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Parking Birmingham Car Parks</h3>
                <p className="text-sm text-white/60 mb-4 leading-relaxed">
                  Real sensor data monitoring 30 distinct car parks in Birmingham (UK) over 2.5 months. Includes capacity, occupancy, and sanitized glitch corrections.
                </p>
                <div className="grid grid-cols-2 gap-3 p-3 bg-[#070b0a] rounded-xl border border-white/10 text-xs font-mono mb-6">
                  <div>
                    <span className="text-white/40 block">CAR PARKS</span>
                    <span className="text-white font-bold">{datasetSummary?.birmingham?.entities_count || 30} Monitored</span>
                  </div>
                  <div>
                    <span className="text-white/40 block">AVG OCCUPANCY</span>
                    <span className="text-[#5ed29c] font-bold">{datasetSummary?.birmingham?.avg_occupancy || 45.8}%</span>
                  </div>
                </div>
              </div>
              <Link
                to="/dashboard/datasets"
                className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-white border border-white/10 font-semibold rounded-xl text-center text-sm transition-all"
              >
                Inspect Birmingham Analytics
              </Link>
            </div>

            <div className="bg-[#0B1017]/85 backdrop-blur-md border border-white/10 rounded-2xl p-6 sm:p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-mono px-2.5 py-1 rounded bg-teal-500/10 text-teal-400 border border-teal-500/30">
                    City of San Francisco
                  </span>
                  <span className="text-xs font-mono text-white/50">
                    {datasetSummary?.sfpark?.total_readings ? `${parseInt(datasetSummary.sfpark.total_readings).toLocaleString()} rows` : '7.9M+ rows'}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">SFpark Street Sensor Dataset</h3>
                <p className="text-sm text-white/60 mb-4 leading-relaxed">
                  Sensor readings from San Francisco districts (Downtown, Fillmore, Civic Center, South Embarcadero). Includes hourly occupancy and dynamic meter rates.
                </p>
                <div className="grid grid-cols-2 gap-3 p-3 bg-[#070b0a] rounded-xl border border-white/10 text-xs font-mono mb-6">
                  <div>
                    <span className="text-white/40 block">KEY DISTRICTS</span>
                    <span className="text-white font-bold">{datasetSummary?.sfpark?.entities_count || 21} Monitored</span>
                  </div>
                  <div>
                    <span className="text-white/40 block">AVG METER RATE</span>
                    <span className="text-teal-400 font-bold">${datasetSummary?.sfpark?.avg_rate || '3.66'} / hr</span>
                  </div>
                </div>
              </div>
              <Link
                to="/dashboard/datasets"
                className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-white border border-white/10 font-semibold rounded-xl text-center text-sm transition-all"
              >
                Inspect SFpark Analytics
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="relative z-10 py-24 border-t border-white/10 bg-[#070b0a]/65 backdrop-blur-[2px]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
            <span className="text-xs font-mono uppercase tracking-widest text-[#5ed29c]">Ticket Lifecycle</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">How ValetTrack Orchestrates Parking</h2>
            <p className="text-white/60 text-base">
              A transactional flow guaranteeing slot integrity from vehicle entry to billing release.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-6 text-center">
            {[
              { step: '01', title: 'Vehicle Check In', desc: 'Owner and vehicle identified; eligible slot type determined.' },
              { step: '02', title: 'Atomic Allocation', desc: 'Slot locked via row-lock; verified Available before ticket insert.' },
              { step: '03', title: 'Valet Ticket Open', desc: 'Trigger automatically marks slot Occupied; entry timestamp stamped.' },
              { step: '04', title: 'Duration & Billing', desc: 'Stay rounded up to full hours (CEIL); base rate multiplied (min 1 hr).' },
              { step: '05', title: 'Slot Release', desc: 'Exit timestamp stamped; trigger instantly restores slot to Available.' },
            ].map((s, idx) => (
              <div key={idx} className="bg-[#0B1017]/80 backdrop-blur-md border border-white/10 rounded-2xl p-5 relative">
                <div className="w-8 h-8 rounded-full bg-[#5ed29c]/10 text-[#5ed29c] font-mono text-xs font-bold flex items-center justify-center mx-auto mb-3">
                  {s.step}
                </div>
                <h4 className="text-sm font-bold text-white mb-1.5">{s.title}</h4>
                <p className="text-xs text-white/50 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="technology" className="relative z-10 py-24 border-t border-white/10 bg-[#070b0a]/60 backdrop-blur-[2px]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <span className="text-xs font-mono uppercase tracking-widest text-[#5ed29c]">Technology Stack</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
                Modern Relational Core + Time Series Scale
              </h2>
              <p className="text-white/60 text-base leading-relaxed">
                Rather than treating all entities alike or introducing disparate databases, ValetTrack combines normalized BCNF relational tables for transactional operations with TimescaleDB hypertables for time series analytics.
              </p>

              <div className="space-y-4 pt-2">
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[#5ed29c]/10 border border-[#5ed29c]/30 flex items-center justify-center text-[#5ed29c] shrink-0 font-bold">
                    TS
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">TimescaleDB Hypertables</h4>
                    <p className="text-xs text-white/50">Automated time-based chunk partitioning without complex manual maintenance.</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0 font-bold">
                    PG
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">PostgreSQL 16 Engine</h4>
                    <p className="text-xs text-white/50">ACID guarantees, foreign key cascade protection, and stored procedures.</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 font-bold">
                    JS
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Node.js, Express & React</h4>
                    <p className="text-xs text-white/50">Full stack architecture with Zod validation and Recharts visualization.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 bg-[#0B1017]/90 backdrop-blur-md border border-white/10 rounded-2xl p-6 font-mono text-xs text-white/80 overflow-x-auto">
              <div className="text-white/40 pb-3 border-b border-white/10 flex items-center justify-between">
                <span>timescaledb_query.sql</span>
                <span className="text-[#5ed29c]">Continuous Aggregate</span>
              </div>
              <pre className="pt-4 text-white/80 leading-relaxed">
{`-- Pre-materialized 1-hour rollup
CREATE MATERIALIZED VIEW hourly_occupancy_summary
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', reading_time) AS bucket,
    slot_type_id,
    ROUND(AVG(occupancy_pct), 2) AS avg_occupancy_pct,
    ROUND(MAX(occupancy_pct), 2) AS peak_occupancy_pct,
    COUNT(*) AS sample_count
FROM occupancy_readings
GROUP BY bucket, slot_type_id;`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/10 bg-[#070b0a]/80 backdrop-blur-md py-12 text-xs text-white/50">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-[#5ed29c]/10 text-[#5ed29c] font-bold flex items-center justify-center text-xs">
              V
            </div>
            <span className="font-semibold text-white">ValetTrack</span>
            <span>: Relational Database & TimescaleDB System</span>
          </div>
          <div className="text-center sm:text-right">
            <span>Academic DBMS Assessment Implementation</span>
            <span className="block text-white/40 mt-1">Docker Compose • Localhost • TimescaleDB 2.30</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
