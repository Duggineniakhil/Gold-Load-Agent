import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { formatRupees } from './lib/format';

type Tone = 'dark' | 'outline' | 'gold';
type Size = 'md' | 'lg';
const buttonClass = (tone: Tone, size: Size, className: string) =>
  `button button--${tone} button--${size} ${className}`.trim();

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: Size };

export function Button({
  tone = 'dark',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return <button type={type} className={buttonClass(tone, size, className)} {...props} />;
}

export function ButtonLink({
  tone = 'dark',
  size = 'md',
  className = '',
  ...props
}: LinkProps & { tone?: Tone; size?: Size }) {
  return <Link className={buttonClass(tone, size, className)} {...props} />;
}

const iconPaths = {
  star: 'M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9z',
  sparkle:
    'M12 3c.6 4.2 2.4 6.3 6.5 7-4.1.7-5.9 2.8-6.5 7-.6-4.2-2.4-6.3-6.5-7 4.1-.7 5.9-2.8 6.5-7z',
  scale: 'M12 4v16M5 20h14M6 8h12M6 8l-3 6a3 3 0 006 0zM18 8l-3 6a3 3 0 006 0z',
  shield: 'M12 3l7 3v5.5c0 4.4-3 7.9-7 9.5-4-1.6-7-5.1-7-9.5V6z M9 12l2 2 4-4',
  chat: 'M5 5h14a1 1 0 011 1v9a1 1 0 01-1 1h-8l-4 3v-3H5a1 1 0 01-1-1V6a1 1 0 011-1z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  lock: 'M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  table: 'M4 5h16v14H4zM4 10h16M10 10v9',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
} as const;

export type IconName = keyof typeof iconPaths;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const filled = name === 'star' || name === 'sparkle';
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={iconPaths[name]}
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Pill({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <span className="pill">
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

export function SectionIntro({
  pill,
  icon,
  title,
  children,
  id,
}: {
  pill: string;
  icon?: IconName;
  title: string;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <header className="section-intro">
      <Pill {...(icon ? { icon } : {})}>{pill}</Pill>
      <h2 id={id}>{title}</h2>
      {children && <p>{children}</p>}
    </header>
  );
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
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <span className={`field__control ${suffix ? 'field__control--suffix' : ''}`}>
        <input
          id={inputId}
          className={`field__input ${error ? 'field__input--error' : ''} ${className}`}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...props}
        />
        {suffix && (
          <span className="field__suffix" aria-hidden="true">
            {suffix}
          </span>
        )}
      </span>
      {error ? (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="field__hint" id={hintId}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

type SegmentedProps<T extends string | number> = {
  legend: string;
  name: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  error?: string | undefined;
};

/** A row of radio buttons styled as one control (karat, plan). */
export function SegmentedControl<T extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
  error,
}: SegmentedProps<T>) {
  const errorId = `${name}-error`;
  return (
    <fieldset className="segmented" aria-describedby={error ? errorId : undefined}>
      <legend className="field__label">{legend}</legend>
      <div className="segmented__options">
        {options.map((option) => (
          <label
            className={`segmented__option ${value === option.value ? 'is-selected' : ''}`}
            key={option.value}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {error && (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

const karatOptions = [18, 22, 24].map((karat) => ({ value: karat, label: `${karat}K` }));

export function KaratSegmented({
  value,
  onChange,
  error,
}: {
  value: number;
  onChange: (karat: number) => void;
  error?: string | undefined;
}) {
  return (
    <SegmentedControl
      legend="Karat"
      name="karat"
      options={karatOptions}
      value={value}
      onChange={onChange}
      error={error}
    />
  );
}

export function Money({ paise, className = '' }: { paise: number; className?: string }) {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(paise);
  useEffect(() => {
    if (reduceMotion) {
      setVisible(paise);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const from = visible;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 240);
      setVisible(progress === 1 ? paise : Math.round(from + (paise - from) * progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // The target value is the only animation trigger.
  }, [paise, reduceMotion]);
  return (
    <span className={`money ${className}`} aria-label={formatRupees(paise)}>
      <span aria-hidden="true">{formatRupees(visible)}</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-badge--${status.toLowerCase().replaceAll('_', '-')}`}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}

export function Skeleton({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function PageHeader({
  pill,
  title,
  children,
  action,
}: {
  pill: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <Pill>{pill}</Pill>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {action}
    </header>
  );
}
