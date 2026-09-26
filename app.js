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

  // ——— State ———
  let state = null;
  let currentView = "home";
  let currentUnit = null;
  let filter = "all";
  let searchQuery = "";
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
    return { version: 1, updatedAt: new Date().toISOString(), units };
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

  function renderSynthese() {
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
      "Réinitialiser toutes les données ?\n\nLes 60 logements, interventions, rapports et médias reviendront à zéro. Cette action est irréversible (sauf si vous avez un export JSON)."
    );
    if (!ok) return;
    clearAllMediaBlobs().then(() => {
      state = createDefaultState();
      saveState();
      searchQuery = "";
      filter = "all";
      currentUnit = null;
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
        renderHome();
      } else if (view === "synthese") {
        renderSynthese();
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
