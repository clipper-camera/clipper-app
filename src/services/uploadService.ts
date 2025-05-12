import * as FileSystem from 'expo-file-system';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsService, Settings } from './settingsService';
import { serverHealthService } from './serverHealthService';

export interface TextOverlay {
  id: string;
  text: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  scale: number;
  color: string;
  fontSize: number;
  fontFamily: string;
}

interface UploadQueueItem {
  id: string;
  mediaUri: string;
  mediaType: 'image' | 'video';
  recipientIds: string[];
  timestamp: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  retryCount?: number;
  textOverlays?: TextOverlay[];
}

interface FormDataValue {
  uri: string;
  type: string;
  name: string;
}

interface UploadHistoryItem {
  id: string;
  timestamp: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: string;
  progress?: number;
  mediaType: 'image' | 'video';
}

const QUEUE_STORAGE_KEY = '@upload_queue';
const HISTORY_STORAGE_KEY = '@upload_history';

class UploadService {
  private queue: UploadQueueItem[] = [];
  private isMonitoring: boolean = false;
  private history: UploadHistoryItem[] = [];
  private currentUploadProgress: number = 0;
  private isProcessing: boolean = false;
  private lastProcessTime: number = 0;
  private readonly PROCESS_INTERVAL: number = 2000; // 2 seconds

  constructor() {
    this.loadQueue();
    this.loadHistory();
    this.startNetworkMonitoring();
    // Attempt to process queue immediately
    this.processQueue();
  }

  async addToQueue(mediaUri: string, mediaType: 'image' | 'video', recipientIds: string[] = [], textOverlays: TextOverlay[] = []): Promise<void> {
    const item: UploadQueueItem = {
      id: Date.now().toString(),
      mediaUri,
      mediaType,
      recipientIds,
      timestamp: Date.now(),
      status: 'pending',
      textOverlays
    };

    this.queue.push(item);
    await this.saveQueue();
    
    // Process immediately for new uploads
    this.lastProcessTime = 0;
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    // Check if enough time has passed since last processing
    const now = Date.now();
    if (now - this.lastProcessTime < this.PROCESS_INTERVAL) {
      // Schedule next attempt
      setTimeout(() => this.processQueue(), this.PROCESS_INTERVAL - (now - this.lastProcessTime));
      return;
    }

    this.isProcessing = true;
    this.lastProcessTime = now;

    try {
      // Check server availability before processing queue
      const isServerAvailable = await serverHealthService.checkServerHealth();
      if (!isServerAvailable) {
        console.log('Server not available, skipping queue processing');
        this.isProcessing = false;
        return;
      }

      // Check if we're on WiFi
      const netInfo = await NetInfo.fetch();
      if (!netInfo.isConnected) {
        console.log('No internet connection available, skipping queue processing');
        this.isProcessing = false;
        return;
      }

      if (netInfo.type !== 'wifi') {
        console.log('Waiting for WiFi connection before uploading...');
        this.isProcessing = false;
        return;
      }

      // Sort queue by timestamp, oldest first
      const sortedQueue = [...this.queue].sort((a, b) => a.timestamp - b.timestamp);
      
      for (const item of sortedQueue) {
        try {
          // Initialize retry count if not set
          if (item.retryCount === undefined) {
            item.retryCount = 0;
          }

          // Skip if we've already retried too many times
          if (item.retryCount >= 3) {
            console.log(`Max retries reached for item ${item.id}, marking as failed`);
            await this.updateItemStatus(item.id, 'failed');
            // Remove the item from the queue after max retries
            this.queue = this.queue.filter(q => q.id !== item.id);
            await this.saveQueue();
            continue;
          }

          await this.uploadItem(item);
          // Remove the item from the queue after successful upload
          this.queue = this.queue.filter(q => q.id !== item.id);
          await this.saveQueue();
        } catch (error) {
          console.error('Error uploading item:', error);
          
          // Increment retry count
          const queueIndex = this.queue.findIndex(q => q.id === item.id);
          if (queueIndex !== -1) {
            this.queue[queueIndex] = {
              ...this.queue[queueIndex],
              retryCount: (this.queue[queueIndex].retryCount || 0) + 1,
              status: 'pending' // Reset status to pending for retry
            };
            await this.saveQueue();
          }

          // If we've reached max retries, mark as failed and remove from queue
          if ((item.retryCount || 0) >= 2) { // 2 retries + initial attempt = 3 total attempts
            await this.updateItemStatus(item.id, 'failed');
            this.queue = this.queue.filter(q => q.id !== item.id);
            await this.saveQueue();
          }
        }
      }
    } finally {
      this.isProcessing = false;
      // Only check for more items if we're not in a retry loop
      if (this.queue.length > 0 && !this.queue.some(item => item.status === 'uploading')) {
        this.processQueue();
      }
    }
  }

  private async uploadItem(item: UploadQueueItem): Promise<void> {
    try {
      const settings = await settingsService.getSettings();
      if (!settings.userId || !settings.apiEndpoint) {
        throw new Error('Settings not configured. Please set User ID and API Endpoint in settings.');
      }

      // Check if file exists before attempting upload
      const fileInfo = await FileSystem.getInfoAsync(item.mediaUri);
      if (!fileInfo.exists) {
        console.log(`File not found: ${item.mediaUri}, marking as failed`);
        await this.updateItemStatus(item.id, 'failed');
        
        // Update history with appropriate error message
        const historyIndex = this.history.findIndex(h => h.id === item.id);
        if (historyIndex !== -1) {
          this.history[historyIndex] = {
            ...this.history[historyIndex],
            status: 'failed',
            error: 'File not found on device'
          };
          await this.saveHistory();
        }
        
        // Remove from queue since we can't upload a non-existent file
        await this.removeFromQueue(item.id);
        return;
      }

      // Update queue item status to uploading
      await this.updateItemStatus(item.id, 'uploading');

      // Add to history with initial status only if it doesn't already exist
      const existingHistoryIndex = this.history.findIndex(h => h.id === item.id);
      if (existingHistoryIndex === -1) {
        const historyItem = {
          id: item.id,
          timestamp: item.timestamp,
          status: 'uploading' as const,
          progress: 0,
          mediaType: item.mediaType
        };
        this.history.push(historyItem);
        await this.saveHistory();
      }

      const formData = new FormData();
      formData.append('userPass', settings.userId);
      formData.append('mediaType', item.mediaType.toString());
      formData.append('recipients', JSON.stringify(item.recipientIds));
      formData.append('timestamp', item.timestamp.toString());
      
      if (item.textOverlays && item.textOverlays.length > 0) {
        formData.append('textOverlays', JSON.stringify(item.textOverlays));
      }
      
      const mediaValue: FormDataValue = {
        uri: item.mediaUri,
        type: item.mediaType === 'image' ? 'image/jpeg' : 'video/mp4',
        name: `media_${Date.now()}.${item.mediaType === 'image' ? 'jpg' : 'mp4'}`
      };
      formData.append('media', mediaValue as any);

      // Ensure the API endpoint has the correct path
      const baseUrl = settings.apiEndpoint.replace(/\/+$/, '');
      const urlWithProtocol = baseUrl.startsWith('http://') || baseUrl.startsWith('https://') 
        ? baseUrl 
        : `http://${baseUrl}`;
      const uploadEndpoint = `${urlWithProtocol}/_api/v1/upload`;

      console.log('Attempting upload to:', uploadEndpoint);
      console.log('Request payload:', {
        userId: settings.userId,
        mediaType: item.mediaType,
        mediaName: mediaValue.name,
        recipients: item.recipientIds,
        timestamp: item.timestamp
      });

      // Use XMLHttpRequest for progress tracking
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        // Configure XMLHttpRequest to use smaller chunks
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            console.log('Upload progress:', progress);
            
            // Update history item progress
            const historyIndex = this.history.findIndex(h => h.id === item.id);
            if (historyIndex !== -1) {
              this.history[historyIndex] = {
                ...this.history[historyIndex],
                progress
              };
              this.saveHistory().catch(error => {
                console.error('Error saving history progress:', error);
              });
            }
          }
        };

        xhr.addEventListener('load', async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const result = JSON.parse(xhr.responseText);
              console.log('Upload successful:', result);
              
              // Update history item to completed
              const historyIndex = this.history.findIndex(h => h.id === item.id);
              if (historyIndex !== -1) {
                this.history[historyIndex] = {
                  ...this.history[historyIndex],
                  status: 'completed',
                  progress: 100
                };
                await this.saveHistory();
              }

              // Remove from queue and save queue state
              this.queue = this.queue.filter(q => q.id !== item.id);
              await this.saveQueue();
              resolve();
            } catch (error) {
              reject(new Error(`Failed to parse server response: ${error instanceof Error ? error.message : 'Unknown error'}`));
            }
          } 
          else if (xhr.status == 403) {
            // Update both queue and history items to failed
            await this.updateItemStatus(item.id, 'failed');
            const historyIndex = this.history.findIndex(h => h.id === item.id);
            if (historyIndex !== -1) {
              this.history[historyIndex] = {
                ...this.history[historyIndex],
                status: 'failed',
                error: "Invalid permissions"
              };
              await this.saveHistory();
            }
            reject(new Error(`Invalid permissions: ${xhr.status} - ${xhr.statusText}`));
          } else {
            const errorText = xhr.responseText;
            console.error('Server response:', {
              status: xhr.status,
              statusText: xhr.statusText,
              error: errorText
            });
            reject(new Error(`Server error: ${xhr.status} - ${errorText || xhr.statusText}`));
          }
        });

        xhr.addEventListener('error', (error) => {
          console.error('Upload error:', error);
          reject(error);
        });

        xhr.open('POST', uploadEndpoint);
        xhr.send(formData);
      });
    } catch (error) {
      console.error('Detailed upload error:', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        endpoint: (await settingsService.getSettings()).apiEndpoint,
        userId: (await settingsService.getSettings()).userId
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      // Update both queue and history items to failed
      await this.updateItemStatus(item.id, 'failed');
      const historyIndex = this.history.findIndex(h => h.id === item.id);
      if (historyIndex !== -1) {
        this.history[historyIndex] = {
          ...this.history[historyIndex],
          status: 'failed',
          error: errorMessage
        };
        await this.saveHistory();
      }
      
      throw error;
    }
  }

  private async updateItemStatus(id: string, status: UploadQueueItem['status']): Promise<void> {
    const item = this.queue.find(item => item.id === id);
    if (item) {
      item.status = status;
      await this.saveQueue();
    }
  }

  private async removeFromQueue(id: string): Promise<void> {
    this.queue = this.queue.filter(item => item.id !== id);
    await this.saveQueue();
  }

  private async saveQueue(): Promise<void> {
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
  }

  private async loadQueue(): Promise<void> {
    try {
      const savedQueue = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
      if (savedQueue) {
        this.queue = JSON.parse(savedQueue);
      }
    } catch (error) {
      console.error('Error loading queue:', error);
    }
  }

  private startNetworkMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    NetInfo.addEventListener((state: NetInfoState) => {
      if (state.isConnected) {
        this.processQueue();
      }
    });
  }

  stopNetworkMonitoring(): void {
    this.isMonitoring = false;
    NetInfo.addEventListener(() => {}); // Remove listener
  }

  async getUploadHistory(): Promise<UploadHistoryItem[]> {
    return this.history;
  }

  async clearHistory(): Promise<void> {
    this.history = [];
    await this.saveHistory();
  }

  async getPendingUploads(): Promise<UploadQueueItem[]> {
    return this.queue.filter(item => item.status === 'pending');
  }

  getCurrentUploadProgress(): number {
    return this.currentUploadProgress;
  }

  getServerAvailability(): boolean {
    return serverHealthService.getServerAvailability();
  }

  getServerLatency(): number {
    return serverHealthService.getServerLatency();
  }

  private async loadHistory(): Promise<void> {
    try {
      const savedHistory = await AsyncStorage.getItem(HISTORY_STORAGE_KEY);
      if (savedHistory) {
        this.history = JSON.parse(savedHistory);
        
        // Check for any partial uploads that aren't in the queue
        const queueIds = new Set(this.queue.map(item => item.id));
        this.history = this.history.map(item => {
          if ((item.status === 'uploading' || item.status === 'pending') && !queueIds.has(item.id)) {
            return {
              ...item,
              status: 'failed' as const,
              error: 'Upload was interrupted'
            };
          }
          return item;
        });
        
        // Save the updated history
        await this.saveHistory();
      }
    } catch (error) {
      console.error('Error loading history:', error);
    }
  }

  private async saveHistory(): Promise<void> {
    try {
      await AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(this.history));
    } catch (error) {
      console.error('Error saving history:', error);
    }
  }
}

export const uploadService = new UploadService(); 