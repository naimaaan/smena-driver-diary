import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Banknote, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, CreditCard, HelpCircle, Info, LoaderCircle, Plus, RefreshCw, Route, X } from 'lucide-react';
import type { DailyResponse, Trip } from '../shared/types';
import TripForm from './components/TripForm';
import { addDays, ApiError, dayLabel, initialDate, isDate, money, readResponse, time, tripDay, weekFor } from './lib';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: DailyResponse };

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
      <div className="balance-footnote"><Check size={20} aria-hidden="true" /><span>Рассчитано по сохранённым поездкам</span></div>
    </section>
  );
}

function Breakdown({ data }: { data: DailyResponse }) {
  const { summary } = data;
  return (
    <section className="breakdown-section" aria-labelledby="breakdown-title">
      <div className="page-container">
        <div className="breakdown-heading"><h2 id="breakdown-title">День в цифрах</h2><p>Всё, из чего складывается заработок.</p></div>
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
        <div className="flex items-center gap-4"><h2 id="trips-heading">Поездки за день</h2><span className="section-count">{data.trips.length}</span></div>
        <span className="sort-label"><Clock3 size={18} />По времени начала</span>
      </div>
      {data.trips.length === 0 ? (
        <div className="empty-state">
          <Route size={36} className="empty-route" />
          <h3>Здесь начнётся ваша смена</h3>
          <p>За этот день поездок пока нет.<br />Добавьте первую — мы посчитаем остальное.</p>
          <button className="outline-button" onClick={onAdd}><Plus size={20} />Добавить поездку</button>
        </div>
      ) : (
        <div className="trips-table" role="table" aria-label="Поездки за выбранный день">
          <div className="trip-table-head" role="row">
            <span role="columnheader">№</span><span role="columnheader">Время поездки</span><span role="columnheader">Оплата</span><span role="columnheader">Сумма</span><span role="columnheader">Комиссия</span><span role="columnheader">На руки</span>
          </div>
          {data.trips.map((trip, index) => {
            const duration = Math.round((Date.parse(trip.end) - Date.parse(trip.start)) / 60_000);
            const dayDifference = Math.round((Date.parse(`${tripDay(trip.end)}T12:00:00Z`) - Date.parse(`${tripDay(trip.start)}T12:00:00Z`)) / 86_400_000);
            const overnight = dayDifference > 0;
            return (
              <div className={`trip-row${trip.amount >= 1_000_000 ? ' wide-money' : ''}`} role="row" key={trip.id} data-testid="trip-row">
                <span className="trip-number" role="cell">{String(index + 1).padStart(2, '0')}</span>
                <div className="trip-time" role="cell"><strong>{time(trip.start)}<ArrowRight size={18} aria-label="до" />{time(trip.end)}{overnight && <span className="overnight" title={`Окончание ${dayLabel(tripDay(trip.end))}`}>+{dayDifference}</span>}</strong><span>{duration} мин{overnight ? ` · до ${dayLabel(tripDay(trip.end))}` : ''}</span></div>
                <span className="trip-payment" role="cell">{trip.payment === 'card' ? <CreditCard size={20} /> : <Banknote size={20} />}<span>{trip.payment === 'card' ? 'Карта' : 'Наличные'}</span></span>
                <span className="trip-amount" role="cell"><span className="mobile-label">Сумма</span>{money(trip.amount)}</span>
                <span className="trip-commission" role="cell"><span className="mobile-label">Комиссия</span>−{money(trip.commission)}</span>
                <strong className="trip-net" role="cell"><span className="mobile-label">На руки</span>{money(trip.amount - trip.commission)}</strong>
              </div>
            );
          })}
        </div>
      )}
      <div className="calculation-note"><Info size={18} /><p>«На руки» = выручка − комиссия. Наличные и карта показаны до вычета комиссии.</p></div>
    </section>
  );
}

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open) dialog.current?.close();
  }, [open]);
  return (
    <dialog ref={dialog} className="app-dialog help-dialog" aria-labelledby="help-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="dialog-heading"><h2 id="help-title">Как работает «Смена»</h2><button className="icon-button" type="button" aria-label="Закрыть справку" onClick={onClose}><X size={22} /></button></div>
      <div className="help-items">
        <div><CalendarDays size={25} /><div><h3>Один день — одна сводка</h3><p>Выбирайте день в календаре или переходите стрелками. Поездка относится ко дню начала, даже если заканчивается после полуночи.</p></div></div>
        <div><Banknote size={25} /><div><h3>Заработок без догадок</h3><p>Выручка — сумма поездок. Вычитаем комиссию и получаем «на руки». Это заработок за день, а не баланс банковского счёта.</p></div></div>
        <div><Plus size={25} /><div><h3>Добавляйте свои поездки</h3><p>Укажите время, оплату, сумму и комиссию. Если связь прервалась, повторите сохранение с теми же данными — поездка не продублируется.</p></div></div>
      </div>
      <p className="help-timezone"><Clock3 size={18} />Все даты и время — по Кызылорде, UTC+5.</p>
      <button className="primary-button w-full" onClick={onClose}>Понятно<Check size={20} /></button>
    </dialog>
  );
}

export default function App() {
  const [date, setDate] = useState(initialDate);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [refresh, setRefresh] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const ready = load.status === 'ready' && load.data.date === date;
  const week = weekFor(date);

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
          <a className="brand" href="/?date=2026-10-01" aria-label="Смена — открыть дневник">смена.</a>
          <span className="header-description">Дневник водителя</span>
          <button className="help-button" type="button" aria-label="Как это работает" onClick={() => setHelpOpen(true)}><HelpCircle size={21} /><span>Как это работает</span></button>
        </div>
      </header>
      <main id="main">
        <section className="date-section page-container" aria-label="Выбор дня">
          <div className="date-toolbar">
            <div className="selected-date"><h2>{dayLabel(date, { year: 'numeric' })}</h2><span>{dayLabel(date, { weekday: 'long', day: undefined, month: undefined })}</span></div>
            <div className="date-controls">
              <div className="date-arrows"><button className="icon-button" type="button" aria-label="Предыдущий день" disabled={!isDate(addDays(date, -1))} onClick={() => selectDate(addDays(date, -1))}><ChevronLeft size={22} /></button><button className="icon-button" type="button" aria-label="Следующий день" disabled={!isDate(addDays(date, 1))} onClick={() => selectDate(addDays(date, 1))}><ChevronRight size={22} /></button></div>
              <label className="date-picker"><CalendarDays size={20} /><span>Выбрать дату</span><input type="date" aria-label="Выбрать дату" value={date} onChange={(event) => selectDate(event.target.value)} /></label>
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
            <div className="hero-copy"><h1 id="page-title">Ваша смена.<br />Ваш заработок.</h1><p className="hero-description">Поездки, комиссия и заработок.<br />Всё за день — в одном месте.</p></div>
            <div className="hero-balance">
              {ready ? <BalanceCard data={load.data} /> : load.status === 'error' ? (
                <section className="request-error" role="alert"><RefreshCw size={30} /><h2>Поездки пока недоступны</h2><p>{load.message}</p><button className="outline-button" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={19} />Попробовать снова</button></section>
              ) : (
                <div className="loading-state" role="status"><LoaderCircle size={28} className="animate-spin" /><span>Загружаем смену за {dayLabel(date)}…</span></div>
              )}
            </div>
            <div className="hero-action"><button className="primary-button" type="button" onClick={() => setFormOpen(true)}><Plus size={22} /><span>Добавить поездку</span></button></div>
          </section>
          {ready && <><Breakdown data={load.data} /><TripList data={load.data} onAdd={() => setFormOpen(true)} /></>}
        </div>
      </main>
      <footer className="site-footer page-container"><span><span className="footer-brand">смена.</span>Спокойно работать. Точно считать.</span><span><Clock3 size={17} />Кызылорда · UTC+5</span></footer>
      <TripForm date={date} open={formOpen} onClose={() => setFormOpen(false)} onSaved={saved} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
