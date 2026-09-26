/**
 * Suivi Rotation — interventions locatives (L01–L60)
 * Persistance : localStorage
 */
(function () {
  "use strict";

  const STORAGE_KEY = "suivi-rotation-v1";
  const UNIT_COUNT = 60;

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
  const TOTAL_ITEMS = CORPS.reduce((n, k) => n + CATALOGUE[k].items.length, 0); // 26

  const STATUS = {
    non: { id: "non", label: "Non" },
    encours: { id: "encours", label: "En cours" },
    fait: { id: "fait", label: "Fait" },
  };

  // ——— State ———
  let state = null;
  let currentView = "home"; // home | detail | synthese
  let currentUnit = null; // "L01" …
  let filter = "all"; // all | done | partial | empty
  let searchQuery = "";

  // ——— Helpers ———
  function padId(n) {
    return "L" + String(n).padStart(2, "0");
  }

  function emptyIntervention() {
    return { status: "non", date: "", note: "" };
  }

  function emptyUnit(id) {
    const interventions = {};
    CORPS.forEach((corps) => {
      CATALOGUE[corps].items.forEach((item) => {
        interventions[item.code] = emptyIntervention();
      });
    });
    return { id, name: "", interventions };
  }

  function createDefaultState() {
    const units = {};
    for (let i = 1; i <= UNIT_COUNT; i++) {
      const id = padId(i);
      units[id] = emptyUnit(id);
    }
    return { version: 1, updatedAt: new Date().toISOString(), units };
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

  function migrateState(data) {
    const base = createDefaultState();
    if (!data || !data.units) return base;
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
    }
    base.updatedAt = data.updatedAt || base.updatedAt;
    return base;
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("Erreur sauvegarde localStorage");
      console.error(e);
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
    }, 2400);
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
  function setHeader(title, subtitle, showBack) {
    $title.textContent = title;
    $subtitle.textContent = subtitle || "";
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
    setHeader("Suivi Rotation", "60 logements · tapotez pour détail", false);
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
        <button type="button" class="logement-card" data-unit="${id}" aria-label="${id}${name ? " — " + escapeHtml(name) : ""}, ${st.pct}%">
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
      <div class="global-bar">
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

  function renderDetail() {
    const unit = state.units[currentUnit];
    if (!unit) {
      renderHome();
      return;
    }
    const st = unitStats(unit);
    const name = (unit.name || "").trim();
    setHeader(
      currentUnit + (name ? " — " + name : ""),
      st.pct + "% · " + st.done + "/" + st.total + " interventions",
      true
    );

    let sections = "";
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
        <section class="section" id="sec-${corps}">
          <div class="section-header">
            <h2 class="section-title"><span class="dot ${cat.badge}"></span> ${cat.label}</h2>
            <span class="section-pct">${cs.done}/${cs.total} · ${cs.pct}%</span>
          </div>
          ${items}
        </section>`;
    });

    $app.innerHTML = `
      <div class="detail-meta">
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
        <div class="stat-card full">
          <h3>Avancement total</h3>
          <div class="stat-value">${g.pct}%</div>
          <div class="stat-sub">${g.doneInterv} / ${g.totalInterv} interventions réalisées</div>
          <div class="progress" style="margin-top:0.75rem;"><span style="width:${g.pct}%"></span></div>
        </div>
        <div class="stat-card done">
          <h3>Logements 100 %</h3>
          <div class="stat-value">${g.unitsComplete}</div>
          <div class="stat-sub">sur 60 logements</div>
        </div>
        <div class="stat-card">
          <h3>En cours / à faire</h3>
          <div class="stat-value">${g.unitsStarted + g.unitsEmpty}</div>
          <div class="stat-sub">${g.unitsStarted} démarrés · ${g.unitsEmpty} non commencés</div>
        </div>
        ${CORPS.map((corps) => {
          const c = g.byCorps[corps];
          const cat = CATALOGUE[corps];
          return `
            <div class="stat-card ${cat.badge}">
              <h3>${cat.label}</h3>
              <div class="stat-value">${c.pct}%</div>
              <div class="stat-sub">${c.done} / ${c.total} · ${CATALOGUE[corps].items.length} points × 60</div>
              <div class="progress" style="margin-top:0.65rem;"><span style="width:${c.pct}%;background:currentColor;"></span></div>
            </div>`;
        }).join("")}
      </div>
      <p class="legend">Données stockées localement sur cet appareil (localStorage). Pensez à exporter régulièrement.</p>
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
  function exportJSON() {
    closeMenu();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
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

  function resetAll() {
    closeMenu();
    const ok = window.confirm(
      "Réinitialiser toutes les données ?\n\nLes 60 logements et les 26 interventions reviendront à zéro. Cette action est irréversible (sauf si vous avez un export JSON)."
    );
    if (!ok) return;
    state = createDefaultState();
    saveState();
    searchQuery = "";
    filter = "all";
    currentUnit = null;
    toast("Données réinitialisées");
    renderHome();
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
    currentUnit = null;
    currentView = "home";
    renderHome();
  });

  $btnMenu.addEventListener("click", toggleMenu);

  document.querySelectorAll(".nav-link[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeMenu();
      const view = btn.dataset.view;
      if (view === "home") {
        currentUnit = null;
        renderHome();
      } else if (view === "synthese") {
        renderSynthese();
      }
    });
  });

  document.getElementById("btn-export").addEventListener("click", exportJSON);
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
  renderHome();
})();
