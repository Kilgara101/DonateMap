const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allLocations = [];
let userMarker = null;
let nearestMarker = null;

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
  resetFilters: document.getElementById("resetFilters"),
  nearestBinButton: document.getElementById("nearestBinButton"),
  nearestResult: document.getElementById("nearestResult"),
  resultCount: document.getElementById("resultCount")
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

function prettyType(type) {
  return {
    bin: "Donation bin",
    op_shop: "Op shop",
    reuse_centre: "Reuse centre"
  }[type] || type || "Unknown";
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
      <p class="meta">Verification: ${escapeHtml(location.verification_status || "unknown")}</p>
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
          distance_km: distanceKm(
            userLat,
            userLon,
            Number(location.latitude),
            Number(location.longitude)
          )
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
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    }
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
    longitude: Number(location.longitude)
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

  renderLocations({ fit: true });
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

loadLocations();
