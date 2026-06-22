import React from 'react'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 text-white">
      <div className="max-w-4xl mx-auto px-6 py-20">
        <h1 className="text-5xl font-bold mb-4">OPNsense Central Management System</h1>
        <p className="text-xl text-blue-100 mb-8">
          Manage multiple OPNsense firewalls from a single dashboard
        </p>
        
        <div className="bg-white text-gray-900 rounded-lg shadow-lg p-8 mt-12">
          <h2 className="text-2xl font-bold mb-6">Features</h2>
          <ul className="space-y-3">
            <li className="flex items-center"><span className="text-blue-600 mr-3">✓</span> Real-time firewall monitoring</li>
            <li className="flex items-center"><span className="text-blue-600 mr-3">✓</span> Automated firmware updates</li>
            <li className="flex items-center"><span className="text-blue-600 mr-3">✓</span> Backup management & restore</li>
            <li className="flex items-center"><span className="text-blue-600 mr-3">✓</span> License tracking & alerts</li>
            <li className="flex items-center"><span className="text-blue-600 mr-3">✓</span> Disk health monitoring</li>
            <li className="flex items-center"><span className="text-blue-600 mr-3">✓</span> Centralized logging</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
