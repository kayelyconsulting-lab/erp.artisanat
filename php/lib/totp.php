<?php
// Double authentification TOTP (RFC 6238) — port de serveur/totp.mjs (mêmes codes, tests partagés).

const KGP_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function kgp_base32_encode(string $buf): string {
  $bits = 0; $val = 0; $out = '';
  for ($i = 0; $i < strlen($buf); $i++){
    $val = ($val << 8) | ord($buf[$i]); $bits += 8;
    while ($bits >= 5){ $out .= KGP_B32[($val >> ($bits - 5)) & 31]; $bits -= 5; }
  }
  if ($bits > 0) $out .= KGP_B32[($val << (5 - $bits)) & 31];
  return $out;
}
function kgp_base32_decode(string $str): string {
  $s = preg_replace('/[^A-Z2-7]/', '', strtoupper($str));
  $bits = 0; $val = 0; $out = '';
  for ($i = 0; $i < strlen($s); $i++){
    $val = ($val << 5) | strpos(KGP_B32, $s[$i]); $bits += 5;
    if ($bits >= 8){ $out .= chr(($val >> ($bits - 8)) & 255); $bits -= 8; }
  }
  return $out;
}
function kgp_totp_secret(): string { return kgp_base32_encode(random_bytes(20)); }

function kgp_hotp(string $secretB32, int $counter): string {
  $bin = pack('N*', 0) . pack('N*', $counter);   // compteur 64 bits big-endian
  $h = hash_hmac('sha1', $bin, kgp_base32_decode($secretB32), true);
  $o = ord($h[strlen($h) - 1]) & 0xf;
  $code = ((ord($h[$o]) & 0x7f) << 24 | (ord($h[$o + 1]) & 0xff) << 16 | (ord($h[$o + 2]) & 0xff) << 8 | (ord($h[$o + 3]) & 0xff)) % 1000000;
  return str_pad((string)$code, 6, '0', STR_PAD_LEFT);
}
function kgp_totp_code(string $secretB32, ?int $now = null): string { return kgp_hotp($secretB32, intdiv(($now ?? time()), 30)); }

/** Vérifie un code dans une fenêtre de ±1 pas, à temps constant. */
function kgp_totp_verify(?string $secretB32, $code, ?int $now = null): bool {
  if (!$secretB32 || !preg_match('/^\d{6}$/', (string)$code)) return false;
  $step = intdiv(($now ?? time()), 30);
  for ($w = -1; $w <= 1; $w++) if (hash_equals(kgp_hotp($secretB32, $step + $w), (string)$code)) return true;
  return false;
}
function kgp_otpauth_uri(string $secretB32, string $label, string $issuer): string {
  $compte = rawurlencode(($issuer !== '' ? $issuer . ':' : '') . $label);
  return "otpauth://totp/$compte?secret=$secretB32&issuer=" . rawurlencode($issuer) . "&digits=6&period=30&algorithm=SHA1";
}
