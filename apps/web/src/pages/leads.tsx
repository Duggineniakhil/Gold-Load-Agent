import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import type { LeadStatus } from '@tglobal/shared';
import { api, ApiError, type LeadSummary, type Plan } from '../lib/api';
import { Button, Icon, Skeleton } from '../ui';
import { LeadDrawer } from './lead-drawer';
import { LeadsTable } from './leads-table';

type Status = 'loading' | 'ready' | 'error';

type Props = {
  planId: string;
  plans: Plan[];
  plansLoading: boolean;
  onPlanChange: (planId: string) => void;
  /** Called after a status change in the drawer, so totals elsewhere can refresh. */
  onStatusChange: () => void;
  /** Called when the API asks for the admin passcode again. */
  onUnauthorized: () => void;
};

/** The admin lead register: plan filter, newest-first table, Load more, and the status drawer. */
export function LeadRegister({
  planId,
  plans,
  plansLoading,
  onPlanChange,
  onStatusChange,
  onUnauthorized,
}: Props) {
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
  const updateRowStatus = useCallback(
    (applicationId: string, status: LeadStatus) => {
      setItems((current) =>
        current.map((lead) => (lead.applicationId === applicationId ? { ...lead, status } : lead)),
      );
      onStatusChange();
    },
    [onStatusChange],
  );

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
        if (reason instanceof ApiError && reason.status === 401) {
          onUnauthorized();
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Applications could not be loaded.');
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [planId, reloadKey, onUnauthorized]);

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
    <>
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
          <div className="register__filter">
            <label htmlFor="register-plan">Plan</label>
            <select
              id="register-plan"
              value={planId}
              onChange={(event) => onPlanChange(event.target.value)}
              disabled={plansLoading}
            >
              <option value="">All plans</option>
              {plans.map((plan) => (
                <option value={plan.id} key={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </div>
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
                <Button tone="outline" onClick={() => onPlanChange('')}>
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
    </>
  );
}
