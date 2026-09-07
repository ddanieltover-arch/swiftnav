const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');

const dbURL = process.env.DATABASE_URL;
// Force PostgreSQL in production / on Vercel; SQLite only for local development.
const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
const isLocal = !isProd;

// Log for debugging
console.log('🔍 Environment:', isProd ? 'PRODUCTION' : 'LOCAL');
console.log('🔍 Database URL detected:', dbURL ? `Present` : 'None');

let db;

if (isProd) {
    if (!dbURL || !dbURL.startsWith('postgres')) {
        console.error('❌ CRITICAL ERROR: DATABASE_URL is missing or invalid in production mode.');
        console.error('💡 Set DATABASE_URL (Postgres) in Vercel env vars — SQLite cannot persist on serverless.');
        // Do not process.exit on Vercel (opaque failures); throw so the function returns a clear 500
        throw new Error('DATABASE_URL must be a Postgres connection string in production');
    }
    
    console.log('🌐 Using PostgreSQL (Production Mode)');
    const pool = new Pool({
        connectionString: dbURL,
        ssl: { rejectUnauthorized: false }
    });

    const sqliteToPg = (query) => {
        let index = 1;
        let pgQuery = query.replace(/\?/g, () => `$${index++}`);
        const upperQuery = pgQuery.toUpperCase().trim();
        if (upperQuery.startsWith('INSERT INTO')) {
            if (!upperQuery.includes('RETURNING')) {
                if (upperQuery.includes('USERS')) pgQuery += ' RETURNING id';
                else if (upperQuery.includes('SHIPMENTS')) pgQuery += ' RETURNING tracking_number';
                else if (upperQuery.includes('TRACKINGEVENTS')) pgQuery += ' RETURNING id';
            }
        }
        return pgQuery;
    };

    const handlePoolError = (err) => {
        if (err.code === 'ENETUNREACH') {
            console.error('❌ PRODUCTION DB ERROR (ENETUNREACH): Render cannot reach Supabase via IPv6.');
            console.error('💡 FIX: Use the Supabase Connection Pooler string (Session Mode) with IPv4 in Render Settings.');
        } else if (err.message && err.message.toLowerCase().includes('password authentication failed')) {
            console.error('❌ PRODUCTION DB ERROR: Password authentication failed.');
            console.error('💡 FIX: Ensure your database password is URL-encoded if it contains special characters (e.g., #, @, !).');
            console.error('   Example: MyP@ss#ord -> MyP%40ss%23ord');
        } else {
            console.error('❌ DB ERROR:', err.message);
        }
        return err;
    };

    db = {
        query: (text, params) => {
            if (typeof params === 'function') params = [];
            return pool.query(sqliteToPg(text), params).catch(err => { throw handlePoolError(err); });
        },
        get: (text, params, callback) => {
            if (typeof params === 'function') { callback = params; params = []; }
            pool.query(sqliteToPg(text), params)
                .then(res => callback(null, res.rows[0]))
                .catch(err => callback(handlePoolError(err)));
        },
        all: (text, params, callback) => {
            if (typeof params === 'function') { callback = params; params = []; }
            pool.query(sqliteToPg(text), params)
                .then(res => callback(null, res.rows))
                .catch(err => callback(handlePoolError(err)));
        },
        run: function (text, params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            pool.query(sqliteToPg(text), params)
                .then(res => {
                    const result = {
                        lastID: res.rows && res.rows[0] ? (res.rows[0].id || res.rows[0].tracking_number) : null,
                        changes: res.rowCount
                    };
                    if (callback) callback.call(result, null);
                })
                .catch(err => callback(handlePoolError(err)));
        }
    };
} else {
    console.log('🏠 Using SQLite (Local Development Mode)');
    // Lazy-load sqlite3 so Vercel production never loads the native module
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.join(__dirname, 'database.sqlite');
    const sqliteDb = new sqlite3.Database(dbPath);

    db = {
        query: (text, params) => new Promise((resolve, reject) => {
            sqliteDb.all(text, params, (err, rows) => {
                if (err) {
                    // Check for unique constraint violation in SQLite
                    if (err.message && err.message.includes('SQLITE_CONSTRAINT_UNIQUE')) {
                        return reject({ message: 'Data conflict', detail: 'A record with this unique identifier already exists.' });
                    }
                    return reject({ message: 'Database error', detail: err.message });
                }
                resolve({ rows });
            });
        }),
        get: (text, params, callback) => sqliteDb.get(text, params, callback),
        all: (text, params, callback) => sqliteDb.all(text, params, callback),
        run: function (text, params, callback) {
            sqliteDb.run(text, params, callback);
        }
    };
}

const initializeDatabase = async () => {
    try {
        const createUsers = `CREATE TABLE IF NOT EXISTS Users (
            id ${isProd ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            name TEXT,
            email TEXT UNIQUE,
            password_hash TEXT,
            role TEXT DEFAULT 'user',
            is_auto INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            reset_code TEXT,
            reset_expires TIMESTAMPTZ
        )`;

        const createShipments = `CREATE TABLE IF NOT EXISTS Shipments (
            tracking_number TEXT PRIMARY KEY,
            user_id INTEGER,
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
            payment_method TEXT,
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
            is_deleted INTEGER DEFAULT 0,
            anim_start_lat REAL,
            anim_start_lng REAL,
            anim_target_lat REAL,
            anim_target_lng REAL,
            anim_start_time TEXT,
            anim_target_time TEXT
        )`;

        const createEvents = `CREATE TABLE IF NOT EXISTS TrackingEvents (
            id ${isProd ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            tracking_number TEXT,
            status_marker TEXT,
            location TEXT,
            description TEXT,
            current_date_time TEXT,
            lat REAL,
            lng REAL,
            timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`;

        // Run in series
        await db.query(createUsers);
        await db.query(createShipments);
        await db.query(createEvents);

        // Migrations
        try {
            await db.query(`ALTER TABLE Users ADD COLUMN role TEXT DEFAULT 'user'`);
            await db.query(`ALTER TABLE Users ADD COLUMN is_auto INTEGER DEFAULT 0`);
        } catch (e) { /* ignore */ }

        // Migration: add current_date_time to TrackingEvents if missing (fixes production DB)
        try {
            await db.query(`ALTER TABLE TrackingEvents ADD COLUMN current_date_time TEXT`);
            console.log('✅ Migration: added current_date_time to TrackingEvents');
        } catch (e) { /* column already exists — ignore */ }

        // Migration: add payment_method to Shipments if missing
        try {
            await db.query(`ALTER TABLE Shipments ADD COLUMN payment_method TEXT`);
            console.log('✅ Migration: added payment_method to Shipments');
        } catch (e) { /* ignore */ }

        // Migration: add created_at to Shipments if missing
        try {
            await db.query(`ALTER TABLE Shipments ADD COLUMN created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`);
            console.log('✅ Migration: added created_at to Shipments');
        } catch (e) { /* ignore */ }

        // Migration: add current_date_time to Shipments if missing
        try {
            await db.query(`ALTER TABLE Shipments ADD COLUMN current_date_time TEXT`);
            console.log('✅ Migration: added current_date_time to Shipments');
        } catch (e) { /* ignore */ }

        // Migration: add animation metadata to Shipments
        try { await db.query(`ALTER TABLE Shipments ADD COLUMN anim_start_lat REAL`); } catch (e) { }
        try { await db.query(`ALTER TABLE Shipments ADD COLUMN anim_start_lng REAL`); } catch (e) { }
        try { await db.query(`ALTER TABLE Shipments ADD COLUMN anim_target_lat REAL`); } catch (e) { }
        try { await db.query(`ALTER TABLE Shipments ADD COLUMN anim_target_lng REAL`); } catch (e) { }
        try { await db.query(`ALTER TABLE Shipments ADD COLUMN anim_start_time TEXT`); } catch (e) { }
        try { await db.query(`ALTER TABLE Shipments ADD COLUMN anim_target_time TEXT`); } catch (e) { }

        // Migration: add coords to TrackingEvents
        try { await db.query(`ALTER TABLE TrackingEvents ADD COLUMN lat REAL`); } catch (e) { }
        try { await db.query(`ALTER TABLE TrackingEvents ADD COLUMN lng REAL`); } catch (e) { }

        // Safe migration: remap legacy admin login emails only (shipments / customers untouched).
        try {
            await db.query(`UPDATE Users SET email = 'info@demarsint.com' WHERE email = 'info@swiftnavlog.com' AND NOT EXISTS (SELECT 1 FROM Users WHERE email = 'info@demarsint.com')`);
            await db.query(`UPDATE Users SET email = 'info@demarsint.com' WHERE email = 'admin@swiftnav.com' AND NOT EXISTS (SELECT 1 FROM Users WHERE email = 'info@demarsint.com')`);
            await db.query(`UPDATE Users SET email = 'info@demarsint.com' WHERE email = 'admin@swiftnavlog.com' AND NOT EXISTS (SELECT 1 FROM Users WHERE email = 'info@demarsint.com')`);
            console.log('✅ Migration: admin login email remapped to info@demarsint.com (shipments untouched)');
        } catch (e) {
            console.error('Migration failed for admin email update:', e);
        }

        // Seed Admin only if missing — never overwrites existing admin password or other users
        await new Promise((resolve, reject) => {
            db.get('SELECT * FROM Users WHERE email = ?', ['info@demarsint.com'], async (err, user) => {
                if (err) return reject(err);
                if (!user) {
                    const hash = await bcrypt.hash('password123', 10);
                    db.run('INSERT INTO Users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
                        ['System Admin', 'info@demarsint.com', hash, 'admin'], (err) => {
                            if (err) reject(err);
                            else {
                                console.log('✅ Admin account seeded: info@demarsint.com / password123');
                                resolve();
                            }
                        });
                } else {
                    if (user.role !== 'admin') {
                        db.run('UPDATE Users SET role = ? WHERE email = ?', ['admin', 'info@demarsint.com'], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    } else {
                        resolve();
                    }
                }
            });
        });

        console.log('✅ Database Schema Verified (existing records preserved).');
    } catch (err) {
        console.error('❌ Database Init Error:', err.message);
        throw err;
    }
};

const ready = initializeDatabase();
db.ready = ready;

module.exports = db;
