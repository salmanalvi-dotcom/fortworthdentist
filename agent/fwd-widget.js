/* Veneer Suite — Concierge chat widget.
   Include on the page with:
     <script src="agent/concierge-widget.js" data-endpoint="/api/concierge" defer></script>
   If data-endpoint is empty or unreachable, the launcher falls back to
   scrolling to the on-page intake (#contact) so the site never breaks. */
(function () {
  var script = document.currentScript;
  var ENDPOINT = (script && script.getAttribute("data-endpoint")) || "";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── styles ── */
  var css = `
  .cg-launch{position:fixed;right:20px;bottom:20px;z-index:70;display:inline-flex;align-items:center;gap:10px;
    background:#152A45;color:#FBFAF7;border:1px solid rgba(250,248,244,.2);border-radius:999px;
    padding:14px 22px;font:500 12px/1 Inter,-apple-system,sans-serif;letter-spacing:.16em;text-transform:uppercase;
    cursor:pointer;box-shadow:0 6px 28px rgba(22,19,16,.28);transition:transform .25s cubic-bezier(.23,1,.32,1)}
  .cg-launch:hover{transform:translateY(-2px)}
  .cg-launch .dot{width:7px;height:7px;border-radius:50%;background:#D6B36A}
  @media (max-width:880px){.cg-launch{bottom:76px}}
  .cg-panel{position:fixed;right:20px;bottom:20px;z-index:80;width:min(380px,calc(100vw - 32px));
    height:min(560px,calc(100vh - 96px));display:none;flex-direction:column;overflow:hidden;
    background:#0E1D31;color:#FBFAF7;box-shadow:0 24px 80px rgba(22,19,16,.45);
    opacity:0;transform:translateY(16px);transition:opacity .35s cubic-bezier(.23,1,.32,1),transform .35s cubic-bezier(.23,1,.32,1)}
  .cg-panel.open{display:flex}
  .cg-panel.in{opacity:1;transform:translateY(0)}
  .cg-head{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid rgba(250,248,244,.14)}
  .cg-head .t{font:400 19px/1 'Cormorant Garamond',Georgia,serif;letter-spacing:.06em}
  .cg-head .s{font:500 9px/1 Inter,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#9A7B3A;display:block;margin-top:6px}
  .cg-close{background:none;border:none;color:#FBFAF7;font-size:18px;cursor:pointer;padding:6px}
  .cg-log{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin}
  .cg-msg{max-width:85%;padding:12px 16px;font:400 14px/1.55 Inter,sans-serif;white-space:pre-wrap;word-wrap:break-word}
  .cg-msg.a{background:rgba(250,248,244,.07);align-self:flex-start;border-left:1px solid #9A7B3A}
  .cg-msg.u{background:#FBFAF7;color:#152A45;align-self:flex-end}
  .cg-msg a{color:#D6B36A}
  .cg-typing{align-self:flex-start;color:#8B93A1;font:italic 300 14px/1 'Cormorant Garamond',serif;padding:4px 2px}
  .cg-form{display:flex;border-top:1px solid rgba(250,248,244,.14)}
  .cg-in{flex:1;background:transparent;border:none;color:#FBFAF7;padding:16px 18px;font:400 14px/1.4 Inter,sans-serif;resize:none;outline:none;max-height:96px}
  .cg-in::placeholder{color:#8B93A1}
  .cg-send{background:none;border:none;color:#D6B36A;font:500 11px/1 Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;padding:0 20px;cursor:pointer}
  .cg-send:disabled{color:#4a5568;cursor:default}
  .cg-note{font:400 10px/1.5 Inter,sans-serif;color:#8B93A1;padding:8px 20px 14px;border-top:1px solid rgba(250,248,244,.08)}
  .cg-launch:focus-visible,.cg-close:focus-visible,.cg-send:focus-visible{outline:2px solid #9A7B3A;outline-offset:2px}
  @media (prefers-reduced-motion:reduce){.cg-launch,.cg-panel{transition:none}}
  `;
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  /* ── markup ── */
  var launch = document.createElement("button");
  launch.className = "cg-launch";
  launch.innerHTML = '<span class="dot"></span>Front Desk';
  launch.setAttribute("aria-haspopup", "dialog");
  document.body.appendChild(launch);

  var panel = document.createElement("div");
  panel.className = "cg-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Fort Worth Dentist assistant");
  panel.innerHTML =
    '<div class="cg-head"><div><span class="t">Front Desk</span><span class="s">Fort Worth Dentist · Appointments</span></div>' +
    '<button class="cg-close" aria-label="Close">✕</button></div>' +
    '<div class="cg-log" aria-live="polite"></div>' +
    '<div class="cg-form"><textarea class="cg-in" rows="1" placeholder="Write a message…" aria-label="Message"></textarea>' +
    '<button class="cg-send">Send</button></div>' +
    '<div class="cg-note">For scheduling only — not medical advice. Tooth pain or swelling? Call 817-926-1300 now.</div>';
  document.body.appendChild(panel);

  var log = panel.querySelector(".cg-log");
  var input = panel.querySelector(".cg-in");
  var sendBtn = panel.querySelector(".cg-send");
  var history = [];
  var busy = false;

  function esc(s){
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function linkify(s){
    return esc(s).replace(/(https?:\/\/[^\s<]+)/g, function(u){
      return '<a href="' + u + '" target="_blank" rel="noopener">' + u.replace(/^https?:\/\//,'') + '</a>';
    });
  }
  function add(role, text, asHTML) {
    var m = document.createElement("div");
    m.className = "cg-msg " + (role === "user" ? "u" : "a");
    if (asHTML) m.innerHTML = text;
    else if (role !== "user" && /https?:\/\//.test(text)) m.innerHTML = linkify(text);
    else m.textContent = text;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }

  function openPanel() {
    panel.classList.add("open");
    requestAnimationFrame(function () { panel.classList.add("in"); });
    launch.style.display = "none";
    if (history.length === 0) {
      add("assistant", "Hi! I can help you request an appointment at Fort Worth Dentist — may I have your name?");
      history.push({ role: "assistant", content: "Hi! I can help you request an appointment at Fort Worth Dentist — may I have your name?" });
    }
    input.focus();
  }
  function closePanel() {
    panel.classList.remove("in");
    setTimeout(function () { panel.classList.remove("open"); launch.style.display = ""; }, reduce ? 0 : 300);
  }

  launch.addEventListener("click", function () {
    if (!ENDPOINT) {
      // graceful fallback: no backend configured — take them to the intake
      var c = document.getElementById("contact");
      if (c) c.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
      return;
    }
    openPanel();
  });
  panel.querySelector(".cg-close").addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("open")) closePanel();
  });

  function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    add("user", text);
    history.push({ role: "user", content: text });
    busy = true; sendBtn.disabled = true;
    var typing = document.createElement("div");
    typing.className = "cg-typing";
    typing.textContent = "writing…";
    log.appendChild(typing); log.scrollTop = log.scrollHeight;

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        typing.remove();
        var reply = d.reply || "I'm sorry — something went wrong. Please call 817-926-1300 and the team will take care of you.";
        add("assistant", reply);
        history.push({ role: "assistant", content: reply });
        if (d.paymentLink) {
          add("assistant",
            'You can reserve your consultation securely here: <a href="' + d.paymentLink + '" target="_blank" rel="noopener">Complete your reservation</a>',
            true);
        }
      })
      .catch(function () {
        typing.remove();
        add("assistant", "I'm having trouble connecting. Please call 817-926-1300, or use the request form below on this page.");
      })
      .finally(function () { busy = false; sendBtn.disabled = false; input.focus(); });
  }
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
})();
