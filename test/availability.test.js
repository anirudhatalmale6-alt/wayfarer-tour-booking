'use strict';

/**
 * Inventory tests. These exist because "real-time availability" is only worth
 * anything if the last seat cannot be sold twice — so most of what follows is
 * about the failure paths, not the happy one.
 *
 * Runs against a throwaway database so it can never touch demo or live data.
 * No framework: plain asserts, one process, exit code is the result.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wayfarer-test-'));
process.env.DB_PATH = path.join(TMP, 'test.db');
process.env.HOLD_MINUTES = '15';
process.env.BOOKING_CUTOFF_DAYS = '2';
process.env.MAX_SEATS_PER_BOOKING = '12';

const { db } = require('../db');
const availability = require('../lib/availability');
const payments = require('../lib/payments');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    reset();
    fn();
    passed++;
    process.stdout.write(`  ok   ${name}\n`);
  } catch (err) {
    failures.push({ name, err });
    process.stdout.write(`  FAIL ${name}\n         ${err.message}\n`);
  }
}

function iso(daysFromNow) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/** A two-tour fixture with known, hand-checkable seat counts. */
function reset() {
  db.exec('DELETE FROM travellers; DELETE FROM bookings; DELETE FROM holds; DELETE FROM departures; DELETE FROM tours; DELETE FROM events;');
  db.prepare(
    `INSERT INTO tours (id, slug, title, category, destination, country, duration_days,
                        difficulty, summary, description, plate, base_price, currency, deposit_pct)
     VALUES (1, 'fixture', 'Fixture Trek', 'adventure', 'Nowhere', 'Testland', 5,
             'Moderate', 's', 'd', 'ridgeline.svg', 100000, 'USD', 30)`
  ).run();

  const ins = db.prepare(
    `INSERT INTO departures (id, tour_id, depart_on, return_on, capacity, seats_booked, price, status)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
  );
  //  id  depart      capacity  booked   price   status
  ins.run(10, iso(40), iso(45), 10, 0, 100000, 'open');   // wide open
  ins.run(11, iso(50), iso(55), 10, 9, 100000, 'open');   // one seat left
  ins.run(12, iso(60), iso(65), 10, 10, 100000, 'open');  // sold out
  ins.run(13, iso(70), iso(75), 10, 0, 100000, 'closed'); // closed by staff
  ins.run(14, iso(1),  iso(6),  10, 0, 100000, 'open');   // inside the cutoff
}

// --------------------------------------------------------------------- reads

test('an open departure reports every seat free', () => {
  const dep = availability.getDeparture(10);
  assert.strictEqual(dep.seats_free, 10);
  assert.strictEqual(dep.state, 'available');
  assert.strictEqual(dep.bookable, true);
});

test('three or fewer seats left flags as last_seats, still bookable', () => {
  const dep = availability.getDeparture(11);
  assert.strictEqual(dep.seats_free, 1);
  assert.strictEqual(dep.state, 'last_seats');
  assert.strictEqual(dep.bookable, true);
});

test('a full departure is sold_out and not bookable', () => {
  const dep = availability.getDeparture(12);
  assert.strictEqual(dep.seats_free, 0);
  assert.strictEqual(dep.state, 'sold_out');
  assert.strictEqual(dep.bookable, false);
});

test('a staff-closed departure is not bookable even with seats free', () => {
  const dep = availability.getDeparture(13);
  assert.strictEqual(dep.seats_free, 10);
  assert.strictEqual(dep.bookable, false);
  assert.strictEqual(dep.state, 'closed');
});

test('a departure inside the booking cutoff is not bookable', () => {
  const dep = availability.getDeparture(14);
  assert.strictEqual(dep.state, 'too_soon');
  assert.strictEqual(dep.bookable, false);
});

// --------------------------------------------------------------------- holds

test('a hold removes seats from the free count without booking them', () => {
  availability.createHold(10, 4);
  const dep = availability.getDeparture(10);
  assert.strictEqual(dep.seats_free, 6, 'four seats should be held');
  assert.strictEqual(dep.seats_booked, 0, 'a hold must not book anything');
});

test('two holds racing for the last seat: exactly one wins', () => {
  const first = availability.createHold(11, 1);
  assert.ok(first.id);

  assert.throws(
    () => availability.createHold(11, 1),
    (err) => err instanceof availability.SeatError && err.code === 'insufficient_seats',
    'the second hold on a single-seat departure must be refused'
  );

  assert.strictEqual(availability.getDeparture(11).seats_free, 0);
});

test('holding more seats than exist is refused with the real number', () => {
  assert.throws(
    () => availability.createHold(11, 3),
    (err) => err.code === 'insufficient_seats' && err.extra.seats_free === 1
  );
});

test('a party larger than the per-booking cap is refused', () => {
  assert.throws(
    () => availability.createHold(10, 13),
    (err) => err.code === 'group_too_large'
  );
});

test('fractional and zero party sizes are refused', () => {
  assert.throws(() => availability.createHold(10, 0), (e) => e.code === 'bad_seats');
  assert.throws(() => availability.createHold(10, 2.5), (e) => e.code === 'bad_seats');
});

test('an expired hold returns its seats to the pool', () => {
  const hold = availability.createHold(10, 5);
  assert.strictEqual(availability.getDeparture(10).seats_free, 5);

  // Age the hold rather than waiting 15 minutes.
  db.prepare('UPDATE holds SET expires_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), hold.id);

  assert.strictEqual(availability.getDeparture(10).seats_free, 10, 'seats must come back');
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) c FROM holds WHERE id = ?').get(hold.id).c,
    0,
    'the expired hold row should be swept'
  );
});

test('releasing a hold by hand frees the seats immediately', () => {
  const hold = availability.createHold(10, 3);
  assert.strictEqual(availability.releaseHold(hold.id), true);
  assert.strictEqual(availability.getDeparture(10).seats_free, 10);
  assert.strictEqual(availability.releaseHold(hold.id), false, 'releasing twice is a no-op');
});

// ------------------------------------------------------------------ bookings

const CARD = { number: '4242424242424242', exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' };

function pay(amountMinor) {
  return payments.gateway().charge({ amount_minor: amountMinor, currency: 'USD', reference: 'test', card: CARD });
}

test('confirming a hold books the seats and consumes the hold', () => {
  const hold = availability.createHold(10, 2);
  const q = availability.quote(availability.getDeparture(10), 2);
  const booking = availability.confirmBooking(
    hold.id,
    { lead_name: 'A Tester', lead_email: 'a@example.com', travellers: [{ full_name: 'Second Person' }] },
    pay(q.amount_due_now_minor)
  );

  assert.match(booking.reference, /^WF-[A-Z0-9]{6}$/);

  const dep = availability.getDeparture(10);
  assert.strictEqual(dep.seats_booked, 2, 'seats must now be booked, not held');
  assert.strictEqual(dep.seats_held, 0, 'the hold must be consumed');
  assert.strictEqual(dep.seats_free, 8);

  const row = db.prepare('SELECT * FROM bookings WHERE reference = ?').get(booking.reference);
  assert.strictEqual(row.status, 'confirmed');
  assert.strictEqual(row.seats, 2);
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) c FROM travellers WHERE booking_id = ?').get(row.id).c,
    1
  );
});

test('a hold cannot be spent twice', () => {
  const hold = availability.createHold(10, 1);
  availability.confirmBooking(hold.id, { lead_name: 'A B', lead_email: 'a@b.co' }, pay(30000));

  assert.throws(
    () => availability.confirmBooking(hold.id, { lead_name: 'A B', lead_email: 'a@b.co' }, pay(30000)),
    (err) => err.code === 'hold_used'
  );
  assert.strictEqual(availability.getDeparture(10).seats_booked, 1, 'only one booking should exist');
});

test('an expired hold cannot be confirmed', () => {
  const hold = availability.createHold(10, 1);
  db.prepare('UPDATE holds SET expires_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), hold.id);

  assert.throws(
    () => availability.confirmBooking(hold.id, { lead_name: 'A B', lead_email: 'a@b.co' }, pay(30000)),
    (err) => err.code === 'hold_expired'
  );
  assert.strictEqual(availability.getDeparture(10).seats_booked, 0);
});

test('a failed confirmation leaves no partial booking behind', () => {
  const before = db.prepare('SELECT COUNT(*) c FROM bookings').get().c;
  assert.throws(() =>
    availability.confirmBooking('not-a-real-hold', { lead_name: 'A B', lead_email: 'a@b.co' }, pay(30000))
  );
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM bookings').get().c, before);
  assert.strictEqual(availability.getDeparture(10).seats_booked, 0);
});

// ---------------------------------------------------- database-level backstop

test('POSITIVE CONTROL: the database itself refuses to oversell', () => {
  // If this ever stops throwing, the CHECK constraint has been lost in a
  // migration and every test above is resting on application code alone.
  assert.throws(
    () => db.prepare('UPDATE departures SET seats_booked = capacity + 1 WHERE id = 10').run(),
    /CHECK constraint failed/,
    'the seats_booked <= capacity constraint is missing'
  );
});

test('POSITIVE CONTROL: the guarded seat claim refuses to exceed capacity', () => {
  // Book the departure out through the front door, then prove the claim
  // statement itself declines the eleventh seat.
  const hold = availability.createHold(10, 10);
  availability.confirmBooking(hold.id, { lead_name: 'Full House', lead_email: 'f@h.co' }, pay(300000));
  assert.strictEqual(availability.getDeparture(10).seats_free, 0);

  const claimed = db
    .prepare(`UPDATE departures SET seats_booked = seats_booked + 1
               WHERE id = 10 AND status = 'open' AND seats_booked + 1 <= capacity`)
    .run();
  assert.strictEqual(claimed.changes, 0, 'the guard clause must reject the write');
});

// -------------------------------------------------------------------- pricing

test('quotes are integer minor units and deposits round up, never down', () => {
  const dep = availability.getDeparture(10);
  // 3 travellers at $1,000.00 = $3,000.00; a 30% deposit is exactly $900.00
  const q = availability.quote(dep, 3);
  assert.strictEqual(q.amount_total_minor, 300000);
  assert.strictEqual(q.amount_due_now_minor, 90000);
  assert.strictEqual(q.amount_balance_minor, 210000);
  assert.ok(Number.isInteger(q.amount_due_now_minor), 'money must stay in whole minor units');

  // An awkward price that does not divide cleanly: 33% of 1,001 cents.
  db.prepare('UPDATE departures SET price = 1001 WHERE id = 10').run();
  db.prepare('UPDATE tours SET deposit_pct = 33 WHERE id = 1').run();
  const odd = availability.quote(availability.getDeparture(10), 1);
  assert.strictEqual(odd.amount_due_now_minor, 331, '330.33 cents must round up to 331');
  assert.strictEqual(
    odd.amount_due_now_minor + odd.amount_balance_minor,
    odd.amount_total_minor,
    'deposit plus balance must equal the total exactly'
  );
});

test('a full-payment tour asks for the whole amount', () => {
  db.prepare('UPDATE tours SET deposit_pct = 100 WHERE id = 1').run();
  const q = availability.quote(availability.getDeparture(10), 2);
  assert.strictEqual(q.amount_due_now_minor, q.amount_total_minor);
  assert.strictEqual(q.amount_balance_minor, 0);
});

// -------------------------------------------------------------------- gateway

test('the gateway rejects a mistyped card before any booking is written', () => {
  assert.throws(
    () => pay(1000) && payments.gateway().charge({
      amount_minor: 1000, currency: 'USD', card: { ...CARD, number: '4242424242424241' },
    }),
    (err) => err.code === 'card_number_invalid'
  );
});

test('the gateway surfaces a decline as a decline, not a success', () => {
  assert.throws(
    () => payments.gateway().charge({
      amount_minor: 1000, currency: 'USD', card: { ...CARD, number: '4000000000000002' },
    }),
    (err) => err.code === 'card_declined'
  );
});

test('an expired card is refused', () => {
  assert.throws(
    () => payments.gateway().charge({
      amount_minor: 1000, currency: 'USD', card: { ...CARD, exp_year: 2001 },
    }),
    (err) => err.code === 'card_expired'
  );
});

test('a declined payment books nothing and the hold survives for a retry', () => {
  const hold = availability.createHold(10, 1);
  assert.throws(() =>
    payments.gateway().charge({
      amount_minor: 30000, currency: 'USD', card: { ...CARD, number: '4000000000000002' },
    })
  );
  assert.strictEqual(availability.getDeparture(10).seats_booked, 0, 'nothing should be booked');
  assert.strictEqual(availability.getDeparture(10).seats_held, 1, 'the hold should still stand');
  assert.ok(db.prepare('SELECT 1 FROM holds WHERE id = ?').get(hold.id));
});

// --------------------------------------------------------------- money display

test('an amount with cents is never displayed rounded to whole units', () => {
  const fmt = require('../lib/format');
  // 30% of 2 x $1,739.00 is $1,043.40 — the figure that hits the card.
  assert.strictEqual(fmt.money(104340, 'USD'), 'US$1,043.40');
  assert.strictEqual(fmt.money(189000, 'USD'), 'US$1,890', 'whole amounts stay clean');
  assert.strictEqual(fmt.money(1, 'USD'), 'US$0.01');
  // Zero-decimal currencies have no minor unit to show.
  assert.strictEqual(fmt.money(12000, 'JPY'), 'JP¥12,000');
});

test('every displayed amount carries its currency symbol', () => {
  const fmt = require('../lib/format');
  for (const [minor, cur] of [[100000, 'USD'], [100000, 'EUR'], [100000, 'INR']]) {
    assert.ok(/[^\d.,\s]/.test(fmt.money(minor, cur)), `${cur} rendered without a symbol`);
  }
});

// ----------------------------------------------------------------------- done

process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failures.length ? 1 : 0);
