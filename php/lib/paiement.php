<?php
// Paiement en ligne CinetPay (agrégateur : Orange Money, Wave, MTN, Moov, cartes).
// Sécurité : la notification (webhook) est authentifiée par un jeton HMAC-SHA256 (en-tête
// x-token) calculé sur les champs de la notification avec la clé secrète du marchand, PUIS le
// statut et le montant sont reconfirmés auprès de CinetPay (serveur à serveur) avant d'enregistrer
// un règlement — une seule fois (idempotent). La clé secrète et l'API key restent hors du code,
// dans un fichier du dossier de données (jamais servi, jamais renvoyé au navigateur).
// Référence : https://docs.cinetpay.com/api/1.0-en/checkout/hmac et /api/1.0-en/sdk/php

// Champs de la notification concaténés pour le jeton HMAC, dans l'ordre officiel CinetPay.
const KGP_CINETPAY_CHAMPS = [
  'cpm_site_id', 'cpm_trans_id', 'cpm_trans_date', 'cpm_amount', 'cpm_currency', 'signature', 'payment_method',
  'cel_phone_num', 'cpm_phone_prefixe', 'cpm_language', 'cpm_version', 'cpm_payment_config', 'cpm_page_action',
  'cpm_custom', 'cpm_designation', 'cpm_error_message',
];
function kgp_cinetpay_base(): string { return rtrim(getenv('KGP_CINETPAY_BASE') ?: 'https://api-checkout.cinetpay.com', '/'); }

function kgp_paiement_file(): string {
  $slug = kgp_tenant()['slug'] ?? 'local';
  return kgp_data_dir() . '/societes/' . $slug . '.paiement.json';
}
function kgp_paiement_config(): ?array {
  $raw = @file_get_contents(kgp_paiement_file());
  if ($raw === false) return null;
  $c = json_decode($raw, true);
  return (is_array($c) && !empty($c['siteId']) && !empty($c['apikey']) && !empty($c['secretKey'])) ? $c : null;
}
/** Vue publique : jamais l'apikey ni la clé secrète. */
function kgp_paiement_config_public(): array {
  $c = kgp_paiement_config();
  return $c ? ['configure' => true, 'siteId' => $c['siteId'], 'moyen' => $c['moyen'] ?? 'Mobile Money'] : ['configure' => false];
}
function kgp_paiement_config_set(array $in): void {
  // Champ laissé vide = valeur actuelle conservée (on ne réécrase pas la clé secrète par erreur).
  $cur = kgp_paiement_config() ?: [];
  $val = fn($k) => (isset($in[$k]) && trim((string)$in[$k]) !== '') ? trim((string)$in[$k]) : (string)($cur[$k] ?? '');
  $cfg = ['siteId' => $val('siteId'), 'apikey' => $val('apikey'), 'secretKey' => $val('secretKey'),
    'moyen' => in_array($in['moyen'] ?? '', ['Mobile Money', 'Carte bancaire', 'Virement'], true) ? $in['moyen'] : ($cur['moyen'] ?? 'Mobile Money')];
  foreach (['siteId', 'apikey', 'secretKey'] as $k) if ($cfg[$k] === '') throw new ValidationError(["Champ « $k » obligatoire"]);
  $dir = dirname(kgp_paiement_file());
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  if (file_put_contents(kgp_paiement_file(), json_encode($cfg, JSON_UNESCAPED_UNICODE), LOCK_EX) === false) throw new HttpError(500, 'Enregistrement de la configuration de paiement impossible.');
  @chmod(kgp_paiement_file(), 0600);
}

/** Jeton HMAC attendu pour une notification (pur, testable). */
function kgp_cinetpay_token(array $post, string $secret): string {
  $data = '';
  foreach (KGP_CINETPAY_CHAMPS as $c) $data .= (string)($post[$c] ?? '');
  return hash_hmac('sha256', $data, $secret);
}

/** Appel JSON à l'API CinetPay (curl). Renvoie le tableau décodé, ou null en cas d'échec réseau. */
function kgp_cinetpay_api(string $path, array $payload): ?array {
  $ch = curl_init(kgp_cinetpay_base() . $path);
  curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 10,
  ]);
  $out = curl_exec($ch);
  curl_close($ch);
  if ($out === false) return null;
  $d = json_decode($out, true);
  return is_array($d) ? $d : null;
}

/** Ouvre un paiement CinetPay pour une facture de vente ; renvoie l'URL de paiement. */
function kgp_paiement_initier(array $user, int $factureId, string $baseUrl): array {
  kgp_assert_can_write($user, kgp_module('reglements'), null);   // rôle habilité aux encaissements
  $cfg = kgp_paiement_config();
  if (!$cfg) throw new HttpError(400, "Le paiement en ligne n'est pas configuré. Renseignez vos identifiants CinetPay.");
  $facture = kgp_get('factures', $factureId);
  if (!$facture) throw new HttpError(404, 'Facture introuvable');
  $reste = kgp_totaux_facture($facture)['ttc'] - kgp_cnum($facture['montantRegle'] ?? 0) - kgp_total_reglements('factureVente', $facture['numero'] ?? '', 0);
  $reste = round($reste, 0);                    // CinetPay XOF : montant entier, multiple de 5
  if ($reste < 5) throw new ValidationError(['Cette facture est déjà réglée (rien à encaisser).']);
  $reste = (int)(ceil($reste / 5) * 5);
  $slug = kgp_tenant()['slug'] ?? 'local';
  $transId = $slug . '-F' . $factureId . '-' . time();
  $racine = rtrim($baseUrl, '/');
  $resp = kgp_cinetpay_api('/v2/payment', [
    'apikey' => $cfg['apikey'], 'site_id' => $cfg['siteId'], 'transaction_id' => $transId,
    'amount' => $reste, 'currency' => 'XOF', 'description' => 'Facture ' . ($facture['numero'] ?? ''),
    'notify_url' => $racine . '/api/paiement/webhook', 'return_url' => $racine . '/',
    'channels' => 'ALL', 'customer_name' => (string)($facture['client'] ?? ''),
  ]);
  if (!$resp || ($resp['code'] ?? null) !== '201' || empty($resp['data']['payment_url'])){
    throw new HttpError(502, 'CinetPay a refusé la demande de paiement. Vérifiez vos identifiants.');
  }
  kgp_put('paiementsEnLigne', kgp_next_id('paiementsEnLigne'),
    ['transId' => $transId, 'factureNumero' => $facture['numero'] ?? '', 'montant' => $reste, 'statut' => 'init', 'date' => date('c')], $user['id']);
  return ['paymentUrl' => $resp['data']['payment_url'], 'transId' => $transId, 'montant' => $reste];
}

/** Numéro de pièce (comme le navigateur : max existant, ou nombre de pièces, + 1). */
function kgp_generer_numero(string $store): string {
  $prefix = kgp_schema()['numeroPrefixes'][$store] ?? '';
  if ($prefix === '') return '';
  $max = 0; $n = 0;
  foreach (kgp_all($store) as $r){ $n++; if (preg_match('/^' . preg_quote($prefix, '/') . '-(\d+)$/', (string)($r['numero'] ?? ''), $m)) $max = max($max, (int)$m[1]); }
  return $prefix . '-' . str_pad((string)(max($max, $n) + 1), 4, '0', STR_PAD_LEFT);
}

/** Notification CinetPay : vérifie la signature, reconfirme, enregistre le règlement une seule fois. */
function kgp_paiement_webhook(): void {
  $cfg = kgp_paiement_config();
  if (!$cfg){ http_response_code(200); echo 'non configuré'; return; }
  $post = $_POST;
  $transId = (string)($post['cpm_trans_id'] ?? '');
  // 1. Signature HMAC (en-tête x-token), comparée à temps constant.
  $recu = $_SERVER['HTTP_X_TOKEN'] ?? '';
  $attendu = kgp_cinetpay_token($post, $cfg['secretKey']);
  if ($transId === '' || !is_string($recu) || !hash_equals($attendu, $recu)){
    kgp_incident(new RuntimeException('paiement : signature CinetPay invalide (trans ' . $transId . ')'), 'paiement');
    http_response_code(403); echo 'signature invalide'; return;
  }
  // 2. Reconfirmation serveur à serveur du statut et du montant réels.
  $check = kgp_cinetpay_api('/v2/payment/check', ['apikey' => $cfg['apikey'], 'site_id' => $cfg['siteId'], 'transaction_id' => $transId]);
  $data = $check['data'] ?? [];
  if (($data['status'] ?? '') !== 'ACCEPTED'){ http_response_code(200); echo 'statut ' . ($data['status'] ?? 'inconnu'); return; }
  if (strtoupper((string)($data['currency'] ?? 'XOF')) !== 'XOF'){ kgp_incident(new RuntimeException('paiement : devise inattendue'), 'paiement'); http_response_code(200); echo 'devise'; return; }
  $montant = kgp_cnum($data['amount'] ?? 0);
  // 3. Pièce attendue + enregistrement idempotent.
  try {
    kgp_transaction(function () use ($transId, $montant) {
      $reference = 'CinetPay ' . $transId;
      foreach (kgp_all('reglements') as $r) if (($r['reference'] ?? '') === $reference) return;   // déjà enregistré
      $pending = null;
      foreach (kgp_all('paiementsEnLigne') as $p) if (($p['transId'] ?? '') === $transId){ $pending = $p; break; }
      if (!$pending) throw new RuntimeException('paiement : transaction inconnue ' . $transId);
      if (abs($montant - kgp_cnum($pending['montant'] ?? 0)) > 0.5) throw new RuntimeException('paiement : montant différent de la demande');
      $input = ['numero' => kgp_generer_numero('reglements'), 'date' => date('Y-m-d'), 'type' => 'Encaissement client',
        'factureVente' => $pending['factureNumero'], 'factureAchat' => '', 'montant' => $montant,
        'modeReglement' => 'Banque', 'moyen' => 'Mobile Money', 'reference' => $reference];
      $id = kgp_next_id('reglements');
      $lookups = [];
      $record = kgp_validate_record(kgp_module('reglements'), $input, [
        'existing' => null,
        'lookup' => function (string $s, string $f) use (&$lookups){ $k = "$s.$f"; if (!isset($lookups[$k])){ $lookups[$k] = []; foreach (kgp_all($s) as $r) if (is_string($r[$f] ?? null)) $lookups[$k][$r[$f]] = true; } return $lookups[$k]; },
        'numeroPrefix' => kgp_schema()['numeroPrefixes']['reglements'] ?? null,
        'numeroTaken' => function (string $num) use ($id){ foreach (kgp_all('reglements') as $r) if (($r['numero'] ?? null) === $num && $r['id'] !== $id) return true; return false; },
      ]);
      kgp_appliquer_montants('reglements', $record, null, $id, true);
      kgp_assert_open('reglements', $record);
      kgp_put('reglements', $id, $record, null);
      kgp_audit(null, 'create', 'reglements', $id);
      kgp_comptabiliser('reglements', $record + ['id' => $id], null);
    });
  } catch (Throwable $e){
    kgp_incident($e, 'paiement');
    http_response_code(200); echo 'anomalie enregistrée'; return;   // 200 : CinetPay n'a pas à réessayer indéfiniment
  }
  http_response_code(200); echo 'OK';
}
