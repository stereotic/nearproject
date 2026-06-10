(function(){
  let me = localStorage.getItem("near_user");

  // UI mount
  const root = document.createElement("div");
  root.className = "near-fab";
  root.innerHTML = `
    <button class="near-fab-btn" id="nearBell" title="Уведомления"><i data-lucide="bell" style="width: 24px;"></i><span class="near-badge" id="nearBellBadge"></span></button>
    <button class="near-fab-btn" id="nearChatBtn" title="Сообщения"><i data-lucide="message-square" style="width: 24px;"></i><span class="near-badge" id="nearChatBadge"></span></button>

    <div class="near-panel" id="nearNotifPanel">
      <div class="near-panel-head">
        <span>Уведомления</span>
        <button class="near-x" id="nearNotifClose">✕</button>
      </div>
      <div class="near-panel-body" id="nearNotifBody"></div>
    </div>

    <div class="near-panel" id="nearChatsPanel">
      <div class="near-panel-head">
        <span>Сообщения</span>
        <button class="near-x" id="nearChatsClose">✕</button>
      </div>
      <div class="near-panel-body" id="nearChatsBody"></div>
    </div>

    <div class="near-chat" id="nearChatWindow">
      <div class="near-chat-head">
        <button class="near-back" id="nearChatBack" aria-label="Назад" style="background:none;border:none;color:var(--text);cursor:pointer;padding:4px;display:flex;align-items:center;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></button>
        <span id="nearChatTitle" style="font-weight: 800;">Чат</span>
        <button class="near-x" id="nearChatClose">✕</button>
      </div>
      <div class="near-chat-body" id="nearChatBody"></div>
      <div class="near-chat-foot">
        <button class="btn btn-ghost" id="nearAttach" style="padding: 10px;"><i data-lucide="paperclip" style="width: 18px;"></i></button>
        <input class="near-input" id="nearChatInput" placeholder="Сообщение..." style="border-radius: 40px; padding: 10px 20px;" />
        <input type="file" id="nearChatFile" accept="image/*" style="display:none" />
        <button class="btn btn-primary" id="nearSend" style="padding: 10px; border-radius: 50%; width: 40px; height: 40px;"><i data-lucide="send" style="width: 18px;"></i></button>
        <div id="nearPreview" class="near-preview">
          <button class="near-preview-close" id="nearPreviewClose">✕</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  // вьювер отдельно от root, чтобы перекрывать весь экран (включая хедер)
  const viewerEl = document.createElement("div");
  viewerEl.className = "near-viewer";
  viewerEl.id = "nearViewer";
  viewerEl.innerHTML = `<img id="nearViewerImg" src="" alt=""/>`;
  document.body.appendChild(viewerEl);

  function checkMe() {
    me = localStorage.getItem("near_user");
    root.style.display = me ? "block" : "none";
  }
  checkMe();
  
  if (window.lucide) lucide.createIcons({ attrs: { class: 'near-icon' } });

  // Theme Sync
  function syncTheme() {
    const isDark = localStorage.getItem('near_theme') === 'dark';
    document.body.classList.toggle('dark-theme', isDark);
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) {
      themeIcon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
      if (window.lucide) lucide.createIcons();
    }
  }
  syncTheme();
  // Listen for changes from other tabs
  window.addEventListener('storage', (e) => {
    if (e.key === 'near_theme') syncTheme();
    if (e.key === 'near_user') checkMe();
  });
  // Also check theme regularly
  setInterval(syncTheme, 5000);

  const bellBtn = document.getElementById("nearBell");
  const chatBtn = document.getElementById("nearChatBtn");
  const bellBadge = document.getElementById("nearBellBadge");
  const chatBadge = document.getElementById("nearChatBadge");
  const notifPanel = document.getElementById("nearNotifPanel");
  const notifBody = document.getElementById("nearNotifBody");
  const chatsPanel = document.getElementById("nearChatsPanel");
  const chatsBody = document.getElementById("nearChatsBody");
  const chatWindow = document.getElementById("nearChatWindow");
  const chatTitle = document.getElementById("nearChatTitle");
  const chatBody = document.getElementById("nearChatBody");
  const chatInput = document.getElementById("nearChatInput");
  const chatFile = document.getElementById("nearChatFile");

  let activeOther = null;
  let otherAvatar = null;
  let lastMsgSig = "";

  function hide(el){ el.style.display = "none"; }
  function show(el){ el.style.display = el.id.includes('Panel') ? 'flex' : 'flex'; el.style.display = 'flex'; }
  function toggle(el){ 
    if(el.style.display === "flex") hide(el); 
    else { closeAll(); show(el); }
  }

  function closeAll(){
    hide(notifPanel); hide(chatsPanel); hide(chatWindow);
  }

  document.getElementById("nearNotifClose").onclick = () => hide(notifPanel);
  document.getElementById("nearChatsClose").onclick = () => hide(chatsPanel);
  document.getElementById("nearChatClose").onclick = () => hide(chatWindow);
  document.getElementById("nearChatBack").onclick = () => { hide(chatWindow); show(chatsPanel); loadChats(); };

  bellBtn.onclick = (e) => { e.stopPropagation(); toggle(notifPanel); if(notifPanel.style.display==="flex") loadNotifs(true); };
  chatBtn.onclick = (e) => {
    e.stopPropagation();
    toggle(chatsPanel);
    if(chatsPanel.style.display==="flex") loadChats();
  };

  document.addEventListener("click", (e) => { if (!root.contains(e.target)) closeAll(); });

  async function loadNotifs(markRead){
    if(!me) return;
    const r = await fetch(`/api/notifs?me=${encodeURIComponent(me)}`);
    const list = await r.json();
    const unread = list.filter(x => !x.is_read).length;
    
    if (unread > 0) {
      bellBadge.style.display = "flex";
      bellBadge.textContent = unread;
    } else bellBadge.style.display = "none";

    notifBody.innerHTML = list.length ? "" : `<div style="color:#777; padding:20px; text-align:center;">Нет уведомлений</div>`;
    list.slice(0, 10).forEach(n => {
      const row = document.createElement("div");
      row.className = "near-row";
      row.innerHTML = `<div class="near-row-title">${n.text}</div><div class="near-row-sub">${new Date(n.created_at*1000).toLocaleString()}</div>`;
      notifBody.appendChild(row);
    });

    if (markRead && unread > 0) {
      await fetch("/api/notifs/read", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ me }) });
      bellBadge.style.display = "none";
    }
  }

  async function loadChats(){
    if(!me) return;
    const r = await fetch(`/api/chats?me=${encodeURIComponent(me)}`);
    const list = await r.json();
    
    let totalUnread = 0;
    chatsBody.innerHTML = list.length ? "" : `<div style="color:#777; padding:20px; text-align:center;">Нет сообщений</div>`;
    list.forEach(c => {
      totalUnread += c.unread || 0;
      const row = document.createElement("div");
      row.className = "near-row";
      row.innerHTML = `<div class="near-row-title">@${c.withNick}${c.unread ? ` <span style="background:var(--primary);color:var(--bg);font-size:10px;font-weight:900;padding:2px 7px;border-radius:999px;vertical-align:middle;">${c.unread}</span>` : ''}</div><div class="near-row-sub">${c.unread ? 'Новые сообщения' : 'Нет новых сообщений'}</div>`;
      row.onclick = () => openChat(c.withNick);
      chatsBody.appendChild(row);
    });
    if (totalUnread > 0) {
      chatBadge.style.display = "flex";
      chatBadge.textContent = totalUnread;
    } else chatBadge.style.display = "none";
  }

  async function updateChatBadge(){
    if(!me) return;
    try {
      const r = await fetch(`/api/chats?me=${encodeURIComponent(me)}`);
      const list = await r.json();
      let total = 0;
      list.forEach(c => { total += c.unread || 0; });
      if (total > 0) { chatBadge.style.display = "flex"; chatBadge.textContent = total; }
      else chatBadge.style.display = "none";
    } catch(e) {}
  }

  // --- ALERT MODAL ---
  function showAlert(msg) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100002;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
      overlay.innerHTML = `<div style="background:var(--bg);padding:28px;border-radius:16px;width:90%;max-width:380px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.15);"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:16px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><h2 style="margin-bottom:20px;font-size:16px;">${msg}</h2><button class="btn btn-primary" style="width:100%;" id="_altOk">OK</button></div>`;
      document.body.appendChild(overlay);
      if (window.lucide) lucide.createIcons();
      document.getElementById('_altOk').onclick = () => { overlay.remove(); resolve(); };
      overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(); } };
    });
  }
  window.showAlert = showAlert;

  // API для внешней кнопки "Написать" (выносим вверх для быстрого доступа)
  window.openChat = async function(other){
    console.log("openChat called with:", other);
    checkMe();
    if(!me) {
        if(window.toast) window.toast("Сначала войдите в аккаунт", "error");
        else showAlert("Сначала войдите в аккаунт");
        return;
    }
    if (other === me) {
        if(window.toast) window.toast("Это ваш товар", "info");
        return;
    }
    activeOther = other;
    closeAll();
    root.style.display = "block";
    chatTitle.textContent = "@" + other;
    otherAvatar = null;
    try {
      const r = await fetch(`/api/user/${encodeURIComponent(other)}`);
      if (r.ok) {
        const u = await r.json();
        if (u && u.avatar) otherAvatar = '/uploads/' + u.avatar;
        else otherAvatar = 'initials:' + other;
      }
    } catch(e){}
    try {
      await fetch("/api/chat/read", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ me, with: other }) });
      await updateChatBadge();
    } catch(e){}
    lastMsgSig = "";
    try { await loadChatMessages(true); } catch(e) { console.error(e); }
    chatWindow.style.display = "flex";
    chatWindow.style.animation = "none";
    chatBody.offsetHeight;
    chatBody.scrollTop = chatBody.scrollHeight;
    chatBody.querySelectorAll("img").forEach(img => {
      if(!img.complete) img.onload = () => chatBody.scrollTop = chatBody.scrollHeight;
    });
    chatInput.focus();
  };


  function computeMsgSig(msgs){
    return (msgs || []).map(m => `${m.id}:${m.image?1:0}:${(m.text||"").length}`).join("|");
  }

  const viewer = document.getElementById("nearViewer");
  const viewerImg = document.getElementById("nearViewerImg");

  function openViewer(src){
    viewerImg.src = src;
    viewer.style.display = "flex";
  }

  function closeViewer(){
    viewer.style.display = "none";
    viewerImg.src = "";
  }

  viewer.addEventListener("click", (e) => {
    e.stopPropagation();
    if(e.target === viewer) closeViewer();
  });
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape" && viewer.style.display === "flex") closeViewer();
  });

  function renderMsgBox(m){
    const hasText = !!m.text;
    const hasImg = !!m.image;
    const bubble = document.createElement("div");
    let cls = "near-msg" + (m.from_nick === me ? " me" : "");
    if(hasImg && !hasText) cls += " near-msg-img-only";
    bubble.className = cls;
    let html = `<div class="near-msg-content">`;
    if(hasImg) html += `<img class="near-msg-img" src="${m.image}" />`;
    if(hasText) html += `<div>${m.text}</div>`;
    html += `<div class="t">${new Date(m.created_at*1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>`;
    html += `</div>`;
    if(m.from_nick !== me){
      html += `<button class="near-msg-report" onclick="window.reportMsg(${m.id},'${m.from_nick}')" title="Пожаловаться"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></button>`;
    }
    bubble.dataset.msgId = m.id;
    bubble.innerHTML = html;
    if(hasImg){
      const imgEl = bubble.querySelector(".near-msg-img");
      if(imgEl) imgEl.addEventListener("click", () => openViewer(m.image));
    }

    if(m.from_nick !== me && otherAvatar){
      const row = document.createElement("div");
      row.className = "near-msg-row";
      if (otherAvatar.startsWith('initials:')) {
        const initial = otherAvatar.slice(9).charAt(0).toUpperCase();
        row.innerHTML = `<div class="near-msg-avatar near-msg-avatar-letter">${initial}</div>`;
      } else {
        row.innerHTML = `<img class="near-msg-avatar" src="${otherAvatar}" onerror="this.style.display='none'" />`;
      }
      row.appendChild(bubble);
      return row;
    }
    return bubble;
  }

  async function loadChatMessages(force){
    if(!activeOther || !me) return;
    const r = await fetch(`/api/chat?me=${encodeURIComponent(me)}&with=${encodeURIComponent(activeOther)}`);
    if (!r.ok) return;
    const msgs = await r.json();
    const sig = computeMsgSig(msgs);
    if(!force && sig === lastMsgSig) return;
    lastMsgSig = sig;
    if (force) {
      chatBody.innerHTML = "";
      msgs.forEach(m => chatBody.appendChild(renderMsgBox(m)));
    } else {
      const existing = chatBody.querySelectorAll("[data-msg-id]");
      const ids = new Set();
      existing.forEach(el => ids.add(parseInt(el.dataset.msgId)));
      msgs.forEach(m => {
        if (!ids.has(m.id)) {
          const box = renderMsgBox(m);
          const tEl = box.querySelector(".t");
          if(tEl) tEl.textContent = new Date(m.created_at*1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
          chatBody.appendChild(box);
          requestAnimationFrame(() => {
            chatBody.scrollTop = chatBody.scrollHeight;
            chatBody.querySelectorAll("img").forEach(img => {
              if(!img.complete) img.onload = () => chatBody.scrollTop = chatBody.scrollHeight;
            });
          });
        }
      });
    }
  }

  const preview = document.getElementById("nearPreview");
  const previewClose = document.getElementById("nearPreviewClose");
  
  function clearPreview() {
    preview.style.display = "none";
    preview.style.backgroundImage = "";
    chatFile.value = "";
  }
  
  previewClose.onclick = clearPreview;

  document.getElementById("nearAttach").onclick = () => chatFile.click();
  chatFile.addEventListener("change", () => {
    const f = chatFile.files[0];
    if(f) {
      preview.style.backgroundImage = `url(${URL.createObjectURL(f)})`;
      preview.style.display = "block";
    } else {
      clearPreview();
    }
  });
  document.getElementById("nearSend").onclick = () => sendMessage();
  chatInput.onkeydown = (e) => { if(e.key==="Enter") sendMessage(); };

  function appendMsg(m){
    const box = renderMsgBox(m);
    const tEl = box.querySelector(".t");
    if(tEl) tEl.textContent = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const reportBtn = box.querySelector(".near-msg-report");
    if(reportBtn && m.id) reportBtn.setAttribute("onclick", `window.reportMsg(${m.id},'${m.from_nick}')`);
    else if(reportBtn) reportBtn.remove();
    chatBody.appendChild(box);
    requestAnimationFrame(() => {
      chatBody.scrollTop = chatBody.scrollHeight;
      chatBody.querySelectorAll("img").forEach(img => {
        if(!img.complete) img.onload = () => chatBody.scrollTop = chatBody.scrollHeight;
      });
    });
  }

  async function sendMessage(){
    const text = chatInput.value.trim();
    const file = chatFile.files[0];
    if(!text && !file) return;

    if(file && text) {
      const f1 = new FormData();
      f1.append("from", me); f1.append("to", activeOther); f1.append("text", "");
      f1.append("image", file);
      const r1 = await fetch("/api/chat/send", { method:"POST", body: f1 });
      const d1 = r1.ok ? await r1.json() : null;

      const f2 = new FormData();
      f2.append("from", me); f2.append("to", activeOther); f2.append("text", text);
      const r2 = await fetch("/api/chat/send", { method:"POST", body: f2 });

      if(r1.ok && r2.ok) {
        appendMsg({ from_nick: me, text: "", image: d1.image, created_at: Date.now()/1000 });
        appendMsg({ from_nick: me, text, image: null, created_at: Date.now()/1000 });
      }
    } else if(file) {
      const form = new FormData();
      form.append("from", me); form.append("to", activeOther); form.append("text", "");
      form.append("image", file);
      const r = await fetch("/api/chat/send", { method:"POST", body: form });
      const d = r.ok ? await r.json() : null;
      if(r.ok) {
        appendMsg({ from_nick: me, text: "", image: d.image, created_at: Date.now()/1000 });
      }
    } else {
      const form = new FormData();
      form.append("from", me); form.append("to", activeOther); form.append("text", text);
      const r = await fetch("/api/chat/send", { method:"POST", body: form });
      if(r.ok) {
        appendMsg({ from_nick: me, text, image: null, created_at: Date.now()/1000 });
      }
    }

    chatInput.value = "";
    clearPreview();
    // синхронизируем сигнатуру с сервером, чтобы поллинг не перерисовывал всё
    const sync = await fetch(`/api/chat?me=${encodeURIComponent(me)}&with=${encodeURIComponent(activeOther)}`);
    const syncMsgs = await sync.json();
    lastMsgSig = computeMsgSig(syncMsgs);
    try { await updateChatBadge(); } catch(e){}
  }

  // --- REPORT MESSAGE ---
  const reportModal = document.createElement("div");
  reportModal.id = "nearReportModal";
  reportModal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100001;display:none;align-items:center;justify-content:center;backdrop-filter:blur(4px);";
  reportModal.innerHTML = `
    <div style="background:var(--bg);padding:28px;border-radius:16px;width:90%;max-width:380px;box-shadow:0 20px 50px rgba(0,0,0,0.15);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
        <span style="font-weight:800;font-size:16px;">Пожаловаться на сообщение</span>
      </div>
      <select id="nearReportReason" style="width:100%;padding:10px 12px;border-radius:8px;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:inherit;font-size:13px;margin-bottom:12px;">
        <option value="spam">Спам</option>
        <option value="abuse">Оскорбление</option>
        <option value="scam">Мошенничество</option>
        <option value="other">Другое</option>
      </select>
      <textarea id="nearReportText" placeholder="Подробнее (необязательно)" style="width:100%;height:70px;padding:10px 12px;border-radius:8px;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:inherit;font-size:13px;resize:none;margin-bottom:16px;"></textarea>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline" style="flex:1;" onclick="document.getElementById('nearReportModal').style.display='none'">Отмена</button>
        <button class="btn btn-primary" style="flex:1;" id="nearReportSubmit">Отправить</button>
      </div>
    </div>`;
  document.body.appendChild(reportModal);

  window.reportMsg = function(msgId, fromNick){
    const currentUser = localStorage.getItem("near_user");
    if (!currentUser) {
      if(window.toast) window.toast('Сначала войдите в аккаунт');
      return;
    }
    document.getElementById('nearReportReason').value = 'spam';
    document.getElementById('nearReportText').value = '';
    document.getElementById('nearReportSubmit').onclick = async () => {
      const reason = document.getElementById('nearReportReason').value;
      const text = document.getElementById('nearReportText').value.trim();
      try {
        const r = await fetch('/api/report', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ type: 'message', target_id: msgId, reporter: currentUser, reason, text })
        });
        const d = await r.json();
        if(d.ok){
          reportModal.style.display = 'none';
          if(window.toast) window.toast('Жалоба отправлена');
        } else {
          if(window.toast) window.toast('Ошибка: ' + (d.error||'неизвестная'));
        }
      } catch(e){
        if(window.toast) window.toast('Ошибка сети');
      }
    };
    reportModal.style.display = 'flex';
  };

  reportModal.addEventListener('click', (e) => {
    if(e.target === reportModal) reportModal.style.display = 'none';
  });

  // Handle storage event for opening chat from item page
  window.addEventListener("storage", (e) => {
    if (e.key === "near_open_chat") {
      const data = JSON.parse(e.newValue);
      if (data && data.with) window.openChat(data.with);
    }
  });

  setInterval(() => { 
    checkMe();
    if(me) {
      fetch('/api/user/' + encodeURIComponent(me)).then(r=>r.json()).then(u => {
        if(u.blocked) {
          localStorage.removeItem("near_user");
          showAlert("Ваш аккаунт заблокирован. Причина: " + (u.blocked_reason || "не указана")).then(() => { location.href = "/"; });
        }
      }).catch(()=>{});
      if(chatWindow.style.display==="flex") loadChatMessages(); 
      loadNotifs(false); 
      updateChatBadge();
    }
  }, 4000);
  if(me) { loadNotifs(false); updateChatBadge(); }
})();