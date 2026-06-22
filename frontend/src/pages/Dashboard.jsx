import { useState, useEffect } from 'react'
import { firewallsAPI, monitoringAPI } from '../api/client'

export default function Dashboard() {
  const [summary, setSummary] = useState(null)
  const [firewalls, setFirewalls] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      try {
        const [summaryRes, firewallsRes] = await Promise.all([
          monitoringAPI.getDashboard(),
          monitoringAPI.getQuickStatus(),
        ])
        setSummary(summaryRes.data)
        setFirewalls(firewallsRes.data)
      } catch (error) {
        console.error('Failed to load dashboard:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
    const interval = setInterval(loadData, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return <div className="p-8 text-center">Loading...</div>
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <SummaryCard title="Total Firewalls" value={summary.total_firewalls} />
          <SummaryCard title="Online" value={summary.online_count} className="text-green-600" />
          <SummaryCard title="Offline" value={summary.offline_count} className="text-red-600" />
          <SummaryCard title="Pending Updates" value={summary.pending_updates} className="text-yellow-600" />
        </div>
      )}

      {/* Firewalls Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-100 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold">Customer</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Hostname</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">IP</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Status</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Firmware</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">Updates</th>
              <th className="px-6 py-3 text-left text-sm font-semibold">CPU/RAM</th>
            </tr>
          </thead>
          <tbody>
            {firewalls.map((fw) => (
              <tr key={fw.id} className="border-b hover:bg-gray-50">
                <td className="px-6 py-4 text-sm">{fw.customer_name}</td>
                <td className="px-6 py-4 text-sm">{fw.hostname}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{fw.ip}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    fw.online ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {fw.online ? 'Online' : 'Offline'}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm">{fw.firmware_version || '-'}</td>
                <td className="px-6 py-4 text-sm">
                  {fw.updates_available > 0 ? (
                    <span className="text-yellow-600 font-medium">{fw.updates_available}</span>
                  ) : (
                    <span className="text-green-600">✓</span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm">
                  {fw.cpu_usage ? `${fw.cpu_usage.toFixed(1)}% / ${fw.ram_usage?.toFixed(1)}%` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SummaryCard({ title, value, className = '' }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <p className="text-gray-600 text-sm mb-2">{title}</p>
      <p className={`text-3xl font-bold ${className}`}>{value}</p>
    </div>
  )
}
