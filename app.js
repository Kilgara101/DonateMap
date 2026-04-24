const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allLocations = [];
let userMarker = null;
let nearestMarker = null;
let proposedMarker = null;
let editMarker = null;
let placementMode = false;
let editingLocation = null;

const map = L.map("map").setView([-34.9285, 138.6007], 11);

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

const elements = {
  searchInput: document.getElementById("searchInput"),
  filterClothes: document.getElementById("filterClothes"),
  filterBooks: document.getElementById("filterBooks"),
  filterHousehold: document.getElementById("filterHousehold"),
  typeFilters: [...document.querySelectorAll(".typeFilter")],
  locationTypeFilters: [...document.querySelectorAll(".locationTypeFilter")],
  verificationFilters: [...document.querySelectorAll(".verificationFilter")],
  resetFilters: document.getElementById("resetFilters"),
  nearestBinButton: document.getElementById("nearestBinButton"),
  nearestResult: document.getElementById("nearestResult"),
  resultCount: document.getElementById("resultCount"),

  openSubmitModal: document.getElementById("openSubmitModal"),
  closeSubmitModal: document.getElementById("closeSubmitModal"),
  cancelSubmit: document.getElementById("cancelSubmit"),
  submitModal: document.getElementById("submitModal"),
  submitForm: document.getElementById("submitForm"),
  submitTitle: document.getElementById("submitTitle"),
  submitSubtitle: document.getElementById("submitSubtitle"),
  submitMessage: document.getElementById("submitMessage"),
  useMapCentreButton: document.getElementById("useMapCentreButton"),
  mapPrompt: document.getElementById("mapPrompt"),
  cancelPlacement: document.getElementById("cancelPlacement"),
  editPrompt: document.getElementById("editPrompt"),
  cancelEditPlacement: document.getElementById("cancelEditPlacement")
};

function makeIcon(type, isNearest = false) {
  const className = isNearest
    ? "marker-bin"
    : type === "bin"
      ? "marker-bin"
      : type === "reuse_centre"
        ? "marker-reuse-centre"
        : "marker-op-shop";

  const size = isNearest ? 26 : 18;

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
    html: `<div class="marker-dot marker-user" style="width:22px;height:22px"></div>`,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -10]
  });
}

function makeProposedIcon() {
  return L.divIcon({
    html: `<div class="marker-dot marker-proposed" style="width:26px;height:26px"></div>`,
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -10]
  });
}

function makeEditIcon() {
  return L.divIcon({
    html: `<div class="marker-dot marker-edit" style="width:28px;height:28px"></div>`,
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
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
  return {
    manual_verified: "Manually verified",
    qgis_verified: "QGIS verified",
    python_geocoded: "Geocoded",
    missing: "Unverified"
  }[status] || "Unknown";
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
  const verification = location.verification_status || "missing";

  return `
    <div class="popup-card">
      <h3>${escapeHtml(location.name || "Unnamed location")}</h3>
      <p><strong>${prettyType(location.type)}</strong>${location.operator ? ` · ${escapeHtml(location.operator)}` : ""}</p>
      <p>${escapeHtml(location.address || "")}</p>
      <div class="badges">
        ${boolBadge("Clothes", location.accepts_clothes)}
        ${boolBadge("Books", location.accepts_books)}
        ${boolBadge("Household", location.accepts_household_goods)}
      </div>
      ${location.notes ? `<p class="meta">${escapeHtml(location.notes)}</p>` : ""}
      <span class="verification-pill ${escapeHtml(verification)}">${prettyVerification(verification)}</span>
      <div class="verify-row">
        <button onclick="verifyLocation('${location.id}')">Verify this place</button>
        <button onclick="startExistingLocationUpdate('${location.id}')">Move / update details</button>
        <button class="danger-button" onclick="reportMissingLocation('${location.id}')">Report missing / wrong</button>
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

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
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

  const selectedVerificationStatuses = getSelectedValues(elements.verificationFilters);
  if (!selectedVerificationStatuses.includes(location.verification_status || "missing")) return false;

  const searchTerm = elements.searchInput.value.trim().toLowerCase();
  if (searchTerm) {
    const haystack = [
      location.name,
      location.operator,
      location.address,
      location.suburb,
      location.postcode
    ].filter(Boolean).join(" ").toLowerCase();

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
    L.marker([Number(location.latitude), Number(location.longitude)], {
      icon: makeIcon(location.type)
    })
      .bindPopup(popupHtml(location))
      .addTo(markerClusterLayer);
  });

  elements.resultCount.textContent = filtered.length;

  if (fit && filtered.length > 0) {
    const bounds = L.latLngBounds(filtered.map((loc) => [Number(loc.latitude), Number(loc.longitude)]));
    map.fitBounds(bounds.pad(0.15), { maxZoom: 13 });
  }
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const radiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(degrees) {
  return degrees * Math.PI / 180;
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
        icon: makeIcon(nearest.type, true)
      })
        .bindPopup(popupHtml(nearest))
        .addTo(map);

      const bounds = L.latLngBounds([
        [userLat, userLon],
        [Number(nearest.latitude), Number(nearest.longitude)]
      ]);

      map.fitBounds(bounds.pad(0.4), { maxZoom: 15 });

      setNearestMessage(`
        <strong>${escapeHtml(nearest.name)}</strong>
        ${escapeHtml(nearest.address || "")}<br>
        ${nearest.distance_km.toFixed(1)} km away
      `);

      nearestMarker.openPopup();
    },
    (error) => {
      console.error(error);
      setNearestMessage("Could not access your location. Check browser permissions.");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

async function loadLocations() {
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
    .limit(1000);

  if (error) {
    console.error(error);
    alert("Could not load locations from Supabase. Check config.js and RLS policy.");
    return;
  }

  allLocations = (data || []).map((location) => ({
    ...location,
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    verification_status: location.verification_status || "missing"
  }));

  renderLocations({ fit: true });
}

function resetFilters() {
  elements.searchInput.value = "";
  elements.filterClothes.checked = false;
  elements.filterBooks.checked = false;
  elements.filterHousehold.checked = false;
  elements.typeFilters.forEach((checkbox) => (checkbox.checked = true));
  elements.locationTypeFilters.forEach((checkbox) => (checkbox.checked = true));
  elements.verificationFilters.forEach((checkbox) => (checkbox.checked = true));
  elements.nearestResult.classList.remove("visible");
  elements.nearestResult.innerHTML = "";

  clearTransientMarkers();
  renderLocations({ fit: true });
}

function clearTransientMarkers() {
  if (userMarker) {
    map.removeLayer(userMarker);
    userMarker = null;
  }
  if (nearestMarker) {
    map.removeLayer(nearestMarker);
    nearestMarker = null;
  }
  if (proposedMarker) {
    map.removeLayer(proposedMarker);
    proposedMarker = null;
  }
  if (editMarker) {
    map.removeLayer(editMarker);
    editMarker = null;
  }
}

function clearProposedMarker() {
  if (proposedMarker) {
    map.removeLayer(proposedMarker);
    proposedMarker = null;
  }
}

function clearEditMarker() {
  if (editMarker) {
    map.removeLayer(editMarker);
    editMarker = null;
  }
  editingLocation = null;
}

function startPlacementMode() {
  resetFormForNewLocation();
  clearEditMarker();
  clearProposedMarker();

  placementMode = true;
  document.body.classList.add("placement-active");
  elements.mapPrompt.classList.add("open");
  elements.mapPrompt.setAttribute("aria-hidden", "false");
}

function cancelPlacementMode() {
  placementMode = false;
  document.body.classList.remove("placement-active");
  elements.mapPrompt.classList.remove("open");
  elements.mapPrompt.setAttribute("aria-hidden", "true");
}

function placeProposedMarker(latlng) {
  clearProposedMarker();

  proposedMarker = L.marker(latlng, {
    icon: makeProposedIcon(),
    draggable: true
  }).addTo(map);

  proposedMarker.bindPopup("Proposed new location").openPopup();
  proposedMarker.on("dragend", () => {
    const pos = proposedMarker.getLatLng();
    fillLatLonFields(pos.lat, pos.lng);
  });

  fillLatLonFields(latlng.lat, latlng.lng);
}

function startExistingLocationUpdate(locationId) {
  const location = allLocations.find((item) => item.id === locationId);
  if (!location) return;

  clearProposedMarker();
  clearEditMarker();

  editingLocation = location;
  fillFormFromLocation(location, "update");

  editMarker = L.marker([Number(location.latitude), Number(location.longitude)], {
    icon: makeEditIcon(),
    draggable: true
  }).addTo(map);

  editMarker.bindPopup("Drag me to the correct location").openPopup();
  editMarker.on("dragend", () => {
    const pos = editMarker.getLatLng();
    fillLatLonFields(pos.lat, pos.lng);
  });

  map.setView([Number(location.latitude), Number(location.longitude)], Math.max(map.getZoom(), 15));

  document.body.classList.add("edit-placement-active");
  elements.editPrompt.classList.add("open");

  openSubmitModal({
    title: "Update existing place",
    subtitle: "Drag the orange marker if the location is wrong, update any fields, then submit for review."
  });
}

function cancelEditPlacement() {
  clearEditMarker();
  document.body.classList.remove("edit-placement-active");
  elements.editPrompt.classList.remove("open");
}

function fillLatLonFields(lat, lng) {
  elements.submitForm.elements.latitude.value = Number(lat).toFixed(6);
  elements.submitForm.elements.longitude.value = Number(lng).toFixed(6);
}

function resetFormForNewLocation() {
  elements.submitForm.reset();
  elements.submitForm.elements.submission_type.value = "new";
  elements.submitForm.elements.location_id.value = "";
  elements.submitForm.elements.location_type.value = "standalone";
  elements.submitTitle.textContent = "Suggest a new place";
  elements.submitSubtitle.textContent = "Drop a marker first, then add details. Submissions are reviewed before appearing on the map.";
}

function fillFormFromLocation(location, submissionType) {
  elements.submitForm.reset();

  elements.submitForm.elements.submission_type.value = submissionType;
  elements.submitForm.elements.location_id.value = location.id || "";
  elements.submitForm.elements.name.value = location.name || "";
  elements.submitForm.elements.type.value = location.type || "bin";
  elements.submitForm.elements.operator.value = location.operator || "";
  elements.submitForm.elements.address.value = location.address || "";
  elements.submitForm.elements.suburb.value = location.suburb || "";
  elements.submitForm.elements.postcode.value = location.postcode || "";
  elements.submitForm.elements.location_type.value = location.location_type || "standalone";
  elements.submitForm.elements.accepts_clothes.checked = Boolean(location.accepts_clothes);
  elements.submitForm.elements.accepts_books.checked = Boolean(location.accepts_books);
  elements.submitForm.elements.accepts_household_goods.checked = Boolean(location.accepts_household_goods);
  elements.submitForm.elements.notes.value = location.notes || "";
  fillLatLonFields(location.latitude, location.longitude);
}

function openSubmitModal({ title, subtitle } = {}) {
  if (title) elements.submitTitle.textContent = title;
  if (subtitle) elements.submitSubtitle.textContent = subtitle;
  elements.submitModal.classList.add("open");
  elements.submitModal.setAttribute("aria-hidden", "false");
  setSubmitMessage("", "");
}

function closeSubmitModal({ clearNewMarker = true, clearEdit = false } = {}) {
  elements.submitModal.classList.remove("open");
  elements.submitModal.setAttribute("aria-hidden", "true");
  setSubmitMessage("", "");

  if (clearNewMarker) {
    clearProposedMarker();
  }

  if (clearEdit) {
    cancelEditPlacement();
  }
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

  const submissionType = valueOrNull(formData.get("submission_type")) || "new";

  const payload = {
    submission_type: submissionType,
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
  clearProposedMarker();
  cancelEditPlacement();

  const message = submissionType === "new"
    ? "Thanks! Your new place has been submitted for review."
    : "Thanks! Your update has been submitted for review.";

  setSubmitMessage(message, "success");
}

function useMapCentreForSubmission() {
  const centre = map.getCenter();
  fillLatLonFields(centre.lat, centre.lng);

  const submissionType = elements.submitForm.elements.submission_type.value;
  if (submissionType === "new") {
    placeProposedMarker(centre);
  } else if (editMarker) {
    editMarker.setLatLng(centre);
  }
}

async function verifyLocation(locationId) {
  const location = allLocations.find((item) => item.id === locationId);
  if (!location) return;

  const { error } = await supabaseClient
    .from("submissions")
    .insert({
      submission_type: "update",
      location_id: location.id,
      name: location.name,
      type: location.type,
      operator: location.operator,
      address: location.address,
      suburb: location.suburb,
      state: location.state || "SA",
      postcode: location.postcode,
      location_type: location.location_type,
      accepts_clothes: location.accepts_clothes,
      accepts_books: location.accepts_books,
      accepts_household_goods: location.accepts_household_goods,
      notes: "Community verification: still here",
      latitude: location.latitude,
      longitude: location.longitude,
      status: "pending"
    });

  if (error) {
    console.error(error);
    alert("Could not submit verification. Check Supabase RLS policy.");
    return;
  }

  alert("Thanks — verification submitted for review.");
}

async function reportMissingLocation(locationId) {
  const location = allLocations.find((item) => item.id === locationId);
  if (!location) return;

  const confirmed = confirm(`Report "${location.name}" as missing, wrong or no longer available?`);
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from("submissions")
    .insert({
      submission_type: "report_missing",
      location_id: location.id,
      name: location.name,
      type: location.type,
      operator: location.operator,
      address: location.address,
      suburb: location.suburb,
      state: location.state || "SA",
      postcode: location.postcode,
      location_type: location.location_type,
      accepts_clothes: location.accepts_clothes,
      accepts_books: location.accepts_books,
      accepts_household_goods: location.accepts_household_goods,
      notes: "Community report: missing, wrong or no longer available",
      latitude: location.latitude,
      longitude: location.longitude,
      status: "pending"
    });

  if (error) {
    console.error(error);
    alert("Could not submit report. Check Supabase RLS policy.");
    return;
  }

  alert("Thanks — report submitted for review.");
}

window.verifyLocation = verifyLocation;
window.startExistingLocationUpdate = startExistingLocationUpdate;
window.reportMissingLocation = reportMissingLocation;

[
  elements.searchInput,
  elements.filterClothes,
  elements.filterBooks,
  elements.filterHousehold,
  ...elements.typeFilters,
  ...elements.locationTypeFilters,
  ...elements.verificationFilters
].forEach((element) => {
  element.addEventListener("input", () => renderLocations());
  element.addEventListener("change", () => renderLocations());
});

elements.resetFilters.addEventListener("click", resetFilters);
elements.nearestBinButton.addEventListener("click", findNearestBin);

elements.openSubmitModal.addEventListener("click", startPlacementMode);
elements.cancelPlacement.addEventListener("click", () => {
  cancelPlacementMode();
  clearProposedMarker();
});

elements.cancelEditPlacement.addEventListener("click", () => {
  cancelEditPlacement();
  closeSubmitModal({ clearNewMarker: false, clearEdit: false });
});

map.on("click", (event) => {
  if (!placementMode) return;

  placeProposedMarker(event.latlng);
  cancelPlacementMode();
  openSubmitModal({
    title: "Suggest a new place",
    subtitle: "Add details for the marker you placed. Submissions are reviewed before appearing on the map."
  });
});

elements.closeSubmitModal.addEventListener("click", () => {
  const isEdit = elements.submitForm.elements.submission_type.value === "update";
  closeSubmitModal({ clearNewMarker: true, clearEdit: isEdit });
});

elements.cancelSubmit.addEventListener("click", () => {
  const isEdit = elements.submitForm.elements.submission_type.value === "update";
  closeSubmitModal({ clearNewMarker: true, clearEdit: isEdit });
});

elements.submitModal.addEventListener("click", (event) => {
  if (event.target === elements.submitModal) {
    const isEdit = elements.submitForm.elements.submission_type.value === "update";
    closeSubmitModal({ clearNewMarker: true, clearEdit: isEdit });
  }
});

elements.submitForm.addEventListener("submit", handleSubmit);
elements.useMapCentreButton.addEventListener("click", useMapCentreForSubmission);

loadLocations();
