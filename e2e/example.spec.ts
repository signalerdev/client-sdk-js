import { chromium, firefox, devices, type Page } from "playwright";
import { test, expect } from '@playwright/test';
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

test('connect', async ({ }) => {
  // Create two isolated browser contexts
  const browserChromium = await launchChromium();
  const browserFirefox = browserChromium;
  // const browserFirefox = await launchFirefox();

  const contextA = await browserChromium.newContext();
  const contextB = await browserFirefox.newContext();

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await pageA.goto(URL);
  await pageB.goto(URL);

  const peerA = `__test_chromium_a`;
  const peerB = `__test_firefox_b`;
  await Promise.all([
    connect(pageA, peerA, peerB),
    connect(pageB, peerB, peerA)
  ]);
});
