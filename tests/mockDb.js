// In-memory mock database helper for automated tests
const bcrypt = require("bcryptjs");

class MockDb {
    constructor() {
        this.users = [];
        this.blogs = [];
        this.tags = [];
        this.nextUserId = 1;
        this.nextBlogId = 1;
        this.shouldFailInsert = false;
    }

    reset() {
        this.users = [];
        this.blogs = [];
        this.tags = [];
        this.nextUserId = 1;
        this.nextBlogId = 1;
        this.shouldFailInsert = false;
    }

    async query(text, params = []) {
        const sql = text.trim();

        // SELECT 1 (health/connection test)
        if (sql === 'SELECT 1') {
            return { rows: [{ '?column?': 1 }] };
        }

        // Schema setup statements
        if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK') ||
            sql.startsWith('CREATE TABLE') || sql.startsWith('ALTER TABLE') || sql.startsWith('CREATE INDEX') ||
            sql.startsWith('DO $$')) {
            return { rows: [] };
        }

        // INSERT INTO users
        if (sql.includes('INSERT INTO users')) {
            if (this.shouldFailInsert) {
                const err = new Error('Simulated database connection failure');
                throw err;
            }
            const [name, email, password, dateJoined] = params;
            // Check unique constraint
            if (this.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
                const err = new Error('duplicate key value violates unique constraint "users_email_key"');
                err.code = '23505';
                throw err;
            }
            const userId = this.nextUserId++;
            const user = {
                userid: userId,
                name,
                email,
                password,
                isverified: false,
                datejoined: dateJoined || new Date().toISOString(),
                aboutme: 'About Me section is incomplete'
            };
            this.users.push(user);
            return { rows: [{ userid: userId }] };
        }

        // SELECT users by email
        if (sql.includes('SELECT') && sql.includes('FROM users') && sql.includes('LOWER(email) = LOWER($1)')) {
            const email = (params[0] || '').toLowerCase();
            const user = this.users.find(u => u.email.toLowerCase() === email);
            if (!user) {
                return { rows: [] };
            }
            return { rows: [{ ...user }] };
        }

        // UPDATE users SET isVerified = true WHERE userId = $1
        if (sql.includes('UPDATE users SET isVerified = true')) {
            const userId = params[0];
            const user = this.users.find(u => u.userid === Number(userId));
            if (user) {
                user.isverified = true;
            }
            return { rows: [] };
        }

        // UPDATE users SET password = $1 WHERE userId = $2
        if (sql.includes('UPDATE users SET password = $1 WHERE userId = $2')) {
            const [newPassword, userId] = params;
            const user = this.users.find(u => u.userid === Number(userId));
            if (user) {
                user.password = newPassword;
            }
            return { rows: [] };
        }

        // UPDATE users SET name / password
        if (sql.includes('UPDATE users SET name')) {
            const user = this.users.find(u => u.userid === Number(params[params.length - 1]));
            if (user) {
                if (params.length === 3) {
                    user.name = params[0];
                    user.password = params[1];
                } else {
                    user.name = params[0];
                }
            }
            return { rows: [] };
        }

        // UPDATE users SET aboutMe
        if (sql.includes('UPDATE users SET aboutMe = $1 WHERE userId = $2')) {
            const [aboutMe, userId] = params;
            const user = this.users.find(u => u.userid === Number(userId));
            if (user) {
                user.aboutme = aboutMe;
            }
            return { rows: [] };
        }

        // SELECT user profile details
        if (sql.includes('SELECT') && sql.includes('FROM users') && sql.includes('users.userId = $1')) {
            const userId = Number(params[0]);
            const user = this.users.find(u => u.userid === userId);
            if (!user) {
                return { rows: [] };
            }
            const blogCount = this.blogs.filter(b => b.userid === userId).length;
            return {
                rows: [{
                    name: user.name,
                    email: user.email,
                    aboutme: user.aboutme,
                    datejoined: user.datejoined,
                    isverified: user.isverified,
                    count: blogCount
                }]
            };
        }

        // Monthly blog counts
        if (sql.includes('EXTRACT(MONTH FROM blogDate)')) {
            return {
                rows: [
                    { themonth: 1, count: '0' },
                    { themonth: 2, count: '0' }
                ]
            };
        }

        // Search users
        if (sql.includes('FROM users') && sql.includes('isVerified = true')) {
            const verified = this.users.filter(u => u.isverified);
            const matches = verified.filter(u => {
                return params.some(p => {
                    const term = p.replace(/%/g, '').toLowerCase();
                    return u.name.toLowerCase().includes(term);
                });
            });
            return { rows: matches };
        }

        // INSERT INTO blogs
        if (sql.includes('INSERT INTO blogs')) {
            const [blogDate, content, userId] = params;
            const blogId = this.nextBlogId++;
            this.blogs.push({
                blogid: blogId,
                blogdate: blogDate,
                content,
                userid: Number(userId)
            });
            return { rows: [{ blogid: blogId }] };
        }

        // INSERT INTO tags
        if (sql.includes('INSERT INTO tags')) {
            const [blogId, tag] = params;
            this.tags.push({ blogid: Number(blogId), tag });
            return { rows: [] };
        }

        // Fetch blogs
        if (sql.includes('FROM blogs')) {
            const userId = params[0] ? Number(params[0]) : null;
            let list = this.blogs;
            if (userId) {
                list = list.filter(b => b.userid === userId);
            }
            const rows = list.map(b => {
                const user = this.users.find(u => u.userid === b.userid) || { email: '', name: '' };
                const tags = this.tags.filter(t => t.blogid === b.blogid).map(t => t.tag);
                return {
                    blogid: b.blogid,
                    blogdate: b.blogdate,
                    blogcontent: b.content,
                    userid: b.userid,
                    email: user.email,
                    username: user.name,
                    tags
                };
            });
            return { rows };
        }

        return { rows: [] };
    }

    async connect() {
        return {
            query: this.query.bind(this),
            release: () => {}
        };
    }

    async end() {}
    on() {}
}

module.exports = MockDb;
