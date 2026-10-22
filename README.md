# 250 Eagles — team36855 website

Static site for GitHub Pages. No build step.

- `index.html` — all four pages (Home, Team, Sponsors, Contact). Links like `#team` open a page directly.
- `style.css` — all styling.
- `script.js` — page switching and the mailto contact/sponsor forms.
- `robot.js` — the 3D robot on the home page.
- `assets/robot.glb` — the robot model, converted from our CAD (STEP) file and compressed (meshopt).
- `assets/team/` — member photos (filenames must match the `<img>` paths in `index.html`).

## Updating the roster
Copy one `<div class="member">…</div>` block in `index.html`, change the photo path, role, and name.
Keep Titus Li and Akshaj Sharma at the bottom of the list.

## Still to fill in
Search `index.html` for `class="ph"` — those are placeholders (team email, sponsor email, meeting location, 501(c)(3) wording).
Also update the `data-mailto` addresses on both forms.
