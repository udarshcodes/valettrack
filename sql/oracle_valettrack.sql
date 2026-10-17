------------------------------------------------------------------------------
--
-- ValetTrack: A Relational Database System for Dynamic Parking Slot
-- Allocation and Billing
-- SQL DDL, sample data, and PL/SQL implementation (Oracle syntax)
--
-- ML INTEGRATION BOUNDARY (read this before editing anything below):
-- The SFpark Parking Sensor Data Hourly Occupancy 2011-2013 dataset is
-- NOT loaded into Oracle. It is consumed entirely outside the database:
--
--   SFpark raw CSV (~1.38 GB)
--        -> Python preprocessing
--        -> Occupancy ML model      -> predicted occupancy %  -> proc_log_occupancy_prediction() -> OccupancyPrediction
--        -> Dynamic pricing model   -> suggested rate         -> proc_log_pricing_prediction()    -> PricingPrediction
--
-- Oracle's only job is to store the two numbers each model produces
-- (plus which SlotType and time window they apply to) through the two
-- logging procedures below. No SFpark row, raw sensor reading, or model
-- training step ever touches this schema.
------------------------------------------------------------------------------
--

------------------------------------------------------------------------------
-- SECTION 1: DROP EXISTING OBJECTS (safe re-run)
------------------------------------------------------------------------------
BEGIN
    FOR t IN (SELECT table_name FROM user_tables WHERE table_name IN
        ('TICKET','PARKINGSLOT','SLOTTYPE','VEHICLE','VALETSTAFF','OWNER_',
         'PRICINGPREDICTION','OCCUPANCYPREDICTION')) LOOP
        EXECUTE IMMEDIATE 'DROP TABLE ' || t.table_name || ' CASCADE CONSTRAINTS';
    END LOOP;
    FOR s IN (SELECT sequence_name FROM user_sequences WHERE sequence_name LIKE 'SEQ_%') LOOP
        EXECUTE IMMEDIATE 'DROP SEQUENCE ' || s.sequence_name;
    END LOOP;
END;
/

------------------------------------------------------------------------------
-- SECTION 2: TABLE DEFINITIONS (DDL)
-- Note: OWNER is a reserved word in Oracle, so the table is named OWNER_.
------------------------------------------------------------------------------

CREATE TABLE OWNER_ (
    OwnerID     NUMBER PRIMARY KEY,
    Name        VARCHAR2(100) NOT NULL,
    Phone       VARCHAR2(15)  NOT NULL UNIQUE,
    Email       VARCHAR2(100) NOT NULL UNIQUE
);

CREATE TABLE Vehicle (
    VehicleNo   VARCHAR2(15) PRIMARY KEY,
    Type        VARCHAR2(30),
    Color       VARCHAR2(30),
    OwnerID     NUMBER NOT NULL,
    CONSTRAINT fk_vehicle_owner FOREIGN KEY (OwnerID) REFERENCES OWNER_(OwnerID)
);

CREATE TABLE ValetStaff (
    StaffID     NUMBER PRIMARY KEY,
    Name        VARCHAR2(100) NOT NULL,
    Phone       VARCHAR2(15),
    ShiftTiming VARCHAR2(30)
);

CREATE TABLE SlotType (
    SlotTypeID  NUMBER PRIMARY KEY,
    TypeName    VARCHAR2(20) NOT NULL,
    BaseRate    NUMBER(8,2)  NOT NULL,
    CONSTRAINT chk_slottype_name CHECK (TypeName IN ('Regular','Covered','EVCharging')),
    CONSTRAINT chk_slottype_rate CHECK (BaseRate >= 0)
);

CREATE TABLE ParkingSlot (
    SlotID      NUMBER PRIMARY KEY,
    SlotTypeID  NUMBER NOT NULL,
    Status      VARCHAR2(15) DEFAULT 'Available' NOT NULL,
    CONSTRAINT fk_slot_type    FOREIGN KEY (SlotTypeID) REFERENCES SlotType(SlotTypeID),
    CONSTRAINT chk_slot_status CHECK (Status IN ('Available','Occupied','Reserved'))
);

CREATE TABLE Ticket (
    TicketID    NUMBER PRIMARY KEY,
    VehicleNo   VARCHAR2(15) NOT NULL,
    SlotID      NUMBER NOT NULL,
    StaffID     NUMBER NOT NULL,
    EntryTime   TIMESTAMP NOT NULL,
    ExitTime    TIMESTAMP,
    AmountPaid  NUMBER(8,2) DEFAULT 0 NOT NULL,
    CONSTRAINT fk_ticket_vehicle FOREIGN KEY (VehicleNo) REFERENCES Vehicle(VehicleNo),
    CONSTRAINT fk_ticket_slot    FOREIGN KEY (SlotID)    REFERENCES ParkingSlot(SlotID),
    CONSTRAINT fk_ticket_staff   FOREIGN KEY (StaffID)   REFERENCES ValetStaff(StaffID),
    CONSTRAINT chk_ticket_amount CHECK (AmountPaid >= 0),
    CONSTRAINT chk_ticket_time   CHECK (ExitTime IS NULL OR ExitTime >= EntryTime)
);

-- PredictionTime records when the ML model produced the prediction;
-- TimeSlot records which future window the prediction is for. The two
-- are complementary, not duplicates.
CREATE TABLE PricingPrediction (
    PricingID       NUMBER PRIMARY KEY,
    SlotTypeID      NUMBER NOT NULL,
    PredictionTime  TIMESTAMP NOT NULL,
    TimeSlot        VARCHAR2(30) NOT NULL,
    OccupancyPct    NUMBER(5,2),
    SuggestedRate   NUMBER(8,2),
    CONSTRAINT fk_pricing_slottype FOREIGN KEY (SlotTypeID) REFERENCES SlotType(SlotTypeID),
    CONSTRAINT chk_pricing_occ     CHECK (OccupancyPct BETWEEN 0 AND 100),
    CONSTRAINT chk_pricing_rate    CHECK (SuggestedRate >= 0)
);

-- Same PredictionTime / TimeSlot rationale as PricingPrediction above.
CREATE TABLE OccupancyPrediction (
    PredictionID        NUMBER PRIMARY KEY,
    SlotTypeID          NUMBER NOT NULL,
    PredictionTime      TIMESTAMP NOT NULL,
    TimeSlot            VARCHAR2(30) NOT NULL,
    PredictedOccupancy  NUMBER(5,2),
    CONSTRAINT fk_occupancy_slottype FOREIGN KEY (SlotTypeID) REFERENCES SlotType(SlotTypeID),
    CONSTRAINT chk_occupancy_pct     CHECK (PredictedOccupancy BETWEEN 0 AND 100)
);

------------------------------------------------------------------------------
-- SECTION 3: SEQUENCES
------------------------------------------------------------------------------
CREATE SEQUENCE seq_owner       START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE seq_staff       START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE seq_slottype    START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE seq_slot        START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE seq_ticket      START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE seq_pricing     START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE seq_occupancy   START WITH 1 INCREMENT BY 1;

------------------------------------------------------------------------------
-- SECTION 4: SAMPLE DATA
-- No direct inserts into the prediction tables: those are only ever
-- populated through the logging procedures in Section 6.
------------------------------------------------------------------------------
INSERT INTO OWNER_ VALUES (seq_owner.NEXTVAL, 'Arjun Mehta', '9876543210', 'arjun.mehta@mail.com');
INSERT INTO OWNER_ VALUES (seq_owner.NEXTVAL, 'Priya Nair',  '9876500011', 'priya.nair@mail.com');
INSERT INTO OWNER_ VALUES (seq_owner.NEXTVAL, 'Rohan Das',   '9876500022', 'rohan.das@mail.com');

INSERT INTO Vehicle VALUES ('TN01AB1234', 'Sedan',     'White', 1);
INSERT INTO Vehicle VALUES ('TN02CD5678', 'SUV',       'Black', 2);
INSERT INTO Vehicle VALUES ('TN03EF9012', 'Hatchback', 'Red',   3);

INSERT INTO ValetStaff VALUES (seq_staff.NEXTVAL, 'Karthik S', '9000011111', 'Morning');
INSERT INTO ValetStaff VALUES (seq_staff.NEXTVAL, 'Divya R',   '9000022222', 'Evening');

INSERT INTO SlotType VALUES (seq_slottype.NEXTVAL, 'Regular',    50);
INSERT INTO SlotType VALUES (seq_slottype.NEXTVAL, 'Covered',    80);
INSERT INTO SlotType VALUES (seq_slottype.NEXTVAL, 'EVCharging', 120);

INSERT INTO ParkingSlot VALUES (seq_slot.NEXTVAL, 1, 'Available');
INSERT INTO ParkingSlot VALUES (seq_slot.NEXTVAL, 1, 'Available');
INSERT INTO ParkingSlot VALUES (seq_slot.NEXTVAL, 2, 'Available');
INSERT INTO ParkingSlot VALUES (seq_slot.NEXTVAL, 3, 'Available');

COMMIT;

------------------------------------------------------------------------------
-- SECTION 5: FUNCTIONS
------------------------------------------------------------------------------

-- Computes the bill for a stay: whole hours (rounded up) x BaseRate of the
-- slot's SlotType. A minimum charge of one hour applies.
--
-- Deliberately kept on SlotType.BaseRate rather than PricingPrediction.
-- SuggestedRate: the dynamic pricing model is a prediction feature, and the
-- design keeps prediction storage separate from the billing path.
CREATE OR REPLACE FUNCTION fn_calculate_amount(
    p_slotid IN ParkingSlot.SlotID%TYPE,
    p_entry  IN TIMESTAMP,
    p_exit   IN TIMESTAMP
) RETURN NUMBER
IS
    v_baserate SlotType.BaseRate%TYPE;
    v_hours    NUMBER;
BEGIN
    SELECT st.BaseRate INTO v_baserate
    FROM ParkingSlot ps JOIN SlotType st ON ps.SlotTypeID = st.SlotTypeID
    WHERE ps.SlotID = p_slotid;

    v_hours := CEIL( (CAST(p_exit AS DATE) - CAST(p_entry AS DATE)) * 24 );
    IF v_hours < 1 THEN
        v_hours := 1;
    END IF;

    RETURN v_hours * v_baserate;
END fn_calculate_amount;
/

------------------------------------------------------------------------------
-- SECTION 6: STANDALONE PROCEDURES
------------------------------------------------------------------------------

-- 6.1 Opens a new ticket for a vehicle at a slot chosen by an external AI
-- allocation model (p_slotid is passed in, not computed here).
CREATE OR REPLACE PROCEDURE proc_open_ticket(
    p_vehicleno IN  Vehicle.VehicleNo%TYPE,
    p_slotid    IN  ParkingSlot.SlotID%TYPE,
    p_staffid   IN  ValetStaff.StaffID%TYPE,
    p_ticketid  OUT Ticket.TicketID%TYPE
)
IS
BEGIN
    INSERT INTO Ticket (TicketID, VehicleNo, SlotID, StaffID, EntryTime, AmountPaid)
    VALUES (seq_ticket.NEXTVAL, p_vehicleno, p_slotid, p_staffid, SYSTIMESTAMP, 0)
    RETURNING TicketID INTO p_ticketid;
    COMMIT;
END proc_open_ticket;
/

-- 6.2 Closes a ticket: stamps ExitTime, bills the stay via
-- fn_calculate_amount, and (through trg_ticket_after_update) frees the
-- slot. Raises an application error instead of silently re-closing a
-- ticket whose ExitTime is already set.
CREATE OR REPLACE PROCEDURE proc_close_ticket(
    p_ticketid IN Ticket.TicketID%TYPE
)
IS
    v_entry     Ticket.EntryTime%TYPE;
    v_exit      Ticket.ExitTime%TYPE;
    v_slotid    Ticket.SlotID%TYPE;
    v_amount    NUMBER;
BEGIN
    SELECT EntryTime, ExitTime, SlotID INTO v_entry, v_exit, v_slotid
    FROM Ticket WHERE TicketID = p_ticketid;

    IF v_exit IS NOT NULL THEN
        RAISE_APPLICATION_ERROR(-20002, 'Ticket ' || p_ticketid || ' is already closed.');
    END IF;

    v_amount := fn_calculate_amount(v_slotid, v_entry, SYSTIMESTAMP);

    UPDATE Ticket
       SET ExitTime   = SYSTIMESTAMP,
           AmountPaid = v_amount
     WHERE TicketID = p_ticketid;

    COMMIT;
END proc_close_ticket;
/

-- 6.3 Storage-only procedure for the occupancy ML model.
--
-- SFpark / ML boundary: p_predicted is a number an external Python model
-- computed from the SFpark sensor dataset (after preprocessing, feature
-- engineering, and inference happen entirely outside Oracle). This
-- procedure does not train, evaluate, or otherwise touch the model -- it
-- only persists the one output value the model handed back, tagged with
-- when the prediction was made (p_predictiontime) and which future window
-- it is for (p_timeslot).
CREATE OR REPLACE PROCEDURE proc_log_occupancy_prediction(
    p_slottypeid     IN OccupancyPrediction.SlotTypeID%TYPE,
    p_predictiontime IN OccupancyPrediction.PredictionTime%TYPE,
    p_timeslot       IN OccupancyPrediction.TimeSlot%TYPE,
    p_predicted      IN OccupancyPrediction.PredictedOccupancy%TYPE
)
IS
BEGIN
    INSERT INTO OccupancyPrediction (PredictionID, SlotTypeID, PredictionTime, TimeSlot, PredictedOccupancy)
    VALUES (seq_occupancy.NEXTVAL, p_slottypeid, p_predictiontime, p_timeslot, p_predicted);
    COMMIT;
END proc_log_occupancy_prediction;
/

-- 6.4 Storage-only procedure for the dynamic pricing ML model. Same
-- boundary as 6.3: p_suggested and p_occupancypct arrive already computed
-- by the external pricing model; this procedure only persists them.
CREATE OR REPLACE PROCEDURE proc_log_pricing_prediction(
    p_slottypeid     IN PricingPrediction.SlotTypeID%TYPE,
    p_predictiontime IN PricingPrediction.PredictionTime%TYPE,
    p_timeslot       IN PricingPrediction.TimeSlot%TYPE,
    p_occupancypct   IN PricingPrediction.OccupancyPct%TYPE,
    p_suggested      IN PricingPrediction.SuggestedRate%TYPE
)
IS
BEGIN
    INSERT INTO PricingPrediction (PricingID, SlotTypeID, PredictionTime, TimeSlot, OccupancyPct, SuggestedRate)
    VALUES (seq_pricing.NEXTVAL, p_slottypeid, p_predictiontime, p_timeslot, p_occupancypct, p_suggested);
    COMMIT;
END proc_log_pricing_prediction;
/

------------------------------------------------------------------------------
-- SECTION 7: TRIGGERS
------------------------------------------------------------------------------

-- 7.1 Business rule: a ticket may only be opened against a slot that is
-- currently Available. This enforces the AI allocation contract -- the AI
-- module chooses a SlotID, but the database is still responsible for
-- guaranteeing that slot is actually free.
CREATE OR REPLACE TRIGGER trg_ticket_before_insert
BEFORE INSERT ON Ticket
FOR EACH ROW
DECLARE
    v_status ParkingSlot.Status%TYPE;
BEGIN
    SELECT Status INTO v_status FROM ParkingSlot WHERE SlotID = :NEW.SlotID;
    IF v_status <> 'Available' THEN
        RAISE_APPLICATION_ERROR(-20001, 'Selected slot is not available for allocation.');
    END IF;
    IF :NEW.TicketID IS NULL THEN
        :NEW.TicketID := seq_ticket.NEXTVAL;
    END IF;
END;
/

-- 7.2 When a ticket is created, mark its slot Occupied.
CREATE OR REPLACE TRIGGER trg_ticket_after_insert
AFTER INSERT ON Ticket
FOR EACH ROW
BEGIN
    UPDATE ParkingSlot SET Status = 'Occupied' WHERE SlotID = :NEW.SlotID;
END;
/

-- 7.3 When a ticket is closed (ExitTime goes from NULL to NOT NULL),
-- release its slot back to Available.
CREATE OR REPLACE TRIGGER trg_ticket_after_update
AFTER UPDATE OF ExitTime ON Ticket
FOR EACH ROW
WHEN (NEW.ExitTime IS NOT NULL AND OLD.ExitTime IS NULL)
BEGIN
    UPDATE ParkingSlot SET Status = 'Available' WHERE SlotID = :NEW.SlotID;
END;
/

------------------------------------------------------------------------------
-- SECTION 8: PACKAGE SPECIFICATION
-- The package wraps the ticket lifecycle only. The prediction logging
-- procedures stay standalone, since Python calls them directly and does
-- not need the ticket-focused package interface.
------------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE pkg_valet_track AS
    PROCEDURE open_ticket(
        p_vehicleno IN  VARCHAR2,
        p_slotid    IN  NUMBER,
        p_staffid   IN  NUMBER,
        p_ticketid  OUT NUMBER
    );
    PROCEDURE close_ticket(p_ticketid IN NUMBER);
    FUNCTION  get_slot_revenue(p_slotid IN NUMBER) RETURN NUMBER;
END pkg_valet_track;
/

------------------------------------------------------------------------------
-- SECTION 9: PACKAGE BODY
------------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE BODY pkg_valet_track AS

    PROCEDURE open_ticket(
        p_vehicleno IN  VARCHAR2,
        p_slotid    IN  NUMBER,
        p_staffid   IN  NUMBER,
        p_ticketid  OUT NUMBER
    ) IS
    BEGIN
        proc_open_ticket(p_vehicleno, p_slotid, p_staffid, p_ticketid);
    END open_ticket;

    PROCEDURE close_ticket(p_ticketid IN NUMBER) IS
    BEGIN
        proc_close_ticket(p_ticketid);
    END close_ticket;

    FUNCTION get_slot_revenue(p_slotid IN NUMBER) RETURN NUMBER IS
        v_total NUMBER;
    BEGIN
        SELECT NVL(SUM(AmountPaid), 0) INTO v_total
        FROM Ticket WHERE SlotID = p_slotid;
        RETURN v_total;
    END get_slot_revenue;

END pkg_valet_track;
/

------------------------------------------------------------------------------
-- SECTION 10: DEMONSTRATION / TEST BLOCK
--
-- The two prediction values below (v_demo_occupancy, v_demo_rate) are
-- PLACEHOLDERS standing in for what the external ML models would return.
-- In the real pipeline, Python loads the SFpark dataset, preprocesses it,
-- runs the occupancy and dynamic pricing models, and passes their outputs
-- into proc_log_occupancy_prediction / proc_log_pricing_prediction. Oracle
-- never sees the SFpark CSV and never runs any part of the model itself --
-- this block only proves the logging procedures and the ticket lifecycle
-- work end to end.
------------------------------------------------------------------------------
SET SERVEROUTPUT ON;

DECLARE
    v_ticketid       NUMBER;
    v_revenue        NUMBER;
    v_demo_time      TIMESTAMP := SYSTIMESTAMP;
    v_demo_occupancy NUMBER := 72.5; -- placeholder for external ML model output
    v_demo_rate      NUMBER := 65;   -- placeholder for external ML model output
BEGIN
    -- Open a ticket for TN01AB1234 at slot 1, handled by staff 1.
    -- SlotID here stands in for the value an external allocation model
    -- would choose; the trigger in Section 7.1 still checks availability.
    pkg_valet_track.open_ticket('TN01AB1234', 1, 1, v_ticketid);
    DBMS_OUTPUT.PUT_LINE('Opened Ticket ID: ' || v_ticketid);

    -- Demonstration only: v_demo_occupancy / v_demo_rate stand in for
    -- values that would arrive from Python after it has run the SFpark
    -- based ML models. The procedures below are exactly what Python calls.
    proc_log_occupancy_prediction(1, v_demo_time, '18:00-19:00', v_demo_occupancy);
    proc_log_pricing_prediction(1, v_demo_time, '18:00-19:00', v_demo_occupancy, v_demo_rate);

    -- Close the ticket and bill it (billing still uses SlotType.BaseRate,
    -- not the demo suggested rate above).
    pkg_valet_track.close_ticket(v_ticketid);
    DBMS_OUTPUT.PUT_LINE('Ticket ' || v_ticketid || ' closed and billed.');

    v_revenue := pkg_valet_track.get_slot_revenue(1);
    DBMS_OUTPUT.PUT_LINE('Total revenue for Slot 1: ' || v_revenue);

    -- Attempting to close the same ticket again should now raise
    -- ORA-20002 instead of succeeding silently.
    BEGIN
        pkg_valet_track.close_ticket(v_ticketid);
    EXCEPTION
        WHEN OTHERS THEN
            DBMS_OUTPUT.PUT_LINE('Expected error on double-close: ' || SQLERRM);
    END;
END;
/

------------------------------------------------------------------------------
-- SECTION 11: VERIFICATION QUERIES
------------------------------------------------------------------------------
SELECT * FROM Ticket;
SELECT * FROM ParkingSlot;
SELECT * FROM OccupancyPrediction;
SELECT * FROM PricingPrediction;
