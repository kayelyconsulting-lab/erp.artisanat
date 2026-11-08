// Point d'entrée pour Phusion Passenger (cPanel « Setup Node.js App », ex. LWS).
// Dans cPanel, indiquez « app.cjs » comme fichier de démarrage (Application startup file).
import("./serveur/server.mjs")
  .then(m => m.startServer())
  .catch(err => { console.error(err); process.exit(1); });
