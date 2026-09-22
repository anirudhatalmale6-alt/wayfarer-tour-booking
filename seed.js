'use strict';

/**
 * Demo catalogue. Nine tours across the three categories in the brief
 * (adventure / city / luxury), each with real departures for the next eight
 * months so the availability calendar has something to say.
 *
 * Seat counts are seeded from a fixed PRNG so the demo always shows the same
 * mix of available / last-seats / sold-out departures. Replace this file with
 * the client's real catalogue — nothing else in the app reads it.
 */

const { db } = require('./db');

function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20260922);

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

const TOURS = [
  {
    slug: 'annapurna-ridgeline-trek',
    title: 'Annapurna Ridgeline Trek',
    category: 'adventure',
    destination: 'Annapurna Sanctuary',
    country: 'Nepal',
    duration_days: 12,
    difficulty: 'Strenuous',
    plate: 'ridgeline.svg',
    base_price: 189000,
    deposit_pct: 30,
    summary:
      'Twelve days on the high trail to the Sanctuary, with teahouse nights, a certified mountain guide and an acclimatisation schedule built to be walked, not endured.',
    description:
      'We follow the classic approach through Ghandruk and Chhomrong before the long climb into the Sanctuary itself — an amphitheatre of eight-thousanders that opens all at once, without warning, on the final morning. Groups are capped at twelve so the teahouses can actually feed us, and the itinerary carries two spare days: one for weather, one for altitude. Porters carry 15kg each, which is the ethical limit, not the legal one.',
    highlights: [
      'Sunrise over Annapurna South from Machhapuchhre Base Camp',
      'Two built-in contingency days for weather and acclimatisation',
      'Teahouse nights in Ghandruk, Chhomrong and Deurali',
      'Group capped at 12 walkers with one guide per six',
    ],
    itinerary: [
      { day: '1', title: 'Pokhara', body: 'Arrive, kit check, briefing over dal bhat by the lake.' },
      { day: '2-3', title: 'Nayapul to Ghandruk', body: 'Stone stairways through Gurung villages; first views of Machhapuchhre.' },
      { day: '4-6', title: 'Chhomrong to Deurali', body: 'Into the bamboo corridor, then above the treeline as the valley narrows.' },
      { day: '7', title: 'The Sanctuary', body: 'Dawn walk to Annapurna Base Camp at 4,130m. Rest afternoon.' },
      { day: '8-10', title: 'Descent via Jhinu', body: 'Long downhill and the hot springs at Jhinu Danda.' },
      { day: '11-12', title: 'Pokhara and onward', body: 'Buffer day, debrief, farewell dinner.' },
    ],
    included: ['Certified guide and porters', 'All teahouse accommodation', 'Breakfast and dinner daily', 'ACAP and TIMS permits', 'Pokhara airport transfers'],
    excluded: ['International flights', 'Travel insurance (mandatory)', 'Lunches on trail', 'Tips'],
  },
  {
    slug: 'wadi-rum-desert-crossing',
    title: 'Wadi Rum Desert Crossing',
    category: 'adventure',
    destination: 'Wadi Rum',
    country: 'Jordan',
    duration_days: 7,
    difficulty: 'Moderate',
    plate: 'dunes.svg',
    base_price: 142000,
    deposit_pct: 30,
    summary:
      'Seven days crossing the sandstone corridors of Wadi Rum on foot and by camel, camping with Bedouin hosts who have guided this ground for four generations.',
    description:
      'The route runs south from Disi through the siq systems to Burdah rock bridge, then out across the open sand to Jebel Umm Adaami on the Saudi border. We walk in the mornings and the late afternoons and sit out the middle of the day under an awning, because that is how this desert is actually crossed. Nights are in black goat-hair tents with the sides open.',
    highlights: [
      'Scramble to the Burdah rock bridge, 80m above the valley floor',
      'Summit Jebel Umm Adaami, the highest point in Jordan',
      'Three nights with Bedouin hosts in open-sided camps',
      'A full day and night in Petra on the way out',
    ],
    itinerary: [
      { day: '1', title: 'Amman to Disi', body: 'Transfer south, meet the camel team, first night under canvas.' },
      { day: '2-3', title: 'The siq systems', body: 'Narrow canyons, Nabataean inscriptions, a long dune crossing.' },
      { day: '4', title: 'Burdah', body: 'Scramble to the rock bridge. Exposed but unroped-friendly.' },
      { day: '5', title: 'Umm Adaami', body: 'Dawn summit, 1,854m, with Saudi Arabia laid out to the south.' },
      { day: '6-7', title: 'Petra', body: 'Out through the desert, then the Siq at first light.' },
    ],
    included: ['Bedouin guides and camel support', 'All camping equipment', 'All meals in the desert', 'Petra entry', '4WD transfers'],
    excluded: ['Flights to Amman', 'Insurance', 'Meals in Petra', 'Visa on arrival'],
  },
  {
    slug: 'lofoten-sea-kayak-and-aurora',
    title: 'Lofoten Sea Kayak & Aurora',
    category: 'adventure',
    destination: 'Lofoten Islands',
    country: 'Norway',
    duration_days: 8,
    difficulty: 'Moderate',
    plate: 'aurora.svg',
    base_price: 236000,
    deposit_pct: 30,
    summary:
      'Paddling the sheltered sounds of Lofoten in the dark half of the year, when the aurora is out and the fishing villages have their harbours back.',
    description:
      'Eight days working the water between Reine, Hamnøy and Nusfjord in stable double kayaks, with a dry-suit each and a guide who holds a BCU 4-star. We are on the water four to five hours a day and off it before the light goes. The aurora is not a booking guarantee and we will never sell it as one — but late September to March puts the odds properly in your favour, and the forecast is checked nightly.',
    highlights: [
      'Dry-suit paddling in the sheltered Reinefjorden system',
      'Rorbuer (fishermen’s cabin) accommodation on the water',
      'Nightly aurora watch with a KP forecast briefing',
      'No kayak experience required — day one is a skills day',
    ],
    itinerary: [
      { day: '1', title: 'Svolvær', body: 'Arrive, kit issue, dry-suit fitting and a flatwater skills session.' },
      { day: '2-4', title: 'Reinefjorden', body: 'Three days of protected-water paddling under the Reinebringen wall.' },
      { day: '5-6', title: 'Nusfjord and Hamnøy', body: 'Village-to-village crossings; stockfish racks and a sauna.' },
      { day: '7-8', title: 'Weather day and departure', body: 'A held day for wind, then transfer to Svolvær.' },
    ],
    included: ['Kayaks, dry suits and all safety kit', 'BCU-qualified guides', 'Rorbuer accommodation', 'Breakfast and packed lunch', 'Aurora forecasting'],
    excluded: ['Flights', 'Dinners', 'Insurance', 'Alcohol'],
  },
  {
    slug: 'kyoto-machiya-and-mountains',
    title: 'Kyoto: Machiya & Mountains',
    category: 'city',
    destination: 'Kyoto',
    country: 'Japan',
    duration_days: 6,
    difficulty: 'Easy',
    plate: 'temple.svg',
    base_price: 168000,
    deposit_pct: 50,
    summary:
      'Six days in Kyoto at the pace the city actually rewards — early temple hours, a knife-maker’s workshop, and two days out in the hills at Kurama and Ohara.',
    description:
      'We stay in a restored machiya townhouse in Nishijin rather than a hotel tower, which changes the whole shape of the day: you walk out into a working neighbourhood instead of a lobby. Mornings start before the coach parties reach Fushimi Inari or the moss gardens. Two of the six days leave the city entirely, for the cedar trail over Kurama to Kibune and the terraced temples at Ohara.',
    highlights: [
      'Four nights in a restored machiya in Nishijin',
      'Fushimi Inari before 6am, ahead of the crowds',
      'Half-day with a third-generation knife maker in Sakai-style forging',
      'The Kurama-to-Kibune cedar trail and an onsen at the far end',
    ],
    itinerary: [
      { day: '1', title: 'Arrive Kyoto', body: 'Machiya check-in, neighbourhood walk, kaiseki welcome dinner.' },
      { day: '2', title: 'East mountains', body: 'Fushimi Inari at dawn, then Tofuku-ji and the Philosopher’s Path.' },
      { day: '3', title: 'Craft day', body: 'Knife forging workshop, then Nishiki market with a chef.' },
      { day: '4', title: 'Kurama to Kibune', body: 'Cedar-root trail over the pass; onsen and river dining.' },
      { day: '5', title: 'Ohara', body: 'Sanzen-in and the terraced gardens, back for an evening in Pontocho.' },
      { day: '6', title: 'Departure', body: 'Free morning, transfer to Kansai or Tokyo.' },
    ],
    included: ['Machiya accommodation', 'All internal transport and IC card', 'Three guided days', 'Workshop fees and temple entries', 'Welcome kaiseki'],
    excluded: ['International flights', 'Most lunches and dinners', 'Insurance'],
  },
  {
    slug: 'lisbon-tiles-and-tascas',
    title: 'Lisbon: Tiles & Tascas',
    category: 'city',
    destination: 'Lisbon',
    country: 'Portugal',
    duration_days: 4,
    difficulty: 'Easy',
    plate: 'metropolis.svg',
    base_price: 78000,
    deposit_pct: 50,
    summary:
      'A long weekend in Lisbon built around azulejo workshops, unfashionable tascas and one afternoon in Sintra, guided by people who live in Alfama rather than sell it.',
    description:
      'Four days, nothing before nine, and the list of restaurants is short because it only includes places our guides eat at with their own families. You will paint and fire your own azulejo tile at a studio in Graça, drink vinho verde standing up at a counter in Mouraria, and spend one afternoon among the follies at Sintra with a return ticket booked around the queue rather than into it.',
    highlights: [
      'Hand-paint and fire your own azulejo tile to take home',
      'Tasca crawl through Mouraria and Graça with a local guide',
      'Sintra with timed entries booked around the coach schedule',
      'A fado night in a 30-seat room, not a tourist theatre',
    ],
    itinerary: [
      { day: '1', title: 'Alfama', body: 'Arrive, walking orientation through Alfama, fado in the evening.' },
      { day: '2', title: 'Azulejo day', body: 'Tile museum, then a painting and firing workshop in Graça.' },
      { day: '3', title: 'Sintra', body: 'Pena and Quinta da Regaleira with timed entry; back for a tasca dinner.' },
      { day: '4', title: 'Market and out', body: 'Time Out market breakfast, free morning, departure.' },
    ],
    included: ['Central boutique hotel, 3 nights', 'All guided days', 'Tile workshop and firing', 'Sintra transport and entries', 'Fado tickets'],
    excluded: ['Flights', 'Two dinners', 'Insurance'],
  },
  {
    slug: 'mexico-city-modern-and-ancient',
    title: 'Mexico City: Modern & Ancient',
    category: 'city',
    destination: 'Mexico City',
    country: 'Mexico',
    duration_days: 5,
    difficulty: 'Easy',
    plate: 'highland.svg',
    base_price: 104000,
    deposit_pct: 50,
    summary:
      'Five days across CDMX: Teotihuacán at opening, Barragán’s houses by appointment, and a mercado breakfast that ruins hotel buffets for good.',
    description:
      'The city is enormous and most itineraries lose two days to traffic. Ours does not: we base in Roma Norte, move by metro and on foot where it is faster, and use a driver only for Teotihuacán and Xochimilco. Booked-ahead entries include the Casa Luis Barragán, which takes appointments weeks out and turns people away daily.',
    highlights: [
      'Teotihuacán at the 8am opening, ahead of the buses',
      'Casa Luis Barragán by pre-booked appointment',
      'Mercado de Medellín breakfast with a cook',
      'Lucha libre at Arena México, seats in the second tier',
    ],
    itinerary: [
      { day: '1', title: 'Roma Norte', body: 'Arrive, walk Roma and Condesa, tacos al pastor to finish.' },
      { day: '2', title: 'Centro Histórico', body: 'Templo Mayor, the Rivera murals, and a cantina lunch.' },
      { day: '3', title: 'Teotihuacán', body: 'Early departure, Avenue of the Dead, back by mid-afternoon.' },
      { day: '4', title: 'Barragán and Coyoacán', body: 'Architecture morning, Frida Kahlo museum, market dinner.' },
      { day: '5', title: 'Xochimilco', body: 'Trajinera on the canals, then airport transfer.' },
    ],
    included: ['Roma Norte hotel, 4 nights', 'All guided days', 'Teotihuacán and Barragán entries', 'Metro card', 'Lucha libre tickets'],
    excluded: ['Flights', 'Several meals', 'Insurance', 'Tips'],
  },
  {
    slug: 'maldives-atoll-private-charter',
    title: 'Maldives Atoll Private Charter',
    category: 'luxury',
    destination: 'Baa & Raa Atolls',
    country: 'Maldives',
    duration_days: 9,
    difficulty: 'Easy',
    plate: 'atoll.svg',
    base_price: 1240000,
    deposit_pct: 25,
    summary:
      'Nine nights on a 32m charter through Baa and Raa, with a marine biologist aboard, a dive deck, and an itinerary set each morning by where the mantas actually are.',
    description:
      'A private charter rather than a resort, because the reef you want is rarely off the jetty of the hotel you booked. The vessel carries eight guests in four cabins, a tender for dives and one for surf, and a resident marine biologist who logs manta sightings for the Hanifaru research programme. Full board, open bar, and no fixed route: the captain repositions overnight on the previous day’s sightings.',
    highlights: [
      '32m charter, four cabins, eight guests maximum',
      'Resident marine biologist and manta ID logging',
      'Hanifaru Bay snorkelling permit included in season',
      'Two tenders — one rigged for diving, one for surf breaks',
    ],
    itinerary: [
      { day: '1', title: 'Malé', body: 'Seaplane to the vessel, cabin settle-in, sunset departure north.' },
      { day: '2-4', title: 'Baa Atoll', body: 'Hanifaru in season, night dives, uninhabited-island beach setup.' },
      { day: '5-6', title: 'Raa Atoll', body: 'Outer-reef diving and a village visit at Ugoofaaru.' },
      { day: '7-8', title: 'Repositioning south', body: 'Route set by sightings; surf tender out at dawn.' },
      { day: '9', title: 'Malé', body: 'Morning dive, then seaplane transfer out.' },
    ],
    included: ['Whole-vessel charter', 'All meals and open bar', 'Up to 3 dives daily with tanks and weights', 'Marine biologist and dive master', 'Seaplane transfers'],
    excluded: ['International flights', 'Dive certification courses', 'Spa treatments', 'Insurance'],
  },
  {
    slug: 'douro-vineyard-quinta-retreat',
    title: 'Douro Vineyard Quinta Retreat',
    category: 'luxury',
    destination: 'Douro Valley',
    country: 'Portugal',
    duration_days: 6,
    difficulty: 'Easy',
    plate: 'vineyard.svg',
    base_price: 468000,
    deposit_pct: 25,
    summary:
      'Six nights in a working quinta above the Douro, with cellar access, a Michelin-starred kitchen at the table and a private boat on the river.',
    description:
      'The estate has been making port since 1878 and the vineyard is terraced in schist so steep it is still worked by hand. Guests take the manor house — eight rooms — with the cellar master hosting vertical tastings back to the 1960s. Lunches are outdoors under the pergola, dinners are cooked by a chef who holds a star in Porto and comes upriver for the season.',
    highlights: [
      'Exclusive use of an eight-room 19th-century manor house',
      'Vertical port tasting back to the 1963 vintage with the cellar master',
      'Private boat on the Douro with a picnic at Pinhão',
      'Harvest foot-treading in the lagares, late September only',
    ],
    itinerary: [
      { day: '1', title: 'Porto to the quinta', body: 'Private transfer upriver, terrace welcome, cellar walk.' },
      { day: '2', title: 'The vineyard', body: 'Morning in the terraces with the viticulturist, long lunch after.' },
      { day: '3', title: 'The river', body: 'Private boat to Pinhão and back, picnic on board.' },
      { day: '4', title: 'Tasting day', body: 'Vertical tasting, blending session, dinner in the old cellar.' },
      { day: '5', title: 'Free day', body: 'Walk the schist terraces, spa, or a trip to Lamego.' },
      { day: '6', title: 'Departure', body: 'Breakfast on the terrace, transfer to Porto.' },
    ],
    included: ['Whole-house exclusivity', 'All meals and estate wines', 'Cellar master sessions', 'Private boat day', 'Porto transfers'],
    excluded: ['Flights', 'Rare-vintage purchases', 'Insurance', 'Spa treatments'],
  },
  {
    slug: 'patagonia-fjords-expedition-suite',
    title: 'Patagonia Fjords Expedition',
    category: 'luxury',
    destination: 'Tierra del Fuego',
    country: 'Chile',
    duration_days: 10,
    difficulty: 'Moderate',
    plate: 'fjord.svg',
    base_price: 892000,
    deposit_pct: 25,
    summary:
      'Ten days through the Chilean fjords aboard a 24-berth expedition vessel, with zodiac landings at glacier faces and a suite with a window you will not want to sleep through.',
    description:
      'From Punta Arenas through the Strait of Magellan to Cape Horn and back up the Beagle Channel, in a purpose-built ice-strengthened vessel carrying twenty-four guests. Two expedition leaders, a glaciologist and a bird specialist run daily zodiac operations to Pia and Garibaldi glaciers and the Wulaia Bay landing where Darwin came ashore. Weather governs the route and the crew will say so plainly.',
    highlights: [
      'Zodiac landings at the Pia and Garibaldi glacier faces',
      'Cape Horn landing, weather permitting — roughly 6 days in 10',
      'Glaciologist and ornithologist aboard for the full crossing',
      'Twenty-four guests maximum, all exterior suites',
    ],
    itinerary: [
      { day: '1', title: 'Punta Arenas', body: 'Board in the afternoon, safety drill, sail into the Strait.' },
      { day: '2-3', title: 'Ainsworth and Tucker', body: 'Marinelli glacier, elephant seals, a Magellanic penguin colony.' },
      { day: '4-5', title: 'Pia and Garibaldi', body: 'Two glacier faces by zodiac, plus a hike into the Nothofagus forest.' },
      { day: '6-7', title: 'Cape Horn and Wulaia', body: 'Landing attempt at the Horn, then the Wulaia Bay walk.' },
      { day: '8-9', title: 'Beagle Channel', body: 'North through Glacier Alley with the expedition team on deck.' },
      { day: '10', title: 'Ushuaia', body: 'Disembark after breakfast.' },
    ],
    included: ['Exterior suite accommodation', 'All meals and bar', 'All zodiac excursions', 'Expedition team and lectures', 'Parkas and boot hire'],
    excluded: ['Flights to Punta Arenas', 'Chilean park fees', 'Insurance (mandatory)', 'Laundry'],
  },
];

// Departure cadence per category: adventure runs in blocks, city runs weekly,
// luxury runs rarely and sells out early.
const CADENCE = {
  adventure: { every: 10, count: 16, capacity: [12, 14, 16] },
  city: { every: 7, count: 24, capacity: [10, 12, 16, 18] },
  luxury: { every: 30, count: 7, capacity: [8, 8, 10, 24] },
};

const insertTour = db.prepare(`
  INSERT INTO tours (slug, title, category, destination, country, duration_days,
                     difficulty, summary, description, highlights, itinerary,
                     included, excluded, plate, base_price, currency, deposit_pct)
  VALUES (@slug, @title, @category, @destination, @country, @duration_days,
          @difficulty, @summary, @description, @highlights, @itinerary,
          @included, @excluded, @plate, @base_price, 'USD', @deposit_pct)
`);

const insertDeparture = db.prepare(`
  INSERT INTO departures (tour_id, depart_on, return_on, capacity, seats_booked, price, status)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const seed = db.transaction(() => {
  db.exec('DELETE FROM travellers; DELETE FROM bookings; DELETE FROM holds; DELETE FROM departures; DELETE FROM tours; DELETE FROM events;');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('tours','departures','bookings','travellers','events')");

  for (const t of TOURS) {
    const info = insertTour.run({
      ...t,
      highlights: JSON.stringify(t.highlights),
      itinerary: JSON.stringify(t.itinerary),
      included: JSON.stringify(t.included),
      excluded: JSON.stringify(t.excluded),
    });
    const tourId = info.lastInsertRowid;
    const cad = CADENCE[t.category];

    // First departure sits a little way out so the "too soon to book" cutoff
    // is visible in the calendar on the very first dates.
    let offset = 3 + Math.floor(rand() * 6);

    for (let i = 0; i < cad.count; i++) {
      const departOn = addDays(TODAY, offset);
      const returnOn = addDays(departOn, t.duration_days - 1);
      const capacity = cad.capacity[Math.floor(rand() * cad.capacity.length)];

      // Nearer departures are fuller — that is how real inventory behaves.
      const pressure = Math.max(0, 1 - i / cad.count);
      const fillRatio = Math.min(1, pressure * (0.55 + rand() * 0.75));
      let booked = Math.round(capacity * fillRatio);
      if (rand() > 0.88) booked = capacity;              // an outright sell-out
      if (rand() > 0.9) booked = Math.max(0, capacity - 1); // a genuine last seat
      booked = Math.min(capacity, Math.max(0, booked));

      // Shoulder-season departures carry a discount; peak ones a premium.
      const month = Number(departOn.slice(5, 7));
      const peak = [6, 7, 8, 12].includes(month);
      const price = peak
        ? Math.round((t.base_price * 1.12) / 100) * 100
        : rand() > 0.7
          ? Math.round((t.base_price * 0.92) / 100) * 100
          : t.base_price;

      const status = rand() > 0.96 ? 'closed' : 'open';

      insertDeparture.run(tourId, departOn, returnOn, capacity, booked, price, status);
      offset += cad.every + Math.floor(rand() * 3) - 1;
    }
  }
});

seed();

const counts = {
  tours: db.prepare('SELECT COUNT(*) c FROM tours').get().c,
  departures: db.prepare('SELECT COUNT(*) c FROM departures').get().c,
  sold_out: db.prepare('SELECT COUNT(*) c FROM departures WHERE seats_booked >= capacity').get().c,
  last_seats: db.prepare('SELECT COUNT(*) c FROM departures WHERE capacity - seats_booked BETWEEN 1 AND 3').get().c,
};
process.stdout.write(
  `Seeded ${counts.tours} tours, ${counts.departures} departures ` +
  `(${counts.sold_out} sold out, ${counts.last_seats} on last seats)\n`
);
