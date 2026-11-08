# KAYELY GESTION PRO — revue OWASP Top 10 (2021)

Revue du code (application, serveurs Node.js et PHP) et de l'installation en ligne (erp.kayelygroup.com).
Chaque mesure est vérifiée par les tests : `npm test`, `npm run test:php` et `npm run test:e2e`.

| # | Catégorie | État | Mesures |
|---|---|---|---|
| A01 | Contrôle d'accès | ✅ | Droits par rôle appliqués par le serveur. Le **Caissier n'a aucun accès aux modules RH et Paie** (lecture et écriture), ne modifie ni le plan comptable ni les immobilisations, et n'écrit dans le journal que les écritures générées par ses pièces. Utilisateurs et taxes : administrateur seul. Suppression : administrateur seul, sauf écritures générées. Une base par société, avec des sessions et cookies propres. Clôture de période imposée par le serveur. Requêtes d'autres sites refusées (CORS, contrôle d'origine, cookie SameSite=Strict). |
| A02 | Défaillances cryptographiques | ✅ | HTTPS imposé et HSTS. Codes secrets hachés : scrypt (Node), bcrypt (PHP), **PBKDF2-SHA256 à 210 000 itérations en mode local**, les anciens codes en clair étant convertis à la connexion. Jetons de session aléatoires de 256 bits, stockés hachés. Cookies `Secure`, `HttpOnly`, `SameSite=Strict`. Licences signées en Ed25519, clé privée hors du code. |
| A03 | Injection | ✅ | Toutes les requêtes SQL sont préparées. Les textes saisis sont échappés à l'affichage et dans les impressions. Chaque champ est validé par le serveur (types, listes, références, tailles, noms de champs). Les exports Excel écrivent du texte, jamais des formules. |
| A04 | Conception non sécurisée | ⚠️ | Limitation des tentatives, contrôles métier côté serveur. **Prix et totaux calculés par le serveur** (voir plus bas). **Limite connue :** les écritures comptables automatiques sont calculées par le navigateur, puis vérifiées en forme par le serveur, sans être recalculées. Les déplacer côté serveur est le prochain chantier. |
| A05 | Mauvaise configuration | ✅ | Politique de sécurité (CSP) sans aucune source extérieure, ainsi que `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` et COOP/CORP. Erreurs PHP jamais affichées. Pas de listage des dossiers. Fichiers internes et données inaccessibles. Aucun compte ni code par défaut. La console avertit si le site n'est pas en HTTPS. |
| A06 | Composants vulnérables | ✅ | SheetJS 0.20.3 (CVE-2023-30533 et CVE-2024-22363 corrigées), Tesseract.js 7.0.0, versions fixées et empreintes vérifiées (`npm run vendor`). Les serveurs n'ont aucune dépendance externe. **La console signale une version de PHP sans correctifs** (moins de 8.2). |
| A07 | Identification et authentification | ✅ | 5 échecs par compte, puis blocage de 15 minutes. **30 échecs par adresse IP, tous comptes confondus** (contre l'essai d'un même code sur de nombreux comptes). Temps de réponse identique pour un compte inconnu. Code d'au moins 8 caractères (10 pour la console), ancien code par défaut refusé. Code provisoire à changer à la première connexion. Changement de code : les autres sessions sont fermées. Session expirée après 12 h d'inactivité, 7 jours au maximum. |
| A08 | Intégrité des logiciels et des données | ✅ | Bibliothèques hébergées avec l'application, plus aucun CDN, empreintes SHA-512/SHA-256 vérifiées. Seul le format JSON est accepté (pas de désérialisation d'objets). Licences signées. |
| A09 | Journalisation et surveillance | ✅ | Journal d'activité par société : connexions, **échecs et blocages de connexion**, créations, modifications, suppressions, changements de code. **Consultable par l'administrateur** (Paramètres → Journal d'activité), sans le contenu des fiches. Erreurs serveur journalisées avec une référence, sans données personnelles. Console : actions et échecs de connexion tracés. |
| A10 | Requêtes forgées côté serveur (SSRF) | ✅ | Sans objet : le serveur ne fait aucune requête sortante à partir des données saisies. La lecture OCR et Excel se fait dans le navigateur. |

## Prix et montants calculés par le serveur
Le navigateur propose les montants ; le serveur (Node `serveur/montants.mjs`, PHP `php/lib/montants.php`) décide :
* **Factures de vente :** sur une ligne qui correspond à un article (prix de vente HT) ou à un service du catalogue, le prix du catalogue est imposé. Seuls l'administrateur et le gérant peuvent accorder un autre prix (remise, prix négocié). Une ligne déjà enregistrée garde son prix quand un autre utilisateur modifie la facture. L'utilisateur est prévenu quand un prix a été corrigé.
* **Factures, factures d'achat, avoirs :** le serveur recalcule les lignes, puis le HT, la TVA et le TTC (timbre de quittance compris), et les enregistre (`montantTVA`, `montantTTC`).
* **Acompte et règlements :** l'acompte ne peut pas dépasser le TTC. Une facture ne peut pas passer sous ce qui a déjà été réglé. Un règlement doit viser une facture qui existe et du bon type. Son montant ne peut pas dépasser le reste dû. Le serveur renseigne lui-même la facture liée et le tiers.
* **Avoirs :** une facture liée doit exister et appartenir au même client. Le total des avoirs ne peut pas dépasser le TTC de cette facture.
* **Écritures comptables :** le serveur renvoie les montants qu'il a retenus. Le navigateur s'en sert pour générer les écritures, donc la comptabilité suit les chiffres du serveur.

**Paiement en ligne et IA :** l'ERP ne reçoit aucun webhook de paiement. Les règlements sont saisis à la main. Il n'appelle non plus aucun service d'IA payant : la lecture OCR se fait dans le navigateur, avec Tesseract hébergé sur le site. Si un prestataire de paiement est ajouté (CinetPay, Wave, Orange Money…), sa notification devra :
* être vérifiée par signature HMAC, avec la clé conservée hors du code ;
* être confirmée auprès du prestataire ;
* n'être traitée qu'une seule fois.

## Limites connues (à traiter)
* **A04 :** les écritures comptables automatiques sont calculées dans le navigateur. Un utilisateur malveillant qui a accès à un module comptable peut donc envoyer des écritures fausses, mais bien formées. Le Caissier en est empêché pour les saisies manuelles.
* **CSP :** l'application utilise encore des scripts directement dans la page (`'unsafe-inline'`). L'échappement systématique des textes limite le risque XSS, mais une CSP sans `'unsafe-inline'` demanderait de réécrire ces scripts.
* **Pas de double authentification (2FA)** pour l'instant.
* **Journaux d'accès de LWS :** ils contiennent des adresses IP. Ils dépendent de l'hébergeur.
