import React, { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '../contexts/ThemeContext'

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()
  const { isDark, toggleTheme } = useTheme()

  const isActive = (path) => location.pathname === path ? 'text-indigo-300 dark:text-indigo-400 border-b-2 border-indigo-300 dark:border-indigo-400' : 'hover:text-indigo-200 dark:hover:text-indigo-300'

  return (
    <nav className="bg-gradient-to-r from-indigo-700 to-blue-600 dark:from-gray-800 dark:to-gray-900 border-b border-indigo-800 dark:border-gray-700 text-white shadow-lg sticky top-0 z-50 transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex justify-between items-center">
          <Link to="/" className="text-3xl font-black tracking-tight hover:text-indigo-200 dark:hover:text-gray-300 transition">
            🔥 OPNsense CMS
          </Link>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center space-x-8">
            <ul className="flex space-x-8 font-semibold">
              <li><Link to="/" className={`pb-2 transition ${isActive('/')}`}>Home</Link></li>
              <li><Link to="/dashboard" className={`pb-2 transition ${isActive('/dashboard')}`}>Dashboard</Link></li>
              <li><Link to="/firewalls" className={`pb-2 transition ${isActive('/firewalls')}`}>Firewalls</Link></li>
              <li><Link to="/backups" className={`pb-2 transition ${isActive('/backups')}`}>Backups</Link></li>
              <li><Link to="/alerts" className={`pb-2 transition ${isActive('/alerts')}`}>Alerts</Link></li>
              <li><Link to="/email" className={`pb-2 transition ${isActive('/email')}`}>E-Mail</Link></li>
              <li><Link to="/map" className={`pb-2 transition ${isActive('/map')}`}>Karte</Link></li>
              <li><Link to="/settings" className={`pb-2 transition ${isActive('/settings')}`}>Settings</Link></li>
              <li><Link to="/ids" className={`pb-2 transition ${isActive('/ids')}`}>IDS</Link></li>
              <li><Link to="/rules" className={`pb-2 transition ${isActive('/rules')}`}>Rules</Link></li>
            </ul>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-300 hover:bg-white/10 transition-colors"
              aria-label="Toggle dark mode"
            >
              {isDark ? (
                <svg className="w-5 h-5 text-yellow-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              ) : (
                <svg className="w-5 h-5 text-indigo-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              )}
            </button>
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center space-x-4">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full hover:bg-white/10 focus:outline-none"
            >
              {isDark ? (
                <svg className="w-5 h-5 text-yellow-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              ) : (
                <svg className="w-5 h-5 text-indigo-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              )}
            </button>
            <button
              className="focus:outline-none hover:bg-white/10 p-2 rounded"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <ul className="md:hidden mt-4 space-y-3 pb-4 font-semibold">
            <li><Link to="/" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>Home</Link></li>
            <li><Link to="/dashboard" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>Dashboard</Link></li>
            <li><Link to="/firewalls" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>Firewalls</Link></li>
            <li><Link to="/backups" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>Backups</Link></li>
            <li><Link to="/alerts" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>Alerts</Link></li>
            <li><Link to="/email" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>E-Mail</Link></li>
            <li><Link to="/map" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>Karte</Link></li>
            <li><Link to="/settings" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>Settings</Link></li>
            <li><Link to="/ids" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>IDS</Link></li>
            <li><Link to="/rules" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>Rules</Link></li>
          </ul>
        )}
      </div>
    </nav>
  )
}
