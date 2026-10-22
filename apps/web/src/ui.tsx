import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'ink' | 'quiet' };

export function Button({ tone = 'ink', className = '', ...props }: ButtonProps) {
  return <button className={`button button--${tone} ${className}`} {...props} />;
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  suffix?: string | undefined;
};

export function Field({ label, hint, error, suffix, id, className = '', ...props }: FieldProps) {
  const inputId = id ?? props.name;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>{label}</label>
      <span className={`field__control ${suffix ? 'field__control--suffix' : ''}`}>
        <input
          id={inputId}
          className={`field__input ${error ? 'field__input--error' : ''} ${className}`}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...props}
        />
        {suffix && <span className="field__suffix" aria-hidden="true">{suffix}</span>}
      </span>
      {hint && <p className="field__hint" id={hintId}>{hint}</p>}
      {error && <p className="field__error" id={errorId}>{error}</p>}
    </div>
  );
}

export function KaratSegmented({ value, onChange }: { value: number; onChange: (karat: number) => void }) {
  return (
    <fieldset className="karat" aria-label="Gold purity">
      {[18, 22, 24].map((karat) => (
        <label className={`karat__option ${value === karat ? 'is-selected' : ''}`} key={karat}>
          <input type="radio" name="karat" value={karat} checked={value === karat} onChange={() => onChange(karat)} />
          <span>{karat}K</span>
        </label>
      ))}
    </fieldset>
  );
}

export type Plan = {
  id: string;
  name: string;
  annualInterestRate: number;
  tenureMonths: number;
  maxLtv: number;
  repaymentType: 'BULLET' | 'EMI';
};

export function PlanCard({ plan, selected, onSelect }: { plan: Plan; selected: boolean; onSelect: () => void }) {
  const reduceMotion = useReducedMotion();
  return (
    <label className={`plan-card ${selected ? 'is-selected' : ''}`}>
      <input className="sr-only" type="radio" name="planId" value={plan.id} checked={selected} onChange={onSelect} />
      {selected && <motion.span className="plan-card__highlight" layoutId="plan-highlight" transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: 'easeOut' }} />}
      <span className="plan-card__content">
        <span className="plan-card__topline"><span>{plan.repaymentType === 'EMI' ? 'Monthly repayment' : 'Single repayment'}</span><span className="plan-card__radio" aria-hidden="true" /></span>
        <span className="plan-card__name">{plan.name}</span>
        <span className="plan-card__terms">{plan.annualInterestRate}% p.a. <i>·</i> up to {plan.maxLtv}% of value</span>
        <span className="plan-card__term">{plan.tenureMonths} month term</span>
      </span>
    </label>
  );
}

export function Stepper({ active = 0 }: { active?: number }) {
  const steps = ['Applicant', 'Gold', 'Offer'];
  return (
    <ol className="stepper" aria-label="Application progress">
      {steps.map((step, index) => <li className={`stepper__step ${index === active ? 'is-active' : ''} ${index < active ? 'is-complete' : ''}`} key={step} aria-current={index === active ? 'step' : undefined}>
        <span className="stepper__number">{index < active ? '✓' : `0${index + 1}`}</span><span>{step}</span>
      </li>)}
    </ol>
  );
}

function formatRupees(paise: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
}

export function Money({ paise, className = '' }: { paise: number; className?: string }) {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(reduceMotion ? paise : 0);
  useEffect(() => {
    if (reduceMotion) { setVisible(paise); return; }
    let frame = 0;
    const started = performance.now();
    const from = visible;
    const duration = 240;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      setVisible(Math.round(from + (paise - from) * progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  // The target value is the only animation trigger.
  }, [paise, reduceMotion]);
  return <span className={`money ${className}`} aria-label={formatRupees(paise)}>{formatRupees(visible)}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-badge--${status.toLowerCase().replaceAll('_', '-')}`}>{status.replaceAll('_', ' ')}</span>;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="skeleton" role="status" aria-label="Loading records" aria-busy="true">{Array.from({ length: lines }, (_, index) => <span key={index} />)}</div>;
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  return <motion.div className="toast" role="status" aria-live="polite" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} {...(reduceMotion ? {} : { exit: { opacity: 0, y: 5 } })} transition={{ duration: 0.18 }}>
    <span className="toast__mark" aria-hidden="true">✓</span><span>{message}</span><button className="toast__close" aria-label="Dismiss message" onClick={onClose}>×</button>
  </motion.div>;
}

export function PageTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <header className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children && <p className="page-title__intro">{children}</p>}</header>;
}
