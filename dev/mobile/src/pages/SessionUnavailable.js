import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { useSession } from '../SessionContext';
import { styles } from './SignIn';

// A stored session could not be checked at launch (server unreachable, timeout, or 429): the
// session is neither confirmed nor ended, so the token is kept and the user can retry or sign out.
function SessionUnavailable() {
  const { state, retry, signOut } = useSession();

  return (
    <View testID="session-unavailable-screen" style={styles.container}>
      <Text style={styles.title}>DevRadar</Text>
      <Text testID="session-unavailable-notice" accessibilityRole="alert" style={styles.notice}>{state.notice}</Text>

      <TouchableOpacity testID="retry-button" accessibilityRole="button" onPress={retry} style={styles.button}>
        <Text style={styles.buttonText}>Tentar novamente</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="sign-out-button" accessibilityRole="button" onPress={signOut} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Sair</Text>
      </TouchableOpacity>
    </View>
  );
}

export default SessionUnavailable;
