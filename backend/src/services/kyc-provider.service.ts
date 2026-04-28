/**
 * Interface representing standard KYC status
 */
export enum KycStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED'
}

/**
 * Interface for KYC provider responses
 */
export interface KycProviderResponse {
  success: boolean;
  providerId?: string; // External ID from the KYC provider
  status: KycStatus;
  message?: string;
}

/**
 * Interface for third-party KYC providers
 */
export interface IKycProvider {
  /**
   * Submit customer info and documents to the KYC provider
   */
  submitCustomer(data: any, documents: any): Promise<KycProviderResponse>;
  
  /**
   * Verify webhook signatures
   */
  verifyWebhookSignature(payload: string, signature: string): boolean;
}

/**
 * Mock KYC Provider for Development and Testing
 * Simulates a third-party service like Sumsub or Onfido
 */
export class MockKycProvider implements IKycProvider {
  async submitCustomer(data: any, documents: any): Promise<KycProviderResponse> {
    console.log(`[Mock KYC] Submitting customer data...`);
    
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Simple mock logic: if email contains 'reject', simulate a rejection
    if (data.email && data.email.includes('reject')) {
      return {
        success: true,
        providerId: `mock_${Date.now()}`,
        status: KycStatus.REJECTED,
        message: 'Customer rejected by risk policy.'
      };
    }

    // Otherwise, simulate a pending review that would be resolved via webhook
    return {
      success: true,
      providerId: `mock_${Date.now()}`,
      status: KycStatus.PENDING,
      message: 'Customer submitted successfully. Pending review.'
    };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    // In production, you would compute HMAC of the payload using a secret from the provider
    // and compare it to the signature header.
    console.log(`[Mock KYC] Verifying webhook signature...`);
    return signature === 'mock-valid-signature';
  }
}

// Export singleton instance of the chosen provider
export const kycProvider = new MockKycProvider();
