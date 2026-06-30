import React, { useState, useEffect, useMemo } from 'react'
import { firewallsAPI, rulesAPI } from '../api/client'

export default function FirewallRules() {
  const [firewalls, setFirewalls] = useState([])
  const [selected, setSelected] = useState(null)
  const [firewallSearch, setFirewallSearch] = useState('')
  const [tab, setTab] = useState('rules') // 'rules' | 'aliases'
  const [rules, setRules] = useState([])
  const [aliases, setAliases] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [ifaceFilter, setIfaceFilter] = useState('all')

  useEffect(() => {
    firewallsAPI.list().then(r => {
      const list = r.data || r
      setFirewalls(list)
      if (list.length > 0) setSelected(list[0].id)
    })
  }, [])

  useEffect(() => {
    if (selected) loadData()
  }, [selected, tab])

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      if (tab === 'rules') {
        const res = await rulesAPI.getRules(selected)
        const data = res.data
        let rows = []
        if (Array.isArray(data)) rows = data
        else if (Array.isArray(data?.rows)) rows = data.rows
        else if (Array.isArray(data?.data)) rows = data.data
        else if (data && typeof data === 'object') rows = Object.values(data).filter(Array.isArray).flat()
        setRules(rows)
      } else {
        const res = await rulesAPI.getAliases(selected)
        const data = res.data
        let rows = []
        if (Array.isArray(data)) rows = data
        else if (Array.isArray(data?.rows)) rows = data.rows
        else if (Array.isArray(data?.data)) rows = data.data
        setAliases(rows)
      }
    } catch (e) {
      const status = e.response?.status
      if (status === 404 || status === 502) setError('firewall_unavailable')
      else setError(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  const interfaces = useMemo(() => {
    const set = new Set()
    rules.forEach(r => {
      const iface = r.interface || r.interfaces || r.if
      if (iface) {
        if (Array.isArray(iface)) iface.forEach(i => set.add(i))
        else set.add(iface)
      }
    })
    return Array.from(set).sort()
  }, [rules])

  const filteredRules = useMemo(() => {
    return rules.filter(r => {
      const action = String(r.action || '').toLowerCase()
      if (actionFilter === 'pass' && !(action === 'pass' || action === 'allow')) return false
      if (actionFilter === 'block' && !(action === 'block' || action === 'reject' || action === 'drop')) return false
      const iface = r.interface || r.interfaces || r.if || ''
      const ifaceStr = Array.isArray(iface) ? iface.join(',') : String(iface)
      if (ifaceFilter !== 'all' && !ifaceStr.includes(ifaceFilter)) return false
      if (search) {
        const needle = search.toLowerCase()
        const hay = [r.description, r.descr, r.source?.network, r.destination?.network,
          r.protocol, r.interface, r.action, r.enabled
        ].filter(Boolean).map(String).join(' ').toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [rules, actionFilter, ifaceFilter, search])

  const filteredAliases = useMemo(() => {
    if (!search) return aliases
    const needle = search.toLowerCase()
    return aliases.filter(a => {
      const hay = [a.name, a.type, a.description, a.content, a.address]
        .filter(Boolean).map(String).join(' ').toLowerCase()
      return hay.includes(needle)
    })
  }, [aliases, search])

  const actionBadge = (action) => {
    const a = String(action || '').toLowerCase()
    if (a === 'pass' || a === 'allow') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
    if (a === 'block' || a === 'reject' || a === 'drop') return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
    return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }

  const filteredFirewallOptions = firewalls.filter(fw => {
    if (fw.id === selected) return true
    const q = firewallSearch.trim().toLowerCase()
    if (!q) return true
    return [fw.customer_name, fw.hostname, fw.ip].filter(Boolean).join(' ').toLowerCase().includes(q)
  })

  return (
    <div className="p-8 w-full">
      <div className="mb-8">
        <h1 className="text-4xl font-black text-gray-900 dark:text-gray-100">Firewall Rules</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Read-only view of filter rules and aliases from OPNsense</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <input
          type="text"
          value={firewallSearch}
          onChange={e => setFirewallSearch(e.target.value)}
          placeholder="Search firewall..."
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600"
        />
        <select
          value={selected || ''}
          onChange={e => { setSelected(e.target.value); setFirewallSearch('') }}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600"
        >
          {filteredFirewallOptions.map(fw => (
            <option key={fw.id} value={fw.id}>{fw.customer_name} – {fw.ip}</option>
          ))}
        </select>
        <button onClick={loadData} disabled={loading}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50">
          {loading ? 'Loading...' : '🔄 Refresh'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {[['rules', '🛡 Rules'], ['aliases', '📋 Aliases']].map(([t, l]) => (
          <button key={t} onClick={() => { setTab(t); setSearch(''); setActionFilter('all'); setIfaceFilter('all') }}
            className={`px-4 py-2 rounded-lg font-semibold text-sm transition ${tab === t ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 shadow'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {tab === 'rules' && (
          <>
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              {[['all', 'All'], ['pass', '✓ Pass'], ['block', '✕ Block']].map(([v, l]) => (
                <button key={v} onClick={() => setActionFilter(v)}
                  className={`px-3 py-1 rounded text-xs font-semibold transition ${
                    actionFilter === v
                      ? v === 'pass' ? 'bg-green-600 text-white'
                      : v === 'block' ? 'bg-red-600 text-white'
                      : 'bg-indigo-600 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:bg-gray-600'
                  }`}>{l}</button>
              ))}
            </div>
            {interfaces.length > 0 && (
              <select value={ifaceFilter} onChange={e => setIfaceFilter(e.target.value)}
                className="px-3 py-1 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-700 border-0">
                <option value="all">All interfaces</option>
                {interfaces.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            )}
          </>
        )}
        <input
          type="text"
          placeholder={tab === 'rules' ? 'Search description, source, destination...' : 'Search name, type, content...'}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-1 rounded-lg text-xs border bg-white dark:bg-gray-800 flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-indigo-600"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {tab === 'rules' ? `${filteredRules.length}/${rules.length}` : `${filteredAliases.length}/${aliases.length}`}
        </span>
      </div>

      {/* Error state */}
      {error === 'firewall_unavailable' ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-12 text-center">
          <div className="text-5xl mb-4">🔌</div>
          <p className="text-gray-700 dark:text-gray-300 font-semibold">Firewall not reachable</p>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">Could not connect to the OPNsense API. Check connectivity and API credentials.</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 rounded-xl p-6 text-red-700 dark:text-red-300">{error}</div>
      ) : loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
        </div>
      ) : tab === 'rules' ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          {filteredRules.length === 0 ? (
            <div className="p-12 text-center text-gray-500 dark:text-gray-400">No rules found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold">Interface</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold">Protocol</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold">Destination</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold">Enabled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredRules.map((r, i) => {
                    const seq = r.sequence || r.sequence_number || i + 1
                    const action = r.action || '—'
                    const iface = Array.isArray(r.interface) ? r.interface.join(', ') : (r.interface || r.interfaces || r.if || '—')
                    const proto = r.protocol || r.proto || 'any'
                    const src = r.source?.network || r.source?.address || r.source || r.src || 'any'
                    const dst = r.destination?.network || r.destination?.address || r.destination || r.dst || 'any'
                    const desc = r.description || r.descr || '—'
                    const enabled = r.enabled === '1' || r.enabled === true || r.enabled === 1
                    return (
                      <tr key={i} className={`hover:bg-gray-50 dark:hover:bg-gray-900/50 ${!enabled ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3 text-xs font-mono text-gray-500 dark:text-gray-400">{seq}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${actionBadge(action)}`}>
                            {action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono">{iface}</td>
                        <td className="px-4 py-3 text-xs">{proto}</td>
                        <td className="px-4 py-3 text-xs font-mono max-w-[140px] truncate" title={JSON.stringify(src)}>{typeof src === 'object' ? JSON.stringify(src) : src}</td>
                        <td className="px-4 py-3 text-xs font-mono max-w-[140px] truncate" title={JSON.stringify(dst)}>{typeof dst === 'object' ? JSON.stringify(dst) : dst}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300 max-w-xs truncate" title={desc}>{desc}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className={`px-2 py-0.5 rounded font-bold ${enabled ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                            {enabled ? 'Yes' : 'No'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Aliases Tab */
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          {filteredAliases.length === 0 ? (
            <div className="p-12 text-center text-gray-500 dark:text-gray-400">No aliases found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold">Content</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold">Enabled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredAliases.map((a, i) => {
                    const content = a.content || a.address || a.network || ''
                    const contentStr = typeof content === 'object' ? Object.keys(content).join(', ') : String(content)
                    const enabled = a.enabled === '1' || a.enabled === true || a.enabled === 1
                    return (
                      <tr key={i} className={`hover:bg-gray-50 dark:hover:bg-gray-900/50 ${!enabled ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">{a.name || '—'}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 font-semibold">
                            {a.type || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-gray-600 dark:text-gray-400 max-w-xs truncate" title={contentStr}>
                          {contentStr || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300">{a.description || a.descr || '—'}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className={`px-2 py-0.5 rounded font-bold ${enabled ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                            {enabled ? 'Yes' : 'No'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
