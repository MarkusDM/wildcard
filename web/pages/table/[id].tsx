import Image from 'next/image';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GameFeedbackLayer,
  type FeedbackRole,
  type GameFeedbackEffect,
} from '../../components/GameFeedbackLayer';
import { PlayingCard } from '../../components/PlayingCard';
import { SoundToggle } from '../../components/SoundToggle';
import {
  readLockedBalance,
  readTableSettled,
  settleTable,
  unlockTableBuyIn,
  waitForTransactionReceipt,
} from '../../lib/arc-wallet';
import { getSocket } from '../../lib/socket';
import { startBackgroundMusic, stopBackgroundMusic } from '../../lib/music';
import { playSfx, playSound, playVoice } from '../../lib/sound';
import type {
  MagicResolvedEvent,
  MagicCardType,
  MagicPrivateEvent,
  TablePrivateState,
  TableState,
} from '../../../shared/socket-events';
import {
  formatMicroUsdc,
  MIN_RAISE_INCREMENT_MICRO_USDC,
  parseUsdcToMicroUsdc,
} from '../../../shared/usdc';

const MAGIC_CARD_META: Record<
  MagicCardType,
  {
    title: string;
    description: string;
    compactDescription: string;
    sigil: string;
    hue: string;
    cost: number;
    artSrc?: string;
  }
> = {
  peek: {
    title: 'Peek',
    description: 'Reveal one hidden card from an opponent.',
    compactDescription: 'Reveal one hidden card',
    sigil: 'Eye',
    hue: 'azure',
    cost: 1,
    artSrc: '/assets/magic/art/peek-custom.webp',
  },
  swap: {
    title: 'Swap',
    description: 'Replace one hole card during preflop.',
    compactDescription: 'Replace one hole card',
    sigil: 'Flux',
    hue: 'ember',
    cost: 2,
    artSrc: '/assets/magic/art/swap-custom.webp',
  },
  shield: {
    title: 'Shield',
    description: 'Block the next targeted spell.',
    compactDescription: 'Block the next targeted spell',
    sigil: 'Ward',
    hue: 'violet',
    cost: 1,
    artSrc: '/assets/magic/art/shield-custom.webp',
  },
  hex: {
    title: 'Hex',
    description: 'Force target to pay 0.5 USDC to pot.',
    compactDescription: 'Target pays 0.5 USDC to pot',
    sigil: 'Hex',
    hue: 'crimson',
    cost: 2,
    artSrc: '/assets/magic/art/hex-custom.webp',
  },
  drain: {
    title: 'Drain',
    description: 'Steal 0.5 USDC from target stack.',
    compactDescription: 'Steal 0.5 USDC from target stack',
    sigil: 'Drain',
    hue: 'jade',
    cost: 3,
    artSrc: '/assets/magic/art/drain-custom.webp',
  },
  reroll: {
    title: 'Reroll',
    description: 'Replace both hole cards preflop.',
    compactDescription: 'Replace both hole cards',
    sigil: 'Twin',
    hue: 'gold',
    cost: 3,
    artSrc: '/assets/magic/art/reroll-custom.webp',
  },
  ward: {
    title: 'Ward',
    description: 'Gain two targeted spell blocks.',
    compactDescription: 'Gain two targeted spell blocks',
    sigil: 'Ward+',
    hue: 'violet',
    cost: 2,
    artSrc: '/assets/magic/art/ward-custom.webp',
  },
};
const PROJECT_TREASURY_ADDRESS = (
  process.env.NEXT_PUBLIC_PROJECT_TREASURY_ADDRESS ?? ''
).toLowerCase();

const MAGIC_BEAM_META: Partial<
  Record<MagicCardType, { start: string; mid: string; end: string; glow: string }>
> = {
  peek: {
    start: 'rgba(214, 236, 255, 0.08)',
    mid: 'rgba(138, 205, 255, 0.72)',
    end: 'rgba(114, 150, 255, 0.88)',
    glow: 'rgba(132, 197, 255, 0.18)',
  },
  hex: {
    start: 'rgba(255, 236, 204, 0.08)',
    mid: 'rgba(255, 197, 138, 0.72)',
    end: 'rgba(255, 112, 92, 0.88)',
    glow: 'rgba(255, 140, 108, 0.18)',
  },
  drain: {
    start: 'rgba(223, 255, 232, 0.08)',
    mid: 'rgba(126, 230, 182, 0.72)',
    end: 'rgba(77, 199, 152, 0.88)',
    glow: 'rgba(86, 212, 162, 0.18)',
  },
};

function isActionPhase(phase: TableState['phase']): boolean {
  return phase === 'preflop' || phase === 'flop' || phase === 'turn' || phase === 'river';
}

function clampMicroUsdc(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function snapRaiseAmount(value: number, min: number, max: number): number {
  const clamped = clampMicroUsdc(value, min, max);
  const stepped =
    Math.round(clamped / MIN_RAISE_INCREMENT_MICRO_USDC) * MIN_RAISE_INCREMENT_MICRO_USDC;
  return clampMicroUsdc(stepped, min, max);
}

function isTargetedMagic(cardType: MagicCardType): boolean {
  return cardType === 'peek' || cardType === 'hex' || cardType === 'drain';
}

function RuneMark() {
  return (
    <svg className="mp-rune-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 4 42 40H6L24 4Z" />
      <path d="M24 14v22M15 30h18" />
    </svg>
  );
}

function ArcLogoMark() {
  return <span className="mp-arc-logo-mark" aria-hidden="true" />;
}

function CoinIcon() {
  return (
    <Image
      className="mp-coin-icon"
      src="/assets/wildcard/usdc-logo.svg"
      alt=""
      width={22}
      height={22}
      aria-hidden="true"
      draggable={false}
    />
  );
}

function MagicDuelCard({
  cardType,
  index,
  concealed = false,
  disabled = false,
  armed = false,
  onClick,
}: {
  cardType?: MagicCardType;
  index: number;
  concealed?: boolean;
  disabled?: boolean;
  armed?: boolean;
  onClick?: () => void;
}) {
  const meta = cardType ? MAGIC_CARD_META[cardType] : undefined;
  const title = meta?.title ?? 'Empty Slot';
  const description = meta?.description ?? 'Buy a spell to fill this slot.';
  const compactDescription = meta?.compactDescription ?? description;
  const hue = meta?.hue ?? 'hidden';

  return (
    <button
      className={`mp-magic-card ${concealed ? 'mp-magic-card--concealed' : ''} ${!cardType ? 'mp-magic-card--empty' : ''}`}
      type="button"
      aria-label={concealed ? 'Hidden magic card' : title}
      disabled={disabled || (!cardType && !onClick)}
      data-armed={armed ? 'true' : 'false'}
      data-magic-index={index}
      data-hue={hue}
      data-playable={!disabled && cardType ? 'true' : 'false'}
      data-full-description={description}
      onClick={onClick}
    >
      <span className="mp-magic-card__art">
        {meta?.artSrc && !concealed ? (
          <Image
            className="mp-magic-card__image"
            src={meta.artSrc}
            alt=""
            fill
            sizes="(max-width: 1366px) 150px, 165px"
            aria-hidden="true"
            draggable={false}
          />
        ) : concealed || !cardType ? (
          <ArcLogoMark />
        ) : (
          <RuneMark />
        )}
      </span>
      {!concealed ? (
        <>
          <strong>{title}</strong>
          <small>{compactDescription}</small>
          {cardType ? (
            <span className="mp-magic-card__tooltip" role="tooltip">
              {description}
            </span>
          ) : null}
        </>
      ) : null}
    </button>
  );
}

function PlayerPortrait({
  avatar,
  name,
  chips,
  active = false,
  avatarPosition = 'center',
  portraitFocus = 'self',
}: {
  avatar: string;
  name: string;
  chips: string;
  active?: boolean;
  avatarPosition?: string;
  portraitFocus?: 'self' | 'opponent';
}) {
  return (
    <div
      className="mp-player-portrait"
      data-active={active ? 'true' : 'false'}
      data-portrait-focus={portraitFocus}
    >
      <div
        className="mp-player-portrait__avatar"
        style={{ backgroundImage: `url(${avatar})`, backgroundPosition: avatarPosition }}
      />
      <div className="mp-player-portrait__info">
        <strong>{name}</strong>
        <span>{chips} USDC</span>
      </div>
    </div>
  );
}

function PokerPair({
  cards,
  concealed,
  playable = false,
  selected = false,
}: {
  cards: string[];
  concealed: boolean;
  playable?: boolean;
  selected?: boolean;
}) {
  return (
    <div className="mp-poker-pair">
      {[0, 1].map((index) => (
        <PlayingCard
          key={index}
          code={cards[index] ?? 'XX'}
          concealed={concealed || !cards[index]}
          animated
          playable={playable}
          selected={selected}
          dealIndex={index}
        />
      ))}
    </div>
  );
}
export default function TablePage() {
  const router = useRouter();
  const queryId = router.query.id;
  const tableId = typeof queryId === 'string' ? queryId : undefined;

  const [socketId, setSocketId] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [tableState, setTableState] = useState<TableState | null>(null);
  const [privateState, setPrivateState] = useState<TablePrivateState | null>(null);
  const [, setErrorMessage] = useState('');
  const [feedbackEffects, setFeedbackEffects] = useState<GameFeedbackEffect[]>([]);
  const [lockedBalance, setLockedBalance] = useState('0');
  const [raiseAmount, setRaiseAmount] = useState('0.1');
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [armedMagic, setArmedMagic] = useState<MagicCardType | null>(null);
  const [armedMagicIndex, setArmedMagicIndex] = useState<number | null>(null);
  const [peekReveal, setPeekReveal] = useState<{
    targetSocketId: string;
    revealedCard: string;
  } | null>(null);
  const [magicFx, setMagicFx] = useState<{
    casterSocketId: string;
    targetSocketId?: string;
    cardType: MagicCardType;
    status: 'applied' | 'blocked';
  } | null>(null);
  const [isCashingOut, setIsCashingOut] = useState(false);
  const [hoverTargetSocketId, setHoverTargetSocketId] = useState('');
  const [aimLine, setAimLine] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    height: number;
  } | null>(null);
  const [cursorPoint, setCursorPoint] = useState<{ x: number; y: number } | null>(null);
  const [timeRemainingMs, setTimeRemainingMs] = useState(0);

  const prevPhaseRef = useRef<TableState['phase'] | null>(null);
  const prevTurnSocketIdRef = useRef<string | null>(null);
  const prevWinnerSocketIdRef = useRef<string | null>(null);
  const prevTableStateRef = useRef<TableState | null>(null);
  const selfSocketIdRef = useRef<string | null>(null);
  const feedbackTimersRef = useRef<number[]>([]);
  const localActionFeedbackRef = useRef<{
    action: 'fold' | 'check' | 'call' | 'raise' | 'all-in';
    at: number;
  } | null>(null);
  const tableGridRef = useRef<HTMLElement | null>(null);
  const playerHandRef = useRef<HTMLDivElement | null>(null);

  const roleForSocket = useCallback((nextSocketId?: string | null): FeedbackRole => {
    return nextSocketId && nextSocketId === selfSocketIdRef.current ? 'self' : 'opponent';
  }, []);

  const queueFeedback = useCallback((effect: Omit<GameFeedbackEffect, 'id'>, durationMs = 1350) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextEffect: GameFeedbackEffect = { id, ...effect };
    setFeedbackEffects((current) => [...current.slice(-7), nextEffect]);
    const timer = window.setTimeout(() => {
      setFeedbackEffects((current) => current.filter((candidate) => candidate.id !== id));
    }, durationMs);
    feedbackTimersRef.current.push(timer);
  }, []);

  const queueLocalActionFeedback = useCallback(
    (action: 'fold' | 'check' | 'call' | 'raise' | 'all-in') => {
      localActionFeedbackRef.current = { action, at: Date.now() };

      if (action === 'fold') {
        queueFeedback({ kind: 'fold', origin: 'self' }, 900);
        void playSfx('card-slide');
        void playVoice('fold', { probability: 0.28 });
        return;
      }

      if (action === 'check') {
        queueFeedback({ kind: 'check', origin: 'self' }, 720);
        void playSfx('ui-click');
        return;
      }

      queueFeedback({ kind: 'bet', origin: 'self', target: 'pot' }, 980);
      void playSfx(action === 'raise' || action === 'all-in' ? 'bet' : 'chips');
      if (action === 'raise' || action === 'all-in') {
        void playVoice('raise', { probability: 0.32 });
      }
    },
    [queueFeedback],
  );

  useEffect(() => {
    return () => {
      for (const timer of feedbackTimersRef.current) {
        window.clearTimeout(timer);
      }
      feedbackTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    startBackgroundMusic('table');
    return () => stopBackgroundMusic();
  }, []);

  useEffect(() => {
    if (!tableId) return;

    const socket = getSocket();
    const playerName = window.localStorage.getItem('playerName') ?? 'Player';
    const savedWalletAddress = (window.localStorage.getItem('walletAddress') ?? '').toLowerCase();
    const joinIdentity = savedWalletAddress;
    setWalletAddress(joinIdentity);

    const handleConnected = (payload: { socketId: string }) => setSocketId(payload.socketId);
    const handleTableState = (state: TableState) => {
      if (state.tableId === tableId) setTableState(state);
    };
    const handlePrivateState = (state: TablePrivateState) => {
      if (state.tableId === tableId) setPrivateState(state);
    };
    const handleTableError = (payload: { message: string }) => {
      setErrorMessage(payload.message);
      setTimeout(() => setErrorMessage(''), 2600);
    };
    const handleMagicResolved = (event: MagicResolvedEvent) => {
      if (event.tableId !== tableId) return;
      const casterRole = roleForSocket(event.casterSocketId);
      const targetRole = event.targetSocketId ? roleForSocket(event.targetSocketId) : casterRole;
      void playSfx(event.status === 'blocked' ? 'magic-blocked' : 'magic-activate');
      void playVoice(
        event.status === 'blocked' ? 'block' : event.cardType === 'drain' ? 'steal' : 'magic',
        {
          probability: event.status === 'blocked' || event.cardType === 'drain' ? 0.4 : 0.28,
        },
      );
      queueFeedback({
        kind: 'magic',
        origin: casterRole,
        target: event.targetSocketId ? targetRole : 'pot',
        cardType: event.cardType,
        status: event.status,
      });

      if (event.status === 'blocked') {
        queueFeedback({ kind: 'shield', target: targetRole, status: 'blocked' }, 900);
      } else if (event.cardType === 'drain') {
        queueFeedback(
          {
            kind: 'coin-transfer',
            origin: targetRole,
            target: casterRole,
            cardType: event.cardType,
          },
          1050,
        );
        void playSfx('steal');
      } else if (event.cardType === 'hex') {
        queueFeedback(
          { kind: 'bet', origin: targetRole, target: 'pot', cardType: event.cardType },
          1050,
        );
        void playSfx('chips');
      } else if (event.cardType === 'swap') {
        queueFeedback({ kind: 'card-swap', target: casterRole, cardType: event.cardType }, 980);
        void playSfx('card-flip');
      } else if (event.cardType === 'reroll') {
        queueFeedback({ kind: 'reroll', target: casterRole, cardType: event.cardType }, 1180);
        void playSfx('card-shuffle');
      } else if (event.cardType === 'shield' || event.cardType === 'ward') {
        queueFeedback(
          { kind: 'shield', target: casterRole, cardType: event.cardType, status: 'applied' },
          1100,
        );
        void playSfx('shield');
      }

      setMagicFx({
        casterSocketId: event.casterSocketId,
        targetSocketId: event.targetSocketId,
        cardType: event.cardType,
        status: event.status,
      });
      setArmedMagic(null);
      setArmedMagicIndex(null);
      window.setTimeout(() => setMagicFx(null), 1300);
    };
    const handleMagicPrivate = (event: MagicPrivateEvent) => {
      if (event.tableId !== tableId || event.kind !== 'peek-result') return;
      setPeekReveal({ targetSocketId: event.targetSocketId, revealedCard: event.revealedCard });
      window.setTimeout(() => setPeekReveal(null), 2800);
    };
    const handleTableClosed = (payload: { tableId: string; message?: string }) => {
      if (payload.tableId !== tableId) return;
      window.localStorage.removeItem(`table:${tableId}:settling`);
      if (payload.message) {
        setErrorMessage(payload.message);
      }
      void router.push('/');
    };

    socket.on('connected', handleConnected);
    socket.on('table:state', handleTableState);
    socket.on('table:private', handlePrivateState);
    socket.on('table:error', handleTableError);
    socket.on('magic:resolved', handleMagicResolved);
    socket.on('magic:private', handleMagicPrivate);
    socket.on('table:closed', handleTableClosed);

    if (socket.id) setSocketId(socket.id);
    if (!joinIdentity) {
      setErrorMessage('Connect wallet in Lobby first');
      return;
    }

    socket.emit('table:join', { tableId, playerName, walletAddress: joinIdentity }, (response) => {
      if (!response.ok) {
        setErrorMessage(response.error ?? 'Failed to join table');
      }
    });

    return () => {
      socket.off('connected', handleConnected);
      socket.off('table:state', handleTableState);
      socket.off('table:private', handlePrivateState);
      socket.off('table:error', handleTableError);
      socket.off('magic:resolved', handleMagicResolved);
      socket.off('magic:private', handleMagicPrivate);
      socket.off('table:closed', handleTableClosed);
    };
  }, [queueFeedback, roleForSocket, router, tableId]);

  useEffect(() => {
    if (!tableId || !walletAddress) {
      setLockedBalance('0');
      return;
    }

    const refreshLockedBalance = async () => {
      try {
        setLockedBalance(await readLockedBalance(walletAddress, tableId));
      } catch {
        setLockedBalance('0');
      }
    };

    void refreshLockedBalance();
  }, [tableId, tableState?.potMicroUsdc, tableState?.phase, walletAddress]);

  const phase = tableState?.phase;

  useEffect(() => {
    if (!phase) return;
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (phase === 'preflop' && (prev === 'waiting' || prev === 'showdown')) {
      queueFeedback({ kind: 'deal', origin: 'pot' }, 900);
      void playSfx('card-draw');
    }
    if (phase === 'showdown' && prev !== 'showdown') {
      queueFeedback({ kind: 'card-swap', target: 'pot' }, 820);
      void playSfx('card-flip');
      void playVoice('showdown', { probability: 0.3 });
    }
  }, [phase, queueFeedback]);

  const selfPlayer = useMemo(() => {
    if (!tableState) return undefined;

    return tableState.players.find((player) => {
      if (socketId && player.socketId === socketId) {
        return true;
      }

      if (walletAddress && player.walletAddress === walletAddress) {
        return true;
      }

      return false;
    });
  }, [socketId, tableState, walletAddress]);

  const opponents = useMemo(() => {
    if (!tableState) return [];
    return tableState.players
      .filter((player) => player.socketId !== selfPlayer?.socketId)
      .slice(0, 1);
  }, [selfPlayer?.socketId, tableState]);

  useEffect(() => {
    selfSocketIdRef.current = selfPlayer?.socketId ?? null;
  }, [selfPlayer?.socketId]);

  const primaryOpponent = opponents[0];
  const beamMeta = armedMagic ? MAGIC_BEAM_META[armedMagic] : undefined;

  useEffect(() => {
    const currentTurnSocketId = tableState?.currentTurnSocketId ?? null;
    if (!currentTurnSocketId) {
      prevTurnSocketIdRef.current = currentTurnSocketId;
      return;
    }

    if (
      prevTurnSocketIdRef.current !== currentTurnSocketId &&
      selfPlayer?.socketId === currentTurnSocketId
    ) {
      void playSound('turn');
    }

    prevTurnSocketIdRef.current = currentTurnSocketId;
  }, [selfPlayer?.socketId, tableState?.currentTurnSocketId]);

  useEffect(() => {
    if (!tableState) {
      prevTableStateRef.current = null;
      return;
    }

    const previous = prevTableStateRef.current;
    prevTableStateRef.current = tableState;
    if (!previous || previous.handId !== tableState.handId) {
      return;
    }

    const pendingLocal = localActionFeedbackRef.current;
    const suppressSelfFeedback = Boolean(pendingLocal && Date.now() - pendingLocal.at < 1400);
    const previousPlayers = new Map(previous.players.map((player) => [player.socketId, player]));

    for (const player of tableState.players) {
      const before = previousPlayers.get(player.socketId);
      if (!before) {
        continue;
      }

      const role = roleForSocket(player.socketId);
      const isSuppressedSelf = role === 'self' && suppressSelfFeedback;
      const contributionDelta =
        player.totalContributionMicroUsdc - before.totalContributionMicroUsdc;
      if (contributionDelta > 0 && !isSuppressedSelf) {
        queueFeedback({ kind: 'bet', origin: role, target: 'pot' }, 980);
        void playSfx('chips');
      }

      if (!before.folded && player.folded && !isSuppressedSelf) {
        queueFeedback({ kind: 'fold', origin: role }, 900);
        void playSfx('card-slide');
        if (role === 'opponent') {
          void playVoice('fold', { probability: 0.25 });
        }
      }
    }

    const previousTurnPlayer = previous.currentTurnSocketId
      ? previousPlayers.get(previous.currentTurnSocketId)
      : undefined;
    const currentTurnChanged =
      previous.currentTurnSocketId &&
      previous.currentTurnSocketId !== tableState.currentTurnSocketId;
    if (
      currentTurnChanged &&
      previousTurnPlayer &&
      isActionPhase(previous.phase) &&
      previous.phase === tableState.phase
    ) {
      const nowPlayer = tableState.players.find(
        (player) => player.socketId === previousTurnPlayer.socketId,
      );
      const contributionDelta =
        (nowPlayer?.totalContributionMicroUsdc ?? 0) -
        previousTurnPlayer.totalContributionMicroUsdc;
      const checked =
        nowPlayer &&
        contributionDelta === 0 &&
        !previousTurnPlayer.folded &&
        !nowPlayer.folded &&
        nowPlayer.actedThisStreet;
      const role = roleForSocket(previousTurnPlayer.socketId);
      if (checked && !(role === 'self' && suppressSelfFeedback)) {
        queueFeedback({ kind: 'check', origin: role }, 720);
        void playSfx('ui-click');
      }
    }

    if (pendingLocal && Date.now() - pendingLocal.at >= 1400) {
      localActionFeedbackRef.current = null;
    }
  }, [queueFeedback, roleForSocket, tableState]);

  useEffect(() => {
    const currentWinnerSocketId = tableState?.winnerSocketId ?? null;
    if (!currentWinnerSocketId) {
      prevWinnerSocketIdRef.current = currentWinnerSocketId;
      return;
    }

    if (prevWinnerSocketIdRef.current !== currentWinnerSocketId) {
      const winnerRole = roleForSocket(currentWinnerSocketId);
      queueFeedback({ kind: 'showdown', origin: 'pot', target: winnerRole }, 1200);
      void playSfx('pot-win');
      void playSfx(winnerRole === 'self' ? 'win' : 'lose');
      void playVoice(winnerRole === 'self' ? 'win' : 'lose', { probability: 0.42 });
    }

    prevWinnerSocketIdRef.current = currentWinnerSocketId;
  }, [queueFeedback, roleForSocket, tableState?.winnerSocketId]);

  useEffect(() => {
    if (!tableState?.actionDeadlineAt) {
      setTimeRemainingMs(0);
      return;
    }

    const updateCountdown = () => {
      setTimeRemainingMs(Math.max(0, tableState.actionDeadlineAt! - Date.now()));
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(interval);
  }, [tableState?.actionDeadlineAt]);

  const handActive = Boolean(tableState && isActionPhase(tableState.phase));
  const isMyTurn = Boolean(
    tableState && selfPlayer && tableState.currentTurnSocketId === selfPlayer.socketId,
  );
  const canAct = Boolean(
    selfPlayer && selfPlayer.inHand && !selfPlayer.folded && isMyTurn && handActive,
  );
  const countdownUrgent = timeRemainingMs > 0 && timeRemainingMs <= 15_000;
  const callAmountMicroUsdc =
    tableState && selfPlayer
      ? Math.max(0, tableState.currentBetMicroUsdc - selfPlayer.currentBetMicroUsdc)
      : 0;
  const minRaiseAmountMicroUsdc =
    tableState?.minimumRaiseToMicroUsdc ?? MIN_RAISE_INCREMENT_MICRO_USDC;
  const maxRaiseAmountMicroUsdc = selfPlayer
    ? Math.max(minRaiseAmountMicroUsdc, selfPlayer.currentBetMicroUsdc + selfPlayer.stackMicroUsdc)
    : minRaiseAmountMicroUsdc;
  const canUseMagicBase = Boolean(
    handActive &&
      selfPlayer &&
      selfPlayer.inHand &&
      !selfPlayer.folded &&
      privateState &&
      privateState.magicCards.length > 0,
  );

  useEffect(() => {
    setRaiseAmount((current) => {
      try {
        const parsed = parseUsdcToMicroUsdc(current);
        return formatMicroUsdc(
          snapRaiseAmount(parsed, minRaiseAmountMicroUsdc, maxRaiseAmountMicroUsdc),
        );
      } catch {
        return formatMicroUsdc(minRaiseAmountMicroUsdc);
      }
    });
  }, [maxRaiseAmountMicroUsdc, minRaiseAmountMicroUsdc]);

  const handleRaiseSliderChange = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    setRaiseAmount(
      formatMicroUsdc(snapRaiseAmount(parsed, minRaiseAmountMicroUsdc, maxRaiseAmountMicroUsdc)),
    );
  };

  const emitAction = (action: 'fold' | 'check' | 'call' | 'raise' | 'all-in') => {
    if (!tableId) return;

    if (action === 'raise') {
      try {
        const amountMicroUsdc = parseUsdcToMicroUsdc(raiseAmount);
        getSocket().emit('table:action', { tableId, action, amountMicroUsdc });
        setRaiseOpen(false);
        queueLocalActionFeedback(action);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Invalid raise amount');
      }
      return;
    }

    getSocket().emit('table:action', { tableId, action });
    queueLocalActionFeedback(action);
  };

  const leaveTableLocally = () => {
    if (!tableId) return;
    getSocket().emit('table:leave', { tableId });
    void router.push('/');
  };

  const requestTableClose = async () => {
    if (!tableId) {
      throw new Error('Table not found');
    }

    await new Promise<void>((resolve, reject) => {
      getSocket().emit('table:close', { tableId }, (response) => {
        if (!response.ok) {
          reject(new Error(response.error ?? 'Failed to close settled table'));
          return;
        }

        resolve();
      });
    });
  };

  const buildSettlementPayouts = () => {
    if (!tableState) {
      throw new Error('Table state is not loaded');
    }

    const payouts = new Map<string, bigint>();
    for (const player of tableState.players) {
      if (!player.walletAddress) {
        continue;
      }

      const amount = BigInt(player.stackMicroUsdc);
      if (amount <= 0n) {
        continue;
      }

      const normalizedWallet = player.walletAddress.toLowerCase();
      payouts.set(normalizedWallet, (payouts.get(normalizedWallet) ?? 0n) + amount);
    }

    if (tableState.magicRevenueMicroUsdc > 0) {
      if (!PROJECT_TREASURY_ADDRESS) {
        throw new Error('NEXT_PUBLIC_PROJECT_TREASURY_ADDRESS is not configured');
      }

      const revenue = BigInt(tableState.magicRevenueMicroUsdc);
      payouts.set(
        PROJECT_TREASURY_ADDRESS,
        (payouts.get(PROJECT_TREASURY_ADDRESS) ?? 0n) + revenue,
      );
    }

    return [...payouts.entries()].map(([address, amountUnits]) => ({ address, amountUnits }));
  };

  const handleCashOut = async () => {
    if (!tableId || !walletAddress || isCashingOut) {
      return;
    }

    if (handActive) {
      setErrorMessage('Finish the active hand before cashing out');
      return;
    }

    setIsCashingOut(true);
    try {
      const lockedUnits = BigInt(parseUsdcToMicroUsdc(lockedBalance));
      if (lockedUnits <= 0n) {
        await playSound('cashout');
        leaveTableLocally();
        return;
      }

      if ((tableState?.handId ?? 0) === 0) {
        const unlockTx = await unlockTableBuyIn(walletAddress, tableId, lockedUnits);
        await waitForTransactionReceipt(unlockTx);
        await playSound('cashout');
        leaveTableLocally();
        return;
      }

      const payouts = buildSettlementPayouts();
      window.localStorage.setItem(`table:${tableId}:settling`, 'true');
      const settleTx = await settleTable(walletAddress, tableId, payouts);
      await waitForTransactionReceipt(settleTx);

      const settled = await readTableSettled(tableId);
      if (!settled) {
        throw new Error('Table settlement was not confirmed on-chain');
      }

      await playSound('cashout');
      await requestTableClose();
      void router.push('/');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to cash out');
      window.localStorage.removeItem(`table:${tableId}:settling`);
    } finally {
      setIsCashingOut(false);
    }
  };

  const toggleReady = () => {
    if (!tableId || !selfPlayer) return;
    getSocket().emit('table:ready', { tableId, ready: !selfPlayer.ready });
    void playSound('ready');
  };

  const triggerMagic = (cardType: MagicCardType, cardIndex: number) => {
    if (!tableId || !privateState || !canUseMagicBase) return;
    if (!privateState.magicCards.includes(cardType)) return;

    if (isTargetedMagic(cardType)) {
      if (armedMagic === cardType && armedMagicIndex === cardIndex) {
        setArmedMagic(null);
        setArmedMagicIndex(null);
      } else {
        setArmedMagic(cardType);
        setArmedMagicIndex(cardIndex);
      }
      void playSound('ui-click');
      return;
    }

    getSocket().emit('magic:use', {
      tableId,
      cardType,
    });
    queueFeedback(
      { kind: 'magic', origin: 'self', target: 'pot', cardType, status: 'applied' },
      900,
    );
    void playSfx('magic-activate');
  };

  const buyMagicCard = () => {
    if (!tableId) return;
    getSocket().emit('magic:buy', { tableId }, (response) => {
      if (!response.ok) {
        setErrorMessage(response.error ?? 'Failed to buy magic card');
        return;
      }
      queueFeedback({ kind: 'bet', origin: 'self', target: 'pot' }, 860);
      queueFeedback({ kind: 'magic', origin: 'self', target: 'self', status: 'applied' }, 900);
      void playSfx('magic-activate');
    });
  };

  const canBuyMagic = Boolean(
    selfPlayer &&
      selfPlayer.stackMicroUsdc >= 500_000 &&
      (privateState?.magicCards.length ?? 0) < 3,
  );
  const canCheck = canAct && callAmountMicroUsdc === 0;
  const canCall = canAct && callAmountMicroUsdc > 0;
  const canRaise = canAct && maxRaiseAmountMicroUsdc > minRaiseAmountMicroUsdc;
  const canReady = Boolean(selfPlayer && !handActive);
  const sceneState = !tableState
    ? 'loading'
    : tableState.phase === 'waiting'
      ? primaryOpponent
        ? 'match-found'
        : 'searching'
      : tableState.phase === 'showdown'
        ? 'resolution'
        : 'gameplay';
  const setRaiseToAmount = (amountMicroUsdc: number) => {
    setRaiseAmount(
      formatMicroUsdc(
        snapRaiseAmount(amountMicroUsdc, minRaiseAmountMicroUsdc, maxRaiseAmountMicroUsdc),
      ),
    );
  };
  const magicSlots = [0, 1, 2];
  const currentRaiseAmountMicroUsdc = (() => {
    try {
      return clampMicroUsdc(
        parseUsdcToMicroUsdc(raiseAmount),
        minRaiseAmountMicroUsdc,
        maxRaiseAmountMicroUsdc,
      );
    } catch {
      return minRaiseAmountMicroUsdc;
    }
  })();
  const decreaseRaiseAmount = () =>
    setRaiseToAmount(currentRaiseAmountMicroUsdc - MIN_RAISE_INCREMENT_MICRO_USDC);
  const increaseRaiseAmount = () =>
    setRaiseToAmount(currentRaiseAmountMicroUsdc + MIN_RAISE_INCREMENT_MICRO_USDC);
  const halfPotRaise = snapRaiseAmount(
    Math.max(
      minRaiseAmountMicroUsdc,
      Math.floor((tableState?.potMicroUsdc ?? minRaiseAmountMicroUsdc) / 2),
    ),
    minRaiseAmountMicroUsdc,
    maxRaiseAmountMicroUsdc,
  );
  const potRaise = snapRaiseAmount(
    Math.max(minRaiseAmountMicroUsdc, tableState?.potMicroUsdc ?? minRaiseAmountMicroUsdc),
    minRaiseAmountMicroUsdc,
    maxRaiseAmountMicroUsdc,
  );

  const targetHint =
    armedMagic && isTargetedMagic(armedMagic)
      ? `Select ${MAGIC_CARD_META[armedMagic]?.title ?? armedMagic} and click a target`
      : '';

  const castTargetedMagic = (targetSocketId?: string) => {
    if (!tableId || !armedMagic || !isTargetedMagic(armedMagic) || !targetSocketId) {
      return;
    }

    getSocket().emit('magic:use', {
      tableId,
      cardType: armedMagic,
      targetPlayerId: targetSocketId,
    });
    queueFeedback(
      {
        kind: 'magic',
        origin: 'self',
        target: roleForSocket(targetSocketId),
        cardType: armedMagic,
        status: 'applied',
      },
      900,
    );
    void playSfx('magic-activate');
    setArmedMagic(null);
    setArmedMagicIndex(null);
    setHoverTargetSocketId('');
    setCursorPoint(null);
    setAimLine(null);
  };

  useEffect(() => {
    if (!armedMagic || !isTargetedMagic(armedMagic)) {
      setAimLine(null);
      return;
    }

    const updateAimLine = (clientX?: number, clientY?: number) => {
      const grid = tableGridRef.current;
      const source =
        grid?.querySelector<HTMLElement>('.mp-magic-card[data-armed="true"]') ??
        playerHandRef.current;
      if (!grid || !source) {
        setAimLine(null);
        return;
      }

      const gridRect = grid.getBoundingClientRect();
      const sourceRect = source.getBoundingClientRect();
      const x1 = sourceRect.left + sourceRect.width / 2 - gridRect.left;
      const y1 = sourceRect.top + sourceRect.height / 2 - gridRect.top;
      let x2 = x1;
      let y2 = y1;

      if (hoverTargetSocketId) {
        const target = grid.querySelector<HTMLElement>(
          `[data-player-socket-id="${hoverTargetSocketId}"]`,
        );
        if (target) {
          const targetRect = target.getBoundingClientRect();
          x2 = targetRect.left + targetRect.width / 2 - gridRect.left;
          y2 = targetRect.top + targetRect.height / 2 - gridRect.top;
        }
      } else if (typeof clientX === 'number' && typeof clientY === 'number') {
        x2 = clientX - gridRect.left;
        y2 = clientY - gridRect.top;
      } else if (cursorPoint) {
        x2 = cursorPoint.x - gridRect.left;
        y2 = cursorPoint.y - gridRect.top;
      }

      setAimLine({
        x1,
        y1,
        x2,
        y2,
        width: gridRect.width,
        height: gridRect.height,
      });
    };

    const handleMouseMove = (event: MouseEvent) => {
      setCursorPoint({ x: event.clientX, y: event.clientY });
      updateAimLine(event.clientX, event.clientY);
    };
    const handleResize = () => updateAimLine();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setArmedMagic(null);
        setArmedMagicIndex(null);
        setHoverTargetSocketId('');
        setCursorPoint(null);
        setAimLine(null);
      }
    };
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !target?.closest('.mp-magic-card[data-armed="true"]') &&
        !target?.closest('[data-player-socket-id]')
      ) {
        setArmedMagic(null);
        setArmedMagicIndex(null);
        setHoverTargetSocketId('');
        setCursorPoint(null);
        setAimLine(null);
      }
    };

    updateAimLine();
    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [armedMagic, armedMagicIndex, cursorPoint, hoverTargetSocketId]);

  if (!tableId) {
    return (
      <main className="table-screen">
        <h1>Table not found</h1>
      </main>
    );
  }

  const actionControls = (
    <section className="mp-action-bar" aria-label="Available actions">
      <div className="mp-action-buttons">
        {canReady ? (
          <button
            className="mp-action-button mp-action-button--ready"
            type="button"
            onClick={toggleReady}
            disabled={Boolean(selfPlayer?.ready)}
          >
            {selfPlayer?.ready ? 'Waiting' : 'Ready'}
          </button>
        ) : (
          <>
            <button
              className="mp-action-button mp-action-button--fold"
              type="button"
              onClick={() => emitAction('fold')}
              disabled={!canAct}
            >
              Fold
            </button>
            <button
              className="mp-action-button mp-action-button--check"
              type="button"
              onClick={() => emitAction('check')}
              disabled={!canCheck}
            >
              Check
            </button>
            <button
              className="mp-action-button mp-action-button--call"
              type="button"
              onClick={() => emitAction('call')}
              disabled={!canCall}
            >
              Call {formatMicroUsdc(callAmountMicroUsdc)}
            </button>
            <button
              className="mp-action-button mp-action-button--raise"
              type="button"
              onClick={() => (raiseOpen ? emitAction('raise') : setRaiseOpen(true))}
              disabled={!canRaise}
            >
              {raiseOpen ? 'Confirm Raise' : 'Raise'}
            </button>
          </>
        )}
      </div>

      <div className="mp-bet-controls" data-open={raiseOpen ? 'true' : 'false'}>
        <button type="button" onClick={decreaseRaiseAmount} disabled={!canRaise}>
          -
        </button>
        <strong>{raiseAmount}</strong>
        <button type="button" onClick={increaseRaiseAmount} disabled={!canRaise}>
          +
        </button>
        <button type="button" onClick={() => setRaiseToAmount(halfPotRaise)} disabled={!canRaise}>
          1/2
        </button>
        <button type="button" onClick={() => setRaiseToAmount(potRaise)} disabled={!canRaise}>
          Pot
        </button>
        <button
          type="button"
          onClick={() => setRaiseToAmount(maxRaiseAmountMicroUsdc)}
          disabled={!canRaise}
        >
          Max
        </button>
        <input
          className="mp-bet-controls__slider"
          type="range"
          min={minRaiseAmountMicroUsdc}
          max={maxRaiseAmountMicroUsdc}
          step={MIN_RAISE_INCREMENT_MICRO_USDC}
          value={currentRaiseAmountMicroUsdc}
          onChange={(event) => handleRaiseSliderChange(event.target.value)}
          disabled={!canRaise}
        />
      </div>
    </section>
  );

  const showdownActive = tableState?.phase === 'showdown';
  const revealedHoleCardsBySocketId = tableState?.revealedHoleCardsBySocketId ?? {};
  const selfShowdownCards =
    showdownActive && selfPlayer
      ? (revealedHoleCardsBySocketId[selfPlayer.socketId] ?? privateState?.holeCards)
      : privateState?.holeCards;
  const opponentShowdownCards =
    showdownActive && primaryOpponent
      ? (revealedHoleCardsBySocketId[primaryOpponent.socketId] ?? [])
      : [];
  const selfShowdownResult =
    showdownActive && tableState?.winnerSocketId
      ? tableState.winnerSocketId === selfPlayer?.socketId
        ? 'winner'
        : 'loser'
      : '';
  const opponentShowdownResult =
    showdownActive && tableState?.winnerSocketId
      ? tableState.winnerSocketId === primaryOpponent?.socketId
        ? 'winner'
        : 'loser'
      : '';
  const selfRowClassName = [
    'mp-player-row',
    'mp-player-row--self',
    isMyTurn ? 'mp-player-row--turn' : '',
    privateState?.shieldActive ? 'mp-player-row--shielded' : '',
    selfShowdownResult ? `mp-player-row--showdown-${selfShowdownResult}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const opponentRowClassName = [
    'mp-player-row',
    'mp-player-row--opponent',
    tableState?.currentTurnSocketId === primaryOpponent?.socketId ? 'mp-player-row--turn' : '',
    armedMagic && primaryOpponent ? 'mp-player-row--targetable' : '',
    armedMagic && hoverTargetSocketId === primaryOpponent?.socketId
      ? 'mp-player-row--selected'
      : '',
    opponentShowdownResult ? `mp-player-row--showdown-${opponentShowdownResult}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <main className="mp-screen" data-scene-state={sceneState}>
      <header className="mp-header">
        <div className="mp-header__left">
          <strong className="mp-logo">WILDCARD</strong>
        </div>
        <div className="mp-header__right">
          <span className="mp-balance">
            {selfPlayer ? formatMicroUsdc(selfPlayer.stackMicroUsdc) : lockedBalance} USDC
          </span>
          <span
            className="mp-user-avatar"
            style={{ backgroundImage: 'url(/assets/wildcard/avatars/duel-portraits.png)' }}
          />
          <strong>{selfPlayer?.playerName ?? 'Player'}</strong>
          <SoundToggle />
          <button
            className="mp-icon-button"
            type="button"
            onClick={handleCashOut}
            disabled={isCashingOut}
            aria-label="Cash out"
          >
            {isCashingOut ? '...' : '$'}
          </button>
        </div>
      </header>

      <section
        className="mp-game-area"
        ref={tableGridRef}
        data-turn-active={isMyTurn ? 'true' : 'false'}
        data-scene-state={sceneState}
      >
        <div className="mp-tavern-prop mp-tavern-prop--left" aria-hidden="true" />
        <div className="mp-tavern-prop mp-tavern-prop--right" aria-hidden="true" />
        <GameFeedbackLayer effects={feedbackEffects} />

        {aimLine && armedMagic ? (
          <svg
            className="table-targeting-overlay"
            viewBox={`0 0 ${aimLine.width} ${aimLine.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="magicTargetBeam" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={beamMeta?.start ?? 'rgba(255, 244, 211, 0.08)'} />
                <stop offset="38%" stopColor={beamMeta?.mid ?? 'rgba(117, 220, 255, 0.72)'} />
                <stop offset="100%" stopColor={beamMeta?.end ?? 'rgba(159, 131, 255, 0.88)'} />
              </linearGradient>
              <filter id="magicTargetGlow">
                <feGaussianBlur stdDeviation="1" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <line
              className="table-targeting-overlay__glow"
              x1={aimLine.x1}
              y1={aimLine.y1}
              x2={aimLine.x2}
              y2={aimLine.y2}
            />
            <line
              className="table-targeting-overlay__beam"
              x1={aimLine.x1}
              y1={aimLine.y1}
              x2={aimLine.x2}
              y2={aimLine.y2}
              filter="url(#magicTargetGlow)"
            />
          </svg>
        ) : null}

        <section
          className={opponentRowClassName}
          data-player-socket-id={primaryOpponent?.socketId ?? ''}
          data-magic-caster={
            magicFx?.casterSocketId === primaryOpponent?.socketId ? 'true' : 'false'
          }
          data-magic-target={
            magicFx?.targetSocketId === primaryOpponent?.socketId ? 'true' : 'false'
          }
          onMouseEnter={
            armedMagic && primaryOpponent
              ? () => setHoverTargetSocketId(primaryOpponent.socketId)
              : undefined
          }
          onMouseLeave={armedMagic ? () => setHoverTargetSocketId('') : undefined}
          onClick={
            armedMagic && primaryOpponent
              ? () => castTargetedMagic(primaryOpponent.socketId)
              : undefined
          }
          aria-label="Opponent area"
        >
          <div className="mp-magic-hand">
            {magicSlots.map((slot) => (
              <MagicDuelCard
                key={slot}
                index={slot}
                concealed={slot < (primaryOpponent?.magicCardsCount ?? 3)}
                disabled
              />
            ))}
          </div>
          <PlayerPortrait
            avatar="/assets/wildcard/avatars/duel-portraits.png"
            avatarPosition="80% 46%"
            portraitFocus="opponent"
            name={primaryOpponent?.playerName ?? 'Waiting for opponent'}
            chips={primaryOpponent ? formatMicroUsdc(primaryOpponent.stackMicroUsdc) : '0'}
            active={tableState?.currentTurnSocketId === primaryOpponent?.socketId}
          />
          <PokerPair
            cards={[opponentShowdownCards[0] ?? 'XX', opponentShowdownCards[1] ?? 'XX']}
            concealed={!showdownActive || opponentShowdownCards.length === 0}
          />
        </section>

        <div className="mp-main-table" aria-label="Main game area">
          <section className="mp-board" aria-label="Poker board">
            <div className="mp-board__runes" aria-hidden="true">
              <RuneMark />
              <span />
              <RuneMark />
            </div>
            <div className="mp-community-row">
              {Array.from({ length: 5 }).map((_, index) => {
                const card = tableState?.communityCards[index];
                return (
                  <div
                    key={index}
                    className="mp-community-slot"
                    data-filled={card ? 'true' : 'false'}
                  >
                    <PlayingCard code={card ?? 'XX'} concealed={!card} animated dealIndex={index} />
                  </div>
                );
              })}
            </div>
            {tableState?.access === 'private' && tableState.roomCode ? (
              <div className="match-room-code" aria-label="private room code">
                <span>Room</span>
                <strong>{tableState.roomCode}</strong>
              </div>
            ) : null}
            {peekReveal ? (
              <div className="table-peek-popup" aria-hidden="true">
                <div className="table-peek-popup__card">
                  <PlayingCard code={peekReveal.revealedCard} />
                </div>
              </div>
            ) : null}
          </section>

          <aside className="mp-pot" aria-label="Pot">
            <span>POT</span>
            <strong>
              <CoinIcon /> {tableState ? formatMicroUsdc(tableState.potMicroUsdc) : '0'}
            </strong>
          </aside>
        </div>

        <section
          className={selfRowClassName}
          ref={playerHandRef}
          data-player-socket-id={selfPlayer?.socketId ?? ''}
          data-magic-caster={magicFx?.casterSocketId === selfPlayer?.socketId ? 'true' : 'false'}
          data-magic-target={magicFx?.targetSocketId === selfPlayer?.socketId ? 'true' : 'false'}
          aria-label="Player area"
        >
          <div className="mp-magic-hand">
            {magicSlots.map((slot) => {
              const cardType = privateState?.magicCards[slot];
              const isFirstEmpty = !cardType && slot === (privateState?.magicCards.length ?? 0);
              return (
                <MagicDuelCard
                  key={slot}
                  index={slot}
                  cardType={cardType}
                  disabled={cardType ? !canUseMagicBase : !canBuyMagic || !isFirstEmpty}
                  armed={Boolean(cardType && armedMagic === cardType && armedMagicIndex === slot)}
                  onClick={
                    cardType
                      ? () => triggerMagic(cardType, slot)
                      : isFirstEmpty && canBuyMagic
                        ? buyMagicCard
                        : undefined
                  }
                />
              );
            })}
          </div>
          <PlayerPortrait
            avatar="/assets/wildcard/avatars/duel-portraits.png"
            avatarPosition="19% 48%"
            portraitFocus="self"
            name={selfPlayer?.playerName ?? 'You'}
            chips={selfPlayer ? formatMicroUsdc(selfPlayer.stackMicroUsdc) : '0'}
            active={isMyTurn}
          />
          <PokerPair
            cards={[selfShowdownCards?.[0] ?? 'XX', selfShowdownCards?.[1] ?? 'XX']}
            concealed={!selfShowdownCards?.[0]}
            playable={canAct}
            selected={canAct && raiseOpen}
          />
        </section>

        {actionControls}

        {targetHint ? <div className="mp-target-hint">{targetHint}</div> : null}
      </section>
    </main>
  );
}
