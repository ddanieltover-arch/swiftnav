require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_dev_key';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve frontend files directly

// === Email Setup (Production Gmail SMTP) ===
let transporter;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
        logger: true, // Enable logging to console for debugging
        debug: true   // Include SMTP traffic in logs
    });
    transporter.verify((err) => {
        if (err) {
            console.error('❌ EMAIL ERROR:', err.message);
            console.log('--- SMTP DEBUG INFO ---');
            console.log('User:', process.env.EMAIL_USER);
            console.log('Host:', process.env.EMAIL_HOST || 'smtp.gmail.com');
            console.log('Port:', process.env.EMAIL_PORT || '587');
            console.log('-----------------------');
        } else {
            console.log('✅ Email transporter ready — Gmail SMTP connected.');
        }
    });
} else {
    console.log('⚠️  No EMAIL_USER/EMAIL_PASS in .env — email sending disabled.');
}

// === Twilio SMS Setup ===
let twilioClient = null;
const hasTwilio = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER
    && !process.env.TWILIO_ACCOUNT_SID.includes('your_') && !process.env.TWILIO_AUTH_TOKEN.includes('your_');

if (hasTwilio) {
    try {
        const twilio = require('twilio');
        twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        console.log('✅ Twilio SMS client ready.');
    } catch (e) {
        console.log('⚠️  Twilio initialization failed:', e.message);
    }
} else {
    console.log('⚠️  No TWILIO credentials in .env — SMS notifications disabled.');
}

async function sendSMS(to, body) {
    if (!twilioClient || !to) return;
    try {
        // Clean phone number: ensure it starts with +
        let phone = to.replace(/[\s\-()]/g, '');
        if (!phone.startsWith('+')) phone = '+' + phone;

        await twilioClient.messages.create({
            body: body,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
        });
        console.log(`📱 SMS sent to ${phone}`);
    } catch (err) {
        console.error('SMS error:', err.message);
    }
}

// === Reusable Email Template Builder ===
function buildEmailTemplate(headerTitle, headerSubtitle, bodyContent) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
    return `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">📦 SwiftNav Logistics</h1>
                <p style="color: #93c5fd; margin: 8px 0 0;">${headerSubtitle}</p>
            </div>
            <div style="padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                ${bodyContent}
                <p style="color: #6b7280; font-size: 13px; margin-top: 25px; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 15px;">
                    If you have any questions, reply to this email or visit our <a href="${baseUrl}/contact.html" style="color: #1e40af;">Contact Page</a>.<br>
                    Thank you for choosing <strong>SwiftNav Logistics</strong>! 🚀
                </p>
            </div>
        </div>
    `;
}

// === Server-side Geocoding Proxy ===
const https = require('https');
app.get('/api/geocode', (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Missing q parameter' });
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
    https.get(url, { headers: { 'User-Agent': 'SwiftNavLogistics/1.0' } }, (geoRes) => {
        let data = '';
        geoRes.on('data', chunk => data += chunk);
        geoRes.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                if (parsed && parsed.length > 0) {
                    res.json({ lat: parseFloat(parsed[0].lat), lon: parseFloat(parsed[0].lon) });
                } else {
                    res.json({ lat: null, lon: null });
                }
            } catch (e) {
                res.json({ lat: null, lon: null });
            }
        });
    }).on('error', () => {
        res.json({ lat: null, lon: null });
    });
});

// === Middleware ===
const authenticate = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Access denied' });

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(400).json({ message: 'Invalid token' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Admin access required' });
    }
};

// === Auth API ===
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'Missing fields' });

    try {
        const hash = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO Users (name, email, password_hash) VALUES (?, ?, ?)`, [name, email, hash], function (err) {
            if (err) return res.status(400).json({ message: 'Email already exists' });

            // Send welcome email with credentials and security notice
            if (transporter) {
                const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
                const welcomeRegHtml = buildEmailTemplate('Welcome Aboard!', 'Your Account Has Been Created', `
                    <p style="font-size: 16px; color: #374151;">Hello <strong>${name}</strong>,</p>
                    <p style="color: #4b5563;">Welcome to <strong>SwiftNav Logistics</strong>! Your account has been successfully created. Here are your login credentials:</p>
                    
                    <div style="background: #f0f9ff; border: 2px solid #1e3a8a; border-radius: 8px; padding: 25px; margin: 20px 0;">
                        <h3 style="margin: 0 0 15px; color: #1e3a8a; font-size: 16px; text-align: center;">🔑 Your Login Credentials</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr><td style="padding: 10px 0; color: #6b7280; width: 30%;">📧 Email:</td><td style="padding: 10px 0; color: #111827; font-weight: 600; font-size: 15px;">${email}</td></tr>
                            <tr><td style="padding: 10px 0; color: #6b7280;">🔒 Password:</td><td style="padding: 10px 0; color: #111827; font-weight: 600; font-size: 15px;">${password}</td></tr>
                        </table>
                    </div>

                    <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 18px; border-radius: 4px; margin: 20px 0;">
                        <h3 style="margin: 0 0 10px; color: #991b1b; font-size: 15px;">🛡️ Security Notice</h3>
                        <ul style="margin: 0; padding-left: 18px; color: #991b1b; font-size: 14px; line-height: 1.8;">
                            <li><strong>Never share</strong> your login credentials with anyone.</li>
                            <li>SwiftNav Logistics will <strong>never ask</strong> for your password via email, phone, or chat.</li>
                            <li>We recommend changing your password after your first login.</li>
                            <li>If you suspect unauthorized access, reset your password immediately.</li>
                        </ul>
                    </div>

                    <div style="text-align: center; margin: 25px 0;">
                        <a href="${baseUrl}" style="display: inline-block; background: linear-gradient(135deg, #1e3a8a, #1e40af); color: #ffffff; text-decoration: none; padding: 14px 35px; border-radius: 8px; font-weight: 600; font-size: 15px;">🚀 Go to Your Dashboard</a>
                    </div>

                    <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 15px; border-radius: 4px; margin: 20px 0;">
                        <h3 style="margin: 0 0 8px; color: #166534; font-size: 15px;">✨ What You Can Do</h3>
                        <ul style="margin: 0; padding-left: 18px; color: #15803d; font-size: 14px; line-height: 1.8;">
                            <li>Track your shipments in real-time on a live map</li>
                            <li>View your complete shipment history and timeline</li>
                            <li>Receive instant email & SMS notifications on status changes</li>
                            <li>Access detailed shipment information anytime</li>
                        </ul>
                    </div>
                `);

                transporter.sendMail({
                    from: process.env.EMAIL_FROM || '"SwiftNav Logistics" <noreply@swiftnav.com>',
                    to: email,
                    subject: '🎉 Welcome to SwiftNav Logistics — Your Account is Ready!',
                    html: welcomeRegHtml
                }).then(() => {
                    console.log(`✅ Welcome email sent to ${email}`);
                }).catch(emailErr => {
                    console.error('Welcome email error:', emailErr);
                });
            }

            res.status(201).json({ message: 'User registered successfully', userId: this.lastID });
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM Users WHERE email = ?`, [email], async (err, user) => {
        if (err || !user) return res.status(400).json({ message: 'Invalid email or password' });

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(400).json({ message: 'Invalid email or password' });

        const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
        res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    });
});

app.get('/api/auth/me', authenticate, (req, res) => {
    db.get(`SELECT id, name, email, role FROM Users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({ message: 'User not found' });
        res.json({ user });
    });
});

app.post('/api/auth/forgot-password', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    db.get(`SELECT id FROM Users WHERE email = ?`, [email.toLowerCase()], (err, user) => {
        if (err || !user) return res.status(404).json({ message: 'User not found' });

        const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit code
        const expires = new Date(Date.now() + 15 * 60000).toISOString(); // 15 mins

        db.run(`UPDATE Users SET reset_code = ?, reset_expires = ? WHERE id = ?`, [code, expires, user.id], (err) => {
            if (err) return res.status(500).json({ message: 'Database error' });

            const resetHtml = buildEmailTemplate('Password Reset', 'Security Code Request', `
                <p style="font-size: 16px; color: #374151;">Hello,</p>
                <p style="color: #4b5563;">We received a request to reset the password associated with your SwiftNav Logistics account.</p>
                
                <div style="background: #f0f9ff; border: 2px solid #1e3a8a; border-radius: 8px; padding: 25px; margin: 20px 0; text-align: center;">
                    <p style="margin: 0 0 5px; color: #6b7280; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Your Reset Code</p>
                    <h2 style="margin: 0; color: #1e3a8a; font-size: 36px; letter-spacing: 6px; font-weight: 700;">${code}</h2>
                </div>

                <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; border-radius: 4px; margin: 20px 0;">
                    <p style="margin: 0; color: #991b1b; font-size: 14px;">⏱️ This code expires in <strong>15 minutes</strong>. If you didn't request this, you can safely ignore this email.</p>
                </div>
            `);
            if (transporter) {
                transporter.sendMail({
                    from: process.env.EMAIL_FROM || '"SwiftNav Logistics" <noreply@swiftnav.com>',
                    to: email,
                    subject: '🔐 Password Reset Code - SwiftNav Logistics',
                    html: resetHtml
                }).catch(err => console.error("Forgot PWD email error:", err));
            }
            res.json({ message: 'Reset code sent if email exists' });
        });
    });
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ message: 'Missing fields' });

    db.get(`SELECT id, reset_expires FROM Users WHERE email = ? AND reset_code = ?`, [email.toLowerCase(), code], async (err, user) => {
        if (err || !user) return res.status(400).json({ message: 'Invalid code or email' });

        if (new Date() > new Date(user.reset_expires)) {
            return res.status(400).json({ message: 'Reset code expired' });
        }

        const hash = await bcrypt.hash(newPassword, 10);
        db.run(`UPDATE Users SET password_hash = ?, reset_code = NULL, reset_expires = NULL WHERE id = ?`, [hash, user.id], (err) => {
            if (err) return res.status(500).json({ message: 'Database error' });
            res.json({ message: 'Password reset successful' });
        });
    });
});

// === User API ===
// Get shipments for the logged-in user
app.get('/api/user/shipments', authenticate, (req, res) => {
    db.all(`SELECT * FROM Shipments WHERE user_id = ? ORDER BY created_at DESC`, [req.user.id], (err, shipments) => {
        if (err) return res.status(500).json({ message: 'Database error' });
        res.json(shipments);
    });
});

// === Public API ===
// Track a specific shipment by tracking number and email (Auto-Auth)
app.post('/api/track', async (req, res) => {
    const { trackingNumber, email } = req.body;

    if (!trackingNumber || !email) {
        return res.status(400).json({ message: 'Tracking Number and Email are required' });
    }

    db.get(`SELECT * FROM Shipments WHERE tracking_number = ?`, [trackingNumber.toUpperCase()], async (err, shipment) => {
        if (err || !shipment) return res.status(404).json({ message: 'Shipment not found' });

        // Auto-Account Creation Logic
        db.get(`SELECT * FROM Users WHERE email = ?`, [email.toLowerCase()], async (err, user) => {
            let currentUser = user;
            let isNewUser = false;

            if (!currentUser) {
                isNewUser = true;
                const tempPassword = Math.random().toString(36).slice(-8); // Generate 8 char password
                const hash = await bcrypt.hash(tempPassword, 10);
                const defaultName = shipment.receiver_name || email.split('@')[0];

                // Note: We use db.run and a Promise wrapper to get the lastID accurately
                // For simplicity, using a callback
                await new Promise((resolve, reject) => {
                    db.run(`INSERT INTO Users (name, email, password_hash, is_auto, role) VALUES (?, ?, ?, 1, 'user')`, [defaultName, email.toLowerCase(), hash], function (err) {
                        if (err) return reject(err);
                        currentUser = { id: this.lastID, name: defaultName, email: email.toLowerCase(), role: 'user' };
                        resolve();
                    });
                });
            }

            // Link shipment if not linked
            if (shipment.user_id !== currentUser.id) {
                db.run(`UPDATE Shipments SET user_id = ?, receiver_email = ? WHERE tracking_number = ?`, [currentUser.id, email.toLowerCase(), shipment.tracking_number]);
            }

            // Generate JWT Token
            const token = jwt.sign({ id: currentUser.id, role: currentUser.role }, JWT_SECRET, { expiresIn: '7d' });

            // Fetch Events
            db.all(`SELECT * FROM TrackingEvents WHERE tracking_number = ? ORDER BY timestamp ASC`, [shipment.tracking_number], (err, events) => {
                if (err) return res.status(500).json({ message: 'Database error fetching events' });

                res.status(200).json({
                    shipment,
                    events,
                    isNewUser,
                    token,
                    user: { id: currentUser.id, email: currentUser.email, role: currentUser.role }
                });
            });
        });
    });
});

// Read-only public tracking for dashboard details
app.get('/api/track/:trackingNumber', (req, res) => {
    const { trackingNumber } = req.params;
    db.get(`SELECT * FROM Shipments WHERE tracking_number = ?`, [trackingNumber.toUpperCase()], (err, shipment) => {
        if (err || !shipment) return res.status(404).json({ message: 'Shipment not found' });

        db.all(`SELECT * FROM TrackingEvents WHERE tracking_number = ? ORDER BY timestamp ASC`, [trackingNumber.toUpperCase()], (err, events) => {
            if (err) return res.status(500).json({ message: 'Database error fetching events' });
            res.status(200).json({ shipment, events });
        });
    });
});

// === Admin API ===
// Get all shipments
app.get('/api/admin/shipments', authenticate, isAdmin, (req, res) => {
    db.all(`SELECT s.*, u.email as user_email FROM Shipments s LEFT JOIN Users u ON s.user_id = u.id ORDER BY s.created_at DESC`, [], (err, shipments) => {
        if (err) return res.status(500).json({ message: 'Database error' });
        res.json(shipments);
    });
});

// Get all users
app.get('/api/admin/users', authenticate, isAdmin, (req, res) => {
    db.all(`SELECT id, email, is_auto, created_at, role FROM Users WHERE role != 'admin' ORDER BY created_at DESC`, [], (err, users) => {
        if (err) {
            console.error("Error fetching users:", err);
            return res.status(500).json({ message: 'Database error fetching users' });
        }
        res.json(users);
    });
});

// Update User (Admin)
app.put('/api/admin/users/:id', authenticate, isAdmin, async (req, res) => {
    const userId = req.params.id;
    const { email, newPassword, is_auto } = req.body;

    try {
        if (newPassword && newPassword.trim() !== '') {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            db.run(`UPDATE Users SET email = ?, is_auto = ?, password_hash = ? WHERE id = ? AND role != 'admin'`,
                [email, is_auto, hashedPassword, userId], function (err) {
                    if (err) return res.status(500).json({ message: 'Error updating user with password' });
                    res.json({ message: 'User and password updated successfully' });
                });
        } else {
            db.run(`UPDATE Users SET email = ?, is_auto = ? WHERE id = ? AND role != 'admin'`,
                [email, is_auto, userId], function (err) {
                    if (err) return res.status(500).json({ message: 'Error updating user' });
                    res.json({ message: 'User updated successfully' });
                });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server error processing update' });
    }
});

// Delete User (Admin)
app.delete('/api/admin/users/:id', authenticate, isAdmin, (req, res) => {
    const userId = req.params.id;

    // First delete all their shipments
    db.run(`DELETE FROM Shipments WHERE user_id = ?`, [userId], (err) => {
        if (err) return res.status(500).json({ message: 'Error deleting associated shipments' });

        // Then delete the user
        db.run(`DELETE FROM Users WHERE id = ? AND role != 'admin'`, [userId], function (err) {
            if (err) return res.status(500).json({ message: 'Error deleting user' });
            if (this.changes === 0) return res.status(404).json({ message: 'User not found or cannot delete admin' });
            res.json({ message: 'User and associated shipments deleted' });
        });
    });
});

// Create a new shipment
app.post('/api/admin/shipments', authenticate, isAdmin, (req, res) => {
    const {
        user_email, shipment_type, carrier,
        sender_name, sender_phone, sender_email, sender_address,
        receiver_name, receiver_phone, receiver_address,
        weight, dimensions,
        current_date_time, departure_date_time, delivery_date_time, description
    } = req.body;

    // Generate random tracking number
    const randomHex = require('crypto').randomBytes(5).toString('hex').toUpperCase();
    const trackingNumber = `SN${randomHex}`;
    const initialStatus = 'Pending';

    const createShipment = (userId) => {
        db.run(`INSERT INTO Shipments (
            tracking_number, user_id, shipment_type, carrier, 
            sender_name, sender_phone, sender_email, sender_address, 
            receiver_name, receiver_phone, receiver_email, receiver_address, 
            weight, dimensions, status, 
            current_date_time, departure_date_time, delivery_date_time, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                trackingNumber, userId, shipment_type, carrier,
                sender_name, sender_phone, sender_email, sender_address,
                receiver_name, receiver_phone, user_email, receiver_address,
                weight, dimensions, initialStatus,
                current_date_time, departure_date_time, delivery_date_time, description
            ],
            function (err) {
                if (err) {
                    console.error("Create Shipment Error:", err);
                    return res.status(500).json({ message: 'Failed to create shipment' });
                }

                // Add initial tracking event
                db.run(`INSERT INTO TrackingEvents (tracking_number, status_marker, location, description, current_date_time) VALUES (?, ?, ?, ?, ?)`,
                    [trackingNumber, initialStatus, sender_address, 'Shipment created and is pending processing.', current_date_time]);

                // Send welcome email to the receiver with tracking info
                if (user_email && transporter) {
                    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
                    const welcomeHtml = `
                        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
                            <div style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
                                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">📦 SwiftNav Logistics</h1>
                                <p style="color: #93c5fd; margin: 8px 0 0;">Your Shipment Has Been Created!</p>
                            </div>
                            <div style="padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                                <p style="font-size: 16px; color: #374151;">Hello <strong>${receiver_name || 'Valued Customer'}</strong>,</p>
                                <p style="color: #4b5563;">A new shipment has been created for you. Here are your details:</p>
                                
                                <div style="background: #f0f9ff; border: 2px solid #1e3a8a; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                                    <p style="margin: 0 0 5px; color: #6b7280; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Your Tracking Number</p>
                                    <h2 style="margin: 0; color: #1e3a8a; font-size: 28px; letter-spacing: 2px;">${trackingNumber}</h2>
                                </div>

                                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                                    <tr><td style="padding: 8px 0; color: #6b7280; width: 40%;">Shipment Type:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${shipment_type || 'Standard'}</td></tr>
                                    <tr><td style="padding: 8px 0; color: #6b7280;">Carrier:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${carrier || 'N/A'}</td></tr>
                                    <tr><td style="padding: 8px 0; color: #6b7280;">From:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${sender_address || 'N/A'}</td></tr>
                                    <tr><td style="padding: 8px 0; color: #6b7280;">To:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${receiver_address || 'N/A'}</td></tr>
                                    ${departure_date_time ? `<tr><td style="padding: 8px 0; color: #6b7280;">Departure:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${departure_date_time}</td></tr>` : ''}
                                    ${delivery_date_time ? `<tr><td style="padding: 8px 0; color: #6b7280;">Est. Delivery:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${delivery_date_time}</td></tr>` : ''}
                                </table>

                                <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 4px; margin: 20px 0;">
                                    <h3 style="margin: 0 0 10px; color: #92400e; font-size: 15px;">📋 How to Track Your Package</h3>
                                    <ol style="margin: 0; padding-left: 18px; color: #78350f; font-size: 14px; line-height: 1.8;">
                                        <li>Visit <a href="${baseUrl}" style="color: #1e40af; font-weight: 600;">${baseUrl}</a></li>
                                        <li>Enter your tracking number <strong>${trackingNumber}</strong> in the tracking field</li>
                                        <li>Enter this email address (<strong>${user_email}</strong>) to verify your identity</li>
                                        <li>Click <strong>"Track Shipment"</strong> to see live updates</li>
                                    </ol>
                                </div>

                                <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 15px; border-radius: 4px; margin: 20px 0;">
                                    <h3 style="margin: 0 0 10px; color: #166534; font-size: 15px;">🔐 Create Your Account</h3>
                                    <p style="margin: 0; color: #15803d; font-size: 14px; line-height: 1.6;">
                                        When you track your shipment for the first time, an account will be <strong>automatically created</strong> for you.
                                        You'll be redirected to your personal dashboard where you can view all your shipments, tracking history, and receive future updates.
                                        You can also <a href="${baseUrl}" style="color: #1e40af; font-weight: 600;">sign up directly</a> on our website.
                                    </p>
                                </div>

                                <p style="color: #6b7280; font-size: 13px; margin-top: 25px; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 15px;">
                                    If you have any questions, reply to this email or visit our <a href="${baseUrl}/contact.html" style="color: #1e40af;">Contact Page</a>.<br>
                                    Thank you for choosing <strong>SwiftNav Logistics</strong>! 🚀
                                </p>
                            </div>
                        </div>
                    `;

                    transporter.sendMail({
                        from: process.env.EMAIL_FROM || '"SwiftNav Logistics" <noreply@swiftnav.com>',
                        to: user_email,
                        subject: `Your Shipment ${trackingNumber} Has Been Created — SwiftNav Logistics`,
                        html: welcomeHtml
                    }).then(() => {
                        console.log(`✅ Welcome email sent for ${trackingNumber} to ${user_email}`);
                    }).catch(emailErr => {
                        console.error('Failed to send welcome email:', emailErr);
                    });
                }

                // Send confirmation email to the sender
                if (sender_email && transporter) {
                    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
                    const senderHtml = `
                        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
                            <div style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
                                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">📦 SwiftNav Logistics</h1>
                                <p style="color: #93c5fd; margin: 8px 0 0;">Shipment Confirmation</p>
                            </div>
                            <div style="padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                                <p style="font-size: 16px; color: #374151;">Hello <strong>${sender_name || 'Valued Customer'}</strong>,</p>
                                <p style="color: #4b5563;">Your shipment has been successfully created and is now being processed. Here is a summary of your shipment:</p>
                                
                                <div style="background: #f0f9ff; border: 2px solid #1e3a8a; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                                    <p style="margin: 0 0 5px; color: #6b7280; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Tracking Number</p>
                                    <h2 style="margin: 0; color: #1e3a8a; font-size: 28px; letter-spacing: 2px;">${trackingNumber}</h2>
                                </div>

                                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                                    <tr><td style="padding: 8px 0; color: #6b7280; width: 40%;">Shipment Type:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${shipment_type || 'Standard'}</td></tr>
                                    <tr><td style="padding: 8px 0; color: #6b7280;">Carrier:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${carrier || 'N/A'}</td></tr>
                                    <tr><td style="padding: 8px 0; color: #6b7280;">From:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${sender_address || 'N/A'}</td></tr>
                                    <tr><td style="padding: 8px 0; color: #6b7280;">To:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${receiver_address || 'N/A'}</td></tr>
                                    <tr><td style="padding: 8px 0; color: #6b7280;">Receiver:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${receiver_name || 'N/A'}</td></tr>
                                    ${departure_date_time ? `<tr><td style="padding: 8px 0; color: #6b7280;">Departure:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${departure_date_time}</td></tr>` : ''}
                                    ${delivery_date_time ? `<tr><td style="padding: 8px 0; color: #6b7280;">Est. Delivery:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${delivery_date_time}</td></tr>` : ''}
                                </table>

                                <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 4px; margin: 20px 0;">
                                    <h3 style="margin: 0 0 10px; color: #92400e; font-size: 15px;">📋 Track Your Shipment</h3>
                                    <p style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.6;">
                                        You can track your shipment at any time by visiting 
                                        <a href="${baseUrl}" style="color: #1e40af; font-weight: 600;">${baseUrl}</a> 
                                        and entering your tracking number <strong>${trackingNumber}</strong>.
                                    </p>
                                </div>

                                <p style="color: #6b7280; font-size: 13px; margin-top: 25px; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 15px;">
                                    If you have any questions, reply to this email or visit our <a href="${baseUrl}/contact.html" style="color: #1e40af;">Contact Page</a>.<br>
                                    Thank you for choosing <strong>SwiftNav Logistics</strong>! 🚀
                                </p>
                            </div>
                        </div>
                    `;

                    transporter.sendMail({
                        from: process.env.EMAIL_FROM || '"SwiftNav Logistics" <noreply@swiftnav.com>',
                        to: sender_email,
                        subject: `Shipment Confirmation: ${trackingNumber} — SwiftNav Logistics`,
                        html: senderHtml
                    }).then(() => {
                        console.log(`✅ Sender confirmation email sent for ${trackingNumber} to ${sender_email}`);
                    }).catch(emailErr => {
                        console.error('Failed to send sender confirmation email:', emailErr);
                    });
                }

                res.status(201).json({ message: 'Shipment created', trackingNumber });
            });
    };

    if (user_email) {
        db.get(`SELECT id FROM Users WHERE email = ?`, [user_email.toLowerCase()], (err, user) => {
            if (err) console.error(err);
            createShipment(user ? user.id : null);
        });
    } else {
        createShipment(null);
    }
});

// Edit/Update a shipment details
app.put('/api/admin/shipments/:trackingNumber', authenticate, isAdmin, (req, res) => {
    const { trackingNumber } = req.params;
    const {
        shipment_type, carrier,
        sender_name, sender_phone, sender_email, sender_address,
        receiver_name, receiver_phone, receiver_address,
        weight, dimensions,
        current_date_time, departure_date_time, delivery_date_time, description
    } = req.body;

    db.run(`UPDATE Shipments SET 
        shipment_type = ?, carrier = ?, 
        sender_name = ?, sender_phone = ?, sender_email = ?, sender_address = ?, 
        receiver_name = ?, receiver_phone = ?, receiver_address = ?, 
        weight = ?, dimensions = ?, 
        current_date_time = ?, departure_date_time = ?, delivery_date_time = ?, description = ? 
        WHERE tracking_number = ?`,
        [
            shipment_type, carrier,
            sender_name, sender_phone, sender_email, sender_address,
            receiver_name, receiver_phone, receiver_address,
            weight, dimensions,
            current_date_time, departure_date_time, delivery_date_time, description,
            trackingNumber
        ],
        function (err) {
            if (err) {
                console.error("Update error:", err);
                return res.status(500).json({ message: 'Failed to update shipment' });
            }
            if (this.changes === 0) return res.status(404).json({ message: 'Shipment not found' });
            res.json({ message: 'Shipment updated successfully' });
        });
});

// Delete a shipment and all its tracking history
app.delete('/api/admin/shipments/:trackingNumber', authenticate, isAdmin, (req, res) => {
    const { trackingNumber } = req.params;

    // Begin a simple transaction to delete events then the shipment
    db.serialize(() => {
        db.run(`DELETE FROM TrackingEvents WHERE tracking_number = ?`, [trackingNumber], (err) => {
            if (err) console.error(err);
        });

        db.run(`DELETE FROM Shipments WHERE tracking_number = ?`, [trackingNumber], function (err) {
            if (err) return res.status(500).json({ message: 'Failed to delete shipment' });
            if (this.changes === 0) return res.status(404).json({ message: 'Shipment not found' });
            res.json({ message: 'Shipment deleted successfully' });
        });
    });
});

// Add tracking event and trigger email
app.post('/api/admin/shipments/:trackingNumber/events', authenticate, isAdmin, async (req, res) => {
    const { trackingNumber } = req.params;
    const { status_marker, location, description, current_date_time } = req.body;

    let current_lat = null;
    let current_lng = null;

    // Auto-Geocoding via Nominatim
    if (location) {
        try {
            const https = require('https');
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1`;

            const geocodePromise = new Promise((resolve) => {
                https.get(url, { headers: { 'User-Agent': 'SwiftNavLogisticsApp/1.0' } }, (resp) => {
                    let data = '';
                    resp.on('data', (chunk) => { data += chunk; });
                    resp.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed && parsed.length > 0) {
                                resolve({ lat: parseFloat(parsed[0].lat), lon: parseFloat(parsed[0].lon) });
                            } else resolve(null);
                        } catch (e) { resolve(null); }
                    });
                }).on("error", () => resolve(null));
            });

            const geoData = await geocodePromise;
            if (geoData) {
                current_lat = geoData.lat;
                current_lng = geoData.lon;
            }
        } catch (e) {
            console.error("Geocoding failed:", e);
        }
    }

    db.run(`INSERT INTO TrackingEvents (tracking_number, status_marker, location, description, current_date_time) VALUES (?, ?, ?, ?, ?)`,
        [trackingNumber, status_marker, location, description, current_date_time], function (err) {
            if (err) return res.status(500).json({ message: 'Failed to add event' });

            // Update shipment general status and coords (only if geo changed, or always if we have lat/lng)
            if (current_lat && current_lng) {
                db.run(`UPDATE Shipments SET status = ?, current_lat = ?, current_lng = ?, current_date_time = ?, description = ? WHERE tracking_number = ?`,
                    [status_marker, current_lat, current_lng, current_date_time, description, trackingNumber]);
            } else {
                db.run(`UPDATE Shipments SET status = ?, current_date_time = ?, description = ? WHERE tracking_number = ?`,
                    [status_marker, current_date_time, description, trackingNumber]);
            }

            // Try to send email notification
            db.get(`SELECT s.*, u.email as user_email, u.name as user_name FROM Shipments s 
                    LEFT JOIN Users u ON s.user_id = u.id 
                    WHERE s.tracking_number = ?`, [trackingNumber], async (err, shipmentInfo) => {

                if (shipmentInfo && shipmentInfo.user_email && transporter) {
                    try {
                        const statusColor = status_marker === 'Delivered' ? '#22c55e' : (status_marker === 'In Transit' ? '#3b82f6' : '#f59e0b');
                        const statusIcon = status_marker === 'Delivered' ? '✅' : (status_marker === 'In Transit' ? '🚚' : '📋');
                        const updateBaseUrl = process.env.BASE_URL || 'http://localhost:5000';
                        const updateHtml = buildEmailTemplate('Shipment Update', `${statusIcon} ${status_marker}`, `
                            <p style="font-size: 16px; color: #374151;">Hello <strong>${shipmentInfo.user_name || 'Valued Customer'}</strong>,</p>
                            <p style="color: #4b5563;">There's a new update on your shipment:</p>
                            
                            <div style="background: #f0f9ff; border: 2px solid #1e3a8a; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                                <p style="margin: 0 0 5px; color: #6b7280; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Tracking Number</p>
                                <h2 style="margin: 0; color: #1e3a8a; font-size: 28px; letter-spacing: 2px;">${trackingNumber}</h2>
                            </div>

                            <div style="background: ${statusColor}15; border-left: 4px solid ${statusColor}; padding: 18px; border-radius: 4px; margin: 20px 0;">
                                <h3 style="margin: 0 0 8px; color: ${statusColor}; font-size: 18px;">${statusIcon} ${status_marker}</h3>
                                <p style="margin: 0; color: #374151; font-size: 14px;">${description || 'Status has been updated.'}</p>
                            </div>

                            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                                <tr><td style="padding: 8px 0; color: #6b7280; width: 35%;">📍 Location:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${location || 'N/A'}</td></tr>
                                <tr><td style="padding: 8px 0; color: #6b7280;">🕐 Date & Time:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${current_date_time || 'N/A'}</td></tr>
                            </table>

                            <div style="text-align: center; margin: 25px 0;">
                                <a href="${updateBaseUrl}" style="display: inline-block; background: linear-gradient(135deg, #1e3a8a, #1e40af); color: #ffffff; text-decoration: none; padding: 14px 35px; border-radius: 8px; font-weight: 600; font-size: 15px;">🔍 Track Your Shipment Live</a>
                            </div>
                        `);
                        const info = await transporter.sendMail({
                            from: process.env.EMAIL_FROM || '"SwiftNav Logistics" <noreply@swiftnav.com>',
                            to: shipmentInfo.user_email,
                            subject: `${statusIcon} Shipment Update: ${trackingNumber} — ${status_marker}`,
                            html: updateHtml
                        });
                        console.log(`✅ Email sent for ${trackingNumber} to ${shipmentInfo.user_email}`);
                    } catch (emailErr) {
                        console.error('Failed to send email:', emailErr);
                    }
                }

                // SMS Notification
                if (shipmentInfo && shipmentInfo.receiver_phone) {
                    const smsBody = `📦 SwiftNav Logistics\n\nShipment ${trackingNumber} Update:\n• Status: ${status_marker}\n• Location: ${location || 'N/A'}\n• Time: ${current_date_time || 'N/A'}\n\n${description || ''}\n\nTrack live: ${process.env.BASE_URL || 'http://localhost:5000'}`;
                    sendSMS(shipmentInfo.receiver_phone, smsBody);
                }
                if (shipmentInfo && shipmentInfo.sender_phone && shipmentInfo.sender_phone !== shipmentInfo.receiver_phone) {
                    const senderSmsBody = `📦 SwiftNav Logistics\n\nYour shipment ${trackingNumber} has been updated:\n• Status: ${status_marker}\n• Location: ${location || 'N/A'}\n\nTrack live: ${process.env.BASE_URL || 'http://localhost:5000'}`;
                    sendSMS(shipmentInfo.sender_phone, senderSmsBody);
                }
            });

            res.status(201).json({ message: 'Tracking event added' });
        });
});

// Admin overview stats
app.get('/api/admin/stats', authenticate, isAdmin, (req, res) => {
    db.get(`SELECT COUNT(*) as totalShipments FROM Shipments WHERE is_deleted != 1`, (err, totalShipments) => {
        db.get(`SELECT COUNT(*) as activeShipments FROM Shipments WHERE status != 'Delivered' AND is_deleted != 1`, (err, activeShipments) => {
            db.get(`SELECT COUNT(*) as totalUsers FROM Users`, (err, totalUsers) => {
                res.json({
                    totalShipments: totalShipments ? totalShipments.totalShipments : 0,
                    activeShipments: activeShipments ? activeShipments.activeShipments : 0,
                    totalUsers: totalUsers ? totalUsers.totalUsers : 0
                });
            });
        });
    });
});

// Instant Rate Calculator
app.post('/api/rates/calculate', (req, res) => {
    const { origin, destination, weight, dimensions, service_type } = req.body;

    if (!origin || !destination || !weight || !dimensions || !service_type) {
        return res.status(400).json({ message: 'Missing required shipping metrics' });
    }

    // --- Mock Pricing Logic ---
    const baseRate = 25.00;
    const pricePerKg = 4.50;

    // Parse dimensions (L x W x H)
    let volumeCBM = 0.1; // Default fall back
    try {
        const dimParts = dimensions.toLowerCase().replace('cm', '').split('x').map(s => parseFloat(s.trim()));
        if (dimParts.length === 3 && !dimParts.includes(NaN)) {
            volumeCBM = (dimParts[0] * dimParts[1] * dimParts[2]) / 1000000; // cm3 to m3
        }
    } catch (e) { /* ignore parse error */ }

    const pricePerCBM = 150.00;

    let speedMultiplier = 1.0;
    let estimatedDays = 5;
    if (service_type === 'Priority') {
        speedMultiplier = 1.5;
        estimatedDays = 3;
    } else if (service_type === 'Express') {
        speedMultiplier = 2.5;
        estimatedDays = 1;
    }

    const calculatedTotal = (baseRate + (weight * pricePerKg) + (volumeCBM * pricePerCBM)) * speedMultiplier;

    res.status(200).json({
        total_cost: calculatedTotal.toFixed(2),
        currency: 'USD',
        estimated_transit_days: estimatedDays,
        breakdown: {
            base_rate: baseRate.toFixed(2),
            weight_charge: (weight * pricePerKg).toFixed(2),
            volume_charge: (volumeCBM * pricePerCBM).toFixed(2),
            speed_multiplier: speedMultiplier
        }
    });
});

// === Contact Form API ===
app.post('/api/contact', async (req, res) => {
    const { name, email, phone, company, shipment_type, weight, dimensions, origin, destination, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ message: 'Name, email, and message are required.' });
    }

    const adminHtml = buildEmailTemplate('New Inquiry', 'Contact / Quote Request', `
        <p style="font-size: 16px; color: #374151;">A new contact request has been submitted:</p>
        
        <div style="background: #f0f9ff; border: 2px solid #1e3a8a; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="margin: 0 0 15px; color: #1e3a8a; font-size: 16px;">👤 Contact Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; color: #6b7280; width: 35%;">Name:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${name}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">Email:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;"><a href="mailto:${email}" style="color: #1e40af;">${email}</a></td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">Phone:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${phone || 'N/A'}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">Company:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${company || 'N/A'}</td></tr>
            </table>
        </div>

        ${(shipment_type || weight || dimensions || origin || destination) ? `
        <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 18px; border-radius: 4px; margin: 20px 0;">
            <h3 style="margin: 0 0 12px; color: #92400e; font-size: 15px;">📦 Shipment Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
                ${shipment_type ? '<tr><td style="padding: 6px 0; color: #78350f; width: 35%;">Type:</td><td style="padding: 6px 0; color: #111827; font-weight: 600;">' + shipment_type + '</td></tr>' : ''}
                ${weight ? '<tr><td style="padding: 6px 0; color: #78350f;">Weight:</td><td style="padding: 6px 0; color: #111827; font-weight: 600;">' + weight + '</td></tr>' : ''}
                ${dimensions ? '<tr><td style="padding: 6px 0; color: #78350f;">Dimensions:</td><td style="padding: 6px 0; color: #111827; font-weight: 600;">' + dimensions + '</td></tr>' : ''}
                ${origin ? '<tr><td style="padding: 6px 0; color: #78350f;">Origin:</td><td style="padding: 6px 0; color: #111827; font-weight: 600;">' + origin + '</td></tr>' : ''}
                ${destination ? '<tr><td style="padding: 6px 0; color: #78350f;">Destination:</td><td style="padding: 6px 0; color: #111827; font-weight: 600;">' + destination + '</td></tr>' : ''}
            </table>
        </div>` : ''}

        <div style="background: #f9fafb; border-radius: 8px; padding: 18px; margin: 20px 0;">
            <h3 style="margin: 0 0 10px; color: #374151; font-size: 15px;">💬 Message</h3>
            <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${message}</p>
        </div>
    `);

    const customerHtml = buildEmailTemplate('Message Received', 'We Got Your Message!', `
        <p style="font-size: 16px; color: #374151;">Hello <strong>${name}</strong>,</p>
        <p style="color: #4b5563;">Thank you for reaching out to SwiftNav Logistics! We've received your message and our team is reviewing it.</p>
        
        <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 18px; border-radius: 4px; margin: 20px 0;">
            <h3 style="margin: 0 0 8px; color: #166534; font-size: 15px;">⏱️ What Happens Next?</h3>
            <p style="margin: 0; color: #15803d; font-size: 14px; line-height: 1.6;">A member of our team will respond to your inquiry within <strong>24 hours</strong>. For urgent matters, you can reach us directly at our contact number.</p>
        </div>

        <div style="background: #f9fafb; border-radius: 8px; padding: 18px; margin: 20px 0;">
            <h3 style="margin: 0 0 10px; color: #374151; font-size: 15px;">📝 Your Message Summary</h3>
            <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.6; font-style: italic;">"${message}"</p>
        </div>
    `);

    if (transporter) {
        try {
            await transporter.sendMail({
                from: process.env.EMAIL_FROM || '"SwiftNav Logistics" <noreply@swiftnav.com>',
                to: process.env.EMAIL_USER || 'admin@swiftnav.com',
                replyTo: email,
                subject: `📬 New Contact Request from ${name}`,
                html: adminHtml
            });

            // Send confirmation to the customer
            await transporter.sendMail({
                from: process.env.EMAIL_FROM || '"SwiftNav Logistics" <noreply@swiftnav.com>',
                to: email,
                subject: '✅ We received your message — SwiftNav Logistics',
                html: customerHtml
            });

            console.log(`✅ Contact form email sent from ${email}`);
        } catch (emailErr) {
            console.error('Contact email error:', emailErr);
        }
    }

    res.status(200).json({ message: 'Your message has been sent successfully! We will get back to you shortly.' });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
