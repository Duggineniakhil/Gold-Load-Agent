// Captures every page at 375 px and 1440 px against a mocked API, walks the 3-step
// application (including the 409 path) and fails on horizontal overflow.
// Run with the web dev server up: npm run screenshot --workspace=@tglobal/web
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts/design-system');
const base = 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });

const plans = [
  {
    id: 'PLAN_BULLET_01',
    name: 'Bullet Repayment',
    annualInterestRate: 12,
    tenureMonths: 12,
    maxLtv: 70,
    repaymentType: 'BULLET',
  },
  {
    id: 'PLAN_EMI_01',
    name: 'Monthly EMI',
    annualInterestRate: 10.5,
    tenureMonths: 12,
    maxLtv: 75,
    repaymentType: 'EMI',
  },
];
const quote = {
  goldRatePerGram: 7000,
  pureGoldGrams: '41.250',
  goldValuePaise: 28875000,
  quotes: [
    {
      planId: 'PLAN_BULLET_01',
      name: 'Bullet Repayment',
      ltvAppliedPercent: 70,
      eligibleLoanPaise: 20212500,
    },
    {
      planId: 'PLAN_EMI_01',
      name: 'Monthly EMI',
      ltvAppliedPercent: 75,
      eligibleLoanPaise: 21656200,
    },
  ],
};
const names = ['Ravi Kumar', 'Asha Rao', 'Imran Shaikh', 'Lakshmi Narayanan', 'Priya Menon'];
// 25 leads, newest first; GL-1024 is deliberately unmasked to prove the UI masks it anyway.
const leads = Array.from({ length: 25 }, (_, index) => {
  const number = 1025 - index;
  const emi = index % 3 !== 1;
  return {
    applicationId: `GL-${number}`,
    name: names[index % names.length],
    mobileNumber:
      number === 1024
        ? '9876543210'
        : `98${String(number).slice(-2)}XXXX${String(index).padStart(2, '0')}`,
    netWeightGrams: emi ? 45 : 10,
    karat: emi ? 22 : 18,
    planId: emi ? 'PLAN_EMI_01' : 'PLAN_BULLET_01',
    planName: emi ? 'Monthly EMI' : 'Bullet Repayment',
    eligibleLoanPaise: emi ? 21656200 : 3675000,
    status: 'SUBMITTED',
    createdAt: new Date(Date.UTC(2026, 9, 22, 9, 30) - index * 3_600_000).toISOString(),
  };
});

function leadsPage(url, rows) {
  const query = new URL(url).searchParams;
  const limit = Number(query.get('limit') ?? 20);
  const filtered = rows.filter(
    (lead) => !query.get('planId') || lead.planId === query.get('planId'),
  );
  const start = query.get('cursor')
    ? filtered.findIndex((lead) => lead.applicationId === query.get('cursor')) + 1
    : 0;
  const items = filtered.slice(start, start + limit);
  return { items, nextCursor: start + limit < filtered.length ? items.at(-1).applicationId : null };
}

async function mockApi(page, { duplicate = false, leadsMode = 'paged', adminPasscode = '' } = {}) {
  const control = { failLeads: leadsMode === 'error', repaymentAmounts: [] };
  // Each page gets its own copy so status changes do not leak between runs.
  const rows = leads.map((lead) => ({ ...lead }));
  const history = new Map();
  const transitions = {
    SUBMITTED: ['UNDER_REVIEW'],
    UNDER_REVIEW: ['APPROVED', 'REJECTED'],
    APPROVED: [],
    REJECTED: [],
  };
  await page.route('**/api/v1/loan-schemes', (route) => route.fulfill({ json: plans }));
  await page.route('**/api/v1/quotes', (route) => route.fulfill({ json: quote }));
  await page.route('**/api/v1/gold-rate', (route) =>
    route.fulfill({
      json: {
        ratePerGram24k: 7000,
        source: 'mock',
        asOf: '2026-10-22T09:00:00.000Z',
        cachedUntil: '2026-10-22T09:01:00.000Z',
      },
    }),
  );
  await page.route('**/api/v1/repayment-estimates', (route) => {
    const { planId, loanAmountRupees } = route.request().postDataJSON();
    control.repaymentAmounts.push(loanAmountRupees);
    const principalPaise = loanAmountRupees * 100;
    const emi = planId === 'PLAN_EMI_01';
    const totalInterestPaise = Math.round(principalPaise * (emi ? 0.0577832 : 0.12));
    return route.fulfill({
      json: {
        planId,
        planName: emi ? 'Monthly EMI' : 'Bullet Repayment',
        repaymentType: emi ? 'EMI' : 'BULLET',
        annualInterestRate: emi ? 10.5 : 12,
        tenureMonths: 12,
        principalPaise,
        monthlyInstalmentPaise: emi ? Math.round((principalPaise + totalInterestPaise) / 12) : null,
        totalInterestPaise,
        totalPayablePaise: principalPaise + totalInterestPaise,
      },
    });
  });
  await page.route('**/api/v1/leads**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const isAdminCall = route.request().method() !== 'POST';
    if (
      adminPasscode &&
      isAdminCall &&
      route.request().headers()['x-admin-passcode'] !== adminPasscode
    ) {
      return route.fulfill({
        status: 401,
        json: {
          error: { code: 'ADMIN_AUTH_REQUIRED', message: 'Enter the admin passcode.', fields: [] },
        },
      });
    }
    if (path.endsWith('/stats')) {
      const total = rows.length;
      const count = (status) => rows.filter((row) => row.status === status).length;
      return route.fulfill({
        json: {
          total,
          byStatus: {
            SUBMITTED: count('SUBMITTED'),
            UNDER_REVIEW: count('UNDER_REVIEW'),
            APPROVED: count('APPROVED'),
            REJECTED: count('REJECTED'),
          },
          totalEligibleLoanPaise: rows.reduce((sum, row) => sum + row.eligibleLoanPaise, 0),
        },
      });
    }
    const applicationId = path.split('/')[4];
    const lead = rows.find((row) => row.applicationId === applicationId);
    if (path.endsWith('/audit')) {
      return route.fulfill({
        json: {
          applicationId,
          status: lead.status,
          submittedAt: lead.createdAt,
          entries: history.get(applicationId) ?? [],
        },
      });
    }
    if (route.request().method() === 'PATCH') {
      const { status, actor } = route.request().postDataJSON();
      if (!transitions[lead.status].includes(status)) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'INVALID_TRANSITION',
              message: `${applicationId} is ${lead.status}.`,
              fields: [],
            },
          },
        });
      }
      const entry = { from: lead.status, to: status, actor, at: new Date().toISOString() };
      lead.status = status;
      history.set(applicationId, [...(history.get(applicationId) ?? []), entry]);
      return route.fulfill({ json: { applicationId, status, updatedAt: entry.at, entry } });
    }
    if (route.request().method() === 'GET') {
      if (control.failLeads) {
        return route.fulfill({
          status: 500,
          json: {
            error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', fields: [] },
          },
        });
      }
      if (leadsMode === 'empty') return route.fulfill({ json: { items: [], nextCursor: null } });
      return route.fulfill({ json: leadsPage(route.request().url(), rows) });
    }
    if (!route.request().headers()['idempotency-key']) {
      return route.fulfill({
        status: 400,
        json: {
          error: {
            code: 'TEST_MISSING_KEY',
            message: 'Idempotency-Key header missing.',
            fields: [],
          },
        },
      });
    }
    if (duplicate) {
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'DUPLICATE_APPLICATION',
            message: 'Duplicate.',
            fields: [],
            existing: { applicationId: 'GL-1042', createdAt: '2026-10-03T05:00:00.000Z' },
          },
        },
      });
    }
    return route.fulfill({
      status: 201,
      json: {
        applicationId: 'GL-1003',
        status: 'SUBMITTED',
        createdAt: '2026-10-22T10:00:00.000Z',
        quote: { ...quote, planName: 'Monthly EMI', eligibleLoanPaise: 21656200 },
      },
    });
  });
  return control;
}

async function capture(page, name, viewport) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflows) throw new Error(`${name} has horizontal overflow at ${viewport.width}px`);
  await page.screenshot({ path: resolve(output, `${name}-${viewport.name}.png`), fullPage: true });
}

async function fillDetails(page) {
  await page.getByLabel('Full name').fill('Ravi Kumar');
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByLabel('Gross weight').fill('48');
  await page.getByLabel('Net gold weight').fill('45');
  await page.getByText('Up to date').waitFor();
}

async function assertNoUnmaskedMobile(page, name) {
  const text = await page.locator('main').innerText();
  if (/[6-9]\d{9}/.test(text)) throw new Error(`${name} shows an unmasked mobile number`);
}

async function walkLeads(browser, viewport) {
  const open = async (options) => {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });
    const control = await mockApi(page, options);
    return { page, control };
  };

  const { page } = await open();
  await page.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  await page.getByText('GL-1025').waitFor();
  const table = page.getByRole('table', { name: 'Gold loan applications, newest first' });
  if ((await table.locator('tbody tr').count()) !== 20)
    throw new Error('first page should show 20 rows');
  const rowDisplay = await table
    .locator('tbody tr')
    .first()
    .evaluate((row) => getComputedStyle(row).display);
  if (rowDisplay !== (viewport.width >= 768 ? 'table-row' : 'block')) {
    throw new Error(
      `expected ${viewport.width >= 768 ? 'a table' : 'stacked cards'} at ${viewport.width}px`,
    );
  }
  await assertNoUnmaskedMobile(page, 'leads');
  const clipped = await table.evaluate(
    (element) => element.scrollWidth > element.parentElement.clientWidth,
  );
  if (clipped) throw new Error(`the leads table is clipped inside its card at ${viewport.width}px`);
  await capture(page, 'leads', viewport);

  await page.getByRole('button', { name: 'Load more' }).click();
  await page.getByText('GL-1001').waitFor();
  if ((await table.locator('tbody tr').count()) !== 25)
    throw new Error('Load more should append 5 rows');
  if (await page.getByRole('button', { name: 'Load more' }).count())
    throw new Error('Load more should disappear on the last page');

  await page.getByLabel('Plan', { exact: true }).selectOption('PLAN_BULLET_01');
  await page.waitForURL(/\?planId=PLAN_BULLET_01$/);
  await page
    .getByRole('table', {
      name: 'Gold loan applications on the Bullet Repayment plan, newest first',
    })
    .waitFor();
  await assertNoUnmaskedMobile(page, 'leads-filtered');
  await capture(page, 'leads-filtered', viewport);

  await page.reload({ waitUntil: 'networkidle' });
  if ((await page.getByLabel('Plan', { exact: true }).inputValue()) !== 'PLAN_BULLET_01')
    throw new Error('plan filter should survive a reload');
  await page.close();

  const { page: empty } = await open({ leadsMode: 'empty' });
  await empty.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  await empty.getByRole('link', { name: /Start an application/ }).waitFor();
  await capture(empty, 'leads-empty', viewport);
  await empty.close();

  const { page: failing, control } = await open({ leadsMode: 'error' });
  await failing.goto(`${base}/leads`, { waitUntil: 'networkidle' });
  await failing.waitForURL(/\/admin$/);
  await failing.getByRole('button', { name: 'Try again' }).waitFor();
  await capture(failing, 'leads-error', viewport);
  control.failLeads = false;
  await failing.getByRole('button', { name: 'Try again' }).click();
  await failing.getByText('GL-1025').waitFor();
  await failing.close();

  const { page: admin } = await open();
  await admin.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  await admin.getByRole('button', { name: 'GL-1025: view status and history' }).click();
  const drawer = admin.getByRole('dialog', { name: 'GL-1025' });
  await drawer.locator('.timeline').getByText('Submitted', { exact: true }).waitFor();
  await drawer.getByRole('button', { name: 'Start review' }).click();
  await drawer.getByText('Enter at least 2 characters.').waitFor();
  await drawer.getByLabel('Your name').fill('Asha Rao');
  await drawer.getByRole('button', { name: 'Start review' }).click();
  await drawer.getByText('Moved to Under review.').waitFor();
  await drawer.getByRole('button', { name: 'Approve' }).click();
  await drawer.getByText('Moved to Approved.').waitFor();
  await drawer.getByText('Approved is a final status. No further changes are possible.').waitFor();
  if ((await drawer.getByText('by Asha Rao').count()) !== 2)
    throw new Error('timeline should list both changes');
  await capture(admin, 'lead-drawer', viewport);
  await admin.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached' });
  const badge = admin.getByRole('table').locator('tbody tr').first().locator('.status-badge');
  if ((await badge.innerText()).trim() !== 'APPROVED')
    throw new Error('row badge should show the new status');
  await admin.close();
}

async function walkCalculator(browser, viewport) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const control = await mockApi(page);
  await page.goto(`${base}/calculator`, { waitUntil: 'networkidle' });
  await page.getByText('Enter the gross and net weight to see your eligible loan.').waitFor();
  await page.getByText('₹7,000/g').waitFor();
  await page.getByLabel('Gross weight').fill('50');
  await page.getByLabel('Net gold weight').fill('52');
  await page.getByText('Net weight cannot exceed gross weight.').waitFor();
  await page.getByLabel('Net gold weight').fill('45');
  await page.getByText('Monthly EMI', { exact: true }).first().click();
  await page.getByText('Eligible loan · Monthly EMI').waitFor();
  await page.getByText('Monthly EMI', { exact: true }).last().waitFor();
  await page.locator('.calculator__breakdown').waitFor();
  if (!control.repaymentAmounts.includes(216562))
    throw new Error('repayment should be requested for the full eligible loan');
  await capture(page, 'calculator', viewport);

  const slider = page.getByLabel('Loan amount');
  await slider.focus();
  await page.keyboard.press('Home');
  await page.waitForTimeout(600);
  if (!control.repaymentAmounts.some((amount) => amount < 2000))
    throw new Error('moving the slider should re-estimate');

  await page.getByRole('button', { name: /Apply with these details/ }).click();
  await page.waitForURL(/\/apply$/);
  if ((await page.getByLabel('Gross weight').inputValue()) !== '50')
    throw new Error('Apply should be pre-filled from the calculator');
  if ((await page.getByLabel('Net gold weight').inputValue()) !== '45')
    throw new Error('net weight should be pre-filled');
  await page.close();
}

async function walkAdminGate(browser, viewport) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  await mockApi(page, { adminPasscode: 'letmein' });
  await page.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Admin access' }).waitFor();
  await page.getByLabel('Passcode').fill('wrong');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByText('That passcode is not correct.').waitFor();
  await capture(page, 'admin-gate', viewport);
  await page.getByLabel('Passcode').fill('letmein');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('table').waitFor();
  const applications = page
    .locator('.admin__stat')
    .filter({ hasText: 'Applications' })
    .locator('strong');
  if ((await applications.innerText()).trim() !== '25')
    throw new Error('stats should count every lead');
  await capture(page, 'admin', viewport);
  await page.getByRole('button', { name: /Lock/ }).click();
  await page.getByRole('heading', { name: 'Admin access' }).waitFor();
  await page.close();
}

const browser = await chromium.launch({ headless: true });
for (const viewport of [
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 1000 },
]) {
  await walkLeads(browser, viewport);
  await walkCalculator(browser, viewport);
  await walkAdminGate(browser, viewport);
}

for (const viewport of [
  { name: '375', width: 375, height: 812 },
  { name: '1440', width: 1440, height: 1000 },
]) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  await mockApi(page);

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await capture(page, 'home', viewport);

  await page.goto(`${base}/apply`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Continue to quote/ }).click();
  await page.getByText('Enter the full name.').waitFor();
  await capture(page, 'apply-errors', viewport);

  await fillDetails(page);
  await page.getByLabel('Net gold weight').fill('52');
  await page.getByText('Net weight cannot exceed gross weight.').waitFor();
  await page.getByLabel('Net gold weight').fill('45');
  await page.getByText('Up to date').waitFor();
  await capture(page, 'apply-details', viewport);

  await page.getByRole('button', { name: /Continue to quote/ }).click();
  await page.getByText('Monthly instalments').click();
  await capture(page, 'apply-quote', viewport);

  await page.getByRole('button', { name: /Review application/ }).click();
  await capture(page, 'apply-review', viewport);

  await page.getByRole('button', { name: /Submit application/ }).click();
  await page.getByRole('heading', { name: 'GL-1003' }).waitFor();
  await capture(page, 'apply-success', viewport);
  await page.close();

  const duplicatePage = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  await mockApi(duplicatePage, { duplicate: true });
  await duplicatePage.goto(`${base}/apply`, { waitUntil: 'networkidle' });
  await fillDetails(duplicatePage);
  await duplicatePage.getByRole('button', { name: /Continue to quote/ }).click();
  await duplicatePage.getByText('Monthly instalments').click();
  await duplicatePage.getByRole('button', { name: /Review application/ }).click();
  await duplicatePage.getByRole('button', { name: /Submit application/ }).click();
  await duplicatePage.getByText('You already applied on 3 Oct, application GL-1042.').waitFor();
  await capture(duplicatePage, 'apply-duplicate', viewport);

  if (viewport.width < 820) {
    await duplicatePage.getByRole('button', { name: 'Open menu' }).click();
    await capture(duplicatePage, 'menu', viewport);
    await duplicatePage.getByRole('button', { name: 'Close menu' }).click();
  }
  // The floating button is visible on every page and is the main way into the chat.
  const fab = duplicatePage.locator('.assist-fab');
  const box = await fab.boundingBox();
  if (
    !box ||
    box.x + box.width < viewport.width - 40 ||
    box.y + box.height < viewport.height - 40
  ) {
    throw new Error('the Loan Assist button should float in the bottom-right corner');
  }
  await fab.click();
  await duplicatePage.getByRole('dialog', { name: 'Loan Assist' }).waitFor();
  if (await fab.count()) throw new Error('the floating button should hide while the chat is open');
  await capture(duplicatePage, 'assist', viewport);
  await duplicatePage.close();
}

await browser.close();
console.log(`Screenshots saved in ${output}`);
