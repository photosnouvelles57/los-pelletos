# Los Pelletos

Site vitrine + prototype de jeu jouable dans le navigateur.

## Jeu : Xeno Purge (`game/`)

Prototype de RPG monde ouvert en 3D (Three.js, vendoré localement dans `game/vendor/`,
aucune dépendance réseau au runtime) :

- Déplacement libre (ZQSD/WASD), visée souris, saut, sprint.
- Combat au blaster contre des ennemis ("Xenites") avec IA simple (patrouille → poursuite → attaque).
- Progression RPG : XP, niveaux, points de vie croissants, vagues d'ennemis de plus en plus difficiles.
- Sauvegarde automatique de la progression dans le navigateur (`localStorage`).

Pour tester en local :

```
python3 -m http.server 8000
# puis ouvrir http://localhost:8000/game/index.html
```

## Publier sur le Microsoft Store

Le jeu est une page web autonome (`game/`) avec un `manifest.json` de PWA. Le chemin le plus
simple vers le Microsoft Store, sans réécrire le jeu dans Unity/Unreal, est de l'empaqueter en
PWA avec l'outil officiel Microsoft **PWA Builder** :

1. Héberger `game/` (et son `manifest.json`) sur une URL HTTPS publique.
2. Aller sur https://www.pwabuilder.com/ et entrer l'URL du jeu.
3. Générer le package **Windows (MSIX)**.
4. Créer un compte développeur sur le Microsoft Partner Center (frais unique) si ce n'est pas
   déjà fait, puis soumettre le package généré à la certification du Store.

Étapes encore à faire avant soumission : icônes d'application (192x192, 512x512) à ajouter dans
`manifest.json`, captures d'écran pour la fiche Store, et test hors-ligne du service worker.
