import React from 'react'
import { Link } from 'react-router-dom'

export default function Navbar() {
  return (
    <nav className="bg-blue-600 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex justify-between items-center">
          <Link to="/" className="text-2xl font-bold">
            OPNsense CMS
          </Link>
          <ul className="flex space-x-6">
            <li><Link to="/" className="hover:text-blue-100">Dashboard</Link></li>
            <li><Link to="/firewalls" className="hover:text-blue-100">Firewalls</Link></li>
            <li><Link to="/backups" className="hover:text-blue-100">Backups</Link></li>
            <li><Link to="/alerts" className="hover:text-blue-100">Alerts</Link></li>
          </ul>
        </div>
      </div>
    </nav>
  )
}
