import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type Plan, type Quote, type SubmittedLead } from '../lib/api';
import { duplicateMessage, formatDate, formatRupees } from '../lib/format';
import { useLiveQuote, usePlans } from '../lib/hooks';
import {
  quoteInputFrom,
  validateDetails,
  type DetailsErrors,
  type DetailsField,
  type DetailsForm,
} from '../lib/validation';
import {
  Button,
  ButtonLink,
  Field,
  Icon,
  KaratSegmented,
  Money,
  PageHeader,
  Pill,
  Skeleton,
} from '../ui';

type Form = DetailsForm & { planId: string };
const emptyForm: Form = {
  name: '',
  mobileNumber: '',
  grossWeightGrams: '',
  netWeightGrams: '',
  karat: 22,
  planId: '',
};
const stepNames = ['Details', 'Live quote', 'Confirm'] as const;
const fieldOrder: DetailsField[] = [
  'name',
  'mobileNumber',
  'grossWeightGrams',
  'netWeightGrams',
  'karat',
];
const weightFields: DetailsField[] = ['grossWeightGrams', 'netWeightGrams'];

export function ApplyPage() {
  const [form, setForm] = useState<Form>(emptyForm);
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState<Set<DetailsField>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<DetailsErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [result, setResult] = useState<SubmittedLead | null>(null);
  const { plans, loading: plansLoading, error: plansError } = usePlans();
  const live = useLiveQuote(quoteInputFrom(form));
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  // One key per version of the form: retrying the same submission replays it, an edit starts afresh.
  const idempotencyKey = useRef(crypto.randomUUID());

  const errors = validateDetails(form);
  const visibleError = (field: DetailsField) => {
    if (serverErrors[field]) return serverErrors[field];
    const show =
      attempted || touched.has(field) || (weightFields.includes(field) && form[field] !== '');
    return show ? errors[field] : undefined;
  };

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step, result]);

  function update<K extends keyof Form>(field: K, value: Form[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    idempotencyKey.current = crypto.randomUUID();
    setServerErrors((current) => ({ ...current, [field]: undefined }));
    setSubmitError('');
    setIsDuplicate(false);
  }

  const touch = (field: DetailsField) => setTouched((current) => new Set(current).add(field));

  function continueFromDetails(event: FormEvent) {
    event.preventDefault();
    const invalid = fieldOrder.find((field) => errors[field] || serverErrors[field]);
    if (invalid) {
      setAttempted(true);
      const target =
        invalid === 'karat'
          ? document.querySelector<HTMLInputElement>('input[name="karat"]')
          : document.getElementById(invalid);
      target?.focus();
      return;
    }
    setStep(1);
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError('');
    setIsDuplicate(false);
    try {
      const { planId, karat, ...details } = form;
      setResult(
        await api.submitLead(
          { ...details, karat: karat as 18 | 22 | 24, planId },
          idempotencyKey.current,
        ),
      );
    } catch (reason) {
      const error =
        reason instanceof ApiError
          ? reason
          : new ApiError(0, 'UNKNOWN_ERROR', 'The application could not be submitted.');
      if (error.status === 409 && error.existing) {
        setSubmitError(duplicateMessage(error.existing));
        setIsDuplicate(true);
      } else if (error.status === 400 && error.fields.length) {
        setServerErrors(
          Object.fromEntries(error.fields.map((field) => [field.field, field.message])),
        );
        setAttempted(true);
        setStep(error.fields.some((field) => field.field === 'planId') ? 1 : 0);
      } else if (error.code === 'PLAN_NOT_FOUND') {
        update('planId', '');
        setStep(1);
        setSubmitError('That plan is no longer available. Please choose another.');
      } else {
        setSubmitError(error.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function startOver() {
    setForm(emptyForm);
    idempotencyKey.current = crypto.randomUUID();
    setTouched(new Set());
    setAttempted(false);
    setServerErrors({});
    setSubmitError('');
    setIsDuplicate(false);
    setResult(null);
    setStep(0);
  }

  if (result) return <Success result={result} headingRef={heading} onStartOver={startOver} />;

  const selectedPlan = plans.find((plan) => plan.id === form.planId);
  const selectedQuote = live.quote?.quotes.find((item) => item.planId === form.planId);

  return (
    <div className="page apply">
      <PageHeader pill="New application" title="Apply for a gold loan">
        Three short steps. The offer updates as you type and nothing is filed until you submit.
      </PageHeader>

      <ol className="stepper" aria-label="Application progress">
        {stepNames.map((name, index) => (
          <li
            key={name}
            className={`${index === step ? 'is-active' : ''} ${index < step ? 'is-complete' : ''}`}
          >
            <button
              type="button"
              disabled={index >= step}
              onClick={() => setStep(index)}
              aria-current={index === step ? 'step' : undefined}
            >
              <span className="stepper__number">
                {index < step ? <Icon name="check" /> : `0${index + 1}`}
              </span>
              {name}
            </button>
          </li>
        ))}
      </ol>

      <div className="apply__layout">
        <div className="apply__main card">
          {step === 0 && (
            <form noValidate onSubmit={continueFromDetails}>
              <h2 ref={heading} tabIndex={-1} className="step-title">
                Borrower and gold details
              </h2>
              <fieldset className="form-group">
                <legend>Borrower</legend>
                <div className="field-grid">
                  <Field
                    name="name"
                    label="Full name"
                    autoComplete="name"
                    placeholder="As on identity document"
                    value={form.name}
                    onChange={(event) => update('name', event.target.value)}
                    onBlur={() => touch('name')}
                    error={visibleError('name')}
                  />
                  <Field
                    name="mobileNumber"
                    label="Mobile number"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={10}
                    placeholder="10-digit mobile number"
                    hint="Indian mobile number starting with 6–9."
                    value={form.mobileNumber}
                    onChange={(event) =>
                      update('mobileNumber', event.target.value.replace(/\D/g, ''))
                    }
                    onBlur={() => touch('mobileNumber')}
                    error={visibleError('mobileNumber')}
                  />
                </div>
              </fieldset>
              <fieldset className="form-group">
                <legend>Gold</legend>
                <div className="field-grid">
                  <Field
                    name="grossWeightGrams"
                    label="Gross weight"
                    inputMode="decimal"
                    placeholder="0.000"
                    suffix="g"
                    hint="Including stones and fittings."
                    value={form.grossWeightGrams}
                    onChange={(event) => update('grossWeightGrams', event.target.value)}
                    onBlur={() => touch('grossWeightGrams')}
                    error={visibleError('grossWeightGrams')}
                  />
                  <Field
                    name="netWeightGrams"
                    label="Net gold weight"
                    inputMode="decimal"
                    placeholder="0.000"
                    suffix="g"
                    hint="Gold only, up to 3 decimal places."
                    value={form.netWeightGrams}
                    onChange={(event) => update('netWeightGrams', event.target.value)}
                    onBlur={() => touch('netWeightGrams')}
                    error={visibleError('netWeightGrams')}
                  />
                </div>
                <KaratSegmented
                  value={form.karat}
                  onChange={(karat) => update('karat', karat)}
                  error={visibleError('karat')}
                />
              </fieldset>
              <div className="form-actions">
                <p>Check the hallmark or test result for the karat.</p>
                <Button type="submit" size="lg">
                  Continue to quote <Icon name="arrow" />
                </Button>
              </div>
            </form>
          )}

          {step === 1 && (
            <div>
              <h2 ref={heading} tabIndex={-1} className="step-title">
                Choose a repayment plan
              </h2>
              <p className="step-lede">
                Eligible loan for {form.netWeightGrams} g of {form.karat}K gold on each plan.
              </p>
              {plansLoading ? (
                <Skeleton lines={3} label="Loading plans" />
              ) : plansError ? (
                <p className="alert alert--error" role="alert">
                  {plansError}
                </p>
              ) : (
                <div className="plan-options" role="radiogroup" aria-label="Repayment plan">
                  {plans.map((plan) => (
                    <PlanOption
                      key={plan.id}
                      plan={plan}
                      quote={live.quote}
                      pending={live.pending}
                      selected={form.planId === plan.id}
                      onSelect={() => update('planId', plan.id)}
                    />
                  ))}
                </div>
              )}
              {submitError && (
                <p className="alert alert--error" role="alert">
                  {submitError}
                </p>
              )}
              <div className="form-actions">
                <Button tone="outline" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button
                  size="lg"
                  disabled={!form.planId || !selectedQuote || live.pending}
                  onClick={() => setStep(2)}
                >
                  Review application <Icon name="arrow" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && selectedPlan && (
            <div>
              <h2 ref={heading} tabIndex={-1} className="step-title">
                Review and submit
              </h2>
              <p className="step-lede">The server recalculates the offer when you submit.</p>
              <div className="review">
                <ReviewGroup
                  title="Borrower"
                  onEdit={() => setStep(0)}
                  rows={[
                    ['Full name', form.name.trim()],
                    ['Mobile number', form.mobileNumber],
                  ]}
                />
                <ReviewGroup
                  title="Gold"
                  onEdit={() => setStep(0)}
                  rows={[
                    ['Gross weight', `${form.grossWeightGrams} g`],
                    ['Net gold weight', `${form.netWeightGrams} g`],
                    ['Karat', `${form.karat}K`],
                    ...(live.quote
                      ? [['Pure gold', `${live.quote.pureGoldGrams} g`] as [string, string]]
                      : []),
                  ]}
                />
                <ReviewGroup
                  title="Plan"
                  onEdit={() => setStep(1)}
                  rows={[
                    ['Plan', selectedPlan.name],
                    ['Interest', `${selectedPlan.annualInterestRate}% p.a.`],
                    ['Tenure', `${selectedPlan.tenureMonths} months`],
                  ]}
                />
              </div>
              {selectedQuote && (
                <div className="review__offer">
                  <span>Eligible loan</span>
                  <Money paise={selectedQuote.eligibleLoanPaise} />
                  <small>
                    {selectedQuote.ltvAppliedPercent}% of gold value · preliminary, subject to
                    verification
                  </small>
                </div>
              )}
              {submitError && (
                <div className="alert alert--error" role="alert">
                  <p>{submitError}</p>
                  {isDuplicate && <Link to="/leads">View the lead register</Link>}
                </div>
              )}
              <div className="form-actions">
                <Button tone="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button size="lg" onClick={submit} disabled={submitting || live.pending}>
                  {submitting ? 'Submitting…' : 'Submit application'} <Icon name="arrow" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <LiveQuotePanel
          hasInput={Boolean(quoteInputFrom(form))}
          live={live}
          karat={form.karat}
          selectedPlanId={form.planId}
        />
      </div>
    </div>
  );
}

function PlanOption({
  plan,
  quote,
  pending,
  selected,
  onSelect,
}: {
  plan: Plan;
  quote: Quote | null;
  pending: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const offer = quote?.quotes.find((item) => item.planId === plan.id);
  return (
    <label className={`plan-option ${selected ? 'is-selected' : ''}`}>
      <input
        className="sr-only"
        type="radio"
        name="planId"
        value={plan.id}
        checked={selected}
        onChange={onSelect}
      />
      <span className="plan-option__top">
        <span className="plan-option__kind">
          {plan.repaymentType === 'EMI' ? 'Monthly instalments' : 'Single repayment'}
        </span>
        <span className="plan-option__radio" aria-hidden="true" />
      </span>
      <span className="plan-option__name">{plan.name}</span>
      <span className="plan-option__terms">
        {plan.annualInterestRate}% p.a. · {plan.tenureMonths} months · up to {plan.maxLtv}% LTV
      </span>
      <span className="plan-option__loan">
        <small>Eligible loan</small>
        {offer ? (
          <Money paise={offer.eligibleLoanPaise} className={pending ? 'is-stale' : ''} />
        ) : (
          <span className="plan-option__na">—</span>
        )}
      </span>
    </label>
  );
}

function ReviewGroup({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: [string, string][];
  onEdit: () => void;
}) {
  return (
    <section className="review__group" aria-label={title}>
      <div className="review__head">
        <h3>{title}</h3>
        <button type="button" className="text-button" onClick={onEdit}>
          Edit<span className="sr-only"> {title.toLowerCase()}</span>
        </button>
      </div>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LiveQuotePanel({
  hasInput,
  live,
  karat,
  selectedPlanId,
}: {
  hasInput: boolean;
  live: ReturnType<typeof useLiveQuote>;
  karat: number;
  selectedPlanId: string;
}) {
  return (
    <aside className="quote-panel" aria-labelledby="quote-panel-heading">
      <div className="quote-panel__head">
        <h2 id="quote-panel-heading">Live quote</h2>
        <span className="quote-panel__status" aria-live="polite">
          {live.pending && hasInput ? 'Updating…' : live.quote ? 'Up to date' : ''}
        </span>
      </div>
      {!hasInput ? (
        <p className="quote-panel__empty">
          Enter the gross and net weight to see the offer for every plan.
        </p>
      ) : live.error ? (
        <p className="alert alert--error" role="alert">
          {live.error.fields[0]?.message ?? live.error.message}
        </p>
      ) : !live.quote ? (
        <Skeleton lines={4} label="Calculating quote" />
      ) : (
        <div className={live.pending ? 'is-stale' : ''}>
          <span className="quote-panel__label">Estimated gold value</span>
          <Money paise={live.quote.goldValuePaise} className="quote-panel__value" />
          <p className="quote-panel__sub">
            Pure gold {live.quote.pureGoldGrams} g · {karat}K ·{' '}
            {formatRupees(live.quote.goldRatePerGram * 100)}/g 24K rate
          </p>
          <ul className="quote-panel__plans">
            {live.quote.quotes.map((item) => (
              <li key={item.planId} className={item.planId === selectedPlanId ? 'is-selected' : ''}>
                <span>
                  {item.name}
                  <small>{item.ltvAppliedPercent}% of value</small>
                </span>
                <Money paise={item.eligibleLoanPaise} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="quote-panel__note">
        Indicative only. The final amount follows physical verification of the gold.
      </p>
    </aside>
  );
}

function Success({
  result,
  headingRef,
  onStartOver,
}: {
  result: SubmittedLead;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onStartOver: () => void;
}) {
  return (
    <div className="page success">
      <div className="success__card card">
        <span className="success__mark">
          <Icon name="check" />
        </span>
        <Pill>Application recorded</Pill>
        <h1 ref={headingRef} tabIndex={-1}>
          {result.applicationId}
        </h1>
        <p>Keep this application ID for your branch visit.</p>
        <dl>
          <div>
            <dt>Eligible loan</dt>
            <dd>
              <Money paise={result.quote.eligibleLoanPaise} />
            </dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>{result.quote.planName}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{result.status.replaceAll('_', ' ')}</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{formatDate(result.createdAt)}</dd>
          </div>
        </dl>
        <div className="success__actions">
          <Button tone="outline" onClick={onStartOver}>
            New application
          </Button>
          <ButtonLink to="/leads">
            View lead register <Icon name="arrow" />
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
