import { REQUEST_ERROR_MESSAGES, isProfileBusy, requestErrorMessage } from './requestErrors';

const BUSY_BODY = {
  error: 'Profile is busy',
  code: 'profile_busy',
  details: ['Too many concurrent changes to this profile; try again'],
};

/** An axios-shaped error with an answer. */
function answered(status, data) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
}

describe('requestErrorMessage', () => {
  it('says "busy, try again" in Portuguese for a 503 profile_busy, not the backend text', () => {
    expect(requestErrorMessage(answered(503, BUSY_BODY))).toBe('Perfil ocupado, tente novamente.');
    expect(REQUEST_ERROR_MESSAGES.profileBusy).toBe('Perfil ocupado, tente novamente.');
  });

  it('shows any other error as the backend says it', () => {
    expect(requestErrorMessage(answered(400, { error: 'Invalid request', details: ['techs is required'] })))
      .toBe('Invalid request: techs is required');
    expect(requestErrorMessage(answered(500, { error: 'Internal server error', code: 'internal_error', details: [] })))
      .toBe('Internal server error');
  });

  it('says the server is unreachable when there is no answer or no JSON error', () => {
    expect(requestErrorMessage(new Error('Network Error'))).toBe(REQUEST_ERROR_MESSAGES.serverUnreachable);
    expect(requestErrorMessage(answered(503, '<html>Service Unavailable</html>'))).toBe(REQUEST_ERROR_MESSAGES.serverUnreachable);
  });
});

describe('isProfileBusy', () => {
  it('is true only for a 503 whose code is profile_busy', () => {
    expect(isProfileBusy(answered(503, BUSY_BODY))).toBe(true);
    expect(isProfileBusy(answered(503, { error: 'Service unavailable', code: 'not_configured' }))).toBe(false);
    expect(isProfileBusy(answered(500, BUSY_BODY))).toBe(false);
    expect(isProfileBusy(answered(503, null))).toBe(false);
    expect(isProfileBusy(new Error('Network Error'))).toBe(false);
    expect(isProfileBusy(undefined)).toBe(false);
  });
});
