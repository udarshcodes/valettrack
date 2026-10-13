import { query } from '../db/index.js';

export async function getDashboardSummary(req, res, next) {
  try {
    const slotStats = await query(`
      SELECT 
        COUNT(*) as total_slots,
        COUNT(CASE WHEN status = 'Available' THEN 1 END) as available_slots,
        COUNT(CASE WHEN status = 'Occupied' THEN 1 END) as occupied_slots,
        COUNT(CASE WHEN status = 'Reserved' THEN 1 END) as reserved_slots
      FROM parking_slots
    `);

    const ticketStats = await query(`
      SELECT 
        COUNT(CASE WHEN exit_time IS NULL THEN 1 END) as active_tickets,
        COUNT(CASE WHEN exit_time IS NOT NULL THEN 1 END) as completed_tickets,
        COALESCE(SUM(amount_paid), 0) as total_revenue
      FROM tickets
    `);

    const projectedStats = await query(`
      SELECT 
        COALESCE(SUM(
          GREATEST(1, CEIL(EXTRACT(EPOCH FROM (NOW() - t.entry_time)) / 3600.0)) * st.base_rate
        ), 0) as projected_unbilled_revenue
      FROM tickets t
      JOIN parking_slots ps ON t.slot_id = ps.slot_id
      JOIN slot_types st ON ps.slot_type_id = st.slot_type_id
      WHERE t.exit_time IS NULL
    `);

    const slotTypeStats = await query(`
      SELECT 
        st.slot_type_id,
        st.type_name,
        st.base_rate,
        COUNT(ps.slot_id) as total_slots,
        COUNT(CASE WHEN ps.status = 'Available' THEN 1 END) as available,
        COUNT(CASE WHEN ps.status = 'Occupied' THEN 1 END) as occupied,
        COUNT(CASE WHEN ps.status = 'Reserved' THEN 1 END) as reserved
      FROM slot_types st
      LEFT JOIN parking_slots ps ON st.slot_type_id = ps.slot_type_id
      GROUP BY st.slot_type_id, st.type_name, st.base_rate
      ORDER BY st.slot_type_id
    `);

    const recentActivity = await query(`
      SELECT 
        t.ticket_id,
        t.vehicle_no,
        v.type as vehicle_type,
        o.name as owner_name,
        t.slot_id,
        st.type_name as slot_type,
        st.base_rate,
        s.name as staff_name,
        t.entry_time,
        t.exit_time,
        t.amount_paid,
        CASE WHEN t.exit_time IS NULL THEN 'Active' ELSE 'Completed' END as status
      FROM tickets t
      JOIN vehicles v ON t.vehicle_no = v.vehicle_no
      JOIN owners o ON v.owner_id = o.owner_id
      JOIN parking_slots ps ON t.slot_id = ps.slot_id
      JOIN slot_types st ON ps.slot_type_id = st.slot_type_id
      JOIN valet_staff s ON t.staff_id = s.staff_id
      ORDER BY t.entry_time DESC
      LIMIT 10
    `);

    const total = parseInt(slotStats.rows[0].total_slots, 10) || 0;
    const occupied = parseInt(slotStats.rows[0].occupied_slots, 10) || 0;
    const available = parseInt(slotStats.rows[0].available_slots, 10) || 0;
    const reserved = parseInt(slotStats.rows[0].reserved_slots, 10) || 0;
    const occupancyPercentage = total > 0 ? Number(((occupied / total) * 100).toFixed(1)) : 0;

    res.json({
      metrics: {
        totalSlots: total,
        availableSlots: available,
        occupiedSlots: occupied,
        reservedSlots: reserved,
        occupancyPercentage,
        activeTickets: parseInt(ticketStats.rows[0].active_tickets, 10) || 0,
        completedTickets: parseInt(ticketStats.rows[0].completed_tickets, 10) || 0,
        totalRevenue: parseFloat(ticketStats.rows[0].total_revenue) || 0,
        projectedRevenue: parseFloat(projectedStats.rows[0].projected_unbilled_revenue) || 0,
      },
      slotTypeBreakdown: slotTypeStats.rows,
      recentActivity: recentActivity.rows
    });
  } catch (err) {
    next(err);
  }
}
