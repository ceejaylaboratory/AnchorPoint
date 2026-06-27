import type { Meta, StoryObj } from '@storybook/react';
import { SEP24Flow } from '../components/SEP24Flow';

const defaultUiConfig = {
  brandName: 'AnchorPoint',
  primaryColor: '#3b82f6',
  accentColor: '#14b8a6',
  supportEmail: 'support@anchorpoint.local',
  fieldRequirements: {
    deposit: [
      { key: 'walletAddress', label: 'Wallet Address', required: true, placeholder: 'G...' },
      { key: 'amount', label: 'Amount', required: true, placeholder: '500.00' },
    ],
    withdraw: [
      { key: 'bankAccount', label: 'Bank Account', required: true, placeholder: 'Account number' },
      { key: 'amount', label: 'Amount', required: true, placeholder: '120.50' },
    ],
    kyc: [
      { key: 'firstName', label: 'First Name', required: true },
      { key: 'lastName', label: 'Last Name', required: true },
      { key: 'country', label: 'Country', required: true },
    ],
  },
};

const meta = {
  title: 'Components/SEP24Flow',
  component: SEP24Flow,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof SEP24Flow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DepositFlow: Story = {
  args: {
    type: 'deposit',
    uiConfig: defaultUiConfig,
  },
};

export const WithdrawalFlow: Story = {
  args: {
    type: 'withdraw',
    uiConfig: defaultUiConfig,
  },
};

export const CustomBrandDeposit: Story = {
  args: {
    type: 'deposit',
    uiConfig: {
      ...defaultUiConfig,
      brandName: 'StellarAnchor',
      primaryColor: '#8b5cf6',
      accentColor: '#ec4899',
    },
  },
};
