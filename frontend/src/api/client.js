import axios from 'axios'

const API_BASE = '/api'

const api = axios.create({
  baseURL: API_BASE,
})

/** Strip empty strings to null before sending to backend */
export function sanitize(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, v === '' ? null : v])
  )
}

// Firewall API
export const firewallsAPI = {
  list: () => api.get('/firewalls'),
  get: (id) => api.get(`/firewalls/${id}`),
  create: (data) => api.post('/firewalls', sanitize(data)),
  update: (id, data) => api.patch(`/firewalls/${id}`, sanitize(data)),
  delete: (id) => api.delete(`/firewalls/${id}`),
  checkHealth: (id) => api.post(`/firewalls/${id}/check-health`),
  getStatus: (id) => api.get(`/firewalls/${id}/status`),
  fetchLicense: (id) => api.post(`/firewalls/${id}/fetch-license`),
  getLogs: (id, logType = 'firewall', limit = 100) =>
    api.get(`/firewalls/${id}/logs`, { params: { log_type: logType, limit } }),
  getSmart: (id) => api.get(`/firewalls/${id}/smart`),
  getLiveStats: (id) => api.get(`/firewalls/${id}/live-stats`),
  getServices: (id) => api.get(`/firewalls/${id}/services`),
  startService: (id, payload) => api.post(`/firewalls/${id}/services/start`, payload),
  restartService: (id, payload) => api.post(`/firewalls/${id}/services/restart`, payload),
  getMapData: () => api.get('/firewalls/map'),
  geocode: (id, address) => api.post(`/firewalls/${id}/geocode`, { address }),
  reboot: (id) => api.post(`/firewalls/${id}/reboot`),
  updateApiSecret: (id, apiSecret) =>
    api.post(`/firewalls/${id}/update-api-secret`, { api_secret: apiSecret }),
  updateSubscriptionKey: (id, subscriptionKey) =>
    api.post(`/firewalls/${id}/subscription-key`, { subscription_key: subscriptionKey }),
}

export const firewallTagsAPI = {
  list: () => api.get('/firewalls/tags'),
  create: (name) => api.post('/firewalls/tags', { name }),
  delete: (tagId) => api.delete(`/firewalls/tags/${tagId}`),
}

// Monitoring API
export const monitoringAPI = {
  getDashboard: () => api.get('/firewalls/dashboard/summary'),
  getQuickStatus: () => api.get('/firewalls/dashboard/firewalls-quick'),
  getLiveStatus: () => api.get('/firewalls/dashboard/firewalls-live'),
}

// Backups API
export const backupsAPI = {
  list: (firewallId) => api.get(`/backups/firewalls/${firewallId}`),
  create: (firewallId) => api.post(`/backups/firewalls/${firewallId}/create`),
  restore: (firewallId, backupId, areas = null) =>
    api.post(`/backups/firewalls/${firewallId}/restore`, { backup_id: backupId, areas }),
  delete: (firewallId, backupId) => api.delete(`/backups/firewalls/${firewallId}/backups/${backupId}`),
  downloadUrl: (firewallId, backupId) =>
    `/api/backups/firewalls/${firewallId}/backups/${backupId}/download`,
  diff: (firewallId, backupIdA, backupIdB) =>
    api.post(`/backups/firewalls/${firewallId}/diff`, {
      backup_id_a: backupIdA,
      backup_id_b: backupIdB,
    }),
}

// Updates API
export const updatesAPI = {
  checkUpdates: (firewallId) => api.post(`/updates/firewalls/${firewallId}/check`),
  installUpdates: (firewallId) => api.post(`/updates/firewalls/${firewallId}/install`),
  getHistory: (firewallId) => api.get(`/updates/firewalls/${firewallId}/history`),
  getAllHistory: (params) => api.get('/updates/history', { params }),
  getPending: () => api.get('/updates/pending'),
}

// Alerts API
export const alertsAPI = {
  list: (params) => api.get('/alerts', { params }),
  get: (id) => api.get(`/alerts/${id}`),
  resolve: (id) => api.post(`/alerts/${id}/resolve`),
  delete: (id) => api.delete(`/alerts/${id}`),
}

// Email API (templates + branding)
export const emailAPI = {
  listTemplates: () => api.get('/email/templates'),
  getTemplate: (key) => api.get(`/email/templates/${key}`),
  updateTemplate: (key, data) => api.patch(`/email/templates/${key}`, data),
  preview: (templateKey, sampleData = null) =>
    api.post('/email/preview', { template_key: templateKey, sample_data: sampleData }),
  sendTest: (key, recipients) => api.post(`/email/templates/${key}/test`, { recipients }),
  getBranding: () => api.get('/email/branding'),
  updateBranding: (data) => api.patch('/email/branding', data),
}

export const settingsAPI = {
  getScheduler: () => api.get('/settings/scheduler'),
  updateScheduler: (data) => api.patch('/settings/scheduler', data),
}

// Comments API
export const commentsAPI = {
  list: (entityType, entityId) => api.get(`/comments/${entityType}/${entityId}`),
  create: (entityType, entityId, content, author) =>
    api.post(`/comments/${entityType}/${entityId}`, { content, author }),
  delete: (commentId) => api.delete(`/comments/${commentId}`),
}

// IDS / Intrusion Detection API
export const idsAPI = {
  getAlerts: (firewallId, limit = 200) =>
    api.get(`/firewalls/${firewallId}/ids/alerts`, { params: { limit } }),
  getStatus: (firewallId) => api.get(`/firewalls/${firewallId}/ids/status`),
}

// Firewall Rules & Aliases API
export const rulesAPI = {
  getRules: (firewallId, limit = 500) =>
    api.get(`/firewalls/${firewallId}/rules`, { params: { limit } }),
  getAliases: (firewallId, limit = 500) =>
    api.get(`/firewalls/${firewallId}/aliases`, { params: { limit } }),
}

// VPN API
export const vpnAPI = {
  getOpenVPN: (firewallId) => api.get(`/firewalls/${firewallId}/vpn/openvpn`),
  getWireGuard: (firewallId) => api.get(`/firewalls/${firewallId}/vpn/wireguard`),
}

export default api
