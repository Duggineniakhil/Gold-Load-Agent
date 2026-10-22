import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { leadStatusTransitions, statusUpdateRequestSchema, type LeadStatus } from '@tglobal/shared';
import { api, ApiError, type LeadAudit, type LeadSummary } from '../lib/api';
import { displayMobile, formatDate, formatDateTime, statusLabel } from '../lib/format';
import { Button, Field, Icon, Money, Skeleton, StatusBadge } from '../ui';

const actionLabels: Record<LeadStatus, string> = {
  SUBMITTED: 'Return to submitted',
  UNDER_REVIEW: 'Start review',
  APPROVED: 'Approve',
  REJECTED: 'Reject',
};
const actorStorageKey = 'tglobal.actor';

type Props = {
  lead: LeadSummary;
  onClose: () => void;
  onStatusChange: (applicationId: string, status: LeadStatus) => void;
};

export function LeadDrawer({ lead, onClose, onStatusChange }: Props) {
  const reduceMotion = useReducedMotion();
  const closeButton = useRef<HTMLButtonElement>(null);
  const [audit, setAudit] = useState<LeadAudit | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [actor, setActor] = useState(() => localStorage.getItem(actorStorageKey) ?? '');
  const [actorError, setActorError] = useState('');
  const [pending, setPending] = useState<LeadStatus | null>(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      trigger?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setLoadError('');
    api
      .audit(lead.applicationId)
      .then((data) => {
        if (!active) return;
        setAudit(data);
        if (data.status !== lead.status) onStatusChange(lead.applicationId, data.status);
      })
      .catch(
        (reason: unknown) =>
          active &&
          setLoadError(reason instanceof Error ? reason.message : 'History could not be loaded.'),
      );
    return () => {
      active = false;
    };
    // Only the application and explicit reloads trigger a fetch; the row's status follows the response.
  }, [lead.applicationId, reloadKey]);

  const status = audit?.status ?? lead.status;
  const nextStatuses = leadStatusTransitions[status];

  async function changeStatus(to: LeadStatus) {
    const parsed = statusUpdateRequestSchema.safeParse({ status: to, actor });
    const actorIssue = parsed.success
      ? undefined
      : parsed.error.issues.find((issue) => issue.path[0] === 'actor');
    if (actorIssue) {
      setActorError(actorIssue.message);
      document.getElementById('status-actor')?.focus();
      return;
    }
    setActorError('');
    setActionError('');
    setNotice('');
    setPending(to);
    try {
      const change = await api.updateStatus(lead.applicationId, {
        status: to,
        actor: actor.trim(),
      });
      localStorage.setItem(actorStorageKey, actor.trim());
      setAudit(
        (current) =>
          current && {
            ...current,
            status: change.status,
            entries: [...current.entries, change.entry],
          },
      );
      onStatusChange(lead.applicationId, change.status);
      setNotice(`Moved to ${statusLabel(change.status)}.`);
    } catch (reason) {
      const error = reason instanceof ApiError ? reason : null;
      setActionError(error?.message ?? 'The status could not be changed.');
      // Someone else may have changed it first: show the current state.
      if (error?.code === 'INVALID_TRANSITION') setReloadKey((key) => key + 1);
    } finally {
      setPending(null);
    }
  }

  return (
    <motion.div
      className="sheet-backdrop"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.18 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.aside
        className="assist-sheet lead-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-drawer-heading"
        initial={reduceMotion ? false : { x: 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { x: 16, opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.22 }}
      >
        <div className="assist-sheet__head">
          <div>
            <span className="pill">Application</span>
            <h2 id="lead-drawer-heading">{lead.applicationId}</h2>
            <p>
              {lead.name} · {displayMobile(lead.mobileNumber)}
            </p>
          </div>
          <button
            ref={closeButton}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close application details"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="lead-drawer__body">
          <dl className="lead-drawer__facts">
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={status} />
              </dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{lead.planName}</dd>
            </div>
            <div>
              <dt>Net weight</dt>
              <dd>
                {lead.netWeightGrams} g · {lead.karat}K
              </dd>
            </div>
            <div>
              <dt>Loan amount</dt>
              <dd>
                <Money paise={lead.eligibleLoanPaise} />
              </dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{formatDate(lead.createdAt)}</dd>
            </div>
          </dl>

          <section className="lead-drawer__section" aria-labelledby="status-change-heading">
            <h3 id="status-change-heading">Change status</h3>
            {nextStatuses.length === 0 ? (
              <p className="lead-drawer__muted">
                {statusLabel(status)} is a final status. No further changes are possible.
              </p>
            ) : (
              <div>
                <Field
                  id="status-actor"
                  name="actor"
                  label="Your name"
                  hint="Recorded in the audit log with the change."
                  autoComplete="name"
                  value={actor}
                  onChange={(event) => setActor(event.target.value)}
                  error={actorError}
                />
                <div className="lead-drawer__actions">
                  {nextStatuses.map((to) => (
                    <Button
                      key={to}
                      tone={to === 'REJECTED' ? 'outline' : 'dark'}
                      disabled={pending !== null}
                      onClick={() => changeStatus(to)}
                    >
                      {pending === to ? 'Saving…' : actionLabels[to]}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {actionError && (
              <p className="alert alert--error" role="alert">
                {actionError}
              </p>
            )}
            <p className="lead-drawer__notice" role="status">
              {notice}
            </p>
          </section>

          <section className="lead-drawer__section" aria-labelledby="history-heading">
            <h3 id="history-heading">History</h3>
            {loadError ? (
              <div className="alert alert--error" role="alert">
                <p>{loadError}</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  Try again
                </button>
              </div>
            ) : !audit ? (
              <Skeleton lines={3} label="Loading history" />
            ) : (
              <ol className="timeline">
                <li>
                  <span className="timeline__dot" aria-hidden="true" />
                  <p>
                    <strong>Submitted</strong>
                  </p>
                  <time dateTime={audit.submittedAt}>{formatDateTime(audit.submittedAt)}</time>
                </li>
                {audit.entries.map((entry) => (
                  <li key={`${entry.at}-${entry.to}`}>
                    <span
                      className={`timeline__dot timeline__dot--${entry.to.toLowerCase().replace('_', '-')}`}
                      aria-hidden="true"
                    />
                    <p>
                      <strong>{statusLabel(entry.to)}</strong>{' '}
                      <span className="lead-drawer__muted">from {statusLabel(entry.from)}</span>
                    </p>
                    <span className="timeline__meta">
                      by {entry.actor} · <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </motion.aside>
    </motion.div>
  );
}
