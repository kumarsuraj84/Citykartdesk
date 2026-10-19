import { OEM_SAMPLE_VALUES, STARTER_TEMPLATE_HTML } from '@/lib/email/oem-template'

// The wording, the insertable details and the example values of the two OEM mail templates (AC and Genset). Safe to load in the browser (no server-only library).

export type MailKind = 'ac' | 'genset' | 'revisit'

const COMMON = ['ticket_no', 'subject', 'description', 'requester_name', 'requester_email', 'requester_phone', 'store_address', 'store_code', 'category'] as const
export const MASTER_PLACEHOLDERS: Record<MailKind, readonly string[]> = {
  ac: [...COMMON, 'ac_number', 'ac_serial', 'ac_brand', 'ac_floor', 'ac_type', 'ac_tonnage', 'ac_amc_vendor', 'ac_amc_brand', 'ac_details'],
  genset: [...COMMON, 'genset_brand', 'genset_kva', 'genset_serial', 'genset_cpcb_group', 'genset_details'],
  revisit: ['ticket_no', 'store_code', 'store_address', 'ac_number', 'ac_details', 'engineer_name', 'engineer_mobile', 'visit_date', 'engineer_remarks', 'store_remarks'],
}

export const MASTER_SAMPLE_VALUES: Record<MailKind, Record<string, string>> = {
  ac: {
    ...OEM_SAMPLE_VALUES, store_code: 'ALC', category: 'AC',
    ac_number: '3', ac_serial: 'DSA661R3Q-1DZF02124', ac_brand: 'BLUESTAR', ac_floor: 'FF_First Floor', ac_type: 'Ductable', ac_tonnage: '5.5 TR',
    ac_amc_vendor: 'BLUESTAR', ac_amc_brand: 'STAR COOLING CENTRE', ac_details: '3 - FF_First Floor, Ductable 5.5 TR, BLUESTAR, serial DSA661R3Q-1DZF02124',
  },
  genset: {
    ...OEM_SAMPLE_VALUES, store_code: 'MCR', category: 'Genset',
    genset_brand: 'MAHINDRA', genset_kva: '125', genset_serial: 'NDJZB11872', genset_cpcb_group: 'CPCB-II', genset_details: 'MAHINDRA 125 KVA, serial NDJZB11872, CPCB-II',
  },
  revisit: {
    ticket_no: 'CKSD-000123, CKSD-000124', store_code: 'ALC', store_address: 'Main Road, Civil Lines, Allahabad - 211001', ac_number: '3', ac_details: 'FF_First Floor, Ductable 5.5 TR, BLUESTAR, serial DSA661R3Q-1DZF02124',
    engineer_name: 'Ramesh Kumar', engineer_mobile: '98XXXXXX10', visit_date: '2026-10-18', engineer_remarks: 'Gas refilled, cooling checked', store_remarks: 'The AC is still not cooling after 2 hours.',
  },
}

export const DEFAULT_MASTER_SUBJECT: Record<MailKind, string> = {
  ac: 'New AC Issue Ticket - {{ticket_no}} - {{store_code}}',
  genset: 'New Genset Issue Ticket - {{ticket_no}} - {{store_code}}',
  revisit: 'Please send an engineer again - {{store_code}} AC {{ac_number}} - {{ticket_no}}',
}

const withRows = (rows: string) => STARTER_TEMPLATE_HTML.replace('<tr><th>Issue</th>', `${rows}<tr><th>Issue</th>`)

export const DEFAULT_MASTER_BODY: Record<MailKind, string> = {
  ac: withRows('<tr><th>Store Code</th><td>{{store_code}}</td></tr><tr><th>AC Number</th><td>{{ac_number}}</td></tr><tr><th>AC Serial No</th><td>{{ac_serial}}</td></tr><tr><th>AC Details</th><td>{{ac_type}} {{ac_tonnage}}, {{ac_brand}}, {{ac_floor}}</td></tr>'),
  genset: withRows('<tr><th>Store Code</th><td>{{store_code}}</td></tr><tr><th>Genset Details</th><td>{{genset_details}}</td></tr>'),
  revisit:
    '<p>Dear Team,</p>' +
    '<p>Your engineer visited the store below and reported the AC issue as <b>resolved</b>. The store has checked and says it is <b>not resolved</b>. Please send an engineer again to check it.</p>' +
    '<table><tbody>' +
    '<tr><th>Tickets</th><td>{{ticket_no}}</td></tr><tr><th>Store</th><td>{{store_code}}</td></tr><tr><th>Address</th><td>{{store_address}}</td></tr>' +
    '<tr><th>AC</th><td>{{ac_number}} - {{ac_details}}</td></tr><tr><th>Engineer</th><td>{{engineer_name}}, mobile {{engineer_mobile}}</td></tr>' +
    '<tr><th>Visit date</th><td>{{visit_date}}</td></tr><tr><th>Engineer\'s remarks</th><td>{{engineer_remarks}}</td></tr><tr><th>Store\'s remarks</th><td>{{store_remarks}}</td></tr>' +
    '</tbody></table><p></p><p>Thanks and Regards,<br>Citykart Team</p>',
}
