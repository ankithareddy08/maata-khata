import test from "node:test";
import assert from "node:assert/strict";
import { handleTranscription } from "../lib/transcription.ts";

function request(file = new File(["test audio"], "recording.webm", { type: "audio/webm;codecs=opus" }), origin = "http://127.0.0.1:3000") {
  const form = new FormData();
  if (file !== null) form.set("file", file);
  return new Request("http://127.0.0.1:3000/api/transcribe", { method: "POST", headers: { Origin: origin }, body: form });
}
const neverFetch = () => { throw new Error("Provider must not be contacted"); };

test("missing key returns setup instructions without contacting the provider", async () => {
  const result = await handleTranscription(request(), "", neverFetch);
  assert.equal(result.status, 503);
  assert.equal((await result.json()).code, "SETUP_REQUIRED");
});
test("cross-origin requests are blocked", async () => {
  assert.equal((await handleTranscription(request(undefined, "https://other.example"), "test-key", neverFetch)).status, 403);
});
test("Next's internal localhost URL permits the matching browser-facing Host only", async () => {
  const form = new FormData();
  const localRequest = new Request("http://localhost:3000/api/transcribe", {
    method: "POST", headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" }, body: form,
  });
  assert.equal((await handleTranscription(localRequest, "", neverFetch)).status, 503);
  const otherOrigin = new Request("http://localhost:3000/api/transcribe", {
    method: "POST", headers: { Host: "127.0.0.1:3000", Origin: "http://localhost:3000" }, body: new FormData(),
  });
  assert.equal((await handleTranscription(otherOrigin, "", neverFetch)).status, 403);
});
test("missing, empty, non-audio and oversized files are rejected", async () => {
  for (const file of [null, new File([], "empty.webm", { type: "audio/webm" }), new File(["text"], "note.txt", { type: "text/plain" })]) {
    assert.equal((await handleTranscription(request(file), "test-key", neverFetch)).status, 400);
  }
  const oversized = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.webm", { type: "audio/webm" });
  assert.equal((await handleTranscription(request(oversized), "test-key", neverFetch)).status, 413);
});
test("valid Telugu request forwards the audio and server-only key with correct API fields", async () => {
  const result = await handleTranscription(request(), "private-test-key", async (url, options) => {
    assert.equal(url, "https://api.sarvam.ai/speech-to-text");
    assert.equal(options.headers["api-subscription-key"], "private-test-key");
    assert.equal(options.body.get("language_code"), "te-IN");
    assert.equal(options.body.get("model"), "saaras:v4");
    assert.equal(options.body.get("mode"), "transcribe");
    assert.equal(options.body.get("file").name, "recording.webm");
    return Response.json({ transcript: "రవి పేరుతో 300 రూపాయలు బాకీ నమోదు చేయి." });
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  const data = await result.json();
  assert.match(data.transcript, /రవి/);
  assert.equal(JSON.stringify(data).includes("private-test-key"), false);
});
test("empty and malformed provider responses are actionable errors", async () => {
  for (const data of [{ transcript: "  " }, { unexpected: true }]) {
    const result = await handleTranscription(request(), "test-key", async () => Response.json(data));
    assert.ok([422, 502].includes(result.status));
  }
});
test("provider errors are mapped without relaying its body", async () => {
  for (const [status, expected] of [[403, "KEY_REJECTED"], [402, "CREDITS"], [429, "RATE_LIMIT"], [422, "REQUEST_REJECTED"], [500, "PROVIDER"]]) {
    const result = await handleTranscription(request(), "test-key", async () => new Response("private upstream details", { status }));
    const data = await result.json();
    assert.equal(data.code, expected);
    assert.equal(JSON.stringify(data).includes("private upstream details"), false);
  }
});

test("400 and 422 distinguish request settings from recording format without echoing provider details", async () => {
  const cases = [
    [{ error: { code: "invalid_request_error", message: "Unsupported model: private-model-detail" } }, "REQUEST_SETTINGS"],
    [{ error: { code: "invalid_language_code_error", message: "private-detail" } }, "REQUEST_SETTINGS"],
    [{ detail: [{ loc: ["body", "mode"], msg: "Input should be a supported value", input: "private-input" }] }, "REQUEST_SETTINGS"],
    [{ error: { code: "invalid_request_error", message: "Unsupported audio format; private-detail" } }, "AUDIO_FORMAT"],
    [{ error: { code: "invalid_request_error", message: "Failed to read the file, please check the audio format. private-detail" } }, "AUDIO_FORMAT"],
    [{ error: { code: "audio_decode_error", message: "private-detail" } }, "AUDIO_FORMAT"],
    [{ detail: "Could not decode this recording. private-detail" }, "AUDIO_FORMAT"],
  ];
  for (const status of [400, 422]) {
    for (const [body, expected] of cases) {
      const result = await handleTranscription(request(), "test-key", async () => Response.json(body, { status }));
      const data = await result.json();
      assert.equal(result.status, 422);
      assert.equal(data.code, expected);
      assert.equal(data.providerStatus, status);
      assert.equal(JSON.stringify(data).includes("private-"), false);
      assert.doesNotMatch(data.error, /speak clearly|record a clear clip/i);
    }
  }
});

test("duration and no-speech rejections have their own actionable categories", async () => {
  const cases = [
    [{ error: { code: "audio_duration_error", message: "private-detail" } }, "AUDIO_DURATION"],
    [{ error: { message: "Audio duration is longer than 30 seconds" } }, "AUDIO_DURATION"],
    [{ error: { message: "Audio too short" } }, "AUDIO_DURATION"],
    [{ error: { code: "no_speech_detected", message: "private-detail" } }, "NO_SPEECH"],
    [{ error: { message: "Empty audio file" } }, "NO_SPEECH"],
    [{ error: "No speech detected: silence" }, "NO_SPEECH"],
  ];
  for (const [body, expected] of cases) {
    const result = await handleTranscription(request(), "test-key", async () => Response.json(body, { status: 400 }));
    const data = await result.json();
    assert.equal(data.code, expected);
    assert.equal(JSON.stringify(data).includes("private-detail"), false);
  }
});

test("only allowlisted safe provider codes are exposed; raw error and secret fields stay private", async () => {
  const secret = "secret-provider-key-and-customer-recording";
  for (const code of ["invalid_request_error", "unknown_code", "invalid_request_error\nsecret", "A".repeat(80), secret, { secret }]) {
    const body = { error: { code, message: secret, api_key: secret, audio_url: secret }, request: { transcript: secret } };
    const result = await handleTranscription(request(), "test-key", async () => Response.json(body, { status: 422 }));
    const data = await result.json();
    assert.equal(data.code, "REQUEST_REJECTED");
    assert.equal(data.providerCode, code === "invalid_request_error" ? code : undefined);
    assert.equal(data.providerStatus, 422);
    assert.equal(JSON.stringify(data).includes(secret), false);
    assert.equal("request" in data, false);
    assert.match(data.error, /does not establish unclear speech/);
  }
});

test("non-JSON, unrelated JSON and malformed errors become neutral request rejections", async () => {
  for (const response of [new Response("private upstream body", { status: 400 }), Response.json(null, { status: 422 }), Response.json({ detail: { private: "secret" } }, { status: 400 })]) {
    const result = await handleTranscription(request(), "test-key", async () => response);
    const data = await result.json();
    assert.equal(data.code, "REQUEST_REJECTED");
    assert.equal(data.providerStatus, response.status);
    assert.equal(data.providerCode, undefined);
    assert.equal(JSON.stringify(data).includes("private upstream body"), false);
  }
});
test("timeout and network failures do not retry the paid API call", async () => {
  for (const name of ["TimeoutError", "TypeError"]) {
    let calls = 0;
    const result = await handleTranscription(request(), "test-key", async () => { calls++; throw new DOMException("private detail", name); });
    assert.equal(calls, 1);
    assert.ok([504, 502].includes(result.status));
  }
});
