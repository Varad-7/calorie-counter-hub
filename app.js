const STORAGE_KEY = "calorie-counter-hub-v1";
const MEAL_SLOTS = ["breakfast", "lunch", "snacks", "dinner"];
const DAY_MS = 24 * 60 * 60 * 1000;

const todayLabel = document.getElementById("todayLabel");
const profileForm = document.getElementById("profileForm");
const profilesList = document.getElementById("profilesList");
const emptyState = document.getElementById("emptyState");
const workspaceContent = document.getElementById("workspaceContent");
const activeProfileTitle = document.getElementById("activeProfileTitle");
const activeProfileMeta = document.getElementById("activeProfileMeta");
const deleteProfileBtn = document.getElementById("deleteProfileBtn");
const goalForm = document.getElementById("goalForm");
const maintenanceInput = document.getElementById("maintenanceInput");
const targetInput = document.getElementById("targetInput");
const trackDateInput = document.getElementById("trackDateInput");
const summaryGrid = document.getElementById("summaryGrid");
const mealsGrid = document.getElementById("mealsGrid");
const chartRangeSelect = document.getElementById("chartRangeSelect");
const historyChart = document.getElementById("historyChart");
const chartTooltip = document.getElementById("chartTooltip");
const foodSearchInput = document.getElementById("foodSearchInput");
const foodLibraryTable = document.getElementById("foodLibraryTable");
const customFoodForm = document.getElementById("customFoodForm");
const importFoodForm = document.getElementById("importFoodForm");
const foodCsvFile = document.getElementById("foodCsvFile");
const foodOptions = document.getElementById("foodOptions");
const supabaseForm = document.getElementById("supabaseForm");
const supabaseUrlInput = document.getElementById("supabaseUrlInput");
const supabaseAnonKeyInput = document.getElementById("supabaseAnonKeyInput");
const supabaseSyncKeyInput = document.getElementById("supabaseSyncKeyInput");
const supabaseAutoSyncInput = document.getElementById("supabaseAutoSyncInput");
const supabasePushBtn = document.getElementById("supabasePushBtn");
const supabasePullBtn = document.getElementById("supabasePullBtn");
const supabaseStatusText = document.getElementById("supabaseStatusText");
const supabaseToggleBtn = document.getElementById("supabaseToggleBtn");

const seedFoods = buildSeedFoods();
let selectedDate = isoDate(new Date());
let chartModel = { bars: [], points: [], hoverIndex: -1, targetCalories: 0 };
let autoSyncTimer = null;
let autoPullTimer = null;
let hasUnsyncedLocalChanges = false;

let state = loadState();

init();

function init() {
  todayLabel.textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (!state.activeProfileId && state.profiles[0]) {
    state.activeProfileId = state.profiles[0].id;
  }

  trackDateInput.value = selectedDate;
  updateFoodOptions();
  attachListeners();
  renderSupabaseStatus();
  startAutoPullLoop();
  render();
}

function attachListeners() {
  profileForm.addEventListener("submit", onCreateProfile);
  goalForm.addEventListener("submit", onSaveGoals);
  deleteProfileBtn.addEventListener("click", onDeleteProfile);

  trackDateInput.addEventListener("change", () => {
    selectedDate = trackDateInput.value || isoDate(new Date());
    render();
  });

  chartRangeSelect.addEventListener("change", renderChart);

  foodSearchInput.addEventListener("input", () => {
    renderFoodLibrary(foodSearchInput.value.trim());
  });

  customFoodForm.addEventListener("submit", onAddCustomFood);
  importFoodForm.addEventListener("submit", onImportFoodsCsv);
  supabaseForm.addEventListener("submit", onSaveSupabaseSettings);
  supabasePushBtn.addEventListener("click", onPushToSupabase);
  supabasePullBtn.addEventListener("click", onPullFromSupabase);
  supabaseToggleBtn.addEventListener("click", toggleSupabaseSettingsVisibility);

  historyChart.addEventListener("mousemove", onChartMouseMove);
  historyChart.addEventListener("mouseleave", () => {
    if (chartModel.hoverIndex !== -1) {
      drawBars(chartModel.points, chartModel.targetCalories, -1);
    }
    chartTooltip.classList.add("hidden");
  });

  window.addEventListener("resize", renderChart);
  window.addEventListener("focus", () => {
    void syncFromCloudIfNewer();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void syncFromCloudIfNewer();
    }
  });
}

function onCreateProfile(event) {
  event.preventDefault();

  const name = document.getElementById("newProfileName").value.trim();
  const maintenance = Number(document.getElementById("newProfileMaintenance").value);
  const target = Number(document.getElementById("newProfileTarget").value);

  if (!name) return;

  const profile = {
    id: createId(),
    name,
    maintenanceCalories: clampNumber(maintenance, 1000, 7000),
    targetCalories: clampNumber(target, 800, 7000),
    entries: {},
    createdAt: Date.now(),
  };

  state.profiles.unshift(profile);
  state.activeProfileId = profile.id;
  persist();

  profileForm.reset();
  document.getElementById("newProfileMaintenance").value = 2200;
  document.getElementById("newProfileTarget").value = 1800;

  render();
}

function onSaveGoals(event) {
  event.preventDefault();
  const profile = getActiveProfile();
  if (!profile) return;

  const maintenance = clampNumber(Number(maintenanceInput.value), 1000, 7000);
  const target = clampNumber(Number(targetInput.value), 800, 7000);

  profile.maintenanceCalories = maintenance;
  profile.targetCalories = target;
  persist();
  render();
}

function onDeleteProfile() {
  const profile = getActiveProfile();
  if (!profile) return;

  const ok = window.confirm(`Delete profile \"${profile.name}\"? This will remove all saved days for this block.`);
  if (!ok) return;

  state.profiles = state.profiles.filter((p) => p.id !== profile.id);
  state.activeProfileId = state.profiles[0] ? state.profiles[0].id : null;
  persist();
  render();
}

function deleteProfileById(profileId) {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) return;

  const ok = window.confirm(`Delete profile \"${profile.name}\"? This will remove all saved days for this block.`);
  if (!ok) return;

  state.profiles = state.profiles.filter((item) => item.id !== profileId);
  state.activeProfileId = state.profiles[0] ? state.profiles[0].id : null;
  persist();
  render();
}

function onAddCustomFood(event) {
  event.preventDefault();
  const name = document.getElementById("customFoodName").value.trim();
  const calories = Number(document.getElementById("customFoodCalories").value);
  const serving = Number(document.getElementById("customFoodServing").value);

  if (!name || Number.isNaN(calories) || Number.isNaN(serving)) return;

  const library = getFoodLibrary();
  const duplicate = library.some((item) => item.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    window.alert("This food already exists in the library.");
    return;
  }

  state.customFoods.unshift({
    id: createId("custom"),
    name,
    category: "Custom",
    kcalPer100g: Math.max(0, calories),
    defaultServingG: clampNumber(serving, 1, 1000),
  });

  persist();
  updateFoodOptions();
  renderFoodLibrary(foodSearchInput.value.trim());
  customFoodForm.reset();
  document.getElementById("customFoodServing").value = 100;
}

async function onImportFoodsCsv(event) {
  event.preventDefault();
  const file = foodCsvFile.files && foodCsvFile.files[0];
  if (!file) return;

  const text = await file.text();
  const rows = parseCsvText(text);
  if (!rows.length) {
    window.alert("The CSV file is empty.");
    return;
  }

  const header = rows[0].map((value) => normalizeHeader(value));
  const hasHeader = header.includes("name") && (
    header.includes("kcalper100g") ||
    header.includes("kcal_per_100g") ||
    header.includes("calories")
  );

  const findIndex = (keys, fallback) => {
    for (const key of keys) {
    const idx = header.indexOf(normalizeHeader(key));
      if (idx >= 0) return idx;
    }
    return fallback;
  };

  const nameIndex = hasHeader ? findIndex(["name", "item", "food"], 0) : 0;
  const categoryIndex = hasHeader ? findIndex(["category", "group"], 1) : 1;
  const kcalIndex = hasHeader ? findIndex(["kcalper100g", "kcal_per_100g", "calories", "kcal"], 2) : 2;
  const servingIndex = hasHeader ? findIndex(["defaultservingg", "default_serving_g", "serving", "servingg"], 3) : 3;

  const existingNames = new Set(getFoodLibrary().map((food) => food.name.toLowerCase()));
  const newFoods = [];
  let skipped = 0;

  for (let i = hasHeader ? 1 : 0; i < rows.length; i += 1) {
    const row = rows[i];
    const name = String(row[nameIndex] || "").trim();
    const category = String(row[categoryIndex] || "Imported").trim() || "Imported";
    const kcal = Number(row[kcalIndex]);
    const serving = Number(row[servingIndex] || 100);

    if (!name || Number.isNaN(kcal) || kcal < 0) {
      skipped += 1;
      continue;
    }

    const normalizedName = name.toLowerCase();
    if (existingNames.has(normalizedName)) {
      skipped += 1;
      continue;
    }

    existingNames.add(normalizedName);
    newFoods.push({
      id: createId("imported"),
      name,
      category,
      kcalPer100g: kcal,
      defaultServingG: clampNumber(serving || 100, 1, 1000),
    });
  }

  if (!newFoods.length) {
    window.alert("No new foods imported. Check CSV format or duplicates.");
    return;
  }

  state.customFoods = [...newFoods, ...state.customFoods];
  persist();
  updateFoodOptions();
  renderFoodLibrary(foodSearchInput.value.trim());
  importFoodForm.reset();
  window.alert(`Imported ${newFoods.length} foods. Skipped ${skipped}.`);
}

function onSaveSupabaseSettings(event) {
  event.preventDefault();

  const url = normalizeSupabaseUrl(supabaseUrlInput.value.trim());
  const anonKey = supabaseAnonKeyInput.value.trim();
  const syncKey = supabaseSyncKeyInput.value.trim();
  const autoSync = Boolean(supabaseAutoSyncInput.checked);

  state.supabase = {
    ...state.supabase,
    url,
    anonKey,
    syncKey,
    autoSync,
    lastError: "",
  };

  persist(false);
  startAutoPullLoop();
  renderSupabaseStatus();
  window.alert("Supabase sync settings saved.");
}

function toggleSupabaseSettingsVisibility() {
  const isHidden = supabaseForm.classList.contains("hidden");
  if (isHidden) {
    supabaseForm.classList.remove("hidden");
    supabaseToggleBtn.textContent = "Hide Cloud Settings";
  } else {
    supabaseForm.classList.add("hidden");
    supabaseToggleBtn.textContent = "Show Cloud Settings";
  }
}

async function onPushToSupabase() {
  if (!isSupabaseConfigured()) {
    window.alert("Please fill Supabase URL, Anon Key, and Sync Key first.");
    return;
  }

  setSupabaseStatus("Syncing to cloud...");
  const result = await pushStateToSupabase();
  if (!result.ok) {
    setSupabaseStatus(`Sync failed: ${result.error}`);
    window.alert(`Push failed: ${result.error}`);
    return;
  }

  setSupabaseStatus(`Cloud sync updated at ${formatTimestamp(state.supabase.lastSyncedAt)}.`);
  window.alert("Pushed data to Supabase.");
}

async function onPullFromSupabase() {
  if (!isSupabaseConfigured()) {
    window.alert("Please fill Supabase URL, Anon Key, and Sync Key first.");
    return;
  }

  setSupabaseStatus("Fetching cloud data...");
  const result = await pullStateFromSupabase();
  if (!result.ok) {
    setSupabaseStatus(`Pull failed: ${result.error}`);
    window.alert(`Pull failed: ${result.error}`);
    return;
  }

  if (!result.found) {
    setSupabaseStatus("No cloud data found for this Sync Key yet.");
    window.alert("No data found in Supabase for this Sync Key.");
    return;
  }

  const cloudData = result.payload;
  state.profiles = (Array.isArray(cloudData.profiles) ? cloudData.profiles : [])
    .map(normalizeProfile)
    .filter(Boolean);
  state.customFoods = (Array.isArray(cloudData.customFoods) ? cloudData.customFoods : [])
    .map(normalizeFood)
    .filter(Boolean);
  state.activeProfileId = state.profiles.some((p) => p.id === cloudData.activeProfileId)
    ? cloudData.activeProfileId
    : state.profiles[0]?.id || null;
  hasUnsyncedLocalChanges = false;

  persist(false);
  render();
  setSupabaseStatus(`Pulled cloud data at ${formatTimestamp(state.supabase.lastSyncedAt)}.`);
  window.alert("Pulled latest data from Supabase.");
}

function render() {
  renderProfiles();

  const profile = getActiveProfile();
  if (!profile) {
    emptyState.classList.remove("hidden");
    workspaceContent.classList.add("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  workspaceContent.classList.remove("hidden");

  activeProfileTitle.textContent = profile.name;
  const todayTotal = getDailyTotal(profile, isoDate(new Date()));
  const todayGap = profile.targetCalories - todayTotal;
  const statusClass = todayGap >= 0 ? "on-track" : "over-target";
  const statusLabel = todayGap >= 0 ? "On Track" : "Over Target";
  activeProfileMeta.innerHTML = `
    <span class="meta-pill ${statusClass}">${statusLabel}</span>
    <span class="meta-pill neutral">Today ${Math.round(todayTotal)} kcal</span>
    <span class="meta-pill neutral">Created ${new Date(profile.createdAt).toLocaleDateString()}</span>
  `;

  maintenanceInput.value = profile.maintenanceCalories;
  targetInput.value = profile.targetCalories;
  trackDateInput.value = selectedDate;
  renderSupabaseStatus();

  renderSummary(profile);
  renderMeals(profile);
  renderChart();
  renderFoodLibrary(foodSearchInput.value.trim());
}

function renderProfiles() {
  const today = isoDate(new Date());

  if (!state.profiles.length) {
    profilesList.innerHTML = '<p class="muted small">No blocks yet. Add your first profile above.</p>';
    return;
  }

  const cards = state.profiles
    .map((profile) => {
      const todayTotal = getDailyTotal(profile, today);
      const deficit = profile.maintenanceCalories - todayTotal;
      const isActive = profile.id === state.activeProfileId;
      return `
        <article class="profile-card ${isActive ? "active" : ""}" data-profile-id="${profile.id}">
          <div class="profile-card-head">
            <strong>${escapeHtml(profile.name)}</strong>
            <button type="button" class="delete-mini-btn" data-delete-profile-id="${profile.id}" aria-label="Delete ${escapeHtml(profile.name)}">Delete</button>
          </div>
          <div class="macro"><span>Today</span><strong>${Math.round(todayTotal)} kcal</strong></div>
          <div class="macro"><span>Target</span><span>${profile.targetCalories} kcal</span></div>
          <div class="macro"><span>Deficit</span><span>${Math.round(deficit)} kcal</span></div>
        </article>
      `;
    })
    .join("");

  profilesList.innerHTML = cards;

  Array.from(document.querySelectorAll(".profile-card")).forEach((card) => {
    card.addEventListener("click", () => {
      state.activeProfileId = card.dataset.profileId;
      persist();
      render();
    });
  });

  Array.from(document.querySelectorAll("[data-delete-profile-id]")).forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteProfileById(button.dataset.deleteProfileId);
    });
  });
}

function renderSummary(profile) {
  const total = getDailyTotal(profile, selectedDate);
  const remainingToTarget = profile.targetCalories - total;
  const deficit = profile.maintenanceCalories - total;
  const progress = profile.targetCalories > 0 ? (total / profile.targetCalories) * 100 : 0;

  const metrics = [
    { label: "Consumed", value: `${Math.round(total)} kcal`, tone: "accent", meter: Math.min(100, Math.max(0, progress)) },
    { label: "Target", value: `${profile.targetCalories} kcal` },
    { label: "Remaining", value: `${Math.round(remainingToTarget)} kcal`, tone: remainingToTarget >= 0 ? "good" : "warn" },
    { label: "Target Usage", value: `${Math.max(0, Math.round(progress))}%`, tone: progress <= 100 ? "good" : "warn" },
    { label: "Maintenance", value: `${profile.maintenanceCalories} kcal` },
    { label: "Deficit", value: `${Math.round(deficit)} kcal`, tone: deficit >= 0 ? "good" : "warn" },
    { label: "Date", value: formatIsoDate(selectedDate) },
    { label: "Meal Count", value: `${getMealEntryCount(profile, selectedDate)} items` },
  ];

  summaryGrid.innerHTML = metrics
    .map(
      (metric) => `
      <article class="metric-card ${metric.tone || ""}">
        <p>${metric.label}</p>
        <strong>${metric.value}</strong>
        ${typeof metric.meter === "number" ? `<div class="metric-meter"><span style="width:${metric.meter.toFixed(0)}%"></span></div>` : ""}
      </article>
    `,
    )
    .join("");
}

function renderMeals(profile) {
  const day = getOrCreateDay(profile, selectedDate);

  mealsGrid.innerHTML = MEAL_SLOTS.map((meal) => {
    const entries = day[meal];
    const mealCalories = entries.reduce((sum, item) => sum + item.calories, 0);

    return `
      <article class="meal-card" data-meal="${meal}">
        <div class="meal-head">
          <h4>${capitalize(meal)}</h4>
          <strong>${Math.round(mealCalories)} kcal</strong>
        </div>

        <form class="inline-form meal-form" data-meal-form="${meal}">
          <label>
            Food/Drink
            <input list="foodOptions" type="text" name="foodName" placeholder="Search food" required />
          </label>
          <label>
            Quantity (g)
            <input type="number" name="grams" min="1" max="2000" value="100" required />
          </label>
          <button type="submit">Add</button>
        </form>

        ${
          entries.length
            ? `<ul class="meal-list">${entries
                .map(
                  (entry) => `
                    <li class="meal-item">
                      <span>${escapeHtml(entry.name)} (${Math.round(entry.grams)}g) - <strong>${Math.round(entry.calories)} kcal</strong></span>
                      <button type="button" data-remove-entry="${entry.id}" data-meal="${meal}">Remove</button>
                    </li>
                  `,
                )
                .join("")}</ul>`
            : `<p class="empty-meal">No items logged yet.</p>`
        }
      </article>
    `;
  }).join("");

  Array.from(document.querySelectorAll(".meal-form")).forEach((form) => {
    const foodInput = form.querySelector('input[name="foodName"]');
    const gramsInput = form.querySelector('input[name="grams"]');

    foodInput.addEventListener("change", () => {
      const food = resolveFood(foodInput.value.trim());
      if (food) {
        gramsInput.value = Math.round(food.defaultServingG);
      }
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const meal = form.dataset.mealForm;
      const formData = new FormData(form);
      const foodName = String(formData.get("foodName") || "").trim();
      const grams = Number(formData.get("grams"));

      if (!foodName || Number.isNaN(grams) || grams <= 0) {
        return;
      }

      const food = resolveFood(foodName);
      if (!food) {
        window.alert("Food not found. Please select a food from the library or add it as custom.");
        return;
      }

      const entry = {
        id: createId("entry"),
        foodId: food.id,
        name: food.name,
        grams,
        calories: Number(((food.kcalPer100g * grams) / 100).toFixed(1)),
        createdAt: Date.now(),
      };

      day[meal].push(entry);
      persist();
      render();
    });
  });

  Array.from(document.querySelectorAll("[data-remove-entry]")).forEach((button) => {
    button.addEventListener("click", () => {
      const meal = button.dataset.meal;
      const entryId = button.dataset.removeEntry;
      day[meal] = day[meal].filter((entry) => entry.id !== entryId);
      persist();
      render();
    });
  });
}

function renderFoodLibrary(query = "") {
  const library = getFoodLibrary();
  const normalized = query.toLowerCase();
  const filtered = library.filter((food) => {
    if (!normalized) return true;
    return (
      food.name.toLowerCase().includes(normalized) ||
      food.category.toLowerCase().includes(normalized)
    );
  });

  const rows = filtered
    .slice(0, 200)
    .map(
      (food) => `
      <tr>
        <td>${escapeHtml(food.name)}</td>
        <td>${escapeHtml(food.category)}</td>
        <td>${Math.round(food.kcalPer100g)}</td>
        <td>${Math.round(food.defaultServingG)}</td>
      </tr>
    `,
    )
    .join("");

  foodLibraryTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Category</th>
          <th>Kcal / 100g</th>
          <th>Default g</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="4">No foods found.</td></tr>'}</tbody>
    </table>
  `;
}

function updateFoodOptions() {
  const options = getFoodLibrary()
    .map((food) => `<option value="${escapeHtml(food.name)}">${food.category} - ${food.kcalPer100g} kcal / 100g</option>`)
    .join("");
  foodOptions.innerHTML = options;
}

function renderChart() {
  const profile = getActiveProfile();
  if (!profile) return;

  const range = Number(chartRangeSelect.value);
  const points = buildChartPoints(profile, selectedDate, range);
  drawBars(points, profile.targetCalories, chartModel.hoverIndex);
}

function buildChartPoints(profile, endDateIso, days) {
  const points = [];
  const endTs = Date.parse(`${endDateIso}T00:00:00`);

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(endTs - i * DAY_MS);
    const iso = isoDate(date);
    points.push({
      date: iso,
      calories: getDailyTotal(profile, iso),
    });
  }

  return points;
}

function drawBars(points, targetCalories, highlightIndex = -1) {
  const ctx = historyChart.getContext("2d");
  const rect = historyChart.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const width = Math.max(320, Math.floor(rect.width));
  const height = 240;

  historyChart.width = Math.floor(width * dpr);
  historyChart.height = Math.floor(height * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { top: 16, right: 14, bottom: 34, left: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxCalories = Math.max(
    300,
    targetCalories,
    ...points.map((point) => point.calories),
  );

  drawGrid(ctx, pad, plotW, plotH, maxCalories);

  const gap = Math.max(6, Math.floor(plotW / (points.length * 6)));
  const barW = Math.max(12, Math.floor((plotW - gap * (points.length - 1)) / points.length));

  const bars = [];

  points.forEach((point, index) => {
    const x = pad.left + index * (barW + gap);
    const h = Math.max(1, (point.calories / maxCalories) * plotH);
    const y = pad.top + plotH - h;

    const gradient = ctx.createLinearGradient(0, y, 0, y + h);
    const isHighlight = index === highlightIndex;
    gradient.addColorStop(0, isHighlight ? "#ff8f56" : "#03ad7a");
    gradient.addColorStop(1, isHighlight ? "#ff7048" : "#017f5b");

    ctx.fillStyle = gradient;
    roundRect(ctx, x, y, barW, h, 6);
    ctx.fill();

    if (index % Math.ceil(points.length / 6) === 0 || index === points.length - 1) {
      ctx.fillStyle = "#5c667d";
      ctx.font = "11px Poppins";
      ctx.textAlign = "center";
      ctx.fillText(shortDate(point.date), x + barW / 2, pad.top + plotH + 15);
    }

    bars.push({ x, y, w: barW, h, point });
  });

  const yTarget = pad.top + plotH - (targetCalories / maxCalories) * plotH;
  ctx.strokeStyle = "#ff7048";
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(pad.left, yTarget);
  ctx.lineTo(pad.left + plotW, yTarget);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#ff7048";
  ctx.textAlign = "left";
  ctx.font = "11px Poppins";
  ctx.fillText(`Target ${Math.round(targetCalories)} kcal`, pad.left + 3, yTarget - 4);

  chartModel = { bars, points, width, height, hoverIndex: highlightIndex, targetCalories };
}

function drawGrid(ctx, pad, plotW, plotH, maxCalories) {
  const ticks = 4;
  for (let i = 0; i <= ticks; i += 1) {
    const y = pad.top + (i / ticks) * plotH;
    ctx.strokeStyle = "#e6ece9";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();

    const kcalValue = Math.round(maxCalories - (i / ticks) * maxCalories);
    ctx.fillStyle = "#7b869e";
    ctx.font = "11px Poppins";
    ctx.textAlign = "right";
    ctx.fillText(String(kcalValue), pad.left - 6, y + 3);
  }
}

function onChartMouseMove(event) {
  if (!chartModel.bars.length) return;

  const rect = historyChart.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const hit = chartModel.bars.find(
    (bar) => x >= bar.x && x <= bar.x + bar.w && y >= bar.y && y <= bar.y + bar.h,
  );

  if (!hit) {
    if (chartModel.hoverIndex !== -1) {
      drawBars(chartModel.points, chartModel.targetCalories, -1);
    }
    chartTooltip.classList.add("hidden");
    return;
  }

  const nextHoverIndex = chartModel.bars.indexOf(hit);
  if (nextHoverIndex !== chartModel.hoverIndex) {
    drawBars(chartModel.points, chartModel.targetCalories, nextHoverIndex);
  }

  chartTooltip.classList.remove("hidden");
  chartTooltip.style.left = `${hit.x + hit.w / 2}px`;
  chartTooltip.style.top = `${hit.y}px`;
  chartTooltip.textContent = `${formatIsoDate(hit.point.date)}: ${Math.round(hit.point.calories)} kcal`;
}

function getActiveProfile() {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || null;
}

function getOrCreateDay(profile, iso) {
  if (!profile.entries || typeof profile.entries !== "object") {
    profile.entries = {};
  }

  if (!profile.entries[iso]) {
    profile.entries[iso] = {
      breakfast: [],
      lunch: [],
      snacks: [],
      dinner: [],
    };
    persist();
  }

  return profile.entries[iso];
}

function getDailyTotal(profile, iso) {
  const day = profile.entries && profile.entries[iso];
  if (!day) return 0;
  return MEAL_SLOTS.reduce((sum, meal) => {
    const mealTotal = (day[meal] || []).reduce((itemSum, entry) => itemSum + (entry.calories || 0), 0);
    return sum + mealTotal;
  }, 0);
}

function getMealEntryCount(profile, iso) {
  const day = profile.entries && profile.entries[iso];
  if (!day) return 0;
  return MEAL_SLOTS.reduce((count, meal) => count + (day[meal] || []).length, 0);
}

function resolveFood(foodName) {
  const normalized = foodName.trim().toLowerCase();
  if (!normalized) return null;

  const library = getFoodLibrary();

  let exact = library.find((food) => food.name.toLowerCase() === normalized);
  if (exact) return exact;

  exact = library.find((food) => food.name.toLowerCase().startsWith(normalized));
  if (exact) return exact;

  return library.find((food) => food.name.toLowerCase().includes(normalized)) || null;
}

function getFoodLibrary() {
  return [...state.customFoods, ...seedFoods];
}

function createDefaultSupabaseConfig() {
  return {
    url: "",
    anonKey: "",
    syncKey: "",
    autoSync: false,
    lastSyncedAt: "",
    lastError: "",
  };
}

function normalizeSupabaseConfig(input) {
  const base = createDefaultSupabaseConfig();
  if (!input || typeof input !== "object") return base;
  return {
    url: normalizeSupabaseUrl(String(input.url || "")),
    anonKey: String(input.anonKey || ""),
    syncKey: String(input.syncKey || ""),
    autoSync: Boolean(input.autoSync),
    lastSyncedAt: String(input.lastSyncedAt || ""),
    lastError: String(input.lastError || ""),
  };
}

function renderSupabaseStatus() {
  const config = state.supabase || createDefaultSupabaseConfig();
  supabaseUrlInput.value = config.url;
  supabaseAnonKeyInput.value = config.anonKey;
  supabaseSyncKeyInput.value = config.syncKey;
  supabaseAutoSyncInput.checked = config.autoSync;

  if (!isSupabaseConfigured()) {
    supabaseStatusText.textContent = "Cloud sync is not configured.";
    startAutoPullLoop();
    return;
  }

  if (config.lastError) {
    supabaseStatusText.textContent = `Cloud sync error: ${config.lastError}`;
    return;
  }

  if (config.lastSyncedAt) {
    supabaseStatusText.textContent = `Last cloud sync: ${formatTimestamp(config.lastSyncedAt)}`;
    return;
  }

  supabaseStatusText.textContent = "Cloud sync configured. Use Push or Pull.";
  startAutoPullLoop();
}

function setSupabaseStatus(text) {
  supabaseStatusText.textContent = text;
}

function isSupabaseConfigured() {
  const config = state.supabase || createDefaultSupabaseConfig();
  return Boolean(config.url && config.anonKey && config.syncKey);
}

function normalizeSupabaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function getCloudPayload() {
  return {
    profiles: state.profiles,
    activeProfileId: state.activeProfileId,
    customFoods: state.customFoods,
  };
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
}

function scheduleAutoSync() {
  if (!state.supabase?.autoSync || !isSupabaseConfigured()) return;
  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
  }
  autoSyncTimer = setTimeout(async () => {
    const result = await pushStateToSupabase();
    if (result.ok) {
      renderSupabaseStatus();
    }
  }, 900);
}

async function pushStateToSupabase() {
  try {
    const config = state.supabase;
    const nowIso = new Date().toISOString();
    const endpoint = `${config.url}/rest/v1/calorie_states`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([{
        sync_key: config.syncKey,
        payload: getCloudPayload(),
        updated_at: nowIso,
      }]),
    });

    if (!response.ok) {
      const message = await safeErrorMessage(response);
      state.supabase.lastError = message;
      persist(false);
      return { ok: false, error: message };
    }

    state.supabase.lastError = "";
    state.supabase.lastSyncedAt = nowIso;
    hasUnsyncedLocalChanges = false;
    persist(false);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    state.supabase.lastError = message;
    persist(false);
    return { ok: false, error: message };
  }
}

async function pullStateFromSupabase() {
  try {
    const config = state.supabase;
    const key = encodeURIComponent(config.syncKey);
    const endpoint = `${config.url}/rest/v1/calorie_states?sync_key=eq.${key}&select=payload,updated_at&limit=1`;
    const response = await fetch(endpoint, {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
      },
    });

    if (!response.ok) {
      const message = await safeErrorMessage(response);
      state.supabase.lastError = message;
      persist(false);
      return { ok: false, error: message };
    }

    const data = await response.json();
    if (!Array.isArray(data) || !data.length) {
      state.supabase.lastError = "";
      persist(false);
      return { ok: true, found: false };
    }

    const row = data[0];
    state.supabase.lastError = "";
    state.supabase.lastSyncedAt = row.updated_at || new Date().toISOString();
    persist(false);

    return { ok: true, found: true, payload: row.payload || {} };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    state.supabase.lastError = message;
    persist(false);
    return { ok: false, error: message };
  }
}

function startAutoPullLoop() {
  if (autoPullTimer) {
    clearInterval(autoPullTimer);
    autoPullTimer = null;
  }

  if (!isSupabaseConfigured()) return;

  void syncFromCloudIfNewer();

  autoPullTimer = setInterval(async () => {
    void syncFromCloudIfNewer();
  }, 12000);
}

async function fetchLatestCloudState() {
  try {
    const config = state.supabase;
    const key = encodeURIComponent(config.syncKey);
    const endpoint = `${config.url}/rest/v1/calorie_states?sync_key=eq.${key}&select=payload,updated_at&limit=1`;
    const response = await fetch(endpoint, {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
      },
    });

    if (!response.ok) {
      return { ok: false, error: await safeErrorMessage(response) };
    }

    const data = await response.json();
    if (!Array.isArray(data) || !data.length) {
      return { ok: true, found: false };
    }

    return {
      ok: true,
      found: true,
      payload: data[0].payload || {},
      updatedAt: data[0].updated_at || "",
    };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

async function syncFromCloudIfNewer() {
  if (!isSupabaseConfigured()) return;
  if (hasUnsyncedLocalChanges) return;

  const remoteState = await fetchLatestCloudState();
  if (!remoteState.ok || !remoteState.found) return;

  const remoteUpdatedAt = Date.parse(remoteState.updatedAt || "");
  const localUpdatedAt = Date.parse(state.supabase.lastSyncedAt || "");
  if (!Number.isNaN(remoteUpdatedAt) && !Number.isNaN(localUpdatedAt) && remoteUpdatedAt <= localUpdatedAt) {
    return;
  }

  const cloudData = remoteState.payload;
  state.profiles = (Array.isArray(cloudData.profiles) ? cloudData.profiles : [])
    .map(normalizeProfile)
    .filter(Boolean);
  state.customFoods = (Array.isArray(cloudData.customFoods) ? cloudData.customFoods : [])
    .map(normalizeFood)
    .filter(Boolean);
  state.activeProfileId = state.profiles.some((p) => p.id === cloudData.activeProfileId)
    ? cloudData.activeProfileId
    : state.profiles[0]?.id || null;
  state.supabase.lastSyncedAt = remoteState.updatedAt || new Date().toISOString();
  state.supabase.lastError = "";
  hasUnsyncedLocalChanges = false;
  persist(false);
  render();
}

async function safeErrorMessage(response) {
  try {
    const body = await response.json();
    if (body && typeof body === "object") {
      return body.message || body.error || `HTTP ${response.status}`;
    }
    return `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function loadState() {
  const fallback = {
    profiles: [],
    activeProfileId: null,
    customFoods: [],
    supabase: createDefaultSupabaseConfig(),
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;

    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles.map(normalizeProfile).filter(Boolean)
      : [];

    const customFoods = Array.isArray(parsed.customFoods)
      ? parsed.customFoods.map(normalizeFood).filter(Boolean)
      : [];

    const activeProfileId = profiles.some((p) => p.id === parsed.activeProfileId)
      ? parsed.activeProfileId
      : profiles[0]?.id || null;

    return {
      profiles,
      activeProfileId,
      customFoods,
      supabase: normalizeSupabaseConfig(parsed.supabase),
    };
  } catch {
    return fallback;
  }
}

function persist(triggerAutoSync = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (triggerAutoSync && isSupabaseConfigured()) {
    hasUnsyncedLocalChanges = true;
  }
  if (triggerAutoSync) {
    scheduleAutoSync();
  }
}

function normalizeProfile(input) {
  if (!input || typeof input !== "object" || !input.id || !input.name) return null;

  return {
    id: String(input.id),
    name: String(input.name),
    maintenanceCalories: clampNumber(Number(input.maintenanceCalories) || 2200, 1000, 7000),
    targetCalories: clampNumber(Number(input.targetCalories) || 1800, 800, 7000),
    entries: normalizeEntries(input.entries),
    createdAt: Number(input.createdAt) || Date.now(),
  };
}

function normalizeEntries(entries) {
  if (!entries || typeof entries !== "object") return {};

  const out = {};
  Object.keys(entries).forEach((date) => {
    const day = entries[date] || {};
    out[date] = {
      breakfast: normalizeEntryArray(day.breakfast),
      lunch: normalizeEntryArray(day.lunch),
      snacks: normalizeEntryArray(day.snacks),
      dinner: normalizeEntryArray(day.dinner),
    };
  });

  return out;
}

function normalizeEntryArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((entry) => ({
      id: String(entry.id || createId("entry")),
      foodId: String(entry.foodId || "unknown"),
      name: String(entry.name || "Unknown"),
      grams: Math.max(1, Number(entry.grams) || 100),
      calories: Math.max(0, Number(entry.calories) || 0),
      createdAt: Number(entry.createdAt) || Date.now(),
    }))
    .filter(Boolean);
}

function normalizeFood(food) {
  if (!food || typeof food !== "object" || !food.name) return null;
  return {
    id: String(food.id || createId("custom")),
    name: String(food.name),
    category: String(food.category || "Custom"),
    kcalPer100g: Math.max(0, Number(food.kcalPer100g) || 0),
    defaultServingG: clampNumber(Number(food.defaultServingG) || 100, 1, 1000),
  };
}

function buildSeedFoods() {
  const base = [
    ["Apple", "Fruit", 52, 150],
    ["Banana", "Fruit", 89, 118],
    ["Orange", "Fruit", 47, 130],
    ["Mango", "Fruit", 60, 165],
    ["Papaya", "Fruit", 43, 140],
    ["Grapes", "Fruit", 69, 100],
    ["Pineapple", "Fruit", 50, 120],
    ["Watermelon", "Fruit", 30, 200],
    ["Strawberry", "Fruit", 32, 100],
    ["Blueberry", "Fruit", 57, 100],
    ["Pear", "Fruit", 57, 160],
    ["Kiwi", "Fruit", 61, 90],
    ["Peach", "Fruit", 39, 140],
    ["Pomegranate", "Fruit", 83, 140],
    ["Avocado", "Fruit", 160, 100],

    ["White Rice Cooked", "Grains", 130, 150],
    ["Brown Rice Cooked", "Grains", 123, 150],
    ["Quinoa Cooked", "Grains", 120, 150],
    ["Oats Dry", "Grains", 389, 50],
    ["Whole Wheat Bread", "Grains", 247, 35],
    ["White Bread", "Grains", 265, 30],
    ["Roti", "Grains", 297, 45],
    ["Paratha", "Grains", 300, 70],
    ["Pasta Cooked", "Grains", 157, 140],
    ["Noodles Cooked", "Grains", 138, 150],
    ["Poha", "Grains", 130, 120],
    ["Upma", "Grains", 190, 150],
    ["Cornflakes", "Grains", 357, 30],
    ["Granola", "Grains", 471, 45],

    ["Chicken Breast Cooked", "Protein", 165, 120],
    ["Chicken Thigh Cooked", "Protein", 209, 120],
    ["Egg Whole", "Protein", 155, 50],
    ["Egg White", "Protein", 52, 35],
    ["Paneer", "Protein", 265, 80],
    ["Tofu", "Protein", 76, 100],
    ["Tempeh", "Protein", 195, 100],
    ["Lentils Cooked", "Protein", 116, 140],
    ["Chickpeas Cooked", "Protein", 164, 140],
    ["Kidney Beans Cooked", "Protein", 127, 140],
    ["Black Beans Cooked", "Protein", 132, 140],
    ["Fish Salmon", "Protein", 208, 120],
    ["Fish Tuna", "Protein", 132, 120],
    ["Prawns", "Protein", 99, 120],
    ["Turkey Breast", "Protein", 135, 120],

    ["Milk Full Fat", "Dairy", 61, 240],
    ["Milk Low Fat", "Dairy", 42, 240],
    ["Greek Yogurt", "Dairy", 59, 170],
    ["Curd", "Dairy", 98, 100],
    ["Cheddar Cheese", "Dairy", 403, 28],
    ["Mozzarella", "Dairy", 280, 28],
    ["Butter", "Dairy", 717, 10],
    ["Ghee", "Dairy", 900, 10],
    ["Whey Protein", "Dairy", 400, 30],

    ["Almonds", "Nuts", 579, 28],
    ["Cashews", "Nuts", 553, 28],
    ["Walnuts", "Nuts", 654, 28],
    ["Peanuts", "Nuts", 567, 28],
    ["Pistachios", "Nuts", 562, 28],
    ["Peanut Butter", "Nuts", 588, 32],
    ["Chia Seeds", "Nuts", 486, 20],
    ["Flax Seeds", "Nuts", 534, 20],

    ["Potato Boiled", "Vegetable", 87, 150],
    ["Sweet Potato", "Vegetable", 86, 150],
    ["Broccoli", "Vegetable", 34, 100],
    ["Cauliflower", "Vegetable", 25, 100],
    ["Spinach", "Vegetable", 23, 90],
    ["Carrot", "Vegetable", 41, 80],
    ["Cucumber", "Vegetable", 16, 100],
    ["Tomato", "Vegetable", 18, 100],
    ["Onion", "Vegetable", 40, 80],
    ["Bell Pepper", "Vegetable", 31, 80],
    ["Mushroom", "Vegetable", 22, 100],
    ["Green Peas", "Vegetable", 81, 100],
    ["Mixed Vegetable Curry", "Vegetable", 120, 180],

    ["Olive Oil", "Fats", 884, 10],
    ["Coconut Oil", "Fats", 892, 10],
    ["Mayonnaise", "Fats", 680, 15],
    ["Hummus", "Fats", 166, 40],

    ["Idli", "Indian Meal", 146, 50],
    ["Dosa", "Indian Meal", 168, 80],
    ["Masala Dosa", "Indian Meal", 230, 180],
    ["Sambar", "Indian Meal", 75, 150],
    ["Rajma Curry", "Indian Meal", 140, 170],
    ["Chole", "Indian Meal", 180, 170],
    ["Dal Tadka", "Indian Meal", 130, 170],
    ["Biryani Chicken", "Indian Meal", 240, 200],
    ["Biryani Veg", "Indian Meal", 190, 200],
    ["Pulao", "Indian Meal", 170, 180],
    ["Samosa", "Indian Meal", 262, 90],
    ["Pakora", "Indian Meal", 300, 80],
    ["Pav Bhaji", "Indian Meal", 220, 180],
    ["Vada Pav", "Indian Meal", 290, 140],
    ["Khichdi", "Indian Meal", 140, 180],

    ["Burger Veg", "Fast Food", 250, 180],
    ["Burger Chicken", "Fast Food", 295, 190],
    ["French Fries", "Fast Food", 312, 110],
    ["Pizza Margherita", "Fast Food", 270, 120],
    ["Pizza Pepperoni", "Fast Food", 298, 120],
    ["Hot Dog", "Fast Food", 290, 100],
    ["Fried Chicken", "Fast Food", 320, 140],
    ["Sandwich Veg", "Fast Food", 220, 150],

    ["Dark Chocolate", "Snack", 546, 30],
    ["Milk Chocolate", "Snack", 535, 30],
    ["Potato Chips", "Snack", 536, 35],
    ["Nachos", "Snack", 500, 35],
    ["Popcorn Air Popped", "Snack", 387, 25],
    ["Protein Bar", "Snack", 350, 60],
    ["Granola Bar", "Snack", 430, 40],
    ["Biscuits", "Snack", 490, 30],
    ["Ice Cream Vanilla", "Dessert", 207, 90],
    ["Brownie", "Dessert", 466, 60],

    ["Water", "Drink", 0, 250],
    ["Black Coffee", "Drink", 2, 240],
    ["Coffee with Milk", "Drink", 45, 240],
    ["Tea with Milk", "Drink", 38, 200],
    ["Green Tea", "Drink", 1, 240],
    ["Orange Juice", "Drink", 45, 240],
    ["Apple Juice", "Drink", 46, 240],
    ["Lemonade", "Drink", 40, 250],
    ["Coconut Water", "Drink", 19, 250],
    ["Buttermilk", "Drink", 40, 250],
    ["Lassi Sweet", "Drink", 120, 250],
    ["Soda Cola", "Drink", 42, 330],
    ["Diet Soda", "Drink", 1, 330],
    ["Energy Drink", "Drink", 45, 250],
    ["Sports Drink", "Drink", 24, 250],
    ["Beer", "Drink", 43, 330],
    ["Red Wine", "Drink", 85, 150],
    ["Whiskey", "Drink", 250, 45],
    ["Vodka", "Drink", 231, 45],
    ["Rum", "Drink", 231, 45],
  ];

  return base.map((item, index) => ({
    id: `seed-${index}-${slugify(item[0])}`,
    name: item[0],
    category: item[1],
    kcalPer100g: item[2],
    defaultServingG: item[3],
  }));
}

function createId(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function shortDate(iso) {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}`;
}

function formatIsoDate(iso) {
  const date = new Date(`${iso}T00:00:00`);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clampNumber(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function parseCsvText(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line) => {
    if (!line.trim()) return;
    rows.push(parseCsvLine(line));
  });
  return rows;
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}
