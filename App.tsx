import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { NavigationContainerRef } from '@react-navigation/native';
import { View, Text, Linking } from 'react-native';
import Toast from 'react-native-toast-message';
import HomeScreen from './src/screens/HomeScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import PreviewScreen from './src/screens/PreviewScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ReceivedMessagesScreen from './src/screens/ReceivedMessagesScreen';
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
      if (data?.type === 'apk_install') {
        // Handle APK installation notification
        console.log('APK installation notification tapped:', data);
        if (data.apkUri) {
          // Launch APK installer with proper intent
          Linking.openURL(data.apkUri).catch(error => {
            console.error('Error launching APK installer:', error);
          });
        }
      } else {
        // Handle other notifications (like received messages)
        if (navigationRef.current) {
          navigationRef.current.navigate('ReceivedMessages');
        }
      }
    });

    // // Check for updates on app startup (but not too frequently)
    // const checkForUpdatesOnStartup = async () => {
    //   try {
    //     const shouldCheck = await updateService.shouldCheckForUpdates(24); // Check every 24 hours
    //     if (shouldCheck) {
    //       const updateInfo = await updateService.checkForUpdates();
    //       if (updateInfo.hasUpdate) {
    //         // Delay the notification slightly to let the app finish loading
    //         setTimeout(() => {
    //           updateService.showUpdateNotification(updateInfo);
    //         }, 2000);
    //       }
    //       await updateService.setLastCheckTime();
    //     }
    //   } catch (error) {
    //     console.error('Error checking for updates on startup:', error);
    //     // Silently fail - don't show error to user on startup
    //   }
    // };
    // checkForUpdatesOnStartup();

    return () => {
      subscription.remove();
    };
  }, []);

  try {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
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
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}