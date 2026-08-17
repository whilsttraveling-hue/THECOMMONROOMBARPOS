import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Beer, LogOut, Plus, Minus, X, Receipt, TrendingUp, Package, IndianRupee, Clock, ChevronRight, Check, AlertTriangle, BarChart3, Users, Settings, Trash2, Edit3, Wifi, WifiOff, Lock, ShoppingCart, Shield, Eye, EyeOff } from "lucide-react";
import { cloudGet, cloudSet, signIn, signOut, getSession, supabase } from "./storage.js";

// ---------- Seed data (used only the very first time cloud storage is empty) ----------
// Note: staff accounts now live in Supabase Auth + the staff_profiles table.
// Create each person in Supabase → Authentication → Users (email + password),
// then add a matching row in staff_profiles with their name and role.

const DEFAULT_CATEGORIES = ["Beer", "Snacks"];

const DEFAULT_MENU = [
  { id: "m1", name: "Peoples", category: "Beer", price: 150, stock: 42, unit: "bottle" },
  { id: "m2", name: "Maka", category: "Beer", price: 160, stock: 24, unit: "bottle" },
  { id: "m3", name: "Kingfisher Strong", category: "Beer", price: 140, stock: 30, unit: "bottle" },
  { id: "m4", name: "Salted Peanuts", category: "Snacks", price: 90, stock: 15, unit: "plate" },
];

const ROOMS = ["Dorm 3 - Bed 4", "Dorm 3 - Bed 7", "Pvt Room 2", "Dorm 1 - Bed 1", "Pvt Room 5"];

// ---------- Cloud storage tables (one row per table — one bar, any device) ----------
const TABLE_MENU = "menu";
const TABLE_TABS = "tabs";
const TABLE_HISTORY = "history";
const TABLE_SETTINGS = "settings";
const TABLE_PURCHASES = "purchases"; // real Supabase table, not the singleton-row pattern
const SYNC_INTERVAL_MS = 4000;

// ---------- Helpers ----------
const inr = (n) => `₹${(n || 0).toLocaleString("en-IN")}`;
const now = () => new Date();
const fmtDate = (d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const uid = () => Math.random().toString(36).slice(2, 9);

// Builds a standard UPI deep-link. Any UPI app (GPay/PhonePe/Paytm/BHIM)
// recognizes this URI scheme and opens pre-filled with payee + amount.
// We render it as a QR code via a public QR image API — no backend needed.
function buildUpiLink({ upiId, payeeName, amount, note }) {
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName || "Common Room Bar",
    am: amount.toFixed(2),
    cu: "INR",
    tn: note || "Bar tab",
  });
  return `upi://pay?${params.toString()}`;
}
function qrImageUrl(data, size = 220) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`;
}

// Purchases is a real multi-row table (not the singleton-JSON-blob pattern
// used elsewhere) since each purchase order is its own record.
async function fetchPurchases() {
  const { data, error } = await supabase.from(TABLE_PURCHASES).select("*").order("purchase_date", { ascending: false });
  if (error) { console.error("[fetchPurchases]", error.message); return []; }
  return data || [];
}
async function insertPurchase(purchase) {
  const { error } = await supabase.from(TABLE_PURCHASES).insert(purchase);
  if (error) console.error("[insertPurchase]", error.message);
  return !error;
}
async function deletePurchase(id) {
  const { error } = await supabase.from(TABLE_PURCHASES).delete().eq("id", id);
  if (error) console.error("[deletePurchase]", error.message);
  return !error;
}

// ---------- Root ----------
export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null); // { user, profile: { name, role } }
  const [shift, setShift] = useState(null);
  const [menu, setMenu] = useState(DEFAULT_MENU);
  const [tabs, setTabs] = useState([]);
  const [history, setHistory] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [settings, setSettings] = useState({ upiId: "", payeeName: "Common Room Bar" });
  const [view, setView] = useState("floor");
  const [activeTabId, setActiveTabId] = useState(null);
  const [toast, setToast] = useState(null);
  const [syncState, setSyncState] = useState("ok"); // ok | syncing | error
  const lastSyncRef = useRef(0);

  const showToast = useCallback((msg, kind = "ok") => setToast({ msg, kind, key: uid() }), []);
  const isManager = session?.profile?.role === "manager";

  // ---- check for an existing logged-in session on load ----
  useEffect(() => {
    (async () => {
      const s = await getSession();
      if (s) setSession(s);
    })();
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === "SIGNED_OUT") setSession(null);
    });
    return () => authListener?.subscription?.unsubscribe();
  }, []);

  // ---- initial data load ----
  useEffect(() => {
    (async () => {
      const [m, t, h, s, p] = await Promise.all([
        cloudGet(TABLE_MENU, null),
        cloudGet(TABLE_TABS, []),
        cloudGet(TABLE_HISTORY, []),
        cloudGet(TABLE_SETTINGS, { upiId: "", payeeName: "Common Room Bar" }),
        fetchPurchases(),
      ]);
      if (m === null) {
        // first ever run — seed the cloud store
        await cloudSet(TABLE_MENU, DEFAULT_MENU);
        setMenu(DEFAULT_MENU);
      } else {
        setMenu(m);
      }
      setTabs(t);
      setHistory(h);
      setSettings(s);
      setPurchases(p);
      setBooting(false);
    })();
  }, []);

  // ---- background sync poll (so other devices' changes show up here) ----
  useEffect(() => {
    if (booting) return;
    const poll = async () => {
      setSyncState("syncing");
      try {
        const [m, t, h, s, p] = await Promise.all([
          cloudGet(TABLE_MENU, menu),
          cloudGet(TABLE_TABS, tabs),
          cloudGet(TABLE_HISTORY, history),
          cloudGet(TABLE_SETTINGS, settings),
          fetchPurchases(),
        ]);
        setMenu(m);
        setTabs(t);
        setHistory(h);
        setSettings(s);
        setPurchases(p);
        setSyncState("ok");
        lastSyncRef.current = Date.now();
      } catch {
        setSyncState("error");
      }
    };
    const t = setInterval(poll, SYNC_INTERVAL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booting]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- writers: update local state immediately + push to cloud ----
  const pushMenu = useCallback(async (updater) => {
    setMenu((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      cloudSet(TABLE_MENU, next);
      return next;
    });
  }, []);
  const pushTabs = useCallback(async (updater) => {
    setTabs((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      cloudSet(TABLE_TABS, next);
      return next;
    });
  }, []);
  const pushHistory = useCallback(async (updater) => {
    setHistory((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      cloudSet(TABLE_HISTORY, next);
      return next;
    });
  }, []);
  const pushSettings = useCallback(async (updater) => {
    setSettings((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      cloudSet(TABLE_SETTINGS, next);
      return next;
    });
  }, []);
  const refreshPurchases = useCallback(async () => {
    setPurchases(await fetchPurchases());
  }, []);

  const handleLogin = async (email, password) => {
    const result = await signIn(email, password);
    if (result.error) return { error: result.error };
    setSession({ user: result.user, profile: result.profile });
    setShift({ staffName: result.profile.name, role: result.profile.role, startedAt: now() });
    showToast(`Shift started — welcome, ${result.profile.name}`);
    return { ok: true };
  };
  const endShift = async () => {
    await signOut();
    setSession(null);
    setShift(null);
    setActiveTabId(null);
    setView("floor");
  };

  if (booting) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
        <GoogleFonts />
        <Beer size={30} color={C.brass} style={{ animation: "pulse 1.4s ease-in-out infinite" }} />
        <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:1} }`}</style>
        <div style={{ color: C.textDim, fontSize: 13, fontFamily: "Inter, sans-serif" }}>Loading bar data…</div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} openTabCount={tabs.length} />;
  }

  return (
    <div style={styles.app}>
      <GoogleFonts />
      {toast && <Toast toast={toast} />}
      <TopBar shift={shift} view={view} setView={setView} onEndShift={endShift} openTabs={tabs.length} syncState={syncState} isManager={isManager} />
      <div style={styles.body}>
        {view === "floor" && (
          <FloorView
            menu={menu}
            pushMenu={pushMenu}
            tabs={tabs}
            pushTabs={pushTabs}
            history={history}
            pushHistory={pushHistory}
            activeTabId={activeTabId}
            setActiveTabId={setActiveTabId}
            shift={shift}
            showToast={showToast}
            settings={settings}
          />
        )}
        {view === "reports" && <ReportsView history={history} menu={menu} purchases={purchases} />}
        {view === "order-history" && (
          <OrderHistoryView history={history} pushHistory={pushHistory} menu={menu} pushMenu={pushMenu} isManager={isManager} showToast={showToast} />
        )}
        {view === "purchases" && (
          <PurchasesView menu={menu} purchases={purchases} refreshPurchases={refreshPurchases} shift={shift} showToast={showToast} />
        )}
        {view === "menu-admin" && <MenuAdmin menu={menu} pushMenu={pushMenu} showToast={showToast} settings={settings} pushSettings={pushSettings} isManager={isManager} />}
      </div>
    </div>
  );
}

// ---------- Fonts ----------
function GoogleFonts() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap');
      * { box-sizing: border-box; }
      body { margin: 0; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: #2E4643; border-radius: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      button { font-family: inherit; cursor: pointer; }
      button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #C89B3C; outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
    `}</style>
  );
}

// ---------- Theme ----------
const C = {
  bg: "#0E1A18",
  panel: "#152624",
  panel2: "#1B2E2B",
  border: "#2A403C",
  text: "#F2EFE9",
  textDim: "#9FB3AE",
  brass: "#C89B3C",
  brassDim: "#8A6E2E",
  amber: "#D68A2E",
  red: "#C4453D",
  green: "#4F9E6E",
};
const styles = {
  app: { minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "Inter, sans-serif", display: "flex", flexDirection: "column" },
  body: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
};
const displayFont = { fontFamily: "Oswald, sans-serif" };

// ---------- Toast ----------
function Toast({ toast }) {
  return (
    <div key={toast.key} style={{
      position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 100,
      background: toast.kind === "error" ? C.red : C.panel2,
      border: `1px solid ${toast.kind === "error" ? "#8a2f2a" : C.brass}`,
      color: C.text, padding: "10px 18px", borderRadius: 8, fontSize: 14, fontWeight: 600,
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", gap: 8, maxWidth: "90vw",
      animation: "slideDown 0.25s ease-out",
    }}>
      <style>{`@keyframes slideDown { from { opacity:0; transform: translate(-50%,-10px);} to {opacity:1; transform: translate(-50%,0);} }`}</style>
      {toast.kind === "error" ? <AlertTriangle size={16} /> : <Check size={16} />}
      {toast.msg}
    </div>
  );
}

// ---------- Login ----------
function LoginScreen({ onLogin, openTabCount }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError("");
    const result = await onLogin(email.trim(), password);
    if (result?.error) {
      setError(result.error === "Invalid login credentials" ? "Wrong email or password" : result.error);
      setSubmitting(false);
    }
    // on success, the parent re-renders past this screen — no need to reset state
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", padding: 20, fontFamily: "Inter, sans-serif" }}>
      <GoogleFonts />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Beer size={32} color={C.brass} />
        <div style={{ ...displayFont, fontSize: 38, letterSpacing: 1, color: C.text }}>COMMON ROOM BAR</div>
      </div>
      <div style={{ color: C.textDim, fontSize: 14, marginBottom: 8, letterSpacing: 2, textTransform: "uppercase" }}>Reception Desk Point of Sale</div>
      <div style={{ color: C.textDim, fontSize: 12, marginBottom: 32, display: "flex", alignItems: "center", gap: 5 }}>
        <Wifi size={12} /> synced across all desk devices
      </div>

      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 340 }}>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>Email</div>
        <input
          type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@commonroombar.com" style={{ ...inputStyle, marginBottom: 12 }} disabled={submitting}
        />
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>Password</div>
        <div style={{ position: "relative", marginBottom: 6 }}>
          <input
            type={showPw ? "text" : "password"} autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
            style={{ ...inputStyle, marginBottom: 0, paddingRight: 40 }} disabled={submitting}
          />
          <button type="button" onClick={() => setShowPw((v) => !v)} style={{
            position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.textDim,
          }}>
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {error && <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{error}</div>}
        <button type="submit" disabled={submitting || !email.trim() || !password} style={{
          ...primaryBtn, marginTop: 10, opacity: submitting || !email.trim() || !password ? 0.6 : 1,
        }}>
          {submitting ? "Signing in…" : "Start shift"}
        </button>
      </form>

      {openTabCount > 0 && (
        <div style={{ marginTop: 24, textAlign: "center", color: C.amber, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Receipt size={14} /> {openTabCount} tab{openTabCount > 1 ? "s" : ""} currently open on the floor
        </div>
      )}
      <div style={{ marginTop: 20, fontSize: 11, color: C.textDim, textAlign: "center", maxWidth: 320 }}>
        Don't have an account? Ask a manager to add you in Supabase → Authentication.
      </div>
    </div>
  );
}

// ---------- Top bar ----------
function TopBar({ shift, view, setView, onEndShift, openTabs, syncState, isManager }) {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    const tick = () => {
      const ms = now() - shift.startedAt;
      const mins = Math.floor(ms / 60000);
      const h = Math.floor(mins / 60), m = mins % 60;
      setElapsed(`${h}h ${m}m`);
    };
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [shift]);

  const NavBtn = ({ id, icon: Icon, label }) => (
    <button onClick={() => setView(id)} style={{
      background: view === id ? C.panel2 : "transparent",
      border: "none", borderRadius: 8, padding: "8px 14px", color: view === id ? C.brass : C.textDim,
      display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap",
    }}>
      <Icon size={16} /> {label}
    </button>
  );

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px",
      background: C.panel, borderBottom: `1px solid ${C.border}`, flexWrap: "wrap", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, ...displayFont, fontSize: 20, letterSpacing: 0.5 }}>
          <Beer size={20} color={C.brass} /> COMMON ROOM
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <NavBtn id="floor" icon={Receipt} label={`Floor${openTabs ? ` (${openTabs})` : ""}`} />
          <NavBtn id="order-history" icon={Clock} label="Order History" />
          <NavBtn id="purchases" icon={ShoppingCart} label="Purchases" />
          <NavBtn id="reports" icon={BarChart3} label="Reports" />
          <NavBtn id="menu-admin" icon={Settings} label="Menu" />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div title={syncState === "error" ? "Sync failed — check connection" : "Synced"} style={{ color: syncState === "error" ? C.red : C.textDim, display: "flex", alignItems: "center" }}>
          {syncState === "error" ? <WifiOff size={14} /> : <Wifi size={14} />}
        </div>
        <div style={{ textAlign: "right", fontSize: 12, color: C.textDim }}>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
            {shift.staffName}
            {isManager && (
              <span title="Manager access" style={{ background: C.brassDim, color: C.text, fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, display: "flex", alignItems: "center", gap: 3, textTransform: "uppercase" }}>
                <Shield size={9} /> Manager
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
            <Clock size={11} /> on shift {elapsed}
          </div>
        </div>
        <button onClick={onEndShift} style={{
          background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px",
          color: C.textDim, display: "flex", alignItems: "center", gap: 6, fontSize: 13,
        }}>
          <LogOut size={14} /> End shift
        </button>
      </div>
    </div>
  );
}

// ---------- Floor view ----------
function FloorView({ menu, pushMenu, tabs, pushTabs, history, pushHistory, activeTabId, setActiveTabId, shift, showToast, settings }) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [category, setCategory] = useState(menu[0]?.category || "Beer");
  const [showNewTab, setShowNewTab] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  useEffect(() => {
    if (activeTabId && !tabs.find((t) => t.id === activeTabId)) setActiveTabId(null);
  }, [tabs, activeTabId, setActiveTabId]);

  const categories = [...new Set(menu.map((m) => m.category))];

  const createTab = (label) => {
    const t = { id: uid(), label: label || `Walk-in ${tabs.length + 1}`, openedBy: shift.staffName, openedAt: now().toISOString(), items: [] };
    pushTabs((prev) => [...prev, t]);
    setActiveTabId(t.id);
    setShowNewTab(false);
  };

  const addItem = (menuItem) => {
    if (!activeTab) { showToast("Open or select a tab first", "error"); return; }
    const stockRemaining = menuItem.stock - reservedQty(tabs, menuItem.id);
    if (stockRemaining <= 0) { showToast(`${menuItem.name} is out of stock`, "error"); return; }
    pushTabs((prev) => prev.map((t) => {
      if (t.id !== activeTab.id) return t;
      const existing = t.items.find((li) => li.menuId === menuItem.id);
      if (existing) return { ...t, items: t.items.map((li) => li.menuId === menuItem.id ? { ...li, qty: li.qty + 1 } : li) };
      return { ...t, items: [...t.items, { id: uid(), menuId: menuItem.id, name: menuItem.name, price: menuItem.price, qty: 1 }] };
    }));
  };

  const changeQty = (menuId, delta) => {
    pushTabs((prev) => prev.map((t) => {
      if (t.id !== activeTab.id) return t;
      const items = t.items.map((li) => li.menuId === menuId ? { ...li, qty: li.qty + delta } : li).filter((li) => li.qty > 0);
      return { ...t, items };
    }));
  };

  const removeTab = (tabId) => {
    pushTabs((prev) => prev.filter((t) => t.id !== tabId));
    if (activeTabId === tabId) setActiveTabId(null);
  };

  const closeTab = (payMethod) => {
    if (!activeTab) return;
    const cost = activeTab.items.reduce((s, li) => {
      const m = menu.find((mm) => mm.id === li.menuId);
      return s + (m ? Math.round(m.price * 0.55) : 0) * li.qty;
    }, 0);
    const total = activeTab.items.reduce((s, li) => s + li.price * li.qty, 0);
    const closed = {
      id: activeTab.id,
      closedAt: now().toISOString(),
      staff: shift.staffName,
      openedBy: activeTab.openedBy,
      payMethod,
      items: activeTab.items.map((li) => ({ ...li, cost: menu.find((m) => m.id === li.menuId) ? Math.round(menu.find((m) => m.id === li.menuId).price * 0.55) : 0 })),
      total,
      cost,
    };
    pushHistory((prev) => [closed, ...prev]);
    pushMenu((prev) => prev.map((m) => {
      const soldQty = activeTab.items.filter((li) => li.menuId === m.id).reduce((s, li) => s + li.qty, 0);
      return soldQty ? { ...m, stock: m.stock - soldQty } : m;
    }));
    pushTabs((prev) => prev.filter((t) => t.id !== activeTab.id));
    setActiveTabId(null);
    setShowPayment(false);
    showToast(`Tab closed by ${shift.staffName} — ${inr(total)} via ${payMethod}`);
  };

  const filteredMenu = menu.filter((m) => m.category === category);

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, flexWrap: "wrap" }}>
      <div style={{ width: 220, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", background: C.panel }}>
        <div style={{ padding: "14px 14px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 12, color: C.textDim, textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>Open Tabs</div>
          <button onClick={() => setShowNewTab(true)} style={{ background: C.brass, border: "none", borderRadius: 6, width: 26, height: 26, color: "#1a1408", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Plus size={16} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 10px 10px" }}>
          {tabs.length === 0 && <div style={{ color: C.textDim, fontSize: 13, padding: "20px 10px", textAlign: "center" }}>No tabs open.<br />Tap + to start one.</div>}
          {tabs.map((t) => {
            const total = t.items.reduce((s, li) => s + li.price * li.qty, 0);
            const isActive = t.id === activeTabId;
            return (
              <div key={t.id} onClick={() => setActiveTabId(t.id)} style={{
                background: isActive ? C.panel2 : "transparent", border: `1px solid ${isActive ? C.brass : "transparent"}`,
                borderRadius: 8, padding: "10px 12px", marginBottom: 8, cursor: "pointer",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{t.label}</div>
                  <button onClick={(e) => { e.stopPropagation(); removeTab(t.id); }} style={{ background: "none", border: "none", color: C.textDim, padding: 0 }}>
                    <X size={13} />
                  </button>
                </div>
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>opened by {t.openedBy}</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: C.textDim }}>{t.items.length} item{t.items.length !== 1 ? "s" : ""}</span>
                  <span style={{ ...displayFont, fontSize: 15, color: C.amber }}>{inr(total)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 280 }}>
        <div style={{ display: "flex", gap: 6, padding: "14px 20px 0", flexWrap: "wrap" }}>
          {categories.map((c) => (
            <button key={c} onClick={() => setCategory(c)} style={{
              background: category === c ? C.brass : C.panel, color: category === c ? "#1a1408" : C.text,
              border: `1px solid ${category === c ? C.brass : C.border}`, borderRadius: 8, padding: "8px 18px", fontWeight: 700, fontSize: 14,
            }}>
              {c}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14, alignContent: "start" }}>
          {filteredMenu.map((m) => {
            const remaining = m.stock - reservedQty(tabs, m.id);
            const low = remaining <= 8 && remaining > 0;
            const out = remaining <= 0;
            return (
              <button key={m.id} onClick={() => addItem(m)} disabled={out || !activeTab} style={{
                background: C.panel, border: `1px solid ${out ? "#4a2622" : C.border}`, borderRadius: 12, padding: "16px 14px",
                textAlign: "left", opacity: out ? 0.5 : (!activeTab ? 0.7 : 1), position: "relative",
              }}>
                {low && !out && <span style={{ position: "absolute", top: 10, right: 10, background: C.amber, color: "#1a1408", fontSize: 10, fontWeight: 800, padding: "2px 6px", borderRadius: 4 }}>LOW: {remaining}</span>}
                {out && <span style={{ position: "absolute", top: 10, right: 10, background: C.red, color: "#fff", fontSize: 10, fontWeight: 800, padding: "2px 6px", borderRadius: 4 }}>OUT</span>}
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{m.name}</div>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>{m.category} · {remaining} {m.unit}s left</div>
                <div style={{ ...displayFont, fontSize: 20, color: C.brass }}>{inr(m.price)}</div>
              </button>
            );
          })}
          {filteredMenu.length === 0 && <div style={{ color: C.textDim, fontSize: 13 }}>No items in this category yet — add some under Menu.</div>}
        </div>
        {!activeTab && <div style={{ padding: "10px 20px", color: C.textDim, fontSize: 13, textAlign: "center", borderTop: `1px solid ${C.border}` }}>Select or open a tab on the left to start adding items.</div>}
      </div>

      <div style={{ width: 300, borderLeft: `1px solid ${C.border}`, background: C.panel, display: "flex", flexDirection: "column" }}>
        {activeTab ? (
          <TicketStub tab={activeTab} onChangeQty={changeQty} onPay={() => setShowPayment(true)} />
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.textDim, fontSize: 13, padding: 20, textAlign: "center" }}>No tab selected</div>
        )}
      </div>

      {showNewTab && <NewTabModal rooms={ROOMS} onCreate={createTab} onClose={() => setShowNewTab(false)} tabCount={tabs.length} />}
      {showPayment && activeTab && <PaymentModal tab={activeTab} onClose={() => setShowPayment(false)} onComplete={closeTab} staffName={shift.staffName} settings={settings} />}
    </div>
  );
}

function reservedQty(tabs, menuId) {
  return tabs.reduce((sum, t) => sum + t.items.filter((li) => li.menuId === menuId).reduce((s, li) => s + li.qty, 0), 0);
}

// ---------- Ticket stub ----------
function TicketStub({ tab, onChangeQty, onPay }) {
  const total = tab.items.reduce((s, li) => s + li.price * li.qty, 0);
  const mins = Math.floor((now() - new Date(tab.openedAt)) / 60000);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "16px 18px 12px", borderBottom: `1px dashed ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ ...displayFont, fontSize: 20 }}>{tab.label}</div>
          <div style={{ fontSize: 11, color: C.textDim }}>{mins}m open</div>
        </div>
        <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, background: C.panel2, border: `1px solid ${C.brassDim}`, borderRadius: 20, padding: "3px 10px 3px 3px", fontSize: 12 }}>
          <span style={{ width: 20, height: 20, borderRadius: "50%", background: C.brass, color: "#1a1408", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11 }}>{tab.openedBy[0]}</span>
          opened by <strong>{tab.openedBy}</strong>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 18px" }}>
        {tab.items.length === 0 && <div style={{ color: C.textDim, fontSize: 13, textAlign: "center", padding: "30px 0" }}>No items yet. Tap the menu to add.</div>}
        {tab.items.map((li) => (
          <div key={li.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{li.name}</div>
              <div style={{ fontSize: 11, color: C.textDim }}>{inr(li.price)} × {li.qty}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => onChangeQty(li.menuId, -1)} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6, width: 26, height: 26, color: C.text, display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={12} /></button>
              <span style={{ width: 18, textAlign: "center", fontWeight: 700, fontSize: 13 }}>{li.qty}</span>
              <button onClick={() => onChangeQty(li.menuId, 1)} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6, width: 26, height: 26, color: C.text, display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={12} /></button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: "14px 18px 18px", borderTop: `1px dashed ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ color: C.textDim, fontSize: 13 }}>Total</span>
          <span style={{ ...displayFont, fontSize: 26, color: C.brass }}>{inr(total)}</span>
        </div>
        <button onClick={onPay} disabled={tab.items.length === 0} style={{
          width: "100%", background: tab.items.length ? C.brass : C.border, border: "none", borderRadius: 10, padding: "14px 0",
          color: tab.items.length ? "#1a1408" : C.textDim, fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <IndianRupee size={16} /> Settle & close tab
        </button>
      </div>
    </div>
  );
}

// ---------- New tab modal ----------
function NewTabModal({ rooms, onCreate, onClose, tabCount }) {
  const [mode, setMode] = useState("walkin");
  const [room, setRoom] = useState(rooms[0]);
  const [customName, setCustomName] = useState("");
  return (
    <ModalShell onClose={onClose} title="Open new tab">
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <SegBtn active={mode === "walkin"} onClick={() => setMode("walkin")} label="Walk-in" />
        <SegBtn active={mode === "room"} onClick={() => setMode("room")} label="Room tab" />
      </div>
      {mode === "walkin" ? (
        <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder={`Walk-in ${tabCount + 1}`} style={inputStyle} />
      ) : (
        <select value={room} onChange={(e) => setRoom(e.target.value)} style={inputStyle}>
          {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      )}
      <button onClick={() => onCreate(mode === "walkin" ? (customName || `Walk-in ${tabCount + 1}`) : room)} style={primaryBtn}>Open tab</button>
    </ModalShell>
  );
}

// ---------- Payment modal ----------
function PaymentModal({ tab, onClose, onComplete, staffName, settings }) {
  const total = tab.items.reduce((s, li) => s + li.price * li.qty, 0);
  const [method, setMethod] = useState(null);
  const [showQr, setShowQr] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);

  const upiConfigured = !!settings?.upiId;

  const methods = [
    { id: "Cash", label: "Cash", icon: IndianRupee, note: "Counted at desk", live: true },
    { id: "UPI", label: "UPI", icon: Receipt, note: upiConfigured ? "Scan to pay" : "Set UPI ID in Menu → Settings", live: upiConfigured },
    { id: "Card", label: "Card", icon: Lock, note: "Coming soon — Razorpay", live: false },
    { id: "Room Tab", label: "Room Tab", icon: Users, note: "Add to guest folio", live: true },
  ];

  const handleSelect = (m) => {
    if (!m.live) return;
    if (m.id === "UPI") {
      setMethod("UPI");
      setShowQr(true);
      return;
    }
    setMethod(m.id);
    setProcessing(true);
    setTimeout(() => { setProcessing(false); setDone(true); }, 500);
  };

  const confirmUpiReceived = () => {
    setShowQr(false);
    setProcessing(true);
    setTimeout(() => { setProcessing(false); setDone(true); }, 400);
  };

  const upiLink = upiConfigured
    ? buildUpiLink({ upiId: settings.upiId, payeeName: settings.payeeName, amount: total, note: `Tab: ${tab.label}` })
    : null;

  return (
    <ModalShell onClose={onClose} title={done ? "Payment confirmed" : showQr ? "Scan to pay" : "Settle tab"}>
      {!method && (
        <>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ color: C.textDim, fontSize: 13 }}>Amount due</div>
            <div style={{ ...displayFont, fontSize: 36, color: C.brass }}>{inr(total)}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {methods.map((m) => (
              <button key={m.id} onClick={() => handleSelect(m)} disabled={!m.live} style={{
                background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 12px",
                color: m.live ? C.text : C.textDim, textAlign: "left", opacity: m.live ? 1 : 0.55, cursor: m.live ? "pointer" : "not-allowed",
              }}>
                <m.icon size={18} color={m.live ? C.brass : C.textDim} style={{ marginBottom: 8 }} />
                <div style={{ fontWeight: 700, fontSize: 14 }}>{m.label}</div>
                <div style={{ fontSize: 11, color: C.textDim }}>{m.note}</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 14, textAlign: "center" }}>
            Card payments will activate here once Razorpay is connected.
          </div>
        </>
      )}

      {showQr && upiLink && (
        <div style={{ textAlign: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 16, display: "inline-block", marginBottom: 16 }}>
            <img src={qrImageUrl(upiLink)} alt="UPI QR code" width={220} height={220} style={{ display: "block" }} />
          </div>
          <div style={{ ...displayFont, fontSize: 26, color: C.brass, marginBottom: 4 }}>{inr(total)}</div>
          <div style={{ color: C.textDim, fontSize: 12, marginBottom: 20 }}>to {settings.payeeName || "Common Room Bar"} · {settings.upiId}</div>
          <button onClick={confirmUpiReceived} style={primaryBtn}>Payment received — confirm</button>
          <button onClick={() => { setShowQr(false); setMethod(null); }} style={{ ...primaryBtn, background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, marginTop: 8 }}>
            Back
          </button>
        </div>
      )}

      {method && !showQr && processing && (
        <div style={{ textAlign: "center", padding: "30px 0", color: C.textDim, fontSize: 14 }}>Confirming…</div>
      )}

      {method && !showQr && done && (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Check size={28} color="#fff" />
          </div>
          <div style={{ ...displayFont, fontSize: 24, marginBottom: 4 }}>{inr(total)} received</div>
          <div style={{ color: C.textDim, fontSize: 13, marginBottom: 24 }}>via {method} · closed by {staffName}</div>
          <button onClick={() => onComplete(method)} style={primaryBtn}>Done — clear tab</button>
        </div>
      )}
    </ModalShell>
  );
}

// ---------- Modal shell ----------
function ModalShell({ children, onClose, title }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, width: "100%", maxWidth: 380 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ ...displayFont, fontSize: 19 }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textDim }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { width: "100%", background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", color: C.text, fontSize: 15, marginBottom: 16, fontFamily: "Inter, sans-serif" };
const primaryBtn = { width: "100%", background: C.brass, border: "none", borderRadius: 10, padding: "13px 0", color: "#1a1408", fontWeight: 800, fontSize: 15 };
function SegBtn({ active, onClick, label }) {
  return <button onClick={onClick} style={{ flex: 1, background: active ? C.brass : C.panel2, color: active ? "#1a1408" : C.text, border: `1px solid ${active ? C.brass : C.border}`, borderRadius: 8, padding: "10px 0", fontWeight: 700, fontSize: 13 }}>{label}</button>;
}

// ---------- Reports ----------
function ReportsView({ history, menu, purchases }) {
  const [range, setRange] = useState("today");

  const filtered = useMemo(() => {
    const today = now();
    const startOfDay = new Date(today); startOfDay.setHours(0,0,0,0);
    const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - 7);
    const startOfMonth = new Date(today); startOfMonth.setMonth(today.getMonth() - 1);
    const startOfQuarter = new Date(today); startOfQuarter.setMonth(today.getMonth() - 3);
    const cutoffs = { today: startOfDay, week: startOfWeek, month: startOfMonth, quarter: startOfQuarter, all: new Date(0) };
    return history.filter((h) => new Date(h.closedAt) >= cutoffs[range]);
  }, [history, range]);

  const filteredPurchases = useMemo(() => {
    const today = now();
    const startOfDay = new Date(today); startOfDay.setHours(0,0,0,0);
    const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - 7);
    const startOfMonth = new Date(today); startOfMonth.setMonth(today.getMonth() - 1);
    const startOfQuarter = new Date(today); startOfQuarter.setMonth(today.getMonth() - 3);
    const cutoffs = { today: startOfDay, week: startOfWeek, month: startOfMonth, quarter: startOfQuarter, all: new Date(0) };
    return (purchases || []).filter((p) => new Date(p.purchase_date) >= cutoffs[range]);
  }, [purchases, range]);

  const revenue = filtered.reduce((s, h) => s + h.total, 0);
  const cost = filtered.reduce((s, h) => s + h.cost, 0);
  const profit = revenue - cost;
  const orderCount = filtered.length;
  const purchaseSpend = filteredPurchases.reduce((s, p) => s + Number(p.invoice_amount || 0), 0);
  const netProfit = revenue - purchaseSpend;

  const itemSales = useMemo(() => {
    const map = {};
    filtered.forEach((h) => h.items.forEach((li) => {
      if (!map[li.name]) map[li.name] = { name: li.name, qty: 0, revenue: 0 };
      map[li.name].qty += li.qty;
      map[li.name].revenue += li.price * li.qty;
    }));
    return Object.values(map).sort((a, b) => b.qty - a.qty);
  }, [filtered]);

  const byStaff = useMemo(() => {
    const map = {};
    filtered.forEach((h) => {
      if (!map[h.staff]) map[h.staff] = { name: h.staff, count: 0, revenue: 0 };
      map[h.staff].count += 1;
      map[h.staff].revenue += h.total;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  const lowStock = menu.filter((m) => m.stock <= 10);

  const dailySeries = useMemo(() => {
    const days = {};
    filtered.forEach((h) => {
      const key = fmtDate(h.closedAt);
      days[key] = (days[key] || 0) + h.total;
    });
    return Object.entries(days);
  }, [filtered]);
  const maxDaily = Math.max(1, ...dailySeries.map(([, v]) => v));

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div style={{ ...displayFont, fontSize: 24 }}>Reports</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["today", "Today"], ["week", "7 days"], ["month", "Monthly"], ["quarter", "Quarterly"]].map(([id, label]) => (
            <button key={id} onClick={() => setRange(id)} style={{
              background: range === id ? C.brass : C.panel, color: range === id ? "#1a1408" : C.text,
              border: `1px solid ${range === id ? C.brass : C.border}`, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700,
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
        <StatCard icon={IndianRupee} label="Revenue" value={inr(revenue)} accent={C.brass} />
        <StatCard icon={TrendingUp} label="Profit (est.)" value={inr(profit)} accent={C.green} sub={`Est. cost: ${inr(cost)}`} />
        <StatCard icon={ShoppingCart} label="Actual purchase spend" value={inr(purchaseSpend)} accent={C.amber} sub={`Net: ${inr(netProfit)}`} />
        <StatCard icon={Receipt} label="Orders closed" value={orderCount} accent={C.amber} />
        <StatCard icon={Package} label="Low stock items" value={lowStock.length} accent={lowStock.length ? C.red : C.textDim} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={panelBox}>
          <div style={panelTitle}>Daily revenue</div>
          {dailySeries.length === 0 ? <EmptyNote text="No sales in this range yet." /> : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 140, padding: "10px 4px 0" }}>
              {dailySeries.map(([day, val]) => (
                <div key={day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ fontSize: 10, color: C.textDim }}>{inr(val)}</div>
                  <div style={{ width: "100%", background: C.brass, borderRadius: "4px 4px 0 0", height: `${(val / maxDaily) * 90 + 4}px` }} />
                  <div style={{ fontSize: 10, color: C.textDim }}>{day}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={panelBox}>
          <div style={panelTitle}>Sales by staff</div>
          {byStaff.length === 0 ? <EmptyNote text="No closed tabs yet." /> : byStaff.map((s) => (
            <div key={s.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 24, height: 24, borderRadius: "50%", background: C.brassDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, ...displayFont }}>{s.name[0]}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.brass }}>{inr(s.revenue)}</div>
                <div style={{ fontSize: 10, color: C.textDim }}>{s.count} tab{s.count !== 1 ? "s" : ""}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={panelBox}>
          <div style={panelTitle}>Highest selling items</div>
          {itemSales.length === 0 ? <EmptyNote text="No sales yet." /> : itemSales.slice(0, 6).map((it, i) => (
            <div key={it.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ color: C.textDim, fontSize: 12, width: 16 }}>{i + 1}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{it.name}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{it.qty} sold</div>
                <div style={{ fontSize: 10, color: C.textDim }}>{inr(it.revenue)}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={panelBox}>
          <div style={panelTitle}>Inventory — pending / low</div>
          {menu.map((m) => {
            const pct = Math.min(100, (m.stock / 50) * 100);
            const low = m.stock <= 10;
            return (
              <div key={m.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{m.name}</span>
                  <span style={{ color: low ? C.red : C.textDim, fontWeight: 700 }}>{m.stock} {m.unit}s</span>
                </div>
                <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: low ? C.red : C.brass, borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const panelBox = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 };
const panelTitle = { fontSize: 13, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14 };

function StatCard({ icon: Icon, label, value, accent, sub }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <Icon size={16} color={accent} style={{ marginBottom: 8 }} />
      <div style={{ ...displayFont, fontSize: 26, color: accent, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
function EmptyNote({ text }) {
  return <div style={{ color: C.textDim, fontSize: 13, padding: "20px 0", textAlign: "center" }}>{text}</div>;
}

// ---------- Order History (view closed tabs, manager can edit/delete) ----------
function OrderHistoryView({ history, pushHistory, menu, pushMenu, isManager, showToast }) {
  const [editing, setEditing] = useState(null); // closed order being edited
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [search, setSearch] = useState("");

  const filtered = history.filter((h) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return h.staff?.toLowerCase().includes(q) || h.items.some((li) => li.name.toLowerCase().includes(q));
  });

  const handleDelete = (order) => {
    // Deleting a closed sale restores the stock it consumed — otherwise
    // inventory numbers would permanently understate what's actually left.
    pushMenu((prev) => prev.map((m) => {
      const li = order.items.find((it) => it.menuId === m.id);
      return li ? { ...m, stock: m.stock + li.qty } : m;
    }));
    pushHistory((prev) => prev.filter((h) => h.id !== order.id));
    setConfirmDeleteId(null);
    showToast(`Order deleted — stock restored`);
  };

  const saveEdit = (updatedItems) => {
    const total = updatedItems.reduce((s, li) => s + li.price * li.qty, 0);
    const cost = updatedItems.reduce((s, li) => s + (li.cost || 0) * li.qty, 0);
    // Reconcile stock: give back the old quantities, then take out the new ones.
    pushMenu((prev) => prev.map((m) => {
      const oldQty = editing.items.find((li) => li.menuId === m.id)?.qty || 0;
      const newQty = updatedItems.find((li) => li.menuId === m.id)?.qty || 0;
      const delta = oldQty - newQty; // positive = stock goes back up
      return delta !== 0 ? { ...m, stock: m.stock + delta } : m;
    }));
    pushHistory((prev) => prev.map((h) => h.id === editing.id ? { ...h, items: updatedItems, total, cost } : h));
    setEditing(null);
    showToast("Order updated");
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 10 }}>
        <div style={{ ...displayFont, fontSize: 24 }}>Order history</div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by staff or item…" style={{ ...inputStyle, marginBottom: 0, width: 220 }} />
      </div>
      {!isManager && (
        <div style={{ color: C.textDim, fontSize: 12, marginBottom: 18, display: "flex", alignItems: "center", gap: 6 }}>
          <Lock size={12} /> View only — editing and deleting orders requires manager access.
        </div>
      )}
      {isManager && <div style={{ marginBottom: 18 }} />}

      {filtered.length === 0 && <EmptyNote text="No closed orders yet." />}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((h) => (
          <div key={h.id} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {new Date(h.closedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
                <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
                  Closed by <strong style={{ color: C.text }}>{h.staff}</strong> · opened by {h.openedBy} · via {h.payMethod}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ ...displayFont, fontSize: 20, color: C.brass }}>{inr(h.total)}</div>
                {isManager && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setEditing(h)} style={iconBtn}><Edit3 size={13} /></button>
                    <button onClick={() => setConfirmDeleteId(h.id)} style={iconBtn}><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {h.items.map((li) => (
                <span key={li.id} style={{ background: C.panel2, borderRadius: 6, padding: "4px 10px", fontSize: 12 }}>
                  {li.name} × {li.qty}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {confirmDeleteId && (
        <ModalShell onClose={() => setConfirmDeleteId(null)} title="Delete this order?">
          <div style={{ color: C.textDim, fontSize: 13, marginBottom: 18 }}>
            This permanently removes the order from history and restores its items to stock. This can't be undone.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setConfirmDeleteId(null)} style={{ ...primaryBtn, background: "transparent", color: C.textDim, border: `1px solid ${C.border}` }}>Cancel</button>
            <button onClick={() => handleDelete(history.find((h) => h.id === confirmDeleteId))} style={{ ...primaryBtn, background: C.red, color: "#fff" }}>Delete order</button>
          </div>
        </ModalShell>
      )}

      {editing && <EditOrderModal order={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}
    </div>
  );
}

function EditOrderModal({ order, onClose, onSave }) {
  const [items, setItems] = useState(order.items.map((li) => ({ ...li })));
  const changeQty = (id, delta) => {
    setItems((prev) => prev.map((li) => li.id === id ? { ...li, qty: Math.max(0, li.qty + delta) } : li).filter((li) => li.qty > 0));
  };
  const total = items.reduce((s, li) => s + li.price * li.qty, 0);
  return (
    <ModalShell onClose={onClose} title="Edit order">
      <div style={{ marginBottom: 14 }}>
        {items.map((li) => (
          <div key={li.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{li.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => changeQty(li.id, -1)} style={iconBtn}><Minus size={12} /></button>
              <span style={{ width: 18, textAlign: "center", fontWeight: 700 }}>{li.qty}</span>
              <button onClick={() => changeQty(li.id, 1)} style={iconBtn}><Plus size={12} /></button>
            </div>
          </div>
        ))}
        {items.length === 0 && <EmptyNote text="All items removed — saving will delete this order's line items." />}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ color: C.textDim, fontSize: 13 }}>New total</span>
        <span style={{ ...displayFont, fontSize: 20, color: C.brass }}>{inr(total)}</span>
      </div>
      <button onClick={() => onSave(items)} style={primaryBtn}>Save changes</button>
    </ModalShell>
  );
}

// ---------- Purchases (purchase orders / cost tracking) ----------
function PurchasesView({ menu, purchases, refreshPurchases, shift, showToast }) {
  const [showNew, setShowNew] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const totalSpend = purchases.reduce((s, p) => s + Number(p.invoice_amount || 0), 0);
  const thisMonthSpend = purchases
    .filter((p) => new Date(p.purchase_date).getMonth() === now().getMonth() && new Date(p.purchase_date).getFullYear() === now().getFullYear())
    .reduce((s, p) => s + Number(p.invoice_amount || 0), 0);

  const handleDelete = async (id) => {
    await deletePurchase(id);
    await refreshPurchases();
    setConfirmDeleteId(null);
    showToast("Purchase order deleted");
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div style={{ ...displayFont, fontSize: 24 }}>Purchases</div>
        <button onClick={() => setShowNew(true)} style={{ background: C.brass, border: "none", borderRadius: 8, padding: "9px 16px", color: "#1a1408", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={15} /> Record purchase
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
        <StatCard icon={ShoppingCart} label="Total recorded spend" value={inr(totalSpend)} accent={C.brass} />
        <StatCard icon={TrendingUp} label="This month" value={inr(thisMonthSpend)} accent={C.amber} />
        <StatCard icon={Receipt} label="Purchase orders" value={purchases.length} accent={C.textDim} />
      </div>

      {purchases.length === 0 && <EmptyNote text="No purchases recorded yet. Tap 'Record purchase' when you restock." />}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {purchases.map((p) => (
          <div key={p.id} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.supplier}</div>
                <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
                  {new Date(p.purchase_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  {p.recorded_by ? ` · recorded by ${p.recorded_by}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ ...displayFont, fontSize: 20, color: C.brass }}>{inr(p.invoice_amount)}</div>
                <button onClick={() => setConfirmDeleteId(p.id)} style={iconBtn}><Trash2 size={13} /></button>
              </div>
            </div>
            {p.items?.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {p.items.map((li, i) => (
                  <span key={i} style={{ background: C.panel2, borderRadius: 6, padding: "4px 10px", fontSize: 12 }}>
                    {li.name} × {li.qty} @ {inr(li.unitCost)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {confirmDeleteId && (
        <ModalShell onClose={() => setConfirmDeleteId(null)} title="Delete this purchase record?">
          <div style={{ color: C.textDim, fontSize: 13, marginBottom: 18 }}>This removes it from your spend reports. This can't be undone.</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setConfirmDeleteId(null)} style={{ ...primaryBtn, background: "transparent", color: C.textDim, border: `1px solid ${C.border}` }}>Cancel</button>
            <button onClick={() => handleDelete(confirmDeleteId)} style={{ ...primaryBtn, background: C.red, color: "#fff" }}>Delete</button>
          </div>
        </ModalShell>
      )}

      {showNew && (
        <NewPurchaseModal
          menu={menu}
          shift={shift}
          onClose={() => setShowNew(false)}
          onSave={async (purchase) => {
            await insertPurchase(purchase);
            await refreshPurchases();
            setShowNew(false);
            showToast(`Purchase from ${purchase.supplier} recorded`);
          }}
        />
      )}
    </div>
  );
}

function NewPurchaseModal({ menu, shift, onClose, onSave }) {
  const [supplier, setSupplier] = useState("");
  const [date, setDate] = useState(now().toISOString().slice(0, 10));
  const [lines, setLines] = useState([{ menuId: menu[0]?.id || "", qty: "", unitCost: "" }]);

  const addLine = () => setLines((prev) => [...prev, { menuId: menu[0]?.id || "", qty: "", unitCost: "" }]);
  const removeLine = (i) => setLines((prev) => prev.filter((_, idx) => idx !== i));
  const updateLine = (i, field, val) => setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));

  const invoiceTotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);

  const handleSave = () => {
    if (!supplier.trim()) return;
    const items = lines
      .filter((l) => l.menuId && Number(l.qty) > 0)
      .map((l) => {
        const m = menu.find((mm) => mm.id === l.menuId);
        return { menuItemId: l.menuId, name: m?.name || "Item", qty: Number(l.qty), unitCost: Number(l.unitCost) || 0 };
      });
    onSave({
      supplier: supplier.trim(),
      purchase_date: date,
      invoice_amount: invoiceTotal,
      items,
      recorded_by: shift.staffName,
    });
  };

  return (
    <ModalShell onClose={onClose} title="Record purchase">
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>Supplier</div>
      <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Goa Beverages Pvt Ltd" style={inputStyle} />
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>Date</div>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />

      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8, marginTop: 4 }}>Items in this delivery</div>
      {lines.map((line, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
          <select value={line.menuId} onChange={(e) => updateLine(i, "menuId", e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 2 }}>
            {menu.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input type="number" placeholder="Qty" value={line.qty} onChange={(e) => updateLine(i, "qty", e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
          <input type="number" placeholder="Cost/unit" value={line.unitCost} onChange={(e) => updateLine(i, "unitCost", e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
          {lines.length > 1 && (
            <button onClick={() => removeLine(i)} style={iconBtn}><X size={13} /></button>
          )}
        </div>
      ))}
      <button onClick={addLine} style={{ background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "8px 0", width: "100%", color: C.textDim, fontSize: 12, marginBottom: 16 }}>
        + Add another item
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, paddingTop: 10, borderTop: `1px dashed ${C.border}` }}>
        <span style={{ color: C.textDim, fontSize: 13 }}>Invoice total</span>
        <span style={{ ...displayFont, fontSize: 20, color: C.brass }}>{inr(invoiceTotal)}</span>
      </div>
      <button onClick={handleSave} disabled={!supplier.trim()} style={{ ...primaryBtn, opacity: supplier.trim() ? 1 : 0.5 }}>Save purchase order</button>
    </ModalShell>
  );
}

// ---------- Menu admin ----------
function MenuAdmin({ menu, pushMenu, showToast, settings, pushSettings, isManager }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", category: "Beer", price: "", stock: "", unit: "bottle" });
  const [upiDraft, setUpiDraft] = useState(settings?.upiId || "");
  const [payeeDraft, setPayeeDraft] = useState(settings?.payeeName || "Common Room Bar");
  const categories = [...new Set(menu.map((m) => m.category))];

  const saveUpi = () => {
    pushSettings({ upiId: upiDraft.trim(), payeeName: payeeDraft.trim() || "Common Room Bar" });
    showToast(upiDraft.trim() ? "UPI ID saved — QR payments are live" : "UPI ID cleared");
  };

  const openEdit = (item) => { setEditing(item.id); setForm({ name: item.name, category: item.category, price: item.price, stock: item.stock, unit: item.unit }); };
  const openNew = () => { setEditing("new"); setForm({ name: "", category: categories[0] || "Beer", price: "", stock: "", unit: "bottle" }); };
  const save = () => {
    if (!form.name.trim() || !form.price) { showToast("Name and price are required", "error"); return; }
    if (editing === "new") {
      pushMenu((prev) => [...prev, { id: uid(), name: form.name, category: form.category, price: Number(form.price), stock: Number(form.stock) || 0, unit: form.unit }]);
      showToast(`${form.name} added to menu`);
    } else {
      pushMenu((prev) => prev.map((m) => m.id === editing ? { ...m, name: form.name, category: form.category, price: Number(form.price), stock: Number(form.stock) || 0, unit: form.unit } : m));
      showToast(`${form.name} updated`);
    }
    setEditing(null);
  };
  const remove = (id) => {
    const item = menu.find((m) => m.id === id);
    pushMenu((prev) => prev.filter((m) => m.id !== id));
    showToast(`${item.name} removed from menu`);
  };
  const restock = (id, amount) => pushMenu((prev) => prev.map((m) => m.id === id ? { ...m, stock: Math.max(0, m.stock + amount) } : m));

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div style={{ ...displayFont, fontSize: 24 }}>Menu & inventory</div>
        <button onClick={openNew} style={{ background: C.brass, border: "none", borderRadius: 8, padding: "9px 16px", color: "#1a1408", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={15} /> Add item
        </button>
      </div>

      <div style={{ ...panelBox, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={panelTitle}>Payment settings</div>
          {!isManager && <Lock size={12} color={C.textDim} />}
        </div>
        <div style={{ fontSize: 12, color: C.textDim, marginBottom: 14 }}>
          {isManager
            ? "Set your UPI ID once — every UPI payment on the floor will generate a QR code pre-filled with the exact tab amount."
            : "Manager access required to view or change payment settings."}
        </div>
        {isManager ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>UPI ID</div>
                <input value={upiDraft} onChange={(e) => setUpiDraft(e.target.value)} placeholder="yourname@okhdfcbank" style={{ ...inputStyle, marginBottom: 0 }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>Payee name shown to guest</div>
                <input value={payeeDraft} onChange={(e) => setPayeeDraft(e.target.value)} placeholder="Common Room Bar" style={{ ...inputStyle, marginBottom: 0 }} />
              </div>
            </div>
            <button onClick={saveUpi} style={{ ...primaryBtn, width: "auto", padding: "10px 20px" }}>Save payment settings</button>
            {settings?.upiId && <div style={{ fontSize: 11, color: C.green, marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}><Check size={13} /> UPI QR payments are active</div>}
          </>
        ) : (
          settings?.upiId && <div style={{ fontSize: 11, color: C.green, display: "flex", alignItems: "center", gap: 6 }}><Check size={13} /> UPI QR payments are active</div>
        )}
      </div>

      {categories.map((cat) => (
        <div key={cat} style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>{cat}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {menu.filter((m) => m.category === cat).map((m) => (
              <div key={m.id} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{m.name}</div>
                    <div style={{ ...displayFont, fontSize: 17, color: C.brass, marginTop: 2 }}>{inr(m.price)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => openEdit(m)} style={iconBtn}><Edit3 size={13} /></button>
                    <button onClick={() => remove(m.id)} style={iconBtn}><Trash2 size={13} /></button>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                  <span style={{ fontSize: 12, color: m.stock <= 10 ? C.red : C.textDim, fontWeight: 600 }}>{m.stock} {m.unit}s in stock</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => restock(m.id, -1)} style={{ ...iconBtn, width: 22, height: 22 }}><Minus size={11} /></button>
                    <button onClick={() => restock(m.id, 12)} style={{ ...iconBtn, width: 22, height: 22 }}><Plus size={11} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {editing && (
        <ModalShell onClose={() => setEditing(null)} title={editing === "new" ? "Add menu item" : "Edit menu item"}>
          <input placeholder="Item name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          <input placeholder="Category (e.g. Beer, Snacks)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inputStyle} />
          <input placeholder="Price (₹)" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} style={inputStyle} />
          <input placeholder="Stock quantity" type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} style={inputStyle} />
          <input placeholder="Unit (bottle, plate...)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} style={inputStyle} />
          <button onClick={save} style={primaryBtn}>Save item</button>
        </ModalShell>
      )}
    </div>
  );
}
const iconBtn = { background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", color: C.textDim };
