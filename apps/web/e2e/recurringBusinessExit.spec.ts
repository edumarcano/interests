import type { MatchPlayerView } from "@interests/shared";
import { expect, type Page, test } from "@playwright/test";
import { acquireOrdinaryOpportunity } from "./support/ordinaryAcquisition";
import { startTestServer } from "./support/serverHarness";

test("ordinary four-client seasoned company receives a private fixed buyer and exits after review and restart", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const server = await startTestServer(),
    contexts = await Promise.all(
      [320, 390, 768, 1280].map((width) =>
        browser.newContext({ viewport: { width, height: 800 } }),
      ),
    );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    const host = pages[0]!;
    await host.goto(server.origin);
    await host.fill("#create-nickname", "Exit Host");
    await host.click("#create-room-btn");
    await host.click("#dismiss-recovery-code-btn");
    const code = (await host
      .getByTestId("room-code-display")
      .textContent())!.trim();
    for (let i = 1; i < 4; i++) {
      await pages[i]!.goto(`${server.origin}/?room=${code}`);
      await pages[i]!.fill("#join-nickname", `Exit Guest ${i}`);
      await pages[i]!.click("#join-room-btn");
      await pages[i]!.click("#dismiss-recovery-code-btn");
    }
    await host.getByTestId("start-game-btn").click();
    for (const page of pages) {
      await page.locator('[data-testid^="objective-card-"]').first().click();
      await page.getByTestId("confirm-objective-btn").click();
    }
    async function view(page: Page): Promise<MatchPlayerView> {
      const response = await page.request.get(
        `${server.origin}/api/rooms/${code}/match`,
      );
      expect(response.ok()).toBe(true);
      return (await response.json()).match;
    }
    let views = await Promise.all(pages.map(view));
    if (views.every((own) => !own.self.ownedAssets?.length))
      await acquireOrdinaryOpportunity(
        pages,
        server.origin,
        code,
        "business",
        "bank-fixed",
      );
    for (const page of pages) {
      await page
        .getByLabel("Focus for future opportunities")
        .selectOption("business");
      const apply = page.getByTestId("set-focus-btn");
      if (await apply.isEnabled()) {
        await apply.click();
        await expect
          .poll(async () => (await view(page)).self.financialDetails.focus)
          .toBe("business");
      }
    }
    let seller: Page | undefined, before: MatchPlayerView | undefined;
    for (let turn = 0; turn < 120; turn++) {
      views = await Promise.all(pages.map(view));
      const common = views[0]!;
      if (common.currentQuarter > 30) break;
      if (common.round?.stage === "round-start") {
        await host.getByTestId("begin-round-btn").click();
        await expect
          .poll(async () => (await view(host)).round?.stage)
          .toBe("spotlight");
        continue;
      }
      const index = views.findIndex(
          (own) => own.self.playerId === common.round!.activeSpotlightPlayerId,
        ),
        page = pages[index]!,
        own = views[index]!;
      if (own.self.recurringOpportunity?.businessExitQuote) {
        seller = page;
        before = own;
        break;
      }
      await page.getByTestId("pass-spotlight-btn").click();
      await expect
        .poll(async () => (await view(page)).revision)
        .toBeGreaterThan(own.revision);
    }
    expect(seller).toBeDefined();
    if (!seller || !before) throw new Error("No ordinary matched buyer");
    expect(before.currentQuarter).toBeGreaterThan(1);
    await seller.setViewportSize({ width: 320, height: 800 });
    const card = before.self.recurringOpportunity!,
      quote = card.businessExitQuote!,
      panel = seller.getByTestId("recurring-business-exit-panel");
    for (const page of pages)
      if (page !== seller) {
        const rival = await view(page);
        expect(JSON.stringify(rival.self)).not.toContain(quote.assetId);
        expect(
          rival.players.find(
            (player) => player.playerId === before.self.playerId,
          )?.publicPosition?.assets,
        ).toContainEqual({
          assetId: quote.assetId,
          kind: "business",
          ownershipPpm: 1_000_000,
          partnerIds: [],
        });
        expect(JSON.stringify(rival)).not.toContain(card.id);
        await expect(
          page.getByTestId("recurring-business-exit-panel"),
        ).toHaveCount(0);
      }
    await panel
      .getByRole("button", {
        name: "Review matched business sale",
        exact: true,
      })
      .click();
    await expect(
      panel.getByRole("region", { name: "Review matched business sale" }),
    ).toBeVisible();
    await expect(panel).toContainText("Gross buyer consideration");
    await expect(panel).toContainText("exact bank payoff");
    await expect(panel).toContainText("Your net sale proceeds");
    await panel
      .getByRole("button", { name: "Cancel business sale review", exact: true })
      .click();
    expect((await view(seller)).self.cashCents).toBe(before.self.cashCents);
    expect((await view(seller)).revision).toBe(before.revision);
    await server.restart();
    for (const page of pages) await page.reload();
    await host.getByTestId("resume-match-btn").click();
    const restored = await view(seller),
      restoredQuote = restored.self.recurringOpportunity!.businessExitQuote!;
    expect(restoredQuote.operatingEnterpriseBidCents).toBe(
      quote.operatingEnterpriseBidCents,
    );
    expect(restoredQuote.sellerNetCents).toBe(quote.sellerNetCents);
    await panel
      .getByRole("button", {
        name: "Review matched business sale",
        exact: true,
      })
      .click();
    expect(
      await seller.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await seller.screenshot({
      path: test.info().outputPath("ordinary-business-exit.png"),
      fullPage: true,
    });
    await panel
      .getByRole("button", {
        name: "Confirm matched business sale",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await view(seller)).revision)
      .toBe(restored.revision + 1);
    const after = await view(seller);
    expect(
      after.self.ownedAssets!.some((asset) => asset.id === quote.assetId),
    ).toBe(false);
    if (after.currentQuarter === restored.currentQuarter)
      expect(after.self.cashCents).toBe(
        restored.self.cashCents +
          restoredQuote.sellerNetCents +
          restoredQuote.workArrearsPaidCents,
      );
    else {
      expect(after.currentQuarter).toBe(restored.currentQuarter + 1);
      expect(after.self.cashCents).toBeGreaterThan(restored.self.cashCents);
    }
    await seller.reload();
    expect((await view(seller)).self.ownedAssets).toEqual(
      after.self.ownedAssets,
    );
    expect((await view(seller)).self.loans).toEqual(after.self.loans);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.cleanup();
  }
});
