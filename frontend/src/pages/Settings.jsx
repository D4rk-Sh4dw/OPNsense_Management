import React, { useEffect, useState } from 'react'
import { settingsAPI, firewallTagsAPI } from '../api/client'

export default function Settings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)
  const [tags, setTags] = useState([])
  const [tagsLoading, setTagsLoading] = useState(true)
  const [tagsBusy, setTagsBusy] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [tagsError, setTagsError] = useState(null)
  const [tagsOk, setTagsOk] = useState(null)
  const [form, setForm] = useState({
    monitoring_interval_seconds: 10,
    license_check_hour: 2,
    smart_check_hour: 3,
  })

  useEffect(() => {
    loadSettings()
    loadTags()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const res = await settingsAPI.getScheduler()
      setForm({
        monitoring_interval_seconds: res.data.monitoring_interval_seconds ?? 10,
        license_check_hour: res.data.license_check_hour ?? 2,
        smart_check_hour: res.data.smart_check_hour ?? 3,
      })
      setError(null)
    } catch (e) {
      setError(`Could not load settings: ${e.response?.data?.detail || e.message}`)
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setOk(null)
    try {
      const payload = {
        monitoring_interval_seconds: Math.max(5, Number(form.monitoring_interval_seconds) || 10),
        license_check_hour: Math.max(0, Math.min(23, Number(form.license_check_hour) || 0)),
        smart_check_hour: Math.max(0, Math.min(23, Number(form.smart_check_hour) || 0)),
      }
      await settingsAPI.updateScheduler(payload)
      setOk('Settings saved. Scheduler applies these values automatically.')
    } catch (e) {
      setError(`Could not save settings: ${e.response?.data?.detail || e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const loadTags = async () => {
    setTagsLoading(true)
    try {
      const res = await firewallTagsAPI.list()
      setTags(res.data || [])
      setTagsError(null)
    } catch (e) {
      setTagsError(`Could not load tags: ${e.response?.data?.detail || e.message}`)
    } finally {
      setTagsLoading(false)
    }
  }

  const createTag = async () => {
    const name = newTagName.trim()
    if (!name) return
    setTagsBusy(true)
    setTagsOk(null)
    try {
      await firewallTagsAPI.create(name)
      setNewTagName('')
      setTagsOk('Tag created.')
      await loadTags()
    } catch (e) {
      setTagsError(`Could not create tag: ${e.response?.data?.detail || e.message}`)
    } finally {
      setTagsBusy(false)
    }
  }

  const deleteTag = async (tag) => {
    if (!window.confirm(`Tag "${tag.name}" löschen? Er wird auch aus zugewiesenen Firewalls entfernt.`)) return
    setTagsBusy(true)
    setTagsOk(null)
    try {
      await firewallTagsAPI.delete(tag.id)
      setTagsOk('Tag deleted.')
      await loadTags()
    } catch (e) {
      setTagsError(`Could not delete tag: ${e.response?.data?.detail || e.message}`)
    } finally {
      setTagsBusy(false)
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
    <div className="p-8 w-full space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-5 bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
          <h1 className="text-2xl font-black">Global Scheduler Settings</h1>
          <p className="text-indigo-100 text-sm mt-1">License check, monitoring interval, and S.M.A.R.T. check for all firewalls.</p>
        </div>

        <div className="p-6 grid md:grid-cols-3 gap-4">
          <Field
            label="Monitoring Interval (seconds)"
            type="number"
            value={form.monitoring_interval_seconds}
            min={5}
            onChange={(v) => setForm({ ...form, monitoring_interval_seconds: v })}
          />
          <Field
            label="License Check Hour (UTC)"
            type="number"
            value={form.license_check_hour}
            min={0}
            max={23}
            onChange={(v) => setForm({ ...form, license_check_hour: v })}
          />
          <Field
            label="S.M.A.R.T. Check Hour (UTC)"
            type="number"
            value={form.smart_check_hour}
            min={0}
            max={23}
            onChange={(v) => setForm({ ...form, smart_check_hour: v })}
          />
        </div>

        <div className="px-6 pb-6">
          {error && <div className="mb-3 rounded-lg bg-red-100 text-red-700 px-4 py-2 text-sm">{error}</div>}
          {ok && <div className="mb-3 rounded-lg bg-green-100 text-green-700 px-4 py-2 text-sm">{ok}</div>}
          <div className="flex justify-end gap-3">
            <button onClick={loadSettings} className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:bg-gray-600 font-semibold">
              Reload
            </button>
            <button onClick={save} disabled={saving} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white">
          <h2 className="text-2xl font-black">Firewall Tags</h2>
          <p className="text-cyan-100 text-sm mt-1">Create tags once and assign them in firewall create/edit forms.</p>
        </div>
        <div className="p-6">
          <div className="grid md:grid-cols-[1fr_auto] gap-3 mb-4">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="New tag name"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
            />
            <button
              onClick={createTag}
              disabled={tagsBusy || !newTagName.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-50"
            >
              Create Tag
            </button>
          </div>

          {tagsError && <div className="mb-3 rounded-lg bg-red-100 text-red-700 px-4 py-2 text-sm">{tagsError}</div>}
          {tagsOk && <div className="mb-3 rounded-lg bg-green-100 text-green-700 px-4 py-2 text-sm">{tagsOk}</div>}

          {tagsLoading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading tags...</p>
          ) : tags.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No tags yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span key={tag.id} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs font-semibold">
                  {tag.name}
                  <button
                    onClick={() => deleteTag(tag)}
                    disabled={tagsBusy}
                    className="hover:text-red-600 disabled:opacity-50"
                    title="Delete tag"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, type = 'text', value, onChange, min, max }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
      />
    </div>
  )
}
