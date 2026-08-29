# SSALEMDEV — Logiciel de location de costume à distance

Application web multi-clients : chaque boutique qui te paie a son propre
compte, avec ses données totalement séparées des autres. **Les clients ne
peuvent pas créer leur compte eux-mêmes** — c'est toi (l'admin) qui crées
chaque compte après avoir reçu le paiement, puis tu donnes l'email et le mot
de passe au client.

## ⚠️ Si tu héberges sur Vercel — étape obligatoire

Vercel ne garde pas de fichier sur le disque (contrairement à Render/Railway).
Cette appli est donc prête pour Vercel, **mais il faut absolument connecter
une base de données** sinon rien ne sera jamais sauvegardé, même si la
connexion a l'air de marcher.

1. Sur https://vercel.com, ouvre ton projet (ex: `locationcostumedz`)
2. Onglet **Storage** → **Create Database** → choisis **Upstash → Redis**
   (le plan gratuit suffit largement pour commencer)
3. Vercel te propose de le **connecter au projet** → accepte (ça ajoute
   automatiquement les variables `KV_REST_API_URL` et `KV_REST_API_TOKEN`,
   ou `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` selon la version —
   les deux fonctionnent avec cette appli)
4. Ajoute aussi (onglet **Settings → Environment Variables**) :
   - `JWT_SECRET` = une phrase secrète longue et unique
   - `ADMIN_EMAIL` = ton email admin
   - `ADMIN_PASSWORD` = ton mot de passe admin
5. Redéploie le projet (Vercel le fait souvent automatiquement après l'ajout
   de variables — sinon "Deployments" → "..." → "Redeploy")
6. Va sur `https://ton-site.vercel.app/admin` et connecte-toi avec l'email
   et le mot de passe définis à l'étape 4

Sans cette base connectée, l'admin/login ou les autres actions renverront
"Erreur serveur".

## Ce qu'elle fait
- Connexion client par email + mot de passe (pas d'inscription publique)
- **Panneau admin** (toi uniquement) pour créer un compte client, réinitialiser
  un mot de passe, ou supprimer un client (ex: s'il arrête de payer)
- Gestion des costumes avec stock par taille (42 à 66)
- Locations avec règle métier : un costume/taille ne peut être reloué que si
  la nouvelle date d'événement est à plus de 2 jours d'écart d'une réservation
  existante (le costume est bloqué du J-2 au J+2)
- Caisse : historique des revenus/dépenses, **impossible à supprimer**, groupé
  par jour (Aujourd'hui, Hier, 3 jours, 7 jours, année, tout)
- **Rappels automatiques** sur le tableau de bord : retours en retard (rouge)
  ou prévus dans les 2 prochains jours (orange), triés par urgence
- **Recherche client** par nom ou téléphone (dans l'onglet Locations),
  retrouve tout l'historique d'un client peu importe le statut
- **Calendrier visuel** par costume et par taille (bouton "📅 Calendrier" sur
  chaque costume) : vue mois par mois, vert = libre, orange = partiellement
  pris, rouge = complet
- **Inventaire complet** dans l'onglet Costumes (sous-onglets) :
  - **Costumes** : stock **veste** et **pantalon séparés** (tailles 42 à 66
    chacun) — un client peut prendre une veste 46 avec un pantalon 48, chaque
    partie a son propre stock et sa propre règle des 2 jours
  - **Chemises** : tailles XS à 3XL, stock séparé, règle des 2 jours
  - **Chaussures** : par modèle + pointure (39 à 46), règle des 2 jours
  - **Jabador** et **Bernous** : par couleur, règle des 2 jours
  - **Accessoires** (cravates / nœuds papillon) et **Montres** : stock simple
- **Plusieurs costumes dans une même location** : bouton "+ Ajouter un 2ème
  costume" dans le formulaire de location — chaque costume ajouté propose
  ensuite d'en ajouter un 3ème, etc. (utile si un client loue pour lui-même
  et pour un témoin, par exemple)
- Fonctionne comme une "appli" une fois ajoutée à l'écran d'accueil du
  téléphone (PWA)

## Comment créer un compte pour un nouveau client (toi, l'admin)

1. Va sur `https://ton-domaine.com/admin` (remarque le `/admin` à la fin)
2. Connecte-toi avec l'email/mot de passe admin (voir section Sécurité
   ci-dessous — **à changer avant toute mise en ligne**)
3. Remplis le formulaire "Créer un compte client" (nom de la boutique, email,
   mot de passe que tu choisis pour lui)
4. Une fois créé, copie l'email + mot de passe affichés et envoie-les au
   client par WhatsApp/SMS
5. Le client va sur `https://ton-domaine.com` (sans `/admin`) et se connecte
   avec ce que tu lui as donné

Tu peux aussi réinitialiser le mot de passe d'un client (s'il l'a oublié) ou
supprimer un client (s'il arrête de payer) directement depuis ce panneau.

## Comment héberger cette application (étape par étape)

Tu as besoin de 2 choses : un **hébergeur** (qui fait tourner le code en
continu) et un **nom de domaine** (que tu achètes séparément, ex: chez OVH,
Namecheap, ou directement via l'hébergeur).

### Option recommandée pour débuter : Render.com (gratuit pour commencer)

1. Crée un compte sur https://render.com
2. Mets ce dossier entier sur GitHub (crée un compte gratuit sur
   https://github.com si besoin, puis "New repository" → upload ce dossier)
3. Sur Render : "New +" → "Web Service" → connecte ton dépôt GitHub
4. Render détecte automatiquement Node.js. Renseigne :
   - Build Command : `npm install`
   - Start Command : `npm start`
5. Dans "Environment", ajoute une variable :
   - `JWT_SECRET` = une phrase secrète longue et unique (ex: un mot de passe
     aléatoire de 40 caractères) — **obligatoire pour la sécurité**
6. ⚠️ Important : la base de données (fichier `data/pigos.db`) doit être sur
   un **disque persistant** sinon elle est effacée à chaque redéploiement.
   Sur Render : onglet "Disks" → ajoute un disque monté sur `/opt/render/project/src/data`
   (Render propose un disque gratuit de 1 Go sur le plan payant le moins cher,
   ~7$/mois — le plan gratuit réinitialise les données, à éviter pour un usage
   réel/commercial).
7. Une fois déployé, Render te donne une adresse du type
   `https://pigos-xxxx.onrender.com` — l'appli fonctionne déjà à ce stade.

### Ajouter ton propre nom de domaine

1. Achète un nom de domaine (ex: `pigos-app.com`) chez un registrar
   (Namecheap, OVH, GoDaddy...) — compte environ 1000-3000 DA/an selon
   l'extension.
2. Sur Render : ton service → "Settings" → "Custom Domain" → ajoute ton
   domaine.
3. Render te donne un enregistrement DNS à copier chez ton registrar
   (généralement un `CNAME`). Une fois ajouté, ça prend quelques heures à
   quelques jours pour se propager.
4. Ton appli sera accessible sur `https://pigos-app.com` (ou le nom que tu
   choisis).

### Alternatives à Render
- **Railway.app** — similaire, souvent plus simple pour les bases de données
- **Fly.io** — bon pour un vrai disque persistant gratuit
- Un VPS chez un hébergeur algérien/français si tu veux tout contrôler
  toi-même (plus technique)

## Sécurité — à faire avant de vendre à des clients

Sur ton hébergeur (Render, Railway...), section "Environment" / "Variables
d'environnement", ajoute ces 3 valeurs **avant de mettre en ligne** :

- `JWT_SECRET` = une phrase secrète longue et unique (ne garde jamais la
  valeur par défaut du code — n'importe qui pourrait sinon se faire passer
  pour un utilisateur)
- `ADMIN_EMAIL` = l'email avec lequel TOI seul te connectes sur `/admin`
- `ADMIN_PASSWORD` = un mot de passe fort, que tu es seul à connaître

Sans ces 3 variables, l'appli utilise des valeurs par défaut **non
sécurisées** (visibles dans le code) — à ne jamais utiliser en production.

Autres points :
- Active HTTPS (automatique sur Render/Railway/Fly)
- Fais des sauvegardes régulières du fichier `data/pigos-data.json`
- Ne partage jamais le lien `/admin` ni tes identifiants admin
- Pense à des conditions d'utilisation si tu factures d'autres boutiques

## Lancer en local pour tester (sur ton ordinateur)

```bash
npm install
npm start
```
Puis ouvre `http://localhost:3000` dans ton navigateur.

## Structure du projet
```
pigos-webapp/
  server.js       → serveur + API (comptes, costumes, locations, caisse)
  db.js           → base de données SQLite
  public/
    index.html    → page principale
    app.js        → toute la logique de l'appli (front-end)
    style.css     → apparence (thème sombre/doré)
  data/           → où la base de données est stockée (à sauvegarder !)
```
