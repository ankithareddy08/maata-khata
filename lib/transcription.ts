const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MIME_TYPES = new Set(["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg"]);
const PROVIDER_CODES = new Set([
  "invalid_request_error", "unprocessable_entity_error", "validation_error",
  "unsupported_audio_format", "unsupported_audio_format_error", "invalid_audio_error", "audio_decode_error",
  "audio_duration_error", "audio_too_long", "audio_too_short", "no_speech_detected", "no_speech_error", "empty_audio_error",
  "invalid_model_error", "unsupported_model_error", "invalid_language_code_error", "invalid_mode_error",
]);
const REJECTION_MESSAGES = {
  REQUEST_SETTINGS: "వాయిస్ సేవ సెట్టింగ్‌లను అంగీకరించలేదు. The speech service rejected the app's request settings. Refresh the app and try again.",
  AUDIO_FORMAT: "రికార్డింగ్ ఫైల్‌ను సేవ చదవలేకపోయింది. The speech service could not read this recording format. Refresh the app and record a new clip.",
  AUDIO_DURATION: "రికార్డింగ్ పొడవును సేవ అంగీకరించలేదు. The speech service rejected the clip duration. Record one phrase lasting 2–20 seconds.",
  NO_SPEECH: "ఈ రికార్డింగ్‌లో మాటలను సేవ గుర్తించలేదు. No speech was detected in this recording. Play it back to check that your voice was captured.",
  REQUEST_REJECTED: "వాయిస్ సేవ అభ్యర్థనను అంగీకరించలేదు. The speech service rejected the request; this response does not establish unclear speech. Refresh the app and try again.",
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function providerRejection(response: Response): Promise<Response> {
  let data: unknown;
  try { data = await response.json(); }
  catch { data = undefined; }
  const body = record(data) ? data : {};
  const error = record(body.error) ? body.error : body;
  const rawCode = typeof error.code === "string" ? error.code : "";
  // A provider code is returned only when it is a known, short, safe identifier.
  // Do not return arbitrary codes, messages, request fields, or validation input.
  const providerCode = rawCode.length <= 64 && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(rawCode) && PROVIDER_CODES.has(rawCode) ? rawCode : undefined;
  const messages = [error.message, typeof body.error === "string" ? body.error : undefined, typeof body.detail === "string" ? body.detail : undefined]
    .filter((value): value is string => typeof value === "string").map((value) => value.slice(0, 2000));
  let settingValidation = false;
  if (Array.isArray(body.detail)) {
    for (const detail of body.detail.slice(0, 20)) {
      if (!record(detail)) continue;
      if (typeof detail.msg === "string") messages.push(detail.msg.slice(0, 2000));
      if (Array.isArray(detail.loc) && detail.loc.some((field) => ["model", "mode", "language_code"].includes(String(field)))) settingValidation = true;
    }
  }
  const description = messages.join(" ").toLowerCase();
  let code: keyof typeof REJECTION_MESSAGES = "REQUEST_REJECTED";
  if (settingValidation || (providerCode && /(?:model|language|mode)/.test(providerCode)) ||
      (/\b(?:model|language(?:_code)?|mode)\b/.test(description) && /unsupported|invalid|not supported|not found|does not exist|not available|not allowed|should be|must be|permitted/.test(description))) {
    code = "REQUEST_SETTINGS";
  } else if ((providerCode && /duration|too_long|too_short/.test(providerCode)) || /\bduration\b|\btoo (?:long|short)\b|\b(?:longer|shorter) than\b|\b(?:maximum|minimum|at least|at most|exceeds?).{0,35}\bseconds?\b/.test(description)) {
    code = "AUDIO_DURATION";
  } else if ((providerCode && /no_speech|empty_audio/.test(providerCode)) || /\bno (?:speech|audio|voice)\b|\bsilence\b|\bempty\b/.test(description)) {
    code = "NO_SPEECH";
  } else if ((providerCode && /audio_format|audio_decode|invalid_audio/.test(providerCode)) || /audio[ _-]?format|\bcodec\b|\bdecod(?:e|ing|er)\b|read (?:the )?file|\bunreadable\b|unsupported media type|invalid (?:wav|webm|mp[34]|ogg)/.test(description)) {
    code = "AUDIO_FORMAT";
  }
  return json({ code, error: REJECTION_MESSAGES[code], providerStatus: response.status, ...(providerCode ? { providerCode } : {}) }, 422);
}

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Only this app's own pages may spend the API key. */
export function originOk(request: Request): boolean {
  const requestUrl = new URL(request.url);
  // Next's internal request URL can say localhost while the browser uses
  // 127.0.0.1. The incoming Host header retains the browser-facing authority.
  // Behind a hosting proxy (e.g. Vercel) the forwarded protocol is the real one.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? requestUrl.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? requestUrl.protocol.replace(":", "");
  return request.headers.get("origin") === `${protocol}://${host}`;
}

export function keyIsConfigured(key: string): boolean {
  return !!key.trim() && !/^(your_|paste_|replace_)/i.test(key.trim());
}

// The provider is injectable for tests; no test needs a real key or a paid call.
export async function handleTranscription(request: Request, key: string, providerFetch: typeof fetch = fetch): Promise<Response> {
  if (!originOk(request)) {
    return json({ code: "ORIGIN", error: "ఈ యాప్ నుంచే మళ్లీ ప్రయత్నించండి. Open Maata Khata and try again." }, 403);
  }
  if (!keyIsConfigured(key)) {
    return json({ code: "SETUP_REQUIRED", error: "ముందుగా Sarvam API key జోడించండి. Add SARVAM_API_KEY to .env.local, save, and restart the app." }, 503);
  }
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_AUDIO_BYTES + 64 * 1024) return json({ code: "TOO_LARGE", error: "చిన్న రికార్డింగ్ చేయండి. Keep the recording under 20 seconds and 2 MB." }, 413);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return json({ code: "INVALID_AUDIO", error: "మళ్లీ రికార్డ్ చేయండి. A recorded audio file is required." }, 400);
  }

  let file: FormDataEntryValue | null;
  try { file = (await request.formData()).get("file"); }
  catch { return json({ code: "INVALID_AUDIO", error: "రికార్డింగ్ చదవలేకపోయాము. Record a new short clip." }, 400); }
  if (!(file instanceof File) || file.size === 0 || !MIME_TYPES.has(file.type.split(";")[0].toLowerCase())) {
    return json({ code: "INVALID_AUDIO", error: "సరైన ఆడియో లేదు. Please record a new audio clip." }, 400);
  }
  if (file.size > MAX_AUDIO_BYTES) return json({ code: "TOO_LARGE", error: "చిన్న రికార్డింగ్ చేయండి. The audio must be smaller than 2 MB." }, 413);

  const form = new FormData();
  form.append("file", file, file.name);
  form.append("model", "saaras:v4");
  form.append("language_code", "te-IN");
  form.append("mode", "transcribe");

  try {
    const response = await providerFetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": key.trim() },
      body: form,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      cache: "no-store",
    });
    if (!response.ok) {
      // Do not relay provider bodies: they can contain private request details.
      if (response.status === 401 || response.status === 403) return json({ code: "KEY_REJECTED", error: "Sarvam key పనిచేయడం లేదు. Check your API key and account access, then restart the app." }, 502);
      if (response.status === 402) return json({ code: "CREDITS", error: "Sarvam credits తనిఖీ చేయండి. Check your account's available credits." }, 502);
      if (response.status === 429) return json({ code: "RATE_LIMIT", error: "కొద్దిసేపటి తర్వాత ప్రయత్నించండి. Sarvam is limiting requests; check usage and try again later." }, 429);
      if (response.status === 400 || response.status === 422) return providerRejection(response);
      return json({ code: "PROVIDER", error: "వాయిస్ సేవ అందుబాటులో లేదు. Speech service is unavailable; try again later." }, 502);
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("transcript" in data) || typeof data.transcript !== "string") {
      return json({ code: "PROVIDER", error: "సరైన ఫలితం రాలేదు. The speech service returned an unexpected response. Try again." }, 502);
    }
    const transcript = data.transcript.trim();
    if (!transcript) return json({ code: "NO_SPEECH", error: "వాయిస్ సేవ మాటలను తిరిగి ఇవ్వలేదు. No words were returned. Play back the recording to check whether your voice was captured." }, 422);
    return json({ transcript });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    if (name === "TimeoutError" || name === "AbortError") return json({ code: "TIMEOUT", error: "సమయం మించిపోయింది. The request stopped or timed out. Please try again." }, 504);
    return json({ code: "NETWORK", error: "ఇంటర్నెట్ కనెక్షన్ తనిఖీ చేయండి. Could not reach the speech service. Please try again." }, 502);
  }
}
