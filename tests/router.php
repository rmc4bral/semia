<?php
// Servidor de pruebas (php -S … tests/router.php): igual que el .htaccess de Hostinger
// «/login» y «/dashboard/…» → app.html; legales con dirección limpia; lo inexistente → 404.html
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$root = $_SERVER['DOCUMENT_ROOT'];
$html = function ($f, $code = 200) use ($root) { http_response_code($code); header('Content-Type: text/html; charset=utf-8'); readfile("$root/$f"); return true; };
if (preg_match('#^/(login|dashboard)(/|$)#', $p)) return $html('app.html');
if (preg_match('#^/(privacidad|terminos|cookies)/?$#', $p, $m)) return $html("$m[1].html");
if ($p !== '/' && !file_exists($root . $p)) return $html('404.html', 404);
return false;
