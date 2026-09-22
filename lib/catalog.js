'use strict';

const { db } = require('../db');
const availability = require('./availability');

const CATEGORIES = [
  { id: 'adventure', label: 'Adventure', blurb: 'Trails, water and thin air. Small groups, real guides.' },
  { id: 'city', label: 'City', blurb: 'Short trips that start before the coach parties arrive.' },
  { id: 'luxury', label: 'Luxury', blurb: 'Private charters and whole-house stays, eight to twenty-four guests.' },
];

function parseTour(row) {
  if (!row) return null;
  return {
    ...row,
    highlights: JSON.parse(row.highlights),
    itinerary: JSON.parse(row.itinerary),
    included: JSON.parse(row.included),
    excluded: JSON.parse(row.excluded),
  };
}

const stmtAllTours = db.prepare(
  `SELECT * FROM tours WHERE is_published = 1 ORDER BY category, title`
);
const stmtTourBySlug = db.prepare(`SELECT * FROM tours WHERE slug = ? AND is_published = 1`);
const stmtTourById = db.prepare(`SELECT * FROM tours WHERE id = ?`);

/**
 * Live headline numbers for a tour card: cheapest bookable departure, the next
 * date with room, and how many bookable departures remain. Computed from the
 * same availability rules the calendar uses, so a card can never advertise a
 * price on a departure the booking form would then refuse.
 */
function summarise(tour, clock = new Date()) {
  const deps = availability.departuresForTour(tour.id, { clock });
  const bookable = deps.filter((d) => d.bookable);
  const cheapest = bookable.reduce(
    (min, d) => (min == null || d.price < min ? d.price : min),
    null
  );
  return {
    departures_total: deps.length,
    departures_bookable: bookable.length,
    next_departure: bookable.length ? bookable[0] : null,
    from_price_minor: cheapest == null ? tour.base_price : cheapest,
    seats_free_next: bookable.length ? bookable[0].seats_free : 0,
    any_availability: bookable.length > 0,
  };
}

function listTours(filters = {}, clock = new Date()) {
  let rows = stmtAllTours.all().map(parseTour);

  if (filters.category) rows = rows.filter((t) => t.category === filters.category);

  if (filters.q) {
    const q = filters.q.trim().toLowerCase();
    if (q) {
      rows = rows.filter((t) =>
        [t.title, t.destination, t.country, t.summary, t.difficulty]
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }
  }

  if (filters.duration === 'short') rows = rows.filter((t) => t.duration_days <= 6);
  else if (filters.duration === 'medium') rows = rows.filter((t) => t.duration_days > 6 && t.duration_days <= 9);
  else if (filters.duration === 'long') rows = rows.filter((t) => t.duration_days > 9);

  const withStats = rows.map((t) => ({ ...t, stats: summarise(t, clock) }));

  // Month filter has to run against live departures, not the tour row.
  if (filters.month) {
    return withStats.filter((t) =>
      availability
        .departuresForTour(t.id, { clock })
        .some((d) => d.bookable && d.depart_on.slice(0, 7) === filters.month)
    );
  }

  if (filters.available === '1') return withStats.filter((t) => t.stats.any_availability);

  return withStats;
}

function getTourBySlug(slug, clock = new Date()) {
  const tour = parseTour(stmtTourBySlug.get(slug));
  if (!tour) return null;
  return { ...tour, stats: summarise(tour, clock) };
}

function getTourById(id) {
  return parseTour(stmtTourById.get(id));
}

/** Months that have at least one bookable departure anywhere in the catalogue. */
function bookableMonths(clock = new Date()) {
  const rows = db
    .prepare(
      `SELECT DISTINCT substr(depart_on, 1, 7) AS month
         FROM departures
        WHERE status = 'open' AND depart_on >= ?
        ORDER BY month`
    )
    .all(availability.todayISO(clock));
  return rows.map((r) => r.month);
}

module.exports = { CATEGORIES, listTours, getTourBySlug, getTourById, summarise, bookableMonths, parseTour };
