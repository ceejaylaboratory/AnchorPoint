import type { Meta, StoryObj } from '@storybook/react';
import { LogoMark } from '../components/LogoMark';

const meta = {
  title: 'Components/LogoMark',
  component: LogoMark,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    uiConfig: { control: 'object' },
  },
} satisfies Meta<typeof LogoMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    uiConfig: {
      brandName: 'AnchorPoint',
      primaryColor: '#3b82f6',
      accentColor: '#14b8a6',
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
      fieldRequirements: { deposit: [], withdraw: [], kyc: [] },
    },
  },
};

export const WithLogoUrl: Story = {
  args: {
    uiConfig: {
      brandName: 'AnchorPoint',
      logoUrl: 'https://via.placeholder.com/40',
      primaryColor: '#3b82f6',
      accentColor: '#14b8a6',
      fieldRequirements: { deposit: [], withdraw: [], kyc: [] },
    },
  },
};
