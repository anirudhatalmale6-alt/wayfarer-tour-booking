'use strict';

/**
 * Display helpers. Every one of these takes minor currency units (cents, paise)
 * and the currency code — never a bare number — so a price cannot be rendered
 * without its unit.
 */

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);

function minorPerMajor(currency) {
  return ZERO_DECIMAL.has(currency) ? 1 : 100;
}

/**
 * Render an amount held in minor units.
 *
 * Decimals appear exactly when the amount has them. A headline price of
 * $1,890.00 reads "US$1,890", but a 30% deposit of $1,043.40 reads
 * "US$1,043.40" — because that is the figure the card is charged, and rounding
 * it for tidiness would put a wrong number next to a real transaction.
 * Pass `decimals: true` to force cents on (useful in an invoice column).
 */
function money(amountMinor, currency = 'USD', { decimals = null } = {}) {
  const div = minorPerMajor(currency);
  const hasFraction = div > 1 && amountMinor % div !== 0;
  const showCents = decimals === null ? hasFraction : decimals && div > 1;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(amountMinor / div);
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function parseISO(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

/** "14 Oct 2026" */
function shortDate(iso) {
  const d = parseISO(iso);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Wed 14 October 2026" */
function longDate(iso) {
  const d = parseISO(iso);
  return `${DAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "14 - 25 Oct 2026", collapsing a shared month or year. */
function dateRange(fromISO, toISO) {
  const a = parseISO(fromISO);
  const b = parseISO(toISO);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  if (sameMonth) {
    return `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS_SHORT[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${a.getUTCDate()} ${MONTHS_SHORT[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS_SHORT[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  }
  return `${shortDate(fromISO)} – ${shortDate(toISO)}`;
}

/** "October 2026" from "2026-10" */
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function nights(days) {
  const n = days - 1;
  return `${days} days / ${n} night${n === 1 ? '' : 's'}`;
}

/** Plain-language seat line. Never invents urgency that the data doesn't show. */
function seatLine(dep) {
  switch (dep.state) {
    case 'sold_out':
      return 'Fully booked';
    case 'closed':
      return 'Bookings closed';
    case 'cancelled':
      return 'Cancelled';
    case 'too_soon':
      return 'Departs too soon to book online';
    case 'last_seats':
      return `${dep.seats_free} seat${dep.seats_free === 1 ? '' : 's'} left`;
    default:
      return `${dep.seats_free} of ${dep.capacity} seats open`;
  }
}

module.exports = { money, shortDate, longDate, dateRange, monthLabel, nights, seatLine, MONTHS, MONTHS_SHORT, DAYS_SHORT };
