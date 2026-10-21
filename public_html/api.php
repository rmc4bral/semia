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
const MAX_BODY    = 8 * 1024 * 1024;

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
      $sigla = $d['estancia']['sigla'] ?? 'RB';
      $lote = (int)($s['lote'] ?? 0);
      $lotOk = false; foreach ($d['lots'] as $l) if ((int)$l['num'] === $lote) $lotOk = true;
      if (!$lotOk) fail('Lote inexistente');
      $kg = num($s['kg'] ?? null); if ($kg === null || $kg < 0) fail('Kg inválido');
      $map = $s['map'] ?? null;
      if (!is_array($map) || count($map) !== 2 || num($map[0]) === null || num($map[1]) === null) fail('Ubicación inválida');
      $idx = null;
      if ($prev !== null) { foreach ($d['silos'] as $i => $x) if ($x['id'] === $prev) $idx = $i; if ($idx === null) fail('El silo ya no existe', 404); }
      $isAdmin = ($me['rol'] ?? '') === 'admin';
      if ($idx !== null && !$isAdmin && ($d['silos'][$idx]['creadoPor'] ?? '') !== $me['user']) fail('Sin permiso para editar este silo', 403);
      if ($idx !== null && !$isAdmin) {
        $old = $d['silos'][$idx]['map'] ?? null;
        if ($old && (abs($old[0] - $map[0]) > 0.01 || abs($old[1] - $map[1]) > 0.01)) fail('Solo el administrador puede mover un silo', 403);
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
        'id' => $id, 'lote' => $lote, 'kg' => $kg, 'grano' => str($s['grano'] ?? '', 30), 'obs' => str($s['obs'] ?? '', 1000), 'foto' => $foto,
        'map' => [round((float)$map[0], 2), round((float)$map[1], 2)], 't' => num($s['t'] ?? null), 'ang' => num($s['ang'] ?? null),
        'latlng' => is_array($s['latlng'] ?? null) ? array_map('floatval', array_slice($s['latlng'], 0, 2)) : null,
        'gps' => is_array($s['gps'] ?? null) ? ['lat' => num($s['gps']['lat'] ?? null), 'lng' => num($s['gps']['lng'] ?? null), 'acc' => num($s['gps']['acc'] ?? null), 'at' => str($s['gps']['at'] ?? '', 40)] : null,
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
      $orig = (int)($l['_origNum'] ?? 0); $num = (int)($l['num'] ?? 0); $ha = num($l['ha'] ?? null);
      if ($num < 1 || $num > 99 || !$ha || $ha <= 0) fail('Número o hectáreas inválidos');
      $idx = null; foreach ($d['lots'] as $i => $x) { if ((int)$x['num'] === $orig) $idx = $i; if ((int)$x['num'] === $num && $num !== $orig) fail("Ya existe el lote $num"); }
      if ($idx === null) fail('Lote inexistente', 404);
      if ($num !== $orig) foreach ($d['silos'] as $s) if ((int)$s['lote'] === $orig) fail('El lote tiene silos: no se puede cambiar el número');
      $lot = &$d['lots'][$idx];
      $lot['num'] = $num; $lot['ha'] = $ha; $lot['nombre'] = str($l['nombre'] ?? '', 80); $lot['obs'] = str($l['obs'] ?? '', 1000);
      foreach ($lot['subs'] as $i => $sub) foreach (($l['subs'] ?? []) as $ns) if (($ns['id'] ?? '') === $sub['id'] && num($ns['ha'] ?? null) > 0) $lot['subs'][$i]['ha'] = num($ns['ha']);
      usort($d['lots'], fn($a, $b) => $a['num'] <=> $b['num']);
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
        $idx = null; foreach ($d['lots'] as $i => $l) if ((int)$l['num'] === (int)($nl['num'] ?? -1)) $idx = $i;
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

  default:
    fail('Acción desconocida', 404);
}
