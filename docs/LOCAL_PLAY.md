# Local LAN Play Guide

This guide explains how to start, join, and play **Interests** in a local LAN environment (e.g. host on a laptop and join from phones/tablets over Wi-Fi).

---

## 1. Prerequisites

- **Node.js**: v24.x LTS (check with `node -v`)
- **pnpm**: v12.x or as specified in `package.json` (check with `pnpm -v`)
- All devices must be connected to the **same local Wi-Fi network**.

---

## 2. Quickstart

To launch the unified, single-origin game server and web client:

```bash
pnpm play
```

Alternatively on Windows, you can double-click or run:

```cmd
scripts\play-interests.cmd
```

### What this does:
1. Verifies that the web client bundle (`apps/web/dist`) is built. If missing, automatically runs `pnpm build:web`.
2. Binds the authoritative Fastify + Socket.IO + SQLite server to `0.0.0.0:3000` (or `INTERESTS_HOST` / `INTERESTS_PORT` from environment).
3. Discovers available private LAN IP addresses, preferring the address associated with the host's active default route/gateway as the primary origin, and logs:
   - **Local origin**: `http://localhost:3000` (for the host device)
   - **LAN origin(s)**: `http://<lan-ip>:3000` (for other devices on the Wi-Fi network; primary default-route origin listed first)
4. Keeps the process attached. Press `Ctrl+C` to shut down cleanly.

---

## 3. SQLite Database Location

By default, the SQLite database is located at:
```text
./data/interests.sqlite
```
(relative to `apps/server/`, created automatically if it does not exist).
To specify a different location, set the `INTERESTS_DB_PATH` environment variable before running:
```bash
INTERESTS_DB_PATH=./data/my-game.sqlite pnpm play
```

---

## 4. Joining the Game from Other Devices

1. **Host Setup**:
   - On the host machine, open `http://localhost:3000`.
   - Enter a nickname and click **Create Room**.
   - Note your private **Recovery Code** and dismiss the dialog to view the Lobby.
2. **Share / Join Block**:
   - The lobby displays the 6-character room code, a copyable Join URL (e.g., `http://192.168.1.50:3000/?room=ABC123`), and a **QR Code**.
3. **Guest Join via QR or URL**:
   - Guest players scan the QR code using their phone camera, or type the join URL into their mobile browser.
   - The link automatically selects the **Join Room** tab and pre-fills the room code.
   - Each guest enters their nickname and clicks **Join Room**.
   - Each guest receives their own unique, private **Recovery Code**.
4. **Game Start**:
   - Once exactly 4 players have joined and all seats show **Synchronized**, the host clicks **Start Game**.

---

## 5. Security & Recovery Codes

- **Locator vs Credential**: The Room Code in the URL is public locator information. It does **not** grant seat control or authenticate a player.
- **Recovery Codes**: Recovery codes are private bearer tokens shown only once to each player upon joining.
   - **Never share your recovery code** or put it in a public URL.
   - If a player's browser crashes or device runs out of battery, open the game URL on any device, select the **Recover Seat** tab, and enter the room code + recovery code to reclaim the seat.
   - Reclaiming a seat immediately revokes the previous browser session.

---

## 6. Disconnects, Pauses, and Restarts

- **Disconnect**: If a player loses Wi-Fi connection, the room enters a **Paused** state (`DISCONNECTED_MEMBER`). Gameplay actions are disabled.
- **Reconnect**: When the player reconnects, the game does **not** auto-resume immediately. The host must click **Resume Game** to ensure all players are ready.
- **Server Restart**: If the server restarts during an active match (even during an unfinished transaction):
   - On restart, the server reloads the match from the SQLite database with status `SERVER_RESTART`.
   - Clients automatically reconnect, re-synchronize, and restore the exact transaction state.
   - The host clicks **Resume Game** to continue play.

---

## 7. Troubleshooting LAN Connectivity

1. **Cannot open the page on phone (`Connection Refused` / `Timed Out`)**:
   - Ensure both the host and phone are on the exact same Wi-Fi network.
   - Check Windows Firewall: allow inbound TCP connections on port 3000 for private networks.
   - Ensure your Wi-Fi router does not have "Client Isolation" or "AP Isolation" enabled (common on guest Wi-Fi networks).
2. **Wrong IP address in QR code or Join URL**:
   - Interests automatically detects the host's active default route (the network interface the OS uses for outbound network traffic) and sets it as the primary QR code and join URL address (`lanOrigins[0]`).
   - If virtual adapters (such as VirtualBox, WSL, or Hyper-V) or VPNs create extra candidate addresses, they remain available as clickable secondary LAN links beneath the QR code.
   - For troubleshooting, check your host's active default-route address (e.g. `route print 0.0.0.0` or `Get-NetRoute -DestinationPrefix '0.0.0.0/0'` on Windows, `ip route show default` on Linux, `route -n get default` on macOS) and verify that the primary address matches your actual Wi-Fi or Ethernet adapter.
3. **Camera QR scanner not opening**:
   - Manually navigate to `http://<lan-ip>:3000` on the phone browser, switch to the **Join Room** tab, and enter the room code.

---

## 8. Manual Four-Device Acceptance Checklist

When running a playtest with physical phones and laptops:

| Step | Action | Expected Result | Checked |
| :--- | :--- | :--- | :--: |
| 1 | Host laptop runs `pnpm play` | Console displays `http://localhost:3000` and LAN IP | [ ] |
| 2 | Host creates room | Lobby displays Room Code, Join URL, and QR code | [ ] |
| 3 | Phone 1 scans QR code | Opens Join Room screen with room code pre-filled | [ ] |
| 4 | Phones 1, 2, 3 join | All 4 seats show in lobby with unique nicknames | [ ] |
| 5 | Verify synchronization | All 4 badges show `Synchronized`; Host **Start Game** enables | [ ] |
| 6 | Objective selection | Each player chooses private objective without leaking to others | [ ] |
| 7 | Q1 Round Start & Diligence | Only target buyer sees private business opportunity card | [ ] |
| 8 | Financing Transaction | Buyer requests loan; eligible lender submits offer; buyer accepts and closes | [ ] |
| 9 | Ownership & Settlement | Business asset & loan positions appear on respective players; advances to Q2 | [ ] |
| 10 | Disconnect & Recovery | Toggle airplane mode on one phone; verify pause; restore seat using recovery code | [ ] |
