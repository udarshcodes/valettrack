import React, { useState, useEffect } from 'react';
import { 
  Car, 
  User, 
  PlusCircle, 
  Search, 
  Trash2, 
  Edit3, 
  RefreshCw 
} from 'lucide-react';
import { api } from '../services/api';
import { Modal } from '../components/Modal';

export function VehiclesPage() {
  const [activeTab, setActiveTab] = useState('vehicles');
  const [vehicles, setVehicles] = useState([]);
  const [owners, setOwners] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [ownerModalOpen, setOwnerModalOpen] = useState(false);
  const [ownerForm, setOwnerForm] = useState({ id: null, name: '', phone: '', email: '' });
  const [ownerError, setOwnerError] = useState(null);

  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({ vehicle_no: '', type: 'Sedan', color: 'White', owner_id: '' });
  const [vehicleError, setVehicleError] = useState(null);

  const [feedback, setFeedback] = useState(null);

  async function loadData() {
    try {
      setLoading(true);
      const [vRes, oRes] = await Promise.all([
        api.getVehicles(),
        api.getOwners()
      ]);
      setVehicles(vRes);
      setOwners(oRes);
      if (oRes.length > 0 && !vehicleForm.owner_id) {
        setVehicleForm(prev => ({ ...prev, owner_id: oRes[0].owner_id }));
      }
    } catch (err) {
      console.error('Error loading vehicles and owners:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const [vRes, oRes] = await Promise.all([
          api.getVehicles(),
          api.getOwners()
        ]);
        if (!ignore) {
          setVehicles(vRes);
          setOwners(oRes);
          if (oRes.length > 0) {
            setVehicleForm(prev => (prev.owner_id ? prev : { ...prev, owner_id: oRes[0].owner_id }));
          }
        }
      } catch (err) {
        if (!ignore) {
          console.error('Error loading vehicles and owners:', err);
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

  async function handleSaveOwner(e) {
    e.preventDefault();
    setOwnerError(null);
    try {
      if (ownerForm.id) {
        await api.updateOwner(ownerForm.id, ownerForm);
        setFeedback({ type: 'success', text: `Owner ${ownerForm.name} updated successfully` });
      } else {
        await api.createOwner(ownerForm);
        setFeedback({ type: 'success', text: `Owner ${ownerForm.name} registered successfully` });
      }
      setOwnerModalOpen(false);
      await loadData();
    } catch (err) {
      setOwnerError(err.message || 'Operation failed');
    }
  }

  async function handleDeleteOwner(owner) {
    if (!window.confirm(`Are you sure you want to delete owner "${owner.name}"?`)) return;
    try {
      await api.deleteOwner(owner.owner_id);
      setFeedback({ type: 'success', text: `Owner ${owner.name} removed successfully` });
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Cannot delete owner' });
    }
  }

  async function handleSaveVehicle(e) {
    e.preventDefault();
    setVehicleError(null);
    try {
      await api.createVehicle(vehicleForm);
      setFeedback({ type: 'success', text: `Vehicle ${vehicleForm.vehicle_no} registered successfully` });
      setVehicleModalOpen(false);
      setVehicleForm({ vehicle_no: '', type: 'Sedan', color: 'White', owner_id: owners[0]?.owner_id || '' });
      await loadData();
    } catch (err) {
      setVehicleError(err.message || 'Operation failed');
    }
  }

  async function handleDeleteVehicle(vehicle) {
    if (!window.confirm(`Delete vehicle "${vehicle.vehicle_no}"?`)) return;
    try {
      await api.deleteVehicle(vehicle.vehicle_no);
      setFeedback({ type: 'success', text: `Vehicle ${vehicle.vehicle_no} deleted successfully` });
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Cannot delete vehicle' });
    }
  }

  const filteredVehicles = vehicles.filter(v => 
    v.vehicle_no.toLowerCase().includes(search.toLowerCase()) ||
    v.owner_name.toLowerCase().includes(search.toLowerCase()) ||
    v.type.toLowerCase().includes(search.toLowerCase())
  );

  const filteredOwners = owners.filter(o => 
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.email.toLowerCase().includes(search.toLowerCase()) ||
    o.phone.includes(search)
  );

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Vehicles & Registered Owners</h1>
          <p className="text-sm text-slate-400">
            Relational entity management with BCNF key constraints and foreign key validation
          </p>
        </div>
        <div className="flex items-center gap-3">
          {activeTab === 'vehicles' ? (
            <button
              onClick={() => {
                setVehicleError(null);
                setVehicleModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 text-xs font-bold rounded-xl shadow-[0_0_15px_rgba(16,229,153,0.25)] transition-all"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Register Vehicle</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setOwnerForm({ id: null, name: '', phone: '', email: '' });
                setOwnerError(null);
                setOwnerModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 text-xs font-bold rounded-xl shadow-[0_0_15px_rgba(16,229,153,0.25)] transition-all"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Add New Owner</span>
            </button>
          )}
          <button
            onClick={loadData}
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

      <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 bg-[#06090D] p-1 rounded-xl border border-[#16202C] text-xs font-medium">
          <button
            onClick={() => setActiveTab('vehicles')}
            className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'vehicles' 
                ? 'bg-[#10E599]/10 text-[#10E599] font-semibold border border-[#10E599]/30' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Car className="w-3.5 h-3.5" />
            <span>Vehicles ({vehicles.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('owners')}
            className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'owners' 
                ? 'bg-[#10E599]/10 text-[#10E599] font-semibold border border-[#10E599]/30' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Owners ({owners.length})</span>
          </button>
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder={`Search ${activeTab}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#06090D] border border-[#16202C] rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#10E599]"
          />
        </div>
      </div>

      {activeTab === 'vehicles' ? (
        <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#06090D] text-slate-400 border-b border-[#16202C]">
                <tr>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Vehicle Plate</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Type & Color</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Owner Details</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Registered Date</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Lifetime Tickets</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#16202C] text-slate-300">
                {filteredVehicles.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-8 text-center text-slate-500 font-sans text-sm">
                      {loading ? 'Loading vehicles...' : 'No vehicles registered yet.'}
                    </td>
                  </tr>
                ) : (
                  filteredVehicles.map((v) => (
                  <tr key={v.vehicle_no} className="hover:bg-[#121A24]/40 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-white text-sm whitespace-nowrap">
                      {v.vehicle_no}
                    </td>
                    <td className="py-3.5 px-4 font-sans whitespace-nowrap">
                      <span className="font-semibold text-white">{v.type}</span>
                      <span className="block text-[11px] text-slate-400 font-mono">Color: {v.color}</span>
                    </td>
                    <td className="py-3.5 px-4 font-sans whitespace-nowrap">
                      <span className="text-white font-semibold block">{v.owner_name}</span>
                      <span className="text-[11px] text-slate-400 font-mono">{v.owner_phone} • {v.owner_email}</span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap text-xs">
                      {new Date(v.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                      <span className="text-white font-bold">{v.total_tickets}</span> stays
                      {parseInt(v.active_tickets, 10) > 0 && (
                        <span className="ml-2 text-[10px] text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded">
                          Currently Parked
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleDeleteVehicle(v)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Delete Vehicle"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-[#0B1017] border border-[#16202C] rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#06090D] text-slate-400 border-b border-[#16202C]">
                <tr>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Owner ID</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Full Name</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Phone Number</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Email Address</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap">Vehicles</th>
                  <th className="py-3.5 px-4 font-medium whitespace-nowrap text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#16202C] text-slate-300">
                {filteredOwners.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-8 text-center text-slate-500 font-sans text-sm">
                      {loading ? 'Loading owners...' : 'No owners registered yet.'}
                    </td>
                  </tr>
                ) : (
                  filteredOwners.map((o) => (
                  <tr key={o.owner_id} className="hover:bg-[#121A24]/40 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-white whitespace-nowrap">#{o.owner_id}</td>
                    <td className="py-3.5 px-4 font-sans font-bold text-white text-sm whitespace-nowrap">{o.name}</td>
                    <td className="py-3.5 px-4 text-slate-300 whitespace-nowrap">{o.phone}</td>
                    <td className="py-3.5 px-4 text-slate-300 whitespace-nowrap">{o.email}</td>
                    <td className="py-3.5 px-4 font-bold text-[#10E599] whitespace-nowrap">{o.vehicle_count} car(s)</td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1">
                      <button
                        onClick={() => {
                          setOwnerForm({ id: o.owner_id, name: o.name, phone: o.phone, email: o.email });
                          setOwnerError(null);
                          setOwnerModalOpen(true);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        title="Edit Owner"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteOwner(o)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Delete Owner"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        isOpen={ownerModalOpen}
        onClose={() => setOwnerModalOpen(false)}
        title={ownerForm.id ? `Edit Owner #${ownerForm.id}` : 'Register New Owner'}
      >
        <form onSubmit={handleSaveOwner} className="space-y-4 text-sm font-sans">
          {ownerError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs font-mono">
              {ownerError}
            </div>
          )}

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">Owner Full Name</label>
            <input
              type="text"
              value={ownerForm.name}
              onChange={(e) => setOwnerForm({ ...ownerForm, name: e.target.value })}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#10E599] text-xs"
              placeholder="e.g. Maya Sen"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">Phone Number (Unique)</label>
            <input
              type="tel"
              value={ownerForm.phone}
              onChange={(e) => setOwnerForm({ ...ownerForm, phone: e.target.value })}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-[#10E599] text-xs"
              placeholder="e.g. 9876543210"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">Email Address (Unique)</label>
            <input
              type="email"
              value={ownerForm.email}
              onChange={(e) => setOwnerForm({ ...ownerForm, email: e.target.value })}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-[#10E599] text-xs"
              placeholder="e.g. maya.sen@mail.com"
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[#16202C]">
            <button
              type="button"
              onClick={() => setOwnerModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 font-bold rounded-xl text-xs transition-all"
            >
              {ownerForm.id ? 'Save Changes' : 'Register Owner'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={vehicleModalOpen}
        onClose={() => setVehicleModalOpen(false)}
        title="Register Vehicle"
      >
        <form onSubmit={handleSaveVehicle} className="space-y-4 text-sm font-sans">
          {vehicleError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs font-mono">
              {vehicleError}
            </div>
          )}

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">Vehicle Plate Number (PK)</label>
            <input
              type="text"
              value={vehicleForm.vehicle_no}
              onChange={(e) => setVehicleForm({ ...vehicleForm, vehicle_no: e.target.value.toUpperCase() })}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-[#10E599] text-xs"
              placeholder="e.g. TN11AA1234"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">Vehicle Type</label>
              <select
                value={vehicleForm.type}
                onChange={(e) => setVehicleForm({ ...vehicleForm, type: e.target.value })}
                className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-[#10E599] text-xs"
              >
                <option value="Sedan">Sedan</option>
                <option value="SUV">SUV</option>
                <option value="Hatchback">Hatchback</option>
                <option value="EV Sedan">EV Sedan</option>
                <option value="EV SUV">EV SUV</option>
                <option value="Coupe">Coupe</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">Color</label>
              <input
                type="text"
                value={vehicleForm.color}
                onChange={(e) => setVehicleForm({ ...vehicleForm, color: e.target.value })}
                className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-[#10E599] text-xs"
                placeholder="e.g. Midnight Blue"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">Vehicle Owner (Foreign Key)</label>
            <select
              value={vehicleForm.owner_id}
              onChange={(e) => setVehicleForm({ ...vehicleForm, owner_id: e.target.value })}
              className="w-full bg-[#06090D] border border-[#16202C] rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-[#10E599] text-xs"
              required
            >
              {owners.map((o) => (
                <option key={o.owner_id} value={o.owner_id}>
                  #{o.owner_id}: {o.name} ({o.phone})
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[#16202C]">
            <button
              type="button"
              onClick={() => setVehicleModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[#10E599] hover:bg-[#05D688] text-slate-950 font-bold rounded-xl text-xs transition-all"
            >
              Register Vehicle
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
