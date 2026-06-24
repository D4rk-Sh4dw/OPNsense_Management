import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { firewallsAPI } from '../api/client'

const EMPTY_FORM = {
  customer_name: '',
  hostname: '',
  ip: '',
  api_key: '',
  api_secret: '',
  notify_email: '',
  notify_emails_general: '',
  notify_emails_license: '',
  license_alert_days: '30,14,7,1',
  license_expiry: '',
  license_type: '',
  auto_update: false,
  auto_update_window: 'sun:02:00',
  backup_interval: 'daily',
  backup_retention: 30,
  notes: '',
  verify_ssl: false,
  location_address: '',
}

export default function Firewalls() {
  const [firewalls, setFirewalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)

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
    const { name, value, type, checked } = e.target
    let newValue
    if (type === 'checkbox') {
      newValue = checked
    } else if (type === 'number') {
      newValue = value === '' ? '' : Number(value)
    } else {
      newValue = value
    }
    setFormData({ ...formData, [name]: newValue })
  }

  const handleAddFirewall = async (e) => {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      // ip field holds the URL/hostname of the firewall
      await firewallsAPI.create(formData)
      setFormData(EMPTY_FORM)
      setShowAddForm(false)
      await loadFirewalls()
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Failed to add firewall'
      setFormError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await firewallsAPI.delete(id)
      setDeleteConfirm(null)
      await loadFirewalls()
    } catch (err) {
      setError('Failed to delete firewall')
    }
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
          <h1 className="text-4xl font-black text-gray-900 dark:text-gray-100">Managed Firewalls</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Total: {firewalls?.length || 0} firewalls</p>
        </div>
        <button
          onClick={() => { setShowAddForm(!showAddForm); setFormError(null) }}
          className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold px-6 py-3 rounded-lg shadow-lg hover:shadow-xl hover:from-indigo-700 hover:to-blue-700 transition"
        >
          {showAddForm ? '✕ Cancel' : '+ Add Firewall'}
        </button>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {/* ── Add Firewall Form ─────────────────────────── */}
      {showAddForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 mb-8 border-l-4 border-indigo-600">
          <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">New Firewall</h2>

          {formError && (
            <div className="bg-red-100 dark:bg-red-900/30 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {formError}
            </div>
          )}

          <form onSubmit={handleAddFirewall}>
            {/* Section: Identity */}
            <p className="text-xs font-bold uppercase text-indigo-600 dark:text-indigo-400 tracking-widest mb-3">Identity</p>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <Field label="Customer Name *" name="customer_name" value={formData.customer_name} onChange={handleInputChange} placeholder="Musterfirma GmbH" required />
              <Field label="Hostname" name="hostname" value={formData.hostname} onChange={handleInputChange} placeholder="fw01.kunde.de" />
            </div>

            {/* Section: Connection */}
            <p className="text-xs font-bold uppercase text-indigo-600 dark:text-indigo-400 tracking-widest mb-3">OPNsense Connection</p>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <Field
                label="Firewall IP / URL *"
                name="ip"
                value={formData.ip}
                onChange={handleInputChange}
                placeholder="192.168.1.1 or fw.kunde.de"
                required
              />
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="verify_ssl"
                    checked={formData.verify_ssl}
                    onChange={handleInputChange}
                    className="w-4 h-4 accent-indigo-600"
                  />
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Verify SSL Certificate</span>
                </label>
              </div>
              <Field label="API Key *" name="api_key" value={formData.api_key} onChange={handleInputChange} placeholder="API Key from OPNsense" required />
              <Field label="API Secret *" name="api_secret" value={formData.api_secret} onChange={handleInputChange} placeholder="API Secret from OPNsense" type="password" required />
            </div>

            {/* Section: Notifications */}
            <p className="text-xs font-bold uppercase text-indigo-600 dark:text-indigo-400 tracking-widest mb-3">Alerting (General)</p>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <Field
                label="General Alert Recipients"
                name="notify_emails_general"
                value={formData.notify_emails_general}
                onChange={handleInputChange}
                placeholder="ops@firma.de, noc@firma.de"
              />
              <Field
                label="Legacy / Fallback Email"
                name="notify_email"
                value={formData.notify_email}
                onChange={handleInputChange}
                placeholder="admin@firma.de"
                type="email"
              />
            </div>

            <p className="text-xs font-bold uppercase text-indigo-600 dark:text-indigo-400 tracking-widest mb-3">Alerting (License)</p>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <Field
                label="License Alert Recipients"
                name="notify_emails_license"
                value={formData.notify_emails_license}
                onChange={handleInputChange}
                placeholder="sales@firma.de, kunde@firma.de"
              />
              <Field
                label="License Warning Days (CSV)"
                name="license_alert_days"
                value={formData.license_alert_days}
                onChange={handleInputChange}
                placeholder="30,14,7,1"
              />
              <Field label="License Expiry Date" name="license_expiry" value={formData.license_expiry} onChange={handleInputChange} type="date" />
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">License Type</label>
                <select name="license_type" value={formData.license_type} onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600">
                  <option value="">Unknown / Fetch from Firewall later</option>
                  <option value="community">Community</option>
                  <option value="business">Business</option>
                </select>
              </div>
            </div>

            {/* Section: Automation */}
            <p className="text-xs font-bold uppercase text-indigo-600 dark:text-indigo-400 tracking-widest mb-3">Automation</p>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Backup Interval</label>
                <select name="backup_interval" value={formData.backup_interval} onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <Field label="Backup Retention (count)" name="backup_retention" value={formData.backup_retention} onChange={handleInputChange} type="number" />
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Auto-Update Window</label>
                <select name="auto_update_window" value={formData.auto_update_window} onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600">
                  {['mon','tue','wed','thu','fri','sat','sun'].flatMap(d =>
                    ['00:00','01:00','02:00','03:00','04:00','05:00','22:00','23:00'].map(h => (
                      <option key={`${d}:${h}`} value={`${d}:${h}`}>{d.toUpperCase()} {h}</option>
                    ))
                  )}
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" name="auto_update" checked={formData.auto_update} onChange={handleInputChange}
                    className="w-4 h-4 accent-indigo-600" />
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Enable Auto Updates</span>
                </label>
              </div>
            </div>

            {/* Notes */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Notes</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleInputChange}
                rows={2}
                placeholder="Internal notes about this firewall..."
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
            </div>

            {/* Location */}
            <p className="text-xs font-bold uppercase text-indigo-600 dark:text-indigo-400 tracking-widest mb-3">Standort (für Karte)</p>
            <div className="mb-6">
              <Field label="Adresse" name="location_address" value={formData.location_address} onChange={handleInputChange} placeholder="Musterstraße 1, 12345 Berlin" />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold py-3 rounded-lg hover:from-indigo-700 hover:to-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Adding...' : '+ Add Firewall'}
            </button>
          </form>
        </div>
      )}

      {/* ── Firewall Table ────────────────────────────── */}
      {firewalls && firewalls.length > 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Customer</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Hostname</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">IP / URL</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">License Expiry</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Auto Update</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {firewalls.map((fw) => (
                  <tr key={fw.id} className="hover:bg-gray-50 dark:bg-gray-900 transition">
                    <td className="px-6 py-4 font-semibold text-gray-900 dark:text-gray-100">{fw.customer_name}</td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{fw.hostname || '—'}</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400 font-mono text-sm">{fw.ip}</td>
                    <td className="px-6 py-4">
                      {fw.license_expiry ? (
                        <span className="text-sm">{new Date(fw.license_expiry).toLocaleDateString()}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {fw.auto_update
                        ? <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 text-xs font-bold rounded-full">✓ On</span>
                        : <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-xs font-bold rounded-full">Off</span>
                      }
                    </td>
                    <td className="px-6 py-4 flex gap-3">
                      <Link
                        to={`/firewalls/${fw.id}`}
                        className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-bold"
                      >
                        📊 Details
                      </Link>
                      {deleteConfirm === fw.id ? (
                        <span className="flex gap-2 items-center">
                          <button onClick={() => handleDelete(fw.id)} className="text-red-600 dark:text-red-400 font-bold hover:text-red-800 dark:text-red-200">Confirm</button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-gray-500 dark:text-gray-400 font-bold hover:text-gray-700 dark:text-gray-300">Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setDeleteConfirm(fw.id)} className="text-red-500 hover:text-red-700 font-bold">🗑 Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-12 text-center">
          <div className="text-6xl mb-4">🔭</div>
          <p className="text-gray-500 dark:text-gray-400 text-lg mb-6">No firewalls registered yet</p>
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

// Reusable input field component
function Field({ label, name, value, onChange, placeholder = '', type = 'text', required = false }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
      />
    </div>
  )
}



