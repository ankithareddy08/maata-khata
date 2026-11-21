// Text-to-speech read-back, so the shopkeeper can hear the bill without reading.
function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleSpeak(request: Request, key: string, providerFetch: typeof fetch = fetch): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ code: "BAD_REQUEST" }, 400); }
  const text = (body as { text?: unknown })?.text;
  if (typeof text !== "string" || !text.trim() || text.length > 500) return json({ code: "BAD_REQUEST" }, 400);
  try {
    const response = await providerFetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-subscription-key": key.trim() },
      body: JSON.stringify({ text: text.trim(), language_code: "te-IN", model: "bulbul:v3", speaker: "kavya", pace: 1.05, output_audio_codec: "mp3", enable_preprocessing: true }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
      cache: "no-store",
    });
    if (!response.ok) return json({ code: "PROVIDER", providerStatus: response.status }, 502);
    const data = await response.json() as { audios?: unknown };
    const audio = Array.isArray(data.audios) && typeof data.audios[0] === "string" ? data.audios.join("") : "";
    if (!audio) return json({ code: "PROVIDER" }, 502);
    return json({ audio, type: "audio/mpeg" });
  } catch {
    return json({ code: "NETWORK" }, 502);
  }
}
