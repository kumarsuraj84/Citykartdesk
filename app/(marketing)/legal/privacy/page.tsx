import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — CognixDesk',
  description: 'CognixDesk Privacy Policy',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg tracking-tight">CognixDesk</Link>
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Sign in
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 prose prose-sm dark:prose-invert">
        <h1>Privacy Policy</h1>
        <p className="text-muted-foreground text-sm">Last updated: June 2026</p>

        <h2>1. Information We Collect</h2>
        <p>We collect information you provide directly when you:</p>
        <ul>
          <li>Create an account (name, email address, job title)</li>
          <li>Submit service requests or tasks through the platform</li>
          <li>Communicate with us for support or feedback</li>
        </ul>
        <p>We also automatically collect:</p>
        <ul>
          <li>Log data (IP address, browser type, pages visited, timestamps)</li>
          <li>Usage data (features used, actions taken within the Service)</li>
          <li>Device information (operating system, screen resolution)</li>
        </ul>

        <h2>2. How We Use Your Information</h2>
        <p>We use collected information to:</p>
        <ul>
          <li>Provide, maintain, and improve the Service</li>
          <li>Process transactions and send related information</li>
          <li>Send technical notices and support messages</li>
          <li>Respond to your comments and questions</li>
          <li>Monitor and analyze usage patterns to improve user experience</li>
          <li>Comply with legal obligations</li>
        </ul>

        <h2>3. Data Storage and Security</h2>
        <p>
          Your data is stored on secure cloud infrastructure (Supabase / PostgreSQL) with encryption
          at rest and in transit. We implement industry-standard security measures including access
          controls, audit logging, and regular security reviews.
        </p>
        <p>
          No method of transmission over the Internet is 100% secure. While we strive to protect
          your data, we cannot guarantee absolute security.
        </p>

        <h2>4. Data Sharing</h2>
        <p>We do not sell your personal data. We may share your information with:</p>
        <ul>
          <li>
            <strong>Service providers</strong> — third parties that help us operate the Service
            (hosting, email delivery, analytics), bound by confidentiality obligations
          </li>
          <li>
            <strong>Legal requirements</strong> — when required by law, court order, or governmental
            authority
          </li>
          <li>
            <strong>Business transfers</strong> — in connection with a merger, acquisition, or sale
            of assets, subject to standard confidentiality protections
          </li>
        </ul>

        <h2>5. Cookies</h2>
        <p>
          We use essential cookies for authentication and session management. We do not use tracking
          cookies for advertising. You can control cookies through your browser settings, but
          disabling essential cookies may affect Service functionality.
        </p>

        <h2>6. Data Retention</h2>
        <p>
          We retain your data for as long as your account is active or as needed to provide the
          Service. Upon account termination, we will delete or anonymize your data within 90 days,
          unless retention is required by law.
        </p>

        <h2>7. Your Rights</h2>
        <p>Depending on your location, you may have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you</li>
          <li>Correct inaccurate data</li>
          <li>Request deletion of your data</li>
          <li>Object to or restrict certain processing</li>
          <li>Data portability (receive your data in a structured format)</li>
        </ul>
        <p>
          To exercise these rights, contact us at{' '}
          <a href="mailto:privacy@cognixdesk.app">privacy@cognixdesk.app</a>.
        </p>

        <h2>8. Children's Privacy</h2>
        <p>
          The Service is not directed to children under 16. We do not knowingly collect personal
          information from children under 16. If you believe we have inadvertently collected such
          information, contact us immediately.
        </p>

        <h2>9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of material changes
          by posting the new policy on this page and updating the "Last updated" date.
        </p>

        <h2>10. Contact Us</h2>
        <p>
          For privacy-related questions, contact us at{' '}
          <a href="mailto:privacy@cognixdesk.app">privacy@cognixdesk.app</a>.
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
