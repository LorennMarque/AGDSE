(() => {
  const socket = io({
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
  });

  const app = document.querySelector(".app");
  const els = {
    cells: document.getElementById("cells"),
    preview: document.getElementById("preview"),
    tree: document.getElementById("tree"),
    title: document.getElementById("title"),
    path: document.getElementById("path-label"),
    tabName: document.getElementById("tab-name"),
    name: document.getElementById("name"),
    roster: document.getElementById("roster"),
    cursors: document.getElementById("cursors"),
    folderInput: document.getElementById("folder-input"),
    btnUpload: document.getElementById("btn-upload"),
    btnNew: document.getElementById("btn-new"),
    btnAddEnd: document.getElementById("btn-add-end"),
    btnRestart: document.getElementById("btn-restart"),
    btnExplorer: document.getElementById("btn-explorer"),
    btnPackages: document.getElementById("btn-packages"),
    btnChatRail: document.getElementById("btn-chat-rail"),
    btnChatToggle: document.getElementById("btn-chat-toggle"),
    chatLog: document.getElementById("chat-log"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),
    activityUser: document.getElementById("activity-user"),
    statusKind: document.getElementById("status-kind"),
    statusLang: document.getElementById("status-lang"),
    pkgForm: document.getElementById("pkg-form"),
    pkgInput: document.getElementById("pkg-input"),
    pkgInstall: document.getElementById("pkg-install"),
    pkgLog: document.getElementById("pkg-log"),
    pkgList: document.getElementById("pkg-list"),
    pkgCatalog: document.getElementById("pkg-catalog"),
  };

  const DS_PACKAGES = [
    { name: "numpy", desc: "Arrays y álgebra numérica" },
    { name: "pandas", desc: "Tablas y análisis de datos" },
    { name: "matplotlib", desc: "Gráficos base" },
    { name: "seaborn", desc: "Visualización estadística" },
    { name: "scipy", desc: "Científico / optimización" },
    { name: "scikit-learn", desc: "Machine learning clásico" },
    { name: "statsmodels", desc: "Modelos estadísticos" },
    { name: "plotly", desc: "Gráficos interactivos" },
    { name: "polars", desc: "DataFrames rápidos" },
    { name: "pyarrow", desc: "Parquet / Arrow" },
    { name: "openpyxl", desc: "Excel .xlsx" },
    { name: "xlrd", desc: "Excel legacy" },
    { name: "requests", desc: "HTTP client" },
    { name: "beautifulsoup4", desc: "Parseo HTML" },
    { name: "lxml", desc: "XML/HTML rápido" },
    { name: "pillow", desc: "Imágenes" },
    { name: "sympy", desc: "Matemática simbólica" },
    { name: "networkx", desc: "Grafos y redes" },
    { name: "nltk", desc: "NLP clásico" },
    { name: "xgboost", desc: "Gradient boosting" },
    { name: "lightgbm", desc: "Boosting rápido" },
    { name: "joblib", desc: "Persistencia / parallel" },
    { name: "tqdm", desc: "Barras de progreso" },
  ];

  let installedMap = new Map();
  let installing = false;

  let me = null;
  let path = "";
  let viewMode = "notebook"; // notebook | csv
  let notebook = { title: "", cells: [] };
  let treeData = [];
  const peers = new Map();
  const sourceTimers = new Map();
  let applyingRemote = false;
  let titleTimer = null;
  let lastCursorSent = 0;

  const chatKey = "agdse-chat-collapsed";
  const explorerKey = "agdse-explorer-collapsed";
  const sideKey = "agdse-side-panel"; // explorer | packages

  function isMobile() {
    return window.matchMedia("(max-width: 980px)").matches;
  }

  function sideMode() {
    return localStorage.getItem(sideKey) === "packages" ? "packages" : "explorer";
  }

  function applyLayout() {
    const chatCollapsed = localStorage.getItem(chatKey) === "1";
    const explorerCollapsed = localStorage.getItem(explorerKey) === "1";
    const mode = sideMode();
    app.classList.toggle("chat-collapsed", chatCollapsed && !isMobile());
    app.classList.toggle("explorer-collapsed", explorerCollapsed && !isMobile());
    app.classList.toggle("side-packages", mode === "packages");
    els.btnChatToggle.setAttribute("aria-expanded", chatCollapsed ? "false" : "true");
    els.btnExplorer.classList.toggle("active", mode === "explorer" && (!explorerCollapsed || isMobile()));
    els.btnPackages.classList.toggle("active", mode === "packages" && (!explorerCollapsed || isMobile()));
    els.btnExplorer.setAttribute("aria-pressed", (mode === "explorer").toString());
    els.btnPackages.setAttribute("aria-pressed", (mode === "packages").toString());
    els.btnChatRail.classList.toggle("active", !chatCollapsed || app.classList.contains("show-chat"));
    els.btnChatRail.setAttribute("aria-pressed", (!chatCollapsed).toString());
  }

  applyLayout();

  function normalizePkgName(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
  }

  function renderPackageList(packages) {
    const items = packages || [];
    installedMap = new Map(items.map((p) => [normalizePkgName(p.name), p.version || ""]));
    els.pkgList.innerHTML = items
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (p) =>
          `<li><span>${escapeHtml(p.name)}</span><span class="ver">${escapeHtml(p.version)}</span></li>`
      )
      .join("");
    renderCatalog();
  }

  function renderCatalog() {
    if (!els.pkgCatalog) return;
    els.pkgCatalog.innerHTML = DS_PACKAGES.map((pkg) => {
      const installed = installedMap.has(normalizePkgName(pkg.name));
      const state = installed ? "OK" : "Install";
      return `<button type="button" class="pkg-card${installed ? " installed" : ""}" data-pkg="${escapeHtml(pkg.name)}" ${installed ? "disabled" : ""}>
        <span class="pkg-card-name">${escapeHtml(pkg.name)}</span>
        <span class="pkg-card-state">${state}</span>
        <span class="pkg-card-desc">${escapeHtml(pkg.desc)}</span>
      </button>`;
    }).join("");
  }

  async function refreshPackages() {
    try {
      const res = await fetch("/api/packages");
      const data = await res.json();
      renderPackageList(data.packages || []);
    } catch {
      /* ignore */
    }
  }

  async function installPackage(spec) {
    let name = (spec || "").trim();
    if (!name || installing) return;
    if (name.toLowerCase().startsWith("pip install ")) {
      name = name.slice("pip install ".length).trim();
    }
    if (!name) return;

    installing = true;
    els.pkgInstall.disabled = true;
    els.pkgLog.classList.remove("ok", "err");
    els.pkgLog.textContent = `pip install ${name}\n…`;

    const card = els.pkgCatalog.querySelector(`[data-pkg="${CSS.escape(name)}"]`);
    if (card) {
      card.classList.add("installing");
      card.disabled = true;
      const state = card.querySelector(".pkg-card-state");
      if (state) state.textContent = "…";
    }

    try {
      const res = await fetch("/api/packages/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      els.pkgLog.textContent = data.output || "";
      els.pkgLog.classList.add(data.ok ? "ok" : "err");
      if (data.ok) {
        els.pkgInput.value = "";
        await refreshPackages();
      } else {
        renderCatalog();
      }
    } catch (err) {
      els.pkgLog.textContent = String(err);
      els.pkgLog.classList.add("err");
      renderCatalog();
    } finally {
      installing = false;
      els.pkgInstall.disabled = false;
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function sameFile(eventPath) {
    return !eventPath || eventPath === path;
  }

  function fileName(p) {
    return (p || "").split("/").pop() || "—";
  }

  function findCursor(id) {
    return els.cursors.querySelector(`[data-id="${CSS.escape(id)}"]`);
  }

  function removeCursor(id) {
    findCursor(id)?.remove();
  }

  function upsertPeer(peer) {
    if (me && peer.id === me.id) {
      const prev = peers.get(peer.id) || {};
      peers.set(peer.id, {
        ...prev,
        ...peer,
        name: peer.name || prev.name || "User",
        color: peer.color || prev.color || "#3d9a8b",
      });
      removeCursor(peer.id);
      renderRoster();
      paintTreeWatchers();
      return peers.get(peer.id);
    }

    const prev = peers.get(peer.id) || {};
    const merged = {
      id: peer.id,
      name: peer.name || prev.name || "User",
      color: peer.color || prev.color || "#3d9a8b",
      x: peer.x ?? prev.x ?? 0.5,
      y: peer.y ?? prev.y ?? 0.5,
      path: peer.path ?? prev.path ?? null,
    };
    peers.set(peer.id, merged);

    let el = findCursor(peer.id);
    if (!el) {
      els.cursors.insertAdjacentHTML(
        "beforeend",
        `<div class="cursor" data-id="${merged.id}" style="--c:${merged.color}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M4 3.5L20 12.2L12.4 14.1L9.8 21.5L4 3.5Z" fill="${merged.color}" stroke="#0f1115" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
          <div class="label">${escapeHtml(merged.name)}</div>
        </div>`
      );
      el = findCursor(peer.id);
    } else {
      const label = el.querySelector(".label");
      if (label) label.textContent = merged.name;
    }
    el.style.transform = `translate(${merged.x * window.innerWidth - 2}px, ${merged.y * window.innerHeight - 2}px)`;
    renderRoster();
    paintTreeWatchers();
    return merged;
  }

  function renderRoster() {
    const items = [...peers.values()];
    els.roster.innerHTML = items
      .map((p) => {
        const mine = me && p.id === me.id;
        return `<span class="peer" style="--c:${p.color}">
          <span class="dot"></span>
          <span>${escapeHtml(p.name)}${mine ? " (vos)" : ""}</span>
          <span class="peer-meta">${escapeHtml(fileName(p.path))}</span>
        </span>`;
      })
      .join("");
  }

  function watchersFor(filePath) {
    return [...peers.values()].filter((p) => p.path === filePath);
  }

  function renderTree(nodes, depth = 0) {
    return (nodes || [])
      .map((node) => {
        if (node.type === "dir") {
          return `<div class="tree-dir">
            <div class="tree-dir-row">
              <details ${depth < 1 ? "open" : ""}>
                <summary>${escapeHtml(node.name)}</summary>
                <div class="tree-children">${renderTree(node.children || [], depth + 1)}</div>
              </details>
              <button type="button" class="tree-del" data-del="${escapeHtml(node.path)}" title="Eliminar carpeta">×</button>
            </div>
          </div>`;
        }
        const isNb = node.ext === ".agdnb";
        const isCsv = node.ext === ".csv";
        const openable = isNb || isCsv;
        const active = node.path === path ? "active" : "";
        const kind = isNb ? "agdnb" : isCsv ? "csv" : "";
        const dots = watchersFor(node.path)
          .map((p) => `<span class="watcher-dot" style="--c:${p.color}" title="${escapeHtml(p.name)}"></span>`)
          .join("");
        return `<div class="tree-row">
          <div class="tree-file ${kind} ${active} ${openable ? "openable" : ""}" data-path="${escapeHtml(node.path)}" data-ext="${escapeHtml(node.ext || "")}">
            <span>${escapeHtml(node.name)}</span>
            ${dots ? `<span class="watchers">${dots}</span>` : ""}
          </div>
          <button type="button" class="tree-del" data-del="${escapeHtml(node.path)}" title="Eliminar">×</button>
        </div>`;
      })
      .join("");
  }

  function setTree(tree) {
    treeData = tree || [];
    els.tree.innerHTML = renderTree(treeData);
  }

  function paintTreeWatchers() {
    if (!treeData.length) return;
    els.tree.innerHTML = renderTree(treeData);
  }

  function cellIndex(id) {
    return notebook.cells.findIndex((c) => c.id === id);
  }

  function renderOutputs(outputs) {
    if (!outputs || !outputs.length) return "";
    return outputs
      .map((o) => {
        const cls = o.type === "error" ? "output-error" : "output-stream";
        const text = o.text || "";
        if (!text && o.type !== "error") return "";
        return `<div class="${cls}">${escapeHtml(text)}</div>`;
      })
      .join("");
  }

  function renderCell(cell, index) {
    const running = cell.status === "running" ? "running" : "";
    return `<article class="cell ${running}" data-id="${cell.id}">
      <div class="cell-toolbar">
        <span class="cell-index">In [${index + 1}]</span>
        <button type="button" class="icon-btn primary" data-action="run">Run</button>
        <button type="button" class="icon-btn" data-action="add">+</button>
        <span class="spacer"></span>
        <button type="button" class="icon-btn danger" data-action="delete">Delete</button>
      </div>
      <textarea class="cell-source" spellcheck="false">${escapeHtml(cell.source || "")}</textarea>
      <div class="outputs">${renderOutputs(cell.outputs)}</div>
    </article>`;
  }

  function showNotebookMode() {
    viewMode = "notebook";
    els.cells.classList.remove("hidden");
    els.btnAddEnd.classList.remove("hidden");
    els.preview.classList.add("hidden");
    els.preview.innerHTML = "";
    els.statusKind.textContent = ".agdnb";
    els.statusLang.textContent = "Python";
    els.title.disabled = false;
    els.btnRestart.disabled = false;
  }

  function showCsvMode() {
    viewMode = "csv";
    els.cells.classList.add("hidden");
    els.btnAddEnd.classList.add("hidden");
    els.preview.classList.remove("hidden");
    els.statusKind.textContent = ".csv";
    els.statusLang.textContent = "Preview";
    els.title.value = "";
    els.title.disabled = true;
    els.btnRestart.disabled = true;
  }

  function renderCsvPreview(data) {
    showCsvMode();
    path = data.path;
    els.path.textContent = path;
    els.tabName.textContent = fileName(path);
    const note = data.truncated
      ? `Mostrando ${data.shown} filas (truncado)`
      : `${data.shown} filas`;
    const head = `<tr><th class="row-num">#</th>${(data.headers || [])
      .map((h) => `<th title="${escapeHtml(h)}">${escapeHtml(h)}</th>`)
      .join("")}</tr>`;
    const body = (data.rows || [])
      .map((row, i) => {
        const cells = (data.headers || []).map((_, idx) => {
          const val = row[idx] ?? "";
          return `<td title="${escapeHtml(val)}">${escapeHtml(val)}</td>`;
        });
        return `<tr><td class="row-num">${i + 1}</td>${cells.join("")}</tr>`;
      })
      .join("");
    els.preview.innerHTML = `
      <div class="preview-meta">
        <span>${escapeHtml(fileName(path))}</span>
        <span>${note} · sep “${escapeHtml(data.delimiter || ",")}”</span>
      </div>
      <div class="preview-scroll">
        <table class="csv-table">
          <thead>${head}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
    paintTreeWatchers();
  }

  async function openCsv(rel) {
    const res = await fetch(`/api/csv/${rel.split("/").map(encodeURIComponent).join("/")}`);
    if (!res.ok) {
      alert("No se pudo abrir el CSV");
      return;
    }
    const data = await res.json();
    renderCsvPreview(data);
  }

  function renderNotebook() {
    showNotebookMode();
    applyingRemote = true;
    els.title.value = notebook.title || "";
    els.path.textContent = path || "—";
    els.tabName.textContent = fileName(path);
    els.cells.innerHTML = notebook.cells.map((c, i) => renderCell(c, i)).join("");
    applyingRemote = false;
    paintTreeWatchers();
  }

  function updateCellDom(cellId) {
    const cell = notebook.cells.find((c) => c.id === cellId);
    if (!cell) return;
    const idx = cellIndex(cellId);
    const existing = els.cells.querySelector(`[data-id="${CSS.escape(cellId)}"]`);
    const html = renderCell(cell, idx);
    if (existing) {
      const active = document.activeElement;
      const keepFocus = active && existing.contains(active) && active.classList.contains("cell-source");
      const selStart = keepFocus ? active.selectionStart : null;
      const selEnd = keepFocus ? active.selectionEnd : null;
      existing.outerHTML = html;
      if (keepFocus) {
        const next = els.cells.querySelector(`[data-id="${CSS.escape(cellId)}"] .cell-source`);
        if (next) {
          next.focus();
          if (selStart != null) next.setSelectionRange(selStart, selEnd);
        }
      }
    } else {
      renderNotebook();
    }
  }

  function scheduleSourceEmit(cellId, source) {
    clearTimeout(sourceTimers.get(cellId));
    sourceTimers.set(
      cellId,
      setTimeout(() => {
        const cell = notebook.cells.find((c) => c.id === cellId);
        if (cell) cell.source = source;
        socket.emit("cell_source", { id: cellId, source });
      }, 120)
    );
  }

  function formatTime(ts) {
    try {
      return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function appendChat(msg) {
    const mine = me && msg.user?.id === me.id;
    els.chatLog.insertAdjacentHTML(
      "beforeend",
      `<div class="chat-msg" data-id="${escapeHtml(msg.id)}">
        <div class="chat-msg-head">
          <span class="chat-msg-name" style="--c:${msg.user?.color || "#3d9a8b"}">${escapeHtml(msg.user?.name || "User")}${mine ? " (vos)" : ""}</span>
          <span class="chat-msg-time">${formatTime(msg.at)}</span>
        </div>
        <div class="chat-msg-text">${escapeHtml(msg.text)}</div>
      </div>`
    );
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  els.cells.addEventListener("input", (e) => {
    if (applyingRemote) return;
    const ta = e.target.closest(".cell-source");
    if (!ta) return;
    scheduleSourceEmit(ta.closest(".cell").dataset.id, ta.value);
  });

  els.cells.addEventListener("keydown", (e) => {
    const ta = e.target.closest(".cell-source");
    if (!ta) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      socket.emit("run_cell", { id: ta.closest(".cell").dataset.id, source: ta.value });
    }
  });

  els.cells.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const cellEl = btn.closest(".cell");
    const id = cellEl.dataset.id;
    const action = btn.dataset.action;
    if (action === "run") {
      socket.emit("run_cell", { id, source: cellEl.querySelector(".cell-source").value });
    } else if (action === "add") {
      socket.emit("cell_add", { after_id: id });
    } else if (action === "delete") {
      socket.emit("cell_delete", { id });
    }
  });

  els.btnAddEnd.addEventListener("click", () => {
    const last = notebook.cells[notebook.cells.length - 1];
    socket.emit("cell_add", { after_id: last ? last.id : null });
  });

  els.title.addEventListener("input", () => {
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => {
      notebook.title = els.title.value;
      socket.emit("title", { title: els.title.value });
    }, 150);
  });

  els.name.addEventListener("input", () => {
    const name = els.name.value.trim();
    if (name) socket.emit("rename", { name });
  });

  els.btnRestart.addEventListener("click", () => socket.emit("kernel_restart"));
  els.btnUpload.addEventListener("click", () => els.folderInput.click());

  els.folderInput.addEventListener("change", async () => {
    const files = els.folderInput.files;
    if (!files?.length) return;
    const form = new FormData();
    for (const file of files) form.append("files", file, file.webkitRelativePath || file.name);
    const res = await fetch("/api/workspace/upload", { method: "POST", body: form });
    const data = await res.json();
    if (data.tree) setTree(data.tree);
    els.folderInput.value = "";
  });

  els.btnNew.addEventListener("click", async () => {
    const name = prompt("Nombre del notebook", "nuevo");
    if (!name) return;
    const res = await fetch("/api/notebook/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.tree) setTree(data.tree);
    if (data.path) socket.emit("open_path", { path: data.path });
  });

  els.tree.addEventListener("click", async (e) => {
    const del = e.target.closest(".tree-del");
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      const target = del.dataset.del;
      if (!target) return;
      if (!confirm(`¿Eliminar "${target}"?`)) return;
      const res = await fetch("/api/workspace/item", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "No se pudo eliminar");
        return;
      }
      if (data.tree) setTree(data.tree);
      return;
    }

    const file = e.target.closest(".tree-file");
    if (!file) return;
    const ext = file.dataset.ext;
    if (ext === ".agdnb" || ext === ".csv") {
      socket.emit("open_path", { path: file.dataset.path });
    }
  });

  els.btnExplorer.addEventListener("click", () => {
    if (isMobile()) {
      localStorage.setItem(sideKey, "explorer");
      localStorage.setItem(explorerKey, "0");
      app.classList.add("show-explorer");
      app.classList.remove("show-chat");
      applyLayout();
      return;
    }
    if (sideMode() !== "explorer") {
      localStorage.setItem(sideKey, "explorer");
      localStorage.setItem(explorerKey, "0");
    } else {
      const next = localStorage.getItem(explorerKey) === "1" ? "0" : "1";
      localStorage.setItem(explorerKey, next);
    }
    applyLayout();
  });

  els.btnPackages.addEventListener("click", () => {
    localStorage.setItem(sideKey, "packages");
    localStorage.setItem(explorerKey, "0");
    if (isMobile()) {
      app.classList.add("show-explorer");
      app.classList.remove("show-chat");
    }
    applyLayout();
    refreshPackages();
    renderCatalog();
    els.pkgInput?.focus();
  });

  els.pkgForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await installPackage(els.pkgInput.value);
  });

  els.pkgCatalog?.addEventListener("click", async (e) => {
    const card = e.target.closest(".pkg-card");
    if (!card || card.disabled) return;
    await installPackage(card.dataset.pkg);
  });

  renderCatalog();
  if (sideMode() === "packages") refreshPackages();

  function toggleChat() {
    if (isMobile()) {
      app.classList.toggle("show-chat");
      app.classList.remove("show-explorer");
      return;
    }
    const next = localStorage.getItem(chatKey) === "1" ? "0" : "1";
    localStorage.setItem(chatKey, next);
    applyLayout();
  }

  els.btnChatToggle.addEventListener("click", toggleChat);
  els.btnChatRail.addEventListener("click", toggleChat);

  els.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) return;
    socket.emit("chat", { text });
    els.chatInput.value = "";
  });

  window.addEventListener("resize", applyLayout);

  window.addEventListener("pointermove", (e) => {
    if (!me) return;
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    me.x = x;
    me.y = y;
    const now = performance.now();
    if (now - lastCursorSent < 20) return;
    lastCursorSent = now;
    socket.volatile.emit("cursor", { x, y });
  });

  socket.on("you", (data) => {
    me = data;
    els.name.value = data.name;
    els.activityUser.style.background = data.color;
    els.activityUser.style.boxShadow = `0 0 0 3px color-mix(in srgb, ${data.color} 25%, transparent)`;
    peers.set(data.id, data);
    removeCursor(data.id);
    renderRoster();
  });

  socket.on("peers", (list) => {
    const ids = new Set(list.map((p) => p.id));
    for (const id of [...peers.keys()]) {
      if (!ids.has(id)) {
        peers.delete(id);
        removeCursor(id);
      }
    }
    list.forEach(upsertPeer);
  });

  socket.on("join", upsertPeer);
  socket.on("peer_update", upsertPeer);
  socket.on("leave", ({ id }) => {
    peers.delete(id);
    removeCursor(id);
    renderRoster();
    paintTreeWatchers();
  });
  socket.on("cursor", (data) => {
    if (me && data.id === me.id) return;
    upsertPeer(data);
  });

  socket.on("notebook", (payload) => {
    path = payload.path;
    notebook = payload.notebook;
    if (me) {
      me.path = path;
      peers.set(me.id, { ...(peers.get(me.id) || {}), ...me, path });
    }
    renderNotebook();
    renderRoster();
  });

  socket.on("preview", async (payload) => {
    if (payload.type !== "csv") return;
    path = payload.path;
    if (me) {
      me.path = path;
      peers.set(me.id, { ...(peers.get(me.id) || {}), ...me, path });
    }
    await openCsv(payload.path);
    renderRoster();
  });

  socket.on("workspace_tree", (payload) => setTree(payload.tree));

  socket.on("title", ({ path: eventPath, title }) => {
    if (!sameFile(eventPath)) return;
    notebook.title = title;
    if (document.activeElement !== els.title) els.title.value = title;
  });

  socket.on("cell_source", ({ path: eventPath, id, source, by }) => {
    if (!sameFile(eventPath)) return;
    if (me && by === me.id) return;
    const cell = notebook.cells.find((c) => c.id === id);
    if (!cell) return;
    cell.source = source;
    const ta = els.cells.querySelector(`[data-id="${CSS.escape(id)}"] .cell-source`);
    if (ta && document.activeElement !== ta) ta.value = source;
  });

  socket.on("cell_add", ({ path: eventPath, index, cell }) => {
    if (!sameFile(eventPath)) return;
    notebook.cells.splice(index, 0, cell);
    renderNotebook();
  });

  socket.on("cell_delete", ({ path: eventPath, id }) => {
    if (!sameFile(eventPath)) return;
    notebook.cells = notebook.cells.filter((c) => c.id !== id);
    renderNotebook();
  });

  socket.on("cell_status", ({ path: eventPath, id, status }) => {
    if (!sameFile(eventPath)) return;
    const cell = notebook.cells.find((c) => c.id === id);
    if (!cell) return;
    cell.status = status;
    els.cells.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.toggle("running", status === "running");
  });

  socket.on("cell_output", ({ path: eventPath, id, outputs, status }) => {
    if (!sameFile(eventPath)) return;
    const cell = notebook.cells.find((c) => c.id === id);
    if (!cell) return;
    cell.outputs = outputs;
    cell.status = status || "idle";
    updateCellDom(id);
  });

  socket.on("kernel_restarted", () => {
    const prev = els.path.textContent;
    els.path.textContent = "kernel ok";
    setTimeout(() => {
      els.path.textContent = prev;
    }, 1000);
  });

  socket.on("chat_history", ({ messages }) => {
    els.chatLog.innerHTML = "";
    (messages || []).forEach(appendChat);
  });

  socket.on("chat", appendChat);

  socket.on("packages_updated", (payload) => {
    renderPackageList(payload.packages || []);
  });

  refreshPackages();
})();
