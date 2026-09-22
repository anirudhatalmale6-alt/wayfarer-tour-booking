# Wayfarer — tour & travel booking platform

A working demonstration build of a tour booking site: catalogue, month-by-month
availability calendar, seat holds, checkout, confirmation and an operations
board. Built to show how real-time availability behaves when it is done
properly, rather than to look good in a screenshot.

Run it locally in three commands:

```bash
npm install
npm run seed      # builds data/wayfarer.db with 9 tours and ~140 departures
npm start         # http://localhost:4021
```

`npm test` runs the inventory test suite (26 assertions, no framework).

Screenshots of the running build are in [`screenshots/`](screenshots) if you
want to see it before running it.

---

## What is here

| Page | Path | What it demonstrates |
| --- | --- | --- |
| Home | `/` | Live counters read from the database on each request |
| Catalogue | `/tours` | Filtering by category, length, month and "seats left only" |
| Tour | `/tours/:slug` | Availability calendar, seat stepper, live quote, hold |
| Checkout | `/checkout/:hold` | Hold countdown, card validation, decline handling |
| Confirmation | `/booking/:ref` | Ticket stub, deposit/balance split, printable |
| Operations | `/ops` | Departure board, bookings, append-only event trail |
| Booking rules | `/how-it-works` | The availability and cancellation rules in plain words |

## The availability model

This is the part worth reading. "Real-time availability" is only worth anything
if the last seat cannot be sold twice, so there is exactly one definition of a
free seat and it lives in `lib/availability.js`:

```
free = capacity − seats_booked − seats_held_by_someone_mid_checkout
```

Four things protect it:

1. **Nothing is cached.** Every calendar cell is answered from SQLite at request
   time. The client re-reads on load, on month change, when the tab regains
   focus, every 60 seconds, and once more immediately before the form posts.
   Availability responses carry `Cache-Control: no-store`.

2. **Seats are held before the form is shown.** Picking a date claims the seats
   for 15 minutes (`HOLD_MINUTES`) and only then is the traveller asked for a
   name and a card. Expired holds are swept on every read and every write, so a
   stale hold can never make a seat look sold.

3. **Reads happen under the write lock.** `createHold` and `confirmBooking` run
   as `BEGIN IMMEDIATE` transactions, so the free-seat count cannot be
   invalidated between being read and being acted on.

4. **The database refuses to oversell.** The seat increment is
   `UPDATE … WHERE seats_booked + n <= capacity`, and the table carries a
   `CHECK (seats_booked <= capacity)` constraint on top. If two payments landed
   in the same millisecond, one succeeds and the other is told so before any
   money moves. Two tests marked `POSITIVE CONTROL` exist purely to prove these
   two backstops still fire — if either stops throwing, a migration has quietly
   removed the guard.

Money is handled in **integer minor units** (cents, paise) from end to end. No
float touches a price, deposits round up so a balance can never be a fraction of
a cent, and `lib/format.js` prints cents whenever an amount has them — a
$1,043.40 deposit is never displayed as "$1,043".

## Payments

`lib/payments.js` is a gateway boundary. The booking flow calls
`gateway().charge()` and reads `{ captured, reference, state }`; it never talks
to a provider directly.

The default `demo` gateway validates the card (Luhn, expiry, CVC length) and
then returns a scripted result. **It cannot charge a real card.**

| Card | Result |
| --- | --- |
| `4242 4242 4242 4242` | Captured |
| `4000 0000 0000 0002` | Declined by issuer |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 0119` | Processing error |

Going live means adding one adapter and setting `PAYMENT_GATEWAY`. The Stripe
stub in the same file throws loudly rather than half-working, and the comment
above it lists the four steps — notably: confirm the booking from the
`payment_intent.succeeded` **webhook**, not from the browser redirect, so a
closed tab cannot lose a paid booking. Using the gateway's hosted fields also
keeps card numbers off this server entirely, which is what keeps the site out of
PCI scope.

## Stack and layout

Node 18+, Express, EJS, SQLite (`better-sqlite3`). No build step, no bundler,
no framework on the client — the whole front end is one stylesheet and two
progressively-enhancing scripts.

```
server.js              app wiring, static files, error handling
db.js                  schema and migrations (runs on require)
seed.js                the demo catalogue — replace with real data
lib/availability.js    seat inventory: holds, quotes, bookings
lib/payments.js        gateway adapters
lib/catalog.js         tour queries and card statistics
lib/format.js          money and date display (minor units in, strings out)
routes/pages.js        server-rendered pages
routes/api.js          JSON availability / quote / hold endpoints
views/                 EJS templates
public/css/site.css    the whole visual system
public/js/booking.js   availability calendar
public/js/checkout.js  hold countdown and card validation
tools/gen-plates.js    regenerates the illustrated tour artwork
test/                  inventory tests
```

### Progressive enhancement

With JavaScript disabled, the tour page still renders a plain `<select>` of
every open departure and the form still books. The calendar replaces that
select when JS runs. Worth keeping: it is also the accessible path, and every
calendar cell is a real `<button>` with an `aria-label` that reads the date,
the price and the seat count.

### Artwork

The nine tour images are procedural SVG landscapes generated by
`tools/gen-plates.js` — deterministic, tiny, and with no licence attached to
any of them. Drop a real photograph into `public/img/plates/` under the same
filename to replace one. Fonts (Fraunces, Karla, JetBrains Mono) are
self-hosted subsets in `public/fonts/`, so no third-party font request leaves
the visitor's browser.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `4021` | HTTP port |
| `DB_PATH` | `data/wayfarer.db` | SQLite file |
| `HOLD_MINUTES` | `15` | Length of the checkout window |
| `BOOKING_CUTOFF_DAYS` | `2` | How close to departure online booking stops |
| `MAX_SEATS_PER_BOOKING` | `12` | Above this, parties are handled by hand |
| `PAYMENT_GATEWAY` | `demo` | `demo` or `stripe` |
| `NODE_ENV` | — | `production` enables view caching and static `max-age` |

## Before this goes near real customers

Stated plainly, because a demo that hides its gaps is worse than useless:

- **`/ops` has no authentication.** It is open here so the page can be seen
  without credentials. It is the one page that must never be public.
- **No email is sent.** The confirmation page says what would be emailed;
  wiring an actual transactional provider is a separate piece of work.
- **The demo gateway must be swapped** for a real adapter, with the webhook
  path described above.
- **SQLite is the right call for one server** and will comfortably handle a
  small operator. A multi-server deployment wants Postgres — the schema ports
  directly, and `SELECT … FOR UPDATE` replaces `BEGIN IMMEDIATE`.
- **No rate limiting on `POST /api/holds`.** A script could sit and hold seats.
  Real fix: a per-IP limit plus a cap on concurrent holds per visitor.
- **Catalogue text and prices are illustrative.** Tours, itineraries and
  amounts are written for the demo; nothing here is a real product.

---

Demonstration build. No real payments are processed and no card data is stored.
