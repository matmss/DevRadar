import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import Main from './pages/Main'
import Profile from './pages/Profile'

const Stack = createNativeStackNavigator();

function Routes() {
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
        <Stack.Screen name="Main" component={Main} options={{ title: 'DevRadar' }} />
        <Stack.Screen name="Profile" component={Profile} options={{ title: 'Perfil GitHub' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default Routes;
