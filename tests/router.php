<?php
// Servidor de pruebas (php -S … tests/router.php): igual que el .htaccess de Hostinger
// «/login» y «/dashboard/…» → app.html; el resto, el archivo pedido (/ → index.html, la landing)
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#^/(login|dashboard)(/|$)#', $p)) { header('Content-Type: text/html; charset=utf-8'); readfile($_SERVER['DOCUMENT_ROOT'] . '/app.html'); return true; }
return false;
