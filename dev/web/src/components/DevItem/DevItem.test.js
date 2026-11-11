import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import DevItem from './index';
import { githubProfileUrl } from '../../services/githubLogin';

const DEV = {
  _id: '64b7f0c2a1b2c3d4e5f60718',
  github_id: 810438,
  github_username: 'gaearon',
  name: 'Dan Abramov',
  avatar_url: 'https://avatars.githubusercontent.com/u/810438?v=4',
  bio: 'Working on React',
  techs: ['ReactJS', 'Redux'],
};

// Auth slice 6 (QA-AUTH6-1): a dev whose login GitHub gave to another account is displaced; the
// backend marks it github_username_stale and shows a placeholder that is never a GitHub login.
const DISPLACED = { ...DEV, github_username: '_stale_64b7f0c2a1b2c3d4e5f60718', github_username_stale: true };

describe('DevItem', () => {
  it('links to the GitHub profile of a dev with a current login', () => {
    render(<ul><DevItem dev={DEV} /></ul>);
    expect(screen.getByRole('link', { name: 'Acessar Perfil no GitHub' })).toHaveAttribute('href', 'https://github.com/gaearon');
  });

  it('shows the name but no GitHub link for a displaced dev', () => {
    render(<ul><DevItem dev={DISPLACED} /></ul>);
    expect(screen.getByText('Dan Abramov')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Perfil do GitHub indisponível')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('_stale_');
  });
});

describe('DevItem name', () => {
  it('shows a neutral name for a displaced dev whose name (the old login) was cleared', () => {
    render(<ul><DevItem dev={{ ...DISPLACED, name: null }} /></ul>);
    expect(screen.getByText('Dev sem nome')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('githubProfileUrl', () => {
  it.each([
    ['a current login', DEV, 'https://github.com/gaearon'],
    ['a displaced dev', DISPLACED, null],
    ['a stale flag with a valid-looking login', { ...DEV, github_username_stale: true }, null],
    ['a placeholder without the flag', { ...DEV, github_username: '_stale_abc' }, null],
    ['a path in the login', { ...DEV, github_username: '../orgs/x' }, null],
    ['no login', { ...DEV, github_username: undefined }, null],
    ['no dev', null, null],
  ])('%s', (_label, dev, expected) => {
    expect(githubProfileUrl(dev)).toBe(expected);
  });
});
