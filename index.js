// Vercel détecte automatiquement les fichiers dans /api comme des
// fonctions serverless. Celui-ci réutilise directement l'application
// Express définie dans server.js — aucune route n'est dupliquée.
module.exports = require("../server");
