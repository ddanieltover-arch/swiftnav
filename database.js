const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// In production (Render), DATABASE_URL is provided safely.
// For local development, this needs to be set in .env
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const initializeDatabase = async () => {
    if (!process.env.DATABASE_URL) {
        console.error('❌ CRITICAL ERROR: DATABASE_URL is not defined in environment variables.');
        console.error('Please add DATABASE_URL (from Supabase) to your Render environment settings.');
        return;
    }

    let client;
    try {
        client = await pool.connect();
        console.log('✅ Connected to PostgreSQL database.');

        // Create Users Table
        await client.query(`CREATE TABLE IF NOT EXISTS Users (
            id SERIAL PRIMARY KEY,
            name TEXT,
            email TEXT UNIQUE,
            password_hash TEXT,
            role TEXT DEFAULT 'user',
            is_auto INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            reset_code TEXT,
            reset_expires TIMESTAMPTZ
        )`);

        // Migration: Ensure 'role' column exists (for older schemas)
        try {
            await client.query(`ALTER TABLE Users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'`);
            await client.query(`ALTER TABLE Users ADD COLUMN IF NOT EXISTS is_auto INTEGER DEFAULT 0`);
        } catch (e) {
            console.log('ℹ️ Users table migrations skipped or already applied.');
        }

        // Seed Admin User
        const adminCheck = await client.query('SELECT * FROM Users WHERE email = $1', ['admin@swiftnav.com']);
        if (adminCheck.rows.length === 0) {
            const hash = await bcrypt.hash('password123', 10);
            await client.query('INSERT INTO Users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
                ['System Admin', 'admin@swiftnav.com', hash, 'admin']);
            console.log('✅ Admin user seeded (admin@swiftnav.com / password123)');
        }

        // Create Shipments Table
        await client.query(`CREATE TABLE IF NOT EXISTS Shipments (
            tracking_number TEXT PRIMARY KEY,
            user_id INTEGER REFERENCES Users(id),
            shipment_type TEXT,
            carrier TEXT,
            sender_name TEXT,
            sender_phone TEXT,
            sender_email TEXT,
            sender_address TEXT,
            receiver_name TEXT,
            receiver_phone TEXT,
            receiver_email TEXT,
            receiver_address TEXT,
            weight REAL,
            dimensions TEXT,
            current_lat REAL,
            current_lng REAL,
            status TEXT,
            current_date_time TEXT,
            departure_date_time TEXT,
            delivery_date_time TEXT,
            description TEXT,
            origin TEXT,
            destination TEXT,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0
        )`);

        // Create TrackingEvents Table
        await client.query(`CREATE TABLE IF NOT EXISTS TrackingEvents (
            id SERIAL PRIMARY KEY,
            tracking_number TEXT REFERENCES Shipments(tracking_number) ON DELETE CASCADE,
            status_marker TEXT,
            location TEXT,
            description TEXT,
            timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

    } catch (err) {
        console.error('❌ Database Initialization Error:', err.message);
        if (err.message.includes('password authentication failed')) {
            console.error('👉 TIP: Check if your DATABASE_URL password is correct.');
        }
        if (err.message.includes('self signed certificate')) {
            console.error('👉 TIP: Ensure SSL is set to { rejectUnauthorized: false } for Supabase.');
        }
    } finally {
        if (client) client.release();
    }
};

// Utility to convert SQLite '?' to Postgres '$1, $2, ...'
// Also handles adding RETURNING id to INSERT statements to satisfy SQLite lastID calls
const sqliteToPg = (query) => {
    let index = 1;
    let pgQuery = query.replace(/\?/g, () => `$${index++}`);

    // Automatically add RETURNING id to INSERT statements if they don't have it
    if (pgQuery.toUpperCase().startsWith('INSERT INTO USERS') && !pgQuery.toUpperCase().includes('RETURNING')) {
        pgQuery += ' RETURNING id';
    }

    return pgQuery;
};

const db = {
    query: (text, params) => pool.query(sqliteToPg(text), params),

    // SQLite compatibility wrappers
    get: (text, params, callback) => {
        pool.query(sqliteToPg(text), params)
            .then(res => {
                if (callback) callback(null, res.rows[0]);
            })
            .catch(err => {
                if (callback) callback(err);
            });
    },
    all: (text, params, callback) => {
        pool.query(sqliteToPg(text), params)
            .then(res => {
                if (callback) callback(null, res.rows);
            })
            .catch(err => {
                if (callback) callback(err);
            });
    },
    run: function (text, params, callback) {
        // Handle optional params
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        pool.query(sqliteToPg(text), params)
            .then(res => {
                // SQLite's this.lastID and this.changes workaround
                const result = {
                    lastID: res.rows && res.rows[0] && (res.rows[0].id || res.rows[0].ID) ? (res.rows[0].id || res.rows[0].ID) : null,
                    changes: res.rowCount
                };
                if (callback) callback.call(result, null);
            })
            .catch(err => {
                console.error('❌ DB RUN ERROR:', err.message, '| Query:', text);
                if (callback) callback(err);
            });
    },
    serialize: (fn) => fn()
};

// Auto-init with error safety
initializeDatabase().catch(err => console.error('🔥 FATAL DB INIT ERROR:', err));

// === Database Keep-Alive (Supabase/Neon sleep prevention) ===
if (process.env.DATABASE_URL) {
    setInterval(async () => {
        try {
            await db.query('SELECT 1');
            console.log('🧬 DB Keep-alive: Connection active');
        } catch (err) {
            console.error('🧬 DB Keep-alive error:', err.message);
        }
    }, 5 * 60 * 1000); // Every 5 minutes
}

module.exports = db;
