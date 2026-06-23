import { useState, useEffect } from 'react'
import { monitoringAPI } from '../api/client'

export default function Dashboard() {
  const [summary, setSummary] = useState(null)
  const [firewalls, setFirewalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [intervalSec, setIntervalSec] = useState(15)

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

      {/* Firewalls Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold">Customer</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Hostname</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">IP Address</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Status</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Firmware</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Updates</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Resources</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {firewalls && firewalls.length > 0 ? (
                firewalls.map((fw) => (
                  <tr key={fw.id} className="hover:bg-gray-50 dark:bg-gray-900 transition">
                    <td className="px-6 py-4 font-semibold text-gray-900 dark:text-gray-100">{fw.customer_name}</td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{fw.hostname || 'N/A'}</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400 font-mono text-sm">{fw.ip}</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        fw.online ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                      }`}>
                        {fw.online ? '🟢 Online' : '🔴 Offline'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300 text-sm">{fw.firmware_version || 'Unknown'}</td>
                    <td className="px-6 py-4">
                      {fw.updates_available > 0 ? (
                        <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded-full text-xs font-bold">⚡ {fw.updates_available}</span>
                      ) : (
                        <span className="text-green-600 dark:text-green-400 font-bold">✓ Latest</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
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
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                    No firewalls registered yet. Go to Firewalls tab to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
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




