import test from "node:test";
import assert from "node:assert/strict";
import { validateUnderstanding, extractJson, stripPrice, handleUnderstand } from "../lib/understand.ts";
import { heardYesNo } from "../lib/yes-no.ts";
import { parseVoiceCommand } from "../lib/voice-command.ts";

const customers = [{ id: "c1", name: "ramu" }, { id: "c2", name: "సీత" }];

test("AI credit with items is totalled from validated item prices", () => {
  const result = validateUnderstanding({ action: "credit", spokenName: "రాము", customerId: "c1", items: [{ label: "పాలు", price: 20 }, { label: "బియ్యం", price: "50" }] }, customers);
  assert.deepEqual(result, { ok: true, kind: "credit", customerId: "c1", amount: "70", items: [{ label: "పాలు", amountPaise: 2000 }, { label: "బియ్యం", amountPaise: 5000 }] });
});

test("an unknown customer id becomes a new customer from the spoken name", () => {
  const result = validateUnderstanding({ action: "credit", spokenName: "లక్ష్మి", customerId: "ramu", items: [{ label: "పెరుగు", price: 30 }] }, customers);
  assert.equal(result.ok && "newCustomerName" in result && result.newCustomerName, "లక్ష్మి");
});

test("a spoken name equal to a saved name reuses that customer", () => {
  const result = validateUnderstanding({ action: "credit", spokenName: "Ramu", customerId: null, items: [{ label: "milk", price: 20 }] }, customers);
  assert.equal(result.ok && "customerId" in result && result.customerId, "c1");
});

test("payments and balance questions need a saved customer", () => {
  assert.equal(validateUnderstanding({ action: "payment", spokenName: "ravi", customerId: null, amount: 100 }, customers).ok, false);
  assert.deepEqual(validateUnderstanding({ action: "payment", customerId: "c2", amount: 50 }, customers), { ok: true, kind: "payment", customerId: "c2", amount: "50" });
  assert.deepEqual(validateUnderstanding({ action: "balance", customerId: "c1" }, customers), { ok: true, kind: "balance", customerId: "c1" });
});

test("invented, missing, negative or huge prices are rejected", () => {
  for (const price of [null, 0, -5, "abc", 20_000_000]) {
    assert.equal(validateUnderstanding({ action: "credit", customerId: "c1", items: [{ label: "x", price }] }, customers).ok, false, String(price));
  }
  assert.equal(validateUnderstanding({ action: "unclear" }, customers).ok, false);
  assert.equal(validateUnderstanding("nonsense", customers).ok, false);
});

test("JSON is extracted from fenced or think-wrapped model output", () => {
  assert.deepEqual(extractJson("<think>hmm {no}</think>```json\n{\"action\":\"unclear\"}\n```"), { action: "unclear" });
  assert.equal(extractJson("no json here"), undefined);
});

test("prices echoed in labels are removed but quantities stay", () => {
  assert.equal(stripPrice("paalu 20 rupees", 2000), "paalu");
  assert.equal(stripPrice("బియ్యం 50", 5000), "బియ్యం");
  assert.equal(stripPrice("rice 2 kg", 8000), "rice 2 kg");
});

test("the understand handler validates provider output and hides provider errors", async () => {
  const ok = async () => Response.json({ choices: [{ message: { content: "{\"action\":\"payment\",\"customerId\":\"c1\",\"amount\":100}" } }] });
  const response = await handleUnderstand(new Request("http://x/", { method: "POST", body: JSON.stringify({ text: "ramu gave 100", customers }) }), "key", ok);
  assert.deepEqual((await response.json()).result, { ok: true, kind: "payment", customerId: "c1", amount: "100" });
  const down = async () => new Response("secret details", { status: 500 });
  const failed = await handleUnderstand(new Request("http://x/", { method: "POST", body: JSON.stringify({ text: "x", customers }) }), "key", down);
  assert.equal(failed.status, 502);
  assert.ok(!(await failed.text()).includes("secret"));
});

test("spoken yes/no answers, with no winning over yes", () => {
  assert.equal(heardYesNo("అవును"), "yes");
  assert.equal(heardYesNo("సరే సేవ్ చేయి"), "yes");
  assert.equal(heardYesNo("haan theek hai"), "yes");
  assert.equal(heardYesNo("కాదు"), "no");
  assert.equal(heardYesNo("అవును కాదు వద్దు"), "no");
  assert.equal(heardYesNo("hmm"), undefined);
});

test("offline rule parser records 'gave' as a payment, not a bill", () => {
  assert.deepEqual(parseVoiceCommand("ramu gave 100", customers), { ok: true, customerId: "c1", kind: "payment", amount: "100" });
});
