import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ScrollView, SafeAreaView, FlatList, Switch } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FontAwesome6 } from '@expo/vector-icons';
import { uploadService } from '../services/uploadService';
import { messageService } from '../services/messageService';
import { Picker } from '@react-native-picker/picker';
import { settingsService } from '../services/settingsService';
import { contactsService } from '../services/contactsService';
import { serverHealthService } from '../services/serverHealthService';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { useTheme, themeColors } from '../theme/ThemeContext';

type RootStackParamList = {
  Settings: undefined;
  Home: undefined;
};

type SettingsScreenProps = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const SETTINGS_STORAGE_KEY = '@app_settings';
const NOTIFICATIONS_KEY = '@notifications_enabled';
const WIFI_ONLY_KEY = '@wifi_only_enabled';

interface Settings {
  userApiKey: string;
  apiEndpoint: string;
  messageCheckFrequency: number;
}

interface UploadItem {
  id: string;
  timestamp: number;
  mediaType: 'image' | 'video';
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress?: number;
}

interface ConfigurationSectionProps {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  saveSettings: () => void;
}

interface HistorySectionProps {
  pendingUploads: UploadItem[];
  history: UploadItem[];
  renderHistoryItem: ({ item }: { item: UploadItem }) => JSX.Element;
}

const CHECK_FREQUENCIES = [
  { label: '1 minute', value: 60000 },
  { label: '3 minutes', value: 180000 },
  { label: '5 minutes', value: 300000 },
  { label: '10 minutes', value: 600000 },
  { label: '15 minutes', value: 900000 },
  { label: '30 minutes', value: 1800000 },
  { label: '1 hour', value: 3600000 },
  { label: '2 hours', value: 7200000 },
  { label: '4 hours', value: 14400000 },
  { label: '8 hours', value: 28800000 },
];

const ConfigurationSection = ({ settings, setSettings, saveSettings }: ConfigurationSectionProps) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>Configuration</Text>
    <Text style={styles.label}>User API Key</Text>
    <TextInput
      style={styles.input}
      value={settings.userApiKey}
      onChangeText={(text) => setSettings({ ...settings, userApiKey: text })}
      placeholder="Enter API Key"
      placeholderTextColor="#666"
    />
    <Text style={styles.label}>API Endpoint</Text>
    <TextInput
      style={styles.input}
      value={settings.apiEndpoint}
      onChangeText={(text) => setSettings({ ...settings, apiEndpoint: text })}
      placeholder="Enter API Endpoint"
      placeholderTextColor="#666"
    />
    <Text style={styles.label}>Message Check Frequency</Text>
    <View style={styles.pickerContainer}>
      <Picker
        selectedValue={settings.messageCheckFrequency}
        onValueChange={(value) => setSettings({ ...settings, messageCheckFrequency: value })}
        style={styles.picker}
      >
        {CHECK_FREQUENCIES.map((freq) => (
          <Picker.Item key={freq.value} label={freq.label} value={freq.value} />
        ))}
      </Picker>
    </View>
    <TouchableOpacity style={styles.saveButton} onPress={saveSettings}>
      <Text style={styles.saveButtonText}>Save Settings</Text>
    </TouchableOpacity>
  </View>
);

const HistorySection = ({ pendingUploads, history, renderHistoryItem }: HistorySectionProps) => {
  const sortedItems = [...pendingUploads, ...history]
    .sort((a, b) => b.timestamp - a.timestamp);

  return (
    <View style={styles.historySection}>
      {pendingUploads.length > 0 && (
        <View style={styles.pendingUploadsContainer}>
          <Text style={styles.pendingUploadsTitle}>
            {pendingUploads.length} item{pendingUploads.length === 1 ? '' : 's'} waiting to upload
          </Text>
        </View>
      )}
      {sortedItems.length === 0 ? (
        <Text style={styles.emptyText}>No uploads</Text>
      ) : (
        <FlatList
          data={sortedItems}
          renderItem={renderHistoryItem}
          keyExtractor={(item, index) => `${item.timestamp}-${index}`}
          scrollEnabled={false}
        />
      )}
    </View>
  );
};

export default function SettingsScreen() {
  const { theme, toggleTheme } = useTheme();
  const navigation = useNavigation<SettingsScreenProps['navigation']>();
  const [settings, setSettings] = useState<Settings>({
    userApiKey: '',
    apiEndpoint: '',
    messageCheckFrequency: 900000
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<UploadItem[]>([]);
  const [history, setHistory] = useState<UploadItem[]>([]);
  const [checkFrequency, setCheckFrequency] = useState(settings.messageCheckFrequency || 900000);
  const [serverAvailable, setServerAvailable] = useState(false);
  const [serverLatency, setServerLatency] = useState<number | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [wifiOnlyEnabled, setWifiOnlyEnabled] = useState(true);
  const [showAdminZone, setShowAdminZone] = useState(false);

  useEffect(() => {
    loadSettings();
    loadUploadHistory();

    // Set up polling for upload progress and server status
    const pollInterval = setInterval(() => {
      loadUploadHistory();
      setServerAvailable(serverHealthService.getServerAvailability());
      setServerLatency(serverHealthService.getServerLatency());
    }, 1000);

    // Clean up intervals when component unmounts
    return () => {
      clearInterval(pollInterval);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSettings();
      checkServerHealth();
      
      // Set up polling for server health
      const interval = setInterval(() => {
        checkServerHealth();
      }, 10000);

      return () => clearInterval(interval);
    }, [])
  );

  const loadSettings = async () => {
    try {
      const savedSettings = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings);
        setSettings(parsedSettings);
        setCheckFrequency(parsedSettings.messageCheckFrequency || 900000);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const loadUploadHistory = async () => {
    try {
      const [historyData, pendingData] = await Promise.all([
        uploadService.getUploadHistory(),
        uploadService.getPendingUploads()
      ]);
      
      // Update both history and pending uploads
      setHistory(historyData);
      setPendingUploads(pendingData);
    } catch (error) {
      console.error('Error loading upload data:', error);
    }
  };

  const handleSaveSettings = async () => {
    try {
      // Validate inputs
      if (!settings.userApiKey.trim() || !settings.apiEndpoint.trim()) {
        Alert.alert('Error', 'User API Key and API Endpoint are required');
        return;
      }

      // Add https:// if not present
      let endpoint = settings.apiEndpoint.trim().toLowerCase();
      if (endpoint && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
        endpoint = `https://${endpoint}`;
      }

      // Update settings
      await settingsService.updateSettings({
        userApiKey: settings.userApiKey.trim(),
        apiEndpoint: endpoint,
        messageCheckFrequency: settings.messageCheckFrequency
      });

      // Fetch contacts after settings are saved
      try {
        await contactsService.fetchContacts();
      } catch (error) {
        console.error('Error fetching contacts:', error);
      }

      // Show success message
      Alert.alert('Success', 'Settings saved successfully', [
        {
          text: 'OK',
          onPress: () => navigation.goBack()
        }
      ]);
    } catch (error) {
      console.error('Error saving settings:', error);
      Alert.alert(
        'Error',
        'Failed to save settings. Please try again.',
        [
          {
            text: 'OK',
            style: 'cancel'
          }
        ]
      );
    }
  };

  const handleClearMessages = async () => {
    Alert.alert(
      'Clear Messages',
      'Are you sure you want to clear all historical messages? This action cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await messageService.clearMessages();
              Alert.alert('Success', 'All messages have been cleared.');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear messages.');
            }
          },
        },
      ]
    );
  };

  const handleClearHistory = async () => {
    Alert.alert(
      'Clear History',
      'Are you sure you want to clear all upload history? This action cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await uploadService.clearHistory();
              setHistory([]);
              Alert.alert('Success', 'Upload history cleared successfully');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear upload history');
            }
          }
        }
      ]
    );
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getStatusText = (item: UploadItem) => {
    if (item.status === 'pending') return 'Pending';
    if (item.status === 'completed') return '✓';
    if (item.status === 'failed') return '✗';
    return '';
  };

  const getStatusColor = (item: UploadItem) => {
    if (item.status === 'completed') return '#4CAF50';
    if (item.status === 'failed') return '#F44336';
    return '#666';
  };

  const renderHistoryItem = ({ item }: { item: UploadItem }) => (
    <View style={[styles.uploadItem, { backgroundColor: themeColors[theme].background }]}>
      <View style={styles.uploadItemLeft}>
        <FontAwesome6 
          name={item.mediaType === 'image' ? 'image' : 'video'} 
          size={16} 
          color={themeColors[theme].text} 
          style={styles.mediaIcon}
        />
        <Text style={[styles.uploadText, { color: themeColors[theme].text }]}>{formatTimestamp(item.timestamp)}</Text>
      </View>
      <View style={styles.uploadItemRight}>
        {item.status === 'uploading' && item.progress !== undefined ? (
          <Text style={[styles.progressText, { color: themeColors[theme].text }]}>{item.progress}%</Text>
        ) : (
          <Text style={[styles.uploadStatus, { color: getStatusColor(item) }]}>
            {getStatusText(item)}
          </Text>
        )}
      </View>
    </View>
  );

  const checkServerHealth = async () => {
    try {
      await serverHealthService.checkServerHealth();
      setServerAvailable(serverHealthService.getServerAvailability());
      setServerLatency(serverHealthService.getServerLatency());
    } catch (error) {
      console.error('Server health check error:', error);
      setServerAvailable(false);
      setServerLatency(null);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeColors[theme].background }]}>
      <ScrollView style={styles.scrollView}>
        <View style={[styles.header, { borderBottomColor: themeColors[theme].border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <FontAwesome6 name="arrow-left" size={24} color={themeColors[theme].text} />
          </TouchableOpacity>
          <Text style={[styles.headerText, { color: themeColors[theme].text }]}>Settings</Text>
          <View style={styles.serverStatusContainer}>
            <TouchableOpacity 
              style={styles.serverStatusTouchable}
              onPress={() => setShowAdminZone(!showAdminZone)}
            >
              <View style={[
                styles.serverStatusDot,
                { backgroundColor: serverAvailable ? '#4CAF50' : '#F44336' }
              ]} />
              <View>
                <Text style={[styles.serverStatusText, { color: themeColors[theme].text }]}>
                  {serverAvailable ? 'Server Online' : 'Server Offline'}
                </Text>
                {serverLatency !== null && (
                  <Text style={[styles.latencyText, { color: themeColors[theme].text }]}>
                    {serverLatency}ms ping
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.section}>
            <Text style={[styles.headerText, { color: themeColors[theme].text }]}>Configuration</Text>
            <Text style={[styles.label, { color: themeColors[theme].text }]}>User API Key</Text>
            <View style={styles.apiKeyContainer}>
              <TextInput
                style={[styles.input, { 
                  color: themeColors[theme].text, 
                  borderColor: themeColors[theme].border,
                  backgroundColor: themeColors[theme].background,
                  flex: 1
                }]}
                value={settings.userApiKey}
                onChangeText={(text) => setSettings({ ...settings, userApiKey: text })}
                placeholder="Enter API Key"
                placeholderTextColor={themeColors[theme].secondaryText}
                secureTextEntry={!showApiKey}
              />
              <TouchableOpacity 
                style={styles.visibilityToggle}
                onPress={() => setShowApiKey(!showApiKey)}
              >
                <FontAwesome6 
                  name={showApiKey ? "eye-slash" : "eye"} 
                  size={20} 
                  color={themeColors[theme].text} 
                />
              </TouchableOpacity>
            </View>
            <Text style={[styles.label, { color: themeColors[theme].text }]}>API Endpoint</Text>
            <TextInput
              style={[styles.input, { 
                color: themeColors[theme].text, 
                borderColor: themeColors[theme].border,
                backgroundColor: themeColors[theme].background 
              }]}
              value={settings.apiEndpoint}
              onChangeText={(text) => {
                setSettings({ ...settings, apiEndpoint: text.toLowerCase() });
              }}
              placeholder="Enter API Endpoint"
              placeholderTextColor={themeColors[theme].secondaryText}
              autoCapitalize="none"
            />
            <Text style={[styles.label, { color: themeColors[theme].text }]}>Message Check Frequency</Text>
            <View style={[styles.pickerContainer, { 
              borderColor: themeColors[theme].border,
              backgroundColor: themeColors[theme].background 
            }]}>
              <Picker
                selectedValue={settings.messageCheckFrequency}
                onValueChange={(value) => setSettings({ ...settings, messageCheckFrequency: value })}
                style={[styles.picker, { color: themeColors[theme].text, }]}
              >
                {CHECK_FREQUENCIES.map((freq) => (
                  <Picker.Item 
                    key={freq.value} 
                    label={freq.label} 
                    value={freq.value}
                  />
                ))}
              </Picker>
            </View>
            <TouchableOpacity 
              style={[styles.saveButton, { backgroundColor: themeColors[theme].primary }]} 
              onPress={handleSaveSettings}
            >
              <Text style={[styles.saveButtonText, { color: themeColors[theme].text }]}>Save Settings</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={[styles.headerText, { color: themeColors[theme].text }]}>Upload History</Text>
            <HistorySection
              pendingUploads={pendingUploads}
              history={history}
              renderHistoryItem={renderHistoryItem}
            />
          </View>

          {showAdminZone && (
            <View style={styles.section}>
              <Text style={[styles.headerText, { color: themeColors[theme].text }]}>Admin Danger Zone</Text>
              <Text style={[styles.dangerZoneSubtitle, { color: themeColors[theme].text }]}>These actions cannot be undone</Text>
              <TouchableOpacity 
                style={[styles.clearButton, { backgroundColor: themeColors[theme].error }]} 
                onPress={handleClearHistory}
              >
                <Text style={[styles.clearButtonText, { color: themeColors[theme].text }]}>Clear History</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.clearMessagesButton, { backgroundColor: themeColors[theme].warning }]} 
                onPress={handleClearMessages}
              >
                <Text style={[styles.clearMessagesButtonText, { color: themeColors[theme].text }]}>Clear Historical Messages</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  headerText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  serverStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serverStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  serverStatusText: {
    fontSize: 12,
  },
  latencyText: {
    fontSize: 10,
    marginTop: 2,
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 40,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    marginBottom: 8,
  },
  input: {
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  pickerContainer: {
    height: 60,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 16,
  },
  picker: {
    height: 50,
  },
  saveButton: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  dangerZoneSubtitle: {
    fontSize: 14,
    marginBottom: 16,
  },
  clearButton: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  clearButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  clearMessagesButton: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  clearMessagesButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  historySection: {
    padding: 8
  },
  pendingUploadsContainer: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  pendingUploadsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  uploadItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    marginBottom: 8,
  },
  uploadItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '500',
  },
  emptyText: {
    textAlign: 'center',
    padding: 16,
  },
  uploadItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  uploadItemText: {
    fontSize: 14,
    fontWeight: '500',
  },
  uploadItemSubtext: {
    fontSize: 12,
    marginTop: 2,
  },
  mediaIcon: {
    marginRight: 8,
  },
  uploadText: {
    fontSize: 14,
  },
  uploadStatus: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  apiKeyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  visibilityToggle: {
    position: 'absolute',
    right: 12,
    top: '70%',
    transform: [{ translateY: -40 }],
    height: 40,
    width: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverStatusTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});