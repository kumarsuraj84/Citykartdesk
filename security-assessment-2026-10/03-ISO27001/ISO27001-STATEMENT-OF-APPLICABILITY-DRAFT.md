# ISO/IEC 27001:2022 Statement of Applicability - DRAFT - Citykart Desk (CKDesk)

Date: 2026-10-15

Status: **DRAFT for management review - internal readiness assessment, not an audit report or attestation**

## How to read this

**THIS IS A DRAFT PREPARED FOR MANAGEMENT. IT IS NOT APPROVED, NOT SIGNED AND NOT IN FORCE.** It does not mean that Citykart is certified, compliant or ready for audit. A real Statement of Applicability must be approved by top management after it has reviewed the risk assessment.

The Statement of Applicability lists every Annex A control, says whether it is included in the ISMS or excluded, gives a reason, and states its implementation status. Here, the statuses are the same states used in `ISO27001-ANNEX-A-CONTROL-MATRIX.md` and the control ids are identical to the matrix. A status is only **Implemented** when the repository shows the working element; it is never set to Implemented for something that is only written down (that is **Designed**).

Reasons for inclusion in this draft come from the risk assessment (`ISO27001-RISK-ASSESSMENT.md`), from the controls the CKDesk system relies on, and from the standard's baseline. Legal and contractual reasons are **PROVISIONAL**: no legal register has been supplied. Control titles must be confirmed against the licensed standard.

## Approval block (empty on purpose)

| Item | Entry |
|---|---|
| Status | **DRAFT - not approved** |
| Version | 0.1 draft of 2026-10-15 |
| Prepared by | Internal readiness assessment (not an auditor) |
| Owner | Not known from the repository - management to assign |
| Approved by (top management) | _not approved_ |
| Approval date | _none_ |
| Next review | _to be set by management_ |

## Proposed scope (PROVISIONAL - management to confirm)

Citykart Desk and its hosting: app server 10.0.1.98, database server 10.0.0.205 (database `ckdesk`), NAS 10.0.0.25 (attachments), developer PC, admin PC, source repository, supporting suppliers and the people who build, run and use the system. See the matrix for detail.

## Summary

| Decision | Number of controls |
|---|---|
| Included | 93 |
| Excluded | 0 |
| **Total** | 93 |

No control is excluded in this draft. Management may later exclude a control with a written reason (for example A.8.30 if all development is confirmed to be done in-house). Controls marked "organisation-level" are run by HR, facilities or legal; CKDesk relies on them but does not provide them.

| Implementation status | Controls |
|---|---|
| Designed | 14 |
| Implemented | 16 |
| Tested | 7 |
| Operating with evidence | 0 |
| Not implemented | 10 |
| Not verified | 46 |
| Not applicable | 0 |
| **Total** | 93 |

Counts are computed from the same rows as the matrix.

## Organisational controls (A.5.1 - A.5.37)

| Control id | Control name | Decision | Justification | Implementation status | Matrix reference | Related risks |
|---|---|---|---|---|---|---|
| A.5.1 | Policies for information security | Included | Included - Required by clause 5.2 and the basis of every other control. | Not verified | Matrix row A.5.1 | RISK-44 |
| A.5.2 | Information security roles and responsibilities | Included | Included - Needed so each control has an accountable owner. | Not verified | Matrix row A.5.2 | RISK-10, RISK-44 |
| A.5.3 | Segregation of duties | Included | Included - Key control against error and misuse, weak today in delivery. | Implemented | Matrix row A.5.3 | RISK-09, RISK-14, RISK-20, RISK-27, RISK-46 |
| A.5.4 | Management responsibilities | Included | Included - Management leadership is required by clause 5. | Not verified | Matrix row A.5.4 | RISK-44 |
| A.5.5 | Contact with authorities | Included | Included - organisation-level control relied on by CKDesk, run outside the CKDesk team. Organisation-wide duty that CKDesk incidents would rely on. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Not verified | Matrix row A.5.5 | none mapped yet |
| A.5.6 | Contact with special interest groups | Included | Included - Cheap way to learn about patches in time. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Not verified | Matrix row A.5.6 | none mapped yet |
| A.5.7 | Threat intelligence | Included | Included - Public-facing app on Windows host needs timely threat information. | Not implemented | Matrix row A.5.7 | RISK-01, RISK-31 |
| A.5.8 | Information security in project management | Included | Included - New features are built often, so each needs a security check. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Designed | Matrix row A.5.8 | none mapped yet |
| A.5.9 | Inventory of information and other associated assets | Included | Included - Needed to scope the ISMS and drive the risk assessment. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Designed | Matrix row A.5.9 | none mapped yet |
| A.5.10 | Acceptable use of information and other associated assets | Included | Included - Staff post sensitive data in tickets and attachments. | Not verified | Matrix row A.5.10 | RISK-45, RISK-47 |
| A.5.11 | Return of assets | Included | Included - organisation-level control relied on by CKDesk, run outside the CKDesk team. Organisation-wide HR process relied on by CKDesk. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Not verified | Matrix row A.5.11 | none mapped yet |
| A.5.12 | Classification of information | Included | Included - Basis for access, encryption and retention choices. | Not implemented | Matrix row A.5.12 | RISK-16, RISK-36, RISK-47 |
| A.5.13 | Labelling of information | Included | Included - Follows classification. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Not implemented | Matrix row A.5.13 | none mapped yet |
| A.5.14 | Information transfer | Included | Included - Staff and personal data cross networks daily. | Implemented | Matrix row A.5.14 | RISK-02, RISK-26 |
| A.5.15 | Access control | Included | Included - Core control for a service desk holding staff data. | Tested | Matrix row A.5.15 | RISK-15, RISK-16, RISK-19, RISK-34 |
| A.5.16 | Identity management | Included | Included - Identity quality drives all access decisions. | Implemented | Matrix row A.5.16 | RISK-03, RISK-07, RISK-17, RISK-18 |
| A.5.17 | Authentication information | Included | Included - Weak start passwords on ~553 accounts. | Implemented | Matrix row A.5.17 | RISK-03, RISK-08, RISK-17, RISK-22, RISK-24 |
| A.5.18 | Access rights | Included | Included - Excess rights are not found without a review. | Implemented | Matrix row A.5.18 | RISK-07, RISK-18, RISK-19 |
| A.5.19 | Information security in supplier relationships | Included | Included - Customer-facing data flows go to several outside services. | Not verified | Matrix row A.5.19 | RISK-35 |
| A.5.20 | Addressing information security within supplier agreements | Included | Included - Personal data goes to these suppliers. | Not verified | Matrix row A.5.20 | RISK-35, RISK-36 |
| A.5.21 | Managing information security in the ICT supply chain | Included | Included - Production still on the vulnerable framework. | Not implemented | Matrix row A.5.21 | RISK-01, RISK-31, RISK-35 |
| A.5.22 | Monitoring, review and change management of supplier services | Included | Included - Supplier changes can break mail or WhatsApp intake. | Not verified | Matrix row A.5.22 | RISK-35 |
| A.5.23 | Information security for use of cloud services | Included | Included - Mail is the intake and notification channel. | Not verified | Matrix row A.5.23 | RISK-35, RISK-46 |
| A.5.24 | Information security incident management planning and preparation | Included | Included - No agreed response if an account or server is compromised. | Not verified | Matrix row A.5.24 | RISK-13 |
| A.5.25 | Assessment and decision on information security events | Included | Included - Detection data exists but is not used. | Designed | Matrix row A.5.25 | RISK-11, RISK-12, RISK-13 |
| A.5.26 | Response to information security incidents | Included | Included - Needed to limit damage quickly. | Designed | Matrix row A.5.26 | RISK-13 |
| A.5.27 | Learning from information security incidents | Included | Included - Existing fix reports show the habit; formalise it. | Designed | Matrix row A.5.27 | RISK-13 |
| A.5.28 | Collection of evidence | Included | Included - Strong design, but no process around it. | Designed | Matrix row A.5.28 | RISK-13, RISK-42 |
| A.5.29 | Information security during disruption | Included | Included - Recovery often skips controls. | Designed | Matrix row A.5.29 | RISK-04, RISK-38 |
| A.5.30 | ICT readiness for business continuity | Included | Included - Stores and offices depend on CKDesk. | Not implemented | Matrix row A.5.30 | RISK-04, RISK-06, RISK-37, RISK-38 |
| A.5.31 | Legal, statutory, regulatory and contractual requirements | Included | Included - Basis for retention and privacy choices. | Not verified | Matrix row A.5.31 | RISK-36 |
| A.5.32 | Intellectual property rights | Included | Included - organisation-level control relied on by CKDesk, run outside the CKDesk team. Low risk but expected. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Not verified | Matrix row A.5.32 | none mapped yet |
| A.5.33 | Protection of records | Included | Included - Tickets are business records. | Implemented | Matrix row A.5.33 | RISK-36, RISK-42 |
| A.5.34 | Privacy and protection of PII | Included | Included - Large staff data set including activity monitoring. | Not implemented | Matrix row A.5.34 | RISK-15, RISK-36 |
| A.5.35 | Independent review of information security | Included | Included - Independence is required before any certification. | Not verified | Matrix row A.5.35 | RISK-44 |
| A.5.36 | Compliance with policies, rules and standards for information security | Included | Included - Depends on A.5.1. | Not verified | Matrix row A.5.36 | RISK-12, RISK-44 |
| A.5.37 | Documented operating procedures | Included | Included - Good base; needs upkeep. | Designed | Matrix row A.5.37 | RISK-05, RISK-10, RISK-41 |

## People controls (A.6.1 - A.6.8)

| Control id | Control name | Decision | Justification | Implementation status | Matrix reference | Related risks |
|---|---|---|---|---|---|---|
| A.6.1 | Screening | Included | Included - organisation-level control relied on by CKDesk, run outside the CKDesk team. Organisation-wide HR control. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Not verified | Matrix row A.6.1 | none mapped yet |
| A.6.2 | Terms and conditions of employment | Included | Included - organisation-level control relied on by CKDesk, run outside the CKDesk team. Organisation-wide HR control. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Not verified | Matrix row A.6.2 | none mapped yet |
| A.6.3 | Information security awareness, education and training | Included | Included - Admins and technicians are the main attack target. | Not verified | Matrix row A.6.3 | RISK-10, RISK-45 |
| A.6.4 | Disciplinary process | Included | Included - organisation-level control relied on by CKDesk, run outside the CKDesk team. Organisation-wide HR control. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Not verified | Matrix row A.6.4 | none mapped yet |
| A.6.5 | Responsibilities after termination or change of employment | Included | Included - Stale accounts are a common route in. | Not verified | Matrix row A.6.5 | RISK-18 |
| A.6.6 | Confidentiality or non-disclosure agreements | Included | Included - organisation-level control relied on by CKDesk, run outside the CKDesk team. Organisation-wide control. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Not verified | Matrix row A.6.6 | none mapped yet |
| A.6.7 | Remote working | Included | Included - Admin PC and dev PC are key assets. | Not verified | Matrix row A.6.7 | RISK-33 |
| A.6.8 | Information security event reporting | Included | Included - Early reports limit damage. | Not verified | Matrix row A.6.8 | RISK-13, RISK-45 |

## Physical controls (A.7.1 - A.7.14)

| Control id | Control name | Decision | Justification | Implementation status | Matrix reference | Related risks |
|---|---|---|---|---|---|---|
| A.7.1 | Physical security perimeters | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. Servers hold all CKDesk data. | Not verified | Matrix row A.7.1 | RISK-39 |
| A.7.2 | Physical entry | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. Direct access defeats most controls. | Not verified | Matrix row A.7.2 | RISK-39 |
| A.7.3 | Securing offices, rooms and facilities | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. Servers and NAS may share rooms with other equipment. | Not verified | Matrix row A.7.3 | RISK-39 |
| A.7.4 | Physical security monitoring | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. Detect tampering. | Not verified | Matrix row A.7.4 | RISK-39 |
| A.7.5 | Protecting against physical and environmental threats | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. Single site holds all copies today. | Not verified | Matrix row A.7.5 | RISK-04, RISK-39 |
| A.7.6 | Working in secure areas | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. Applies to engineers and vendors. | Not verified | Matrix row A.7.6 | RISK-39 |
| A.7.7 | Clear desk and clear screen | Included | Included - organisation-level control relied on by CKDesk, run outside the CKDesk team. Organisation-wide rule. | Not verified | Matrix row A.7.7 | RISK-39 |
| A.7.8 | Equipment siting and protection | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. Placement affects fire and theft risk. | Not verified | Matrix row A.7.8 | RISK-39 |
| A.7.9 | Security of assets off-premises | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. These PCs are attack paths to production. | Not verified | Matrix row A.7.9 | RISK-33, RISK-39 |
| A.7.10 | Storage media | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. Backups and attachments sit on media. | Not verified | Matrix row A.7.10 | RISK-04, RISK-06, RISK-39 |
| A.7.11 | Supporting utilities | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. Single servers go down with power. | Not verified | Matrix row A.7.11 | RISK-39 |
| A.7.12 | Cabling security | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. Low risk, expected by auditors. | Not verified | Matrix row A.7.12 | RISK-39 |
| A.7.13 | Equipment maintenance | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. Hardware failure is a main outage cause. | Not verified | Matrix row A.7.13 | RISK-32, RISK-39 |
| A.7.14 | Secure disposal or re-use of equipment | Included | Included - CKDesk runs on physical servers, a NAS and PCs; the premises are not described in the repository. Retired server still holds old data. | Not verified | Matrix row A.7.14 | RISK-39 |

## Technological controls (A.8.1 - A.8.34)

| Control id | Control name | Decision | Justification | Implementation status | Matrix reference | Related risks |
|---|---|---|---|---|---|---|
| A.8.1 | User endpoint devices | Included | Included - Dev PC holds production-like data. | Not verified | Matrix row A.8.1 | RISK-33 |
| A.8.2 | Privileged access rights | Included | Included - Highest-impact control in the scope. | Implemented | Matrix row A.8.2 | RISK-07, RISK-08, RISK-17, RISK-18, RISK-19, RISK-20, RISK-22, RISK-40 |
| A.8.3 | Information access restriction | Included | Included - Core to the service desk. | Tested | Matrix row A.8.3 | RISK-14, RISK-15, RISK-16, RISK-20, RISK-26, RISK-27, RISK-29, RISK-49 |
| A.8.4 | Access to source code | Included | Included - Source holds the logic and some secrets history risk. | Not verified | Matrix row A.8.4 | RISK-09, RISK-34 |
| A.8.5 | Secure authentication | Included | Included - Public login page. | Implemented | Matrix row A.8.5 | RISK-02, RISK-03, RISK-17, RISK-25, RISK-48 |
| A.8.6 | Capacity management | Included | Included - Single servers can fill disks or saturate. | Designed | Matrix row A.8.6 | RISK-28, RISK-37, RISK-43 |
| A.8.7 | Protection against malware | Included | Included - Technicians open attachments from 553 users. | Not implemented | Matrix row A.8.7 | RISK-30 |
| A.8.8 | Management of technical vulnerabilities | Included | Included - Unpatched public-facing framework. | Implemented | Matrix row A.8.8 | RISK-01, RISK-31, RISK-32 |
| A.8.9 | Configuration management | Included | Included - Several findings depend on live settings. | Designed | Matrix row A.8.9 | RISK-08, RISK-32, RISK-40, RISK-41 |
| A.8.10 | Information deletion | Included | Included - Data kept longer than needed raises exposure. | Designed | Matrix row A.8.10 | RISK-36 |
| A.8.11 | Data masking | Included | Included - Reduces leak of personal data in logs. | Implemented | Matrix row A.8.11 | RISK-47 |
| A.8.12 | Data leakage prevention | Included | Included - Staff data exposure. | Tested | Matrix row A.8.12 | RISK-15 |
| A.8.13 | Information backup | Included | Included - Total loss risk. | Designed | Matrix row A.8.13 | RISK-04, RISK-05, RISK-06, RISK-23, RISK-38 |
| A.8.14 | Redundancy of information processing facilities | Included | Included - Outage affects all stores and offices. | Not implemented | Matrix row A.8.14 | RISK-11, RISK-37, RISK-38 |
| A.8.15 | Logging | Included | Included - Good design, partly evidenced. | Tested | Matrix row A.8.15 | RISK-07, RISK-11, RISK-12, RISK-14, RISK-42 |
| A.8.16 | Monitoring activities | Included | Included - Failures go unnoticed. | Not implemented | Matrix row A.8.16 | RISK-05, RISK-11, RISK-12, RISK-25, RISK-28 |
| A.8.17 | Clock synchronization | Included | Included - Log times must be reliable. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Not verified | Matrix row A.8.17 | none mapped yet |
| A.8.18 | Use of privileged utility programs | Included | Included - Tools bypass row security. | Not verified | Matrix row A.8.18 | RISK-07 |
| A.8.19 | Installation of software on operational systems | Included | Included - Needed for patching. | Designed | Matrix row A.8.19 | RISK-01, RISK-32 |
| A.8.20 | Networks security | Included | Included - Public exposure. | Designed | Matrix row A.8.20 | RISK-02, RISK-28, RISK-40 |
| A.8.21 | Security of network services | Included | Included - Single path to the public. | Not verified | Matrix row A.8.21 | RISK-02 |
| A.8.22 | Segregation of networks | Included | Included - Reduces spread of compromise. | Not verified | Matrix row A.8.22 | RISK-40 |
| A.8.23 | Web filtering | Included | Included - organisation-level control relied on by CKDesk, run outside the CKDesk team. Organisation-wide. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Not verified | Matrix row A.8.23 | none mapped yet |
| A.8.24 | Use of cryptography | Included | Included - Keys and transport protect everything else. | Implemented | Matrix row A.8.24 | RISK-02, RISK-05, RISK-08, RISK-22, RISK-23, RISK-24, RISK-33 |
| A.8.25 | Secure development life cycle | Included | Included - All fixes are only as good as the process. | Implemented | Matrix row A.8.25 | RISK-09, RISK-31, RISK-46 |
| A.8.26 | Application security requirements | Included | Included - Gives tests a target. | Not implemented | Matrix row A.8.26 | RISK-21 |
| A.8.27 | Secure system architecture and engineering principles | Included | Included - Sound base. | Implemented | Matrix row A.8.27 | RISK-49 |
| A.8.28 | Secure coding | Included | Included - Issues were found in many areas. | Implemented | Matrix row A.8.28 | RISK-14, RISK-21, RISK-26, RISK-29, RISK-49 |
| A.8.29 | Security testing in development and acceptance | Included | Included - Good tests, manual use. | Tested | Matrix row A.8.29 | RISK-09, RISK-49 |
| A.8.30 | Outsourced development | Included | Included (PROVISIONAL) - not known whether any development is outsourced; an AI coding assistant and one developer identity are visible. Excluded only if no outsourcing. | Not verified | Matrix row A.8.30 | RISK-46 |
| A.8.31 | Separation of development, test and production environments | Included | Included - Prevents testing on production. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Tested | Matrix row A.8.31 | none mapped yet |
| A.8.32 | Change management | Included | Included - Every fix passes through here. | Implemented | Matrix row A.8.32 | RISK-01, RISK-09 |
| A.8.33 | Test information | Included | Included - Avoids leak of real staff data. | Implemented | Matrix row A.8.33 | RISK-33 |
| A.8.34 | Protection of information systems during audit testing | Included | Included - Shows safe testing. No risk is mapped yet; included as part of the Annex A baseline pending management review. | Tested | Matrix row A.8.34 | none mapped yet |

## Notes for management

- Implementation status is **not** a compliance rating. "Tested" means the control was exercised on the isolated local stack; production does not yet contain the assessment's fixes. "Not verified" means evidence is needed from the organisation; it does not mean the control is absent.
- To move a control toward "Operating with evidence" management must supply class C records (approved documents, dated reviews, restore tests, training and access-review records) and the control must run for a period an auditor can sample.
- This draft will have to be updated whenever the risk assessment, the scope or the matrix changes.

## Open questions / evidence requests for management

Everything in this list is "Not known from the repository - management to confirm". Do not send secrets, passwords or keys; send the document, screenshot or export with secrets removed.

1. **Approve, amend or reject** the scope and each Included / Excluded decision. State reasons for any exclusion.
2. Name the **owner of the Statement of Applicability** and who approves it (top management).
3. Confirm the **legal and contractual requirements** that make controls mandatory (the legal register is missing; legal reasons here are provisional).
4. Confirm whether any **development is outsourced** (A.8.30) and whether the organisation wants **web filtering** (A.8.23), **clear desk** (A.7.7) and the other organisation-level controls inside the CKDesk ISMS scope or in a wider organisational ISMS.
5. Provide the **class C evidence** requested in the matrix (policies, access reviews, backup and restore records, training, physical inspection, supplier terms).
6. Confirm the **review date** and who will update this statement after the next risk assessment.
7. Confirm that the controls shown as **Designed** (documented only) are understood as not yet working controls, and decide which are to be built first (see the treatment plan).
