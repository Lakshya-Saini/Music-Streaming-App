/**
 * Metadata + cover-art theme for each locally downloaded WAV master. Keyed
 * by the exact file name so the upload script never has to invent a title
 * from a generic file name like "sample-1.wav".
 */

const THEMES = {
  'velvet-horizon': {
    bg: { hex: '0x0d0b1c', rgb: [13, 11, 28] },
    orb: { cx: 1080, cy: 430, r: 330, centerColor: [255, 120, 230], edgeColor: [80, 30, 120] },
    band: { compare: 'gt', slope: -0.55, intercept: 1750, color: [30, 130, 160] },
    seed: 101,
  },
  'paper-moons': {
    bg: { hex: '0x1c1420', rgb: [28, 20, 32] },
    orb: { cx: 430, cy: 1080, r: 360, centerColor: [255, 210, 155], edgeColor: [170, 80, 115] },
    band: { compare: 'lt', slope: 0.6, intercept: -350, color: [110, 65, 125] },
    seed: 202,
  },
  'sweetest-static': {
    bg: { hex: '0x1a120c', rgb: [26, 18, 12] },
    orb: { cx: 1120, cy: 1080, r: 380, centerColor: [255, 195, 135], edgeColor: [185, 85, 55] },
    band: { compare: 'lt', slope: -0.5, intercept: 520, color: [110, 55, 42] },
    seed: 303,
  },
};

const KNOWN_TRACKS = {
  'sample-1.wav': {
    title: 'Velvet Horizon',
    artist: 'Nova Ember',
    album: 'Velvet Horizon',
    genre: 'Electronic',
    releaseYear: 2025,
    trackNumber: 1,
    language: 'en',
    theme: THEMES['velvet-horizon'],
  },
  'sample-3.wav': {
    title: 'Paper Moons',
    artist: 'Juniper Fields',
    album: 'Paper Moons',
    genre: 'Indie',
    releaseYear: 2024,
    trackNumber: 1,
    language: 'en',
    theme: THEMES['paper-moons'],
  },
  'Sweet Sweetest Love (Mastered with Clear Sky at 50pct).wav': {
    title: 'Sweetest Static',
    artist: 'Coral Wren',
    album: 'Sweetest Static',
    genre: 'Acoustic',
    releaseYear: 2026,
    trackNumber: 1,
    language: 'en',
    theme: THEMES['sweetest-static'],
  },
};

const ADJECTIVES = ['Hollow', 'Amber', 'Quiet', 'Distant', 'Faded', 'Golden', 'Slow', 'Wild'];
const NOUNS = ['Radio', 'Harbor', 'Static', 'Meadow', 'Signal', 'Orbit', 'Ember', 'Tide'];
const ARTIST_FIRST = ['Nova', 'Juniper', 'Coral', 'Sable', 'Wren', 'Isla', 'Rune', 'Marlow'];
const ARTIST_LAST = ['Ember', 'Fields', 'Wren', 'Hollow', 'Vane', 'Rowe', 'Ash', 'Reed'];
const GENRES = ['Electronic', 'Indie', 'Acoustic', 'Pop', 'Alternative'];
const THEME_POOL = Object.values(THEMES);

// Simple deterministic string hash so re-running the script against the same
// unmatched file name always yields the same generated name and cover.
function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function themeForUnknownFile(fileName) {
  const hash = hashString(fileName);
  const title = `${ADJECTIVES[hash % ADJECTIVES.length]} ${NOUNS[(hash >> 3) % NOUNS.length]}`;
  const artist = `${ARTIST_FIRST[(hash >> 5) % ARTIST_FIRST.length]} ${ARTIST_LAST[(hash >> 7) % ARTIST_LAST.length]}`;
  return {
    title,
    artist,
    album: title,
    genre: GENRES[(hash >> 9) % GENRES.length],
    releaseYear: 2024 + (hash % 3),
    trackNumber: 1,
    language: 'en',
    theme: THEME_POOL[hash % THEME_POOL.length],
  };
}

module.exports = { KNOWN_TRACKS, themeForUnknownFile };
