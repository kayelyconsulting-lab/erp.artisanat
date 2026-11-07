<?php
// Routeur pour tester en local sans Apache : php -S 127.0.0.1:8090 php/dev-router.php
// (n'est pas à envoyer sur l'hébergement)
$_SERVER['SCRIPT_NAME'] = '/index.php';
require __DIR__ . '/index.php';
return true;
