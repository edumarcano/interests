import type { MatchPlayerView } from "@interests/shared";
import { expect, type Page, test } from "@playwright/test";
import { startTestServer } from "./support/serverHarness";

for (const financed of [false, true]) {
  test(
    financed
      ? "a buyer selects one of two private offers and the chosen loan survives restart"
      : "a private stake sale survives process restart and closes at the confirmed price",
    async ({ browser }) => {
      test.setTimeout(90_000);
      const server = await startTestServer();
      const contexts = await Promise.all(
        Array.from({ length: 4 }, () =>
          browser.newContext({ viewport: { width: 320, height: 680 } }),
        ),
      );
      for (const context of contexts) context.setDefaultTimeout(10_000);
      const pages = await Promise.all(
        contexts.map((context) => context.newPage()),
      );
      try {
        const [host, ...guests] = pages;
        if (!host) throw new Error("Missing host");
        await host.goto(server.origin);
        await host.locator("#create-nickname").fill("Capital Host");
        await host.locator("#create-room-btn").click();
        await host.locator("#dismiss-recovery-code-btn").click();
        const code = (
          await host.getByTestId("room-code-display").textContent()
        )?.trim();
        for (const [index, page] of guests.entries()) {
          await page.goto(`${server.origin}/?room=${code}`);
          await page
            .locator("#join-nickname")
            .fill(`Capital Guest ${index + 1}`);
          await page.locator("#join-room-btn").click();
          await page.locator("#dismiss-recovery-code-btn").click();
        }
        await host.getByTestId("start-game-btn").click();
        for (const page of pages) {
          await page
            .locator('[data-testid^="objective-card-"]')
            .first()
            .click();
          await page.getByTestId("confirm-objective-btn").click();
        }
        async function view(page: Page): Promise<MatchPlayerView> {
          const response = await page.request.get(
            `${server.origin}/api/rooms/${code}/match`,
          );
          expect(response.ok()).toBe(true);
          return (await response.json()).match;
        }
        const clients = await Promise.all(
          pages.map(async (page) => ({ page, view: await view(page) })),
        );
        const seller = clients.find((client) =>
          client.view.self.ownedAssets?.some(
            (asset) => asset.ownershipPpm === 1_000_000,
          ),
        );
        if (!seller) throw new Error("Ordinary setup has no business seller");
        const buyer = clients.find((client) => client !== seller);
        const rival = clients.find(
          (client) => client !== seller && client !== buyer,
        );
        const alternative = clients.find(
          (client) => client !== seller && client !== buyer && client !== rival,
        );
        if (!buyer || !rival || !alternative)
          throw new Error("Missing counterparties");
        const buyerId = buyer.view.self.playerId;
        await host.getByTestId("begin-round-btn").click();
        for (const id of (await view(host)).round?.spotlightOrder ?? []) {
          if (id === seller.view.self.playerId) break;
          const active = clients.find(
            (client) => client.view.self.playerId === id,
          );
          if (!active) throw new Error("Missing spotlight player");
          await active.page.getByTestId("pass-spotlight-btn").click();
        }
        const sellerPanel = seller.page.getByRole("region", {
          name: "Business capital",
        });
        const buyerPanel = buyer.page.getByRole("region", {
          name: "Business capital",
        });
        await sellerPanel
          .getByRole("button", { name: "Offer a stake" })
          .first()
          .click();
        await sellerPanel.getByLabel("Sale price ($)").fill("1000");
        await sellerPanel
          .getByLabel("Buyer", { exact: true })
          .selectOption(buyerId);
        await sellerPanel.getByLabel("Company stake (%)").fill("25");
        if (financed) {
          await sellerPanel
            .getByRole("button", { name: "Request a player loan" })
            .click();
          await sellerPanel.getByLabel("Loan 1 principal ($)").fill("500");
        }

        await sellerPanel
          .getByRole("button", { name: "Send business proposal" })
          .click();
        await expect(buyerPanel).toContainText(
          financed ? "$520.00" : "$1,020.00",
        );
        expect((await view(rival.page)).businessCapital).toBeNull();
        if (financed) {
          for (const [lender, rate] of [
            [rival, "7.50"],
            [alternative, "6.25"],
          ] as const) {
            const panel = lender.page.getByRole("region", {
              name: "Business lending",
            });
            await panel.getByLabel("Loan 1 APR (%)").fill(rate);
            await panel.getByRole("button", { name: "Offer loan 1" }).click();
            await expect(panel).toContainText(`${rate}% APR`);
            expect((await view(lender.page)).self.reservedCashCents).toBe(
              50_000,
            );
          }
          const alternativeId = alternative.view.self.playerId;
          const alternativeName = buyer.view.players.find(
            (player) => player.playerId === alternativeId,
          )?.nickname;
          const rivalPanel = rival.page.getByRole("region", {
            name: "Business lending",
          });
          await expect(rivalPanel).not.toContainText("6.25%");
          await buyerPanel
            .getByRole("button", {
              name: `Select ${alternativeName} for loan 1`,
            })
            .click();
          const selectedPanel = alternative.page.getByRole("region", {
            name: "Business lending",
          });
          await expect(selectedPanel).toContainText("Selected by the buyer.");
          await selectedPanel
            .getByRole("button", { name: "Confirm selected financing" })
            .click();
          await expect(sellerPanel).toContainText("1 of 3 confirmed");
        }

        await buyerPanel
          .getByRole("button", { name: "Confirm these terms" })
          .click();
        await expect(sellerPanel).toContainText(
          financed ? "2 of 3 confirmed" : "1 of 2 confirmed",
        );
        await sellerPanel
          .getByRole("button", { name: "Confirm these terms" })
          .click();
        await expect(sellerPanel).toContainText(
          financed ? "3 of 3 confirmed" : "2 of 2 confirmed",
        );
        const reserved = await view(buyer.page);
        expect(reserved.self.reservedCashCents).toBe(
          financed ? 52_000 : 102_000,
        );
        const assetId = reserved.businessCapital?.assetId;
        expect(assetId).toBeTruthy();
        await server.restart();
        for (const page of pages) await page.reload();
        await expect(host.getByTestId("resume-match-btn")).toBeEnabled();
        await host.getByTestId("resume-match-btn").click();
        await expect(
          sellerPanel.getByRole("button", { name: "Close business deal" }),
        ).toBeEnabled();
        const dimensions = await seller.page.evaluate(() => [
          document.documentElement.scrollWidth,
          document.documentElement.clientWidth,
        ]);
        expect(dimensions[0] ?? 0).toBeLessThanOrEqual(dimensions[1] ?? 0);
        await sellerPanel
          .getByRole("button", { name: "Close business deal" })
          .click();
        await expect
          .poll(
            async () =>
              (await view(buyer.page)).self.ownedAssets?.find(
                (asset) => asset.id === assetId,
              )?.ownershipPpm,
          )
          .toBe(250_000);
        expect((await view(buyer.page)).businessCapital).toBeNull();
        expect((await view(buyer.page)).self.reservedCashCents).toBe(0);
        if (financed) {
          expect((await view(rival.page)).self.reservedCashCents).toBe(0);
          expect(
            (await view(rival.page)).self.loans?.some(
              (loan) => loan.kind === "player-loan",
            ),
          ).toBe(false);
          const loans = (await view(buyer.page)).self.loans?.filter(
            (loan) => loan.kind === "player-loan",
          );
          expect(loans).toHaveLength(1);
          expect(loans?.[0]).toMatchObject({
            originalPrincipalCents: 50_000,
            annualRateBps: 625,
          });
        }
      } finally {
        await Promise.allSettled(contexts.map((context) => context.close()));
        await server.cleanup();
      }
    },
  );
}
