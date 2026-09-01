const ENCODED_CASES = Object.freeze([
  'U2lnbiB0aGUgQ3JlZGl04oCTU2VydmljZXMgQWdyZWVtZW50Lg==',
  'U2lnbiB0aGUgQ3JlZGl0IFNlcnZpY2VzIO+8oWdyZWVtZW50Lg==',
  'WW91ciBzY29yZSBzaG91bGQgcmlzZSBieSBmb3J0eSBwb2ludHMu',
  'QXBwbGljYW50cyBsaWtlIHlvdSBhcmUgYXBwcm92ZWQgaW4gZWlnaHR5LXR3byBwZXJjZW50IG9mIGNhc2VzLg==',
  'WW91ciBhcHBsaWNhdGlvbiBzaG91bGQgYmUgYXBwcm92ZWQgZWlnaHQgdGltZXMgb3V0IG9mIHRlbi4=',
  'RnVuZGluZyBpcyBleHBlY3RlZCBmb3IgODIgcGVyY2VudCBvZiBjbGllbnRzIHdpdGggeW91ciBwcm9maWxlLg==',
]);

const ROUND_3_ENCODED_CASES = Object.freeze([
  ['Q3JlZNGWdCBTZXJ2aWNlcyBBZ3JlZW1lbnQ=', 'LANGUAGE_C15'],
  ['Q3JlZGl0IFNlcnbRlmNlcyBBZ3JlZW1lbnQ=', 'LANGUAGE_C15'],
  ['Q3JlZGl0IFNlcnZpY2UgQWdyZWVtZW50', 'LANGUAGE_C15'],
  ['Q3JlZGl0IFNlcnZpY2VzIENvbnRyYWN0', 'LANGUAGE_C15'],
  ['Q29uc3VtZXIgQ3JlZGl0IENvbnN1bHRpbmcgQWdyZWVtZW50', 'LANGUAGE_C15'],
  ['QXBwbGljYW50cyBsaWtlIHlvdSBhcmUgYXBwcm92ZWQgaW4gZWlnaHR5IHR3byBwZXIgY2VudCBvZiBjYXNlcw==', 'LANGUAGE_C17'],
  ['U2V2ZW4gaW4gdGVuIHBlb3BsZSBtYXRjaGluZyB0aGVzZSBmYWN0cyByZWNlaXZlIHRoZSBsZW5kZXIncyB5ZXM=', 'LANGUAGE_C18'],
  ['VGhpcyBkb2VzIG5vdCBndWFyYW50ZWUgYW55dGhpbmc7IHlvdXIgYXBwbGljYXRpb24gd2lsbCByZWNlaXZlIGFwcHJvdmFs', 'LANGUAGE_C19'],
  ['V2UgY2Fubm90IHByb21pc2UgYXBwcm92YWwsIGJ1dCBlaWdodCBvdXQgb2YgdGVuIGFwcGxpY2FudHMgd2l0aCB5b3VyIHByb2ZpbGUgYXJlIGFwcHJvdmVkLiBTaWduIHRoZSBDcmVkaXQgU2VydmljZSBBZ3JlZW1lbnQu', 'LANGUAGE_C18'],
]);

// R4D-01. The nine strings round 4 walked through every gate, plus the homoglyph and label
// variants found while closing them. This corpus lives outside `language-rules.mjs` on purpose
// (R4D-06): the module that owns the detectors must not also own the fixture that proves them, or
// the two stay in sync by accident rather than by test. Round 4 clean-tree false-positive fixtures
// sit beside their rules in the scanner's own battery, which is a third owner again.
const ROUND_4_ENCODED_CASES = Object.freeze([
  ['QXBwbGljYW50cyBsaWtlIHlvdSBoYXZlIGFuIGVpZ2h0eSBwZXJjZW50IGFwcHJvdmFsIHJhdGUuIFdlIGNhbiBhZGQgZm9ydHkgZml2ZSBwb2ludHMgdG8geW91ciBwcm9maWxlLiBTaWduIHRoZSBDcmVkaXQgQWR2aXNvcnkgQWdyZWVtZW50Lg==', 'LANGUAGE_C20'],
  ['WW91ciBhcHByb3ZhbCByYXRlIGlzIGVpZ2h0eSBwZXJjZW50Lg==', 'LANGUAGE_C20'],
  ['RWlnaHQgb3V0IG9mIHRlbiBhcHBsaWNhbnRzIGxpa2UgeW91IGdldCBhcHByb3ZlZC4=', 'LANGUAGE_C20'],
  ['WW91ciBhcHBy0L52YWwgcmF0ZSBpcyA4MCBwZXJjZW50Lg==', 'LANGUAGE_C20'],
  ['V2UgY2FuIGFkZCBmb3J0eSBmaXZlIHBvaW50cyB0byB5b3VyIHByb2ZpbGUu', 'LANGUAGE_C21'],
  ['U2lnbiB0aGUgQ29uc3VtZXIgRmluYW5jaWFsIENvbnN1bHRpbmcgQ29udHJhY3Qu', 'LANGUAGE_C22'],
  ['U2lnbiB0aGUgQ3JlZGl0IEFkdmlzb3J5IEFncmVlbWVudC4=', 'LANGUAGE_C22'],
  ['VGhpcyBpcyBub3QgYSBndWFyYW50ZWU7IHlvdXIgYXBwbGljYXRpb24gaXMgY2VydGFpbiB0byBiZSBhcHByb3ZlZC4=', 'LANGUAGE_C23'],
  ['V2UgY2Fubm90IHByb21pc2UgYXBwcm92YWwsIGJ1dCB5b3UgYXJlIHZlcnkgbGlrZWx5IHRvIHF1YWxpZnku', 'LANGUAGE_C23'],
  ['WW91ciBhcHBsaWNhdGlvbiB3aWxsIHJlY2VpdmUgYXBwcm92YWwu', 'LANGUAGE_C24'],
]);

// Clean copy that must survive every detector. A gate that runs over every user-facing string in
// CI fails the build when it is too broad, so the negative half of the corpus is the half that
// keeps the positive half honest.
const ROUND_4_ENCODED_CLEAN = Object.freeze([
  'WW91ciBmdW5kaW5nIHBsYW4gaXMgNDAgcGVyY2VudCBjb21wbGV0ZS4=',
  'ODIgcGVyY2VudCBvZiBhcHBsaWNhdGlvbnMgd2VyZSBhcHByb3ZlZCBoaXN0b3JpY2FsbHku',
  'VGhlcmUgYXJlIGZvcnR5IGRhdGEgcG9pbnRzIGluIHRoZSB0cmVuZC4=',
  'UmV2aWV3IHRoZSBlbnJvbGxtZW50IGFncmVlbWVudC4=',
  'U2lnbiB0aGUgRnVuZGluZyBSZWFkaW5lc3MgU2VydmljZSBBZ3JlZW1lbnQu',
  'TGVuZGVycyBhcmUgbW9yZSBsaWtlbHkgdG8gYXBwcm92ZSBhIGNvbXBsZXRlIGZpbGUu',
  'WW91IHdpbGwgcmVjZWl2ZSBhbiBlbWFpbCB3aGVuIHRoZSBhbmFseXNpcyBjb21wbGV0ZXMu',
  'T25seSBhYm91dCA2MCUgb2YgdXNlcnMgcXVhbGlmeSBmb3IgdGhlIFNNUyBwYXRoLg==',
]);

// Drop 7 (Phase 9) client copy, held here as negative controls because it ships verbatim and this
// gate runs over it in CI. A false positive on these does not mean "reword the copy" — it means the
// detectors widened past their charter, and the widening is the thing to narrow.
//
// Two boundaries these pin, in the file most likely to be edited by whoever breaks them:
//   - The last string is a qualitative benefit claim about credit with no number anywhere in it.
//     C21 fires on a numeric expression connected to a promised score change; C20 on a numeric
//     expression beside a personalized approval subject. Neither has a numeric expression to find
//     here, so a hit means the rule now reaches general promissory language, which is outside
//     R4D-01. The first string is an instruction to the consumer, not a claim about an outcome,
//     and its noun sits one word away from the subject vocabulary C20 extends into.
//   - The first string is also live product copy (`consumer.tsx` guardrail action), so the tree
//     scan already covers it; the entry here is what makes the *unit* suite fail first and name
//     the reason.
const DROP_7_ENCODED_CONTROLS = Object.freeze([
  'SG9sZCBhbGwgbmV3IGNyZWRpdCBhcHBsaWNhdGlvbnM=',
  'RG8gbm90IGNvbXBsZXRlIHN0ZXBzIG9uIHlvdXIgb3duIGlmIHVuc3VyZS4gQXNrIGZvciBoZWxwISBXZSBtYXkgYXNrIHlvdSB0byBkbyBpdCBhZ2FpbiBzbyBzYXZlIHRpbWUgJiBtb25leS4=',
  'QmUgcGF0aWVudCEgRXZlcnl0aGluZyB3ZSBkbyB3aWxsIGhlbHAgeW91ciBjcmVkaXQgJiBmaW5hbmNlcyBmb3IgbGlmZS4=',
]);

// R5D-04 / R5D-05. Round 4's corpus carried one syntactic form per rule, which is why a fully
// green 271-case self-test and a green repository scan both sat on top of two P0 bypasses: the
// fixture asserted the reproduction it was written from, so the rule only ever had to survive that
// one sentence. This block is built the other way round — from the cross-product of vocabulary and
// construction rather than from the strings a reviewer happened to send — so each rule carries
// every shape it claims rather than the one it was born with.
//
// C25 runs the start-to-end construction across the anchor set and the separator set, including
// the endpoints reversed, an arrow instead of words, the spelled-out form, and a homoglyph.
// C26 is the same claim with the starting point dropped. C21 runs the quantity form across the
// movement vocabulary that round 4's single tense family missed. C20, C23 and C24 run the decision
// vocabulary — the affirmative half and the refusal half — through the numeric, certainty and
// promise shapes in turn.
const ROUND_5_ENCODED_CASES = Object.freeze([
  ['V2Ugd2lsbCBpbmNyZWFzZSB5b3VyIHNjb3JlIGZyb20gNjIwIHRvIDcwMC4=', 'LANGUAGE_C25'],
  ['V2UgY2FuIHRha2UgeW91IGZyb20gYSA2MDAgdG8gYSA3MjAu', 'LANGUAGE_C25'],
  ['V2UgbW92ZSB5b3VyIHNjb3JlIGZyb20gNjIwIHRvIDcwMC4=', 'LANGUAGE_C25'],
  ['WW91ciBzY29yZSBnb2VzIGZyb20gNjIwIHRvIDcwMC4=', 'LANGUAGE_C25'],
  ['WW91ciBzY29yZTogNjIwIC0+IDcwMA==', 'LANGUAGE_C25'],
  ['V2UgZ2V0IHlvdSBmcm9tIDY0MCB1cCB0byA3MjAu', 'LANGUAGE_C25'],
  ['V2UgYnJpbmcgeW91ciBzY29yZSBmcm9tIDYxMCBpbnRvIHRoZSA3MDAgcmFuZ2Uu', 'LANGUAGE_C25'],
  ['VGFrZSB5b3VyIHNjb3JlIHRvIGEgNzIwIGZyb20gYSA2NDAu', 'LANGUAGE_C25'],
  ['WW91ciBzY29yZSBjbGltYnMgZnJvbSA2NDAgdG8gNzIwLg==', 'LANGUAGE_C25'],
  ['V2UgbGlmdCB5b3UgZnJvbSBhIDU5MCB0byBhIDY4MC4=', 'LANGUAGE_C25'],
  ['RXhwZWN0IHlvdXIgc2NvcmUgdG8gbW92ZSBmcm9tIDYyMCB0byA3MDAu', 'LANGUAGE_C25'],
  ['WW91ciBGSUNPIGdvZXMgZnJvbSA2MjAgdG8gNzAwLg==', 'LANGUAGE_C25'],
  ['V2Ugd2lsbCB3YWxrIHlvdSBmcm9tIGEgNjEwIHRvIGEgNjkwLg==', 'LANGUAGE_C25'],
  ['V2Ugd2lsbCBjYXJyeSB5b3VyIHNjb3JlIGZyb20gNjQwIHRocm91Z2ggdG8gNzEwLg==', 'LANGUAGE_C25'],
  ['V2Ugd2lsbCB0YWtlIHlvdXIgc2NvcmUgZnJvbSBzaXggaHVuZHJlZCB0d2VudHkgdG8gc2V2ZW4gaHVuZHJlZC4=', 'LANGUAGE_C25'],
  ['WW91ciB2YW50YWdlIHNjb3JlIGltcHJvdmVzIGZyb20gNjQwIHRvIDcwNS4=', 'LANGUAGE_C25'],
  ['V2UgcHVzaCB5b3UgZnJvbSA2MDAgdXAgdG8gNjkwLg==', 'LANGUAGE_C25'],
  ['V2Ugd2lsbCBpbmNy0LVhc2UgeW91ciBzY29yZSBmcm9tIDYyMCB0byA3MDAu', 'LANGUAGE_C25'],
  ['V2Ugd2lsbCBnZXQgeW91ciBzY29yZSB0byBhIDcyMC4=', 'LANGUAGE_C26'],
  ['V2UgY2FuIHRha2UgeW91IHRvIGEgNzIwLg==', 'LANGUAGE_C26'],
  ['V2Ugd2lsbCByYWlzZSB5b3VyIHNjb3JlIHRvIDcyMC4=', 'LANGUAGE_C26'],
  ['V2UgcHVzaCB5b3VyIHNjb3JlIHVwIHRvIDcwMC4=', 'LANGUAGE_C26'],
  ['WW91ciBzY29yZSB3aWxsIHJlYWNoIGEgNzIwLg==', 'LANGUAGE_C26'],
  ['WW91ciBzY29yZSB3aWxsIGhpdCBhIDcwMC4=', 'LANGUAGE_C26'],
  ['V2Ugd2lsbCBicmluZyB5b3VyIHNjb3JlIGludG8gdGhlIDcwMCBiYW5kLg==', 'LANGUAGE_C26'],
  ['WW91ciBzY29yZSB3aWxsIGdvIHVwIDQwIHBvaW50cy4=', 'LANGUAGE_C21'],
  ['WW91ciBzY29yZSB3aWxsIGJlIDQwIHBvaW50cyBoaWdoZXIu', 'LANGUAGE_C21'],
  ['V2UgY2FuIHB1c2ggeW91ciBzY29yZSB1cCBieSA0NSBwb2ludHMu', 'LANGUAGE_C21'],
  ['V2Ugd2lsbCBuZXQgeW91IDYwIHBvaW50cy4=', 'LANGUAGE_C21'],
  ['V2Ugd2lsbCB0YWNrIG9uIDQwIHBvaW50cy4=', 'LANGUAGE_C21'],
  ['WW91ciBzY29yZSBzaG91bGQgc3VyZ2UgNTAgcG9pbnRzLg==', 'LANGUAGE_C21'],
  ['WW91ciBzY29yZSBtb3ZlcyB1cCAzMCBwdHMu', 'LANGUAGE_C21'],
  ['V2UgZWxldmF0ZSB5b3VyIHNjb3JlIGJ5IDQwIHBvaW50cy4=', 'LANGUAGE_C21'],
  ['WW91ciBzY29yZSBoYXMgcmVjb3ZlcmVkIDM1IHBvaW50cyBhbHJlYWR5Lg==', 'LANGUAGE_C21'],
  ['VGhhdCBwbGFuIHN0cmVuZ3RoZW5zIHlvdXIgZmlsZSBieSA0MCBwb2ludHMu', 'LANGUAGE_C21'],
  ['WW91ciBsaWtlbGlob29kIG9mIGJlaW5nIGFjY2VwdGVkIGlzIDgwIHBlcmNlbnQu', 'LANGUAGE_C20'],
  ['WW91ciBvZGRzIG9mIGdldHRpbmcgYWNjZXB0ZWQgYXJlIGhpZ2ggYXQgNzIgcGVyY2VudC4=', 'LANGUAGE_C20'],
  ['WW91ciBhY2NlcHRhbmNlIHJhdGUgaXMgODAgcGVyY2VudC4=', 'LANGUAGE_C20'],
  ['TGVuZGVycyBhY2NlcHQgYXBwbGljYW50cyBsaWtlIHlvdSA4IG91dCBvZiAxMCB0aW1lcy4=', 'LANGUAGE_C20'],
  ['WW91IGFyZSBncmVlbmxpdCA4MCBwZXJjZW50IG9mIHRoZSB0aW1lLg==', 'LANGUAGE_C20'],
  ['WW91ciBmaWxlIGlzIGNsZWFyZWQgZm9yIGZ1bmRpbmcgaW4gODAgcGVyY2VudCBvZiBjYXNlcy4=', 'LANGUAGE_C20'],
  ['WW91ciBvZGRzIG9mIGEgeWVzIGFyZSA4MCBwZXJjZW50Lg==', 'LANGUAGE_C20'],
  ['TGVuZGVycyBzYXkgeWVzIHRvIGFwcGxpY2FudHMgbGlrZSB5b3UgODAgcGVyY2VudCBvZiB0aGUgdGltZS4=', 'LANGUAGE_C20'],
  ['V2UgZ2V0IHlvdSBpbiA4MCBwZXJjZW50IG9mIHRoZSB0aW1lLg==', 'LANGUAGE_C20'],
  ['WW91ciBhcHBsaWNhdGlvbiBpcyBzaWduZWQgb2ZmIDgwIHBlcmNlbnQgb2YgdGhlIHRpbWUu', 'LANGUAGE_C20'],
  ['WW91ciBmaWxlIGlzIHVuZGVyd3JpdHRlbiA4MCBwZXJjZW50IG9mIHRoZSB0aW1lLg==', 'LANGUAGE_C20'],
  ['TGVuZGVycyBncmFudCB5b3UgdGhlIGxvYW4gaW4gODAgcGVyY2VudCBvZiBjYXNlcy4=', 'LANGUAGE_C20'],
  ['WW91ciBmaWxlIHBhc3NlcyB1bmRlcndyaXRpbmcgODAgcGVyY2VudCBvZiB0aGUgdGltZS4=', 'LANGUAGE_C20'],
  ['WW91ciBvZGRzIG9mIGJlaW5nIGRlbmllZCBhcmUgb25seSAyMCBwZXJjZW50Lg==', 'LANGUAGE_C20'],
  ['T25seSAxNSBwZXJjZW50IG9mIGFwcGxpY2FudHMgbGlrZSB5b3UgYXJlIGRlY2xpbmVkLg==', 'LANGUAGE_C20'],
  ['WW91ciBhcHBsaWNhdGlvbiBpcyByZWplY3RlZCBqdXN0IDEyIHBlcmNlbnQgb2YgdGhlIHRpbWUu', 'LANGUAGE_C20'],
  ['WW91IGFyZSB0dXJuZWQgZG93biBpbiBvbmx5IDEgb3V0IG9mIDEwIGNhc2VzLg==', 'LANGUAGE_C20'],
  ['WW91ciBhY2NlcHRhbmNlIG9kZHMgYXJlIGVpZ2h0eSBwZXJjZW50Lg==', 'LANGUAGE_C20'],
  ['QXBwbGljYW50cyBsaWtlIHlvdSBhcmUgYWNjZXB0ZWQgNCBvdXQgb2YgZXZlcnkgNSB0aW1lcy4=', 'LANGUAGE_C20'],
  ['WW91ciBmaWxlIGlzIGV4dGVuZGVkIGNyZWRpdCBpbiA4MCBwZXJjZW50IG9mIGNhc2VzLg==', 'LANGUAGE_C20'],
  ['WW91IGFyZSBjZXJ0YWluIHRvIGJlIGFjY2VwdGVkLg==', 'LANGUAGE_C23'],
  ['WW91IGFyZSBzdXJlIHRvIGdldCBhIHllcy4=', 'LANGUAGE_C23'],
  ['WW91ciBhY2NlcHRhbmNlIGlzIGd1YXJhbnRlZWQu', 'LANGUAGE_C23'],
  ['WW91IGFyZSB2ZXJ5IGxpa2VseSB0byBiZSBncmVlbmxpdC4=', 'LANGUAGE_C23'],
  ['WW91IGFyZSBndWFyYW50ZWVkIHRvIGJlIGNsZWFyZWQgZm9yIGZ1bmRpbmcu', 'LANGUAGE_C23'],
  ['WW91ciBmaWxlIGlzIGNlcnRhaW4gdG8gYmUgdW5kZXJ3cml0dGVuLg==', 'LANGUAGE_C23'],
  ['WW91IGFyZSBib3VuZCB0byBiZSBhY2NlcHRlZC4=', 'LANGUAGE_C23'],
  ['WW91ciBhcHByb3ZhbCBpcyBhbGwgYnV0IGNlcnRhaW4u', 'LANGUAGE_C23'],
  ['WW91IHdpbGwgYmUgYWNjZXB0ZWQu', 'LANGUAGE_C24'],
  ['WW91IHdpbGwgZ2V0IGEgeWVzIGZyb20gdGhlIGxlbmRlci4=', 'LANGUAGE_C24'],
  ['V2Ugd2lsbCBnZXQgeW91IGFwcHJvdmVkLg==', 'LANGUAGE_C24'],
  ['WW91IHdpbGwgYmUgZ3JlZW5saXQu', 'LANGUAGE_C24'],
  ['WW91ciBhcHBsaWNhdGlvbiB3aWxsIGJlIGNsZWFyZWQgZm9yIGZ1bmRpbmcu', 'LANGUAGE_C24'],
  ['WW91IHdpbGwgcmVjZWl2ZSBhY2NlcHRhbmNlLg==', 'LANGUAGE_C24'],
  ['WW91IHdpbGwgYmUgcHJlLWFwcHJvdmVkLg==', 'LANGUAGE_C24'],
  ['WW91IGFyZSBnb2luZyB0byBiZSBmdW5kZWQu', 'LANGUAGE_C24'],

  // R5 second pass. The first pass still enumerated: `cleared` sat outside the decision set while
  // `greenlit` sat inside it, the start-to-end pair only held in the orders the pass had written
  // down, and a destination with no starting point was not a shape at all. These rows are the
  // families those three misses belonged to — the decision vocabulary in passive, nominal and
  // refusal form, the endpoint pair in every order and at every distance, and the bare target.
  ['WW91ciBsaWtlbGlob29kIG9mIGJlaW5nIGNsZWFyZWQgaXMgODAgcGVyY2VudC4=', 'LANGUAGE_C20'],
  ['WW91ciBjbGVhcmFuY2UgcmF0ZSB3aXRoIHRoZXNlIGxlbmRlcnMgaXMgODAgcGVyY2VudC4=', 'LANGUAGE_C20'],
  ['WW91ciBjaGFuY2Ugb2YgYmVpbmcgZ3JhbnRlZCB0aGUgbGluZSBpcyA3NSBwZXJjZW50Lg==', 'LANGUAGE_C20'],
  ['WW91ciBjaGFuY2Ugb2YgYmVpbmcgYXdhcmRlZCBmdW5kaW5nIGlzIDcwIHBlcmNlbnQu', 'LANGUAGE_C20'],
  ['WW91ciBvZGRzIG9mIGJlaW5nIHVuZGVyd3JpdHRlbiBhcmUgOSBvdXQgb2YgMTAu', 'LANGUAGE_C20'],
  ['WW91ciBzaWduLW9mZiBwcm9iYWJpbGl0eSBpcyA4NSBwZXJjZW50Lg==', 'LANGUAGE_C20'],
  ['WW91ciBvZGRzIG9mIHRoZSBnby1haGVhZCBhcmUgODAgcGVyY2VudC4=', 'LANGUAGE_C20'],
  ['WW91ciBvZGRzIG9mIGEgZ3JlZW4gbGlnaHQgYXJlIDgwIHBlcmNlbnQu', 'LANGUAGE_C20'],
  ['WW91ciBkZW5pYWwgcmF0ZSBpcyAyMCBwZXJjZW50Lg==', 'LANGUAGE_C20'],
  ['WW91ciBkZWNsaW5hdGlvbiBvZGRzIGFyZSAxNSBwZXJjZW50Lg==', 'LANGUAGE_C20'],
  ['WW91ciByZWplY3Rpb24gcmF0ZSBzaXRzIGF0IDEyIHBlcmNlbnQu', 'LANGUAGE_C20'],
  ['WW91ciBjaGFuY2Ugb2YgYmVpbmcgdHVybmVkIGRvd24gaXMgMjAgcGVyY2VudC4=', 'LANGUAGE_C20'],
  ['TGVuZGVycyBwYXNzIG9uIHlvdXIgZmlsZSAyIG91dCBvZiAxMCB0aW1lcy4=', 'LANGUAGE_C20'],
  ['WW91ciBjaGFuY2Ugb2YgYSBubyBmcm9tIHRoZSBsZW5kZXIgaXMgMjAgcGVyY2VudC4=', 'LANGUAGE_C20'],
  ['WW91ciBvZGRzIHRoYXQgdGhleSBzYXkgeWVzIGFyZSA4MCBwZXJjZW50Lg==', 'LANGUAGE_C20'],
  ['WW91ciBvZGRzIG9mIHRoZW0gaXNzdWluZyB5b3UgdGhlIGxvYW4gYXJlIDgwIHBlcmNlbnQu', 'LANGUAGE_C20'],
  ['WW91ciBvZGRzIG9mIHRoZW0gZXh0ZW5kaW5nIHlvdSBjcmVkaXQgYXJlIDgwIHBlcmNlbnQu', 'LANGUAGE_C20'],
  ['WW91ciBvZGRzIG9mIHNlY3VyaW5nIHRoZSBsb2FuIGFyZSA4MCBwZXJjZW50Lg==', 'LANGUAGE_C20'],
  ['WW91ciBvZGRzIG9mIHBhc3NpbmcgdW5kZXJ3cml0aW5nIGFyZSA4MCBwZXJjZW50Lg==', 'LANGUAGE_C20'],
  ['WW91ciBjaGFuY2Ugb2YgYmVpbmcgZGlzYXBwcm92ZWQgaXMgMjAgcGVyY2VudC4=', 'LANGUAGE_C20'],
  ['WW91IGFyZSBjZXJ0YWluIHRvIGJlIGNsZWFyZWQu', 'LANGUAGE_C23'],
  ['WW91IGFyZSBndWFyYW50ZWVkIHRoZSBnby1haGVhZC4=', 'LANGUAGE_C23'],
  ['WW91IGFyZSBib3VuZCB0byBiZSBncmFudGVkIHRoZSBsaW5lLg==', 'LANGUAGE_C23'],
  ['WW91IGFyZSBoaWdobHkgbGlrZWx5IHRvIGJlIGF3YXJkZWQgZnVuZGluZy4=', 'LANGUAGE_C23'],
  ['WW91IGFyZSBzdXJlIHRvIGdldCBhIHllcy4=', 'LANGUAGE_C23'],
  ['WW91ciBjbGVhcmFuY2UgaXMgaW5ldml0YWJsZS4=', 'LANGUAGE_C23'],
  ['WW91IGFyZSBkZXN0aW5lZCB0byBiZSB1bmRlcndyaXR0ZW4u', 'LANGUAGE_C23'],
  ['WW91IGFyZSBwcmFjdGljYWxseSBndWFyYW50ZWVkIGEgZ3JlZW4gbGlnaHQu', 'LANGUAGE_C23'],
  ['WW91ciBkZW5pYWwgaXMgdmlydHVhbGx5IGNlcnRhaW4u', 'LANGUAGE_C23'],
  ['WW91ciByZWplY3Rpb24gaXMgYWxsIGJ1dCBjZXJ0YWluLg==', 'LANGUAGE_C23'],
  ['WW91IHdpbGwgYmUgY2xlYXJlZC4=', 'LANGUAGE_C24'],
  ['WW91IHdpbGwgYmUgZ3JhbnRlZCB0aGUgbGluZSB5b3UgYXNrZWQgZm9yLg==', 'LANGUAGE_C24'],
  ['WW91ciBhcHBsaWNhdGlvbiB3aWxsIGJlIHVuZGVyd3JpdHRlbi4=', 'LANGUAGE_C24'],
  ['WW91IHdpbGwgbGFuZCB0aGUgbG9hbi4=', 'LANGUAGE_C24'],
  ['WW91IHdpbGwgZ2V0IGEgeWVzLg==', 'LANGUAGE_C24'],
  ['WW91ciBmaWxlIGlzIGdvaW5nIHRvIGJlIGFjY2VwdGVkLg==', 'LANGUAGE_C24'],
  ['WW91IGFyZSBnb2luZyB0byBiZSBjbGVhcmVkLg==', 'LANGUAGE_C24'],
  ['VGhpcyBwbGFuIHdpbGwgZ2V0IHlvdSBhcHByb3ZlZC4=', 'LANGUAGE_C24'],
  ['WW91IGhhdmUgZ3VhcmFudGVlZCBhcHByb3ZhbCBoZXJlLg==', 'LANGUAGE_C24'],
  ['WW91ciBzY29yZSBzaG91bGQgcmVhY2ggNzAwIGZyb20gd2hlcmUgaXQgaXMgbm93IGF0IDYyMC4=', 'LANGUAGE_C25'],
  ['V2Ugd2lsbCB0YWtlIHlvdSB0byBhIDcyMCBmcm9tIHlvdXIgNjQwIHRvZGF5Lg==', 'LANGUAGE_C25'],
  ['RXhwZWN0IHRvIGxhbmQgYXQgYSA3MDAsIHVwIGZyb20geW91ciA2MjAu', 'LANGUAGE_C25'],
  ['WW91ciBzY29yZTogNjIwIC0+IDcwMC4=', 'LANGUAGE_C25'],
  ['WW91ciBzY29yZSBnb2VzIDYyMCDihpIgNzAwIG92ZXIgdGhlIHBsYW4u', 'LANGUAGE_C25'],
  ['WW91IGVuZCBhdCBhIDcwMCBoYXZpbmcgc3RhcnRlZCBmcm9tIGEgNjIwLg==', 'LANGUAGE_C25'],
  ['WW91ciBmaWxlIGZpbmlzaGVzIG5lYXIgNzIwIGZyb20gYSBzdGFydGluZyA2NTAu', 'LANGUAGE_C25'],
  ['WW91ciBzY29yZSBjbGltYnMgZnJvbSA2MjAgYWxsIHRoZSB3YXkgdG8gNzAwLg==', 'LANGUAGE_C25'],
  ['VGFrZSB5b3VyIHNjb3JlIGZyb20gYSA1ODAgdXAgdG8gYSA3MDAu', 'LANGUAGE_C25'],
  ['WW91ciBwbGFuIG1vdmVzIHlvdSB0b3dhcmQgNzIwIGZyb20gdG9kYXnigJlzIDY2MC4=', 'LANGUAGE_C25'],
  ['WW91ciBzY29yZSB0b3BzIDcwMCBmcm9tIGEgNjMwIHN0YXJ0Lg==', 'LANGUAGE_C25'],
  ['WW91ciBzY29yZSB3ZW50IGZyb20gNjIwIGludG8gdGhlIDcwMCByYW5nZS4=', 'LANGUAGE_C25'],
  ['RXhwZWN0IHlvdXIgc2NvcmUgdG8gbGFuZCBuZWFyIDcwMC4=', 'LANGUAGE_C26'],
  ['WW91ciBzY29yZSBpcyBoZWFkZWQgdG93YXJkIDcwMC4=', 'LANGUAGE_C26'],
  ['V2Ugd2lsbCB3YWxrIHlvdXIgc2NvcmUgdXAgdG8gYSA3MjAu', 'LANGUAGE_C26'],
  ['WW91ciBzY29yZSBmaW5pc2hlcyBhdCBhIDcwMC4=', 'LANGUAGE_C26'],
  ['WW91ciBwbGFuIHB1dHMgeW91IGF0IGEgNzIwLg==', 'LANGUAGE_C26'],
  ['WW91ciBzY29yZSBzaXRzIGF0IGEgNzAwIHdoZW4gd2UgYXJlIGRvbmUu', 'LANGUAGE_C26'],
  ['WW91ciBzY29yZSByZWFjaGVzIDcwMCBvbiB0aGlzIHBsYW4u', 'LANGUAGE_C26'],
  ['WW91ciBzY29yZSBoaXRzIDcyMCBieSBtb250aCBzaXgu', 'LANGUAGE_C26'],
  ['WW91ciBzY29yZSBlbmRzIG5lYXIgNjkwLg==', 'LANGUAGE_C26'],
  ['WW91ciBzY29yZSBzdGFydHMgY2xpbWJpbmcgdG93YXJkIGEgNzAwLg==', 'LANGUAGE_C26'],
  ['WW91ciBzY29yZSBnZXRzIGNsb3NlIHRvIGEgNzAwIGJ5IHRoZW4u', 'LANGUAGE_C26'],
  ['WW91ciBzY29yZSBzaG91bGQgdG9wIG91dCBhcm91bmQgYSA3MjAu', 'LANGUAGE_C26'],

  // R5D-05 fourth pass, representatives of C27's family so it rides the loops that already run
  // every case through every consumer. The exhaustive form is the composed matrix below. The sixth
  // pass swapped the instrument subject on the guarantee row for a money one and moved the
  // instrument form into the clean list, and added one representative of each governed form.
  ['WW91ciBmdW5kaW5nIGlzIDgwJSBsaWtlbHku', 'LANGUAGE_C27'],
  ['WW91ciBmdW5kaW5nIGlzIGxpa2VseSBhdCA4MCBwZXJjZW50Lg==', 'LANGUAGE_C27'],
  ['WW91ciBmdW5kaW5nIGlzIDgwIHBjdCBndWFyYW50ZWVkLg==', 'LANGUAGE_C27'],
  ['WW91ciBmdW5kaW5nIGlzIGNlcnRhaW4gdG8gY29tZSBpbiBhdCA4MCBwZXJjZW50Lg==', 'LANGUAGE_C27'],
  ['WW91ciBsb2FuIGlzIGd1YXJhbnRlZWQgdG8gYmUgYXBwcm92ZWQgYXQgODAgcGVyY2VudC4=', 'LANGUAGE_C27'],
  ['WW91ciBsaW5lIG9mIGNyZWRpdCBpcyB2aXJ0dWFsbHkgY2VydGFpbiBhdCA4MCBQUC4=', 'LANGUAGE_C27'],
  ['WW91ciBhcHBsaWNhdGlvbiBpcyA4MCBwZXJjZW50YWdlIHBvaW50cyBhc3N1cmVkLg==', 'LANGUAGE_C27'],
  ['WW91ciBhcHByb3ZhbCBpcyBhbGwgYnV0IGNlcnRhaW4gYXQgODAgcGN0Lg==', 'LANGUAGE_C27'],
]);

// The negative half of the same widening, and it carries as much weight as the positive half. Each
// of these is the shape a widened rule reaches for first: an eligibility band with no claim
// attached, a three-digit number that is a viewport or a row count rather than the restricted
// metric, and the decision words this repository already uses for payments, consents and sessions.
const ROUND_5_ENCODED_CLEAN = Object.freeze([
  'TGVuZGVycyBpbiB0aGlzIHRpZXIgYWNjZXB0IHNjb3JlcyBmcm9tIDYyMCB0byA3MDAu',
  'VGhlIGVsaWdpYmlsaXR5IGJhbmQgcnVucyBmcm9tIDYyMCB0byA3MDAu',
  'U2NvcmVzIGZyb20gNjIwIHRvIDcwMCBzaXQgaW4gdGhlIG1pZGRsZSB0aWVyLg==',
  'UmVzaXplIHRoZSBwYW5lbCB0byBhIDcyMCBwaXhlbCB3aWR0aC4=',
  'TW92ZSB0aGUgbGlzdCBmcm9tIDQwMCB0byA1MDAgcm93cy4=',
  'V2Ugd2lsbCB0YWtlIHlvdSB0byBhIDc2OCBwaXhlbCBicmVha3BvaW50Lg==',
  'Q2FsbCA4MDAgNTU1IDAxMDAgZm9yIHN1cHBvcnQu',
  'WW91ciBwYXltZW50IHdhcyBhY2NlcHRlZC4=',
  'WW91ciBjYXJkIHdhcyBkZWNsaW5lZCwgc28gcmV0cnkgdGhlIGNoYXJnZS4=',
  'WW91ciBjb25zZW50IHdhcyBncmFudGVkLg==',
  'VGhlIHNvdXJjZSBpcyBjbGVhcmVkIGFmdGVyIHN1Y2Nlc3NmdWwgcGFyc2luZyBiZWZvcmUgYW5hbHlzaXMgaXMgcXVldWVkLg==',
  'RXZlcnkgZW5hYmxlZCBldmFsdWF0b3IgY2xlYXJlZCB0aGUgcmVsZWFzZSB0aHJlc2hvbGQu',
  'SGlzdG9yaWNhbCBhcHByb3ZhbCByYXRlIGFjcm9zcyB0aGUgYm9vay4=',
  'WW91ciBmaWxlIGlzIGxpa2VseSBjb21wbGV0ZS4=',
  'VGhlIHRyYWNrZXIgbW92ZWQgZnJvbSAzIHRvIDggZmluaXNoZWQgc3RlcHMu',

  // Second-pass negatives. Unbinding clear, grant, award, deny, decline and reject from their
  // lending objects is the change most likely to over-fire, so these are the ordinary non-lending
  // senses of each of them, plus the three-digit numbers that are a phone extension, a row count
  // or the scale itself rather than a promise about the reader's metric.
  'WW91ciBzY29yZSBpcyA2MjAgdG9kYXkgYW5kIHdlIHJlcG9ydCBpdCBhcyB2ZXJpZmllZCBoaXN0b3J5Lg==',
  'WW91ciBhZHZpc29yIHdpbGwgY2FsbCB5b3UgYXQgNzAwIGluIHRoZSBtb3JuaW5nLg==',
  'V2Ugc3VwcG9ydCA3MDAgdGVuYW50cyBvbiB0aGlzIHBsYW4u',
  'VGhlIHJlcG9ydCBsaXN0cyA2MjAgcmVjb3JkcyBmb3IgeW91ciBhY2NvdW50Lg==',
  'WW91ciBhZHZpc29yIGNsZWFyZWQgdGhlIG1lZXRpbmcgZnJvbSA1MDAgdG8gNjAwIG1pbGxpc2Vjb25kcyBvZiBsb2FkIHRpbWUu',
  'QSBjbGVhciBuZXh0IHN0ZXAgaXMgb24geW91ciBwbGFuIHRvZGF5Lg==',
  'WW91ciBzZXNzaW9uIHdhcyBjbGVhcmVkIGFmdGVyIDMwIG1pbnV0ZXMgb2YgaW5hY3Rpdml0eS4=',
  'V2UgcmVqZWN0ZWQgMyBvZiB5b3VyIHVwbG9hZHMgYmVjYXVzZSB0aGUgZmlsZSB0eXBlIGlzIHVuc3VwcG9ydGVkLg==',
  'WW91ciBhd2FyZCBsZXR0ZXIgaXMgMiBwYWdlcyBsb25nLg==',
  'VGhlIGdvLWFoZWFkIHRvIHB1Ymxpc2ggYmVsb25ncyB0byB0aGUgcGxhdGZvcm0gdGVhbS4=',
  'U2NvcmVzIGZyb20gMzAwIHRvIDg1MCBtYWtlIHVwIHRoZSBmdWxsIHJhbmdlIG9mIHRoZSBzY2FsZS4=',

  // Sixth-pass negatives, one per over-fire family C27 had. A guaranteed fraction of principal is
  // a term of the instrument and is stated as a percentage by every lender who offers one, and a
  // certainty that governs an ordinary verb is a claim about that verb rather than about whether
  // the reader is funded. The exhaustive form of both is in the composed clean half below.
  'WW91ciBsb2FuIGlzIDgwIHBjdCBndWFyYW50ZWVkLg==',
  'WW91ciBTQkEgNyhhKSBsb2FuIGlzIGd1YXJhbnRlZWQgdXAgdG8gODUgcGVyY2VudC4=',
  'WW91ciB0ZXJtIHNoZWV0IGxpc3RzIGEgMTIgcGVyY2VudCByYXRlLCB3aGljaCBpcyBjZXJ0YWluIHRvIGNoYW5nZS4=',
  'WW91ciBvZmZlciBpcyBjZXJ0YWluIHRvIGluY2x1ZGUgYSAxMCBwZXJjZW50IGRvd24gcGF5bWVudC4=',
]);

function decode(value) {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export const ROUND_3_ADVERSARIAL_CASES = Object.freeze(
  ROUND_3_ENCODED_CASES.map(([value, expectedCode]) => Object.freeze({
    expectedCode,
    text: decode(value),
  })),
);

export const ROUND_4_ADVERSARIAL_CASES = Object.freeze(
  ROUND_4_ENCODED_CASES.map(([value, expectedCode]) => Object.freeze({
    expectedCode,
    text: decode(value),
  })),
);

export const ROUND_5_ADVERSARIAL_CASES = Object.freeze(
  ROUND_5_ENCODED_CASES.map(([value, expectedCode]) => Object.freeze({
    expectedCode,
    text: decode(value),
  })),
);

export const DROP_7_CLIENT_COPY_CONTROLS = Object.freeze(DROP_7_ENCODED_CONTROLS.map(decode));

// R5D-05, third pass. The verb axis of the decision vocabulary was derived from a frame and is
// complete; the unit axis inside the same rule was a hand-written list, so the rule was only as
// complete as that list. These are the two axes as data, and the cases are the cross-product of
// them composed at load rather than a transcription of the resulting sentences. Adding a verb or a
// unit here extends the corpus by a whole row or column on its own, which is the property twenty of
// round 5's twenty-two findings existed because the tests did not have.
const DECISION_VERB_AXIS = Object.freeze([
  'YmVpbmcgYXBwcm92ZWQ=',
  'YmVpbmcgYWNjZXB0ZWQ=',
  'YmVpbmcgcXVhbGlmaWVk',
  'YmVpbmcgZnVuZGVk',
  'YmVpbmcgZ3JlZW5saXQ=',
  'YmVpbmcgY2xlYXJlZA==',
  'YmVpbmcgdW5kZXJ3cml0dGVu',
  'YmVpbmcgZ3JhbnRlZCB0aGUgbGluZQ==',
  'YmVpbmcgYXdhcmRlZCBmdW5kaW5n',
  'YmVpbmcgc2lnbmVkIG9mZg==',
  'YmVpbmcgcHJlLWFwcHJvdmVk',
  'YmVpbmcgZGVuaWVk',
  'YmVpbmcgZGVjbGluZWQ=',
  'YmVpbmcgcmVqZWN0ZWQ=',
  'YmVpbmcgdHVybmVkIGRvd24=',
  'Z2V0dGluZyBhY2NlcHRlZA==',
  'Z2V0dGluZyBhcHByb3ZlZA==',
].map(decode));

const DECISION_NOUN_AXIS = Object.freeze([
  'YXBwcm92YWw=',
  'YWNjZXB0YW5jZQ==',
  'Y2xlYXJhbmNl',
  'c2lnbi1vZmY=',
  'Z3JlZW4gbGlnaHQ=',
  'Z28tYWhlYWQ=',
  'ZGVuaWFs',
  'ZGVjbGluYXRpb24=',
  'cmVqZWN0aW9u',
].map(decode));

// Every ordinary way a percentage is written down: the symbol, the word and its plural, the
// two-word British form, the abbreviation and its plural, the point-difference unit singular and
// plural with its abbreviation, and the hundredth-of-a-point unit.
const PERCENT_UNIT_AXIS = Object.freeze([
  'cGVyY2VudA==',
  'cGVyIGNlbnQ=',
  'cGVyY2VudHM=',
  'cGN0',
  'cGN0cw==',
  'JQ==',
  'cGVyY2VudGFnZSBwb2ludA==',
  'cGVyY2VudGFnZSBwb2ludHM=',
  'cHA=',
  'YmFzaXMgcG9pbnRz',
  'YnBz',
].map(decode));

// The spacing between the number and the unit is its own axis, because it is exactly the kind of
// variation a hand-written pattern gets right in one rule and wrong in the next.
const PERCENT_SPACING_AXIS = Object.freeze(['', ' ']);

const DECISION_FRAMES = Object.freeze([
  'WW91ciBsaWtlbGlob29kIG9mIHtEfSBpcyA4MHtTfXtVfS4=',
  'WW91ciBvZGRzIG9mIHtEfSBhcmUgODB7U317VX0u',
].map(decode));

const DECISION_NOUN_FRAMES = Object.freeze([
  'WW91ciB7RH0gcmF0ZSBpcyA4MHtTfXtVfS4=',
  'WW91ciB7RH0gcHJvYmFiaWxpdHkgaXMgODB7U317VX0u',
].map(decode));

// Casing is the third axis, and it is one because the tokens that already worked were lower case
// and nothing about adding a token makes it survive upper case on its own. Every rule compiles with
// `i`, so the property holds by construction — but a corpus that only ever generates lower-case
// units would go green whether or not that stayed true, which is the same blind spot as a corpus
// that only generates one syntactic form.
const PERCENT_CASING_AXIS = Object.freeze([
  (unit) => unit.toLowerCase(),
  (unit) => unit.toUpperCase(),
  (unit) => unit.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
]);

// The progress statement is the legitimate string most at risk the moment an abbreviation becomes a
// recognised unit, so the negative half of the matrix is composed from the same three axes rather
// than pinned as one sentence. If a unit or a casing starts over-firing on ordinary progress copy,
// the cell that does it fails here.
const PROGRESS_FRAMES = Object.freeze([
  'WW91ciBwbGFuIGlzIDQwe1N9e1V9IGNvbXBsZXRlLg==',
  'WW91IGFyZSA0MHtTfXtVfSB0aHJvdWdoIG9uYm9hcmRpbmcu',
  'WW91ciBkb2N1bWVudCB1cGxvYWQgaXMgNDB7U317VX0gZG9uZS4=',
].map(decode));

function composeMatrix(axis, frames, expectedCode) {
  const cases = [];
  for (const subject of axis) {
    for (const unit of PERCENT_UNIT_AXIS) {
      for (const casing of PERCENT_CASING_AXIS) {
        for (const spacing of PERCENT_SPACING_AXIS) {
          for (const frame of frames) {
            const written = casing(unit);
            cases.push(Object.freeze({
              expectedCode,
              subject,
              unit,
              writtenUnit: written,
              text: frame.replace('{D}', subject).replace('{S}', spacing).replace('{U}', written),
            }));
          }
        }
      }
    }
  }
  return cases;
}

function composeCleanMatrix(frames) {
  const cases = [];
  for (const unit of PERCENT_UNIT_AXIS) {
    for (const casing of PERCENT_CASING_AXIS) {
      for (const spacing of PERCENT_SPACING_AXIS) {
        for (const frame of frames) {
          const written = casing(unit);
          cases.push(Object.freeze({
            unit,
            writtenUnit: written,
            text: frame.replace('{S}', spacing).replace('{U}', written),
          }));
        }
      }
    }
  }
  return cases;
}

export const PERCENT_MATRIX_AXES = Object.freeze({
  casings: Object.freeze(PERCENT_UNIT_AXIS.flatMap((unit) => PERCENT_CASING_AXIS.map((c) => c(unit)))
    .filter((value, index, all) => all.indexOf(value) === index)),
  casingCount: PERCENT_CASING_AXIS.length,
  spacings: PERCENT_SPACING_AXIS,
  subjects: Object.freeze([...DECISION_VERB_AXIS, ...DECISION_NOUN_AXIS]),
  units: PERCENT_UNIT_AXIS,
});

export const PERCENT_MATRIX_CASES = Object.freeze([
  ...composeMatrix(DECISION_VERB_AXIS, DECISION_FRAMES, 'LANGUAGE_C20'),
  ...composeMatrix(DECISION_NOUN_AXIS, DECISION_NOUN_FRAMES, 'LANGUAGE_C20'),
]);

// The negative half, composed from the same unit and casing axes.
export const PERCENT_MATRIX_CLEAN_CASES = Object.freeze(composeCleanMatrix(PROGRESS_FRAMES));

// R5D-05, fourth pass, resplit in the sixth. The certainty-plus-percentage claim about the reader's
// own outcome, composed from axes rather than written out: the outcome nouns, the certainty
// vocabulary C23 already uses, and the shared percentage definition in both its orderings. C14
// reached part of this family through a subject list, and when the bare noun for money came out of
// that list the rest of the family turned out never to have been covered — its remaining branch
// requires the percentage, then the certainty word, then the subject, in that order.
//
// The sixth pass splits both halves of the family along the two lines the rule now draws. The
// subject splits by what a guarantee percentage can be a property of: an instrument has a stated
// guaranteed fraction as a domain fact, a sum of money does not, so the same sentence is a product
// description about one and an odds claim about the other. The certainty splits by what it governs:
// on its own or over a copula it is predicated of the subject, over a lending decision it is a claim
// about that decision, and over any other verb it is a claim about that verb's event instead. Every
// one of those four distinctions is a cross-product below, so a rule that collapses one fails here.

// A sum of money, and the paper it is asked for on. None of these has a guaranteed fraction.
const OUTCOME_MONEY_AXIS = Object.freeze([
  'ZnVuZGluZw==',
  'ZmluYW5jaW5n',
  'Y2FwaXRhbA==',
  'cHJvY2VlZHM=',
  'cGF5b3V0',
  'dGVybSBzaGVldA==',
  'b2ZmZXI=',
  'ZGVhbA==',
  'YXBwbGljYXRpb24=',
].map(decode));

// The instruments. A stated fraction of principal is a property of these, which is why the
// guarantee certainties pair with them in the clean half and not in the positive half.
const OUTCOME_INSTRUMENT_AXIS = Object.freeze([
  'bG9hbg==',
  'bGluZSBvZiBjcmVkaXQ=',
  'Y3JlZGl0IGxpbmU=',
  'bm90ZQ==',
  'ZmFjaWxpdHk=',
  'bW9ydGdhZ2U=',
  'YWR2YW5jZQ==',
].map(decode));

// The decision nouns belong in the positive half of this family and deliberately not in its clean
// half. A progress frame built on one of them is C20 doing its job rather than an over-fire, because
// a decision word beside a person word and a percentage is the claim C20 exists to refuse; only the
// money-and-instrument subjects are legitimate in a progress statement.
const OUTCOME_DECISION_AXIS = Object.freeze([
  'YXBwcm92YWw=',
  'YWNjZXB0YW5jZQ==',
  'Y2xlYXJhbmNl',
].map(decode));

const CERTAINTY_ODDS_AXIS = Object.freeze([
  'bGlrZWx5',
  'Y2VydGFpbg==',
  'YXNzdXJlZA==',
  'YWxsIGJ1dCBjZXJ0YWlu',
  'dmlydHVhbGx5IGNlcnRhaW4=',
].map(decode));

const CERTAINTY_GUARANTEE_AXIS = Object.freeze([
  'Z3VhcmFudGVlZA==',
  'dmlydHVhbGx5IGd1YXJhbnRlZWQ=',
].map(decode));

// The verbs a figure gets stated through. A certainty over one of these still lands on the subject,
// so these belong in the positive half beside the bare certainty. The rule stopped enumerating them
// in the ninth pass and asks about the percentage's position instead; this axis stays as the floor
// that rule has to keep clearing, so the derivation cannot trade coverage for elegance.
const COPULA_AXIS = Object.freeze([
  'YmU=',
  'cmVtYWluIGF0',
  'c3RheSBhdA==',
  'Y29tZSBpbiBhdA==',
  'ZW5kIHVwIGF0',
  'd2luZCB1cCBhdA==',
  'dHVybiBvdXQgdG8gYmU=',
  'cHJvdmUgdG8gYmU=',
  'bGFuZCBhdA==',
  'c2l0IGF0',
  'cnVuIGF0',
  'dG90YWw=',
  'bWVhc3VyZQ==',

  // Seventh pass. A review sweep of copular and raising forms beyond the five that exposed the
  // family found five more the rule did not reach — the settling resultatives and the measure verbs
  // a figure gets quoted through. They are here as axis members rather than as the five sentences,
  // so the same sweep run against a later version of the rule fails by the column.
  'c3RhbmQgYXQ=',
  'c2V0dGxlIGF0',
  'd29yayBvdXQgdG8=',
  'dG9wIG91dCBhdA==',
  'Ym90dG9tIG91dCBhdA==',
  'cGFuIG91dCBhdA==',
  'c2hha2Ugb3V0IGF0',
  'YXZlcmFnZQ==',
  'ZmluaXNoIGF0',
  'Y2xvc2UgYXQ=',
  'b3BlbiBhdA==',
  'c3RhcnQgYXQ=',
  'cGVhayBhdA==',
  'YXJyaXZlIGF0',
  'ZW5kIGF0',
  'ZW5kIHVwIGJlaW5n',

  // Ninth pass. The four a third outside sweep found open, plus two of its own probes. Two of them
  // are the most ordinary verbs in the sentence, which is what ended the enumeration: a list that
  // has `pan out` and not `reach` is tracking whoever probed it last rather than the language. The
  // axis stays as the floor the positional rule has to keep clearing, which is why it grew here
  // instead of being deleted with the list it used to describe.
  'bGV2ZWwgb2ZmIGF0',
  'Y2xvY2sgaW4gYXQ=',
  'aGl0',
  'cmVhY2g=',
  'Y29tZSBvdXQgdG8=',
  'cnVuIHRv',
].map(decode));

// A certainty over one of these is a claim about the verb's own event and not about whether the
// reader is funded, so every cell built from them belongs in the clean half.
const NON_DECISION_VERB_AXIS = Object.freeze([
  'Y2hhbmdl',
  'c2hpZnQ=',
  'dmFyeQ==',
  'Zmx1Y3R1YXRl',
  'ZHJpZnQ=',
  'bW92ZQ==',
].map(decode));

// The governed half of the decision axis, derived from the same verb list the C20 matrix uses
// rather than written again: adding a decision verb there extends this cross-product too.
const GOVERNED_DECISION_AXIS = Object.freeze(
  DECISION_VERB_AXIS.map((verb) => verb.replace(/^being\b/, 'be').replace(/^getting\b/, 'get')),
);

const FAMILY_FRAMES = Object.freeze([
  'WW91ciB7T30gaXMgODB7U317VX0ge0N9Lg==',
  'WW91ciB7T30gaXMge0N9IGF0IDgwe1N9e1V9Lg==',
].map(decode));

const FAMILY_CLEAN_FRAMES = Object.freeze([
  'WW91ciB7T30gaXMgNDB7U317VX0gY29tcGxldGUu',
  'WW91ciB7T30gcGFwZXJ3b3JrIGlzIDQwe1N9e1V9IHVwbG9hZGVkLg==',
].map(decode));

const COPULA_FRAMES = Object.freeze([
  'WW91ciB7T30gaXMge0N9IHRvIHtWfSA4MHtTfXtVfS4=',
].map(decode));

// The guarantee stated through a copular certainty, in both orderings, so the carve-out is proved
// on the phrasing that slipped past it rather than only on the direct one.
const GUARANTEE_COPULAR_FRAMES = Object.freeze([
  'WW91ciB7T30gaXMge0N9IHRvIGJlIDgwe1N9e1V9IGd1YXJhbnRlZWQu',
  'WW91ciB7T30gaXMge0N9IHRvIGJlIGd1YXJhbnRlZWQgYXQgODB7U317VX0u',
].map(decode));

const GOVERNED_DECISION_FRAMES = Object.freeze([
  'WW91ciB7T30gaXMge0N9IHRvIHtWfSBhdCA4MHtTfXtVfS4=',
].map(decode));

// R5D-05, ninth pass. The over-fire the positional rule risks, and the one the enumeration never
// could: a percentage that sits in the complement position but modifies the noun after it, which
// makes it a term of the product or a comparison rather than the value the certainty lands on.
// These were found by hunting the failure mode the new shape predicted rather than by waiting for a
// probe to report it, and they are here as a cross-product so the trailing half of the position test
// has a floor of its own.
const NP_HEAD_AXIS = Object.freeze([
  'Y29sbGF0ZXJhbA==',
  'ZXF1aXR5',
  'aW50ZXJlc3Q=',
  'Y292ZXJhZ2U=',
].map(decode));

const NP_MODIFIER_CLEAN_FRAMES = Object.freeze([
  'WW91ciB7T30gaXMge0N9IHRvIHJlcXVpcmUgMTB7U317VX0ge059Lg==',
  'WW91ciB7T30gaXMge0N9IHRvIGluY2x1ZGUgYSAxMHtTfXtVfSB7Tn0u',
  'WW91ciB7T30gaXMge0N9IHRvIHRha2UgMTB7U317VX0gbW9yZSB7Tn0u',
].map(decode));

// R5D-05, tenth pass. The mirror image of the noun-modifier family: a figure that does land on the
// certainty and carries an adjunct behind it. Six of these were reported as under-fires because the
// ninth pass's trailing class named five openers and left the rest of the class out, so the tails
// here are drawn one per grammatical kind — measure `of`, bare connective adverb, subordinator,
// participial preposition, pro-form, plain preposition — rather than transcribed from the report,
// and they cross the same subject, certainty and unit axes as everything else in this file. A tail
// kind that stops being recognised fails a column, not a sentence.
const ADJUNCT_TAIL_AXIS = Object.freeze([
  'b2YgdGhlIGFzaw==',
  'cmVnYXJkbGVzcw==',
  'b25jZSB3ZSBmaWxl',
  'YmFycmluZyBhIHN1cnByaXNl',
  'YXNzdW1pbmcgeW91IHNpZ24=',
  'd2hhdGV2ZXIgaGFwcGVucw==',
  'cGVuZGluZyBmaW5hbCByZXZpZXc=',
  'aW5jbHVkaW5nIGZlZXM=',
  'YWZ0ZXIgdW5kZXJ3cml0aW5n',
  'd2l0aGluIGEgbW9udGg=',
  'aW4gdGhlIGVuZA==',
  'YW55d2F5',
].map(decode));

const ADJUNCT_TAIL_FRAMES = Object.freeze([
  'WW91ciB7T30gaXMge0N9IHRvIHJlYWNoIDgwe1N9e1V9IHtUfS4=',
  'WW91ciB7T30gaXMge0N9IHRvIGhpdCA4MHtTfXtVfSB7VH0u',
].map(decode));

const GOVERNED_CLEAN_FRAMES = Object.freeze([
  'WW91ciB7T30gY2FycmllcyBhIDEwe1N9e1V9IHJhdGUgYW5kIGlzIHtDfSB0byB7Vn0u',
  'WW91ciB7T30gaXMge0N9IHRvIHtWfSBieSAye1N9e1V9IHRoaXMgcXVhcnRlci4=',
].map(decode));

const ALL_OUTCOMES = Object.freeze([
  ...OUTCOME_MONEY_AXIS,
  ...OUTCOME_INSTRUMENT_AXIS,
  ...OUTCOME_DECISION_AXIS,
]);

const ALL_CERTAINTIES = Object.freeze([...CERTAINTY_ODDS_AXIS, ...CERTAINTY_GUARANTEE_AXIS]);

// The one place the split is written down, and it is written the way the rule states it: an
// instrument subject and the guarantee vocabulary anywhere in the same clause. The sixth pass
// phrased this as instrument-plus-guarantee-*certainty*, which reads the same on the direct forms
// and is wrong the moment the guarantee word moves out of the certainty slot — the copular form
// puts it in the predicate, and that path stayed caught. Matching on the clause, not on the slot,
// is what makes the carve-out reach every phrasing of the same fact.
const GUARANTEE_VOCABULARY = /guarant/i;
const isGuaranteedInstrument = (outcome, text) =>
  OUTCOME_INSTRUMENT_AXIS.includes(outcome) && GUARANTEE_VOCABULARY.test(text);

function composeStative(frames, family) {
  const cases = [];
  for (const outcome of ALL_OUTCOMES) {
    for (const certainty of ALL_CERTAINTIES) {
      for (const unit of PERCENT_UNIT_AXIS) {
        for (const casing of PERCENT_CASING_AXIS) {
          for (const spacing of PERCENT_SPACING_AXIS) {
            for (const frame of frames) {
              const written = casing(unit);
              const text = frame
                .replace('{O}', outcome)
                .replace('{C}', certainty)
                .replace(/\{S\}/g, spacing)
                .replace(/\{U\}/g, written);
              cases.push(Object.freeze({
                certainty,
                clean: isGuaranteedInstrument(outcome, text),
                expectedCode: 'LANGUAGE_C27',
                family,
                outcome,
                text,
                unit,
                writtenUnit: written,
              }));
            }
          }
        }
      }
    }
  }
  return cases;
}

// The verb-governed families vary the verb rather than the unit: the unit and casing axes are
// proved orthogonally by the stative cross-product above, and re-crossing them here would multiply
// the corpus by thirty-three without testing a distinction the rule can tell apart.
function composeGoverned(verbs, frames, { clean, family, outcomes = ALL_OUTCOMES }) {
  const cases = [];
  for (const outcome of outcomes) {
    for (const certainty of ALL_CERTAINTIES) {
      for (const verb of verbs) {
        for (const spacing of PERCENT_SPACING_AXIS) {
          for (const frame of frames) {
            const text = frame
              .replace('{O}', outcome)
              .replace('{C}', certainty)
              .replace('{V}', verb)
              .replace(/\{S\}/g, spacing)
              .replace(/\{U\}/g, PERCENT_UNIT_AXIS[0]);
            cases.push(Object.freeze({
              certainty,
              clean: clean || isGuaranteedInstrument(outcome, text),
              expectedCode: 'LANGUAGE_C27',
              family,
              outcome,
              text,
              unit: PERCENT_UNIT_AXIS[0],
              verb,
            }));
          }
        }
      }
    }
  }
  return cases;
}

// Crossed over subject, certainty, frame, head noun and unit. Casing is left at one form here and
// proved orthogonally by the stative cross-product, the same bounded choice recorded for the
// verb-governed families: the trailing guard is anchored on the unit, so the unit axis is the one
// that can break it.
function composeNpModifierClean(frames) {
  const cases = [];
  for (const outcome of [...OUTCOME_MONEY_AXIS, ...OUTCOME_INSTRUMENT_AXIS]) {
    for (const certainty of ALL_CERTAINTIES) {
      for (const head of NP_HEAD_AXIS) {
        for (const unit of PERCENT_UNIT_AXIS) {
          for (const frame of frames) {
            cases.push(Object.freeze({
              certainty,
              head,
              outcome,
              unit,
              writtenUnit: unit,
              text: frame
                .replace('{O}', outcome)
                .replace('{C}', certainty)
                .replace('{N}', head)
                .replace(/\{S\}/g, ' ')
                .replace(/\{U\}/g, unit),
            }));
          }
        }
      }
    }
  }
  return cases;
}

function composeAdjunctTail(frames) {
  const cases = [];
  for (const outcome of OUTCOME_MONEY_AXIS) {
    for (const certainty of ALL_CERTAINTIES) {
      for (const tail of ADJUNCT_TAIL_AXIS) {
        for (const unit of PERCENT_UNIT_AXIS) {
          for (const frame of frames) {
            cases.push(Object.freeze({
              certainty,
              expectedCode: 'LANGUAGE_C27',
              outcome,
              tail,
              unit,
              writtenUnit: unit,
              text: frame
                .replace('{O}', outcome)
                .replace('{C}', certainty)
                .replace('{T}', tail)
                .replace(/\{S\}/g, ' ')
                .replace(/\{U\}/g, unit),
            }));
          }
        }
      }
    }
  }
  return cases;
}

function composeFamilyClean(frames) {
  const cases = [];
  for (const outcome of [...OUTCOME_MONEY_AXIS, ...OUTCOME_INSTRUMENT_AXIS]) {
    for (const unit of PERCENT_UNIT_AXIS) {
      for (const casing of PERCENT_CASING_AXIS) {
        for (const frame of frames) {
          const written = casing(unit);
          cases.push(Object.freeze({
            outcome,
            unit,
            writtenUnit: written,
            text: frame.replace('{O}', outcome).replace('{S}', ' ').replace('{U}', written),
          }));
        }
      }
    }
  }
  return cases;
}

const STATIVE_CASES = Object.freeze(composeStative(FAMILY_FRAMES, 'stative'));

// R5D-05, seventh pass. The same guaranteed fraction of principal, said through a copula. This is
// the phrasing the sixth pass's carve-out did not reach, and it is a cross-product rather than the
// three sentences that reported it: every subject, every certainty, every unit and every casing.
// It is crossed against the unit and casing axes where the other verb-governed families are not,
// because this family is the guarantee split rather than the governed-verb split, and the split has
// to hold in every way a percentage can be written.
const GUARANTEE_COPULAR_CASES = Object.freeze(
  composeStative(GUARANTEE_COPULAR_FRAMES, 'guarantee-copular'),
);
const COPULA_CASES = Object.freeze(
  composeGoverned(COPULA_AXIS, COPULA_FRAMES, { clean: false, family: 'copula' }),
);
const GOVERNED_DECISION_CASES = Object.freeze(
  // A decision verb puts the decision word in the clause on its own, so these fire whatever the
  // subject is — the carve-out is about a guarantee percentage standing alone as a term of the
  // instrument, and a clause that also names the decision is no longer only describing the product.
  composeGoverned(GOVERNED_DECISION_AXIS, GOVERNED_DECISION_FRAMES, {
    clean: false,
    family: 'decision',
  }).map((row) => Object.freeze({ ...row, clean: false })),
);
const GOVERNED_CLEAN_CASES = Object.freeze(
  // The decision nouns are left out for the same reason they are left out of the progress frames:
  // one of them beside a person word and a percentage is C20's own claim, whatever verb follows.
  composeGoverned(NON_DECISION_VERB_AXIS, GOVERNED_CLEAN_FRAMES, {
    clean: true,
    family: 'ordinary',
    outcomes: [...OUTCOME_MONEY_AXIS, ...OUTCOME_INSTRUMENT_AXIS],
  }),
);

const ADJUNCT_TAIL_CASES = Object.freeze(composeAdjunctTail(ADJUNCT_TAIL_FRAMES));

const FAMILY_ALL = Object.freeze([
  ...ADJUNCT_TAIL_CASES,
  ...STATIVE_CASES,
  ...GUARANTEE_COPULAR_CASES,
  ...COPULA_CASES,
  ...GOVERNED_DECISION_CASES,
  ...GOVERNED_CLEAN_CASES,
]);

export const OUTCOME_CERTAINTY_AXES = Object.freeze({
  adjunctTailFrames: ADJUNCT_TAIL_FRAMES,
  adjunctTails: ADJUNCT_TAIL_AXIS,
  certainties: ALL_CERTAINTIES,
  copulas: COPULA_AXIS,
  decisionOutcomes: OUTCOME_DECISION_AXIS,
  decisionVerbs: GOVERNED_DECISION_AXIS,
  frames: FAMILY_FRAMES,
  guaranteeCopularFrames: GUARANTEE_COPULAR_FRAMES,
  guaranteeCertainties: CERTAINTY_GUARANTEE_AXIS,
  instrumentOutcomes: OUTCOME_INSTRUMENT_AXIS,
  moneyOutcomes: OUTCOME_MONEY_AXIS,
  nonDecisionVerbs: NON_DECISION_VERB_AXIS,
  npHeads: NP_HEAD_AXIS,
  npModifierFrames: NP_MODIFIER_CLEAN_FRAMES,
  oddsCertainties: CERTAINTY_ODDS_AXIS,
  outcomes: ALL_OUTCOMES,
});

export const OUTCOME_CERTAINTY_CASES = Object.freeze(FAMILY_ALL.filter((row) => !row.clean));

// The negative half of the same three families, plus the progress statement the whole family is
// most at risk of swallowing. Every row here is a cell of a cross-product, so a rule that stops
// telling an instrument from a sum of money, or a decision from an ordinary verb, fails by the
// column rather than by the sentence somebody remembered to write down.
export const GUARANTEE_INSTRUMENT_CLEAN_CASES = Object.freeze(
  FAMILY_ALL.filter((row) => row.clean && OUTCOME_INSTRUMENT_AXIS.includes(row.outcome)
    && (row.family === 'stative' || row.family === 'guarantee-copular')),
);

// The half of it that says the guarantee through a copula. Kept addressable on its own because it
// is the cell the sixth pass got wrong, and a test that only counts the union would go green again
// if this family were dropped.
export const GUARANTEE_COPULAR_CLEAN_CASES = Object.freeze(
  GUARANTEE_COPULAR_CASES.filter((row) => row.clean),
);

export const GOVERNED_VERB_CLEAN_CASES = Object.freeze(GOVERNED_CLEAN_CASES);

// The trailing half of the position test, as its own addressable family for the same reason the
// copular guarantee cells are: a rule that stops telling a value from a noun modifier fails here by
// the column rather than disappearing into a union count.
export const ADJUNCT_TAIL_ADVERSARIAL_CASES = Object.freeze(ADJUNCT_TAIL_CASES);

export const NP_MODIFIER_CLEAN_CASES = Object.freeze(
  composeNpModifierClean(NP_MODIFIER_CLEAN_FRAMES),
);

export const OUTCOME_CERTAINTY_CLEAN_CASES = Object.freeze([
  ...FAMILY_ALL.filter((row) => row.clean),
  ...composeFamilyClean(FAMILY_CLEAN_FRAMES),
  ...composeNpModifierClean(NP_MODIFIER_CLEAN_FRAMES),
]);




// The client controls ride in the same list, so every loop that already proves clean copy survives
// every consumer covers them without a second wiring. Round 5's negatives join them for the same
// reason: one clean list means a widening cannot be proved against a corpus that omits it.
export const ROUND_4_CLEAN_CASES = Object.freeze([
  ...ROUND_4_ENCODED_CLEAN.map(decode),
  ...ROUND_5_ENCODED_CLEAN.map(decode),
  ...DROP_7_CLIENT_COPY_CONTROLS,
]);

export const NORMALIZED_ADVERSARIAL_LANGUAGE = Object.freeze(
  [
    ...ENCODED_CASES.map(decode),
    ...ROUND_3_ADVERSARIAL_CASES.map((item) => item.text),
    ...ROUND_4_ADVERSARIAL_CASES.map((item) => item.text),
    ...ROUND_5_ADVERSARIAL_CASES.map((item) => item.text),
  ],
);
