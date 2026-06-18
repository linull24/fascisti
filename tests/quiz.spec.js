const { test, expect } = require('@playwright/test');
const path = require('path');

const URL = `file://${path.resolve(__dirname, '..', 'index.html')}`;

test.describe('Fascisti Quiz', () => {

  test('cover page loads and shows start button', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('#startBtn')).toBeVisible();
    await expect(page.locator('.title')).toHaveText('FaScisTi Quiz');
    // These texts should NOT be present
    await expect(page.locator('.subtitle')).not.toBeVisible();
    await expect(page.locator('.foot')).not.toBeVisible();
  });

  test('full quiz flow: start to result', async ({ page }) => {
    await page.goto(URL);
    await page.click('#startBtn');

    // Answer all 15 questions
    for (let i = 0; i < 15; i++) {
      await expect(page.locator('#quiz')).toBeVisible();
      const opt = page.locator('.opt').first();
      await expect(opt).toBeVisible();
      await opt.click();
    }

    // Result page
    await expect(page.locator('#result')).toBeVisible();
    await expect(page.locator('#rName')).not.toBeEmpty();

    // Portrait image should load from local asset/
    const img = page.locator('#rImg');
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^asset\//);
  });

  test('retry button returns to quiz', async ({ page }) => {
    await page.goto(URL);
    await page.click('#startBtn');
    for (let i = 0; i < 15; i++) {
      await page.locator('.opt').first().click();
    }
    await expect(page.locator('#result')).toBeVisible();
    await page.click('#againBtn');
    await expect(page.locator('#quiz')).toBeVisible();
    await expect(page.locator('#step')).toContainText('1 / 15');
  });

  test('images load without error', async ({ page }) => {
    const imgErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') imgErrors.push(msg.text());
    });

    await page.goto(URL);
    await page.click('#startBtn');
    for (let i = 0; i < 15; i++) {
      await page.locator('.opt').first().click();
    }

    const img = page.locator('#rImg');
    // Check image loaded naturally
    await expect(img).toHaveJSProperty('complete', true);
    const naturalWidth = await img.evaluate(el => el.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
    console.log(`Image naturalWidth: ${naturalWidth}, errors: ${imgErrors.length}`);
  });
});
