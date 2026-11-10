import React from 'react';
import { StatusBar } from 'react-native';

import Routes from './src/routes'
import { SessionProvider } from './src/SessionContext';

export default function App() {
  return (
    <SessionProvider>
      <StatusBar barStyle="light-content" backgroundColor="#7D40E7" />
      <Routes />
    </SessionProvider>
  );
}
