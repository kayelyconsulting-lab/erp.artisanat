<?php
// Routeur pour tester en local sans Apache : php -S 127.0.0.1:8090 php/dev-router.php
// (n'est pas à envoyer sur l'hébergement)
$chemin = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
// Bibliothèques (assets/) : fichiers servis tels quels, comme avec la règle Apache
if (strpos($chemin, '/assets/') === 0 && strpos($chemin, '..') === false) {
  $fichier = dirname(__DIR__) . $chemin;
  if (is_file($fichier) && preg_match('/\.(js|traineddata)$/', $fichier)) {
    header('Content-Type: ' . (substr($fichier, -3) === '.js' ? 'application/javascript' : 'application/octet-stream'));
    header('X-Content-Type-Options: nosniff');
    readfile($fichier);
    return true;
  }
}
$_SERVER['SCRIPT_NAME'] = '/index.php';
require __DIR__ . '/index.php';
return true;
