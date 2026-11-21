import test from "node:test";
import assert from "node:assert/strict";
import { parseVoiceCommand } from "../lib/voice-command.ts";

const customers = [{ id: "ravi", name: "రవి" }, { id: "sita", name: "సీత" }];
const rejected = (text, list = customers) => {
  const result = parseVoiceCommand(text, list);
  assert.equal(result.ok, false, `Expected rejection: ${text}`);
  assert.equal(typeof result.message, "string");
  assert.ok(result.message.length > 0);
  return result;
};

test("spoken subtraction cannot become another positive-price item", () => {
  for (const operation of ["minus", "less", "subtract", "deduct", "reduce", "మైనస్", "తగ్గించు", "తగ్గించి", "తీసివేయి", "మినహాయించు"]) {
    rejected(`రవి పాలు20, ${operation}50 బాకీ`);
  }
});

test("prepares a Telugu dues draft for an exact existing name", () => {
  assert.deepEqual(parseVoiceCommand("రవి పేరుతో ₹300 రూపాయలు బాకీ నమోదు చేయి.", customers), {
    ok: true, customerId: "ravi", kind: "credit", amount: "300",
  });
  assert.deepEqual(parseVoiceCommand("రవి పేరున ౩౦౦.౫౦ బాకీకి చేర్చండి", customers), {
    ok: true, customerId: "ravi", kind: "credit", amount: "300.50",
  });
});
test("recognizes explicit repayment phrases", () => {
  for (const action of ["చెల్లించాడు", "చెల్లించారు", "చెల్లించా", "అందాయి", "ఇచ్చాడు"]) {
    assert.deepEqual(parseVoiceCommand(`సీత 100 రూపాయలు ${action}`, customers), {
      ok: true, customerId: "sita", kind: "payment", amount: "100",
    });
  }
  assert.equal(parseVoiceCommand("రవి 100 రూపాయలు డబ్బులు అందాయి", customers).ok, true);
  rejected("రవి 100 రూపాయలు ఇచ్చాను");
});
test("customer phrase boundaries are exact, with no suffix or fuzzy guessing", () => {
  rejected("రవికి 300 బాకీ నమోదు చేయి");
  rejected("రవీ 300 బాకీ నమోదు చేయి");
  rejected("పెద్దరవి 300 బాకీ నమోదు చేయి");
  assert.equal(parseVoiceCommand("రవి, 300 బాకీ నమోదు చేయి", customers).ok, true);
  assert.equal(parseVoiceCommand("రవి కుమార్ 300 బాకీ", [{ id: "ravi-k", name: "రవి కుమార్" }]).ok, true);
});
test("overlapping or multiple customer matches need manual selection", () => {
  rejected("రవి కుమార్ 300 బాకీ", [...customers, { id: "ravi-k", name: "రవి కుమార్" }]);
  rejected("రవి సీత 300 బాకీ");
  rejected("రవి 300 బాకీ", [{ id: "one", name: "రవి" }, { id: "two", name: "రవి" }]);
  rejected("రవి 300 బాకీ", []);
});
test("requires one clear action and rejects questions or multiple instructions", () => {
  for (const text of ["రవి 300", "రవి 300 బాకీ చెల్లించాడు", "రవి 300 బాకీ బాకీ", "రవి 300 బాకీ నమోదు చేసి చెప్పు", "రవి 300 బాకీ ఎంత?", "రవి 300 బాకీ and నమోదు చేయి"]) rejected(text);
});
test("multiple amounts, corrections and word-number amounts require manual review", () => {
  for (const text of ["రవి 300 బాకీ కాదు 350", "రవి 300 350 బాకీ", "రవి మూడు వందల రూపాయలు బాకీ నమోదు చేయి", "రవి 3 వందలు బాకీ", "రవి 300 బాకీ రద్దు చేయి", "రవి 300 బాకీ don't నమోదు చేయి"]) rejected(text);
});
test("rejects zero, negative, excessive and overly precise amounts", () => {
  for (const amount of ["0", "౦", "-300", "- 300", "−₹300", "300.001", "1000000.01", "1e3", "300,50", ".50"]) rejected(`రవి ${amount} బాకీ నమోదు చేయి`);
  assert.equal(parseVoiceCommand("రవి 0.01 బాకీ", customers).ok, true);
});
test("supports valid Indian and international comma grouping", () => {
  for (const [spoken, amount] of [["1,000", "1000"], ["1,00,000.50", "100000.50"], ["100,000", "100000"]]) {
    assert.deepEqual(parseVoiceCommand(`రవి ${spoken} బాకీ`, customers), { ok: true, customerId: "ravi", kind: "credit", amount });
  }
});
test("customer names containing numbers or command words are not interpreted as instructions", () => {
  assert.deepEqual(parseVoiceCommand("Ravi 2 300 బాకీ", [{ id: "r2", name: "Ravi 2" }]), {
    ok: true, customerId: "r2", kind: "credit", amount: "300",
  });
  assert.deepEqual(parseVoiceCommand("బాకీ బాబు 100 చెల్లించాడు", [{ id: "babu", name: "బాకీ బాబు" }]), {
    ok: true, customerId: "babu", kind: "payment", amount: "100",
  });
});
test("unsupported wording is rejected and customer input is never modified", () => {
  const before = JSON.stringify(customers);
  rejected("రవి నిన్న 300 బాకీ నమోదు చేయి");
  rejected("");
  parseVoiceCommand("రవి 300 బాకీ", customers);
  assert.equal(JSON.stringify(customers), before);
});

test("prepares one itemized Telugu bill with a computed ₹70 total", () => {
  assert.deepEqual(parseVoiceCommand("రవి పాలు20, పప్పు50 బాకీ నమోదు చేయి", customers), {
    ok: true, customerId: "ravi", kind: "credit", amount: "70",
    items: [{ label: "పాలు", amountPaise: 2000 }, { label: "పప్పు", amountPaise: 5000 }],
  });
  assert.deepEqual(parseVoiceCommand("రవి పాలు ₹౨౦ రూపాయలు మరియు పప్పు ₹౫౦ రూపాయలు బాకీ", customers), {
    ok: true, customerId: "ravi", kind: "credit", amount: "70",
    items: [{ label: "పాలు", amountPaise: 2000 }, { label: "పప్పు", amountPaise: 5000 }],
  });
});

test("English item labels keep case and exact existing customer spelling", () => {
  assert.deepEqual(parseVoiceCommand("ravi Milk 20 and Dal 50 బాకీ", [{ id: "r", name: "ravi" }]), {
    ok: true, customerId: "r", kind: "credit", amount: "70",
    items: [{ label: "Milk", amountPaise: 2000 }, { label: "Dal", amountPaise: 5000 }],
  });
  rejected("రవి Milk20, Dal50 బాకీ", [{ id: "r", name: "ravi" }]);
});

test("single labelled items, decimal paise and grouped prices are calculated exactly", () => {
  assert.deepEqual(parseVoiceCommand("రవి పాలు20 బాకీ", customers), {
    ok: true, customerId: "ravi", kind: "credit", amount: "20", items: [{ label: "పాలు", amountPaise: 2000 }],
  });
  const cents = parseVoiceCommand("రవి పాలు20.10, పప్పు50.20 బాకీ", customers);
  assert.equal(cents.ok, true); assert.equal(cents.amount, "70.30");
  assert.deepEqual(cents.items.map((item) => item.amountPaise), [2010, 5020]);
  const grouped = parseVoiceCommand("రవి పాలు 1,000, పప్పు 2,000.50 బాకీ", customers);
  assert.equal(grouped.ok, true); assert.equal(grouped.amount, "3000.50");
});

test("quantities, unit prices, unlabeled numbers and mixed actions are not guessed", () => {
  for (const instruction of [
    "2 milk20, dal50", "milk2 litres20, dal50", "milk2 packets20, dal50", "పాలు2 లీటర్లు20, పప్పు50",
    "milk2 cartons20, dal50", "milk2 bags20, dal50", "milk20 dal50",
    "milk20 per litre", "milk2x20, dal50", "milk2@20, dal50", "milk20, 50", "20, dal50",
    "milk20, dal50, 70", "milk20 and", "milk20, dal50 paid", "milk20 తర్వాత dal50",
  ]) rejected(`రవి ${instruction} బాకీ`);
  rejected("రవి పాలు20, పప్పు50 చెల్లించాడు");
  rejected("రవి పాలు20, పప్పు50 బాకీ చెల్లించాడు");
  rejected("రవి పాలు20, పప్పు50 కాదు పప్పు60 బాకీ");
  rejected("రవి పాలు20, సీత పప్పు50 బాకీ");
});

test("spoken grand totals never get added as another item price", () => {
  for (const tail of ["మొత్తం70", "మొత్తం80", "total70", "టోటల్70", "grand total70", "subtotal70"]) {
    const result = rejected(`రవి పాలు20, పప్పు50 ${tail} బాకీ`);
    assert.match(result.message, /grand total/);
  }
});

test("item prices, labels, count and computed total stay within supported bounds", () => {
  for (const amount of ["0", "-20", "−₹20", "20.001", "1000000.01", "20,50", ".50"]) {
    rejected(`రవి పాలు${amount}, పప్పు50 బాకీ`);
  }
  rejected(`రవి ${"అ".repeat(81)}20 బాకీ`);
  rejected(`రవి ${Array.from({ length: 21 }, () => "పాలు20").join(", ")} బాకీ`);
  rejected("రవి పాలు600000, పప్పు500000 బాకీ");
  assert.equal(parseVoiceCommand("రవి పాలు500000, పప్పు500000 బాకీ", customers).amount, "1000000");
  assert.equal(parseVoiceCommand(`రవి ${Array.from({ length: 20 }, () => "పాలు0.01").join(", ")} బాకీ`, customers).amount, "0.20");
});

test("every named item needs its own price instead of merging a missing price into the next label", () => {
  for (const instruction of [
    "పాలు, పప్పు50", "Milk and Dal20", "పాలు మరియు పప్పు50", "పాలు; పప్పు50",
    "పాలు20, పప్పు, నూనె50", "Milk20 and Dal and Oil50", "పాలు20 మరియు పప్పు మరియు నూనె50",
  ]) rejected(`రవి ${instruction} బాకీ`);
  const multiword = parseVoiceCommand("రవి red gram dal20 బాకీ", customers);
  assert.equal(multiword.ok, true);
  assert.deepEqual(multiword.items, [{ label: "red gram dal", amountPaise: 2000 }]);
  const separatedScaffolding = parseVoiceCommand("రవి, పాలు20 రూపాయలు, పప్పు50 రూపాయలు బాకీ", customers);
  assert.equal(separatedScaffolding.ok, true);
  assert.equal(separatedScaffolding.amount, "70");
  assert.deepEqual(separatedScaffolding.items.map((item) => item.label), ["పాలు", "పప్పు"]);
});

test("the user's new-name price-first milk example works with no existing customers", () => {
  assert.deepEqual(parseVoiceCommand("new name mokshitha 20rs for milk", []), {
    ok: true, newCustomerName: "mokshitha", kind: "credit", amount: "20",
    items: [{ label: "milk", amountPaise: 2000 }],
  });
  assert.deepEqual(parseVoiceCommand("new name Mokshitha 20rs for Milk", []), {
    ok: true, newCustomerName: "Mokshitha", kind: "credit", amount: "20",
    items: [{ label: "Milk", amountPaise: 2000 }],
  });
});

test("the user's bare leading Deep example prepares a new ₹50 itemized draft", () => {
  assert.deepEqual(parseVoiceCommand("deep 20rs for curd, 30rs for dal", []), {
    ok: true, newCustomerName: "deep", kind: "credit", amount: "50",
    items: [{ label: "curd", amountPaise: 2000 }, { label: "dal", amountPaise: 3000 }],
  });
  const connected = parseVoiceCommand("Deep 20 rs for Curd and 30 rs for Dal", []);
  assert.equal(connected.ok, true); assert.equal(connected.newCustomerName, "Deep"); assert.equal(connected.amount, "50");
});

test("exact leading existing names are reused even with new-name prefixes", () => {
  const list = [{ id: "m", name: "Mokshitha" }, { id: "d", name: "Deep" }];
  const milk = parseVoiceCommand("new name mokshitha 20rs for milk", list);
  assert.equal(milk.ok, true); assert.equal(milk.customerId, "m"); assert.equal(milk.newCustomerName, undefined);
  const bill = parseVoiceCommand("deep 20rs for curd, 30rs for dal", list);
  assert.equal(bill.ok, true); assert.equal(bill.customerId, "d"); assert.equal(bill.amount, "50");
});

test("Telugu new-customer forms and explicit multiword name boundaries are supported", () => {
  const telugu = parseVoiceCommand("కొత్త కస్టమర్ మోక్షిత పాలు20 మరియు పప్పు30 బాకీ నమోదు చేయి", []);
  assert.equal(telugu.ok, true); assert.equal(telugu.newCustomerName, "మోక్షిత"); assert.equal(telugu.amount, "50");
  const priceFirst = parseVoiceCommand("కొత్త పేరు మోక్షిత ౨౦రూ కోసం పాలు మరియు ౩౦రూ కోసం పప్పు", []);
  assert.equal(priceFirst.ok, true); assert.equal(priceFirst.amount, "50");
  const fullName = parseVoiceCommand("new customer Mokshitha Reddy, Milk20, Dal30 credit", []);
  assert.equal(fullName.ok, true); assert.equal(fullName.newCustomerName, "Mokshitha Reddy"); assert.equal(fullName.amount, "50");
  const nameMarker = parseVoiceCommand("మోక్షిత పేరుతో పాలు20 మరియు పప్పు30 బాకీ", []);
  assert.equal(nameMarker.ok, true); assert.equal(nameMarker.newCustomerName, "మోక్షిత");
});

test("existing customers are resolved from the leading name, never from item names", () => {
  const list = [{ id: "curd-person", name: "curd" }, { id: "ravi-person", name: "Ravi" }];
  const result = parseVoiceCommand("Deep 20rs for curd, 30rs for Ravi rice", list);
  assert.equal(result.ok, true); assert.equal(result.newCustomerName, "Deep"); assert.equal(result.customerId, undefined);
  assert.deepEqual(result.items.map((item) => item.label), ["curd", "Ravi rice"]);
  rejected("Deep 20rs for curd, Ravi 30rs for dal", list);
});

test("new names are not fuzzy-merged and ambiguous product-only prefixes need clarification", () => {
  const result = parseVoiceCommand("Deepa 20rs for milk", [{ id: "deep", name: "Deep" }]);
  assert.equal(result.ok, true); assert.equal(result.newCustomerName, "Deepa");
  for (const text of ["milk20, dal30", "red gram dal20", "Deep and Ravi 20rs for milk", "new name 20rs for milk", "new name Mokshitha 20 paid"]) rejected(text, []);
});

test("price-first drafts reject missing labels, grand totals, quantities and corrections", () => {
  for (const text of [
    "Deep 20rs for milk, 30rs for", "Deep 20rs for milk, dal30rs", "Deep 20rs for milk and Dal",
    "Deep 20rs for milk total20", "Deep 20rs for milk, 2 packets30rs for dal", "Deep -20rs for milk",
    "Deep 0rs for milk", "Deep 20.001rs for milk", "Deep 20rs for milk, no 30rs for milk",
    "new name Mokshitha 20rs for milk and received30", "Deep 20rs for milk, new name Ravi 30rs for dal",
  ]) rejected(text, []);
});

test("English dues and repayment keywords preserve explicit financial direction", () => {
  const list = [{ id: "d", name: "Deep" }];
  assert.deepEqual(parseVoiceCommand("Deep 20rs due", list), { ok: true, customerId: "d", kind: "credit", amount: "20" });
  assert.deepEqual(parseVoiceCommand("Deep 10rs paid", list), { ok: true, customerId: "d", kind: "payment", amount: "10" });
  rejected("Deep 20rs due paid", list);
});

test("a bounded full customer name takes priority over a shorter existing prefix", () => {
  const saved = [{ id: "r", name: "Ravi" }];
  for (const speech of [
    "new customer Ravi Kumar: milk20, dal50",
    "Ravi Kumar: milk20, dal50",
    "new customer Ravi Kumar, milk20, dal50",
    "Ravi Kumar 20rs for milk, 50rs for dal",
  ]) {
    const draft = parseVoiceCommand(speech, saved);
    assert.equal(draft.ok, true, speech);
    assert.equal(draft.customerId, undefined);
    assert.equal(draft.newCustomerName, "Ravi Kumar");
    assert.equal(draft.amount, "70");
    assert.deepEqual(draft.items.map((item) => item.label), ["milk", "dal"]);
  }
  const fullSaved = [...saved, { id: "rk", name: "Ravi Kumar" }];
  const existing = parseVoiceCommand("Ravi Kumar: milk20, dal50", fullSaved);
  assert.equal(existing.ok, true); assert.equal(existing.customerId, "rk"); assert.equal(existing.newCustomerName, undefined);
  rejected("Ravi milk, dal50", saved);
});

test("cash-sale descriptors cannot be converted into unpaid credit", () => {
  const list = [{ id: "r", name: "Ravi" }];
  for (const descriptor of ["cash", "Cash", "నగదు", "నగదుగా", "క్యాష్"]) {
    rejected(`Ravi 20 rs for milk ${descriptor}`, list);
    rejected(`new name Deep 20rs for curd ${descriptor}`, []);
  }
});

test("the Telugu new-customer tip accepts a clearly delimited name", () => {
  const draft = parseVoiceCommand("కొత్త కస్టమర్ దీప్, పాలు 20 మరియు పప్పు 30 బాకీ నమోదు చేయి.", []);
  assert.equal(draft.ok, true); assert.equal(draft.newCustomerName, "దీప్"); assert.equal(draft.amount, "50");
});

test("the exact natural Telugu screenshot phrase prepares three items totalling ₹60", () => {
  const speech = "కొత్త కస్టమర్ ఆయుష్, 20 రూపాయలు పెరుగుకి, 30 రూపాయలు కందిపప్పుకి, 10 రూపాయలు చింతపండుకి నమోదు.";
  const expectedItems = [
    { label: "పెరుగు", amountPaise: 2000 },
    { label: "కందిపప్పు", amountPaise: 3000 },
    { label: "చింతపండు", amountPaise: 1000 },
  ];
  const fresh = parseVoiceCommand(speech, []);
  assert.equal(fresh.ok, true); assert.equal(fresh.newCustomerName, "ఆయుష్"); assert.equal(fresh.amount, "60");
  assert.deepEqual(fresh.items, expectedItems);
  const existing = parseVoiceCommand(speech, [{ id: "ayush", name: "ఆయుష్" }, { id: "other", name: "రవి" }]);
  assert.equal(existing.ok, true); assert.equal(existing.customerId, "ayush"); assert.equal(existing.newCustomerName, undefined);
  assert.deepEqual(existing.items, expectedItems);
});

test("spaced Telugu and Roman ki/ku markers work with price-first groceries", () => {
  for (const suffix of ["కి", "కు"]) {
    const draft = parseVoiceCommand(`కొత్త కస్టమర్ ఆయుష్, 20 రూపాయలు పెరుగు ${suffix} మరియు 30 రూపాయలు కందిపప్పు ${suffix}`, []);
    assert.equal(draft.ok, true); assert.equal(draft.amount, "50");
    assert.deepEqual(draft.items.map((item) => item.label), ["పెరుగు", "కందిపప్పు"]);
  }
  const roman = parseVoiceCommand("Deep 20rs curd ki, 30rs dal ku", []);
  assert.equal(roman.ok, true); assert.equal(roman.newCustomerName, "Deep"); assert.equal(roman.amount, "50");
  assert.deepEqual(roman.items.map((item) => item.label), ["curd", "dal"]);
  const attachedKu = parseVoiceCommand("ఆయుష్ 20 రూపాయలు పెరుగుకు, 30 రూపాయలు కందిపప్పుకు", []);
  assert.equal(attachedKu.ok, true); assert.equal(attachedKu.newCustomerName, "ఆయుష్"); assert.equal(attachedKu.amount, "50");
});

test("dative purchase boundaries preserve full-name priority and existing targets", () => {
  const shortSaved = [{ id: "ravi", name: "Ravi" }];
  const full = parseVoiceCommand("Ravi Kumar 20 రూపాయలు పెరుగుకి", shortSaved);
  assert.equal(full.ok, true); assert.equal(full.newCustomerName, "Ravi Kumar"); assert.equal(full.customerId, undefined);
  const saved = parseVoiceCommand("ఆయుష్ 20 రూపాయలు పెరుగుకి", [{ id: "ayush", name: "ఆయుష్" }, { id: "curd", name: "పెరుగు" }]);
  assert.equal(saved.ok, true); assert.equal(saved.customerId, "ayush");
  rejected("కొత్త కస్టమర్ ఆయుష్, 20 రూపాయలు పెరుగుకి, రవి 30 రూపాయలు కందిపప్పుకి", [{ id: "ravi", name: "రవి" }]);
});

test("intrinsic Telugu endings and unfamiliar dative labels are not blindly stripped", () => {
  const intrinsic = parseVoiceCommand("కొత్త కస్టమర్ ఆయుష్, 20 రూపాయలు సరుకు", []);
  assert.equal(intrinsic.ok, true); assert.deepEqual(intrinsic.items, [{ label: "సరుకు", amountPaise: 2000 }]);
  const unknown = parseVoiceCommand("కొత్త కస్టమర్ ఆయుష్, 20 రూపాయలు సరుకుకి", []);
  assert.equal(unknown.ok, true); assert.equal(unknown.items[0].label, "సరుకుకి");
  const name = parseVoiceCommand("కొత్త కస్టమర్ సరుకు, 20 రూపాయలు పెరుగుకి", []);
  assert.equal(name.ok, true); assert.equal(name.newCustomerName, "సరుకు");
});

test("dative endings cannot disguise cash, repayments, negation, units or grand totals", () => {
  for (const tail of ["cashకి", "cashకు", "నగదుకి", "paidకి", "paymentకు", "కొత్తకి", "totalకి", "మొత్తంకు", "లీటరుకి", "కిలోకి", "కిలోలకు", "చేయకు", "కాదుకి"]) {
    rejected(`కొత్త కస్టమర్ ఆయుష్, 20 రూపాయలు పెరుగుకి ${tail}`, []);
  }
  rejected("కొత్త కస్టమర్ ఆయుష్, 2 లీటరుకి 20 రూపాయలు పెరుగుకి", []);
  rejected("కొత్త కస్టమర్ ఆయుష్, 20 రూపాయలు పెరుగుకి, 2 కిలోలకి 30 రూపాయలు కందిపప్పుకి", []);
});

test("natural dative speech still needs one clear label for every price", () => {
  for (const text of [
    "20 రూపాయలు కి", "20 రూపాయలు పెరుగుకి, కందిపప్పుకి", "20 రూపాయలు పెరుగుకి పెరుగుకి",
    "20 రూపాయలు పెరుగుకి, 30 రూపాయలు కి", "20 రూపాయలు పెరుగుకి మరియు కందిపప్పుకి, 30 రూపాయలు చింతపండుకి",
  ]) rejected(`కొత్త కస్టమర్ ఆయుష్, ${text}`, []);
});

test("a dative credit action is not mistaken for a price-first product marker", () => {
  const list = [{ id: "r", name: "Ravi" }];
  const draft = parseVoiceCommand("Ravi Milk20 రూపాయలు బాకీకి చేర్చండి", list);
  assert.equal(draft.ok, true); assert.equal(draft.customerId, "r"); assert.equal(draft.newCustomerName, undefined);
  assert.deepEqual(draft.items, [{ label: "Milk", amountPaise: 2000 }]);
  rejected("కొత్త కస్టమర్ ఆయుష్, 20 రూపాయలు బాకీకు", []);
});
