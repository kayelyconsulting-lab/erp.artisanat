<?php
// Plusieurs sociétés sur un même hébergement, chacune avec SA base de données.
//
//   https://erp.exemple.com/               -> page d'accueil (saisie du code société)
//   https://erp.exemple.com/<code>/        -> application de la société <code>
//   https://erp.exemple.com/<code>/api/... -> API de cette société, sur SA base
//   https://erp.exemple.com/console/       -> console Kayely Group (créer / suspendre des sociétés)
//
// Données : <dossier des données>/plateforme.sqlite (registre des sociétés, console)
//           <dossier des données>/societes/<code>.sqlite (une base par société)
declare(strict_types=1);
require __DIR__ . '/app.php';

const KGP_SLUG_RE = '/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/';
const KGP_RESERVED = ['console', 'api', 'lib', 'donnees', 'kgpro-donnees', 'index', 'admin', 'www', 'assets', 'static'];
const KGP_CONSOLE_COOKIE = 'kgp_console';
const KGP_CONSOLE_MIN_PASSWORD = 10;

/* ---------------- registre des sociétés ---------------- */

function kgp_platform_db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $pdo = kgp_open_sqlite(kgp_data_dir() . '/plateforme.sqlite');
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS societes (slug TEXT PRIMARY KEY, nom TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'Active', cree_le INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS console_sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS console_fails (k TEXT PRIMARY KEY, n INTEGER NOT NULL, first INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS console_audit (at INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT);
  ");
  return $pdo;
}
function kgp_tenant_file(string $slug): string { return kgp_data_dir() . '/societes/' . $slug . '.sqlite'; }
function kgp_find_societe(string $slug): ?array {
  $st = kgp_platform_db()->prepare('SELECT slug, nom, statut, cree_le FROM societes WHERE slug = ?');
  $st->execute([$slug]);
  return $st->fetch(PDO::FETCH_ASSOC) ?: null;
}
function kgp_config_get(string $k): ?string {
  $st = kgp_platform_db()->prepare('SELECT v FROM config WHERE k = ?'); $st->execute([$k]);
  $v = $st->fetchColumn(); return $v === false ? null : (string)$v;
}
function kgp_config_set(string $k, string $v): void {
  kgp_platform_db()->prepare('INSERT OR REPLACE INTO config (k, v) VALUES (?, ?)')->execute([$k, $v]);
}
function kgp_console_audit(string $action, string $detail = ''): void {
  kgp_platform_db()->prepare('INSERT INTO console_audit (at, action, detail) VALUES (?, ?, ?)')->execute([time(), $action, $detail]);
}
function kgp_use_tenant(array $societe, string $base): void {
  $GLOBALS['KGP_TENANT'] = [
    'slug' => $societe['slug'], 'nom' => $societe['nom'],
    'file' => kgp_tenant_file($societe['slug']),
    'cookiePath' => $base . '/' . $societe['slug'] . '/',
  ];
}

/* ---------------- console Kayely Group ---------------- */

// Code d'installation : écrit dans un fichier du dossier des données (lisible seulement
// par le propriétaire de l'hébergement via le Gestionnaire de fichiers). Il est demandé
// pour créer le mot de passe de la console : un visiteur ne peut donc pas s'en emparer.
function kgp_console_code_file(): string { return kgp_data_dir() . '/CODE-CONSOLE.txt'; }
function kgp_console_code(): string {
  $f = kgp_console_code_file();
  if (!is_file($f)){
    kgp_prepare_dir(dirname($f));
    $code = strtoupper(substr(bin2hex(random_bytes(6)), 0, 10));
    file_put_contents($f, "Code d'installation de la console KAYELY GESTION PRO :\n\n    $code\n\nCe fichier est supprimé automatiquement une fois la console configurée.\n");
    @chmod($f, 0600);
  }
  preg_match('/^\s{4}([A-F0-9]{10})$/m', (string)file_get_contents($f), $m);
  return $m[1] ?? '';
}

function kgp_console_cookie(string $value, int $maxAge, string $base): void {
  setcookie(KGP_CONSOLE_COOKIE, $value, [
    'expires' => $maxAge > 0 ? time() + $maxAge : time() - 3600,
    'path' => $base . '/console/', 'secure' => kgp_is_https(), 'httponly' => true, 'samesite' => 'Strict',
  ]);
}
function kgp_console_logged_in(): ?string {
  $t = $_COOKIE[KGP_CONSOLE_COOKIE] ?? '';
  if (!is_string($t) || $t === '') return null;
  $h = kgp_token_hash($t);
  $db = kgp_platform_db();
  $db->prepare('DELETE FROM console_sessions WHERE last_seen < ? OR created_at < ?')->execute([time() - 2 * 3600, time() - 24 * 3600]);
  $st = $db->prepare('SELECT 1 FROM console_sessions WHERE token_hash = ?'); $st->execute([$h]);
  if (!$st->fetchColumn()) return null;
  $db->prepare('UPDATE console_sessions SET last_seen = ? WHERE token_hash = ?')->execute([time(), $h]);
  return $h;
}
function kgp_console_start_session(string $base): void {
  $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
  kgp_platform_db()->prepare('INSERT INTO console_sessions (token_hash, created_at, last_seen) VALUES (?, ?, ?)')
    ->execute([kgp_token_hash($token), time(), time()]);
  kgp_console_cookie($token, 24 * 3600, $base);
}
function kgp_console_blocked(string $k): bool {
  $st = kgp_platform_db()->prepare('SELECT n, first FROM console_fails WHERE k = ?'); $st->execute([$k]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  if (!$r) return false;
  if (time() - (int)$r['first'] > KGP_LOGIN_WINDOW){ kgp_platform_db()->prepare('DELETE FROM console_fails WHERE k = ?')->execute([$k]); return false; }
  return (int)$r['n'] >= KGP_LOGIN_MAX_FAILS;
}
function kgp_console_fail(string $k): void {
  $db = kgp_platform_db();
  $st = $db->prepare('SELECT first FROM console_fails WHERE k = ?'); $st->execute([$k]);
  $first = $st->fetchColumn();
  if ($first === false || time() - (int)$first > KGP_LOGIN_WINDOW) $db->prepare('INSERT OR REPLACE INTO console_fails (k, n, first) VALUES (?, 1, ?)')->execute([$k, time()]);
  else $db->prepare('UPDATE console_fails SET n = n + 1 WHERE k = ?')->execute([$k]);
}
function kgp_console_password_problem($pw): ?string {
  if (!is_string($pw) || kgp_strlen($pw) < KGP_CONSOLE_MIN_PASSWORD) return 'Le mot de passe de la console doit contenir au moins ' . KGP_CONSOLE_MIN_PASSWORD . ' caractères.';
  if (strlen($pw) > 200) return 'Mot de passe trop long.';
  return null;
}

// Statistiques d'une société (lues dans SA base, sans la modifier).
function kgp_societe_infos(array $s): array {
  $file = kgp_tenant_file($s['slug']);
  $users = 0; $admins = 0;
  if (is_file($file)){
    $pdo = new PDO('sqlite:' . $file, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $st = $pdo->query("SELECT data FROM records WHERE store = 'utilisateurs'");
    foreach ($st ? $st->fetchAll(PDO::FETCH_COLUMN) : [] as $d){
      $u = json_decode($d, true); $users++;
      if (($u['role'] ?? '') === KGP_ADMIN) $admins++;
    }
  }
  return $s + [
    'utilisateurs' => $users,
    'administrateurConfigure' => $admins > 0,
    'tailleOctets' => is_file($file) ? filesize($file) : 0,
  ];
}

function kgp_handle_console_api(string $p, string $base): void {
  try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    kgp_assert_same_origin($method);
    $configured = kgp_config_get('console_password') !== null;

    if ($p === '/api/status' && $method === 'GET'){
      if (!$configured) kgp_console_code(); // crée le fichier du code d'installation
      kgp_send(['configured' => $configured, 'loggedIn' => $configured && kgp_console_logged_in() !== null]);
      return;
    }
    if ($p === '/api/setup' && $method === 'POST'){
      if ($configured) throw new HttpError(409, 'La console est déjà configurée.');
      $b = kgp_body();
      $key = 'setup|' . ($_SERVER['REMOTE_ADDR'] ?? '');
      if (kgp_console_blocked($key)) throw new HttpError(429, 'Trop de tentatives : réessayez dans 15 minutes.');
      $code = kgp_console_code();
      if ($code === '' || !hash_equals($code, strtoupper(trim((string)($b['code'] ?? ''))))){
        kgp_console_fail($key);
        throw new ValidationError(["Code d'installation incorrect."]);
      }
      if ($pb = kgp_console_password_problem($b['password'] ?? null)) throw new ValidationError([$pb]);
      kgp_config_set('console_password', password_hash($b['password'], PASSWORD_DEFAULT));
      @unlink(kgp_console_code_file());
      kgp_console_audit('setup');
      kgp_console_start_session($base);
      kgp_send(['ok' => true]);
      return;
    }
    if ($p === '/api/login' && $method === 'POST'){
      if (!$configured) throw new HttpError(409, "La console n'est pas encore configurée.");
      $b = kgp_body();
      $key = 'login|' . ($_SERVER['REMOTE_ADDR'] ?? '');
      if (kgp_console_blocked($key)) throw new HttpError(429, 'Trop de tentatives : réessayez dans 15 minutes.');
      if (!password_verify((string)($b['password'] ?? ''), (string)kgp_config_get('console_password'))){
        kgp_console_fail($key);
        throw new HttpError(401, 'Mot de passe incorrect.');
      }
      kgp_console_audit('login');
      kgp_console_start_session($base);
      kgp_send(['ok' => true]);
      return;
    }
    if ($p === '/api/logout' && $method === 'POST'){
      $t = $_COOKIE[KGP_CONSOLE_COOKIE] ?? '';
      if (is_string($t) && $t !== '') kgp_platform_db()->prepare('DELETE FROM console_sessions WHERE token_hash = ?')->execute([kgp_token_hash($t)]);
      kgp_console_cookie('', 0, $base);
      kgp_send(['ok' => true]);
      return;
    }

    $session = kgp_console_logged_in();
    if (!$session) throw new HttpError(401, 'Session expirée : reconnectez-vous.');

    if ($p === '/api/password' && $method === 'POST'){
      $b = kgp_body();
      if (!password_verify((string)($b['current'] ?? ''), (string)kgp_config_get('console_password'))) throw new ValidationError(['Mot de passe actuel incorrect.']);
      if ($pb = kgp_console_password_problem($b['password'] ?? null)) throw new ValidationError([$pb]);
      kgp_config_set('console_password', password_hash($b['password'], PASSWORD_DEFAULT));
      kgp_platform_db()->prepare('DELETE FROM console_sessions WHERE token_hash <> ?')->execute([$session]);
      kgp_console_audit('password');
      kgp_send(['ok' => true]);
      return;
    }

    if ($p === '/api/societes' && $method === 'GET'){
      $rows = kgp_platform_db()->query('SELECT slug, nom, statut, cree_le FROM societes ORDER BY nom')->fetchAll(PDO::FETCH_ASSOC);
      kgp_send(array_map('kgp_societe_infos', $rows));
      return;
    }
    if ($p === '/api/societes' && $method === 'POST'){
      $b = kgp_body();
      $slug = strtolower(trim((string)($b['slug'] ?? '')));
      $nom = trim((string)($b['nom'] ?? ''));
      $errors = [];
      if (!preg_match(KGP_SLUG_RE, $slug)) $errors[] = 'Code société : 1 à 40 caractères, lettres minuscules, chiffres et tirets (ex. cabinet-abc).';
      elseif (in_array($slug, KGP_RESERVED, true)) $errors[] = "Le code « $slug » est réservé.";
      if ($nom === '' || kgp_strlen($nom) > 120) $errors[] = 'Nom de la société : obligatoire (120 caractères maximum).';
      if ($errors) throw new ValidationError($errors);
      kgp_transaction_platform(function () use ($slug, $nom){
        if (kgp_find_societe($slug)) throw new ValidationError(["Le code « $slug » est déjà utilisé."]);
        if (is_file(kgp_tenant_file($slug))) throw new ValidationError(["Une base « $slug » existe déjà sur le disque : choisissez un autre code."]);
        kgp_platform_db()->prepare('INSERT INTO societes (slug, nom, statut, cree_le) VALUES (?, ?, ?, ?)')->execute([$slug, $nom, 'Active', time()]);
      });
      // Crée tout de suite la base vide et séparée de la société.
      kgp_use_tenant(['slug' => $slug, 'nom' => $nom], $base);
      kgp_db();
      kgp_console_audit('create', $slug);
      kgp_send(kgp_societe_infos(kgp_find_societe($slug)));
      return;
    }
    if (preg_match('#^/api/societes/([a-z0-9-]+)/(statut|nom|reinitialiser)$#', $p, $m) && $method === 'POST'){
      $s = kgp_find_societe($m[1]);
      if (!$s) throw new HttpError(404, 'Société inconnue');
      $b = kgp_body();
      if ($m[2] === 'statut'){
        $statut = $b['statut'] ?? '';
        if (!in_array($statut, ['Active', 'Suspendue'], true)) throw new ValidationError(['Statut invalide.']);
        kgp_platform_db()->prepare('UPDATE societes SET statut = ? WHERE slug = ?')->execute([$statut, $s['slug']]);
        kgp_console_audit('statut', $s['slug'] . ' ' . $statut);
      } elseif ($m[2] === 'nom'){
        $nom = trim((string)($b['nom'] ?? ''));
        if ($nom === '' || kgp_strlen($nom) > 120) throw new ValidationError(['Nom de la société : obligatoire (120 caractères maximum).']);
        kgp_platform_db()->prepare('UPDATE societes SET nom = ? WHERE slug = ?')->execute([$nom, $s['slug']]);
        kgp_console_audit('nom', $s['slug']);
      } else {
        // Administrateur de la société qui a perdu son code : code provisoire à changer à la connexion.
        kgp_use_tenant($s, $base);
        $admin = null;
        foreach (kgp_all('utilisateurs') as $u) if (($u['role'] ?? '') === KGP_ADMIN){ $admin = $u; break; }
        if (!$admin) throw new ValidationError(["Cette société n'a pas encore d'administrateur : il sera créé à la première ouverture de son adresse."]);
        $temp = 'Kgp-' . substr(strtr(base64_encode(random_bytes(9)), '+/', 'xy'), 0, 10);
        $admin['motDePasseHash'] = kgp_hash_password($temp);
        $admin['doitChangerMotDePasse'] = true;
        $admin['statut'] = 'Actif';
        $admin['dateExpiration'] = '';
        kgp_put('utilisateurs', $admin['id'], $admin, null);
        kgp_delete_other_sessions($admin['id']);
        kgp_audit(null, 'reset-console', 'utilisateurs', $admin['id']);
        kgp_console_audit('reset', $s['slug']);
        kgp_send(['login' => $admin['login'], 'codeProvisoire' => $temp]);
        return;
      }
      kgp_send(kgp_societe_infos(kgp_find_societe($s['slug'])));
      return;
    }
    throw new HttpError(404, 'Route inconnue');
  } catch (ValidationError $e){
    kgp_send(['error' => $e->getMessage(), 'errors' => $e->errors], 422);
  } catch (HttpError $e){
    kgp_send(['error' => $e->getMessage()], $e->status);
  } catch (Throwable $e){
    error_log('[KGP console] ' . $e);
    kgp_send(['error' => 'Erreur interne du serveur'], 500);
  }
}
function kgp_transaction_platform(callable $fn){
  $db = kgp_platform_db();
  $db->exec('BEGIN IMMEDIATE');
  try { $r = $fn(); $db->exec('COMMIT'); return $r; }
  catch (Throwable $e){ $db->exec('ROLLBACK'); throw $e; }
}

/* ---------------- aiguillage des adresses ---------------- */

function kgp_html_page(string $file, int $status = 200, array $vars = []): void {
  http_response_code($status);
  kgp_security_headers();
  header('Content-Type: text/html; charset=utf-8');
  $html = (string)file_get_contents(__DIR__ . '/' . $file);
  foreach ($vars as $k => $v) $html = str_replace('{{' . $k . '}}', htmlspecialchars($v, ENT_QUOTES, 'UTF-8'), $html);
  echo $html;
}

function kgp_route(): void {
  try {
    $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $path = rawurldecode($path);
    if ($base !== '' && strpos($path, $base . '/') === 0) $path = substr($path, strlen($base));
    if ($path === '/index.php' || $path === '/api.php') $path = '/';
    $isApi = fn(string $rest) => strpos($rest, '/api/') !== false;
    $apiPart = fn(string $rest) => substr($rest, strpos($rest, '/api/'));

    if ($path === '/' || $path === ''){ kgp_html_page('accueil.html', 200, ['BASE' => $base]); return; }

    $slash = strpos($path, '/', 1);
    $first = $slash === false ? substr($path, 1) : substr($path, 1, $slash - 1);
    $rest = $slash === false ? '' : substr($path, $slash);

    if ($first === 'console'){
      if ($isApi($rest)){ kgp_handle_console_api($apiPart($rest), $base); return; }
      if ($rest === ''){ header('Location: ' . $base . '/console/', true, 301); return; }
      kgp_html_page('console.html', 200, ['BASE' => $base]);
      return;
    }

    $slug = strtolower($first);
    $societe = (preg_match(KGP_SLUG_RE, $slug) && !in_array($slug, KGP_RESERVED, true)) ? kgp_find_societe($slug) : null;
    if (!$societe){
      if ($isApi($rest)){ kgp_send(['error' => "Société inconnue : vérifiez l'adresse."], 404); return; }
      kgp_html_page('accueil.html', 404, ['BASE' => $base]);
      return;
    }
    if ($first !== $slug || $rest === ''){ header('Location: ' . $base . '/' . $slug . '/', true, 301); return; }
    if ($societe['statut'] !== 'Active'){
      if ($isApi($rest)){ kgp_send(['error' => "L'accès de cette société est suspendu. Contactez Kayely Group."], 403); return; }
      kgp_html_page('suspendue.html', 403, ['NOM' => $societe['nom']]);
      return;
    }
    kgp_use_tenant($societe, $base);
    if ($isApi($rest)){ kgp_handle_api($apiPart($rest)); return; }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET'){ kgp_send(['error' => 'Méthode non autorisée'], 405); return; }
    kgp_serve_app();
  } catch (HttpError $e){
    kgp_send(['error' => $e->getMessage()], $e->status);
  } catch (Throwable $e){
    error_log('[KGP] ' . $e);
    kgp_send(['error' => 'Erreur interne du serveur'], 500);
  }
}
