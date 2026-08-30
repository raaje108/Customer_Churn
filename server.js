/**
 * server.js — Express web server + Python ML Worker manager
 *
 * No Flask. No HTTP between Node and Python.
 * Node.js spawns python_service/worker.py as a child process and communicates
 * via stdin / stdout using newline-delimited JSON (NDJSON).
 *
 * Flow:
 *   Browser → POST /api/predict → Node.js → write JSON to worker stdin
 *                                          ← read JSON from worker stdout
 *                                ← respond JSON to browser
 */

"use strict";

const express    = require("express");
const { spawn }  = require("child_process");
const readline   = require("readline");
const path       = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(require("cors")());
app.use(express.static(path.join(__dirname, "public")));

// ─── Python Worker Manager ────────────────────────────────────────────────────

let worker      = null;   // child_process
let workerReady = false;  // true after worker prints {"status":"ready"}
const pending   = [];     // queue of { resolve, reject } callbacks

/**
 * Start (or restart) the Python ML worker process.
 * Called once on server startup and automatically on crash.
 */
function startWorker() {
  console.log("🐍  Starting Python ML worker...");

  // "python3" on Linux/Mac (Render), "python" on Windows
  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  worker = spawn(pythonCmd, [path.join(__dirname, "python_service", "worker.py")], {
    cwd: __dirname,
  });

  // Attach readline to parse newline-delimited JSON from worker stdout
  const rl = readline.createInterface({ input: worker.stdout });

  rl.on("line", (line) => {
    line = line.trim();
    if (!line) return;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error("[Worker] Unparseable line:", line);
      return;
    }

    // First message is the ready signal
    if (msg.status === "ready") {
      workerReady = true;
      console.log("✅  Python ML worker is ready — accepting predictions");
      return;
    }

    // Route to the oldest waiting request
    const cb = pending.shift();
    if (cb) cb.resolve(msg);
  });

  // Log Python stderr (TF warnings etc.) but don't crash for it
  worker.stderr.on("data", (data) => {
    const text = data.toString().trim();
    // Only log non-trivial TF messages; ignore progress bars
    if (text && !text.startsWith("\r")) {
      console.error("[Python stderr]", text);
    }
  });

  worker.on("close", (code) => {
    workerReady = false;
    console.warn(`⚠️   Python worker exited (code ${code}). Restarting in 2 s…`);
    // Reject all queued requests so clients don't hang
    while (pending.length) {
      pending.shift().reject(new Error("ML worker restarted. Please retry."));
    }
    setTimeout(startWorker, 2000);
  });
}

/**
 * Send a prediction request to the Python worker.
 * Returns a Promise that resolves when the worker responds.
 */
function predict(customerData) {
  return new Promise((resolve, reject) => {
    if (!workerReady) {
      return reject(new Error("ML worker is still loading. Please try again in a moment."));
    }
    pending.push({ resolve, reject });
    worker.stdin.write(JSON.stringify(customerData) + "\n");
  });
}

// Start the worker right away (loads TF model in background)
startWorker();

// ─── API Routes ───────────────────────────────────────────────────────────────

/** Health endpoint — lets the UI know whether the ML worker is ready */
app.get("/api/health", (_req, res) => {
  res.json({
    status:        "ok",
    python_worker: workerReady ? "ready" : "loading",
  });
});

/** Prediction endpoint */
app.post("/api/predict", async (req, res) => {
  try {
    const result = await predict(req.body);
    if (result.error) {
      return res.status(422).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀  Server → http://localhost:${PORT}`);
  console.log("    (Python ML worker is loading TensorFlow model in the background…)\n");
});
