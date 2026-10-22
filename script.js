// ---------------------------------------------------------------
// Single-file site: Home / Team / Sponsors / Contact are all in
// index.html as <div class="page"> blocks. Nav shows one at a time.
// Each page also has a link of its own (#team, #sponsors, #contact).
// ---------------------------------------------------------------
(function () {
  "use strict";
  var PAGES = ["home", "team", "sponsors", "contact"];
  var SHEET_LABELS = { home: "Home · 1/4", team: "Team · 2/4", sponsors: "Sponsors · 3/4", contact: "Contact · 4/4" };
  var PAGE_TITLES = {
    home: "Team 36855 — 250 Eagles — FTC Robotics",
    team: "Team — Team 36855 250 Eagles",
    sponsors: "Sponsors — Team 36855 250 Eagles",
    contact: "Contact — Team 36855 250 Eagles"
  };

  function showPage(name, opts) {
    if (PAGES.indexOf(name) < 0) name = "home";
    PAGES.forEach(function (p) {
      var el = document.getElementById("page-" + p);
      if (el) el.hidden = p !== name;
    });
    document.querySelectorAll(".tab").forEach(function (tab) {
      if (tab.getAttribute("data-page") === name) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    var sheet = document.getElementById("sheet-label");
    if (sheet) sheet.textContent = SHEET_LABELS[name];
    document.title = PAGE_TITLES[name];
    if (!opts || !opts.keepScroll) window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent("pagechange", { detail: name }));
  }

  document.addEventListener("click", function (e) {
    var link = e.target.closest("a[data-page]");
    if (!link) return;
    e.preventDefault();
    var name = link.getAttribute("data-page");
    if (location.hash !== "#" + name) {
      try { history.pushState(null, "", "#" + name); } catch (err) { /* sandboxed viewers */ }
    }
    showPage(name);
  });

  window.addEventListener("popstate", function () { showPage((location.hash || "#home").slice(1)); });
  showPage((location.hash || "#home").slice(1), { keepScroll: true });

  // ---------------------------------------------------------------
  // Contact / sponsor forms: no backend yet, so build a mailto: link
  // from the filled-in fields and show a confirmation note.
  // ---------------------------------------------------------------
  document.querySelectorAll("form[data-mailto]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var to = form.getAttribute("data-mailto");
      var data = new FormData(form);
      var name = data.get("name") || "";
      var org = data.get("org") || "";
      var email = data.get("email") || "";
      var message = data.get("message") || "";
      var subject = data.get("subject") || ("Message from " + (name || "website contact form"));
      var body = [org ? "Organization: " + org : null, email ? "Reply-to: " + email : null, "", message]
        .filter(function (l) { return l !== null; }).join("\n");
      window.location.href = "mailto:" + to + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
      var status = form.querySelector(".form-status");
      if (status) {
        status.textContent = "Opening your email app with this message pre-filled. If nothing opens, email us directly using the address on this page.";
        status.classList.add("show");
      }
    });
  });
})();
