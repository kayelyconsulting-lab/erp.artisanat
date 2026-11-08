// Double authentification TOTP (RFC 6238) — codes à 6 chiffres compatibles Google Authenticator,
// Authy, FreeOTP, etc. Logique identique en PHP (php/lib/totp.php) : tests partagés.
import crypto from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf){
  let bits = 0, val = 0, out = "";
  for (const b of buf){ val = (val << 8) | b; bits += 8; while (bits >= 5){ out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str){
  const s = String(str || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0; const out = [];
  for (const c of s){ val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8){ out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function generateSecret(){ return base32Encode(crypto.randomBytes(20)); }

function hotp(secretB32, counter){
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24 | (h[o + 1] & 0xff) << 16 | (h[o + 2] & 0xff) << 8 | (h[o + 3] & 0xff)) % 1000000;
  return String(code).padStart(6, "0");
}
export function totpCode(secretB32, now = Date.now()){ return hotp(secretB32, Math.floor(now / 1000 / 30)); }

/* Vérifie un code dans une fenêtre de ±1 pas (tolérance d'horloge de 30 s), à temps constant. */
export function totpVerify(secretB32, code, now = Date.now()){
  if (!secretB32 || !/^\d{6}$/.test(String(code || ""))) return false;
  const step = Math.floor(now / 1000 / 30);
  const recu = Buffer.from(String(code));
  for (let w = -1; w <= 1; w++){
    const attendu = Buffer.from(hotp(secretB32, step + w));
    if (attendu.length === recu.length && crypto.timingSafeEqual(attendu, recu)) return true;
  }
  return false;
}
export function otpauthUri(secretB32, label, issuer){
  const compte = encodeURIComponent((issuer ? issuer + ":" : "") + label);
  return `otpauth://totp/${compte}?secret=${secretB32}&issuer=${encodeURIComponent(issuer || "")}&digits=6&period=30&algorithm=SHA1`;
}
