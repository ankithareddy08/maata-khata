# Maata Khata · మాట ఖాతా

**A voice-first credit ledger (ఖాతా / udhaar book) for kirana shopkeepers.** Tap the mic and talk the way you already do at the counter — in Telugu, Hindi, English or a mix. Maata Khata understands the customer, items and prices, reads the bill back aloud, and saves it when you say **“అవును”** (or **“हाँ”** / **“yes”**). A switch at the top changes the whole app — screens, read-back and reminders — between **తెలుగు, हिंदी and English**.

Built for the Scaler × Wispr Flow hackathon *India Runs on Voice* — Small business track.

## Why

Millions of small shops still keep credit in a paper notebook. Shopkeepers are busy with customers, often more comfortable speaking than typing, and existing apps are English forms. Maata Khata makes the whole loop voice-first:

| Say | What happens |
|---|---|
| “రాముకి పాలు ఇరవై, బియ్యం యాభై” | Bill for Ramu: milk ₹20, rice ₹50 = ₹70 |
| “రాము 30 రూపాయలు ఇచ్చాడు” / “ramu gave 30” | Payment of ₹30, dues go ₹70 → ₹40 |
| “కొత్త కస్టమర్ లక్ష్మి, పెరుగు ముప్పై” | New customer Lakshmi created with her first bill |
| “sita ki 2 kg rice 40 rupees per kg” | Rice 2 kg = ₹80 (quantity × rate is worked out) |
| “రాము బాకీ ఎంత?” | Opens Ramu's account and says the balance aloud |
| “అవును” / “కాదు” | Saves, or opens the bill for editing |

Spoken numbers (ఇరవై, నూట ఇరవై, pachaas), names in any script (రాము = ramu), and mixed-language sentences all work.

## How it works

1. **Speech → text:** Sarvam `saaras:v4`, in the chosen language (te-IN, hi-IN or en-IN).
2. **Text → ledger action:** Sarvam `sarvam-105b-conversations` returns JSON. The app then **validates** it against the real customer list — the AI only proposes and never saves on its own. If the AI is unreachable, an offline rule parser takes over.
3. **Read-back:** Sarvam `bulbul:v3` speaks the bill in the chosen language, then listens for a yes/no.
4. **Ledger:** amounts are stored as whole paise in the browser (no server database). There's undo, a per-customer history, and a **WhatsApp reminder** button with a polite message in the chosen language.

The API key stays on the server. API routes only accept requests from the app's own pages.

## Run it

You need Node.js and a Sarvam AI API key (https://dashboard.sarvam.ai).

```powershell
copy .env.example .env.local   # then paste your key after SARVAM_API_KEY=
npm.cmd ci
npm.cmd run dev
```

Open http://127.0.0.1:3000. Without a key, the mic is disabled. Typing still works through the offline parser, which only handles simpler sentences with prices in digits.

## Files

- `app/page.tsx` — the screen: voice hero, review sheet, manual entry, customer accounts.
- `app/components/voice-capture.tsx` — the big mic button, examples and typing box.
- `lib/understand.ts` — AI prompt and strict validation of its output.
- `lib/client-voice.ts` — recording, transcription, AI call with fallback, spoken read-back.
- `lib/yes-no.ts` — spoken confirmation (“no” always wins over “yes”).
- `lib/voice-command.ts` — offline rule parser (fallback).
- `lib/ledger.ts` — balances, atomic customer + bill creation, undo.
- `app/api/{transcribe,understand,speak}` — server routes to Sarvam.

## Checks

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Never commit `.env.local`.

## Limits & next steps

- The ledger lives in one browser on one device. Next: sync and backup.
- Telugu, Hindi and English today. Adding another language (Tamil, Kannada…) means one more block of text in `lib/i18n.ts` plus its speech code; Sarvam already supports them.
- WhatsApp reminders open WhatsApp with the message filled in; the shopkeeper chooses the contact.
