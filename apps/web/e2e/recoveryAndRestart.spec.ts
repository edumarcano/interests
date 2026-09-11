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

      await reconnectedContextB.close();
    } finally {
      await contextA.close();
      await contextC.close();
      await contextD.close();
    }
  });

  test("recovery code allows fresh browser context to reclaim seat and revokes previous controller", async ({
    browser,
  }) => {
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

      // Open a fresh 5th BrowserContext with NO cookies
      const contextCharlieNew = await browser.newContext();
      const pageCharlieNew = await contextCharlieNew.newPage();

      await pageCharlieNew.goto(server.origin);
      await pageCharlieNew.click("#tab-recover");
      await pageCharlieNew.fill("#recover-room-code", roomCode!);
      await pageCharlieNew.fill("#recover-code", charlieRecoveryCode);
      await pageCharlieNew.click("#recover-room-btn");

      // Verify the new context reaches the lobby and shows Charlie as self
      await expect(pageCharlieNew.getByTestId("lobby-view")).toBeVisible();
      await expect(pageCharlieNew.getByTestId("seat-3")).toContainText(
        "Charlie (You)",
      );

      // Verify room still has exactly 4 seats
      await expect(pageCharlieNew.getByTestId("seat-1")).toBeVisible();
      await expect(pageCharlieNew.getByTestId("seat-2")).toBeVisible();
      await expect(pageCharlieNew.getByTestId("seat-3")).toBeVisible();
      await expect(pageCharlieNew.getByTestId("seat-4")).toBeVisible();
      await expect(pageCharlieNew.getByTestId("seat-5")).toHaveCount(0);

      // Verify old Page C receives replaced event / session replaced screen
      await expect(pageC.getByTestId("session-replaced-screen")).toBeVisible();

      await contextCharlieNew.close();
    } finally {
      await contextA.close();
      await contextB.close();
      await contextC.close();
      await contextD.close();
    }
  });

  test("server restart during unfinished financed transaction restores state and permits resumption to close", async ({
    browser,
  }) => {
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

      // Find buyer
      let buyerPage: Page | null = null;
      const nonBuyerPages: Page[] = [];

      for (const p of pages) {
        if ((await p.getByTestId("private-opportunity-card").count()) > 0) {
          buyerPage = p;
        } else {
          nonBuyerPages.push(p);
        }
      }

      await buyerPage!.click('[data-testid="investigate-opportunity-btn"]');
      await expect(
        buyerPage!.getByTestId("diligence-revealed-section"),
      ).toBeVisible();

      await pageA.click('[data-testid="begin-round-btn"]');

      // Wait for all to reach spotlight phase
      for (const p of pages) {
        await expect(p.getByTestId("spotlight-view")).toBeVisible();
      }

      // Advance to buyer spotlight
      for (let step = 0; step < 4; step++) {
        if (
          (await buyerPage!.getByTestId("pursuit-controls-panel").count()) > 0
        )
          break;
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

      await expect(
        buyerPage!.getByTestId("pursuit-controls-panel"),
      ).toBeVisible();

      // Buyer initiates financing
      await buyerPage!.click('[data-testid="open-financing-form-btn"]');
      await buyerPage!.click('[data-testid="submit-financing-request-btn"]');
      await expect(
        buyerPage!.getByTestId("waiting-for-lender-msg"),
      ).toBeVisible();

      // Find lender and submit offer
      let lenderPage: Page | null = null;
      for (const p of nonBuyerPages) {
        if ((await p.getByTestId("submit-lender-offer-btn").count()) > 0) {
          lenderPage = p;
          break;
        }
      }
      expect(lenderPage).not.toBeNull();
      await lenderPage!.click('[data-testid="submit-lender-offer-btn"]');

      // Buyer accepts offer (transaction remains unclosed)
      await expect(buyerPage!.getByTestId("accept-offer-btn")).toBeVisible();
      await buyerPage!.click('[data-testid="accept-offer-btn"]');
      await expect(
        buyerPage!.getByTestId("complete-purchase-btn"),
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

      // Verify buyer's unclosed transaction state survived restart intact
      await expect(
        buyerPage!.getByTestId("complete-purchase-btn"),
      ).toBeVisible();

      // Host resumes match once all 4 clients are synchronized
      await expect(pageA.getByTestId("resume-match-btn")).toBeVisible();
      await pageA.click('[data-testid="resume-match-btn"]');

      // Pause banner clears
      await expect(pageA.getByTestId("pause-banner")).toHaveCount(0);

      // Buyer completes purchase
      await buyerPage!.click('[data-testid="complete-purchase-btn"]');

      // Verify transaction finishes cleanly
      await expect(buyerPage!.getByTestId("transaction-panel")).toBeHidden();
      await expect(
        buyerPage!.getByTestId("self-owned-assets-list"),
      ).toContainText("Business");
    } finally {
      await contextA.close();
      await contextB.close();
      await contextC.close();
      await contextD.close();
    }
  });
});
