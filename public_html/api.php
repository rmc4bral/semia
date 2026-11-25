<?php
/**
 * SemIA · API de registro de silobolsas
 * PHP 7.4+ · almacenamiento en data.json con bloqueo de archivo
 */
declare(strict_types=1);

const DATA_FILE   = __DIR__ . '/data.json';
const SEED_FILE   = __DIR__ . '/data.seed.json'; // plantilla inicial (versionada en git)
const UPLOAD_DIR  = __DIR__ . '/uploads';
const MAX_PHOTO   = 4 * 1024 * 1024; // 4 MB
const MAX_BODY    = 40 * 1024 * 1024;
const MAX_MAP     = 25 * 1024 * 1024; // imagen de mapa ya reducida en el navegador

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: same-origin');

// Primera instalación: crear data.json desde la plantilla. Los despliegues nunca lo pisan.
if (!file_exists(DATA_FILE)) {
  if (!file_exists(SEED_FILE) || !copy(SEED_FILE, DATA_FILE)) { http_response_code(500); echo '{"ok":false,"error":"Falta data.json"}'; exit; }
}

ini_set('session.use_strict_mode', '1');
session_name('SEMIASESS');
session_set_cookie_params([
  'lifetime' => 60 * 60 * 24 * 30,
  'path' => '/',
  'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
  'httponly' => true,
  'samesite' => 'Lax',
]);
session_start();

function out(array $d, int $code = 200): void { http_response_code($code); echo json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit; }
function fail(string $msg, int $code = 400): void { out(['ok' => false, 'error' => $msg], $code); }

/* ---------- Datos con bloqueo ---------- */
function withData(callable $fn, bool $write = false) {
  $fh = fopen(DATA_FILE, 'c+');
  if (!$fh) fail('No se puede abrir data.json', 500);
  flock($fh, $write ? LOCK_EX : LOCK_SH);
  $raw = stream_get_contents($fh);
  $data = json_decode($raw ?: '{}', true);
  if (!is_array($data)) { flock($fh, LOCK_UN); fclose($fh); fail('data.json dañado', 500); }
  $res = $fn($data);
  if ($write) {
    $data['updatedAt'] = gmdate('c');
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    // respaldo diario
    $bk = __DIR__ . '/backups';
    if (is_dir($bk) || @mkdir($bk, 0755)) {
      $f = $bk . '/data-' . gmdate('Y-m-d') . '.json';
      if (!file_exists($f)) @file_put_contents($f, $raw);
    }
    ftruncate($fh, 0); rewind($fh); fwrite($fh, $json); fflush($fh);
  }
  flock($fh, LOCK_UN); fclose($fh);
  return $res;
}
function publicState(array $d): array {
  $d['users'] = array_map(fn($u) => ['user' => $u['user'], 'nombre' => $u['nombre'] ?? '', 'rol' => $u['rol'] ?? 'operador'], $d['users'] ?? []);
  return $d;
}
function me(): ?array { return $_SESSION['me'] ?? null; }
function requireUser(): array { $m = me(); if (!$m) fail('Sesión expirada. Ingresá nuevamente.', 401); return $m; }
function requireAdmin(): array { $m = requireUser(); if (($m['rol'] ?? '') !== 'admin') fail('Solo el administrador puede hacer esto', 403); return $m; }
function body(): array {
  $raw = file_get_contents('php://input', false, null, 0, MAX_BODY);
  $j = json_decode($raw ?: '[]', true);
  return is_array($j) ? $j : [];
}
function num($v): ?float { return is_numeric($v) ? (float)$v : null; }
function str($v, int $max = 500): string { return mb_substr(trim((string)($v ?? '')), 0, $max); }
function cleanCorners($c): array {
  if (!is_array($c) || count($c) !== 4) fail('Se requieren las 4 esquinas del mapa');
  $out = [];
  foreach ($c as $p) {
    if (!is_array($p) || count($p) !== 2 || num($p[0]) === null || num($p[1]) === null || abs($p[0]) > 90 || abs($p[1]) > 180) fail('Esquinas del mapa inválidas');
    $out[] = [round((float)$p[0], 7), round((float)$p[1], 7)];
  }
  return $out;
}
// Lote: número 1–99 (recibe silos) o nombre con letras (ej. «Casco», sin silos)
function lotCode($v) {
  if (is_int($v) || (is_string($v) && preg_match('/^\d{1,2}$/', trim($v)))) { $n = (int)$v; return $n >= 1 && $n <= 99 ? $n : null; }
  if (!is_string($v)) return null;
  $t = preg_replace('/\s+/u', ' ', trim($v));
  return preg_match('/^\p{L}[\p{L}0-9 .-]{0,15}$/u', $t) ? $t : null;
}
// Id único del lote: «k…:31» (estancia KML + número) o «31» (plano)
function lotIdOf(array $l): string { if (isset($l['id']) && $l['id'] !== '') return (string)$l['id']; return !empty($l['kml']) ? $l['kml'] . ':' . $l['num'] : (string)$l['num']; }
function findLotIdx(array $d, $id, $num = null): ?int {
  foreach ($d['lots'] as $i => $l) if ($id !== null && lotIdOf($l) === (string)$id) return $i;
  if ($num !== null) foreach ($d['lots'] as $i => $l) if ($l['num'] === $num) return $i;
  return null;
}
function siglaDeLote(array $d, array $lot): string {
  foreach (($d['georef']['kmls'] ?? []) as $k) if (($k['id'] ?? null) === ($lot['kml'] ?? '') && !empty($k['sigla'])) return $k['sigla'];
  return $d['estancia']['sigla'] ?? 'RB';
}
function lotCmp($a, $b) { $e = strcmp((string)($a['kml'] ?? ''), (string)($b['kml'] ?? '')); if ($e) return $e; $x = $a['num']; $y = $b['num']; if (is_int($x) && is_int($y)) return $x <=> $y; if (is_int($x)) return -1; if (is_int($y)) return 1; return strcasecmp($x, $y); }
function cleanFecha($f): ?string { return is_string($f) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $f) ? $f : null; }
function checkCsrf(): void {
  // Las escrituras deben ser JSON del mismo origen
  $ct = $_SERVER['CONTENT_TYPE'] ?? '';
  if (stripos($ct, 'application/json') !== 0) fail('Solicitud no válida', 400);
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  if ($origin && parse_url($origin, PHP_URL_HOST) !== ($_SERVER['HTTP_HOST'] ? explode(':', $_SERVER['HTTP_HOST'])[0] : '')) fail('Origen no permitido', 403);
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST') checkCsrf();

switch ($action) {
  case 'ping':
    out(['ok' => true, 'app' => 'semia', 'version' => 1]);

  case 'session':
    $m = me();
    if (!$m) out(['ok' => true, 'me' => null]);
    out(['ok' => true, 'me' => $m, 'state' => withData(fn($d) => publicState($d))]);

  case 'login': {
    if ($method !== 'POST') fail('Método no permitido', 405);
    $b = body();
    $user = strtolower(str($b['user'] ?? '', 40));
    $pass = (string)($b['pass'] ?? '');
    // freno a fuerza bruta por sesión
    $_SESSION['tries'] = ($_SESSION['tries'] ?? 0);
    if ($_SESSION['tries'] >= 8 && time() - ($_SESSION['lastTry'] ?? 0) < 300) fail('Demasiados intentos. Esperá 5 minutos.', 429);
    $found = withData(function ($d) use ($user) { foreach ($d['users'] ?? [] as $u) if ($u['user'] === $user) return $u; return null; });
    if (!$found || !password_verify($pass, $found['hash'] ?? '')) {
      $_SESSION['tries']++; $_SESSION['lastTry'] = time();
      usleep(400000);
      fail('Usuario o contraseña incorrectos', 401);
    }
    session_regenerate_id(true);
    $_SESSION['tries'] = 0;
    $_SESSION['me'] = ['user' => $found['user'], 'nombre' => $found['nombre'] ?? $found['user'], 'rol' => $found['rol'] ?? 'operador'];
    out(['ok' => true, 'me' => $_SESSION['me'], 'state' => withData(fn($d) => publicState($d))]);
  }

  case 'logout':
    $_SESSION = []; session_destroy();
    out(['ok' => true]);

  case 'state':
    requireUser();
    out(['ok' => true, 'state' => withData(fn($d) => publicState($d))]);

  case 'upload': {
    $me = requireUser();
    $b = body();
    $id = preg_replace('/[^A-Z0-9]/', '', strtoupper((string)($b['id'] ?? '')));
    if (!$id) fail('ID inválido');
    if (!preg_match('#^data:image/(jpeg|png|webp);base64,(.+)$#', (string)($b['data'] ?? ''), $m)) fail('Imagen no válida');
    $bin = base64_decode($m[2], true);
    if ($bin === false || strlen($bin) > MAX_PHOTO) fail('La imagen supera 4 MB');
    $info = @getimagesizefromstring($bin);
    if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP], true)) fail('Formato de imagen no permitido');
    if (!is_dir(UPLOAD_DIR) && !mkdir(UPLOAD_DIR, 0755, true)) fail('No se pudo crear la carpeta de fotos', 500);
    $ext = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp'][$info[2]];
    $name = $id . '-' . bin2hex(random_bytes(4)) . '.' . $ext;
    file_put_contents(UPLOAD_DIR . '/' . $name, $bin);
    out(['ok' => true, 'path' => 'uploads/' . $name]);
  }

  case 'saveSilo': {
    $me = requireUser();
    $b = body(); $s = $b['silo'] ?? null; $prev = isset($b['prevId']) && $b['prevId'] ? (string)$b['prevId'] : null;
    if (!is_array($s)) fail('Datos incompletos');
    $state = withData(function (&$d) use ($s, $prev, $me) {
      $li = findLotIdx($d, $s['lot'] ?? null, (int)($s['lote'] ?? 0));
      if ($li === null || !is_int($d['lots'][$li]['num'])) fail('Lote inexistente o sin silobolsas');
      $lotRec = $d['lots'][$li]; $lote = $lotRec['num']; $lotId = lotIdOf($lotRec);
      $sigla = siglaDeLote($d, $lotRec);
      // kg opcional (puede no conocerse al registrar la bolsa)
      $rawKg = $s['kg'] ?? null; $kg = ($rawKg === null || $rawKg === '') ? null : num($rawKg);
      if (($rawKg !== null && $rawKg !== '' && $kg === null) || ($kg !== null && $kg < 0)) fail('Kg inválido');
      $map = $s['map'] ?? null;
      if (!is_array($map) || count($map) !== 2 || num($map[0]) === null || num($map[1]) === null) fail('Ubicación inválida');
      $map2 = $s['map2'] ?? null;
      if ($map2 !== null && (!is_array($map2) || count($map2) !== 2 || num($map2[0]) === null || num($map2[1]) === null)) fail('Ubicación del fin de la bolsa inválida');
      if ($map2 !== null) $map2 = [round((float)$map2[0], 2), round((float)$map2[1], 2)];
      $gpsFix = fn($g) => is_array($g) ? ['lat' => num($g['lat'] ?? null), 'lng' => num($g['lng'] ?? null), 'acc' => num($g['acc'] ?? null), 'n' => (int)($g['n'] ?? 1), 'at' => str($g['at'] ?? '', 40)] : null;
      $idx = null;
      if ($prev !== null) { foreach ($d['silos'] as $i => $x) if ($x['id'] === $prev) $idx = $i; if ($idx === null) fail('El silo ya no existe', 404); }
      $isAdmin = ($me['rol'] ?? '') === 'admin';
      if ($idx !== null && !$isAdmin && ($d['silos'][$idx]['creadoPor'] ?? '') !== $me['user']) fail('Sin permiso para editar este silo', 403);
      if ($idx !== null && !$isAdmin) {
        $old = $d['silos'][$idx]['map'] ?? null;
        if ($old && (abs($old[0] - $map[0]) > 0.01 || abs($old[1] - $map[1]) > 0.01)) fail('Solo el administrador puede mover un silo', 403);
        $old2 = $d['silos'][$idx]['map2'] ?? null;
        if (($old2 === null) !== ($map2 === null) || ($old2 && (abs($old2[0] - $map2[0]) > 0.01 || abs($old2[1] - $map2[1]) > 0.01))) fail('Solo el administrador puede mover un silo', 403);
      }
      // ID: RB + lote(2) + bolsa(3), único
      $id = strtoupper((string)($s['id'] ?? ''));
      $taken = function ($id) use ($d, $prev) { foreach ($d['silos'] as $x) if ($x['id'] === $id && $x['id'] !== $prev) return true; return false; };
      $prefix = $sigla . str_pad((string)$lote, 2, '0', STR_PAD_LEFT);
      if (!preg_match('/^' . preg_quote($prefix, '/') . '\d{3}$/', $id) || $taken($id)) {
        $max = 0; foreach ($d['silos'] as $x) if (strpos($x['id'], $prefix) === 0 && $x['id'] !== $prev) $max = max($max, (int)substr($x['id'], -3));
        $id = $prefix . str_pad((string)($max + 1), 3, '0', STR_PAD_LEFT);
      }
      $foto = $s['foto'] ?? null;
      if ($foto !== null && !preg_match('#^uploads/[A-Z0-9]+-[a-f0-9]{8}\.(jpg|png|webp)$#', (string)$foto)) $foto = null;
      $rec = [
        'id' => $id, 'lote' => $lote, 'lot' => $lotId, 'kg' => $kg, 'grano' => str($s['grano'] ?? '', 30), 'obs' => str($s['obs'] ?? '', 1000), 'foto' => $foto,
        'map' => [round((float)$map[0], 2), round((float)$map[1], 2)], 't' => num($s['t'] ?? null), 'ang' => num($s['ang'] ?? null),
        'map2' => $map2,
        'latlng' => is_array($s['latlng'] ?? null) ? array_map('floatval', array_slice($s['latlng'], 0, 2)) : null,
        'latlng2' => $map2 && is_array($s['latlng2'] ?? null) ? array_map('floatval', array_slice($s['latlng2'], 0, 2)) : null,
        'largo' => $map2 && num($s['largo'] ?? null) !== null ? round(max(0, min(5000, (float)$s['largo'])), 1) : null,
        'gps' => $gpsFix($s['gps'] ?? null),
        'gps2' => $map2 ? $gpsFix($s['gps2'] ?? null) : null,
        'origen' => in_array($s['origen'] ?? '', ['gps', 'mapa'], true) ? $s['origen'] : 'mapa',
      ];
      if ($idx !== null) $d['silos'][$idx] = array_merge($d['silos'][$idx], $rec, ['editadoPor' => $me['user'], 'editadoEn' => gmdate('c')]);
      else $d['silos'][] = array_merge($rec, ['creadoPor' => $me['user'], 'creadoEn' => gmdate('c')]);
      return publicState($d);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  case 'deleteSilo': {
    requireAdmin(); $id = (string)(body()['id'] ?? '');
    $state = withData(function (&$d) use ($id) {
      foreach ($d['silos'] as $x) if ($x['id'] === $id && !empty($x['foto'])) @unlink(__DIR__ . '/' . $x['foto']);
      $d['silos'] = array_values(array_filter($d['silos'], fn($x) => $x['id'] !== $id));
      return publicState($d);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  case 'saveLot': {
    requireAdmin(); $l = body()['lot'] ?? null;
    if (!is_array($l)) fail('Datos incompletos');
    $state = withData(function (&$d) use ($l) {
      $num = lotCode($l['num'] ?? null); $ha = num($l['ha'] ?? null);
      if ($num === null || !$ha || $ha <= 0) fail('Número (1 a 99) o nombre, y hectáreas, requeridos');
      $idx = findLotIdx($d, $l['_origId'] ?? null, lotCode($l['_origNum'] ?? null));
      if ($idx === null) fail('Lote inexistente', 404);
      $old = $d['lots'][$idx]; $oldId = lotIdOf($old); $kml = $old['kml'] ?? null;
      $k = fn($v) => is_int($v) ? "n$v" : 's' . mb_strtolower((string)$v);
      foreach ($d['lots'] as $i => $x) if ($i !== $idx && ($x['kml'] ?? null) === $kml && $k($x['num']) === $k($num)) fail("Ya existe el lote $num en esa estancia");
      if ($k($num) !== $k($old['num'])) foreach ($d['silos'] as $s) if (($s['lot'] ?? null) === $oldId || (!isset($s['lot']) && $s['lote'] === $old['num'])) fail('El lote tiene silos: no se puede cambiar el número');
      $lot = &$d['lots'][$idx];
      $lot['num'] = $num; $lot['id'] = $kml ? "$kml:$num" : (string)$num; $lot['ha'] = $ha; $lot['nombre'] = str($l['nombre'] ?? '', 80); $lot['obs'] = str($l['obs'] ?? '', 1000);
      foreach ($lot['subs'] as $i => $sub) foreach (($l['subs'] ?? []) as $ns) if (($ns['id'] ?? '') === $sub['id'] && num($ns['ha'] ?? null) > 0) $lot['subs'][$i]['ha'] = num($ns['ha']);
      usort($d['lots'], 'lotCmp');
      return publicState($d);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  case 'saveGeoref': {
    requireAdmin(); $g = body()['georef'] ?? null;
    if (!is_array($g) || !is_array($g['points'] ?? null)) fail('Datos incompletos');
    if (count($g['points']) < 4 || count($g['points']) > 12) fail('Se requieren entre 4 y 12 puntos de control');
    $state = withData(function (&$d) use ($g) {
      $pts = []; $keys = [];
      foreach ($g['points'] as $p) {
        $lote = (int)($p['lote'] ?? 0); $vi = (int)($p['vi'] ?? -1); $lot = null;
        foreach ($d['lots'] as $l) if ((int)$l['num'] === $lote) $lot = $l;
        if (!$lot || $vi < 0 || $vi >= count($lot['poly'])) fail('Esquina de lote inválida');
        $key = "L{$lote}-{$vi}";
        if (isset($keys[$key])) fail('Hay dos puntos en la misma esquina'); $keys[$key] = 1;
        $lat = num($p['lat'] ?? null); $lng = num($p['lng'] ?? null);
        if (($lat !== null && abs($lat) > 90) || ($lng !== null && abs($lng) > 180)) fail('Coordenadas fuera de rango');
        $pts[] = ['key' => $key, 'lote' => $lote, 'vi' => $vi, 'label' => str($p['label'] ?? "Lote $lote", 60), 'map' => $lot['poly'][$vi],
          'lat' => $lat, 'lng' => $lng, 'acc' => num($p['acc'] ?? null), 'at' => str($p['at'] ?? '', 40) ?: null];
      }
      $d['georef'] = ['points' => $pts];
      return publicState($d);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  case 'saveShapes': {
    requireAdmin(); $c = body()['change'] ?? null;
    if (!is_array($c)) fail('Datos incompletos');
    $polyOk = function ($poly) {
      if (!is_array($poly) || count($poly) < 3 || count($poly) > 400) return false;
      foreach ($poly as $p) if (!is_array($p) || count($p) !== 2 || num($p[0]) === null || num($p[1]) === null || abs($p[0]) > 5000 || abs($p[1]) > 5000) return false;
      return true;
    };
    $clean = fn($poly) => array_map(fn($p) => [round((float)$p[0], 2), round((float)$p[1], 2)], $poly);
    $state = withData(function (&$d) use ($c, $polyOk, $clean) {
      foreach (($c['lots'] ?? []) as $nl) {
        if (!$polyOk($nl['poly'] ?? null)) fail('Forma de lote inválida');
        $idx = findLotIdx($d, $nl['id'] ?? null, $nl['num'] ?? null);
        if ($idx === null) fail('Lote inexistente');
        $l = &$d['lots'][$idx];
        if (!isset($l['poly0'])) $l['poly0'] = $l['poly'];
        $l['poly'] = $clean($nl['poly']);
        if (is_array($nl['label'] ?? null) && count($nl['label']) === 2) $l['label'] = $clean([$nl['label']])[0];
        foreach (($nl['subs'] ?? []) as $ns) foreach ($l['subs'] as $k => $sub) if ($sub['id'] === ($ns['id'] ?? null)) {
          if (!$polyOk($ns['poly'] ?? null)) fail('Forma de subdivisión inválida');
          if (!isset($l['subs'][$k]['poly0'])) $l['subs'][$k]['poly0'] = $sub['poly'];
          $l['subs'][$k]['poly'] = $clean($ns['poly']);
          if (is_array($ns['label'] ?? null) && count($ns['label']) === 2) $l['subs'][$k]['label'] = $clean([$ns['label']])[0];
        }
        unset($l);
      }
      if (isset($c['outline']) && $c['outline'] !== null) { if (!$polyOk($c['outline'])) fail('Contorno inválido'); $d['outline'] = $clean($c['outline']); }
      foreach (($c['silos'] ?? []) as $u) foreach ($d['silos'] as $k => $s) if ($s['id'] === ($u['id'] ?? null)) {
        if (!is_array($u['map'] ?? null) || count($u['map']) !== 2) fail('Ubicación de silo inválida');
        $d['silos'][$k]['map'] = $clean([$u['map']])[0]; $d['silos'][$k]['t'] = num($u['t'] ?? null); $d['silos'][$k]['ang'] = num($u['ang'] ?? null);
        $d['silos'][$k]['latlng'] = is_array($u['latlng'] ?? null) ? array_map('floatval', array_slice($u['latlng'], 0, 2)) : ($s['latlng'] ?? null);
      }
      // los puntos de control conservan su vértice aunque cambie la numeración
      foreach (($d['georef']['points'] ?? []) as $k => $p) {
        if (!isset($p['lote'], $p['map'])) continue;
        foreach ($d['lots'] as $l) if ((int)$l['num'] === (int)$p['lote'])
          foreach ($l['poly'] as $vi => $q) if (abs($q[0] - $p['map'][0]) < 0.6 && abs($q[1] - $p['map'][1]) < 0.6) { $d['georef']['points'][$k]['vi'] = $vi; $d['georef']['points'][$k]['key'] = "L{$p['lote']}-{$vi}"; }
      }
      return publicState($d);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  // Reemplaza los lotes por los polígonos de un KML (coordenadas reales) y reubica los silos
  case 'importKml': {
    requireAdmin(); $c = body()['change'] ?? null;
    if (!is_array($c) || !is_array($c['lots'] ?? null) || !is_array($c['georef'] ?? null)) fail('Datos incompletos');
    $polyOk = function ($poly, $max = 3000) {
      if (!is_array($poly) || count($poly) < 3 || count($poly) > $max) return false;
      foreach ($poly as $p) if (!is_array($p) || count($p) !== 2 || num($p[0]) === null || num($p[1]) === null || abs($p[0]) > 200000 || abs($p[1]) > 200000) return false;
      return true;
    };
    $clean = fn($poly) => array_map(fn($p) => [round((float)$p[0], 2), round((float)$p[1], 2)], $poly);
    $kid = fn($v) => preg_match('/^k[a-z0-9]{1,24}$/', (string)$v) ? (string)$v : null;
    $g = $c['georef'];
    // quitar el último KML: sin lotes (solo si ningún silo queda huérfano)
    if (count($c['lots']) === 0) {
      $state = withData(function (&$d) {
        if (count($d['silos'] ?? [])) fail('Hay silobolsas cargadas: no se pueden quitar todos los lotes');
        $d['lots'] = []; $d['outline'] = []; $d['decor'] = []; $d['georef'] = ['points' => []];
        return publicState($d);
      }, true);
      out(['ok' => true, 'state' => $state]);
    }
    foreach (['lat0', 'lng0', 's', 'ox', 'oy'] as $k) if (num($g[$k] ?? null) === null) fail('Georreferencia del KML inválida');
    if (abs($g['lat0']) > 90 || abs($g['lng0']) > 180 || $g['s'] <= 0) fail('Georreferencia del KML inválida');
    if (count($c['lots']) < 1 || count($c['lots']) > 99) fail('Cantidad de lotes inválida');
    $lots = []; $seen = [];
    foreach ($c['lots'] as $l) {
      $n = lotCode($l['num'] ?? null);
      $key = ($kid($l['kml'] ?? '') ?? '') . '|' . (is_int($n) ? "n$n" : 's' . mb_strtolower((string)$n));
      if ($n === null || isset($seen[$key])) fail('Lote inválido o repetido (' . str((string)($l['num'] ?? ''), 20) . ')'); $seen[$key] = 1;
      if (!$polyOk($l['poly'] ?? null)) fail("Forma inválida en el lote $n");
      $lab = $l['label'] ?? null;
      $subs = [];
      foreach ((is_array($l['subs'] ?? null) ? array_slice($l['subs'], 0, 20) : []) as $sb) {
        if (!$polyOk($sb['poly'] ?? null)) continue;
        $sl = $sb['label'] ?? null;
        $subs[] = ['id' => str($sb['id'] ?? '', 4), 'ha' => round(max(0, (float)(num($sb['ha'] ?? 0) ?? 0)), 1), 'poly' => $clean($sb['poly']),
          'label' => is_array($sl) && count($sl) === 2 ? $clean([$sl])[0] : $clean([$sb['poly'][0]])[0]];
      }
      $kml = $kid($l['kml'] ?? '');
      $rec = ['id' => $kml ? "$kml:$n" : (string)$n, 'num' => $n, 'ha' => round(max(0, (float)(num($l['ha'] ?? 0) ?? 0)), 1), 'nombre' => str($l['nombre'] ?? '', 60), 'obs' => str($l['obs'] ?? '', 1000),
        'poly' => $clean($l['poly']), 'subs' => $subs, 'label' => is_array($lab) && count($lab) === 2 ? $clean([$lab])[0] : $clean([$l['poly'][0]])[0], 'kml' => $kml];
      if ($polyOk($l['poly0'] ?? null)) $rec['poly0'] = $clean($l['poly0']);
      $lots[] = $rec;
    }
    usort($lots, 'lotCmp');
    if (!$polyOk($c['outline'] ?? null, 5000)) fail('Contorno inválido');
    $lines = [];
    foreach (array_slice(is_array($c['lines'] ?? null) ? $c['lines'] : [], 0, 200) as $ln)
      if (is_array($ln['pts'] ?? null) && count($ln['pts']) >= 2 && count($ln['pts']) <= 3000) $lines[] = ['name' => str($ln['name'] ?? '', 60), 'pts' => $clean($ln['pts']), 'kml' => $kid($ln['kml'] ?? '')];
    $kmls = [];
    foreach ((is_array($g['kmls'] ?? null) ? array_slice($g['kmls'], 0, 50) : []) as $k) {
      if (!$kid($k['id'] ?? '')) continue;
      $sig = preg_replace('/[^A-Z]/', '', strtoupper((string)($k['sigla'] ?? '')));
      $kmls[] = ['id' => $k['id'], 'archivo' => str($k['archivo'] ?? '', 120), 'nombre' => str($k['nombre'] ?? '', 60) ?: null, 'sigla' => strlen($sig) >= 2 ? substr($sig, 0, 4) : null, 'fecha' => str($k['fecha'] ?? '', 40) ?: null, 'lotes' => array_values(array_filter(array_map('lotCode', is_array($k['lotes'] ?? null) ? $k['lotes'] : []), fn($n) => $n !== null))];
    }
    $state = withData(function (&$d) use ($c, $g, $lots, $lines, $kmls, $clean) {
      $d['lots'] = $lots;
      $d['outline'] = $clean($c['outline']);
      $d['decor'] = ['lines' => $lines];
      $d['georef'] = ['mode' => 'kml', 'lat0' => (float)$g['lat0'], 'lng0' => (float)$g['lng0'], 's' => (float)$g['s'], 'ox' => (float)$g['ox'], 'oy' => (float)$g['oy'], 'points' => [],
        'kml' => ['archivo' => str($g['kml']['archivo'] ?? '', 120), 'fecha' => gmdate('c'), 'lotes' => count($lots)], 'kmls' => $kmls];
      $siloLots = array_values(array_filter($lots, fn($l) => is_int($l['num'])));
      $ids = array_map('lotIdOf', $siloLots);
      if (!$siloLots && count($d['silos'] ?? [])) fail('Hace falta al menos un lote con número para los silos');
      foreach (($c['silos'] ?? []) as $u) foreach ($d['silos'] as $k => $s) if ($s['id'] === ($u['id'] ?? null)) {
        $uid = (string)($u['lot'] ?? ''); if (!in_array($uid, $ids, true)) { foreach ($siloLots as $l) if ($l['num'] === (int)($u['lote'] ?? 0)) { $uid = lotIdOf($l); break; } }
        if (!is_array($u['map'] ?? null) || count($u['map']) !== 2 || !in_array($uid, $ids, true)) continue;
        $d['silos'][$k]['lot'] = $uid; $d['silos'][$k]['lote'] = (int)explode(':', $uid)[count(explode(':', $uid)) - 1];
        $d['silos'][$k]['map'] = $clean([$u['map']])[0];
        $d['silos'][$k]['map2'] = is_array($u['map2'] ?? null) && count($u['map2']) === 2 ? $clean([$u['map2']])[0] : null;
        $d['silos'][$k]['t'] = num($u['t'] ?? null); $d['silos'][$k]['ang'] = num($u['ang'] ?? null);
        if (is_array($u['latlng'] ?? null)) $d['silos'][$k]['latlng'] = array_map('floatval', array_slice($u['latlng'], 0, 2));
        if (is_array($u['latlng2'] ?? null)) $d['silos'][$k]['latlng2'] = array_map('floatval', array_slice($u['latlng2'], 0, 2));
      }
      // silos de lotes que ya no existen: van al primer lote (el ID se conserva)
      foreach ($d['silos'] as $k => $s) {
        $sid = $s['lot'] ?? null;
        if ($sid !== null && in_array($sid, $ids, true)) continue;
        $m = null; foreach ($siloLots as $l) if ($l['num'] === $s['lote']) { $m = $l; break; }
        $m = $m ?? $siloLots[0];
        $d['silos'][$k]['lot'] = lotIdOf($m); $d['silos'][$k]['lote'] = $m['num'];
      }
      return publicState($d);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  case 'saveEstancia': {
    requireAdmin(); $e = body()['estancia'] ?? [];
    $state = withData(function (&$d) use ($e) {
      $sig = preg_replace('/[^A-Z]/', '', strtoupper((string)($e['sigla'] ?? '')));
      if (!$sig || strlen($sig) > 4) fail('Sigla inválida');
      $d['estancia'] = ['nombre' => str($e['nombre'] ?? '', 80) ?: $d['estancia']['nombre'], 'sigla' => $sig];
      return publicState($d);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  case 'saveUser': {
    $me = requireUser(); $u = body()['u'] ?? [];
    $isAdmin = $me['rol'] === 'admin';
    $user = strtolower(preg_replace('/[^a-z0-9._-]/i', '', (string)($u['user'] ?? '')));
    if (strlen($user) < 3) fail('Usuario inválido');
    if (!$isAdmin && $user !== $me['user']) fail('Sin permiso', 403);
    $pass = (string)($u['pass'] ?? '');
    if ($pass !== '' && strlen($pass) < 6) fail('La contraseña debe tener al menos 6 caracteres');
    $state = withData(function (&$d) use ($u, $user, $pass, $isAdmin) {
      $idx = null; foreach ($d['users'] as $i => $x) if ($x['user'] === $user) $idx = $i;
      $rol = $isAdmin && in_array($u['rol'] ?? '', ['admin', 'operador'], true) ? $u['rol'] : ($idx !== null ? $d['users'][$idx]['rol'] : 'operador');
      $rec = ['user' => $user, 'nombre' => str($u['nombre'] ?? $user, 60) ?: $user, 'rol' => $rol];
      if ($pass !== '') $rec['hash'] = password_hash($pass, PASSWORD_DEFAULT);
      if ($idx !== null) $d['users'][$idx] = array_merge($d['users'][$idx], $rec);
      else { if ($pass === '') fail('Indicá una contraseña'); $d['users'][] = $rec; }
      $admins = array_filter($d['users'], fn($x) => ($x['rol'] ?? '') === 'admin');
      if (!$admins) fail('Debe quedar al menos un administrador');
      return publicState($d);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  case 'deleteUser': {
    $me = requireAdmin(); $user = (string)(body()['user'] ?? '');
    if ($user === $me['user']) fail('No podés eliminar tu propio usuario');
    $state = withData(function (&$d) use ($user) { $d['users'] = array_values(array_filter($d['users'], fn($x) => $x['user'] !== $user)); return publicState($d); }, true);
    out(['ok' => true, 'state' => $state]);
  }

  case 'import': {
    requireAdmin(); $in = body()['data'] ?? null;
    if (!is_array($in) || !is_array($in['lots'] ?? null) || !is_array($in['silos'] ?? null)) fail('Archivo no válido');
    $state = withData(function (&$d) use ($in) {
      foreach ($in['lots'] as $l) if (!isset($l['num'], $l['ha'], $l['poly']) || !is_array($l['poly'])) fail('Lotes con formato inválido');
      foreach ($in['silos'] as $s) if (!isset($s['id'], $s['lote'])) fail('Silos con formato inválido');
      $d['lots'] = $in['lots']; $d['silos'] = $in['silos'];
      if (isset($in['estancia']['nombre'], $in['estancia']['sigla'])) $d['estancia'] = $in['estancia'];
      if (isset($in['georef']['points'])) $d['georef'] = $in['georef'];
      return publicState($d);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  /* ---------- Mapas propios ---------- */
  case 'uploadMap': {
    $me = requireAdmin(); $b = body(); $m = $b['map'] ?? null;
    if (!is_array($m)) fail('Datos incompletos');
    if (!preg_match('#^data:image/(jpeg|png|webp);base64,(.+)$#', (string)($b['data'] ?? ''), $mm)) fail('Imagen no válida');
    $bin = base64_decode($mm[2], true);
    if ($bin === false || strlen($bin) > MAX_MAP) fail('La imagen del mapa supera 25 MB');
    $info = @getimagesizefromstring($bin);
    if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP], true)) fail('Formato de imagen no permitido');
    $corners = cleanCorners($m['corners'] ?? null);
    $dir = UPLOAD_DIR . '/maps';
    if (!is_dir($dir) && !mkdir($dir, 0755, true)) fail('No se pudo crear la carpeta de mapas', 500);
    $id = 'm' . base_convert((string)time(), 10, 36) . bin2hex(random_bytes(3));
    $ext = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp'][$info[2]];
    file_put_contents("$dir/$id.$ext", $bin);
    $rec = ['id' => $id, 'nombre' => str($m['nombre'] ?? 'Mapa', 80) ?: 'Mapa', 'fecha' => cleanFecha($m['fecha'] ?? null),
      'src' => "uploads/maps/$id.$ext", 'w' => $info[0], 'h' => $info[1], 'corners' => $corners,
      'crs' => str($m['crs'] ?? '', 40) ?: null, 'original' => is_array($m['original'] ?? null) ? array_map('intval', array_slice($m['original'], 0, 2)) : null, 'tipo' => in_array($m['tipo'] ?? '', ['GeoTIFF', 'PDF', 'Imagen'], true) ? $m['tipo'] : null,
      'peso' => strlen($bin), 'creadoPor' => $me['user'], 'creadoEn' => gmdate('c')];
    $state = withData(function (&$d) use ($rec) { $d['maps'] = $d['maps'] ?? []; $d['maps'][] = $rec; return publicState($d); }, true);
    out(['ok' => true, 'id' => $id, 'state' => $state]);
  }

  case 'saveMap': {
    requireAdmin(); $m = body()['map'] ?? null;
    if (!is_array($m)) fail('Datos incompletos');
    $state = withData(function (&$d) use ($m) {
      foreach (($d['maps'] ?? []) as $i => $x) if ($x['id'] === ($m['id'] ?? null)) {
        $d['maps'][$i]['nombre'] = str($m['nombre'] ?? $x['nombre'], 80) ?: $x['nombre'];
        $d['maps'][$i]['fecha'] = cleanFecha($m['fecha'] ?? null);
        $d['maps'][$i]['corners'] = cleanCorners($m['corners'] ?? null);
        return publicState($d);
      }
      fail('El mapa ya no existe', 404);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  case 'deleteMap': {
    requireAdmin(); $id = (string)(body()['id'] ?? '');
    $state = withData(function (&$d) use ($id) {
      foreach (($d['maps'] ?? []) as $x) if ($x['id'] === $id && preg_match('#^uploads/maps/[a-z0-9]+\.(jpg|png|webp)$#', $x['src'])) @unlink(__DIR__ . '/' . $x['src']);
      $d['maps'] = array_values(array_filter($d['maps'] ?? [], fn($x) => $x['id'] !== $id));
      return publicState($d);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  default:
    fail('Acción desconocida', 404);
}
