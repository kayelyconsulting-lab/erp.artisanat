# Paiement en ligne par CinetPay

CinetPay est un agrégateur de paiement ivoirien : un seul branchement permet d'encaisser par
**Orange Money, Wave, MTN Money, Moov Money et carte bancaire**. Cette intégration permet à vos
clients de régler une facture de vente en ligne ; le paiement est ensuite enregistré
**automatiquement** comme règlement sur la facture.

## 1. Récupérer vos identifiants CinetPay
Dans votre tableau de bord CinetPay (https://app.cinetpay.com), menu **Intégration → API** :
- **Identifiant de site** (`site_id`) ;
- **Clé API** (`apikey`) ;
- **Clé secrète** (sert à vérifier l'authenticité des notifications — à ne jamais divulguer).

## 2. Configurer l'application
Connectez-vous en **administrateur**, puis ouvrez **Paramètres → Paiement en ligne (CinetPay)**.
Saisissez l'identifiant de site, la clé API et la clé secrète, choisissez le moyen enregistré sur
les encaissements (Mobile Money par défaut) et enregistrez.

La clé secrète et la clé API sont stockées **hors de l'application**, dans un fichier du dossier de
données (jamais accessible depuis le web, jamais réaffiché dans l'écran). Pour les modifier, saisissez
de nouvelles valeurs ; laissez un champ vide pour conserver l'ancienne.

## 3. Déclarer l'adresse de notification chez CinetPay
L'écran de configuration affiche votre **URL de notification** (notify_url), de la forme :

```
https://erp.kayelygroup.com/<votre-societe>/api/paiement/webhook
```

CinetPay l'utilise automatiquement (elle est transmise à chaque demande de paiement). Aucune action
supplémentaire n'est nécessaire, mais vous pouvez la renseigner aussi dans votre tableau de bord
CinetPay si l'option est proposée.

## 4. Encaisser une facture
Sur la liste des **Factures de vente**, chaque facture non soldée affiche un bouton **« Payer en
ligne »**. Il ouvre la page de paiement sécurisée de CinetPay pour le montant restant dû. Une fois le
client payé, CinetPay notifie l'application, qui enregistre le règlement sur la facture.

## Comment la sécurité est assurée
1. **Signature vérifiée.** Chaque notification de CinetPay porte un jeton `x-token`
   (HMAC-SHA256 des champs de la notification, calculé avec votre clé secrète). Le serveur recalcule
   ce jeton et le compare à temps constant : une notification non signée ou falsifiée est **refusée**.
2. **Statut reconfirmé.** Le serveur ne fait pas confiance au seul contenu de la notification : il
   rappelle l'API CinetPay (`/v2/payment/check`) pour vérifier que la transaction est bien
   **ACCEPTED**, le **montant** et la **devise** (XOF).
3. **Enregistré une seule fois.** Le règlement porte la référence `CinetPay <transaction>` ; si la
   notification est reçue deux fois, le second envoi est ignoré (idempotence).
4. **Montant contrôlé.** Le montant encaissé doit correspondre à la demande et ne pas dépasser le
   reste dû de la facture.

## Pré-requis d'hébergement
Le serveur doit pouvoir joindre `api-checkout.cinetpay.com` en sortie (HTTPS). C'est le cas sur
l'hébergement LWS. Le site doit être en **HTTPS** (déjà imposé par l'application).

## Tester
La vérification de signature est couverte par les tests automatiques (Node et PHP produisent la même
signature, une signature falsifiée est refusée, la clé secrète n'est jamais renvoyée). Le parcours
complet (paiement réel → notification → règlement) se teste avec votre compte CinetPay, de préférence
d'abord en mode test/bac à sable proposé par CinetPay.
