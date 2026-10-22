import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, useReducedMotion } from 'motion/react';
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
  const [filterInput, setFilterInput] = useState('');
  const [filter, setFilter] = useState('');
  const [filterSummary, setFilterSummary] = useState('');
  const reduceMotion = useReducedMotion();
  const introDone = useRef(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const openLead = items.find((lead) => lead.applicationId === openId) ?? null;
  const closeDrawer = useCallback(() => setOpenId(null), []);
  const updateRowStatus = useCallback(() => {
    setReloadKey((key) => key + 1);
    onStatusChange();
  }, [onStatusChange]);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setError('');
    setLoadMoreError('');
    api
      .leads({ planId, filter })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setFilterSummary(page.filterSummary);
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
  }, [planId, filter, reloadKey, onUnauthorized]);

  // Only the first batch of rows animates in; filter changes and "Load more" do not.
  useEffect(() => {
    if (status === 'ready' && items.length > 0) introDone.current = true;
  }, [status, items.length]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const page = await api.leads({ planId, cursor: nextCursor, filter });
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

  function applyFilter(event: FormEvent) {
    event.preventDefault();
    setFilter(filterInput.trim());
  }

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
        <form className="register__query" onSubmit={applyFilter}>
          <label htmlFor="register-query">Describe the applications you want to find</label>
          <div>
            <input
              id="register-query"
              value={filterInput}
              maxLength={200}
              placeholder="e.g. pending applications over ₹1 lakh on EMI"
              onChange={(event) => setFilterInput(event.target.value)}
            />
            <Button type="submit">Search</Button>
            {filter && (
              <Button
                type="button"
                tone="outline"
                onClick={() => {
                  setFilterInput('');
                  setFilter('');
                }}
              >
                Clear
              </Button>
            )}
          </div>
          {filterSummary && <p aria-live="polite">{filterSummary}</p>}
        </form>

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
            <p>
              {filter
                ? 'No applications match this filter.'
                : planName
                  ? `No applications on ${planName} yet.`
                  : 'No applications yet.'}
            </p>
            <span>
              {filter
                ? 'Try a different phrase or clear the filter.'
                : 'Submitted applications appear here, newest first.'}
            </span>
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
