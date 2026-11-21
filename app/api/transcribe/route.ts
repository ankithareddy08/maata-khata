import { handleTranscription, keyIsConfigured } from "@/lib/transcription";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ configured: keyIsConfigured(process.env.SARVAM_API_KEY ?? "") }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  return handleTranscription(request, process.env.SARVAM_API_KEY ?? "");
}
