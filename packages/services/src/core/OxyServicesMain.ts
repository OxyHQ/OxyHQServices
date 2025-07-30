import { OxyConfig } from '../models/interfaces';
import { AuthService } from './auth/AuthService';
import { UserService } from './users/UserService';
import { PaymentService } from './payments/PaymentService';
import { KarmaService } from './karma/KarmaService';
import { FileService, OXY_CLOUD_URL } from './files/FileService';
import { LocationService } from './locations/LocationService';
import { AnalyticsService } from './analytics/AnalyticsService';
import { DeviceService } from './devices/DeviceService';

/**
 * Main OxyServices class that combines all individual services
 * 
 * This class provides a unified interface to all Oxy API services while maintaining
 * backward compatibility with the original monolithic structure.
 */
export class OxyServicesMain extends AuthService {
  // Service instances
  public readonly users: UserService;
  public readonly payments: PaymentService;
  public readonly karma: KarmaService;
  public readonly files: FileService;
  public readonly locations: LocationService;
  public readonly analytics: AnalyticsService;
  public readonly devices: DeviceService;

  constructor(config: OxyConfig) {
    super(config);
    
    // Initialize all service instances
    this.users = new UserService(config);
    this.payments = new PaymentService(config);
    this.karma = new KarmaService(config);
    this.files = new FileService(config);
    this.locations = new LocationService(config);
    this.analytics = new AnalyticsService(config);
    this.devices = new DeviceService(config);
  }

  // Re-export OXY_CLOUD_URL for convenience
  static readonly OXY_CLOUD_URL = OXY_CLOUD_URL;

  // Additional utility methods that span multiple services
  async fetchLinkMetadata(url: string): Promise<{
    url: string;
    title: string;
    description: string;
    image?: string;
  }> {
    try {
      const res = await this.getClient().get(`/api/link-metadata?url=${encodeURIComponent(url)}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }
} 