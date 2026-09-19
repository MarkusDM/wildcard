import { encodeTableIdToBytes32 } from '../../../shared/table-id';
import { ensureServerEnvLoaded } from '../env';

ensureServerEnvLoaded();

const DEFAULT_ARC_RPC_URL = 'https://rpc.testnet.arc.network';
const DEFAULT_VAULT_ADDRESS = '';

const ARC_RPC_URL = process.env.ARC_RPC_URL ?? DEFAULT_ARC_RPC_URL;
const ARC_VAULT_ADDRESS = (process.env.ARC_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS).toLowerCase();
const BALANCES_SELECTOR = '0x27e235e3'; // balances(address)
const LOCKED_SELECTOR = '0xd71be8db'; // locked(address,bytes32)
const SETTLED_SELECTOR = '0xd945af1d'; // settled(bytes32)

function normalizeHex(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value;
}

function encodeAddress(address: string): string {
  return normalizeHex(address).toLowerCase().padStart(64, '0');
}

function encodeBytes32(value: `0x${string}`): string {
  return normalizeHex(value).padStart(64, '0');
}

export function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function getArcChainConfig() {
  return {
    rpcUrl: ARC_RPC_URL,
    vaultAddress: ARC_VAULT_ADDRESS,
  };
}

async function rpcCall(data: string): Promise<bigint> {
  if (!ARC_VAULT_ADDRESS) {
    throw new Error('ARC_VAULT_ADDRESS is not configured');
  }

  const response = await fetch(ARC_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: ARC_VAULT_ADDRESS, data }, 'latest'],
    }),
  });

  if (!response.ok) {
    throw new Error(`Arc RPC request failed (${response.status})`);
  }

  const payload = (await response.json()) as { result?: string; error?: { message?: string } };
  if (payload.error) {
    throw new Error(payload.error.message ?? 'Arc RPC returned error');
  }

  if (!payload.result) {
    throw new Error('Arc RPC returned empty result');
  }

  return BigInt(payload.result);
}

async function rpcCallBoolean(data: string): Promise<boolean> {
  if (!ARC_VAULT_ADDRESS) {
    throw new Error('ARC_VAULT_ADDRESS is not configured');
  }

  const response = await fetch(ARC_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: ARC_VAULT_ADDRESS, data }, 'latest'],
    }),
  });

  if (!response.ok) {
    throw new Error(`Arc RPC request failed (${response.status})`);
  }

  const payload = (await response.json()) as { result?: string; error?: { message?: string } };
  if (payload.error) {
    throw new Error(payload.error.message ?? 'Arc RPC returned error');
  }

  if (!payload.result) {
    throw new Error('Arc RPC returned empty result');
  }

  return BigInt(payload.result) !== 0n;
}

export async function readVaultBalanceUsdc(walletAddress: string): Promise<bigint> {
  return rpcCall(`${BALANCES_SELECTOR}${encodeAddress(walletAddress)}`);
}

export async function readLockedBalanceUsdc(
  walletAddress: string,
  tableId: string,
): Promise<bigint> {
  const encodedTableId = encodeTableIdToBytes32(tableId);
  return rpcCall(
    `${LOCKED_SELECTOR}${encodeAddress(walletAddress)}${encodeBytes32(encodedTableId)}`,
  );
}

export async function readTableSettled(tableId: string): Promise<boolean> {
  const encodedTableId = encodeTableIdToBytes32(tableId);
  return rpcCallBoolean(`${SETTLED_SELECTOR}${encodeBytes32(encodedTableId)}`);
}
