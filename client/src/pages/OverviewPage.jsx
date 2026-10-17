import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Car, 
  Grid, 
  Receipt, 
  TrendingUp, 
  ArrowUpRight, 
  Clock, 
  AlertCircle,
  PlusCircle,
  RefreshCw
} from 'lucide-react';
import { api } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';

export function OverviewPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  async function loadData() {
    setRefreshing(true);
    try {
      const [sumRes, slotsRes] = await Promise.all([
        api.getDashboardSummary(),
        api.getSlots()
      ]);
      setData(sumRes);
      setSlots(slotsRes);
      setError(null);
    } catch (err) {
      console.error('Error loading dashboard overview:', err);
      setError(err.message || 'Failed to load dashboard metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const [sumRes, slotsRes] = await Promise.all([
          api.getDashboardSummary(),
          api.getSlots()
        ]);
        if (!ignore) {
          setData(sumRes);
          setSlots(slotsRes);
          setError(null);
        }
      } catch (err) {
        if (!ignore) {
          console.error('Error loading dashboard overview:', err);
          setError(err.message || 'Failed to load dashboard metrics');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 font-mono text-sm">
        <RefreshCw className="w-5 h-5 animate-spin mr-2 text-[#10E599]" />
        Connecting to TimescaleDB & loading facility statistics...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300">
        <div className="flex items-center gap-3 font-semibold mb-2">
          <AlertCircle className="w-5 h-5" />
          <span>Error Loading Dashboard</span>
        </div>
        <p className="text-sm">{error}</p>
        <button
          onClick={loadData}
          className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const { metrics, slotTypeBreakdown, recentActivity } = data;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Facility Overview</h1>
          <p className="text-sm text-slate-400">
            Real time slot utilization and operational metrics powered by TimescaleDB
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={refreshing}
            className="p-2 bg-[#0B1017] hover:bg-[#121A24] border border-[#16202C] rounded-xl text-slate-300 transition-colors disabled:opacity-50"
            title="Refresh metrics"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[#10E599]' : ''}`} />
          </button>
          <Link
            to="/dashboard/tickets?action=open"
            className="flex items-center gap-2 px-4 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 text-xs font-bold rounded-xl shadow-[0_0_15px_rgba(16,229,153,0.25)] transition-all"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Open New Ticket</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Occupancy Rate</span>
            <div className="w-8 h-8 rounded-lg bg-[#10E599]/10 text-[#10E599] flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white font-mono">{metrics.occupancyPercentage}%</span>
            <span className="text-xs text-slate-400 font-mono">({metrics.occupiedSlots}/{metrics.totalSlots} slots)</span>
          </div>
          <div className="mt-3 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-[#10E599] h-full rounded-full transition-all duration-500" 
              style={{ width: `${metrics.occupancyPercentage}%` }}
            />
          </div>
        </div>

        <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Available Slots</span>
            <div className="w-8 h-8 rounded-lg bg-[#10E599]/10 text-[#10E599] flex items-center justify-center">
              <Grid className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#10E599] font-mono">{metrics.availableSlots}</span>
            <span className="text-xs text-slate-400">ready for allocation</span>
          </div>
          <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5 font-mono">
            <span>Reserved: <strong className="text-indigo-400">{metrics.reservedSlots}</strong></span>
          </div>
        </div>

        <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Active Stays</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-amber-400 font-mono">{metrics.activeTickets}</span>
            <span className="text-xs text-slate-400">vehicles currently parked</span>
          </div>
          <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5 font-mono">
            <span>Completed Stays: <strong className="text-slate-200">{metrics.completedTickets}</strong></span>
          </div>
        </div>

        <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Collected Revenue</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white font-mono">₹{metrics.totalRevenue}</span>
            <span className="text-xs text-slate-400">billed</span>
          </div>
          <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5 font-mono">
            <span>Projected unbilled: <strong className="text-emerald-400">₹{metrics.projectedRevenue}</strong></span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-[#0B1017] border border-[#16202C] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-bold text-white">Live Parking Slot Layout</h2>
              <p className="text-xs text-slate-400 font-mono">24 Managed Spaces (Regular, Covered, EVCharging)</p>
            </div>
            <Link
              to="/dashboard/slots"
              className="text-xs text-[#10E599] hover:underline flex items-center gap-1 font-medium font-mono"
            >
              Full Slot Manager <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2.5">
            {slots.map((slot) => {
              const isAvail = slot.status === 'Available';
              const isOcc = slot.status === 'Occupied';

              return (
                <div
                  key={slot.slot_id}
                  onClick={() => navigate('/dashboard/slots')}
                  className={`p-2.5 sm:p-3 rounded-xl border text-center transition-all cursor-pointer min-w-0 ${
                    isAvail 
                      ? 'bg-[#10E599]/5 border-[#10E599]/30 hover:border-[#10E599] hover:bg-[#10E599]/10' 
                      : isOcc 
                      ? 'bg-amber-500/10 border-amber-500/30 hover:border-amber-500' 
                      : 'bg-indigo-500/10 border-indigo-500/30 hover:border-indigo-500'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span className="font-bold text-white">#{slot.slot_id}</span>
                    <span className="uppercase text-[9px] font-semibold px-1 py-0.2 rounded bg-slate-800 text-slate-300">
                      {slot.type_name === 'EVCharging' ? 'EV' : slot.type_name === 'Covered' ? 'COV' : 'REG'}
                    </span>
                  </div>
                  <div className={`mt-2 text-[11px] font-bold font-mono tracking-tight flex items-center justify-center gap-1 ${
                    isAvail ? 'text-[#10E599]' : isOcc ? 'text-amber-400' : 'text-indigo-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isAvail ? 'bg-[#10E599]' : isOcc ? 'bg-amber-400' : 'bg-indigo-400'
                    }`} />
                    <span className="truncate">{slot.status}</span>
                  </div>
                  {slot.active_vehicle_no ? (
                    <div className="mt-1 text-[10px] text-slate-300 font-mono truncate" title={slot.active_vehicle_no}>
                      {slot.active_vehicle_no}
                    </div>
                  ) : (
                    <div className="mt-1 text-[10px] text-slate-500 font-mono truncate">
                      ₹{parseFloat(slot.base_rate).toFixed(0)}/hr
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-5 pt-4 border-t border-[#16202C] flex flex-wrap items-center justify-between text-xs font-mono text-slate-400 gap-4">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-[#10E599]"></span> Available
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-amber-400"></span> Occupied
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-indigo-400"></span> Reserved
              </span>
            </div>
            <span>Click any slot to inspect or allocate</span>
          </div>
        </div>

        <div className="lg:col-span-4 bg-[#0B1017] border border-[#16202C] rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-white mb-1">Slot Type Inventory</h2>
            <p className="text-xs text-slate-400 font-mono mb-5">Billing Rates & Allocation</p>

            <div className="space-y-4">
              {slotTypeBreakdown.map((type) => {
                const total = parseInt(type.total_slots, 10);
                const occ = parseInt(type.occupied, 10);
                const pct = total > 0 ? Math.round((occ / total) * 100) : 0;

                return (
                  <div key={type.slot_type_id} className="p-4 rounded-xl bg-[#06090D] border border-[#16202C]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{type.type_name}</span>
                        <span className="text-[11px] font-mono text-[#10E599] bg-[#10E599]/10 px-2 py-0.5 rounded">
                          ₹{type.base_rate}/hr
                        </span>
                      </div>
                      <span className="text-xs font-mono text-slate-400">
                        {occ}/{total} spots ({pct}%)
                      </span>
                    </div>

                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${
                          type.type_name === 'EVCharging' ? 'bg-teal-400' : type.type_name === 'Covered' ? 'bg-indigo-400' : 'bg-[#10E599]'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 p-4 rounded-xl bg-[#121A24]/60 border border-[#16202C] text-xs text-slate-300 space-y-1">
            <span className="font-semibold text-white block">BCNF Decomposition Principle:</span>
            <p className="text-slate-400">
              Base rates depend on SlotTypeID rather than SlotID directly, eliminating transitive dependencies.
            </p>
          </div>
        </div>

      </div>

      <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-white">Recent Parking Activity</h2>
            <p className="text-xs text-slate-400 font-mono">Live ticket records directly from PostgreSQL</p>
          </div>
          <Link
            to="/dashboard/tickets"
            className="text-xs text-[#10E599] hover:underline flex items-center gap-1 font-medium font-mono"
          >
            View All Tickets <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#06090D] text-slate-400 border-b border-[#16202C]">
              <tr>
                <th className="py-3 px-4 font-medium">Ticket #</th>
                <th className="py-3 px-4 font-medium">Vehicle</th>
                <th className="py-3 px-4 font-medium">Slot & Type</th>
                <th className="py-3 px-4 font-medium">Valet Staff</th>
                <th className="py-3 px-4 font-medium">Entry Timestamp</th>
                <th className="py-3 px-4 font-medium">Amount</th>
                <th className="py-3 px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#16202C] text-slate-300">
              {recentActivity.length > 0 ? (
                recentActivity.map((ticket) => (
                  <tr key={ticket.ticket_id} className="hover:bg-[#121A24]/40 transition-colors">
                    <td className="py-3 px-4 font-bold text-white">#{ticket.ticket_id}</td>
                    <td className="py-3 px-4">
                      <span className="font-semibold text-white">{ticket.vehicle_no}</span>
                      <span className="block text-[10px] text-slate-500 font-sans">{ticket.owner_name} ({ticket.vehicle_type})</span>
                    </td>
                    <td className="py-3 px-4">
                      <span>Slot #{ticket.slot_id}</span>
                      <span className="block text-[10px] text-slate-500 font-sans">{ticket.slot_type} (₹{ticket.base_rate}/hr)</span>
                    </td>
                    <td className="py-3 px-4 text-slate-300 font-sans">{ticket.staff_name}</td>
                    <td className="py-3 px-4 text-slate-400">
                      {new Date(ticket.entry_time).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-bold text-white">
                      {ticket.status === 'Completed' ? `₹${ticket.amount_paid}` : 'Ongoing'}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={ticket.status} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-sans">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Car className="w-8 h-8 text-slate-600 mb-1" />
                      <span className="font-semibold text-white">No active or historical tickets recorded</span>
                      <span className="text-xs text-slate-500 max-w-sm">
                        All slots are currently available. Open a ticket from the Tickets page to begin live valet operations.
                      </span>
                      <Link 
                        to="/dashboard/tickets" 
                        className="mt-3 px-4 py-1.5 rounded-xl bg-[#10E599]/10 text-[#10E599] border border-[#10E599]/30 font-mono text-xs font-bold hover:bg-[#10E599]/20 transition-colors"
                      >
                        + Open First Ticket
                      </Link>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

        </div>
      </div>
    </div>
  );
}
