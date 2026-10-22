import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts/design-system');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const plans = [
  { id: 'PLAN_BULLET_01', name: 'Bullet Repayment', annualInterestRate: 12, tenureMonths: 12, maxLtv: 70, repaymentType: 'BULLET' },
  { id: 'PLAN_EMI_01', name: 'Monthly EMI', annualInterestRate: 10.5, tenureMonths: 12, maxLtv: 75, repaymentType: 'EMI' },
];

for (const viewport of [{ name: '375', width: 375, height: 812 }, { name: '1440', width: 1440, height: 1000 }]) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
  await page.route('**/api/v1/loan-schemes', (route) => route.fulfill({ json: plans }));
  await page.route('**/api/v1/quotes', (route) => route.fulfill({ json: {
    goldRatePerGram: 7000,
    pureGoldGrams: '41.250',
    goldValuePaise: 28875000,
    quotes: [
      { planId: 'PLAN_BULLET_01', name: 'Bullet Repayment', ltvAppliedPercent: 70, eligibleLoanPaise: 20212500 },
      { planId: 'PLAN_EMI_01', name: 'Monthly EMI', ltvAppliedPercent: 75, eligibleLoanPaise: 21656200 },
    ],
  } }));
  await page.route('**/api/v1/leads**', (route) => route.fulfill({ json: { items: [], nextCursor: null } }));

  for (const [route, name] of [['/apply', 'apply'], ['/leads', 'leads'], ['/__components', 'components']]) {
    await page.goto(`http://127.0.0.1:5173${route}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (name === 'components') await page.waitForTimeout(300);
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflows) throw new Error(`${name} has horizontal overflow at ${viewport.width}px`);
    await page.screenshot({ path: resolve(output, `${name}-${viewport.name}.png`), fullPage: true });
  }

  await page.goto('http://127.0.0.1:5173/apply', { waitUntil: 'networkidle' });
  await page.getByLabel('Gross weight').fill('48');
  await page.getByLabel('Net gold weight').fill('45');
  await page.getByRole('button', { name: /Calculate offer/ }).click();
  await page.getByText('Indicative value').waitFor();
  await page.waitForTimeout(300);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, `offer-${viewport.name}.png`), fullPage: true });

  await page.goto('http://127.0.0.1:5173/__components', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const components = [
    ['button', '.gallery-sample > .button--ink'], ['field', '.gallery-sample > .field'], ['karat', '.gallery-sample > .karat'],
    ['plan-card', '.gallery-sample > .plan-card'], ['stepper', '.gallery-sample > .stepper'], ['money', '.gallery-sample > .gallery-money'],
    ['status-badge', '.gallery-sample > .status-badge'], ['skeleton', '.gallery-sample > .skeleton'], ['toast', '.gallery-sample > .toast'],
  ];
  for (const [name, selector] of components) {
    const element = page.locator(selector).first();
    await element.scrollIntoViewIfNeeded();
    await element.screenshot({ path: resolve(output, `${name}-${viewport.name}.png`) });
  }
  await page.close();
}

await browser.close();
console.log(`Screenshots saved in ${output}`);
