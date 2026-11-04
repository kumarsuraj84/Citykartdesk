import { describe, it, expect } from 'vitest'
import { approvalViaText, classifyManualApproval, sendButtonLabel } from '@/lib/approvals/via'

// How an approval got its approver is written into the history, so a wrong approver can be traced afterwards.

describe('how a manual approval is classified', () => {
  it('is "chosen" when every approver was picked by hand, or when no CVM was pre-filled', () => {
    expect(classifyManualApproval({ approverIds: ['ankur'], suggestedCvmId: null })).toBe('chosen')
    expect(classifyManualApproval({ approverIds: ['ankur'], suggestedCvmId: 'lal' })).toBe('chosen')   // the CVM was offered but is not among the approvers
  })
  it('is "cvm_suggestion_kept" when the pre-filled CVM is among the approvers', () => {
    expect(classifyManualApproval({ approverIds: ['lal'], suggestedCvmId: 'lal' })).toBe('cvm_suggestion_kept')
    expect(classifyManualApproval({ approverIds: ['ankur', 'lal'], suggestedCvmId: 'lal' })).toBe('cvm_suggestion_kept')
  })
})

describe('the words in the history', () => {
  it('says who chose, or that it was automatic', () => {
    expect(approvalViaText('chosen', 'Kaushlesh')).toBe('chosen by Kaushlesh')
    expect(approvalViaText('auto_cvm', 'The system')).toMatch(/automatically/)
    expect(approvalViaText('cvm_suggestion_kept', 'Kaushlesh')).toMatch(/pre-filled.*Kaushlesh kept it/)
  })
  it('says nothing for an old entry that has no record', () => {
    expect(approvalViaText(undefined, 'X')).toBe('')
    expect(approvalViaText('something else', 'X')).toBe('')
  })
})

describe('the send button', () => {
  it('names one or two people and counts more', () => {
    expect(sendButtonLabel([], false)).toBe('Send to people →')
    expect(sendButtonLabel(['Ankur Pahwa'], false)).toBe('Send to Ankur Pahwa →')
    expect(sendButtonLabel(['Ankur Pahwa', 'lal Bahadur'], false)).toBe('Send to Ankur Pahwa and lal Bahadur →')
    expect(sendButtonLabel(['A', 'B', 'C'], false)).toBe('Send to 3 people →')
    expect(sendButtonLabel(['Ankur Pahwa'], true)).toBe('Add Ankur Pahwa →')
  })
})
