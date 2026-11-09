import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import Main from './pages/Main'
import Profile from './pages/Profile'
import SignIn from './pages/SignIn'
import SessionUnavailable from './pages/SessionUnavailable'
import { useSession } from './SessionContext';
import { STATUS } from './services/sessionState';

const Stack = createNativeStackNavigator();

// Header of the map: who is signed in, and "Sair".
function SessionHeader() {
  const { state, signOut } = useSession();
  return (
    <View style={styles.header}>
      {state.user ? (
        <Text testID="signed-in-username" style={styles.username} numberOfLines={1}>{state.user.github_username}</Text>
      ) : null}
      <TouchableOpacity testID="sign-out-button" accessibilityRole="button" onPress={signOut}>
        <Text style={styles.signOut}>Sair</Text>
      </TouchableOpacity>
    </View>
  );
}

// Signed in: the map and profiles. Otherwise only the sign-in screen (or "unavailable"), so no
// protected screen can be reached without a session (React Navigation's auth-flow pattern).
function Routes() {
  const { state } = useSession();

  if (state.status === STATUS.LOADING) {
    return (
      <View testID="session-loading" style={styles.loading}>
        <ActivityIndicator size="large" color="#7D40E7" />
        <Text style={styles.loadingText}>Carregando...</Text>
      </View>
    );
  }

  let screens;
  if (state.status === STATUS.SIGNED_IN) {
    screens = (
      <>
        <Stack.Screen name="Main" component={Main} options={{ title: 'DevRadar', headerRight: () => <SessionHeader /> }} />
        <Stack.Screen name="Profile" component={Profile} options={{ title: 'Perfil GitHub' }} />
      </>
    );
  } else if (state.status === STATUS.UNAVAILABLE) {
    screens = <Stack.Screen name="SessionUnavailable" component={SessionUnavailable} options={{ title: 'DevRadar' }} />;
  } else {
    screens = <Stack.Screen name="SignIn" component={SignIn} options={{ title: 'DevRadar' }} />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerTintColor: '#FFF',
          headerBackTitleVisible: false,
          headerStyle: {
            backgroundColor: '#7D40E7'
          }
        }}
      >
        {screens}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  username: {
    color: '#FFF',
    marginRight: 15,
    maxWidth: 140,
  },
  signOut: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
});

export default Routes;
