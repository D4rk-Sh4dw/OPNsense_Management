import React, { useState, useEffect } from 'react'
import { emailAPI } from '../api/client'

const TEMPLATE_VARS = {
  license_expiry: ['customer_name', 'hostname', 'expiry_date', 'days_remaining', 'brand_name', 'primary_color'],
  update_failed: ['customer_name', 'hostname', 'error_message', 'brand_name'],
  offline: ['customer_name', 'hostname', 'brand_name'],
  smart_error: ['customer_name', 'hostname', 'device', 'status', 'brand_name'],
  generic: ['customer_name', 'hostname', 'severity', 'title', 'details', 'brand_name', 'primary_color'],
}

function Section({ title, children }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mb-6 border border-gray-200 dark:border-gray-700">
      <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">{title}</h2>
      {children}
    </div>
  )
}

function TextField({ label, value, onChange, type = 'text', placeholder, help }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input
        type={type}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
      />
      {help && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{help}</p>}
    </div>
  )
}

export default function EmailSettings() {
  const [branding, setBranding] = useState(null)
  const [templates, setTemplates] = useState([])
  const [activeKey, setActiveKey] = useState(null)
  const [draft, setDraft] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [savingBranding, setSavingBranding] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [testRecipients, setTestRecipients] = useState('')
  const [testStatus, setTestStatus] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (activeKey) refreshPreview(activeKey, draft)
  }, [activeKey])

  const load = async () => {
    try {
      const [b, t] = await Promise.all([emailAPI.getBranding(), emailAPI.listTemplates()])
      setBranding(b.data)
      setTemplates(t.data)
      if (t.data.length && !activeKey) {
        setActiveKey(t.data[0].key)
        setDraft(t.data[0])
      }
    } catch (e) {
      console.error(e)
      setToast({ type: 'error', message: 'Konnte Daten nicht laden' })
    }
  }

  const refreshPreview = async (key, currentDraft) => {
    if (!key) return
    setPreviewLoading(true)
    try {
      const r = await emailAPI.preview(key)
      setPreview(r.data)
    } catch (e) {
      console.error(e)
    } finally {
      setPreviewLoading(false)
    }
  }

  const onSaveBranding = async () => {
    setSavingBranding(true)
    try {
      const r = await emailAPI.updateBranding(branding)
      setBranding(r.data)
      setToast({ type: 'success', message: 'Branding gespeichert' })
      refreshPreview(activeKey, draft)
    } catch (e) {
      setToast({ type: 'error', message: 'Fehler beim Speichern' })
    } finally {
      setSavingBranding(false)
      setTimeout(() => setToast(null), 3000)
    }
  }

  const selectTemplate = (key) => {
    setActiveKey(key)
    const t = templates.find((x) => x.key === key)
    setDraft(t)
    setTestStatus(null)
  }

  const onSaveTemplate = async () => {
    if (!draft) return
    setSavingTemplate(true)
    try {
      const r = await emailAPI.updateTemplate(draft.key, {
        name: draft.name,
        subject: draft.subject,
        html_body: draft.html_body,
        plain_body: draft.plain_body,
        category: draft.category,
      })
      setTemplates(templates.map((t) => (t.key === draft.key ? r.data : t)))
      setDraft(r.data)
      setToast({ type: 'success', message: 'Template gespeichert' })
      refreshPreview(draft.key, r.data)
    } catch (e) {
      setToast({ type: 'error', message: 'Fehler beim Speichern' })
    } finally {
      setSavingTemplate(false)
      setTimeout(() => setToast(null), 3000)
    }
  }

  const onSendTest = async () => {
    if (!draft || !testRecipients.trim()) return
    setTestStatus({ loading: true })
    try {
      const r = await emailAPI.sendTest(draft.key, testRecipients)
      setTestStatus({ success: r.data.sent, message: `Versendet an: ${r.data.recipients?.join(', ')}` })
    } catch (e) {
      setTestStatus({ success: false, message: e.response?.data?.detail || 'Versand fehlgeschlagen' })
    }
  }

  if (!branding) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="p-8 w-full">
      <div className="mb-8">
        <h1 className="text-4xl font-black text-gray-900 dark:text-gray-100">E-Mail Einstellungen</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Branding und Vorlagen für Benachrichtigungen</p>
      </div>

      {toast && (
        <div className={`fixed top-20 right-6 px-4 py-3 rounded-lg shadow-lg z-50 ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.message}
        </div>
      )}

      {/* === Branding === */}
      <Section title="🎨 Branding">
        <div className="grid md:grid-cols-2 gap-4">
          <TextField label="Brand Name" value={branding.brand_name} onChange={(v) => setBranding({ ...branding, brand_name: v })} placeholder="Mein Unternehmen GmbH" />
          <TextField label="Logo URL" value={branding.logo_url} onChange={(v) => setBranding({ ...branding, logo_url: v })} placeholder="https://example.com/logo.png" help="Direkter Bildlink oder data: URI" />
          <TextField label="Primary Color" type="color" value={branding.primary_color || '#4f46e5'} onChange={(v) => setBranding({ ...branding, primary_color: v })} />
          <TextField label="Accent Color" type="color" value={branding.accent_color || '#3b82f6'} onChange={(v) => setBranding({ ...branding, accent_color: v })} />
          <TextField label="Reply-To Adresse" value={branding.reply_to} onChange={(v) => setBranding({ ...branding, reply_to: v })} placeholder="noreply@firma.de" />
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Footer Text</label>
            <textarea
              value={branding.footer_text || ''}
              onChange={(e) => setBranding({ ...branding, footer_text: e.target.value })}
              rows={2}
              placeholder="Mein Unternehmen | Adresse | Impressum"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <button onClick={onSaveBranding} disabled={savingBranding}
            className="bg-indigo-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-60">
            {savingBranding ? 'Speichern...' : 'Branding speichern'}
          </button>
          {branding.logo_url && (
            <img src={branding.logo_url} alt="Logo Preview" className="h-12 rounded bg-white p-1 border border-gray-200 dark:border-gray-600" />
          )}
        </div>
      </Section>

      {/* === Templates === */}
      <Section title="📝 Templates">
        <div className="grid md:grid-cols-[220px_1fr] gap-6">
          {/* Tabs */}
          <div className="space-y-1">
            {templates.map((t) => (
              <button
                key={t.key}
                onClick={() => selectTemplate(t.key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition ${activeKey === t.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              >
                {t.name}
                <span className={`block text-xs ${activeKey === t.key ? 'text-indigo-100' : 'text-gray-500 dark:text-gray-400'}`}>
                  {t.category === 'license' ? 'Lizenz' : 'Allgemein'}
                </span>
              </button>
            ))}
          </div>

          {/* Editor + Preview */}
          {draft && (
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Template Name</label>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Kategorie</label>
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  >
                    <option value="general">Allgemein</option>
                    <option value="license">Lizenz</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Subject</label>
                  <input
                    value={draft.subject}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">HTML Body</label>
                  <textarea
                    value={draft.html_body}
                    onChange={(e) => setDraft({ ...draft, html_body: e.target.value })}
                    rows={10}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Plain Text Body</label>
                  <textarea
                    value={draft.plain_body || ''}
                    onChange={(e) => setDraft({ ...draft, plain_body: e.target.value })}
                    rows={5}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 font-mono text-xs"
                  />
                </div>

                <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded border border-gray-200 dark:border-gray-700">
                  <p className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">Verfügbare Platzhalter:</p>
                  <div className="flex flex-wrap gap-1">
                    {(TEMPLATE_VARS[draft.key] || []).map((v) => (
                      <code key={v} className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded">
                        {`{${v}}`}
                      </code>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button onClick={onSaveTemplate} disabled={savingTemplate}
                    className="bg-indigo-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-60">
                    {savingTemplate ? 'Speichern...' : 'Template speichern'}
                  </button>
                  <button onClick={() => refreshPreview(draft.key, draft)}
                    className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-5 py-2 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition">
                    Vorschau aktualisieren
                  </button>
                </div>

                <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
                  <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">📨 Test versenden</p>
                  <div className="flex gap-2">
                    <input
                      value={testRecipients}
                      onChange={(e) => setTestRecipients(e.target.value)}
                      placeholder="empfaenger@firma.de"
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                    <button onClick={onSendTest}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                      Senden
                    </button>
                  </div>
                  {testStatus && (
                    <p className={`text-xs mt-2 ${testStatus.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {testStatus.loading ? 'Sende...' : testStatus.message}
                    </p>
                  )}
                </div>
              </div>

              {/* Preview pane */}
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">Live Vorschau</h3>
                {previewLoading ? (
                  <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-8 text-center text-gray-500">Lade Vorschau...</div>
                ) : preview ? (
                  <div className="space-y-2">
                    <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Subject:</p>
                      <p className="font-mono text-sm text-gray-900 dark:text-gray-100">{preview.subject}</p>
                    </div>
                    <iframe
                      title="Email Preview"
                      srcDoc={preview.html}
                      sandbox=""
                      className="w-full bg-white rounded-lg border border-gray-200 dark:border-gray-700"
                      style={{ minHeight: '520px' }}
                    />
                  </div>
                ) : (
                  <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-8 text-center text-gray-500">Keine Vorschau</div>
                )}
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}
