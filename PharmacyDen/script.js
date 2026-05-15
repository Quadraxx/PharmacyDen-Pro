// CONFIG & STATE
const VoyagerLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap' });
const SatelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' });

let map, markers = [], routingLine = null, pharmacyCache = { duty: null, all: null };
let currentType = 'duty', currentDistrict = 'TÜMÜ', userLocation = null;
const DISTRICTS = ["TÜMÜ", "MERKEZEFENDİ", "PAMUKKALE", "ACIPAYAM", "BABADAG", "BAKLAN", "BEKİLLİ", "BEYAĞAÇ", "BOZKURT", "BULDAN", "ÇAL", "ÇAMELİ", "ÇARDAK", "ÇİVRİL", "GÜNEY", "HONAZ", "KALE", "SARAYKÖY", "SERİNHİSAR", "TAVAS"];

// DOM ELEMENTS
let eczaneList, statsPanel, searchInput, btnDuty, btnAll, districtsContainer, btnFindMe, btnZoomIn, btnZoomOut, btnLayerToggle, btnVoice, splashScreen;
let keyModal, apiKeyInput, saveKeyBtn, btnSettings;

function hideSplash() {
  if (!splashScreen) return;
  splashScreen.style.opacity = "0";
  setTimeout(() => splashScreen.style.display = "none", 800);
}

window.onload = () => {
  // Init Elements
  eczaneList = document.getElementById("eczaneList");
  statsPanel = document.getElementById("statsPanel");
  searchInput = document.getElementById("searchInput");
  btnDuty = document.getElementById("btnDuty");
  btnAll = document.getElementById("btnAll");
  districtsContainer = document.getElementById("districtsContainer");
  btnFindMe = document.getElementById("btnFindMe");
  btnZoomIn = document.getElementById("btnZoomIn");
  btnZoomOut = document.getElementById("btnZoomOut");
  btnLayerToggle = document.getElementById("btnLayerToggle");
  btnVoice = document.getElementById("btnVoice");
  splashScreen = document.getElementById("splashScreen");
  keyModal = document.getElementById("keyModal");
  apiKeyInput = document.getElementById("apiKeyInput");
  saveKeyBtn = document.getElementById("saveKeyBtn");
  btnSettings = document.getElementById("btnSettings");

  // Map Init
  map = L.map('map', { zoomControl: false, layers: [VoyagerLayer] }).setView([37.7765, 29.0864], 12);

  // Check API Key
  const storedKey = localStorage.getItem('COLLECT_API_KEY');
  if (!storedKey) {
    keyModal.style.display = 'flex';
    splashScreen.style.display = 'none';
  } else {
    setTimeout(hideSplash, 4000);
    const hour = new Date().getHours();
    loadData(hour >= 20 || hour < 8 ? 'duty' : 'all');
  }

  // Event Listeners
  saveKeyBtn.onclick = () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      localStorage.setItem('COLLECT_API_KEY', key);
      keyModal.style.display = 'none';
      location.reload();
    }
  };

  btnSettings.onclick = () => {
    apiKeyInput.value = localStorage.getItem('COLLECT_API_KEY') || '';
    keyModal.style.display = 'flex';
  };

  btnDuty.onclick = () => loadData('duty');
  btnAll.onclick = () => loadData('all');
  searchInput.oninput = () => applyFilters();
  btnZoomIn.onclick = () => map.zoomIn();
  btnZoomOut.onclick = () => map.zoomOut();
  btnFindMe.onclick = () => map.locate({setView: true, maxZoom: 16});
  
  btnLayerToggle.onclick = () => {
    if (map.hasLayer(VoyagerLayer)) {
      map.removeLayer(VoyagerLayer); map.addLayer(SatelliteLayer); btnLayerToggle.innerText = "🗺️";
    } else {
      map.removeLayer(SatelliteLayer); map.addLayer(VoyagerLayer); btnLayerToggle.innerText = "🌍";
    }
  };

  btnVoice.onclick = () => {
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'tr-TR';
    recognition.onstart = () => btnVoice.innerText = "🔴";
    recognition.onresult = (e) => { searchInput.value = e.results[0][0].transcript; applyFilters(); };
    recognition.onend = () => btnVoice.innerText = "🎤";
    recognition.start();
  };

  map.on('locationfound', (e) => {
    userLocation = e.latlng;
    L.circle(e.latlng, e.accuracy).addTo(map);
    L.marker(e.latlng).addTo(map).bindPopup("Buradasınız").openPopup();
    applyFilters();
  });

  renderDistricts();
};

// ICONS
const createPharmacyIcon = (color) => L.divIcon({
  className: 'custom-pharmacy-icon',
  html: `<svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="17" cy="17" r="15" fill="white" stroke="${color}" stroke-width="2"/><rect x="8" y="10" width="18" height="14" rx="2" fill="${color}"/><path d="M12 14H22V17H12V14Z" fill="white"/><path d="M15 12H19V21H15V12Z" fill="white"/><circle cx="17" cy="17" r="16" stroke="${color}" stroke-opacity="0.3" stroke-width="4"/></svg>`,
  iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -15]
});

const dutyIcon = createPharmacyIcon('#ef4444'), normalIcon = createPharmacyIcon('#3b82f6');

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180; const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1));
}

function clearMap() { if (map) { markers.forEach(m => map.removeLayer(m)); markers = []; if (routingLine) map.removeLayer(routingLine); } }

function renderDistricts() {
  if (!districtsContainer) return;
  districtsContainer.innerHTML = "";
  DISTRICTS.forEach(dist => {
    const chip = document.createElement("div");
    chip.className = `dist-chip ${currentDistrict === dist ? 'active' : ''}`;
    chip.innerText = dist;
    chip.onclick = () => { currentDistrict = dist; renderDistricts(); applyFilters(); };
    districtsContainer.appendChild(chip);
  });
}

function applyFilters() {
  let typeData = pharmacyCache[currentType] || [];
  const query = searchInput.value.toLowerCase();
  if (userLocation) {
    typeData.forEach(p => p.distance = calculateDistance(userLocation.lat, userLocation.lng, p.lat, p.lon));
    typeData.sort((a,b) => a.distance - b.distance);
  }
  const filtered = typeData.filter(p => (p.name.toLowerCase().includes(query) || p.address.toLowerCase().includes(query)) && (currentDistrict === 'TÜMÜ' || (p.dist && p.dist.toUpperCase().includes(currentDistrict)) || p.address.toUpperCase().includes(currentDistrict)));
  renderPharmacies(filtered, currentType);
  if (statsPanel) statsPanel.innerHTML = `📊 ${filtered.length} Eczane (${currentDistrict})`;
  hideSplash();
}

function renderPharmacies(data, type) {
  eczaneList.innerHTML = ""; clearMap();
  data.forEach((item, index) => {
    const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
    if (isNaN(lat) || isNaN(lon)) return;
    const marker = L.marker([lat, lon], { icon: type === 'duty' ? dutyIcon : normalIcon }).addTo(map);
    marker.bindPopup(`<div style="padding:5px"><strong style="color:white">${item.name}</strong><br><span style="color:#94a3b8">${item.address}</span></div>`);
    markers.push(marker);
    const card = document.createElement("div");
    card.className = "eczane-card"; card.style.animationDelay = `${index * 0.05}s`;
    card.innerHTML = `<div style="display:flex; align-items:center;"><div class="eczane-name">${type === 'duty' ? '🌙' : '☀️'} ${item.name}</div>${item.distance ? `<span class="distance-badge">${item.distance} km</span>` : ''}</div><div class="eczane-info">📍 ${item.address}</div><div class="card-actions">${item.phone ? `<a href="tel:${item.phone}" class="action-btn call-btn">Ara</a>` : ''}<a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" class="action-btn route-btn">Yol Tarifi</a><button class="action-btn copy-btn" onclick="navigator.clipboard.writeText('${item.address}'); alert('Kopyalandı!')">📋</button></div>`;
    card.onclick = () => { map.setView([lat, lon], 17); marker.openPopup(); if (userLocation) { if (routingLine) map.removeLayer(routingLine); routingLine = L.polyline([userLocation, [lat, lon]], {color: '#38bdf8', weight: 3, dashArray: '10, 10'}).addTo(map); } };
    eczaneList.appendChild(card);
  });
}

async function loadData(type) {
  const API_KEY = localStorage.getItem('COLLECT_API_KEY');
  if (!API_KEY) { keyModal.style.display = 'flex'; return; }

  currentType = type; btnDuty.classList.toggle('active', type === 'duty'); btnAll.classList.toggle('active', type === 'all');
  if (pharmacyCache[type]) { applyFilters(); return; }
  
  if (statsPanel) statsPanel.innerHTML = `⏳ Veriler çekiliyor...`;
  try {
    let rawData = [];
    if (type === 'duty') {
      const resp = await fetch("https://api.collectapi.com/health/dutyPharmacy?il=Denizli", { headers: { "content-type": "application/json", "authorization": `apikey ${API_KEY}` } });
      if (!resp.ok) throw new Error(`API Hatası (${resp.status})`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.message || "API verisi alınamadı");
      rawData = json.result.map(p => ({ name: p.name, address: p.address, phone: p.phone, dist: p.dist, lat: p.loc.split(",")[0], lon: p.loc.split(",")[1] }));
    } else {
      const query = `[out:json][timeout:60];area["name"="Denizli"]->.searchArea;(node["amenity"="pharmacy"](area.searchArea);way["amenity"="pharmacy"](area.searchArea);relation["amenity"="pharmacy"](area.searchArea););out center body;`;
      let resp; try { resp = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: query }); } catch (e) { resp = await fetch("https://overpass.kumi.systems/api/interpreter", { method: "POST", body: query }); }
      const json = await resp.json();
      rawData = json.elements.map(p => ({ name: (p.tags && p.tags.name) ? p.tags.name : "Eczane", address: p.tags ? (p.tags["addr:full"] || p.tags["addr:street"] || "Denizli") : "Denizli", phone: p.tags ? (p.tags.phone || p.tags["contact:phone"] || "") : "", lat: p.lat || (p.center ? p.center.lat : null), lon: p.lon || (p.center ? p.center.lon : null) })).filter(p => p.lat && p.lon);
    }
    pharmacyCache[type] = rawData; applyFilters();
  } catch (error) { 
    if (statsPanel) statsPanel.innerHTML = `❌ ${error.message} <button onclick="loadData('${type}')">Tekrar Dene</button>`; 
    hideSplash(); 
  }
}
