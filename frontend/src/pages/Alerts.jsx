import React, { useState, useEffect } from 'react'
import { alertsAPI } from '../api/client'

export default function Alerts() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadAlerts()
    const interval = setInterval(loadAlerts, 10000)
    return () => clearInterval(interval)
  }, [])

  const loadAlerts = async () => {
    try {
      const response = await alertsAPI.list({ resolved: false, limit: 100 })
      setAlerts(response.data || response)
      setError(null)
    } catch (err) {
      console.error('Failed to load alerts:', err)
      setError('Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 border-red-400 text-red-800'
      case 'warning': return 'bg-yellow-100 border-yellow-400 text-yellow-800'
      default: return 'bg-blue-100 border-blue-400 text-blue-800'
    }
  }

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return '🔴'
      case 'warning': return '🟡'
      default: return '🔵'
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-black text-gray-900">System Alerts</h1>
        <p className="text-gray-600 mt-2">Active alerts and notifications ({alerts?.length || 0})</p>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {alerts && alerts.length > 0 ? (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div key={alert.id} className={`border-l-4 rounded-lg p-4 ${getSeverityColor(alert.severity)}`}>
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{getSeverityIcon(alert.severity)}</span>
                    <span className="font-bold text-lg">{alert.alert_type}</span>
                  </div>
                  <p className="text-sm">{alert.message}</p>
                  <p className="text-xs opacity-75 mt-2">
                    {new Date(alert.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => alert('Resolve feature coming soon')}
                  className="ml-4 px-4 py-2 bg-white rounded-lg hover:bg-gray-50 transition font-semibold"
                >
                  Resolve
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-lg p-12 text-center">
          <div className="text-6xl mb-4">✓</div>
          <p className="text-gray-500 text-lg">No active alerts - Everything looks good!</p>
        </div>
      )}
    </div>
  )
}