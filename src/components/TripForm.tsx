import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { ArrowRight, Banknote, CreditCard, LoaderCircle, Plus, X } from 'lucide-react';
import type { CreateTripResponse, Trip } from '../../shared/types';
import { ApiError, money, readResponse } from '../lib';

interface Fields {
  start: string;
  end: string;
  amount: string;
  commission: string;
  payment: Trip['payment'];
}

function initialFields(date: string): Fields {
  return { start: `${date}T08:00`, end: `${date}T08:30`, amount: '', commission: '0', payment: 'card' };
}

interface Props {
  date: string;
  open: boolean;
  onClose: () => void;
  onSaved: (trip: Trip, created: boolean) => void;
}

export default function TripForm({ date, open, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const hasDraft = useRef(false);
  const [fields, setFields] = useState<Fields>(() => initialFields(date));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      if (!hasDraft.current) {
        setFields(initialFields(date));
        setError('');
        setFieldErrors({});
      }
      if (!dialog.current?.open) dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [open, date]);

  function update<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((previous) => ({ ...previous, [key]: value }));
    hasDraft.current = true;
    // Keep the pending operation while editing. The final submitted signature
    // decides whether this is a retry, including edits that were undone.
    setError('');
    setFieldErrors((previous) => ({ ...previous, [key]: '' }));
  }

  function backdropClick(event: MouseEvent<HTMLDialogElement>) {
    const bounds = dialog.current?.getBoundingClientRect();
    if (!saving && bounds && event.target === dialog.current &&
      (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) {
      onClose();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const amount = Number(fields.amount);
    const commission = Number(fields.commission);
    const start = `${fields.start}:00+05:00`;
    const end = `${fields.end}:00+05:00`;
    const validation: Record<string, string> = {};
    if (!Number.isSafeInteger(amount) || amount <= 0) validation.amount = 'Введите целую сумму больше нуля.';
    if (!Number.isSafeInteger(commission) || commission < 0) validation.commission = 'Введите целую неотрицательную комиссию.';
    else if (commission > amount) validation.commission = 'Комиссия не может превышать сумму поездки.';
    if (Number.isNaN(Date.parse(start))) validation.start = 'Укажите корректное время начала.';
    if (Number.isNaN(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) validation.end = 'Окончание должно быть позже начала.';
    if (Object.keys(validation).length) {
      setFieldErrors(validation);
      setError('Проверьте данные поездки.');
      return;
    }
    const payload = { start, end, amount, commission, payment: fields.payment };
    const signature = JSON.stringify(payload);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, id: crypto.randomUUID() };
    }
    hasDraft.current = true;
    setSaving(true);
    setError('');
    setFieldErrors({});
    try {
      const response = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: attempt.current.id, ...payload }),
      });
      const result = await readResponse<CreateTripResponse>(response);
      attempt.current = null;
      hasDraft.current = false;
      onSaved(result.trip, result.created);
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fields);
      } else {
        setError('Не удалось подтвердить сохранение. Повторите отправку: эта поездка не продублируется.');
      }
    } finally {
      setSaving(false);
    }
  }

  const net = Number(fields.amount) - Number(fields.commission);
  const preview = fields.amount && Number.isSafeInteger(net) && net >= 0 ? money(net) : '—';

  return (
    <dialog
      ref={dialog}
      className="app-dialog trip-dialog"
      aria-labelledby="trip-dialog-title"
      onClick={backdropClick}
      onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}
    >
      <div className="dialog-heading">
        <h2 id="trip-dialog-title">Новая поездка</h2>
        <button type="button" className="icon-button" onClick={onClose} disabled={saving} aria-label="Закрыть форму"><X size={21} /></button>
      </div>
      <p className="dialog-description" id="trip-timezone">Время по Кызылорде, UTC+5. Суммы — в целых тенге.</p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            <span id="trip-start-label">Начало поездки</span>
            <input autoFocus type="datetime-local" required step="60" value={fields.start} onChange={(event) => update('start', event.target.value)} aria-labelledby="trip-start-label" aria-describedby={fieldErrors.start ? 'error-start' : 'trip-timezone'} aria-invalid={!!fieldErrors.start} disabled={saving} />
            {fieldErrors.start && <small id="error-start" className="field-error">{fieldErrors.start}</small>}
          </label>
          <label className="field">
            <span id="trip-end-label">Окончание поездки</span>
            <input type="datetime-local" required step="60" value={fields.end} onChange={(event) => update('end', event.target.value)} aria-labelledby="trip-end-label" aria-describedby={fieldErrors.end ? 'error-end' : 'trip-timezone'} aria-invalid={!!fieldErrors.end} disabled={saving} />
            {fieldErrors.end && <small id="error-end" className="field-error">{fieldErrors.end}</small>}
          </label>
          <label className="field">
            <span id="trip-amount-label">Сумма поездки, ₸</span>
            <input type="number" inputMode="numeric" required min="1" max="1000000000" step="1" placeholder="Например, 2 400" value={fields.amount} onChange={(event) => update('amount', event.target.value)} aria-labelledby="trip-amount-label" aria-describedby={fieldErrors.amount ? 'error-amount' : undefined} aria-invalid={!!fieldErrors.amount} disabled={saving} />
            {fieldErrors.amount && <small id="error-amount" className="field-error">{fieldErrors.amount}</small>}
          </label>
          <label className="field">
            <span id="trip-commission-label">Комиссия, ₸</span>
            <input type="number" inputMode="numeric" required min="0" max="1000000000" step="1" value={fields.commission} onChange={(event) => update('commission', event.target.value)} aria-labelledby="trip-commission-label" aria-describedby={fieldErrors.commission ? 'error-commission' : undefined} aria-invalid={!!fieldErrors.commission} disabled={saving} />
            {fieldErrors.commission && <small id="error-commission" className="field-error">{fieldErrors.commission}</small>}
          </label>
        </div>
        <fieldset className="payment-field">
          <legend>Способ оплаты</legend>
          <div className="payment-options">
            <label className={fields.payment === 'card' ? 'payment-option selected' : 'payment-option'}>
              <input type="radio" name="payment" value="card" checked={fields.payment === 'card'} onChange={() => update('payment', 'card')} disabled={saving} />
              <CreditCard size={19} /><span>Карта</span>
            </label>
            <label className={fields.payment === 'cash' ? 'payment-option selected' : 'payment-option'}>
              <input type="radio" name="payment" value="cash" checked={fields.payment === 'cash'} onChange={() => update('payment', 'cash')} disabled={saving} />
              <Banknote size={19} /><span>Наличные</span>
            </label>
          </div>
        </fieldset>
        <div className="net-preview"><span>На руки с поездки</span><strong>{preview}</strong></div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-button form-submit" type="submit" disabled={saving}>
          {saving ? <LoaderCircle size={19} className="animate-spin" /> : <Plus size={20} />}
          <span>{saving ? 'Сохраняем поездку…' : 'Сохранить поездку'}</span>
          {!saving && <ArrowRight size={19} />}
        </button>
        <p className="form-note">День поездки определяется по времени её начала.</p>
      </form>
    </dialog>
  );
}
