import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { MatchPlayerView } from "@interests/shared";
import { expect, type Page, test } from "@playwright/test";
import { startTestServer } from "./support/serverHarness";

test("ordinary cards and future focus, with an explicit synthetic paid-diligence UI boundary", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const server = await startTestServer();
  const contexts = await Promise.all(
    [320, 390, 768, 1280].map((width) =>
      browser.newContext({ viewport: { width, height: 800 } }),
    ),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const host = pages[0]!;
  let roomCode = "";
  const view = async (page: Page = host): Promise<MatchPlayerView> =>
    (
      await (
        await page.request.get(`${server.origin}/api/rooms/${roomCode}/match`)
      ).json()
    ).match;
  try {
    await host.goto(server.origin);
    await host.fill("#create-nickname", "Content Host");
    await host.click("#create-room-btn");
    await host.click("#dismiss-recovery-code-btn");
    roomCode = (await host
      .getByTestId("room-code-display")
      .textContent())!.trim();
    for (let index = 1; index < 4; index++) {
      const page = pages[index]!;
      await page.goto(`${server.origin}/?room=${roomCode}`);
      await page.fill("#join-nickname", `Content Guest ${index}`);
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
      await expect(
        page.getByTestId("recurring-opportunity-panel"),
      ).toBeVisible();
    const opening = await Promise.all(pages.map((page) => view(page)));
    expect(
      new Set(opening.map((match) => match.self.recurringOpportunity!.id)).size,
    ).toBe(4);
    expect(opening.every((match) => match.self.opportunity === null)).toBe(
      true,
    );
    const before = opening[0]!;
    await host
      .getByLabel("Focus for future opportunities")
      .selectOption("business");
    await host.getByTestId("set-focus-btn").click();
    await expect
      .poll(async () => (await view()).self.financialDetails.focus)
      .toBe("business");
    expect((await view()).self.recurringOpportunity).toEqual(
      before.self.recurringOpportunity,
    );
    expect((await view()).round!.stage).toBe("round-start");

    // This explicit fixture tests the paid UI without waiting for a random affordable card.
    // It changes only one private discovery card, never balances, ownership or thresholds.
    await server.stop();
    execFileSync(process.execPath, [
      createRequire(import.meta.url).resolve("tsx/cli"),
      "apps/server/test/support/seedBrowserRecurringInvestigation.ts",
      server.dbPath,
      before.matchId,
      before.self.playerId,
    ]);
    await server.restart();
    for (const page of pages) await page.reload();
    await expect(host.getByTestId("resume-match-btn")).toBeEnabled();
    expect(
      await host.getByTestId("investigate-recurring-btn").isDisabled(),
    ).toBe(true);
    await host.getByTestId("resume-match-btn").click();
    const seeded = await view();
    await expect(host.getByTestId("recurring-card-name")).toHaveText(
      "Local service company",
    );
    await expect(host.getByTestId("investigate-recurring-btn")).toHaveText(
      "Investigate for $250",
    );
    expect(seeded.self.cashCents).toBe(before.self.cashCents);
    await host.getByTestId("investigate-recurring-btn").click();
    await expect(host.getByTestId("recurring-facts")).toBeVisible();
    const investigated = await view();
    expect(investigated.self.cashCents).toBe(seeded.self.cashCents - 25_000);
    expect(investigated.revision).toBe(seeded.revision + 1);
    expect(investigated.self.recurringOpportunity!.facts).toMatchObject({
      kind: "business",
      annualOperatingProfitCents: 3_000_000,
    });
    for (const page of pages.slice(1)) {
      const other = await view(page);
      expect(other.self.recurringOpportunity!.id).not.toBe(
        investigated.self.recurringOpportunity!.id,
      );
      expect(JSON.stringify(other)).not.toContain(
        investigated.self.recurringOpportunity!.id,
      );
    }
    expect(
      await host
        .getByTestId("recurring-opportunity-panel")
        .getByRole("button", { name: /buy|purchase|finance/i })
        .count(),
    ).toBe(0);
    const width = await host.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client);
    await host.screenshot({
      path: test.info().outputPath("recurring-diligence-320px.png"),
      fullPage: true,
    });
    await host.reload();
    await expect(host.getByTestId("recurring-facts")).toBeVisible();
    expect((await view()).self.cashCents).toBe(investigated.self.cashCents);
    expect((await view()).self.recurringOpportunity).toEqual(
      investigated.self.recurringOpportunity,
    );
    if (await host.getByTestId("resume-match-btn").count()) {
      await expect(host.getByTestId("resume-match-btn")).toBeEnabled();
      await host.getByTestId("resume-match-btn").click();
    }
    await host.getByTestId("begin-round-btn").click();
    for (let index = 0; index < 4; index++) {
      const page = pages[index]!;
      await expect(page.getByTestId("pass-spotlight-btn")).toBeEnabled();
      await page.getByTestId("pass-spotlight-btn").click();
      if (index === 0)
        await expect(
          host.getByTestId("recurring-opportunity-panel").getByRole("status"),
        ).toContainText("expired");
    }
    await expect.poll(async () => (await view()).currentQuarter).toBe(2);
    const next = await view();
    expect(next.self.recurringOpportunity!.id).not.toBe(
      investigated.self.recurringOpportunity!.id,
    );
    expect(next.self.recurringOpportunity!.facts).toBeUndefined();
    expect(next.self.financialDetails.focus).toBe("business");
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.cleanup();
  }
});
