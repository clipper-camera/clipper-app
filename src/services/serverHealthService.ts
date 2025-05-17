import { settingsService } from './settingsService';

class ServerHealthService {
  private isServerAvailable: boolean = true;
  private serverLatency: number = 0;

  constructor() {
    // Initial check
    this.checkServerHealth();
  }

  async checkServerHealth(): Promise<boolean> {
    try {
      const settings = await settingsService.getSettings();
      if (!settings.apiEndpoint) {
        this.isServerAvailable = false;
        this.serverLatency = 0;
        return false;
      }

      const baseUrl = settings.apiEndpoint.replace(/\/+$/, '');
      const healthEndpoint = `${baseUrl}/_api/v1/health`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      // Start timing
      const startTime = performance.now();

      const response = await fetch(healthEndpoint, {
        method: 'GET',
        signal: controller.signal
      });

      // Calculate latency
      const endTime = performance.now();
      this.serverLatency = Math.round(endTime - startTime);

      clearTimeout(timeoutId);

      if (response.ok) {
        try {
          const data = await response.json();
          this.isServerAvailable = data.status === 'ok';
          return this.isServerAvailable;
        } catch (error) {
          console.error('Error parsing health check response:', error);
          this.isServerAvailable = false;
          return false;
        }
      } else {
        this.isServerAvailable = false;
        return false;
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.debug('Server health check request aborted due to timeout');
      } else {
        console.error('Error checking server health:', error);
      }
      this.isServerAvailable = false;
      this.serverLatency = 0;
      return false;
    }
  }

  getServerAvailability(): boolean {
    return this.isServerAvailable;
  }

  getServerLatency(): number {
    return this.serverLatency;
  }
}

export const serverHealthService = new ServerHealthService(); 