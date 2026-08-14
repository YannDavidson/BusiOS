import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

export function encryptCredentials(value: Record<string, unknown>, secret = config.APP_ENCRYPTION_KEY) {
  if (!secret) throw new Error('APP_ENCRYPTION_KEY is required');
  const iv = randomBytes(12), key = createHash('sha256').update(secret).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

export function decryptCredentials<T>(encoded: string, secret = config.APP_ENCRYPTION_KEY): T {
  if (!secret) throw new Error('APP_ENCRYPTION_KEY is required');
  const value = JSON.parse(encoded) as { v: number; iv: string; tag: string; data: string };
  if (value.v !== 1) throw new Error('Unsupported credential envelope');
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString()) as T;
}
