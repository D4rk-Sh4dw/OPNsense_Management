import React, { useState, useEffect, useMemo } from 'react'
import { firewallsAPI, idsAPI } from '../api/client'

export default function IDSDashboard() {
  const [firewalls, setFirewalls] = useState([])
  const [selected, setSelected] = useState(null)
  const [firewallSearch, setFirewallSearch] = useState('')
  const [alerts, setAlerts] = useState([])
  const [idsStatus, setIdsStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [error, setError] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [limit, setLimit] = useState(200)
  // Filters
  const [filter, setFilter] = useState({ action: 'all', search: '' })

  useEffect(() => {
    firewallsAPI.list().then(r => {
      const list = r.data || r
      setFirewalls(list)
      if (list.length > 0) setSelected(list[0].id)
    })
  }, [])

  useEffect(() => {
    if (selected) {
      loadStatus()
      loadAlerts()
    }
  }, [selected, limit])

  useEffect(() => {
    if (!selected || !autoRefresh) return
    const id = setInterval(() => {
      if (!document.hidden) loadAlerts()
    }, 30000)
    return () => clearInterval(id)
  }, [selected, autoRefresh, limit])

  const loadAlerts = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await idsAPI.getAlerts(selected, limit)
      const data = res.data
      let rows = []
      if (Array.isArray(data)) rows = data
      else if (Array.isArray(data?.rows)) rows = data.rows
      else if (Array.isArray(data?.data)) rows = data.data
      else if (data && typeof data === 'object') rows = Object.values(data)
      setAlerts(rows)
    } catch (e) {
      const status = e.response?.status
      if (status === 404 || status === 502) {
        setError('ids_not_configured')
      } else {
        setError(e.response?.data?.detail || e.message)
      }
      setAlerts([])
    } finally {
      setLoading(false)
    }
  }

  const loadStatus = async () => {
    setStatusLoading(true)
    try {
      const res = await idsAPI.getStatus(selected)
      setIdsStatus(res.data)
    } catch {
      setIdsStatus(null)
    } finally {
      setStatusLoading(false)
    }
  }

  const filteredAlerts = useMemo(() => {
    return alerts.filter(a => {
      const action = String(a.action || a.alert?.action || '').toLowerCase()
      if (filter.action === 'alert' && action !== 'alert') return false
      if (filter.action === 'drop' && !(action === 'drop' || action === 'reject')) return false
      if (filter.search) {
        const needle = filter.search.toLowerCase()
        const hay = [
          a.src_ip, a.dest_ip, a.src_port, a.dest_port,
          a.alert?.signature, a.alert?.category, a.proto,
          a.signature, a.category,
        ].filter(Boolean).map(String).join(' ').toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [alerts, filter])

  const getActionBadge = (a) => {
    const action = String(a.action || a.alert?.action || '').toLowerCase()
    if (action === 'drop' || action === 'reject') return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
    if (action === 'alert') return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'
    return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }

  const idsRunning = idsStatus?.status === 'running' || idsStatus?.running === true || idsStatus?.ids_status === 'running'
  const filteredFirewallOptions = firewalls.filter(fw => {
    if (fw.id === selected) return true
    const q = firewallSearch.trim().toLowerCase()
    if (!q) return true
    return [fw.customer_name, fw.hostname, fw.ip].filter(Boolean).join(' ').toLowerCase().includes(q)
  })

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-black text-gray-900 dark:text-gray-100">IDS / Intrusion Detection</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Suricata alerts live from the selected OPNsense firewall</p>
      </div>

      {/* Firewall selector + controls */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <input
          type="text"
          value={firewallSearch}
          onChange={e => setFirewallSearch(e.target.value)}
          placeholder="Search firewall..."
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 text-sm"
        />
        <select
          value={selected || ''}
          onChange={e => { setSelected(e.target.value); setFirewallSearch('') }}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 font-semibold text-sm"
        >
          {filteredFirewallOptions.map(fw => (
            <option key={fw.id} value={fw.id}>{fw.customer_name} – {fw.ip}</option>
          ))}
        </select>
        <select
          value={limit}
          onChange={e => setLimit(Number(e.target.value))}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 text-sm"
        >
          {[100, 200, 500, 1000].map(n => <option key={n} value={n}>{n} entries</option>)}
        </select>
        <button onClick={loadAlerts} disabled={loading}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50">
          {loading ? 'Loading...' : '🔄 Refresh'}
        </button>
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto-refresh
          {autoRefresh && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>}
        </label>
        {/* IDS Status Badge */}
        {!statusLoading && idsStatus && (
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${idsRunning ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'}`}>
            IDS {idsRunning ? '🟢 Running' : '🔴 Stopped'}
          </span>
        )}
      </div>

      {/* Filters */}
      {!error && (
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            {[['all', 'All'], ['alert', '⚠ Alert'], ['drop', '✕ Drop']].map(([v, l]) => (
              <button key={v} onClick={() => setFilter(f => ({ ...f, action: v }))}
                className={`px-3 py-1 rounded text-xs font-semibold transition ${
                  filter.action === v
                    ? v === 'drop' ? 'bg-red-600 text-white'
                    : v === 'alert' ? 'bg-yellow-500 text-white'
                    : 'bg-indigo-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:bg-gray-600'
                }`}>{l}</button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search IP, port, signature..."
            value={filter.search}
            onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
            className="px-3 py-1 rounded-lg text-xs border bg-white dark:bg-gray-800 flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-indigo-600"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">{filteredAlerts.length}/{alerts.length}</span>
        </div>
      )}

      {/* Content */}
      {error === 'ids_not_configured' ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-12 text-center">
          <div className="text-5xl mb-4">🛡️</div>
          <p className="text-gray-700 dark:text-gray-300 font-semibold text-lg">IDS not configured</p>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">Suricata (os-suricata) does not appear to be installed or enabled on this firewall.</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 rounded-xl p-6 text-red-700 dark:text-red-300">{error}</div>
      ) : loading && alerts.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
        </div>
      ) : alerts.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-12 text-center">
          <div className="text-5xl mb-4">✓</div>
          <p className="text-gray-500 dark:text-gray-400 text-lg">No IDS alerts found.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Timestamp</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Src IP:Port</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Dst IP:Port</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Proto</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Signature</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Severity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredAlerts.map((a, i) => {
                  const ts = a.timestamp || a['@timestamp'] || a.flow_start || ''
                  const action = a.action || a.alert?.action || '—'
                  const srcIp = a.src_ip || a.srcip || '—'
                  const srcPort = a.src_port || a.srcport || ''
                  const dstIp = a.dest_ip || a.dstip || '—'
                  const dstPort = a.dest_port || a.dstport || ''
                  const proto = a.proto || '—'
                  const sig = a.alert?.signature || a.signature || a.msg || '—'
                  const cat = a.alert?.category || a.category || '—'
                  const sev = a.alert?.severity || a.severity || '—'
                  return (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {ts ? new Date(ts).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${getActionBadge(a)}`}>
                          {action}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{srcIp}{srcPort ? `:${srcPort}` : ''}</td>
                      <td className="px-4 py-3 font-mono text-xs">{dstIp}{dstPort ? `:${dstPort}` : ''}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">{proto}</td>
                      <td className="px-4 py-3 text-xs text-gray-900 dark:text-gray-100 max-w-xs truncate" title={sig}>{sig}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">{cat}</td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-600 dark:text-gray-400">{sev}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
