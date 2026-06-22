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
  const [toast, setToast] = useState(null)

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

  const handleRestore = async (backupId) => {
    if (!window.confirm('Restore this backup? The firewall may restart.')) return
    setRestoring(backupId)
    try {
      await backupsAPI.restore(selected, backupId)
      showToast('Restore initiated – firewall may restart')
    } catch (e) {
      showToast('Restore failed: ' + (e.response?.data?.detail || e.message), false)
    } finally {
      setRestoring(null)
    }
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

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-6 py-3 rounded-lg shadow-lg font-semibold text-white ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-4xl font-black text-gray-900">Backups</h1>
        <p className="text-gray-600 mt-2">Manage configuration backups per firewall</p>
      </div>

      {loadingFw ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
        </div>
      ) : firewalls.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-12 text-center text-gray-500">
          No firewalls registered yet.
        </div>
      ) : (
        <>
          {/* Firewall Selector + Create */}
          <div className="flex gap-4 mb-6 flex-wrap">
            <select
              value={selected || ''}
              onChange={e => setSelected(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 font-semibold"
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
            <div className="bg-white rounded-xl shadow p-12 text-center">
              <div className="text-5xl mb-4">💾</div>
              <p className="text-gray-500 text-lg">No backups yet. Click &ldquo;Create Backup&rdquo; to start.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-hidden">
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
                <tbody className="divide-y divide-gray-200">
                  {backups.map(b => (
                    <tr key={b.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4 text-sm text-gray-700">{new Date(b.created_at).toLocaleString()}</td>
                      <td className="px-6 py-4 text-xs font-mono text-gray-600">{b.filename}</td>
                      <td className="px-6 py-4 text-sm">{formatSize(b.size_bytes)}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                          b.triggered_by === 'pre-update' ? 'bg-yellow-100 text-yellow-800' :
                          b.triggered_by === 'auto' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-600'}`}>
                          {b.triggered_by}
                        </span>
                      </td>
                      <td className="px-6 py-4 flex gap-3">
                        <button
                          onClick={() => handleRestore(b.id)}
                          disabled={restoring === b.id}
                          className="text-indigo-600 hover:text-indigo-800 font-bold text-sm disabled:opacity-50"
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
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
