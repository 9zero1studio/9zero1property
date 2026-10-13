# 9Zero1Property — MVP

เว็บแอปสะสมคะแนนธีมดำ-ทอง ใช้ Next.js + Supabase + Vercel และสามารถติดตั้งเป็น PWA บน Android ได้

## ฟีเจอร์ใน MVP
- สมัครสมาชิก / เข้าสู่ระบบด้วย Supabase Auth
- โปรไฟล์สมาชิกและคะแนน
- เช็กอินรับคะแนนได้เมื่อครบ 24 ชั่วโมง โดยตรวจสอบที่ PostgreSQL
- ประวัติรายการคะแนน
- แลกคะแนนเป็นคำขอแลกรางวัล คะแนนจะถูกหักเมื่อส่งคำขอ และคืนอัตโนมัติเมื่อแอดมินปฏิเสธ
- ส่งคำขอซื้อแรงขุดให้แอดมินอนุมัติ
- หลังบ้าน: ดูสมาชิก/คำขอ เพิ่มรางวัล เพิ่มแพ็กเกจ และปรับแรงขุด
- RLS และ RPC ที่ตรวจสอบสิทธิ์ฝั่งฐานข้อมูล

> ข้อจำกัดสำคัญ: การซื้อแรงขุดเป็นเพียงคำขออนุมัติด้วยมือ ยังไม่มีการรับชำระเงินจริง และการแลกเงิน/สินทรัพย์ดิจิทัลยังเป็นเพียงชนิดคำขอ ไม่ใช่ระบบจ่ายเงินจริงหรือกระเป๋าคริปโต

## สิ่งที่ต้องมี
- บัญชี Supabase
- บัญชี GitHub
- บัญชี Vercel
- Node.js 20 หรือรุ่น LTS ปัจจุบัน

## 1. สร้างฐานข้อมูล
1. สร้างโปรเจกต์ใหม่ที่ https://supabase.com
2. เปิดเมนู **SQL Editor** แล้ววางเนื้อหาจาก `supabase/schema.sql` ทั้งหมด กด Run
3. ไปที่ **Project Settings → API** จด Project URL และ anon/public key
4. ไปที่ **Authentication → URL Configuration** ตั้ง Site URL เป็น URL ของเว็บหลัง deploy (ระหว่างทดสอบใส่ `http://localhost:3000`) และเพิ่ม Redirect URLs ที่ต้องใช้
5. สมัครสมาชิกบัญชีแรกจากหน้าเว็บ แล้วไป SQL Editor และตั้งบัญชีนี้เป็นแอดมินด้วยคำสั่งด้านล่าง (แทน EMAIL):

   ```sql
   update public.profiles
   set role = 'admin'
   where email = 'EMAIL';
   ```

   อย่าตั้งสิทธิ์แอดมินจากโค้ดฝั่ง browser และอย่าเปิดให้สมาชิกเปลี่ยน role เอง

## 2. รันบนเครื่อง
1. แตก ZIP
2. เปิด terminal ในโฟลเดอร์โปรเจกต์ แล้วรัน:

   ```bash
   npm install
   ```
3. คัดลอก `.env.example` เป็น `.env.local`
4. ใส่ค่า Supabase:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
   ```
5. รัน:

   ```bash
   npm run dev
   ```
6. เปิด http://localhost:3000

## 3. เผยแพร่ฟรีด้วย Vercel
1. สร้าง repository บน GitHub แล้วอัปโหลดไฟล์ในโปรเจกต์นี้
2. เข้า https://vercel.com → Add New → Project → เลือก repository
3. ใน Environment Variables เพิ่ม `NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. กด Deploy
5. นำ URL ที่ได้ไปตั้งใน Supabase Authentication → URL Configuration เป็น Site URL และเพิ่ม URL เดียวกันใน Redirect URLs

## 4. ใช้บน Android
หลัง deploy ให้เปิด URL ผ่าน Chrome บน Android → เมนูสามจุด → **Add to Home screen** หรือ **Install app** หากเบราว์เซอร์แสดงตัวเลือกนั้น

PWA ในเวอร์ชันนี้เป็นเว็บที่ติดตั้งจากเบราว์เซอร์ ไม่ใช่ไฟล์ APK สำหรับ Play Store หากต้องการ APK สามารถต่อยอดด้วย Capacitor ภายหลังได้

## 5. ความปลอดภัยก่อนเปิดให้คนทั่วไป
- ใช้เฉพาะ anon/public key ใน browser; ห้ามใส่ Supabase service_role key ใน frontend หรือ repository
- เก็บ service_role key เป็นความลับ ห้ามแชร์
- ทดสอบ RLS ด้วยบัญชีสมาชิก 2 บัญชีว่าอ่านคะแนน/ประวัติของกันและกันไม่ได้
- ตรวจสอบว่า RPC ปฏิเสธคำขอที่เรียกโดยผู้ไม่ได้เข้าสู่ระบบ และ RPC แอดมินปฏิเสธสมาชิกทั่วไป
- ตั้งค่าอีเมลยืนยันบัญชี, CAPTCHA/anti-abuse ถ้าเปิดรับสมัครสาธารณะ และสำรองข้อมูล
- กำหนดนโยบายความเป็นส่วนตัว เงื่อนไขคะแนน อายุข้อมูล และวิธีปิดบัญชี
- ก่อนเพิ่มระบบเงินจริง ให้ใช้ผู้ให้บริการชำระเงินที่เหมาะสมและตรวจสอบข้อกฎหมาย/ภาษี

## หมายเหตุทางเทคนิค
- ตัวนับบนหน้าจอเป็นการแสดงผลเท่านั้น คะแนนจริงถูกเพิ่มผ่าน `claim_mining_points()` ในฐานข้อมูล
- ฟังก์ชันล็อกแถวโปรไฟล์และบันทึก transaction เพื่อช่วยป้องกันการกดซ้ำพร้อมกัน
- MVP นี้เป็นจุดเริ่มต้นที่ควรผ่านการทดสอบความปลอดภัยและ QA ก่อนใช้กับข้อมูลจริงหรือเปิดรับเงิน
