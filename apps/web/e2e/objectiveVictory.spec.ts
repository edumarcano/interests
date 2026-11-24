import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { MatchPlayerView } from "@interests/shared";
import { expect, type Page, test } from "@playwright/test";
import { startTestServer } from "./support/serverHarness";

test("four ordinary browser clients produce one explicit Executive Owner winner and recover it after restart", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const seed = "m7-acceptance-executive-owner-0";
  const server = await startTestServer({ ordinarySeed: seed });
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

  async function buyFund(page: Page, fund: string, dollars: string) {
    await page.getByLabel(`${fund} amount`, { exact: true }).fill(dollars);
    await page
      .getByRole("button", { name: "Preview market trades", exact: true })
      .click();
    await expect(page.getByTestId("market-trade-preview")).toBeVisible();
    await page
      .getByRole("button", {
        name: "Confirm trades and finish spotlight",
        exact: true,
      })
      .click();
  }

  try {
    await host.goto(server.origin);
    await host.fill("#create-nickname", "Morgan");
    await host.click("#create-room-btn");
    await host.click("#dismiss-recovery-code-btn");
    roomCode = (await host
      .getByTestId("room-code-display")
      .textContent())!.trim();
    for (let index = 1; index < pages.length; index++) {
      const page = pages[index]!;
      await page.goto(`${server.origin}/?room=${roomCode}`);
      await page.fill("#join-nickname", `Player ${index + 1}`);
      await page.click("#join-room-btn");
      await page.click("#dismiss-recovery-code-btn");
    }
    await host.getByTestId("start-game-btn").click();
    await host.getByTestId("objective-card-executive-owner").click();
    await host.getByTestId("confirm-objective-btn").click();
    for (const page of pages.slice(1)) {
      await page.locator('[data-testid^="objective-card-"]').first().click();
      await page.getByTestId("confirm-objective-btn").click();
    }
    await expect(host.getByTestId("round-start-view")).toBeVisible();
    const opening = await Promise.all(pages.map(view));
    expect(opening.map((match) => match.self.playerId)).toEqual([
      "player-1",
      "player-2",
      "player-3",
      "player-4",
    ]);
    expect(opening.every((match) => match.self.opportunity === null)).toBe(
      true,
    );
    await host
      .getByLabel("Focus for future opportunities")
      .selectOption("business");
    await host.getByTestId("set-focus-btn").click();
    await expect
      .poll(async () => (await view(host)).self.financialDetails.focus)
      .toBe("business");

    let beforeFinale: MatchPlayerView | undefined;
    for (let quarter = 1; quarter <= 16; quarter++) {
      await expect(host.getByTestId("quarter-heading")).toHaveText(
        `Quarter ${quarter}`,
      );
      await host.getByTestId("begin-round-btn").click();
      await expect
        .poll(async () => (await view(host)).round?.stage)
        .toBe("spotlight");
      for (let turn = 0; turn < 4; turn++) {
        const current = await view(host);
        const index = opening.findIndex(
          (player) =>
            player.self.playerId === current.round?.activeSpotlightPlayerId,
        );
        if (index < 0) throw new Error("Expected a synchronized active seat");
        const page = pages[index]!;
        if (index === 0 && [1, 3, 5, 7, 9].includes(quarter)) {
          await page
            .getByRole("button", {
              name: "Accept Major promotion",
              exact: true,
            })
            .click();
        } else if (index === 0 && [8, 12, 14].includes(quarter)) {
          await page
            .getByRole("button", {
              name: "Accept Executive ownership position",
              exact: true,
            })
            .click();
        } else if (index === 0 && quarter === 13) {
          await buyFund(page, "Income / Defensive Fund", "61226.45");
        } else if (index === 0 && quarter === 15) {
          await buyFund(page, "Broad Market Fund", "75000");
        } else if (index === 0 && quarter === 16) {
          beforeFinale = current;
          expect(
            current.self.financialDetails.objectiveEvaluation?.status,
          ).toBe("eligible");
          await expect(
            page.getByRole("button", {
              name: "Accept Executive ownership position",
              exact: true,
            }),
          ).toBeEnabled();
          await page
            .getByRole("button", { name: /^Attempt Executive Owner finale/ })
            .click();
        } else if (index === 1 && quarter === 1) {
          await buyFund(page, "Growth Fund", "1000");
        } else if (index === 2 && quarter === 2) {
          await page
            .getByRole("button", { name: /^Accept Steady role/ })
            .click();
        } else if (index === 3 && quarter === 3) {
          await buyFund(page, "Income / Defensive Fund", "500");
        } else {
          await page.getByTestId("pass-spotlight-btn").click();
        }
        await expect
          .poll(async () => (await view(host)).revision)
          .toBe(current.revision + 1);
        if (beforeFinale) break;
        expect((await view(host)).result).toBeNull();
      }
    }
    if (!beforeFinale)
      throw new Error("Expected an ordinary explicit finale in Q16");
    const result = {
      kind: "objective-victory",
      winnerPlayerId: "player-1",
      completedQuarter: 16,
    };
    for (const page of pages) {
      await expect(page.getByTestId("final-result-description")).toHaveText(
        "Morgan won in Quarter 16.",
      );
      await expect(page.getByTestId("winning-economic-action")).toHaveText(
        "Accepted an ownership-linked executive position.",
      );
      await expect(page.getByTestId("pause-banner")).toHaveCount(0);
      await expect(page.getByTestId("pass-spotlight-btn")).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "Your objective progress" }),
      ).toHaveCount(0);
    }
    const terminal = await Promise.all(pages.map(view));
    for (const match of terminal) {
      expect(match.result).toEqual(result);
      expect(match.phase).toBe("finished");
      expect(match.round).toBeNull();
      expect(match.self.lastSettlement?.quarter).toBe(15);
    }
    expect(terminal[0]!.self.cashCents).toBe(
      beforeFinale.self.cashCents - 10_200_000,
    );
    expect(terminal[0]!.self.ownedAssets?.length).toBe(
      (beforeFinale.self.ownedAssets?.length ?? 0) + 1,
    );
    const newCompany = terminal[0]!.self.ownedAssets!.find(
      (asset) =>
        !beforeFinale!.self.ownedAssets?.some((old) => old.id === asset.id),
    );
    expect(newCompany?.enterpriseValueCents).toBe(10_000_000);
    for (const rival of terminal.slice(1)) {
      expect(
        rival.players.find((player) => player.playerId === "player-1")
          ?.publicPosition,
      ).toMatchObject({
        assets: expect.arrayContaining([
          {
            assetId: newCompany?.id,
            kind: "business",
            ownershipPpm: 1_000_000,
            partnerIds: [],
          },
        ]),
        latestAction: { kind: "executive-ownership", quarter: 16 },
      });
      expect(
        rival.self.ownedAssets?.some((asset) => asset.id === newCompany?.id),
      ).toBeFalsy();
      expect(
        rival.players.every(
          (player) =>
            !Object.hasOwn(player, "selectedObjectiveId") &&
            !Object.hasOwn(player, "financialDetails"),
        ),
      ).toBe(true);
    }
    const width = await host.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client);
    await test.info().attach("ordinary-winner-320px", {
      body: await host.screenshot({
        path: test.info().outputPath("ordinary-winner-320px.png"),
        fullPage: true,
      }),
      contentType: "image/png",
    });
    await server.restart();
    await Promise.all(pages.map((page) => page.reload()));
    for (const page of pages) {
      await expect(page.getByTestId("finished-match-view")).toBeVisible();
      await expect(page.getByTestId("winning-economic-action")).toBeVisible();
    }
    expect(await Promise.all(pages.map(view))).toEqual(terminal);
    for (const context of contexts.slice(1)) await context.close();
    await host.reload();
    await expect(host.getByTestId("finished-match-view")).toBeVisible();
    await expect(host.getByTestId("pause-banner")).toHaveCount(0);
    expect(await view(host)).toEqual(terminal[0]);

    const stored = JSON.parse(
      execFileSync(
        process.execPath,
        [
          createRequire(import.meta.url).resolve("tsx/cli"),
          "apps/server/test/support/readWinnerAcceptance.ts",
          server.dbPath,
          terminal[0]!.matchId,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(stored).toMatchObject({
      matchStatus: "FINISHED",
      roomStatus: "FINISHED",
      result,
      lastSettledQuarter: 15,
      revision: terminal[0]!.revision,
      initialization: { setupScenario: "standard-v1", seed },
      receipts: [{ outcome: "ACCEPTED", revision: terminal[0]!.revision }],
    });
    expect(stored.events.map((event: { kind: string }) => event.kind)).toEqual([
      "journal-entry",
      "journal-entry",
      "match-result",
    ]);
    expect(stored.events[2].payload).toEqual(result);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.cleanup();
  }
});
