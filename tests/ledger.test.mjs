import test from "node:test";
import assert from "node:assert/strict";
import { addCustomer, addEntry, addEntryWithCustomer, balanceFor, emptyLedger, parseAmount, restoreLedger, undoLastEntry } from "../lib/ledger.ts";

const at = "2026-11-15T10:00:00.000Z";
const base = () => addCustomer(emptyLedger(), { id: "ravi", name: "రవి" });
const entry = (id, kind, amountPaise, customerId = "ravi") => ({ id, kind, amountPaise, customerId, createdAt: at });

test("₹300 credit minus ₹100 payment leaves ₹200 after a storage round trip", () => {
  let ledger = addEntry(base(), entry("1", "credit", parseAmount("300")));
  ledger = addEntry(ledger, entry("2", "payment", parseAmount("100")));
  assert.equal(balanceFor(restoreLedger(JSON.stringify(ledger)), "ravi"), 20_000);
});
test("amounts use integer paise and reject invalid money", () => {
  assert.equal(parseAmount("0.29"), 29);
  assert.equal(parseAmount("100.10"), 10010);
  for (const value of ["0", "-10", "1.001", "1e3", "", "1000000.01"]) assert.throws(() => parseAmount(value));
});
test("payments cannot exceed dues and repeated entry IDs do not duplicate", () => {
  const credit = entry("1", "credit", 5000);
  const ledger = addEntry(base(), credit);
  assert.throws(() => addEntry(ledger, entry("2", "payment", 5001)));
  assert.equal(addEntry(ledger, credit).entries.length, 1);
});
test("undo keeps an audit record and reverses entries in order", () => {
  let ledger = addEntry(base(), entry("1", "credit", 30000));
  ledger = addEntry(ledger, entry("2", "payment", 10000));
  ledger = undoLastEntry(ledger, at);
  assert.equal(balanceFor(ledger, "ravi"), 30000);
  assert.equal(ledger.entries.length, 2);
  assert.equal(ledger.entries[1].voidedAt, at);
  ledger = undoLastEntry(ledger, at);
  assert.equal(balanceFor(restoreLedger(JSON.stringify(ledger)), "ravi"), 0);
  assert.throws(() => undoLastEntry(ledger, at));
});
test("customers are separate and duplicate names need a qualifier", () => {
  let ledger = addCustomer(base(), { id: "sita", name: "సీత" });
  ledger = addEntry(ledger, entry("1", "credit", 50000));
  assert.equal(balanceFor(ledger, "sita"), 0);
  assert.throws(() => addCustomer(ledger, { id: "other", name: " రవి " }));
});
test("malformed saved records are rejected", () => {
  assert.throws(() => restoreLedger("{}"));
  assert.throws(() => restoreLedger(JSON.stringify({ ...base(), entries: [entry("1", "credit", -1)] })));
  assert.throws(() => restoreLedger(JSON.stringify({ ...base(), entries: [entry("1", "credit", 100, "unknown")] })));
});

const itemizedBill = (overrides = {}) => ({
  ...entry("bill", "credit", 7000),
  items: [{ label: "Milk", amountPaise: 2000 }, { label: "Dal", amountPaise: 5000 }],
  ...overrides,
});

test("milk ₹20 plus dal ₹50 creates one ₹70 credit without double-counting", () => {
  const initial = addEntry(base(), entry("previous", "credit", 10000));
  const ledger = addEntry(initial, itemizedBill());
  assert.equal(ledger.entries.length, 2);
  assert.equal(ledger.entries[1].amountPaise, 7000);
  assert.equal(balanceFor(ledger, "ravi"), 17000);
  assert.equal(addEntry(ledger, itemizedBill()).entries.length, 2);
  assert.equal(balanceFor(addEntry(ledger, itemizedBill()), "ravi"), 17000);
});

test("item totals preserve exact paise and survive a storage round trip", () => {
  const bill = itemizedBill({
    amountPaise: parseAmount("70.30"),
    items: [{ label: "పాలు", amountPaise: parseAmount("20.10") }, { label: "పప్పు", amountPaise: parseAmount("50.20") }],
  });
  const ledger = restoreLedger(JSON.stringify(addEntry(base(), bill)));
  assert.equal(balanceFor(ledger, "ravi"), 7030);
  assert.deepEqual(ledger.entries[0].items, bill.items);
});

test("saved item arrays are trimmed copies independent of the draft", () => {
  const bill = itemizedBill({ items: [{ label: "  Milk  ", amountPaise: 2000 }, { label: " Dal ", amountPaise: 5000 }] });
  const ledger = addEntry(base(), bill);
  assert.notEqual(ledger.entries[0], bill);
  assert.notEqual(ledger.entries[0].items, bill.items);
  assert.notEqual(ledger.entries[0].items[0], bill.items[0]);
  bill.items[0].label = "Changed";
  bill.items[0].amountPaise = 9999;
  bill.items.push({ label: "Extra", amountPaise: 100 });
  assert.deepEqual(ledger.entries[0].items, [{ label: "Milk", amountPaise: 2000 }, { label: "Dal", amountPaise: 5000 }]);
  assert.equal(balanceFor(ledger, "ravi"), 7000);
});

test("undo reverses the whole itemized bill and retains its audit details", () => {
  const previous = addEntry(base(), entry("previous", "credit", 10000));
  const saved = addEntry(previous, itemizedBill());
  const undone = restoreLedger(JSON.stringify(undoLastEntry(saved, at)));
  assert.equal(balanceFor(undone, "ravi"), 10000);
  assert.equal(undone.entries[1].voidedAt, at);
  assert.deepEqual(undone.entries[1].items, itemizedBill().items);
});

test("mismatched, malformed, nonpositive and oversized item bills are rejected on add and restore", () => {
  const invalid = [
    itemizedBill({ amountPaise: 7001 }),
    itemizedBill({ items: null }),
    itemizedBill({ items: {} }),
    itemizedBill({ items: [] }),
    itemizedBill({ items: Array.from({ length: 21 }, () => ({ label: "Milk", amountPaise: 100 })) }),
    itemizedBill({ items: [null] }),
    itemizedBill({ items: [{ label: " ", amountPaise: 7000 }] }),
    itemizedBill({ items: [{ label: "x".repeat(81), amountPaise: 7000 }] }),
    itemizedBill({ items: [{ label: 123, amountPaise: 7000 }] }),
    ...[0, -1, 1.5, "7000", 100_000_001].map((amountPaise) => itemizedBill({ items: [{ label: "Milk", amountPaise }] })),
    itemizedBill({ amountPaise: 100_000_000, items: [{ label: "Milk", amountPaise: 60_000_000 }, { label: "Dal", amountPaise: 50_000_000 }] }),
  ];
  for (const bill of invalid) {
    assert.throws(() => addEntry(base(), bill));
    assert.throws(() => restoreLedger(JSON.stringify({ ...base(), entries: [bill] })));
    assert.throws(() => restoreLedger(JSON.stringify({ ...base(), entries: [{ ...bill, voidedAt: at }] })));
  }
});

test("repayments cannot carry item amounts, including cancelled saved repayments", () => {
  const ledger = addEntry(base(), entry("previous", "credit", 10000));
  const repayment = itemizedBill({ id: "payment", kind: "payment" });
  assert.throws(() => addEntry(ledger, repayment));
  assert.throws(() => restoreLedger(JSON.stringify({ ...ledger, entries: [...ledger.entries, repayment] })));
  assert.throws(() => restoreLedger(JSON.stringify({ ...ledger, entries: [...ledger.entries, { ...repayment, voidedAt: at }] })));
});

test("version 1 entries without items remain unchanged and can coexist with itemized bills", () => {
  const oldLedger = { ...base(), entries: [entry("previous", "credit", 10000)] };
  const restored = restoreLedger(JSON.stringify(oldLedger));
  assert.deepEqual(restored, oldLedger);
  assert.equal(restored.entries[0].items, undefined);
  const updated = restoreLedger(JSON.stringify(addEntry(restored, itemizedBill())));
  assert.equal(updated.version, 1);
  assert.equal(updated.entries[0].items, undefined);
  assert.equal(balanceFor(updated, "ravi"), 17000);
});

test("a new customer and first itemized bill are saved as one immutable result", () => {
  const initial = emptyLedger();
  Object.freeze(initial.customers);
  Object.freeze(initial.entries);
  Object.freeze(initial);
  const customer = { id: "ravi", name: "  రవి   కుమార్  " };
  const bill = itemizedBill();
  const result = addEntryWithCustomer(initial, bill, customer);
  assert.deepEqual(initial, emptyLedger());
  assert.deepEqual(result.customers, [{ id: "ravi", name: "రవి కుమార్" }]);
  assert.equal(result.entries.length, 1);
  assert.equal(balanceFor(result, "ravi"), 7000);
  customer.name = "Changed";
  bill.items[0].amountPaise = 9999;
  assert.equal(result.customers[0].name, "రవి కుమార్");
  assert.equal(result.entries[0].items[0].amountPaise, 2000);
});

test("invalid first bills never leave a new customer in the original ledger", () => {
  for (const bill of [
    itemizedBill({ amountPaise: 0 }),
    itemizedBill({ amountPaise: 7001 }),
    itemizedBill({ items: [{ label: "", amountPaise: 7000 }] }),
    itemizedBill({ items: null }),
    itemizedBill({ customerId: "someone-else" }),
    itemizedBill({ kind: "payment", items: undefined }),
    itemizedBill({ voidedAt: at }),
  ]) {
    const initial = emptyLedger();
    assert.throws(() => addEntryWithCustomer(initial, bill, { id: "ravi", name: "రవి" }));
    assert.deepEqual(initial, emptyLedger());
  }
});

test("new customer name and ID validation is atomic and uses existing duplicate checks", () => {
  for (const customer of [
    { id: "ravi", name: " " },
    { id: "ravi", name: "x".repeat(61) },
    { id: "", name: "రవి" },
    { id: " ", name: "రవి" },
  ]) {
    const initial = emptyLedger();
    assert.throws(() => addEntryWithCustomer(initial, itemizedBill({ customerId: customer.id }), customer));
    assert.deepEqual(initial, emptyLedger());
  }
  const initial = base();
  const before = JSON.stringify(initial);
  assert.throws(() => addEntryWithCustomer(initial, itemizedBill({ customerId: "another-ravi" }), { id: "another-ravi", name: " రవి " }));
  assert.throws(() => addEntryWithCustomer(initial, itemizedBill(), { id: "ravi", name: "Different name" }));
  assert.equal(JSON.stringify(initial), before);
});

test("repeated atomic Save is idempotent and does not create an extra empty customer", () => {
  const bill = itemizedBill();
  const result = addEntryWithCustomer(emptyLedger(), bill, { id: "ravi", name: "రవి" });
  assert.equal(addEntryWithCustomer(result, bill, { id: "ravi", name: "రవి" }), result);
  assert.equal(addEntryWithCustomer(result, { ...bill, customerId: "other" }, { id: "other", name: "Other" }), result);
  assert.equal(result.customers.length, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(balanceFor(result, "ravi"), 7000);
});

test("atomic helper keeps the existing-customer dues and repayment path", () => {
  const bill = addEntryWithCustomer(base(), itemizedBill());
  const paid = addEntryWithCustomer(bill, entry("payment", "payment", 2000));
  assert.equal(balanceFor(paid, "ravi"), 5000);
  assert.equal(paid.customers.length, 1);
  assert.throws(() => addEntryWithCustomer(emptyLedger(), itemizedBill()));
});

test("an atomic first bill survives v1 restoration and undo retains its saved customer and audit", () => {
  const saved = addEntryWithCustomer(emptyLedger(), itemizedBill(), { id: "ravi", name: "రవి" });
  const restored = restoreLedger(JSON.stringify(saved));
  assert.deepEqual(restored, saved);
  const undone = restoreLedger(JSON.stringify(undoLastEntry(restored, at)));
  assert.equal(balanceFor(undone, "ravi"), 0);
  assert.deepEqual(undone.customers, saved.customers);
  assert.deepEqual(undone.entries[0].items, saved.entries[0].items);
  assert.equal(undone.entries[0].voidedAt, at);
});
