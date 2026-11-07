# Héberger KAYELY GESTION PRO chez LWS

Adresse prévue : **https://erp.kayelygroup.com**

## 1. Vérifier l'offre

Le serveur a besoin de **Node.js**. Chez LWS, Node.js est disponible sur les offres **cPanel L, XL, 2XL, 3XL et CloudCP**, via le menu « Setup Node.js App ».
Si votre panneau LWS n'a pas ce menu (offre d'entrée de gamme, ou « LWS Panel » sans cPanel), il faut passer à une de ces offres ou à un VPS.
Les offres PHP seules ne peuvent pas faire tourner le serveur.

## 2. Créer le sous-domaine `erp.kayelygroup.com`

cPanel → **Domaines** (ou « Sous-domaines ») → **Créer un domaine** : `erp.kayelygroup.com`.
Si le domaine `kayelygroup.com` est géré chez LWS, l'enregistrement DNS est créé automatiquement.
Sinon, ajoutez chez votre gestionnaire DNS un enregistrement `A` pour `erp` vers l'adresse IP de l'hébergement LWS (indiquée dans cPanel, colonne de droite « Adresse IP partagée »).
La propagation peut prendre quelques heures.

## 3. Envoyer les fichiers

Dans cPanel, ouvrez le **Gestionnaire de fichiers** (ou « Git™ Version Control » pour cloner le dépôt).
Placez l'application dans un dossier **hors de `public_html`**, par exemple `/home/<compte>/kgpro/` :

```
kgpro/
├── app.cjs          ← fichier de démarrage
├── package.json
├── kgpro.html
└── serveur/         ← auth.mjs, db.mjs, schema.mjs, server.mjs, validation.mjs
```

Ne pas envoyer : `outils/` (générateur de licence) ni aucune clé privée `.pem`.

## 4. Créer l'application Node.js

cPanel → **Setup Node.js App** → **Create Application** :

| Champ | Valeur |
|---|---|
| Node.js version | **24** (minimum 22.13) |
| Application mode | Production |
| Application root | `kgpro` |
| Application URL | `erp.kayelygroup.com` |
| Application startup file | `app.cjs` |

Variables d'environnement, facultatives :

| Nom | Valeur |
|---|---|
| `KGP_DB_FILE` | `/home/<compte>/kgpro-donnees/kgpro.sqlite`, pour garder la base hors du dossier de l'application |

Cliquez sur **Create**, puis sur **Restart**. Il n'y a pas d'`npm install` à lancer : le serveur n'a aucune dépendance.

## 5. Activer HTTPS

cPanel → **SSL/TLS Status** (ou **Let's Encrypt**) : activez le certificat pour `erp.kayelygroup.com`.
Ensuite, ouvrez toujours l'application en `https://erp.kayelygroup.com`.

## 6. Premier accès

Ouvrez `https://erp.kayelygroup.com/`. L'application demande de créer le compte administrateur.
Créez-le **tout de suite** : tant qu'il n'existe pas, le premier visiteur pourrait le créer à votre place.

## 7. Sauvegardes et mises à jour

* **Sauvegarde :** les données sont dans le fichier SQLite (`donnees/kgpro.sqlite` par défaut, ou `KGP_DB_FILE`). Téléchargez-le régulièrement, ou incluez-le dans les sauvegardes cPanel. Copiez aussi les fichiers `-wal` et `-shm` s'ils existent.
* **Mise à jour :** remplacez les fichiers, puis **Restart** dans « Setup Node.js App ». La base n'est pas touchée.

## En cas de problème

* **« Erreur serveur (404) » ou « Le serveur de l'application ne répond pas… » :**
  * dans « Setup Node.js App », le champ *Application URL* doit être `erp.kayelygroup.com`, sans rien après ;
  * le dossier `public_html` du sous-domaine ne doit pas contenir de copie de `kgpro.html` ni de `.htaccess` qui redirige ;
  * cliquez sur **Restart** après chaque modification.

* **Page d'erreur Passenger :** dans « Setup Node.js App », vérifiez la version de Node.js (22.13 minimum) et le fichier de démarrage `app.cjs`. Le journal d'erreurs est indiqué sur cette page (souvent `stderr.log` dans le dossier de l'application).
* **« Node.js … trop ancien » :** choisissez une version de Node.js plus récente.
