<?php
// Vérification côté serveur de CHAQUE enregistrement avant écriture.
// Mêmes règles que serveur/validation.mjs (version Node.js), à partir de schema.json
// (généré depuis les définitions de modules de kgpro.html).

final class ValidationError extends Exception {
  public array $errors;
  public function __construct(array $errors){ parent::__construct(implode(' ; ', $errors)); $this->errors = $errors; }
}

const KGP_LIMIT_TEXT = 2000;
const KGP_LIMIT_EXTRA_STRING = 5000;
const KGP_LIMIT_IMAGE = 3000000;
const KGP_LIMIT_LIGNES = 500;
const KGP_LIMIT_EXTRA_ARRAY = 1000;
const KGP_LIMIT_DEPTH = 4;
const KGP_LIMIT_AMOUNT = 1e13;
const KGP_KEY_RE = '/^[A-Za-z_][A-Za-z0-9_]{0,63}$/';
const KGP_IMAGE_RE = '/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+\/]+=*$/';
const KGP_FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

function kgp_strlen(string $s): int {
  return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : (int)preg_match_all('/./us', $s);
}
function kgp_lower(string $s): string { return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s); }
function kgp_is_list($v): bool {
  if (!is_array($v)) return false;
  $i = 0; foreach ($v as $k => $_){ if ($k !== $i++) return false; } return true;
}
// Objet JSON (tableau associatif). Un objet vide {} est décodé en tableau vide.
function kgp_is_object($v): bool { return is_array($v) && ($v === [] || !kgp_is_list($v)); }
function kgp_is_number($v): bool { return (is_int($v) || is_float($v)) && is_finite((float)$v); }

function kgp_valid_date(string $s): bool {
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) return false;
  $d = DateTime::createFromFormat('!Y-m-d', $s, new DateTimeZone('UTC'));
  return $d !== false && $d->format('Y-m-d') === $s;
}

// Pourcentages entre 0 et 100, soldes éventuellement négatifs, le reste positif ou nul.
function kgp_number_rule(string $key): array {
  if (preg_match('/^(taux|tva)/i', $key) || preg_match('/Pct$/', $key)) return [0, 100];
  if (preg_match('/^solde/i', $key)) return [-KGP_LIMIT_AMOUNT, KGP_LIMIT_AMOUNT];
  return [0, KGP_LIMIT_AMOUNT];
}
function kgp_fmt_num($n): string { return floor($n) == $n ? sprintf('%.0f', $n) : (string)$n; }

function kgp_check_number(string $key, $v, string $label, array &$errors): void {
  if (!kgp_is_number($v)){ $errors[] = "$label : nombre attendu"; return; }
  [$min, $max] = kgp_number_rule($key);
  if ($v < $min || $v > $max) $errors[] = "$label : doit être compris entre " . kgp_fmt_num($min) . " et " . kgp_fmt_num($max);
}

function kgp_check_extra($v, string $path, int $depth, array &$errors): void {
  if ($v === null || is_bool($v)) return;
  if (is_int($v) || is_float($v)){ if (!is_finite((float)$v) || abs($v) > KGP_LIMIT_AMOUNT) $errors[] = "$path : nombre invalide"; return; }
  if (is_string($v)){ if (kgp_strlen($v) > KGP_LIMIT_EXTRA_STRING) $errors[] = "$path : texte trop long"; return; }
  if ($depth >= KGP_LIMIT_DEPTH){ $errors[] = "$path : structure trop imbriquée"; return; }
  if (kgp_is_list($v)){
    if (count($v) > KGP_LIMIT_EXTRA_ARRAY) $errors[] = "$path : trop d'éléments";
    foreach ($v as $i => $x) kgp_check_extra($x, "{$path}[$i]", $depth + 1, $errors);
    return;
  }
  if (is_array($v)){
    foreach ($v as $k => $x){
      if (!is_string($k) || !preg_match(KGP_KEY_RE, $k) || in_array($k, KGP_FORBIDDEN_KEYS, true)){ $errors[] = "$path : nom de champ invalide"; continue; }
      kgp_check_extra($x, "$path.$k", $depth + 1, $errors);
    }
    return;
  }
  $errors[] = "$path : type de valeur non autorisé";
}

/**
 * Vérifie et normalise un enregistrement.
 * $ctx : existing (array|null), lookup(callable(source, field): array valeurs=>true),
 *        numeroPrefix (string|null), numeroTaken(callable(numero): bool)
 */
function kgp_validate_record(array $mod, $input, array $ctx): array {
  $errors = [];
  if (!kgp_is_object($input)) throw new ValidationError(['Enregistrement invalide']);
  $existing = $ctx['existing'] ?? null;
  $out = [];
  $declared = [];
  foreach ($mod['fields'] as $f) $declared[$f['k']] = $f;

  foreach ($mod['fields'] as $f){
    $label = $f['l'] ?? $f['k'];
    $t = $f['t'] ?? 'text';
    if ($t === 'password' || !empty($f['readonly'])) continue;
    $v = $input[$f['k']] ?? null;
    if ($v === null) $v = $t === 'number' ? ($f['def'] ?? 0) : '';

    switch ($t){
      case 'number':
        if ($v === '') $v = $f['def'] ?? 0;
        kgp_check_number($f['k'], $v, $label, $errors);
        break;
      case 'date':
        if (!is_string($v) || ($v !== '' && !kgp_valid_date($v))) $errors[] = "$label : date invalide (AAAA-MM-JJ)";
        break;
      case 'select':
        if (!is_string($v) || ($v !== '' && !in_array($v, $f['opts'] ?? [], true))) $errors[] = "$label : valeur non autorisée";
        break;
      case 'dynselect':
        if (!is_string($v) || kgp_strlen($v) > KGP_LIMIT_TEXT){ $errors[] = "$label : valeur invalide"; break; }
        $unchanged = $existing && ($existing[$f['k']] ?? null) === $v;
        if ($v !== '' && !$unchanged && !isset(($ctx['lookup'])($f['source'], $f['labelField'])[$v])){
          $errors[] = "$label : « $v » n'existe pas";
        }
        break;
      case 'tresoselect':
        // Caisse ou banque précise : doit exister parmi les caisses ou les banques.
        if (!is_string($v) || kgp_strlen($v) > KGP_LIMIT_TEXT){ $errors[] = "$label : valeur invalide"; break; }
        $unchanged = $existing && ($existing[$f['k']] ?? null) === $v;
        if ($v !== '' && !$unchanged && !isset(($ctx['lookup'])('caisses', 'nom')[$v]) && !isset(($ctx['lookup'])('banques', 'nom')[$v])){
          $errors[] = "$label : la caisse ou banque « $v » n'existe pas";
        }
        break;
      case 'image':
        if (!is_string($v) || ($v !== '' && !preg_match(KGP_IMAGE_RE, $v))) $errors[] = "$label : image invalide";
        elseif (strlen($v) > KGP_LIMIT_IMAGE) $errors[] = "$label : image trop volumineuse";
        break;
      default: // text
        if (kgp_is_number($v)) $v = (string)$v; // ex. import Excel
        if (!is_string($v)) $errors[] = "$label : texte attendu";
        else { $v = trim($v); if (kgp_strlen($v) > KGP_LIMIT_TEXT) $errors[] = "$label : texte trop long"; }
    }
    if (!empty($f['req']) && $v === '') $errors[] = "$label : champ obligatoire";
    $out[$f['k']] = $v;
  }

  // Lignes de facture : contrôlées et montants recalculés par le serveur.
  if (!empty($mod['hasLignes'])){
    $lignes = $input['lignes'] ?? null;
    if (!kgp_is_list($lignes) || count($lignes) === 0) $errors[] = 'Au moins une ligne est obligatoire';
    elseif (count($lignes) > KGP_LIMIT_LIGNES) $errors[] = 'Trop de lignes';
    else {
      $out['lignes'] = [];
      foreach ($lignes as $i => $l){
        $n = $i + 1;
        if (!kgp_is_object($l)){ $errors[] = "Ligne $n : invalide"; continue; }
        $designation = is_string($l['designation'] ?? null) ? trim($l['designation']) : '';
        if ($designation === '') $errors[] = "Ligne $n : désignation obligatoire";
        if (kgp_strlen($designation) > KGP_LIMIT_TEXT) $errors[] = "Ligne $n : désignation trop longue";
        $q = $l['quantite'] ?? null; $pu = $l['prixUnitaire'] ?? null;
        kgp_check_number('quantite', $q, "Ligne $n — quantité", $errors);
        kgp_check_number('prixUnitaire', $pu, "Ligne $n — prix unitaire", $errors);
        if (!(kgp_is_number($q) && $q > 0)) $errors[] = "Ligne $n : la quantité doit être supérieure à 0";
        $q = kgp_is_number($q) ? $q : 0; $pu = kgp_is_number($pu) ? $pu : 0;
        $montant = $q * $pu;
        kgp_check_number('montant', $montant, "Ligne $n — montant", $errors);
        $out['lignes'][] = ['designation' => $designation, 'quantite' => $q, 'prixUnitaire' => $pu, 'montant' => $montant];
      }
      if (!$errors){
        $out['montantHT'] = array_sum(array_column($out['lignes'], 'montant'));
        kgp_check_number('montantHT', $out['montantHT'], 'Montant HT total', $errors);
      }
    }
  } else {
    foreach ($mod['fields'] as $f) if (!empty($f['readonly']) && ($f['t'] ?? '') === 'number'){
      $v = $input[$f['k']] ?? 0;
      kgp_check_number($f['k'], $v, $f['l'] ?? $f['k'], $errors);
      $out[$f['k']] = $v;
    }
  }

  // Champs hors schéma ajoutés par l'application (numero, factureRef, planAmortissement...).
  foreach ($input as $k => $v){
    $k = (string)$k;
    if ($k === 'id' || isset($declared[$k]) || (!empty($mod['hasLignes']) && $k === 'lignes')) continue;
    if ($k === 'motDePasseHash'){ $errors[] = 'Champ interdit : motDePasseHash'; continue; }
    if (!preg_match(KGP_KEY_RE, $k) || in_array($k, KGP_FORBIDDEN_KEYS, true)){ $errors[] = 'Nom de champ invalide : ' . substr($k, 0, 40); continue; }
    kgp_check_extra($v, $k, 1, $errors);
    $out[$k] = is_string($v) ? trim($v) : $v;
  }

  // Numérotation des pièces : format attendu et unicité.
  $prefix = $ctx['numeroPrefix'] ?? null;
  if ($prefix && isset($out['numero']) && $out['numero'] !== ''){
    if (!is_string($out['numero']) || strpos($out['numero'], $prefix . '-') !== 0) $errors[] = 'Numéro de pièce invalide';
    elseif (($ctx['numeroTaken'])($out['numero'])) $errors[] = "Le numéro {$out['numero']} est déjà utilisé";
  }

  if (($mod['key'] ?? '') === 'journal' && ($out['debit'] ?? 0) > 0 && ($out['credit'] ?? 0) > 0){
    $errors[] = 'Une écriture ne peut pas être à la fois au débit et au crédit';
  }

  if ($errors) throw new ValidationError($errors);
  return $out;
}
