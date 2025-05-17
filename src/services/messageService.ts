import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { settingsService } from './settingsService';
import { contactsService } from './contactsService';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { TextOverlay } from './uploadService';

export interface ReceivedMessage {
  id: string;
  userId: string;
  displayName: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  timestamp: number;
  viewed: boolean;
  textOverlays?: TextOverlay[];
}

const MESSAGES_STORAGE_KEY = '@received_messages';

// Define the background task
const BACKGROUND_FETCH_TASK = 'background-message-check';

TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    await messageService.checkForNewMessages();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    console.error('Background fetch error:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

class MessageService {
  private messages: ReceivedMessage[] = [];
  private isChecking: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private hasUnviewed: boolean = false;

  constructor() {
    this.loadMessages();
    this.initialize();
  }

  private async initialize() {
    await this.startChecking();
    await this.registerBackgroundTask();
  }

  private async registerBackgroundTask() {
    try {
      const settings = await settingsService.getSettings();
      const checkFrequency = settings.messageCheckFrequency || 30000;
      
      await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
        minimumInterval: Math.max(300, Math.floor(checkFrequency / 1000)), // Convert to seconds and ensure minimum 5 minutes
        stopOnTerminate: false,
        startOnBoot: true,
      });
    } catch (error) {
      console.error('Error registering background task:', error);
    }
  }

  private async loadMessages(): Promise<void> {
    try {
      const savedMessages = await AsyncStorage.getItem(MESSAGES_STORAGE_KEY);
      if (savedMessages) {
        this.messages = JSON.parse(savedMessages);
        this.hasUnviewed = this.messages.some(msg => !msg.viewed);
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  }

  private async saveMessages(messages: ReceivedMessage[]): Promise<void> {
    try {
      await AsyncStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(messages));
    } catch (error) {
      console.error('Error saving messages:', error);
    }
  }

  async clearMessages(): Promise<void> {
    try {
      this.messages = []; // Clear the in-memory messages
      await AsyncStorage.removeItem(MESSAGES_STORAGE_KEY); // Clear the storage
    } catch (error) {
      console.error('Error clearing messages:', error);
      throw error;
    }
  }

  async checkForNewMessages(): Promise<void> {
    if (this.isChecking) return;

    this.isChecking = true;
    try {
      const settings = await settingsService.getSettings();
      if (!settings.userApiKey || !settings.apiEndpoint) {
        console.log('User API Key or API endpoint not set');
        return;
      }

      const netInfo = await NetInfo.fetch();
      if (!netInfo.isConnected) {
        return;
      }

      const response = await fetch(`${settings.apiEndpoint}/_api/v1/mailbox/${settings.userApiKey}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const currentMessages = await this.getMessages();
      const currentMessageIds = new Set(currentMessages.map(msg => msg.id));

      // Get contacts to map user IDs to display names
      const contacts = await contactsService.getContacts();
      const contactMap = new Map(contacts.map(contact => [contact.id, contact.display_name]));

      let hasNewMessages = false;
      for (const item of data) {
        const { fileUrl, timestamp, userId, mediaType, textOverlays } = item;
        // Create a unique ID by combining fileUrl and timestamp
        const uniqueId = `${fileUrl}-${timestamp}`;
        
        if (!currentMessageIds.has(uniqueId)) {
          hasNewMessages = true;
          const newMessage: ReceivedMessage = {
            id: uniqueId,
            userId: userId,
            displayName: contactMap.get(userId) || `User ${userId}`,
            mediaUrl: fileUrl,
            mediaType: mediaType,
            timestamp,
            viewed: false,
            textOverlays: textOverlays || undefined
          };
          currentMessages.push(newMessage);
          currentMessageIds.add(uniqueId);

          // Send notification for the new unseen message
          await this.sendNotification(newMessage);
        }
      }

      if (hasNewMessages) {
        await this.saveMessages(currentMessages);
        this.messages = currentMessages;
        this.hasUnviewed = true;
      } else {
        // Update hasUnviewed based on current messages
        this.hasUnviewed = currentMessages.some(msg => !msg.viewed);
      }
    } catch (error) {
      console.error('Error checking for new messages:', error);
    } finally {
      this.isChecking = false;
    }
  }

  private async sendNotification(message: ReceivedMessage): Promise<void> {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'New Clip Received',
          body: `${message.displayName} sent you a new ${message.mediaType} clip!`,
          data: { messageId: message.id, navigation: 'ReceivedMessages' },
          sound: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
        },
        trigger: null,
      });
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  }

  async getMessages(): Promise<ReceivedMessage[]> {
    // Sort messages by timestamp in descending order (newest first)
    return [...this.messages].sort((a, b) => b.timestamp - a.timestamp);
  }

  async markAsViewed(messageId: string): Promise<void> {
    const message = this.messages.find(m => m.id === messageId);
    if (message && !message.viewed) {
      message.viewed = true;
      await this.saveMessages(this.messages);
      // Update hasUnviewed state after marking as viewed
      this.hasUnviewed = this.messages.some(msg => !msg.viewed);
    }
  }

  hasUnviewedMessages(): boolean {
    return this.hasUnviewed;
  }

  private async startChecking(): Promise<void> {
    if (this.checkInterval) return;

    try {
      const settings = await settingsService.getSettings();
      const checkFrequency = settings.messageCheckFrequency || 30000;

      this.checkInterval = setInterval(async () => {
        await this.checkForNewMessages();
      }, checkFrequency);
    } catch (error) {
      console.error('Error starting message checking:', error);
      // Fallback to default interval if settings can't be loaded
      this.checkInterval = setInterval(async () => {
        await this.checkForNewMessages();
      }, 30000);
    }
  }

  stopChecking(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    try {
      const messages = await this.getMessages();
      const updatedMessages = messages.filter(msg => msg.id !== messageId);
      await this.saveMessages(updatedMessages);
      await this.loadMessages();
    } catch (error) {
      console.error('Error deleting message:', error);
      throw error;
    }
  }
}

export const messageService = new MessageService(); 