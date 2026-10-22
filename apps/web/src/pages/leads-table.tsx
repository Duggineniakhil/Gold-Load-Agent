import { motion } from 'motion/react';
import type { LeadSummary } from '../lib/api';
import { displayMobile, formatDate } from '../lib/format';
import { Money, StatusBadge } from '../ui';

type Props = {
  items: LeadSummary[];
  caption: string;
  /** Rows mounted while true fade in with a short stagger; later rows appear at once. */
  animateRows: boolean;
};

export function LeadsTable({ items, caption, animateRows }: Props) {
  return (
    <table className="register__table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Application ID</th>
          <th scope="col">Name</th>
          <th scope="col">Mobile</th>
          <th scope="col">Net weight</th>
          <th scope="col">Plan</th>
          <th scope="col" className="is-numeric">
            Loan amount
          </th>
          <th scope="col">Status</th>
          <th scope="col">Created</th>
        </tr>
      </thead>
      <tbody>
        {items.map((lead, index) => (
          <motion.tr
            key={lead.applicationId}
            initial={animateRows ? { opacity: 0, y: 6 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: animateRows ? Math.min(index * 0.035, 0.3) : 0 }}
          >
            <th scope="row" data-label="Application ID">
              {lead.applicationId}
            </th>
            <td data-label="Name">{lead.name}</td>
            <td data-label="Mobile" className="is-mono">
              {displayMobile(lead.mobileNumber)}
            </td>
            <td data-label="Net weight">
              {lead.netWeightGrams} g <small>{lead.karat}K</small>
            </td>
            <td data-label="Plan">{lead.planName}</td>
            <td data-label="Loan amount" className="is-numeric">
              <Money paise={lead.eligibleLoanPaise} />
            </td>
            <td data-label="Status">
              <StatusBadge status={lead.status} />
            </td>
            <td data-label="Created">
              <time dateTime={lead.createdAt}>{formatDate(lead.createdAt)}</time>
            </td>
          </motion.tr>
        ))}
      </tbody>
    </table>
  );
}
