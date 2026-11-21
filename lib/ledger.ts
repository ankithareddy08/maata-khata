export type Customer = { id: string; name: string };
export type LineItem = { label: string; amountPaise: number };
export type Entry = {
  id: string;
  customerId: string;
  kind: "credit" | "payment";
  amountPaise: number;
  items?: LineItem[];
  createdAt: string;
  voidedAt?: string;
};
export type Ledger = { version: 1; customers: Customer[]; entries: Entry[] };
export const STORAGE_KEY = "maata-khata-ledger-v1";
export const emptyLedger = (): Ledger => ({ version: 1, customers: [], entries: [] });

// Store money as whole paise, so decimal rounding cannot change a balance.
export function parseAmount(input: string): number {
  const value = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Enter an amount with up to two decimal places.");
  const [rupees, fraction = ""] = value.split(".");
  const amountPaise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > 100_000_000) {
    throw new Error("Enter an amount between ₹0.01 and ₹10,00,000.");
  }
  return amountPaise;
}

export function balanceFor(ledger: Ledger, customerId: string): number {
  return ledger.entries.reduce((sum, entry) => {
    if (entry.customerId !== customerId || entry.voidedAt) return sum;
    return sum + (entry.kind === "credit" ? entry.amountPaise : -entry.amountPaise);
  }, 0);
}

export function addCustomer(ledger: Ledger, customer: Customer): Ledger {
  const name = customer.name.trim().replace(/\s+/g, " ").normalize("NFC");
  if (!name || name.length > 60) throw new Error("Enter a customer name of 1–60 characters.");
  if (ledger.customers.some((item) => item.id === customer.id)) throw new Error("Customer already exists.");
  if (ledger.customers.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error("This name already exists. Add a surname to distinguish another customer.");
  }
  return { ...ledger, customers: [...ledger.customers, { ...customer, name }] };
}

export function addEntry(ledger: Ledger, entry: Entry): Ledger {
  if (ledger.entries.some((item) => item.id === entry.id)) return ledger;
  if (!ledger.customers.some((customer) => customer.id === entry.customerId)) throw new Error("Choose a customer.");
  if (entry.kind !== "credit" && entry.kind !== "payment") throw new Error("Choose an entry type.");
  if (!Number.isSafeInteger(entry.amountPaise) || entry.amountPaise <= 0 || entry.amountPaise > 100_000_000) {
    throw new Error("Enter a valid amount.");
  }
  const items = normalizeEntryItems(entry);
  const balance = balanceFor(ledger, entry.customerId);
  if (!Number.isSafeInteger(balance + entry.amountPaise)) throw new Error("Balance is too large.");
  if (entry.kind === "payment" && entry.amountPaise > balance) throw new Error("The payment exceeds this customer's outstanding balance.");
  // Item prices explain this one entry; they are not additional ledger debits.
  // Copy the lines so later edits to the caller's draft cannot alter saved data.
  const savedEntry = items ? { ...entry, items } : { ...entry };
  return { ...ledger, entries: [...ledger.entries, savedEntry] };
}

/**
 * Build one immutable result for a confirmed bill, optionally creating its
 * customer too. Callers persist only this complete result, so a failed first
 * bill cannot leave an empty customer behind.
 */
export function addEntryWithCustomer(ledger: Ledger, entry: Entry, newCustomer?: Customer): Ledger {
  // A repeated Save for the same pending entry must not create another customer.
  if (ledger.entries.some((item) => item.id === entry.id)) return ledger;
  if (!newCustomer) return addEntry(ledger, entry);
  if (typeof newCustomer.id !== "string" || !newCustomer.id.trim()) throw new Error("Enter a valid customer ID.");
  if (entry.customerId !== newCustomer.id) throw new Error("The bill must belong to the new customer.");
  if (entry.kind !== "credit") throw new Error("A new customer's first entry must record dues.");
  if (entry.voidedAt !== undefined) throw new Error("A new customer's first bill must be active.");
  const candidate = addCustomer(ledger, newCustomer);
  return addEntry(candidate, entry);
}

function normalizeEntryItems(entry: Entry): LineItem[] | undefined {
  if (entry.items === undefined) return undefined;
  if (entry.kind !== "credit") throw new Error("Items can only be added to a dues entry.");
  if (!Array.isArray(entry.items) || entry.items.length < 1 || entry.items.length > 20) {
    throw new Error("A bill must contain between 1 and 20 items.");
  }
  let total = 0;
  const items = entry.items.map((item) => {
    if (!item || typeof item !== "object" || typeof item.label !== "string") throw new Error("Enter an item name.");
    const label = item.label.trim();
    if (!label || label.length > 80) throw new Error("Item names must contain 1–80 characters.");
    if (!Number.isSafeInteger(item.amountPaise) || item.amountPaise <= 0 || item.amountPaise > 100_000_000) {
      throw new Error("Enter a valid positive amount for every item.");
    }
    total += item.amountPaise;
    if (!Number.isSafeInteger(total) || total > 100_000_000) throw new Error("The bill total cannot exceed ₹10,00,000.");
    return { label, amountPaise: item.amountPaise };
  });
  if (total !== entry.amountPaise) throw new Error("The item amounts must add up to the bill total.");
  return items;
}

export function undoLastEntry(ledger: Ledger, at: string): Ledger {
  const last = ledger.entries.findLast((entry) => !entry.voidedAt);
  if (!last) throw new Error("There is no entry to undo.");
  return { ...ledger, entries: ledger.entries.map((entry) => entry.id === last.id ? { ...entry, voidedAt: at } : entry) };
}

export function restoreLedger(raw: string): Ledger {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object" || !("version" in data) || data.version !== 1 ||
      !("customers" in data) || !Array.isArray(data.customers) ||
      !("entries" in data) || !Array.isArray(data.entries)) throw new Error("Saved ledger is not valid.");
  let ledger = emptyLedger();
  for (const customer of data.customers) {
    if (!customer || typeof customer.id !== "string" || !customer.id || typeof customer.name !== "string") throw new Error("Invalid customer.");
    ledger = addCustomer(ledger, customer);
  }
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const entry of data.entries) {
    if (!entry || typeof entry.id !== "string" || !entry.id || seen.has(entry.id) ||
        typeof entry.createdAt !== "string" || !Number.isFinite(Date.parse(entry.createdAt)) ||
        (entry.voidedAt !== undefined && (typeof entry.voidedAt !== "string" || !Number.isFinite(Date.parse(entry.voidedAt))))) {
      throw new Error("Invalid entry.");
    }
    if (!ledger.customers.some((customer) => customer.id === entry.customerId) ||
        (entry.kind !== "credit" && entry.kind !== "payment") ||
        !Number.isSafeInteger(entry.amountPaise) || entry.amountPaise <= 0 || entry.amountPaise > 100_000_000) {
      throw new Error("Invalid saved transaction.");
    }
    // Even cancelled records must have valid, matching item details. Old v1
    // records without items remain valid and need no storage migration.
    const items = normalizeEntryItems(entry);
    const restoredEntry: Entry = items ? { ...entry, items } : { ...entry };
    // Validate only active entries against the effective running balance.
    // Earlier credits and their payments may both have been undone.
    if (!entry.voidedAt) ledger = addEntry(ledger, restoredEntry);
    entries.push(restoredEntry);
    seen.add(entry.id);
  }
  return { ...ledger, entries };
}
