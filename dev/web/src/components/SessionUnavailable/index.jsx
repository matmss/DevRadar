import React from 'react';

import '../SignIn/styles.css';

// Shown when a stored session could not be checked (server unreachable, or rate limited with
// 429): the session is neither confirmed nor ended, so the token is kept and the user can retry
// or sign out. No "Entrar com GitHub" here, since a session is still stored.
function SessionUnavailable({ notice, onRetry, onSignOut }) {
  return (
    <section className="sign-in">
      <strong>DevRadar</strong>
      <p className="sign-in-notice" role="alert">{notice}</p>
      <button type="button" className="sign-in-button" onClick={onRetry}>Tentar novamente</button>
      <button type="button" className="session-unavailable-sign-out" onClick={onSignOut}>Sair</button>
    </section>
  );
}

export default SessionUnavailable;
