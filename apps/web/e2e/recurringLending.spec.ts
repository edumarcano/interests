import type { MarketLoanQuoteView, MatchPlayerView } from "@interests/shared";
import { expect, type Page, test } from "@playwright/test";
import { startTestServer } from "./support/serverHarness";

test("four ordinary clients can fund a private market loan and recover its first payment after restart", async ({
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
  async function view(page: Page): Promise<MatchPlayerView> {
    const response = await page.request.get(
      `${server.origin}/api/rooms/${roomCode}/match`,
    );
    expect(response.ok()).toBe(true);
    return (await response.json()).match;
  }

  async function currentSpotlight(): Promise<{
    page: Page;
    before: MatchPlayerView;
  }> {
    let common = await view(host);
    if (common.round?.stage === "round-start") {
      await host.getByTestId("begin-round-btn").click();
      await expect
        .poll(async () => (await view(host)).round?.stage)
        .toBe("spotlight");
      common = await view(host);
    }
    const seats = await Promise.all(pages.map(view));
    const index = seats.findIndex(
      (seat) => seat.self.playerId === common.round?.activeSpotlightPlayerId,
    );
    if (index < 0) throw new Error("Missing active seat");
    return { page: pages[index]!, before: seats[index]! };
  }

  async function pass(page: Page, revision: number) {
    await page.getByTestId("pass-spotlight-btn").click();
    await expect
      .poll(async () => (await view(host)).revision)
      .toBe(revision + 1);
  }

  try {
    await host.goto(server.origin);
    await host.fill("#create-nickname", "Lending Host");
    await host.click("#create-room-btn");
    await host.click("#dismiss-recovery-code-btn");
    roomCode = (await host
      .getByTestId("room-code-display")
      .textContent())!.trim();
    for (const [index, page] of pages.entries()) {
      if (page === host) continue;
      await page.goto(`${server.origin}/?room=${roomCode}`);
      await page.fill("#join-nickname", `Lending Guest ${index}`);
      await page.click("#join-room-btn");
      await page.click("#dismiss-recovery-code-btn");
    }
    await host.getByTestId("start-game-btn").click();
    for (const page of pages) {
      await page.locator('[data-testid^="objective-card-"]').first().click();
      await page.getByTestId("confirm-objective-btn").click();
    }
    for (const page of pages) {
      await page
        .getByLabel("Focus for future opportunities")
        .selectOption("financing");
      await page.getByTestId("set-focus-btn").click();
      await expect
        .poll(async () => (await view(page)).self.financialDetails.focus)
        .toBe("financing");
    }
    let funded:
      | { lender: Page; quote: MarketLoanQuoteView; loanId: string }
      | undefined;
    for (let turns = 0; turns < 48; turns++) {
      const { page, before } = await currentSpotlight();
      const card = before.self.recurringOpportunity;
      const quote = card?.marketLoanQuote;
      if (!quote?.canFund || before.round?.spotlightsCompleted === 3) {
        await pass(page, before.revision);
        continue;
      }
      expect(card).not.toHaveProperty("npcFundingTerms");
      expect(quote).not.toHaveProperty("quarterlyRepaymentCapacityCents");
      const button = page.getByRole("button", { name: /^Fund \$.* loan$/ });
      await expect(button).toBeEnabled();
      await expect(
        page.getByTestId("recurring-opportunity-panel"),
      ).toContainText("Interest if paid on schedule");
      await button.click();
      await expect
        .poll(async () => (await view(page)).revision)
        .toBe(before.revision + 1);
      const after = await view(page);
      expect(after.self.availableCashCents).toBe(
        before.self.availableCashCents - quote.principalCents,
      );
      expect(after.self.recurringOpportunity?.status).toBe("funded");
      const loan = after.self.loans?.find((item) => item.kind === "npc-loan");
      expect(loan).toMatchObject({
        role: "lender",
        counterpartyNickname: quote.borrowerName,
        originalPrincipalCents: quote.principalCents,
        annualRateBps: quote.annualRateBps,
      });
      expect(loan).toBeDefined();
      funded = { lender: page, quote, loanId: loan!.id };
      for (const rival of pages.filter((seat) => seat !== page)) {
        const rivalView = await view(rival);
        expect(rivalView.self.recurringOpportunity?.id).not.toBe(card?.id);
        expect(rivalView.self.loans?.some((item) => item.id === loan!.id)).toBe(
          false,
        );
      }
      break;
    }
    if (!funded)
      throw new Error(
        "No ordinary fundable market loan through quarter twelve",
      );
    const { lender, quote, loanId } = funded;
    while ((await view(host)).currentQuarter <= quote.firstDueQuarter) {
      const { page, before } = await currentSpotlight();
      await pass(page, before.revision);
    }
    const paid = await view(lender);
    const loan = paid.self.loans!.find((item) => item.id === loanId)!;
    expect(loan.outstandingPrincipalCents).toBeLessThan(quote.principalCents);
    await expect(lender.getByTestId(`loan-${loanId}`)).toContainText(
      quote.borrowerName,
    );
    await server.restart();
    await Promise.all(pages.map((page) => page.reload()));
    await expect(host.getByTestId("resume-match-btn")).toBeEnabled();
    const restored = await view(lender);
    expect(restored.revision).toBe(paid.revision);
    expect(restored.self.loans).toEqual(paid.self.loans);
    expect(restored.self.financialDetails).toEqual(paid.self.financialDetails);
    await host.getByTestId("resume-match-btn").click();
    await expect(lender.getByTestId(`loan-${loanId}`)).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.cleanup();
  }
});
