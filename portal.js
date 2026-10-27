import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.SUPABASE_CONFIG;
const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");
const loginMessage = document.getElementById("loginMessage");
const configMessage = document.getElementById("configMessage");
const toastElement = document.getElementById("toast");
let supabase;
let currentUser;
let currentRole;
let selectedRole = "artist";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));

function setMessage(element, text, success = false) {
  element.textContent = text;
  element.classList.toggle("success", success);
}

function showToast(text) {
  toastElement.textContent = text;
  toastElement.classList.add("show");
  window.setTimeout(() => toastElement.classList.remove("show"), 2800);
}

function showDashboard(profile) {
  currentRole = profile.role;
  loginView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  document.getElementById("roleLabel").textContent = `${profile.role} workspace`;
  document.getElementById("welcomeHeading").textContent = `Welcome${profile.display_name ? `, ${profile.display_name}` : ""}`;
  document.getElementById("accountEmail").textContent = currentUser.email;
  document.getElementById("artistDashboard").classList.toggle("hidden", profile.role !== "artist");
  document.getElementById("adminDashboard").classList.toggle("hidden", profile.role !== "admin");
  loadArtworkRows().catch((error) => {
    showToast(`Could not load artworks: ${error.message}`);
  });
}

async function loadProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, role")
    .eq("user_id", userId)
    .single();
  if (error) throw new Error(`Could not load your account role: ${error.message}`);
  if (data.role !== "admin" && data.role !== "artist") {
    throw new Error("Your account does not have an enabled portal role.");
  }
  return data;
}

async function getArtworks() {
  let query = supabase
    .from("artworks")
    .select("id, owner_id, title, medium, year, dimensions, description, image_path, status, created_at")
    .order("created_at", { ascending: false });
  if (currentRole === "artist") query = query.eq("owner_id", currentUser.id);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

async function loadArtworkRows() {
  const artworks = await getArtworks();
  if (currentRole === "artist") {
    document.getElementById("artistArtworkRows").innerHTML = artworks.length
      ? artworks.map((artwork) => `<tr>
          <td><strong>${escapeHtml(artwork.title)}</strong><small>${escapeHtml(artwork.medium)} · ${escapeHtml(artwork.year)}</small></td>
          <td><span class="status ${escapeHtml(artwork.status)}">${escapeHtml(artwork.status)}</span></td>
          <td>${artwork.status === "pending" ? `<button class="button small-button" type="button" data-delete="${escapeHtml(artwork.id)}">DELETE</button>` : "—"}</td>
        </tr>`).join("")
      : '<tr><td colspan="3" class="empty">No submissions yet.</td></tr>';
  } else {
    const ownerIds = [...new Set(artworks.map((artwork) => artwork.owner_id))];
    let names = new Map();
    if (ownerIds.length) {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ownerIds);
      if (error) throw new Error(`Could not load artist names: ${error.message}`);
      names = new Map(profiles.map((profile) => [profile.user_id, profile.display_name]));
    }
    document.getElementById("adminArtworkRows").innerHTML = artworks.length
      ? artworks.map((artwork) => `<tr>
          <td><strong>${escapeHtml(artwork.title)}</strong><small>${escapeHtml(artwork.medium)} · ${escapeHtml(artwork.year)} · ${escapeHtml(artwork.dimensions)}</small></td>
          <td>${escapeHtml(names.get(artwork.owner_id) || "Administrator")}</td>
          <td><span class="status ${escapeHtml(artwork.status)}">${escapeHtml(artwork.status)}</span></td>
          <td><div class="row-actions">
            ${artwork.status === "pending" ? `<button class="button small-button" type="button" data-publish="${escapeHtml(artwork.id)}">PUBLISH</button><button class="button small-button" type="button" data-reject="${escapeHtml(artwork.id)}">REJECT</button>` : ""}
            <button class="button small-button" type="button" data-delete="${escapeHtml(artwork.id)}">DELETE</button>
          </div></td>
        </tr>`).join("")
      : '<tr><td colspan="4" class="empty">No artwork submissions yet.</td></tr>';
  }
}

async function uploadArtwork(form, status, messageElement) {
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  const file = form.elements.image.files[0];
  let imagePath;
  try {
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      throw new Error("Choose a JPG, PNG, or WebP image smaller than 5 MB.");
    }

    const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
    imagePath = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("artwork-images")
      .upload(imagePath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);

    const values = new FormData(form);
    const { error: insertError } = await supabase.from("artworks").insert({
      owner_id: currentUser.id,
      title: String(values.get("title")).trim(),
      medium: values.get("medium"),
      year: Number(values.get("year")),
      dimensions: String(values.get("dimensions") || "").trim(),
      description: String(values.get("description") || "").trim(),
      image_path: imagePath,
      status,
    });
    if (insertError) {
      const { error: cleanupError } = await supabase.storage.from("artwork-images").remove([imagePath]);
      if (cleanupError) console.error("Uploaded image cleanup failed:", cleanupError.message);
      throw new Error(`Artwork could not be saved: ${insertError.message}`);
    }

    form.reset();
    setMessage(messageElement, status === "published" ? "Artwork published." : "Artwork submitted for review.", true);
    await loadArtworkRows();
  } finally {
    submitButton.disabled = false;
  }
}

async function updateStatus(id, status) {
  const { error } = await supabase.from("artworks").update({ status }).eq("id", id);
  if (error) throw new Error(`Artwork could not be updated: ${error.message}`);
  await loadArtworkRows();
  showToast(status === "published" ? "Artwork published." : "Submission rejected.");
}

async function deleteArtwork(id) {
  const { data, error: fetchError } = await supabase
    .from("artworks")
    .select("image_path")
    .eq("id", id)
    .single();
  if (fetchError) throw new Error(`Could not load artwork: ${fetchError.message}`);
  const { error } = await supabase.from("artworks").delete().eq("id", id);
  if (error) throw new Error(`Artwork could not be deleted: ${error.message}`);
  const { error: imageError } = await supabase.storage.from("artwork-images").remove([data.image_path]);
  await loadArtworkRows();
  if (imageError) {
    showToast(`Artwork deleted, but its image could not be removed: ${imageError.message}`);
    return;
  }
  showToast("Artwork deleted.");
}

document.querySelectorAll(".role-button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedRole = button.dataset.role;
    document.querySelectorAll(".role-button").forEach((option) => {
      option.classList.toggle("active", option === button);
    });
    setMessage(loginMessage, "");
  });
});

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.getElementById("loginButton");
  button.disabled = true;
  setMessage(loginMessage, "");
  try {
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    currentUser = data.user;
    const profile = await loadProfile(currentUser.id);
    if (profile.role !== selectedRole) {
      await supabase.auth.signOut();
      currentUser = undefined;
      throw new Error(`This account is registered as ${profile.role}. Choose the matching login and try again.`);
    }
    showDashboard(profile);
  } catch (error) {
    setMessage(loginMessage, error.message || "Sign-in failed.");
  } finally {
    button.disabled = false;
  }
});

document.getElementById("resetButton").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  if (!email) {
    setMessage(loginMessage, "Enter your email address first.");
    return;
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href.split("#")[0],
  });
  setMessage(loginMessage, error ? `Password reset failed: ${error.message}` : "Password reset email sent.", !error);
});

document.getElementById("signOutButton").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    showToast(`Could not sign out: ${error.message}`);
    return;
  }
  currentUser = undefined;
  currentRole = undefined;
  dashboardView.classList.add("hidden");
  loginView.classList.remove("hidden");
});

document.getElementById("artistArtworkForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await uploadArtwork(form, "pending", document.getElementById("artistMessage"));
  } catch (error) {
    setMessage(document.getElementById("artistMessage"), error.message || "Submission failed.");
  }
});

document.getElementById("adminArtworkForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await uploadArtwork(form, "published", document.getElementById("adminMessage"));
  } catch (error) {
    setMessage(document.getElementById("adminMessage"), error.message || "Artwork could not be published.");
  }
});

document.getElementById("inviteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setMessage(document.getElementById("inviteMessage"), "");
  try {
    const values = new FormData(form);
    const { data, error } = await supabase.functions.invoke("invite-artist", {
      body: {
        email: String(values.get("email")).trim(),
        displayName: String(values.get("displayName")).trim(),
      },
    });
    if (error) {
      const detail = error.context && typeof error.context.json === "function"
        ? await error.context.json().catch(() => null)
        : null;
      throw new Error(detail?.error || error.message);
    }
    if (data?.error) throw new Error(data.error);
    form.reset();
    setMessage(document.getElementById("inviteMessage"), data.message || "Invitation sent.", true);
  } catch (error) {
    setMessage(document.getElementById("inviteMessage"), error.message || "Invitation failed.");
  } finally {
    submitButton.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-publish], [data-reject], [data-delete]");
  if (!button) return;
  button.disabled = true;
  try {
    if (button.dataset.publish) await updateStatus(button.dataset.publish, "published");
    else if (button.dataset.reject) await updateStatus(button.dataset.reject, "rejected");
    else await deleteArtwork(button.dataset.delete);
  } catch (error) {
    showToast(error.message || "The action failed.");
  } finally {
    button.disabled = false;
  }
});

if (!config?.url || !config?.anonKey) {
  configMessage.textContent = "Supabase is not configured yet. Add your project URL and anon key to supabase-config.js, then follow the setup steps in README.md.";
  document.querySelectorAll("#loginForm input, #loginForm button, #resetButton").forEach((element) => {
    element.disabled = true;
  });
} else {
  supabase = createClient(config.url, config.anonKey);
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    setMessage(loginMessage, `Could not check the current session: ${error.message}`);
  } else if (session?.user) {
    currentUser = session.user;
    try {
      showDashboard(await loadProfile(currentUser.id));
    } catch (profileError) {
      setMessage(loginMessage, profileError.message);
    }
  }
}
