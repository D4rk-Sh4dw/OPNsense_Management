import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { firewallsAPI, firewallTagsAPI, backupsAPI, updatesAPI, idsAPI, rulesAPI, vpnAPI, configHistoryAPI } from '../api/client'

export default function FirewallDetail() {
  const { id } = useParams()
  const [firewall, setFirewall] = useState(null)
  const [status, setStatus] = useState(null)
  const [logs, setLogs] = useState([])
  const [logType, setLogType] = useState('firewall')
  const [loading, setLoading] = useState(true)
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [loadingLicense, setLoadingLicense] = useState(false)
  const [loadingSubscription, setLoadingSubscription] = useState(false)
  const [loadingHealth, setLoadingHealth] = useState(false)
  const [loadingServices, setLoadingServices] = useState(false)
  const [serviceAction, setServiceAction] = useState(null)
  const [loadingUpdate, setLoadingUpdate] = useState(false)
  const [loadingCheck, setLoadingCheck] = useState(false)
  const [loadingReboot, setLoadingReboot] = useState(false)
  const [updateInfo, setUpdateInfo] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [liveStats, setLiveStats] = useState(null)
  const [liveServices, setLiveServices] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [subscriptionKey, setSubscriptionKey] = useState('')
  const [tagCatalog, setTagCatalog] = useState([])
  // Bottom tabs: 'logs' | 'ids' | 'rules' | 'vpn'
  const [bottomTab, setBottomTab] = useState('logs')
  // IDS tab
  const [idsAlerts, setIdsAlerts] = useState([])
  const [idsStatus, setIdsStatus] = useState(null)
  const [idsLoading, setIdsLoading] = useState(false)
  const [idsError, setIdsError] = useState(null)
  // Rules tab
  const [rulesData, setRulesData] = useState([])
  const [aliasesData, setAliasesData] = useState([])
  const [rulesLoading, setRulesLoading] = useState(false)
  const [rulesSubTab, setRulesSubTab] = useState('rules')
  const [rulesError, setRulesError] = useState(null)
  const [rulesSearch, setRulesSearch] = useState('')
  // VPN tab
  const [vpnOpenVPN, setVpnOpenVPN] = useState(null)
  const [vpnWireGuard, setVpnWireGuard] = useState(null)
  const [vpnLoading, setVpnLoading] = useState(false)
  const [vpnSubTab, setVpnSubTab] = useState('openvpn')
  // Config History tab
  const [configHistory, setConfigHistory] = useState([])
  const [configHistoryLoading, setConfigHistoryLoading] = useState(false)
  const [configHistoryError, setConfigHistoryError] = useState(null)
  const [configHistorySelection, setConfigHistorySelection] = useState({ a: null, b: null })
  const [diffModal, setDiffModal] = useState(null)
  const [revertModal, setRevertModal] = useState(null)

  // Log filtering & scroll handling
  const [logFilter, setLogFilter] = useState({ action: 'all', iface: 'all', search: '' })
  const logContainerRef = useRef(null)
  const [autoFollowLogs, setAutoFollowLogs] = useState(true)
  const liveFailCountRef = useRef(0)

  useEffect(() => {
    loadAll()
    loadTagCatalog()
  }, [id])

  useEffect(() => {
    if (firewall) loadLogs()
  }, [logType])

  // Auto-refresh live CPU/RAM/uptime (paused when tab is hidden)
  useEffect(() => {
    if (!firewall || !autoRefresh) return
    let cancelled = false
    let timer = null
    const tick = async () => {
      if (document.hidden) return
      try {
        const res = await firewallsAPI.getLiveStats(id)
        liveFailCountRef.current = 0
        if (!cancelled) setLiveStats(res.data)
      } catch {
        liveFailCountRef.current += 1
        // Avoid one-shot flapping, but mark offline when failures persist.
        if (!cancelled && liveFailCountRef.current >= 3) {
          setLiveStats(prev => prev ? { ...prev, online: false } : { online: false })
        }
      }
    }
    tick()
    timer = setInterval(tick, 10000)
    const onVis = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [id, firewall, autoRefresh])

  // Refresh logs every 30s in auto-refresh mode (skipped when tab is hidden)
  useEffect(() => {
    if (!firewall || !autoRefresh) return
    const tick = () => { if (!document.hidden) loadLogs() }
    const interval = setInterval(tick, 30000)
    return () => clearInterval(interval)
  }, [id, firewall, autoRefresh, logType])

  useEffect(() => {
    if (!firewall || !autoRefresh) return
    const tick = () => { if (!document.hidden) loadServices() }
    const interval = setInterval(tick, 15000)
    return () => clearInterval(interval)
  }, [id, firewall, autoRefresh])

  useEffect(() => {
    if (!firewall) return
    if (bottomTab === 'ids' && idsAlerts.length === 0 && !idsLoading) loadIDS()
    if (bottomTab === 'rules' && rulesData.length === 0 && !rulesLoading) loadRules()
    if (bottomTab === 'vpn' && vpnOpenVPN === null && vpnWireGuard === null && !vpnLoading) loadVPN()
  }, [bottomTab, firewall])

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const loadAll = async () => {
    setLoading(true)
    try {
      const [fwRes, stRes] = await Promise.all([
        firewallsAPI.get(id),
        firewallsAPI.getStatus(id),
      ])
      setFirewall(fwRes.data)
      setStatus(stRes.data)
      loadServices()
      setError(null)
    } catch (e) {
      setError('Failed to load firewall')
    } finally {
      setLoading(false)
    }
  }

  const loadServices = async () => {
    setLoadingServices(true)
    try {
      const res = await firewallsAPI.getServices(id)
      setLiveServices(res.data)
    } catch (e) {
      setLiveServices(null)
    } finally {
      setLoadingServices(false)
    }
  }

  const loadTagCatalog = async () => {
    try {
      const res = await firewallTagsAPI.list()
      setTagCatalog(res.data || [])
    } catch {
      setTagCatalog([])
    }
  }

  const loadIDS = async () => {
    setIdsLoading(true)
    setIdsError(null)
    try {
      const [alertsRes, statusRes] = await Promise.allSettled([
        idsAPI.getAlerts(id, 200),
        idsAPI.getStatus(id),
      ])
      if (statusRes.status === 'fulfilled') setIdsStatus(statusRes.value.data)
      if (alertsRes.status === 'fulfilled') {
        const data = alertsRes.value.data
        let rows = []
        if (Array.isArray(data)) rows = data
        else if (Array.isArray(data?.rows)) rows = data.rows
        else if (Array.isArray(data?.data)) rows = data.data
        setIdsAlerts(rows)
      } else {
        const status = alertsRes.reason?.response?.status
        if (status === 404 || status === 502) setIdsError('not_configured')
        else setIdsError(alertsRes.reason?.response?.data?.detail || alertsRes.reason?.message)
      }
    } finally {
      setIdsLoading(false)
    }
  }

  const loadRules = async () => {
    setRulesLoading(true)
    setRulesError(null)
    try {
      const [rulesRes, aliasesRes] = await Promise.allSettled([
        rulesAPI.getRules(id),
        rulesAPI.getAliases(id),
      ])
      if (rulesRes.status === 'fulfilled') {
        const data = rulesRes.value.data
        let rows = []
        if (Array.isArray(data)) rows = data
        else if (Array.isArray(data?.rows)) rows = data.rows
        else if (Array.isArray(data?.data)) rows = data.data
        setRulesData(rows)
      } else {
        const status = rulesRes.reason?.response?.status
        if (status === 404 || status === 502) setRulesError('not_configured')
        else setRulesError(rulesRes.reason?.response?.data?.detail || rulesRes.reason?.message)
      }
      if (aliasesRes.status === 'fulfilled') {
        const data = aliasesRes.value.data
        let rows = []
        if (Array.isArray(data)) rows = data
        else if (Array.isArray(data?.rows)) rows = data.rows
        setAliasesData(rows)
      }
    } finally {
      setRulesLoading(false)
    }
  }

  const loadVPN = async () => {
    setVpnLoading(true)
    try {
      const [ovpnRes, wgRes] = await Promise.allSettled([
        vpnAPI.getOpenVPN(id),
        vpnAPI.getWireGuard(id),
      ])
      setVpnOpenVPN(ovpnRes.status === 'fulfilled' ? ovpnRes.value.data : null)
      setVpnWireGuard(wgRes.status === 'fulfilled' ? wgRes.value.data : null)
    } finally {
      setVpnLoading(false)
    }
  }

  const loadConfigHistory = async () => {
    setConfigHistoryLoading(true)
    setConfigHistoryError(null)
    try {
      const res = await configHistoryAPI.list(id)
      setConfigHistory(res.data || [])
    } catch (err) {
      setConfigHistoryError(err.message || 'Failed to load config history')
    } finally {
      setConfigHistoryLoading(false)
    }
  }

  const handleRestartService = async (service) => {
    const serviceName = service.description || service.name || service.service_id
    if (!window.confirm(`Dienst wirklich neu starten?\n\n${serviceName}`)) return
    setServiceAction(`restart:${service.service_id || service.name}`)
    try {
      await firewallsAPI.restartService(id, {
        service_id: service.service_id,
        name: service.name,
      })
      showToast(`Restart gestartet: ${serviceName}`)
      await loadServices()
    } catch (e) {
      showToast(`Restart fehlgeschlagen: ${e.response?.data?.detail || e.message}`, false)
    } finally {
      setServiceAction(null)
    }
  }

  const handleStartService = async (service) => {
    const serviceName = service.description || service.name || service.service_id
    if (!window.confirm(`Dienst wirklich starten?\n\n${serviceName}`)) return
    setServiceAction(`start:${service.service_id || service.name}`)
    try {
      await firewallsAPI.startService(id, {
        service_id: service.service_id,
        name: service.name,
      })
      showToast(`Start gestartet: ${serviceName}`)
      await loadServices()
    } catch (e) {
      showToast(`Start fehlgeschlagen: ${e.response?.data?.detail || e.message}`, false)
    } finally {
      setServiceAction(null)
    }
  }

  const loadLogs = async () => {
    setLoadingLogs(true)
    try {
      const res = await firewallsAPI.getLogs(id, logType, 50)
      const raw = res.data
      let entries = []
      if (Array.isArray(raw)) entries = raw
      else if (Array.isArray(raw?.rows)) entries = raw.rows
      else if (Array.isArray(raw?.data)) entries = raw.data
      else if (raw && typeof raw === 'object') entries = Object.values(raw)
      setLogs(entries)
    } catch (e) {
      setLogs([])
    } finally {
      setLoadingLogs(false)
    }
  }

  const formatLogEntry = (log) => {
    if (typeof log === 'string') return log
    if (!log || typeof log !== 'object') return String(log)
    const ts = log.__timestamp__ || log.timestamp || log.time || log['@timestamp'] || ''
    const action = log.action ? `[${log.action}]` : ''
    const iface = log.interface || log.if || ''
    const proto = log.protoname || log.proto || ''
    const src = log.src || log.source || log.srcip
    const sport = log.srcport ? `:${log.srcport}` : ''
    const dst = log.dst || log.destination || log.dstip
    const dport = log.dstport ? `:${log.dstport}` : ''
    const msg = log.msg || log.message || log.line
    if (src || dst) {
      return `${ts} ${action} ${iface} ${proto} ${src || ''}${sport} → ${dst || ''}${dport}`.trim()
    }
    if (msg) return `${ts} ${msg}`.trim()
    return JSON.stringify(log)
  }

  const handleFetchLicense = async () => {
    setLoadingLicense(true)
    try {
      const res = await firewallsAPI.fetchLicense(id)
      const expiry = res.data.license_expiry
        ? new Date(res.data.license_expiry).toLocaleDateString()
        : null
      const parts = [
        `${res.data.license_type} – ${res.data.product_name} ${res.data.product_version}`,
      ]
      if (expiry) {
        parts.push(`expiry: ${expiry}`)
      } else if (res.data.expiry_detected === false) {
        parts.push('no expiry exposed by firewall')
      }
      showToast(parts.join(' | '))
      loadAll()
    } catch (e) {
      showToast('Could not fetch license from firewall', false)
    } finally {
      setLoadingLicense(false)
    }
  }

  const handleUpdateSubscriptionKey = async () => {
    const key = (subscriptionKey || '').trim()
    if (!key) {
      showToast('Please enter a subscription key first', false)
      return
    }

    setLoadingSubscription(true)
    try {
      await firewallsAPI.updateSubscriptionKey(id, key)
      showToast('Subscription key updated on firewall')
      setSubscriptionKey('')
      await handleFetchLicense()
      await loadAll()
    } catch (e) {
      showToast('Could not update subscription key: ' + (e.response?.data?.detail || e.message), false)
    } finally {
      setLoadingSubscription(false)
    }
  }

  const handleHealthCheck = async () => {
    setLoadingHealth(true)
    try {
      await firewallsAPI.checkHealth(id)
      await loadAll()
      showToast('Health check completed')
    } catch (e) {
      showToast('Health check failed', false)
    } finally {
      setLoadingHealth(false)
    }
  }

  const handleInstallUpdates = async () => {
    if (!window.confirm('Start firmware update? A backup will be created automatically.')) return
    setLoadingUpdate(true)
    try {
      await updatesAPI.installUpdates(id)
      showToast('Update started in background')
    } catch (e) {
      showToast('Failed to start update', false)
    } finally {
      setLoadingUpdate(false)
    }
  }

  const handleCheckUpdates = async () => {
    setLoadingCheck(true)
    try {
      const res = await updatesAPI.checkUpdates(id)
      const data = res.data || {}
      const n = data.updates_available ?? 0
      setUpdateInfo(data)
      const extra = data.status_msg ? ` (${data.status_msg.replace(/<[^>]+>/g, '').slice(0, 120)})` : ''
      showToast(n > 0 ? `${n} update(s) available${extra}` : 'Firewall is up to date')
      loadAll()
    } catch (e) {
      showToast('Update check failed: ' + (e.response?.data?.detail || e.message), false)
    } finally {
      setLoadingCheck(false)
    }
  }

  const handleReboot = async () => {
    if (!window.confirm('Reboot the firewall? It will be offline for a few minutes.')) return
    setLoadingReboot(true)
    try {
      await firewallsAPI.reboot(id)
      showToast('Reboot initiated')
    } catch (e) {
      showToast('Reboot failed: ' + (e.response?.data?.detail || e.message), false)
    } finally {
      setLoadingReboot(false)
    }
  }

  const openEdit = () => {
    setEditForm({
      customer_name: firewall.customer_name || '',
      hostname: firewall.hostname || '',
      ip: firewall.ip || '',
      api_key: firewall.api_key || '',
      notify_email: firewall.notify_email || '',
      notify_emails_general: firewall.notify_emails_general || '',
      notify_emails_license: firewall.notify_emails_license || '',
      license_alert_days: firewall.license_alert_days || '',
      auto_update: !!firewall.auto_update,
      auto_update_window: firewall.auto_update_window || 'sun:02:00',
      backup_interval: firewall.backup_interval || 'daily',
      backup_time: firewall.backup_time || '01:00',
      backup_weekday: firewall.backup_weekday ?? 6,
      backup_monthday: firewall.backup_monthday ?? 1,
      backup_retention: firewall.backup_retention || 30,
      verify_ssl: !!firewall.verify_ssl,
      license_type: firewall.license_type || '',
      license_expiry: firewall.license_expiry ? firewall.license_expiry.split('T')[0] : '',
      tags: Array.isArray(firewall.tags) ? firewall.tags : [],
      notes: firewall.notes || '',
      api_secret: '',
      location_address: firewall.location_address || '',
    })
    setEditOpen(true)
  }

  const saveEdit = async () => {
    setSavingEdit(true)
    try {
      const payload = { ...editForm }
      const newSecret = payload.api_secret
      delete payload.api_secret

      payload.backup_retention = Math.max(1, parseInt(payload.backup_retention, 10) || 1)
      payload.backup_weekday = Math.max(0, Math.min(6, parseInt(payload.backup_weekday, 10) || 0))
      payload.backup_monthday = Math.max(1, Math.min(31, parseInt(payload.backup_monthday, 10) || 1))
      payload.tags = Array.isArray(payload.tags) ? payload.tags : []
      if (payload.license_expiry && !payload.license_expiry.includes('T')) {
        payload.license_expiry = payload.license_expiry + 'T00:00:00'
      }

      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null })
      await firewallsAPI.update(id, payload)
      if (newSecret && newSecret.trim()) {
        await firewallsAPI.updateApiSecret(id, newSecret.trim())
      }
      // Auto-geocode if address was set/changed
      const newAddr = editForm.location_address?.trim()
      if (newAddr && newAddr !== (firewall.location_address || '').trim()) {
        try {
          await firewallsAPI.geocode(id, newAddr)
        } catch {
          showToast('Gespeichert, aber Geocoding fehlgeschlagen. Adresse auf der Kartenseite korrigieren.', false)
          setEditOpen(false)
          loadAll()
          return
        }
      }
      showToast('Firewall settings updated')
      setEditOpen(false)
      loadAll()
    } catch (e) {
      const detail = e.response?.data?.detail
      const errMsg = Array.isArray(detail)
        ? detail.map(d => d.msg || JSON.stringify(d)).join('; ')
        : (detail || e.message)
      showToast('Save failed: ' + errMsg, false)
    } finally {
      setSavingEdit(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
    </div>
  )

  if (error || !firewall) return (
    <div className="p-8 text-red-600 dark:text-red-400">{error || 'Not found'}</div>
  )

  const licenseColor = firewall.license_type === 'business'
    ? 'bg-purple-100 text-purple-800'
    : firewall.license_type === 'community'
    ? 'bg-blue-100 text-blue-800'
    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'

  const serviceRows = Array.isArray(liveServices?.services)
    ? liveServices.services
    : Array.isArray(status?.services_status)
    ? status.services_status
    : []
  const pendingServices = Array.isArray(liveServices?.pending_services)
    ? liveServices.pending_services
    : Array.isArray(status?.pending_services)
    ? status.pending_services
    : []

  return (
    <div className="p-8 w-full">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-6 py-3 rounded-lg shadow-lg font-semibold text-white transition-all ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link to="/firewalls" className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800">← Back</Link>
        <div className="flex-1">
          <h1 className="text-4xl font-black text-gray-900 dark:text-gray-100">{firewall.customer_name}</h1>
          <p className="text-gray-500 dark:text-gray-400">{firewall.hostname || firewall.ip}</p>
          {Array.isArray(firewall.tags) && firewall.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {firewall.tags.map(t => (
                <span key={t} className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs font-semibold rounded-full">{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            <span className="font-semibold text-gray-700 dark:text-gray-300">Live</span>
            {autoRefresh && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>}
          </label>
          <button onClick={openEdit}
            className="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition font-semibold">
            ✎ Edit
          </button>
          <button onClick={handleHealthCheck} disabled={loadingHealth}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 font-semibold">
            {loadingHealth ? '...' : '🔄 Check Health'}
          </button>
          <button onClick={handleCheckUpdates} disabled={loadingCheck}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 font-semibold">
            {loadingCheck ? '...' : '🔎 Check Updates'}
          </button>
          {(() => {
            const n = updateInfo?.updates_available ?? status?.updates_available ?? 0
            if (n <= 0) return null
            return (
              <button onClick={handleInstallUpdates} disabled={loadingUpdate}
                className="bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition disabled:opacity-50 font-semibold">
                {loadingUpdate ? '...' : `⚡ Install ${n} Update(s)`}
              </button>
            )
          })()}
          <button onClick={handleReboot} disabled={loadingReboot}
            className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition disabled:opacity-50 font-semibold">
            {loadingReboot ? '...' : '⏻ Reboot'}
          </button>
          <a
            href={`https://${firewall.ip}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition font-semibold"
            title="OPNsense WebGUI öffnen"
          >
            🌐 WebGUI
          </a>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Status" value={(liveStats?.online ?? status?.online) ? '🟢 Online' : '🔴 Offline'} />
        <StatCard label="Firmware" value={status?.firmware_version || '—'} />
        <StatCard label="CPU" value={(liveStats?.cpu_usage ?? status?.cpu_usage) != null
          ? `${(liveStats?.cpu_usage ?? status?.cpu_usage).toFixed(1)}%` : '—'} live={autoRefresh && liveStats?.cpu_usage != null} />
        <StatCard label="RAM" value={(liveStats?.ram_usage ?? status?.ram_usage) != null
          ? `${(liveStats?.ram_usage ?? status?.ram_usage).toFixed(1)}%` : '—'} live={autoRefresh && liveStats?.ram_usage != null} />
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Firewall Info */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
          <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">Firewall Info</h2>
          <dl className="space-y-3 text-sm">
            <Row label="IP / URL" value={firewall.ip} mono />
            <Row label="API Key" value={firewall.api_key} mono />
            <Row label="Backup Schedule" value={formatBackupSchedule(firewall)} />
            <Row label="Auto Update" value={firewall.auto_update ? '✓ Enabled' : 'Disabled'} />
            <Row label="Auto Update Window" value={formatAutoUpdateWindow(firewall)} />
            <Row label="Tags" value={Array.isArray(firewall.tags) && firewall.tags.length > 0 ? firewall.tags.join(', ') : '—'} />
            <Row label="Backup Retention" value={`${firewall.backup_retention} days`} />
            <Row label="Notify Email (Fallback)" value={firewall.notify_email || '—'} />
            <Row label="General Recipients" value={firewall.notify_emails_general || '—'} />
            <Row label="License Recipients" value={firewall.notify_emails_license || '—'} />
            <Row label="License Warning Days" value={firewall.license_alert_days || '— (global default)'} />
            <Row label="Created" value={new Date(firewall.created_at).toLocaleDateString()} />
            <Row label="Last Seen" value={firewall.last_seen ? new Date(firewall.last_seen).toLocaleString() : 'Never'} />
          </dl>
        </div>

        {/* License Info */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">License</h2>
            <button onClick={handleFetchLicense} disabled={loadingLicense}
              className="text-sm bg-indigo-100 text-indigo-700 px-3 py-1 rounded-lg hover:bg-indigo-200 transition disabled:opacity-50 font-semibold">
              {loadingLicense ? '...' : '🔍 Fetch from Firewall'}
            </button>
          </div>
          <div className="mb-4 grid md:grid-cols-[1fr_auto] gap-2">
            <input
              type="password"
              value={subscriptionKey}
              onChange={e => setSubscriptionKey(e.target.value)}
              placeholder="OPNsense subscription key"
              className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
              autoComplete="off"
            />
            <button
              onClick={handleUpdateSubscriptionKey}
              disabled={loadingSubscription || !subscriptionKey.trim()}
              className="bg-amber-500 text-white px-3 py-2 rounded-lg hover:bg-amber-600 transition disabled:opacity-50 font-semibold"
            >
              {loadingSubscription ? '...' : 'Save Key'}
            </button>
          </div>
          <dl className="space-y-3 text-sm">
            <Row label="Type" value={
              <span className={`px-2 py-1 rounded-full text-xs font-bold ${licenseColor}`}>
                {firewall.license_type || 'Unknown'}
              </span>
            } />
            <Row label="Expiry" value={firewall.license_expiry ? new Date(firewall.license_expiry).toLocaleDateString() : '—'} />
          </dl>
          {firewall.notes && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-xs font-bold uppercase text-gray-400 mb-1">Notes</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">{firewall.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Gateway Status */}
      {status?.gateway_status && <GatewayStatusCard data={status.gateway_status} />}

      {/* Service Status */}
      <ServiceStatusCard
        services={serviceRows}
        pendingServices={pendingServices}
        hasStatus={!!status}
        loading={loadingServices}
        onRefresh={loadServices}
        onStart={handleStartService}
        onRestart={handleRestartService}
        serviceAction={serviceAction}
      />

      {/* Bottom Panel: Logs / IDS / Rules / VPN / Config History */}
      <div className="mb-8">
        {/* Tab bar */}
        <div className="flex gap-2 mb-0 flex-wrap">
          {[
            ['logs', '📋 Logs'],
            ['ids', '🛡 IDS'],
            ['rules', '📜 Rules'],
            ['vpn', '🔒 VPN'],
            ['config-history', '📝 Config History'],
          ].map(([t, l]) => (
            <button key={t} onClick={() => {
              setBottomTab(t)
              if (t === 'config-history') loadConfigHistory()
            }}
              className={`px-4 py-2 rounded-t-lg font-semibold text-sm transition border-b-2 ${
                bottomTab === t
                  ? 'bg-white dark:bg-gray-800 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'bg-gray-100 dark:bg-gray-700 border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}>{l}</button>
          ))}
        </div>

        {bottomTab === 'logs' && (
          <LiveLogsCard
            logs={logs}
            loadingLogs={loadingLogs}
            logType={logType}
            setLogType={setLogType}
            onRefresh={loadLogs}
            filter={logFilter}
            setFilter={setLogFilter}
            autoFollow={autoFollowLogs}
            setAutoFollow={setAutoFollowLogs}
            containerRef={logContainerRef}
            formatLogEntry={formatLogEntry}
          />
        )}

        {bottomTab === 'ids' && (
          <IDSTabPanel
            alerts={idsAlerts}
            status={idsStatus}
            loading={idsLoading}
            error={idsError}
            onRefresh={loadIDS}
            firewallId={id}
          />
        )}

        {bottomTab === 'rules' && (
          <RulesTabPanel
            rules={rulesData}
            aliases={aliasesData}
            loading={rulesLoading}
            error={rulesError}
            onRefresh={loadRules}
            subTab={rulesSubTab}
            setSubTab={setRulesSubTab}
            search={rulesSearch}
            setSearch={setRulesSearch}
          />
        )}

        {bottomTab === 'vpn' && (
          <VPNTabPanel
            openvpn={vpnOpenVPN}
            wireguard={vpnWireGuard}
            loading={vpnLoading}
            onRefresh={loadVPN}
            subTab={vpnSubTab}
            setSubTab={setVpnSubTab}
          />
        )}

        {bottomTab === 'config-history' && (
          <ConfigHistoryTabPanel
            configHistory={configHistory}
            loading={configHistoryLoading}
            error={configHistoryError}
            onRefresh={loadConfigHistory}
            onSync={() => {
              configHistoryAPI.sync(id).then(() => loadConfigHistory()).catch(e => setConfigHistoryError(e.message))
            }}
            firewallId={id}
            configHistoryAPI={configHistoryAPI}
          />
        )}
      </div>

      {/* Edit Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h3 className="text-2xl font-black text-gray-900 dark:text-gray-100">Edit Firewall</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{firewall.customer_name}</p>
            </div>
            <div className="p-6 grid md:grid-cols-2 gap-4 text-sm">
              <Field label="Customer Name" value={editForm.customer_name}
                onChange={v => setEditForm({...editForm, customer_name: v})} />
              <Field label="Hostname" value={editForm.hostname}
                onChange={v => setEditForm({...editForm, hostname: v})} />
              <Field label="IP / URL" value={editForm.ip}
                onChange={v => setEditForm({...editForm, ip: v})} />
              <Field label="API Key" value={editForm.api_key}
                onChange={v => setEditForm({...editForm, api_key: v})} mono />
              <Field label="API Secret (leave empty to keep)" value={editForm.api_secret}
                onChange={v => setEditForm({...editForm, api_secret: v})} mono type="password" />
              <Field label="Notify Email (Legacy / Fallback)" value={editForm.notify_email}
                onChange={v => setEditForm({...editForm, notify_email: v})} />
              <Field label="General Alert Recipients (CSV)" value={editForm.notify_emails_general}
                onChange={v => setEditForm({...editForm, notify_emails_general: v})}
                placeholder="ops@firma.de, noc@firma.de" />
              <Field label="License Alert Recipients (CSV)" value={editForm.notify_emails_license}
                onChange={v => setEditForm({...editForm, notify_emails_license: v})}
                placeholder="sales@firma.de, kunde@firma.de" />
              <Field label="License Warning Days (CSV)" value={editForm.license_alert_days}
                onChange={v => setEditForm({...editForm, license_alert_days: v})}
                placeholder="30,14,7,1" />
              <SelectField label="License Type" value={editForm.license_type}
                onChange={v => setEditForm({...editForm, license_type: v})}
                options={[['', '—'], ['community', 'Community'], ['business', 'Business']]} />
              <Field label="License Expiry" type="date" value={editForm.license_expiry}
                onChange={v => setEditForm({...editForm, license_expiry: v})} />
              <BackupScheduleEditor editForm={editForm} setEditForm={setEditForm} />
              <Field label="Backup Retention (Days)" type="number" value={editForm.backup_retention}
                onChange={v => setEditForm({...editForm, backup_retention: Math.max(1, parseInt(v) || 1)})} />
              <AutoUpdateWindowEditor editForm={editForm} setEditForm={setEditForm} />
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">Tags</label>
                <select
                  multiple
                  value={editForm.tags || []}
                  onChange={(e) => {
                    const selected = Array.from(e.target.options)
                      .filter((opt) => opt.selected)
                      .map((opt) => opt.value)
                    setEditForm({ ...editForm, tags: selected })
                  }}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white dark:bg-gray-800 min-h-[110px]"
                >
                  {(tagCatalog || []).map((tag) => (
                    <option key={tag.id} value={tag.name}>{tag.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Mehrfachauswahl: Strg/Cmd gedrückt halten und Tags anklicken.</p>
              </div>
              <div className="flex items-center gap-2 col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editForm.auto_update}
                    onChange={e => setEditForm({...editForm, auto_update: e.target.checked})} />
                  <span className="font-semibold">Auto-install updates</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer ml-6">
                  <input type="checkbox" checked={editForm.verify_ssl}
                    onChange={e => setEditForm({...editForm, verify_ssl: e.target.checked})} />
                  <span className="font-semibold">Verify SSL</span>
                </label>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">Notes</label>
                <textarea value={editForm.notes}
                  onChange={e => setEditForm({...editForm, notes: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  rows="3" />
              </div>
              <div className="col-span-2">
                <p className="text-xs font-bold uppercase text-indigo-600 dark:text-indigo-400 tracking-widest mb-2">Standort (für Karte)</p>
                <Field label="Adresse" value={editForm.location_address}
                  onChange={v => setEditForm({...editForm, location_address: v})}
                  placeholder="Musterstraße 1, 12345 Berlin" />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Wird beim Speichern automatisch geocodiert und auf der Karte angezeigt.</p>
              </div>
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={() => setEditOpen(false)}
                className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:bg-gray-600 font-semibold">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={savingEdit}
                className="px-6 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50">
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', mono = false, placeholder }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 ${mono ? 'font-mono text-xs' : ''}`} />
    </div>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white dark:bg-gray-800">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

function BackupScheduleEditor({ editForm, setEditForm }) {
  return (
    <>
      <SelectField
        label="Backup Plan"
        value={editForm.backup_interval}
        onChange={v => setEditForm({ ...editForm, backup_interval: v })}
        options={[
          ['hourly', 'Every Hour'],
          ['daily', 'Daily'],
          ['weekly', 'Weekly'],
          ['monthly', 'Monthly'],
          ['disabled', 'Disabled'],
        ]}
      />

      {editForm.backup_interval !== 'disabled' && editForm.backup_interval !== 'hourly' && (
        <Field
          label="Backup Time"
          type="time"
          value={editForm.backup_time || '01:00'}
          onChange={v => setEditForm({ ...editForm, backup_time: v || '01:00' })}
        />
      )}

      {editForm.backup_interval === 'weekly' && (
        <SelectField
          label="Weekday"
          value={String(editForm.backup_weekday ?? 6)}
          onChange={v => setEditForm({ ...editForm, backup_weekday: parseInt(v, 10) })}
          options={[
            ['0', 'Monday'],
            ['1', 'Tuesday'],
            ['2', 'Wednesday'],
            ['3', 'Thursday'],
            ['4', 'Friday'],
            ['5', 'Saturday'],
            ['6', 'Sunday'],
          ]}
        />
      )}

      {editForm.backup_interval === 'monthly' && (
        <Field
          label="Day of Month"
          type="number"
          value={editForm.backup_monthday ?? 1}
          onChange={v => setEditForm({ ...editForm, backup_monthday: Math.max(1, Math.min(31, parseInt(v) || 1)) })}
        />
      )}
    </>
  )
}

function AutoUpdateWindowEditor({ editForm, setEditForm }) {
  const raw = editForm.auto_update_window || 'sun:02:00'
  const parts = raw.split(':')
  const day = parts[0] || 'sun'
  const time = parts.length >= 3 ? `${parts[1]}:${parts[2]}` : '02:00'
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00')
  return (
    <>
      <SelectField
        label="Auto-Update Day"
        value={day}
        onChange={v => setEditForm({ ...editForm, auto_update_window: `${v}:${time}` })}
        options={[
          ['mon', 'Monday'],
          ['tue', 'Tuesday'],
          ['wed', 'Wednesday'],
          ['thu', 'Thursday'],
          ['fri', 'Friday'],
          ['sat', 'Saturday'],
          ['sun', 'Sunday'],
        ]}
      />
      <SelectField
        label="Auto-Update Time"
        value={time}
        onChange={v => setEditForm({ ...editForm, auto_update_window: `${day}:${v}` })}
        options={hours.map(h => [h, h])}
      />
    </>
  )
}

function formatAutoUpdateWindow(firewall) {
  const raw = firewall?.auto_update_window
  if (!raw) return '—'
  const parts = raw.split(':')
  const day = parts[0]
  const time = parts.length >= 3 ? `${parts[1]}:${parts[2]}` : raw
  const dayNames = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
  return `${dayNames[day] || day} at ${time}`
}

function formatBackupSchedule(firewall) {
  const interval = (firewall?.backup_interval || 'daily').toLowerCase()
  const time = firewall?.backup_time || '01:00'
  const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  if (interval === 'disabled') return 'Disabled'
  if (interval === 'hourly') return 'Every hour'
  if (interval === 'daily') return `Daily at ${time}`
  if (interval === 'weekly') return `Weekly (${weekdayNames[firewall?.backup_weekday ?? 6] || 'Sun'}) at ${time}`
  if (interval === 'monthly') return `Monthly (day ${firewall?.backup_monthday ?? 1}) at ${time}`
  return interval
}

function StatCard({ label, value, live }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 relative">
      <p className="text-xs font-bold uppercase text-gray-400 mb-1 flex items-center gap-2">
        {label}
        {live && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>}
      </p>
      <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  )
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="font-semibold text-gray-500 dark:text-gray-400 shrink-0">{label}</dt>
      <dd className={`text-right text-gray-900 dark:text-gray-100 ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</dd>
    </div>
  )
}

function GatewayStatusCard({ data }) {
  // OPNsense gateway status format: { items: { GW_NAME: { name, address, status, loss, delay, stddev, monitor, ... }}}
  // or older: { items: [...] }
  const gateways = useMemo(() => {
    if (!data) return []
    const items = data.items ?? data
    if (Array.isArray(items)) return items
    if (typeof items === 'object') return Object.values(items)
    return []
  }, [data])

  const statusBadge = (status) => {
    const s = String(status || '').toLowerCase()
    if (!s || s === 'none') return 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
    if (s.includes('online') && !s.includes('loss') && !s.includes('delay')) return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
    if (s.includes('warning') || s.includes('delay') || s.includes('loss')) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'
    if (s.includes('offline') || s.includes('down') || s.includes('force')) return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
    return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }

  const statusLabel = (g) => {
    const raw = String(g.status ?? '').toLowerCase()
    if (raw && raw !== 'none') return g.status_translated || g.status
    // No active monitoring → fall back to translated text or "Monitoring disabled"
    if (g.status_translated && String(g.status_translated).toLowerCase() !== 'none') {
      return g.status_translated
    }
    return 'No monitor'
  }

  const lossBarColor = (loss) => {
    const v = parseFloat(loss) || 0
    if (v >= 50) return 'bg-red-500'
    if (v >= 10) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  if (gateways.length === 0) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8">
      <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">Gateway Status</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 uppercase border-b">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Address</th>
              <th className="py-2 pr-4">Monitor</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Loss</th>
              <th className="py-2 pr-4">Delay</th>
              <th className="py-2 pr-4">Stddev</th>
            </tr>
          </thead>
          <tbody>
            {gateways.map((g, i) => {
              const loss = parseFloat(g.loss) || 0
              return (
                <tr key={i} className="border-b hover:bg-gray-50 dark:bg-gray-900">
                  <td className="py-3 pr-4 font-semibold">{g.name || '—'}</td>
                  <td className="py-3 pr-4 font-mono text-xs">{g.address || g.gateway || '—'}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-gray-500 dark:text-gray-400">{g.monitor || '—'}</td>
                  <td className="py-3 pr-4">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${statusBadge(g.status)}`}>
                      {statusLabel(g)}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                        <div className={`h-2 rounded-full ${lossBarColor(g.loss)}`}
                          style={{ width: `${Math.min(loss, 100)}%` }}></div>
                      </div>
                      <span className="text-xs font-mono w-12 text-right">{g.loss || '0%'}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">{g.delay || '—'}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-gray-500 dark:text-gray-400">{g.stddev || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ServiceStatusCard({ services, pendingServices, hasStatus, loading, onRefresh, onStart, onRestart, serviceAction }) {
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const detailed = Array.isArray(services) ? services : []
    if (detailed.length > 0) return detailed

    const pending = Array.isArray(pendingServices) ? pendingServices : []
    return pending.map((name) => ({
      service_id: name,
      name,
      description: name,
      enabled: true,
      running: false,
      status: 'stopped',
      has_error: true,
    }))
  }, [services, pendingServices])

  const summary = useMemo(() => {
    return rows.reduce((acc, svc) => {
      acc.total += 1
      if (svc.enabled === true) acc.enabled += 1
      if (svc.running === true) acc.running += 1
      if (svc.has_error) acc.errors += 1
      return acc
    }, { total: 0, enabled: 0, running: 0, errors: 0 })
  }, [rows])

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((svc) => {
      const haystack = `${svc.service_id || ''} ${svc.name || ''} ${svc.description || ''} ${svc.status || ''}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [rows, search])

  const highlightedRows = useMemo(() => {
    const keywords = ['wireguard', 'unbound', 'paketfilter', 'filter', 'cron', 'gateway', 'ntp', 'ssh', 'web', 'routing', 'acme', 'dyndns']
    return rows.filter((svc) => {
      const haystack = `${svc.name || ''} ${svc.description || ''}`.toLowerCase()
      return keywords.some((keyword) => haystack.includes(keyword))
    })
  }, [rows])

  const enabledLabel = (enabled) => {
    if (enabled === true) return 'Yes'
    if (enabled === false) return 'No'
    return 'Unknown'
  }

  const runningBadge = (svc) => {
    if (svc.has_error) return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
    if (svc.running === true) return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
    if (svc.running === false) return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
    return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'
  }

  const runningLabel = (svc) => {
    if (svc.has_error) return 'Error'
    if (svc.running === true) return 'Running'
    if (svc.running === false) return 'Stopped'
    return 'Unknown'
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Service Status</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Live aus der OPNsense-Diensteliste, z.B. Unbound, Paketfilter, Cron und WireGuard-Instanzen.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <span className="px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">Total {summary.total}</span>
          <span className="px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">Enabled {summary.enabled}</span>
          <span className="px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">Running {summary.running}</span>
          <span className="px-3 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200">Errors {summary.errors}</span>
          <button onClick={onRefresh} disabled={loading}
            className="px-3 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-200 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition disabled:opacity-50">
            {loading ? 'Lade...' : 'Aktualisieren'}
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Dienst suchen, z.B. unbound, wireguard, filter ..."
          className="w-full max-w-md px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600"
        />
        {search && (
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            {filteredRows.length} Treffer
          </span>
        )}
      </div>

      {highlightedRows.length > 0 && !search && (
        <div className="mb-4 flex flex-wrap gap-2">
          {highlightedRows.map((svc) => (
            <span key={`highlight-${svc.name}`} className={`px-2 py-1 rounded-full text-xs font-semibold ${runningBadge(svc)}`}>
              {svc.description || svc.name}
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-4 py-5 text-sm text-gray-600 dark:text-gray-400">
          {hasStatus
            ? 'Noch keine Dienstedetails vorhanden. Bitte auf "Aktualisieren" klicken. Falls weiterhin nichts erscheint, den Backend-Container nach dem Update neu starten.'
            : 'Es liegt noch kein Health-Check vor. Du kannst trotzdem auf "Aktualisieren" klicken, um die Diensteliste live vom Firewall-API zu laden.'}
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-4 py-5 text-sm text-gray-600 dark:text-gray-400">
          Keine Dienste passend zur Suche gefunden.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase border-b">
                <th className="py-2 pr-4">Service</th>
                <th className="py-2 pr-4">Description</th>
                <th className="py-2 pr-4">Enabled</th>
                <th className="py-2 pr-4">State</th>
                <th className="py-2 pr-4">Source Status</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((svc) => (
                <tr key={svc.service_id || svc.name} className="border-b hover:bg-gray-50 dark:hover:bg-gray-900/50">
                  <td className="py-3 pr-4 font-mono text-xs text-gray-900 dark:text-gray-100">{svc.name}</td>
                  <td className="py-3 pr-4 text-gray-700 dark:text-gray-300">{svc.description || '—'}</td>
                  <td className="py-3 pr-4 text-gray-700 dark:text-gray-300">{enabledLabel(svc.enabled)}</td>
                  <td className="py-3 pr-4">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${runningBadge(svc)}`}>
                      {runningLabel(svc)}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-xs font-mono text-gray-500 dark:text-gray-400">{svc.status || '—'}</td>
                  <td className="py-3 pr-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => onStart(svc)}
                        disabled={!onStart || serviceAction === `start:${svc.service_id || svc.name}`}
                        className="px-3 py-1 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition disabled:opacity-50"
                      >
                        {serviceAction === `start:${svc.service_id || svc.name}` ? 'Start...' : 'Start'}
                      </button>
                      <button
                        onClick={() => onRestart(svc)}
                        disabled={!onRestart || serviceAction === `restart:${svc.service_id || svc.name}`}
                        className="px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
                      >
                        {serviceAction === `restart:${svc.service_id || svc.name}` ? 'Restart...' : 'Restart'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LiveLogsCard({ logs, loadingLogs, logType, setLogType, onRefresh, filter, setFilter, autoFollow, setAutoFollow, containerRef, formatLogEntry }) {
  // Collect distinct interfaces for filter dropdown
  const interfaces = useMemo(() => {
    const set = new Set()
    logs.forEach(l => {
      if (typeof l === 'object' && l) {
        const iface = l.interface || l.if
        if (iface) set.add(iface)
      }
    })
    return Array.from(set).sort()
  }, [logs])

  // Apply filters
  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      if (typeof l !== 'object' || l === null) {
        // string logs only support search filter
        if (filter.search) return String(l).toLowerCase().includes(filter.search.toLowerCase())
        return filter.action === 'all'
      }
      const action = String(l.action || '').toLowerCase()
      if (filter.action === 'pass' && !(action === 'pass' || action === 'allow' || action === 'accept')) return false
      if (filter.action === 'block' && !(action === 'block' || action === 'reject' || action === 'drop')) return false
      const iface = l.interface || l.if
      if (filter.iface !== 'all' && iface !== filter.iface) return false
      if (filter.search) {
        const needle = filter.search.toLowerCase()
        const haystack = [
          l.src, l.dst, l.srcport, l.dstport, l.protoname, l.proto, l.action, l.label, l.rid, l.msg, l.line
        ].filter(Boolean).map(String).join(' ').toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [logs, filter])

  // Determine line color from action
  const lineClass = (log) => {
    if (typeof log !== 'object' || log === null) return 'text-gray-300'
    const action = String(log.action || '').toLowerCase()
    if (action === 'pass' || action === 'allow' || action === 'accept') return 'text-green-400 border-l-2 border-green-500 pl-2'
    if (action === 'block' || action === 'reject' || action === 'drop') return 'text-red-400 border-l-2 border-red-500 pl-2'
    return 'text-gray-300 border-l-2 border-gray-700 pl-2'
  }

  // Preserve scroll position; auto-follow only when user is near bottom
  const prevScrollRef = useRef({ top: 0, height: 0 })

  // Detect user scrolling away from bottom → disable auto-follow
  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    if (autoFollow !== nearBottom) setAutoFollow(nearBottom)
  }

  // Before logs update we capture the scroll state; after update we apply
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (autoFollow) {
      el.scrollTop = el.scrollHeight
    } else {
      const delta = el.scrollHeight - prevScrollRef.current.height
      el.scrollTop = prevScrollRef.current.top + (delta > 0 ? delta : 0)
    }
    prevScrollRef.current = { top: el.scrollTop, height: el.scrollHeight }
  }, [filteredLogs, autoFollow, containerRef])

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Live Logs</h2>
        <div className="flex gap-2 flex-wrap">
          {['firewall', 'system', 'backend'].map(t => (
            <button key={t} onClick={() => setLogType(t)}
              className={`px-3 py-1 rounded-lg text-sm font-semibold transition ${logType === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200'}`}>
              {t}
            </button>
          ))}
          <button onClick={onRefresh} className="px-3 py-1 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-700 hover:bg-gray-200">
            🔄
          </button>
        </div>
      </div>

      {logType === 'firewall' && (
        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            {[['all', 'All'], ['pass', '✓ Pass'], ['block', '✕ Block']].map(([v, l]) => (
              <button key={v} onClick={() => setFilter({ ...filter, action: v })}
                className={`px-3 py-1 rounded text-xs font-semibold transition ${
                  filter.action === v
                    ? v === 'pass' ? 'bg-green-600 text-white'
                    : v === 'block' ? 'bg-red-600 text-white'
                    : 'bg-indigo-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                }`}>{l}</button>
            ))}
          </div>
          {interfaces.length > 0 && (
            <select value={filter.iface} onChange={e => setFilter({ ...filter, iface: e.target.value })}
              className="px-3 py-1 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-700 border-0">
              <option value="all">All interfaces</option>
              {interfaces.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          )}
          <input type="text" placeholder="Search IP, port, protocol..."
            value={filter.search}
            onChange={e => setFilter({ ...filter, search: e.target.value })}
            className="px-3 py-1 rounded-lg text-xs border bg-white dark:bg-gray-800 flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-indigo-600" />
          <span className="text-xs text-gray-500 dark:text-gray-400">{filteredLogs.length}/{logs.length}</span>
        </div>
      )}

      <div ref={containerRef} onScroll={handleScroll}
        className="bg-gray-900 rounded-lg p-4 h-80 overflow-y-auto font-mono text-xs">
        {loadingLogs && logs.length === 0 ? (
          <p className="text-gray-400">Loading logs...</p>
        ) : filteredLogs.length > 0 ? (
          filteredLogs.map((log, i) => (
            <div key={i} className={`mb-1 whitespace-pre-wrap break-all ${lineClass(log)}`}>
              {formatLogEntry(log)}
            </div>
          ))
        ) : logs.length > 0 ? (
          <p className="text-gray-400">No entries match the current filter.</p>
        ) : (
          <p className="text-gray-400">No log entries found.</p>
        )}
      </div>
      {!autoFollow && (
        <button onClick={() => setAutoFollow(true)}
          className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-semibold">
          ↓ Jump to latest
        </button>
      )}
    </div>
  )
}

// ===== IDS Tab Panel =====
function IDSTabPanel({ alerts, status, loading, error, onRefresh }) {
  const [filter, setFilter] = useState({ action: 'all', search: '' })

  const idsRunning = status?.status === 'running' || status?.running === true || status?.ids_status === 'running'

  const filteredAlerts = useMemo(() => {
    return alerts.filter(a => {
      const action = String(a.action || a.alert?.action || '').toLowerCase()
      if (filter.action === 'alert' && action !== 'alert') return false
      if (filter.action === 'drop' && !(action === 'drop' || action === 'reject')) return false
      if (filter.search) {
        const needle = filter.search.toLowerCase()
        const hay = [a.src_ip, a.dest_ip, a.src_port, a.dest_port,
          a.alert?.signature, a.alert?.category, a.proto, a.signature
        ].filter(Boolean).map(String).join(' ').toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [alerts, filter])

  const actionBadge = (a) => {
    const action = String(a.action || a.alert?.action || '').toLowerCase()
    if (action === 'drop' || action === 'reject') return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
    if (action === 'alert') return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'
    return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-b-xl rounded-tr-xl shadow p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">IDS Alerts</h2>
          {status && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${idsRunning ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
              {idsRunning ? '🟢 Running' : '🔴 Stopped'}
            </span>
          )}
        </div>
        <button onClick={onRefresh} disabled={loading}
          className="px-3 py-1 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
          {loading ? 'Loading...' : '🔄 Refresh'}
        </button>
      </div>

      {error === 'not_configured' ? (
        <div className="py-8 text-center">
          <p className="text-5xl mb-3">🛡️</p>
          <p className="font-semibold text-gray-700 dark:text-gray-300">IDS not configured</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Suricata (os-suricata) does not appear to be installed or enabled.</p>
        </div>
      ) : error ? (
        <div className="text-red-600 dark:text-red-400 text-sm p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">{error}</div>
      ) : loading && alerts.length === 0 ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>
      ) : alerts.length === 0 ? (
        <div className="py-8 text-center text-gray-500 dark:text-gray-400">No IDS alerts found.</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              {[['all', 'All'], ['alert', '⚠ Alert'], ['drop', '✕ Drop']].map(([v, l]) => (
                <button key={v} onClick={() => setFilter(f => ({ ...f, action: v }))}
                  className={`px-3 py-1 rounded text-xs font-semibold transition ${
                    filter.action === v
                      ? v === 'drop' ? 'bg-red-600 text-white' : v === 'alert' ? 'bg-yellow-500 text-white' : 'bg-indigo-600 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                  }`}>{l}</button>
              ))}
            </div>
            <input type="text" placeholder="Search IP, signature..."
              value={filter.search}
              onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
              className="flex-1 px-3 py-1 rounded-lg text-xs border bg-white dark:bg-gray-800 min-w-[150px] focus:outline-none focus:ring-2 focus:ring-indigo-600" />
            <span className="text-xs text-gray-500 dark:text-gray-400">{filteredAlerts.length}/{alerts.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 uppercase border-b text-xs">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2 pr-3">Src</th>
                  <th className="py-2 pr-3">Dst</th>
                  <th className="py-2 pr-3">Proto</th>
                  <th className="py-2 pr-3">Signature</th>
                  <th className="py-2 pr-3">Severity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredAlerts.map((a, i) => {
                  const ts = a.timestamp || a['@timestamp'] || ''
                  const action = a.action || a.alert?.action || '—'
                  const src = `${a.src_ip || '—'}${a.src_port ? ':' + a.src_port : ''}`
                  const dst = `${a.dest_ip || '—'}${a.dest_port ? ':' + a.dest_port : ''}`
                  const sig = a.alert?.signature || a.signature || a.msg || '—'
                  return (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                      <td className="py-2 pr-3 font-mono text-gray-500 whitespace-nowrap">{ts ? new Date(ts).toLocaleTimeString() : '—'}</td>
                      <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded font-bold ${actionBadge(a)}`}>{action}</span></td>
                      <td className="py-2 pr-3 font-mono">{src}</td>
                      <td className="py-2 pr-3 font-mono">{dst}</td>
                      <td className="py-2 pr-3">{a.proto || '—'}</td>
                      <td className="py-2 pr-3 max-w-xs truncate" title={sig}>{sig}</td>
                      <td className="py-2 pr-3 font-mono">{a.alert?.severity || a.severity || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ===== Rules Tab Panel =====
function RulesTabPanel({ rules, aliases, loading, error, onRefresh, subTab, setSubTab, search, setSearch }) {
  const [actionFilter, setActionFilter] = useState('all')

  const filteredRules = useMemo(() => {
    return rules.filter(r => {
      const action = String(r.action || '').toLowerCase()
      if (actionFilter === 'pass' && !(action === 'pass' || action === 'allow')) return false
      if (actionFilter === 'block' && !(action === 'block' || action === 'reject' || action === 'drop')) return false
      if (search) {
        const needle = search.toLowerCase()
        const hay = [r.description, r.descr, r.protocol, r.interface, r.action]
          .filter(Boolean).map(String).join(' ').toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [rules, actionFilter, search])

  const filteredAliases = useMemo(() => {
    if (!search) return aliases
    const needle = search.toLowerCase()
    return aliases.filter(a => [a.name, a.type, a.description, a.content]
      .filter(Boolean).map(String).join(' ').toLowerCase().includes(needle))
  }, [aliases, search])

  const actionBadge = (action) => {
    const a = String(action || '').toLowerCase()
    if (a === 'pass' || a === 'allow') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    if (a === 'block' || a === 'reject' || a === 'drop') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-b-xl rounded-tr-xl shadow p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-2">
          {[['rules', '🛡 Rules'], ['aliases', '📋 Aliases']].map(([t, l]) => (
            <button key={t} onClick={() => setSubTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${subTab === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'}`}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={onRefresh} disabled={loading}
          className="px-3 py-1 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
          {loading ? 'Loading...' : '🔄 Refresh'}
        </button>
      </div>

      {error === 'not_configured' ? (
        <div className="py-8 text-center">
          <p className="text-5xl mb-3">🔌</p>
          <p className="font-semibold text-gray-700 dark:text-gray-300">Could not load rules</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Firewall API not reachable or endpoint not available.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            {subTab === 'rules' && (
              <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                {[['all', 'All'], ['pass', '✓ Pass'], ['block', '✕ Block']].map(([v, l]) => (
                  <button key={v} onClick={() => setActionFilter(v)}
                    className={`px-3 py-1 rounded text-xs font-semibold transition ${
                      actionFilter === v
                        ? v === 'pass' ? 'bg-green-600 text-white' : v === 'block' ? 'bg-red-600 text-white' : 'bg-indigo-600 text-white'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                    }`}>{l}</button>
                ))}
              </div>
            )}
            <input type="text" placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 px-3 py-1 rounded-lg text-xs border bg-white dark:bg-gray-800 min-w-[150px] focus:outline-none focus:ring-2 focus:ring-indigo-600" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {subTab === 'rules' ? `${filteredRules.length}/${rules.length}` : `${filteredAliases.length}/${aliases.length}`}
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>
          ) : subTab === 'rules' ? (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-gray-800">
                  <tr className="text-left text-gray-400 uppercase border-b">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Action</th>
                    <th className="py-2 pr-3">Interface</th>
                    <th className="py-2 pr-3">Protocol</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Destination</th>
                    <th className="py-2 pr-3">Description</th>
                    <th className="py-2 pr-3">On</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filteredRules.length === 0 ? (
                    <tr><td colSpan="8" className="py-6 text-center text-gray-500">No rules found.</td></tr>
                  ) : filteredRules.map((r, i) => {
                    const action = r.action || '—'
                    const iface = Array.isArray(r.interface) ? r.interface.join(', ') : (r.interface || r.if || '—')
                    const src = r.source?.network || r.source?.address || r.src || 'any'
                    const dst = r.destination?.network || r.destination?.address || r.dst || 'any'
                    const desc = r.description || r.descr || '—'
                    const enabled = r.enabled === '1' || r.enabled === true || r.enabled === 1
                    return (
                      <tr key={i} className={`hover:bg-gray-50 dark:hover:bg-gray-900/50 ${!enabled ? 'opacity-50' : ''}`}>
                        <td className="py-2 pr-3 font-mono text-gray-500">{r.sequence || i + 1}</td>
                        <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded font-bold ${actionBadge(action)}`}>{action}</span></td>
                        <td className="py-2 pr-3 font-mono">{iface}</td>
                        <td className="py-2 pr-3">{r.protocol || r.proto || 'any'}</td>
                        <td className="py-2 pr-3 font-mono max-w-[120px] truncate">{typeof src === 'object' ? JSON.stringify(src) : src}</td>
                        <td className="py-2 pr-3 font-mono max-w-[120px] truncate">{typeof dst === 'object' ? JSON.stringify(dst) : dst}</td>
                        <td className="py-2 pr-3 max-w-xs truncate" title={desc}>{desc}</td>
                        <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded font-bold text-xs ${enabled ? 'bg-green-100 dark:bg-green-900/30 text-green-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>{enabled ? 'Yes' : 'No'}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-gray-800">
                  <tr className="text-left text-gray-400 uppercase border-b">
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Content</th>
                    <th className="py-2 pr-3">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filteredAliases.length === 0 ? (
                    <tr><td colSpan="4" className="py-6 text-center text-gray-500">No aliases found.</td></tr>
                  ) : filteredAliases.map((a, i) => {
                    const content = a.content || a.address || a.network || ''
                    const contentStr = typeof content === 'object' ? Object.keys(content).join(', ') : String(content)
                    return (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                        <td className="py-2 pr-3 font-mono font-semibold">{a.name || '—'}</td>
                        <td className="py-2 pr-3"><span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold">{a.type || '—'}</span></td>
                        <td className="py-2 pr-3 font-mono max-w-[200px] truncate" title={contentStr}>{contentStr || '—'}</td>
                        <td className="py-2 pr-3">{a.description || a.descr || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ===== VPN Tab Panel =====
function VPNTabPanel({ openvpn, wireguard, loading, onRefresh, subTab, setSubTab }) {
  const ovpnSessions = useMemo(() => {
    if (!openvpn) return []
    if (Array.isArray(openvpn)) return openvpn
    if (Array.isArray(openvpn?.rows)) return openvpn.rows
    if (Array.isArray(openvpn?.data)) return openvpn.data
    return []
  }, [openvpn])

  const wgPeers = useMemo(() => {
    if (!wireguard) return []
    const data = wireguard?.data
    if (!data) return []
    // Handshakes format: { WG_IFACE: { peers: { pubkey: { last_handshake, rx, tx } } } }
    if (wireguard.type === 'handshakes' && typeof data === 'object') {
      const peers = []
      Object.entries(data).forEach(([iface, ifaceData]) => {
        if (typeof ifaceData?.peers === 'object') {
          Object.entries(ifaceData.peers).forEach(([pubkey, peer]) => {
            peers.push({ iface, pubkey, ...peer })
          })
        }
      })
      return peers
    }
    // Client list format
    if (wireguard.type === 'clients') {
      if (Array.isArray(data?.rows)) return data.rows
      if (Array.isArray(data)) return data
    }
    return []
  }, [wireguard])

  const handshakeColor = (ts) => {
    if (!ts || ts === '0001-01-01T00:00:00Z' || ts === '1970-01-01T00:00:00Z') return 'text-gray-400'
    const minutes = (Date.now() - new Date(ts).getTime()) / 60000
    if (minutes < 5) return 'text-green-600 dark:text-green-400'
    if (minutes < 60) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-red-600 dark:text-red-400'
  }

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '—'
    const n = Number(bytes)
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-b-xl rounded-tr-xl shadow p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-2">
          {[['openvpn', '🔐 OpenVPN'], ['wireguard', '⚡ WireGuard']].map(([t, l]) => (
            <button key={t} onClick={() => setSubTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${subTab === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'}`}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={onRefresh} disabled={loading}
          className="px-3 py-1 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
          {loading ? 'Loading...' : '🔄 Refresh'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>
      ) : subTab === 'openvpn' ? (
        openvpn === null ? (
          <div className="py-8 text-center">
            <p className="text-4xl mb-3">🔐</p>
            <p className="font-semibold text-gray-700 dark:text-gray-300">OpenVPN not available</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Plugin not installed or no sessions active.</p>
          </div>
        ) : ovpnSessions.length === 0 ? (
          <div className="py-6 text-center text-gray-500 dark:text-gray-400">No active OpenVPN sessions.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 uppercase border-b">
                  <th className="py-2 pr-4">Client</th>
                  <th className="py-2 pr-4">Real IP</th>
                  <th className="py-2 pr-4">Virtual IP</th>
                  <th className="py-2 pr-4">Connected Since</th>
                  <th className="py-2 pr-4">Bytes In</th>
                  <th className="py-2 pr-4">Bytes Out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {ovpnSessions.map((s, i) => (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                    <td className="py-2 pr-4 font-semibold">{s.common_name || s.username || s.name || '—'}</td>
                    <td className="py-2 pr-4 font-mono">{s.real_address || s.real_ip || s.remote || '—'}</td>
                    <td className="py-2 pr-4 font-mono">{s.virtual_address || s.virtual_ip || s.local || '—'}</td>
                    <td className="py-2 pr-4">{s.connected_since ? new Date(s.connected_since * 1000 || s.connected_since).toLocaleString() : '—'}</td>
                    <td className="py-2 pr-4">{formatBytes(s.bytes_received || s.bytes_recv)}</td>
                    <td className="py-2 pr-4">{formatBytes(s.bytes_sent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        wireguard === null ? (
          <div className="py-8 text-center">
            <p className="text-4xl mb-3">⚡</p>
            <p className="font-semibold text-gray-700 dark:text-gray-300">WireGuard not available</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Plugin not installed or no peers configured.</p>
          </div>
        ) : wgPeers.length === 0 ? (
          <div className="py-6 text-center text-gray-500 dark:text-gray-400">No WireGuard peers found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 uppercase border-b">
                  <th className="py-2 pr-4">Interface</th>
                  <th className="py-2 pr-4">Peer / Name</th>
                  <th className="py-2 pr-4">Endpoint</th>
                  <th className="py-2 pr-4">Last Handshake</th>
                  <th className="py-2 pr-4">RX</th>
                  <th className="py-2 pr-4">TX</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {wgPeers.map((p, i) => {
                  const hs = p.last_handshake || p.latest_handshake || p.last_handshake_time
                  const hsDisplay = hs && hs !== '0001-01-01T00:00:00Z'
                    ? new Date(typeof hs === 'number' ? hs * 1000 : hs).toLocaleString()
                    : 'Never'
                  return (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                      <td className="py-2 pr-4 font-mono">{p.iface || p.interface || '—'}</td>
                      <td className="py-2 pr-4 font-semibold max-w-[150px] truncate" title={p.pubkey || p.name}>
                        {p.name || p.description || (p.pubkey ? p.pubkey.slice(0, 12) + '...' : '—')}
                      </td>
                      <td className="py-2 pr-4 font-mono">{p.endpoint || p.allowed_ips || '—'}</td>
                      <td className={`py-2 pr-4 font-mono ${handshakeColor(hs)}`}>{hsDisplay}</td>
                      <td className="py-2 pr-4">{formatBytes(p.transfer_rx || p.rx_bytes)}</td>
                      <td className="py-2 pr-4">{formatBytes(p.transfer_tx || p.tx_bytes)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

function ConfigHistoryTabPanel({ configHistory, loading, error, onRefresh, onSync, firewallId, configHistoryAPI }) {
  const [selected, setSelected] = useState({ a: null, b: null })
  const [diffModal, setDiffModal] = useState(null)
  const [revertModal, setRevertModal] = useState(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [revertLoading, setRevertLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)

  const handleSync = async () => {
    setSyncLoading(true)
    try {
      await onSync()
    } finally {
      setSyncLoading(false)
    }
  }

  const handleDiff = async () => {
    if (!selected.a || !selected.b) return
    setDiffLoading(true)
    try {
      const res = await configHistoryAPI.diff(firewallId, selected.a, selected.b)
      setDiffModal(res.data)
    } catch (err) {
      alert(`Diff failed: ${err.message}`)
    } finally {
      setDiffLoading(false)
    }
  }

  const handleRevert = async (revisionId) => {
    setRevertModal({ revisionId, step: 'confirm' })
  }

  const confirmRevert = async () => {
    setRevertLoading(true)
    try {
      await configHistoryAPI.revert(firewallId, revertModal.revisionId, true)
      alert('Revert successful! Firewall config has been restored.')
      setRevertModal(null)
      onRefresh()
    } catch (err) {
      alert(`Revert failed: ${err.message}`)
    } finally {
      setRevertLoading(false)
    }
  }

  if (loading) return <div className="p-6 text-center">Loading config history...</div>
  if (error) return <div className="p-6 text-red-600">{error}</div>

  return (
    <div className="bg-white dark:bg-gray-800 rounded-b-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Configuration History</h3>
        <div className="flex gap-2">
          <button
            onClick={handleSync}
            disabled={syncLoading}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {syncLoading ? 'Syncing...' : '🔄 Sync from Firewall'}
          </button>
          <button
            onClick={onRefresh}
            className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {configHistory.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No config revisions found</div>
      ) : (
        <>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-100 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-2 text-left">Select</th>
                  <th className="px-4 py-2 text-left">Revision</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">User</th>
                  <th className="px-4 py-2 text-left">Description</th>
                  <th className="px-4 py-2 text-left">Size</th>
                  <th className="px-4 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {configHistory.map(rev => (
                  <tr key={rev.id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-2">
                      <input
                        type="radio"
                        name="a"
                        checked={selected.a === rev.id}
                        onChange={() => setSelected({ ...selected, a: rev.id })}
                      />
                      {' '}
                      <input
                        type="radio"
                        name="b"
                        checked={selected.b === rev.id}
                        onChange={() => setSelected({ ...selected, b: rev.id })}
                      />
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{rev.revision_id}</td>
                    <td className="px-4 py-2 text-sm">{new Date(rev.revision_date).toLocaleString()}</td>
                    <td className="px-4 py-2">{rev.changed_by || '—'}</td>
                    <td className="px-4 py-2">{rev.summary || '—'}</td>
                    <td className="px-4 py-2 text-right">{rev.size_bytes ? (rev.size_bytes / 1024).toFixed(1) + ' KB' : '—'}</td>
                    <td className="px-4 py-2 text-center">
                      <button
                        onClick={() => handleRevert(rev.id)}
                        className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                      >
                        ↻ Revert
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleDiff}
              disabled={!selected.a || !selected.b || diffLoading}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {diffLoading ? 'Comparing...' : '📊 Compare Selected'}
            </button>
          </div>
        </>
      )}

      {/* Diff Modal */}
      {diffModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-auto">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-auto">
            <div className="sticky top-0 p-4 border-b bg-white dark:bg-gray-800 flex justify-between items-center">
              <h4 className="font-bold">Diff: {diffModal.revision_a} → {diffModal.revision_b}</h4>
              <button onClick={() => setDiffModal(null)} className="text-xl">×</button>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Additions: <span className="text-green-600">+{diffModal.additions}</span> | Deletions: <span className="text-red-600">-{diffModal.deletions}</span>
              </p>
              <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded font-mono text-xs overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
                {diffModal.lines.join('\n')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Revert Confirmation Modal */}
      {revertModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-6 max-w-md">
            <h4 className="font-bold text-lg mb-4">Confirm Revert</h4>
            <p className="text-sm mb-4">
              This will restore the firewall to the selected configuration revision. A backup will be created beforehand as a safety net.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRevertModal(null)}
                className="px-4 py-2 bg-gray-300 dark:bg-gray-600 rounded hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={confirmRevert}
                disabled={revertLoading}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {revertLoading ? 'Reverting...' : 'Confirm Revert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

