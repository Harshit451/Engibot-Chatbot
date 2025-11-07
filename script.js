const ENABLE_GEMINI = true;
const GEMINI_MODEL = 'gemini-2.5-flash'; 

const SYSTEM_PROMPT = `You are EngiBot, a helpful engineering assistant.
- Be accurate and concise. Show formulas, units, and steps when useful.
- Prefer SI units; convert on request.
- For code, include clear formatting and brief comments.
- Ask for missing data if needed.`;


function getApiKey() {
  return (localStorage.getItem('engibot_api_key') || '').trim();
}


function toGeminiContents(historyMessages = []) {
  const mapped = historyMessages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));
  while (mapped.length && mapped[0].role !== 'user') mapped.shift();
  return mapped;
}

async function callGeminiAPI(historyMessages = []) {
  try {
    // Only include user messages for API
    const userMessages = historyMessages.filter(m => m.role === 'user');
    if (!userMessages.length) return 'No user message found.';

    // Use the last user message
    const lastUserMessage = userMessages[userMessages.length - 1].content;

   const formattedMessages = [
  {
    role: "system",
    content: SYSTEM_PROMPT
  },
  {
    role: "user",
    content: lastUserMessage
  }
];


    console.log("📤 Sending formatted messages to backend:", formattedMessages);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: formattedMessages })
    });

    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    const data = await res.json();
    return data.reply || 'Sorry, no reply received.';
  } catch (err) {
    console.error(err);
    return 'Sorry, I couldn’t process that right now.';
  }
}







//  NAVIGATION 
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => {
    const isTarget = page.id === `${pageId}-page`;
    page.classList.toggle('active', isTarget);
    page.setAttribute('aria-hidden', String(!isTarget));
  });

  // Toggle active state on header buttons
  document.querySelectorAll('[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId);
  });

  if (location.hash !== `#${pageId}`) {
    history.pushState({ page: pageId }, '', `#${pageId}`);
  }

  const heading = document.querySelector(`#${pageId}-page h1, #${pageId}-page h2, #${pageId}-page h3, #${pageId}-page h4`);
  if (heading) heading.focus?.();
}
function setAuthTab(tab) {
  const triggerEl = document.querySelector(`#${tab}-tab`);
  if (triggerEl) new bootstrap.Tab(triggerEl).show();
}
window.addEventListener('popstate', () => {
  const page = location.hash?.replace('#', '') || 'home';
  showPage(page);
});

/*  AUTH (localStorage)  */
const USERS_KEY = 'engibot_users_v1';
const CURRENT_USER_KEY = 'engibot_current_user_v1';
const CHAT_KEY_PREFIX = 'engibot_chat_';

const enc = new TextEncoder();
function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
function genSaltHex(len = 16) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2,'0')).join('');
}
async function sha256Hex(str) {
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
    return toHex(buf);
  } else {
    let h = 0; for (let i=0;i<str.length;i++){ h=(h<<5)-h+str.charCodeAt(i); h|=0; }
    return ('00000000' + (h>>>0).toString(16)).slice(-8);
  }
}
async function hashPassword(password, saltHex) {
  return await sha256Hex(saltHex + ':' + password);
}

function loadUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch { return []; }
}
function saveUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }
function getCurrentUserId() { return localStorage.getItem(CURRENT_USER_KEY) || null; }
function setCurrentUserId(id) { if (id) localStorage.setItem(CURRENT_USER_KEY, id); else localStorage.removeItem(CURRENT_USER_KEY); }
function getCurrentUser() {
  const id = getCurrentUserId();
  return id ? loadUsers().find(u => u.id === id) || null : null;
}
function getChatKey() {
  const u = getCurrentUser();
  return `${CHAT_KEY_PREFIX}${u ? u.id : 'guest'}`;
}

/* CHAT STORAGE  */
function loadMessages() {
  try {
    const raw = localStorage.getItem(getChatKey());
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveMessages(msgs) {
  try { localStorage.setItem(getChatKey(), JSON.stringify(msgs)); } catch {}
}
function clearMessages() {
  localStorage.removeItem(getChatKey());
}

/* OFFLINE ANSWERING ENGINE  */
const fallbackSnippets = [
  "Let’s list knowns and unknowns first, then pick the right formulas.",
  "Check assumptions and boundary conditions; that often clarifies the path.",
  "We can model this with first-order equations; want me to outline it?",
  "We’ll need units and material properties to proceed reliably."
];
function fmt(n, d=6) {
  if (!isFinite(n)) return String(n);
  const s = n.toFixed(d);
  return s.replace(/\.?0+$/,'');
}

/* Unit conversions */
const UNITS = {
  length: { base: 'm', units: {
    m:1, mm:1e-3, cm:1e-2, km:1e3,
    in:0.0254, inch:0.0254, inches:0.0254,
    ft:0.3048, foot:0.3048, feet:0.3048,
    yd:0.9144, mi:1609.344, mile:1609.344, miles:1609.344
  }},
  pressure: { base: 'Pa', units: {
    pa:1, kpa:1e3, mpa:1e6, bar:1e5, psi:6894.757293168
  }},
  energy: { base: 'J', units: {
    j:1, kj:1e3, wh:3600, kwh:3.6e6, cal:4.184, kcal:4184
  }},
  mass: { base: 'kg', units: {
    kg:1, g:1e-3, mg:1e-6, lb:0.45359237, lbs:0.45359237, pound:0.45359237, pounds:0.45359237
  }}
};
function normUnit(u) {
  return (u||'').toLowerCase().replace('µ','u').replace('μ','u').replace(/\s/g,'');
}
const TEMP_NAMES = { c:['c','celsius','°c','degc'], f:['f','fahrenheit','°f','degf'], k:['k','kelvin'] };
function inGroup(name, u) { return TEMP_NAMES[name].includes(u); }

function convertTemp(val, from, to) {
  const f = normUnit(from), t = normUnit(to);
  let C;
  if (inGroup('c',f)) C = val;
  else if (inGroup('f',f)) C = (val - 32) * 5/9;
  else if (inGroup('k',f)) C = val - 273.15;
  else return null;

  if (inGroup('c',t)) return C;
  if (inGroup('f',t)) return C * 9/5 + 32;
  if (inGroup('k',t)) return C + 273.15;
  return null;
}

function tryUnitConvert(text) {
  // Temperature
  let m = text.match(/(-?\d+(?:\.\d+)?)\s*°?\s*(celsius|c|degc|fahrenheit|f|degf|k|kelvin)\s+(?:to|in)\s+(celsius|c|degc|fahrenheit|f|degf|k|kelvin)\b/i);
  if (m) {
    const val = parseFloat(m[1]);
    const out = convertTemp(val, m[2], m[3]);
    if (out == null) return null;
    return `${fmt(val)} ${m[2]} = ${fmt(out)} ${m[3]}`;
  }

  // General units
  m = text.match(/(-?\d+(?:\.\d+)?)\s*([a-z/µμ]+)\s+(?:to|in)\s+([a-z/µμ]+)\b/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const from = normUnit(m[2]);
  const to = normUnit(m[3]);

  for (const spec of Object.values(UNITS)) {
    const f = spec.units[from], t = spec.units[to];
    if (f && t) {
      const out = value * f / t;
      return `${fmt(value)} ${m[2]} = ${fmt(out)} ${m[3]}`;
    }
  }
  return null;
}

/* Arithmetic evaluator */
function maybeCalc(text) {
  let expr = null;
  const t = text.trim();
  const m1 = t.match(/^(?:calc:|calculate:|calc\s+)(.+)$/i);
  const m2 = t.match(/^(?:what(?:'| i)s|evaluate)\s+(.+)$/i);
  if (m1) expr = m1[1];
  else if (m2) expr = m2[1];
  else if (/^[\d\s+\-*/^().]+$/.test(t)) expr = t;

  if (!expr) return null;
  let s = expr.toLowerCase().replace(/\bpi\b/g, String(Math.PI)).replace(/\^/g, '**');
  if (!/^[0-9+\-*/().\s*eE**]+$/.test(s)) return null;
  try {
    const val = Function(`"use strict"; return (${s});`)();
    if (typeof val === 'number' && isFinite(val)) return `${expr.trim()} = ${fmt(val)}`;
  } catch {}
  return "I couldn't evaluate that expression. Try: calc: (3e3*2.5)^2 / (8*pi)";
}

/* Ohm's law */
function tryOhms(text) {
  if (!/(ohm|ohm's|ohms|voltage|current|resistance|V=|I=|R=)/i.test(text)) return null;
  const get = (k) => {
    const m = text.match(new RegExp(`${k}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'));
    return m ? parseFloat(m[1]) : null;
  };
  let V = get('V'), I = get('I'), R = get('R');
  if (V != null && I != null) R = V / I;
  else if (V != null && R != null) I = V / R;
  else if (I != null && R != null) V = I * R;
  else return "Ohm’s law: V = I·R. Provide two of V, I, R like: V=12, R=4.";
  return `Ohm’s law result: V=${fmt(V)} V, I=${fmt(I)} A, R=${fmt(R)} Ω`;
}

/* RLC resonance (series) */
function tryRLC(text) {
  if (!/(resonance|resonant|rlc)/i.test(text)) return null;
  function parseVal(label, allowed) {
    const m = text.match(new RegExp(`${label}\\s*=\\s*(-?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?)\\s*([a-zµμ]+)?`, 'i'));
    if (!m) return null;
    const num = parseFloat(m[1]);
    const u = normUnit(m[2] || '');
    const map = { h:1, mh:1e-3, uh:1e-6, 'μh':1e-6, nh:1e-9, f:1, mf:1e-3, uf:1e-6, 'μf':1e-6, nf:1e-9, pf:1e-12 };
    if (!allowed.includes(u)) return null;
    return num * map[u];
  }
  const L = parseVal('L', ['h','mh','uh','μh','nh']);
  const C = parseVal('C', ['f','mf','uf','μf','nf','pf']);
  if (L == null || C == null) return "Provide L and C with units, e.g., L=10 mH, C=10 uF";
  const f0 = 1/(2*Math.PI*Math.sqrt(L*C));
  return `Series RLC resonance f0 = 1/(2π√(LC)) = ${fmt(f0,6)} Hz`;
}

/* Beam deflection (simply supported, center load) */
function tryBeam(text) {
  if (!/(beam).*?(deflection)|deflection.*beam/i.test(text)) return null;
  const getKV = (label) => {
    const m = text.match(new RegExp(`${label}\\s*=\\s*(-?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?)\\s*([a-z^0-9µμ]*)`, 'i'));
    if (!m) return null; return { v: parseFloat(m[1]), u: normUnit(m[2] || '') };
  };
  const P = getKV('P') || getKV('W');
  const L = getKV('L');
  const E = getKV('E');
  const I = getKV('I');
  if (!P || !L || !E || !I) {
    return "For center load on simply supported beam: provide L (length), E (modulus), I (inertia), P (load). Example: L=5 m, E=200 GPa, I=8e-6 m^4, P=10 kN";
  }
  const unitFactor = (v,u) => {
    if (u.includes('kn')) return v*1000;
    if (u.includes('n')) return v;
    if (u.includes('gpa')) return v*1e9;
    if (u.includes('mpa')) return v*1e6;
    if (u.includes('pa')) return v;
    if (u.includes('mm^4')) return v*1e-12;
    if (u.includes('cm^4')) return v*1e-8;
    if (u.includes('m^4')) return v;
    if (u==='m') return v;
    if (u==='cm') return v*1e-2;
    if (u==='mm') return v*1e-3;
    return v;
  };
  const Pn = unitFactor(P.v, P.u || 'N');
  const Ln = unitFactor(L.v, L.u || 'm');
  const En = unitFactor(E.v, E.u || 'Pa');
  const In = unitFactor(I.v, I.u || 'm^4');
  const y = (Pn * Math.pow(Ln,3)) / (48 * En * In);
  return `Beam deflection (center load): δ_max = P·L^3/(48·E·I) = ${fmt(y,6)} m (${fmt(y*1000,4)} mm)`;
}

/* Quick knowledge */
function quickKnowledge(text) {
  const t = text.toLowerCase();
  if (/(^|\b)(hi|hello|hey)\b|how are you/.test(t))
    return "Hey! 👋 I’m EngiBot. Ask me conversions, calcs, or quick engineering help.";
  if (/who are you|what are you|about you/.test(t))
    return "I’m EngiBot, a helper for conversions, math, Ohm’s law, RLC resonance, beam deflection, and small code snippets.";
  if (/second law|2nd law|thermodynamics.*second/.test(t))
    return "Second law: entropy of an isolated system never decreases. Heat flows hot→cold; no heat engine is 100% efficient.";
  if (/fourier.*matlab|matlab.*fourier|fft.*matlab/.test(t))
    return `MATLAB FFT example:
Fs=1000; T=1/Fs; L=1000; t=(0:L-1)*T;
x=0.7*sin(2*pi*50*t)+sin(2*pi*120*t)+0.5*randn(size(t));
Y=fft(x); P2=abs(Y/L); P1=P2(1:L/2+1); P1(2:end-1)=2*P1(2:end-1);
f=Fs*(0:(L/2))/L; figure; plot(f,P1); grid on; xlabel('f (Hz)'); ylabel('|P1(f)|');`;
  if (/help|what can you do|features/.test(t))
    return "I can: convert units (e.g., 50 MPa to psi), calc: expressions, Ohm’s law, RLC resonance, beam deflection, and give small code snippets.";
  return null;
}

async function generateAnswer(text, historyMessages) {
  console.log("✅ Gemini block active with key:", getApiKey());
  if (ENABLE_GEMINI && getApiKey()) {
    try {
      const context = (historyMessages || []).slice(-16);
      const aiText = await callGeminiAPI(context);
      if (aiText) return aiText;
    } catch (err) {
      console.warn('Gemini failed, using offline engine:', err?.message || err);
    }
  }

  // Fallback: offline helpers
  const s1 = tryUnitConvert(text); if (s1) return s1;
  const s2 = maybeCalc(text); if (s2) return s2;
  const s3 = tryOhms(text); if (s3) return s3;
  const s4 = tryRLC(text); if (s4) return s4;
  const s5 = tryBeam(text); if (s5) return s5;
  const s6 = quickKnowledge(text); if (s6) return s6;
  const hint = fallbackSnippets[Math.floor(Math.random()*fallbackSnippets.length)];
  return `I don’t have a specific offline answer for that yet. ${hint}`;
}

/* UI / APP */
document.addEventListener('DOMContentLoaded', () => {
  const initialPage = location.hash?.replace('#', '') || 'home';
  showPage(initialPage);

  const chatArea = document.getElementById('chatContainer');
  const userInput = document.getElementById('userInput');
  const sendButton = document.getElementById('sendButton');
  const clearChatBtn = document.getElementById('clearChatBtn');
  const clearChatLink = document.getElementById('clearChatLink');
  const authButtons = document.getElementById('authButtons');
  const userMenu = document.getElementById('userMenu');
  const navUserName = document.getElementById('navUserName');
  const navUserEmail = document.getElementById('navUserEmail');

  function createBubble(role, text) {
    const el = document.createElement('div');
    el.className = `message ${role === 'user' ? 'user-message' : 'bot-message'}`;
    el.textContent = text;
    el.style.whiteSpace = 'pre-wrap'; 
    chatArea.appendChild(el);
    return el;
  }
  function scrollToBottom() { chatArea.scrollTop = chatArea.scrollHeight; }

  let typingEl = null;
  function showTyping() {
    hideTyping();
    typingEl = document.createElement('div');
    typingEl.className = 'typing-indicator';
    typingEl.innerHTML = `<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`;
    chatArea.appendChild(typingEl);
    scrollToBottom();
  }
  function hideTyping() {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    typingEl = null;
  }

  function seedGreetingIfEmpty(msgs) {
    if (msgs.length === 0) {
      msgs.push({
        role: 'bot',
        content: `Hello! 👋 I’m **EngiBot**, your AI assistant for engineering, learning, and problem-solving.  
        I can handle calculations, explain concepts, write code, and answer study or general knowledge questions.  
        What would you like to explore today?`
      });


    }
  }

  let messages = loadMessages();
  seedGreetingIfEmpty(messages);
  function renderAll() {
    chatArea.innerHTML = '';
    messages.forEach(m => createBubble(m.role, m.content));
    scrollToBottom();
  }
  renderAll();

  function autoResize() {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 140) + 'px';
  }
  userInput.addEventListener('input', () => {
    autoResize();
    sendButton.disabled = userInput.value.trim().length === 0;
  });
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  document.querySelectorAll('.example-query').forEach(btn => {
    btn.addEventListener('click', () => {
      userInput.value = btn.dataset.text || btn.textContent.trim();
      autoResize();
      sendButton.disabled = userInput.value.trim().length === 0;
      userInput.focus();
    });
  });

  async function handleSend() {
    const content = userInput.value.trim();
    if (!content) return;
    sendButton.disabled = true;
    sendButton.querySelector('.send-label')?.classList.add('d-none');
    sendButton.querySelector('.spinner-border')?.classList.remove('d-none');

    messages.push({ role: 'user', content });
    createBubble('user', content);
    saveMessages(messages);
    userInput.value = '';
    autoResize();
    scrollToBottom();

    showTyping();
    try {
      await new Promise(r => setTimeout(r, 250));
      const reply = await generateAnswer(content, messages);
      hideTyping();
      messages.push({ role: 'bot', content: reply });
      createBubble('bot', reply);
      saveMessages(messages);
      scrollToBottom();
    } catch (e) {
      hideTyping();
      const errorMsg = "Sorry, I couldn't process that right now. Please try again.";
      messages.push({ role: 'bot', content: errorMsg });
      createBubble('bot', errorMsg);
      saveMessages(messages);
    } finally {
      sendButton.querySelector('.send-label')?.classList.remove('d-none');
      sendButton.querySelector('.spinner-border')?.classList.add('d-none');
      sendButton.disabled = true;
      userInput.focus();
    }
  }
  sendButton.addEventListener('click', handleSend);

  function doClearChat() {
    if (!confirm('Clear this chat history?')) return;
    clearMessages();
    messages = [];
    seedGreetingIfEmpty(messages);
    saveMessages(messages);
    renderAll();
  }
  if (clearChatBtn) clearChatBtn.addEventListener('click', doClearChat);
  if (clearChatLink) clearChatLink.addEventListener('click', (e) => { e.preventDefault(); doClearChat(); });

  function updateAuthUI() {
    const user = getCurrentUser();
    if (user) {
      authButtons.classList.add('d-none');
      userMenu.classList.remove('d-none');
      navUserName.textContent = user.firstName || 'Account';
      navUserEmail.textContent = user.email || '';
    } else {
      userMenu.classList.add('d-none');
      authButtons.classList.remove('d-none');
      navUserName.textContent = 'Account';
      navUserEmail.textContent = '';
    }
    // Load that user's chat
    messages = loadMessages();
    seedGreetingIfEmpty(messages);
    renderAll();
  }

  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const fakeForgot = document.getElementById('fakeForgot');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim().toLowerCase();
      const password = document.getElementById('loginPassword').value;
      if (!loginForm.checkValidity()) {
        loginForm.classList.add('was-validated');
        return;
      }
      const users = loadUsers();
      const user = users.find(u => u.email === email);
      if (!user) { alert('No account found for that email.'); return; }
      const hash = await hashPassword(password, user.salt);
      if (hash !== user.passwordHash) { alert('Incorrect password.'); return; }
      setCurrentUserId(user.id);
      bootstrap.Modal.getInstance(document.getElementById('authModal'))?.hide();
      loginForm.reset();
      loginForm.classList.remove('was-validated');
      updateAuthUI();
    });
  }

  if (signupForm) {
    const pwd = document.getElementById('signupPassword');
    const confirm = document.getElementById('confirmPassword');
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const firstName = document.getElementById('firstName').value.trim();
      const lastName = document.getElementById('lastName').value.trim();
      const email = document.getElementById('signupEmail').value.trim().toLowerCase();
      const password = pwd.value;

      confirm.setCustomValidity(confirm.value === password ? '' : 'Passwords do not match');
      if (!signupForm.checkValidity()) {
        signupForm.classList.add('was-validated');
        return;
      }

      const users = loadUsers();
      if (users.some(u => u.email === email)) { alert('An account with that email already exists.'); return; }

      const salt = genSaltHex(16);
      const passwordHash = await hashPassword(password, salt);
      const user = {
        id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8),
        email, firstName, lastName, salt, passwordHash, createdAt: Date.now()
      };
      users.push(user);
      saveUsers(users);
      setCurrentUserId(user.id); 

      bootstrap.Modal.getInstance(document.getElementById('authModal'))?.hide();
      signupForm.reset();
      signupForm.classList.remove('was-validated');
      updateAuthUI();
    });

    confirm.addEventListener('input', () => {
      confirm.setCustomValidity(confirm.value === document.getElementById('signupPassword').value ? '' : 'Passwords do not match');
    });
    document.getElementById('signupPassword').addEventListener('input', () => {
      confirm.setCustomValidity(confirm.value === document.getElementById('signupPassword').value ? '' : 'Passwords do not match');
    });
  }

  if (fakeForgot) {
    fakeForgot.addEventListener('click', (e) => {
      e.preventDefault();
      alert('Demo only: accounts are stored locally in your browser. No email recovery. Clear localStorage to reset.');
    });
  }

  const logoutLink = document.getElementById('logoutLink');
  if (logoutLink) {
    logoutLink.addEventListener('click', (e) => {
      e.preventDefault();
      setCurrentUserId(null);
      updateAuthUI();
    });
  }

  updateAuthUI();
});