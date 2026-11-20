import type { MatchPlayerView } from "@interests/shared";
import { ObjectiveRequirements } from "./ObjectiveRequirements";
import { SelfFinanceSummary } from "./SelfFinanceSummary";

export function FinishedMatchView({ match }: { match: MatchPlayerView }) {
  const result = match.result;
  if (!result) return null;
  const winner =
    result.kind === "objective-victory"
      ? match.players.find(
          (player) => player.playerId === result.winnerPlayerId,
        )?.nickname
      : null;
  return (
    <div
      data-testid="finished-match-view"
      style={{ width: "100%", overflowWrap: "anywhere" }}
    >
      <section
        aria-label="Final match result"
        style={{ marginBlock: "1.5rem" }}
      >
        <h1>
          {result.kind === "safety-draw" ? "Match drawn" : "Match complete"}
        </h1>
        <p data-testid="final-result-description">
          {result.kind === "safety-draw"
            ? `Quarter ${result.completedQuarter} has settled. The match ended in a draw.`
            : `${winner ?? "The winner"} won in Quarter ${result.completedQuarter}.`}
        </p>
        <p>
          The result is final. Your financial position remains available below.
        </p>
      </section>
      <SelfFinanceSummary self={match.self} isFinal />
      <ObjectiveRequirements self={match.self} isFinal />
    </div>
  );
}
