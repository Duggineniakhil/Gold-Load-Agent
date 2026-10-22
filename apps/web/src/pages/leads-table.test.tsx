import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LeadSummary } from '../lib/api';
import { LeadsTable } from './leads-table';

const lead = (overrides: Partial<LeadSummary>): LeadSummary => ({
  applicationId: 'GL-1001',
  name: 'Ravi Kumar',
  mobileNumber: '9876XXXX10',
  netWeightGrams: 45,
  karat: 22,
  planId: 'PLAN_EMI_01',
  planName: 'Monthly EMI',
  eligibleLoanPaise: 21656200,
  status: 'SUBMITTED',
  createdAt: '2026-10-22T09:30:00.000Z',
  ...overrides,
});

const render = (items: LeadSummary[]) =>
  renderToStaticMarkup(
    <LeadsTable items={items} caption="Gold loan applications, newest first" animateRows={false} />,
  );

const unmaskedMobile = /[6-9]\d{9}/;

describe('LeadsTable', () => {
  it('shows the masked mobile exactly as the API returns it', () => {
    const html = render([lead({})]);
    expect(html).toContain('9876XXXX10');
    expect(html).not.toMatch(unmaskedMobile);
  });

  it('never renders an unmasked mobile, even if a response regresses', () => {
    const html = render([
      lead({ applicationId: 'GL-1002', mobileNumber: '9876543210' }),
      lead({ applicationId: 'GL-1003', mobileNumber: '6000012345' }),
    ]);
    expect(html).not.toMatch(unmaskedMobile);
    expect(html).toContain('9876XXXX10');
    expect(html).toContain('6000XXXX45');
  });

  it('uses semantic table markup with a caption, column scopes and row headers', () => {
    const html = render([lead({})]);
    expect(html).toContain(
      '<caption class="sr-only">Gold loan applications, newest first</caption>',
    );
    expect(html.match(/<th scope="col"/g)).toHaveLength(8);
    expect(html).toContain('<th scope="row" data-label="Application ID">GL-1001</th>');
  });
});
