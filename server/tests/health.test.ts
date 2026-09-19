import { describe, expect, it } from 'vitest';
import { healthStatus } from '../src/health';

describe('healthStatus', () => {
  it('returns ok', () => {
    expect(healthStatus()).toEqual({ status: 'ok' });
  });
});
