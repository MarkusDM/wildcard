import type {
  GamePhase,
  MagicCardType,
  MagicPrivateEvent,
  MagicResolvedEvent,
  PlayerActionType,
  PlayerStatus,
  TableAccess,
  TableId,
  TableKind,
  TablePlayer,
  TablePot,
  TablePrivateState,
  TableState,
  TableSummary,
} from '../../../shared/socket-events';
import {
  formatMicroUsdc,
  MIN_RAISE_INCREMENT_MICRO_USDC,
  stakeToMicroUsdc,
} from '../../../shared/usdc';
import { compareHandScores, evaluateBestHand } from './hand-evaluator';

const ALLOWED_STAKES = new Set([5]);
const MAX_PLAYERS = 2;
const MIN_PLAYERS_TO_START = 2;
const MAGIC_CARD_PRICE_MICRO_USDC = 500_000;
const MAX_MAGIC_CARDS_PER_PLAYER = 3;
const MAGIC_CARD_POOL: MagicCardType[] = [
  'peek',
  'swap',
  'shield',
  'hex',
  'drain',
  'reroll',
  'ward',
];
const TURN_TIMEOUT_MS = 180_000;
const MAGIC_ATTACK_COST_MICRO_USDC = 500_000;
const RECENT_EVENT_LIMIT = 8;
type ResultWithState = { ok: true; tableState: TableState } | { ok: false; error: string };

interface MutablePlayer {
  socketId: string;
  playerName: string;
  walletAddress: string;
  seatIndex: number;
  ready: boolean;
  inHand: boolean;
  folded: boolean;
  status: PlayerStatus;
  actedThisStreet: boolean;
  currentBetMicroUsdc: number;
  stackMicroUsdc: number;
  totalContributionMicroUsdc: number;
  lockedBuyInMicroUsdc: number;
  magicCards: MagicCardType[];
  magicUsesInMatch: number;
  shieldCharges: number;
}

interface MutableTable {
  tableId: TableId;
  tableName: string;
  createdBy: string;
  kind: TableKind;
  access: TableAccess;
  roomCode: string | null;
  stake: number;
  createdAt: number;
  handId: number;
  players: MutablePlayer[];
  phase: GamePhase;
  potMicroUsdc: number;
  currentBetMicroUsdc: number;
  minimumRaiseToMicroUsdc: number;
  smallBlindMicroUsdc: number;
  bigBlindMicroUsdc: number;
  communityCards: string[];
  currentTurnSocketId: string | null;
  actionDeadlineAt: number | null;
  magicRevenueMicroUsdc: number;
  dealerSeatIndex: number | null;
  smallBlindSeatIndex: number | null;
  bigBlindSeatIndex: number | null;
  activeSeatIndex: number | null;
  winnerSocketId: string | null;
  recentEvents: Array<{ id: string; message: string }>;
  showdownSummary: { title: string; detail: string } | null;
  holeCardsBySocket: Map<string, string[]>;
}

type CreateTableResult = { ok: true; table: TableSummary } | { ok: false; error: string };
type JoinResult = ResultWithState;
type LeaveResult = ResultWithState;
type ReadyResult = ResultWithState;
type ActionResult = ResultWithState;
type MagicResult =
  | {
      ok: true;
      tableState: TableState;
      resolved: MagicResolvedEvent;
      privateEvents: Array<{ socketId: string; event: MagicPrivateEvent }>;
    }
  | { ok: false; error: string };

export interface LobbyStore {
  listTables: () => TableSummary[];
  createTable: (input: {
    creatorSocketId: string;
    playerName: string;
    stake: number;
    tableName?: string;
    kind: TableKind;
    access?: TableAccess;
  }) => CreateTableResult;
  findPrivateRoomByCode: (roomCode: string) => TableSummary | undefined;
  hasTable: (tableId: TableId) => boolean;
  getTableState: (tableId: TableId) => TableState;
  getTableIdBySocket: (socketId: string) => TableId | undefined;
  getPrivateState: (input: { tableId: TableId; socketId: string }) => TablePrivateState;
  joinTable: (input: {
    tableId: TableId;
    socketId: string;
    playerName: string;
    walletAddress: string;
  }) => JoinResult;
  leaveTable: (input: { tableId: TableId; socketId: string }) => LeaveResult;
  setReady: (input: { tableId: TableId; socketId: string; ready: boolean }) => ReadyResult;
  applyAction: (input: {
    tableId: TableId;
    socketId: string;
    action: PlayerActionType;
    amount?: number;
  }) => ActionResult;
  applyMagic: (input: {
    tableId: TableId;
    socketId: string;
    cardType: MagicCardType;
    targetPlayerId?: string;
  }) => MagicResult;
  buyMagicCard: (input: { tableId: TableId; socketId: string }) => ResultWithState;
  expireTurnTimeouts: (now?: number) => TableId[];
  markDisconnected: (input: { tableId: TableId; socketId: string }) => ResultWithState;
  closeTable: (tableId: TableId) => boolean;
}

function randomCard(): string {
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const suits = ['h', 'd', 'c', 's'];
  const rank = ranks[Math.floor(Math.random() * ranks.length)] ?? 'A';
  const suit = suits[Math.floor(Math.random() * suits.length)] ?? 's';
  return `${rank}${suit}`;
}

function generateTableId(): string {
  const fragment = Math.random().toString(36).slice(2, 8);
  return `tb-${fragment}`;
}

function generateRoomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function randomMagicCard(): MagicCardType {
  const index = Math.floor(Math.random() * MAGIC_CARD_POOL.length);
  return MAGIC_CARD_POOL[index] ?? 'peek';
}

function drawMagicHandDefault(size = MAX_MAGIC_CARDS_PER_PLAYER): MagicCardType[] {
  return Array.from({ length: size }, () => randomMagicCard());
}

function handCategoryName(category: number): string {
  switch (category) {
    case 8:
      return 'Straight Flush';
    case 7:
      return 'Four of a Kind';
    case 6:
      return 'Full House';
    case 5:
      return 'Flush';
    case 4:
      return 'Straight';
    case 3:
      return 'Three of a Kind';
    case 2:
      return 'Two Pair';
    case 1:
      return 'One Pair';
    default:
      return 'High Card';
  }
}

function seatOrderFrom(startSeatIndex: number): number[] {
  return Array.from(
    { length: MAX_PLAYERS },
    (_, offset) => (startSeatIndex + offset) % MAX_PLAYERS,
  );
}

function bigBlindForStake(stake: number): number {
  return Math.max(MIN_RAISE_INCREMENT_MICRO_USDC, Math.floor(stakeToMicroUsdc(stake) / 10));
}

function smallBlindForStake(stake: number): number {
  return Math.max(Math.floor(bigBlindForStake(stake) / 2), 125_000);
}

function isActionPhase(phase: GamePhase): boolean {
  return phase === 'preflop' || phase === 'flop' || phase === 'turn' || phase === 'river';
}

function computeSidePots(players: MutablePlayer[]): TablePot[] {
  const levels = [
    ...new Set(
      players.map((player) => player.totalContributionMicroUsdc).filter((value) => value > 0),
    ),
  ].sort((left, right) => left - right);

  const pots: TablePot[] = [];
  let previousLevel = 0;

  for (const level of levels) {
    const contributors = players.filter((player) => player.totalContributionMicroUsdc >= level);
    const amountMicroUsdc = (level - previousLevel) * contributors.length;
    const eligibleSeatIndexes = contributors
      .filter((player) => !player.folded)
      .map((player) => player.seatIndex);

    if (amountMicroUsdc > 0) {
      pots.push({ amountMicroUsdc, eligibleSeatIndexes });
    }

    previousLevel = level;
  }

  return pots;
}

function bestWinners(
  players: MutablePlayer[],
  board: string[],
  holeCardsBySocket: Map<string, string[]>,
): MutablePlayer[] {
  let currentBest: ReturnType<typeof evaluateBestHand> | null = null;
  let winners: MutablePlayer[] = [];

  for (const player of players) {
    const cards = [...(holeCardsBySocket.get(player.socketId) ?? []), ...board];
    const score = evaluateBestHand(cards);
    if (!currentBest || compareHandScores(score, currentBest) > 0) {
      currentBest = score;
      winners = [player];
      continue;
    }

    if (compareHandScores(score, currentBest) === 0) {
      winners.push(player);
    }
  }

  return winners;
}

export function createLobbyStore(input?: {
  drawMagicHand?: (size?: number) => MagicCardType[];
  drawMagicCard?: () => MagicCardType;
}): LobbyStore {
  const tables = new Map<TableId, MutableTable>();
  const socketToTable = new Map<string, TableId>();
  const drawMagicHand = input?.drawMagicHand ?? drawMagicHandDefault;
  const drawMagicCard = input?.drawMagicCard ?? randomMagicCard;
  function getTableOrUndefined(tableId: TableId): MutableTable | undefined {
    return tables.get(tableId);
  }

  function pushRecentEvent(table: MutableTable, message: string): void {
    table.recentEvents = [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, message },
      ...table.recentEvents,
    ].slice(0, RECENT_EVENT_LIMIT);
  }

  function playerLabel(player: MutablePlayer): string {
    return player.playerName;
  }

  function describeBestHand(table: MutableTable, player: MutablePlayer): string {
    const cards = [
      ...(table.holeCardsBySocket.get(player.socketId) ?? []),
      ...table.communityCards,
    ];
    const best = evaluateBestHand(cards);
    return handCategoryName(best.category);
  }

  function setShowdownSummary(
    table: MutableTable,
    winners: MutablePlayer[],
    potMicroUsdc: number,
  ): void {
    if (winners.length === 0) {
      table.showdownSummary = null;
      return;
    }

    const winnerNames = winners
      .map((winner) => winner.playerName)
      .join(winners.length === 2 ? ' and ' : ', ');
    const handName = describeBestHand(table, winners[0]);
    const potText = formatMicroUsdc(potMicroUsdc);
    table.showdownSummary = {
      title: winners.length > 1 ? `${winnerNames} split the pot` : `${winnerNames} wins the hand`,
      detail:
        winners.length > 1
          ? `${handName} • Split pot ${potText} USDC`
          : `${handName} • Won ${potText} USDC`,
    };
  }

  function nextOccupiedSeat(
    table: MutableTable,
    fromSeatIndex: number,
    predicate?: (player: MutablePlayer) => boolean,
  ): number | null {
    for (const seatIndex of seatOrderFrom((fromSeatIndex + 1) % MAX_PLAYERS)) {
      const player = table.players.find((candidate) => candidate.seatIndex === seatIndex);
      if (player && (!predicate || predicate(player))) {
        return seatIndex;
      }
    }

    return null;
  }

  function activeHandPlayers(table: MutableTable): MutablePlayer[] {
    return table.players.filter((player) => player.inHand && !player.folded);
  }

  function actionablePlayers(table: MutableTable): MutablePlayer[] {
    return table.players.filter(
      (player) => player.inHand && !player.folded && player.status === 'active',
    );
  }

  function seatToPositionLabel(table: MutableTable, player: MutablePlayer): string {
    if (!player.inHand) {
      return 'Seat';
    }

    if (player.seatIndex === table.dealerSeatIndex) return 'Dealer';
    if (player.seatIndex === table.smallBlindSeatIndex) return 'Small Blind';
    if (player.seatIndex === table.bigBlindSeatIndex) return 'Big Blind';

    const nonFolded = activeHandPlayers(table).sort(
      (left, right) => left.seatIndex - right.seatIndex,
    );
    const dealerIndex = nonFolded.findIndex(
      (candidate) => candidate.seatIndex === table.dealerSeatIndex,
    );
    const playerIndex = nonFolded.findIndex((candidate) => candidate.socketId === player.socketId);
    if (dealerIndex < 0 || playerIndex < 0) {
      return 'Seat';
    }

    const relative = (playerIndex - dealerIndex - 1 + nonFolded.length) % nonFolded.length;
    if (relative === 0) return 'UTG';
    if (relative === nonFolded.length - 1) return 'CO';
    if (relative === nonFolded.length - 2) return 'MP';
    return 'Seat';
  }

  function canStart(table: MutableTable): boolean {
    const readyPlayers = table.players.filter((player) => player.ready);
    return readyPlayers.length >= MIN_PLAYERS_TO_START && !isActionPhase(table.phase);
  }

  function minimumCallForPlayer(table: MutableTable, player: MutablePlayer | undefined): number {
    if (!player) return 0;
    return Math.max(0, table.currentBetMicroUsdc - player.currentBetMicroUsdc);
  }

  function refreshMinimumRaise(table: MutableTable): void {
    table.minimumRaiseToMicroUsdc =
      table.currentBetMicroUsdc === 0
        ? Math.max(table.bigBlindMicroUsdc, MIN_RAISE_INCREMENT_MICRO_USDC)
        : table.currentBetMicroUsdc +
          Math.max(table.bigBlindMicroUsdc, MIN_RAISE_INCREMENT_MICRO_USDC);
  }

  function updateTurn(table: MutableTable, fromSeatIndex: number | null): void {
    const activePlayers = actionablePlayers(table);
    if (activePlayers.length === 0) {
      table.activeSeatIndex = null;
      table.currentTurnSocketId = null;
      table.actionDeadlineAt = null;
      return;
    }

    const startSeat = fromSeatIndex ?? table.dealerSeatIndex ?? -1;
    const nextSeat = nextOccupiedSeat(
      table,
      startSeat,
      (player) => player.inHand && !player.folded && player.status === 'active',
    );
    table.activeSeatIndex = nextSeat;
    table.currentTurnSocketId =
      nextSeat === null
        ? null
        : (table.players.find((player) => player.seatIndex === nextSeat)?.socketId ?? null);
    table.actionDeadlineAt = table.currentTurnSocketId ? Date.now() + TURN_TIMEOUT_MS : null;
  }

  function toPlayer(table: MutableTable, player: MutablePlayer): TablePlayer {
    return {
      socketId: player.socketId,
      playerName: player.playerName,
      ready: player.ready,
      inHand: player.inHand,
      folded: player.folded,
      status: player.status,
      seatIndex: player.seatIndex,
      positionLabel: seatToPositionLabel(table, player),
      actedThisStreet: player.actedThisStreet,
      currentBetMicroUsdc: player.currentBetMicroUsdc,
      stackMicroUsdc: player.stackMicroUsdc,
      totalContributionMicroUsdc: player.totalContributionMicroUsdc,
      lockedBuyInMicroUsdc: player.lockedBuyInMicroUsdc,
      magicCardsCount: player.magicCards.length,
      walletAddress: player.walletAddress,
    };
  }

  function toState(table: MutableTable): TableState {
    const actingPlayer = table.currentTurnSocketId
      ? table.players.find((player) => player.socketId === table.currentTurnSocketId)
      : undefined;
    const revealedHoleCardsBySocketId =
      table.phase === 'showdown'
        ? Object.fromEntries(
            table.players.map((player) => [
              player.socketId,
              [...(table.holeCardsBySocket.get(player.socketId) ?? [])],
            ]),
          )
        : {};

    return {
      tableId: table.tableId,
      handId: table.handId,
      kind: table.kind,
      access: table.access,
      roomCode: table.roomCode,
      stake: table.stake,
      maxPlayers: MAX_PLAYERS,
      minPlayersToStart: MIN_PLAYERS_TO_START,
      canStart: canStart(table),
      phase: table.phase,
      potMicroUsdc: table.potMicroUsdc,
      sidePots: computeSidePots(table.players),
      currentBetMicroUsdc: table.currentBetMicroUsdc,
      minimumRaiseToMicroUsdc: table.minimumRaiseToMicroUsdc,
      minimumCallToMicroUsdc: minimumCallForPlayer(table, actingPlayer),
      smallBlindMicroUsdc: table.smallBlindMicroUsdc,
      bigBlindMicroUsdc: table.bigBlindMicroUsdc,
      dealerSeatIndex: table.dealerSeatIndex,
      smallBlindSeatIndex: table.smallBlindSeatIndex,
      bigBlindSeatIndex: table.bigBlindSeatIndex,
      activeSeatIndex: table.activeSeatIndex,
      currentTurnSocketId: table.currentTurnSocketId,
      actionDeadlineAt: table.actionDeadlineAt,
      magicRevenueMicroUsdc: table.magicRevenueMicroUsdc,
      communityCards: [...table.communityCards],
      revealedHoleCardsBySocketId,
      winnerSocketId: table.winnerSocketId,
      recentEvents: table.recentEvents.map((event) => ({ ...event })),
      showdownSummary: table.showdownSummary ? { ...table.showdownSummary } : null,
      players: table.players.map((player) => toPlayer(table, player)),
    };
  }

  function toSummary(table: MutableTable): TableSummary {
    return {
      tableId: table.tableId,
      tableName: table.tableName,
      createdBy: table.createdBy,
      kind: table.kind,
      access: table.access,
      roomCode: table.roomCode,
      stake: table.stake,
      playersCount: table.players.length,
      maxPlayers: MAX_PLAYERS,
      minPlayersToStart: MIN_PLAYERS_TO_START,
      smallBlindMicroUsdc: table.smallBlindMicroUsdc,
      bigBlindMicroUsdc: table.bigBlindMicroUsdc,
    };
  }

  function resetStreet(
    table: MutableTable,
    phase: Exclude<GamePhase, 'waiting' | 'showdown'>,
  ): void {
    table.phase = phase;
    table.currentBetMicroUsdc = 0;
    refreshMinimumRaise(table);

    for (const player of table.players) {
      if (!player.inHand || player.folded) continue;
      player.currentBetMicroUsdc = 0;
      player.actedThisStreet = false;
      player.status = player.stackMicroUsdc === 0 ? 'all-in' : 'active';
    }

    if (phase === 'preflop') {
      updateTurn(table, table.bigBlindSeatIndex);
      return;
    }

    updateTurn(table, table.dealerSeatIndex);
  }

  function awardSingleWinner(table: MutableTable, winner: MutablePlayer): void {
    const finalPotMicroUsdc = table.potMicroUsdc;
    winner.stackMicroUsdc += table.potMicroUsdc;
    table.winnerSocketId = winner.socketId;
    setShowdownSummary(table, [winner], finalPotMicroUsdc);
    pushRecentEvent(
      table,
      `${playerLabel(winner)} wins ${formatMicroUsdc(finalPotMicroUsdc)} USDC`,
    );
    table.phase = 'showdown';
    table.currentTurnSocketId = null;
    table.activeSeatIndex = null;
    table.actionDeadlineAt = null;
    table.currentBetMicroUsdc = 0;
    refreshMinimumRaise(table);
    while (table.communityCards.length < 5) {
      table.communityCards.push(randomCard());
    }

    for (const player of table.players) {
      player.inHand = false;
      player.ready = false;
      player.currentBetMicroUsdc = 0;
      player.totalContributionMicroUsdc = 0;
      player.actedThisStreet = false;
      player.shieldCharges = 0;
      player.folded = false;
      player.status = player.ready ? 'active' : 'sit-out';
    }

    table.potMicroUsdc = 0;
  }

  function settleShowdown(table: MutableTable): void {
    const finalPotMicroUsdc = table.potMicroUsdc;
    const pots = computeSidePots(table.players);
    for (const pot of pots) {
      const eligible = table.players.filter(
        (player) => pot.eligibleSeatIndexes.includes(player.seatIndex) && !player.folded,
      );
      if (eligible.length === 0) {
        continue;
      }

      const winners = bestWinners(eligible, table.communityCards, table.holeCardsBySocket).sort(
        (left, right) => left.seatIndex - right.seatIndex,
      );
      const baseShare = Math.floor(pot.amountMicroUsdc / winners.length);
      let remainder = pot.amountMicroUsdc % winners.length;

      for (const winner of winners) {
        winner.stackMicroUsdc += baseShare + (remainder > 0 ? 1 : 0);
        if (remainder > 0) {
          remainder -= 1;
        }
      }
    }

    const showdownPlayers = table.players.filter((player) => !player.folded);
    if (showdownPlayers.length > 0) {
      const winners = bestWinners(showdownPlayers, table.communityCards, table.holeCardsBySocket);
      table.winnerSocketId = winners[0]?.socketId ?? null;
      setShowdownSummary(table, winners, finalPotMicroUsdc);
      pushRecentEvent(
        table,
        winners.length > 1
          ? `${winners.map((winner) => playerLabel(winner)).join(', ')} split ${formatMicroUsdc(finalPotMicroUsdc)} USDC`
          : `${playerLabel(winners[0])} wins showdown with ${describeBestHand(table, winners[0])}`,
      );
    } else {
      table.winnerSocketId = null;
      table.showdownSummary = null;
    }

    table.phase = 'showdown';
    table.currentTurnSocketId = null;
    table.activeSeatIndex = null;
    table.actionDeadlineAt = null;
    table.currentBetMicroUsdc = 0;
    refreshMinimumRaise(table);

    for (const player of table.players) {
      player.inHand = false;
      player.ready = false;
      player.currentBetMicroUsdc = 0;
      player.totalContributionMicroUsdc = 0;
      player.actedThisStreet = false;
      player.shieldCharges = 0;
      player.folded = false;
      player.status = player.ready ? 'active' : 'sit-out';
    }

    table.potMicroUsdc = 0;
  }

  function runOutToShowdown(table: MutableTable): void {
    while (table.communityCards.length < 5) {
      table.communityCards.push(randomCard());
    }
    settleShowdown(table);
  }

  function advanceStreet(table: MutableTable): void {
    if (table.phase === 'preflop') {
      table.communityCards.push(randomCard(), randomCard(), randomCard());
      pushRecentEvent(table, 'Flop dealt');
      resetStreet(table, 'flop');
      return;
    }

    if (table.phase === 'flop') {
      table.communityCards.push(randomCard());
      pushRecentEvent(table, 'Turn dealt');
      resetStreet(table, 'turn');
      return;
    }

    if (table.phase === 'turn') {
      table.communityCards.push(randomCard());
      pushRecentEvent(table, 'River dealt');
      resetStreet(table, 'river');
      return;
    }

    pushRecentEvent(table, 'Cards revealed at showdown');
    runOutToShowdown(table);
  }
  function finalizeAction(table: MutableTable, actingSeatIndex: number): void {
    const contenders = activeHandPlayers(table);
    if (contenders.length === 1) {
      awardSingleWinner(table, contenders[0]);
      return;
    }

    const playersWhoCanAct = actionablePlayers(table);
    if (playersWhoCanAct.length === 0) {
      runOutToShowdown(table);
      return;
    }

    const streetClosed = playersWhoCanAct.every(
      (player) =>
        player.actedThisStreet && player.currentBetMicroUsdc === table.currentBetMicroUsdc,
    );

    if (streetClosed) {
      advanceStreet(table);
      return;
    }

    updateTurn(table, actingSeatIndex);
  }

  function postBlind(table: MutableTable, seatIndex: number | null, amountMicroUsdc: number): void {
    if (seatIndex === null) return;

    const player = table.players.find((candidate) => candidate.seatIndex === seatIndex);
    if (!player) return;

    const contribution = Math.min(amountMicroUsdc, player.stackMicroUsdc);
    player.stackMicroUsdc -= contribution;
    player.currentBetMicroUsdc += contribution;
    player.totalContributionMicroUsdc += contribution;
    player.actedThisStreet = false;
    player.status = player.stackMicroUsdc === 0 ? 'all-in' : 'active';
    table.potMicroUsdc += contribution;
    table.currentBetMicroUsdc = Math.max(table.currentBetMicroUsdc, player.currentBetMicroUsdc);
  }

  function maybeStartGame(table: MutableTable): void {
    const participants = table.players.filter((player) => player.ready);
    if (participants.length < MIN_PLAYERS_TO_START) {
      return;
    }

    table.handId += 1;
    table.phase = 'preflop';
    table.potMicroUsdc = 0;
    table.currentBetMicroUsdc = 0;
    table.winnerSocketId = null;
    table.showdownSummary = null;
    table.communityCards = [];
    table.holeCardsBySocket = new Map();

    const dealerSeed =
      table.dealerSeatIndex ?? participants[participants.length - 1]?.seatIndex ?? 0;
    table.dealerSeatIndex =
      nextOccupiedSeat(table, dealerSeed, (player) => player.ready) ??
      participants[0]?.seatIndex ??
      0;
    table.smallBlindSeatIndex = nextOccupiedSeat(
      table,
      table.dealerSeatIndex,
      (player) => player.ready,
    );
    table.bigBlindSeatIndex =
      nextOccupiedSeat(
        table,
        table.smallBlindSeatIndex ?? table.dealerSeatIndex,
        (player) => player.ready,
      ) ?? table.smallBlindSeatIndex;

    for (const player of table.players) {
      const participating = player.ready;
      player.inHand = participating;
      player.folded = false;
      player.currentBetMicroUsdc = 0;
      player.totalContributionMicroUsdc = 0;
      player.actedThisStreet = false;
      player.magicUsesInMatch = 0;
      player.shieldCharges = 0;
      player.status = participating ? 'active' : 'sit-out';
      player.ready = false;

      if (participating) {
        table.holeCardsBySocket.set(player.socketId, [randomCard(), randomCard()]);
      }
    }

    postBlind(table, table.smallBlindSeatIndex, table.smallBlindMicroUsdc);
    postBlind(table, table.bigBlindSeatIndex, table.bigBlindMicroUsdc);
    refreshMinimumRaise(table);
    updateTurn(table, table.bigBlindSeatIndex);
    pushRecentEvent(table, `Hand #${table.handId} started`);
  }

  function removeTableIfEmpty(tableId: TableId): void {
    const table = tables.get(tableId);
    if (!table) {
      return;
    }

    if (table.players.length === 0) {
      tables.delete(tableId);
      return;
    }
  }

  function rebindPlayerSocket(
    table: MutableTable,
    player: MutablePlayer,
    nextSocketId: string,
  ): void {
    const previousSocketId = player.socketId;
    if (previousSocketId === nextSocketId) {
      return;
    }

    const previousHoleCards = table.holeCardsBySocket.get(previousSocketId);
    if (previousHoleCards) {
      table.holeCardsBySocket.set(nextSocketId, previousHoleCards);
      table.holeCardsBySocket.delete(previousSocketId);
    }

    if (table.currentTurnSocketId === previousSocketId) {
      table.currentTurnSocketId = nextSocketId;
    }
    if (table.winnerSocketId === previousSocketId) {
      table.winnerSocketId = nextSocketId;
    }

    socketToTable.delete(previousSocketId);
    player.socketId = nextSocketId;
  }

  function closeTable(tableId: TableId): boolean {
    const table = tables.get(tableId);
    if (!table) {
      return false;
    }

    for (const player of table.players) {
      socketToTable.delete(player.socketId);
    }

    tables.delete(tableId);
    return true;
  }

  function listTables(): TableSummary[] {
    return [...tables.values()]
      .filter((table) => table.access === 'public')
      .sort((left, right) => {
        if (left.stake !== right.stake) return left.stake - right.stake;
        return left.createdAt - right.createdAt;
      })
      .map((table) => toSummary(table));
  }

  function createTable(input: {
    creatorSocketId: string;
    playerName: string;
    stake: number;
    tableName?: string;
    kind: TableKind;
    access?: TableAccess;
  }): CreateTableResult {
    const playerName = input.playerName.trim();
    if (!playerName) return { ok: false, error: 'Player name is required' };
    if (input.kind !== 'cash') return { ok: false, error: 'Table mode is not supported' };
    if (!ALLOWED_STAKES.has(input.stake)) return { ok: false, error: 'Stake is not supported' };
    const access: TableAccess = input.access ?? 'public';
    if (access !== 'public' && access !== 'private')
      return { ok: false, error: 'Table access is not supported' };

    let tableId = generateTableId();
    while (tables.has(tableId)) {
      tableId = generateTableId();
    }

    let roomCode: string | null = null;
    if (access === 'private') {
      roomCode = generateRoomCode();
      while ([...tables.values()].some((table) => table.roomCode === roomCode)) {
        roomCode = generateRoomCode();
      }
    }

    const table: MutableTable = {
      tableId,
      tableName: input.tableName?.trim() || `${input.stake} USDC Table`,
      createdBy: playerName,
      kind: input.kind,
      access,
      roomCode,
      stake: input.stake,
      createdAt: Date.now(),
      handId: 0,
      players: [],
      phase: 'waiting',
      potMicroUsdc: 0,
      currentBetMicroUsdc: 0,
      minimumRaiseToMicroUsdc: Math.max(
        bigBlindForStake(input.stake),
        MIN_RAISE_INCREMENT_MICRO_USDC,
      ),
      smallBlindMicroUsdc: smallBlindForStake(input.stake),
      bigBlindMicroUsdc: bigBlindForStake(input.stake),
      communityCards: [],
      currentTurnSocketId: null,
      actionDeadlineAt: null,
      magicRevenueMicroUsdc: 0,
      dealerSeatIndex: null,
      smallBlindSeatIndex: null,
      bigBlindSeatIndex: null,
      activeSeatIndex: null,
      winnerSocketId: null,
      recentEvents: [],
      showdownSummary: null,
      holeCardsBySocket: new Map(),
    };

    tables.set(tableId, table);
    return { ok: true, table: toSummary(table) };
  }

  function findPrivateRoomByCode(roomCode: string): TableSummary | undefined {
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    if (!normalizedRoomCode) {
      return undefined;
    }

    const table = [...tables.values()].find(
      (candidate) => candidate.access === 'private' && candidate.roomCode === normalizedRoomCode,
    );

    return table ? toSummary(table) : undefined;
  }

  function hasTable(tableId: TableId): boolean {
    return tables.has(tableId);
  }

  function getTableState(tableId: TableId): TableState {
    const table = getTableOrUndefined(tableId);
    if (!table) {
      throw new Error(`Unknown tableId: ${tableId}`);
    }

    return toState(table);
  }

  function getTableIdBySocket(socketId: string): TableId | undefined {
    return socketToTable.get(socketId);
  }

  function getPrivateState(input: { tableId: TableId; socketId: string }): TablePrivateState {
    const table = getTableOrUndefined(input.tableId);
    if (!table) {
      throw new Error(`Unknown tableId: ${input.tableId}`);
    }

    const player = table.players.find((candidate) => candidate.socketId === input.socketId);
    return {
      tableId: table.tableId,
      holeCards: [...(table.holeCardsBySocket.get(input.socketId) ?? [])],
      magicCards: [...(player?.magicCards ?? [])],
      magicUsesInMatch: player?.magicUsesInMatch ?? 0,
      magicUsesLeft: player?.magicCards.length ?? 0,
      shieldActive: (player?.shieldCharges ?? 0) > 0,
      shieldCharges: player?.shieldCharges ?? 0,
    };
  }

  function joinTable(input: {
    tableId: TableId;
    socketId: string;
    playerName: string;
    walletAddress: string;
  }): JoinResult {
    const table = getTableOrUndefined(input.tableId);
    if (!table) return { ok: false, error: 'Unknown table' };

    const playerName = input.playerName.trim();
    if (!playerName) return { ok: false, error: 'Player name is required' };
    const normalizedWallet = input.walletAddress.toLowerCase();

    const previousTableId = socketToTable.get(input.socketId);
    if (previousTableId && previousTableId !== input.tableId) {
      const previousTable = tables.get(previousTableId);
      if (previousTable) {
        previousTable.players = previousTable.players.filter(
          (player) => player.socketId !== input.socketId,
        );
        previousTable.holeCardsBySocket.delete(input.socketId);
      }
      removeTableIfEmpty(previousTableId);
    }

    let player = table.players.find((candidate) => candidate.socketId === input.socketId);
    if (!player) {
      player = table.players.find((candidate) => candidate.walletAddress === normalizedWallet);
      if (player) {
        rebindPlayerSocket(table, player, input.socketId);
      }
    }
    if (!player) {
      if (table.players.length >= MAX_PLAYERS) {
        return { ok: false, error: 'Table is full' };
      }

      const seatIndex = Array.from({ length: MAX_PLAYERS }, (_, index) => index).find(
        (index) => !table.players.some((candidate) => candidate.seatIndex === index),
      );
      if (seatIndex === undefined) {
        return { ok: false, error: 'No free seats' };
      }

      player = {
        socketId: input.socketId,
        playerName,
        walletAddress: normalizedWallet,
        seatIndex,
        ready: false,
        inHand: false,
        folded: false,
        status: 'sit-out',
        actedThisStreet: false,
        currentBetMicroUsdc: 0,
        stackMicroUsdc: stakeToMicroUsdc(table.stake),
        totalContributionMicroUsdc: 0,
        lockedBuyInMicroUsdc: table.kind === 'cash' ? stakeToMicroUsdc(table.stake) : 0,
        magicCards: drawMagicHand(),
        magicUsesInMatch: 0,
        shieldCharges: 0,
      };
      table.players.push(player);
      pushRecentEvent(table, `${player.playerName} joined the table`);
    } else {
      player.playerName = playerName;
      player.walletAddress = normalizedWallet;
      if (player.status === 'disconnected') {
        player.status =
          player.inHand && !player.folded ? 'active' : player.ready ? 'active' : 'sit-out';
      }
      pushRecentEvent(table, `${player.playerName} rejoined the table`);
    }

    socketToTable.set(input.socketId, input.tableId);
    return { ok: true, tableState: toState(table) };
  }
  function leaveTable(input: { tableId: TableId; socketId: string }): LeaveResult {
    const table = getTableOrUndefined(input.tableId);
    if (!table) return { ok: false, error: 'Unknown table' };

    const player = table.players.find((candidate) => candidate.socketId === input.socketId);
    if (!player) {
      return { ok: false, error: 'Player is not in table' };
    }

    if (isActionPhase(table.phase)) {
      return {
        ok: false,
        error: 'Cannot leave during an active hand. Use Cash out after the hand ends.',
      };
    }

    if (table.handId > 0 && player.lockedBuyInMicroUsdc > 0) {
      return { ok: false, error: 'Use Cash out to settle the table before leaving.' };
    }

    const seatIndex = player.seatIndex;
    table.players = table.players.filter((candidate) => candidate.socketId !== input.socketId);
    table.holeCardsBySocket.delete(input.socketId);
    socketToTable.delete(input.socketId);
    pushRecentEvent(table, `${playerLabel(player)} left the table`);

    if (isActionPhase(table.phase)) {
      if (table.currentTurnSocketId === input.socketId) {
        updateTurn(table, seatIndex);
      }
      finalizeAction(table, seatIndex);
    }

    removeTableIfEmpty(input.tableId);
    return { ok: true, tableState: toState(table) };
  }

  function markDisconnected(input: { tableId: TableId; socketId: string }): ResultWithState {
    const table = getTableOrUndefined(input.tableId);
    if (!table) return { ok: false, error: 'Unknown table' };

    const player = table.players.find((candidate) => candidate.socketId === input.socketId);
    if (!player) {
      return { ok: false, error: 'Player is not in table' };
    }

    socketToTable.delete(input.socketId);
    player.ready = false;

    if (isActionPhase(table.phase) && player.inHand && !player.folded) {
      if (table.currentTurnSocketId === input.socketId) {
        player.folded = true;
        player.status = 'folded';
        player.actedThisStreet = true;
        pushRecentEvent(table, `${playerLabel(player)} disconnected and was folded`);
        finalizeAction(table, player.seatIndex);
      } else {
        player.status = 'disconnected';
        pushRecentEvent(table, `${playerLabel(player)} disconnected`);
      }
    } else {
      player.inHand = false;
      player.folded = false;
      player.status = 'disconnected';
      pushRecentEvent(table, `${playerLabel(player)} disconnected`);
    }

    return { ok: true, tableState: toState(table) };
  }

  function setReady(input: { tableId: TableId; socketId: string; ready: boolean }): ReadyResult {
    const table = getTableOrUndefined(input.tableId);
    if (!table) return { ok: false, error: 'Unknown table' };
    if (isActionPhase(table.phase))
      return { ok: false, error: 'Cannot change ready during active hand' };

    const player = table.players.find((candidate) => candidate.socketId === input.socketId);
    if (!player) return { ok: false, error: 'Player is not in table' };

    if (table.phase === 'showdown') {
      table.phase = 'waiting';
      table.actionDeadlineAt = null;
    }

    player.ready = input.ready;
    player.status = input.ready ? 'active' : 'sit-out';
    pushRecentEvent(table, `${playerLabel(player)} ${input.ready ? 'is ready' : 'is not ready'}`);
    maybeStartGame(table);
    return { ok: true, tableState: toState(table) };
  }

  function applyContribution(
    table: MutableTable,
    player: MutablePlayer,
    contribution: number,
  ): void {
    player.stackMicroUsdc -= contribution;
    player.currentBetMicroUsdc += contribution;
    player.totalContributionMicroUsdc += contribution;
    table.potMicroUsdc += contribution;
    if (player.stackMicroUsdc === 0) {
      player.status = 'all-in';
    }
  }

  function canTargetMagic(cardType: MagicCardType): boolean {
    return cardType === 'peek' || cardType === 'hex' || cardType === 'drain';
  }

  function resolveTarget(
    table: MutableTable,
    caster: MutablePlayer,
    targetSocketId?: string,
  ): MutablePlayer | undefined {
    const target = table.players.find((player) => player.socketId === targetSocketId);
    if (!target || !target.inHand || target.folded || target.socketId === caster.socketId) {
      return undefined;
    }

    return target;
  }

  function applyShieldBlock(target: MutablePlayer): boolean {
    if (target.shieldCharges <= 0) {
      return false;
    }

    target.shieldCharges -= 1;
    return true;
  }

  function applyAction(input: {
    tableId: TableId;
    socketId: string;
    action: PlayerActionType;
    amount?: number;
  }): ActionResult {
    const table = getTableOrUndefined(input.tableId);
    if (!table) return { ok: false, error: 'Unknown table' };
    if (!isActionPhase(table.phase)) return { ok: false, error: 'Hand is not active' };
    if (table.currentTurnSocketId !== input.socketId) return { ok: false, error: 'Not your turn' };

    const player = table.players.find((candidate) => candidate.socketId === input.socketId);
    if (!player || !player.inHand || player.folded || player.status === 'sit-out') {
      return { ok: false, error: 'Player cannot act' };
    }

    const toCall = Math.max(0, table.currentBetMicroUsdc - player.currentBetMicroUsdc);

    if (input.action === 'fold') {
      player.folded = true;
      player.status = 'folded';
      player.actedThisStreet = true;
      pushRecentEvent(table, `${playerLabel(player)} folded`);
      finalizeAction(table, player.seatIndex);
      return { ok: true, tableState: toState(table) };
    }

    if (input.action === 'check') {
      if (toCall !== 0) return { ok: false, error: 'Cannot check when there is a live bet' };
      player.actedThisStreet = true;
      pushRecentEvent(table, `${playerLabel(player)} checked`);
      finalizeAction(table, player.seatIndex);
      return { ok: true, tableState: toState(table) };
    }

    if (input.action === 'call') {
      const contribution = Math.min(toCall, player.stackMicroUsdc);
      applyContribution(table, player, contribution);
      player.actedThisStreet = true;
      pushRecentEvent(table, `${playerLabel(player)} called ${formatMicroUsdc(contribution)} USDC`);
      finalizeAction(table, player.seatIndex);
      return { ok: true, tableState: toState(table) };
    }

    if (input.action === 'all-in') {
      if (player.stackMicroUsdc <= 0) return { ok: false, error: 'Player has no stack left' };

      const contribution = player.stackMicroUsdc;
      const previousCurrentBet = table.currentBetMicroUsdc;
      applyContribution(table, player, contribution);
      const newBet = player.currentBetMicroUsdc;
      const raiseSize = newBet - previousCurrentBet;

      if (
        newBet > previousCurrentBet &&
        raiseSize >= Math.max(table.bigBlindMicroUsdc, MIN_RAISE_INCREMENT_MICRO_USDC)
      ) {
        table.currentBetMicroUsdc = newBet;
        table.minimumRaiseToMicroUsdc = table.currentBetMicroUsdc + raiseSize;
        for (const candidate of actionablePlayers(table)) {
          candidate.actedThisStreet = false;
        }
      }

      player.actedThisStreet = true;
      pushRecentEvent(
        table,
        `${playerLabel(player)} moved all-in for ${formatMicroUsdc(newBet)} USDC`,
      );
      finalizeAction(table, player.seatIndex);
      return { ok: true, tableState: toState(table) };
    }

    if (input.action === 'raise') {
      if (typeof input.amount !== 'number' || !Number.isInteger(input.amount)) {
        return { ok: false, error: 'Raise amount is required' };
      }

      if (input.amount % MIN_RAISE_INCREMENT_MICRO_USDC !== 0) {
        return { ok: false, error: 'Raise must use clean 0.1 USDC steps' };
      }

      if (input.amount < table.minimumRaiseToMicroUsdc) {
        return { ok: false, error: 'Raise is below the minimum size' };
      }

      const contribution = input.amount - player.currentBetMicroUsdc;
      if (contribution <= 0) {
        return { ok: false, error: 'Raise must increase the current bet' };
      }
      if (contribution > player.stackMicroUsdc) {
        return { ok: false, error: 'Insufficient stack to raise' };
      }

      const previousCurrentBet = table.currentBetMicroUsdc;
      applyContribution(table, player, contribution);
      const raiseSize = input.amount - previousCurrentBet;
      table.currentBetMicroUsdc = input.amount;
      table.minimumRaiseToMicroUsdc = table.currentBetMicroUsdc + raiseSize;

      for (const candidate of actionablePlayers(table)) {
        candidate.actedThisStreet = false;
      }
      player.actedThisStreet = true;
      pushRecentEvent(
        table,
        `${playerLabel(player)} raised to ${formatMicroUsdc(input.amount)} USDC`,
      );
      finalizeAction(table, player.seatIndex);
      return { ok: true, tableState: toState(table) };
    }

    return { ok: false, error: 'Unknown action' };
  }

  function applyMagic(input: {
    tableId: TableId;
    socketId: string;
    cardType: MagicCardType;
    targetPlayerId?: string;
  }): MagicResult {
    const table = getTableOrUndefined(input.tableId);
    if (!table) return { ok: false, error: 'Unknown table' };
    if (!isActionPhase(table.phase))
      return { ok: false, error: 'Magic can be used only during active hand' };

    const caster = table.players.find((player) => player.socketId === input.socketId);
    if (!caster || !caster.inHand || caster.folded)
      return { ok: false, error: 'Caster cannot use magic' };

    const cardIndex = caster.magicCards.indexOf(input.cardType);
    if (cardIndex < 0) return { ok: false, error: 'Magic card is not available in inventory' };

    const privateEvents: Array<{ socketId: string; event: MagicPrivateEvent }> = [];
    const consumeCard = () => {
      caster.magicCards.splice(cardIndex, 1);
      caster.magicUsesInMatch += 1;
    };

    if (input.cardType === 'shield') {
      consumeCard();
      caster.shieldCharges += 1;
      pushRecentEvent(table, `${playerLabel(caster)} used Shield`);
      return {
        ok: true,
        tableState: toState(table),
        privateEvents,
        resolved: {
          tableId: table.tableId,
          cardType: 'shield',
          casterSocketId: caster.socketId,
          status: 'applied',
          message: 'Shield activated',
        },
      };
    }

    if (input.cardType === 'ward') {
      consumeCard();
      caster.shieldCharges += 2;
      pushRecentEvent(table, `${playerLabel(caster)} used Ward`);
      return {
        ok: true,
        tableState: toState(table),
        privateEvents,
        resolved: {
          tableId: table.tableId,
          cardType: 'ward',
          casterSocketId: caster.socketId,
          status: 'applied',
          message: 'Ward charged two spell blocks',
        },
      };
    }

    if (input.cardType === 'swap') {
      if (table.phase !== 'preflop')
        return { ok: false, error: 'Swap can be used only before flop' };
      const cards = table.holeCardsBySocket.get(caster.socketId);
      if (!cards || cards.length < 1) return { ok: false, error: 'No hole cards to swap' };

      consumeCard();
      const replaceIndex = Math.floor(Math.random() * cards.length);
      cards[replaceIndex] = randomCard();
      pushRecentEvent(table, `${playerLabel(caster)} used Swap`);

      return {
        ok: true,
        tableState: toState(table),
        privateEvents,
        resolved: {
          tableId: table.tableId,
          cardType: 'swap',
          casterSocketId: caster.socketId,
          status: 'applied',
          message: 'Caster swapped one hole card',
        },
      };
    }

    if (input.cardType === 'reroll') {
      if (table.phase !== 'preflop')
        return { ok: false, error: 'Reroll can be used only before flop' };
      const cards = table.holeCardsBySocket.get(caster.socketId);
      if (!cards || cards.length < 2) return { ok: false, error: 'No hole cards to reroll' };

      consumeCard();
      cards[0] = randomCard();
      cards[1] = randomCard();
      pushRecentEvent(table, `${playerLabel(caster)} used Reroll`);

      return {
        ok: true,
        tableState: toState(table),
        privateEvents,
        resolved: {
          tableId: table.tableId,
          cardType: 'reroll',
          casterSocketId: caster.socketId,
          status: 'applied',
          message: 'Both hole cards were rerolled',
        },
      };
    }

    if (input.cardType === 'peek') {
      const target = resolveTarget(table, caster, input.targetPlayerId);
      if (!target) {
        return { ok: false, error: 'Invalid peek target' };
      }

      consumeCard();
      if (applyShieldBlock(target)) {
        pushRecentEvent(
          table,
          `${playerLabel(caster)} tried Peek on ${playerLabel(target)}, but it was blocked`,
        );
        return {
          ok: true,
          tableState: toState(table),
          privateEvents,
          resolved: {
            tableId: table.tableId,
            cardType: 'peek',
            casterSocketId: caster.socketId,
            targetSocketId: target.socketId,
            status: 'blocked',
            message: 'Peek was blocked by shield',
          },
        };
      }

      const targetCards = table.holeCardsBySocket.get(target.socketId) ?? [];
      const revealedCard =
        targetCards[Math.floor(Math.random() * targetCards.length)] ?? targetCards[0] ?? '';
      privateEvents.push({
        socketId: caster.socketId,
        event: {
          tableId: table.tableId,
          kind: 'peek-result',
          targetSocketId: target.socketId,
          revealedCard,
        },
      });
      pushRecentEvent(table, `${playerLabel(caster)} peeked at ${playerLabel(target)}`);

      return {
        ok: true,
        tableState: toState(table),
        privateEvents,
        resolved: {
          tableId: table.tableId,
          cardType: 'peek',
          casterSocketId: caster.socketId,
          targetSocketId: target.socketId,
          status: 'applied',
          message: 'Peek resolved',
        },
      };
    }

    if (input.cardType === 'hex') {
      const target = resolveTarget(table, caster, input.targetPlayerId);
      if (!target) {
        return { ok: false, error: 'Invalid hex target' };
      }

      consumeCard();
      if (applyShieldBlock(target)) {
        pushRecentEvent(
          table,
          `${playerLabel(caster)} tried Hex on ${playerLabel(target)}, but it was blocked`,
        );
        return {
          ok: true,
          tableState: toState(table),
          privateEvents,
          resolved: {
            tableId: table.tableId,
            cardType: 'hex',
            casterSocketId: caster.socketId,
            targetSocketId: target.socketId,
            status: 'blocked',
            message: 'Hex was blocked by shield',
          },
        };
      }

      const tribute = Math.min(MAGIC_ATTACK_COST_MICRO_USDC, target.stackMicroUsdc);
      target.stackMicroUsdc -= tribute;
      target.totalContributionMicroUsdc += tribute;
      table.potMicroUsdc += tribute;
      if (target.stackMicroUsdc === 0) {
        target.status = 'all-in';
      }
      pushRecentEvent(
        table,
        `${playerLabel(caster)} hexed ${playerLabel(target)} for ${formatMicroUsdc(tribute)} USDC`,
      );

      return {
        ok: true,
        tableState: toState(table),
        privateEvents,
        resolved: {
          tableId: table.tableId,
          cardType: 'hex',
          casterSocketId: caster.socketId,
          targetSocketId: target.socketId,
          status: 'applied',
          message: `Hex drained ${tribute > 0 ? '0.5' : '0'} USDC into the pot`,
        },
      };
    }

    if (input.cardType === 'drain') {
      const target = resolveTarget(table, caster, input.targetPlayerId);
      if (!target) {
        return { ok: false, error: 'Invalid drain target' };
      }

      consumeCard();
      if (applyShieldBlock(target)) {
        pushRecentEvent(
          table,
          `${playerLabel(caster)} tried Drain on ${playerLabel(target)}, but it was blocked`,
        );
        return {
          ok: true,
          tableState: toState(table),
          privateEvents,
          resolved: {
            tableId: table.tableId,
            cardType: 'drain',
            casterSocketId: caster.socketId,
            targetSocketId: target.socketId,
            status: 'blocked',
            message: 'Drain was blocked by shield',
          },
        };
      }

      const tribute = Math.min(MAGIC_ATTACK_COST_MICRO_USDC, target.stackMicroUsdc);
      target.stackMicroUsdc -= tribute;
      caster.stackMicroUsdc += tribute;
      if (target.stackMicroUsdc === 0) {
        target.status = 'all-in';
      }
      pushRecentEvent(
        table,
        `${playerLabel(caster)} drained ${formatMicroUsdc(tribute)} USDC from ${playerLabel(target)}`,
      );

      return {
        ok: true,
        tableState: toState(table),
        privateEvents,
        resolved: {
          tableId: table.tableId,
          cardType: 'drain',
          casterSocketId: caster.socketId,
          targetSocketId: target.socketId,
          status: 'applied',
          message: `Drain stole ${tribute > 0 ? '0.5' : '0'} USDC`,
        },
      };
    }

    return { ok: false, error: 'Unknown magic card' };
  }

  function buyMagicCard(input: { tableId: TableId; socketId: string }): ResultWithState {
    const table = getTableOrUndefined(input.tableId);
    if (!table) return { ok: false, error: 'Unknown table' };

    const player = table.players.find((candidate) => candidate.socketId === input.socketId);
    if (!player) return { ok: false, error: 'Player is not in table' };
    if (player.magicCards.length >= MAX_MAGIC_CARDS_PER_PLAYER) {
      return { ok: false, error: 'Magic hand is full' };
    }
    if (player.stackMicroUsdc < MAGIC_CARD_PRICE_MICRO_USDC) {
      return { ok: false, error: 'Not enough stack to buy a magic card' };
    }

    player.stackMicroUsdc -= MAGIC_CARD_PRICE_MICRO_USDC;
    table.magicRevenueMicroUsdc += MAGIC_CARD_PRICE_MICRO_USDC;
    const boughtCard = drawMagicCard();
    player.magicCards.push(boughtCard);
    pushRecentEvent(table, `${playerLabel(player)} bought ${boughtCard} for 0.5 USDC`);

    return { ok: true, tableState: toState(table) };
  }

  function expireTurnTimeouts(now = Date.now()): TableId[] {
    const expiredTableIds: TableId[] = [];

    for (const [tableId, table] of tables.entries()) {
      if (!isActionPhase(table.phase) || !table.currentTurnSocketId || !table.actionDeadlineAt) {
        continue;
      }

      if (table.actionDeadlineAt > now) {
        continue;
      }

      const timedOutSocketId = table.currentTurnSocketId;
      const result = applyAction({
        tableId,
        socketId: timedOutSocketId,
        action: 'fold',
      });

      if (result.ok) {
        expiredTableIds.push(tableId);
      }
    }

    return expiredTableIds;
  }

  return {
    listTables,
    createTable,
    findPrivateRoomByCode,
    hasTable,
    getTableState,
    getTableIdBySocket,
    getPrivateState,
    joinTable,
    leaveTable,
    setReady,
    applyAction,
    applyMagic,
    buyMagicCard,
    expireTurnTimeouts,
    markDisconnected,
    closeTable,
  };
}
