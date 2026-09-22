/* Wayfarer — checkout: hold countdown and light client-side validation.
 *
 * The countdown is display only. The hold expiry that matters lives in the
 * database and is re-checked inside the booking transaction, so a traveller
 * with a frozen tab or a fiddled clock cannot talk their way past it.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------- countdown

  var box = document.querySelector('[data-countdown]');
  if (box) {
    var clock = box.querySelector('[data-countdown-clock]');
    var expires = new Date(box.dataset.expires).getTime();

    var tick = function () {
      var left = Math.max(0, expires - Date.now());
      var mins = Math.floor(left / 60000);
      var secs = Math.floor((left % 60000) / 1000);
      clock.textContent = mins + ':' + (secs < 10 ? '0' + secs : secs);

      box.classList.toggle('is-urgent', left > 0 && left <= 180000);

      if (left === 0) {
        box.classList.remove('is-urgent');
        box.classList.add('is-dead');
        box.firstElementChild.textContent = 'Hold expired';
        clock.textContent = '0:00';
        var pay = document.querySelector('[data-pay]');
        if (pay) {
          pay.disabled = true;
          pay.textContent = 'Seats released';
        }
        var note = document.createElement('div');
        note.className = 'notice notice--warn';
        note.innerHTML = '<span class="notice__i">!</span><p></p>';
        note.querySelector('p').textContent =
          'Your hold has expired and the seats went back to the pool. Nothing was charged — pick your dates again to restart.';
        box.parentNode.insertBefore(note, box.nextSibling);
        clearInterval(timer);
      }
    };

    var timer = setInterval(tick, 1000);
    tick();
  }

  // ------------------------------------------------------------ validation

  var form = document.querySelector('[data-checkout]');
  if (!form) return;

  var rules = {
    lead_name: function (v) { return v.trim().length >= 2 || 'Please give the full name.'; },
    lead_email: function (v) {
      return /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(v.trim()) || 'That does not look like an email address.';
    },
    card_number: function (v) {
      var d = v.replace(/\D/g, '');
      return (d.length >= 12 && luhn(d)) || 'Check the card number.';
    },
    card_exp_month: function (v) {
      var m = Number(v);
      return (m >= 1 && m <= 12) || 'Month must be 1 to 12.';
    },
    card_exp_year: function (v) {
      var y = Number(v);
      if (y < 100) y += 2000;
      return (y >= new Date().getFullYear() && y < 2100) || 'Check the expiry year.';
    },
    card_cvc: function (v) { return /^\d{3,4}$/.test(v.trim()) || '3 or 4 digits.'; },
  };

  function luhn(d) {
    var sum = 0;
    var dbl = false;
    for (var i = d.length - 1; i >= 0; i--) {
      var n = Number(d[i]);
      if (dbl) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }

  function showError(field, message) {
    field.classList.toggle('is-bad', !!message);
    var holder = field.parentNode;
    var msg = holder.querySelector('[data-err]');
    if (!message) {
      if (msg) msg.remove();
      field.removeAttribute('aria-invalid');
      return;
    }
    field.setAttribute('aria-invalid', 'true');
    if (!msg) {
      msg = document.createElement('p');
      msg.className = 'hint';
      msg.style.color = 'var(--clay)';
      msg.setAttribute('data-err', '');
      holder.appendChild(msg);
    }
    msg.textContent = message;
  }

  // Card number grouping as you type — purely a readability aid.
  var card = form.querySelector('#card_number');
  if (card) {
    card.addEventListener('input', function () {
      var digits = card.value.replace(/\D/g, '').slice(0, 19);
      card.value = digits.replace(/(.{4})/g, '$1 ').trim();
    });
  }

  Object.keys(rules).forEach(function (name) {
    var field = form.querySelector('[name="' + name + '"]');
    if (!field) return;
    field.addEventListener('blur', function () {
      if (!field.value.trim()) return showError(field, null);
      var result = rules[name](field.value);
      showError(field, result === true ? null : result);
    });
  });

  form.addEventListener('submit', function (ev) {
    var firstBad = null;
    Object.keys(rules).forEach(function (name) {
      var field = form.querySelector('[name="' + name + '"]');
      if (!field) return;
      var result = rules[name](field.value);
      showError(field, result === true ? null : result);
      if (result !== true && !firstBad) firstBad = field;
    });

    if (firstBad) {
      ev.preventDefault();
      firstBad.focus();
      firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    // Stop a double-submit from creating two charge attempts on one hold.
    var pay = form.querySelector('[data-pay]');
    if (pay) {
      pay.disabled = true;
      pay.textContent = 'Confirming…';
      // If the server answers with a validation error, the page reloads and
      // the button comes back enabled. This is only for the in-flight window.
    }
  });
})();
