# Interests

A turn-based financial strategy game for four players over a local network, featuring private information, player-to-player financing, business acquisitions, rotating spotlight turns, and deterministic quarterly settlement.

## Overview

Interests is built as a modular TypeScript monorepo with strict package boundaries:

- **`apps/web`**: Responsive browser client built with React and Vite. Renders player-specific views and local action drafts.
- **`apps/server`**: Authoritative Fastify and Socket.IO server with SQLite persistence for match state, reconnectable player sessions, and crash recovery.
- **`packages/engine`**: Authoritative, deterministic game engine. Uses safe-integer cents accounting, seedable PRNG, and recipient-filtered state projections.
- **`packages/rules`**: Immutable rule definitions, economic parameters, and game schemas.
- **`packages/shared`**: Common branded IDs, transport protocols, and cross-boundary primitives.
- **`packages/simulation`**: Automated policy simulations and balance harnesses.

## Getting Started

### Prerequisites

- **Node.js**: `24.x` LTS (see `.nvmrc`)
- **pnpm**: `12.3.4` (managed via Corepack)

```bash
corepack enable
pnpm install
```

### Running Locally

To start a local server and host a game on your network:

```bash
pnpm play
```

This launches the authoritative server and displays a local LAN address and QR code for four players to join from phones, tablets, or computers on the same network.

For active development with hot module reloading on server and web:

```bash
pnpm dev
```

### Verification

Run the test and quality suite:

```bash
pnpm typecheck    # TypeScript compiler check across all packages
pnpm lint         # Biome linter and formatter check
pnpm test         # Vitest unit and integration test suite
pnpm test:e2e     # Playwright multi-client end-to-end tests
```

## Documentation

Detailed architecture and game design specifications are located in the `docs/` directory:

- [Architecture Specification](docs/ARCHITECTURE.md)
- [Game Design Specification](docs/GAME_DESIGN.md)
- [Architecture Decisions Log](docs/DECISIONS.md)
- [Local Play Guide](docs/LOCAL_PLAY.md)

## License

Copyright (c) 2026 Eduardo Marcano. All rights reserved. See [LICENSE](LICENSE) for details.
