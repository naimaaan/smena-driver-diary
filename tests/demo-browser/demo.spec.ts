import { expect, test } from '@playwright/test';

test('static demo works without API, persists additions and isolates visitors', async ({ page, browser }) => {
  const apiRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.route('**/api/**', route => route.abort());
  await page.goto('/?date=2026-10-01');
  await expect(page.getByTestId('daily-net')).toHaveText(/3\s*315\s*₸/);
  await expect(page.getByTestId('trip-row')).toHaveCount(2);
  await expect(page.getByText('Демо · данные хранятся в этом браузере', { exact: true })).toBeVisible();

  await page.getByLabel('Выбрать дату', { exact: true }).fill('2026-10-15');
  await expect(page.getByTestId('daily-net')).toHaveText(/0\s*₸/);
  await page.getByRole('button', { name: 'Добавить поездку', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Новая поездка' });
  await dialog.getByLabel('Сумма поездки, ₸', { exact: true }).fill('2000');
  await dialog.getByLabel('Комиссия, ₸', { exact: true }).fill('300');
  await dialog.getByRole('radio', { name: 'Наличные', exact: true }).check();
  await dialog.getByRole('button', { name: 'Сохранить поездку', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('daily-net')).toHaveText(/1\s*700\s*₸/);
  await expect(page.getByTestId('trip-row')).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('daily-net')).toHaveText(/1\s*700\s*₸/);
  await expect(page.getByTestId('trip-row')).toHaveCount(1);

  await page.getByLabel('Выбрать дату', { exact: true }).fill('2026-10-01');
  await expect(page.getByTestId('daily-net')).toHaveText(/3\s*315\s*₸/);
  await page.getByLabel('Выбрать дату', { exact: true }).fill('2026-10-15');
  await expect(page.getByTestId('daily-net')).toHaveText(/1\s*700\s*₸/);

  const visitor = await browser.newContext();
  try {
    const visitorPage = await visitor.newPage();
    await visitorPage.goto('http://127.0.0.1:4173/?date=2026-10-15');
    await expect(visitorPage.getByTestId('daily-net')).toHaveText(/0\s*₸/);
    await expect(visitorPage.getByTestId('trip-row')).toHaveCount(0);
  } finally {
    await visitor.close();
  }
  expect(apiRequests).toEqual([]);
});

test('demo does not report successful saving when browser storage rejects the write', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage is full', 'QuotaExceededError'); };
  });
  await page.goto('/?date=2026-10-15');
  await expect(page.getByTestId('daily-net')).toHaveText(/0\s*₸/);
  await page.getByRole('button', { name: 'Добавить поездку', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Новая поездка' });
  await dialog.getByLabel('Сумма поездки, ₸', { exact: true }).fill('2000');
  await dialog.getByRole('button', { name: 'Сохранить поездку', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть форму', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('daily-net')).toHaveText(/0\s*₸/);
  await expect(page.getByTestId('trip-row')).toHaveCount(0);
});
