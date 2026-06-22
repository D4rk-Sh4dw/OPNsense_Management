import axios from 'axios'

const API_BASE = '/api'

const api = axios.create({
  baseURL: API_BASE,
})

// Firewall API
export const firewallsAPI = {
  list: () => api.get('/firewalls'),
  get: (id) => api.get(`/firewalls/${id}`),
  create: (data) => api.post('/firewalls', data),
  update: (id, data) => api.patch(`/firewalls/${id}`, data),
  delete: (id) => api.delete(`/firewalls/${id}`),
  checkHealth: (id) => api.post(`/firewalls/${id}/check-health`),
  getStatus: (id) => api.get(`/firewalls/${id}/status`),
}

// Monitoring API
export const monitoringAPI = {
  getDashboard: () => api.get('/firewalls/dashboard/summary'),
  getQuickStatus: () => api.get('/firewalls/dashboard/firewalls-quick'),
}

// Backups API
export const backupsAPI = {
  list: (firewallId) => api.get(`/backups/firewalls/${firewallId}`),
  create: (firewallId) => api.post(`/backups/firewalls/${firewallId}/create`),
  restore: (firewallId, backupId) => api.post(`/backups/firewalls/${firewallId}/restore`, { backup_id: backupId }),
  delete: (firewallId, backupId) => api.delete(`/backups/firewalls/${firewallId}/backups/${backupId}`),
}

// Updates API
export const updatesAPI = {
  checkUpdates: (firewallId) => api.post(`/updates/firewalls/${firewallId}/check`),
  installUpdates: (firewallId) => api.post(`/updates/firewalls/${firewallId}/install`),
  getHistory: (firewallId) => api.get(`/updates/firewalls/${firewallId}/history`),
  getPending: () => api.get('/updates/pending'),
}

// Alerts API
export const alertsAPI = {
  list: (params) => api.get('/alerts', { params }),
  get: (id) => api.get(`/alerts/${id}`),
  resolve: (id) => api.post(`/alerts/${id}/resolve`),
  delete: (id) => api.delete(`/alerts/${id}`),
}

export default api
