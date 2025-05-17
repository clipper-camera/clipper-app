import { settingsService } from './settingsService';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Contact {
  id: string;
  display_name: string;
}

class ContactsService {
  private static instance: ContactsService;
  private contacts: Contact[] = [];
  private CONTACTS_STORAGE_KEY = '@app_contacts';

  private constructor() {}

  static getInstance(): ContactsService {
    if (!ContactsService.instance) {
      ContactsService.instance = new ContactsService();
    }
    return ContactsService.instance;
  }

  async fetchContacts(): Promise<Contact[]> {
    try {
      const settings = await settingsService.getSettings();
      if (!settings.userApiKey || !settings.apiEndpoint) {
        throw new Error('Settings not configured. Please set User API Key and API Endpoint in settings.');
      }

      const netInfo = await NetInfo.fetch();
      if (!netInfo.isConnected) {
        throw new Error('No internet connection available');
      }

      const response = await fetch(`${settings.apiEndpoint}/_api/v1/contacts/${settings.userApiKey}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      this.contacts = data;
      await this.saveContacts();
      return this.contacts;
    } catch (error) {
      console.error('Error fetching contacts:', error);
      throw error;
    }
  }

  async getContacts(): Promise<Contact[]> {
    if (this.contacts.length === 0) {
      await this.loadContacts();
    }
    return this.contacts;
  }

  private async loadContacts(): Promise<void> {
    try {
      const savedContacts = await AsyncStorage.getItem(this.CONTACTS_STORAGE_KEY);
      if (savedContacts) {
        this.contacts = JSON.parse(savedContacts);
      }
    } catch (error) {
      console.error('Error loading contacts:', error);
      this.contacts = [];
    }
  }

  async clearContacts(): Promise<void> {
    this.contacts = [];
    try {
      await AsyncStorage.removeItem(this.CONTACTS_STORAGE_KEY);
    } catch (error) {
      console.error('Error clearing contacts:', error);
    }
  }

  private async saveContacts(): Promise<void> {
    try {
      await AsyncStorage.setItem(this.CONTACTS_STORAGE_KEY, JSON.stringify(this.contacts));
    } catch (error) {
      console.error('Error saving contacts:', error);
    }
  }
}

export const contactsService = ContactsService.getInstance();