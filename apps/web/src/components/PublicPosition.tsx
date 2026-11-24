import type { MatchPlayerView, PublicEconomicAction } from "@interests/shared";

const actionLabels: Readonly<Record<PublicEconomicAction, string>> = {
  "property-purchase": "Purchased property",
  "property-sale": "Sold property",
  "property-improvement": "Improved property",
  "property-refinancing": "Refinanced property",
  "business-purchase": "Acquired a business",
  "business-sale": "Sold a business",
  "business-stake-transfer": "Transferred a business stake",
  "business-capital-raise": "Raised business equity",
  "business-expansion": "Expanded a business",
  "executive-ownership": "Accepted an ownership-linked executive position",
  "public-fund-trade": "Traded public funds",
  "market-loan": "Funded a market loan",
  "work-status": "Confirmed a position outside paid work",
};

export function PublicPosition({ match }: { match: MatchPlayerView }) {
  const nicknames = new Map(
    match.players.map(({ playerId, nickname }) => [playerId, nickname]),
  );
  if (!match.players.some((player) => player.publicPosition)) return null;

  return (
    <details className="card">
      <summary>Public positions</summary>
      {match.players.map(({ playerId, nickname, publicPosition }) => {
        if (!publicPosition) return null;
        const { assets, latestAction } = publicPosition;
        return (
          <section key={playerId} aria-label={`${nickname} public position`}>
            <h3>{nickname}</h3>
            <p>
              Liquidity {publicPosition.liquidity} · Leverage{" "}
              {publicPosition.leverage} · Cash flow {publicPosition.cashFlow}
            </p>
            {assets.length ? (
              <ul>
                {assets.map(({ assetId, kind, ownershipPpm, partnerIds }) => (
                  <li key={assetId}>
                    {kind === "property" ? "Property" : "Business"} {assetId}
                    {" · "}
                    {ownershipPpm / 10_000}% ownership
                    {partnerIds.length > 0 &&
                      ` · With ${partnerIds.map((id) => nicknames.get(id) ?? "another player").join(", ")}`}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No property or business interests.</p>
            )}
            {latestAction && (
              <p>
                {actionLabels[latestAction.kind]} in Q{latestAction.quarter}.
              </p>
            )}
          </section>
        );
      })}
    </details>
  );
}

export function WinningEconomicAction({ match }: { match: MatchPlayerView }) {
  const result = match.result;
  if (result?.kind !== "objective-victory") return null;
  const action = match.players.find(
    ({ playerId }) => playerId === result.winnerPlayerId,
  )?.publicPosition?.latestAction;
  return action?.quarter === result.completedQuarter ? (
    <p data-testid="winning-economic-action">{actionLabels[action.kind]}.</p>
  ) : null;
}
