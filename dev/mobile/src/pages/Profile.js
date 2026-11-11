import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useRoute } from '@react-navigation/native';
import { WebView } from 'react-native-webview';

import { githubProfileUrl } from '../services/githubLogin';

// The dev's GitHub profile in a WebView. Only for a real GitHub login: a displaced dev (auth
// slice 6, its login now belongs to another account) has a placeholder login, and Main.js does
// not open this screen for it; anything else that is not a GitHub login gets a message, never a
// WebView of an arbitrary github.com path.
function Profile() {
  const route = useRoute();
  const { github_username } = route.params || {};
  const uri = githubProfileUrl(github_username);

  if (!uri) {
    return (
      <View testID="profile-unavailable" style={styles.unavailable}>
        <Text accessibilityRole="alert" style={styles.unavailableText}>Perfil do GitHub indisponível</Text>
      </View>
    );
  }

  return <WebView testID="profile-webview" style={{ flex: 1 }} source={{ uri }}/>
}

const styles = StyleSheet.create({
  unavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  unavailableText: { color: '#666', fontSize: 16, textAlign: 'center' },
});

export default Profile
