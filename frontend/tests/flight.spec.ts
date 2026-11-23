import { test, expect } from '@playwright/test';
import { PrismaService } from '../../backend/dist/src/prisma/prisma.service.js';

test('real API: three planes, playback, result, retry and error recovery', async ({ page }) => {
  const errors: string[] = [];
  const sessionIds: string[] = [];
  const db = new PrismaService();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', async response => {
    if (response.url().endsWith('/api/sessions') && response.status() === 201) {
      sessionIds.push((await response.json()).id);
    }
  });
  try {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: 'THROW', exact: true })).toBeEnabled();
    await page.screenshot({ path: 'test-results/ready.png' });
    await page.getByLabel('Угол запуска').focus();
    await page.keyboard.press('Home');
    await page.getByLabel('Скорость', { exact: true }).focus();
    await page.keyboard.press('Home');
    for (const planeId of ['BasicPlane', 'Glider', 'Dart']) {
      await page.getByRole('button', { name: planeId, exact: true }).click();
      const reply = page.waitForResponse(r => r.url().includes('/attempts') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'THROW', exact: true }).click();
      const response = await reply;
      expect(response.status()).toBe(201);
      expect(response.request().postDataJSON()).toEqual({ planeId, angle: -45, speed: 2 });
      const attempt = await response.json();
      await expect(page.getByTestId('result')).not.toBeVisible();
      await expect(page.getByRole('progressbar')).toBeVisible();
      await expect(page.getByTestId('result')).toBeVisible({ timeout: 35000 });
      await expect(page.locator('.score strong')).toHaveText(String(attempt.score));
      await page.getByRole('button', { name: 'TRY AGAIN' }).click();
      await expect(page.getByTestId('result')).not.toBeVisible();
    }
    // Known successful inputs; only the server's response supplies the displayed score.
    await page.getByRole('button', { name: 'BasicPlane', exact: true }).click();
    await page.getByLabel('Угол запуска').focus();
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
    await page.getByLabel('Скорость', { exact: true }).focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    const hitReply = page.waitForResponse(r => r.url().includes('/attempts') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'THROW', exact: true }).click();
    const hit = await (await hitReply).json();
    expect(hit.success).toBe(true);
    await expect(page.getByTestId('result')).toBeVisible({ timeout: 35000 });
    await expect(page.locator('.score strong')).toHaveText(String(hit.score));
    await page.screenshot({ path: 'test-results/result.png' });
    expect(sessionIds).toHaveLength(1);
    expect(await db.flightAttempt.count({ where: { sessionId: sessionIds[0] } })).toBe(4);
    expect(errors).toEqual([]);
    await page.getByRole('button', { name: 'TRY AGAIN' }).click();
    // Deliberate HTTP error: browser may log the expected 503, so console check is above.
    await page.route('**/api/sessions/*/attempts', route => route.fulfill({ status: 503, body: '{}' }), { times: 1 });
    await page.getByRole('button', { name: 'THROW', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Сервер временно недоступен');
    await expect(page.getByRole('button', { name: 'THROW', exact: true })).toBeEnabled();
    expect(await db.flightAttempt.count({ where: { sessionId: sessionIds[0] } })).toBe(4);
  } finally {
    if (sessionIds.length) await db.gameSession.deleteMany({ where: { id: { in: sessionIds } } });
    await db.$disconnect();
  }
});
