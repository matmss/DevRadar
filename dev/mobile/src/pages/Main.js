import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Linking,
  StyleSheet,
  Image,
  View,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import {
  requestForegroundPermissionsAsync,
  getForegroundPermissionsAsync,
  getCurrentPositionAsync,
} from 'expo-location';
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
import { MESSAGES, requestFailureMessage } from '../services/authErrors';

// Why there is no map yet. LOCATING: asking for the permission or reading the position (a busy
// state, no buttons). DENIED: the system can still ask ("Tentar novamente" asks). BLOCKED: it will
// not ask any more, the user has to allow it in the device settings. UNAVAILABLE: no position
// (services off, no fix in time, the permission request itself failed).
const LOCATION_STATUS = {
  LOCATING: 'locating',
  DENIED: 'denied',
  BLOCKED: 'blocked',
  UNAVAILABLE: 'unavailable',
};

const LOCATION_STATUS_MESSAGE = {
  [LOCATION_STATUS.LOCATING]: MESSAGES.locating,
  [LOCATION_STATUS.DENIED]: MESSAGES.locationDenied,
  [LOCATION_STATUS.BLOCKED]: MESSAGES.locationBlocked,
  [LOCATION_STATUS.UNAVAILABLE]: MESSAGES.locationUnavailable,
};

// getCurrentPositionAsync has no timeout of its own (expo-location 57; Android's getCurrentLocation
// can wait for a fix forever, e.g. a cold GPS indoors): after this long the screen says the
// location is unavailable and "Tentar novamente" works again.
export const LOCATION_TIMEOUT_MS = 15000;

/**
 * The current position, or a rejection after `ms`. A position that arrives later is dropped.
 * @param {number} ms
 * @param {{ current: any }} timerRef - holds the timer, so unmounting can clear it
 */
function currentPositionWithin(ms, timerRef) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No position within ${ms} ms`)), ms);
    timerRef.current = timer;
    const settle = (done) => (value) => {
      clearTimeout(timer);
      done(value);
    };
    Promise.resolve()
      .then(() => getCurrentPositionAsync({ enableHighAccuracy: true }))
      .then(settle(resolve), settle(reject));
  });
}

// Only reachable signed in (routes.js). /search and the socket both send the session token; an
// auth failure from either ends the session in SessionProvider, which replaces this screen with
// the sign-in screen (and unmounting closes the socket below).
function Main({ navigation }) {
  const [devs, setDevs] = useState([]);
  const [currentRegion, setCurrentRegion] = useState(null);
  const [techs, setTechs] = useState('');
  const [searchError, setSearchError] = useState(null);
  // One of LOCATION_STATUS while there is no map (the first check starts at once), null once the
  // map is shown.
  const [locationStatus, setLocationStatus] = useState(LOCATION_STATUS.LOCATING);
  // False once the screen is gone (sign-out, session ended): late async results are dropped.
  const mounted = useRef(true);
  // True while a location check runs: a second one (a return to the foreground) is dropped
  // instead of asking twice. Released when the check ends, also by the position timeout.
  const checkingLocation = useRef(false);
  const positionTimer = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(positionTimer.current);
    };
  }, []);

  // Location can fail (services off, no fix, permission denied): say so instead of a blank screen
  // or an unhandled rejection, and let the user try again. `ask: true` (first check, "Tentar
  // novamente") shows the busy state at once and may show the system prompt. `ask: false` (back
  // in the app) only reads the permission, never a prompt, and keeps the current message on screen
  // until the permission reads granted. While the position is read the screen is busy, without
  // buttons, for at most LOCATION_TIMEOUT_MS.
  const loadInitialPosition = useCallback(async ({ ask = true } = {}) => {
    if (checkingLocation.current) return;
    checkingLocation.current = true;
    if (ask) setLocationStatus(LOCATION_STATUS.LOCATING);
    try {
      const permission = ask
        ? await requestForegroundPermissionsAsync()
        : await getForegroundPermissionsAsync();
      if (!mounted.current) return;
      if (!permission.granted) {
        // canAskAgain false: the system shows no prompt any more (iOS after the first denial,
        // Android after "don't ask again" or the second denial), only the settings can allow it.
        setLocationStatus(permission.canAskAgain === false ? LOCATION_STATUS.BLOCKED : LOCATION_STATUS.DENIED);
        return;
      }

      // Allowed: never "allow it" any more while the position is read.
      setLocationStatus(LOCATION_STATUS.LOCATING);
      const { coords } = await currentPositionWithin(LOCATION_TIMEOUT_MS, positionTimer);

      const { latitude, longitude } = coords;

      if (mounted.current) {
        setLocationStatus(null);
        setCurrentRegion({
          latitude,
          longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        });
      }
    } catch (err) {
      console.warn('Could not get the current location:', err.message);
      if (mounted.current) setLocationStatus(LOCATION_STATUS.UNAVAILABLE);
    } finally {
      checkingLocation.current = false;
    }
  }, []);

  useEffect(() => {
    loadInitialPosition();
  }, [loadInitialPosition]);

  // Screen readers: say each new location message. accessibilityRole="alert" alone is not
  // announced on Android (and the busy state has no alert).
  useEffect(() => {
    if (locationStatus) AccessibilityInfo.announceForAccessibility(LOCATION_STATUS_MESSAGE[locationStatus]);
  }, [locationStatus]);

  // While the screen says the permission is missing, coming back to the app (typically from the
  // settings) checks it again. Only a read, never a prompt: the system dialog itself takes the app
  // out of 'active' and back on both platforms, so asking here would ask again and again.
  const permissionMissing = locationStatus === LOCATION_STATUS.DENIED || locationStatus === LOCATION_STATUS.BLOCKED;
  useEffect(() => {
    if (!permissionMissing) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && mounted.current) loadInitialPosition({ ask: false });
    });
    return () => subscription.remove();
  }, [permissionMissing, loadInitialPosition]);

  async function openSettings() {
    try {
      await Linking.openSettings();
    } catch (err) {
      console.warn('Could not open the device settings:', err && err.message);
    }
  }

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
        setSearchError(requestFailureMessage(err, MESSAGES.searchFailed));
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
    if (!locationStatus) return null;
    if (locationStatus === LOCATION_STATUS.LOCATING) {
      return (
        <View
          testID="location-loading"
          accessible
          accessibilityLabel={MESSAGES.locating}
          accessibilityState={{ busy: true }}
          style={styles.locationError}
        >
          <ActivityIndicator size="large" color="#8E4DFF" />
          <Text style={styles.locatingText}>{MESSAGES.locating}</Text>
        </View>
      );
    }
    const blocked = locationStatus === LOCATION_STATUS.BLOCKED;
    return (
      <View testID="location-error" style={styles.locationError}>
        <Text accessibilityRole="alert" style={styles.locationErrorText}>{LOCATION_STATUS_MESSAGE[locationStatus]}</Text>
        {blocked ? (
          <TouchableOpacity
            testID="open-settings"
            accessibilityRole="button"
            accessibilityLabel="Abrir configurações"
            accessibilityHint="Abre as configurações do aparelho para permitir a localização"
            onPress={openSettings}
            style={styles.retryButton}
          >
            <Text style={styles.retryButtonText}>Abrir configurações</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          testID="location-retry-button"
          accessibilityRole="button"
          accessibilityLabel="Tentar novamente"
          onPress={() => loadInitialPosition()}
          style={blocked ? styles.secondaryButton : styles.retryButton}
        >
          <Text style={blocked ? styles.secondaryButtonText : styles.retryButtonText}>Tentar novamente</Text>
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
  locatingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
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
  secondaryButton: {
    marginTop: 12,
    height: 46,
    paddingHorizontal: 25,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: '#8E4DFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#8E4DFF',
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