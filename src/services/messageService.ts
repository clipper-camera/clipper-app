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
  // Text messages arrive with their body inline and have no file to fetch
  mediaUrl?: string;
  mediaType: 'image' | 'video' | 'text';
  text?: string;
  // Bytes, from the mailbox listing, so the size can be shown before download.
  // Absent on messages received from an older server.
  fileSize?: number;
  timestamp: number;
  viewed: boolean;
  viewedAt?: number;
  textOverlays?: TextOverlay[];
}

export interface SentMessage {
  id: string;
  userId: string;
  text?: string;
  mediaType?: 'image' | 'video';
  uploadId?: string;
  timestamp: number;
  // Server-assigned id, set once the send is accepted. Delivery receipts are
  // matched against it, so a message without one has not reached the server.
  messageId?: string;
  deliveredAt?: number;
}

export interface DeliveryReceipt {
  messageId: string;
  recipientId: number;
  deliveredAt: number;
}

const MESSAGES_STORAGE_KEY = '@received_messages';
const SENT_MESSAGES_STORAGE_KEY = '@sent_text_messages';
const DELETED_IDS_STORAGE_KEY = '@deleted_message_ids';

// A deleted message stays on the server until its retention window closes, so
// it keeps coming back in the mailbox listing until then. Remember what was
// deleted for comfortably longer than that, then forget it.
const DELETED_ID_TTL = 60 * 60 * 1000;

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
  private sentMessages: SentMessage[] = [];
  private deletedIds: Record<string, number> = {};
  private isChecking: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private hasUnviewed: boolean = false;

  constructor() {
    this.loadMessages();
    this.loadSentMessages();
    this.loadDeletedIds();
    this.initialize();
  }

  private async loadDeletedIds(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem(DELETED_IDS_STORAGE_KEY);
      if (saved) {
        this.deletedIds = JSON.parse(saved);
        await this.saveDeletedIds(); // drops any that have aged out
      }
    } catch (error) {
      console.error('Error loading deleted message ids:', error);
    }
  }

  private async saveDeletedIds(): Promise<void> {
    const cutoff = Date.now();
    this.deletedIds = Object.fromEntries(
      Object.entries(this.deletedIds).filter(([, expiresAt]) => expiresAt > cutoff)
    );
    await AsyncStorage.setItem(DELETED_IDS_STORAGE_KEY, JSON.stringify(this.deletedIds));
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
        const { id, fileUrl, fileSize, timestamp, userId, mediaType, textOverlays, text, notify } = item;
        // The server assigns each message an id; older servers did not, so fall
        // back to the fileUrl/timestamp pair those responses can still be keyed by
        const uniqueId = id ?? `${fileUrl}-${timestamp}`;

        if (!currentMessageIds.has(uniqueId) && !this.deletedIds[uniqueId]) {
          hasNewMessages = true;
          const newMessage: ReceivedMessage = {
            id: uniqueId,
            userId: userId,
            displayName: contactMap.get(userId) || `User ${userId}`,
            mediaUrl: fileUrl,
            fileSize: fileSize ?? undefined,
            mediaType: mediaType,
            text: text || undefined,
            timestamp,
            // Quiet messages (notify: false) skip the notification and unread dot
            viewed: notify === false,
            textOverlays: textOverlays || undefined
          };
          currentMessages.push(newMessage);
          currentMessageIds.add(uniqueId);

          if (notify !== false) {
            await this.sendNotification(newMessage);
          }
        }
      }

      if (hasNewMessages) {
        await this.saveMessages(currentMessages);
        this.messages = currentMessages;
      }
      this.hasUnviewed = currentMessages.some(msg => !msg.viewed);

      // Piggyback on the same poll: the server holds receipts until collected,
      // so this catches deliveries that happened while the app was closed
      await this.checkReceipts(settings.apiEndpoint, settings.userApiKey);
    } catch (error) {
      console.error('Error checking for new messages:', error);
    } finally {
      this.isChecking = false;
    }
  }

  // Collects confirmations that messages we sent have been picked up. The server
  // drops each receipt once it hands it over, so what is learned here has to be
  // written down locally.
  private async checkReceipts(apiEndpoint: string, userApiKey: string): Promise<void> {
    try {
      const response = await fetch(`${apiEndpoint}/_api/v1/receipts/${userApiKey}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const receipts: DeliveryReceipt[] = await response.json();
      if (receipts.length === 0) return;

      let changed = false;
      for (const receipt of receipts) {
        // One send fans out to several recipients under a single messageId, so
        // the recipient is what tells those copies apart
        const sent = this.sentMessages.find(
          m => m.messageId === receipt.messageId && Number(m.userId) === receipt.recipientId
        );
        if (sent && !sent.deliveredAt) {
          sent.deliveredAt = receipt.deliveredAt;
          changed = true;
        }
      }

      if (changed) {
        await this.saveSentMessages();
      }
    } catch (error) {
      console.error('Error checking delivery receipts:', error);
    }
  }

  private async sendNotification(message: ReceivedMessage): Promise<void> {
    try {
      const isText = message.mediaType === 'text';
      await Notifications.scheduleNotificationAsync({
        content: {
          title: isText ? message.displayName : 'New Clip Received',
          body: isText
            ? (message.text ?? '')
            : `${message.displayName} sent you a new ${message.mediaType} clip!`,
          data: {
            messageId: message.id,
            navigation: 'ChatThread',
            userId: message.userId,
            displayName: message.displayName,
          },
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

  async getMessagesForContact(userId: string): Promise<ReceivedMessage[]> {
    const all = await this.getMessages();
    return all.filter(m => m.userId === userId);
  }

  private async loadSentMessages(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem(SENT_MESSAGES_STORAGE_KEY);
      if (saved) {
        this.sentMessages = JSON.parse(saved);
      }
    } catch (error) {
      console.error('Error loading sent messages:', error);
    }
  }

  private async saveSentMessages(): Promise<void> {
    await AsyncStorage.setItem(SENT_MESSAGES_STORAGE_KEY, JSON.stringify(this.sentMessages));
  }

  async getSentMessagesForContact(userId: string): Promise<SentMessage[]> {
    return this.sentMessages.filter(m => m.userId === userId);
  }

  // ponytail: sends inline and throws on failure rather than queueing, so the
  // caller can tell the user right away. Route through uploadService's retry
  // queue if flaky-network sends become a problem.
  async sendTextMessage(userId: string, text: string): Promise<SentMessage> {
    const settings = await settingsService.getSettings();
    if (!settings.userApiKey || !settings.apiEndpoint) {
      throw new Error('Settings not configured. Please set User API Key and API Endpoint in settings.');
    }

    const timestamp = Date.now();
    const formData = new FormData();
    formData.append('userPass', settings.userApiKey);
    // Recipient ids are numeric server-side, and arrive from the contacts API as
    // numbers, but a screen param may hand them over as a string
    formData.append('recipients', JSON.stringify([Number(userId)]));
    formData.append('timestamp', timestamp.toString());
    formData.append('text', text);

    const response = await fetch(`${settings.apiEndpoint}/_api/v1/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const result = await response.json();

    const message: SentMessage = {
      id: timestamp.toString(),
      userId,
      text,
      timestamp,
      messageId: result.messageId,
    };
    this.sentMessages.push(message);
    await this.saveSentMessages();
    return message;
  }

  // Links a queued media upload to the id the server gave it, so the delivery
  // receipt that comes back later can be matched to the right sent bubble.
  async recordServerMessageId(uploadId: string, messageId: string): Promise<void> {
    const pending = this.sentMessages.filter(m => m.uploadId === uploadId);
    if (pending.length === 0) return;

    for (const message of pending) {
      message.messageId = messageId;
    }
    await this.saveSentMessages();
  }

  // Records a local echo when media is queued for a recipient (uploadService), so
  // it shows up as a sent bubble in that contact's chat thread too.
  async recordSentMedia(userId: string, mediaType: 'image' | 'video', timestamp: number = Date.now(), uploadId?: string): Promise<void> {
    const message: SentMessage = {
      id: `${timestamp}-${userId}`,
      userId,
      mediaType,
      uploadId,
      timestamp,
    };
    this.sentMessages.push(message);
    await this.saveSentMessages();
  }

  async markAsViewed(messageId: string): Promise<void> {
    const message = this.messages.find(m => m.id === messageId);
    if (message && !message.viewed) {
      message.viewed = true;
      message.viewedAt = Date.now();
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
      // Tombstone it, or the next poll pulls it straight back off the server
      this.deletedIds[messageId] = Date.now() + DELETED_ID_TTL;
      await this.saveDeletedIds();
      await this.loadMessages();
    } catch (error) {
      console.error('Error deleting message:', error);
      throw error;
    }
  }
}

export const messageService = new MessageService(); 