const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allLocations = [];
let allSubmissions = [];
let isAdmin = false;
let userMarker = null;
let nearestMarker = null;
let editingMarker = null;
let editingContext = null;
let dropPinMapHandler = null;

const map = L.map("map").setView([-25.0, 133.0], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const markerClusterLayer = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 48,
  spiderfyOnMaxZoom: true
});
markerClusterLayer.addTo(map);

const submissionLayer = L.layerGroup().addTo(map);

const elements = {
  searchInput: document.getElementById("searchInput"),
  filterClothes: document.getElementById("filterClothes"),
  filterBooks: document.getElementById("filterBooks"),
  filterHousehold: document.getElementById("filterHousehold"),
  typeFilters: [...document.querySelectorAll(".typeFilter")],
  locationTypeFilters: [...document.querySelectorAll(".locationTypeFilter")],
  resetFilters: document.getElementById("resetFilters"),
  nearestBinButton: document.getElementById("nearestBinButton"),
  nearestResult: document.getElementById("nearestResult"),
  resultCount: document.getElementById("resultCount"),
  adminLoginButton: document.getElementById("adminLoginButton"),
  adminLogoutButton: document.getElementById("adminLogoutButton"),
  adminPanel: document.getElementById("adminPanel"),
  showSubmissionsToggle: document.getElementById("showSubmissionsToggle"),
  submissionCount: document.getElementById("submissionCount"),

  movePanel: document.getElementById("movePanel"),
  movePanelTitle: document.getElementById("movePanelTitle"),
  movePanelText: document.getElementById("movePanelText"),
  finishMoveButton: document.getElementById("finishMoveButton"),
  cancelMoveButton: document.getElementById("cancelMoveButton"),

  openSubmitModal: document.getElementById("openSubmitModal"),
  closeSubmitModal: document.getElementById("closeSubmitModal"),
  cancelSubmit: document.getElementById("cancelSubmit"),
  submitModal: document.getElementById("submitModal"),
  submitForm: document.getElementById("submitForm"),
  submitMessage: document.getElementById("submitMessage"),
  submitTitle: document.getElementById("submitTitle"),
  submitSubtitle: document.getElementById("submitSubtitle"),
  coordinateHint: document.getElementById("coordinateHint"),
  useMapCentreButton: document.getElementById("useMapCentreButton")
};

function makeIcon(type, options = {}) {
  const className = options.isEditing
    ? "marker-editing"
    : options.isSubmission
      ? "marker-submission"
      : type === "bin"
        ? "marker-bin"
        : type === "reuse_centre"
          ? "marker-reuse-centre"
          : "marker-op-shop";

  const size = options.isNearest || options.isSubmission || options.isEditing ? 26 : 18;

  return L.divIcon({
    html: `<div class="marker-dot ${className}" style="width:${size}px;height:${size}px"></div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -10]
  });
}

function makeUserIcon() {
  return L.divIcon({
    html: '<div class="marker-dot marker-user" style="width:22px;height:22px"></div>',
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -10]
  });
}

function prettyType(type) {
  return {
    bin: "Donation bin",
    op_shop: "Op shop",
    reuse_centre: "Reuse centre"
  }[type] || type || "Unknown";
}

function prettyVerification(status) {
  if (!status) return "Unverified";
  return String(status).toLowerCase().includes("verified") ? "Verified" : "Unverified";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function boolBadge(label, value) {
  return `<span class="badge ${value ? "yes" : "no"}">${label}: ${value ? "Yes" : "No"}</span>`;
}

function popupHtml(location) {
  const adminMoveButton = isAdmin
    ? `<button onclick="window.startAdminMoveLocation('${location.id}')">Admin: move location</button>`
    : "";

  return `
    <div class="popup-card">
      <h3>${escapeHtml(location.name || "Unnamed location")}</h3>
      <p><strong>${prettyType(location.type)}</strong>${location.operator ? ` · ${escapeHtml(location.operator)}` : ""}</p>
      <p>${escapeHtml(location.address || "")}</p>
      <div class="badges">
        ${boolBadge("Clothes", location.accepts_clothes)}
        ${boolBadge("Books", location.accepts_books)}
        ${boolBadge("Household", location.accepts_household_goods)}
        <span class="badge ${prettyVerification(location.verification_status) === "Verified" ? "yes" : "no"}">${prettyVerification(location.verification_status)}</span>
      </div>
      ${location.notes ? `<p class="meta">${escapeHtml(location.notes)}</p>` : ""}
      <div class="popup-actions">
        <button onclick="window.startPublicModifyLocation('${location.id}')">Suggest an update</button>
        <button class="danger" onclick="window.startPublicRemoveLocation('${location.id}')">Report not there anymore</button>
        ${adminMoveButton}
      </div>
    </div>
  `;
}

function submissionPopupHtml(submission) {
  return `
    <div class="popup-card">
      <h3>${escapeHtml(submission.name || "Unnamed submission")}</h3>
      <p><strong>Pending ${escapeHtml(submission.submission_type || "submission")}</strong></p>
      <p>${escapeHtml(submission.address || "")}</p>
      <div class="badges">
        <span class="badge pending">Pending review</span>
        ${boolBadge("Clothes", submission.accepts_clothes)}
        ${boolBadge("Books", submission.accepts_books)}
        ${boolBadge("Household", submission.accepts_household_goods)}
      </div>
      ${submission.notes ? `<p class="meta">${escapeHtml(submission.notes)}</p>` : ""}
      <div class="popup-actions">
        <button onclick="window.startReviewSubmission('${submission.id}')">Move / review</button>
        <button class="danger" onclick="window.rejectSubmission('${submission.id}')">Reject</button>
      </div>
    </div>
  `;
}

function getSelectedValues(checkboxes) {
  return checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
}

function hasValidCoords(location) {
  const lat = Number(location.latitude);
  const lon = Number(location.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function locationPassesFilters(location) {
  if (!hasValidCoords(location)) return false;
  if (elements.filterClothes.checked && !location.accepts_clothes) return false;
  if (elements.filterBooks.checked && !location.accepts_books) return false;
  if (elements.filterHousehold.checked && !location.accepts_household_goods) return false;

  const selectedTypes = getSelectedValues(elements.typeFilters);
  if (!selectedTypes.includes(location.type)) return false;

  const selectedLocationTypes = getSelectedValues(elements.locationTypeFilters);
  if (!selectedLocationTypes.includes(location.location_type || "other")) return false;

  const searchTerm = elements.searchInput.value.trim().toLowerCase();
  if (searchTerm) {
    const haystack = [location.name, location.operator, location.address, location.suburb, location.postcode]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(searchTerm)) return false;
  }

  return true;
}

function getFilteredLocations() {
  return allLocations.filter(locationPassesFilters);
}

function renderLocations({ fit = false } = {}) {
  markerClusterLayer.clearLayers();
  const filtered = getFilteredLocations();

  filtered.forEach((location) => {
    L.marker([Number(location.latitude), Number(location.longitude)], { icon: makeIcon(location.type) })
      .bindPopup(popupHtml(location))
      .addTo(markerClusterLayer);
  });

  elements.resultCount.textContent = filtered.length;

  if (fit && filtered.length > 0) {
    const bounds = L.latLngBounds(filtered.map((loc) => [Number(loc.latitude), Number(loc.longitude)]));
    map.fitBounds(bounds.pad(0.15), { maxZoom: 13 });
  }
}

function renderSubmissions() {
  submissionLayer.clearLayers();

  if (!isAdmin || !elements.showSubmissionsToggle.checked) {
    elements.submissionCount.textContent = allSubmissions.length;
    return;
  }

  allSubmissions.forEach((submission) => {
    if (!hasValidCoords(submission)) return;

    L.marker([Number(submission.latitude), Number(submission.longitude)], {
      icon: makeIcon(submission.type, { isSubmission: true })
    })
      .bindPopup(submissionPopupHtml(submission))
      .addTo(submissionLayer);
  });

  elements.submissionCount.textContent = allSubmissions.length;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const radiusKm = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function setNearestMessage(html) {
  elements.nearestResult.innerHTML = html;
  elements.nearestResult.classList.add("visible");
}

function findNearestBin() {
  if (!navigator.geolocation) {
    setNearestMessage("Your browser does not support location services.");
    return;
  }

  setNearestMessage("Finding your location...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const userLat = position.coords.latitude;
      const userLon = position.coords.longitude;
      const candidateBins = getFilteredLocations().filter((location) => location.type === "bin");

      if (candidateBins.length === 0) {
        setNearestMessage("No donation bins match your current filters.");
        return;
      }

      const nearest = candidateBins
        .map((location) => ({
          ...location,
          distance_km: distanceKm(userLat, userLon, Number(location.latitude), Number(location.longitude))
        }))
        .sort((a, b) => a.distance_km - b.distance_km)[0];

      if (userMarker) map.removeLayer(userMarker);
      if (nearestMarker) map.removeLayer(nearestMarker);

      userMarker = L.marker([userLat, userLon], { icon: makeUserIcon() })
        .bindPopup("You are here")
        .addTo(map);

      nearestMarker = L.marker([Number(nearest.latitude), Number(nearest.longitude)], {
        icon: makeIcon(nearest.type, { isNearest: true })
      })
        .bindPopup(popupHtml(nearest))
        .addTo(map);

      const bounds = L.latLngBounds([
        [userLat, userLon],
        [Number(nearest.latitude), Number(nearest.longitude)]
      ]);

      map.fitBounds(bounds.pad(0.4), { maxZoom: 15 });

      setNearestMessage(`<strong>${escapeHtml(nearest.name)}</strong>${escapeHtml(nearest.address || "")}<br>${nearest.distance_km.toFixed(1)} km away`);
      nearestMarker.openPopup();
    },
    (error) => {
      console.error(error);
      if (error.code === 1) setNearestMessage("Location blocked. Enable location permissions in your browser.");
      else setNearestMessage("Could not access your location. Try again.");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

async function loadLocations() {
  const pageSize = 1000;
  let from = 0;
  let allData = [];

  while (true) {
    const { data, error } = await supabaseClient
      .from("locations")
      .select(`
        id,
        name,
        type,
        operator,
        address,
        suburb,
        state,
        postcode,
        location_type,
        accepts_clothes,
        accepts_books,
        accepts_household_goods,
        notes,
        verification_status,
        latitude,
        longitude
      `)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .range(from, from + pageSize - 1);

    if (error) {
      console.error(error);
      alert("Could not load locations from Supabase.");
      return;
    }

    allData = allData.concat(data || []);

    if (!data || data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  allLocations = allData.map((location) => ({
    ...location,
    latitude: Number(location.latitude),
    longitude: Number(location.longitude)
  }));

  console.log("Loaded locations:", allLocations.length);
  console.log("Valid coords:", allLocations.filter(hasValidCoords).length);

  if (!window._hasFitted) {
    renderLocations({ fit: true });
    window._hasFitted = true;
  } else {
    renderLocations();
  }
}

async function loadSubmissions() {
  if (!isAdmin) {
    allSubmissions = [];
    renderSubmissions();
    return;
  }

  const { data, error } = await supabaseClient
    .from("submissions")
    .select(`
      id,
      submission_type,
      location_id,
      name,
      type,
      operator,
      address,
      suburb,
      state,
      postcode,
      location_type,
      accepts_clothes,
      accepts_books,
      accepts_household_goods,
      notes,
      latitude,
      longitude,
      status,
      submitted_at
    `)
    .eq("status", "pending")
    .limit(1000);

  if (error) {
    console.error(error);
    alert("Could not load submissions. Check authenticated RLS policies.");
    return;
  }

  allSubmissions = (data || []).map((submission) => ({
    ...submission,
    latitude: Number(submission.latitude),
    longitude: Number(submission.longitude)
  }));

  renderSubmissions();
}

function resetFilters() {
  elements.searchInput.value = "";
  elements.filterClothes.checked = false;
  elements.filterBooks.checked = false;
  elements.filterHousehold.checked = false;
  elements.typeFilters.forEach((checkbox) => (checkbox.checked = true));
  elements.locationTypeFilters.forEach((checkbox) => (checkbox.checked = true));
  elements.nearestResult.classList.remove("visible");
  elements.nearestResult.innerHTML = "";

  if (userMarker) {
    map.removeLayer(userMarker);
    userMarker = null;
  }

  if (nearestMarker) {
    map.removeLayer(nearestMarker);
    nearestMarker = null;
  }

  clearEditingMarker();
  renderLocations({ fit: true });
  renderSubmissions();
}

function clearEditingMarker() {
  if (editingMarker) {
    map.removeLayer(editingMarker);
    editingMarker = null;
  }

  if (dropPinMapHandler) {
    map.off("click", dropPinMapHandler);
    dropPinMapHandler = null;
  }

  editingContext = null;
  elements.movePanel.classList.add("hidden");
}

function startMoveMode({ title, text, context, lat = null, lon = null, buttonText = "Save moved point" }) {
  clearEditingMarker();

  editingContext = context;
  elements.movePanelTitle.textContent = title;
  elements.movePanelText.textContent = text;
  elements.finishMoveButton.textContent = buttonText;
  elements.movePanel.classList.remove("hidden");

  if (lat != null && lon != null) {
    editingMarker = L.marker([lat, lon], {
      draggable: true,
      icon: makeIcon("bin", { isEditing: true })
    }).addTo(map);

    map.setView([lat, lon], Math.max(map.getZoom(), 15));
  }
}

function startDropPinMode() {
  startMoveMode({
    title: "Drop a pin",
    text: "Click the map where the new place is. You can drag the red marker after dropping it, then continue to the form.",
    context: { type: "public_new" },
    buttonText: "Continue to form"
  });

  dropPinMapHandler = (event) => {
    const latlng = event.latlng;

    if (!editingMarker) {
      editingMarker = L.marker([latlng.lat, latlng.lng], {
        draggable: true,
        icon: makeIcon("bin", { isEditing: true })
      }).addTo(map);
    } else {
      editingMarker.setLatLng(latlng);
    }

    elements.movePanelText.textContent = "Pin dropped. Drag it if needed, then continue to the form.";
  };

  map.on("click", dropPinMapHandler);
}

async function finishMove() {
  if (!editingMarker || !editingContext) return;

  const latlng = editingMarker.getLatLng();

  if (editingContext.type === "public_new") {
    if (!editingMarker) {
      alert("Click the map to drop a pin first.");
      return;
    }

    openSubmissionForm({
      mode: "new",
      title: "Suggest a new place",
      subtitle: "Add the details for the pin you dropped. Your suggestion will be reviewed.",
      location: null,
      latitude: latlng.lat,
      longitude: latlng.lng
    });

    clearEditingMarker();
    return;
  }

  if (editingContext.type === "public_update") {
    openSubmissionForm({
      mode: "update",
      title: "Suggest an update",
      subtitle: "Update any details that need changing. Your moved point has been saved into this suggestion.",
      location: editingContext.location,
      latitude: latlng.lat,
      longitude: latlng.lng
    });
    clearEditingMarker();
    return;
  }

  if (editingContext.type === "admin_location") {
    const { error } = await supabaseClient
      .from("locations")
      .update({
        latitude: latlng.lat,
        longitude: latlng.lng,
        verification_status: "manual_verified"
      })
      .eq("id", editingContext.id);

    if (error) {
      console.error(error);
      alert("Could not update location. Check authenticated RLS policies.");
      return;
    }

    clearEditingMarker();
    await loadLocations();
    alert("Location updated.");
    return;
  }

  if (editingContext.type === "submission") {
    await approveSubmissionFromMove(latlng);
  }
}

window.startPublicModifyLocation = function(id) {
  const location = allLocations.find((item) => item.id === id);
  if (!location) return;

  startMoveMode({
    title: "Move the point first",
    text: "Drag the red marker to the correct location, then click Save moved point to update the form.",
    context: { type: "public_update", location },
    lat: Number(location.latitude),
    lon: Number(location.longitude)
  });
};

window.startPublicRemoveLocation = function(id) {
  const location = allLocations.find((item) => item.id === id);
  if (!location) return;

  openSubmissionForm({
    mode: "report_missing",
    title: "Report location missing",
    subtitle: "Tell us why this place is no longer there. Your report will be reviewed.",
    location,
    latitude: Number(location.latitude),
    longitude: Number(location.longitude)
  });
};

window.startAdminMoveLocation = function(id) {
  const location = allLocations.find((item) => item.id === id);
  if (!location) return;

  startMoveMode({
    title: "Admin: move location",
    text: "Drag the red marker to the correct location, then save.",
    context: { type: "admin_location", id },
    lat: Number(location.latitude),
    lon: Number(location.longitude)
  });
};

window.startMoveLocation = window.startAdminMoveLocation;

window.startReviewSubmission = function(id) {
  const submission = allSubmissions.find((item) => item.id === id);
  if (!submission) return;

  let lat = Number(submission.latitude);
  let lon = Number(submission.longitude);

  if (!hasValidCoords(submission)) {
    const centre = map.getCenter();
    lat = centre.lat;
    lon = centre.lng;
  }

  startMoveMode({
    title: "Review submission",
    text: "Drag the red marker to the correct location, then approve.",
    context: { type: "submission", id },
    lat,
    lon
  });
};

async function approveSubmissionFromMove(latlng) {
  const submission = allSubmissions.find((item) => item.id === editingContext.id);
  if (!submission) return;

  const locationPayload = {
    name: submission.name || "Unnamed location",
    type: submission.type || "bin",
    operator: submission.operator || null,
    address: submission.address || null,
    suburb: submission.suburb || null,
    state: submission.state || "SA",
    postcode: submission.postcode || null,
    location_type: submission.location_type || "standalone",
    accepts_clothes: !!submission.accepts_clothes,
    accepts_books: !!submission.accepts_books,
    accepts_household_goods: !!submission.accepts_household_goods,
    notes: submission.notes || null,
    source: "Community submission",
    verification_status: "manual_verified",
    latitude: latlng.lat,
    longitude: latlng.lng
  };

  let locationError = null;

  if (submission.submission_type === "update" && submission.location_id) {
    const { error } = await supabaseClient
      .from("locations")
      .update(locationPayload)
      .eq("id", submission.location_id);

    locationError = error;
  } else if (submission.submission_type === "report_missing" && submission.location_id) {
    const { error } = await supabaseClient
      .from("locations")
      .update({
        verification_status: "missing",
        notes: submission.notes || "Reported removed by community submission."
      })
      .eq("id", submission.location_id);

    locationError = error;
  } else {
    const { error } = await supabaseClient
      .from("locations")
      .insert(locationPayload);

    locationError = error;
  }

  if (locationError) {
    console.error(locationError);
    alert("Could not approve submission into locations. Check authenticated RLS policies.");
    return;
  }

  const { error: submissionError } = await supabaseClient
    .from("submissions")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewer_notes: "Approved via map review"
    })
    .eq("id", submission.id);

  if (submissionError) {
    console.error(submissionError);
    alert("Location was approved, but submission status could not be updated.");
    return;
  }

  clearEditingMarker();
  await loadLocations();
  await loadSubmissions();
  alert("Submission approved.");
}

window.rejectSubmission = async function(id) {
  if (!confirm("Reject this submission?")) return;

  const { error } = await supabaseClient
    .from("submissions")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewer_notes: "Rejected via map review"
    })
    .eq("id", id);

  if (error) {
    console.error(error);
    alert("Could not reject submission. Check authenticated RLS policies.");
    return;
  }

  clearEditingMarker();
  await loadSubmissions();
};

async function adminLogin() {
  const email = prompt("Admin email");
  if (!email) return;

  const password = prompt("Admin password");
  if (!password) return;

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    console.error(error);
    alert("Login failed.");
    return;
  }

  await refreshAdminState();
}

async function adminLogout() {
  await supabaseClient.auth.signOut();
  await refreshAdminState();
}

async function refreshAdminState() {
  const { data } = await supabaseClient.auth.getSession();
  isAdmin = !!data.session;

  elements.adminPanel.classList.toggle("hidden", !isAdmin);
  elements.adminLoginButton.classList.toggle("hidden", isAdmin);
  elements.adminLogoutButton.classList.toggle("hidden", !isAdmin);
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", !isAdmin));

  if (isAdmin) {
    await loadSubmissions();
  } else {
    allSubmissions = [];
    renderSubmissions();
  }

  renderLocations();
}

function openSubmitModal() {
  startDropPinMode();
}

function openSubmissionForm({ mode, title, subtitle, location, latitude, longitude }) {
  elements.submitForm.reset();
  elements.submitTitle.textContent = title;
  elements.submitSubtitle.textContent = subtitle;
  elements.submitForm.elements.submission_type.value = mode;
  elements.submitForm.elements.location_id.value = location?.id || "";

  if (location) {
    elements.submitForm.elements.name.value = location.name || "";
    elements.submitForm.elements.type.value = location.type || "bin";
    elements.submitForm.elements.operator.value = location.operator || "";
    elements.submitForm.elements.address.value = location.address || "";
    elements.submitForm.elements.suburb.value = location.suburb || "";
    elements.submitForm.elements.postcode.value = location.postcode || "";
    elements.submitForm.elements.location_type.value = location.location_type || "standalone";
    elements.submitForm.elements.accepts_clothes.checked = !!location.accepts_clothes;
    elements.submitForm.elements.accepts_books.checked = !!location.accepts_books;
    elements.submitForm.elements.accepts_household_goods.checked = !!location.accepts_household_goods;
    elements.submitForm.elements.notes.value = mode === "report_missing"
      ? `This location appears to no longer be there. ${location.notes || ""}`.trim()
      : location.notes || "";
  }

  if (latitude != null && longitude != null) {
    elements.submitForm.elements.latitude.value = Number(latitude).toFixed(6);
    elements.submitForm.elements.longitude.value = Number(longitude).toFixed(6);
  } else {
    elements.submitForm.elements.latitude.value = "";
    elements.submitForm.elements.longitude.value = "";
  }

  elements.coordinateHint.textContent = mode === "update"
    ? "Coordinates were set from the marker you moved."
    : mode === "report_missing"
      ? "This report keeps the original location coordinates for review."
      : mode === "new"
        ? "Coordinates were set from the pin you dropped."
        : "Coordinates are optional. Use the map centre button if helpful.";

  elements.submitModal.classList.add("open");
  elements.submitModal.setAttribute("aria-hidden", "false");
  setSubmitMessage("", "");
}

function closeSubmitModal() {
  elements.submitModal.classList.remove("open");
  elements.submitModal.setAttribute("aria-hidden", "true");
}

function setSubmitMessage(message, type) {
  elements.submitMessage.textContent = message;
  elements.submitMessage.className = "submit-message";

  if (message) {
    elements.submitMessage.classList.add("visible", type);
  }
}

function valueOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function numberOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

async function handleSubmit(event) {
  event.preventDefault();

  const formData = new FormData(elements.submitForm);
  const latitude = numberOrNull(formData.get("latitude"));
  const longitude = numberOrNull(formData.get("longitude"));

  if ((latitude !== null && (latitude < -90 || latitude > 90)) || (longitude !== null && (longitude < -180 || longitude > 180))) {
    setSubmitMessage("Latitude or longitude looks invalid.", "error");
    return;
  }

  const payload = {
    submission_type: valueOrNull(formData.get("submission_type")),
    location_id: valueOrNull(formData.get("location_id")),
    name: valueOrNull(formData.get("name")),
    type: valueOrNull(formData.get("type")),
    operator: valueOrNull(formData.get("operator")),
    address: valueOrNull(formData.get("address")),
    suburb: valueOrNull(formData.get("suburb")),
    state: "SA",
    postcode: valueOrNull(formData.get("postcode")),
    location_type: valueOrNull(formData.get("location_type")) || "standalone",
    accepts_clothes: formData.has("accepts_clothes"),
    accepts_books: formData.has("accepts_books"),
    accepts_household_goods: formData.has("accepts_household_goods"),
    notes: valueOrNull(formData.get("notes")),
    submitted_by_name: valueOrNull(formData.get("submitted_by_name")),
    submitted_by_email: valueOrNull(formData.get("submitted_by_email")),
    latitude,
    longitude,
    status: "pending"
  };

  setSubmitMessage("Submitting...", "success");

  const { error } = await supabaseClient
    .from("submissions")
    .insert(payload);

  if (error) {
    console.error(error);
    setSubmitMessage("Submission failed. Check Supabase RLS policy for public submissions.", "error");
    return;
  }

  elements.submitForm.reset();
  setSubmitMessage("Thanks! Your suggestion has been submitted for review.", "success");

  if (isAdmin) await loadSubmissions();
}

function useMapCentreForSubmission() {
  const centre = map.getCenter();
  elements.submitForm.elements.latitude.value = centre.lat.toFixed(6);
  elements.submitForm.elements.longitude.value = centre.lng.toFixed(6);
}

[
  elements.searchInput,
  elements.filterClothes,
  elements.filterBooks,
  elements.filterHousehold,
  ...elements.typeFilters,
  ...elements.locationTypeFilters
].forEach((element) => {
  element.addEventListener("input", () => renderLocations());
  element.addEventListener("change", () => renderLocations());
});

elements.resetFilters.addEventListener("click", resetFilters);
elements.nearestBinButton.addEventListener("click", findNearestBin);
elements.adminLoginButton.addEventListener("click", adminLogin);
elements.adminLogoutButton.addEventListener("click", adminLogout);
elements.showSubmissionsToggle.addEventListener("change", renderSubmissions);

elements.finishMoveButton.addEventListener("click", finishMove);
elements.cancelMoveButton.addEventListener("click", clearEditingMarker);

elements.openSubmitModal.addEventListener("click", openSubmitModal);
elements.closeSubmitModal.addEventListener("click", closeSubmitModal);
elements.cancelSubmit.addEventListener("click", closeSubmitModal);
elements.submitModal.addEventListener("click", (event) => {
  if (event.target === elements.submitModal) closeSubmitModal();
});
elements.submitForm.addEventListener("submit", handleSubmit);
elements.useMapCentreButton.addEventListener("click", useMapCentreForSubmission);

async function init() {
  await loadLocations();
  await refreshAdminState();
}

init();
