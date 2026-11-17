import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
  startTestServer,
  type TestServerHarness,
} from "./support/serverHarness.js";

test.describe("PR24 Disconnect, Recovery Takeover, and Server Restart", () => {
  let server: TestServerHarness;

  test.beforeEach(async () => {
    server = await startTestServer();
  });

  test.afterEach(async () => {
    if (server) {
      await server.cleanup();
    }
  });

  test("disconnect pauses game, reconnect does not auto-resume, host resumes legally", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const contextC = await browser.newContext();
    const contextD = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const pageC = await contextC.newPage();
    const pageD = await contextD.newPage();

    const pages = [pageA, pageB, pageC, pageD];

    try {
      // Host creates room
      await pageA.goto(server.origin);
      await pageA.fill("#create-nickname", "Alice");
      await pageA.click("#create-room-btn");
      await expect(pageA.getByTestId("recovery-code-display")).toBeVisible();
      await pageA.click("#dismiss-recovery-code-btn");

      const roomCode = (
        await pageA.getByTestId("room-code-display").textContent()
      )?.trim();

      // Guests join
      for (const { page, nickname } of [
        { page: pageB, nickname: "Bob" },
        { page: pageC, nickname: "Charlie" },
        { page: pageD, nickname: "Dana" },
      ]) {
        await page.goto(`${server.origin}/?room=${roomCode}`);
        await page.fill("#join-nickname", nickname);
        await page.click("#join-room-btn");
        await expect(page.getByTestId("recovery-code-display")).toBeVisible();
        await page.click("#dismiss-recovery-code-btn");
      }

      // Host starts game
      await expect(pageA.getByTestId("start-game-btn")).toBeEnabled();
      await pageA.click("#start-game-btn");

      // Select objectives
      for (const p of pages) {
        await expect(p.getByTestId("objective-selection-view")).toBeVisible();
        await p.locator('[data-testid^="objective-card-"]').first().click();
        await p.click('[data-testid="confirm-objective-btn"]');
      }

      // Verify at ROUND_START
      for (const p of pages) {
        await expect(p.getByTestId("round-start-view")).toBeVisible();
      }

      // Disconnect Player B by closing context
      const cookiesB = await contextB.cookies();
      await contextB.close();

      // Verify remaining players see DISCONNECTED_MEMBER pause banner
      await expect(pageA.getByTestId("pause-banner")).toBeVisible();
      await expect(pageA.getByText(/player has disconnected/i)).toBeVisible();

      // Invariant: gameplay controls are disabled during pause
      await expect(pageA.getByTestId("begin-round-btn")).toBeDisabled();

      // Host cannot resume while player is disconnected
      await expect(pageA.getByTestId("resume-match-btn")).toBeDisabled();

      // Reconnect Player B in a new context using the same session cookies
      const reconnectedContextB = await browser.newContext();
      await reconnectedContextB.addCookies(cookiesB);
      const reconnectedPageB = await reconnectedContextB.newPage();
      await reconnectedPageB.goto(`${server.origin}/?room=${roomCode}`);

      // Wait for Player B to reconnect and sync
      await expect(
        reconnectedPageB.getByTestId("round-start-view"),
      ).toBeVisible();

      // Invariant: reconnect alone does NOT auto-resume
      await expect(pageA.getByTestId("pause-banner")).toBeVisible();

      // Host resume button becomes available once all 4 are synchronized
      await expect(pageA.getByTestId("resume-match-btn")).toBeVisible();
      await pageA.click('[data-testid="resume-match-btn"]');

      // Pause banner disappears across all clients
      await expect(pageA.getByTestId("pause-banner")).toHaveCount(0);
      await expect(reconnectedPageB.getByTestId("pause-banner")).toHaveCount(0);

      // Verify all 4 clients converge cleanly and can act after host resumes
      await expect(pageA.getByTestId("begin-round-btn")).toBeEnabled();
      await pageA.click('[data-testid="begin-round-btn"]');

      for (const p of [pageA, reconnectedPageB, pageC, pageD]) {
        await expect(p.getByTestId("spotlight-view")).toBeVisible();
      }

      // The player holding the active spotlight can legally pass
      let passed = false;
      for (const p of [pageA, reconnectedPageB, pageC, pageD]) {
        const passBtn = p.getByTestId("pass-spotlight-btn");
        if ((await passBtn.count()) > 0) {
          await expect(passBtn).toBeEnabled();
          await passBtn.click();
          await expect(passBtn).toHaveCount(0);
          passed = true;
          break;
        }
      }
      expect(passed).toBe(true);

      await reconnectedContextB.close();
    } finally {
      await contextA.close();
      await contextC.close();
      await contextD.close();
    }
  });

  test("recovery code allows fresh browser context to reclaim seat in post-objective Q1 state and revokes previous controller", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const contextC = await browser.newContext();
    const contextD = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const pageC = await contextC.newPage();
    const pageD = await contextD.newPage();

    try {
      await pageA.goto(server.origin);
      await pageA.fill("#create-nickname", "Alice");
      await pageA.click("#create-room-btn");
      await pageA.click("#dismiss-recovery-code-btn");
      const roomCode = (
        await pageA.getByTestId("room-code-display").textContent()
      )?.trim();

      // Join B, C, D and capture C's recovery code
      let charlieRecoveryCode = "";
      for (const { page, nickname } of [
        { page: pageB, nickname: "Bob" },
        { page: pageC, nickname: "Charlie" },
        { page: pageD, nickname: "Dana" },
      ]) {
        await page.goto(`${server.origin}/?room=${roomCode}`);
        await page.fill("#join-nickname", nickname);
        await page.click("#join-room-btn");
        if (nickname === "Charlie") {
          charlieRecoveryCode =
            (
              await page.getByTestId("recovery-code-display").textContent()
            )?.trim() ?? "";
        }
        await page.click("#dismiss-recovery-code-btn");
      }

      expect(charlieRecoveryCode.length).toBeGreaterThan(0);

      // Start game
      await expect(pageA.getByTestId("start-game-btn")).toBeEnabled();
      await pageA.click("#start-game-btn");

      // Select objectives for all players and record each player's choice
      const selectedObjectiveByNickname: Record<string, string> = {};
      for (const { page, nickname } of [
        { page: pageA, nickname: "Alice" },
        { page: pageB, nickname: "Bob" },
        { page: pageC, nickname: "Charlie" },
        { page: pageD, nickname: "Dana" },
      ]) {
        await expect(
          page.getByTestId("objective-selection-view"),
        ).toBeVisible();
        const firstObj = page
          .locator('[data-testid^="objective-card-"]')
          .first();
        const testId = await firstObj.getAttribute("data-testid");
        const objId = testId?.replace("objective-card-", "") ?? "";
        expect(objId.length).toBeGreaterThan(0);
        selectedObjectiveByNickname[nickname] = objId;

        await firstObj.click();
        await page.click('[data-testid="confirm-objective-btn"]');
      }

      const charlieSelectedObjectiveId =
        selectedObjectiveByNickname["Charlie"]!;
      expect(charlieSelectedObjectiveId.length).toBeGreaterThan(0);

      // All 4 clients reach Quarter 1 ROUND_START
      for (const p of [pageA, pageB, pageC, pageD]) {
        await expect(p.getByTestId("round-start-view")).toBeVisible();
        await expect(p.getByTestId("quarter-heading")).toHaveText("Quarter 1");
      }

      // Record Charlie's private profile, starting cash, and private opportunity state from old pageC
      const charlieProfile = (
        await pageC.getByTestId("self-profile-id").textContent()
      )?.trim();
      const charlieCash = (
        await pageC.getByTestId("self-available-cash").textContent()
      )?.trim();
      expect(charlieProfile).toBeTruthy();
      expect(charlieCash).toBeTruthy();

      const charlieHadOpp =
        (await pageC.getByTestId("private-opportunity-card").count()) > 0;
      let charlieOppText = "";
      if (charlieHadOpp) {
        charlieOppText =
          (
            await pageC.getByTestId("private-opportunity-card").textContent()
          )?.trim() ?? "";
      }

      // Open a fresh 5th BrowserContext with NO cookies
      const contextCharlieNew = await browser.newContext();
      const pageCharlieNew = await contextCharlieNew.newPage();

      await pageCharlieNew.goto(server.origin);
      await pageCharlieNew.click("#tab-recover");
      await pageCharlieNew.fill("#recover-room-code", roomCode!);
      await pageCharlieNew.fill("#recover-code", charlieRecoveryCode);
      await pageCharlieNew.click("#recover-room-btn");

      // Verify the new context enters directly into Q1 ROUND_START
      await expect(
        pageCharlieNew.getByTestId("round-start-view"),
      ).toBeVisible();
      await expect(pageCharlieNew.getByTestId("quarter-heading")).toHaveText(
        "Quarter 1",
      );

      // Verify recovered context receives the same private profile, cash, and selected objective
      await expect(pageCharlieNew.getByTestId("self-profile-id")).toHaveText(
        charlieProfile!,
      );
      await expect(
        pageCharlieNew.getByTestId("self-available-cash"),
      ).toHaveText(charlieCash!);
      await expect(
        pageCharlieNew.getByTestId("self-selected-objective"),
      ).toContainText(charlieSelectedObjectiveId);

      // Verify Charlie's private opportunity presence and details match before and after recovery
      if (charlieHadOpp) {
        await expect(
          pageCharlieNew.getByTestId("private-opportunity-card"),
        ).toBeVisible();
        if (charlieOppText) {
          const recoveredOppText = (
            await pageCharlieNew
              .getByTestId("private-opportunity-card")
              .textContent()
          )?.trim();
          expect(recoveredOppText).toBe(charlieOppText);
        }
      } else {
        await expect(
          pageCharlieNew.getByTestId("private-opportunity-card"),
        ).toHaveCount(0);
      }

      // Verify room has exactly four seats in spotlight order
      await expect(pageCharlieNew.getByTestId("seat-1")).toBeVisible();
      await expect(pageCharlieNew.getByTestId("seat-2")).toBeVisible();
      await expect(pageCharlieNew.getByTestId("seat-3")).toBeVisible();
      await expect(pageCharlieNew.getByTestId("seat-4")).toBeVisible();
      await expect(pageCharlieNew.getByTestId("seat-5")).toHaveCount(0);

      // Verify Charlie is identified as self in turn order
      await expect(
        pageCharlieNew.locator(".seat-card", { hasText: "(You)" }),
      ).toContainText("Charlie");

      // Invariant: Privacy preserved — no other player's secret objectives or private details leaked
      const pageCharlieContent = await pageCharlieNew.content();
      expect(pageCharlieContent).not.toContain("Alice's Objective");
      expect(pageCharlieContent).not.toContain("Bob's Objective");
      expect(pageCharlieContent).not.toContain("Dana's Objective");

      // Assert that other players' concrete selected objective IDs do not appear in Charlie's DOM/view
      for (const [otherNick, otherObjId] of Object.entries(
        selectedObjectiveByNickname,
      )) {
        if (otherNick !== "Charlie") {
          expect(pageCharlieContent).not.toContain(otherObjId);
        }
      }

      // Verify old Page C receives replaced event / session replaced screen
      await expect(pageC.getByTestId("session-replaced-screen")).toBeVisible();

      // Old Page C cannot act (no gameplay buttons are available)
      await expect(pageC.getByTestId("round-start-view")).toHaveCount(0);
      await expect(pageC.getByTestId("begin-round-btn")).toHaveCount(0);
      await expect(pageC.getByTestId("pass-spotlight-btn")).toHaveCount(0);

      await contextCharlieNew.close();
    } finally {
      await contextA.close();
      await contextB.close();
      await contextC.close();
      await contextD.close();
    }
  });

  test("server restart during unfinished financed transaction restores recipient-specific views and permits resumption to close", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const contextC = await browser.newContext();
    const contextD = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const pageC = await contextC.newPage();
    const pageD = await contextD.newPage();

    const pages = [pageA, pageB, pageC, pageD];
    const pageByNickname: Record<string, Page> = {
      Alice: pageA,
      Bob: pageB,
      Charlie: pageC,
      Dana: pageD,
    };

    try {
      await pageA.goto(server.origin);
      await pageA.fill("#create-nickname", "Alice");
      await pageA.click("#create-room-btn");
      await pageA.click("#dismiss-recovery-code-btn");
      const roomCode = (
        await pageA.getByTestId("room-code-display").textContent()
      )?.trim();

      for (const { page, nickname } of [
        { page: pageB, nickname: "Bob" },
        { page: pageC, nickname: "Charlie" },
        { page: pageD, nickname: "Dana" },
      ]) {
        await page.goto(`${server.origin}/?room=${roomCode}`);
        await page.fill("#join-nickname", nickname);
        await page.click("#join-room-btn");
        await page.click("#dismiss-recovery-code-btn");
      }

      await expect(pageA.getByTestId("start-game-btn")).toBeEnabled();
      await pageA.click("#start-game-btn");

      for (const p of pages) {
        await expect(p.getByTestId("objective-selection-view")).toBeVisible();
        await p.locator('[data-testid^="objective-card-"]').first().click();
        await p.click('[data-testid="confirm-objective-btn"]');
      }

      for (const p of pages) {
        await expect(p.getByTestId("round-start-view")).toBeVisible();
      }

      // Find buyer and non-buyers
      let buyerPage: Page | null = null;
      const nonBuyerPages: Page[] = [];

      for (const p of pages) {
        if ((await p.getByTestId("private-opportunity-card").count()) > 0) {
          buyerPage = p;
        } else {
          nonBuyerPages.push(p);
        }
      }

      expect(buyerPage).not.toBeNull();

      // Buyer investigates opportunity
      await buyerPage!.click('[data-testid="investigate-opportunity-btn"]');
      await expect(
        buyerPage!.getByTestId("diligence-revealed-section"),
      ).toBeVisible();

      // Host begins round
      await pageA.click('[data-testid="begin-round-btn"]');

      // Wait for all to reach spotlight phase
      for (const p of pages) {
        await expect(p.getByTestId("spotlight-view")).toBeVisible();
      }

      // Wait for each new active client rather than racing separate socket deliveries.
      for (let step = 0; step < 4; step++) {
        let activePage: Page | undefined;
        await expect
          .poll(async () => {
            const counts = await Promise.all(
              pages.map((page) =>
                page.getByTestId("pass-spotlight-btn").count(),
              ),
            );
            activePage = pages.find((_, index) => counts[index] === 1);
            return activePage !== undefined;
          })
          .toBe(true);
        if (activePage === buyerPage) break;
        if (!activePage) throw new Error("Missing active spotlight client");
        const passButton = activePage.getByTestId("pass-spotlight-btn");
        await passButton.click();
        await expect(passButton).toHaveCount(0);
      }

      await expect(
        buyerPage!.getByTestId("pursuit-controls-panel"),
      ).toBeVisible();

      // Identify seller from opportunity card
      const sellerNickname = (
        await buyerPage!.getByTestId("opportunity-seller-name").textContent()
      )?.trim();
      expect(sellerNickname).toBeTruthy();
      const sellerPage = pageByNickname[sellerNickname!]!;
      expect(sellerPage).toBeDefined();

      const sellerAssetsBefore = await sellerPage
        .locator('[data-testid^="owned-asset-"]')
        .count();
      expect(sellerAssetsBefore).toBeGreaterThanOrEqual(1);

      // Buyer initiates financing
      await buyerPage!.click('[data-testid="open-financing-form-btn"]');
      await buyerPage!.click('[data-testid="submit-financing-request-btn"]');
      await expect(
        buyerPage!.getByTestId("waiting-for-lender-msg"),
      ).toBeVisible();

      // Partition candidates (non-buyer, non-seller)
      const candidatePages = nonBuyerPages.filter((p) => p !== sellerPage);
      expect(candidatePages.length).toBe(2);

      let lenderPage: Page | null = null;
      let neutralPage: Page | null = null;

      for (const p of candidatePages) {
        const offerBtn = p.getByTestId("submit-lender-offer-btn");
        await expect(offerBtn).toBeVisible();
        const canOffer = await offerBtn.isEnabled();
        if (canOffer && !lenderPage) {
          lenderPage = p;
        } else {
          neutralPage = p;
        }
      }

      expect(lenderPage).not.toBeNull();
      expect(neutralPage).not.toBeNull();

      // Lender submits offer
      await lenderPage!.click('[data-testid="submit-lender-offer-btn"]');

      // Buyer accepts offer (transaction remains unclosed)
      await expect(buyerPage!.getByTestId("accept-offer-btn")).toBeVisible();
      await buyerPage!.click('[data-testid="accept-offer-btn"]');

      // Assert recipient-specific views for all 4 roles BEFORE restart:
      // Buyer sees complete purchase button
      await expect(
        buyerPage!.getByTestId("complete-purchase-btn"),
      ).toBeVisible();
      // Lender sees lender submitted section
      await expect(
        lenderPage!.getByTestId("lender-submitted-section"),
      ).toBeVisible();
      // Seller sees seller status section
      await expect(
        sellerPage.getByTestId("seller-status-section"),
      ).toBeVisible();
      // Neutral sees uninvolved status section without private loan terms
      await expect(
        neutralPage!.getByTestId("uninvolved-status-section"),
      ).toBeVisible();

      // --- SERVER RESTART ---
      await server.restart();

      // Reload pages to reconnect after server restart
      for (const p of pages) {
        await p.reload();
      }

      // Verify all clients receive SERVER_RESTART pause banner
      for (const p of pages) {
        await expect(p.getByTestId("pause-banner")).toBeVisible();
        await expect(p.getByText(/server recently restarted/i)).toBeVisible();
      }

      // Assert restored recipient-specific transaction views for all 4 roles AFTER restart:
      // Buyer sees complete purchase button
      await expect(
        buyerPage!.getByTestId("complete-purchase-btn"),
      ).toBeVisible();
      // Lender sees lender submitted section
      await expect(
        lenderPage!.getByTestId("lender-submitted-section"),
      ).toBeVisible();
      // Seller sees seller status section
      await expect(
        sellerPage.getByTestId("seller-status-section"),
      ).toBeVisible();
      // Neutral sees uninvolved status section
      await expect(
        neutralPage!.getByTestId("uninvolved-status-section"),
      ).toBeVisible();

      // Host resumes match once all 4 clients are synchronized
      await expect(pageA.getByTestId("resume-match-btn")).toBeVisible();
      await pageA.click('[data-testid="resume-match-btn"]');

      // Pause banner clears
      await expect(pageA.getByTestId("pause-banner")).toHaveCount(0);

      // Buyer completes purchase
      await buyerPage!.click('[data-testid="complete-purchase-btn"]');

      // Verify transaction finishes cleanly across clients
      await expect(buyerPage!.getByTestId("transaction-panel")).toBeHidden();
      await expect(
        buyerPage!.getByTestId("self-owned-assets-list"),
      ).toContainText("Business");
      await expect(lenderPage!.getByTestId("self-loans-list")).toContainText(
        /lender/i,
      );

      // Invariant: Cash reservations for buyer and lender return to $0 after close
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
    } finally {
      await contextA.close();
      await contextB.close();
      await contextC.close();
      await contextD.close();
    }
  });
});
