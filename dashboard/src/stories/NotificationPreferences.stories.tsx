import type { Meta, StoryObj } from '@storybook/react';
import NotificationPreferences from '../components/NotificationPreferences';

const meta = {
  title: 'Components/NotificationPreferences',
  component: NotificationPreferences,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof NotificationPreferences>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    apiBaseUrl: 'http://localhost:3002',
  },
};
