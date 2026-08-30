#!/usr/bin/env python3
"""
Run ONCE to train the model and save artifacts needed by the Node.js app.
This is the SAME code as main.ipynb — no changes to the ML logic.

Usage:
    python save_artifacts.py
"""

import os
import pandas as pd
import numpy as np
import joblib
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Dense, Dropout
from tensorflow.keras.callbacks import EarlyStopping

# ── Same seeds as notebook ────────────────────────────────────────────────────
np.random.seed(42)
tf.random.set_seed(42)

# ── Step 1: Fetch dataset (same as notebook) ──────────────────────────────────
print("1. Fetching the real IBM Telco Customer Churn dataset...")
url = "https://raw.githubusercontent.com/carlosfab/dsnp2/master/datasets/WA_Fn-UseC_-Telco-Customer-Churn.csv"
df = pd.read_csv(url)

# ── Step 2: Clean & preprocess (same as notebook) ────────────────────────────
print("2. Cleaning and preprocessing real data...")
df = df.drop(columns=["customerID"])
df["TotalCharges"] = pd.to_numeric(df["TotalCharges"], errors="coerce")
df = df.dropna()
df["Churn"] = df["Churn"].map({"Yes": 1, "No": 0})

X = df.drop(columns=["Churn"])
y = df["Churn"]
X = pd.get_dummies(X, drop_first=True)

# ── Step 3: Split (same as notebook) ─────────────────────────────────────────
print("3. Splitting data into train, validation, and test sets...")
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)
X_train, X_val, y_train, y_val = train_test_split(
    X_train, y_train, test_size=0.2, random_state=42, stratify=y_train
)

# ── Step 4: Scale (same as notebook) ─────────────────────────────────────────
print("4. Scaling features...")
scaler = StandardScaler()
X_train_s = scaler.fit_transform(X_train)
X_val_s   = scaler.transform(X_val)

# ── Step 5: Build model (same as notebook) ────────────────────────────────────
print("5. Building the ANN model...")
model = Sequential([
    Dense(64, activation="relu", input_shape=(X_train.shape[1],)),
    Dropout(0.2),
    Dense(32, activation="relu"),
    Dropout(0.2),
    Dense(1, activation="sigmoid")
])
model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy"])

early_stop = EarlyStopping(
    monitor="val_loss", mode="min", patience=10,
    restore_best_weights=True, verbose=1
)

# ── Step 6: Train (same as notebook) ─────────────────────────────────────────
print("6. Training the model...")
model.fit(
    X_train_s, y_train,
    epochs=100, batch_size=32,
    validation_data=(X_val_s, y_val),
    callbacks=[early_stop],
    verbose=1
)

# ── Step 7: Save artifacts for Node.js app ────────────────────────────────────
os.makedirs("artifacts", exist_ok=True)
print("\n7. Saving artifacts...")

joblib.dump(scaler, "artifacts/scaler.pkl")
print("   ✓ scaler.pkl")

joblib.dump(list(X.columns), "artifacts/feature_columns.pkl")
print(f"   ✓ feature_columns.pkl  ({len(X.columns)} features)")

model.save("artifacts/churn_model.keras")
print("   ✓ churn_model.keras")

print("\n✅ Done! Run: node server.js")
