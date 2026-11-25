import type {
  MatchPlayerView,
  RecurringAcquisitionQuote,
  RecurringAcquisitionRoute,
} from "@interests/shared";
import { expect, type Page } from "@playwright/test";

/** Real ordinary commands only: no snapshot edits, seed outcomes, wealth or threshold changes. */
export async function acquireOrdinaryOpportunity(
  pages: readonly Page[],
  origin: string,
  roomCode: string,
  kind: "business" | "property",
  route: RecurringAcquisitionRoute,
  investigate = true,
) {
  const host = pages[0]!;
  const view = async (page: Page): Promise<MatchPlayerView> =>
    (
      await (
        await page.request.get(`${origin}/api/rooms/${roomCode}/match`)
      ).json()
    ).match;
  for (const page of pages) {
    await page.getByLabel("Focus for future opportunities").selectOption(kind);
    const button = page.getByTestId("set-focus-btn");
    if (await button.isEnabled()) {
      await button.click();
      await expect
        .poll(async () => (await view(page)).self.financialDetails.focus)
        .toBe(kind);
    }
  }
  for (let turn = 0; turn < 112; turn++) {
    let common = await view(host);
    if (common.currentQuarter > 28) break;
    if (common.round?.stage === "round-start") {
      await expect(host.getByTestId("begin-round-btn")).toBeEnabled();
      await host.getByTestId("begin-round-btn").click();
      await expect
        .poll(async () => (await view(host)).round?.stage)
        .toBe("spotlight");
      common = await view(host);
    }
    let page: Page | undefined;
    for (const candidate of pages)
      if (
        (await view(candidate)).self.playerId ===
        common.round!.activeSpotlightPlayerId
      ) {
        page = candidate;
        break;
      }
    if (!page) throw new Error("Missing ordinary active player");
    let own = await view(page);
    const card = own.self.recurringOpportunity;
    if (
      card?.status === "available" &&
      card.action === `npc-${kind}-purchase`
    ) {
      const response = await page.request.post(
        `${origin}/api/rooms/${roomCode}/recurring-acquisition-preview`,
        { data: { opportunityId: card.id } },
      );
      expect(response.ok()).toBe(true);
      let quote = (
        (await response.json()).quotes as RecurringAcquisitionQuote[]
      ).find((item) => item.route === route && item.canClose);
      if (quote) {
        await expect(page.getByTestId("recurring-card-name")).toHaveText(
          card.name,
        );
        if (investigate && !card.investigated) {
          await expect(
            page.getByTestId("investigate-recurring-btn"),
          ).toBeEnabled();
          await page.getByTestId("investigate-recurring-btn").click();
          await expect(page.getByTestId("recurring-facts")).toBeVisible();
          own = await view(page);
          const revised = await page.request.post(
            `${origin}/api/rooms/${roomCode}/recurring-acquisition-preview`,
            { data: { opportunityId: card.id } },
          );
          quote = (
            (await revised.json()).quotes as RecurringAcquisitionQuote[]
          ).find((item) => item.route === route && item.canClose);
        }
        if (quote) {
          const before = await view(page);
          await page.getByTestId("preview-recurring-acquisition").click();
          await expect(
            page.getByTestId(`review-recurring-${route}`),
          ).toBeEnabled();
          await page.getByTestId(`review-recurring-${route}`).click();
          await expect(
            page.getByRole("dialog", { name: "Confirm opportunity purchase" }),
          ).toBeVisible();
          await page.getByRole("button", { name: "Cancel purchase" }).click();
          expect(await view(page)).toEqual(before);
          await page.getByTestId(`review-recurring-${route}`).click();
          await page.getByTestId("confirm-recurring-acquisition").click();
          await expect
            .poll(async () => (await view(page)).revision)
            .toBe(before.revision + 1);
          return { page, before, after: await view(page), quote };
        }
      }
    }
    await expect(page.getByTestId("pass-spotlight-btn")).toBeEnabled();
    const revision = own.revision;
    await page.getByTestId("pass-spotlight-btn").click();
    await expect
      .poll(async () => (await view(host)).revision)
      .toBe(revision + 1);
  }
  throw new Error(`No ordinary ${route} ${kind} acquisition reached by Q28`);
}
