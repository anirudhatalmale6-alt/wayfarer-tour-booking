'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(process.env.DB_PATH || path.join(DATA_DIR, 'wayfarer.db'));

// WAL + busy timeout: multiple web workers can read while one writes, and a
// concurrent booking waits for the lock instead of erroring out.
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tours (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('adventure','city','luxury')),
  destination   TEXT NOT NULL,
  country       TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  difficulty    TEXT NOT NULL,
  summary       TEXT NOT NULL,
  description   TEXT NOT NULL,
  highlights    TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  itinerary     TEXT NOT NULL DEFAULT '[]',   -- JSON array of {day,title,body}
  included      TEXT NOT NULL DEFAULT '[]',
  excluded      TEXT NOT NULL DEFAULT '[]',
  plate         TEXT NOT NULL,                -- illustration filename
  base_price    INTEGER NOT NULL,             -- minor units (cents/paise)
  currency      TEXT NOT NULL DEFAULT 'USD',
  deposit_pct   INTEGER NOT NULL DEFAULT 100, -- 100 = pay in full at booking
  is_published  INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tour_id       INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  depart_on     TEXT NOT NULL,                -- YYYY-MM-DD, local to the tour
  return_on     TEXT NOT NULL,
  capacity      INTEGER NOT NULL,
  seats_booked  INTEGER NOT NULL DEFAULT 0,
  price         INTEGER NOT NULL,             -- per-departure price, minor units
  status        TEXT NOT NULL DEFAULT 'open'  -- open | closed | cancelled
                CHECK (status IN ('open','closed','cancelled')),
  UNIQUE (tour_id, depart_on),
  CHECK (seats_booked >= 0),
  CHECK (seats_booked <= capacity)
);
CREATE INDEX IF NOT EXISTS idx_departures_tour_date ON departures(tour_id, depart_on);

-- A hold is a short-lived claim on seats while the traveller is in checkout.
-- Without this, two people paying at the same time can oversell the last seat.
CREATE TABLE IF NOT EXISTS holds (
  id           TEXT PRIMARY KEY,              -- opaque token handed to the browser
  departure_id INTEGER NOT NULL REFERENCES departures(id) ON DELETE CASCADE,
  seats        INTEGER NOT NULL CHECK (seats > 0),
  expires_at   TEXT NOT NULL,                 -- ISO-8601 UTC
  consumed_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_holds_departure ON holds(departure_id);
CREATE INDEX IF NOT EXISTS idx_holds_expiry ON holds(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS bookings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reference      TEXT NOT NULL UNIQUE,        -- WF-XXXXXX shown to the traveller
  departure_id   INTEGER NOT NULL REFERENCES departures(id),
  seats          INTEGER NOT NULL CHECK (seats > 0),
  lead_name      TEXT NOT NULL,
  lead_email     TEXT NOT NULL,
  lead_phone     TEXT,
  notes          TEXT,
  amount_total   INTEGER NOT NULL,            -- minor units
  amount_due_now INTEGER NOT NULL,            -- deposit or full amount
  currency       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','confirmed','cancelled','refunded')),
  payment_ref    TEXT,
  payment_state  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_departure ON bookings(departure_id);

CREATE TABLE IF NOT EXISTS travellers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL,
  age        INTEGER
);

-- Append-only trail. Useful when a traveller disputes "I never got a seat".
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  subject    TEXT,
  payload    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const logEvent = db.prepare(
  'INSERT INTO events (kind, subject, payload) VALUES (?, ?, ?)'
);

function record(kind, subject, payload) {
  logEvent.run(kind, subject == null ? null : String(subject), JSON.stringify(payload || {}));
}

module.exports = { db, record };
