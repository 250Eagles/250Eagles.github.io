// Contact / sponsor forms: no backend yet, so build a mailto: link
// from the filled-in fields and show a confirmation note.
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("form[data-mailto]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const to = form.getAttribute("data-mailto");
      const data = new FormData(form);
      const name = data.get("name") || "";
      const org = data.get("org") || "";
      const email = data.get("email") || "";
      const message = data.get("message") || "";
      const subjectField = data.get("subject");

      const subject = subjectField
        ? subjectField
        : `Message from ${name || "website contact form"}`;

      const bodyLines = [
        org ? `Organization: ${org}` : null,
        email ? `Reply-to: ${email}` : null,
        "",
        message,
      ].filter(Boolean);

      const mailto = `mailto:${to}?subject=${encodeURIComponent(
        subject
      )}&body=${encodeURIComponent(bodyLines.join("\n"))}`;

      window.location.href = mailto;

      const status = form.querySelector(".form-status");
      if (status) {
        status.textContent =
          "Opening your email app with this message pre-filled. If nothing opens, email us directly using the address below.";
        status.classList.add("show");
      }
    });
  });
});
