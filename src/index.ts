import axios, { AxiosInstance } from 'axios';
import jwtDecode from 'jwt-decode';

export interface OxyConfig {
  /** Base URL of the Oxy API, e.g. https://api.mention.earth or http://localhost:3001 */
  baseURL: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface Notification {
  id: string;
  recipientId: string;
  actorId: string;
  type: string;
  entityId: string;
  entityType: string;
  read: boolean;
  createdAt: string;
  updatedAt: string;
}

export class OxyServices {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor(config: OxyConfig) {
    this.client = axios.create({ baseURL: config.baseURL });
    // Attach auth header if token is set
    this.client.interceptors.request.use((req) => {
      if (this.accessToken) {
        req.headers = req.headers || {};
        req.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return req;
    });
  }

  /** Sign up a new user */
  async signUp(username: string, email: string, password: string): Promise<{ message: string; token: string; user: User }> {
    const res = await this.client.post('/auth/signup', { username, email, password });
    const { message, token, user } = res.data;
    this.accessToken = token;
    return { message, token, user };
  }

  /** Log in and store tokens */
  async login(username: string, password: string): Promise<LoginResponse> {
    const res = await this.client.post('/auth/login', { username, password });
    const { accessToken, refreshToken, user } = res.data;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    return { accessToken, refreshToken, user };
  }

  /** Log out user */
  async logout(): Promise<void> {
    if (!this.refreshToken) return;
    await this.client.post('/auth/logout', { refreshToken: this.refreshToken });
    this.accessToken = null;
    this.refreshToken = null;
  }

  /** Refresh access and refresh tokens */
  async refreshTokens(): Promise<{ accessToken: string; refreshToken: string }> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }
    const res = await this.client.post('/auth/refresh', { refreshToken: this.refreshToken });
    const { accessToken, refreshToken } = res.data;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    return { accessToken, refreshToken };
  }

  /** Validate current access token */
  async validate(): Promise<boolean> {
    const res = await this.client.get('/auth/validate');
    return res.data.valid;
  }

  /** Fetch profile by username */
  async getProfileByUsername(username: string): Promise<any> {
    const res = await this.client.get(`/profiles/username/${username}`);
    return res.data;
  }

  /** Search profiles */
  async searchProfiles(query: string, limit?: number, offset?: number): Promise<any[]> {
    const params: any = { query };
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    const res = await this.client.get('/profiles/search', { params });
    return res.data;
  }

  /** Get general user by ID */
  async getUserById(userId: string): Promise<any> {
    const res = await this.client.get(`/users/${userId}`);
    return res.data;
  }

  /** Update user profile (requires auth) */
  async updateUser(userId: string, updates: Record<string, any>): Promise<any> {
    const res = await this.client.put(`/users/${userId}`, updates);
    return res.data;
  }

  /** Follow a user */
  async followUser(userId: string): Promise<any> {
    const res = await this.client.post(`/users/${userId}/follow`);
    return res.data;
  }

  /** Unfollow a user */
  async unfollowUser(userId: string): Promise<any> {
    const res = await this.client.delete(`/users/${userId}/follow`);
    return res.data;
  }

  /** Fetch all notifications for the authenticated user */
  async getNotifications(): Promise<Notification[]> {
    const res = await this.client.get('/notifications');
    return res.data;
  }

  /** Get count of unread notifications */
  async getUnreadCount(): Promise<number> {
    const res = await this.client.get('/notifications/unread-count');
    return res.data;
  }

  /** Create a new notification (admin use) */
  async createNotification(data: Partial<Notification>): Promise<Notification> {
    const res = await this.client.post('/notifications', data);
    return res.data;
  }

  /** Mark a single notification as read */
  async markNotificationAsRead(notificationId: string): Promise<void> {
    await this.client.put(`/notifications/${notificationId}/read`);
  }

  /** Mark all notifications as read */
  async markAllNotificationsAsRead(): Promise<void> {
    await this.client.put('/notifications/read-all');
  }

  /** Delete a notification */
  async deleteNotification(notificationId: string): Promise<void> {
    await this.client.delete(`/notifications/${notificationId}`);
  }

  /** Process a payment */
  async processPayment(data: { userId: string; plan: string; paymentMethod: any; platform: string }): Promise<{ success: boolean; transactionId: string }> {
    const res = await this.client.post('/payments/process', data);
    return res.data;
  }

  /** Validate a payment method */
  async validatePaymentMethod(paymentMethod: any): Promise<{ valid: boolean }> {
    const res = await this.client.post('/payments/validate', { paymentMethod });
    return res.data;
  }

  /** Get saved payment methods for a user */
  async getPaymentMethods(userId: string): Promise<any> {
    const res = await this.client.get(`/payments/methods/${userId}`);
    return res.data;
  }

  /** Get analytics data */
  async getAnalytics(userId: string, period?: string): Promise<any> {
    const params: any = { userID: userId };
    if (period) params.period = period;
    const res = await this.client.get('/analytics', { params });
    return res.data;
  }

  /** Update analytics (internal use) */
  async updateAnalytics(userId: string, type: string, data: Record<string, any>): Promise<{ message: string }> {
    const res = await this.client.post('/analytics/update', { userID: userId, type, data });
    return res.data;
  }

  /** Get content viewers analytics */
  async getContentViewers(userId: string, period?: string): Promise<any[]> {
    const params: any = { userID: userId };
    if (period) params.period = period;
    const res = await this.client.get('/analytics/viewers', { params });
    return res.data;
  }

  /** Get follower analytics details */
  async getFollowerDetails(userId: string, period?: string): Promise<any> {
    const params: any = { userID: userId };
    if (period) params.period = period;
    const res = await this.client.get('/analytics/followers', { params });
    return res.data;
  }

  /** Get wallet info */
  async getWallet(userId: string): Promise<any> {
    const res = await this.client.get(`/wallet/${userId}`);
    return res.data;
  }

  /** Get transaction history */
  async getTransactionHistory(userId: string, limit?: number, offset?: number): Promise<any> {
    const params: any = {};
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    const res = await this.client.get(`/wallet/transactions/${userId}`, { params });
    return res.data;
  }

  /** Get a specific transaction */
  async getTransaction(transactionId: string): Promise<any> {
    const res = await this.client.get(`/wallet/transaction/${transactionId}`);
    return res.data;
  }

  /** Transfer funds */
  async transferFunds(data: { fromUserId: string; toUserId: string; amount: number; description?: string }): Promise<any> {
    const res = await this.client.post('/wallet/transfer', data);
    return res.data;
  }

  /** Process a purchase */
  async processPurchase(data: { userId: string; amount: number; itemId: string; itemType: string; description?: string }): Promise<any> {
    const res = await this.client.post('/wallet/purchase', data);
    return res.data;
  }

  /** Request a withdrawal */
  async requestWithdrawal(data: { userId: string; amount: number; address: string }): Promise<any> {
    const res = await this.client.post('/wallet/withdraw', data);
    return res.data;
  }

  /** Karma: get leaderboard */
  async getKarmaLeaderboard(): Promise<any[]> {
    const res = await this.client.get('/karma/leaderboard');
    return res.data;
  }

  /** Karma: get rules */
  async getKarmaRules(): Promise<any[]> {
    const res = await this.client.get('/karma/rules');
    return res.data;
  }

  /** Karma: get total for a user */
  async getUserKarmaTotal(userId: string): Promise<{ total: number }> {
    const res = await this.client.get(`/karma/${userId}/total`);
    return res.data;
  }

  /** Karma: get history for a user */
  async getUserKarmaHistory(userId: string, limit?: number, offset?: number): Promise<any> {
    const params: any = {};
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    const res = await this.client.get(`/karma/${userId}/history`, { params });
    return res.data;
  }

  /** Karma: award points */
  async awardKarma(data: { userId: string; points: number; reason?: string }): Promise<any> {
    const res = await this.client.post('/karma/award', data);
    return res.data;
  }

  /** Karma: deduct points */
  async deductKarma(data: { userId: string; points: number; reason?: string }): Promise<any> {
    const res = await this.client.post('/karma/deduct', data);
    return res.data;
  }

  /** Karma: create or update rule (admin) */
  async createOrUpdateKarmaRule(data: any): Promise<any> {
    const res = await this.client.post('/karma/rules', data);
    return res.data;
  }
}

export default OxyServices;