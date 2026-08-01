import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { NavigationContainerRef } from '@react-navigation/native';
import { View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import HomeScreen from './src/screens/HomeScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import PreviewScreen from './src/screens/PreviewScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ReceivedMessagesScreen from './src/screens/ReceivedMessagesScreen';
import ChatThreadScreen from './src/screens/ChatThreadScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import { TextOverlay } from './src/services/uploadService';
import { ThemeProvider, useTheme, themeColors } from './src/theme/ThemeContext';
import { updateService } from './src/services/updateService';

export type RootStackParamList = {
  Welcome: undefined;
  Home: undefined;
  Contacts: undefined;
  Settings: undefined;
  Preview: { 
    mediaUri: string; 
    mediaType: 'image' | 'video'; 
    canSend: boolean;
    textOverlays?: TextOverlay[];
  };
  ReceivedMessages: undefined;
  ChatThread: { userId: string; displayName: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Configure notification handling
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function AppContent() {
  const { theme } = useTheme();
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  useEffect(() => {
    console.log('App component mounted');
    // Handle notification response (when user taps on notification)
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data?.type === 'update_available') {
        // Body tap or the "Update" action both mean yes; only "Later" means no
        if (response.actionIdentifier !== 'update_later' && data.downloadUrl && data.version) {
          updateService.downloadAndInstall(data.downloadUrl as string, data.version as string).catch(error => {
            console.error('Error downloading/installing update:', error);
          });
        }
      } else if (data?.navigation === 'ChatThread' && data.userId && data.displayName) {
        // Deep-link straight into the conversation the message came from
        navigationRef.current?.navigate('ChatThread', {
          userId: data.userId as string,
          displayName: data.displayName as string,
        });
      } else {
        // Fallback: open the conversation list
        navigationRef.current?.navigate('ReceivedMessages');
      }
    });

    updateService.registerNotificationCategory();
    updateService.checkPendingUpdateCompleted();

    // Check for updates on app startup (but not too frequently)
    const checkForUpdatesOnStartup = async () => {
      try {
        const shouldCheck = await updateService.shouldCheckForUpdates(24); // Check every 24 hours
        if (shouldCheck) {
          const updateInfo = await updateService.checkForUpdates();
          if (updateInfo.hasUpdate) {
            await updateService.promptUpdate(updateInfo);
          }
          await updateService.setLastCheckTime();
        }
      } catch (error) {
        console.error('Error checking for updates on startup:', error);
        // Silently fail - don't show error to user on startup
      }
    };
    checkForUpdatesOnStartup();

    return () => {
      subscription.remove();
    };
  }, []);

  try {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Single global status bar config — translucent/edge-to-edge everywhere,
            for every screen, permanently. Toggling this per-screen based on
            navigation focus proved unreliable (React Navigation's native-stack
            keeps prior screens mounted, and the OS didn't always cleanly revert
            the window's edge-to-edge state). Every screen except the camera
            handles this by padding itself via SafeAreaView from
            react-native-safe-area-context (NOT the React Native core one,
            which is an Android no-op) instead of relying on the OS to reserve
            space for it. The camera screen wants full-bleed anyway and
            positions its own overlay buttons using safe-area insets. */}
        <StatusBar translucent backgroundColor="transparent" style={theme === 'dark' ? 'light' : 'dark'} />
        <NavigationContainer
          ref={navigationRef}
          onReady={() => console.log('Navigation container is ready')}
          onStateChange={(state) => console.log('Navigation state changed:', state)}
          theme={{
            dark: theme === 'dark',
            colors: {
              primary: themeColors[theme].primary,
              background: themeColors[theme].background,
              card: themeColors[theme].card,
              text: themeColors[theme].text,
              border: themeColors[theme].border,
              notification: themeColors[theme].primary,
            },
          }}
        >
          <Stack.Navigator
            initialRouteName="Welcome"
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: themeColors[theme].background },
            }}
          >
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Contacts" component={ContactsScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Preview" component={PreviewScreen} />
            <Stack.Screen name="ReceivedMessages" component={ReceivedMessagesScreen} />
            <Stack.Screen name="ChatThread" component={ChatThreadScreen} />
          </Stack.Navigator>
        </NavigationContainer>
        <Toast />
      </GestureHandlerRootView>
    );
  } catch (error) {
    console.error('Error in App component:', error);
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: themeColors[theme].background }}>
        <Text style={{ color: themeColors[theme].text }}>An error occurred. Please check the console.</Text>
        <Toast />
      </View>
    );
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}