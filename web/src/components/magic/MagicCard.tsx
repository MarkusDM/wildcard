import Image from 'next/image';
import { useMemo, useState } from 'react';
import styles from './MagicCard.module.css';

export type MagicType = 'peek' | 'swap' | 'shield';

interface MagicCardProps {
  type: MagicType;
  title: string;
  description: string;
  remainingUses: number;
  disabled?: boolean;
  compact?: boolean;
  onClick?: () => void;
}

const ART_PATHS: Record<MagicType, string> = {
  peek: '/assets/magic/art/magic_peek_art.webp',
  swap: '/assets/magic/art/magic_swap_art.webp',
  shield: '/assets/magic/art/magic_shield_art.webp',
};

const TYPE_CLASS: Record<MagicType, string> = {
  peek: styles.peek,
  swap: styles.swap,
  shield: styles.shield,
};

export function MagicCard({
  type,
  title,
  description,
  remainingUses,
  disabled = false,
  compact = false,
  onClick,
}: MagicCardProps) {
  const [showFrame, setShowFrame] = useState(true);
  const artSrc = useMemo(() => ART_PATHS[type], [type]);
  const imageSizes = compact ? '152px' : '(max-width: 760px) 45vw, 240px';

  return (
    <button
      type="button"
      className={`${styles.card} ${TYPE_CLASS[type]} ${disabled ? styles.disabled : ''} ${
        compact ? styles.compact : ''
      }`}
      onClick={onClick}
      disabled={disabled}
      aria-label={`${title} magic card`}
    >
      <div className={styles.header}>
        <h4>{title}</h4>
      </div>

      <div className={styles.artWrap}>
        <Image src={artSrc} alt={`${title} art`} className={styles.art} fill sizes={imageSizes} />
        {showFrame ? (
          <Image
            src="/assets/magic/ui/magic_frame.webp"
            alt=""
            aria-hidden="true"
            className={styles.frame}
            fill
            sizes={imageSizes}
            onError={() => setShowFrame(false)}
          />
        ) : null}
      </div>

      <div className={styles.footer}>
        <p>{description}</p>
      </div>

      <span className={styles.badge}>Uses left: {remainingUses}</span>
    </button>
  );
}
