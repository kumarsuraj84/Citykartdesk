import type { TicketFact } from '@/lib/reporting/analytics/facts'

/** A ticket as the reports see it; tests change only what they care about. */
export function fact(o: Partial<TicketFact> & { ticketNo: string }): TicketFact {
  return {
    id: o.ticketNo, subject: `Subject ${o.ticketNo}`, requester: 'LSR', technician: 'Krishan', category: 'ADMIN AC ISSUE', subCategory: 'COOLING ISSUE',
    service: 'ADMIN - AC', serviceId: 'svc-ac', isAcTicket: true, status: 'in_progress', priority: 'medium',
    createdAt: '2026-10-01T10:00:00.000Z', resolvedAt: null, doneAt: null, ageDays: 3, ageBucket: '0–5 days',
    store: 'LSR', isStoreAccount: true, city: 'LAKHISARAI', state: 'BIHAR', cluster: 'JH1', region: 'R2', priorityList: 'ROS', festival: '',
    acBrand: 'DAIKIN', acAmcBrand: 'DAIKIN', acAmcVendor: 'SHREYASH ENTERPRISES', acTotal: 11, zenatix: 'No', openDate: '2020-01-01', storeType: 'Regular', oem: 'DAIKAIN OEM - ALL',
    acNo: '9', oemTicketNo: '', oemTicketDate: null, acResolution: '', oemAgeDays: null, oemBucket: '',
    openMonth: 'Oct-26', openWeek: 'Week-1', closeMonth: '', closeWeek: '',
    storeAcTickets: 2, acNotWorkingPct: (2 / 11) * 100, redFlag: 'No',
    ...o,
  }
}
