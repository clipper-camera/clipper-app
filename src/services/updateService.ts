import { Platform, Alert, Linking, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Notifications from 'expo-notifications';
import Toast from 'react-native-toast-message';

const GITHUB_REPO = 'clipper-camera/clipper-app';
const GITHUB_API_BASE = 'https://api.github.com';
const LAST_CHECK_KEY = '@last_update_check';
const IGNORED_VERSION_KEY = '@ignored_version';

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  changelog: string;
  downloadUrl?: string;
  releaseDate: string;
}

class UpdateService {
  private currentVersion: string;

  constructor() {
    // Get current version from package.json or app config
    this.currentVersion = '0.0.2'; // This should match your package.json version
  }

  /**
   * Check for updates by querying GitHub releases
   */
  async checkForUpdates(ignoreIgnoredVersions: boolean = false): Promise<UpdateInfo> {
    try {
      const releases = await this.fetchReleases();
      const latestRelease = releases[0]; // GitHub returns releases in descending order
      
      if (!latestRelease) {
        return {
          hasUpdate: false,
          latestVersion: this.currentVersion,
          currentVersion: this.currentVersion,
          changelog: '',
          releaseDate: ''
        };
      }

      const hasUpdate = this.compareVersions(latestRelease.tag_name, this.currentVersion) > 0;
      
      // Only check ignored versions if not bypassing (for manual checks)
      let isIgnored = false;
      if (!ignoreIgnoredVersions) {
        const ignoredVersion = await this.getIgnoredVersion();
        isIgnored = ignoredVersion === latestRelease.tag_name;
      }

      const downloadUrl = this.getPlatformDownloadUrl(latestRelease);

      return {
        hasUpdate: hasUpdate && !isIgnored,
        latestVersion: latestRelease.tag_name,
        currentVersion: this.currentVersion,
        changelog: latestRelease.body,
        downloadUrl,
        releaseDate: latestRelease.published_at
      };
    } catch (error) {
      console.error('Error checking for updates:', error);
      throw new Error('Failed to check for updates');
    }
  }

  /**
   * Fetch releases from GitHub API
   */
  private async fetchReleases(): Promise<GitHubRelease[]> {
    const url = `${GITHUB_API_BASE}/repos/${GITHUB_REPO}/releases`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ClipperApp/1.0.0'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Compare two version strings
   * Returns: 1 if version1 > version2, -1 if version1 < version2, 0 if equal
   */
  private compareVersions(version1: string, version2: string): number {
    // Remove 'v' prefix if present
    const v1 = version1.replace(/^v/, '');
    const v2 = version2.replace(/^v/, '');
    
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    const maxLength = Math.max(parts1.length, parts2.length);
    
    for (let i = 0; i < maxLength; i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;
      
      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }
    
    return 0;
  }

  /**
   * Get platform-specific download URL
   */
  private getPlatformDownloadUrl(release: GitHubRelease): string | undefined {
    const platform = Platform.OS;
    
    // Look for platform-specific assets
    const platformAsset = release.assets.find(asset => {
      const name = asset.name.toLowerCase();
      if (platform === 'android') {
        return name.includes('.apk') || name.includes('android');
      } else if (platform === 'ios') {
        return name.includes('.ipa') || name.includes('ios');
      }
      return false;
    });

    return platformAsset?.browser_download_url;
  }

  /**
   * Show update notification with changelog
   */
  async showUpdateNotification(updateInfo: UpdateInfo): Promise<void> {
    const { latestVersion, changelog, downloadUrl } = updateInfo;
    
    if (!downloadUrl) {
      Alert.alert(
        'Update Available',
        `Version ${latestVersion} is available, but no download link was found for your platform.`,
        [
          { text: 'Later', style: 'cancel' },
          { 
            text: 'Ignore This Version', 
            onPress: () => this.ignoreVersion(latestVersion)
          }
        ]
      );
      return;
    }

    Alert.alert(
      `Version ${latestVersion} Available`,
      `${changelog}\n`,
      [
        { text: 'Later', style: 'cancel' },
        { 
          text: 'Ignore This Version', 
          onPress: () => this.ignoreVersion(latestVersion)
        },
        { 
          text: 'Website', 
          onPress: () => this.openGitHubReleases()
        }
      ]
    );
  }

  /**
   * Open GitHub releases page
   */
  private async openGitHubReleases(): Promise<void> {
    try {
      const githubUrl = 'https://github.com/clipper-camera/clipper-app/releases';
      const canOpen = await Linking.canOpenURL(githubUrl);
      
      if (canOpen) {
        await Linking.openURL(githubUrl);
      } else {
        Alert.alert(
          'Cannot Open Link',
          'Unable to open the GitHub releases page. Please check your internet connection.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Error opening GitHub releases:', error);
      Alert.alert(
        'Error',
        'Unable to open the GitHub releases page.',
        [{ text: 'OK' }]
      );
    }
  }

  /**
   * Show a simple toast message
   */
  private showToast(message: string, type: 'success' | 'info' | 'error' = 'info'): void {
    Toast.show({
      type: type,
      text1: message,
      position: 'bottom',
      visibilityTime: 3000,
    });
  }

  /**
   * Show notification with APK installation intent
   */
  private async showAPKInstallNotification(apkUri: string, version: string): Promise<void> {
    try {
      console.log('Showing APK installation notification');
      
      // Schedule notification with APK installation intent
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Update Ready',
          body: `Version ${version} is ready to install. Tap to install.`,
          data: { 
            apkUri: apkUri,
            version: version,
            type: 'apk_install'
          },
          categoryIdentifier: 'APK_INSTALL',
        },
        trigger: null, // Show immediately
      });
      
      // Show toast when notification is shown
      this.showToast(`Version ${version} ready! Tap notification to install.`, 'success');
    } catch (error) {
      console.error('Error showing APK notification:', error);
      throw error;
    }
  }

  /**
   * Ignore a specific version
   */
  private async ignoreVersion(version: string): Promise<void> {
    try {
      await AsyncStorage.setItem(IGNORED_VERSION_KEY, version);
    } catch (error) {
      console.error('Error ignoring version:', error);
    }
  }

  /**
   * Get the currently ignored version
   */
  private async getIgnoredVersion(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(IGNORED_VERSION_KEY);
    } catch (error) {
      console.error('Error getting ignored version:', error);
      return null;
    }
  }

  /**
   * Clear ignored version (useful for testing or if user wants to see ignored updates again)
   */
  async clearIgnoredVersion(): Promise<void> {
    try {
      await AsyncStorage.removeItem(IGNORED_VERSION_KEY);
    } catch (error) {
      console.error('Error clearing ignored version:', error);
    }
  }

  /**
   * Set the last check time
   */
  async setLastCheckTime(): Promise<void> {
    try {
      await AsyncStorage.setItem(LAST_CHECK_KEY, Date.now().toString());
    } catch (error) {
      console.error('Error setting last check time:', error);
    }
  }

  /**
   * Get the last check time
   */
  async getLastCheckTime(): Promise<number | null> {
    try {
      const time = await AsyncStorage.getItem(LAST_CHECK_KEY);
      return time ? parseInt(time, 10) : null;
    } catch (error) {
      console.error('Error getting last check time:', error);
      return null;
    }
  }

  /**
   * Check if enough time has passed since last check (to avoid too frequent checks)
   */
  async shouldCheckForUpdates(checkIntervalHours: number = 24): Promise<boolean> {
    const lastCheck = await this.getLastCheckTime();
    
    // On first launch, don't check for updates immediately
    if (!lastCheck) {
      console.log('First app launch - setting initial check time, will check for updates in 24 hours');
      await this.setLastCheckTime();
      return false;
    }
    
    const now = Date.now();
    const hoursSinceLastCheck = (now - lastCheck) / (1000 * 60 * 60);
    
    console.log(`Hours since last update check: ${hoursSinceLastCheck.toFixed(1)}`);
    return hoursSinceLastCheck >= checkIntervalHours;
  }

  /**
   * Get current app version
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }

}

export const updateService = new UpdateService();
