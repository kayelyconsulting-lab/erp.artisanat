<?php
// Prix et totaux calculés par le serveur (port de serveur/montants.mjs : mêmes règles,
// mêmes messages, mêmes tests).
//  - factures de vente : prix du catalogue imposé, sauf administrateur et gérant ;
//  - factures, factures d'achat, avoirs : HT, TVA et TTC recalculés ;
//  - acompte + règlements jamais au-delà du TTC ;
//  - règlements : facture existante, du bon type, montant ≤ reste dû.

const KGP_TOLERANCE = 0.005;
const KGP_MODULES_MONTANTS = ['factures', 'facturesAchat', 'avoirs', 'reglements'];

function kgp_num($x): float { return is_int($x) || is_float($x) ? (float)$x : (is_numeric($x) ? (float)$x : 0.0); }
function kgp_arrondi($x): float { return round(kgp_num($x), 2); }
function kgp_fmt($x): string {
  $s = number_format(kgp_arrondi($x), 2, ',', ' ');
  return str_ends_with($s, ',00') ? substr($s, 0, -3) : (str_ends_with($s, '0') ? substr($s, 0, -1) : $s);
}
/** Nombre pour JSON : entier quand il n'a pas de décimale (comme en JavaScript). */
function kgp_nombre(float $v){ return floor($v) == $v && abs($v) < 2 ** 53 ? (int)$v : $v; }

function kgp_totaux_facture(array $f): array {
  $ht = kgp_num($f['montantHT'] ?? 0); $tva = $ht * kgp_num($f['tvaPct'] ?? 0) / 100; $timbre = kgp_num($f['timbreQuittance'] ?? 0);
  return ['ht' => $ht, 'tva' => $tva, 'timbre' => $timbre, 'ttc' => $ht + $tva + $timbre];
}

function kgp_catalogue_vente(): array {
  $prix = [];
  foreach (kgp_all('services') as $s) if (is_string($s['designation'] ?? null) && kgp_num($s['prix'] ?? 0) > 0) $prix[trim($s['designation'])] = kgp_num($s['prix']);
  foreach (kgp_all('articles') as $a) if (is_string($a['designation'] ?? null) && kgp_num($a['prixVente'] ?? 0) > 0) $prix[trim($a['designation'])] = kgp_num($a['prixVente']);
  return $prix;
}

function kgp_total_reglements(string $champ, string $numero, int $saufId): float {
  $t = 0.0;
  foreach (kgp_all('reglements') as $r) if (($r[$champ] ?? null) === $numero && $r['id'] !== $saufId) $t += kgp_num($r['montant'] ?? 0);
  return $t;
}

/** Applique les règles de prix et de montants à $record ; retourne les lignes dont le prix a été corrigé. */
function kgp_appliquer_montants(string $store, array &$record, ?array $existing, int $id, bool $privilegie): array {
  $corriges = [];
  if ($store === 'factures' || $store === 'facturesAchat'){
    if ($store === 'factures' && !$privilegie){
      $catalogue = kgp_catalogue_vente();
      $anciennes = [];
      foreach (($existing['lignes'] ?? []) as $l) if (is_array($l)) $anciennes[($l['designation'] ?? '') . "\0" . kgp_num($l['prixUnitaire'] ?? 0)] = true;
      $modifie = false;
      foreach ($record['lignes'] as &$l){
        if (!array_key_exists($l['designation'], $catalogue)) continue;
        $prix = $catalogue[$l['designation']];
        if (abs($prix - kgp_num($l['prixUnitaire'])) < KGP_TOLERANCE) continue;
        if (isset($anciennes[$l['designation'] . "\0" . kgp_num($l['prixUnitaire'])])) continue;
        $corriges[] = ['designation' => $l['designation'], 'saisi' => $l['prixUnitaire'], 'catalogue' => kgp_nombre($prix)];
        $l['prixUnitaire'] = kgp_nombre($prix);
        $l['montant'] = kgp_nombre(kgp_num($l['quantite']) * $prix);
        $modifie = true;
      }
      unset($l);
      if ($modifie){
        $ht = 0.0; foreach ($record['lignes'] as $l) $ht += kgp_num($l['montant']);
        $record['montantHT'] = kgp_nombre($ht);
      }
    }
    $t = kgp_totaux_facture($record);
    $record['montantTVA'] = kgp_nombre(kgp_arrondi($t['tva']));
    $record['montantTTC'] = kgp_nombre(kgp_arrondi($t['ttc']));
    $champ = $store === 'factures' ? 'factureVente' : 'factureAchat';
    $deja = is_string($record['numero'] ?? null) && $record['numero'] !== '' ? kgp_total_reglements($champ, $record['numero'], 0) : 0.0;
    $acompte = kgp_num($record['montantRegle'] ?? 0);
    if ($acompte > $t['ttc'] + KGP_TOLERANCE){
      throw new ValidationError([($store === 'factures' ? 'Encaissé' : 'Payé') . ' à la création (' . kgp_fmt($acompte) . ') supérieur au total TTC (' . kgp_fmt($t['ttc']) . ')']);
    }
    if ($acompte + $deja > $t['ttc'] + KGP_TOLERANCE){
      throw new ValidationError(['Total TTC (' . kgp_fmt($t['ttc']) . ') inférieur aux montants déjà réglés sur cette facture (' . kgp_fmt($acompte + $deja) . ')']);
    }
  } elseif ($store === 'avoirs'){
    $ht = kgp_num($record['montantHT'] ?? 0); $tva = $ht * kgp_num($record['tvaPct'] ?? 0) / 100;
    $record['montantTVA'] = kgp_nombre(kgp_arrondi($tva));
    $record['montantTTC'] = kgp_nombre(kgp_arrondi($ht + $tva));
    $ref = $record['factureRef'] ?? '';
    if (is_string($ref) && $ref !== ''){
      $f = null;
      foreach (kgp_all('factures') as $x) if (($x['numero'] ?? null) === $ref){ $f = $x; break; }
      if (!$f) throw new ValidationError(["Facture liée : « $ref » n'existe pas"]);
      $client = $record['client'] ?? ''; $fc = $f['client'] ?? '';
      if ($client !== '' && $fc !== '' && $client !== $fc) throw new ValidationError(["La facture {$f['numero']} est au nom de « $fc », pas de « $client »"]);
      $autres = 0.0;
      foreach (kgp_all('avoirs') as $a) if (($a['factureRef'] ?? null) === $ref && $a['id'] !== $id) $autres += kgp_num($a['montantHT'] ?? 0) * (1 + kgp_num($a['tvaPct'] ?? 0) / 100);
      $ttcFacture = kgp_totaux_facture($f)['ttc'];
      if ($autres + $ht + $tva > $ttcFacture + KGP_TOLERANCE){
        throw new ValidationError(["Avoirs sur {$f['numero']} (" . kgp_fmt($autres + $ht + $tva) . ') supérieurs au total TTC de la facture (' . kgp_fmt($ttcFacture) . ')']);
      }
    }
  } elseif ($store === 'reglements'){
    $vente = ($record['type'] ?? '') !== 'Paiement fournisseur';
    $champ = $vente ? 'factureVente' : 'factureAchat';
    $numero = $record[$champ] ?? '';
    $record[$vente ? 'factureAchat' : 'factureVente'] = '';
    if (!is_string($numero) || $numero === '') throw new ValidationError([$vente ? 'Choisissez la facture de vente encaissée' : "Choisissez la facture d'achat payée"]);
    $facture = null;
    foreach (kgp_all($vente ? 'factures' : 'facturesAchat') as $f) if (($f['numero'] ?? null) === $numero){ $facture = $f; break; }
    if (!$facture) throw new ValidationError(["Facture $numero introuvable"]);
    $montant = kgp_num($record['montant'] ?? 0);
    if (!($montant > 0)) throw new ValidationError(['Le montant du règlement doit être supérieur à 0']);
    $reste = kgp_totaux_facture($facture)['ttc'] - kgp_num($facture['montantRegle'] ?? 0) - kgp_total_reglements($champ, $numero, $id);
    if ($montant > $reste + KGP_TOLERANCE) throw new ValidationError(["Montant supérieur au reste dû sur $numero (" . kgp_fmt(max(0, $reste)) . ')']);
    $record['factureRef'] = $numero;
    $record['tiers'] = ($vente ? ($facture['client'] ?? '') : ($facture['fournisseur'] ?? '')) ?: '';
  }
  return $corriges;
}
