"""Demo seed for NETWORK GMP. Resets demo collections. Run: cd /app/backend && python seed.py"""

import asyncio
import random
from datetime import date, datetime, timedelta, timezone

from lib.db import db, ensure_indexes
from lib.core import uid, now_iso, next_code, current_period
from lib.security import hash_password, encrypt_secret
from lib.settings import DEFAULTS
from services.billing import due_date_for

PASSWORD = "Gmp@2026!"
random.seed(42)
BASE = (-7.4055, 112.5880)  # Krian, Sidoarjo

FIRST = ["Budi", "Siti", "Agus", "Dewi", "Rudi", "Wahyu", "Rina", "Joko", "Sri", "Eko", "Fitri", "Hendra", "Yuli", "Bambang",
         "Nur", "Ahmad", "Lestari", "Dian", "Teguh", "Ratna", "Imam", "Wulan", "Arif", "Indah", "Slamet", "Ani", "Fajar", "Putri",
         "Hadi", "Maya", "Rizky", "Novi", "Doni", "Tika", "Yoga", "Sari"]
LAST = ["Santoso", "Rahayu", "Wibowo", "Lestari", "Hartono", "Setiawan", "Kurniawan", "Susanti", "Prasetyo", "Handayani", "Saputra", "Wijaya"]
VILLAGES = [("Krian", "Krian"), ("Terung Kulon", "Krian"), ("Bebekan", "Taman"), ("Sepanjang", "Taman"), ("Jati", "Sidoarjo"), ("Tropodo", "Krian")]
COLLS = ["users", "sessions", "packages", "customers", "invoices", "payments", "mikrotik_routers", "mikrotik_actions", "mikrotik_pending",
         "sim_ppp", "tickets", "psb", "whatsapp_messages", "audit_logs", "notifications", "map_assets", "counters", "jobs", "settings"]


def jitter(scale=0.03):
    return round(BASE[0] + random.uniform(-scale, scale), 6), round(BASE[1] + random.uniform(-scale, scale), 6)


def months_back(n):
    y, m = map(int, current_period().split("-"))
    out = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out[::-1]


async def main():
    for c in COLLS:
        await db[c].drop()
    await ensure_indexes()
    await db.settings.insert_one({"_id": "app", **DEFAULTS})

    users = [("superadmin@networkgmp.id", "Super Admin GMP", "super_admin", "6281200000001"),
             ("admin@networkgmp.id", "Admin Operasional", "admin", "6281200000002"),
             ("finance@networkgmp.id", "Finance GMP", "finance", "6281200000003"),
             ("cs@networkgmp.id", "Customer Service", "cs", "6281200000004"),
             ("supervisor@networkgmp.id", "Supervisor NOC", "supervisor", "6281200000005"),
             ("teknisi1@networkgmp.id", "Andi Teknisi", "teknisi", "6281311110001"),
             ("teknisi2@networkgmp.id", "Bayu Teknisi", "teknisi", "6281311110002"),
             ("teknisi3@networkgmp.id", "Candra Teknisi", "teknisi", "6281311110003")]
    pw = hash_password(PASSWORD)
    techs = []
    for email, name, role, phone in users:
        lat, lng = jitter(0.02) if role == "teknisi" else (None, None)
        doc = {"id": uid(), "email": email, "name": name, "role": role, "phone": phone, "active": True, "password_hash": pw,
               "latitude": lat, "longitude": lng, "created_at": now_iso()}
        await db.users.insert_one(doc)
        if role == "teknisi":
            techs.append(doc)

    pk_specs = [("GMP HOME 10 Mbps", 10, 150000), ("GMP HOME 20 Mbps", 20, 200000), ("GMP HOME 30 Mbps", 30, 250000),
                ("GMP HOME 50 Mbps", 50, 350000), ("GMP PRO 100 Mbps", 100, 600000)]
    packages = []
    for name, sp, price in pk_specs:
        prof = f"GMP-{'PRO' if sp == 100 else 'HOME'}-{sp}M"
        doc = {"id": uid(), "name": name, "speed": f"{sp} Mbps", "price": price, "upload": f"{max(sp // 2, 5)}M", "download": f"{sp}M",
               "fup": "Unlimited" if sp < 100 else "1 TB", "description": f"Internet fiber {sp} Mbps rumahan" if sp < 100 else "Paket bisnis/UMKM",
               "active": True, "mikrotik_profile": prof, "created_at": now_iso()}
        await db.packages.insert_one(doc)
        packages.append(doc)

    r_specs = [("GMP-KRIAN-01", "POP Krian Utama", "10.20.0.1", "RB4011", False, "wireguard"),
               ("GMP-KRIAN-02", "POP Krian Barat", "10.20.0.2", "RB450Gx4", False, "wireguard"),
               ("GMP-TAMAN-01", "POP Taman", "10.20.1.1", "CCR1009", False, "wireguard"),
               ("GMP-SEPANJANG-01", "POP Sepanjang", "10.20.2.1", "CCR2004", False, "private"),
               ("GMP-SIDOARJO-01", "POP Sidoarjo Kota", "10.20.3.1", "RB750Gr3", True, "wireguard")]
    routers = []
    for name, loc, host, board, offline, vpn in r_specs:
        lat, lng = jitter(0.035)
        doc = {"id": uid(), "router_code": await next_code("RTR"), "name": name, "location": loc, "host": host, "api_port": 8728,
               "username": "gmp-api", "password_enc": encrypt_secret("gmp-api-Secr3t"),
               "routeros_version": "7.14.3", "mode": "simulator", "vpn": vpn, "board": board,
               "sim_offline": offline, "status": "offline" if offline else "online", "identity": name,
               "last_connected": None if offline else now_iso(), "last_sync": None if offline else now_iso(),
               "last_error": "MIKROTIK_TIMEOUT: Router tidak merespons dalam batas waktu (timeout)." if offline else "",
               "last_test_ok": not offline, "response_ms": 0 if offline else random.randint(12, 45),
               "cpu": 0 if offline else random.randint(4, 30), "memory_used_pct": 0 if offline else random.randint(30, 60),
               "uptime": "" if offline else f"{random.randint(5, 60)}d{random.randint(0, 23):02d}h11m02s",
               "latitude": lat, "longitude": lng, "created_at": now_iso()}
        await db.mikrotik_routers.insert_one(doc)
        routers.append(doc)

    months = months_back(6)
    customers = []
    for i in range(36):
        name = f"{FIRST[i]} {random.choice(LAST)}"
        pkg = random.choices(packages, weights=[5, 8, 6, 3, 1])[0]
        rtr = routers[4] if i >= 32 else routers[i % 4]
        status = "active"
        if i in (3, 11, 19):
            status = "isolir"
        elif i == 7:
            status = "suspend"
        elif i in (25, 29):
            status = "stopped"
        inst_month = months[min(i // 6, 5)] if i < 30 else months[random.randint(0, 5)]
        install = f"{inst_month}-{random.randint(1, 26):02d}"
        v, d = random.choice(VILLAGES)
        lat, lng = jitter()
        tech = techs[i % 3]
        uname = f"{FIRST[i].lower()}{i + 1:03d}"
        online = status == "active" and rtr is not routers[4] and random.random() < 0.85
        c = {"id": uid(), "customer_code": await next_code("CUS"), "name": name, "whatsapp": f"62812{random.randint(10000000, 99999999)}",
             "alt_phone": "", "address": f"Jl. {random.choice(['Raya', 'Mawar', 'Melati', 'Kenanga', 'Pahlawan', 'Diponegoro'])} No. {random.randint(1, 120)}",
             "rt": f"{random.randint(1, 9):02d}", "rw": f"{random.randint(1, 6):02d}", "village": v, "district": d, "city": "Sidoarjo",
             "province": "Jawa Timur", "latitude": lat, "longitude": lng, "package_id": pkg["id"], "package_name": pkg["name"],
             "package_price": pkg["price"], "install_date": install, "due_day": 10, "status": status, "technician_id": tech["id"],
             "technician_name": tech["name"], "notes": "", "router_id": rtr["id"], "router_name": rtr["name"], "pppoe_username": uname,
             "pppoe_password_enc": encrypt_secret(f"pw{uname}"), "pppoe_profile": pkg["mikrotik_profile"], "service": "pppoe",
             "comment": f"{name}", "mikrotik_id": f"*{i + 16:X}", "ip_address": f"10.100.{i // 250}.{i % 250 + 2}" if online else "",
             "mac_address": ":".join(f"{random.randint(0, 255):02X}" for _ in range(6)) if online else "",
             "connection_status": "online" if online else ("unknown" if rtr is routers[4] else "offline"),
             "last_online": now_iso() if online else None, "last_offline": None if online else now_iso(),
             "uptime": f"{random.randint(0, 9)}d{random.randint(0, 23):02d}h{random.randint(0, 59):02d}m" if online else "",
             "interface": f"<pppoe-{uname}>" if online else "", "rx_bytes": 0, "tx_bytes": 0,
             "mikrotik_disabled": status == "isolir", "integration_status": "OK", "integration_error": "",
             "created_at": f"{install}T02:00:00+00:00", "stopped_at": now_iso() if status == "stopped" else None}
        await db.customers.insert_one(c)
        customers.append(c)
        if i not in (30, 31):  # two secrets missing on router → SYNC will create them
            await db.sim_ppp.insert_one({"router_id": rtr["id"], "id": c["mikrotik_id"], "name": uname, "password": f"pw{uname}",
                                         "profile": pkg["mikrotik_profile"], "service": "pppoe", "comment": name,
                                         "disabled": status in ("isolir", "stopped"), "active": online, "address": c["ip_address"],
                                         "caller-id": c["mac_address"], "interface": "", "login_at": (datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 200))).isoformat() if online else None})
    # an orphan secret on router (not in billing) → SYNC "skipped"
    await db.sim_ppp.insert_one({"router_id": routers[0]["id"], "id": "*FFF", "name": "test-noc", "password": "x", "profile": "default",
                                 "service": "pppoe", "comment": "akun uji NOC", "disabled": False, "active": False, "address": "", "caller-id": ""})

    cur = months[-1]
    for c in customers:
        for m in months:
            if c["install_date"][:7] > m or (c["status"] == "stopped" and m == cur):
                continue
            is_last_two = m in months[-2:]
            if c["status"] == "isolir" and is_last_two:
                status = "overdue"
            elif m == cur:
                status = random.choice(["unpaid", "unpaid", "paid"])
            elif c["customer_code"] in ("GMP-000006", "GMP-000014") and m == months[-2]:
                status = "overdue"
            else:
                status = "paid"
            amount = c["package_price"]
            penalty = 0
            inv = {"id": uid(), "invoice_no": await next_code("INV", m), "customer_id": c["id"], "customer_name": c["name"],
                   "customer_code": c["customer_code"], "whatsapp": c["whatsapp"], "package_name": c["package_name"], "period": m,
                   "amount": amount, "discount": 0, "penalty": penalty, "total": amount + penalty, "due_date": due_date_for(m, 10),
                   "status": status, "paid_at": None, "created_at": f"{m}-01T01:00:00+00:00"}
            if status == "paid":
                day = random.randint(1, 12)
                if m == cur:
                    day = min(day, int(date.today().strftime("%d")))
                paid_at = f"{m}-{day:02d}T0{random.randint(1, 9)}:15:00+00:00"
                inv["paid_at"] = paid_at
                method = random.choice(["cash", "transfer", "transfer", "ewallet"])
                await db.payments.insert_one({"id": uid(), "payment_no": await next_code("PAY", m), "invoice_id": inv["id"],
                                              "invoice_no": inv["invoice_no"], "customer_id": c["id"], "customer_name": c["name"],
                                              "customer_code": c["customer_code"], "whatsapp": c["whatsapp"], "period": m, "amount": amount,
                                              "method": method, "reference": f"TRX{random.randint(100000, 999999)}" if method != "cash" else "",
                                              "proof_url": "", "note": "", "status": "confirmed", "received_by": "finance@networkgmp.id", "paid_at": paid_at})
            await db.invoices.insert_one(inv)

    complaints = [("Internet mati total sejak pagi, lampu LOS merah", "critical"), ("Koneksi lambat saat malam hari", "medium"),
                  ("Sering putus-sambung", "high"), ("Minta pindah posisi router", "low"), ("Redaman tinggi, wifi tidak stabil", "high")]
    statuses = ["assigned", "in_progress", "open", "resolved", "assigned"]
    for k, (txt, prio) in enumerate(complaints):
        c = customers[k * 5 + 1]
        tech = techs[k % 3] if statuses[k] != "open" else None
        await db.tickets.insert_one({"id": uid(), "ticket_no": await next_code("TKT"), "customer_id": c["id"], "customer_name": c["name"],
                                     "whatsapp": c["whatsapp"], "address": c["address"], "latitude": c["latitude"], "longitude": c["longitude"],
                                     "complaint": txt, "priority": prio, "technician_id": tech["id"] if tech else "",
                                     "technician_name": tech["name"] if tech else "", "status": statuses[k], "photos": [], "notes": "",
                                     "reported_at": (datetime.now(timezone.utc) - timedelta(hours=k * 7 + 2)).isoformat(),
                                     "resolved_at": now_iso() if statuses[k] == "resolved" else None})

    psb_names = [("Gilang Ramadhan", "scheduled"), ("Melati Kusuma", "new"), ("Taufik Hidayat", "installing"), ("Laras Ayu", "done")]
    for k, (nm, st) in enumerate(psb_names):
        lat, lng = jitter()
        tech = techs[k % 3] if st != "new" else None
        await db.psb.insert_one({"id": uid(), "psb_no": await next_code("PSB"), "name": nm, "whatsapp": f"62857{random.randint(10000000, 99999999)}",
                                 "address": f"Perum Griya Krian Blok {chr(65 + k)}-{k + 3}", "rt": "03", "rw": "02", "latitude": lat, "longitude": lng,
                                 "package_id": packages[1]["id"], "package_name": packages[1]["name"], "technician_id": tech["id"] if tech else "",
                                 "technician_name": tech["name"] if tech else "", "schedule": (date.today() + timedelta(days=k)).isoformat(),
                                 "status": st, "notes": "", "photos": [], "customer_id": "", "created_at": now_iso()})

    for j in range(2):
        lat, lng = jitter(0.02)
        odc = {"id": uid(), "type": "odc", "name": f"ODC-GMP-0{j + 1}", "latitude": lat, "longitude": lng, "capacity": 144, "used": random.randint(40, 90), "parent_id": ""}
        await db.map_assets.insert_one(odc)
        for k in range(4):
            la, ln = round(lat + random.uniform(-0.012, 0.012), 6), round(lng + random.uniform(-0.012, 0.012), 6)
            await db.map_assets.insert_one({"id": uid(), "type": "odp", "name": f"ODP-GMP-{j * 4 + k + 1:02d}", "latitude": la, "longitude": ln,
                                            "capacity": 16, "used": random.randint(4, 16), "parent_id": odc["id"]})

    for r in routers[:4]:
        await db.mikrotik_actions.insert_one({"id": uid(), "created_at": now_iso(), "actor": "admin@networkgmp.id", "router_id": r["id"],
                                              "router_name": r["name"], "action": "TEST_CONNECTION", "username": "", "customer_id": "",
                                              "customer_name": "", "reason": "", "result": "SUCCESS", "error_code": "", "message": f"{r['name']} RouterOS 7.14.3"})
    print(f"Seed OK: {len(customers)} pelanggan, {len(routers)} router. Login: superadmin@networkgmp.id / {PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main())
