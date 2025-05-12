import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Button, Alert } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import * as Notifications from 'expo-notifications';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, themeColors } from '../theme/ThemeContext';

const WELCOME_SHOWN_KEY = '@welcome_shown';

type RootStackParamList = {
  Welcome: undefined;
  Home: undefined;
  Settings: undefined;
};

type WelcomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

export default function WelcomeScreen() {
  const { theme } = useTheme();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [notificationPermission, setNotificationPermission] = useState<boolean>(false);
  const [welcomeShown, setWelcomeShown] = useState<boolean>(false);
  const navigation = useNavigation<WelcomeScreenProps['navigation']>();

  useEffect(() => {
    checkWelcomeShown();
  }, []);

  const checkWelcomeShown = async () => {
    try {
      const shown = await AsyncStorage.getItem(WELCOME_SHOWN_KEY);
      if (shown === 'true') {
        navigation.replace('Home');
      } else {
        setWelcomeShown(true);
      }
    } catch (error) {
      console.error('Error checking welcome shown:', error);
    }
  };

  const requestNotificationPermission = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotificationPermission(status === 'granted');
      return status === 'granted';
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  };

  const handleContinue = async () => {
    try {
      // Request camera permission
      if (!cameraPermission?.granted) {
        const cameraResult = await requestCameraPermission();
        if (!cameraResult.granted) {
          Alert.alert(
            'Camera Permission Required',
            'This app needs camera access to take photos and videos. Please enable it in your device settings.',
            [{ text: 'OK' }]
          );
          return;
        }
      }

      // Request notification permission
      const notificationResult = await requestNotificationPermission();
      if (!notificationResult) {
        Alert.alert(
          'Notification Permission Recommended',
          'This app works better with notifications enabled. You can enable it later in settings.',
          [{ text: 'Continue Anyway' }]
        );
      }

      // Mark welcome as shown
      await AsyncStorage.setItem(WELCOME_SHOWN_KEY, 'true');
      
      // Navigate to Home
      navigation.replace('Home');
    } catch (error) {
      console.error('Error in handleContinue:', error);
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
  };

  if (!welcomeShown) {
    return <View style={[styles.container, { backgroundColor: themeColors[theme].background }]} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors[theme].background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: themeColors[theme].text }]}>Welcome to Clipper</Text>
        <Text style={[styles.subtitle, { color: themeColors[theme].text }]}>
          Before we get started, we need a few permissions to make the app work properly.
        </Text>
        
        <View style={styles.permissionList}>
          <Text style={[styles.permissionItem, { color: themeColors[theme].text }]}>• Camera access for taking photos and videos</Text>
          <Text style={[styles.permissionItem, { color: themeColors[theme].text }]}>• Notifications for receiving messages</Text>
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Continue"
            onPress={handleContinue}
            color={themeColors[theme].primary}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
  },
  permissionList: {
    marginBottom: 40,
    width: '100%',
  },
  permissionItem: {
    fontSize: 16,
    marginBottom: 10,
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 200,
  },
}); 