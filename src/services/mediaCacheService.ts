import * as FileSystem from 'expo-file-system';
import { Alert } from 'react-native';

const CACHE_DIR = `${FileSystem.cacheDirectory}MediaCache/`;
const CACHE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes in milliseconds

interface CacheEntry {
  uri: string;
  timestamp: number;
}

class MediaCacheService {
  private static instance: MediaCacheService;
  private cache: { [key: string]: CacheEntry } = {};

  private constructor() {
    this.initializeCache();
  }

  public static getInstance(): MediaCacheService {
    if (!MediaCacheService.instance) {
      MediaCacheService.instance = new MediaCacheService();
    }
    return MediaCacheService.instance;
  }

  private async initializeCache(): Promise<void> {
    try {
      // Create cache directory if it doesn't exist
      const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
      }

      // Load existing cache entries
      const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
      for (const file of files) {
        const filePath = `${CACHE_DIR}${file}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        if (fileInfo.exists) {
          const timestamp = parseInt(file.split('_')[0]);
          this.cache[file] = {
            uri: filePath,
            timestamp
          };
        }
      }

      // Clean up expired cache entries
      await this.cleanupExpiredCache();
    } catch (error) {
      console.error('Error initializing cache:', error);
    }
  }

  private async cleanupExpiredCache(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of Object.entries(this.cache)) {
      if (now - entry.timestamp > CACHE_EXPIRY_MS) {
        try {
          await FileSystem.deleteAsync(entry.uri);
          delete this.cache[key];
        } catch (error) {
          console.error(`Error deleting expired cache entry ${key}:`, error);
        }
      }
    }
  }

  public getCache(): { [key: string]: CacheEntry } {
    return this.cache;
  }

  public getCacheDir(): string {
    return CACHE_DIR;
  }

  public getCacheKey(url: string): string {
    return `${Date.now()}_${url.split('/').pop()}`;
  }

  public addToCache(key: string, uri: string): void {
    this.cache[key] = {
      uri,
      timestamp: Date.now()
    };
  }

  public async getMedia(url: string): Promise<string | null> {
    try {
      // Clean up expired cache entries
      await this.cleanupExpiredCache();

      // Check if we have a cached version
      const cachedEntry = Object.values(this.cache).find(entry => 
        entry.uri.includes(url.split('/').pop()!)
      );

      if (cachedEntry) {
        const fileInfo = await FileSystem.getInfoAsync(cachedEntry.uri);
        if (fileInfo.exists) {
          // Check if cache is expired
          if (Date.now() - cachedEntry.timestamp > CACHE_EXPIRY_MS) {
            await FileSystem.deleteAsync(cachedEntry.uri);
            delete this.cache[Object.keys(this.cache).find(key => 
              this.cache[key].uri === cachedEntry.uri
            )!];
          } else {
            return cachedEntry.uri;
          }
        }
      }

      // If no valid cache, download the file
      const cacheKey = this.getCacheKey(url);
      const destination = `${CACHE_DIR}${cacheKey}`;

      try {
        const downloadResumable = FileSystem.createDownloadResumable(
          url,
          destination
        );

        const result = await downloadResumable.downloadAsync();
        if (result?.uri) {
          this.cache[cacheKey] = {
            uri: result.uri,
            timestamp: Date.now()
          };
          return result.uri;
        }
      } catch (error) {
        // If we get a 404 and no cache exists, show error
        if (error instanceof Error && error.message.includes('404') && !cachedEntry) {
          Alert.alert('Error', 'The media has been deleted from the server.');
        }
        console.error('Error downloading media:', error);
      }

      return null;
    } catch (error) {
      console.error('Error in getMedia:', error);
      return null;
    }
  }

  public async clearCache(): Promise<void> {
    try {
      await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
      this.cache = {};
      await this.initializeCache();
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }
}

export const mediaCacheService = MediaCacheService.getInstance(); 