import type { MatchSelfView } from "@interests/shared";
import { money } from "./CareerPanel";

function label(key: string) {
  return key
    .replace(/Cents$|Bps$/, "")
    .replace(/([A-Z])/g, " $1")
    .toLowerCase();
}
export function ObjectiveRequirements({
  self,
  isFinal = false,
}: {
  self: MatchSelfView;
  isFinal?: boolean;
}) {
  const details = self.financialDetails;
  if (!details) return null;
  return (
    <section
      id="private-finances"
      aria-label="Private finances and objective requirements"
      style={{ overflowWrap: "anywhere", marginBlock: "1rem" }}
    >
      <h2>Your private finances</h2>
      <p>
        {isFinal ? "Employment at closing:" : "Employment from next quarter:"}{" "}
        {money(details.quarterlyIncomeCents)}; living costs:{" "}
        {money(details.quarterlyLivingExpenseCents)} per quarter.
      </p>
      <p>
        {isFinal ? "Final-quarter entitlement:" : "Earned this quarter:"}{" "}
        {money(details.entitledQuarterlyIncomeCents)} employment;{" "}
        {money(details.entitledQuarterlyLivingExpenseCents)} living costs due.
      </p>
      {details.formerWorkClaims?.map((claim) => (
        <p key={claim.assetId}>
          Unpaid work from business {claim.assetId}: {money(claim.amountCents)}.
        </p>
      ))}
      <h3>Public funds</h3>
      {details.publicMarkets.map((fund) => (
        <p key={fund.id}>
          {fund.name ?? fund.id}: value {money(fund.valueCents)}; cost basis{" "}
          {money(fund.basisCents)}.
        </p>
      ))}
      <h3>Properties</h3>
      {details.properties.length === 0 && <p>No properties.</p>}
      {details.properties.map((property) => (
        <p key={property.id}>
          {property.id}: {property.ownershipPpm / 10000}% owned; whole property
          value {money(property.marketValueCents)}; scheduled rent{" "}
          {money(property.scheduledQuarterlyRentCents)}; occupancy{" "}
          {property.occupancyBps / 100}%; whole property operating income{" "}
          {money(property.quarterlyNoiCents)} per quarter.
        </p>
      ))}
      <h3>Private objective requirements</h3>
      <p>
        Performance history: {details.completedObservationQuarters} of 4
        completed quarters. Missing quarters count as zero.
      </p>
      {!isFinal && self.selectedObjectiveId && (
        <section aria-label="Your objective progress">
          <h4>Current progress</h4>
          {details.objectiveEvaluation?.objectiveId ===
          self.selectedObjectiveId ? (
            <>
              <p role="status">
                {details.objectiveEvaluation.status === "eligible"
                  ? "Requirements met."
                  : "Requirements are still outstanding."}
              </p>
              <p>Victory requires a successful, explicitly pursued finale.</p>
              <ul style={{ paddingInlineStart: "1.25rem" }}>
                {details.objectiveEvaluation.checks.map((check) => (
                  <li key={check.id}>
                    <strong>{check.met ? "Met" : "Still needed"}:</strong>{" "}
                    {check.label}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              Progress is unavailable. You can inspect the exact requirements
              below.
            </p>
          )}
        </section>
      )}
      {details.objectiveRequirements
        .filter(
          (requirement) =>
            !self.selectedObjectiveId ||
            requirement.objectiveId === self.selectedObjectiveId,
        )
        .map((requirement) => (
          <div key={requirement.objectiveId}>
            <h4>{requirement.objectiveId}</h4>
            <details>
              <summary>Inspect exact requirements</summary>
              <ul>
                {requirement.instructions?.map((instruction) => (
                  <li key={instruction}>{instruction}</li>
                ))}
              </ul>
              <dl>
                {Object.entries(requirement.targets).map(([key, value]) => (
                  <div key={key}>
                    <dt>{label(key)}</dt>
                    <dd>
                      {key.endsWith("Cents")
                        ? money(value)
                        : key.endsWith("Bps")
                          ? `${value / 100}%`
                          : value}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        ))}
    </section>
  );
}
