import AsyncStorage from '@react-native-async-storage/async-storage';
import { contactsService } from './contactsService';

export interface Settings {
  userApiKey: string;
  apiEndpoint: string;
  messageCheckFrequency: number;
}

const SETTINGS_STORAGE_KEY = '@app_settings';

class SettingsService {
  private static instance: SettingsService;
  private settings: Settings = {
    userApiKey: '',
    apiEndpoint: '',
    messageCheckFrequency: 900000 // Default 15 minutes
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
        
        this.settings = {
          userApiKey: parsedSettings.userApiKey || '',
          apiEndpoint: baseUrl,
          messageCheckFrequency: parsedSettings.messageCheckFrequency || 900000
        };
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      // Reset to defaults if loading fails
      this.settings = {
        userApiKey: '',
        apiEndpoint: '',
        messageCheckFrequency: 900000
      };
    }
  }

  public async getSettings(): Promise<Settings> {
    return this.settings;
  }

  public async updateSettings(newSettings: Partial<Settings>): Promise<void> {
    try {
      // Validate new settings
      if (newSettings.userApiKey !== undefined && !newSettings.userApiKey.trim()) {
        throw new Error('User API Key cannot be empty');
      }

      if (newSettings.apiEndpoint !== undefined && !newSettings.apiEndpoint.trim()) {
        throw new Error('API Endpoint cannot be empty');
      }

      if (newSettings.messageCheckFrequency !== undefined && newSettings.messageCheckFrequency < 30000) {
        throw new Error('Message check frequency must be at least 30 seconds');
      }

      // If user API Key is changing, clear existing contacts
      if (newSettings.userApiKey !== undefined && newSettings.userApiKey !== this.settings.userApiKey) {
        await contactsService.clearContacts();
      }

      // Ensure the API endpoint has the correct format
      if (newSettings.apiEndpoint) {
        const baseUrl = newSettings.apiEndpoint.replace(/\/+$/, '');
        newSettings.apiEndpoint = baseUrl;
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
      if (!this.settings.userApiKey.trim() || !this.settings.apiEndpoint.trim()) {
        throw new Error('Invalid settings: User API Key and API Endpoint are required');
      }

      await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Error saving settings:', error);
      throw error;
    }
  }

  validateSettings(): boolean {
    if (!this.settings.userApiKey.trim() || !this.settings.apiEndpoint.trim()) {
      return false;
    }
    return true;
  }
}

export const settingsService = SettingsService.getInstance(); 