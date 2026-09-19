type RankedCard = {
  rank: number;
  suit: string;
};

export interface HandScore {
  category: number;
  ranks: number[];
}

const RANK_MAP: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

function parseCard(card: string): RankedCard {
  const rank = RANK_MAP[card[0] ?? ''];
  const suit = card[1] ?? '';
  if (!rank || !suit) {
    throw new Error(`Invalid card: ${card}`);
  }

  return { rank, suit };
}

function compareRankLists(left: number[], right: number[]): number {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

export function compareHandScores(left: HandScore, right: HandScore): number {
  if (left.category !== right.category) {
    return left.category - right.category;
  }

  return compareRankLists(left.ranks, right.ranks);
}

function straightHigh(ranks: number[]): number | null {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  if (unique[0] === 14) {
    unique.push(1);
  }

  let streak = 1;
  for (let index = 1; index < unique.length; index += 1) {
    if (unique[index - 1] === unique[index] + 1) {
      streak += 1;
      if (streak >= 5) {
        return unique[index - 4];
      }
      continue;
    }

    streak = 1;
  }

  return null;
}

function evaluateFiveCardHand(cards: RankedCard[]): HandScore {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const suits = cards.map((card) => card.suit);
  const isFlush = suits.every((suit) => suit === suits[0]);
  const straight = straightHigh(ranks);

  const counts = new Map<number, number>();
  for (const rank of ranks) {
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }

  const grouped = [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return right[0] - left[0];
  });

  if (isFlush && straight !== null) {
    return { category: 8, ranks: [straight] };
  }

  if (grouped[0]?.[1] === 4) {
    return { category: 7, ranks: [grouped[0][0], grouped[1]?.[0] ?? 0] };
  }

  if (grouped[0]?.[1] === 3 && grouped[1]?.[1] === 2) {
    return { category: 6, ranks: [grouped[0][0], grouped[1][0]] };
  }

  if (isFlush) {
    return { category: 5, ranks };
  }

  if (straight !== null) {
    return { category: 4, ranks: [straight] };
  }

  if (grouped[0]?.[1] === 3) {
    const kickers = grouped
      .slice(1)
      .map(([rank]) => rank)
      .sort((a, b) => b - a);
    return { category: 3, ranks: [grouped[0][0], ...kickers] };
  }

  if (grouped[0]?.[1] === 2 && grouped[1]?.[1] === 2) {
    const pairs = grouped
      .filter(([, count]) => count === 2)
      .map(([rank]) => rank)
      .sort((a, b) => b - a);
    const kicker = grouped.find(([, count]) => count === 1)?.[0] ?? 0;
    return { category: 2, ranks: [...pairs, kicker] };
  }

  if (grouped[0]?.[1] === 2) {
    const kickers = grouped
      .filter(([, count]) => count === 1)
      .map(([rank]) => rank)
      .sort((a, b) => b - a);
    return { category: 1, ranks: [grouped[0][0], ...kickers] };
  }

  return { category: 0, ranks };
}

function combinations<T>(items: T[], pick: number): T[][] {
  if (pick === 0) return [[]];
  if (items.length < pick) return [];
  if (items.length === pick) return [items];

  const [first, ...rest] = items;
  return [
    ...combinations(rest, pick - 1).map((combo) => [first, ...combo]),
    ...combinations(rest, pick),
  ];
}

export function evaluateBestHand(cards: string[]): HandScore {
  const rankedCards = cards.map(parseCard);
  let best: HandScore | null = null;

  for (const combo of combinations(rankedCards, 5)) {
    const current = evaluateFiveCardHand(combo);
    if (!best || compareHandScores(current, best) > 0) {
      best = current;
    }
  }

  return best ?? { category: 0, ranks: [] };
}
