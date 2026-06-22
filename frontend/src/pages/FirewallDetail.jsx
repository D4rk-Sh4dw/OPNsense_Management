import React, { useState, useEffect } from 'react'
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
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    loadAll()
  }, [id])

  useEffect(() => {
    if (firewall) loadLogs()
  }, [logType])

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

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
    </div>
  )

  if (error || !firewall) return (
    <div className="p-8 text-red-600">{error || 'Not found'}</div>
  )

  const licenseColor = firewall.license_type === 'business'
    ? 'bg-purple-100 text-purple-800'
    : firewall.license_type === 'community'
    ? 'bg-blue-100 text-blue-800'
    : 'bg-gray-100 text-gray-600'

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
        <Link to="/firewalls" className="text-indigo-600 hover:text-indigo-800">← Back</Link>
        <div className="flex-1">
          <h1 className="text-4xl font-black text-gray-900">{firewall.customer_name}</h1>
          <p className="text-gray-500">{firewall.hostname || firewall.ip}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleHealthCheck} disabled={loadingHealth}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 font-semibold">
            {loadingHealth ? '...' : '🔄 Check Health'}
          </button>
          {status?.updates_available > 0 && (
            <button onClick={handleInstallUpdates} disabled={loadingUpdate}
              className="bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition disabled:opacity-50 font-semibold">
              {loadingUpdate ? '...' : `⚡ Install ${status.updates_available} Update(s)`}
            </button>
          )}
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Status" value={status?.online ? '🟢 Online' : '🔴 Offline'} />
        <StatCard label="Firmware" value={status?.firmware_version || '—'} />
        <StatCard label="CPU" value={status?.cpu_usage != null ? `${status.cpu_usage.toFixed(1)}%` : '—'} />
        <StatCard label="RAM" value={status?.ram_usage != null ? `${status.ram_usage.toFixed(1)}%` : '—'} />
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Firewall Info */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-bold mb-4 text-gray-900">Firewall Info</h2>
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
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-900">License</h2>
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
              <p className="text-sm text-gray-700">{firewall.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Gateway Status */}
      {status?.gateway_status && (
        <div className="bg-white rounded-xl shadow p-6 mb-8">
          <h2 className="text-xl font-bold mb-4 text-gray-900">Gateway Status</h2>
          <pre className="text-xs text-gray-700 overflow-x-auto bg-gray-50 p-4 rounded-lg">
            {JSON.stringify(status.gateway_status, null, 2)}
          </pre>
        </div>
      )}

      {/* Live Logs */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900">Live Logs</h2>
          <div className="flex gap-2">
            {['firewall', 'system', 'backend'].map(t => (
              <button key={t} onClick={() => setLogType(t)}
                className={`px-3 py-1 rounded-lg text-sm font-semibold transition ${logType === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {t}
              </button>
            ))}
            <button onClick={loadLogs} className="px-3 py-1 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200">
              🔄
            </button>
          </div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 h-64 overflow-y-auto font-mono text-xs text-green-400">
          {loadingLogs ? (
            <p className="text-gray-400">Loading logs...</p>
          ) : logs.length > 0 ? (
            logs.map((log, i) => (
              <div key={i} className="mb-1 whitespace-pre-wrap break-all">
                {formatLogEntry(log)}
              </div>
            ))
          ) : (
            <p className="text-gray-400">No log entries found.</p>
          )}
        </div>
      </div>

      {/* S.M.A.R.T. Disk Health */}
      <div className="bg-white rounded-xl shadow p-6 mt-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900">S.M.A.R.T. Disk Health</h2>
          <button onClick={loadSmart} disabled={loadingSmart}
            className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-lg font-semibold disabled:opacity-50">
            {loadingSmart ? '...' : '🔄 Refresh'}
          </button>
        </div>
        {loadingSmart ? (
          <p className="text-gray-500 text-sm">Loading SMART data...</p>
        ) : !smart?.available ? (
          <p className="text-gray-500 text-sm">
            SMART unavailable {smart?.reason ? `(${smart.reason})` : ''}. Install the <span className="font-mono">os-smart</span> plugin on the firewall.
          </p>
        ) : smart.devices.length === 0 ? (
          <p className="text-gray-500 text-sm">No SMART-capable devices detected.</p>
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
                          ? 'bg-green-100 text-green-800'
                          : String(d.status).toUpperCase() === 'FAILED'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-700'
                      }`}>{d.status || 'unknown'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <p className="text-xs font-bold uppercase text-gray-400 mb-1">{label}</p>
      <p className="text-lg font-bold text-gray-900">{value}</p>
    </div>
  )
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="font-semibold text-gray-500 shrink-0">{label}</dt>
      <dd className={`text-right text-gray-900 ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</dd>
    </div>
  )
}
