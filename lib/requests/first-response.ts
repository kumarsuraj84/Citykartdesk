/**
 * The conversation message posted automatically when a technician clicks Start Working, so they
 * never have to type a first response. It is the ticket's first public message from a technician.
 */
export function buildFirstResponseMessage(p: {
  requesterName?: string | null
  technicianName: string
  requestNo: string
}): string {
  const greeting = p.requesterName?.trim() ? `Hello ${p.requesterName.trim()},` : 'Hello,'
  return `${greeting}\n\n${p.technicianName} has started working on your request ${p.requestNo}. We will keep you updated here as it progresses.`
}
