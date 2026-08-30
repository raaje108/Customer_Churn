"use strict";

// ═══════════════════════════════════════════════════════════════════════════
//  ChurnAI — Frontend Logic
//  3-step wizard → Node.js API → Python ML worker → animated result
// ═══════════════════════════════════════════════════════════════════════════

// ── Form state (matches the notebook's raw CSV column names exactly) ──────
const formData = {
  // Personal
  gender:            "Male",
  SeniorCitizen:     "0",
  Partner:           "No",
  Dependents:        "No",
  // Services
  tenure:            0,
  PhoneService:      "Yes",
  MultipleLines:     "No",
  InternetService:   "DSL",
  OnlineSecurity:    "No",
  OnlineBackup:      "No",
  DeviceProtection:  "No",
  TechSupport:       "No",
  StreamingTV:       "No",
  StreamingMovies:   "No",
  // Billing
  Contract:          "Month-to-month",
  PaperlessBilling:  "No",
  PaymentMethod:     "Electronic check",
  MonthlyCharges:    50,
  TotalCharges:      600,
};

let currentStep = 1;
const TOTAL_STEPS = 3;

// ── DOM refs ──────────────────────────────────────────────────────────────
const panels          = document.querySelectorAll(".panel");
const stepItems       = document.querySelectorAll(".step-item");
const stepTracks      = document.querySelectorAll(".step-track");
const dots            = document.querySelectorAll(".dot");
const btnBack         = document.getElementById("btnBack");
const btnNext         = document.getElementById("btnNext");
const navBar          = document.getElementById("navBar");
const loadingOverlay  = document.getElementById("loadingOverlay");
const errorToast      = document.getElementById("errorToast");
const toastMsg        = document.getElementById("toastMsg");
const statusDot       = document.getElementById("statusDot");
const statusLabel     = document.getElementById("statusLabel");
const internetAddons  = document.getElementById("internetAddons");
const btnReset        = document.getElementById("btnReset");
const tenureSlider    = document.getElementById("tenureSlider");
const tenureDisplay   = document.getElementById("tenureDisplay");

// ── Health polling ────────────────────────────────────────────────────────
async function checkHealth() {
  try {
    const res  = await fetch("/api/health");
    const data = await res.json();

    if (data.python_worker === "ready") {
      statusDot.className   = "status-dot ready";
      statusLabel.textContent = "ML Ready";
    } else {
      statusDot.className   = "status-dot loading";
      statusLabel.textContent = "ML Loading…";
      setTimeout(checkHealth, 2500);
    }
  } catch {
    statusDot.className   = "status-dot error";
    statusLabel.textContent = "Server Offline";
    setTimeout(checkHealth, 4000);
  }
}
checkHealth();

// ── Stepper UI ────────────────────────────────────────────────────────────
function setStep(n) {
  currentStep = n;

  // Panels
  panels.forEach(p => p.classList.remove("active"));
  const target = document.getElementById(`panel-${n}`);
  if (target) target.classList.add("active");

  // Step circles
  stepItems.forEach((item, i) => {
    const s = i + 1;
    item.classList.remove("active", "done");
    if (s === n)      item.classList.add("active");
    else if (s < n)   item.classList.add("done");
  });

  // Track fills
  stepTracks.forEach((track, i) => {
    track.classList.toggle("done", i + 1 < n);
  });

  // Dots
  dots.forEach((dot, i) => {
    dot.classList.toggle("active", i + 1 === n);
  });

  // Back button
  btnBack.disabled = n === 1;

  // Next / Predict label
  if (n === TOTAL_STEPS) {
    btnNext.textContent = "✓ Predict Churn";
    btnNext.classList.add("predict");
  } else {
    btnNext.textContent = "Next →";
    btnNext.classList.remove("predict");
  }

  // Show/hide nav on result
  navBar.classList.toggle("hidden", n === 0);
}

// ── Navigation handlers ───────────────────────────────────────────────────
btnNext.addEventListener("click", () => {
  if (currentStep < TOTAL_STEPS) {
    setStep(currentStep + 1);
  } else {
    runPrediction();
  }
});

btnBack.addEventListener("click", () => {
  if (currentStep > 1) setStep(currentStep - 1);
});

btnReset.addEventListener("click", () => {
  setStep(1);
  resetResult();
});

// ── Toggle group (gender, MultipleLines) ──────────────────────────────────
document.querySelectorAll(".tgl-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const field = btn.dataset.field;
    const val   = btn.dataset.value;

    // Deactivate siblings in same group
    btn.closest(".toggle-group")
       .querySelectorAll(".tgl-btn")
       .forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    formData[field] = val;

    // Special: PhoneService drives MultipleLines availability
    if (field === "MultipleLines") return;
  });
});

// ── Toggle switches ───────────────────────────────────────────────────────
document.querySelectorAll(".switch input[type=checkbox]").forEach(cb => {
  cb.addEventListener("change", () => {
    const field = cb.dataset.field;
    const val   = cb.checked ? cb.dataset.true : cb.dataset.false;
    formData[field] = val;

    if (field === "PhoneService") handlePhoneService(cb.checked);
  });
});

function handlePhoneService(isActive) {
  const multiGroup = document.querySelector('[data-field="MultipleLines"]')
                              ?.closest(".toggle-group");
  if (!multiGroup) return;

  if (!isActive) {
    // Force "No phone service" when phone is off
    multiGroup.querySelectorAll(".tgl-btn").forEach(b => b.classList.remove("active"));
    const npsBtn = multiGroup.querySelector('[data-value="No phone service"]');
    if (npsBtn) npsBtn.classList.add("active");
    formData.MultipleLines = "No phone service";
  }
  document.getElementById("multiLinesField").style.opacity = isActive ? "1" : "0.45";
}

// ── Card selects (InternetService, Contract, PaymentMethod) ───────────────
document.querySelectorAll(".sel-card").forEach(card => {
  card.addEventListener("click", () => {
    const field = card.dataset.field;
    const val   = card.dataset.value;

    card.closest(".card-select")
        .querySelectorAll(".sel-card")
        .forEach(c => c.classList.remove("active"));
    card.classList.add("active");

    formData[field] = val;

    if (field === "InternetService") handleInternetChange(val);
  });
});

function handleInternetChange(val) {
  const noInternet = val === "No";
  internetAddons.classList.toggle("hidden", noInternet);

  // When no internet, force "No internet service" for all add-ons
  const addonFields = [
    "OnlineSecurity","OnlineBackup","DeviceProtection",
    "TechSupport","StreamingTV","StreamingMovies"
  ];
  if (noInternet) {
    internetAddons.querySelectorAll("input[type=checkbox]").forEach(cb => {
      cb.checked = false;
    });
    addonFields.forEach(f => { formData[f] = "No internet service"; });
  } else {
    // Restore to Yes/No based on checkbox state
    internetAddons.querySelectorAll("input[type=checkbox]").forEach(cb => {
      const field = cb.dataset.field;
      formData[field] = cb.checked ? "Yes" : "No";
    });
  }
}

// ── Tenure slider ─────────────────────────────────────────────────────────
tenureSlider.addEventListener("input", () => {
  const v = parseInt(tenureSlider.value, 10);
  formData.tenure = v;
  tenureDisplay.textContent = `${v} month${v !== 1 ? "s" : ""}`;
  updateSliderTrack(tenureSlider);
});

function updateSliderTrack(slider) {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.background =
    `linear-gradient(to right, var(--primary) ${pct}%, rgba(255,255,255,0.08) ${pct}%)`;
}
updateSliderTrack(tenureSlider); // initial fill

// ── Number inputs (MonthlyCharges, TotalCharges) ──────────────────────────
document.querySelectorAll(".num-input[data-field]").forEach(input => {
  input.addEventListener("input", () => {
    formData[input.dataset.field] = parseFloat(input.value) || 0;
  });
});

// ── Prediction API call ───────────────────────────────────────────────────
async function runPrediction() {
  showLoading(true);

  try {
    const res = await fetch("/api/predict", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(formData),
    });

    const data = await res.json();
    showLoading(false);

    if (!res.ok || data.error) {
      showError(data.error || "Prediction failed. Is the ML worker ready?");
      return;
    }

    showResult(data);
  } catch (err) {
    showLoading(false);
    showError("Cannot reach server. Make sure Node.js is running.");
  }
}

// ── Result rendering ──────────────────────────────────────────────────────
const CIRC = 2 * Math.PI * 58; // ring circumference ≈ 364.4

function showResult(data) {
  const { churn_probability: prob, churn, risk_level: risk } = data;

  // Switch to result panel
  panels.forEach(p => p.classList.remove("active"));
  document.getElementById("panel-result").classList.add("active");
  navBar.classList.add("hidden");

  // Mark all steps done
  stepItems.forEach(i => { i.classList.remove("active"); i.classList.add("done"); });
  stepTracks.forEach(t => t.classList.add("done"));

  // Populate text
  const riskPill    = document.getElementById("riskPill");
  const verdict     = document.getElementById("verdict");
  const verdictSub  = document.getElementById("verdictSub");
  const detProb     = document.getElementById("detProb");
  const detRisk     = document.getElementById("detRisk");
  const detPred     = document.getElementById("detPred");
  const ringPct     = document.getElementById("ringPct");
  const ringFg      = document.getElementById("ringFg");

  riskPill.textContent = `${risk} Risk`;
  riskPill.className   = `risk-pill ${risk.toLowerCase()}`;

  verdict.textContent    = churn ? "⚠️ Likely to Churn" : "✅ Likely to Stay";
  verdictSub.textContent = churn
    ? "This customer shows a significant churn signal."
    : "This customer shows strong retention indicators.";

  detProb.textContent = `${(prob * 100).toFixed(1)}%`;
  detRisk.textContent = risk;
  detPred.textContent = churn ? "Will Churn" : "Will Stay";

  // Ring color
  const color = risk === "High" ? "#ef4444" : risk === "Medium" ? "#f59e0b" : "#10b981";
  ringFg.style.stroke = color;
  ringPct.style.color = color;

  // Animate ring
  ringFg.style.strokeDasharray  = CIRC;
  ringFg.style.strokeDashoffset = CIRC; // start empty

  // Animate pct counter + ring fill
  let start = null;
  const duration = 1400;

  function animate(ts) {
    if (!start) start = ts;
    const elapsed  = ts - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic

    ringFg.style.strokeDashoffset = CIRC * (1 - prob * eased);
    ringPct.textContent = `${Math.round(prob * eased * 100)}%`;

    if (progress < 1) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

function resetResult() {
  // Reset ring
  const ringFg     = document.getElementById("ringFg");
  const ringPct    = document.getElementById("ringPct");
  ringFg.style.strokeDashoffset = CIRC;
  ringFg.style.stroke           = "var(--primary)";
  ringPct.style.color           = "";
  ringPct.textContent           = "0%";
}

// ── Loading overlay ───────────────────────────────────────────────────────
function showLoading(on) {
  loadingOverlay.classList.toggle("hidden", !on);
}

// ── Error toast ───────────────────────────────────────────────────────────
let toastTimer = null;
function showError(msg) {
  toastMsg.textContent = msg;
  errorToast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => errorToast.classList.add("hidden"), 5000);
}

// ── Init ──────────────────────────────────────────────────────────────────
setStep(1);
