import React, { useState, useEffect } from 'react'
import { firewallsAPI } from '../api/client'

export default function Firewalls() {
  const [firewalls, setFirewalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({
    customer_name: '',
    hostname: '',
    ip: '',
    notify_email: '',
  })

  useEffect(() => {
    loadFirewalls()
  }, [])

  const loadFirewalls = async () => {
    try {
      setLoading(true)
      const response = await firewallsAPI.list()
      setFirewalls(response.data || response)
      setError(null)
    } catch (err) {
      setError('Failed to load firewalls')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const handleAddFirewall = async (e) => {
    e.preventDefault()
    if (!formData.customer_name || !formData.ip) {
      alert('Please fill in required fields')
      return
    }
    // TODO: Implement add firewall API call
    alert('Add firewall feature coming soon')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-black text-gray-900">Managed Firewalls</h1>
          <p className="text-gray-600 mt-2">Total: {firewalls?.length || 0} firewalls</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold px-6 py-3 rounded-lg shadow-lg hover:shadow-xl hover:from-indigo-700 hover:to-blue-700 transition"
        >
          + Add Firewall
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {showAddForm && (
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8 border-l-4 border-indigo-600">
          <h2 className="text-2xl font-bold mb-4">Add New Firewall</h2>
          <form onSubmit={handleAddFirewall} className="grid md:grid-cols-2 gap-4">
            <input
              type="text"
              name="customer_name"
              placeholder="Customer Name *"
              value={formData.customer_name}
              onChange={handleInputChange}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
              required
            />
            <input
              type="text"
              name="hostname"
              placeholder="Hostname"
              value={formData.hostname}
              onChange={handleInputChange}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
            />
            <input
              type="text"
              name="ip"
              placeholder="IP Address *"
              value={formData.ip}
              onChange={handleInputChange}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
              required
            />
            <input
              type="email"
              name="notify_email"
              placeholder="Notification Email"
              value={formData.notify_email}
              onChange={handleInputChange}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
            />
            <button type="submit" className="md:col-span-2 bg-indigo-600 text-white font-bold px-6 py-2 rounded-lg hover:bg-indigo-700 transition">
              Add Firewall
            </button>
          </form>
        </div>
      )}

      {firewalls && firewalls.length > 0 ? (
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Customer</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Hostname</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">IP Address</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">License Expiry</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {firewalls.map((fw) => (
                  <tr key={fw.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4 font-semibold text-gray-900">{fw.customer_name}</td>
                    <td className="px-6 py-4 text-gray-700">{fw.hostname || 'N/A'}</td>
                    <td className="px-6 py-4 text-gray-600 font-mono text-sm">{fw.ip}</td>
                    <td className="px-6 py-4">
                      {fw.license_expiry ? (
                        <span className="text-sm">{new Date(fw.license_expiry).toLocaleDateString()}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <button className="text-indigo-600 hover:text-indigo-800 font-bold mr-4">📊 View</button>
                      <button className="text-red-600 hover:text-red-800 font-bold">🗑️ Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-lg p-12 text-center">
          <div className="text-6xl mb-4">📭</div>
          <p className="text-gray-500 text-lg mb-6">No firewalls registered yet</p>
          <button
            onClick={() => setShowAddForm(true)}
            className="bg-indigo-600 text-white font-bold px-6 py-3 rounded-lg hover:bg-indigo-700 transition"
          >
            Add Your First Firewall
          </button>
        </div>
      )}
    </div>
  )
}
