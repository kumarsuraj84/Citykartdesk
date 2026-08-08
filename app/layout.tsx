import type { Metadata } from 'next'
import { Manrope, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import './globals.css'

const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['latin'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    template: '%s — Citykart Desk',
    default: 'Citykart Desk',
  },
  description: 'Modern service management platform',
  icons: {
    icon: '/citykart-desk-icon.png',
    shortcut: '/citykart-desk-icon.png',
    apple: '/citykart-desk-icon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${manrope.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {/* No-flash theme init: apply the saved theme before first paint.
            Sets data-theme for the light variants and toggles .dark for Synthwave. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var v=localStorage.getItem('citykart-theme')||'light';var r=document.documentElement;r.setAttribute('data-theme',v);r.classList.toggle('dark',v==='dark');}catch(e){}})()`,
          }}
        />
      </head>
      <body className="h-full">
        <ErrorBoundary>{children}</ErrorBoundary>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  )
}
