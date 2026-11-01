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
const required = ["MONGODB_URI", "JWT_SECRET", "FRONTEND_ORIGIN", "SETUP_SECRET"];
for (const key of required) if (!process.env[key]) { console.error(`Missing required environment variable: ${key}`); process.exit(1); }
if (process.env.JWT_SECRET.length < 32) { console.error("JWT_SECRET must be at least 32 characters."); process.exit(1); }

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({origin:process.env.FRONTEND_ORIGIN.split(",").map(s=>s.trim()),methods:["GET","POST","PATCH","DELETE","OPTIONS"],allowedHeaders:["Content-Type","Authorization"]}));
app.use(express.json({limit:"2mb"}));
app.use(rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:"draft-7",legacyHeaders:false}));

const userSchema = new mongoose.Schema({
 name:{type:String,trim:true,default:"Hillsgoods User",maxlength:100},
 email:{type:String,required:true,unique:true,lowercase:true,trim:true},
 passwordHash:{type:String,required:true},
 role:{type:String,enum:["admin","staff"],default:"admin"},
 businessName:{type:String,default:"Hillsgoods",maxlength:120},
 businessTagline:{type:String,default:"Malamchirakk",maxlength:200},
 language:{type:String,enum:["en","ml"],default:"en"}
},{timestamps:true});
const productSchema = new mongoose.Schema({
 name:{type:String,trim:true,default:"",maxlength:120},
 nameEn:{type:String,trim:true,default:"",maxlength:120},
 nameMl:{type:String,trim:true,default:"",maxlength:120},
 category:{type:String,required:true,trim:true,maxlength:80},
 unit:{type:String,enum:["kg","liter","pcs"],required:true},
 stock:{type:Number,min:0,default:0},
 purchaseRate:{type:Number,min:0,default:0},
 salesRate:{type:Number,min:0,default:0},
 currentMarketRate:{type:Number,min:0,default:0},
 averageCost:{type:Number,min:0,default:0},
 lowStockThreshold:{type:Number,min:0,default:10},
 imageUrl:{type:String,default:"",maxlength:1400000},
 rateUpdatedAt:{type:Date,default:null},
 active:{type:Boolean,default:true}
},{timestamps:true});
const transactionSchema = new mongoose.Schema({
 invoiceNo:{type:String,required:true,index:true},
 type:{type:String,enum:["Purchase","Sale","Expense"],required:true},
 date:{type:Date,required:true,index:true},
 productId:{type:mongoose.Schema.Types.ObjectId,ref:"Product",default:null},
 productName:{type:String,required:true,trim:true},
 party:{type:String,trim:true,default:""},
 quantity:{type:Number,min:0,default:0},
 unit:{type:String,enum:["kg","liter","pcs","none"],default:"none"},
 rate:{type:Number,min:0,required:true},
 amount:{type:Number,min:0,required:true},
 costOfGoods:{type:Number,min:0,default:0},
 grossProfit:{type:Number,default:0},
 notes:{type:String,trim:true,default:""}
},{timestamps:true});
const rateSchema = new mongoose.Schema({
 productId:{type:mongoose.Schema.Types.ObjectId,ref:"Product",required:true,index:true},
 productName:{type:String,required:true},
 date:{type:Date,required:true,index:true},
 marketRate:{type:Number,min:0,required:true},
 purchaseRate:{type:Number,min:0,required:true},
 salesRate:{type:Number,min:0,required:true},
 note:{type:String,default:"",maxlength:250},
 createdBy:{type:mongoose.Schema.Types.ObjectId,ref:"User"}
},{timestamps:true});
const User=mongoose.model("User",userSchema);
const Product=mongoose.model("Product",productSchema);
const Transaction=mongoose.model("Transaction",transactionSchema);
const RateHistory=mongoose.model("RateHistory",rateSchema);

const productInputBase=z.object({
 name:z.string().trim().max(120).optional().default(""),
 nameEn:z.string().trim().max(120).optional().default(""),
 nameMl:z.string().trim().max(120).optional().default(""),
 category:z.string().trim().min(1).max(80),
 unit:z.enum(["kg","liter","pcs"]),stock:z.coerce.number().min(0).optional(),
 purchaseRate:z.coerce.number().min(0),salesRate:z.coerce.number().min(0),
 currentMarketRate:z.coerce.number().min(0).optional().default(0),
 lowStockThreshold:z.coerce.number().min(0).optional().default(10),
 imageUrl:z.string().max(1400000).optional().default("")
});
const productInput=productInputBase.refine(v=>Boolean(v.nameEn||v.nameMl||v.name),{message:"Enter an English or Malayalam product name."});
const transactionInput=z.object({
 type:z.enum(["Purchase","Sale","Expense"]),date:z.coerce.date(),
 productId:z.string().nullable().optional(),productName:z.string().trim().min(1).max(120),
 party:z.string().trim().max(160).optional().default(""),quantity:z.coerce.number().min(0),
 unit:z.enum(["kg","liter","pcs","none"]),rate:z.coerce.number().min(0),amount:z.coerce.number().min(0),
 notes:z.string().trim().max(1000).optional().default("")
});
function publicUser(u){return {id:u._id,name:u.name,email:u.email,role:u.role,businessName:u.businessName,businessTagline:u.businessTagline,language:u.language||"en"};}
function productNames(p){const raw=p?.toObject ? p.toObject() : p;return {...raw,nameEn:raw.nameEn||raw.name||"",nameMl:raw.nameMl||"",name:raw.name||raw.nameEn||raw.nameMl||""};}
function auth(req,res,next){const h=req.headers.authorization||"";const token=h.startsWith("Bearer ")?h.slice(7):"";if(!token)return res.status(401).json({error:"Sign in required."});try{req.user=jwt.verify(token,process.env.JWT_SECRET);next()}catch{return res.status(401).json({error:"Session expired. Please sign in again."})}}
function admin(req,res,next){if(req.user.role!=="admin")return res.status(403).json({error:"Admin access required."});next()}
function invoiceNo(){return "HG-"+new Date().toISOString().slice(0,10).replaceAll("-","")+"-"+Math.random().toString(36).slice(2,7).toUpperCase()}
app.get("/api/health",(_req,res)=>res.json({ok:true,service:"hillsgoods-api",database:mongoose.connection.readyState===1?"connected":"disconnected"}));

app.post("/api/setup",rateLimit({windowMs:3600000,limit:5}),async(req,res)=>{
 try{
  if(req.body.setupSecret!==process.env.SETUP_SECRET)return res.status(403).json({error:"Invalid setup secret."});
  if(await User.countDocuments())return res.status(409).json({error:"Initial setup is already complete."});
  const parsed=z.object({name:z.string().trim().min(1).max(100),email:z.string().email().max(200),password:z.string().min(12).max(200)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Provide a name, valid email, and password with at least 12 characters."});
  const u=await User.create({name:parsed.data.name,email:parsed.data.email,passwordHash:await bcrypt.hash(parsed.data.password,12),role:"admin"});
  res.status(201).json({ok:true,user:publicUser(u),message:"Admin account created. You can sign in now."});
 }catch(e){console.error("Setup error:",e.message);res.status(500).json({error:"Could not complete setup."})}
});
app.post("/api/login",rateLimit({windowMs:900000,limit:10}),async(req,res)=>{
 try{const p=z.object({email:z.string().email(),password:z.string().min(1).max(200)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Enter email and password."});
 const u=await User.findOne({email:p.data.email.toLowerCase()});if(!u||!(await bcrypt.compare(p.data.password,u.passwordHash)))return res.status(401).json({error:"Incorrect email or password."});
 const token=jwt.sign({sub:u._id.toString(),email:u.email,role:u.role},process.env.JWT_SECRET,{expiresIn:"8h"});res.json({token,user:publicUser(u),expiresIn:28800});
 }catch(e){console.error("Login error:",e.message);res.status(500).json({error:"Could not sign in."})}
});
app.use("/api",auth);
// Admin-only user management. Passwords are never returned and are always hashed.
app.get("/api/users",admin,async(_req,res)=>res.json((await User.find().sort({createdAt:1}).lean()).map(u=>({id:u._id,name:u.name,email:u.email,role:u.role,language:u.language||"en",createdAt:u.createdAt}))));
app.post("/api/users",admin,rateLimit({windowMs:3600000,limit:30}),async(req,res)=>{
 const p=z.object({name:z.string().trim().min(1).max(100),email:z.string().email().max(200),password:z.string().min(12).max(200),role:z.enum(["admin","staff"]).default("staff"),language:z.enum(["en","ml"]).default("en")}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"Enter a name, valid email, password (at least 12 characters), role and language."});
 try{const u=await User.create({...p.data,email:p.data.email.toLowerCase(),passwordHash:await bcrypt.hash(p.data.password,12)});res.status(201).json({id:u._id,name:u.name,email:u.email,role:u.role,language:u.language,createdAt:u.createdAt})}
 catch(e){if(e.code===11000)return res.status(409).json({error:"An account with that email already exists."});console.error("Create user:",e.message);res.status(500).json({error:"Could not create user."})}
});
app.patch("/api/users/:id",admin,async(req,res)=>{
 const p=z.object({name:z.string().trim().min(1).max(100).optional(),role:z.enum(["admin","staff"]).optional(),language:z.enum(["en","ml"]).optional(),password:z.string().min(12).max(200).optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"Invalid user details. Passwords must be at least 12 characters."});
 if(req.params.id===req.user.sub&&p.data.role==="staff")return res.status(400).json({error:"You cannot remove your own admin role."});
 try{const changes={...p.data};if(changes.password){changes.passwordHash=await bcrypt.hash(changes.password,12);delete changes.password}const u=await User.findByIdAndUpdate(req.params.id,changes,{new:true,runValidators:true});if(!u)return res.status(404).json({error:"User not found."});res.json({id:u._id,name:u.name,email:u.email,role:u.role,language:u.language||"en"})}
 catch(e){res.status(500).json({error:"Could not update user."})}
});

app.get("/api/me",async(req,res)=>{const u=await User.findById(req.user.sub);if(!u)return res.status(404).json({error:"User not found."});res.json(publicUser(u))});
app.patch("/api/me",async(req,res)=>{
 const parsed=z.object({name:z.string().trim().min(1).max(100),email:z.string().email().max(200),businessName:z.string().trim().max(120).optional().default("Hillsgoods"),businessTagline:z.string().trim().max(200).optional().default("Malamchirakk"),language:z.enum(["en","ml"]).optional()}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:"Invalid profile details."});
 try{const duplicate=await User.findOne({email:parsed.data.email.toLowerCase(),_id:{$ne:req.user.sub}});if(duplicate)return res.status(409).json({error:"That email is already in use."});
 const u=await User.findByIdAndUpdate(req.user.sub,{...parsed.data,email:parsed.data.email.toLowerCase()},{new:true,runValidators:true});res.json(publicUser(u));
 }catch(e){res.status(500).json({error:"Could not update profile."})}
});
app.patch("/api/me/password",async(req,res)=>{
 const p=z.object({currentPassword:z.string().min(1).max(200),newPassword:z.string().min(12).max(200)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"New password must be at least 12 characters."});
 const u=await User.findById(req.user.sub);if(!u||!(await bcrypt.compare(p.data.currentPassword,u.passwordHash)))return res.status(400).json({error:"Current password is incorrect."});
 u.passwordHash=await bcrypt.hash(p.data.newPassword,12);await u.save();res.json({ok:true,message:"Password updated."});
});

// Product data starts empty; no demonstration records are seeded.
app.get("/api/products",async(_req,res)=>res.json((await Product.find({active:true}).sort({name:1}).lean()).map(p=>({...p,nameEn:p.nameEn||p.name||"",nameMl:p.nameMl||"",name:p.name||p.nameEn||p.nameMl||""}))));
app.post("/api/products",async(req,res)=>{
 const p=productInput.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid product details."});
 try{const data={...p.data,name:p.data.name||p.data.nameEn||p.data.nameMl,stock:p.data.stock??0,averageCost:p.data.purchaseRate};const product=await Product.create(data);res.status(201).json(productNames(product))}
 catch(e){res.status(400).json({error:"Could not create product."})}
});
app.patch("/api/products/:id",async(req,res)=>{
 const p=productInputBase.partial().safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid product details."});
 try{const update={...p.data};delete update.stock;if(update.nameEn||update.nameMl)update.name=update.name||update.nameEn||update.nameMl;const product=await Product.findOneAndUpdate({_id:req.params.id,active:true},update,{new:true,runValidators:true});if(!product)return res.status(404).json({error:"Product not found."});res.json(productNames(product))}
 catch(e){res.status(400).json({error:"Could not update product."})}
});
app.delete("/api/products/:id",async(req,res)=>{const p=await Product.findByIdAndUpdate(req.params.id,{active:false},{new:true});if(!p)return res.status(404).json({error:"Product not found."});res.json({ok:true})});

app.get("/api/rates",async(_req,res)=>res.json(await RateHistory.find().sort({date:-1,createdAt:-1}).limit(1000).lean()));
app.post("/api/rates",async(req,res)=>{
 const p=z.object({productId:z.string(),marketRate:z.coerce.number().min(0),purchaseRate:z.coerce.number().min(0),salesRate:z.coerce.number().min(0),date:z.coerce.date(),note:z.string().trim().max(250).optional().default("")}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"Invalid rate details."});
 const product=await Product.findOne({_id:p.data.productId,active:true});if(!product)return res.status(404).json({error:"Product not found."});
 try{
  const hist=await RateHistory.create({productId:product._id,productName:product.name,...p.data,createdBy:req.user.sub});
  product.currentMarketRate=p.data.marketRate;product.purchaseRate=p.data.purchaseRate;product.salesRate=p.data.salesRate;product.rateUpdatedAt=p.data.date;await product.save();
  res.status(201).json(hist);
 }catch(e){console.error("Rate save:",e.message);res.status(500).json({error:"Could not save rates."})}
});

app.get("/api/transactions",async(req,res)=>{
 const filter={};if(["Purchase","Sale","Expense"].includes(req.query.type))filter.type=req.query.type;
 if(req.query.from||req.query.to){filter.date={};if(req.query.from)filter.date.$gte=new Date(req.query.from);if(req.query.to)filter.date.$lte=new Date(req.query.to)}
 res.json(await Transaction.find(filter).sort({date:-1,createdAt:-1}).limit(3000).lean());
});
app.post("/api/transactions",async(req,res)=>{
 const parsed=transactionInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Invalid transaction details."});
 const d=parsed.data;let product=null;
 if(d.type!=="Expense"){if(!d.productId)return res.status(400).json({error:"Select a product."});product=await Product.findOne({_id:d.productId,active:true});if(!product)return res.status(404).json({error:"Product not found."});if(product.unit!==d.unit)return res.status(400).json({error:"Transaction unit must match the product unit."});}
 if(d.type==="Sale"&&product.stock<d.quantity)return res.status(409).json({error:`Not enough stock. Available: ${product.stock} ${product.unit}.`});
 const session=await mongoose.startSession();
 try{
  let saved;
  await session.withTransaction(async()=>{
   let costOfGoods=0,grossProfit=0;
   if(product&&d.type==="Purchase"){
    const oldStock=product.stock, oldCost=product.averageCost||product.purchaseRate;
    const newStock=oldStock+d.quantity;
    const newAverage=newStock>0?((oldStock*oldCost)+(d.quantity*d.rate))/newStock:0;
    await Product.updateOne({_id:product._id},{$inc:{stock:d.quantity},$set:{purchaseRate:d.rate,averageCost:newAverage}},{session});
   }else if(product&&d.type==="Sale"){
    const costRate=product.averageCost||product.purchaseRate;
    costOfGoods=d.quantity*costRate;grossProfit=d.amount-costOfGoods;
    const updated=await Product.updateOne({_id:product._id,stock:{$gte:d.quantity}},{$inc:{stock:-d.quantity}},{session});
    if(updated.modifiedCount!==1)throw new Error("INSUFFICIENT_STOCK");
   }
   const payload={...d,invoiceNo:invoiceNo(),productId:product?product._id:null,costOfGoods,grossProfit};
   [saved]=await Transaction.create([payload],{session});
  });
  res.status(201).json(saved);
 }catch(e){if(e.message==="INSUFFICIENT_STOCK")return res.status(409).json({error:"Stock changed before this sale could be saved. Refresh and retry."});console.error("Transaction save:",e.message);res.status(500).json({error:"Could not save transaction."})}
 finally{await session.endSession()}
});
app.get("/api/summary",async(_req,res)=>{
 const [products,txs]=await Promise.all([Product.find({active:true}).lean(),Transaction.find().lean()]);
 const total=(type,field="amount")=>txs.filter(t=>t.type===type).reduce((s,t)=>s+(Number(t[field])||0),0);
 res.json({productCount:products.length,totalPurchases:total("Purchase"),totalSales:total("Sale"),totalExpenses:total("Expense"),grossProfit:total("Sale","grossProfit"),stockValueAtCost:products.reduce((s,p)=>s+p.stock*(p.averageCost||p.purchaseRate),0),totalStockUnits:products.reduce((s,p)=>s+p.stock,0),transactionCount:txs.length});
});

app.use((err,_req,res,_next)=>{console.error("Unhandled API error:",err.message);res.status(500).json({error:"Unexpected server error."})});
const port=Number(process.env.PORT||4000);
try{await mongoose.connect(process.env.MONGODB_URI);console.log("Connected to MongoDB.");app.listen(port,()=>console.log(`Hillsgoods API listening on port ${port}`))}
catch(e){console.error("MongoDB connection failed:",e.message);process.exit(1)}
