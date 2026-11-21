import { keyIsConfigured, originOk } from "@/lib/transcription";
import { handleSpeak } from "@/lib/speak";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const key = process.env.SARVAM_API_KEY ?? "";
  if (!originOk(request)) return Response.json({ code: "ORIGIN" }, { status: 403 });
  if (!keyIsConfigured(key)) return Response.json({ code: "SETUP_REQUIRED" }, { status: 503 });
  return handleSpeak(request, key);
}
