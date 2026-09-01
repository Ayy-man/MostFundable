import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const SOURCE = fs.readFileSync(
  new URL("./fee-edit-sheet.tsx", import.meta.url),
  "utf8",
);
const OPERATOR_SOURCE = fs.readFileSync(
  new URL("../surfaces/operator.tsx", import.meta.url),
  "utf8",
);

describe("operator fee agreement lifecycle", () => {
  it("exposes create, amend, void, and reactivation without dropping the flat trigger", () => {
    assert.match(SOURCE, /Create agreement/);
    assert.match(SOURCE, /Fee agreement amended/);
    assert.match(SOURCE, /Void agreement/);
    assert.match(SOURCE, /Confirm void/);
    assert.match(SOURCE, /Reactivate agreement/);
    assert.match(SOURCE, /Funding trigger/);
    assert.match(SOURCE, /storedAgreementInput\(mutationAgreement, status\)/);
  });

  it("records every payment field and shows authoritative totals and history", () => {
    assert.match(SOURCE, /Amount received/);
    assert.match(SOURCE, /Date received/);
    assert.match(SOURCE, /Payment method/);
    assert.match(SOURCE, /Reference/);
    assert.match(SOURCE, /Reconciliation note/);
    assert.match(SOURCE, /Payment balance/);
    assert.match(SOURCE, /ledger\?\.totalCents/);
    assert.match(SOURCE, /ledger\?\.paidCents/);
    assert.match(SOURCE, /ledger\?\.balanceCents/);
    assert.match(SOURCE, /Payment history/);
  });

  it("requires explicit reversal confirmation and re-reads after every mutation", () => {
    assert.match(SOURCE, /Confirm reversal/);
    assert.match(SOURCE, /reverseFeePayment\(paymentId\)/);
    assert.match(SOURCE, /const next = await readClientFeeDetails\(forClientId\)/);
    assert.match(SOURCE, /The change may have been saved, but the latest fee record could not be verified/);
  });

  it("keys reads and mutation read-backs to the client that originated them", () => {
    assert.match(SOURCE, /readSnapshot\.clientId === clientId/);
    assert.match(SOURCE, /activeClientIdRef = useRef\(clientId\)/);
    assert.match(SOURCE, /if \(activeClientIdRef\.current !== forClientId\) return false/);
    assert.match(SOURCE, /readBack\(mutationClientId,/);
    assert.match(SOURCE, /if \(activeClientIdRef\.current === mutationClientId\) setPendingAction\(null\)/);
    assert.match(OPERATOR_SOURCE, /key=\{editingFeeClient\?\.clientId \?\? "closed"\}/);
  });
});
