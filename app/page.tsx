"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Coins, ShieldCheck, Gift, Zap, LogOut, RefreshCw, Crown, Clock3, History, UserRound, CheckCircle2 } from "lucide-react";

type Profile = { id: string; email: string | null; display_name: string | null; points: number; mining_power: number; role: string; last_checkin_at: string | null };
type Reward = { id: string; title: string; description: string | null; points_cost: number; reward_type: string; active: boolean };
type PackageItem = { id: string; title: string; description: string | null; price_label: string; power: number; duration_days: number; active: boolean };
type Tx = { id: string; kind: string; points_delta: number; description: string; created_at: string };

const supabase = createClient();

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [history, setHistory] = useState<Tx[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<"login"|"signup">("login");
  const [tab, setTab] = useState<"home"|"rewards"|"boosts"|"history"|"admin">("home");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminRequests, setAdminRequests] = useState<any[]>([]);
  const [newReward, setNewReward] = useState({title:"", points_cost:"100", reward_type:"coupon", description:""});
  const [newPackage, setNewPackage] = useState({title:"", price_label:"สอบถามแอดมิน", power:"2", duration_days:"30", description:""});

  async function load() {
    const { data: { session: current } } = await supabase.auth.getSession();
    setSession(current);
    if (!current) { setProfile(null); return; }
    const [p, r, b, h] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", current.user.id).single(),
      supabase.from("rewards").select("*").eq("active", true).order("points_cost"),
      supabase.from("mining_packages").select("*").eq("active", true).order("power"),
      supabase.from("point_transactions").select("id,kind,points_delta,description,created_at").order("created_at",{ascending:false}).limit(15)
    ]);
    if (p.data) setProfile(p.data as Profile);
    setRewards((r.data || []) as Reward[]);
    setPackages((b.data || []) as PackageItem[]);
    setHistory((h.data || []) as Tx[]);
  }
  useEffect(() => {
    load().catch(e => setNotice(e.message));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { load().catch(()=>{}); });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { subscription.unsubscribe(); clearInterval(timer); };
  }, []);

  const remaining = useMemo(() => {
    if (!profile?.last_checkin_at) return 0;
    return Math.max(0, 24*60*60*1000 - (now - new Date(profile.last_checkin_at).getTime()));
  }, [profile, now]);
  const timerText = `${String(Math.floor(remaining/3600000)).padStart(2,"0")}:${String(Math.floor((remaining%3600000)/60000)).padStart(2,"0")}:${String(Math.floor((remaining%60000)/1000)).padStart(2,"0")}`;

  async function authAction() {
    setBusy(true); setNotice("");
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
        if (error) throw error;
        setNotice("สมัครสมาชิกแล้ว หากเปิดยืนยันอีเมลไว้ กรุณาตรวจอีเมลเพื่อยืนยันบัญชี");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await load();
      }
    } catch (e: any) { setNotice(e.message || "เกิดข้อผิดพลาด"); }
    finally { setBusy(false); }
  }
  async function signOut() { await supabase.auth.signOut(); setSession(null); setProfile(null); setNotice("ออกจากระบบแล้ว"); }
  async function runRpc(name: string, args: Record<string, any> = {}, success = "ดำเนินการสำเร็จ") {
    setBusy(true); setNotice("");
    try {
      const { error } = await supabase.rpc(name, args);
      if (error) throw error;
      setNotice(success); await load();
      if (profile?.role === "admin") await loadAdmin();
    } catch (e: any) { setNotice(e.message || "ดำเนินการไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  async function loadAdmin() {
    const [u, q] = await Promise.all([
      supabase.rpc("admin_list_users"),
      supabase.rpc("admin_list_requests")
    ]);
    if (u.error) setNotice(u.error.message);
    else setAdminUsers(u.data || []);
    if (q.error) setNotice(q.error.message);
    else setAdminRequests(q.data || []);
  }
  async function addReward() {
    await runRpc("admin_create_reward", { p_title:newReward.title, p_description:newReward.description, p_points_cost:Number(newReward.points_cost), p_reward_type:newReward.reward_type }, "เพิ่มรางวัลแล้ว");
    setNewReward({title:"",points_cost:"100",reward_type:"coupon",description:""});
    await load();
  }
  async function addPackage() {
    await runRpc("admin_create_package", { p_title:newPackage.title, p_description:newPackage.description, p_price_label:newPackage.price_label, p_power:Number(newPackage.power), p_duration_days:Number(newPackage.duration_days) }, "เพิ่มแพ็กเกจแล้ว");
    setNewPackage({title:"",price_label:"สอบถามแอดมิน",power:"2",duration_days:"30",description:""});
    await load();
  }
  async function requestRedeem(r: Reward) {
    const ok = window.confirm(`ยืนยันแลก "${r.title}" ด้วย ${r.points_cost} คะแนนหรือไม่?`);
    if (ok) await runRpc("request_redemption", { p_reward_id:r.id }, "ส่งคำขอแลกคะแนนแล้ว");
  }
  async function requestBoost(p: PackageItem) {
    const ok = window.confirm(`ส่งคำขอซื้อ "${p.title}" (${p.price_label}) ให้แอดมินอนุมัติหรือไม่?`);
    if (ok) await runRpc("request_mining_package", { p_package_id:p.id }, "ส่งคำขอซื้อแรงขุดแล้ว กรุณารอแอดมินอนุมัติ");
  }
  async function adminDecision(id: string, approve: boolean) {
    await runRpc("admin_review_request", { p_request_id:id, p_approve:approve }, approve ? "อนุมัติคำขอแล้ว" : "ปฏิเสธคำขอแล้ว");
  }
  async function changePower(id: string, power: number) {
    await runRpc("admin_set_user_power", { p_user_id:id, p_power:power }, "แก้ไขแรงขุดแล้ว");
  }

  if (!session) return <main className="min-h-screen flex items-center justify-center p-4">
    <div className="panel w-full max-w-md p-7">
      <div className="mb-6 text-center"><div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-300 text-black"><Crown size={30}/></div><h1 className="text-3xl font-bold gold-text">9Zero1Property</h1><p className="mt-2 text-sm text-stone-400">สมาชิก • สะสมคะแนน • แลกรางวัล</p></div>
      <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-black p-1"><button className={`rounded-lg p-2 ${mode==="login"?"gold-button":""}`} onClick={()=>setMode("login")}>เข้าสู่ระบบ</button><button className={`rounded-lg p-2 ${mode==="signup"?"gold-button":""}`} onClick={()=>setMode("signup")}>สมัครสมาชิก</button></div>
      {mode==="signup" && <input className="field mb-3" placeholder="ชื่อที่แสดง" value={displayName} onChange={e=>setDisplayName(e.target.value)}/>}
      <input className="field mb-3" type="email" placeholder="อีเมล" value={email} onChange={e=>setEmail(e.target.value)}/>
      <input className="field mb-4" type="password" placeholder="รหัสผ่านอย่างน้อย 8 ตัวอักษร" value={password} onChange={e=>setPassword(e.target.value)}/>
      <button disabled={busy || !email || password.length<8} onClick={authAction} className="gold-button w-full rounded-xl p-3 disabled:opacity-50">{busy?"กำลังดำเนินการ…":mode==="login"?"เข้าสู่ระบบ":"สร้างบัญชี"}</button>
      {notice && <p className="mt-4 rounded-lg border border-amber-900 p-3 text-sm text-amber-200">{notice}</p>}
      <p className="mt-5 text-xs leading-5 text-stone-500">ระบบคะแนนนี้เป็นคะแนนภายในแอป ไม่ใช่เหรียญคริปโตหรือเงินฝาก การแลกเป็นเงินหรือสินทรัพย์จริงต้องกำหนดเงื่อนไขและตรวจสอบกฎหมายก่อนเปิดใช้งาน</p>
    </div>
  </main>;

  if (!profile) return <main className="min-h-screen grid place-items-center p-6"><div className="panel p-6 text-center"><RefreshCw className="mx-auto mb-3 animate-spin gold-text"/><p>กำลังโหลดข้อมูลสมาชิก…</p><button className="mt-4 underline gold-text" onClick={()=>load()}>โหลดอีกครั้ง</button><p className="mt-3 text-sm text-stone-400">{notice}</p></div></main>;

  return <main className="min-h-screen pb-10">
    <header className="sticky top-0 z-10 border-b border-amber-950 bg-black/90 px-4 py-3 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-300 text-black"><Crown/></div><div><h1 className="font-bold gold-text">9Zero1Property</h1><p className="text-xs text-stone-400">ศูนย์สมาชิกและคะแนน</p></div></div><button onClick={signOut} className="flex items-center gap-2 rounded-lg border border-stone-700 px-3 py-2 text-sm"><LogOut size={16}/> ออก</button></div></header>
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-stone-400">ยินดีต้อนรับ</p><h2 className="text-2xl font-semibold">{profile.display_name || session.user.email}</h2><p className="mt-1 text-xs text-stone-500">{profile.role==="admin"?"ผู้ดูแลระบบ":"สมาชิก"} • ID {profile.id.slice(0,8)}</p></div><button onClick={()=>load()} className="flex items-center gap-2 rounded-lg border border-stone-700 px-3 py-2 text-sm"><RefreshCw size={15}/> รีเฟรช</button></div>
      {notice && <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-100"><CheckCircle2 size={18} className="shrink-0"/><span>{notice}</span><button className="ml-auto" onClick={()=>setNotice("")}>×</button></div>}
      <nav className="mb-6 flex gap-2 overflow-x-auto pb-1">{([["home","ภาพรวม"],["rewards","แลกคะแนน"],["boosts","ซื้อแรงขุด"],["history","ประวัติ"],...(profile.role==="admin"?[["admin","หลังบ้าน"]]:[])] as string[][]).map(([key,label])=><button key={key} onClick={()=>{setTab(key as any);if(key==="admin")loadAdmin();}} className={`shrink-0 rounded-xl px-4 py-2 text-sm ${tab===key?"gold-button":"border border-stone-700 text-stone-300"}`}>{label}</button>)}</nav>

      {tab==="home" && <div className="grid gap-4 md:grid-cols-3">
        <section className="panel p-5 md:col-span-2"><div className="flex items-start justify-between"><div><p className="text-sm text-stone-400">คะแนนสะสม</p><div className="mt-2 flex items-center gap-3"><Coins className="gold-text" size={30}/><span className="text-4xl font-bold gold-text">{Number(profile.points).toLocaleString()}</span><span className="text-sm text-stone-400">คะแนน</span></div></div><div className="rounded-xl bg-amber-400/10 p-3 gold-text"><Zap size={26}/></div></div><div className="mt-6 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-black/50 p-4"><p className="text-xs text-stone-400">กำลังขุดต่อรอบ 24 ชั่วโมง</p><p className="mt-1 text-2xl font-semibold">{profile.mining_power} <span className="text-sm font-normal">คะแนน</span></p></div><div className="rounded-xl bg-black/50 p-4"><p className="text-xs text-stone-400">สถานะรอบถัดไป</p><p className="mt-1 flex items-center gap-2 text-2xl font-semibold"><Clock3 size={20} className="gold-text"/>{remaining===0?"พร้อมรับคะแนน":timerText}</p></div></div><button disabled={busy||remaining>0} onClick={()=>runRpc("claim_mining_points",{},"รับคะแนนจากการขุดแล้ว")} className="gold-button mt-5 flex w-full items-center justify-center gap-2 rounded-xl p-3 disabled:cursor-not-allowed disabled:opacity-40"><Zap size={18}/>{remaining===0?"รับคะแนนรอบนี้":"รอให้ครบ 24 ชั่วโมง"}</button><p className="mt-3 text-xs leading-5 text-stone-500">ตัวเลขเวลาบนหน้าจอเป็นตัวนับถอยหลัง คะแนนจะเข้าบัญชีเมื่อเซิร์ฟเวอร์ยืนยันการรับคะแนนสำเร็จเท่านั้น</p></section>
        <section className="panel p-5"><h3 className="mb-4 flex items-center gap-2 font-semibold"><ShieldCheck className="gold-text"/> บัญชีของฉัน</h3><p className="break-all text-sm text-stone-300">{session.user.email}</p><div className="my-4 h-px bg-stone-800"/><p className="text-xs text-stone-500">ระบบสะสมคะแนน</p><p className="mt-1 text-sm">ทุก 24 ชั่วโมงต่อการรับคะแนนหนึ่งครั้ง</p><button onClick={()=>setTab("rewards")} className="mt-5 w-full rounded-xl border border-amber-700 p-3 text-sm gold-text">ดูรางวัลที่แลกได้</button></section>
        <section className="panel p-5 md:col-span-3"><h3 className="mb-4 flex items-center gap-2 font-semibold"><History className="gold-text"/> รายการล่าสุด</h3>{history.length===0?<p className="text-sm text-stone-500">ยังไม่มีประวัติรายการ</p>:<div className="space-y-3">{history.slice(0,5).map(t=><div key={t.id} className="flex items-center justify-between gap-3 border-b border-stone-800 pb-3 last:border-0"><div><p className="text-sm">{t.description}</p><p className="text-xs text-stone-500">{new Date(t.created_at).toLocaleString("th-TH")}</p></div><span className={t.points_delta>=0?"gold-text":"text-rose-300"}>{t.points_delta>0?"+":""}{t.points_delta} คะแนน</span></div>)}</div>}</section>
      </div>}

      {tab==="rewards" && <section className="panel p-5"><h3 className="mb-2 flex items-center gap-2 text-xl font-semibold"><Gift className="gold-text"/> แลกคะแนน</h3><p className="mb-5 text-sm text-stone-400">เลือกของรางวัล คูปอง หรือส่งคำขอแลกประเภทอื่นตามรายการที่แอดมินเปิดไว้</p>{rewards.length===0?<p className="text-sm text-stone-500">ยังไม่มีรางวัล กรุณากลับมาดูภายหลัง</p>:<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rewards.map(r=><div className="rounded-xl border border-stone-800 bg-black/40 p-4" key={r.id}><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10 gold-text"><Gift/></div><h4 className="font-semibold">{r.title}</h4><p className="mt-1 min-h-10 text-sm text-stone-400">{r.description||"รางวัลสำหรับสมาชิก"}</p><p className="mt-4 font-semibold gold-text">{r.points_cost.toLocaleString()} คะแนน</p><button disabled={busy||profile.points<r.points_cost} onClick={()=>requestRedeem(r)} className="mt-3 w-full rounded-lg gold-button p-2 disabled:opacity-40">ส่งคำขอแลก</button></div>)}</div>}</section>}

      {tab==="boosts" && <section className="panel p-5"><h3 className="mb-2 flex items-center gap-2 text-xl font-semibold"><Zap className="gold-text"/> ซื้อแรงขุด</h3><p className="mb-5 text-sm text-stone-400">ส่งคำขอให้แอดมินตรวจสอบก่อนเปิดใช้ ไม่มีการตัดเงินอัตโนมัติในเวอร์ชันนี้</p>{packages.length===0?<p className="text-sm text-stone-500">ยังไม่มีแพ็กเกจแรงขุด</p>:<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{packages.map(p=><div className="rounded-xl border border-stone-800 bg-black/40 p-4" key={p.id}><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10 gold-text"><Zap/></div><h4 className="font-semibold">{p.title}</h4><p className="mt-1 text-sm text-stone-400">{p.description||"แพ็กเกจเพิ่มแรงขุด"}</p><p className="mt-4 text-2xl font-bold gold-text">{p.power} <span className="text-sm font-normal">คะแนน/รอบ</span></p><p className="mt-1 text-sm text-stone-400">{p.duration_days} วัน • {p.price_label}</p><button disabled={busy} onClick={()=>requestBoost(p)} className="mt-3 w-full rounded-lg gold-button p-2 disabled:opacity-40">ขอซื้อแพ็กเกจ</button></div>)}</div>}</section>}

      {tab==="history" && <section className="panel p-5"><h3 className="mb-4 flex items-center gap-2 text-xl font-semibold"><History className="gold-text"/> ประวัติคะแนน</h3>{history.length===0?<p className="text-sm text-stone-500">ยังไม่มีรายการ</p>:<div className="space-y-3">{history.map(t=><div key={t.id} className="flex items-center justify-between gap-3 border-b border-stone-800 pb-3"><div><p className="text-sm">{t.description}</p><p className="text-xs text-stone-500">{new Date(t.created_at).toLocaleString("th-TH")}</p></div><span className={t.points_delta>=0?"gold-text":"text-rose-300"}>{t.points_delta>0?"+":""}{t.points_delta} คะแนน</span></div>)}</div>}</section>}

      {tab==="admin" && profile.role==="admin" && <div className="space-y-5">
        <section className="panel p-5"><h3 className="mb-4 text-xl font-semibold gold-text">หลังบ้านแอดมิน</h3><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-black/40 p-4"><p className="text-sm text-stone-400">สมาชิกทั้งหมด</p><p className="text-3xl font-bold">{adminUsers.length}</p></div><div className="rounded-xl bg-black/40 p-4"><p className="text-sm text-stone-400">คำขอรอตรวจสอบ</p><p className="text-3xl font-bold">{adminRequests.filter(x=>x.status==="pending").length}</p></div></div><button onClick={loadAdmin} className="mt-4 rounded-lg border border-stone-700 px-3 py-2 text-sm">โหลดข้อมูลหลังบ้าน</button></section>
        <section className="panel p-5"><h4 className="mb-3 font-semibold">เพิ่มของรางวัล</h4><div className="grid gap-3 sm:grid-cols-2"><input className="field" placeholder="ชื่อรางวัล" value={newReward.title} onChange={e=>setNewReward({...newReward,title:e.target.value})}/><input className="field" placeholder="คะแนนที่ใช้แลก" type="number" min="1" value={newReward.points_cost} onChange={e=>setNewReward({...newReward,points_cost:e.target.value})}/><select className="field" value={newReward.reward_type} onChange={e=>setNewReward({...newReward,reward_type:e.target.value})}><option value="coupon">คูปอง</option><option value="physical">ของรางวัล</option><option value="cash_request">คำขอแลกเงิน</option><option value="digital_asset_request">คำขอแลกสินทรัพย์ดิจิทัล</option><option value="other">อื่น ๆ</option></select><input className="field" placeholder="รายละเอียด" value={newReward.description} onChange={e=>setNewReward({...newReward,description:e.target.value})}/></div><button disabled={!newReward.title||Number(newReward.points_cost)<1||busy} onClick={addReward} className="gold-button mt-3 rounded-lg px-4 py-2 disabled:opacity-40">เพิ่มรางวัล</button></section>
        <section className="panel p-5"><h4 className="mb-3 font-semibold">เพิ่มแพ็กเกจแรงขุด</h4><div className="grid gap-3 sm:grid-cols-2"><input className="field" placeholder="ชื่อแพ็กเกจ" value={newPackage.title} onChange={e=>setNewPackage({...newPackage,title:e.target.value})}/><input className="field" placeholder="ป้ายราคา เช่น 99 บาท" value={newPackage.price_label} onChange={e=>setNewPackage({...newPackage,price_label:e.target.value})}/><input className="field" type="number" min="1" placeholder="คะแนนต่อรอบ" value={newPackage.power} onChange={e=>setNewPackage({...newPackage,power:e.target.value})}/><input className="field" type="number" min="1" placeholder="จำนวนวัน" value={newPackage.duration_days} onChange={e=>setNewPackage({...newPackage,duration_days:e.target.value})}/><input className="field sm:col-span-2" placeholder="รายละเอียด" value={newPackage.description} onChange={e=>setNewPackage({...newPackage,description:e.target.value})}/></div><button disabled={!newPackage.title||Number(newPackage.power)<1||Number(newPackage.duration_days)<1||busy} onClick={addPackage} className="gold-button mt-3 rounded-lg px-4 py-2 disabled:opacity-40">เพิ่มแพ็กเกจ</button></section>
        <section className="panel p-5"><h4 className="mb-3 font-semibold">คำขอจากสมาชิก</h4>{adminRequests.length===0?<p className="text-sm text-stone-500">ไม่มีคำขอ</p>:<div className="space-y-3">{adminRequests.map((q:any)=><div key={q.id} className="rounded-xl border border-stone-800 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{q.request_type==="redemption"?"คำขอแลกรางวัล":"คำขอซื้อแรงขุด"} — {q.title||q.description||"รายการ"}</p><p className="text-xs text-stone-500">สมาชิก: {q.email||q.user_id} • {new Date(q.created_at).toLocaleString("th-TH")}</p><p className="mt-1 text-sm">สถานะ: {q.status} {q.points_cost?`• ${q.points_cost} คะแนน`:""} {q.price_label?`• ${q.price_label}`:""}</p></div>{q.status==="pending"&&<div className="flex gap-2"><button onClick={()=>adminDecision(q.id,true)} className="rounded-lg gold-button px-3 py-2 text-sm">อนุมัติ</button><button onClick={()=>adminDecision(q.id,false)} className="rounded-lg border border-rose-900 px-3 py-2 text-sm text-rose-200">ปฏิเสธ</button></div>}</div></div>)}</div>}</section>
        <section className="panel p-5"><h4 className="mb-3 font-semibold">สมาชิกและแรงขุด</h4>{adminUsers.map((u:any)=><div key={u.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-800 py-3"><div><p>{u.display_name||u.email||u.id}</p><p className="text-xs text-stone-500">{u.email} • {u.points} คะแนน • {u.role}</p></div><div className="flex items-center gap-2"><select className="field !w-24" defaultValue={u.mining_power} id={`power-${u.id}`}><option value="1">1</option><option value="2">2</option><option value="5">5</option><option value="10">10</option></select><button onClick={()=>{const el=document.getElementById(`power-${u.id}`) as HTMLSelectElement|null;if(el)changePower(u.id,Number(el.value));}} className="rounded-lg border border-amber-700 px-3 py-2 text-sm gold-text">ตั้งแรงขุด</button></div></div>)}</section>
      </div>}
      <footer className="mt-8 text-center text-xs leading-5 text-stone-600">9Zero1Property • MVP รุ่นทดลอง • คะแนนและรายการทั้งหมดขึ้นกับการตั้งค่าฐานข้อมูลและการอนุมัติของแอดมิน</footer>
    </div>
  </main>;
}
