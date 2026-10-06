/** Monetary values are integer KZT (tenge), never floating point. */
export interface Trip {
  id: string;
  start: string;
  end: string;
  amount: number;
  payment: 'cash' | 'card';
  commission: number;
}

export interface DailySummary {
  tripCount: number;
  revenue: number;
  commission: number;
  net: number;
  cash: number;
  card: number;
}

export interface DailyResponse {
  date: string;
  timeZone: 'Asia/Qyzylorda';
  trips: Trip[];
  summary: DailySummary;
}

export interface CreateTripResponse {
  trip: Trip;
  created: boolean;
}

export interface ApiErrorResponse {
  error: { code: string; message: string; fields?: Record<string, string> };
}
