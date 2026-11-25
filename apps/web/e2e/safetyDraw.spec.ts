import type { MatchPlayerView } from "@interests/shared";
import { expect, test } from "@playwright/test";
import { startTestServer } from "./support/serverHarness";

test("ordinary four-browser play reaches the real Q32 draw and remains viewable after restart", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const server = await startTestServer();
  const contexts = await Promise.all(
    [320, 390, 768, 1280].map((width) =>
      browser.newContext({ viewport: { width, height: 800 } }),
    ),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    const host = pages[0]!;
    await host.goto(server.origin);
    await host.fill("#create-nickname", "Draw Host");
    await host.click("#create-room-btn");
    await host.click("#dismiss-recovery-code-btn");
    const roomCode = (await host
      .getByTestId("room-code-display")
      .textContent())!.trim();
    for (let index = 1; index < 4; index++) {
      const page = pages[index]!;
      await page.goto(`${server.origin}/?room=${roomCode}`);
      await page.fill("#join-nickname", `Draw Player ${index}`);
      await page.click("#join-room-btn");
      await page.click("#dismiss-recovery-code-btn");
    }
    await expect(host.getByTestId("start-game-btn")).toBeEnabled();
    await host.click("#start-game-btn");
    for (const page of pages) {
      await page.locator('[data-testid^="objective-card-"]').first().click();
      await page.getByTestId("confirm-objective-btn").click();
    }
    for (const page of pages)
      await expect(page.getByTestId("round-start-view")).toBeVisible();
    async function view(index = 0): Promise<MatchPlayerView> {
      const response = await pages[index]!.request.get(
        `${server.origin}/api/rooms/${roomCode}/match`,
      );
      expect(response.status()).toBe(200);
      return (await response.json()).match;
    }
    const initialViews = await Promise.all(
      pages.map((_, index) => view(index)),
    );
    for (let quarter = 1; quarter <= 32; quarter++) {
      await expect(host.getByTestId("quarter-heading")).toHaveText(
        `Quarter ${quarter}`,
      );
      await host.getByTestId("begin-round-btn").click();
      for (let spotlight = 0; spotlight < 4; spotlight++) {
        await expect(host.getByTestId("spotlight-view")).toBeVisible();
        const current = await view();
        const index = initialViews.findIndex(
          (player) =>
            player.self.playerId === current.round!.activeSpotlightPlayerId,
        );
        const button = pages[index]!.getByTestId("pass-spotlight-btn");
        await expect(button).toBeEnabled();
        await button.click();
        await expect(button).toHaveCount(0);
      }
    }
    for (const page of pages) {
      await expect(page.getByTestId("finished-match-view")).toBeVisible();
      await expect(page.getByTestId("final-result-description")).toHaveText(
        "Quarter 32 has settled. The match ended in a draw.",
      );
      await expect(page.getByTestId("pause-banner")).toHaveCount(0);
      await expect(page.getByTestId("begin-round-btn")).toHaveCount(0);
    }
    const terminalViews = await Promise.all(
      pages.map((_, index) => view(index)),
    );
    expect(
      terminalViews.every(
        (player) =>
          player.revision === 164 &&
          player.currentQuarter === 32 &&
          player.phase === "finished" &&
          player.self.lastSettlement!.quarter === 32,
      ),
    ).toBe(true);
    expect(
      new Set(terminalViews.map((player) => JSON.stringify(player.result)))
        .size,
    ).toBe(1);
    const overflow = await host.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    await host.screenshot({
      path: "/tmp/m7-q32-terminal-phone.png",
      fullPage: true,
    });
    for (const context of contexts.slice(1)) await context.close();
    await host.reload();
    await expect(host.getByTestId("finished-match-view")).toBeVisible();
    await expect(host.getByTestId("pause-banner")).toHaveCount(0);
    await server.restart();
    await host.reload();
    await expect(host.getByTestId("finished-match-view")).toBeVisible();
    await expect(host.getByTestId("pause-banner")).toHaveCount(0);
    const restored = await view();
    expect(restored).toEqual(terminalViews[0]);
  } finally {
    for (const context of contexts) await context.close();
    await server.cleanup();
  }
});
