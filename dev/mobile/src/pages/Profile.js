import React from 'react'
import { View } from 'react-native'
import { useRoute } from '@react-navigation/native';
import { WebView } from 'react-native-webview';

function Profile() {
  const route = useRoute();
  const { github_username } = route.params;

  return <WebView testID="profile-webview" style={{ flex: 1 }} source={{ uri:`https://github.com/${github_username}` }}/>
}

export default Profile