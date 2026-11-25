export interface FundingDraft {
  readonly id: number;
  readonly amount: string;
  readonly invitedId: string;
}

export function FundingSlotEditor({
  kind,
  players,
  drafts,
  onChange,
  onAdd,
}: {
  readonly kind: "loan" | "equity";
  readonly players: readonly {
    readonly playerId: string;
    readonly nickname: string;
  }[];
  readonly drafts: readonly FundingDraft[];
  readonly onChange: (drafts: readonly FundingDraft[]) => void;
  readonly onAdd: () => void;
}) {
  const label = kind === "loan" ? "Loan" : "Investment";
  const counterparty = kind === "loan" ? "lender" : "investor";
  const amount = kind === "loan" ? "principal ($)" : "amount ($)";
  function update(slot: number, change: Partial<Omit<FundingDraft, "id">>) {
    onChange(
      drafts.map((item, index) =>
        index === slot ? { ...item, ...change } : item,
      ),
    );
  }
  return (
    <>
      {drafts.map((row, slot) => (
        <fieldset key={row.id}>
          <legend>
            {label} {slot + 1}
          </legend>
          <label>
            {label} {amount}
            <input
              aria-label={`${label} ${slot + 1} ${amount}`}
              inputMode="decimal"
              value={row.amount}
              onChange={(event) => update(slot, { amount: event.target.value })}
            />
          </label>
          <label>
            Invite {counterparty}
            <select
              aria-label={`${label} ${slot + 1} ${counterparty} invitation`}
              value={row.invitedId}
              onChange={(event) =>
                update(slot, { invitedId: event.target.value })
              }
            >
              <option value="">Any eligible {counterparty}</option>
              {players.map((player) => (
                <option value={player.playerId} key={player.playerId}>
                  {player.nickname}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              onChange(drafts.filter((item) => item.id !== row.id))
            }
          >
            Remove {label.toLowerCase()} {slot + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="btn-secondary"
        disabled={drafts.length >= 4}
        onClick={onAdd}
      >
        {kind === "loan"
          ? "Request a player loan"
          : "Add an investment request"}
      </button>
    </>
  );
}
