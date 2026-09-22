'use strict';

const path = require('path');
const express = require('express');

const fmt = require('./lib/format');
const availability = require('./lib/availability');
const catalog = require('./lib/catalog');

const app = express();
const PORT = Number(process.env.PORT || 4021);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', true);

app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(express.json({ limit: '64kb' }));

app.use(
  '/static',
  express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  })
);

// Helpers every template can reach, so no view has to require anything.
app.use((req, res, next) => {
  res.locals.fmt = fmt;
  res.locals.categories = catalog.CATEGORIES;
  res.locals.path = req.path;
  res.locals.query = req.query;
  res.locals.year = new Date().getUTCFullYear();
  res.locals.holdMinutes = availability.HOLD_MINUTES;
  next();
});

app.use('/api', require('./routes/api'));
app.use('/', require('./routes/pages'));

// Expired holds are swept lazily on every read, but a site with no traffic
// overnight would leave them sitting in the table. This keeps it tidy.
const sweeper = setInterval(() => {
  try {
    availability.sweepExpiredHolds();
  } catch (err) {
    process.stderr.write(`hold sweep failed: ${err.message}\n`);
  }
}, 60_000);
sweeper.unref();

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not found — Wayfarer' });
});

app.use((err, req, res, next) => {
  process.stderr.write(`${req.method} ${req.originalUrl} -> ${err.stack}\n`);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'server_error' });
  }
  res.status(500).render('500', { title: 'Something went wrong — Wayfarer' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    process.stdout.write(`Wayfarer listening on http://localhost:${PORT}\n`);
  });
}

module.exports = app;
