const pg = require("pg");
const path = require("path");
const bcrypt = require("bcryptjs");
const dateTime = require("../utilities/dateTime.js");
require('dotenv').config({ path: path.join(__dirname, "..", ".env") });

const connectionString = (process.env.CONNECTION_STRING || process.env.DATABASE_URL || '').trim();

const buildPoolConfig = (connStr) => {
    if (!connStr) {
        return null;
    }
    const isProduction = process.env.NODE_ENV === 'production' || 
        (!connStr.includes('localhost') && !connStr.includes('127.0.0.1'));
    const requiresSsl = isProduction || 
        connStr.includes('sslmode=require') || 
        connStr.includes('neon.tech') || 
        connStr.includes('render.com');

    const config = {
        connectionString: connStr,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
    };

    if (requiresSsl) {
        config.ssl = {
            rejectUnauthorized: false
        };
    }
    return config;
};

const poolConfig = buildPoolConfig(connectionString);
let pool = poolConfig ? new pg.Pool(poolConfig) : null;

if (pool) {
    pool.on('error', (err) => {
        console.error('[DATABASE] Unexpected error on idle client:', err.message);
    });
} else {
    console.warn('[DATABASE WARNING] Neither CONNECTION_STRING nor DATABASE_URL is configured in environment.');
}

const initializeSchema = async () => {
    if (!pool) {
        throw new Error('Database pool is not initialized. Check CONNECTION_STRING or DATABASE_URL.');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Create users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                userId BIGSERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                name VARCHAR(128) NOT NULL,
                password VARCHAR(255) NOT NULL,
                isVerified BOOLEAN NOT NULL DEFAULT FALSE,
                dateJoined DATE NOT NULL DEFAULT CURRENT_DATE,
                aboutMe TEXT NOT NULL DEFAULT 'About Me section is incomplete'
            );
        `);

        // 2. Create blogs table
        await client.query(`
            CREATE TABLE IF NOT EXISTS blogs (
                blogId BIGSERIAL PRIMARY KEY,
                blogDate DATE NOT NULL DEFAULT CURRENT_DATE,
                content TEXT NOT NULL,
                userId BIGINT NOT NULL REFERENCES users(userId) ON DELETE CASCADE
            );
        `);

        // 3. Create tags table
        await client.query(`
            CREATE TABLE IF NOT EXISTS tags (
                blogId BIGINT NOT NULL REFERENCES blogs(blogId) ON DELETE CASCADE,
                tag VARCHAR(64) NOT NULL
            );
        `);

        // 4. Safe column widening (idempotent for existing databases)
        await client.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email') THEN
                    ALTER TABLE users ALTER COLUMN email TYPE VARCHAR(255);
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password') THEN
                    ALTER TABLE users ALTER COLUMN password TYPE VARCHAR(255);
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'name') THEN
                    ALTER TABLE users ALTER COLUMN name TYPE VARCHAR(128);
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tags' AND column_name = 'tag') THEN
                    ALTER TABLE tags ALTER COLUMN tag TYPE VARCHAR(64);
                END IF;
            END $$;
        `);

        // 5. Safe indexes for performance and fast lookups
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_blogs_userid ON blogs (userId);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_blogs_blogdate ON blogs (blogDate DESC);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_tags_blogid ON tags (blogId);`);

        await client.query('COMMIT');
        console.log('[DATABASE] Schema verified and initialized successfully.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[DATABASE] Schema initialization failed:', err.message);
        throw err;
    } finally {
        client.release();
    }
};

const executeQuery = async (text, params = []) => {
    if (!pool) {
        throw new Error('Database pool is not initialized. Please configure CONNECTION_STRING.');
    }
    try {
        return await pool.query(text, params);
    } catch (err) {
        console.error('[DATABASE QUERY ERROR]', err.message);
        throw err;
    }
};

module.exports = {
    setPool: (customPool) => {
        pool = customPool;
    },
    getPool: () => pool,
    connect: async () => {
        if (!pool) {
            console.error('[DATABASE] Cannot connect: CONNECTION_STRING is not set.');
            return false;
        }
        try {
            const client = await pool.connect();
            try {
                await client.query('SELECT 1');
            } finally {
                client.release();
            }
            console.log('[DATABASE] Connection established successfully.');
            await initializeSchema();
            return true;
        } catch (err) {
            console.error('[DATABASE] Connection failed:', err.message);
            throw err;
        }
    },
    close: async () => {
        if (pool) {
            await pool.end();
            console.log('[DATABASE] Connection pool closed.');
        }
    },
    query: executeQuery,
    initializeSchema,

    // Safe table creators for legacy calls
    createusertable: async () => initializeSchema(),
    createtagstable: async () => initializeSchema(),
    createblogstable: async () => initializeSchema(),
    
    // Kept for backward compatibility if ever called by tests or admin, but non-destructive
    droptagstable: async () => {
        await executeQuery('DROP TABLE IF EXISTS tags CASCADE');
    },
    dropblogstable: async () => {
        await executeQuery('DROP TABLE IF EXISTS blogs CASCADE');
    },
    dropusertable: async () => {
        await executeQuery('DROP TABLE IF EXISTS users CASCADE');
    },

    createNewBlog: async (tags, content, userId) => {
        if (!pool) throw new Error('Database pool is not initialized.');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const blogDate = new Date().toISOString();
            const { rows: [{ blogid }] } = await client.query(
                `INSERT INTO blogs(blogDate, content, userId) VALUES ($1, $2, $3) RETURNING blogId`,
                [blogDate, content, userId]
            );

            if (Array.isArray(tags) && tags.length > 0) {
                for (const rawTag of tags) {
                    if (rawTag && typeof rawTag === 'string' && rawTag.trim().length > 0) {
                        await client.query(
                            `INSERT INTO tags(blogId, tag) VALUES ($1, $2)`,
                            [blogid, rawTag.trim().slice(0, 64)]
                        );
                    }
                }
            }
            await client.query('COMMIT');
            return { 
                info: "Blog created successfully", 
                status: "success", 
                title: "Success" 
            };
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('[DATABASE] createNewBlog failed:', err.message);
            throw err;
        } finally {
            client.release();
        }
    },

    fetchBlogs: async (userId) => {
        try {
            let sql = `
                SELECT 
                    blogs.blogId AS blogid,
                    blogs.blogDate AS blogdate,
                    blogs.content AS blogcontent,
                    blogs.userId AS userid,
                    users.email AS email,
                    users.name AS username,
                    COALESCE(blogIdToTags.tags, ARRAY[]::text[]) AS tags
                FROM blogs 
                INNER JOIN users ON blogs.userId = users.userId
                LEFT JOIN (
                    SELECT 
                        blogId, 
                        ARRAY_AGG(tag) AS tags
                    FROM tags
                    GROUP BY blogId
                ) blogIdToTags ON blogs.blogId = blogIdToTags.blogId
            `;
            const params = [];
            if (userId) {
                sql += ` WHERE users.userId = $1 `;
                params.push(userId);
            }
            sql += ` ORDER BY blogs.blogDate DESC, blogs.blogId DESC`;

            const tempResult = await executeQuery(sql, params);
            const result = tempResult.rows.map(row => ({
                blogId: row.blogid,
                blogDate: dateTime.convertDateTimeFormat(row.blogdate),
                content: row.blogcontent,
                userId: row.userid,
                email: row.email,
                name: row.username,
                tags: Array.isArray(row.tags) ? row.tags : []
            }));
            return { 
                data: result, 
                info: "Blogs Fetched Successfully", 
                status: "success", 
                title: "Success" 
            };
        } catch (err) {
            console.error('[DATABASE] fetchBlogs error:', err.message);
            throw err;
        }
    },

    activateUserAccount: async (userId) => {
        try {
            await executeQuery(`UPDATE users SET isVerified = true WHERE userId = $1`, [userId]);
            return true;
        } catch (err) {
            console.error('[DATABASE] activateUserAccount error:', err.message);
            throw err;
        }
    },

    checkIfUserExistsAndVerified: async (email) => {
        const normalizedEmail = (email || '').trim().toLowerCase();
        const { rows } = await executeQuery(
            `SELECT userId, email, name, isVerified FROM users WHERE LOWER(email) = LOWER($1)`,
            [normalizedEmail]
        );
        if (rows.length === 0) {
            return [{}, false];
        }
        const { userid: userId, email: userEmail, name: userName, isverified: isVerified } = rows[0];
        return [{ userId, email: userEmail, name: userName }, isVerified];
    },

    createNewUser: async (name, email, hashedPassword) => {
        try {
            const dateJoined = new Date().toISOString();
            const normalizedEmail = email.trim().toLowerCase();
            const trimmedName = name.trim();
            const { rows } = await executeQuery(
                `INSERT INTO users(name, email, password, isVerified, dateJoined, aboutMe) 
                 VALUES($1, $2, $3, false, $4, 'About Me section is incomplete') 
                 RETURNING userId`,
                [trimmedName, normalizedEmail, hashedPassword, dateJoined]
            );
            return rows[0].userid;
        } catch (err) {
            console.error('[DATABASE] createNewUser error:', err.message);
            throw err;
        }
    },

    getUserDetailsFromEmail: async (email) => {
        try {
            const normalizedEmail = (email || '').trim().toLowerCase();
            const query = `SELECT userId, name, email, password, isVerified FROM users WHERE LOWER(email) = LOWER($1)`;
            const result = await executeQuery(query, [normalizedEmail]);
            if (!result.rows || result.rows.length === 0) {
                return { userId: null, name: null, email: null, password: null, isVerified: null };
            }
            const row = result.rows[0];
            return {
                userId: row.userid,
                name: row.name,
                email: row.email,
                password: row.password,
                isVerified: row.isverified
            };
        } catch (err) {
            console.error('[DATABASE] getUserDetailsFromEmail error:', err.message);
            throw err;
        }
    },

    changeUserPassword: async (userId, password) => {
        try {
            const hashedPassword = await bcrypt.hash(password, 12);
            await executeQuery(`UPDATE users SET password = $1 WHERE userId = $2`, [hashedPassword, userId]);
            return { 
                info: "Password reset successful", 
                status: "success", 
                title: "Success"
            };
        } catch (err) {
            console.error('[DATABASE] changeUserPassword error:', err.message);
            throw err;
        }
    },

    getUserDetailsForSearch: async (keywords) => {
        try {
            if (!Array.isArray(keywords) || keywords.length === 0) {
                return { 
                    data: [], 
                    info: "Fetch Successful", 
                    status: "success", 
                    title: "Success" 
                };
            }

            const cleanKeywords = keywords
                .map(k => (typeof k === 'string' ? k.trim() : ''))
                .filter(k => k.length > 0);

            if (cleanKeywords.length === 0) {
                return { 
                    data: [], 
                    info: "Fetch Successful", 
                    status: "success", 
                    title: "Success" 
                };
            }

            // Build parameterized search query
            const conditions = cleanKeywords.map((_, idx) => `UPPER(name) LIKE UPPER($${idx + 1})`).join(' OR ');
            const params = cleanKeywords.map(k => `%${k}%`);

            const query = `
                SELECT DISTINCT userId, name, email 
                FROM users 
                WHERE isVerified = true AND (${conditions})
                ORDER BY name ASC
            `;

            const { rows } = await executeQuery(query, params);
            const result = rows.map(r => ({
                userId: r.userid,
                name: r.name,
                email: r.email
            }));

            return { 
                data: result, 
                info: "Fetch Successful", 
                status: "success", 
                title: "Success" 
            };
        } catch (err) {
            console.error('[DATABASE] getUserDetailsForSearch error:', err.message);
            throw err;
        }
    },

    updateUserDetails: async (userId, name, password) => {
        try {
            const trimmedName = name ? name.trim() : null;
            const trimmedPassword = password ? password.trim() : null;

            if (trimmedName && trimmedPassword) {
                const hashedPassword = await bcrypt.hash(trimmedPassword, 12);
                await executeQuery(
                    `UPDATE users SET name = $1, password = $2 WHERE userId = $3`,
                    [trimmedName, hashedPassword, userId]
                );
            } else if (trimmedName) {
                await executeQuery(
                    `UPDATE users SET name = $1 WHERE userId = $2`,
                    [trimmedName, userId]
                );
            } else if (trimmedPassword) {
                const hashedPassword = await bcrypt.hash(trimmedPassword, 12);
                await executeQuery(
                    `UPDATE users SET password = $1 WHERE userId = $2`,
                    [hashedPassword, userId]
                );
            }

            return { 
                info: "User details successfully updated", 
                status: "success", 
                title: "Success" 
            };
        } catch (err) {
            console.error('[DATABASE] updateUserDetails error:', err.message);
            throw err;
        }
    },

    getUserDetails: async (userId) => {
        try {
            const result1 = await executeQuery(`
                SELECT
                    name,
                    email,
                    aboutMe,
                    dateJoined,
                    isVerified,
                    (SELECT COUNT(*) FROM blogs WHERE userId = $1) AS count
                FROM users
                WHERE users.userId = $1
            `, [userId]);

            const result2 = await executeQuery(`
                SELECT
                    EXTRACT(MONTH FROM blogDate) AS themonth,
                    COUNT(*) AS count
                FROM blogs
                WHERE EXTRACT(YEAR FROM blogDate) = EXTRACT(YEAR FROM CURRENT_DATE)
                GROUP BY EXTRACT(MONTH FROM blogDate)
                ORDER BY themonth ASC
            `);

            const monthlyCounts = [];
            for (let month = 1; month <= 12; month++) {
                const found = result2.rows.find(r => parseInt(r.themonth) === month);
                monthlyCounts.push({
                    month,
                    count: found ? parseInt(found.count) : 0
                });
            }

            if (result1.rows.length > 0) {
                const row = result1.rows[0];
                return {
                    details: {
                        name: row.name,
                        aboutMe: row.aboutme,
                        email: row.email,
                        dateJoined: dateTime.convertDateTimeFormat(row.datejoined),
                        count: parseInt(row.count) || 0,
                        isVerified: row.isverified,
                        countForEachMonth: monthlyCounts
                    },
                    info: "Fetch Successful",
                    status: "success",
                    title: "Success"
                };
            } else {
                return {
                    details: {
                        name: "",
                        aboutMe: "",
                        email: "",
                        dateJoined: "",
                        count: 0,
                        isVerified: false,
                        countForEachMonth: dateTime.getMonthsVsBlogCount()
                    },
                    info: "User not found",
                    status: "error",
                    title: "Not Found"
                };
            }
        } catch (err) {
            console.error('[DATABASE] getUserDetails error:', err.message);
            throw err;
        }
    },

    updateUserAboutMe: async (userId, aboutMe) => {
        try {
            await executeQuery(`UPDATE users SET aboutMe = $1 WHERE userId = $2`, [aboutMe || '', userId]);
            return { 
                info: "About me successfully updated", 
                status: "success", 
                title: "Success" 
            };
        } catch (err) {
            console.error('[DATABASE] updateUserAboutMe error:', err.message);
            throw err;
        }
    }
};
