import type { MatchPlayerView } from "@interests/shared";
import { expect, type Page, test } from "@playwright/test";
import { startTestServer } from "./support/serverHarness";

test("four browsers buy and rebalance real funds with private previews and durable holdings", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const server = await startTestServer();
  const contexts = await Promise.all(
    [1280, 390, 390, 320].map((width) =>
      browser.newContext({ viewport: { width, height: 800 } }),
    ),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const host = pages[0]!;
  let roomCode = "";
  const read = (page: Page): Promise<MatchPlayerView> =>
    page.evaluate(
      async (code) =>
        (await (await fetch(`/api/rooms/${code}/match`)).json()).match,
      roomCode,
    );
  try {
    await host.goto(server.origin);
    await host.fill("#create-nickname", "Markets A");
    await host.click("#create-room-btn");
    await host.click("#dismiss-recovery-code-btn");
    roomCode = (await host
      .getByTestId("room-code-display")
      .textContent())!.trim();
    for (let index = 1; index < 4; index++) {
      const page = pages[index]!;
      await page.goto(`${server.origin}/?room=${roomCode}`);
      await page.fill("#join-nickname", `Markets ${index}`);
      await page.click("#join-room-btn");
      await page.click("#dismiss-recovery-code-btn");
    }
    await expect(host.getByTestId("start-game-btn")).toBeEnabled();
    await host.click("#start-game-btn");
    for (const page of pages) {
      await page.locator('[data-testid^="objective-card-"]').first().click();
      await page.getByTestId("confirm-objective-btn").click();
    }
    await expect(host.getByTestId("round-start-view")).toBeVisible();
    await host.getByTestId("begin-round-btn").click();
    // All investors plan privately before their spotlights. No authoritative mutations.
    const views = await Promise.all(pages.map(read));
    expect(new Set(views.map((view) => view.revision)).size).toBe(1);
    for (let index = 0; index < 4; index++) {
      const page = pages[index]!;
      await expect(
        page.getByLabel("Growth Fund amount", { exact: true }),
      ).toBeVisible();
      await page.getByLabel("Growth Fund amount", { exact: true }).fill("100");
      await page.getByRole("button", { name: "Preview market trades" }).click();
      await expect(page.getByTestId("market-trade-preview")).toContainText(
        "$0.25",
      );
      await expect(
        page.getByRole("button", {
          name: "Confirm trades and finish spotlight",
        }),
      ).toBeEnabled();
      if (index === 3) {
        const widths = await page.evaluate(() => ({
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        expect(widths.scroll).toBeLessThanOrEqual(widths.client);
        await test.info().attach("market-preview-320px", {
          body: await page.screenshot({
            path: test.info().outputPath("market-preview-320px.png"),
            fullPage: true,
          }),
          contentType: "image/png",
        });
      }
      await page
        .getByRole("button", { name: "Confirm trades and finish spotlight" })
        .click();
      await expect
        .poll(async () => (await read(page)).revision)
        .toBe(views[0]!.revision + index + 1);
    }
    const q2 = await read(host);
    expect(q2.currentQuarter).toBe(2);
    expect(q2.round?.stage).toBe("round-start");
    for (const page of pages) {
      const own = (await read(page)).self.financialDetails.publicMarkets.find(
        (fund) => fund.id === "growth-fund",
      )!;
      expect(own.valueCents).toBeGreaterThan(0);
      expect(own.basisCents).toBe(10025);
    }
    await host.getByTestId("begin-round-btn").click();
    const trader = pages[1]!;
    const before = await read(trader);
    await trader
      .getByLabel("Growth Fund action", { exact: true })
      .selectOption("sell");
    await trader.getByLabel("Growth Fund amount", { exact: true }).fill("50");
    await trader
      .getByLabel("Income / Defensive Fund amount", { exact: true })
      .fill("40");
    const previewResponse = trader.waitForResponse((response) =>
      response.url().endsWith("/public-market-preview"),
    );
    await trader.getByRole("button", { name: "Preview market trades" }).click();
    const preview = (await (await previewResponse).json()).preview;
    expect(preview.totalFeesCents).toBe(23);
    expect(preview.cashImpactCents).toBe(977);
    expect(preview.resultingCashCents).toBe(before.self.cashCents + 977);
    await trader
      .getByRole("button", { name: "Confirm trades and finish spotlight" })
      .click();
    await expect
      .poll(async () => (await read(trader)).revision)
      .toBe(before.revision + 1);
    const after = await read(trader);
    expect(after.self.cashCents).toBe(preview.resultingCashCents);
    for (const leg of preview.trades) {
      expect(
        after.self.financialDetails.publicMarkets.find(
          (fund) => fund.id === leg.instrumentId,
        ),
      ).toMatchObject({
        valueCents: leg.resultingValueCents,
        basisCents: leg.resultingBasisCents,
      });
    }
    const other = await read(host);
    expect(
      other.players.every(
        (player) => !Object.hasOwn(player, "financialDetails"),
      ),
    ).toBe(true);
    await trader.reload();
    await expect(trader.getByTestId("public-markets-panel")).toBeVisible();
    expect((await read(trader)).self.financialDetails.publicMarkets).toEqual(
      after.self.financialDetails.publicMarkets,
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.cleanup();
  }
});
