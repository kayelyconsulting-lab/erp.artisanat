<?php
// Serveur PHP de KAYELY GESTION PRO (équivalent de serveur/server.mjs).
// Authentification, droits par rôle et vérification de chaque donnée, stockage SQLite.
declare(strict_types=1);
require __DIR__ . '/validation.php';

// Jamais de détail technique dans les réponses (chemins, traces) : tout part dans le
// journal du serveur, sans les arguments des fonctions (codes secrets, fiches...).
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('html_errors', '0');
ini_set('log_errors', '1');
ini_set('zend.exception_ignore_args', '1');

/* Message sans données personnelles ni chemins : adresses e-mail, numéros longs
   (téléphones, comptes) et chemins de fichiers masqués, longueur limitée. */
function kgp_message_sur(string $m): string {
  $m = preg_replace('/[\w.+\-]+@[\w\-]+(\.[\w\-]+)+/u', '[email]', $m);
  $m = preg_replace('#(?:[A-Za-z]:)?(?:[\\/][\w.\-]+){2,}#u', '[chemin]', $m);
  $m = preg_replace('/\b\d[\d .]{6,}\d\b/u', '[numéro]', $m);
  $m = preg_replace('/\s+/u', ' ', $m);
  return function_exists('mb_substr') ? mb_substr($m, 0, 300) : substr($m, 0, 300);
}
/* Journalise une erreur inattendue sous une référence courte (communiquée à
   l'utilisateur), sans trace ni données saisies. */
function kgp_incident(Throwable $e, string $contexte): string {
  $ref = strtoupper(bin2hex(random_bytes(4)));
  error_log(sprintf('[KGP %s] %s — %s : %s (%s:%d)', $ref, $contexte, get_class($e),
    kgp_message_sur($e->getMessage()), basename($e->getFile()), $e->getLine()));
  return $ref;
}
function kgp_message_incident(string $ref): string {
  return "Erreur interne du serveur (réf. $ref). Réessayez ; si le problème persiste, communiquez cette référence à Kayely Group.";
}
/* Identifiants d'anti-force brute (adresse IP + identifiant) : jamais stockés en clair. */
function kgp_cle_anonyme(string $k): string { return hash('sha256', 'kgp-tentatives|' . $k); }

const KGP_IDLE = 12 * 3600;          // déconnexion après 12 h d'inactivité
const KGP_ABSOLUTE = 7 * 24 * 3600;
const KGP_MAX_BODY = 8 * 1024 * 1024;
const KGP_ADMIN = 'Administrateur';
const KGP_GERANT = 'Gérant';
const KGP_LEGACY_PASSWORDS = ['kayely123'];
const KGP_MIN_PASSWORD = 8;
const KGP_LOGIN_MAX_FAILS = 5;
const KGP_LOGIN_WINDOW = 15 * 60;

final class HttpError extends Exception {
  public int $status;
  public function __construct(int $status, string $message){ parent::__construct($message); $this->status = $status; }
}

/* ---------------- stockage ---------------- */

// Dossier des données : KGP_DATA_DIR, sinon à côté du site (hors de la partie publique)
// si c'est possible, sinon dans « donnees/ » protégé par .htaccess.
// Dossier des données : KGP_DATA_DIR, sinon « kgpro-donnees » hors de la partie publique
// du site (à côté de htdocs / public_html / www), sinon « donnees/ » protégé par .htaccess.
function kgp_data_dir(): string {
  $env = getenv('KGP_DATA_DIR');
  if ($env) return rtrim($env, '/');
  $appDir = dirname(__DIR__);
  $candidates = [];
  $dir = $appDir;
  while (($parent = dirname($dir)) !== $dir){
    if (in_array(strtolower(basename($dir)), ['htdocs', 'public_html', 'www', 'httpdocs'], true)){ $candidates[] = $parent . '/kgpro-donnees'; break; }
    $dir = $parent;
  }
  $candidates[] = dirname($appDir) . '/kgpro-donnees';
  foreach ($candidates as $c){
    if (is_dir($c) && is_writable($c)) return $c;
    if (!is_dir($c) && is_writable(dirname($c)) && @mkdir($c, 0700)) return $c;
  }
  return $appDir . '/donnees';
}

// Prépare le dossier des données (protégé même s'il est dans la partie publique).
function kgp_prepare_dir(string $dir): void {
  if (!is_dir($dir) && !@mkdir($dir, 0700, true)){
    error_log('[KGP] dossier des données impossible à créer (droits d\'écriture à vérifier)');
    throw new HttpError(500, "Impossible de créer le dossier des données : vérifiez les droits d'écriture de l'hébergement.");
  }
  if (!file_exists("$dir/.htaccess")) @file_put_contents("$dir/.htaccess", "Require all denied\nDeny from all\n");
  if (!file_exists("$dir/index.html")) @file_put_contents("$dir/index.html", '');
}

function kgp_open_sqlite(string $file): PDO {
  if (!in_array('sqlite', PDO::getAvailableDrivers(), true)){
    throw new HttpError(500, "L'extension PHP pdo_sqlite n'est pas activée sur l'hébergement (Configuration php).");
  }
  kgp_prepare_dir(dirname($file));
  $pdo = new PDO('sqlite:' . $file, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
  $pdo->exec('PRAGMA busy_timeout = 5000');
  $pdo->exec('PRAGMA journal_mode = WAL');
  return $pdo;
}

// Société en cours : chaque société a SA base (fichier SQLite séparé), ses sessions et son cookie.
$GLOBALS['KGP_TENANT'] = null; // ['slug' => ..., 'nom' => ..., 'file' => ..., 'cookiePath' => ...]
function kgp_tenant(): array {
  if (!$GLOBALS['KGP_TENANT']) throw new HttpError(404, 'Société inconnue');
  return $GLOBALS['KGP_TENANT'];
}
function kgp_cookie_name(): string { return 'kgp_s_' . str_replace('-', '_', kgp_tenant()['slug']); }

function kgp_db(): PDO {
  static $pdos = [];
  $file = kgp_tenant()['file'];
  if (isset($pdos[$file])) return $pdos[$file];
  $pdo = kgp_open_sqlite($file);
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS records (store TEXT NOT NULL, id INTEGER NOT NULL, data TEXT NOT NULL,
      updated_at INTEGER NOT NULL, updated_by INTEGER, PRIMARY KEY (store, id));
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (at INTEGER NOT NULL, user_id INTEGER, action TEXT NOT NULL, store TEXT, record_id INTEGER);
    CREATE TABLE IF NOT EXISTS login_fails (k TEXT PRIMARY KEY, n INTEGER NOT NULL, first INTEGER NOT NULL);
  ");
  // anciennes entrées en clair (adresse IP + identifiant) : supprimées
  $pdo->exec("DELETE FROM login_fails WHERE length(k) <> 64 OR k GLOB '*[^0-9a-f]*'");
  return $pdos[$file] = $pdo;
}

function kgp_all(string $store): array {
  $st = kgp_db()->prepare('SELECT id, data FROM records WHERE store = ? ORDER BY id');
  $st->execute([$store]);
  $out = [];
  foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r){ $d = json_decode($r['data'], true); $d['id'] = (int)$r['id']; $out[] = $d; }
  return $out;
}
function kgp_get(string $store, int $id): ?array {
  $st = kgp_db()->prepare('SELECT data FROM records WHERE store = ? AND id = ?');
  $st->execute([$store, $id]);
  $data = $st->fetchColumn(); $st->closeCursor();
  if ($data === false) return null;
  $d = json_decode($data, true); $d['id'] = $id; return $d;
}
function kgp_count(string $store): int {
  $st = kgp_db()->prepare('SELECT COUNT(*) FROM records WHERE store = ?'); $st->execute([$store]); $n = (int)$st->fetchColumn(); $st->closeCursor(); return $n;
}
function kgp_next_id(string $store): int {
  $st = kgp_db()->prepare('SELECT COALESCE(MAX(id), 0) FROM records WHERE store = ?'); $st->execute([$store]); $n = (int)$st->fetchColumn(); $st->closeCursor(); return $n + 1;
}
function kgp_put(string $store, int $id, array $data, ?int $userId): void {
  unset($data['id']);
  $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
  $st = kgp_db()->prepare('INSERT INTO records (store, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(store, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by');
  $st->execute([$store, $id, $json, time(), $userId]);
}
function kgp_delete(string $store, int $id): bool {
  $st = kgp_db()->prepare('DELETE FROM records WHERE store = ? AND id = ?'); $st->execute([$store, $id]); return $st->rowCount() > 0;
}
function kgp_audit(?int $userId, string $action, ?string $store = null, ?int $id = null): void {
  kgp_db()->prepare('INSERT INTO audit (at, user_id, action, store, record_id) VALUES (?, ?, ?, ?, ?)')
    ->execute([time(), $userId, $action, $store, $id]);
}
function kgp_transaction(callable $fn){
  $db = kgp_db();
  $db->exec('BEGIN IMMEDIATE');
  try { $r = $fn(); $db->exec('COMMIT'); return $r; }
  catch (Throwable $e){ $db->exec('ROLLBACK'); throw $e; }
}

/* ---------------- schéma ---------------- */

function kgp_schema(): array {
  static $s = null;
  if (!$s) $s = json_decode(file_get_contents(__DIR__ . '/schema.json'), true, 512, JSON_THROW_ON_ERROR);
  return $s;
}
function kgp_module(string $store): array {
  $m = kgp_schema()['modules'][$store] ?? null;
  if (!$m) throw new HttpError(404, 'Module inconnu');
  return $m;
}

/* ---------------- utilisateurs et mots de passe ---------------- */

function kgp_public_user(?array $u): ?array {
  if (!$u) return null;
  unset($u['motDePasseHash']); $u['motDePasse'] = ''; return $u;
}
function kgp_is_expired(array $u): bool {
  $d = $u['dateExpiration'] ?? '';
  if (!$d) return false;
  return $d < date('Y-m-d');
}
function kgp_is_active(?array $u): bool { return $u && ($u['statut'] ?? 'Actif') === 'Actif' && !kgp_is_expired($u); }
function kgp_find_by_login($login): ?array {
  $l = kgp_lower(trim((string)$login));
  foreach (kgp_all('utilisateurs') as $u) if (kgp_lower($u['login'] ?? '') === $l) return $u;
  return null;
}
function kgp_password_problem($pw): ?string {
  if (!is_string($pw) || kgp_strlen($pw) < KGP_MIN_PASSWORD) return 'Le code secret doit contenir au moins ' . KGP_MIN_PASSWORD . ' caractères.';
  if (strlen($pw) > 200) return 'Code secret trop long.';
  if (in_array($pw, KGP_LEGACY_PASSWORDS, true)) return 'Ce code secret est interdit : choisissez-en un autre.';
  return null;
}
function kgp_hash_password(string $pw): string { return password_hash($pw, PASSWORD_DEFAULT); }
function kgp_verify_password($pw, $hash): bool {
  // Hachage factice si l'utilisateur n'existe pas : temps de réponse identique.
  static $dummy = null;
  if (!is_string($hash) || $hash === ''){ $dummy ??= password_hash(bin2hex(random_bytes(8)), PASSWORD_DEFAULT); password_verify((string)$pw, $dummy); return false; }
  return password_verify((string)$pw, $hash);
}
function kgp_active_admins_except(int $id, ?array $replacement): int {
  $n = 0;
  foreach (kgp_all('utilisateurs') as $u){
    if ($u['id'] === $id) $u = $replacement;
    if ($u && ($u['role'] ?? '') === KGP_ADMIN && kgp_is_active($u)) $n++;
  }
  return $n;
}

/* ---------------- sessions ---------------- */

function kgp_is_https(): bool {
  return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}
function kgp_set_cookie(string $value, int $maxAge): void {
  setcookie(kgp_cookie_name(), $value, [
    'expires' => $maxAge > 0 ? time() + $maxAge : time() - 3600,
    'path' => kgp_tenant()['cookiePath'], 'secure' => kgp_is_https(), 'httponly' => true, 'samesite' => 'Strict',
  ]);
}
function kgp_token_hash(string $t): string { return hash('sha256', $t); }
function kgp_start_session(array $user): void {
  $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
  kgp_db()->prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
    ->execute([kgp_token_hash($token), $user['id'], time(), time()]);
  kgp_set_cookie($token, KGP_ABSOLUTE);
}
function kgp_delete_other_sessions(int $userId, string $keepHash = ''): void {
  kgp_db()->prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')->execute([$userId, $keepHash]);
}
function kgp_current_session(): ?array {
  $token = $_COOKIE[kgp_cookie_name()] ?? '';
  if (!is_string($token) || $token === '') return null;
  $hash = kgp_token_hash($token);
  $db = kgp_db();
  $db->prepare('DELETE FROM sessions WHERE last_seen < ?')->execute([time() - KGP_IDLE]);
  $st = $db->prepare('SELECT user_id, created_at, last_seen FROM sessions WHERE token_hash = ?');
  $st->execute([$hash]);
  $s = $st->fetch(PDO::FETCH_ASSOC); $st->closeCursor();
  if (!$s) return null;
  if (time() - (int)$s['created_at'] > KGP_ABSOLUTE){ $db->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([$hash]); return null; }
  $user = kgp_get('utilisateurs', (int)$s['user_id']);
  if (!kgp_is_active($user)){ $db->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([$hash]); return null; }
  $db->prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?')->execute([time(), $hash]);
  return ['hash' => $hash, 'user' => $user];
}

/* ---------------- limitation des tentatives ---------------- */

function kgp_login_blocked(string $k, int $max = KGP_LOGIN_MAX_FAILS): bool {
  $k = kgp_cle_anonyme($k);
  $st = kgp_db()->prepare('SELECT n, first FROM login_fails WHERE k = ?'); $st->execute([$k]);
  $r = $st->fetch(PDO::FETCH_ASSOC); $st->closeCursor();
  if (!$r) return false;
  if (time() - (int)$r['first'] > KGP_LOGIN_WINDOW){ kgp_db()->prepare('DELETE FROM login_fails WHERE k = ?')->execute([$k]); return false; }
  return (int)$r['n'] >= $max;
}
function kgp_login_fail(string $k): void {
  $k = kgp_cle_anonyme($k);
  $st = kgp_db()->prepare('SELECT first FROM login_fails WHERE k = ?'); $st->execute([$k]);
  $first = $st->fetchColumn(); $st->closeCursor();
  if ($first === false || time() - (int)$first > KGP_LOGIN_WINDOW){
    kgp_db()->prepare('INSERT OR REPLACE INTO login_fails (k, n, first) VALUES (?, 1, ?)')->execute([$k, time()]);
  } else {
    kgp_db()->prepare('UPDATE login_fails SET n = n + 1 WHERE k = ?')->execute([$k]);
  }
}
function kgp_login_reset(string $k): void { $k = kgp_cle_anonyme($k); kgp_db()->prepare('DELETE FROM login_fails WHERE k = ?')->execute([$k]); }

/* ---------------- droits ---------------- */

function kgp_is_admin(array $u): bool { return ($u['role'] ?? '') === KGP_ADMIN; }
function kgp_is_gerant_or_admin(array $u): bool { return in_array($u['role'] ?? '', [KGP_ADMIN, KGP_GERANT], true); }
/* Caissier(e) : pas d'accès aux données du personnel (RH, paie), pas de modification du
   plan comptable ni des immobilisations ; dans le journal, seulement les écritures générées
   par ses propres pièces (champ « source »). */
const KGP_CAISSIER = 'Caissier(e)';
const KGP_SECTIONS_CONFIDENTIELLES = ['rh', 'paie'];
const KGP_ECRITURE_INTERDITE_CAISSIER = ['planComptable', 'immobilisations'];
function kgp_peut_lire(array $user, array $mod): bool {
  return !(($user['role'] ?? '') === KGP_CAISSIER && in_array($mod['section'] ?? '', KGP_SECTIONS_CONFIDENTIELLES, true));
}
function kgp_assert_can_write(array $user, array $mod, $input = null): void {
  if ($mod['key'] === 'utilisateurs' || !empty($mod['adminOnly'])) $ok = kgp_is_admin($user);
  elseif (($mod['section'] ?? '') === 'parametres') $ok = kgp_is_gerant_or_admin($user);
  else $ok = true;
  if ($ok && ($user['role'] ?? '') === KGP_CAISSIER){
    if (in_array($mod['section'] ?? '', KGP_SECTIONS_CONFIDENTIELLES, true) || in_array($mod['key'], KGP_ECRITURE_INTERDITE_CAISSIER, true)) $ok = false;
    if ($mod['key'] === 'journal' && !(is_array($input) && is_string($input['source'] ?? null) && $input['source'] !== '')) $ok = false;
  }
  if (!$ok) throw new HttpError(403, 'Action non autorisée pour votre rôle.');
}

/* ---------------- clôture de période ----------------
   Société > « Période comptable clôturée jusqu'au » : aucune pièce datée avant (incluse)
   ne peut plus être créée, modifiée ni supprimée. */
const KGP_LOCK_DATE_FIELDS = ['factures' => 'date', 'avoirs' => 'date', 'facturesAchat' => 'date', 'stockEntrees' => 'date', 'reglements' => 'date',
  'stockSorties' => 'date', 'treso_caisse' => 'date', 'journal' => 'date', 'immobilisations' => 'dateAcquisition', 'paieCalcul' => 'periode'];
function kgp_piece_date(string $store, ?array $r): string {
  $f = KGP_LOCK_DATE_FIELDS[$store] ?? null;
  if (!$f || !$r || !is_string($r[$f] ?? null)) return '';
  if ($f !== 'periode') return $r[$f];
  if (!preg_match('/^\s*(\d{1,2})\s*\/\s*(\d{4})\s*$/', $r[$f], $m)) return '';
  $mois = (int)$m[1]; $annee = (int)$m[2];
  if ($mois < 1 || $mois > 12) return '';
  return sprintf('%04d-%02d-%02d', $annee, $mois, cal_days_in_month_safe($mois, $annee));
}
function cal_days_in_month_safe(int $mois, int $annee): int { return (int)date('t', mktime(0, 0, 0, $mois, 1, $annee)); }
function kgp_lock_date(): string {
  $s = kgp_get('societe', 1);
  return $s && is_string($s['dateCloture'] ?? null) ? $s['dateCloture'] : '';
}
function kgp_assert_open(string $store, ?array $r): void {
  $lock = kgp_lock_date(); $d = kgp_piece_date($store, $r);
  if ($lock !== '' && $d !== '' && $d <= $lock) throw new ValidationError(["Période clôturée jusqu'au $lock : une pièce du $d ne peut plus être créée, modifiée ni supprimée."]);
}

/* ---------------- opérations sur les données ---------------- */

function kgp_list(array $user, string $store): array {
  $mod = kgp_module($store);
  if (!kgp_peut_lire($user, $mod)) throw new HttpError(403, 'Accès non autorisé pour votre rôle.');
  if ($mod['key'] === 'utilisateurs'){
    $all = array_map('kgp_public_user', kgp_all('utilisateurs'));
    return kgp_is_gerant_or_admin($user) ? $all : array_values(array_filter($all, fn($u) => $u['id'] === $user['id']));
  }
  return kgp_all($mod['key']);
}

function kgp_save(array $user, string $store, $input, string $sessionHash): int {
  $mod = kgp_module($store);
  kgp_assert_can_write($user, $mod, $input);
  if (!kgp_is_object($input)) throw new ValidationError(['Enregistrement invalide']);

  return kgp_transaction(function () use ($user, $mod, $input, $sessionHash){
    $id = $input['id'] ?? null;
    if (!empty($mod['single'])) $id = 1;
    if ($id !== null && !(is_int($id) && $id > 0 && $id < 2 ** 31)) throw new ValidationError(['Identifiant invalide']);
    $existing = $id ? kgp_get($mod['key'], $id) : null;
    if (!$id) $id = kgp_next_id($mod['key']);

    $lookups = [];
    $record = kgp_validate_record($mod, $input, [
      'existing' => $existing,
      'lookup' => function (string $source, string $field) use (&$lookups){
        $k = "$source.$field";
        if (!isset($lookups[$k])){
          $lookups[$k] = [];
          foreach (kgp_all($source) as $r) if (is_string($r[$field] ?? null)) $lookups[$k][$r[$field]] = true;
        }
        return $lookups[$k];
      },
      'numeroPrefix' => kgp_schema()['numeroPrefixes'][$mod['key']] ?? null,
      'numeroTaken' => function (string $numero) use ($mod, $id){
        foreach (kgp_all($mod['key']) as $r) if (($r['numero'] ?? null) === $numero && $r['id'] !== $id) return true;
        return false;
      },
    ]);

    if ($mod['key'] === 'utilisateurs'){
      $other = kgp_find_by_login($record['login']);
      if ($other && $other['id'] !== $id) throw new ValidationError(["L'identifiant « {$record['login']} » est déjà utilisé"]);
      $pw = $input['motDePasse'] ?? '';
      if ($pw !== '' && $pw !== null){
        if ($p = kgp_password_problem($pw)) throw new ValidationError([$p]);
        $record['motDePasseHash'] = kgp_hash_password($pw);
        // Un administrateur qui fixe le code d'un autre compte : celui-ci devra le changer.
        $record['doitChangerMotDePasse'] = $id !== $user['id'];
        if ($existing) kgp_delete_other_sessions($id, $id === $user['id'] ? $sessionHash : '');
      } elseif ($existing && !empty($existing['motDePasseHash'])){
        $record['motDePasseHash'] = $existing['motDePasseHash'];
        $record['doitChangerMotDePasse'] = !empty($existing['doitChangerMotDePasse']);
      } else {
        throw new ValidationError(['Code secret : champ obligatoire']);
      }
      if (kgp_active_admins_except($id, $record + ['id' => $id]) === 0) throw new ValidationError(['Il doit rester au moins un administrateur actif.']);
    }

    kgp_assert_open($mod['key'], $existing);
    kgp_assert_open($mod['key'], $record);
    if ($mod['key'] === 'societe' && $existing && !empty($existing['dateCloture']) && !kgp_is_admin($user)
        && (empty($record['dateCloture']) || $record['dateCloture'] < $existing['dateCloture'])){
      throw new HttpError(403, "Seul l'administrateur peut rouvrir une période clôturée.");
    }
    kgp_put($mod['key'], $id, $record, $user['id']);
    kgp_audit($user['id'], $existing ? 'update' : 'create', $mod['key'], $id);
    return $id;
  });
}

function kgp_remove(array $user, string $store, int $id): bool {
  $mod = kgp_module($store);
  if ($id <= 0) throw new ValidationError(['Identifiant invalide']);
  if (!kgp_is_admin($user)){
    // Écritures / mouvements générés automatiquement (« source » ou « auto ») : remplacés quand
    // leur pièce est modifiée, donc supprimables par tout rôle qui peut écrire dans le module.
    $rec = kgp_get($mod['key'], $id);
    $genere = $rec && ((is_string($rec['source'] ?? null) && $rec['source'] !== '') || ($rec['auto'] ?? null) === true);
    if (!$genere || $mod['key'] === 'utilisateurs') throw new HttpError(403, "Suppression réservée à l'administrateur.");
    kgp_assert_can_write($user, $mod, $rec);
  }
  return kgp_transaction(function () use ($user, $mod, $id){
    if ($mod['key'] === 'utilisateurs'){
      if ($id === $user['id']) throw new ValidationError(['Vous ne pouvez pas supprimer votre propre compte.']);
      if (kgp_active_admins_except($id, null) === 0) throw new ValidationError(['Il doit rester au moins un administrateur actif.']);
      kgp_delete_other_sessions($id);
    }
    kgp_assert_open($mod['key'], kgp_get($mod['key'], $id));
    $ok = kgp_delete($mod['key'], $id);
    if ($ok) kgp_audit($user['id'], 'delete', $mod['key'], $id);
    return $ok;
  });
}

/* ---------------- HTTP ---------------- */

/* En-têtes de sécurité. Pages : politique de contenu limitée au site et aux deux CDN
   hébergées avec l'application (Excel, lecture OCR) : aucune source extérieure.
   Réponses JSON : rien ne peut s'y exécuter. */
// Aucune source extérieure : les bibliothèques (Excel, lecture OCR) sont hébergées avec l'application.
const KGP_CSP_PAGE = "default-src 'self'; "
  . "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; "
  . "worker-src 'self'; "
  . "connect-src 'self' data: blob:; "
  . "img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; manifest-src 'self'; "
  . "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
function kgp_security_headers(bool $page = false): void {
  header('Cache-Control: no-store');
  header('X-Content-Type-Options: nosniff');
  header('X-Frame-Options: DENY');
  header('Referrer-Policy: same-origin');
  header('Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  header('Cross-Origin-Opener-Policy: same-origin');
  header('Cross-Origin-Resource-Policy: same-origin');
  header('Content-Security-Policy: ' . ($page ? KGP_CSP_PAGE . (kgp_is_https() ? '; upgrade-insecure-requests' : '') : "default-src 'none'; frame-ancestors 'none'"));
  if (kgp_is_https()) header('Strict-Transport-Security: max-age=31536000');
  header_remove('X-Powered-By');
}

/* CORS : seules les pages servies par ce même domaine (ex. https://erp.kayelygroup.com)
   peuvent appeler l'API. Origines supplémentaires possibles via la variable
   d'environnement KGP_ALLOWED_ORIGINS (liste séparée par des virgules). */
function kgp_origine_autorisee(string $origin): bool {
  $o = parse_url($origin);
  if (!$o || empty($o['host']) || empty($o['scheme'])) return false;
  $hote = strtolower($o['host'] . (isset($o['port']) ? ':' . $o['port'] : ''));
  if ($hote === strtolower($_SERVER['HTTP_HOST'] ?? '') && (!kgp_is_https() || $o['scheme'] === 'https')) return true;
  foreach (array_filter(array_map('trim', explode(',', (string)getenv('KGP_ALLOWED_ORIGINS')))) as $a){
    if (strcasecmp(rtrim($a, '/'), rtrim($origin, '/')) === 0) return true;
  }
  return false;
}
/* À appeler au début de chaque requête d'API. Renvoie true si la réponse est déjà
   envoyée (pré-vérification OPTIONS). Refuse toute requête venant d'un autre site. */
function kgp_cors(string $method): bool {
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  if ($origin !== ''){
    if (!kgp_origine_autorisee($origin)) throw new HttpError(403, 'Origine refusée : seules les pages de ce domaine peuvent utiliser cette API.');
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
    header('Vary: Origin');
  }
  if ($method === 'OPTIONS'){
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 600');
    kgp_security_headers();
    http_response_code(204);
    return true;
  }
  return false;
}
function kgp_send($body, int $status = 200): void {
  http_response_code($status);
  kgp_security_headers();
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
}
function kgp_body(): array {
  $len = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
  if ($len > KGP_MAX_BODY) throw new HttpError(413, 'Données trop volumineuses');
  $raw = file_get_contents('php://input', false, null, 0, KGP_MAX_BODY + 1);
  if ($raw === false || $raw === '') return [];
  if (strlen($raw) > KGP_MAX_BODY) throw new HttpError(413, 'Données trop volumineuses');
  $data = json_decode($raw, true, 64);
  if (json_last_error() !== JSON_ERROR_NONE) throw new HttpError(400, 'JSON invalide');
  return is_array($data) ? $data : throw new HttpError(400, 'JSON invalide');
}
// Anti-CSRF : écritures uniquement en JSON et depuis la même origine.
function kgp_assert_same_origin(string $method): void {
  if (!in_array($method, ['POST', 'PUT', 'DELETE'], true)) return;
  $ct = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
  if ($method !== 'DELETE' && strpos($ct, 'application/json') !== 0) throw new HttpError(415, 'JSON attendu');
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  if ($origin !== '' && !kgp_origine_autorisee($origin)) throw new HttpError(403, 'Origine refusée');
}

// $p : chemin à partir de « /api/ » (ex. /api/data/clients), pour la société en cours.
function kgp_handle_api(string $p): void {
  try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (kgp_cors($method)) return;
    kgp_tenant();
    kgp_assert_same_origin($method);

    if ($p === '/api/status' && $method === 'GET'){ kgp_send(['server' => true, 'needsSetup' => kgp_count('utilisateurs') === 0]); return; }

    if ($p === '/api/setup' && $method === 'POST'){
      $b = kgp_body();
      $user = kgp_transaction(function () use ($b){
        if (kgp_count('utilisateurs') > 0) throw new HttpError(409, "L'administrateur a déjà été créé.");
        if ($pb = kgp_password_problem($b['password'] ?? null)) throw new ValidationError([$pb]);
        $clean = kgp_validate_record(kgp_module('utilisateurs'),
          ['nom' => 'Administrateur', 'prenom' => 'Système', 'login' => $b['login'] ?? '', 'role' => KGP_ADMIN, 'statut' => 'Actif', 'dateExpiration' => ''],
          ['lookup' => fn() => [], 'numeroTaken' => fn() => false]);
        $u = $clean + ['motDePasseHash' => kgp_hash_password($b['password']), 'doitChangerMotDePasse' => false];
        kgp_put('utilisateurs', 1, $u, null);
        kgp_audit(1, 'setup', 'utilisateurs', 1);
        return $u + ['id' => 1];
      });
      kgp_start_session($user);
      kgp_send(['user' => kgp_public_user($user)]);
      return;
    }

    if ($p === '/api/login' && $method === 'POST'){
      $b = kgp_body();
      $login = (string)($b['login'] ?? ''); $password = (string)($b['password'] ?? '');
      $ip = $_SERVER['REMOTE_ADDR'] ?? '';
      $key = $ip . '|' . kgp_lower($login); $keyIp = 'ip|' . $ip;
      $user = kgp_find_by_login($login);
      // Limite par compte (5 échecs) et globale par adresse IP (30 échecs, tous identifiants confondus).
      if (kgp_login_blocked($key) || kgp_login_blocked($keyIp, 30)){
        kgp_audit($user['id'] ?? null, 'login-bloque');
        throw new HttpError(429, 'Trop de tentatives : réessayez dans 15 minutes.');
      }
      $ok = kgp_verify_password($password, $user['motDePasseHash'] ?? '') && $user;
      if (!$ok){ kgp_login_fail($key); kgp_login_fail($keyIp); kgp_audit($user['id'] ?? null, 'login-echec'); throw new HttpError(401, 'Identifiant ou code secret incorrect.'); }
      if (($user['statut'] ?? 'Actif') !== 'Actif') throw new HttpError(403, "Ce compte est désactivé. Contactez l'administrateur.");
      if (kgp_is_expired($user)) throw new HttpError(403, "Votre durée d'accès a expiré. Contactez l'administrateur.");
      kgp_login_reset($key);
      if (in_array($password, KGP_LEGACY_PASSWORDS, true) && empty($user['doitChangerMotDePasse'])){
        $user['doitChangerMotDePasse'] = true; kgp_put('utilisateurs', $user['id'], $user, $user['id']);
      }
      kgp_start_session($user);
      kgp_audit($user['id'], 'login');
      kgp_send(['user' => kgp_public_user($user)]);
      return;
    }

    if ($p === '/api/logout' && $method === 'POST'){
      $t = $_COOKIE[kgp_cookie_name()] ?? '';
      if (is_string($t) && $t !== '') kgp_db()->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([kgp_token_hash($t)]);
      kgp_set_cookie('', 0);
      kgp_send(['ok' => true]);
      return;
    }

    $session = kgp_current_session();
    if (!$session) throw new HttpError(401, 'Session expirée : reconnectez-vous.');
    $user = $session['user'];
    if (!empty($user['doitChangerMotDePasse']) && !in_array($p, ['/api/password', '/api/me'], true)){
      throw new HttpError(403, "Changez d'abord votre code secret.");
    }

    if ($p === '/api/me' && $method === 'GET'){ kgp_send(['user' => kgp_public_user($user)]); return; }

    // Journal d'activité (administrateur) : qui a fait quoi, sans le contenu des fiches.
    if ($p === '/api/audit' && $method === 'GET'){
      if (!kgp_is_admin($user)) throw new HttpError(403, "Journal d'activité réservé à l'administrateur.");
      $logins = [];
      foreach (kgp_all('utilisateurs') as $u) $logins[$u['id']] = $u['login'] ?? '';
      $rows = kgp_db()->query('SELECT at, user_id, action, store, record_id FROM audit ORDER BY rowid DESC LIMIT 500')->fetchAll(PDO::FETCH_ASSOC);
      kgp_send(array_map(fn($r) => ['date' => gmdate('Y-m-d\TH:i:s\Z', (int)$r['at']),
        'utilisateur' => $r['user_id'] ? ($logins[(int)$r['user_id']] ?? '#' . $r['user_id']) : '',
        'action' => $r['action'], 'module' => $r['store'] ?? '', 'fiche' => $r['record_id'] !== null ? (int)$r['record_id'] : null], $rows));
      return;
    }

    if ($p === '/api/password' && $method === 'POST'){
      $b = kgp_body();
      if (empty($user['doitChangerMotDePasse']) && !kgp_verify_password($b['current'] ?? '', $user['motDePasseHash'] ?? '')){
        throw new ValidationError(['Code secret actuel incorrect.']);
      }
      if ($pb = kgp_password_problem($b['password'] ?? null)) throw new ValidationError([$pb]);
      if (password_verify($b['password'], $user['motDePasseHash'] ?? '')) throw new ValidationError(["Choisissez un code secret différent de l'actuel."]);
      $user['motDePasseHash'] = kgp_hash_password($b['password']);
      $user['doitChangerMotDePasse'] = false;
      kgp_put('utilisateurs', $user['id'], $user, $user['id']);
      kgp_delete_other_sessions($user['id'], $session['hash']);
      kgp_audit($user['id'], 'password', 'utilisateurs', $user['id']);
      kgp_send(['user' => kgp_public_user($user)]);
      return;
    }

    // Envoi groupé (ex. plan comptable au premier accès) : chaque fiche est vérifiée comme un PUT.
    if ($method === 'PUT' && preg_match('#^/api/data/([A-Za-z_]+)/lot$#', $p, $m)){
      $items = kgp_body();
      if (!kgp_is_list($items) || count($items) > 1000) throw new ValidationError(['Lot invalide (1 000 fiches au maximum)']);
      $ids = [];
      foreach ($items as $i => $it){
        try { $ids[] = kgp_save($user, $m[1], $it, $session['hash']); }
        catch (ValidationError $e){ throw new ValidationError(array_map(fn($x) => 'Fiche ' . ($i + 1) . ' : ' . $x, $e->errors)); }
      }
      kgp_send(['ids' => $ids]);
      return;
    }
    if (preg_match('#^/api/data/([A-Za-z_]+)(?:/(\d+))?$#', $p, $m)){
      $store = $m[1]; $idStr = $m[2] ?? '';
      if ($method === 'GET' && $idStr === ''){ kgp_send(kgp_list($user, $store)); return; }
      if ($method === 'PUT' && $idStr === ''){ kgp_send(['id' => kgp_save($user, $store, kgp_body(), $session['hash'])]); return; }
      if ($method === 'DELETE' && $idStr !== ''){ kgp_send(['ok' => kgp_remove($user, $store, (int)$idStr)]); return; }
    }
    throw new HttpError(404, 'Route inconnue');
  } catch (ValidationError $e){
    kgp_send(['error' => $e->getMessage(), 'errors' => $e->errors], 422);
  } catch (HttpError $e){
    kgp_send(['error' => $e->getMessage()], $e->status);
  } catch (Throwable $e){
    kgp_send(['error' => kgp_message_incident(kgp_incident($e, 'API'))], 500);
  }
}

function kgp_serve_app(): void {
  $t = kgp_tenant();
  $html = file_get_contents(__DIR__ . '/kgpro.html');
  if ($html === false){ http_response_code(500); echo 'kgpro.html introuvable dans lib/'; return; }
  kgp_security_headers(true);
  header('Content-Type: text/html; charset=utf-8');
  $societe = json_encode(['slug' => $t['slug'], 'nom' => $t['nom']], JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP);
  // Clé PUBLIQUE de vérification des licences (créée dans la console) : rien à configurer à la main.
  $pub = $GLOBALS['KGP_LICENSE_PUBLIC'] ?? null;
  if ($pub && preg_match('/^[A-Za-z0-9_-]{43}$/', $pub)){
    $html = preg_replace('/const KGP_LICENSE_PUBLIC_KEY = "[^"]*";/', 'const KGP_LICENSE_PUBLIC_KEY = "' . $pub . '";', $html, 1);
  }
  $pos = strpos($html, '<head>');
  // Bibliothèques hébergées à la racine du site (/assets/), quelle que soit l'adresse de la société.
  $assets = ($GLOBALS['KGP_BASE'] ?? '') . '/assets/';
  $html = str_replace('src="assets/', 'src="' . $assets, $html);
  $inject = "<head>\n<script>window.KGP_SERVER = true; window.KGP_SOCIETE = $societe; window.KGP_ASSETS = " . json_encode($assets, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) . ";</script>";
  echo $pos === false ? $html : substr_replace($html, $inject, $pos, 6);
}
