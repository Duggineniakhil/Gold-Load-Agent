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
const leads = [
  {
    applicationId: 'GL-1002',
    mobileNumber: '9876XXXX11',
    netWeightGrams: 45,
    karat: 22,
    planId: 'PLAN_EMI_01',
    planName: 'Monthly EMI',
    eligibleLoanPaise: 21656200,
    status: 'SUBMITTED',
    createdAt: '2026-10-22T09:30:00.000Z',
  },
  {
    applicationId: 'GL-1001',
    mobileNumber: '9123XXXX45',
    netWeightGrams: 10,
    karat: 18,
    planId: 'PLAN_BULLET_01',
    planName: 'Bullet Repayment',
    eligibleLoanPaise: 3675000,
    status: 'SUBMITTED',
    createdAt: '2026-10-21T06:10:00.000Z',
  },
];

async function mockApi(page, { duplicate = false } = {}) {
  await page.route('**/api/v1/loan-schemes', (route) => route.fulfill({ json: plans }));
  await page.route('**/api/v1/quotes', (route) => route.fulfill({ json: quote }));
  await page.route('**/api/v1/leads**', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { items: leads, nextCursor: null } });
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

const browser = await chromium.launch({ headless: true });
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

  await page.goto(`${base}/leads`, { waitUntil: 'networkidle' });
  await capture(page, 'leads', viewport);

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

  await duplicatePage
    .getByRole('button', { name: viewport.width < 820 ? 'Open menu' : 'Ask Loan Assist' })
    .click();
  if (viewport.width < 820) {
    await capture(duplicatePage, 'menu', viewport);
    await duplicatePage.getByRole('button', { name: 'Close menu' }).click();
    await duplicatePage.locator('.nav__assist').click();
  }
  await duplicatePage.getByRole('dialog', { name: 'Loan Assist' }).waitFor();
  await capture(duplicatePage, 'assist', viewport);
  await duplicatePage.close();
}

await browser.close();
console.log(`Screenshots saved in ${output}`);
