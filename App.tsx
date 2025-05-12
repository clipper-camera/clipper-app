import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { NavigationContainerRef } from '@react-navigation/native';
import { View, Text } from 'react-native';
import HomeScreen from './src/screens/HomeScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import PreviewScreen from './src/screens/PreviewScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ReceivedMessagesScreen from './src/screens/ReceivedMessagesScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import { TextOverlay } from './src/services/uploadService';
import { ThemeProvider, useTheme, themeColors } from './src/theme/ThemeContext';

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
      if (navigationRef.current) {
        navigationRef.current.navigate('ReceivedMessages');
      }
    });

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
      </GestureHandlerRootView>
    );
  } catch (error) {
    console.error('Error in App component:', error);
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: themeColors[theme].background }}>
        <Text style={{ color: themeColors[theme].text }}>An error occurred. Please check the console.</Text>
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