// AI understanding: turns free speech (Telugu, Hindi, English or mixed) into a
// ledger draft. The model only proposes; everything is validated here and the
// shopkeeper still confirms before anything is saved.
type Customer = { id: string; name: string };
export type Understood =
  | { ok: true; kind: "credit" | "payment"; amount: string; items?: { label: string; amountPaise: number }[]; customerId?: string; newCustomerName?: string }
  | { ok: true; kind: "balance"; customerId: string }
  | { ok: false; message: string };

const MAX_PAISE = 100_000_000;
const UNCLEAR = "అర్థం కాలేదు. పేరు, వస్తువు, ధర మళ్లీ చెప్పండి. / Not clear. Say the name, item and price again.";

export function buildMessages(text: string, customers: Customer[]) {
  const list = customers.slice(0, 300).map((customer) => `${customer.id}: ${customer.name}`).join("\n") || "(none yet)";
  const system = `You read one spoken instruction from an Indian kirana shopkeeper and return ONE ledger action as JSON.
Speech may be Telugu, Hindi, English or a mix, in any script.

Actions:
- "credit": the customer took goods on credit / now owes money (e.g. "ramu ki paalu 20", "సీతకి బియ్యం 50 బాకీ", "deep 30rs dal").
- "payment": the customer paid back money (ఇచ్చాడు, ఇచ్చింది, కట్టాడు, చెల్లించాడు, paid, gave, returned, jama, diya, de diya).
- "balance": the shopkeeper asks how much a customer owes (ఎంత, బాకీ ఎంత, kitna, how much).
- "unclear": anything else, several different actions, a correction, or a missing price.

Existing customers (id: name):
${list}

Rules:
- "spokenName" is the customer's name exactly as spoken, in the spoken script, without suffixes like కి/కు/ki/ka/గారు.
- "customerId" must be one of the ids listed above (match across scripts or small spelling changes: రాము = ramu = Raamu), or null if nobody matches. Never put a name in "customerId".
- Convert number words to digits (ఇరవై=20, ముప్పై=30, యాభై=50, డెబ్బై=70, వంద=100, నూట యాభై=150, రెండు వందలు=200, బీస్=20, pachaas=50).
- For credit, list each item with its FINAL line price in rupees. If a quantity and unit rate are given (2 kg at 40), the price is 80. Put the quantity in the label ("బియ్యం 2 kg"). Keep labels short (just the item name, never the price), in the spoken language.
- If any item has no price, use "unclear". Never invent prices.
- For payment, set "amount" and leave items empty.
- A NEW customer is normal for credit: set customerId null and give spokenName. Words like "కొత్త కస్టమర్", "new customer", "naya grahak" just introduce the new name; they are not part of it. Payments and balance need a listed customer.

Examples (ids are illustrative):
"రాముకి పాలు ఇరవై, బియ్యం యాభై" → {"action":"credit","spokenName":"రాము","customerId":"<ramu's id or null>","items":[{"label":"పాలు","price":20},{"label":"బియ్యం","price":50}],"amount":null}
"కొత్త కస్టమర్ లక్ష్మి, పెరుగు ముప్పై" → {"action":"credit","spokenName":"లక్ష్మి","customerId":null,"items":[{"label":"పెరుగు","price":30}],"amount":null}
"సీత వంద రూపాయలు ఇచ్చింది" → {"action":"payment","spokenName":"సీత","customerId":"<sita's id>","items":[],"amount":100}
"ramu ka kitna baaki hai" → {"action":"balance","spokenName":"ramu","customerId":"<ramu's id>","items":[],"amount":null}

Return only JSON: {"action":"credit|payment|balance|unclear","spokenName":string|null,"customerId":string|null,"items":[{"label":string,"price":number}],"amount":number|null}`;
  return [{ role: "system", content: system }, { role: "user", content: text.slice(0, 1000) }];
}

function toPaise(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value.replace(/[,₹\s]/g, "")) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return undefined;
  const paise = Math.round(number * 100);
  return paise > 0 && paise <= MAX_PAISE ? paise : undefined;
}
const rupees = (paise: number) => (paise / 100).toFixed(paise % 100 ? 2 : 0);
const cleanLabel = (value: unknown) => typeof value === "string" ? value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 80) : "";

const priceWords = "(?:rs\\.?|rupees?|rupaye|rupay|రూపాయలు|రూపాయల|రూపాయి|రూ\\.?|₹)";
/** "paalu 20 rupees" with price ₹20 → "paalu". Quantities like "rice 2 kg" are kept. */
export function stripPrice(label: string, paise: number): string {
  const price = rupees(paise).replace(".", "\\.");
  const pattern = new RegExp(`\\s*(?:${priceWords}\\s*)?${price}\\s*(?:${priceWords})?\\s*$`, "iu");
  const stripped = label.replace(pattern, "").replace(/\s*(?:ka|ki|కి|కు)$/u, "").trim();
  return stripped || label;
}

/** Validate untrusted model output against the real customer list. */
export function validateUnderstanding(raw: unknown, customers: Customer[]): Understood {
  if (!raw || typeof raw !== "object") return { ok: false, message: UNCLEAR };
  const data = raw as Record<string, unknown>;
  const action = data.action;
  const existing = typeof data.customerId === "string" ? customers.find((customer) => customer.id === data.customerId) : undefined;
  let newName = cleanLabel(data.spokenName ?? data.newCustomerName).replace(/\s*(?:గారికి|గారు|కి|కు)$/u, "").slice(0, 60);
  // A "new" name that equals a saved name is that customer.
  const sameName = newName ? customers.find((customer) => customer.name.toLocaleLowerCase() === newName.toLocaleLowerCase()) : undefined;
  const customer = existing ?? sameName;
  if (customer) newName = "";

  if (action === "balance") {
    return customer ? { ok: true, kind: "balance", customerId: customer.id } : { ok: false, message: "ఈ పేరుతో కస్టమర్ లేరు. / No saved customer with that name." };
  }
  if (action === "payment") {
    if (!customer) return { ok: false, message: "డబ్బులు ఇచ్చిన కస్టమర్ పేరు దొరకలేదు. / A payment needs a saved customer." };
    const paise = toPaise(data.amount);
    return paise ? { ok: true, kind: "payment", customerId: customer.id, amount: rupees(paise) } : { ok: false, message: UNCLEAR };
  }
  if (action === "credit") {
    if (!customer && !newName) return { ok: false, message: UNCLEAR };
    const rawItems = Array.isArray(data.items) ? data.items.slice(0, 20) : [];
    const items: { label: string; amountPaise: number }[] = [];
    for (const item of rawItems) {
      if (!item || typeof item !== "object") return { ok: false, message: UNCLEAR };
      const paise = toPaise((item as Record<string, unknown>).price);
      const label = paise ? stripPrice(cleanLabel((item as Record<string, unknown>).label), paise) : "";
      if (!label || !paise) return { ok: false, message: UNCLEAR };
      items.push({ label, amountPaise: paise });
    }
    const target = customer ? { customerId: customer.id } : { newCustomerName: newName };
    if (items.length) {
      const total = items.reduce((sum, item) => sum + item.amountPaise, 0);
      if (total > MAX_PAISE) return { ok: false, message: UNCLEAR };
      return { ok: true, kind: "credit", ...target, amount: rupees(total), items };
    }
    const paise = toPaise(data.amount);
    return paise ? { ok: true, kind: "credit", ...target, amount: rupees(paise) } : { ok: false, message: UNCLEAR };
  }
  return { ok: false, message: UNCLEAR };
}

/** Pull the first JSON object out of model text (tolerates code fences or think blocks). */
export function extractJson(content: string): unknown {
  const text = content.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return undefined; }
}

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleUnderstand(request: Request, key: string, providerFetch: typeof fetch = fetch): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ code: "BAD_REQUEST" }, 400); }
  const { text, customers } = (body ?? {}) as { text?: unknown; customers?: unknown };
  if (typeof text !== "string" || !text.trim() || text.length > 2000) return json({ code: "BAD_REQUEST" }, 400);
  const list: Customer[] = Array.isArray(customers)
    ? customers.filter((c): c is Customer => !!c && typeof c.id === "string" && typeof c.name === "string").slice(0, 300).map((c) => ({ id: c.id.slice(0, 64), name: c.name.slice(0, 60) }))
    : [];
  try {
    const response = await providerFetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-subscription-key": key.trim(), Authorization: `Bearer ${key.trim()}` },
      body: JSON.stringify({ model: "sarvam-105b-conversations", temperature: 0.1, max_tokens: 600, response_format: { type: "json_object" }, messages: buildMessages(text, list) }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
      cache: "no-store",
    });
    if (!response.ok) return json({ code: "PROVIDER", providerStatus: response.status }, 502);
    const data = await response.json() as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") return json({ code: "PROVIDER" }, 502);
    return json({ result: validateUnderstanding(extractJson(content), list) });
  } catch {
    return json({ code: "NETWORK" }, 502);
  }
}
