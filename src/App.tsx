import { useEffect, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Banknote, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, CreditCard, Info, LoaderCircle, Plus, RefreshCw, Route, X } from 'lucide-react';
import type { DailyResponse, Trip } from '../shared/types';
import TripForm from './components/TripForm';
import { addDays, ApiError, dayLabel, initialDate, isDate, money, readResponse, time, tripDay, weekFor } from './lib';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: DailyResponse };

const commissionPercentFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function commissionRate(trip: Trip): string {
  const percent = trip.commission / trip.amount * 100;
  return percent > 0 && percent < .01 ? '<0,01%' : `${commissionPercentFormatter.format(percent)}%`;
}

function moneyClass(value: number): string {
  return value >= 1_000_000_000 ? 'very-compact-money' : value >= 1_000_000 ? 'compact-money' : '';
}

function tripWord(count: number): string {
  if (count % 100 >= 11 && count % 100 <= 14) return 'поездок';
  if (count % 10 === 1) return 'поездка';
  if (count % 10 >= 2 && count % 10 <= 4) return 'поездки';
  return 'поездок';
}

function BalanceCard({ data }: { data: DailyResponse }) {
  const { summary } = data;
  return (
    <section className="balance-card" aria-label="Сводка за день">
      <div className="balance-header"><h2>На руки</h2><span className="trip-count">{summary.tripCount} {tripWord(summary.tripCount)}</span></div>
      <div className={`balance-value ${moneyClass(summary.net)}`} data-testid="daily-net">{money(summary.net)}</div>
      <p className="balance-caption">Ваш заработок после комиссии</p>
      <div className="balance-signature">
        <div className="card-hardware" aria-hidden="true">
          <svg className="card-chip" width="54" height="40" viewBox="0 0 54 40" fill="none">
            <rect x=".75" y=".75" width="52.5" height="38.5" rx="7" fill="#d7c99d" stroke="#93815c" strokeWidth="1.2" />
            <path d="M18 .75V10.5M36 .75V10.5M18 29.5V39.25M36 29.5V39.25M.75 13H18M36 13H53.25M.75 27H18M36 27H53.25" stroke="#93815c" strokeWidth="1.2" />
            <rect x="18" y="10.5" width="18" height="19" rx="4" fill="#e6d7ac" stroke="#93815c" strokeWidth="1.2" />
          </svg>
          <svg className="card-contactless" width="26" height="32" viewBox="0 0 26 32" stroke="currentColor" fill="none" strokeWidth="1.8" strokeLinecap="round">
            <path d="M5 11C9 13.5 9 18.5 5 21M11 7.5C18 12.5 18 19.5 11 24.5M17 3.5C27 10.5 27 21.5 17 28.5" />
          </svg>
        </div>
        <div className="card-brand"><span className="card-wordmark">смена.</span><span className="card-edition">Карта водителя</span></div>
      </div>
    </section>
  );
}

function Breakdown({ data }: { data: DailyResponse }) {
  const { summary } = data;
  return (
    <section className="breakdown-section" aria-labelledby="breakdown-title">
      <img className="breakdown-illustration" src="/images/driver-stencil.svg" alt="" aria-hidden="true" />
      <div className="page-container">
        <div className="breakdown-heading"><h2 id="breakdown-title">День в цифрах</h2></div>
        <dl className="breakdown-grid">
          <div className="breakdown-item metric-card"><dt><ArrowUpRight size={22} />Выручка</dt><dd><strong className={moneyClass(summary.revenue)}>{money(summary.revenue)}</strong></dd><dd className="breakdown-description">Сумма всех поездок</dd></div>
          <div className="breakdown-item metric-card"><dt><ArrowDown size={22} />Комиссия</dt><dd><strong className={moneyClass(summary.commission)}>{money(summary.commission)}</strong></dd><dd className="breakdown-description">Вычитается из выручки</dd></div>
          <div className="breakdown-item payments-values"><dt><Banknote size={22} />Наличные</dt><dd><strong className={moneyClass(summary.cash)}>{money(summary.cash)}</strong></dd><dd className="breakdown-description">Оплата до комиссии</dd></div>
          <div className="breakdown-item payments-values"><dt><CreditCard size={22} />Карта</dt><dd><strong className={moneyClass(summary.card)}>{money(summary.card)}</strong></dd><dd className="breakdown-description">Оплата до комиссии</dd></div>
        </dl>
      </div>
    </section>
  );
}

function TripList({ data, onAdd }: { data: DailyResponse; onAdd: () => void }) {
  return (
    <section className="trips-section page-container" aria-labelledby="trips-heading">
      <div className="section-heading">
        <div className="flex items-center gap-4">
          <h2 id="trips-heading">Поездки за день</h2><span className="section-count">{data.trips.length}</span>
          <details className="calculation-help" onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.open = false; }} onBlur={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
            <summary className="calculation-help-button" aria-label="Как рассчитывается заработок" title="Как рассчитывается заработок"><Info size={20} aria-hidden="true" /></summary>
            <p className="calculation-tooltip">«На руки» = выручка − комиссия. Наличные и карта показаны до вычета комиссии.</p>
          </details>
        </div>
      </div>
      {data.trips.length === 0 ? (
        <div className="empty-state">
          <Route size={36} className="empty-route" />
          <h3>Здесь начнётся ваша смена</h3>
          <button className="outline-button" onClick={onAdd}><Plus size={20} />Добавить поездку</button>
        </div>
      ) : (
        <div className="trips-table" role="table" aria-label="Поездки за выбранный день">
          <div className="trip-table-head" role="row">
            <span role="columnheader">Время поездки</span><span role="columnheader">Оплата</span><span role="columnheader">Сумма</span><span role="columnheader">Комиссия</span><span role="columnheader">На руки</span>
          </div>
          {data.trips.map((trip) => {
            const duration = Math.round((Date.parse(trip.end) - Date.parse(trip.start)) / 60_000);
            const dayDifference = Math.round((Date.parse(`${tripDay(trip.end)}T12:00:00Z`) - Date.parse(`${tripDay(trip.start)}T12:00:00Z`)) / 86_400_000);
            const overnight = dayDifference > 0;
            return (
              <div className={`trip-row${trip.amount >= 1_000_000 ? ' wide-money' : ''}`} role="row" key={trip.id} data-testid="trip-row">
                <div className="trip-time" role="cell"><strong>{time(trip.start)}<ArrowRight size={18} aria-label="до" />{time(trip.end)}{overnight && <span className="overnight" title={`Окончание ${dayLabel(tripDay(trip.end))}`}>+{dayDifference}</span>}</strong><span>{duration} мин{overnight ? ` · до ${dayLabel(tripDay(trip.end))}` : ''}</span></div>
                <span className="trip-payment" role="cell">{trip.payment === 'card' ? <CreditCard size={20} /> : <Banknote size={20} />}<span>{trip.payment === 'card' ? 'Карта' : 'Наличные'}</span></span>
                <span className="trip-amount" role="cell"><span className="mobile-label">Сумма</span>{money(trip.amount)}</span>
                <span className="trip-commission" role="cell"><span className="mobile-label">Комиссия</span><span className="trip-commission-amount">−{money(trip.commission)}</span><span className="trip-commission-rate">· {commissionRate(trip)}</span></span>
                <strong className="trip-net" role="cell"><span className="mobile-label">На руки</span><span className="trip-net-amount">{money(trip.amount - trip.commission)}</span></strong>
              </div>
            );
          })}
          <div className={`trip-table-total${data.summary.revenue >= 1_000_000 ? ' wide-money' : ''}`} role="row" aria-label="Итого за день">
            <strong className="trip-total-label" role="rowheader" aria-colspan={2}>Итого за день</strong>
            <strong className="trip-total-revenue" role="cell"><span className="mobile-label">Выручка</span><span className="trip-total-value">{money(data.summary.revenue)}</span></strong>
            <strong className="trip-total-commission" role="cell"><span className="mobile-label">Комиссия</span><span className="trip-total-value">−{money(data.summary.commission)}</span></strong>
            <strong className="trip-total-net" role="cell"><span className="mobile-label">На руки</span><span className="trip-net-amount">{money(data.summary.net)}</span></strong>
          </div>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [date, setDate] = useState(initialDate);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [refresh, setRefresh] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [businessDay, setBusinessDay] = useState(() => tripDay(new Date().toISOString()));
  const ready = load.status === 'ready' && load.data.date === date;
  const week = weekFor(date);
  const relativeDay = date === businessDay ? 'Сегодня' : date === addDays(businessDay, -1) ? 'Вчера' : null;

  useEffect(() => {
    let midnightTimer: number | undefined;

    function updateBusinessDay() {
      if (midnightTimer !== undefined) window.clearTimeout(midnightTimer);
      const now = new Date();
      const today = tripDay(now.toISOString());
      setBusinessDay(today);
      const nextMidnight = Date.parse(`${addDays(today, 1)}T00:00:00+05:00`);
      midnightTimer = window.setTimeout(updateBusinessDay, Math.max(1, nextMidnight - now.getTime()));
    }

    updateBusinessDay();
    window.addEventListener('focus', updateBusinessDay);
    return () => {
      window.removeEventListener('focus', updateBusinessDay);
      if (midnightTimer !== undefined) window.clearTimeout(midnightTimer);
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('date', date);
    window.history.replaceState({}, '', url);
    const controller = new AbortController();
    setLoad({ status: 'loading' });
    fetch(`/api/days/${date}`, { signal: controller.signal })
      .then((response) => readResponse<DailyResponse>(response))
      .then((data) => { if (!controller.signal.aborted) setLoad({ status: 'ready', data }); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: 'error', message: cause instanceof ApiError ? cause.message : 'Не удалось загрузить поездки. Проверьте соединение и попробуйте ещё раз.' });
      });
    return () => controller.abort();
  }, [date, refresh]);

  function saved(trip: Trip, created: boolean) {
    const assignedDate = tripDay(trip.start);
    setNotice(created ? `Поездка добавлена за ${dayLabel(assignedDate)}.` : 'Эта поездка уже сохранена. Повторная запись не создана.');
    if (assignedDate !== date) setDate(assignedDate);
    else setRefresh((value) => value + 1);
  }

  function selectDate(value: string) {
    if (isDate(value)) setDate(value);
  }

  return (
    <>
      <a href="#main" className="skip-link">Перейти к дневнику</a>
      <header className="site-header">
        <div className="page-container header-inner">
          <a className="brand" href="/?date=2026-10-01" aria-label="Смена: открыть дневник">смена.</a>
          <span className="header-description">Дневник водителя</span>
        </div>
      </header>
      <main id="main">
        <section className="date-section page-container" aria-label="Выбор дня">
          <div className="date-toolbar">
            <div className="selected-date"><h2>{dayLabel(date, { year: 'numeric' })}</h2><span>{dayLabel(date, { weekday: 'long', day: undefined, month: undefined })}</span>{relativeDay && <span className="relative-day">{relativeDay}</span>}</div>
            <div className="date-controls">
              <div className="date-arrows"><button className="icon-button" type="button" aria-label="Предыдущий день" disabled={!isDate(addDays(date, -1))} onClick={() => selectDate(addDays(date, -1))}><ChevronLeft size={22} /></button><button className="icon-button" type="button" aria-label="Следующий день" disabled={!isDate(addDays(date, 1))} onClick={() => selectDate(addDays(date, 1))}><ChevronRight size={22} /></button></div>
              <label className="date-picker" title="Выбрать дату"><CalendarDays size={20} aria-hidden="true" /><input type="date" aria-label="Выбрать дату" value={date} onChange={(event) => selectDate(event.target.value)} /></label>
              <button className="today-button" type="button" onClick={() => selectDate(tripDay(new Date().toISOString()))}>Сегодня</button>
            </div>
          </div>
          <div className="week-strip" role="group" aria-label="Дни недели">
            {week.map((day) => (
              <button key={day} className={`week-day${day === date ? ' selected' : ''}`} type="button" aria-pressed={day === date} aria-label={dayLabel(day, { weekday: 'long', year: 'numeric' })} onClick={() => selectDate(day)}><span>{dayLabel(day, { weekday: 'short', day: undefined, month: undefined })}</span><strong>{Number(day.slice(-2))}</strong></button>
            ))}
          </div>
        </section>
        {notice && <div className="page-container"><div className="success-notice" role="status"><Check size={20} /><span>{notice}</span><button className="icon-button" aria-label="Закрыть уведомление" onClick={() => setNotice('')}><X size={20} /></button></div></div>}
        <div className="data-content" aria-busy={!ready && load.status !== 'error'}>
          <section className="summary-hero page-container" aria-labelledby="page-title">
            <div className="hero-copy"><h1 id="page-title">Время деньги.<br />Берегите оба.</h1></div>
            <div className="hero-balance">
              {ready ? <BalanceCard data={load.data} /> : load.status === 'error' ? (
                <section className="request-error" role="alert"><RefreshCw size={30} /><h2>Поездки пока недоступны</h2><p>{load.message}</p><button className="outline-button" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={19} />Попробовать снова</button></section>
              ) : (
                <div className="loading-state" role="status"><LoaderCircle size={28} className="animate-spin" /><span>Загружаем смену за {dayLabel(date)}…</span></div>
              )}
            </div>
          </section>
          {ready && <><Breakdown data={load.data} /><TripList data={load.data} onAdd={() => setFormOpen(true)} /></>}
        </div>
      </main>
      <footer className="site-footer page-container"><span className="footer-brand">смена.</span><span><Clock3 size={17} />Кызылорда · UTC+5</span></footer>
      <button className="primary-button floating-add-button" type="button" onClick={() => setFormOpen(true)}><Plus size={22} /><span>Добавить поездку</span></button>
      <TripForm date={date} open={formOpen} onClose={() => setFormOpen(false)} onSaved={saved} />
    </>
  );
}
