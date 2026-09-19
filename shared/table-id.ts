export function encodeTableIdToBytes32(tableId: string): `0x${string}` {
  if (!tableId) {
    throw new Error('Table id is required');
  }

  if (tableId.length > 32) {
    throw new Error('Table id is too long for bytes32 encoding');
  }

  let hex = '';
  for (let index = 0; index < tableId.length; index += 1) {
    const charCode = tableId.charCodeAt(index);
    if (charCode > 0x7f) {
      throw new Error('Table id must be ASCII');
    }

    hex += charCode.toString(16).padStart(2, '0');
  }

  return `0x${hex.padEnd(64, '0')}` as `0x${string}`;
}
