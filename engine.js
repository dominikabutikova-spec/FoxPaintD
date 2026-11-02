/* ============================================================
   engine.js — Studio Paint v8
   Все события на #stageOverlay. Инструменты работают.
   ============================================================ */

const $  = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const now = () => performance.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const log = (...args) => console.log('[ENGINE]', ...args);

function go(pageId){
  $$('.page').forEach(p => p.classList.remove('active'));
  const el = $(pageId);
  if(el) el.classList.add('active');
  if(pageId === 'pgGallery')    renderGalleryScreen();
  if(pageId === 'pgCommunity')  renderCommunityScreen();
  if(pageId === 'pgAdmin')      loadAdminPanel();
}
window.go = go;

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function rgbToHex(r,g,b){
  return '#' + [r,g,b].map(v => clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join('').toUpperCase();
}
function hexToRgb(h){
  if(!h) return [0,0,0];
  h = h.replace('#','');
  if(h.length === 3) h = h.split('').map(x => x + x).join('');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function hsv2rgb(h,s,v){
  const c = v*s, x = c*(1 - Math.abs((h/60)%2 - 1)), m = v-c;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x;} else if(h<120){r=x;g=c;}
  else if(h<180){g=c;b=x;} else if(h<240){g=x;b=c;}
  else if(h<300){r=x;b=c;} else {r=c;b=x;}
  return [(r+m)*255,(g+m)*255,(b+m)*255];
}
function rgb2hsv(r,g,b){
  r/=255; g/=255; b/=255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  let h = 0;
  if(d !== 0){
    if(max === r) h = ((g-b)/d)%6;
    else if(max === g) h = (b-r)/d + 2;
    else h = (r-g)/d + 4;
    h *= 60; if(h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d/max, max];
}

/* ============================================================
   TOASTS
   ============================================================ */
function toast(text, type = 'info', duration = 3000){
  const container = $('toastContainer');
  if(!container) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'err' : type === 'success' ? 'ok' : '');
  el.innerHTML = `<span>${escapeHtml(text)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(30px)';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/* ============================================================
   API
   ============================================================ */
const API_BASE = (location.origin.startsWith('http') ? location.origin : 'http://localhost:3000') + '/api';

async function api(path, options = {}){
  const headers = options.headers || {};
  if(!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if(state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(API_BASE + path, { ...options, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if(!res.ok) throw Object.assign(new Error(data?.error || 'API error'), { status: res.status, data });
  return data;
}

/* ============================================================
   STATE
   ============================================================ */
const state = {
  user: null,
  token: localStorage.getItem('spw.token') || null,
  projects: [],
  cloudProjects: [],
  publicProjects: [],
  palette: JSON.parse(localStorage.getItem('spw.palette') ||
    '["#7C5CFF","#FF6B9D","#FFD166","#06D6A0","#118AB2","#073B4C","#EF476F","#000000","#FFFFFF","#808080"]'),
  brushes: JSON.parse(localStorage.getItem('spw.brushes') || 'null'),
  currentBrushId: localStorage.getItem('spw.currentBrushId') || 'soft-round',
};
try {
  const raw = localStorage.getItem('spw.projects');
  if(raw){
    const arr = JSON.parse(raw);
    if(Array.isArray(arr)) state.projects = arr.filter(p => p && typeof p === 'object' && p.id);
  }
} catch(e){ console.warn('projects parse error:', e); }

const saveProjects = () => localStorage.setItem('spw.projects', JSON.stringify(state.projects));
const savePalette  = () => localStorage.setItem('spw.palette',  JSON.stringify(state.palette));
const saveBrushes  = () => localStorage.setItem('spw.brushes',   JSON.stringify(state.brushes));

/* ============================================================
   BRUSHES
   ============================================================ */
const DEFAULT_BRUSHES = [
  { id:'soft-round',   name:'Мягкая',           cat:'soft',    desc:'мягкая круглая',   shape:'circle', size:30,  sizeMin:1, sizeMax:3000, hard:0.15, opacity:0.9, flow:0.6, smooth:0.55, scatter:0,  pressureSize:true, pressureOpac:true, tex:'none',    type:'soft',    startSize:100, endSize:100, startOpacity:100, endOpacity:100 },
  { id:'hard-round',   name:'Твёрдая',          cat:'basic',   desc:'твёрдая круглая',  shape:'circle', size:12,  sizeMin:1, sizeMax:3000, hard:1.0,  opacity:1,   flow:1,   smooth:0.45, scatter:0,  pressureSize:true, pressureOpac:false,tex:'none',    type:'hard',    startSize:100, endSize:100, startOpacity:100, endOpacity:100 },
  { id:'default',      name:'Обычная',          cat:'basic',   desc:'универсальная',    shape:'circle', size:14,  sizeMin:1, sizeMax:3000, hard:0.85, opacity:1,   flow:1,   smooth:0.55, scatter:0,  pressureSize:true, pressureOpac:false,tex:'none',    type:'normal',  startSize:100, endSize:100, startOpacity:100, endOpacity:100 },
  { id:'soft-edge',    name:'Мягкий край',      cat:'soft',    desc:'мягкие края',      shape:'circle', size:26,  sizeMin:1, sizeMax:3000, hard:0.3,  opacity:0.9, flow:0.7, smooth:0.6,  scatter:0,  pressureSize:true, pressureOpac:true, tex:'none',    type:'soft',    startSize:100, endSize:100, startOpacity:100, endOpacity:100 },
  { id:'airbrush',     name:'Аэрограф',         cat:'soft',    desc:'для распыления',   shape:'circle', size:60,  sizeMin:1, sizeMax:3000, hard:0.05, opacity:0.35,flow:0.3, smooth:0.6,  scatter:10, pressureSize:false,pressureOpac:true, tex:'none',    type:'soft',    startSize:100, endSize:100, startOpacity:100, endOpacity:100 },
  { id:'ink',          name:'Перо',             cat:'ink',     desc:'плотная линия',    shape:'circle', size:6,   sizeMin:1, sizeMax:3000, hard:1.0,  opacity:1,   flow:1,   smooth:0.3,  scatter:0,  pressureSize:true, pressureOpac:false,tex:'none',    type:'hard',    startSize:100, endSize:100, startOpacity:100, endOpacity:100 },
  { id:'pencil',       name:'Карандаш',         cat:'basic',   desc:'графитный',        shape:'circle', size:4,   sizeMin:1, sizeMax:3000, hard:0.9,  opacity:0.9, flow:0.9, smooth:0.4,  scatter:14, pressureSize:true, pressureOpac:true, tex:'noise',   type:'texture', startSize:100, endSize:100, startOpacity:100, endOpacity:100 },
  { id:'chalk',        name:'Мел',              cat:'texture', desc:'шершавый',         shape:'circle', size:14,  sizeMin:1, sizeMax:3000, hard:0.8,  opacity:0.9, flow:0.85,smooth:0.4,  scatter:20, pressureSize:true, pressureOpac:true, tex:'chalk',   type:'texture', startSize:100, endSize:100, startOpacity:100, endOpacity:100 },
  { id:'marker',       name:'Маркер',           cat:'marker',  desc:'полупрозрачный',   shape:'circle', size:22,  sizeMin:1, sizeMax:3000, hard:0.9,  opacity:0.6, flow:0.7, smooth:0.35, scatter:0,  pressureSize:false,pressureOpac:false,tex:'none',    type:'normal',  startSize:100, endSize:100, startOpacity:100, endOpacity:100 },
  { id:'eraser-soft',  name:'Ластик мягкий',    cat:'soft',    desc:'мягкое стирание',  shape:'circle', size:30,  sizeMin:1, sizeMax:3000, hard:0.4,  opacity:1,   flow:1,   smooth:0.5,  scatter:0,  pressureSize:true, pressureOpac:true, tex:'none',    type:'soft',    startSize:100, endSize:100, startOpacity:100, endOpacity:100 },
  { id:'eraser-hard',  name:'Ластик',           cat:'basic',   desc:'точный ластик',    shape:'circle', size:20,  sizeMin:1, sizeMax:3000, hard:1.0,  opacity:1,   flow:1,   smooth:0.3,  scatter:0,  pressureSize:true, pressureOpac:false,tex:'none',    type:'hard',    startSize:100, endSize:100, startOpacity:100, endOpacity:100 },
];
if(!state.brushes || !Array.isArray(state.brushes) || state.brushes.length === 0){
  state.brushes = DEFAULT_BRUSHES.map(b => ({...b}));
  saveBrushes();
}

function getCurrentBrush(){
  let b = state.brushes.find(x => x.id === state.currentBrushId);
  if(!b){ b = state.brushes[0]; state.currentBrushId = b.id; localStorage.setItem('spw.currentBrushId', b.id); }
  if(b.sizeMin == null) b.sizeMin = 1;
  if(b.sizeMax == null) b.sizeMax = 3000;
  if(b.startSize == null) b.startSize = 100;
  if(b.endSize == null) b.endSize = 100;
  if(b.startOpacity == null) b.startOpacity = 100;
  if(b.endOpacity == null) b.endOpacity = 100;
  if(b.type == null) b.type = 'normal';
  return b;
}

/* ============================================================
   AUTH
   ============================================================ */
let authMode = 'login';
function switchAuthTab(mode){
  authMode = mode;
  $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  const isReg = mode === 'register';
  if($('authEmailField')) $('authEmailField').style.display = isReg ? 'flex' : 'none';
  if($('authSubmit')) $('authSubmit').textContent = isReg ? 'Зарегистрироваться' : 'Войти';
  clearAuthErrors();
}
function clearAuthErrors(){
  ['authUsernameErr','authEmailErr','authPasswordErr'].forEach(id => {
    const el = $(id); if(el) el.textContent = '';
  });
  const m = $('authMsg'); if(m){ m.className = 'auth-msg'; m.textContent = ''; }
}
function showAuthError(msg){
  const m = $('authMsg'); if(!m) return;
  m.className = 'auth-msg err'; m.textContent = msg;
}
$$('.auth-tab').forEach(t => t.onclick = () => switchAuthTab(t.dataset.mode));

if($('authForm')){
  $('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    clearAuthErrors();
    const username = $('authUsername').value.trim();
    const password = $('authPassword').value;
    const email    = $('authEmail').value.trim();
    let bad = false;
    if(username.length < 3){ $('authUsernameErr').textContent = 'Минимум 3 символа'; bad = true; }
    if(password.length < 6){ $('authPasswordErr').textContent = 'Минимум 6 символов'; bad = true; }
    if(authMode === 'register' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
      $('authEmailErr').textContent = 'Некорректный email'; bad = true;
    }
    if(bad) return;
    $('authSubmit').disabled = true;
    $('authSubmit').textContent = authMode === 'register' ? 'Создание...' : 'Вход...';
    try {
      const path = authMode === 'register' ? '/auth/register' : '/auth/login';
      const body = authMode === 'register'
        ? { username, password, email, displayName: username }
        : { username, password };
      const data = await api(path, { method: 'POST', body: JSON.stringify(body) });
      state.user = data.user; state.token = data.token;
      localStorage.setItem('spw.token', data.token);
      updateUserUI(); closeModal('modalAuth'); renderGalleryScreen();
      toast('Добро пожаловать, ' + (data.user.displayName || data.user.username), 'success');
    } catch(err){
      showAuthError(err.data?.error || err.message || 'Ошибка');
    } finally {
      $('authSubmit').disabled = false;
      $('authSubmit').textContent = authMode === 'register' ? 'Зарегистрироваться' : 'Войти';
    }
  });
}
if($('authGuest')) $('authGuest').onclick = () => {
  state.user = null; state.token = null;
  localStorage.removeItem('spw.token');
  updateUserUI(); closeModal('modalAuth'); renderGalleryScreen();
};

function updateUserUI(){
  const u = state.user;
  const name = u ? (u.displayName || u.username) : 'Гость';
  const initial = name.charAt(0).toUpperCase();
  if($('userAvatar'))   $('userAvatar').textContent = initial;
  if($('userName'))     $('userName').textContent = name;
  if($('userBadge'))    $('userBadge').classList.toggle('hidden', !u?.isAdmin);
  if($('profileAvatarBig')) $('profileAvatarBig').textContent = initial;
  if(u){
    if($('profUsername')) $('profUsername').value = u.username;
    if($('profName'))     $('profName').value = u.displayName || u.username;
    if($('profBio'))      $('profBio').value = u.bio || '';
    if($('profEmail'))    $('profEmail').value = u.email || '';
  }
}
window.updateUserUI = updateUserUI;

/* ============================================================
   MODALS
   ============================================================ */
const modalStack = [];
function openModal(id){
  const el = $(id);
  if(!el || el.classList.contains('open')) return;
  el.classList.add('open');
  modalStack.push(id);
}
function closeModal(id){
  const el = $(id); if(!el) return;
  el.classList.remove('open');
  const idx = modalStack.lastIndexOf(id);
  if(idx >= 0) modalStack.splice(idx, 1);
}
function closeTopModal(){
  const id = modalStack.pop();
  if(id) $(id)?.classList.remove('open');
}
window.openModal = openModal;
window.closeModal = closeModal;

document.addEventListener('click', e => {
  const closeBtn = e.target.closest('[data-close]');
  if(closeBtn){
    const modal = closeBtn.closest('.modal-overlay');
    if(modal) closeModal(modal.id);
  }
  // Окна с data-modal-keep не закрываются кликом по фону.
  if(e.target.classList && e.target.classList.contains('modal-overlay')){
    if(e.target.hasAttribute('data-modal-keep')) return;
    closeModal(e.target.id);
  }
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && modalStack.length){
    const topId = modalStack[modalStack.length-1];
    if(topId === 'modalBrushes' || topId === 'modalBrushEdit') return;
    e.preventDefault();
    closeTopModal();
  }
});

/* ============================================================
   WEBGL
   ============================================================ */
const canvas = $('glCanvas');
const gl = canvas.getContext('webgl2', {
  antialias:false, alpha:false, depth:false, stencil:false,
  premultipliedAlpha:false, preserveDrawingBuffer:false,
  powerPreference:'high-performance'
}) || canvas.getContext('webgl', {
  antialias:false, alpha:false, depth:false, stencil:false, premultipliedAlpha:false
});
if(!gl){ alert('WebGL не поддерживается'); throw new Error('no webgl'); }
const isGL2 = gl instanceof WebGL2RenderingContext;
log('WebGL', isGL2 ? '2' : '1');

/* ============================================================
   SHADERS
   ============================================================ */
const VS_QUAD = isGL2 ? `#version 300 es
in vec2 a_pos; in vec2 a_uv;
out vec2 v_uv;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); v_uv = a_uv; }`
: `attribute vec2 a_pos; attribute vec2 a_uv;
varying vec2 v_uv;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); v_uv = a_uv; }`;

const FS_QUAD = isGL2 ? `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_mask;
uniform int u_useMask;
uniform float u_opacity;
out vec4 outColor;
void main(){
  vec4 c = texture(u_tex, v_uv);
  float a = c.a;
  if(u_useMask == 1){ a *= texture(u_mask, v_uv).r; }
  outColor = vec4(c.rgb, a * u_opacity);
}` : `precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_mask;
uniform int u_useMask;
uniform float u_opacity;
void main(){
  vec4 c = texture2D(u_tex, v_uv);
  float a = c.a;
  if(u_useMask == 1){ a *= texture2D(u_mask, v_uv).r; }
  gl_FragColor = vec4(c.rgb, a * u_opacity);
}`;

const VS_BRUSH = isGL2 ? `#version 300 es
in vec2 a_corner;
uniform mat3 u_matrix;
uniform vec2 u_center;
uniform float u_size;
out vec2 v_corner;
void main(){
  vec2 world = u_center + a_corner * (u_size * 0.5);
  vec3 p = u_matrix * vec3(world, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  v_corner = a_corner * 0.5 + 0.5;
}` : `attribute vec2 a_corner;
uniform mat3 u_matrix;
uniform vec2 u_center;
uniform float u_size;
varying vec2 v_corner;
void main(){
  vec2 world = u_center + a_corner * (u_size * 0.5);
  vec3 p = u_matrix * vec3(world, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  v_corner = a_corner * 0.5 + 0.5;
}`;

const FS_BRUSH = isGL2 ? `#version 300 es
precision highp float;
in vec2 v_corner;
uniform vec4 u_color;
uniform float u_hardness;
uniform float u_flow;
uniform int u_shape;
uniform float u_texDensity;
out vec4 outColor;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float shapeAlpha(vec2 p, float hard){
  if(u_shape == 0){
    float d = length(p - 0.5) * 2.0;
    if(d <= hard) return 1.0;
    if(d >= 1.0) return 0.0;
    return 1.0 - (d - hard) / max(0.001, 1.0 - hard);
  } else if(u_shape == 1){
    vec2 q = abs(p - 0.5) * 2.0;
    float s = max(q.x, q.y);
    if(s <= hard) return 1.0;
    if(s >= 1.0) return 0.0;
    return 1.0 - (s - hard) / max(0.001, 1.0 - hard);
  } else {
    vec2 q = abs(p - 0.5) * 2.0;
    float s = q.x + q.y;
    if(s <= hard) return 1.0;
    if(s >= 1.0) return 0.0;
    return 1.0 - (s - hard) / max(0.001, 1.0 - hard);
  }
}
void main(){
  vec2 p = v_corner;
  float a = shapeAlpha(p, u_hardness);
  if(u_texDensity > 0.0){
    float n = hash(floor(p * 200.0));
    a *= mix(1.0, n, u_texDensity);
  }
  a *= u_flow;
  if(a < 0.003) discard;
  outColor = vec4(u_color.rgb, u_color.a * a);
}` : `precision highp float;
varying vec2 v_corner;
uniform vec4 u_color;
uniform float u_hardness;
uniform float u_flow;
uniform int u_shape;
uniform float u_texDensity;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float shapeAlpha(vec2 p, float hard){
  if(u_shape == 0){
    float d = length(p - 0.5) * 2.0;
    if(d <= hard) return 1.0;
    if(d >= 1.0) return 0.0;
    return 1.0 - (d - hard) / max(0.001, 1.0 - hard);
  } else if(u_shape == 1){
    vec2 q = abs(p - 0.5) * 2.0;
    float s = max(q.x, q.y);
    if(s <= hard) return 1.0;
    if(s >= 1.0) return 0.0;
    return 1.0 - (s - hard) / max(0.001, 1.0 - hard);
  } else {
    vec2 q = abs(p - 0.5) * 2.0;
    float s = q.x + q.y;
    if(s <= hard) return 1.0;
    if(s >= 1.0) return 0.0;
    return 1.0 - (s - hard) / max(0.001, 1.0 - hard);
  }
}
void main(){
  vec2 p = v_corner;
  float a = shapeAlpha(p, u_hardness);
  if(u_texDensity > 0.0){
    float n = hash(floor(p * 200.0));
    a *= mix(1.0, n, u_texDensity);
  }
  a *= u_flow;
  if(a < 0.003) discard;
  gl_FragColor = vec4(u_color.rgb, u_color.a * a);
}`;

function compileShader(type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
    console.error('Shader error:', gl.getShaderInfoLog(s));
    throw new Error('shader');
  }
  return s;
}
function linkProgram(vs, fs){
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
    console.error('Link error:', gl.getProgramInfoLog(p));
    throw new Error('program');
  }
  return p;
}
const progQuad  = linkProgram(compileShader(gl.VERTEX_SHADER, VS_QUAD),  compileShader(gl.FRAGMENT_SHADER, FS_QUAD));
const progBrush = linkProgram(compileShader(gl.VERTEX_SHADER, VS_BRUSH), compileShader(gl.FRAGMENT_SHADER, FS_BRUSH));

const L = {
  quad: {
    a_pos: gl.getAttribLocation(progQuad, 'a_pos'),
    a_uv:  gl.getAttribLocation(progQuad, 'a_uv'),
    u_tex: gl.getUniformLocation(progQuad, 'u_tex'),
    u_mask: gl.getUniformLocation(progQuad, 'u_mask'),
    u_useMask: gl.getUniformLocation(progQuad, 'u_useMask'),
    u_opacity: gl.getUniformLocation(progQuad, 'u_opacity'),
  },
  brush: {
    a_corner:   gl.getAttribLocation(progBrush, 'a_corner'),
    u_matrix:   gl.getUniformLocation(progBrush, 'u_matrix'),
    u_center:   gl.getUniformLocation(progBrush, 'u_center'),
    u_size:     gl.getUniformLocation(progBrush, 'u_size'),
    u_color:    gl.getUniformLocation(progBrush, 'u_color'),
    u_hardness: gl.getUniformLocation(progBrush, 'u_hardness'),
    u_flow:     gl.getUniformLocation(progBrush, 'u_flow'),
    u_shape:    gl.getUniformLocation(progBrush, 'u_shape'),
    u_texDensity: gl.getUniformLocation(progBrush, 'u_texDensity'),
  }
};

/* ============================================================
   BUFFERS
   ============================================================ */
const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1,-1, 0,1,  1,-1, 1,1,  -1,1, 0,0,
  -1, 1, 0,0,  1,-1, 1,1,   1,1, 1,0
]), gl.STATIC_DRAW);

const brushBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, brushBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1,-1,  1,-1,  -1,1,
  -1, 1,  1,-1,   1,1
]), gl.STATIC_DRAW);

const whiteTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, whiteTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
  new Uint8Array([255,255,255,255]));
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

/* ============================================================
   SCENE STATE
   ============================================================ */
let canvasW = 1280, canvasH = 960;
let zoom = 1, panX = 0, panY = 0;
let dpr = 1;

let project = null;
let projIndex = -1;
let layers = [];
let activeLayer = 0;
let history = [], histIndex = -1;
const MAX_HISTORY = 30;

let tool = 'brush';
let color = '#7C5CFF';
let size = 12, opacity = 1, hardness = 0.7, flow = 1, smoothing = 0.55;

let drawing = false, panning = false, spaceDown = false;
let panStartX = 0, panStartY = 0;
let currentPressure = 0.5;
let stylusDetected = false;

let smoothX = 0, smoothY = 0, targetX = 0, targetY = 0;
let strokePoints = [];
let lastStampX = 0, lastStampY = 0, hasLastStamp = false;

let selection = null;
let selectionStart = null;
let lassoPoints = [];
let isSelecting = false;

let clipboard = null;
let currentHue = 250, currentSat = 0.5, currentVal = 1;
let actionHistory = [{ name: 'Открытие', time: Date.now() }];

/* ============================================================
   FBO
   ============================================================ */
function createLayerFBO(w, h){
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo };
}

function createMaskFBO(w, h, fill = 1.0){
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const px = new Uint8Array(w * h);
  px.fill(fill * 255);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, px);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.LUMINANCE, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo };
}

/* ============================================================
   RENDER
   ============================================================ */
let rafPending = false;
let renderLoopActive = false;
let lastFpsTime = 0, fpsCounter = 0;

function requestRender(){
  if(rafPending) return;
  rafPending = true;
  requestAnimationFrame(renderFrame);
}
window.requestRender = requestRender;

function startRenderLoop(){
  if(renderLoopActive) return;
  renderLoopActive = true;
  requestRender();
}
window.startRenderLoop = startRenderLoop;

function renderFrame(){
  rafPending = false;
  fpsCounter++;
  const t = now();
  if(t - lastFpsTime > 500){
    const fps = Math.round(fpsCounter * 1000 / (t - lastFpsTime));
    fpsCounter = 0; lastFpsTime = t;
    const el = $('fps');
    if(el){
      el.textContent = fps + ' FPS';
      el.style.color = fps >= 50 ? 'var(--ok)' : fps >= 30 ? 'var(--warn)' : 'var(--danger)';
    }
  }
  try {
    syncCanvasSize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0.1, 0.1, 0.14, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if(project && layers.length) renderScene();
  } catch(err){
    console.error('[renderFrame]', err);
  }
  if(renderLoopActive) requestRender();
}

function syncCanvasSize(){
  const stageEl = $('stage');
  if(!stageEl) return;
  const rect = stageEl.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if(canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  const ov = $('stageOverlay');
  if(ov){
    if(ov.width !== Math.floor(rect.width) || ov.height !== Math.floor(rect.height)){
      ov.width  = Math.floor(rect.width);
      ov.height = Math.floor(rect.height);
    }
    ov.style.width  = rect.width  + 'px';
    ov.style.height = rect.height + 'px';
  }
}

const sceneBounds = { x0:-1, y0:-1, x1:1, y1:1 };

function renderScene(){
  const stageW = canvas.width / dpr;
  const stageH = canvas.height / dpr;
  const ox = stageW * 0.5 + panX - canvasW * 0.5 * zoom;
  const oy = stageH * 0.5 + panY - canvasH * 0.5 * zoom;
  const ex = ox + canvasW * zoom;
  const ey = oy + canvasH * zoom;

  sceneBounds.x0 = ox / stageW * 2 - 1;
  sceneBounds.y0 = 1 - oy / stageH * 2;
  sceneBounds.x1 = ex / stageW * 2 - 1;
  sceneBounds.y1 = 1 - ey / stageH * 2;

  drawQuad(whiteTex, null, false, 1.0, 'normal');

  for(let i = 0; i < layers.length; i++){
    const Lr = layers[i];
    if(!Lr || !Lr.visible || Lr.opacity <= 0 || !Lr.tex) continue;
    drawQuad(Lr.tex, Lr.maskTex, Lr.hasMask, Lr.opacity, Lr.blend);
  }
}

function drawQuad(tex, maskTex, useMask, op, blendMode){
  const b = sceneBounds;
  const cx = (b.x0 + b.x1) * 0.5;
  const cy = (b.y0 + b.y1) * 0.5;
  const sx = (b.x1 - b.x0) * 0.5;
  const sy = (b.y1 - b.y0) * 0.5;
  const verts = new Float32Array([
    cx - sx, cy - sy, 0, 1,
    cx + sx, cy - sy, 1, 1,
    cx - sx, cy + sy, 0, 0,
    cx - sx, cy + sy, 0, 0,
    cx + sx, cy - sy, 1, 1,
    cx + sx, cy + sy, 1, 0
  ]);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
  gl.useProgram(progQuad);
  gl.enableVertexAttribArray(L.quad.a_pos);
  gl.vertexAttribPointer(L.quad.a_pos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(L.quad.a_uv);
  gl.vertexAttribPointer(L.quad.a_uv, 2, gl.FLOAT, false, 16, 8);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(L.quad.u_tex, 0);
  if(useMask && maskTex){
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.uniform1i(L.quad.u_mask, 1);
    gl.uniform1i(L.quad.u_useMask, 1);
  } else {
    gl.uniform1i(L.quad.u_useMask, 0);
  }
  gl.uniform1f(L.quad.u_opacity, op);
  gl.enable(gl.BLEND);
  switch(blendMode){
    case 'multiply': gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); break;
    case 'screen':   gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
    default:         gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.disableVertexAttribArray(L.quad.a_pos);
  gl.disableVertexAttribArray(L.quad.a_uv);
}

/* ============================================================
   VIEW
   ============================================================ */
function fitToScreen(){
  const rect = $('stage').getBoundingClientRect();
  if(rect.width < 10 || rect.height < 10){ requestAnimationFrame(fitToScreen); return; }
  const sx = rect.width / canvasW;
  const sy = rect.height / canvasH;
  zoom = Math.min(sx, sy) * 0.9;
  panX = 0; panY = 0;
  updateZoomLabel();
  drawOverlay();
}
window.fitToScreen = fitToScreen;

function zoomBy(delta){
  const old = zoom;
  zoom = clamp(zoom + delta, 0.05, 20);
  const k = zoom / old;
  panX *= k; panY *= k;
  updateZoomLabel();
  drawOverlay();
}
window.zoomBy = zoomBy;
function updateZoomLabel(){
  const el = $('zoomLabel');
  if(el) el.textContent = Math.round(zoom * 100) + '%';
}

function screenToCanvas(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  const stageW = rect.width, stageH = rect.height;
  const dx = (clientX - rect.left) - stageW * 0.5 - panX;
  const dy = (clientY - rect.top)  - stageH * 0.5 - panY;
  return { x: dx / zoom + canvasW * 0.5, y: dy / zoom + canvasH * 0.5 };
}
function canvasToScreen(x, y){
  const rect = canvas.getBoundingClientRect();
  const stageW = rect.width, stageH = rect.height;
  return {
    x: (x - canvasW * 0.5) * zoom + stageW * 0.5 + panX,
    y: (y - canvasH * 0.5) * zoom + stageH * 0.5 + panY
  };
}

/* ============================================================
   OVERLAY (рисование выделения, лассо, курсора)
   ============================================================ */
const overlay = $('stageOverlay');
const oCtx = overlay.getContext('2d');
let marchingOffset = 0, marchingLoopActive = false;

function drawOverlay(){
  if(!oCtx) return;
  oCtx.clearRect(0, 0, overlay.width, overlay.height);

  // 1. Выделение
  if(selection){
    oCtx.save();
    oCtx.strokeStyle = '#ffffff';
    oCtx.lineWidth = 1.4;
    oCtx.setLineDash([5, 5]);
    oCtx.lineDashOffset = -marchingOffset;
    oCtx.shadowColor = 'rgba(0,0,0,0.9)';
    oCtx.shadowBlur = 3;

    if(selection.type === 'rect'){
      const p1 = canvasToScreen(selection.x, selection.y);
      const p2 = canvasToScreen(selection.x + selection.w, selection.y + selection.h);
      oCtx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    }
    oCtx.restore();
  }

  // 2. Лассо в процессе рисования
  if(lassoPoints.length > 0){
    oCtx.save();
    oCtx.strokeStyle = '#ffdd55';
    oCtx.lineWidth = 1.6;
    oCtx.shadowColor = 'rgba(0,0,0,0.9)';
    oCtx.shadowBlur = 3;
    oCtx.beginPath();
    lassoPoints.forEach((pt, i) => {
      const s = canvasToScreen(pt.x, pt.y);
      if(i === 0) oCtx.moveTo(s.x, s.y); else oCtx.lineTo(s.x, s.y);
    });
    oCtx.stroke();

    // Точки-вершины
    oCtx.fillStyle = '#fff';
    lassoPoints.forEach(pt => {
      const s = canvasToScreen(pt.x, pt.y);
      oCtx.beginPath();
      oCtx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
      oCtx.fill();
    });
    oCtx.restore();
  }

  if(!marchingLoopActive){
    marchingLoopActive = true;
    requestAnimationFrame(marchLoop);
  }
}

function marchLoop(){
  if(!selection && lassoPoints.length === 0){ marchingLoopActive = false; return; }
  marchingOffset = (marchingOffset + 0.6) % 8;
  drawOverlay();
  requestAnimationFrame(marchLoop);
}

/* ============================================================
   POINTER EVENTS — теперь на overlay
   ============================================================ */
function pointerDown(e){
  if(e.pointerType === 'pen'){ stylusDetected = true; }
  log('tool=', tool, 'down at', e.clientX, e.clientY);

  if(e.button === 1 || spaceDown){
    panning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
    overlay.setPointerCapture(e.pointerId);
    return;
  }
  if(e.button !== 0 && e.button !== -1) return;
  if(!project) return;
  overlay.setPointerCapture(e.pointerId);

  const p = screenToCanvas(e.clientX, e.clientY);
  currentPressure = (e.pressure != null && e.pressure > 0 && e.pressure < 1) ? e.pressure : 1;

  if(tool === 'picker'){ pickColorAt(p.x, p.y); return; }
  if(tool === 'fill'){ doFloodFill(p.x, p.y); return; }
  if(tool === 'wand'){ doMagicWand(p.x, p.y); return; }

  if(tool === 'select'){
    isSelecting = true;
    selectionStart = p;
    selection = { type:'rect', x:p.x, y:p.y, w:0, h:0 };
    drawOverlay();
    return;
  }
  if(tool === 'lasso'){
    isSelecting = true;
    lassoPoints = [p];
    selection = null;
    drawOverlay();
    return;
  }

  if(tool === 'brush' || tool === 'pencil' || tool === 'eraser'){
    drawing = true;
    strokePoints = [{ x:p.x, y:p.y, pressure:currentPressure }];
    smoothX = p.x; smoothY = p.y; targetX = p.x; targetY = p.y;
    hasLastStamp = false;
    const brush = getCurrentBrush();
    const rgb = hexToRgb(color);
    const sz = clamp(brush.size * (brush.pressureSize ? (0.35+0.65*currentPressure) : 1), brush.sizeMin, brush.sizeMax);
    drawSingleDab(p.x, p.y, sz, brush, rgb, tool === 'eraser');
    hasLastStamp = true;
    lastStampX = p.x; lastStampY = p.y;
    return;
  }
}

function pointerMove(e){
  if(panning){
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
    drawOverlay();
    return;
  }

  const p = screenToCanvas(e.clientX, e.clientY);
  if(e.pressure != null && e.pressure > 0 && e.pressure < 1) currentPressure = e.pressure;

  if(isSelecting){
    if(tool === 'select'){
      selection.x = Math.min(selectionStart.x, p.x);
      selection.y = Math.min(selectionStart.y, p.y);
      selection.w = Math.abs(p.x - selectionStart.x);
      selection.h = Math.abs(p.y - selectionStart.y);
    } else if(tool === 'lasso'){
      lassoPoints.push(p);
    }
    drawOverlay();
    return;
  }

  if(!drawing) return;

  if(tool === 'brush' || tool === 'pencil' || tool === 'eraser'){
    targetX = p.x; targetY = p.y;
    const factor = 1 - smoothing * 0.85;
    smoothX += (targetX - smoothX) * factor;
    smoothY += (targetY - smoothY) * factor;

    strokePoints.push({ x: smoothX, y: smoothY, pressure: currentPressure });
    if(strokePoints.length > 4000) strokePoints.splice(0, 1000);

    const brush = getCurrentBrush();
    const rgb = hexToRgb(color);
    drawBrushStroke(brush, rgb, tool === 'eraser');
  }
}

function pointerUp(){
  if(panning){ panning = false; return; }

  if(isSelecting){
    isSelecting = false;
    if(tool === 'lasso' && lassoPoints.length >= 3){
      // Растеризация полигона в маску
      const w = window.PolyMaskWorker();
      w.onmessage = ev => {
        const mask = new Uint8Array(ev.data.mask);
        const bbox = ev.data.bbox;
        selection = { type:'mask', mask, bbox };
        lassoPoints = [];
        drawOverlay();
        w.terminate();
      };
      w.postMessage({
        W: canvasW, H: canvasH,
        points: lassoPoints.map(p => ({ x:p.x, y:p.y }))
      });
    } else if(tool === 'select'){
      if(selection && (selection.w < 2 || selection.h < 2)) selection = null;
      drawOverlay();
    }
    return;
  }

  if(!drawing) return;
  drawing = false;

  if(tool === 'brush' || tool === 'pencil' || tool === 'eraser'){
    strokePoints = [];
    hasLastStamp = false;
    const brushName = getCurrentBrush().name;
    pushActionHistory((tool === 'eraser') ? 'Стирание' : brushName);
    pushHistory();
    updateThumb();
  }
}

overlay.addEventListener('pointerdown', pointerDown);
overlay.addEventListener('pointermove', pointerMove);
overlay.addEventListener('pointerup', pointerUp);
overlay.addEventListener('pointercancel', pointerUp);
overlay.addEventListener('pointerleave', pointerUp);
overlay.addEventListener('contextmenu', e => e.preventDefault());

overlay.addEventListener('wheel', e => {
  if(!project) return;
  e.preventDefault();
  const rect = overlay.getBoundingClientRect();
  const mx = e.clientX - rect.left - rect.width * 0.5;
  const my = e.clientY - rect.top  - rect.height * 0.5;
  const factor = Math.exp(-e.deltaY * 0.0015);
  const newZoom = clamp(zoom * factor, 0.05, 20);
  const cx = (mx - panX) / zoom + canvasW * 0.5;
  const cy = (my - panY) / zoom + canvasH * 0.5;
  zoom = newZoom;
  panX = mx - (cx - canvasW * 0.5) * zoom;
  panY = my - (cy - canvasH * 0.5) * zoom;
  updateZoomLabel();
  drawOverlay();
}, { passive:false });

/* ============================================================
   BRUSH DRAWING
   ============================================================ */
function catmullX(p0, p1, p2, p3, t){
  const t2 = t*t, t3 = t2*t;
  return 0.5 * ((2*p1) + (-p0 + p2)*t + (2*p0 - 5*p1 + 4*p2 - p3)*t2 + (-p0 + 3*p1 - 3*p2 + p3)*t3);
}

function drawBrushStroke(brush, rgb, isEraser){
  const Lr = layers[activeLayer];
  if(!Lr) return;
  if(strokePoints.length < 2) return;

  gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
  gl.viewport(0, 0, canvasW, canvasH);
  gl.enable(gl.BLEND);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, canvasW, canvasH);

  if(isEraser){
    gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
  } else if(Lr.lockAlpha){
    gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  } else {
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  gl.useProgram(progBrush);
  const fboMat = new Float32Array([2/canvasW, 0, 0, 0, -2/canvasH, 0, -1, 1, 1]);
  gl.uniformMatrix3fv(L.brush.u_matrix, false, fboMat);

  gl.bindBuffer(gl.ARRAY_BUFFER, brushBuffer);
  gl.enableVertexAttribArray(L.brush.a_corner);
  gl.vertexAttribPointer(L.brush.a_corner, 2, gl.FLOAT, false, 0, 0);

  const shapeMap = { circle:0, square:1, diamond:2 };
  const texMap = { none:0.0, noise:0.4, chalk:0.6, bristle:0.3 };

  gl.uniform4f(L.brush.u_color, rgb[0]/255, rgb[1]/255, rgb[2]/255, 1);
  gl.uniform1f(L.brush.u_hardness, brush.hard);
  gl.uniform1i(L.brush.u_shape, shapeMap[brush.shape] ?? 0);
  gl.uniform1f(L.brush.u_texDensity, texMap[brush.tex] ?? 0);

  const totalPts = strokePoints.length;
  for(let i = 0; i < totalPts - 1; i++){
    const p0 = strokePoints[Math.max(0, i-1)];
    const p1 = strokePoints[i];
    const p2 = strokePoints[i+1];
    const p3 = strokePoints[Math.min(totalPts-1, i+2)];
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const stepSize = Math.max(0.5, brush.size * 0.12);
    const segs = Math.max(1, Math.ceil(dist / stepSize));

    const tGlobal = (i + 0.5) / Math.max(1, totalPts - 1);
    const startF = 1 - (1 - brush.startSize/100) * Math.min(1, tGlobal * 3);
    const endF = 1 - (1 - brush.endSize/100) * Math.max(0, tGlobal * 3 - 2);
    const sizeMult = startF * endF;

    const opStartF = brush.startOpacity/100 + (1 - brush.startOpacity/100) * Math.min(1, tGlobal * 3);
    const opEndF = 1 - (1 - brush.endOpacity/100) * Math.max(0, tGlobal * 3 - 2);
    const opacityMult = opStartF * opEndF;

    for(let s = 0; s <= segs; s++){
      const t = s / segs;
      const x = catmullX(p0.x, p1.x, p2.x, p3.x, t);
      const y = catmullX(p0.y, p1.y, p2.y, p3.y, t);
      const pr = p1.pressure + (p2.pressure - p1.pressure) * t;

      if(hasLastStamp){
        const d = Math.hypot(x - lastStampX, y - lastStampY);
        const minStep = Math.max(0.6, brush.size * 0.08);
        if(d < minStep) continue;
      }

      const pSize = brush.pressureSize ? (0.35 + 0.65*pr) : 1;
      const pOpac = brush.pressureOpac ? (0.35 + 0.65*pr) : 1;
      let sz = brush.size * pSize * sizeMult;
      sz = clamp(sz, brush.sizeMin || 1, brush.sizeMax || 3000);
      const fl = clamp(brush.opacity * brush.flow * pOpac * opacityMult, 0, 1);

      gl.uniform1f(L.brush.u_flow, fl);
      gl.uniform1f(L.brush.u_size, sz);
      gl.uniform2f(L.brush.u_center, x, y);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      lastStampX = x; lastStampY = y; hasLastStamp = true;
    }
  }

  gl.disableVertexAttribArray(L.brush.a_corner);
  gl.disable(gl.SCISSOR_TEST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function drawSingleDab(x, y, sz, brush, rgb, isEraser){
  const Lr = layers[activeLayer];
  if(!Lr) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
  gl.viewport(0, 0, canvasW, canvasH);
  gl.enable(gl.BLEND);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, canvasW, canvasH);

  if(isEraser){
    gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
  } else if(Lr.lockAlpha){
    gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  } else {
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  gl.useProgram(progBrush);
  const fboMat = new Float32Array([2/canvasW, 0, 0, 0, -2/canvasH, 0, -1, 1, 1]);
  gl.uniformMatrix3fv(L.brush.u_matrix, false, fboMat);

  gl.bindBuffer(gl.ARRAY_BUFFER, brushBuffer);
  gl.enableVertexAttribArray(L.brush.a_corner);
  gl.vertexAttribPointer(L.brush.a_corner, 2, gl.FLOAT, false, 0, 0);

  const shapeMap = { circle:0, square:1, diamond:2 };
  const texMap = { none:0.0, noise:0.4, chalk:0.6, bristle:0.3 };

  gl.uniform4f(L.brush.u_color, rgb[0]/255, rgb[1]/255, rgb[2]/255, 1);
  gl.uniform1f(L.brush.u_hardness, brush.hard);
  gl.uniform1i(L.brush.u_shape, shapeMap[brush.shape] ?? 0);
  gl.uniform1f(L.brush.u_texDensity, texMap[brush.tex] ?? 0);
  gl.uniform1f(L.brush.u_flow, brush.opacity * brush.flow);
  gl.uniform1f(L.brush.u_size, clamp(sz, brush.sizeMin||1, brush.sizeMax||3000));
  gl.uniform2f(L.brush.u_center, x, y);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.disableVertexAttribArray(L.brush.a_corner);
  gl.disable(gl.SCISSOR_TEST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/* ============================================================
   PICKER / FILL / WAND
   ============================================================ */
function pickColorAt(x, y){
  const Lr = layers[activeLayer]; if(!Lr) return;
  x = Math.floor(x); y = Math.floor(y);
  if(x < 0 || y < 0 || x >= canvasW || y >= canvasH) return;
  const py = canvasH - y - 1;
  gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
  const buf = new Uint8Array(4);
  gl.readPixels(x, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if(buf[3] === 0) return;
  setColor(rgbToHex(buf[0], buf[1], buf[2]));
}

function doFloodFill(x, y){
  const Lr = layers[activeLayer]; if(!Lr) return;
  x = Math.floor(x); y = Math.floor(y);
  if(x < 0 || y < 0 || x >= canvasW || y >= canvasH) return;
  setStatus('Заливка...');
  gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
  const pixels = new Uint8Array(canvasW * canvasH * 4);
  gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const flippedY = canvasH - y - 1;
  const rgb = hexToRgb(color);
  const fillRGBA = (255 << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0];
  const w = window.FloodFillWorker();
  w.onmessage = e => {
    const data = new Uint8Array(e.data.buffer);
    const flipped = new Uint8Array(data.length);
    const rowBytes = canvasW * 4;
    for(let row = 0; row < canvasH; row++){
      const src = (canvasH - 1 - row) * rowBytes;
      flipped.set(data.subarray(src, src + rowBytes), row * rowBytes);
    }
    gl.bindTexture(gl.TEXTURE_2D, Lr.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
    gl.bindTexture(gl.TEXTURE_2D, null);
    setStatus('Готово');
    pushActionHistory('Заливка');
    pushHistory(); updateThumb();
    w.terminate();
  };
  w.postMessage({
    buffer: pixels.buffer, W: canvasW, H: canvasH,
    x0: x, y0: flippedY, fillRGBA, tol: 32
  }, [pixels.buffer]);
}

function doMagicWand(x, y){
  const Lr = layers[activeLayer]; if(!Lr) return;
  x = Math.floor(x); y = Math.floor(y);
  if(x < 0 || y < 0 || x >= canvasW || y >= canvasH) return;
  setStatus('Выделение...');
  gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
  const pixels = new Uint8Array(canvasW * canvasH * 4);
  gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const flippedY = canvasH - y - 1;
  const w = window.MagicWandWorker();
  w.onmessage = e => {
    const mask = new Uint8Array(e.data.mask);
    const bbox = e.data.bbox;
    const flipped = new Uint8Array(mask.length);
    for(let row = 0; row < canvasH; row++){
      const src = (canvasH - 1 - row) * canvasW;
      flipped.set(mask.subarray(src, src + canvasW), row * canvasW);
    }
    const fy = canvasH - bbox.y - bbox.h;
    selection = { type:'mask', mask:flipped, bbox:{ x:bbox.x, y:fy, w:bbox.w, h:bbox.h } };
    drawOverlay();
    setStatus('Готово');
    w.terminate();
  };
  w.postMessage({
    buffer: pixels.buffer, W: canvasW, H: canvasH,
    x0: x, y0: flippedY, tol: 32, contiguous: true
  }, [pixels.buffer]);
}

/* ============================================================
   COPY/CUT/PASTE
   ============================================================ */
function getSelectionBBox(){
  if(!selection) return null;
  if(selection.type === 'rect') return { x:selection.x, y:selection.y, w:selection.w, h:selection.h };
  if(selection.type === 'mask') return selection.bbox;
  return null;
}
function copySelection(){
  if(!selection){ setStatus('Нет выделения'); return; }
  const Lr = layers[activeLayer]; if(!Lr) return;
  const bbox = getSelectionBBox();
  if(!bbox || bbox.w <= 0 || bbox.h <= 0) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
  const pixels = new Uint8Array(canvasW * canvasH * 4);
  gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const bw = Math.floor(bbox.w), bh = Math.floor(bbox.h);
  const out = new Uint8Array(bw * bh * 4);
  for(let y = 0; y < bh; y++){
    const srcY = canvasH - Math.floor(bbox.y + y) - 1;
    if(srcY < 0 || srcY >= canvasH) continue;
    for(let x = 0; x < bw; x++){
      const srcX = Math.floor(bbox.x + x);
      if(srcX < 0 || srcX >= canvasW) continue;
      const si = (srcY * canvasW + srcX) * 4, di = (y * bw + x) * 4;
      out[di]=pixels[si]; out[di+1]=pixels[si+1]; out[di+2]=pixels[si+2]; out[di+3]=pixels[si+3];
    }
  }
  clipboard = { data: out, w: bw, h: bh };
  setStatus('Скопировано');
  setTimeout(() => setStatus('Готово'), 1200);
}
window.copySelection = copySelection;

function cutSelection(){
  if(!selection) return;
  copySelection();
  const Lr = layers[activeLayer];
  const bbox = getSelectionBBox();
  if(!bbox) return;
  // Стираем
  gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
  const pixels = new Uint8Array(canvasW * canvasH * 4);
  gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  for(let y = Math.floor(bbox.y); y < bbox.y + bbox.h; y++){
    for(let x = Math.floor(bbox.x); x < bbox.x + bbox.w; x++){
      if(selection.type === 'mask'){
        const idx = y * canvasW + x;
        if(!selection.mask[idx]) continue;
      }
      const srcY = canvasH - y - 1;
      const idx = (srcY * canvasW + x) * 4;
      if(idx < 0 || idx >= pixels.length) continue;
      pixels[idx+3] = 0;
    }
  }
  const flipped = new Uint8Array(pixels.length);
  const rowBytes = canvasW * 4;
  for(let row = 0; row < canvasH; row++){
    const src = (canvasH - 1 - row) * rowBytes;
    flipped.set(pixels.subarray(src, src + rowBytes), row * rowBytes);
  }
  gl.bindTexture(gl.TEXTURE_2D, Lr.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
  gl.bindTexture(gl.TEXTURE_2D, null);
  pushActionHistory('Вырезание');
  pushHistory(); updateThumb();
}
window.cutSelection = cutSelection;

function pasteClipboard(){
  if(!clipboard){ setStatus('Буфер пуст'); return; }
  const Lr = layers[activeLayer]; if(!Lr) return;
  const px = Math.floor((canvasW - clipboard.w) / 2);
  const py = Math.floor((canvasH - clipboard.h) / 2);
  gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
  const pixels = new Uint8Array(canvasW * canvasH * 4);
  gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  for(let y = 0; y < clipboard.h; y++){
    const dstY = py + y;
    if(dstY < 0 || dstY >= canvasH) continue;
    const srcY = canvasH - dstY - 1;
    for(let x = 0; x < clipboard.w; x++){
      const dstX = px + x;
      if(dstX < 0 || dstX >= canvasW) continue;
      const si = (y * clipboard.w + x) * 4;
      const di = (srcY * canvasW + dstX) * 4;
      const a = clipboard.data[si+3];
      if(a === 0) continue;
      pixels[di]=clipboard.data[si];
      pixels[di+1]=clipboard.data[si+1];
      pixels[di+2]=clipboard.data[si+2];
      pixels[di+3]=Math.max(pixels[di+3], a);
    }
  }
  const flipped = new Uint8Array(pixels.length);
  const rowBytes = canvasW * 4;
  for(let row = 0; row < canvasH; row++){
    const src = (canvasH - 1 - row) * rowBytes;
    flipped.set(pixels.subarray(src, src + rowBytes), row * rowBytes);
  }
  gl.bindTexture(gl.TEXTURE_2D, Lr.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
  gl.bindTexture(gl.TEXTURE_2D, null);
  selection = { type:'rect', x:px, y:py, w:clipboard.w, h:clipboard.h };
  drawOverlay();
  pushActionHistory('Вставка');
  pushHistory(); updateThumb();
}
window.pasteClipboard = pasteClipboard;

/* ============================================================
   HISTORY
   ============================================================ */
function snapshotLayerFBO(Lr){
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvasW, canvasH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, Lr.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
  gl.blitFramebuffer(0, 0, canvasW, canvasH, 0, 0, canvasW, canvasH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  return tex;
}
function pushHistory(){
  if(!layers.length) return;
  if(histIndex < history.length - 1){
    for(let i = histIndex + 1; i < history.length; i++){
      history[i].forEach(s => gl.deleteTexture(s.tex));
    }
    history = history.slice(0, histIndex + 1);
  }
  const snap = layers.map(Lr => ({ tex: snapshotLayerFBO(Lr) }));
  history.push(snap);
  if(history.length > MAX_HISTORY){
    const old = history.shift();
    old.forEach(s => gl.deleteTexture(s.tex));
  }
  histIndex = history.length - 1;
  updateUndoButtons();
  renderHistoryList();
}
function pushActionHistory(name){
  actionHistory.push({ name, time: Date.now() });
  if(actionHistory.length > MAX_HISTORY) actionHistory.shift();
  renderHistoryList();
}
function restoreHistory(idx){
  if(idx < 0 || idx >= history.length) return;
  const snap = history[idx];
  for(let i = 0; i < snap.length; i++){
    const Lr = layers[i];
    if(!Lr) continue;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, snap[i].tex, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, Lr.fbo);
    gl.blitFramebuffer(0, 0, canvasW, canvasH, 0, 0, canvasW, canvasH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
  }
  updateThumb();
}
function undo(){ if(histIndex > 0){ histIndex--; restoreHistory(histIndex); updateUndoButtons(); renderHistoryList(); } }
function redo(){ if(histIndex < history.length - 1){ histIndex++; restoreHistory(histIndex); updateUndoButtons(); renderHistoryList(); } }
function updateUndoButtons(){
  const u = $('btnUndo'), r = $('btnRedo');
  if(u) u.style.opacity = histIndex > 0 ? 1 : .35;
  if(r) r.style.opacity = histIndex < history.length - 1 ? 1 : .35;
}
window.undo = undo;
window.redo = redo;

function renderHistoryList(){
  const list = $('historyList');
  if(!list) return;
  list.innerHTML = '';
  actionHistory.slice().reverse().forEach((h, i) => {
    const el = document.createElement('div');
    el.className = 'history-item' + (i === 0 ? ' current' : '');
    el.innerHTML = `<span>${escapeHtml(h.name)}</span>`;
    list.appendChild(el);
  });
}

/* ============================================================
   FLIP / ROTATE / RESIZE
   ============================================================ */
function applyFlip(horiz, vert){
  const Lr = layers[activeLayer]; if(!Lr) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
  const pixels = new Uint8Array(canvasW * canvasH * 4);
  gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const out = new Uint8Array(pixels.length);
  for(let y = 0; y < canvasH; y++) for(let x = 0; x < canvasW; x++){
    const sx = horiz ? canvasW - 1 - x : x;
    const sy = vert  ? canvasH - 1 - y : y;
    const si = (sy * canvasW + sx) * 4, di = (y * canvasW + x) * 4;
    out[di]=pixels[si]; out[di+1]=pixels[si+1]; out[di+2]=pixels[si+2]; out[di+3]=pixels[si+3];
  }
  const flipped = new Uint8Array(out.length);
  const rowBytes = canvasW * 4;
  for(let row = 0; row < canvasH; row++){
    const src = (canvasH - 1 - row) * rowBytes;
    flipped.set(out.subarray(src, src + rowBytes), row * rowBytes);
  }
  gl.bindTexture(gl.TEXTURE_2D, Lr.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
  gl.bindTexture(gl.TEXTURE_2D, null);
  pushActionHistory(horiz ? 'Отразить H' : 'Отразить V');
  pushHistory(); updateThumb();
}

function applyResize(){
  const nw = clamp(parseInt($('rzW').value) || canvasW, 16, 8192);
  const nh = clamp(parseInt($('rzH').value) || canvasH, 16, 8192);
  if(nw === canvasW && nh === canvasH){ closeModal('modalResize'); return; }
  const layerData = [];
  layers.forEach(Lr => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
    const pixels = new Uint8Array(canvasW * canvasH * 4);
    gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const c1 = document.createElement('canvas');
    c1.width = canvasW; c1.height = canvasH;
    const cx1 = c1.getContext('2d');
    const imgData = cx1.createImageData(canvasW, canvasH);
    const rowBytes = canvasW * 4;
    for(let row = 0; row < canvasH; row++){
      const src = (canvasH - 1 - row) * rowBytes;
      imgData.data.set(pixels.subarray(src, src + rowBytes), row * rowBytes);
    }
    cx1.putImageData(imgData, 0, 0);
    const c2 = document.createElement('canvas');
    c2.width = nw; c2.height = nh;
    const cx2 = c2.getContext('2d');
    cx2.imageSmoothingEnabled = true; cx2.imageSmoothingQuality = 'high';
    cx2.drawImage(c1, 0, 0, nw, nh);
    const out = cx2.getImageData(0, 0, nw, nh).data;
    layerData.push({ out: new Uint8Array(out), meta: {...Lr} });
  });
  canvasW = nw; canvasH = nh;
  layers.forEach(Lr => { gl.deleteTexture(Lr.tex); gl.deleteFramebuffer(Lr.fbo); });
  layers = layerData.map(ld => {
    const { tex, fbo } = createLayerFBO(canvasW, canvasH);
    const flipped = new Uint8Array(ld.out.length);
    const rowBytes = canvasW * 4;
    for(let row = 0; row < canvasH; row++){
      const src = (canvasH - 1 - row) * rowBytes;
      flipped.set(ld.out.subarray(src, src + rowBytes), row * rowBytes);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { ...ld.meta, tex, fbo };
  });
  history = []; histIndex = -1;
  pushActionHistory('Размер холста');
  pushHistory(); renderLayersUI(); fitToScreen(); updateThumb();
  updateCanvasSizeLabel();
  closeModal('modalResize');
}
window.applyResize = applyResize;

/* ============================================================
   FILTERS
   ============================================================ */
function applyFilter(type, params){
  const Lr = layers[activeLayer]; if(!Lr) return;
  setStatus('Фильтр...');
  gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
  const pixels = new Uint8Array(canvasW * canvasH * 4);
  gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const flipped = new Uint8Array(pixels.length);
  const rowBytes = canvasW * 4;
  for(let row = 0; row < canvasH; row++){
    const src = (canvasH - 1 - row) * rowBytes;
    flipped.set(pixels.subarray(src, src + rowBytes), row * rowBytes);
  }
  const w = window.FiltersWorker();
  w.onmessage = e => {
    const result = new Uint8Array(e.data.buffer);
    const back = new Uint8Array(result.length);
    for(let row = 0; row < canvasH; row++){
      const src = (canvasH - 1 - row) * rowBytes;
      back.set(result.subarray(src, src + rowBytes), row * rowBytes);
    }
    gl.bindTexture(gl.TEXTURE_2D, Lr.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, back);
    gl.bindTexture(gl.TEXTURE_2D, null);
    pushActionHistory('Фильтр: ' + type);
    pushHistory(); updateThumb(); setStatus('Готово');
    w.terminate();
  };
  w.postMessage({ buffer: flipped.buffer, W: canvasW, H: canvasH, type, params }, [flipped.buffer]);
}
window.applyFilter = applyFilter;

/* ============================================================
   LAYERS
   ============================================================ */
function renderLayersUI(){
  const list = $('layersList');
  if(!list) return;
  list.innerHTML = '';
  layers.slice().reverse().forEach((Lr, ri) => {
    const i = layers.length - 1 - ri;
    const el = document.createElement('div');
    el.className = 'layer-item' + (i === activeLayer ? ' active' : '');
    el.innerHTML = `
      <div class="eye ${Lr.visible ? '' : 'off'}"><svg class="ico ico-sm"><use href="#i-${Lr.visible ? 'eye' : 'eye-off'}"/></svg></div>
      <div class="lname">${escapeHtml(Lr.name)}</div>
      <div class="lock ${Lr.lockAlpha ? 'on' : ''}"><svg class="ico ico-sm"><use href="#i-${Lr.lockAlpha ? 'lock' : 'lock-open'}"/></svg></div>
    `;
    el.onclick = e => {
      if(e.target.closest('.eye') || e.target.closest('.lock')) return;
      activeLayer = i;
      renderLayersUI();
    };
    el.querySelector('.eye').onclick = e => { e.stopPropagation(); Lr.visible = !Lr.visible; renderLayersUI(); };
    el.querySelector('.lock').onclick = e => { e.stopPropagation(); Lr.lockAlpha = !Lr.lockAlpha; renderLayersUI(); };
    list.appendChild(el);
  });
}

function toggleLayerLock(i){
  const idx = (i === undefined) ? activeLayer : i;
  const Lr = layers[idx]; if(!Lr) return;
  Lr.lockAlpha = !Lr.lockAlpha;
  renderLayersUI();
  toast(Lr.lockAlpha ? 'Замок включён' : 'Замок выключен', 'info', 1500);
}

function addLayerMask(i){
  const idx = (i === undefined) ? activeLayer : i;
  const Lr = layers[idx]; if(!Lr) return;
  if(Lr.hasMask){ toast('У слоя уже есть маска', 'info'); return; }
  const { tex, fbo } = createMaskFBO(canvasW, canvasH, 1.0);
  Lr.maskTex = tex; Lr.maskFbo = fbo; Lr.hasMask = true;
  pushActionHistory('Добавление маски');
  renderLayersUI();
  toast('Маска добавлена', 'success', 2500);
}

function removeLayerMask(i){
  const idx = (i === undefined) ? activeLayer : i;
  const Lr = layers[idx]; if(!Lr || !Lr.hasMask) return;
  if(Lr.maskTex) gl.deleteTexture(Lr.maskTex);
  if(Lr.maskFbo) gl.deleteFramebuffer(Lr.maskFbo);
  Lr.maskTex = null; Lr.maskFbo = null; Lr.hasMask = false;
  pushActionHistory('Удаление маски');
  renderLayersUI();
  toast('Маска удалена', 'success');
}

function mergeDown(i){
  const idx = (i === undefined) ? activeLayer : i;
  if(idx <= 0){ toast('Нет слоя ниже', 'error'); return; }
  const top = layers[idx];
  const bottom = layers[idx-1];
  if(!top || !bottom) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, top.fbo);
  const tp = new Uint8Array(canvasW * canvasH * 4);
  gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, tp);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, bottom.fbo);
  gl.viewport(0, 0, canvasW, canvasH);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindTexture(gl.TEXTURE_2D, bottom.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, tp);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteTexture(top.tex); gl.deleteFramebuffer(top.fbo);
  layers.splice(idx, 1);
  activeLayer = idx - 1;
  pushActionHistory('Объединение вниз');
  renderLayersUI(); pushHistory();
  toast('Слои объединены', 'success');
}

function addLayer(){
  if(!project) return;
  const { tex, fbo } = createLayerFBO(canvasW, canvasH);
  layers.push({ name: 'Слой ' + (layers.length + 1), visible: true, opacity: 1, blend: 'normal',
    lockAlpha: false, hasMask: false, tex, fbo, maskTex: null, maskFbo: null });
  activeLayer = layers.length - 1;
  pushActionHistory('Новый слой');
  renderLayersUI(); pushHistory();
}
window.addLayer = addLayer;

/* ============================================================
   COLOR PICKER
   ============================================================ */
function drawColorCircle(canvasEl, hue, sat, val){
  const ctx = canvasEl.getContext('2d');
  const w = canvasEl.width, h = canvasEl.height;
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) * 0.48;
  const innerR = R * 0.68;
  const imgData = ctx.createImageData(w, h);
  for(let y = 0; y < h; y++){
    for(let x = 0; x < w; x++){
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx*dx + dy*dy);
      const i = (y * w + x) * 4;
      if(d <= R && d >= innerR){
        let ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        if(ang < 0) ang += 360;
        const [r,g,b] = hsv2rgb(ang, 1, 1);
        imgData.data[i] = r; imgData.data[i+1] = g; imgData.data[i+2] = b; imgData.data[i+3] = 255;
      } else if(d < innerR){
        const qs = innerR * 1.42;
        const lx = x - cx + qs/2, ly = y - cy + qs/2;
        if(lx >= 0 && lx < qs && ly >= 0 && ly < qs){
          const s = lx / qs, v = 1 - ly / qs;
          const [r,g,b] = hsv2rgb(hue, s, v);
          imgData.data[i] = r; imgData.data[i+1] = g; imgData.data[i+2] = b; imgData.data[i+3] = 255;
        } else imgData.data[i+3] = 0;
      } else imgData.data[i+3] = 0;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function handlePickerClick(e, wheelEl){
  const rect = wheelEl.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  const cx = rect.width / 2, cy = rect.height / 2;
  const R = Math.min(rect.width, rect.height) * 0.48;
  const innerR = R * 0.68;
  const dx = x - cx, dy = y - cy;
  const d = Math.sqrt(dx*dx + dy*dy);
  if(d <= R && d >= innerR){
    let ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    if(ang < 0) ang += 360;
    currentHue = ang;
    const [r,g,b] = hsv2rgb(currentHue, currentSat, currentVal);
    setColor(rgbToHex(r,g,b));
  } else if(d < innerR){
    const qs = innerR * 1.42;
    const lx = x - cx + qs/2, ly = y - cy + qs/2;
    if(lx >= 0 && lx < qs && ly >= 0 && ly < qs){
      currentSat = lx / qs;
      currentVal = 1 - ly / qs;
      const [r,g,b] = hsv2rgb(currentHue, currentSat, currentVal);
      setColor(rgbToHex(r,g,b));
    }
  }
}

function initColorPicker(){
  const pickerEl = $('colorPickerInline');
  if(!pickerEl) return;
  drawColorCircle($('cpInlineCanvas'), currentHue, currentSat, currentVal);
  pickerEl.addEventListener('pointerdown', e => {
    e.preventDefault();
    pickerEl.setPointerCapture(e.pointerId);
    handlePickerClick(e, pickerEl);
  });
  pickerEl.addEventListener('pointermove', e => {
    if(pickerEl.hasPointerCapture(e.pointerId)) handlePickerClick(e, pickerEl);
  });
}

function setColor(hex){
  color = hex.toUpperCase();
  const [r,g,b] = hexToRgb(color);
  const hsv = rgb2hsv(r,g,b);
  currentHue = hsv[0]; currentSat = hsv[1]; currentVal = hsv[2];
  const c = $('cpInlineCanvas');
  if(c) drawColorCircle(c, currentHue, currentSat, currentVal);
  if($('colorPreview')) $('colorPreview').style.background = color;
  if($('hexInput')) $('hexInput').value = color;
  if($('rStrip')) $('rStrip').value = Math.round(r);
  if($('gStrip')) $('gStrip').value = Math.round(g);
  if($('bStrip')) $('bStrip').value = Math.round(b);
  if($('rVal')) $('rVal').textContent = Math.round(r);
  if($('gVal')) $('gVal').textContent = Math.round(g);
  if($('bVal')) $('bVal').textContent = Math.round(b);
}
window.setColor = setColor;

function renderPalette(){
  const g = $('paletteGrid');
  if(!g) return;
  g.innerHTML = '';
  state.palette.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'palette-swatch';
    d.style.background = c;
    d.title = c;
    d.onclick = () => setColor(c);
    d.oncontextmenu = e => {
      e.preventDefault();
      state.palette.splice(i, 1);
      savePalette(); renderPalette();
    };
    g.appendChild(d);
  });
  const add = document.createElement('div');
  add.className = 'palette-add';
  add.textContent = '+';
  add.onclick = () => {
    if(!state.palette.includes(color)){ state.palette.push(color); savePalette(); renderPalette(); }
  };
  g.appendChild(add);
}

/* ============================================================
   BRUSH UI
   ============================================================ */
function renderBrushCard(canvasEl, brush){
  const ctx = canvasEl.getContext('2d');
  const w = canvasEl.width, h = canvasEl.height;
  ctx.fillStyle = '#0d0a18';
  ctx.fillRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#c8b5ff');
  grad.addColorStop(0.5, '#7c5cff');
  grad.addColorStop(1, '#5c8cff');
  ctx.strokeStyle = grad;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, brush.size * 0.35);
  ctx.globalAlpha = brush.opacity;
  ctx.beginPath();
  for(let i = 0; i <= 60; i++){
    const t = i / 60;
    const x = w * 0.12 + (w * 0.76) * t;
    const y = h / 2 + Math.sin(t * Math.PI * 1.5) * (h * 0.18) * (1 - t * 0.3);
    if(i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#332e50';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w-1, h-1);
}

let brushPickerCategory = 'all';
function renderBrushPicker(){
  const grid = $('brushGridPicker');
  if(!grid) return;
  grid.innerHTML = '';
  const brushes = state.brushes.filter(b =>
    brushPickerCategory === 'all' || b.cat === brushPickerCategory
  );
  brushes.forEach(brush => {
    const card = document.createElement('div');
    card.className = 'brush-card' + (brush.id === state.currentBrushId ? ' active' : '');
    const cv = document.createElement('canvas');
    cv.width = 270; cv.height = 80;
    card.appendChild(cv);
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = brush.name;
    card.appendChild(nm);
    const dc = document.createElement('div'); dc.className = 'desc'; dc.textContent = brush.desc;
    card.appendChild(dc);
    renderBrushCard(cv, brush);
    card.onclick = () => {
      state.currentBrushId = brush.id;
      localStorage.setItem('spw.currentBrushId', brush.id);
      loadBrushToUI(brush);
      renderBrushPicker();
      updateCurrentBrushPreview();
    };
    grid.appendChild(card);
  });
  updateBrushCounts();
}

function updateBrushCounts(){
  const cats = { all: state.brushes.length };
  ['basic','soft','hard','texture','ink','marker'].forEach(c => {
    cats[c] = state.brushes.filter(b => b.cat === c).length;
  });
  Object.entries(cats).forEach(([k, v]) => {
    const el = $('catCount' + k.charAt(0).toUpperCase() + k.slice(1));
    if(el) el.textContent = v;
  });
}

function loadBrushToUI(brush){
  size = brush.size;
  opacity = brush.opacity;
  hardness = brush.hard;
  flow = brush.flow;
  smoothing = brush.smooth;
  syncBrushUI();
}

function syncBrushUI(){
  if($('sizeRange')){ $('sizeRange').value = size; $('sizeVal').textContent = Math.round(size); }
  if($('opacRange')){ $('opacRange').value = Math.round(opacity * 100); $('opacVal').textContent = Math.round(opacity * 100); }
  if($('hardRange')){ $('hardRange').value = Math.round(hardness * 100); $('hardVal').textContent = Math.round(hardness * 100); }
  if($('flowRange')){ $('flowRange').value = Math.round(flow * 100); $('flowVal').textContent = Math.round(flow * 100); }
  if($('smoothRange')){ $('smoothRange').value = Math.round(smoothing * 100); $('smoothVal').textContent = Math.round(smoothing * 100); }
}

function updateCurrentBrushPreview(){
  const brush = getCurrentBrush();
  if($('currentBrushName')) $('currentBrushName').textContent = brush.name;
  if($('currentBrushDesc')) $('currentBrushDesc').textContent = brush.desc + ' · ' + brush.cat;
  const cv = $('currentBrushPreview');
  if(cv) renderBrushCard(cv, brush);
}

/* ============================================================
   BRUSH EDITOR
   ============================================================ */
let editingBrush = null;
function openBrushEditor(){
  editingBrush = {...getCurrentBrush()};
  if(editingBrush.sizeMin == null) editingBrush.sizeMin = 1;
  if(editingBrush.sizeMax == null) editingBrush.sizeMax = 3000;
  if(editingBrush.startSize == null) editingBrush.startSize = 100;
  if(editingBrush.endSize == null) editingBrush.endSize = 100;
  if(editingBrush.startOpacity == null) editingBrush.startOpacity = 100;
  if(editingBrush.endOpacity == null) editingBrush.endOpacity = 100;
  if(editingBrush.type == null) editingBrush.type = 'normal';
  loadBrushToEditor(editingBrush);
  openModal('modalBrushEdit');
  requestAnimationFrame(() => renderBrushEditorPreview());
}

function loadBrushToEditor(brush){
  if($('beSize')) { $('beSize').value = brush.size; $('beSizeVal').textContent = brush.size; }
  if($('beSizeMin')) { $('beSizeMin').value = brush.sizeMin; $('beSizeMinVal').textContent = brush.sizeMin; }
  if($('beSizeMax')) { $('beSizeMax').value = brush.sizeMax; $('beSizeMaxVal').textContent = brush.sizeMax; }
  if($('beStartSize')) { $('beStartSize').value = brush.startSize; $('beStartSizeVal').textContent = brush.startSize; }
  if($('beEndSize')) { $('beEndSize').value = brush.endSize; $('beEndSizeVal').textContent = brush.endSize; }
  if($('beStartOpac')) { $('beStartOpac').value = brush.startOpacity; $('beStartOpacVal').textContent = brush.startOpacity; }
  if($('beEndOpac')) { $('beEndOpac').value = brush.endOpacity; $('beEndOpacVal').textContent = brush.endOpacity; }
  if($('beHard')) $('beHard').value = Math.round(brush.hard * 100);
  if($('beHardVal')) $('beHardVal').textContent = Math.round(brush.hard * 100);
  if($('beFlow')) $('beFlow').value = Math.round(brush.flow * 100);
  if($('beOpac')) $('beOpac').value = Math.round(brush.opacity * 100);
  if($('beSmooth')) $('beSmooth').value = Math.round(brush.smooth * 100);
  if($('beFlowVal')) $('beFlowVal').textContent = Math.round(brush.flow * 100);
  if($('beOpacVal')) $('beOpacVal').textContent = Math.round(brush.opacity * 100);
  if($('beSmoothVal')) $('beSmoothVal').textContent = Math.round(brush.smooth * 100);
  if($('bePressureSize')) $('bePressureSize').checked = brush.pressureSize;
  if($('bePressureOpac')) $('bePressureOpac').checked = brush.pressureOpac;
  $$('#shapeGrid .shape-item').forEach(el => el.classList.toggle('active', el.dataset.shape === brush.shape));
}

function renderBrushEditorPreview(){
  const cv = $('bePreview');
  if(!cv) return;
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  ctx.fillStyle = '#0d0a18';
  ctx.fillRect(0, 0, w, h);
  const b = editingBrush;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = b.opacity;
  ctx.lineWidth = b.size;
  ctx.beginPath();
  for(let x = 20; x <= w - 20; x += 2){
    const t = (x - 20) / (w - 40);
    const y = h/2 + Math.sin(t * Math.PI * 2) * (h * 0.22);
    if(x === 20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function saveBrushEditor(){
  if(!editingBrush) return;
  const idx = state.brushes.findIndex(b => b.id === editingBrush.id);
  if(idx >= 0) state.brushes[idx] = {...editingBrush};
  else state.brushes.push({...editingBrush});
  saveBrushes();
  loadBrushToUI(getCurrentBrush());
  updateCurrentBrushPreview();
  renderBrushPicker();
  toast('Кисть сохранена', 'success');
}

function deleteBrushEditor(){
  if(!editingBrush) return;
  if(state.brushes.length <= 1){ toast('Нельзя удалить единственную кисть', 'error'); return; }
  showConfirm(`Удалить кисть «${editingBrush.name}»?`, () => {
    state.brushes = state.brushes.filter(b => b.id !== editingBrush.id);
    saveBrushes();
    state.currentBrushId = state.brushes[0].id;
    localStorage.setItem('spw.currentBrushId', state.currentBrushId);
    loadBrushToUI(getCurrentBrush());
    updateCurrentBrushPreview();
    renderBrushPicker();
    closeModal('modalBrushEdit');
    toast('Кисть удалена', 'success');
  });
}

function createNewBrush(){
  editingBrush = {
    id: 'custom-' + Date.now(), name: 'Новая кисть', cat: 'basic', desc: 'пользовательская',
    shape: 'circle', size: 20, sizeMin: 1, sizeMax: 3000, hard: 0.7, opacity: 1, flow: 1, smooth: 0.6,
    scatter: 0, pressureSize: true, pressureOpac: false, tex: 'none', type: 'normal',
    startSize: 100, endSize: 100, startOpacity: 100, endOpacity: 100,
  };
  loadBrushToEditor(editingBrush);
  openModal('modalBrushEdit');
  requestAnimationFrame(() => renderBrushEditorPreview());
}

/* ============================================================
   TOOLS
   ============================================================ */
function setTool(t){
  tool = t;
  $$('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  const names = {
    brush:'Кисть', pencil:'Карандаш', eraser:'Ластик',
    fill:'Заливка', picker:'Пипетка', select:'Выделение', lasso:'Лассо',
    wand:'Палочка', move:'Перемещение'
  };
  const el = $('toolStatus');
  if(el) el.textContent = names[t] || t;
  log('tool changed to', t);
}
window.setTool = setTool;

/* ============================================================
   NEW CANVAS / OPEN
   ============================================================ */
function openNewCanvasModal(){
  if($('ncName')) $('ncName').value = '';
  openModal('modalNewCanvas');
}
window.openNewCanvasModal = openNewCanvasModal;

function confirmNewCanvas(){
  const name = ($('ncName').value || 'Без названия').trim();
  const w = clamp(parseInt($('ncW').value) || 1280, 64, 4096);
  const h = clamp(parseInt($('ncH').value) || 960, 64, 4096);
  closeModal('modalNewCanvas');
  const p = { id: Date.now(), name, width: w, height: h, dpi: 96,
    modified: Date.now(), thumb: null, layerData: [null], cloudId: null };
  state.projects.push(p);
  saveProjects();
  openProject(state.projects.length - 1);
}
window.confirmNewCanvas = confirmNewCanvas;

function openProject(i){
  projIndex = i;
  const p = state.projects[i];
  canvasW = p.width;
  canvasH = p.height;

  layers.forEach(Lr => { gl.deleteTexture(Lr.tex); gl.deleteFramebuffer(Lr.fbo); });
  layers = [];

  const { tex, fbo } = createLayerFBO(canvasW, canvasH);
  layers.push({ name: 'Слой 1', visible: true, opacity: 1, blend: 'normal',
    lockAlpha: false, hasMask: false, tex, fbo, maskTex: null, maskFbo: null });
  activeLayer = 0;
  selection = null;
  lassoPoints = [];
  history = []; histIndex = -1;
  actionHistory = [{ name: 'Открытие проекта', time: Date.now() }];
  project = p;

  if($('editorTitle')) $('editorTitle').textContent = p.name;
  go('pgEditor');

  renderLayersUI();
  renderHistoryList();
  loadBrushToUI(getCurrentBrush());
  updateCurrentBrushPreview();
  setColor(color);
  updateCanvasSizeLabel();

  panX = 0; panY = 0; zoom = 1;
  syncCanvasSize();
  smoothX = canvasW * 0.5; smoothY = canvasH * 0.5;
  targetX = smoothX; targetY = smoothY;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      syncCanvasSize();
      fitToScreen();
      initColorPicker();
      pushHistory();
      startRenderLoop();
      drawOverlay();
    });
  });
}
window.openProject = openProject;

function updateCanvasSizeLabel(){
  const el = $('canvasSizeLabel');
  if(el) el.textContent = `${canvasW} × ${canvasH}`;
}

/* ============================================================
   SAVE / CLOUD
   ============================================================ */
function saveProject(){
  if(projIndex < 0 || !layers.length) return;
  const p = state.projects[projIndex];
  p.modified = Date.now();
  p.width = canvasW;
  p.height = canvasH;
  p.layerData = layers.map(Lr => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
    const pixels = new Uint8Array(canvasW * canvasH * 4);
    gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const c2 = document.createElement('canvas');
    c2.width = canvasW; c2.height = canvasH;
    const cx = c2.getContext('2d');
    const imgData = cx.createImageData(canvasW, canvasH);
    const rowBytes = canvasW * 4;
    for(let y = 0; y < canvasH; y++){
      const src = (canvasH - 1 - y) * rowBytes;
      imgData.data.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
    }
    cx.putImageData(imgData, 0, 0);
    return c2.toDataURL('image/png');
  });
  saveProjects();
}

function flattenToCanvas(){
  const out = document.createElement('canvas');
  out.width = canvasW; out.height = canvasH;
  const octx = out.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, canvasW, canvasH);
  layers.forEach(Lr => {
    if(!Lr.visible) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
    const pixels = new Uint8Array(canvasW * canvasH * 4);
    gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const tmp = document.createElement('canvas');
    tmp.width = canvasW; tmp.height = canvasH;
    const tctx = tmp.getContext('2d');
    const imgData = tctx.createImageData(canvasW, canvasH);
    const rowBytes = canvasW * 4;
    for(let y = 0; y < canvasH; y++){
      const src = (canvasH - 1 - y) * rowBytes;
      imgData.data.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
    }
    tctx.putImageData(imgData, 0, 0);
    octx.globalAlpha = Lr.opacity;
    octx.globalCompositeOperation = (Lr.blend === 'normal' ? 'source-over' : Lr.blend);
    octx.drawImage(tmp, 0, 0);
  });
  return out;
}

function updateThumb(){
  if(projIndex < 0 || !layers.length) return;
  const full = flattenToCanvas();
  const small = document.createElement('canvas');
  small.width = 320; small.height = 240;
  small.getContext('2d').drawImage(full, 0, 0, 320, 240);
  state.projects[projIndex].thumb = small.toDataURL('image/jpeg', 0.7);
  saveProjects();
}

function exitEditor(){
  saveProject();
  updateThumb();
  projIndex = -1;
  project = null;
  selection = null;
  lassoPoints = [];
  drawOverlay();
  go('pgGallery');
}
window.exitEditor = exitEditor;

async function saveToCloud(isPublic){
  if(!state.user){ toast('Войдите в аккаунт', 'error'); openModal('modalAuth'); return; }
  if(projIndex < 0 || !project){ toast('Сначала откройте холст', 'error'); return; }
  setStatus('Отправка в облако...');
  try {
    const full = flattenToCanvas();
    const fullBlob = await new Promise(r => full.toBlob(r, 'image/png'));
    const fd = new FormData();
    fd.append('file', new File([fullBlob], 'artwork.png', { type: 'image/png' }));
    fd.append('title', project.name);
    fd.append('width', String(canvasW));
    fd.append('height', String(canvasH));
    fd.append('isPublic', isPublic ? '1' : '0');
    if(project.cloudId) fd.append('artworkId', String(project.cloudId));
    const { artwork } = await api('/artworks', { method: 'POST', body: fd });
    project.cloudId = artwork.id;
    saveProjects();
    toast(isPublic ? 'Опубликовано!' : 'Сохранено в облако', 'success');
    setStatus('Готово');
  } catch(err){
    console.error(err);
    toast('Ошибка: ' + err.message, 'error');
    setStatus('Ошибка');
  }
}
window.saveToCloud = saveToCloud;

/* ============================================================
   GALLERY / COMMUNITY / ADMIN
   ============================================================ */
function renderGalleryScreen(){
  renderLocalGallery();
  renderCloudGallery();
}

function renderLocalGallery(){
  const grid = $('localGallery');
  if(!grid) return;
  grid.innerHTML = '';
  if($('localCount')) $('localCount').textContent = state.projects.length;
  if(state.projects.length === 0){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1;"><div>У вас пока нет работ.</div></div>`;
    return;
  }
  state.projects.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    const thumb = p.thumb || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#0d0d0d"/></svg>';
    card.innerHTML = `
      <img class="thumb" src="${thumb}" alt="">
      <div class="meta">
        <div class="info"><div class="name">${escapeHtml(p.name)}</div></div>
        <button class="menu del"><svg class="ico ico-sm"><use href="#i-trash"/></svg></button>
      </div>`;
    card.onclick = e => { if(!e.target.closest('.menu')) openProject(i); };
    card.querySelector('.menu').onclick = e => {
      e.stopPropagation();
      showConfirm(`Удалить?`, () => {
        state.projects.splice(i, 1); saveProjects(); renderLocalGallery();
      });
    };
    grid.appendChild(card);
  });
}

async function renderCloudGallery(){
  const grid = $('cloudGallery');
  if(!grid) return;
  if(!state.user){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1;">Войдите в аккаунт.</div>`;
    return;
  }
  try {
    const data = await api('/artworks/mine');
    state.cloudProjects = data.artworks || [];
  } catch { state.cloudProjects = []; }
  grid.innerHTML = '';
  if(state.cloudProjects.length === 0){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1;">Облако пусто.</div>`;
    return;
  }
  state.cloudProjects.forEach(a => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img class="thumb" src="${a.thumbUrl}" alt="">
      <div class="meta"><div class="info"><div class="name">${escapeHtml(a.title)}</div></div></div>`;
    grid.appendChild(card);
  });
}

async function renderCommunityScreen(){
  const grid = $('publicGallery');
  if(!grid) return;
  grid.innerHTML = '<div class="empty" style="grid-column:1/-1;">Загрузка...</div>';
  try {
    const data = await api('/artworks/public');
    state.publicProjects = data.artworks || [];
  } catch { state.publicProjects = []; }
  if($('publicCount')) $('publicCount').textContent = state.publicProjects.length;
  grid.innerHTML = '';
  if(state.publicProjects.length === 0){
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1;">Нет работ.</div>';
    return;
  }
  state.publicProjects.forEach(a => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img class="thumb" src="${a.thumbUrl}" alt="">
      <div class="meta"><div class="info"><div class="name">${escapeHtml(a.title)}</div></div></div>`;
    grid.appendChild(card);
  });
}

let adminTab = 'artworks';
async function loadAdminPanel(){
  if(!state.user?.isAdmin){ go('pgGallery'); return; }
  $$('[data-admin-tab]').forEach(b => {
    b.classList.toggle('primary', b.dataset.adminTab === adminTab);
    b.classList.toggle('secondary', b.dataset.adminTab !== adminTab);
    b.onclick = () => { adminTab = b.dataset.adminTab; loadAdminPanel(); };
  });
  const c = $('adminContent');
  if(!c) return;
  c.innerHTML = 'Загрузка...';
}

/* ============================================================
   CONFIRM / STATUS
   ============================================================ */
let confirmCallback = null;
function showConfirm(text, cb){
  const t = $('confirmText');
  if(t) t.textContent = text;
  confirmCallback = cb;
  openModal('modalConfirm');
}
window.showConfirm = showConfirm;
function setStatus(s){
  const el = $('statusInfo');
  if(el) el.textContent = s;
}

/* ============================================================
   BIND UI
   ============================================================ */
function bindUI(){
  $$('.tool-btn[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));

  $('btnTopBrushes')?.addEventListener('click', () => { renderBrushPicker(); openModal('modalBrushes'); });
  $('btnTopBrushEditor')?.addEventListener('click', openBrushEditor);
  $('btnTopFilters')?.addEventListener('click', () => openModal('modalFilters'));
  $('btnTopEdit')?.addEventListener('click', () => openModal('modalEdit'));
  $('btnTopLayers')?.addEventListener('click', () => {
    $('layersList')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  $('btnBrushPicker')?.addEventListener('click', () => { renderBrushPicker(); openModal('modalBrushes'); });
  $('btnBrushEdit')?.addEventListener('click', openBrushEditor);
  $('btnBrushEdit2')?.addEventListener('click', openBrushEditor);
  $('btnFiltersModal')?.addEventListener('click', () => openModal('modalFilters'));

  $$('.brush-cat-btn[data-cat]').forEach(btn => {
    btn.onclick = () => {
      brushPickerCategory = btn.dataset.cat;
      $$('.brush-cat-btn[data-cat]').forEach(x => x.classList.toggle('active', x === btn));
      renderBrushPicker();
    };
  });
  $('pickerNewBrush')?.addEventListener('click', () => createNewBrush());
  $('pickerEditBrush')?.addEventListener('click', () => openBrushEditor());
  $('btnConfirmBrush')?.addEventListener('click', () => {
    closeModal('modalBrushes');
    loadBrushToUI(getCurrentBrush());
    updateCurrentBrushPreview();
    toast('Кисть применена', 'success');
  });

  $('sizeRange')?.addEventListener('input', e => { size = +e.target.value; $('sizeVal').textContent = Math.round(size); const b = getCurrentBrush(); b.size = size; saveBrushes(); });
  $('opacRange')?.addEventListener('input', e => { opacity = e.target.value / 100; $('opacVal').textContent = e.target.value; const b = getCurrentBrush(); b.opacity = opacity; saveBrushes(); });
  $('hardRange')?.addEventListener('input', e => { hardness = +e.target.value / 100; $('hardVal').textContent = e.target.value; const b = getCurrentBrush(); b.hard = hardness; saveBrushes(); });
  $('flowRange')?.addEventListener('input', e => { flow = e.target.value / 100; $('flowVal').textContent = e.target.value; const b = getCurrentBrush(); b.flow = flow; saveBrushes(); });
  $('smoothRange')?.addEventListener('input', e => { smoothing = +e.target.value / 100; $('smoothVal').textContent = e.target.value; const b = getCurrentBrush(); b.smooth = smoothing; saveBrushes(); });

  ['r','g','b'].forEach(ch => {
    const el = $(ch + 'Strip');
    if(!el) return;
    el.addEventListener('input', () => {
      const r = +$('rStrip').value, g = +$('gStrip').value, b = +$('bStrip').value;
      setColor(rgbToHex(r,g,b));
    });
  });

  $('btnAddLayer')?.addEventListener('click', addLayer);
  $('btnAddMask')?.addEventListener('click', () => addLayerMask(activeLayer));
  $('btnLockToggle')?.addEventListener('click', () => toggleLayerLock(activeLayer));
  $('btnDupLayer')?.addEventListener('click', () => {
    const Lr = layers[activeLayer]; if(!Lr) return;
    const { tex, fbo } = createLayerFBO(canvasW, canvasH);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, Lr.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
    gl.blitFramebuffer(0, 0, canvasW, canvasH, 0, 0, canvasW, canvasH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    layers.splice(activeLayer + 1, 0, { ...Lr, name: Lr.name + ' копия', tex, fbo, maskTex: null, maskFbo: null, hasMask: false });
    activeLayer++;
    renderLayersUI(); pushHistory();
  });
  $('btnMergeDown')?.addEventListener('click', () => mergeDown(activeLayer));
  $('btnDeleteLayer')?.addEventListener('click', () => {
    if(layers.length <= 1){ toast('Нельзя удалить последний слой', 'error'); return; }
    const Lr = layers[activeLayer];
    gl.deleteTexture(Lr.tex); gl.deleteFramebuffer(Lr.fbo);
    layers.splice(activeLayer, 1);
    if(activeLayer >= layers.length) activeLayer = layers.length - 1;
    renderLayersUI(); pushHistory();
  });

  $$('.prop-tab').forEach(t => t.onclick = () => {
    $$('.prop-tab').forEach(x => x.classList.toggle('active', x === t));
    $$('.prop-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === t.dataset.panel));
  });

  $('btnUndo')?.addEventListener('click', undo);
  $('btnRedo')?.addEventListener('click', redo);
  $('btnFit')?.addEventListener('click', fitToScreen);
  $('btnFit2')?.addEventListener('click', fitToScreen);
  $('btnZoomIn')?.addEventListener('click', () => zoomBy(0.15));
  $('btnZoomOut')?.addEventListener('click', () => zoomBy(-0.15));
  $('btnMenuExit')?.addEventListener('click', exitEditor);
  $('btnCloudSave')?.addEventListener('click', () => saveToCloud(false));
  $('btnPublish')?.addEventListener('click', () => saveToCloud(true));
  $('btnClearLayer')?.addEventListener('click', () => {
    showConfirm('Очистить активный слой?', () => {
      const Lr = layers[activeLayer]; if(!Lr) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, Lr.fbo);
      gl.viewport(0, 0, canvasW, canvasH);
      gl.clearColor(0,0,0,0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      pushActionHistory('Очистка');
      pushHistory(); updateThumb();
    });
  });

  $$('.filter-item').forEach(fi => fi.onclick = () => {
    const type = fi.dataset.filter;
    closeModal('modalFilters');
    applyFilter(type, {});
  });

  $$('.preset-card[data-action]').forEach(card => card.onclick = () => {
    const act = card.dataset.action;
    closeModal('modalEdit');
    switch(act){
      case 'copy': copySelection(); break;
      case 'cut': cutSelection(); break;
      case 'paste': pasteClipboard(); break;
      case 'deselect': deselect(); break;
    }
  });

  $('btnNewCanvas')?.addEventListener('click', openNewCanvasModal);
  $('btnConfirmNewCanvas')?.addEventListener('click', confirmNewCanvas);
  $('btnApplyResize')?.addEventListener('click', applyResize);

  $('btnBackToGallery')?.addEventListener('click', () => go('pgGallery'));
  $('btnOpenCommunity')?.addEventListener('click', () => go('pgCommunity'));
  $('btnAdminBack')?.addEventListener('click', () => go('pgGallery'));

  $('userChip')?.addEventListener('click', () => {
    if(state.user) openModal('modalProfile');
    else openModal('modalAuth');
  });
  $('btnSaveProfile')?.addEventListener('click', async () => {
    try {
      const body = { displayName: $('profName').value, bio: $('profBio').value };
      const { user } = await api('/me', { method: 'PATCH', body: JSON.stringify(body) });
      state.user = user; updateUserUI();
      closeModal('modalProfile');
    } catch(err){ toast(err.message, 'error'); }
  });
  $('btnLogout')?.addEventListener('click', () => {
    state.user = null; state.token = null;
    localStorage.removeItem('spw.token');
    updateUserUI(); closeModal('modalProfile');
    renderGalleryScreen();
  });

  $('btnConfirmOk')?.addEventListener('click', () => {
    closeModal('modalConfirm');
    if(confirmCallback){ confirmCallback(); confirmCallback = null; }
  });
  $('welcomeStart')?.addEventListener('click', () => {
    go('pgGallery');
    if(!state.user) openModal('modalAuth');
  });

  $('hexInput')?.addEventListener('change', e => {
    let v = e.target.value.trim();
    if(!v.startsWith('#')) v = '#' + v;
    if(/^#[0-9a-fA-F]{6}$/.test(v)) setColor(v.toUpperCase());
  });
  $('btnAddToPalette')?.addEventListener('click', () => {
    if(!state.palette.includes(color)){ state.palette.push(color); savePalette(); renderPalette(); }
  });

  /* Brush editor */
  $$('.be-tab').forEach(t => t.onclick = () => {
    $$('.be-tab').forEach(x => x.classList.toggle('active', x === t));
    $$('.be-pane').forEach(p => p.classList.toggle('active', p.dataset.bePane === t.dataset.beTab));
  });
  $$('#shapeGrid .shape-item').forEach(el => el.onclick = () => {
    $$('#shapeGrid .shape-item').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    editingBrush.shape = el.dataset.shape;
  });
  $('beSize')?.addEventListener('input', e => { editingBrush.size = +e.target.value; $('beSizeVal').textContent = e.target.value; });
  $('beSizeMin')?.addEventListener('input', e => { editingBrush.sizeMin = +e.target.value; $('beSizeMinVal').textContent = e.target.value; });
  $('beSizeMax')?.addEventListener('input', e => { editingBrush.sizeMax = +e.target.value; $('beSizeMaxVal').textContent = e.target.value; });
  $('beStartSize')?.addEventListener('input', e => { editingBrush.startSize = +e.target.value; $('beStartSizeVal').textContent = e.target.value; });
  $('beEndSize')?.addEventListener('input', e => { editingBrush.endSize = +e.target.value; $('beEndSizeVal').textContent = e.target.value; });
  $('beStartOpac')?.addEventListener('input', e => { editingBrush.startOpacity = +e.target.value; $('beStartOpacVal').textContent = e.target.value; });
  $('beEndOpac')?.addEventListener('input', e => { editingBrush.endOpacity = +e.target.value; $('beEndOpacVal').textContent = e.target.value; });
  $('beHard')?.addEventListener('input', e => { editingBrush.hard = e.target.value / 100; $('beHardVal').textContent = e.target.value; });
  $('beFlow')?.addEventListener('input', e => { editingBrush.flow = e.target.value / 100; $('beFlowVal').textContent = e.target.value; });
  $('beOpac')?.addEventListener('input', e => { editingBrush.opacity = e.target.value / 100; $('beOpacVal').textContent = e.target.value; });
  $('beSmooth')?.addEventListener('input', e => { editingBrush.smooth = e.target.value / 100; $('beSmoothVal').textContent = e.target.value; });
  $('bePressureSize')?.addEventListener('change', e => editingBrush.pressureSize = e.target.checked);
  $('bePressureOpac')?.addEventListener('change', e => editingBrush.pressureOpac = e.target.checked);
  $('beSaveBrush')?.addEventListener('click', saveBrushEditor);
  $('beDeleteBrush')?.addEventListener('click', deleteBrushEditor);

  const menuActions = {
    file: () => {
      const a = prompt('1 — Сохранить в облако\n2 — Опубликовать\n3 — Выйти', '1');
      if(a === '1') saveToCloud(false);
      if(a === '2') saveToCloud(true);
      if(a === '3') exitEditor();
    },
    edit: () => openModal('modalEdit'),
    canvas: () => { $('rzW').value = canvasW; $('rzH').value = canvasH; openModal('modalResize'); },
    select: () => openModal('modalEdit'),
    filter: () => openModal('modalFilters'),
    view: () => fitToScreen(),
    help: () => alert('Горячие клавиши:\nB — Кисть\nE — Ластик\nP — Карандаш\nM — Выделение\nL — Лассо\nW — Волшебная палочка\nV — Перемещение\nG — Заливка\nI — Пипетка\nCtrl+Z/Y — отменить/повторить\nSpace+drag — панорама\nКолесо — зум')
  };
  $$('.menubar .menu-item[data-menu]').forEach(mi => {
    mi.onclick = () => {
      const menu = mi.dataset.menu;
      if(menuActions[menu]) menuActions[menu]();
    };
  });
}

/* ============================================================
   DESELECT helper
   ============================================================ */
function deselect(){ selection = null; lassoPoints = []; drawOverlay(); }
window.deselect = deselect;

/* ============================================================
   BOOT
   ============================================================ */
async function bootApp(){
  if(state.token){
    try {
      const me = await api('/me');
      state.user = me.user;
      updateUserUI();
    } catch {
      state.token = null;
      localStorage.removeItem('spw.token');
    }
  }
  if(state.user) go('pgGallery'); else go('pgWelcome');
}

window.addEventListener('load', async () => {
  log('load');
  syncCanvasSize();
  initColorPicker();
  bindUI();
  renderPalette();
  renderBrushPicker();
  updateCurrentBrushPreview();
  loadBrushToUI(getCurrentBrush());
  setColor(color);
  updateZoomLabel();
  updateCanvasSizeLabel();
  renderHistoryList();
  startRenderLoop();

  window.addEventListener('resize', () => syncCanvasSize());

  setInterval(() => {
    if(projIndex >= 0){ saveProject(); updateThumb(); }
  }, 30000);
  window.addEventListener('beforeunload', () => {
    if(projIndex >= 0) saveProject();
  });

  await bootApp();
  log('Ready. dpr =', dpr);
});