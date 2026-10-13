import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { app } from '../server/src/app.js';
import { pool, query } from '../server/src/db/index.js';
import { calculateIntervalMetrics, calculateDailyIntervalMetrics } from '../server/src/controllers/analyticsController.js';
import { calculateFacilityPricingAdjustment } from '../server/src/services/pricingService.js';
import { safeSeed } from '../scripts/seed.js';

let server;
let baseUrl;

let testOwnerId = null;
let testVehicleNo1 = 'TEST-VEH-01';
let testVehicleNo2 = 'TEST-VEH-02';
let testStaffId = null;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      console.log(`Test server running on ${baseUrl}`);
      resolve();
    });
  });

  const ownerRes = await query(`
    INSERT INTO owners (name, phone, email)
    VALUES ('Automated Test Owner', '9998887776', 'test_fixture@valettrack.internal')
    RETURNING owner_id;
  `);
  testOwnerId = ownerRes.rows[0].owner_id;

  await query(`
    INSERT INTO vehicles (vehicle_no, type, color, owner_id)
    VALUES 
      ($1, 'Sedan', 'Silver', $2),
      ($3, 'SUV', 'Black', $2);
  `, [testVehicleNo1, testOwnerId, testVehicleNo2]);

  const staffRes = await query(`
    INSERT INTO valet_staff (name, phone, shift_timing)
    VALUES ('Test Staff Member', '9998880001', 'Morning (06:00 - 14:00)')
    RETURNING staff_id;
  `);
  testStaffId = staffRes.rows[0].staff_id;
});

after(async () => {
  try {
    if (testVehicleNo1 && testVehicleNo2) {
      await query(`DELETE FROM tickets WHERE vehicle_no IN ($1, $2);`, [testVehicleNo1, testVehicleNo2]);
      await query(`DELETE FROM vehicles WHERE vehicle_no IN ($1, $2);`, [testVehicleNo1, testVehicleNo2]);
    }
    if (testOwnerId) {
      await query(`DELETE FROM owners WHERE owner_id = $1;`, [testOwnerId]);
    }
    if (testStaffId) {
      await query(`DELETE FROM valet_staff WHERE staff_id = $1;`, [testStaffId]);
    }
  } catch (err) {
    console.error('Fixture cleanup error:', err.message);
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

test('1. Health Check Endpoint & TimescaleDB Connectivity', async () => {
  const res = await request('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'UP');
  assert.equal(res.data.database.connected, true);
  assert.equal(res.data.database.type, 'TimescaleDB / PostgreSQL');
  assert.ok(res.data.database.hypertables >= 2, 'Should have hypertables registered');
});

test('2. Dashboard Summary API Returns Database-Backed Statistics', async () => {
  const res = await request('/api/dashboard/summary');
  assert.equal(res.status, 200);
  assert.ok(res.data.metrics.totalSlots >= 24, 'Total slots should be at least 24');
  assert.ok(res.data.metrics.occupancyPercentage >= 0 && res.data.metrics.occupancyPercentage <= 100);
  assert.equal(res.data.slotTypeBreakdown.length, 3, 'Should have 3 slot types');
  assert.ok(Array.isArray(res.data.recentActivity));
});

test('3. Owner CRUD & Input Validation', async () => {
  const badRes = await request('/api/owners', {
    method: 'POST',
    body: JSON.stringify({ name: 'A', email: 'not-an-email', phone: '12' })
  });
  assert.equal(badRes.status, 400);

  const testPhone = `999${Date.now().toString().slice(-7)}`;
  const testEmail = `test_${Date.now()}@test.com`;
  const createRes = await request('/api/owners', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Integration Test User',
      phone: testPhone,
      email: testEmail
    })
  });
  assert.equal(createRes.status, 201);
  const createdId = createRes.data.owner_id;
  assert.ok(createdId);

  const getRes = await request(`/api/owners/${createdId}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.data.name, 'Integration Test User');

  const updateRes = await request(`/api/owners/${createdId}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Integration User Updated',
      phone: testPhone,
      email: testEmail
    })
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.data.name, 'Integration User Updated');

  const delRes = await request(`/api/owners/${createdId}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
});

test('4. Vehicle Registration & Owner Reference Validation', async () => {
  // Nonexistent owner must be rejected
  const badRes = await request('/api/vehicles', {
    method: 'POST',
    body: JSON.stringify({
      vehicle_no: 'XX99ZZ9999',
      type: 'Sedan',
      color: 'Silver',
      owner_id: 999999
    })
  });
  assert.equal(badRes.status, 400);
});

test('5. Ticket Lifecycle: Open Ticket, Availability Check, Slot Locking & Billing', async () => {
  const slotsRes = await request('/api/slots');
  const availSlot = slotsRes.data.find(s => s.status === 'Available');
  assert.ok(availSlot, 'Should find at least one available parking slot');

  const openRes = await request('/api/tickets', {
    method: 'POST',
    body: JSON.stringify({
      vehicle_no: testVehicleNo1,
      slot_id: availSlot.slot_id,
      staff_id: testStaffId
    })
  });
  assert.equal(openRes.status, 201);
  const ticketId = openRes.data.ticket.ticket_id;
  assert.ok(ticketId);

  // Verify slot is now locked as Occupied
  const slotAfter = await request(`/api/slots/${availSlot.slot_id}`);
  assert.equal(slotAfter.data.status, 'Occupied');

  // Attempt to allocate the same slot again concurrently (Must fail with 409 Conflict)
  const duplicateSlotRes = await request('/api/tickets', {
    method: 'POST',
    body: JSON.stringify({
      vehicle_no: testVehicleNo2,
      slot_id: availSlot.slot_id,
      staff_id: testStaffId
    })
  });
  assert.equal(duplicateSlotRes.status, 409, 'Duplicate slot booking must return 409 Conflict');

  // Attempt to allocate another slot for testVehicleNo1 (Single vehicle multiple active ticket prevention)
  const otherSlot = slotsRes.data.find(s => s.status === 'Available' && s.slot_id !== availSlot.slot_id);
  if (otherSlot) {
    const duplicateVehicleRes = await request('/api/tickets', {
      method: 'POST',
      body: JSON.stringify({
        vehicle_no: testVehicleNo1,
        slot_id: otherSlot.slot_id,
        staff_id: testStaffId
      })
    });
    assert.equal(duplicateVehicleRes.status, 409, 'Vehicle with active ticket cannot book another slot');
    assert.equal(duplicateVehicleRes.data.code, 'VehicleAlreadyParked');
  }

  const closeRes = await request(`/api/tickets/${ticketId}/close`, { method: 'POST' });
  assert.equal(closeRes.status, 200);
  assert.ok(closeRes.data.billing.billableHours >= 1, 'Minimum 1 hour billing must apply');
  assert.ok(closeRes.data.billing.amountPaid >= availSlot.base_rate);
  assert.equal(parseFloat(closeRes.data.ticket.amount_paid), closeRes.data.billing.amountPaid);

  // Slot should now be released back to Available
  const slotReleased = await request(`/api/slots/${availSlot.slot_id}`);
  assert.equal(slotReleased.data.status, 'Available');

  // Double close rejection (Must fail with AlreadyClosed)
  const doubleCloseRes = await request(`/api/tickets/${ticketId}/close`, { method: 'POST' });
  assert.equal(doubleCloseRes.status, 400);
  assert.equal(doubleCloseRes.data.error, 'AlreadyClosed');
});

test('6. Concurrent Slot Allocation Protection', async () => {
  const slotsRes = await request('/api/slots');
  const targetSlot = slotsRes.data.find(s => s.status === 'Available');
  assert.ok(targetSlot);

  // Launch two simultaneous requests to allocate the exact same slot
  const [req1, req2] = await Promise.all([
    request('/api/tickets', {
      method: 'POST',
      body: JSON.stringify({ vehicle_no: testVehicleNo1, slot_id: targetSlot.slot_id, staff_id: testStaffId })
    }),
    request('/api/tickets', {
      method: 'POST',
      body: JSON.stringify({ vehicle_no: testVehicleNo2, slot_id: targetSlot.slot_id, staff_id: testStaffId })
    })
  ]);

  // Exactly one request must succeed (201) and one must be rejected (409 Conflict)
  const successes = [req1, req2].filter(r => r.status === 201);
  const rejections = [req1, req2].filter(r => r.status === 409 || r.status === 400);

  assert.equal(successes.length, 1, 'Exactly one concurrent request should acquire the slot');
  assert.equal(rejections.length, 1, 'The competing concurrent request must be rejected');

  const createdTicketId = successes[0].data.ticket.ticket_id;
  await request(`/api/tickets/${createdTicketId}/close`, { method: 'POST' });
});

test('7. Analytics: Real TimescaleDB Continuous Aggregates & Rate Analysis', async () => {
  const aggRes = await request('/api/analytics/continuous-aggregate');
  assert.equal(aggRes.status, 200);
  assert.ok(Array.isArray(aggRes.data));
  assert.ok(aggRes.data.length > 0, 'Should return real continuous aggregate rollups');

  const pricingPredRes = await request('/api/analytics/pricing-predictions');
  assert.equal(pricingPredRes.status, 200);
  assert.ok(Array.isArray(pricingPredRes.data), 'Must return array of pricing predictions');
  assert.ok(pricingPredRes.data.length > 0, 'Pricing predictions table contains real rows');

  const realPricingRes = await request('/api/sfpark/pricing-analysis');
  assert.equal(realPricingRes.status, 200);
  assert.ok(realPricingRes.data.rateTiers.length > 0);
  assert.ok(realPricingRes.data.districtPricing.length > 0);

  const recRes = await request('/api/sfpark/pricing-recommendations');
  assert.equal(recRes.status, 200);
  assert.ok(recRes.data.recommendations.length > 0);
  assert.ok(recRes.data.methodology.includes('Dynamic Pricing Policy'));
});

test('8. Real world Birmingham and SFpark Hypertable Queries', async () => {
  const bhamRes = await request('/api/birmingham/summary');
  assert.equal(bhamRes.status, 200);
  assert.equal(parseInt(bhamRes.data.summary.total_readings, 10), 35717);
  assert.equal(parseInt(bhamRes.data.summary.total_carparks, 10), 30);
  assert.ok(bhamRes.data.summary.continuous_aggregate_count > 0);

  const sfRes = await request('/api/sfpark/summary');
  assert.equal(sfRes.status, 200);
  const sfCount = parseInt(sfRes.data.summary.total_readings, 10);
  assert.ok(sfCount >= 50000, 'SFpark must contain real loaded dataset records');
  assert.ok(sfRes.data.districts.length > 0);
});

test('9. Dataset Import Manifest Audit Log Verification', async () => {
  const manifestRes = await request('/api/datasets/manifest');
  assert.equal(manifestRes.status, 200);
  assert.ok(Array.isArray(manifestRes.data));
  assert.ok(manifestRes.data.length >= 2, 'Should have manifests for Birmingham and SFpark');

  const bham = manifestRes.data.find(m => m.dataset_name === 'Birmingham 2016');
  assert.ok(bham);
  assert.equal(parseInt(bham.source_rows_processed, 10), 35717);
  assert.equal(parseInt(bham.rows_imported, 10), 35717);
  assert.equal(bham.status, 'COMPLETED');

  const sfpark = manifestRes.data.find(m => m.dataset_name === 'SFpark 2011-2013' && m.status === 'COMPLETED');
  assert.ok(sfpark, 'Should have completed SFpark full import manifest');
  assert.equal(parseInt(sfpark.source_rows_processed, 10), 7902291);
  assert.equal(parseInt(sfpark.rows_imported, 10), 7902290);
});

test('10. SFpark 4-Band Dynamic Pricing Policy Boundary Tests', async () => {
  // Test occupancy at 0, 29.99, 30, 59.99, 60, 80, 80.01, 100 percent
  const cases = [
    { occ: 0, expectedAdj: -0.50, action: 'Underutilized' },
    { occ: 29.99, expectedAdj: -0.50, action: 'Underutilized' },
    { occ: 30, expectedAdj: -0.25, action: 'Off-Peak' },
    { occ: 59.99, expectedAdj: -0.25, action: 'Off-Peak' },
    { occ: 60, expectedAdj: 0.00, action: 'Target Equilibrium' },
    { occ: 80, expectedAdj: 0.00, action: 'Target Equilibrium' },
    { occ: 80.01, expectedAdj: 0.25, action: 'Demand Surge' },
    { occ: 100, expectedAdj: 0.25, action: 'Demand Surge' }
  ];

  for (const c of cases) {
    const res = await request(`/api/sfpark/pricing-recommendations?occupancy_pct=${c.occ}&base_rate=2.00`);
    assert.equal(res.status, 200);
    assert.equal(res.data.evaluation.adjustment, c.expectedAdj, `Occupancy ${c.occ}% should yield adjustment ${c.expectedAdj}`);
    assert.ok(res.data.evaluation.policyAction.includes(c.action), `Occupancy ${c.occ}% action should contain ${c.action}`);
  }

  // Rate floor test: rate cannot drop below $0.25
  const floorRes = await request(`/api/sfpark/pricing-recommendations?occupancy_pct=10&base_rate=0.50`);
  assert.equal(floorRes.status, 200);
  assert.equal(floorRes.data.evaluation.adjusted_rate, 0.25, 'Rate floor of $0.25 must be enforced');
});

test('11. Machine Learning Forecaster & Prediction Endpoints', async () => {
  const statusRes = await request('/api/predictions/status');
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.data.model_status, 'ACTIVE');
  assert.equal(statusRes.data.metadata.algorithm, 'HistGradientBoostingRegressor');
  assert.ok(statusRes.data.metadata.metrics.mae <= 3.5, 'Validation MAE must be <= 3.5%');

  const occRes = await request('/api/predictions/occupancy');
  assert.equal(occRes.status, 200);
  assert.ok(Array.isArray(occRes.data));
  assert.ok(occRes.data.length > 0, 'Should return active horizon forecasts');

  const pricingRes = await request('/api/predictions/pricing');
  assert.equal(pricingRes.status, 200);
  assert.ok(Array.isArray(pricingRes.data));
  assert.ok(pricingRes.data.length > 0, 'Should return pricing recommendations based on predictions');
});

test('12. Automated Slot Allocation Recommendation Service', async () => {
  // Recommendation for EV
  const evRes = await request('/api/slots/recommendation?vehicle_type=EV');
  assert.equal(evRes.status, 200);
  assert.ok(evRes.data.recommendedSlot, 'Should recommend a slot for EV');
  assert.equal(evRes.data.recommendedSlot.slot_type_name, 'EVCharging', 'EV should be matched to EVCharging slot');
  assert.ok(evRes.data.rationale.includes('Electric Vehicle'));

  // Recommendation for SUV
  const suvRes = await request('/api/slots/recommendation?vehicle_type=SUV');
  assert.equal(suvRes.status, 200);
  assert.ok(suvRes.data.recommendedSlot, 'Should recommend a slot for SUV');
  assert.equal(suvRes.data.recommendedSlot.slot_type_name, 'Covered', 'SUV should be matched to Covered slot');

  // Verify recommended slot is Available
  assert.equal(evRes.data.recommendedSlot.status, 'Available');
});

test('13. Identifier Sequence Synchronization & Additional Slot Creation', async () => {
  const uniqueSlotNumber = `T-SLOT-${Date.now().toString().slice(-4)}`;
  const createSlotRes = await request('/api/slots', {
    method: 'POST',
    body: JSON.stringify({
      slot_number: uniqueSlotNumber,
      slot_type_id: 1,
      floor: 2
    })
  });

  assert.equal(createSlotRes.status, 201, 'New slot creation must succeed after sequence sync');
  assert.ok(createSlotRes.data.slot.slot_id > 24, 'New slot identifier should be greater than initial seed IDs');

  // Cleanup created slot
  await query(`DELETE FROM parking_slots WHERE slot_id = $1`, [createSlotRes.data.slot.slot_id]);
});

test('14. Daily and Hourly Occupancy Calculations Accuracy & Deterministic Interval Fixtures', async () => {
  const dailyRes = await request('/api/analytics/daily');
  assert.equal(dailyRes.status, 200);
  assert.ok(Array.isArray(dailyRes.data));

  const hourlyRes = await request('/api/analytics/hourly?hours=24');
  assert.equal(hourlyRes.status, 200);
  assert.ok(Array.isArray(hourlyRes.data));
  hourlyRes.data.forEach(h => {
    const avg = parseFloat(h.avg_occupancy_pct || h.avg_occupancy) || 0;
    const peak = parseFloat(h.peak_occupancy_pct || h.peak_occupancy) || 0;
    const min = parseFloat(h.min_occupancy_pct || h.min_occupancy) || 0;
    assert.ok(avg >= 0 && avg <= 100);
    assert.ok(peak >= avg, `Peak occupancy (${peak}) must be >= average occupancy (${avg})`);
    assert.ok(min <= avg, `Min occupancy (${min}) must be <= average occupancy (${avg})`);
  });

  // Deterministic Fixture 1: Two consecutive 30-min tickets in 1-hour window on 2-slot capacity
  // 10:00 - 10:30 (0.5h) and 10:30 - 11:00 (0.5h)
  // Total occupied slot-hours = 1.0; Capacity = 2 * 1.0 = 2.0 slot-hours
  // Expected Avg = 50.0%; Max simultaneous active tickets = 1; Peak = 50.0%; Min simultaneous = 1; Min = 50.0%
  const f1 = calculateIntervalMetrics(
    new Date('2026-10-10T10:00:00Z'),
    new Date('2026-10-10T11:00:00Z'),
    2,
    [
      { entry: '2026-10-10T10:00:00Z', exit: '2026-10-10T10:30:00Z' },
      { entry: '2026-10-10T10:30:00Z', exit: '2026-10-10T11:00:00Z' }
    ]
  );
  assert.equal(f1.occupiedHours, 1.0, 'Fixture 1 occupied slot-hours must be exactly 1.0');
  assert.equal(f1.avgOccupancy, 50.0, 'Fixture 1 average occupancy must be exactly 50.0%');
  assert.equal(f1.maxSimultaneous, 1, 'Fixture 1 max simultaneous tickets must be exactly 1');
  assert.equal(f1.peakOccupancy, 50.0, 'Fixture 1 peak occupancy must be exactly 50.0%');
  assert.equal(f1.minSimultaneous, 1, 'Fixture 1 min simultaneous tickets must be exactly 1');
  assert.equal(f1.minOccupancy, 50.0, 'Fixture 1 min occupancy must be exactly 50.0%');

  // Deterministic Fixture 2: Concurrent overlapping tickets on 2-slot capacity
  // Ticket 1: 09:30 - 11:30 (1.0h within 10:00-11:00)
  // Ticket 2: 10:15 - 10:45 (0.5h within 10:00-11:00)
  // Total occupied slot-hours = 1.5; Capacity = 2.0; Expected Avg = 75.0%
  // During 10:15-10:45, both tickets are active simultaneously: Max simultaneous = 2; Peak = 100.0%
  // During 10:00-10:15 and 10:45-11:00, 1 ticket active: Min simultaneous = 1; Min = 50.0%
  const f2 = calculateIntervalMetrics(
    new Date('2026-10-10T10:00:00Z'),
    new Date('2026-10-10T11:00:00Z'),
    2,
    [
      { entry: '2026-10-10T09:30:00Z', exit: '2026-10-10T11:30:00Z' },
      { entry: '2026-10-10T10:15:00Z', exit: '2026-10-10T10:45:00Z' }
    ]
  );
  assert.equal(f2.occupiedHours, 1.5, 'Fixture 2 occupied slot-hours must be exactly 1.5');
  assert.equal(f2.avgOccupancy, 75.0, 'Fixture 2 average occupancy must be exactly 75.0%');
  assert.equal(f2.maxSimultaneous, 2, 'Fixture 2 max simultaneous tickets must be exactly 2');
  assert.equal(f2.peakOccupancy, 100.0, 'Fixture 2 peak occupancy must be exactly 100.0%');
  assert.equal(f2.minSimultaneous, 1, 'Fixture 2 min simultaneous tickets must be exactly 1');
  assert.equal(f2.minOccupancy, 50.0, 'Fixture 2 min occupancy must be exactly 50.0%');
});

test('15. Multi-Day Ticket Spanning Midnight Interval Splitting & Capacity Denominator', async () => {
  // Query total physical slots for Regular slot type (type_id = 1)
  const capRes = await query(`SELECT COUNT(*)::int as count FROM parking_slots WHERE slot_type_id = 1;`);
  const regularTotalSlots = capRes.rows[0].count;
  assert.ok(regularTotalSlots > 0);

  // Insert a deterministic fixture ticket spanning midnight:
  // Starts 2026-10-10 22:00:00 UTC, Ends 2026-10-11 06:00:00 UTC (8 hours total)
  // Day 1 (2026-10-10): exactly 2.0 occupied hours (22:00 to 24:00)
  // Day 2 (2026-10-11): exactly 6.0 occupied hours (00:00 to 06:00)
  const insertTicket = await query(`
    INSERT INTO tickets (vehicle_no, slot_id, staff_id, entry_time, exit_time, amount_paid)
    VALUES ($1, 1, $2, '2026-10-10 22:00:00+00', '2026-10-11 06:00:00+00', 400.00)
    RETURNING ticket_id;
  `, [testVehicleNo1, testStaffId]);
  const fixtureTicketId = insertTicket.rows[0].ticket_id;

  try {
    const dailyRes = await request('/api/analytics/daily?slot_type_id=1&start_date=2026-10-10T00:00:00Z&end_date=2026-10-11T23:59:59Z');
    assert.equal(dailyRes.status, 200);
    assert.ok(Array.isArray(dailyRes.data));

    const day1 = dailyRes.data.find(d => new Date(d.date).toISOString().startsWith('2026-10-10'));
    const day2 = dailyRes.data.find(d => new Date(d.date).toISOString().startsWith('2026-10-11'));

    assert.ok(day1, 'Day 1 (2026-10-10) must be present in daily analytics');
    assert.ok(day2, 'Day 2 (2026-10-11) must be present in daily analytics');

    // Exact interval split checks
    assert.equal(parseFloat(day1.occupied_hours), 2.0, 'Day 1 must contain exactly 2.0 occupied hours');
    assert.equal(parseFloat(day2.occupied_hours), 6.0, 'Day 2 must contain exactly 6.0 occupied hours');

    // Denominator checks: must use complete capacity denominator (regularTotalSlots * 24.0)
    assert.equal(day1.total_slots, regularTotalSlots, 'Daily denominator must use complete slot capacity, not 1');
    assert.equal(day2.total_slots, regularTotalSlots, 'Daily denominator must use complete slot capacity, not 1');

    const expectedDay1Pct = Number(((2.0 / (regularTotalSlots * 24.0)) * 100.0).toFixed(1));
    const expectedDay2Pct = Number(((6.0 / (regularTotalSlots * 24.0)) * 100.0).toFixed(1));

    assert.equal(parseFloat(day1.occupancy_percentage), expectedDay1Pct, `Day 1 occupancy must be ${expectedDay1Pct}%`);
    assert.equal(parseFloat(day2.occupancy_percentage), expectedDay2Pct, `Day 2 occupancy must be ${expectedDay2Pct}%`);
  } finally {
    await query(`DELETE FROM tickets WHERE ticket_id = $1;`, [fixtureTicketId]);
  }
});

test('16. Missing Hourly Observations & Disjoint Interval Handling', async () => {
  // Scenario A: Completely empty hour (zero tickets active)
  const emptyMetrics = calculateIntervalMetrics(
    new Date('2026-10-10T14:00:00Z'),
    new Date('2026-10-10T15:00:00Z'),
    4,
    []
  );
  assert.equal(emptyMetrics.occupiedHours, 0.0);
  assert.equal(emptyMetrics.avgOccupancy, 0.0);
  assert.equal(emptyMetrics.peakOccupancy, 0.0);
  assert.equal(emptyMetrics.minOccupancy, 0.0);
  assert.equal(emptyMetrics.maxSimultaneous, 0);
  assert.equal(emptyMetrics.minSimultaneous, 0);

  // Scenario B: Disjoint tickets with an unmonitored / unoccupied gap in between
  // 10:00 - 10:20 (20 min) and 10:40 - 11:00 (20 min) on capacity 2
  // Total = 40 min = 0.67 slot-hours; Capacity = 2.0 hr
  // Expected Avg = (0.667 / 2.0) * 100 = 33.3%
  // During 10:20 - 10:40, active count = 0 => True minimum occupancy must be 0.0%
  // Maximum active simultaneously = 1 => Peak occupancy = 50.0%
  const gapMetrics = calculateIntervalMetrics(
    new Date('2026-10-10T10:00:00Z'),
    new Date('2026-10-10T11:00:00Z'),
    2,
    [
      { entry: '2026-10-10T10:00:00Z', exit: '2026-10-10T10:20:00Z' },
      { entry: '2026-10-10T10:40:00Z', exit: '2026-10-10T11:00:00Z' }
    ]
  );
  assert.equal(gapMetrics.avgOccupancy, 33.3, 'Disjoint interval average occupancy must be exactly 33.3%');
  assert.equal(gapMetrics.peakOccupancy, 50.0, 'Disjoint interval peak occupancy must be exactly 50.0%');
  assert.equal(gapMetrics.minOccupancy, 0.0, 'Disjoint interval true minimum occupancy must be 0.0% during the gap');
  assert.equal(gapMetrics.maxSimultaneous, 1);
  assert.equal(gapMetrics.minSimultaneous, 0);
});

test('17. Concurrent Duplicate Vehicle Requests Across Different Parking Spaces', async () => {
  const slotsRes = await request('/api/slots');
  const availableSlots = slotsRes.data.filter(s => s.status === 'Available');
  assert.ok(availableSlots.length >= 2, 'Need at least 2 available slots for concurrent vehicle test');

  const slotA = availableSlots[0];
  const slotB = availableSlots[1];

  // Simultaneously attempt to park the SAME vehicle in two different parking slots
  const [resA, resB] = await Promise.all([
    request('/api/tickets', {
      method: 'POST',
      body: JSON.stringify({ vehicle_no: testVehicleNo1, slot_id: slotA.slot_id, staff_id: testStaffId })
    }),
    request('/api/tickets', {
      method: 'POST',
      body: JSON.stringify({ vehicle_no: testVehicleNo1, slot_id: slotB.slot_id, staff_id: testStaffId })
    })
  ]);

  const successes = [resA, resB].filter(r => r.status === 201);
  const conflicts = [resA, resB].filter(r => r.status === 409);

  assert.equal(successes.length, 1, 'Exactly one concurrent booking for the same vehicle must succeed');
  assert.equal(conflicts.length, 1, 'The competing concurrent booking for the same vehicle must fail with 409 Conflict');
  assert.equal(conflicts[0].data.code, 'VehicleAlreadyParked', 'Rejected request must return VehicleAlreadyParked');

  // Cleanup: close the winning ticket
  const ticketId = successes[0].data.ticket.ticket_id;
  await request(`/api/tickets/${ticketId}/close`, { method: 'POST' });
});

test('18. Facility Dynamic Pricing Policy Verification (INR, ₹ & 4-Tier Elasticity)', async () => {
  // Test unit function across all 4 documented tiers
  // Base rates: Regular ₹50, Covered ₹80, EV ₹120

  // Tier 1: > 80% (+20% Surge)
  const surge = calculateFacilityPricingAdjustment(85.0, 'Regular', 50.00);
  assert.equal(surge.multiplier, 1.20);
  assert.equal(surge.recommendedRate, 60.00);
  assert.equal(surge.currency, 'INR');
  assert.equal(surge.currencySymbol, '₹');

  // Tier 2: 60% - 80% (Standard Equilibrium)
  const std = calculateFacilityPricingAdjustment(72.0, 'Covered', 80.00);
  assert.equal(std.multiplier, 1.00);
  assert.equal(std.recommendedRate, 80.00);
  assert.equal(std.adjustment, 0.00);

  // Tier 3: 30% - <60% (-10% Incentive)
  const inc = calculateFacilityPricingAdjustment(45.0, 'EVCharging', 120.00);
  assert.equal(inc.multiplier, 0.90);
  assert.equal(inc.recommendedRate, 108.00);
  assert.equal(inc.adjustment, -12.00);

  // Tier 4: < 30% (-20% Off-Peak Discount)
  const disc = calculateFacilityPricingAdjustment(15.0, 'Regular', 50.00);
  assert.equal(disc.multiplier, 0.80);
  assert.equal(disc.recommendedRate, 40.00);
  assert.equal(disc.adjustment, -10.00);

  // Test Facility Pricing API Endpoint
  const apiRes = await request('/api/analytics/facility-pricing-recommendations');
  assert.equal(apiRes.status, 200);
  assert.equal(apiRes.data.currency, 'INR');
  assert.equal(apiRes.data.currencySymbol, '₹');
  assert.equal(apiRes.data.recommendations.length, 3);
  apiRes.data.recommendations.forEach(r => {
    assert.ok(r.baselineRate > 0);
    assert.ok(r.recommendedRate > 0);
    assert.ok(r.policyAction);
  });
});

test('19. Safe SQL and JavaScript Seeding Preservation of Active Ticket Slot Status', async () => {
  // Allocate slot 1 with an active ticket
  const openRes = await request('/api/tickets', {
    method: 'POST',
    body: JSON.stringify({ vehicle_no: testVehicleNo1, slot_id: 1, staff_id: testStaffId })
  });
  assert.equal(openRes.status, 201);
  const ticketId = openRes.data.ticket.ticket_id;

  try {
    // 1. Verify Slot 1 is Occupied
    let slot1 = await request('/api/slots/1');
    assert.equal(slot1.data.status, 'Occupied');

    // 2. Execute safe JavaScript seeding
    await safeSeed();

    // Verify Slot 1 is STILL Occupied (NOT overwritten to Available)
    slot1 = await request('/api/slots/1');
    assert.equal(slot1.data.status, 'Occupied', 'Repeating JavaScript seed must NOT reset occupied slot to Available');

    // 3. Execute pure SQL seed script (sql/seed.sql)
    const seedSqlPath = path.resolve('sql/seed.sql');
    const seedSql = fs.readFileSync(seedSqlPath, 'utf-8');
    await query(seedSql);

    // Verify Slot 1 is STILL Occupied (NOT overwritten to Available)
    slot1 = await request('/api/slots/1');
    assert.equal(slot1.data.status, 'Occupied', 'Repeating SQL seed must NOT reset occupied slot to Available');
  } finally {
    // Close ticket to restore clean test state
    await request(`/api/tickets/${ticketId}/close`, { method: 'POST' });
    const slot1After = await request('/api/slots/1');
    assert.equal(slot1After.data.status, 'Available', 'Slot reverts to Available upon ticket closure');
  }
});

test('20. Machine Learning Model Artifacts, Scikit-Learn Version Alignment & Inference Pipeline', async () => {
  const metadataPath = path.resolve('data/models/model_metadata.json');
  assert.ok(fs.existsSync(metadataPath), 'model_metadata.json must exist');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

  // Scikit-learn version alignment check
  assert.equal(metadata.algorithm, 'HistGradientBoostingRegressor');
  assert.ok(metadata.scikit_learn_version, 'Scikit-learn version must be recorded in metadata');
  assert.equal(metadata.scikit_learn_version, '1.9.0', 'Metadata scikit-learn version must align with runtime');

  // Reproduced metrics check
  assert.ok(metadata.metrics.validation_mae <= 3.5, 'Validation MAE must be <= 3.5%');
  assert.ok(
    metadata.metrics.validation_mae < metadata.metrics.baseline_persistence_mae,
    'Model must outperform 24h persistence baseline'
  );

  // Trigger live prediction inference via API
  const genRes = await request('/api/predictions/generate', { method: 'POST' });
  assert.equal(genRes.status, 201, 'POST /api/predictions/generate must succeed');
  assert.ok(genRes.data.occupancy_predictions.length > 0);
  assert.ok(genRes.data.pricing_predictions.length > 0);
  genRes.data.occupancy_predictions.forEach(p => {
    assert.ok(p.time_slot.includes('Horizon'), 'Time slot must identify forecast horizon');
  });

  // Query persisted occupancy horizon predictions
  const occRes = await request('/api/predictions/occupancy');
  assert.equal(occRes.status, 200);
  assert.ok(occRes.data.length >= 18);
  occRes.data.forEach(p => {
    assert.ok(p.time_slot, 'Time slot must be present');
    const val = parseFloat(p.predicted_occupancy);
    assert.ok(val >= 0 && val <= 100, 'Predicted occupancy must be bounded [0, 100]%');
  });

  // Query persisted pricing predictions
  const priceRes = await request('/api/predictions/pricing');
  assert.equal(priceRes.status, 200);
  assert.ok(priceRes.data.length >= 18);
  priceRes.data.forEach(p => {
    const rate = parseFloat(p.suggested_rate);
    assert.ok(rate > 0, 'Dynamic suggested rate must be positive');
  });
});


