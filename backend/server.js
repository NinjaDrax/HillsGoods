import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const requiredEnv = ["MONGODB_URI", "JWT_SECRET", "FRONTEND_ORIGIN"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be at least 32 characters long.");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN.split(",").map(s => s.trim()),
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "200kb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["admin"], default: "admin" }
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  unit: { type: String, enum: ["kg", "liter", "pcs"], required: true },
  stock: { type: Number, min: 0, default: 0 },
  purchaseRate: { type: Number, min: 0, default: 0 },
  salesRate: { type: Number, min: 0, default: 0 },
  lowStockThreshold: { type: Number, min: 0, default: 10 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const transactionSchema = new mongoose.Schema({
  type: { type: String, enum: ["Purchase", "Sale", "Expense"], required: true },
  date: { type: Date, required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
  productName: { type: String, required: true, trim: true },
  party: { type: String, trim: true, default: "" },
  quantity: { type: Number, min: 0, default: 0 },
  unit: { type: String, enum: ["kg", "liter", "pcs", "none"], default: "none" },
  rate: { type: Number, min: 0, required: true },
  amount: { type: Number, min: 0, required: true },
  notes: { type: String, trim: true, default: "" }
}, { timestamps: true });

const User = mongoose.model("User", userSchema);
const Product = mongoose.model("Product", productSchema);
const Transaction = mongoose.model("Transaction", transactionSchema);

const productInput = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  unit: z.enum(["kg", "liter", "pcs"]),
  stock: z.coerce.number().min(0).default(0),
  purchaseRate: z.coerce.number().min(0).default(0),
  salesRate: z.coerce.number().min(0).default(0),
  lowStockThreshold: z.coerce.number().min(0).default(10),
  active: z.coerce.boolean().optional().default(true)
});
const transactionInput = z.object({
  type: z.enum(["Purchase", "Sale", "Expense"]),
  date: z.coerce.date(),
  productId: z.string().optional().nullable(),
  productName: z.string().trim().min(1).max(120),
  party: z.string().trim().max(160).optional().default(""),
  quantity: z.coerce.number().min(0).default(0),
  unit: z.enum(["kg", "liter", "pcs", "none"]),
  rate: z.coerce.number().min(0),
  amount: z.coerce.number().min(0),
  notes: z.string().trim().max(1000).optional().default("")
});

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Sign in required." });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  service: "hillsgoods-api",
  database: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
}));

// First-run setup. Set SETUP_SECRET in Render, then call this endpoint once.
// It refuses to create a second admin once an account exists.
app.post("/api/setup", rateLimit({ windowMs: 60 * 60 * 1000, limit: 5 }), async (req, res) => {
  try {
    if (!process.env.SETUP_SECRET || req.body.setupSecret !== process.env.SETUP_SECRET) {
      return res.status(403).json({ error: "Invalid setup secret." });
    }
    if (await User.countDocuments() > 0) {
      return res.status(409).json({ error: "Initial setup is already complete." });
    }
    const schema = z.object({
      email: z.string().email().max(200),
      password: z.string().min(12).max(200)
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and a password of at least 12 characters." });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await User.create({ email: parsed.data.email, passwordHash });
    return res.status(201).json({ ok: true, message: "Admin account created. You can now sign in." });
  } catch (e) {
    console.error("Setup error:", e.message);
    return res.status(500).json({ error: "Could not complete setup." });
  }
});

app.post("/api/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), async (req, res) => {
  try {
    const parsed = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter your email and password." });
    const user = await User.findOne({ email: parsed.data.email.toLowerCase() });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    const token = jwt.sign({ sub: user._id.toString(), email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: "8h" });
    return res.json({ token, user: { email: user.email, role: user.role }, expiresIn: 28800 });
  } catch (e) {
    console.error("Login error:", e.message);
    return res.status(500).json({ error: "Could not sign in." });
  }
});

app.use("/api", auth);

app.get("/api/products", async (_req, res) => {
  const products = await Product.find({ active: true }).sort({ name: 1 }).lean();
  res.json(products);
});
app.post("/api/products", async (req, res) => {
  const parsed = productInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid product details.", details: parsed.error.flatten() });
  const product = await Product.create(parsed.data);
  res.status(201).json(product);
});
app.patch("/api/products/:id", async (req, res) => {
  const parsed = productInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid product details.", details: parsed.error.flatten() });
  const product = await Product.findByIdAndUpdate(req.params.id, parsed.data, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json(product);
});
app.delete("/api/products/:id", async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json({ ok: true });
});

app.get("/api/transactions", async (req, res) => {
  const filter = {};
  if (["Purchase", "Sale", "Expense"].includes(req.query.type)) filter.type = req.query.type;
  if (req.query.from || req.query.to) {
    filter.date = {};
    if (req.query.from) filter.date.$gte = new Date(req.query.from);
    if (req.query.to) filter.date.$lte = new Date(req.query.to);
  }
  const transactions = await Transaction.find(filter).sort({ date: -1, createdAt: -1 }).limit(1000).lean();
  res.json(transactions);
});
app.post("/api/transactions", async (req, res) => {
  const parsed = transactionInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid transaction details.", details: parsed.error.flatten() });
  const data = parsed.data;
  let product = null;
  if (data.type !== "Expense") {
    if (!data.productId) return res.status(400).json({ error: "Select a product for purchases and sales." });
    product = await Product.findById(data.productId);
    if (!product || !product.active) return res.status(404).json({ error: "Product not found." });
    if (product.unit !== data.unit) return res.status(400).json({ error: "Transaction unit must match the product unit." });
    if (data.type === "Sale" && product.stock < data.quantity) {
      return res.status(409).json({ error: `Not enough stock. Available: ${product.stock} ${product.unit}.` });
    }
  }
  // Save transaction and update stock. MongoDB Atlas supports transactions on replica-set deployments.
  const session = await mongoose.startSession();
  try {
    let saved;
    await session.withTransaction(async () => {
      if (product && data.type === "Sale") {
        const update = await Product.updateOne({ _id: product._id, stock: { $gte: data.quantity } }, { $inc: { stock: -data.quantity } }, { session });
        if (update.modifiedCount !== 1) throw new Error("INSUFFICIENT_STOCK");
      } else if (product && data.type === "Purchase") {
        await Product.updateOne({ _id: product._id }, { $inc: { stock: data.quantity }, $set: { purchaseRate: data.rate } }, { session });
      }
      const payload = { ...data, productId: product?._id || null };
      [saved] = await Transaction.create([payload], { session });
    });
    res.status(201).json(saved);
  } catch (e) {
    if (e.message === "INSUFFICIENT_STOCK") return res.status(409).json({ error: "Stock changed before this sale could be saved. Refresh and try again." });
    console.error("Transaction save error:", e.message);
    res.status(500).json({ error: "Could not save transaction." });
  } finally {
    await session.endSession();
  }
});

app.get("/api/summary", async (_req, res) => {
  const [products, txs] = await Promise.all([
    Product.find({ active: true }).lean(),
    Transaction.find().lean()
  ]);
  const purchases = txs.filter(t => t.type === "Purchase").reduce((s,t) => s + t.amount, 0);
  const sales = txs.filter(t => t.type === "Sale").reduce((s,t) => s + t.amount, 0);
  const expenses = txs.filter(t => t.type === "Expense").reduce((s,t) => s + t.amount, 0);
  const stockValueAtPurchaseRate = products.reduce((s,p) => s + p.stock * p.purchaseRate, 0);
  res.json({
    productCount: products.length,
    totalPurchases: purchases,
    totalSales: sales,
    totalExpenses: expenses,
    stockValueAtPurchaseRate,
    // Intentionally labelled as a cash comparison, not accounting profit.
    salesMinusPurchases: sales - purchases,
    salesMinusPurchasesAndExpenses: sales - purchases - expenses
  });
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled API error:", err.message);
  res.status(500).json({ error: "Unexpected server error." });
});

const port = Number(process.env.PORT || 4000);
try {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.");
  app.listen(port, () => console.log(`Hillsgoods API listening on port ${port}`));
} catch (e) {
  console.error("MongoDB connection failed:", e.message);
  process.exit(1);
}
