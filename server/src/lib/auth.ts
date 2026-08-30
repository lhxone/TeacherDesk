import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

export type JwtPayload = { sub: string; email: string };

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.bcryptRounds);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.accessTokenTtlSec });
}

export function verifyAccessToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, config.jwtSecret) as JwtPayload;
  } catch {
    throw ApiError.unauthenticated('登录已过期，请重新登录');
  }
}

/** Opaque refresh token; only its SHA-256 hash is persisted. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = `rt_${crypto.randomBytes(32).toString('hex')}`;
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(rememberMe: boolean): Date {
  const days = rememberMe ? config.refreshTokenTtlDaysRemember : config.refreshTokenTtlDays;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 64;

/** PRD §3.1.1: 8–64 chars, must contain both a letter and a digit. */
export function validatePasswordStrength(password: string): void {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw ApiError.validation('密码校验失败', [
      { field: 'password', message: `密码长度需在 ${PASSWORD_MIN}-${PASSWORD_MAX} 位之间` },
    ]);
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw ApiError.validation('密码校验失败', [
      { field: 'password', message: '密码需同时包含字母和数字' },
    ]);
  }
}

/**
 * In-memory login throttle (PRD §3.1.2: 5 failures → 15 min lockout).
 * Single-instance only; move to Redis when scaling horizontally.
 */
const attempts = new Map<string, { count: number; firstAt: number; lockedUntil?: number }>();

export function assertNotLocked(key: string): void {
  const rec = attempts.get(key);
  if (rec?.lockedUntil && rec.lockedUntil > Date.now()) {
    const mins = Math.ceil((rec.lockedUntil - Date.now()) / 60000);
    throw ApiError.rateLimited(`登录失败次数过多，请 ${mins} 分钟后重试`);
  }
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const rec = attempts.get(key);

  if (!rec || now - rec.firstAt > config.loginLockoutMs) {
    attempts.set(key, { count: 1, firstAt: now });
    return;
  }
  rec.count += 1;
  if (rec.count >= config.loginMaxAttempts) {
    rec.lockedUntil = now + config.loginLockoutMs;
  }
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}

export function resetAllLoginFailures(): void {
  attempts.clear();
}
