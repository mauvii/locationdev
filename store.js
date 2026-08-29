// Stockage hybride :
// - Si les variables KV_REST_API_URL / KV_REST_API_TOKEN sont présentes
//   (ajoutées automatiquement par Vercel quand on connecte "Vercel KV"),
//   les données sont lues/écrites dans Vercel KV — ce qui fonctionne sur
//   l'hébergement "serverless" de Vercel (pas de disque persistant possible).
// - Sinon (en local, ou sur Render/Railway), les données sont lues/écrites
//   dans un simple fichier JSON, comme avant.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "pigos-data.json");
const KV_KEY = "pigos-data";

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_KV = !!(KV_URL && KV_TOKEN);

function emptyData() {
  return {
    businesses: [], costumes: [], chemises: [], chaussures: [],
    jabadors: [], bernous: [], accessoires: [], montres: [],
    locations: [], transactions: [],
  };
}

// Objet partagé : on ne le réassigne jamais (data = ...), on modifie ses
// propriétés en place, pour que toutes les routes qui l'ont importé une
// seule fois (const { data } = require("./store")) voient toujours la
// version à jour, y compris après un rechargement depuis Vercel KV.
const data = emptyData();

function applyInto(target, fresh) {
  Object.keys(emptyData()).forEach((key) => {
    target[key] = (fresh && fresh[key]) || [];
  });
}

let redisClient = null;
function getRedis() {
  if (!redisClient) {
    const { Redis } = require("@upstash/redis");
    redisClient = new Redis({ url: KV_URL, token: KV_TOKEN });
  }
  return redisClient;
}

async function loadFromFile() {
  try {
    if (!fs.existsSync(DB_PATH)) return emptyData();
    const raw = fs.readFileSync(DB_PATH, "utf8");
    return { ...emptyData(), ...JSON.parse(raw) };
  } catch (e) {
    console.error("Erreur de lecture de la base locale, démarrage à vide :", e.message);
    return emptyData();
  }
}

function saveToFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

// Recharge les données fraîches (depuis Vercel KV en prod, depuis le
// fichier en local) dans l'objet partagé `data`, AVANT chaque requête —
// indispensable en serverless car chaque requête peut être traitée par
// une instance différente, sans mémoire partagée entre elles.
async function reload() {
  if (USE_KV) {
    const redis = getRedis();
    const fresh = await redis.get(KV_KEY);
    applyInto(data, fresh);
  } else {
    const fresh = await loadFromFile();
    applyInto(data, fresh);
  }
}

// Sauvegarde l'état actuel de `data`.
async function save() {
  if (USE_KV) {
    const redis = getRedis();
    await redis.set(KV_KEY, data);
  } else {
    saveToFile();
  }
}

module.exports = { data, save, reload, USE_KV };
