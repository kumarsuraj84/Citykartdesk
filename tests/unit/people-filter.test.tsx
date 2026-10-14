// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/dashboards', useSearchParams: () => new URLSearchParams('period=30d') }))

import { PeopleFilter } from '@/components/analytics/PeopleFilter'

afterEach(() => { cleanup(); push.mockClear() })

const people = [{ id: 'a', name: 'Arvind' }, { id: 'b', name: 'Kapil' }, { id: 'c', name: 'Mohit' }]

describe('the technician / requester filter of a team Dashboard', () => {
  it('is not shown when there is nobody to choose between', () => {
    const { container } = render(<PeopleFilter param="tech" noun="technicians" people={[people[0]]} selected={[]} />)
    expect(container.textContent).toBe('')
  })
  it('says everybody when nothing is picked, and how many when some are', () => {
    render(<PeopleFilter param="tech" noun="technicians" people={people} selected={[]} />)
    expect(screen.getByRole('button', { name: /All technicians \(3\)/ })).toBeTruthy()
    cleanup()
    render(<PeopleFilter param="requester" noun="requesters" people={people} selected={['a', 'b']} />)
    expect(screen.getByRole('button', { name: /2 of 3 requesters/ })).toBeTruthy()
  })
  it('puts the picked people in the page address (keeping the rest), and everybody removes the choice', () => {
    render(<PeopleFilter param="tech" noun="technicians" people={people} selected={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /All technicians/ }))
    const box = screen.getByRole('listbox', { name: 'technicians choices' })
    fireEvent.click(within(box).getByLabelText('Kapil'))
    fireEvent.click(within(box).getByLabelText('Mohit'))
    fireEvent.click(within(box).getByRole('button', { name: 'Apply' }))
    expect(push).toHaveBeenLastCalledWith('/dashboards?period=30d&tech=b%2Cc')
    fireEvent.click(screen.getByRole('button', { name: /All technicians/ }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'technicians choices' })).getByRole('button', { name: 'Apply' }))
    expect(push).toHaveBeenLastCalledWith('/dashboards?period=30d')
  })
})
