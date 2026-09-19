import { describe, expect, it } from 'vitest';
import { createLobbyStore } from '../src/store/lobby-store';
import type { MagicCardType } from '../../shared/socket-events';
import { stakeToMicroUsdc } from '../../shared/usdc';

function createDeterministicStore(nextBoughtCard: MagicCardType = 'hex') {
  return createLobbyStore({
    drawMagicHand: () => ['peek', 'swap', 'shield'],
    drawMagicCard: () => nextBoughtCard,
  });
}

function createTableAndJoinTwoPlayers() {
  const store = createDeterministicStore();
  const created = store.createTable({
    creatorSocketId: 's1',
    playerName: 'A',
    stake: 5,
    tableName: 'Test Table',
    kind: 'cash',
  });

  if (!created.ok) {
    throw new Error(created.error);
  }

  const tableId = created.table.tableId;

  store.joinTable({
    tableId,
    socketId: 's1',
    playerName: 'A',
    walletAddress: '0x1111111111111111111111111111111111111111',
  });
  store.joinTable({
    tableId,
    socketId: 's2',
    playerName: 'B',
    walletAddress: '0x2222222222222222222222222222222222222222',
  });
  store.setReady({ tableId, socketId: 's1', ready: true });
  store.setReady({ tableId, socketId: 's2', ready: true });

  return { store, tableId };
}

describe('lobby store', () => {
  it('creates player-owned table and lists it', () => {
    const store = createDeterministicStore();
    const created = store.createTable({
      creatorSocketId: 'creator-1',
      playerName: 'Creator',
      stake: 5,
      tableName: 'Creator Table',
      kind: 'cash',
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const listed = store.listTables();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.tableId).toBe(created.table.tableId);
    expect(listed[0]?.stake).toBe(5);
    expect(listed[0]?.tableName).toBe('Creator Table');
    expect(listed[0]?.createdBy).toBe('Creator');
  });

  it('keeps private cash rooms out of the public list and allows lookup by code', () => {
    const store = createDeterministicStore();
    const created = store.createTable({
      creatorSocketId: 'creator-2',
      playerName: 'SecretHost',
      stake: 5,
      tableName: 'Secret Duel',
      kind: 'cash',
      access: 'private',
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    expect(created.table.access).toBe('private');
    expect(created.table.roomCode).toBeTruthy();
    expect(store.listTables()).toHaveLength(0);

    const found = store.findPrivateRoomByCode(created.table.roomCode!);
    expect(found?.tableId).toBe(created.table.tableId);
    expect(found?.access).toBe('private');
  });

  it('joins players and enforces max 2 players per table', () => {
    const store = createDeterministicStore();
    const created = store.createTable({
      creatorSocketId: 's1',
      playerName: 'A',
      stake: 5,
      tableName: 'Capacity',
      kind: 'cash',
    });
    if (!created.ok) {
      throw new Error(created.error);
    }
    const tableId = created.table.tableId;

    expect(
      store.joinTable({
        tableId,
        socketId: 's1',
        playerName: 'A',
        walletAddress: '0x1111111111111111111111111111111111111111',
      }).ok,
    ).toBe(true);
    expect(
      store.joinTable({
        tableId,
        socketId: 's2',
        playerName: 'B',
        walletAddress: '0x2222222222222222222222222222222222222222',
      }).ok,
    ).toBe(true);

    const overJoin = store.joinTable({
      tableId,
      socketId: 's3',
      playerName: 'C',
      walletAddress: '0x3333333333333333333333333333333333333333',
    });
    expect(overJoin.ok).toBe(false);
    if (!overJoin.ok) {
      expect(overJoin.error).toBe('Table is full');
    }
  });

  it('starts game only when 2+ players are ready', () => {
    const store = createDeterministicStore();
    const created = store.createTable({
      creatorSocketId: 's1',
      playerName: 'A',
      stake: 5,
      tableName: 'Start Rule',
      kind: 'cash',
    });
    if (!created.ok) {
      throw new Error(created.error);
    }
    const tableId = created.table.tableId;

    store.joinTable({
      tableId,
      socketId: 's1',
      playerName: 'A',
      walletAddress: '0x1111111111111111111111111111111111111111',
    });
    store.joinTable({
      tableId,
      socketId: 's2',
      playerName: 'B',
      walletAddress: '0x2222222222222222222222222222222222222222',
    });

    const readyOne = store.setReady({ tableId, socketId: 's1', ready: true });
    expect(readyOne.ok).toBe(true);
    if (readyOne.ok) {
      expect(readyOne.tableState.phase).toBe('waiting');
      expect(readyOne.tableState.canStart).toBe(false);
    }

    const readyTwo = store.setReady({ tableId, socketId: 's2', ready: true });
    expect(readyTwo.ok).toBe(true);
    if (readyTwo.ok) {
      expect(readyTwo.tableState.phase).toBe('preflop');
      expect(readyTwo.tableState.currentTurnSocketId).toBeTruthy();
      expect(readyTwo.tableState.players.filter((p) => p.inHand)).toHaveLength(2);
      expect(readyTwo.tableState.potMicroUsdc).toBeGreaterThan(0);
      expect(readyTwo.tableState.bigBlindSeatIndex).not.toBeNull();
      expect(readyTwo.tableState.smallBlindSeatIndex).not.toBeNull();
    }
  });

  it('tracks fractional raise and updates stacks in micro-USDC', () => {
    const store = createDeterministicStore();
    const created = store.createTable({
      creatorSocketId: 's1',
      playerName: 'A',
      stake: 5,
      tableName: 'Raise Table',
      kind: 'cash',
    });
    if (!created.ok) {
      throw new Error(created.error);
    }

    const tableId = created.table.tableId;
    store.joinTable({
      tableId,
      socketId: 's1',
      playerName: 'A',
      walletAddress: '0x1111111111111111111111111111111111111111',
    });
    store.joinTable({
      tableId,
      socketId: 's2',
      playerName: 'B',
      walletAddress: '0x2222222222222222222222222222222222222222',
    });
    store.setReady({ tableId, socketId: 's1', ready: true });
    store.setReady({ tableId, socketId: 's2', ready: true });

    const actor1 = store.getTableState(tableId).currentTurnSocketId as string;
    const raise = store.applyAction({
      tableId,
      socketId: actor1,
      action: 'raise',
      amount: 2_000_000,
    });
    expect(raise.ok).toBe(true);
    if (!raise.ok) {
      return;
    }

    const raiser = raise.tableState.players.find((player) => player.socketId === actor1);
    expect(raise.tableState.currentBetMicroUsdc).toBe(2_000_000);
    expect(raise.tableState.potMicroUsdc).toBeGreaterThan(2_000_000);
    expect(raiser?.stackMicroUsdc).toBeLessThan(stakeToMicroUsdc(5));
    expect(raiser?.totalContributionMicroUsdc).toBe(2_000_000);
  });

  it('transitions phases preflop -> flop -> turn -> river -> showdown', () => {
    const { store, tableId } = createTableAndJoinTwoPlayers();

    let state = store.getTableState(tableId);
    expect(state.phase).toBe('preflop');

    for (const expectedPhase of ['flop', 'turn', 'river', 'showdown'] as const) {
      const actor1 = store.getTableState(tableId).currentTurnSocketId;
      expect(actor1).toBeTruthy();
      store.applyAction({ tableId, socketId: actor1 as string, action: 'call' });

      const actor2 = store.getTableState(tableId).currentTurnSocketId;
      expect(actor2).toBeTruthy();
      store.applyAction({ tableId, socketId: actor2 as string, action: 'call' });

      state = store.getTableState(tableId);
      expect(state.phase).toBe(expectedPhase);
    }

    expect(state.winnerSocketId === 's1' || state.winnerSocketId === 's2').toBe(true);
    expect(state.revealedHoleCardsBySocketId.s1).toHaveLength(2);
    expect(state.revealedHoleCardsBySocketId.s2).toHaveLength(2);
  });

  it('enforces max 3 magic uses per match per player', () => {
    const { store, tableId } = createTableAndJoinTwoPlayers();

    expect(store.applyMagic({ tableId, socketId: 's1', cardType: 'shield' }).ok).toBe(true);
    expect(
      store.applyMagic({ tableId, socketId: 's1', cardType: 'peek', targetPlayerId: 's2' }).ok,
    ).toBe(true);
    expect(store.applyMagic({ tableId, socketId: 's1', cardType: 'swap' }).ok).toBe(true);
    const state = store.getPrivateState({ tableId, socketId: 's1' });
    expect(state.magicCards).toHaveLength(0);
  });

  it('allows swap only before flop', () => {
    const { store, tableId } = createTableAndJoinTwoPlayers();

    const preflopSwap = store.applyMagic({ tableId, socketId: 's1', cardType: 'swap' });
    expect(preflopSwap.ok).toBe(true);

    const actor1 = store.getTableState(tableId).currentTurnSocketId as string;
    store.applyAction({ tableId, socketId: actor1, action: 'call' });
    const actor2 = store.getTableState(tableId).currentTurnSocketId as string;
    store.applyAction({ tableId, socketId: actor2, action: 'call' });

    expect(store.getTableState(tableId).phase).toBe('flop');

    const lateSwap = store.applyMagic({ tableId, socketId: 's2', cardType: 'swap' });
    expect(lateSwap.ok).toBe(false);
    if (!lateSwap.ok) {
      expect(lateSwap.error).toBe('Swap can be used only before flop');
    }
  });

  it('shield blocks next incoming targeted magic', () => {
    const { store, tableId } = createTableAndJoinTwoPlayers();

    const shield = store.applyMagic({ tableId, socketId: 's2', cardType: 'shield' });
    expect(shield.ok).toBe(true);

    const peek = store.applyMagic({
      tableId,
      socketId: 's1',
      cardType: 'peek',
      targetPlayerId: 's2',
    });
    expect(peek.ok).toBe(true);

    if (peek.ok) {
      expect(peek.resolved.status).toBe('blocked');
      expect(peek.privateEvents).toHaveLength(0);
    }

    const privateAfter = store.getPrivateState({ tableId, socketId: 's2' });
    expect(privateAfter.shieldActive).toBe(false);
    expect(privateAfter.shieldCharges).toBe(0);
  });

  it('buys magic card for 0.5 USDC when hand has space', () => {
    const store = createDeterministicStore('ward');
    const created = store.createTable({
      creatorSocketId: 's1',
      playerName: 'A',
      stake: 5,
      tableName: 'Test Table',
      kind: 'cash',
    });
    if (!created.ok) {
      throw new Error(created.error);
    }
    const tableId = created.table.tableId;

    store.joinTable({
      tableId,
      socketId: 's1',
      playerName: 'A',
      walletAddress: '0x1111111111111111111111111111111111111111',
    });
    store.joinTable({
      tableId,
      socketId: 's2',
      playerName: 'B',
      walletAddress: '0x2222222222222222222222222222222222222222',
    });
    store.setReady({ tableId, socketId: 's1', ready: true });
    store.setReady({ tableId, socketId: 's2', ready: true });

    expect(store.applyMagic({ tableId, socketId: 's1', cardType: 'shield' }).ok).toBe(true);
    const before = store.getTableState(tableId);
    const playerBefore = before.players.find((player) => player.socketId === 's1');

    const buy = store.buyMagicCard({ tableId, socketId: 's1' });
    expect(buy.ok).toBe(true);
    if (!buy.ok) {
      return;
    }

    const playerAfter = buy.tableState.players.find((player) => player.socketId === 's1');
    expect(playerAfter?.magicCardsCount).toBe(3);
    expect(playerAfter?.stackMicroUsdc).toBe((playerBefore?.stackMicroUsdc ?? 0) - 500_000);
    expect(buy.tableState.magicRevenueMicroUsdc).toBe(500_000);
    const privateAfter = store.getPrivateState({ tableId, socketId: 's1' });
    expect(privateAfter.magicCards).toContain('ward');
  });

  it('auto-folds timed out player turn after deadline', () => {
    const { store, tableId } = createTableAndJoinTwoPlayers();

    const before = store.getTableState(tableId);
    expect(before.phase).toBe('preflop');
    expect(before.currentTurnSocketId).toBeTruthy();
    expect(before.actionDeadlineAt).toBeTruthy();

    const timedOutSocketId = before.currentTurnSocketId as string;
    const expired = store.expireTurnTimeouts((before.actionDeadlineAt as number) + 1);

    expect(expired).toContain(tableId);

    const after = store.getTableState(tableId);
    expect(after.phase).toBe('showdown');
    expect(after.winnerSocketId).toBeTruthy();
    expect(after.winnerSocketId).not.toBe(timedOutSocketId);
  });

  it('keeps disconnected player in table and allows reconnect by wallet', () => {
    const { store, tableId } = createTableAndJoinTwoPlayers();

    const currentTurnSocketId = store.getTableState(tableId).currentTurnSocketId;
    const disconnectSocketId = currentTurnSocketId === 's1' ? 's2' : 's1';
    const disconnectWallet =
      disconnectSocketId === 's1'
        ? '0x1111111111111111111111111111111111111111'
        : '0x2222222222222222222222222222222222222222';

    const disconnected = store.markDisconnected({ tableId, socketId: disconnectSocketId });
    expect(disconnected.ok).toBe(true);
    if (!disconnected.ok) {
      return;
    }

    const afterDisconnect = store.getTableState(tableId);
    const disconnectedPlayer = afterDisconnect.players.find(
      (player) => player.walletAddress === disconnectWallet,
    );
    expect(disconnectedPlayer?.status).toBe('disconnected');

    const rejoin = store.joinTable({
      tableId,
      socketId: 's2-new',
      playerName: 'B',
      walletAddress: disconnectWallet,
    });
    expect(rejoin.ok).toBe(true);
    if (!rejoin.ok) {
      return;
    }

    const afterRejoin = store.getTableState(tableId);
    const reboundPlayer = afterRejoin.players.find((player) => player.socketId === 's2-new');
    expect(reboundPlayer?.walletAddress).toBe(disconnectWallet);
  });

  it('blocks plain leave after a table has played hands and requires cash out', () => {
    const { store, tableId } = createTableAndJoinTwoPlayers();

    const actor1 = store.getTableState(tableId).currentTurnSocketId as string;
    store.applyAction({ tableId, socketId: actor1, action: 'fold' });

    const leave = store.leaveTable({ tableId, socketId: 's1' });
    expect(leave.ok).toBe(false);
    if (!leave.ok) {
      expect(leave.error).toContain('Cash out');
    }
  });

  it('rejects unsupported table modes', () => {
    const store = createDeterministicStore();
    const created = store.createTable({
      creatorSocketId: 'mode-creator',
      playerName: 'Trainer',
      stake: 5,
      tableName: 'Training Room',
      kind: 'training' as never,
    });

    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.error).toBe('Table mode is not supported');
    }
  });

  it('rejects stakes above 5 USDC', () => {
    const store = createDeterministicStore();
    const created = store.createTable({
      creatorSocketId: 'stake-creator',
      playerName: 'Duelist',
      stake: 10,
      tableName: 'High Stake Room',
      kind: 'cash',
    });

    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.error).toBe('Stake is not supported');
    }
  });
});
