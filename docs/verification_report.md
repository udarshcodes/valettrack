# ValetTrack: Requirements Verification & CI Completion Report

**Date of Verification:** October 17, 2026  
**Auditor / Roles:** Senior Full Stack Engineer, TimescaleDB Database Architect, Machine Learning Engineer, Security Reviewer & QA Specialist  
**Verification Target:** ValetTrack Repository (`udarshcodes/valettrack`)  
**Verified Commit:** `b15a0c9`  
**GitHub Actions CI Workflow Run:** [Run #39013446084](https://github.com/udarshcodes/valettrack/actions/runs/39013446084)  
**Overall CI Status:** **100% PASSED (All Jobs and Steps Succeeded)**

---

## 1. Executive Summary & Defect Correction Audit

| Issue Area | Identified Failure in CI | Implemented Repair & Resolution | Status in GitHub Actions |
|---|---|---|---|
| **1. Database Initialization & Verification** | Linux runner reported `sh: 1: powershell: not found` because `package.json` hardcoded Windows PowerShell commands for `db:init` and `db:verify`. | Replaced with cross-platform Node.js SQL executor `scripts/run_sql.js`. Executes SQL against the TimescaleDB Docker service, local `psql`, or Node.js `pg` client with transient startup retry logic (`runWithRetry`), strict `ON_ERROR_STOP=1` error propagation, and full stdout/stderr visibility. | **VERIFIED & PASSED** (`✓ Initialize Database Schema`, `✓ Verify SQL Invariants`) |
| **2. Release Packaging Archive Validation** | Linux runner failed in `scripts/package_release.js` with `tar: This does not look like a tar archive` because GNU `tar -tf` rejects `.zip` format files. | Replaced system `tar` inspection with pure JavaScript `adm-zip` library. Validates archive integrity, enforces secret exclusions (`.env*`, private keys, certificates), verifies required source files, and ensures automatic cleanup of partial archives on error. | **VERIFIED & PASSED** (`✓ Verify Release Packaging & Secret Hygiene`) |
| **3. Server Dependencies in CI** | CI container failed with `Cannot find package 'dotenv' imported from server/src/config/env.js`. | Added `npm ci --prefix server` to CI workflow and installed `dotenv` and `adm-zip` in root package manifest and lockfile, ensuring proper ESM resolution across all runner environments. | **VERIFIED & PASSED** (`✓ Install Server Dependencies`) |
| **4. Reproducible ML Model Training** | CI step `npm run ml:train` threw `FileNotFoundError` because `data/birmingham/dataset.csv` was previously excluded by `.gitignore`. | Unignored `!data/birmingham/dataset.csv` (1.4 MB, 35,717 rows) in `.gitignore` and tracked it in git. Allows reproducible `HistGradientBoostingRegressor` model training in 2 seconds in fresh environments without downloading external assets. | **VERIFIED & PASSED** (`✓ Train HistGradientBoosting ML Occupancy Forecaster`) |
| **5. Integration Test Precondition Isolation** | Tests 20, 22, 23, and 27 failed on clean CI database because demo fixtures, Birmingham data, and SFpark baseline continuous aggregates had not been seeded. | Enhanced test `before()` hook in `tests/backend.test.js` to idempotently ensure baseline demo fixtures (`seedDemoData`), import Birmingham dataset if empty (`import_birmingham.js`), seed baseline SFpark demonstration continuous aggregate records, and log the audit manifest. Separated continuous aggregate refresh from insert transactions to prevent PostgreSQL error `25001`. | **VERIFIED & PASSED** (`✓ Run Backend Integration Test Suite`, 28/28 tests passed) |

---

## 2. GitHub Actions CI Run Results

**Workflow URL:** `https://github.com/udarshcodes/valettrack/actions/runs/39013446084`  
**Trigger:** `push` on branch `main` at commit `b15a0c9`

### Job 1: Lint, Frontend Build & Packaging Hygiene
- **Runner:** `ubuntu-latest` (Node.js 20)
- **Duration:** 19s
- **Steps:**
  - `✓ Checkout Repository`
  - `✓ Setup Node.js`
  - `✓ Install Node Dependencies` (`npm ci`)
  - `✓ Install Client Dependencies` (`npm ci --prefix client`)
  - `✓ Lint Frontend Code` (`npm run lint --prefix client`) $\to$ **0 errors** (19 clean warnings)
  - `✓ Build Frontend Production Bundle` (`npm run build:client`) $\to$ **Vite bundle built in 1.02s**
  - `✓ Verify Release Packaging & Secret Hygiene` (`npm run package`) $\to$ **142 files verified, 0 secrets, valid ZIP**

### Job 2: Database Invariants, ML & Backend Integration Tests
- **Runner:** `ubuntu-latest` (TimescaleDB PG16 Service, Node.js 20, Python 3.11)
- **Duration:** 1m 35s
- **Steps:**
  - `✓ Initialize containers` (TimescaleDB `timescale/timescaledb:latest-pg16` healthy on port 5432)
  - `✓ Checkout Repository`
  - `✓ Setup Node.js` & `✓ Setup Python`
  - `✓ Install Node Dependencies` (`npm ci`)
  - `✓ Install Server Dependencies` (`npm ci --prefix server`)
  - `✓ Install Python Dependencies` (`pip install -r requirements.txt`)
  - `✓ Initialize Database Schema & TimescaleDB Hypertables` (`npm run db:init`)
  - `✓ Safe Seed Baseline Configuration` (`npm run db:seed`)
  - `✓ Verify SQL Invariants & Continuous Aggregates` (`npm run db:verify`)
  - `✓ Train HistGradientBoosting ML Occupancy Forecaster` (`npm run ml:train`)
  - `✓ Run Backend Integration Test Suite` (`npm test`) $\to$ **All 28 test suites passed (100%)**

---

## 3. Automated Test Suite Breakdown (28 Tests Passing)

Official TAP output from GitHub Actions CI step `Run Backend Integration Test Suite`:

```
1..28
# tests 28
# suites 0
# pass 28
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 11019.877266
```

| Test # | Test Name | Invariant Verified | Result |
|---|---|---|---|
| **1** | Fresh Database Initialization & TimescaleDB Connectivity | Confirms PostgreSQL 16 + TimescaleDB 2.30.2 connectivity, healthy pool, and hypertable registration. | **PASS** |
| **2** | Dashboard Summary API Returns Database-Backed Statistics | Validates live counts, slot capacity calculations, and zero-ticket initial state. | **PASS** |
| **3** | Owner CRUD & Input Validation | Validates email/phone uniqueness, schema validation, record updates, and cascade protection. | **PASS** |
| **4** | Vehicle Registration & Owner Reference Validation | Confirms foreign key enforcement to registered owners (`ON DELETE RESTRICT`). | **PASS** |
| **5** | Ticket Lifecycle: Open Ticket, Availability Check, Slot Locking & Billing | Tests atomic slot allocation, status transitions (`Available` $\to$ `Occupied` $\to$ `Available`), and deterministic billing. | **PASS** |
| **6** | Concurrent Slot Allocation Protection (Different Vehicles, Same Slot) | Asserts that simultaneous allocation requests on the exact same slot allow exactly 1 success (201) and reject competitor (409 Conflict). | **PASS** |
| **7** | Concurrent Duplicate Vehicle Requests Across Different Spaces | Confirms partial unique index `uq_active_vehicle_ticket` rejects multi-space vehicle bookings with HTTP 409 (`VehicleAlreadyParked`). | **PASS** |
| **8** | Ticket Reopening & Duplicate Ticket Closure Rejection | Validates that closing an already closed ticket returns HTTP 400 (`AlreadyClosed`). | **PASS** |
| **9** | Exact Hourly Occupancy: Time-Weighted Average, True Peak, and True Min | Validates mathematical interval calculations on known non-overlapping ticket fixtures. | **PASS** |
| **10** | Exact Daily Occupancy Values Across Calendar Range | Confirms continuous calendar day generation where zero-ticket dates return 0.0% without omission. | **PASS** |
| **11** | Multi-Day Ticket Spanning Midnight Interval Splitting | Validates exact midnight stay duration interval splitting across distinct calendar days. | **PASS** |
| **12** | Missing Hourly Observations & Disjoint Interval Handling | Confirms empty hours correctly record 0.0% minimum occupancy during unmonitored intervals. | **PASS** |
| **13** | Correct Recent Time Window Selection & Chronological Order | Validates strict ascending chronological order of analytical time series windows. | **PASS** |
| **14** | SFpark 4-Band Dynamic Pricing Policy Boundary Tests | Validates rate adjustments across 0%, 29.99%, 30%, 59.99%, 60%, 80%, 80.01%, 100%, and $0.25 floor. | **PASS** |
| **15** | Facility Dynamic Pricing Policy Verification (INR & 4-Tier Elasticity) | Validates ₹ INR 4-tier elasticity curve (+20% surge, 0% standard, -10% incentive, -20% discount). | **PASS** |
| **16** | Identifier Sequence Synchronization & Additional Slot Creation | Confirms `fn_sync_all_sequences()` prevents primary key collision after explicit manual seed inserts. | **PASS** |
| **17** | Safe SQL and JavaScript Seeding Preservation of Active Ticket Slot Status | Validates that both `scripts/seed.js` and `sql/seed.sql` preserve existing `Occupied` and `Reserved` slot statuses. | **PASS** |
| **18** | Time Series Lag Feature Exact Timestamp Alignment Verification | Verifies that lag features strictly correspond to $t - 1\text{h}$ and $t - 24\text{h}$. | **PASS** |
| **19** | Prevention of Future Information Leakage During Model Validation | Asserts chronological train/holdout split boundary integrity prior to feature engineering. | **PASS** |
| **20** | Machine Learning Model Artifacts, Scikit-Learn 1.9.0 Alignment & Recursive Inference | Validates model metadata, Scikit-Learn 1.9.0 compatibility, multi-horizon forecast generation, and in-database persistence. | **PASS** |
| **21** | Operational Forecasting vs Historical Demonstration Mode Handling | Validates refusal of operational forecasts when live telemetry has gaps (`INSUFFICIENT_CURRENT_DATA`). | **PASS** |
| **22** | Real World Birmingham & SFpark Hypertable Continuous Aggregates | Validates analytical rollup queries on `birmingham_hourly_summary` and `sfpark_hourly_summary`. | **PASS** |
| **23** | Dataset Import Manifest Audit Log & Production Overwrite Safeguards | Verifies cryptographic audit manifests, verified SHA256 hashes, and duplicate import safeguards. | **PASS** |
| **24** | Secret Protection, Distribution Package Hygiene & Release Packaging | Validates that `.env` is ignored by git, release archive excludes secrets, and production rejects default credentials. | **PASS** |
| **25** | Telemetry API Authentication & Validation Guards | Validates constant-time API key / Bearer authentication, rejecting missing, invalid, or malformed payloads. | **PASS** |
| **26** | Telemetry Ingestion, Status Metrics & Operational Forecast Trigger | Validates 24h consecutive chronological telemetry requirement, gap detection, and safe database upsert. | **PASS** |
| **27** | Slot, Staff, Owner & Vehicle Referential Integrity Protection | Confirms deletion of unused slots succeeds (200), but deleting entities with active or historical tickets returns HTTP 400 `CannotDelete`. | **PASS** |
| **28** | ML Model Artifact Availability Guard & Injection Protection | Validates physical presence of `.joblib` model artifact, safe `execFile` argument execution, and rejection of command injection attempts. | **PASS** |

---

## 4. Release Distribution Package Audit

Executed via `node scripts/package_release.js`:

```
=== ValetTrack Release Packaging & Hygiene Verification ===
1. Packaging tracked repository sources via git archive...
2. Inspecting archive integrity and table of contents with AdmZip...
3. Auditing release contents against sensitive files, credentials, and unwanted artifacts...
4. Release Packaging Audit Certification:
* Distribution ZIP:   valettrack-release.zip (3215.5 KB)
* Packaged Files:     142 verified files
* Secret Protection:  Zero sensitive .env or credential files included
* Config Template:    Sanitized .env.example included
* Academic Artifact:  sql/oracle_valettrack.sql verified
* ML Reproducibility: model_metadata.json and train_occupancy_model.py verified
* Packaging Hygiene:  EXCLUDED node_modules, .git, scratch, *.joblib, raw archives
=== Release Packaging Successfully Completed ===
```

- **Archive Format:** Standard ZIP format, verified using pure JavaScript `adm-zip` (compatible with Windows, Ubuntu, macOS).
- **Security Check:** Zero `.env`, `.env.local`, `.pem`, `.key`, or credentials packaged.
- **Model Provisioning:** The binary `.joblib` artifact is excluded from git/releases to maintain lightweight distribution. The training pipeline (`scripts/train_occupancy_model.py`), training dataset (`data/birmingham/dataset.csv`), and model card (`data/models/model_metadata.json`) are fully packaged for 100% reproducible model training.
- **Academic Deliverables:** Both Chen ER diagram reports and `sql/oracle_valettrack.sql` are strictly packaged.

---

## 5. Academic Deliverables & Oracle PL/SQL Separation

- **PostgreSQL / TimescaleDB Engine:** All operational application code, API controllers, automated allocation routines, and integration tests execute against PostgreSQL 16 + TimescaleDB 2.30.2.
- **Oracle PL/SQL Deliverable (`sql/oracle_valettrack.sql`):** Preserved as an independent academic deliverable.
  - Implements Oracle syntax DDL (`OWNER_`, `Vehicle`, `ValetStaff`, `SlotType`, `ParkingSlot`, `Ticket`, `PricingPrediction`, `OccupancyPrediction`).
  - Includes PL/SQL functions (`fn_calculate_amount`), procedures (`proc_open_ticket`, `proc_close_ticket`, `proc_log_occupancy_prediction`, `proc_log_pricing_prediction`), triggers, package `pkg_valet_track`, and an automated demonstration test block.
  - **Environment Limitation Statement:** The primary CI environment runs Linux TimescaleDB; an Oracle database instance is not bundled in the TimescaleDB CI job to avoid introducing an unneeded commercial database dependency.

---

## 6. Authentic Remaining Limitations

1. **SFpark Full Historical Raw CSV (1.38 GB):** The complete uncompressed SFpark raw CSV contains 7.9M records (~1.38 GB) and is excluded from git to comply with GitHub file size restrictions. In production/evaluation, it is imported via `scripts/import_sfpark.js` using streaming ZIP decompression. In CI, baseline demonstration aggregates and the audit manifest are verified.
2. **Operational Telemetry vs Physical Sensor Hardware:** ValetTrack implements authenticated REST ingestion (`/api/telemetry/readings`), constant-time API key verification, and 24-hour chronological sequence validation. The application does not claim a direct hardware IoT sensor bus is connected when running in demo/CI mode.
