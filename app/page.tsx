"use client";

import { useEffect, useRef, useState } from "react";
import { addEntryWithCustomer, balanceFor, emptyLedger, parseAmount, restoreLedger, STORAGE_KEY, undoLastEntry, type Customer, type Entry, type Ledger, type LineItem } from "@/lib/ledger";
import VoiceCapture from "./components/voice-capture";
import { Icon } from "./components/icons";
import { readBack, speak, stopSpeaking, transcribe, understand, useRecorder } from "@/lib/client-voice";
import { heardYesNo } from "@/lib/yes-no";

type Pending = { type: "entry"; entry: Entry; newCustomer?: Customer; spoken: boolean } | { type: "undo"; entry: Entry; spoken: boolean };
type ItemDraft = { id: string; label: string; amount: string };
type Toast = { text: string; undoId?: string };

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 === 0 ? 0 : 2 }).format(paise / 100);
const rupees = (paise: number) => (paise / 100).toFixed(paise % 100 ? 2 : 0);
const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").normalize("NFC");
const blankItem = (): ItemDraft => ({ id: crypto.randomUUID(), label: "", amount: "" });
const timeLabel = (value: string) => new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const dayLabel = (value: string) => {
  const date = new Date(value);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(value).setHours(0, 0, 0, 0)) / 86_400_000);
  return days === 0 ? "ఈరోజు" : days === 1 ? "నిన్న" : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
};
const relative = (value: string) => {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  const format = new Intl.RelativeTimeFormat("te", { numeric: "auto" });
  if (minutes < 60) return format.format(-Math.max(minutes, 0), "minute");
  if (minutes < 1440) return format.format(-Math.round(minutes / 60), "hour");
  return format.format(-Math.round(minutes / 1440), "day");
};
const isToday = (value: string) => new Date(value).toDateString() === new Date().toDateString();
const avatarTone = (name: string) => Array.from(name).reduce((sum, char) => sum + char.codePointAt(0)!, 0) % 6;
const initial = (name: string) => Array.from(name)[0]?.toLocaleUpperCase() ?? "?";

function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return <span className={`avatar tone-${avatarTone(name)} ${size}`} aria-hidden="true">{initial(name)}</span>;
}

function Receipt({ items }: { items: LineItem[] }) {
  return <ul className="lines">{items.map((item, index) => <li key={index}><span>{item.label}</span><i aria-hidden="true" /><strong>{money(item.amountPaise)}</strong></li>)}</ul>;
}

export default function Home() {
  const [ledger, setLedger] = useState<Ledger>(emptyLedger);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [viewedId, setViewedId] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Entry["kind"]>("credit");
  const [amount, setAmount] = useState("");
  const [itemDrafts, setItemDrafts] = useState<ItemDraft[]>(() => [{ id: "first", label: "", amount: "" }]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState("");
  const [answerNote, setAnswerNote] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const confirming = useRef(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const manualRef = useRef<HTMLDetailsElement>(null);
  const customerInput = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<Pending | null>(null);
  const answer = useRecorder(5);
  pendingRef.current = pending;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setLedger(restoreLedger(raw));
    } catch {
      setBlocked(true);
      setError("Saved data could not be read. Entries are paused to protect it.");
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (pending && !sheet.current?.open) sheet.current?.showModal();
    if (!pending && sheet.current?.open) sheet.current.close();
  }, [pending]);

  useEffect(() => {
    if (viewedId && !pending && !drawer.current?.open) drawer.current?.showModal();
    if (!viewedId && drawer.current?.open) drawer.current.close();
  }, [viewedId, pending]);

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 6000); return () => clearTimeout(timer); }, [toast]);

  const selected = ledger.customers.find((customer) => customer.name.toLocaleLowerCase() === cleanName(customerName).toLocaleLowerCase());
  const isNew = !!cleanName(customerName) && !selected;
  const balance = selected ? balanceFor(ledger, selected.id) : 0;
  const total = ledger.customers.reduce((sum, customer) => sum + balanceFor(ledger, customer.id), 0);
  const owing = ledger.customers.filter((customer) => balanceFor(ledger, customer.id) > 0).length;
  const live = ledger.entries.filter((entry) => !entry.voidedAt);
  const today = live.filter((entry) => isToday(entry.createdAt));
  const todayCredit = today.filter((entry) => entry.kind === "credit").reduce((sum, entry) => sum + entry.amountPaise, 0);
  const todayPaid = today.filter((entry) => entry.kind === "payment").reduce((sum, entry) => sum + entry.amountPaise, 0);
  const last = live.at(-1);
  const locked = !ready || blocked || !!pending;
  const viewed = ledger.customers.find((customer) => customer.id === viewedId);
  const viewedBalance = viewed ? balanceFor(ledger, viewed.id) : 0;
  const viewedEntries = ledger.entries.filter((entry) => entry.customerId === viewedId).reverse();
  const lastActivity = (id: string) => live.filter((entry) => entry.customerId === id).at(-1)?.createdAt;
  const visibleCustomers = ledger.customers
    .filter((customer) => customer.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => balanceFor(ledger, b.id) - balanceFor(ledger, a.id) || (lastActivity(b.id) ?? "").localeCompare(lastActivity(a.id) ?? ""));
  let billTotal: number | undefined;
  try { billTotal = itemDrafts.length ? itemDrafts.reduce((sum, item) => sum + parseAmount(item.amount), 0) : parseAmount(amount); if (billTotal > 100_000_000) billTotal = undefined; }
  catch { billTotal = undefined; }

  const pendingCustomer = pending?.type === "entry" && pending.newCustomer ? pending.newCustomer : ledger.customers.find((customer) => customer.id === pending?.entry.customerId);
  const pendingBefore = pending ? balanceFor(ledger, pending.entry.customerId) : 0;
  const pendingAfter = pending ? pendingBefore + (pending.entry.kind === "credit" ? 1 : -1) * pending.entry.amountPaise * (pending.type === "undo" ? -1 : 1) : 0;

  function persist(next: Ledger) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setLedger(next);
  }

  /** Validate a draft against the ledger and open the review sheet. Throws a readable error. */
  function openReview(name: string, entryKind: Entry["kind"], items: LineItem[] | undefined, amountText: string, spoken: boolean) {
    if (!cleanName(name)) throw new Error("కస్టమర్ పేరు రాయండి. Enter a customer name.");
    const existing = ledger.customers.find((customer) => customer.name.toLocaleLowerCase() === cleanName(name).toLocaleLowerCase());
    const newCustomer = existing ? undefined : { id: crypto.randomUUID(), name: cleanName(name) };
    const amountPaise = items ? items.reduce((sum, item) => sum + item.amountPaise, 0) : parseAmount(amountText);
    const entry: Entry = { id: crypto.randomUUID(), customerId: existing?.id ?? newCustomer!.id, kind: entryKind, amountPaise, createdAt: new Date().toISOString(), ...(items ? { items } : {}) };
    addEntryWithCustomer(ledger, entry, newCustomer); // throws if invalid (e.g. overpayment)
    const next: Pending = { type: "entry", entry, newCustomer, spoken };
    setViewedId("");
    setPending(next);
    setAnswerNote("");
    setError("");
    const before = existing ? balanceFor(ledger, existing.id) : 0;
    const after = before + (entryKind === "credit" ? amountPaise : -amountPaise);
    const sentence = entryKind === "credit" ? readBack.credit(cleanName(name), amountPaise, items?.length ?? 0, after) : readBack.payment(cleanName(name), amountPaise, after);
    void speak(sentence).then(() => { if (spoken && pendingRef.current === next) void listenForAnswer(); });
  }

  function submitManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    try {
      const items = itemDrafts.length ? itemDrafts.map((item) => ({ label: item.label.trim(), amountPaise: parseAmount(item.amount) })) : undefined;
      openReview(customerName, kind, items, amount, false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please check the entry."); }
  }

  async function handleText(text: string, spoken: boolean): Promise<string | undefined> {
    if (locked) return "ముందు ఈ నమోదు పూర్తి చేయండి. Finish the open review first.";
    const result = await understand(text, ledger.customers);
    if (!result.ok) { void speak(result.message.split(" / ")[0]); return result.message; }
    if (result.kind === "balance") {
      const customer = ledger.customers.find((c) => c.id === result.customerId)!;
      setViewedId(customer.id);
      void speak(readBack.balance(customer.name, balanceFor(ledger, customer.id)));
      return undefined;
    }
    const name = result.newCustomerName ?? ledger.customers.find((c) => c.id === result.customerId)!.name;
    // Fill the manual form too, so "Edit" opens with everything in place.
    setCustomerName(name);
    setKind(result.kind);
    setAmount(result.amount);
    setItemDrafts(result.items?.map((item) => ({ id: crypto.randomUUID(), label: item.label, amount: rupees(item.amountPaise) })) ?? []);
    try { openReview(name, result.kind, result.items, result.amount, spoken); return undefined; }
    catch (cause) { void speak("ఇది సేవ్ చేయలేము. మళ్లీ చెప్పండి."); return cause instanceof Error ? cause.message : "Please check the entry."; }
  }

  async function listenForAnswer() {
    if (!pendingRef.current || answer.phase !== "idle") return;
    setAnswerNote("వింటున్నాం — “అవును” లేదా “కాదు”");
    try {
      const audio = await answer.start();
      if (!audio || !pendingRef.current) { setAnswerNote(""); return; }
      setAnswerNote("అర్థం చేసుకుంటున్నాం…");
      const reply = heardYesNo(await transcribe(audio));
      if (!pendingRef.current) return;
      if (reply === "yes") confirm();
      else if (reply === "no") editPending();
      else setAnswerNote("వినిపించలేదు — బటన్ నొక్కండి");
    } catch { setAnswerNote("వినిపించలేదు — బటన్ నొక్కండి"); }
  }

  function closeReview() {
    stopSpeaking();
    answer.cancel();
    setAnswerNote("");
    setPending(null);
  }
  function openManual() {
    setManualOpen(true);
    setTimeout(() => { manualRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); customerInput.current?.focus({ preventScroll: true }); }, 60);
  }
  function editPending() {
    const wasEntry = pendingRef.current?.type === "entry";
    closeReview();
    if (wasEntry) openManual();
  }

  function confirm() {
    const current = pendingRef.current;
    if (!current || confirming.current || blocked) return;
    confirming.current = true;
    try {
      const next = current.type === "entry" ? addEntryWithCustomer(ledger, current.entry, current.newCustomer) : undoLastEntry(ledger, new Date().toISOString());
      persist(next);
      const saved = next.customers.find((customer) => customer.id === current.entry.customerId)!;
      setToast(current.type === "entry"
        ? { text: `${saved.name} · ${money(current.entry.amountPaise)} ${current.entry.kind === "credit" ? "బాకీ సేవ్ అయింది" : "అందినట్లు సేవ్ అయింది"}`, undoId: current.entry.id }
        : { text: "చివరి నమోదు రద్దు అయింది" });
      setCustomerName("");
      setAmount("");
      setKind("credit");
      setItemDrafts([blankItem()]);
      setManualOpen(false);
      closeReview();
      void speak(readBack.saved());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save."); closeReview(); }
    finally { confirming.current = false; }
  }

  /** Undo straight from the toast, only if the toast's entry is still the latest. */
  function undoFromToast(entryId: string) {
    if (last?.id !== entryId) return;
    persist(undoLastEntry(ledger, new Date().toISOString()));
    setToast({ text: "రద్దు చేశాము · Undone" });
  }

  function startManual(customer: Customer, entryKind: Entry["kind"]) {
    setViewedId("");
    setCustomerName(customer.name);
    setKind(entryKind);
    setAmount("");
    setItemDrafts(entryKind === "credit" ? [blankItem()] : []);
    setError("");
    openManual();
  }

  function whatsappLink(customer: Customer, due: number) {
    const text = `నమస్కారం ${customer.name} గారు 🙏\nమా షాపులో మీ బాకీ ${money(due)} ఉంది. వీలైనప్పుడు చెల్లించండి.\nధన్యవాదాలు!`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  // Group the account history by day for a readable timeline.
  const timeline: { day: string; entries: Entry[] }[] = [];
  for (const entry of viewedEntries) {
    const day = dayLabel(entry.createdAt);
    if (timeline.at(-1)?.day === day) timeline.at(-1)!.entries.push(entry);
    else timeline.push({ day, entries: [entry] });
  }

  return <div className="app">
    <header className="topbar">
      <a className="brand" href="#" aria-label="Maata Khata home">
        <span className="brand-mark"><Icon name="ledger" size={20} /></span>
        <span className="brand-name">మాట ఖాతా<small lang="en">Maata Khata</small></span>
      </a>
      <span className="device-pill"><Icon name="device" size={14} /> ఈ ఫోన్‌లోనే సేవ్</span>
    </header>

    {blocked && <div className="banner" role="alert">{error}</div>}

    <main className="layout">
      <div className="col-main">
        <VoiceCapture disabled={locked} reviewing={!!pending} onText={handleText} />

        <section className="panel today" aria-labelledby="today-title">
          <div className="panel-head"><h2 id="today-title">ఈరోజు</h2><span className="muted" lang="en">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</span></div>
          <dl className="metrics">
            <div><dt>ఇచ్చిన బాకీ</dt><dd className="num tone-due">{ready ? money(todayCredit) : "—"}</dd></div>
            <div><dt>వచ్చిన డబ్బు</dt><dd className="num tone-paid">{ready ? money(todayPaid) : "—"}</dd></div>
            <div><dt>నమోదులు</dt><dd className="num">{ready ? today.length : "—"}</dd></div>
          </dl>
        </section>

        <details className="panel manual" ref={manualRef} open={manualOpen} onToggle={(event) => setManualOpen((event.target as HTMLDetailsElement).open)}>
          <summary>
            <span className="summary-icon"><Icon name="edit" size={18} /></span>
            <span className="summary-text">చేతితో రాయండి<small>వాయిస్ బదులు టైప్ చేయండి లేదా సరిచేయండి</small></span>
            <Icon name="chevron" size={18} className="chev" />
          </summary>
          <form onSubmit={submitManual}>
            <fieldset disabled={locked}>
              <div className="segmented" role="group" aria-label="Entry type">
                <button type="button" aria-pressed={kind === "credit"} onClick={() => { setKind("credit"); setItemDrafts([blankItem()]); setAmount(""); }}><Icon name="plus" size={16} /> బాకీ</button>
                <button type="button" aria-pressed={kind === "payment"} onClick={() => { setKind("payment"); setItemDrafts([]); setAmount(""); }}><Icon name="received" size={16} /> డబ్బు అందింది</button>
              </div>
              <div className="field-group">
                <label htmlFor="customer-name">కస్టమర్</label>
                <input ref={customerInput} id="customer-name" className="field" value={customerName} onChange={(event) => { setCustomerName(event.target.value); setError(""); }} list="saved-customers" placeholder="పేరు — ఉదా: రాము" maxLength={60} autoComplete="off" required />
                <datalist id="saved-customers">{ledger.customers.map((customer) => <option key={customer.id} value={customer.name} />)}</datalist>
                {cleanName(customerName) && <p className={isNew ? "hint new" : "hint"}>{isNew ? "కొత్త కస్టమర్ — సేవ్ చేసినప్పుడు జతవుతారు" : `ప్రస్తుత బాకీ ${money(balance)}`}</p>}
              </div>

              {kind === "credit" && itemDrafts.length > 0 ? <div className="field-group">
                <span className="label-row"><label htmlFor={`label-${itemDrafts[0].id}`}>వస్తువులు</label><span>ధర</span></span>
                {itemDrafts.map((item, index) => <div className="item-row" key={item.id}>
                  <input id={`label-${item.id}`} aria-label={`Item ${index + 1}`} className="field" value={item.label} onChange={(event) => setItemDrafts((list) => list.map((row) => row.id === item.id ? { ...row, label: event.target.value } : row))} placeholder="పాలు" maxLength={80} required />
                  <div className="money-field"><span>₹</span><input aria-label={`Price ${index + 1}`} className="field" value={item.amount} onChange={(event) => setItemDrafts((list) => list.map((row) => row.id === item.id ? { ...row, amount: event.target.value } : row))} inputMode="decimal" placeholder="0" required /></div>
                  <button type="button" className="icon-btn" aria-label={`Remove item ${index + 1}`} disabled={itemDrafts.length === 1} onClick={() => setItemDrafts((list) => list.filter((row) => row.id !== item.id))}><Icon name="close" size={16} /></button>
                </div>)}
                <div className="row-actions">
                  <button type="button" className="text-btn" disabled={itemDrafts.length >= 20} onClick={() => setItemDrafts((list) => [...list, blankItem()])}><Icon name="plus" size={16} /> వస్తువు జోడించండి</button>
                  <button type="button" className="text-btn subtle" onClick={() => { setAmount(billTotal === undefined ? "" : rupees(billTotal)); setItemDrafts([]); }}>మొత్తం మాత్రమే</button>
                </div>
              </div> : <div className="field-group">
                <label htmlFor="amount">మొత్తం</label>
                <div className="money-field large"><span>₹</span><input id="amount" className="field" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} placeholder="0" required /></div>
                {kind === "credit" && <button type="button" className="text-btn" onClick={() => { setItemDrafts([blankItem()]); setAmount(""); }}><Icon name="plus" size={16} /> వస్తువులతో రాయండి</button>}
              </div>}

              <div className="sum-row">
                <span>{kind === "credit" ? "బిల్లు మొత్తం" : "అందిన మొత్తం"}{selected && billTotal !== undefined && <small>బాకీ {money(balance)} → {money(balance + (kind === "credit" ? billTotal : -billTotal))}</small>}</span>
                <strong className="num">{billTotal === undefined ? "—" : money(billTotal)}</strong>
              </div>
              {error && !blocked && <p className="form-error" role="alert">{error}</p>}
              <button className="btn primary block" type="submit">సరిచూడండి <Icon name="chevron" size={18} /></button>
            </fieldset>
          </form>
        </details>
      </div>

      <aside className="panel col-side" aria-labelledby="customers-title">
        <div className="collect">
          <div>
            <h2 id="customers-title">వసూలు చేయాల్సింది</h2>
            <p className="collect-amount num">{ready ? money(total) : "—"}</p>
            <p className="muted">{owing ? `${owing} మంది బాకీ ఉన్నారు` : ledger.customers.length ? "అందరూ చెల్లించారు" : "ఇంకా బాకీలు లేవు"}</p>
          </div>
          <button className="icon-btn" type="button" title="Undo last entry" aria-label="Undo last entry" disabled={!last || locked} onClick={() => { if (!last) return; setPending({ type: "undo", entry: last, spoken: false }); void speak(readBack.undo()); }}><Icon name="undo" size={18} /></button>
        </div>

        {ledger.customers.length > 0 && <div className="search"><Icon name="search" size={16} /><input placeholder="కస్టమర్‌ను వెతకండి" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search customers" /></div>}

        {!ledger.customers.length ? <div className="empty">
          <span className="empty-art"><Icon name="ledger" size={28} /></span>
          <p>మీ ఖాతా పుస్తకం ఖాళీగా ఉంది</p>
          <small>మైక్ నొక్కి మొదటి బిల్లు చెప్పండి. కస్టమర్ ఇక్కడ కనిపిస్తారు.</small>
        </div> : !visibleCustomers.length ? <p className="muted center">ఈ పేరుతో ఎవరూ లేరు</p>
          : <ul className="people">{visibleCustomers.map((customer) => {
            const due = balanceFor(ledger, customer.id);
            const when = lastActivity(customer.id);
            return <li key={customer.id}><button type="button" className="person" disabled={locked} onClick={() => setViewedId(customer.id)}>
              <Avatar name={customer.name} />
              <span className="person-name">{customer.name}<small>{when ? relative(when) : ""}</small></span>
              <span className={`num person-due ${due ? "tone-due" : "tone-paid"}`}>{due ? money(due) : "చెల్లించారు"}</span>
              <Icon name="chevron" size={16} className="muted" />
            </button></li>;
          })}</ul>}
      </aside>
    </main>

    <dialog ref={drawer} className="drawer" aria-labelledby="account-title" onCancel={(event) => { event.preventDefault(); setViewedId(""); }} onClick={(event) => { if (event.target === drawer.current) setViewedId(""); }}>
      {viewed && <div className="drawer-body">
        <div className="drawer-head">
          <Avatar name={viewed.name} size="lg" />
          <div><h2 id="account-title">{viewed.name}</h2><p className="muted">{viewedEntries.filter((entry) => !entry.voidedAt).length} నమోదులు</p></div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => setViewedId("")}><Icon name="close" size={18} /></button>
        </div>
        <div className="due-card">
          <span>మొత్తం బాకీ</span>
          <strong className="num">{money(viewedBalance)}</strong>
          <button type="button" className="listen" onClick={() => void speak(readBack.balance(viewed.name, viewedBalance))}><Icon name="speaker" size={16} /> వినండి</button>
        </div>
        <div className="quick-actions">
          <button type="button" onClick={() => startManual(viewed, "credit")}><span><Icon name="plus" /></span>బిల్లు</button>
          <button type="button" disabled={viewedBalance === 0} onClick={() => startManual(viewed, "payment")}><span><Icon name="received" /></span>డబ్బు అందింది</button>
          {viewedBalance > 0 ? <a href={whatsappLink(viewed, viewedBalance)} target="_blank" rel="noreferrer" className="wa"><span><Icon name="whatsapp" /></span>గుర్తుచేయండి</a>
            : <button type="button" disabled><span><Icon name="whatsapp" /></span>గుర్తుచేయండి</button>}
        </div>
        <div className="timeline">{timeline.map((group) => <section key={group.day}>
          <h3>{group.day}</h3>
          <ol>{group.entries.map((entry) => <li key={entry.id} className={`event ${entry.kind}${entry.voidedAt ? " voided" : ""}`}>
            <span className="event-icon"><Icon name={entry.kind === "credit" ? "plus" : "received"} size={14} /></span>
            <div className="event-body">
              <div className="event-top"><span>{entry.kind === "credit" ? "బాకీ" : "డబ్బు అందింది"}{entry.voidedAt && <em>రద్దు</em>}</span><strong className="num">{entry.kind === "credit" ? "+" : "−"}{money(entry.amountPaise)}</strong></div>
              {entry.items && <p className="event-items">{entry.items.map((item) => `${item.label} ${money(item.amountPaise)}`).join(" · ")}</p>}
              <time dateTime={entry.createdAt}>{timeLabel(entry.createdAt)}</time>
            </div>
          </li>)}</ol>
        </section>)}</div>
      </div>}
    </dialog>

    <dialog ref={sheet} className="sheet" aria-labelledby="review-title" onCancel={(event) => { event.preventDefault(); closeReview(); }}>
      {pending && <div className="receipt">
        <div className="receipt-head">
          <span className={`kind-tag ${pending.type === "undo" ? "undo" : pending.entry.kind}`}>{pending.type === "undo" ? "రద్దు" : pending.entry.kind === "credit" ? "బాకీ బిల్లు" : "డబ్బు అందింది"}</span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={closeReview}><Icon name="close" size={18} /></button>
        </div>
        <div className="receipt-who">
          {pendingCustomer && <Avatar name={pendingCustomer.name} />}
          <div><h2 id="review-title">{pendingCustomer?.name}</h2>{pending.type === "entry" && pending.newCustomer ? <span className="new-badge">కొత్త కస్టమర్</span> : <span className="muted">{new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {timeLabel(new Date().toISOString())}</span>}</div>
        </div>
        {pending.entry.items && <Receipt items={pending.entry.items} />}
        <div className="receipt-total"><span>{pending.type === "undo" ? "రద్దు అయ్యే మొత్తం" : pending.entry.kind === "credit" ? "మొత్తం" : "అందిన మొత్తం"}</span><strong className="num">{money(pending.entry.amountPaise)}</strong></div>
        <div className="balance-flow"><span>బాకీ</span><span className="num">{money(pendingBefore)}</span><Icon name="chevron" size={14} /><strong className="num">{money(pendingAfter)}</strong></div>

        <div className={`voice-answer${answer.phase === "recording" ? " live" : ""}`}>
          <span className="va-icon">{answer.phase === "recording" ? <span className="pulse-dot" /> : <Icon name="mic" size={16} />}</span>
          <p role="status">{answerNote || <>“అవును” అంటే సేవ్ · “కాదు” అంటే మార్పు</>}</p>
          {answer.phase === "recording" ? <button type="button" className="text-btn" onClick={() => answer.stop()}>ఆపండి</button>
            : <button type="button" className="text-btn" disabled={answer.phase !== "idle"} onClick={() => void listenForAnswer()}>చెప్పండి</button>}
        </div>

        <div className="receipt-actions">
          <button type="button" className="btn primary block large" onClick={confirm} autoFocus><Icon name="check" size={20} /> {pending.type === "undo" ? "రద్దు చేయండి" : "సేవ్ చేయండి"}</button>
          <div className="pair">
            {pending.type === "entry" && <button type="button" className="btn ghost" onClick={editPending}><Icon name="edit" size={16} /> మార్చండి</button>}
            <button type="button" className="btn ghost" onClick={closeReview}>వద్దు</button>
          </div>
        </div>
      </div>}
    </dialog>

    {toast && <div className="toast" role="status"><Icon name="check" size={18} /><span>{toast.text}</span>{toast.undoId && last?.id === toast.undoId && <button type="button" onClick={() => undoFromToast(toast.undoId!)}>Undo</button>}</div>}
  </div>;
}
