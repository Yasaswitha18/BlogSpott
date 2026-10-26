const nodemailer = require('nodemailer');
const jwt = require("jsonwebtoken");
const path = require("path");
require('dotenv').config({ path: path.join(__dirname, "..", ".env") });

const getBaseUrl = () => {
    if (process.env.APP_URL) {
        return process.env.APP_URL.replace(/\/+$/, '');
    }
    const domain = (process.env.DOMAIN || `localhost:${process.env.PORT || 3000}`).trim().replace(/\/+$/, '');
    if (domain.startsWith('http://') || domain.startsWith('https://')) {
        return domain;
    }
    const protocol = domain.includes('localhost') || domain.includes('127.0.0.1') ? 'http' : 'https';
    return `${protocol}://${domain}`;
};

const createTransporter = () => {
    const user = process.env.MAIL_ID;
    const pass = process.env.MAIL_PASSWORD;
    if (!user || !pass) {
        console.warn("[MAILER WARNING] MAIL_ID or MAIL_PASSWORD not configured. Emails will fail to send until credentials are set.");
    }
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user,
            pass
        }
    });
};

let transporter = createTransporter();

module.exports = {
    getBaseUrl,
    setTransporter: (customTransporter) => {
        transporter = customTransporter;
    },
    sendVerificationLink: async (userId, email, name) => {
        if (!process.env.ACCESS_TOKEN_SECRET) {
            throw new Error("ACCESS_TOKEN_SECRET is not configured");
        }
        const token = jwt.sign(
            {
                data: { userId, name, email }
            },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: '24h' }
        );
        const baseUrl = getBaseUrl();
        const verificationUrl = `${baseUrl}/auth/verify/${token}`;
        const mailOptions = {
            from: process.env.MAIL_ID || 'no-reply@blogspot.com',
            to: email,
            subject: "Verify your email - BlogSpot",
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #060b10; color: #ffffff; border-radius: 8px;">
                    <h2 style="color: #32E6E2;">Welcome to BlogSpot!</h2>
                    <p>Hi ${name || 'there'},</p>
                    <p>Thank you for signing up. Please click the button below to verify your email address and activate your account:</p>
                    <div style="margin: 30px 0;">
                        <a href="${verificationUrl}" style="background-color: #32E6E2; color: #0C2A2A; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 4px; display: inline-block;">Verify Email</a>
                    </div>
                    <p style="color: #ABB5BF; font-size: 13px;">If the button above does not work, copy and paste this link into your browser:</p>
                    <p style="color: #8efbf7; font-size: 13px; word-break: break-all;">${verificationUrl}</p>
                    <p style="color: #7e8792; font-size: 12px; margin-top: 30px;">This link will expire in 24 hours. If you did not create an account on BlogSpot, please ignore this email.</p>
                </div>
            `
        };

        try {
            await transporter.sendMail(mailOptions);
        } catch (err) {
            console.error(`[MAILER ERROR] Failed to send verification email to recipient:`, err.message);
            throw err;
        }
    },
    sendPasswordResetEmail: async (userId, email, name) => {
        if (!process.env.ACCESS_TOKEN_SECRET) {
            throw new Error("ACCESS_TOKEN_SECRET is not configured");
        }
        const token = jwt.sign(
            {
                data: { userId, name, email }
            },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: '1h' }
        );
        const baseUrl = getBaseUrl();
        const resetUrl = `${baseUrl}/auth/reset/${token}`;
        const mailOptions = {
            from: process.env.MAIL_ID || 'no-reply@blogspot.com',
            to: email,
            subject: "Reset your password - BlogSpot",
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #060b10; color: #ffffff; border-radius: 8px;">
                    <h2 style="color: #32E6E2;">Password Reset Request</h2>
                    <p>Hi ${name || 'there'},</p>
                    <p>We received a request to reset your password. Click the button below to choose a new password:</p>
                    <div style="margin: 30px 0;">
                        <a href="${resetUrl}" style="background-color: #32E6E2; color: #0C2A2A; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 4px; display: inline-block;">Reset Password</a>
                    </div>
                    <p style="color: #ABB5BF; font-size: 13px;">If the button above does not work, copy and paste this link into your browser:</p>
                    <p style="color: #8efbf7; font-size: 13px; word-break: break-all;">${resetUrl}</p>
                    <p style="color: #7e8792; font-size: 12px; margin-top: 30px;">This link will expire in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
                </div>
            `
        };

        try {
            await transporter.sendMail(mailOptions);
        } catch (err) {
            console.error(`[MAILER ERROR] Failed to send password reset email to recipient:`, err.message);
            throw err;
        }
    }
};