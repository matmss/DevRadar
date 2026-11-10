import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { useSession } from '../SessionContext';
import { STATUS } from '../services/sessionState';

// Shown instead of the map when there is no session (US-7): only "Entrar com GitHub", plus why
// the user is here after a cancelled or failed sign-in or an ended session.
function SignIn() {
  const { state, signIn } = useSession();
  const busy = state.status === STATUS.SIGNING_IN;

  return (
    <View testID="sign-in-screen" style={styles.container}>
      <MaterialIcons name="my-location" size={48} color="#7D40E7" />
      <Text style={styles.title}>DevRadar</Text>
      <Text style={styles.subtitle}>Encontre devs perto de você</Text>

      {state.notice ? (
        <Text testID="sign-in-notice" accessibilityRole="alert" style={styles.notice}>{state.notice}</Text>
      ) : null}

      <TouchableOpacity
        testID="sign-in-button"
        accessibilityRole="button"
        onPress={signIn}
        disabled={busy}
        style={[styles.button, busy && styles.buttonBusy]}
      >
        {busy
          ? <ActivityIndicator color="#FFF" />
          : <Text style={styles.buttonText}>Entrar com GitHub</Text>}
      </TouchableOpacity>
    </View>
  );
}

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    backgroundColor: '#F0F0F5',
  },
  title: {
    marginTop: 10,
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    marginTop: 5,
    fontSize: 16,
    color: '#666',
  },
  notice: {
    marginTop: 25,
    fontSize: 15,
    color: '#C0392B',
    textAlign: 'center',
  },
  button: {
    marginTop: 30,
    height: 50,
    minWidth: 220,
    paddingHorizontal: 25,
    borderRadius: 25,
    backgroundColor: '#8E4DFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonBusy: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secondaryButton: {
    marginTop: 15,
    padding: 10,
  },
  secondaryButtonText: {
    color: '#7D40E7',
    fontSize: 16,
  },
});

export default SignIn;
