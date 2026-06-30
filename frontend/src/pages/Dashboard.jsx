import { useState, useEffect, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { monitoringAPI, updatesAPI } from '../api/client'

export default function Dashboard() {
  const [summary, setSummary] = useState(null)
  const [firewalls, setFirewalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [intervalSec, setIntervalSec] = useState(15)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFirewallIds, setSelectedFirewallIds] = useState([])
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [updatingIds, setUpdatingIds] = useState([])
  const [toast, setToast] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [updateLogs, setUpdateLogs] = useState([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsStatusFilter, setLogsStatusFilter] = useState('')
  const [logsSearch, setLogsSearch] = useState('')
  const [expandedLogIds, setExpandedLogIds] = useState([])

  useEffect(() => {
    loadData(false)
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    let timer = null
    const start = () => {
      timer = setInterval(() => {
        if (!document.hidden) loadData(true)
      }, intervalSec * 1000)
    }
    const onVis = () => {
      if (document.hidden) {
        if (timer) { clearInterval(timer); timer = null }
      } else {
        loadData(true)
        if (!timer) start()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [autoRefresh, intervalSec])

  const loadData = async (live = true) => {
    try {
      setRefreshing(true)
      setError(null)
      const [summaryRes, firewallsRes] = await Promise.all([
        monitoringAPI.getDashboard(),
        live ? monitoringAPI.getLiveStatus() : monitoringAPI.getQuickStatus(),
      ])
      setSummary(summaryRes.data || summaryRes)
      setFirewalls(firewallsRes.data || firewallsRes)
    } catch (error) {
      console.error('Failed to load dashboard:', error)
      setError('Failed to load dashboard data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const loadUpdateLogs = async () => {
    try {
      setLogsLoading(true)
      const params = { limit: 200 }
      if (logsStatusFilter) params.status = logsStatusFilter
      const res = await updatesAPI.getAllHistory(params)
      setUpdateLogs(res.data || res)
    } catch (e) {
      console.error('Failed to load update logs:', e)
      showToast('Failed to load update logs', false)
    } finally {
      setLogsLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'logs') loadUpdateLogs()
  }, [activeTab, logsStatusFilter])

  const toggleLogExpand = (id) => {
    setExpandedLogIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const filteredLogs = (updateLogs || []).filter(l => {
    const q = logsSearch.trim().toLowerCase()
    if (!q) return true
    return [
      l.firewall_name, l.hostname, l.ip,
      l.status, l.triggered_by, l.version_before, l.version_after, l.log,
    ].filter(Boolean).join(' ').toLowerCase().includes(q)
  })

  const filteredFirewalls = (firewalls || []).filter((fw) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    const haystack = [
      fw.customer_name,
      fw.hostname,
      fw.ip,
      fw.firmware_version,
      fw.online ? 'online' : 'offline',
      ...(Array.isArray(fw.tags) ? fw.tags : []),
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(q)
  })

  const updatableFilteredIds = filteredFirewalls
    .filter(fw => (fw.updates_available || 0) > 0)
    .map(fw => fw.id)

  const selectedUpdatableIds = selectedFirewallIds.filter(id => updatableFilteredIds.includes(id))
  const allFilteredSelected = updatableFilteredIds.length > 0 && selectedUpdatableIds.length === updatableFilteredIds.length

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedFirewallIds(prev => prev.filter(id => !updatableFilteredIds.includes(id)))
    } else {
      setSelectedFirewallIds(prev => Array.from(new Set([...prev, ...updatableFilteredIds])))
    }
  }

  const toggleSelectOne = (id) => {
    setSelectedFirewallIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const installOne = async (fw) => {
    if ((fw.updates_available || 0) <= 0) return
    if (!window.confirm(`Start update for ${fw.customer_name} (${fw.ip})?`)) return

    setUpdatingIds(prev => [...prev, fw.id])
    try {
      await updatesAPI.installUpdates(fw.id)
      showToast(`Update started: ${fw.customer_name}`)
    } catch (e) {
      showToast(`Failed to start update for ${fw.customer_name}`, false)
    } finally {
      setUpdatingIds(prev => prev.filter(id => id !== fw.id))
    }
  }

  const installSelected = async () => {
    if (selectedUpdatableIds.length === 0) {
      showToast('No updatable firewall selected', false)
      return
    }
    if (!window.confirm(`Start updates for ${selectedUpdatableIds.length} selected firewall(s)?`)) return

    setBulkUpdating(true)
    setUpdatingIds(prev => Array.from(new Set([...prev, ...selectedUpdatableIds])))
    const jobs = await Promise.allSettled(selectedUpdatableIds.map(id => updatesAPI.installUpdates(id)))
    const ok = jobs.filter(j => j.status === 'fulfilled').length
    const failed = jobs.length - ok
    setUpdatingIds(prev => prev.filter(id => !selectedUpdatableIds.includes(id)))
    setBulkUpdating(false)
    if (failed === 0) {
      showToast(`Updates started for ${ok} firewall(s)`)
    } else {
      showToast(`Started: ${ok}, Failed: ${failed}`, false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-6 py-3 rounded-lg shadow-lg font-semibold text-white ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-gray-100">Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Real-time Firewall Management Overview</p>
        </div>
        <div className="flex gap-3 items-center">
          <label className="flex items-center gap-2 text-sm bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            <span className="font-semibold text-gray-700 dark:text-gray-300">Live</span>
            {autoRefresh && (
              <span className={`w-2 h-2 rounded-full bg-green-500 ${refreshing ? 'animate-pulse' : ''}`}></span>
            )}
          </label>
          {autoRefresh && (
            <select value={intervalSec} onChange={e => setIntervalSec(parseInt(e.target.value))}
              className="text-sm bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow border-0 font-semibold text-gray-700 dark:text-gray-300">
              <option value="10">10s</option>
              <option value="15">15s</option>
              <option value="30">30s</option>
              <option value="60">1m</option>
            </select>
          )}
          <button onClick={() => loadData(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-semibold text-sm">
            🔄 Refresh
          </button>
          <button onClick={installSelected}
            disabled={bulkUpdating || selectedUpdatableIds.length === 0}
            className="bg-amber-500 text-white px-4 py-2 rounded-lg hover:bg-amber-600 font-semibold text-sm disabled:opacity-50">
            {bulkUpdating ? 'Starting...' : `⚡ Update Selected (${selectedUpdatableIds.length})`}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <SummaryCard 
            title="Total Firewalls" 
            value={summary.total_firewalls} 
            icon="🔥"
            color="indigo"
          />
          <SummaryCard 
            title="Online" 
            value={summary.online_count} 
            icon="✓"
            color="green"
          />
          <SummaryCard 
            title="Offline" 
            value={summary.offline_count} 
            icon="✕"
            color="red"
          />
          <SummaryCard 
            title="Pending Updates" 
            value={summary.pending_updates} 
            icon="⚡"
            color="yellow"
          />
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 -mb-px font-semibold text-sm border-b-2 ${
            activeTab === 'overview'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2 -mb-px font-semibold text-sm border-b-2 ${
            activeTab === 'logs'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Update Logs
        </button>
      </div>

      {activeTab === 'overview' && (
      <>
      {/* Firewalls Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search customer, tags, hostname, IP, status or firmware..."
            className="w-full md:w-[26rem] px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white dark:bg-gray-800"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
              <tr>
                <th className="px-2 py-2 text-left text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    title="Select all updatable firewalls in current filter"
                    className="h-4 w-4"
                  />
                </th>
                <th className="px-2 py-2 text-left text-xs font-semibold">Customer</th>
                <th className="px-2 py-2 text-left text-xs font-semibold">Hostname</th>
                <th className="px-2 py-2 text-left text-xs font-semibold">IP Address</th>
                <th className="px-2 py-2 text-left text-xs font-semibold">Status</th>
                <th className="px-2 py-2 text-left text-xs font-semibold">Firmware</th>
                <th className="px-2 py-2 text-left text-xs font-semibold">Edition</th>
                <th className="px-2 py-2 text-left text-xs font-semibold">Updates</th>
                <th className="px-2 py-2 text-left text-xs font-semibold">Resources</th>
                <th className="px-2 py-2 text-left text-xs font-semibold">Actions</th>
                <th className="px-2 py-2 text-left text-xs font-semibold">GUI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredFirewalls && filteredFirewalls.length > 0 ? (
                filteredFirewalls.map((fw) => (
                  <tr key={fw.id} className="hover:bg-gray-50 dark:bg-gray-900 transition">
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selectedFirewallIds.includes(fw.id)}
                        disabled={(fw.updates_available || 0) <= 0}
                        onChange={() => toggleSelectOne(fw.id)}
                        className="h-4 w-4"
                        title={(fw.updates_available || 0) > 0 ? 'Select for bulk update' : 'No updates available'}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{fw.customer_name}</span>
                      {Array.isArray(fw.tags) && fw.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {fw.tags.map(t => (
                            <span key={t} className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs font-semibold rounded-full">{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 text-xs">{fw.hostname || 'N/A'}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 font-mono text-xs">{fw.ip}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        fw.online ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                      }`}>
                        {fw.online ? '🟢 Online' : '🔴 Offline'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 text-xs">{fw.firmware_version || 'Unknown'}</td>
                    <td className="px-3 py-2">
                      {fw.license_type === 'business'
                        ? <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-xs font-bold rounded-full">Business</span>
                        : fw.license_type === 'community'
                          ? <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-bold rounded-full">Community</span>
                          : <span className="text-gray-400">—</span>
                      }
                    </td>
                    <td className="px-3 py-2">
                      {fw.updates_available > 0 ? (
                        <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded-full text-xs font-bold">⚡ {fw.updates_available}</span>
                      ) : (
                        <span className="text-green-600 dark:text-green-400 font-bold">✓ Latest</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {fw.cpu_usage !== null || fw.ram_usage !== null ? (
                        <div className="text-gray-700 dark:text-gray-300">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 dark:text-gray-400 w-10">CPU</span>
                            <div className="flex-1 bg-gray-200 dark:bg-gray-600 rounded-full h-2 w-20">
                              <div className={`h-2 rounded-full ${
                                (fw.cpu_usage || 0) > 80 ? 'bg-red-500' :
                                (fw.cpu_usage || 0) > 50 ? 'bg-yellow-500' : 'bg-green-500'
                              }`} style={{width: `${Math.min(fw.cpu_usage || 0, 100)}%`}}></div>
                            </div>
                            <span className="text-xs font-mono w-12 text-right">{fw.cpu_usage != null ? fw.cpu_usage.toFixed(1) + '%' : '—'}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-gray-500 dark:text-gray-400 w-10">RAM</span>
                            <div className="flex-1 bg-gray-200 dark:bg-gray-600 rounded-full h-2 w-20">
                              <div className={`h-2 rounded-full ${
                                (fw.ram_usage || 0) > 80 ? 'bg-red-500' :
                                (fw.ram_usage || 0) > 50 ? 'bg-yellow-500' : 'bg-green-500'
                              }`} style={{width: `${Math.min(fw.ram_usage || 0, 100)}%`}}></div>
                            </div>
                            <span className="text-xs font-mono w-12 text-right">{fw.ram_usage != null ? fw.ram_usage.toFixed(1) + '%' : '—'}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/firewalls/${fw.id}`}
                          className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-bold text-xs"                        
                        >
                          Details
                        </Link>
                        <button
                          onClick={() => installOne(fw)}
                          disabled={(fw.updates_available || 0) <= 0 || updatingIds.includes(fw.id)}
                          className="text-amber-600 hover:text-amber-800 font-bold text-xs disabled:opacity-50"
                        >
                          {updatingIds.includes(fw.id) ? 'Starting...' : '⚡ Update'}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={`https://${fw.ip}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-bold text-xs"
                        title="WebGUI öffnen"
                      >
                        🌐
                      </a>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="11" className="px-6 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                    {firewalls && firewalls.length > 0
                      ? 'No firewall matches your search.'
                      : 'No firewalls registered yet. Go to Firewalls tab to add one.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {activeTab === 'logs' && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-3 items-center">
            <input
              type="text"
              value={logsSearch}
              onChange={(e) => setLogsSearch(e.target.value)}
              placeholder="Search firewall, version, status or log content..."
              className="flex-1 min-w-[20rem] px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white dark:bg-gray-800"
            />
            <select
              value={logsStatusFilter}
              onChange={(e) => setLogsStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
            >
              <option value="">All statuses</option>
              <option value="success">success</option>
              <option value="failed">failed</option>
              <option value="in-progress">in-progress</option>
              <option value="pending">pending</option>
            </select>
            <button
              onClick={loadUpdateLogs}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-semibold text-sm"
            >
              🔄 Reload
            </button>
          </div>

          {logsLoading ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">No update history yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold w-8"></th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Firewall</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Triggered</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Version</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Started</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Completed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredLogs.map((l) => {
                    const expanded = expandedLogIds.includes(l.id)
                    return (
                      <Fragment key={l.id}>
                        <tr
                          onClick={() => toggleLogExpand(l.id)}
                          className="hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer transition"
                        >
                          <td className="px-4 py-3 text-gray-500">{expanded ? '▾' : '▸'}</td>
                          <td className="px-4 py-3">
                            <Link
                              to={`/firewalls/${l.firewall_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                              {l.firewall_name}
                            </Link>
                            <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{l.ip}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{l.triggered_by}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={l.status} />
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300 font-mono">
                            {l.version_before && l.version_after && l.version_before !== l.version_after
                              ? <>{l.version_before} → {l.version_after}</>
                              : l.version_before || l.version_after || '—'
                            }
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{formatDate(l.started_at)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{formatDate(l.completed_at)}</td>
                        </tr>
                        {expanded && (
                          <tr className="bg-gray-50 dark:bg-gray-900/50">
                            <td colSpan="7" className="px-6 py-4">
                              <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold mb-2">Log</div>
                              <pre className="bg-gray-900 text-gray-100 text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap break-words max-h-96">
{l.log || '(no log)'}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatDate(s) {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString()
  } catch {
    return s
  }
}

function StatusBadge({ status }) {
  const map = {
    success: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200',
    failed: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200',
    'in-progress': 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200',
    pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200',
  }
  const cls = map[status] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  return <span className={`px-2 py-1 rounded-full text-xs font-bold ${cls}`}>{status}</span>
}

function SummaryCard({ title, value, icon, color }) {
  const colorClasses = {
    indigo: 'from-indigo-500 to-indigo-600',
    green: 'from-green-500 to-green-600',
    red: 'from-red-500 to-red-600',
    yellow: 'from-yellow-500 to-yellow-600',
  }

  return (
    <div className={`bg-gradient-to-br ${colorClasses[color]} rounded-lg shadow-lg p-6 text-white`}>
      <div className="flex justify-between items-start">
        <div>
          <p className="text-white text-opacity-80 text-sm font-semibold mb-1">{title}</p>
          <p className="text-4xl font-black">{value}</p>
        </div>
        <span className="text-3xl opacity-50">{icon}</span>
      </div>
    </div>
  )
}




