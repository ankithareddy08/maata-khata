import test from "node:test";
import assert from "node:assert/strict";
import { STRINGS, SPEECH_CODE, describe, Problem, isLang } from "../lib/i18n.ts";
import { handleTranscription, speechLanguage } from "../lib/transcription.ts";
import { handleSpeak } from "../lib/speak.ts";
import { heardYesNo } from "../lib/yes-no.ts";
import { parseVoiceCommand } from "../lib/voice-command.ts";
import { validateUnderstanding } from "../lib/understand.ts";

/** Every key path in an object, with functions treated as leaves. */
function shape(value, prefix = "") {
  if (typeof value !== "object" || value === null) return [`${prefix}:${typeof value}`];
  if (Array.isArray(value)) return [`${prefix}:array(${value.length})`, ...value.flatMap((item, index) => shape(item, `${prefix}[${index}]`))];
  return Object.keys(value).sort().flatMap((key) => shape(value[key], prefix ? `${prefix}.${key}` : key));
}

test("Hindi and English have exactly the same text keys as Telugu", () => {
  assert.deepEqual(shape(STRINGS.hi), shape(STRINGS.te));
  assert.deepEqual(shape(STRINGS.en), shape(STRINGS.te));
});

test("no Telugu script leaks into the Hindi or English text", () => {
  const telugu = /[ఀ-౿]/;
  const texts = (value) => typeof value === "string" ? [value] : typeof value === "function" ? [] : Object.values(value).flatMap(texts);
  for (const lang of ["hi", "en"]) for (const text of texts(STRINGS[lang])) assert.doesNotMatch(text, telugu, `${lang}: ${text}`);
});

test("read-back sentences speak in the chosen language", () => {
  assert.equal(STRINGS.hi.readBack.credit("रामू", 7000, 2, 7000), "रामू के 2 सामान, कुल 70 रुपये उधार। कुल उधार 70 रुपये हो जाएगा। सेव करें?");
  assert.equal(STRINGS.hi.readBack.payment("रामू", 3000, 4000), "रामू ने 30 रुपये दिए। अब 40 रुपये उधार बचेगा। सेव करें?");
  assert.equal(STRINGS.en.readBack.balance("Ramu", 4000), "Ramu owes 40 rupees.");
  assert.equal(STRINGS.en.readBack.payment("Ramu", 4000, 0), "Ramu paid 40 rupees. Nothing left to pay. Save?");
  assert.equal(STRINGS.te.readBack.balance("రాము", 0), "రాము బాకీ ఏమీ లేదు.");
});

test("problems are worded in the chosen language", () => {
  assert.equal(describe(new Problem("MIC_DENIED"), "hi"), STRINGS.hi.problems.MIC_DENIED);
  const twoPart = "అర్థం కాలేదు. / Not clear.";
  assert.equal(describe(new Error(twoPart), "te"), twoPart);
  assert.equal(describe(new Error(twoPart), "en"), "Not clear.");
  assert.equal(describe(new Error(twoPart), "hi"), STRINGS.hi.problems.UNCLEAR);
  assert.equal(describe(new Error("Enter a valid amount."), "hi"), "Enter a valid amount.");
  assert.equal(describe(undefined, "en"), STRINGS.en.problems.RETRY);
});

test("only the app's three speech languages reach the provider", () => {
  assert.deepEqual(Object.values(SPEECH_CODE), ["te-IN", "hi-IN", "en-IN"]);
  assert.equal(speechLanguage("hi-IN"), "hi-IN");
  assert.equal(speechLanguage("fr-FR"), "te-IN");
  assert.equal(speechLanguage(undefined), "te-IN");
  assert.equal(isLang("hi"), true);
  assert.equal(isLang("ta"), false);
});

test("speech-to-text sends the chosen language", async () => {
  const form = new FormData();
  form.set("file", new File(["audio"], "speech.wav", { type: "audio/wav" }));
  form.set("language", "hi-IN");
  const request = new Request("http://127.0.0.1:3000/api/transcribe", { method: "POST", headers: { Origin: "http://127.0.0.1:3000" }, body: form });
  let sent;
  const fake = async (_url, init) => { sent = init.body.get("language_code"); return Response.json({ transcript: "रामू को दूध 20" }); };
  const response = await handleTranscription(request, "test-key", fake);
  assert.equal(response.status, 200);
  assert.equal(sent, "hi-IN");
});

test("text-to-speech sends the chosen language", async () => {
  let sent;
  const fake = async (_url, init) => { sent = JSON.parse(init.body).language_code; return Response.json({ audios: ["UklGRg=="] }); };
  const request = new Request("http://127.0.0.1:3000/api/speak", { method: "POST", body: JSON.stringify({ text: "सेव हो गया।", language: "hi-IN" }) });
  assert.equal((await handleSpeak(request, "test-key", fake)).status, 200);
  assert.equal(sent, "hi-IN");
});

test("Hindi yes and no answers are heard", () => {
  assert.equal(heardYesNo("हाँ, सेव करो"), "yes");
  assert.equal(heardYesNo("जी हाँ"), "yes");
  assert.equal(heardYesNo("ठीक है"), "yes");
  assert.equal(heardYesNo("नहीं, बदलो"), "no");
  assert.equal(heardYesNo("हाँ… नहीं"), "no");
});

test("the offline parser understands Hindi bills and payments", () => {
  const customers = [{ id: "r", name: "रामू" }];
  assert.deepEqual(parseVoiceCommand("रामू को दूध 20, चावल 50", customers),
    { ok: true, customerId: "r", kind: "credit", amount: "70", items: [{ label: "दूध", amountPaise: 2000 }, { label: "चावल", amountPaise: 5000 }] });
  assert.deepEqual(parseVoiceCommand("रामू ने 30 रुपये दिए", customers), { ok: true, customerId: "r", kind: "payment", amount: "30" });
  assert.deepEqual(parseVoiceCommand("रामू को दूध २०", customers), { ok: true, customerId: "r", kind: "credit", amount: "20", items: [{ label: "दूध", amountPaise: 2000 }] });
  assert.deepEqual(parseVoiceCommand("नया ग्राहक सीता, दही 30", customers),
    { ok: true, newCustomerName: "सीता", kind: "credit", amount: "30", items: [{ label: "दही", amountPaise: 3000 }] });
  assert.equal(parseVoiceCommand("रामू ने 30 रुपये दिए नहीं", customers).ok, false);
});

test("AI results drop Hindi name suffixes and carry a problem code", () => {
  const customers = [{ id: "r", name: "रामू" }];
  assert.deepEqual(validateUnderstanding({ action: "balance", spokenName: "रामू जी", customerId: null }, customers), { ok: true, kind: "balance", customerId: "r" });
  assert.equal(validateUnderstanding({ action: "payment", spokenName: "सीता", amount: 30 }, customers).code, "PAYMENT_NO_CUSTOMER");
  assert.equal(validateUnderstanding({ action: "unclear" }, customers).code, "UNCLEAR");
});
