const API_BASE = '/api';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  const response = await fetch(url, config);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = data?.message || data?.error || `Request failed with status ${response.status}`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const api = {
  getHealth: () => request('/health'),
  getDashboardSummary: () => request('/dashboard/summary'),

  getSlots: () => request('/slots'),
  getSlot: (id) => request(`/slots/${id}`),
  createSlot: (data) => request('/slots', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  recommendSlot: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/slots/recommendation${query ? `?${query}` : ''}`);
  },
  updateSlotStatus: (id, status) => request(`/slots/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  }),
  deleteSlot: (id) => request(`/slots/${id}`, {
    method: 'DELETE',
  }),
  getSlotTypes: () => request('/slots/types'),
  updateSlotTypeRate: (id, base_rate) => request(`/slots/types/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ base_rate }),
  }),

  getOwners: () => request('/owners'),
  getOwner: (id) => request(`/owners/${id}`),
  createOwner: (data) => request('/owners', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateOwner: (id, data) => request(`/owners/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  deleteOwner: (id) => request(`/owners/${id}`, {
    method: 'DELETE',
  }),

  getVehicles: () => request('/vehicles'),
  getVehicle: (no) => request(`/vehicles/${encodeURIComponent(no)}`),
  createVehicle: (data) => request('/vehicles', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateVehicle: (no, data) => request(`/vehicles/${encodeURIComponent(no)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  deleteVehicle: (no) => request(`/vehicles/${encodeURIComponent(no)}`, {
    method: 'DELETE',
  }),

  getStaff: () => request('/staff'),
  createStaff: (data) => request('/staff', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateStaff: (id, data) => request(`/staff/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  deleteStaff: (id) => request(`/staff/${id}`, {
    method: 'DELETE',
  }),

  getTickets: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/tickets${query ? `?${query}` : ''}`);
  },
  getTicket: (id) => request(`/tickets/${id}`),
  openTicket: (data) => request('/tickets', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  closeTicket: (id) => request(`/tickets/${id}/close`, {
    method: 'POST',
  }),

  getHourlyOccupancy: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/analytics/hourly${query ? `?${query}` : ''}`);
  },
  getDailyOccupancy: () => request('/analytics/daily'),
  getPeakDemand: () => request('/analytics/peak-demand'),
  getSlotTypeOccupancy: () => request('/analytics/slot-types'),
  getPricingPredictions: () => request('/analytics/pricing-predictions'),
  getOccupancyPredictions: () => request('/analytics/occupancy-predictions'),
  getContinuousAggregate: () => request('/analytics/continuous-aggregate'),

  getBirminghamSummary: () => request('/birmingham/summary'),
  getBirminghamHourly: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/birmingham/hourly${query ? `?${query}` : ''}`);
  },
  getSFparkSummary: () => request('/sfpark/summary'),
  getSFparkHourly: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/sfpark/hourly${query ? `?${query}` : ''}`);
  },
  getSFparkPricingAnalysis: () => request('/sfpark/pricing-analysis'),
  getSFparkPricingRecommendations: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/sfpark/pricing-recommendations${query ? `?${query}` : ''}`);
  },
  getFacilityPricingRecommendations: () => request('/analytics/facility-pricing-recommendations'),
  getPredictionStatus: () => request('/predictions/status'),
  generatePredictions: (mode = 'historical_replay') => request('/predictions/generate', {
    method: 'POST',
    body: JSON.stringify({ mode })
  }),
  getTelemetryStatus: () => request('/telemetry/status'),
  getRecentTelemetry: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/telemetry/recent${query ? `?${query}` : ''}`);
  },
  ingestTelemetry: (readings, apiKey) => request('/telemetry/readings', {
    method: 'POST',
    headers: apiKey ? { 'x-telemetry-key': apiKey } : {},
    body: JSON.stringify(readings)
  }),
  getDatasetManifest: () => request('/datasets/manifest'),
  getDatasetsGlobalSummary: () => request('/datasets/summary'),
};

