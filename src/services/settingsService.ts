import AsyncStorage from '@react-native-async-storage/async-storage';
import { contactsService } from './contactsService';

export interface Settings {
  userId: string;
  apiEndpoint: string;
  messageCheckFrequency: number;
}

const SETTINGS_STORAGE_KEY = '@app_settings';

class SettingsService {
  private static instance: SettingsService;
  private settings: Settings = {
    userId: '',
    apiEndpoint: '',
    messageCheckFrequency: 180000 // Default 3 minutes
  };

  private constructor() {
    this.loadSettings();
  }

  public static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
    return SettingsService.instance;
  }

  private async loadSettings(): Promise<void> {
    try {
      const savedSettings = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
      
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings);
        // Ensure the API endpoint has the correct format
        const baseUrl = parsedSettings.apiEndpoint?.replace(/\/+$/, '') || '';
        const urlWithProtocol = baseUrl.startsWith('http://') || baseUrl.startsWith('https://') 
          ? baseUrl 
          : `http://${baseUrl}`;
        
        this.settings = {
          userId: parsedSettings.userId || '',
          apiEndpoint: urlWithProtocol,
          messageCheckFrequency: parsedSettings.messageCheckFrequency || 180000
        };
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      // Reset to defaults if loading fails
      this.settings = {
        userId: '',
        apiEndpoint: '',
        messageCheckFrequency: 180000
      };
    }
  }

  public async getSettings(): Promise<Settings> {
    return this.settings;
  }

  public async updateSettings(newSettings: Partial<Settings>): Promise<void> {
    try {
      // Validate new settings
      if (newSettings.userId !== undefined && !newSettings.userId.trim()) {
        throw new Error('User ID cannot be empty');
      }

      if (newSettings.apiEndpoint !== undefined && !newSettings.apiEndpoint.trim()) {
        throw new Error('API Endpoint cannot be empty');
      }

      if (newSettings.messageCheckFrequency !== undefined && newSettings.messageCheckFrequency < 30000) {
        throw new Error('Message check frequency must be at least 30 seconds');
      }

      // If user ID is changing, clear existing contacts
      if (newSettings.userId !== undefined && newSettings.userId !== this.settings.userId) {
        await contactsService.clearContacts();
      }

      // Ensure the API endpoint has the correct format
      if (newSettings.apiEndpoint) {
        const baseUrl = newSettings.apiEndpoint.replace(/\/+$/, '');
        const urlWithProtocol = baseUrl.startsWith('http://') || baseUrl.startsWith('https://') 
          ? baseUrl 
          : `http://${baseUrl}`;
        newSettings.apiEndpoint = urlWithProtocol;
      }

      // Update settings with new values, preserving existing values if not provided
      this.settings = {
        ...this.settings,
        ...newSettings
      };

      // Save to AsyncStorage
      await this.saveSettings();
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  }

  private async saveSettings(): Promise<void> {
    try {
      // Validate settings before saving
      if (!this.settings.userId.trim() || !this.settings.apiEndpoint.trim()) {
        throw new Error('Invalid settings: User ID and API Endpoint are required');
      }

      await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Error saving settings:', error);
      throw error;
    }
  }
}

export const settingsService = SettingsService.getInstance(); 