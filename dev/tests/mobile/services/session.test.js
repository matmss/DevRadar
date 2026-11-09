// src/services/session.js: the session token in expo-secure-store (mocked with an in-memory store).
const fs = require('fs');
const path = require('path');

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    __store: store,
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => { store.set(key, value); }),
    deleteItemAsync: jest.fn(async (key) => { store.delete(key); }),
  };
});

const SecureStore = require('expo-secure-store');

/** Loads a fresh copy of the module (its in-memory token starts at null). */
function freshSession() {
  let session;
  jest.isolateModules(() => {
    session = require('../../../mobile/src/services/session');
  });
  return session;
}

const OPTIONS = { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' };

describe('session storage', () => {
  let warn;
  beforeEach(() => {
    SecureStore.__store.clear();
    jest.clearAllMocks();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('starts signed out with nothing stored', async () => {
    const session = freshSession();
    expect(session.getToken()).toBeNull();
    await expect(session.loadToken()).resolves.toBeNull();
    expect(session.getToken()).toBeNull();
  });

  it('saves the token in secure storage, device-only, and survives a relaunch', async () => {
    const session = freshSession();
    await session.saveToken('token-1');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('devradar.session_token', 'token-1', OPTIONS);
    expect(session.getToken()).toBe('token-1');

    const relaunched = freshSession();
    expect(relaunched.getToken()).toBeNull();
    await expect(relaunched.loadToken()).resolves.toBe('token-1');
    expect(relaunched.getToken()).toBe('token-1');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('devradar.session_token', OPTIONS);
  });

  it('"Sair" clears the token from memory and secure storage', async () => {
    const session = freshSession();
    await session.saveToken('token-1');
    await expect(session.clearToken()).resolves.toBe(true);
    expect(session.getToken()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('devradar.session_token', OPTIONS);
    await expect(freshSession().loadToken()).resolves.toBeNull();
  });

  it('clears for an auth failure only if the failing token is still the one in use', async () => {
    const session = freshSession();
    await session.saveToken('new-token');

    await expect(session.clearToken('old-token')).resolves.toBe(false);
    await expect(session.clearToken(null)).resolves.toBe(false);
    expect(session.getToken()).toBe('new-token');
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();

    await expect(session.clearToken('new-token')).resolves.toBe(true);
    expect(session.getToken()).toBeNull();
    expect(SecureStore.__store.size).toBe(0);
  });

  it('treats unreadable secure storage as signed out', async () => {
    SecureStore.getItemAsync.mockRejectedValueOnce(new Error('Keychain item not found'));
    const session = freshSession();
    await expect(session.loadToken()).resolves.toBeNull();
    expect(session.getToken()).toBeNull();
  });

  it('does not pretend a token was saved when secure storage refuses it', async () => {
    SecureStore.setItemAsync.mockRejectedValueOnce(new Error('value too large'));
    const session = freshSession();
    await expect(session.saveToken('token-1')).rejects.toThrow('value too large');
    expect(session.getToken()).toBeNull();
  });

  it('still ends the in-memory session if deleting from storage fails', async () => {
    const session = freshSession();
    await session.saveToken('token-1');
    SecureStore.deleteItemAsync.mockRejectedValueOnce(new Error('storage busy'));
    await expect(session.clearToken()).resolves.toBe(true);
    expect(session.getToken()).toBeNull();
  });
});

describe('token storage location', () => {
  // US-7: "the token is in platform secure storage (expo-secure-store), not AsyncStorage".
  it('no app source file imports AsyncStorage', () => {
    const srcDir = path.join(__dirname, '../../../mobile/src');
    const files = [];
    (function walk(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      });
    })(srcDir);
    expect(files.length).toBeGreaterThan(0);
    // An import or require of the AsyncStorage package (comments may mention it).
    const importsAsyncStorage = /(from|require\()\s*['"]@react-native-async-storage\//;
    const offenders = files.filter((file) => importsAsyncStorage.test(fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../mobile/package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies)).not.toContain('@react-native-async-storage/async-storage');
    expect(Object.keys(pkg.dependencies)).toContain('expo-secure-store');
  });
});
