import express from 'express';
import { ensureServerEnvLoaded } from './env';

ensureServerEnvLoaded();
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  TableId,
} from '../../shared/socket-events';
import { healthStatus } from './health';
import { createLobbyStore } from './store/lobby-store';
import {
  getArcChainConfig,
  isEvmAddress,
  readLockedBalanceUsdc,
  readTableSettled,
} from './chain/arc';

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json(healthStatus());
});

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
});

const lobbyStore = createLobbyStore();
const arcChain = getArcChainConfig();

function findWaitingCashMatch(
  stake: number,
): ReturnType<typeof lobbyStore.listTables>[number] | undefined {
  const candidates = lobbyStore
    .listTables()
    .filter(
      (table) =>
        table.kind === 'cash' && table.stake === stake && table.playersCount < table.maxPlayers,
    );

  for (const table of candidates) {
    const state = lobbyStore.getTableState(table.tableId);
    if (state.phase === 'waiting') {
      return table;
    }
  }

  return undefined;
}

function broadcastTableState(tableId: TableId): void {
  if (!lobbyStore.hasTable(tableId)) {
    return;
  }

  const state = lobbyStore.getTableState(tableId);
  io.to(tableId).emit('table:state', state);

  for (const player of state.players) {
    io.to(player.socketId).emit(
      'table:private',
      lobbyStore.getPrivateState({ tableId, socketId: player.socketId }),
    );
  }
}

setInterval(() => {
  const expiredTableIds = lobbyStore.expireTurnTimeouts();
  for (const tableId of expiredTableIds) {
    io.to(tableId).emit('table:error', {
      message: 'Turn timer expired. Hand was folded automatically.',
    });
    broadcastTableState(tableId);
  }
}, 250);

io.on('connection', (socket) => {
  console.log(`[socket] connected ${socket.id}`);
  socket.emit('connected', { socketId: socket.id });

  socket.on('lobby:listTables', (ack) => {
    ack({ tables: lobbyStore.listTables() });
  });

  socket.on('lobby:createTable', (payload, ack) => {
    const result = lobbyStore.createTable({
      creatorSocketId: socket.id,
      playerName: payload.playerName,
      stake: payload.stake,
      tableName: payload.tableName,
      kind: payload.kind,
      access: payload.access,
    });

    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }

    ack({ ok: true, table: result.table });
  });

  socket.on('lobby:findPrivateRoom', ({ roomCode }, ack) => {
    const table = lobbyStore.findPrivateRoomByCode(roomCode);
    if (!table) {
      ack({ ok: false, error: 'Private room not found' });
      return;
    }

    ack({ ok: true, table });
  });

  socket.on('lobby:findMatch', (payload, ack) => {
    const playerName = payload.playerName.trim();
    if (!playerName) {
      ack({ ok: false, error: 'Player name is required' });
      return;
    }

    const existingMatch = findWaitingCashMatch(payload.stake);
    if (existingMatch) {
      ack({ ok: true, table: existingMatch, created: false });
      return;
    }

    const result = lobbyStore.createTable({
      creatorSocketId: socket.id,
      playerName,
      stake: payload.stake,
      kind: 'cash',
    });

    if (!result.ok) {
      ack({ ok: false, error: result.error });
      return;
    }

    ack({ ok: true, table: result.table, created: true });
  });

  socket.on('table:join', async ({ tableId, playerName, walletAddress }, ack) => {
    let tableState;
    try {
      tableState = lobbyStore.getTableState(tableId);
    } catch {
      ack({ ok: false, error: 'Unknown table' });
      socket.emit('table:error', { message: 'Unknown table' });
      return;
    }

    const normalizedWallet = walletAddress.toLowerCase();

    if (!isEvmAddress(normalizedWallet)) {
      ack({ ok: false, error: 'Invalid wallet address' });
      socket.emit('table:error', { message: 'Invalid wallet address' });
      return;
    }

    if (!arcChain.vaultAddress) {
      ack({ ok: false, error: 'Server vault is not configured' });
      socket.emit('table:error', { message: 'Server vault is not configured' });
      return;
    }

    try {
      const lockedBalance = await readLockedBalanceUsdc(normalizedWallet, tableId);
      const requiredStakeUnits = BigInt(tableState.stake) * 1_000_000n;
      if (lockedBalance < requiredStakeUnits) {
        const message = `Buy-in is not locked for this table. Required: ${tableState.stake} USDC`;
        ack({ ok: false, error: message });
        socket.emit('table:error', { message });
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to verify locked balance';
      ack({ ok: false, error: message });
      socket.emit('table:error', { message });
      return;
    }

    const previousTableId = lobbyStore.getTableIdBySocket(socket.id);
    const joinResult = lobbyStore.joinTable({
      tableId,
      socketId: socket.id,
      playerName,
      walletAddress: normalizedWallet,
    });

    if (!joinResult.ok) {
      ack({ ok: false, error: joinResult.error ?? 'Failed to join table' });
      socket.emit('table:error', { message: joinResult.error ?? 'Failed to join table' });
      return;
    }

    if (previousTableId && previousTableId !== tableId) {
      socket.leave(previousTableId);
      broadcastTableState(previousTableId);
    }

    socket.join(tableId);
    broadcastTableState(tableId);
    ack({ ok: true });

    console.log(`[table] ${socket.id} joined ${tableId} as ${normalizedWallet}`);
  });

  socket.on('table:leave', ({ tableId }) => {
    const leaveResult = lobbyStore.leaveTable({ tableId, socketId: socket.id });

    if (!leaveResult.ok) {
      socket.emit('table:error', { message: leaveResult.error ?? 'Failed to leave table' });
      return;
    }

    socket.leave(tableId);
    broadcastTableState(tableId);

    console.log(`[table] ${socket.id} left ${tableId}`);
  });

  socket.on('table:close', async ({ tableId }, ack) => {
    if (!lobbyStore.hasTable(tableId)) {
      ack({ ok: false, error: 'Unknown table' });
      return;
    }

    if (!arcChain.vaultAddress) {
      ack({ ok: false, error: 'Server vault is not configured' });
      return;
    }

    try {
      const settled = await readTableSettled(tableId);
      if (!settled) {
        ack({ ok: false, error: 'Table is not settled on-chain yet' });
        return;
      }
    } catch (error) {
      ack({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to verify settlement',
      });
      return;
    }

    io.to(tableId).emit('table:closed', { tableId, message: 'Table settled. Returning to lobby.' });
    io.in(tableId).socketsLeave(tableId);
    lobbyStore.closeTable(tableId);
    ack({ ok: true });
  });

  socket.on('table:ready', ({ tableId, ready }) => {
    const readyResult = lobbyStore.setReady({ tableId, socketId: socket.id, ready });

    if (!readyResult.ok) {
      socket.emit('table:error', { message: readyResult.error ?? 'Failed to update readiness' });
      return;
    }

    broadcastTableState(tableId);
  });

  socket.on('table:action', ({ tableId, action, amountMicroUsdc }) => {
    const actionResult = lobbyStore.applyAction({
      tableId,
      socketId: socket.id,
      action,
      amount: amountMicroUsdc,
    });

    if (!actionResult.ok) {
      socket.emit('table:error', { message: actionResult.error ?? 'Failed to apply action' });
      return;
    }

    broadcastTableState(tableId);
  });

  socket.on('magic:use', ({ tableId, cardType, targetPlayerId }) => {
    const magicResult = lobbyStore.applyMagic({
      tableId,
      socketId: socket.id,
      cardType,
      targetPlayerId,
    });

    if (!magicResult.ok) {
      socket.emit('table:error', { message: magicResult.error ?? 'Failed to use magic' });
      return;
    }

    io.to(tableId).emit('magic:resolved', magicResult.resolved);
    for (const item of magicResult.privateEvents) {
      io.to(item.socketId).emit('magic:private', item.event);
    }

    broadcastTableState(tableId);
  });

  socket.on('magic:buy', ({ tableId }, ack) => {
    const result = lobbyStore.buyMagicCard({ tableId, socketId: socket.id });

    if (!result.ok) {
      ack({ ok: false, error: result.error ?? 'Failed to buy magic card' });
      socket.emit('table:error', { message: result.error ?? 'Failed to buy magic card' });
      return;
    }

    broadcastTableState(tableId);
    ack({ ok: true });
  });

  socket.on('disconnect', () => {
    const tableId = lobbyStore.getTableIdBySocket(socket.id);
    if (!tableId) {
      return;
    }

    const disconnectResult = lobbyStore.markDisconnected({ tableId, socketId: socket.id });
    if (disconnectResult.ok) {
      broadcastTableState(tableId);
      console.log(`[table] ${socket.id} disconnected from ${tableId}`);
    }
  });
});

const PORT = Number(process.env.PORT ?? 4000);
httpServer.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});
