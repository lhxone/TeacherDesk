import { api } from './client';
import type { Envelope } from './types';

export type DeviceSubscription = {
  id: string;
  label: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

export type DeviceSession = {
  id: string;
  deviceInfo: string | null;
  createdAt: string;
  expiresAt: string;
};

export type DeviceList = {
  pushEnabled: boolean;
  subscriptions: DeviceSubscription[];
  sessions: DeviceSession[];
};

export function listDevices(): Promise<DeviceList> {
  return api.get<Envelope<DeviceList>>('/devices').then((r) => r.data);
}

export function revokeSubscription(id: string): Promise<void> {
  return api.del(`/devices/subscriptions/${id}`).then(() => undefined);
}

export function revokeSession(id: string): Promise<void> {
  return api.del(`/devices/sessions/${id}`).then(() => undefined);
}
