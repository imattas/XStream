export interface AuthEnv {
  DB: D1Database;
  PAIRING_STARTS: RateLimit;
  APP_ORIGIN: string;
  MICROSOFT_CLIENT_ID: string;
  TOKEN_ENCRYPTION_KEY: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  TURN_ALLOWED_USER_ID?: string;
}

export class AuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export const signedOut = () => new AuthError(401, 'session_expired', 'Sign in with Microsoft to continue.');
export const configurationError = () => new AuthError(503, 'configuration', 'Configure Microsoft sign-in and Worker secrets.');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function base64url(bytes: Uint8Array) {
  let string = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    string += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(string).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function bytes(base64: string) {
  return Uint8Array.from(atob(base64.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
}
export const randomSecret = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
async function encryptionKey(env: AuthEnv) {
  try {
    const key = bytes(env.TOKEN_ENCRYPTION_KEY);
    if (key.length !== 32) throw configurationError();
    return await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch {
    throw configurationError();
  }
}
export async function seal(env: AuthEnv, context: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    await encryptionKey(env), encoder.encode(value));
  return base64url(iv) + '.' + base64url(new Uint8Array(data));
}
export async function unseal(env: AuthEnv, context: string, envelope: string) {
  const [nonce, ciphertext] = envelope.split('.');
  if (!nonce || !ciphertext) throw signedOut();
  const key = await encryptionKey(env);
  try {
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(nonce), additionalData: encoder.encode(context) },
      key, bytes(ciphertext));
    return decoder.decode(data);
  } catch {
    throw signedOut();
  }
}
