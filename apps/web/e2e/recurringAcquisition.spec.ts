import type { MatchPlayerView } from "@interests/shared";
import { expect, test } from "@playwright/test";
import { acquireOrdinaryOpportunity } from "./support/ordinaryAcquisition";
import { startTestServer } from "./support/serverHarness";

for (const [kind, route] of [
  ["business", "bank-fixed"],
  ["property", "cash"],
] as const)
  test(`ordinary four-client ${kind} ${route} card acquisition preserves quotes, paid facts and restart ownership`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const server = await startTestServer();
    const contexts = await Promise.all(
      [320, 390, 768, 1280].map((width) =>
        browser.newContext({ viewport: { width, height: 800 } }),
      ),
    );
    const pages = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    try {
      const host = pages[0]!;
      await host.goto(server.origin);
      await host.fill("#create-nickname", "Acquisition Host");
      await host.click("#create-room-btn");
      await host.click("#dismiss-recovery-code-btn");
      const code = (await host
        .getByTestId("room-code-display")
        .textContent())!.trim();
      for (let i = 1; i < 4; i++) {
        const page = pages[i]!;
        await page.goto(`${server.origin}/?room=${code}`);
        await page.fill("#join-nickname", `Acquisition Guest ${i}`);
        await page.click("#join-room-btn");
        await page.click("#dismiss-recovery-code-btn");
      }
      await host.getByTestId("start-game-btn").click();
      for (const page of pages) {
        await page.locator('[data-testid^="objective-card-"]').first().click();
        await page.getByTestId("confirm-objective-btn").click();
      }
      for (const page of pages)
        await expect(
          page.getByTestId("recurring-opportunity-panel"),
        ).toBeVisible();
      const bought = await acquireOrdinaryOpportunity(
        pages,
        server.origin,
        code,
        kind,
        route,
      );
      expect(bought.after.revision).toBe(bought.before.revision + 1);
      const beforeIds = new Set(
        kind === "business"
          ? bought.before.self.ownedAssets!.map((asset) => asset.id)
          : bought.before.self.financialDetails.properties.map(
              (asset) => asset.id,
            ),
      );
      const newIds =
        kind === "business"
          ? bought.after.self
              .ownedAssets!.map((asset) => asset.id)
              .filter((id) => !beforeIds.has(id))
          : bought.after.self.financialDetails.properties
              .map((asset) => asset.id)
              .filter((id) => !beforeIds.has(id));
      expect(newIds).toHaveLength(1);
      const assetId = newIds[0]!;
      expect(bought.before.self.recurringOpportunity!.facts?.kind).toBe(kind);
      if (route === "bank-fixed")
        expect(
          bought.after.self.loans!.find(
            (loan) =>
              loan.role === "asset-borrower" &&
              loan.originalPrincipalCents === bought.quote.principalCents,
          ),
        ).toMatchObject({
          annualRateBps: bought.quote.annualRateBps,
          scheduledQuarterlyPaymentCents: bought.quote.quarterlyPaymentCents,
        });
      for (const page of pages)
        if (page !== bought.page) {
          const view: MatchPlayerView = (
            await (
              await page.request.get(`${server.origin}/api/rooms/${code}/match`)
            ).json()
          ).match;
          expect(JSON.stringify(view.self)).not.toContain(assetId);
          expect(
            view.players.find(
              (player) => player.playerId === bought.after.self.playerId,
            )?.publicPosition?.assets,
          ).toContainEqual({
            assetId,
            kind,
            ownershipPpm: 1_000_000,
            partnerIds: [],
          });
        }
      const size = await bought.page.evaluate(() => [
        document.documentElement.clientWidth,
        document.documentElement.scrollWidth,
      ]);
      expect(size[1]).toBeLessThanOrEqual(size[0]!);
      await bought.page.screenshot({
        path: test.info().outputPath(`ordinary-${kind}-${route}.png`),
        fullPage: true,
      });
      await server.restart();
      for (const page of pages) await page.reload();
      await expect(host.getByTestId("resume-match-btn")).toBeEnabled();
      await host.getByTestId("resume-match-btn").click();
      const restored: MatchPlayerView = (
        await (
          await bought.page.request.get(
            `${server.origin}/api/rooms/${code}/match`,
          )
        ).json()
      ).match;
      expect(restored.self.financialDetails).toEqual(
        bought.after.self.financialDetails,
      );
      expect(restored.self.loans).toEqual(bought.after.self.loans);
      expect(restored.revision).toBe(bought.after.revision);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      await server.cleanup();
    }
  });
