# Héberger KAYELY GESTION PRO chez LWS — offre Starter (LWS Panel, PHP)

Adresse prévue : **https://erp.kayelygroup.com**

L'offre LWS Starter ne fait pas tourner Node.js. On utilise donc la **version PHP** du serveur (`php/`).
Elle applique exactement les mêmes contrôles : connexion, rôles, vérification de chaque donnée.
La base de données est un fichier SQLite créé automatiquement : il n'y a pas de base MySQL à configurer.

## Préparer le paquet (développeur)

```bash
npm run paquet:php      # crée dist/kgpro-php/ à zipper
npm run test:php        # tests du serveur sur la version PHP
```

## Plusieurs sociétés, chacune avec sa base

Une seule installation sert **toutes les sociétés clientes**, chacune avec **sa propre base de données** : un fichier séparé, `kgpro-donnees/societes/<code>.sqlite`.
Il n'y a aucun mélange entre elles :
* comptes, codes secrets et sessions sont propres à chaque société (le même identifiant « admin » peut exister dans deux sociétés) ;
* une fiche d'une société ne peut pas être référencée par une autre ;
* la licence et la période d'essai mémorisées dans le navigateur sont séparées.

| Adresse | Rôle |
|---|---|
| `https://erp.kayelygroup.com/` | page d'accueil : la société saisit son code |
| `https://erp.kayelygroup.com/<code>/` | l'espace de la société (ex. `/cabinet-abc/`) |
| `https://erp.kayelygroup.com/console/` | **console Kayely Group** : créer, renommer, suspendre une société, débloquer un administrateur, **émettre les clés d'activation** |

## Étapes dans LWS Panel

1. **PHP 8.1 ou plus** : *Base de données & PHP* → **Configuration php** → choisissez 8.1 ou une version plus récente, avec l'extension `pdo_sqlite`.
2. **Sous-domaine** : *Gestion du domaine* → **Sous domaines** → créez `erp`. Notez son dossier (en général `htdocs/erp`).
3. **Fichiers** : *Fichiers* → **Gestionnaire de fichiers** → ouvrez **`htdocs/erp`** → **Charger** `kgpro-lws-php.zip` → clic droit → **Extraire** → supprimez le ZIP.
   Le dossier doit contenir `index.php`, `api.php`, `.htaccess` et `lib/`.
4. **HTTPS** : *Sécurité* → **SSL** → activez le certificat pour `erp.kayelygroup.com`.
5. **Console** : ouvrez `https://erp.kayelygroup.com/console/`.
   Dans le Gestionnaire de fichiers, ouvrez le dossier **`kgpro-donnees`** (à côté de `htdocs`), puis le fichier **`CODE-CONSOLE.txt`** : saisissez ce code dans la console et choisissez le mot de passe de la console (10 caractères minimum). Le fichier est ensuite supprimé automatiquement.
6. **Créer une société** dans la console (nom + code) et transmettez son adresse au client.
   À la première ouverture de son adresse, la société crée **son** compte administrateur.

## Clés d'activation (licences)

Dans la console, section **« Clés d'activation »** :

1. **Une seule fois :** cliquez sur « Créer la clé de signature ». Il faut l'extension PHP `sodium` (*Configuration php*).
   La clé privée est rangée dans `kgpro-donnees/licence-signature.key`, hors du code et hors du site public.
   La clé publique est insérée automatiquement dans l'application de chaque société.
2. Choisissez la société (ou « Autre structure » pour une version installée sur un poste), puis la durée (1 mois à 2 ans, ou une date au choix).
   Cliquez sur **Générer la clé**, puis **Copier la clé**, et transmettez-la au client.
3. Le client ouvre l'écran d'activation : le nom de sa société est déjà rempli. Il colle la clé et valide.

Toutes les clés émises restent listées dans la console.
**Sauvegardez `licence-signature.key` avec le reste du dossier.** Si ce fichier est perdu, il faut en créer un nouveau : les clés déjà émises ne seront plus reconnues et devront être réémises.

## Fonctions comptables

* **Clôture de période :** Paramètres → Société → « Période comptable clôturée jusqu'au ». Plus aucune pièce datée avant cette date ne peut être créée, modifiée ni supprimée, et c'est le serveur qui l'impose. Seul l'administrateur peut rouvrir une période.
* **Exercice :** Paramètres → Société → « Début de l'exercice comptable en cours » sert de période par défaut aux rapports.
* **États financiers :** Comptabilité → Bilan et Compte de résultat SYSCOHADA (présentation simplifiée), imprimables.
* **Déclaration de TVA :** Comptabilité → choisir le mois → TVA collectée, déductible, à payer ou crédit.
* **Grand livre et balance :** filtre du / au, report à nouveau, intitulés des comptes, export Excel.
* **Journal :** « Saisir une pièce » sur plusieurs lignes ; une pièce déséquilibrée est refusée.
* **Clients :** bouton « Relevé » (relevé de compte imprimable) ; factures avec le montant en lettres.

## Trésorerie : plusieurs caisses et banques

* **Caisses et banques :** chaque caisse et chaque banque reçoit son compte (5711, 5712… / 5211, 5212…), attribué automatiquement si le champ est laissé vide.
* **Choix précis :** factures, règlements et tickets permettent de choisir la caisse ou la banque exacte. Sans choix, le compte général 571 ou 521 est utilisé.
* **Virements internes :** Trésorerie → Virements internes (caisse → banque, banque → banque…).
* **Soldes par caisse et banque :** solde initial + mouvements, compte par compte.
* **Rapprochement bancaire automatique :**
  * importez le relevé (Excel ou CSV : colonnes Date, Libellé, Débit/Crédit ou Montant) ;
  * les lignes sont rapprochées des écritures (même montant, date à 7 jours près) ;
  * les lignes restantes se comptabilisent (frais, agios…) ou se rapprochent à la main ;
  * l'état de rapprochement est imprimable.

## Où sont les données ?

Dans le dossier `kgpro-donnees/`, créé automatiquement hors de `htdocs` (sinon dans `donnees/`, protégé) :

* `plateforme.sqlite` : la liste des sociétés, la console et l'historique des clés d'activation ;
* `licence-signature.key` : la clé privée qui signe les clés d'activation ;
* `societes/<code>.sqlite` : **la base de chaque société**.

Sauvegardez tout le dossier `kgpro-donnees` (*Sauvegardes / Restaurations*, ou téléchargement depuis le Gestionnaire de fichiers).
Pour restituer ses données à une société, il suffit de lui remettre son fichier `societes/<code>.sqlite`.

## Mettre à jour

Envoyez le nouveau ZIP dans `htdocs/erp` et extrayez-le en écrasant les fichiers. Le dossier `kgpro-donnees` n'est pas touché.

## En cas de problème

* **Page blanche ou « Erreur interne du serveur »** : vérifiez la version de PHP (8.1 minimum) et l'extension `pdo_sqlite`.
* **« Le serveur de l'application ne répond pas… (404) »** : le fichier `.htaccess` manque à côté de `index.php` (affichez les fichiers cachés).
* **« Aucune société ne correspond à cette adresse »** : le code dans l'adresse est faux, ou la société n'a pas été créée dans la console.
* **Un administrateur a perdu son code secret** : console → « Code admin oublié » → transmettez-lui le code provisoire (il devra le changer).
* **Mot de passe de la console oublié** :
  1. Dans le Gestionnaire de fichiers, créez un fichier vide nommé `REINITIALISER-CONSOLE` dans le dossier des données (`donnees` à côté de `index.php`, ou `kgpro-donnees`).
  2. Rechargez la console : elle repasse en configuration avec un nouveau code dans `CODE-CONSOLE.txt`.

  Les sociétés, leurs données et la clé de signature des licences sont conservées.

---

## Autre possibilité : offre cPanel avec Node.js

Sur les offres LWS cPanel (L et plus), vous pouvez aussi utiliser la version Node.js (`serveur/`) :
« Setup Node.js App », dossier `kgpro`, fichier de démarrage `app.cjs`, Node.js 24.
