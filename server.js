const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const path = require("path");
const { data, save, reload } = require("./store");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@ssalemdev.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-this-admin-password";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Recharge les données à jour avant CHAQUE requête API. Indispensable en
// hébergement "serverless" (Vercel) : chaque requête peut être traitée par
// une instance différente, sans mémoire partagée — il faut donc relire la
// source de vérité (Vercel KV) systématiquement plutôt que de faire
// confiance à une copie en mémoire qui pourrait être périmée.
app.use("/api", async (req, res, next) => {
  try {
    await reload();
    next();
  } catch (e) {
    console.error("Erreur de chargement des données :", e);
    res.status(500).json({ error: "Erreur serveur (chargement des données)" });
  }
});

function uid() {
  return crypto.randomBytes(12).toString("hex");
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function diffJours(a, b) {
  return Math.round(Math.abs(new Date(a) - new Date(b)) / 86400000);
}
function seChevauchent(dateA, dateB) {
  return diffJours(dateA, dateB) <= 2;
}

// ============ AUTH ============
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non authentifié" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.businessId = payload.businessId;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session invalide, reconnecte-toi" });
  }
}

// L'inscription publique n'existe plus : les comptes clients sont créés
// uniquement par l'admin (SSALEMDEV) via /api/admin/clients, après paiement.

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email et mot de passe requis" });
  const biz = data.businesses.find((b) => b.email === email.toLowerCase());
  if (!biz || !bcrypt.compareSync(password, biz.password_hash)) {
    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  }
  const token = jwt.sign({ businessId: biz.id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, nomBoutique: biz.nom_boutique });
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  const biz = data.businesses.find((b) => b.id === req.businessId);
  if (!biz) return res.status(404).json({ error: "Compte introuvable" });
  res.json({ nom_boutique: biz.nom_boutique, email: biz.email });
});

function adminMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non authentifié" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.isAdmin) return res.status(403).json({ error: "Accès admin requis" });
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session admin invalide, reconnecte-toi" });
  }
}

// ============ ADMIN (SSALEMDEV) — gestion des comptes clients ============
app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (
    !email || !password ||
    email.toLowerCase() !== ADMIN_EMAIL.toLowerCase() ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({ error: "Identifiants admin incorrects" });
  }
  const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token });
});

app.get("/api/admin/clients", adminMiddleware, async (req, res) => {
  const clients = data.businesses.map((b) => ({
    id: b.id,
    nom_boutique: b.nom_boutique,
    email: b.email,
    created_at: b.created_at,
  }));
  res.json(clients);
});

app.post("/api/admin/clients", adminMiddleware, async (req, res) => {
  const { nomBoutique, email, password } = req.body || {};
  if (!nomBoutique || !email || !password || password.length < 6) {
    return res.status(400).json({ error: "Nom boutique, email et mot de passe (6+ caractères) requis" });
  }
  const emailNorm = email.toLowerCase();
  if (data.businesses.some((b) => b.email === emailNorm)) {
    return res.status(409).json({ error: "Cet email est déjà utilisé par un autre client" });
  }
  const id = uid();
  data.businesses.push({
    id,
    nom_boutique: nomBoutique,
    email: emailNorm,
    password_hash: bcrypt.hashSync(password, 10),
    created_at: new Date().toISOString(),
  });
  await save();
  res.json({ id, nomBoutique, email: emailNorm });
});

app.post("/api/admin/clients/:id/reset-password", adminMiddleware, async (req, res) => {
  const biz = data.businesses.find((b) => b.id === req.params.id);
  if (!biz) return res.status(404).json({ error: "Client introuvable" });
  const { password } = req.body || {};
  if (!password || password.length < 6) {
    return res.status(400).json({ error: "Mot de passe (6+ caractères) requis" });
  }
  biz.password_hash = bcrypt.hashSync(password, 10);
  await save();
  res.json({ ok: true });
});

app.delete("/api/admin/clients/:id", adminMiddleware, async (req, res) => {
  const idx = data.businesses.findIndex((b) => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Client introuvable" });
  const businessId = data.businesses[idx].id;
  data.businesses.splice(idx, 1);
  // Nettoie aussi toutes les données de ce client
  data.costumes = data.costumes.filter((c) => c.business_id !== businessId);
  data.chemises = data.chemises.filter((c) => c.business_id !== businessId);
  data.chaussures = data.chaussures.filter((c) => c.business_id !== businessId);
  data.jabadors = data.jabadors.filter((c) => c.business_id !== businessId);
  data.bernous = data.bernous.filter((c) => c.business_id !== businessId);
  data.accessoires = data.accessoires.filter((a) => a.business_id !== businessId);
  data.montres = data.montres.filter((m) => m.business_id !== businessId);
  data.locations = data.locations.filter((l) => l.business_id !== businessId);
  data.transactions = data.transactions.filter((t) => t.business_id !== businessId);
  await save();
  res.json({ ok: true });
});


// ============ COSTUMES (veste + pantalon, stocks indépendants) ============
// Le client peut prendre une veste taille 46 avec un pantalon taille 48 :
// les deux stocks sont gérés et vérifiés séparément.

// Renvoie tous les usages (location principale + costumes supplémentaires)
// d'un costume donné, pour vérifier les conflits de dates par composant.
function usagesCostume(businessId, costumeId) {
  const usages = [];
  data.locations
    .filter((l) => l.business_id === businessId)
    .forEach((l) => {
      if (l.costume_id === costumeId) {
        usages.push({ tailleVeste: l.taille_veste, taillePantalon: l.taille_pantalon, dateEvenement: l.date_evenement });
      }
      (l.costumes_extra || []).forEach((e) => {
        if (e.costume_id === costumeId) {
          usages.push({ tailleVeste: e.taille_veste, taillePantalon: e.taille_pantalon, dateEvenement: l.date_evenement });
        }
      });
    });
  return usages;
}

// Vérifie la dispo veste+pantalon pour un costume à une date donnée.
// Renvoie null si OK, ou un message d'erreur sinon.
function verifierDispoCostume(businessId, costume, tailleVeste, taillePantalon, dateEvenement) {
  const vesteRow = (costume.stock_veste || []).find((r) => r.taille === tailleVeste);
  if (!vesteRow) return `Taille veste "${tailleVeste}" introuvable pour ce costume`;
  const pantalonRow = (costume.stock_pantalon || []).find((r) => r.taille === taillePantalon);
  if (!pantalonRow) return `Taille pantalon "${taillePantalon}" introuvable pour ce costume`;

  const usages = usagesCostume(businessId, costume.id);
  const vesteConflits = usages.filter((u) => u.tailleVeste === tailleVeste && seChevauchent(u.dateEvenement, dateEvenement)).length;
  if (vesteRow.quantite - vesteConflits <= 0) {
    return `Plus aucune veste taille "${tailleVeste}" disponible à cette date (règle des 2 jours).`;
  }
  const pantalonConflits = usages.filter((u) => u.taillePantalon === taillePantalon && seChevauchent(u.dateEvenement, dateEvenement)).length;
  if (pantalonRow.quantite - pantalonConflits <= 0) {
    return `Plus aucun pantalon taille "${taillePantalon}" disponible à cette date (règle des 2 jours).`;
  }
  return null;
}

app.get("/api/costumes", authMiddleware, async (req, res) => {
  const costumes = data.costumes
    .filter((c) => c.business_id === req.businessId)
    .map((c) => ({ id: c.id, nom: c.nom, stock_veste: c.stock_veste || [], stock_pantalon: c.stock_pantalon || [] }));
  res.json(costumes);
});

app.post("/api/costumes", authMiddleware, async (req, res) => {
  const { nom, stockVeste, stockPantalon } = req.body || {};
  if (!nom || !Array.isArray(stockVeste) || stockVeste.length === 0 || !Array.isArray(stockPantalon) || stockPantalon.length === 0) {
    return res.status(400).json({ error: "Nom, tailles de veste et tailles de pantalon requis" });
  }
  const id = uid();
  const clean = (arr) => arr.map((r) => ({ taille: String(r.taille), quantite: Number(r.quantite) || 0 }));
  data.costumes.push({
    id, business_id: req.businessId, nom,
    stock_veste: clean(stockVeste), stock_pantalon: clean(stockPantalon),
    created_at: new Date().toISOString(),
  });
  await save();
  res.json({ id });
});

app.put("/api/costumes/:id", authMiddleware, async (req, res) => {
  const costume = data.costumes.find((c) => c.id === req.params.id && c.business_id === req.businessId);
  if (!costume) return res.status(404).json({ error: "Costume introuvable" });
  const { nom, stockVeste, stockPantalon } = req.body || {};
  const clean = (arr) => arr.map((r) => ({ taille: String(r.taille), quantite: Number(r.quantite) || 0 }));
  if (nom) costume.nom = nom;
  if (Array.isArray(stockVeste)) costume.stock_veste = clean(stockVeste);
  if (Array.isArray(stockPantalon)) costume.stock_pantalon = clean(stockPantalon);
  await save();
  res.json({ ok: true });
});

app.delete("/api/costumes/:id", authMiddleware, async (req, res) => {
  const idx = data.costumes.findIndex((c) => c.id === req.params.id && c.business_id === req.businessId);
  if (idx === -1) return res.status(404).json({ error: "Costume introuvable" });
  data.costumes.splice(idx, 1);
  await save();
  res.json({ ok: true });
});

// Disponibilité veste OU pantalon pour une date donnée (?component=veste|pantalon)
app.get("/api/costumes/:id/disponibilite", authMiddleware, async (req, res) => {
  const costume = data.costumes.find((c) => c.id === req.params.id && c.business_id === req.businessId);
  if (!costume) return res.status(404).json({ error: "Costume introuvable" });
  const dateEvenement = req.query.date;
  const component = req.query.component === "pantalon" ? "pantalon" : "veste";
  if (!dateEvenement) return res.status(400).json({ error: "Paramètre date requis" });

  const usages = usagesCostume(req.businessId, costume.id);
  const stock = component === "veste" ? (costume.stock_veste || []) : (costume.stock_pantalon || []);
  const result = stock.map((r) => {
    const conflits = usages.filter(
      (u) => (component === "veste" ? u.tailleVeste : u.taillePantalon) === r.taille && seChevauchent(u.dateEvenement, dateEvenement)
    ).length;
    return { taille: r.taille, dispo: Math.max(0, r.quantite - conflits) };
  });
  res.json(result);
});

// ============ FABRIQUE GÉNÉRIQUE : chemises / chaussures / jabadors / bernous ============
// Toutes ces catégories suivent le même principe qu'un costume simple :
// un nom + un stock par "variante" (taille ou couleur selon la catégorie),
// avec la règle des 2 jours pour éviter le double-booking.
function registerStockResource(resourceName, collectionKey, locPrefix, variantLabel) {
  app.get(`/api/${resourceName}`, authMiddleware, async (req, res) => {
    const list = data[collectionKey]
      .filter((c) => c.business_id === req.businessId)
      .map((c) => ({ id: c.id, nom: c.nom, stock: c.stock }));
    res.json(list);
  });

  app.post(`/api/${resourceName}`, authMiddleware, async (req, res) => {
    const { nom, stock } = req.body || {};
    if (!nom || !Array.isArray(stock) || stock.length === 0) {
      return res.status(400).json({ error: `Nom et au moins une ${variantLabel} requis` });
    }
    const id = uid();
    const cleanStock = stock.map((r) => ({ taille: String(r.taille), quantite: Number(r.quantite) || 0 }));
    data[collectionKey].push({ id, business_id: req.businessId, nom, stock: cleanStock, created_at: new Date().toISOString() });
    await save();
    res.json({ id, nom, stock: cleanStock });
  });

  app.put(`/api/${resourceName}/:id`, authMiddleware, async (req, res) => {
    const item = data[collectionKey].find((c) => c.id === req.params.id && c.business_id === req.businessId);
    if (!item) return res.status(404).json({ error: "Introuvable" });
    const { nom, stock } = req.body || {};
    if (nom) item.nom = nom;
    if (Array.isArray(stock)) item.stock = stock.map((r) => ({ taille: String(r.taille), quantite: Number(r.quantite) || 0 }));
    await save();
    res.json({ ok: true });
  });

  app.delete(`/api/${resourceName}/:id`, authMiddleware, async (req, res) => {
    const idx = data[collectionKey].findIndex((c) => c.id === req.params.id && c.business_id === req.businessId);
    if (idx === -1) return res.status(404).json({ error: "Introuvable" });
    data[collectionKey].splice(idx, 1);
    await save();
    res.json({ ok: true });
  });

  app.get(`/api/${resourceName}/:id/disponibilite`, authMiddleware, async (req, res) => {
    const item = data[collectionKey].find((c) => c.id === req.params.id && c.business_id === req.businessId);
    if (!item) return res.status(404).json({ error: "Introuvable" });
    const dateEvenement = req.query.date;
    if (!dateEvenement) return res.status(400).json({ error: "Paramètre date requis" });
    const idField = `${locPrefix}_id`;
    const tailleField = `${locPrefix}_taille`;
    const locs = data.locations.filter((l) => l.business_id === req.businessId && l[idField] === item.id);
    const result = (item.stock || []).map((r) => {
      const conflits = locs.filter((l) => l[tailleField] === r.taille && seChevauchent(l.date_evenement, dateEvenement)).length;
      return { taille: r.taille, dispo: Math.max(0, r.quantite - conflits) };
    });
    res.json(result);
  });
}

registerStockResource("chemises", "chemises", "chemise", "taille");
registerStockResource("chaussures", "chaussures", "chaussure", "taille/pointure");
registerStockResource("jabadors", "jabadors", "jabador", "couleur");
registerStockResource("bernous", "bernous", "bernous", "couleur");

// ============ ACCESSOIRES (cravates / nœuds papillon) — stock simple, sans taille ============
app.get("/api/accessoires", authMiddleware, async (req, res) => {
  const list = data.accessoires
    .filter((a) => a.business_id === req.businessId)
    .map((a) => ({ id: a.id, nom: a.nom, type: a.type, quantite: a.quantite }));
  res.json(list);
});

app.post("/api/accessoires", authMiddleware, async (req, res) => {
  const { nom, type, quantite } = req.body || {};
  if (!nom || !["cravate", "papillon"].includes(type) || !quantite) {
    return res.status(400).json({ error: "Nom, type (cravate/papillon) et quantité requis" });
  }
  const id = uid();
  data.accessoires.push({ id, business_id: req.businessId, nom, type, quantite: Number(quantite), created_at: new Date().toISOString() });
  await save();
  res.json({ id, nom, type, quantite: Number(quantite) });
});

app.put("/api/accessoires/:id", authMiddleware, async (req, res) => {
  const item = data.accessoires.find((a) => a.id === req.params.id && a.business_id === req.businessId);
  if (!item) return res.status(404).json({ error: "Accessoire introuvable" });
  const { nom, type, quantite } = req.body || {};
  if (nom) item.nom = nom;
  if (type) item.type = type;
  if (quantite !== undefined) item.quantite = Number(quantite);
  await save();
  res.json({ ok: true });
});

app.delete("/api/accessoires/:id", authMiddleware, async (req, res) => {
  const idx = data.accessoires.findIndex((a) => a.id === req.params.id && a.business_id === req.businessId);
  if (idx === -1) return res.status(404).json({ error: "Accessoire introuvable" });
  data.accessoires.splice(idx, 1);
  await save();
  res.json({ ok: true });
});

// ============ MONTRES — stock simple, sans taille ============
app.get("/api/montres", authMiddleware, async (req, res) => {
  const list = data.montres
    .filter((m) => m.business_id === req.businessId)
    .map((m) => ({ id: m.id, nom: m.nom, quantite: m.quantite }));
  res.json(list);
});

app.post("/api/montres", authMiddleware, async (req, res) => {
  const { nom, quantite } = req.body || {};
  if (!nom || !quantite) return res.status(400).json({ error: "Nom et quantité requis" });
  const id = uid();
  data.montres.push({ id, business_id: req.businessId, nom, quantite: Number(quantite), created_at: new Date().toISOString() });
  await save();
  res.json({ id, nom, quantite: Number(quantite) });
});

app.put("/api/montres/:id", authMiddleware, async (req, res) => {
  const item = data.montres.find((m) => m.id === req.params.id && m.business_id === req.businessId);
  if (!item) return res.status(404).json({ error: "Montre introuvable" });
  const { nom, quantite } = req.body || {};
  if (nom) item.nom = nom;
  if (quantite !== undefined) item.quantite = Number(quantite);
  await save();
  res.json({ ok: true });
});

app.delete("/api/montres/:id", authMiddleware, async (req, res) => {
  const idx = data.montres.findIndex((m) => m.id === req.params.id && m.business_id === req.businessId);
  if (idx === -1) return res.status(404).json({ error: "Montre introuvable" });
  data.montres.splice(idx, 1);
  await save();
  res.json({ ok: true });
});

// ============ LOCATIONS ============
app.get("/api/locations", authMiddleware, async (req, res) => {
  const rows = data.locations
    .filter((l) => l.business_id === req.businessId)
    .sort((a, b) => new Date(b.date_debut) - new Date(a.date_debut));
  res.json(rows);
});

app.post("/api/locations", authMiddleware, async (req, res) => {
  const {
    costumeId,
    tailleVeste,
    taillePantalon,
    dateEvenement,
    clientNom,
    clientTel,
    montantTotal,
    avance,
    chemiseId,
    chemiseTaille,
    chaussureId,
    chaussureTaille,
    jabadorId,
    jabadorCouleur,
    bernousId,
    bernousCouleur,
    accessoireId,
    montreId,
    costumesExtra, // [{ costumeId, tailleVeste, taillePantalon }, ...] — 2e, 3e costume...
  } = req.body || {};

  if (!costumeId || !tailleVeste || !taillePantalon || !dateEvenement || !clientNom || !montantTotal) {
    return res.status(400).json({ error: "Champs obligatoires manquants" });
  }

  const costume = data.costumes.find((c) => c.id === costumeId && c.business_id === req.businessId);
  if (!costume) return res.status(404).json({ error: "Costume introuvable" });

  const erreurPrincipal = verifierDispoCostume(req.businessId, costume, tailleVeste, taillePantalon, dateEvenement);
  if (erreurPrincipal) return res.status(409).json({ error: erreurPrincipal });

  // Costumes supplémentaires (2e, 3e...) — même vérification veste+pantalon
  const extrasValides = [];
  if (Array.isArray(costumesExtra)) {
    for (const extra of costumesExtra) {
      if (!extra || !extra.costumeId || !extra.tailleVeste || !extra.taillePantalon) continue;
      const extraCostume = data.costumes.find((c) => c.id === extra.costumeId && c.business_id === req.businessId);
      if (!extraCostume) return res.status(404).json({ error: "Un costume supplémentaire est introuvable" });
      const erreurExtra = verifierDispoCostume(req.businessId, extraCostume, extra.tailleVeste, extra.taillePantalon, dateEvenement);
      if (erreurExtra) return res.status(409).json({ error: `Costume supplémentaire (${extraCostume.nom}) : ${erreurExtra}` });
      extrasValides.push({
        costume_id: extraCostume.id,
        costume_nom: extraCostume.nom,
        taille_veste: extra.tailleVeste,
        taille_pantalon: extra.taillePantalon,
      });
    }
  }

  // Chemise optionnelle (même règle des 2 jours que le costume)
  let chemise = null;
  if (chemiseId) {
    chemise = data.chemises.find((c) => c.id === chemiseId && c.business_id === req.businessId);
    if (!chemise) return res.status(404).json({ error: "Chemise introuvable" });
    const row = (chemise.stock || []).find((r) => r.taille === chemiseTaille);
    if (!row) return res.status(400).json({ error: "Taille introuvable pour cette chemise" });
    const existantes = data.locations.filter((l) => l.business_id === req.businessId && l.chemise_id === chemiseId && l.chemise_taille === chemiseTaille);
    const conflits = existantes.filter((l) => seChevauchent(l.date_evenement, dateEvenement)).length;
    if (row.quantite - conflits <= 0) return res.status(409).json({ error: `Plus aucune chemise "${chemiseTaille}" disponible à cette date.` });
  }

  // Chaussures optionnelles (même règle des 2 jours)
  let chaussure = null;
  if (chaussureId) {
    chaussure = data.chaussures.find((c) => c.id === chaussureId && c.business_id === req.businessId);
    if (!chaussure) return res.status(404).json({ error: "Chaussures introuvables" });
    const row = (chaussure.stock || []).find((r) => r.taille === chaussureTaille);
    if (!row) return res.status(400).json({ error: "Pointure introuvable pour ce modèle de chaussures" });
    const existantes = data.locations.filter((l) => l.business_id === req.businessId && l.chaussure_id === chaussureId && l.chaussure_taille === chaussureTaille);
    const conflits = existantes.filter((l) => seChevauchent(l.date_evenement, dateEvenement)).length;
    if (row.quantite - conflits <= 0) return res.status(409).json({ error: `Plus de chaussures pointure "${chaussureTaille}" disponibles à cette date.` });
  }

  // Jabador optionnel, par couleur (même règle des 2 jours)
  let jabador = null;
  if (jabadorId) {
    jabador = data.jabadors.find((c) => c.id === jabadorId && c.business_id === req.businessId);
    if (!jabador) return res.status(404).json({ error: "Jabador introuvable" });
    const row = (jabador.stock || []).find((r) => r.taille === jabadorCouleur);
    if (!row) return res.status(400).json({ error: "Couleur introuvable pour ce jabador" });
    const existantes = data.locations.filter((l) => l.business_id === req.businessId && l.jabador_id === jabadorId && l.jabador_taille === jabadorCouleur);
    const conflits = existantes.filter((l) => seChevauchent(l.date_evenement, dateEvenement)).length;
    if (row.quantite - conflits <= 0) return res.status(409).json({ error: `Plus de jabador couleur "${jabadorCouleur}" disponible à cette date.` });
  }

  // Bernous optionnel, par couleur (même règle des 2 jours)
  let bernous = null;
  if (bernousId) {
    bernous = data.bernous.find((c) => c.id === bernousId && c.business_id === req.businessId);
    if (!bernous) return res.status(404).json({ error: "Bernous introuvable" });
    const row = (bernous.stock || []).find((r) => r.taille === bernousCouleur);
    if (!row) return res.status(400).json({ error: "Couleur introuvable pour ce bernous" });
    const existantes = data.locations.filter((l) => l.business_id === req.businessId && l.bernous_id === bernousId && l.bernous_taille === bernousCouleur);
    const conflits = existantes.filter((l) => seChevauchent(l.date_evenement, dateEvenement)).length;
    if (row.quantite - conflits <= 0) return res.status(409).json({ error: `Plus de bernous couleur "${bernousCouleur}" disponible à cette date.` });
  }

  // Accessoire optionnel (stock simple : occupation actuelle, sans règle de date)
  let accessoire = null;
  if (accessoireId) {
    accessoire = data.accessoires.find((a) => a.id === accessoireId && a.business_id === req.businessId);
    if (!accessoire) return res.status(404).json({ error: "Accessoire introuvable" });
    const occupees = data.locations.filter((l) => l.business_id === req.businessId && l.accessoire_id === accessoireId && l.statut === "en_cours").length;
    if (accessoire.quantite - occupees <= 0) return res.status(409).json({ error: `Plus aucun exemplaire de "${accessoire.nom}" disponible actuellement.` });
  }

  // Montre optionnelle (stock simple : occupation actuelle, sans règle de date)
  let montre = null;
  if (montreId) {
    montre = data.montres.find((m) => m.id === montreId && m.business_id === req.businessId);
    if (!montre) return res.status(404).json({ error: "Montre introuvable" });
    const occupees = data.locations.filter((l) => l.business_id === req.businessId && l.montre_id === montreId && l.statut === "en_cours").length;
    if (montre.quantite - occupees <= 0) return res.status(409).json({ error: `Plus aucun exemplaire de "${montre.nom}" disponible actuellement.` });
  }

  const id = uid();
  const nouvelleLocation = {
    id,
    business_id: req.businessId,
    costume_id: costumeId,
    costume_nom: costume.nom,
    taille_veste: tailleVeste,
    taille_pantalon: taillePantalon,
    client_nom: clientNom,
    client_tel: clientTel || "",
    date_evenement: dateEvenement,
    date_debut: todayISO(),
    date_retour_reelle: null,
    montant_total: Number(montantTotal),
    avance: Number(avance) || 0,
    statut: "en_cours",
    costumes_extra: extrasValides,
    chemise_id: chemise ? chemise.id : null,
    chemise_nom: chemise ? chemise.nom : "",
    chemise_taille: chemise ? chemiseTaille : "",
    chaussure_id: chaussure ? chaussure.id : null,
    chaussure_nom: chaussure ? chaussure.nom : "",
    chaussure_taille: chaussure ? chaussureTaille : "",
    jabador_id: jabador ? jabador.id : null,
    jabador_nom: jabador ? jabador.nom : "",
    jabador_taille: jabador ? jabadorCouleur : "",
    bernous_id: bernous ? bernous.id : null,
    bernous_nom: bernous ? bernous.nom : "",
    bernous_taille: bernous ? bernousCouleur : "",
    accessoire_id: accessoire ? accessoire.id : null,
    accessoire_nom: accessoire ? `${accessoire.nom} (${accessoire.type})` : "",
    montre_id: montre ? montre.id : null,
    montre_nom: montre ? montre.nom : "",
  };
  data.locations.push(nouvelleLocation);

  if (nouvelleLocation.avance > 0) {
    data.transactions.push({
      id: uid(),
      business_id: req.businessId,
      type: "revenu",
      montant: nouvelleLocation.avance,
      description: `Avance - ${clientNom} (${costume.nom})`,
      date: todayISO(),
      location_id: id,
      created_at: new Date().toISOString(),
    });
  }
  await save();

  res.json({ id });
});

app.post("/api/locations/:id/cloturer", authMiddleware, async (req, res) => {
  const loc = data.locations.find((l) => l.id === req.params.id && l.business_id === req.businessId);
  if (!loc) return res.status(404).json({ error: "Location introuvable" });

  const montantRestant = Number((req.body || {}).montantRestant) || 0;
  loc.statut = "termine";
  loc.date_retour_reelle = todayISO();

  if (montantRestant > 0) {
    data.transactions.push({
      id: uid(),
      business_id: req.businessId,
      type: "revenu",
      montant: montantRestant,
      description: `Solde - ${loc.client_nom} (${loc.costume_nom})`,
      date: todayISO(),
      location_id: loc.id,
      created_at: new Date().toISOString(),
    });
  }
  await save();

  res.json({ ok: true });
});

// ============ TRANSACTIONS (historique immuable, pas de suppression) ============
app.get("/api/transactions", authMiddleware, async (req, res) => {
  const rows = data.transactions
    .filter((t) => t.business_id === req.businessId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(rows);
});

app.post("/api/transactions", authMiddleware, async (req, res) => {
  const { type, montant, description } = req.body || {};
  if (!["revenu", "depense"].includes(type) || !montant || !description) {
    return res.status(400).json({ error: "type, montant et description requis" });
  }
  const id = uid();
  data.transactions.push({
    id,
    business_id: req.businessId,
    type,
    montant: Number(montant),
    description,
    date: todayISO(),
    location_id: null,
    created_at: new Date().toISOString(),
  });
  await save();
  res.json({ id });
});

// Toute autre route sert la page principale (SPA)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// En local (npm start) ou sur un hébergeur classique (Render, Railway...),
// on démarre un vrai serveur qui écoute en continu.
// Sur Vercel, ce fichier est importé comme un module par api/index.js —
// il ne faut alors PAS appeler app.listen() (Vercel gère ça lui-même).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`PIGOS webapp démarrée sur le port ${PORT}`);
  });
}

module.exports = app;
