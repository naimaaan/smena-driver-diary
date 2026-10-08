import seedTrips from '../../data/trips.json';
import type { CreateTripResponse, DailyResponse } from '../../shared/types.js';
import { readResponse } from '../lib.js';
import { createDemoStore } from './demo-store.js';

export const DEMO_MODE = import.meta.env.MODE === 'demo';

const demoStore = DEMO_MODE ? createDemoStore({
  seedTrips,
  storage: () => window.localStorage,
  locks: navigator.locks,
}) : null;

export async function getDay(date: string, signal?: AbortSignal): Promise<DailyResponse> {
  if (demoStore) return demoStore.getDay(date, signal);
  const response = await fetch(`/api/days/${date}`, { signal });
  return readResponse<DailyResponse>(response);
}

export async function createTrip(input: unknown): Promise<CreateTripResponse> {
  if (demoStore) return demoStore.createTrip(input);
  const response = await fetch('/api/trips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readResponse<CreateTripResponse>(response);
}
