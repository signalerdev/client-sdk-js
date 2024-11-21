import { chromium as bChromium, firefox as bFirefox, webkit as bWebkit, type Page } from "playwright";
import { test, expect, Browser, } from '@playwright/test';
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

function getAllPairs<T>(list: T[]): [T, T][] {
  const pairs: [T, T][] = [];

  for (let i = 0; i < list.length; i++) {
    for (let j = i; j < list.length; j++) {
      pairs.push([list[i], list[j]]);
    }
  }
  return pairs;
}

test.describe("basic", () => {
  const browserNames = ["chromium", "chrome", "msedge", "webkit"];
  const browsers: Browser[] = [];
  const pairs: [string, string][] = getAllPairs(browserNames);

  test.beforeAll(async () => {
    const [chromium, chrome, msedge, webkit] = await Promise.all([
      bChromium.launch(),
      bChromium.launch({ channel: "chrome" }),
      bChromium.launch({ channel: "msedge" }),
      bWebkit.launch(),
    ])

    browsers["chromium"] = chromium;
    browsers["chrome"] = chrome;
    browsers["msedge"] = msedge;
    browsers["webkit"] = webkit;
  });

  for (const [bA, bB] of pairs) {
    test(`${bA}_${bB}`, async () => {
      const peerA = `__${bA}_${randId()}`;
      const peerB = `__${bB}_${randId()}`;

      // Launch browserA for pageA
      const contextA = await browsers[bA].newContext();
      const pageA = await contextA.newPage();
      await pageA.goto(URL);

      // Launch browserB for pageB
      const contextB = await browsers[bB].newContext();
      const pageB = await contextB.newPage();
      await pageB.goto(URL);

      try {
        const [closeA, closeB] = await Promise.all([
          connect(pageA, peerA, peerB),
          connect(pageB, peerB, peerA)
        ]);
        await Promise.all([closeA(), closeB()]);
      } finally {
        await contextA.close();
        await contextB.close();
      }
    });
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
