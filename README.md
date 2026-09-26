# Suivi Rotation — Interventions locatives

Application web simple (sans serveur obligatoire) pour suivre les interventions de rotation locative sur **60 logements** (L01–L60).

Corps d'état couverts :
- **Plomberie** — 10 points (P01–P10)
- **Chauffage** — 8 points (C01–C08)
- **Sanitaire** — 8 points (S01–S08)

Les données sont enregistrées dans le **localStorage** du navigateur (aucun compte, aucun backend).

## Ouvrir l'application

### Option 1 — Fichier local
Double-cliquez sur `index.html`, ou ouvrez-le depuis le navigateur (Fichier → Ouvrir).

> Sur certains navigateurs, le mode `file://` fonctionne parfaitement pour cette app (tout est local).

### Option 2 — Petit serveur HTTP (recommandé)
Dans ce dossier :

```bash
cd suivi-rotation
python3 -m http.server 8080
```

Puis ouvrez [http://localhost:8080](http://localhost:8080).

### Option 3 — Vercel (statique)
Déposez le dossier sur Vercel (ou `vercel deploy`). Un fichier `vercel.json` minimal est fourni.

## Utilisation

1. **Liste** — 60 logements avec % global et badges Plomberie / Chauffage / Sanitaire.
2. **Détail** — tapez un logement pour cocher chaque intervention (Non → En cours → Fait), ajouter une date et une note / intervenant.
3. **Synthèse** — menu ☰ → Synthèse : totaux et % par corps d'état, nombre de logements à 100 %.
4. **Export / Import JSON** — sauvegarde de secours ou transfert vers un autre appareil.
5. **Réinitialiser** — remet tout à zéro (demande confirmation).
6. **Nom du logement** — étiquette optionnelle affichée sous L01, L02, etc.

## Fichiers

| Fichier        | Rôle                          |
|----------------|-------------------------------|
| `index.html`   | Structure de la page          |
| `styles.css`   | Interface mobile-friendly     |
| `app.js`       | Logique + persistance         |
| `vercel.json`  | Déploiement statique Vercel   |

## Astuce terrain

Exportez régulièrement le JSON (menu ☰) — le localStorage est lié au navigateur / appareil. Sur téléphone de chantier, ajoutez la page à l'écran d'accueil pour un accès rapide.
