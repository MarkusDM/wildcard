# WILDCARD

Fast 1v1 poker duels with off-chain gameplay and Arc-settled USDC buy-ins.

This repository is an npm workspace monorepo. The current network target is Arc Testnet; the web and server may still be hosted in a production environment while using testnet contracts.

## Structure

- `web/` Next.js + TypeScript frontend
- `server/` Node + TypeScript + Socket.IO backend
- `contracts/` Foundry Solidity contracts
- `shared/` shared TypeScript types

## Install

```bash
npm install
```

## Commands (from repo root)

- `npm run dev:web` Start web dev server
- `npm run dev:server` Start server dev process
- `npm run build:web` Build the Next.js frontend
- `npm run build:server` Build the Socket.IO backend
- `npm run start:web` Start the production web server
- `npm run start:server` Start the production backend server
- `npm run test:web` Run Playwright web tests
- `npm run test:server` Run server Vitest tests
- `npm run test:contracts` Run Foundry contract tests (`forge` required)
- `npm run lint` Run ESLint for web and server
- `npm run format` Run Prettier for web and server
- `npm run deploy:vps` Build and restart the VPS services after bootstrap
- `npm run logs:vps` Tail VPS systemd logs

## Notes

- `pnpm` is preferred when available; this workspace is configured with npm workspaces because pnpm is not installed in this environment.
- Foundry toolchain (`forge`) must be installed locally to run contract tests.

## Web Assets

Place visual assets in `web/public/assets/`.

- Table background: `web/public/assets/table/table_bg.webp` (served at `/assets/table/table_bg.webp`)
- Card back: `web/public/assets/cards/card-back.png` (served at `/assets/cards/card-back.png`)

## Lobby Model

- Tables are created by players from the lobby at the fixed `5 USDC` stake.
- Run `npm run test:lobby:visual` to capture the WILDCARD lobby at 1920x1080, 1600x900, 1440x900, and 1366x768 and check for old branding, removed stakes, and horizontal overflow.
- A table appears in the open tables list after creation.
- Start preview animation is shown on table page when hand switches from `waiting/showdown` to `preflop`.

## Game Presentation Layer

The web client is structured as a browser PvP card game presentation, not a dashboard.

- Lobby states: splash, lobby, matchmaking/searching, match found/versus.
- Match states: loading, searching, match found, gameplay, resolution/showdown.
- Table play uses the shared socket event contracts in `shared/socket-events.ts`; poker and magic stay off-chain on the server.
- ARC wallet calls are only used for deposit, withdraw, lock, and settle.
- Match entry waits for the buy-in lock transaction receipt before the socket `table:join` request, because the server verifies locked balance on-chain.

Run locally:

```bash
npm run dev:server
npm run dev:web
```

Validate presentation changes:

```bash
npm run build:web
npm run test:web
```

## VPS Deployment

The production setup uses two local Node processes behind nginx:

- `arc-poker-server`: Socket.IO/Express backend on `127.0.0.1:4000`
- `arc-poker-web`: Next.js frontend on `127.0.0.1:3000`
- nginx: public HTTP reverse proxy, including `/socket.io/` WebSocket upgrades

Recommended VPS baseline:

- Ubuntu 22.04/24.04
- 1 vCPU / 1 GB RAM minimum, 2 GB RAM recommended for builds
- Node.js 20 LTS
- nginx
- a domain pointed at the VPS if you want HTTPS

First install on the VPS:

```bash
sudo apt-get update
sudo apt-get install -y git
sudo git clone <repo-url> /opt/arc-poker
sudo chown -R "$USER":"$USER" /opt/arc-poker
cd /opt/arc-poker
sudo DOMAIN=your-domain.example bash scripts/vps-bootstrap.sh
```

Edit the production environment files:

```bash
sudo nano /etc/arc-poker/server.env
sudo nano /etc/arc-poker/web.env
```

Use these values as the important checks:

- `NEXT_PUBLIC_SERVER_URL=https://your-domain.example`
- `NEXT_PUBLIC_VAULT_ADDRESS=<deployed_vault_address>`
- `ARC_VAULT_ADDRESS=<deployed_vault_address>`
- `NEXT_PUBLIC_USDC_ADDRESS=0x3600000000000000000000000000000000000000`
- `NEXT_PUBLIC_ARC_RPC_URL=https://rpc.testnet.arc.network`
- `ARC_RPC_URL=https://rpc.testnet.arc.network`

Deploy or redeploy from the repo root on the VPS:

```bash
bash scripts/vps-deploy.sh
```

Check service logs:

```bash
bash scripts/vps-logs.sh
```

Optional HTTPS with Certbot after DNS points to the VPS:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example
```

For code updates:

```bash
cd /opt/arc-poker
git pull
bash scripts/vps-deploy.sh
```

## ARC Wallet Config (Web)

Set these environment variables for `web` (for example in `web/.env.local`):

- `NEXT_PUBLIC_ARC_RPC_URL=https://rpc.testnet.arc.network`
- `NEXT_PUBLIC_ARC_EXPLORER_URL=https://testnet.arcscan.app`
- `NEXT_PUBLIC_USDC_ADDRESS=0x3600000000000000000000000000000000000000`
- `NEXT_PUBLIC_VAULT_ADDRESS=<deployed_vault_address>`

Notes:

- Arc Testnet chain id is fixed in app as `5042002`.
- Lobby deposit uses `approve + deposit(amount)` against your Vault contract.

## ARC Validation Config (Server)

Set these environment variables for server (for example in server/.env):

- ARC_RPC_URL=https://rpc.testnet.arc.network
- ARC_VAULT_ADDRESS=<deployed_vault_address>

Notes:

- On `table:join`, the server reads `balances(wallet)` from Vault via `eth_call`.
- Join is rejected if deposited Vault balance is below the selected table stake (USDC, 6 decimals).

## Submission Materials

Ready-to-edit submission assets live in `docs/submission/`:

- `submission-copy.md`
- `slides-outline.md`
- `video-script.md`
- `cover-brief.md`
- `checklist.md`
