// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

// The way back in for a person who forgot the password: a visible link on the sign-in page, a reset page that only asks for the e-mail, and nothing changed until the
// e-mailed one-time link is opened.
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/components/layout/BrandLogo', () => ({ BrandLogo: () => <div /> }))
const signIn = vi.fn()
const forgot = vi.fn()
vi.mock('@/lib/actions/auth', () => ({ signInWithPassword: (...a: unknown[]) => signIn(...a), forgotPassword: (...a: unknown[]) => forgot(...a) }))

import LoginPage from '@/app/(auth)/login/page'
import ForgotPasswordPage from '@/app/(auth)/forgot-password/page'

beforeEach(() => { signIn.mockReset(); forgot.mockReset(); window.sessionStorage.clear() })
afterEach(() => cleanup())

describe('sign-in page: the way to a reset is visible', () => {
  it('shows "Forgot your password?" under the password box, linking to the reset page', () => {
    render(<LoginPage />)
    const link = screen.getByRole('link', { name: 'Forgot your password?' }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/forgot-password')
  })

  it('the typed address is handed over in session storage, never in the web address', () => {
    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sm.abc@citykartstores.com' } })
    fireEvent.click(screen.getByRole('link', { name: 'Forgot your password?' }))
    expect(window.sessionStorage.getItem('ckdesk.reset-email')).toBe('sm.abc@citykartstores.com')
    expect((screen.getByRole('link', { name: 'Forgot your password?' }) as HTMLAnchorElement).getAttribute('href')).not.toMatch(/@/)
  })

  it('after a wrong password the error also offers the reset by e-mail', async () => {
    signIn.mockResolvedValue({ error: 'Invalid email or password.' })
    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } })
    fireEvent.change(document.getElementById('password') as HTMLInputElement, { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Invalid email or password.')
    expect(alert.textContent).toContain('Forgot your password? Get a reset link by e-mail.')
  })
})

describe('reset page: it only e-mails a link', () => {
  it('says plainly that nothing is changed here and that the link goes to the mailbox', () => {
    render(<ForgotPasswordPage />)
    expect(screen.getByText(/Nothing is changed here/)).toBeTruthy()
    expect(screen.getByText(/one-time reset link to that mailbox/)).toBeTruthy()
  })

  it('fills in the address typed on the sign-in page, once', async () => {
    window.sessionStorage.setItem('ckdesk.reset-email', 'sm.abc@citykartstores.com')
    render(<ForgotPasswordPage />)
    await waitFor(() => expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('sm.abc@citykartstores.com'))
    expect(window.sessionStorage.getItem('ckdesk.reset-email')).toBeNull()
  })

  it('after sending: asks to open the link from the e-mail, and tells what to do when no mail comes', async () => {
    forgot.mockResolvedValue({ success: true })
    render(<ForgotPasswordPage />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'sm.abc@citykartstores.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Send reset link/ }))
    await screen.findByText('Check your email')
    expect(forgot).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/does not change until you open that link/)).toBeTruthy()
    expect(screen.getByText(/spam folder/)).toBeTruthy()
  })
})
