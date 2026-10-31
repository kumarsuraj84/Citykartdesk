import { OEM_SAMPLE_VALUES, STARTER_TEMPLATE_HTML } from '@/lib/email/oem-template'
import { STORE_MAIL_FIELDS, STORE_SAMPLE_VALUES } from '@/lib/stores/details'

// The wording, the insertable details and the example values of the two OEM mail templates (AC and Genset). Safe to load in the browser (no server-only library).

export type MailKind = 'ac' | 'genset'

const COMMON = ['ticket_no', 'subject', 'description', 'requester_name', 'requester_email', 'requester_phone', 'store_address', 'store_code', 'category', ...STORE_MAIL_FIELDS] as const
export const MASTER_PLACEHOLDERS: Record<MailKind, readonly string[]> = {
  ac: [...COMMON, 'ac_number', 'ac_serial', 'ac_brand', 'ac_floor', 'ac_type', 'ac_tonnage', 'ac_amc_vendor', 'ac_amc_brand', 'ac_details'],
  genset: [...COMMON, 'genset_brand', 'genset_kva', 'genset_serial', 'genset_cpcb_group', 'genset_details'],
}

export const MASTER_SAMPLE_VALUES: Record<MailKind, Record<string, string>> = {
  ac: {
    ...OEM_SAMPLE_VALUES, ...STORE_SAMPLE_VALUES, store_code: 'ALC', category: 'AC',
    ac_number: '3', ac_serial: 'DSA661R3Q-1DZF02124', ac_brand: 'BLUESTAR', ac_floor: 'FF_First Floor', ac_type: 'Ductable', ac_tonnage: '5.5 TR',
    ac_amc_vendor: 'BLUESTAR', ac_amc_brand: 'STAR COOLING CENTRE', ac_details: '3 - FF_First Floor, Ductable 5.5 TR, BLUESTAR, serial DSA661R3Q-1DZF02124',
  },
  genset: {
    ...OEM_SAMPLE_VALUES, ...STORE_SAMPLE_VALUES, store_code: 'MCR', category: 'Genset',
    genset_brand: 'MAHINDRA', genset_kva: '125', genset_serial: 'NDJZB11872', genset_cpcb_group: 'CPCB-II', genset_details: 'MAHINDRA 125 KVA, serial NDJZB11872, CPCB-II',
  },
}

export const DEFAULT_MASTER_SUBJECT: Record<MailKind, string> = {
  ac: 'New AC Issue Ticket - {{ticket_no}} - {{store_code}}',
  genset: 'New Genset Issue Ticket - {{ticket_no}} - {{store_code}}',
}

const withRows = (rows: string) => STARTER_TEMPLATE_HTML.replace('<tr><th>Issue</th>', `${rows}<tr><th>Issue</th>`)

export const DEFAULT_MASTER_BODY: Record<MailKind, string> = {
  ac: withRows('<tr><th>Store Code</th><td>{{store_code}}</td></tr><tr><th>AC Number</th><td>{{ac_number}}</td></tr><tr><th>AC Serial No</th><td>{{ac_serial}}</td></tr><tr><th>AC Details</th><td>{{ac_type}} {{ac_tonnage}}, {{ac_brand}}, {{ac_floor}}</td></tr>'),
  genset: withRows('<tr><th>Store Code</th><td>{{store_code}}</td></tr><tr><th>Genset Details</th><td>{{genset_details}}</td></tr>'),
}
