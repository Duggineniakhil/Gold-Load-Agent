import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatRupees, formatRupeesWithPaise } from '../lib/format';
import { useGoldRate, useLiveQuote, usePlans, useRepaymentEstimate } from '../lib/hooks';
import { quoteInputFrom, validateWeights } from '../lib/validation';
import {
  Button,
  Field,
  Icon,
  KaratSegmented,
  Money,
  PageHeader,
  SegmentedControl,
  Skeleton,
} from '../ui';

const SLIDER_STEP = 100;
const SLIDER_FLOOR = 1000;

/** Slider bounds whose top is exactly the eligible loan, moving in ₹100 steps. */
function sliderRange(eligibleRupees: number) {
  if (eligibleRupees <= SLIDER_FLOOR) return { min: eligibleRupees, max: eligibleRupees };
  const span = Math.floor((eligibleRupees - SLIDER_FLOOR) / SLIDER_STEP) * SLIDER_STEP;
  return { min: eligibleRupees - span, max: eligibleRupees };
}

export function CalculatorPage() {
  const navigate = useNavigate();
  const [weights, setWeights] = useState({ grossWeightGrams: '', netWeightGrams: '', karat: 22 });
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const { plans, loading: plansLoading, error: plansError } = usePlans();
  const [planId, setPlanId] = useState('');
  const rate = useGoldRate();
  const live = useLiveQuote(quoteInputFrom(weights));
  const errors = validateWeights(weights);
  const showError = (field: 'grossWeightGrams' | 'netWeightGrams') =>
    touched.has(field) || weights[field] !== '' ? errors[field] : undefined;

  useEffect(() => {
    if (!planId && plans[0]) setPlanId(plans[0].id);
  }, [plans, planId]);

  const plan = plans.find((item) => item.id === planId);
  const offer = live.quote?.quotes.find((item) => item.planId === planId);
  const eligibleRupees = offer ? Math.trunc(offer.eligibleLoanPaise / 100) : null;
  const [amount, setAmount] = useState<number | null>(null);
  // A new eligible loan (new weights or plan) resets the amount to the full offer.
  useEffect(() => setAmount(eligibleRupees), [eligibleRupees]);

  const repayment = useRepaymentEstimate(planId, amount);
  const estimate = repayment.estimate;
  const range = eligibleRupees ? sliderRange(eligibleRupees) : null;

  const update = (field: 'grossWeightGrams' | 'netWeightGrams', value: string) =>
    setWeights((current) => ({ ...current, [field]: value }));

  return (
    <div className="page calculator">
      <PageHeader
        pill="Calculator"
        title="Gold loan calculator"
        action={
          rate && (
            <div className="rate-chip">
              <span className="rate-chip__live" aria-hidden="true" />
              <div>
                <span>Today’s 24K rate</span>
                <strong>{formatRupees(rate.ratePerGram24k * 100)}/g</strong>
              </div>
            </div>
          )
        }
      >
        Estimate your loan and repayment in seconds. No name or mobile number needed.
      </PageHeader>

      <div className="calculator__layout">
        <section className="card calculator__inputs" aria-labelledby="calculator-gold-heading">
          <h2 id="calculator-gold-heading" className="step-title">
            Your gold
          </h2>
          <div className="field-grid">
            <Field
              name="calc-gross"
              label="Gross weight"
              inputMode="decimal"
              placeholder="0.000"
              suffix="g"
              hint="Including stones and fittings."
              value={weights.grossWeightGrams}
              onChange={(event) => update('grossWeightGrams', event.target.value)}
              onBlur={() => setTouched((current) => new Set(current).add('grossWeightGrams'))}
              error={showError('grossWeightGrams')}
            />
            <Field
              name="calc-net"
              label="Net gold weight"
              inputMode="decimal"
              placeholder="0.000"
              suffix="g"
              hint="Gold only, up to 3 decimal places."
              value={weights.netWeightGrams}
              onChange={(event) => update('netWeightGrams', event.target.value)}
              onBlur={() => setTouched((current) => new Set(current).add('netWeightGrams'))}
              error={showError('netWeightGrams')}
            />
          </div>
          <KaratSegmented
            value={weights.karat}
            onChange={(karat) => setWeights((current) => ({ ...current, karat }))}
          />
          {plansLoading ? (
            <Skeleton lines={1} label="Loading plans" />
          ) : plansError ? (
            <p className="alert alert--error" role="alert">
              {plansError}
            </p>
          ) : (
            <SegmentedControl
              legend="Plan"
              name="calc-plan"
              options={plans.map((item) => ({ value: item.id, label: item.name }))}
              value={planId}
              onChange={setPlanId}
            />
          )}
          <dl className="calculator__facts">
            <div>
              <dt>Pure gold</dt>
              <dd>{live.quote ? `${live.quote.pureGoldGrams} g` : '—'}</dd>
            </div>
            <div>
              <dt>Gold value</dt>
              <dd>{live.quote ? <Money paise={live.quote.goldValuePaise} /> : '—'}</dd>
            </div>
          </dl>
        </section>

        <section
          className="calculator__results"
          aria-labelledby="calculator-offer-heading"
          aria-live="polite"
        >
          <div className="quote-panel">
            <div className="quote-panel__head">
              <h2 id="calculator-offer-heading">Your offer</h2>
              {plan && (
                <span className="quote-panel__status">
                  {plan.annualInterestRate}% p.a. · up to {plan.maxLtv}% LTV
                </span>
              )}
            </div>

            {!quoteInputFrom(weights) ? (
              <p className="quote-panel__empty">
                Enter the gross and net weight to see your eligible loan.
              </p>
            ) : live.error ? (
              <p className="alert alert--error" role="alert">
                {live.error.fields[0]?.message ?? live.error.message}
              </p>
            ) : !offer ? (
              <Skeleton lines={3} label="Calculating your offer" />
            ) : (
              <div className={live.pending ? 'is-stale' : ''}>
                <span className="quote-panel__label">Eligible loan · {offer.name}</span>
                <Money paise={offer.eligibleLoanPaise} className="quote-panel__value" />

                {range && amount !== null && (
                  <div className="calculator__slider">
                    <div className="calculator__slider-head">
                      <label htmlFor="calc-amount">Loan amount</label>
                      <strong>{formatRupees(amount * 100)}</strong>
                    </div>
                    <input
                      id="calc-amount"
                      type="range"
                      min={range.min}
                      max={range.max}
                      step={SLIDER_STEP}
                      value={amount}
                      disabled={range.min === range.max}
                      onChange={(event) => setAmount(Number(event.target.value))}
                    />
                    <p className="field__hint">Borrow any amount up to your eligible loan.</p>
                  </div>
                )}

                {repayment.error ? (
                  <p className="alert alert--error" role="alert">
                    {repayment.error}
                  </p>
                ) : estimate ? (
                  <div className={`calculator__breakdown ${repayment.pending ? 'is-stale' : ''}`}>
                    <dl>
                      <div className="is-primary">
                        <dt>
                          {estimate.monthlyInstalmentPaise === null
                            ? 'Payable at maturity'
                            : 'Monthly EMI'}
                        </dt>
                        <dd>
                          {formatRupeesWithPaise(
                            estimate.monthlyInstalmentPaise ?? estimate.totalPayablePaise,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Total interest</dt>
                        <dd>{formatRupeesWithPaise(estimate.totalInterestPaise)}</dd>
                      </div>
                      <div>
                        <dt>Total payable</dt>
                        <dd>{formatRupeesWithPaise(estimate.totalPayablePaise)}</dd>
                      </div>
                    </dl>
                    <div
                      className="calculator__split"
                      role="img"
                      aria-label={`Principal ${formatRupees(estimate.principalPaise)}, interest ${formatRupeesWithPaise(estimate.totalInterestPaise)}`}
                    >
                      <span style={{ flexGrow: estimate.principalPaise }} />
                      <span style={{ flexGrow: estimate.totalInterestPaise }} />
                    </div>
                    <div className="calculator__legend" aria-hidden="true">
                      <span>
                        <i className="is-principal" /> Principal
                      </span>
                      <span>
                        Interest <i className="is-interest" />
                      </span>
                    </div>
                    <p className="quote-panel__note">
                      Illustrative estimate over {estimate.tenureMonths} months at{' '}
                      {estimate.annualInterestRate}% p.a.
                      {estimate.repaymentType === 'BULLET'
                        ? ' Interest and principal are repaid together at maturity.'
                        : ' Equal monthly instalments on a reducing balance.'}
                    </p>
                  </div>
                ) : (
                  <Skeleton lines={2} label="Calculating repayment" />
                )}
              </div>
            )}
          </div>

          <Button
            size="lg"
            className="calculator__apply"
            disabled={!offer || !quoteInputFrom(weights)}
            onClick={() => navigate('/apply', { state: { ...weights, planId } })}
          >
            Apply with these details <Icon name="arrow" />
          </Button>
          <p className="calculator__footnote">
            Figures are calculated by our server. The final loan follows physical verification of
            your gold.
          </p>
        </section>
      </div>
    </div>
  );
}
