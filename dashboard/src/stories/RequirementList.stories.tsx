import type { Meta, StoryObj } from '@storybook/react';
import { RequirementList } from '../components/RequirementList';

const meta = {
  title: 'Components/RequirementList',
  component: RequirementList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof RequirementList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DepositFields: Story = {
  args: {
    title: 'Deposit Requirements',
    fields: [
      { key: 'walletAddress', label: 'Wallet Address', required: true, placeholder: 'G...' },
      { key: 'amount', label: 'Amount', required: true, placeholder: '500.00' },
    ],
  },
};

export const WithdrawalFields: Story = {
  args: {
    title: 'Withdrawal Requirements',
    fields: [
      { key: 'bankAccount', label: 'Bank Account', required: true, placeholder: 'Account number' },
      { key: 'amount', label: 'Amount', required: true, placeholder: '120.50' },
    ],
  },
};

export const KYCFields: Story = {
  args: {
    title: 'KYC Requirements',
    fields: [
      { key: 'firstName', label: 'First Name', required: true },
      { key: 'lastName', label: 'Last Name', required: true },
      { key: 'country', label: 'Country', required: true },
      {
        key: 'taxId',
        label: 'Tax ID',
        required: false,
        helpText: 'Required for transactions over $10,000',
      },
    ],
  },
};

export const Empty: Story = {
  args: {
    title: 'No Fields Configured',
    fields: [],
  },
};
