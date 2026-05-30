import type { Meta, StoryObj } from '@storybook/react';
import NotificationCenter from '../components/NotificationCenter';

const meta = {
  title: 'Components/NotificationCenter',
  component: NotificationCenter,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof NotificationCenter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    apiBaseUrl: 'http://localhost:3002',
  },
};

export const WithPreferencesCallback: Story = {
  args: {
    apiBaseUrl: 'http://localhost:3002',
    onOpenPreferences: () => alert('Open preferences clicked'),
  },
};
