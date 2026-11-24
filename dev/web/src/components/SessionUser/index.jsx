import React from 'react';

import './styles.css';

// Who is signed in (from the session: POST /auth/token or GET /auth/me) and the sign-out button.
function SessionUser({ user, onSignOut }) {
  return (
    <div className="session-user">
      {user.avatar_url && (
        <img className="session-user-avatar" src={user.avatar_url} alt={`Avatar de ${user.github_username}`} />
      )}
      <span className="session-user-name" data-testid="signed-in-username">{user.github_username}</span>
      <button type="button" className="session-user-sign-out" onClick={onSignOut}>Sair</button>
    </div>
  );
}

export default SessionUser;
