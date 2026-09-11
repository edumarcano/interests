import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
  startTestServer,
  type TestServerHarness,
} from "./support/serverHarness.js";

test.describe("PR24 Four-Client Vertical Slice", () => {
  let server: TestServerHarness;

  test.beforeAll(async () => {
    server = await startTestServer();
  });

  test.afterAll(async () => {
    if (server) {
      await server.cleanup();
    }
  });

  test("executes canonical four-client LAN journey from room creation through Q1 financed acquisition to Q2", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
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
      // Buyer opens player financing form
      await buyerPage!.click('[data-testid="open-financing-form-btn"]');
      await expect(
        buyerPage!.getByTestId("financing-request-form"),
      ).toBeVisible();

      // Buyer submits financing request (using default safe contribution)
      await buyerPage!.click('[data-testid="submit-financing-request-btn"]');

      // Buyer transaction panel shows waiting for lender offer
      await expect(buyerPage!.getByTestId("transaction-panel")).toBeVisible();
      await expect(
        buyerPage!.getByTestId("waiting-for-lender-msg"),
      ).toBeVisible();

      // Identify the eligible lender from the non-buyer pages
      let lenderPage: Page | null = null;
      const neutralPages: Page[] = [];

      for (const p of nonBuyerPages) {
        const canOffer =
          (await p.getByTestId("submit-lender-offer-btn").count()) > 0;
        if (canOffer) {
          lenderPage = p;
        } else {
          neutralPages.push(p);
        }
      }

      expect(lenderPage).not.toBeNull();
      // Verify neutral pages do not see the lender offer button
      for (const np of neutralPages) {
        await expect(np.getByTestId("submit-lender-offer-btn")).toHaveCount(0);
      }

      // Lender submits valid loan offer
      await lenderPage!.click('[data-testid="submit-lender-offer-btn"]');
      await expect(
        lenderPage!.getByTestId("lender-submitted-section"),
      ).toBeVisible();

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
      }

      // 13. Responsive assertions: Dana's page on 320px viewport has no unintended horizontal overflow
      const overflowDetails = await pageD.evaluate(() => {
        const docWidth = document.documentElement.clientWidth;
        const scrollW = document.documentElement.scrollWidth;
        const elements = Array.from(document.querySelectorAll("*"));
        const overflowing = elements
          .filter((el) => el.getBoundingClientRect().right > docWidth)
          .map((el) => ({
            tag: el.tagName,
            id: el.id,
            className: el.className,
            testId: el.getAttribute("data-testid"),
            right: el.getBoundingClientRect().right,
            width: el.getBoundingClientRect().width,
          }));
        return { docWidth, scrollW, overflowing };
      });
      if (overflowDetails.scrollW > overflowDetails.docWidth) {
        console.log(
          "Overflow details for 320px:",
          JSON.stringify(overflowDetails, null, 2),
        );
      }
      expect(overflowDetails.scrollW <= overflowDetails.docWidth).toBe(true);
    } finally {
      await contextA.close();
      await contextB.close();
      await contextC.close();
      await contextD.close();
    }
  });
});
