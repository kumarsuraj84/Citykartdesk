'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Menu, X, Zap } from 'lucide-react'

function MarketingNav() {
  const [open, setOpen] = useState(false)

  return (
    <nav className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[oklch(0.38_0.13_255)] flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold text-gray-900 tracking-tight">CognixDesk</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <Link href="/#features" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Features</Link>
          <Link href="/#modules" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Modules</Link>
          <Link href="/#how-it-works" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">How it works</Link>
          <Link href="/#pricing" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Pricing</Link>
          <Link href="/demo" className="text-sm font-medium text-[oklch(0.38_0.13_255)] hover:text-[oklch(0.32_0.13_255)] transition-colors">Live Demo →</Link>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 px-4 py-2 rounded-lg transition-colors">Sign in</Link>
          <Link href="/signup" className="text-sm font-semibold text-white bg-[oklch(0.38_0.13_255)] hover:bg-[oklch(0.32_0.13_255)] px-4 py-2 rounded-lg transition-colors">Get started free</Link>
        </div>

        <button className="md:hidden p-2" onClick={() => setOpen(!open)}>
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden bg-white border-t border-gray-100 px-6 py-4 flex flex-col gap-4">
          <Link href="/#features" className="text-sm font-medium text-gray-700" onClick={() => setOpen(false)}>Features</Link>
          <Link href="/#modules" className="text-sm font-medium text-gray-700" onClick={() => setOpen(false)}>Modules</Link>
          <Link href="/#how-it-works" className="text-sm font-medium text-gray-700" onClick={() => setOpen(false)}>How it works</Link>
          <Link href="/#pricing" className="text-sm font-medium text-gray-700" onClick={() => setOpen(false)}>Pricing</Link>
          <Link href="/demo" className="text-sm font-medium text-[oklch(0.38_0.13_255)]" onClick={() => setOpen(false)}>Live Demo →</Link>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Link href="/login" className="flex-1 text-center text-sm font-medium text-gray-700 border border-gray-200 px-4 py-2 rounded-lg">Sign in</Link>
            <Link href="/signup" className="flex-1 text-center text-sm font-semibold text-white bg-[oklch(0.38_0.13_255)] px-4 py-2 rounded-lg">Get started</Link>
          </div>
        </div>
      )}
    </nav>
  )
}

function MarketingFooter() {
  return (
    <footer className="bg-gray-950 text-gray-400">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          <div className="col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-[oklch(0.38_0.13_255)] flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-bold text-white">CognixDesk</span>
            </div>
            <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
              Enterprise service management platform built for modern Indian organisations. ITIL-aligned, multi-tenant, production-ready.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">Product</h4>
            <ul className="space-y-3 text-sm">
              <li><Link href="/#features" className="hover:text-white transition-colors">Features</Link></li>
              <li><Link href="/#modules" className="hover:text-white transition-colors">Modules</Link></li>
              <li><Link href="/#pricing" className="hover:text-white transition-colors">Pricing</Link></li>
              <li><Link href="/demo" className="hover:text-white transition-colors">Live Demo</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">Company</h4>
            <ul className="space-y-3 text-sm">
              <li><Link href="#" className="hover:text-white transition-colors">About</Link></li>
              <li><Link href="#" className="hover:text-white transition-colors">Contact</Link></li>
              <li><Link href="#" className="hover:text-white transition-colors">Blog</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">Legal</h4>
            <ul className="space-y-3 text-sm">
              <li><Link href="/legal/privacy" className="hover:text-white transition-colors">Privacy Policy</Link></li>
              <li><Link href="/legal/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-gray-600">© 2025 CognixDesk. All rights reserved. Made in India 🇮🇳</p>
          <p className="text-xs text-gray-600">Built for enterprises. Trusted by teams across India.</p>
        </div>
      </div>
    </footer>
  )
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  )
}
