'use strict';

const crypto = require('crypto');

/**
 * Payment gateway boundary.
 *
 * The booking flow never talks to a gateway directly — it calls
 * `gateway.charge()` and reads `{ captured, reference, state }`. Swapping the
 * demo gateway for Stripe / Razorpay / PayPal means adding one adapter below
 * and changing PAYMENT_GATEWAY; no booking code moves.
 *
 * The demo gateway does NOT touch a real card network and cannot take real
 * money. It is a stand-in so the booking flow can be clicked end to end.
 */

const DEMO_CARDS = {
  '4242424242424242': { outcome: 'captured' },
  '4000000000000002': { outcome: 'declined', message: 'Your card was declined by the issuer.' },
  '4000000000009995': { outcome: 'declined', message: 'Insufficient funds.' },
  '4000000000000119': { outcome: 'error', message: 'A processing error occurred. Please try again.' },
};

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

/** Luhn check — catches a mistyped number before it ever leaves the server. */
function luhnValid(number) {
  const d = digitsOnly(number);
  if (d.length < 12 || d.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

function expiryValid(month, year, clock = new Date()) {
  const m = Number(month);
  let y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (!Number.isInteger(y)) return false;
  if (y < 100) y += 2000;
  const endOfMonth = new Date(Date.UTC(y, m, 1) - 1);
  return endOfMonth >= clock;
}

class PaymentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const demoGateway = {
  id: 'demo',
  label: 'Demo gateway (no real money moves)',
  /**
   * @param {{amount_minor:number, currency:string, card:object, reference:string}} req
   * @returns {{captured:boolean, reference:string, state:string}}
   */
  charge(req) {
    const card = req.card || {};
    const number = digitsOnly(card.number);

    if (!luhnValid(number)) {
      throw new PaymentError('card_number_invalid', 'That card number is not valid.');
    }
    if (!expiryValid(card.exp_month, card.exp_year)) {
      throw new PaymentError('card_expired', 'That expiry date has passed or is not valid.');
    }
    if (!/^\d{3,4}$/.test(String(card.cvc || ''))) {
      throw new PaymentError('cvc_invalid', 'The security code should be 3 or 4 digits.');
    }
    if (!Number.isInteger(req.amount_minor) || req.amount_minor <= 0) {
      throw new PaymentError('amount_invalid', 'Nothing to charge.');
    }

    const scripted = DEMO_CARDS[number];
    if (scripted && scripted.outcome !== 'captured') {
      throw new PaymentError(
        scripted.outcome === 'declined' ? 'card_declined' : 'gateway_error',
        scripted.message
      );
    }

    return {
      captured: true,
      reference: `demo_${crypto.randomBytes(9).toString('hex')}`,
      state: 'captured',
      last4: number.slice(-4),
    };
  },
};

/**
 * Stripe adapter — the shape a live integration takes. Deliberately left
 * unimplemented rather than half-implemented: it throws loudly instead of
 * silently pretending to have charged someone.
 *
 * To go live:
 *   1. npm i stripe, set STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
 *   2. create a PaymentIntent server-side for `quote.amount_due_now_minor`
 *   3. confirm it in the browser with Stripe Elements (card data never
 *      reaches this server — that is what keeps the site out of PCI scope)
 *   4. confirm the booking from the payment_intent.succeeded webhook, not
 *      from the browser redirect, so a closed tab cannot lose a paid booking
 */
const stripeGateway = {
  id: 'stripe',
  label: 'Stripe',
  charge() {
    throw new PaymentError(
      'gateway_not_configured',
      'The Stripe gateway is not wired up yet. See lib/payments.js.'
    );
  },
};

const gateways = { demo: demoGateway, stripe: stripeGateway };

function gateway() {
  const id = process.env.PAYMENT_GATEWAY || 'demo';
  const g = gateways[id];
  if (!g) throw new PaymentError('gateway_unknown', `Unknown payment gateway: ${id}`);
  return g;
}

module.exports = { gateway, gateways, PaymentError, luhnValid, expiryValid, DEMO_CARDS };
