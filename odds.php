<?php
/* ============================================================
   WC26 Bracket Lab — betting-odds proxy (Funio docroot)
   Same-origin passthrough so the static front-end can read live
   1X2 (home/draw/away) match odds with no CORS and no key exposed
   to the browser.

   Source: the-odds-api.com (free tier: 500 requests/month).
   >>> Paste your key below (or set the ODDS_API_KEY env var). <<<
   Until a key is set this returns {"error":"no key"} and the app
   falls back to the Elo model for Market / Blend modes.

   Written PHP 5.2-safe (Funio runs 5.2.17).
   ============================================================ */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

// Key resolution (never committed to git): env var first, then an untracked
// sibling odds.key.php that simply `return`s the key string.
$KEY = getenv('ODDS_API_KEY');
if ($KEY === false || $KEY === '') {
  $keyFile = dirname(__FILE__) . '/odds.key.php';
  if (is_file($keyFile)) {
    $k = include $keyFile;
    if (is_string($k)) { $KEY = $k; }
  }
}
if ($KEY === false || $KEY === '') {
  echo json_encode(array('error' => 'no key'));
  exit;
}

// ?market=winner -> outright tournament-winner futures; default -> match 1X2
$market = isset($_GET['market']) ? preg_replace('/[^a-z]/', '', $_GET['market']) : 'h2h';
if ($market === 'winner') {
  $sport = 'soccer_fifa_world_cup_winner';
  $mkt = 'outrights';
  $tag = 'winner';
} else {
  $sport = 'soccer_fifa_world_cup';
  $mkt = 'h2h';
  $tag = 'h2h';
}

// cache for 10 minutes — odds move slowly and the free tier is small
$cacheFile = sys_get_temp_dir() . '/wc_odds_' . $tag . '.json';
if (is_file($cacheFile) && (time() - filemtime($cacheFile) < 600)) {
  readfile($cacheFile);
  exit;
}

if (!function_exists('curl_init')) {
  header('HTTP/1.1 500 Internal Server Error');
  echo json_encode(array('error' => 'PHP curl extension not available on this host.'));
  exit;
}

$url = 'https://api.the-odds-api.com/v4/sports/' . $sport . '/odds/'
     . '?apiKey=' . urlencode($KEY)
     . '&regions=eu,uk&markets=' . $mkt . '&oddsFormat=decimal';

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, array('User-Agent: Mozilla/5.0 (compatible; WC26BracketLab/1.0)', 'Accept: application/json'));
curl_setopt($ch, CURLOPT_TIMEOUT, 15);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
$body = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($code !== 200 || $body === false || strlen($body) === 0) {
  header('HTTP/1.1 502 Bad Gateway');
  echo json_encode(array('error' => 'odds upstream failed', 'status' => $code));
  exit;
}

@file_put_contents($cacheFile, $body);
echo $body;
