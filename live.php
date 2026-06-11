<?php
/* ============================================================
   WC26 Bracket Lab — live data proxy (Funio docroot)
   Same-origin passthrough so the static front-end can read
   live World Cup data with no CORS and no API key.

   Primary  : official FIFA public API (api.fifa.com/api/v3) —
              free, no key, true live status/minute/score.
   Fallback : worldcup26.ir/get/games (open-source WC API).

   Output is wrapped so the client knows which source answered:
     {"source":"fifa"|"wc26ir","data": <raw upstream JSON>}

   Written PHP 5.2-safe (Funio runs 5.2.17): array(), header()
   status lines, no null-coalescing.
   ============================================================ */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

$src = isset($_GET['src']) ? preg_replace('/[^a-z0-9]/', '', $_GET['src']) : 'auto';

// brief server-side cache (live scores update on a delay anyway)
$cacheFile = sys_get_temp_dir() . '/wc_live_' . $src . '.json';
if (is_file($cacheFile) && (time() - filemtime($cacheFile) < 15)) {
  readfile($cacheFile);
  exit;
}

if (!function_exists('curl_init')) {
  header('HTTP/1.1 500 Internal Server Error');
  echo json_encode(array('error' => 'PHP curl extension not available on this host.'));
  exit;
}

function wc_fetch($url) {
  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, array('User-Agent: Mozilla/5.0 (compatible; WC26BracketLab/1.0)', 'Accept: application/json'));
  curl_setopt($ch, CURLOPT_TIMEOUT, 15);
  curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
  curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
  $body = curl_exec($ch);
  $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return array($body, $code);
}

$FIFA = 'https://api.fifa.com/api/v3/calendar/matches?idCompetition=17&idSeason=285023&count=500&language=en';
$WC26 = 'https://worldcup26.ir/get/games';

$out = null;
$source = null;

if ($src === 'wc26ir') {
  $r = wc_fetch($WC26);
  if ($r[1] < 400 && $r[0] !== false && strlen($r[0]) > 0) { $out = $r[0]; $source = 'wc26ir'; }
} else {
  // auto / fifa: try FIFA first
  $r = wc_fetch($FIFA);
  if ($r[1] === 200 && $r[0] !== false && strpos($r[0], '"Results"') !== false) { $out = $r[0]; $source = 'fifa'; }
  // auto: fall back to worldcup26.ir if FIFA failed
  if ($out === null && $src !== 'fifa') {
    $r2 = wc_fetch($WC26);
    if ($r2[1] < 400 && $r2[0] !== false && strlen($r2[0]) > 0) { $out = $r2[0]; $source = 'wc26ir'; }
  }
}

if ($out === null) {
  header('HTTP/1.1 502 Bad Gateway');
  echo json_encode(array('error' => 'all upstreams failed (api.fifa.com, worldcup26.ir)'));
  exit;
}

// splice the raw upstream JSON into a source-tagged envelope (no decode)
$wrapped = '{"source":"' . $source . '","data":' . $out . '}';
@file_put_contents($cacheFile, $wrapped);
echo $wrapped;
