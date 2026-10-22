import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import ReactDOM from 'react-dom/client';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { API_PREFIX } from '@tglobal/shared';
import '@fontsource/instrument-serif/400.css';
import '@fontsource-variable/geist';
import './index.css';
import { LoanAssistChat, useLoanAssist } from './loan-assist';
import { Button, Field, KaratSegmented, Money, PageTitle, PlanCard, Skeleton, StatusBadge, Stepper, Toast, type Plan } from './ui';

type Quote = { goldRatePerGram: number; pureGoldGrams: string; goldValuePaise: number; quotes: { planId: string; name: string; ltvAppliedPercent: number; eligibleLoanPaise: number }[] };
type Lead = { applicationId: string; mobileNumber: string; netWeightGrams: number; karat: number; planId: string; planName: string; eligibleLoanPaise: number; status: string; createdAt: string };
const api = (path: string) => `${API_PREFIX}${path}`;

function AppShell() {
  const [assistOpen, setAssistOpen] = useState(false);
  const assist = useLoanAssist();
  const reduceMotion = useReducedMotion();
  const assistTrigger = useRef<HTMLButtonElement>(null);
  const assistClose = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!assistOpen) return;
    assistClose.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAssistOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => { window.removeEventListener('keydown', closeOnEscape); assistTrigger.current?.focus(); };
  }, [assistOpen]);
  return <div className="app-shell">
    <div className="utility-line"><span>FIELD APPRAISAL</span><span>INDIA <i aria-hidden="true">·</i> GOLD LOANS</span></div>
    <div className="topbar-wrap"><nav className="topbar" aria-label="Main navigation">
      <NavLink to="/apply" className="wordmark" aria-label="TGlobal home"><span>TGLOBAL</span><small>GOLD LOANS</small></NavLink>
      <div className="topbar__links"><NavLink to="/apply">Apply</NavLink><NavLink to="/leads">Leads</NavLink></div>
      <button ref={assistTrigger} className="assist-trigger" onClick={() => setAssistOpen(true)}><span className="assist-trigger__dot" aria-hidden="true" />Ask Loan Assist</button>
    </nav></div>
    <main className="main-shell"><RoutePages /></main>
    <footer className="footer"><span>TGLOBAL <i>·</i> FIELD APPRAISAL</span><span>All figures are subject to physical verification.</span></footer>
    <AnimatePresence>{assistOpen && <motion.div className="sheet-backdrop" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setAssistOpen(false); }}>
      <motion.aside className="assist-sheet" role="dialog" aria-modal="true" aria-labelledby="assist-heading" initial={reduceMotion ? false : { y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduceMotion ? { opacity: 0 } : { y: 12, opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.22 }}>
        <div className="assist-sheet__head"><div><p className="eyebrow">AI ASSISTANT</p><h2 id="assist-heading">Loan Assist</h2></div><button ref={assistClose} className="icon-button" onClick={() => setAssistOpen(false)} aria-label="Close Loan Assist">×</button></div>
        <p>Preliminary offers from today’s rate. Nothing is filed until you confirm.</p>
        <LoanAssistChat chat={assist} />
      </motion.aside>
    </motion.div>}</AnimatePresence>
  </div>;
}

function RoutePages() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  return <AnimatePresence mode="wait" initial={false}>
    <motion.div key={location.pathname} initial={reduceMotion ? false : { opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} {...(reduceMotion ? {} : { exit: { opacity: 0, y: -4 } })} transition={{ duration: 0.18 }}>
      <Routes location={location}>
        <Route path="/apply" element={<ApplyPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        {import.meta.env.DEV && <Route path="/__components" element={<ComponentGallery />} />}
        <Route path="*" element={<ApplyPage />} />
      </Routes>
    </motion.div>
  </AnimatePresence>;
}

function ApplyPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState('');
  const [form, setForm] = useState({ name: '', mobileNumber: '', grossWeightGrams: '', netWeightGrams: '', karat: 22, planId: '' });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(api('/loan-schemes')).then(async (response) => {
      if (!response.ok) throw new Error('Loan schemes could not be loaded.');
      return response.json() as Promise<Plan[]>;
    }).then((data) => { if (alive) { setPlans(data); setForm((current) => ({ ...current, planId: current.planId || data[0]?.id || '' })); } })
      .catch((error: unknown) => { if (alive) setPlansError(error instanceof Error ? error.message : 'Loan schemes could not be loaded.'); })
      .finally(() => { if (alive) setPlansLoading(false); });
    return () => { alive = false; };
  }, []);

  function update(field: keyof typeof form, value: string | number) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
    if (field === 'netWeightGrams' || field === 'grossWeightGrams' || field === 'karat') setQuote(null);
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    setErrors({}); setToast('');
    const body = { netWeightGrams: form.netWeightGrams, grossWeightGrams: form.grossWeightGrams, karat: form.karat };
    try {
      const response = await fetch(api('/quotes'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) {
        const fieldErrors: Record<string, string> = {};
        for (const field of payload.error?.fields ?? []) fieldErrors[field.field] = field.message;
        setErrors(fieldErrors); if (!Object.keys(fieldErrors).length) setToast(payload.error?.message ?? 'The quote could not be prepared.');
        return;
      }
      setQuote(payload as Quote);
    } catch { setToast('The quote could not be reached. Check your connection and try again.'); }
  }

  async function submitLead() {
    setErrors({}); setToast(''); setSubmitting(true);
    try {
      const response = await fetch(api('/leads'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) {
        const fieldErrors: Record<string, string> = {};
        for (const field of payload.error?.fields ?? []) fieldErrors[field.field] = field.message;
        setErrors(fieldErrors); setToast(payload.error?.message ?? 'The application could not be saved.');
        return;
      }
      setToast(`Application ${payload.applicationId} recorded.`); setQuote(null);
      setForm({ name: '', mobileNumber: '', grossWeightGrams: '', netWeightGrams: '', karat: 22, planId: plans[0]?.id ?? '' });
    } catch { setToast('The application could not be reached. Check your connection and try again.'); }
    finally { setSubmitting(false); }
  }

  return <>
    <div className="page-heading-row"><PageTitle eyebrow="NEW APPLICATION / 01" title="Appraise a pledge">Record the customer and the gold in front of you. The offer is calculated from today’s rate.</PageTitle><div className="rate-note"><span className="rate-note__label">TODAY’S 24K RATE</span><strong>₹7,000</strong><span>per gram <i>·</i> reference rate</span></div></div>
    <Stepper active={0} />
    <form className="application-layout" onSubmit={calculate}>
      <div className="application-main">
        <section className="form-section" aria-labelledby="customer-heading">
          <div className="section-heading"><span className="section-index">01</span><div><h2 id="customer-heading">Customer details</h2><p>Use the number where the customer can be reached.</p></div></div>
          <div className="field-grid"><Field name="name" label="Customer name" autoComplete="name" placeholder="As on identity document" value={form.name} onChange={(event) => update('name', event.target.value)} error={errors.name} />
            <Field name="mobileNumber" label="Mobile number" inputMode="numeric" autoComplete="tel-national" placeholder="10-digit mobile number" hint="Use an Indian mobile number beginning 6–9." value={form.mobileNumber} onChange={(event) => update('mobileNumber', event.target.value)} error={errors.mobileNumber} /></div>
        </section>
        <section className="form-section" aria-labelledby="gold-heading">
          <div className="section-heading"><span className="section-index">02</span><div><h2 id="gold-heading">Gold details</h2><p>Weigh the item first. Keep stones and fittings out of the net weight.</p></div></div>
          <div className="weight-grid"><Field name="grossWeightGrams" label="Gross weight" inputMode="decimal" placeholder="0.000" suffix="g" value={form.grossWeightGrams} onChange={(event) => update('grossWeightGrams', event.target.value)} error={errors.grossWeightGrams} /><Field name="netWeightGrams" label="Net gold weight" inputMode="decimal" placeholder="0.000" suffix="g" hint="Enter up to three decimal places." value={form.netWeightGrams} onChange={(event) => update('netWeightGrams', event.target.value)} error={errors.netWeightGrams} /></div>
          <div className="purity-row"><div><span className="field__label">Karat</span><p className="field__hint">Check the hallmark or test result.</p></div><KaratSegmented value={form.karat} onChange={(value) => update('karat', value)} /></div>
        </section>
        <section className="form-section form-section--last" aria-labelledby="plan-heading">
          <div className="section-heading"><span className="section-index">03</span><div><h2 id="plan-heading">Repayment plan</h2><p>Confirm the repayment schedule with the customer.</p></div></div>
          {plansLoading ? <Skeleton lines={2} /> : plansError ? <p className="inline-error" role="alert">{plansError}</p> : <div className="plan-grid" role="radiogroup" aria-labelledby="plan-heading">{plans.map((plan) => <PlanCard key={plan.id} plan={plan} selected={form.planId === plan.id} onSelect={() => update('planId', plan.id)} />)}</div>}
        </section>
        <div className="form-actions"><p>Quote is indicative. Final value follows physical verification.</p><Button type="submit" disabled={!form.netWeightGrams || !form.grossWeightGrams}>Calculate offer <span aria-hidden="true">→</span></Button></div>
      </div>
      <aside className="offer-panel" aria-live="polite">
        <p className="eyebrow">APPRAISAL SUMMARY</p>
        {quote ? <>
          <h2>Indicative value</h2><div className="offer-value"><Money paise={quote.goldValuePaise} /></div>
          <p className="offer-detail">{quote.pureGoldGrams}g pure gold <i>·</i> {form.karat}K</p>
          <div className="offer-rule" />
          <p className="offer-kicker">AVAILABLE AGAINST SELECTED PLAN</p>
          {quote.quotes.map((item) => <div className={`offer-loan ${form.planId === item.planId ? 'is-current' : ''}`} key={item.planId}><span>{item.name}<small>{item.ltvAppliedPercent}% of gold value</small></span><Money paise={item.eligibleLoanPaise} /></div>)}
          <Button type="button" className="offer-submit" onClick={submitLead} disabled={submitting}>{submitting ? 'Recording…' : 'Record application'} <span aria-hidden="true">→</span></Button>
          <p className="offer-footnote">Rates and eligibility are subject to branch verification.</p>
        </> : <>
          <h2>Offer appears here</h2><p className="offer-empty">Enter the measured net gold weight, then calculate. The value uses the selected karat and current reference rate.</p>
          <div className="offer-empty-rule"><span>24K RATE</span><strong>₹7,000 / g</strong></div>
          <div className="offer-empty-rule"><span>VALUE BASIS</span><strong>Net gold weight</strong></div>
        </>}
        {toast && <Toast message={toast} onClose={() => setToast('')} />}
      </aside>
    </form>
  </>;
}

function LeadsPage() {
  const [items, setItems] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [planId, setPlanId] = useState('');
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => { fetch(api('/loan-schemes')).then((r) => r.json()).then(setPlans).catch(() => undefined); }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    fetch(api(`/leads?limit=50${planId ? `&planId=${encodeURIComponent(planId)}` : ''}`)).then(async (response) => {
      if (!response.ok) throw new Error('Lead records could not be loaded.');
      return response.json();
    }).then((data) => { if (active) setItems(data.items as Lead[]); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Lead records could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [planId]);
  const reduceMotion = useReducedMotion();
  return <>
    <div className="page-heading-row"><PageTitle eyebrow="FIELD RECORDS / 02" title="Lead register">Recent applications, in the order they were entered.</PageTitle><NavLink className="button button--ink new-lead-link" to="/apply">New appraisal <span aria-hidden="true">→</span></NavLink></div>
    <div className="register-toolbar"><div><span className="register-count">{loading ? '—' : items.length.toString().padStart(2, '0')}</span><span>APPLICATIONS</span></div><label className="filter-label">PLAN <select value={planId} onChange={(event) => setPlanId(event.target.value)}><option value="">All plans</option>{plans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name}</option>)}</select></label></div>
    <section className="register" aria-label="Lead applications">
      <div className="register-head"><span>APPLICATION</span><span>CUSTOMER</span><span>GOLD</span><span>PLAN</span><span>ELIGIBLE LOAN</span><span>STATUS</span></div>
      {loading ? <div className="register-loading"><Skeleton lines={5} /></div> : error ? <p className="register-empty" role="alert">{error}</p> : items.length === 0 ? <div className="register-empty"><p>No applications yet.</p><span>Submitted appraisals will appear here.</span></div> : <div className="register-rows">{items.map((lead, index) => <motion.article className="register-row" key={lead.applicationId} initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: reduceMotion ? 0 : Math.min(index * 0.035, 0.24) }}>
        <span className="register-id">{lead.applicationId}<small>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(lead.createdAt))}</small></span><span className="register-mobile">{lead.mobileNumber}</span><span>{lead.netWeightGrams}g <small>{lead.karat}K</small></span><span>{lead.planName}</span><Money paise={lead.eligibleLoanPaise} /><StatusBadge status={lead.status} />
      </motion.article>)}</div>}
    </section>
  </>;
}

function ComponentGallery() {
  const [karat, setKarat] = useState(22); const [toast, setToast] = useState('Application GL-1001 recorded.');
  const specimen: Plan = { id: 'PLAN_EMI_01', name: 'Monthly EMI', annualInterestRate: 10.5, tenureMonths: 12, maxLtv: 75, repaymentType: 'EMI' };
  return <div className="component-gallery"><PageTitle eyebrow="INTERNAL REFERENCE" title="Field kit">Interface components in their working states.</PageTitle><div className="gallery-grid">
    <section><h2>Buttons &amp; fields</h2><div className="gallery-sample"><Button>Calculate offer <span aria-hidden="true">→</span></Button><Button tone="quiet">Save draft</Button><Field label="Net gold weight" name="sample-weight" placeholder="0.000" suffix="g" hint="Enter up to three decimal places." /><Field label="Customer name" name="sample-error" value="" error="Enter the customer name." readOnly /></div></section>
    <section><h2>Selection &amp; progress</h2><div className="gallery-sample"><KaratSegmented value={karat} onChange={setKarat} /><PlanCard plan={specimen} selected onSelect={() => undefined} /><Stepper active={1} /></div></section>
    <section><h2>Value &amp; status</h2><div className="gallery-sample"><Money className="gallery-money" paise={21656200} /><StatusBadge status="SUBMITTED" /><StatusBadge status="APPROVED" /><StatusBadge status="REJECTED" /></div></section>
    <section><h2>Loading &amp; feedback</h2><div className="gallery-sample"><Skeleton lines={3} />{toast && <Toast message={toast} onClose={() => setToast('')} />}<Button tone="quiet" onClick={() => setToast('Application GL-1001 recorded.')}>Show message</Button></div></section>
  </div></div>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><AppShell /></BrowserRouter></React.StrictMode>);
