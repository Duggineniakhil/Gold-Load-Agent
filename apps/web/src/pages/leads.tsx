import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import type { LeadStatus } from '@tglobal/shared';
import { api, type LeadSummary } from '../lib/api';
import { usePlans } from '../lib/hooks';
import { Button, ButtonLink, Icon, PageHeader, Skeleton } from '../ui';
import { LeadDrawer } from './lead-drawer';
import { LeadsTable } from './leads-table';

type Status = 'loading' | 'ready' | 'error';

export function LeadsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const planId = searchParams.get('planId') ?? '';
  const { plans, loading: plansLoading } = usePlans();
  const [items, setItems] = useState<LeadSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  const reduceMotion = useReducedMotion();
  const introDone = useRef(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const openLead = items.find((lead) => lead.applicationId === openId) ?? null;
  const closeDrawer = useCallback(() => setOpenId(null), []);
  const updateRowStatus = useCallback((applicationId: string, status: LeadStatus) => {
    setItems((current) =>
      current.map((lead) => (lead.applicationId === applicationId ? { ...lead, status } : lead)),
    );
  }, []);

  const setPlanFilter = (value: string) => setSearchParams(value ? { planId: value } : {});

  // A plan id in the URL that no longer exists falls back to all plans.
  useEffect(() => {
    if (!plansLoading && planId && plans.length && !plans.some((plan) => plan.id === planId)) {
      setSearchParams({}, { replace: true });
    }
  }, [plansLoading, plans, planId, setSearchParams]);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setError('');
    setLoadMoreError('');
    api
      .leads({ planId })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Applications could not be loaded.');
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [planId, reloadKey]);

  // Only the first batch of rows animates in; filter changes and "Load more" do not.
  useEffect(() => {
    if (status === 'ready' && items.length > 0) introDone.current = true;
  }, [status, items.length]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const page = await api.leads({ planId, cursor: nextCursor });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setLoadMoreError(
        reason instanceof Error ? reason.message : 'More applications could not be loaded.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  const planName = plans.find((plan) => plan.id === planId)?.name;
  const caption = `Gold loan applications${planName ? ` on the ${planName} plan` : ''}, newest first`;

  return (
    <div className="page leads">
      <PageHeader
        pill="Lead register"
        title="Applications"
        action={
          <ButtonLink to="/apply">
            New application <Icon name="arrow" />
          </ButtonLink>
        }
      >
        Every application, newest first. Mobile numbers are masked.
      </PageHeader>

      <div className="card register">
        <div className="register__toolbar">
          <p aria-live="polite">
            {status === 'ready' ? (
              <>
                <strong>{items.length}</strong>{' '}
                {items.length === 1 ? 'application' : 'applications'}
                {nextCursor ? ' shown' : ''}
              </>
            ) : (
              <strong>—</strong>
            )}
          </p>
          <label className="register__filter">
            Plan
            <select
              value={planId}
              onChange={(event) => setPlanFilter(event.target.value)}
              disabled={plansLoading}
            >
              <option value="">All plans</option>
              {plans.map((plan) => (
                <option value={plan.id} key={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {status === 'loading' ? (
          <div className="register__state">
            <Skeleton lines={6} label="Loading applications" />
          </div>
        ) : status === 'error' ? (
          <div className="register__state register__empty" role="alert">
            <p>Applications could not be loaded.</p>
            <span>{error}</span>
            <Button tone="outline" onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="register__state register__empty">
            <p>{planName ? `No applications on ${planName} yet.` : 'No applications yet.'}</p>
            <span>Submitted applications appear here, newest first.</span>
            <div className="register__empty-actions">
              {planName && (
                <Button tone="outline" onClick={() => setPlanFilter('')}>
                  Show all plans
                </Button>
              )}
              <Link className="button button--dark button--md" to="/apply">
                Start an application <Icon name="arrow" />
              </Link>
            </div>
          </div>
        ) : (
          <>
            <LeadsTable
              items={items}
              caption={caption}
              animateRows={!introDone.current && !reduceMotion}
              onOpen={(lead) => setOpenId(lead.applicationId)}
            />
            {(nextCursor || loadMoreError) && (
              <div className="register__more">
                {loadMoreError && (
                  <p className="field__error" role="alert">
                    {loadMoreError}
                  </p>
                )}
                <Button tone="outline" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : loadMoreError ? 'Try again' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <AnimatePresence>
        {openLead && (
          <LeadDrawer lead={openLead} onClose={closeDrawer} onStatusChange={updateRowStatus} />
        )}
      </AnimatePresence>
    </div>
  );
}
