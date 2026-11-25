import type { MatchPlayerView } from "@interests/shared";
import { expect, type Page, test } from "@playwright/test";
import { startTestServer } from "./support/serverHarness";

test("ordinary four-client co-purchase funds a bank mortgage and reaches unanimous joint property sale", async ({
  browser,
}) => {
  test.setTimeout(100_000);
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
    await host.fill("#create-nickname", "Purchase Host");
    await host.click("#create-room-btn");
    await host.click("#dismiss-recovery-code-btn");
    const code = (await host
      .getByTestId("room-code-display")
      .textContent())!.trim();
    for (let n = 1; n < 4; n++) {
      const page = pages[n]!;
      await page.goto(`${server.origin}/?room=${code}`);
      await page.fill("#join-nickname", `Buyer ${n}`);
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
    const initial = await Promise.all(pages.map(view));
    let leadIndex = -1,
      partnerIndex = -1,
      leadCash = 0,
      partnerCash = 0;
    for (let turn = 0; turn < 4; turn++) {
      const current = await Promise.all(pages.map(view));
      const index = current.findIndex(
        (value) => value.self.playerId === value.round?.activeSpotlightPlayerId,
      );
      const own = current[index]!,
        quote = own.self.propertyOffers![0]!.quotes[1]!;
      const contribution = Math.min(
        1_000_000,
        own.self.cashCents - quote.personalReserveCents,
      );
      const partner = current.findIndex(
        (value, candidate) =>
          candidate !== index &&
          value.self.cashCents >= quote.cashRequiredCents - contribution,
      );
      if (contribution > 0 && partner >= 0) {
        leadIndex = index;
        partnerIndex = partner;
        leadCash = contribution;
        partnerCash = quote.cashRequiredCents - contribution;
        break;
      }
      await pages[index]!.getByTestId("pass-spotlight-btn").click();
    }
    expect(leadIndex).toBeGreaterThanOrEqual(0);
    const lead = pages[leadIndex]!,
      partner = pages[partnerIndex]!;
    const leadName = leadIndex ? `Buyer ${leadIndex}` : "Purchase Host",
      partnerName = partnerIndex ? `Buyer ${partnerIndex}` : "Purchase Host";
    const panel = lead.getByTestId("property-acquisition-panel");
    await panel
      .getByRole("button", { name: "Draft shared purchase", exact: true })
      .click();
    await panel.getByLabel("Shared purchase financing").selectOption("1");
    await panel.getByLabel(`Include ${partnerName}`, { exact: true }).check();
    await panel
      .getByLabel(`${leadName} cash contribution ($)`, { exact: true })
      .fill(String(leadCash / 100));
    await panel
      .getByLabel(`${partnerName} cash contribution ($)`, { exact: true })
      .fill(String(partnerCash / 100));
    await panel
      .getByLabel(`${leadName} ownership (%)`, { exact: true })
      .fill("60");
    await panel
      .getByLabel(`${partnerName} ownership (%)`, { exact: true })
      .fill("40");
    expect(
      await lead.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await panel
      .getByRole("button", {
        name: "Propose shared property purchase",
        exact: true,
      })
      .click();
    await expect(panel).toContainText("Asset mortgage");
    await expect(panel).toContainText("receives 60% ownership");
    const outsider = pages.find(
      (_, index) => index !== leadIndex && index !== partnerIndex,
    )!;
    expect((await view(outsider)).propertyAcquisition).toBeNull();
    expect((await view(outsider)).hasActiveTransaction).toBe(true);
    await expect(
      outsider.getByTestId("property-acquisition-panel"),
    ).toHaveCount(0);
    await panel
      .getByRole("button", {
        name: "Confirm exact purchase terms",
        exact: true,
      })
      .click();
    await expect(
      panel.getByRole("button", {
        name: "Close shared property purchase",
        exact: true,
      }),
    ).toBeDisabled();
    const frozen = (await view(lead)).propertyAcquisition!;
    await server.restart();
    for (const page of pages) await page.reload();
    await host.getByTestId("resume-match-btn").click();
    expect((await view(lead)).propertyAcquisition).toEqual(frozen);
    await partner
      .getByTestId("property-acquisition-panel")
      .getByRole("button", {
        name: "Confirm exact purchase terms",
        exact: true,
      })
      .click();
    await expect(
      panel.getByRole("button", {
        name: "Close shared property purchase",
        exact: true,
      }),
    ).toBeEnabled();
    await panel
      .getByRole("button", {
        name: "Close shared property purchase",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await view(lead)).propertyAcquisition)
      .toBeNull();
    const bought = await view(lead),
      boughtPartner = await view(partner);
    expect(bought.self.cashCents).toBe(
      initial[leadIndex]!.self.cashCents - leadCash,
    );
    expect(boughtPartner.self.cashCents).toBe(
      initial[partnerIndex]!.self.cashCents - partnerCash,
    );
    const property = bought.self.financialDetails.properties.find(
      (property) => property.ownershipPpm === 600_000,
    )!;
    expect(property).toBeDefined();
    expect(
      boughtPartner.self.financialDetails.properties.find(
        (item) => item.id === property.id,
      )!.ownershipPpm,
    ).toBe(400_000);
    const loan = bought.self.loans!.find(
      (loan) =>
        loan.kind === "asset-bank-loan" &&
        loan.originalPrincipalCents === frozen.quote.principalCents,
    )!;
    expect(loan).toBeDefined();
    expect(loan.role).toBe("asset-borrower");
    let saleLead = lead,
      salePartner = partner;
    for (let n = 0; n < 9; n++) {
      const current = await Promise.all(pages.map(view));
      if (current[0]!.round?.stage === "round-start") {
        await host.getByTestId("begin-round-btn").click();
        continue;
      }
      const index = current.findIndex(
        (value) => value.self.playerId === value.round?.activeSpotlightPlayerId,
      );
      if (
        (index === leadIndex || index === partnerIndex) &&
        current[index]!.round!.spotlightsCompleted < 3
      ) {
        saleLead = pages[index]!;
        salePartner = index === leadIndex ? partner : lead;
        break;
      }
      await pages[index]!.getByTestId("pass-spotlight-btn").click();
    }
    await saleLead
      .getByRole("button", { name: "Propose joint sale", exact: true })
      .click();
    const sale = saleLead.getByTestId("joint-property-panel");
    await sale
      .getByRole("button", {
        name: "Confirm exact property terms",
        exact: true,
      })
      .click();
    const saleLeadView = await view(saleLead);
    const saleLeadName = saleLeadView.players.find(
      (player) => player.playerId === saleLeadView.self.playerId,
    )!.nickname;
    const saleLeadStake = saleLead === lead ? 60 : 40;
    await expect(salePartner.getByTestId("joint-property-panel")).toContainText(
      `${saleLeadName} (${saleLeadStake}%): confirmed`,
    );
    await salePartner
      .getByTestId("joint-property-panel")
      .getByRole("button", {
        name: "Confirm exact property terms",
        exact: true,
      })
      .click();
    await expect(
      sale.getByRole("button", {
        name: "Close shared property agreement",
        exact: true,
      }),
    ).toBeEnabled();
    const beforeSale = await view(saleLead),
      beforePartnerSale = await view(salePartner),
      quote = beforeSale.jointProperty!.quote;
    if (quote.kind !== "sale") throw new Error("Expected sale");
    await saleLead.screenshot({
      path: "test-results/shared-property-acquisition-320.png",
      fullPage: true,
    });
    await sale
      .getByRole("button", {
        name: "Close shared property agreement",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await view(saleLead)).jointProperty)
      .toBeNull();
    expect((await view(saleLead)).self.cashCents).toBe(
      beforeSale.self.cashCents +
        quote.proceedsByPlayer[beforeSale.self.playerId]!,
    );
    expect((await view(salePartner)).self.cashCents).toBe(
      beforePartnerSale.self.cashCents +
        quote.proceedsByPlayer[beforePartnerSale.self.playerId]!,
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.cleanup();
  }
});
