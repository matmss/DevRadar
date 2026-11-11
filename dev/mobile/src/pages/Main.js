import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Image, View, Text, TextInput, TouchableOpacity } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import { requestForegroundPermissionsAsync, getCurrentPositionAsync } from 'expo-location';
import { MaterialIcons } from '@expo/vector-icons';

import api from '../services/api';
import {
  connect,
  disconnect,
  subscribeToNewDevs,
  subscribeToDevUpdates,
  subscribeToDevDeletions,
} from '../services/socket';
import { upsertDev, removeDev } from '../services/devList';
import { githubLoginOf } from '../services/githubLogin';
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
  const [locationError, setLocationError] = useState(null);
  // False once the screen is gone (sign-out, session ended): late async results are dropped.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Location can fail (services off, no fix, permission denied): say so instead of a blank screen
  // or an unhandled rejection, and let the user try again.
  const loadInitialPosition = useCallback(async () => {
    setLocationError(null);
    try {
      const { granted } = await requestForegroundPermissionsAsync();
      if (!granted) {
        if (mounted.current) setLocationError(MESSAGES.locationDenied);
        return;
      }

      const { coords } = await getCurrentPositionAsync({
        enableHighAccuracy: true,
      });

      const { latitude, longitude } = coords;

      if (mounted.current) {
        setCurrentRegion({
          latitude,
          longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        });
      }
    } catch (err) {
      console.warn('Could not get the current location:', err.message);
      if (mounted.current) setLocationError(MESSAGES.locationUnavailable);
    }
  }, []);

  useEffect(() => {
    loadInitialPosition();
  }, [loadInitialPosition]);

  // One listener per event for the screen's lifetime (it used to add another on every change of
  // `devs`). Live pushes change the markers without a new search: a new or updated dev replaces
  // its marker in place (or is added), a deleted dev's marker is removed (services/devList.js).
  useEffect(() => {
    const unsubscribers = [
      subscribeToNewDevs(dev => setDevs(current => upsertDev(current, dev))),
      subscribeToDevUpdates(dev => setDevs(current => upsertDev(current, dev))),
      subscribeToDevDeletions(dev => setDevs(current => removeDev(current, dev))),
    ];
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, []);

  // Leaving the map (sign-out, session ended) closes the live subscription.
  useEffect(() => () => disconnect(), []);

  async function loadDevs() {
    const { latitude, longitude } = currentRegion;
    // The session this search belongs to. The socket is opened with the same token, and only if
    // it is still the session in use when the answer arrives (QA-AUTH4-1).
    const token = getToken();
    if (!token) return;
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
      if (mounted.current && !(err.response && err.response.status === 401)) {
        console.warn('Search failed:', err.response ? err.response.status : err.message);
        setSearchError(MESSAGES.searchFailed);
      }
      return;
    }

    // Signed out (or signed in again) while the search was in flight: this screen is gone or
    // belongs to another session, so neither show the result nor open a subscription.
    if (!mounted.current || getToken() !== token) return;

    setDevs(response.data.devs);
    connect(latitude, longitude, techs, token);
  }

  function handleRegionChanged(region) {
    setCurrentRegion(region);
  }

  if(!currentRegion) {
    if (!locationError) return null;
    return (
      <View testID="location-error" style={styles.locationError}>
        <Text accessibilityRole="alert" style={styles.locationErrorText}>{locationError}</Text>
        <TouchableOpacity testID="location-retry-button" accessibilityRole="button" onPress={loadInitialPosition} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Tentar novamente</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return(
    <>
      <MapView testID="map-view" onRegionChangeComplete={handleRegionChanged} initialRegion={currentRegion} style={styles.map}>
        {devs.map(dev => {
          // A displaced dev (its login now belongs to another GitHub account, auth slice 6) has no
          // GitHub profile to open until its owner signs in again.
          const githubLogin = githubLoginOf(dev);
          return (
        <Marker testID={`marker-${dev._id}`} key={dev._id} coordinate={{ latitude: dev.location.coordinates[1], longitude: dev.location.coordinates[0] }}>
          <Image style={styles.avatar} source={{ uri:dev.avatar_url }} />

          <Callout testID={`callout-${dev._id}`} onPress={() =>{
            if (githubLogin) navigation.navigate('Profile', { github_username: githubLogin });
          }}>
            <View style={styles.callout}>
              <Text testID="callout-name" style={styles.devName}>{dev.name || 'Dev sem nome'}</Text>
        <Text testID="callout-bio" style={styles.devBio}>{dev.bio}</Text>
        <Text testID="callout-techs" style={styles.devTechs}>{dev.techs.join(', ')}</Text>
              {!githubLogin && <Text testID="callout-no-profile" style={styles.devBio}>Perfil do GitHub indisponível</Text>}
            </View>
          </Callout>
        </Marker>
          );
        })}
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
  locationError: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  locationErrorText: {
    fontSize: 16,
    color: '#C0392B',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 20,
    height: 46,
    paddingHorizontal: 25,
    borderRadius: 23,
    backgroundColor: '#8E4DFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 16,
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