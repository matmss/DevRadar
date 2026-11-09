import axios from 'axios';

import { getToken } from './session';

export const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3333';

// A request with no answer after this long fails like an unreachable server (no `response`), so
// a hung GET /auth/me shows the "unavailable" view with "Tentar novamente" instead of
// "Carregando..." forever.
export const REQUEST_TIMEOUT_MS = 10000;

const api = axios.create({
    baseURL: API_URL,
    timeout: REQUEST_TIMEOUT_MS,
});

let onUnauthorized = null;

/**
 * Registers what to do when a request is answered 401 (App ends or re-validates the session).
 * Called for every 401, whatever its body: `code` is the backend's 401 code (`token_expired`,
 * `token_invalid`, `token_missing`), or null when the body has none (e.g. a proxy's 401).
 * `sentToken` is the session token the failed request carried (null if none).
 * @param {((code: string | null, sentToken: string | null) => void) | null} handler
 */
export function setUnauthorizedHandler(handler) {
    onUnauthorized = handler;
}

// Every request carries the session token when there is one, and remembers which token it sent,
// so a 401 for a token another tab has already replaced does not end the new session.
api.interceptors.request.use((config) => {
    const token = getToken();
    config.sessionToken = token;
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(undefined, (error) => {
    const response = error.response;
    if (response && response.status === 401 && onUnauthorized) {
        const code = response.data && typeof response.data.code === 'string' ? response.data.code : null;
        onUnauthorized(code, (error.config && error.config.sessionToken) || null);
    }
    return Promise.reject(error);
});

export default api;
