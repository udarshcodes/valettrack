import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Search, 
  PlusCircle, 
  Clock, 
  CheckCircle2, 
  RefreshCw
} from 'lucide-react';
import { api } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';

export function TicketsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState([]);
  const [activeTab, setActiveTab] = useState('active');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [openModalOpen, setOpenModalOpen] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [formData, setFormData] = useState({ vehicle_no: '', slot_id: '', staff_id: '' });
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [recommendationInfo, setRecommendationInfo] = useState(null);
  const [recommending, setRecommending] = useState(false);

  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [ticketToClose, setTicketToClose] = useState(null);
  const [closeError, setCloseError] = useState(null);
  const [closing, setClosing] = useState(false);

  async function handleAutoRecommendSlot() {
    if (!formData.vehicle_no) return;
    try {
      setRecommending(true);
      const rec = await api.recommendSlot({ vehicle_no: formData.vehicle_no });
      if (rec.eligible && rec.recommended_slot) {
        setFormData(prev => ({ ...prev, slot_id: rec.recommended_slot.slot_id }));
        setRecommendationInfo(rec);
      } else {
        setRecommendationInfo(rec);
      }
    } catch (err) {
      console.error('Error fetching slot recommendation:', err);
    } finally {
      setRecommending(false);
    }
  }

  async function loadTickets() {
    try {
      setLoading(true);
      const res = await api.getTickets({ status: activeTab, search });
      setTickets(res.tickets || []);
    } catch (err) {
      console.error('Error fetching tickets:', err);
    } finally {
      setLoading(false);
    }
  }

  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  async function prepareOpenModal() {
    try {
      const [vRes, sRes, sfRes] = await Promise.all([
        api.getVehicles(),
        api.getSlots(),
        api.getStaff()
      ]);
      setVehicles(vRes);
      const avail = sRes.filter(s => s.status === 'Available');
      setAvailableSlots(avail);
      setStaffList(sfRes);

      const preSlotId = searchParams.get('slotId');
      setFormData({
        vehicle_no: vRes.length > 0 ? vRes[0].vehicle_no : '',
        slot_id: preSlotId || (avail.length > 0 ? avail[0].slot_id : ''),
        staff_id: sfRes.length > 0 ? sfRes[0].staff_id : ''
      });
      setOpenModalOpen(true);
    } catch (err) {
      console.error('Error preparing modal:', err);
    }
  }

  useEffect(() => {
    let ignore = false;
    async function fetchTickets() {
      try {
        const res = await api.getTickets({ status: activeTab, search });
        if (!ignore) {
          setTickets(res.tickets || []);
        }
      } catch (err) {
        if (!ignore) {
          console.error('Error fetching tickets:', err);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    fetchTickets();
    return () => {
      ignore = true;
    };
  }, [activeTab, search]);

  useEffect(() => {
    let ignore = false;
    const action = searchParams.get('action');
    const closeId = searchParams.get('closeTicketId');

    if (action === 'open') {
      Promise.all([
        api.getVehicles(),
        api.getSlots(),
        api.getStaff()
      ]).then(([vRes, sRes, sfRes]) => {
        if (ignore) return;
        setVehicles(vRes);
        const avail = sRes.filter(s => s.status === 'Available');
        setAvailableSlots(avail);
        setStaffList(sfRes);

        const preSlotId = searchParams.get('slotId');
        setFormData({
          vehicle_no: vRes.length > 0 ? vRes[0].vehicle_no : '',
          slot_id: preSlotId || (avail.length > 0 ? avail[0].slot_id : ''),
          staff_id: sfRes.length > 0 ? sfRes[0].staff_id : ''
        });
        setOpenModalOpen(true);
      }).catch((err) => {
        if (!ignore) console.error('Error preparing modal:', err);
      });
    }

    if (closeId) {
      api.getTicket(closeId).then((t) => {
        if (!ignore) {
          setTicketToClose(t);
          setCloseModalOpen(true);
        }
      }).catch(console.error);
    }

    return () => {
      ignore = true;
    };
  }, [searchParams]);

  async function handleOpenTicket(e) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api.openTicket(formData);
      setOpenModalOpen(false);
      setSearchParams({});
      await loadTickets();
    } catch (err) {
      setFormError(err.message || 'Failed to open ticket');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmClose() {
    if (!ticketToClose) return;
    setCloseError(null);
    setClosing(true);
    try {
      await api.closeTicket(ticketToClose.ticket_id);
      setCloseModalOpen(false);
      setSearchParams({});
      await loadTickets();
    } catch (err) {
      setCloseError(err.message || 'Failed to close ticket');
    } finally {
      setClosing(false);
    }
  }

  function calculatePreviewBilling(ticket, asOfTime = currentTime) {
    if (!ticket) return { hours: 1, amount: 50 };
    const nowMs = typeof asOfTime === 'number' ? asOfTime : new Date(asOfTime).getTime();
    const entryMs = new Date(ticket.entry_time).getTime();
    const durationMs = Math.max(0, nowMs - entryMs);
    const durationMins = Math.round(durationMs / 60000);
    const rawHours = durationMs / (3600 * 1000);
    const billableHours = Math.max(1, Math.ceil(rawHours));
    const rate = parseFloat(ticket.base_rate);
    const amount = billableHours * rate;
    return {
      durationMins,
      billableHours,
      rate,
      amount
    };
  }

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Tickets & Valet Billing</h1>
          <p className="text-sm text-slate-400">
            End-to-end ticket lifecycle with whole-hour rounding (CEIL) and 1-hour minimum charge
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={prepareOpenModal}
            className="flex items-center gap-2 px-4 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 text-xs font-bold rounded-xl shadow-[0_0_15px_rgba(16,229,153,0.25)] transition-all"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Open Ticket</span>
          </button>
          <button
            onClick={loadTickets}
            className="p-2 bg-[#0B1017] hover:bg-[#121A24] border border-[#16202C] rounded-xl text-slate-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 bg-[#06090D] p-1 rounded-xl border border-[#16202C] text-xs font-medium">
          <button
            onClick={() => setActiveTab('active')}
            className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'active' 
                ? 'bg-[#10E599]/10 text-[#10E599] font-semibold border border-[#10E599]/30' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Active Stays</span>
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'completed' 
                ? 'bg-[#10E599]/10 text-[#10E599] font-semibold border border-[#10E599]/30' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Completed Stays</span>
          </button>
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by vehicle or owner..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#06090D] border border-[#16202C] rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#10E599]"
          />
        </div>
      </div>

      <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#06090D] text-slate-400 border-b border-[#16202C]">
              <tr>
                <th className="py-3 px-3 font-medium whitespace-nowrap">Ticket ID</th>
                <th className="py-3 px-3 font-medium whitespace-nowrap">Vehicle & Owner</th>
                <th className="py-3 px-3 font-medium whitespace-nowrap">Allocated Space</th>
                <th className="py-3 px-3 font-medium whitespace-nowrap">Valet Staff</th>
                <th className="py-3 px-3 font-medium whitespace-nowrap">Entry Time</th>
                <th className="py-3 px-3 font-medium whitespace-nowrap">{activeTab === 'active' ? 'Duration / Accrual' : 'Exit Time'}</th>
                <th className="py-3 px-3 font-medium whitespace-nowrap">Billed Amount</th>
                <th className="py-3 px-3 font-medium whitespace-nowrap text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#16202C] text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="8" className="py-12 text-center text-slate-500 font-mono">
                    Loading tickets from PostgreSQL...
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan="8" className="py-12 text-center text-slate-500 font-mono">
                    No {activeTab} tickets found.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => {
                  const preview = calculatePreviewBilling(t);

                  return (
                    <tr key={t.ticket_id} className="hover:bg-[#121A24]/40 transition-colors">
                      <td className="py-3 px-3 font-bold text-white whitespace-nowrap">#{t.ticket_id}</td>
                      <td className="py-3 px-3 font-sans whitespace-nowrap">
                        <span className="font-mono font-bold text-white block">{t.vehicle_no}</span>
                        <span className="text-[11px] text-slate-400">{t.owner_name} ({t.vehicle_type})</span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="font-bold text-white">Slot #{t.slot_id}</span>
                        <span className="block text-[10px] text-slate-400 font-sans">{t.slot_type} (₹{parseFloat(t.base_rate).toFixed(0)}/hr)</span>
                      </td>
                      <td className="py-3 px-3 font-sans text-slate-300 whitespace-nowrap">
                        {t.staff_name}
                      </td>
                      <td className="py-3 px-3 text-slate-400 whitespace-nowrap text-xs">
                        {new Date(t.entry_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {activeTab === 'active' ? (
                          <div>
                            <span className="text-amber-400 font-bold">{preview.durationMins} mins</span>
                            <span className="block text-[10px] text-slate-500">({preview.billableHours} billable {preview.billableHours === 1 ? 'hr' : 'hrs'})</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">
                            {new Date(t.exit_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-bold whitespace-nowrap">
                        {activeTab === 'active' ? (
                          <span className="text-amber-400">~₹{preview.amount}</span>
                        ) : (
                          <span className="text-[#10E599]">₹{t.amount_paid}</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {activeTab === 'active' ? (
                          <button
                            onClick={() => {
                              setTicketToClose(t);
                              setCloseModalOpen(true);
                            }}
                            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] rounded-lg transition-colors shadow-sm"
                          >
                            Close Ticket
                          </button>
                        ) : (
                          <StatusBadge status="Completed" />
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        isOpen={openModalOpen}
        onClose={() => setOpenModalOpen(false)}
        title="Open New Parking Ticket"
      >
        <form onSubmit={handleOpenTicket} className="space-y-4 text-sm font-sans">
          {formError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs font-mono">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">Select Registered Vehicle</label>
            <select
              value={formData.vehicle_no}
              onChange={(e) => setFormData({ ...formData, vehicle_no: e.target.value })}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-[#10E599]"
              required
            >
              {vehicles.map((v) => (
                <option key={v.vehicle_no} value={v.vehicle_no}>
                  {v.vehicle_no}: {v.type} ({v.color}) [{v.owner_name}]
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-mono text-slate-400">Select Available Parking Slot</label>
              <button
                type="button"
                onClick={handleAutoRecommendSlot}
                disabled={recommending || availableSlots.length === 0}
                className="text-[11px] font-mono text-[#10E599] hover:underline flex items-center gap-1 disabled:opacity-50"
                title="Automatically allocate the best slot based on vehicle characteristics"
              >
                <span>{recommending ? 'Analyzing...' : '✨ Auto-Recommend Slot'}</span>
              </button>
            </div>
            {availableSlots.length > 0 ? (
              <select
                value={formData.slot_id}
                onChange={(e) => {
                  setFormData({ ...formData, slot_id: e.target.value });
                  setRecommendationInfo(null);
                }}
                className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-[#10E599]"
                required
              >
                {availableSlots.map((s) => (
                  <option key={s.slot_id} value={s.slot_id}>
                    Slot #{s.slot_id}: {s.type_name} (₹{s.base_rate}/hr)
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl text-xs font-mono">
                No slots currently available. Free an occupied slot first.
              </div>
            )}
            {recommendationInfo && (
              <div className="mt-2 p-2.5 rounded-xl bg-[#10E599]/10 border border-[#10E599]/30 text-xs font-mono text-[#10E599]">
                <strong className="block font-bold">Allocation Logic:</strong>
                <span>{recommendationInfo.reason}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">Assign Valet Staff</label>
            <select
              value={formData.staff_id}
              onChange={(e) => setFormData({ ...formData, staff_id: e.target.value })}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-[#10E599]"
              required
            >
              {staffList.map((sf) => (
                <option key={sf.staff_id} value={sf.staff_id}>
                  {sf.name}: {sf.shift_timing}
                </option>
              ))}
            </select>
          </div>

          <div className="p-3 rounded-xl bg-[#06090D] border border-[#16202C] text-xs font-mono text-slate-400 space-y-1">
            <span className="text-[#10E599] font-bold block">Transactional Safety Guarantee:</span>
            <span>Trigger checks slot availability before insert and atomically sets status to Occupied.</span>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[#16202C]">
            <button
              type="button"
              onClick={() => setOpenModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || availableSlots.length === 0}
              className="px-4 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 font-bold rounded-xl text-xs transition-all disabled:opacity-50"
            >
              {submitting ? 'Allocating...' : 'Open Ticket & Park'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={closeModalOpen}
        onClose={() => setCloseModalOpen(false)}
        title={ticketToClose ? `Close Ticket #${ticketToClose.ticket_id}` : 'Close Ticket'}
      >
        {ticketToClose && (() => {
          const billing = calculatePreviewBilling(ticketToClose);

          return (
            <div className="space-y-5 text-sm font-sans">
              {closeError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs font-mono">
                  {closeError}
                </div>
              )}

              <div className="bg-[#06090D] border border-[#16202C] rounded-2xl p-4 font-mono text-xs space-y-3">
                <div className="flex items-center justify-between pb-3 border-b border-[#16202C]">
                  <div>
                    <span className="text-slate-400 block text-[10px]">VEHICLE</span>
                    <span className="text-white font-bold">{ticketToClose.vehicle_no}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 block text-[10px]">SLOT</span>
                    <span className="text-white font-bold">Slot #{ticketToClose.slot_id} ({ticketToClose.slot_type})</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-slate-300">
                  <div>
                    <span className="text-slate-500 block text-[10px]">ENTRY TIMESTAMP</span>
                    <span>{new Date(ticketToClose.entry_time).toLocaleTimeString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">EXIT TIMESTAMP</span>
                    <span className="text-amber-400">{new Date(currentTime).toLocaleTimeString()} (Now)</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">MEASURED DURATION</span>
                    <span>{billing.durationMins} minutes</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">BILLABLE HOURS (CEIL)</span>
                    <span className="text-white font-bold">{billing.billableHours} hr(s)</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-[#16202C] flex items-center justify-between">
                  <div>
                    <span className="text-slate-400 block text-[10px]">RATE CALCULATION</span>
                    <span className="text-slate-300">{billing.billableHours} hrs × ₹{billing.rate}/hr</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 block text-[10px]">TOTAL CHARGE</span>
                    <span className="text-2xl font-extrabold text-[#10E599] font-mono">₹{billing.amount}</span>
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-400 space-y-1 font-mono">
                <p>• Rule: Fractional stays round up to whole hours (<code className="text-slate-200">CEIL</code>).</p>
                <p>• Rule: Minimum billable charge is 1 hour.</p>
                <p>• Post-update trigger will automatically release Slot #{ticketToClose.slot_id} back to <strong className="text-[#10E599]">Available</strong>.</p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[#16202C]">
                <button
                  type="button"
                  onClick={() => setCloseModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmClose}
                  disabled={closing}
                  className="px-5 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 font-bold rounded-xl text-xs transition-all shadow-md disabled:opacity-50"
                >
                  {closing ? 'Processing Closure...' : `Collect ₹${billing.amount} & Free Slot`}
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
