import { chromium, devices, type Page } from "playwright";
import { test, expect } from '@playwright/test';
import assert from 'node:assert';

const URL = "https://meet.lukas-coding.us";

async function connect(page: Page, peerId: string, otherPeerId: string) {
  await page.getByPlaceholder('You').click();
  await page.getByPlaceholder('You').fill(peerId);
  await page.getByRole('button', { name: 'Go Live' }).click();
  await page.getByPlaceholder('Other').click();
  await page.getByPlaceholder('Other').fill(otherPeerId);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForTimeout(30000);
  // await page.getByRole('button', { name: 'Stop' }).click();
}

test('connect', async ({ browser }) => {
  // Create two isolated browser contexts
  const contextA = await browser.newContext();
  // const contextB = await browser.newContext();

  const pageA = await contextA.newPage();
  // const pageB = await contextB.newPage();

  await pageA.goto(URL);
  // await pageB.goto(URL);

  await connect(pageA, "a", "b");
  // await connect(pageB, "b", "a");
});
