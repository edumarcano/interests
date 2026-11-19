import type { MatchPlayerView } from "@interests/shared";
import { expect, test } from "@playwright/test";
import { startTestServer } from "./support/serverHarness";

test("ordinary four-client career acceptance persists earned pay and private progress on a phone", async ({
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
  try {
    const host = pages[0]!;
    await host.goto(server.origin);
    await host.fill("#create-nickname", "Career Host");
    await host.click("#create-room-btn");
    await host.click("#dismiss-recovery-code-btn");
    const roomCode = (await host
      .getByTestId("room-code-display")
      .textContent())!.trim();
    for (let i = 1; i < pages.length; i++) {
      const page = pages[i]!;
      await page.goto(`${server.origin}/?room=${roomCode}`);
      await page.fill("#join-nickname", `Career Guest ${i}`);
      await page.click("#join-room-btn");
      await page.click("#dismiss-recovery-code-btn");
    }
    await expect(host.getByTestId("start-game-btn")).toBeEnabled();
    await host.click("#start-game-btn");
    for (const page of pages) {
      await page.locator('[data-testid^="objective-card-"]').first().click();
      await page.getByTestId("confirm-objective-btn").click();
    }
    for (const page of pages)
      await expect(page.getByTestId("round-start-view")).toBeVisible();
    async function view(page = host): Promise<MatchPlayerView> {
      const response = await page.request.get(
        `${server.origin}/api/rooms/${roomCode}/match`,
      );
      expect(response.status()).toBe(200);
      return (await response.json()).match;
    }
    const before = await view();
    await expect(
      host.getByRole("heading", { name: "Your private finances" }),
    ).toBeVisible();
    await expect(
      host.getByRole("heading", { name: "Private objective requirements" }),
    ).toBeVisible();
    const progress = host.getByRole("region", {
      name: "Your objective progress",
    });
    await expect(progress).toBeVisible();
    const evaluation = before.self.financialDetails.objectiveEvaluation!;
    expect(evaluation.objectiveId).toBe(before.self.selectedObjectiveId);
    await expect(progress.getByRole("status")).toHaveText(
      evaluation.status === "eligible"
        ? "Requirements met."
        : "Requirements are still outstanding.",
    );
    await expect(progress.getByRole("listitem")).toHaveCount(
      evaluation.checks.length,
    );
    for (const check of evaluation.checks)
      await expect(
        progress.getByRole("listitem").filter({ hasText: check.label }),
      ).toHaveText(`${check.met ? "Met" : "Still needed"}: ${check.label}`);
    await host.getByText("Inspect exact requirements").click();
    await expect(
      host.getByText(/Protected annual living costs are the greater/),
    ).toBeVisible();
    await host.getByText("Inspect exact requirements").click();
    await host.getByTestId("begin-round-btn").click();
    const offer = before.self.financialDetails.careerOffers[0]!;
    const accept = host.getByRole("button", {
      name: `Accept ${offer.name}`,
      exact: true,
    });
    await expect(accept).toBeEnabled();
    await accept.click();
    await expect(accept).toBeDisabled();
    const after = await view();
    expect(after.revision).toBe(before.revision + 2);
    expect(after.self.financialDetails.quarterlyIncomeCents).toBe(
      offer.annualCompensationCents / 4,
    );
    expect(after.self.financialDetails.entitledQuarterlyIncomeCents).toBe(
      before.self.financialDetails.entitledQuarterlyIncomeCents,
    );
    expect(after.round!.spotlightsCompleted).toBe(1);
    for (const page of pages.slice(1)) {
      const other = await view(page);
      expect(other.self.playerId).not.toBe(after.self.playerId);
      expect(
        other.players.every(
          (player) =>
            !("financialDetails" in player) &&
            !("careerOffers" in player) &&
            !("objectiveEvaluation" in player),
        ),
      ).toBe(true);
    }
    for (const page of pages.slice(1)) {
      await expect(page.getByTestId("pass-spotlight-btn")).toBeEnabled();
      await page.getByTestId("pass-spotlight-btn").click();
    }
    await expect(host.getByTestId("quarter-heading")).toHaveText("Quarter 2");
    const settled = await view();
    expect(settled.self.financialDetails.entitledQuarterlyIncomeCents).toBe(
      offer.annualCompensationCents / 4,
    );
    expect(settled.self.financialDetails.completedObservationQuarters).toBe(1);
    const overflow = await host.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    await host.screenshot({
      path: "/tmp/m7-objective-progress-phone.png",
      fullPage: true,
    });
    await host.reload();
    await expect(host.getByTestId("quarter-heading")).toHaveText("Quarter 2");
    expect((await view()).self.financialDetails.quarterlyIncomeCents).toBe(
      offer.annualCompensationCents / 4,
    );
    await server.restart();
    for (const page of pages) await page.reload();
    await expect(host.getByTestId("quarter-heading")).toHaveText("Quarter 2");
    const restarted = await view();
    expect(restarted.self.financialDetails).toEqual(
      settled.self.financialDetails,
    );
    expect(restarted.revision).toBe(settled.revision);
    await expect(
      host.getByRole("region", { name: "Your objective progress" }),
    ).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    await server.cleanup();
  }
});
