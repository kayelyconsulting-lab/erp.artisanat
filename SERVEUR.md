# Serveur KAYELY GESTION PRO — vérification des données côté serveur

Deux versions identiques du serveur, qui passent les mêmes tests :
* **Node.js** (`serveur/`, `npm test`) : pour un VPS ou une offre cPanel avec Node.js ;
* **PHP** (`php/`, `npm run test:php`) : pour un hébergement PHP classique (LWS Starter). Voir `HEBERGEMENT-LWS.md`.
  Cette version gère **plusieurs sociétés, chacune avec sa propre base** (`/<code>/`), et une console Kayely Group (`/console/`).
  La version Node.js ne sert qu'une seule société par installation.

Les règles de champs de la version PHP sont dans `php/lib/schema.json`, généré depuis `kgpro.html` par `node outils/generer-schema.mjs`.
**Relancez cette commande après toute modification des modules de `kgpro.html`.** Le test le vérifie.

Quand l'application est ouverte **via le serveur**, chaque lecture et chaque écriture passe par lui.
Il vérifie trois choses avant d'enregistrer quoi que ce soit :

1. **Qui vous êtes**
   * La connexion se vérifie sur le serveur. Les codes secrets sont hachés (scrypt) et ne sont jamais renvoyés au navigateur.
   * La session est conservée dans un cookie `HttpOnly` / `SameSite=Strict`. Elle expire après 12 h d'inactivité.
   * Après 5 échecs de connexion, le compte est bloqué 15 minutes.
   * Un compte désactivé ou expiré est déconnecté immédiatement.
2. **Ce que votre rôle permet**
   * Ce sont les mêmes règles que l'interface, mais appliquées par le serveur.
   * *Paramètres* : Gérant et Administrateur.
   * *Taxes* et *Utilisateurs* : Administrateur uniquement.
   * *Suppression* : Administrateur uniquement.
   * Il reste toujours au moins un administrateur actif.
3. **Chaque donnée**
   * Les règles viennent des définitions de modules de `kgpro.html` (`SECTIONS`). Le serveur les lit directement dans ce fichier : il n'y a qu'une seule source de règles.
   * Types : texte, nombre, date réelle `AAAA-MM-JJ`, image (`data:image/...`).
   * Champs obligatoires et valeurs des listes de choix.
   * Références : le client, le fournisseur, l'article ou l'employé choisi doit exister.
   * Nombres : positifs ; pourcentages entre 0 et 100 ; seuls les soldes peuvent être négatifs.
   * Lignes de facture : contrôlées, et les montants (`montant`, `montantHT`) sont **recalculés par le serveur**.
   * Numéros de pièce (FA-0001…) : préfixe correct et unicité.
   * Journal : une écriture ne peut pas être à la fois au débit et au crédit.
   * Tailles maximales et noms de champs contrôlés (`__proto__` est refusé, par exemple).

Une donnée refusée renvoie une erreur 422 avec la liste des problèmes, affichée à l'utilisateur.
Chaque création, modification, suppression et connexion est enregistrée dans la table `audit`.

## Démarrer

Node.js **22.13 ou plus récent**. Aucune dépendance à installer.

```bash
npm start                       # http://127.0.0.1:8080
PORT=80 HOST=0.0.0.0 npm start  # accessible depuis le réseau local
npm test                        # tests du serveur
```

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8080` | port d'écoute |
| `HOST` | `127.0.0.1` | `0.0.0.0` pour le réseau local |
| `KGP_DB_FILE` | `donnees/kgpro.sqlite` | fichier de la base (exclu de git) |
| `KGP_APP_FILE` | `kgpro.html` | page de l'application |

Au premier accès, l'application demande de créer le compte administrateur.

**Sur Internet, placez le serveur derrière un proxy HTTPS** (Caddy, Nginx…), qui transmet `X-Forwarded-Proto: https`.
Le cookie de session est alors marqué `Secure`.
Sauvegardez régulièrement le fichier `donnees/kgpro.sqlite`.

## Reprendre des données existantes

Les données saisies avant le serveur sont dans le navigateur de chaque poste (IndexedDB).
Le serveur ne peut pas les lire directement.
Exportez chaque module en Excel depuis l'ancienne version, puis importez-le dans la version serveur : chaque ligne importée est vérifiée comme une saisie.

## Ce qui reste hors serveur

* L'application ouverte **sans serveur** (fichier local, version Electron) garde sa base locale, sans vérification serveur.
* Les calculs métier complexes (paie, amortissements, écritures générées automatiquement) sont toujours faits par l'application. Le serveur vérifie la forme et les limites des valeurs, pas le résultat de ces calculs.
* La licence est toujours contrôlée dans le navigateur.
