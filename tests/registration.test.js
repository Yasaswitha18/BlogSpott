const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");
const bcrypt = require("bcryptjs");
const db = require("../db/postgresql.js");
const auth = require("../utilities/auth.js");
const mailer = require("../utilities/mailer.js");
const MockDb = require("./mockDb.js");

describe("User Registration Flow", () => {
    let mockDb;
    let sentEmails = [];

    beforeEach(() => {
        process.env.ACCESS_TOKEN_SECRET = "test_jwt_secret_key_1234567890";
        process.env.DOMAIN = "test.blogspot.com";
        
        mockDb = new MockDb();
        db.setPool(mockDb);

        sentEmails = [];
        mailer.setTransporter({
            sendMail: async (options) => {
                sentEmails.push(options);
                return { messageId: "mock-123" };
            }
        });
    });

    test("1. Valid new user registration succeeds and stores user with hashed password", async () => {
        const response = await auth.createNewUser("  Jane Doe  ", "Jane.Doe@Example.com", "SecretPass123");

        assert.strictEqual(response.status, "success");
        assert.strictEqual(response.title, "Account successfully created");
        assert(response.info.includes("verification link"));

        // Verify stored user in database
        assert.strictEqual(mockDb.users.length, 1);
        const storedUser = mockDb.users[0];
        assert.strictEqual(storedUser.name, "Jane Doe");
        assert.strictEqual(storedUser.email, "jane.doe@example.com");
        assert.strictEqual(storedUser.isverified, false);

        // Verify password is fully hashed, not plaintext
        assert.notStrictEqual(storedUser.password, "SecretPass123");
        assert(storedUser.password.startsWith("$2a$") || storedUser.password.startsWith("$2b$"));
        const match = await bcrypt.compare("SecretPass123", storedUser.password);
        assert.strictEqual(match, true);

        // Verify email was dispatched
        assert.strictEqual(sentEmails.length, 1);
        assert.strictEqual(sentEmails[0].to, "jane.doe@example.com");
        assert(sentEmails[0].html.includes("https://test.blogspot.com/auth/verify/"));
    });

    test("2. Rejects registration when required fields are missing or invalid", async () => {
        // Missing name
        const res1 = await auth.createNewUser("", "test@example.com", "SecretPass123");
        assert.strictEqual(res1.status, "error");
        assert.strictEqual(res1.title, "Validation Error");

        // Invalid email
        const res2 = await auth.createNewUser("Jane Doe", "invalid-email-format", "SecretPass123");
        assert.strictEqual(res2.status, "error");
        assert.strictEqual(res2.title, "Validation Error");

        // Short password
        const res3 = await auth.createNewUser("Jane Doe", "test@example.com", "123");
        assert.strictEqual(res3.status, "error");
        assert.strictEqual(res3.title, "Validation Error");

        // Database should be empty
        assert.strictEqual(mockDb.users.length, 0);
    });

    test("3. Handles duplicate email registration gracefully when already verified", async () => {
        // Pre-populate verified user
        mockDb.users.push({
            userid: 99,
            name: "Existing User",
            email: "existing@example.com",
            password: "hashed_password",
            isverified: true,
            datejoined: new Date().toISOString(),
            aboutme: "Bio"
        });

        const response = await auth.createNewUser("Another Name", "Existing@example.com", "AnotherPass123");
        assert.strictEqual(response.status, "info");
        assert.strictEqual(response.title, "Account already exists");
        assert(response.info.includes("already exists"));

        // No new user inserted
        assert.strictEqual(mockDb.users.length, 1);
    });

    test("4. Resends verification link when duplicate registration attempt is unverified", async () => {
        // Pre-populate unverified user
        mockDb.users.push({
            userid: 88,
            name: "Unverified User",
            email: "unverified@example.com",
            password: "hashed_password",
            isverified: false,
            datejoined: new Date().toISOString(),
            aboutme: "Bio"
        });

        const response = await auth.createNewUser("Unverified User", "unverified@example.com", "NewPass123");
        assert.strictEqual(response.status, "info");
        assert(response.info.includes("verification link"));

        // Verification email sent to unverified user
        assert.strictEqual(sentEmails.length, 1);
        assert.strictEqual(sentEmails[0].to, "unverified@example.com");
    });

    test("5. Database insertion failure propagates properly and does not falsely claim success", async () => {
        mockDb.shouldFailInsert = true;

        await assert.rejects(async () => {
            await auth.createNewUser("Fail User", "fail@example.com", "Password123");
        }, /Simulated database connection failure/);

        // No user in database
        assert.strictEqual(mockDb.users.length, 0);
    });

    test("6. Email delivery failure after database insert preserves user and reports pending verification", async () => {
        // Simulate email delivery failure
        mailer.setTransporter({
            sendMail: async () => {
                throw new Error("SMTP service unavailable or invalid credentials");
            }
        });

        const response = await auth.createNewUser("Offline Mail", "offline@example.com", "Password123");

        // The user account is saved in DB
        assert.strictEqual(mockDb.users.length, 1);
        const storedUser = mockDb.users[0];
        assert.strictEqual(storedUser.email, "offline@example.com");
        assert.strictEqual(storedUser.isverified, false);

        // Response notifies user account was created with email delivery pending
        assert.strictEqual(response.status, "success");
        assert.strictEqual(response.title, "Account successfully created");
        assert(response.info.includes("could not deliver the verification email"));
    });
});
