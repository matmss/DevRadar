// HTTP client for the DevRadar backend. Every request carries the session token when there is
// one, and remembers which token it sent, so a 401 for a token that is no longer in use does not
// end the newer session (services/session.js clearToken).
import axios from 'axios';

import { API_URL, REQUEST_TIMEOUT_MS } from '../config';
import { getToken } from './session';
import { httpAuthFailure } from './authErrors';

const api = axios.create({
  baseURL: API_URL,
  timeout: REQUEST_TIMEOUT_MS,
});

let onUnauthorized = null;

/**
 * Registers what to do when a request is answered 401 (SessionProvider ends the session).
 * @param {((code: string | null, sentToken: string | null) => void) | null} handler
 */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

api.interceptors.request.use((config) => {
  const token = getToken();
  config.sessionToken = token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(undefined, (error) => {
  const failure = httpAuthFailure(error);
  if (failure && onUnauthorized) {
    onUnauthorized(failure.code, (error.config && error.config.sessionToken) || null);
  }
  return Promise.reject(error);
});

export default api;
