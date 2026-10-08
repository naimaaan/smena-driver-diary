import type { CreateTripResponse, Trip } from '../shared/types.js';

/** SQLite is synchronous; remote repositories can return promises. */
export interface TripRepository {
  list(day: string): Trip[] | Promise<Trip[]>;
  add(trip: Trip): CreateTripResponse | Promise<CreateTripResponse>;
  close(): void | Promise<void>;
}

export class TripConflictError extends Error {
  constructor() { super('Поездка с таким идентификатором уже существует с другими данными.'); }
}

/** Callers validate timestamps into canonical UTC before storing a trip. */
export function sameTrip(left: Trip, right: Trip): boolean {
  return left.id === right.id && left.start === right.start && left.end === right.end &&
    left.amount === right.amount && left.payment === right.payment && left.commission === right.commission;
}
