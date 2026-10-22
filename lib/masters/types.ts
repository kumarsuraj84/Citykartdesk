export type MasterKind = 'ac' | 'genset' | 'cvm'

export type MasterIssue = {
  kind: MasterKind
  severity: 'error' | 'warning'
  code: string
  storeCode: string | null
  sheetRow: number | null
  message: string
  /** the address / text the problem is about (used to group the same problem found on many rows) */
  token?: string
}

export type AcRow = {
  sheetRow: number
  storeCode: string
  ckdeskNo: string
  serial: string
  floor: string
  acType: string
  tonnage: string
  brand: string
  amcVendor: string
  amcBrand: string
  zenatix: string
  storePriority: string
  festival: string
  region: string
  cluster: string
  openingDate: string | null
  city: string
  state: string
  address: string
  pincode: string
  isActive: boolean
  emails: string[]
  /** the OEM's address(es) for purchase-order details (the sheet column "Email for PO detail") */
  poEmails: string[]
}

export type GensetRow = {
  sheetRow: number
  storeCode: string
  brand: string
  kva: string
  serial: string
  cpcbGroup: string
  emails: string[]
}

export type CvmRow = {
  sheetRow: number
  storeCode: string
  cvmEmail: string
}

export type ParseResult<R> = { rows: R[]; issues: MasterIssue[]; fatal?: string }

/** A stored unit as the sync sees it (only the fields the matching needs). */
export type StoredUnit = {
  id: string
  storeCode: string
  ckdeskNo?: string
  serial: string | null
  removedAt: string | null
  missingSince: string | null
}
