import type { MatchPlayerView } from "@interests/shared";
import { expect, type Page, test } from "@playwright/test";
import { startTestServer } from "./support/serverHarness";

test("ordinary four-client mortgage review, cancellation, funded close and narrow layout", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const server = await startTestServer();
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () =>
      browser.newContext({ viewport: { width: 320, height: 680 } }),
    ),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    const host = pages[0]!;
    await host.goto(server.origin);
    await host.fill("#create-nickname", "Property host");
    await host.click("#create-room-btn");
    await host.click("#dismiss-recovery-code-btn");
    const code = (await host
      .getByTestId("room-code-display")
      .textContent())!.trim();
    for (let i = 1; i < 4; i++) {
      const page = pages[i]!;
      await page.goto(`${server.origin}/?room=${code}`);
      await page.fill("#join-nickname", `Property player ${i}`);
      await page.click("#join-room-btn");
      await page.click("#dismiss-recovery-code-btn");
    }
    await expect(host.getByTestId("start-game-btn")).toBeEnabled();
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
    let buyer: Page | undefined;
    for (let quarter = 0; quarter < 8 && !buyer; quarter++) {
      await expect(host.getByTestId("begin-round-btn")).toBeEnabled();
      await host.getByTestId("begin-round-btn").click();
      for (let turn = 0; turn < 4; turn++) {
        const views = await Promise.all(pages.map(view));
        const activeIndex = views.findIndex(
          (state) =>
            state.self.playerId === state.round!.activeSpotlightPlayerId,
        );
        const page = pages[activeIndex]!;
        const state = views[activeIndex]!;
        await expect(page.getByTestId("property-panel")).toBeVisible();
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        );
        expect(overflow).toBe(false);
        const affordable = state.self.propertyOffers![0]!.quotes.find(
          (quote) => quote.principalCents > 0 && quote.canClose,
        );
        if (affordable) {
          const card = page
            .getByTestId("property-panel")
            .locator("article")
            .filter({
              has: page.getByRole("heading", {
                name: "Residential duplex",
                exact: true,
              }),
            });
          await card.locator("summary").click();
          await card
            .getByRole("button", {
              name: `Review ${affordable.rateKind} purchase`,
              exact: true,
            })
            .click();
          await expect(
            page.getByRole("region", { name: "Review property action" }),
          ).toContainText("first payment next quarter");
          const revision = state.revision;
          await page
            .getByRole("button", { name: "Cancel review", exact: true })
            .click();
          expect((await view(page)).revision).toBe(revision);
          await card
            .getByRole("button", {
              name: `Review ${affordable.rateKind} purchase`,
              exact: true,
            })
            .click();
          await page
            .getByRole("button", {
              name: "Confirm property action",
              exact: true,
            })
            .click();
          await expect
            .poll(async () => (await view(page)).revision)
            .toBe(revision + 1);
          const after = await view(page);
          expect(after.self.propertyManagement).toHaveLength(
            (state.self.propertyManagement?.length ?? 0) + 1,
          );
          expect(
            after.self.loans!.filter((loan) => loan.kind === "asset-bank-loan"),
          ).toHaveLength(1);
          await expect(page.getByTestId("property-panel")).toContainText(
            "Owned property",
          );
          await page.screenshot({
            path: "test-results/property-bank-320.png",
            fullPage: true,
          });
          buyer = page;
          break;
        }
        await page.getByTestId("pass-spotlight-btn").click();
        await expect
          .poll(async () => (await view(page)).revision)
          .toBe(state.revision + 1);
      }
    }
    expect(
      buyer,
      "An ordinary player accumulates enough funds for the stable property quote",
    ).toBeDefined();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.cleanup();
  }
});
