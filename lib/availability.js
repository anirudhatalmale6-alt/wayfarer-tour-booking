'use strict';

const crypto = require('crypto');
const { db, record } = require('../db');

/**
 * Seat inventory. Everything a traveller is shown about "is there room?" comes
 * through here, so there is exactly one definition of a free seat:
 *
 *     free = capacity - seats_booked - seats_held_by_someone_mid_checkout
 *
 * Money is handled in integer minor units (cents / paise) end to end. No float
 * ever touches a price, so no rounding argument is possible.
 */

const HOLD_MINUTES = Number(process.env.HOLD_MINUTES || 15);
const BOOKING_CUTOFF_DAYS = Number(process.env.BOOKING_CUTOFF_DAYS || 2);
const MAX_SEATS_PER_BOOKING = Number(process.env.MAX_SEATS_PER_BOOKING || 12);

// ---------------------------------------------------------------- date helpers

function todayISO(clock = new Date()) {
  return clock.toISOString().slice(0, 10);
}

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nowUTC(clock = new Date()) {
  return clock.toISOString();
}

// ---------------------------------------------------------------- hold hygiene

const stmtExpireHolds = db.prepare(
  `DELETE FROM holds WHERE consumed_at IS NULL AND expires_at <= ?`
);

/**
 * Drop holds whose checkout window has passed. Called at the top of every read
 * and every write, so a stale hold can never make a seat look sold.
 */
function sweepExpiredHolds(clock = new Date()) {
  const info = stmtExpireHolds.run(nowUTC(clock));
  if (info.changes > 0) record('holds.expired', null, { released: info.changes });
  return info.changes;
}

// ---------------------------------------------------------------- reads

const stmtHeldSeats = db.prepare(
  `SELECT COALESCE(SUM(seats), 0) AS held
     FROM holds
    WHERE departure_id = ? AND consumed_at IS NULL AND expires_at > ?`
);

const stmtDeparturesInRange = db.prepare(
  `SELECT d.*,
          COALESCE((SELECT SUM(h.seats) FROM holds h
                     WHERE h.departure_id = d.id
                       AND h.consumed_at IS NULL
                       AND h.expires_at > :now), 0) AS seats_held
     FROM departures d
    WHERE d.tour_id = :tourId
      AND d.depart_on >= :from
      AND d.depart_on <= :to
    ORDER BY d.depart_on`
);

const stmtDepartureById = db.prepare(
  `SELECT d.*, t.slug AS tour_slug, t.title AS tour_title, t.currency,
          t.deposit_pct, t.duration_days,
          COALESCE((SELECT SUM(h.seats) FROM holds h
                     WHERE h.departure_id = d.id
                       AND h.consumed_at IS NULL
                       AND h.expires_at > :now), 0) AS seats_held
     FROM departures d
     JOIN tours t ON t.id = d.tour_id
    WHERE d.id = :id`
);

/**
 * Classify one departure row into what the calendar should paint.
 * Returns the row plus: seats_free, bookable, reason.
 */
function decorate(row, clock = new Date()) {
  const cutoff = addDaysISO(todayISO(clock), BOOKING_CUTOFF_DAYS);
  const free = Math.max(0, row.capacity - row.seats_booked - row.seats_held);

  let state = 'available';
  if (row.status === 'cancelled') state = 'cancelled';
  else if (row.status === 'closed') state = 'closed';
  else if (row.depart_on < cutoff) state = 'too_soon';
  else if (free === 0) state = 'sold_out';
  else if (free <= 3) state = 'last_seats';

  return {
    ...row,
    seats_free: free,
    state,
    bookable: state === 'available' || state === 'last_seats',
  };
}

function departuresForTour(tourId, { from, to, clock = new Date() } = {}) {
  sweepExpiredHolds(clock);
  const start = from || todayISO(clock);
  const end = to || addDaysISO(start, 365);
  return stmtDeparturesInRange
    .all({ tourId, from: start, to: end, now: nowUTC(clock) })
    .map((r) => decorate(r, clock));
}

function getDeparture(id, clock = new Date()) {
  sweepExpiredHolds(clock);
  const row = stmtDepartureById.get({ id, now: nowUTC(clock) });
  return row ? decorate(row, clock) : null;
}

function heldSeats(departureId, clock = new Date()) {
  return stmtHeldSeats.get(departureId, nowUTC(clock)).held;
}

// ---------------------------------------------------------------- holds

const stmtInsertHold = db.prepare(
  `INSERT INTO holds (id, departure_id, seats, expires_at) VALUES (?, ?, ?, ?)`
);
const stmtGetHold = db.prepare(`SELECT * FROM holds WHERE id = ?`);
const stmtConsumeHold = db.prepare(
  `UPDATE holds SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`
);
const stmtDeleteHold = db.prepare(`DELETE FROM holds WHERE id = ? AND consumed_at IS NULL`);

class SeatError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Claim `seats` on a departure for HOLD_MINUTES. Runs as an IMMEDIATE
 * transaction: the write lock is taken before the free-seat count is read, so
 * two simultaneous requests for the last seat cannot both see it as free.
 */
const createHoldTx = db.transaction((departureId, seats, clock) => {
  sweepExpiredHolds(clock);

  if (!Number.isInteger(seats) || seats < 1) {
    throw new SeatError('bad_seats', 'Number of travellers must be a whole number of at least 1.');
  }
  if (seats > MAX_SEATS_PER_BOOKING) {
    throw new SeatError(
      'group_too_large',
      `Bookings above ${MAX_SEATS_PER_BOOKING} travellers are arranged by hand — please send us an enquiry.`,
      { max: MAX_SEATS_PER_BOOKING }
    );
  }

  const dep = getDeparture(departureId, clock);
  if (!dep) throw new SeatError('no_departure', 'That departure does not exist.');

  // Order matters. A departure that is shut for a reason other than seat
  // supply (cancelled, closed by staff, past the online cutoff) gets that
  // reason back. Everything else is a seat-count problem, and the traveller is
  // told the real number rather than a vague "not available".
  if (dep.state === 'cancelled' || dep.state === 'closed' || dep.state === 'too_soon') {
    throw new SeatError('not_bookable', reasonText(dep), { state: dep.state });
  }
  if (dep.seats_free < seats) {
    throw new SeatError(
      'insufficient_seats',
      dep.seats_free === 0
        ? 'This departure just sold out.'
        : `Only ${dep.seats_free} seat${dep.seats_free === 1 ? '' : 's'} left on this departure.`,
      { seats_free: dep.seats_free }
    );
  }

  const id = crypto.randomBytes(16).toString('hex');
  const expires = new Date(clock.getTime() + HOLD_MINUTES * 60_000).toISOString();
  stmtInsertHold.run(id, departureId, seats, expires);
  record('hold.created', id, { departureId, seats, expires });

  return {
    id,
    departure_id: departureId,
    seats,
    expires_at: expires,
    hold_minutes: HOLD_MINUTES,
  };
});

function releaseHold(holdId) {
  const info = stmtDeleteHold.run(holdId);
  if (info.changes) record('hold.released', holdId, {});
  return info.changes > 0;
}

function reasonText(dep) {
  switch (dep.state) {
    case 'sold_out':
      return 'This departure is fully booked.';
    case 'closed':
      return 'Bookings for this departure are closed.';
    case 'cancelled':
      return 'This departure has been cancelled.';
    case 'too_soon':
      return `This departure leaves within ${BOOKING_CUTOFF_DAYS} days and can no longer be booked online.`;
    default:
      return 'This departure is not currently bookable.';
  }
}

// ---------------------------------------------------------------- bookings

const stmtClaimSeats = db.prepare(
  `UPDATE departures
      SET seats_booked = seats_booked + :seats
    WHERE id = :id
      AND status = 'open'
      AND seats_booked + :seats <= capacity`
);

const stmtInsertBooking = db.prepare(
  `INSERT INTO bookings
     (reference, departure_id, seats, lead_name, lead_email, lead_phone, notes,
      amount_total, amount_due_now, currency, status, payment_ref, payment_state)
   VALUES
     (@reference, @departure_id, @seats, @lead_name, @lead_email, @lead_phone, @notes,
      @amount_total, @amount_due_now, @currency, @status, @payment_ref, @payment_state)`
);

const stmtInsertTraveller = db.prepare(
  `INSERT INTO travellers (booking_id, full_name, age) VALUES (?, ?, ?)`
);

function newReference() {
  // Ambiguous glyphs removed: a reference gets read out over the phone.
  const alphabet = 'ACDEFGHJKLMNPQRTUVWXY34679';
  let out = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `WF-${out}`;
}

function quote(departure, seats) {
  const total = departure.price * seats;
  const pct = departure.deposit_pct == null ? 100 : departure.deposit_pct;
  // Integer arithmetic only: the deposit rounds up to the nearest minor unit so
  // the balance can never be a fraction of a cent.
  const dueNow = pct >= 100 ? total : Math.ceil((total * pct) / 100);
  return {
    seats,
    unit_price_minor: departure.price,
    amount_total_minor: total,
    amount_due_now_minor: dueNow,
    amount_balance_minor: total - dueNow,
    deposit_pct: pct,
    currency: departure.currency,
  };
}

/**
 * Turn a paid hold into a confirmed booking. The seat increment and the booking
 * insert are one transaction, and the increment is guarded by
 * `seats_booked + n <= capacity` in the WHERE clause — so even if the hold were
 * somehow wrong, the database itself refuses to oversell.
 */
const confirmBookingTx = db.transaction((holdId, details, payment, clock) => {
  const hold = stmtGetHold.get(holdId);
  if (!hold) throw new SeatError('hold_expired', 'Your seats were released — please pick your dates again.');
  if (hold.consumed_at) throw new SeatError('hold_used', 'This checkout has already been completed.');
  if (hold.expires_at <= nowUTC(clock)) {
    throw new SeatError('hold_expired', 'Your seats were released — please pick your dates again.');
  }

  const dep = stmtDepartureById.get({ id: hold.departure_id, now: nowUTC(clock) });
  if (!dep) throw new SeatError('no_departure', 'That departure does not exist.');

  const claimed = stmtClaimSeats.run({ id: hold.departure_id, seats: hold.seats });
  if (claimed.changes !== 1) {
    // Belt and braces: capacity guard fired. Nothing has been written.
    throw new SeatError('insufficient_seats', 'This departure sold out while you were paying. You have not been charged.');
  }

  const q = quote(dep, hold.seats);
  const reference = newReference();

  const info = stmtInsertBooking.run({
    reference,
    departure_id: hold.departure_id,
    seats: hold.seats,
    lead_name: details.lead_name,
    lead_email: details.lead_email,
    lead_phone: details.lead_phone || null,
    notes: details.notes || null,
    amount_total: q.amount_total_minor,
    amount_due_now: q.amount_due_now_minor,
    currency: q.currency,
    status: payment.captured ? 'confirmed' : 'pending',
    payment_ref: payment.reference || null,
    payment_state: payment.state || null,
  });

  for (const t of details.travellers || []) {
    if (t && t.full_name) stmtInsertTraveller.run(info.lastInsertRowid, t.full_name, t.age || null);
  }

  if (payment.captured) {
    db.prepare(`UPDATE bookings SET confirmed_at = datetime('now') WHERE id = ?`)
      .run(info.lastInsertRowid);
  }

  stmtConsumeHold.run(nowUTC(clock), holdId);
  record('booking.created', reference, {
    departure_id: hold.departure_id,
    seats: hold.seats,
    amount_due_now_minor: q.amount_due_now_minor,
    currency: q.currency,
  });

  return { id: info.lastInsertRowid, reference, quote: q };
});

// `.immediate` takes the write lock at BEGIN instead of at the first write, so
// the free-seat read inside the transaction cannot be invalidated by a racing
// writer between the read and the insert.
const createHold = (departureId, seats, clock = new Date()) =>
  createHoldTx.immediate(departureId, seats, clock);

const confirmBooking = (holdId, details, payment, clock = new Date()) =>
  confirmBookingTx.immediate(holdId, details, payment, clock);

module.exports = {
  HOLD_MINUTES,
  BOOKING_CUTOFF_DAYS,
  MAX_SEATS_PER_BOOKING,
  SeatError,
  todayISO,
  addDaysISO,
  sweepExpiredHolds,
  departuresForTour,
  getDeparture,
  heldSeats,
  createHold,
  releaseHold,
  confirmBooking,
  quote,
  reasonText,
};
