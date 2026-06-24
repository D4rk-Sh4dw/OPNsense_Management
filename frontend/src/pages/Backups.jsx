import React, { useState, useEffect } from 'react'
import { firewallsAPI, backupsAPI } from '../api/client'

export default function Backups() {
  const [firewalls, setFirewalls] = useState([])
  const [selected, setSelected] = useState(null)
  const [backups, setBackups] = useState([])
  const [loadingFw, setLoadingFw] = useState(true)
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState(null)
  const [restoreTarget, setRestoreTarget] = useState(null) // {id, filename}
  const [restoreAreas, setRestoreAreas] = useState([])
  const [restoreMode, setRestoreMode] = useState('full') // 'full' | 'partial'
  const [toast, setToast] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

  const AREA_OPTIONS = [
    { id: 'aliases', label: 'Aliases' },
    { id: 'filter', label: 'Firewall Rules' },
    { id: 'nat', label: 'NAT' },
    { id: 'interfaces', label: 'Interfaces' },
    { id: 'vlans', label: 'VLANs' },
    { id: 'gateways', label: 'Gateways' },
    { id: 'staticroutes', label: 'Static Routes' },
    { id: 'dhcpd', label: 'DHCPv4' },
    { id: 'dhcpdv6', label: 'DHCPv6' },
    { id: 'dnsmasq', label: 'Dnsmasq DNS' },
    { id: 'unbound', label: 'Unbound DNS' },
    { id: 'ipsec', label: 'IPsec' },
    { id: 'openvpn', label: 'OpenVPN' },
    { id: 'wireguard', label: 'WireGuard' },
    { id: 'OPNsense', label: 'OPNsense Settings' },
    { id: 'snmpd', label: 'SNMP' },
    { id: 'syslog', label: 'Syslog' },
    { id: 'sysctl', label: 'sysctl' },
    { id: 'system', label: 'System (users, certs, ...)' },
    { id: 'widgets', label: 'Dashboard Widgets' },
  ]

  useEffect(() => {
    firewallsAPI.list().then(r => {
      const list = r.data || r
      setFirewalls(list)
      if (list.length > 0) setSelected(list[0].id)
    }).finally(() => setLoadingFw(false))
  }, [])

  useEffect(() => {
    if (selected) loadBackups()
  }, [selected])

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const loadBackups = async () => {
    setLoadingBackups(true)
    try {
      const res = await backupsAPI.list(selected)
      setBackups(res.data || res)
    } catch (e) {
      setBackups([])
    } finally {
      setLoadingBackups(false)
    }
  }

  const handleCreate = async () => {
    setCreating(true)
    try {
      await backupsAPI.create(selected)
      showToast('Backup started in background')
      setTimeout(loadBackups, 3000)
    } catch (e) {
      showToast('Failed to create backup', false)
    } finally {
      setCreating(false)
    }
  }

  const openRestoreDialog = (backup) => {
    setRestoreTarget(backup)
    setRestoreMode('full')
    setRestoreAreas([])
  }

  const toggleArea = (id) => {
    setRestoreAreas(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  const confirmRestore = async () => {
    if (!restoreTarget) return
    if (restoreMode === 'partial' && restoreAreas.length === 0) {
      showToast('Select at least one area or switch to full restore', false)
      return
    }
    setRestoring(restoreTarget.id)
    try {
      const areas = restoreMode === 'partial' ? restoreAreas : null
      await backupsAPI.restore(selected, restoreTarget.id, areas)
      showToast('Restore initiated – firewall may restart')
      setRestoreTarget(null)
    } catch (e) {
      showToast('Restore failed: ' + (e.response?.data?.detail || e.message), false)
    } finally {
      setRestoring(null)
    }
  }

  const handleDownload = (backupId) => {
    window.open(backupsAPI.downloadUrl(selected, backupId), '_blank')
  }

  const handleDelete = async (firewallId, backupId) => {
    if (!window.confirm('Delete this backup permanently?')) return
    try {
      await backupsAPI.delete(firewallId, backupId)
      showToast('Backup deleted')
      loadBackups()
    } catch (e) {
      showToast('Failed to delete backup', false)
    }
  }

  const formatSize = (bytes) => {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const selectedFw = firewalls.find(f => f.id === selected)
  const filteredBackups = backups.filter((b) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    const dateStr = new Date(b.created_at).toLocaleString().toLowerCase()
    const haystack = [b.filename, b.triggered_by, dateStr].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(q)
  })

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-6 py-3 rounded-lg shadow-lg font-semibold text-white ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-4xl font-black text-gray-900 dark:text-gray-100">Backups</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Manage configuration backups per firewall</p>
      </div>

      {loadingFw ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
        </div>
      ) : firewalls.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-12 text-center text-gray-500 dark:text-gray-400">
          No firewalls registered yet.
        </div>
      ) : (
        <>
          {/* Firewall Selector + Create */}
          <div className="flex gap-4 mb-6 flex-wrap">
            <select
              value={selected || ''}
              onChange={e => setSelected(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 font-semibold"
            >
              {firewalls.map(fw => (
                <option key={fw.id} value={fw.id}>{fw.customer_name} – {fw.ip}</option>
              ))}
            </select>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold px-6 py-2 rounded-lg hover:from-indigo-700 hover:to-blue-700 transition disabled:opacity-50"
            >
              {creating ? 'Creating...' : '+ Create Backup'}
            </button>
          </div>

          {/* Backup Info Bar */}
          {selectedFw && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2 mb-4 text-sm text-indigo-800 flex gap-6">
              <span>Retention: <strong>{selectedFw.backup_retention} backups</strong></span>
              <span>Interval: <strong>{selectedFw.backup_interval}</strong></span>
              <span>Total: <strong>{backups.length}</strong></span>
            </div>
          )}

          {/* Backup Table */}
          {loadingBackups ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
            </div>
          ) : backups.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-12 text-center">
              <div className="text-5xl mb-4">💾</div>
              <p className="text-gray-500 dark:text-gray-400 text-lg">No backups yet. Click &ldquo;Create Backup&rdquo; to start.</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search backup filename, date or trigger..."
                  className="w-full md:w-[24rem] px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>
              <table className="w-full">
                <thead className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Date</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Filename</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Size</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Triggered by</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredBackups.map(b => (
                    <tr key={b.id} className="hover:bg-gray-50 dark:bg-gray-900 transition">
                      <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{new Date(b.created_at).toLocaleString()}</td>
                      <td className="px-6 py-4 text-xs font-mono text-gray-600 dark:text-gray-400">{b.filename}</td>
                      <td className="px-6 py-4 text-sm">{formatSize(b.size_bytes)}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                          b.triggered_by === 'pre-update' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200' :
                          b.triggered_by === 'auto' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                          {b.triggered_by}
                        </span>
                      </td>
                      <td className="px-6 py-4 flex gap-3">
                        <button
                          onClick={() => handleDownload(b.id)}
                          className="text-emerald-600 hover:text-emerald-800 font-bold text-sm"
                        >
                          ⬇ Download
                        </button>
                        <button
                          onClick={() => openRestoreDialog(b)}
                          disabled={restoring === b.id}
                          className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-bold text-sm disabled:opacity-50"
                        >
                          {restoring === b.id ? '...' : '↩ Restore'}
                        </button>
                        <button
                          onClick={() => handleDelete(selected, b.id)}
                          className="text-red-500 hover:text-red-700 font-bold text-sm"
                        >
                          🗑 Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredBackups.length === 0 && (
                    <tr>
                      <td colSpan="5" className="px-6 py-10 text-center text-gray-500 dark:text-gray-400">
                        No backup matches your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Restore Modal */}
      {restoreTarget && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h3 className="text-2xl font-black text-gray-900 dark:text-gray-100">Restore Backup</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 font-mono break-all">{restoreTarget.filename}</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="mode" checked={restoreMode === 'full'}
                    onChange={() => setRestoreMode('full')} />
                  <span className="font-semibold">Full restore (entire configuration)</span>
                </label>
              </div>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="mode" checked={restoreMode === 'partial'}
                    onChange={() => setRestoreMode('partial')} />
                  <span className="font-semibold">Partial restore (selected sections only)</span>
                </label>
              </div>

              {restoreMode === 'partial' && (
                <div className="bg-gray-50 dark:bg-gray-900 border rounded-lg p-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Sections from the backup XML are merged into the current firewall configuration. Unchecked areas keep their current values.
                  </p>
                  <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                    {AREA_OPTIONS.map(opt => (
                      <label key={opt.id} className="flex items-center gap-2 text-sm hover:bg-white dark:bg-gray-800 p-1 rounded cursor-pointer">
                        <input type="checkbox"
                          checked={restoreAreas.includes(opt.id)}
                          onChange={() => toggleArea(opt.id)} />
                        <span>{opt.label}</span>
                        <span className="text-xs text-gray-400 font-mono">{opt.id}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800 dark:text-yellow-200">
                ⚠ The firewall may restart or briefly lose connectivity during restore.
              </div>
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={() => setRestoreTarget(null)}
                className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:bg-gray-600 font-semibold">
                Cancel
              </button>
              <button onClick={confirmRestore} disabled={restoring}
                className="px-6 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50">
                {restoring ? 'Restoring...' : 'Confirm Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



