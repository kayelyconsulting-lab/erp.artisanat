<?php
// Comptabilisation côté serveur — tranche 1 (port de serveur/comptabilisation.mjs : mêmes écritures,
// mêmes libellés, mêmes tests). Le serveur génère et régénère les écritures du journal et les
// mouvements de stock liés à une pièce (ventes, achats, trésorerie, avoirs, règlements, virements).

const KGP_SPECIAL = [
  'factures' => 'factures', 'avoirs' => 'avoirs', 'facturesAchat' => 'facturesAchat',
  'stockEntrees' => 'stockEntree', 'treso_caisse' => 'treso', 'reglements' => 'reglement', 'virementsInternes' => 'virement',
];
function kgp_est_comptabilisable(string $store): bool { return isset(KGP_SPECIAL[$store]); }
function kgp_cnum($x): float { return is_int($x) || is_float($x) ? (float)$x : (is_numeric($x) ? (float)$x : 0.0); }
function kgp_journal_source(string $store, int $id): string { return "$store#$id"; }
/** Nombre pour JSON : entier quand pas de décimale (comme JavaScript). */
function kgp_c_nombre(float $v){ return floor($v) == $v && abs($v) < 2 ** 53 ? (int)$v : $v; }

function kgp_anciennes_pieces(string $store, array $record): ?array {
  switch ($store){
    case 'factures': return ['pieces' => [$record['numero'] ?? ''], 'journaux' => ['VE-Ventes']];
    case 'avoirs': return ['pieces' => [$record['numero'] ?? ''], 'journaux' => ['VE-Ventes']];
    case 'facturesAchat': return ['pieces' => [$record['numero'] ?? ''], 'journaux' => ['AC-Achats']];
    case 'stockEntrees': return ['pieces' => ['STK-' . $record['id']], 'journaux' => ['AC-Achats']];
    case 'treso_caisse': return ['pieces' => [$record['numero'] ?? ''], 'journaux' => ['BQ/CA', 'CA-Caisse']];
    default: return null;
  }
}
function kgp_comptes_tresorerie(): array {
  $out = [];
  foreach (kgp_all('caisses') as $c) $out[] = ['type' => 'Caisse', 'nom' => $c['nom'] ?? '', 'compte' => trim((string)($c['compteOhada'] ?? '571'))];
  foreach (kgp_all('banques') as $b) $out[] = ['type' => 'Banque', 'nom' => $b['nom'] ?? '', 'compte' => trim((string)($b['compteOhada'] ?? '521'))];
  return $out;
}
function kgp_resoudre_tresorerie(array $comptes, $nom, $mode): array {
  if (is_string($nom) && $nom !== '') foreach ($comptes as $c) if (($c['nom'] ?? null) === $nom){
    return ['compte' => $c['compte'], 'journal' => ($c['type'] === 'Banque') ? 'BQ-Banque' : 'CA-Caisse'];
  }
  $banque = $mode === 'Banque';
  return ['compte' => $banque ? '521' : '571', 'journal' => $banque ? 'BQ-Banque' : 'CA-Caisse'];
}
function kgp_lignes_reglement(array $record, bool $achat, array $comptes): array {
  $regle = kgp_cnum($record['montantRegle'] ?? 0);
  if ($regle <= 0) return [];
  $treso = kgp_resoudre_tresorerie($comptes, $record['compteTreso'] ?? '', $record['modeReglement'] ?? '')['compte'];
  return $achat
    ? [['compte' => '401', 'libelle' => 'Règlement ' . ($record['fournisseur'] ?? ''), 'debit' => $regle, 'credit' => 0],
       ['compte' => $treso, 'libelle' => 'Règlement ' . ($record['fournisseur'] ?? ''), 'debit' => 0, 'credit' => $regle]]
    : [['compte' => $treso, 'libelle' => 'Encaissement ' . ($record['client'] ?? ''), 'debit' => $regle, 'credit' => 0],
       ['compte' => '411', 'libelle' => 'Encaissement ' . ($record['client'] ?? ''), 'debit' => 0, 'credit' => $regle]];
}
function kgp_supprimer_ecritures(string $store, array $record, bool $avecSousPieces, ?int $userId): void {
  $source = kgp_journal_source($store, $record['id']);
  $legacy = kgp_anciennes_pieces($store, $record);
  $legacyPieces = $legacy ? array_values(array_filter($legacy['pieces'])) : [];
  foreach (kgp_all('journal') as $r){
    $src = $r['source'] ?? '';
    if (is_string($src) && $src !== '') $cible = $src === $source || ($avecSousPieces && str_starts_with($src, $source . '#'));
    else $cible = $legacy && in_array($r['piece'] ?? '', $legacyPieces, true) && in_array($r['journalType'] ?? '', $legacy['journaux'], true);
    if ($cible && kgp_delete('journal', $r['id'])) kgp_audit($userId, 'delete', 'journal', $r['id']);
  }
}
function kgp_post_journal(string $date, string $journalType, string $piece, array $lignes, string $source, ?int $userId): void {
  foreach ($lignes as $l){
    if (empty($l['compte']) || (empty($l['debit']) && empty($l['credit']))) continue;
    $id = kgp_next_id('journal');
    kgp_put('journal', $id, [
      'date' => $date, 'journalType' => $journalType, 'piece' => $piece, 'compte' => trim((string)$l['compte']),
      'libelle' => $l['libelle'] ?? '', 'debit' => kgp_c_nombre(kgp_cnum($l['debit'] ?? 0)), 'credit' => kgp_c_nombre(kgp_cnum($l['credit'] ?? 0)), 'source' => $source,
    ], $userId);
    kgp_audit($userId, 'create', 'journal', $id);
  }
}
function kgp_sync_stock(string $store, array $record, ?int $userId): void {
  $cible = $store === 'factures' ? 'stockSorties' : 'stockEntrees';
  $champ = $store === 'factures' ? 'factureRef' : 'factureAchatRef';
  $noms = [];
  foreach (kgp_all('articles') as $a) if (isset($a['designation'])) $noms[$a['designation']] = true;
  foreach (kgp_all($cible) as $s) if (($s[$champ] ?? null) === ($record['numero'] ?? null) && ($s['auto'] ?? null) === true && kgp_delete($cible, $s['id'])) kgp_audit($userId, 'delete', $cible, $s['id']);
  foreach ((is_array($record['lignes'] ?? null) ? $record['lignes'] : []) as $l){
    if (!isset($noms[$l['designation'] ?? '']) || !(kgp_cnum($l['quantite'] ?? 0) > 0)) continue;
    $id = kgp_next_id($cible);
    $base = $store === 'factures'
      ? ['date' => $record['date'] ?? '', 'motif' => 'Vente', 'article' => $l['designation'], 'quantite' => kgp_c_nombre(kgp_cnum($l['quantite'])), 'prixUnitaire' => kgp_c_nombre(kgp_cnum($l['prixUnitaire'] ?? 0)), 'factureRef' => $record['numero'] ?? '', 'auto' => true]
      : ['date' => $record['date'] ?? '', 'fournisseur' => $record['fournisseur'] ?? '', 'article' => $l['designation'], 'quantite' => kgp_c_nombre(kgp_cnum($l['quantite'])), 'prixUnitaire' => kgp_c_nombre(kgp_cnum($l['prixUnitaire'] ?? 0)), 'tvaPct' => kgp_c_nombre(kgp_cnum($record['tvaPct'] ?? 0)), 'factureAchatRef' => $record['numero'] ?? '', 'auto' => true];
    kgp_put($cible, $id, $base, $userId);
    kgp_audit($userId, 'create', $cible, $id);
  }
}

/** Génère (ou régénère) les écritures et mouvements d'une pièce, dans la transaction courante. */
function kgp_comptabiliser(string $store, array $record, ?int $userId): void {
  $special = KGP_SPECIAL[$store] ?? null;
  if (!$special) return;
  kgp_supprimer_ecritures($store, $record, false, $userId);
  $comptesT = kgp_comptes_tresorerie();
  $src = kgp_journal_source($store, $record['id']);
  $post = function ($date, $jt, $piece, $lignes) use ($src, $userId){ kgp_post_journal((string)$date, $jt, (string)$piece, $lignes, $src, $userId); };

  if ($special === 'factures'){
    $ht = kgp_cnum($record['montantHT'] ?? 0); $tva = $ht * kgp_cnum($record['tvaPct'] ?? 0) / 100; $timbre = kgp_cnum($record['timbreQuittance'] ?? 0); $ttc = $ht + $tva + $timbre;
    $lignes = [
      ['compte' => '411', 'libelle' => 'Client ' . ($record['client'] ?? ''), 'debit' => $ttc, 'credit' => 0],
      ['compte' => '701', 'libelle' => 'Vente ' . ($record['client'] ?? ''), 'debit' => 0, 'credit' => $ht],
    ];
    if ($tva > 0) $lignes[] = ['compte' => '4431', 'libelle' => 'TVA facturée', 'debit' => 0, 'credit' => $tva];
    if ($timbre > 0) $lignes[] = ['compte' => '4472', 'libelle' => 'Timbre de quittance à reverser', 'debit' => 0, 'credit' => $timbre];
    $post($record['date'] ?? '', 'VE-Ventes', $record['numero'] ?? '', $lignes);
    $tf = kgp_resoudre_tresorerie($comptesT, $record['compteTreso'] ?? '', $record['modeReglement'] ?? '');
    $post($record['date'] ?? '', $tf['journal'], $record['numero'] ?? '', kgp_lignes_reglement($record, false, $comptesT));
    kgp_sync_stock('factures', $record, $userId);
  } elseif ($special === 'avoirs'){
    $ht = kgp_cnum($record['montantHT'] ?? 0); $tva = $ht * kgp_cnum($record['tvaPct'] ?? 0) / 100; $ttc = $ht + $tva;
    $lignes = [['compte' => '701', 'libelle' => 'Avoir ' . ($record['client'] ?? ''), 'debit' => $ht, 'credit' => 0]];
    if ($tva > 0) $lignes[] = ['compte' => '4431', 'libelle' => 'TVA sur avoir', 'debit' => $tva, 'credit' => 0];
    $lignes[] = ['compte' => '411', 'libelle' => 'Client ' . ($record['client'] ?? ''), 'debit' => 0, 'credit' => $ttc];
    $post($record['date'] ?? '', 'VE-Ventes', $record['numero'] ?? '', $lignes);
  } elseif ($special === 'facturesAchat'){
    $ht = kgp_cnum($record['montantHT'] ?? 0); $tva = $ht * kgp_cnum($record['tvaPct'] ?? 0) / 100; $timbre = kgp_cnum($record['timbreQuittance'] ?? 0); $ttc = $ht + $tva + $timbre;
    $lignes = [['compte' => '601', 'libelle' => 'Achat ' . ($record['fournisseur'] ?? ''), 'debit' => $ht, 'credit' => 0]];
    if ($tva > 0) $lignes[] = ['compte' => '4452', 'libelle' => 'TVA récupérable sur achats', 'debit' => $tva, 'credit' => 0];
    if ($timbre > 0) $lignes[] = ['compte' => '646', 'libelle' => 'Droits de timbre (quittance)', 'debit' => $timbre, 'credit' => 0];
    $lignes[] = ['compte' => '401', 'libelle' => 'Fournisseur ' . ($record['fournisseur'] ?? ''), 'debit' => 0, 'credit' => $ttc];
    $post($record['date'] ?? '', 'AC-Achats', $record['numero'] ?? '', $lignes);
    $ta = kgp_resoudre_tresorerie($comptesT, $record['compteTreso'] ?? '', $record['modeReglement'] ?? '');
    $post($record['date'] ?? '', $ta['journal'], $record['numero'] ?? '', kgp_lignes_reglement($record, true, $comptesT));
    kgp_sync_stock('facturesAchat', $record, $userId);
  } elseif ($special === 'stockEntree'){
    if (!empty($record['auto'])) return;
    $ht = kgp_cnum($record['quantite'] ?? 0) * kgp_cnum($record['prixUnitaire'] ?? 0); $tva = $ht * kgp_cnum($record['tvaPct'] ?? 0) / 100;
    $lignes = [['compte' => '601', 'libelle' => 'Achat ' . ($record['article'] ?? ''), 'debit' => $ht, 'credit' => 0]];
    if ($tva > 0) $lignes[] = ['compte' => '4452', 'libelle' => 'TVA récupérable', 'debit' => $tva, 'credit' => 0];
    $lignes[] = ['compte' => '401', 'libelle' => 'Fournisseur ' . ($record['fournisseur'] ?? ''), 'debit' => 0, 'credit' => $ht + $tva];
    $post($record['date'] ?? '', 'AC-Achats', 'STK-' . $record['id'], $lignes);
  } elseif ($special === 'reglement'){
    $montant = kgp_cnum($record['montant'] ?? 0);
    $t = kgp_resoudre_tresorerie($comptesT, $record['compteTreso'] ?? '', $record['modeReglement'] ?? '');
    $libelle = 'Règlement ' . ($record['factureRef'] ?? '') . ' ' . ($record['tiers'] ?? '') . (!empty($record['moyen']) ? ' (' . $record['moyen'] . ')' : '');
    $lignes = ($record['type'] ?? '') === 'Paiement fournisseur'
      ? [['compte' => '401', 'libelle' => $libelle, 'debit' => $montant, 'credit' => 0], ['compte' => $t['compte'], 'libelle' => $libelle, 'debit' => 0, 'credit' => $montant]]
      : [['compte' => $t['compte'], 'libelle' => $libelle, 'debit' => $montant, 'credit' => 0], ['compte' => '411', 'libelle' => $libelle, 'debit' => 0, 'credit' => $montant]];
    $post($record['date'] ?? '', $t['journal'], $record['numero'] ?? '', $lignes);
  } elseif ($special === 'virement'){
    $montant = kgp_cnum($record['montant'] ?? 0);
    $de = kgp_resoudre_tresorerie($comptesT, $record['source'] ?? '', null); $vers = kgp_resoudre_tresorerie($comptesT, $record['destination'] ?? '', null);
    $libelle = 'Virement ' . ($record['source'] ?? '') . ' → ' . ($record['destination'] ?? '') . (!empty($record['motif']) ? ' — ' . $record['motif'] : '');
    $post($record['date'] ?? '', 'BQ-Banque', $record['numero'] ?? '', [
      ['compte' => $vers['compte'], 'libelle' => $libelle, 'debit' => $montant, 'credit' => 0],
      ['compte' => $de['compte'], 'libelle' => $libelle, 'debit' => 0, 'credit' => $montant],
    ]);
  } elseif ($special === 'treso'){
    $montant = kgp_cnum($record['montant'] ?? 0);
    $compteTreso = !empty($record['caisse']) ? kgp_resoudre_tresorerie($comptesT, $record['caisse'], null)['compte'] : '571';
    $motif = $record['motif'] ?? '';
    $lignes = ($record['type'] ?? '') === 'Encaissement'
      ? [['compte' => $compteTreso, 'libelle' => $motif, 'debit' => $montant, 'credit' => 0], ['compte' => $record['contrepartie'] ?? '', 'libelle' => $motif, 'debit' => 0, 'credit' => $montant]]
      : [['compte' => $record['contrepartie'] ?? '', 'libelle' => $motif, 'debit' => $montant, 'credit' => 0], ['compte' => $compteTreso, 'libelle' => $motif, 'debit' => 0, 'credit' => $montant]];
    $post($record['date'] ?? '', 'CA-Caisse', $record['numero'] ?? '', $lignes);
  }
}

/** Suppression d'une pièce : retire ses écritures, ses mouvements de stock auto et délie le devis. */
function kgp_supprimer_comptabilisation(string $store, array $record, ?int $userId): void {
  if (!isset(KGP_SPECIAL[$store])) return;
  kgp_supprimer_ecritures($store, $record, true, $userId);
  if ($store === 'factures'){
    foreach (kgp_all('stockSorties') as $s) if (($s['factureRef'] ?? null) === ($record['numero'] ?? null) && ($s['auto'] ?? null) === true && kgp_delete('stockSorties', $s['id'])) kgp_audit($userId, 'delete', 'stockSorties', $s['id']);
    foreach (kgp_all('devis') as $d) if (($d['factureNumero'] ?? null) === ($record['numero'] ?? null)){
      unset($d['factureNumero']); $id = $d['id']; unset($d['id']);
      kgp_put('devis', $id, $d, $userId); kgp_audit($userId, 'update', 'devis', $id);
    }
  } elseif ($store === 'facturesAchat'){
    foreach (kgp_all('stockEntrees') as $e) if (($e['factureAchatRef'] ?? null) === ($record['numero'] ?? null) && ($e['auto'] ?? null) === true && kgp_delete('stockEntrees', $e['id'])) kgp_audit($userId, 'delete', 'stockEntrees', $e['id']);
  }
}

/** Facture encore liée à des règlements : suppression refusée (message, ou '' si possible). */
function kgp_blocage_suppression(string $store, array $record): string {
  if ($store !== 'factures' && $store !== 'facturesAchat') return '';
  $champ = $store === 'factures' ? 'factureVente' : 'factureAchat';
  $lies = [];
  foreach (kgp_all('reglements') as $r) if (!empty($r[$champ]) && $r[$champ] === ($record['numero'] ?? null)) $lies[] = $r['numero'] ?? '';
  return $lies ? 'Cette facture a ' . count($lies) . ' règlement(s) (' . implode(', ', $lies) . ') : supprimez-les d\'abord.' : '';
}
