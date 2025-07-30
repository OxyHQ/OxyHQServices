import { OxyServices } from '../OxyServices';
import {
  Wallet,
  Transaction,
  TransferFundsRequest,
  PurchaseRequest,
  WithdrawalRequest,
  TransactionResponse,
  PaymentMethod,
  PaymentRequest,
  PaymentResponse
} from '../../models/interfaces';

/**
 * Payment service for handling payments, wallet operations, and transactions
 */
export class PaymentService extends OxyServices {
  /**
   * Process payment
   */
  async processPayment(data: PaymentRequest): Promise<PaymentResponse> {
    try {
      const res = await this.getClient().post('/payments/process', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Validate payment method
   */
  async validatePaymentMethod(paymentMethod: any): Promise<{ valid: boolean }> {
    try {
      const res = await this.getClient().post('/payments/validate-method', paymentMethod);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get payment methods for user
   */
  async getPaymentMethods(userId: string): Promise<PaymentMethod[]> {
    try {
      const res = await this.getClient().get(`/api/payments/methods/${userId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user wallet
   */
  async getWallet(userId: string): Promise<Wallet> {
    try {
      const res = await this.getClient().get(`/api/wallet/${userId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(
    userId: string, 
    limit?: number, 
    offset?: number
  ): Promise<{ transactions: Transaction[]; total: number; hasMore: boolean }> {
    try {
      const params = new URLSearchParams();
      if (limit) params.append('limit', limit.toString());
      if (offset) params.append('offset', offset.toString());
      
      const res = await this.getClient().get(`/api/wallet/${userId}/transactions?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get specific transaction
   */
  async getTransaction(transactionId: string): Promise<Transaction> {
    try {
      const res = await this.getClient().get(`/api/transactions/${transactionId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Transfer funds between users
   */
  async transferFunds(data: TransferFundsRequest): Promise<TransactionResponse> {
    try {
      const res = await this.getClient().post('/wallet/transfer', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Process purchase
   */
  async processPurchase(data: PurchaseRequest): Promise<TransactionResponse> {
    try {
      const res = await this.getClient().post('/wallet/purchase', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Request withdrawal
   */
  async requestWithdrawal(data: WithdrawalRequest): Promise<TransactionResponse> {
    try {
      const res = await this.getClient().post('/wallet/withdraw', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }
} 