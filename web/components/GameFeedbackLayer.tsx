import type { CSSProperties } from 'react';
import type { MagicCardType } from '../../shared/socket-events';

export type FeedbackRole = 'self' | 'opponent' | 'pot';

export type GameFeedbackEffectKind =
  | 'bet'
  | 'check'
  | 'fold'
  | 'magic'
  | 'coin-transfer'
  | 'shield'
  | 'card-swap'
  | 'reroll'
  | 'deal'
  | 'showdown';

export interface GameFeedbackEffect {
  id: string;
  kind: GameFeedbackEffectKind;
  origin?: FeedbackRole;
  target?: FeedbackRole;
  cardType?: MagicCardType;
  status?: 'applied' | 'blocked';
}

const MAGIC_ART: Record<MagicCardType, string> = {
  peek: '/assets/magic/art/peek-custom.webp',
  swap: '/assets/magic/art/swap-custom.webp',
  shield: '/assets/magic/art/shield-custom.webp',
  hex: '/assets/magic/art/hex-custom.webp',
  drain: '/assets/magic/art/drain-custom.webp',
  reroll: '/assets/magic/art/reroll-custom.webp',
  ward: '/assets/magic/art/ward-custom.webp',
};

function CoinBurst({ effect }: { effect: GameFeedbackEffect }) {
  const route = `${effect.origin ?? 'self'}-${effect.target ?? 'pot'}`;
  return (
    <span className="mp-feedback-coin-burst" data-route={route}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="mp-feedback-coin"
          style={{ '--coin-index': index } as CSSProperties}
        >
          <span />
        </span>
      ))}
    </span>
  );
}

function MagicBurst({ effect }: { effect: GameFeedbackEffect }) {
  const route = `${effect.origin ?? 'self'}-${effect.target ?? 'pot'}`;
  const art = effect.cardType ? MAGIC_ART[effect.cardType] : undefined;

  return (
    <span
      className="mp-feedback-magic"
      data-card={effect.cardType ?? 'spell'}
      data-route={route}
      data-status={effect.status ?? 'applied'}
    >
      {art ? (
        <span className="mp-feedback-magic__card" style={{ backgroundImage: `url(${art})` }} />
      ) : null}
      <span className="mp-feedback-magic__beam" />
    </span>
  );
}

function ShieldBurst({ effect }: { effect: GameFeedbackEffect }) {
  return (
    <span
      className="mp-feedback-shield"
      data-target={effect.target ?? effect.origin ?? 'self'}
      data-status={effect.status ?? 'applied'}
    >
      <span />
    </span>
  );
}

function CardMotion({ effect }: { effect: GameFeedbackEffect }) {
  return (
    <span
      className="mp-feedback-card-motion"
      data-kind={effect.kind}
      data-target={effect.target ?? effect.origin ?? 'self'}
    />
  );
}

function RowPulse({ effect }: { effect: GameFeedbackEffect }) {
  return (
    <span
      className="mp-feedback-row-pulse"
      data-kind={effect.kind}
      data-target={effect.target ?? effect.origin ?? 'self'}
    />
  );
}

export function GameFeedbackLayer({ effects }: { effects: GameFeedbackEffect[] }) {
  return (
    <div className="mp-feedback-layer" aria-hidden="true">
      {effects.map((effect) => {
        if (
          effect.kind === 'bet' ||
          effect.kind === 'coin-transfer' ||
          effect.kind === 'showdown'
        ) {
          return <CoinBurst key={effect.id} effect={effect} />;
        }

        if (effect.kind === 'magic') {
          return <MagicBurst key={effect.id} effect={effect} />;
        }

        if (effect.kind === 'shield') {
          return <ShieldBurst key={effect.id} effect={effect} />;
        }

        if (effect.kind === 'card-swap' || effect.kind === 'reroll' || effect.kind === 'deal') {
          return <CardMotion key={effect.id} effect={effect} />;
        }

        return <RowPulse key={effect.id} effect={effect} />;
      })}
    </div>
  );
}
