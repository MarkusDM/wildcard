export type TableId = string;
export type GamePhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type PlayerActionType = 'fold' | 'check' | 'call' | 'raise' | 'all-in';
export type MagicCardType = 'peek' | 'swap' | 'shield' | 'hex' | 'drain' | 'reroll' | 'ward';
export type PlayerStatus = 'active' | 'folded' | 'all-in' | 'sit-out' | 'disconnected';
export type TableKind = 'cash';
export type TableAccess = 'public' | 'private';

export interface TableSummary {
  tableId: TableId;
  tableName: string;
  createdBy: string;
  kind: TableKind;
  access: TableAccess;
  roomCode: string | null;
  stake: number;
  playersCount: number;
  maxPlayers: number;
  minPlayersToStart: number;
  smallBlindMicroUsdc: number;
  bigBlindMicroUsdc: number;
}

export interface TablePlayer {
  socketId: string;
  playerName: string;
  ready: boolean;
  inHand: boolean;
  folded: boolean;
  status: PlayerStatus;
  seatIndex: number;
  positionLabel: string;
  actedThisStreet: boolean;
  currentBetMicroUsdc: number;
  stackMicroUsdc: number;
  totalContributionMicroUsdc: number;
  lockedBuyInMicroUsdc: number;
  magicCardsCount: number;
  walletAddress: string;
}

export interface TablePot {
  amountMicroUsdc: number;
  eligibleSeatIndexes: number[];
}

export interface TableRecentEvent {
  id: string;
  message: string;
}

export interface TableShowdownSummary {
  title: string;
  detail: string;
}

export interface TableState {
  tableId: TableId;
  handId: number;
  kind: TableKind;
  access: TableAccess;
  roomCode: string | null;
  stake: number;
  maxPlayers: number;
  minPlayersToStart: number;
  canStart: boolean;
  phase: GamePhase;
  potMicroUsdc: number;
  sidePots: TablePot[];
  currentBetMicroUsdc: number;
  minimumRaiseToMicroUsdc: number;
  minimumCallToMicroUsdc: number;
  smallBlindMicroUsdc: number;
  bigBlindMicroUsdc: number;
  dealerSeatIndex: number | null;
  smallBlindSeatIndex: number | null;
  bigBlindSeatIndex: number | null;
  activeSeatIndex: number | null;
  currentTurnSocketId: string | null;
  actionDeadlineAt: number | null;
  magicRevenueMicroUsdc: number;
  communityCards: string[];
  revealedHoleCardsBySocketId: Record<string, string[]>;
  winnerSocketId: string | null;
  recentEvents: TableRecentEvent[];
  showdownSummary: TableShowdownSummary | null;
  players: TablePlayer[];
}

export interface TablePrivateState {
  tableId: TableId;
  holeCards: string[];
  magicCards: MagicCardType[];
  magicUsesInMatch: number;
  magicUsesLeft: number;
  shieldActive: boolean;
  shieldCharges: number;
}

export interface MagicResolvedEvent {
  tableId: TableId;
  cardType: MagicCardType;
  casterSocketId: string;
  targetSocketId?: string;
  status: 'applied' | 'blocked';
  message: string;
}

export interface MagicPrivateEvent {
  tableId: TableId;
  kind: 'peek-result';
  targetSocketId: string;
  revealedCard: string;
}

export interface LobbyListTablesResponse {
  tables: TableSummary[];
}

export interface LobbyCreateTablePayload {
  tableName?: string;
  stake: number;
  playerName: string;
  kind: TableKind;
  access?: TableAccess;
}

export interface LobbyCreateTableResponse {
  ok: boolean;
  table?: TableSummary;
  error?: string;
}

export interface LobbyFindMatchPayload {
  stake: number;
  playerName: string;
}

export interface LobbyFindMatchResponse {
  ok: boolean;
  table?: TableSummary;
  created?: boolean;
  error?: string;
}

export interface LobbyFindPrivateRoomPayload {
  roomCode: string;
}

export interface LobbyFindPrivateRoomResponse {
  ok: boolean;
  table?: TableSummary;
  error?: string;
}

export interface TableJoinPayload {
  tableId: TableId;
  playerName: string;
  walletAddress: string;
}

export interface TableJoinResponse {
  ok: boolean;
  error?: string;
}

export interface TableLeavePayload {
  tableId: TableId;
}

export interface TableClosePayload {
  tableId: TableId;
}

export interface TableCloseResponse {
  ok: boolean;
  error?: string;
}

export interface TableReadyPayload {
  tableId: TableId;
  ready: boolean;
}

export interface TableActionPayload {
  tableId: TableId;
  action: PlayerActionType;
  amountMicroUsdc?: number;
}

export interface MagicUsePayload {
  tableId: TableId;
  cardType: MagicCardType;
  targetPlayerId?: string;
}

export interface MagicBuyPayload {
  tableId: TableId;
}

export interface MagicBuyResponse {
  ok: boolean;
  error?: string;
}

export interface ClientToServerEvents {
  'lobby:listTables': (ack: (response: LobbyListTablesResponse) => void) => void;
  'lobby:createTable': (
    payload: LobbyCreateTablePayload,
    ack: (response: LobbyCreateTableResponse) => void,
  ) => void;
  'lobby:findMatch': (
    payload: LobbyFindMatchPayload,
    ack: (response: LobbyFindMatchResponse) => void,
  ) => void;
  'lobby:findPrivateRoom': (
    payload: LobbyFindPrivateRoomPayload,
    ack: (response: LobbyFindPrivateRoomResponse) => void,
  ) => void;
  'table:join': (payload: TableJoinPayload, ack: (response: TableJoinResponse) => void) => void;
  'table:leave': (payload: TableLeavePayload) => void;
  'table:close': (payload: TableClosePayload, ack: (response: TableCloseResponse) => void) => void;
  'table:ready': (payload: TableReadyPayload) => void;
  'table:action': (payload: TableActionPayload) => void;
  'magic:use': (payload: MagicUsePayload) => void;
  'magic:buy': (payload: MagicBuyPayload, ack: (response: MagicBuyResponse) => void) => void;
}

export interface ServerToClientEvents {
  connected: (payload: { socketId: string }) => void;
  'table:state': (state: TableState) => void;
  'table:closed': (payload: { tableId: TableId; message?: string }) => void;
  'table:private': (state: TablePrivateState) => void;
  'magic:resolved': (event: MagicResolvedEvent) => void;
  'magic:private': (event: MagicPrivateEvent) => void;
  'table:error': (payload: { message: string }) => void;
}
