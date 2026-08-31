(() => {
  const socket = io({
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
  });

  const scrollTimers = new WeakMap();
  document.addEventListener(
    "scroll",
    (e) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      el.classList.add("is-scrolling");
      const prev = scrollTimers.get(el);
      if (prev) clearTimeout(prev);
      scrollTimers.set(
        el,
        setTimeout(() => {
          el.classList.remove("is-scrolling");
          scrollTimers.delete(el);
        }, 700)
      );
    },
    { capture: true, passive: true }
  );

  const homeEl = document.getElementById("home");
  const app = document.getElementById("editor-app");

  const els = {
    cells: document.getElementById("cells"),
    preview: document.getElementById("preview"),
    tree: document.getElementById("tree"),
    title: document.getElementById("title"),
    path: document.getElementById("path-label"),
    tabs: document.getElementById("tabs"),
    name: document.getElementById("name"),
    roster: document.getElementById("roster"),
    cursors: document.getElementById("cursors"),
    folderInput: document.getElementById("folder-input"),
    btnUpload: document.getElementById("btn-upload"),
    btnNew: document.getElementById("btn-new"),
    btnTabAdd: document.getElementById("btn-tab-add"),
    btnAddEnd: document.getElementById("btn-add-end"),
    btnAddMd: document.getElementById("btn-add-md"),
    btnRestart: document.getElementById("btn-restart"),
    btnHome: document.getElementById("btn-home"),
    btnExplorer: document.getElementById("btn-explorer"),
    btnFriends: document.getElementById("btn-friends"),
    btnCanvas: document.getElementById("btn-canvas"),
    btnPackages: document.getElementById("btn-packages"),
    board: document.getElementById("board"),
    boardCanvas: document.getElementById("board-canvas"),
    btnBoardUndo: document.getElementById("btn-board-undo"),
    btnChatRail: document.getElementById("btn-chat-rail"),
    btnChatToggle: document.getElementById("btn-chat-toggle"),
    chatLog: document.getElementById("chat-log"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),
    chatMentionMenu: document.getElementById("chat-mention-menu"),
    chatUnreadBadge: document.getElementById("chat-unread-badge"),
    activityUser: document.getElementById("activity-user"),
    activityProject: document.getElementById("activity-project"),
    statusKind: document.getElementById("status-kind"),
    statusLang: document.getElementById("status-lang"),
    pkgForm: document.getElementById("pkg-form"),
    pkgInput: document.getElementById("pkg-input"),
    pkgInstall: document.getElementById("pkg-install"),
    pkgLog: document.getElementById("pkg-log"),
    pkgList: document.getElementById("pkg-list"),
    pkgCatalog: document.getElementById("pkg-catalog"),
    homeDot: document.getElementById("home-dot"),
    homeWho: document.getElementById("home-who"),
    homeError: document.getElementById("home-error"),
    projectList: document.getElementById("project-list"),
    projectsCount: document.getElementById("projects-count"),
    homeRecent: document.getElementById("home-recent"),
    joinForm: document.getElementById("join-form"),
    joinCode: document.getElementById("join-code"),
    cloneForm: document.getElementById("clone-form"),
    cloneUrl: document.getElementById("clone-url"),
    cloneName: document.getElementById("clone-name"),
    cloneSubmit: document.getElementById("clone-submit"),
    cloneLog: document.getElementById("clone-log"),
    authGuest: document.getElementById("auth-guest"),
    authAccount: document.getElementById("auth-account"),
    accountNameLabel: document.getElementById("account-name-label"),
    registerForm: document.getElementById("register-form"),
    loginForm: document.getElementById("login-form"),
    regName: document.getElementById("reg-name"),
    regPassword: document.getElementById("reg-password"),
    regColors: document.getElementById("reg-colors"),
    loginName: document.getElementById("login-name"),
    loginPassword: document.getElementById("login-password"),
    btnLogout: document.getElementById("btn-logout"),
    friendsHome: document.getElementById("friends-home"),
    friendsNeedAccount: document.getElementById("friends-need-account"),
    friendRequestForm: document.getElementById("friend-request-form"),
    friendName: document.getElementById("friend-name"),
    pendingList: document.getElementById("pending-list"),
    friendsList: document.getElementById("friends-list"),
    modalJoin: document.getElementById("modal-join"),
    modalClone: document.getElementById("modal-clone"),
    modalFriends: document.getElementById("modal-friends"),
    modalAccount: document.getElementById("modal-account"),
    modalNewProject: document.getElementById("modal-new-project"),
    newProjectForm: document.getElementById("new-project-form"),
    newProjectName: document.getElementById("new-project-name"),
    btnNewProject: document.getElementById("btn-new-project"),
    btnJoinSession: document.getElementById("btn-join-session"),
    btnCloneGit: document.getElementById("btn-clone-git"),
    btnAddFriends: document.getElementById("btn-add-friends"),
    btnHomeAccount: document.getElementById("btn-home-account"),
    btnFriendsToAccount: document.getElementById("btn-friends-to-account"),
    inviteCodeDisplay: document.getElementById("invite-code-display"),
    btnCopyCode: document.getElementById("btn-copy-code"),
    btnRegenCode: document.getElementById("btn-regen-code"),
    projectPeers: document.getElementById("project-peers"),
    friendsInviteBlock: document.getElementById("friends-invite-block"),
    friendsInviteList: document.getElementById("friends-invite-list"),
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
  let sessionState = null;
  let selectedColor = "#e85d4c";
  let inProject = false;
  let path = "";
  let viewMode = "notebook";
  let notebook = { title: "", cells: [] };
  let treeData = [];
  /** @type {{ path: string, kind: "notebook" | "csv" }[]} */
  let openTabs = [];
  const CANVAS_PATH = "__canvas__";
  /** @type {Map<string, Map<string, {action: string, name: string, color: string}>>} */
  const cellPresence = new Map();
  let presenceTimers = new Map();
  let dragCellId = null;
  let boardStrokes = [];
  let boardTool = "pen";
  let boardDrawing = false;
  let boardPoints = [];
  let boardDirty = false;
  const peers = new Map();
  let unreadChat = 0;
  let mentionState = { open: false, items: [], index: 0, start: 0, end: 0 };
  const FILE_ICON = `<svg class="tree-file-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  const sourceTimers = new Map();
  let applyingRemote = false;
  let titleTimer = null;
  let lastCursorSent = 0;

  const chatKey = "agdse-chat-collapsed";
  const explorerKey = "agdse-explorer-collapsed";
  const sideKey = "agdse-side-panel"; // explorer | packages | friends

  function isMobile() {
    return window.matchMedia("(max-width: 980px)").matches;
  }

  function sideMode() {
    const v = localStorage.getItem(sideKey);
    if (v === "packages" || v === "friends") return v;
    return "explorer";
  }

  function applyLayout() {
    if (!app || app.classList.contains("hidden")) return;
    const chatCollapsed = localStorage.getItem(chatKey) === "1";
    const explorerCollapsed = localStorage.getItem(explorerKey) === "1";
    const mode = sideMode();
    app.classList.toggle("chat-collapsed", chatCollapsed && !isMobile());
    app.classList.toggle("explorer-collapsed", explorerCollapsed && !isMobile());
    app.classList.toggle("side-packages", mode === "packages");
    app.classList.toggle("side-friends", mode === "friends");
    els.btnChatToggle.setAttribute("aria-expanded", chatCollapsed ? "false" : "true");
    els.btnExplorer.classList.toggle("active", mode === "explorer" && (!explorerCollapsed || isMobile()));
    els.btnPackages.classList.toggle("active", mode === "packages" && (!explorerCollapsed || isMobile()));
    els.btnFriends.classList.toggle("active", mode === "friends" && (!explorerCollapsed || isMobile()));
    els.btnExplorer.setAttribute("aria-pressed", (mode === "explorer").toString());
    els.btnPackages.setAttribute("aria-pressed", (mode === "packages").toString());
    els.btnFriends.setAttribute("aria-pressed", (mode === "friends").toString());
    els.btnChatRail.classList.toggle("active", !chatCollapsed || app.classList.contains("show-chat"));
    els.btnChatRail.setAttribute("aria-pressed", (!chatCollapsed).toString());
    if (isChatVisible()) clearUnreadChat();
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function initialOf(name) {
    const s = String(name || "?").trim();
    return (s.charAt(0) || "?").toUpperCase();
  }

  function avatarHtml(name, color, extraClass = "") {
    const cls = ["avatar", extraClass].filter(Boolean).join(" ");
    return `<span class="${cls}" style="--c:${color || "#888"}" title="${escapeHtml(name || "")}">${escapeHtml(initialOf(name))}</span>`;
  }

  function setIdentityAvatar(el, name, color) {
    if (!el) return;
    el.style.setProperty("--c", color || "#888");
    el.style.background = color || "#888";
    el.textContent = initialOf(name);
    el.title = name || "";
  }

  function isChatVisible() {
    if (!app || app.classList.contains("hidden")) return false;
    if (isMobile()) return app.classList.contains("show-chat");
    return localStorage.getItem(chatKey) !== "1";
  }

  function updateUnreadBadge() {
    const badge = els.chatUnreadBadge;
    if (!badge) return;
    if (unreadChat <= 0) {
      badge.classList.add("hidden");
      badge.textContent = "";
      return;
    }
    badge.classList.remove("hidden");
    badge.textContent = unreadChat > 9 ? "9+" : String(unreadChat);
  }

  function clearUnreadChat() {
    unreadChat = 0;
    updateUnreadBadge();
  }

  function collectFiles(nodes, out = []) {
    for (const n of nodes || []) {
      if (n.type === "file" || (!n.type && n.path && n.name && n.ext != null)) {
        out.push({ path: n.path, name: n.name, ext: n.ext || "" });
      }
      if (n.children?.length) collectFiles(n.children, out);
    }
    // also include open tabs not yet in shallow tree
    for (const t of openTabs) {
      if (!out.some((f) => f.path === t.path)) {
        out.push({ path: t.path, name: fileName(t.path), ext: t.path.includes(".") ? `.${t.path.split(".").pop()}` : "" });
      }
    }
    return out;
  }

  function mentionTokenForUser(name) {
    return String(name || "").replace(/\s+/g, "");
  }

  function getMentionContext(input) {
    const pos = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, pos);
    const m = before.match(/(^|[\s([{])@([^\s@]*)$/);
    if (!m) return null;
    const query = m[2];
    const start = pos - query.length - 1;
    return { start, end: pos, query };
  }

  function buildMentionItems(query) {
    const q = String(query || "").toLowerCase();
    const users = [...peers.values()].map((p) => ({
      kind: "user",
      id: p.id,
      label: p.name,
      insert: `@${mentionTokenForUser(p.name)}`,
      color: p.color,
      sub: "user",
    }));
    const files = collectFiles(treeData).map((f) => ({
      kind: "file",
      id: f.path,
      label: f.name,
      insert: `@${f.path}`,
      path: f.path,
      sub: "file",
    }));
    return [...users, ...files]
      .filter((item) => {
        if (!q) return true;
        return (
          item.label.toLowerCase().includes(q) ||
          item.insert.toLowerCase().includes(q) ||
          (item.path && item.path.toLowerCase().includes(q))
        );
      })
      .slice(0, 12);
  }

  function renderMentionMenu() {
    const menu = els.chatMentionMenu;
    if (!menu) return;
    if (!mentionState.open || !mentionState.items.length) {
      menu.classList.add("hidden");
      menu.innerHTML = "";
      return;
    }
    menu.classList.remove("hidden");
    menu.innerHTML = mentionState.items
      .map((item, i) => {
        const active = i === mentionState.index ? "active" : "";
        if (item.kind === "user") {
          return `<button type="button" class="mention-item ${active}" data-mention-idx="${i}" role="option">
            ${avatarHtml(item.label, item.color)}
            <span>${escapeHtml(item.label)}</span>
            <span class="meta">user</span>
          </button>`;
        }
        return `<button type="button" class="mention-item ${active}" data-mention-idx="${i}" role="option">
          ${FILE_ICON}
          <span class="file-path">${escapeHtml(item.path || item.label)}</span>
          <span class="meta">file</span>
        </button>`;
      })
      .join("");
  }

  function closeMentionMenu() {
    mentionState = { open: false, items: [], index: 0, start: 0, end: 0 };
    renderMentionMenu();
  }

  function refreshMentionMenu() {
    const ctx = getMentionContext(els.chatInput);
    if (!ctx) {
      closeMentionMenu();
      return;
    }
    const items = buildMentionItems(ctx.query);
    if (!items.length) {
      closeMentionMenu();
      return;
    }
    mentionState = {
      open: true,
      items,
      index: Math.min(mentionState.index, items.length - 1),
      start: ctx.start,
      end: ctx.end,
    };
    if (mentionState.index < 0) mentionState.index = 0;
    renderMentionMenu();
  }

  function applyMention(item) {
    if (!item || !els.chatInput) return;
    const input = els.chatInput;
    const before = input.value.slice(0, mentionState.start);
    const after = input.value.slice(mentionState.end);
    const insert = `${item.insert} `;
    input.value = `${before}${insert}${after}`;
    const caret = before.length + insert.length;
    input.focus();
    input.setSelectionRange(caret, caret);
    closeMentionMenu();
  }

  function formatChatText(text) {
    const raw = String(text || "");
    const users = [...peers.values()]
      .map((p) => ({
        kind: "user",
        token: mentionTokenForUser(p.name),
        name: p.name,
        color: p.color,
        id: p.id,
      }))
      .filter((u) => u.token)
      .sort((a, b) => b.token.length - a.token.length);
    const files = collectFiles(treeData)
      .map((f) => ({ kind: "file", token: f.path, path: f.path, name: f.name }))
      .filter((f) => f.token)
      .sort((a, b) => b.token.length - a.token.length);

    let out = "";
    let i = 0;
    while (i < raw.length) {
      if (raw[i] === "@") {
        const rest = raw.slice(i + 1);
        let hit = null;
        for (const u of users) {
          if (rest.startsWith(u.token) && (rest.length === u.token.length || /[\s.,!?;:)\]]/.test(rest[u.token.length] || " "))) {
            hit = u;
            break;
          }
        }
        if (!hit) {
          for (const f of files) {
            if (rest.startsWith(f.token) && (rest.length === f.token.length || /[\s.,!?;:)\]]/.test(rest[f.token.length] || " "))) {
              hit = f;
              break;
            }
          }
        }
        if (hit) {
          if (hit.kind === "user") {
            out += `<span class="chat-mention user" style="--c:${hit.color}">@${escapeHtml(hit.name)}</span>`;
          } else {
            out += `<button type="button" class="chat-mention file" data-open-path="${escapeHtml(hit.path)}">@${escapeHtml(hit.path)}</button>`;
          }
          i += 1 + hit.token.length;
          continue;
        }
      }
      // escape one char
      const ch = raw[i];
      out += ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch;
      i += 1;
    }
    return out;
  }

  function showHomeError(msg) {
    if (!els.homeError) return;
    if (!msg) {
      els.homeError.hidden = true;
      els.homeError.textContent = "";
      return;
    }
    const anyModal = [
      els.modalNewProject,
      els.modalJoin,
      els.modalClone,
      els.modalFriends,
      els.modalAccount,
    ].some((m) => m && !m.classList.contains("hidden"));
    if (anyModal) {
      alert(msg);
      return;
    }
    els.homeError.hidden = false;
    els.homeError.textContent = msg;
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      credentials: "same-origin",
      ...opts,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Error");
    return data;
  }

  function closeModals() {
    [els.modalNewProject, els.modalJoin, els.modalClone, els.modalFriends, els.modalAccount].forEach((m) =>
      m?.classList.add("hidden")
    );
  }

  function openModal(el) {
    closeModals();
    el?.classList.remove("hidden");
  }

  function requireAccount(actionLabel) {
    if (sessionState?.identity?.type === "account") return true;
    showHomeError(`Creá una cuenta para ${actionLabel}.`);
    openModal(els.modalAccount);
    return false;
  }

  function applySession(data) {
    sessionState = data;
    const id = data.identity || {};
    els.homeWho.textContent = id.name || "Guest";
    setIdentityAvatar(els.homeDot, id.name || "Guest", id.color || "#888");
    setIdentityAvatar(els.activityUser, id.name || "Guest", id.color || "#888");
    if (els.name) {
      els.name.value = id.name || "Guest";
      els.name.disabled = id.type !== "guest";
      els.name.title = id.type === "guest" ? "Nombre de sesión (Guest)" : "Nombre de cuenta";
    }
    if (els.accountNameLabel) els.accountNameLabel.textContent = id.name || "—";

    const isAccount = id.type === "account";
    els.authGuest.classList.toggle("hidden", isAccount);
    els.authAccount.classList.toggle("hidden", !isAccount);
    els.friendsHome.classList.toggle("hidden", !isAccount);
    els.friendsNeedAccount?.classList.toggle("hidden", isAccount);

    renderProjectList(data.projects || []);
    renderFriendsHome(data);
    renderColorPicker(data.colors || []);
    if (data.project) {
      updateProjectChrome(data.project);
    }
  }

  function renderColorPicker(colors) {
    if (!els.regColors) return;
    const list = colors.length ? colors : ["#e85d4c", "#3d9b8f", "#e8a838", "#5b7cfa", "#c45c9a", "#6bbf59"];
    if (!list.includes(selectedColor)) selectedColor = list[0];
    els.regColors.innerHTML = list
      .map(
        (c) =>
          `<button type="button" class="color-swatch${c === selectedColor ? " active" : ""}" data-color="${c}" style="--c:${c}" title="${c}"></button>`
      )
      .join("");
  }

  function renderProjectList(projects) {
    const list = projects || [];
    if (els.projectsCount) els.projectsCount.textContent = String(list.length);
    els.homeRecent?.classList.toggle("hidden", list.length === 0);

    if (!els.projectList) return;
    if (!list.length) {
      els.projectList.innerHTML = "";
      return;
    }
    const uid = sessionState?.identity?.id;
    els.projectList.innerHTML = list
      .map((p) => {
        const owned = p.owner_id === uid;
        const meta = owned ? "owner" : "shared";
        return `<button type="button" class="home-recent-row" data-open-project="${escapeHtml(p.id)}">
            <span class="home-recent-name">${escapeHtml(p.name)}</span>
            <span class="home-recent-meta">${escapeHtml(meta)}</span>
          </button>`;
      })
      .join("");
  }

  function renderFriendsHome(data) {
    const pending = data.pending_in || [];
    const friends = data.friends || [];
    const pendingOut = data.pending_out || [];

    const pendingHtml = [
      ...pending.map(
        (p) => `<div class="home-item" style="cursor:default">
          ${avatarHtml(p.name, p.color)}
          <span>${escapeHtml(p.name)}</span>
          <div class="home-item-actions">
            <button type="button" data-friend-accept="${escapeHtml(p.id)}">Aceptar</button>
            <button type="button" data-friend-reject="${escapeHtml(p.id)}">Rechazar</button>
          </div>
        </div>`
      ),
      ...pendingOut.map(
        (p) => `<div class="home-item" style="cursor:default">
          ${avatarHtml(p.name, p.color)}
          <span>${escapeHtml(p.name)}</span>
          <span class="meta">enviado</span>
        </div>`
      ),
    ].join("");

    els.pendingList.innerHTML = pendingHtml || `<div class="home-empty">Sin pedidos.</div>`;

    els.friendsList.innerHTML = friends.length
      ? friends
          .map(
            (p) => `<div class="home-item" style="cursor:default">
          ${avatarHtml(p.name, p.color)}
          <span>${escapeHtml(p.name)}</span>
          <div class="home-item-actions">
            <button type="button" data-friend-remove="${escapeHtml(p.id)}">Quitar</button>
          </div>
        </div>`
          )
          .join("")
      : `<div class="home-empty">Sin amigos todavía.</div>`;
  }

  function updateProjectChrome(project) {
    if (!project) return;
    if (els.activityProject) els.activityProject.textContent = project.name || "—";
    if (els.inviteCodeDisplay) els.inviteCodeDisplay.textContent = project.invite_code || "———";
    const isOwner =
      sessionState?.identity?.type === "account" &&
      sessionState?.identity?.id === project.owner_id;
    els.btnRegenCode.classList.toggle("hidden", !isOwner);
    renderFriendsInvite(project);
    renderProjectPeers();
  }

  function renderProjectPeers() {
    if (!els.projectPeers) return;
    const items = [...peers.values()];
    els.projectPeers.innerHTML = items.length
      ? items
          .map((p) => {
            const mine = me && p.id === me.id;
            return `<div class="home-item" style="cursor:default">
              ${avatarHtml(p.name, p.color)}
              <span>${escapeHtml(p.name)}${mine ? " (vos)" : ""}</span>
              <span class="meta">${escapeHtml(fileName(p.path))}</span>
            </div>`;
          })
          .join("")
      : `<div class="home-empty">Solo vos.</div>`;
  }

  function renderFriendsInvite(project) {
    const friends = sessionState?.friends || [];
    const isAccount = sessionState?.identity?.type === "account";
    els.friendsInviteBlock.classList.toggle("hidden", !isAccount || !friends.length);
    if (!isAccount) return;
    const members = new Set([project.owner_id, ...(project.member_ids || [])]);
    els.friendsInviteList.innerHTML = friends
      .map((f) => {
        const inProj = members.has(f.id);
        return `<div class="home-item" style="cursor:default">
          ${avatarHtml(f.name, f.color)}
          <span>${escapeHtml(f.name)}</span>
          <div class="home-item-actions">
            ${
              inProj
                ? `<span class="meta">miembro</span>`
                : `<button type="button" data-invite-friend="${escapeHtml(f.id)}">Invitar</button>`
            }
          </div>
        </div>`;
      })
      .join("");
  }

  function showHome() {
    inProject = false;
    homeEl.classList.remove("hidden");
    app.classList.add("hidden");
    closeModals();
    openTabs = [];
    path = "";
    notebook = { title: "", cells: [] };
    treeData = [];
    peers.clear();
    els.cursors.innerHTML = "";
    els.chatLog.innerHTML = "";
    clearUnreadChat();
    closeMentionMenu();
    if (els.cells) els.cells.innerHTML = "";
  }

  function showEditor() {
    inProject = true;
    homeEl.classList.add("hidden");
    app.classList.remove("hidden");
    localStorage.setItem(sideKey, "explorer");
    localStorage.setItem(explorerKey, "0");
    applyLayout();
  }

  async function refreshMe() {
    const data = await api("/api/me");
    applySession(data);
    return data;
  }

  async function openProject(projectId) {
    showHomeError("");
    const data = await api(`/api/projects/${projectId}/open`, { method: "POST", body: {} });
    applySession(data);
    closeModals();
    showEditor();
    socket.emit("join_project", { project_id: projectId });
  }

  async function leaveToHome() {
    socket.emit("leave_project");
    const pid = sessionState?.project?.id;
    if (pid) {
      try {
        await api(`/api/projects/${pid}/leave`, { method: "POST", body: {} });
      } catch {
        /* ignore */
      }
    }
    await refreshMe();
    showHome();
  }

  // ---- packages ----
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

  // ---- notebook UI ----
  function sameFile(eventPath) {
    return !eventPath || eventPath === path;
  }

  function fileName(p) {
    if (p === CANVAS_PATH) return "Canvas";
    return (p || "").split("/").pop() || "—";
  }

  function tabKind(p) {
    if (p === CANVAS_PATH) return "canvas";
    return String(p || "").toLowerCase().endsWith(".csv") ? "csv" : "notebook";
  }

  function openTabTarget(rel) {
    if (!rel) return;
    if (rel === CANVAS_PATH) socket.emit("open_canvas");
    else socket.emit("open_path", { path: rel });
  }

  function ensureTab(rel, kind) {
    if (!rel) return;
    const k = kind || tabKind(rel);
    const existing = openTabs.find((t) => t.path === rel);
    if (existing) existing.kind = k;
    else openTabs.push({ path: rel, kind: k });
    renderTabs();
  }

  function removeTab(rel) {
    const idx = openTabs.findIndex((t) => t.path === rel);
    if (idx < 0) return;
    openTabs.splice(idx, 1);
    renderTabs();
    if (path === rel) {
      const next = openTabs[idx] || openTabs[idx - 1] || openTabs[0];
      if (next) openTabTarget(next.path);
      else {
        path = "";
        notebook = { title: "", cells: [] };
        cellPresence.clear();
        els.cells.innerHTML = "";
        els.preview.classList.add("hidden");
        els.preview.innerHTML = "";
        els.board?.classList.add("hidden");
        els.path.textContent = "—";
        els.title.value = "";
      }
    }
  }

  function renderTabs() {
    if (!els.tabs) return;
    els.tabs.innerHTML = openTabs
      .map((t) => {
        const active = t.path === path ? "active" : "";
        const label = t.kind === "canvas" ? "Canvas" : fileName(t.path);
        return `<button type="button" class="tab ${active}" role="tab" data-tab="${escapeHtml(t.path)}" title="${escapeHtml(label)}" aria-selected="${t.path === path}">
          <span class="tab-label">${escapeHtml(label)}</span>
          <span class="tab-close" data-close="${escapeHtml(t.path)}" title="Cerrar" aria-label="Cerrar">×</span>
        </button>`;
      })
      .join("");
  }

  async function createNotebook() {
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
        name: peer.name || prev.name || "Guest",
        color: peer.color || prev.color || "#888",
      });
      removeCursor(peer.id);
      renderRoster();
      paintTreeWatchers();
      renderProjectPeers();
      return peers.get(peer.id);
    }

    const prev = peers.get(peer.id) || {};
    const merged = {
      id: peer.id,
      name: peer.name || prev.name || "Guest",
      color: peer.color || prev.color || "#888",
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
    renderProjectPeers();
    return merged;
  }

  function renderRoster() {
    const items = [...peers.values()];
    els.roster.innerHTML = items
      .map((p) => {
        const mine = me && p.id === me.id;
        return `<span class="peer" style="--c:${p.color}">
          ${avatarHtml(p.name, p.color)}
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
        if (node.type === "truncated") {
          return `<div class="tree-truncated">${escapeHtml(node.name)}</div>`;
        }
        if (node.type === "dir") {
          const lazy = node.lazy ? "1" : "0";
          const kids =
            node.children && node.children.length
              ? renderTree(node.children, depth + 1)
              : node.lazy
                ? `<div class="tree-loading">…</div>`
                : "";
          return `<div class="tree-dir">
            <div class="tree-dir-row">
              <details data-path="${escapeHtml(node.path)}" data-lazy="${lazy}">
                <summary>${escapeHtml(node.name)}</summary>
                <div class="tree-children">${kids}</div>
              </details>
              <button type="button" class="tree-del" data-del="${escapeHtml(node.path)}" title="Eliminar carpeta">×</button>
            </div>
          </div>`;
        }
        const isNb = node.ext === ".ipynb";
        const isCsv = node.ext === ".csv";
        const openable = isNb || isCsv;
        const active = node.path === path ? "active" : "";
        const kind = isNb ? "ipynb" : isCsv ? "csv" : "";
        const dots = watchersFor(node.path)
          .map((p) => avatarHtml(p.name, p.color, "watcher-avatar"))
          .join("");
        return `<div class="tree-row">
          <div class="tree-file ${kind} ${active} ${openable ? "openable" : ""}" data-path="${escapeHtml(node.path)}" data-ext="${escapeHtml(node.ext || "")}">
            ${FILE_ICON}
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

  function updateTreeNodeChildren(dirPath, children) {
    const details = els.tree.querySelector(`details[data-path="${CSS.escape(dirPath)}"]`);
    if (!details) return;
    details.dataset.lazy = "0";
    const box = details.querySelector(".tree-children");
    if (box) box.innerHTML = renderTree(children || []);
  }

  async function expandTreeDir(dirPath) {
    const res = await fetch(`/api/workspace/tree?path=${encodeURIComponent(dirPath)}`, {
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No se pudo listar");
    updateTreeNodeChildren(dirPath, data.tree || []);
  }

  function paintTreeWatchers() {
    if (!treeData.length) return;
    // Preserve expanded lazy folders: only re-render root if needed for watchers on files
    els.tree.querySelectorAll(".tree-file").forEach((el) => {
      const filePath = el.dataset.path;
      const watchers = el.querySelector(".watchers");
      const dots = watchersFor(filePath)
        .map((p) => avatarHtml(p.name, p.color, "watcher-avatar"))
        .join("");
      if (dots) {
        if (watchers) watchers.innerHTML = dots;
        else el.insertAdjacentHTML("beforeend", `<span class="watchers">${dots}</span>`);
      } else if (watchers) {
        watchers.remove();
      }
      el.classList.toggle("active", filePath === path);
    });
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

  function renderMarkdownHtml(source) {
    const raw = String(source || "");
    if (!raw.trim()) return `<p class="md-empty">Markdown vacío — clic para editar</p>`;
    try {
      const html = window.marked?.parse?.(raw, { breaks: true, gfm: true }) ?? escapeHtml(raw);
      return window.DOMPurify?.sanitize?.(html) ?? html;
    } catch {
      return `<pre>${escapeHtml(raw)}</pre>`;
    }
  }

  function autosizeTextarea(ta) {
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.max(ta.scrollHeight, 28)}px`;
  }

  function paintCodeHighlight(cellEl) {
    const ta = cellEl.querySelector(".cell-source");
    const code = cellEl.querySelector(".code-highlight code");
    if (!ta || !code) return;
    const src = ta.value;
    code.textContent = src.endsWith("\n") ? src : `${src}\n`;
    if (window.hljs) {
      code.removeAttribute("data-highlighted");
      code.className = "language-python";
      window.hljs.highlightElement(code);
    }
    autosizeTextarea(ta);
  }

  function syncMarkdownPreview(cellEl) {
    const ta = cellEl.querySelector(".cell-source");
    const preview = cellEl.querySelector(".md-preview");
    if (!preview) return;
    preview.innerHTML = renderMarkdownHtml(ta?.value || "");
  }

  function setMarkdownEditing(cellEl, editing, opts = {}) {
    if (!cellEl || cellEl.dataset.type !== "markdown") return;
    const focus = opts.focus !== false;
    cellEl.classList.toggle("editing", editing);
    const ta = cellEl.querySelector(".cell-source");
    const preview = cellEl.querySelector(".md-preview");
    if (editing) {
      preview?.classList.add("hidden");
      ta?.classList.remove("hidden");
      autosizeTextarea(ta);
      if (focus) {
        queueMicrotask(() => {
          ta?.focus();
          if (ta && ta.value) ta.setSelectionRange(ta.value.length, ta.value.length);
        });
      }
    } else {
      syncMarkdownPreview(cellEl);
      preview?.classList.remove("hidden");
      ta?.classList.add("hidden");
    }
  }

  function enhanceCell(cellEl) {
    if (!cellEl) return;
    if (cellEl.dataset.type === "code") {
      paintCodeHighlight(cellEl);
    } else if (cellEl.dataset.type === "markdown") {
      const empty = !(cellEl.querySelector(".cell-source")?.value || "").trim();
      setMarkdownEditing(cellEl, empty || cellEl.classList.contains("editing"), { focus: false });
    }
  }

  function enhanceAllCells() {
    els.cells.querySelectorAll(".cell").forEach(enhanceCell);
    paintAllPresence();
  }

  function emitPresence(cellId, action) {
    socket.emit("cell_presence", { cell_id: cellId || null, action: action || null });
  }

  function scheduleTypingPresence(cellId) {
    emitPresence(cellId, "typing");
    clearTimeout(presenceTimers.get(cellId));
    presenceTimers.set(
      cellId,
      setTimeout(() => {
        emitPresence(cellId, null);
        presenceTimers.delete(cellId);
      }, 1200)
    );
  }

  function setRemotePresence(user, cellId, action) {
    if (!user?.id) return;
    // clear this user from all cells first
    for (const [cid, map] of cellPresence) {
      if (map.has(user.id)) {
        map.delete(user.id);
        if (!map.size) cellPresence.delete(cid);
      }
    }
    if (action && cellId) {
      if (!cellPresence.has(cellId)) cellPresence.set(cellId, new Map());
      cellPresence.get(cellId).set(user.id, {
        action,
        name: user.name || "User",
        color: user.color || "#888",
      });
    }
    paintAllPresence();
  }

  function paintCellPresence(cellEl) {
    if (!cellEl) return;
    const id = cellEl.dataset.id;
    const map = cellPresence.get(id);
    const box = cellEl.querySelector("[data-presence]");
    cellEl.classList.remove("has-typing", "has-dragging");
    cellEl.style.removeProperty("--presence");
    cellEl.querySelectorAll(".presence-caret").forEach((n) => n.remove());
    if (!map || !map.size) {
      if (box) box.innerHTML = "";
      return;
    }
    let html = "";
    for (const [, info] of map) {
      const label = info.action === "dragging" ? "arrastrando…" : "escribiendo…";
      html += `<span class="presence-chip" style="--c:${info.color}">${avatarHtml(info.name, info.color, "sm")}
        <span class="presence-label">${escapeHtml(info.name)} ${label}</span></span>`;
      cellEl.style.setProperty("--presence", info.color);
      if (info.action === "typing") {
        cellEl.classList.add("has-typing");
        cellEl.insertAdjacentHTML(
          "beforeend",
          `<span class="presence-caret" style="--c:${info.color}" title="${escapeHtml(info.name)}"></span>`
        );
      }
      if (info.action === "dragging") cellEl.classList.add("has-dragging");
    }
    if (box) box.innerHTML = html;
  }

  function paintAllPresence() {
    els.cells.querySelectorAll(".cell").forEach(paintCellPresence);
  }

  function applyCellOrder(order) {
    if (!Array.isArray(order) || !order.length) return;
    const byId = new Map(notebook.cells.map((c) => [c.id, c]));
    const next = order.map((id) => byId.get(id)).filter(Boolean);
    for (const c of notebook.cells) {
      if (!order.includes(c.id)) next.push(c);
    }
    notebook.cells = next;
    renderNotebook();
  }

  function boardCtx() {
    return els.boardCanvas?.getContext("2d") || null;
  }

  function resizeBoardCanvas() {
    const canvas = els.boardCanvas;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return;
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = boardCtx();
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawBoard();
  }

  function paintStroke(ctx, stroke, w, h) {
    const pts = stroke.points || [];
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.width || 3;
    if (stroke.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = stroke.color || "#dadada";
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w, pts[i][1] * h);
    ctx.stroke();
    ctx.restore();
  }

  function redrawBoard() {
    const canvas = els.boardCanvas;
    const ctx = boardCtx();
    if (!canvas || !ctx) return;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    ctx.clearRect(0, 0, w, h);
    for (const stroke of boardStrokes) paintStroke(ctx, stroke, w, h);
    if (boardDrawing && boardPoints.length > 1) {
      paintStroke(
        ctx,
        {
          tool: boardTool,
          width: boardTool === "eraser" ? 18 : 3,
          color: me?.color || "#dadada",
          points: boardPoints,
        },
        w,
        h
      );
    }
  }

  function normBoardPoint(e) {
    const canvas = els.boardCanvas;
    const rect = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    ];
  }

  function setBoardTool(tool) {
    boardTool = tool === "eraser" ? "eraser" : "pen";
    els.board?.querySelectorAll("[data-board-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.boardTool === boardTool);
    });
    els.board?.querySelector(".board-stage")?.classList.toggle("tool-eraser", boardTool === "eraser");
  }

  function undoBoardStroke() {
    socket.emit("canvas_undo");
  }

  function openCanvasView(payload) {
    path = CANVAS_PATH;
    boardStrokes = Array.isArray(payload?.strokes) ? payload.strokes.slice() : [];
    ensureTab(CANVAS_PATH, "canvas");
    els.path.textContent = "Canvas";
    showCanvasMode();
    if (me) {
      me.path = CANVAS_PATH;
      peers.set(me.id, { ...(peers.get(me.id) || {}), ...me, path: CANVAS_PATH });
    }
    renderRoster();
    paintTreeWatchers();
    redrawBoard();
  }

  function renderCell(cell, index) {
    const running = cell.status === "running" ? "running" : "";
    const isMd = cell.type === "markdown";
    const drag = `<button type="button" class="cell-drag" draggable="true" title="Arrastrar" aria-label="Arrastrar celda">⋮⋮</button>`;
    const presence = `<div class="cell-presence" data-presence></div>`;
    if (isMd) {
      const empty = !(cell.source || "").trim();
      return `<article class="cell cell-md${empty ? " editing" : ""}" data-id="${cell.id}" data-type="markdown">
        <div class="cell-gutter">
          ${drag}
          <span class="cell-index">Md</span>
          <div class="cell-actions">
            <button type="button" class="icon-btn" data-action="to-code" title="Convertir a código">Code</button>
            <button type="button" class="icon-btn" data-action="add">+</button>
            <button type="button" class="icon-btn danger" data-action="delete">×</button>
          </div>
        </div>
        <div class="cell-body">
          ${presence}
          <div class="md-preview${empty ? " hidden" : ""}"></div>
          <textarea class="cell-source${empty ? "" : " hidden"}" spellcheck="true" rows="1">${escapeHtml(cell.source || "")}</textarea>
        </div>
      </article>`;
    }
    const exec = cell.execution_count != null ? cell.execution_count : index + 1;
    return `<article class="cell ${running}" data-id="${cell.id}" data-type="code">
      <div class="cell-gutter">
        ${drag}
        <span class="cell-index">In [${exec}]</span>
        <div class="cell-actions">
          <button type="button" class="icon-btn primary" data-action="run">Run</button>
          <button type="button" class="icon-btn" data-action="to-md" title="Convertir a markdown">Md</button>
          <button type="button" class="icon-btn" data-action="add">+</button>
          <button type="button" class="icon-btn danger" data-action="delete">×</button>
        </div>
      </div>
      <div class="cell-body">
        ${presence}
        <div class="code-wrap">
          <pre class="code-highlight" aria-hidden="true"><code class="language-python"></code></pre>
          <textarea class="cell-source" spellcheck="false" rows="1">${escapeHtml(cell.source || "")}</textarea>
        </div>
        <div class="outputs">${renderOutputs(cell.outputs)}</div>
      </div>
    </article>`;
  }

  function hideEditorSurfaces() {
    els.cells.classList.add("hidden");
    els.btnAddEnd?.classList.add("hidden");
    els.btnAddMd?.classList.add("hidden");
    els.btnAddEnd?.closest(".add-cell-row")?.classList.add("hidden");
    els.preview.classList.add("hidden");
    els.board?.classList.add("hidden");
  }

  function showNotebookMode() {
    viewMode = "notebook";
    hideEditorSurfaces();
    els.cells.classList.remove("hidden");
    els.btnAddEnd?.classList.remove("hidden");
    els.btnAddMd?.classList.remove("hidden");
    els.btnAddEnd?.closest(".add-cell-row")?.classList.remove("hidden");
    els.statusKind.textContent = ".ipynb";
    els.statusLang.textContent = "Python";
    els.title.disabled = false;
    els.btnRestart.disabled = false;
    els.btnCanvas?.classList.remove("active");
  }

  function showCsvMode() {
    viewMode = "csv";
    hideEditorSurfaces();
    els.preview.classList.remove("hidden");
    els.statusKind.textContent = ".csv";
    els.statusLang.textContent = "Preview";
    els.title.value = "";
    els.title.disabled = true;
    els.btnRestart.disabled = true;
    els.btnCanvas?.classList.remove("active");
  }

  function showCanvasMode() {
    viewMode = "canvas";
    hideEditorSurfaces();
    els.board?.classList.remove("hidden");
    els.statusKind.textContent = "canvas";
    els.statusLang.textContent = "Draw";
    els.title.value = "Canvas";
    els.title.disabled = true;
    els.btnRestart.disabled = true;
    els.btnCanvas?.classList.add("active");
    queueMicrotask(() => resizeBoardCanvas());
  }

  function renderCsvPreview(data) {
    showCsvMode();
    path = data.path;
    ensureTab(path, "csv");
    els.path.textContent = path;
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
    ensureTab(path, "notebook");
    els.title.value = notebook.title || "";
    els.path.textContent = path || "—";
    els.cells.innerHTML = notebook.cells.map((c, i) => renderCell(c, i)).join("");
    applyingRemote = false;
    enhanceAllCells();
    paintTreeWatchers();
  }

  function updateCellDom(cellId) {
    const cell = notebook.cells.find((c) => c.id === cellId);
    if (!cell) return;
    const idx = cellIndex(cellId);
    const existing = els.cells.querySelector(`[data-id="${CSS.escape(cellId)}"]`);
    const wasEditing = existing?.classList.contains("editing");
    const html = renderCell(cell, idx);
    if (existing) {
      const active = document.activeElement;
      const keepFocus = active && existing.contains(active) && active.classList.contains("cell-source");
      const selStart = keepFocus ? active.selectionStart : null;
      const selEnd = keepFocus ? active.selectionEnd : null;
      existing.outerHTML = html;
      const nextEl = els.cells.querySelector(`[data-id="${CSS.escape(cellId)}"]`);
      if (nextEl && (wasEditing || keepFocus) && nextEl.dataset.type === "markdown") {
        nextEl.classList.add("editing");
      }
      enhanceCell(nextEl);
      if (keepFocus) {
        const next = nextEl?.querySelector(".cell-source");
        if (next) {
          next.classList.remove("hidden");
          next.focus();
          if (selStart != null) next.setSelectionRange(selStart, selEnd);
          autosizeTextarea(next);
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

  const CHAT_EMOJIS = ["👍", "👎", "💩", "🤡"];

  function renderReactionBar() {
    return `<div class="chat-react-bar" role="group" aria-label="Reacciones">
      ${CHAT_EMOJIS.map(
        (e) =>
          `<button type="button" class="chat-react-pick" data-react="${e}" title="${e}">${e}</button>`
      ).join("")}
    </div>`;
  }

  function renderReactionChips(reactions) {
    const entries = Object.entries(reactions || {}).filter(([, users]) => users?.length);
    if (!entries.length) return `<div class="chat-react-chips"></div>`;
    return `<div class="chat-react-chips">
      ${entries
        .map(([emoji, users]) => {
          const mine = me && users.some((u) => u.id === me.id);
          const names = users.map((u) => u.name).join(", ");
          return `<button type="button" class="chat-react-chip${mine ? " mine" : ""}" data-react="${emoji}" title="${escapeHtml(names)}">
            <span>${emoji}</span><span class="n">${users.length}</span>
          </button>`;
        })
        .join("")}
    </div>`;
  }

  function updateChatReactions(msgId, reactions) {
    const el = els.chatLog.querySelector(`.chat-msg[data-id="${CSS.escape(msgId)}"]`);
    if (!el) return;
    const chips = el.querySelector(".chat-react-chips");
    const html = renderReactionChips(reactions);
    if (chips) chips.outerHTML = html;
    else el.insertAdjacentHTML("beforeend", html);
  }

  function appendChat(msg, opts = {}) {
    if (msg.type === "system") {
      els.chatLog.insertAdjacentHTML(
        "beforeend",
        `<div class="chat-msg chat-msg-system" data-id="${escapeHtml(msg.id)}">
          <span class="chat-system-text">${escapeHtml(msg.text || "")}</span>
        </div>`
      );
      els.chatLog.scrollTop = els.chatLog.scrollHeight;
      return;
    }
    const mine = me && msg.user?.id === me.id;
    els.chatLog.insertAdjacentHTML(
      "beforeend",
      `<div class="chat-msg" data-id="${escapeHtml(msg.id)}">
        ${renderReactionBar()}
        <div class="chat-msg-head">
          ${avatarHtml(msg.user?.name || "User", msg.user?.color || "#888")}
          <span class="chat-msg-name" style="--c:${msg.user?.color || "#888"}">${escapeHtml(msg.user?.name || "User")}${mine ? " (vos)" : ""}</span>
          <span class="chat-msg-time">${formatTime(msg.at)}</span>
        </div>
        <div class="chat-msg-text">${formatChatText(msg.text)}</div>
        ${renderReactionChips(msg.reactions)}
      </div>`
    );
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
    if (!opts.silent && !mine && !isChatVisible()) {
      unreadChat += 1;
      updateUnreadBadge();
    }
  }

  // ---- home events ----
  els.btnNewProject?.addEventListener("click", () => {
    if (!requireAccount("crear un proyecto")) return;
    if (els.newProjectName) els.newProjectName.value = "";
    openModal(els.modalNewProject);
    els.newProjectName?.focus();
  });
  els.btnJoinSession?.addEventListener("click", () => openModal(els.modalJoin));
  els.btnCloneGit?.addEventListener("click", () => {
    if (!requireAccount("clonar con git")) return;
    if (els.cloneLog) {
      els.cloneLog.classList.add("hidden");
      els.cloneLog.textContent = "";
    }
    openModal(els.modalClone);
  });
  els.btnAddFriends?.addEventListener("click", () => openModal(els.modalFriends));
  els.btnHomeAccount?.addEventListener("click", () => openModal(els.modalAccount));
  els.btnFriendsToAccount?.addEventListener("click", () => openModal(els.modalAccount));

  els.newProjectForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showHomeError("");
    try {
      const data = await api("/api/projects", {
        method: "POST",
        body: { name: els.newProjectName.value || "Proyecto" },
      });
      applySession(data);
      const pid = data.created?.id || data.project?.id;
      if (pid) {
        closeModals();
        showEditor();
        socket.emit("join_project", { project_id: pid });
      }
    } catch (err) {
      showHomeError(err.message);
    }
  });

  homeEl?.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-modal]")) closeModals();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModals();
  });

  document.querySelectorAll(".auth-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.dataset.auth;
      els.registerForm.classList.toggle("hidden", mode !== "register");
      els.loginForm.classList.toggle("hidden", mode !== "login");
    });
  });

  els.regColors?.addEventListener("click", (e) => {
    const sw = e.target.closest("[data-color]");
    if (!sw) return;
    selectedColor = sw.dataset.color;
    renderColorPicker(sessionState?.colors || []);
  });

  els.registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showHomeError("");
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: {
          name: els.regName.value,
          password: els.regPassword.value,
          color: selectedColor,
        },
      });
      applySession(data);
      els.regPassword.value = "";
      closeModals();
    } catch (err) {
      showHomeError(err.message);
    }
  });

  els.loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showHomeError("");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: { name: els.loginName.value, password: els.loginPassword.value },
      });
      applySession(data);
      els.loginPassword.value = "";
      closeModals();
    } catch (err) {
      showHomeError(err.message);
    }
  });

  els.btnLogout?.addEventListener("click", async () => {
    showHomeError("");
    try {
      const data = await api("/api/auth/guest", { method: "POST", body: {} });
      applySession(data);
      closeModals();
    } catch (err) {
      showHomeError(err.message);
    }
  });

  els.joinForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showHomeError("");
    try {
      const data = await api("/api/projects/join", {
        method: "POST",
        body: { code: els.joinCode.value },
      });
      applySession(data);
      const pid = data.joined?.id || data.project?.id;
      if (pid) {
        els.joinCode.value = "";
        closeModals();
        showEditor();
        socket.emit("join_project", { project_id: pid });
      }
    } catch (err) {
      showHomeError(err.message);
    }
  });

  els.cloneForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showHomeError("");
    if (els.cloneSubmit) els.cloneSubmit.disabled = true;
    if (els.cloneLog) {
      els.cloneLog.classList.remove("hidden");
      els.cloneLog.textContent = "Clonando…";
    }
    try {
      const data = await api("/api/projects/clone", {
        method: "POST",
        body: { url: els.cloneUrl.value, name: els.cloneName.value },
      });
      applySession(data);
      const pid = data.created?.id || data.project?.id;
      if (pid) {
        closeModals();
        showEditor();
        socket.emit("join_project", { project_id: pid });
      }
    } catch (err) {
      if (els.cloneLog) els.cloneLog.textContent = err.message;
      else showHomeError(err.message);
    } finally {
      if (els.cloneSubmit) els.cloneSubmit.disabled = false;
    }
  });

  function onProjectListClick(e) {
    const open = e.target.closest("[data-open-project]");
    if (open) {
      openProject(open.dataset.openProject).catch((err) => showHomeError(err.message));
    }
  }

  els.projectList?.addEventListener("click", onProjectListClick);  els.friendRequestForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showHomeError("");
    try {
      const data = await api("/api/friends/request", {
        method: "POST",
        body: { name: els.friendName.value },
      });
      applySession(data);
      els.friendName.value = "";
    } catch (err) {
      showHomeError(err.message);
    }
  });

  els.pendingList?.addEventListener("click", async (e) => {
    const accept = e.target.closest("[data-friend-accept]");
    const reject = e.target.closest("[data-friend-reject]");
    const id = accept?.dataset.friendAccept || reject?.dataset.friendReject;
    if (!id) return;
    try {
      const data = await api("/api/friends/respond", {
        method: "POST",
        body: { id, accept: Boolean(accept) },
      });
      applySession(data);
    } catch (err) {
      showHomeError(err.message);
    }
  });

  els.friendsList?.addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-friend-remove]");
    if (!rm) return;
    try {
      const data = await api(`/api/friends/${rm.dataset.friendRemove}`, { method: "DELETE" });
      applySession(data);
    } catch (err) {
      showHomeError(err.message);
    }
  });

  els.btnCopyCode?.addEventListener("click", async () => {
    const code = els.inviteCodeDisplay?.textContent || "";
    if (!code || code === "———") return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      prompt("Código:", code);
    }
  });

  els.btnRegenCode?.addEventListener("click", async () => {
    const pid = sessionState?.project?.id;
    if (!pid) return;
    try {
      const data = await api(`/api/projects/${pid}/regen-code`, { method: "POST", body: {} });
      applySession(data);
      if (data.project) updateProjectChrome(data.project);
    } catch (err) {
      alert(err.message);
    }
  });

  els.friendsInviteList?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-invite-friend]");
    if (!btn) return;
    const pid = sessionState?.project?.id;
    if (!pid) return;
    try {
      const data = await api(`/api/projects/${pid}/invite`, {
        method: "POST",
        body: { friend_id: btn.dataset.inviteFriend },
      });
      applySession(data);
      if (data.project || data.project_updated) {
        updateProjectChrome(data.project_updated || data.project);
      }
    } catch (err) {
      alert(err.message);
    }
  });

  // ---- editor events ----
  els.cells.addEventListener("input", (e) => {
    if (applyingRemote) return;
    const ta = e.target.closest(".cell-source");
    if (!ta) return;
    const cellEl = ta.closest(".cell");
    autosizeTextarea(ta);
    if (cellEl?.dataset.type === "code") paintCodeHighlight(cellEl);
    scheduleSourceEmit(cellEl.dataset.id, ta.value);
    scheduleTypingPresence(cellEl.dataset.id);
  });

  els.cells.addEventListener("focusout", (e) => {
    const ta = e.target.closest(".cell-source");
    if (ta) {
      const id = ta.closest(".cell")?.dataset.id;
      if (id) {
        clearTimeout(presenceTimers.get(id));
        presenceTimers.delete(id);
        emitPresence(id, null);
      }
    }
  });

  els.cells.addEventListener("dragstart", (e) => {
    const handle = e.target.closest(".cell-drag");
    if (!handle) {
      e.preventDefault();
      return;
    }
    const cellEl = handle.closest(".cell");
    if (!cellEl) return;
    dragCellId = cellEl.dataset.id;
    cellEl.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragCellId);
    emitPresence(dragCellId, "dragging");
  });

  els.cells.addEventListener("dragend", (e) => {
    const cellEl = e.target.closest(".cell");
    cellEl?.classList.remove("is-dragging");
    els.cells.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    if (dragCellId) emitPresence(dragCellId, null);
    dragCellId = null;
  });

  els.cells.addEventListener("dragover", (e) => {
    if (!dragCellId) return;
    e.preventDefault();
    const over = e.target.closest(".cell");
    els.cells.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    if (over && over.dataset.id !== dragCellId) over.classList.add("drag-over");
  });

  els.cells.addEventListener("drop", (e) => {
    e.preventDefault();
    const over = e.target.closest(".cell");
    els.cells.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    const fromId = dragCellId || e.dataTransfer.getData("text/plain");
    if (!fromId || !over) return;
    const toId = over.dataset.id;
    if (!toId || toId === fromId) return;
    const from = notebook.cells.findIndex((c) => c.id === fromId);
    if (from < 0) return;
    const rect = over.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const [cell] = notebook.cells.splice(from, 1);
    let to = notebook.cells.findIndex((c) => c.id === toId);
    if (to < 0) notebook.cells.push(cell);
    else {
      if (after) to += 1;
      notebook.cells.splice(to, 0, cell);
    }
    const toIndex = notebook.cells.findIndex((c) => c.id === fromId);
    socket.emit("cell_move", { id: fromId, to_index: toIndex });
    emitPresence(fromId, null);
    dragCellId = null;
    renderNotebook();
  });

  els.cells.addEventListener("keydown", (e) => {
    const ta = e.target.closest(".cell-source");
    if (!ta) return;
    const cellEl = ta.closest(".cell");
    if (e.key === "Escape" && cellEl?.dataset.type === "markdown") {
      e.preventDefault();
      ta.blur();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (cellEl?.dataset.type === "markdown") {
        setMarkdownEditing(cellEl, false);
        return;
      }
      socket.emit("run_cell", { id: cellEl.dataset.id, source: ta.value });
    }
  });

  els.cells.addEventListener("focusin", (e) => {
    const ta = e.target.closest(".cell-source");
    if (!ta) return;
    const cellEl = ta.closest(".cell");
    if (cellEl?.dataset.type === "markdown") setMarkdownEditing(cellEl, true);
  });

  els.cells.addEventListener("focusout", (e) => {
    const cellEl = e.target.closest(".cell");
    if (!cellEl || cellEl.dataset.type !== "markdown") return;
    const next = e.relatedTarget;
    if (next && cellEl.contains(next)) return;
    queueMicrotask(() => {
      if (cellEl.contains(document.activeElement)) return;
      setMarkdownEditing(cellEl, false);
    });
  });

  els.cells.addEventListener("click", (e) => {
    const preview = e.target.closest(".md-preview");
    if (preview) {
      const cellEl = preview.closest(".cell");
      if (cellEl?.dataset.type === "markdown") setMarkdownEditing(cellEl, true);
      return;
    }
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const cellEl = btn.closest(".cell");
    const id = cellEl.dataset.id;
    const action = btn.dataset.action;
    if (action === "run") {
      socket.emit("run_cell", { id, source: cellEl.querySelector(".cell-source").value });
    } else if (action === "add") {
      socket.emit("cell_add", { after_id: id, type: "code" });
    } else if (action === "to-md") {
      socket.emit("cell_type", { id, type: "markdown" });
    } else if (action === "to-code") {
      socket.emit("cell_type", { id, type: "code" });
    } else if (action === "delete") {
      socket.emit("cell_delete", { id });
    }
  });

  els.btnAddEnd.addEventListener("click", () => {
    const last = notebook.cells[notebook.cells.length - 1];
    socket.emit("cell_add", { after_id: last ? last.id : null, type: "code" });
  });

  els.btnAddMd?.addEventListener("click", () => {
    const last = notebook.cells[notebook.cells.length - 1];
    socket.emit("cell_add", { after_id: last ? last.id : null, type: "markdown" });
  });

  els.title.addEventListener("input", () => {
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => {
      notebook.title = els.title.value;
      socket.emit("title", { title: els.title.value });
    }, 150);
  });

  els.name.addEventListener("input", () => {
    if (sessionState?.identity?.type !== "guest") return;
    const name = els.name.value.trim();
    if (name) socket.emit("rename", { name });
  });

  els.btnRestart.addEventListener("click", () => socket.emit("kernel_restart"));
  els.btnUpload.addEventListener("click", () => els.folderInput.click());
  els.btnHome?.addEventListener("click", () => leaveToHome());

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

  els.btnNew.addEventListener("click", () => createNotebook());
  els.btnTabAdd?.addEventListener("click", () => createNotebook());

  els.tabs?.addEventListener("click", (e) => {
    const close = e.target.closest("[data-close]");
    if (close) {
      e.preventDefault();
      e.stopPropagation();
      removeTab(close.dataset.close);
      return;
    }
    const tab = e.target.closest("[data-tab]");
    if (!tab) return;
    const target = tab.dataset.tab;
    if (target && target !== path) openTabTarget(target);
  });

  els.tree.addEventListener("toggle", (e) => {
    const details = e.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    if (details.dataset.lazy !== "1") return;
    const dirPath = details.dataset.path || "";
    details.dataset.lazy = "loading";
    expandTreeDir(dirPath).catch((err) => {
      details.dataset.lazy = "1";
      const box = details.querySelector(".tree-children");
      if (box) box.innerHTML = `<div class="tree-truncated">${escapeHtml(err.message)}</div>`;
    });
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
    if (ext === ".ipynb" || ext === ".csv") {
      socket.emit("open_path", { path: file.dataset.path });
    }
  });

  function openSide(mode) {
    localStorage.setItem(sideKey, mode);
    localStorage.setItem(explorerKey, "0");
    if (isMobile()) {
      app.classList.add("show-explorer");
      app.classList.remove("show-chat");
    }
    applyLayout();
  }

  els.btnExplorer.addEventListener("click", () => {
    if (isMobile()) {
      openSide("explorer");
      return;
    }
    if (sideMode() !== "explorer") openSide("explorer");
    else {
      const next = localStorage.getItem(explorerKey) === "1" ? "0" : "1";
      localStorage.setItem(explorerKey, next);
      applyLayout();
    }
  });

  els.btnFriends?.addEventListener("click", () => {
    openSide("friends");
    renderProjectPeers();
    if (sessionState?.project) renderFriendsInvite(sessionState.project);
  });

  els.btnCanvas?.addEventListener("click", () => {
    ensureTab(CANVAS_PATH, "canvas");
    openTabTarget(CANVAS_PATH);
  });

  els.board?.addEventListener("click", (e) => {
    const toolBtn = e.target.closest("[data-board-tool]");
    if (toolBtn) {
      setBoardTool(toolBtn.dataset.boardTool);
      return;
    }
  });

  els.btnBoardUndo?.addEventListener("click", () => undoBoardStroke());

  function onBoardPointerDown(e) {
    if (viewMode !== "canvas" || !els.boardCanvas) return;
    boardDrawing = true;
    boardPoints = [normBoardPoint(e)];
    els.boardCanvas.setPointerCapture?.(e.pointerId);
    redrawBoard();
  }

  function onBoardPointerMove(e) {
    if (!boardDrawing) return;
    boardPoints.push(normBoardPoint(e));
    if (boardPoints.length % 2 === 0) redrawBoard();
  }

  function onBoardPointerUp(e) {
    if (!boardDrawing) return;
    boardDrawing = false;
    if (e) boardPoints.push(normBoardPoint(e));
    if (boardPoints.length >= 2) {
      const stroke = {
        id: `${me?.id || "local"}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        tool: boardTool,
        width: boardTool === "eraser" ? 18 : 3,
        color: me?.color || "#dadada",
        points: boardPoints,
      };
      boardStrokes.push(stroke);
      socket.emit("canvas_stroke", stroke);
      redrawBoard();
    }
    boardPoints = [];
  }

  els.boardCanvas?.addEventListener("pointerdown", onBoardPointerDown);
  els.boardCanvas?.addEventListener("pointermove", onBoardPointerMove);
  els.boardCanvas?.addEventListener("pointerup", onBoardPointerUp);
  els.boardCanvas?.addEventListener("pointercancel", () => onBoardPointerUp());
  els.boardCanvas?.addEventListener("pointerleave", (e) => {
    if (boardDrawing) onBoardPointerUp(e);
  });

  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
    if (viewMode !== "canvas") return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault();
    undoBoardStroke();
  });

  window.addEventListener("resize", () => {
    if (viewMode === "canvas") resizeBoardCanvas();
  });

  els.btnPackages.addEventListener("click", () => {
    openSide("packages");
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

  function toggleChat() {
    if (isMobile()) {
      app.classList.toggle("show-chat");
      app.classList.remove("show-explorer");
      if (app.classList.contains("show-chat")) clearUnreadChat();
      applyLayout();
      return;
    }
    const next = localStorage.getItem(chatKey) === "1" ? "0" : "1";
    localStorage.setItem(chatKey, next);
    applyLayout();
  }

  els.btnChatToggle.addEventListener("click", toggleChat);
  els.btnChatRail.addEventListener("click", toggleChat);

  els.chatLog.addEventListener("click", (e) => {
    const reactBtn = e.target.closest("[data-react]");
    if (reactBtn) {
      const msgEl = reactBtn.closest(".chat-msg");
      const emoji = reactBtn.dataset.react;
      if (msgEl?.dataset.id && emoji) {
        socket.emit("chat_react", { id: msgEl.dataset.id, emoji });
      }
      return;
    }
    const mention = e.target.closest("[data-open-path]");
    if (!mention) return;
    const rel = mention.dataset.openPath;
    if (!rel) return;
    const lower = rel.toLowerCase();
    if (lower.endsWith(".ipynb") || lower.endsWith(".csv")) {
      openTabTarget(rel);
    }
  });

  els.chatMentionMenu?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mention-idx]");
    if (!btn) return;
    const idx = Number(btn.dataset.mentionIdx);
    const item = mentionState.items[idx];
    if (item) applyMention(item);
  });

  els.chatInput?.addEventListener("input", () => refreshMentionMenu());
  els.chatInput?.addEventListener("click", () => refreshMentionMenu());
  els.chatInput?.addEventListener("keydown", (e) => {
    if (!mentionState.open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      mentionState.index = (mentionState.index + 1) % mentionState.items.length;
      renderMentionMenu();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      mentionState.index = (mentionState.index - 1 + mentionState.items.length) % mentionState.items.length;
      renderMentionMenu();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applyMention(mentionState.items[mentionState.index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMentionMenu();
    }
  });

  els.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    closeMentionMenu();
    const text = els.chatInput.value.trim();
    if (!text) return;
    socket.emit("chat", { text });
    els.chatInput.value = "";
  });

  window.addEventListener("resize", applyLayout);

  window.addEventListener("pointermove", (e) => {
    if (!me || !inProject) return;
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    me.x = x;
    me.y = y;
    const now = performance.now();
    if (now - lastCursorSent < 20) return;
    lastCursorSent = now;
    socket.volatile.emit("cursor", { x, y });
  });

  // ---- sockets ----
  socket.on("you", (data) => {
    me = data;
    if (els.name && document.activeElement !== els.name) els.name.value = data.name;
    setIdentityAvatar(els.activityUser, data.name, data.color);
    setIdentityAvatar(els.homeDot, data.name, data.color);
    peers.set(data.id, data);
    removeCursor(data.id);
    renderRoster();
    renderProjectPeers();
  });

  socket.on("session", (data) => {
    applySession(data);
    if (data.project) {
      showEditor();
    } else {
      showHome();
    }
  });

  socket.on("project_joined", (payload) => {
    showEditor();
    peers.clear();
    els.cursors.innerHTML = "";
    (payload.peers || []).forEach(upsertPeer);
    if (payload.tree) setTree(payload.tree);
    els.chatLog.innerHTML = "";
    clearUnreadChat();
    (payload.chat?.messages || []).forEach((m) => appendChat(m, { silent: true }));
    if (payload.project) {
      if (sessionState) sessionState.project = payload.project;
      updateProjectChrome(payload.project);
    }
    openTabs = [];
    if (payload.notebook?.notebook) {
      path = payload.notebook.path;
      notebook = payload.notebook.notebook;
      if (me) {
        me.path = path;
        peers.set(me.id, { ...(peers.get(me.id) || {}), ...me, path });
      }
      renderNotebook();
    }
    renderRoster();
    refreshPackages();
  });

  socket.on("project_left", () => {
    showHome();
  });

  socket.on("join", upsertPeer);
  socket.on("peer_update", upsertPeer);
  socket.on("leave", ({ id }) => {
    peers.delete(id);
    removeCursor(id);
    for (const [cid, map] of cellPresence) {
      map.delete(id);
      if (!map.size) cellPresence.delete(cid);
    }
    paintAllPresence();
    renderRoster();
    paintTreeWatchers();
    renderProjectPeers();
  });
  socket.on("cursor", (data) => {
    if (me && data.id === me.id) return;
    upsertPeer(data);
  });

  socket.on("notebook", (payload) => {
    path = payload.path;
    notebook = payload.notebook;
    cellPresence.clear();
    if (me) {
      me.path = path;
      peers.set(me.id, { ...(peers.get(me.id) || {}), ...me, path });
    }
    renderNotebook();
    renderRoster();
  });

  socket.on("canvas", (payload) => {
    openCanvasView(payload || {});
  });

  socket.on("canvas_stroke", ({ path: eventPath, stroke }) => {
    if (eventPath && eventPath !== CANVAS_PATH) return;
    if (!stroke?.id) return;
    if (boardStrokes.some((s) => s.id === stroke.id)) return;
    boardStrokes.push(stroke);
    if (viewMode === "canvas") redrawBoard();
  });

  socket.on("canvas_undo", ({ path: eventPath, id }) => {
    if (eventPath && eventPath !== CANVAS_PATH) return;
    boardStrokes = boardStrokes.filter((s) => s.id !== id);
    if (viewMode === "canvas") redrawBoard();
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

  socket.on("path_deleted", ({ path: deleted }) => {
    if (!deleted) return;
    const doomed = openTabs
      .filter((t) => t.path === deleted || t.path.startsWith(deleted + "/"))
      .map((t) => t.path);
    for (const p of doomed) {
      const idx = openTabs.findIndex((t) => t.path === p);
      if (idx >= 0) openTabs.splice(idx, 1);
    }
    renderTabs();
  });

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
    const cellEl = els.cells.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const ta = cellEl?.querySelector(".cell-source");
    if (ta && document.activeElement !== ta) {
      ta.value = source;
      if (cellEl.dataset.type === "code") paintCodeHighlight(cellEl);
      else if (cellEl.classList.contains("editing")) autosizeTextarea(ta);
      else syncMarkdownPreview(cellEl);
    }
  });

  socket.on("cell_add", ({ path: eventPath, index, cell }) => {
    if (!sameFile(eventPath)) return;
    notebook.cells.splice(index, 0, cell);
    renderNotebook();
    const el = els.cells.querySelector(`[data-id="${CSS.escape(cell.id)}"]`);
    if (!el) return;
    if (cell.type === "markdown") setMarkdownEditing(el, true);
    else el.querySelector(".cell-source")?.focus();
  });

  socket.on("cell_type", ({ path: eventPath, id, type, cell: remoteCell }) => {
    if (!sameFile(eventPath)) return;
    const cell = notebook.cells.find((c) => c.id === id);
    if (!cell) return;
    if (remoteCell) Object.assign(cell, remoteCell);
    else {
      cell.type = type;
      if (type === "markdown") {
        cell.outputs = [];
        cell.status = "idle";
        cell.execution_count = null;
      }
    }
    updateCellDom(id);
  });

  socket.on("cell_delete", ({ path: eventPath, id }) => {
    if (!sameFile(eventPath)) return;
    notebook.cells = notebook.cells.filter((c) => c.id !== id);
    cellPresence.delete(id);
    renderNotebook();
  });

  socket.on("cell_move", ({ path: eventPath, order }) => {
    if (!sameFile(eventPath)) return;
    applyCellOrder(order);
  });

  socket.on("cell_presence", ({ path: eventPath, cell_id, action, user }) => {
    if (!sameFile(eventPath)) return;
    if (me && user?.id === me.id) return;
    setRemotePresence(user, cell_id, action);
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

  socket.on("chat", appendChat);

  socket.on("chat_react", ({ id, reactions }) => {
    if (!id) return;
    updateChatReactions(id, reactions);
  });

  socket.on("packages_updated", (payload) => {
    renderPackageList(payload.packages || []);
  });

  renderCatalog();
  refreshMe()
    .then((data) => {
      if (data.project) showEditor();
      else showHome();
    })
    .catch(() => showHome());
})();
