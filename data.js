/* ============================================================
   WC26 BRACKET LAB — tournament data
   Sources: FIFA final draw (Dec 5, 2025) + March 2026 playoff
   results (Bosnia, Sweden, Türkiye, Czechia, DR Congo, Iraq).
   Ratings: World Football Elo (eloratings.net), refreshed 30 Jun 2026
   (post-group-stage). A stronger match predictor than the FIFA ranking.
   Expected score uses the standard Elo 400-point logistic; goals are sampled
   from a Dixon-Coles-corrected bivariate Poisson (see engine.js). Played
   matches are conditioned on real results, so these ratings drive the
   remaining (knockout) projections.
   ============================================================ */

'use strict';

const TEAMS = {
  // Group A
  MEX: { id: 'MEX', name: 'Mexico',        code: 'MEX', flag: '🇲🇽', elo: 1943 },
  KOR: { id: 'KOR', name: 'South Korea',   code: 'KOR', flag: '🇰🇷', elo: 1723 },
  RSA: { id: 'RSA', name: 'South Africa',  code: 'RSA', flag: '🇿🇦', elo: 1559 },
  CZE: { id: 'CZE', name: 'Czechia',       code: 'CZE', flag: '🇨🇿', elo: 1680 },
  // Group B
  CAN: { id: 'CAN', name: 'Canada',        code: 'CAN', flag: '🇨🇦', elo: 1764 },
  SUI: { id: 'SUI', name: 'Switzerland',   code: 'SUI', flag: '🇨🇭', elo: 1914 },
  QAT: { id: 'QAT', name: 'Qatar',         code: 'QAT', flag: '🇶🇦', elo: 1411 },
  BIH: { id: 'BIH', name: 'Bosnia & Herz.',code: 'BIH', flag: '🇧🇦', elo: 1622 },
  // Group C
  BRA: { id: 'BRA', name: 'Brazil',        code: 'BRA', flag: '🇧🇷', elo: 2031 },
  MAR: { id: 'MAR', name: 'Morocco',       code: 'MAR', flag: '🇲🇦', elo: 1886 },
  SCO: { id: 'SCO', name: 'Scotland',      code: 'SCO', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', elo: 1745 },
  HAI: { id: 'HAI', name: 'Haiti',         code: 'HAI', flag: '🇭🇹', elo: 1517 },
  // Group D
  USA: { id: 'USA', name: 'United States', code: 'USA', flag: '🇺🇸', elo: 1781 },
  AUS: { id: 'AUS', name: 'Australia',     code: 'AUS', flag: '🇦🇺', elo: 1800 },
  PAR: { id: 'PAR', name: 'Paraguay',      code: 'PAR', flag: '🇵🇾', elo: 1823 },
  TUR: { id: 'TUR', name: 'Türkiye',       code: 'TUR', flag: '🇹🇷', elo: 1852 },
  // Group E
  GER: { id: 'GER', name: 'Germany',       code: 'GER', flag: '🇩🇪', elo: 1908 },
  ECU: { id: 'ECU', name: 'Ecuador',       code: 'ECU', flag: '🇪🇨', elo: 1871 },
  CIV: { id: 'CIV', name: "Côte d'Ivoire", code: 'CIV', flag: '🇨🇮', elo: 1727 },
  CUW: { id: 'CUW', name: 'Curaçao',       code: 'CUW', flag: '🇨🇼', elo: 1438 },
  // Group F
  NED: { id: 'NED', name: 'Netherlands',   code: 'NED', flag: '🇳🇱', elo: 1971 },
  JPN: { id: 'JPN', name: 'Japan',         code: 'JPN', flag: '🇯🇵', elo: 1888 },
  TUN: { id: 'TUN', name: 'Tunisia',       code: 'TUN', flag: '🇹🇳', elo: 1562 },
  SWE: { id: 'SWE', name: 'Sweden',        code: 'SWE', flag: '🇸🇪', elo: 1731 },
  // Group G
  BEL: { id: 'BEL', name: 'Belgium',       code: 'BEL', flag: '🇧🇪', elo: 1884 },
  IRN: { id: 'IRN', name: 'Iran',          code: 'IRN', flag: '🇮🇷', elo: 1764 },
  EGY: { id: 'EGY', name: 'Egypt',         code: 'EGY', flag: '🇪🇬', elo: 1742 },
  NZL: { id: 'NZL', name: 'New Zealand',   code: 'NZL', flag: '🇳🇿', elo: 1534 },
  // Group H
  ESP: { id: 'ESP', name: 'Spain',         code: 'ESP', flag: '🇪🇸', elo: 2144 },
  URU: { id: 'URU', name: 'Uruguay',       code: 'URU', flag: '🇺🇾', elo: 1841 },
  KSA: { id: 'KSA', name: 'Saudi Arabia',  code: 'KSA', flag: '🇸🇦', elo: 1596 },
  CPV: { id: 'CPV', name: 'Cape Verde',    code: 'CPV', flag: '🇨🇻', elo: 1622 },
  // Group I
  FRA: { id: 'FRA', name: 'France',        code: 'FRA', flag: '🇫🇷', elo: 2134 },
  SEN: { id: 'SEN', name: 'Senegal',       code: 'SEN', flag: '🇸🇳', elo: 1842 },
  NOR: { id: 'NOR', name: 'Norway',        code: 'NOR', flag: '🇳🇴', elo: 1934 },
  IRQ: { id: 'IRQ', name: 'Iraq',          code: 'IRQ', flag: '🇮🇶', elo: 1561 },
  // Group J
  ARG: { id: 'ARG', name: 'Argentina',     code: 'ARG', flag: '🇦🇷', elo: 2148 },
  AUT: { id: 'AUT', name: 'Austria',       code: 'AUT', flag: '🇦🇹', elo: 1836 },
  ALG: { id: 'ALG', name: 'Algeria',       code: 'ALG', flag: '🇩🇿', elo: 1785 },
  JOR: { id: 'JOR', name: 'Jordan',        code: 'JOR', flag: '🇯🇴', elo: 1628 },
  // Group K
  POR: { id: 'POR', name: 'Portugal',      code: 'POR', flag: '🇵🇹', elo: 1990 },
  COL: { id: 'COL', name: 'Colombia',      code: 'COL', flag: '🇨🇴', elo: 2004 },
  UZB: { id: 'UZB', name: 'Uzbekistan',    code: 'UZB', flag: '🇺🇿', elo: 1631 },
  COD: { id: 'COD', name: 'DR Congo',      code: 'COD', flag: '🇨🇩', elo: 1712 },
  // Group L
  ENG: { id: 'ENG', name: 'England',       code: 'ENG', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', elo: 2038 },
  CRO: { id: 'CRO', name: 'Croatia',       code: 'CRO', flag: '🇭🇷', elo: 1905 },
  PAN: { id: 'PAN', name: 'Panama',        code: 'PAN', flag: '🇵🇦', elo: 1658 },
  GHA: { id: 'GHA', name: 'Ghana',         code: 'GHA', flag: '🇬🇭', elo: 1575 },
};

const GROUPS = {
  A: ['MEX', 'KOR', 'RSA', 'CZE'],
  B: ['CAN', 'SUI', 'QAT', 'BIH'],
  C: ['BRA', 'MAR', 'SCO', 'HAI'],
  D: ['USA', 'AUS', 'PAR', 'TUR'],
  E: ['GER', 'ECU', 'CIV', 'CUW'],
  F: ['NED', 'JPN', 'TUN', 'SWE'],
  G: ['BEL', 'IRN', 'EGY', 'NZL'],
  H: ['ESP', 'URU', 'KSA', 'CPV'],
  I: ['FRA', 'SEN', 'NOR', 'IRQ'],
  J: ['ARG', 'AUT', 'ALG', 'JOR'],
  K: ['POR', 'COL', 'UZB', 'COD'],
  L: ['ENG', 'CRO', 'PAN', 'GHA'],
};

// Official FIFA match schedule, matches 73-104.
// W:<g> = group winner, RU:<g> = runner-up, T:<match> = allocated third,
// M:<n> = winner of match n, L:<n> = loser of match n.
const BRACKET = {
  r32: [
    { match: '73', home: 'RU:A', away: 'RU:B' },
    { match: '74', home: 'W:E',  away: 'T:74' },
    { match: '75', home: 'W:F',  away: 'RU:C' },
    { match: '76', home: 'W:C',  away: 'RU:F' },
    { match: '77', home: 'W:I',  away: 'T:77' },
    { match: '78', home: 'RU:E', away: 'RU:I' },
    { match: '79', home: 'W:A',  away: 'T:79' },
    { match: '80', home: 'W:L',  away: 'T:80' },
    { match: '81', home: 'W:D',  away: 'T:81' },
    { match: '82', home: 'W:G',  away: 'T:82' },
    { match: '83', home: 'RU:K', away: 'RU:L' },
    { match: '84', home: 'W:H',  away: 'RU:J' },
    { match: '85', home: 'W:B',  away: 'T:85' },
    { match: '86', home: 'W:J',  away: 'RU:H' },
    { match: '87', home: 'W:K',  away: 'T:87' },
    { match: '88', home: 'RU:D', away: 'RU:G' },
  ],
  thirdSlots: [
    { match: '74', allowed: ['A', 'B', 'C', 'D', 'F'] },
    { match: '77', allowed: ['C', 'D', 'F', 'G', 'H'] },
    { match: '79', allowed: ['C', 'E', 'F', 'H', 'I'] },
    { match: '80', allowed: ['E', 'H', 'I', 'J', 'K'] },
    { match: '81', allowed: ['B', 'E', 'F', 'I', 'J'] },
    { match: '82', allowed: ['A', 'E', 'H', 'I', 'J'] },
    { match: '85', allowed: ['E', 'F', 'G', 'I', 'J'] },
    { match: '87', allowed: ['D', 'E', 'I', 'J', 'L'] },
  ],
  r16: [
    { match: '89', home: 'M:74', away: 'M:77' },
    { match: '90', home: 'M:73', away: 'M:75' },
    { match: '91', home: 'M:76', away: 'M:78' },
    { match: '92', home: 'M:79', away: 'M:80' },
    { match: '93', home: 'M:83', away: 'M:84' },
    { match: '94', home: 'M:81', away: 'M:82' },
    { match: '95', home: 'M:86', away: 'M:88' },
    { match: '96', home: 'M:85', away: 'M:87' },
  ],
  qf: [
    { match: '97',  home: 'M:89', away: 'M:90' },
    { match: '98',  home: 'M:93', away: 'M:94' },
    { match: '99',  home: 'M:91', away: 'M:92' },
    { match: '100', home: 'M:95', away: 'M:96' },
  ],
  sf: [
    { match: '101', home: 'M:97', away: 'M:98' },
    { match: '102', home: 'M:99', away: 'M:100' },
  ],
  third: [
    { match: '103', home: 'L:101', away: 'L:102' },
  ],
  final: [
    { match: '104', home: 'M:101', away: 'M:102' },
  ],
};

// Bracket halves for the wallchart layout (final in the centre).
const BRACKET_LAYOUT = {
  left:  { r32: ['74', '77', '73', '75', '83', '84', '81', '82'],
           r16: ['89', '90', '93', '94'], qf: ['97', '98'], sf: ['101'] },
  right: { r32: ['76', '78', '79', '80', '86', '88', '85', '87'],
           r16: ['91', '92', '95', '96'], qf: ['99', '100'], sf: ['102'] },
};

// Knockout match dates (FIFA published schedule). Group-stage dates come
// from the live feed (every fixture carries its date); these are the fixed
// knockout dates by match number so they always show.
const MATCH_DATES_KO = {
  '73': '2026-06-28', '74': '2026-06-29', '75': '2026-06-29', '76': '2026-06-29',
  '77': '2026-06-30', '78': '2026-06-30', '79': '2026-06-30', '80': '2026-07-01',
  '81': '2026-07-01', '82': '2026-07-01', '83': '2026-07-02', '84': '2026-07-02',
  '85': '2026-07-02', '86': '2026-07-03', '87': '2026-07-03', '88': '2026-07-03',
  '89': '2026-07-04', '90': '2026-07-04', '91': '2026-07-05', '92': '2026-07-05',
  '93': '2026-07-06', '94': '2026-07-06', '95': '2026-07-07', '96': '2026-07-07',
  '97': '2026-07-09', '98': '2026-07-10', '99': '2026-07-11', '100': '2026-07-11',
  '101': '2026-07-14', '102': '2026-07-15', '103': '2026-07-18', '104': '2026-07-19',
};

// Knockout host cities by match number (FIFA schedule). Live feed venues
// override / fill these (matches 73 & 102 come from the feed).
const MATCH_VENUES_KO = {
  '74': 'Foxborough', '75': 'Guadalajara', '76': 'Houston', '77': 'East Rutherford',
  '78': 'Arlington', '79': 'Mexico City', '80': 'Atlanta', '81': 'Santa Clara',
  '82': 'Seattle', '83': 'Toronto', '84': 'Inglewood', '85': 'Vancouver',
  '86': 'Miami Gardens', '87': 'Kansas City', '88': 'Arlington',
  '89': 'Philadelphia', '90': 'Houston', '91': 'East Rutherford', '92': 'Mexico City',
  '93': 'Arlington', '94': 'Seattle', '95': 'Atlanta', '96': 'Vancouver',
  '97': 'Foxborough', '98': 'Inglewood', '99': 'Miami Gardens', '100': 'Kansas City',
  '101': 'Arlington', '103': 'Miami Gardens', '104': 'East Rutherford',
};

const WC_DATA = { TEAMS, GROUPS, BRACKET };
