Build a mobile web app called Maata Khata: a credit book (khata) for kirana shops that the owner runs by talking in Telugu, one-handed, on a cheap Android phone.

Your users and their languages: Kirana shop owners in Telangana and Andhra Pradesh, aged about 30 to 60, who give regular customers goods on credit (udhaar). They speak Telugu with Telangana or Andhra accents and often mix in Hindi and English words, like "Ramuki sugar 2 kg 80". Many are slow at typing and some do not read well. Prices may be spoken as digits or as Telugu number words like "iravai" (20) and "yabhai" (50). All screen text and spoken replies should be short, simple Telugu.

The voice flow, step by step:
1. Home screen: one big mic button with the line "Nokki maatladandi" (tap and speak). The owner taps it and says "రాము, పాలు 20, బియ్యం 50". While they speak, show a moving waveform and a timer. Recording stops when they tap again, or after 20 seconds.
2. The app turns the speech into text, shows "Vinnadi: ..." (what we heard), then works out the customer, each item, each price, and the total.
3. A review sheet opens, like a small paper bill: Ramu, milk 20, rice 50, total ₹70, and "old balance ₹0 → new balance ₹70". Mark the name as "new customer" if Ramu is not in the book yet.
4. The app reads the bill out loud in Telugu: "Ramu ki paalu 20, biyyam 50, mottam 70 rupaayalu. Save cheyyamaa?" Then it listens for about 5 seconds for an answer.
5. The owner says "avunu" (or "haan", "yes") to save, or "vaddu" (or "nahi", "no") to open the bill for editing. The sheet also has big Save, Edit and Cancel buttons. Nothing is saved without a yes or a tap.
6. After saving, show "Save ayindi" (saved) with an Undo button for a few seconds.
7. Payment: later the owner says "రాము 30 రూపాయలు ఇచ్చాడు" (Ramu paid 30). The same review sheet shows ₹70 → ₹40 and asks to confirm.
8. Question: the owner asks "రాము బాకీ ఎంత?" (how much does Ramu owe?). The app opens Ramu's page and says "Ramu baaki 40 rupaayalu".

What the product says or shows back:
- Home also shows today's totals (credit given, money received, number of entries), and a list of customers sorted by who owes most, with a search box and a "total to collect" figure.
- Each customer page shows the balance in big numbers with a speaker button to hear it again, buttons for New bill, Money received and WhatsApp reminder, and a list of entries grouped by Today, Yesterday and date.
- The WhatsApp button opens a ready-made polite Telugu message with the amount due.
- A typing box is always available as a backup.
- Use green for money received and red for money owed, large tap targets, and the Noto Sans Telugu font.

Noise, accents, mixed languages and misheard input:
- Noisy shop: record only while the mic is on. If the recording is almost silent, say "Sound vinapadaledu, malli cheppandi" (couldn't hear, please say again) instead of guessing.
- Accents and mixing: accept Telugu, Hindi and English in the same sentence, Telugu number words, and suffixes like "Ramuki", "Ramu gaaru". Treat "Ramu" and "రాము" as the same person.
- Quantities: "chakkera 2 kg, kilo 40 choppuna" becomes one line of ₹80.
- Misheard input: always show what was heard and read the bill back, so the owner catches mistakes by listening. If no name or price is found, say "Ardham kaaledu, malli cheppandi" (didn't understand, please say again) and keep the mic ready. Never save a guess.
- A payment or question for a name not in the book: say the name was not found, never create a new customer for it.
- A missing, zero or very large price: ask the owner to check before saving.
- Wrong entry saved: Undo the last entry.
- Microphone permission refused: explain in Telugu how to allow it and offer typing.
- No internet: keep the book saved on the phone so balances still open offline. If the speech or AI service is not reachable, let the owner type the entry and use a simple built-in parser for "name item price" sentences.

Rules for the build: The AI only suggests an entry and must match names against the existing customer list. Store money as whole paise. Keep the app light for slow mobile data.
