import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { firewallsAPI } from '../api/client'

// ── Fix Leaflet default icon path broken by bundlers ──────────────────────────
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const makeIcon = (color, updateCount = 0) => L.divIcon({
  className: '',
  iconSize: [36, 36],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
  html: `
    <div style="position:relative;width:36px;height:36px;">
      <div style="position:absolute;left:0;bottom:0;width:28px;height:28px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>
      ${updateCount > 0 ? `<div style="position:absolute;right:0;top:0;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#ef4444;color:white;font-size:10px;font-weight:700;line-height:16px;text-align:center;border:1px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35);">${updateCount > 9 ? '9+' : updateCount}</div>` : ''}
    </div>
  `,
})

function colorForFirewall(fw) {
  if (!fw.online && fw.online !== null) return '#ef4444'
  if (fw.alerts?.some(a => a.severity === 'critical')) return '#ef4444'
  if (fw.alerts?.some(a => a.severity === 'warning')) return '#f59e0b'
  if (fw.online === true) return '#22c55e'
  return '#9ca3af'
}

function iconForFirewall(fw) {
  const color = colorForFirewall(fw)
  const updateCount = Math.max(0, Number(fw.updates_available) || 0)
  return makeIcon(color, updateCount)
}

function AutoFit({ markers }) {
  const map = useMap()
  useEffect(() => {
    if (!markers.length) return
    const coords = markers.filter(m => m.location_lat && m.location_lon)
    if (!coords.length) return
    const bounds = L.latLngBounds(coords.map(m => [m.location_lat, m.location_lon]))
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 })
  }, [markers, map])
  return null
}

export default function GeoMap() {
  const [firewalls, setFirewalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState(null)
  const [addressInput, setAddressInput] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeError, setGeocodeError] = useState(null)
  const [toast, setToast] = useState(null)

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const loadMap = useCallback(async () => {
    try {
      const res = await firewallsAPI.getMapData()
      setFirewalls(res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadMap() }, [loadMap])

  const handleGeocode = async (fw) => {
    if (!addressInput.trim()) return
    setGeocoding(true)
    setGeocodeError(null)
    try {
      await firewallsAPI.geocode(fw.id, addressInput.trim())
      showToast(`Standort gespeichert: ${addressInput}`)
      setEditId(null)
      setAddressInput('')
      await loadMap()
    } catch (e) {
      setGeocodeError(e?.response?.data?.detail || 'Geocoding fehlgeschlagen')
    } finally {
      setGeocoding(false)
    }
  }

  const mapped = firewalls.filter(fw => fw.location_lat && fw.location_lon)
  const unmapped = firewalls.filter(fw => !fw.location_lat || !fw.location_lon)

  return (
    <div className="p-6 w-full">
      {toast && (
        <div className={`fixed top-20 right-6 z-[9999] px-5 py-3 rounded-lg shadow-lg text-white font-semibold ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-gray-100">Firewall Karte</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {mapped.length} von {firewalls.length} Firewalls mit Standort
          </p>
        </div>
        <div className="flex gap-2 flex-wrap text-xs font-bold">
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700">
            <span className="inline-block w-3 h-3 rounded-full bg-green-500"></span> Online / OK
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700">
            <span className="inline-block w-3 h-3 rounded-full bg-yellow-400"></span> Warnung
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700">
            <span className="inline-block w-3 h-3 rounded-full bg-red-500"></span> Kritisch / Offline
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700">
            <span className="inline-block w-3 h-3 rounded-full bg-gray-400"></span> Unbekannt
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold">1</span> Update verfugbar (Badge am Marker)
          </span>
        </div>
      </div>

      {/* MAP */}
      {loading ? (
        <div className="flex items-center justify-center h-96 bg-gray-100 dark:bg-gray-800 rounded-xl">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden shadow-lg border border-gray-200 dark:border-gray-700 mb-8" style={{ height: '520px' }}>
          <MapContainer
            center={mapped.length ? [mapped[0].location_lat, mapped[0].location_lon] : [51.1657, 10.4515]}
            zoom={mapped.length ? 6 : 6}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <AutoFit markers={mapped} />
            {mapped.map(fw => (
              <Marker
                key={fw.id}
                position={[fw.location_lat, fw.location_lon]}
                icon={iconForFirewall(fw)}
              >
                <Popup minWidth={280}>
                  <div className="text-sm" style={{lineHeight:'1.5'}}>
                    {/* Header */}
                    <div className="font-bold text-base mb-0.5">{fw.customer_name}</div>
                    <div className="text-gray-500 text-xs mb-2">{fw.hostname} &bull; {fw.ip}</div>
                    {fw.location_address && <div className="text-gray-400 text-xs mb-2">📍 {fw.location_address}</div>}

                    {/* Status row */}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {fw.online === true && (
                        <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">🟢 Online</span>
                      )}
                      {fw.online === false && (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold">🔴 Offline</span>
                      )}
                      {fw.online === null && (
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold">⚪ Unbekannt</span>
                      )}
                      {fw.updates_available > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-semibold">⬆ {fw.updates_available} Update{fw.updates_available > 1 ? 's' : ''}</span>
                      )}
                      {fw.updates_available === 0 && fw.online && (
                        <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-600 text-xs">✓ Aktuell</span>
                      )}
                    </div>

                    {/* Metrics */}
                    <table style={{fontSize:'11px',width:'100%',borderCollapse:'collapse'}}>
                      <tbody>
                        {fw.firmware_version && (
                          <tr><td style={{color:'#6b7280',paddingRight:'8px'}}>Firmware</td><td style={{fontFamily:'monospace'}}>{fw.firmware_version}</td></tr>
                        )}
                        {fw.cpu_usage != null && (
                          <tr><td style={{color:'#6b7280',paddingRight:'8px'}}>CPU</td><td>{fw.cpu_usage.toFixed(1)} %</td></tr>
                        )}
                        {fw.ram_usage != null && (
                          <tr><td style={{color:'#6b7280',paddingRight:'8px'}}>RAM</td><td>{fw.ram_usage.toFixed(1)} %</td></tr>
                        )}
                        {fw.license_type && (
                          <tr><td style={{color:'#6b7280',paddingRight:'8px'}}>Lizenz</td><td style={{textTransform:'capitalize'}}>{fw.license_type}</td></tr>
                        )}
                        {fw.license_expiry && (
                          <tr><td style={{color:'#6b7280',paddingRight:'8px'}}>Ablauf</td><td>{new Date(fw.license_expiry).toLocaleDateString('de-DE')}</td></tr>
                        )}
                        {fw.last_backup && (
                          <tr><td style={{color:'#6b7280',paddingRight:'8px'}}>Backup</td><td>{new Date(fw.last_backup).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td></tr>
                        )}
                        {!fw.last_backup && (
                          <tr><td style={{color:'#6b7280',paddingRight:'8px'}}>Backup</td><td style={{color:'#ef4444'}}>Kein Backup</td></tr>
                        )}
                        {fw.checked_at && (
                          <tr><td style={{color:'#6b7280',paddingRight:'8px'}}>Geprüft</td><td>{new Date(fw.checked_at).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td></tr>
                        )}
                      </tbody>
                    </table>

                    {/* Alerts */}
                    {fw.alerts?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div style={{fontSize:'10px',color:'#6b7280',textTransform:'uppercase',fontWeight:'600',marginBottom:'2px'}}>Offene Alerts</div>
                        {fw.alerts.map(a => (
                          <div key={a.id} style={{
                            fontSize:'11px',padding:'3px 6px',borderRadius:'4px',
                            background: a.severity === 'critical' ? '#fef2f2' : a.severity === 'warning' ? '#fffbeb' : '#eff6ff',
                            color: a.severity === 'critical' ? '#b91c1c' : a.severity === 'warning' ? '#92400e' : '#1e40af',
                          }}>
                            <strong>{a.severity.toUpperCase()}:</strong> {a.message}
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{marginTop:'8px',borderTop:'1px solid #e5e7eb',paddingTop:'6px',display:'flex',gap:'12px',alignItems:'center'}}>
                      <Link to={`/firewalls/${fw.id}`} className="text-indigo-600 text-xs font-semibold hover:underline">
                        → Details öffnen
                      </Link>
                      <a
                        href={`https://${fw.ip}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{color:'#6b7280',fontSize:'11px',fontWeight:'600'}}
                      >
                        🌐 WebGUI
                      </a>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}

      {/* FIREWALL LIST WITH ADDRESS ASSIGNMENT */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Standorte verwalten</h2>
        <div className="space-y-3">
          {firewalls.map(fw => (
            <div key={fw.id} className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 min-w-[160px] flex-1">
                <span className={`w-3 h-3 rounded-full shrink-0 ${
                  fw.online === true && !fw.alerts?.length ? 'bg-green-500'
                  : fw.online === false ? 'bg-red-500'
                  : fw.alerts?.some(a => a.severity === 'critical') ? 'bg-red-500'
                  : fw.alerts?.length ? 'bg-yellow-400'
                  : 'bg-gray-400'
                }`}></span>
                <div>
                  <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">{fw.customer_name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{fw.hostname}</p>
                </div>
              </div>

              {editId === fw.id ? (
                <div className="flex flex-1 flex-wrap gap-2 items-center">
                  <input
                    autoFocus
                    value={addressInput}
                    onChange={e => setAddressInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleGeocode(fw)}
                    placeholder="Adresse eingeben, z.B. Musterstraße 1, 12345 Berlin"
                    className="flex-1 min-w-[240px] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                  <button onClick={() => handleGeocode(fw)} disabled={geocoding}
                    className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 font-semibold">
                    {geocoding ? 'Suche...' : 'Speichern'}
                  </button>
                  <button onClick={() => { setEditId(null); setAddressInput(''); setGeocodeError(null) }}
                    className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition">
                    Abbrechen
                  </button>
                  {geocodeError && <p className="w-full text-xs text-red-600">{geocodeError}</p>}
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-1">
                  <span className="text-sm text-gray-600 dark:text-gray-400 flex-1 italic">
                    {fw.location_address || 'Kein Standort'}
                  </span>
                  <button
                    onClick={() => { setEditId(fw.id); setAddressInput(fw.location_address || ''); setGeocodeError(null) }}
                    className="px-3 py-1.5 text-xs bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition font-semibold"
                  >
                    {fw.location_address ? '✎ Ändern' : '+ Standort'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
