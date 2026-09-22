'use strict';

const express = require('express');
const { db } = require('../db');
const availability = require('../lib/availability');
const catalog = require('../lib/catalog');
const payments = require('../lib/payments');
const fmt = require('../lib/format');

const router = express.Router();

// --------------------------------------------------------------------- home

router.get('/', (req, res) => {
  const all = catalog.listTours();
  const featured = catalog.CATEGORIES.map((cat) => {
    const inCat = all.filter((t) => t.category === cat.id && t.stats.any_availability);
    return { ...cat, tours: inCat.slice(0, 3) };
  });

  const soonest = all
    .filter((t) => t.stats.next_departure)
    .sort((a, b) => a.stats.next_departure.depart_on.localeCompare(b.stats.next_departure.depart_on))
    .slice(0, 4);

  const liveStats = db
    .prepare(
      `SELECT COUNT(*) AS departures,
              SUM(capacity - seats_booked) AS seats_open
         FROM departures
        WHERE status = 'open' AND depart_on >= ?`
    )
    .get(availability.todayISO());

  res.render('home', {
    title: 'Wayfarer — small-group tours, honestly scheduled',
    featured,
    soonest,
    liveStats,
    tourCount: all.length,
  });
});

// -------------------------------------------------------------------- browse

router.get('/tours', (req, res) => {
  const filters = {
    category: catalog.CATEGORIES.some((c) => c.id === req.query.category) ? req.query.category : '',
    q: typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '',
    duration: ['short', 'medium', 'long'].includes(req.query.duration) ? req.query.duration : '',
    month: /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : '',
    available: req.query.available === '1' ? '1' : '',
  };

  const tours = catalog.listTours(filters);

  res.render('tours', {
    title: 'All tours — Wayfarer',
    tours,
    filters,
    months: catalog.bookableMonths(),
    categories: catalog.CATEGORIES,
  });
});

// ------------------------------------------------------------------ one tour

router.get('/tours/:slug', (req, res, next) => {
  const tour = catalog.getTourBySlug(req.params.slug);
  if (!tour) return next();

  const deps = availability.departuresForTour(tour.id);
  const related = catalog
    .listTours({ category: tour.category })
    .filter((t) => t.id !== tour.id)
    .slice(0, 2);

  res.render('tour', {
    title: `${tour.title} — Wayfarer`,
    tour,
    departures: deps,
    related,
    holdMinutes: availability.HOLD_MINUTES,
    maxSeats: availability.MAX_SEATS_PER_BOOKING,
    cutoffDays: availability.BOOKING_CUTOFF_DAYS,
  });
});

// ------------------------------------------------------------------ checkout

/**
 * Start checkout. Seats are held here, before any form is shown — so the
 * traveller is not asked for a name and a card number for a seat that someone
 * else is about to take.
 */
router.post('/book', (req, res) => {
  const departureId = Number(req.body.departure_id);
  const seats = Number(req.body.seats);
  const dep = availability.getDeparture(departureId);

  try {
    const hold = availability.createHold(departureId, seats);
    return res.redirect(303, `/checkout/${hold.id}`);
  } catch (err) {
    if (!(err instanceof availability.SeatError)) throw err;
    const slug = dep ? dep.tour_slug : null;
    const back = slug ? `/tours/${slug}` : '/tours';
    return res.redirect(303, `${back}?error=${encodeURIComponent(err.message)}#dates`);
  }
});

function loadHold(holdId) {
  const hold = db.prepare('SELECT * FROM holds WHERE id = ?').get(holdId);
  if (!hold) return null;
  const dep = availability.getDeparture(hold.departure_id);
  if (!dep) return null;
  const tour = catalog.getTourById(dep.tour_id);
  return { hold, dep, tour, quote: availability.quote(dep, hold.seats) };
}

router.get('/checkout/:holdId', (req, res, next) => {
  const ctx = loadHold(req.params.holdId);
  if (!ctx) return res.status(410).render('expired', { title: 'Seats released — Wayfarer' });
  if (ctx.hold.consumed_at) {
    const booking = db
      .prepare('SELECT reference FROM bookings WHERE departure_id = ? ORDER BY id DESC LIMIT 1')
      .get(ctx.hold.departure_id);
    return booking
      ? res.redirect(303, `/booking/${booking.reference}`)
      : res.status(410).render('expired', { title: 'Seats released — Wayfarer' });
  }
  if (ctx.hold.expires_at <= new Date().toISOString()) {
    return res.status(410).render('expired', { title: 'Seats released — Wayfarer' });
  }

  res.render('checkout', {
    title: `Checkout — ${ctx.tour.title}`,
    ...ctx,
    gateway: payments.gateway(),
    demoCards: payments.DEMO_CARDS,
    error: null,
    form: {},
  });
});

router.post('/checkout/:holdId', (req, res) => {
  const ctx = loadHold(req.params.holdId);
  if (!ctx) return res.status(410).render('expired', { title: 'Seats released — Wayfarer' });

  const form = {
    lead_name: (req.body.lead_name || '').trim(),
    lead_email: (req.body.lead_email || '').trim(),
    lead_phone: (req.body.lead_phone || '').trim(),
    notes: (req.body.notes || '').trim().slice(0, 1000),
  };

  const travellerNames = []
    .concat(req.body.traveller_name || [])
    .map((s) => String(s).trim())
    .filter(Boolean);

  const fail = (message) =>
    res.status(422).render('checkout', {
      title: `Checkout — ${ctx.tour.title}`,
      ...ctx,
      gateway: payments.gateway(),
      demoCards: payments.DEMO_CARDS,
      error: message,
      form,
    });

  if (form.lead_name.length < 2) return fail('Please give the lead traveller’s full name.');
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(form.lead_email)) {
    return fail('That email address does not look right — we send the confirmation there.');
  }

  let payment;
  try {
    payment = payments.gateway().charge({
      amount_minor: ctx.quote.amount_due_now_minor,
      currency: ctx.quote.currency,
      reference: ctx.hold.id,
      card: {
        number: req.body.card_number,
        exp_month: Number(req.body.card_exp_month),
        exp_year: Number(req.body.card_exp_year),
        cvc: req.body.card_cvc,
      },
    });
  } catch (err) {
    if (err instanceof payments.PaymentError) return fail(err.message);
    throw err;
  }

  let booking;
  try {
    booking = availability.confirmBooking(
      ctx.hold.id,
      { ...form, travellers: travellerNames.map((full_name) => ({ full_name })) },
      payment
    );
  } catch (err) {
    if (err instanceof availability.SeatError) return fail(err.message);
    throw err;
  }

  res.redirect(303, `/booking/${booking.reference}`);
});

// ----------------------------------------------------------------- confirmed

router.get('/booking/:reference', (req, res) => {
  const booking = db
    .prepare('SELECT * FROM bookings WHERE reference = ?')
    .get(req.params.reference.toUpperCase());
  if (!booking) return res.status(404).render('404', { title: 'Not found — Wayfarer' });

  const dep = availability.getDeparture(booking.departure_id);
  const tour = catalog.getTourById(dep.tour_id);
  const travellers = db
    .prepare('SELECT * FROM travellers WHERE booking_id = ? ORDER BY id')
    .all(booking.id);

  res.render('confirmation', {
    title: `Booking ${booking.reference} — Wayfarer`,
    booking,
    dep,
    tour,
    travellers,
  });
});

// --------------------------------------------------------------------- pages

router.get('/how-it-works', (req, res) => {
  res.render('how', {
    title: 'How booking works — Wayfarer',
    holdMinutes: availability.HOLD_MINUTES,
    cutoffDays: availability.BOOKING_CUTOFF_DAYS,
    maxSeats: availability.MAX_SEATS_PER_BOOKING,
  });
});

// ------------------------------------------------------- operations dashboard

/**
 * Deliberately minimal and unauthenticated in the demo — it is the shape of
 * the admin surface, not the finished thing. A real deployment puts this
 * behind a login; see README.
 */
router.get('/ops', (req, res) => {
  const departures = db
    .prepare(
      `SELECT d.*, t.title, t.slug, t.currency,
              COALESCE((SELECT SUM(h.seats) FROM holds h
                         WHERE h.departure_id = d.id AND h.consumed_at IS NULL
                           AND h.expires_at > :now), 0) AS seats_held
         FROM departures d JOIN tours t ON t.id = d.tour_id
        WHERE d.depart_on >= :today
        ORDER BY d.depart_on LIMIT 40`
    )
    .all({ now: new Date().toISOString(), today: availability.todayISO() });

  const bookings = db
    .prepare(
      `SELECT b.*, t.title, d.depart_on
         FROM bookings b
         JOIN departures d ON d.id = b.departure_id
         JOIN tours t ON t.id = d.tour_id
        ORDER BY b.id DESC LIMIT 25`
    )
    .all();

  const events = db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 25').all();

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS bookings,
              COALESCE(SUM(seats), 0) AS seats,
              COALESCE(SUM(amount_due_now), 0) AS collected_minor
         FROM bookings WHERE status IN ('confirmed','pending')`
    )
    .get();

  res.render('ops', {
    title: 'Operations — Wayfarer',
    departures: departures.map((d) => ({ ...d, seats_free: Math.max(0, d.capacity - d.seats_booked - d.seats_held) })),
    bookings,
    events,
    totals,
  });
});

module.exports = router;
