(() => {
  const config = window.SUPABASE_CONFIG;
  if (!config?.url || !config?.anonKey) return;

  ["manageBtn", "addWorkBtn"].forEach((id) => {
    const button = document.getElementById(id);
    if (!button) return;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign("portal.html");
    }, true);
    if (id === "manageBtn") {
      button.title = "Open the artist and admin portal";
      button.setAttribute("aria-label", "Open the artist and admin portal");
    } else {
      button.textContent = "＋ ARTIST / ADMIN PORTAL";
    }
  });
  const collectionIntro = document.querySelector("#collection .section-intro");
  if (collectionIntro) {
    collectionIntro.textContent = "Browse paintings and drawings by medium. Select a piece to see its details. Sign in to the artist or admin portal to submit and manage artwork.";
  }

  const gallery = document.getElementById("gallery");
  const count = document.getElementById("artCount");
  const search = document.getElementById("search");
  const filters = [...document.querySelectorAll(".filter")];
  let artworks = [];

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));

  async function imageUrl(path) {
    const baseUrl = config.url.replace(/\/$/, "");
    const endpoint = `${baseUrl}/storage/v1/object/sign/artwork-images/${path.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!response.ok) throw new Error(`Could not retrieve an approved artwork image (${response.status}).`);
    const result = await response.json();
    if (typeof result.signedURL !== "string" || !result.signedURL) {
      throw new Error("Supabase did not return a signed artwork image URL.");
    }
    if (/^https?:\/\//i.test(result.signedURL)) return result.signedURL;
    const storagePath = result.signedURL.startsWith("/storage/v1/")
      ? result.signedURL
      : `/storage/v1${result.signedURL.startsWith("/") ? "" : "/"}${result.signedURL}`;
    return `${baseUrl}${storagePath}`;
  }

  async function showDetail(artwork) {
    let image;
    try {
      image = await imageUrl(artwork.image_path);
    } catch (error) {
      if (typeof window.toast === "function") window.toast(error.message);
      return;
    }
    document.getElementById("detailContent").innerHTML = `
      <img src="${escapeHtml(image)}" alt="${escapeHtml(artwork.title)}">
      <h3>${escapeHtml(artwork.title)}</h3>
      ${artwork.status === "pending" ? "<p><strong>Awaiting admin review.</strong></p>" : ""}
      <p>${escapeHtml(artwork.medium)} · ${escapeHtml(artwork.year)}${artwork.dimensions ? ` · ${escapeHtml(artwork.dimensions)}` : ""}</p>
      <p>${escapeHtml(artwork.description || "No description has been added yet.")}</p>
      <a class="button primary" href="mailto:kienvalantindevera@gmail.com?subject=${encodeURIComponent(`Artwork inquiry: ${artwork.title}`)}">INQUIRE ABOUT THIS WORK ↗</a>`;
    document.getElementById("detailModal").classList.add("open");
  }

  function render() {
    const activeFilter = document.querySelector(".filter.active")?.dataset.filter || "All";
    const query = search.value.trim().toLowerCase();
    const rows = artworks.filter((artwork) =>
      (activeFilter === "All" || artwork.medium === activeFilter) &&
      (!query || `${artwork.title} ${artwork.year} ${artwork.medium}`.toLowerCase().includes(query))
    );
    count.textContent = String(artworks.length).padStart(2, "0");
    gallery.innerHTML = rows.length
      ? rows.map((artwork) => `<article class="art-card" tabindex="0" data-artwork-id="${escapeHtml(artwork.id)}">
          <div class="art-image"><div class="placeholder">${escapeHtml(artwork.medium.toUpperCase())}</div><span class="tag">${escapeHtml(artwork.medium)}${artwork.status === "pending" ? " · AWAITING REVIEW" : ""}</span></div>
          <div class="art-meta"><div><h3>${escapeHtml(artwork.title)}</h3><p>${escapeHtml(artwork.dimensions || "Traditional artwork")}</p></div><span class="art-year">${escapeHtml(artwork.year)}</span></div>
        </article>`).join("")
      : '<div class="empty">No artworks match this search.</div>';
    let imageFailure = false;
    Promise.all(rows.map(async (artwork) => {
      try {
        const url = await imageUrl(artwork.image_path);
        const card = gallery.querySelector(`[data-artwork-id="${CSS.escape(artwork.id)}"]`);
        if (!card) return;
        const image = document.createElement("img");
        image.src = url;
        image.alt = artwork.title;
        image.loading = "lazy";
        image.addEventListener("load", () => card.querySelector(".placeholder")?.remove(), { once: true });
        image.addEventListener("error", () => {
          imageFailure = true;
          console.error(`Could not render the image for "${artwork.title}".`);
          if (typeof window.toast === "function") window.toast("An artwork image could not be displayed.");
        }, { once: true });
        card.querySelector(".art-image").prepend(image);
      } catch (error) {
        imageFailure = true;
        console.error(`Could not load the image for "${artwork.title}":`, error);
      }
    })).then(() => {
      if (imageFailure && typeof window.toast === "function") {
        window.toast("One or more artwork images could not be loaded.");
      }
    });
  }

  gallery.addEventListener("click", (event) => {
    const card = event.target.closest("[data-artwork-id]");
    if (!card) return;
    const artwork = artworks.find((item) => item.id === card.dataset.artworkId);
    if (artwork) void showDetail(artwork);
  });
  gallery.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-artwork-id]");
    if (!card) return;
    event.preventDefault();
    const artwork = artworks.find((item) => item.id === card.dataset.artworkId);
    if (artwork) void showDetail(artwork);
  });
  search.addEventListener("input", render);
  filters.forEach((button) => button.addEventListener("click", render));

  const query = new URLSearchParams({
    select: "id,title,medium,year,dimensions,description,image_path,status",
    status: "in.(pending,published)",
    order: "created_at.desc",
  });
  fetch(`${config.url.replace(/\/$/, "")}/rest/v1/artworks?${query}`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Artwork service returned ${response.status}.`);
    artworks = await response.json();
    render();
  }).catch((error) => {
    console.error("Could not load Supabase artworks:", error);
    if (typeof window.toast === "function") window.toast(`Artworks could not be loaded: ${error.message}`);
  });
})();
