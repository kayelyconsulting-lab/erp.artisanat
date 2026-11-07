// Mots de passe hachés (scrypt + sel aléatoire) et jetons de session.
import crypto from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const LEGACY_DEFAULT_PASSWORDS = ["kayely123"];
export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(password){
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password, stored){
  if (typeof stored !== "string" || typeof password !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length,
    { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

// Hachage factice pour garder un temps de réponse constant quand l'identifiant n'existe pas.
export const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

export function passwordProblem(password){
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) return `Le code secret doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  if (password.length > 200) return "Code secret trop long.";
  if (LEGACY_DEFAULT_PASSWORDS.includes(password)) return "Ce code secret est interdit : choisissez-en un autre.";
  return null;
}

export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const tokenHash = token => crypto.createHash("sha256").update(token).digest("hex");

// Limitation des tentatives de connexion : 5 échecs -> blocage 15 minutes (par IP + identifiant).
export function createLoginLimiter({ max = 5, windowMs = 15 * 60 * 1000 } = {}){
  const fails = new Map();
  return {
    blocked(key){
      const e = fails.get(key);
      if (!e) return false;
      if (Date.now() - e.first > windowMs){ fails.delete(key); return false; }
      return e.count >= max;
    },
    fail(key){
      const e = fails.get(key);
      if (!e || Date.now() - e.first > windowMs) fails.set(key, { count: 1, first: Date.now() });
      else e.count++;
    },
    reset(key){ fails.delete(key); },
  };
}
