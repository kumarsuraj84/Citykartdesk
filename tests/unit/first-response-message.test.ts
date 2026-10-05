import { describe, it, expect } from 'vitest'
import { buildFirstResponseMessage } from '@/lib/requests/first-response'

describe('buildFirstResponseMessage', () => {
  it('greets the requester and names the technician and ticket', () => {
    expect(buildFirstResponseMessage({ requesterName: 'JDV', technicianName: 'Aakankasha Gupta', requestNo: 'CKSD-000080' })).toBe(
      'Hello JDV,\n\nAakankasha Gupta has started working on your request CKSD-000080. We will keep you updated here as it progresses.'
    )
  })

  it('still reads well when the requester has no name', () => {
    expect(buildFirstResponseMessage({ requesterName: null, technicianName: 'Ajay', requestNo: 'CKSD-1' })).toMatch(/^Hello,\n\nAjay has started/)
    expect(buildFirstResponseMessage({ requesterName: '  ', technicianName: 'Ajay', requestNo: 'CKSD-1' })).toMatch(/^Hello,/)
  })
})
