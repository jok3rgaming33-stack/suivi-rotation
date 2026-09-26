/**
 * Suivi Rotation — interventions locatives (L01–L60)
 * Persistance : localStorage (métadonnées) + IndexedDB (médias binaires)
 */
(function () {
  "use strict";

  const STORAGE_KEY = "suivi-rotation-v1";
  const IDB_NAME = "suivi-rotation-media";
  const IDB_STORE = "blobs";
  const UNIT_COUNT = 60;

  const MEDIA_SECTIONS = ["logement", "plomberie", "chauffage", "sanitaire"];
  const MAX_MEDIA_PER_SECTION = 8;
  const MAX_IMAGE_WIDTH = 1280;
  const JPEG_QUALITY = 0.7;
  const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20 Mo
  const MAX_CAPTION = 120;
  const MAX_REPORT = 4000;

  const CATALOGUE = {
    plomberie: {
      id: "plomberie",
      label: "Plomberie",
      short: "Plomb.",
      badge: "plomb",
      items: [
        { code: "P01", label: "Contrôle / remise en service arrivée d'eau froide" },
        { code: "P02", label: "Contrôle pression & purge réseaux" },
        { code: "P03", label: "Vérif. robinetterie cuisine (mitigeur, flexible)" },
        { code: "P04", label: "Vérif. robinetterie salle de bain / WC" },
        { code: "P05", label: "Contrôle chasse d'eau & mécanisme WC" },
        { code: "P06", label: "Recherche / réparation fuite visible" },
        { code: "P07", label: "Débouchage évier / lavabo / douche" },
        { code: "P08", label: "Siphon / joints / colliers (remplacement)" },
        { code: "P09", label: "Contrôle ballon ECS / groupe de sécurité" },
        { code: "P10", label: "Vidange / mise hors gel (si besoin)" },
      ],
    },
    chauffage: {
      id: "chauffage",
      label: "Chauffage",
      short: "Chauff.",
      badge: "chauff",
      items: [
        { code: "C01", label: "Contrôle radiateurs (corps, robinets, tête thermo)" },
        { code: "C02", label: "Purge radiateurs / désembouage léger" },
        { code: "C03", label: "Vérif. température & régulation (thermostat)" },
        { code: "C04", label: "Contrôle chaudière / module individuel (si présent)" },
        { code: "C05", label: "Contrôle vanne d'arrêt / nourrice chauffage" },
        { code: "C06", label: "Contrôle VMC / bouche extraction (lien confort)" },
        { code: "C07", label: "Remplacement tête thermostatique défectueuse" },
        { code: "C08", label: "Contrôle absence fuite circuit chauffage" },
      ],
    },
    sanitaire: {
      id: "sanitaire",
      label: "Sanitaire",
      short: "Sanit.",
      badge: "sanit",
      items: [
        { code: "S01", label: "Nettoyage / détartrage sanitaire (cuvette, lavabo)" },
        { code: "S02", label: "Contrôle douche / baignoire (joints, siphon, flexible)" },
        { code: "S03", label: "Remplacement joints silicone (bain / douche)" },
        { code: "S04", label: "Contrôle miroir / accessoires (barre, porte-serviette)" },
        { code: "S05", label: "Contrôle meuble vasque & évacuation" },
        { code: "S06", label: "Contrôle aérateur / extracteur SDB" },
        { code: "S07", label: "Remplacement abattant WC / frein de chute" },
        { code: "S08", label: "État des lieux photos sanitaires (entrée/sortie)" },
      ],
    },
  };

  const CORPS = ["plomberie", "chauffage", "sanitaire"];
  const TOTAL_ITEMS = CORPS.reduce((n, k) => n + CATALOGUE[k].items.length, 0);

  const STATUS = {
    non: { id: "non", label: "Non" },
    encours: { id: "encours", label: "En cours" },
    fait: { id: "fait", label: "Fait" },
  };

  const SECTION_META = {
    logement: { id: "logement", label: "Logement", badge: "logement", short: "Log." },
    plomberie: CATALOGUE.plomberie,
    chauffage: CATALOGUE.chauffage,
    sanitaire: CATALOGUE.sanitaire,
  };

  const COMPTA_CATEGORIES = [
    { id: "pieces", label: "Pièces" },
    { id: "main_oeuvre", label: "Main d'œuvre" },
    { id: "deplacement", label: "Déplacement" },
    { id: "sous_traitance", label: "Sous-traitance" },
    { id: "facturation", label: "Facturation" },
    { id: "acompte", label: "Acompte" },
    { id: "autre", label: "Autre" },
  ];

  const COMPTA_CAT_MAP = Object.fromEntries(COMPTA_CATEGORIES.map((c) => [c.id, c.label]));

  // ——— State ———
  let state = null;
  let currentView = "home";
  let currentUnit = null;
  let filter = "all";
  let searchQuery = "";
  let comptaPeriod = "month"; // month | all | custom
  let comptaType = "all"; // all | recette | depense
  let comptaUnit = ""; // "" | L01…
  let comptaCustomFrom = "";
  let comptaCustomTo = "";
  let comptaEditingId = null; // null = list, string = edit form, "new" = create form
  const objectUrlCache = new Map(); // mediaId -> objectURL

  // ——— Helpers ———
  function padId(n) {
    return "L" + String(n).padStart(2, "0");
  }

  function emptyIntervention() {
    return { status: "non", date: "", note: "" };
  }

  function emptyReports() {
    const r = {};
    MEDIA_SECTIONS.forEach((s) => {
      r[s] = "";
    });
    return r;
  }

  function emptyMedia() {
    const m = {};
    MEDIA_SECTIONS.forEach((s) => {
      m[s] = [];
    });
    return m;
  }

  function emptyUnit(id) {
    const interventions = {};
    CORPS.forEach((corps) => {
      CATALOGUE[corps].items.forEach((item) => {
        interventions[item.code] = emptyIntervention();
      });
    });
    return { id, name: "", interventions, reports: emptyReports(), media: emptyMedia() };
  }

  function createDefaultState() {
    const units = {};
    for (let i = 1; i <= UNIT_COUNT; i++) {
      const id = padId(i);
      units[id] = emptyUnit(id);
    }
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      units,
      compta: { entries: [] },
    };
  }

  function uid() {
    return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ——— IndexedDB ———
  let idbPromise = null;

  function openMediaDB() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return idbPromise;
  }

  async function idbPut(id, blob, meta) {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ id, blob, mime: meta && meta.mime, type: meta && meta.type });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGet(id) {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbDelete(id) {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function revokeObjectUrl(id) {
    const url = objectUrlCache.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrlCache.delete(id);
    }
  }

  async function getMediaObjectUrl(id) {
    if (objectUrlCache.has(id)) return objectUrlCache.get(id);
    const row = await idbGet(id);
    if (!row || !row.blob) return null;
    const url = URL.createObjectURL(row.blob);
    objectUrlCache.set(id, url);
    return url;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl).split(",");
    const mimeMatch = parts[0] && parts[0].match(/:(.*?);/);
    const mime = (mimeMatch && mimeMatch[1]) || "application/octet-stream";
    const bin = atob(parts[1] || "");
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // ——— Image compress ———
  function compressImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (w > MAX_IMAGE_WIDTH) {
            h = Math.round((h * MAX_IMAGE_WIDTH) / w);
            w = MAX_IMAGE_WIDTH;
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(url);
              if (!blob) {
                reject(new Error("Compression échouée"));
                return;
              }
              resolve(blob);
            },
            "image/jpeg",
            JPEG_QUALITY
          );
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Image illisible"));
      };
      img.src = url;
    });
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultState();
      const parsed = JSON.parse(raw);
      return migrateState(parsed);
    } catch (e) {
      console.warn("localStorage illisible, réinitialisation", e);
      return createDefaultState();
    }
  }

  function normalizeMediaItem(item) {
    if (!item || typeof item !== "object") return null;
    const id = typeof item.id === "string" ? item.id : uid();
    const type = item.type === "video" ? "video" : "image";
    return {
      id,
      type,
      mime: typeof item.mime === "string" ? item.mime : type === "video" ? "video/mp4" : "image/jpeg",
      caption: typeof item.caption === "string" ? item.caption.slice(0, MAX_CAPTION) : "",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      size: typeof item.size === "number" ? item.size : 0,
      // dataUrl only during import migration — stripped before save
      _dataUrl: typeof item.dataUrl === "string" ? item.dataUrl : null,
    };
  }

  function normalizeComptaEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const type = raw.type === "recette" ? "recette" : raw.type === "depense" ? "depense" : null;
    if (!type) return null;
    let amount = typeof raw.amount === "number" ? raw.amount : parseFloat(raw.amount);
    if (!Number.isFinite(amount) || amount < 0) return null;
    amount = Math.round(amount * 100) / 100;
    const category = COMPTA_CAT_MAP[raw.category] ? raw.category : "autre";
    const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 120) : "";
    if (!label) return null;
    let unitId = typeof raw.unitId === "string" ? raw.unitId.trim() : "";
    if (unitId && !/^L\d{2}$/.test(unitId)) unitId = "";
    const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
      ? raw.date
      : todayISOSafe();
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
      type,
      amount,
      label,
      category,
      date,
      unitId,
      note: typeof raw.note === "string" ? raw.note.trim().slice(0, 500) : "",
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    };
  }

  function todayISOSafe() {
    const d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function migrateState(data) {
    const base = createDefaultState();
    if (!data || !data.units) return base;
    const pendingBlobs = [];

    for (let i = 1; i <= UNIT_COUNT; i++) {
      const id = padId(i);
      const src = data.units[id];
      if (!src) continue;
      base.units[id].name = typeof src.name === "string" ? src.name : "";
      const interv = src.interventions || {};
      CORPS.forEach((corps) => {
        CATALOGUE[corps].items.forEach((item) => {
          const s = interv[item.code];
          if (!s) return;
          const status = ["non", "encours", "fait"].includes(s.status) ? s.status : "non";
          base.units[id].interventions[item.code] = {
            status,
            date: typeof s.date === "string" ? s.date : "",
            note: typeof s.note === "string" ? s.note : "",
          };
        });
      });

      // reports
      const reportsSrc = src.reports || {};
      MEDIA_SECTIONS.forEach((sec) => {
        if (typeof reportsSrc[sec] === "string") {
          base.units[id].reports[sec] = reportsSrc[sec].slice(0, MAX_REPORT);
        }
      });

      // media: prefer src.media, fall back to src.photos (legacy dataUrl)
      const mediaSrc = src.media || src.photos || {};
      MEDIA_SECTIONS.forEach((sec) => {
        const list = Array.isArray(mediaSrc[sec]) ? mediaSrc[sec] : [];
        base.units[id].media[sec] = list
          .slice(0, MAX_MEDIA_PER_SECTION)
          .map(normalizeMediaItem)
          .filter(Boolean)
          .map((m) => {
            if (m._dataUrl) {
              pendingBlobs.push({ id: m.id, dataUrl: m._dataUrl, mime: m.mime, type: m.type });
            }
            const { _dataUrl, ...clean } = m;
            return clean;
          });
      });
    }
    base.updatedAt = data.updatedAt || base.updatedAt;

    // compta
    base.compta = { entries: [] };
    const comptaSrc = (data.compta && Array.isArray(data.compta.entries))
      ? data.compta.entries
      : (Array.isArray(data.compta) ? data.compta : []);
    base.compta.entries = comptaSrc
      .map(normalizeComptaEntry)
      .filter(Boolean);

    // hydrate IndexedDB from embedded dataUrls (import / legacy)
    if (pendingBlobs.length) {
      Promise.all(
        pendingBlobs.map(async (p) => {
          try {
            const blob = dataUrlToBlob(p.dataUrl);
            await idbPut(p.id, blob, { mime: p.mime, type: p.type });
          } catch (e) {
            console.warn("Import média échoué", p.id, e);
          }
        })
      ).catch(() => {});
    }

    return base;
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      const msg = e && (e.name === "QuotaExceededError" || e.code === 22)
        ? "Quota localStorage dépassé — médiatheque trop lourde"
        : "Erreur sauvegarde localStorage";
      toast(msg);
      console.error(e);
      throw e;
    }
  }

  function unitStats(unit) {
    const byCorps = {};
    let done = 0;
    let total = 0;
    CORPS.forEach((corps) => {
      const items = CATALOGUE[corps].items;
      let cDone = 0;
      items.forEach((item) => {
        total++;
        if (unit.interventions[item.code].status === "fait") {
          done++;
          cDone++;
        }
      });
      byCorps[corps] = { done: cDone, total: items.length, pct: Math.round((cDone / items.length) * 100) };
    });
    return {
      done,
      total,
      pct: total ? Math.round((done / total) * 100) : 0,
      byCorps,
      complete: done === total,
      started: done > 0 || Object.values(unit.interventions).some((i) => i.status === "encours"),
    };
  }

  function globalStats() {
    let doneInterv = 0;
    let totalInterv = UNIT_COUNT * TOTAL_ITEMS;
    const byCorps = {};
    CORPS.forEach((corps) => {
      byCorps[corps] = { done: 0, total: UNIT_COUNT * CATALOGUE[corps].items.length };
    });
    let unitsComplete = 0;
    let unitsStarted = 0;
    let unitsEmpty = 0;

    for (let i = 1; i <= UNIT_COUNT; i++) {
      const id = padId(i);
      const st = unitStats(state.units[id]);
      doneInterv += st.done;
      CORPS.forEach((corps) => {
        byCorps[corps].done += st.byCorps[corps].done;
      });
      if (st.complete) unitsComplete++;
      else if (st.started || st.done > 0) unitsStarted++;
      else unitsEmpty++;
    }

    CORPS.forEach((corps) => {
      byCorps[corps].pct = Math.round((byCorps[corps].done / byCorps[corps].total) * 100);
    });

    return {
      doneInterv,
      totalInterv,
      pct: Math.round((doneInterv / totalInterv) * 100),
      byCorps,
      unitsComplete,
      unitsStarted,
      unitsEmpty,
    };
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.remove("hidden", "show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.classList.add("hidden");
      el.classList.remove("show");
    }, 2800);
  }

  function formatBytes(n) {
    if (!n || n < 1024) return (n || 0) + " o";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " Ko";
    return (n / (1024 * 1024)).toFixed(1) + " Mo";
  }

  // ——— DOM refs ———
  const $app = document.getElementById("app");
  const $title = document.getElementById("page-title");
  const $subtitle = document.getElementById("page-subtitle");
  const $btnBack = document.getElementById("btn-back");
  const $btnMenu = document.getElementById("btn-menu");
  const $nav = document.getElementById("main-nav");
  const $importFile = document.getElementById("import-file");

  // ——— Render ———
  function setHeader(title, subtitle, showBack, opts) {
    opts = opts || {};
    $title.textContent = title;
    $subtitle.textContent = subtitle || "";
    $subtitle.classList.toggle("brand-slogan", !!opts.brandSlogan);
    $btnBack.classList.toggle("hidden", !showBack);
    document.querySelectorAll(".nav-link[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === currentView || (currentView === "detail" && btn.dataset.view === "home"));
    });
  }

  function badgeClassForPct(pct) {
    if (pct === 100) return "done";
    if (pct > 0) return "partial";
    return "empty";
  }

  function renderHome() {
    clearFabHost();
    currentView = "home";
    setHeader("Suivi Rotation", "Le coup de main qu'il vous faut", false, { brandSlogan: true });
    const g = globalStats();

    let unitsHtml = "";
    let shown = 0;
    for (let i = 1; i <= UNIT_COUNT; i++) {
      const id = padId(i);
      const unit = state.units[id];
      const st = unitStats(unit);
      const name = (unit.name || "").trim();
      const q = searchQuery.trim().toLowerCase();

      if (q) {
        const hay = (id + " " + name).toLowerCase();
        if (!hay.includes(q)) continue;
      }
      if (filter === "done" && !st.complete) continue;
      if (filter === "partial" && (st.complete || (!st.started && st.done === 0))) continue;
      if (filter === "empty" && (st.done > 0 || st.started)) continue;

      shown++;
      const badges = CORPS.map((corps) => {
        const c = st.byCorps[corps];
        const cat = CATALOGUE[corps];
        return `<span class="badge ${cat.badge}">${cat.short} ${c.done}/${c.total}</span>`;
      }).join("");

      unitsHtml += `
        <button type="button" class="logement-card neon-corner" data-unit="${id}" aria-label="${id}${name ? " — " + escapeHtml(name) : ""}, ${st.pct}%">
          <div class="card-top">
            <div>
              <span class="card-id">${id}</span>
              ${name ? `<span class="card-name">${escapeHtml(name)}</span>` : ""}
            </div>
            <span class="card-pct">${st.pct}%</span>
          </div>
          <div class="card-progress"><span style="width:${st.pct}%"></span></div>
          <div class="card-badges">${badges}</div>
        </button>`;
    }

    if (!shown) {
      unitsHtml = `<div class="empty-state">Aucun logement ne correspond au filtre.</div>`;
    }

    $app.innerHTML = `
      <div class="global-bar neon-corner">
        <div class="label-row">
          <span>Avancement global</span>
          <span class="pct">${g.pct}%</span>
        </div>
        <div class="progress"><span style="width:${g.pct}%"></span></div>
        <div class="corps-row">
          ${CORPS.map((corps) => {
            const c = g.byCorps[corps];
            const cat = CATALOGUE[corps];
            return `<span class="badge ${cat.badge}">${cat.label} ${c.pct}%</span>`;
          }).join("")}
          <span class="badge done">${g.unitsComplete} / 60 terminés</span>
        </div>
      </div>

      <div class="toolbar">
        <div class="search-wrap">
          <input type="search" id="search" placeholder="Rechercher L01, nom…" value="${escapeHtml(searchQuery)}" autocomplete="off" />
        </div>
        <div class="filter-chips">
          <button type="button" class="chip ${filter === "all" ? "active" : ""}" data-filter="all">Tous</button>
          <button type="button" class="chip ${filter === "partial" ? "active" : ""}" data-filter="partial">En cours</button>
          <button type="button" class="chip ${filter === "done" ? "active" : ""}" data-filter="done">Terminés</button>
          <button type="button" class="chip ${filter === "empty" ? "active" : ""}" data-filter="empty">À faire</button>
        </div>
      </div>

      <div class="logement-list">${unitsHtml}</div>
    `;

    $app.querySelectorAll(".logement-card").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.dataset.unit));
    });

    const search = document.getElementById("search");
    search.addEventListener("input", () => {
      searchQuery = search.value;
      renderHome();
      const s = document.getElementById("search");
      if (s) {
        s.focus();
        const len = s.value.length;
        s.setSelectionRange(len, len);
      }
    });

    $app.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filter = btn.dataset.filter;
        renderHome();
      });
    });
  }

  function openDetail(unitId) {
    currentUnit = unitId;
    currentView = "detail";
    closeMenu();
    renderDetail();
    window.scrollTo(0, 0);
  }

  function renderDocBlock(unit, sectionKey) {
    const meta = SECTION_META[sectionKey];
    const report = (unit.reports && unit.reports[sectionKey]) || "";
    const media = (unit.media && unit.media[sectionKey]) || [];
    const count = media.length;
    const full = count >= MAX_MEDIA_PER_SECTION;

    const thumbs = media
      .map((m) => {
        const isVideo = m.type === "video";
        return `
          <div class="media-thumb" data-media-id="${escapeHtml(m.id)}" data-section="${sectionKey}">
            <button type="button" class="media-preview" data-action="open" data-media-id="${escapeHtml(m.id)}" data-section="${sectionKey}" aria-label="Agrandir">
              <span class="media-placeholder ${isVideo ? "is-video" : "is-image"}" data-load-id="${escapeHtml(m.id)}">
                ${isVideo ? '<span class="media-play">▶</span>' : '<span class="media-cam">🖼</span>'}
              </span>
              ${isVideo ? '<span class="media-badge-type">Vidéo</span>' : ""}
            </button>
            <input type="text" class="media-caption" data-media-id="${escapeHtml(m.id)}" data-section="${sectionKey}" value="${escapeHtml(m.caption || "")}" placeholder="Légende…" maxlength="${MAX_CAPTION}" />
            <button type="button" class="media-delete" data-action="delete" data-media-id="${escapeHtml(m.id)}" data-section="${sectionKey}" aria-label="Supprimer">×</button>
          </div>`;
      })
      .join("");

    return `
      <div class="doc-block" data-doc-section="${sectionKey}">
        <div class="doc-header">
          <h3 class="doc-title"><span class="dot ${meta.badge}"></span> Documentation — ${escapeHtml(meta.label)}</h3>
          <span class="doc-count">${count}/${MAX_MEDIA_PER_SECTION}</span>
        </div>
        <div class="field report-field">
          <label for="report-${sectionKey}">Rapport écrit / constat</label>
          <textarea id="report-${sectionKey}" data-report-section="${sectionKey}" rows="3" maxlength="${MAX_REPORT}" placeholder="Notes de constat, dysfonctionnements, observations…">${escapeHtml(report)}</textarea>
        </div>
        <div class="media-toolbar">
          <button type="button" class="btn btn-primary btn-add-media" data-add-section="${sectionKey}" ${full ? "disabled" : ""}>
            ${full ? "Galerie pleine" : "Ajouter photo / vidéo"}
          </button>
          <input type="file" class="hidden media-file-input" data-section="${sectionKey}" accept="image/*,video/*" capture="environment" />
        </div>
        <div class="media-grid">${thumbs || '<p class="media-empty">Aucune photo ni vidéo pour cette partie.</p>'}</div>
      </div>`;
  }

  function renderDetail() {
    clearFabHost();
    const unit = state.units[currentUnit];
    if (!unit) {
      renderHome();
      return;
    }
    if (!unit.reports) unit.reports = emptyReports();
    if (!unit.media) unit.media = emptyMedia();

    const st = unitStats(unit);
    const name = (unit.name || "").trim();
    setHeader(
      currentUnit + (name ? " — " + name : ""),
      st.pct + "% · " + st.done + "/" + st.total + " interventions",
      true
    );

    let sections = "";
    // Logement-level documentation first
    sections += `
      <section class="section neon-panel section-logement" id="sec-logement">
        <div class="section-header">
          <h2 class="section-title"><span class="dot logement"></span> Logement (général)</h2>
        </div>
        ${renderDocBlock(unit, "logement")}
      </section>`;

    CORPS.forEach((corps) => {
      const cat = CATALOGUE[corps];
      const cs = st.byCorps[corps];
      let items = "";
      cat.items.forEach((item) => {
        const data = unit.interventions[item.code];
        const status = data.status || "non";
        items += `
          <article class="intervention ${status}" data-code="${item.code}">
            <div class="interv-top">
              <div>
                <div class="interv-code">${item.code}</div>
                <p class="interv-label">${escapeHtml(item.label)}</p>
              </div>
            </div>
            <div class="status-group" role="group" aria-label="Statut ${item.code}">
              ${["non", "encours", "fait"]
                .map(
                  (s) =>
                    `<button type="button" class="status-btn ${s} ${status === s ? "active" : ""}" data-code="${item.code}" data-status="${s}">${STATUS[s].label}</button>`
                )
                .join("")}
            </div>
            <div class="extra-fields">
              <div class="field">
                <label for="date-${item.code}">Date</label>
                <input type="date" id="date-${item.code}" data-code="${item.code}" data-field="date" value="${escapeHtml(data.date || "")}" />
              </div>
              <div class="field">
                <label for="note-${item.code}">Note / intervenant</label>
                <input type="text" id="note-${item.code}" data-code="${item.code}" data-field="note" value="${escapeHtml(data.note || "")}" placeholder="Nom, observation…" maxlength="200" />
              </div>
            </div>
          </article>`;
      });

      sections += `
        <section class="section neon-panel" id="sec-${corps}">
          <div class="section-header">
            <h2 class="section-title"><span class="dot ${cat.badge}"></span> ${cat.label}</h2>
            <span class="section-pct">${cs.done}/${cs.total} · ${cs.pct}%</span>
          </div>
          ${items}
          ${renderDocBlock(unit, corps)}
        </section>`;
    });

    $app.innerHTML = `
      <div class="detail-meta neon-corner">
        <div class="label-row" style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.5rem;">
          <strong>${currentUnit}</strong>
          <span class="badge ${badgeClassForPct(st.pct)}">${st.pct}%</span>
        </div>
        <div class="progress"><span style="width:${st.pct}%"></span></div>
        <div class="corps-row">
          ${CORPS.map((corps) => {
            const c = st.byCorps[corps];
            const cat = CATALOGUE[corps];
            return `<span class="badge ${cat.badge}">${cat.short} ${c.done}/${c.total}</span>`;
          }).join("")}
        </div>
        <div class="rename-row">
          <input type="text" id="unit-name" value="${escapeHtml(unit.name || "")}" placeholder="Nom / étiquette du logement (optionnel)" maxlength="80" />
          <button type="button" class="btn btn-ghost" id="btn-save-name">OK</button>
        </div>
      </div>
      ${sections}
    `;

    bindDetailEvents(unit);
    hydrateMediaThumbs(unit);
  }

  function bindDetailEvents(unit) {
    $app.querySelectorAll(".status-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.dataset.code;
        const status = btn.dataset.status;
        unit.interventions[code].status = status;
        if (status === "fait" && !unit.interventions[code].date) {
          unit.interventions[code].date = todayISO();
        }
        saveState();
        renderDetail();
      });
    });

    $app.querySelectorAll("[data-field]").forEach((input) => {
      input.addEventListener("change", () => {
        const code = input.dataset.code;
        const field = input.dataset.field;
        unit.interventions[code][field] = input.value;
        saveState();
      });
      if (input.dataset.field === "note") {
        input.addEventListener("blur", () => {
          const code = input.dataset.code;
          unit.interventions[code].note = input.value;
          saveState();
        });
      }
    });

    document.getElementById("btn-save-name").addEventListener("click", saveUnitName);
    document.getElementById("unit-name").addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveUnitName();
    });

    $app.querySelectorAll("[data-report-section]").forEach((ta) => {
      const saveReport = () => {
        const sec = ta.dataset.reportSection;
        unit.reports[sec] = ta.value.slice(0, MAX_REPORT);
        try {
          saveState();
        } catch (_) {}
      };
      ta.addEventListener("change", saveReport);
      ta.addEventListener("blur", saveReport);
    });

    $app.querySelectorAll("[data-add-section]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = btn.dataset.addSection;
        const input = $app.querySelector(`.media-file-input[data-section="${sec}"]`);
        if (input) input.click();
      });
    });

    $app.querySelectorAll(".media-file-input").forEach((input) => {
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        const sec = input.dataset.section;
        input.value = "";
        if (file) await addMediaFile(unit, sec, file);
      });
    });

    $app.querySelectorAll(".media-caption").forEach((input) => {
      const saveCap = () => {
        const mid = input.dataset.mediaId;
        const sec = input.dataset.section;
        const list = unit.media[sec] || [];
        const item = list.find((m) => m.id === mid);
        if (item) {
          item.caption = input.value.slice(0, MAX_CAPTION);
          try {
            saveState();
          } catch (_) {}
        }
      };
      input.addEventListener("change", saveCap);
      input.addEventListener("blur", saveCap);
    });

    $app.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const mid = btn.dataset.mediaId;
        const sec = btn.dataset.section;
        const ok = window.confirm("Supprimer ce média ?");
        if (!ok) return;
        await deleteMedia(unit, sec, mid);
      });
    });

    $app.querySelectorAll('[data-action="open"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        openLightbox(unit, btn.dataset.section, btn.dataset.mediaId);
      });
    });
  }

  async function hydrateMediaThumbs(unit) {
    const ids = [];
    MEDIA_SECTIONS.forEach((sec) => {
      (unit.media[sec] || []).forEach((m) => ids.push(m));
    });
    for (const m of ids) {
      const el = $app.querySelector(`[data-load-id="${m.id}"]`);
      if (!el) continue;
      try {
        const url = await getMediaObjectUrl(m.id);
        if (!url) continue;
        if (m.type === "video") {
          el.innerHTML = `<video src="${url}" muted playsinline preload="metadata"></video><span class="media-play">▶</span>`;
        } else {
          el.innerHTML = `<img src="${url}" alt="" loading="lazy" />`;
        }
        el.classList.add("loaded");
      } catch (_) {}
    }
  }

  async function addMediaFile(unit, section, file) {
    if (!unit.media[section]) unit.media[section] = [];
    if (unit.media[section].length >= MAX_MEDIA_PER_SECTION) {
      toast("Galerie pleine (max " + MAX_MEDIA_PER_SECTION + " médias)");
      return;
    }

    const isVideo = (file.type || "").startsWith("video/");
    const isImage = (file.type || "").startsWith("image/") || (!file.type && /\.(jpe?g|png|gif|webp|heic)$/i.test(file.name || ""));

    if (!isVideo && !isImage) {
      toast("Format non supporté (photo ou vidéo)");
      return;
    }

    toast(isVideo ? "Enregistrement vidéo…" : "Compression photo…");

    try {
      let blob;
      let mime;
      let type;

      if (isVideo) {
        if (file.size > MAX_VIDEO_BYTES) {
          toast("Vidéo trop lourde (max " + formatBytes(MAX_VIDEO_BYTES) + ")");
          return;
        }
        blob = file;
        mime = file.type || "video/mp4";
        type = "video";
      } else {
        blob = await compressImageFile(file);
        mime = "image/jpeg";
        type = "image";
      }

      const id = uid();
      await idbPut(id, blob, { mime, type });

      unit.media[section].push({
        id,
        type,
        mime,
        caption: "",
        createdAt: new Date().toISOString(),
        size: blob.size,
      });

      try {
        saveState();
      } catch (_) {
        // rollback
        unit.media[section] = unit.media[section].filter((m) => m.id !== id);
        await idbDelete(id);
        return;
      }

      toast(type === "video" ? "Vidéo ajoutée" : "Photo ajoutée");
      renderDetail();
    } catch (e) {
      console.error(e);
      toast(e && e.message ? e.message : "Échec ajout média");
    }
  }

  async function deleteMedia(unit, section, mediaId) {
    unit.media[section] = (unit.media[section] || []).filter((m) => m.id !== mediaId);
    revokeObjectUrl(mediaId);
    try {
      await idbDelete(mediaId);
    } catch (_) {}
    try {
      saveState();
    } catch (_) {}
    toast("Média supprimé");
    renderDetail();
  }

  async function openLightbox(unit, section, mediaId) {
    const item = (unit.media[section] || []).find((m) => m.id === mediaId);
    if (!item) return;
    const url = await getMediaObjectUrl(mediaId);
    if (!url) {
      toast("Média introuvable");
      return;
    }

    closeLightbox();
    const overlay = document.createElement("div");
    overlay.id = "lightbox";
    overlay.className = "lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const body =
      item.type === "video"
        ? `<video src="${url}" controls playsinline autoplay class="lightbox-media"></video>`
        : `<img src="${url}" alt="${escapeHtml(item.caption || "")}" class="lightbox-media" />`;
    overlay.innerHTML = `
      <div class="lightbox-inner">
        <button type="button" class="lightbox-close" aria-label="Fermer">×</button>
        ${body}
        ${item.caption ? `<p class="lightbox-caption">${escapeHtml(item.caption)}</p>` : ""}
        <p class="lightbox-meta">${item.type === "video" ? "Vidéo" : "Photo"} · ${formatBytes(item.size)}</p>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => closeLightbox();
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.classList.contains("lightbox-close")) close();
    });
    document.addEventListener("keydown", lightboxKeyHandler);
  }

  function lightboxKeyHandler(e) {
    if (e.key === "Escape") closeLightbox();
  }

  function closeLightbox() {
    const el = document.getElementById("lightbox");
    if (el) el.remove();
    document.removeEventListener("keydown", lightboxKeyHandler);
  }

  function saveUnitName() {
    const input = document.getElementById("unit-name");
    if (!input || !currentUnit) return;
    state.units[currentUnit].name = input.value.trim();
    saveState();
    toast("Nom enregistré");
    renderDetail();
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // ——— Comptabilité ———
  function formatMoney(n) {
    const v = Number(n) || 0;
    return v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  function formatDateFR(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
    const [y, m, d] = iso.split("-");
    return d + "/" + m + "/" + y;
  }

  function monthBounds(ref) {
    const d = ref ? new Date(ref) : new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    const from = y + "-" + String(m + 1).padStart(2, "0") + "-01";
    const last = new Date(y, m + 1, 0).getDate();
    const to = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(last).padStart(2, "0");
    return { from, to };
  }

  function clearFabHost() {
    const host = document.getElementById("fab-host");
    if (host) host.innerHTML = "";
  }

  function mountComptaFab() {
    const host = document.getElementById("fab-host");
    if (!host) return;
    host.innerHTML = `
      <button type="button" class="fab-compta" id="compta-add" aria-label="Ajouter une ligne">
        <span class="fab-plus">+</span>
        <span class="fab-label">Ajouter</span>
      </button>`;
    document.getElementById("compta-add").addEventListener("click", () => {
      comptaEditingId = "new";
      renderCompta();
    });
  }

  function ensureCompta() {
    if (!state.compta || !Array.isArray(state.compta.entries)) {
      state.compta = { entries: [] };
    }
  }

  function filteredComptaEntries() {
    ensureCompta();
    let from = "";
    let to = "";
    if (comptaPeriod === "month") {
      const b = monthBounds();
      from = b.from;
      to = b.to;
    } else if (comptaPeriod === "custom") {
      from = comptaCustomFrom || "";
      to = comptaCustomTo || "";
    }
    return state.compta.entries
      .filter((e) => {
        if (comptaType !== "all" && e.type !== comptaType) return false;
        if (comptaUnit && e.unitId !== comptaUnit) return false;
        if (from && e.date < from) return false;
        if (to && e.date > to) return false;
        return true;
      })
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1));
  }

  function comptaTotals(entries) {
    let recettes = 0;
    let depenses = 0;
    entries.forEach((e) => {
      if (e.type === "recette") recettes += e.amount;
      else depenses += e.amount;
    });
    return {
      recettes: Math.round(recettes * 100) / 100,
      depenses: Math.round(depenses * 100) / 100,
      solde: Math.round((recettes - depenses) * 100) / 100,
    };
  }

  function unitOptionsHtml(selected) {
    let opts = '<option value="">— Aucun —</option>';
    for (let i = 1; i <= UNIT_COUNT; i++) {
      const id = padId(i);
      const name = (state.units[id] && state.units[id].name) || "";
      const label = name ? id + " — " + name : id;
      opts +=
        '<option value="' +
        id +
        '"' +
        (selected === id ? " selected" : "") +
        ">" +
        escapeHtml(label) +
        "</option>";
    }
    return opts;
  }

  function categoryOptionsHtml(selected) {
    return COMPTA_CATEGORIES.map((c) => {
      return (
        '<option value="' +
        c.id +
        '"' +
        (selected === c.id ? " selected" : "") +
        ">" +
        escapeHtml(c.label) +
        "</option>"
      );
    }).join("");
  }

  function renderComptaForm(entry) {
    const isNew = !entry;
    const e = entry || {
      type: "depense",
      amount: "",
      label: "",
      category: "pieces",
      date: todayISO(),
      unitId: "",
      note: "",
    };
    return `
      <div class="compta-form-card neon-corner">
        <h3 class="compta-form-title">${isNew ? "Nouvelle ligne" : "Modifier la ligne"}</h3>
        <div class="field">
          <label>Type</label>
          <div class="status-group compta-type-group" role="group" aria-label="Type">
            <button type="button" class="status-btn ${e.type === "recette" ? "active" : ""}" data-ctype="recette">Recette</button>
            <button type="button" class="status-btn ${e.type === "depense" ? "active" : ""}" data-ctype="depense">Dépense</button>
          </div>
        </div>
        <div class="field">
          <label for="compta-amount">Montant (€)</label>
          <input type="number" id="compta-amount" inputmode="decimal" step="0.01" min="0" placeholder="0,00" value="${e.amount !== "" ? escapeHtml(String(e.amount)) : ""}" />
        </div>
        <div class="field">
          <label for="compta-label">Libellé</label>
          <input type="text" id="compta-label" maxlength="120" placeholder="Ex. : mitigeur cuisine L12" value="${escapeHtml(e.label)}" />
        </div>
        <div class="field">
          <label for="compta-category">Catégorie</label>
          <select id="compta-category">${categoryOptionsHtml(e.category)}</select>
        </div>
        <div class="field">
          <label for="compta-date">Date</label>
          <input type="date" id="compta-date" value="${escapeHtml(e.date || todayISO())}" />
        </div>
        <div class="field">
          <label for="compta-unit">Logement (optionnel)</label>
          <select id="compta-unit">${unitOptionsHtml(e.unitId || "")}</select>
        </div>
        <div class="field">
          <label for="compta-note">Note</label>
          <textarea id="compta-note" rows="2" maxlength="500" placeholder="Optionnel…">${escapeHtml(e.note || "")}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="compta-cancel">Annuler</button>
          <button type="button" class="btn btn-primary" id="compta-save">Enregistrer</button>
        </div>
      </div>
    `;
  }

  function bindComptaForm(existingId) {
    let selectedType = "depense";
    if (existingId) {
      const found = state.compta.entries.find((x) => x.id === existingId);
      if (found) selectedType = found.type;
    }
    const typeGroup = $app.querySelector(".compta-type-group");
    if (typeGroup) {
      typeGroup.querySelectorAll("[data-ctype]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedType = btn.dataset.ctype;
          typeGroup.querySelectorAll("[data-ctype]").forEach((b) => {
            b.classList.toggle("active", b.dataset.ctype === selectedType);
          });
        });
      });
    }

    document.getElementById("compta-cancel").addEventListener("click", () => {
      comptaEditingId = null;
      renderCompta();
    });

    document.getElementById("compta-save").addEventListener("click", () => {
      const amountRaw = document.getElementById("compta-amount").value;
      const amount = parseFloat(String(amountRaw).replace(",", "."));
      const label = document.getElementById("compta-label").value.trim();
      const category = document.getElementById("compta-category").value;
      const date = document.getElementById("compta-date").value;
      const unitId = document.getElementById("compta-unit").value;
      const note = document.getElementById("compta-note").value.trim();

      if (!label) {
        toast("Libellé obligatoire");
        return;
      }
      if (!Number.isFinite(amount) || amount < 0) {
        toast("Montant invalide");
        return;
      }
      if (!date) {
        toast("Date obligatoire");
        return;
      }

      ensureCompta();
      const payload = {
        id: existingId || uid(),
        type: selectedType,
        amount: Math.round(amount * 100) / 100,
        label: label.slice(0, 120),
        category: COMPTA_CAT_MAP[category] ? category : "autre",
        date,
        unitId: unitId || "",
        note: note.slice(0, 500),
        createdAt: new Date().toISOString(),
      };

      if (existingId) {
        const idx = state.compta.entries.findIndex((x) => x.id === existingId);
        if (idx >= 0) {
          payload.createdAt = state.compta.entries[idx].createdAt || payload.createdAt;
          state.compta.entries[idx] = payload;
        } else {
          state.compta.entries.push(payload);
        }
        toast("Ligne modifiée");
      } else {
        state.compta.entries.push(payload);
        toast("Ligne ajoutée");
      }
      saveState();
      comptaEditingId = null;
      renderCompta();
    });
  }

  function renderCompta() {
    currentView = "compta";
    currentUnit = null;
    setHeader("Comptabilité", "Recettes & dépenses", false);
    ensureCompta();

    if (comptaEditingId === "new") {
      clearFabHost();
      $app.innerHTML = renderComptaForm(null);
      bindComptaForm(null);
      return;
    }
    if (comptaEditingId && comptaEditingId !== "new") {
      const entry = state.compta.entries.find((x) => x.id === comptaEditingId);
      if (!entry) {
        comptaEditingId = null;
      } else {
        clearFabHost();
        $app.innerHTML = renderComptaForm(entry);
        bindComptaForm(entry.id);
        return;
      }
    }

    const entries = filteredComptaEntries();
    const totals = comptaTotals(entries);
    const soldeClass = totals.solde > 0 ? "positive" : totals.solde < 0 ? "negative" : "neutral";

    const periodLabel =
      comptaPeriod === "month"
        ? "Ce mois"
        : comptaPeriod === "all"
          ? "Tout"
          : "Période";

    let listHtml = "";
    if (!entries.length) {
      listHtml = `<div class="empty-state">Aucune ligne pour ce filtre.<br/>Appuyez sur <strong>Ajouter</strong> pour enregistrer une recette ou une dépense.</div>`;
    } else {
      listHtml = entries
        .map((e) => {
          const sign = e.type === "recette" ? "+" : "−";
          const amtClass = e.type === "recette" ? "recette" : "depense";
          const catLabel = COMPTA_CAT_MAP[e.category] || e.category;
          const unitBadge = e.unitId
            ? `<span class="badge logement">${escapeHtml(e.unitId)}</span>`
            : "";
          const noteHtml = e.note
            ? `<p class="compta-note">${escapeHtml(e.note)}</p>`
            : "";
          return `
            <article class="compta-card neon-corner ${amtClass}" data-id="${escapeHtml(e.id)}">
              <div class="card-top">
                <div>
                  <span class="compta-date">${formatDateFR(e.date)}</span>
                  <p class="compta-label">${escapeHtml(e.label)}</p>
                </div>
                <span class="compta-amount ${amtClass}">${sign}${formatMoney(e.amount)}</span>
              </div>
              <div class="card-badges">
                <span class="badge">${escapeHtml(catLabel)}</span>
                <span class="badge ${e.type === "recette" ? "done" : ""}">${e.type === "recette" ? "Recette" : "Dépense"}</span>
                ${unitBadge}
              </div>
              ${noteHtml}
              <div class="compta-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-edit="${escapeHtml(e.id)}">Modifier</button>
                <button type="button" class="btn btn-danger-ghost btn-sm" data-del="${escapeHtml(e.id)}">Supprimer</button>
              </div>
            </article>`;
        })
        .join("");
    }

    const customRow =
      comptaPeriod === "custom"
        ? `
      <div class="compta-custom-dates">
        <div class="field">
          <label for="compta-from">Du</label>
          <input type="date" id="compta-from" value="${escapeHtml(comptaCustomFrom)}" />
        </div>
        <div class="field">
          <label for="compta-to">Au</label>
          <input type="date" id="compta-to" value="${escapeHtml(comptaCustomTo)}" />
        </div>
      </div>`
        : "";

    $app.innerHTML = `
      <div class="compta-summary">
        <div class="stat-card neon-corner compta-recettes">
          <h3>Total recettes</h3>
          <div class="stat-value">${formatMoney(totals.recettes)}</div>
          <div class="stat-sub">${periodLabel}</div>
        </div>
        <div class="stat-card neon-corner compta-depenses">
          <h3>Total dépenses</h3>
          <div class="stat-value">${formatMoney(totals.depenses)}</div>
          <div class="stat-sub">${periodLabel}</div>
        </div>
        <div class="stat-card neon-corner full compta-solde ${soldeClass}">
          <h3>Solde</h3>
          <div class="stat-value">${formatMoney(totals.solde)}</div>
          <div class="stat-sub">${entries.length} ligne${entries.length !== 1 ? "s" : ""}</div>
        </div>
      </div>

      <div class="toolbar compta-toolbar">
        <div class="filter-chips" role="group" aria-label="Période">
          <button type="button" class="chip ${comptaPeriod === "month" ? "active" : ""}" data-cperiod="month">Ce mois</button>
          <button type="button" class="chip ${comptaPeriod === "all" ? "active" : ""}" data-cperiod="all">Tout</button>
          <button type="button" class="chip ${comptaPeriod === "custom" ? "active" : ""}" data-cperiod="custom">Période</button>
        </div>
        <div class="filter-chips" role="group" aria-label="Type">
          <button type="button" class="chip ${comptaType === "all" ? "active" : ""}" data-ctype-filter="all">Tous</button>
          <button type="button" class="chip ${comptaType === "recette" ? "active" : ""}" data-ctype-filter="recette">Recettes</button>
          <button type="button" class="chip ${comptaType === "depense" ? "active" : ""}" data-ctype-filter="depense">Dépenses</button>
        </div>
        <div class="field compta-unit-filter">
          <label for="compta-filter-unit" class="sr-only">Logement</label>
          <select id="compta-filter-unit">
            <option value="">Tous les logements</option>
            ${Array.from({ length: UNIT_COUNT }, (_, i) => {
              const id = padId(i + 1);
              return `<option value="${id}"${comptaUnit === id ? " selected" : ""}>${id}</option>`;
            }).join("")}
          </select>
        </div>
      </div>
      ${customRow}

      <button type="button" class="btn btn-primary btn-compta-add-top" id="compta-add-top">+ Ajouter une ligne</button>

      <div class="compta-list">${listHtml}</div>
    `;

    mountComptaFab();
    document.getElementById("compta-add-top").addEventListener("click", () => {
      comptaEditingId = "new";
      renderCompta();
    });

    $app.querySelectorAll("[data-cperiod]").forEach((btn) => {
      btn.addEventListener("click", () => {
        comptaPeriod = btn.dataset.cperiod;
        renderCompta();
      });
    });

    $app.querySelectorAll("[data-ctype-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        comptaType = btn.dataset.ctypeFilter;
        renderCompta();
      });
    });

    const unitFilter = document.getElementById("compta-filter-unit");
    if (unitFilter) {
      unitFilter.addEventListener("change", () => {
        comptaUnit = unitFilter.value;
        renderCompta();
      });
    }

    const fromEl = document.getElementById("compta-from");
    const toEl = document.getElementById("compta-to");
    if (fromEl) {
      fromEl.addEventListener("change", () => {
        comptaCustomFrom = fromEl.value;
        renderCompta();
      });
    }
    if (toEl) {
      toEl.addEventListener("change", () => {
        comptaCustomTo = toEl.value;
        renderCompta();
      });
    }

    $app.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        comptaEditingId = btn.dataset.edit;
        renderCompta();
      });
    });

    $app.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.del;
        const entry = state.compta.entries.find((x) => x.id === id);
        const label = entry ? entry.label : "cette ligne";
        if (!window.confirm("Supprimer « " + label + " » ?")) return;
        state.compta.entries = state.compta.entries.filter((x) => x.id !== id);
        saveState();
        toast("Ligne supprimée");
        renderCompta();
      });
    });
  }

  function renderSynthese() {
    clearFabHost();
    currentView = "synthese";
    currentUnit = null;
    setHeader("Synthèse globale", "Vue d'ensemble des interventions", false);
    const g = globalStats();

    $app.innerHTML = `
      <div class="synth-grid">
        <div class="stat-card full neon-corner">
          <h3>Avancement total</h3>
          <div class="stat-value">${g.pct}%</div>
          <div class="stat-sub">${g.doneInterv} / ${g.totalInterv} interventions réalisées</div>
          <div class="progress" style="margin-top:0.75rem;"><span style="width:${g.pct}%"></span></div>
        </div>
        <div class="stat-card done neon-corner">
          <h3>Logements 100 %</h3>
          <div class="stat-value">${g.unitsComplete}</div>
          <div class="stat-sub">sur 60 logements</div>
        </div>
        <div class="stat-card neon-corner">
          <h3>En cours / à faire</h3>
          <div class="stat-value">${g.unitsStarted + g.unitsEmpty}</div>
          <div class="stat-sub">${g.unitsStarted} démarrés · ${g.unitsEmpty} non commencés</div>
        </div>
        ${CORPS.map((corps) => {
          const c = g.byCorps[corps];
          const cat = CATALOGUE[corps];
          return `
            <div class="stat-card neon-corner ${cat.badge}">
              <h3>${cat.label}</h3>
              <div class="stat-value">${c.pct}%</div>
              <div class="stat-sub">${c.done} / ${c.total} · ${CATALOGUE[corps].items.length} points × 60</div>
              <div class="progress" style="margin-top:0.65rem;"><span style="width:${c.pct}%;background:currentColor;"></span></div>
            </div>`;
        }).join("")}
      </div>
      <p class="legend">Données stockées localement sur cet appareil (localStorage + IndexedDB pour photos/vidéos). Pensez à exporter régulièrement.</p>
      <div class="toolbar" style="margin-top:1rem;">
        <button type="button" class="btn btn-primary" id="btn-go-home">Voir les logements</button>
      </div>
    `;

    document.getElementById("btn-go-home").addEventListener("click", () => {
      currentView = "home";
      renderHome();
    });
  }

  // ——— Import / Export / Reset ———
  async function buildExportPayload() {
    const clone = JSON.parse(JSON.stringify(state));
    for (let i = 1; i <= UNIT_COUNT; i++) {
      const id = padId(i);
      const unit = clone.units[id];
      if (!unit || !unit.media) continue;
      for (const sec of MEDIA_SECTIONS) {
        const list = unit.media[sec] || [];
        for (let j = 0; j < list.length; j++) {
          const m = list[j];
          try {
            const row = await idbGet(m.id);
            if (row && row.blob) {
              m.dataUrl = await blobToDataUrl(row.blob);
            }
          } catch (_) {}
        }
      }
    }
    return clone;
  }

  async function exportJSON() {
    closeMenu();
    toast("Préparation export (médias)…");
    try {
      const payload = await buildExportPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = todayISO();
      a.href = url;
      a.download = `suivi-rotation-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("Export téléchargé");
    } catch (e) {
      console.error(e);
      toast("Échec export");
    }
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.units) throw new Error("Format invalide");
        state = migrateState(parsed);
        saveState();
        toast("Import réussi");
        if (currentView === "detail" && currentUnit) renderDetail();
        else if (currentView === "synthese") renderSynthese();
        else if (currentView === "compta") renderCompta();
        else renderHome();
      } catch (e) {
        toast("Fichier JSON invalide");
        console.error(e);
      }
    };
    reader.readAsText(file);
  }

  async function clearAllMediaBlobs() {
    try {
      const db = await openMediaDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {}
    objectUrlCache.forEach((url) => URL.revokeObjectURL(url));
    objectUrlCache.clear();
  }

  function resetAll() {
    closeMenu();
    const ok = window.confirm(
      "Réinitialiser toutes les données ?\n\nLes 60 logements, interventions, rapports, médias et la comptabilité reviendront à zéro. Cette action est irréversible (sauf si vous avez un export JSON)."
    );
    if (!ok) return;
    clearAllMediaBlobs().then(() => {
      state = createDefaultState();
      saveState();
      searchQuery = "";
      filter = "all";
      currentUnit = null;
      comptaPeriod = "month";
      comptaType = "all";
      comptaUnit = "";
      comptaCustomFrom = "";
      comptaCustomTo = "";
      comptaEditingId = null;
      toast("Données réinitialisées");
      renderHome();
    });
  }

  function closeMenu() {
    $nav.classList.add("hidden");
    $btnMenu.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    const open = $nav.classList.contains("hidden");
    $nav.classList.toggle("hidden", !open);
    $btnMenu.setAttribute("aria-expanded", open ? "true" : "false");
  }

  // ——— Events ———
  $btnBack.addEventListener("click", () => {
    closeLightbox();
    currentUnit = null;
    currentView = "home";
    renderHome();
  });

  $btnMenu.addEventListener("click", toggleMenu);

  document.querySelectorAll(".nav-link[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeMenu();
      closeLightbox();
      const view = btn.dataset.view;
      if (view === "home") {
        currentUnit = null;
        comptaEditingId = null;
        renderHome();
      } else if (view === "synthese") {
        comptaEditingId = null;
        renderSynthese();
      } else if (view === "compta") {
        comptaEditingId = null;
        renderCompta();
      }
    });
  });

  document.getElementById("btn-export").addEventListener("click", () => {
    exportJSON();
  });
  document.getElementById("btn-import").addEventListener("click", () => {
    closeMenu();
    $importFile.click();
  });
  document.getElementById("btn-reset").addEventListener("click", resetAll);

  $importFile.addEventListener("change", () => {
    const file = $importFile.files && $importFile.files[0];
    $importFile.value = "";
    if (file) importJSON(file);
  });

  // ——— Boot ———
  state = loadState();
  openMediaDB().catch(() => {});
  renderHome();
})();
