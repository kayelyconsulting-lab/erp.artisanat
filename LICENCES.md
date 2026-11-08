# Licences KAYELY GESTION PRO — clés secrètes hors du code

## Ce qui a changé

| Avant | Maintenant |
|---|---|
| `KGP_LICENSE_SALT` (sel secret) écrit dans `kgpro.html` : n'importe qui lisant le code pouvait fabriquer des clés valides. | L'application n'embarque qu'une **clé publique** Ed25519 (`KGP_LICENSE_PUBLIC_KEY`). Elle sert à *vérifier* une clé, pas à en *fabriquer*. |
| Les clés étaient calculées avec ce même sel. | Les clés sont **signées** avec une **clé privée** qui reste sur le poste de Kayely Group, hors du dépôt. |
| Compte `admin` / `kayely123` créé automatiquement. | Au premier lancement, l'utilisateur **choisit** l'identifiant et le code secret de l'administrateur (8 caractères minimum). Un compte qui utilise encore `kayely123` doit changer son code secret à la connexion suivante. |

Format des nouvelles clés : `KGP2-AAMMJJ-<signature>` (la signature porte sur la structure + la date).

## Hébergement PHP (LWS) : tout se fait dans la console

Sur l'hébergement PHP, la console (`/console/`, section « Clés d'activation ») crée la clé de signature, émet les clés et garde l'historique.
La clé publique est insérée automatiquement dans l'application servie. Voir `HEBERGEMENT-LWS.md`.
L'outil ci-dessous sert pour une version distribuée hors serveur (fichier local, Electron).

## Mise en place hors serveur (une seule fois)

```bash
node outils/kgp-licence.mjs init --html kgpro.html
```

* crée la clé privée dans `~/.kayely/kgp-licence-privee.pem` (droits 600). Vous pouvez choisir un autre chemin avec `--cle` ou la variable `KGP_LICENSE_PRIVATE_KEY_FILE`. L'outil refuse un chemin situé dans un dépôt git ;
* inscrit la clé publique dans `kgpro.html` (à committer : elle n'est pas secrète).

**Sauvegardez la clé privée hors ligne** (clé USB chiffrée, coffre-fort de mots de passe). Si elle est perdue, plus aucune clé ne peut être émise pour les installations existantes. Si elle fuit, régénérez-la et redistribuez l'application.

## Émettre une licence

```bash
node outils/kgp-licence.mjs generer --structure "Cabinet ABC SARL" --expiration 2027-12-31
```

## Clients existants (anciennes clés `KGP-…`)

L'ancien sel était inclus dans toutes les versions distribuées : il est donc **compromis** et n'est plus dans le code.
Une licence `KGP-…` **déjà activée** sur un poste reste reconnue jusqu'à son échéance, pour ne bloquer personne.
Le renouvellement et les nouvelles activations ne se font qu'avec une clé `KGP2-…`.

## Version Windows (Electron) — `main.js`

`main.js` n'est pas dans ce dépôt. S'il contient le même sel, remplacez sa vérification par :

```js
const crypto = require("crypto");
const KGP_LICENSE_PUBLIC_KEY = "…même valeur que dans kgpro.html…";
const pubKey = crypto.createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"),
                      Buffer.from(KGP_LICENSE_PUBLIC_KEY, "base64url")]),
  format: "der", type: "spki",
});
function kgpValidateKey(company, key){
  const m = /^KGP2-(\d{6})-([A-Za-z0-9_-]{86})$/.exec(String(key || "").replace(/\s+/g, ""));
  if (!m) return null;
  const norm = (company || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ok = crypto.verify(null, Buffer.from(`KGP2|${norm}|${m[1]}`), pubKey, Buffer.from(m[2], "base64url"));
  if (!ok) return null;
  const y = 2000 + +m[1].slice(0, 2), mo = +m[1].slice(2, 4) - 1, d = +m[1].slice(4, 6);
  return { expiry: new Date(y, mo, d, 23, 59, 59) };
}
```

## Limite à connaître

La vérification se fait sur le poste du client : quelqu'un qui modifie le code de l'application peut toujours contourner le contrôle.
La signature empêche seulement de **fabriquer** des clés à partir du code, ce qui était le problème avec le sel embarqué.
