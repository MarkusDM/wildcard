import { encodeTableIdToBytes32 } from '../../shared/table-id';

const ARC_TESTNET = {
  chainIdDec: 5042002,
  chainIdHex: '0x4cef52',
  chainName: 'Arc Testnet',
  rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC_URL ?? 'https://rpc.testnet.arc.network',
  explorerUrl: process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? 'https://testnet.arcscan.app',
  currencySymbol: 'USDC',
};

const USDC_ADDRESS = (
  process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000'
).toLowerCase();
const VAULT_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? '').toLowerCase();
const VAULT_BALANCES_SELECTOR = '0x27e235e3'; // balances(address)
const VAULT_LOCKED_SELECTOR = '0xd71be8db'; // locked(address,bytes32)
const VAULT_LOCK_SELECTOR = '0xb3b77a51'; // lock(bytes32,uint256)
const VAULT_UNLOCK_SELECTOR = '0xb0768d1e'; // unlock(bytes32,uint256)
const VAULT_SETTLE_SELECTOR = '0xc947bcab'; // settle(bytes32,address[],uint256[])
const VAULT_SETTLED_SELECTOR = '0xd945af1d'; // settled(bytes32)

function padHex(value: string, length = 64): string {
  const normalized = value.replace(/^0x/, '').toLowerCase();
  return normalized.padStart(length, '0');
}

function encodeAddress(address: string): string {
  return padHex(address.replace(/^0x/, ''));
}

function encodeUint256(value: bigint): string {
  return padHex(value.toString(16));
}

function encodeBytes32(value: string): string {
  return padHex(value.replace(/^0x/, ''));
}

function encodeAddressArray(addresses: string[]): string {
  return `${encodeUint256(BigInt(addresses.length))}${addresses.map((address) => encodeAddress(address)).join('')}`;
}

function encodeUint256Array(values: bigint[]): string {
  return `${encodeUint256(BigInt(values.length))}${values.map((value) => encodeUint256(value)).join('')}`;
}

function encodeSettleCall(
  tableId: string,
  payouts: Array<{ address: string; amountUnits: bigint }>,
): string {
  const encodedTableId = encodeTableIdToBytes32(tableId);
  const winnersChunk = encodeAddressArray(payouts.map((item) => item.address));
  const payoutsChunk = encodeUint256Array(payouts.map((item) => item.amountUnits));
  const winnersOffset = 96n;
  const payoutsOffset = winnersOffset + BigInt(winnersChunk.length / 2);

  return `${VAULT_SETTLE_SELECTOR}${encodeBytes32(encodedTableId)}${encodeUint256(winnersOffset)}${encodeUint256(payoutsOffset)}${winnersChunk}${payoutsChunk}`;
}

function toUnits6(amount: string): bigint {
  const raw = amount.trim();
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error('Enter a valid amount');
  }

  const [whole, fraction = ''] = raw.split('.');
  const decimals = (fraction + '000000').slice(0, 6);
  return BigInt(`${whole}${decimals}`);
}

function fromUnits6(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const raw = abs.toString().padStart(7, '0');
  const whole = raw.slice(0, -6);
  const fraction = raw.slice(-6).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

async function request(method: string, params?: unknown[]): Promise<any> {
  if (!window.ethereum) {
    throw new Error('No EVM wallet found');
  }

  return window.ethereum.request({ method, params });
}

export async function connectWallet(): Promise<string> {
  const accounts = (await request('eth_requestAccounts')) as string[];
  const account = accounts[0];
  if (!account) {
    throw new Error('Wallet account not found');
  }
  return account;
}

export async function getChainIdHex(): Promise<string> {
  const chainId = (await request('eth_chainId')) as string;
  return chainId.toLowerCase();
}

export async function ensureArcNetwork(): Promise<void> {
  const currentChain = await getChainIdHex();
  if (currentChain === ARC_TESTNET.chainIdHex) {
    return;
  }

  try {
    await request('wallet_switchEthereumChain', [{ chainId: ARC_TESTNET.chainIdHex }]);
    return;
  } catch (switchError: any) {
    if (switchError?.code !== 4902) {
      throw switchError;
    }
  }

  await request('wallet_addEthereumChain', [
    {
      chainId: ARC_TESTNET.chainIdHex,
      chainName: ARC_TESTNET.chainName,
      rpcUrls: [ARC_TESTNET.rpcUrl],
      nativeCurrency: {
        name: 'USDC',
        symbol: ARC_TESTNET.currencySymbol,
        decimals: 18,
      },
      blockExplorerUrls: [ARC_TESTNET.explorerUrl],
    },
  ]);

  await request('wallet_switchEthereumChain', [{ chainId: ARC_TESTNET.chainIdHex }]);
}

export async function readUsdcBalance(account: string): Promise<string> {
  const data = `0x70a08231${encodeAddress(account)}`;
  const balanceHex = (await request('eth_call', [{ to: USDC_ADDRESS, data }, 'latest'])) as string;
  return fromUnits6(BigInt(balanceHex));
}

export async function readVaultBalance(account: string): Promise<string> {
  if (!VAULT_ADDRESS) {
    return '0';
  }

  const data = `${VAULT_BALANCES_SELECTOR}${encodeAddress(account)}`;
  const balanceHex = (await request('eth_call', [{ to: VAULT_ADDRESS, data }, 'latest'])) as string;
  return fromUnits6(BigInt(balanceHex));
}

export async function readLockedBalance(account: string, tableId: string): Promise<string> {
  if (!VAULT_ADDRESS) {
    return '0';
  }

  const encodedTableId = encodeTableIdToBytes32(tableId);
  const data = `${VAULT_LOCKED_SELECTOR}${encodeAddress(account)}${padHex(encodedTableId.replace(/^0x/, ''))}`;
  const balanceHex = (await request('eth_call', [{ to: VAULT_ADDRESS, data }, 'latest'])) as string;
  return fromUnits6(BigInt(balanceHex));
}

export async function readTableSettled(tableId: string): Promise<boolean> {
  if (!VAULT_ADDRESS) {
    return false;
  }

  const encodedTableId = encodeTableIdToBytes32(tableId);
  const data = `${VAULT_SETTLED_SELECTOR}${padHex(encodedTableId.replace(/^0x/, ''))}`;
  const settledHex = (await request('eth_call', [{ to: VAULT_ADDRESS, data }, 'latest'])) as string;
  return BigInt(settledHex) !== 0n;
}

export async function approveVault(account: string, amountUnits: bigint): Promise<string> {
  if (!VAULT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_VAULT_ADDRESS is not configured');
  }

  const data = `0x095ea7b3${encodeAddress(VAULT_ADDRESS)}${encodeUint256(amountUnits)}`;
  return (await request('eth_sendTransaction', [
    { from: account, to: USDC_ADDRESS, data },
  ])) as string;
}

export async function depositToVault(
  account: string,
  amount: string,
): Promise<{ approveTx: string; depositTx: string }> {
  if (!VAULT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_VAULT_ADDRESS is not configured');
  }

  const units = toUnits6(amount);
  if (units <= 0n) {
    throw new Error('Deposit amount must be greater than zero');
  }

  const approveTx = await approveVault(account, units);
  const depositData = `0xb6b55f25${encodeUint256(units)}`;
  const depositTx = (await request('eth_sendTransaction', [
    {
      from: account,
      to: VAULT_ADDRESS,
      data: depositData,
    },
  ])) as string;

  return { approveTx, depositTx };
}

export async function withdrawFromVault(account: string, amount: string): Promise<string> {
  if (!VAULT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_VAULT_ADDRESS is not configured');
  }

  const units = toUnits6(amount);
  if (units <= 0n) {
    throw new Error('Withdraw amount must be greater than zero');
  }

  const withdrawData = `0x2e1a7d4d${encodeUint256(units)}`;
  return (await request('eth_sendTransaction', [
    {
      from: account,
      to: VAULT_ADDRESS,
      data: withdrawData,
    },
  ])) as string;
}

export async function lockTableBuyIn(
  account: string,
  tableId: string,
  amount: number,
): Promise<string> {
  if (!VAULT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_VAULT_ADDRESS is not configured');
  }

  const units = BigInt(amount) * 1_000_000n;
  const encodedTableId = encodeTableIdToBytes32(tableId);
  const data = `${VAULT_LOCK_SELECTOR}${padHex(encodedTableId.replace(/^0x/, ''))}${encodeUint256(units)}`;
  return (await request('eth_sendTransaction', [
    { from: account, to: VAULT_ADDRESS, data },
  ])) as string;
}

export async function unlockTableBuyIn(
  account: string,
  tableId: string,
  amountUnits: bigint,
): Promise<string> {
  if (!VAULT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_VAULT_ADDRESS is not configured');
  }
  if (amountUnits <= 0n) {
    throw new Error('Unlock amount must be greater than zero');
  }

  const encodedTableId = encodeTableIdToBytes32(tableId);
  const data = `${VAULT_UNLOCK_SELECTOR}${padHex(encodedTableId.replace(/^0x/, ''))}${encodeUint256(amountUnits)}`;
  return (await request('eth_sendTransaction', [
    { from: account, to: VAULT_ADDRESS, data },
  ])) as string;
}

export async function settleTable(
  account: string,
  tableId: string,
  payouts: Array<{ address: string; amountUnits: bigint }>,
): Promise<string> {
  if (!VAULT_ADDRESS) {
    throw new Error('NEXT_PUBLIC_VAULT_ADDRESS is not configured');
  }
  if (payouts.length === 0) {
    throw new Error('Settlement payouts are empty');
  }

  const nonZeroPayouts = payouts.filter((item) => item.amountUnits > 0n);
  if (nonZeroPayouts.length === 0) {
    throw new Error('Settlement payouts are empty');
  }

  const data = encodeSettleCall(tableId, nonZeroPayouts);
  return (await request('eth_sendTransaction', [
    { from: account, to: VAULT_ADDRESS, data },
  ])) as string;
}

export async function waitForTransactionReceipt(
  txHash: string,
  timeoutMs = 120_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = (await request('eth_getTransactionReceipt', [txHash])) as {
      status?: string;
    } | null;
    if (receipt) {
      if (receipt.status === '0x1') {
        return;
      }
      throw new Error('Transaction reverted');
    }

    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }

  throw new Error('Timed out waiting for transaction confirmation');
}

export function getArcConfig() {
  return {
    ...ARC_TESTNET,
    usdcAddress: USDC_ADDRESS,
    vaultAddress: VAULT_ADDRESS,
  };
}
