import type { DailySummary, Trip } from '../shared/types.js';

export const TIME_ZONE = 'Asia/Qyzylorda' as const;
const LOCAL_OFFSET_MS = 5 * 60 * 60 * 1_000;
const MAX_AMOUNT = 1_000_000_000;

export class ValidationError extends Error {
  constructor(public readonly fields: Record<string, string>) {
    super('Проверьте данные поездки.');
  }
}

/** Parse an explicit-offset ISO timestamp without Date's silent calendar rollover. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;

  const [, y, mo, d, h, mi, s, fraction, offset] = match;
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number);
  if (!isCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  const offsetHours = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinutes = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  if (offsetHours > 23 || offsetMinutes > 59) return null;

  const clock = new Date(0);
  // setUTCFullYear also handles years 0001–0099 correctly, unlike Date.UTC.
  clock.setUTCFullYear(year, month - 1, day);
  clock.setUTCHours(hour, minute, second, Number((fraction ?? '').padEnd(3, '0')));
  const sign = offset.startsWith('-') ? -1 : 1;
  const instant = clock.getTime() - sign * (offsetHours * 60 + offsetMinutes) * 60_000;
  const utcYear = new Date(instant).getUTCFullYear();
  const localYear = new Date(instant + LOCAL_OFFSET_MS).getUTCFullYear();
  return utcYear >= 1 && utcYear <= 9999 && localYear >= 1 && localYear <= 9999 ? instant : null;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!match && isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** A trip belongs to the date of its start in the product's fixed UTC+05 zone. */
export function tripDay(start: string): string {
  return new Date(Date.parse(start) + LOCAL_OFFSET_MS).toISOString().slice(0, 10);
}

/** All stored instants use UTC; equivalent offset representations are safe retries. */
export function validateTrip(input: unknown): Trip {
  const fields: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError({ body: 'Передайте поездку как JSON-объект.' });
  }
  const body = input as Record<string, unknown>;
  // node:sqlite truncates TEXT at an embedded NUL on read; reject it before
  // insertion so every response preserves the client's idempotency identifier.
  if (typeof body.id !== 'string' || body.id.length < 1 || body.id.length > 128 || body.id.trim() !== body.id || body.id.includes('\0')) {
    fields.id = 'Укажите идентификатор длиной от 1 до 128 символов без пробелов по краям и нулевых символов.';
  }
  const start = parseTimestamp(body.start);
  const end = parseTimestamp(body.end);
  if (start === null) fields.start = 'Укажите корректное время начала в ISO 8601 с часовым поясом.';
  if (end === null) fields.end = 'Укажите корректное время окончания в ISO 8601 с часовым поясом.';
  if (start !== null && end !== null && end <= start) fields.end = 'Окончание должно быть позже начала.';
  if (!Number.isSafeInteger(body.amount) || (body.amount as number) <= 0 || (body.amount as number) > MAX_AMOUNT) {
    fields.amount = 'Сумма должна быть целым числом от 1 до 1 000 000 000 ₸.';
  }
  if (body.payment !== 'cash' && body.payment !== 'card') fields.payment = 'Выберите наличные (cash) или карту (card).';
  if (!Number.isSafeInteger(body.commission) || (body.commission as number) < 0 || (body.commission as number) > (body.amount as number)) {
    fields.commission = 'Комиссия должна быть целой, неотрицательной и не больше суммы поездки.';
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  return {
    id: body.id as string,
    start: new Date(start!).toISOString(),
    end: new Date(end!).toISOString(),
    amount: body.amount as number,
    payment: body.payment as Trip['payment'],
    commission: body.commission as number,
  };
}

export function summarizeTrips(trips: readonly Trip[]): DailySummary {
  return trips.reduce<DailySummary>((summary, trip) => {
    summary.tripCount += 1;
    summary.revenue += trip.amount;
    summary.commission += trip.commission;
    summary.net += trip.amount - trip.commission;
    summary[trip.payment] += trip.amount;
    return summary;
  }, { tripCount: 0, revenue: 0, commission: 0, net: 0, cash: 0, card: 0 });
}
