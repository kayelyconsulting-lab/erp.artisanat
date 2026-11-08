// Signature des notifications de paiement CinetPay (jeton HMAC-SHA256 de l'en-tête x-token).
// La version PHP (php/lib/paiement.php) porte toute l'intégration ; ce module Node sert surtout
// à vérifier que les deux implémentations calculent la même signature (test partagé).
// Référence : https://docs.cinetpay.com/api/1.0-en/checkout/hmac
import crypto from "node:crypto";

// Champs de la notification concaténés pour le jeton, dans l'ordre officiel CinetPay.
export const CINETPAY_CHAMPS = [
  "cpm_site_id", "cpm_trans_id", "cpm_trans_date", "cpm_amount", "cpm_currency", "signature", "payment_method",
  "cel_phone_num", "cpm_phone_prefixe", "cpm_language", "cpm_version", "cpm_payment_config", "cpm_page_action",
  "cpm_custom", "cpm_designation", "cpm_error_message",
];

export function cinetpayToken(post, secret){
  const data = CINETPAY_CHAMPS.map(c => String(post[c] ?? "")).join("");
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

/* Comparaison à temps constant du jeton reçu et du jeton attendu. */
export function cinetpaySignatureValide(post, recu, secret){
  if (typeof recu !== "string" || !recu) return false;
  const attendu = cinetpayToken(post, secret);
  const a = Buffer.from(attendu), b = Buffer.from(recu);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
