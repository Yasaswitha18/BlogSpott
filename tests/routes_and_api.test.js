const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");
const db = require("../db/postgresql.js");
const dateTime = require("../utilities/dateTime.js");
const mailer = require("../utilities/mailer.js");
const MockDb = require("./mockDb.js");

describe("API Routes, Blogs, and Utilities", () => {
    let mockDb;

    beforeEach(() => {
        mockDb = new MockDb();
        db.setPool(mockDb);

        mockDb.users.push({
            userid: 1,
            name: "John Developer",
            email: "john@example.com",
            password: "hashed_password",
            isverified: true,
            datejoined: "2026-02-15",
            aboutme: "Full stack enthusiast"
        });
    });

    test("1. Blog creation handles special characters, HTML, and quotes without breaking SQL", async () => {
        const specialContent = `<p>It's an amazing day! Let's test "quotes" & single quotes 'here'.</p>`;
        const tags = ["tech's", "node.js", "react"];

        const result = await db.createNewBlog(tags, specialContent, 1);
        assert.strictEqual(result.status, "success");
        assert.strictEqual(mockDb.blogs.length, 1);
        assert.strictEqual(mockDb.blogs[0].content, specialContent);
        assert.strictEqual(mockDb.tags.length, 3);
        assert.strictEqual(mockDb.tags[0].tag, "tech's");
    });

    test("2. Fetching blogs returns expected structure with tags and formatted date", async () => {
        await db.createNewBlog(["javascript"], "Hello World Content", 1);
        const result = await db.fetchBlogs();

        assert.strictEqual(result.status, "success");
        assert.strictEqual(result.data.length, 1);
        const blog = result.data[0];
        assert.strictEqual(blog.content, "Hello World Content");
        assert.strictEqual(blog.name, "John Developer");
        assert.deepStrictEqual(blog.tags, ["javascript"]);
        assert(blog.blogDate.includes("/"));
    });

    test("3. User search handles multi-word keywords, spaces, and empty inputs cleanly", async () => {
        mockDb.users.push({
            userid: 2,
            name: "Alice Engineer",
            email: "alice@example.com",
            password: "hashed_password",
            isverified: true,
            datejoined: "2026-03-01",
            aboutme: "Security expert"
        });

        // Search with space-padded keyword
        const res1 = await db.getUserDetailsForSearch(["  John  "]);
        assert.strictEqual(res1.status, "success");
        assert.strictEqual(res1.data.length, 1);
        assert.strictEqual(res1.data[0].name, "John Developer");

        // Empty keyword array
        const res2 = await db.getUserDetailsForSearch([]);
        assert.strictEqual(res2.status, "success");
        assert.strictEqual(res2.data.length, 0);

        // Multiple keywords
        const res3 = await db.getUserDetailsForSearch(["John", "Alice"]);
        assert.strictEqual(res3.status, "success");
        assert.strictEqual(res3.data.length, 2);
    });

    test("4. DateTime utility handles valid and invalid/null inputs gracefully", () => {
        assert.strictEqual(dateTime.convertDateTimeFormat("2026-10-26T12:00:00Z"), "26/10/2026");
        assert.strictEqual(dateTime.convertDateTimeFormat(null), "");
        assert.strictEqual(dateTime.convertDateTimeFormat(undefined), "");
        assert.strictEqual(dateTime.convertDateTimeFormat("invalid-date-string"), "");

        const months = dateTime.getMonthsVsBlogCount();
        assert.strictEqual(months.length, 12);
        assert.strictEqual(months[0].month, 1);
        assert.strictEqual(months[11].month, 12);
    });

    test("5. Mailer URL builder resolves domain with HTTPS in production and handles prefixes", () => {
        // Domain without protocol
        process.env.DOMAIN = "blogspot-app.onrender.com";
        delete process.env.APP_URL;
        assert.strictEqual(mailer.getBaseUrl(), "https://blogspot-app.onrender.com");

        // Domain with https://
        process.env.DOMAIN = "https://blogspot-app.onrender.com/";
        assert.strictEqual(mailer.getBaseUrl(), "https://blogspot-app.onrender.com");

        // Localhost
        process.env.DOMAIN = "localhost:3000";
        assert.strictEqual(mailer.getBaseUrl(), "http://localhost:3000");

        // APP_URL override
        process.env.APP_URL = "https://custom-domain.com";
        assert.strictEqual(mailer.getBaseUrl(), "https://custom-domain.com");
    });
});
