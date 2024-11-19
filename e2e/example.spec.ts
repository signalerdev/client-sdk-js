import { chromium, firefox, devices, type Page } from "playwright";
import { test, expect, Browser } from '@playwright/test';
import assert from 'node:assert';

// const URL = "https://meet.lukas-coding.us";
const URL = "http://localhost:5173";

async function connect(page: Page, peerId: string, otherPeerId: string) {
  await page.getByPlaceholder('You').click();
  await page.getByPlaceholder('You').fill(peerId);
  const localVideo = page.getByTestId(peerId);
  await localVideo.evaluate((v: HTMLVideoElement) => !v.paused);

  await page.getByRole('button', { name: 'Go Live' }).click();
  await page.getByPlaceholder('Other').click();
  await page.getByPlaceholder('Other').fill(otherPeerId);
  await page.getByRole('button', { name: 'Connect' }).click();

  const remoteVideo = page.getByTestId(otherPeerId);
  await remoteVideo.evaluate((v: HTMLVideoElement) => !v.paused);
}

function launchChromium() {
  return chromium.launch({
    args: ['--disable-web-security',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream'
    ]
  })
}

function launchFirefox() {
  return firefox.launch({
    firefoxUserPrefs: {
      'media.navigator.streams.fake': true,
      'media.navigator.permission.disabled': true,
    }
  })
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

interface BrowserInfo {
  name: string;
  builder: () => Promise<Browser>;
}

test.describe("basic", () => {
  const browsers: BrowserInfo[] = [
    { name: "chromium", builder: launchChromium },
    { name: "firefox", builder: launchFirefox },
  ];
  const pairs = getAllPairs(browsers);

  for (const p of pairs) {
    const [browserA, browserB] = p;

    test(`${browserA.name}_${browserB.name}`, async ({ }) => {
      const bA = await browserA.builder();
      const bB = await browserB.builder();
      const contextA = await bA.newContext();
      const contextB = await bB.newContext();

      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await pageA.goto(URL);
      await pageB.goto(URL);

      const peerA = `__${browserA.name}_${Math.random() * 2 ** 32}`;
      const peerB = `__${browserB.name}_${Math.random() * 2 ** 32}`;
      await Promise.all([
        connect(pageA, peerA, peerB),
        connect(pageB, peerB, peerA)
      ]);
    });
  }
});

