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

## Étapes dans LWS Panel

1. **PHP 8.1 ou plus** : *Base de données & PHP* → **Configuration php** → choisissez la version 8.1 (ou plus récente). Vérifiez que l'extension `pdo_sqlite` est cochée.
2. **Sous-domaine** : *Gestion du domaine* → **Sous domaines** → créez `erp`. Notez le dossier associé (par exemple `erp` dans `htdocs`).
3. **Fichiers** : *Fichiers* → **Gestionnaire de fichiers** → ouvrez le dossier du sous-domaine → **Envoyer** `kgpro-lws-php.zip` → clic droit → **Extraire**. Le dossier doit contenir `index.php`, `api.php`, `.htaccess` et `lib/`. Supprimez ensuite le ZIP.
4. **HTTPS** : *Sécurité* → **SSL** → activez le certificat (Let's Encrypt) pour `erp.kayelygroup.com`.
5. **Premier accès** : ouvrez https://erp.kayelygroup.com et créez **immédiatement** le compte administrateur.

## Où sont les données ?

L'application crée automatiquement le dossier `kgpro-donnees/`, si possible **à côté** du dossier du site (hors de la partie publique).
Sinon, elle le crée dans `donnees/`, à l'intérieur du site, protégé par un `.htaccess`.
Le fichier à sauvegarder est `kgpro.sqlite`. Faites-le avec *Sauvegardes / Restaurations*, ou en le téléchargeant depuis le Gestionnaire de fichiers.

## Mettre à jour

Envoyez le nouveau ZIP et extrayez-le en écrasant les fichiers. Le dossier des données n'est pas touché.

## En cas de problème

* **Page blanche ou « Erreur interne du serveur »** : vérifiez la version de PHP (8.1 minimum) et l'extension `pdo_sqlite` dans *Configuration php*.
* **« Le serveur de l'application ne répond pas… (404) »** : le fichier `.htaccess` manque. Dans le Gestionnaire de fichiers, affichez les fichiers cachés et vérifiez qu'il est présent à côté de `index.php`.
* **Erreur liée au dossier des données** : dans le Gestionnaire de fichiers, créez le dossier `kgpro-donnees` à côté du dossier du site.

---

## Autre possibilité : offre cPanel avec Node.js

Sur les offres LWS cPanel (L et plus), vous pouvez aussi utiliser la version Node.js (`serveur/`) :
« Setup Node.js App », dossier `kgpro`, fichier de démarrage `app.cjs`, Node.js 24.
