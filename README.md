# ValetTrack: Intelligent Parking Orchestration and Time Series Analytics

[![TimescaleDB](https://img.shields.io/badge/Database-TimescaleDB%202.30%20(PG16)-blue.svg)](https://www.timescale.com/)
[![Node.js](https://img.shields.io/badge/Backend-Node.js%20(v20.19%2B%20%7C%20v22%20LTS%20%7C%20v24)-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/Frontend-React%2019%20%2F%20Vite%208-cyan.svg)](https://react.dev/)
[![ML Forecaster](https://img.shields.io/badge/ML%20Model-HistGradientBoosting%20(MAE%202.91%25)-purple.svg)]()
[![Real Observations](https://img.shields.io/badge/Real%20Data-7.9M%2B%20Observations-emerald.svg)]()
[![Tests](https://img.shields.io/badge/Tests-24%2F24%20Passed-brightgreen.svg)]()

> **ValetTrack** is an enterprise grade parking management and time series analytics platform. It unifies a high end dark aesthetic landing page with Boyce-Codd Normal Form (BCNF) relational models, **TimescaleDB time series hypertables**, prematerialized continuous aggregates, ACID slot allocation, a production machine learning time series forecaster, automated vehicle-to-space allocation, and real world municipal parking sensor benchmarks from the City of Birmingham (35.7K records) and the complete San Francisco SFpark dataset (**7,902,290 records**).

---

## 1. System Architecture and Key Capabilities

```mermaid
flowchart TD
    subgraph Client ["Frontend Client (React 19, Vite 8, Tailwind CSS)"]
        Landing["Landing Page (Full Page HLS Video Stream)"]
        Dashboard["Operational Dashboard (/dashboard)"]
        AllocUI["Automated Slot Recommender (/tickets)"]
        PredictUI["Machine Learning Forecaster (/analytics)"]
        PricingUI["SFpark Dynamic Pricing Policy (/pricing)"]
    end

    subgraph Backend ["Backend API (Node.js, Express 4.21)"]
        Router["Express REST API and Input Validation"]
        AllocEngine["Multi-Criteria Vehicle Allocation Engine"]
        LockManager["ACID Concurrency and Row Lock Manager"]
        PricingEngine["SFpark 4-Band Dynamic Pricing Engine"]
        StreamImporter["Stream Ingestion (pg-copy-streams)"]
    end

    subgraph ML ["Machine Learning Pipeline (Python, Scikit-Learn)"]
        Trainer["train_occupancy_model.py (HistGradientBoosting)"]
        Inferencer["predict_occupancy.py (24h Multi-Horizon)"]
        ModelWeights[("occupancy_forecaster.joblib (MAE 2.91%)")]
    end

    subgraph Database ["TimescaleDB 2.30, PostgreSQL 16 (Docker)"]
        subgraph Relational ["BCNF Relational Core"]
            Owners["owners"]
            Vehicles["vehicles"]
            Staff["valet_staff"]
            SlotTypes["slot_types"]
            Slots["parking_slots"]
            Tickets["tickets (Active Constraints)"]
            Predictions["occupancy_predictions & pricing_predictions"]
            Manifest["dataset_imports"]
        end
        subgraph Hypertables ["Time Series Engine"]
            BhamHT["birmingham_readings (12 Chunks)"]
            SFparkHT["sfpark_readings (122 Chunks)"]
            CAGG1["birmingham_hourly_summary (Continuous Aggregate)"]
            CAGG2["sfpark_hourly_summary (Continuous Aggregate)"]
        end
    end

    Client <-->|REST API / JSON| Backend
    Backend <-->|pg Pool / SQL| Relational
    Backend <-->|time_bucket and CAGG| Hypertables
    StreamImporter -->|COPY FROM STDIN| Hypertables
    Trainer --> ModelWeights
    Inferencer -->|Load Artifacts| ModelWeights
    Inferencer -->|Persist Predictions| Predictions
    Backend -->|Spawn Inference| Inferencer
```

### A. Core Relational Operations and Concurrency Safety
* **Boyce-Codd Normal Form (BCNF)**: Normalized relational schema eliminating update anomalies and transitive dependencies across Owners, Vehicles, Valet Staff, Slot Types, Parking Slots, and Tickets.
* **Vehicle Concurrency Guard**: Partial unique index `uq_active_vehicle_ticket` on `tickets(vehicle_no) WHERE exit_time IS NULL` prevents any vehicle from holding multiple active parking tickets across the facility simultaneously.
* **Slot Double Booking Guard**: Partial unique index `uq_active_slot_ticket` on `tickets(slot_id) WHERE exit_time IS NULL` and transactional row locking (`SELECT ... FOR UPDATE`) guarantees race-condition-free slot occupancy under high concurrent load.
* **Safe Dynamic Sequence Synchronization**: Database routine `fn_sync_all_sequences()` dynamically aligns PostgreSQL `SERIAL` sequences with `MAX(id)` after explicit seed operations.
* **Deterministic Billing Rules**: Enforces exact mathematical stay duration rounding (`CEIL(duration / 3600) * BaseRate`), a mandatory 1-hour minimum charge, and base rates tied to slot categories.
* **Safe Seeding vs Dev Reset**: `npm run db:seed` performs safe, non-destructive upserts. Intentional cleanup is isolated to `npm run db:reset`, protected by strict safeguards that refuse to execute in production (`NODE_ENV=production`).

### B. Machine Learning Forecaster and Automated Slot Allocation
* **Production Time Series Forecaster**: Real `HistGradientBoostingRegressor` trained on 35,717 hourly municipal observations with complete continuous hourly indexing and strict leakage prevention (chronological split before preprocessing). Features: `hour`, `day_of_week`, `is_weekend`, `lag_1h`, `lag_24h`.
  * **Validation MAE:** **4.85%** | **RMSE:** **9.41%** | **$R^2$:** **0.6896** (evaluated strictly on 148 genuine observed holdout targets, achieving a 28.6% error reduction over the naive 24h persistence baseline of 6.79% MAE).
* **Automated Multi-Criteria Slot Allocation**: Evaluates incoming vehicles by powertrain and dimensions:
  * **Electric Vehicles (EV):** Prioritized for Level 2 `EVCharging` spaces.
  * **SUVs & Large Vehicles:** Prioritized for wide-clearance `Covered` spaces.
  * **Sedans & Hatchbacks:** Directed to standard `Regular` spaces to conserve premium bays.
  * Provides explainable allocation rationales via `/api/slots/recommendation` and interactive frontend.

### C. TimescaleDB Time Series Engine and Real Municipal Datasets
* **Hypertables**: Automated time based chunk partitioning on `birmingham_readings` (12 chunks) and `sfpark_readings` (122 chunks).
* **Continuous Aggregates**: Prematerialized hourly summaries via `birmingham_hourly_summary` and `sfpark_hourly_summary` providing sub-100ms analytical response times across 7.9M+ records.
* **Integrated Real Datasets**:
  * **City of Birmingham (UCI Machine Learning Repository)**: 35,717 real sensor observations across 30 car parks (Oct to Dec 2016) with negative sensor glitches clamped to 0.
  * **SFpark Street Sensor Dataset (City of San Francisco)**: **7,902,290 real observations** across 10 commercial districts (2011 to 2013). Streamed directly from repository ZIP archive via `COPY ... FROM STDIN`.
* **Empirical 4-Band Dynamic Pricing Policies**:
  * **SFpark Municipal Meter Policy ($ USD)**: Documented SFpark pilot dynamic pricing rules (>80% +$0.25, 60–80% maintain, 30–<60% -$0.25, <30% -$0.50, floor $0.25, ceiling $6.00).
  * **ValetTrack Facility Dynamic Pricing (₹ INR)**: 4-tier elasticity curve for facility bays (>80% +20% surge, 60–80% standard, 30–<60% -10% incentive, <30% -20% discount).

---

## 2. Technology Stack & Supported Runtimes

| Layer | Technologies | Details |
|---|---|---|
| **Database** | TimescaleDB on PostgreSQL | `2.30.2` (PG 16.15) with Docker Compose named volume persistence (`valettrack_pgdata`) |
| **Backend** | Node.js, Express.js | Express 4.21, `pg` connection pool, `pg-copy-streams`, Zod validation |
| **Machine Learning** | Python 3, Scikit-Learn | Scikit-Learn 1.9.0, Joblib, NumPy, Pandas (`HistGradientBoostingRegressor`) |
| **Frontend** | React 19, Vite 8 | Single page application with React Router 7, Tailwind CSS 3.4 |
| **Supported Node.js** | Node.js 20.19+, Node.js 22+ LTS | Required by Vite 8 & React 19 (Tested and validated on Node.js 24) |
| **Testing** | Node.js Test Runner | `node:test` and `node:assert` (**24 automated integration test suites**) |

---

## 3. Quickstart and Local Setup Instructions

### Prerequisites
* [Docker Desktop](https://www.docker.com/products/docker-desktop/) running locally.
* [Node.js](https://nodejs.org/) (v20.19+, v22+ LTS, or v24).
* [Python 3.10+](https://www.python.org/) with `pip`.

### Step 1: Install Dependencies
```powershell
# Copy environment configuration template
Copy-Item .env.example .env

# Root dependencies (pg, pg-copy-streams, csv-parser)
npm install

# Server dependencies
npm install --prefix server

# Client dependencies
npm install --prefix client

# Python Machine Learning dependencies (reproducible manifest)
pip install -r requirements.txt
```

### Step 2: Start Local TimescaleDB Container
```powershell
npm run db:up
```
Container `valettrack-timescaledb` starts on port `5432` with persistent volume `valettrack_pgdata`.

### Step 3: Apply Database Schema and Safe Facility Seeding
```powershell
# 1. Apply relational schema, hypertables, triggers, constraints, and sequence sync utility
npm run db:init

# 2. Safely initialize facility configuration (3 slot types & 24 physical spaces)
# Note: Safe and idempotent. Preserves existing operational tickets and customer records.
npm run db:seed

# Optional: Populate realistic demo owners, vehicles, valet staff, and sample tickets
npm run seed:demo
```

*(Note on Development Reset: To perform an intentional, destructive reset during local development, use `npm run db:reset`. This command contains strict safeguards that refuse to execute in production).*

### Step 4: Train Model and Generate Forecasts
```powershell
# 1. Train the HistGradientBoosting occupancy model on 35.7K Birmingham observations
npm run ml:train

# 2. Generate 24-hour horizon forecasts across facility slot types and persist to PostgreSQL
npm run ml:predict
```

### Step 5: Verify Automated Test Suite & Build Frontend
```powershell
# Run complete automated backend test suite (24 test suites covering ACID, ML, pricing, sequences, packaging)
npm test

# Build frontend production bundle with Vite
npm run build:client
```

### Step 6: Start Application Servers
**Terminal 1 (Backend API):**
```powershell
npm run server
```
*API runs at `http://localhost:5000` (Health Check: `http://localhost:5000/api/health`)*

**Terminal 2 (Frontend Client):**
```powershell
npm run client
```
*Frontend runs at `http://localhost:5174`*

---

## 4. REST API Reference

### System Health & Status
* `GET /api/health`: Returns cluster status, database connection state, and hypertable metrics.

### Facility Dashboard & Analytics
* `GET /api/dashboard/summary`: Returns live capacity counts, slot distribution, and revenue summary.
* `GET /api/analytics/daily`: Mathematically derived daily occupancy from stay duration intervals.
* `GET /api/analytics/hourly`: Hourly average, peak, and minimum occupancy in latest chronological order.
* `GET /api/analytics/continuous-aggregate`: Prematerialized TimescaleDB continuous aggregate rollups.

### Machine Learning & Dynamic Pricing
* `GET /api/predictions/status`: Returns trained ML model card, validation MAE/RMSE, and active status.
* `POST /api/predictions/generate`: Triggers model inference to compute fresh 24h forecasts and store in DB.
* `GET /api/predictions/occupancy`: Returns persisted in-database occupancy horizon forecasts.
* `GET /api/predictions/pricing`: Returns facility dynamic pricing recommendations derived from forecasts.
* `GET /api/sfpark/pricing-recommendations`: SFpark 4-band dynamic pricing adjustment engine.

### Parking Space Allocation & Management
* `GET /api/slots`: List physical parking spaces with current occupancy status.
* `POST /api/slots`: Create parking slot with synchronized identifier generation.
* `GET /api/slots/recommendation`: Recommends optimal space based on vehicle powertrain and dimensions.
* `POST /api/slots/recommend`: POST endpoint for vehicle-to-slot recommendation matching.
* `PUT /api/slots/:id/status`: Update slot status (`Available`, `Occupied`, `Reserved`).

### Operational Tickets and Billing Lifecycle
* `GET /api/tickets`: List operational tickets (`status=active` or `status=completed`).
* `POST /api/tickets`: Atomically allocate slot and open ticket (`{ vehicle_no, slot_id, staff_id }`). Protected by row level locking and partial unique indexes.
* `POST /api/tickets/:id/close`: Close ticket, calculate stay amount (`CEIL` hours * base rate), stamp exit timestamp, and release slot to Available.

---

## 5. Automated Test Suite (24 Passing Test Suites)

The integration test suite (`tests/backend.test.js`) executes against the live database and validates all system invariants:

1. **Fresh Database Initialization & TimescaleDB Connectivity**: Confirms PostgreSQL 16 + TimescaleDB 2.30 and verifies registered hypertables.
2. **Dashboard Summary API**: Validates live metrics, slot counts, and capacity calculations.
3. **Owner CRUD & Input Validation**: Tests creation, validation errors, update, and clean deletion.
4. **Vehicle Registration**: Enforces valid foreign key references to owners.
5. **Ticket Lifecycle & Availability Check**: Validates slot locking, duplicate booking rejection (HTTP 409), duplicate active vehicle ticket rejection (HTTP 409), duration billing calculation, 1-hour minimum charge, and double close rejection.
6. **Concurrent Slot Allocation Protection (Different Vehicles, Same Slot)**: Launches simultaneous concurrent allocation requests on the exact same slot; asserts that exactly one succeeds (201) and the competing request is rejected (409 Conflict).
7. **Concurrent Duplicate Vehicle Requests (Same Vehicle, Different Slots)**: Asserts that two concurrent booking requests for the same vehicle targeting different parking slots reject the duplicate with HTTP 409 Conflict (`VehicleAlreadyParked`).
8. **Ticket Reopening & Duplicate Ticket Closure Rejection**: Asserts double-close attempts return HTTP 400 `AlreadyClosed`.
9. **Exact Hourly Occupancy Math & Deterministic Fixtures**: Validates mathematically derived hourly metrics on known fixtures (e.g. 4 slots with 15m + 30m non-overlapping tickets yields exact 18.75% avg, 25.0% peak, 0.0% min).
10. **Exact Daily Occupancy Values & Zero-Ticket Date Preservation**: Validates continuous multi-day calendar range generation where empty dates return 0.0% occupancy without being omitted.
11. **Multi-Day Ticket Spanning Midnight Interval Splitting**: Validates exact stay duration splitting across midnight into distinct calendar days using the complete facility capacity denominator (`total_slots * 24.0`).
12. **Missing Hourly Observations & Disjoint Interval Handling**: Validates empty-hour handling, true minimum occupancy reaching 0.0% during unoccupied gaps, and true peak occupancy.
13. **Correct Recent Time Window Selection & Chronological Order**: Validates ascending chronological ordering of analytical series.
14. **SFpark 4-Band Dynamic Pricing Boundary Tests**: Validates exact pricing adjustments across 0%, 29.99%, 30%, 59.99%, 60%, 80%, 80.01%, 100%, and the $0.25 minimum rate floor.
15. **Facility Dynamic Pricing Policy Verification**: Validates 4-tier elasticity curve in ₹ INR (+20% surge, 0% standard, -10% incentive, -20% off-peak) and rejects invalid inputs.
16. **Identifier Sequence Synchronization & Additional Slot Creation**: Validates that inserting records after explicit seed IDs does not cause primary key conflicts.
17. **Safe SQL & JavaScript Seeding Preservation**: Validates that executing both `scripts/seed.js` and `sql/seed.sql` against a database with an active ticket preserves the `Occupied` status and never resets it to `Available`.
18. **Time Series Lag Feature Exact Timestamp Alignment**: Verifies that `lag_1h` is strictly $t - 1\text{h}$ and `lag_24h` is strictly $t - 24\text{h}$.
19. **Prevention of Future Information Leakage During Model Validation**: Verifies chronological train/test split occurred before preprocessing, and holdout evaluation was conducted exclusively on 148 genuine observed targets.
20. **Machine Learning Model Artifacts, Scikit-Learn Alignment & Live Inference**: Validates model persistence, Scikit-Learn 1.9.0 runtime alignment, multi-horizon forecast generation (+1h, +2h, +4h, etc.), and in-database storage with transaction rollback safety.
21. **Operational Forecasting vs Historical Demonstration Mode Handling**: Asserts that operational forecasting without live telemetry returns `INSUFFICIENT_CURRENT_DATA` instead of fabricating observations.
22. **Real World Hypertable Continuous Aggregates**: Executes analytical queries on both Birmingham (35.7K) and SFpark (7.9M) continuous aggregates.
23. **Dataset Import Manifest Audit Log & Overwrite Safeguards**: Confirms audit log entries with verified SHA256 checksums, exact row counts, and production overwrite safeguards.
24. **Secret Protection, Distribution Package Hygiene & Release Packaging**: Verifies `.env` is excluded by git, and release packaging script creates a clean distribution zip excluding all secrets and temporary assets.

Run the test suite at any time:
```powershell
npm test
```

---

## 6. Academic Deliverables & Platform Separation

- **Academic Specification:** Detailed in `docs/assessment_report.md` with Boyce-Codd Normal Form (BCNF) proofs, functional dependency analysis, and EER diagrams.
- **Oracle PL/SQL Implementation:** Maintained as an academic comparison artifact (`Da2.PDF`). Demonstrates traditional PL/SQL triggers, packages, and sequences.
- **TimescaleDB / PostgreSQL Application:** The live production enterprise application in this repository. Demonstrates time-series hypertables, continuous aggregates, partial unique indexes, row locking, and scikit-learn machine learning forecasting.