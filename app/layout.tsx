import type { Metadata } from 'next'
import { Manrope, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import { SpeedInsights } from '@vercel/speed-insights/next'
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
    template: '%s — CognixDesk',
    default: 'CognixDesk',
  },
  description: 'Modern service management platform',
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
            __html: `(function(){try{var v=localStorage.getItem('cognix-theme')||'light';var r=document.documentElement;r.setAttribute('data-theme',v);r.classList.toggle('dark',v==='dark');}catch(e){}})()`,
          }}
        />
      </head>
      <body className="h-full">
        {children}
        <Toaster richColors position="bottom-right" />
        <SpeedInsights />
      </body>
    </html>
  )
}
