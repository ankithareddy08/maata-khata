"use client";

import { useEffect, useRef, useState } from "react";
import { addEntryWithCustomer, balanceFor, emptyLedger, parseAmount, restoreLedger, STORAGE_KEY, undoLastEntry, type Customer, type Entry, type Ledger, type LineItem } from "@/lib/ledger";
import VoiceCapture from "./components/voice-capture";
import { Icon } from "./components/icons";
import { speak as speakIn, stopSpeaking, transcribe, understand, useRecorder } from "@/lib/client-voice";
import { describe, isLang, LANG_KEY, LANGS, Problem, STRINGS, type Lang } from "@/lib/i18n";
import { heardYesNo } from "@/lib/yes-no";

type Pending = { type: "entry"; entry: Entry; newCustomer?: Customer; spoken: boolean } | { type: "undo"; entry: Entry; spoken: boolean };
type ItemDraft = { id: string; label: string; amount: string };
type Toast = { text: string; undoId?: string };

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 === 0 ? 0 : 2 }).format(paise / 100);
const rupees = (paise: number) => (paise / 100).toFixed(paise % 100 ? 2 : 0);
const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").normalize("NFC");
const blankItem = (): ItemDraft => ({ id: crypto.randomUUID(), label: "", amount: "" });
const timeLabel = (value: string) => new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const dayLabel = (value: string, words: { today: string; yesterday: string; locale: string }) => {
  const date = new Date(value);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(value).setHours(0, 0, 0, 0)) / 86_400_000);
  return days === 0 ? words.today : days === 1 ? words.yesterday : date.toLocaleDateString(words.locale, { day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
};
const relative = (value: string, locale: string) => {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
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
  const [lang, setLang] = useState<Lang>("te");
  const t = STRINGS[lang];
  const speak = (text: string) => speakIn(text, lang);
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
    }
    try { const saved = window.localStorage.getItem(LANG_KEY); if (isLang(saved)) setLang(saved); } catch { /* Telugu by default */ }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return; // wait until the saved language has been read
    document.documentElement.lang = lang;
  }, [lang, ready]);

  function chooseLanguage(next: Lang) {
    if (next === lang) return;
    stopSpeaking();
    setLang(next);
    try { window.localStorage.setItem(LANG_KEY, next); } catch { /* the choice just won't be remembered */ }
  }

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
    if (!cleanName(name)) throw new Problem("ENTER_NAME");
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
    const sentence = entryKind === "credit" ? t.readBack.credit(cleanName(name), amountPaise, items?.length ?? 0, after) : t.readBack.payment(cleanName(name), amountPaise, after);
    void speak(sentence).then(() => { if (spoken && pendingRef.current === next) void listenForAnswer(); });
  }

  function submitManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    try {
      const items = itemDrafts.length ? itemDrafts.map((item) => ({ label: item.label.trim(), amountPaise: parseAmount(item.amount) })) : undefined;
      openReview(customerName, kind, items, amount, false);
    } catch (cause) { setError(describe(cause, lang)); }
  }

  async function handleText(text: string, spoken: boolean): Promise<string | undefined> {
    if (locked) return t.problems.FINISH_REVIEW;
    const result = await understand(text, ledger.customers);
    if (!result.ok) { const message = "code" in result && result.code ? t.problems[result.code] : describe(result.message, lang); void speak(message); return message; }
    if (result.kind === "balance") {
      const customer = ledger.customers.find((c) => c.id === result.customerId)!;
      setViewedId(customer.id);
      void speak(t.readBack.balance(customer.name, balanceFor(ledger, customer.id)));
      return undefined;
    }
    const name = result.newCustomerName ?? ledger.customers.find((c) => c.id === result.customerId)!.name;
    // Fill the manual form too, so "Edit" opens with everything in place.
    setCustomerName(name);
    setKind(result.kind);
    setAmount(result.amount);
    setItemDrafts(result.items?.map((item) => ({ id: crypto.randomUUID(), label: item.label, amount: rupees(item.amountPaise) })) ?? []);
    try { openReview(name, result.kind, result.items, result.amount, spoken); return undefined; }
    catch (cause) { void speak(t.problems.CANT_SAVE); return describe(cause, lang); }
  }

  async function listenForAnswer() {
    if (!pendingRef.current || answer.phase !== "idle") return;
    setAnswerNote(t.answerListening);
    try {
      const audio = await answer.start();
      if (!audio || !pendingRef.current) { setAnswerNote(""); return; }
      setAnswerNote(t.answerThinking);
      const reply = heardYesNo(await transcribe(audio, lang));
      if (!pendingRef.current) return;
      if (reply === "yes") confirm();
      else if (reply === "no") editPending();
      else setAnswerNote(t.answerMissed);
    } catch { setAnswerNote(t.answerMissed); }
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
        ? { text: (current.entry.kind === "credit" ? t.savedCredit : t.savedPayment)(saved.name, money(current.entry.amountPaise)), undoId: current.entry.id }
        : { text: t.undoneLast });
      setCustomerName("");
      setAmount("");
      setKind("credit");
      setItemDrafts([blankItem()]);
      setManualOpen(false);
      closeReview();
      void speak(t.readBack.saved());
    } catch (cause) { setError(describe(cause, lang)); closeReview(); }
    finally { confirming.current = false; }
  }

  /** Undo straight from the toast, only if the toast's entry is still the latest. */
  function undoFromToast(entryId: string) {
    if (last?.id !== entryId) return;
    persist(undoLastEntry(ledger, new Date().toISOString()));
    setToast({ text: t.undone });
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
    const text = t.whatsapp(customer.name, money(due));
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  // Group the account history by day for a readable timeline.
  const timeline: { day: string; entries: Entry[] }[] = [];
  for (const entry of viewedEntries) {
    const day = dayLabel(entry.createdAt, t);
    if (timeline.at(-1)?.day === day) timeline.at(-1)!.entries.push(entry);
    else timeline.push({ day, entries: [entry] });
  }

  return <div className={`app${ready ? " ready" : ""}`}>
    <header className="topbar">
      <a className="brand" href="#" aria-label="Maata Khata home">
        <span className="brand-mark"><Icon name="ledger" size={20} /></span>
        <span className="brand-name">{t.brand}<small>{t.brandSub}</small></span>
      </a>
      <div className="top-tools">
        <span className="device-pill"><Icon name="device" size={14} /> {t.savedOnPhone}</span>
        <div className="lang-switch" role="radiogroup" aria-label={t.language}>
          {LANGS.map((option) => <button key={option.code} type="button" role="radio" aria-checked={lang === option.code} lang={option.code} title={option.name} onClick={() => chooseLanguage(option.code)}>
            <span className="lang-short" aria-hidden="true">{option.short}</span><span className="lang-name">{option.name}</span>
          </button>)}
        </div>
      </div>
    </header>

    {blocked && <div className="banner" role="alert">{t.problems.STORAGE}</div>}

    <main className="layout">
      <div className="col-main">
        <VoiceCapture lang={lang} t={t} disabled={locked} reviewing={!!pending} onText={handleText} />

        <section className="panel today" aria-labelledby="today-title">
          <div className="panel-head"><h2 id="today-title">{t.today}</h2><span className="muted">{new Date().toLocaleDateString(t.locale, { weekday: "long", day: "numeric", month: "long" })}</span></div>
          <dl className="metrics">
            <div><dt>{t.creditGiven}</dt><dd className="num tone-due">{ready ? money(todayCredit) : "—"}</dd></div>
            <div><dt>{t.moneyReceived}</dt><dd className="num tone-paid">{ready ? money(todayPaid) : "—"}</dd></div>
            <div><dt>{t.entries}</dt><dd className="num">{ready ? today.length : "—"}</dd></div>
          </dl>
        </section>

        <details className="panel manual" ref={manualRef} open={manualOpen} onToggle={(event) => setManualOpen((event.target as HTMLDetailsElement).open)}>
          <summary>
            <span className="summary-icon"><Icon name="edit" size={18} /></span>
            <span className="summary-text">{t.manual.title}<small>{t.manual.sub}</small></span>
            <Icon name="chevron" size={18} className="chev" />
          </summary>
          <form onSubmit={submitManual}>
            <fieldset disabled={locked}>
              <div className="segmented" role="group" aria-label="Entry type">
                <button type="button" aria-pressed={kind === "credit"} onClick={() => { setKind("credit"); setItemDrafts([blankItem()]); setAmount(""); }}><Icon name="plus" size={16} /> {t.credit}</button>
                <button type="button" aria-pressed={kind === "payment"} onClick={() => { setKind("payment"); setItemDrafts([]); setAmount(""); }}><Icon name="received" size={16} /> {t.payment}</button>
              </div>
              <div className="field-group">
                <label htmlFor="customer-name">{t.customer}</label>
                <input ref={customerInput} id="customer-name" className="field" value={customerName} onChange={(event) => { setCustomerName(event.target.value); setError(""); }} list="saved-customers" placeholder={t.namePlaceholder} maxLength={60} autoComplete="off" required />
                <datalist id="saved-customers">{ledger.customers.map((customer) => <option key={customer.id} value={customer.name} />)}</datalist>
                {cleanName(customerName) && <p className={isNew ? "hint new" : "hint"}>{isNew ? t.newCustomerHint : t.currentDue(money(balance))}</p>}
              </div>

              {kind === "credit" && itemDrafts.length > 0 ? <div className="field-group">
                <span className="label-row"><label htmlFor={`label-${itemDrafts[0].id}`}>{t.items}</label><span>{t.price}</span></span>
                {itemDrafts.map((item, index) => <div className="item-row" key={item.id}>
                  <input id={`label-${item.id}`} aria-label={`Item ${index + 1}`} className="field" value={item.label} onChange={(event) => setItemDrafts((list) => list.map((row) => row.id === item.id ? { ...row, label: event.target.value } : row))} placeholder={t.itemPlaceholder} maxLength={80} required />
                  <div className="money-field"><span>₹</span><input aria-label={`Price ${index + 1}`} className="field" value={item.amount} onChange={(event) => setItemDrafts((list) => list.map((row) => row.id === item.id ? { ...row, amount: event.target.value } : row))} inputMode="decimal" placeholder="0" required /></div>
                  <button type="button" className="icon-btn" aria-label={`Remove item ${index + 1}`} disabled={itemDrafts.length === 1} onClick={() => setItemDrafts((list) => list.filter((row) => row.id !== item.id))}><Icon name="close" size={16} /></button>
                </div>)}
                <div className="row-actions">
                  <button type="button" className="text-btn" disabled={itemDrafts.length >= 20} onClick={() => setItemDrafts((list) => [...list, blankItem()])}><Icon name="plus" size={16} /> {t.addItem}</button>
                  <button type="button" className="text-btn subtle" onClick={() => { setAmount(billTotal === undefined ? "" : rupees(billTotal)); setItemDrafts([]); }}>{t.totalOnly}</button>
                </div>
              </div> : <div className="field-group">
                <label htmlFor="amount">{t.amount}</label>
                <div className="money-field large"><span>₹</span><input id="amount" className="field" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} placeholder="0" required /></div>
                {kind === "credit" && <button type="button" className="text-btn" onClick={() => { setItemDrafts([blankItem()]); setAmount(""); }}><Icon name="plus" size={16} /> {t.withItems}</button>}
              </div>}

              <div className="sum-row">
                <span>{kind === "credit" ? t.billTotal : t.receivedTotal}{selected && billTotal !== undefined && <small>{t.due} {money(balance)} → {money(balance + (kind === "credit" ? billTotal : -billTotal))}</small>}</span>
                <strong className="num">{billTotal === undefined ? "—" : money(billTotal)}</strong>
              </div>
              {error && !blocked && <p className="form-error" role="alert">{error}</p>}
              <button className="btn primary block" type="submit">{t.review} <Icon name="chevron" size={18} /></button>
            </fieldset>
          </form>
        </details>
      </div>

      <aside className="panel col-side" aria-labelledby="customers-title">
        <div className="collect">
          <div>
            <h2 id="customers-title">{t.toCollect}</h2>
            <p className="collect-amount num">{ready ? money(total) : "—"}</p>
            <p className="muted">{owing ? t.owingCount(owing) : ledger.customers.length ? t.allPaid : t.noDues}</p>
          </div>
          <button className="icon-btn" type="button" title={t.undoLast} aria-label={t.undoLast} disabled={!last || locked} onClick={() => { if (!last) return; setPending({ type: "undo", entry: last, spoken: false }); void speak(t.readBack.undo()); }}><Icon name="undo" size={18} /></button>
        </div>

        {ledger.customers.length > 0 && <div className="search"><Icon name="search" size={16} /><input placeholder={t.search} value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t.search} /></div>}

        {!ledger.customers.length ? <div className="empty">
          <span className="empty-art"><Icon name="ledger" size={28} /></span>
          <p>{t.emptyTitle}</p>
          <small>{t.emptySub}</small>
        </div> : !visibleCustomers.length ? <p className="muted center">{t.noMatch}</p>
          : <ul className="people">{visibleCustomers.map((customer) => {
            const due = balanceFor(ledger, customer.id);
            const when = lastActivity(customer.id);
            return <li key={customer.id}><button type="button" className="person" disabled={locked} onClick={() => setViewedId(customer.id)}>
              <Avatar name={customer.name} />
              <span className="person-name">{customer.name}<small>{when ? relative(when, t.locale) : ""}</small></span>
              <span className={`num person-due ${due ? "tone-due" : "tone-paid"}`}>{due ? money(due) : t.paid}</span>
              <Icon name="chevron" size={16} className="muted" />
            </button></li>;
          })}</ul>}
      </aside>
    </main>

    <dialog ref={drawer} className="drawer" aria-labelledby="account-title" onCancel={(event) => { event.preventDefault(); setViewedId(""); }} onClick={(event) => { if (event.target === drawer.current) setViewedId(""); }}>
      {viewed && <div className="drawer-body">
        <div className="drawer-head">
          <Avatar name={viewed.name} size="lg" />
          <div><h2 id="account-title">{viewed.name}</h2><p className="muted">{t.entryCount(viewedEntries.filter((entry) => !entry.voidedAt).length)}</p></div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => setViewedId("")}><Icon name="close" size={18} /></button>
        </div>
        <div className="due-card">
          <span>{t.totalDue}</span>
          <strong className="num">{money(viewedBalance)}</strong>
          <button type="button" className="listen" onClick={() => void speak(t.readBack.balance(viewed.name, viewedBalance))}><Icon name="speaker" size={16} /> {t.listen}</button>
        </div>
        <div className="quick-actions">
          <button type="button" onClick={() => startManual(viewed, "credit")}><span><Icon name="plus" /></span>{t.bill}</button>
          <button type="button" disabled={viewedBalance === 0} onClick={() => startManual(viewed, "payment")}><span><Icon name="received" /></span>{t.payment}</button>
          {viewedBalance > 0 ? <a href={whatsappLink(viewed, viewedBalance)} target="_blank" rel="noreferrer" className="wa"><span><Icon name="whatsapp" /></span>{t.remind}</a>
            : <button type="button" disabled><span><Icon name="whatsapp" /></span>{t.remind}</button>}
        </div>
        <div className="timeline">{timeline.map((group) => <section key={group.day}>
          <h3>{group.day}</h3>
          <ol>{group.entries.map((entry) => <li key={entry.id} className={`event ${entry.kind}${entry.voidedAt ? " voided" : ""}`}>
            <span className="event-icon"><Icon name={entry.kind === "credit" ? "plus" : "received"} size={14} /></span>
            <div className="event-body">
              <div className="event-top"><span>{entry.kind === "credit" ? t.credit : t.payment}{entry.voidedAt && <em>{t.voided}</em>}</span><strong className="num">{entry.kind === "credit" ? "+" : "−"}{money(entry.amountPaise)}</strong></div>
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
          <span className={`kind-tag ${pending.type === "undo" ? "undo" : pending.entry.kind}`}>{pending.type === "undo" ? t.undoTag : pending.entry.kind === "credit" ? t.creditTag : t.payment}</span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={closeReview}><Icon name="close" size={18} /></button>
        </div>
        <div className="receipt-who">
          {pendingCustomer && <Avatar name={pendingCustomer.name} />}
          <div><h2 id="review-title">{pendingCustomer?.name}</h2>{pending.type === "entry" && pending.newCustomer ? <span className="new-badge">{t.newCustomer}</span> : <span className="muted">{new Date().toLocaleDateString(t.locale, { day: "numeric", month: "short" })} · {timeLabel(new Date().toISOString())}</span>}</div>
        </div>
        {pending.entry.items && <Receipt items={pending.entry.items} />}
        <div className="receipt-total"><span>{pending.type === "undo" ? t.undoAmount : pending.entry.kind === "credit" ? t.total : t.receivedTotal}</span><strong className="num">{money(pending.entry.amountPaise)}</strong></div>
        <div className="balance-flow"><span>{t.due}</span><span className="num">{money(pendingBefore)}</span><Icon name="chevron" size={14} /><strong className="num">{money(pendingAfter)}</strong></div>

        <div className={`voice-answer${answer.phase === "recording" ? " live" : ""}`}>
          <span className="va-icon">{answer.phase === "recording" ? <span className="pulse-dot" /> : <Icon name="mic" size={16} />}</span>
          <p role="status">{answerNote || t.answerHint}</p>
          {answer.phase === "recording" ? <button type="button" className="text-btn" onClick={() => answer.stop()}>{t.stop}</button>
            : <button type="button" className="text-btn" disabled={answer.phase !== "idle"} onClick={() => void listenForAnswer()}>{t.speak}</button>}
        </div>

        <div className="receipt-actions">
          <button type="button" className="btn primary block large" onClick={confirm} autoFocus><Icon name="check" size={20} /> {pending.type === "undo" ? t.undoNow : t.save}</button>
          <div className="pair">
            {pending.type === "entry" && <button type="button" className="btn ghost" onClick={editPending}><Icon name="edit" size={16} /> {t.edit}</button>}
            <button type="button" className="btn ghost" onClick={closeReview}>{t.cancel}</button>
          </div>
        </div>
      </div>}
    </dialog>

    {toast && <div className="toast" role="status"><Icon name="check" size={18} /><span>{toast.text}</span>{toast.undoId && last?.id === toast.undoId && <button type="button" onClick={() => undoFromToast(toast.undoId!)}>{t.undo}</button>}</div>}
  </div>;
}
