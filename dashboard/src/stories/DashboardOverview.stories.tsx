import type { Meta, StoryObj } from '@storybook/react';
import { DashboardOverview } from '../components/DashboardOverview';

const meta = {
  title: 'Components/DashboardOverview',
  component: DashboardOverview,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof DashboardOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    uiConfig: {
      brandName: 'AnchorPoint',
      primaryColor: '#3b82f6',
      accentColor: '#14b8a6',
      supportEmail: 'support@anchorpoint.local',
      fieldRequirements: { deposit: [], withdraw: [], kyc: [] },
    },
  },
};

export const CustomBrand: Story = {
  args: {
    uiConfig: {
      brandName: 'StellarAnchor',
      primaryColor: '#8b5cf6',
      accentColor: '#ec4899',
      supportEmail: 'hello@stellaranchor.io',
      fieldRequirements: { deposit: [], withdraw: [], kyc: [] },
    },
  },
};

export const NoSupportEmail: Story = {
  args: {
    uiConfig: {
      brandName: 'AnchorPoint',
      primaryColor: '#3b82f6',
      accentColor: '#14b8a6',
      fieldRequirements: { deposit: [], withdraw: [], kyc: [] },
    },
  },
};
