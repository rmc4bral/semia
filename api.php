<?php
/**
 * acopia · API de registro de silobolsas
 * PHP 7.4+ · almacenamiento en data.json con bloqueo de archivo
 */
declare(strict_types=1);

/*
 * DATOS FUERA DEL DESPLIEGUE: el Git de Hostinger reemplaza la carpeta del sitio en cada publicación
 * (y puede publicar cada versión en una carpeta nueva enlazada como public_html). Por eso la base,
 * las fotos, los mapas y los respaldos viven en la CARPETA PERSONAL de la cuenta (~/acopia-datos),
 * que ningún despliegue toca ni es accesible por URL. Otra ruta: variable de entorno ACOPIA_DATA.
 */
function homeDir(): ?string {
  $h = getenv('HOME') ?: ($_SERVER['HOME'] ?? '');
  if (!$h && function_exists('posix_getpwuid') && function_exists('posix_geteuid')) { $pw = @posix_getpwuid(posix_geteuid()); $h = $pw['dir'] ?? ''; }
  if (!$h && preg_match('#^(/home/[^/]+)/#', (string)realpath(__DIR__), $m)) $h = $m[1];
  return $h && @is_dir($h) ? rtrim($h, '/') : null;
}
function insideOf(string $dir, string $base): bool { $d = realpath($dir) ?: $dir; $b = realpath($base) ?: $base; return $d === $b || strpos($d . '/', rtrim($b, '/') . '/') === 0; }
function usableDir(string $d): bool { return (@is_dir($d) || @mkdir($d, 0750, true)) && @is_writable($d) && !insideOf($d, __DIR__); }
function docRootParent(): ?string { $r = $_SERVER['DOCUMENT_ROOT'] ?? ''; return $r ? dirname(rtrim($r, '/')) : null; }
function dataDirPath(): string {
  $env = getenv('ACOPIA_DATA');
  if ($env) { $d = rtrim($env, '/'); if (!is_dir($d)) @mkdir($d, 0750, true); return $d; }
  $cands = [];
  if ($h = homeDir()) $cands[] = "$h/acopia-datos";
  if ($p = docRootParent()) $cands[] = "$p/acopia-datos";
  $cands[] = dirname(__DIR__) . '/acopia-datos';
  foreach ($cands as $c) if (usableDir($c)) return $c;
  // último recurso (hosting sin permiso fuera de la web): adentro, protegido por .htaccess
  $in = __DIR__ . '/datos';
  if (!is_dir($in)) @mkdir($in, 0750, true);
  return $in;
}
define('DATA_DIR', dataDirPath());
const DATA_FILE   = DATA_DIR . '/data.json';
const SEED_FILE   = __DIR__ . '/data.seed.json'; // plantilla inicial (versionada en git)
const UPLOAD_DIR  = DATA_DIR . '/uploads';
const BACKUP_DIR  = DATA_DIR . '/backups';
const MAX_PHOTO   = 4 * 1024 * 1024; // 4 MB
const MAX_BODY    = 40 * 1024 * 1024;
const MAX_MAP     = 25 * 1024 * 1024; // imagen de mapa ya reducida en el navegador

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: same-origin');

// Migración: datos que hayan quedado dentro de la web (versiones anteriores) pasan a la carpeta de datos
function moveTree(string $from, string $to): void {
  if (!is_dir($from)) return;
  if (!is_dir($to)) @mkdir($to, 0750, true);
  foreach (scandir($from) ?: [] as $f) {
    if ($f === '.' || $f === '..' || $f === '.htaccess') continue;
    $a = "$from/$f"; $b = "$to/$f";
    if (is_dir($a)) moveTree($a, $b); elseif (!file_exists($b)) @rename($a, $b);
  }
}
function copyTree(string $from, string $to): void {
  if (!is_dir($from)) return;
  if (!is_dir($to)) @mkdir($to, 0750, true);
  foreach (scandir($from) ?: [] as $f) {
    if ($f === '.' || $f === '..' || $f === '.htaccess') continue;
    $a = "$from/$f"; $b = "$to/$f";
    if (is_dir($a)) copyTree($a, $b); elseif (!file_exists($b)) @copy($a, $b);
  }
}
// Recuperación: si quedaron datos en ubicaciones anteriores (dentro de la web o junto a ella),
// se toma el más reciente (más nuevo que el actual), se guarda una copia del actual y se marca el viejo como migrado.
(function () {
  $olds = array_unique(array_filter([
    __DIR__ . '/data.json', __DIR__ . '/datos/data.json',
    dirname(__DIR__) . '/acopia-datos/data.json',
    ($p = docRootParent()) ? "$p/acopia-datos/data.json" : null,
  ]));
  $best = null;
  foreach ($olds as $f) {
    if (realpath($f) && realpath($f) === realpath(DATA_FILE)) continue;
    if (@is_file($f) && (!$best || filemtime($f) > filemtime($best))) $best = $f;
  }
  if (!$best) return;
  if (!file_exists(DATA_FILE) || filemtime($best) > filemtime(DATA_FILE)) {
    if (file_exists(DATA_FILE)) @copy(DATA_FILE, DATA_DIR . '/data.antes-de-recuperar-' . gmdate('Ymd-His') . '.json');
    if (@copy($best, DATA_FILE)) {
      $src = dirname($best);
      copyTree("$src/uploads", UPLOAD_DIR); copyTree("$src/backups", BACKUP_DIR);
    }
  }
  @rename($best, $best . '.migrado-' . gmdate('Ymd-His'));
})();
if (!insideOf(UPLOAD_DIR, __DIR__)) copyTree(__DIR__ . '/uploads', UPLOAD_DIR); // fotos de versiones viejas

// Primera instalación: crear data.json desde la plantilla. Los despliegues nunca lo pisan.
if (!file_exists(DATA_FILE)) {
  if (!file_exists(SEED_FILE) || !copy(SEED_FILE, DATA_FILE)) { http_response_code(500); echo '{"ok":false,"error":"Falta data.json"}'; exit; }
}

ini_set('session.use_strict_mode', '1');
session_name('SEMIASESS');
// Sesiones guardadas con los datos (fuera de la web): «Mantener sesión iniciada» dura 30 días;
// si no se marca, la sesión termina al cerrar el navegador.
const SESSION_DAYS = 30;
$sessDir = DATA_DIR . '/sesiones';
if ((is_dir($sessDir) || @mkdir($sessDir, 0700, true)) && is_writable($sessDir)) session_save_path($sessDir);
ini_set('session.gc_maxlifetime', (string)(SESSION_DAYS * 86400));
function cookieOpts(int $expires): array {
  return ['expires' => $expires, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'httponly' => true, 'samesite' => 'Lax'];
}
session_set_cookie_params([
  'lifetime' => 0,
  'path' => '/',
  'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
  'httponly' => true,
  'samesite' => 'Lax',
]);
session_start();
// sesión recordada: se renueva el vencimiento de la cookie en cada uso
if (!empty($_SESSION['recordar'])) setcookie(session_name(), session_id(), cookieOpts(time() + SESSION_DAYS * 86400));

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
    // respaldo diario (se guardan los últimos 60 días)
    $bk = BACKUP_DIR;
    if (is_dir($bk) || @mkdir($bk, 0750, true)) {
      $f = $bk . '/data-' . gmdate('Y-m-d') . '.json';
      if (!file_exists($f)) {
        @file_put_contents($f, $raw);
        $old = glob($bk . '/data-*.json') ?: []; sort($old);
        foreach (array_slice($old, 0, max(0, count($old) - 60)) as $o) @unlink($o);
      }
    }
    ftruncate($fh, 0); rewind($fh); fwrite($fh, $json); fflush($fh);
  }
  flock($fh, LOCK_UN); fclose($fh);
  return $res;
}
function publicState(array $d): array {
  $d['users'] = array_map(fn($u) => ['user' => $u['user'], 'nombre' => $u['nombre'] ?? '', 'apellido' => $u['apellido'] ?? '', 'rol' => $u['rol'] ?? 'operador', 'email' => $u['email'] ?? '', 'tel' => $u['tel'] ?? ''], $d['users'] ?? []);
  return $d;
}
function me(): ?array { return $_SESSION['me'] ?? null; }
function sessionUser(array $u): array {
  return ['user' => $u['user'], 'nombre' => $u['nombre'] ?? $u['user'], 'apellido' => $u['apellido'] ?? '', 'rol' => $u['rol'] ?? 'operador', 'email' => $u['email'] ?? '', 'tel' => $u['tel'] ?? '', 'tema' => $u['tema'] ?? 'light'];
}
// prioridad de salida: alta (menos humedad, se despacha primero), media o baja; true de versiones anteriores = alta
function prioOf($v): ?string { if ($v === true) return 'alta'; return in_array($v, ['alta', 'media', 'baja'], true) ? $v : null; }
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


// Consultas del formulario de contacto de la web: archivo aparte, fuera de la web, con bloqueo propio.
define('CONTACT_FILE', DATA_DIR . '/contactos.json');
const FUENTES = ['YouTube', 'Google', 'Instagram', 'Facebook', 'X', 'TikTok', 'LinkedIn', 'Otros'];
function withContacts(callable $fn) {
  $fh = fopen(CONTACT_FILE, 'c+'); if (!$fh) fail('No se pudo guardar la consulta', 500);
  flock($fh, LOCK_EX); $c = json_decode(stream_get_contents($fh) ?: '{}', true); if (!is_array($c)) $c = [];
  $c += ['items' => [], 'hits' => []];
  $res = $fn($c);
  ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)); fflush($fh);
  flock($fh, LOCK_UN); fclose($fh); @chmod(CONTACT_FILE, 0640);
  return $res;
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST') checkCsrf();

switch ($action) {
  case 'ping':
    out(['ok' => true, 'app' => 'semia', 'version' => 1]);

  case 'contact': {
    // formulario público de la landing: validado, con trampa para robots y límite por IP
    $b = body();
    if (str($b['web'] ?? '', 200) !== '') out(['ok' => true]);
    $f = ['nombre' => str($b['nombre'] ?? '', 60), 'apellido' => str($b['apellido'] ?? '', 60), 'email' => str($b['email'] ?? '', 120),
      'tel' => str($b['tel'] ?? '', 30), 'empresa' => str($b['empresa'] ?? '', 100), 'fuente' => str($b['fuente'] ?? '', 20), 'mensaje' => str($b['mensaje'] ?? '', 2000), 'tipo' => ($b['tipo'] ?? '') === 'demo' ? 'demo' : 'consulta'];
    foreach (['nombre' => 'el nombre', 'apellido' => 'el apellido', 'email' => 'el email', 'tel' => 'el celular', 'empresa' => 'la empresa'] as $k => $t)
      if ($f[$k] === '') fail("Completá $t");
    if (!filter_var($f['email'], FILTER_VALIDATE_EMAIL)) fail('El email no es válido');
    if (strlen(preg_replace('/\D/', '', $f['tel'])) < 6) fail('El celular no es válido');
    if ($f['fuente'] !== '' && !in_array($f['fuente'], FUENTES, true)) $f['fuente'] = 'Otros';
    $ip = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|acopia');
    withContacts(function (&$c) use ($f, $ip) {
      $now = time(); $c['hits'] = array_values(array_filter($c['hits'], fn($h) => $h['t'] > $now - 3600));
      if (count(array_filter($c['hits'], fn($h) => $h['ip'] === $ip)) >= 5) fail('Recibimos varias consultas seguidas. Probá de nuevo en un rato.', 429);
      $c['hits'][] = ['ip' => $ip, 't' => $now];
      array_unshift($c['items'], $f + ['id' => bin2hex(random_bytes(6)), 'fecha' => gmdate('c'), 'leida' => false]);
      $c['items'] = array_slice($c['items'], 0, 500);
    });
    // aviso por correo a los administradores que cargaron su email en Perfil
    $to = []; withData(function (&$d) use (&$to) { foreach ($d['users'] ?? [] as $u) if (($u['rol'] ?? '') === 'admin' && filter_var($u['email'] ?? '', FILTER_VALIDATE_EMAIL)) $to[] = $u['email']; });
    if ($to && function_exists('mail')) {
      $host = preg_replace('/[^a-z0-9.\-]/i', '', explode(':', $_SERVER['HTTP_HOST'] ?? 'acopia.app')[0]) ?: 'acopia.app';
      $txt = ($f['tipo'] === 'demo' ? "Solicitud de demo de 10 días desde $host" : "Nueva consulta desde $host") . "\n\nNombre: {$f['nombre']} {$f['apellido']}\nEmpresa: {$f['empresa']}\nEmail: {$f['email']}\nCelular: {$f['tel']}\nNos conoció por: " . ($f['fuente'] ?: '—') . "\n\n{$f['mensaje']}\n";
      $safe = fn($v) => str_replace(["\r", "\n"], '', $v);
      @mail(implode(',', $to), '=?UTF-8?B?' . base64_encode(($f['tipo'] === 'demo' ? 'Demo de 10 días: ' : 'Consulta de ') . $f['nombre'] . ' ' . $f['apellido'] . ' · ' . $f['empresa']) . '?=', $txt,
        "From: Acopia <no-reply@$host>\r\nReply-To: " . $safe($f['email']) . "\r\nContent-Type: text/plain; charset=UTF-8");
    }
    out(['ok' => true]);
  }

  case 'contacts': {
    requireAdmin();
    $items = file_exists(CONTACT_FILE) ? (json_decode(file_get_contents(CONTACT_FILE), true)['items'] ?? []) : [];
    out(['ok' => true, 'items' => $items]);
  }

  case 'contactUpdate': {
    requireAdmin(); $b = body(); $id = (string)($b['id'] ?? '');
    $items = withContacts(function (&$c) use ($b, $id) {
      if (!empty($b['borrar'])) $c['items'] = array_values(array_filter($c['items'], fn($x) => $x['id'] !== $id));
      else foreach ($c['items'] as &$x) if ($x['id'] === $id) $x['leida'] = !empty($b['leida']);
      return $c['items'];
    });
    out(['ok' => true, 'items' => $items]);
  }

  case 'file': {
    // fotos y mapas: viven fuera de la web; se entregan solo con sesión iniciada
    if (!me()) { http_response_code(401); exit; }
    $p = (string)($_GET['p'] ?? '');
    if (!preg_match('#^(maps/[a-z0-9]+|[A-Z0-9]+-[a-f0-9]{8})\.(jpg|png|webp)$#', $p, $m)) { http_response_code(404); exit; }
    $f = UPLOAD_DIR . '/' . $p;
    if (!is_file($f)) { http_response_code(404); exit; }
    header('Content-Type: ' . ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'][$m[2]]);
    header('Cache-Control: private, max-age=31536000, immutable');
    header('Content-Length: ' . filesize($f));
    readfile($f); exit;
  }

  case 'health': {
    // diagnóstico para el administrador: dónde están los datos y si están a salvo de los despliegues
    $m = me(); if (!$m || $m['rol'] !== 'admin') fail('Solo administradores', 403);
    $bks = glob(BACKUP_DIR . '/data-*.json') ?: [];
    out(['ok' => true, 'fueraDeLaWeb' => !insideOf(DATA_DIR, __DIR__), 'datos' => DATA_DIR, 'datosReal' => realpath(DATA_DIR) ?: null,
      'web' => __DIR__, 'webReal' => realpath(__DIR__) ?: null, 'docRoot' => $_SERVER['DOCUMENT_ROOT'] ?? null,
      'docRootEsEnlace' => !empty($_SERVER['DOCUMENT_ROOT']) && is_link(rtrim($_SERVER['DOCUMENT_ROOT'], '/')), 'home' => homeDir(),
      'openBasedir' => ini_get('open_basedir') ?: null, 'base' => file_exists(DATA_FILE) ? ['bytes' => filesize(DATA_FILE), 'modificada' => gmdate('c', filemtime(DATA_FILE))] : null,
      'respaldos' => count($bks), 'ultimoRespaldo' => $bks ? basename(max($bks)) : null]);
  }


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
    $_SESSION['me'] = sessionUser($found);
    $_SESSION['recordar'] = !empty($b['recordar']);
    if ($_SESSION['recordar']) setcookie(session_name(), session_id(), cookieOpts(time() + SESSION_DAYS * 86400));
    out(['ok' => true, 'me' => $_SESSION['me'], 'state' => withData(fn($d) => publicState($d))]);
  }

  case 'logout':
    $_SESSION = []; session_destroy();
    setcookie(session_name(), '', cookieOpts(time() - 3600));
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
      $rawHum = $s['hum'] ?? null; $hum = ($rawHum === null || $rawHum === '') ? null : num($rawHum);
      if (($rawHum !== null && $rawHum !== '' && $hum === null) || ($hum !== null && ($hum < 0 || $hum > 40))) fail('Humedad inválida (0 a 40 %)');
      if ($hum !== null) $hum = round($hum, 1);
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
        'id' => $id, 'lote' => $lote, 'lot' => $lotId, 'kg' => $kg, 'hum' => $hum, 'prio' => prioOf($s['prio'] ?? null), 'grano' => str($s['grano'] ?? '', 30), 'obs' => str($s['obs'] ?? '', 1000), 'foto' => $foto,
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

  case 'setPrio': {
    // administrador y supervisores marcan la prioridad de salida de cualquier bolsa, desde el campo o el panel
    $me = requireUser(); $b = body(); $id = (string)($b['id'] ?? ''); $p = prioOf($b['prio'] ?? null);
    $state = withData(function (&$d) use ($id, $p, $me) {
      foreach ($d['silos'] as &$s) if ($s['id'] === $id) { $s['prio'] = $p; $s['prioPor'] = $me['user']; $s['prioEn'] = gmdate('c'); return publicState($d); }
      fail('El silo ya no existe', 404);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  case 'setDespacho': {
    // extracción de la bolsa: fecha de inicio y de finalización (despacho completo); la bolsa finalizada sale del mapa y del stock
    $me = requireUser(); $b = body(); $id = (string)($b['id'] ?? '');
    $day = function ($v, $t) { if ($v === null || $v === '') return null; if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) || !checkdate((int)substr($v, 5, 2), (int)substr($v, 8, 2), (int)substr($v, 0, 4))) fail("Fecha de $t inválida"); return $v; };
    $ini = $day($b['inicio'] ?? null, 'inicio'); $fin = $day($b['fin'] ?? null, 'finalización');
    if ($fin && !$ini) $ini = $fin;
    if ($ini && $fin && $fin < $ini) fail('La finalización no puede ser anterior al inicio');
    $hoy = date('Y-m-d', time() + 86400);
    if (($ini && $ini > $hoy) || ($fin && $fin > $hoy)) fail('Las fechas no pueden ser futuras');
    $state = withData(function (&$d) use ($id, $ini, $fin, $me) {
      foreach ($d['silos'] as &$s) if ($s['id'] === $id) {
        $emb = substr((string)($s['creadoEn'] ?? ''), 0, 10);
        if ($ini && $emb && $ini < date('Y-m-d', strtotime("$emb -1 day"))) fail('El inicio no puede ser anterior al embolsado (' . date('d/m/Y', strtotime($emb)) . ')');
        $s['inicio'] = $ini; $s['fin'] = $fin; $s['despachoPor'] = $me['user']; $s['despachoEn'] = gmdate('c');
        return publicState($d);
      }
      fail('El silo ya no existe', 404);
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

  case 'saveVariedades': {
    // variedades propias de la empresa; renombrar una actualiza las silobolsas que la usan
    requireAdmin(); $b = body();
    $list = []; foreach ((array)($b['list'] ?? []) as $v) { $v = str($v, 30); if ($v === '') continue; foreach ($list as $x) if (mb_strtolower($x) === mb_strtolower($v)) fail("«$v» está repetida"); $list[] = $v; }
    if (!$list) fail('Dejá al menos una variedad');
    if (count($list) > 60) fail('Hasta 60 variedades');
    $ren = [];
    foreach ((array)($b['renames'] ?? []) as $r) { $a = str($r[0] ?? '', 30); $n = str($r[1] ?? '', 30); if ($a !== '' && $n !== '' && $a !== $n) $ren[$a] = $n; }
    $state = withData(function (&$d) use ($list, $ren) {
      $d['variedades'] = $list;
      if ($ren) foreach ($d['silos'] as &$s) if (isset($ren[$s['grano'] ?? ''])) $s['grano'] = $ren[$s['grano']];
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
    $email = trim((string)($u['email'] ?? ''));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('El email no es válido');
    $tel = preg_replace('/[^0-9+ ()-]/', '', (string)($u['tel'] ?? ''));
    if ($tel !== '' && strlen(preg_replace('/\D/', '', $tel)) < 6) fail('El celular no es válido');
    $state = withData(function (&$d) use ($u, $user, $pass, $isAdmin, $email, $tel) {
      $idx = null; foreach ($d['users'] as $i => $x) if ($x['user'] === $user) $idx = $i;
      $rol = $isAdmin && in_array($u['rol'] ?? '', ['admin', 'operador'], true) ? $u['rol'] : ($idx !== null ? $d['users'][$idx]['rol'] : 'operador');
      $rec = ['user' => $user, 'nombre' => str($u['nombre'] ?? $user, 60) ?: $user, 'rol' => $rol];
      if (array_key_exists('apellido', $u)) $rec['apellido'] = str($u['apellido'], 60);
      if (array_key_exists('email', $u)) $rec['email'] = substr($email, 0, 120);
      if (array_key_exists('tel', $u)) $rec['tel'] = substr($tel, 0, 30);
      if (in_array($u['tema'] ?? '', ['light', 'dark'], true)) $rec['tema'] = $u['tema'];
      if ($pass !== '') $rec['hash'] = password_hash($pass, PASSWORD_DEFAULT);
      if ($idx !== null) $d['users'][$idx] = array_merge($d['users'][$idx], $rec);
      else { if ($pass === '') fail('Indicá una contraseña'); $d['users'][] = $rec; }
      $admins = array_filter($d['users'], fn($x) => ($x['rol'] ?? '') === 'admin');
      if (!$admins) fail('Debe quedar al menos un administrador');
      foreach ($d['users'] as $x) if ($x['user'] === ($_SESSION['me']['user'] ?? '')) $_SESSION['me'] = sessionUser($x);
      return publicState($d);
    }, true);
    out(['ok' => true, 'state' => $state, 'me' => $_SESSION['me']]);
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
      foreach (($d['maps'] ?? []) as $x) if ($x['id'] === $id && preg_match('#^uploads/maps/[a-z0-9]+\.(jpg|png|webp)$#', $x['src'])) @unlink(DATA_DIR . '/' . $x['src']);
      $d['maps'] = array_values(array_filter($d['maps'] ?? [], fn($x) => $x['id'] !== $id));
      return publicState($d);
    }, true);
    out(['ok' => true, 'state' => $state]);
  }

  default:
    fail('Acción desconocida', 404);
}
