import { useEffect, useState } from 'react';
import { api, type LeadSummary } from '../lib/api';
import { formatDate } from '../lib/format';
import { usePlans } from '../lib/hooks';
import { ButtonLink, Icon, Money, PageHeader, Skeleton, StatusBadge } from '../ui';

export function LeadsPage() {
  const [items, setItems] = useState<LeadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [planId, setPlanId] = useState('');
  const { plans } = usePlans();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .leads(planId)
      .then((data) => active && setItems(data.items))
      .catch(
        (reason: unknown) =>
          active &&
          setError(reason instanceof Error ? reason.message : 'Applications could not be loaded.'),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [planId]);

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
          <p>
            <strong>{loading ? '—' : items.length}</strong>{' '}
            {items.length === 1 ? 'application' : 'applications'}
          </p>
          <label className="register__filter">
            Plan
            <select value={planId} onChange={(event) => setPlanId(event.target.value)}>
              <option value="">All plans</option>
              {plans.map((plan) => (
                <option value={plan.id} key={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <div className="register__state">
            <Skeleton lines={5} label="Loading applications" />
          </div>
        ) : error ? (
          <p className="register__state alert alert--error" role="alert">
            {error}
          </p>
        ) : items.length === 0 ? (
          <div className="register__state register__empty">
            <p>No applications yet.</p>
            <span>
              {planId
                ? 'No applications on this plan.'
                : 'Submitted applications will appear here.'}
            </span>
          </div>
        ) : (
          <table className="register__table">
            <thead>
              <tr>
                <th scope="col">Application</th>
                <th scope="col">Mobile</th>
                <th scope="col">Net weight</th>
                <th scope="col">Plan</th>
                <th scope="col" className="is-numeric">
                  Loan
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((lead) => (
                <tr key={lead.applicationId}>
                  <td data-label="Application">
                    <strong>{lead.applicationId}</strong>
                    <small>{formatDate(lead.createdAt)}</small>
                  </td>
                  <td data-label="Mobile" className="is-mono">
                    {lead.mobileNumber}
                  </td>
                  <td data-label="Net weight">
                    {lead.netWeightGrams} g <small>{lead.karat}K</small>
                  </td>
                  <td data-label="Plan">{lead.planName}</td>
                  <td data-label="Loan" className="is-numeric">
                    <Money paise={lead.eligibleLoanPaise} />
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={lead.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
