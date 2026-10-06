import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Banknote, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, CreditCard, HelpCircle, Info, LoaderCircle, Plus, RefreshCw, Route, X } from 'lucide-react';
import type { DailyResponse, Trip } from '../shared/types';
import TripForm from './components/TripForm';
import { addDays, ApiError, dayLabel, initialDate, isDate, money, readResponse, time, tripDay, weekFor } from './lib';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: DailyResponse };

function BrandMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" width="38" height="38" fill="none">
      <rect width="40" height="40" rx="12" fill="currentColor" />
      <path d="M10 29V17a6 6 0 0 1 6-6h2v6h-2v12zm20-18v12a6 6 0 0 1-6 6h-2v-6h2V11zM18.5 17h3v6h-3z" fill="#9fe870" />
    </svg>
  );
}

function Summary({ data }: { data: DailyResponse }) {
  const { summary } = data;
  const total = summary.cash + summary.card;
  const cashShare = total === 0 ? 0 : (summary.cash / total) * 100;
  return (
    <section className="summary-grid" aria-label="Сводка за день">
      <div className="balance-card">
        <div className="balance-header"><h2>На руки</h2><span className="trip-count"><Route size={14} />{summary.tripCount} {tripWord(summary.tripCount)}</span></div>
        <div className={`balance-value ${summary.net >= 1_000_000_000 ? 'very-compact-money' : summary.net >= 1_000_000 ? 'compact-money' : ''}`} data-testid="daily-net">{money(summary.net)}</div>
        <p className="balance-caption">Ваш заработок после комиссии</p>
        <div className={`balance-calculation${summary.revenue >= 1_000_000 ? ' wide-money' : ''}`}>
          <span>Выручка <strong>{money(summary.revenue)}</strong></span>
          <span className="calculation-minus" aria-hidden="true">−</span>
          <span>Комиссия <strong>{money(summary.commission)}</strong></span>
          <ArrowUpRight size={24} className="balance-arrow" aria-hidden="true" />
        </div>
      </div>
      <div className="details-grid">
        <div className="metric-card">
          <span className="metric-label"><ArrowUpRight size={17} />Выручка</span>
          <strong className={summary.revenue >= 1_000_000_000 ? 'very-compact-money' : summary.revenue >= 1_000_000 ? 'compact-money' : ''}>{money(summary.revenue)}</strong>
          <span className="metric-description">Сумма всех поездок</span>
        </div>
        <div className="metric-card">
          <span className="metric-label"><ArrowDown size={17} />Комиссия</span>
          <strong className={summary.commission >= 1_000_000_000 ? 'very-compact-money' : summary.commission >= 1_000_000 ? 'compact-money' : ''}>{money(summary.commission)}</strong>
          <span className="metric-description">Всего за этот день</span>
        </div>
        <div className="payments-card">
          <div className="payments-title"><span>Как оплачивали</span><span className="payments-note">До комиссии</span></div>
          <div className="payments-values">
            <div><span><Banknote size={18} />Наличные</span><strong className={summary.cash >= 1_000_000_000 ? 'very-compact-money' : summary.cash >= 1_000_000 ? 'compact-money' : ''}>{money(summary.cash)}</strong></div>
            <div><span><CreditCard size={18} />Карта</span><strong className={summary.card >= 1_000_000_000 ? 'very-compact-money' : summary.card >= 1_000_000 ? 'compact-money' : ''}>{money(summary.card)}</strong></div>
          </div>
          <div className={`payment-bar${total === 0 ? ' empty' : ''}`} aria-hidden="true"><span style={{ width: `${cashShare}%` }} /></div>
        </div>
      </div>
    </section>
  );
}

function tripWord(count: number): string {
  if (count % 100 >= 11 && count % 100 <= 14) return 'поездок';
  if (count % 10 === 1) return 'поездка';
  if (count % 10 >= 2 && count % 10 <= 4) return 'поездки';
  return 'поездок';
}

function TripList({ data, onAdd }: { data: DailyResponse; onAdd: () => void }) {
  return (
    <section className="trips-section" aria-labelledby="trips-heading">
      <div className="section-heading">
        <div className="flex items-center gap-3"><h2 id="trips-heading">Поездки</h2><span className="section-count">{data.trips.length}</span></div>
        <span className="sort-label"><Clock3 size={15} />По времени начала</span>
      </div>
      {data.trips.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon"><Route size={28} /></span>
          <h3>Здесь начнётся ваша смена</h3>
          <p>За этот день поездок пока нет.<br />Добавьте первую — мы посчитаем остальное.</p>
          <button className="outline-button" onClick={onAdd}><Plus size={18} />Добавить поездку</button>
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
                <div className="trip-time" role="cell"><strong>{time(trip.start)}<ArrowRight size={15} aria-label="до" />{time(trip.end)}{overnight && <span className="overnight" title={`Окончание ${dayLabel(tripDay(trip.end))}`}>+{dayDifference}</span>}</strong><span>{duration} мин{overnight ? ` · до ${dayLabel(tripDay(trip.end))}` : ''}</span></div>
                <span className="trip-payment" role="cell">{trip.payment === 'card' ? <CreditCard size={17} /> : <Banknote size={17} />}<span>{trip.payment === 'card' ? 'Карта' : 'Наличные'}</span></span>
                <span className="trip-amount" role="cell"><span className="mobile-label">Сумма</span>{money(trip.amount)}</span>
                <span className="trip-commission" role="cell"><span className="mobile-label">Комиссия</span>−{money(trip.commission)}</span>
                <strong className="trip-net" role="cell"><span className="mobile-label">На руки</span>{money(trip.amount - trip.commission)}</strong>
              </div>
            );
          })}
        </div>
      )}
      <div className="calculation-note"><Info size={16} /><p>«На руки» = выручка − комиссия. Наличные и карта показаны до вычета комиссии.</p></div>
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
      <div className="dialog-heading"><div><span className="eyebrow">ПРОСТО И ПРОЗРАЧНО</span><h2 id="help-title">Как работает «Смена»</h2></div><button className="icon-button" type="button" aria-label="Закрыть справку" onClick={onClose}><X size={21} /></button></div>
      <div className="help-items">
        <div><CalendarDays size={22} /><div><h3>Один день — одна сводка</h3><p>Выбирайте день в календаре или переходите стрелками. Поездка относится ко дню начала, даже если заканчивается после полуночи.</p></div></div>
        <div><Banknote size={22} /><div><h3>Заработок без догадок</h3><p>Выручка — сумма поездок. Вычитаем комиссию и получаем «на руки». Это заработок за день, а не баланс банковского счёта.</p></div></div>
        <div><Plus size={22} /><div><h3>Добавляйте свои поездки</h3><p>Укажите время, оплату, сумму и комиссию. Если связь прервалась, повторите сохранение с теми же данными — поездка не продублируется.</p></div></div>
      </div>
      <p className="help-timezone"><Clock3 size={16} />Все даты и время — по Кызылорде, UTC+5.</p>
      <button className="primary-button w-full" onClick={onClose}>Понятно<Check size={18} /></button>
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
          <a className="brand" href="/?date=2026-10-01" aria-label="Смена — открыть дневник"><BrandMark /><span>смена<span className="brand-dot">.</span></span></a>
          <span className="header-description">Дневник водителя</span>
          <button className="help-button" type="button" aria-label="Как это работает" onClick={() => setHelpOpen(true)}><HelpCircle size={18} /><span>Как это работает</span></button>
        </div>
      </header>
      <main id="main" className="page-container">
        <section className="page-intro" aria-labelledby="page-title">
          <div><span className="eyebrow intro-eyebrow"><span aria-hidden="true" />КАЖДАЯ ПОЕЗДКА СЧИТАЕТСЯ</span><h1 id="page-title">Ваша смена.<br />Всё на виду.</h1></div>
          <div className="intro-action"><p>Поездки, комиссия и заработок.<br />Всё за день — в одном месте.</p><button className="primary-button" type="button" onClick={() => setFormOpen(true)}><Plus size={20} /><span>Добавить поездку</span></button></div>
        </section>
        <section className="date-section" aria-label="Выбор дня">
          <div className="date-toolbar">
            <div className="selected-date"><h2>{dayLabel(date, { year: 'numeric' })}</h2><span>{dayLabel(date, { weekday: 'long', day: undefined, month: undefined })}</span></div>
            <div className="date-controls">
              <div className="date-arrows"><button className="icon-button" type="button" aria-label="Предыдущий день" disabled={!isDate(addDays(date, -1))} onClick={() => selectDate(addDays(date, -1))}><ChevronLeft size={20} /></button><button className="icon-button" type="button" aria-label="Следующий день" disabled={!isDate(addDays(date, 1))} onClick={() => selectDate(addDays(date, 1))}><ChevronRight size={20} /></button></div>
              <label className="date-picker"><CalendarDays size={17} /><span>Выбрать дату</span><input type="date" aria-label="Выбрать дату" value={date} onChange={(event) => selectDate(event.target.value)} /></label>
            </div>
          </div>
          <div className="week-strip" role="group" aria-label="Дни недели">
            {week.map((day) => (
              <button key={day} className={`week-day${day === date ? ' selected' : ''}`} type="button" aria-pressed={day === date} aria-label={dayLabel(day, { weekday: 'long', year: 'numeric' })} onClick={() => selectDate(day)}><span>{dayLabel(day, { weekday: 'short', day: undefined, month: undefined })}</span><strong>{Number(day.slice(-2))}</strong>{day === date && <span className="selected-marker" aria-hidden="true" />}</button>
            ))}
          </div>
        </section>
        {notice && <div className="success-notice" role="status"><Check size={18} /><span>{notice}</span><button className="icon-button" aria-label="Закрыть уведомление" onClick={() => setNotice('')}><X size={17} /></button></div>}
        <div className="data-content" aria-busy={!ready && load.status !== 'error'}>
          {ready ? <><Summary data={load.data} /><TripList data={load.data} onAdd={() => setFormOpen(true)} /></> : load.status === 'error' ? (
            <section className="request-error" role="alert"><span className="empty-icon"><RefreshCw size={26} /></span><h2>Поездки пока недоступны</h2><p>{load.message}</p><button className="outline-button" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={17} />Попробовать снова</button></section>
          ) : (
            <div className="loading-state" role="status"><LoaderCircle size={24} className="animate-spin" /><span>Загружаем смену за {dayLabel(date)}…</span></div>
          )}
        </div>
      </main>
      <footer className="site-footer page-container"><span><span className="footer-brand">смена.</span>Спокойно работать. Точно считать.</span><span><Clock3 size={14} />Кызылорда · UTC+5</span></footer>
      <TripForm date={date} open={formOpen} onClose={() => setFormOpen(false)} onSaved={saved} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
