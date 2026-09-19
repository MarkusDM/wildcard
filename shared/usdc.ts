export const MICRO_USDC_PER_USDC = 1_000_000;
export const MIN_RAISE_INCREMENT_MICRO_USDC = 100_000;

export function stakeToMicroUsdc(stake: number): number {
  return stake * MICRO_USDC_PER_USDC;
}

export function formatMicroUsdc(value: number): string {
  const rounded = (value / MICRO_USDC_PER_USDC).toFixed(2);
  return rounded.replace(/\.?0+$/, '');
}

export function parseUsdcToMicroUsdc(value: string): number {
  const normalized = value.trim();
  if (!normalized || !/^\d+(\.\d{0,6})?$/.test(normalized)) {
    throw new Error('Enter a valid USDC amount');
  }

  const [whole, fraction = ''] = normalized.split('.');
  return Number(`${whole}${fraction.padEnd(6, '0')}`);
}
