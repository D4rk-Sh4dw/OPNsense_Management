import React, { useState, useEffect } from 'react'
import { alertsAPI, commentsAPI } from '../api/client'

export default function Alerts() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  // Comments
  const [openCommentsFor, setOpenCommentsFor] = useState(null)
  const [commentsByAlert, setCommentsByAlert] = useState({})
  const [commentInput, setCommentInput] = useState('')
  const [commentAuthor, setCommentAuthor] = useState('')
  const [savingComment, setSavingComment] = useState(false)

  useEffect(() => {
    loadAlerts()
    const interval = setInterval(loadAlerts, 10000)
    return () => clearInterval(interval)
  }, [])

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

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

  const loadComments = async (alertId) => {
    try {
      const res = await commentsAPI.list('alert', alertId)
      setCommentsByAlert(prev => ({ ...prev, [alertId]: res.data || [] }))
    } catch {
      setCommentsByAlert(prev => ({ ...prev, [alertId]: [] }))
    }
  }

  const handleOpenComments = (alertId) => {
    const next = openCommentsFor === alertId ? null : alertId
    setOpenCommentsFor(next)
    if (next) loadComments(alertId)
  }

  const handleAddComment = async (alertId) => {
    if (!commentInput.trim()) return
    setSavingComment(true)
    try {
      await commentsAPI.create('alert', alertId, commentInput.trim(), commentAuthor.trim() || undefined)
      setCommentInput('')
      loadComments(alertId)
    } catch (e) {
      showToast('Comment failed', false)
    } finally {
      setSavingComment(false)
    }
  }

  const handleDeleteComment = async (commentId, alertId) => {
    try {
      await commentsAPI.delete(commentId)
      loadComments(alertId)
    } catch {
      showToast('Delete failed', false)
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
      case 'critical': return 'bg-red-100 dark:bg-red-900/30 border-red-400 text-red-800 dark:text-red-200'
      case 'warning': return 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 text-yellow-800 dark:text-yellow-200'
      default: return 'bg-blue-100 dark:bg-blue-900/30 border-blue-400 text-blue-800 dark:text-blue-200'
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
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-6 py-3 rounded-lg shadow-lg font-semibold text-white ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-4xl font-black text-gray-900 dark:text-gray-100">System Alerts</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Active alerts and notifications ({alerts?.length || 0})</p>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {alerts && alerts.length > 0 ? (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div key={alert.id} className={`border-l-4 rounded-lg overflow-hidden ${getSeverityColor(alert.severity)}`}>
              <div className="p-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">{getSeverityIcon(alert.severity)}</span>
                      <span className="font-bold text-lg capitalize">{alert.alert_type.replace(/_/g, ' ')}</span>
                    </div>
                    <p className="text-sm">{alert.message}</p>
                    <p className="text-xs opacity-75 mt-2">{new Date(alert.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleOpenComments(alert.id)}
                      className="px-3 py-2 bg-white/60 dark:bg-gray-800/60 rounded-lg hover:bg-white dark:hover:bg-gray-700 transition font-semibold text-sm"
                      title="Comments"
                    >
                      💬 {commentsByAlert[alert.id]?.length || ''}
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await alertsAPI.resolve(alert.id)
                          loadAlerts()
                        } catch (e) { console.error(e) }
                      }}
                      className="px-4 py-2 bg-white/60 dark:bg-gray-800/60 rounded-lg hover:bg-white dark:hover:bg-gray-700 transition font-semibold text-sm"
                    >✓ Resolve</button>
                  </div>
                </div>
              </div>

              {openCommentsFor === alert.id && (
                <div className="border-t border-current/20 bg-white/40 dark:bg-gray-900/30 px-4 py-3 space-y-2">
                  {(commentsByAlert[alert.id] || []).map(c => (
                    <div key={c.id} className="flex items-start gap-2 text-sm">
                      <span className="font-semibold shrink-0">{c.author}:</span>
                      <span className="flex-1">{c.content}</span>
                      <span className="text-xs opacity-60 shrink-0">{new Date(c.created_at).toLocaleString()}</span>
                      <button onClick={() => handleDeleteComment(c.id, alert.id)}
                        className="opacity-50 hover:opacity-100 text-xs shrink-0">✕</button>
                    </div>
                  ))}
                  {(commentsByAlert[alert.id] || []).length === 0 && (
                    <p className="text-xs opacity-60">No comments yet.</p>
                  )}
                  <div className="flex gap-2 flex-wrap mt-2">
                    <input
                      type="text"
                      value={commentAuthor}
                      onChange={e => setCommentAuthor(e.target.value)}
                      placeholder="Your name (optional)"
                      className="px-2 py-1 border rounded text-sm w-40 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      value={commentInput}
                      onChange={e => setCommentInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddComment(alert.id)}
                      placeholder="Add a comment..."
                      className="flex-1 px-2 py-1 border rounded text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[200px]"
                    />
                    <button
                      onClick={() => handleAddComment(alert.id)}
                      disabled={savingComment || !commentInput.trim()}
                      className="px-3 py-1 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                    >Post</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-12 text-center">
          <div className="text-6xl mb-4">✓</div>
          <p className="text-gray-500 dark:text-gray-400 text-lg">No active alerts - Everything looks good!</p>
        </div>
      )}
    </div>
  )
}

