import React, { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  const isActive = (path) => location.pathname === path ? 'text-indigo-300 border-b-2 border-indigo-300' : 'hover:text-indigo-200'

  return (
    <nav className="bg-gradient-to-r from-indigo-700 to-blue-600 text-white shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex justify-between items-center">
          <Link to="/" className="text-3xl font-black tracking-tight hover:text-indigo-200 transition">
            🔥 OPNsense CMS
          </Link>

          {/* Desktop Menu */}
          <ul className="hidden md:flex space-x-8 font-semibold">
            <li><Link to="/" className={`pb-2 transition ${isActive('/')}`}>Home</Link></li>
            <li><Link to="/dashboard" className={`pb-2 transition ${isActive('/dashboard')}`}>Dashboard</Link></li>
            <li><Link to="/firewalls" className={`pb-2 transition ${isActive('/firewalls')}`}>Firewalls</Link></li>
            <li><Link to="/alerts" className={`pb-2 transition ${isActive('/alerts')}`}>Alerts</Link></li>
          </ul>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <ul className="md:hidden mt-4 space-y-3 pb-4 font-semibold">
            <li><Link to="/" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>Home</Link></li>
            <li><Link to="/dashboard" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>Dashboard</Link></li>
            <li><Link to="/firewalls" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>Firewalls</Link></li>
            <li><Link to="/alerts" className="block pb-2" onClick={() => setMobileMenuOpen(false)}>Alerts</Link></li>
          </ul>
        )}
      </div>
    </nav>
  )
}
