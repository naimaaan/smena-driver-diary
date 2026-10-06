import type { ApiErrorResponse } from '../shared/types';

export const TIME_ZONE = 'Asia/Qyzylorda';
const moneyFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
});

export function money(value: number): string {
  return `${moneyFormatter.format(value)} ₸`;
}

export function time(value: string): string {
  // Match the API's fixed business offset, including dates before timezone
  // database changes. The device's timezone does not affect the display.
  return timeFormatter.format(new Date(Date.parse(value) + 5 * 60 * 60 * 1_000));
}

export function initialDate(): string {
  const candidate = new URLSearchParams(window.location.search).get('date');
  return candidate && isDate(candidate) ? candidate : '2026-10-01';
}

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (Number(value.slice(0, 4)) < 1) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function dayLabel(date: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...options,
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

export function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

export function weekFor(date: string): string[] {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const monday = addDays(date, -(day === 0 ? 6 : day - 1));
  // Keep the calendar renderable at the API's upper ISO year boundary.
  if (!isDate(addDays(monday, 6))) {
    return Array.from({ length: 7 }, (_, index) => addDays('9999-12-31', index - 6));
  }
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function tripDay(start: string): string {
  // The fixed +05:00 business timezone is independent of the device timezone.
  return new Date(new Date(start).getTime() + 5 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

export class ApiError extends Error {
  fields: Record<string, string>;

  constructor(message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.fields = fields;
  }
}

export async function readResponse<T>(response: Response): Promise<T> {
  let body: T | ApiErrorResponse;
  try {
    body = await response.json() as T | ApiErrorResponse;
  } catch {
    throw new ApiError('Сервер вернул неожиданный ответ. Попробуйте ещё раз.');
  }
  if (!response.ok) {
    const error = (body as ApiErrorResponse)?.error;
    throw new ApiError(error?.message ?? 'Не удалось выполнить запрос.', error?.fields);
  }
  return body as T;
}
