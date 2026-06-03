// NEAR marketplace server (stable)
// Node.js + Express + SQLite
// Run: node server.js

const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================
// CONFIG
// ===============================
// ВАЖНО: поставь свой ключ (32 символа) или через переменную окружения ADMIN_SECRET
const ADMIN_SECRET = process.env.ADMIN_SECRET || "9f7c2e8b4a61d3f5c8e2a9b7d4f1c6e0";

const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ===============================
// MIDDLEWARE
// ===============================
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ===============================
// ADMIN GUARD
// ===============================
function requireAdmin(req, res, next) {
  const key =
    req.headers["x-admin-key"] ||
    req.query.key ||
    (req.body && req.body.key) ||
    "";

  if (!key) return res.status(401).json({ error: "no admin key" });
  if (key !== ADMIN_SECRET) return res.status(403).json({ error: "forbidden" });
  next();
}

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!req.url.startsWith("/uploads/")) console.log(`REQ: ${req.method} ${req.url}`);
  next();
});

app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC_DIR));

// ===============================
// DB
// ===============================
const dbPath = path.join(__dirname, "near.db");
const db = new sqlite3.Database(dbPath);
console.log(`✅ DB FILE: ${path.basename(dbPath)} (${fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0} bytes)`);

function ensureColumn(table, col, ddl) {
  db.all(`PRAGMA table_info(${table})`, (e, rows) => {
    if (e) return console.error(`ensureColumn error: ${e}`);
    const has = (rows || []).some(r => r.name === col);
    if (!has) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`, (e2) => {
        if (e2) console.error(`ensureColumn alter error: ${e2}`);
        else console.log(`Added column ${col} to ${table}`);
      });
    }
  });
}

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      nickname TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT NULL,
      bio TEXT DEFAULT '',
      insta TEXT DEFAULT '',
      vk TEXT DEFAULT '',
      tg TEXT DEFAULT '',
      is_admin INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller TEXT NOT NULL,
      title TEXT NOT NULL,
      price INTEGER NOT NULL,
      size TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      condition TEXT DEFAULT 'good',
      category TEXT DEFAULT '',
      description TEXT DEFAULT '',
      images_json TEXT DEFAULT '[]',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      status TEXT DEFAULT 'approved',
      views INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nick TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      is_read INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_nick TEXT NOT NULL,
      to_nick TEXT NOT NULL,
      text TEXT DEFAULT '',
      image TEXT DEFAULT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      buyer TEXT NOT NULL,
      rating INTEGER NOT NULL,
      text TEXT DEFAULT '',
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS social_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nick TEXT NOT NULL,
      insta TEXT DEFAULT '',
      vk TEXT DEFAULT '',
      tg TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      reporter TEXT NOT NULL,
      reason TEXT DEFAULT '',
      text TEXT DEFAULT '',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      status TEXT DEFAULT 'pending'
    )
  `);

  // migrations (inside serialize to avoid race conditions)
  ensureColumn("items", "quantity", "quantity INTEGER DEFAULT 1");
  ensureColumn("items", "quantity_sold", "quantity_sold INTEGER DEFAULT 0");
  ensureColumn("items", "category", "category TEXT DEFAULT ''");
  ensureColumn("items", "images_json", "images_json TEXT DEFAULT '[]'");
  ensureColumn("items", "created_at", "created_at INTEGER DEFAULT (strftime('%s','now'))");
  ensureColumn("items", "status", "status TEXT DEFAULT 'approved'");
  ensureColumn("items", "views", "views INTEGER DEFAULT 0");
  ensureColumn("items", "subtype", "subtype TEXT DEFAULT ''");
  ensureColumn("users", "password", "password TEXT NOT NULL DEFAULT ''");
  ensureColumn("users", "avatar", "avatar TEXT DEFAULT NULL");
  ensureColumn("users", "bio", "bio TEXT DEFAULT ''");
  ensureColumn("users", "insta", "insta TEXT DEFAULT ''");
  ensureColumn("users", "vk", "vk TEXT DEFAULT ''");
  ensureColumn("users", "tg", "tg TEXT DEFAULT ''");
  ensureColumn("users", "is_admin", "is_admin INTEGER DEFAULT 0");
  ensureColumn("users", "blocked", "blocked INTEGER DEFAULT 0");
  ensureColumn("users", "blocked_reason", "blocked_reason TEXT DEFAULT ''");
});

// ===============================
// HELPERS
// ===============================
function normNick(s) {
  return String(s || "").trim();
}

// ✅ важный фикс: приводим ник к одному виду (убираем ведущие @@@)
function cleanNick(s) {
  return normNick(s).replace(/^@+/, "");
}

function parseImages(images_json) {
  try {
    const a = JSON.parse(images_json || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function mapItemRow(r) {
  const imgs = parseImages(r.images_json);
  return {
    id: r.id,
    seller: r.seller,
    title: r.title,
    price: r.price,
    size: r.size || "",
    brand: r.brand || "",
    condition: r.condition || "good",
    category: r.category || "",
    subtype: r.subtype || "",
    description: r.description || "",
    images: imgs,
    image: imgs[0] || null,
    created_at: r.created_at || null,
    status: r.status || "approved",
    views: r.views || 0,
    quantity: r.quantity || 1,
    quantity_sold: r.quantity_sold || 0,
  };
}

function cleanSocial(s) {
  return String(s || "").replace(/^https?:\/\/(www\.)?(instagram\.com|vk\.com|t\.me)\//, "").replace(/[@\s]/g, "").trim();
}

function isAdminReq(req) {
  const key = req.headers["x-admin-key"] || req.query.key || (req.body && req.body.key);
  return !!key && String(key) === String(ADMIN_SECRET);
}

function addNotif(nick, text) {
  db.run(`INSERT INTO notifications(nick,text) VALUES(?,?)`, [nick, text], () => { });
}

// ===============================
// UPLOADS
// ===============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
  },
});
const upload = multer({ storage });

// ===============================
// PAGES
// ===============================
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/profile", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "profile.html")));
app.get("/settings", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "settings.html")));
app.get("/adm", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("/u/:nick", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "user.html")));

// ===============================
// AUTH
// ===============================
app.post("/api/login", (req, res) => {
  const nickname = cleanNick(req.body.nickname);
  const password = String(req.body.password || "");
  if (!nickname || !password) return res.status(400).json({ error: "bad input" });

  db.get(`SELECT * FROM users WHERE nickname=?`, [nickname], (e, row) => {
    if (e) return res.status(500).json({ error: "db error" });

    if (!row) {
      db.run(`INSERT INTO users(nickname,password) VALUES(?,?)`, [nickname, password], (e2) => {
        if (e2) return res.status(500).json({ error: "db error" });
        res.json({ ok: true, nickname });
      });
      return;
    }

    if (row.blocked) return res.status(403).json({ error: "Ваш аккаунт заблокирован. Причина: " + (row.blocked_reason || "не указана") });
    if (row.password !== password) return res.status(401).json({ error: "bad password" });
    res.json({ ok: true, nickname });
  });
});

app.get("/api/user/:nick", (req, res) => {
  const nick = cleanNick(req.params.nick);
  db.get(`SELECT nickname, avatar, bio, insta, vk, tg, blocked, blocked_reason FROM users WHERE nickname=?`, [nick], (e, row) => {
    if (e) return res.status(500).json({ error: "db error" });
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  });
});

app.get("/api/user/:nick/exists", (req, res) => {
  const nick = cleanNick(req.params.nick);
  if (!nick) return res.json({ exists: false });
  db.get(`SELECT nickname, blocked FROM users WHERE nickname=?`, [nick], (e, row) => {
    if (e) return res.json({ exists: false });
    res.json({ exists: !!row && !row.blocked });
  });
});

app.post("/api/user/update", upload.single("avatar"), (req, res) => {
  const currentNick = cleanNick(req.body.currentNick);
  const bio = String(req.body.bio || "").trim().slice(0, 500);
  const insta = cleanSocial(req.body.insta);
  const vk = cleanSocial(req.body.vk);
  const tg = cleanSocial(req.body.tg);
  const password = req.body.password;
  const avatar = req.file ? req.file.filename : null;

  if (!currentNick) return res.status(400).json({ error: "no nick" });

  // Сначала обновляем bio, avatar, password (без соцсетей)
  const fields = ["bio=?"];
  const params = [bio];

  if (password) {
    fields.push("password=?");
    params.push(password);
  }
  if (avatar) {
    fields.push("avatar=?");
    params.push(avatar);
  }

  params.push(currentNick);
  db.run(`UPDATE users SET ${fields.join(", ")} WHERE nickname=?`, params, function (e) {
    if (e) return res.status(500).json({ error: "db error" });

    // Соцсети — проверяем, изменились ли
    db.get(`SELECT insta, vk, tg FROM users WHERE nickname=?`, [currentNick], (e2, user) => {
      const changed = insta !== (user.insta || '') || vk !== (user.vk || '') || tg !== (user.tg || '');

      if (!changed) {
        return res.json({ ok: true });
      }

      // Отправляем на модерацию
      db.run(
        `INSERT INTO social_requests(nick, insta, vk, tg) VALUES(?,?,?,?)`,
        [currentNick, insta, vk, tg],
        function (e3) {
          if (e3) return res.status(500).json({ error: "db error" });
          addNotif(currentNick, "Ваши социальные сети отправлены на проверку модератору");
          res.json({ ok: true, social_pending: true });
        }
      );
    });
  });
});

app.get("/api/my/purchases", (req, res) => {
  const nick = cleanNick(req.query.nick);
  db.all(`SELECT items.* FROM purchases JOIN items ON purchases.item_id = items.id WHERE purchases.buyer=?`, [nick], (e, rows) => {
    if (e) return res.status(500).json({ error: "db error" });
    res.json((rows || []).map(mapItemRow));
  });
});

app.get("/api/my/sales", (req, res) => {
  const nick = cleanNick(req.query.nick);
  db.all(`SELECT items.* FROM purchases JOIN items ON purchases.item_id = items.id WHERE items.seller=?`, [nick], (e, rows) => {
    if (e) return res.status(500).json({ error: "db error" });
    res.json((rows || []).map(mapItemRow));
  });
});

// ===============================
// ITEMS
// ===============================
app.get("/api/items", (req, res) => {
  db.all(
    `SELECT * FROM items WHERE status='approved' ORDER BY id DESC`,
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db error" });

      res.json((rows || []).map(mapItemRow));
    }
  );
});

app.get("/api/item/:seller/:id", (req, res) => {
  const seller = cleanNick(req.params.seller);
  const id = parseInt(req.params.id, 10);
  if (!seller || !id) return res.status(400).json({ error: "bad url" });

  db.get(`SELECT * FROM items WHERE id=? AND seller=?`, [id, seller], (e, row) => {
    if (e) return res.status(500).json({ error: "db error" });
    if (!row) return res.status(404).json({ error: "not found" });

    db.run(`UPDATE items SET views = COALESCE(views,0) + 1 WHERE id=?`, [id]);

    const item = mapItemRow(row);
    db.get(`SELECT nickname, avatar FROM users WHERE nickname=?`, [seller], (e2, u) => {
      item.seller_avatar = (u && u.avatar) ? u.avatar : null;
      res.json(item);
    });
  });
});

app.post("/api/item/:seller/:id/view", (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.run(`UPDATE items SET views = COALESCE(views,0) + 1 WHERE id=?`, [id], (e) => {
    res.json({ ok: !e });
  });
});

// ===============================
// RECOMMENDATIONS
// ===============================
app.get("/api/item/:seller/:id/recommendations", (req, res) => {
  const seller = cleanNick(req.params.seller);
  const id = parseInt(req.params.id, 10);
  if (!seller || !id) return res.status(400).json({ error: "bad url" });

  db.get(`SELECT * FROM items WHERE id=? AND seller=?`, [id, seller], (e, currentItem) => {
    if (e) return res.status(500).json({ error: "db error" });
    if (!currentItem) return res.status(404).json({ error: "item not found" });

    const current = mapItemRow(currentItem);
    const minPrice = Math.floor(current.price * 0.7);
    const maxPrice = Math.ceil(current.price * 1.3);

    db.all(
      `SELECT * FROM items WHERE id != ? AND status = 'approved' AND (quantity - COALESCE(quantity_sold, 0)) > 0`,
      [id],
      (e2, rows) => {
        if (e2) return res.status(500).json({ error: "db error" });

        const candidates = (rows || []).map(mapItemRow);
        
        // Подсчет баллов для каждого товара
        const scored = candidates.map(item => {
          let score = 0;
          
          // +5 баллов - совпадает подтип
          if (current.subtype && item.subtype && current.subtype.toLowerCase() === item.subtype.toLowerCase()) {
            score += 5;
          }
          
          // +3 балла - совпадает категория
          if (current.category && item.category && current.category.toLowerCase() === item.category.toLowerCase()) {
            score += 3;
          }
          
          // +2 балла - совпадает бренд
          if (current.brand && item.brand && current.brand.toLowerCase() === item.brand.toLowerCase()) {
            score += 2;
          }
          
          // +1 балл - похожая цена (в диапазоне ±30%)
          if (item.price >= minPrice && item.price <= maxPrice) {
            score += 1;
          }
          
          return { item, score };
        });

        // Фильтруем только товары с баллами и сортируем по убыванию
        const filtered = scored
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)
          .map(s => s.item);

        res.json(filtered);
      }
    );
  });
});

app.post("/api/item/:id/sold", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const seller = cleanNick(req.body.seller);
  const buyer = cleanNick(req.body.buyer);
  const qty = Math.max(1, parseInt(req.body.quantity, 10) || 1);

  if (!id || !seller || !buyer) return res.status(400).json({ error: "bad input" });

  db.get(`SELECT blocked FROM users WHERE nickname=?`, [buyer], (e, buyerRow) => {
    if (e) return res.status(500).json({ error: "db error" });
    if (!buyerRow) return res.status(404).json({ error: "покупатель не найден" });
    if (buyerRow.blocked) return res.status(403).json({ error: "покупатель заблокирован" });

    db.get(`SELECT * FROM items WHERE id=?`, [id], (e, row) => {
    if (e || !row) return res.status(404).json({ error: "item not found" });
    if (cleanNick(row.seller) !== seller) return res.status(403).json({ error: "только продавец может отметить продажу" });

    const currentQty = (row.quantity || 1) - (row.quantity_sold || 0);
    if (qty > currentQty) return res.status(400).json({ error: "недостаточно товара" });

    const newSold = (row.quantity_sold || 0) + qty;

    for (let i = 0; i < qty; i++) {
      db.run(`INSERT INTO purchases(buyer, item_id) VALUES(?,?)`, [buyer, id]);
    }

    db.run(`UPDATE items SET quantity_sold=? WHERE id=?`, [newSold, id], () => {
      addNotif(buyer, `Продавец подтвердил продажу "${row.title}"! Оставьте отзыв на странице товара.`);
      addNotif(seller, `Вы отметили продажу "${row.title}" покупателю @${buyer}!`);
      res.json({ ok: true, quantity_sold: newSold, quantity_left: row.quantity - newSold });
    });
  });
  });
});

app.post("/api/review", (req, res) => {
  const item_id = parseInt(req.body.item_id, 10);
  const buyer = cleanNick(req.body.buyer);
  const rating = parseInt(req.body.rating, 10);
  const text = String(req.body.text || "").trim();

  if (!item_id || !buyer || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "bad input" });
  }

  db.get(`SELECT id, seller FROM items WHERE id=?`, [item_id], (e, item) => {
    if (e || !item) return res.status(404).json({ error: "item not found" });

    db.get(`SELECT id FROM purchases WHERE item_id=? AND buyer=? LIMIT 1`, [item_id, buyer], (e2, pur) => {
      if (!pur) return res.status(403).json({ error: "вы не покупали этот товар" });

      db.get(`SELECT id FROM reviews WHERE item_id=? AND buyer=?`, [item_id, buyer], (e3, rev) => {
        if (rev) return res.status(400).json({ error: "вы уже оставили отзыв" });

        db.run(`INSERT INTO reviews(item_id,buyer,rating,text) VALUES(?,?,?,?)`,
          [item_id, buyer, rating, text],
          function (e4) {
            if (e4) return res.status(500).json({ error: "db error" });
            addNotif(item.seller, `@${buyer} оставил отзыв о вашем товаре!`);
            res.json({ ok: true, id: this.lastID });
          }
        );
      });
    });
  });
});

app.get("/api/item/:seller/:id/reviews", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });

  db.all(
    `SELECT reviews.*, users.avatar FROM reviews
     LEFT JOIN users ON reviews.buyer = users.nickname
     WHERE reviews.item_id=? ORDER BY reviews.created_at DESC`,
    [id],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db error" });

      db.get(`SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE item_id=?`, [id], (e2, stats) => {
        if (e2) return res.status(500).json({ error: "db error" });
        res.json({
          reviews: (rows || []).map(r => ({
            id: r.id,
            buyer: r.buyer,
            rating: r.rating,
            text: r.text,
            avatar: r.avatar || null,
            created_at: r.created_at,
          })),
          avg_rating: stats.avg ? Math.round(stats.avg * 10) / 10 : 0,
          total: stats.count || 0,
        });
      });
    }
  );
});

app.get("/api/user/:nick/reviews", (req, res) => {
  const nick = cleanNick(req.params.nick);
  if (!nick) return res.status(400).json({ error: "bad nick" });

  db.all(
    `SELECT reviews.*, items.title as item_title, items.price as item_price, items.images_json
     FROM reviews
     JOIN items ON reviews.item_id = items.id
     WHERE items.seller=?
     ORDER BY reviews.created_at DESC`,
    [nick],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db error" });

      db.get(`SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews
              JOIN items ON reviews.item_id = items.id WHERE items.seller=?`, [nick], (e2, stats) => {
        if (e2) return res.status(500).json({ error: "db error" });

        const list = (rows || []).map(r => {
          const imgs = parseImages(r.images_json);
          return {
            id: r.id,
            buyer: r.buyer,
            rating: r.rating,
            text: r.text,
            item_title: r.item_title,
            item_image: imgs[0] || null,
            created_at: r.created_at,
          };
        });

        res.json({
          reviews: list,
          avg_rating: stats.avg ? Math.round(stats.avg * 10) / 10 : 0,
          total: stats.count || 0,
        });
      });
    }
  );
});

app.post("/api/item/add", upload.array("images", 7), (req, res) => {
  const seller = cleanNick(req.body.seller);
  const title = String(req.body.title || "").trim();
  const price = parseInt(req.body.price, 10);
  const size = String(req.body.size || "").trim();
  const brand = String(req.body.brand || "").trim();
  const condition = String(req.body.condition || "good");
  const category = String(req.body.category || "").trim();
  const subtype = String(req.body.subtype || "").trim();
  const description = String(req.body.description || "").trim();
  const quantity = Math.max(1, parseInt(req.body.quantity, 10) || 1);

  if (!seller || !title || !Number.isFinite(price)) return res.status(400).json({ error: "bad input" });

  const imgs = (req.files || []).map(f => f.filename);
  const images_json = JSON.stringify(imgs);

  db.run(
    `INSERT INTO items(seller,title,price,size,brand,condition,category,subtype,description,images_json,status,quantity) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?)`,
    [seller, title, price, size, brand, condition, category, subtype, description, images_json, quantity],
    function (e) {
      if (e) return res.status(500).json({ error: "db error: " + e.message });
      addNotif(seller, `Объявление отправлено на проверку: ${title}`);
      res.json({ ok: true, id: this.lastID });
    }
  );
});

app.delete("/api/item/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);

  const seller = cleanNick(
    req.headers["x-nick"] ||
    req.headers["x-user"] ||
    req.headers["x-seller"] ||
    req.query.seller ||
    (req.body && req.body.seller) ||
    ""
  );

  if (!id) return res.status(400).json({ error: "bad id" });

  // если seller не передан — удалять может только админ
  if (!seller && !isAdminReq(req)) return res.status(401).json({ error: "unauthorized" });

  db.get(`SELECT seller FROM items WHERE id=?`, [id], (e, row) => {
    if (e) return res.status(500).json({ error: "db error" });
    if (!row) return res.status(404).json({ error: "not found" });

    const allowed = cleanNick(row.seller) === seller || isAdminReq(req);
    if (!allowed) return res.status(403).json({ error: "forbidden" });

    db.run(`DELETE FROM items WHERE id=?`, [id], function (e2) {
      if (e2) return res.status(500).json({ error: "db error" });
      res.json({ ok: true, deleted: this.changes });
    });
  });
});

// ===============================
// NOTIFS
// ===============================
app.get("/api/notifs", (req, res) => {
  const me = cleanNick(req.query.me);
  if (!me) return res.json([]);
  db.all(
    `SELECT id,text,created_at,is_read FROM notifications WHERE nick=? ORDER BY id DESC LIMIT 20`,
    [me],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db error" });
      res.json(rows || []);
    }
  );
});

app.post("/api/notifs/read", (req, res) => {
  const me = cleanNick(req.body.me);
  if (!me) return res.status(400).json({ error: "bad input" });
  db.run(`UPDATE notifications SET is_read=1 WHERE nick=?`, [me], (e) => {
    if (e) return res.status(500).json({ error: "db error" });
    res.json({ ok: true });
  });
});

// ===============================
// CHAT
// ===============================
app.post("/api/item/delete", (req, res) => {
  const id = Number(req.body?.id || req.query?.id);

  const me = cleanNick(
    req.body?.nick ||
    req.query?.nick ||
    req.headers["x-nick"] ||
    req.headers["x-user"] ||
    req.headers["x-seller"] ||
    ""
  );

  if (!id) return res.status(400).json({ error: "bad id" });
  if (!me) return res.status(401).json({ error: "no nick" });

  db.get(`SELECT id, seller FROM items WHERE id=?`, [id], (e, row) => {
    if (e) return res.status(500).json({ error: "db error" });
    if (!row) return res.status(404).json({ error: "not found" });

    if (cleanNick(row.seller) !== me) return res.status(403).json({ error: "forbidden" });

    db.run(`DELETE FROM items WHERE id=?`, [id], function (e2) {
      if (e2) return res.status(500).json({ error: "db error" });
      res.json({ ok: true, deleted: this.changes || 0 });
    });
  });
});




app.get("/api/chats", (req, res) => {
  const me = normNick(req.query.me || "");
  if (!me) return res.json([]);

  db.all(
    `SELECT
       CASE WHEN from_nick = ? THEN to_nick ELSE from_nick END AS withNick,
       MAX(created_at) AS lastAt
     FROM messages
     WHERE from_nick = ? OR to_nick = ?
     GROUP BY withNick
     ORDER BY lastAt DESC
     LIMIT 100`,
    [me, me, me],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db error" });

      const out = (rows || []).map(r => ({
        withNick: r.withNick,
        with: r.withNick,      // оставил для совместимости, не мешает
        lastAt: r.lastAt || 0
      }));

      res.json(out);
    }
  );
});


app.get("/api/chat", (req, res) => {
  const me = cleanNick(req.query.me);
  const withNick = cleanNick(req.query.with);
  if (!me || !withNick) return res.status(400).json({ error: "bad input" });

  db.all(
    `SELECT id,from_nick,to_nick,text,image,created_at FROM messages
     WHERE (from_nick=? AND to_nick=?) OR (from_nick=? AND to_nick=?)
     ORDER BY created_at ASC, id ASC LIMIT 200`,
    [me, withNick, withNick, me],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db error" });
      res.json(rows || []);
    }
  );
});

app.post("/api/chat/send", upload.single("image"), (req, res) => {
  const from = cleanNick(req.body.from);
  const to = cleanNick(req.body.to);
  const text = String(req.body.text || "").trim();
  const image = req.file ? `/uploads/${req.file.filename}` : null;

  if (!from || !to) return res.status(400).json({ error: "bad input" });
  if (!text && !image) return res.status(400).json({ error: "empty" });

  db.run(
    `INSERT INTO messages(from_nick,to_nick,text,image) VALUES(?,?,?,?)`,
    [from, to, text, image],
    function (e) {
      if (e) return res.status(500).json({ error: "db error" });
      addNotif(to, `Новое сообщение от @${from}`);
      res.json({ ok: true, id: this.lastID, image });
    }
  );
});

// ===============================
// ADMIN
// ===============================
// ✅ admin ping (проверка ключа)
app.get("/api/admin/ping", requireAdmin, (req, res) => {
  res.json({ ok: true });
});

// ✅ очередь модерации
app.get("/api/admin/pending", requireAdmin, (req, res) => {
  db.all(
    `SELECT * FROM items WHERE status='pending' ORDER BY created_at DESC LIMIT 200`,
    [],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db error" });
      res.json(rows || []);
    }
  );
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const q = String(req.query.q || "").trim();
  const sql = q
    ? `SELECT nickname, created_at, is_admin, blocked, blocked_reason FROM users WHERE nickname LIKE ? ORDER BY created_at DESC LIMIT 200`
    : `SELECT nickname, created_at, is_admin, blocked, blocked_reason FROM users ORDER BY created_at DESC LIMIT 200`;
  const params = q ? [`%${q}%`] : [];
  db.all(sql, params, (e, rows) => {
    if (e) return res.status(500).json({ error: "db error" });
    res.json(rows || []);
  });
});

app.get("/api/admin/items", requireAdmin, (req, res) => {
  const q = String(req.query.q || "").trim();
  const sql = q
    ? `SELECT * FROM items WHERE title LIKE ? ORDER BY id DESC LIMIT 100`
    : `SELECT * FROM items ORDER BY id DESC LIMIT 100`;
  const params = q ? [`%${q}%`] : [];
  db.all(sql, params, (e, rows) => {
    if (e) return res.status(500).json({ error: "db error" });
    res.json((rows || []).map(mapItemRow));
  });
});

app.post("/api/admin/item/update", requireAdmin, (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });

  const fields = [];
  const values = [];
  const allow = ["title", "price", "size", "brand", "condition", "category", "description", "status", "seller", "quantity", "quantity_sold"];
  for (const k of allow) {
    if (req.body[k] !== undefined) {
      fields.push(`${k}=?`);
      values.push(req.body[k]);
    }
  }
  if (!fields.length) return res.status(400).json({ error: "no fields" });

  values.push(id);
  db.run(`UPDATE items SET ${fields.join(", ")} WHERE id=?`, values, function (e) {
    if (e) return res.status(500).json({ error: "db error" });
    res.json({ ok: true, changed: this.changes });
  });
});

// ✅ approve/reject через /:id/...
app.post("/api/admin/item/:id/approve", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });

  db.get(`SELECT id, status, title, seller FROM items WHERE id=?`, [id], (e0, before) => {
    if (e0) return res.status(500).json({ error: "db error" });
    if (!before) {
      console.log("❌ APPROVE: item not found id=", id);
      return res.status(404).json({ error: "item not found" });
    }

    db.run(`UPDATE items SET status='approved' WHERE id=?`, [id], function (e1) {
      if (e1) return res.status(500).json({ error: "db error" });

      db.get(`SELECT id, status FROM items WHERE id=?`, [id], (e2, after) => {
        if (e2) return res.status(500).json({ error: "db error" });

        console.log("✅ APPROVE:", { id, title: before.title, before: before.status, after: after.status, changed: this.changes });

        // Уведомление продавцу
        addNotif(before.seller, `Ваше объявление "${before.title}" прошло проверку и выставлено на продажу!`);

        res.json({ ok: true, id, before: before.status, after: after.status, changed: this.changes });
      });
    });
  });
});

app.post("/api/admin/item/:id/reject", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });

  db.get(`SELECT id, status, title, seller FROM items WHERE id=?`, [id], (e0, before) => {
    if (e0) return res.status(500).json({ error: "db error" });
    if (!before) {
      console.log("❌ REJECT: item not found id=", id);
      return res.status(404).json({ error: "item not found" });
    }

    db.run(`UPDATE items SET status='rejected' WHERE id=?`, [id], function (e1) {
      if (e1) return res.status(500).json({ error: "db error" });

      db.get(`SELECT id, status FROM items WHERE id=?`, [id], (e2, after) => {
        if (e2) return res.status(500).json({ error: "db error" });

        console.log("✅ REJECT:", { id, title: before.title, before: before.status, after: after.status, changed: this.changes });

        addNotif(before.seller, `Ваше объявление "${before.title}" не прошло проверку и было отклонено`);

        res.json({ ok: true, id, before: before.status, after: after.status, changed: this.changes });
      });
    });
  });
});

// старые endpoints (оставляем для совместимости, не мешают)
app.post("/api/admin/item/approve", requireAdmin, (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });
  db.run(`UPDATE items SET status='approved' WHERE id=?`, [id], (e) => {
    if (e) return res.status(500).json({ error: "db error" });
    res.json({ ok: true });
  });
});

app.post("/api/admin/item/reject", requireAdmin, (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });
  db.run(`UPDATE items SET status='rejected' WHERE id=?`, [id], (e) => {
    if (e) return res.status(500).json({ error: "db error" });
    res.json({ ok: true });
  });
});

// ===============================
// ADMIN — USER MANAGEMENT
// ===============================
app.get("/api/admin/user/:nick", requireAdmin, (req, res) => {
  const nick = cleanNick(req.params.nick);
  db.get(`SELECT nickname, avatar, bio, insta, vk, tg, is_admin, blocked, blocked_reason, created_at FROM users WHERE nickname=?`, [nick], (e, row) => {
    if (e) return res.status(500).json({ error: "db error" });
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  });
});

// Admin — view profile report target
app.get("/api/admin/report/profile/:nick", requireAdmin, (req, res) => {
  const nick = cleanNick(req.params.nick);
  db.get(`SELECT nickname, avatar, bio, insta, vk, tg, blocked, blocked_reason, created_at FROM users WHERE nickname=?`, [nick], (e, row) => {
    if (e) return res.status(500).json({ error: "db error" });
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  });
});

app.post("/api/admin/user/block", requireAdmin, (req, res) => {
  const nick = cleanNick(req.body.nick);
  const reason = String(req.body.reason || "").trim();
  if (!nick) return res.status(400).json({ error: "bad nick" });
  db.run(`UPDATE users SET blocked=1, blocked_reason=? WHERE nickname=?`, [reason, nick], function (e) {
    if (e) return res.status(500).json({ error: "db error" });
    res.json({ ok: true, changed: this.changes });
  });
});

app.post("/api/admin/user/unblock", requireAdmin, (req, res) => {
  const nick = cleanNick(req.body.nick);
  if (!nick) return res.status(400).json({ error: "bad nick" });
  db.run(`UPDATE users SET blocked=0, blocked_reason='' WHERE nickname=?`, [nick], function (e) {
    if (e) return res.status(500).json({ error: "db error" });
    res.json({ ok: true, changed: this.changes });
  });
});

app.post("/api/admin/user/bio", requireAdmin, (req, res) => {
  const nick = cleanNick(req.body.nick);
  const bio = String(req.body.bio || "").trim().slice(0, 500);
  const insta = String(req.body.insta || "").trim().replace(/^@/, '').slice(0, 100);
  const vk = String(req.body.vk || "").trim().replace(/^@/, '').slice(0, 100);
  const tg = String(req.body.tg || "").trim().replace(/^@/, '').slice(0, 100);
  if (!nick) return res.status(400).json({ error: "bad nick" });
  db.run(`UPDATE users SET bio=?, insta=?, vk=?, tg=? WHERE nickname=?`,
    [bio, insta, vk, tg, nick], function (e) {
    if (e) return res.status(500).json({ error: "db error" });
    res.json({ ok: true, changed: this.changes });
  });
});

app.post("/api/admin/user/admin", requireAdmin, (req, res) => {
  const nick = cleanNick(req.body.nick);
  if (!nick) return res.status(400).json({ error: "bad nick" });
  db.run(`UPDATE users SET is_admin=1 WHERE nickname=?`, [nick], function (e) {
    if (e) return res.status(500).json({ error: "db error" });
    res.json({ ok: true, changed: this.changes });
  });
});

app.post("/api/admin/user/avatar/delete", requireAdmin, (req, res) => {
  const nick = cleanNick(req.body.nick);
  if (!nick) return res.status(400).json({ error: "bad nick" });
  db.run(`UPDATE users SET avatar=NULL WHERE nickname=?`, [nick], function (e) {
    if (e) return res.status(500).json({ error: "db error" });
    res.json({ ok: true, changed: this.changes });
  });
});

app.get("/api/admin/user/:nick/chats", requireAdmin, (req, res) => {
  const nick = cleanNick(req.params.nick);
  db.all(
    `SELECT CASE WHEN from_nick = ? THEN to_nick ELSE from_nick END AS withNick,
            MAX(created_at) AS lastAt, COUNT(*) as msgCount
     FROM messages WHERE from_nick = ? OR to_nick = ?
     GROUP BY withNick ORDER BY lastAt DESC LIMIT 100`,
    [nick, nick, nick],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db error" });
      res.json(rows || []);
    }
  );
});

app.get("/api/admin/messages", requireAdmin, (req, res) => {
  const me = cleanNick(req.query.me);
  const withNick = cleanNick(req.query.with);
  if (!me || !withNick) return res.status(400).json({ error: "bad input" });
  db.all(
    `SELECT id, from_nick, to_nick, text, image, created_at FROM messages
     WHERE (from_nick=? AND to_nick=?) OR (from_nick=? AND to_nick=?)
     ORDER BY created_at ASC, id ASC LIMIT 500`,
    [me, withNick, withNick, me],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db error" });
      res.json(rows || []);
    }
  );
});

app.get("/api/admin/user/:nick/reviews", requireAdmin, (req, res) => {
  const nick = cleanNick(req.params.nick);
  db.all(
    `SELECT reviews.*, items.title as item_title, items.seller
     FROM reviews JOIN items ON reviews.item_id = items.id
     WHERE items.seller=? ORDER BY reviews.created_at DESC`,
    [nick],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db error" });
      res.json((rows || []).map(r => ({
        id: r.id, item_id: r.item_id, buyer: r.buyer, rating: r.rating,
        text: r.text, item_title: r.item_title, created_at: r.created_at,
      })));
    }
  );
});

app.delete("/api/admin/review/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });
  db.run(`DELETE FROM reviews WHERE id=?`, [id], function (e) {
    if (e) return res.status(500).json({ error: "db error" });
    res.json({ ok: true, deleted: this.changes });
  });
});

app.delete("/api/admin/message/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });
  db.run(`DELETE FROM messages WHERE id=?`, [id], function (e) {
    if (e) return res.status(500).json({ error: "db error" });
    res.json({ ok: true, deleted: this.changes });
  });
});

// ===============================
// ADMIN — USER ITEMS
// ===============================
app.get("/api/admin/user/:nick/items", requireAdmin, (req, res) => {
  const nick = cleanNick(req.params.nick);
  if (!nick) return res.status(400).json({ error: "bad nick" });
  db.all(`SELECT * FROM items WHERE seller=? ORDER BY created_at DESC`, [nick], (e, rows) => {
    if (e) return res.status(500).json({ error: "db error" });
    res.json((rows || []).map(mapItemRow));
  });
});

// ===============================
// ADMIN — SOCIAL MODERATION
// ===============================
app.get("/api/admin/social/pending", requireAdmin, (req, res) => {
  db.all(
    `SELECT * FROM social_requests WHERE status='pending' ORDER BY created_at DESC LIMIT 50`,
    [],
    (e, rows) => {
      if (e) return res.status(500).json({ error: "db error" });
      res.json(rows || []);
    }
  );
});

app.post("/api/admin/social/:id/approve", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });

  db.get(`SELECT * FROM social_requests WHERE id=?`, [id], (e0, req2) => {
    if (e0) return res.status(500).json({ error: "db error" });
    if (!req2) return res.status(404).json({ error: "not found" });
    if (req2.status !== 'pending') return res.status(400).json({ error: "already processed" });

    db.run(
      `UPDATE users SET insta=?, vk=?, tg=? WHERE nickname=?`,
      [req2.insta, req2.vk, req2.tg, req2.nick],
      function (e1) {
        if (e1) return res.status(500).json({ error: "db error" });

        db.run(`UPDATE social_requests SET status='approved' WHERE id=?`, [id], function (e2) {
          if (e2) return res.status(500).json({ error: "db error" });
          addNotif(req2.nick, "Ваши социальные сети одобрены! Они отображаются в вашем профиле.");
          res.json({ ok: true });
        });
      }
    );
  });
});

app.post("/api/admin/social/:id/reject", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });

  db.get(`SELECT * FROM social_requests WHERE id=?`, [id], (e0, req2) => {
    if (e0) return res.status(500).json({ error: "db error" });
    if (!req2) return res.status(404).json({ error: "not found" });
    if (req2.status !== 'pending') return res.status(400).json({ error: "already processed" });

    db.run(`UPDATE social_requests SET status='rejected' WHERE id=?`, [id], function (e1) {
      if (e1) return res.status(500).json({ error: "db error" });
      addNotif(req2.nick, "Ваши социальные сети не прошли проверку и были отклонены");
      res.json({ ok: true });
    });
  });
});

// ===============================
// REPORTS
// ===============================
app.post("/api/report", (req, res) => {
  const type = String(req.body.type || "").trim();
  const reporter = cleanNick(req.body.reporter);
  const reason = String(req.body.reason || "").trim();
  const text = String(req.body.text || "").trim();
  let target_id;
  if (type === 'profile') {
    target_id = cleanNick(req.body.target_id);
    if (!target_id) return res.status(400).json({ error: "bad target" });
  } else {
    target_id = parseInt(req.body.target_id, 10);
    if (!target_id) return res.status(400).json({ error: "bad target" });
  }
  if (!type || !reporter) return res.status(400).json({ error: "bad input" });
  db.run(`INSERT INTO reports(type,target_id,reporter,reason,text) VALUES(?,?,?,?,?)`,
    [type, String(target_id), reporter, reason, text], function (e) {
      if (e) return res.status(500).json({ error: "db error" });
      res.json({ ok: true, id: this.lastID });
    });
});

app.get("/api/admin/reports", requireAdmin, (req, res) => {
  const type = String(req.query.type || "").trim();
  const sql = type
    ? `SELECT * FROM reports WHERE type=? AND status='pending' ORDER BY created_at DESC LIMIT 200`
    : `SELECT * FROM reports WHERE status='pending' ORDER BY created_at DESC LIMIT 200`;
  const params = type ? [type] : [];
  db.all(sql, params, (e, rows) => {
    if (e) return res.status(500).json({ error: "db error" });
    res.json(rows || []);
  });
});

app.post("/api/admin/report/dismiss", requireAdmin, (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });
  db.run(`UPDATE reports SET status='dismissed' WHERE id=?`, [id], function (e) {
    if (e) return res.status(500).json({ error: "db error" });
    res.json({ ok: true, changed: this.changes });
  });
});

app.delete("/api/admin/report/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });
  db.get(`SELECT * FROM reports WHERE id=?`, [id], (e, report) => {
    if (e) return res.status(500).json({ error: "db error" });
    if (!report) return res.status(404).json({ error: "not found" });
    if (report.type === 'profile') {
      db.run(`DELETE FROM reports WHERE id=?`, [id], function (e3) {
        if (e3) return res.status(500).json({ error: "db error" });
        res.json({ ok: true, deleted: 'report' });
      });
    } else {
      const deleteTarget = report.type === 'item'
        ? `DELETE FROM items WHERE id=?`
        : `DELETE FROM messages WHERE id=?`;
      db.run(deleteTarget, [report.target_id], function (e2) {
        if (e2) return res.status(500).json({ error: "db error" });
        db.run(`DELETE FROM reports WHERE id=?`, [id], function (e3) {
          if (e3) return res.status(500).json({ error: "db error" });
          res.json({ ok: true, deleted: report.type === 'item' ? 'item' : 'message' });
        });
      });
    }
  });
});

// ===============================
// ADMIN — VIEW REPORTED CONTENT
// ===============================
app.get("/api/admin/report/item/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });
  db.get(`SELECT * FROM items WHERE id=?`, [id], (e, item) => {
    if (e) return res.status(500).json({ error: "db error" });
    if (!item) return res.status(404).json({ error: "not found" });
    res.json(mapItemRow(item));
  });
});

app.get("/api/admin/report/message/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad id" });
  db.get(`SELECT * FROM messages WHERE id=?`, [id], (e, msg) => {
    if (e) return res.status(500).json({ error: "db error" });
    if (!msg) return res.status(404).json({ error: "not found" });
    res.json(msg);
  });
});

// ===============================
// ADMIN — STATS
// ===============================
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const queries = [
    ["users", `SELECT COUNT(*) as c FROM users`],
    ["items", `SELECT COUNT(*) as c FROM items`],
    ["approved", `SELECT COUNT(*) as c FROM items WHERE status='approved'`],
    ["pending", `SELECT COUNT(*) as c FROM items WHERE status='pending'`],
    ["reviews", `SELECT COUNT(*) as c FROM reviews`],
    ["messages", `SELECT COUNT(*) as c FROM messages`],
    ["purchases", `SELECT COUNT(*) as c FROM purchases`],
    ["openReports", `SELECT COUNT(*) as c FROM reports WHERE status='pending'`],
    ["blocked", `SELECT COUNT(*) as c FROM users WHERE blocked=1`],
  ];
  let stats = {};
  let done = 0;
  for (const [key, sql] of queries) {
    db.get(sql, [], (e, r) => {
      if (!e) stats[key] = r ? r.c : 0;
      if (++done === queries.length) res.json(stats);
    });
  }
});

// ✅ ВАЖНО: динамический роут товара держим в самом низу, чтобы не ломал /api/*
app.get("/:seller/:id", (req, res) => {
  if (["api", "uploads", "adm", "u"].includes(req.params.seller)) return res.status(404).send("Not found");
  res.sendFile(path.join(PUBLIC_DIR, "item.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Открой: http://localhost:${PORT}`);
  console.log(`✅ Админка: http://localhost:${PORT}/adm`);
});
