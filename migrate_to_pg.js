const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const dbPath = path.join(__dirname, 'database.sqlite');
const pgURL = process.env.DATABASE_URL;

if (!pgURL) {
    console.error('❌ ERROR: DATABASE_URL not found in .env');
    console.log('💡 Please add your PostgreSQL connection string to .env first.');
    process.exit(1);
}

const sqliteDb = new sqlite3.Database(dbPath);
const pgPool = new Pool({
    connectionString: pgURL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    console.log('🚀 Starting Migration: SQLite -> PostgreSQL');
    
    try {
        // 1. Fetch all data from SQLite
        const getUsers = () => new Promise((res, rej) => sqliteDb.all('SELECT * FROM Users', (err, rows) => err ? rej(err) : res(rows)));
        const getShipments = () => new Promise((res, rej) => sqliteDb.all('SELECT * FROM Shipments', (err, rows) => err ? rej(err) : res(rows)));
        const getEvents = () => new Promise((res, rej) => sqliteDb.all('SELECT * FROM TrackingEvents', (err, rows) => err ? rej(err) : res(rows)));

        const users = await getUsers();
        const shipments = await getShipments();
        const events = await getEvents();

        console.log(`📊 Found: ${users.length} Users, ${shipments.length} Shipments, ${events.length} Events`);

        // 2. Insert into PostgreSQL
        // Users
        for (const u of users) {
            await pgPool.query(
                `INSERT INTO Users (id, name, email, password_hash, role, is_auto, created_at) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (email) DO NOTHING`,
                [u.id, u.name, u.email, u.password_hash, u.role, u.is_auto, u.created_at]
            );
        }
        console.log('✅ Users migrated.');

        // Shipments
        for (const s of shipments) {
            await pgPool.query(
                `INSERT INTO Shipments (
                    tracking_number, user_id, shipment_type, carrier, sender_name, sender_phone, sender_email, sender_address,
                    receiver_name, receiver_phone, receiver_email, receiver_address, weight, dimensions, payment_method, status,
                    current_date_time, departure_date_time, delivery_date_time, description, origin, destination,
                    created_at, is_deleted, current_lat, current_lng, anim_start_lat, anim_start_lng, anim_target_lat, anim_target_lng,
                    anim_start_time, anim_target_time
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32) 
                ON CONFLICT (tracking_number) DO NOTHING`,
                [
                    s.tracking_number, s.user_id, s.shipment_type, s.carrier, s.sender_name, s.sender_phone, s.sender_email, s.sender_address,
                    s.receiver_name, s.receiver_phone, s.receiver_email, s.receiver_address, s.weight, s.dimensions, s.payment_method, s.status,
                    s.current_date_time, s.departure_date_time, s.delivery_date_time, s.description, s.origin, s.destination,
                    s.created_at, s.is_deleted, s.current_lat, s.current_lng, s.anim_start_lat, s.anim_start_lng, s.anim_target_lat, s.anim_target_lng,
                    s.anim_start_time, s.anim_target_time
                ]
            );
        }
        console.log('✅ Shipments migrated.');

        // Events
        for (const e of events) {
            await pgPool.query(
                `INSERT INTO TrackingEvents (id, tracking_number, status_marker, location, description, current_date_time, lat, lng, timestamp) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
                [e.id, e.tracking_number, e.status_marker, e.location, e.description, e.current_date_time, e.lat, e.lng, e.timestamp]
            );
        }
        console.log('✅ Tracking events migrated.');

        console.log('🎉 Migration Completed Successfully!');
    } catch (err) {
        console.error('❌ MIGRATION FAILED:', err.message);
    } finally {
        sqliteDb.close();
        await pgPool.end();
    }
}

migrate();
