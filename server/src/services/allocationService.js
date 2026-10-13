import { query } from '../db/index.js';

/**
 * ValetTrack Automated Parking Slot Allocation Service
 * 
 * Deterministic recommendation engine that pairs incoming vehicles with the optimal
 * available physical parking space based on powertrain, vehicle dimensions, slot compatibility,
 * and load balancing.
 */
export async function recommendParkingSlot({ vehicle_no, vehicle_type, preferred_type } = {}) {
  let resolvedVehicleType = vehicle_type || 'Sedan';
  let registeredVehicle = null;

  if (vehicle_no) {
    const cleanNo = vehicle_no.toUpperCase().trim();
    const vRes = await query('SELECT vehicle_no, type, color, owner_id FROM vehicles WHERE vehicle_no = $1', [cleanNo]);
    if (vRes.rows.length > 0) {
      registeredVehicle = vRes.rows[0];
      resolvedVehicleType = registeredVehicle.type;
    }
  }

  const normType = (resolvedVehicleType || '').toLowerCase();
  const isElectric = normType.includes('ev') || normType.includes('electric');
  const isLarge = normType.includes('suv') || normType.includes('truck') || normType.includes('van');

  // Query all physical slots currently in 'Available' state
  const availableSlotsRes = await query(`
    SELECT 
      ps.slot_id,
      ps.slot_type_id,
      st.type_name,
      st.base_rate,
      ps.status
    FROM parking_slots ps
    JOIN slot_types st ON ps.slot_type_id = st.slot_type_id
    WHERE ps.status = 'Available'
      AND NOT EXISTS (
        SELECT 1 FROM tickets t 
        WHERE t.slot_id = ps.slot_id AND t.exit_time IS NULL
      )
    ORDER BY ps.slot_id ASC
  `);

  const availableSlots = availableSlotsRes.rows;

  if (availableSlots.length === 0) {
    return {
      eligible: false,
      recommended_slot: null,
      reason: 'No physical parking spaces are currently available in the facility.',
      vehicle_context: {
        vehicle_no: vehicle_no || null,
        vehicle_type: resolvedVehicleType,
        registered: !!registeredVehicle
      },
      available_slots_count: 0
    };
  }

  // Score candidate slots based on vehicle characteristics
  const scoredSlots = availableSlots.map(slot => {
    let score = 0;
    let rationale = '';

    const slotTypeName = slot.type_name;

    if (isElectric) {
      if (slotTypeName === 'EVCharging') {
        score = 100;
        rationale = 'Primary match: Electric Vehicle (EV) dedicated Level 2 charging infrastructure.';
      } else if (slotTypeName === 'Covered') {
        score = 40;
        rationale = 'Fallback: Covered bay (no charging equipment).';
      } else {
        score = 20;
        rationale = 'Fallback: Standard regular bay (no charging equipment).';
      }
    } else if (isLarge) {
      if (slotTypeName === 'Covered') {
        score = 90;
        rationale = 'Primary match: Wide-clearance covered parking bay.';
      } else if (slotTypeName === 'Regular') {
        score = 70;
        rationale = 'Suitable: Standard open parking space.';
      } else {
        score = 10; // Avoid taking EV charging spots for non-EV large cars
        rationale = 'Suboptimal: EV charging spot reserved for electric vehicles.';
      }
    } else {
      // Standard Sedan / Hatchback
      if (preferred_type && slotTypeName.toLowerCase() === preferred_type.toLowerCase()) {
        score = 95;
        rationale = `Matched user preference: ${slotTypeName} parking.`;
      } else if (slotTypeName === 'Regular') {
        score = 85;
        rationale = 'Optimal allocation: Conserves premium covered and EV charging slots.';
      } else if (slotTypeName === 'Covered') {
        score = 60;
        rationale = 'Secondary allocation: Covered space available.';
      } else {
        score = 5; // Do not allocate EV to standard sedan unless absolutely needed
        rationale = 'Restricted: EV space allocated as last resort.';
      }
    }

    // Tie-breaking preference for lower slot IDs (closer to valet terminal entrance)
    score += (100 - Math.min(slot.slot_id, 99)) * 0.05;

    return {
      ...slot,
      score: Number(score.toFixed(2)),
      rationale
    };
  });

  // Sort descending by score
  scoredSlots.sort((a, b) => b.score - a.score);
  const bestSlot = scoredSlots[0];

  const slotInfo = {
    slot_id: bestSlot.slot_id,
    slot_type_id: bestSlot.slot_type_id,
    type_name: bestSlot.type_name,
    slot_type_name: bestSlot.type_name,
    base_rate: bestSlot.base_rate,
    status: bestSlot.status
  };
  const reasonText = `Recommended Space #${bestSlot.slot_id} (${bestSlot.type_name}): ${bestSlot.rationale}`;

  return {
    eligible: true,
    recommended_slot: slotInfo,
    recommendedSlot: slotInfo,
    reason: reasonText,
    rationale: reasonText,
    score: bestSlot.score,
    vehicle_context: {
      vehicle_no: vehicle_no || null,
      vehicle_type: resolvedVehicleType,
      is_electric: isElectric,
      is_large: isLarge,
      registered: !!registeredVehicle
    },
    total_available_slots: availableSlots.length,
    ranked_candidates: scoredSlots.slice(0, 5).map(s => ({
      slot_id: s.slot_id,
      type_name: s.type_name,
      slot_type_name: s.type_name,
      score: s.score
    }))
  };
}
