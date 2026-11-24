import type {
  CommandAckResult,
  MatchPlayerView,
  PauseReason,
  PlayerCommand,
  ResumeData,
  RoomPresencePayload,
  SocketAckResult,
} from "@interests/shared";
import type React from "react";
import { CareerPanel } from "./CareerPanel";
import { FinishedMatchView } from "./FinishedMatchView";
import { ObjectiveRequirements } from "./ObjectiveRequirements";
import { ObjectiveSelection } from "./ObjectiveSelection.js";
import { PauseBanner } from "./PauseBanner.js";
import { PublicPosition } from "./PublicPosition";
import { RecurringOpportunityPanel } from "./RecurringOpportunityPanel";
import { RoundStartView } from "./RoundStartView.js";
import { SpotlightView } from "./SpotlightView.js";
import { StandingFinaleOffer } from "./StandingFinaleOffer";

interface Props {
  roomCode?: string;
  match: MatchPlayerView;
  presence: RoomPresencePayload | null;
  pauseReasons: readonly PauseReason[];
  isHost: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
  onResumeRoom: () => Promise<SocketAckResult<ResumeData>>;
}

export const MatchView: React.FC<Props> = ({
  roomCode,
  match,
  presence,
  pauseReasons,
  isHost,
  onSendCommand,
  onResumeRoom,
}) => {
  if (match.result) return <FinishedMatchView match={match} />;
  const isPaused = pauseReasons.length > 0;
  const hasSystemFault = pauseReasons.includes("SYSTEM_FAULT");
  const canResume =
    isHost &&
    Boolean(presence?.allConnected && presence?.allSynchronized) &&
    !hasSystemFault;

  const handleResume = async () => {
    const res = await onResumeRoom();
    if (!res.ok) {
      throw new Error(res.error.message || "Failed to resume match");
    }
  };

  return (
    <div style={{ width: "100%" }} data-testid="match-view">
      <PauseBanner
        reasons={pauseReasons}
        isHost={isHost}
        canResume={canResume}
        onResume={handleResume}
      />
      <PublicPosition match={match} />

      {(match.phase === "objective-choosing" || match.round === null) && (
        <ObjectiveSelection match={match} onSendCommand={onSendCommand} />
      )}

      <RecurringOpportunityPanel
        roomCode={roomCode}
        key={match.self.recurringOpportunity?.id ?? "no-recurring-card"}
        match={match}
        isPaused={isPaused}
        onSendCommand={onSendCommand}
      />
      <ObjectiveRequirements self={match.self} />
      <StandingFinaleOffer
        match={match}
        isPaused={isPaused}
        onSendCommand={onSendCommand}
      />
      {match.phase === "ready-for-first-round" && (
        <CareerPanel
          match={match}
          isPaused={isPaused}
          onSendCommand={onSendCommand}
        />
      )}

      {match.round?.stage === "round-start" && (
        <RoundStartView
          roomCode={roomCode}
          match={match}
          isHost={isHost}
          isPaused={isPaused}
          onSendCommand={onSendCommand}
        />
      )}

      {match.round?.stage === "spotlight" && (
        <SpotlightView
          roomCode={roomCode}
          match={match}
          isPaused={isPaused}
          onSendCommand={onSendCommand}
        />
      )}
    </div>
  );
};
