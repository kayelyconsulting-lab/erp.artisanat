# Pub vidéo Kayely Group

Publicité en motion design pour Kayely Group / KAYELY GESTION PRO, réalisée avec [Remotion](https://www.remotion.dev) (React).
Voix off française, musique, sous-titres animés et vrai logo.

## Formats produits

| Composition | Fichier | Taille | Usage |
|---|---|---|---|
| `PubV` | `kayely-reseaux-9x16.mp4` | 1080×1920, 32 s | TikTok, Reels, Shorts |
| `PubV` (montage) | `kayely-reseaux-15s-9x16.mp4` | 1080×1920, 15 s | Stories, statuts WhatsApp |
| `Pub45` | `kayely-reseaux-4x5.mp4` | 1080×1350, 32 s | Fil Instagram / Facebook |
| `PubH` | `kayely-reseaux-16x9.mp4` | 1920×1080, 32 s | YouTube, LinkedIn |

## Utilisation

```bash
cd marketing/pub-video
npm install
npm run studio   # éditeur visuel Remotion dans le navigateur (aperçu image par image)
npm run rendu    # rend les 4 vidéos dans out/ (nécessite ffmpeg pour la version 15 s)
```

## Où modifier quoi

- `src/Pub.tsx` : toute l'animation.
  - `T` (en haut) : moment de chaque animation, en images (30 images = 1 s), calé sur la voix off.
  - `Intro`, `Problem`, `Product`, `Features`, `Values`, `Cta` : les 6 scènes.
  - `Cta` : écran de fin (site, téléphone, e-mail).
  - Chiffres du tableau de bord (fictifs) : `kpis` et `bars` dans `Product`.
- `src/captions.json` : sous-titres mot par mot (`s`/`e` = début/fin en images).
- `public/` : logo (versions couleur et blanche, symbole seul) et bande-son complète `mix.m4a`.
- `audio/` : sources de la bande-son.
  - `voix/` : les 6 phrases de voix off et leur texte (`textes.txt`), générées avec la voix libre Piper `fr_FR-siwis-medium`.
  - `musique.py` : musique de fond générée par programme, libre de droits (`python3 musique.py 32 musique.wav`).
  - `mix15.m4a` : bande-son de la version 15 s.

Si vous changez le texte de la voix off, régénérez les phrases, refaites le mixage, puis ajustez `T` et `captions.json`.

## Licence Remotion

Remotion est gratuit pour un particulier ou une entreprise de 3 salariés maximum ; au-delà, une licence entreprise est requise. Voir remotion.dev/license.
