import React from 'react';

import { githubProfileUrl } from '../../services/githubLogin';
import './styles.css';

// Shown when a dev has no name: a displaced dev whose name was only its old login has it cleared
// by the backend (the old login now belongs to someone else).
const UNNAMED = 'Dev sem nome';

// A displaced dev (its login now belongs to another GitHub account, auth slice 6) has no GitHub
// link until its owner signs in again: githubProfileUrl returns null for it.
function DevItem({ dev }) {
  const profileUrl = githubProfileUrl(dev);
  const name = dev.name || UNNAMED;

  return (
    <li className="dev-item">
      <header>
        <img src={dev.avatar_url} alt={name}/>
        <div className="user-info">
          <strong>{name}</strong>
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
