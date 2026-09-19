import { spawn } from "node:child_process";
import { chromium } from "playwright";

const url = "http://127.0.0.1:3000/";
const viewports = [
  [1920, 1080],
  [1600, 900],
  [1440, 900],
  [1366, 768],
];
const forbiddenLobbyText = [
  `Magic${"Poker"}`,
  `Magic ${"Poker"}`,
  `Magic${"Poker"} Tavern`,
  `${10} USDC`,
  `${25} USDC`,
  `${50} USDC`,
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerReady() {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await isServerReady()) {
      return;
    }

    await wait(1_000);
  }

  throw new Error("Next server did not become ready on 127.0.0.1:3000");
}

async function main() {
  const hadExistingServer = await isServerReady();
  const server = hadExistingServer
    ? null
    : spawn(
        process.env.ComSpec ?? "cmd.exe",
        [
          "/d",
          "/s",
          "/c",
          "npm.cmd run -w web dev -- --hostname 127.0.0.1 --port 3000",
        ],
        {
          cwd: process.cwd(),
          stdio: ["ignore", "inherit", "inherit"],
        },
      );

  try {
    await waitForServer();

    const browser = await chromium.launch();
    const page = await browser.newPage();

    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      await page.goto(url, { waitUntil: "networkidle" });

      const bodyText = await page.locator("body").innerText();
      if (forbiddenLobbyText.some((text) => bodyText.includes(text))) {
        throw new Error(
          `Old lobby branding or stake text found at ${width}x${height}`,
        );
      }

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      }));

      if (overflow.scrollWidth > overflow.innerWidth) {
        throw new Error(
          `Horizontal overflow at ${width}x${height}: ${JSON.stringify(overflow)}`,
        );
      }

      const screenshotPath = `wildcard-lobby-${width}x${height}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`Captured ${screenshotPath}`);
    }

    await browser.close();
  } finally {
    if (server) {
      server.kill();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
