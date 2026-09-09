import type {
  CommandAckResult,
  MatchPlayerView,
  PauseReason,
  PlayerCommand,
  ResumeData,
  RoomPresencePayload,
  SocketAckResult,
} from "@interests/shared";
import React from "react";
import { ObjectiveSelection } from "./ObjectiveSelection.js";
import { PauseBanner } from "./PauseBanner.js";
import { RoundStartView } from "./RoundStartView.js";
import { SpotlightView } from "./SpotlightView.js";

interface Props {
  match: MatchPlayerView;
  presence: RoomPresencePayload | null;
  pauseReasons: readonly PauseReason[];
  isHost: boolean;
  onSendCommand: (command: PlayerCommand) => Promise<CommandAckResult>;
  onResumeRoom: () => Promise<SocketAckResult<ResumeData>>;
}

export const MatchView: React.FC<Props> = ({
  match,
  presence,
  pauseReasons,
  isHost,
  onSendCommand,
  onResumeRoom,
}) => {
  const isPaused = pauseReasons.length > 0;
  const canResume = isHost && (presence ? presence.allConnected : true);

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

      {match.phase === "setup" && (
        <ObjectiveSelection match={match} onSendCommand={onSendCommand} />
      )}

      {match.phase === "active" && match.round?.stage === "round-start" && (
        <RoundStartView
          match={match}
          isHost={isHost}
          isPaused={isPaused}
          onSendCommand={onSendCommand}
        />
      )}

      {match.phase === "active" && match.round?.stage === "spotlight" && (
        <SpotlightView
          match={match}
          isPaused={isPaused}
          onSendCommand={onSendCommand}
        />
      )}
    </div>
  );
};
