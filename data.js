/* ============================================================
   WC26 BRACKET LAB — tournament data
   Sources: FIFA final draw (Dec 5, 2025) + March 2026 playoff
   results (Bosnia, Sweden, Türkiye, Czechia, DR Congo, Iraq).
   Ratings: World Football Elo (eloratings.net), June 2026 — a
   stronger match predictor than the FIFA ranking. Expected score
   uses the standard Elo 400-point logistic; goals are sampled
   from a Dixon-Coles-corrected bivariate Poisson (see engine.js).
   ============================================================ */

'use strict';

const TEAMS = {
  // Group A
  MEX: { id: 'MEX', name: 'Mexico',        code: 'MEX', flag: '🇲🇽', elo: 1896 },
  KOR: { id: 'KOR', name: 'South Korea',   code: 'KOR', flag: '🇰🇷', elo: 1771 },
  RSA: { id: 'RSA', name: 'South Africa',  code: 'RSA', flag: '🇿🇦', elo: 1527 },
  CZE: { id: 'CZE', name: 'Czechia',       code: 'CZE', flag: '🇨🇿', elo: 1696 },
  // Group B
  CAN: { id: 'CAN', name: 'Canada',        code: 'CAN', flag: '🇨🇦', elo: 1777 },
  SUI: { id: 'SUI', name: 'Switzerland',   code: 'SUI', flag: '🇨🇭', elo: 1885 },
  QAT: { id: 'QAT', name: 'Qatar',         code: 'QAT', flag: '🇶🇦', elo: 1437 },
  BIH: { id: 'BIH', name: 'Bosnia & Herz.',code: 'BIH', flag: '🇧🇦', elo: 1596 },
  // Group C
  BRA: { id: 'BRA', name: 'Brazil',        code: 'BRA', flag: '🇧🇷', elo: 1986 },
  MAR: { id: 'MAR', name: 'Morocco',       code: 'MAR', flag: '🇲🇦', elo: 1866 },
  SCO: { id: 'SCO', name: 'Scotland',      code: 'SCO', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', elo: 1768 },
  HAI: { id: 'HAI', name: 'Haiti',         code: 'HAI', flag: '🇭🇹', elo: 1528 },
  // Group D
  USA: { id: 'USA', name: 'United States', code: 'USA', flag: '🇺🇸', elo: 1820 },
  AUS: { id: 'AUS', name: 'Australia',     code: 'AUS', flag: '🇦🇺', elo: 1799 },
  PAR: { id: 'PAR', name: 'Paraguay',      code: 'PAR', flag: '🇵🇾', elo: 1816 },
  TUR: { id: 'TUR', name: 'Türkiye',       code: 'TUR', flag: '🇹🇷', elo: 1813 },
  // Group E
  GER: { id: 'GER', name: 'Germany',       code: 'GER', flag: '🇩🇪', elo: 1954 },
  ECU: { id: 'ECU', name: 'Ecuador',       code: 'ECU', flag: '🇪🇨', elo: 1864 },
  CIV: { id: 'CIV', name: "Côte d'Ivoire", code: 'CIV', flag: '🇨🇮', elo: 1728 },
  CUW: { id: 'CUW', name: 'Curaçao',       code: 'CUW', flag: '🇨🇼', elo: 1453 },
  // Group F
  NED: { id: 'NED', name: 'Netherlands',   code: 'NED', flag: '🇳🇱', elo: 1972 },
  JPN: { id: 'JPN', name: 'Japan',         code: 'JPN', flag: '🇯🇵', elo: 1925 },
  TUN: { id: 'TUN', name: 'Tunisia',       code: 'TUN', flag: '🇹🇳', elo: 1570 },
  SWE: { id: 'SWE', name: 'Sweden',        code: 'SWE', flag: '🇸🇪', elo: 1727 },
  // Group G
  BEL: { id: 'BEL', name: 'Belgium',       code: 'BEL', flag: '🇧🇪', elo: 1869 },
  IRN: { id: 'IRN', name: 'Iran',          code: 'IRN', flag: '🇮🇷', elo: 1766 },
  EGY: { id: 'EGY', name: 'Egypt',         code: 'EGY', flag: '🇪🇬', elo: 1740 },
  NZL: { id: 'NZL', name: 'New Zealand',   code: 'NZL', flag: '🇳🇿', elo: 1549 },
  // Group H
  ESP: { id: 'ESP', name: 'Spain',         code: 'ESP', flag: '🇪🇸', elo: 2134 },
  URU: { id: 'URU', name: 'Uruguay',       code: 'URU', flag: '🇺🇾', elo: 1851 },
  KSA: { id: 'KSA', name: 'Saudi Arabia',  code: 'KSA', flag: '🇸🇦', elo: 1593 },
  CPV: { id: 'CPV', name: 'Cape Verde',    code: 'CPV', flag: '🇨🇻', elo: 1625 },
  // Group I
  FRA: { id: 'FRA', name: 'France',        code: 'FRA', flag: '🇫🇷', elo: 2090 },
  SEN: { id: 'SEN', name: 'Senegal',       code: 'SEN', flag: '🇸🇳', elo: 1817 },
  NOR: { id: 'NOR', name: 'Norway',        code: 'NOR', flag: '🇳🇴', elo: 1951 },
  IRQ: { id: 'IRQ', name: 'Iraq',          code: 'IRQ', flag: '🇮🇶', elo: 1586 },
  // Group J
  ARG: { id: 'ARG', name: 'Argentina',     code: 'ARG', flag: '🇦🇷', elo: 2144 },
  AUT: { id: 'AUT', name: 'Austria',       code: 'AUT', flag: '🇦🇹', elo: 1841 },
  ALG: { id: 'ALG', name: 'Algeria',       code: 'ALG', flag: '🇩🇿', elo: 1780 },
  JOR: { id: 'JOR', name: 'Jordan',        code: 'JOR', flag: '🇯🇴', elo: 1632 },
  // Group K
  POR: { id: 'POR', name: 'Portugal',      code: 'POR', flag: '🇵🇹', elo: 1967 },
  COL: { id: 'COL', name: 'Colombia',      code: 'COL', flag: '🇨🇴', elo: 1998 },
  UZB: { id: 'UZB', name: 'Uzbekistan',    code: 'UZB', flag: '🇺🇿', elo: 1698 },
  COD: { id: 'COD', name: 'DR Congo',      code: 'COD', flag: '🇨🇩', elo: 1674 },
  // Group L
  ENG: { id: 'ENG', name: 'England',       code: 'ENG', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', elo: 2055 },
  CRO: { id: 'CRO', name: 'Croatia',       code: 'CRO', flag: '🇭🇷', elo: 1881 },
  PAN: { id: 'PAN', name: 'Panama',        code: 'PAN', flag: '🇵🇦', elo: 1683 },
  GHA: { id: 'GHA', name: 'Ghana',         code: 'GHA', flag: '🇬🇭', elo: 1557 },
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

const WC_DATA = { TEAMS, GROUPS, BRACKET };
