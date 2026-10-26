export type MasterKind = 'ac' | 'genset' | 'cvm' | 'pms'

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
  /** the OEM's address(es) for purchase-order details (the sheet column "OEM PO Mail To", formerly "Email for PO detail") */
  poEmails: string[]
  /** the Citykart people who approve a vendor's quote for this AC (the sheet column "CK PO Approver Mail To"); empty = the default approver */
  approverEmails: string[]
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

/** One PMS date of a store (the AC PMS sheet: Store Code + AC PMS Date). A store with several PMS dates has several rows. */
export type PmsRow = {
  sheetRow: number
  storeCode: string
  /** yyyy-mm-dd */
  pmsDate: string
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
