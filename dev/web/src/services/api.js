import axios from 'axios';

import { getToken, clearToken } from './session';

export const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3333';

const api = axios.create({
    baseURL: API_URL
});

// 401 codes from the backend's requireAuth (dev/docs/00-architecture.md, Authentication).
export const SESSION_ENDED_CODES = ['token_expired', 'token_invalid', 'token_missing'];

let onSessionEnded = null;

/**
 * Registers what to do when the backend rejects the session token (App shows the signed-out
 * view). Called with the 401 `code`.
 * @param {((code: string) => void) | null} handler
 */
export function setSessionEndedHandler(handler) {
    onSessionEnded = handler;
}

// Every request carries the session token when there is one.
api.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// A rejected token ends the session wherever it happens (page load, registration, ...).
api.interceptors.response.use(undefined, (error) => {
    const response = error.response;
    const code = response && response.data && response.data.code;
    if (response && response.status === 401 && SESSION_ENDED_CODES.includes(code)) {
        clearToken();
        if (onSessionEnded) onSessionEnded(code);
    }
    return Promise.reject(error);
});

export default api;
