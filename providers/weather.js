'use strict';

const { fetchJson } = require('../lib/fetch');

// Open-Meteo needs no API key, which keeps first-run setup to just a location.
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

// WMO 4677 weather codes, collapsed to what's readable in a one-line slot.
const WMO = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'thunderstorms with hail',
};

function parseHhMm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, min };
}

/** Minutes until the next occurrence of a wall-clock time, in local time. */
function minutesUntil(hhmm, now) {
  const t = parseHhMm(hhmm);
  if (!t) return null;
  const target = new Date(now);
  target.setHours(t.h, t.min, 0, 0);
  let diff = (target - now) / 60000;
  if (diff < -60) diff += 24 * 60; // already passed today; roll to tomorrow
  return diff;
}

async function collect(cfg, ctx) {
  const { latitude, longitude } = cfg;
  if (latitude == null || longitude == null) return { tips: [], status: [] };

  const tempUnit = cfg.units === 'celsius' ? 'celsius' : 'fahrenheit';
  const url = `${ENDPOINT}?latitude=${encodeURIComponent(latitude)}`
    + `&longitude=${encodeURIComponent(longitude)}`
    + '&current=temperature_2m,apparent_temperature,precipitation,weather_code'
    + '&hourly=precipitation_probability,temperature_2m'
    + `&forecast_days=1&temperature_unit=${tempUnit}&wind_speed_unit=mph&timezone=auto`;

  const data = await fetchJson(url, { timeoutMs: 6000 });
  const cur = data.current || {};
  const deg = tempUnit === 'celsius' ? '°C' : '°F';
  const cond = WMO[cur.weather_code] ?? 'unclear skies';
  const temp = Math.round(cur.temperature_2m);
  const feels = Math.round(cur.apparent_temperature);

  let line = `${temp}${deg} ${cond}`;
  if (Math.abs(feels - temp) >= 4) line += ` (feels ${feels}${deg})`;

  // Rain probability over the next few hours, for the "do I need a jacket" call.
  const probs = (data.hourly && data.hourly.precipitation_probability) || [];
  const nextFew = probs.slice(0, 4).filter((p) => typeof p === 'number');
  const peak = nextFew.length ? Math.max(...nextFew) : 0;
  if (peak >= 40) line += ` · ${peak}% rain within 4h`;

  const now = ctx.now || new Date();
  const untilLeave = minutesUntil(cfg.leaveForWorkAt, now);
  const promoteWindow = cfg.promoteMinutesBefore ?? 60;

  const status = [];
  const tips = [];

  // The whole point of the weather provider: surface it when it can still
  // change a decision, not as ambient noise all day.
  if (untilLeave !== null && untilLeave >= 0 && untilLeave <= promoteWindow) {
    const mins = Math.round(untilLeave);
    status.push({
      text: `Leaving in ${mins}m · ${line}`,
      priority: 100,
      source: 'weather',
    });
  } else {
    status.push({ text: line, priority: 10, source: 'weather' });
  }

  if (peak >= 60) {
    tips.push({ text: `Weather — ${peak}% chance of rain in the next few hours.`, source: 'weather' });
  }

  return { tips, status };
}

module.exports = { name: 'weather', collect, _minutesUntil: minutesUntil };
