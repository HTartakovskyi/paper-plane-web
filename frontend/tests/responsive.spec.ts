import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PrismaService } from '../../backend/dist/src/prisma/prisma.service.js';

async function checkLayout(page: Page, action: string) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight,
    text: document.body.innerText,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.bodyHeight).toBeLessThanOrEqual(dimensions.height);
  expect(dimensions.text).not.toMatch(/[\u0400-\u04ff]/);
  await expect(page.getByRole('button', { name: action, exact: true })).toBeInViewport({ ratio: 1 });
  const canvas = await page.locator('canvas').boundingBox();
  expect(canvas!.height).toBeGreaterThan(100);
  expect(canvas!.width).toBeGreaterThan(100);
}

for (const [width, height] of [[1920,1080],[1366,768],[1280,720],[1024,768],[390,844]]) {
  test(`${width}x${height}: no page overflow, all planes and repeat throws`, async ({ page }) => {
    const db = new PrismaService();
    let sessionId: string | undefined;
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
      await checkLayout(page, 'THROW');
      await page.screenshot({ path: `test-results/layout-${width}x${height}.png` });
      await page.getByLabel('Launch angle').focus();
      await page.keyboard.press('Home');
      await page.getByLabel('Speed', { exact: true }).focus();
      await page.keyboard.press('Home');
      for (const planeId of ['BasicPlane','Glider','Dart']) {
        await page.getByRole('button', { name: planeId, exact: true }).click();
        const reply = page.waitForResponse(r => r.url().includes('/attempts') && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'THROW', exact: true }).click();
        const response = await reply;
        expect(response.status()).toBe(201);
        const result = await response.json();
        if (sessionId) expect(result.sessionId).toBe(sessionId);
        sessionId = result.sessionId;
        await expect(page.getByTestId('result')).toBeVisible({ timeout: 35000 });
        await expect(page.locator('.score strong')).toHaveText(String(result.score));
        await checkLayout(page, 'TRY AGAIN');
        if (planeId === 'Dart') await page.screenshot({ path: `test-results/result-${width}x${height}.png` });
        await page.getByRole('button', { name: 'TRY AGAIN', exact: true }).click();
      }
      // Exercise reflow without reloading (including the CSS viewport equivalent of 200% zoom).
      for (const viewport of [{width:683,height:384},{width:844,height:390},{width,height}]) {
        await page.setViewportSize(viewport);
        await checkLayout(page, 'THROW');
      }
      expect(errors).toEqual([]);
    } finally {
      if (sessionId) await db.gameSession.delete({ where: { id: sessionId } });
      await db.$disconnect();
    }
  });
}
