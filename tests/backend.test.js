import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { app } from '../server/src/app.js';
import { pool, query } from '../server/src/db/index.js';
import { calculateIntervalMetrics, calculateDailyIntervalMetrics } from '../server/src/controllers/analyticsController.js';
import { calculateSFparkPricingAdjustment, calculateFacilityPricingAdjustment } from '../server/src/services/pricingService.js';
import { safeSeed } from '../scripts/seed.js';
import { packageRelease } from '../scripts/package_release.js';

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

// ==============================================================================
// 1. Database Infrastructure & Connectivity
// ==============================================================================

test('1. Fresh Database Initialization & TimescaleDB Connectivity', async () => {
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

// ==============================================================================
// 2. Relational Entity Management & Validation
// ==============================================================================

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

// ==============================================================================
// 3. Ticket Lifecycle & Concurrency Invariants
// ==============================================================================

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

  const closeRes = await request(`/api/tickets/${ticketId}/close`, { method: 'POST' });
  assert.equal(closeRes.status, 200);
  assert.ok(closeRes.data.billing.billableHours >= 1, 'Minimum 1 hour billing must apply');
  assert.ok(closeRes.data.billing.amountPaid >= availSlot.base_rate);
  assert.equal(parseFloat(closeRes.data.ticket.amount_paid), closeRes.data.billing.amountPaid);

  // Slot should now be released back to Available
  const slotReleased = await request(`/api/slots/${availSlot.slot_id}`);
  assert.equal(slotReleased.data.status, 'Available');
});

test('6. Concurrent Slot Allocation Protection (Different Vehicles, Same Slot)', async () => {
  const slotsRes = await request('/api/slots');
  const targetSlot = slotsRes.data.find(s => s.status === 'Available');
  assert.ok(targetSlot);

  // Launch two simultaneously competing requests to allocate the exact same slot
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

  const successes = [req1, req2].filter(r => r.status === 201);
  const rejections = [req1, req2].filter(r => r.status === 409 || r.status === 400);

  assert.equal(successes.length, 1, 'Exactly one concurrent request should acquire the slot');
  assert.equal(rejections.length, 1, 'The competing concurrent request must be rejected with 409 Conflict');

  const createdTicketId = successes[0].data.ticket.ticket_id;
  await request(`/api/tickets/${createdTicketId}/close`, { method: 'POST' });
});

test('7. Concurrent Duplicate Vehicle Requests Across Different Parking Spaces', async () => {
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

  const ticketId = successes[0].data.ticket.ticket_id;
  await request(`/api/tickets/${ticketId}/close`, { method: 'POST' });
});

test('8. Ticket Reopening & Duplicate Ticket Closure Rejection', async () => {
  const slotsRes = await request('/api/slots');
  const availSlot = slotsRes.data.find(s => s.status === 'Available');
  assert.ok(availSlot);

  const openRes = await request('/api/tickets', {
    method: 'POST',
    body: JSON.stringify({ vehicle_no: testVehicleNo1, slot_id: availSlot.slot_id, staff_id: testStaffId })
  });
  assert.equal(openRes.status, 201);
  const ticketId = openRes.data.ticket.ticket_id;

  const closeRes1 = await request(`/api/tickets/${ticketId}/close`, { method: 'POST' });
  assert.equal(closeRes1.status, 200);

  // Duplicate ticket closure rejection (Must fail with AlreadyClosed)
  const closeRes2 = await request(`/api/tickets/${ticketId}/close`, { method: 'POST' });
  assert.equal(closeRes2.status, 400);
  assert.equal(closeRes2.data.error, 'AlreadyClosed');
});

// ==============================================================================
// 4. Deterministic Hourly & Daily Occupancy Analytics Math
// ==============================================================================

test('9. Exact Hourly Occupancy: Time-Weighted Average, True Peak, and True Minimum Occupancy', async () => {
  // Scenario A: Mandatory 4-Slot Capacity Deterministic Fixture
  // 1 hour window (10:00 - 11:00 UTC) on 4 total slots.
  // Ticket A: 10:00 - 10:15 (15 min = 0.25h)
  // Ticket B: 10:30 - 11:00 (30 min = 0.50h)
  // Total occupied slot-hours = 0.25 + 0.50 = 0.75 slot-hours.
  // Capacity = 4 slots * 1.0 hr = 4.0 slot-hours.
  // Expected Time-Weighted Average = (0.75 / 4.0) * 100% = 18.75%!
  // Maximum active simultaneously = 1 (Tickets A and B do not overlap) => Peak = (1 / 4) * 100% = 25.0%!
  // Minimum active simultaneously = 0 (during unoccupied segment 10:15 - 10:30) => Min = 0.0%!
  const fix4 = calculateIntervalMetrics(
    new Date('2026-10-10T10:00:00Z'),
    new Date('2026-10-10T11:00:00Z'),
    4,
    [
      { entry: '2026-10-10T10:00:00Z', exit: '2026-10-10T10:15:00Z' },
      { entry: '2026-10-10T10:30:00Z', exit: '2026-10-10T11:00:00Z' }
    ]
  );
  assert.equal(fix4.occupiedHours, 0.75, '4-slot fixture occupied slot-hours must be exactly 0.75');
  assert.equal(fix4.avgOccupancy, 18.75, '4-slot fixture time-weighted average must be exactly 18.75%');
  assert.equal(fix4.maxSimultaneous, 1, 'Max simultaneous active tickets must be exactly 1');
  assert.equal(fix4.peakOccupancy, 25.0, 'Peak occupancy must be exactly 25.0%');
  assert.equal(fix4.minSimultaneous, 0, 'Min simultaneous active tickets during gap must be exactly 0');
  assert.equal(fix4.minOccupancy, 0.0, 'Minimum occupancy during gap must be exactly 0.0%');
  assert.ok(fix4.peakOccupancy !== fix4.avgOccupancy, 'Peak (25%) must differ from Average (18.75%)');
  assert.ok(fix4.minOccupancy !== fix4.avgOccupancy, 'Min (0%) must differ from Average (18.75%)');

  // Scenario B: Ticket spanning the ENTIRE hour on 2-slot capacity
  // 10:00 - 11:00 (1.0h on 2 slots) => Avg = 50.0%, Peak = 50.0%, Min = 50.0%
  const fullHour = calculateIntervalMetrics(
    new Date('2026-10-10T10:00:00Z'),
    new Date('2026-10-10T11:00:00Z'),
    2,
    [{ entry: '2026-10-10T10:00:00Z', exit: '2026-10-10T11:00:00Z' }]
  );
  assert.equal(fullHour.avgOccupancy, 50.0);
  assert.equal(fullHour.peakOccupancy, 50.0);
  assert.equal(fullHour.minOccupancy, 50.0);

  // Scenario C: Two tickets occupying different slots SIMULTANEOUSLY on 2-slot capacity
  // Both active 10:15 - 10:45 (0.5h each = 1.0h total)
  // Avg = (1.0 / 2.0) * 100% = 50.0%; Peak = 2 simultaneous (100.0%); Min = 0.0% (before 10:15)
  const sim = calculateIntervalMetrics(
    new Date('2026-10-10T10:00:00Z'),
    new Date('2026-10-10T11:00:00Z'),
    2,
    [
      { entry: '2026-10-10T10:15:00Z', exit: '2026-10-10T10:45:00Z' },
      { entry: '2026-10-10T10:15:00Z', exit: '2026-10-10T10:45:00Z' }
    ]
  );
  assert.equal(sim.avgOccupancy, 50.0);
  assert.equal(sim.maxSimultaneous, 2);
  assert.equal(sim.peakOccupancy, 100.0);
  assert.equal(sim.minSimultaneous, 0);
  assert.equal(sim.minOccupancy, 0.0);

  // Scenario D: Two vehicles using the same slot at DIFFERENT times (sequential, no overlap)
  // Vehicle 1: 10:00 - 10:20 (20 min = 0.33h); Vehicle 2: 10:30 - 10:50 (20 min = 0.33h) on 1 slot
  const seq = calculateIntervalMetrics(
    new Date('2026-10-10T10:00:00Z'),
    new Date('2026-10-10T11:00:00Z'),
    1,
    [
      { entry: '2026-10-10T10:00:00Z', exit: '2026-10-10T10:20:00Z' },
      { entry: '2026-10-10T10:30:00Z', exit: '2026-10-10T10:50:00Z' }
    ]
  );
  assert.equal(seq.maxSimultaneous, 1, 'Sequential vehicles must not be counted as simultaneous');
  assert.equal(seq.minSimultaneous, 0, 'Unoccupied interval between vehicles must yield min 0');
});

test('10. Exact Daily Occupancy Values Across Calendar Range & Zero-Ticket Date Preservation', async () => {
  // Query daily occupancy for a 5-day calendar range
  const startDate = '2026-08-01T00:00:00Z';
  const endDate = '2026-08-05T23:59:59Z';
  const res = await request(`/api/analytics/daily?slot_type_id=1&start_date=${startDate}&end_date=${endDate}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.data));

  // Assert that all 5 calendar days are returned in chronological order
  assert.equal(res.data.length, 5, 'Must return all 5 calendar days in requested range');
  
  const returnedDates = res.data.map(d => new Date(d.date).toISOString().slice(0, 10));
  assert.deepEqual(returnedDates, ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05']);

  // Assert that dates without tickets represent zero occupancy without being omitted
  res.data.forEach(d => {
    assert.equal(parseFloat(d.daily_avg), 0.0, 'Empty historical dates must have 0.0% occupancy');
    assert.equal(parseInt(d.total_tickets, 10), 0, 'Empty dates must record 0 tickets');
    assert.equal(parseFloat(d.occupied_hours), 0.0, 'Empty dates must record 0.0 occupied hours');
    assert.ok(d.total_slots > 0, 'Full capacity denominator must be present');
  });
});

test('11. Multi-Day Ticket Spanning Midnight Interval Splitting & Capacity Denominator', async () => {
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
    assert.equal(day1.total_slots, regularTotalSlots);
    assert.equal(day2.total_slots, regularTotalSlots);

    const expectedDay1Pct = Number(((2.0 / (regularTotalSlots * 24.0)) * 100.0).toFixed(1));
    const expectedDay2Pct = Number(((6.0 / (regularTotalSlots * 24.0)) * 100.0).toFixed(1));

    assert.equal(parseFloat(day1.occupancy_percentage), expectedDay1Pct);
    assert.equal(parseFloat(day2.occupancy_percentage), expectedDay2Pct);
  } finally {
    await query(`DELETE FROM tickets WHERE ticket_id = $1;`, [fixtureTicketId]);
  }
});

test('12. Missing Hourly Observations & Disjoint Interval Handling', async () => {
  // Completely empty hour (zero tickets active)
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

  // Disjoint tickets with an unmonitored / unoccupied gap in between
  // 10:00 - 10:20 (20 min) and 10:40 - 11:00 (20 min) on capacity 2
  // Total = 40 min = 0.67 slot-hours; Capacity = 2.0 hr
  // Average = (0.667 / 2.0) * 100 = 33.3%
  // During 10:20 - 10:40, active count = 0 => True minimum occupancy must be 0.0%
  const gapMetrics = calculateIntervalMetrics(
    new Date('2026-10-10T10:00:00Z'),
    new Date('2026-10-10T11:00:00Z'),
    2,
    [
      { entry: '2026-10-10T10:00:00Z', exit: '2026-10-10T10:20:00Z' },
      { entry: '2026-10-10T10:40:00Z', exit: '2026-10-10T11:00:00Z' }
    ]
  );
  assert.equal(gapMetrics.avgOccupancy, 33.33);
  assert.equal(gapMetrics.peakOccupancy, 50.0);
  assert.equal(gapMetrics.minOccupancy, 0.0, 'Disjoint interval true minimum occupancy must be 0.0% during the gap');
  assert.equal(gapMetrics.maxSimultaneous, 1);
  assert.equal(gapMetrics.minSimultaneous, 0);
});

test('13. Correct Recent Time Window Selection & Chronological Order', async () => {
  const hourlyRes = await request('/api/analytics/hourly?hours=24');
  assert.equal(hourlyRes.status, 200);
  assert.ok(Array.isArray(hourlyRes.data));
  
  if (hourlyRes.data.length > 1) {
    // Verify ascending chronological order
    for (let i = 0; i < hourlyRes.data.length - 1; i++) {
      const t1 = new Date(hourlyRes.data[i].time_bucket || hourlyRes.data[i].hour_bucket).getTime();
      const t2 = new Date(hourlyRes.data[i + 1].time_bucket || hourlyRes.data[i + 1].hour_bucket).getTime();
      assert.ok(t1 <= t2, 'Hourly observations must be sorted in ascending chronological order');
    }
  }
});

// ==============================================================================
// 5. Dynamic Pricing Policies
// ==============================================================================

test('14. SFpark 4-Band Dynamic Pricing Policy Boundary Tests', async () => {
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
    assert.ok(res.data.evaluation.policyAction.includes(c.action));
  }

  // Rate floor test: rate cannot drop below $0.25
  const floorRes = await request(`/api/sfpark/pricing-recommendations?occupancy_pct=10&base_rate=0.50`);
  assert.equal(floorRes.status, 200);
  assert.equal(floorRes.data.evaluation.adjusted_rate, 0.25, 'Rate floor of $0.25 must be enforced');

  // Input validation tests
  assert.throws(() => calculateSFparkPricingAdjustment(-5, 2.00));
  assert.throws(() => calculateSFparkPricingAdjustment(105, 2.00));
  assert.throws(() => calculateSFparkPricingAdjustment(50, -1.00));
});

test('15. Facility Dynamic Pricing Policy Verification (INR, ₹ & 4-Tier Elasticity)', async () => {
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

  // Threshold validation tests
  assert.equal(calculateFacilityPricingAdjustment(80.0, 'Regular', 50.00).multiplier, 1.00);
  assert.equal(calculateFacilityPricingAdjustment(80.01, 'Regular', 50.00).multiplier, 1.20);
  assert.equal(calculateFacilityPricingAdjustment(60.0, 'Regular', 50.00).multiplier, 1.00);
  assert.equal(calculateFacilityPricingAdjustment(59.99, 'Regular', 50.00).multiplier, 0.90);
  assert.equal(calculateFacilityPricingAdjustment(30.0, 'Regular', 50.00).multiplier, 0.90);
  assert.equal(calculateFacilityPricingAdjustment(29.99, 'Regular', 50.00).multiplier, 0.80);

  // Input validation
  assert.throws(() => calculateFacilityPricingAdjustment(-10, 'Regular', 50));
  assert.throws(() => calculateFacilityPricingAdjustment(110, 'Regular', 50));
  assert.throws(() => calculateFacilityPricingAdjustment(50, 'Regular', -10));

  // Test Facility Pricing API Endpoint
  const apiRes = await request('/api/analytics/facility-pricing-recommendations');
  assert.equal(apiRes.status, 200);
  assert.equal(apiRes.data.currency, 'INR');
  assert.equal(apiRes.data.currencySymbol, '₹');
  assert.equal(apiRes.data.recommendations.length, 3);
});

// ==============================================================================
// 6. Safe Seeding & Sequence Integrity
// ==============================================================================

test('16. Identifier Sequence Synchronization & Additional Slot Creation', async () => {
  const uniqueSlotNumber = `T-SLOT-${Date.now().toString().slice(-4)}`;
  const createSlotRes = await request('/api/slots', {
    method: 'POST',
    body: JSON.stringify({
      slot_number: uniqueSlotNumber,
      slot_type_id: 1,
      status: 'Available'
    })
  });
  assert.equal(createSlotRes.status, 201, 'POST /api/slots must succeed without primary key conflict');
  const newSlotId = createSlotRes.data.slot.slot_id;
  assert.ok(newSlotId > 24, 'New auto-incremented slot ID must be greater than seeded IDs (24)');

  await query(`DELETE FROM parking_slots WHERE slot_id = $1;`, [newSlotId]);
});

test('17. Safe SQL and JavaScript Seeding Preservation of Active Ticket Slot Status', async () => {
  // Allocate slot 1 with an active ticket
  const openRes = await request('/api/tickets', {
    method: 'POST',
    body: JSON.stringify({ vehicle_no: testVehicleNo1, slot_id: 1, staff_id: testStaffId })
  });
  assert.equal(openRes.status, 201);
  const ticketId = openRes.data.ticket.ticket_id;

  try {
    let slot1 = await request('/api/slots/1');
    assert.equal(slot1.data.status, 'Occupied');

    // Execute safe JavaScript seeding
    await safeSeed();
    slot1 = await request('/api/slots/1');
    assert.equal(slot1.data.status, 'Occupied', 'JavaScript seed must NOT reset occupied slot to Available');

    // Execute pure SQL seed script (sql/seed.sql)
    const seedSqlPath = path.resolve('sql/seed.sql');
    const seedSql = fs.readFileSync(seedSqlPath, 'utf-8');
    await query(seedSql);
    slot1 = await request('/api/slots/1');
    assert.equal(slot1.data.status, 'Occupied', 'SQL seed must NOT reset occupied slot to Available');
  } finally {
    await request(`/api/tickets/${ticketId}/close`, { method: 'POST' });
    const slot1After = await request('/api/slots/1');
    assert.equal(slot1After.data.status, 'Available');
  }
});

// ==============================================================================
// 7. Machine Learning Pipeline, Information Leakage & Provenance
// ==============================================================================

test('18. Time Series Lag Feature Exact Timestamp Alignment Verification', async () => {
  const metadataPath = path.resolve('data/models/model_metadata.json');
  assert.ok(fs.existsSync(metadataPath));
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

  assert.equal(metadata.total_hourly_periods, 1835);
  assert.equal(metadata.observed_hours, 712);
  assert.equal(metadata.missing_unmonitored_hours, 1123);
  assert.ok(metadata.features.includes('lag_1h'));
  assert.ok(metadata.features.includes('lag_24h'));
});

test('19. Prevention of Future Information Leakage During Model Validation & Holdout Integrity', async () => {
  const metadataPath = path.resolve('data/models/model_metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

  // Chronological boundary verification
  const trainEnd = new Date(metadata.training_period.end);
  const valStart = new Date(metadata.validation_period.start);
  assert.ok(trainEnd <= valStart, 'Training period must strictly precede validation period to prevent leakage');

  // Verify that primary evaluation was conducted exclusively on genuinely observed holdout targets
  assert.equal(metadata.validation_period.genuine_observed_targets, 148);
  assert.ok(metadata.metrics.validation_mae < metadata.metrics.baseline_persistence_mae,
    'Model MAE must outperform baseline persistence on identical holdout targets');
  assert.equal(metadata.metrics.validation_mae, 4.85);
  assert.equal(metadata.metrics.baseline_persistence_mae, 6.79);
  assert.equal(metadata.metrics.mae_reduction_pct, 28.6);
});

test('20. Machine Learning Model Artifacts, Scikit-Learn 1.9.0 Alignment & Recursive Inference', async () => {
  const metadataPath = path.resolve('data/models/model_metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

  assert.equal(metadata.algorithm, 'HistGradientBoostingRegressor');
  assert.equal(metadata.scikit_learn_version, '1.9.0', 'Scikit-learn version must align with runtime');

  // Trigger live prediction inference via API
  const genRes = await request('/api/predictions/generate', { method: 'POST' });
  assert.equal(genRes.status, 201);
  assert.ok(genRes.data.occupancy_predictions.length > 0);
  assert.ok(genRes.data.pricing_predictions.length > 0);
  genRes.data.occupancy_predictions.forEach(p => {
    assert.ok(p.time_slot.includes('Horizon'), 'Time slot must identify forecast horizon');
  });

  const occRes = await request('/api/predictions/occupancy');
  assert.equal(occRes.status, 200);
  assert.ok(occRes.data.length >= 18);
  occRes.data.forEach(p => {
    const val = parseFloat(p.predicted_occupancy);
    assert.ok(val >= 0 && val <= 100);
  });

  const priceRes = await request('/api/predictions/pricing');
  assert.equal(priceRes.status, 200);
  assert.ok(priceRes.data.length >= 18);
});

test('21. Operational Forecasting vs Historical Demonstration Mode Handling', async () => {
  // Test operational mode with no live readings: must cleanly return INSUFFICIENT_CURRENT_DATA
  const opRes = await request('/api/predictions/generate?mode=operational', { method: 'POST' });
  assert.equal(opRes.status, 200);
  assert.equal(opRes.data.status, 'INSUFFICIENT_CURRENT_DATA');
  assert.ok(opRes.data.message.includes('Operational forecasting requires current facility sensor readings'));

  // Status endpoint verification
  const statusRes = await request('/api/predictions/status');
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.data.model_status, 'ACTIVE');
});

// ==============================================================================
// 8. Dataset Hypertables & Continuous Aggregates
// ==============================================================================

test('22. Real World Birmingham & SFpark Hypertable Continuous Aggregates', async () => {
  const bhamRes = await request('/api/birmingham/summary');
  assert.equal(bhamRes.status, 200);
  assert.equal(parseInt(bhamRes.data.summary.total_readings, 10), 35717);
  assert.equal(parseInt(bhamRes.data.summary.total_carparks, 10), 30);

  const sfRes = await request('/api/sfpark/summary');
  assert.equal(sfRes.status, 200);
  assert.ok(parseInt(sfRes.data.summary.total_readings, 10) >= 50000);
});

test('23. Dataset Import Manifest Audit Log & Production Overwrite Safeguards', async () => {
  const manifestRes = await request('/api/datasets/manifest');
  assert.equal(manifestRes.status, 200);
  assert.ok(Array.isArray(manifestRes.data));
  assert.ok(manifestRes.data.length >= 2);

  const bham = manifestRes.data.find(m => m.dataset_name === 'Birmingham 2016');
  assert.ok(bham);
  assert.equal(bham.status, 'COMPLETED');
  assert.equal(parseInt(bham.rows_imported, 10), 35717);

  const sfpark = manifestRes.data.find(m => m.dataset_name === 'SFpark 2011-2013' && m.status === 'COMPLETED');
  assert.ok(sfpark);
  assert.equal(parseInt(sfpark.rows_imported, 10), 7902290);
});

// ==============================================================================
// 9. Security, Release Packaging Hygiene & Regression Verification
// ==============================================================================

test('24. Secret Protection, Distribution Package Hygiene & Release Packaging', async () => {
  // 1. Verify .env is strictly ignored by git
  const gitignorePath = path.resolve('.gitignore');
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
  assert.ok(gitignoreContent.includes('.env\n') || gitignoreContent.includes('.env\r\n'));

  // 2. Execute release packaging verification
  const pkgResult = packageRelease();
  assert.ok(fs.existsSync(pkgResult.archivePath));
  assert.ok(pkgResult.sizeBytes > 0);
  assert.ok(pkgResult.fileCount > 20);

  // Clean up release zip created during test
  if (fs.existsSync(pkgResult.archivePath)) {
    fs.unlinkSync(pkgResult.archivePath);
  }
});
