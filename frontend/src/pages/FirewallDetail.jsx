import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { firewallsAPI, backupsAPI, updatesAPI } from '../api/client'

export default function FirewallDetail() {
  const { id } = useParams()
  const [firewall, setFirewall] = useState(null)
  const [status, setStatus] = useState(null)
  const [logs, setLogs] = useState([])
  const [logType, setLogType] = useState('firewall')
  const [smart, setSmart] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [loadingSmart, setLoadingSmart] = useState(false)
  const [loadingLicense, setLoadingLicense] = useState(false)
  const [loadingHealth, setLoadingHealth] = useState(false)
  const [loadingUpdate, setLoadingUpdate] = useState(false)
  const [loadingCheck, setLoadingCheck] = useState(false)
  const [loadingReboot, setLoadingReboot] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [liveStats, setLiveStats] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  // Log filtering & scroll handling
  const [logFilter, setLogFilter] = useState({ action: 'all', iface: 'all', search: '' })
  const logContainerRef = useRef(null)
  const [autoFollowLogs, setAutoFollowLogs] = useState(true)

  useEffect(() => {
    loadAll()
  }, [id])

  useEffect(() => {
    if (firewall) loadLogs()
  }, [logType])

  // Auto-refresh live CPU/RAM/uptime (paused when tab is hidden)
  useEffect(() => {
    if (!firewall || !autoRefresh) return
    let cancelled = false
    let timer = null
    const tick = async () => {
      if (document.hidden) return
      try {
        const res = await firewallsAPI.getLiveStats(id)
        if (!cancelled) setLiveStats(res.data)
      } catch {
        if (!cancelled) setLiveStats(prev => prev ? { ...prev, online: false } : null)
      }
    }
    tick()
    timer = setInterval(tick, 10000)
    const onVis = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [id, firewall, autoRefresh])

  // Refresh logs every 30s in auto-refresh mode (skipped when tab is hidden)
  useEffect(() => {
    if (!firewall || !autoRefresh) return
    const tick = () => { if (!document.hidden) loadLogs() }
    const interval = setInterval(tick, 30000)
    return () => clearInterval(interval)
  }, [id, firewall, autoRefresh, logType])

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const loadAll = async () => {
    setLoading(true)
    try {
      const [fwRes, stRes] = await Promise.all([
        firewallsAPI.get(id),
        firewallsAPI.getStatus(id),
      ])
      setFirewall(fwRes.data)
      setStatus(stRes.data)
      setError(null)
      loadSmart()
    } catch (e) {
      setError('Failed to load firewall')
    } finally {
      setLoading(false)
    }
  }

  const loadSmart = async () => {
    setLoadingSmart(true)
    try {
      const res = await firewallsAPI.getSmart(id)
      setSmart(res.data)
    } catch (e) {
      setSmart({ available: false, reason: 'unavailable', devices: [] })
    } finally {
      setLoadingSmart(false)
    }
  }

  const loadLogs = async () => {
    setLoadingLogs(true)
    try {
      const res = await firewallsAPI.getLogs(id, logType, 50)
      const raw = res.data
      let entries = []
      if (Array.isArray(raw)) entries = raw
      else if (Array.isArray(raw?.rows)) entries = raw.rows
      else if (Array.isArray(raw?.data)) entries = raw.data
      else if (raw && typeof raw === 'object') entries = Object.values(raw)
      setLogs(entries)
    } catch (e) {
      setLogs([])
    } finally {
      setLoadingLogs(false)
    }
  }

  const formatLogEntry = (log) => {
    if (typeof log === 'string') return log
    if (!log || typeof log !== 'object') return String(log)
    const ts = log.__timestamp__ || log.timestamp || log.time || log['@timestamp'] || ''
    const action = log.action ? `[${log.action}]` : ''
    const iface = log.interface || log.if || ''
    const proto = log.protoname || log.proto || ''
    const src = log.src || log.source || log.srcip
    const sport = log.srcport ? `:${log.srcport}` : ''
    const dst = log.dst || log.destination || log.dstip
    const dport = log.dstport ? `:${log.dstport}` : ''
    const msg = log.msg || log.message || log.line
    if (src || dst) {
      return `${ts} ${action} ${iface} ${proto} ${src || ''}${sport} → ${dst || ''}${dport}`.trim()
    }
    if (msg) return `${ts} ${msg}`.trim()
    return JSON.stringify(log)
  }

  const handleFetchLicense = async () => {
    setLoadingLicense(true)
    try {
      const res = await firewallsAPI.fetchLicense(id)
      showToast(`License: ${res.data.license_type} – ${res.data.product_name} ${res.data.product_version}`)
      loadAll()
    } catch (e) {
      showToast('Could not fetch license from firewall', false)
    } finally {
      setLoadingLicense(false)
    }
  }

  const handleHealthCheck = async () => {
    setLoadingHealth(true)
    try {
      await firewallsAPI.checkHealth(id)
      await loadAll()
      showToast('Health check completed')
    } catch (e) {
      showToast('Health check failed', false)
    } finally {
      setLoadingHealth(false)
    }
  }

  const handleInstallUpdates = async () => {
    if (!window.confirm('Start firmware update? A backup will be created automatically.')) return
    setLoadingUpdate(true)
    try {
      await updatesAPI.installUpdates(id)
      showToast('Update started in background')
    } catch (e) {
      showToast('Failed to start update', false)
    } finally {
      setLoadingUpdate(false)
    }
  }

  const handleCheckUpdates = async () => {
    setLoadingCheck(true)
    try {
      const res = await updatesAPI.checkUpdates(id)
      const n = res.data?.updates_available ?? 0
      showToast(n > 0 ? `${n} update(s) available` : 'Firewall is up to date')
      loadAll()
    } catch (e) {
      showToast('Update check failed: ' + (e.response?.data?.detail || e.message), false)
    } finally {
      setLoadingCheck(false)
    }
  }

  const handleReboot = async () => {
    if (!window.confirm('Reboot the firewall? It will be offline for a few minutes.')) return
    setLoadingReboot(true)
    try {
      await firewallsAPI.reboot(id)
      showToast('Reboot initiated')
    } catch (e) {
      showToast('Reboot failed: ' + (e.response?.data?.detail || e.message), false)
    } finally {
      setLoadingReboot(false)
    }
  }

  const openEdit = () => {
    setEditForm({
      customer_name: firewall.customer_name || '',
      hostname: firewall.hostname || '',
      ip: firewall.ip || '',
      api_key: firewall.api_key || '',
      notify_email: firewall.notify_email || '',
      auto_update: !!firewall.auto_update,
      auto_update_window: firewall.auto_update_window || '',
      backup_interval: firewall.backup_interval || 'daily',
      backup_retention: firewall.backup_retention || 7,
      verify_ssl: !!firewall.verify_ssl,
      license_type: firewall.license_type || '',
      license_expiry: firewall.license_expiry ? firewall.license_expiry.split('T')[0] : '',
      tags: firewall.tags || '',
      notes: firewall.notes || '',
      api_secret: '',
    })
    setEditOpen(true)
  }

  const saveEdit = async () => {
    setSavingEdit(true)
    try {
      const payload = { ...editForm }
      const newSecret = payload.api_secret
      delete payload.api_secret
      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null })
      await firewallsAPI.update(id, payload)
      if (newSecret && newSecret.trim()) {
        await firewallsAPI.updateApiSecret(id, newSecret.trim())
      }
      showToast('Firewall settings updated')
      setEditOpen(false)
      loadAll()
    } catch (e) {
      showToast('Save failed: ' + (e.response?.data?.detail || e.message), false)
    } finally {
      setSavingEdit(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
    </div>
  )

  if (error || !firewall) return (
    <div className="p-8 text-red-600 dark:text-red-400">{error || 'Not found'}</div>
  )

  const licenseColor = firewall.license_type === 'business'
    ? 'bg-purple-100 text-purple-800'
    : firewall.license_type === 'community'
    ? 'bg-blue-100 text-blue-800'
    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-6 py-3 rounded-lg shadow-lg font-semibold text-white transition-all ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link to="/firewalls" className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800">← Back</Link>
        <div className="flex-1">
          <h1 className="text-4xl font-black text-gray-900 dark:text-gray-100">{firewall.customer_name}</h1>
          <p className="text-gray-500 dark:text-gray-400">{firewall.hostname || firewall.ip}</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            <span className="font-semibold text-gray-700 dark:text-gray-300">Live</span>
            {autoRefresh && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>}
          </label>
          <button onClick={openEdit}
            className="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition font-semibold">
            ✎ Edit
          </button>
          <button onClick={handleHealthCheck} disabled={loadingHealth}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 font-semibold">
            {loadingHealth ? '...' : '🔄 Check Health'}
          </button>
          <button onClick={handleCheckUpdates} disabled={loadingCheck}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 font-semibold">
            {loadingCheck ? '...' : '🔎 Check Updates'}
          </button>
          {status?.updates_available > 0 && (
            <button onClick={handleInstallUpdates} disabled={loadingUpdate}
              className="bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition disabled:opacity-50 font-semibold">
              {loadingUpdate ? '...' : `⚡ Install ${status.updates_available} Update(s)`}
            </button>
          )}
          <button onClick={handleReboot} disabled={loadingReboot}
            className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition disabled:opacity-50 font-semibold">
            {loadingReboot ? '...' : '⏻ Reboot'}
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Status" value={(liveStats?.online ?? status?.online) ? '🟢 Online' : '🔴 Offline'} />
        <StatCard label="Firmware" value={status?.firmware_version || '—'} />
        <StatCard label="CPU" value={(liveStats?.cpu_usage ?? status?.cpu_usage) != null
          ? `${(liveStats?.cpu_usage ?? status?.cpu_usage).toFixed(1)}%` : '—'} live={autoRefresh && liveStats?.cpu_usage != null} />
        <StatCard label="RAM" value={(liveStats?.ram_usage ?? status?.ram_usage) != null
          ? `${(liveStats?.ram_usage ?? status?.ram_usage).toFixed(1)}%` : '—'} live={autoRefresh && liveStats?.ram_usage != null} />
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Firewall Info */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
          <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">Firewall Info</h2>
          <dl className="space-y-3 text-sm">
            <Row label="IP / URL" value={firewall.ip} mono />
            <Row label="API Key" value={firewall.api_key} mono />
            <Row label="Backup Interval" value={firewall.backup_interval} />
            <Row label="Auto Update" value={firewall.auto_update ? '✓ Enabled' : 'Disabled'} />
            <Row label="Auto Update Window" value={firewall.auto_update_window || '—'} />
            <Row label="Backup Retention" value={`${firewall.backup_retention} backups`} />
            <Row label="Notify Email" value={firewall.notify_email || '—'} />
            <Row label="Created" value={new Date(firewall.created_at).toLocaleDateString()} />
            <Row label="Last Seen" value={firewall.last_seen ? new Date(firewall.last_seen).toLocaleString() : 'Never'} />
          </dl>
        </div>

        {/* License Info */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">License</h2>
            <button onClick={handleFetchLicense} disabled={loadingLicense}
              className="text-sm bg-indigo-100 text-indigo-700 px-3 py-1 rounded-lg hover:bg-indigo-200 transition disabled:opacity-50 font-semibold">
              {loadingLicense ? '...' : '🔍 Fetch from Firewall'}
            </button>
          </div>
          <dl className="space-y-3 text-sm">
            <Row label="Type" value={
              <span className={`px-2 py-1 rounded-full text-xs font-bold ${licenseColor}`}>
                {firewall.license_type || 'Unknown'}
              </span>
            } />
            <Row label="Expiry" value={firewall.license_expiry ? new Date(firewall.license_expiry).toLocaleDateString() : '—'} />
          </dl>
          {firewall.notes && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-xs font-bold uppercase text-gray-400 mb-1">Notes</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">{firewall.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Gateway Status */}
      {status?.gateway_status && <GatewayStatusCard data={status.gateway_status} />}

      {/* Live Logs */}
      <LiveLogsCard
        logs={logs}
        loadingLogs={loadingLogs}
        logType={logType}
        setLogType={setLogType}
        onRefresh={loadLogs}
        filter={logFilter}
        setFilter={setLogFilter}
        autoFollow={autoFollowLogs}
        setAutoFollow={setAutoFollowLogs}
        containerRef={logContainerRef}
        formatLogEntry={formatLogEntry}
      />

      {/* S.M.A.R.T. Disk Health */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mt-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">S.M.A.R.T. Disk Health</h2>
          <button onClick={loadSmart} disabled={loadingSmart}
            className="text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:bg-gray-600 px-3 py-1 rounded-lg font-semibold disabled:opacity-50">
            {loadingSmart ? '...' : '🔄 Refresh'}
          </button>
        </div>
        {loadingSmart ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">Loading SMART data...</p>
        ) : !smart?.available ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            SMART unavailable {smart?.reason ? `(${smart.reason})` : ''}. Install the <span className="font-mono">os-smart</span> plugin on the firewall.
          </p>
        ) : smart.devices.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">No SMART-capable devices detected.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase">
                  <th className="py-2 pr-4">Device</th>
                  <th className="py-2 pr-4">Model</th>
                  <th className="py-2 pr-4">Serial</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {smart.devices.map((d, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-2 pr-4 font-mono">{d.device}</td>
                    <td className="py-2 pr-4">{d.model || '—'}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{d.serial || '—'}</td>
                    <td className="py-2 pr-4">{d.type || '—'}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        String(d.status).toUpperCase() === 'PASSED' || String(d.status).toUpperCase() === 'OK'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                          : String(d.status).toUpperCase() === 'FAILED'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}>{d.status || 'unknown'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h3 className="text-2xl font-black text-gray-900 dark:text-gray-100">Edit Firewall</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{firewall.customer_name}</p>
            </div>
            <div className="p-6 grid md:grid-cols-2 gap-4 text-sm">
              <Field label="Customer Name" value={editForm.customer_name}
                onChange={v => setEditForm({...editForm, customer_name: v})} />
              <Field label="Hostname" value={editForm.hostname}
                onChange={v => setEditForm({...editForm, hostname: v})} />
              <Field label="IP / URL" value={editForm.ip}
                onChange={v => setEditForm({...editForm, ip: v})} />
              <Field label="API Key" value={editForm.api_key}
                onChange={v => setEditForm({...editForm, api_key: v})} mono />
              <Field label="API Secret (leave empty to keep)" value={editForm.api_secret}
                onChange={v => setEditForm({...editForm, api_secret: v})} mono type="password" />
              <Field label="Notify Email" value={editForm.notify_email}
                onChange={v => setEditForm({...editForm, notify_email: v})} />
              <SelectField label="License Type" value={editForm.license_type}
                onChange={v => setEditForm({...editForm, license_type: v})}
                options={[['', '—'], ['community', 'Community'], ['business', 'Business']]} />
              <Field label="License Expiry" type="date" value={editForm.license_expiry}
                onChange={v => setEditForm({...editForm, license_expiry: v})} />
              <SelectField label="Backup Interval" value={editForm.backup_interval}
                onChange={v => setEditForm({...editForm, backup_interval: v})}
                options={[['hourly','Hourly'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']]} />
              <Field label="Backup Retention" type="number" value={editForm.backup_retention}
                onChange={v => setEditForm({...editForm, backup_retention: parseInt(v) || 0})} />
              <Field label="Auto Update Window (e.g. 02:00-04:00)" value={editForm.auto_update_window}
                onChange={v => setEditForm({...editForm, auto_update_window: v})} />
              <Field label="Tags (comma-separated)" value={editForm.tags}
                onChange={v => setEditForm({...editForm, tags: v})} />
              <div className="flex items-center gap-2 col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editForm.auto_update}
                    onChange={e => setEditForm({...editForm, auto_update: e.target.checked})} />
                  <span className="font-semibold">Auto-install updates</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer ml-6">
                  <input type="checkbox" checked={editForm.verify_ssl}
                    onChange={e => setEditForm({...editForm, verify_ssl: e.target.checked})} />
                  <span className="font-semibold">Verify SSL</span>
                </label>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">Notes</label>
                <textarea value={editForm.notes}
                  onChange={e => setEditForm({...editForm, notes: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  rows="3" />
              </div>
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={() => setEditOpen(false)}
                className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:bg-gray-600 font-semibold">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={savingEdit}
                className="px-6 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50">
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', mono = false }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)}
        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 ${mono ? 'font-mono text-xs' : ''}`} />
    </div>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white dark:bg-gray-800">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

function StatCard({ label, value, live }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 relative">
      <p className="text-xs font-bold uppercase text-gray-400 mb-1 flex items-center gap-2">
        {label}
        {live && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>}
      </p>
      <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  )
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="font-semibold text-gray-500 dark:text-gray-400 shrink-0">{label}</dt>
      <dd className={`text-right text-gray-900 dark:text-gray-100 ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</dd>
    </div>
  )
}

function GatewayStatusCard({ data }) {
  // OPNsense gateway status format: { items: { GW_NAME: { name, address, status, loss, delay, stddev, monitor, ... }}}
  // or older: { items: [...] }
  const gateways = useMemo(() => {
    if (!data) return []
    const items = data.items ?? data
    if (Array.isArray(items)) return items
    if (typeof items === 'object') return Object.values(items)
    return []
  }, [data])

  const statusBadge = (status) => {
    const s = String(status || '').toLowerCase()
    if (!s || s === 'none') return 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
    if (s.includes('online') && !s.includes('loss') && !s.includes('delay')) return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
    if (s.includes('warning') || s.includes('delay') || s.includes('loss')) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'
    if (s.includes('offline') || s.includes('down') || s.includes('force')) return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
    return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }

  const statusLabel = (g) => {
    const raw = String(g.status ?? '').toLowerCase()
    if (raw && raw !== 'none') return g.status_translated || g.status
    // No active monitoring → fall back to translated text or "Monitoring disabled"
    if (g.status_translated && String(g.status_translated).toLowerCase() !== 'none') {
      return g.status_translated
    }
    return 'No monitor'
  }

  const lossBarColor = (loss) => {
    const v = parseFloat(loss) || 0
    if (v >= 50) return 'bg-red-500'
    if (v >= 10) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  if (gateways.length === 0) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8">
      <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">Gateway Status</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 uppercase border-b">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Address</th>
              <th className="py-2 pr-4">Monitor</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Loss</th>
              <th className="py-2 pr-4">Delay</th>
              <th className="py-2 pr-4">Stddev</th>
            </tr>
          </thead>
          <tbody>
            {gateways.map((g, i) => {
              const loss = parseFloat(g.loss) || 0
              return (
                <tr key={i} className="border-b hover:bg-gray-50 dark:bg-gray-900">
                  <td className="py-3 pr-4 font-semibold">{g.name || '—'}</td>
                  <td className="py-3 pr-4 font-mono text-xs">{g.address || g.gateway || '—'}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-gray-500 dark:text-gray-400">{g.monitor || '—'}</td>
                  <td className="py-3 pr-4">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${statusBadge(g.status)}`}>
                      {statusLabel(g)}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                        <div className={`h-2 rounded-full ${lossBarColor(g.loss)}`}
                          style={{ width: `${Math.min(loss, 100)}%` }}></div>
                      </div>
                      <span className="text-xs font-mono w-12 text-right">{g.loss || '0%'}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">{g.delay || '—'}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-gray-500 dark:text-gray-400">{g.stddev || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LiveLogsCard({ logs, loadingLogs, logType, setLogType, onRefresh, filter, setFilter, autoFollow, setAutoFollow, containerRef, formatLogEntry }) {
  // Collect distinct interfaces for filter dropdown
  const interfaces = useMemo(() => {
    const set = new Set()
    logs.forEach(l => {
      if (typeof l === 'object' && l) {
        const iface = l.interface || l.if
        if (iface) set.add(iface)
      }
    })
    return Array.from(set).sort()
  }, [logs])

  // Apply filters
  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      if (typeof l !== 'object' || l === null) {
        // string logs only support search filter
        if (filter.search) return String(l).toLowerCase().includes(filter.search.toLowerCase())
        return filter.action === 'all'
      }
      const action = String(l.action || '').toLowerCase()
      if (filter.action === 'pass' && !(action === 'pass' || action === 'allow' || action === 'accept')) return false
      if (filter.action === 'block' && !(action === 'block' || action === 'reject' || action === 'drop')) return false
      const iface = l.interface || l.if
      if (filter.iface !== 'all' && iface !== filter.iface) return false
      if (filter.search) {
        const needle = filter.search.toLowerCase()
        const haystack = [
          l.src, l.dst, l.srcport, l.dstport, l.protoname, l.proto, l.action, l.label, l.rid, l.msg, l.line
        ].filter(Boolean).map(String).join(' ').toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [logs, filter])

  // Determine line color from action
  const lineClass = (log) => {
    if (typeof log !== 'object' || log === null) return 'text-gray-300'
    const action = String(log.action || '').toLowerCase()
    if (action === 'pass' || action === 'allow' || action === 'accept') return 'text-green-400 border-l-2 border-green-500 pl-2'
    if (action === 'block' || action === 'reject' || action === 'drop') return 'text-red-400 border-l-2 border-red-500 pl-2'
    return 'text-gray-300 border-l-2 border-gray-700 pl-2'
  }

  // Preserve scroll position; auto-follow only when user is near bottom
  const prevScrollRef = useRef({ top: 0, height: 0 })

  // Detect user scrolling away from bottom → disable auto-follow
  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    if (autoFollow !== nearBottom) setAutoFollow(nearBottom)
  }

  // Before logs update we capture the scroll state; after update we apply
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (autoFollow) {
      el.scrollTop = el.scrollHeight
    } else {
      // Restore previous scroll offset relative to bottom so content above stays in view
      const delta = el.scrollHeight - prevScrollRef.current.height
      el.scrollTop = prevScrollRef.current.top + (delta > 0 ? delta : 0)
    }
    prevScrollRef.current = { top: el.scrollTop, height: el.scrollHeight }
  }, [filteredLogs, autoFollow, containerRef])

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Live Logs</h2>
        <div className="flex gap-2 flex-wrap">
          {['firewall', 'system', 'backend'].map(t => (
            <button key={t} onClick={() => setLogType(t)}
              className={`px-3 py-1 rounded-lg text-sm font-semibold transition ${logType === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:bg-gray-600'}`}>
              {t}
            </button>
          ))}
          <button onClick={onRefresh} className="px-3 py-1 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:bg-gray-600">
            🔄
          </button>
        </div>
      </div>

      {/* Filters (only useful for firewall logs) */}
      {logType === 'firewall' && (
        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            {[['all', 'All'], ['pass', '✓ Pass'], ['block', '✕ Block']].map(([v, l]) => (
              <button key={v} onClick={() => setFilter({ ...filter, action: v })}
                className={`px-3 py-1 rounded text-xs font-semibold transition ${
                  filter.action === v
                    ? v === 'pass' ? 'bg-green-600 text-white'
                    : v === 'block' ? 'bg-red-600 text-white'
                    : 'bg-indigo-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:bg-gray-600'
                }`}>
                {l}
              </button>
            ))}
          </div>
          {interfaces.length > 0 && (
            <select value={filter.iface} onChange={e => setFilter({ ...filter, iface: e.target.value })}
              className="px-3 py-1 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-700 border-0">
              <option value="all">All interfaces</option>
              {interfaces.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          )}
          <input type="text" placeholder="Search IP, port, protocol..."
            value={filter.search}
            onChange={e => setFilter({ ...filter, search: e.target.value })}
            className="px-3 py-1 rounded-lg text-xs border bg-white dark:bg-gray-800 flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-indigo-600" />
          <span className="text-xs text-gray-500 dark:text-gray-400">{filteredLogs.length}/{logs.length}</span>
        </div>
      )}

      <div ref={containerRef} onScroll={handleScroll}
        className="bg-gray-900 rounded-lg p-4 h-80 overflow-y-auto font-mono text-xs">
        {loadingLogs && logs.length === 0 ? (
          <p className="text-gray-400">Loading logs...</p>
        ) : filteredLogs.length > 0 ? (
          filteredLogs.map((log, i) => (
            <div key={i} className={`mb-1 whitespace-pre-wrap break-all ${lineClass(log)}`}>
              {formatLogEntry(log)}
            </div>
          ))
        ) : logs.length > 0 ? (
          <p className="text-gray-400">No entries match the current filter.</p>
        ) : (
          <p className="text-gray-400">No log entries found.</p>
        )}
      </div>
      {!autoFollow && (
        <button onClick={() => setAutoFollow(true)}
          className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-semibold">
          ↓ Jump to latest
        </button>
      )}
    </div>
  )
}



