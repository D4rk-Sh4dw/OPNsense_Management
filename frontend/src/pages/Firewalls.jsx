import React, { useState, useEffect } from 'react'
import { firewallsAPI } from '../api/client'

export default function Firewalls() {
  const [firewalls, setFirewalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadFirewalls()
  }, [])

  const loadFirewalls = async () => {
    try {
      setLoading(true)
      const response = await firewallsAPI.list()
      setFirewalls(response.data)
      setError(null)
    } catch (err) {
      setError('Failed to load firewalls')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="p-8">Loading...</div>
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Managed Firewalls</h1>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
          Add Firewall
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-100 border-b">
            <tr>
              <th className="px-6 py-3 text-left">Customer</th>
              <th className="px-6 py-3 text-left">Hostname</th>
              <th className="px-6 py-3 text-left">IP</th>
              <th className="px-6 py-3 text-left">License Expiry</th>
              <th className="px-6 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {firewalls.map((fw) => (
              <tr key={fw.id} className="border-b hover:bg-gray-50">
                <td className="px-6 py-4">{fw.customer_name}</td>
                <td className="px-6 py-4">{fw.hostname}</td>
                <td className="px-6 py-4 text-gray-600">{fw.ip}</td>
                <td className="px-6 py-4">{fw.license_expiry || 'N/A'}</td>
                <td className="px-6 py-4">
                  <button className="text-blue-600 hover:text-blue-800 mr-4">View</button>
                  <button className="text-red-600 hover:text-red-800">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
