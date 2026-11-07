<?php
// Routeur pour tester en local sans Apache : php -S 127.0.0.1:8090 php/dev-router.php
// (n'est pas à envoyer sur l'hébergement)
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (strpos($path, '/api/') !== false) { require __DIR__ . '/api.php'; return true; }
if (substr($path, -1) === '/' || substr($path, -10) === 'kgpro.html') { require __DIR__ . '/index.php'; return true; }
http_response_code(404); echo 'Introuvable';
