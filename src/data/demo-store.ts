import { isDay, summarizeTrips, TIME_ZONE, tripDay, validateTrip, ValidationError } from '../../server/domain.js';
import type { CreateTripResponse, DailyResponse, Trip } from '../../shared/types.js';
import { ApiError } from '../lib.js';

export const DEMO_STORAGE_KEY = 'smena.demo.trips.v1';
export const DEMO_LOCK_NAME = `${DEMO_STORAGE_KEY}.write`;

export interface DemoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DemoLockManager {
  request<T>(name: string, task: () => T | Promise<T>): Promise<T>;
}

export interface DemoStoreOptions {
  seedTrips: readonly unknown[];
  storage: () => DemoStorage;
  locks?: DemoLockManager;
}

export interface DemoStore {
  getDay(date: string, signal?: AbortSignal): Promise<DailyResponse>;
  createTrip(input: unknown): Promise<CreateTripResponse>;
}

function storageError(operation: 'read' | 'write', cause: unknown): ApiError {
  const name = cause && typeof cause === 'object' && 'name' in cause ? cause.name : '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return new ApiError('В этом браузере закончилось место для демо. Освободите место в данных сайта и повторите сохранение.');
  }
  return new ApiError(operation === 'read'
    ? 'Не удалось прочитать данные демо. Разрешите хранение данных сайта в браузере и попробуйте ещё раз.'
    : 'Не удалось сохранить поездку в этом браузере. Разрешите хранение данных сайта и попробуйте ещё раз.');
}

function corruptData(): ApiError {
  return new ApiError('Данные демо в этом браузере повреждены или имеют неподдерживаемую версию. Очистите данные этого сайта и откройте демо снова.');
}

function sameTrip(first: Trip, second: Trip): boolean {
  return first.id === second.id && first.start === second.start && first.end === second.end &&
    first.amount === second.amount && first.payment === second.payment && first.commission === second.commission;
}

/** Browser-only persistence. It never pretends to be the shared server API. */
export function createDemoStore({ seedTrips, storage, locks }: DemoStoreOptions): DemoStore {
  const seed = seedTrips.map(validateTrip);
  let writeQueue: Promise<unknown> = Promise.resolve();

  function readTrips(): Trip[] {
    let raw: string | null;
    try {
      raw = storage().getItem(DEMO_STORAGE_KEY);
    } catch (cause) {
      throw storageError('read', cause);
    }
    if (raw === null) return seed.map(trip => ({ ...trip }));
    try {
      const snapshot: unknown = JSON.parse(raw);
      if (!snapshot || typeof snapshot !== 'object' || !('version' in snapshot) || snapshot.version !== 1 ||
        !('trips' in snapshot) || !Array.isArray(snapshot.trips)) throw corruptData();
      const trips = snapshot.trips.map(validateTrip);
      if (new Set(trips.map(trip => trip.id)).size !== trips.length) throw corruptData();
      return trips;
    } catch {
      // Preserve the original value: a broken snapshot must not be silently overwritten.
      throw corruptData();
    }
  }

  function writeTrips(trips: readonly Trip[]): void {
    try {
      storage().setItem(DEMO_STORAGE_KEY, JSON.stringify({ version: 1, trips }));
    } catch (cause) {
      throw storageError('write', cause);
    }
  }

  function serialize<T>(task: () => T): Promise<T> {
    // The queue also covers browsers without Web Locks. Web Locks coordinate
    // read-modify-write operations with other tabs on the same origin.
    const operation = writeQueue.then(() => locks ? locks.request(DEMO_LOCK_NAME, task) : task());
    writeQueue = operation.catch(() => undefined);
    return operation;
  }

  return {
    async getDay(date, signal) {
      signal?.throwIfAborted();
      if (!isDay(date)) throw new ApiError('Укажите корректный день в формате ГГГГ-ММ-ДД.', { date: 'Некорректная дата.' });
      const trips = readTrips().filter(trip => tripDay(trip.start) === date)
        .sort((first, second) => first.start.localeCompare(second.start) || first.id.localeCompare(second.id));
      signal?.throwIfAborted();
      return { date, timeZone: TIME_ZONE, trips, summary: summarizeTrips(trips) };
    },

    async createTrip(input) {
      let trip: Trip;
      try {
        trip = validateTrip(input);
      } catch (cause) {
        if (cause instanceof ValidationError) throw new ApiError(cause.message, cause.fields);
        throw cause;
      }
      try {
        return await serialize(() => {
          const trips = readTrips();
          const existing = trips.find(candidate => candidate.id === trip.id);
          if (existing) {
            if (!sameTrip(existing, trip)) {
              throw new ApiError('Поездка с этим идентификатором уже сохранена с другими данными.', { id: 'Идентификатор уже занят другой поездкой.' });
            }
            return { trip: existing, created: false };
          }
          writeTrips([...trips, trip]);
          return { trip, created: true };
        });
      } catch (cause) {
        if (cause instanceof ApiError) throw cause;
        throw storageError('write', cause);
      }
    },
  };
}
