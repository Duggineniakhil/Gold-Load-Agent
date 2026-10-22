import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, adminSession, type LeadStats } from '../lib/api';
import { usePlans } from '../lib/hooks';
import { Button, ButtonLink, Field, Icon, Money, PageHeader, Skeleton, type IconName } from '../ui';
import { LeadRegister } from './leads';

type Access = 'checking' | 'locked' | 'open';

export function AdminPage() {
  const [access, setAccess] = useState<Access>('checking');
  const [usesPasscode, setUsesPasscode] = useState(() => Boolean(adminSession.get()));

  // Ask the API whether this tab may read admin data; a 401 means a passcode is needed.
  useEffect(() => {
    let active = true;
    api
      .leadStats('')
      .then(() => active && setAccess('open'))
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) {
          adminSession.clear();
          setUsesPasscode(true);
          setAccess('locked');
        } else {
          setAccess('open');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const lock = useCallback(() => {
    adminSession.clear();
    setAccess('locked');
  }, []);

  if (access === 'checking') {
    return (
      <div className="page admin">
        <Skeleton lines={4} label="Checking admin access" />
      </div>
    );
  }
  if (access === 'locked') return <AdminGate onUnlock={() => setAccess('open')} />;
  return <AdminDashboard onLock={usesPasscode ? lock : undefined} onUnauthorized={lock} />;
}

function AdminGate({ onUnlock }: { onUnlock: () => void }) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!passcode) {
      setError('Enter the admin passcode.');
      return;
    }
    setChecking(true);
    setError('');
    adminSession.set(passcode);
    try {
      await api.leadStats('');
      onUnlock();
    } catch (reason) {
      adminSession.clear();
      setError(
        reason instanceof ApiError && reason.status === 401
          ? 'That passcode is not correct.'
          : reason instanceof Error
            ? reason.message
            : 'The passcode could not be checked.',
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="page admin-gate">
      <form className="card admin-gate__card" onSubmit={submit} noValidate>
        <span className="admin-gate__icon">
          <Icon name="lock" />
        </span>
        <h1>Admin access</h1>
        <p>Enter the team passcode to view and manage applications.</p>
        <Field
          id="admin-passcode"
          name="passcode"
          type="password"
          label="Passcode"
          autoComplete="current-password"
          autoFocus
          value={passcode}
          onChange={(event) => {
            setPasscode(event.target.value);
            setError('');
          }}
          error={error}
        />
        <Button type="submit" size="lg" disabled={checking}>
          {checking ? 'Checking…' : 'Unlock'}
        </Button>
      </form>
    </div>
  );
}

function AdminDashboard({
  onLock,
  onUnauthorized,
}: {
  onLock: (() => void) | undefined;
  onUnauthorized: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const planId = searchParams.get('planId') ?? '';
  const { plans, loading: plansLoading } = usePlans();
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [statsKey, setStatsKey] = useState(0);

  const setPlanFilter = useCallback(
    (value: string) => setSearchParams(value ? { planId: value } : {}),
    [setSearchParams],
  );
  const refreshStats = useCallback(() => setStatsKey((key) => key + 1), []);

  // A plan id in the URL that no longer exists falls back to all plans.
  useEffect(() => {
    if (!plansLoading && planId && plans.length && !plans.some((plan) => plan.id === planId)) {
      setSearchParams({}, { replace: true });
    }
  }, [plansLoading, plans, planId, setSearchParams]);

  useEffect(() => {
    let active = true;
    api
      .leadStats(planId)
      .then((data) => active && setStats(data))
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
        else setStats(null);
      });
    return () => {
      active = false;
    };
  }, [planId, statsKey, onUnauthorized]);

  const tiles: { icon: IconName; label: string; value: ReactNode }[] = [
    { icon: 'table', label: 'Applications', value: stats?.total ?? '—' },
    { icon: 'clock', label: 'Awaiting review', value: stats?.byStatus.SUBMITTED ?? '—' },
    { icon: 'layers', label: 'Under review', value: stats?.byStatus.UNDER_REVIEW ?? '—' },
    { icon: 'check', label: 'Approved', value: stats?.byStatus.APPROVED ?? '—' },
    {
      icon: 'scale',
      label: 'Eligible loans',
      value: stats ? <Money paise={stats.totalEligibleLoanPaise} /> : '—',
    },
  ];

  return (
    <div className="page admin">
      <PageHeader
        pill="Admin"
        title="Applications"
        action={
          <div className="admin__actions">
            {onLock && (
              <Button tone="outline" onClick={onLock}>
                <Icon name="lock" /> Lock
              </Button>
            )}
            <ButtonLink to="/apply">
              New application <Icon name="arrow" />
            </ButtonLink>
          </div>
        }
      >
        Review applications and move them through the workflow. Mobile numbers are masked.
      </PageHeader>

      <ul
        className="admin__stats"
        aria-label={planId ? 'Totals for the selected plan' : 'Totals for all plans'}
      >
        {tiles.map((tile) => (
          <li key={tile.label} className="card admin__stat">
            <span className="admin__stat-icon">
              <Icon name={tile.icon} />
            </span>
            <span className="admin__stat-label">{tile.label}</span>
            <strong>{tile.value}</strong>
          </li>
        ))}
      </ul>

      <LeadRegister
        planId={planId}
        plans={plans}
        plansLoading={plansLoading}
        onPlanChange={setPlanFilter}
        onStatusChange={refreshStats}
        onUnauthorized={onUnauthorized}
      />
    </div>
  );
}
