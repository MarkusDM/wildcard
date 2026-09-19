import Head from 'next/head';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { getSocket } from '../lib/socket';
import { SoundToggle } from '../components/SoundToggle';
import { resumeBackgroundMusic, startBackgroundMusic, stopBackgroundMusic } from '../lib/music';
import {
  connectWallet,
  depositToVault,
  ensureArcNetwork,
  getArcConfig,
  getChainIdHex,
  lockTableBuyIn,
  readLockedBalance,
  readUsdcBalance,
  readVaultBalance,
  waitForTransactionReceipt,
  withdrawFromVault,
} from '../lib/arc-wallet';
import { playSound, setSoundEnabled } from '../lib/sound';
import type {
  LobbyCreateTableResponse,
  LobbyFindMatchResponse,
  LobbyFindPrivateRoomResponse,
  LobbyListTablesResponse,
  TableJoinResponse,
  TableSummary,
} from '../../shared/socket-events';

const FIXED_STAKE = 5;
const ARC_CONFIG = getArcConfig();
const WALLET_CONNECTION_STATE_KEY = 'walletConnectionState';
const SOCKET_ACK_TIMEOUT_MS = 8_000;
type LobbyFlowState = 'lobby' | 'matchmaking' | 'versus';
type TimeoutSocketEmitter = {
  emit: (event: string, ...args: unknown[]) => void;
};

function waitForPresentation(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function sortTables(tables: TableSummary[]): TableSummary[] {
  return [...tables].sort((a, b) => {
    if (a.stake !== b.stake) {
      return a.stake - b.stake;
    }

    return a.tableId.localeCompare(b.tableId);
  });
}

function emitSocketAck<Response>(event: string, payload?: unknown): Promise<Response> {
  const socket = getSocket();
  if (!socket.connected) {
    socket.connect();
  }

  return new Promise((resolve, reject) => {
    const callback = (error: Error | null, response: Response) => {
      if (error) {
        reject(
          new Error(
            'Game server is not responding. Start the backend with npm run dev:server and try again.',
          ),
        );
        return;
      }

      resolve(response);
    };

    const timeoutSocket = socket.timeout(SOCKET_ACK_TIMEOUT_MS) as unknown as TimeoutSocketEmitter;
    if (typeof payload === 'undefined') {
      timeoutSocket.emit(event, callback);
      return;
    }

    timeoutSocket.emit(event, payload, callback);
  });
}

export default function LobbyPage() {
  const router = useRouter();
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [tableName, setTableName] = useState('');
  const stake = FIXED_STAKE;
  const [privateRoomCode, setPrivateRoomCode] = useState('');
  const [depositAmount, setDepositAmount] = useState('5');
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [introVisible, setIntroVisible] = useState(true);
  const [lobbyFlow, setLobbyFlow] = useState<LobbyFlowState>('lobby');
  const [versusName, setVersusName] = useState('Opponent');

  const [walletAddress, setWalletAddress] = useState('');
  const [walletBalance, setWalletBalance] = useState('0');
  const [vaultBalance, setVaultBalance] = useState('0');
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [walletChainOk, setWalletChainOk] = useState(false);

  const [errorMessage, setErrorMessage] = useState('');

  const fetchTables = () => {
    emitSocketAck<LobbyListTablesResponse>('lobby:listTables')
      .then((response) => setTables(sortTables(response.tables)))
      .catch(() => setTables([]));
  };

  const refreshWalletState = async (address: string) => {
    const chainId = await getChainIdHex();
    const chainOk = chainId === ARC_CONFIG.chainIdHex;
    setWalletChainOk(chainOk);

    if (chainOk) {
      const [walletUsdc, depositedUsdc] = await Promise.all([
        readUsdcBalance(address),
        readVaultBalance(address),
      ]);
      setWalletBalance(walletUsdc);
      setVaultBalance(depositedUsdc);
      return;
    }

    setWalletBalance('0');
    setVaultBalance('0');
  };

  const clearWalletState = () => {
    setWalletAddress('');
    setWalletBalance('0');
    setVaultBalance('0');
    setWalletChainOk(false);
    window.localStorage.removeItem('walletAddress');
  };

  useEffect(() => {
    startBackgroundMusic('lobby');
    return () => stopBackgroundMusic();
  }, []);

  useEffect(() => {
    const savedName = window.localStorage.getItem('playerName') ?? '';
    setPlayerName(savedName);

    const socket = getSocket();
    fetchTables();
    socket.on('connect', fetchTables);

    const bootstrapWallet = async () => {
      if (!window.ethereum) {
        return;
      }

      if (window.localStorage.getItem(WALLET_CONNECTION_STATE_KEY) === 'disconnected') {
        return;
      }

      try {
        const accounts = (await window.ethereum.request({ method: 'eth_accounts' })) as string[];
        const account = accounts[0];
        if (!account) {
          return;
        }

        setWalletAddress(account);
        await refreshWalletState(account);
      } catch {
        // ignore silent bootstrap errors
      }
    };

    void bootstrapWallet();

    const onAccountsChanged = (accounts: string[]) => {
      const account = accounts[0] ?? '';
      clearWalletState();
      if (account) {
        if (window.localStorage.getItem(WALLET_CONNECTION_STATE_KEY) === 'disconnected') {
          return;
        }

        setWalletAddress(account);
        window.localStorage.setItem('walletAddress', account.toLowerCase());
        window.localStorage.setItem(WALLET_CONNECTION_STATE_KEY, 'connected');
        void refreshWalletState(account);
      } else {
        window.localStorage.setItem(WALLET_CONNECTION_STATE_KEY, 'disconnected');
        window.localStorage.removeItem('walletAddress');
      }
    };

    const onChainChanged = () => {
      if (walletAddress) {
        void refreshWalletState(walletAddress);
      }
    };

    window.ethereum?.on?.('accountsChanged', onAccountsChanged);
    window.ethereum?.on?.('chainChanged', onChainChanged);

    return () => {
      socket.off('connect', fetchTables);
      window.ethereum?.removeListener?.('accountsChanged', onAccountsChanged);
      window.ethereum?.removeListener?.('chainChanged', onChainChanged);
    };
  }, [walletAddress]);

  const cards = useMemo(
    () => sortTables(tables).filter((table) => table.stake === FIXED_STAKE),
    [tables],
  );
  const totalOpenSeats = useMemo(
    () =>
      cards.reduce((total, table) => total + Math.max(0, table.maxPlayers - table.playersCount), 0),
    [cards],
  );

  const ensurePlayerName = (): string | null => {
    const normalized = playerName.trim();
    if (!normalized) {
      setErrorMessage('Enter player name');
      return null;
    }

    window.localStorage.setItem('playerName', normalized);
    return normalized;
  };

  const ensureWalletReady = (): boolean => {
    if (!walletAddress) {
      setErrorMessage('Connect your wallet first');
      return false;
    }

    if (!walletChainOk) {
      setErrorMessage('Switch wallet to Arc Testnet');
      return false;
    }

    return true;
  };

  const handleConnectWallet = async () => {
    setWalletBusy(true);
    setWalletError('');

    try {
      window.localStorage.setItem(WALLET_CONNECTION_STATE_KEY, 'connected');
      const account = await connectWallet();
      await ensureArcNetwork();
      setWalletAddress(account);
      window.localStorage.setItem('walletAddress', account.toLowerCase());
      await refreshWalletState(account);
      await playSound('ui-click');
    } catch (error) {
      window.localStorage.removeItem(WALLET_CONNECTION_STATE_KEY);
      setWalletError(error instanceof Error ? error.message : 'Failed to connect wallet');
    } finally {
      setWalletBusy(false);
    }
  };

  const handleDisconnectWallet = async () => {
    setWalletError('');
    window.localStorage.setItem(WALLET_CONNECTION_STATE_KEY, 'disconnected');
    clearWalletState();
    await playSound('ui-click');
  };

  const handleEnterLobby = async () => {
    setSoundEnabled(true);
    await resumeBackgroundMusic('lobby');
    setIntroVisible(false);
    await playSound('ui-click');
  };

  const handleSwitchArc = async () => {
    setWalletBusy(true);
    setWalletError('');

    try {
      await ensureArcNetwork();
      if (walletAddress) {
        await refreshWalletState(walletAddress);
      }
      await playSound('ui-click');
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : 'Failed to switch network');
    } finally {
      setWalletBusy(false);
    }
  };

  const handleDeposit = async (event: FormEvent) => {
    event.preventDefault();

    if (!ensureWalletReady()) {
      return;
    }

    setWalletBusy(true);
    setWalletError('');

    try {
      await depositToVault(walletAddress, depositAmount);
      await refreshWalletState(walletAddress);
      await playSound('ui-click');
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : 'Deposit failed');
    } finally {
      setWalletBusy(false);
    }
  };

  const handleWithdraw = async () => {
    if (!ensureWalletReady()) {
      return;
    }

    setWalletBusy(true);
    setWalletError('');

    try {
      await withdrawFromVault(walletAddress, depositAmount);
      await refreshWalletState(walletAddress);
      await playSound('cashout');
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : 'Withdraw failed');
    } finally {
      setWalletBusy(false);
    }
  };

  const lockAndJoinTable = async (table: TableSummary): Promise<boolean> => {
    const normalizedName = ensurePlayerName();
    if (!normalizedName) {
      return false;
    }

    setWalletBusy(true);
    setWalletError('');
    setErrorMessage('');

    try {
      const joinWalletAddress = walletAddress.toLowerCase();

      if (!ensureWalletReady()) {
        return false;
      }

      const lockedAmount = Number(await readLockedBalance(walletAddress, table.tableId));
      if (lockedAmount < table.stake) {
        const lockTx = await lockTableBuyIn(walletAddress, table.tableId, table.stake);
        await waitForTransactionReceipt(lockTx);
      }

      const response = await emitSocketAck<TableJoinResponse>('table:join', {
        tableId: table.tableId,
        playerName: normalizedName,
        walletAddress: joinWalletAddress,
      });

      if (!response.ok) {
        throw new Error(response.error ?? 'Failed to join table');
      }

      await refreshWalletState(walletAddress);
      await playSound('ready');
      await router.push(`/table/${table.tableId}`);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to join table');
      return false;
    } finally {
      setWalletBusy(false);
    }
  };

  const presentMatchFoundAndJoin = async (table: TableSummary) => {
    setVersusName(
      table.createdBy && table.createdBy !== playerName.trim()
        ? table.createdBy
        : 'Opponent locked',
    );
    setLobbyFlow('versus');
    await waitForPresentation(900);
    const joined = await lockAndJoinTable(table);
    if (!joined) {
      setLobbyFlow('lobby');
    }
  };

  const handleJoinPrivateRoom = async () => {
    setErrorMessage('');

    if (!ensureWalletReady()) {
      return;
    }

    const normalizedName = ensurePlayerName();
    if (!normalizedName) {
      return;
    }

    const roomCode = privateRoomCode.trim().toUpperCase();
    if (!roomCode) {
      setErrorMessage('Enter a private room code');
      return;
    }

    setWalletBusy(true);
    setLobbyFlow('matchmaking');

    try {
      const response = await emitSocketAck<LobbyFindPrivateRoomResponse>('lobby:findPrivateRoom', {
        roomCode,
      });
      if (!response.ok || !response.table) {
        throw new Error(response.error ?? 'Failed to find private room');
      }

      await playSound('ui-click');
      await presentMatchFoundAndJoin(response.table);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to join private room');
      setLobbyFlow('lobby');
      setWalletBusy(false);
    }
  };

  const handleFindMatch = async (event: FormEvent) => {
    event.preventDefault();

    setErrorMessage('');

    if (!ensureWalletReady()) {
      return;
    }

    const normalizedName = ensurePlayerName();
    if (!normalizedName) {
      return;
    }

    setLobbyFlow('matchmaking');
    try {
      const response = await emitSocketAck<LobbyFindMatchResponse>('lobby:findMatch', {
        stake,
        playerName: normalizedName,
      });

      if (!response.ok || !response.table) {
        throw new Error(response.error ?? 'Failed to find a PvP table');
      }

      fetchTables();
      await playSound(response.created ? 'ui-click' : 'ready');
      await presentMatchFoundAndJoin(response.table);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to find a PvP table');
      setLobbyFlow('lobby');
    }
  };

  const handleCreatePrivateTable = async (event: FormEvent) => {
    event.preventDefault();

    setErrorMessage('');

    if (!ensureWalletReady()) {
      return;
    }

    const normalizedName = ensurePlayerName();
    if (!normalizedName) {
      return;
    }

    setLobbyFlow('matchmaking');
    try {
      const response = await emitSocketAck<LobbyCreateTableResponse>('lobby:createTable', {
        stake,
        playerName: normalizedName,
        tableName: tableName.trim() || undefined,
        kind: 'cash',
        access: 'private',
      });

      if (!response.ok || !response.table) {
        throw new Error(response.error ?? 'Failed to create private room');
      }

      setTableName('');
      if (response.table.roomCode) {
        setPrivateRoomCode(response.table.roomCode);
      }
      fetchTables();
      await playSound('ui-click');
      await presentMatchFoundAndJoin(response.table);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create private room');
      setLobbyFlow('lobby');
    }
  };

  const walletStepState =
    walletAddress && walletChainOk ? 'done' : walletAddress ? 'attention' : 'todo';
  const vaultAmount = Number(vaultBalance);
  const hasTableFunds = vaultAmount >= stake;
  const depositStepState = vaultAmount >= stake ? 'done' : 'todo';
  const walletStatus = walletAddress
    ? walletChainOk
      ? 'Wallet ready'
      : 'Switch to Arc'
    : 'Wallet offline';
  const balanceStatus = hasTableFunds ? `${vaultBalance} USDC ready` : `Need ${stake} USDC`;
  const shortWallet = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : 'Not connected';
  const shownTables = cards.slice(0, 4);

  return (
    <>
      <Head>
        <title>WILDCARD Lobby</title>
      </Head>
      <main className="wc-lobby">
        {introVisible ? (
          <button
            className="magic-splash"
            type="button"
            onPointerDown={() => {
              setSoundEnabled(true);
              void resumeBackgroundMusic('lobby');
            }}
            onClick={() => void handleEnterLobby()}
          >
            <span className="magic-splash__orb magic-splash__orb--left" aria-hidden="true" />
            <span className="magic-splash__title-wrap">
              <span className="magic-splash__eyebrow">Arc tavern duel</span>
              <span className="magic-splash__title">WILDCARD</span>
              <span className="magic-splash__sparkline" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="magic-splash__hint">Enter tavern</span>
            </span>
            <span className="magic-splash__orb magic-splash__orb--right" aria-hidden="true" />
          </button>
        ) : null}

        {lobbyFlow !== 'lobby' ? (
          <section
            className={`wc-lobby-state wc-lobby-state--${lobbyFlow}`}
            aria-live="polite"
            aria-label="matchmaking state"
          >
            <div className="wc-lobby-state__scan" aria-hidden="true" />
            <div className="wc-lobby-state__content">
              <span>{lobbyFlow === 'matchmaking' ? 'Matchmaking' : 'Match found'}</span>
              <h2>{lobbyFlow === 'matchmaking' ? 'Searching for a rival' : 'Versus'}</h2>
              <div className="wc-versus-strip" aria-hidden="true">
                <strong>{playerName.trim() || 'You'}</strong>
                <b>VS</b>
                <strong>{lobbyFlow === 'versus' ? versusName : '...'}</strong>
              </div>
              <p>
                {lobbyFlow === 'matchmaking'
                  ? `${stake} USDC table. Locking your seat as soon as the server finds a table.`
                  : 'Seat locked. Loading the arena.'}
              </p>
              {lobbyFlow === 'matchmaking' ? (
                <button
                  className="wc-button wc-button--quiet"
                  type="button"
                  onClick={() => setLobbyFlow('lobby')}
                >
                  Back to lobby
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <header className="wc-header">
          <div className="wc-brand-mark" aria-label="WILDCARD">
            <span aria-hidden="true">W</span>
            <strong>WILDCARD</strong>
          </div>
          <div className="wc-header__right">
            <span className="wc-balance-pill" data-ready={hasTableFunds ? 'true' : 'false'}>
              {vaultBalance} USDC
            </span>
            <SoundToggle />
            <button
              className="wc-button wc-button--wallet"
              type="button"
              onClick={walletAddress ? () => void handleDisconnectWallet() : handleConnectWallet}
              disabled={walletBusy}
            >
              {walletAddress ? 'Disconnect wallet' : 'Connect wallet'}
            </button>
          </div>
        </header>

        <section className="wc-lobby-hero">
          <div className="wc-hero-copy">
            <p className="wc-kicker">Arc tavern duel</p>
            <h1>WILDCARD</h1>
            <p>1v1 poker with off-chain spells and on-chain USDC settlement.</p>
            <div className="wc-status-row" aria-label="lobby status">
              <span data-state={walletStepState}>{walletStatus}</span>
              <span data-state={depositStepState}>{balanceStatus}</span>
              <span>5 USDC Stake</span>
              <span>1v1 Match</span>
            </div>
          </div>

          <aside className="wc-wallet-card">
            <span>Vault Balance</span>
            <strong>{vaultBalance} USDC</strong>
            <small>
              {shortWallet} / wallet {walletBalance} USDC
            </small>
            <button
              className="wc-button wc-button--quiet"
              type="button"
              onClick={() => setWalletModalOpen(true)}
            >
              Deposit / Withdraw
            </button>
          </aside>
        </section>

        <section className="wc-command-grid">
          <form className="wc-panel wc-public-panel" onSubmit={handleFindMatch}>
            <div className="wc-panel__head">
              <span>Public Match</span>
              <h2>Play 5 USDC</h2>
            </div>

            <label className="wc-field">
              Player
              <input
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Your nickname"
                maxLength={24}
              />
            </label>

            <div className="wc-match-specs" aria-label="public match details">
              <span>5 USDC</span>
              <span>1v1</span>
              <span>Public</span>
            </div>

            <button
              className="wc-button wc-button--primary wc-button--large"
              type="submit"
              disabled={walletBusy}
            >
              Find Match
            </button>
          </form>

          <section className="wc-panel wc-private-panel" aria-label="Private Room">
            <div className="wc-panel__head">
              <span>Private Room</span>
              <h2>Invite Duel</h2>
            </div>

            <div className="wc-private-flows">
              <form className="wc-private-flow" onSubmit={handleCreatePrivateTable}>
                <div>
                  <strong>Create Room</strong>
                  <small>Fixed 5 USDC stake</small>
                </div>
                <label className="wc-field">
                  Room name
                  <input
                    value={tableName}
                    onChange={(event) => setTableName(event.target.value)}
                    placeholder="Midnight Duel"
                    maxLength={32}
                  />
                </label>
                <button
                  className="wc-button wc-button--primary"
                  type="submit"
                  disabled={walletBusy}
                >
                  Create Room
                </button>
              </form>

              <div className="wc-private-flow">
                <div>
                  <strong>Join by Code</strong>
                  <small>Enter invite code</small>
                </div>
                <label className="wc-field">
                  Room code
                  <input
                    value={privateRoomCode}
                    onChange={(event) => setPrivateRoomCode(event.target.value.toUpperCase())}
                    placeholder="ROOM42"
                    maxLength={6}
                  />
                </label>
                <button
                  className="wc-button wc-button--quiet"
                  type="button"
                  onClick={() => void handleJoinPrivateRoom()}
                  disabled={walletBusy}
                >
                  Join Room
                </button>
              </div>
            </div>
          </section>
        </section>

        {errorMessage ? (
          <p className="wc-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <section className="wc-tables" aria-label="tables">
          <div className="wc-tables__head">
            <div>
              <span>Open Tables</span>
              <h2>5 USDC Seats</h2>
            </div>
            <p>
              {cards.length} tables / {totalOpenSeats} seats
            </p>
          </div>

          <div className="wc-table-list">
            {shownTables.length === 0 ? (
              <article className="wc-table-row wc-table-row--empty">
                <div>
                  <strong>No open 5 USDC tables</strong>
                  <span>Use Find Match to create the first public duel.</span>
                </div>
              </article>
            ) : (
              shownTables.map((table) => (
                <article
                  key={table.tableId}
                  className="wc-table-row"
                  data-testid={`table-card-${table.tableId}`}
                >
                  <div>
                    <strong>{table.tableName}</strong>
                    <span>
                      {table.access === 'private' ? (table.roomCode ?? 'Private') : 'Public'} /{' '}
                      {table.playersCount}/{table.maxPlayers} seats
                    </span>
                  </div>
                  <span className="wc-table-row__stake">{table.stake} USDC</span>
                  <button
                    className="wc-button wc-button--quiet"
                    type="button"
                    onClick={() => void lockAndJoinTable(table)}
                    disabled={walletBusy}
                  >
                    Join
                  </button>
                </article>
              ))
            )}
          </div>
        </section>

        {walletModalOpen ? (
          <section className="wc-wallet-modal" role="dialog" aria-label="Deposit and withdraw">
            <button
              className="wc-wallet-modal__backdrop"
              type="button"
              onClick={() => setWalletModalOpen(false)}
              aria-label="Close wallet modal"
            />
            <div className="wc-wallet-modal__panel">
              <div className="wc-panel__head">
                <span>Wallet</span>
                <h2>Table Funds</h2>
              </div>
              <button
                className="wc-modal-close"
                type="button"
                onClick={() => setWalletModalOpen(false)}
                aria-label="Close wallet modal"
              >
                x
              </button>

              <div className="wc-wallet-meter">
                <div>
                  <span>Vault</span>
                  <strong>{vaultBalance} USDC</strong>
                </div>
                <div>
                  <span>Wallet</span>
                  <strong>{walletBalance} USDC</strong>
                </div>
              </div>

              <form className="wc-wallet-form" onSubmit={handleDeposit}>
                <label className="wc-field">
                  Amount
                  <input
                    value={depositAmount}
                    onChange={(event) => setDepositAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="5"
                  />
                </label>
                <div className="wc-wallet-actions">
                  <button
                    className="wc-button wc-button--primary"
                    type="submit"
                    disabled={walletBusy || !ARC_CONFIG.vaultAddress}
                  >
                    Deposit
                  </button>
                  <button
                    className="wc-button wc-button--quiet"
                    type="button"
                    onClick={() => void handleWithdraw()}
                    disabled={walletBusy || !ARC_CONFIG.vaultAddress}
                  >
                    Withdraw
                  </button>
                  <button
                    className="wc-button wc-button--quiet"
                    type="button"
                    onClick={handleSwitchArc}
                    disabled={walletBusy}
                  >
                    Switch to Arc
                  </button>
                </div>
              </form>
              {walletError ? <p role="alert">{walletError}</p> : null}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
