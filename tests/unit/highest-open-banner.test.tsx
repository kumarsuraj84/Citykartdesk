// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { highestOpenAgents } from '@/lib/analytics/highest-open'
import { CapacityBanner } from '@/components/analytics/CapacityBanner'
import type { WorkloadRow } from '@/lib/queries/workload'

afterEach(() => cleanup())

const row = (agentName: string, totalOpen: number): WorkloadRow =>
  ({ agentId: agentName, agentName, totalOpen }) as WorkloadRow

describe('highestOpenAgents', () => {
  it('one clear highest technician -> one name', () => {
    expect(highestOpenAgents([row('Nisha', 30), row('Ajay', 12), row('Kapil', 4)]).map((r) => r.agentName)).toEqual(['Nisha'])
  })

  it('two tied for the most -> both names, whatever the threshold', () => {
    expect(highestOpenAgents([row('Ajay', 7), row('Nisha', 7), row('Kapil', 3)]).map((r) => r.agentName)).toEqual(['Ajay', 'Nisha'])
  })

  it('a small team with few tickets still shows who is highest (no fixed minimum like 15)', () => {
    expect(highestOpenAgents([row('Ajay', 2), row('Kapil', 1)]).map((r) => r.agentName)).toEqual(['Ajay'])
  })

  it('shows nobody when no one has an open ticket, or there are no technicians', () => {
    expect(highestOpenAgents([row('Ajay', 0), row('Kapil', 0)])).toEqual([])
    expect(highestOpenAgents([])).toEqual([])
  })
})

describe('CapacityBanner', () => {
  it('shows one technician with their count', () => {
    render(<CapacityBanner agents={[row('Nisha Negi', 30)]} />)
    expect(screen.getByText('Nisha Negi (30)')).toBeTruthy()
    expect(screen.getByText(/technician carrying the most work/)).toBeTruthy()
  })

  it('shows two technicians when two are tied', () => {
    render(<CapacityBanner agents={[row('Ajay Kumar', 12), row('Nisha Negi', 12)]} />)
    expect(screen.getByText('Ajay Kumar (12),')).toBeTruthy()
    expect(screen.getByText('Nisha Negi (12)')).toBeTruthy()
    expect(screen.getByText(/technicians carrying the most work/)).toBeTruthy()
  })

  it('renders nothing for an empty list', () => {
    const { container } = render(<CapacityBanner agents={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
