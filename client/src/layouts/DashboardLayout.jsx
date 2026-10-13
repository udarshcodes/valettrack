import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Grid, 
  Receipt, 
  Car, 
  Users, 
  TrendingUp, 
  Zap, 
  Database, 
  ArrowLeft,
  Activity,
  PlusCircle,
  Menu,
  X
} from 'lucide-react';
import { api } from '../services/api';

export function DashboardLayout() {
  const [health, setHealth] = useState({ connected: false, loading: true });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function checkHealth() {
      try {
        const data = await api.getHealth();
        setHealth({ connected: data.status === 'UP', loading: false, data: data.database });
      } catch (err) {
        setHealth({ connected: false, loading: false, error: err.message });
      }
    }
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { to: '/dashboard', end: true, label: 'Overview', icon: LayoutDashboard },
    { to: '/dashboard/slots', label: 'Parking Grid', icon: Grid },
    { to: '/dashboard/tickets', label: 'Tickets & Billing', icon: Receipt },
    { to: '/dashboard/vehicles', label: 'Vehicles & Owners', icon: Car },
    { to: '/dashboard/staff', label: 'Valet Staff', icon: Users },
    { to: '/dashboard/occupancy', label: 'Occupancy Analytics', icon: TrendingUp },
    { to: '/dashboard/pricing', label: 'Dynamic Pricing', icon: Zap },
    { to: '/dashboard/datasets', label: 'Sensor Datasets', icon: Database },
  ];

  return (
    <div className="flex h-screen bg-[#06090D] text-slate-100 overflow-hidden font-sans">
      <aside className="hidden lg:flex flex-col w-64 bg-[#0B1017] border-r border-[#16202C] shrink-0">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#16202C]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#10E599]/10 border border-[#10E599]/40 flex items-center justify-center text-[#10E599] font-bold text-lg shadow-[0_0_12px_rgba(16,229,153,0.25)]">
              V
            </div>
            <div>
              <span className="font-bold tracking-tight text-white text-base">ValetTrack</span>
              <span className="block text-[10px] text-slate-400 font-mono tracking-wider uppercase">TimescaleDB Core</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `
                  flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all
                  ${isActive 
                    ? 'bg-[#10E599]/10 text-[#10E599] border border-[#10E599]/25 shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#121A24]'
                  }
                `}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#16202C] bg-[#090D13]">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${health.connected ? 'bg-[#10E599] animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-slate-300 font-medium font-mono">
                {health.loading ? 'Checking DB...' : health.connected ? 'TimescaleDB 2.30' : 'DB Disconnected'}
              </span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">PG 16</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <NavLink
              to="/"
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Portal</span>
            </NavLink>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 px-6 bg-[#0B1017]/80 backdrop-blur-md border-b border-[#16202C] flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <Activity className="w-3.5 h-3.5 text-[#10E599]" />
              <span>Cluster Status: <strong className="text-slate-200">Local Docker Compose</strong></span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard/tickets?action=open')}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-[#10E599] hover:bg-[#05D688] text-slate-950 text-xs font-semibold rounded-lg shadow-[0_0_15px_rgba(16,229,153,0.25)] transition-all"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Park Vehicle</span>
            </button>
          </div>
        </header>

        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-40 bg-black/80 flex flex-col pt-16 px-6 pb-6">
            <nav className="flex-1 space-y-1 py-4">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) => `
                      flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium
                      ${isActive ? 'bg-[#10E599]/10 text-[#10E599] border border-[#10E599]/30' : 'text-slate-300 hover:bg-slate-800'}
                    `}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>
            <NavLink
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2 text-sm text-slate-400 py-3"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Return to Landing Page</span>
            </NavLink>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
