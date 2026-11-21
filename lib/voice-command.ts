type Customer = { id: string; name: string };
type CustomerTarget = { customerId: string; newCustomerName?: never } | { customerId?: never; newCustomerName: string };
export type VoiceCommandResult =
  | ({ ok: true; kind: "credit" | "payment"; amount: string; items?: { label: string; amountPaise: number }[] } & CustomerTarget)
  | { ok: false; message: string };

type Token = { value: string; start: number; end: number };
const creditWords = new Set(["బాకీ", "బాకీకి", "బాకీగా", "బాకీలో", "due", "dues", "credit"]);
const paymentWords = new Set([
  "చెల్లించాడు", "చెల్లించారు", "చెల్లించా", "చెల్లించింది",
  "అందాయి", "అందింది", "ఇచ్చాడు", "ఇచ్చారు", "ఇచ్చింది", "కట్టాడు", "కట్టారు", "కట్టింది", "paid", "payment", "repayment", "received", "gave", "given", "returned", "jama", "చెల్లింపు",
]);
const correctionWords = new Set([
  "కాదు", "కాదండి", "కాకుండా", "వద్దు", "చేయకు", "చేయొద్దు", "రద్దు", "బదులు",
  "మార్చు", "మార్చండి", "సవరించు", "సవరించండి", "తప్పు", "లేదులేదు",
  "no", "not", "cancel", "undo", "instead", "sorry", "correction",
]);
const multipleActionWords = new Set([
  "మరియు", "అలాగే", "తర్వాత", "తరువాత", "చేసి", "మళ్లీ", "మళ్ళీ", "and", "then", "also", "plus",
]);
const queryWords = new Set(["ఎంత", "చెప్పు", "చెప్పండి", "బ్యాలెన్స్", "మిగిలిన", "మిగిలింది", "balance"]);
const amountMultipliers = new Set([
  "వంద", "వందలు", "వందల", "వెయ్యి", "వేయి", "వేలు", "లక్ష", "లక్షలు", "కోటి", "కోట్లు",
  "hundred", "thousand", "lakh", "lakhs", "crore", "crores", "k",
]);
const fillerWords = new Set([
  "పేరుతో", "పేరున", "పేరు", "మీద", "ఖాతాలో", "ఖాతాకు", "కు", "కి", "గారికి", "కోసం",
  "మొత్తం", "డబ్బులు", "డబ్బు", "రూ", "రూపాయలు", "రూపాయల", "రూపాయలను", "రూపాయల్ని", "రూపాయి", "రూపాయ",
  "నమోదు", "చేయి", "చేయండి", "చెయ్యి", "చెయ్యండి", "చేయాలి", "రాయి", "రాయండి", "చేర్చు", "చేర్చండి", "చేర్చాలి",
  "జోడించు", "జోడించండి", "దయచేసి", "అని", "ఎంట్రీ", "rupees", "rupee", "rs", "inr", "please",
]);
const itemConnectors = new Set(["మరియు", "and"]);
const totalWords = new Set(["మొత్తం", "మొత్తము", "మొత్తంగా", "మొత్తానికి", "టోటల్", "total", "subtotal", "grand"]);
const itemForbiddenWords = new Set([
  ...amountMultipliers,
  "నిన్న", "రేపు", "ఈరోజు", "నేడు", "yesterday", "today", "tomorrow",
  "లీటరు", "లీటర్", "లీటర్లు", "లీటర్ల", "కిలో", "కిలోలు", "కిలోల", "గ్రాము", "గ్రాములు", "గ్రాముల",
  "kg", "kgs", "g", "gm", "grams", "litre", "litres", "liter", "liters", "ml", "per", "each", "rate", "unit", "units", "quantity", "qty", "x",
  "pack", "packs", "packet", "packets", "piece", "pieces", "bottle", "bottles", "carton", "cartons", "ప్యాకెట్", "ప్యాకెట్లు", "ప్యాకెట్ల", "పీస్", "పీసులు", "సీసా", "సీసాలు",
  "paid", "payment", "repayment", "received", "gave", "given", "returned", "jama", "refund", "discount", "తగ్గింపు",
  "minus", "less", "subtract", "deduct", "reduce", "remove", "off",
  "new", "name", "customer", "కొత్త", "కస్టమర్",
  "cash", "cashsale", "నగదు", "నగదుగా", "క్యాష్",
  "మైనస్", "తగ్గించు", "తగ్గించండి", "తగ్గించాలి", "తగ్గించి", "తీసి", "తీసేయి", "తీసివేయి", "తీసివేయండి", "మినహాయించు",
]);
const amountPattern = /[+\-−–]?\s*(?:\d(?:[\d,]*\d)?(?:\.\d+)?|\.\d+)/gu;
const validAmountFormat = /^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/u;
const purchaseMarkers = new Set(["for", "కోసం", "కి", "కు", "ki", "ku"]);
// Only familiar surface forms are rewritten for display. Unknown nouns such as
// సరుకు keep their full spelling; suffix removal is never applied to names.
const familiarDatives = new Map([
  ["పెరుగుకి", "పెరుగు"], ["పెరుగుకు", "పెరుగు"],
  ["కందిపప్పుకి", "కందిపప్పు"], ["కందిపప్పుకు", "కందిపప్పు"],
  ["చింతపండుకి", "చింతపండు"], ["చింతపండుకు", "చింతపండు"],
  ["పాలకి", "పాలు"], ["పాలకు", "పాలు"],
  ["పప్పుకి", "పప్పు"], ["పప్పుకు", "పప్పు"],
]);

function normalize(text: string, preserveCase = false): string {
  const normalized = text.normalize("NFC").replace(/[౦-౯]/g, (digit) => String(digit.charCodeAt(0) - 0x0c66))
    .replace(/[\u200c\u200d]/g, "")
    .replace(/(\d)(rs|rupees?|రూ|రూపాయలు|రూపాయల|రూపాయి)(?=$|[\s,;:.])/giu, "$1 $2");
  return preserveCase ? normalized : normalized.toLowerCase();
}

function tokenize(text: string): Token[] {
  return Array.from(text.matchAll(/[\p{L}\p{M}\p{N}]+/gu), (match) => ({
    value: match[0], start: match.index, end: match.index + match[0].length,
  }));
}

// These variants are used only by semantic guards/scaffolding, not to guess a
// product's spelling. Thus paidకి/cashకు/చేయకు cannot become grocery labels.
function guardedForms(word: string): string[] {
  const withoutDative = word.replace(/(?:కి|కు)$/u, "");
  return withoutDative !== word && withoutDative ? [word, withoutDative] : [word];
}

function hasPurchaseMarker(segment: string): boolean {
  const words = Array.from(segment.matchAll(/[\p{L}\p{M}]+/gu), (match) => match[0]);
  return words.some((word) => purchaseMarkers.has(word) ||
    (/[\p{L}\p{M}]+(?:కి|కు)$/u.test(word) && !guardedForms(word).some((form) =>
      creditWords.has(form) || paymentWords.has(form) || correctionWords.has(form) || queryWords.has(form) ||
      itemForbiddenWords.has(form) || totalWords.has(form) || fillerWords.has(form))));
}

function firstPurchaseSegment(text: string): string {
  const split = /[,;]|(?:^|\s)(?:and|మరియు)(?=$|\s)/u.exec(text);
  return split ? text.slice(0, split.index) : text;
}

function failure(message: string): { ok: false; message: string } { return { ok: false, message }; }

type TargetResult = { ok: true; target: CustomerTarget; instruction: string; displayInstruction: string } | { ok: false; message: string };

function resolveTarget(text: string, displayText: string, customers: Customer[]): TargetResult {
  const prefix = /^(?:(?:new\s+(?:name|customer))|(?:customer|name)|(?:కొత్త\s+(?:కస్టమర్|పేరు))|కస్టమర్|పేరు)(?:\s*[:,-]\s*|\s+)/u.exec(text);
  const offset = prefix?.[0].length ?? 0;
  const body = text.slice(offset);
  const displayBody = displayText.slice(offset);
  const tokens = tokenize(body);
  if (!tokens.length || tokens[0].start !== 0) return failure("ముందుగా కస్టమర్ పేరు చెప్పండి. / Start with the customer name.");
  const reserved = new Set([...creditWords, ...paymentWords, ...correctionWords, ...queryWords, ...multipleActionWords, ...fillerWords, ...itemForbiddenWords, ...totalWords]);
  const namedTarget = (nameEnd: number): TargetResult => {
    const displayedName = displayBody.slice(0, nameEnd).trim().replace(/\s+/g, " ");
    const exact = customers.filter((customer) => normalize(customer.name).trim().replace(/\s+/g, " ") === normalize(displayedName));
    if (exact.length > 1) return failure("ఈ పేరుతో ఒకటి కంటే ఎక్కువ కస్టమర్లు ఉన్నారు. / Select the intended customer manually.");
    const nameWords = tokenize(normalize(displayedName)).map((token) => token.value);
    if (!exact.length && (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u.test(displayedName) || displayedName.length > 60 || !nameWords.length || nameWords.length > 4 || nameWords.some((word) => reserved.has(word)))) {
      return failure("కొత్త పేరు స్పష్టంగా లేదు. / Use a clear customer name without amounts or additional instructions.");
    }
    const target: CustomerTarget = exact.length ? { customerId: exact[0].id } : { newCustomerName: displayedName };
    return { ok: true, target, instruction: body.slice(nameEnd), displayInstruction: displayBody.slice(nameEnd) };
  };
  const leading = customers.flatMap((customer) => {
    const name = tokenize(normalize(customer.name)).map((token) => token.value);
    if (!name.length || name.length > tokens.length || !name.every((word, index) => tokens[index].value === word)) return [];
    return [{ customer, end: tokens[name.length - 1].end }];
  });

  const firstPrice = [...body.matchAll(amountPattern)][0];
  const beforePrice = firstPrice ? body.slice(0, firstPrice.index) : "";
  const afterPrice = firstPrice ? body.slice(firstPrice.index + firstPrice[0].length) : "";
  const nameMarker = /(?:\s*[:,;]\s*|\s+(?:పేరుతో|పేరున)\s+)/u.exec(beforePrice);
  const priceFirst = hasPurchaseMarker(firstPurchaseSegment(afterPrice));

  // Resolve an explicitly bounded full name before considering a shorter saved
  // prefix: Ravi Kumar is not Ravi with an item called "Kumar milk".
  if (nameMarker) {
    const candidate = normalize(displayBody.slice(0, nameMarker.index)).trim().replace(/\s+/g, " ");
    const exactName = customers.some((customer) => normalize(customer.name).trim().replace(/\s+/g, " ") === candidate);
    if (prefix || nameMarker[0].includes(":") || /పేరుతో|పేరున/u.test(nameMarker[0]) || exactName || !leading.length) return namedTarget(nameMarker.index);
    // A bare comma after a shorter known name could instead separate an item
    // whose price is missing. Ask rather than create a longer customer name.
    return failure("పూర్తి కస్టమర్ పేరు తర్వాత కోలన్ వాడండి. / Put a colon after the full customer name, or say “new customer”, so a missing item price cannot be mistaken for a name.");
  }
  if (priceFirst && firstPrice) {
    const resolved = namedTarget(firstPrice.index);
    if (resolved.ok) return resolved;
    if (!leading.length) return resolved;
  }
  if (leading.length > 1) return failure("ఒకటి కంటే ఎక్కువ కస్టమర్ పేర్లు సరిపోలాయి. / More than one customer matches; select the customer manually.");
  if (leading.length === 1) {
    const found = leading[0];
    return { ok: true, target: { customerId: found.customer.id }, instruction: body.slice(found.end), displayInstruction: displayBody.slice(found.end) };
  }

  if (!firstPrice) return failure("కస్టమర్ పేరు, వస్తువు, ధర చెప్పండి. / Say a customer name, item, and price in digits.");
  let nameEnd: number;
  if (prefix) {
    // Without a delimiter, an explicit new-customer phrase uses one name token.
    // Multiword names can be followed by a comma/colon or a price-first phrase.
    nameEnd = tokens[0].end;
  } else {
    return failure("కొత్త కస్టమర్ పేరు స్పష్టంగా చెప్పండి. / For a new customer, say “new name Mokshitha 20 rs for milk” or “కొత్త కస్టమర్ మోక్షిత, పాలు20”.");
  }
  return namedTarget(nameEnd);
}

function amountParts(raw: string): { amount: string; paise: number } | null {
  if (!validAmountFormat.test(raw)) return null;
  const amount = raw.replaceAll(",", "");
  const [rupees, fraction = ""] = amount.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(paise) && paise > 0 && paise <= 100_000_000 ? { amount, paise } : null;
}

/** Each labelled number is a complete line price; quantities are never inferred. */
function parseItemizedCredit(instruction: string, displayInstruction: string, target: CustomerTarget, customers: Customer[], implicitCredit: boolean): VoiceCommandResult {
  // Item speech often has no space between a noun and its price. Split words
  // from digits here so “litres20”, “total70”, or “కాదు60” cannot evade guards.
  const words = Array.from(instruction.matchAll(/[\p{L}\p{M}]+/gu), (match) => match[0]).flatMap(guardedForms);
  if (words.some((word) => correctionWords.has(word) || queryWords.has(word) || paymentWords.has(word))) {
    return failure("ఒక బిల్లు మాత్రమే చెప్పండి. / Keep corrections, balance questions, and repayments separate from an itemized credit bill.");
  }
  if (words.some((word) => totalWords.has(word))) {
    return failure("వస్తువుల ధరలు మాత్రమే చెప్పండి. / Say item prices only; the app calculates the total. Do not include a separate grand total.");
  }
  if (words.some((word) => itemForbiddenWords.has(word) || (multipleActionWords.has(word) && !itemConnectors.has(word))) || /[@×=]/u.test(instruction)) {
    return failure("ఒక్కో వస్తువు పూర్తి ధరను చెప్పండి. / Give one line total per item, without quantities, unit rates, payments, or additional instructions.");
  }
  if (/[\-−–]\s*(?:₹|రూ\.?|rs\.?|inr)?\s*\d/iu.test(instruction)) {
    return failure("వస్తువుల ధరలు సున్నా కంటే ఎక్కువగా ఉండాలి. / Every item must have a positive price.");
  }
  const numbers = [...instruction.matchAll(amountPattern)];
  if (!numbers.length || numbers.length > 20) return failure("ఒక బిల్లులో 1–20 వస్తువులు చెప్పండి. / Use 1–20 items with prices in digits.");
  const scaffolding = new Set([...fillerWords, ...creditWords, ...itemConnectors, ...purchaseMarkers]);
  const isScaffolding = (word: string) => guardedForms(word).some((form) => scaffolding.has(form));
  const labelFrom = (segment: string, displayedSegment: string): string | null => {
    if (/[^\p{L}\p{M}\s,;:.₹'’\-]/u.test(segment)) return null;
    const groups: Token[][] = [[]];
    let previousEnd = 0;
    for (const token of tokenize(segment)) {
      if (/[,;]/u.test(segment.slice(previousEnd, token.start)) || itemConnectors.has(token.value)) groups.push([]);
      if (!isScaffolding(token.value)) groups[groups.length - 1].push(token);
      previousEnd = token.end;
    }
    // A comma or conjunction separates items, not words in a product name.
    // Two named groups before one price mean an earlier item's price is missing.
    const namedGroups = groups.filter((group) => group.length);
    if (namedGroups.length !== 1) return null;
    const labelTokens = namedGroups[0];
    if (labelTokens.some((token) => /\p{N}/u.test(token.value))) return null;
    const labelParts = labelTokens.map((token) => familiarDatives.get(token.value) ?? displayedSegment.slice(token.start, token.end));
    if (labelParts.some((part, index) => index > 0 && normalize(part) === normalize(labelParts[index - 1]))) return null;
    const label = labelParts.join(" ").trim();
    return label.length <= 80 ? label : null;
  };
  const items: { label: string; amountPaise: number }[] = [];
  let cursor = 0;
  let totalPaise = 0;
  const firstPrefix = instruction.slice(0, numbers[0].index);
  const priceFirst = !tokenize(firstPrefix).some((token) => !isScaffolding(token.value));
  for (let index = 0; index < numbers.length; index++) {
    const number = numbers[index];
    const before = instruction.slice(cursor, number.index);
    const numberEnd = number.index + number[0].length;
    const nextStart = numbers[index + 1]?.index ?? instruction.length;
    const labelSegment = priceFirst ? instruction.slice(numberEnd, nextStart) : before;
    const displaySegment = priceFirst ? displayInstruction.slice(numberEnd, nextStart) : displayInstruction.slice(cursor, number.index);
    const separatorSegment = priceFirst ? labelSegment : before;
    if (priceFirst && implicitCredit && !hasPurchaseMarker(labelSegment)) {
      return failure("కొనుగోలు వివరాలు స్పష్టంగా చెప్పండి. / Say “20 రూపాయలు పెరుగుకి” or “20 rs for milk”, or explicitly say బాకీ / dues.");
    }
    if ((priceFirst ? index < numbers.length - 1 : items.length > 0) && !/[,;]/u.test(separatorSegment) && !tokenize(separatorSegment).some((token) => itemConnectors.has(token.value))) {
      return failure("వస్తువులను విడిగా చెప్పండి. / Separate items with a comma or మరియు / and; quantities and prices must not be mixed.");
    }
    const label = labelFrom(labelSegment, displaySegment);
    const price = amountParts(number[0].trim());
    if (!label || !price) {
      return failure("వస్తువు పేరు, తర్వాత పూర్తి ధర చెప్పండి. / Use an item name followed by one positive price, such as పాలు 20, పప్పు 50. Quantities and unlabelled amounts need manual entry.");
    }
    if (!priceFirst && customers.some((customer) => {
      const known = tokenize(normalize(customer.name)).map((token) => token.value);
      const labelWords = tokenize(normalize(label)).map((token) => token.value);
      return known.length && known.every((word, position) => labelWords[position] === word);
    })) return failure("బిల్లులో మరొక కస్టమర్ పేరు వినిపించింది. / Keep one customer per bill; check the item label manually.");
    totalPaise += price.paise;
    if (!Number.isSafeInteger(totalPaise) || totalPaise > 100_000_000) return failure("బిల్లు మొత్తం ₹10,00,000 మించకూడదు. / The bill total must not exceed ₹10,00,000.");
    items.push({ label, amountPaise: price.paise });
    cursor = numberEnd;
  }
  const tail = instruction.slice(cursor);
  const tailWords = tokenize(tail).map((token) => token.value);
  if (!priceFirst && (tailWords.some((word) => !isScaffolding(word) || itemConnectors.has(word)) || /[^\p{L}\p{M}\s,;:.₹]/u.test(tail))) {
    return failure("చివరి వస్తువు ధర తర్వాత అదనపు వివరాలు వినిపించాయి. / Finish each item with its price; edit unclear extra details manually.");
  }
  const remainder = totalPaise % 100;
  const amount = remainder ? `${Math.floor(totalPaise / 100)}.${String(remainder).padStart(2, "0")}` : String(totalPaise / 100);
  return { ok: true, ...target, kind: "credit", amount, items };
}

/**
 * A deliberately small vocabulary for preparing an editable draft, never saving it.
 * A clearly delimited unknown name can be proposed as a new-customer draft.
 * Corrections, word-number amounts, and unclear/multi-action requests need manual
 * review. A successful parse must still use the normal ledger confirmation.
 */
export function parseVoiceCommand(transcript: string, customers: Customer[]): VoiceCommandResult {
  const text = normalize(transcript).trim();
  const displayedText = normalize(transcript, true).trim();
  if (!text || text.length > 2000) return failure("చిన్న వాక్యం చెప్పండి. / Record one short instruction.");
  const resolved = resolveTarget(text, displayedText.length === text.length ? displayedText : text, customers);
  if (!resolved.ok) return resolved;
  const { target, instruction, displayInstruction } = resolved;
  const words = tokenize(instruction).map((token) => token.value);
  if (words.some((word) => correctionWords.has(word)) || /\bdon['’]?t\b/u.test(instruction)) {
    return failure("సవరణను ఊహించలేము. సరైన పేరు, మొత్తం, నమోదు రకాన్ని ఫారంలో సరిచూడండి. / A correction was heard; edit the draft manually.");
  }
  if (words.some((word) => queryWords.has(word)) || instruction.includes("?")) {
    return failure("ఒకసారి ఒక బాకీ లేదా చెల్లింపు మాత్రమే చెప్పండి. / Say one dues or repayment instruction at a time.");
  }
  const credits = words.filter((word) => creditWords.has(word));
  const payments = words.filter((word) => paymentWords.has(word));
  if (credits.length + payments.length > 1) {
    return failure("బాకీ చేర్చాలా, అందిన డబ్బులు నమోదు చేయాలా? / Say one clear action: బాకీ or చెల్లించాడు.");
  }

  const hasItemLabel = words.some((word) => !/^\d+$/u.test(word) && !creditWords.has(word) && !paymentWords.has(word) && !fillerWords.has(word) && !itemConnectors.has(word));
  if (!payments.length && hasItemLabel && /\d/u.test(instruction)) {
    return parseItemizedCredit(instruction, displayInstruction, target, customers, credits.length === 0);
  }
  if (credits.length + payments.length !== 1) {
    return failure("బాకీ చేర్చాలా, అందిన డబ్బులు నమోదు చేయాలా? / Say one clear action: బాకీ or చెల్లించాడు.");
  }
  if (words.some((word) => multipleActionWords.has(word))) {
    return failure("ఒకసారి ఒక బాకీ లేదా చెల్లింపు మాత్రమే చెప్పండి. / Say one dues or repayment instruction at a time.");
  }

  const numbers = [...instruction.matchAll(amountPattern)];
  if (!numbers.length || words.some((word) => amountMultipliers.has(word))) {
    return failure("మొత్తాన్ని అంకెల్లో నమోదు చేయండి, ఉదా: 300. / Enter the full amount in digits manually; spoken number words are not guessed.");
  }
  if (numbers.length !== 1) return failure("ఒకటి కంటే ఎక్కువ మొత్తాలు వినిపించాయి. / Multiple amounts were found; enter the intended amount manually.");

  const rawAmount = numbers[0][0].trim();
  const negative = /[\-−–]\s*(?:₹|రూ\.?|rs\.?|inr)?\s*\d/iu.test(instruction);
  if (negative || !validAmountFormat.test(rawAmount)) {
    return failure("ధనాత్మక మొత్తాన్ని గరిష్ఠంగా రెండు దశాంశాలతో ఇవ్వండి. / Enter a positive amount with up to two decimal places.");
  }
  const amount = rawAmount.replaceAll(",", "");
  const [rupees, fraction = ""] = amount.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise <= 0 || paise > 100_000_000) {
    return failure("మొత్తం ₹0.01 నుండి ₹10,00,000 మధ్య ఉండాలి. / Enter an amount between ₹0.01 and ₹10,00,000.");
  }
  if (words.some((word) => !/^\d+$/u.test(word) && !creditWords.has(word) && !paymentWords.has(word) && !fillerWords.has(word))) {
    return failure("ఈ వాక్యాన్ని స్పష్టంగా అర్థం చేసుకోలేకపోయాము. / Use the exact customer name, one amount in digits, and one action, or fill the form manually.");
  }
  if (payments.length && target.newCustomerName !== undefined) return failure("చెల్లింపు కోసం ఉన్న కస్టమర్‌ను ఎంచుకోండి. / A repayment needs an existing customer with recorded dues.");
  return { ok: true, ...target, kind: credits.length ? "credit" : "payment", amount };
}
