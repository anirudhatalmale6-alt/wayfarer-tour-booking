/* Wayfarer — availability calendar and booking panel.
 *
 * Progressive enhancement: the server renders a plain <select> of every open
 * departure, which works with no JavaScript at all. If this file runs, it
 * swaps that select for a month calendar driven by /api/tours/:slug/availability
 * and keeps it honest — re-reading inventory on a timer, when the tab regains
 * focus, and immediately before the form is submitted.
 *
 * Money is never computed here. Prices and totals come from /api/quote so
 * there is exactly one rounding implementation, on the server.
 */
(function () {
  'use strict';

  var panel = document.querySelector('[data-book-form]') && document.querySelector('.bookpanel');
  if (!panel) return;

  var SLUG = panel.dataset.slug;
  var MAX_SEATS = Number(panel.dataset.maxSeats || 12);
  var REFRESH_MS = 60000;

  var el = {
    calendar: panel.querySelector('[data-calendar]'),
    grid: panel.querySelector('[data-cal-grid]'),
    monthLabel: panel.querySelector('[data-cal-month]'),
    prev: panel.querySelector('[data-cal-prev]'),
    next: panel.querySelector('[data-cal-next]'),
    fallback: panel.querySelector('[data-fallback]'),
    form: panel.querySelector('[data-book-form]'),
    slotEmpty: panel.querySelector('[data-slot-empty]'),
    slotDetail: panel.querySelector('[data-slot-detail]'),
    slotDate: panel.querySelector('[data-slot-date]'),
    slotReturn: panel.querySelector('[data-slot-return]'),
    slotPill: panel.querySelector('[data-slot-pill]'),
    seatOut: panel.querySelector('[data-seat-out]'),
    seatUp: panel.querySelector('[data-seat-up]'),
    seatDown: panel.querySelector('[data-seat-down]'),
    seatHint: panel.querySelector('[data-seat-hint]'),
    seatsInput: panel.querySelector('[data-seats-input]'),
    qUnit: panel.querySelector('[data-q-unit]'),
    qUnitK: panel.querySelector('[data-q-unit-k]'),
    qTotal: panel.querySelector('[data-q-total]'),
    qDue: panel.querySelector('[data-q-due]'),
    qNote: panel.querySelector('[data-q-note]'),
    submit: panel.querySelector('[data-submit]'),
    live: panel.querySelector('[data-live]'),
    liveText: panel.querySelector('[data-live-text]'),
  };

  // The calendar posts through a hidden field; the no-JS <select> is removed
  // below so the form can never submit two departure ids.
  var depInput = document.createElement('input');
  depInput.type = 'hidden';
  depInput.name = 'departure_id';
  depInput.setAttribute('data-dep-input', '');

  var state = {
    byDate: {},        // 'YYYY-MM-DD' -> departure
    months: [],        // sorted 'YYYY-MM' that contain any departure
    monthIndex: 0,
    selectedId: null,
    seats: 1,
    depositPct: 100,
    quoteSeq: 0,
  };

  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // ------------------------------------------------------------------ helpers

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function ym(iso) { return iso.slice(0, 7); }

  function monthLabel(m) {
    var parts = m.split('-');
    return MONTHS[Number(parts[1]) - 1] + ' ' + parts[0];
  }

  /** Days in a 'YYYY-MM', and the Monday-first weekday index of the 1st. */
  function monthShape(m) {
    var y = Number(m.slice(0, 4));
    var mo = Number(m.slice(5, 7));
    var days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    var jsDow = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(); // 0=Sun
    return { days: days, lead: (jsDow + 6) % 7, y: y, m: mo };
  }

  function setLive(ok, when) {
    if (!el.live) return;
    el.live.classList.toggle('is-stale', !ok);
    if (!el.liveText) return;
    if (!ok) {
      el.liveText.textContent = 'Reconnecting';
      el.live.title = 'Could not reach the availability service — showing the last known numbers.';
      return;
    }
    var d = when ? new Date(when) : new Date();
    el.liveText.textContent = 'Checked ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    el.live.title = 'Seat counts read from live inventory at ' + d.toLocaleTimeString();
  }

  function flash(message, kind) {
    var existing = panel.querySelector('[data-flash]');
    if (existing) existing.remove();
    if (!message) return;
    var box = document.createElement('div');
    box.className = 'notice notice--' + (kind || 'warn');
    box.setAttribute('data-flash', '');
    box.style.marginTop = '1rem';
    box.innerHTML = '<span class="notice__i">!</span><p></p>';
    box.querySelector('p').textContent = message;
    el.form.parentNode.insertBefore(box, el.form);
  }

  // --------------------------------------------------------------- data fetch

  function load(options) {
    var opts = options || {};
    return fetch('/api/tours/' + encodeURIComponent(SLUG) + '/availability', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then(function (r) {
        if (!r.ok) throw new Error('availability ' + r.status);
        return r.json();
      })
      .then(function (data) {
        state.depositPct = data.tour.deposit_pct;
        state.byDate = {};
        var months = {};
        data.departures.forEach(function (d) {
          state.byDate[d.depart_on] = d;
          months[ym(d.depart_on)] = true;
        });
        state.months = Object.keys(months).sort();

        if (opts.initial) {
          // Open on the first month that has something bookable, not on a
          // month full of sold-out dates.
          var firstOpen = data.departures.filter(function (d) { return d.bookable; })[0];
          var target = firstOpen ? ym(firstOpen.depart_on) : state.months[0];
          state.monthIndex = Math.max(0, state.months.indexOf(target));
        } else {
          state.monthIndex = Math.min(state.monthIndex, Math.max(0, state.months.length - 1));
        }

        setLive(true, data.checked_at);
        render();
        reconcileSelection();
        return data;
      })
      .catch(function (err) {
        setLive(false);
        if (window.console) console.warn('[wayfarer]', err.message);
      });
  }

  /** After a refresh, make sure the thing the traveller picked is still real. */
  function reconcileSelection() {
    if (!state.selectedId) return;
    var dep = findById(state.selectedId);
    if (!dep) {
      state.selectedId = null;
      showSlot(null);
      flash('That departure is no longer listed. Please choose another date.');
      return;
    }
    if (!dep.bookable) {
      state.selectedId = null;
      showSlot(null);
      flash(dep.state === 'sold_out'
        ? 'That departure sold out while this page was open. Nothing has been charged.'
        : 'That departure just closed: ' + dep.seat_line.toLowerCase() + '.');
      return;
    }
    if (state.seats > dep.seats_free) {
      state.seats = dep.seats_free;
      flash('Only ' + dep.seats_free + ' seat' + (dep.seats_free === 1 ? '' : 's') +
            ' left on that date — your party size has been reduced to match.');
    }
    showSlot(dep);
  }

  function findById(id) {
    var keys = Object.keys(state.byDate);
    for (var i = 0; i < keys.length; i++) {
      if (state.byDate[keys[i]].id === id) return state.byDate[keys[i]];
    }
    return null;
  }

  // ------------------------------------------------------------------- render

  function render() {
    if (!state.months.length) {
      el.grid.innerHTML = '';
      el.monthLabel.textContent = 'No dates listed';
      el.prev.disabled = true;
      el.next.disabled = true;
      return;
    }

    var m = state.months[state.monthIndex];
    var shape = monthShape(m);
    el.monthLabel.textContent = monthLabel(m);
    el.prev.disabled = state.monthIndex <= 0;
    el.next.disabled = state.monthIndex >= state.months.length - 1;

    var frag = document.createDocumentFragment();

    for (var b = 0; b < shape.lead; b++) {
      frag.appendChild(cell('div', '', 'cal__cell cal__cell--blank'));
    }

    for (var day = 1; day <= shape.days; day++) {
      var iso = shape.y + '-' + pad(shape.m) + '-' + pad(day);
      var dep = state.byDate[iso];

      if (!dep) {
        frag.appendChild(cell('div', String(day), 'cal__cell cal__cell--plain'));
        continue;
      }

      if (!dep.bookable) {
        var dead = cell('div', String(day), 'cal__cell cal__cell--dead');
        dead.title = dep.seat_line;
        dead.appendChild(tag(dep.state === 'sold_out' ? 'full'
          : dep.state === 'too_soon' ? 'soon' : 'closed'));
        frag.appendChild(dead);
        continue;
      }

      var btn = cell('button', String(day), 'cal__cell');
      btn.type = 'button';
      btn.dataset.depId = String(dep.id);
      btn.dataset.state = dep.state;
      btn.setAttribute('aria-pressed', state.selectedId === dep.id ? 'true' : 'false');
      btn.setAttribute('aria-label',
        day + ' ' + monthLabel(m) + ' — ' + dep.price_display + ' per person, ' + dep.seat_line);
      btn.title = dep.date_range + ' · ' + dep.seat_line;
      btn.appendChild(tag(dep.state === 'last_seats' ? dep.seats_free + ' left' : dep.price_display));
      frag.appendChild(btn);
    }

    el.grid.innerHTML = '';
    el.grid.appendChild(frag);
  }

  function cell(tagName, text, cls) {
    var node = document.createElement(tagName);
    node.className = cls;
    if (text) {
      var s = document.createElement('span');
      s.textContent = text;
      node.appendChild(s);
    }
    return node;
  }

  function tag(text) {
    var s = document.createElement('span');
    s.className = 'tag';
    s.textContent = text;
    return s;
  }

  // --------------------------------------------------------------- selection

  function showSlot(dep) {
    depInput.value = dep ? String(dep.id) : '';

    if (!dep) {
      el.slotDetail.hidden = true;
      el.slotEmpty.hidden = false;
      el.submit.disabled = true;
      el.submit.textContent = 'Choose a date';
      panel.querySelectorAll('[aria-pressed="true"]').forEach(function (b) {
        b.setAttribute('aria-pressed', 'false');
      });
      return;
    }

    el.slotEmpty.hidden = true;
    el.slotDetail.hidden = false;
    el.submit.disabled = false;
    el.submit.textContent = 'Hold these seats';

    el.slotDate.textContent = dep.date_range;
    el.slotReturn.textContent = 'Returns ' + dep.return_display;
    el.slotPill.textContent = dep.seat_line;
    el.slotPill.className = 'pill pill--' + dep.state;

    el.seatHint.textContent = 'Up to ' + Math.min(MAX_SEATS, dep.seats_free) +
      ' on this departure' + (dep.seats_free <= MAX_SEATS ? ' — that is all that is left' : '');

    syncSeatControls(dep);
    requestQuote(dep);

    panel.querySelectorAll('.cal__cell[data-dep-id]').forEach(function (b) {
      b.setAttribute('aria-pressed', Number(b.dataset.depId) === dep.id ? 'true' : 'false');
    });
  }

  function syncSeatControls(dep) {
    var cap = Math.max(1, Math.min(MAX_SEATS, dep.seats_free));
    state.seats = Math.max(1, Math.min(state.seats, cap));
    el.seatOut.textContent = String(state.seats);
    el.seatsInput.value = String(state.seats);
    el.seatDown.disabled = state.seats <= 1;
    el.seatUp.disabled = state.seats >= cap;
  }

  function requestQuote(dep) {
    var seq = ++state.quoteSeq;
    el.qUnitK.textContent = state.seats === 1 ? 'Per person' : state.seats + ' × per person';
    fetch('/api/quote?departure_id=' + dep.id + '&seats=' + state.seats, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (q) {
        if (seq !== state.quoteSeq) return; // a newer request already answered
        el.qUnit.textContent = q.unit_display;
        el.qTotal.textContent = q.total_display;
        el.qDue.textContent = q.due_now_display;
        el.qNote.textContent = q.deposit_pct >= 100
          ? 'Paid in full at booking.'
          : q.deposit_pct + '% deposit now, ' + q.balance_display + ' due 60 days before departure.';
        if (!q.fits) {
          el.submit.disabled = true;
          flash('Only ' + q.seats_free + ' seat' + (q.seats_free === 1 ? '' : 's') + ' left on that date.');
        }
      })
      .catch(function () {
        el.qNote.textContent = 'Could not refresh the price just now — it will be confirmed at checkout.';
      });
  }

  // ------------------------------------------------------------------- events

  el.grid.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button.cal__cell');
    if (!btn) return;
    var dep = findById(Number(btn.dataset.depId));
    if (!dep) return;
    state.selectedId = dep.id;
    state.seats = Math.max(1, Math.min(state.seats, dep.seats_free));
    flash(null);
    showSlot(dep);
  });

  el.prev.addEventListener('click', function () {
    if (state.monthIndex > 0) { state.monthIndex--; render(); }
  });
  el.next.addEventListener('click', function () {
    if (state.monthIndex < state.months.length - 1) { state.monthIndex++; render(); }
  });

  el.seatUp.addEventListener('click', function () {
    var dep = findById(state.selectedId);
    if (!dep) return;
    state.seats++;
    syncSeatControls(dep);
    requestQuote(dep);
  });
  el.seatDown.addEventListener('click', function () {
    var dep = findById(state.selectedId);
    if (!dep) return;
    state.seats--;
    syncSeatControls(dep);
    requestQuote(dep);
  });

  /**
   * One last read before the POST. A traveller who left the tab open for an
   * hour should be told the seat is gone here, not after filling in a card.
   */
  el.form.addEventListener('submit', function (ev) {
    if (!state.selectedId) { ev.preventDefault(); return; }
    if (el.form.dataset.verified === '1') return; // second pass, let it through

    ev.preventDefault();
    el.submit.disabled = true;
    el.submit.textContent = 'Checking seats…';

    fetch('/api/departures/' + state.selectedId, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var dep = data.departure;
        if (!dep || !dep.bookable || dep.seats_free < state.seats) {
          el.submit.disabled = false;
          el.submit.textContent = 'Hold these seats';
          return load().then(function () {
            flash(dep && dep.seats_free > 0
              ? 'Only ' + dep.seats_free + ' seat' + (dep.seats_free === 1 ? '' : 's') + ' left on that date now.'
              : 'That departure sold out just now. Nothing has been charged.');
          });
        }
        el.form.dataset.verified = '1';
        el.form.submit();
      })
      .catch(function () {
        // If the check itself fails, let the server decide — it re-validates
        // inside the hold transaction anyway.
        el.form.dataset.verified = '1';
        el.form.submit();
      });
  });

  // --------------------------------------------------------------- lifecycle

  el.form.appendChild(depInput);

  var fallbackSelect = el.fallback.querySelector('select');
  if (fallbackSelect) fallbackSelect.remove();
  el.fallback.hidden = true;
  el.calendar.hidden = false;

  showSlot(null);
  load({ initial: true });

  setInterval(function () { load(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') load();
  });
})();
