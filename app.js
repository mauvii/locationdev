// ============ ETAT GLOBAL ============
const state = {
  token: localStorage.getItem("pigos_token") || null,
  nomBoutique: localStorage.getItem("pigos_nom") || "",
  tab: "dashboard",
  costumes: [],
  chemises: [],
  chaussures: [],
  jabadors: [],
  bernous: [],
  accessoires: [],
  montres: [],
  locations: [],
  transactions: [],
  loading: false,
  error: "",
  modal: null,
};

const TAILLES_COSTUME = ["42","44","46","48","50","52","54","56","58","60","62","64","66"];
const TAILLES_CHEMISE = ["XS","S","M","L","XL","2XL","3XL"];
const TAILLES_CHAUSSURE = ["39","40","41","42","43","44","45","46"];

// Catégories génériques (nom + stock par taille/couleur, règle des 2 jours)
const STOCK_RESOURCES = {
  chemise: { plural: "chemises", label: "Chemise", variantLabel: "taille", standard: TAILLES_CHEMISE, icon: "👕" },
  chaussure: { plural: "chaussures", label: "Chaussures", variantLabel: "pointure", standard: TAILLES_CHAUSSURE, icon: "👞" },
  jabador: { plural: "jabadors", label: "Jabador", variantLabel: "couleur", standard: null, icon: "🧥" },
  bernous: { plural: "bernous", label: "Bernous", variantLabel: "couleur", standard: null, icon: "🧣" },
};
function stateArrayFor(resource) {
  return { chemise: state.chemises, chaussure: state.chaussures, jabador: state.jabadors, bernous: state.bernous }[resource];
}

// ============ API ============
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers["Authorization"] = "Bearer " + state.token;
  const res = await fetch("/api" + path, { ...opts, headers: { ...headers, ...(opts.headers||{}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erreur serveur");
  return data;
}

function formatDA(n) {
  return (Number(n) || 0).toLocaleString("fr-FR") + " DA";
}
function todayISO() { return new Date().toISOString().slice(0,10); }
function diffJours(a,b){ return Math.round(Math.abs(new Date(a) - new Date(b)) / 86400000); }
function seChevauchent(a,b){ return diffJours(a,b) <= 2; }
function decale(dateStr, jours) {
  if (!dateStr) return "";
  const d = new Date(dateStr); d.setDate(d.getDate()+jours);
  return d.toISOString().slice(0,10);
}
function joursEcart(dateStr){ return diffJours(dateStr, todayISO()); }
function diffSignee(dateFrom, dateTo) {
  return Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000);
}
function formatJourFr(dateStr) {
  const e = joursEcart(dateStr);
  if (e === 0) return "Aujourd'hui";
  if (e === 1) return "Hier";
  return new Date(dateStr).toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
}

// ============ CHARGEMENT DES DONNEES ============
async function loadAll() {
  state.loading = true; render();
  try {
    const [costumes, chemises, chaussures, jabadors, bernous, accessoires, montres, locations, transactions] = await Promise.all([
      api("/costumes"), api("/chemises"), api("/chaussures"), api("/jabadors"), api("/bernous"),
      api("/accessoires"), api("/montres"), api("/locations"), api("/transactions"),
    ]);
    state.costumes = costumes;
    state.chemises = chemises;
    state.chaussures = chaussures;
    state.jabadors = jabadors;
    state.bernous = bernous;
    state.accessoires = accessoires;
    state.montres = montres;
    state.locations = locations;
    state.transactions = transactions;
  } catch (e) {
    state.error = e.message;
  }
  state.loading = false; render();
}

// ============ AUTH ============
async function submitAuth(formEl) {
  const fd = new FormData(formEl);
  const body = { email: fd.get("email"), password: fd.get("password") };
  try {
    const data = await api("/auth/login", { method: "POST", body: JSON.stringify(body) });
    state.token = data.token; state.nomBoutique = data.nomBoutique;
    localStorage.setItem("pigos_token", data.token);
    localStorage.setItem("pigos_nom", data.nomBoutique);
    state.error = "";
    await loadAll();
  } catch (e) {
    state.error = e.message; render();
  }
}
function logout() {
  state.token = null; state.nomBoutique = "";
  localStorage.removeItem("pigos_token"); localStorage.removeItem("pigos_nom");
  render();
}

// ============ DERIVED ============
function caisse() {
  return state.transactions.reduce((s,t)=> s + (t.type==="revenu"? t.montant : -t.montant), 0);
}
function enCours() { return state.locations.filter(l => l.statut === "en_cours"); }

// Costumes : veste et pantalon comptés séparément, en tenant compte des
// costumes supplémentaires (2e, 3e...) présents dans chaque location.
function occupeesVeste(costumeId, taille) {
  let count = 0;
  enCours().forEach(l => {
    if (l.costume_id === costumeId && l.taille_veste === taille) count++;
    (l.costumes_extra || []).forEach(e => { if (e.costume_id === costumeId && e.taille_veste === taille) count++; });
  });
  return count;
}
function occupeesPantalon(costumeId, taille) {
  let count = 0;
  enCours().forEach(l => {
    if (l.costume_id === costumeId && l.taille_pantalon === taille) count++;
    (l.costumes_extra || []).forEach(e => { if (e.costume_id === costumeId && e.taille_pantalon === taille) count++; });
  });
  return count;
}
function usagesCostumeClient(costumeId) {
  const usages = [];
  state.locations.forEach(l => {
    if (l.costume_id === costumeId) usages.push({ tailleVeste: l.taille_veste, taillePantalon: l.taille_pantalon, dateEvenement: l.date_evenement });
    (l.costumes_extra || []).forEach(e => {
      if (e.costume_id === costumeId) usages.push({ tailleVeste: e.taille_veste, taillePantalon: e.taille_pantalon, dateEvenement: l.date_evenement });
    });
  });
  return usages;
}
function dispoVestePourDate(costumeId, taille, quantite, dateEvenement) {
  const conflits = usagesCostumeClient(costumeId).filter(u => u.tailleVeste === taille && seChevauchent(u.dateEvenement, dateEvenement)).length;
  return Math.max(0, (Number(quantite)||0) - conflits);
}
function dispoPantalonPourDate(costumeId, taille, quantite, dateEvenement) {
  const conflits = usagesCostumeClient(costumeId).filter(u => u.taillePantalon === taille && seChevauchent(u.dateEvenement, dateEvenement)).length;
  return Math.max(0, (Number(quantite)||0) - conflits);
}
function totalStockDispo() {
  let stock=0, dispo=0;
  state.costumes.forEach(c => (c.stock_veste||[]).forEach(r => {
    stock += Number(r.quantite)||0;
    dispo += Math.max(0, (Number(r.quantite)||0) - occupeesVeste(c.id, r.taille));
  }));
  return { stock, dispo };
}

// Chemises / chaussures / jabador / bernous : même principe générique.
function occupeesGenericTaille(resource, itemId, taille) {
  const idField = `${resource}_id`, tailleField = `${resource}_taille`;
  return enCours().filter(l => l[idField]===itemId && l[tailleField]===taille).length;
}
function dispoGenericTaillePourDate(resource, itemId, taille, quantite, dateEvenement) {
  const idField = `${resource}_id`, tailleField = `${resource}_taille`;
  const conflits = state.locations.filter(l => l[idField]===itemId && l[tailleField]===taille && l.date_evenement && seChevauchent(l.date_evenement, dateEvenement)).length;
  return Math.max(0, (Number(quantite)||0) - conflits);
}
// Accessoires / montres : stock simple basé sur l'occupation actuelle (pas de règle de date)
function occupeesAccessoire(accessoireId) {
  return enCours().filter(l => l.accessoire_id===accessoireId).length;
}
function occupeesMontre(montreId) {
  return enCours().filter(l => l.montre_id===montreId).length;
}

// ============ ACTIONS ============
async function createCostume(nom, stockVeste, stockPantalon) {
  await api("/costumes", { method:"POST", body: JSON.stringify({ nom, stockVeste, stockPantalon }) });
  await loadAll();
}
async function updateCostume(id, nom, stockVeste, stockPantalon) {
  await api("/costumes/" + id, { method:"PUT", body: JSON.stringify({ nom, stockVeste, stockPantalon }) });
  await loadAll();
}
async function deleteCostumeApi(id) {
  await api("/costumes/" + id, { method:"DELETE" });
  await loadAll();
}
async function createGeneric(resource, nom, stock) {
  await api(`/${STOCK_RESOURCES[resource].plural}`, { method:"POST", body: JSON.stringify({ nom, stock }) });
  await loadAll();
}
async function updateGeneric(resource, id, nom, stock) {
  await api(`/${STOCK_RESOURCES[resource].plural}/${id}`, { method:"PUT", body: JSON.stringify({ nom, stock }) });
  await loadAll();
}
async function deleteGenericApi(resource, id) {
  await api(`/${STOCK_RESOURCES[resource].plural}/${id}`, { method:"DELETE" });
  await loadAll();
}
async function createAccessoire(nom, type, quantite) {
  await api("/accessoires", { method:"POST", body: JSON.stringify({ nom, type, quantite }) });
  await loadAll();
}
async function updateAccessoire(id, nom, type, quantite) {
  await api("/accessoires/" + id, { method:"PUT", body: JSON.stringify({ nom, type, quantite }) });
  await loadAll();
}
async function deleteAccessoireApi(id) {
  await api("/accessoires/" + id, { method:"DELETE" });
  await loadAll();
}
async function createMontre(nom, quantite) {
  await api("/montres", { method:"POST", body: JSON.stringify({ nom, quantite }) });
  await loadAll();
}
async function updateMontre(id, nom, quantite) {
  await api("/montres/" + id, { method:"PUT", body: JSON.stringify({ nom, quantite }) });
  await loadAll();
}
async function deleteMontreApi(id) {
  await api("/montres/" + id, { method:"DELETE" });
  await loadAll();
}
async function createLocationApi(payload) {
  await api("/locations", { method:"POST", body: JSON.stringify(payload) });
  await loadAll();
}
async function cloturerApi(id, montantRestant) {
  await api("/locations/" + id + "/cloturer", { method:"POST", body: JSON.stringify({ montantRestant }) });
  await loadAll();
}
async function addTransactionApi(payload) {
  await api("/transactions", { method:"POST", body: JSON.stringify(payload) });
  await loadAll();
}

// ============ RENDER ROOT ============
const isAdminRoute = window.location.pathname.startsWith("/admin");

function render() {
  const root = document.getElementById("app");
  if (isAdminRoute) { renderAdminRoot(root); return; }
  if (!state.token) { root.innerHTML = renderAuth(); attachAuthEvents(); return; }

  // Conserve la position de défilement de la fenêtre modale (si ouverte)
  // pour éviter qu'un changement de champ (select, etc.) ne remonte tout en haut.
  const prevModalEl = document.querySelector(".modal");
  const prevScroll = prevModalEl ? prevModalEl.scrollTop : 0;

  root.innerHTML = `
    ${renderHeader()}
    <div class="main">${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ""}${renderTab()}</div>
    ${renderBottomNav()}
    ${state.modal ? renderModal() : ""}
  `;
  attachEvents();

  if (state.modal) {
    const modalEl = document.querySelector(".modal");
    if (modalEl) modalEl.scrollTop = prevScroll;
  }
}

function escapeHtml(s){ const d=document.createElement("div"); d.textContent=s??""; return d.innerHTML; }

// ============ AUTH VIEW (client) ============
function renderAuth() {
  return `
  <div class="auth-wrap"><div class="auth-box">
    <div class="auth-logo"><h1>SSALEMDEV</h1><p>Logiciel de location de costume à distance</p><div class="tape-rule"></div></div>
    ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ""}
    <form id="authForm">
      <div class="field"><label>Email</label><input name="email" type="email" required placeholder="toi@exemple.com" /></div>
      <div class="field"><label>Mot de passe</label><input name="password" type="password" required minlength="6" placeholder="6 caractères minimum" /></div>
      <button type="submit" class="btn-primary">Se connecter</button>
    </form>
    <p style="font-size:11px;color:var(--taupe-dim);text-align:center;margin-top:18px;">
      Pas encore de compte ? Contacte SSALEMDEV pour souscrire.
    </p>
  </div></div>`;
}
function attachAuthEvents() {
  const form = document.getElementById("authForm");
  if (form) form.onsubmit = (e) => { e.preventDefault(); submitAuth(form); };
}

// ============ HEADER / NAV ============
function renderHeader() {
  const c = caisse();
  return `
  <div class="header">
    <div class="head-row">
      <div><h1>SSALEMDEV</h1><p>${escapeHtml(state.nomBoutique)}</p></div>
      <div class="top-right">
        <div><div class="caisse-label">Caisse</div><div class="caisse-val ${c>=0?'pos':'neg'}">${formatDA(c)}</div></div>
        <button class="logout-btn" id="logoutBtn">Quitter</button>
      </div>
    </div>
    <div class="tape-rule"></div>
  </div>`;
}
function renderBottomNav() {
  const items = [["dashboard","🏠","Accueil"],["costumes","👔","Costumes"],["locations","📅","Locations"],["argent","💰","Argent"]];
  return `<div class="tape-rule"></div><div class="bottomnav">${items.map(([id,icon,label]) => `
    <button class="${state.tab===id?'active':''}" data-tab="${id}"><span class="icon">${icon}</span>${label}</button>
  `).join("")}</div>`;
}

function attachEvents() {
  const lo = document.getElementById("logoutBtn"); if (lo) lo.onclick = logout;
  document.querySelectorAll("[data-tab]").forEach(el => el.onclick = () => { state.tab = el.dataset.tab; state.modal=null; render(); });
  document.querySelectorAll("[data-open-modal]").forEach(el => el.onclick = () => { openModal(el.dataset.openModal, el.dataset.id||null); });
  document.querySelectorAll("[data-close-modal]").forEach(el => el.onclick = () => { state.modal=null; render(); });
  document.querySelectorAll("[data-filter]").forEach(el => el.onclick = () => { window.__filter = el.dataset.filter; render(); });
  document.querySelectorAll("[data-period]").forEach(el => el.onclick = () => { window.__period = el.dataset.period; render(); });
  document.querySelectorAll("[data-inv-subtab]").forEach(el => el.onclick = () => { window.__invSubTab = el.dataset.invSubtab; render(); });
  document.querySelectorAll("[data-delete-costume]").forEach(el => el.onclick = async () => {
    if (confirm("Supprimer ce costume ?")) { await deleteCostumeApi(el.dataset.deleteCostume); }
  });
  document.querySelectorAll("[data-delete-generic]").forEach(el => el.onclick = async () => {
    const [resource, id] = el.dataset.deleteGeneric.split(":");
    if (confirm("Supprimer cet élément ?")) { await deleteGenericApi(resource, id); }
  });
  document.querySelectorAll("[data-delete-accessoire]").forEach(el => el.onclick = async () => {
    if (confirm("Supprimer cet accessoire ?")) { await deleteAccessoireApi(el.dataset.deleteAccessoire); }
  });
  document.querySelectorAll("[data-delete-montre]").forEach(el => el.onclick = async () => {
    if (confirm("Supprimer cette montre ?")) { await deleteMontreApi(el.dataset.deleteMontre); }
  });
  document.querySelectorAll("[data-close-location]").forEach(el => el.onclick = () => openModal("cloture", el.dataset.closeLocation));

  const costumeForm = document.getElementById("costumeForm"); if (costumeForm) attachCostumeFormEvents(costumeForm);
  const genericForm = document.getElementById("genericForm"); if (genericForm) attachGenericFormEvents(genericForm);
  const accessoireForm = document.getElementById("accessoireForm"); if (accessoireForm) attachAccessoireFormEvents(accessoireForm);
  const montreForm = document.getElementById("montreForm"); if (montreForm) attachMontreFormEvents(montreForm);
  const locationForm = document.getElementById("locationForm"); if (locationForm) attachLocationFormEvents(locationForm);
  const txForm = document.getElementById("txForm"); if (txForm) attachTxFormEvents(txForm);
  const clotureForm = document.getElementById("clotureForm"); if (clotureForm) attachClotureFormEvents(clotureForm);
  if (state.modal && state.modal.type === "calendrier") attachCalendrierEvents();
}

function openModal(type, id) {
  if (type === "costume") {
    const data = id ? state.costumes.find(c=>c.id===id) : null;
    state.modal = { type: "costume", data, stockVeste: data ? data.stock_veste.map(r=>({...r})) : [], stockPantalon: data ? data.stock_pantalon.map(r=>({...r})) : [] };
  } else if (["chemise","chaussure","jabador","bernous"].includes(type)) {
    const arr = stateArrayFor(type);
    const data = id ? arr.find(x=>x.id===id) : null;
    state.modal = { type, data, stock: data ? data.stock.map(r=>({...r})) : [] };
  } else if (type === "accessoire") {
    const data = id ? state.accessoires.find(a=>a.id===id) : null;
    state.modal = { type: "accessoire", data };
  } else if (type === "montre") {
    const data = id ? state.montres.find(m=>m.id===id) : null;
    state.modal = { type: "montre", data };
  } else if (type === "location") {
    state.modal = {
      type: "location", costumeId: state.costumes[0]?.id || "", dateEvenement: "", tailleVeste: "", taillePantalon: "",
      chemiseId: "", chaussureId: "", jabadorId: "", bernousId: "", extras: [],
    };
  } else if (type === "transaction") {
    state.modal = { type: "transaction", txType: "depense" };
  } else if (type === "cloture") {
    const loc = state.locations.find(l=>l.id===id);
    state.modal = { type: "cloture", loc };
  } else if (type === "calendrier") {
    const c = state.costumes.find(c=>c.id===id);
    const now = new Date();
    state.modal = { type: "calendrier", costumeId: id, component: "veste", taille: (c?.stock_veste||[])[0]?.taille || "", year: now.getFullYear(), month: now.getMonth() };
  }
  render();
}

// ============ TAB DISPATCH ============
function renderTab() {
  if (state.tab === "dashboard") return renderDashboard();
  if (state.tab === "costumes") return renderCostumes();
  if (state.tab === "locations") return renderLocations();
  if (state.tab === "argent") return renderArgent();
  return "";
}

// ============ DASHBOARD ============
function renderDashboard() {
  const { stock, dispo } = totalStockDispo();
  const ec = enCours();
  const recent = state.transactions.slice(0,5);

  const rappels = ec
    .map(l => ({ ...l, joursRestants: diffSignee(todayISO(), l.date_evenement) }))
    .filter(l => l.joursRestants <= 2)
    .sort((a,b) => a.joursRestants - b.joursRestants);

  return `
  <div class="stat-grid">
    <div class="stat-card"><div>👔</div><div class="val">${dispo}/${stock}</div><div class="lbl">Vestes disponibles</div></div>
    <div class="stat-card"><div>⏰</div><div class="val">${ec.length}</div><div class="lbl">Locations en cours</div></div>
  </div>
  <div class="card">
    <div style="font-size:11px;color:var(--taupe);text-transform:uppercase;">Solde caisse</div>
    <div style="font-size:28px;font-weight:800;" class="${caisse()>=0?'pos':'neg'}">${formatDA(caisse())}</div>
  </div>
  ${rappels.length ? `<h3 style="font-size:12px;color:var(--taupe);text-transform:uppercase;margin:14px 0 8px;">🔔 Retours à prévoir</h3>` +
    rappels.map(l => renderRappelRow(l)).join("") : ""}
  ${ec.length===0 ? "" : (ec.length > rappels.length ? `<h3 style="font-size:12px;color:var(--taupe);text-transform:uppercase;margin:14px 0 8px;">Autres locations en cours</h3>` +
    ec.filter(l=>!rappels.some(r=>r.id===l.id)).slice(0,4).map(l => `
    <div class="item"><div style="display:flex;justify-content:space-between;align-items:center;">
      <div><div class="title">${escapeHtml(l.client_nom)}</div><div class="sub">${escapeHtml(l.costume_nom)} — veste ${escapeHtml(l.taille_veste||"")} / pantalon ${escapeHtml(l.taille_pantalon||"")}</div></div>
      <div style="font-size:11px;color:var(--brass-bright);">${l.date_evenement}</div>
    </div></div>`).join("") : "")}
  <h3 style="font-size:12px;color:var(--taupe);text-transform:uppercase;margin:14px 0 8px;">Dernières transactions</h3>
  ${recent.length===0 ? `<div class="empty">Aucune transaction</div>` : recent.map(renderTxRow).join("")}
  `;
}
function renderRappelRow(l) {
  const j = l.joursRestants;
  let label, cls;
  if (j < 0) { label = `En retard de ${Math.abs(j)} jour${Math.abs(j)>1?'s':''}`; cls = "badge-rose"; }
  else if (j === 0) { label = "Aujourd'hui"; cls = "badge-amber"; }
  else if (j === 1) { label = "Demain"; cls = "badge-amber"; }
  else { label = `Dans ${j} jours`; cls = "badge-amber"; }
  return `
  <div class="item" style="border-color:${j<0?'#4A2A1A':'#4A3B1C'};">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div><div class="title">${escapeHtml(l.client_nom)}</div><div class="sub">${escapeHtml(l.costume_nom)} — veste ${escapeHtml(l.taille_veste||"")} / pantalon ${escapeHtml(l.taille_pantalon||"")}</div></div>
      <span class="badge ${cls}" style="margin:0;">${label}</span>
    </div>
    <div class="sub" style="margin-top:4px;">📅 Événement le ${l.date_evenement}</div>
  </div>`;
}

// ============ COSTUMES / CHEMISES / CHAUSSURES / JABADOR / BERNOUS / ACCESSOIRES / MONTRES ============
function renderCostumes() {
  const sub = window.__invSubTab || "costumes";
  const tabs = [
    ["costumes","👔 Costumes"],
    ["chemise","👕 Chemises"],
    ["chaussure","👞 Chaussures"],
    ["jabador","🧥 Jabador"],
    ["bernous","🧣 Bernous"],
    ["accessoires","🎀 Accessoires"],
    ["montres","⌚ Montres"],
  ];
  return `
  <div class="chips" style="margin-bottom:12px;">
    ${tabs.map(([id,label]) => `<div class="chip ${sub===id?'active':''}" data-inv-subtab="${id}">${label}</div>`).join("")}
  </div>
  ${sub==="costumes" ? renderCostumesList()
    : sub==="accessoires" ? renderAccessoiresList()
    : sub==="montres" ? renderMontresList()
    : renderGenericList(sub)}
  `;
}

function renderCostumesList() {
  const q = (window.__costQuery || "").toLowerCase();
  const list = state.costumes.filter(c => c.nom.toLowerCase().includes(q));
  return `
  <div class="searchbar">
    <input id="costumeSearch" placeholder="Rechercher un costume..." value="${escapeHtml(window.__costQuery||"")}" />
    <button class="btn-add" data-open-modal="costume">+</button>
  </div>
  <p style="font-size:11px;color:var(--taupe-dim);margin:0 0 10px;">Veste et pantalon ont des stocks séparés : le client peut prendre une veste 46 avec un pantalon 48.</p>
  ${list.length===0 ? `<div class="empty">${state.costumes.length===0?"Aucun costume enregistré":"Aucun résultat"}</div>` :
    list.map(renderCostumeCard).join("")}
  `;
}
function renderCostumeCard(c) {
  const sv = c.stock_veste || [], sp = c.stock_pantalon || [];
  const totalQteV = sv.reduce((s,r)=>s+(Number(r.quantite)||0),0);
  const totalDispoV = sv.reduce((s,r)=>s+Math.max(0,(Number(r.quantite)||0)-occupeesVeste(c.id,r.taille)),0);
  const totalQteP = sp.reduce((s,r)=>s+(Number(r.quantite)||0),0);
  const totalDispoP = sp.reduce((s,r)=>s+Math.max(0,(Number(r.quantite)||0)-occupeesPantalon(c.id,r.taille)),0);
  function badges(arr, occFn) {
    return arr.map(r=>{
      const dispo = Math.max(0,(Number(r.quantite)||0)-occFn(c.id,r.taille));
      const cls = dispo===0?'badge-rose':(dispo<Number(r.quantite)?'badge-amber':'badge-green');
      return `<span class="badge ${cls}">${escapeHtml(r.taille)}: ${dispo}/${r.quantite}</span>`;
    }).join("");
  }
  return `
  <div class="item">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div><div class="title">${escapeHtml(c.nom)}</div><div class="sub">Veste ${totalDispoV}/${totalQteV} — Pantalon ${totalDispoP}/${totalQteP}</div></div>
      <button class="btn-danger-outline" data-delete-costume="${c.id}">🗑</button>
    </div>
    <div style="font-size:11px;color:var(--taupe);margin-top:6px;">Veste</div>
    <div>${badges(sv, occupeesVeste)}</div>
    <div style="font-size:11px;color:var(--taupe);margin-top:6px;">Pantalon</div>
    <div>${badges(sp, occupeesPantalon)}</div>
    <button class="btn-outline" style="margin-top:8px;" data-open-modal="costume" data-id="${c.id}">✎ Modifier</button>
    <button class="btn-outline" style="margin-top:8px;margin-left:8px;" data-open-modal="calendrier" data-id="${c.id}">📅 Calendrier</button>
  </div>`;
}

// ----- Catégories génériques : chemise / chaussure / jabador / bernous -----
function renderGenericList(resource) {
  const cfg = STOCK_RESOURCES[resource];
  const list = stateArrayFor(resource);
  return `
  <div class="searchbar">
    <div style="flex:1;font-size:12px;color:var(--taupe-dim);display:flex;align-items:center;">${cfg.label} — stock par ${cfg.variantLabel}.</div>
    <button class="btn-add" data-open-modal="${resource}">+</button>
  </div>
  ${list.length===0 ? `<div class="empty">Aucun élément enregistré dans cette catégorie</div>` : list.map(item=>renderGenericCard(resource,item)).join("")}
  `;
}
function renderGenericCard(resource, item) {
  const stock = item.stock || [];
  const totalQte = stock.reduce((s,r)=>s+(Number(r.quantite)||0),0);
  const totalDispo = stock.reduce((s,r)=>s+Math.max(0,(Number(r.quantite)||0)-occupeesGenericTaille(resource,item.id,r.taille)),0);
  return `
  <div class="item">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div><div class="title">${escapeHtml(item.nom)}</div><div class="sub">${totalDispo}/${totalQte} exemplaire(s) disponible(s)</div></div>
      <button class="btn-danger-outline" data-delete-generic="${resource}:${item.id}">🗑</button>
    </div>
    <div>${stock.map(r=>{
      const dispo = Math.max(0,(Number(r.quantite)||0)-occupeesGenericTaille(resource,item.id,r.taille));
      const cls = dispo===0?'badge-rose':(dispo<Number(r.quantite)?'badge-amber':'badge-green');
      return `<span class="badge ${cls}">${escapeHtml(r.taille)}: ${dispo}/${r.quantite}</span>`;
    }).join("")}</div>
    <button class="btn-outline" style="margin-top:8px;" data-open-modal="${resource}" data-id="${item.id}">✎ Modifier</button>
  </div>`;
}
function renderGenericModal(resource, m) {
  const cfg = STOCK_RESOURCES[resource];
  const editing = !!m.data;
  const stock = m.stock;
  const hasStandard = !!cfg.standard;
  return modalWrap(editing ? `Modifier — ${cfg.label}` : `Nouveau — ${cfg.label}`, `
    <form id="genericForm" data-resource="${resource}">
      <div class="field"><label>Nom / modèle *</label><input name="nom" id="genericNom" required value="${escapeHtml(m.nom !== undefined ? m.nom : (m.data?.nom||""))}" placeholder="Ex: ${cfg.label}" /></div>
      ${hasStandard ? `
      <div class="field"><label>${cfg.variantLabel==='pointure'?'Pointures':'Tailles'} disponibles</label>
        <div class="chips" style="margin-bottom:0;">
          ${cfg.standard.map(t => `<div class="taille-btn ${stock.some(r=>r.taille===t)?'active':''}" data-toggle-generic="${t}">${t}</div>`).join("")}
        </div>
      </div>` : `<p class="field-hint">Ajoute une ligne par couleur disponible (ex: Noir, Blanc, Bordeaux...).</p>`}
      ${stock.length ? `<label style="font-size:12px;color:var(--taupe);">Quantité par ${cfg.variantLabel}</label>` : ""}
      <div>${stock.map((r,i)=>`
        <div class="taille-row">
          ${hasStandard && cfg.standard.includes(r.taille) ? `<span class="tsz">${escapeHtml(r.taille)}</span>` : `<input class="tsz" data-custom-generic="${i}" value="${escapeHtml(r.taille)}" placeholder="${cfg.variantLabel==='couleur'?'Couleur':'Taille'}" />`}
          <input type="number" min="1" data-qte-generic="${i}" value="${r.quantite}" placeholder="Quantité" />
          <button type="button" data-remove-generic="${i}">✕</button>
        </div>`).join("")}</div>
      <button type="button" class="btn-secondary" id="addCustomGeneric">+ Ajouter ${cfg.variantLabel==='couleur'?'une couleur':'une taille personnalisée'}</button>
      <button type="submit" class="btn-primary">${editing?'Enregistrer':'Ajouter'}</button>
    </form>
  `);
}
function attachGenericFormEvents(form) {
  const resource = form.dataset.resource;
  const m = state.modal;
  const nomInput = document.getElementById("genericNom");
  if (nomInput) nomInput.oninput = (e) => { m.nom = e.target.value; };
  document.querySelectorAll("[data-toggle-generic]").forEach(el => el.onclick = () => {
    const t = el.dataset.toggleGeneric;
    const idx = m.stock.findIndex(r=>r.taille===t);
    if (idx>=0) m.stock.splice(idx,1); else m.stock.push({ taille: t, quantite: 1 });
    render();
  });
  const addBtn = document.getElementById("addCustomGeneric");
  if (addBtn) addBtn.onclick = () => { m.stock.push({ taille:"", quantite:1 }); render(); };
  document.querySelectorAll("[data-remove-generic]").forEach(el => el.onclick = () => { m.stock.splice(Number(el.dataset.removeGeneric),1); render(); });
  document.querySelectorAll("[data-custom-generic]").forEach(el => el.oninput = () => { m.stock[Number(el.dataset.customGeneric)].taille = el.value; });
  document.querySelectorAll("[data-qte-generic]").forEach(el => el.oninput = () => { m.stock[Number(el.dataset.qteGeneric)].quantite = el.value; });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const nom = new FormData(form).get("nom");
    const clean = m.stock.filter(r=>r.taille && Number(r.quantite)>0).map(r=>({ taille:String(r.taille), quantite:Number(r.quantite) }));
    if (!nom || clean.length===0) return;
    try {
      if (m.data) await updateGeneric(resource, m.data.id, nom, clean); else await createGeneric(resource, nom, clean);
      state.modal = null; render();
    } catch (err) { state.error = err.message; render(); }
  };
}

// ----- Accessoires (cravate / papillon) : stock simple -----
function renderAccessoiresList() {
  const list = state.accessoires;
  return `
  <div class="searchbar">
    <div style="flex:1;font-size:12px;color:var(--taupe-dim);display:flex;align-items:center;">Cravates et nœuds papillon.</div>
    <button class="btn-add" data-open-modal="accessoire">+</button>
  </div>
  ${list.length===0 ? `<div class="empty">Aucun accessoire enregistré</div>` : list.map(renderAccessoireCard).join("")}
  `;
}
function renderAccessoireCard(a) {
  const occ = occupeesAccessoire(a.id);
  const dispo = Math.max(0, Number(a.quantite) - occ);
  const cls = dispo===0?'badge-rose':(dispo<Number(a.quantite)?'badge-amber':'badge-green');
  return `
  <div class="item">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div><div class="title">${escapeHtml(a.nom)} <span class="sub">(${a.type==='cravate'?'Cravate':'Nœud papillon'})</span></div></div>
      <button class="btn-danger-outline" data-delete-accessoire="${a.id}">🗑</button>
    </div>
    <span class="badge ${cls}">${dispo}/${a.quantite} disponible(s)</span>
    <button class="btn-outline" style="margin-top:8px;display:block;" data-open-modal="accessoire" data-id="${a.id}">✎ Modifier</button>
  </div>`;
}

// ----- Montres : stock simple -----
function renderMontresList() {
  const list = state.montres;
  return `
  <div class="searchbar">
    <div style="flex:1;font-size:12px;color:var(--taupe-dim);display:flex;align-items:center;">Montres disponibles à la location.</div>
    <button class="btn-add" data-open-modal="montre">+</button>
  </div>
  ${list.length===0 ? `<div class="empty">Aucune montre enregistrée</div>` : list.map(renderMontreCard).join("")}
  `;
}
function renderMontreCard(m) {
  const occ = occupeesMontre(m.id);
  const dispo = Math.max(0, Number(m.quantite) - occ);
  const cls = dispo===0?'badge-rose':(dispo<Number(m.quantite)?'badge-amber':'badge-green');
  return `
  <div class="item">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div><div class="title">${escapeHtml(m.nom)}</div></div>
      <button class="btn-danger-outline" data-delete-montre="${m.id}">🗑</button>
    </div>
    <span class="badge ${cls}">${dispo}/${m.quantite} disponible(s)</span>
    <button class="btn-outline" style="margin-top:8px;display:block;" data-open-modal="montre" data-id="${m.id}">✎ Modifier</button>
  </div>`;
}

// ============ LOCATIONS ============
function renderLocations() {
  const filter = window.__filter || "en_cours";
  const q = (window.__locQuery || "").toLowerCase().trim();
  let list = state.locations.filter(l => filter==="tous" || l.statut===filter);
  if (q) {
    list = state.locations.filter(l =>
      (l.client_nom||"").toLowerCase().includes(q) || (l.client_tel||"").toLowerCase().includes(q)
    );
  }
  return `
  <div class="searchbar">
    <input id="locSearch" placeholder="Rechercher un client (nom ou téléphone)..." value="${escapeHtml(window.__locQuery||"")}" />
    <button class="btn-add" data-open-modal="location">+</button>
  </div>
  ${q ? `<p style="font-size:11px;color:var(--taupe-dim);margin:0 0 8px;">Historique complet pour "${escapeHtml(window.__locQuery)}" (tous statuts)</p>` : `
  <div class="chips" style="margin-bottom:0;">
    ${[["en_cours","En cours"],["termine","Terminées"],["tous","Toutes"]].map(([id,l])=>`<div class="chip ${filter===id?'active':''}" data-filter="${id}">${l}</div>`).join("")}
  </div>`}
  <div style="height:10px;"></div>
  ${list.length===0 ? `<div class="empty">${q?"Aucun client trouvé":"Aucune location"}</div>` : list.map(renderLocationCard).join("")}
  `;
}
function renderLocationCard(l) {
  const extras = l.costumes_extra || [];
  return `
  <div class="item">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
      <div class="title">👤 ${escapeHtml(l.client_nom)}</div>
      <span class="badge ${l.statut==='en_cours'?'badge-amber':'badge-green'}" style="margin:0;">${l.statut==='en_cours'?'En cours':'Terminée'}</span>
    </div>
    <div class="sub">${escapeHtml(l.costume_nom)} — Veste ${escapeHtml(l.taille_veste||"")} / Pantalon ${escapeHtml(l.taille_pantalon||"")}</div>
    ${extras.map((e,i)=>`<div class="sub">+ Costume ${i+2} : ${escapeHtml(e.costume_nom)} — Veste ${escapeHtml(e.taille_veste)} / Pantalon ${escapeHtml(e.taille_pantalon)}</div>`).join("")}
    ${l.chemise_nom?`<div class="sub">👕 ${escapeHtml(l.chemise_nom)}${l.chemise_taille?` — taille ${escapeHtml(l.chemise_taille)}`:""}</div>`:""}
    ${l.chaussure_nom?`<div class="sub">👞 ${escapeHtml(l.chaussure_nom)}${l.chaussure_taille?` — pointure ${escapeHtml(l.chaussure_taille)}`:""}</div>`:""}
    ${l.jabador_nom?`<div class="sub">🧥 ${escapeHtml(l.jabador_nom)}${l.jabador_taille?` — ${escapeHtml(l.jabador_taille)}`:""}</div>`:""}
    ${l.bernous_nom?`<div class="sub">🧣 ${escapeHtml(l.bernous_nom)}${l.bernous_taille?` — ${escapeHtml(l.bernous_taille)}`:""}</div>`:""}
    ${l.accessoire_nom?`<div class="sub">🎀 ${escapeHtml(l.accessoire_nom)}</div>`:""}
    ${l.montre_nom?`<div class="sub">⌚ ${escapeHtml(l.montre_nom)}</div>`:""}
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--taupe);margin-top:6px;">
      <span>📅 Événement le ${l.date_evenement}</span><span style="color:var(--brass-bright);font-weight:600;">${formatDA(l.montant_total)}</span>
    </div>
    <div class="sub">Costume(s) bloqué(s) du ${decale(l.date_evenement,-2)} au ${decale(l.date_evenement,2)}</div>
    ${l.avance>0?`<div class="sub">Avance: ${formatDA(l.avance)} — Reste: ${formatDA(l.montant_total-l.avance)}</div>`:""}
    ${l.statut==='en_cours'?`<button class="btn-outline" style="margin-top:8px;color:var(--thread-green);border-color:#2E4A37;" data-close-location="${l.id}">✓ Clôturer / Retour costume</button>`:""}
  </div>`;
}

// ============ ARGENT ============
function renderArgent() {
  const period = window.__period || "7j";
  const totalRevenus = state.transactions.filter(t=>t.type==="revenu").reduce((s,t)=>s+t.montant,0);
  const totalDepenses = state.transactions.filter(t=>t.type==="depense").reduce((s,t)=>s+t.montant,0);
  const bornes = { jour:0, hier:1, "3j":3, "7j":7, annee:366, tous: Infinity };
  const maxE = bornes[period];
  const filtered = period==="hier" ? state.transactions.filter(t=>joursEcart(t.date)===1)
    : state.transactions.filter(t=>joursEcart(t.date)<=maxE);
  const parJour = {};
  filtered.forEach(t => { (parJour[t.date] = parJour[t.date]||[]).push(t); });
  const jours = Object.keys(parJour).sort((a,b)=>new Date(b)-new Date(a));
  const revJ = state.transactions.filter(t=>t.type==="revenu"&&joursEcart(t.date)===0).reduce((s,t)=>s+t.montant,0);
  const depJ = state.transactions.filter(t=>t.type==="depense"&&joursEcart(t.date)===0).reduce((s,t)=>s+t.montant,0);

  return `
  <div class="card">
    <div style="font-size:11px;color:var(--taupe);text-transform:uppercase;">Aujourd'hui</div>
    <div style="display:flex;gap:16px;margin-top:6px;align-items:center;">
      <div><div class="pos" style="font-weight:700;">+${formatDA(revJ)}</div><div style="font-size:10px;color:var(--taupe-dim);">Entrées</div></div>
      <div><div class="neg" style="font-weight:700;">-${formatDA(depJ)}</div><div style="font-size:10px;color:var(--taupe-dim);">Sorties</div></div>
      <div style="margin-left:auto;text-align:right;"><div class="${revJ-depJ>=0?'pos':'neg'}" style="font-weight:700;">${formatDA(revJ-depJ)}</div><div style="font-size:10px;color:var(--taupe-dim);">Solde du jour</div></div>
    </div>
  </div>
  <div class="stat-grid">
    <div class="stat-card"><div class="pos" style="font-weight:700;font-size:17px;">${formatDA(totalRevenus)}</div><div class="lbl">Total revenus</div></div>
    <div class="stat-card"><div class="neg" style="font-weight:700;font-size:17px;">${formatDA(totalDepenses)}</div><div class="lbl">Total dépenses</div></div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <div class="chips" style="margin-bottom:0;">
      ${[["jour","Aujourd'hui"],["hier","Hier"],["3j","3 jours"],["7j","7 jours"],["annee","Année"],["tous","Tout"]].map(([id,l])=>`<div class="chip ${period===id?'active':''}" data-period="${id}">${l}</div>`).join("")}
    </div>
    <button class="btn-add" data-open-modal="transaction">+</button>
  </div>
  <p style="font-size:11px;color:var(--taupe-dim);margin:10px 0;">L'historique est permanent — aucune transaction ne peut être supprimée.</p>
  ${jours.length===0 ? `<div class="empty">Aucune transaction sur cette période</div>` : jours.map(date => {
    const items = parJour[date];
    const r = items.filter(t=>t.type==="revenu").reduce((s,t)=>s+t.montant,0);
    const d = items.filter(t=>t.type==="depense").reduce((s,t)=>s+t.montant,0);
    const solde = r-d;
    return `<div class="day-header"><span>${formatJourFr(date)}</span><span class="${solde>=0?'pos':'neg'}">${solde>=0?'+':''}${formatDA(solde)}</span></div>${items.map(renderTxRow).join("")}`;
  }).join("")}
  `;
}
function renderTxRow(t) {
  const isRev = t.type==="revenu";
  return `<div class="tx-row"><div class="tx-left">
    <div class="tx-icon ${isRev?'rev':'dep'}">${isRev?'↑':'↓'}</div>
    <div><div class="tx-desc">${escapeHtml(t.description)}</div><div class="tx-date">${t.date}</div></div>
  </div><div class="${isRev?'pos':'neg'}" style="font-weight:700;font-size:13px;">${isRev?'+':'-'}${formatDA(t.montant)}</div></div>`;
}

// ============ MODALS ============
function renderModal() {
  const m = state.modal;
  if (m.type === "costume") return renderCostumeModal(m);
  if (["chemise","chaussure","jabador","bernous"].includes(m.type)) return renderGenericModal(m.type, m);
  if (m.type === "accessoire") return renderAccessoireModal(m);
  if (m.type === "montre") return renderMontreModal(m);
  if (m.type === "location") return renderLocationModal(m);
  if (m.type === "transaction") return renderTxModal(m);
  if (m.type === "cloture") return renderClotureModal(m);
  if (m.type === "calendrier") return renderCalendrierModal(m);
  return "";
}
function modalWrap(title, inner) {
  return `<div class="modal-overlay" data-close-modal="1"><div class="modal" onclick="event.stopPropagation()">
    <div class="tape-rule" style="margin:0 -18px;"></div>
    <div class="modal-header"><h3>${title}</h3><button class="modal-close" data-close-modal="1">✕</button></div>
    ${inner}
  </div></div>`;
}

// ----- Costume Modal (veste + pantalon, stocks indépendants) -----
function renderCostumeModal(m) {
  const editing = !!m.data;
  function tailleSection(stock, toggleAttr, customAttr, qteAttr, removeAttr, addBtnId, label) {
    return `
      <label style="font-size:13px;font-weight:700;display:block;margin:12px 0 4px;">${label}</label>
      <div class="field"><label>Tailles de ${label.toLowerCase()}</label>
        <div class="chips" style="margin-bottom:0;">
          ${TAILLES_COSTUME.map(t => `<div class="taille-btn ${stock.some(r=>r.taille===t)?'active':''}" data-${toggleAttr}="${t}">${t}</div>`).join("")}
        </div>
      </div>
      ${stock.length ? `<label style="font-size:12px;color:var(--taupe);">Quantité par taille</label>` : ""}
      <div>${stock.map((r,i)=>`
        <div class="taille-row">
          ${TAILLES_COSTUME.includes(r.taille) ? `<span class="tsz">${r.taille}</span>` : `<input class="tsz" data-${customAttr}="${i}" value="${escapeHtml(r.taille)}" placeholder="Taille" />`}
          <input type="number" min="1" data-${qteAttr}="${i}" value="${r.quantite}" placeholder="Quantité" />
          <button type="button" data-${removeAttr}="${i}">✕</button>
        </div>`).join("")}</div>
      <button type="button" class="btn-secondary" id="${addBtnId}">+ Ajouter une taille personnalisée</button>
    `;
  }
  return modalWrap(editing ? "Modifier le costume" : "Nouveau costume", `
    <form id="costumeForm">
      <div class="field"><label>Nom du costume *</label><input name="nom" id="costumeNom" required value="${escapeHtml(m.nom !== undefined ? m.nom : (m.data?.nom||""))}" placeholder="Ex: Payet" /></div>
      ${tailleSection(m.stockVeste, "toggle-veste", "custom-veste", "qte-veste", "remove-veste", "addCustomVeste", "Veste")}
      ${tailleSection(m.stockPantalon, "toggle-pantalon", "custom-pantalon", "qte-pantalon", "remove-pantalon", "addCustomPantalon", "Pantalon")}
      <p class="field-hint" style="margin-top:10px;">Le client peut choisir une veste et un pantalon de tailles différentes (ex: veste 46 + pantalon 48).</p>
      <button type="submit" class="btn-primary">${editing ? "Enregistrer" : "Ajouter le costume"}</button>
    </form>
  `);
}
function attachCostumeFormEvents(form) {
  const m = state.modal;
  const nomInput = document.getElementById("costumeNom");
  if (nomInput) nomInput.oninput = (e) => { m.nom = e.target.value; };
  function wire(stockArr, toggleSel, customSel, qteSel, removeSel, addBtnId) {
    document.querySelectorAll(`[${toggleSel}]`).forEach(el => el.onclick = () => {
      const t = el.getAttribute(toggleSel);
      const idx = stockArr.findIndex(r=>r.taille===t);
      if (idx>=0) stockArr.splice(idx,1); else stockArr.push({ taille: t, quantite: 1 });
      render();
    });
    const addBtn = document.getElementById(addBtnId);
    if (addBtn) addBtn.onclick = () => { stockArr.push({ taille:"", quantite:1 }); render(); };
    document.querySelectorAll(`[${removeSel}]`).forEach(el => el.onclick = () => { stockArr.splice(Number(el.getAttribute(removeSel)),1); render(); });
    document.querySelectorAll(`[${customSel}]`).forEach(el => el.oninput = () => { stockArr[Number(el.getAttribute(customSel))].taille = el.value; });
    document.querySelectorAll(`[${qteSel}]`).forEach(el => el.oninput = () => { stockArr[Number(el.getAttribute(qteSel))].quantite = el.value; });
  }
  wire(m.stockVeste, "data-toggle-veste", "data-custom-veste", "data-qte-veste", "data-remove-veste", "addCustomVeste");
  wire(m.stockPantalon, "data-toggle-pantalon", "data-custom-pantalon", "data-qte-pantalon", "data-remove-pantalon", "addCustomPantalon");

  form.onsubmit = async (e) => {
    e.preventDefault();
    const nom = new FormData(form).get("nom");
    const cleanV = m.stockVeste.filter(r=>r.taille && Number(r.quantite)>0).map(r=>({ taille:String(r.taille), quantite:Number(r.quantite) }));
    const cleanP = m.stockPantalon.filter(r=>r.taille && Number(r.quantite)>0).map(r=>({ taille:String(r.taille), quantite:Number(r.quantite) }));
    if (!nom || cleanV.length===0 || cleanP.length===0) {
      state.error = "Ajoute au moins une taille de veste ET une taille de pantalon.";
      render();
      return;
    }
    try {
      if (m.data) await updateCostume(m.data.id, nom, cleanV, cleanP); else await createCostume(nom, cleanV, cleanP);
      state.modal = null; render();
    } catch (err) { state.error = err.message; render(); }
  };
}

// ----- Accessoire Modal (cravate / papillon, stock simple) -----
function renderAccessoireModal(m) {
  const editing = !!m.data;
  return modalWrap(editing ? "Modifier l'accessoire" : "Nouvel accessoire", `
    <form id="accessoireForm">
      <div class="field"><label>Type *</label>
        <select name="type">
          <option value="cravate" ${m.data?.type==='cravate'?'selected':''}>Cravate</option>
          <option value="papillon" ${m.data?.type==='papillon'?'selected':''}>Nœud papillon</option>
        </select>
      </div>
      <div class="field"><label>Nom / couleur *</label><input name="nom" required value="${escapeHtml(m.data?.nom||"")}" placeholder="Ex: Cravate bordeaux" /></div>
      <div class="field"><label>Quantité en stock *</label><input type="number" name="quantite" min="1" required value="${m.data?.quantite||1}" /></div>
      <button type="submit" class="btn-primary">${editing ? "Enregistrer" : "Ajouter l'accessoire"}</button>
    </form>
  `);
}
function attachAccessoireFormEvents(form) {
  const m = state.modal;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const nom = fd.get("nom"), type = fd.get("type"), quantite = Number(fd.get("quantite"));
    if (!nom || !quantite) return;
    try {
      if (m.data) await updateAccessoire(m.data.id, nom, type, quantite); else await createAccessoire(nom, type, quantite);
      state.modal = null; render();
    } catch (err) { state.error = err.message; render(); }
  };
}

// ----- Montre Modal (stock simple) -----
function renderMontreModal(m) {
  const editing = !!m.data;
  return modalWrap(editing ? "Modifier la montre" : "Nouvelle montre", `
    <form id="montreForm">
      <div class="field"><label>Nom / modèle *</label><input name="nom" required value="${escapeHtml(m.data?.nom||"")}" placeholder="Ex: Montre argentée classique" /></div>
      <div class="field"><label>Quantité en stock *</label><input type="number" name="quantite" min="1" required value="${m.data?.quantite||1}" /></div>
      <button type="submit" class="btn-primary">${editing ? "Enregistrer" : "Ajouter la montre"}</button>
    </form>
  `);
}
function attachMontreFormEvents(form) {
  const m = state.modal;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const nom = fd.get("nom"), quantite = Number(fd.get("quantite"));
    if (!nom || !quantite) return;
    try {
      if (m.data) await updateMontre(m.data.id, nom, quantite); else await createMontre(nom, quantite);
      state.modal = null; render();
    } catch (err) { state.error = err.message; render(); }
  };
}

// ----- Location Modal -----
function renderVestePantalonFields(costumeId, dateEvenement, tailleVeste, taillePantalon, target) {
  const costume = state.costumes.find(c=>c.id===costumeId);
  const stockV = costume ? (costume.stock_veste||[]) : [];
  const stockP = costume ? (costume.stock_pantalon||[]) : [];
  const vesteDispo = dateEvenement ? stockV.map(r=>({...r,dispo:dispoVestePourDate(costumeId,r.taille,r.quantite,dateEvenement)})).filter(r=>r.dispo>0) : [];
  const pantalonDispo = dateEvenement ? stockP.map(r=>({...r,dispo:dispoPantalonPourDate(costumeId,r.taille,r.quantite,dateEvenement)})).filter(r=>r.dispo>0) : [];
  return `
    <div class="row2">
      <div class="field"><label>Taille veste *</label>
        ${!dateEvenement ? `<div style="font-size:12px;color:var(--taupe);">Choisis une date.</div>` :
          vesteDispo.length===0 ? `<div style="font-size:12px;color:var(--thread-rust);">Aucune veste libre.</div>` :
          `<select data-loc-role="veste" data-loc-target="${target}">${vesteDispo.map(r=>`<option value="${escapeHtml(r.taille)}" ${r.taille===tailleVeste?'selected':''}>${escapeHtml(r.taille)} (${r.dispo})</option>`).join("")}</select>`}
      </div>
      <div class="field"><label>Taille pantalon *</label>
        ${!dateEvenement ? `<div style="font-size:12px;color:var(--taupe);">Choisis une date.</div>` :
          pantalonDispo.length===0 ? `<div style="font-size:12px;color:var(--thread-rust);">Aucun pantalon libre.</div>` :
          `<select data-loc-role="pantalon" data-loc-target="${target}">${pantalonDispo.map(r=>`<option value="${escapeHtml(r.taille)}" ${r.taille===taillePantalon?'selected':''}>${escapeHtml(r.taille)} (${r.dispo})</option>`).join("")}</select>`}
      </div>
    </div>
  `;
}
function renderExtraCostumeBlock(m, idx) {
  const extra = m.extras[idx];
  return `
    <div class="card" style="margin-top:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <b style="font-size:13px;">Costume ${idx+2}</b>
        <button type="button" class="btn-danger-outline" data-remove-extra="${idx}">✕ Retirer</button>
      </div>
      <div class="field"><label>Costume *</label>
        <select data-loc-role="costume" data-loc-target="extra:${idx}">
          ${state.costumes.map(c=>`<option value="${c.id}" ${c.id===extra.costumeId?'selected':''}>${escapeHtml(c.nom)}</option>`).join("")}
        </select>
      </div>
      ${renderVestePantalonFields(extra.costumeId, m.dateEvenement, extra.tailleVeste, extra.taillePantalon, `extra:${idx}`)}
    </div>
  `;
}
function renderLocationModal(m) {
  if (state.costumes.length===0) return modalWrap("Nouvelle location", `<div class="empty">Aucun costume enregistré.</div>`);

  const mainVP = renderVestePantalonFields(m.costumeId, m.dateEvenement, m.tailleVeste, m.taillePantalon, "main");

  function optionalSection(resource, idKey, tailleKey, label, icon) {
    const arr = stateArrayFor(resource);
    const selected = arr.find(x=>x.id===m[idKey]);
    const stock = selected ? (selected.stock||[]) : [];
    const dispo = (m[idKey] && m.dateEvenement) ? stock.map(r=>({...r,dispo:dispoGenericTaillePourDate(resource,m[idKey],r.taille,r.quantite,m.dateEvenement)})).filter(r=>r.dispo>0) : [];
    const cfgVariant = STOCK_RESOURCES[resource].variantLabel;
    return `
      <div class="field"><label>${icon} ${label} (optionnel)</label>
        <select id="loc_${resource}">
          <option value="">— Aucun(e) —</option>
          ${arr.map(x=>`<option value="${x.id}" ${x.id===m[idKey]?'selected':''}>${escapeHtml(x.nom)}</option>`).join("")}
        </select>
      </div>
      ${m[idKey] ? `<div class="field"><label>${cfgVariant==='pointure'?'Pointure':(cfgVariant==='couleur'?'Couleur':'Taille')} *</label>
        ${!m.dateEvenement?`<div style="font-size:12px;color:var(--taupe);">Choisis une date.</div>`:
        dispo.length===0?`<div style="font-size:12px;color:var(--thread-rust);">Aucune option libre à cette date.</div>`:
        `<select name="${tailleKey}">${dispo.map(r=>`<option value="${escapeHtml(r.taille)}">${escapeHtml(r.taille)} (${r.dispo})</option>`).join("")}</select>`}</div>` : ""}
    `;
  }

  const mainOk = m.dateEvenement && m.tailleVeste && m.taillePantalon;
  const extrasOk = m.extras.every(e => e.tailleVeste && e.taillePantalon);

  return modalWrap("Nouvelle location", `
    <form id="locationForm">
      <div class="field"><label>Date de l'événement *</label><input type="date" id="locDate" value="${m.dateEvenement||""}" required /></div>
      <p class="field-hint">Chaque pièce est réservée du J-2 au J+2 autour de cette date.</p>

      <b style="font-size:13px;display:block;margin-bottom:8px;">Costume principal</b>
      <div class="field"><label>Costume *</label>
        <select id="locCostume">${state.costumes.map(c=>`<option value="${c.id}" ${c.id===m.costumeId?'selected':''}>${escapeHtml(c.nom)}</option>`).join("")}</select>
      </div>
      ${mainVP}

      ${m.extras.map((e,i)=>renderExtraCostumeBlock(m,i)).join("")}
      <button type="button" class="btn-secondary" id="addExtraCostume">+ Ajouter un ${m.extras.length+2}ème costume</button>

      <hr style="border-color:var(--seam);margin:14px 0;" />
      <div class="field"><label>Nom du client *</label><input name="clientNom" required placeholder="Nom complet" /></div>
      <div class="field"><label>Téléphone</label><input name="clientTel" placeholder="0555 xx xx xx" /></div>

      <hr style="border-color:var(--seam);margin:14px 0;" />
      ${optionalSection("chemise","chemiseId","chemiseTaille","Chemise","👕")}
      ${optionalSection("chaussure","chaussureId","chaussureTaille","Chaussures","👞")}
      ${optionalSection("jabador","jabadorId","jabadorCouleur","Jabador","🧥")}
      ${optionalSection("bernous","bernousId","bernousCouleur","Bernous","🧣")}

      <div class="field"><label>Accessoire — cravate/nœud papillon (optionnel)</label>
        <select name="accessoireId">
          <option value="">— Aucun —</option>
          ${state.accessoires.map(a=>{
            const dispo = Math.max(0, Number(a.quantite) - occupeesAccessoire(a.id));
            return `<option value="${a.id}" ${dispo<=0?'disabled':''}>${escapeHtml(a.nom)} (${dispo})</option>`;
          }).join("")}
        </select>
      </div>
      <div class="field"><label>Montre (optionnel)</label>
        <select name="montreId">
          <option value="">— Aucune —</option>
          ${state.montres.map(mt=>{
            const dispo = Math.max(0, Number(mt.quantite) - occupeesMontre(mt.id));
            return `<option value="${mt.id}" ${dispo<=0?'disabled':''}>${escapeHtml(mt.nom)} (${dispo})</option>`;
          }).join("")}
        </select>
      </div>
      <hr style="border-color:var(--seam);margin:14px 0;" />

      <div class="row2">
        <div class="field"><label>Prix / Montant total (DA) *</label><input type="number" name="montantTotal" required placeholder="4500" /></div>
        <div class="field"><label>Avance reçue (DA)</label><input type="number" name="avance" placeholder="0" /></div>
      </div>
      <button type="submit" class="btn-primary" ${(!mainOk || !extrasOk)?'disabled':''}>Créer la location</button>
    </form>
  `);
}
function attachLocationFormEvents(form) {
  const m = state.modal;
  document.getElementById("locDate").onchange = (e) => {
    m.dateEvenement = e.target.value; m.tailleVeste=""; m.taillePantalon="";
    m.extras.forEach(x=>{ x.tailleVeste=""; x.taillePantalon=""; });
    render();
  };
  document.getElementById("locCostume").onchange = (e) => { m.costumeId = e.target.value; m.tailleVeste=""; m.taillePantalon=""; render(); };

  ["chemise","chaussure","jabador","bernous"].forEach(resource => {
    const sel = document.getElementById(`loc_${resource}`);
    if (sel) sel.onchange = (e) => { m[`${resource}Id`] = e.target.value; render(); };
  });

  document.querySelectorAll("[data-loc-role]").forEach(el => el.onchange = (e) => {
    const role = el.dataset.locRole;
    const target = el.dataset.locTarget;
    const val = e.target.value;
    if (target === "main") {
      if (role==="veste") m.tailleVeste = val; else if (role==="pantalon") m.taillePantalon = val;
    } else {
      const idx = Number(target.split(":")[1]);
      if (role==="costume") { m.extras[idx].costumeId = val; m.extras[idx].tailleVeste=""; m.extras[idx].taillePantalon=""; }
      else if (role==="veste") m.extras[idx].tailleVeste = val;
      else if (role==="pantalon") m.extras[idx].taillePantalon = val;
    }
    render();
  });

  const addExtraBtn = document.getElementById("addExtraCostume");
  if (addExtraBtn) addExtraBtn.onclick = () => {
    m.extras.push({ costumeId: state.costumes[0]?.id || "", tailleVeste:"", taillePantalon:"" });
    render();
  };
  document.querySelectorAll("[data-remove-extra]").forEach(el => el.onclick = () => {
    m.extras.splice(Number(el.dataset.removeExtra),1);
    render();
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      costumeId: m.costumeId,
      tailleVeste: m.tailleVeste,
      taillePantalon: m.taillePantalon,
      dateEvenement: m.dateEvenement,
      clientNom: fd.get("clientNom"),
      clientTel: fd.get("clientTel"),
      montantTotal: fd.get("montantTotal"),
      avance: fd.get("avance"),
      chemiseId: m.chemiseId || undefined,
      chemiseTaille: fd.get("chemiseTaille") || undefined,
      chaussureId: m.chaussureId || undefined,
      chaussureTaille: fd.get("chaussureTaille") || undefined,
      jabadorId: m.jabadorId || undefined,
      jabadorCouleur: fd.get("jabadorCouleur") || undefined,
      bernousId: m.bernousId || undefined,
      bernousCouleur: fd.get("bernousCouleur") || undefined,
      accessoireId: fd.get("accessoireId") || undefined,
      montreId: fd.get("montreId") || undefined,
      costumesExtra: m.extras.map(x=>({ costumeId:x.costumeId, tailleVeste:x.tailleVeste, taillePantalon:x.taillePantalon })),
    };
    try { await createLocationApi(payload); state.modal = null; render(); }
    catch (err) { state.error = err.message; render(); }
  };
}

// ----- Transaction Modal -----
function renderTxModal(m) {
  return modalWrap("Nouvelle transaction", `
    <form id="txForm">
      <div class="row2">
        <button type="button" class="chip ${m.txType==='revenu'?'active':''}" style="padding:10px;" data-txtype="revenu">↑ Revenu</button>
        <button type="button" class="chip ${m.txType==='depense'?'active':''}" style="padding:10px;" data-txtype="depense">↓ Dépense</button>
      </div>
      <div class="field" style="margin-top:12px;"><label>Description *</label><input name="description" required placeholder="Ex: Achat tissus, location..." /></div>
      <div class="field"><label>Montant (DA) *</label><input type="number" name="montant" required /></div>
      <button type="submit" class="btn-primary">Ajouter</button>
    </form>
  `);
}
function attachTxFormEvents(form) {
  const m = state.modal;
  document.querySelectorAll("[data-txtype]").forEach(el => el.onclick = () => { m.txType = el.dataset.txtype; render(); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await addTransactionApi({ type: m.txType, montant: fd.get("montant"), description: fd.get("description") });
      state.modal = null; render();
    } catch (err) { state.error = err.message; render(); }
  };
}

// ----- Cloture Modal -----
function renderClotureModal(m) {
  const reste = m.loc.montant_total - m.loc.avance;
  return modalWrap("Clôturer la location", `
    <p style="font-size:13px;color:var(--taupe);">Retour du costume <b>${escapeHtml(m.loc.costume_nom)}</b> par <b>${escapeHtml(m.loc.client_nom)}</b>.</p>
    <form id="clotureForm">
      <div class="field"><label>Montant restant encaissé (DA)</label><input type="number" name="montantRestant" value="${reste>0?reste:0}" /></div>
      <button type="submit" class="btn-primary">Confirmer le retour</button>
    </form>
  `);
}
function attachClotureFormEvents(form) {
  const m = state.modal;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const montant = Number(new FormData(form).get("montantRestant")) || 0;
    try { await cloturerApi(m.loc.id, montant); state.modal = null; render(); }
    catch (err) { state.error = err.message; render(); }
  };
}

// ----- Calendrier Modal (veste ou pantalon) -----
const MOIS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const JOURS_FR = ["L","M","M","J","V","S","D"];

function renderCalendrierModal(m) {
  const c = state.costumes.find(c=>c.id===m.costumeId);
  if (!c) return modalWrap("Calendrier", `<div class="empty">Costume introuvable.</div>`);
  const stock = m.component==="veste" ? (c.stock_veste||[]) : (c.stock_pantalon||[]);

  const year = m.year, month = m.month;
  const first = new Date(year, month, 1);
  const startWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayStr = todayISO();

  let cells = "";
  for (let i=0; i<startWeekday; i++) cells += `<div class="cal-cell cal-empty"></div>`;
  for (let d=1; d<=daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const stockRow = stock.find(r=>r.taille===m.taille);
    let cls = "cal-libre";
    if (stockRow) {
      const dispo = m.component==="veste" ? dispoVestePourDate(c.id,m.taille,stockRow.quantite,dateStr) : dispoPantalonPourDate(c.id,m.taille,stockRow.quantite,dateStr);
      cls = dispo<=0 ? "cal-complet" : (dispo<Number(stockRow.quantite) ? "cal-partiel" : "cal-libre");
    }
    const isToday = dateStr === todayStr ? " cal-today" : "";
    cells += `<div class="cal-cell ${cls}${isToday}">${d}</div>`;
  }

  return modalWrap(`Calendrier — ${escapeHtml(c.nom)}`, `
    <div class="chips" style="margin-bottom:8px;">
      <div class="chip ${m.component==='veste'?'active':''}" data-cal-component="veste">Veste</div>
      <div class="chip ${m.component==='pantalon'?'active':''}" data-cal-component="pantalon">Pantalon</div>
    </div>
    ${stock.length>1 ? `
    <div class="chips" style="margin-bottom:10px;">
      ${stock.map(r=>`<div class="chip ${m.taille===r.taille?'active':''}" data-cal-taille="${escapeHtml(r.taille)}">${escapeHtml(r.taille)}</div>`).join("")}
    </div>` : ""}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <button type="button" class="btn-outline" id="calPrev">← </button>
      <span style="font-weight:700;">${MOIS_FR[month]} ${year}</span>
      <button type="button" class="btn-outline" id="calNext"> →</button>
    </div>
    <div class="cal-grid cal-grid-header">${JOURS_FR.map(j=>`<div class="cal-cell cal-head">${j}</div>`).join("")}</div>
    <div class="cal-grid">${cells}</div>
    <div style="display:flex;gap:12px;margin-top:12px;font-size:11px;color:var(--taupe);flex-wrap:wrap;">
      <span><span class="cal-dot cal-libre"></span> Libre</span>
      <span><span class="cal-dot cal-partiel"></span> Partiellement pris</span>
      <span><span class="cal-dot cal-complet"></span> Complet</span>
    </div>
  `);
}
function attachCalendrierEvents() {
  const m = state.modal;
  document.querySelectorAll("[data-cal-component]").forEach(el => el.onclick = () => {
    m.component = el.dataset.calComponent;
    const c = state.costumes.find(c=>c.id===m.costumeId);
    const stock = m.component==="veste" ? (c.stock_veste||[]) : (c.stock_pantalon||[]);
    m.taille = stock[0]?.taille || "";
    render();
  });
  document.querySelectorAll("[data-cal-taille]").forEach(el => el.onclick = () => { m.taille = el.dataset.calTaille; render(); });
  const prev = document.getElementById("calPrev");
  const next = document.getElementById("calNext");
  if (prev) prev.onclick = () => { m.month--; if (m.month<0){ m.month=11; m.year--; } render(); };
  if (next) next.onclick = () => { m.month++; if (m.month>11){ m.month=0; m.year++; } render(); };
}

// ============ ADMIN (SSALEMDEV) ============
const adminState = {
  token: localStorage.getItem("ssalemdev_admin_token") || null,
  clients: [],
  error: "",
  info: "",
};

async function apiAdmin(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (adminState.token) headers["Authorization"] = "Bearer " + adminState.token;
  const res = await fetch("/api/admin" + path, { ...opts, headers: { ...headers, ...(opts.headers||{}) } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Erreur serveur");
  return d;
}

async function renderAdminRoot(root) {
  if (!adminState.token) {
    root.innerHTML = renderAdminLogin();
    const form = document.getElementById("adminLoginForm");
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        const d = await apiAdmin("/login", { method: "POST", body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }) });
        adminState.token = d.token;
        localStorage.setItem("ssalemdev_admin_token", d.token);
        adminState.error = "";
        await refreshAdminClients();
      } catch (err) { adminState.error = err.message; render(); }
    };
    return;
  }
  try { await refreshAdminClients(); } catch (err) {
    if (String(err.message).toLowerCase().includes("session")) {
      adminState.token = null; localStorage.removeItem("ssalemdev_admin_token"); render(); return;
    }
  }
}

async function refreshAdminClients() {
  adminState.clients = await apiAdmin("/clients");
  renderAdminPanel();
}

function renderAdminPanel() {
  const root = document.getElementById("app");
  root.innerHTML = `
  <div class="header">
    <div><h1>SSALEMDEV</h1><p>Panneau admin</p></div>
    <div class="top-right"><button class="logout-btn" id="adminLogout">Quitter</button></div>
  </div>
  <div class="main">
    ${adminState.error ? `<div class="error-box">${escapeHtml(adminState.error)}</div>` : ""}
    ${adminState.info ? `<div class="card" style="border-color:#2E4A37;">${adminState.info}</div>` : ""}
    <div class="card">
      <h3 style="margin-top:0;font-size:14px;">Créer un compte client</h3>
      <form id="createClientForm">
        <div class="field"><label>Nom de la boutique</label><input name="nomBoutique" required placeholder="Ex: PIGOS Oran" /></div>
        <div class="field"><label>Email</label><input name="email" type="email" required placeholder="client@exemple.com" /></div>
        <div class="field"><label>Mot de passe</label><input name="password" type="password" required minlength="6" placeholder="6 caractères minimum" /></div>
        <button type="submit" class="btn-primary">Créer le compte</button>
      </form>
    </div>
    <h3 style="font-size:12px;color:var(--taupe);text-transform:uppercase;margin:14px 0 8px;">Clients (${adminState.clients.length})</h3>
    ${adminState.clients.length===0 ? `<div class="empty">Aucun client pour l'instant</div>` : adminState.clients.map(c => `
      <div class="item">
        <div class="title">${escapeHtml(c.nom_boutique)}</div>
        <div class="sub">${escapeHtml(c.email)}</div>
        <div class="sub">Créé le ${new Date(c.created_at).toLocaleDateString("fr-FR")}</div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn-outline" data-reset-client="${c.id}">Réinitialiser mot de passe</button>
          <button class="btn-danger-outline" data-delete-client="${c.id}">Supprimer</button>
        </div>
      </div>
    `).join("")}
  </div>`;

  document.getElementById("adminLogout").onclick = () => {
    adminState.token = null; localStorage.removeItem("ssalemdev_admin_token"); render();
  };
  document.getElementById("createClientForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = { nomBoutique: fd.get("nomBoutique"), email: fd.get("email"), password: fd.get("password") };
    try {
      await apiAdmin("/clients", { method: "POST", body: JSON.stringify(payload) });
      adminState.error = "";
      adminState.info = `Compte créé ✓ — envoie ces informations au client :<br/>Site : <b>${window.location.origin}</b><br/>Email : <b>${escapeHtml(payload.email)}</b><br/>Mot de passe : <b>${escapeHtml(payload.password)}</b>`;
      await refreshAdminClients();
    } catch (err) { adminState.error = err.message; adminState.info = ""; renderAdminPanel(); }
  };
  document.querySelectorAll("[data-reset-client]").forEach(el => el.onclick = async () => {
    const nouveauMdp = prompt("Nouveau mot de passe pour ce client (6 caractères minimum) :");
    if (!nouveauMdp) return;
    try {
      await apiAdmin(`/clients/${el.dataset.resetClient}/reset-password`, { method: "POST", body: JSON.stringify({ password: nouveauMdp }) });
      adminState.info = `Mot de passe réinitialisé ✓ — nouveau mot de passe : <b>${escapeHtml(nouveauMdp)}</b>`;
      adminState.error = "";
      renderAdminPanel();
    } catch (err) { adminState.error = err.message; renderAdminPanel(); }
  });
  document.querySelectorAll("[data-delete-client]").forEach(el => el.onclick = async () => {
    if (!confirm("Supprimer ce client et toutes ses données ? Cette action est irréversible.")) return;
    try {
      await apiAdmin(`/clients/${el.dataset.deleteClient}`, { method: "DELETE" });
      adminState.info = ""; adminState.error = "";
      await refreshAdminClients();
    } catch (err) { adminState.error = err.message; renderAdminPanel(); }
  });
}

function renderAdminLogin() {
  return `
  <div class="auth-wrap"><div class="auth-box">
    <div class="auth-logo"><h1>SSALEMDEV</h1><p>Espace admin</p></div>
    ${adminState.error ? `<div class="error-box">${escapeHtml(adminState.error)}</div>` : ""}
    <form id="adminLoginForm">
      <div class="field"><label>Email admin</label><input name="email" type="email" required /></div>
      <div class="field"><label>Mot de passe admin</label><input name="password" type="password" required /></div>
      <button type="submit" class="btn-primary">Entrer</button>
    </form>
  </div></div>`;
}

// ============ INIT ============
document.addEventListener("input", (e) => {
  if (e.target && e.target.id === "costumeSearch") { window.__costQuery = e.target.value; renderSearchOnly("costumeSearch", "__costQuery"); }
  if (e.target && e.target.id === "locSearch") { window.__locQuery = e.target.value; renderSearchOnly("locSearch", "__locQuery"); }
});
function renderSearchOnly(inputId, stateKey) {
  const main = document.querySelector(".main");
  if (main) main.innerHTML = (state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : "") + renderTab();
  attachEvents();
  const el = document.getElementById(inputId);
  if (el) { el.focus(); el.value = window[stateKey] || ""; el.setSelectionRange(el.value.length, el.value.length); }
}

if (state.token) { loadAll(); } else { render(); }
