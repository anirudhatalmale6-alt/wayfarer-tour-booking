'use strict';

const express = require('express');
const availability = require('../lib/availability');
const catalog = require('../lib/catalog');
const fmt = require('../lib/format');

const router = express.Router();

/**
 * JSON API. The calendar and the seat counters on the tour page read from here
 * on load, on every month change, and whenever the tab regains focus — so the
 * numbers on screen are the numbers in the database, not the numbers that were
 * true when the page was first served.
 */

function publicDeparture(dep) {
  return {
    id: dep.id,
    depart_on: dep.depart_on,
    return_on: dep.return_on,
    capacity: dep.capacity,
    seats_free: dep.seats_free,
    state: dep.state,
    bookable: dep.bookable,
    price_minor: dep.price,
    price_display: fmt.money(dep.price, dep.currency || 'USD'),
    seat_line: fmt.seatLine(dep),
    date_range: fmt.dateRange(dep.depart_on, dep.return_on),
    return_display: fmt.shortDate(dep.return_on),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/tours/:slug/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/tours/:slug/availability', (req, res) => {
  const tour = catalog.getTourBySlug(req.params.slug);
  if (!tour) return res.status(404).json({ error: 'tour_not_found' });

  const { from, to } = req.query;
  if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) {
    return res.status(400).json({ error: 'bad_date', message: 'Dates must be YYYY-MM-DD.' });
  }

  const deps = availability.departuresForTour(tour.id, { from, to });
  res.set('Cache-Control', 'no-store'); // live inventory must never be cached
  res.json({
    tour: { slug: tour.slug, title: tour.title, currency: tour.currency, deposit_pct: tour.deposit_pct },
    checked_at: new Date().toISOString(),
    cutoff_days: availability.BOOKING_CUTOFF_DAYS,
    max_seats: availability.MAX_SEATS_PER_BOOKING,
    departures: deps.map((d) => publicDeparture({ ...d, currency: tour.currency })),
  });
});

// GET /api/departures/:id — single departure, used to re-check before checkout
router.get('/departures/:id', (req, res) => {
  const dep = availability.getDeparture(Number(req.params.id));
  if (!dep) return res.status(404).json({ error: 'departure_not_found' });
  res.set('Cache-Control', 'no-store');
  res.json({ checked_at: new Date().toISOString(), departure: publicDeparture(dep) });
});

// GET /api/quote?departure_id=&seats=
router.get('/quote', (req, res) => {
  const dep = availability.getDeparture(Number(req.query.departure_id));
  const seats = Number(req.query.seats);
  if (!dep) return res.status(404).json({ error: 'departure_not_found' });
  if (!Number.isInteger(seats) || seats < 1) {
    return res.status(400).json({ error: 'bad_seats' });
  }
  const q = availability.quote(dep, seats);
  res.set('Cache-Control', 'no-store');
  res.json({
    ...q,
    seats_free: dep.seats_free,
    fits: dep.bookable && dep.seats_free >= seats,
    unit_display: fmt.money(q.unit_price_minor, q.currency),
    total_display: fmt.money(q.amount_total_minor, q.currency),
    due_now_display: fmt.money(q.amount_due_now_minor, q.currency),
    balance_display: fmt.money(q.amount_balance_minor, q.currency),
  });
});

// POST /api/holds { departure_id, seats } — claim seats for the checkout window
router.post('/holds', (req, res) => {
  const departureId = Number(req.body.departure_id);
  const seats = Number(req.body.seats);
  try {
    const hold = availability.createHold(departureId, seats);
    res.status(201).json(hold);
  } catch (err) {
    if (err instanceof availability.SeatError) {
      return res.status(409).json({ error: err.code, message: err.message, ...err.extra });
    }
    throw err;
  }
});

// DELETE /api/holds/:id — traveller backed out; give the seats straight back
router.delete('/holds/:id', (req, res) => {
  const released = availability.releaseHold(req.params.id);
  res.json({ released });
});

module.exports = router;
