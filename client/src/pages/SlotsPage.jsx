import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Filter, 
  Settings, 
  RefreshCw,
  PlusCircle
} from 'lucide-react';
import { api } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';

export function SlotsPage() {
  const navigate = useNavigate();
  const [slots, setSlots] = useState([]);
  const [slotTypes, setSlotTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [slotHistory, setSlotHistory] = useState([]);
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [editRateData, setEditRateData] = useState({ id: 1, name: 'Regular', rate: 50 });
  const [rateError, setRateError] = useState(null);
  const [statusChangeLoading, setStatusChangeLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [addSlotModalOpen, setAddSlotModalOpen] = useState(false);
  const [newSlotTypeId, setNewSlotTypeId] = useState(1);
  const [addSlotError, setAddSlotError] = useState(null);

  async function handleAddSlot(e) {
    e.preventDefault();
    try {
      setAddSlotError(null);
      await api.createSlot({ slot_type_id: newSlotTypeId, status: 'Available' });
      setAddSlotModalOpen(false);
      setActionMessage({ type: 'success', text: 'New parking slot successfully initialized and added to grid.' });
      loadSlotsData();
    } catch (err) {
      setAddSlotError(err.message || 'Failed to create slot');
    }
  }


  async function loadSlotsData() {
    try {
      setLoading(true);
      const [slotsData, typesData] = await Promise.all([
        api.getSlots(),
        api.getSlotTypes()
      ]);
      setSlots(slotsData);
      setSlotTypes(typesData);
    } catch (err) {
      console.error('Error loading slots:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSlotsData();
  }, []);

  async function handleInspectSlot(slot) {
    setSelectedSlot(slot);
    setInspectModalOpen(true);
    setActionMessage(null);
    try {
      const detail = await api.getSlot(slot.slot_id);
      setSlotHistory(detail.history || []);
    } catch (err) {
      console.error('Error loading slot history:', err);
    }
  }

  async function handleToggleStatus(newStatus) {
    if (!selectedSlot) return;
    setStatusChangeLoading(true);
    setActionMessage(null);
    try {
      await api.updateSlotStatus(selectedSlot.slot_id, newStatus);
      setActionMessage({ type: 'success', text: `Slot #${selectedSlot.slot_id} status updated to ${newStatus}` });
      await loadSlotsData();
      setSelectedSlot(prev => ({ ...prev, status: newStatus }));
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to update slot status' });
    } finally {
      setStatusChangeLoading(false);
    }
  }

  async function handleUpdateRate(e) {
    e.preventDefault();
    setRateError(null);
    try {
      await api.updateSlotTypeRate(editRateData.id, editRateData.rate);
      setRateModalOpen(false);
      await loadSlotsData();
    } catch (err) {
      setRateError(err.message || 'Failed to update rate');
    }
  }

  const filteredSlots = slots.filter((slot) => {
    if (typeFilter !== 'ALL' && slot.type_name !== typeFilter) return false;
    if (statusFilter !== 'ALL' && slot.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Parking Slot Management</h1>
          <p className="text-sm text-slate-400">
            Interactive visual grid with ACID-protected slot allocation and type hierarchies
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setAddSlotError(null);
              setAddSlotModalOpen(true);
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#10E599]/10 hover:bg-[#10E599]/20 border border-[#10E599]/30 text-[#10E599] text-xs font-semibold rounded-xl transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Add Parking Space</span>
          </button>
          <button
            onClick={() => {
              if (slotTypes.length > 0) {
                setEditRateData({ id: slotTypes[0].slot_type_id, name: slotTypes[0].type_name, rate: slotTypes[0].base_rate });
                setRateModalOpen(true);
              }
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#0B1017] hover:bg-[#121A24] border border-[#16202C] text-slate-300 text-xs font-semibold rounded-xl transition-colors"
          >
            <Settings className="w-4 h-4 text-[#10E599]" />
            <span>Configure Base Rates</span>
          </button>
          <button
            onClick={loadSlotsData}
            className="p-2 bg-[#0B1017] hover:bg-[#121A24] border border-[#16202C] rounded-xl text-slate-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

      </div>

      <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <span>Type:</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#06090D] p-1 rounded-xl border border-[#16202C] text-xs font-medium">
            {['ALL', 'Regular', 'Covered', 'EVCharging'].map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1 rounded-lg transition-colors ${
                  typeFilter === t ? 'bg-[#10E599]/10 text-[#10E599] font-semibold' : 'text-slate-400 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 ml-2">
            <span>Status:</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#06090D] p-1 rounded-xl border border-[#16202C] text-xs font-medium">
            {['ALL', 'Available', 'Occupied', 'Reserved'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-lg transition-colors ${
                  statusFilter === s ? 'bg-[#10E599]/10 text-[#10E599] font-semibold' : 'text-slate-400 hover:text-white'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
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
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 gap-3.5">
        {loading ? (
          <div className="col-span-full py-12 text-center text-slate-500 font-mono text-sm">
            Loading parking slots...
          </div>
        ) : filteredSlots.length === 0 ? (
          <div className="col-span-full py-12 text-center text-slate-500 font-mono text-sm">
            No slots match the selected filters.
          </div>
        ) : (
          filteredSlots.map((slot) => {
            const isAvail = slot.status === 'Available';
            const isOcc = slot.status === 'Occupied';

          return (
            <div
              key={slot.slot_id}
              onClick={() => handleInspectSlot(slot)}
              className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden group min-w-0 ${
                isAvail 
                  ? 'bg-[#0B1017] border-[#10E599]/30 hover:border-[#10E599] hover:shadow-[0_0_15px_rgba(16,229,153,0.15)]' 
                  : isOcc 
                  ? 'bg-amber-500/10 border-amber-500/40 hover:border-amber-400 hover:shadow-[0_0_15px_rgba(245,158,11,0.15)]' 
                  : 'bg-indigo-500/10 border-indigo-500/40 hover:border-indigo-400 hover:shadow-[0_0_15px_rgba(99,102,241,0.15)]'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-white text-base">#{slot.slot_id}</span>
                <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-mono font-semibold ${
                  slot.type_name === 'EVCharging' ? 'bg-teal-500/20 text-teal-300' :
                  slot.type_name === 'Covered' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-300'
                }`}>
                  {slot.type_name === 'EVCharging' ? 'EV' : slot.type_name === 'Covered' ? 'Covered' : 'Regular'}
                </span>
              </div>

              <div className="mt-2.5">
                <div className={`text-xs font-bold font-mono uppercase tracking-tight flex items-center gap-1.5 ${
                  isAvail ? 'text-[#10E599]' : isOcc ? 'text-amber-400' : 'text-indigo-400'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isAvail ? 'bg-[#10E599]' : isOcc ? 'bg-amber-400' : 'bg-indigo-400'
                  }`} />
                  <span className="truncate">{slot.status}</span>
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-1 whitespace-nowrap">
                  ₹{parseFloat(slot.base_rate).toFixed(0)}/hr
                </div>
              </div>

              {isOcc && slot.active_vehicle_no ? (
                <div className="mt-2.5 pt-2 border-t border-amber-500/20 text-[11px] font-mono min-w-0">
                  <span className="font-bold text-white block truncate" title={slot.active_vehicle_no}>
                    {slot.active_vehicle_no}
                  </span>
                  <span className="text-amber-400/80 block text-[10px] truncate" title={slot.active_staff_name}>
                    {slot.active_staff_name}
                  </span>
                </div>
              ) : (
                <div className="mt-2.5 pt-2 border-t border-[#16202C] text-[10px] text-slate-400 font-mono flex items-center justify-between">
                  <span className="truncate">{isAvail ? 'Ready to allocate' : 'Reserved for VIP'}</span>
                </div>
              )}
            </div>
          );
        })
      )}
      </div>

      <Modal
        isOpen={inspectModalOpen}
        onClose={() => setInspectModalOpen(false)}
        title={selectedSlot ? `Parking Slot #${selectedSlot.slot_id} Details` : 'Slot Details'}
      >
        {selectedSlot && (
          <div className="space-y-6 text-sm">
            {actionMessage && (
              <div className={`p-3 rounded-xl border text-xs font-mono ${
                actionMessage.type === 'success' 
                  ? 'bg-[#10E599]/10 text-[#10E599] border-[#10E599]/30' 
                  : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
              }`}>
                {actionMessage.text}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-[#06090D] rounded-xl border border-[#16202C] font-mono text-xs">
              <div>
                <span className="text-slate-400 block text-[10px]">SLOT TYPE</span>
                <span className="font-bold text-white text-sm">{selectedSlot.type_name}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">BASE HOURLY RATE</span>
                <span className="font-bold text-[#10E599] text-sm">₹{selectedSlot.base_rate}/hr</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">CURRENT STATUS</span>
                <div className="mt-1">
                  <StatusBadge status={selectedSlot.status} />
                </div>
              </div>
            </div>

            {selectedSlot.status === 'Occupied' && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-3 font-mono">
                <div className="flex items-center justify-between text-xs text-amber-400 font-bold">
                  <span>ACTIVE PARKING TICKET #{selectedSlot.active_ticket_id}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20">Ongoing Stay</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400 text-[10px]">Vehicle No:</span>
                    <p className="font-bold text-white">{selectedSlot.active_vehicle_no} ({selectedSlot.active_vehicle_type})</p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px]">Owner:</span>
                    <p className="text-slate-200">{selectedSlot.active_owner_name}</p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px]">Valet Staff:</span>
                    <p className="text-slate-200">{selectedSlot.active_staff_name}</p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px]">Parked At:</span>
                    <p className="text-slate-200">{new Date(selectedSlot.active_entry_time).toLocaleTimeString()}</p>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => {
                      setInspectModalOpen(false);
                      navigate(`/dashboard/tickets?closeTicketId=${selectedSlot.active_ticket_id}`);
                    }}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all"
                  >
                    Close & Bill Ticket
                  </button>
                </div>
              </div>
            )}

            {selectedSlot.status === 'Available' && (
              <div className="p-4 bg-[#10E599]/10 border border-[#10E599]/30 rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-white text-xs">Slot Ready For Vehicle</h4>
                  <p className="text-xs text-slate-400">Open ticket directly for slot #{selectedSlot.slot_id}</p>
                </div>
                <button
                  onClick={() => {
                    setInspectModalOpen(false);
                    navigate(`/dashboard/tickets?action=open&slotId=${selectedSlot.slot_id}`);
                  }}
                  className="px-4 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 font-bold text-xs rounded-xl transition-all shadow-sm"
                >
                  Allocate Here
                </button>
              </div>
            )}

            <div className="space-y-2">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Manual Status Management</span>
              <div className="flex items-center gap-2">
                <button
                  disabled={selectedSlot.status === 'Available' || selectedSlot.status === 'Occupied' || statusChangeLoading}
                  onClick={() => handleToggleStatus('Available')}
                  className="flex-1 py-2 rounded-xl bg-[#06090D] hover:bg-[#121A24] text-xs font-mono text-slate-300 border border-[#16202C] disabled:opacity-40 transition-colors"
                >
                  Set Available
                </button>
                <button
                  disabled={selectedSlot.status === 'Reserved' || selectedSlot.status === 'Occupied' || statusChangeLoading}
                  onClick={() => handleToggleStatus('Reserved')}
                  className="flex-1 py-2 rounded-xl bg-[#06090D] hover:bg-[#121A24] text-xs font-mono text-indigo-400 border border-indigo-500/30 disabled:opacity-40 transition-colors"
                >
                  Set Reserved
                </button>
              </div>
              {selectedSlot.status === 'Occupied' && (
                <p className="text-[11px] text-slate-400 italic">
                  Status cannot be changed manually while an active ticket occupies this slot. Close the ticket to free the slot.
                </p>
              )}
            </div>

            <div className="space-y-3 pt-2 border-t border-[#16202C]">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Slot Parking History</span>
              {slotHistory.length > 0 ? (
                <div className="max-h-40 overflow-y-auto space-y-2 text-xs font-mono">
                  {slotHistory.map((hist) => (
                    <div key={hist.ticket_id} className="p-2.5 bg-[#06090D] rounded-xl border border-[#16202C] flex items-center justify-between">
                      <div>
                        <span className="font-bold text-white">Ticket #{hist.ticket_id}</span>
                        <span className="text-slate-400 ml-2">({hist.vehicle_no})</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-[#10E599]">₹{hist.amount_paid}</span>
                        <span className="block text-[10px] text-slate-500">{new Date(hist.entry_time).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 font-mono">No prior tickets recorded for this slot.</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={rateModalOpen}
        onClose={() => setRateModalOpen(false)}
        title="Configure Slot Type Base Rates"
      >
        <form onSubmit={handleUpdateRate} className="space-y-4 text-sm font-mono">
          {rateError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs">
              {rateError}
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">Select Slot Type</label>
            <select
              value={editRateData.id}
              onChange={(e) => {
                const selected = slotTypes.find(t => t.slot_type_id === parseInt(e.target.value, 10));
                if (selected) {
                  setEditRateData({ id: selected.slot_type_id, name: selected.type_name, rate: selected.base_rate });
                }
              }}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#10E599]"
            >
              {slotTypes.map((t) => (
                <option key={t.slot_type_id} value={t.slot_type_id}>
                  {t.type_name} (Current: ₹{t.base_rate}/hr)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Base Rate (₹ per hour)</label>
            <input
              type="number"
              min="0"
              step="5"
              value={editRateData.rate}
              onChange={(e) => setEditRateData({ ...editRateData, rate: parseFloat(e.target.value) || 0 })}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#10E599]"
              required
            />
            <span className="text-[11px] text-slate-500 block mt-1">
              Must be non-negative (CHECK constraint chk_slottype_rate &gt;= 0 enforced).
            </span>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[#16202C]">
            <button
              type="button"
              onClick={() => setRateModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 font-bold rounded-xl text-xs"
            >
              Save Rate
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={addSlotModalOpen}
        onClose={() => setAddSlotModalOpen(false)}
        title="Add New Parking Space"
      >
        <form onSubmit={handleAddSlot} className="space-y-4 text-sm font-mono">
          {addSlotError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs">
              {addSlotError}
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">Select Slot Type Hierarchy</label>
            <select
              value={newSlotTypeId}
              onChange={(e) => setNewSlotTypeId(parseInt(e.target.value, 10))}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#10E599]"
            >
              {slotTypes.map((t) => (
                <option key={t.slot_type_id} value={t.slot_type_id}>
                  {t.type_name} (₹{t.base_rate}/hr)
                </option>
              ))}
            </select>
          </div>

          <div className="p-3 bg-[#06090D] rounded-xl border border-[#16202C] text-xs text-slate-400 font-sans">
            The slot will receive the next primary key <code className="text-white font-mono">slot_id</code> and initialize in <code className="text-[#10E599] font-mono">Available</code> status ready for valet allocation.
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[#16202C]">
            <button
              type="button"
              onClick={() => setAddSlotModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 font-bold rounded-xl text-xs"
            >
              Create Slot
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

