import React from "react";
import type { ConnectionStatus } from "../socket/socketClient.js";

interface Props {
  status: ConnectionStatus;
}

export const ConnectionStatusBadge: React.FC<Props> = ({ status }) => {
  switch (status) {
    case "connected":
      return (
        <span
          role="status"
          className="badge badge-connected"
          aria-label="Connection Status: Connected"
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "currentColor",
            }}
          />
          Connected
        </span>
      );
    case "connecting":
      return (
        <span
          role="status"
          className="badge badge-reconnecting"
          aria-label="Connection Status: Connecting"
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "currentColor",
            }}
          />
          Connecting...
        </span>
      );
    case "reconnecting":
      return (
        <span
          role="status"
          className="badge badge-reconnecting"
          aria-label="Connection Status: Reconnecting"
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "currentColor",
            }}
          />
          Reconnecting...
        </span>
      );
    case "replaced":
      return (
        <span
          role="status"
          className="badge badge-disconnected"
          aria-label="Connection Status: Replaced"
        >
          Session Replaced
        </span>
      );
    case "disconnected":
    default:
      return (
        <span
          role="status"
          className="badge badge-disconnected"
          aria-label="Connection Status: Disconnected"
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "currentColor",
            }}
          />
          Disconnected
        </span>
      );
  }
};
