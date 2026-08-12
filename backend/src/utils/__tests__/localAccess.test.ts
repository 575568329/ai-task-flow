import { describe, it, expect } from 'vitest';
import { isLocalAccess } from '../localAccess.js';

describe('isLocalAccess', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])(
    '应识别本机回环地址 %s',
    (ip) => {
      expect(isLocalAccess(ip)).toBe(true);
    },
  );

  it.each(['192.168.1.5', '10.0.0.1', '172.16.0.1', '8.8.8.8', ''])(
    '应拒绝非本机地址 %s',
    (ip) => {
      expect(isLocalAccess(ip)).toBe(false);
    },
  );
});
