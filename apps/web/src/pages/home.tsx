import type { ReactNode } from 'react';
import type { QuoteRequest } from '@tglobal/shared';
import type { Plan, Quote } from '../lib/api';
import { formatRupees } from '../lib/format';
import { useLiveQuote, usePlans } from '../lib/hooks';
import { useOpenAssist } from '../shell';
import { Button, ButtonLink, Icon, Pill, SectionIntro, Skeleton, type IconName } from '../ui';

// A labelled worked example: every figure shown for it comes from POST /quotes.
const example: QuoteRequest = { netWeightGrams: '45', grossWeightGrams: '50', karat: 22 };
const exampleLabel = '45 g net · 22K';

const bestPlan = (quote: Quote) =>
  quote.quotes.reduce(
    (best, item) => (item.eligibleLoanPaise > best.eligibleLoanPaise ? item : best),
    quote.quotes[0]!,
  );

export function HomePage() {
  const { plans } = usePlans();
  const { quote, error } = useLiveQuote(example, 0);

  return (
    <div className="home">
      <Hero quote={quote} plans={plans} quoteError={error?.message} />
      <FactStrip quote={quote} plans={plans} />
      <Features quote={quote} />
      <PlansSection plans={plans} quote={quote} />
      <HowItWorks />
      <Faq />
      <CtaBand />
    </div>
  );
}

function Hero({
  quote,
  plans,
  quoteError,
}: {
  quote: Quote | null;
  plans: Plan[];
  quoteError: string | undefined;
}) {
  const openAssist = useOpenAssist();
  return (
    <section className="hero" aria-labelledby="hero-heading">
      <Pill icon="star">Gold loans, appraised in minutes</Pill>
      <h1 id="hero-heading">
        Your gold, valued exactly.
        <br />
        Your offer, in minutes.
      </h1>
      <p className="hero__lede">
        Enter the weight and purity of your gold to see a preliminary loan offer for every plan,
        then apply in three steps or let Loan Assist guide you.
      </p>
      <div className="hero__actions">
        <ButtonLink to="/apply" size="lg">
          Start free appraisal
        </ButtonLink>
        <Button tone="outline" size="lg" onClick={openAssist}>
          Ask Loan Assist
        </Button>
      </div>
      <HeroVisual quote={quote} plans={plans} error={quoteError} />
    </section>
  );
}

function LtvGauge({ percent }: { percent: number }) {
  const angle = Math.PI * (1 - percent / 100);
  const x = 50 + 38 * Math.cos(angle);
  const y = 50 - 38 * Math.sin(angle);
  return (
    <svg className="gauge" viewBox="0 0 100 58" aria-hidden="true">
      <path d="M12 50a38 38 0 0176 0" className="gauge__track" />
      <path d={`M12 50 A38 38 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} className="gauge__fill" />
      <line x1="50" y1="50" x2={x.toFixed(2)} y2={y.toFixed(2)} className="gauge__needle" />
      <circle cx="50" cy="50" r="3.5" className="gauge__hub" />
    </svg>
  );
}

function HeroVisual({
  quote,
  plans,
  error,
}: {
  quote: Quote | null;
  plans: Plan[];
  error: string | undefined;
}) {
  const best = quote ? bestPlan(quote) : null;
  const bestTerms = best ? plans.find((plan) => plan.id === best.planId) : undefined;
  return (
    <div className="hero-visual">
      <div className="hero-visual__panel hero-visual__panel--left" aria-hidden="true" />
      <div className="hero-visual__panel hero-visual__panel--right" aria-hidden="true" />
      <figure className="phone" aria-label={`Worked example for ${exampleLabel}`}>
        <div className="phone__screen">
          <div className="phone__header">
            <span className="phone__brand">TGlobal</span>
            <span className="phone__title">Live quote</span>
            <span className="phone__example">Worked example · {exampleLabel}</span>
          </div>
          {quote ? (
            <>
              <table className="phone__table">
                <thead>
                  <tr>
                    <th scope="col">Plan</th>
                    <th scope="col">LTV</th>
                    <th scope="col">Loan</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.quotes.map((item) => (
                    <tr key={item.planId}>
                      <td>{item.name}</td>
                      <td>{item.ltvAppliedPercent}%</td>
                      <td>{formatRupees(item.eligibleLoanPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="phone__card">
                <span className="phone__label">Estimated gold value</span>
                <strong className="phone__value">{formatRupees(quote.goldValuePaise)}</strong>
                <span className="phone__sub">Pure gold {quote.pureGoldGrams} g · 22K</span>
                {best && (
                  <div className="phone__meter">
                    <div>
                      <span className="phone__label">Best offer</span>
                      <strong>{formatRupees(best.eligibleLoanPaise)}</strong>
                      <span className="phone__sub">{best.name}</span>
                    </div>
                    <div className="phone__gauge">
                      <LtvGauge percent={best.ltvAppliedPercent} />
                      <span>{best.ltvAppliedPercent}% LTV</span>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : error ? (
            <p className="phone__error" role="alert">
              {error}
            </p>
          ) : (
            <div className="phone__loading">
              <Skeleton lines={4} label="Loading worked example" />
            </div>
          )}
        </div>
      </figure>
      {quote && (
        <>
          <div className="float-card float-card--slip" aria-hidden="true">
            <span className="float-card__icon">
              <Icon name="scale" />
            </span>
            <strong>Appraisal slip</strong>
            <dl>
              <div>
                <dt>Net weight</dt>
                <dd>45.000 g</dd>
              </div>
              <div>
                <dt>Purity</dt>
                <dd>22/24</dd>
              </div>
              <div>
                <dt>Pure gold</dt>
                <dd>{quote.pureGoldGrams} g</dd>
              </div>
              <div>
                <dt>24K rate</dt>
                <dd>{formatRupees(quote.goldRatePerGram * 100)}/g</dd>
              </div>
            </dl>
          </div>
          {best && bestTerms && (
            <div className="float-card float-card--plan" aria-hidden="true">
              <span className="float-card__tag">Plan summary</span>
              <dl>
                <div>
                  <dt>Plan</dt>
                  <dd>{bestTerms.name}</dd>
                </div>
                <div>
                  <dt>Interest</dt>
                  <dd>{bestTerms.annualInterestRate}% p.a.</dd>
                </div>
                <div>
                  <dt>Tenure</dt>
                  <dd>{bestTerms.tenureMonths} months</dd>
                </div>
                <div>
                  <dt>Loan</dt>
                  <dd>{formatRupees(best.eligibleLoanPaise)}</dd>
                </div>
              </dl>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FactStrip({ quote, plans }: { quote: Quote | null; plans: Plan[] }) {
  const maxLtv = plans.length ? Math.max(...plans.map((plan) => plan.maxLtv)) : null;
  const facts: { icon: IconName; text: string }[] = [
    ...(quote
      ? [
          {
            icon: 'scale' as const,
            text: `${formatRupees(quote.goldRatePerGram * 100)}/g 24K reference rate`,
          },
        ]
      : []),
    ...(maxLtv ? [{ icon: 'layers' as const, text: `Up to ${maxLtv}% of gold value` }] : []),
    { icon: 'star', text: '18K, 22K and 24K accepted' },
    { icon: 'clock', text: 'One application per mobile in 7 days' },
    { icon: 'lock', text: 'Mobile numbers always masked' },
  ];
  return (
    <section className="facts" aria-label="How offers are made">
      <p>Clear rules behind every offer</p>
      <ul>
        {facts.map((fact) => (
          <li key={fact.text}>
            <Icon name={fact.icon} />
            {fact.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FeatureCard({
  title,
  children,
  art,
  wide = false,
}: {
  title: string;
  children: string;
  art: ReactNode;
  wide?: boolean;
}) {
  return (
    <article className={`feature ${wide ? 'feature--wide' : ''}`}>
      <div className="feature__art" aria-hidden="true">
        {art}
      </div>
      <div className="feature__body">
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </article>
  );
}

function Features({ quote }: { quote: Quote | null }) {
  const emi = quote ? bestPlan(quote) : undefined;
  return (
    <section className="section" aria-labelledby="features-heading">
      <SectionIntro
        pill="Features"
        icon="sparkle"
        title="Gold loans made simple."
        id="features-heading"
      >
        From the first weighing to a filed application, every number is worked out by the server.
      </SectionIntro>
      <div className="feature-grid">
        <FeatureCard
          title="Exact appraisal"
          art={
            <div className="art-slips">
              <div className="art-slip art-slip--back" />
              <div className="art-slip art-slip--mid" />
              <div className="art-slip">
                <span className="art-slip__tag">Appraisal</span>
                {quote && emi ? (
                  <>
                    <span>45.000 g × 22/24 = {quote.pureGoldGrams} g</span>
                    <span>
                      {quote.pureGoldGrams} g × {formatRupees(quote.goldRatePerGram * 100)} ={' '}
                      {formatRupees(quote.goldValuePaise)}
                    </span>
                    <strong>
                      Loan at {emi.ltvAppliedPercent}%: {formatRupees(emi.eligibleLoanPaise)}
                    </strong>
                  </>
                ) : (
                  <Skeleton lines={3} label="Loading example" />
                )}
              </div>
            </div>
          }
        >
          Pure gold and value are worked out to the milligram from net weight and karat, and loans
          are rounded down to whole rupees.
        </FeatureCard>
        <FeatureCard
          title="Live quote for every plan"
          art={
            <div className="art-plans">
              {quote ? (
                quote.quotes.map((item, index) => (
                  <div
                    key={item.planId}
                    className={`art-plan ${index === quote.quotes.length - 1 ? 'is-selected' : ''}`}
                  >
                    <span>{item.name}</span>
                    <strong>{formatRupees(item.eligibleLoanPaise)}</strong>
                    <small>{item.ltvAppliedPercent}% of value</small>
                  </div>
                ))
              ) : (
                <Skeleton lines={2} label="Loading plans" />
              )}
            </div>
          }
        >
          The offer updates as you type the weights, with the eligible loan for each plan side by
          side.
        </FeatureCard>
        <FeatureCard
          title="Loan Assist, with real tools"
          art={
            <div className="art-chat">
              <span className="art-bubble art-bubble--user">I have 45 g of 22 carat gold</span>
              <span className="art-chips">
                <span>Checked plans</span>
                <span>Calculated quote</span>
              </span>
              <span className="art-bubble">What is the gross weight, including stones?</span>
            </div>
          }
        >
          A chat assistant that asks for missing details and quotes through the same calculator,
          never by guessing.
        </FeatureCard>
        <FeatureCard
          wide
          title="Nothing is filed until you confirm"
          art={
            <div className="art-confirm">
              <span className="art-confirm__tag">Confirm application</span>
              <div>
                <span>Net weight</span>
                <span>45 g</span>
              </div>
              <div>
                <span>Purity</span>
                <span>22K</span>
              </div>
              <div>
                <span>Eligible loan</span>
                <strong>{emi ? formatRupees(emi.eligibleLoanPaise) : '—'}</strong>
              </div>
              <span className="art-confirm__actions">
                <span>Cancel</span>
                <span className="is-primary">Confirm &amp; submit</span>
              </span>
            </div>
          }
        >
          Review every detail before submitting. The server recalculates the offer itself and blocks
          repeat applications from the same mobile within 7 days.
        </FeatureCard>
        <FeatureCard
          wide
          title="A register for the whole team"
          art={
            <div className="art-register">
              <div className="art-register__head">
                <span>Application</span>
                <span>Mobile</span>
                <span>Status</span>
              </div>
              {[0, 1, 2].map((row) => (
                <div key={row} className="art-register__row">
                  <span className="art-bar" />
                  <span className="art-mask">XXXX</span>
                  <span className="art-status">Submitted</span>
                </div>
              ))}
            </div>
          }
        >
          Every application in one list, newest first, filterable by plan, with mobile numbers
          masked.
        </FeatureCard>
      </div>
    </section>
  );
}

function PlansSection({ plans, quote }: { plans: Plan[]; quote: Quote | null }) {
  return (
    <section className="section" id="plans" aria-labelledby="plans-heading">
      <SectionIntro pill="Plans" icon="layers" title="Two ways to repay." id="plans-heading">
        Both plans run for a fixed term. Pick the one that suits your cash flow.
      </SectionIntro>
      <div className="plan-showcase">
        {plans.length === 0 ? (
          <Skeleton lines={3} label="Loading plans" />
        ) : (
          plans.map((plan) => {
            const offer = quote?.quotes.find((item) => item.planId === plan.id);
            return (
              <article className="plan-panel" key={plan.id}>
                <span className="plan-panel__kind">
                  {plan.repaymentType === 'EMI'
                    ? 'Equal monthly instalments'
                    : 'Interest and principal at maturity'}
                </span>
                <h3>{plan.name}</h3>
                <dl>
                  <div>
                    <dt>Interest</dt>
                    <dd>{plan.annualInterestRate}% p.a.</dd>
                  </div>
                  <div>
                    <dt>Tenure</dt>
                    <dd>{plan.tenureMonths} months</dd>
                  </div>
                  <div>
                    <dt>Maximum LTV</dt>
                    <dd>{plan.maxLtv}%</dd>
                  </div>
                </dl>
                {offer && (
                  <p className="plan-panel__offer">
                    On {exampleLabel}: <strong>{formatRupees(offer.eligibleLoanPaise)}</strong>
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: 'Details',
      text: 'Enter the borrower’s name and mobile, the gross and net weight, and the karat. Mistakes are flagged as you type.',
    },
    {
      title: 'Live quote',
      text: 'See pure gold, gold value and the eligible loan for each plan, then choose a plan.',
    },
    {
      title: 'Confirm',
      text: 'Review everything and submit. You get an application ID straight away.',
    },
  ];
  return (
    <section className="section" id="how-it-works" aria-labelledby="how-heading">
      <SectionIntro
        pill="How it works"
        icon="check"
        title="Three steps to an offer."
        id="how-heading"
      />
      <ol className="steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="steps__number">0{index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Faq() {
  const items = [
    {
      q: 'How is my offer calculated?',
      a: 'Pure gold is the net weight × karat ÷ 24. Gold value is pure gold × today’s 24K reference rate. The loan is the gold value × the plan’s loan-to-value ratio, never above 75%, rounded down to the whole rupee.',
    },
    {
      q: 'Why do you need both gross and net weight?',
      a: 'Gross weight includes stones and fittings. The offer uses the net gold weight only, which can never be more than the gross weight.',
    },
    { q: 'Which gold is accepted?', a: 'Jewellery and coins of 18, 22 or 24 karat.' },
    {
      q: 'Can I apply more than once?',
      a: 'One application per mobile number is accepted within 7 days. If you try again, you are shown the date and ID of your existing application.',
    },
    {
      q: 'Is the offer final?',
      a: 'No. It is a preliminary offer. The final amount follows physical verification of the gold at the branch.',
    },
    {
      q: 'What does Loan Assist do?',
      a: 'It answers questions about your gold loan, asks for any missing details and quotes using the same calculator as the form. It only files an application after you press Confirm, and it gives no investment advice.',
    },
  ];
  return (
    <section className="section" id="faq" aria-labelledby="faq-heading">
      <SectionIntro pill="FAQ" title="Questions, answered." id="faq-heading" />
      <div className="faq">
        {items.map((item) => (
          <details key={item.q}>
            <summary>
              {item.q}
              <span className="faq__mark" aria-hidden="true" />
            </summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function CtaBand() {
  const openAssist = useOpenAssist();
  return (
    <section className="cta" aria-labelledby="cta-heading">
      <h2 id="cta-heading">Ready to see what your gold is worth?</h2>
      <p>It takes about two minutes. Nothing is filed until you confirm.</p>
      <div className="hero__actions">
        <ButtonLink to="/apply" tone="gold" size="lg">
          Start free appraisal <Icon name="arrow" />
        </ButtonLink>
        <Button tone="outline" size="lg" className="button--on-dark" onClick={openAssist}>
          Ask Loan Assist
        </Button>
      </div>
    </section>
  );
}
