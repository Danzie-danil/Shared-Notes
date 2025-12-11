const SUPABASE_URL = "https://oafywoleknpytawuvcit.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hZnl3b2xla25weXRhd3V2Y2l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzMDY3MzEsImV4cCI6MjA4MDg4MjczMX0.j7UOKGI6SVpUe_o0NyEgXwDL_4_MnIkV7yjTPCO5848";
const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    multiTab: true,
    storageKey: "sn-auth-token",
    storage: window.localStorage
  }
});

const state = {
  session: null,
  profile: null,
  documents: [],
  latestByDoc: {},
  selectedDocumentId: null,
  entries: [],
  filters: { chip: "All", search: "", groupDocIds: null },
  channels: { docs: null, entries: null },
  autoScroll: true,
  editingEntryId: null,
  titleEditing: false,
  currentTab: "Notes",
  groups: [],
  pins: [],
  tags: {},
  reactions: {},
  activityFilters: { mine: false, range: null },
  activityDocId: null,
  lastOpened: {},
  compact: false,
  confirmDelete: false,
  navHistory: [],
  _navPop: false
};

function initAuth() {
  const emailEl = document.getElementById("auth-email");
  const passEl = document.getElementById("auth-password");
  const alertEl = document.getElementById("auth-alert");
  const btnLoginInit = document.getElementById("btn-login");
  const btnSignupInit = document.getElementById("btn-signup");
  if (btnLoginInit) btnLoginInit.disabled = false;
  if (btnSignupInit) btnSignupInit.disabled = false;
  if (!storageWorks()) {
    alertEl.textContent = "Enable cookies/local storage for authentication";
    alertEl.classList.remove("hidden");
  }
  function setAlert(msg, ok=false){
    alertEl.textContent = msg;
    alertEl.classList.remove("hidden");
    alertEl.classList.toggle("success", !!ok);
    alertEl.classList.toggle("error", !ok);
  }
  function clearAlert(){
    alertEl.classList.add("hidden");
    alertEl.textContent = "";
    alertEl.classList.remove("success");
  }
  document.getElementById("btn-login").addEventListener("click", async () => {
    const btnLogin = document.getElementById("btn-login");
    const btnSignup = document.getElementById("btn-signup");
    try {
      btnLogin.disabled = true;
      btnSignup.disabled = true;
      clearAlert();

      const email = emailEl.value.trim();
      const password = passEl.value;
      if (!email || !password) {
        setAlert("Enter email and password");
        return;
      }

      setAlert("Signing in...");
      const { data, error } = await client.auth.signInWithPassword({ email, password });

      if (error) {
        setAlert(error.message || "Login failed");
        return;
      }

      // Successful login; onAuthStateChange will handle loading profile, documents, and realtime
      setAlert("Logged in", true);
    } catch (err) {
      setAlert((err && err.message) ? err.message : "Unexpected error during login");
    } finally {
      btnLogin.disabled = false;
      btnSignup.disabled = false;
    }
  });
  document.getElementById("btn-signup").addEventListener("click", async () => {
    const btnLogin = document.getElementById("btn-login");
    const btnSignup = document.getElementById("btn-signup");
    try {
      btnLogin.disabled = true;
      btnSignup.disabled = true;
      clearAlert();

      const email = emailEl.value.trim();
      const password = passEl.value;
      if (!email || !password) {
        setAlert("Enter email and password");
        return;
      }

      const origin = window.location.protocol.startsWith("http") ? window.location.origin : "http://localhost:8000";

      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: origin }
      });

      if (error) {
        setAlert(error.message || "Sign up failed");
        return;
      }

      if (data && data.session) {
        // In some configurations, Supabase returns an active session immediately
        setAlert("Signed up and logged in", true);
        // onAuthStateChange will run the rest of the app bootstrap
      } else {
        // Try direct sign-in (works when email confirmation is disabled)
        const { data: signinData, error: signinErr } = await client.auth.signInWithPassword({ email, password });
        if (!signinErr && signinData && signinData.session) {
          setAlert("Signed up and logged in", true);
        } else {
          // Resend confirmation email as a fallback
          try {
            const { error: resendErr } = await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: origin } });
            if (resendErr) console.error("Resend confirmation error", resendErr);
          } catch (e) { console.error("Resend confirmation exception", e); }
          setAlert("Sign up successful. Confirmation email sent. If you don't receive it, disable 'Confirm email' or configure SMTP in Supabase Auth.", true);
          let btnResend = document.getElementById("btn-resend-confirm");
          if (!btnResend) {
            btnResend = document.createElement("button");
            btnResend.id = "btn-resend-confirm";
            btnResend.className = "btn";
            btnResend.textContent = "Resend confirmation";
            const actions = document.querySelector(".auth-actions");
            if (actions) actions.appendChild(btnResend);
          }
          btnResend.onclick = async () => {
            btnResend.disabled = true; btnResend.textContent = "Resending...";
            try {
              const { error: resendErr2 } = await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: origin } });
              if (resendErr2) { setAlert(resendErr2.message || "Resend failed"); console.error("Resend error", resendErr2); }
              else { setAlert("Confirmation email resent.", true); }
            } finally { btnResend.disabled = false; btnResend.textContent = "Resend confirmation"; }
          };
        }
      }
    } catch (err) {
      setAlert((err && err.message) ? err.message : "Unexpected error during signup");
    } finally {
      btnLogin.disabled = false;
      btnSignup.disabled = false;
    }
  });
  client.auth.onAuthStateChange(async (event, session) => {
    state.session = session;

    // Handle initial session load, fresh sign-ins, token refreshes, and user updates
  if (
    event === "INITIAL_SESSION" ||
    event === "SIGNED_IN" ||
    event === "TOKEN_REFRESHED" ||
    event === "USER_UPDATED"
  ) {
    clearAlert();
    showApp();
    try {
      await Promise.all([
        ensureProfile(),
        loadTeams(),
        loadDocuments()
      ]);
      initRealtime();
    } catch (err) {
      console.error("Error during post-auth initialization:", err);
    }
    return;
  }

    if (event === "SIGNED_OUT") {
      showAuth();
      return;
    }

    // Fallback: if we have a session but no explicit event, show the app shell
    if (session) {
      showApp();
    } else {
      showAuth();
    }
  });
  client.auth.getSession().then(({ data }) => {
    state.session = data.session;
    if (state.session) {
      // Let onAuthStateChange("INITIAL_SESSION") perform the heavy loading;
      // just show the app shell here.
      showApp();
    } else {
      showAuth();
    }
  });
}

async function ensureProfile() {
  try {
    const { data: userData, error: userErr } = await client.auth.getUser();
    if (userErr || !userData || !userData.user) return;
    const uid = userData.user.id;
    const email = userData.user.email;
    const { data: existing, error: selErr } = await client.from("users").select("*").eq("id", uid).maybeSingle();
    if (selErr) return;
    if (!existing) {
      const name = email ? email.split("@")[0] : "User";
      const color = randomColor();
      await client.from("users").insert({ id: uid, display_name: name, color, email });
    }
    else if (!existing.email && email) {
      await client.from("users").update({ email }).eq("id", uid);
    }
    const { data: profile } = await client.from("users").select("*").eq("id", uid).maybeSingle();
    state.profile = profile;
  } catch (_) {}
}

function initRealtime() {
  if (state.channels.docs) state.channels.docs.unsubscribe();
  state.channels.docs = client.channel("docs").on(
    "postgres_changes",
    { event: "*", schema: "public", table: "notebooks" },
    async () => { await loadDocuments(); }
  ).subscribe();
}

function showAuth() {
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app-screen").classList.add("hidden");
}

function showApp() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
  navigate("Notes");
}

async function loadDocuments() {
  try {
  let q = client.from("notebooks").select("id,title,created_by,created_at,updated_at,team_id").order("updated_at", { ascending: false });
    if (state.currentTeamId) q = q.eq("team_id", state.currentTeamId);
    const { data: docs, error } = await q;
    if (error) { console.error("loadDocuments error", error); state.documents = []; }
    else { state.documents = docs || []; }
  } catch (err) { console.error("loadDocuments exception", err); state.documents = []; }
  const ids = state.documents.map(d => d.id);
  state.latestByDoc = {};
  if (ids.length) {
    try {
    const { data: latest, error } = await client.from("entries").select("id,notebook_id,author_name,content,created_at").in("notebook_id", ids).order("created_at", { ascending: false });
      if (error) { console.error("loadDocuments latest entries error", error); }
      else if (latest) { for (const e of latest) { if (!state.latestByDoc[e.notebook_id]) state.latestByDoc[e.notebook_id] = e; } }
    } catch (err) { console.error("loadDocuments latest entries exception", err); }
  }
  renderDocumentsList();
}

async function createDocument() {
  const title = prompt("New document title");
  if (!title) return;
  await client.from("notebooks").insert({ title });
}

async function createDocumentInline(title) {
  const uid = (state.session && state.session.user && state.session.user.id) ? state.session.user.id : (await awaitSession())?.user?.id;
  if (!uid) return { error: { message: "Sign in to create documents" } };
  const payload = { title, created_by: uid, updated_at: new Date().toISOString(), team_id: state.currentTeamId || null };
  const { data, error } = await client.from("notebooks").insert(payload).select("id").single();
  if (error) { console.error("createDocumentInline error", error); return { error } }
  if (data && data.id) {
    const { error: memberErr } = await client.from("notebook_members").insert({ notebook_id: data.id, user_id: uid, role: "owner" });
    if (memberErr) console.error("createDocumentInline membership insert error", memberErr);
  }
  await loadDocuments();
  let id = data && data.id ? data.id : null;
  if (!id) {
    const own = state.documents.filter(d => d.created_by === uid);
    const match = own.find(d => (d.title || "") === title);
    const latest = own.slice().sort((a,b) => new Date(b.created_at || b.updated_at) - new Date(a.created_at || a.updated_at))[0];
    id = (match && match.id) || (latest && latest.id) || null;
  }
  if (id) await openDocument(id);
  return { data };
}

async function createNotebookInline(title) {
  const uid = (state.session && state.session.user && state.session.user.id) ? state.session.user.id : (await awaitSession())?.user?.id;
  if (!uid) return { error: { message: "Sign in to create notebooks" } };
  const base = { title, created_by: uid, updated_at: new Date().toISOString() };
  const payload = state.currentTeamId ? { ...base, team_id: state.currentTeamId } : base;
  try {
    const { error } = await client.from("notebooks").insert(payload);
    if (error) { console.error("createNotebookInline error", error); return { error } }
  } catch (e) { console.error("createNotebookInline exception", e); return { error: { message: e.message || "Unexpected error" } } }
  await loadDocuments();
  const own = state.documents.filter(d => d.created_by === uid);
  const match = own.find(d => (d.title || "") === title);
  const id = match && match.id ? match.id : (own.length ? own[0].id : null);
  if (id) {
    try { await openDocument(id); } catch (err) { console.error("openDocument error", err); }
    client.from("notebook_members").insert({ notebook_id: id, user_id: uid, role: "owner" }).then(({ error: memberErr }) => { if (memberErr) console.error("createNotebookInline membership insert error", memberErr); }).catch(err => console.error("createNotebookInline membership insert exception", err));
  }
  return { data: { id } };
}

function renderDocumentsList() {
  const list = document.getElementById("documents-list");
  list.innerHTML = "";
  const now = new Date();
  loadPins();
  loadTags();
  loadLastOpened();
  const filtered = state.documents.filter(d => {
    const latest = state.latestByDoc[d.id];
    const tags = (state.tags && state.tags[d.id]) ? state.tags[d.id].join(" ") : "";
    const text = ((d.title || "") + " " + tags + " " + (latest ? (latest.author_name + ": " + (latest.content || "")) : "")).toLowerCase();
    const s = state.filters.search.toLowerCase();
    if (s && !text.includes(s)) return false;
    if (state.filters.groupDocIds && !state.filters.groupDocIds.includes(d.id)) return false;
    if (state.filters.chip === "Mine" && state.session && d.created_by !== state.session.user.id) return false;
    if (state.filters.chip === "Shared" && state.session && d.created_by === state.session.user.id) return false;
    if (state.filters.chip === "Pinned" && !state.pins.includes(d.id)) return false;
    if (state.filters.chip === "Unread") {
      const latestTime = latest ? new Date(latest.created_at) : new Date(d.updated_at || d.created_at);
      const opened = state.lastOpened[d.id] ? new Date(state.lastOpened[d.id]) : null;
      if (opened && latestTime <= opened) return false;
    }
    if (state.filters.chip === "Today") {
      const a = latest ? new Date(latest.created_at) : new Date(d.updated_at || d.created_at);
      const isToday = sameDay(a, now);
      if (!isToday) return false;
    }
    if (state.filters.chip === "This Week") {
      const a = latest ? new Date(latest.created_at) : new Date(d.updated_at || d.created_at);
      if (!sameWeek(a, now)) return false;
    }
    return true;
  });
  const sorted = filtered.slice().sort((a,b) => {
    const ap = state.pins.includes(a.id) ? 1 : 0;
    const bp = state.pins.includes(b.id) ? 1 : 0;
    if (ap !== bp) return bp - ap; // pinned first
    const at = new Date((state.latestByDoc[a.id]?.created_at) || a.updated_at || a.created_at);
    const bt = new Date((state.latestByDoc[b.id]?.created_at) || b.updated_at || b.created_at);
    return bt - at;
  });
  for (const d of sorted) {
    const li = document.createElement("li");
    li.className = "doc-item";
    const avatar = document.createElement("div");
    avatar.className = "doc-avatar";
    avatar.textContent = (d.title || "?").slice(0,1).toUpperCase();
    const center = document.createElement("div");
    center.className = "doc-center";
    const title = document.createElement("div");
    title.className = "doc-title";
    title.textContent = d.title || "Untitled";
    const snippet = document.createElement("div");
    snippet.className = "doc-snippet";
    const latest = state.latestByDoc[d.id];
    snippet.textContent = latest ? (latest.author_name + ": " + (latest.content || "")) : "No entries yet";
    const tagsRow = document.createElement("div");
    tagsRow.className = "doc-right";
    const tagList = (state.tags && state.tags[d.id]) ? state.tags[d.id] : [];
    if (tagList.length) tagsRow.textContent = tagList.map(t => "#"+t).join(" ");
    center.appendChild(title);
    center.appendChild(snippet);
    if (tagList.length) center.appendChild(tagsRow);
    const right = document.createElement("div");
    right.className = "doc-right";
    const t = latest ? new Date(latest.created_at) : new Date(d.updated_at || d.created_at);
    right.textContent = humanizeTime(t);
    const pinBtn = document.createElement("button");
    pinBtn.className = "small-icon-btn";
    pinBtn.style.marginLeft = "8px";
    pinBtn.innerHTML = state.pins.includes(d.id)
      ? '<svg viewBox="0 0 24 24"><path d="M9 3l6 6-2 2 5 5-2 2-5-5-2 2-6-6z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M16 3l5 5-2 2-2-2-4 4 2 2-2 2-6-6 2-2 2 2 4-4-2-2 2-2z"/></svg>';
    pinBtn.addEventListener("click", (ev) => { ev.stopPropagation(); togglePin(d.id); renderDocumentsList(); });
    li.appendChild(avatar);
    li.appendChild(center);
    li.appendChild(right);
    li.appendChild(pinBtn);
    const latestTime = latest ? new Date(latest.created_at) : new Date(d.updated_at || d.created_at);
    const opened = state.lastOpened[d.id] ? new Date(state.lastOpened[d.id]) : null;
    if (!opened || latestTime > opened) {
      const dot = document.createElement("span");
      dot.className = "unread-dot";
      li.appendChild(dot);
    }
    li.addEventListener("click", () => openDocument(d.id));
    list.appendChild(li);
  }
}

async function openDocument(id) {
  navigate("Notes");
  state.selectedDocumentId = id;
  document.getElementById("document-detail").classList.remove("hidden");
  const dl = document.getElementById("documents-list");
  if (dl && dl.parentElement) dl.parentElement.scrollTop = 0;
  const doc = state.documents.find(x => x.id === id);
  document.getElementById("document-title").textContent = doc ? (doc.title || "Untitled") : "Notebook";
  markDocOpened(id);
  await loadEntries(id);
  await loadReactionsForEntries(id);
  await loadEntryFilesForEntries(id);
  if (state.channels.entries) state.channels.entries.unsubscribe();
  state.channels.entries = client.channel("entries-" + id).on(
    "postgres_changes",
    { event: "*", schema: "public", table: "entries", filter: "notebook_id=eq." + id },
    payload => handleEntryRealtime(payload)
  ).subscribe();
  if (state.channels.reactions) state.channels.reactions.unsubscribe && state.channels.reactions.unsubscribe();
  state.channels.reactions = client.channel("reactions-" + id).on(
    "postgres_changes",
    { event: "*", schema: "public", table: "entry_reactions" },
    payload => handleReactionRealtime(payload)
  ).subscribe();
  updateBackButton();
}

function handleEntryRealtime(payload) {
  if (!state.selectedDocumentId) return;
  const e = payload.new || payload.old;
  if (payload.eventType === "INSERT") {
    state.entries.push(payload.new);
  }
  if (payload.eventType === "UPDATE") {
    const i = state.entries.findIndex(x => x.id === payload.new.id);
    if (i !== -1) state.entries[i] = payload.new;
  }
  if (payload.eventType === "DELETE") {
    const i = state.entries.findIndex(x => x.id === e.id);
    if (i !== -1) state.entries.splice(i,1);
  }
  const list = document.getElementById("entries-list");
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  renderEntriesList();
  if (nearBottom || state.autoScroll) list.scrollTop = list.scrollHeight;
}

async function loadEntries(documentId) {
  try {
  const { data, error } = await client.from("entries").select("id,notebook_id,author_id,author_name,author_color,content,created_at,updated_at,is_deleted").eq("notebook_id", documentId).order("created_at", { ascending: false }).limit(50);
    if (error) { console.error("loadEntries error", error); state.entries = []; }
    else { state.entries = (data || []).slice().reverse(); }
  } catch (err) { console.error("loadEntries exception", err); state.entries = []; }
  state.entriesHasMore = true;
  renderEntriesList();
  const list = document.getElementById("entries-list");
  list.scrollTop = list.scrollHeight;
}

async function loadOlderEntries() {
  if (!state.selectedDocumentId || !state.entries.length) return;
  const oldest = state.entries[0].created_at;
  const { data } = await client.from("entries").select("id,notebook_id,author_id,author_name,author_color,content,created_at,updated_at,is_deleted").eq("notebook_id", state.selectedDocumentId).lt("created_at", oldest).order("created_at", { ascending: false }).limit(50);
  const older = (data || []).slice().reverse();
  if (!older.length) { state.entriesHasMore = false; showToast("No older messages", "success"); return; }
  state.entries = older.concat(state.entries);
  renderEntriesList(true);
}

async function createEntry(documentId, content) {
  if (!content || !content.trim()) return;
  const btn = document.getElementById("btn-add-entry");
  const err = document.getElementById("entry-error");
  const prevText = btn.textContent; btn.textContent = "Adding..."; btn.disabled = true; err.classList.add("hidden");
  const uid = state.session && state.session.user ? state.session.user.id : null;
  const name = state.profile && state.profile.display_name ? state.profile.display_name : "Author";
  const color = state.profile && state.profile.color ? state.profile.color : "#888";
  const { data, error } = await client.from("entries").insert({ notebook_id: documentId, content, author_id: uid, author_name: name, author_color: color }).select("id").single();
  if (error) { console.error("createEntry error", error); err.textContent = error.message || "Failed to add entry"; err.classList.remove("hidden"); btn.disabled = false; btn.textContent = prevText; return; }
  const entryId = data && data.id;
  if (entryId && state.pendingFiles && state.pendingFiles.length) {
    for (const f of state.pendingFiles) {
      await client.from("entry_files").insert({ entry_id: entryId, user_id: uid, file_name: f.file_name, file_url: f.file_url });
    }
    state.pendingFiles = [];
    document.getElementById("pending-files").classList.add("hidden");
    document.getElementById("pending-files").innerHTML = "";
  }
  const optimistic = { id: entryId || ("temp-"+Date.now()), notebook_id: documentId, author_id: uid, author_name: name, author_color: color, content, created_at: new Date().toISOString(), is_deleted: false };
  state.entries.push(optimistic);
  renderEntriesList();
  const list = document.getElementById("entries-list");
  if (state.autoScroll) list.scrollTop = list.scrollHeight;
  const ta = document.getElementById("entry-text");
  ta.value = "";
  document.getElementById("char-count").textContent = "0";
  btn.disabled = false; btn.textContent = prevText;
}

async function editEntry(entryId, content) {
  await client.from("entries").update({ content, updated_at: new Date().toISOString() }).eq("id", entryId);
}

async function softDeleteEntry(entryId) {
  await client.from("entries").update({ is_deleted: true, content: "" }).eq("id", entryId);
}

function renderEntriesList(keepScroll=false) {
  const list = document.getElementById("entries-list");
  list.innerHTML = "";
  const topBar = document.createElement("div");
  topBar.style.display = "flex";
  topBar.style.justifyContent = "center";
  if (state.entriesHasMore) {
    const olderBtn = document.createElement("button");
    olderBtn.className = "btn";
    olderBtn.textContent = "Load older messages";
    olderBtn.addEventListener("click", () => { loadOlderEntries(); });
    topBar.appendChild(olderBtn);
  }
  list.appendChild(topBar);
  for (let i = 0; i < state.entries.length; i++) {
    const e = state.entries[i];
    const item = document.createElement("div");
    item.className = "entry" + (i % 2 === 0 ? "" : " alt");
    const top = document.createElement("div");
    top.className = "entry-top";
    const badge = document.createElement("div");
    badge.className = "author-badge";
    const dot = document.createElement("span");
    dot.style.width = "10px";
    dot.style.height = "10px";
    dot.style.borderRadius = "999px";
    dot.style.background = e.author_color || "#888";
    const name = document.createElement("span");
    name.textContent = e.author_name || "Author";
    badge.appendChild(dot);
    badge.appendChild(name);
    const time = document.createElement("div");
    time.className = "entry-time";
    time.textContent = humanizeTime(new Date(e.created_at));
    top.appendChild(badge);
    top.appendChild(time);
    item.appendChild(top);
    if (e.is_deleted) {
      const del = document.createElement("div");
      del.className = "entry-content deleted-placeholder";
      del.textContent = "Entry deleted by the author";
      item.appendChild(del);
    } else if (state.editingEntryId === e.id) {
      const editor = document.createElement("textarea");
      editor.className = "field";
      editor.value = e.content || "";
      item.appendChild(editor);
      const actions = document.createElement("div");
      actions.className = "entry-actions-row";
      const saveBtn = document.createElement("button");
      saveBtn.className = "btn primary";
      saveBtn.textContent = "Save";
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn";
      cancelBtn.textContent = "Cancel";
      saveBtn.addEventListener("click", async () => { await editEntry(e.id, editor.value); state.editingEntryId = null; renderEntriesList(true); });
      cancelBtn.addEventListener("click", () => { state.editingEntryId = null; renderEntriesList(true); });
      actions.appendChild(saveBtn);
      actions.appendChild(cancelBtn);
      item.appendChild(actions);
    } else {
      const content = document.createElement("div");
      content.className = "entry-content";
      content.innerHTML = renderMarkdown(e.content || "");
      item.appendChild(content);
      const files = state.entryFiles && state.entryFiles[e.id] ? state.entryFiles[e.id] : [];
      if (files.length) {
        const fl = document.createElement("div");
        fl.className = "attachments-list";
        files.forEach(f => { const link = document.createElement("a"); link.href = f.file_url; link.target = "_blank"; link.textContent = f.file_name; fl.appendChild(link); });
        item.appendChild(fl);
      }
      const actions = document.createElement("div");
      actions.className = "entry-actions-row";
      const editBtn = document.createElement("button");
      editBtn.className = "small-icon-btn";
      editBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.34a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>';
      editBtn.addEventListener("click", async () => { state.editingEntryId = e.id; renderEntriesList(true); });
      const delBtn = document.createElement("button");
      delBtn.className = "small-icon-btn";
      delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 7h12v2H6zm2 4h8v8H8zM9 4h6l1 2H8l1-2z"/></svg>';
      delBtn.addEventListener("click", async () => { await softDeleteEntry(e.id); });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      const reactRow = document.createElement("div");
      reactRow.className = "entry-actions-row";
      const cnt = state.reactionsCounts[e.id] || { up:0, check:0, bang:0 };
      const mine = state.reactionsMine[e.id] || {};
      const btnUp = document.createElement("button"); btnUp.className = "small-icon-btn"; btnUp.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2 21h4V9H2v12zm20-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L13 1 6.59 7.41C6.22 7.78 6 8.3 6 8.83V19c0 1.1.9 2 2 2h8c.82 0 1.54-.5 1.85-1.26l3.02-7.05c.08-.19.13-.4.13-.62v-2.08z"/></svg>'; const upCount = document.createElement("span"); upCount.textContent = String(cnt.up||0); if (mine.up) btnUp.style.background = "#163d2a";
      btnUp.addEventListener("click", () => toggleReaction(e.id, "up"));
      const btnCheck = document.createElement("button"); btnCheck.className = "small-icon-btn"; btnCheck.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'; const checkCount = document.createElement("span"); checkCount.textContent = String(cnt.check||0); if (mine.check) btnCheck.style.background = "#163d2a";
      btnCheck.addEventListener("click", () => toggleReaction(e.id, "check"));
      const btnBang = document.createElement("button"); btnBang.className = "small-icon-btn"; btnBang.innerHTML = '<svg viewBox="0 0 24 24"><path d="M11 7h2v8h-2zm0 10h2v2h-2z"/></svg>'; const bangCount = document.createElement("span"); bangCount.textContent = String(cnt.bang||0); if (mine.bang) btnBang.style.background = "#163d2a";
      btnBang.addEventListener("click", () => toggleReaction(e.id, "bang"));
      reactRow.appendChild(btnUp); reactRow.appendChild(upCount);
      reactRow.appendChild(btnCheck); reactRow.appendChild(checkCount);
      reactRow.appendChild(btnBang); reactRow.appendChild(bangCount);
      item.appendChild(actions);
      item.appendChild(reactRow);
    }
    list.appendChild(item);
  }
}

function bindUI() {
  document.getElementById("btn-new-doc").addEventListener("click", () => {
    const m = document.getElementById("new-doc-modal");
    document.getElementById("new-doc-title").value = "";
    document.getElementById("new-doc-error").classList.add("hidden");
    m.classList.remove("hidden");
  });
  document.getElementById("menu-new-doc").addEventListener("click", () => {
    document.getElementById("menu-panel").classList.add("hidden");
    const m = document.getElementById("new-doc-modal");
    document.getElementById("new-doc-title").value = "";
    document.getElementById("new-doc-error").classList.add("hidden");
    m.classList.remove("hidden");
  });
  document.getElementById("new-doc-cancel").addEventListener("click", () => {
    document.getElementById("new-doc-modal").classList.add("hidden");
  });
  document.getElementById("new-doc-create").addEventListener("click", async () => {
    const input = document.getElementById("new-doc-title");
    const btn = document.getElementById("new-doc-create");
    const el = document.getElementById("new-doc-error");
    const title = input.value.trim();
    if (!title) { el.textContent = "Enter a title"; el.classList.remove("hidden"); return; }
    const prevText = btn.textContent; btn.textContent = "Creating..."; btn.disabled = true; el.classList.add("hidden");
    const guard = setTimeout(() => { try { if (btn.disabled) { btn.disabled = false; btn.textContent = prevText; el.textContent = "Request timed out"; el.classList.remove("hidden"); } } catch (_) {} }, 10000);
    try {
      const res = await createNotebookInline(title);
      if (res && res.error) {
        console.error("New notebook create error", res.error);
        el.textContent = res.error.message || "Failed to create";
        el.classList.remove("hidden");
      } else {
        document.getElementById("new-doc-modal").classList.add("hidden");
        showToast("Notebook created", "success");
      }
    } catch (err) {
      console.error("Create notebook handler exception", err);
      el.textContent = (err && err.message) ? err.message : "Failed to create";
      el.classList.remove("hidden");
    } finally {
      clearTimeout(guard);
      btn.disabled = false; btn.textContent = prevText;
    }
  });
  document.getElementById("btn-camera").addEventListener("click", () => {
    document.getElementById("quick-note-text").value = "";
    document.getElementById("quick-note-error").classList.add("hidden");
    const sel = document.getElementById("quick-note-doc");
    sel.innerHTML = "";
    state.documents.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.title || "Untitled";
      sel.appendChild(opt);
    });
    if (state.selectedDocumentId) sel.value = state.selectedDocumentId;
    document.getElementById("quick-note-modal").classList.remove("hidden");
  });
  document.getElementById("quick-note-cancel").addEventListener("click", () => {
    document.getElementById("quick-note-modal").classList.add("hidden");
  });
  document.getElementById("quick-note-add").addEventListener("click", async () => {
    const content = document.getElementById("quick-note-text").value;
    const target = document.getElementById("quick-note-doc").value || state.selectedDocumentId;
    if (!target) { const el = document.getElementById("quick-note-error"); el.textContent = "Choose a document"; el.classList.remove("hidden"); return; }
    const uid = state.session && state.session.user ? state.session.user.id : null;
    const name = state.profile && state.profile.display_name ? state.profile.display_name : "Author";
    const color = state.profile && state.profile.color ? state.profile.color : "#888";
    const { data, error } = await client.from("entries").insert({ notebook_id: target, content, author_id: uid, author_name: name, author_color: color }).select("id").single();
    if (error) { console.error("quick-note add error", error); const el = document.getElementById("quick-note-error"); el.textContent = error.message || "Failed"; el.classList.remove("hidden"); return; }
    if (state.selectedDocumentId === target) {
      const optimistic = { id: data && data.id ? data.id : ("temp-"+Date.now()), notebook_id: target, author_id: uid, author_name: name, author_color: color, content, created_at: new Date().toISOString(), is_deleted: false };
      state.entries.push(optimistic);
      renderEntriesList();
      const list = document.getElementById("entries-list"); if (state.autoScroll) list.scrollTop = list.scrollHeight;
    }
    document.getElementById("quick-note-modal").classList.add("hidden");
  });
  document.getElementById("btn-menu").addEventListener("click", () => {
    document.getElementById("menu-panel").classList.toggle("hidden");
  });
  const backBtn = document.getElementById("btn-nav-back");
  if (backBtn) backBtn.addEventListener("click", () => { goBack(); });
  const homeBtn = document.getElementById("btn-home");
  if (homeBtn) homeBtn.addEventListener("click", () => { goHome(); });
  document.getElementById("menu-signout").addEventListener("click", async () => {
    const panel = document.getElementById("menu-panel");
    const btn = document.getElementById("menu-signout");
    panel.classList.add("hidden");
    const prev = btn.textContent; btn.textContent = "Signing out..."; btn.disabled = true;
    try {
      await client.auth.signOut({ scope: "global" });
    } catch (err) {
      console.error("signOut error", err);
      showToast((err && err.message) ? err.message : "Sign out failed", "error");
    }
    try {
      if (state.channels.docs) state.channels.docs.unsubscribe();
      if (state.channels.entries) state.channels.entries.unsubscribe();
      if (state.channels.reactions) state.channels.reactions.unsubscribe && state.channels.reactions.unsubscribe();
    } catch (_) {}
    state.session = null;
    state.selectedDocumentId = null;
    document.getElementById("document-detail").classList.add("hidden");
    showAuth();
    btn.disabled = false; btn.textContent = prev;
    try {
      const { data } = await client.auth.getSession();
      if (data && data.session) {
        try { await client.auth.signOut({ scope: "local" }); } catch (_) {}
        clearSupabaseAuthStorage();
        setTimeout(() => { window.location.reload(); }, 100);
      }
    } catch (_) {}
  });
  document.getElementById("btn-back").addEventListener("click", () => {
    state.selectedDocumentId = null;
    document.getElementById("document-detail").classList.add("hidden");
    renderDocumentsList();
    updateBackButton();
  });
  document.getElementById("btn-doc-info").addEventListener("click", () => {
    const panel = document.getElementById("doc-info-panel");
    panel.classList.toggle("hidden");
    const d = state.documents.find(x => x.id === state.selectedDocumentId);
    if (d) {
      const creator = state.session && d.created_by === state.session.user.id;
      let html = "<div>Notebook ID: " + d.id + "</div><div>Created by: " + d.created_by + "</div><div>Created at: " + new Date(d.created_at).toLocaleString() + "</div>";
      const tags = (state.tags && state.tags[d.id]) ? state.tags[d.id] : [];
      html += '<div style="margin-top:8px">Tags: ' + (tags.map(t => '#'+t).join(' ')) + '</div>';
      if (creator) {
        html += '<div style="margin-top:8px;display:flex;gap:8px"><button id="btn-rename-doc" class="btn">Rename</button><button id="btn-delete-doc" class="btn">Delete</button><button id="btn-export-doc" class="btn">Export .md</button></div>';
        html += '<div style="margin-top:8px"><input id="tags-input" class="field" placeholder="Add tags comma-separated"><button id="tags-save" class="btn" style="margin-top:6px">Save Tags</button></div>';
        html += '<div style="margin-top:12px"><div style="font-weight:700;margin-bottom:6px">Share</div><div id="members-list"></div><div style="display:flex;gap:6px;margin-top:6px"><input id="share-email" class="field" placeholder="Invite by email"><select id="share-role" class="field"><option value="viewer">Viewer</option><option value="editor" selected>Editor</option></select><button id="share-invite" class="btn">Invite</button></div></div>';
      } else {
        html += '<div style="margin-top:12px"><div style="font-weight:700;margin-bottom:6px">Members</div><div id="members-list"></div></div>';
        html += '<div style="margin-top:8px;display:flex;gap:8px"><button id="btn-export-doc" class="btn">Export .md</button></div>';
      }
      panel.innerHTML = html;
      if (creator) {
        const rn = document.getElementById("btn-rename-doc");
        const del = document.getElementById("btn-delete-doc");
        rn.addEventListener("click", () => { beginTitleEdit(d.title || ""); });
        del.addEventListener("click", async () => { await deleteDocument(d.id); panel.classList.add("hidden"); state.selectedDocumentId = null; });
        const ti = document.getElementById("tags-input");
        const ts = document.getElementById("tags-save");
        if (ti && ts) {
          ti.value = tags.join(", ");
          ts.addEventListener("click", () => {
            const raw = ti.value.split(",").map(s => s.trim()).filter(Boolean);
            state.tags[d.id] = raw;
            saveTags();
            panel.classList.add("hidden");
            renderDocumentsList();
          });
        }
        const inviteBtn = document.getElementById("share-invite");
        if (inviteBtn) inviteBtn.addEventListener("click", async () => {
          const email = document.getElementById("share-email").value.trim();
          const role = document.getElementById("share-role").value;
          if (!email) { showToast("Enter an email", "error"); return; }
          const { data: user } = await client.from("users").select("id").eq("email", email).maybeSingle();
          if (!user) { showToast("User not found", "error"); return; }
          const { error } = await client.from("notebook_members").insert({ notebook_id: d.id, user_id: user.id, role });
          if (error) { showToast(error.message || "Invite failed", "error"); return; }
          showToast("Invited", "success");
          await renderMembersSection(d.id);
        });
      }
      const ex = document.getElementById("btn-export-doc");
      if (ex) ex.addEventListener("click", async () => { await exportDocumentMarkdown(d.id); });
      renderMembersSection(d.id);
    }
  });
  document.getElementById("search-input").addEventListener("input", e => {
    state.filters.search = e.target.value;
    renderDocumentsList();
  });
  document.getElementById("chips-row").addEventListener("click", e => {
    if (e.target.classList.contains("chip")) {
      document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      e.target.classList.add("active");
      state.filters.chip = e.target.dataset.chip;
      state.filters.groupDocIds = null;
      renderDocumentsList();
    }
  });
  const ta = document.getElementById("entry-text");
  ta.addEventListener("input", () => {
    document.getElementById("char-count").textContent = String(ta.value.length);
  });
  document.getElementById("btn-add-entry").addEventListener("click", () => {
    if (!state.selectedDocumentId) return;
    createEntry(state.selectedDocumentId, document.getElementById("entry-text").value);
  });
  document.getElementById("document-title").addEventListener("click", () => {
    const d = state.documents.find(x => x.id === state.selectedDocumentId);
    if (!d || !state.session || d.created_by !== state.session.user.id) return;
    beginTitleEdit(d.title || "");
  });
  document.getElementById("title-cancel").addEventListener("click", () => { endTitleEdit(); });
  document.getElementById("title-save").addEventListener("click", async () => {
    const val = document.getElementById("document-title-input").value.trim();
    if (!val) return;
    await renameDocument(state.selectedDocumentId, val);
    endTitleEdit();
  });

  document.getElementById("nav-notes").addEventListener("click", () => navigate("Notes"));
  document.getElementById("nav-activity").addEventListener("click", () => navigate("Activity"));
  document.getElementById("nav-groups").addEventListener("click", () => navigate("Groups"));
  document.getElementById("nav-settings").addEventListener("click", () => navigate("Settings"));
  const teamSel = document.getElementById("team-selector");
  if (teamSel) {
    teamSel.addEventListener("change", async () => { state.currentTeamId = teamSel.value || null; await loadDocuments(); });
  }
  const attachBtn = document.getElementById("btn-attach-file");
  const attachInput = document.getElementById("attach-file-input");
  if (attachBtn && attachInput) {
    attachBtn.addEventListener("click", () => attachInput.click());
    attachInput.addEventListener("change", async () => {
      if (!attachInput.files || !attachInput.files.length) return;
      const file = attachInput.files[0];
      const uid = state.session && state.session.user ? state.session.user.id : null;
      if (!uid) { showToast("Sign in to attach files", "error"); return; }
      const path = uid + "/" + Date.now() + "-" + file.name;
      const { data, error } = await client.storage.from("notes-files").upload(path, file);
      if (error) { showToast(error.message || "Upload failed", "error"); return; }
      const pub = client.storage.from("notes-files").getPublicUrl(path);
      const pf = { file_name: file.name, file_url: pub.data.publicUrl };
      state.pendingFiles.push(pf);
      const pfBox = document.getElementById("pending-files");
      pfBox.classList.remove("hidden");
      const a = document.createElement("a"); a.href = pf.file_url; a.target = "_blank"; a.textContent = pf.file_name;
      if (!pfBox.firstChild) { pfBox.textContent = "Pending attachments: "; }
      pfBox.appendChild(a);
      attachInput.value = "";
    });
  }
}

function randomColor() {
  const colors = ["#25D366","#27ae60","#2ecc71","#3498db","#9b59b6","#e67e22","#e74c3c","#16a085"]; 
  return colors[Math.floor(Math.random()*colors.length)];
}

function humanizeTime(d) {
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const diff = now - d;
  const y = new Date(now);
  y.setDate(now.getDate()-1);
  if (sameDay(d, y)) return "Yesterday";
  const weekNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  if (sameWeek(d, now)) return weekNames[d.getDay()];
  return d.toLocaleDateString();
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function sameWeek(a, b) {
  const oneDay = 24*60*60*1000;
  const start = new Date(b);
  start.setHours(0,0,0,0);
  const day = start.getDay();
  const diffToMonday = (day + 6) % 7;
  start.setTime(start.getTime() - diffToMonday*oneDay);
  const end = new Date(start);
  end.setTime(end.getTime() + 7*oneDay);
  return a >= start && a < end;
}

document.addEventListener("DOMContentLoaded", () => {
  loadPreferences();
  loadPins();
  loadTags();
  bindUI();
  initAuth();
});

function storageWorks() {
  try { localStorage.setItem("__sn_test__", "1"); localStorage.removeItem("__sn_test__"); return true; } catch (_) { return false; }
}

function clearSupabaseAuthStorage() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("sb-") || k.includes("supabase.auth")) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch (_) {}
}

async function awaitSession(timeoutMs=3000, intervalMs=200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await client.auth.getSession();
    if (data && data.session) return data.session;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

async function renameDocument(id, title) {
  await client.from("notebooks").update({ title, updated_at: new Date().toISOString() }).eq("id", id);
  await loadDocuments();
  if (state.selectedDocumentId === id) document.getElementById("document-title").textContent = title;
}

async function deleteDocument(id) {
  if (state.confirmDelete) {
    const ok = confirm("Delete this document?");
    if (!ok) return;
  }
  await client.from("notebooks").delete().eq("id", id);
  await loadDocuments();
  document.getElementById("document-detail").classList.add("hidden");
}

function beginTitleEdit(current) {
  const input = document.getElementById("document-title-input");
  const actions = document.getElementById("document-title-actions");
  input.value = current || "";
  input.classList.remove("hidden");
  actions.classList.remove("hidden");
  state.titleEditing = true;
}

function endTitleEdit() {
  document.getElementById("document-title-input").classList.add("hidden");
  document.getElementById("document-title-actions").classList.add("hidden");
  state.titleEditing = false;
}

function navigate(tab) {
  const prev = state.currentTab;
  if (prev !== tab && !state._navPop) state.navHistory.push(prev);
  state.currentTab = tab;
  const tabs = ["Notes","Activity","Groups","Settings"];
  for (const t of tabs) {
    document.getElementById("view-" + t.toLowerCase()).classList.toggle("hidden", t !== tab);
    const btn = document.getElementById("nav-" + t.toLowerCase());
    if (btn) btn.classList.toggle("active", t === tab);
  }
  document.getElementById("menu-panel").classList.add("hidden");
  if (tab === "Activity") renderActivityView();
  if (tab === "Groups") renderGroupsView();
  if (tab === "Settings") renderSettingsView();
  updateBackButton();
}

function updateBackButton() {
  const btn = document.getElementById("btn-nav-back");
  const docVisible = !document.getElementById("document-detail").classList.contains("hidden");
  if (btn) btn.classList.toggle("hidden", docVisible || state.navHistory.length === 0);
}

function goBack() {
  const docVisible = !document.getElementById("document-detail").classList.contains("hidden");
  if (docVisible) {
    const back = document.getElementById("btn-back");
    if (back) back.click();
    updateBackButton();
    return;
  }
  if (state.navHistory.length) {
    const dest = state.navHistory.pop();
    state._navPop = true;
    navigate(dest);
    state._navPop = false;
  }
}

function goHome() {
  state.navHistory = [];
  state.selectedDocumentId = null;
  document.getElementById("document-detail").classList.add("hidden");
  navigate("Notes");
  updateBackButton();
}

async function renderActivityView() {
  const container = document.getElementById("view-activity");
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.padding = "12px";
  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.marginBottom = "8px";
  title.textContent = "Recent Entries";
  wrap.appendChild(title);
  const docSel = document.createElement("select");
  docSel.className = "field";
  const optAll = document.createElement("option"); optAll.value = ""; optAll.textContent = "All documents"; docSel.appendChild(optAll);
  state.documents.forEach(d => { const o = document.createElement("option"); o.value = d.id; o.textContent = d.title || "Untitled"; docSel.appendChild(o); });
  docSel.value = state.activityDocId || "";
  docSel.addEventListener("change", () => { state.activityDocId = docSel.value || null; renderActivityView(); });
  wrap.appendChild(docSel);
  const filt = document.createElement("div");
  filt.className = "chips-row";
  const mk = (label, key) => { const active = (key==="all" && !state.activityFilters.mine && !state.activityFilters.range) || (key==="mine" && state.activityFilters.mine) || (key==="24h" && state.activityFilters.range === "24h") || (key==="7d" && state.activityFilters.range === "7d"); const b = document.createElement("button"); b.className = "chip" + (active ? " active" : ""); b.textContent = label; b.addEventListener("click", () => { if (key==="mine") state.activityFilters.mine = true; else state.activityFilters.mine = false; if (key==="24h") state.activityFilters.range = "24h"; else if (key==="7d") state.activityFilters.range = "7d"; else state.activityFilters.range = null; renderActivityView(); }); return b; };
  filt.appendChild(mk("All", "all"));
  filt.appendChild(mk("Mine", "mine"));
  filt.appendChild(mk("24h", "24h"));
  filt.appendChild(mk("7d", "7d"));
  wrap.appendChild(filt);
  let recent = [];
  try {
  let q = client.from("entries").select("id,notebook_id,author_id,author_name,author_color,content,created_at").order("created_at", { ascending: false }).limit(50);
  if (docSel.value) q = q.eq("notebook_id", docSel.value);
    const { data, error } = await q;
    if (error) { console.error("Activity load error", error); } else { recent = data || []; }
  } catch (err) { console.error("Activity load exception", err); }
  const ul = document.createElement("ul");
  ul.style.listStyle = "none";
  ul.style.margin = "0";
  ul.style.padding = "0";
  const docMap = new Map(state.documents.map(d => [d.id, d]));
  const now = new Date();
  (recent || []).filter(e => {
    if (state.activityFilters.mine && (!state.session || e.author_id !== state.session.user.id)) return false;
    if (state.activityFilters.range === "24h") { return (now - new Date(e.created_at)) <= 24*60*60*1000; }
    if (state.activityFilters.range === "7d") { return (now - new Date(e.created_at)) <= 7*24*60*60*1000; }
    return true;
  }).forEach(e => {
    const li = document.createElement("li");
    li.className = "entry";
    li.style.cursor = "pointer";
    const top = document.createElement("div");
    top.className = "entry-top";
    const badge = document.createElement("div");
    badge.className = "author-badge";
    const dot = document.createElement("span");
    dot.style.width = "10px";
    dot.style.height = "10px";
    dot.style.borderRadius = "999px";
    dot.style.background = e.author_color || "#888";
    const name = document.createElement("span");
    name.textContent = e.author_name || "Author";
    badge.appendChild(dot);
    badge.appendChild(name);
    const time = document.createElement("div");
    time.className = "entry-time";
    time.textContent = humanizeTime(new Date(e.created_at));
    top.appendChild(badge);
    top.appendChild(time);
    li.appendChild(top);
    const content = document.createElement("div");
    content.className = "entry-content";
    const doc = docMap.get(e.notebook_id);
    content.textContent = (doc ? (doc.title || "Untitled") + " – " : "") + (e.content || "");
    li.appendChild(content);
    li.addEventListener("click", () => openDocument(e.notebook_id));
    ul.appendChild(li);
  });
  wrap.appendChild(ul);
  container.appendChild(wrap);
}

function loadGroups() {
  try {
    const raw = localStorage.getItem("sn_groups");
    state.groups = raw ? JSON.parse(raw) : [];
  } catch (_) { state.groups = []; }
}

function saveGroups() {
  try { localStorage.setItem("sn_groups", JSON.stringify(state.groups)); } catch (_) {}
}

function loadReactions() {
  try { const raw = localStorage.getItem("sn_reactions"); state.reactions = raw ? JSON.parse(raw) : {}; } catch (_) { state.reactions = {}; }
}
function saveReactions() { try { localStorage.setItem("sn_reactions", JSON.stringify(state.reactions)); } catch (_) {} }
function addReaction(entryId, kind) { loadReactions(); const r = state.reactions[entryId] || { up:0, check:0, bang:0 }; r[kind] = (r[kind]||0)+1; state.reactions[entryId] = r; saveReactions(); }

function renderGroupsView() {
  loadGroups();
  const container = document.getElementById("view-groups");
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.padding = "12px";
  const h = document.createElement("div");
  h.style.fontWeight = "700";
  h.style.marginBottom = "8px";
  h.textContent = "Groups";
  wrap.appendChild(h);

  const smart = document.createElement("div");
  smart.style.display = "grid";
  smart.style.gridTemplateColumns = "1fr 1fr";
  smart.style.gap = "8px";
  const btnToday = document.createElement("button");
  btnToday.className = "btn";
  btnToday.textContent = "Active Today";
  btnToday.addEventListener("click", () => { navigate("Notes"); state.filters.chip = "Today"; renderDocumentsList(); });
  const btnWeek = document.createElement("button");
  btnWeek.className = "btn";
  btnWeek.textContent = "This Week";
  btnWeek.addEventListener("click", () => { navigate("Notes"); state.filters.chip = "This Week"; renderDocumentsList(); });
  smart.appendChild(btnToday);
  smart.appendChild(btnWeek);
  wrap.appendChild(smart);

  const form = document.createElement("div");
  form.style.marginTop = "12px";
  const nameInput = document.createElement("input");
  nameInput.className = "field";
  nameInput.placeholder = "New group name";
  const docsList = document.createElement("div");
  docsList.style.display = "grid";
  docsList.style.gridTemplateColumns = "1fr 1fr";
  docsList.style.gap = "6px";
  state.documents.forEach(d => {
    const label = document.createElement("label");
    label.style.display = "flex";
    label.style.alignItems = "center";
    label.style.gap = "6px";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = d.id;
    const span = document.createElement("span");
    span.textContent = d.title || "Untitled";
    label.appendChild(cb);
    label.appendChild(span);
    docsList.appendChild(label);
  });
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn primary";
  saveBtn.textContent = "Save Group";
  saveBtn.style.marginTop = "8px";
  saveBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const selected = Array.from(docsList.querySelectorAll('input[type="checkbox"]:checked')).map(x => x.value);
    if (!selected.length) return;
    state.groups.push({ id: String(Date.now()), name, docIds: selected });
    saveGroups();
    renderGroupsView();
  });
  form.appendChild(nameInput);
  form.appendChild(docsList);
  form.appendChild(saveBtn);
  wrap.appendChild(form);

  const listTitle = document.createElement("div");
  listTitle.style.fontWeight = "700";
  listTitle.style.margin = "12px 0 6px";
  listTitle.textContent = "Saved Groups";
  wrap.appendChild(listTitle);
  const gl = document.createElement("div");
  gl.style.display = "flex";
  gl.style.flexDirection = "column";
  gl.style.gap = "8px";
  state.groups.forEach(g => {
    const row = document.createElement("div");
    row.className = "entry";
    const top = document.createElement("div");
    top.className = "entry-top";
    const name = document.createElement("div");
    name.textContent = g.name;
    const count = document.createElement("div");
    count.className = "entry-time";
    count.textContent = String(g.docIds.length) + " docs";
    top.appendChild(name);
    top.appendChild(count);
    row.appendChild(top);
    const actions = document.createElement("div");
    actions.className = "entry-actions-row";
    const openBtn = document.createElement("button");
    openBtn.className = "btn";
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => { state.filters.groupDocIds = g.docIds; navigate("Notes"); renderDocumentsList(); });
    const delBtn = document.createElement("button");
    delBtn.className = "btn";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => { state.groups = state.groups.filter(x => x.id !== g.id); saveGroups(); renderGroupsView(); });
    actions.appendChild(openBtn);
    actions.appendChild(delBtn);
    row.appendChild(actions);
    gl.appendChild(row);
  });
  wrap.appendChild(gl);
  container.appendChild(wrap);
}

async function renderSettingsView() {
  const container = document.getElementById("view-settings");
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.padding = "12px";
  const h = document.createElement("div");
  h.style.fontWeight = "700";
  h.style.marginBottom = "8px";
  h.textContent = "Settings";
  wrap.appendChild(h);
  const prof = state.profile;
  const nameInput = document.createElement("input");
  nameInput.className = "field";
  nameInput.placeholder = "Display name";
  nameInput.value = prof && prof.display_name ? prof.display_name : "";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.style.marginTop = "8px";
  colorInput.value = prof && prof.color ? prof.color : "#25D366";
  const saveProfile = document.createElement("button");
  saveProfile.className = "btn primary";
  saveProfile.style.marginTop = "8px";
  saveProfile.textContent = "Save Profile";
  saveProfile.addEventListener("click", async () => {
    if (!state.session) return;
    await client.from("users").update({ display_name: nameInput.value.trim(), color: colorInput.value }).eq("id", state.session.user.id);
    await ensureProfile();
    renderSettingsView();
  });
  wrap.appendChild(nameInput);
  wrap.appendChild(colorInput);
  wrap.appendChild(saveProfile);

  const autoRow = document.createElement("div");
  autoRow.style.display = "flex";
  autoRow.style.alignItems = "center";
  autoRow.style.gap = "8px";
  autoRow.style.marginTop = "12px";
  const autoLabel = document.createElement("span");
  autoLabel.textContent = "Auto-scroll to newest entry";
  const autoChk = document.createElement("input");
  autoChk.type = "checkbox";
  autoChk.checked = !!state.autoScroll;
  autoChk.addEventListener("change", () => { state.autoScroll = !!autoChk.checked; try { localStorage.setItem("sn_auto_scroll", state.autoScroll ? "1" : "0"); } catch (_) {} });
  autoRow.appendChild(autoChk);
  autoRow.appendChild(autoLabel);
  wrap.appendChild(autoRow);

  const compactRow = document.createElement("div");
  compactRow.style.display = "flex";
  compactRow.style.alignItems = "center";
  compactRow.style.gap = "8px";
  compactRow.style.marginTop = "12px";
  const compactLabel = document.createElement("span");
  compactLabel.textContent = "Compact layout";
  const compactChk = document.createElement("input");
  compactChk.type = "checkbox";
  compactChk.checked = !!state.compact;
  compactChk.addEventListener("change", () => { state.compact = !!compactChk.checked; document.body.classList.toggle("compact", !!state.compact); try { localStorage.setItem("sn_compact", state.compact ? "1" : "0"); } catch (_) {} });
  compactRow.appendChild(compactChk);
  compactRow.appendChild(compactLabel);
  wrap.appendChild(compactRow);

  const confirmRow = document.createElement("div");
  confirmRow.style.display = "flex";
  confirmRow.style.alignItems = "center";
  confirmRow.style.gap = "8px";
  confirmRow.style.marginTop = "12px";
  const confirmLabel = document.createElement("span");
  confirmLabel.textContent = "Confirm before delete";
  const confirmChk = document.createElement("input");
  confirmChk.type = "checkbox";
  confirmChk.checked = !!state.confirmDelete;
  confirmChk.addEventListener("change", () => { state.confirmDelete = !!confirmChk.checked; try { localStorage.setItem("sn_confirm_delete", state.confirmDelete ? "1" : "0"); } catch (_) {} });
  confirmRow.appendChild(confirmChk);
  confirmRow.appendChild(confirmLabel);
  wrap.appendChild(confirmRow);

  const info = document.createElement("div");
  info.style.color = "#9aa0a6";
  info.style.fontSize = "13px";
  info.style.marginTop = "12px";
  info.textContent = "Mobile input zoom is disabled and positions are fixed for stability.";
  wrap.appendChild(info);

  container.appendChild(wrap);
}

function loadPreferences() {
  try { state.autoScroll = localStorage.getItem("sn_auto_scroll") === "0" ? false : true; } catch (_) {}
  try { state.compact = localStorage.getItem("sn_compact") === "1"; } catch (_) { state.compact = false; }
  try { state.confirmDelete = localStorage.getItem("sn_confirm_delete") === "1"; } catch (_) { state.confirmDelete = false; }
  document.body.classList.toggle("compact", !!state.compact);
}

function loadPins() {
  try { const raw = localStorage.getItem("sn_pins"); state.pins = raw ? JSON.parse(raw) : []; } catch (_) { state.pins = []; }
}
function savePins() { try { localStorage.setItem("sn_pins", JSON.stringify(state.pins)); } catch (_) {} }
function togglePin(id) { loadPins(); if (state.pins.includes(id)) { state.pins = state.pins.filter(x => x !== id); } else { state.pins.push(id); } savePins(); }

function loadTags() {
  try { const raw = localStorage.getItem("sn_tags"); state.tags = raw ? JSON.parse(raw) : {}; } catch (_) { state.tags = {}; }
}
function saveTags() { try { localStorage.setItem("sn_tags", JSON.stringify(state.tags)); } catch (_) {} }

function loadLastOpened() { try { const raw = localStorage.getItem("sn_last_opened"); state.lastOpened = raw ? JSON.parse(raw) : {}; } catch (_) { state.lastOpened = {}; } }
function saveLastOpened() { try { localStorage.setItem("sn_last_opened", JSON.stringify(state.lastOpened)); } catch (_) {} }
function markDocOpened(id) { loadLastOpened(); state.lastOpened[id] = new Date().toISOString(); saveLastOpened(); }
async function exportDocumentMarkdown(id) {
  const { data: entries } = await client.from("entries").select("author_name,content,created_at").eq("notebook_id", id).order("created_at", { ascending: true });
  const doc = state.documents.find(x => x.id === id);
  const lines = [];
  lines.push("# " + (doc ? (doc.title || "Untitled") : "Document"));
  lines.push("");
  (entries || []).forEach(e => {
    lines.push("## " + (e.author_name || "Author") + " — " + new Date(e.created_at).toLocaleString());
    lines.push("");
    lines.push((e.content || "").trim());
    lines.push("");
  });
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ((doc ? (doc.title || "document") : "document").replace(/\s+/g, "-").toLowerCase()) + ".md";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
  const ndt = document.getElementById("new-doc-title");
  if (ndt) ndt.addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("new-doc-create").click(); });
  document.querySelectorAll(".modal").forEach(m => {
    m.addEventListener("click", e => { if (e.target === m) m.classList.add("hidden"); });
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
  });
async function loadTeams() {
  const { data: teams } = await client.from("teams").select("id,name");
  state.teams = teams || [];
  const sel = document.getElementById("team-selector");
  if (sel) {
    sel.innerHTML = "";
    const opt = document.createElement("option"); opt.value = ""; opt.textContent = "Personal"; sel.appendChild(opt);
    state.teams.forEach(t => { const o = document.createElement("option"); o.value = t.id; o.textContent = t.name; sel.appendChild(o); });
    sel.value = state.currentTeamId || "";
  }
}

async function renderMembersSection(docId) {
  const listEl = document.getElementById("members-list");
  if (!listEl) return;
  listEl.innerHTML = "Loading members...";
  const { data: members } = await client.from("notebook_members").select("id,notebook_id,user_id,role").eq("notebook_id", docId);
  const ids = (members || []).map(m => m.user_id);
  const { data: users } = ids.length ? await client.from("users").select("id,display_name,email,color").in("id", ids) : { data: [] };
  const map = new Map((users || []).map(u => [u.id, u]));
  const isOwner = !!(state.session && members && members.find(m => m.user_id === state.session.user.id && m.role === "owner"));
  listEl.innerHTML = "";
  (members || []).forEach(m => {
    const row = document.createElement("div");
    row.style.display = "flex"; row.style.alignItems = "center"; row.style.justifyContent = "space-between"; row.style.gap = "8px"; row.style.marginBottom = "6px";
    const left = document.createElement("div");
    const u = map.get(m.user_id);
    left.textContent = ((u && u.display_name) || m.user_id) + (u && u.email ? (" (" + u.email + ")") : "");
    const right = document.createElement("div");
    if (isOwner) {
      const roleSel = document.createElement("select"); roleSel.className = "field"; ["viewer","editor","owner"].forEach(r => { const o = document.createElement("option"); o.value = r; o.textContent = r; roleSel.appendChild(o); }); roleSel.value = m.role;
      roleSel.addEventListener("change", async () => { await client.from("notebook_members").update({ role: roleSel.value }).eq("id", m.id); showToast("Role updated", "success"); });
      const remBtn = document.createElement("button"); remBtn.className = "btn"; remBtn.textContent = "Remove"; remBtn.addEventListener("click", async () => { await client.from("notebook_members").delete().eq("id", m.id); showToast("Removed", "success"); await renderMembersSection(docId); });
      right.appendChild(roleSel); right.appendChild(remBtn);
    } else {
      right.textContent = m.role;
    }
    row.appendChild(left); row.appendChild(right);
    listEl.appendChild(row);
  });
}

async function loadReactionsForEntries(documentId) {
  const ids = state.entries.map(e => e.id);
  if (!ids.length) { state.reactionsCounts = {}; state.reactionsMine = {}; return; }
  const { data: reacts } = await client.from("entry_reactions").select("entry_id,user_id,kind").in("entry_id", ids);
  const counts = {}; const mine = {};
  const uid = state.session && state.session.user ? state.session.user.id : null;
  (reacts || []).forEach(r => {
    counts[r.entry_id] = counts[r.entry_id] || { up:0, check:0, bang:0 };
    counts[r.entry_id][r.kind] = (counts[r.entry_id][r.kind]||0) + 1;
    if (uid && r.user_id === uid) { mine[r.entry_id] = mine[r.entry_id] || {}; mine[r.entry_id][r.kind] = true; }
  });
  state.reactionsCounts = counts; state.reactionsMine = mine;
}

async function toggleReaction(entryId, kind) {
  const uid = state.session && state.session.user ? state.session.user.id : null;
  if (!uid) { showToast("Sign in to react", "error"); return; }
  const mine = state.reactionsMine[entryId] && state.reactionsMine[entryId][kind];
  if (mine) {
    await client.from("entry_reactions").delete().eq("entry_id", entryId).eq("user_id", uid).eq("kind", kind);
  } else {
    await client.from("entry_reactions").insert({ entry_id: entryId, user_id: uid, kind });
  }
  await loadReactionsForEntries(state.selectedDocumentId);
  renderEntriesList(true);
}

function handleReactionRealtime(payload) {
  if (!state.selectedDocumentId) return;
  loadReactionsForEntries(state.selectedDocumentId).then(() => { renderEntriesList(true); });
}

async function loadEntryFilesForEntries(documentId) {
  const ids = state.entries.map(e => e.id);
  if (!ids.length) { state.entryFiles = {}; return; }
  const { data } = await client.from("entry_files").select("id,entry_id,file_name,file_url").in("entry_id", ids);
  const map = {};
  (data || []).forEach(f => { if (!map[f.entry_id]) map[f.entry_id] = []; map[f.entry_id].push(f); });
  state.entryFiles = map;
}

function renderMarkdown(text) {
  if (!text) return "";
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let s = esc;
  s = s.replace(/^######\s?(.*)$/gm, '<h6>$1</h6>')
       .replace(/^#####\s?(.*)$/gm, '<h5>$1</h5>')
       .replace(/^####\s?(.*)$/gm, '<h4>$1</h4>')
       .replace(/^###\s?(.*)$/gm, '<h3>$1</h3>')
       .replace(/^##\s?(.*)$/gm, '<h2>$1</h2>')
       .replace(/^#\s?(.*)$/gm, '<h1>$1</h1>')
       .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
       .replace(/\*(.*?)\*/g, '<em>$1</em>')
       .replace(/`([^`]+)`/g, '<code>$1</code>')
       .replace(/\[(.*?)\]\((https?:[^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
       .replace(/\n/g, '<br/>');
  return s;
}

function showToast(message, type) {
  const t = document.getElementById("toast"); if (!t) return;
  t.textContent = message; t.classList.remove("hidden"); t.classList.remove("success","error"); if (type) t.classList.add(type);
  setTimeout(() => { t.classList.add("hidden"); }, 2000);
}
