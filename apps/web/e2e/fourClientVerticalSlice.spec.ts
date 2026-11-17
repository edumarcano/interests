import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import {
  startTestServer,
  type TestServerHarness,
} from "./support/serverHarness.js";

async function assertNoHorizontalOverflow(page: Page, stageName: string) {
  const overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const scrollW = document.documentElement.scrollWidth;
    return { docWidth, scrollW };
  });
  expect(
    overflow.scrollW,
    `Horizontal overflow detected on 320px viewport at stage "${stageName}": scrollWidth ${overflow.scrollW} > clientWidth ${overflow.docWidth}`,
  ).toBeLessThanOrEqual(overflow.docWidth);
}

test.describe("Four-client financial acceptance", () => {
  let server: TestServerHarness;

  test.beforeAll(async () => {
    server = await startTestServer();
  });

  test.afterAll(async () => {
    if (server) {
      await server.cleanup();
    }
  });

  async function runJourney(browser: Browser, diagnosticDistress: boolean) {
    test.setTimeout(120_000);
    // 1. Create four independent browser contexts with mixed realistic viewports
    const contextA = await browser.newContext({
      viewport: { width: 1280, height: 800 }, // Host desktop
    });
    const contextB = await browser.newContext({
      viewport: { width: 390, height: 844 }, // Mobile 1
    });
    const contextC = await browser.newContext({
      viewport: { width: 390, height: 844 }, // Mobile 2
    });
    const contextD = await browser.newContext({
      viewport: { width: 320, height: 568 }, // Mobile 3: Narrow 320px viewport
    });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const pageC = await contextC.newPage();
    const pageD = await contextD.newPage();

    const pages: Page[] = [pageA, pageB, pageC, pageD];
    const pageByNickname: Record<string, Page> = {
      Alice: pageA,
      Bob: pageB,
      Charlie: pageC,
      Dana: pageD,
    };
    const recoveryCodes: Record<string, string> = {};

    try {
      // 2. Client A creates a room
      await pageA.goto(server.origin);
      await pageA.fill("#create-nickname", "Alice");
      await pageA.click("#create-room-btn");

      // Capture A's recovery code
      await expect(pageA.getByTestId("recovery-code-display")).toBeVisible();
      recoveryCodes.Alice =
        (
          await pageA.getByTestId("recovery-code-display").textContent()
        )?.trim() ?? "";
      expect(recoveryCodes.Alice.length).toBeGreaterThan(0);
      await pageA.click("#dismiss-recovery-code-btn");

      // Verify lobby rendered and extract room code
      await expect(pageA.getByTestId("room-code-display")).toBeVisible();
      const roomCode = (
        await pageA.getByTestId("room-code-display").textContent()
      )?.trim();
      expect(roomCode).toBeTruthy();

      // Verify Share / LAN Join block renders on Host
      await expect(pageA.getByTestId("lobby-share-block")).toBeVisible();
      await expect(pageA.getByTestId("lobby-qr-code")).toBeVisible();
      const joinUrl = await pageA.getByTestId("join-url-input").inputValue();
      expect(joinUrl).toContain(`?room=${roomCode}`);
      // Invariant: no credentials leaked into public join URL or QR
      expect(joinUrl).not.toContain(recoveryCodes.Alice);
      expect(joinUrl).not.toContain("session");

      // 3. Clients B, C, and D join via deep-link
      const guestConfigs = [
        { page: pageB, nickname: "Bob" },
        { page: pageC, nickname: "Charlie" },
        { page: pageD, nickname: "Dana" },
      ];

      for (const { page, nickname } of guestConfigs) {
        await page.goto(`${server.origin}/?room=${roomCode}`);
        // Deep-link should pre-fill room code and select Join tab
        await expect(page.locator("#join-room-code")).toHaveValue(roomCode!);
        await page.fill("#join-nickname", nickname);
        await page.click("#join-room-btn");

        // Capture recovery code
        await expect(page.getByTestId("recovery-code-display")).toBeVisible();
        recoveryCodes[nickname] =
          (
            await page.getByTestId("recovery-code-display").textContent()
          )?.trim() ?? "";
        expect(recoveryCodes[nickname].length).toBeGreaterThan(0);
        await page.click("#dismiss-recovery-code-btn");

        // Verify in lobby
        await expect(page.getByTestId("lobby-view")).toBeVisible();
      }

      // Responsive check on 320px viewport during Lobby
      await assertNoHorizontalOverflow(pageD, "lobby");

      // 4. Verify all 4 occupied seats and synchronized status across all pages
      for (const p of pages) {
        await expect(p.getByTestId("seat-1")).toBeVisible();
        await expect(p.getByTestId("seat-2")).toBeVisible();
        await expect(p.getByTestId("seat-3")).toBeVisible();
        await expect(p.getByTestId("seat-4")).toBeVisible();
      }

      // Host start button should become enabled when all 4 are synchronized
      await expect(pageA.getByTestId("start-game-btn")).toBeEnabled();

      // Non-hosts should see waiting indicator
      await expect(pageB.getByTestId("waiting-for-host-msg")).toBeVisible();

      // 5. Host starts the game
      await pageA.click("#start-game-btn");

      // 6. Each player chooses one of their offered objectives
      for (const p of pages) {
        await expect(p.getByTestId("objective-selection-view")).toBeVisible();
        // Click the first offered objective card
        const firstObjective = p
          .locator('[data-testid^="objective-card-"]')
          .first();
        await firstObjective.click();
        if (p === pageD) {
          // Responsive check on 320px viewport during Objective Selection before confirming
          await assertNoHorizontalOverflow(pageD, "objective-selection");
        }
        await p.click('[data-testid="confirm-objective-btn"]');
      }

      // 7. Verify all clients reach Quarter 1 ROUND_START
      for (const p of pages) {
        await expect(p.getByTestId("round-start-view")).toBeVisible();
        await expect(p.getByTestId("quarter-heading")).toHaveText("Quarter 1");
      }

      // 8. Discover the private opportunity buyer dynamically
      let buyerPage: Page | null = null;
      const nonBuyerPages: Page[] = [];

      for (const p of pages) {
        const count = await p.getByTestId("private-opportunity-card").count();
        if (count > 0) {
          buyerPage = p;
        } else {
          nonBuyerPages.push(p);
        }
      }

      expect(buyerPage).not.toBeNull();
      expect(nonBuyerPages.length).toBe(3);

      // Verify privacy before investigation: non-targets do not see the opportunity card
      for (const nbp of nonBuyerPages) {
        await expect(nbp.getByTestId("private-opportunity-card")).toHaveCount(
          0,
        );
      }

      // Target conducts due diligence during ROUND_START
      await expect(
        buyerPage!.getByTestId("diligence-unrevealed-section"),
      ).toBeVisible();
      await buyerPage!.click('[data-testid="investigate-opportunity-btn"]');
      await expect(
        buyerPage!.getByTestId("diligence-revealed-section"),
      ).toBeVisible();

      // Assert exact canonical due diligence values
      await expect(buyerPage!.getByTestId("fact-annual-revenue")).toHaveText(
        "$80,000",
      );
      await expect(buyerPage!.getByTestId("fact-operating-profit")).toHaveText(
        "$15,000",
      );
      await expect(buyerPage!.getByTestId("fact-enterprise-value")).toHaveText(
        "$60,000",
      );
      await expect(buyerPage!.getByTestId("fact-debt-principal")).toHaveText(
        "$0",
      );

      // Non-targets still do not see opportunity or diligence facts
      for (const nbp of nonBuyerPages) {
        await expect(nbp.getByTestId("private-opportunity-card")).toHaveCount(
          0,
        );
      }

      // 9. Host executes BEGIN_ROUND
      await pageA.click('[data-testid="begin-round-btn"]');

      // Verify all reach Spotlight phase
      for (const p of pages) {
        await expect(p.getByTestId("spotlight-view")).toBeVisible();
      }

      // 10. Pass preceding spotlights until the buyer is active
      for (let step = 0; step < 4; step++) {
        const isBuyerActive =
          (await buyerPage!.getByTestId("pursuit-controls-panel").count()) > 0;
        if (isBuyerActive) {
          break;
        }

        // Find which page currently has the pass button and click it
        let passed = false;
        for (const p of pages) {
          if ((await p.getByTestId("pass-spotlight-btn").count()) > 0) {
            const passBtn = p.getByTestId("pass-spotlight-btn");
            await passBtn.click();
            await expect(passBtn).toHaveCount(0);
            passed = true;
            break;
          }
        }
        if (!passed) break;
      }

      // Buyer must now be active
      await expect(
        buyerPage!.getByTestId("pursuit-controls-panel"),
      ).toBeVisible();

      // 11. Financed acquisition path
      // Identify seller from opportunity card
      const sellerNickname = (
        await buyerPage!.getByTestId("opportunity-seller-name").textContent()
      )?.trim();
      expect(sellerNickname).toBeTruthy();
      const sellerPage = pageByNickname[sellerNickname!];
      expect(sellerPage).toBeDefined();

      const sellerAssetsBefore = await sellerPage
        .locator('[data-testid^="owned-asset-"]')
        .count();
      expect(sellerAssetsBefore).toBeGreaterThanOrEqual(1);

      // Invariant: buyer cash reservation before financing request is $0
      await expect(buyerPage!.getByTestId("self-reserved-cash")).toHaveText(
        "$0",
      );

      // Buyer opens player financing form
      await buyerPage!.click('[data-testid="open-financing-form-btn"]');
      await expect(
        buyerPage!.getByTestId("financing-request-form"),
      ).toBeVisible();

      // Read default contribution from form input (defaults adaptively to min($30,000, available cash))
      const defaultContributionDollars = await buyerPage!
        .locator("#buyer-cash-contribution")
        .inputValue();
      const expectedContribution = Number(defaultContributionDollars);
      expect(expectedContribution).toBeGreaterThan(0);
      const expectedReservedText = "$" + expectedContribution.toLocaleString();

      // Buyer submits financing request
      await buyerPage!.click('[data-testid="submit-financing-request-btn"]');

      // Invariant: buyer cash reservation is updated to reflect reserved contribution
      await expect(buyerPage!.getByTestId("self-reserved-cash")).toHaveText(
        expectedReservedText,
      );

      // Buyer transaction panel shows waiting for lender offer
      await expect(buyerPage!.getByTestId("transaction-panel")).toBeVisible();
      await expect(
        buyerPage!.getByTestId("waiting-for-lender-msg"),
      ).toBeVisible();

      // Non-buyer pages partition into seller and candidates
      const candidatePages = nonBuyerPages.filter((p) => p !== sellerPage);
      expect(candidatePages.length).toBe(2);

      // Seller sees seller-status-section and does NOT see submit-lender-offer-btn
      await expect(
        sellerPage.getByTestId("seller-status-section"),
      ).toBeVisible();
      await expect(
        sellerPage.getByTestId("submit-lender-offer-btn"),
      ).toHaveCount(0);

      // Identify eligible lender vs ineligible candidate using isEnabled()
      let lenderPage: Page | null = null;
      let neutralCandidatePage: Page | null = null;

      for (const p of candidatePages) {
        const offerBtn = p.getByTestId("submit-lender-offer-btn");
        await expect(offerBtn).toBeVisible();
        const canOffer = await offerBtn.isEnabled();
        if (canOffer && !lenderPage) {
          lenderPage = p;
        } else {
          neutralCandidatePage = p;
        }
      }

      expect(lenderPage).not.toBeNull();
      expect(neutralCandidatePage).not.toBeNull();

      // If neutral candidate lacked sufficient cash, verify button was disabled
      const neutralCanOffer = await neutralCandidatePage!
        .getByTestId("submit-lender-offer-btn")
        .isEnabled();
      if (!neutralCanOffer) {
        await expect(
          neutralCandidatePage!.getByTestId("submit-lender-offer-btn"),
        ).toBeDisabled();
      }

      // Responsive check on 320px viewport during Active Transaction
      await assertNoHorizontalOverflow(pageD, "active-transaction");

      // Lender submits valid loan offer
      await lenderPage!.click('[data-testid="submit-lender-offer-btn"]');
      await expect(
        lenderPage!.getByTestId("lender-submitted-section"),
      ).toBeVisible();

      // Invariant: lender cash reservation is updated to reflect reserved loan principal
      await expect(
        lenderPage!.getByTestId("self-reserved-cash"),
      ).not.toHaveText("$0");

      // Neutral candidate now has role "uninvolved" and sees uninvolved-status-section without private loan terms
      await expect(
        neutralCandidatePage!.getByTestId("uninvolved-status-section"),
      ).toBeVisible();
      await expect(
        neutralCandidatePage!.getByTestId("submit-lender-offer-btn"),
      ).toHaveCount(0);
      await expect(
        neutralCandidatePage!.getByTestId("lender-submitted-section"),
      ).toHaveCount(0);
      await expect(
        neutralCandidatePage!.getByTestId("lender-rate-input"),
      ).toHaveCount(0);

      // Buyer sees offer and accepts it
      await expect(buyerPage!.getByTestId("accept-offer-btn")).toBeVisible();
      await buyerPage!.click('[data-testid="accept-offer-btn"]');

      // Buyer completes purchase
      await expect(
        buyerPage!.getByTestId("complete-purchase-btn"),
      ).toBeVisible();
      await buyerPage!.click('[data-testid="complete-purchase-btn"]');

      // After closing:
      // Active transaction panel is cleared
      await expect(buyerPage!.getByTestId("transaction-panel")).toBeHidden();

      // Immediate post-close check: Buyer spotlight / pass button is GONE, proving close advanced spotlight
      await expect(buyerPage!.getByTestId("pass-spotlight-btn")).toHaveCount(0);
      await expect(
        buyerPage!.getByTestId("pursuit-controls-panel"),
      ).toHaveCount(0);

      // Buyer and lender reserved cash are released back to $0
      await expect(buyerPage!.getByTestId("self-reserved-cash")).toHaveText(
        "$0",
      );
      await expect(lenderPage!.getByTestId("self-reserved-cash")).toHaveText(
        "$0",
      );

      // Seller no longer owns the sold fixture business (EV $60,000)
      if (sellerAssetsBefore === 1) {
        await expect(
          sellerPage.getByTestId("self-owned-assets-list"),
        ).toHaveCount(0);
      } else {
        await expect(
          sellerPage.getByTestId("self-owned-assets-list"),
        ).not.toContainText("$60,000");
        expect(
          await sellerPage.locator('[data-testid^="owned-asset-"]').count(),
        ).toBe(sellerAssetsBefore - 1);
      }

      // Buyer owns acquired business
      await expect(
        buyerPage!.getByTestId("self-owned-assets-list"),
      ).toBeVisible();
      await expect(
        buyerPage!.getByTestId("self-owned-assets-list"),
      ).toContainText("Business");

      // Buyer sees borrower loan position
      await expect(buyerPage!.getByTestId("self-loans-list")).toBeVisible();
      await expect(buyerPage!.getByTestId("self-loans-list")).toContainText(
        /borrower/i,
      );

      // Lender sees lender loan position
      await expect(lenderPage!.getByTestId("self-loans-list")).toBeVisible();
      await expect(lenderPage!.getByTestId("self-loans-list")).toContainText(
        /lender/i,
      );

      // 12. Finish remaining spotlights to reach Quarter 2 ROUND_START
      for (let step = 0; step < 10; step++) {
        const isQ2 = (await pageA.getByTestId("round-start-view").count()) > 0;
        if (isQ2) break;

        let passed = false;
        for (const p of pages) {
          const passBtn = p.getByTestId("pass-spotlight-btn");
          if ((await passBtn.count()) > 0) {
            await passBtn.click();
            await expect(passBtn).toHaveCount(0);
            passed = true;
            break;
          }
        }
        if (!passed) {
          // If no pass button found, check if we arrived at round-start-view
          if ((await pageA.getByTestId("round-start-view").count()) > 0) break;
          await pageA.waitForTimeout(300);
        }
      }

      // All 4 clients reach Quarter 2 ROUND_START
      for (const p of pages) {
        await expect(p.getByTestId("round-start-view")).toBeVisible();
        await expect(p.getByTestId("quarter-heading")).toHaveText("Quarter 2");
        // No client retains an active transaction panel in Q2
        await expect(p.getByTestId("transaction-panel")).toHaveCount(0);
      }

      // Buyer still owns acquired business and has borrower loan
      await expect(
        buyerPage!.getByTestId("self-owned-assets-list"),
      ).toBeVisible();
      await expect(
        buyerPage!.getByTestId("self-owned-assets-list"),
      ).toContainText("Business");
      await expect(buyerPage!.getByTestId("self-loans-list")).toContainText(
        /borrower/i,
      );

      // Lender still has lender loan receivable
      await expect(lenderPage!.getByTestId("self-loans-list")).toContainText(
        /lender/i,
      );

      // Seller still does not own the sold fixture business
      if (sellerAssetsBefore === 1) {
        await expect(
          sellerPage.getByTestId("self-owned-assets-list"),
        ).toHaveCount(0);
      } else {
        await expect(
          sellerPage.getByTestId("self-owned-assets-list"),
        ).not.toContainText("$60,000");
        expect(
          await sellerPage.locator('[data-testid^="owned-asset-"]').count(),
        ).toBe(sellerAssetsBefore - 1);
      }

      const preQ2View = (
        await (
          await buyerPage!.request.get(
            `${server.origin}/api/rooms/${roomCode}/match`,
          )
        ).json()
      ).match;
      const playerLoanId = preQ2View.self.loans.find(
        (loan: { role: string; kind: string }) =>
          loan.role === "borrower" && loan.kind === "player-loan",
      ).id;
      if (diagnosticDistress) {
        // Explicit offline boundary fixture: ordinary approved starts no longer default on this loan.
        await server.stop();
        execFileSync(process.execPath, [
          createRequire(import.meta.url).resolve("tsx/cli"),
          "apps/server/test/support/seedBrowserDistress.ts",
          server.dbPath,
          preQ2View.matchId,
        ]);
        await server.restart();
        for (const page of pages) await page.reload();
        await expect(pageA.getByTestId("resume-match-btn")).toBeEnabled();
        await pageA.getByTestId("resume-match-btn").click();
        await expect(pageA.getByTestId("begin-round-btn")).toBeEnabled();
      }
      // Settle Q2-Q4 through real controls and inspect each recipient's actual API view.
      const businessCard = buyerPage!
        .locator('[data-testid^="owned-asset-"]')
        .filter({ hasText: "EV: $60,000" });
      const cardId = await businessCard.getAttribute("data-testid");
      if (!cardId) throw new Error("Missing business card ID");
      const acquiredAssetId = cardId.slice("owned-asset-".length);
      await expect(businessCard).toContainText("Expected payout Q2: $3,000");
      await expect(
        buyerPage!.getByTestId(`business-payout-${acquiredAssetId}`),
      ).toHaveCount(0);
      for (let quarter = 2; quarter <= 4; quarter++) {
        await pageA.getByTestId("begin-round-btn").click();
        for (let turn = 0; turn < 4; turn++) {
          let active: Page | undefined;
          await expect
            .poll(async () => {
              for (const candidate of pages) {
                if (await candidate.getByTestId("pass-spotlight-btn").count()) {
                  active = candidate;
                  return true;
                }
              }
              return false;
            })
            .toBe(true);
          if (!active) throw new Error("Missing active player");
          const button = active.getByTestId("pass-spotlight-btn");
          await button.click();
          await expect(button).toHaveCount(0);
        }
        for (const page of pages) {
          await expect(page.getByTestId("quarter-heading")).toHaveText(
            `Quarter ${quarter + 1}`,
          );
          await assertNoHorizontalOverflow(page, `q${quarter + 1}-finance`);
        }
        await expect(
          buyerPage!.getByTestId(`business-payout-${acquiredAssetId}`),
        ).toHaveText(`Business ${acquiredAssetId}: received $3,000.`);
        await expect(businessCard).toContainText(
          `Company cash: ${["$750", "$1,500", "$2,250"][quarter - 2]}`,
        );
        const views = [];
        for (const page of pages) {
          const response = await page.request.get(
            `${server.origin}/api/rooms/${roomCode}/match`,
          );
          expect(response.ok()).toBeTruthy();
          views.push((await response.json()).match);
        }
        const buyerIndex = pages.indexOf(buyerPage!);
        if (diagnosticDistress) {
          const borrower = views[
            buyerIndex
          ].self.lastSettlement.loanPayments.find(
            (p: { loanId: string }) => p.loanId === playerLoanId,
          );
          const lender = views[
            pages.indexOf(lenderPage!)
          ].self.lastSettlement.loanPayments.find(
            (p: { loanId: string }) => p.loanId === playerLoanId,
          );
          expect(borrower).toMatchObject({ role: "borrower", paidCents: 0 });
          expect(borrower.unpaidCents).toBeGreaterThan(0);
          expect(lender).toEqual({ ...borrower, role: "lender" });
          await expect(
            buyerPage!.getByTestId(`settled-loan-${playerLoanId}`),
          ).toContainText("remains overdue");
          await expect(
            lenderPage!.getByTestId(`settled-loan-${playerLoanId}`),
          ).toContainText("received $0");
          expect(
            views[buyerIndex].self.livingExpenseArrearsCents,
          ).toBeGreaterThan(0);
          for (const page of [sellerPage, neutralCandidatePage!]) {
            const view = views[pages.indexOf(page)];
            expect(
              view.self.loans.some(
                (l: { id: string }) => l.id === playerLoanId,
              ),
            ).toBe(false);
            expect(
              view.self.lastSettlement.loanPayments.some(
                (p: { loanId: string }) => p.loanId === playerLoanId,
              ),
            ).toBe(false);
            expect(JSON.stringify(view)).not.toContain("9382715");
          }
        }
        expect(
          views[buyerIndex].self.lastSettlement.businessDistributions,
        ).toContainEqual({ assetId: acquiredAssetId, amountCents: 300_000 });
        for (const [index, view] of views.entries()) {
          expect(view.currentQuarter).toBe(quarter + 1);
          expect(JSON.stringify(view)).not.toContain("livingByPlayer");
          expect(JSON.stringify(view)).not.toContain("businessesById");
          expect(JSON.stringify(view)).not.toContain("cashByPlayer");
          if (index !== buyerIndex) {
            expect(
              view.self.ownedAssets.some(
                (asset: { id: string }) => asset.id === acquiredAssetId,
              ),
            ).toBe(false);
            expect(
              view.self.lastSettlement.businessDistributions,
            ).not.toContainEqual({
              assetId: acquiredAssetId,
              amountCents: 300_000,
            });
          }
        }
      }
      await buyerPage!.reload();
      await expect(buyerPage!.getByTestId("quarter-heading")).toHaveText(
        "Quarter 5",
      );
      await expect(
        buyerPage!.getByTestId(`business-payout-${acquiredAssetId}`),
      ).toHaveText(`Business ${acquiredAssetId}: received $3,000.`);
      await expect(businessCard).toContainText("Company cash: $2,250");

      // A process restart restores the same private finance view and does not settle again.
      const beforeRestart = (
        await (
          await buyerPage!.request.get(
            `${server.origin}/api/rooms/${roomCode}/match`,
          )
        ).json()
      ).match;
      const allBeforeRestart = await Promise.all(
        pages.map(
          async (page) =>
            (
              await (
                await page.request.get(
                  `${server.origin}/api/rooms/${roomCode}/match`,
                )
              ).json()
            ).match,
        ),
      );
      await server.restart();
      for (const page of pages) await page.reload();
      await expect(pageA.getByTestId("resume-match-btn")).toBeEnabled();
      await pageA.getByTestId("resume-match-btn").click();
      await expect(pageA.getByTestId("begin-round-btn")).toBeEnabled();
      const afterRestart = (
        await (
          await buyerPage!.request.get(
            `${server.origin}/api/rooms/${roomCode}/match`,
          )
        ).json()
      ).match;
      expect(afterRestart).toEqual(beforeRestart);
      const allAfterRestart = await Promise.all(
        pages.map(
          async (page) =>
            (
              await (
                await page.request.get(
                  `${server.origin}/api/rooms/${roomCode}/match`,
                )
              ).json()
            ).match,
        ),
      );
      expect(allAfterRestart).toEqual(allBeforeRestart);
      if (diagnosticDistress) {
        await expect(
          lenderPage!.getByTestId(`settled-loan-${playerLoanId}`),
        ).toContainText("remains overdue");
        await expect(buyerPage!.getByTestId("last-settlement")).toContainText(
          "Unpaid living costs",
        );
      }
      await expect(businessCard).toContainText("Company cash: $2,250");

      // 13. Responsive assertions: Dana's page on 320px viewport has no unintended horizontal overflow
      await assertNoHorizontalOverflow(pageD, "q5-restarted-round-start");
    } finally {
      await contextA.close();
      await contextB.close();
      await contextC.close();
      await contextD.close();
    }
  }
  for (const diagnosticDistress of [false, true]) {
    test(`financed purchase through Q5, reload and restart: ${diagnosticDistress ? "synthetic distress" : "ordinary journey"}`, async ({
      browser,
    }) => {
      await runJourney(browser, diagnosticDistress);
    });
  }
});
