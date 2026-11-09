import React, { useEffect, useState } from 'react';
import { StyleSheet, Image, View, Text, TextInput, TouchableOpacity } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import { requestForegroundPermissionsAsync, getCurrentPositionAsync } from 'expo-location';
import { MaterialIcons } from '@expo/vector-icons';

import api from '../services/api';
import { connect, disconnect, subscribeToNewDevs } from '../services/socket';
import { getToken } from '../services/session';
import { MESSAGES } from '../services/authErrors';

// Only reachable signed in (routes.js). /search and the socket both send the session token; an
// auth failure from either ends the session in SessionProvider, which replaces this screen with
// the sign-in screen (and unmounting closes the socket below).
function Main({ navigation }) {
  const [devs, setDevs] = useState([]);
  const [currentRegion, setCurrentRegion] = useState(null);
  const [techs, setTechs] = useState('');
  const [searchError, setSearchError] = useState(null);

  useEffect(() => {
    async function loadInitialPosition() {
      const { granted } = await requestForegroundPermissionsAsync();

      if(granted) {
        const { coords } = await getCurrentPositionAsync({
          enableHighAccuracy: true,
        });

        const { latitude, longitude } = coords;

        setCurrentRegion({
          latitude,
          longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        })
      }
    }

    loadInitialPosition();
  }, []);

  // One listener for the screen's lifetime (it used to add another on every change of `devs`).
  useEffect(() => subscribeToNewDevs(dev => {
    setDevs(current => (current.some(item => item._id === dev._id) ? current : [...current, dev]));
  }), []);

  // Leaving the map (sign-out, session ended) closes the live subscription.
  useEffect(() => () => disconnect(), []);

  function setupWebsocket() {
    const { latitude, longitude } = currentRegion;

    connect(latitude, longitude, techs, getToken());
  }

  async function loadDevs() {
    const { latitude, longitude } = currentRegion;
    setSearchError(null);

    let response;
    try {
      response = await api.get('/search', {
        params: {
          latitude,
          longitude,
          techs,
        }
      });
    } catch (err) {
      // A 401 already ended the session (SessionProvider shows the sign-in screen).
      if (!(err.response && err.response.status === 401)) {
        console.warn('Search failed:', err.response ? err.response.status : err.message);
        setSearchError(MESSAGES.searchFailed);
      }
      return;
    }

    setDevs(response.data.devs);
    setupWebsocket();
  }

  function handleRegionChanged(region) {
    setCurrentRegion(region);
  }

  if(!currentRegion) {
    return null;
  }

  return(
    <>
      <MapView testID="map-view" onRegionChangeComplete={handleRegionChanged} initialRegion={currentRegion} style={styles.map}>
        {devs.map(dev => (
        <Marker testID={`marker-${dev._id}`} key={dev._id} coordinate={{ latitude: dev.location.coordinates[1], longitude: dev.location.coordinates[0] }}>
          <Image style={styles.avatar} source={{ uri:dev.avatar_url }} />

          <Callout onPress={() =>{
            navigation.navigate('Profile', { github_username: dev.github_username });
          }}>
            <View style={styles.callout}>
              <Text testID="callout-name" style={styles.devName}>{dev.name}</Text>
        <Text testID="callout-bio" style={styles.devBio}>{dev.bio}</Text>
        <Text testID="callout-techs" style={styles.devTechs}>{dev.techs.join(', ')}</Text>
            </View>
          </Callout>
        </Marker>
        ))}
      </MapView>
      <View style={styles.searchForm}>
          <TextInput
            testID="search-input"
            style={styles.searchInput}
            placeholder="Buscar devs por techs"
            placeholderTextColor="#999"
            autoCapitalize="words"
            autoCorrect={false}
            value={techs}
            onChangeText={text => setTechs(text)}
          />

          <TouchableOpacity testID="search-button" onPress={loadDevs} style={styles.loadButton}>
            <MaterialIcons name="my-location" size={20} color="#FFF" />
          </TouchableOpacity>
      </View>
      {searchError ? (
        <Text testID="search-error" accessibilityRole="alert" style={styles.searchError}>{searchError}</Text>
      ) : null}
    </>
  );

}

const styles = StyleSheet.create({
  map: {
    flex: 1
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 4,
    borderWidth: 4,
    borderColor: '#FFF',
  }, 
  callout: {
    width: 260,
  },
  devName: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  devBio: {
    color: '#666',
    marginTop: 5,
  },
  devTechs: {
    marginTop: 5,
  },
  searchForm: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    zIndex: 5,
    flexDirection: 'row',
  }, 
  searchInput: {
    flex: 1,
    height: 50,
    backgroundColor: '#FFF',
    color: '#333',
    borderRadius: 25,
    paddingHorizontal: 25,
    fontSize: 16, 
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: {
      width: 4,
      height: 4,
    },
    elevation: 2,
  },
  loadButton: {
    width: 50,
    height: 50,
    backgroundColor: '#8E4DFF',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 15,
  },
  searchError: {
    position: 'absolute',
    top: 80,
    left: 20,
    right: 20,
    zIndex: 5,
    padding: 10,
    borderRadius: 4,
    backgroundColor: '#FFF',
    color: '#C0392B',
    textAlign: 'center',
  },
})

export default Main;