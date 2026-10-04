/**
 * User accounts and cookie sessions.
 *
 * - Passwords are hashed with bcrypt (bcryptjs, cost 12); plain passwords and
 *   hashes are never logged or returned to the client.
 * - A session is a random 256-bit token sent to the browser in an HttpOnly
 *   cookie; the database stores only its SHA-256 hash.
 * - requireAuth attaches req.userId from the session — the only identity the
 *   server trusts for personal data.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import db from './db.js';

export const SESSION_COOKIE = 'bc_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const BCRYPT_COST = 12;
const IS_PROD = process.env.NODE_ENV === 'production';

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128; // bcrypt only uses the first 72 bytes

// Used when the email doesn't exist so a failed login takes the same time
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_COST);

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function passwordError(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) return 'הסיסמה ארוכה מדי';
  return null;
}

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const nowIso = () => new Date().toISOString();

const publicUser = user => ({ id: user.id, email: user.email });

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export async function createUser(email, password) {
  const now = nowIso();
  const user = {
    id: 'user_' + crypto.randomBytes(12).toString('hex'),
    email,
    password_hash: await bcrypt.hash(password, BCRYPT_COST),
    created_at: now,
    updated_at: now,
  };
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, user.email, user.password_hash, user.created_at, user.updated_at);
  return publicUser(user);
}

/** Returns the public user for valid credentials, otherwise null (never says which part was wrong). */
export async function verifyCredentials(email, password) {
  const user = findUserByEmail(email);
  const ok = await bcrypt.compare(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  return user && ok ? publicUser(user) : null;
}

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)')
    .run(hashToken(token), userId, now.toISOString(), new Date(now.getTime() + SESSION_MS).toISOString(), now.toISOString());
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: SESSION_MS,
  });
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) {
      const value = part.slice(i + 1).trim();
      try { return decodeURIComponent(value); } catch { return value; }
    }
  }
  return null;
}

/** The user for the request's session cookie, or null. Expired sessions are removed. */
export function sessionUser(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db.prepare(`
    SELECT s.token_hash, s.expires_at, s.last_used_at, u.id, u.email
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash);
  if (!row) return null;
  if (new Date(row.expires_at) <= new Date()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  // Record activity at most once a minute
  if (Date.now() - new Date(row.last_used_at).getTime() > 60_000) {
    db.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').run(nowIso(), tokenHash);
  }
  return { id: row.id, email: row.email };
}

export function destroySession(req, res) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/' });
}

/** Middleware: 401 unless the request carries a valid session; sets req.userId. */
export function requireAuth(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'נדרשת התחברות' });
  req.userId = user.id;
  req.user = user;
  next();
}

// ─── Brute-force protection for login (in-memory, per IP + email) ────────────
const failedLogins = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;

export function loginBlocked(key) {
  const entry = failedLogins.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) return false;
  return entry.count >= MAX_FAILED_LOGINS;
}

export function recordLoginFailure(key) {
  const entry = failedLogins.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) failedLogins.set(key, { first: Date.now(), count: 1 });
  else entry.count++;
}

export function clearLoginFailures(key) {
  failedLogins.delete(key);
}

// ─── Password reset ──────────────────────────────────────────────────────────
// The emailed link carries a random 256-bit token; only its SHA-256 hash is
// stored. A token works once, expires after RESET_MINUTES, and requesting a new
// one cancels older unused ones. Completing a reset signs the user out everywhere.

export const RESET_MINUTES = 30;

/** Creates a one-time reset token for the user and returns the raw token (for the email only). */
export function createPasswordReset(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  db.transaction(() => {
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(userId);
    db.prepare('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), userId, now.toISOString(), new Date(now.getTime() + RESET_MINUTES * 60_000).toISOString());
  })();
  return token;
}

/** Sets a new password if the token is valid, unused and unexpired. Returns true on success. */
export async function resetPasswordWithToken(token, newPassword) {
  if (typeof token !== 'string' || !token) return false;
  const tokenHash = hashToken(token);
  const row = db.prepare('SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?').get(tokenHash);
  if (!row || row.used_at || new Date(row.expires_at) <= new Date()) return false;
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const now = nowIso();
  return db.transaction(() => {
    // Claim the token atomically so two simultaneous requests can't both use it
    const claimed = db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(now, tokenHash).changes;
    if (!claimed) return false;
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(row.user_id);
    return true;
  })();
}

// Reset-request throttle (in-memory, per IP + email)
const resetRequests = new Map();
const RESET_WINDOW_MS = 60 * 60 * 1000;
const MAX_RESET_REQUESTS = 5;

export function resetRequestAllowed(key) {
  const entry = resetRequests.get(key);
  if (!entry || Date.now() - entry.first > RESET_WINDOW_MS) {
    resetRequests.set(key, { first: Date.now(), count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_RESET_REQUESTS;
}
