import type { Meta, StoryObj } from '@storybook/react';
import { NotificationBell } from '../components/NotificationBell';

const meta = {
  title: 'Components/NotificationBell',
  component: NotificationBell,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof NotificationBell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    apiBaseUrl: 'http://localhost:3002',
  },
};

export const WithCallback: Story = {
  args: {
    apiBaseUrl: 'http://localhost:3002',
    onViewAll: () => alert('View all notifications clicked'),
  },
};
