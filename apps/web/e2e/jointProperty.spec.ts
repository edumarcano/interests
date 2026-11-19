import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { MatchPlayerView } from "@interests/shared";
import { expect, type Page, test } from "@playwright/test";
import { startTestServer } from "./support/serverHarness";

const req = createRequire(import.meta.url);

test("synthetic shared property requires both owners and survives restart before its 60/40 sale", async ({
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
    const host = pages[0]!,
      otherOwner = pages[1]!;
    await host.goto(server.origin);
    await host.fill("#create-nickname", "Joint Host");
    await host.click("#create-room-btn");
    await host.click("#dismiss-recovery-code-btn");
    const code = (await host
      .getByTestId("room-code-display")
      .textContent())!.trim();
    for (let n = 1; n < 4; n++) {
      const page = pages[n]!;
      await page.goto(`${server.origin}/?room=${code}`);
      await page.fill("#join-nickname", `Joint Guest ${n}`);
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
    const before = await Promise.all(pages.map(view));
    execFileSync(
      process.execPath,
      [
        req.resolve("tsx/cli"),
        new URL(
          "../../server/test/support/seedBrowserJointProperty.ts",
          import.meta.url,
        ).pathname,
        server.dbPath,
        before[0]!.matchId,
      ],
      { cwd: process.cwd() },
    );
    await host.getByTestId("begin-round-btn").click();
    await host
      .getByRole("button", { name: "Propose joint sale", exact: true })
      .click();
    const proposal = host.getByTestId("joint-property-panel");
    await expect(proposal).toContainText("Sale price $100,000.00");
    await expect(otherOwner.getByTestId("joint-property-panel")).toContainText(
      "Joint Guest 1 receives $38,400.00",
    );
    await expect(pages[2]!.getByTestId("joint-property-panel")).toHaveCount(0);
    expect((await view(pages[2]!)).jointProperty).toBeNull();
    expect((await view(pages[2]!)).hasActiveTransaction).toBe(true);
    await expect(host.getByTestId("pass-spotlight-btn")).toHaveCount(0);
    await proposal
      .getByRole("button", {
        name: "Confirm exact property terms",
        exact: true,
      })
      .click();
    await expect(
      proposal.getByRole("button", {
        name: "Close shared property agreement",
        exact: true,
      }),
    ).toBeDisabled();
    const pending = (await view(host)).jointProperty!;
    expect(pending.confirmedPlayerIds).toHaveLength(1);
    await server.restart();
    for (const page of pages) await page.reload();
    await expect(host.getByTestId("resume-match-btn")).toBeEnabled();
    await host.getByTestId("resume-match-btn").click();
    expect((await view(host)).jointProperty).toEqual(pending);
    await otherOwner
      .getByTestId("joint-property-panel")
      .getByRole("button", {
        name: "Confirm exact property terms",
        exact: true,
      })
      .click();
    await expect(
      proposal.getByRole("button", {
        name: "Close shared property agreement",
        exact: true,
      }),
    ).toBeEnabled();
    const overflow = await host.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await host.screenshot({
      path: "test-results/joint-property-320.png",
      fullPage: true,
    });
    await proposal
      .getByRole("button", {
        name: "Close shared property agreement",
        exact: true,
      })
      .click();
    await expect.poll(async () => (await view(host)).jointProperty).toBeNull();
    expect((await view(host)).self.cashCents).toBe(
      before[0]!.self.cashCents + 5_760_000,
    );
    expect((await view(otherOwner)).self.cashCents).toBe(
      before[1]!.self.cashCents + 3_840_000,
    );
    expect((await view(host)).round!.spotlightsCompleted).toBe(1);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.cleanup();
  }
});
