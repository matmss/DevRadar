// The DevRadar session token (a 7-day JWT from POST /auth/token, at most about 1.5 KB, under
// expo-secure-store's 2048-byte value limit). It is kept in the platform's secure storage
// (iOS Keychain, Android Keystore-encrypted storage) via expo-secure-store, never AsyncStorage,
// so it survives relaunches until it expires and is not readable by other apps.
//
// WHEN_UNLOCKED_THIS_DEVICE_ONLY: readable only while the device is unlocked and never migrated
// to another device through a backup. On Android the expo-secure-store config plugin excludes
// the store from Auto Backup (android:fullBackupContent / android:dataExtractionRules).
//
// The current token is also cached in memory, so the api and socket services can attach it
// synchronously. loadToken() fills the cache at startup.
import * as SecureStore from 'expo-secure-store';

export const SESSION_TOKEN_KEY = 'devradar.session_token';

const STORE_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

let currentToken = null;

/** @returns {string | null} the session token in use, or null when signed out */
export function getToken() {
  return currentToken;
}

/**
 * Reads the stored token into memory (app start). Unreadable storage (e.g. the Keychain item was
 * created on another device) behaves as signed out.
 * @returns {Promise<string | null>}
 */
export async function loadToken() {
  try {
    currentToken = await SecureStore.getItemAsync(SESSION_TOKEN_KEY, STORE_OPTIONS);
  } catch (err) {
    console.warn('Secure storage unavailable:', err.message);
    currentToken = null;
  }
  return currentToken;
}

/**
 * Persists a new session token. Throws if secure storage refuses it, so sign-in reports a
 * failure instead of pretending the session will survive a relaunch.
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function saveToken(token) {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token, STORE_OPTIONS);
  currentToken = token;
}

/**
 * Ends the session. With `expectedToken` (an auth failure), only if a session is active and it
 * is still that token: a 401 for an older token (e.g. a request that was in flight while the
 * user signed out and back in) must not wipe the new session, and a failure while signed out
 * (no token, e.g. a late request after "Sair") ends nothing, so it shows no "session ended"
 * message (QA-AUTH4-1).
 * @param {string | null} [expectedToken] - omit to clear unconditionally ("Sair")
 * @returns {Promise<boolean>} true if an active session was ended (always true without
 *   `expectedToken`)
 */
export async function clearToken(expectedToken) {
  if (expectedToken !== undefined && (currentToken === null || expectedToken !== currentToken)) return false;
  currentToken = null;
  try {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY, STORE_OPTIONS);
  } catch (err) {
    // The in-memory session is already gone; the stored token is still checked on next launch.
    console.warn('Could not remove the stored session:', err.message);
  }
  return true;
}
