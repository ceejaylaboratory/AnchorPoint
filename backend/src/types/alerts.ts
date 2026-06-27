export interface AlertPayload {
  walletLabel: string;
  publicKey: string;
  assetCode: string;
  currentBalance: number;
  thresholdAmount: number;
  checkedAt: string;
}
