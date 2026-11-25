import type { MatchPlayerView } from "@interests/shared";
import { expect, type Page, test } from "@playwright/test";
import { startTestServer } from "./support/serverHarness";

for (const route of ["bank-equity", "bank-player-loan"] as const) {
  test(`four seats close ${route} after a held cash agreement and restart`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const server = await startTestServer({
      ordinarySeed: "m7-shared-recurring-64",
    });
    const contexts = await Promise.all(
      Array.from({ length: 4 }, () =>
        browser.newContext({ viewport: { width: 390, height: 800 } }),
      ),
    );
    const pages = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    const [host, rival, partner] = pages as [Page, Page, Page, Page];
    try {
      await host.goto(server.origin);
      await host.fill("#create-nickname", "Lead");
      await host.click("#create-room-btn");
      await host.click("#dismiss-recovery-code-btn");
      const code = (await host
        .getByTestId("room-code-display")
        .textContent())!.trim();
      for (const [index, page] of pages.entries()) {
        if (!index) continue;
        await page.goto(`${server.origin}/?room=${code}`);
        await page.fill("#join-nickname", `Seat ${index + 1}`);
        await page.click("#join-room-btn");
        await page.click("#dismiss-recovery-code-btn");
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
      await host.getByTestId("begin-round-btn").click();
      await expect
        .poll(
          async () => (await view(host)).self.recurringOpportunity?.templateId,
        )
        .toBe("local-service-company");
      await host.getByTestId("preview-recurring-acquisition").click();
      await expect(host.getByTestId("review-recurring-cash")).toBeDisabled();
      await host
        .getByText("Propose a shared purchase", { exact: true })
        .click();
      await host
        .getByRole("combobox", { name: "Partner", exact: true })
        .selectOption({ label: "Seat 3" }, { timeout: 8000 });
      await host
        .getByRole("combobox", { name: "Purchase funding", exact: true })
        .selectOption({ label: "Fixed bank finance" }, { timeout: 8000 });
      await host
        .getByRole("textbox", {
          name: "Your cash contribution ($)",
          exact: true,
        })
        .fill("1000", { timeout: 8000 });
      if (route === "bank-player-loan") {
        await host
          .getByRole("combobox", { name: "Partner funding", exact: true })
          .selectOption({ label: "Fixed player loan" });
        await host
          .getByRole("textbox", { name: "Fixed APR (%)", exact: true })
          .fill("6.12");
        await host
          .getByRole("combobox", {
            name: "Repayment term (quarters)",
            exact: true,
          })
          .selectOption("5");
      } else {
        await host
          .getByRole("textbox", { name: "Partner ownership (%)", exact: true })
          .fill("60", { timeout: 8000 });
      }
      await host.getByRole("button", { name: "Invite partner" }).click();
      const hostPanel = host.getByRole("region", {
        name: "Shared opportunity purchase",
      });
      const partnerPanel = partner.getByRole("region", {
        name: "Shared opportunity purchase",
      });
      await expect(
        host.getByRole("button", { name: /^Investigate/ }),
      ).toBeDisabled();
      await expect(partnerPanel).toContainText(
        "Shared purchase of Local service company",
      );
      if (route === "bank-player-loan") {
        await expect(partnerPanel).toContainText("6.12% fixed APR");
        await expect(partnerPanel).toContainText("Installments");
        await expect(partnerPanel).toContainText("Fixed bank finance funds");
      }
      expect((await view(rival)).sharedRecurringAcquisition).toBeNull();
      expect(
        (await view(partner)).sharedRecurringAcquisition?.quote,
      ).not.toHaveProperty("personalReserveCents");
      await hostPanel
        .getByRole("button", { name: "Confirm shared purchase", exact: true })
        .click();
      await expect(
        hostPanel.getByRole("button", {
          name: "Close shared purchase",
          exact: true,
        }),
      ).toBeDisabled();
      const frozen = (await view(host)).sharedRecurringAcquisition!;
      await server.restart();
      for (const page of pages) await page.reload();
      await host.getByTestId("resume-match-btn").click();
      expect((await view(host)).sharedRecurringAcquisition).toEqual(frozen);
      const before = await Promise.all([view(host), view(partner)]);
      await partnerPanel
        .getByRole("button", { name: "Confirm shared purchase", exact: true })
        .click();
      await hostPanel
        .getByRole("button", { name: "Close shared purchase", exact: true })
        .click();
      await expect(hostPanel).toHaveCount(0);
      const [closedLead, closedPartner] = await Promise.all([
        view(host),
        view(partner),
      ]);
      expect(closedLead.self.cashCents).toBe(
        before[0]!.self.cashCents - 100_000,
      );
      expect(closedPartner.self.cashCents).toBe(
        before[1]!.self.cashCents - (frozen.quote.cashRequiredCents - 100_000),
      );
      expect(closedPartner.self.reservedCashCents).toBe(0);
      if (route === "bank-player-loan") {
        expect(closedPartner.self.loans).toContainEqual(
          expect.objectContaining({
            role: "lender",
            outstandingPrincipalCents: frozen.quote.cashRequiredCents - 100_000,
          }),
        );
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      await server.cleanup();
    }
  });
}
