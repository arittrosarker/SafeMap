import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
  import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
  import {
    getDatabase, ref, push, set, onChildAdded, onChildChanged, onChildRemoved,
    runTransaction, get, query, orderByChild, equalTo, update, remove
  } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js';


  const firebaseConfig = {
    apiKey: "AIzaSyAZ-C1YC4NK0MYxNA9FYcsOdZZI0TKwk7U",
    authDomain: "safemap-bf13c.firebaseapp.com",
    databaseURL: "https://safemap-bf13c-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "safemap-bf13c",
    storageBucket: "safemap-bf13c.firebasestorage.app",
    messagingSenderId: "888792507720",
    appId: "1:888792507720:web:28c16f58d4d432c1f2ff7d",
    measurementId: "G-XL060JL52L"
  };

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getDatabase(app);

  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const searchResultsDiv = document.getElementById('searchResults');

  const addModeBtn = document.getElementById('addModeBtn');
  const addLabel = document.getElementById('addLabel');
  const addPanel = document.getElementById('addPanel');
  const exitAdd = document.getElementById('exitAdd');
  const cancelAdd = document.getElementById('cancelAdd');
  const submitAdd = document.getElementById('submitAdd');
  const coordField = document.getElementById('coordField');
  const radiusRange = document.getElementById('radiusRange');
  const radiusValue = document.getElementById('radiusValue');
  const radiusFill = document.getElementById('radiusFill');
  const descField = document.getElementById('desc');
  const categoryField = document.getElementById('category');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const userEmail = document.getElementById('userEmail');
  const locateBtn = document.getElementById('locateBtn');
  const darkModeBtn = document.getElementById('darkModeBtn');
  const myAccountBtn = document.getElementById('myAccountBtn');
  const filterBox = document.getElementById('filterBox');
  const filterToggle = document.getElementById('filterToggle');
  const filterBody = document.getElementById('filterBody');


  const Toast = Swal.mixin({ toast: true, position: 'bottom', showConfirmButton: false, timer: 1600 });
  function showToast(msg, icon='success'){ Toast.fire({ icon, title: msg }); }
  async function confirmSwal(title, text){ const res = await Swal.fire({ title, text, icon:'warning', showCancelButton:true, confirmButtonText:'Yes', cancelButtonText:'Cancel' }); return res.isConfirmed; }
  async function loginPromptSwal(){ const result = await Swal.fire({ title: 'Sign in required', text: 'This action requires Google sign-in. Sign in now?', icon: 'info', showCancelButton: true, confirmButtonText: 'Sign in with Google', cancelButtonText: 'Cancel' }); if(result.isConfirmed) await signInWithGoogle(); }

  
  let addMode = false;
  let pendingLatLng = null;
  let tempCircle = null;
  let searchMarker = null;
  const RED_THRESHOLD = 10;
  const SHOW_CIRCLES_ZOOM = 14;
  const categories = ['harassment','mugging','scam','unsafe_road','other'];
  let activeCategories = new Set(categories);
  const ALLOW_ANON_SUBMIT = false;

  
  const circlesById = new Map();

  
  const lightTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' });
  const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO & OpenStreetMap' });

  const map = L.map('map', { zoomControl: true, minZoom: 11, maxZoom: 18, center:[23.8103,90.4125], zoom:13, layers: [lightTiles] });
  const dhakaBounds = L.latLngBounds([23.680,90.330],[23.900,90.500]);
  map.setMaxBounds(dhakaBounds);

 
  async function signInWithGoogle(){
    try{
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch(err){
      console.error('Sign-in error', err);
      Swal.fire('Sign-in failed','Check console for details','error');
    }
  }
  loginBtn.addEventListener('click', signInWithGoogle);
  logoutBtn.addEventListener('click', async () => { await signOut(auth); showToast('Logged out', 'info'); });


  onAuthStateChanged(auth, async (user) => {
    if(user){
      loginBtn.style.display='none';
      logoutBtn.style.display='inline-block';
      myAccountBtn.style.display='inline-block';
      userEmail.textContent = user.email || user.displayName || 'Signed in';

      try {
        const userRef = ref(db, `users/${user.uid}`);
        const snap = await get(userRef);
        if(!snap.exists()){
          const payload = {
            name: user.displayName || '',
            email: user.email || '',
            photoURL: user.photoURL || '',
            createdAt: Date.now(),
            isAdmin: false
          };
          await set(userRef, payload);
        }
      } catch(e){ console.warn('user onboarding failed', e); }
    } else {
      loginBtn.style.display='inline-block';
      logoutBtn.style.display='none';
      myAccountBtn.style.display='none';
      userEmail.textContent = '';
    }
    for(const [id, circle] of circlesById.entries()){
      if(circle.isPopupOpen()) updatePopupVoteUI(id).catch(e=>console.error(e));
    }
  });


  function enterAddMode(){ addMode = true; addLabel.textContent='Exit add mode'; addModeBtn.classList.add('btn-primary'); map.getContainer().style.cursor='crosshair'; addPanel.style.display='none'; showToast('Add mode: click map to select area'); }
  function exitAddMode(){ addMode = false; addLabel.textContent='Add dangerzone'; addModeBtn.classList.remove('btn-primary'); map.getContainer().style.cursor=''; pendingLatLng=null; coordField.value=''; if(tempCircle){ map.removeLayer(tempCircle); tempCircle=null } addPanel.style.display='none'; }
  addModeBtn.onclick = ()=> addMode ? exitAddMode() : enterAddMode();
  exitAdd.onclick = ()=> exitAddMode();
  cancelAdd.onclick = ()=>{ pendingLatLng=null; coordField.value=''; descField.value=''; if(tempCircle){ map.removeLayer(tempCircle); tempCircle=null } addPanel.style.display='none'; };

  radiusRange.addEventListener('input', e => updateRadiusUI(e.target.value));
  function updateRadiusUI(v){ radiusValue.textContent=`${v}m`; const pct = Math.round(((v - Number(radiusRange.min)) / (Number(radiusRange.max) - Number(radiusRange.min))) * 100); radiusFill.style.width = `${pct}%`; if(tempCircle && pendingLatLng) tempCircle.setRadius(Number(v)); }
  updateRadiusUI(radiusRange.value);

  map.on('click', e => {
    if(!addMode) return;
    pendingLatLng = e.latlng;
    coordField.value = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    const r = Number(radiusRange.value) || 60;
    if(tempCircle) map.removeLayer(tempCircle);
    tempCircle = L.circle(e.latlng, { radius: r, color:'#ff9900', weight:2, fillColor:'#ffea99', fillOpacity:0.35 }).addTo(map);
    addPanel.style.display='block';
  });


  submitAdd.onclick = async () => {
    if(!pendingLatLng){ showToast('Select an area first','warning'); return; }
    const desc = descField.value.trim(); if(!desc){ Swal.fire('Missing description','Please add a short description','warning'); return; }
    const user = auth.currentUser;
    if(!user){
      await loginPromptSwal();
      if(!auth.currentUser) return;
    }
    try{
      const uid = auth.currentUser.uid;
      const category = categoryField.value;
      const radius = Math.max(20, Math.min(200, Number(radiusRange.value)||60));
      const marksRef = ref(db, 'marks');
      const newMarkRef = push(marksRef);
      const now = Date.now();
      const payload = { lat: pendingLatLng.lat, lng: pendingLatLng.lng, radius, category, desc, createdAt: now, createdBy: uid, upvotes:0, downvotes:0, votesCount:0, reports:0 };
      await set(newMarkRef, payload);
      await update(ref(db, `users/${uid}/stats`), { lastMarkedAt: now });
      showToast('Unsafe spot added');
      descField.value=''; coordField.value=''; if(tempCircle){ map.removeLayer(tempCircle); tempCircle=null } pendingLatLng=null; addPanel.style.display='none'; exitAddMode();
    } catch(err){
      console.error(err); Swal.fire('Save failed','Check console','error');
    }
  };


  function scoreToColor(score){ const s=Math.max(0, Math.min(score, RED_THRESHOLD)); const t=s/RED_THRESHOLD; const hue=60*(1-t); return `hsl(${hue},100%,50%)`; }

 
  function createPopupHtml(id, data, currentUid){
    const net = (data.upvotes||0) - (data.downvotes||0);
    const timeStr = data.createdAt ? new Date(data.createdAt).toLocaleString() : 'pending...';

    const showDelete = currentUid && data.createdBy && currentUid === data.createdBy;
    return `
      <div class="popup">
        <div style="font-weight:600">${escapeHtml(capitalize(data.category||'unsafe'))}</div>
        <div style="font-size:12px;color:#555;margin:6px 0">${timeStr} • <span class="badge">Net: ${net}</span></div>
        <div style="margin-bottom:8px">${escapeHtml(data.desc||'')}</div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="vote-btn" data-action="up" data-mark="${id}">Upvote ▲ (<span class="u-count">${data.upvotes||0}</span>)</button>
          <button class="vote-btn" data-action="down" data-mark="${id}">Downvote ▼ (<span class="d-count">${data.downvotes||0}</span>)</button>
          <button class="btn btn-ghost" data-action="report" data-mark="${id}" style="margin-left:8px">Report</button>
          ${ showDelete ? `<button class="btn btn-ghost" data-action="delete" data-mark="${id}" style="margin-left:auto;color:#a00">Delete</button>` : '' }
        </div>
      </div>
    `;
  }

  function attachPopupHandlers(circle, id){
    const popup = circle.getPopup();
    if(!popup) return;
    const node = popup._contentNode;
    if(!node) return;
    const upBtn = node.querySelector('button[data-action="up"]');
    const downBtn = node.querySelector('button[data-action="down"]');
    const reportBtn = node.querySelector('button[data-action="report"]');
    const delBtn = node.querySelector('button[data-action="delete"]');

    if(upBtn) upBtn.onclick = () => window.vote(id, 1);
    if(downBtn) downBtn.onclick = () => window.vote(id, -1);
    if(reportBtn) reportBtn.onclick = () => window.reportMark(id);
    if(delBtn) delBtn.onclick = () => window.deleteMark(id);
  }

  async function updatePopupVoteUI(markId){
    const circle = circlesById.get(markId);
    if(!circle || !circle.isPopupOpen()) return;
    const markSnap = await get(ref(db, `marks/${markId}`));
    const mark = markSnap.exists() ? markSnap.val() : null;
    const popup = circle.getPopup();
    const node = popup && popup._contentNode ? popup._contentNode : null;
    if(!node) return;

    const upSpan = node.querySelector('.u-count');
    const downSpan = node.querySelector('.d-count');
    if(mark){
      if(upSpan) upSpan.textContent = (mark.upvotes||0);
      if(downSpan) downSpan.textContent = (mark.downvotes||0);
    }

    const upBtn = node.querySelector('button[data-action="up"]');
    const downBtn = node.querySelector('button[data-action="down"]');
    if(upBtn) upBtn.classList.remove('upvoted');
    if(downBtn) downBtn.classList.remove('downvoted');

    if(auth.currentUser){
      const uid = auth.currentUser.uid;
      const voteSnap = await get(ref(db, `votes/${markId}/${uid}`));
      const val = voteSnap.exists() ? (voteSnap.val().value || 0) : 0;
      if(val === 1 && upBtn) upBtn.classList.add('upvoted');
      if(val === -1 && downBtn) downBtn.classList.add('downvoted');
    }
  }

  function renderCircle(id, data){
    if(!activeCategories.has(data.category)) { removeCircle(id); return; }
    const net = (data.upvotes||0) - (data.downvotes||0);
    const color = scoreToColor(net);
    let circle = circlesById.get(id);
    if(!circle){
      circle = L.circle([data.lat, data.lng], { radius: data.radius||60, color, weight:2, fillColor: color, fillOpacity:0.28 }).addTo(map);
      circle.on('click', () => { if(addMode) return; circle.openPopup(); });
      circle.on('popupopen', async () => {
        try {
          const snap = await get(ref(db, `marks/${id}`));
          const fresh = snap.exists() ? snap.val() : data;
          const currentUid = auth.currentUser ? auth.currentUser.uid : null;
          circle.getPopup().setContent(createPopupHtml(id, fresh, currentUid));
          attachPopupHandlers(circle, id);
          await updatePopupVoteUI(id);
        } catch(err){ console.error('popupopen update error', err); }
      });
      circlesById.set(id, circle);
    } else {
      circle.setLatLng([data.lat, data.lng]);
      circle.setRadius(data.radius || 60);
      circle.setStyle({ color, fillColor: color });
    }

    const currentUid = auth.currentUser ? auth.currentUser.uid : null;
    if(circle.getPopup()){
      if(circle.isPopupOpen()){
        circle.getPopup().setContent(createPopupHtml(id, data, currentUid));
        attachPopupHandlers(circle, id);
        updatePopupVoteUI(id).catch(e=>console.error(e));
      } else {
        circle.getPopup().setContent(createPopupHtml(id, data, currentUid));
      }
    } else {
      circle.bindPopup(createPopupHtml(id, data, currentUid), { maxWidth: 420 });
    }
  }

  function removeCircle(id){ const c = circlesById.get(id); if(c){ map.removeLayer(c); circlesById.delete(id); } }


  const marksRef = ref(db,'marks');
  onChildAdded(marksRef, snap => renderCircle(snap.key, snap.val()));
  onChildChanged(marksRef, snap => {
    renderCircle(snap.key, snap.val());
    const c = circlesById.get(snap.key);
    if(c && c.isPopupOpen()) updatePopupVoteUI(snap.key).catch(e=>console.error(e));
  });
  onChildRemoved(marksRef, snap => removeCircle(snap.key));


  window.vote = async (markId, delta) => {
    if(!auth.currentUser){
      await loginPromptSwal();
      if(!auth.currentUser) return;
    }
    try{
      const uid = auth.currentUser.uid;
      const voteRef = ref(db, `votes/${markId}/${uid}`);
      const voteSnap = await get(voteRef);
      const prev = voteSnap.exists() ? (voteSnap.val().value || 0) : 0;

      if(prev === delta){

        await runTransaction(ref(db, `marks/${markId}`), cur => {
          if(cur === null) return cur;
          cur.upvotes = cur.upvotes || 0;
          cur.downvotes = cur.downvotes || 0;
          if(prev === 1) cur.upvotes = Math.max(0, cur.upvotes - 1);
          if(prev === -1) cur.downvotes = Math.max(0, cur.downvotes - 1);
          cur.votesCount = (cur.upvotes||0) + (cur.downvotes||0);
          cur.score = (cur.upvotes||0) - (cur.downvotes||0);
          return cur;
        });
        await set(voteRef, null);
        showToast('Vote removed');
      } else {

        await runTransaction(ref(db, `marks/${markId}`), cur => {
          if(cur === null) return cur;
          cur.upvotes = cur.upvotes || 0;
          cur.downvotes = cur.downvotes || 0;
          if(prev === 1) cur.upvotes = Math.max(0, cur.upvotes - 1);
          if(prev === -1) cur.downvotes = Math.max(0, cur.downvotes - 1);
          if(delta === 1) cur.upvotes++;
          if(delta === -1) cur.downvotes++;
          cur.votesCount = (cur.upvotes||0) + (cur.downvotes||0);
          cur.score = (cur.upvotes||0) - (cur.downvotes||0);
          return cur;
        });
        await set(voteRef, { value: delta, ts: Date.now(), uid });
        showToast('Vote saved');
      }


      updatePopupVoteUI(markId).catch(e=>console.error(e));

    } catch(err){
      console.error('vote error', err);
      Swal.fire('Vote failed','See console','error');
    }
  };


  window.reportMark = async (markId) => {
    if(!auth.currentUser){ await loginPromptSwal(); if(!auth.currentUser) return; }
    const uid = auth.currentUser.uid;
    const repRef = ref(db, `reports/${markId}/${uid}`);
    const repSnap = await get(repRef);
    if(repSnap.exists()){ showToast('You already reported this', 'info'); return; }
    try{
      await set(repRef, { ts: Date.now(), uid });
      await runTransaction(ref(db, `marks/${markId}/reports`), cur => (cur||0) + 1);
      showToast('Reported — admins will review');
    } catch(e){ console.error(e); Swal.fire('Report failed','See console','error'); }
  };



  window.deleteMark = async (markId) => {
    if(!auth.currentUser){ await loginPromptSwal(); if(!auth.currentUser) return; }
    const uid = auth.currentUser.uid;
    try{
      const markSnap = await get(ref(db, `marks/${markId}`));
      if(!markSnap.exists()){ showToast('Mark not found','error'); return; }
      const mark = markSnap.val();
      if(mark.createdBy !== uid){
        Swal.fire('Not allowed','Only the creator can delete this mark','error');
        return;
      }
      const ok = await confirmSwal('Delete mark?', 'This will remove the mark permanently.');
      if(!ok) return;
      await remove(ref(db, `marks/${markId}`));
      try{ await remove(ref(db, `votes/${markId}`)); } catch(e){ console.warn('cleanup votes failed', e); }
      try{ await remove(ref(db, `reports/${markId}`)); } catch(e){ console.warn('cleanup reports failed', e); }
      showToast('Deleted');
    } catch(err){ console.error('deleteMark error', err); Swal.fire('Delete failed','See console for details','error'); }
  };


  let lastSearchController = null;
  async function searchPlace(query){
    if(!query || query.trim().length===0) return showSearchResults([]);
    if(lastSearchController) lastSearchController.abort();
    lastSearchController = new AbortController();
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(query)}&addressdetails=1&countrycodes=bd`;
    try{
      const res = await fetch(url, { signal: lastSearchController.signal, headers:{ 'Accept-Language':'en' } });
      const json = await res.json();
      showSearchResults(json || []);
    }catch(e){
      if(e.name!=='AbortError') console.error('Search error', e);
      showSearchResults([]);
    }
  }

  function showSearchResults(items){
    searchResultsDiv.innerHTML = '';
    if(!items || items.length===0){ searchResultsDiv.style.display='none'; return; }
    for(const it of items){
      const name = it.display_name || `${it.lat},${it.lon}`;
      const div = document.createElement('div');
      div.className = 'search-item';
      div.innerHTML = `<div style="font-weight:600">${escapeHtml(name)}</div><div style="font-size:12px;color:#666">${escapeHtml((it.type||'') + (it.class? ' • ' + it.class : ''))}</div>`;
      div.onclick = () => {
        const lat = parseFloat(it.lat), lon = parseFloat(it.lon);
        map.setView([lat,lon], 16);
        if(searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
        searchMarker = L.marker([lat,lon]).addTo(map).bindPopup(name).openPopup();
        searchResultsDiv.style.display='none';
      };
      searchResultsDiv.appendChild(div);
    }
    searchResultsDiv.style.display = 'block';
  }

  // Mobile search overlay logic
const mobileSearchBtn = document.getElementById('mobileSearchBtn');
const mobileSearchOverlay = document.getElementById('mobileSearchOverlay');
const mobileSearchInput = document.getElementById('mobileSearchInput');
const mobileSearchClose = document.getElementById('mobileSearchClose');
const mobileSearchResults = document.getElementById('mobileSearchResults');

// Show overlay on mobile search icon click
if (mobileSearchBtn && mobileSearchOverlay) {
  mobileSearchBtn.addEventListener('click', () => {
    mobileSearchOverlay.classList.add('active');
    setTimeout(() => mobileSearchInput && mobileSearchInput.focus(), 100);
  });
}
if (mobileSearchClose && mobileSearchOverlay) {
  mobileSearchClose.addEventListener('click', () => {
    mobileSearchOverlay.classList.remove('active');
    mobileSearchInput.value = '';
    mobileSearchResults.innerHTML = '';
  });
}

// Mobile search logic (reuse searchPlace)
function showMobileSearchResults(items) {
  mobileSearchResults.innerHTML = '';
  if (!items || items.length === 0) {
    mobileSearchResults.innerHTML = '<div style="padding:18px;color:#888;">No results found.</div>';
    return;
  }
  for (const it of items) {
    const name = it.display_name || `${it.lat},${it.lon}`;
    const div = document.createElement('div');
    div.className = 'mobile-search-result';
    div.innerHTML = `<div style="font-weight:600">${escapeHtml(name)}</div><div style="font-size:13px;color:#666">${escapeHtml((it.type||'') + (it.class? ' • ' + it.class : ''))}</div>`;
    div.onclick = () => {
      const lat = parseFloat(it.lat), lon = parseFloat(it.lon);
      map.setView([lat,lon], 16);
      if(searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
      searchMarker = L.marker([lat,lon]).addTo(map).bindPopup(name).openPopup();
      mobileSearchOverlay.classList.remove('active');
      mobileSearchInput.value = '';
      mobileSearchResults.innerHTML = '';
    };
    mobileSearchResults.appendChild(div);
  }
}
let lastMobileSearchController = null;
async function mobileSearchPlace(query){
  if(!query || query.trim().length===0) {
    mobileSearchResults.innerHTML = '';
    return;
  }
  if(lastMobileSearchController) lastMobileSearchController.abort();
  lastMobileSearchController = new AbortController();
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(query)}&addressdetails=1&countrycodes=bd`;
  try{
    const res = await fetch(url, { signal: lastMobileSearchController.signal, headers:{ 'Accept-Language':'en' } });
    const json = await res.json();
    showMobileSearchResults(json || []);
  }catch(e){
    if(e.name!=='AbortError') console.error('Search error', e);
    mobileSearchResults.innerHTML = '';
  }
}
function debounceMobile(fn, wait){
  let t = null;
  return function(...args){ clearTimeout(t); t = setTimeout(()=> fn.apply(this,args), wait); };
}
const debouncedMobileSearch = debounceMobile((q)=> mobileSearchPlace(q), 240);
if (mobileSearchInput) {
  mobileSearchInput.addEventListener('keydown', e => {
    if(e.key === 'Enter') { mobileSearchPlace(mobileSearchInput.value); e.preventDefault(); }
  });
  mobileSearchInput.addEventListener('input', (e) => { debouncedMobileSearch(e.target.value); });
}

// Hide overlay if user taps outside the search bar/results
if (mobileSearchOverlay) {
  mobileSearchOverlay.addEventListener('click', (e) => {
    if (e.target === mobileSearchOverlay) {
      mobileSearchOverlay.classList.remove('active');
      mobileSearchInput.value = '';
      mobileSearchResults.innerHTML = '';
    }
  });
}


  function debounce(fn, wait){
    let t = null;
    return function(...args){ clearTimeout(t); t = setTimeout(()=> fn.apply(this,args), wait); };
  }
  const debouncedSearch = debounce((q)=> searchPlace(q), 240);
  searchBtn.onclick = () => searchPlace(searchInput.value);
  searchInput.addEventListener('keydown', e => { if(e.key === 'Enter') { searchPlace(searchInput.value); e.preventDefault(); } });
  searchInput.addEventListener('input', (e) => { debouncedSearch(e.target.value); });
  document.addEventListener('click', e => { if(!searchResultsDiv.contains(e.target) && e.target !== searchInput && e.target !== searchBtn) searchResultsDiv.style.display='none'; });

  function secureOrigin(){ return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'; }
  function updateLocate(latlng, accuracy){
    if(window.locateMarker) window.locateMarker.setLatLng(latlng); else window.locateMarker = L.circleMarker(latlng,{ radius:8, color:'#007bff', fillColor:'#007bff', fillOpacity:1 }).addTo(map);
    if(window.accuracyCircle){ window.accuracyCircle.setLatLng(latlng); window.accuracyCircle.setRadius(accuracy); } else { window.accuracyCircle = L.circle(latlng,{ radius:accuracy, color:'#007bff', weight:1, fillColor:'#cfeaff', fillOpacity:0.25 }).addTo(map); }
    window.locateMarker.bindPopup('You are here').openPopup();
  }

  async function initStartLocation(){
    if(!('geolocation' in navigator)){ map.setView([23.8103,90.4125],13); return; }
    if(!secureOrigin()){ map.setView([23.8103,90.4125],13); console.warn('Serve via HTTPS or localhost for GPS'); return; }
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        map.setView([lat,lng], 15);
        updateLocate([lat,lng], pos.coords.accuracy);
        resolve(true);
      }, err => { map.setView([23.8103,90.4125],13); resolve(false); }, { enableHighAccuracy:true, timeout:8000, maximumAge:60000 });
    });
  }

  function locateOnce(){ if(!('geolocation' in navigator)){ Swal.fire('Geolocation not supported'); return } if(!secureOrigin()){ Swal.fire('Open via HTTPS or localhost'); return } navigator.geolocation.getCurrentPosition(pos => { const ll=[pos.coords.latitude,pos.coords.longitude]; updateLocate(ll,pos.coords.accuracy); map.setView(ll,16); }, (err)=>{ Swal.fire('Location denied/unavailable'); }, { enableHighAccuracy:true, timeout:10000, maximumAge:10000 }); }

  locateBtn.addEventListener('click', locateOnce);
  document.addEventListener('keydown', e => { if(e.key==='l' || e.key==='L') locateOnce(); });


  (function createLocateControl(){
    const Locate = L.Control.extend({
      options:{ position:'topright' },
      onAdd(){
        const wrap = L.DomUtil.create('div','leaflet-control-locate');
        const btn = L.DomUtil.create('button','locate-btn',wrap);
        btn.title='Locate (click) • Right-click toggle follow';
        btn.innerHTML = `<img src="./gps.png" alt="gps">`;
        const span = L.DomUtil.create('span','follow-indicator',wrap);
        span.textContent='';
        L.DomEvent.disableClickPropagation(wrap);
        btn.onclick = () => locateOnce();
        wrap.oncontextmenu = (ev)=>{ ev.preventDefault(); const following = !!window._follow; window._follow = !following; span.textContent = window._follow ? '• following' : ''; if(window._follow){ window._watchId = navigator.geolocation.watchPosition(p=>{ updateLocate([p.coords.latitude,p.coords.longitude], p.coords.accuracy); map.setView([p.coords.latitude,p.coords.longitude]); }, e=>console.warn(e), { enableHighAccuracy:true, maximumAge:10000 }); } else { if(window._watchId) navigator.geolocation.clearWatch(window._watchId); window._watchId = null; } };
        return wrap;
      }
    });
    map.addControl(new Locate());
  })();

  initStartLocation();

 
  let darkMode = false;
  darkModeBtn.addEventListener('click', () => {
    darkMode = !darkMode;
    document.body.classList.toggle('dark-mode', darkMode);
    if(darkMode){
      map.removeLayer(lightTiles); map.addLayer(darkTiles);
      document.documentElement.style.setProperty('--ui-bg','#0b1220');
      document.documentElement.style.setProperty('--muted','#bbb');
    } else {
      map.removeLayer(darkTiles); map.addLayer(lightTiles);
      document.documentElement.style.setProperty('--ui-bg','#fff');
      document.documentElement.style.setProperty('--muted','#666');
    }
  });


  filterToggle.addEventListener('click', () => {
    // Toggle collapsed class on click
    filterBox.classList.toggle('collapsed');
  });
  const filterCheckboxes = filterBody.querySelectorAll('input[type=checkbox][data-cat]');
  filterCheckboxes.forEach(cb=>{
    cb.addEventListener('change', ()=> {
      const cat = cb.getAttribute('data-cat');
      if(cb.checked) activeCategories.add(cat); else activeCategories.delete(cat);
      for(const [id, circle] of circlesById.entries()){
        (async ()=>{
          try {
            const snap = await get(ref(db, `marks/${id}`));
            if(!snap.exists()) return;
            const d = snap.val();
            if(activeCategories.has(d.category)){
              if(!map.hasLayer(circle)) circle.addTo(map);
            } else {
              if(map.hasLayer(circle)) map.removeLayer(circle);
            }
          } catch(e){ console.error('filter change error', e); }
        })();
      }
    });
  });


  myAccountBtn.addEventListener('click', async () => {
    if(!auth.currentUser){ await loginPromptSwal(); if(!auth.currentUser) return; }
    const uid = auth.currentUser.uid;
    try{
      const userSnap = await get(ref(db, `users/${uid}`));
      const profile = userSnap.exists() ? userSnap.val() : { name: auth.currentUser.displayName||'', email: auth.currentUser.email||'' };
      const q = query(ref(db, 'marks'), orderByChild('createdBy'), equalTo(uid));
      const marksSnap = await get(q);
      let marksCount = 0, totalUp=0, totalDown=0, net=0;
      if(marksSnap.exists()){
        const marks = marksSnap.val();
        marksCount = Object.keys(marks).length;
        for(const k of Object.keys(marks)){ totalUp += (marks[k].upvotes||0); totalDown += (marks[k].downvotes||0); }
        net = totalUp - totalDown;
      }
      const html = `
        <div style="text-align:left">
          <div><strong>Name:</strong> ${escapeHtml(profile.name||'')}</div>
          <div><strong>Email:</strong> ${escapeHtml(profile.email||'')}</div>
          <div style="margin-top:10px"><strong>Your marks:</strong> ${marksCount}</div>
          <div><strong>Total upvotes received:</strong> ${totalUp}</div>
          <div><strong>Total downvotes received:</strong> ${totalDown}</div>
          <div><strong>Net score:</strong> ${net}</div>
          <div style="margin-top:10px;font-size:12px;color:#666">Tip: you can export your marks in the admin panel later.</div>
        </div>
      `;
      await Swal.fire({ title: 'My account', html, width: 520, showCloseButton:true, confirmButtonText:'Close' });
    } catch(err){
      console.error(err); Swal.fire('Failed','See console','error');
    }
  });

  // Legend collapsible on mobile
  const legend = document.getElementById('legend');
  const legendToggle = document.getElementById('legendToggle');
  if (legend && legendToggle) {
    let legendCollapsed = window.innerWidth <= 600;
    function updateLegendState() {
      if (window.innerWidth <= 600) {
        legend.classList.toggle('collapsed', legendCollapsed);
        legendToggle.style.display = 'block';
      } else {
        legend.classList.remove('collapsed');
        legendToggle.style.display = 'none';
      }
    }
    legendToggle.addEventListener('click', () => {
      legendCollapsed = !legendCollapsed;
      updateLegendState();
    });
    window.addEventListener('resize', updateLegendState);
    updateLegendState();
  }

  // Ensure map resizes with viewport changes
  window.addEventListener('resize', () => {
    if (window.L && window.L.Map && map && map.invalidateSize) {
      setTimeout(() => map.invalidateSize(), 200);
    }
  });


  function capitalize(s){ return (s||'').charAt(0).toUpperCase() + (s||'').slice(1).replace('_',' ') }
  function escapeHtml(str){ return (str||'').toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  window.__fs = { db, circlesById };
