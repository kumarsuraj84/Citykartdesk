import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service — CognixDesk',
  description: 'CognixDesk Terms of Service',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg tracking-tight">CognixDesk</Link>
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Sign in
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 prose prose-sm dark:prose-invert">
        <h1>Terms of Service</h1>
        <p className="text-muted-foreground text-sm">Last updated: June 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using CognixDesk ("Service"), you agree to be bound by these Terms of Service
          ("Terms"). If you do not agree to these Terms, do not use the Service.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          CognixDesk is a cloud-based service management platform that enables organizations to manage
          requests, tasks, approvals, and workflows. The Service is offered on a subscription basis
          with modular licensing.
        </p>

        <h2>3. Account Registration</h2>
        <p>
          You must provide accurate, complete, and current information when creating an account.
          You are responsible for maintaining the confidentiality of your credentials and for all
          activities under your account.
        </p>

        <h2>4. Subscription and Payment</h2>
        <p>
          Access to the Service requires an active subscription. Subscription fees are billed in
          advance on a monthly or annual basis. All fees are non-refundable except as required by
          applicable law.
        </p>
        <p>
          Trial subscriptions are provided at no charge for the period specified at sign-up. We
          reserve the right to terminate trial access at any time.
        </p>

        <h2>5. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for any unlawful purpose or in violation of any regulations</li>
          <li>Attempt to gain unauthorized access to the Service or its related systems</li>
          <li>Transmit viruses, malware, or other harmful code</li>
          <li>Reverse engineer, decompile, or disassemble the Service</li>
          <li>Resell or sublicense access to the Service without our prior written consent</li>
        </ul>

        <h2>6. Data and Privacy</h2>
        <p>
          Your use of the Service is also governed by our{' '}
          <Link href="/legal/privacy" className="underline">Privacy Policy</Link>, which is
          incorporated herein by reference.
        </p>

        <h2>7. Intellectual Property</h2>
        <p>
          The Service and all content, features, and functionality are owned by CognixDesk and are
          protected by applicable intellectual property laws. You retain ownership of all data you
          submit to the Service.
        </p>

        <h2>8. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, CognixDesk shall not be liable for any indirect,
          incidental, special, consequential, or punitive damages arising from your use of the
          Service, even if we have been advised of the possibility of such damages.
        </p>

        <h2>9. Termination</h2>
        <p>
          We may suspend or terminate your access to the Service at any time for violation of these
          Terms or for any other reason with or without notice. Upon termination, your right to use
          the Service immediately ceases.
        </p>

        <h2>10. Changes to Terms</h2>
        <p>
          We reserve the right to modify these Terms at any time. We will notify you of material
          changes by posting the new Terms on this page and updating the "Last updated" date.
          Continued use after changes constitutes acceptance.
        </p>

        <h2>11. Contact</h2>
        <p>
          Questions about these Terms? Contact us at{' '}
          <a href="mailto:legal@cognixdesk.app">legal@cognixdesk.app</a>.
        </p>
      </main>

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-4">
          <Link href="/legal/terms" className="hover:text-foreground transition-colors">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          <span>© 2026 CognixDesk. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}
