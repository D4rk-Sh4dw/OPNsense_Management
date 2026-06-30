import React from 'react'
import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 via-blue-500 to-cyan-500 dark:from-gray-900 dark:via-gray-800 dark:to-indigo-900 transition-colors duration-200">
      <div className="w-full px-6 py-24">
        <div className="text-center text-white mb-16">
          <h1 className="text-6xl font-black mb-4 drop-shadow-lg">OPNsense Central Management</h1>
          <p className="text-2xl text-blue-100 dark:text-gray-300 drop-shadow-md">
            Enterprise Firewall Management Platform
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {[
            { icon: '📊', title: 'Real-time Monitoring', desc: 'Live health checks, CPU, RAM, uptime' },
            { icon: '🔄', title: 'Firmware Updates', desc: 'Automatic or manual update scheduling' },
            { icon: '💾', title: 'Backup Management', desc: 'Automated backups with retention policy' },
            { icon: '📋', title: 'License Tracking', desc: 'Expiry alerts and notifications' },
            { icon: '🖥️', title: 'S.M.A.R.T. Monitoring', desc: 'Disk health and failure detection' },
            { icon: '🚨', title: 'Alert System', desc: 'Centralized logging and alarms' },
          ].map((feature, i) => (
            <div key={i} className="bg-white dark:bg-gray-800 bg-opacity-95 dark:bg-opacity-95 rounded-lg shadow-lg p-6 hover:shadow-xl transition border border-transparent dark:border-gray-700">
              <div className="text-4xl mb-3">{feature.icon}</div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{feature.title}</h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm mt-2">{feature.desc}</p>
            </div>
          ))}
        </div>

        {/* CTA Buttons */}
        <div className="flex gap-4 justify-center">
          <Link to="/dashboard" className="bg-white dark:bg-indigo-600 text-indigo-600 dark:text-white font-bold px-8 py-4 rounded-lg shadow-lg hover:shadow-xl hover:bg-gray-100 dark:hover:bg-indigo-500 transition">
            Go to Dashboard →
          </Link>
          <Link to="/firewalls" className="bg-indigo-800 dark:bg-gray-700 text-white font-bold px-8 py-4 rounded-lg shadow-lg hover:bg-indigo-700 dark:hover:bg-gray-600 transition">
            Manage Firewalls →
          </Link>
        </div>

        {/* Info Section */}
        <div className="mt-16 bg-white dark:bg-gray-900 bg-opacity-10 dark:bg-opacity-40 backdrop-blur-md text-white rounded-lg p-8 border border-white border-opacity-20 dark:border-gray-700">
          <h2 className="text-2xl font-bold mb-4">Getting Started</h2>
          <ul className="space-y-2 text-lg text-indigo-50 dark:text-gray-300">
            <li>✓ Add OPNsense firewalls via Dashboard</li>
            <li>✓ Configure automatic health monitoring</li>
            <li>✓ Set up email alerts for important events</li>
            <li>✓ Schedule automatic backups and updates</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
