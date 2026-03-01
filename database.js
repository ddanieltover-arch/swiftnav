const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database ', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        // Create Users Table
        db.run(`CREATE TABLE IF NOT EXISTS Users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT UNIQUE,
            password_hash TEXT,
            role TEXT DEFAULT 'user',
            is_auto INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            reset_code TEXT,
            reset_expires DATETIME
        )`, (err) => {
            if (err) console.error("Error creating Users table", err);
            else {
                // Migrate existing tables if they don't have the new fields
                db.run(`ALTER TABLE Users ADD COLUMN created_at DATETIME`, () => {
                    // Backfill existing rows with a timestamp
                    db.run(`UPDATE Users SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL`, () => { });
                });
                db.run(`ALTER TABLE Users ADD COLUMN reset_code TEXT`, () => { });
                db.run(`ALTER TABLE Users ADD COLUMN reset_expires DATETIME`, () => { });

                // Seed Admin User
                db.get(`SELECT * FROM Users WHERE email = ?`, ['admin@swiftnav.com'], async (err, row) => {
                    if (!err && !row) {
                        const hash = await bcrypt.hash('password123', 10);
                        db.run(`INSERT INTO Users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
                            ['System Admin', 'admin@swiftnav.com', hash, 'admin']);
                        console.log('Admin user seeded (admin@swiftnav.com / password123)');
                    }
                });
            }
        });

        // Create Shipments Table
        db.run(`CREATE TABLE IF NOT EXISTS Shipments (
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
            current_lat REAL,
            current_lng REAL,
            status TEXT,
            current_date_time TEXT,
            departure_date_time TEXT,
            delivery_date_time TEXT,
            description TEXT,
            origin TEXT,
            destination TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES Users(id)
        )`, (err) => {
            if (err) console.error("Error creating Shipments table", err);
        });

        // Patch existing Shipments table just in case it was created before Module 12
        db.run(`ALTER TABLE Shipments ADD COLUMN is_deleted INTEGER DEFAULT 0`, () => { });

        // Create TrackingEvents Table
        db.run(`CREATE TABLE IF NOT EXISTS TrackingEvents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tracking_number TEXT,
            status_marker TEXT,
            location TEXT,
            description TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(tracking_number) REFERENCES Shipments(tracking_number)
        )`, (err) => {
            if (err) console.error("Error creating TrackingEvents table", err);
        });
    }
});

module.exports = db;
