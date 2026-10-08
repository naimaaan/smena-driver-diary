import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import type { Trip } from '../../shared/types.js';

test('shows the exact task example, adapts to the viewport and explains calculations', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?date=2026-10-01');
  await expect(page.getByTestId('daily-net')).toHaveText(/3\s*315\s*₸/);
  await expect(page.getByTestId('trip-row')).toHaveCount(2);
  await expect(page.getByTestId('trip-row').first()).toContainText('08:10');
  await expect(page.getByTestId('trip-row').first()).toContainText('08:32');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({ path: `docs/screenshots/${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Как это работает' }).click();
  await expect(page.getByRole('dialog', { name: 'Как работает «Смена»' })).toBeVisible();
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('switches dates, shows a zero day and restores the task example', async ({ page }) => {
  await page.goto('/?date=2026-10-20');
  await expect(page.getByTestId('daily-net')).toHaveText(/0\s*₸/);
  await expect(page.getByText('Здесь начнётся ваша смена')).toBeVisible();
  await page.getByRole('button', { name: 'Следующий день', exact: true }).click();
  await expect(page.getByLabel('Выбрать дату', { exact: true })).toHaveValue('2026-10-21');
  await page.getByRole('button', { name: 'Предыдущий день', exact: true }).click();
  await expect(page.getByLabel('Выбрать дату', { exact: true })).toHaveValue('2026-10-20');
  await page.getByLabel('Выбрать дату', { exact: true }).fill('2026-10-01');
  await expect(page.getByTestId('daily-net')).toHaveText(/3\s*315\s*₸/);
  await expect(page.getByTestId('trip-row')).toHaveCount(2);
});

test('validates the form and saves a trip through the real API', async ({ page }, info) => {
  const day = 10 + (info.project.name === 'desktop' ? 0 : 1) + 4 * info.retry;
  const date = `2026-10-${day}`;
  await page.goto(`/?date=${date}`);
  await expect(page.getByTestId('daily-net')).toHaveText(/0\s*₸/);
  await page.getByRole('button', { name: 'Добавить поездку', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Новая поездка' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Начало поездки', { exact: true }).fill(`${date}T10:00`);
  await dialog.getByLabel('Окончание поездки', { exact: true }).fill(`${date}T09:30`);
  await dialog.getByLabel('Сумма поездки, ₸', { exact: true }).fill('2000');
  await dialog.getByLabel('Комиссия, ₸', { exact: true }).fill('300');
  await dialog.getByRole('radio', { name: 'Наличные', exact: true }).check();
  await dialog.getByRole('button', { name: 'Сохранить поездку', exact: true }).click();
  await expect(dialog.getByText('Окончание должно быть позже начала.')).toBeVisible();
  await dialog.getByLabel('Окончание поездки', { exact: true }).fill(`${date}T10:30`);
  const created = page.waitForResponse(response => response.url().endsWith('/api/trips') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Сохранить поездку', exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('daily-net')).toHaveText(/1\s*700\s*₸/);
  await expect(page.getByTestId('trip-row')).toHaveCount(1);
  await expect(page.getByTestId('trip-row').first()).toContainText('Наличные');
});

test('retries a saved trip after a lost response with the same id and no duplicate', async ({ page }, info) => {
  const day = 12 + (info.project.name === 'desktop' ? 0 : 1) + 4 * info.retry;
  const date = `2026-10-${day}`;
  const attempts: Trip[] = [];
  await page.route('**/api/trips', async route => {
    attempts.push(route.request().postDataJSON() as Trip);
    if (attempts.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      // The server commits the trip, but the browser never receives its response.
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });
  await page.goto(`/?date=${date}`);
  await expect(page.getByTestId('daily-net')).toHaveText(/0\s*₸/);
  await page.getByRole('button', { name: 'Добавить поездку', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Новая поездка' });
  await dialog.getByLabel('Сумма поездки, ₸', { exact: true }).fill('1200');
  await dialog.getByLabel('Комиссия, ₸', { exact: true }).fill('180');
  await dialog.getByRole('button', { name: 'Сохранить поездку', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Не удалось подтвердить сохранение');
  // Editing and restoring the same payload must still retry the original operation.
  await dialog.getByLabel('Комиссия, ₸', { exact: true }).fill('181');
  await dialog.getByLabel('Комиссия, ₸', { exact: true }).fill('180');
  const retry = page.waitForResponse(response => response.url().endsWith('/api/trips') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Сохранить поездку', exact: true }).click();
  const response = await retry;
  expect(response.status()).toBe(200);
  expect((await response.json()).created).toBe(false);
  await expect(page.getByTestId('daily-net')).toHaveText(/1\s*020\s*₸/);
  await expect(page.getByTestId('trip-row')).toHaveCount(1);
  expect(attempts).toHaveLength(2);
  expect(attempts[0].id).toBe(attempts[1].id);
});

test('shows a connection error and recovers when the user retries', async ({ page }) => {
  await page.route('**/api/days/2026-10-01', route => route.abort());
  await page.goto('/?date=2026-10-01');
  await expect(page.getByRole('alert')).toContainText('Поездки пока недоступны');
  await page.unroute('**/api/days/2026-10-01');
  await page.getByRole('button', { name: 'Попробовать снова', exact: true }).click();
  await expect(page.getByTestId('daily-net')).toHaveText(/3\s*315\s*₸/);
});

test('never shows a delayed response under a different selected date', async ({ page }) => {
  let release!: () => void;
  let intercepted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { intercepted = resolve; });
  await page.route('**/api/days/2026-10-01', async route => {
    const response = await route.fetch();
    intercepted();
    await gate;
    try { await route.fulfill({ response }); } catch { /* The old request is intentionally cancelled. */ }
  });
  await page.goto('/?date=2026-10-01');
  await started;
  await page.getByLabel('Выбрать дату', { exact: true }).fill('2026-10-20');
  await expect(page.getByTestId('daily-net')).toHaveText(/0\s*₸/);
  release();
  await expect(page.getByLabel('Выбрать дату', { exact: true })).toHaveValue('2026-10-20');
  await expect(page.getByTestId('daily-net')).toHaveText(/0\s*₸/);
  await expect(page.getByText('Здесь начнётся ваша смена')).toBeVisible();
});

test('keeps exact large monetary totals readable on a 320px screen', async ({ page }, info) => {
  const day = 1 + (info.project.name === 'desktop' ? 0 : 1) + 2 * info.retry;
  const date = `2026-11-0${day}`;
  for (const [index, amount] of [1_000_000_000, 999_000_000].entries()) {
    const response = await page.request.post('/api/trips', { data: {
      id: `large-${info.project.name}-${info.retry}-${index}`,
      start: `${date}T08:0${index}:00+05:00`, end: `${date}T08:3${index}:00+05:00`,
      amount, payment: index === 0 ? 'card' : 'cash', commission: index === 0 ? 150_000_000 : 0,
    } });
    expect(response.status()).toBe(201);
  }
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`/?date=${date}`);
  await expect(page.getByTestId('daily-net')).toHaveText(/1\s*849\s*000\s*000\s*₸/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await expect(page.locator('.breakdown-item strong')).toHaveCount(4);
  const clipped = await page.locator('.balance-value, .breakdown-item strong, .trip-amount, .trip-commission, .trip-net').evaluateAll(elements =>
    elements.filter(element => element.scrollWidth > Math.ceil(element.getBoundingClientRect().width) + 1).length);
  expect(clipped).toBe(0);
  await page.screenshot({ path: info.outputPath('large-values-320.png'), fullPage: true });
});

test('displays the fixed UTC+05 business time for historical dates too', async ({ page }, info) => {
  const day = 1 + (info.project.name === 'desktop' ? 0 : 1) + 2 * info.retry;
  const date = `2000-01-0${day}`;
  const response = await page.request.post('/api/trips', { data: {
    id: `historical-${info.project.name}-${info.retry}`,
    start: `${date}T08:10:00+05:00`, end: `${date}T08:32:00+05:00`,
    amount: 2400, payment: 'card', commission: 360,
  } });
  expect(response.status()).toBe(201);
  await page.goto(`/?date=${date}`);
  await expect(page.getByTestId('trip-row').first()).toContainText('08:10');
  await expect(page.getByTestId('trip-row').first()).toContainText('08:32');
});
