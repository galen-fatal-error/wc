<?php
/* ============================================================
   WC26 Bracket Lab — live data proxy (Funio docroot)
   Same-origin passthrough to football-data.org so the static
   front-end can read live World Cup data without CORS or
   exposing the API token.

   Setup on the server (token is NOT in the repo):
     mkdir -p ~/wc-app/secret
     printf '%s' 'YOUR_FOOTBALL_DATA_ORG_TOKEN' > ~/wc-app/secret/fd_token
     chmod 600 ~/wc-app/secret/fd_token

   Get a free token at https://www.football-data.org/client/register
   The World Cup competition code is "WC".
   ============================================================ */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

$comp = isset($_GET['comp']) ? preg_replace('/[^A-Za-z0-9]/', '', $_GET['comp']) : 'WC';

$tokenFile = __DIR__ . '/../secret/fd_token';
if (!is_readable($tokenFile)) {
  http_response_code(503);
  echo json_encode(['error' => 'No API token configured on the server. Create ~/wc-app/secret/fd_token with a football-data.org token (see live.php header).']);
  exit;
}
$token = trim((string)file_get_contents($tokenFile));

// brief server-side cache to respect the free-tier rate limit
$cacheFile = sys_get_temp_dir() . "/wc_live_{$comp}.json";
if (is_file($cacheFile) && (time() - filemtime($cacheFile) < 15)) {
  readfile($cacheFile);
  exit;
}

$ch = curl_init("https://api.football-data.org/v4/competitions/{$comp}/matches");
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER     => ["X-Auth-Token: {$token}"],
  CURLOPT_TIMEOUT        => 12,
]);
$body = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($body === false || $code >= 400) {
  http_response_code($code ?: 502);
  echo json_encode(['error' => "upstream {$code}", 'detail' => $err ?: substr((string)$body, 0, 300)]);
  exit;
}

@file_put_contents($cacheFile, $body);
echo $body;
