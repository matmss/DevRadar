import React from 'react';

import { githubProfileUrl } from '../../services/githubLogin';
import './styles.css';

// A displaced dev (its login now belongs to another GitHub account, auth slice 6) has no GitHub
// link until its owner signs in again: githubProfileUrl returns null for it.
function DevItem({ dev }) {
  const profileUrl = githubProfileUrl(dev);

  return (
    <li className="dev-item">
      <header>
        <img src={dev.avatar_url} alt={dev.name}/>
        <div className="user-info">
          <strong>{dev.name}</strong>
          <span>{dev.techs.join(', ')}</span>
        </div>
      </header>
      <p>{dev.bio}</p>
      {profileUrl
        ? <a href={profileUrl}>Acessar Perfil no GitHub</a>
        : <span className="dev-item-no-profile">Perfil do GitHub indisponível</span>}
    </li>
  );
}

export default DevItem;
