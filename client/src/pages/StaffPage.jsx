import React, { useState, useEffect } from 'react';
import { 
  PlusCircle, 
  Phone, 
  Clock, 
  Trash2, 
  Edit3, 
  RefreshCw 
} from 'lucide-react';
import { api } from '../services/api';
import { Modal } from '../components/Modal';

export function StaffPage() {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ id: null, name: '', phone: '', shift_timing: 'Morning (06:00 - 14:00)' });
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);

  async function loadStaff() {
    try {
      setLoading(true);
      const data = await api.getStaff();
      setStaffList(data);
    } catch (err) {
      console.error('Error loading staff:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const data = await api.getStaff();
        if (!ignore) {
          setStaffList(data);
        }
      } catch (err) {
        if (!ignore) {
          console.error('Error loading staff:', err);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, []);

  async function handleSaveStaff(e) {
    e.preventDefault();
    setError(null);
    try {
      if (form.id) {
        await api.updateStaff(form.id, form);
        setFeedback({ type: 'success', text: `Staff member ${form.name} updated successfully` });
      } else {
        await api.createStaff(form);
        setFeedback({ type: 'success', text: `Staff member ${form.name} added successfully` });
      }
      setModalOpen(false);
      await loadStaff();
    } catch (err) {
      setError(err.message || 'Operation failed');
    }
  }

  async function handleDeleteStaff(staff) {
    if (!window.confirm(`Delete staff member "${staff.name}"?`)) return;
    try {
      await api.deleteStaff(staff.staff_id);
      setFeedback({ type: 'success', text: `Staff member ${staff.name} deleted successfully` });
      await loadStaff();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Cannot delete staff' });
    }
  }

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Valet Staff Management</h1>
          <p className="text-sm text-slate-400">
            Valet attendant assignments, shifts, and ticket handling performance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setForm({ id: null, name: '', phone: '', shift_timing: 'Morning (06:00 - 14:00)' });
              setError(null);
              setModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 text-xs font-bold rounded-xl shadow-[0_0_15px_rgba(16,229,153,0.25)] transition-all"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Add Attendant</span>
          </button>
          <button
            onClick={loadStaff}
            className="p-2 bg-[#0B1017] hover:bg-[#121A24] border border-[#16202C] rounded-xl text-slate-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`p-4 rounded-xl border text-xs font-mono flex items-center justify-between ${
          feedback.type === 'success' 
            ? 'bg-[#10E599]/10 text-[#10E599] border-[#10E599]/30' 
            : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
        }`}>
          <span>{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white font-bold ml-4">✕</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48 text-slate-400 font-mono text-sm">
          <RefreshCw className="w-5 h-5 animate-spin mr-2 text-[#10E599]" />
          Loading valet staff records...
        </div>
      ) : staffList.length === 0 ? (
        <div className="p-8 text-center text-slate-500 font-mono text-sm bg-[#0B1017] border border-[#16202C] rounded-2xl">
          No valet staff attendants registered.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {staffList.map((s) => (
            <div key={s.staff_id} className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-5 hover:border-[#10E599]/30 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  ID #{s.staff_id}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setForm({ id: s.staff_id, name: s.name, phone: s.phone, shift_timing: s.shift_timing });
                      setError(null);
                      setModalOpen(true);
                    }}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                    title="Edit"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteStaff(s)}
                    className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <h3 className="text-base font-bold text-white mb-1">{s.name}</h3>
              <p className="text-xs text-slate-400 font-mono flex items-center gap-1.5 mb-3">
                <Phone className="w-3.5 h-3.5 text-slate-500" />
                <span>{s.phone}</span>
              </p>

              <div className="p-2.5 bg-[#06090D] border border-[#16202C] rounded-xl text-xs font-mono mb-4">
                <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                  <Clock className="w-3.5 h-3.5 text-[#10E599]" />
                  <span>Shift Schedule:</span>
                </div>
                <span className="text-slate-200 font-semibold">{s.shift_timing}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-[#16202C] flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">Handled:</span>
              <span className="font-bold text-white">
                {s.total_tickets_handled} ticket(s)
                {parseInt(s.active_tickets, 10) > 0 && (
                  <span className="ml-1 text-amber-400">({s.active_tickets} active)</span>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? `Edit Valet Attendant #${form.id}` : 'Add Valet Attendant'}
      >
        <form onSubmit={handleSaveStaff} className="space-y-4 text-sm font-sans">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs font-mono">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">Attendant Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-[#10E599]"
              placeholder="e.g. Divya R"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">Contact Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-[#10E599]"
              placeholder="e.g. 9000022222"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">Shift Timing</label>
            <select
              value={form.shift_timing}
              onChange={(e) => setForm({ ...form, shift_timing: e.target.value })}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-[#10E599]"
            >
              <option value="Morning (06:00 - 14:00)">Morning (06:00 - 14:00)</option>
              <option value="Evening (14:00 - 22:00)">Evening (14:00 - 22:00)</option>
              <option value="Night (22:00 - 06:00)">Night (22:00 - 06:00)</option>
              <option value="General (09:00 - 18:00)">General (09:00 - 18:00)</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[#16202C]">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 font-bold rounded-xl text-xs transition-all"
            >
              {form.id ? 'Save Changes' : 'Add Attendant'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
