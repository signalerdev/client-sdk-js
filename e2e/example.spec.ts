import { chromium, firefox, type Page } from "playwright";
import { test as base, expect, Browser, devices, webkit } from '@playwright/test';
import assert from 'node:assert';

// const URL = "https://meet.lukas-coding.us";
const URL = "http://localhost:5173/?mock";

async function waitForStableVideo(page: Page, peerId: string, timeoutMs: number, delayMs = 0) {
  // return page.waitForFunction(({ peerId, durationSeconds }) => {
  //   const video = document.querySelector(`video[data-testid=${peerId}]`) as HTMLVideoElement;
  //   return !!video && !video.paused && video.currentTime > durationSeconds;
  // }, { peerId, durationSeconds });

  const video = page.getByTestId(peerId);
  const start = performance.now();

  while ((performance.now() - start) < timeoutMs) {
    try {
      expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
      expect(await video.evaluate((v: HTMLVideoElement) => v.ended)).toBe(false);
      expect(await video.evaluate((v: HTMLVideoElement) => v.readyState)).toBe(4);
      await page.waitForTimeout(delayMs).catch(() => { });
      return;
    } catch (_e) {
      await page.waitForTimeout(1000).catch(() => { });
    }
  }

  throw new Error("waitForStableVideo timeout");
}

async function connect(page: Page, peerId: string, otherPeerId: string) {
  await page.getByPlaceholder('You').click();
  await page.getByPlaceholder('You').fill(peerId);
  await waitForStableVideo(page, peerId, 5_000);

  await page.getByRole('button', { name: 'Go Live' }).click();
  await page.getByPlaceholder('Other').click();
  await page.getByPlaceholder('Other').fill(otherPeerId);
  await page.getByRole('button', { name: 'Connect' }).click();
  await waitForStableVideo(page, otherPeerId, 10_000);

  return () => page.getByRole('button', { name: 'Stop' }).click();
}

function randId() {
  return Math.floor(Math.random() * 2 ** 32);
}

const test = base.extend({
  browserType: async ({ browserName }, use) => {
    const browserTypes = {
      'chromium': await chromium.launch(),
      'chrome': await chromium.launch({ channel: "chrome" }),
      'msedge': await chromium.launch({ channel: "msedge" }),
      'webkit': await webkit.launch(),
      // 'firefox': await firefox.launch(), // Uncomment when Firefox issue is resolved
    };
    await use(browserTypes[browserName]);
  },
  page: async ({ browserType }, use) => {
    const context = await browserType.newContext();
    const page = await context.newPage();
    await page.goto(URL);
    await use(page);
    await context.close();
  }
});

test.describe.parallel("basic", () => {
  const browserNames = ['chromium', 'chrome', 'msedge', 'webkit' /*, 'firefox'*/];

  for (const browserNameA of browserNames) {
    for (const browserNameB of browserNames) {
      test(`${browserNameA}_${browserNameB}`, async ({ page: pageA, browserType: browserTypeA }) => {
        const peerA = `__${browserNameA}_${randId()}`;
        const peerB = `__${browserNameB}_${randId()}`;

        const pageB = await browserTypeA.newPage(); // Create a second page in the same browser
        await pageB.goto(URL);

        try {
          await Promise.all([
            connect(pageA, peerA, peerB),
            connect(pageB, peerB, peerA)
          ]);
        } finally {
          await pageB.close();
        }
      }, { browserName: browserNameA });
    }
  }
});

test.skip(`connect`, async ({ browser, browserName }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(URL);

  const peerA = "a";
  const peerB = `__${browserName}_${randId()}`;
  await connect(page, peerB, peerA);
});
