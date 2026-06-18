/* ====================================================================
   KRMAS Roster — App Logic (v2: KRMAS branding + lesson plans)
   ==================================================================== */

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const ACTIVE_DAYS = [1, 2, 3, 4, 6]; // Edgeworth default; overridden by getActiveDays()

function getActiveDays() {
  // Check custom overlay first (admin-edited active days)
  const custom = state.customSchools[state.schoolId];
  if (custom?.activeDays && custom.activeDays.length > 0) return custom.activeDays;
  // Then check seed data
  const seed = SCHOOL_DATA_SEED[state.schoolId];
  if (seed?.activeDays && seed.activeDays.length > 0) return seed.activeDays;
  // Derive from schedule
  const sched = currentSchedule();
  const days = [...new Set(sched.map(c => c.day))].sort((a, b) => a - b);
  return days.length > 0 ? days : ACTIVE_DAYS;
}

const state = {
  schoolId: 'edgeworth',
  currentDate: null,
  selectedDay: 1,
  view: 'feed',
  user: null,
  edits: {},
  plans: {},
  incidents: {},
  students: {},
  progressions: {},
  pathways: {},
  pinInput: '',
  editingKey: null,
  planningKey: null,
  customSchools: {},   // school_id → { instructors, schedule, defaults, contact }
  roleConfig: { roles: [], perms: {}, _loaded: false },  // custom roles + permission matrix
  impersonation: null,  // { real, realSchoolId, target } while a user is viewing-as someone
  wizardStep: 0,
  wizardData: null,
  editingProgressionId: null,
  progResultsCache: null,
  editingIncidentId: null,
  editingPathwayId: null,
  selectedPathwayYear: null,
  editingStudentId: null,
  pinOverrides: {},
  pinChangeStage: 'current',
  pinChangeBuffer: '',
  pinChangeNew: '',
  pinLockBuffer: '',
  grading: {},
  gradingSessionId: null,
  editingGradingSessionId: null,
  gradingView: 'sessions',
  editingCandidateIdx: null,
  stocktake: {},
  notices: [],           // school-level notices
  networkNotices: [],    // network-wide notices (superadmin)
  dismissedNotices: new Set(), // dismissed this session
  editingNoticeId: null,
  // Feed
  feed: [],              // loaded posts
  feedLoading: false,
  feedHasMore: true,
  myLikes: new Set(),    // post ids liked by current user
  myAcks: new Set(),     // required-reading post ids acknowledged by current user
  expandedComments: new Set(), // post ids with comments visible
  realtimeChannel: null,
  // Groups
  groups: [],
  editingGroupId: null,
  editingPostId: null,
  // Class assignments  [ {school_id, slot_key, instructor_id, role} ]
  classAssignments: [],
  // Calendar
  calendarEvents: [],
  eventTypes: [],
  calMonth: null,        // Date anchored to displayed month
  calSelectedDate: null, // ISO date tapped in grid
  editingEventId: null,
  lastLogins: {},        // instructorId → ISO timestamp of last login (this school)
  documents: [],         // uploaded PDFs (syllabuses, policies, etc.)
  myDocuments: [],       // personal (instructor-scoped) documents for the current user
  personalDocsList: [],  // docs shown in the personal-docs modal (self or admin viewing another)
  personalDocsTarget: null, // instructor id whose personal docs are open
  editingUserId: null,   // user being edited in User Management
  plansSearch: '',       // Plans view search query
  incidentSearch: '',    // Incidents view search query
  onboardingChecklists: [], // per-instructor onboarding progress
  classTypeOverrides: {}, // { label: classTypeKey } per school — admin overrides for guessClassType
  complianceReqs: [],    // compliance requirement definitions
  complianceRecords: []  // per-instructor compliance status
};

// ---------- Permission helpers ----------
// Role hierarchy: superadmin > admin > instructor > junior > guest(null)
const ROLE_RANK = { superadmin: 4, admin: 3, instructor: 2, junior: 1 };

function userRole()          { return state.user?.role || 'guest'; }
function roleRank(role)      { return ROLE_RANK[role] || 0; }
function hasRole(minRole)    { return roleRank(userRole()) >= roleRank(minRole); }

// Sections locked to admin+ and never customizable — the structural floor, mirrored
// from is_structural_section() in SQL. role_permissions can never grant these.
const STRUCTURAL_SECTIONS = ['timetable', 'school', 'roster-edit', 'logins'];
// Seed-matching defaults, used ONLY before the live role config has loaded. The DB RLS
// (has_perm) is the real gate; this just keeps UI gating sensible during that window.
const DEFAULT_PERMS = {
  instructor: { feed:{view:1,add:1}, notices:{view:1}, calendar:{view:1}, documents:{view:1},
    compliance:{view:1}, students:{view:1,add:1,edit:1}, incidents:{view:1,add:1},
    grading:{view:1}, groups:{view:1}, roster:{view:1},
    'lesson-plans':{view:1,edit:1}, 'roster-edits':{view:1,edit:1} },
  junior: { feed:{view:1,add:1}, notices:{view:1}, calendar:{view:1}, documents:{view:1},
    students:{add:1,edit:1}, incidents:{add:1}, groups:{view:1}, roster:{view:1},
    'lesson-plans':{view:1,edit:1}, 'roster-edits':{view:1,edit:1} },
};
// Client mirror of the SQL has_perm(section, action). Drives which buttons show; the
// database enforces the same logic for real.
function hasPerm(section, action) {
  const role = userRole();
  if (role === 'superadmin') return true;
  if (STRUCTURAL_SECTIONS.indexOf(section) !== -1) return hasRole('admin');
  if (role === 'admin') return true;
  const rc = state.roleConfig;
  if (rc && rc._loaded) {                         // live config is authoritative once loaded
    const p = rc.perms && rc.perms[role];
    return !!(p && p[section] && p[section][action]);
  }
  const def = DEFAULT_PERMS[role];                // pre-load fallback
  return !!(def && def[section] && def[section][action]);
}

// Single source of truth for every permission check. Operational entries consult the
// permission matrix via hasPerm; structural + kv-namespace entries stay rank-based
// (their server-side gate is the structural floor / kv_min_role, not role_permissions).
const can = {
  editRoster:        () => hasRole('admin'),
  editPlans:         () => hasRole('junior'),
  deletePlans:       () => hasRole('instructor'),
  viewIncidents:     () => hasPerm('incidents','view'),
  fileIncidents:     () => hasPerm('incidents','add'),
  editIncidents:     () => hasPerm('incidents','edit'),
  deleteIncidents:   () => hasPerm('incidents','delete'),
  volunteerCover:    () => hasRole('junior'),
  markNeedsCover:    () => hasRole('instructor'),
  viewStudents:      () => hasPerm('students','view'),
  addStudents:       () => hasPerm('students','add'),
  editStudents:      () => hasPerm('students','edit'),
  deleteStudents:    () => hasPerm('students','delete'),
  postFeed:          () => hasPerm('feed','add'),
  manageNotices:     () => hasPerm('notices','add'),
  editNotices:       () => hasPerm('notices','edit'),
  deleteNotices:     () => hasPerm('notices','delete'),
  manageCalendar:    () => hasPerm('calendar','add'),
  editCalendar:      () => hasPerm('calendar','edit'),
  deleteCalendar:    () => hasPerm('calendar','delete'),
  manageDocuments:   () => hasPerm('documents','add'),
  manageCompliance:  () => hasPerm('compliance','add'),
  manageGroups:      () => hasPerm('groups','add'),
  editGroups:        () => hasPerm('groups','edit'),
  deleteGroups:      () => hasPerm('groups','delete'),
  managePathway:     () => hasRole('admin'),
  manageGrading:     () => hasRole('admin'),
  viewGrading:       () => hasRole('instructor'),
  manageStocktake:   () => hasRole('admin'),
  exportRoster:      () => hasRole('admin'),
  changePin:         () => hasRole('junior'),
  manageInstructors: () => hasRole('admin'),
  switchAnySchool:   () => hasRole('superadmin'),
  manageRoles:       () => hasRole('superadmin'),
  viewAuditLog:      () => hasRole('admin'),
};

// A school admin may edit only their own school; a superadmin may edit any.
function canEditSchool(schoolId) {
  if (!hasRole('admin')) return false;
  if (can.switchAnySchool()) return true;
  return !!schoolId && schoolId === state.schoolId;
}

function requireRole(minRole, msg) {
  if (!hasRole(minRole)) {
    if (!state.user) { openLogin(); return false; }
    alert(msg || 'You don\'t have permission for that.');
    return false;
  }
  return true;
}

function roleBadge(role) {
  const map = {
    superadmin: { bg: '#d62828', text: '#fff', label: 'Superadmin' },
    admin:      { bg: '#1a1a1a', text: '#fff', label: 'Admin' },
    instructor: { bg: '#3b82f6', text: '#fff', label: 'Instructor' },
    junior:     { bg: '#8b5cf6', text: '#fff', label: 'Junior' },
  };
  let c = map[role];
  if (!c) {
    // Custom role — show its configured label (falls back to the key) in a distinct colour.
    const cr = ((state.roleConfig && state.roleConfig.roles) || []).find(r => r.key === role);
    c = { bg: '#0d9488', text: '#fff', label: (cr && cr.label) || role || 'Guest' };
  }
  return `<span style="display:inline-block;background:${c.bg};color:${c.text};font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.05em;font-family:'Open Sans',sans-serif;">${escapeHtml(c.label)}</span>`;
}

// ---------- Avatars / profile pictures ----------
function initial(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }

// Render an avatar from an instructor-like object ({avatar, name}). Falls back to an initial.
function avatarHtml(instr, size = 36) {
  const dim = `width:${size}px;height:${size}px;`;
  if (instr && instr.avatar) {
    return `<img class="avatar-img" src="${instr.avatar}" alt="" style="${dim}">`;
  }
  const fs = Math.round(size * 0.42);
  return `<span class="avatar-ph" style="${dim}font-size:${fs}px;">${escapeHtml(initial(instr?.name))}</span>`;
}

// Render an avatar by instructor id (resolves against the current school roster).
function avatarById(id, fallbackName, size = 36) {
  const instr = id ? allInstructors().find(i => i.id === id) : null;
  return avatarHtml(instr || { name: fallbackName }, size);
}

// Feed/comment avatar — keeps the existing class for sizing, swaps in a photo when available.
function feedAvatarHtml(authorId, authorName, cls) {
  const instr = authorId ? allInstructors().find(i => i.id === authorId) : null;
  if (instr && instr.avatar) return `<img class="${cls} avatar-img" src="${instr.avatar}" alt="">`;
  return `<div class="${cls}">${escapeHtml(initial(instr?.name || authorName))}</div>`;
}

// ---------- Custom-instructor overlay helper ----------
// Ensures state.customSchools[schoolId].instructors exists (seeded from current
// merged roster the first time) and returns that mutable array. Used by every
// path that edits instructor records so seed + custom schools behave identically.
function ensureCustomInstructors() {
  const sid = state.schoolId;
  if (!state.customSchools[sid] || !Array.isArray(state.customSchools[sid].instructors) || state.customSchools[sid].instructors.length === 0) {
    const seed = SCHOOL_DATA_SEED[sid];
    const base = allInstructors();
    state.customSchools[sid] = {
      instructors: JSON.parse(JSON.stringify(base.length ? base : (seed?.instructors || []))),
      schedule: state.customSchools[sid]?.schedule || [],
      defaults: state.customSchools[sid]?.defaults || {},
      contact:  state.customSchools[sid]?.contact  || seed?.contact || {},
    };
  } else if (!state.customSchools[sid].instructors.length) {
    state.customSchools[sid].instructors = JSON.parse(JSON.stringify(allInstructors()));
  }
  return state.customSchools[sid].instructors;
}

// ---------- Navigate the roster to a specific ISO date ----------
function goToRosterDate(iso) {
  if (!iso) { setView('roster'); return; }
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) { setView('roster'); return; }
  state.currentDate = startOfWeek(d);
  state.selectedDay = d.getDay();
  setView('roster');
  renderDayTabs();
  renderWeekMeta();
  renderDay();
}

// ---------- Plan edit permission (change 2) ----------
// Network-shared plans: superadmin only. Grading plans: grading managers.
// Otherwise editable by roster admins OR the instructors rostered on that class.
function canEditPlan(dateKey) {
  if (!state.user) return false;
  const p = state.plans[dateKey];
  if (p && p.shared) return can.switchAnySchool();
  if (typeof dateKey === 'string' && dateKey.startsWith('grading-')) return can.manageGrading();
  if (can.editRoster()) return true;
  // Rostered instructor for that class may edit their own plan
  const datePart = (dateKey || '').slice(0, 10);
  const date = new Date(datePart + 'T00:00:00');
  if (isNaN(date)) return can.editRoster();
  const c = rosterForDay(date).find(x => x.dateKey === dateKey);
  if (!c) return can.editRoster();
  return isMyClass(c);
}

// ---------- School data accessor ----------
function getSchoolData(schoolId) {
  schoolId = schoolId || state.schoolId;
  const seed = SCHOOL_DATA_SEED[schoolId] || null;
  const custom = state.customSchools?.[schoolId] || null;
  if (!seed && !custom) return null;
  if (!seed) return custom;
  if (!custom) return seed;
  // Merge: custom data (schedule, instructors, defaults, contact) overlays the seed.
  // A non-empty custom.schedule means the timetable has been edited for this school
  // (saveScheduleSlot copies the seed in first), so it takes precedence — otherwise
  // edits to seeded schools like Edgeworth would silently never apply.
  return {
    ...seed,
    schedule:    (custom.schedule && custom.schedule.length) ? custom.schedule : (seed.schedule || []),
    instructors: custom.instructors?.length ? custom.instructors : (seed.instructors || []),
    defaults:    custom.defaults    ? custom.defaults    : (seed.defaults || {}),
    contact:     custom.contact     ? custom.contact     : (seed.contact || {}),
  };
}

function isSchoolConfigured(schoolId) {
  const data = getSchoolData(schoolId);
  // A school is "configured" if it has either a seeded schedule with classes,
  // or has been set up via the wizard (has instructors)
  if (!data) return false;
  if (data.instructors && data.instructors.length > 0) return true;
  if (data.schedule && data.schedule.length > 0) return true;
  return false;
}

function currentInstructors() {
  const data = getSchoolData();
  const all = data ? data.instructors : [];
  // Filter out inactive AND on-leave instructors from active roster assignments
  return all.filter(i => i.active !== false && i.status !== 'leave');
}

function allInstructors() {
  // For the manager — includes inactive and on-leave
  const data = getSchoolData();
  return data ? data.instructors : [];
}

// Every instructor across every school, each tagged with their home school. Custom-schools
// is loaded globally, so all rosters are available even when not the active school. Used
// for superadmin network groups that can contain anyone from any location.
function allInstructorsAllSchools() {
  const out = [];
  const seen = new Set();
  const schools = KRMAS_SCHOOLS.slice();
  for (const sid of Object.keys(state.customSchools || {})) {
    if (!schools.find(s => s.id === sid)) {
      schools.push({ id: sid, name: (state.customSchools[sid] && state.customSchools[sid].name) || sid });
    }
  }
  for (const sc of schools) {
    const data = getSchoolData(sc.id);
    for (const i of (data && data.instructors ? data.instructors : [])) {
      const key = sc.id + ':' + i.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...i, schoolId: sc.id, schoolName: sc.name || sc.id });
    }
  }
  return out;
}

function currentSchedule() {
  const data = getSchoolData();
  return data ? data.schedule : [];
}

function currentDefaults() {
  const data = getSchoolData();
  return data ? data.defaults : {};
}

function currentContact() {
  const data = getSchoolData();
  return data ? data.contact : {};
}

// ---------- Grading helpers ----------
function gradingsInRange(fromDate, toDate) {
  return GRADING_DATES.filter(g => {
    const d = new Date(g.date + 'T00:00:00');
    return d >= fromDate && d <= toDate;
  });
}

function nextGradingForDate(date) {
  // Returns the next grading event within 28 days, or null
  const limit = addDays(date, 28);
  const upcoming = GRADING_DATES
    .map(g => ({ ...g, _d: new Date(g.date + 'T00:00:00') }))
    .filter(g => g._d >= date && g._d <= limit)
    .sort((a, b) => a._d - b._d);
  return upcoming[0] || null;
}

function isGradingPrepClass(c, date) {
  // A class is "grading prep" if it's within 28 days of an upcoming grading
  // AND it's a grade-eligible class type (not S&C, plates, finisher etc.)
  const eligibleTypes = ['mini-ninjas','little-ninjas','karate','kids-kata','kata','basics-kata','jr-muay-thai','muay-thai','ladies-mt','mma-sanda','jiu-jitsu','kobudo'];
  if (!eligibleTypes.includes(c.type)) return false;
  return !!nextGradingForDate(date);
}

// ---------- Persistence (via DB adapter) ----------
async function loadEdits()       { state.edits     = (await DB.loadEdits(state.schoolId))     || {}; }
async function saveEdits()       { await DB.saveEdits(state.schoolId, state.edits); }
async function loadPlans() {
  const own = (await DB.loadPlans(state.schoolId)) || {};
  const net = (await DB.loadNetworkPlans()) || {};
  // Tag network-shared plans so the editor + permissions know their scope.
  for (const k of Object.keys(net)) { net[k] = { ...net[k], shared: true }; }
  for (const k of Object.keys(own)) { if (own[k]) delete own[k].shared; }
  state.plans = { ...own, ...net }; // network entries win on key collision
}
async function savePlans() {
  const own = {}, net = {};
  for (const [k, v] of Object.entries(state.plans)) {
    if (v && v.shared) net[k] = v; else own[k] = v;
  }
  await DB.savePlans(state.schoolId, own);
  // Only superadmins manage the shared network store — avoids non-admins clobbering it.
  if (can.switchAnySchool()) await DB.saveNetworkPlans(net);
}
async function loadIncidents()   { state.incidents = (await DB.loadIncidents(state.schoolId)) || {}; }
async function saveIncidents()   { await DB.saveIncidents(state.schoolId, state.incidents); }
async function loadStudents()    { state.students    = (await DB.loadStudents(state.schoolId))    || {}; }
async function saveStudents()    { await DB.saveStudents(state.schoolId, state.students); }
async function loadProgressions(){ state.progressions = (await DB.loadProgressions(state.schoolId)) || {}; }
async function saveProgressions(){ await DB.saveProgressions(state.schoolId, state.progressions); }
async function loadPathways()    { state.pathways    = (await DB.loadPathways(state.schoolId))    || {}; }
async function savePathways()    { await DB.savePathways(state.schoolId, state.pathways); }
async function loadPinOverrides(){ state.pinOverrides = (await DB.loadPinOverrides(state.schoolId)) || {}; }
async function savePinOverrides(){ await DB.savePinOverrides(state.schoolId, state.pinOverrides); }
async function loadCustomSchools(){
  // School structure (timetables, instructors, defaults, contact) now lives in
  // per-school DB rows, RLS-isolated, instead of being compiled into the client.
  // Load ONLY the schools this user belongs to (superadmin loads all), then populate
  // the in-memory SCHOOL_DATA_SEED in place so every existing getSchoolData() and
  // SCHOOL_DATA_SEED[id] call site keeps working unchanged — a non-member simply has
  // no entry for another school (which is exactly the isolation we want).
  const isSuper = state.user && state.user.role === 'superadmin';
  const ids = isSuper
    ? (typeof KRMAS_SCHOOLS !== 'undefined' ? KRMAS_SCHOOLS.map(s => s.id) : [])
    : ((state.userSchools && state.userSchools.length) ? state.userSchools.slice()
        : (state.schoolId ? [state.schoolId] : []));
  const struct = (await DB.loadSchoolStructures(ids)) || { seeds: {}, customs: {} };
  if (typeof SCHOOL_DATA_SEED !== 'undefined') {
    Object.keys(SCHOOL_DATA_SEED).forEach(k => { delete SCHOOL_DATA_SEED[k]; });
    Object.assign(SCHOOL_DATA_SEED, struct.seeds || {});
  }
  state.customSchools = struct.customs || {};
}
async function saveCustomSchools(schoolId){
  // Edits target a specific school (defaults to the active one); persist just that
  // school's overlay row. Callers editing another school (cross-school management)
  // pass its id explicitly so the right per-school row is written.
  const sid = schoolId || state.schoolId;
  if (!sid) return;
  await DB.saveSchoolCustom(sid, state.customSchools[sid] || {});
}
async function loadUserAsync() {
  const saved = await DB.loadUser();
  if (saved) {
    const userData = saved.user || saved;
    // Session expiry: 30 days of inactivity
    const SESSION_EXPIRY_DAYS = 30;
    if (saved.lastActive) {
      const daysSince = (Date.now() - new Date(saved.lastActive).getTime()) / 86400000;
      if (daysSince > SESSION_EXPIRY_DAYS) {
        await DB.saveUser(null);
        return; // expired — stay as guest
      }
    }
    state.user = userData;
    if (saved.schoolId) {
      state.schoolId = saved.schoolId;
      const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
      if (school) document.getElementById('schoolName').textContent = school.name;
    }
  }
}
async function saveUserAsync() {
  await DB.saveUser(state.user
    ? { user: state.user, schoolId: state.schoolId, lastActive: new Date().toISOString() }
    : null);
}

// ---------- Date helpers ----------
function startOfWeek(d) {
  const date = new Date(d);
  const dow = date.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + offset);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return dd + ' / ' + mm + ' / ' + d.getFullYear();
}
function formatDateShort(d) {
  return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
}
function isoDate(d) {
  // Local date components (NOT toISOString, which is UTC and shifts the day for
  // users ahead of UTC like Sydney — that broke dateKey round-trips so per-card
  // buttons like "Create lesson plan"/"Edit roster" silently did nothing).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

// ---------- Rotation ----------
function getWeekNumber(date) {
  const start = new Date(ROTATION.weekStart + 'T00:00:00');
  const diffDays = Math.floor((date - start) / (1000 * 60 * 60 * 24));
  const weekIdx = Math.floor(diffDays / 7);
  const mod = ((weekIdx % 12) + 12) % 12;
  return mod + 1;
}

// A roster role is either a fixed instructor id (string) or a week-based rotation:
//   { rotate: [ { id: 'gus', weeks: [1,3,5,7,9,11] }, { id: 'david', weeks: [2,4,...] } ] }
// Resolve it to the instructor id that should teach in the given week (1–12).
function resolveRosterRole(value, weekNum) {
  if (value && typeof value === 'object' && Array.isArray(value.rotate)) {
    const slot = value.rotate.find(s => s && Array.isArray(s.weeks) && s.weeks.includes(weekNum));
    return slot ? (slot.id || null) : null;
  }
  return value || null;
}

// True when a value is a rotation (vs a fixed id / null).
function isRotation(value) {
  return !!(value && typeof value === 'object' && Array.isArray(value.rotate));
}

// Validate a rotation. Overlaps (two people on one week) are a hard error.
// Gaps (a week with nobody) are allowed — some roles are intentionally unfilled
// some weeks — so they're reported as a warning, not a block.
// Returns { ok (fully covered, no overlaps), blocking (has overlaps), missing, overlaps }.
function validateRotation(rotate) {
  const arr = Array.isArray(rotate) ? rotate : [];
  const missing = [], overlaps = [];
  for (let w = 1; w <= 12; w++) {
    const n = arr.filter(s => s && Array.isArray(s.weeks) && s.weeks.includes(w)).length;
    if (n === 0) missing.push(w);
    else if (n > 1) overlaps.push(w);
  }
  return { ok: missing.length === 0 && overlaps.length === 0, blocking: overlaps.length > 0, missing, overlaps };
}

function getTopicForClass(classType, date) {
  const dow = date.getDay();
  const idxMap = { 1: 0, 2: 1, 3: 2, 4: 3, 6: 4 };
  if (!(dow in idxMap)) return null;
  const idx = idxMap[dow];
  const weekNum = getWeekNumber(startOfWeek(date));
  const meta = CLASS_TYPES[classType];
  if (!meta || !meta.chart) return null;
  let patternKey = classType;
  if (!ROTATION.patterns[patternKey]) patternKey = meta.chart;
  if (!ROTATION.patterns[patternKey]) return null;
  const row = ROTATION.patterns[patternKey][weekNum - 1];
  if (!row) return null;
  return row[idx];
}

function getTopicContent(chartKey, topicNum) {
  if (!chartKey || !topicNum) return null;
  const chart = TOPIC_CHARTS[chartKey];
  if (!chart) return null;
  return chart.topics[topicNum] || null;
}

// ---------- Roster assembly ----------
function getInstructor(id) {
  if (!id) return null;
  return currentInstructors().find(i => i.id === id) || null;
}

// ── Roster identity ──────────────────────────────────────────────────
// Roster slots (lead/assist/junior/backup) store INSTRUCTOR ids, but the signed-in
// session is an auth UID. These bridge the two so "my classes", cover routing, and
// avatar/hours work for a logged-in user. Resolved once per session in enterAppWithSession.
function resolveMyInstructorId() {
  if (!state.user) return null;
  const list = currentInstructors();
  let m = list.find(i => i.uid && i.uid === state.user.id);
  if (m) return m.id;
  const em = (state.user.email || '').toLowerCase();
  if (em) { m = list.find(i => (i.email || '').toLowerCase() === em); if (m) return m.id; }
  return null;
}
function myInstructorId() { return (state.user && state.user.instructorId) || null; }
function uidForInstructorId(instrId) {
  if (!instrId) return null;
  const i = currentInstructors().find(x => x.id === instrId);
  return (i && i.uid) || null;
}
function isMyClass(c) {
  const id = myInstructorId();
  return !!id && c && (c.lead === id || c.assist === id || c.junior === id || c.backup === id);
}
// Resolve a roster class from a dateKey ({YYYY-MM-DD}-{start}-{type}).
function classForDateKey(dateKey) {
  const date = new Date((dateKey || '').slice(0, 10) + 'T00:00:00');
  if (isNaN(date)) return null;
  return rosterForDay(date).find(x => x.dateKey === dateKey) || null;
}

function rosterForDay(date) {
  const dow = date.getDay();
  const schedule = currentSchedule();
  const defaults = currentDefaults();
  const classes = schedule.filter(c => c.day === dow);
  return classes.map(c => {
    // Apply admin class-type override if one exists for this label
    const effectiveType = (c.label && state.classTypeOverrides[c.label]) || c.type;
    const key = `${c.day}-${c.start}-${effectiveType}`;
    const dateKey = `${isoDate(date)}-${c.start}-${effectiveType}`;
    const def = defaults[key] || { lead: null, assist: null, junior: null, backup: null };
    const override = state.edits[dateKey] || {};
    const wk = getWeekNumber(startOfWeek(date)); // 1–12, for week-based rotations
    const meta = CLASS_TYPES[effectiveType];
    if (!meta) return null; // unknown class type — skip gracefully
    const topicNum = getTopicForClass(c.type, date);
    const topicContent = getTopicContent(meta.chart, topicNum);
    const plan = state.plans[dateKey] || null;
    return {
      key, dateKey,
      day: c.day, start: c.start, end: c.end, type: effectiveType,
      label: c.label || null,
      meta,
      lead:    resolveRosterRole(override.lead    !== undefined ? override.lead    : def.lead,    wk),
      assist:  resolveRosterRole(override.assist  !== undefined ? override.assist  : def.assist,  wk),
      junior:  resolveRosterRole(override.junior  !== undefined ? override.junior  : def.junior,  wk),
      backup:  resolveRosterRole(override.backup  !== undefined ? override.backup  : def.backup,  wk),
      status:  override.status  || 'confirmed',
      topicNum, topicContent,
      plan,
      gradingPrep: isGradingPrepClass(c, date)
    };
  }).filter(Boolean);
}

// ---------- Rendering: roster ----------
function renderDayTabs() {
  const tabs = document.getElementById('dayTabs');
  const today = new Date();
  let html = '';
  for (const dow of getActiveDays()) {
    const idx = dow === 0 ? 6 : dow - 1;
    const date = addDays(state.currentDate, idx);
    const isActive = state.selectedDay === dow;
    const isToday = isSameDay(date, today);
    html += `<button class="day-tab ${isActive ? 'active' : ''} ${isToday ? 'today' : ''}" onclick="selectDay(${dow})">
      <span>${DAY_SHORT[dow]}</span>
      <span class="day-num">${String(date.getDate()).padStart(2,'0')}</span>
    </button>`;
  }
  tabs.innerHTML = html;
}

function renderWeekMeta() {
  document.getElementById('weekMeta').textContent = getWeekNumber(state.currentDate);
}

function renderDay() {
  const idx = state.selectedDay === 0 ? 6 : state.selectedDay - 1;
  const date = addDays(state.currentDate, idx);
  document.getElementById('dayName').textContent = DAY_NAMES[state.selectedDay];
  document.getElementById('dayDate').textContent = formatDate(date);
  document.getElementById('dayHeadEl').style.display = 'flex';

  const classes = rosterForDay(date);
  const main = document.getElementById('mainContent');
  if (classes.length === 0) {
    const activeDays = getActiveDays();
    const schoolName = KRMAS_SCHOOLS.find(s => s.id === state.schoolId)?.name || 'This school';
    const dayList = activeDays.map(d => DAY_NAMES[d]).join(', ');
    main.innerHTML = `<div class="empty">
      <h2>No classes on ${DAY_NAMES[state.selectedDay]}</h2>
      <p>${dayList
        ? `${escapeHtml(schoolName)} runs classes on <strong>${dayList}</strong>. Tap one of those days above to manage the roster and lesson plans.`
        : 'Tap another day to view the roster.'}</p>
      ${can.editRoster() && activeDays.length === 0 ? `<button class="btn btn-primary" onclick="openSchoolManager && openSchoolManager()">Set up the timetable</button>` : ''}
    </div>`;
    return;
  }

  const today = new Date();
  const isToday = isSameDay(date, today);
  const unassigned = classes.filter(c => !c.lead || c.status === 'needs-cover');
  const myClasses = state.user ? classes.filter(c => isMyClass(c)) : [];

  // Today's briefing bar
  let briefingHtml = '';
  if (isToday && classes.length > 0) {
    const nowMins = today.getHours() * 60 + today.getMinutes();
    const upcoming = classes.filter(c => {
      const [h, m] = c.start.split(':').map(Number);
      return (h * 60 + m) > nowMins;
    });
    const inProgress = classes.filter(c => {
      const [sh, sm] = c.start.split(':').map(Number);
      const [eh, em] = c.end.split(':').map(Number);
      return (sh * 60 + sm) <= nowMins && nowMins <= (eh * 60 + em);
    });

    const nextClass = upcoming[0];
    let briefingContent = '';
    if (inProgress.length > 0) {
      const c = inProgress[0];
      const lead = getInstructor(c.lead);
      briefingContent = `<strong>Now on mat:</strong> ${escapeHtml(c.meta.name)} · ${lead ? escapeHtml(lead.short || lead.name) : 'unassigned'}`;
    } else if (nextClass) {
      const lead = getInstructor(nextClass.lead);
      const [h, m] = nextClass.start.split(':').map(Number);
      const diffMins = (h * 60 + m) - nowMins;
      const diffLabel = diffMins < 60 ? `${diffMins}m` : `${Math.floor(diffMins/60)}h ${diffMins%60}m`;
      briefingContent = `<strong>Next:</strong> ${escapeHtml(nextClass.meta.name)} in ${diffLabel} · ${lead ? escapeHtml(lead.short || lead.name) : '<span style="color: var(--red);">unassigned</span>'}`;
    } else {
      briefingContent = `All ${classes.length} classes done for today.`;
    }

    const alertPart = unassigned.length > 0
      ? `<span style="background: var(--red); color: var(--white); font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px; font-family: 'Open Sans', sans-serif; text-transform: uppercase; letter-spacing: 0.05em;">${unassigned.length} needs cover</span>`
      : '';
    const myPart = myClasses.length > 0
      ? `<span style="font-size: 11px; color: var(--grey-500);">You're on ${myClasses.length}</span>`
      : '';

    briefingHtml = `<div style="background: var(--black); color: var(--white); padding: 10px 14px; border-radius: var(--r-md); margin-bottom: 10px; font-size: 13px; display: flex; flex-direction: column; gap: 6px; box-shadow: var(--shadow);">
      <div style="font-family: 'Oswald', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--red);">Today</div>
      <div>${briefingContent}</div>
      ${alertPart || myPart ? `<div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">${alertPart}${myPart}</div>` : ''}
    </div>`;
  }

  // Grading-prep banner
  const grading = nextGradingForDate(date);
  let bannerHtml = '';
  if (grading) {
    const gd = new Date(grading.date + 'T00:00:00');
    const daysUntil = Math.round((gd - date) / (1000 * 60 * 60 * 24));
    const label = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
    bannerHtml = `<div style="background: linear-gradient(135deg, #c9a14a, #b8954a); color: var(--black); padding: 10px 14px; border-radius: var(--r-md); margin-bottom: 10px; font-size: 13px; display: flex; align-items: center; gap: 10px; box-shadow: var(--shadow);">
      <div style="font-family: 'Oswald', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; padding: 4px 8px; background: var(--black); color: var(--gold); border-radius: var(--r-sm);">Gradings ${label}</div>
      <div style="flex: 1;"><strong>${escapeHtml(grading.label)}</strong>${grading.notes ? `<div style="font-size: 11px; opacity: 0.85; margin-top: 2px;">${escapeHtml(grading.notes)}</div>` : ''}</div>
    </div>`;
  }

  let html = briefingHtml + bannerHtml + '<div class="cards">';
  for (const c of classes) {
    const leadInstr = getInstructor(c.lead);
    const assistInstr = getInstructor(c.assist);
    const juniorInstr = getInstructor(c.junior);
    const backupInstr = getInstructor(c.backup);
    const isMe = isMyClass(c);
    const needsCover = !c.lead || c.status === 'needs-cover';

    let badges = '';
    if (needsCover)    badges += '<span class="badge badge-needs">Needs cover</span>';
    if (c.status === 'cancelled') badges += '<span class="badge" style="background: var(--grey-300); color: var(--white);">Cancelled</span>';
    if (isMe)          badges += '<span class="badge badge-mine">You</span>';
    if (c.gradingPrep) badges += '<span class="badge badge-grading">Grading prep</span>';
    if (c.plan && c.plan.status === 'final') badges += '<span class="badge badge-plan">Planned</span>';
    if (c.plan && c.plan.status === 'draft') badges += '<span class="badge badge-draft">Draft</span>';

    html += `
    <div class="card${c.status === 'cancelled' ? ' cancelled-card' : ''}" id="card-${c.dateKey}">
      <div class="edge" style="background: var(${c.meta.colour});"></div>
      <div class="card-inner" onclick="toggleCard('${c.dateKey}')">
        <div class="card-top">
          <div class="card-time">${c.start}<span class="end">${c.end}</span></div>
          <div class="card-body">
            <div class="card-title">
              <span>${c.meta.name}</span>
              ${c.topicNum ? `<span class="topic-num">#${c.topicNum}</span>` : ''}
              ${badges}
            </div>
            ${c.topicContent ? `<div class="card-topic">${escapeHtml(c.topicContent.title)}</div>` : ''}
            <div class="card-staff">
              <div class="staff-row">
                <span class="staff-role">Lead</span>
                <span class="staff-name ${!leadInstr ? 'missing' : ''}">${leadInstr ? leadInstr.name : 'Unassigned'}</span>
              </div>
              ${assistInstr ? `<div class="staff-row"><span class="staff-role">Assist</span><span class="staff-name">${assistInstr.name}</span></div>` : ''}
              ${juniorInstr ? `<div class="staff-row"><span class="staff-role">Junior</span><span class="staff-name">${juniorInstr.name}</span></div>` : ''}
              ${backupInstr ? `<div class="staff-row"><span class="staff-role">Backup</span><span class="staff-name">${backupInstr.name}</span></div>` : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="card-detail">${renderCardDetail(c)}</div>
    </div>`;
  }
  html += '</div>';
  main.innerHTML = html;
  // Update badge after render so DOM is ready
  setTimeout(updateCoverBadge, 0);
  renderNoticeBanners();
}

function renderCardDetail(c) {
  let html = '';
  if (c.topicContent) {
    const t = c.topicContent;
    const fields = [
      ['Topic',     `${c.topicNum}. ${t.title}`],
      ['Basics',    t.basics],
      ['Fitness',   t.fitness],
      ['Etiquette', t.etiquette],
      ['Grappling', t.grappling],
      ['Self def.', t.selfDefence],
      ['Sparring',  t.sparring],
      ['Format',    t.format],
      ['Round',     t.round],
      ['Drills',    t.drills],
      ['Focus',     t.focus],
      ['Bunkai',    t.bunkai],
      ['Tachi',     t.tachi],
      ['Techniques',t.techniques],
      ['Teaching',  t.teaching],
      ['Equipment', t.equipment],
      ['Kata',      t.kata ? 'Yes' : null],
      ['Weapons',   t.weapons ? 'Yes' : null],
      ['Other',     t.other]
    ];
    for (const [label, val] of fields) {
      if (!val) continue;
      html += `<div class="detail-row">
        <div class="detail-label">${label}</div>
        <div class="detail-val">${escapeHtml(val)}</div>
      </div>`;
    }
  } else {
    html += `<div class="detail-row"><div class="detail-val" style="color: var(--grey-500); font-style: italic;">No topic content for this class type.</div></div>`;
  }
  // Show edit note if present
  if (c.status === 'cancelled') {
    html += `<div style="background: var(--grey-100); border-left: 3px solid var(--grey-300); padding: 8px 10px; margin-bottom: 8px; border-radius: var(--r-sm); font-size: 12px; color: var(--grey-500);"><strong>Cancelled</strong>${state.edits[c.dateKey]?.notes ? ' · ' + escapeHtml(state.edits[c.dateKey].notes) : ''}</div>`;
  } else if (state.edits[c.dateKey]?.notes) {
    html += `<div style="background: var(--off-white); border-left: 3px solid var(--grey-300); padding: 8px 10px; margin-bottom: 8px; border-radius: var(--r-sm); font-size: 12px; color: var(--grey-500);">Note: ${escapeHtml(state.edits[c.dateKey].notes)}</div>`;
  }
  const needsCover = !c.lead || c.status === 'needs-cover';
  const canVolunteer = needsCover && can.volunteerCover();
  const canCover = can.markNeedsCover();
  html += `<div class="detail-actions">
    ${can.editPlans() ? `<button class="btn btn-black" onclick="event.stopPropagation(); openPlan('${c.dateKey}')">${c.plan ? 'Edit lesson plan' : 'Create lesson plan'}</button>` : ''}
    ${can.editRoster() ? `<button class="btn" onclick="event.stopPropagation(); openEdit('${c.dateKey}')">Edit roster</button>` : ''}
    ${canVolunteer
      ? `<button class="btn btn-primary" onclick="event.stopPropagation(); volunteerToCover('${c.dateKey}')">Volunteer to cover</button>`
      : canCover ? `<button class="btn btn-warn" onclick="event.stopPropagation(); markNeedsCover('${c.dateKey}')">Need cover</button>` : ''}
  </div>`;
  return html;
}

function toggleCard(key) {
  const el = document.getElementById('card-' + key);
  if (el) el.classList.toggle('open');
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

// ---------- Week / day navigation ----------
function selectDay(dow) {
  state.selectedDay = dow;
  renderDayTabs();
  renderDay();
}

function changeWeek(delta) {
  state.currentDate = addDays(state.currentDate, delta * 7);
  renderDayTabs();
  renderWeekMeta();
  if (state.view === 'roster') renderDay();
}

// ---------- View switching ----------
function setView(v) {
  state.view = v;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  // Show/hide admin nav tab based on role
  const adminTab = document.querySelector('[data-view="admin"]');
  if (adminTab) adminTab.style.display = can.manageInstructors() ? '' : 'none';
  // Show/hide Incidents nav tab based on role (instructor+)
  const incTab = document.querySelector('[data-view="incidents"]');
  if (incTab) incTab.style.display = can.viewIncidents() ? '' : 'none';
  // Show/hide Students nav tab based on the students 'view' permission (same approach).
  const stuTab = document.querySelector('[data-view="students"]');
  if (stuTab) stuTab.style.display = can.viewStudents() ? '' : 'none';
  refreshAuthUI();
  syncNavHeight(); // nav row-count can change with which tabs are visible

  if (v === 'roster') {
    renderDay();
  } else if (v === 'plans') {
    renderPlans();
  } else if (v === 'incidents') {
    renderIncidents();
  } else if (v === 'students') {
    renderStudents();
  } else if (v === 'topics') {
    renderTopicLibrary();
  } else if (v === 'feed') {
    renderFeed();
  } else if (v === 'docs') {
    renderDocuments();
  } else if (v === 'admin') {
    renderAdmin();
  } else if (v === 'calendar') {
    renderCalendar();
  } else if (v === 'cover') {
    renderCoverRequests();
  } else if (v === 'grading') {
    renderGrading();
  } else if (v === 'me') {
    renderMe();
  }
}

function hideDayHead() {
  document.getElementById('dayHeadEl').style.display = 'none';
}

// ---------- View: Plans ----------
function renderPlans() {
  hideDayHead();
  const main = document.getElementById('mainContent');

  let html = `<h1 class="section-head">Plans</h1>`;
  html += `<button class="btn" style="width:100%;margin-bottom:10px;" onclick="setView('topics')">◇ View topic library</button>`;
  html += `<input type="search" id="plansSearch" placeholder="Search plans by class, theme, instructor…"
    value="${escapeHtml(state.plansSearch || '')}" oninput="state.plansSearch=this.value; renderPlansResults();"
    style="width:100%;padding:9px 12px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:13px;margin-bottom:12px;box-sizing:border-box;">`;
  html += `<div id="plansResults"></div>`;
  main.innerHTML = html;
  renderPlansResults();
}

function renderPlansResults() {
  const box = document.getElementById('plansResults');
  if (!box) return;
  const q = (state.plansSearch || '').trim().toLowerCase();

  let planList = Object.entries(state.plans)
    .filter(([k]) => !k.startsWith('grading-')) // grading plans live in the grading section
    .map(([k, v]) => ({ key: k, ...v }));

  if (q) {
    planList = planList.filter(p => {
      const meta = CLASS_TYPES[p.classType] || {};
      return [meta.name, p.classType, p.theme, p.instructor, p.assist, p.junior, p.objective, p.date]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }
  planList.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (planList.length === 0) {
    box.innerHTML = q
      ? `<div style="font-size:13px;color:var(--grey-500);padding:6px 4px;">No plans match “${escapeHtml(q)}”.</div>`
      : `<div style="font-size:13px;color:var(--grey-500);padding:6px 4px;">No plans yet. Tap a class on the roster to create one.</div>`;
    return;
  }

  const drafts = planList.filter(p => p.status === 'draft');
  const finals = planList.filter(p => p.status !== 'draft');
  let html = '';
  if (drafts.length > 0) {
    html += `<div class="section-sub">Drafts</div><div class="lp-saved-list">`;
    for (const p of drafts) html += renderSavedPlan(p);
    html += `</div>`;
  }
  if (finals.length > 0) {
    html += `<div class="section-sub">Completed</div><div class="lp-saved-list">`;
    for (const p of finals) html += renderSavedPlan(p);
    html += `</div>`;
  }
  box.innerHTML = html;
}

// ---------- View: Incidents (standalone, change 3) ----------
function renderIncidents() {
  hideDayHead();
  const main = document.getElementById('mainContent');
  if (!can.viewIncidents()) {
    main.innerHTML = `<div class="empty" style="padding-top:30px;">
      <h2>Incident reports</h2>
      <p style="margin-bottom:16px;">Sign in as an instructor to view incident reports.</p>
      ${!state.user ? `<button class="btn btn-primary" onclick="openLogin()">Sign in</button>` : ''}
    </div>`;
    return;
  }

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <h1 class="section-head" style="margin:0;">Incidents</h1>
    ${can.fileIncidents() ? `<button class="btn btn-warn" onclick="openIncident()" style="padding:8px 14px;">+ New report</button>` : ''}
  </div>`;
  html += `<input type="search" id="incidentSearch" placeholder="Search by name, type, severity, location…"
    value="${escapeHtml(state.incidentSearch || '')}" oninput="state.incidentSearch=this.value; renderIncidentsResults();"
    style="width:100%;padding:9px 12px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:13px;margin-bottom:12px;box-sizing:border-box;">`;
  html += `<div id="incidentsResults"></div>`;
  main.innerHTML = html;
  renderIncidentsResults();
}

function renderIncidentsResults() {
  const box = document.getElementById('incidentsResults');
  if (!box) return;
  const q = (state.incidentSearch || '').trim().toLowerCase();

  let incidentList = Object.entries(state.incidents).map(([id, v]) => ({ id, ...v }));
  if (q) {
    incidentList = incidentList.filter(inc =>
      [inc.personName, inc.type, inc.severity, inc.location, inc.description, inc.id, inc.date]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  incidentList.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  let html = '';
  if (!q && incidentList.length > 0) html += renderIncidentAnalytics(incidentList);

  html += `<div class="section-sub">Reports (${incidentList.length})</div>`;
  if (incidentList.length === 0) {
    html += q
      ? `<div style="font-size:13px;color:var(--grey-500);padding:6px 4px;">No incidents match “${escapeHtml(q)}”.</div>`
      : `<div style="font-size:13px;color:var(--grey-500);padding:6px 4px;">No incidents on record.</div>`;
  } else {
    for (const inc of incidentList) {
      const dateStr = inc.date ? formatDateShort(new Date(inc.date + 'T00:00:00')) : '—';
      const sevLabel = inc.severity ? inc.severity.toUpperCase() : 'UNKNOWN';
      const typeLabel = inc.type ? inc.type.replace(/-/g, ' ') : 'incident';
      const clickable = can.editIncidents();
      html += `<div class="ir-saved-item ${inc.severity || ''}" ${clickable ? `onclick="openIncident('${inc.id}')"` : ''} style="${clickable ? '' : 'cursor:default;'}">
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 700;">${escapeHtml(inc.personName || '—')} · ${escapeHtml(typeLabel)}</div>
          <div class="meta">${dateStr} · ${inc.time || '—'} · ${sevLabel} · ID ${escapeHtml(inc.id)}</div>
          ${inc.description ? `<div style="font-size: 12px; color: var(--grey-500); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(inc.description.slice(0, 80))}${inc.description.length > 80 ? '…' : ''}</div>` : ''}
        </div>
        ${clickable ? `<div style="font-size: 11px; color: var(--grey-400); flex-shrink: 0; padding-left: 8px;">Edit ›</div>` : ''}
      </div>`;
    }
  }
  box.innerHTML = html;
}

function renderIncidentAnalytics(incidents) {
  // Filter to last 12 months
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  const recent = incidents.filter(i => i.date && new Date(i.date + 'T00:00:00') >= cutoff);

  const bySev = { low: 0, medium: 0, high: 0 };
  const byType = {};
  const byClass = {};
  for (const inc of recent) {
    if (inc.severity && bySev[inc.severity] !== undefined) bySev[inc.severity]++;
    if (inc.type) byType[inc.type] = (byType[inc.type] || 0) + 1;
    if (inc.classContext) byClass[inc.classContext] = (byClass[inc.classContext] || 0) + 1;
  }

  const topTypes = Object.entries(byType).sort((a,b) => b[1] - a[1]).slice(0, 3);
  const topClasses = Object.entries(byClass).sort((a,b) => b[1] - a[1]).slice(0, 3);
  const total = recent.length;

  if (total === 0) return '';

  return `<div class="section-sub">Last 12 months · risk overview</div>
  <div style="background: var(--white); border: 1px solid var(--grey-200); border-radius: var(--r-md); padding: 14px; margin-bottom: 14px; box-shadow: var(--shadow);">
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px;">
      <div style="text-align: center; padding: 10px; background: #e8f3ec; border-radius: var(--r-sm); border-left: 3px solid var(--ok);">
        <div style="font-family: 'Oswald', sans-serif; font-size: 24px; font-weight: 700; color: var(--ok);">${bySev.low}</div>
        <div style="font-size: 9px; font-weight: 700; color: var(--grey-500); text-transform: uppercase; letter-spacing: 0.06em;">Low</div>
      </div>
      <div style="text-align: center; padding: 10px; background: #fdf3e3; border-radius: var(--r-sm); border-left: 3px solid var(--warn);">
        <div style="font-family: 'Oswald', sans-serif; font-size: 24px; font-weight: 700; color: var(--warn);">${bySev.medium}</div>
        <div style="font-size: 9px; font-weight: 700; color: var(--grey-500); text-transform: uppercase; letter-spacing: 0.06em;">Medium</div>
      </div>
      <div style="text-align: center; padding: 10px; background: var(--red-soft); border-radius: var(--r-sm); border-left: 3px solid var(--red);">
        <div style="font-family: 'Oswald', sans-serif; font-size: 24px; font-weight: 700; color: var(--red);">${bySev.high}</div>
        <div style="font-size: 9px; font-weight: 700; color: var(--grey-500); text-transform: uppercase; letter-spacing: 0.06em;">High</div>
      </div>
    </div>
    ${topTypes.length > 0 ? `<div style="margin-bottom: 10px;">
      <div style="font-family: 'Oswald', sans-serif; font-size: 10px; color: var(--grey-500); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; margin-bottom: 6px;">Most common types</div>
      ${topTypes.map(([type, count]) => `<div style="display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0;"><span>${escapeHtml(type)}</span><strong>${count}</strong></div>`).join('')}
    </div>` : ''}
    ${topClasses.length > 0 ? `<div>
      <div style="font-family: 'Oswald', sans-serif; font-size: 10px; color: var(--grey-500); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; margin-bottom: 6px;">By class context</div>
      ${topClasses.map(([cls, count]) => `<div style="display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0;"><span>${escapeHtml(cls)}</span><strong>${count}</strong></div>`).join('')}
    </div>` : ''}
    <div style="font-size: 11px; color: var(--grey-500); margin-top: 10px; text-align: center; font-style: italic;">${total} total · last 12 months</div>
  </div>`;
}

function renderSavedPlan(p) {
  const meta = CLASS_TYPES[p.classType] || {};
  const dateStr = p.date ? formatDateShort(new Date(p.date + 'T00:00:00')) : '—';
  return `<div class="lp-saved-item ${p.status === 'draft' ? 'draft' : ''}" onclick="openPlan('${p.key}')">
    <div style="flex: 1;">
      <div style="font-weight: 700;">${escapeHtml(meta.name || p.classType)} — ${escapeHtml(p.theme || 'Untitled')}</div>
      <div class="meta">${dateStr} · ${p.start || ''} · ${escapeHtml(p.instructor || '—')}</div>
    </div>
    ${p.shared ? `<span class="badge" style="background:#e0f2fe;color:#075985;">🌐 Shared</span>` : ''}
    <span class="badge ${p.status === 'draft' ? 'badge-draft' : 'badge-plan'}">${p.status || 'final'}</span>
  </div>`;
}

// ---------- View: Topic library ----------
function renderTopicLibrary() {
  hideDayHead();
  const main = document.getElementById('mainContent');
  let html = `<button class="btn" style="margin-bottom:12px;" onclick="setView('plans')">← Back to Plans</button>`;
  html += `<h1 class="section-head">Topic <span class="accent">library</span></h1>`;
  for (const key of Object.keys(TOPIC_CHARTS)) {
    const chart = TOPIC_CHARTS[key];
    html += `<div class="lib-card" id="lib-${key}">
      <div class="lib-card-head" onclick="toggleLibCard('${key}')">
        <div class="lib-card-title">${escapeHtml(chart.name)}</div>
        <div class="lib-card-meta">${chart.cycleLength}-topic cycle</div>
      </div>
      <div class="lib-card-body">${renderChartTopics(chart)}</div>
    </div>`;
  }
  main.innerHTML = html;
}

function toggleLibCard(key) {
  document.getElementById('lib-' + key).classList.toggle('open');
}

function renderChartTopics(chart) {
  let html = '';
  for (let i = 1; i <= chart.cycleLength; i++) {
    const t = chart.topics[i];
    if (!t) continue;
    html += `<div class="detail-row" style="border-bottom: 1px solid var(--grey-200); padding-bottom: 8px;">
      <div class="detail-label">#${i}</div>
      <div class="detail-val"><strong>${escapeHtml(t.title)}</strong>${t.basics ? `<div style="font-size: 12px; color: var(--grey-500); margin-top: 4px;">${escapeHtml(t.basics)}</div>` : ''}</div>
    </div>`;
  }
  return html;
}

// ---------- View: Me ----------
async function renderMe() {
  const _pushEnabled = await isPushEnabled();
  hideDayHead();
  const main = document.getElementById('mainContent');
  if (!state.user) {
    main.innerHTML = `<div class="empty" style="padding-top: 30px;">
      <h2>Not signed in</h2>
      <p style="margin-bottom: 16px;">Sign in to view your schedule and classes.</p>
      <button class="btn btn-primary" onclick="openLogin()">Sign in</button>
    </div>`;
    return;
  }
  const me = getInstructor(myInstructorId());
  if (!me) {
    main.innerHTML = `<div class="empty" style="padding-top: 30px;">
      <h2>Instructor not found</h2>
      <p style="margin-bottom: 16px;">Your account isn't set up for this school.</p>
      <button class="btn btn-primary" onclick="signOut(); openLogin()">Switch account</button>
    </div>`;
    return;
  }

  let html = `<h1 class="section-head">${escapeHtml(me.name)}</h1>`;

  // Identity card with profile picture + self-service photo (change 11)
  html += `<div class="card"><div class="card-inner">
    <div class="me-avatar-wrap">
      ${avatarHtml(me, 72)}
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:16px;">${escapeHtml(me.name)}</div>
        <div style="margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${roleBadge(me.role)}<span style="font-size:12px;color:var(--grey-500);">${escapeHtml(me.role)}</span></div>
        ${me.email ? `<div style="font-size:12px;color:var(--grey-500);margin-top:3px;">${escapeHtml(me.email)}</div>` : ''}
      </div>
      <div style="font-size:10px;padding:2px 8px;border-radius:999px;font-weight:700;text-transform:uppercase;flex-shrink:0;${DB.isSupabase ? 'background:#d1fae5;color:#065f46;' : 'background:#fef3c7;color:#92400e;'}">${DB.isSupabase ? '☁ Synced' : '⚠ Local'}</div>
    </div>
    <input type="file" id="meAvatarFile" accept="image/*" style="display:none;" onchange="handleMyAvatar(this)">
    <div style="display:flex;gap:8px;">
      <button class="btn btn-sm" style="flex:1;" onclick="document.getElementById('meAvatarFile').click()">📷 ${me.avatar ? 'Change photo' : 'Add photo'}</button>
      ${me.avatar ? `<button class="btn btn-sm" style="color:var(--red);" onclick="removeMyAvatar()">Remove</button>` : ''}
    </div>
    <div id="meAvatarStatus" style="font-size:11px;color:var(--grey-500);margin-top:6px;min-height:14px;"></div>
  </div></div>`;

  // Onboarding checklist (if incomplete)
  html += renderMyOnboarding();

  // My upcoming classes (next 14 days), split into teaching vs backup (change 5)
  const teaching = [], backup = [];
  for (let i = 0; i < 14; i++) {
    const date = addDays(new Date(), i);
    const dow = date.getDay();
    if (!getActiveDays().includes(dow)) continue;
    rosterForDay(date).forEach(c => {
      if (c.lead === me.id || c.assist === me.id || c.junior === me.id) {
        const role = c.lead === me.id ? 'Lead' : c.assist === me.id ? 'Assist' : 'Junior';
        teaching.push({ date, c, role });
      } else if (c.backup === me.id) {
        backup.push({ date, c, role: 'Backup' });
      }
    });
  }

  const classCard = (u) => `<div class="card" style="cursor:pointer;" onclick="goToRosterDate('${isoDate(u.date)}')">
    <div class="edge" style="background:var(${u.c.meta.colour});"></div>
    <div class="card-inner">
      <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--grey-500);">
          ${DAY_SHORT[u.date.getDay()]} ${String(u.date.getDate()).padStart(2,'0')}/${String(u.date.getMonth()+1).padStart(2,'0')}
        </div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:12px;">${u.c.start}</div>
        <div style="font-weight:700;">${u.c.meta.name}</div>
        <div style="margin-left:auto;font-size:11px;color:var(--red);font-weight:700;">Roster ›</div>
      </div>
      <div style="font-size:12px;color:var(--grey-500);margin-top:4px;font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">${u.role}</div>
    </div>
  </div>`;

  html += `<div class="section-sub">Teaching — next 2 weeks</div>`;
  if (teaching.length === 0) {
    html += `<div style="font-size:13px;color:var(--grey-500);padding:8px 4px;">No classes you're teaching in the next two weeks.</div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:6px;">${teaching.map(classCard).join('')}</div>`;
  }

  html += `<div class="section-sub" style="margin-top:14px;">Backup / cover standby</div>`;
  if (backup.length === 0) {
    html += `<div style="font-size:13px;color:var(--grey-500);padding:8px 4px;">You're not listed as backup on any upcoming class.</div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:6px;">${backup.map(classCard).join('')}</div>`;
  }

  // My hours this week
  const currentWeekMonday = startOfWeek(new Date());
  html += `<div class="section-sub" style="margin-top:14px;">This week's hours</div>`;
  html += renderInstructorHours(me.id, currentWeekMonday);

  // My documents (change 6)
  html += `<div style="margin-top:18px;"><button class="btn" style="width:100%;" onclick="openMyDocuments()">📄 My documents${state.myDocuments?.length ? ' (' + state.myDocuments.length + ')' : ''}</button></div>`;

  // Settings
  html += `<div style="margin-top:12px;display:grid;gap:8px;">
    ${can.changePin() ? `<button class="btn" onclick="openChangePin()" style="width:100%;">Device PIN</button>` : ''}
    ${DB.isSupabase ? `<button class="btn" onclick="openSetPassword('change')" style="width:100%;">🔑 Change password</button>` : ''}
    <button class="btn" onclick="toggleDarkMode()" style="width:100%;">${document.body.classList.contains('dark-mode') ? '☀ Light mode' : '🌙 Dark mode'}</button>
    ${'PushManager' in window ? `<button class="btn" onclick="${_pushEnabled ? 'disablePush' : 'requestPushPermission'}()" style="width:100%;">🔔 ${_pushEnabled ? 'Disable notifications' : 'Enable notifications'}</button>` : ''}
    ${('PushManager' in window && _pushEnabled) ? `<button class="btn" onclick="sendTestNotification()" style="width:100%;">📨 Send test notification</button>` : ''}
    <button class="btn" onclick="signOut()" style="width:100%;">Sign out</button>
  </div>`;
  main.innerHTML = html;
}

// Self-service profile picture (change 11)
async function handleMyAvatar(input) {
  const file = input.files[0];
  if (!file || !state.user) return;
  const status = document.getElementById('meAvatarStatus');
  if (file.size > 8 * 1024 * 1024) { if (status) { status.textContent = '⚠ Image too large (max 8 MB).'; status.style.color = 'var(--red)'; } input.value = ''; return; }
  if (status) { status.textContent = 'Processing…'; status.style.color = 'var(--grey-500)'; }
  try {
    const dataUrl = await resizeImageSquare(file, 256);
    await setMyAvatar(dataUrl);
    renderMe();
  } catch (e) {
    if (status) { status.textContent = '⚠ ' + e.message; status.style.color = 'var(--red)'; }
  }
}

async function removeMyAvatar() {
  if (!state.user) return;
  await setMyAvatar(null);
  renderMe();
}

async function setMyAvatar(dataUrl) {
  const instrs = ensureCustomInstructors();
  const instr = instrs.find(i => i.id === myInstructorId());
  if (!instr) return;
  if (dataUrl) instr.avatar = dataUrl; else delete instr.avatar;
  await saveCustomSchools();
}


// ---------- Instructor hours ----------

function classDurationMins(c) {
  const [sh, sm] = c.start.split(':').map(Number);
  const [eh, em] = c.end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function fmtHoursMins(totalMins) {
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h + ':' + String(m).padStart(2, '0');
}

function instructorWeekHours(instructorId, weekMonday) {
  let regularMins = 0, satMins = 0;
  const classList = [];
  for (const dow of getActiveDays()) {
    const date = addDays(weekMonday, dow === 0 ? 6 : dow - 1);
    const dayClasses = rosterForDay(date);
    for (const c of dayClasses) {
      if (c.status === 'cancelled') continue;
      if (c.lead === instructorId || c.assist === instructorId || c.junior === instructorId) {
        const mins = classDurationMins(c);
        if (dow === 6) satMins += mins;
        else regularMins += mins;
        classList.push({ c, date, dow, mins, role: c.lead === instructorId ? 'Lead' : c.assist === instructorId ? 'Assist' : 'Junior' });
      }
    }
  }
  return { regularMins, satMins, totalMins: regularMins + satMins, classList };
}

function renderInstructorHours(instructorId, weekMonday) {
  const { regularMins, satMins, totalMins, classList } = instructorWeekHours(instructorId, weekMonday);
  if (classList.length === 0) return `<div style="font-size: 13px; color: var(--grey-500); padding: 8px 4px;">No classes scheduled this week.</div>`;
  return `<div style="background: var(--white); border: 1px solid var(--grey-200); border-radius: var(--r-md); overflow: hidden; box-shadow: var(--shadow);">
    <div style="display: grid; grid-template-columns: repeat(3,1fr); border-bottom: 1px solid var(--grey-200);">
      ${[['Regular', fmtHoursMins(regularMins)], ['Saturday', fmtHoursMins(satMins)], ['Total', fmtHoursMins(totalMins)]].map(([lbl, val]) => `
      <div style="text-align: center; padding: 10px 8px; border-right: 1px solid var(--grey-200);">
        <div style="font-family: 'Oswald', sans-serif; font-size: 9px; color: var(--grey-500); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;">${lbl}</div>
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 500; color: var(--black);">${val}</div>
      </div>`).join('')}
    </div>
    <div style="padding: 8px 12px;">
      ${classList.map(({ c, date, role }) => `
      <div style="display: flex; gap: 8px; align-items: baseline; padding: 4px 0; border-bottom: 1px solid var(--grey-100); font-size: 12px;">
        <span style="font-family: 'JetBrains Mono', monospace; color: var(--grey-500); min-width: 80px;">${DAY_SHORT[date.getDay()]} ${c.start}</span>
        <span style="flex: 1;">${escapeHtml(c.meta.name)}</span>
        <span style="font-family: 'Oswald', sans-serif; font-size: 10px; font-weight: 700; color: var(--grey-500); text-transform: uppercase;">${role}</span>
        <span style="font-family: 'JetBrains Mono', monospace; color: var(--grey-400); font-size: 11px;">${fmtHoursMins(classDurationMins(c))}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

function renderTeamHours(weekMonday) {
  const instructors = currentInstructors().filter(i => i.role !== 'junior');
  const rows = instructors.map(instr => {
    const { regularMins, satMins, totalMins } = instructorWeekHours(instr.id, weekMonday);
    if (totalMins === 0) return null;
    return { instr, regularMins, satMins, totalMins };
  }).filter(Boolean).sort((a, b) => b.totalMins - a.totalMins);

  if (rows.length === 0) return `<div style="font-size: 13px; color: var(--grey-500); padding: 8px 4px;">No hours found.</div>`;

  return `<div style="background: var(--white); border: 1px solid var(--grey-200); border-radius: var(--r-md); overflow: hidden; box-shadow: var(--shadow);">
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <thead>
        <tr style="background: var(--off-white);">
          <th style="padding: 7px 10px; text-align: left; font-family: 'Oswald', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--grey-500); font-weight: 700;">Instructor</th>
          <th style="padding: 7px 10px; text-align: right; font-family: 'Oswald', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--grey-500); font-weight: 700;">Reg</th>
          <th style="padding: 7px 10px; text-align: right; font-family: 'Oswald', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--grey-500); font-weight: 700;">Sat</th>
          <th style="padding: 7px 10px; text-align: right; font-family: 'Oswald', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--grey-500); font-weight: 700;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `<tr style="border-bottom: 1px solid var(--grey-100);">
          <td style="padding: 7px 10px; font-weight: 600;">${escapeHtml(r.instr.short || r.instr.name)}</td>
          <td style="padding: 7px 10px; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--grey-500);">${fmtHoursMins(r.regularMins)}</td>
          <td style="padding: 7px 10px; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--grey-500);">${fmtHoursMins(r.satMins)}</td>
          <td style="padding: 7px 10px; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700;">${fmtHoursMins(r.totalMins)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}
// ---------- Cover badge ----------
function updateCoverBadge() {
  const count = countUrgentCover();
  // Update both navCover and navPlans (Plans button still shows badge)
  for (const btnId of ['navCover', 'navPlans']) {
    const btn = document.getElementById(btnId);
    if (!btn) continue;
    const existing = btn.querySelector('.nav-badge');
    if (existing) existing.remove();
    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = 'nav-badge';
      badge.textContent = count > 9 ? '9+' : count;
      btn.appendChild(badge);
    }
  }
}

function countUrgentCover() {
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(new Date(), i);
    const dow = date.getDay();
    if (!getActiveDays().includes(dow)) continue;
    for (const c of rosterForDay(date)) {
      if (!c.lead || c.status === 'needs-cover') count++;
    }
  }
  return count;
}

function openLogin() { showLoginGate(); }

// The sign-in modal is the gate: under RLS there is no anonymous/guest access, so
// the app cannot load data without a Supabase session.
function showLoginGate(msg) {
  try { openModal('modalLogin'); } catch (e) {}
  const err = document.getElementById('loginError');
  const status = document.getElementById('loginStatus');
  if (err) err.textContent = '';
  if (status) {
    if (msg) { status.style.display = 'block'; status.textContent = msg; }
    else { status.style.display = 'none'; status.textContent = ''; }
  }
}
function hideLoginGate() { try { closeModal('modalLogin'); } catch (e) {} }

function togglePasswordVisibility() {
  const inp = document.getElementById('loginPassword');
  const btn = document.getElementById('loginPwToggle');
  if (!inp) return;
  if (inp.type === 'password') { inp.type = 'text'; if (btn) btn.textContent = 'Hide'; }
  else { inp.type = 'password'; if (btn) btn.textContent = 'Show'; }
}

async function signIn() {
  const email = ((document.getElementById('loginEmail') || {}).value || '').trim();
  const password = (document.getElementById('loginPassword') || {}).value || '';
  const err = document.getElementById('loginError');
  const btn = document.getElementById('loginSendBtn');
  if (err) err.textContent = '';
  if (!email || !password) { if (err) err.textContent = 'Enter your email and password.'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  try {
    const res = await DB.auth.signInWithPassword(email, password);
    if (res && res.error) { if (err) err.textContent = res.error.message || 'Sign in failed.'; }
    // on success, the auth-state listener calls enterAppWithSession()
  } catch (e) {
    if (err) err.textContent = (e && e.message) || 'Sign in failed.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
  }
}

// ---------- Password reset / set ----------
let _setPwMode = 'change';   // 'first' | 'recovery' | 'change'

function openForgotPassword() {
  const le = ((document.getElementById('loginEmail') || {}).value || '').trim();
  const f = document.getElementById('forgotEmail'); if (f) f.value = le;
  const err = document.getElementById('forgotError'); if (err) err.textContent = '';
  const st = document.getElementById('forgotStatus'); if (st) { st.style.display = 'none'; st.textContent = ''; }
  openModal('modalForgot');
  setTimeout(() => { const el = document.getElementById('forgotEmail'); if (el) el.focus(); }, 50);
}

async function submitForgotPassword() {
  const email = ((document.getElementById('forgotEmail') || {}).value || '').trim();
  const err = document.getElementById('forgotError');
  const st = document.getElementById('forgotStatus');
  const btn = document.getElementById('forgotSendBtn');
  if (err) err.textContent = '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { if (err) err.textContent = 'Enter a valid email.'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await DB.auth.sendPasswordReset(email);
  } catch (e) {
    // Stay neutral — don't reveal whether the address exists or whether email is configured.
    console.warn('reset email:', e && e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Email me a reset link'; }
  }
  if (st) {
    st.style.display = 'block';
    st.textContent = "If that email has an account and email is enabled for your dojo, a reset link is on its way. If it doesn't arrive, ask your admin to reset your password.";
  }
}

function toggleSetPwVisibility() {
  const inp = document.getElementById('setPwNew');
  const btn = document.getElementById('setPwToggle');
  if (!inp) return;
  if (inp.type === 'password') { inp.type = 'text'; if (btn) btn.textContent = 'Hide'; }
  else { inp.type = 'password'; if (btn) btn.textContent = 'Show'; }
}

function openSetPassword(mode) {
  _setPwMode = mode || 'change';
  const titleEl = document.getElementById('setPwTitle');
  const subEl = document.getElementById('setPwSub');
  const cancelEl = document.getElementById('setPwCancel');
  const nw = document.getElementById('setPwNew'); if (nw) { nw.value = ''; nw.type = 'password'; }
  const cf = document.getElementById('setPwConfirm'); if (cf) cf.value = '';
  const tg = document.getElementById('setPwToggle'); if (tg) tg.textContent = 'Show';
  const err = document.getElementById('setPwError'); if (err) err.textContent = '';
  if (_setPwMode === 'change') {
    if (titleEl) titleEl.textContent = 'Change password';
    if (subEl) subEl.textContent = 'Choose a new password for your account.';
    if (cancelEl) cancelEl.style.display = '';
  } else if (_setPwMode === 'recovery') {
    if (titleEl) titleEl.textContent = 'Set a new password';
    if (subEl) subEl.textContent = 'Choose a new password to finish resetting your account.';
    if (cancelEl) cancelEl.style.display = 'none';
  } else { // first login after invite / admin reset
    if (titleEl) titleEl.textContent = 'Set your password';
    if (subEl) subEl.textContent = 'For security, choose your own password before continuing.';
    if (cancelEl) cancelEl.style.display = 'none';
  }
  if (_setPwMode !== 'change') hideLoginGate();
  openModal('modalSetPassword');
  setTimeout(() => { const el = document.getElementById('setPwNew'); if (el) el.focus(); }, 50);
}

async function submitSetPassword() {
  const nw = ((document.getElementById('setPwNew') || {}).value || '');
  const cf = ((document.getElementById('setPwConfirm') || {}).value || '');
  const err = document.getElementById('setPwError');
  const btn = document.getElementById('setPwSaveBtn');
  if (err) err.textContent = '';
  if (nw.length < 8) { if (err) err.textContent = 'Use at least 8 characters.'; return; }
  if (nw !== cf) { if (err) err.textContent = "Passwords don't match."; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const res = await DB.auth.updatePassword(nw);
    if (res && res.error) { if (err) err.textContent = res.error.message || 'Could not update password.'; return; }
    closeModal('modalSetPassword');
    if (_setPwMode === 'change') {
      alert('Password updated.');
    } else {
      // first-login or recovery: enter the app with the now-current session
      _enteredOnce = false;
      const s = await DB.auth.getSession();
      if (s) await enterAppWithSession(s);
      else showLoginGate('Password set — please sign in.');
    }
  } catch (e) {
    if (err) err.textContent = (e && e.message) || 'Could not update password.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save password'; }
  }
}

async function adminResetPassword() {
  if (!requireRole('admin')) return;
  const id = state.editingUserId;
  const instr = id ? allInstructors().find(i => i.id === id) : null;
  if (!instr || !instr.uid) { alert('This person has no login yet. Add their email and Save first, then you can reset it.'); return; }
  if (!confirm('Reset password for ' + (instr.name || 'this user') + '?\n\nThey will get a one-time temporary password and be asked to set their own when they next sign in.')) return;
  try {
    const res = await DB.users.resetPassword(instr.uid);
    if (res && res.tempPassword) {
      alert('Password reset for ' + (instr.name || instr.email) + '.\n\nTemporary password (share privately — shown only once):\n\n' + res.tempPassword + '\n\nThey will be asked to set their own password when they next sign in.');
    } else {
      alert('Reset completed, but no temporary password was returned.');
    }
  } catch (e) {
    alert('Could not reset password:\n' + ((e && e.message) || 'unknown') + "\n\n(If the manage-users function isn't deployed yet, that's the cause.)");
  }
}

// Optional magic-link sign-in (kept available; not wired to the default button).
async function sendMagicLink() {
  const emailEl = document.getElementById('loginEmail');
  const err = document.getElementById('loginError');
  const status = document.getElementById('loginStatus');
  const email = ((emailEl && emailEl.value) || '').trim();
  if (err) err.textContent = '';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { if (err) err.textContent = 'Enter a valid email address.'; return; }
  try {
    await DB.auth.signInWithEmail(email);
    if (status) { status.style.display = 'block'; status.textContent = 'Check your email for a sign-in link from KRMAS, then tap it on this device.'; }
  } catch (e) {
    if (err) err.textContent = 'Could not send link: ' + ((e && e.message) || 'please try again');
  }
}

function pinPress(d) {
  if (state.pinInput.length >= 4) return;
  state.pinInput += d;
  renderPinDisplay();
  if (state.pinInput.length === 4) setTimeout(pinSubmit, 120);
}

function pinClear() { state.pinInput = state.pinInput.slice(0, -1); renderPinDisplay(); }

function renderPinDisplay() {
  let html = '';
  for (let i = 0; i < 4; i++) html += `<span class="dot ${i < state.pinInput.length ? '' : 'empty-dot'}"></span>`;
  document.getElementById('pinDisplay').innerHTML = html;
}

// Legacy PIN entry is no longer used for sign-in (magic-link is the boundary).
// Kept as a safe redirect in case any old handler still calls it.
function pinSubmit() { showLoginGate(); }

async function signOut() {
  if (!confirm('Sign out of KRMAS on this device?')) return;
  await DB.auth.signOut();
  state.user = null;
  state.myDocuments = [];
  showLoginGate();
}

// Header account button — taps to sign out when signed in, or to sign in otherwise.
function acctButtonTap() {
  if (!state.user) { openLogin(); return; }
  signOut();
}

// Show the header account/sign-out button only when signed in, with the user's name.
function refreshAuthUI() {
  const btn = document.getElementById('acctBtn');
  if (!btn) return;
  if (state.user) {
    btn.style.display = '';
    btn.title = 'Sign out (' + (state.user.name || 'signed in') + ')';
  } else {
    btn.style.display = 'none';
  }
}

// ====================================================================
// Impersonation ("View as") — a client-side, READ-ONLY preview of another
// user's view. superadmin → any user in any school; admin → users in their own
// school whose role is below admin. The live Supabase session never changes, so
// RLS stays the real boundary (a target's view is always a subset of the
// impersonator's access). Writes are blocked centrally via DB.setReadOnly so
// nobody can act as someone else; exit to make changes.
// ====================================================================
function isImpersonating() { return !!state.impersonation; }
function realUser()       { return state.impersonation ? state.impersonation.real : state.user; }

function roleLabelFor(role) {
  const builtin = { superadmin: 'Superadmin', admin: 'Admin', instructor: 'Instructor', junior: 'Junior' }[role];
  if (builtin) return builtin;
  const cr = ((state.roleConfig && state.roleConfig.roles) || []).find(r => r.key === role);
  return (cr && cr.label) || role;
}

// Who may the CURRENT (real) user view-as? Note: this gates the UI for legitimate use;
// it is NOT the security boundary (that's RLS on the unchanged JWT).
function canImpersonate(target) {
  if (!state.user || !target) return false;
  if (state.impersonation) return false;                                   // no nested view-as
  if ((target.uid && target.uid === state.user.id) || target.id === state.user.instructorId) return false; // not yourself
  if (!target.uid && !target.email) return false;                          // must be a real login
  if (state.user.role === 'superadmin') return true;                       // anyone, any school
  if (state.user.role === 'admin') {                                       // own school, strictly below admin
    const sameSchool = (target.schoolId || state.schoolId) === state.schoolId;
    return sameSchool && roleRank(target.role) < roleRank('admin');
  }
  return false;
}

async function startImpersonation(targetId) {
  if (state.impersonation) return;
  if (!state.user) return;
  const pool = (state.user.role === 'superadmin') ? allInstructorsAllSchools() : allInstructors();
  const target = pool.find(i => i.id === targetId);
  if (!target) { alert('Could not find that user.'); return; }
  if (!canImpersonate(target)) { alert("You can't view as that user."); return; }
  if (!target.uid) { alert('That user has no login yet — nothing to view as.'); return; }

  const asSuper = state.user.role === 'superadmin';

  // Prefer TRUE (server-side) impersonation: a real session as the target, so the view
  // — including role-, group-, and DM-targeted feed posts — is fully faithful. If any
  // part of the handshake fails, fall back to the client-side read-only preview, which
  // still reproduces the target's role, permissions and school-scoped data.
  let mode = 'client', realSession = null, tgt = null;
  if (DB.isSupabase) {
    try {
      realSession = await DB.auth.getSession();
      // Never swap sessions unless we captured a session we can restore on exit.
      if (!realSession || !realSession.access_token) throw new Error('no restorable session');
      const res = await DB.auth.startImpersonation(target.uid);     // permission-checked + audited edge fn
      if (res && res.token_hash && res.target) {
        await DB.auth.applyImpersonationToken(res.token_hash);       // verifyOtp → live session as target
        tgt = res.target; mode = 'server';
      } else { throw new Error('no impersonation token'); }
    } catch (e) {
      console.warn('server impersonation unavailable, using read-only preview:', e && e.message);
      try { if (realSession && realSession.access_token) await DB.auth.restoreSession(realSession); } catch (_) {}  // make sure we're still us
      mode = 'client'; realSession = null; tgt = null;
    }
  }

  const targetSchool = (tgt && tgt.school_id) || target.schoolId || state.schoolId;
  const targetSchools = asSuper
    ? ((tgt && Array.isArray(tgt.schools) && tgt.schools.length) ? tgt.schools.slice()
       : (Array.isArray(target.schools) && target.schools.length ? target.schools.slice() : [targetSchool]))
    : [state.schoolId];                                              // admin stays pinned to own school

  state.impersonation = {
    mode, realSession, targetUid: target.uid,
    real: { ...state.user }, realSchoolId: state.schoolId, realSchools: (state.user.schools || []).slice(),
    target: { id: target.id, name: (tgt && tgt.name) || target.name, role: (tgt && tgt.role) || target.role },
  };
  state.user = {
    id: (mode === 'server' && tgt) ? tgt.id : (target.uid || target.id),
    name: (tgt && tgt.name) || target.name, role: (tgt && tgt.role) || target.role,
    email: (tgt && tgt.email) || target.email || null,
    schools: targetSchools, instructorId: target.id, _impersonated: true,
  };
  state.userSchools = targetSchools;
  state.schoolId = asSuper ? targetSchool : state.schoolId;
  DB.setReadOnly(true);                          // guard against accidental writes (see note in banner)
  // Persist a recovery marker so a page reload mid-impersonation restores the real user
  // (the target's session is what the browser persisted) instead of stranding them.
  if (mode === 'server' && realSession) { try { localStorage.setItem('krmas_imp', JSON.stringify({ realSession })); } catch (_) {} }

  const nm = document.getElementById('schoolName');
  if (nm) nm.textContent = (KRMAS_SCHOOLS.find(s => s.id === state.schoolId) || {}).name || state.schoolId;
  try { await loadCurrentSchoolData(); } catch (e) { console.warn('impersonation reload:', e && e.message); }
  renderImpersonationBanner();
  if (typeof refreshAuthUI === 'function') refreshAuthUI();
  closeModal('modalUserEditor'); closeModal('modalInstructorManager'); closeModal('modalUsers');
  setView('feed');
}

async function stopImpersonation() {
  if (!state.impersonation) return;
  const snap = state.impersonation;
  DB.setReadOnly(false);
  if (snap.mode === 'server') {
    try { await DB.auth.restoreSession(snap.realSession); }
    catch (e) { console.warn('restore session failed:', e && e.message); alert('Could not fully restore your session — please sign in again.'); }
    try { localStorage.removeItem('krmas_imp'); } catch (_) {}
    // Audit the end now that we're back to the real user (best-effort, non-blocking).
    if (snap.targetUid) { try { await DB.auth.endImpersonation(snap.targetUid); } catch (e) { console.warn('impersonate_stop audit:', e && e.message); } }
  }
  state.user = snap.real;
  state.userSchools = (snap.realSchools || (snap.real.schools || [])).slice();
  state.schoolId = snap.realSchoolId;
  state.impersonation = null;
  const nm = document.getElementById('schoolName');
  if (nm) nm.textContent = (KRMAS_SCHOOLS.find(s => s.id === state.schoolId) || {}).name || state.schoolId;
  try { await loadCurrentSchoolData(); } catch (e) { console.warn('restore reload:', e && e.message); }
  renderImpersonationBanner();
  if (typeof refreshAuthUI === 'function') refreshAuthUI();
  setView('feed');
}

// Lets the impersonator deliberately drop read-only and ACT as the target (server mode
// only — in client mode there's no real session to write with). Confirmed + obvious.
async function toggleImpersonationWrite() {
  if (!state.impersonation || state.impersonation.mode !== 'server') return;
  if (DB.readOnly) {
    if (!confirm('Allow changes while viewing as ' + state.impersonation.target.name +
      '?\n\nAnything you do will be saved AS THEM and attributed to them. This is logged.')) return;
    DB.setReadOnly(false);
  } else {
    DB.setReadOnly(true);
  }
  renderImpersonationBanner();
}

function renderImpersonationBanner() {
  let bar = document.getElementById('impersonationBar');
  if (!isImpersonating()) { if (bar) bar.remove(); document.body.style.removeProperty('padding-top'); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'impersonationBar';
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#b45309;color:#fff;font-family:'Open Sans',sans-serif;font-size:13px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,.25);";
    document.body.appendChild(bar);
  }
  const imp = state.impersonation, t = imp.target;
  const live = imp.mode === 'server';
  const ro = DB.readOnly;
  const stateTag = live ? (ro ? 'live · read-only' : 'live · CHANGES ON') : 'read-only preview';
  // Only server mode can actually write (it holds the target's session); offer a toggle.
  const writeBtn = live
    ? `<button onclick="toggleImpersonationWrite()" style="flex:none;background:${ro ? 'transparent' : '#7f1d1d'};color:#fff;border:1px solid #fff;border-radius:6px;padding:4px 10px;font-weight:700;cursor:pointer;font-size:11px;">${ro ? 'Make changes' : 'Read-only'}</button>`
    : '';
  bar.style.background = (live && !ro) ? '#7f1d1d' : '#b45309';
  bar.innerHTML = `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">👁 Viewing as <strong>${escapeHtml(t.name)}</strong> · ${escapeHtml(roleLabelFor(t.role))} · ${stateTag}</span>
    <span style="flex:none;display:flex;gap:6px;">${writeBtn}
    <button onclick="stopImpersonation()" style="flex:none;background:#fff;color:#b45309;border:none;border-radius:6px;padding:4px 12px;font-weight:700;cursor:pointer;font-size:12px;">Exit</button></span>`;
}

// Lightweight transient toast (used to explain blocked writes during impersonation).
function showToast(msg) {
  let t = document.getElementById('krmasToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'krmasToast';
    t.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:10000;background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;max-width:80%;text-align:center;font-family:'Open Sans',sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);opacity:0;transition:opacity .2s;";
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._timer); t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2400);
}

// Friendly guard for the common write entry points (the DB read-only proxy is the
// hard backstop; this just gives clear feedback instead of a silent no-op).
function blockedByImpersonation() {
  if (!isImpersonating()) return false;
  showToast('Read-only while viewing as ' + state.impersonation.target.name + ' — tap Exit to make changes.');
  return true;
}

// The bottom nav is a 5-column grid that wraps to 2-3 rows depending on how many
// tabs are visible (role-dependent) and the viewport width, so its height isn't
// fixed. Measure it and expose it as --bottom-nav-h so content padding always
// clears it (offsetHeight already includes the safe-area-inset padding).
function syncNavHeight() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;
  const h = nav.offsetHeight || 0;
  if (h) document.documentElement.style.setProperty('--bottom-nav-h', h + 'px');
}
window.addEventListener('resize', syncNavHeight);
window.addEventListener('orientationchange', () => setTimeout(syncNavHeight, 100));

// ---------- PIN overrides ----------
// Edgeworth's instructors are seeded with PIN 0000. To let each instructor
// change their own PIN, we store an override layer keyed by instructor id.
// This wraps getInstructor() so it returns the current effective PIN.

async function loadGrading() {
  const saved = (await DB.loadGrading(state.schoolId)) || {};
  state.grading   = saved.sessions || {};
  state.stocktake = saved.stocktake || {};
}
async function saveGrading() {
  await DB.saveGrading(state.schoolId, { sessions: state.grading, stocktake: state.stocktake });
}
async function loadNotices() {
  state.notices        = await DB.loadNotices(state.schoolId);
  state.networkNotices = await DB.loadNetworkNotices();
}
async function saveNotices() {
  // local: batch write; Supabase: individual saveNotice calls handle it
  if (!DB.isSupabase) {
    try { localStorage.setItem('notices:' + state.schoolId, JSON.stringify(state.notices)); } catch(e) {}
  }
}
async function saveNetworkNotices() {
  if (!DB.isSupabase) {
    try { localStorage.setItem('notices:network', JSON.stringify(state.networkNotices)); } catch(e) {}
  }
}

function effectivePin(instructorId) {
  // Override wins, else seeded pin, else '0000'
  if (state.pinOverrides && state.pinOverrides[instructorId]) return state.pinOverrides[instructorId];
  const instr = currentInstructors().find(i => i.id === instructorId);
  return instr ? (instr.pin || '0000') : '0000';
}

async function openChangePin() {
  if (!state.user) return;
  state.pinChangeBuffer = '';
  state.pinChangeNew = '';
  const has = DB.isSupabase ? await DB.auth.hasPin() : false;
  state.pinChangeStage = has ? 'current' : 'new';
  renderChangePinModal();
  openModal('modalChangePin');
}

function renderChangePinModal() {
  const titleEl = document.getElementById('changePinTitle');
  if (!titleEl) return; // modal not open yet
  const stage = state.pinChangeStage;
  const titles = {
    'current': 'Enter your current PIN',
    'new':     'Choose a new PIN',
    'confirm': 'Confirm your new PIN'
  };
  titleEl.textContent = titles[stage] || '';
  let dots = '';
  for (let i = 0; i < 4; i++) {
    dots += `<span class="dot ${i < state.pinChangeBuffer.length ? '' : 'empty-dot'}"></span>`;
  }
  document.getElementById('changePinDisplay').innerHTML = dots;
  document.getElementById('changePinError').textContent = '';
}

function changePinPress(d) {
  if (state.pinChangeBuffer.length >= 4) return;
  state.pinChangeBuffer += d;
  renderChangePinModal();
  if (state.pinChangeBuffer.length === 4) setTimeout(changePinAdvance, 120);
}

function changePinClear() {
  state.pinChangeBuffer = state.pinChangeBuffer.slice(0, -1);
  renderChangePinModal();
}

async function changePinAdvance() {
  const buf = state.pinChangeBuffer;
  if (buf.length < 4) {
    document.getElementById('changePinError').textContent = 'Enter all 4 digits.';
    return;
  }
  if (state.pinChangeStage === 'current') {
    const ok = DB.isSupabase ? await DB.auth.checkPin(buf) : false;
    if (!ok) {
      document.getElementById('changePinError').textContent = 'Wrong PIN.';
      state.pinChangeBuffer = '';
      renderChangePinModal();
      return;
    }
    state.pinChangeStage = 'new';
    state.pinChangeBuffer = '';
    renderChangePinModal();
  } else if (state.pinChangeStage === 'new') {
    state.pinChangeNew = buf;
    state.pinChangeStage = 'confirm';
    state.pinChangeBuffer = '';
    renderChangePinModal();
  } else if (state.pinChangeStage === 'confirm') {
    if (buf !== state.pinChangeNew) {
      document.getElementById('changePinError').textContent = 'Did not match. Start over.';
      state.pinChangeStage = 'new';
      state.pinChangeBuffer = '';
      state.pinChangeNew = '';
      renderChangePinModal();
      return;
    }
    try {
      if (DB.isSupabase) await DB.auth.setPin(state.pinChangeNew);
      state._pinUnlocked = true;
      closeModal('modalChangePin');
      alert('Device PIN set. You\u2019ll be asked for it when you open the app on this device.');
    } catch (e) {
      document.getElementById('changePinError').textContent = 'Could not save: ' + ((e && e.message) || 'error');
    }
  }
}

// ---------- Device PIN lock (unlock on open) ----------
function showPinLock() {
  state.pinLockBuffer = '';
  renderPinLock();
  openModal('modalPinLock');
}
function renderPinLock() {
  const disp = document.getElementById('pinLockDisplay');
  if (!disp) return;
  let dots = '';
  for (let i = 0; i < 4; i++) dots += `<span class="dot ${i < (state.pinLockBuffer || '').length ? '' : 'empty-dot'}"></span>`;
  disp.innerHTML = dots;
  const err = document.getElementById('pinLockError'); if (err) err.textContent = '';
}
function pinLockPress(d) {
  if ((state.pinLockBuffer || '').length >= 4) return;
  state.pinLockBuffer = (state.pinLockBuffer || '') + d;
  renderPinLock();
  if (state.pinLockBuffer.length === 4) setTimeout(pinLockSubmit, 120);
}
function pinLockClear() { state.pinLockBuffer = (state.pinLockBuffer || '').slice(0, -1); renderPinLock(); }
async function pinLockSubmit() {
  const buf = state.pinLockBuffer || '';
  if (buf.length < 4) { const e = document.getElementById('pinLockError'); if (e) e.textContent = 'Enter all 4 digits.'; return; }
  const ok = DB.isSupabase ? await DB.auth.checkPin(buf) : true;
  if (!ok) {
    const e = document.getElementById('pinLockError'); if (e) e.textContent = 'Wrong PIN.';
    state.pinLockBuffer = ''; renderPinLock(); return;
  }
  state._pinUnlocked = true;
  closeModal('modalPinLock');
}

// ---------- School picker ----------
function openSchoolPicker() {
  const list = document.getElementById('schoolList');
  // Everyone is restricted to the schools they're assigned to; superadmins (and the
  // logged-out setup flow) see them all. Multi-school instructors see their full set.
  const isSuper = !state.user || (state.user && state.user.role === 'superadmin');
  let visible = isSuper ? KRMAS_SCHOOLS
                        : KRMAS_SCHOOLS.filter(s => (state.userSchools || []).includes(s.id));
  if (!visible.length) visible = KRMAS_SCHOOLS.filter(s => s.id === state.schoolId);
  list.innerHTML = visible.map(s => {
    const configured = isSchoolConfigured(s.id);
    const seed = SCHOOL_DATA_SEED[s.id];
    const classCount = seed?.schedule?.length || 0;
    const meta = SCHOOL_METADATA?.[s.id];
    const address = seed?.address || meta?.address || '';
    let subline = '';
    if (classCount > 0) subline = `${classCount} classes configured`;
    else if (seed?.note) subline = seed.note;
    else subline = 'Tap to set up manually';

    return `
    <div class="selector-item ${s.id === state.schoolId ? 'current' : ''}" onclick="selectSchool('${s.id}')">
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: 700;">${escapeHtml(s.name)}</div>
        ${address ? `<div style="font-size: 11px; color: var(--grey-500); margin-top: 1px;">${escapeHtml(address)}</div>` : ''}
        <div style="font-size: 10px; color: ${classCount > 0 ? 'var(--ok)' : 'var(--grey-500)'}; margin-top: 2px; font-family: 'Oswald', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">${subline}</div>
      </div>
      <div class="meta">${s.state}</div>
    </div>`;
  }).join('');
  openModal('modalSchool');
}

function selectSchool(id) {
  const seed = SCHOOL_DATA_SEED[id];
  const custom = state.customSchools?.[id];
  const hasInstructors = !!(custom?.instructors?.length || seed?.instructors?.length);
  const hasSchedule = !!(seed?.schedule?.length || custom?.schedule?.length);

  // No data at all — run wizard
  if (!seed && !custom) {
    closeModal('modalSchool');
    if (!state.user) { openLogin(); return; }
    startSchoolWizard(id);
    return;
  }

  // Has timetable but no instructors — offer to set up (for admins)
  if (hasSchedule && !hasInstructors && can.manageInstructors()) {
    closeModal('modalSchool');
    if (confirm(
      (KRMAS_SCHOOLS.find(s => s.id === id)?.name || id) +
      ' has a timetable but no instructors set up yet.\n\nSet up instructors now?'
    )) {
      startSchoolWizard(id);
      return;
    }
  }

  const schoolDataLoad = async () => {
    await loadCurrentSchoolData();
    if (state.view === 'roster') renderDay(); else setView(state.view);
  };

  state.schoolId = id;
  document.getElementById('schoolName').textContent = KRMAS_SCHOOLS.find(s => s.id === id)?.name || id;
  closeModal('modalSchool');
  saveUserAsync(); // persist the school choice
  schoolDataLoad();
}

// Loads EVERY per-school data domain for the current state.schoolId.
// Shared by selectSchool and the setup wizard so switching schools — or
// finishing setup of a brand-new school — never leaves another school's
// incidents, posts, students or gradings in memory.
async function loadCurrentSchoolData() {
  await loadEdits(); await loadPlans(); await loadIncidents();
  await loadStudents(); await loadProgressions(); await loadPathways(); await loadPinOverrides(); await loadGrading(); await loadNotices(); await loadFeedData(); await loadGroupsData(); await loadClassAssignmentsData(); await loadCalendarData();
  await reconcileStudents();
  state.lastLogins = (await DB.loadLastLogins(state.schoolId)) || {};
  state.documents = await DB.loadDocuments(state.schoolId);
  state.onboardingChecklists = await DB.loadOnboardingChecklists(state.schoolId);
  state.onboardingTemplate = await DB.loadOnboardingTemplate(state.schoolId);
  state.classTypeOverrides = (await DB.loadClassTypeOverrides(state.schoolId)) || {};
  state.complianceReqs = await DB.loadComplianceRequirements(state.schoolId);
  state.complianceRecords = await DB.loadInstructorCompliance(state.schoolId);
  state.myDocuments = state.user ? await DB.loadInstructorDocuments(state.user.id) : [];
  startRealtimeFeed(); // re-subscribe to the new school's realtime channel
}

// ---------- School onboarding wizard ----------
function startSchoolWizard(schoolId) {
  const school = KRMAS_SCHOOLS.find(s => s.id === schoolId);
  state.wizardData = {
    schoolId,
    schoolName: school.name,
    state: school.state,
    contact: { adminEmail: '', adminName: '', locationLabel: school.name },
    instructors: [],
    schedule: [],
    defaults: {}
  };
  state.wizardStep = 0;
  renderWizardStep();
  openModal('modalWizard');
}

function renderWizardStep() {
  const step = state.wizardStep;
  const w = state.wizardData;
  const body = document.getElementById('wizardBody');
  const stepsTotal = 4;
  let html = `<div style="display: flex; gap: 4px; margin-bottom: 12px;">`;
  for (let i = 0; i < stepsTotal; i++) {
    html += `<div style="flex: 1; height: 3px; background: ${i <= step ? 'var(--red)' : 'var(--grey-200)'}; border-radius: 2px;"></div>`;
  }
  html += `</div>`;
  html += `<h2>Set up · ${escapeHtml(w.schoolName)}</h2>`;
  html += `<p class="modal-sub">Step ${step + 1} of ${stepsTotal}</p>`;

  if (step === 0) {
    html += `<div class="lp-section">
      <div class="lp-section-title">Dojo contact</div>
      <p style="font-size: 12px; color: var(--grey-500); margin: 0 0 10px;">Used for lesson plan and incident report emails.</p>
      <div class="form-row compact">
        <label>Admin name (Sensei / dojo manager)</label>
        <input type="text" id="wizContactName" value="${escapeHtml(w.contact.adminName || '')}" placeholder="e.g. Sensei Smith">
      </div>
      <div class="form-row compact">
        <label>Admin email</label>
        <input type="email" id="wizContactEmail" value="${escapeHtml(w.contact.adminEmail || '')}" placeholder="dojo@krmas.com.au">
      </div>
      <div class="form-row compact">
        <label>Location label (appears on lesson plans)</label>
        <input type="text" id="wizContactLocation" value="${escapeHtml(w.contact.locationLabel || '')}">
      </div>
    </div>`;
  } else if (step === 1) {
    html += `<div class="lp-section">
      <div class="lp-section-title">Instructors</div>
      <p style="font-size: 12px; color: var(--grey-500); margin: 0 0 10px;">Add the instructor team. PIN defaults to 0000 — each instructor changes their own on first login (Phase 2 feature).</p>
      <div id="wizInstrList" style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px;">
        ${renderWizardInstructors()}
      </div>
      <div class="form-grid-2">
        <div class="form-row compact">
          <label>Name (with title)</label>
          <input type="text" id="wizNewInstrName" placeholder="e.g. Sensei Smith">
        </div>
        <div class="form-row compact">
          <label>Role</label>
          <select id="wizNewInstrRole">
            ${roleSelectOptions('instructor')}
          </select>
        </div>
      </div>
      <button class="btn btn-black" style="width: 100%;" onclick="wizardAddInstructor()">+ Add instructor</button>
    </div>`;
  } else if (step === 2) {
    html += `<div class="lp-section">
      <div class="lp-section-title">Weekly class schedule</div>
      <p style="font-size: 12px; color: var(--grey-500); margin: 0 0 10px;">Add each recurring class. You can copy from Edgeworth's template below to start, then customise.</p>
      <div id="wizClassList" style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; max-height: 280px; overflow-y: auto;">
        ${renderWizardSchedule()}
      </div>
      <div class="form-grid-2">
        <div class="form-row compact">
          <label>Day</label>
          <select id="wizNewClassDay">
            <option value="1">Monday</option>
            <option value="2">Tuesday</option>
            <option value="3">Wednesday</option>
            <option value="4">Thursday</option>
            <option value="5">Friday</option>
            <option value="6">Saturday</option>
            <option value="0">Sunday</option>
          </select>
        </div>
        <div class="form-row compact">
          <label>Type</label>
          <select id="wizNewClassType">
            ${Object.entries(CLASS_TYPES).map(([k, v]) => `<option value="${k}">${escapeHtml(v.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row compact">
          <label>Start</label>
          <input type="time" id="wizNewClassStart">
        </div>
        <div class="form-row compact">
          <label>End</label>
          <input type="time" id="wizNewClassEnd">
        </div>
      </div>
      <button class="btn btn-black" style="width: 100%; margin-bottom: 6px;" onclick="wizardAddClass()">+ Add class</button>
      <button class="btn" style="width: 100%;" onclick="wizardCopyEdgeworth()">Copy schedule from Edgeworth</button>
    </div>`;
  } else if (step === 3) {
    const instrCount = w.instructors.length;
    const hasSeedSchedule = SCHOOL_DATA_SEED[w.schoolId]?.schedule?.length > 0;
    const classCount = hasSeedSchedule ? SCHOOL_DATA_SEED[w.schoolId].schedule.length : w.schedule.length;
    html += `<div class="lp-section">
      <div class="lp-section-title">Review</div>
      <div class="detail-row"><div class="detail-label">School</div><div class="detail-val">${escapeHtml(w.schoolName)}, ${escapeHtml(w.state)}</div></div>
      <div class="detail-row"><div class="detail-label">Admin</div><div class="detail-val">${escapeHtml(w.contact.adminName || '—')} (${escapeHtml(w.contact.adminEmail || '—')})</div></div>
      <div class="detail-row"><div class="detail-label">Instructors</div><div class="detail-val">${instrCount} configured</div></div>
      <div class="detail-row"><div class="detail-label">Classes</div><div class="detail-val">${classCount} weekly classes${hasSeedSchedule ? ' <span style="font-size: 10px; color: var(--ok); font-weight: 700;">✓ from website</span>' : ''}</div></div>
      ${instrCount === 0 ? '<p style="color: var(--red); font-size: 13px; font-weight: 600;">⚠ Add at least one instructor before finishing.</p>' : ''}
      ${!hasSeedSchedule && classCount === 0 ? '<p style="color: var(--red); font-size: 13px; font-weight: 600;">⚠ Add at least one class before finishing.</p>' : ''}
      <p style="font-size: 12px; color: var(--grey-500); margin-top: 10px;">Default instructor assignments per class start blank — assign them via the roster after finishing.</p>
    </div>`;
  }

  body.innerHTML = html;
  document.getElementById('wizardBack').style.display = step === 0 ? 'none' : 'inline-flex';
  document.getElementById('wizardNext').textContent = step === stepsTotal - 1 ? 'Finish' : 'Next';
}

function renderWizardInstructors() {
  const list = state.wizardData.instructors;
  if (list.length === 0) return '<div style="font-size: 12px; color: var(--grey-500); padding: 8px; text-align: center;">No instructors yet.</div>';
  return list.map((i, idx) => `<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: var(--white); border: 1px solid var(--grey-200); border-radius: var(--r-sm); font-size: 13px;">
    <div>
      <div style="font-weight: 600;">${escapeHtml(i.name)}</div>
      <div style="font-size: 11px; color: var(--grey-500); font-family: 'Oswald', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">${escapeHtml(i.role)}</div>
    </div>
    <button class="btn btn-ghost" style="padding: 4px 8px; font-size: 10px;" onclick="wizardRemoveInstructor(${idx})">Remove</button>
  </div>`).join('');
}

function renderWizardSchedule() {
  const list = state.wizardData.schedule;
  if (list.length === 0) return '<div style="font-size: 12px; color: var(--grey-500); padding: 8px; text-align: center;">No classes yet.</div>';
  const dayLabel = { 0:'Sun',1:'Mon',2:'Tue',3:'Wed',4:'Thu',5:'Fri',6:'Sat' };
  return list.map((c, idx) => {
    const meta = CLASS_TYPES[c.type] || { name: c.type };
    return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--white); border: 1px solid var(--grey-200); border-radius: var(--r-sm); font-size: 12px;">
      <div style="font-family: 'JetBrains Mono', monospace; min-width: 90px;">${dayLabel[c.day]} ${c.start}</div>
      <div style="flex: 1; padding-left: 8px;">${escapeHtml(meta.name)}</div>
      <button class="btn btn-ghost" style="padding: 3px 6px; font-size: 10px;" onclick="wizardRemoveClass(${idx})">×</button>
    </div>`;
  }).join('');
}

function wizardAddInstructor() {
  const name = document.getElementById('wizNewInstrName').value.trim();
  const role = document.getElementById('wizNewInstrRole').value;
  if (!name) { alert('Enter a name.'); return; }
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36).slice(-4);
  state.wizardData.instructors.push({ id, name, short: name.split(' ').pop(), pin: '0000', role });
  document.getElementById('wizNewInstrName').value = '';
  document.getElementById('wizInstrList').innerHTML = renderWizardInstructors();
}

function wizardRemoveInstructor(idx) {
  state.wizardData.instructors.splice(idx, 1);
  document.getElementById('wizInstrList').innerHTML = renderWizardInstructors();
}

function wizardAddClass() {
  const day   = parseInt(document.getElementById('wizNewClassDay').value, 10);
  const type  = document.getElementById('wizNewClassType').value;
  const start = document.getElementById('wizNewClassStart').value;
  const end   = document.getElementById('wizNewClassEnd').value;
  if (!start || !end) { alert('Enter start and end times.'); return; }
  state.wizardData.schedule.push({ day, start, end, type });
  state.wizardData.schedule.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  document.getElementById('wizClassList').innerHTML = renderWizardSchedule();
}

function wizardRemoveClass(idx) {
  state.wizardData.schedule.splice(idx, 1);
  document.getElementById('wizClassList').innerHTML = renderWizardSchedule();
}

function wizardCopyEdgeworth() {
  if (state.wizardData.schedule.length > 0) {
    if (!confirm('This will replace your current schedule with Edgeworth\'s template. Continue?')) return;
  }
  state.wizardData.schedule = EDGEWORTH_SCHEDULE.map(c => ({ ...c }));
  document.getElementById('wizClassList').innerHTML = renderWizardSchedule();
}

function wizardNext() {
  wizardSaveCurrentStep();
  const hasSeed = SCHOOL_DATA_SEED[state.wizardData?.schoolId]?.schedule?.length > 0;
  // For seeded schools skip step 2 (schedule) — go straight to review
  let nextStep = state.wizardStep + 1;
  if (hasSeed && nextStep === 2) nextStep = 3; // skip schedule step
  if (nextStep < 4) {
    state.wizardStep = nextStep;
    renderWizardStep();
  } else {
    finishWizard();
  }
}

function wizardBack() {
  const hasSeed = SCHOOL_DATA_SEED[state.wizardData?.schoolId]?.schedule?.length > 0;
  let prevStep = state.wizardStep - 1;
  if (hasSeed && prevStep === 2) prevStep = 1; // skip schedule step going back
  state.wizardStep = Math.max(0, prevStep);
  renderWizardStep();
}

function wizardSaveCurrentStep() {
  const step = state.wizardStep;
  if (step === 0) {
    state.wizardData.contact = {
      adminName:     document.getElementById('wizContactName').value.trim(),
      adminEmail:    document.getElementById('wizContactEmail').value.trim(),
      locationLabel: document.getElementById('wizContactLocation').value.trim() || state.wizardData.schoolName
    };
  }
  // Steps 1 + 2 mutate state directly via add/remove handlers.
}

async function finishWizard() {
  const w = state.wizardData;
  const hasSeedSchedule = SCHOOL_DATA_SEED[w.schoolId]?.schedule?.length > 0;
  if (w.instructors.length === 0) {
    alert('You must add at least one instructor before finishing.');
    return;
  }
  if (!hasSeedSchedule && w.schedule.length === 0) {
    alert('You must add at least one class before finishing.');
    return;
  }
  state.customSchools[w.schoolId] = {
    instructors: w.instructors,
    // Only store wizard schedule if school has no seed schedule
    schedule: hasSeedSchedule ? [] : w.schedule,
    defaults: w.defaults,
    contact: w.contact
  };
  state.schoolId = w.schoolId;   // switch first so the per-school save targets this new school
  await saveCustomSchools();
  document.getElementById('schoolName').textContent = w.schoolName;
  closeModal('modalWizard');
  const schoolName = w.schoolName;
  state.wizardData = null;
  // Load this new school's own (empty) data set so nothing from the
  // previously-selected school carries over into it.
  await loadCurrentSchoolData();
  saveUserAsync();
  alert('Welcome to ' + schoolName + '!\nNow assign instructors to each class via Edit roster.');
  setView('roster');
}

// ---------- Edit roster ----------
async function resetEdit() {
  const key = state.editingKey;
  if (!key) return;
  if (!confirm('Reset to default roster assignments for this class? Removes any custom overrides.')) return;
  delete state.edits[key];
  await saveEdits();
  closeModal('modalEdit');
  if (state.view === 'roster') renderDay();
}

// ===== Recurring roster + week rotation editor (Stage 2) =====
// Edits the DEFAULT assignment for a class (every week), incl. per-week rotation.
// A role value is either a fixed instructor id (string), null, or { rotate:[{id,weeks:[]}] }.
let _rotationKey = null;
let _rotationDraft = null;
const ROT_ROLES = [['lead','Lead'],['assist','Assistant'],['junior','Junior assistant'],['backup','Backup']];

function openRotationFromEdit() {
  if (!requireRole('admin')) return;
  const key = state.editingClassKey;
  if (!key) return;
  closeModal('modalEdit');
  openRotationEditor(key);
}

function openRotationEditor(key) {
  if (!requireRole('admin')) return;
  _rotationKey = key;
  const def = currentDefaults()[key] || {};
  _rotationDraft = {};
  ROT_ROLES.forEach(([r]) => {
    const v = def[r];
    _rotationDraft[r] = isRotation(v)
      ? { rotate: v.rotate.map(s => ({ id: s.id || '', weeks: (s.weeks || []).slice() })) }
      : (v || null);
  });
  const parts = key.split('-');
  const day = +parts[0], start = parts[1], type = parts.slice(2).join('-');
  const meta = CLASS_TYPES[type];
  const sub = document.getElementById('rotationSub');
  if (sub) sub.innerHTML =
    `<strong>${DAY_NAMES[day]} ${start} · ${escapeHtml(meta ? meta.name : type)}</strong><br>` +
    `Sets the recurring roster for <em>every</em> ${DAY_NAMES[day]}. One-off changes on a specific date stay separate.`;
  renderRotationBody();
  openModal('modalRotation');
}

function instrOptions(selected) {
  return '<option value="">— Unassigned —</option>' +
    currentInstructors().map(i => `<option value="${i.id}"${i.id === selected ? ' selected' : ''}>${escapeHtml(i.name)}</option>`).join('');
}

function renderRotationBody() {
  const body = document.getElementById('rotationBody');
  if (!body) return;
  body.innerHTML = ROT_ROLES.map(([role, label]) => {
    const v = _rotationDraft[role];
    const rotating = isRotation(v);
    let inner;
    if (rotating) {
      const rows = v.rotate.map((s, i) => `
        <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">
          <select id="rot-${role}-${i}-id" onchange="syncRot('${role}')" style="flex:1;min-width:0;padding:8px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:14px;">${instrOptions(s.id)}</select>
          <input id="rot-${role}-${i}-wk" oninput="syncRot('${role}')" value="${(s.weeks || []).join(',')}" inputmode="numeric" placeholder="1,3,5" title="Weeks 1-12, comma separated" style="width:84px;flex:none;padding:8px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:14px;" />
          <button onclick="rotRemoveRow('${role}',${i})" title="Remove" style="background:none;border:none;color:var(--grey-500);font-size:20px;line-height:1;cursor:pointer;padding:0 4px;flex:none;">&times;</button>
        </div>`).join('');
      inner = `${rows}
        <button class="btn btn-ghost btn-sm" onclick="rotAddRow('${role}')" style="margin-top:2px;">+ Add instructor</button>
        <div id="rot-${role}-status" style="font-size:12px;margin-top:6px;"></div>`;
    } else {
      inner = `<select onchange="rotSetFixed('${role}',this.value)" style="width:100%;padding:9px 11px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:14px;">${instrOptions(v)}</select>`;
    }
    return `
      <div style="background:var(--off-white);border:1px solid var(--grey-200);border-radius:var(--r-sm);padding:10px 12px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
          <label style="margin:0;font-weight:700;">${label}</label>
          <div style="display:flex;gap:4px;flex:none;">
            <button onclick="rotSetMode('${role}','fixed')" class="btn btn-sm" style="${!rotating ? 'background:var(--black);color:var(--white);' : 'background:var(--white);'}padding:4px 10px;font-size:11px;">Fixed</button>
            <button onclick="rotSetMode('${role}','rotate')" class="btn btn-sm" style="${rotating ? 'background:var(--black);color:var(--white);' : 'background:var(--white);'}padding:4px 10px;font-size:11px;">Rotate</button>
          </div>
        </div>
        ${inner}
      </div>`;
  }).join('');
  ROT_ROLES.forEach(([r]) => { if (isRotation(_rotationDraft[r])) updateRotStatus(r); });
}

function parseWeeks(str) {
  const out = [];
  (str || '').split(',').forEach(p => {
    const n = parseInt(p.trim(), 10);
    if (n >= 1 && n <= 12 && !out.includes(n)) out.push(n);
  });
  return out.sort((a, b) => a - b);
}

function syncRot(role) {
  const v = _rotationDraft[role];
  if (!isRotation(v)) return;
  v.rotate.forEach((s, i) => {
    const idEl = document.getElementById(`rot-${role}-${i}-id`);
    const wkEl = document.getElementById(`rot-${role}-${i}-wk`);
    if (idEl) s.id = idEl.value || '';
    if (wkEl) s.weeks = parseWeeks(wkEl.value);
  });
  updateRotStatus(role);
}

function updateRotStatus(role) {
  const v = _rotationDraft[role];
  const el = document.getElementById(`rot-${role}-status`);
  if (!el || !isRotation(v)) return;
  const res = validateRotation(v.rotate);
  if (res.overlaps.length) {
    el.innerHTML = `<span style="color:var(--red);font-weight:600;">&#9888; Two people on week${res.overlaps.length > 1 ? 's' : ''} ${res.overlaps.join(', ')} — fix before saving.</span>`;
  } else if (res.missing.length) {
    el.innerHTML = `<span style="color:#92400e;">No one on week${res.missing.length > 1 ? 's' : ''} ${res.missing.join(', ')} (left unassigned — that's allowed).</span>`;
  } else {
    el.innerHTML = `<span style="color:var(--ok);font-weight:600;">&#10003; Weeks 1–12 all covered.</span>`;
  }
}

function rotSetMode(role, mode) {
  syncRot(role);
  const cur = _rotationDraft[role];
  if (mode === 'rotate' && !isRotation(cur)) {
    _rotationDraft[role] = { rotate: [{ id: cur || '', weeks: [1,2,3,4,5,6,7,8,9,10,11,12] }] };
  } else if (mode === 'fixed' && isRotation(cur)) {
    const first = cur.rotate.find(s => s.id);
    _rotationDraft[role] = first ? first.id : null;
  }
  renderRotationBody();
}

function rotSetFixed(role, val) { _rotationDraft[role] = val || null; }

function rotAddRow(role) {
  syncRot(role);
  if (isRotation(_rotationDraft[role])) {
    _rotationDraft[role].rotate.push({ id: '', weeks: [] });
    renderRotationBody();
  }
}

function rotRemoveRow(role, i) {
  syncRot(role);
  if (isRotation(_rotationDraft[role])) {
    _rotationDraft[role].rotate.splice(i, 1);
    if (!_rotationDraft[role].rotate.length) _rotationDraft[role] = null;
    renderRotationBody();
  }
}

// Make sure the current school has an editable custom copy (seeded from the
// merged view) so writing a rotation never silently drops seed schedule/defaults.
function ensureEditableSchool() {
  const sid = state.schoolId;
  const merged = getSchoolData(sid) || {};
  if (!state.customSchools[sid]) state.customSchools[sid] = {};
  const cs = state.customSchools[sid];
  if (!Array.isArray(cs.instructors) || !cs.instructors.length) cs.instructors = JSON.parse(JSON.stringify(merged.instructors || []));
  if (!Array.isArray(cs.schedule) || !cs.schedule.length) cs.schedule = JSON.parse(JSON.stringify(merged.schedule || []));
  if (!cs.defaults || !Object.keys(cs.defaults).length) cs.defaults = JSON.parse(JSON.stringify(merged.defaults || {}));
  return cs;
}

async function saveRotation() {
  if (!requireRole('admin')) return;
  ROT_ROLES.forEach(([r]) => syncRot(r));
  const bad = ROT_ROLES.filter(([r]) => isRotation(_rotationDraft[r]) && validateRotation(_rotationDraft[r].rotate).overlaps.length);
  if (bad.length) { alert("Two people can't be on the same week in one role. Fix the highlighted weeks, then save."); return; }
  const out = {};
  ROT_ROLES.forEach(([r]) => {
    const v = _rotationDraft[r];
    if (isRotation(v)) {
      const rows = v.rotate.filter(s => s.id && s.weeks.length);
      out[r] = rows.length ? { rotate: rows } : null;
    } else {
      out[r] = v || null;
    }
  });
  const cs = ensureEditableSchool();
  cs.defaults[_rotationKey] = out;
  try {
    await saveCustomSchools();
  } catch (e) {
    alert('Could not save: ' + (e && e.message ? e.message : e));
    return;
  }
  closeModal('modalRotation');
  if (state.view === 'roster') renderDay();
}

function openEdit(dateKey) {
  if (!state.user) { openLogin(); return; }
  state.editingKey = dateKey;
  const datePart = dateKey.slice(0, 10);
  const date = new Date(datePart + 'T00:00:00');
  const c = rosterForDay(date).find(x => x.dateKey === dateKey);
  if (!c) return;
  document.getElementById('editTitle').textContent = 'Edit · ' + c.meta.name;
  document.getElementById('editSubtitle').textContent = `${DAY_NAMES[date.getDay()]} ${formatDate(date)} · ${c.start}–${c.end}`;
  const opts = '<option value="">— Unassigned —</option>' + currentInstructors().map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
  ['editLead','editAssist','editJunior','editBackup'].forEach(id => document.getElementById(id).innerHTML = opts);
  document.getElementById('editLead').value   = c.lead   || '';
  document.getElementById('editAssist').value = c.assist || '';
  document.getElementById('editJunior').value = c.junior || '';
  document.getElementById('editBackup').value = c.backup || '';
  document.getElementById('editStatus').value = c.status || 'confirmed';
  document.getElementById('editNotes').value  = state.edits[dateKey]?.notes || '';
  state.editingClassKey = c.key;
  const rotBtn = document.getElementById('editRotationBtn');
  if (rotBtn) rotBtn.style.display = can.manageInstructors() ? 'block' : 'none';
  openModal('modalEdit');
}

async function saveEdit() {
  if (!requireRole('admin')) return;
  const key = state.editingKey;
  if (!key) return;
  const notes = document.getElementById('editNotes').value.trim();
  state.edits[key] = {
    lead:   document.getElementById('editLead').value   || null,
    assist: document.getElementById('editAssist').value || null,
    junior: document.getElementById('editJunior').value || null,
    backup: document.getElementById('editBackup').value || null,
    status: document.getElementById('editStatus').value,
    notes:  notes || undefined,
    editedBy:  state.user ? state.user.name : 'unknown',
    editedAt:  new Date().toISOString()
  };
  await saveEdits();
  closeModal('modalEdit');
  if (state.view === 'roster') renderDay();
}

async function markNeedsCover(dateKey) {
  if (!state.user) { openLogin(); return; }
  const existing = state.edits[dateKey] || {};
  state.edits[dateKey] = { ...existing, status: 'needs-cover' };
  await saveEdits();
  renderDay();
  notifyBackupOfCover(dateKey); // alert the listed backup — best-effort, non-blocking
}

// Send a push to the class's listed backup. The in-app banner (myBackupCoverAlerts)
// is derived separately, so the backup sees it on next open even without push enabled.
async function notifyBackupOfCover(dateKey) {
  try {
    const c = classForDateKey(dateKey);
    if (!c || !c.backup) return;
    const backupUid = uidForInstructorId(c.backup);
    if (!backupUid || backupUid === state.user.id) return; // no linked login, or you are the backup
    const date = new Date(dateKey.slice(0, 10) + 'T00:00:00');
    const when = `${DAY_NAMES[date.getDay()]} ${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
    const cls = (CLASS_TYPES[c.type] && CLASS_TYPES[c.type].name) || c.type;
    await DB.sendPushNotification({
      title: 'Cover needed',
      body: `${cls} on ${when} (${c.start}) needs cover — you're the listed backup.`,
      url: './', tag: 'cover-' + dateKey, schoolId: state.schoolId,
      targetUserIds: [backupUid], excludeUserId: state.user.id,
    });
  } catch (e) { /* best-effort */ }
}

// Upcoming classes (next 28 days) that need cover AND list the current user as backup.
function myBackupCoverAlerts() {
  const id = myInstructorId();
  if (!id) return [];
  const out = []; const today = new Date();
  for (let i = 0; i < 28; i++) {
    const date = addDays(today, i);
    if (!getActiveDays().includes(date.getDay())) continue;
    for (const c of rosterForDay(date)) {
      if (c.status === 'needs-cover' && c.backup === id) out.push({ c, date, daysOut: i });
    }
  }
  return out;
}

async function volunteerToCover(dateKey) {
  if (!state.user) { openLogin(); return; }
  const existing = state.edits[dateKey] || {};
  state.edits[dateKey] = {
    ...existing,
    lead: myInstructorId() || state.user.id,
    status: 'confirmed'
  };
  await saveEdits();
  renderDay();
  // Close the expanded card
  const el = document.getElementById('card-' + dateKey);
  if (el) el.classList.remove('open');
}

// ---------- Lesson plans ----------
function openPlan(dateKey) {
  if (!state.user) { openLogin(); return; }
  state.planningKey = dateKey;

  const datePart = dateKey.slice(0, 10);
  const date = new Date(datePart + 'T00:00:00');
  const c = rosterForDay(date).find(x => x.dateKey === dateKey);
  if (!c) return;

  const meta = c.meta;
  const existing = state.plans[dateKey] || {};
  const leadInstr = getInstructor(c.lead);
  const assistInstr = getInstructor(c.assist);
  const juniorInstr = getInstructor(c.junior);
  const contact = currentContact() || {};
  const weekNum = getWeekNumber(startOfWeek(date));

  document.getElementById('planTitle').textContent = 'Lesson plan · ' + meta.name;
  document.getElementById('planSubtitle').textContent = `${DAY_NAMES[date.getDay()]} ${formatDate(date)} · ${c.start}–${c.end}`;

  // Pre-fill from roster + topic
  document.getElementById('planDate').value      = existing.date || datePart;
  document.getElementById('planType').value      = existing.classType ? CLASS_TYPES[existing.classType]?.name || existing.classType : meta.name;
  document.getElementById('planTerm').value      = existing.term || '';
  document.getElementById('planWeek').value      = existing.week || weekNum;
  document.getElementById('planLocation').value  = existing.location || contact.locationLabel || '';
  document.getElementById('planInstructor').value= existing.instructor || (leadInstr ? leadInstr.name : '');
  document.getElementById('planAssist').value    = existing.assist || (assistInstr ? assistInstr.name : '');
  document.getElementById('planJunior').value    = existing.junior || (juniorInstr ? juniorInstr.name : '');
  document.getElementById('planTheme').value     = existing.theme || (c.topicNum ? `Topic ${c.topicNum} — ${c.topicContent?.title || ''}` : '');
  document.getElementById('planObjective').value = existing.objective || '';
  document.getElementById('planNotices').value   = existing.notices || '';
  document.getElementById('planWarmup').value    = existing.warmup || '';
  document.getElementById('planTechniques').value= existing.techniques || '';
  document.getElementById('planCooldown').value  = existing.cooldown || '';
  document.getElementById('planNotes').value     = existing.notes || '';
  document.getElementById('planIncidents').value = existing.incidents || '';

  openModal('modalPlan');
  applyPlanEditorChrome(dateKey, existing);
}

// Shared chrome for the plan editor — read-only state, share toggle, delete visibility.
// Used by both the roster lesson plan (openPlan) and the grading lesson plan (openGradingPlan).
function applyPlanEditorChrome(key, existing) {
  const editable = canEditPlan(key);
  const isGrading = typeof key === 'string' && key.startsWith('grading-');
  const planFieldIds = ['planDate','planTerm','planWeek','planLocation','planInstructor','planAssist',
    'planJunior','planTheme','planObjective','planNotices','planWarmup','planTechniques','planCooldown',
    'planNotes','planIncidents'];
  for (const id of planFieldIds) {
    const el = document.getElementById(id);
    if (el) el.readOnly = !editable;
  }
  const banner = document.getElementById('planReadonlyBanner');
  if (banner) banner.style.display = editable ? 'none' : 'block';
  const saveActions = document.getElementById('planSaveActions');
  if (saveActions) saveActions.style.display = editable ? 'flex' : 'none';
  const fillHint = document.querySelector('#modalPlan .lp-fill-hint');
  if (fillHint) fillHint.style.display = (editable && !isGrading) ? '' : 'none';
  const fileIncidentBtn = document.querySelector('#modalPlan .btn-warn');
  if (fileIncidentBtn) fileIncidentBtn.style.display = (editable && !isGrading) ? '' : 'none';

  // Superadmin network-share toggle (not offered for grading plans)
  const shareRow = document.getElementById('planShareRow');
  const shareCb  = document.getElementById('planShared');
  if (shareRow && shareCb) {
    shareRow.style.display = (editable && can.switchAnySchool() && !isGrading) ? 'block' : 'none';
    shareCb.checked = !!existing.shared;
  }

  const deleteBtn = document.getElementById('deletePlanBtn');
  if (deleteBtn) deleteBtn.style.display = (existing && Object.keys(existing).length > 1 && editable && (isGrading ? can.manageGrading() : can.deletePlans())) ? 'block' : 'none';
}

// Lesson plan attached to a grading session (change 9). Stored under key "grading-{id}".
function openGradingPlan(sessionId) {
  if (!can.manageGrading()) { alert('Grading manager access required.'); return; }
  const s = state.grading[sessionId];
  if (!s) return;
  const key = 'grading-' + sessionId;
  state.planningKey = key;
  const existing = state.plans[key] || {};
  const syl = GRADING_SYLLABI[s.syllabus];
  const sylLabel = syl?.label || syl?.name || s.syllabus || 'Grading';

  document.getElementById('planTitle').textContent = 'Grading lesson plan';
  document.getElementById('planSubtitle').textContent = `${sylLabel} · ${s.date || ''}${s.location ? ' · ' + s.location : ''}`;
  document.getElementById('planDate').value       = existing.date || s.date || isoDate(new Date());
  document.getElementById('planType').value       = existing.classType || sylLabel;
  document.getElementById('planTerm').value       = existing.term || '';
  document.getElementById('planWeek').value       = existing.week || '';
  document.getElementById('planLocation').value   = existing.location || s.location || '';
  document.getElementById('planInstructor').value = existing.instructor || (state.user?.name || '');
  document.getElementById('planAssist').value     = existing.assist || '';
  document.getElementById('planJunior').value     = existing.junior || '';
  document.getElementById('planTheme').value      = existing.theme || 'Grading preparation';
  document.getElementById('planObjective').value  = existing.objective || '';
  document.getElementById('planNotices').value    = existing.notices || '';
  document.getElementById('planWarmup').value     = existing.warmup || '';
  document.getElementById('planTechniques').value = existing.techniques || '';
  document.getElementById('planCooldown').value   = existing.cooldown || '';
  document.getElementById('planNotes').value      = existing.notes || '';
  document.getElementById('planIncidents').value  = existing.incidents || '';

  openModal('modalPlan');
  applyPlanEditorChrome(key, existing);
}

function fillFromTopic() {
  const dateKey = state.planningKey;
  if (!dateKey) return;
  const datePart = dateKey.slice(0, 10);
  const date = new Date(datePart + 'T00:00:00');
  const c = rosterForDay(date).find(x => x.dateKey === dateKey);
  if (!c || !c.topicContent) return;

  const t = c.topicContent;
  // Warmup: fitness from the chart, plus a standard bow-in
  const warmupParts = ['Bow in'];
  if (t.fitness) warmupParts.push(t.fitness);
  document.getElementById('planWarmup').value = warmupParts.join('\n');

  // Techniques: combine basics + grappling + self-defence + sparring + techniques
  const techParts = [];
  if (t.basics)      techParts.push('Basics:\n' + t.basics);
  if (t.grappling)   techParts.push('Grappling:\n' + t.grappling);
  if (t.selfDefence) techParts.push('Self defence:\n' + t.selfDefence);
  if (t.sparring)    techParts.push('Sparring:\n' + t.sparring);
  if (t.techniques)  techParts.push('Techniques:\n' + t.techniques);
  if (t.tachi)       techParts.push('Tachi waza:\n' + t.tachi);
  if (t.round)       techParts.push('Round type:\n' + t.round);
  if (t.drills)      techParts.push('Drills:\n' + t.drills);
  if (t.equipment)   techParts.push('Equipment:\n' + t.equipment);
  if (t.kata)        techParts.push('Kata practice');
  if (t.weapons)     techParts.push('Weapons (kids)');
  document.getElementById('planTechniques').value = techParts.join('\n\n');

  // Cool-down default
  if (!document.getElementById('planCooldown').value) {
    document.getElementById('planCooldown').value = '5 min stretch';
  }
}

async function savePlan(status) {
  const dateKey = state.planningKey;
  if (!dateKey) return;
  if (!canEditPlan(dateKey)) { alert('You can only edit plans for classes you are rostered on.'); return; }

  const isGrading = dateKey.startsWith('grading-');
  let c = null;
  if (!isGrading) {
    const datePart = dateKey.slice(0, 10);
    const date = new Date(datePart + 'T00:00:00');
    c = rosterForDay(date).find(x => x.dateKey === dateKey);
    if (!c) return;
  }

  const shared = !isGrading && can.switchAnySchool() && document.getElementById('planShared')?.checked;

  state.plans[dateKey] = {
    key: dateKey,
    schoolId: state.schoolId,
    classType: isGrading ? (document.getElementById('planType').value || 'Grading') : c.type,
    start: isGrading ? '' : c.start,
    end: isGrading ? '' : c.end,
    gradingSessionId: isGrading ? dateKey.slice('grading-'.length) : undefined,
    date: document.getElementById('planDate').value,
    term: document.getElementById('planTerm').value,
    week: document.getElementById('planWeek').value,
    location: document.getElementById('planLocation').value,
    instructor: document.getElementById('planInstructor').value,
    assist: document.getElementById('planAssist').value,
    junior: document.getElementById('planJunior').value,
    theme: document.getElementById('planTheme').value,
    objective: document.getElementById('planObjective').value,
    notices: document.getElementById('planNotices').value,
    warmup: document.getElementById('planWarmup').value,
    techniques: document.getElementById('planTechniques').value,
    cooldown: document.getElementById('planCooldown').value,
    notes: document.getElementById('planNotes').value,
    incidents: document.getElementById('planIncidents').value,
    status,
    shared: !!shared,
    updatedBy: state.user ? state.user.name : 'unknown',
    updatedAt: new Date().toISOString()
  };
  await savePlans();
  closeModal('modalPlan');
  if (isGrading) { if (state.view === 'grading') renderGrading(); }
  else if (state.view === 'plans') renderPlans();
  else if (state.view === 'roster') renderDay();
}

function emailPlan() {
  const dateKey = state.planningKey;
  if (!dateKey) { alert('Save the plan first.'); return; }
  const contact = currentContact() || {};
  const to = contact.adminEmail || '';
  const p = {
    date:       document.getElementById('planDate').value,
    type:       document.getElementById('planType').value,
    term:       document.getElementById('planTerm').value,
    week:       document.getElementById('planWeek').value,
    location:   document.getElementById('planLocation').value,
    instructor: document.getElementById('planInstructor').value,
    assist:     document.getElementById('planAssist').value,
    junior:     document.getElementById('planJunior').value,
    theme:      document.getElementById('planTheme').value,
    objective:  document.getElementById('planObjective').value,
    notices:    document.getElementById('planNotices').value,
    warmup:     document.getElementById('planWarmup').value,
    techniques: document.getElementById('planTechniques').value,
    cooldown:   document.getElementById('planCooldown').value,
    notes:      document.getElementById('planNotes').value,
    incidents:  document.getElementById('planIncidents').value
  };

  const subject = `KR Class Plan — ${p.date} — ${p.type}`;
  const body = `KR CLASS PLAN

CLASS INFO
Date: ${p.date}
Class type: ${p.type}
Term: ${p.term}    Week: ${p.week}
Location: ${p.location}

INSTRUCTORS
Class instructor: ${p.instructor}
Assistant: ${p.assist}
Junior assistant: ${p.junior}

CLASS THEME & OBJECTIVE
Theme: ${p.theme}
Objective: ${p.objective}
Notices / message of the day: ${p.notices}

PLAN CONTENT
Bow in & warm up:
${p.warmup}

Techniques & drills:
${p.techniques}

Cool down, bow out & repeat notices:
${p.cooldown}

NOTES & INCIDENTS
Notes: ${p.notes}
Incidents reported: ${p.incidents}

— Sent from KRMAS Roster app`;

  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  // Use a temp anchor to avoid navigating away from the PWA
  const a = document.createElement('a');
  a.href = mailto;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ---------- Modal helpers ----------
let _modalZ = 100;
function openModal(id)  {
  const el = document.getElementById(id);
  if (!el) return;
  // Each newly opened modal sits above any already-open modal, so dialogs opened
  // from within another dialog (e.g. "+ Upload" inside My Documents) appear on top
  // rather than behind, regardless of their order in the HTML source.
  _modalZ += 1;
  el.style.zIndex = _modalZ;
  el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  el.style.zIndex = '';
  if (!document.querySelector('.modal-bg.open')) _modalZ = 100; // reset when all modals closed
}

document.querySelectorAll('.modal-bg').forEach(bg => {
  bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); });
});

// ---------- Incident reports ----------

function selectChip(groupId, btn) {
  const grp = document.getElementById(groupId);
  grp.querySelectorAll('.ir-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
}

function getChipValue(groupId) {
  const active = document.querySelector('#' + groupId + ' .ir-chip.active');
  return active ? active.dataset.val : '';
}

function setChipValue(groupId, val) {
  const grp = document.getElementById(groupId);
  grp.querySelectorAll('.ir-chip').forEach(c => c.classList.toggle('active', c.dataset.val === val));
}

function openIncident(existingId, classContext) {
  if (!state.user) { openLogin(); return; }
  state.editingIncidentId = existingId || null;
  const existing = existingId ? state.incidents[existingId] : null;

  // Auto-fill defaults
  const now = new Date();
  const dateDefault = existing ? existing.date : isoDate(now);
  const timeDefault = existing ? existing.time : `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const reporterDefault = state.user ? state.user.name : '';

  document.getElementById('incidentTitle').textContent = existing ? 'Incident report — editing' : 'Incident report';
  document.getElementById('incidentSubtitle').textContent = existing
    ? `Created ${existing.createdAt ? new Date(existing.createdAt).toLocaleString() : '—'}`
    : 'Document the incident accurately. All fields can be edited before saving.';

  // Reset all chips
  setChipValue('incType',     existing?.type     || '');
  setChipValue('incSeverity', existing?.severity || '');

  // Field defaults
  document.getElementById('incPersonName').value        = existing?.personName || '';
  document.getElementById('incPersonAge').value         = existing?.personAge || '';
  document.getElementById('incPersonRole').value        = existing?.personRole || 'student';
  document.getElementById('incGuardian').value          = existing?.guardian || '';
  document.getElementById('incDate').value              = dateDefault;
  document.getElementById('incTime').value              = timeDefault;
  document.getElementById('incLocation').value          = existing?.location || '';
  document.getElementById('incClassContext').value      = existing?.classContext || classContext || '';
  document.getElementById('incDescription').value       = existing?.description || '';
  document.getElementById('incBodyPart').value          = existing?.bodyPart || '';
  document.getElementById('incCause').value             = existing?.cause || '';
  document.getElementById('incFirstAid').checked        = !!existing?.firstAid;
  document.getElementById('incFirstAidDetails').value   = existing?.firstAidDetails || '';
  document.getElementById('incAmbulance').checked       = !!existing?.ambulance;
  document.getElementById('incMedical').checked         = !!existing?.medical;
  document.getElementById('incParentNotified').checked  = !!existing?.parentNotified;
  document.getElementById('incReturnedToClass').checked = !!existing?.returnedToClass;
  document.getElementById('incReporter').value          = existing?.reporter || reporterDefault;
  document.getElementById('incInstructorsPresent').value= existing?.instructorsPresent || '';
  document.getElementById('incWitnesses').value         = existing?.witnesses || '';
  document.getElementById('incRecordedDojoBook').checked= !!existing?.recordedDojoBook;
  document.getElementById('incEscalated').checked       = !!existing?.escalated;
  document.getElementById('incEscalatedTo').value       = existing?.escalatedTo || '';
  document.getElementById('incActions').value           = existing?.actions || '';
  document.getElementById('incNotes').value             = existing?.notes || '';

  openModal('modalIncident');
  const delBtn = document.getElementById('deleteIncidentBtn');
  if (delBtn) delBtn.style.display = (existingId && can.editIncidents()) ? 'block' : 'none';
}

function collectIncident() {
  return {
    type:               getChipValue('incType'),
    severity:           getChipValue('incSeverity'),
    personName:         document.getElementById('incPersonName').value,
    personAge:          document.getElementById('incPersonAge').value,
    personRole:         document.getElementById('incPersonRole').value,
    guardian:           document.getElementById('incGuardian').value,
    date:               document.getElementById('incDate').value,
    time:               document.getElementById('incTime').value,
    location:           document.getElementById('incLocation').value,
    classContext:       document.getElementById('incClassContext').value,
    description:        document.getElementById('incDescription').value,
    bodyPart:           document.getElementById('incBodyPart').value,
    cause:              document.getElementById('incCause').value,
    firstAid:           document.getElementById('incFirstAid').checked,
    firstAidDetails:    document.getElementById('incFirstAidDetails').value,
    ambulance:          document.getElementById('incAmbulance').checked,
    medical:            document.getElementById('incMedical').checked,
    parentNotified:     document.getElementById('incParentNotified').checked,
    returnedToClass:    document.getElementById('incReturnedToClass').checked,
    reporter:           document.getElementById('incReporter').value,
    instructorsPresent: document.getElementById('incInstructorsPresent').value,
    witnesses:          document.getElementById('incWitnesses').value,
    recordedDojoBook:   document.getElementById('incRecordedDojoBook').checked,
    escalated:          document.getElementById('incEscalated').checked,
    escalatedTo:        document.getElementById('incEscalatedTo').value,
    actions:            document.getElementById('incActions').value,
    notes:              document.getElementById('incNotes').value
  };
}

function validateIncident(inc) {
  const missing = [];
  if (!inc.type)        missing.push('Type');
  if (!inc.severity)    missing.push('Severity');
  if (!inc.personName)  missing.push('Person name');
  if (!inc.date)        missing.push('Date');
  if (!inc.description) missing.push('Description');
  if (!inc.reporter)    missing.push('Reporting instructor');
  return missing;
}

async function deletePlan() {
  const dateKey = state.planningKey;
  if (!dateKey || !state.plans[dateKey]) return;
  const isGrading = dateKey.startsWith('grading-');
  if (isGrading ? !can.manageGrading() : !can.deletePlans()) { alert('You don\'t have permission to delete this plan.'); return; }
  if (!confirm('Delete this lesson plan? Cannot be undone.')) return;
  delete state.plans[dateKey];
  await savePlans();
  closeModal('modalPlan');
  if (isGrading) { if (state.view === 'grading') renderGrading(); }
  else if (state.view === 'plans') renderPlans();
  else if (state.view === 'roster') renderDay();
}

async function saveIncident() {
  if (blockedByImpersonation()) return;
  if (!can.fileIncidents()) { alert('Sign in to save incidents.'); return; }
  const inc = collectIncident();
  const missing = validateIncident(inc);
  if (missing.length > 0) {
    alert('Please fill in required fields: ' + missing.join(', '));
    return;
  }
  const id = state.editingIncidentId || ('INC-' + Date.now().toString(36).toUpperCase());
  const existing = state.incidents[id];
  state.incidents[id] = {
    ...inc,
    id,
    schoolId: state.schoolId,
    createdAt: existing?.createdAt || new Date().toISOString(),
    createdBy: existing?.createdBy || (state.user ? state.user.name : 'unknown'),
    updatedAt: new Date().toISOString(),
    updatedBy: state.user ? state.user.name : 'unknown'
  };
  await saveIncidents();
  closeModal('modalIncident');
  if (state.view === 'incidents') renderIncidents();
  else if (state.view === 'roster') renderDay();
  alert('Incident saved · ID: ' + id);
}

async function deleteIncident() {
  if (!can.editIncidents()) { alert('You don\'t have permission to delete incidents.'); return; }
  const id = state.editingIncidentId;
  if (!id || !state.incidents[id]) return;
  const inc = state.incidents[id];
  if (!confirm(`Delete incident report for ${inc.personName || 'unknown'} on ${inc.date || '—'}? Cannot be undone.`)) return;
  delete state.incidents[id];
  await saveIncidents();
  closeModal('modalIncident');
  if (state.view === 'incidents') renderIncidents();
  else if (state.view === 'roster') renderDay();
}

function formatIncidentText(inc) {
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
  const schoolName = school ? school.name : state.schoolId;
  const id = state.editingIncidentId || '(new)';
  const cb = v => v ? 'Yes' : 'No';

  return `KRMAS INCIDENT REPORT
=====================================

Report ID:  ${id}
School:     ${schoolName}
Created:    ${new Date().toLocaleString()}
Reporter:   ${inc.reporter}

TYPE & SEVERITY
-------------------------------------
Type:       ${inc.type}
Severity:   ${inc.severity}

PERSON INVOLVED
-------------------------------------
Name:       ${inc.personName}
Age:        ${inc.personAge}
Role:       ${inc.personRole}
Guardian:   ${inc.guardian || '—'}

WHEN & WHERE
-------------------------------------
Date:       ${inc.date}
Time:       ${inc.time}
Location:   ${inc.location || '—'}
Class:      ${inc.classContext || '—'}

WHAT HAPPENED
-------------------------------------
Description:
${inc.description}

Body part affected: ${inc.bodyPart || '—'}

Cause / contributing factors:
${inc.cause || '—'}

RESPONSE TAKEN
-------------------------------------
First aid administered:        ${cb(inc.firstAid)}
First aid details:             ${inc.firstAidDetails || '—'}
Ambulance called:              ${cb(inc.ambulance)}
Sent for medical attention:    ${cb(inc.medical)}
Parent/guardian notified:      ${cb(inc.parentNotified)}
Returned to class:             ${cb(inc.returnedToClass)}

WITNESSES & INSTRUCTORS
-------------------------------------
Other instructors present:
${inc.instructorsPresent || '—'}

Witnesses:
${inc.witnesses || '—'}

FOLLOW-UP
-------------------------------------
Recorded in Dojo Incident Book: ${cb(inc.recordedDojoBook)}
Escalated:                      ${cb(inc.escalated)}
Escalated to:                   ${inc.escalatedTo || '—'}

Actions taken / prevention:
${inc.actions || '—'}

Additional notes:
${inc.notes || '—'}

=====================================
Submitted via KRMAS Roster app
`;
}

function formatIncidentHtml(inc) {
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
  const schoolName = school ? school.name : state.schoolId;
  const id = state.editingIncidentId || '(new)';
  const cb = v => v ? '<strong style="color: #d62828;">Yes</strong>' : 'No';
  const esc = s => s ? escapeHtml(s).replace(/\n/g, '<br>') : '—';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>KRMAS Incident Report — ${id}</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 30px; color: #1a1a1a; line-height: 1.5; }
  .header { border-bottom: 4px solid #d62828; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-family: 'Arial Black', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 4px; font-size: 26px; }
  .header .sub { font-size: 12px; color: #555; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  .meta-grid { display: grid; grid-template-columns: 120px 1fr; gap: 4px 16px; font-size: 13px; margin-bottom: 24px; padding: 14px; background: #f5f5f3; border-left: 4px solid #d62828; }
  .meta-grid .lbl { color: #555; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; font-weight: 700; padding-top: 2px; }
  section { margin-bottom: 20px; page-break-inside: avoid; }
  h2 { font-family: 'Arial Black', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; font-size: 12px; color: #d62828; border-bottom: 1px solid #d8d6d2; padding-bottom: 4px; margin-bottom: 10px; }
  .row { display: grid; grid-template-columns: 200px 1fr; gap: 6px 16px; font-size: 13px; padding: 4px 0; }
  .row .lbl { color: #555; font-weight: 600; }
  .severity { display: inline-block; padding: 3px 10px; border-radius: 3px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: white; }
  .severity-low { background: #4a7a52; }
  .severity-medium { background: #d48a1a; }
  .severity-high { background: #d62828; }
  .desc { background: #f9f9f8; padding: 10px 12px; border-left: 3px solid #d8d6d2; font-size: 13px; white-space: pre-wrap; border-radius: 2px; }
  .sig { margin-top: 36px; padding-top: 16px; border-top: 1px solid #d8d6d2; font-size: 12px; }
  .sig-line { display: inline-block; border-bottom: 1px solid #1a1a1a; min-width: 240px; height: 36px; vertical-align: bottom; margin-right: 16px; }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #d8d6d2; font-size: 10px; color: #888; text-align: center; }
  @media print { body { padding: 14mm; } @page { size: A4; margin: 0; } }
</style>
</head>
<body>

<div class="header">
  <h1>KRMAS Incident Report</h1>
  <div class="sub">${escapeHtml(schoolName)} · Report ID ${id}</div>
</div>

<div class="meta-grid">
  <div class="lbl">Date</div><div>${esc(inc.date)}</div>
  <div class="lbl">Time</div><div>${esc(inc.time)}</div>
  <div class="lbl">Location</div><div>${esc(inc.location)}</div>
  <div class="lbl">Class</div><div>${esc(inc.classContext)}</div>
  <div class="lbl">Reporter</div><div>${esc(inc.reporter)}</div>
  <div class="lbl">Severity</div><div><span class="severity severity-${inc.severity}">${esc(inc.severity)}</span></div>
  <div class="lbl">Type</div><div>${esc(inc.type)}</div>
</div>

<section>
  <h2>Person involved</h2>
  <div class="row"><div class="lbl">Full name</div><div>${esc(inc.personName)}</div></div>
  <div class="row"><div class="lbl">Age</div><div>${esc(inc.personAge)}</div></div>
  <div class="row"><div class="lbl">Role</div><div>${esc(inc.personRole)}</div></div>
  <div class="row"><div class="lbl">Parent/guardian</div><div>${esc(inc.guardian)}</div></div>
</section>

<section>
  <h2>What happened</h2>
  <div class="desc">${esc(inc.description)}</div>
  <div class="row" style="margin-top: 10px;"><div class="lbl">Body part affected</div><div>${esc(inc.bodyPart)}</div></div>
  <div class="row"><div class="lbl">Cause / contributing factors</div><div>${esc(inc.cause)}</div></div>
</section>

<section>
  <h2>Response taken</h2>
  <div class="row"><div class="lbl">First aid administered</div><div>${cb(inc.firstAid)}</div></div>
  <div class="row"><div class="lbl">First aid details</div><div>${esc(inc.firstAidDetails)}</div></div>
  <div class="row"><div class="lbl">Ambulance called</div><div>${cb(inc.ambulance)}</div></div>
  <div class="row"><div class="lbl">Sent for medical attention</div><div>${cb(inc.medical)}</div></div>
  <div class="row"><div class="lbl">Parent / guardian notified</div><div>${cb(inc.parentNotified)}</div></div>
  <div class="row"><div class="lbl">Returned to class</div><div>${cb(inc.returnedToClass)}</div></div>
</section>

<section>
  <h2>Witnesses & instructors present</h2>
  <div class="row"><div class="lbl">Other instructors present</div><div>${esc(inc.instructorsPresent)}</div></div>
  <div class="row"><div class="lbl">Witnesses</div><div>${esc(inc.witnesses)}</div></div>
</section>

<section>
  <h2>Follow-up</h2>
  <div class="row"><div class="lbl">Recorded in Dojo Incident Book</div><div>${cb(inc.recordedDojoBook)}</div></div>
  <div class="row"><div class="lbl">Escalated</div><div>${cb(inc.escalated)}</div></div>
  <div class="row"><div class="lbl">Escalated to</div><div>${esc(inc.escalatedTo)}</div></div>
  <div class="row"><div class="lbl">Actions taken / prevention</div><div>${esc(inc.actions)}</div></div>
  <div class="row"><div class="lbl">Additional notes</div><div>${esc(inc.notes)}</div></div>
</section>

<div class="sig">
  <div>Instructor signature: <span class="sig-line"></span> Date: <span class="sig-line" style="min-width: 120px;"></span></div>
  <div style="margin-top: 12px;">Senior review:        <span class="sig-line"></span> Date: <span class="sig-line" style="min-width: 120px;"></span></div>
</div>

<footer>Generated by KRMAS Roster app · ${new Date().toLocaleString()}</footer>

</body></html>`;
}

function downloadIncident() {
  const inc = collectIncident();
  const missing = validateIncident(inc);
  if (missing.length > 0) { alert('Fill in required fields first: ' + missing.join(', ')); return; }
  const html = formatIncidentHtml(inc);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const dateSafe = (inc.date || isoDate(new Date())).replace(/-/g, '');
  const nameSafe = (inc.personName || 'unnamed').replace(/[^a-zA-Z0-9]/g, '_');
  const a = document.createElement('a');
  a.href = url;
  a.download = `KRMAS_incident_${dateSafe}_${nameSafe}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printIncident() {
  const inc = collectIncident();
  const missing = validateIncident(inc);
  if (missing.length > 0) { alert('Fill in required fields first: ' + missing.join(', ')); return; }
  const html = formatIncidentHtml(inc);
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { alert('Allow pop-ups for this site to print.'); return; }
  w.document.write(html);
  w.document.close();
  // Give it a tick to layout, then trigger print
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

function emailIncident() {
  const inc = collectIncident();
  const missing = validateIncident(inc);
  if (missing.length > 0) { alert('Fill in required fields first: ' + missing.join(', ')); return; }
  const contact = currentContact() || {};
  const to = contact.adminEmail || '';
  const sevLabel = (inc.severity || '').toUpperCase();
  const subject = `[INCIDENT — ${sevLabel}] ${inc.date} ${inc.personName} — ${inc.type}`;
  const body = formatIncidentText(inc);
  const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const a = document.createElement('a');
  a.href = mailtoUrl;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function openIncidentFromPlan() {
  // Called from within the lesson plan modal — pre-fill class context from the plan
  const classType = document.getElementById('planType').value;
  openIncident(null, classType);
}

// ---------- Sync indicator ----------
function updateSyncStatus() {
  const dot = document.getElementById('syncDot');
  if (!dot) return;
  const pending = (DB.pendingCount ? DB.pendingCount() : 0);
  dot.classList.remove('offline', 'error', 'pending');
  dot.style.background = '';
  if (!navigator.onLine) {
    dot.classList.add('offline');
    dot.title = pending ? `Offline · ${pending} change${pending === 1 ? '' : 's'} buffered` : 'Offline — saving to this device';
  } else if (pending > 0) {
    dot.classList.add('pending');
    dot.title = `Syncing ${pending} buffered change${pending === 1 ? '' : 's'}…`;
  } else if (DB.isSupabase) {
    dot.style.background = '#10b981';
    dot.title = 'Synced';
  } else {
    dot.title = 'Local only (no Supabase)';
  }
}

// On reconnect, replay any buffered writes then refresh the indicator.
async function syncFlushOnline() {
  updateSyncStatus();
  if (DB.flushQueue) {
    try { const n = await DB.flushQueue(); if (n) console.log('[sync] flushed', n, 'buffered write(s)'); } catch (e) {}
  }
  updateSyncStatus();
}
window.addEventListener('online', syncFlushOnline);
window.addEventListener('offline', updateSyncStatus);

// ---------- Student progression planner ----------

function ppParseDate(v) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + 'T00:00:00');
  return isNaN(d) ? null : d;
}

function ppFmt(d) {
  return d ? d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
}

function ppCalcAge(dob, on) {
  if (!dob || !on) return null;
  let years = on.getFullYear() - dob.getFullYear();
  const m = on.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) years--;
  // Add fractional months
  const monthDiff = on.getMonth() - dob.getMonth() + (on.getDate() < dob.getDate() ? -1 : 0);
  const months = ((monthDiff + 12) % 12);
  return { years, months, decimal: years + (months / 12) };
}

function ppAddDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function ppAddYears(d, y) {
  const r = new Date(d);
  r.setFullYear(r.getFullYear() + Math.floor(y));
  if (y % 1 !== 0) r.setMonth(r.getMonth() + Math.round((y % 1) * 12));
  return r;
}

function ppProjectProgram(prog, startIdx, startDate, dob) {
  // Project the dates each rank from startIdx onwards will be achievable.
  // Each rank requires: (a) reaching the prior rank's date + minDays, (b) reaching minAgeYears
  const out = [];
  let cursor = new Date(startDate);
  for (let i = startIdx; i < prog.ranks.length; i++) {
    const rank = prog.ranks[i];
    let earliest = cursor;
    if (dob && rank.minAgeYears) {
      const minByAge = ppAddYears(dob, rank.minAgeYears);
      if (minByAge > earliest) earliest = minByAge;
    }
    out.push({
      rankId: rank.id,
      label: rank.label,
      date: new Date(earliest),
      ageAtRank: dob ? ppCalcAge(dob, earliest) : null
    });
    cursor = ppAddDays(earliest, rank.minDays || 0);
  }
  return out;
}

function ppRenderProgramChips() {
  const container = document.getElementById('progProgramChips');
  if (!container) return;
  container.innerHTML = PROGRESSION_PROGRAMS.map(p => `
    <label class="pp-chip" for="pp-chip-${p.id}">
      <input type="checkbox" id="pp-chip-${p.id}" data-program-id="${p.id}" onchange="ppToggleProgram('${p.id}', this)">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.colour};flex-shrink:0;"></span>
      <span>${escapeHtml(p.name.replace('KR ', ''))}</span>
    </label>
  `).join('');
}

function ppToggleProgram(programId, input) {
  const chip = input.closest('.pp-chip');
  if (chip) chip.classList.toggle('checked', input.checked);
  // Save current values before rebuilding
  ppSaveCardValues();
  ppRenderProgramCards();
}

function ppGetSelectedPrograms() {
  return [...document.querySelectorAll('#progProgramChips input:checked')].map(i => i.dataset.programId);
}

// Transient per-program field state — survives DOM rebuilds
const _ppCardState = {};

function ppSaveCardValues() {
  for (const progId of Object.keys(_ppCardState)) {
    const selEl = document.getElementById('pp-start-' + progId);
    const dateEl = document.getElementById('pp-date-' + progId);
    if (selEl) _ppCardState[progId].startIdx = selEl.value;
    if (dateEl) _ppCardState[progId].startDate = dateEl.value;
  }
}

function ppRenderProgramCards() {
  const container = document.getElementById('progProgramCards');
  if (!container) return;
  const selected = ppGetSelectedPrograms();
  const dob = ppParseDate(document.getElementById('progDob').value);

  if (selected.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Ensure cache entry exists for each selected program
  for (const progId of selected) {
    if (!_ppCardState[progId]) _ppCardState[progId] = { startIdx: '', startDate: '' };
  }

  let html = '';
  for (const progId of selected) {
    const prog = progressionProgramById(progId);
    if (!prog) continue;
    const saved = _ppCardState[progId] || {};
    // Build options with pre-selected value baked in
    const rankOptions = prog.ranks.map((r, i) =>
      `<option value="${i}"${saved.startIdx === String(i) ? ' selected' : ''}>${escapeHtml(r.label)}</option>`
    ).join('');
    html += `<div class="pp-program-card" style="border-left-color: ${prog.colour};">
      <div class="pp-card-head">
        <div>
          <div class="pp-card-title">${escapeHtml(prog.name)}</div>
          <div class="pp-card-sub">${escapeHtml(prog.type)}</div>
        </div>
      </div>
      <div class="pp-card-row">
        <div class="form-row compact" style="margin: 0;">
          <label>Current rank (or none)</label>
          <select id="pp-start-${progId}">
            <option value=""${!saved.startIdx ? ' selected' : ''}>— Not started —</option>
            ${rankOptions}
          </select>
        </div>
        <div class="form-row compact" style="margin: 0;">
          <label>Last grading / start date</label>
          <input type="date" id="pp-date-${progId}" value="${escapeHtml(saved.startDate || '')}">
        </div>
      </div>
      <div id="pp-warn-${progId}" style="margin-top: 6px; font-size: 11px;"></div>
    </div>`;
  }
  container.innerHTML = html;

  // Age warnings — read-only, no re-render triggered
  if (dob) {
    const today = new Date();
    const age = ppCalcAge(dob, today);
    for (const progId of selected) {
      const prog = progressionProgramById(progId);
      const warnEl = document.getElementById('pp-warn-' + progId);
      if (!warnEl) continue;
      const firstRank = prog.ranks[0];
      if (age.decimal < firstRank.minAgeYears) {
        const eligibleDate = ppAddYears(dob, firstRank.minAgeYears);
        warnEl.innerHTML = `<span class="pp-tag-amber">Eligible from ${ppFmt(eligibleDate)}</span>`;
      } else if (progId === 'miniLittleNinjas' && age.decimal >= 6) {
        warnEl.innerHTML = `<span class="pp-tag-red">Too old for Mini Ninjas — use Little Ninjas</span>`;
      } else if (progId === 'juniorMuayThai' && age.decimal >= 13) {
        warnEl.innerHTML = `<span class="pp-tag-red">Too old for Junior MT — use Muay Thai</span>`;
      }
    }
  }
}

function ppOnRankChange(progId) { /* no longer used */ }

function ppUpdateAgeDisplay() {
  const dob = ppParseDate(document.getElementById('progDob').value);
  const display = document.getElementById('progAge');
  if (!dob) { display.value = ''; return; }
  if (dob > new Date()) { display.value = 'invalid (future date)'; return; }
  const age = ppCalcAge(dob, new Date());
  display.value = `${age.years} years, ${age.months} months`;
  // Save current card values, then re-render to update age warnings
  ppSaveCardValues();
  ppRenderProgramCards();
}

function generateProgression() {
  // Capture latest card field values before reading
  ppSaveCardValues();
  const dob = ppParseDate(document.getElementById('progDob').value);
  const name = document.getElementById('progStudentName').value.trim();
  if (!name) { alert('Enter the student name.'); return; }
  if (!dob)  { alert('Enter a valid date of birth.'); return; }
  if (dob > new Date()) { alert('Date of birth cannot be in the future.'); return; }

  const selected = ppGetSelectedPrograms();
  if (selected.length === 0) { alert('Pick at least one program.'); return; }

  const programResults = {};
  for (const progId of selected) {
    // Read from cache (more reliable than DOM after any rebuild)
    const saved = _ppCardState[progId] || {};
    const startIdxRaw = saved.startIdx || document.getElementById('pp-start-' + progId)?.value || '';
    const startDateRaw = saved.startDate || document.getElementById('pp-date-' + progId)?.value || '';
    const startIdx = startIdxRaw === '' ? null : parseInt(startIdxRaw, 10);
    const startDate = startDateRaw ? ppParseDate(startDateRaw) : new Date();
    const prog = progressionProgramById(progId);
    const projectFrom = startIdx === null ? 0 : startIdx + 1;
    const projection = ppProjectProgram(prog, projectFrom, startDate, dob);
    programResults[progId] = {
      startIdx,
      startDate: startDateRaw,
      currentRankLabel: startIdx !== null ? prog.ranks[startIdx].label : '(not started)',
      projection
    };
  }

  state.progResultsCache = { name, dob: document.getElementById('progDob').value, programs: programResults };
  document.getElementById('progResults').innerHTML = renderProgressionResults();
}

function renderProgressionResults() {
  const cache = state.progResultsCache;
  if (!cache) return '';
  let html = '';
  for (const progId of Object.keys(cache.programs)) {
    const prog = progressionProgramById(progId);
    if (!prog) continue; // program no longer exists — skip
    const data = cache.programs[progId];
    html += `<div style="margin-bottom: 14px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${prog.colour};"></span>
        <strong style="font-size: 13px;">${escapeHtml(prog.name)}</strong>
        <span class="pp-card-sub">· Currently: ${escapeHtml(data.currentRankLabel)}</span>
      </div>`;

    if (data.projection.length === 0) {
      html += `<div style="font-size: 12px; color: var(--grey-500); font-style: italic;">Already at top rank.</div>`;
    } else {
      html += `<div class="pp-table-wrap"><table class="pp-table">
        <thead><tr><th>Rank</th><th>Earliest date</th><th>Age</th></tr></thead>
        <tbody>`;
      for (const row of data.projection) {
        const ageLabel = row.ageAtRank ? `${row.ageAtRank.years}y ${row.ageAtRank.months}m` : '—';
        html += `<tr><td>${escapeHtml(row.label)}</td><td>${ppFmt(row.date)}</td><td>${ageLabel}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }
    html += `</div>`;
  }

  // Transition prompts
  const dob = ppParseDate(cache.dob);
  const selectedIds = Object.keys(cache.programs);
  const transitionsToShow = [];
  for (const t of PROGRESSION_TRANSITIONS) {
    if (selectedIds.includes(t.fromId) && !selectedIds.includes(t.toId)) {
      const transitionDate = ppAddYears(dob, t.minAgeYears);
      transitionsToShow.push({ ...t, transitionDate });
    }
  }
  if (transitionsToShow.length > 0) {
    html += `<div style="margin-top: 14px;">`;
    for (const t of transitionsToShow) {
      html += `<div class="pp-transition">
        <span class="icon">→</span>
        <div>
          <div><strong>${escapeHtml(t.label)}</strong></div>
          <div style="font-size: 11px; opacity: 0.85;">From ${ppFmt(t.transitionDate)}</div>
        </div>
      </div>`;
    }
    html += `</div>`;
  }
  return html;
}

// ---------- Students view ----------
// Merge duplicate student records (same trimmed/lowercased name + same DOB) into a
// single canonical record, re-pointing progression plans, the instructor pathway, and
// any linked grading candidates. Cleans up duplicates created before progression plans
// were forced to start from an existing student. Conservative: only merges when BOTH
// name and DOB are present and match, so distinct students are never collapsed.
async function reconcileStudents() {
  const students = state.students || {};
  const groups = {};
  for (const [id, s] of Object.entries(students)) {
    if (!s || !s.name || !s.dob) continue;
    const key = s.name.trim().toLowerCase() + '|' + s.dob;
    (groups[key] = groups[key] || []).push(id);
  }
  let changed = false;
  for (const ids of Object.values(groups)) {
    if (ids.length < 2) continue;
    // Canonical = the record with the best-presented name (most capitals, then longest,
    // then stable by id), so merging never leaves a messy lower-cased/space-padded name.
    const canonical = ids.slice().sort((a, b) => {
      const na = (students[a].name || '').trim(), nb = (students[b].name || '').trim();
      const ua = (na.match(/[A-Z]/g) || []).length, ub = (nb.match(/[A-Z]/g) || []).length;
      if (ub !== ua) return ub - ua;
      if (nb.length !== na.length) return nb.length - na.length;
      return a.localeCompare(b);
    })[0];
    for (const id of ids) {
      if (id === canonical) continue;
      for (const p of Object.values(state.progressions || {})) {
        if (p && p.studentId === id) { p.studentId = canonical; changed = true; }
      }
      if (state.pathways && state.pathways[id]) {
        const cur = state.pathways[canonical];
        const dup = state.pathways[id];
        if (!cur) {
          state.pathways[canonical] = { ...dup, studentId: canonical };
        } else {
          // Merge so no pathway data is lost when both records have one.
          state.pathways[canonical] = {
            ...dup, ...cur,
            studentId: canonical,
            enrolledInLeadership: !!(cur.enrolledInLeadership || dup.enrolledInLeadership),
            goals:      { ...(dup.goals || {}),      ...(cur.goals || {}) },
            meetings:   { ...(dup.meetings || {}),   ...(cur.meetings || {}) },
            milestones: { ...(dup.milestones || {}), ...(cur.milestones || {}) },
            syllabus:     cur.syllabus     || dup.syllabus     || '',
            summaryNotes: cur.summaryNotes || dup.summaryNotes || '',
            weaknesses:   cur.weaknesses   || dup.weaknesses   || '',
          };
        }
        delete state.pathways[id];
        changed = true;
      }
      for (const sess of Object.values(state.grading || {})) {
        for (const c of (sess.candidates || [])) {
          if (c && c.studentId === id) { c.studentId = canonical; changed = true; }
        }
      }
      delete state.students[id];
      changed = true;
    }
    // Tidy the surviving name.
    if (state.students[canonical] && state.students[canonical].name) {
      const clean = state.students[canonical].name.trim();
      if (clean !== state.students[canonical].name) { state.students[canonical].name = clean; changed = true; }
    }
  }
  if (changed) {
    await saveStudents();
    await saveProgressions();
    await savePathways();
    try { await saveGrading(); } catch (e) {}
  }
  return changed;
}

function renderStudents() {
  hideDayHead();
  const main = document.getElementById('mainContent');
  if (!can.viewStudents()) {
    main.innerHTML = `<div class="empty"><h2>Restricted</h2><p>Sign in as an instructor or admin to view students.</p><button class="btn btn-primary" onclick="openLogin()">Sign in</button></div>`;
    return;
  }
  const studentList = Object.values(state.students || {}).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Count candidates
  const candidateCount = Object.values(state.pathways || {}).filter(p => p.enrolledInLeadership).length;
  const allFlaggedCount = Object.keys(state.pathways || {}).length;

  let html = `<h1 class="section-head">Students <span class="accent">&</span> pathway</h1>`;
  html += `<div style="margin-bottom: 14px;">
    ${can.editPlans() ? `<button class="btn btn-primary" style="width:100%;" onclick="newStudent()">+ Add student</button>` : ''}
  </div>`;

  // Candidates summary (if any flagged)
  if (allFlaggedCount > 0) {
    html += `<div style="background: var(--white); border: 1px solid var(--grey-200); border-left: 4px solid var(--gold); border-radius: var(--r-md); padding: 12px 14px; margin-bottom: 14px; box-shadow: var(--shadow);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--grey-500);">Instructor pathway</div>
          <div style="font-size: 14px; margin-top: 2px;"><strong>${allFlaggedCount}</strong> candidate${allFlaggedCount === 1 ? '' : 's'} tracked · <strong>${candidateCount}</strong> enrolled in Leadership Program</div>
        </div>
      </div>
    </div>`;
  }

  if (studentList.length === 0) {
    html += `<div class="empty">
      <h2>No students yet</h2>
      <p>Plan a student's progression through the KRMAS ranks, including projected dates and age-based program transitions, then flag candidates for the instructor pathway.</p>
    </div>`;
    main.innerHTML = html;
    return;
  }

  // Search + filter (change requested)
  html += `<div style="display:flex;gap:8px;margin-bottom:10px;">
    <input type="search" id="studentSearch" placeholder="Search students by name…" value="${escapeHtml(state.studentSearch || '')}"
      oninput="state.studentSearch=this.value; renderStudentsResults();"
      style="flex:1;padding:9px 12px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:13px;box-sizing:border-box;">
    <select id="studentFilter" onchange="state.studentFilter=this.value; renderStudentsResults();" style="padding:9px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:13px;">
      <option value="all"${(state.studentFilter||'all')==='all'?' selected':''}>All students</option>
      <option value="candidates"${state.studentFilter==='candidates'?' selected':''}>Pathway candidates</option>
      <option value="leadership"${state.studentFilter==='leadership'?' selected':''}>In Leadership Program</option>
      <option value="hasplan"${state.studentFilter==='hasplan'?' selected':''}>Has progression plan</option>
    </select>
  </div>`;
  html += `<div id="studentsResults"></div>`;
  main.innerHTML = html;
  renderStudentsResults();
}

function renderStudentsResults() {
  const box = document.getElementById('studentsResults');
  if (!box) return;
  const q = (state.studentSearch || '').trim().toLowerCase();
  const filter = state.studentFilter || 'all';
  let studentList = Object.values(state.students || {}).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (q) studentList = studentList.filter(s => (s.name || '').toLowerCase().includes(q));
  if (filter !== 'all') {
    studentList = studentList.filter(stu => {
      const pathway = state.pathways[stu.id];
      const progPlans = Object.values(state.progressions).filter(p => p.studentId === stu.id);
      if (filter === 'candidates') return !!pathway;
      if (filter === 'leadership') return pathway && pathway.enrolledInLeadership;
      if (filter === 'hasplan') return progPlans.length > 0;
      return true;
    });
  }

  if (studentList.length === 0) {
    box.innerHTML = `<div style="font-size:13px;color:var(--grey-500);padding:8px 4px;">No students match.</div>`;
    return;
  }

  let html = `<div class="section-sub">Students (${studentList.length})</div>`;
  for (const stu of studentList) {
    const progPlans = Object.values(state.progressions).filter(p => p.studentId === stu.id);
    const pathway = state.pathways[stu.id];
    const pathwayPoints = pathway ? instructorPathwayPoints(pathway) : 0;
    const isCandidate = pathway && pathway.enrolledInLeadership;
    const progDots = [...new Set(progPlans.flatMap(p => Object.keys(p.programs || {})))].map(pid => {
      const pr = progressionProgramById(pid);
      return pr ? `<span class="pp-prog-dot" style="background: ${pr.colour};" title="${escapeHtml(pr.name)}"></span>` : '';
    }).join('');
    const age = stu.dob ? ppCalcAge(new Date(stu.dob + 'T00:00:00'), new Date()) : null;
    html += `<div class="student-card" onclick="openStudent('${stu.id}')">
      <div style="flex: 1; min-width: 0;">
        <div class="name">${escapeHtml(stu.name)}${isCandidate ? '<span class="pw-badge-candidate">Candidate</span>' : ''}</div>
        <div class="meta">${age ? age.years + 'y ' + age.months + 'm' : '—'} · DOB ${ppFmt(stu.dob ? new Date(stu.dob + 'T00:00:00') : null) || '—'}${pathway?.syllabus ? ' · ' + escapeHtml(pathway.syllabus) : ''}</div>
        <div class="progs">${progDots}${progPlans.length > 0 ? ` <span style="font-size: 11px; color: var(--grey-500); margin-left: 4px;">${progPlans.length} plan${progPlans.length === 1 ? '' : 's'}</span>` : ''}${pathway ? ` · <span class="pw-points-pill" style="font-size: 10px; padding: 2px 8px;"><span>PTS</span><span class="num">${pathwayPoints}</span></span>` : ''}</div>
      </div>
    </div>`;
  }
  box.innerHTML = html;
}

// When a student card is tapped, show a proper action sheet
function openStudent(studentId) {
  if (!state.user) { openLogin(); return; }
  const stu = state.students[studentId];
  if (!stu) return;
  const hasProgression = Object.values(state.progressions).some(p => p.studentId === studentId);
  const hasPathway = !!state.pathways[studentId];
  const age = stu.dob ? ppCalcAge(new Date(stu.dob + 'T00:00:00'), new Date()) : null;
  const pathway = state.pathways[studentId];
  const points = pathway ? instructorPathwayPoints(pathway) : 0;
  const isCandidate = pathway && pathway.enrolledInLeadership;

  document.getElementById('actionSheetBody').innerHTML = `
    <h3>${escapeHtml(stu.name)}${isCandidate ? '<span class="pw-badge-candidate">Candidate</span>' : ''}</h3>
    <p class="sub">${age ? age.years + 'y ' + age.months + 'm' : ''}${age && pathway?.syllabus ? ' · ' : ''}${pathway?.syllabus ? escapeHtml(pathway.syllabus) : ''}${pathway ? ` · ${points} pts` : ''}</p>

    ${can.editPlans() ? `<div class="action-sheet-row" onclick="closeModal('modalActions'); openProgressionForStudent('${studentId}')">
      <div class="icon">◷</div>
      <div style="flex: 1;">
        ${hasProgression ? 'Edit progression plan' : 'Create progression plan'}
        <div class="meta">Pathway across the KRMAS rank ladder</div>
      </div>
    </div>` : ''}

    ${can.managePathway() ? `<div class="action-sheet-row ${isCandidate ? 'candidate' : ''}" onclick="closeModal('modalActions'); openPathway('${studentId}')">
      <div class="icon">★</div>
      <div style="flex: 1;">
        ${hasPathway ? 'Open instructor pathway' : 'Start instructor pathway'}
        <div class="meta">Goals, milestones, leadership meetings</div>
      </div>
    </div>` : ''}

    ${can.editPlans() ? `<div class="action-sheet-row" onclick="closeModal('modalActions'); editStudentDetails('${studentId}')">
      <div class="icon">✎</div>
      <div style="flex: 1;">
        Edit student details
        <div class="meta">Name, date of birth</div>
      </div>
    </div>` : ''}

    ${can.deleteStudents() ? `<div class="action-sheet-row danger" onclick="closeModal('modalActions'); deleteStudent('${studentId}')">
      <div class="icon">×</div>
      <div style="flex: 1;">
        Delete student
        <div class="meta">Removes progression plans and pathway data</div>
      </div>
    </div>` : ''}

    <button class="btn btn-ghost" style="width: 100%; margin: 10px 0 6px;" onclick="closeModal('modalActions')">Cancel</button>
  `;
  openModal('modalActions');
}

function editStudentDetails(studentId) {
  state.editingStudentId = studentId;
  const stu = state.students[studentId];
  if (stu) {
    document.getElementById('studentModalTitle').textContent = 'Edit ' + stu.name;
    document.getElementById('studentNameInput').value = stu.name;
    document.getElementById('studentDobInput').value = stu.dob || '';
  } else {
    document.getElementById('studentModalTitle').textContent = 'Add student';
    document.getElementById('studentNameInput').value = '';
    document.getElementById('studentDobInput').value = '';
  }
  openModal('modalStudent');
}

function newStudent() {
  if (!state.user) { openLogin(); return; }
  state.editingStudentId = null;
  editStudentDetails(null);
}

async function saveStudent() {
  if (blockedByImpersonation()) return;
  const name = document.getElementById('studentNameInput').value.trim();
  const dob = document.getElementById('studentDobInput').value;
  if (!name) { alert('Enter a name.'); return; }
  let id = state.editingStudentId;
  if (!id) {
    const norm = name.trim().toLowerCase();
    // Fold into an existing record of the same name (a grading-created stub, or an exact
    // name+DOB match) so manual adds and grading candidates stay a single student record.
    const match = Object.values(state.students).find(s => {
      if ((s.name || '').trim().toLowerCase() !== norm) return false;
      return !s.dob || !dob || s.dob === dob;
    });
    id = match ? match.id : ('STU-' + Date.now().toString(36).toUpperCase());
  }
  const existing = state.students[id] || {};
  state.students[id] = {
    ...existing,
    id, name, dob,
    schoolId: state.schoolId,
    updatedAt: new Date().toISOString(),
    updatedBy: state.user ? state.user.name : 'unknown'
  };
  await saveStudents();
  closeModal('modalStudent');
  if (state.view === 'students') renderStudents();
}

async function deleteStudent(studentId) {
  const stu = state.students[studentId];
  if (!stu) return;
  if (!confirm(`Delete ${stu.name}? This removes their progression plans and instructor pathway. Cannot be undone.`)) return;
  // Cascade
  delete state.students[studentId];
  for (const progId of Object.keys(state.progressions)) {
    if (state.progressions[progId].studentId === studentId) delete state.progressions[progId];
  }
  delete state.pathways[studentId];
  await saveStudents();
  await saveProgressions();
  await savePathways();
  if (state.view === 'students') renderStudents();
}

// ---------- Open / save progression modal ----------
function openProgression(progressionId) {
  if (!state.user) { openLogin(); return; }
  state.editingProgressionId = progressionId || null;
  const existing = progressionId ? state.progressions[progressionId] : null;

  document.getElementById('progTitle').textContent = existing ? 'Edit progression plan' : 'New progression plan';

  // Clear transient card state for a fresh open
  for (const k of Object.keys(_ppCardState)) delete _ppCardState[k];

  ppRenderProgramChips();
  document.getElementById('progResults').innerHTML = '';
  state.progResultsCache = null;

  if (existing) {
    const student = state.students[existing.studentId];
    document.getElementById('progStudentName').value = student?.name || '';
    document.getElementById('progDob').value = student?.dob || '';
    ppUpdateAgeDisplay();

    // Pre-populate _ppCardState from the saved data
    for (const [pid, pdata] of Object.entries(existing.programs || {})) {
      _ppCardState[pid] = {
        startIdx: pdata.startIdx !== null && pdata.startIdx !== undefined ? String(pdata.startIdx) : '',
        startDate: pdata.startDate || ''
      };
    }

    // Check the relevant program chips
    const selectedIds = Object.keys(existing.programs || {});
    for (const pid of selectedIds) {
      const cb = document.querySelector(`#progProgramChips input[data-program-id="${pid}"]`);
      if (cb) {
        cb.checked = true;
        cb.closest('.pp-chip').classList.add('checked');
      }
    }

    state.progResultsCache = {
      name: student?.name || '',
      dob: student?.dob || '',
      programs: { ...existing.programs }
    };
    ppRenderProgramCards();
    document.getElementById('progResults').innerHTML = renderProgressionResults();
  } else {
    document.getElementById('progStudentName').value = '';
    document.getElementById('progDob').value = '';
    document.getElementById('progAge').value = '';
  }

  // Wire DOB change to age display (no re-render of cards)
  document.getElementById('progDob').onchange = ppUpdateAgeDisplay;

  // Show delete only for existing plans
  const delBtn = document.getElementById('deleteProgressionBtn');
  if (delBtn) delBtn.style.display = (progressionId && can.editPlans()) ? 'block' : 'none';

  openModal('modalProgression');
}

function openProgressionForStudent(studentId) {
  const student = state.students[studentId];
  if (!student) return;
  // Find existing progression for this student, or new
  const existing = Object.values(state.progressions).find(p => p.studentId === studentId);
  openProgression(existing?.id);
  if (!existing) {
    document.getElementById('progStudentName').value = student.name;
    document.getElementById('progDob').value = student.dob;
    ppUpdateAgeDisplay();
  }
}

async function deleteProgression() {
  if (!can.editPlans()) return;
  const id = state.editingProgressionId;
  if (!id) return;
  const prog = state.progressions[id];
  const stu = prog ? state.students[prog.studentId] : null;
  if (!confirm(`Delete progression plan${stu ? ' for ' + stu.name : ''}? Cannot be undone.`)) return;
  delete state.progressions[id];
  await saveProgressions();
  closeModal('modalProgression');
  if (state.view === 'students') renderStudents();
}

async function deletePathway() {
  if (!can.managePathway()) return;
  const id = state.editingPathwayId;
  if (!id) return;
  const stu = state.students[id];
  if (!confirm(`Delete instructor pathway for ${stu?.name || 'this student'}? Cannot be undone.`)) return;
  delete state.pathways[id];
  await savePathways();
  closeModal('modalPathway');
  if (state.view === 'students') renderStudents();
}

async function saveProgression() {
  const name = document.getElementById('progStudentName').value.trim();
  const dob = document.getElementById('progDob').value;
  if (!name) { alert('Enter the student name.'); return; }
  if (!dob)  { alert('Enter the date of birth.'); return; }

  // Auto-generate if user hasn't pressed Generate yet (they may have just set grades)
  if (!state.progResultsCache) {
    const selected = ppGetSelectedPrograms();
    if (selected.length === 0) { alert('Pick at least one program.'); return; }
    generateProgression();
    if (!state.progResultsCache) return; // generateProgression showed its own alert
  }

  // Resolve student ID: from existing progression, from existing student with same name/dob,
  // or generate a new one
  let stuId = null;
  if (state.editingProgressionId) {
    stuId = state.progressions[state.editingProgressionId]?.studentId || null;
  }
  // Fallback: find existing student by name+dob to avoid duplicates
  if (!stuId) {
    const existingStudent = Object.values(state.students).find(
      s => s.name === name && s.dob === dob
    );
    stuId = existingStudent?.id || ('STU-' + Date.now().toString(36).toUpperCase());
  }

  state.students[stuId] = {
    id: stuId, name, dob,
    schoolId: state.schoolId,
    updatedAt: new Date().toISOString(),
    updatedBy: state.user ? state.user.name : 'unknown'
  };

  const progId = state.editingProgressionId || ('PROG-' + Date.now().toString(36).toUpperCase());
  state.progressions[progId] = {
    id: progId,
    studentId: stuId,
    schoolId: state.schoolId,
    programs: state.progResultsCache.programs,
    createdAt: state.progressions[progId]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: state.user ? state.user.name : 'unknown'
  };

  await saveStudents();
  await saveProgressions();
  closeModal('modalProgression');
  alert('Progression plan saved.');
  if (state.view === 'students') renderStudents();
}

function formatProgressionHtml() {
  const cache = state.progResultsCache;
  if (!cache) return '';
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
  const schoolName = school ? school.name : state.schoolId;
  const dob = ppParseDate(cache.dob);
  const today = new Date();
  const age = dob ? ppCalcAge(dob, today) : null;

  let progTables = '';
  for (const progId of Object.keys(cache.programs)) {
    const prog = progressionProgramById(progId);
    if (!prog) continue;
    const data = cache.programs[progId];
    progTables += `<section style="margin-bottom: 24px;">
      <h2 style="border-left: 4px solid ${prog.colour}; padding-left: 10px;">${escapeHtml(prog.name)} <span style="font-weight: normal; color: #666; font-size: 13px;">— currently ${escapeHtml(data.currentRankLabel)}</span></h2>
      ${data.projection.length === 0
        ? '<p style="font-style: italic; color: #666;">Already at top rank.</p>'
        : `<table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead><tr style="background: #f5f5f3;">
              <th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Rank</th>
              <th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Earliest date</th>
              <th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Age</th>
            </tr></thead>
            <tbody>${data.projection.map(row =>
              `<tr><td style="padding: 7px 8px; border-bottom: 1px solid #eee;">${escapeHtml(row.label)}</td><td style="padding: 7px 8px; border-bottom: 1px solid #eee;">${ppFmt(row.date)}</td><td style="padding: 7px 8px; border-bottom: 1px solid #eee;">${row.ageAtRank ? row.ageAtRank.years + 'y ' + row.ageAtRank.months + 'm' : '—'}</td></tr>`
            ).join('')}</tbody>
          </table>`}
    </section>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Progression plan — ${escapeHtml(cache.name)}</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 30px; color: #1a1a1a; line-height: 1.5; }
  .header { border-bottom: 4px solid #d62828; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-family: 'Arial Black', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 4px; font-size: 26px; }
  .header .sub { font-size: 12px; color: #555; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  .meta-grid { display: grid; grid-template-columns: 120px 1fr; gap: 4px 16px; font-size: 13px; margin-bottom: 24px; padding: 14px; background: #f5f5f3; border-left: 4px solid #d62828; }
  .meta-grid .lbl { color: #555; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; font-weight: 700; padding-top: 2px; }
  h2 { font-family: 'Arial Black', sans-serif; text-transform: uppercase; letter-spacing: 0.04em; font-size: 14px; color: #1a1a1a; margin: 0 0 10px; }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 10px; color: #888; text-align: center; }
  @media print { body { padding: 14mm; } @page { size: A4; margin: 0; } }
</style>
</head>
<body>
<div class="header">
  <h1>KRMAS Progression Plan</h1>
  <div class="sub">${escapeHtml(schoolName)} · Making Good People Better</div>
</div>
<div class="meta-grid">
  <div class="lbl">Student</div><div>${escapeHtml(cache.name)}</div>
  <div class="lbl">Date of birth</div><div>${ppFmt(dob)}</div>
  <div class="lbl">Current age</div><div>${age ? age.years + ' years, ' + age.months + ' months' : '—'}</div>
  <div class="lbl">Plan date</div><div>${today.toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
</div>
${progTables}
<footer>Generated by KRMAS Roster app · ${today.toLocaleString()}<br>Projected dates show the <em>earliest</em> eligibility based on minimum time-in-grade and age requirements. Actual gradings depend on attendance, skill development, and instructor approval.</footer>
</body></html>`;
}

function downloadProgression() {
  if (!state.progResultsCache) { alert('Generate the plan first.'); return; }
  const html = formatProgressionHtml();
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const nameSafe = (state.progResultsCache.name || 'student').replace(/[^a-zA-Z0-9]/g, '_');
  const a = document.createElement('a');
  a.href = url;
  a.download = `KRMAS_progression_${nameSafe}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printProgression() {
  if (!state.progResultsCache) { alert('Generate the plan first.'); return; }
  const html = formatProgressionHtml();
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { alert('Allow pop-ups for this site to print.'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

// ---------- Instructor pathway ----------

function openPathway(studentId) {
  if (!state.user) { openLogin(); return; }
  const stu = state.students[studentId];
  if (!stu) { alert('Student not found.'); return; }
  state.editingPathwayId = studentId;
  state.selectedPathwayYear = String(new Date().getFullYear());

  // Initialise pathway in state if new — so update handlers always have a real object
  if (!state.pathways[studentId]) {
    state.pathways[studentId] = {
      studentId,
      syllabus: '',
      enrolledDate: '',
      recommendedBy: '',
      enrolledInLeadership: false,
      summaryNotes: '',
      goals: {},
      meetings: {},
      milestones: {},
      weaknesses: ''
    };
  }
  const pw = state.pathways[studentId];

  document.getElementById('pathwayTitle').textContent = 'Instructor pathway';
  document.getElementById('pathwaySubtitle').textContent = stu.name;
  document.getElementById('pwStudentName').value = stu.name;
  document.getElementById('pwSyllabus').value = pw.syllabus || '';
  document.getElementById('pwEnrolledDate').value = pw.enrolledDate || '';
  document.getElementById('pwRecommendedBy').value = pw.recommendedBy || '';
  document.getElementById('pwEnrolledFlag').checked = !!pw.enrolledInLeadership;
  document.getElementById('pwSummaryNotes').value = pw.summaryNotes || '';
  document.getElementById('pwWeaknesses').value = pw.weaknesses || '';

  updatePathwayToggle();
  renderPathwayGoals(pw);
  renderPathwayYearTabs(pw);
  renderPathwayMeetings(pw);
  renderPathwayMilestones(pw);
  updatePathwayPoints(pw);

  // Show delete only for existing pathways
  const delBtn = document.getElementById('deletePathwayBtn');
  if (delBtn) delBtn.style.display = (state.pathways[studentId] && can.managePathway()) ? 'block' : 'none';

  openModal('modalPathway');
}

function updatePathwayToggle() {
  const checked = document.getElementById('pwEnrolledFlag').checked;
  document.getElementById('pwEnrolledToggle').classList.toggle('active', checked);
}

function renderPathwayGoals(pw) {
  const c = document.getElementById('pwGoalsList');
  c.innerHTML = INSTRUCTOR_GOALS.map(g => {
    const data = pw.goals?.[g.id] || {};
    const done = !!data.date;
    return `<div class="pw-row ${done ? 'done' : ''}">
      <div class="pw-label">${escapeHtml(g.label)}</div>
      <input type="date" value="${data.date || ''}" onchange="pathwayUpdateGoal('${g.id}', 'date', this.value)">
      <div class="pw-points-tag">${g.points || '—'}</div>
      <div></div>
      <div class="pw-reviewer">
        <label>Set with</label>
        <input type="text" value="${escapeHtml(data.setWith || '')}" placeholder="Stakeholder name" onchange="pathwayUpdateGoal('${g.id}', 'setWith', this.value)">
      </div>
    </div>`;
  }).join('');
}

function pathwayUpdateGoal(goalId, field, value) {
  const pw = state.pathways[state.editingPathwayId] || (state.pathways[state.editingPathwayId] = {});
  if (!pw.goals) pw.goals = {};
  if (!pw.goals[goalId]) pw.goals[goalId] = {};
  pw.goals[goalId][field] = value;
  renderPathwayGoals(pw);
  updatePathwayPoints(pw);
}

function renderPathwayYearTabs(pw) {
  const currentYear = new Date().getFullYear();
  const yearsInData = Object.keys(pw.meetings || {});
  const years = [...new Set([...yearsInData, String(currentYear)])].sort();
  if (!state.selectedPathwayYear) state.selectedPathwayYear = String(currentYear);

  let html = years.map(y =>
    `<button class="pw-year-tab ${y === state.selectedPathwayYear ? 'active' : ''}" onclick="selectPathwayYear('${y}')">${y}</button>`
  ).join('');
  html += `<button class="pw-year-tab" onclick="addPathwayYear()">+ Year</button>`;
  document.getElementById('pwYearTabs').innerHTML = html;
}

function selectPathwayYear(year) {
  state.selectedPathwayYear = year;
  const pw = state.pathways[state.editingPathwayId] || {};
  renderPathwayYearTabs(pw);
  renderPathwayMeetings(pw);
}

function addPathwayYear() {
  const y = prompt('Add year (e.g. 2027):', String(new Date().getFullYear() + 1));
  if (!y || !/^\d{4}$/.test(y)) return;
  const pw = state.pathways[state.editingPathwayId] || (state.pathways[state.editingPathwayId] = {});
  if (!pw.meetings) pw.meetings = {};
  if (!pw.meetings[y]) pw.meetings[y] = {};
  state.selectedPathwayYear = y;
  renderPathwayYearTabs(pw);
  renderPathwayMeetings(pw);
}

function renderPathwayMeetings(pw) {
  const year = state.selectedPathwayYear;
  const yearData = pw.meetings?.[year] || {};
  document.getElementById('pwMeetingsList').innerHTML = INSTRUCTOR_MONTHS.map(month => {
    const data = yearData[month] || {};
    const done = !!data.date;
    return `<div class="pw-meeting-row ${done ? 'done' : ''}">
      <div class="month">${month}</div>
      <input type="date" value="${data.date || ''}" onchange="pathwayUpdateMeeting('${year}', '${month}', this.value)">
      <div class="pw-points-tag" style="background: ${done ? 'var(--ok)' : 'var(--grey-200)'}; color: ${done ? 'var(--white)' : 'var(--grey-500)'};">${INSTRUCTOR_MEETING_POINTS}</div>
    </div>`;
  }).join('');
}

function pathwayUpdateMeeting(year, month, date) {
  const pw = state.pathways[state.editingPathwayId] || (state.pathways[state.editingPathwayId] = {});
  if (!pw.meetings) pw.meetings = {};
  if (!pw.meetings[year]) pw.meetings[year] = {};
  if (!pw.meetings[year][month]) pw.meetings[year][month] = {};
  pw.meetings[year][month].date = date;
  renderPathwayMeetings(pw);
  updatePathwayPoints(pw);
}

function renderPathwayMilestones(pw) {
  document.getElementById('pwMilestonesList').innerHTML = INSTRUCTOR_MILESTONES.map(m => {
    const data = pw.milestones?.[m.id] || {};
    const done = !!data.date;
    return `<div class="pw-row ${done ? 'done' : ''}">
      <div class="pw-label">${escapeHtml(m.label)}</div>
      <input type="date" value="${data.date || ''}" onchange="pathwayUpdateMilestone('${m.id}', 'date', this.value)">
      <div class="pw-points-tag">${m.points}</div>
      <div></div>
      <div class="pw-reviewer">
        <label>Reviewed by</label>
        <input type="text" value="${escapeHtml(data.reviewedBy || '')}" placeholder="Reviewer name" onchange="pathwayUpdateMilestone('${m.id}', 'reviewedBy', this.value)">
      </div>
    </div>`;
  }).join('');
}

function pathwayUpdateMilestone(milestoneId, field, value) {
  const pw = state.pathways[state.editingPathwayId] || (state.pathways[state.editingPathwayId] = {});
  if (!pw.milestones) pw.milestones = {};
  if (!pw.milestones[milestoneId]) pw.milestones[milestoneId] = {};
  pw.milestones[milestoneId][field] = value;
  renderPathwayMilestones(pw);
  updatePathwayPoints(pw);
}

function updatePathwayPoints(pw) {
  document.getElementById('pathwayPoints').textContent = instructorPathwayPoints(pw);
}

async function savePathway() {
  const studentId = state.editingPathwayId;
  if (!studentId) return;
  const existing = state.pathways[studentId] || {};
  state.pathways[studentId] = {
    ...existing,
    studentId,
    schoolId: state.schoolId,
    syllabus:             document.getElementById('pwSyllabus').value,
    enrolledDate:         document.getElementById('pwEnrolledDate').value,
    recommendedBy:        document.getElementById('pwRecommendedBy').value,
    enrolledInLeadership: document.getElementById('pwEnrolledFlag').checked,
    summaryNotes:         document.getElementById('pwSummaryNotes').value,
    weaknesses:           document.getElementById('pwWeaknesses').value,
    // goals / meetings / milestones already kept in sync via inline handlers
    updatedAt: new Date().toISOString(),
    updatedBy: state.user ? state.user.name : 'unknown'
  };
  await savePathways();
  closeModal('modalPathway');
  if (state.view === 'students') renderStudents();
  alert('Pathway saved.');
}

function formatPathwayHtml(stu, pw) {
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
  const schoolName = school ? school.name : state.schoolId;
  const totalPoints = instructorPathwayPoints(pw);
  const esc = s => s ? escapeHtml(s).replace(/\n/g, '<br>') : '—';

  const goalsRows = INSTRUCTOR_GOALS.map(g => {
    const d = pw.goals?.[g.id] || {};
    return `<tr><td>${escapeHtml(g.label)}</td><td>${esc(d.setWith)}</td><td>${esc(d.date)}</td><td style="text-align: right;">${g.points || '—'}</td></tr>`;
  }).join('');

  let meetingsRows = '';
  const years = Object.keys(pw.meetings || {}).sort();
  for (const y of years) {
    for (const m of INSTRUCTOR_MONTHS) {
      const d = pw.meetings?.[y]?.[m] || {};
      if (d.date) {
        meetingsRows += `<tr><td>${escapeHtml(y)}</td><td>${escapeHtml(m)}</td><td>${esc(d.date)}</td><td style="text-align: right;">${INSTRUCTOR_MEETING_POINTS}</td></tr>`;
      }
    }
  }
  if (!meetingsRows) meetingsRows = '<tr><td colspan="4" style="color: #888; font-style: italic;">No meetings recorded yet.</td></tr>';

  const milestonesRows = INSTRUCTOR_MILESTONES.map(m => {
    const d = pw.milestones?.[m.id] || {};
    return `<tr><td>${escapeHtml(m.label)}</td><td>${esc(d.date)}</td><td>${esc(d.reviewedBy)}</td><td style="text-align: right;">${m.points}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Instructor pathway — ${escapeHtml(stu.name)}</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 30px; color: #1a1a1a; line-height: 1.5; }
  .header { border-bottom: 4px solid #d62828; padding-bottom: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; gap: 20px; }
  .header h1 { font-family: 'Arial Black', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 4px; font-size: 24px; }
  .header .sub { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
  .points-pill { background: #1a1a1a; color: #c9a14a; padding: 8px 16px; border-radius: 999px; font-family: 'Arial Black', sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
  .points-pill .num { color: white; font-size: 18px; margin-left: 8px; }
  .meta-grid { display: grid; grid-template-columns: 130px 1fr; gap: 4px 16px; font-size: 13px; margin-bottom: 24px; padding: 14px; background: #f5f5f3; border-left: 4px solid #d62828; }
  .meta-grid .lbl { color: #555; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; font-weight: 700; padding-top: 2px; }
  .candidate-badge { display: inline-block; background: #c9a14a; color: #1a1a1a; padding: 3px 10px; border-radius: 999px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-left: 8px; }
  h2 { font-family: 'Arial Black', sans-serif; text-transform: uppercase; letter-spacing: 0.04em; font-size: 13px; color: #d62828; margin: 22px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #f5f5f3; text-align: left; padding: 7px 9px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; font-weight: 700; }
  td { padding: 7px 9px; border-bottom: 1px solid #eee; }
  .weaknesses { background: #fafafa; border: 1px solid #ddd; padding: 12px; border-radius: 4px; white-space: pre-wrap; font-size: 13px; min-height: 60px; }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 10px; color: #888; text-align: center; }
  @media print { body { padding: 14mm; } @page { size: A4; margin: 0; } }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>Instructor Pathway</h1>
    <div class="sub">${escapeHtml(schoolName)} · KRMAS Leadership Program</div>
  </div>
  <div class="points-pill">POINTS<span class="num">${totalPoints}</span></div>
</div>

<div class="meta-grid">
  <div class="lbl">Student name</div><div>${escapeHtml(stu.name)}${pw.enrolledInLeadership ? '<span class="candidate-badge">Enrolled</span>' : ''}</div>
  <div class="lbl">Syllabus</div><div>${esc(pw.syllabus)}</div>
  <div class="lbl">Enrolled date</div><div>${esc(pw.enrolledDate)}</div>
  <div class="lbl">Recommended by</div><div>${esc(pw.recommendedBy)}</div>
  <div class="lbl">Notes</div><div>${esc(pw.summaryNotes)}</div>
</div>

<h2>Instructing goals</h2>
<table>
  <thead><tr><th>Role</th><th>Set with</th><th>Date</th><th style="text-align: right;">Points</th></tr></thead>
  <tbody>${goalsRows}</tbody>
</table>

<h2>Monthly leadership meetings</h2>
<table>
  <thead><tr><th>Year</th><th>Month</th><th>Date</th><th style="text-align: right;">Points</th></tr></thead>
  <tbody>${meetingsRows}</tbody>
</table>

<h2>Milestones</h2>
<table>
  <thead><tr><th>Milestone</th><th>Date</th><th>Reviewed by</th><th style="text-align: right;">Points</th></tr></thead>
  <tbody>${milestonesRows}</tbody>
</table>

<h2>Weaknesses & areas to develop</h2>
<div class="weaknesses">${esc(pw.weaknesses)}</div>

<footer>Generated by KRMAS Roster app · ${new Date().toLocaleString()}</footer>

</body></html>`;
}

function downloadPathway() {
  const studentId = state.editingPathwayId;
  const stu = state.students[studentId];
  const pw = state.pathways[studentId];
  if (!stu || !pw) { alert('Save first.'); return; }
  const html = formatPathwayHtml(stu, pw);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const nameSafe = stu.name.replace(/[^a-zA-Z0-9]/g, '_');
  const a = document.createElement('a');
  a.href = url;
  a.download = `KRMAS_pathway_${nameSafe}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printPathway() {
  const studentId = state.editingPathwayId;
  const stu = state.students[studentId];
  const pw = state.pathways[studentId];
  if (!stu || !pw) { alert('Save first.'); return; }
  const html = formatPathwayHtml(stu, pw);
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { alert('Allow pop-ups for this site to print.'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

// ---------- Search ----------
function toggleSearch() {
  const bar = document.getElementById('searchBar');
  const input = document.getElementById('searchInput');
  const visible = bar.style.display !== 'none';
  bar.style.display = visible ? 'none' : 'block';
  if (!visible) {
    input.value = '';
    input.focus();
    runSearch('');
  } else {
    // Clear search results, restore normal roster
    if (state.view === 'roster') renderDay();
  }
}

function runSearch(query) {
  query = query.trim().toLowerCase();
  if (!query) {
    if (state.view === 'roster') renderDay();
    return;
  }

  // Search across the whole current week
  const results = [];
  for (const dow of getActiveDays()) {
    const date = addDays(state.currentDate, dow === 0 ? 6 : dow - 1);
    const dayClasses = rosterForDay(date);
    for (const c of dayClasses) {
      const lead = getInstructor(c.lead);
      const assist = getInstructor(c.assist);
      const haystack = [
        c.meta.name,
        c.meta.short,
        lead?.name, lead?.short,
        assist?.name,
        c.topicContent?.title,
        c.topicContent?.basics,
        c.type,
        DAY_NAMES[dow]
      ].filter(Boolean).join(' ').toLowerCase();
      if (haystack.includes(query)) results.push({ c, date, dow });
    }
  }

  // Render search results directly in mainContent
  const main = document.getElementById('mainContent');
  document.getElementById('dayHeadEl').style.display = 'flex';
  document.getElementById('dayName').textContent = 'Search';
  document.getElementById('dayDate').textContent = `"${query}" · ${results.length} result${results.length === 1 ? '' : 's'}`;

  if (results.length === 0) {
    main.innerHTML = `<div class="empty"><h2>No results</h2><p>Try a class type, instructor name, or topic.</p></div>`;
    return;
  }

  let html = '<div class="cards">';
  for (const { c, date, dow } of results) {
    const lead = getInstructor(c.lead);
    html += `<div class="card" style="cursor: pointer;" onclick="selectDay(${dow}); document.getElementById('searchBar').style.display='none';">
      <div class="edge" style="background: var(${c.meta.colour});"></div>
      <div class="card-inner">
        <div class="card-top">
          <div class="card-time">${c.start}<span class="end">${c.end}</span></div>
          <div class="card-body">
            <div style="font-size: 11px; color: var(--grey-500); font-family: 'Oswald', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; margin-bottom: 2px;">${DAY_SHORT[dow]} ${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}</div>
            <div class="card-title">
              <span>${c.meta.name}</span>
              ${c.topicNum ? `<span class="topic-num">#${c.topicNum}</span>` : ''}
            </div>
            ${c.topicContent ? `<div class="card-topic">${escapeHtml(c.topicContent.title)}</div>` : ''}
            <div class="card-staff" style="margin-top: 6px;">
              <div class="staff-row">
                <span class="staff-role">Lead</span>
                <span class="staff-name ${!lead ? 'missing' : ''}">${lead ? lead.name : 'Unassigned'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }
  html += '</div>';
  main.innerHTML = html;
}
function exportWeekRoster() {
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
  const schoolName = school ? school.name : state.schoolId;
  const weekNum = getWeekNumber(state.currentDate);
  const mondayDate = state.currentDate;

  const EXPORT_DAYS = getActiveDays();
  const DAY_LABELS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  let daySections = '';
  for (const dow of EXPORT_DAYS) {
    const idx = dow === 0 ? 6 : dow - 1; // Mon=0 offset, Sun=6 offset from Monday
    const date = addDays(mondayDate, idx);
    const classes = rosterForDay(date);
    if (classes.length === 0) continue;

    let rows = '';
    for (const c of classes) {
      const lead = getInstructor(c.lead);
      const assist = getInstructor(c.assist);
      const junior = getInstructor(c.junior);
      const backup = getInstructor(c.backup);
      const coverFlag = (!c.lead || c.status === 'needs-cover')
        ? '<span style="background: #d62828; color: white; padding: 2px 6px; border-radius: 2px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Cover needed</span>'
        : '';
      const staffStr = [
        lead    ? `<strong>${escapeHtml(lead.name)}</strong>` : '<em style="color:#d62828;">Unassigned</em>',
        assist  ? escapeHtml(assist.name) : null,
        junior  ? escapeHtml(junior.name) + ' (Jr)' : null,
        backup  ? '<small>(Backup: ' + escapeHtml(backup.name) + ')</small>' : null
      ].filter(Boolean).join(' · ');

      rows += `<tr>
        <td style="font-family: 'Courier New', monospace; white-space: nowrap; color: #555; width: 90px;">${c.start}–${c.end}</td>
        <td style="font-weight: 700; padding-right: 8px;">${escapeHtml(c.meta.name)}${c.topicNum ? ` <small style="font-weight: normal; color: #888;">#${c.topicNum} ${c.topicContent ? '· ' + escapeHtml(c.topicContent.title) : ''}</small>` : ''}</td>
        <td>${staffStr} ${coverFlag}</td>
      </tr>`;
    }

    daySections += `<div class="day-block">
      <h2>${DAY_LABELS[dow]} <span class="day-date">${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}</span></h2>
      <table><tbody>${rows}</tbody></table>
    </div>`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>KRMAS ${escapeHtml(schoolName)} — Week ${weekNum} Roster</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 28px; color: #1a1a1a; font-size: 13px; line-height: 1.5; }
  .header { border-bottom: 4px solid #d62828; padding-bottom: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
  .header h1 { font-family: 'Arial Black', sans-serif; text-transform: uppercase; letter-spacing: 0.06em; margin: 0; font-size: 22px; }
  .header .meta { font-size: 11px; color: #555; text-align: right; }
  h2 { font-family: 'Arial Black', sans-serif; text-transform: uppercase; letter-spacing: 0.04em; font-size: 13px; color: #1a1a1a; margin: 18px 0 6px; border-left: 4px solid #d62828; padding-left: 10px; display: flex; align-items: baseline; gap: 10px; }
  .day-date { font-family: 'Courier New', monospace; color: #888; font-size: 11px; font-weight: normal; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 6px 8px; border-bottom: 1px solid #f0f0ee; vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  .day-block { margin-bottom: 12px; background: #fafaf8; border: 1px solid #e8e6e2; border-radius: 4px; padding: 12px; }
  footer { margin-top: 28px; border-top: 1px solid #e0e0dc; padding-top: 10px; font-size: 10px; color: #aaa; text-align: center; }
  @media print { body { padding: 10mm; } @page { size: A4; margin: 0; } .day-block { break-inside: avoid; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>KRMAS ${escapeHtml(schoolName)}</h1>
    <div style="font-size: 12px; color: #555; margin-top: 2px;">Week ${weekNum} · ${String(mondayDate.getDate()).padStart(2,'0')}/${String(mondayDate.getMonth()+1).padStart(2,'0')}/${mondayDate.getFullYear()}</div>
  </div>
  <div class="meta">Making Good People Better<br>Generated ${new Date().toLocaleString('en-AU')}</div>
</div>
${daySections}
<footer>KRMAS Roster app — ${escapeHtml(schoolName)}</footer>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `KRMAS_${schoolName.replace(/\s+/g, '_')}_Week${weekNum}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Grading Manager ----------

/* ---- State init ---- */
// state.grading   = { sessionId: { id, syllabus, date, location, candidates: [] } }
// state.stocktake = { 'Belt label': { 1: n, 2: n, ... } }
// state.gradingView           = 'sessions' | 'stocktake' | 'order'
// state.gradingSessionId      = active session id
// state.editingGradingSessionId = session being configured in modal
// state.editingCandidateIdx   = candidate idx being edited

/* ---- Main render ---- */
function renderGrading() {
  hideDayHead();
  const main = document.getElementById('mainContent');
  if (!can.viewGrading()) {
    main.innerHTML = `<div class="empty"><h2>Restricted</h2><p>Sign in as an instructor or admin to view grading.</p><button class="btn btn-primary" onclick="openLogin()">Sign in</button></div>`;
    return;
  }
  const tabs = [
    { id: 'sessions',  label: 'Sessions' },
    { id: 'stocktake', label: 'Stocktake' },
    { id: 'order',     label: 'Belt order' },
  ];
  let html = `<h1 class="section-head">Grading <span class="accent">manager</span></h1>
    <div class="grading-tabs">
      ${tabs.map(t => `<button class="grading-tab ${state.gradingView === t.id ? 'active' : ''}" onclick="setGradingView('${t.id}')">${t.label}</button>`).join('')}
    </div>`;

  if      (state.gradingView === 'sessions')  html += renderGradingSessions();
  else if (state.gradingView === 'stocktake') html += renderGradingStocktake();
  else if (state.gradingView === 'order')     html += renderGradingBeltOrder();
  main.innerHTML = html;
  if (state.gradingView === 'sessions') renderGradingSessionsResults();
}

function setGradingView(v) { state.gradingView = v; renderGrading(); }

/* ================================================================
   SESSIONS VIEW
   ================================================================ */
function renderGradingSessions() {
  const allSessions = Object.values(state.grading);
  let html = `<button class="btn btn-primary" style="width:100%;margin-bottom:10px;" onclick="${can.manageGrading() ? 'openNewGradingSession()' : 'requireRole(\'admin\')'}">${can.manageGrading() ? '+ New grading session' : '+ New grading session (admin only)'}</button>`;

  if (allSessions.length === 0) {
    html += `<div class="empty"><h2>No grading sessions</h2><p>Create a session, add students, record results, then print the official examination sheet and certificates.</p></div>`;
    return html;
  }

  // Search + filters
  const syllabusOpts = [...new Set(allSessions.map(s => s.syllabus))]
    .map(k => `<option value="${escapeHtml(k)}"${state.gradingSearchSyl === k ? ' selected' : ''}>${escapeHtml(GRADING_SYLLABI[k]?.label || k)}</option>`).join('');
  html += `<div style="display:flex;gap:8px;margin-bottom:6px;">
    <input type="search" id="gradingSearch" placeholder="Search by syllabus, date, location…" value="${escapeHtml(state.gradingSearch || '')}"
      oninput="state.gradingSearch=this.value; renderGradingSessionsResults();"
      style="flex:1;padding:9px 12px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:13px;box-sizing:border-box;">
  </div>
  <div style="display:flex;gap:8px;margin-bottom:12px;">
    <select onchange="state.gradingSearchSyl=this.value; renderGradingSessionsResults();" style="flex:1;padding:8px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:12px;">
      <option value=""${!state.gradingSearchSyl ? ' selected' : ''}>All syllabuses</option>
      ${syllabusOpts}
    </select>
    <select onchange="state.gradingSearchStatus=this.value; renderGradingSessionsResults();" style="flex:1;padding:8px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:12px;">
      <option value=""${!state.gradingSearchStatus ? ' selected' : ''}>Any status</option>
      <option value="complete"${state.gradingSearchStatus === 'complete' ? ' selected' : ''}>Fully graded</option>
      <option value="pending"${state.gradingSearchStatus === 'pending' ? ' selected' : ''}>Has ungraded</option>
      <option value="empty"${state.gradingSearchStatus === 'empty' ? ' selected' : ''}>No students yet</option>
    </select>
  </div>
  <div id="gradingSessionsResults"></div>`;
  return html;
}

function renderGradingSessionsResults() {
  const box = document.getElementById('gradingSessionsResults');
  if (!box) return;
  const q = (state.gradingSearch || '').trim().toLowerCase();
  const sylFilter = state.gradingSearchSyl || '';
  const statusFilter = state.gradingSearchStatus || '';

  let sessions = Object.values(state.grading).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (sylFilter) sessions = sessions.filter(s => s.syllabus === sylFilter);
  if (q) sessions = sessions.filter(s => {
    const label = GRADING_SYLLABI[s.syllabus]?.label || s.syllabus;
    return [label, s.date, s.location].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
  if (statusFilter) sessions = sessions.filter(s => {
    const cands = s.candidates || [];
    const graded = cands.filter(candidateFinalised).length;
    if (statusFilter === 'empty') return cands.length === 0;
    if (statusFilter === 'complete') return cands.length > 0 && graded === cands.length;
    if (statusFilter === 'pending') return cands.length > 0 && graded < cands.length;
    return true;
  });

  if (sessions.length === 0) { box.innerHTML = `<div style="font-size:13px;color:var(--grey-500);padding:6px 4px;">No grading sessions match.</div>`; return; }

  let html = '';
  for (const s of sessions) {
    const syl = GRADING_SYLLABI[s.syllabus];
    const colour = syl?.colour || '#999';
    const cands = s.candidates || [];
    const graded = cands.filter(candidateFinalised).length;
    const isOpen = state.gradingSessionId === s.id;

    html += `<div style="margin-bottom:${isOpen ? 0 : 10}px;">
      <div style="background:var(--white);border:1px solid ${isOpen ? colour : 'var(--grey-200)'};border-left:4px solid ${colour};border-radius:${isOpen ? 'var(--r-md) var(--r-md) 0 0' : 'var(--r-md)'};padding:12px 14px;box-shadow:var(--shadow);">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div style="flex:1;min-width:0;cursor:pointer;" onclick="toggleGradingSession('${s.id}')">
            <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(syl?.label || s.syllabus)}</div>
            <div style="font-size:12px;color:var(--grey-500);margin-top:2px;">${escapeHtml(s.date || '—')} · ${escapeHtml(s.location || '—')}</div>
            <div style="font-size:11px;margin-top:3px;color:var(--grey-500);">${cands.length} candidate${cands.length === 1 ? '' : 's'} · ${graded} graded</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
            ${can.manageGrading() ? `<button class="btn btn-sm" onclick="openEditGradingSession('${s.id}')">⚙</button>` : ''}
            <button class="btn btn-sm" onclick="printGradingSheet('${s.id}')">Print</button>
            <button class="btn btn-sm ${isOpen ? 'btn-black' : ''}" onclick="toggleGradingSession('${s.id}')">${isOpen ? '↑' : 'Open'}</button>
          </div>
        </div>
      </div>
      ${isOpen ? renderOpenSession(s) : ''}
    </div>`;
  }
  box.innerHTML = html;
}

function toggleGradingSession(id) {
  state.gradingSessionId = (state.gradingSessionId === id) ? null : id;
  renderGrading();
  if (state.gradingSessionId) {
    setTimeout(() => {
      const el = document.getElementById('open-session-' + id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }
}

function renderOpenSession(s) {
  const syl = GRADING_SYLLABI[s.syllabus];
  const colour = syl?.colour || '#999';
  const cands = s.candidates || [];
  const gradeLabels = sylGrades(s.syllabus);

  // Group candidates by current grade (sorted by grade ladder position)
  const grouped = {};
  for (const c of cands) {
    const g = c.currentGrade || '—';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(c);
  }
  const sortedGroupKeys = Object.keys(grouped).sort((a, b) => {
    const ai = gradeLabels.indexOf(a), bi = gradeLabels.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  let html = `<div id="open-session-${s.id}" style="background:var(--off-white);border:1px solid ${colour};border-top:none;border-radius:0 0 var(--r-md) var(--r-md);padding:10px 12px;margin-bottom:10px;">`;
  if (can.manageGrading()) {
    const hasPlan = !!state.plans['grading-' + s.id];
    html += `<div style="display:flex;gap:6px;margin-bottom:8px;">
      <button class="btn btn-primary" style="flex:1;" onclick="openAddGradingCandidate('${s.id}')">+ Add student</button>
      <button class="btn" style="flex:1;" onclick="openGradingPlan('${s.id}')">${hasPlan ? '📝 Lesson plan ✓' : '📝 Lesson plan'}</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:10px;">
      <button class="btn" style="flex:1;" onclick="openGradingImport('${s.id}')">⬆ Import students</button>
      <button class="btn" style="flex:1;" onclick="openGradingCerts('${s.id}')">🏆 Certificates</button>
    </div>`;
  }

  if (cands.length === 0) {
    html += `<div style="font-size:13px;color:var(--grey-500);padding:4px 0 8px;">No students yet — add them above.</div>`;
  } else {
    for (const grade of sortedGroupKeys) {
      const group = grouped[grade];
      html += `<div style="font-size:10px;font-family:'Oswald',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--grey-500);padding:8px 0 3px;display:flex;align-items:center;gap:6px;">${beltSwatch(grade, 18)}${escapeHtml(grade)}</div>`;
      for (const c of group) {
        const ng = effectiveNewGrade(s.syllabus, c);
        const resultColour = c.result === 'pass' || c.result === 'distinction' ? 'var(--ok)'
          : c.result === 'pass-probationary' ? 'var(--warn)'
          : c.result === 'incomplete' ? 'var(--red)' : null;
        const resultLabel = GRADING_RESULTS.find(r => r.value === c.result)?.label || '';
        html += `<div class="grading-candidate-row${c.result ? ' graded' : ''}" onclick="openEditGradingCandidate('${s.id}', ${c.idx})">
          <div style="min-width:0;">
            <div class="mem-num">${escapeHtml(c.memberNum || '—')}</div>
            ${syl?.hasBeltSize && c.beltSize ? `<div style="font-size:10px;color:var(--grey-400);">Sz ${c.beltSize}</div>` : ''}
          </div>
          <div style="flex:1;min-width:0;">
            <div class="name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.name)}</div>
            <div class="grade-info">
              ${ng ? `${beltSwatch(ng, 16)}<span style="font-size:11px;">${escapeHtml(ng)}</span>` : ''}
              ${resultColour ? `<span style="font-size:10px;font-weight:700;color:${resultColour};">${escapeHtml(resultLabel.split('(')[0].trim())}</span>` : ''}
            </div>
          </div>
          <div style="font-size:16px;color:var(--grey-300);flex-shrink:0;">›</div>
        </div>`;
      }
    }
  }
  html += `</div>`;
  return html;
}

/* ================================================================
   SESSION MODAL — create / edit
   ================================================================ */
function openNewGradingSession() {
  state.editingGradingSessionId = null;
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
  document.getElementById('gsModalTitle').textContent = 'New grading session';
  document.getElementById('gsDeleteBtn').style.display = 'none';
  document.getElementById('gsSyllabus').value = 'ln';
  document.getElementById('gsDate').value = isoDate(new Date());
  document.getElementById('gsLocation').value = (school?.name || '') + ' Dojo';
  openModal('modalGradingSession');
}

function openEditGradingSession(id) {
  const s = state.grading[id];
  if (!s) return;
  state.editingGradingSessionId = id;
  document.getElementById('gsModalTitle').textContent = 'Edit session';
  document.getElementById('gsDeleteBtn').style.display = 'block';
  document.getElementById('gsSyllabus').value = s.syllabus || 'ln';
  document.getElementById('gsDate').value = s.date || '';
  document.getElementById('gsLocation').value = s.location || '';
  openModal('modalGradingSession');
}

async function saveGradingSession() {
  const syllabus = document.getElementById('gsSyllabus').value;
  const date     = document.getElementById('gsDate').value;
  const location = document.getElementById('gsLocation').value.trim();
  if (!date) { alert('Enter a date.'); return; }
  let id = state.editingGradingSessionId;
  if (id) {
    state.grading[id] = { ...state.grading[id], syllabus, date, location };
  } else {
    id = 'GS-' + Date.now().toString(36).toUpperCase();
    state.grading[id] = { id, syllabus, date, location, candidates: [] };
    state.gradingSessionId = id; // auto-open new session
  }
  await saveGrading();
  closeModal('modalGradingSession');
  renderGrading();
}

async function deleteGradingSession() {
  const id = state.editingGradingSessionId;
  if (!id) return;
  const s = state.grading[id];
  const label = s ? (GRADING_SYLLABI[s.syllabus]?.label || s.syllabus) + ' · ' + (s.date || '') : id;
  if (!confirm('Delete "' + label + '" and all its candidates? Cannot be undone.')) return;
  delete state.grading[id];
  if (state.gradingSessionId === id) state.gradingSessionId = null;
  await saveGrading();
  closeModal('modalGradingSession');
  renderGrading();
}

/* ================================================================
   CANDIDATE MODAL — add / edit
   ================================================================ */
function openAddGradingCandidate(sessionId) {
  if (!state.user) { openLogin(); return; }
  state.gradingSessionId = sessionId;
  state.editingCandidateIdx = null;
  const session = state.grading[sessionId];
  const syl = GRADING_SYLLABI[session?.syllabus];

  document.getElementById('gcModalTitle').textContent = 'Add student';
  document.getElementById('gcModalSub').textContent = syl?.label || '';
  document.getElementById('gcMemNum').value = '';
  document.getElementById('gcName').value = '';
  document.getElementById('gcBeltSize').value = '';
  document.getElementById('gcBeltSizeRow').style.display = syl?.hasBeltSize ? 'block' : 'none';
  document.getElementById('gcDoubleGrade').value = 'no';
  document.getElementById('gcResult').value = '';
  document.getElementById('gcDeleteBtn').style.display = 'none';

  // Build current grade select for this syllabus
  gcBuildGrades(session?.syllabus);
  gcRefreshNewGradePreview();
  openModal('modalGradingCandidate');
}

function openEditGradingCandidate(sessionId, idx) {
  if (!state.user) { openLogin(); return; }
  state.gradingSessionId = sessionId;
  state.editingCandidateIdx = idx;
  const session = state.grading[sessionId];
  const c = session?.candidates?.find(x => x.idx === idx);
  if (!c) return;
  const syl = GRADING_SYLLABI[session.syllabus];

  document.getElementById('gcModalTitle').textContent = 'Edit student';
  document.getElementById('gcModalSub').textContent = c.name;
  document.getElementById('gcMemNum').value = c.memberNum || '';
  document.getElementById('gcName').value = c.name || '';
  document.getElementById('gcBeltSize').value = c.beltSize || '';
  document.getElementById('gcBeltSizeRow').style.display = syl?.hasBeltSize ? 'block' : 'none';
  document.getElementById('gcDoubleGrade').value = c.doubleGrade || 'no';
  document.getElementById('gcResult').value = c.result || '';
  document.getElementById('gcDeleteBtn').style.display = 'block';

  gcBuildGrades(session.syllabus, c.currentGrade, c.gradeInTo);
  gcRefreshNewGradePreview();
  openModal('modalGradingCandidate');
}

function gcBuildGrades(syllabus, selectedGrade, selectedGradeInTo) {
  const grades = sylGrades(syllabus || 'ln');
  const sel = document.getElementById('gcCurrentGrade');
  sel.innerHTML = grades.map(g =>
    `<option value="${escapeHtml(g)}"${g === selectedGrade ? ' selected' : ''}>${escapeHtml(g)}</option>`
  ).join('');
  const git = document.getElementById('gcGradeInTo');
  if (git) {
    git.innerHTML = `<option value="">No — use the result &amp; promotion above</option>` +
      grades.map(g => `<option value="${escapeHtml(g)}"${g === selectedGradeInTo ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('');
  }
}

// The achieved grade for a candidate: an explicit instructor "grade in to" override
// wins (transfer-ins with skills carried from another style), otherwise the standard
// single/double promotion computed from the current grade and result.
function effectiveNewGrade(syllabus, c) {
  if (c && c.gradeInTo) return c.gradeInTo;
  return gradingNewGrade(syllabus, c.currentGrade, c.result, c.doubleGrade);
}

// A candidate has an outcome recorded if they have a result OR a grade-in override
// (an explicit instructor award), so progress counters treat grade-ins as done.
function candidateFinalised(c) {
  return !!(c && (c.result || c.gradeInTo));
}

function gcRefreshNewGradePreview() {
  const sessionId = state.gradingSessionId;
  const session = state.grading[sessionId];
  const syllabus = session?.syllabus || 'ln';
  const grade  = document.getElementById('gcCurrentGrade')?.value || '';
  const result = document.getElementById('gcResult')?.value || '';
  const dbl    = document.getElementById('gcDoubleGrade')?.value || 'no';
  const gradeInTo = document.getElementById('gcGradeInTo')?.value || '';
  const preview = document.getElementById('gcNewGradePreview');
  if (!preview) return;

  // Transfer-in override: the instructor dictates the level directly.
  if (gradeInTo) {
    preview.style.display = 'flex';
    preview.innerHTML = `<span style="font-size:11px;font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:var(--grey-500);">Graded in to</span>
      <span style="font-weight:700;font-size:14px;display:flex;align-items:center;margin-top:4px;">${beltSwatch(gradeInTo, 24)}&nbsp;${escapeHtml(gradeInTo)}</span>
      <span style="font-size:11px;color:var(--grey-500);margin-top:2px;">Instructor override — set level, single/double promotion ignored</span>`;
    return;
  }

  const syl = GRADING_SYLLABI[syllabus];
  const ng = gradingNewGrade(syllabus, grade, result, dbl);

  if (ng && result && result !== 'pass-probationary' && result !== 'incomplete') {
    preview.style.display = 'flex';
    preview.innerHTML = `<span style="font-size:11px;font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:var(--grey-500);">Promoted to</span>
      <span style="font-weight:700;font-size:14px;display:flex;align-items:center;margin-top:4px;">${beltSwatch(ng, 24)}&nbsp;${escapeHtml(ng)}</span>`;
  } else if (result === 'pass-probationary') {
    preview.style.display = 'flex';
    preview.innerHTML = `<span style="font-size:12px;color:var(--warn);font-weight:600;">Probationary — no belt change yet</span>`;
  } else if (result === 'incomplete') {
    preview.style.display = 'flex';
    preview.innerHTML = `<span style="font-size:12px;color:var(--red);font-weight:600;">Incomplete — re-test required</span>`;
  } else {
    preview.style.display = 'none';
  }
}

// Link a grading candidate to a shared student record (creating one if needed) so the
// Students tab and grading stay in sync in both directions. Match by member number
// first, then by name; enrich the student's member number when newly supplied.
function linkStudentForCandidate(name, memberNum, priorStudentId) {
  const students = state.students || (state.students = {});
  if (priorStudentId && students[priorStudentId]) {
    if (memberNum && !students[priorStudentId].memberNum) students[priorStudentId].memberNum = memberNum;
    return priorStudentId;
  }
  const norm = name.trim().toLowerCase();
  let match = null;
  if (memberNum) {
    const mn = memberNum.toLowerCase();
    match = Object.values(students).find(s => s.memberNum && s.memberNum.toLowerCase() === mn);
  }
  if (!match) match = Object.values(students).find(s => (s.name || '').trim().toLowerCase() === norm);
  if (match) {
    if (memberNum && !match.memberNum) match.memberNum = memberNum;
    return match.id;
  }
  const id = 'STU-' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000);
  students[id] = {
    id, name: name.trim(), dob: '', memberNum: memberNum || '',
    schoolId: state.schoolId, source: 'grading',
    updatedAt: new Date().toISOString(),
    updatedBy: state.user ? state.user.name : 'unknown',
  };
  return id;
}

async function saveGradingCandidate() {
  const name = document.getElementById('gcName').value.trim();
  if (!name) { alert('Enter the student name.'); return; }
  const sessionId = state.gradingSessionId;
  const session = state.grading[sessionId];
  if (!session) return;

  const memberNum = document.getElementById('gcMemNum').value.trim();
  const prior = (state.editingCandidateIdx !== null)
    ? session.candidates.find(c => c.idx === state.editingCandidateIdx) : null;
  const studentId = linkStudentForCandidate(name, memberNum, prior?.studentId);

  const candidate = {
    idx:          state.editingCandidateIdx !== null ? state.editingCandidateIdx : Date.now(),
    memberNum,
    name,
    beltSize:     document.getElementById('gcBeltSize').value,
    currentGrade: document.getElementById('gcCurrentGrade').value,
    doubleGrade:  document.getElementById('gcDoubleGrade').value,
    result:       document.getElementById('gcResult').value,
    gradeInTo:    document.getElementById('gcGradeInTo').value,
    studentId,
  };

  if (state.editingCandidateIdx !== null) {
    const i = session.candidates.findIndex(c => c.idx === state.editingCandidateIdx);
    if (i !== -1) session.candidates[i] = candidate;
    else session.candidates.push(candidate);
  } else {
    session.candidates.push(candidate);
  }

  await saveGrading();
  await saveStudents();
  closeModal('modalGradingCandidate');
  renderGrading();
}

async function deleteGradingCandidate() {
  const sessionId = state.gradingSessionId;
  const session = state.grading[sessionId];
  if (!session || state.editingCandidateIdx === null) return;
  const c = session.candidates.find(c => c.idx === state.editingCandidateIdx);
  if (!confirm('Remove ' + (c?.name || 'this student') + ' from the grading list?')) return;
  session.candidates = session.candidates.filter(c => c.idx !== state.editingCandidateIdx);
  await saveGrading();
  closeModal('modalGradingCandidate');
  renderGrading();
}

/* ================================================================
   BULK IMPORT STUDENTS INTO A GRADING SESSION
   Accepts the EFC/Aquila export CSV (column headers detected) or a
   simple paste of "member, name, grade[, result]" rows.
   ================================================================ */
let _gradingImportRows = [];

function openGradingImport(sessionId) {
  if (!can.manageGrading()) { alert('Grading manager access required.'); return; }
  const session = state.grading[sessionId];
  if (!session) return;
  state.gradingSessionId = sessionId;
  _gradingImportRows = [];
  const syl = GRADING_SYLLABI[session.syllabus];
  document.getElementById('giSub').textContent = `${syl?.label || session.syllabus} · ${session.date || ''}`;
  document.getElementById('giPaste').value = '';
  document.getElementById('giFile').value = '';
  document.getElementById('giStatus').textContent = '';
  document.getElementById('giPreview').innerHTML = '';
  document.getElementById('giCommitBtn').style.display = 'none';
  const ladder = sylGrades(session.syllabus);
  document.getElementById('giLadder').innerHTML = ladder.length
    ? `<strong>Grades for ${escapeHtml(syl?.label || session.syllabus)}:</strong> ${ladder.map(escapeHtml).join(' · ')}`
    : '';
  openModal('modalGradingImport');
}

function gradingImportTemplate() {
  const session = state.grading[state.gradingSessionId];
  const ladder = sylGrades(session?.syllabus || 'ln');
  const firstGrade = ladder[0] || 'White Belt';
  const headers = ['Enrolment Ref', 'Title', 'FirstName', 'LastName', 'Belt Size', 'Grade Description', 'Result'];
  const examples = [
    ['NEW8527', 'Mr', 'Nate', 'Hill', '4', firstGrade, 'pass'],
    ['NEW8531', '', 'Ava', 'Smith', '3', firstGrade, 'distinction'],
    ['', '', 'Liam', 'Brown', '', firstGrade, ''],
  ];
  const csv = [headers, ...examples].map(r => r.map(v => /[,"]/.test(v) ? `"${v}"` : v).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'KRMAS_Grading_Students_Template.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleGradingImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const status = document.getElementById('giStatus');
  status.textContent = 'Reading file…';
  if (ext === 'csv' || ext === 'txt') {
    const r = new FileReader();
    r.onload = e => { document.getElementById('giPaste').value = e.target.result; parseGradingImport(); };
    r.readAsText(file);
  } else if ((ext === 'xlsx' || ext === 'xls') && typeof XLSX !== 'undefined') {
    const r = new FileReader();
    r.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        document.getElementById('giPaste').value = XLSX.utils.sheet_to_csv(ws);
        parseGradingImport();
      } catch (err) { status.textContent = 'Could not read spreadsheet: ' + err.message; }
    };
    r.readAsArrayBuffer(file);
  } else {
    status.textContent = 'Unsupported file. Paste rows or use a CSV/XLSX.';
  }
}

// Split a CSV line respecting double-quoted fields
function splitCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// Fuzzy-match a typed grade against the syllabus ladder
function matchGrade(input, ladder) {
  if (!input) return null;
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = norm(input);
  if (!t) return null;
  let hit = ladder.find(g => norm(g) === t);
  if (hit) return hit;
  hit = ladder.find(g => norm(g).includes(t) || t.includes(norm(g)));
  return hit || null;
}

function parseGradingImport() {
  const session = state.grading[state.gradingSessionId];
  if (!session) return;
  const ladder = sylGrades(session.syllabus);
  const text = document.getElementById('giPaste').value || '';
  const status = document.getElementById('giStatus');
  const preview = document.getElementById('giPreview');
  const validResults = GRADING_RESULTS.map(r => r.value).filter(Boolean);

  let lines = text.split(/\r?\n/).filter(l => l.trim() && l.replace(/[,\s]/g, '') !== '');
  if (lines.length === 0) { _gradingImportRows = []; status.textContent = 'Nothing to import yet.'; preview.innerHTML = ''; document.getElementById('giCommitBtn').style.display = 'none'; return; }

  const headerCells = splitCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\uFEFF/g, '').trim());
  // A header row is detected only when at least two cells EXACTLY match known
  // column names. Substring matching is unsafe because data values such as
  // "White Belt" contain "belt" and would be mistaken for a header.
  const HEADER_NAMES = new Set([
    'efc reference','enrolment ref','enrolment reference','enrol ref','member','member#','membernum','member number','memberno',
    'title','firstname','first name','first','middlename','middle name','lastname','last name','last','surname','name',
    'belt size','beltsize','programme','program','programme description','program description',
    'grade','grade description','current grade','currentgrade','result','next grade','date of birth','age in years','gender',
  ]);
  const headerMatches = headerCells.filter(h => HEADER_NAMES.has(h)).length;
  const hasHeader = headerMatches >= 2;
  const col = name => headerCells.indexOf(name);
  // EFC/Aquila export columns (any subset)
  const idx = {
    enrol:  [col('enrolment ref'), col('efc reference'), col('member'), col('member#'), col('membernum')].find(i => i >= 0) ?? -1,
    title:  col('title'),
    first:  [col('firstname'), col('first name'), col('first')].find(i => i >= 0) ?? -1,
    last:   [col('lastname'), col('last name'), col('last'), col('surname')].find(i => i >= 0) ?? -1,
    name:   col('name'),
    belt:   [col('belt size'), col('beltsize')].find(i => i >= 0) ?? -1,
    grade:  [col('grade description'), col('grade'), col('current grade'), col('currentgrade')].find(i => i >= 0) ?? -1,
    result: col('result'),
  };

  const dataLines = hasHeader ? lines.slice(1) : lines;
  _gradingImportRows = dataLines.map(line => {
    const p = splitCsvLine(line);
    let member = '', name = '', gradeRaw = '', resultRaw = '', belt = '';
    if (hasHeader && (idx.first >= 0 || idx.name >= 0)) {
      member = idx.enrol >= 0 ? (p[idx.enrol] || '') : '';
      belt   = idx.belt >= 0 ? (p[idx.belt] || '') : '';
      if (idx.name >= 0 && idx.first < 0) {
        name = p[idx.name] || '';
      } else {
        const title = idx.title >= 0 ? (p[idx.title] || '') : '';
        const first = idx.first >= 0 ? (p[idx.first] || '') : '';
        const last  = idx.last >= 0 ? (p[idx.last] || '') : '';
        name = [title, first, last].filter(Boolean).join(' ').trim();
      }
      gradeRaw  = idx.grade >= 0 ? (p[idx.grade] || '') : '';
      resultRaw = idx.result >= 0 ? (p[idx.result] || '') : '';
    } else {
      // headerless simple paste: member, name, grade, result  (or name, grade, result)
      if (p.length >= 2 && /\d/.test(p[0]) && !/[a-z]{2,}\s+[a-z]{2,}/i.test(p[0])) {
        [member, name, gradeRaw, resultRaw] = [p[0] || '', p[1] || '', p[2] || '', p[3] || ''];
      } else {
        [name, gradeRaw, resultRaw, member] = [p[0] || '', p[1] || '', p[2] || '', p[3] || ''];
      }
    }
    const gradeMatch = matchGrade(gradeRaw, ladder);
    const grade = gradeMatch || ladder[0] || '';
    let result = (resultRaw || '').toLowerCase().replace(/\s+/g, '-');
    if (/distinction/.test(result)) result = 'distinction';
    else if (/probation|not-yet-complete/.test(result)) result = 'pass-probationary';
    else if (/incomplete|retest|re-test/.test(result)) result = 'incomplete';
    else if (/^pass$/.test(result)) result = 'pass';
    if (!validResults.includes(result)) result = '';
    return { member: member.trim(), name: name.trim(), beltSize: (belt || '').trim(), currentGrade: grade, gradeMatched: !gradeRaw || !!gradeMatch, result, valid: !!name.trim() };
  }).filter(r => r.name || r.member);

  const okCount = _gradingImportRows.filter(r => r.valid).length;
  status.textContent = `${okCount} student${okCount === 1 ? '' : 's'} ready` + (_gradingImportRows.length - okCount > 0 ? `, ${_gradingImportRows.length - okCount} row(s) skipped (no name)` : '') + (hasHeader ? ' · detected column headers' : '');
  status.style.color = okCount ? 'var(--ok)' : 'var(--red)';

  preview.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead><tr style="text-align:left;color:var(--grey-500);">
      <th style="padding:4px;">Member</th><th style="padding:4px;">Name</th><th style="padding:4px;">Current grade</th><th style="padding:4px;">Result</th>
    </tr></thead><tbody>
    ${_gradingImportRows.slice(0, 200).map(r => `<tr style="border-top:1px solid var(--grey-200);${!r.valid ? 'opacity:.5;' : ''}">
      <td style="padding:4px;">${escapeHtml(r.member || '—')}</td>
      <td style="padding:4px;font-weight:600;">${escapeHtml(r.name || '⚠ missing')}</td>
      <td style="padding:4px;">${escapeHtml(r.currentGrade || '—')}${!r.gradeMatched ? ' <span style="color:var(--warn);" title="Not recognised — defaulted to first grade">⚠</span>' : ''}</td>
      <td style="padding:4px;">${escapeHtml(GRADING_RESULTS.find(x => x.value === r.result)?.label.split(' (')[0] || '—')}</td>
    </tr>`).join('')}
  </tbody></table>`;
  document.getElementById('giCommitBtn').style.display = okCount ? 'block' : 'none';
}

async function commitGradingImport() {
  const session = state.grading[state.gradingSessionId];
  if (!session) return;
  const rows = _gradingImportRows.filter(r => r.valid);
  if (rows.length === 0) { alert('No valid students to import.'); return; }
  if (!Array.isArray(session.candidates)) session.candidates = [];
  let base = Date.now();
  for (const r of rows) {
    const studentId = linkStudentForCandidate(r.name, r.member, null);
    session.candidates.push({
      idx: base++,
      memberNum: r.member,
      name: r.name,
      beltSize: r.beltSize || '',
      currentGrade: r.currentGrade,
      doubleGrade: 'no',
      result: r.result || '',
      studentId,
    });
  }
  await saveGrading();
  await saveStudents();
  closeModal('modalGradingImport');
  renderGrading();
  alert(`Imported ${rows.length} student${rows.length === 1 ? '' : 's'} into the grading.`);
}

/* ================================================================
   GRADING CERTIFICATES — overlay print onto pre-printed stock
   ================================================================ */

// "13th June 2025" (with <sup> ordinal)
function ordinalDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  const day = d.getDate();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const suffix = (day % 10 === 1 && day !== 11) ? 'st' : (day % 10 === 2 && day !== 12) ? 'nd' : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
  return `${day}<sup>${suffix}</sup> ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Layouts measured (mm from page top) from the supplied 2021 templates.
const CERT_TEMPLATES = {
  mln: {
    label: 'Mini Little Ninjas',
    fontStack: "'Karate Medium','Karate','Trebuchet MS',Arial,sans-serif",
    bold: false,
    fields: [
      { key: 'name',   top: 118, size: 22 },
      { key: 'member', top: 152, size: 16 },
      { key: 'grade',  top: 180, size: 20 },
      { key: 'date',   top: 207, size: 20 },
    ],
  },
  allinone: {
    label: 'All other syllabuses',
    fontStack: "'Lucida Calligraphy','Apple Chancery','URW Chancery L','Segoe Script',cursive",
    bold: true,
    fields: [
      { key: 'name',    top: 58,  size: 23 },
      { key: 'grade',   top: 77,  size: 20 },
      { key: 'title',   top: 98,  size: 20 },
      { key: 'program', top: 119, size: 20 },
      { key: 'member',  top: 134, size: 16 },
      { key: 'date',    top: 157, size: 16 },
    ],
  },
};

function certTemplateFor(syllabus) { return syllabus === 'mln' ? 'mln' : 'allinone'; }

let _certState = null;

function openGradingCerts(sessionId) {
  if (!can.manageGrading()) { alert('Grading manager access required.'); return; }
  const session = state.grading[sessionId];
  if (!session) return;
  const syl = GRADING_SYLLABI[session.syllabus];
  const templateKey = certTemplateFor(session.syllabus);

  const rows = (session.candidates || []).map(c => {
    const newGrade = effectiveNewGrade(session.syllabus, c);
    const achieved = !!newGrade && (
      c.result === 'pass' || c.result === 'distinction' ||
      (!!c.gradeInTo && c.result !== 'incomplete' && c.result !== 'pass-probationary')
    );
    return {
      idx: c.idx, include: achieved, eligible: achieved,
      name: c.name || '', member: c.memberNum || '',
      grade: newGrade || c.currentGrade || '', result: c.result || '',
    };
  });

  let offsetX = 0, offsetY = 0;
  try { const s = JSON.parse(localStorage.getItem('krmas-cert-offset') || '{}'); offsetX = +s.x || 0; offsetY = +s.y || 0; } catch (e) {}

  _certState = { sessionId, templateKey, program: syl?.label || session.syllabus, date: session.date || isoDate(new Date()), rows, offsetX, offsetY };

  document.getElementById('certSub').textContent = `${syl?.label || session.syllabus} · ${session.date || ''} · ${CERT_TEMPLATES[templateKey].label} template`;
  document.getElementById('certProgram').value = _certState.program;
  document.getElementById('certTitleLine').value = '';
  document.getElementById('certExtraRows').style.display = templateKey === 'allinone' ? 'block' : 'none';
  document.getElementById('certOffsetX').value = offsetX;
  document.getElementById('certOffsetY').value = offsetY;
  renderCertList();
  openModal('modalGradingCerts');
}

function renderCertList() {
  const body = document.getElementById('certList');
  if (!body || !_certState) return;
  const rows = _certState.rows;
  if (rows.length === 0) { body.innerHTML = `<div style="font-size:13px;color:var(--grey-500);padding:8px 0;">No students in this session.</div>`; return; }
  const incl = rows.filter(r => r.include).length;
  body.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="font-size:11px;color:var(--grey-500);">${incl} of ${rows.length} selected · passes pre-ticked</span>
      <span><button class="btn btn-sm" onclick="certSelectAll(true)">All</button> <button class="btn btn-sm" onclick="certSelectAll(false)">None</button></span>
    </div>` +
    rows.map(r => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--grey-200);border-radius:var(--r-sm);margin-bottom:6px;cursor:pointer;${!r.eligible ? 'background:var(--off-white);' : ''}">
      <input type="checkbox" ${r.include ? 'checked' : ''} onchange="certToggle(${r.idx}, this.checked)" style="width:18px;height:18px;accent-color:var(--red);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;">${escapeHtml(r.name)}${r.member ? ` <span style="font-weight:400;color:var(--grey-500);font-size:12px;">${escapeHtml(r.member)}</span>` : ''}</div>
        <div style="font-size:12px;color:var(--grey-500);">${escapeHtml(r.grade || '—')}${!r.eligible ? ' · no promotion — tick to print anyway' : ''}</div>
      </div>
    </label>`).join('');
}

function certToggle(idx, on) { if (!_certState) return; const r = _certState.rows.find(x => x.idx === idx); if (r) r.include = on; renderCertList(); }
function certSelectAll(on) { if (!_certState) return; _certState.rows.forEach(r => r.include = on); renderCertList(); }

function printGradingCerts() {
  if (!_certState) return;
  const tpl = CERT_TEMPLATES[_certState.templateKey];
  const offsetX = parseFloat(document.getElementById('certOffsetX').value) || 0;
  const offsetY = parseFloat(document.getElementById('certOffsetY').value) || 0;
  const program = document.getElementById('certProgram').value.trim();
  const titleLine = document.getElementById('certTitleLine').value.trim();
  try { localStorage.setItem('krmas-cert-offset', JSON.stringify({ x: offsetX, y: offsetY })); } catch (e) {}

  const chosen = _certState.rows.filter(r => r.include);
  if (chosen.length === 0) { alert('Select at least one student.'); return; }

  const dateStr = ordinalDate(_certState.date);
  const pages = chosen.map(r => {
    const values = { name: r.name, member: r.member, grade: r.grade, level: r.grade, title: titleLine, program, date: dateStr };
    const fields = tpl.fields.map(f => {
      const v = values[f.key] || '';
      if (!v) return '';
      return `<div class="cf" style="top:${(f.top + offsetY).toFixed(1)}mm;font-size:${f.size}pt;">${v}</div>`;
    }).join('');
    return `<div class="page">${fields}</div>`;
  }).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Grading certificates</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    .page { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; break-after: auto; }
    .cf { position: absolute; left: ${offsetX.toFixed(1)}mm; right: ${(-offsetX).toFixed(1)}mm; text-align: center; font-family: ${tpl.fontStack}; font-weight: ${tpl.bold ? '700' : '400'}; color: #111; line-height: 1.1; white-space: nowrap; }
    .cf sup { font-size: .6em; }
    @media screen {
      body { background: #525659; padding: 76px 0 20px; }
      .page { background: #fff; margin: 0 auto 20px; box-shadow: 0 2px 12px rgba(0,0,0,.4); }
      .toolbar { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 10; background: #fff; padding: 10px 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.3); font-family: Arial, sans-serif; font-size: 13px; }
      .toolbar button { font-size: 13px; padding: 6px 14px; cursor: pointer; }
    }
    @media print { .toolbar { display: none; } }
  </style></head><body>
  <div class="toolbar">${chosen.length} certificate${chosen.length === 1 ? '' : 's'} &nbsp;<button onclick="window.print()">Print</button>&nbsp; Set printer margins to <b>None</b>, scale <b>100%</b></div>
  ${pages}
  </body></html>`;

  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) { alert('Allow pop-ups for this site to print certificates.'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 600);
}

/* ================================================================
   PRINT GRADING SHEET
   ================================================================ */
function printGradingSheet(sessionId) {
  const session = state.grading[sessionId];
  if (!session) return;
  const html = buildGradingSheetHtml(session);
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) { alert('Allow pop-ups for this site to print.'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 500);
}

function buildGradingSheetHtml(session) {
  const syl = GRADING_SYLLABI[session.syllabus];
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
  const schoolName = school?.name || state.schoolId;
  const candidates = session.candidates || [];

  // Sort by grade
  const gradeLabels = sylGrades(session.syllabus);
  const sorted = [...candidates].sort((a, b) => {
    const ai = gradeLabels.indexOf(a.currentGrade);
    const bi = gradeLabels.indexOf(b.currentGrade);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const hasBeltSize = syl?.hasBeltSize;
  const sizeCol = hasBeltSize ? '<th>Belt Size</th>' : '';

  const rows = sorted.map(c => {
    const ng = effectiveNewGrade(session.syllabus, c);
    const resultLabel = GRADING_RESULTS.find(r => r.value === c.result)?.label || '';
    const resultCell = ng
      ? escapeHtml(resultLabel) + '<br><b>→ ' + escapeHtml(ng) + '</b>'
      : c.result ? escapeHtml(resultLabel) : '';
    return `<tr>
      <td>${escapeHtml(c.memberNum || '')}</td>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      ${hasBeltSize ? `<td style="text-align:center;">${escapeHtml(c.beltSize || '')}</td>` : ''}
      <td>${escapeHtml(c.currentGrade || '')}</td>
      <td>${escapeHtml(syl?.label || '')}</td>
      <td style="text-align:center;"></td>
      <td style="text-align:center;"></td>
      <td style="text-align:center;"></td>
      <td style="text-align:center;"></td>
      <td style="font-size:10px;">${resultCell}</td>
    </tr>`;
  }).join('');

  const signatories = ['Authorised Official Examiner','Primary Assistant Examiner','First Assistant Examiner','Second Assistant Examiner'];

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>KRMAS Grading — ${escapeHtml(syl?.label || '')} · ${escapeHtml(session.date || '')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; padding: 12mm; }
  .header { border-bottom: 3px solid #d62828; padding-bottom: 8px; margin-bottom: 10px; }
  .header h1 { font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; }
  .meta { display: flex; gap: 24px; font-size: 10px; margin-top: 5px; flex-wrap: wrap; }
  .meta span { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th { background: #f5f5f3; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; font-weight: 700; padding: 5px 4px; border: 1px solid #bbb; text-align: left; }
  td { padding: 5px 4px; border: 1px solid #ccc; vertical-align: top; }
  tr:nth-child(even) td { background: #fafaf8; }
  .rounds-section { margin-bottom: 8px; font-size: 9px; }
  .round-boxes { display: flex; gap: 5px; margin-top: 3px; }
  .round-box { width: 32px; height: 24px; border: 1px solid #bbb; display: flex; align-items: center; justify-content: center; font-size: 8px; color: #aaa; }
  .sigs { margin-top: 8px; }
  .sig-row { display: flex; gap: 6px; align-items: flex-end; margin-bottom: 8px; font-size: 9px; }
  .sig-line { flex: 2; border-bottom: 1px solid #999; min-height: 14px; }
  .note { font-size: 8px; color: #555; margin-top: 10px; font-style: italic; }
  @media print {
    body { padding: 8mm; }
    @page { size: A4 landscape; margin: 0; }
    tr { break-inside: avoid; }
  }
</style></head>
<body>
<div class="header">
  <h1>Kumiai Ryu Martial Arts System · Under Black Badge/Belt Examination Form</h1>
  <div class="meta">
    <div>Dojo / Location: <span>${escapeHtml(schoolName)} — ${escapeHtml(syl?.label || '')} Grading</span></div>
    <div>Date: <span>${escapeHtml(session.date || '—')}</span></div>
    <div>Location: <span>${escapeHtml(session.location || '—')}</span></div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:70px;">Member No.</th>
      <th>Student Name <span style="font-weight:400;font-style:italic;">(as on certificate)</span></th>
      ${hasBeltSize ? '<th style="width:48px;text-align:center;">Belt<br>Size</th>' : ''}
      <th style="width:110px;">Current Grade</th>
      <th style="width:80px;">Syllabus</th>
      <th style="width:52px;text-align:center;">Fitness<br>Run<br>Self Def.</th>
      <th style="width:52px;text-align:center;">Basics<br>Tech.<br>Applic.</th>
      <th style="width:52px;text-align:center;">Kata<br>Sparring</th>
      <th style="width:52px;text-align:center;">Technique</th>
      <th>Distinction Pass / Pass / Pass Not Yet Complete / Pass Incomplete</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<div class="rounds-section">
  <strong>Grappling and/or sparring rounds as per relevant syllabus</strong> — Two minute rounds, max 20 second break between rounds
  <div class="round-boxes">
    <span style="font-size:9px;line-height:24px;margin-right:4px;">2 min break:</span>
    ${Array(8).fill('<div class="round-box">Init</div>').join('')}
  </div>
</div>

<div class="sigs">
  <p style="font-size:9px;font-style:italic;margin-bottom:8px;">I/we the below signed have thoroughly examined all under black belt/badge candidates in a fair, just manner, confirm the results are true, accurate and all students who I/we have passed on the date above have met ALL requirements of the relevant current KR syllabus graded in.</p>
  ${signatories.map(s => `
  <div class="sig-row">
    <div style="min-width:175px;font-weight:700;">${escapeHtml(s)}:</div>
    <div class="sig-line"></div>
    <div style="min-width:40px;padding-left:6px;">Signed:</div>
    <div class="sig-line"></div>
    <div style="min-width:30px;padding-left:6px;">Date:</div>
    <div style="width:70px;border-bottom:1px solid #999;"></div>
  </div>`).join('')}
</div>

<div class="note">Note: Upon completion of the KR Grading, KR Mini Little Ninjas or KR Little Ninjas Presentation please scan and email this completed form to admin@krmas.com.au for database update.</div>
</body></html>`;
}

/* ================================================================
   STOCKTAKE VIEW
   ================================================================ */
function renderGradingStocktake() {
  // Collect all belt-based grades (syllabi with hasBeltSize)
  const beltGrades = [];
  const seen = new Set();
  for (const syl of Object.values(GRADING_SYLLABI)) {
    if (!syl.hasBeltSize) continue;
    for (const g of syl.grades) {
      if (!seen.has(g.label) && g.label !== 'White Belt') {
        seen.add(g.label);
        beltGrades.push(g.label);
      }
    }
  }

  let html = `<p style="font-size:12px;color:var(--grey-500);margin-bottom:10px;">Record how many of each belt size you currently have. Used to calculate net order on the Belt order tab.</p>
    <button class="btn btn-black" style="width:100%;margin-bottom:12px;" onclick="saveStocktake()">Save stocktake</button>
    <div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="background:var(--off-white);">
        <th style="padding:6px 8px;border:1px solid var(--grey-200);text-align:left;font-family:'Oswald',sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:.06em;min-width:140px;">Belt</th>
        ${BELT_SIZES.map(s => `<th style="padding:6px 4px;border:1px solid var(--grey-200);text-align:center;font-family:'Oswald',sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:.06em;min-width:40px;">Sz ${s}</th>`).join('')}
      </tr></thead>
      <tbody>`;

  for (const grade of beltGrades) {
    const stock = state.stocktake[grade] || {};
    html += `<tr>
      <td style="padding:5px 8px;border:1px solid var(--grey-200);">
        <span style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600;">${beltSwatch(grade, 20)}${escapeHtml(grade)}</span>
      </td>
      ${BELT_SIZES.map(s => `<td style="padding:3px;border:1px solid var(--grey-200);text-align:center;">
        <input type="number" min="0" value="${stock[s] || 0}"
          data-grade="${escapeHtml(grade)}" data-size="${s}"
          onchange="updateStocktake(this)"
          style="width:38px;text-align:center;padding:4px 2px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:12px;font-family:'JetBrains Mono',monospace;">
      </td>`).join('')}
    </tr>`;
  }

  html += `</tbody></table></div>`;
  return html;
}

function updateStocktake(input) {
  const grade = input.dataset.grade;
  const size  = input.dataset.size;
  if (!state.stocktake[grade]) state.stocktake[grade] = {};
  state.stocktake[grade][size] = parseInt(input.value, 10) || 0;
}

async function saveStocktake() {
  await saveGrading();
  const toast = document.createElement('div');
  toast.textContent = 'Stocktake saved';
  toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--black);color:var(--white);padding:8px 18px;border-radius:999px;font-size:12px;font-weight:700;z-index:9999;pointer-events:none;';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1800);
}

/* ================================================================
   BELT ORDER VIEW
   ================================================================ */
function renderGradingBeltOrder() {
  // Tally new grades across all sessions
  const needed = {}; // { 'Belt label': { '1': n, '2': n, ... } }
  for (const session of Object.values(state.grading)) {
    const syl = GRADING_SYLLABI[session.syllabus];
    if (!syl?.hasBeltSize) continue;
    for (const c of (session.candidates || [])) {
      const ng = effectiveNewGrade(session.syllabus, c);
      if (!ng) continue;
      const size = parseInt(c.beltSize, 10);
      if (!size) continue;
      if (!needed[ng]) needed[ng] = {};
      needed[ng][size] = (needed[ng][size] || 0) + 1;
    }
  }

  // Net = needed − stocktake (only show > 0)
  const order = [];
  for (const [grade, sizes] of Object.entries(needed)) {
    for (const [size, count] of Object.entries(sizes)) {
      const stock = (state.stocktake[grade] || {})[size] || 0;
      const net = count - stock;
      order.push({ grade, size: parseInt(size), count, stock, net });
    }
  }
  order.sort((a, b) => a.grade.localeCompare(b.grade) || a.size - b.size);

  const toOrder = order.filter(r => r.net > 0);
  const total = toOrder.reduce((s, r) => s + r.net, 0);

  let html = `<p style="font-size:12px;color:var(--grey-500);margin-bottom:10px;">Calculated from all grading sessions with results recorded, minus your stocktake.</p>
    ${can.manageStocktake() ? `<button class="btn btn-black" style="width:100%;margin-bottom:12px;" onclick="printBeltOrder()">Print belt order</button>` : ''}`;

  if (order.length === 0) {
    html += `<div class="empty"><h2>No data yet</h2><p>Add students with results in a grading session and your stocktake to see what to order.</p></div>`;
    return html;
  }

  if (toOrder.length === 0) {
    html += `<div style="background:var(--white);border:1px solid var(--ok);border-radius:var(--r-md);padding:14px;font-size:13px;color:var(--ok);font-weight:700;">✓ Stock covers all grading requirements — nothing to order.</div>`;
  } else {
    html += `<div class="section-sub">To order (${total} total)</div>`;
    // Sticky size legend
    html += `<div style="position:sticky;top:0;background:var(--off-white);border-bottom:1px solid var(--grey-200);padding:6px 10px;font-size:10px;font-family:'Oswald',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--grey-500);z-index:10;display:flex;gap:6px;align-items:center;">
      <span style="flex:1;">Belt</span>
      <span style="min-width:36px;text-align:center;">Size</span>
      <span style="min-width:44px;text-align:center;">Needed</span>
      <span style="min-width:44px;text-align:center;">Stock</span>
      <span style="min-width:44px;text-align:center;color:var(--red);">Order</span>
    </div>`;
    for (const r of toOrder) {
      html += `<div class="belt-order-row">
        ${beltSwatch(r.grade, 24)}
        <div style="flex:1;font-weight:600;font-size:13px;">${escapeHtml(r.grade)}</div>
        <div class="size-tag" style="min-width:36px;text-align:center;">Sz ${r.size}</div>
        <div style="min-width:44px;text-align:center;font-size:12px;color:var(--grey-500);">${r.count}</div>
        <div style="min-width:44px;text-align:center;font-size:12px;color:var(--grey-500);">${r.stock}</div>
        <div class="count-pill" style="min-width:44px;text-align:center;">${r.net}</div>
      </div>`;
    }
  }

  // Also show full tally even if stock covers it
  if (order.length > toOrder.length) {
    html += `<div class="section-sub" style="margin-top:14px;">Full tally (covered by stock)</div>`;
    for (const r of order.filter(r => r.net <= 0)) {
      html += `<div class="belt-order-row" style="opacity:0.5;">
        <div class="count-pill" style="background:var(--ok);">✓</div>
        ${beltSwatch(r.grade, 24)}
        <div style="flex:1;font-weight:600;font-size:13px;">${escapeHtml(r.grade)}</div>
        <div class="size-tag">Size ${r.size}</div>
        <div style="font-size:10px;color:var(--grey-400);">${r.count} needed · ${r.stock} in stock</div>
      </div>`;
    }
  }

  return html;
}

function printBeltOrder() {
  const order = [];
  for (const session of Object.values(state.grading)) {
    const syl = GRADING_SYLLABI[session.syllabus];
    if (!syl?.hasBeltSize) continue;
    for (const c of (session.candidates || [])) {
      const ng = effectiveNewGrade(session.syllabus, c);
      if (!ng) continue;
      const size = parseInt(c.beltSize, 10);
      if (!size) continue;
      let entry = order.find(r => r.grade === ng && r.size === size);
      if (!entry) { entry = { grade: ng, size, count: 0, stock: (state.stocktake[ng] || {})[size] || 0 }; order.push(entry); }
      entry.count++;
    }
  }
  order.sort((a, b) => a.grade.localeCompare(b.grade) || a.size - b.size);
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
  const schoolName = school?.name || state.schoolId;
  const toOrder = order.filter(r => r.count - r.stock > 0);
  const total = toOrder.reduce((s, r) => s + (r.count - r.stock), 0);

  const rows = order.map(r => {
    const net = r.count - r.stock;
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(r.grade)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${r.size}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${r.count}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${r.stock}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;font-weight:700;color:${net > 0 ? '#d62828' : '#16a34a'};">${net > 0 ? net : '—'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Belt Order — ${escapeHtml(schoolName)}</title>
<style>
  body { font-family: Arial, sans-serif; padding: 24px; font-size: 13px; color: #1a1a1a; }
  h1 { font-size: 18px; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; margin: 0 0 4px; }
  .sub { font-size: 11px; color: #555; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f5f5f3; text-align: left; padding: 7px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; border-bottom: 2px solid #ddd; }
  .total { margin-top: 14px; font-weight: 700; font-size: 14px; }
  @media print { body { padding: 12mm; } @page { size: A4; margin: 0; } }
</style></head>
<body>
  <h1>Belt Order — ${escapeHtml(schoolName)}</h1>
  <div class="sub">Generated ${new Date().toLocaleDateString('en-AU', {day:'2-digit',month:'long',year:'numeric'})} · All grading sessions with results recorded</div>
  <table>
    <thead><tr><th>Belt</th><th>Size</th><th>Needed</th><th>In stock</th><th>Order qty</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total">Total to order: ${total}</div>
</body></html>`;

  const w = window.open('', '_blank', 'width=800,height=600');
  if (!w) { alert('Allow pop-ups to print.'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

// ---------- Instructor Manager ----------
function openInstructorManager() {
  if (!requireRole('admin')) return;
  renderInstructorManagerModal();
  injectCustomRoleOptions('inviteRole');
  openModal('modalInstructorManager');
}

function renderInstructorManagerModal() {
  const instrs = allInstructors();
  const body = document.getElementById('instrManagerBody');
  if (!body) return;

  if (instrs.length === 0) {
    body.innerHTML = `<div style="font-size:13px;color:var(--grey-500);padding:8px 0;">No users yet. Tap “+ Add user” to create one.</div>`;
    return;
  }

  body.innerHTML = instrs.map(instr => `
    <div style="background:var(--white);border:1px solid var(--grey-200);border-radius:var(--r-md);padding:12px 14px;margin-bottom:8px;${instr.active === false && instr.status !== 'leave' ? 'opacity:.45;' : ''}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        ${avatarHtml(instr, 40)}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;">${escapeHtml(instr.name)}</div>
          <div style="font-size:11px;color:var(--grey-500);margin-top:2px;">${instr.email ? escapeHtml(instr.email) + ' · ' : ''}${instr.uid ? '<span style="color:#16a34a;font-weight:600;">Can sign in</span>' : (instr.email ? 'No login — re-save to enable' : 'No login (add an email)')}</div>
        </div>
        ${roleBadge(instr.role)}
        ${instr.status === 'leave' ? '<span style="font-size:9px;background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:999px;font-weight:700;text-transform:uppercase;">On leave</span>' : ''}
        ${instr.active === false && instr.status !== 'leave' ? '<span style="font-size:9px;background:var(--grey-200);color:var(--grey-500);padding:2px 6px;border-radius:999px;font-weight:700;text-transform:uppercase;">Inactive</span>' : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        <select onchange="instrSetRole('${instr.id}', this.value)" style="padding:5px 8px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:12px;">
          ${roleSelectOptions(instr.role)}
        </select>
        <select onchange="instrSetStatus('${instr.id}', this.value)" style="padding:5px 8px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:12px;">
          <option value="active"${instr.active !== false && instr.status !== 'leave' ? ' selected' : ''}>Active</option>
          <option value="leave"${instr.status === 'leave' ? ' selected' : ''}>On leave</option>
          <option value="inactive"${instr.active === false && instr.status !== 'leave' ? ' selected' : ''}>Inactive</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:${canImpersonate(instr) ? '1fr 1fr 1fr' : '1fr 1fr'};gap:6px;margin-top:6px;">
        <button class="btn btn-sm" style="font-size:11px;" onclick="openUserEditor('${instr.id}')">✎ Edit</button>
        <button class="btn btn-sm" style="font-size:11px;" onclick="openInstrDocsViewer('${instr.id}')">📄 Docs</button>
        ${canImpersonate(instr) ? `<button class="btn btn-sm" style="font-size:11px;" onclick="startImpersonation('${instr.id}')">👁 View as</button>` : ''}
      </div>
    </div>
  `).join('');
}

// Role <option> list for the user-manager dropdowns — builtins + any custom roles,
// always including the user's current role even if the config hasn't loaded.
function roleSelectOptions(selectedRole) {
  const base = (state.roleConfig && state.roleConfig.roles && state.roleConfig.roles.length)
    ? state.roleConfig.roles.map(r => ({ key: r.key, label: r.label }))
    : [{ key: 'superadmin', label: 'Superadmin' }, { key: 'admin', label: 'Admin' },
       { key: 'instructor', label: 'Instructor' }, { key: 'junior', label: 'Junior' }];
  if (selectedRole && !base.find(r => r.key === selectedRole)) base.push({ key: selectedRole, label: roleLabelFor(selectedRole) });
  return base.map(r => `<option value="${escapeHtml(r.key)}"${selectedRole === r.key ? ' selected' : ''}>${escapeHtml(r.label)}</option>`).join('');
}

// ── App logins manager (auth users / profiles) ──
async function openUserManager() {
  if (!requireRole('admin')) return;
  if (!DB.isSupabase) { alert('Login management needs the app to be online.'); return; }
  openModal('modalUsers');
  const ir = document.getElementById('inviteResult'); if (ir) ir.innerHTML = '';
  const ie = document.getElementById('inviteError'); if (ie) ie.textContent = '';
  await renderUserManager();
}

async function renderUserManager() {
  const list = document.getElementById('usersList');
  if (!list) return;
  list.innerHTML = '<div style="font-size:13px;color:var(--grey-500);padding:8px;">Loading…</div>';
  let users = [];
  try { users = await DB.users.list(); }
  catch (e) { list.innerHTML = '<div style="color:var(--red);font-size:13px;padding:8px;">Could not load logins: ' + escapeHtml((e && e.message) || '') + '</div>'; return; }
  if (!users.length) { list.innerHTML = '<div style="font-size:13px;color:var(--grey-500);padding:8px;">No login accounts yet. Invite someone above.</div>'; return; }
  const me = state.user && state.user.id;
  const schools = (typeof KRMAS_SCHOOLS !== 'undefined') ? KRMAS_SCHOOLS : [];
  list.innerHTML = users.map(u => {
    const isMe = u.id === me;
    const schoolName = (schools.find(s => s.id === u.school_id) || {}).name || (u.school_id || 'Network');
    const safeName = (u.display_name || 'this user').replace(/['\\]/g, '');
    return `<div style="background:var(--white);border:1px solid var(--grey-200);border-radius:var(--r-md);padding:12px 14px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;">${escapeHtml(u.display_name || '(no name)')}${isMe ? ' <span style="font-size:10px;color:var(--grey-400);">(you)</span>' : ''}</div>
          <div style="font-size:11px;color:var(--grey-500);">${u.email ? escapeHtml(u.email) + ' · ' : ''}${escapeHtml(schoolName)}</div>
        </div>
        ${roleBadge(u.role)}
      </div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;">
        <select ${isMe ? 'disabled' : ''} onchange="userSetRole('${u.id}', this.value)" style="padding:6px 8px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:12px;${isMe ? 'opacity:.5;' : ''}">
          ${roleSelectOptions(u.role)}
        </select>
        ${isMe ? '' : `<button class="btn btn-ghost btn-sm" style="font-size:11px;color:var(--red);" onclick="userRemove('${u.id}','${escapeHtml(safeName)}')">Remove</button>`}
      </div>
    </div>`;
  }).join('');
}

async function userInvite() {
  const name = (document.getElementById('inviteName').value || '').trim();
  const email = (document.getElementById('inviteEmail').value || '').trim();
  const role = document.getElementById('inviteRole').value;
  const err = document.getElementById('inviteError');
  const btn = document.getElementById('inviteBtn');
  const result = document.getElementById('inviteResult');
  if (err) err.textContent = '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { if (err) err.textContent = 'Enter a valid email.'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Inviting…'; }
  try {
    const res = await DB.users.invite(email, role, state.schoolId, name || null);
    if (result) result.innerHTML = `<div style="margin-top:10px;padding:10px;border:1px solid var(--grey-200);border-radius:var(--r-sm);background:var(--off-white);font-size:13px;">
      Login created for <b>${escapeHtml(email)}</b>. Share this temporary password privately — it won't be shown again:
      <div style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:16px;margin-top:6px;">${escapeHtml((res && res.tempPassword) || '')}</div></div>`;
    document.getElementById('inviteName').value = '';
    document.getElementById('inviteEmail').value = '';
    await renderUserManager();
  } catch (e) {
    if (err) err.textContent = (e && e.message) || 'Invite failed.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send invite'; }
  }
}

async function userSetRole(uid, role) {
  try { await DB.users.setRole(uid, role); }
  catch (e) { alert('Could not change role: ' + ((e && e.message) || '')); await renderUserManager(); }
}

async function userRemove(uid, name) {
  if (!confirm('Remove the login for ' + name + '?\n\nThey will no longer be able to sign in. This does not delete any roster or scheduling data.')) return;
  try { await DB.users.remove(uid); await renderUserManager(); }
  catch (e) { alert('Could not remove: ' + ((e && e.message) || '')); }
}

// ── User editor (add / edit) — change 4 ──
// Custom roles (below admin) are assignable too. Inject them into a role <select>
// next to the builtins. Re-runnable: strips any previously-injected options first so
// re-opening the editor doesn't stack duplicates.
function injectCustomRoleOptions(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  Array.prototype.slice.call(sel.querySelectorAll('option[data-custom-role="1"]')).forEach(o => o.remove());
  const customs = ((state.roleConfig && state.roleConfig.roles) || [])
    .filter(r => !r.builtin && (r.rank || 0) < 3)
    .sort((a, b) => a.label.localeCompare(b.label));
  for (const r of customs) {
    const opt = document.createElement('option');
    opt.value = r.key; opt.textContent = r.label; opt.setAttribute('data-custom-role', '1');
    sel.appendChild(opt);
  }
}

function openUserEditor(instrId) {
  if (!requireRole('admin')) return;
  state.editingUserId = instrId || null;
  const instr = instrId ? allInstructors().find(i => i.id === instrId) : null;

  // Best-effort parse of legacy "Title Name" display names into structured fields
  let title = instr?.title || '', first = instr?.firstName || '', last = instr?.lastName || '';
  if (instr && !first && !last && instr.name) {
    const toks = instr.name.trim().split(/\s+/);
    first = toks.pop() || '';
    title = toks.join(' ');
  }

  document.getElementById('userEditorTitle').textContent = instr ? 'Edit user' : 'Add user';
  document.getElementById('userTitle').value  = title;
  document.getElementById('userFirst').value  = first;
  document.getElementById('userLast').value   = last;
  document.getElementById('userShort').value  = instr?.short || first || '';
  document.getElementById('userEmail').value  = instr?.email || '';
  injectCustomRoleOptions('userRole');
  document.getElementById('userRole').value   = instr?.role || 'instructor';
  document.getElementById('userStatus').value = instr ? (instr.status === 'leave' ? 'leave' : instr.active === false ? 'inactive' : 'active') : 'active';
  document.getElementById('userAvatarFile').value = '';
  document.getElementById('userAvatarStatus').textContent = '';
  _editingUserAvatar = instr?.avatar || null;
  renderUserAvatarPreview();
  document.getElementById('userDeleteBtn').style.display = instr ? 'block' : 'none';
  const rpBtn = document.getElementById('userResetPwBtn');
  if (rpBtn) rpBtn.style.display = (instr && instr.uid && DB.isSupabase) ? 'block' : 'none';
  renderUserSchoolsChecklist(instr);
  openModal('modalUserEditor');
}

// Multi-school membership UI. Only a superadmin may assign it, and only instructors
// are multi-school — so the checklist is hidden for every other case (the school
// stays implicit/single). The ticked set flows to profiles.schools via the edge fn.
function renderUserSchoolsChecklist(instr) {
  const row = document.getElementById('userSchoolsRow');
  const listEl = document.getElementById('userSchoolsList');
  if (!row || !listEl) return;
  const role = document.getElementById('userRole').value;
  const isSuper = !!(state.user && state.user.role === 'superadmin');
  if (!isSuper || role !== 'instructor') { row.style.display = 'none'; listEl.innerHTML = ''; return; }
  const current = (instr && Array.isArray(instr.schools) && instr.schools.length)
    ? instr.schools.slice()
    : [state.schoolId];
  listEl.innerHTML = KRMAS_SCHOOLS.map(s => {
    const checked = current.includes(s.id) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer;padding:2px 0;">
      <input type="checkbox" class="userSchoolChk" value="${s.id}" ${checked} style="width:auto;margin:0;">
      <span>${escapeHtml(s.name)}</span></label>`;
  }).join('');
  row.style.display = '';
}

function onUserRoleChange() {
  const instr = state.editingUserId ? allInstructors().find(i => i.id === state.editingUserId) : null;
  renderUserSchoolsChecklist(instr);
}

let _editingUserAvatar = null;
function renderUserAvatarPreview() {
  const prev = document.getElementById('userAvatarPreview');
  const clearBtn = document.getElementById('userAvatarClear');
  const first = document.getElementById('userFirst')?.value || '';
  if (prev) prev.innerHTML = avatarHtml({ avatar: _editingUserAvatar, name: first || '?' }, 64).replace('class="avatar-img"', 'class="avatar-img av-preview"').replace('class="avatar-ph"', 'class="avatar-ph av-preview"');
  if (clearBtn) clearBtn.style.display = _editingUserAvatar ? '' : 'none';
}

async function handleUserAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  const status = document.getElementById('userAvatarStatus');
  if (file.size > 8 * 1024 * 1024) { status.textContent = '⚠ Image too large (max 8 MB).'; status.style.color = 'var(--red)'; input.value = ''; return; }
  status.textContent = 'Processing…'; status.style.color = 'var(--grey-500)';
  try {
    _editingUserAvatar = await resizeImageSquare(file, 256);
    status.textContent = '✓ Photo ready';
    status.style.color = 'var(--ok)';
    renderUserAvatarPreview();
  } catch (e) {
    status.textContent = '⚠ ' + e.message;
    status.style.color = 'var(--red)';
  }
}

function clearUserAvatar() {
  _editingUserAvatar = null;
  document.getElementById('userAvatarFile').value = '';
  document.getElementById('userAvatarStatus').textContent = '';
  renderUserAvatarPreview();
}

async function saveUser() {
  if (!requireRole('admin')) return;
  const title = document.getElementById('userTitle').value.trim();
  const first = document.getElementById('userFirst').value.trim();
  const last  = document.getElementById('userLast').value.trim();
  const short = document.getElementById('userShort').value.trim();
  const email = document.getElementById('userEmail').value.trim();
  const role  = document.getElementById('userRole').value;
  const statusSel = document.getElementById('userStatus').value;

  if (!first && !short) { alert('Enter at least a first name or short name.'); return; }
  const name = [title, first, last].filter(Boolean).join(' ') || short;

  const instrs = ensureCustomInstructors();
  let instr = state.editingUserId ? instrs.find(i => i.id === state.editingUserId) : null;

  if (!instr) {
    // Create new — generate a unique id from the first/short name
    const baseId = (first || short).toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
    let id = baseId, n = 1;
    const taken = new Set(instrs.map(i => i.id));
    while (taken.has(id)) id = baseId + (++n);
    instr = { id, pin: '0000' };
    instrs.push(instr);
  }

  instr.title = title;
  instr.firstName = first;
  instr.lastName = last;
  instr.short = short || first;
  instr.email = email;
  instr.name = name;
  instr.role = role;
  instr.status = statusSel === 'leave' ? 'leave' : undefined;
  instr.active = statusSel !== 'inactive';
  if (_editingUserAvatar) instr.avatar = _editingUserAvatar; else delete instr.avatar;

  // Multi-school membership: only a superadmin assigns it, and only for instructors.
  // Collect the ticked schools; otherwise leave `schools` undefined so the server
  // preserves the existing set (on edit) or derives a single home school (on create).
  let schools;
  const isSuperEditor = !!(state.user && state.user.role === 'superadmin');
  if (isSuperEditor && role === 'instructor') {
    schools = Array.from(document.querySelectorAll('.userSchoolChk')).filter(c => c.checked).map(c => c.value);
    if (!schools.length) schools = [state.schoolId];
    instr.schools = schools.slice();
  } else if (role !== 'instructor' && instr.schools) {
    delete instr.schools; // collapsing to a single-school role
  }

  await saveCustomSchools();

  // If editing yourself, sync the session
  if (state.user && instr.id === state.user.id) {
    state.user.name = name; state.user.role = role;
    saveUserAsync();
  }

  // Unified people model: a person with an email also gets a login (profile),
  // linked back via instr.uid. Role stays in sync; existing logins are reused.
  if (DB.isSupabase && email) {
    try {
      if (instr.uid) {
        await DB.users.setRole(instr.uid, role, undefined, schools);
      } else {
        const existing = (await DB.users.list()).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
        if (existing) {
          instr.uid = existing.id;
          if (existing.role !== role || schools !== undefined) await DB.users.setRole(existing.id, role, undefined, schools);
          await saveCustomSchools();
        } else {
          const res = await DB.users.invite(email, role, state.schoolId, name, schools);
          if (res && res.uid) { instr.uid = res.uid; await saveCustomSchools(); }
          if (res && res.tempPassword) {
            alert('Login created for ' + email + '.\n\nTemporary password (share privately — shown only once):\n\n' + res.tempPassword);
          }
        }
      }
    } catch (e) {
      alert('Saved to the roster, but setting up their login failed:\n' + ((e && e.message) || 'unknown') + '\n\nEdit them again to retry.');
    }
  }

  closeModal('modalUserEditor');
  renderInstructorManagerModal();
}

async function deleteUser() {
  if (!requireRole('admin')) return;
  const id = state.editingUserId;
  if (!id) return;
  if (state.user && id === state.user.id) { alert('You cannot delete your own account.'); return; }
  const instrs = ensureCustomInstructors();
  const instr = instrs.find(i => i.id === id);
  if (!instr) return;
  if (!confirm(`Delete "${instr.name}"? This removes them from this school and revokes their login. Cannot be undone.`)) return;
  if (DB.isSupabase && instr.uid) {
    try { await DB.users.remove(instr.uid); }
    catch (e) { alert('Could not remove their login (' + ((e && e.message) || '') + '). Removing from roster anyway.'); }
  }
  state.customSchools[state.schoolId].instructors = instrs.filter(i => i.id !== id);
  await saveCustomSchools();
  closeModal('modalUserEditor');
  renderInstructorManagerModal();
}

async function instrSetRole(instrId, newRole) {
  if (blockedByImpersonation()) return;
  if (!requireRole('admin')) return;
  // Write to custom schools overlay (works for both seeded + custom)
  if (!state.customSchools[state.schoolId]) {
    const seed = SCHOOL_DATA_SEED[state.schoolId];
    state.customSchools[state.schoolId] = {
      instructors: JSON.parse(JSON.stringify(seed?.instructors || [])),
      schedule: [],
      defaults: {},
      contact: seed?.contact || {}
    };
  }
  const instrs = state.customSchools[state.schoolId].instructors;
  const instr = instrs.find(i => i.id === instrId);
  if (!instr) {
    // Instructor may be from seed — copy into custom
    const merged = currentInstructors();
    const src = merged.find(i => i.id === instrId);
    if (src) { state.customSchools[state.schoolId].instructors = JSON.parse(JSON.stringify(merged)); }
    else { alert('Instructor not found.'); return; }
  }
  const target = state.customSchools[state.schoolId].instructors.find(i => i.id === instrId);
  if (!target) { alert('Could not update role.'); return; }
  target.role = newRole;
  if (instrId === state.user?.id && !['admin','superadmin'].includes(newRole)) {
    if (!confirm('You are changing your own role. You may lose admin access. Continue?')) { renderInstructorManagerModal(); return; }
  }
  await saveCustomSchools();
  if (DB.isSupabase && target.uid) {
    try { await DB.users.setRole(target.uid, newRole); }
    catch (e) { alert('Updated on the roster, but their login role change failed: ' + ((e && e.message) || '')); }
  }
  renderInstructorManagerModal();
  if (instrId === state.user?.id) { state.user.role = newRole; saveUserAsync(); }
  // A role change can move this instructor in/out of rule-based groups — re-materialise.
  try { await resyncAllGroups(); } catch (e) { console.warn('group resync after role change:', e && e.message); }
}

async function instrSetStatus(instrId, status) {
  if (!requireRole('admin')) return;
  if (instrId === state.user?.id && status === 'inactive') { alert('You cannot deactivate your own account.'); renderInstructorManagerModal(); return; }
  // Ensure custom schools overlay exists
  if (!state.customSchools[state.schoolId]) {
    const seed = SCHOOL_DATA_SEED[state.schoolId];
    state.customSchools[state.schoolId] = { instructors: JSON.parse(JSON.stringify(currentInstructors())), schedule: [], defaults: {}, contact: seed?.contact || {} };
  }
  let instrs = state.customSchools[state.schoolId].instructors;
  if (!instrs.find(i => i.id === instrId)) {
    state.customSchools[state.schoolId].instructors = JSON.parse(JSON.stringify(allInstructors()));
    instrs = state.customSchools[state.schoolId].instructors;
  }
  const instr = instrs.find(i => i.id === instrId);
  if (!instr) return;
  instr.status = status;
  instr.active = status === 'active';
  await saveCustomSchools();
  renderInstructorManagerModal();
}

async function instrToggleActive(instrId) {
  if (!requireRole('admin')) return;
  if (instrId === state.user?.id) { alert('You cannot deactivate your own account.'); return; }
  if (!state.customSchools[state.schoolId]) {
    const seed = SCHOOL_DATA_SEED[state.schoolId];
    state.customSchools[state.schoolId] = {
      instructors: JSON.parse(JSON.stringify(seed?.instructors || currentInstructors())),
      schedule: [], defaults: {}, contact: seed?.contact || {}
    };
  }
  let instrs = state.customSchools[state.schoolId].instructors;
  if (!instrs.find(i => i.id === instrId)) {
    state.customSchools[state.schoolId].instructors = JSON.parse(JSON.stringify(currentInstructors()));
    instrs = state.customSchools[state.schoolId].instructors;
  }
  const instr = instrs.find(i => i.id === instrId);
  if (!instr) return;
  instr.active = instr.active === false ? true : false;
  await saveCustomSchools();
  renderInstructorManagerModal();
}

async function instrResetPin(instrId) {
  alert('PINs are no longer used to sign in. Everyone signs in with their email and password (manage those under "Manage app logins"). The optional on-device PIN is a personal lock each person sets on their own device.');
}

// ---------- Audit log ----------
function openAuditLog() {
  if (!requireRole('admin')) return;
  renderAuditLogModal();
  openModal('modalAuditLog');
}

function renderAuditLogModal() {
  const body = document.getElementById('auditLogBody');
  if (!body) return;
  const entries = collectAuditEntries();
  if (entries.length === 0) {
    body.innerHTML = `<div style="font-size:13px;color:var(--grey-500);padding:8px 0;">No audit entries yet. Changes made by instructors will appear here.</div>`;
    return;
  }
  body.innerHTML = entries.slice(0, 100).map(e => `
    <div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--grey-100);font-size:12px;align-items:baseline;">
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--grey-400);flex-shrink:0;min-width:90px;">${e.dateStr}</div>
      <div style="flex:1;min-width:0;">
        <span style="font-weight:700;">${escapeHtml(e.by || '—')}</span>
        <span style="color:var(--grey-500);"> · ${escapeHtml(e.action)}</span>
      </div>
      ${roleBadge(e.byRole || 'instructor')}
    </div>`).join('');
}

function collectAuditEntries() {
  const entries = [];
  const addEntry = (obj, action) => {
    if (!obj?.updatedAt) return;
    entries.push({
      ts: new Date(obj.updatedAt).getTime(),
      dateStr: formatDateShort(new Date(obj.updatedAt)) + ' ' + new Date(obj.updatedAt).toLocaleTimeString('en-AU', { hour:'2-digit', minute:'2-digit' }),
      by: obj.updatedBy || obj.createdBy || '—',
      byRole: null,
      action
    });
  };
  for (const [key, plan] of Object.entries(state.plans || {})) addEntry(plan, `Saved lesson plan for ${plan.date || key}`);
  for (const [id, inc] of Object.entries(state.incidents || {})) addEntry(inc, `Incident report — ${inc.personName || id} (${inc.severity || '—'})`);
  for (const [key, edit] of Object.entries(state.edits || {})) { if (edit.editedAt) entries.push({ ts: new Date(edit.editedAt).getTime(), dateStr: formatDateShort(new Date(edit.editedAt)) + ' ' + new Date(edit.editedAt).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'}), by: edit.editedBy || '—', byRole: null, action: `Roster edit — ${key}` }); }
  for (const [id, stu] of Object.entries(state.students || {})) addEntry(stu, `Student record — ${stu.name || id}`);
  return entries.sort((a, b) => b.ts - a.ts);
}

// ---------- Notices ----------

const NOTICE_TYPES = {
  info:    { label: 'Info',    bg: '#eff6ff', border: '#3b82f6', text: '#1e40af', icon: 'ℹ' },
  alert:   { label: 'Alert',   bg: '#fffbeb', border: '#f59e0b', text: '#92400e', icon: '⚠' },
  urgent:  { label: 'Urgent',  bg: '#fff1f2', border: '#d62828', text: '#9f1239', icon: '🚨' },
};

function activeNotices() {
  const today = isoDate(new Date());
  const legacy = [
    ...state.networkNotices.map(n => ({ ...n, _network: true })),
    ...state.notices.map(n => ({ ...n, _network: false })),
  ];
  // Feed posts that are pinned or urgent notices also surface as banners
  const postNotices = (state.feed || [])
    .filter(p => p.noticeType && (p.pinned || p.noticeType === 'urgent') && canSeePost(p))
    .map(p => ({
      id: 'post-' + p.id,
      type: p.noticeType,
      title: (p.body || '').slice(0, 80) + ((p.body || '').length > 80 ? '…' : ''),
      body: '',
      expiresAt: p.expiresAt || null,
      pinned: p.pinned || false,
      createdAt: p.createdAt,
      _network: p.targetScope === 'network',
      _postId: p.id,
    }));
  const all = [...legacy, ...postNotices];
  return all.filter(n =>
    !state.dismissedNotices.has(n.id) &&
    (!n.expiresAt || n.expiresAt >= today)
  ).sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
    const order = { urgent: 0, alert: 1, info: 2 };
    if ((order[a.type] ?? 9) !== (order[b.type] ?? 9)) return (order[a.type] ?? 9) - (order[b.type] ?? 9);
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

function renderNoticeBanners() {
  const notices = activeNotices();
  const container = document.getElementById('noticeBanners');
  if (container) {
    if (notices.length === 0) { container.innerHTML = ''; }
    else {
      container.innerHTML = notices.map(n => {
        const t = NOTICE_TYPES[n.type] || NOTICE_TYPES.info;
        const networkTag = n._network
          ? `<span style="font-size:9px;background:var(--red);color:#fff;padding:1px 6px;border-radius:999px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-left:6px;">Network</span>`
          : '';
        return `<div style="background:${t.bg};border:1px solid ${t.border};border-left:4px solid ${t.border};border-radius:var(--r-md);padding:10px 12px;margin-bottom:6px;display:flex;align-items:flex-start;gap:8px;">
          <span style="font-size:16px;flex-shrink:0;line-height:1.3;">${t.icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
              <span style="font-weight:700;font-size:13px;color:${t.text};">${escapeHtml(n.title)}</span>
              ${networkTag}
            </div>
            ${n.body ? `<div style="font-size:12px;color:${t.text};opacity:.85;margin-top:3px;line-height:1.4;">${escapeHtml(n.body)}</div>` : ''}
            ${n.expiresAt ? `<div style="font-size:10px;color:${t.text};opacity:.6;margin-top:3px;">Expires ${n.expiresAt}</div>` : ''}
          </div>
          <button onclick="dismissNotice('${n.id}')" style="background:none;border:none;cursor:pointer;font-size:18px;color:${t.text};opacity:.5;flex-shrink:0;padding:0 0 0 4px;line-height:1;" title="Dismiss">×</button>
        </div>`;
      }).join('');
    }
  }

  // Badge on Me nav button
  const meBtn = document.querySelector('[data-view="me"]');
  if (meBtn) {
    const existing = meBtn.querySelector('.notice-badge');
    if (existing) existing.remove();
    const unread = activeNotices().length;
    if (unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'notice-badge nav-badge';
      badge.style.background = 'var(--gold)';
      badge.style.color = 'var(--black)';
      badge.textContent = unread > 9 ? '9+' : unread;
      meBtn.appendChild(badge);
    }
  }

  // Cover alerts: classes you're the listed backup for that need cover.
  const cont = document.getElementById('noticeBanners');
  if (cont) {
    const alerts = myBackupCoverAlerts();
    if (alerts.length) {
      const html = alerts.map(({ c, date, daysOut }) => {
        const cls = (CLASS_TYPES[c.type] && CLASS_TYPES[c.type].name) || c.type;
        const dayLabel = daysOut === 0 ? 'Today' : daysOut === 1 ? 'Tomorrow' : DAY_NAMES[date.getDay()];
        const ds = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
        return `<div style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid var(--red);border-radius:var(--r-md);padding:10px 12px;margin-bottom:6px;display:flex;align-items:flex-start;gap:8px;">
          <span style="font-size:16px;flex-shrink:0;line-height:1.3;">⚠️</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;color:var(--red);">Cover needed — you're the backup</div>
            <div style="font-size:12px;color:#7f1d1d;margin-top:3px;line-height:1.4;">${escapeHtml(cls)} · ${dayLabel} ${ds} · ${c.start}–${c.end}</div>
          </div>
          <button class="btn btn-primary btn-sm" style="flex-shrink:0;" onclick="volunteerToCover('${c.dateKey}');setView('cover')">Take it</button>
        </div>`;
      }).join('');
      cont.innerHTML = html + cont.innerHTML; // above any notices
    }
  }
}

function dismissNotice(id) {
  state.dismissedNotices.add(id);
  renderNoticeBanners();
}

// ---- Notices board (full view from Me tab) ----
function openNoticesBoard() {
  renderNoticesBoard();
  openModal('modalNoticesBoard');
}

function renderNoticesBoard() {
  const body = document.getElementById('noticesBoardBody');
  if (!body) return;
  const canManage = can.manageNotices();      // notices/add → may post notices
  const canEditNotices = can.editNotices();   // notices/edit → may edit existing notices
  const canNetwork = can.switchAnySchool();   // superadmin only (network scope)

  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
  const schoolName = school?.name || state.schoolId;

  let html = '';

  // Add buttons
  if (canManage) {
    html += `<div style="font-size:11px;color:var(--grey-500);margin-bottom:8px;">Notices are posted to the Feed — with likes, comments, attachments and required-reading tracking.</div>`;
    html += `<div style="display:grid;grid-template-columns:1fr${canNetwork ? ' 1fr' : ''};gap:8px;margin-bottom:14px;">
      <button class="btn btn-primary" onclick="closeModal('modalNoticesBoard');openPostComposer(null,{notice:true})">+ Notice for ${escapeHtml(schoolName)}</button>
      ${canNetwork ? `<button class="btn btn-black" onclick="closeModal('modalNoticesBoard');openPostComposer(null,{notice:true,network:true})">+ Network notice</button>` : ''}
    </div>`;
  }

  // Notice posts living in the feed
  const feedNotices = (state.feed || []).filter(p => p.noticeType && canSeePost(p));
  if (feedNotices.length > 0) {
    html += `<div class="section-sub">Feed notices</div>`;
    const today = isoDate(new Date());
    html += feedNotices.map(p => {
      const t = NOTICE_TYPES[p.noticeType] || NOTICE_TYPES.info;
      const expired = p.expiresAt && p.expiresAt < today;
      return `<div onclick="closeModal('modalNoticesBoard');setView('feed')" style="cursor:pointer;background:${expired ? 'var(--off-white)' : t.bg};border:1px solid ${expired ? 'var(--grey-200)' : t.border};border-left:4px solid ${expired ? 'var(--grey-300)' : t.border};border-radius:var(--r-md);padding:10px 12px;margin-bottom:8px;${expired ? 'opacity:.55;' : ''}">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span>${t.icon}</span>
          <span style="font-weight:700;font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml((p.body || '').slice(0, 70))}${(p.body || '').length > 70 ? '…' : ''}</span>
          ${p.requiredReading ? '<span style="font-size:9px;background:var(--red);color:#fff;padding:1px 6px;border-radius:999px;font-weight:700;">REQUIRED</span>' : ''}
          ${expired ? '<span style="font-size:9px;background:var(--grey-300);color:#fff;padding:1px 6px;border-radius:999px;font-weight:700;">EXPIRED</span>' : ''}
        </div>
        <div style="font-size:10px;color:var(--grey-400);margin-top:4px;">${escapeHtml(p.authorName)} · ${timeAgo(p.createdAt)} · ${(p.likeCount||0)} like${(p.likeCount||0)===1?'':'s'}, ${(p.commentCount||0)} comment${(p.commentCount||0)===1?'':'s'} · tap to open feed</div>
      </div>`;
    }).join('');
  }

  // Network notices section
  if (state.networkNotices.length > 0 || canNetwork) {
    html += `<div class="section-sub" style="display:flex;align-items:center;justify-content:space-between;">
      <span>Network notices</span>
      <span style="font-size:10px;color:var(--grey-500);">Visible to all schools</span>
    </div>`;
    if (state.networkNotices.length === 0) {
      html += `<div style="font-size:13px;color:var(--grey-500);padding:4px 0 10px;">No network notices.</div>`;
    } else {
      html += state.networkNotices.map(n => renderNoticeBoardItem(n, true, canNetwork)).join('');
    }
  }

  // School notices
  html += `<div class="section-sub" style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;">
    <span>${escapeHtml(schoolName)} notices</span>
    <span style="font-size:10px;color:var(--grey-500);">This school only</span>
  </div>`;
  if (state.notices.length === 0) {
    html += `<div style="font-size:13px;color:var(--grey-500);padding:4px 0 10px;">No school notices yet.${canManage ? ' Use the button above to post one.' : ''}</div>`;
  } else {
    html += state.notices.map(n => renderNoticeBoardItem(n, false, canEditNotices)).join('');
  }

  if (html === '' || (!canManage && state.notices.length === 0 && state.networkNotices.length === 0)) {
    html = `<div style="font-size:13px;color:var(--grey-500);padding:8px 0;">No notices at the moment.</div>`;
  }

  body.innerHTML = html;
}

function renderNoticeBoardItem(n, isNetwork, canEdit) {
  const t = NOTICE_TYPES[n.type] || NOTICE_TYPES.info;
  const today = isoDate(new Date());
  const expired = n.expiresAt && n.expiresAt < today;
  return `<div style="background:${expired ? 'var(--off-white)' : t.bg};border:1px solid ${expired ? 'var(--grey-200)' : t.border};border-left:4px solid ${expired ? 'var(--grey-300)' : t.border};border-radius:var(--r-md);padding:10px 12px;margin-bottom:8px;${expired ? 'opacity:.5;' : ''}">
    <div style="display:flex;align-items:flex-start;gap:8px;">
      <span style="font-size:15px;flex-shrink:0;">${t.icon}</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px;">
          <span style="font-weight:700;font-size:13px;">${escapeHtml(n.title)}</span>
          <span style="font-size:9px;background:${t.border};color:#fff;padding:1px 6px;border-radius:999px;font-weight:700;text-transform:uppercase;">${t.label}</span>
          ${n.pinned ? '<span style="font-size:9px;background:var(--black);color:#fff;padding:1px 6px;border-radius:999px;font-weight:700;text-transform:uppercase;">Pinned</span>' : ''}
          ${expired ? '<span style="font-size:9px;background:var(--grey-300);color:#fff;padding:1px 6px;border-radius:999px;font-weight:700;text-transform:uppercase;">Expired</span>' : ''}
        </div>
        ${n.body ? `<div style="font-size:12px;color:var(--grey-500);line-height:1.4;">${escapeHtml(n.body)}</div>` : ''}
        <div style="font-size:10px;color:var(--grey-400);margin-top:4px;">
          ${n.createdAt ? 'Posted ' + n.createdAt.slice(0, 10) : ''}${n.createdBy ? ' by ' + escapeHtml(n.createdBy) : ''}
          ${n.expiresAt ? ' · Expires ' + n.expiresAt : ''}
        </div>
      </div>
      ${canEdit ? `<button class="btn btn-sm" onclick="openNoticeEditor(${isNetwork}, '${n.id}')" style="flex-shrink:0;">Edit</button>` : ''}
    </div>
  </div>`;
}

// ---- Notice editor modal ----
function openNoticeEditor(isNetwork, existingId) {
  state.editingNoticeId = existingId || null;
  const existing = existingId
    ? (isNetwork ? state.networkNotices : state.notices).find(n => n.id === existingId)
    : null;

  document.getElementById('noticeEditorTitle').textContent = existingId ? 'Edit notice' : (isNetwork ? 'New network notice' : 'New school notice');
  document.getElementById('noticeIsNetwork').value = isNetwork ? '1' : '0';
  document.getElementById('noticeEditorNetworkTag').style.display = isNetwork ? 'block' : 'none';
  document.getElementById('noticeType').value    = existing?.type    || 'info';
  document.getElementById('noticeTitle').value   = existing?.title   || '';
  document.getElementById('noticeBody').value    = existing?.body    || '';
  document.getElementById('noticeExpires').value = existing?.expiresAt || '';
  document.getElementById('noticePinned').checked = existing?.pinned || false;
  document.getElementById('noticeDeleteBtn').style.display = existingId ? 'block' : 'none';
  openModal('modalNoticeEditor');
}

async function saveNotice() {
  if (blockedByImpersonation()) return;
  const title = document.getElementById('noticeTitle').value.trim();
  if (!title) { alert('Enter a title.'); return; }
  const isNetwork = document.getElementById('noticeIsNetwork').value === '1';
  // Network notices → superadmin; school notices → notices 'edit' (existing) or 'add' (new).
  const allowed = isNetwork ? can.switchAnySchool()
    : (state.editingNoticeId ? can.editNotices() : can.manageNotices());
  if (!allowed) { alert("You don't have permission to do that."); return; }
  const id = state.editingNoticeId || ('NTC-' + Date.now().toString(36).toUpperCase());
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);

  const notice = {
    id,
    type:       document.getElementById('noticeType').value,
    title,
    body:       document.getElementById('noticeBody').value.trim(),
    expiresAt:  document.getElementById('noticeExpires').value || null,
    pinned:     document.getElementById('noticePinned').checked,
    schoolId:   isNetwork ? null : state.schoolId,
    schoolName: isNetwork ? null : (school?.name || state.schoolId),
    createdBy:  state.user?.name || 'unknown',
    createdAt:  state.editingNoticeId
      ? ((isNetwork ? state.networkNotices : state.notices).find(n => n.id === id)?.createdAt || new Date().toISOString())
      : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (isNetwork) {
    const idx = state.networkNotices.findIndex(n => n.id === id);
    if (idx !== -1) state.networkNotices[idx] = notice;
    else state.networkNotices.unshift(notice);
    await DB.saveNotice(notice);
  } else {
    const idx = state.notices.findIndex(n => n.id === id);
    if (idx !== -1) state.notices[idx] = notice;
    else state.notices.unshift(notice);
    await DB.saveNotice(notice);
  }

  closeModal('modalNoticeEditor');
  renderNoticesBoard();
  renderNoticeBanners();

  // Push for newly-created notices (best-effort, fire-and-forget).
  if (!state.editingNoticeId) {
    try {
      const emoji = notice.type === 'urgent' ? '🚨' : (notice.type === 'warning' ? '⚠️' : '📣');
      DB.sendPushNotification({
        title: emoji + ' ' + notice.title,
        body: (notice.body || '').slice(0, 140) || 'Open KRMAS to read.',
        tag: 'krmas-notice-' + notice.id,
        url: './',
        schoolId: notice.schoolId,   // null = network notice = everyone
        targetUserIds: null,
        excludeUserId: state.user?.id || null,
      });
    } catch (e) { /* push is best-effort */ }
  }
}

async function deleteNotice() {
  if (blockedByImpersonation()) return;
  const id = state.editingNoticeId;
  if (!id) return;
  const isNetwork = document.getElementById('noticeIsNetwork').value === '1';
  if (!confirm('Delete this notice?')) return;
  if (isNetwork) {
    state.networkNotices = state.networkNotices.filter(n => n.id !== id);
  } else {
    state.notices = state.notices.filter(n => n.id !== id);
  }
  await DB.deleteNotice(id, isNetwork ? null : state.schoolId);
  closeModal('modalNoticeEditor');
  renderNoticesBoard();
  renderNoticeBanners();
}

// ---------- Supabase migration ----------
async function runMigration() {
  if (!confirm(
    'This will copy all local data for this school into Supabase.\n\n' +
    'Only run this once per device after setting up Supabase.\n\n' +
    'Continue?'
  )) return;
  try {
    const count = await DB.migrateLocalToSupabase(state.schoolId);
    alert(`Migration complete! ${count} data records copied to Supabase.\n\nAll instructors can now share data across devices.`);
    renderMe();
  } catch (e) {
    alert('Migration failed: ' + e.message + '\n\nMake sure SUPABASE_URL and SUPABASE_ANON are set in index.html.');
  }
}

// ---------- Boot ----------
async function init() {
  // The Supabase session is the real boundary now: without one, RLS returns nothing,
  // so we show the sign-in gate instead of trying to load data as an anonymous user.
  if (!DB.isSupabase) { await enterOfflineFallback(); return; }
  const session = await DB.auth.getSession();
  if (!session) { showLoginGate(); return; }
  await enterAppWithSession(session);
}

// Re-run whenever auth changes (magic-link callback completing, sign-out, token refresh).
let _enteredOnce = false;
DB.auth && DB.auth.onChange(async (session, evt) => {
  if (evt === 'PASSWORD_RECOVERY') { openSetPassword('recovery'); return; }
  if (session) { if (!_enteredOnce) await enterAppWithSession(session); }
  else { _enteredOnce = false; state.user = null; showLoginGate(); }
});

async function enterAppWithSession(session) {
  // Reload-safety: if the browser persisted the TARGET's session because the tab was
  // refreshed/closed mid-impersonation, transparently restore the real user first so
  // nobody is ever stranded inside someone else's account.
  try {
    const marker = JSON.parse(localStorage.getItem('krmas_imp') || 'null');
    if (marker && marker.realSession && marker.realSession.access_token) {
      localStorage.removeItem('krmas_imp');
      DB.setReadOnly(false);
      const restored = await DB.auth.restoreSession(marker.realSession);
      if (restored) session = restored;
    }
  } catch (e) { console.warn('impersonation recovery:', e && e.message); }

  // Temp-password accounts (from an invite or an admin reset) must choose their own
  // password before they can enter. updatePassword() clears the flag.
  if (session && session.user && session.user.user_metadata && session.user.user_metadata.must_change) {
    openSetPassword('first');
    return;
  }
  hideLoginGate();
  const prof = await DB.auth.myProfile();
  if (!prof) {
    await DB.auth.signOut();
    showLoginGate("This email isn't set up in KRMAS yet. Ask an admin to add you, then sign in again.");
    return;
  }
  _enteredOnce = true;
  state.user = { id: session.user.id, name: prof.display_name || session.user.email, role: prof.role, email: session.user.email || null };
  // Multi-school membership (instructors may belong to more than one school). Falls
  // back to the single home school for everyone else. Drives the school-pill filter.
  state.user.schools = (Array.isArray(prof.schools) && prof.schools.length)
    ? prof.schools.slice()
    : (prof.school_id ? [prof.school_id] : []);
  state.userSchools = state.user.schools;
  if (prof.school_id) {
    state.schoolId = prof.school_id;
    const school = (typeof KRMAS_SCHOOLS !== 'undefined') && KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
    if (school) { const el = document.getElementById('schoolName'); if (el) el.textContent = school.name; }
  }
  try { recordLastLogin(state.user.id); } catch (e) {}
  try { state.roleConfig = await DB.roles.loadConfig(); } catch (e) { console.warn('loadRoleConfig:', e && e.message); }
  try { await loadCustomSchools(); } catch (e) { console.warn('loadCustomSchools:', e && e.message); }
  try { await loadCurrentSchoolData(); } catch (e) { console.warn('loadCurrentSchoolData:', e && e.message); }
  state.user.instructorId = resolveMyInstructorId(); // bridge auth uid -> roster instructor id
  finishBootRender();
  if (typeof refreshAuthUI === 'function') refreshAuthUI();
  if (DB.isSupabase && !state._pinUnlocked) {
    try { if (await DB.auth.hasPin()) showPinLock(); } catch (e) {}
  }
  DB.loadInstructorDocuments(state.user.id).then(d => { state.myDocuments = d || []; }).catch(() => {});
}

// Offline / Supabase-unreachable: fall back to whatever is cached locally (read-only-ish).
async function enterOfflineFallback() {
  await loadCustomSchools();
  await loadCurrentSchoolData();
  finishBootRender();
}

function finishBootRender() {
  state.currentDate = startOfWeek(new Date());
  const todayDow = new Date().getDay();
  const activeDays = getActiveDays();
  state.selectedDay = activeDays.includes(todayDow) ? todayDow : (activeDays.find(d => d > todayDow) || activeDays[0] || 1);
  renderDayTabs();
  renderWeekMeta();
  setView('feed');
  updateSyncStatus();
  renderNoticeBanners();
}

init();

// Ensure content clears the bottom nav once layout/fonts settle.
window.addEventListener('load', syncNavHeight);
setTimeout(syncNavHeight, 300);

// ====================================================================
// App-update check — compares the running version against the served
// index.html and offers a one-tap update, so a new deploy is picked up
// without a manual hard-refresh. Also keeps the sync dot fresh.
// ====================================================================
let _updatePrompted = false;
async function checkForAppUpdate() {
  if (_updatePrompted || !navigator.onLine) return;
  try {
    const res = await fetch('./index.html?cb=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const text = await res.text();
    const m = text.match(/KRMAS_APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    const serverVer = m ? m[1] : null;
    const localVer = window.KRMAS_APP_VERSION || null;
    if (serverVer && localVer && serverVer !== localVer) {
      _updatePrompted = true;
      showUpdateBanner(serverVer);
    }
  } catch (e) { /* offline / blocked — ignore */ }
}

function showUpdateBanner(newVer) {
  if (document.getElementById('updateBanner')) return;
  const bar = document.createElement('div');
  bar.id = 'updateBanner';
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:calc(64px + env(safe-area-inset-bottom));z-index:200;display:flex;align-items:center;gap:10px;justify-content:center;background:var(--black);color:#fff;padding:10px 14px;font-size:13px;box-shadow:0 -2px 12px rgba(0,0,0,.3);';
  bar.innerHTML = `<span>A new version is available.</span>
    <button id="updateNowBtn" style="background:var(--red);color:#fff;border:none;border-radius:var(--r-sm);padding:7px 14px;font-weight:700;cursor:pointer;font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.04em;">Update now</button>
    <button id="updateDismissBtn" style="background:transparent;color:#aaa;border:none;cursor:pointer;font-size:18px;line-height:1;">×</button>`;
  document.body.appendChild(bar);
  document.getElementById('updateNowBtn').onclick = applyAppUpdate;
  document.getElementById('updateDismissBtn').onclick = () => bar.remove();
}

async function applyAppUpdate() {
  try {
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.update().catch(() => {})));
    }
  } catch (e) {}
  location.reload();
}

// Poll for updates + refresh the sync indicator periodically.
setInterval(() => { updateSyncStatus(); checkForAppUpdate(); }, 90000);
// First update check shortly after load (let init settle).
setTimeout(checkForAppUpdate, 8000);
// When the tab regains focus, re-check (covers PWAs left open for days).
document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateSyncStatus(); checkForAppUpdate(); } });

// ---------- Cover requests ----------
function renderCoverRequests() {
  hideDayHead();
  const main = document.getElementById('mainContent');
  if (!can.volunteerCover() && !can.editRoster()) {
    main.innerHTML = `<div class="empty"><h2>Sign in required</h2><p>Sign in to view and respond to cover requests.</p><button class="btn btn-primary" onclick="openLogin()">Sign in</button></div>`;
    return;
  }

  // Scan next 28 days for needs-cover or unassigned classes
  const urgent   = []; // today + 7 days
  const upcoming = []; // 8–28 days out
  const today = new Date();

  for (let i = 0; i < 28; i++) {
    const date = addDays(today, i);
    const dow  = date.getDay();
    if (!getActiveDays().includes(dow)) continue;
    for (const c of rosterForDay(date)) {
      if (c.status === 'cancelled') continue;
      if (!c.lead || c.status === 'needs-cover') {
        (i <= 7 ? urgent : upcoming).push({ c, date, daysOut: i });
      }
    }
  }

  let html = `<h1 class="section-head">Cover <span class="accent">requests</span></h1>`;

  if (urgent.length === 0 && upcoming.length === 0) {
    html += `<div class="empty"><h2>All covered ✓</h2><p>No unassigned classes in the next 28 days.</p></div>`;
    main.innerHTML = html;
    return;
  }

  const renderCoverCard = ({ c, date, daysOut }) => {
    const syl = CLASS_TYPES[c.type];
    const colour = syl?.colour || '--grey-300';
    const isMe = isMyClass(c);
    const dayLabel = daysOut === 0 ? 'Today' : daysOut === 1 ? 'Tomorrow' : DAY_NAMES[date.getDay()];
    const dateStr = `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`;
    return `<div style="background:var(--white);border:1px solid var(--grey-200);border-left:4px solid var(${colour});border-radius:var(--r-md);padding:12px 14px;margin-bottom:8px;box-shadow:var(--shadow);">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--grey-500);margin-bottom:3px;">
            ${escapeHtml(dayLabel)} ${dateStr} · ${c.start}–${c.end}
          </div>
          <div style="font-weight:700;font-size:14px;">${escapeHtml(syl?.name || c.type)}</div>
          ${c.status === 'needs-cover' ? '<div style="font-size:11px;color:var(--red);font-weight:700;margin-top:2px;">⚠ Cover needed (instructor flagged)</div>' : '<div style="font-size:11px;color:var(--warn);font-weight:700;margin-top:2px;">⚠ Lead unassigned</div>'}
          ${c.topicContent ? `<div style="font-size:11px;color:var(--grey-500);margin-top:2px;">Topic: ${escapeHtml(c.topicContent.title)}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
          ${can.volunteerCover() && !isMe ? `<button class="btn btn-primary btn-sm" onclick="volunteerToCover('${c.dateKey}');setView('cover')">Take it</button>` : ''}
          ${can.editRoster() ? `<button class="btn btn-sm" onclick="openEdit('${c.dateKey}')">Assign</button>` : ''}
        </div>
      </div>
    </div>`;
  };

  if (urgent.length > 0) {
    html += `<div class="section-sub" style="color:var(--red);">⚠ Urgent — next 7 days (${urgent.length})</div>`;
    html += urgent.map(renderCoverCard).join('');
  }
  if (upcoming.length > 0) {
    html += `<div class="section-sub" style="margin-top:12px;">Upcoming — 8–28 days (${upcoming.length})</div>`;
    html += upcoming.map(renderCoverCard).join('');
  }

  main.innerHTML = html;
}

// ---------- Feed data loaders ----------
async function loadFeedData() {
  state.feed = await DB.loadFeedPosts(state.schoolId, 50);
  const feedArr = state.feed || [];
  if (state.user && feedArr.length > 0) {
    const ids = feedArr.map(p => p.id);
    state.myLikes = await DB.loadMyLikes(state.user.id, ids);
  } else {
    state.myLikes = new Set();
  }
  // Acknowledgements for required-reading posts
  const reqIds = feedArr.filter(p => p.requiredReading).map(p => p.id);
  if (reqIds.length > 0) {
    const ackMap = await DB.loadAcksForPosts(reqIds);
    for (const p of feedArr) if (ackMap[p.id]) p._acks = ackMap[p.id];
    state.myAcks = state.user ? await DB.loadMyAcks(state.user.id, reqIds) : new Set();
  } else {
    state.myAcks = new Set();
  }
}

async function loadGroupsData() {
  state.groups = await DB.loadGroups(state.schoolId);
}

async function loadClassAssignmentsData() {
  state.classAssignments = await DB.loadClassAssignments(state.schoolId);
}

// ---------- Group evaluation ----------
// Evaluates whether an instructor passes a group's dynamic rules
function instrMatchesRules(instr, rules) {
  if (!rules || rules.length === 0) return false;
  return rules.every(rule => {
    const val = rule.field === 'state'    ? (KRMAS_SCHOOLS.find(s => s.id === instr.schoolId)?.state || instr.state)
              : rule.field === 'role'     ? instr.role
              : rule.field === 'school'   ? instr.schoolId
              : rule.field === 'syllabus' ? (instr.syllabi || [])
              : null;
    if (val == null) return false;
    if (rule.op === 'eq')  return String(val) === String(rule.value);
    if (rule.op === 'in')  return Array.isArray(val) ? val.includes(rule.value) : (rule.value || []).includes(String(val));
    if (rule.op === 'neq') return String(val) !== String(rule.value);
    return false;
  });
}

function resolveGroupMembers(group) {
  // Combines dynamic (rule-based) + static members. Network groups (school_id === null)
  // resolve across every school; school-scoped groups resolve within the active school.
  const pool = (group.school_id === null)
    ? allInstructorsAllSchools()
    : allInstructors().map(i => ({ ...i, schoolId: state.schoolId }));
  const dynamic = group.rules?.length ? pool.filter(i => instrMatchesRules(i, group.rules)) : [];
  // Static picks only (source 'static'; legacy rows without a source are treated as static).
  // Matched by uid OR slug so display works whether or not the row has been migrated.
  const staticList = (group.members || []).filter(m => (m.source || 'static') === 'static');
  const memberMatch = i => staticList.some(m => {
    const mid = m.user_id || m.userId;
    return (mid === (i.uid || i.id) || mid === i.id) &&
      ((m.school_id || m.schoolId || i.schoolId) === i.schoolId);
  });
  const staticMembers = pool.filter(memberMatch);
  // Merge, deduplicate by school+id
  const seen = new Set(dynamic.map(i => i.schoolId + ':' + i.id));
  return [...dynamic, ...staticMembers.filter(i => !seen.has(i.schoolId + ':' + i.id))];
}

function resolveTargetAudience(post) {
  // Returns Set of instructor IDs who can see this post
  if (post.targetScope === 'network') return null; // null = everyone
  if (post.targetScope === 'school') return null;  // everyone in this school
  if (post.targetScope === 'role') {
    const roles = post.targetIds || [];
    return new Set(allInstructors().filter(i => roles.includes(i.role)).map(i => i.id));
  }
  if (post.targetScope === 'users') {
    return new Set(post.targetIds || []);
  }
  if (post.targetScope === 'group') {
    const groupIds = post.targetIds || [];
    const members = new Set();
    for (const gid of groupIds) {
      const group = state.groups.find(g => g.id === gid);
      if (group) resolveGroupMembers(group).forEach(i => members.add(i.id));
    }
    return members;
  }
  return null;
}

function canSeePost(post) {
  if (state.user && post.authorId === state.user.id) return true;
  if (!state.user) return post.targetScope === 'network' || post.targetScope === 'school';
  const audience = resolveTargetAudience(post);
  if (audience === null) return true;
  // Audiences are built from instructor-record ids (slugs) for role/group, and may be
  // auth uids for people-targeting — so check the viewer under BOTH identities. (Slugs
  // and uids never collide, so this can't create a false match.)
  return audience.has(myInstructorId()) || audience.has(state.user.id);
}

// ---------- Feed view ----------
function renderFeed() {
  hideDayHead();
  const nb = document.getElementById('noticeBanners');
  if (nb) nb.innerHTML = ''; // feed embeds its own notices — avoid duplicate banners
  const main = document.getElementById('mainContent');
  const visiblePosts = (state.feed || []).filter(canSeePost);

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <h1 class="section-head" style="margin:0;">Feed</h1>
    ${state.user ? `<button class="btn btn-primary" onclick="openPostComposer()" style="padding:8px 16px;">✎ Post</button>` : ''}
  </div>`;

  // Pinned notices at top of feed
  const pinned = [...state.notices, ...state.networkNotices]
    .filter(n => n.pinned && (!n.expiresAt || n.expiresAt >= isoDate(new Date())))
    .sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  for (const n of pinned.slice(0, 2)) {
    const t = NOTICE_TYPES[n.type] || NOTICE_TYPES.info;
    html += `<div style="background:${t.bg};border:1px solid ${t.border};border-left:4px solid ${t.border};border-radius:var(--r-md);padding:10px 12px;margin-bottom:8px;display:flex;gap:8px;align-items:flex-start;" onclick="openNoticesBoard()">
      <span style="font-size:16px;">${t.icon}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:13px;color:${t.text};">${escapeHtml(n.title)}</div>
        ${n.body ? `<div style="font-size:12px;color:${t.text};opacity:.85;margin-top:2px;">${escapeHtml(n.body.slice(0,100))}${n.body.length>100?'…':''}</div>` : ''}
      </div>
      <span style="font-size:9px;background:${t.border};color:#fff;padding:1px 6px;border-radius:999px;font-weight:700;text-transform:uppercase;flex-shrink:0;">${t.label}</span>
    </div>`;
  }

  // Upcoming events strip
  html += renderUpcomingStrip();

  // Documents strip
  html += renderDocStrip();

  if (!state.user) {
    html += `<div class="empty"><h2>Sign in to see the feed</h2><p>Post updates, share class notes, and stay in touch with the team.</p><button class="btn btn-primary" onclick="openLogin()">Sign in</button></div>`;
    main.innerHTML = html;
    return;
  }

  if (visiblePosts.length === 0) {
    html += `<div style="text-align:center;padding:28px 0;color:var(--grey-500);">
      <div style="font-size:32px;margin-bottom:10px;">👋</div>
      <div style="font-weight:700;font-size:15px;margin-bottom:6px;">Nothing here yet</div>
      <div style="font-size:13px;">Be the first to post something for the team.</div>
    </div>`;
  } else {
    const sorted = [...visiblePosts].sort((a, b) => {
      const aReq = a.requiredReading && state.user && !state.myAcks.has(a.id) ? 1 : 0;
      const bReq = b.requiredReading && state.user && !state.myAcks.has(b.id) ? 1 : 0;
      if (aReq !== bReq) return bReq - aReq;
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    for (const post of sorted) {
      html += renderFeedPost(post);
    }

    if (state.feedHasMore && visiblePosts.length >= 50) {
      html += `<button class="btn" style="width:100%;margin-top:8px;" onclick="loadMoreFeed()">Load more</button>`;
    }
  }

  main.innerHTML = html;
  updateFeedBadge();
}

function renderFeedPost(post) {
  const isMe = state.user?.id === post.authorId;
  const liked = state.myLikes.has(post.id);
  const commentsOpen = state.expandedComments.has(post.id);
  const ago = timeAgo(post.createdAt);
  const canDelete = isMe || can.editRoster();
  const canEdit = isMe;
  const isRequired = !!post.requiredReading;
  const ackedByMe = state.myAcks.has(post.id);
  const acks = post._acks || [];

  // Scope tag
  let scopeTag = '';
  if (post.targetScope === 'network') scopeTag = `<span class="fp-tag" style="background:var(--red);">Network</span>`;
  else if (post.targetScope === 'group') scopeTag = `<span class="fp-tag" style="background:var(--black);">Group</span>`;
  else if (post.targetScope === 'role') scopeTag = `<span class="fp-tag" style="background:var(--grey-400);">${escapeHtml((post.targetIds||[]).join(', '))}</span>`;

  // Notice band
  let noticeBand = '';
  const nt = post.noticeType ? (NOTICE_TYPES[post.noticeType] || null) : null;
  if (nt) {
    const expired = post.expiresAt && post.expiresAt < isoDate(new Date());
    noticeBand = `<div style="display:flex;align-items:center;gap:6px;background:${nt.bg};border:1px solid ${nt.border};border-radius:var(--r-sm);padding:5px 10px;margin-bottom:8px;">
      <span>${nt.icon}</span>
      <span style="font-size:11px;font-weight:700;color:${nt.text};text-transform:uppercase;letter-spacing:.05em;">${nt.label} notice</span>
      ${post.expiresAt ? `<span style="font-size:10px;color:${nt.text};opacity:.65;margin-left:auto;">${expired ? 'Expired' : 'Expires'} ${post.expiresAt}</span>` : ''}
    </div>`;
  }

  // Required reading bar
  let requiredBar = '';
  if (isRequired) {
    if (state.user && !ackedByMe) {
      requiredBar = `<div class="fp-required">
        <span style="flex:1;font-size:12px;font-weight:700;">⚠ Required reading — please confirm you've read this</span>
        <button class="btn btn-primary btn-sm" onclick="acknowledgePost('${post.id}')">I've read this</button>
      </div>${can.editRoster() ? `<div onclick="openAckList('${post.id}')" style="cursor:pointer;font-size:11px;color:var(--grey-500);margin:-4px 0 10px;padding-left:2px;">${acks.length} read so far · tap for details ›</div>` : ''}`;
    } else {
      const count = acks.length;
      requiredBar = `<div class="fp-required acked" ${can.editRoster() ? `onclick="openAckList('${post.id}')" style="cursor:pointer;"` : ''}>
        <span style="font-size:12px;font-weight:700;color:var(--ok);">✓ ${state.user && ackedByMe ? "You've read this" : 'Required reading'}</span>
        ${can.editRoster() ? `<span style="font-size:11px;color:var(--grey-500);margin-left:auto;">${count} read · tap for details ›</span>` : ''}
      </div>`;
    }
  }

  // Attachments
  let attachmentsHtml = '';
  const media = post.mediaUrls || [];
  if (media.length > 0) {
    const images = media.filter(m => m && m.type === 'image');
    const files  = media.filter(m => m && m.type !== 'image');
    if (images.length > 0) {
      attachmentsHtml += `<div class="fp-img-grid cols-${Math.min(images.length, 2)}">` +
        images.map((m, i) => `<img src="${m.dataUrl}" alt="${escapeHtml(m.name||'')}" loading="lazy" onclick="openLightbox('${post.id}', ${i})">`).join('') + `</div>`;
    }
    for (const f of files) {
      attachmentsHtml += `<a class="fp-file-chip" download="${escapeHtml(f.name||'file')}" href="${f.dataUrl}">📄 <span>${escapeHtml(f.name||'attachment')}</span><span style="color:var(--grey-400);font-size:10px;">${fmtBytes(f.size)}</span></a>`;
    }
  }

  const bodyHtml = renderMentions(escapeHtml(post.body || ''));

  return `<div class="feed-post${isRequired && state.user && !ackedByMe ? ' required-unread' : ''}" id="fp-${post.id}">
    ${noticeBand}
    <div class="feed-post-header">
      ${feedAvatarHtml(post.authorId, post.authorName, 'feed-avatar')}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-weight:700;font-size:13px;">${escapeHtml(post.authorName)}</span>
          ${roleBadge(post.authorRole)}
          ${scopeTag}
          ${post.pinned ? '<span class="fp-tag" style="background:var(--gold);color:var(--black);">Pinned</span>' : ''}
        </div>
        <div style="font-size:11px;color:var(--grey-500);">${ago}${post.edited ? ' · edited' : ''}</div>
      </div>
      ${canDelete || canEdit ? `<button class="btn btn-sm" onclick="openPostMenu('${post.id}')" style="padding:4px 8px;flex-shrink:0;">⋯</button>` : ''}
    </div>
    ${post.body ? `<div class="feed-post-body">${bodyHtml}</div>` : ''}
    ${attachmentsHtml}
    ${requiredBar}
    <div class="feed-post-actions">
      <button class="feed-action-btn ${liked ? 'liked' : ''}" onclick="toggleFeedLike('${post.id}')">
        <span>${liked ? '❤️' : '🤍'}</span><span>${post.likeCount || 0}</span>
      </button>
      <button class="feed-action-btn" onclick="toggleComments('${post.id}')">
        <span>💬</span><span>${post.commentCount || 0} comment${post.commentCount === 1 ? '' : 's'}</span>
      </button>
    </div>
    ${commentsOpen ? renderCommentSection(post) : ''}
  </div>`;
}

function renderMentions(escapedText) {
  // Name-aware @mention highlighting. Longest names first so "Sensei Gus C"
  // wins over "Sensei Gus". Placeholder tokens prevent nested spans.
  const names = currentInstructors().map(i => i.name).sort((a, b) => b.length - a.length);
  const tokens = [];
  let out = escapedText;
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp('@' + esc, 'g'), () => {
      tokens.push(`<span class="fp-mention">@${name}</span>`);
      return '\u0000' + (tokens.length - 1) + '\u0000';
    });
  }
  // Fallback: single-word mentions not matching a known instructor
  out = out.replace(/@(\w+)/g, '<span class="fp-mention">@$1</span>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[+i]);
  return out;
}

function renderCommentSection(post) {
  const comments = post._comments || [];
  let html = `<div class="feed-comments-section" id="fcs-${post.id}">`;

  if (comments.length === 0) {
    html += `<div style="font-size:12px;color:var(--grey-500);padding:6px 0;">No comments yet.</div>`;
  } else {
    for (const c of comments) {
      const isMyComment = state.user?.id === c.authorId;
      html += `<div class="feed-comment" id="fc-${c.id}">
        ${feedAvatarHtml(c.authorId, c.authorName, 'feed-comment-avatar')}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:baseline;gap:6px;">
            <span style="font-weight:700;font-size:12px;">${escapeHtml(c.authorName)}</span>
            <span style="font-size:10px;color:var(--grey-400);">${timeAgo(c.createdAt)}</span>
          </div>
          <div style="font-size:13px;margin-top:2px;">${renderMentions(escapeHtml(c.body))}</div>
        </div>
        ${isMyComment ? `<button onclick="deleteComment('${c.id}','${post.id}')" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--grey-400);flex-shrink:0;padding:0 4px;">×</button>` : ''}
      </div>`;
    }
  }

  if (state.user) {
    html += `<div class="feed-comment-input">
      ${feedAvatarHtml(state.user.id, state.user.name, 'feed-comment-avatar')}
      <div style="flex:1;position:relative;">
        <input type="text" id="ci-${post.id}" placeholder="Add a comment… use @name to mention"
          onkeydown="if(event.key==='Enter')submitComment('${post.id}')"
          oninput="handleMentionInput(this)"
          style="width:100%;padding:8px 10px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:13px;font-family:inherit;">
        <div id="mention-dropdown-${post.id}" class="mention-dropdown" style="display:none;"></div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="submitComment('${post.id}')">Post</button>
    </div>`;
  }

  html += `</div>`;
  return html;
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return formatDateShort(new Date(isoStr));
}

// ---------- Feed actions ----------

function refreshFeedPost(postId, post) {
  const el = document.getElementById('fp-' + postId);
  if (!el) return;
  const temp = document.createElement('div');
  temp.innerHTML = renderFeedPost(post);
  const newEl = temp.firstElementChild;
  if (newEl) el.parentNode.replaceChild(newEl, el);
}

async function toggleFeedLike(postId) {
  if (!state.user) { openLogin(); return; }
  if (blockedByImpersonation()) return;
  const post = state.feed.find(p => p.id === postId);
  if (!post) return;
  const wasLiked = state.myLikes.has(postId);
  // Optimistic update
  if (wasLiked) { state.myLikes.delete(postId); post.likeCount = Math.max(0, (post.likeCount||0) - 1); }
  else          { state.myLikes.add(postId);    post.likeCount = (post.likeCount||0) + 1; }
  refreshFeedPost(postId, post);
  // Persist
  const newCount = await DB.toggleLike(postId, state.user.id, !wasLiked);
  if (newCount !== null) { post.likeCount = newCount; }
}

async function toggleComments(postId) {
  const post = state.feed.find(p => p.id === postId);
  if (!post) return;
  if (state.expandedComments.has(postId)) {
    state.expandedComments.delete(postId);
  } else {
    state.expandedComments.add(postId);
    // Load comments if not loaded yet
    if (!post._comments) {
      post._comments = await DB.loadComments(postId);
    }
  }
  refreshFeedPost(postId, post);
}

async function submitComment(postId) {
  if (!state.user) { openLogin(); return; }
  if (blockedByImpersonation()) return;
  const input = document.getElementById('ci-' + postId);
  if (!input) return;
  const body = input.value.trim();
  if (!body) return;
  const comment = {
    id:         'CMT-' + Date.now().toString(36).toUpperCase(),
    postId,
    authorId:   state.user.id,
    authorName: state.user.name,
    authorRole: state.user.role,
    body,
    createdAt:  new Date().toISOString(),
  };
  input.value = '';
  const post = state.feed.find(p => p.id === postId);
  if (post) {
    if (!post._comments) post._comments = [];
    post._comments.push(comment);
    post.commentCount = (post.commentCount || 0) + 1;
    refreshFeedPost(postId, post);
    // Focus new input
    setTimeout(() => {
      const newInput = document.getElementById('ci-' + postId);
      if (newInput) newInput.focus();
    }, 50);
  }
  await DB.saveComment(comment);
}

async function deleteComment(commentId, postId) {
  if (blockedByImpersonation()) return;
  if (!confirm('Delete this comment?')) return;
  const post = state.feed.find(p => p.id === postId);
  if (post?._comments) {
    post._comments = post._comments.filter(c => c.id !== commentId);
    post.commentCount = Math.max(0, (post.commentCount||0) - 1);
    refreshFeedPost(postId, post);
  }
  await DB.deleteComment(commentId, postId);
}

async function loadMoreFeed() {
  if (state.feedLoading || !state.feedHasMore) return;
  state.feedLoading = true;
  const oldest = state.feed[state.feed.length - 1]?.createdAt;
  const more = await DB.loadFeedPosts(state.schoolId, 50, oldest);
  state.feedLoading = false;
  if (more.length === 0) { state.feedHasMore = false; }
  else {
    state.feed.push(...more);
    if (state.user) {
      const ids = more.map(p => p.id);
      const newLikes = await DB.loadMyLikes(state.user.id, ids);
      newLikes.forEach(id => state.myLikes.add(id));
      const reqIds = more.filter(p => p.requiredReading).map(p => p.id);
      if (reqIds.length) {
        const ackMap = await DB.loadAcksForPosts(reqIds);
        for (const p of more) if (ackMap[p.id]) p._acks = ackMap[p.id];
        const newAcks = await DB.loadMyAcks(state.user.id, reqIds);
        newAcks.forEach(id => state.myAcks.add(id));
      }
    }
  }
  renderFeed();
}

// Post context menu
function openPostMenu(postId) {
  const post = state.feed.find(p => p.id === postId);
  if (!post) return;
  const isMe = state.user?.id === post.authorId;
  const canDel = isMe || can.editRoster();
  const canEd  = isMe;
  document.getElementById('actionSheetBody').innerHTML = `
    <h3>Post options</h3>
    ${canEd  ? `<div class="action-sheet-row" onclick="closeModal('modalActions');openPostEditor('${postId}')"><div class="icon">✎</div><div>Edit post</div></div>` : ''}
    ${canDel ? `<div class="action-sheet-row danger" onclick="closeModal('modalActions');deleteFeedPost('${postId}')"><div class="icon">×</div><div>Delete post</div></div>` : ''}
    <button class="btn btn-ghost" style="width:100%;margin-top:8px;" onclick="closeModal('modalActions')">Cancel</button>
  `;
  openModal('modalActions');
}

async function deleteFeedPost(postId) {
  if (blockedByImpersonation()) return;
  if (!confirm('Delete this post?')) return;
  state.feed = state.feed.filter(p => p.id !== postId);
  const el = document.getElementById('fp-' + postId);
  if (el) el.remove();
  await DB.deleteFeedPost(postId);
}

// ---------- @mention autocomplete ----------
let _mentionTimer = null;
function handleMentionInput(input) {
  clearTimeout(_mentionTimer);
  _mentionTimer = setTimeout(() => {
    const val = input.value;
    const atIdx = val.lastIndexOf('@');
    if (atIdx === -1) { hideMentionDropdown(input); return; }
    const query = val.slice(atIdx + 1).toLowerCase();
    if (query.length === 0) { hideMentionDropdown(input); return; }
    const matches = currentInstructors().filter(i =>
      i.name.toLowerCase().includes(query)
    ).slice(0, 5);
    const postId = input.id.replace('ci-', '');
    const dd = document.getElementById('mention-dropdown-' + postId)
            || document.getElementById('mention-dropdown-composer');
    if (!dd) return;
    if (matches.length === 0) { dd.style.display = 'none'; return; }
    dd.innerHTML = matches.map(i =>
      `<div class="mention-option" onclick="insertMention('${input.id}','${i.name}')">${escapeHtml(i.name)} ${roleBadge(i.role)}</div>`
    ).join('');
    dd.style.display = 'block';
  }, 150);
}

function hideMentionDropdown(input) {
  const postId = input.id.replace('ci-', '');
  const dd = document.getElementById('mention-dropdown-' + postId)
          || document.getElementById('mention-dropdown-composer');
  if (dd) dd.style.display = 'none';
}

function insertMention(inputId, name) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const val = input.value;
  const atIdx = val.lastIndexOf('@');
  input.value = val.slice(0, atIdx) + '@' + name + ' ';
  input.focus();
  const postId = inputId.replace('ci-', '');
  const dd = document.getElementById('mention-dropdown-' + postId)
          || document.getElementById('mention-dropdown-composer');
  if (dd) dd.style.display = 'none';
}

// ---------- Post composer ----------
let _pendingAttachments = [];

function openPostComposer(editPostId, opts) {
  if (!state.user) { openLogin(); return; }
  opts = opts || {};
  state.editingPostId = editPostId || null;
  const existing = editPostId ? state.feed.find(p => p.id === editPostId) : null;

  document.getElementById('composerTitle').textContent = existing ? 'Edit post' : (opts.notice ? 'New notice' : 'New post');
  document.getElementById('composerBody').value = existing?.body || '';

  // Rebuild scope options from scratch (hiding <option> is unreliable on mobile)
  const scopeSel = document.getElementById('composerScope');
  const scopes = [
    { v: 'school', label: 'Everyone at this school' },
    { v: 'group',  label: 'Specific group' },
    { v: 'role',   label: 'Specific role' },
    { v: 'users',  label: 'Specific people' },
  ];
  if (can.switchAnySchool()) scopes.push({ v: 'network', label: 'All schools (network)' });
  scopeSel.innerHTML = scopes.map(s => `<option value="${s.v}">${s.label}</option>`).join('');
  const wantScope = existing?.targetScope || (opts.network ? 'network' : 'school');
  scopeSel.value = scopes.find(s => s.v === wantScope) ? wantScope : 'school';
  composerUpdateTargetUI();

  // Pre-select targets when editing a group/role/users post
  if (existing && (existing.targetScope === 'group' || existing.targetScope === 'role' || existing.targetScope === 'users')) {
    setTimeout(() => {
      const modal = document.getElementById('modalPostComposer');
      modal.querySelectorAll('.composer-target-check').forEach(cb => {
        cb.checked = (existing.targetIds || []).includes(cb.value);
      });
    }, 0);
  }

  // Notice options (notice type / required / expiry / pin) — gated by the notices
  // permission, so custom roles granted notices/add can post notices too.
  const noticeBlock = document.getElementById('composerNoticeBlock');
  const canNotice = can.manageNotices();
  noticeBlock.style.display = canNotice ? 'block' : 'none';
  if (canNotice) {
    document.getElementById('composerNoticeType').value = existing?.noticeType || (opts.notice ? 'info' : '');
    document.getElementById('composerRequired').checked = existing?.requiredReading || false;
    document.getElementById('composerExpires').value = existing?.expiresAt || '';
    document.getElementById('composerPinned').checked = existing?.pinned || false;
  }

  // Attachments
  _pendingAttachments = existing?.mediaUrls ? JSON.parse(JSON.stringify(existing.mediaUrls)) : [];
  document.getElementById('composerFileInput').value = '';
  renderComposerAttachments();

  openModal('modalPostComposer');
  setTimeout(() => document.getElementById('composerBody').focus(), 100);
}

function openPostEditor(postId) { openPostComposer(postId); }

function composerUpdateTargetUI() {
  const scope = document.getElementById('composerScope').value;
  const targetsRow = document.getElementById('composerTargetsRow');
  targetsRow.style.display = (scope === 'group' || scope === 'role' || scope === 'users') ? 'block' : 'none';
  if (scope === 'group') {
    targetsRow.innerHTML = `<label>Groups</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
        ${state.groups.map(g => `<label style="display:flex;align-items:center;gap:4px;font-size:12px;">
          <input type="checkbox" class="composer-target-check" value="${g.id}"> ${escapeHtml(g.name)}
        </label>`).join('') || '<span style="font-size:12px;color:var(--grey-500);">No groups set up yet</span>'}
      </div>`;
  } else if (scope === 'role') {
    // List every defined role (builtins + custom) so authors can target custom roles;
    // the RLS matches the post's target_ids against the viewer's current_app_role().
    const roleOpts = ((state.roleConfig && state.roleConfig.roles && state.roleConfig.roles.length)
      ? state.roleConfig.roles.map(r => ({ key: r.key, label: r.label }))
      : [{ key:'superadmin', label:'Superadmin' }, { key:'admin', label:'Admin' },
         { key:'instructor', label:'Instructor' }, { key:'junior', label:'Junior' }]);
    targetsRow.innerHTML = `<label>Roles</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
        ${roleOpts.map(r => `<label style="display:flex;align-items:center;gap:4px;font-size:12px;">
          <input type="checkbox" class="composer-target-check" value="${escapeHtml(r.key)}"> ${escapeHtml(r.label)}
        </label>`).join('')}
      </div>`;
  } else if (scope === 'users') {
    const people = allInstructors();
    targetsRow.innerHTML = `<label>People</label>
      <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px;max-height:160px;overflow:auto;">
        ${people.map(i => `<label style="display:flex;align-items:center;gap:6px;font-size:12px;">
          <input type="checkbox" class="composer-target-check" value="${i.uid || i.id}"> ${escapeHtml(i.name)} <span style="color:var(--grey-400);">${escapeHtml(i.role || '')}</span>${i.uid ? '' : ' <span style="color:var(--grey-400);font-size:10px;">(no login yet)</span>'}
        </label>`).join('') || '<span style="font-size:12px;color:var(--grey-500);">No people set up yet</span>'}
      </div>`;
  }
}

async function submitPost() {
  if (!state.user) return;
  if (blockedByImpersonation()) return;
  const body = document.getElementById('composerBody').value.trim();
  if (!body && _pendingAttachments.length === 0) { alert('Write something or attach a file first.'); return; }
  const scope = document.getElementById('composerScope').value;
  const composerModal = document.getElementById('modalPostComposer');
  const targetIds = (scope === 'group' || scope === 'role' || scope === 'users')
    ? [...composerModal.querySelectorAll('.composer-target-check:checked')].map(el => el.value)
    : [];
  if ((scope === 'group' || scope === 'role' || scope === 'users') && targetIds.length === 0) {
    alert('Pick at least one ' + (scope === 'group' ? 'group' : scope === 'users' ? 'person' : 'role') + '.');
    return;
  }

  const canNotice = can.manageNotices();
  const noticeType = canNotice ? (document.getElementById('composerNoticeType').value || null) : null;
  const requiredReading = canNotice ? document.getElementById('composerRequired').checked : false;
  const expiresAt = canNotice ? (document.getElementById('composerExpires').value || null) : null;
  const pinned = canNotice ? document.getElementById('composerPinned').checked : false;

  const existing = state.editingPostId ? state.feed.find(p => p.id === state.editingPostId) : null;
  const post = {
    id:           existing?.id || ('POST-' + Date.now().toString(36).toUpperCase()),
    schoolId:     scope === 'network' ? null : state.schoolId,
    authorId:     state.user.id,
    authorName:   state.user.name,
    authorRole:   state.user.role,
    body,
    mediaUrls:    _pendingAttachments,
    targetScope:  scope,
    targetIds,
    noticeType,
    requiredReading,
    expiresAt,
    pinned,
    likeCount:    existing?.likeCount || 0,
    commentCount: existing?.commentCount || 0,
    edited:       !!existing,
    createdAt:    existing?.createdAt || new Date().toISOString(),
    _comments:    existing?._comments,
    _acks:        existing?._acks,
  };

  if (existing) {
    const idx = state.feed.findIndex(p => p.id === post.id);
    if (idx !== -1) state.feed[idx] = post;
  } else {
    state.feed.unshift(post);
  }

  const _attachmentsForRetry = _pendingAttachments;
  closeModal('modalPostComposer');
  renderFeed();
  renderNoticeBanners();

  const saveRes = await DB.saveFeedPost(post);
  if (saveRes !== true) {
    // The DB write failed (offline, or a schema/permission error). Roll the optimistic
    // change back so the feed shows only what actually saved, restore the composer so
    // nothing the user wrote is lost, and tell them — never silently drop a post.
    if (existing) {
      const idx = state.feed.findIndex(p => p.id === post.id);
      if (idx !== -1) state.feed[idx] = existing;
    } else {
      state.feed = state.feed.filter(p => p.id !== post.id);
    }
    renderFeed();
    renderNoticeBanners();
    _pendingAttachments = _attachmentsForRetry;
    const bodyEl = document.getElementById('composerBody');
    if (bodyEl) bodyEl.value = body;
    openModal('modalPostComposer');
    alert('Your post could not be saved' + ((saveRes && saveRes.error) ? (':\n' + saveRes.error) : '.') +
          '\n\nNothing was lost — your draft is still in the composer. Please try again.');
    return;
  }

  _pendingAttachments = [];
  state.editingPostId = null;

  // Push notification for new required-reading posts and notices (best-effort,
  // fire-and-forget). Targets the same audience the post is visible to.
  if (!existing && (post.requiredReading || post.noticeType)) {
    try {
      const audience = resolveTargetAudience(post); // Set of user ids, or null = everyone
      const targetUserIds = audience ? [...audience].filter(id => id !== post.authorId) : null;
      if (!(audience && targetUserIds.length === 0)) { // skip if precise audience is empty
        DB.sendPushNotification({
          title: post.requiredReading ? '📢 Required reading' : '📣 New notice',
          body: (post.body || '').slice(0, 140) || 'Open KRMAS to read.',
          tag: 'krmas-post-' + post.id,
          url: './',
          schoolId: post.schoolId || null,
          targetUserIds,
          excludeUserId: post.authorId,
        });
      }
    } catch (e) { /* push is best-effort */ }
  }
}

// ---------- Realtime feed subscription ----------
function startRealtimeFeed() {
  if (!DB.isSupabase) return;
  if (state.realtimeChannel) DB.unsubscribe(state.realtimeChannel);
  state.realtimeChannel = DB.subscribeFeed(state.schoolId, (type, payload) => {
    if (type === 'post' && payload.eventType === 'INSERT') {
      const norm = {
        id:           payload.new.id,
        schoolId:     payload.new.school_id,
        authorId:     payload.new.author_id,
        authorName:   payload.new.author_name,
        authorRole:   payload.new.author_role,
        body:         payload.new.body,
        mediaUrls:    payload.new.media_urls || [],
        targetScope:  payload.new.target_scope,
        targetIds:    payload.new.target_ids || [],
        likeCount:    payload.new.like_count || 0,
        commentCount: payload.new.comment_count || 0,
        noticeType:      payload.new.notice_type || null,
        requiredReading: payload.new.required_reading || false,
        expiresAt:       payload.new.expires_at || null,
        pinned:       payload.new.pinned || false,
        edited:       false,
        createdAt:    payload.new.created_at,
      };
      // Don't add our own posts (we've already added them optimistically)
      if (norm.authorId !== state.user?.id && !state.feed.find(p => p.id === norm.id)) {
        state.feed.unshift(norm);
        if (state.view === 'feed') renderFeed();
      }
    } else if (type === 'like') {
      if (payload.eventType === 'INSERT') {
        const post = state.feed.find(p => p.id === payload.new.post_id);
        if (post && payload.new.user_id !== state.user?.id) {
          post.likeCount = (post.likeCount || 0) + 1;
          if (state.view === 'feed') refreshFeedPost(post.id, post);
        }
      } else if (payload.eventType === 'DELETE') {
        const post = state.feed.find(p => p.id === payload.old?.post_id);
        if (post && payload.old?.user_id !== state.user?.id) {
          post.likeCount = Math.max(0, (post.likeCount || 0) - 1);
          if (state.view === 'feed') refreshFeedPost(post.id, post);
        }
      }
    } else if (type === 'comment') {
      const pid = payload.new?.post_id || payload.old?.post_id;
      const post = state.feed.find(p => p.id === pid);
      if (!post) return;
      if (payload.eventType === 'INSERT' && payload.new.author_id !== state.user?.id) {
        if (post._comments && !post._comments.find(c => c.id === payload.new.id)) {
          post._comments.push({
            id:         payload.new.id,
            postId:     pid,
            authorId:   payload.new.author_id,
            authorName: payload.new.author_name,
            authorRole: payload.new.author_role,
            body:       payload.new.body,
            edited:     payload.new.edited || false,
            createdAt:  payload.new.created_at,
          });
        }
        post.commentCount = (post.commentCount || 0) + 1;
        if (state.view === 'feed') refreshFeedPost(pid, post);
      } else if (payload.eventType === 'DELETE' && post._comments) {
        const before = post._comments.length;
        post._comments = post._comments.filter(c => c.id !== payload.old?.id);
        if (post._comments.length !== before) {
          // Only adjust when we actually removed one (own deletes were already applied optimistically)
          post.commentCount = Math.max(0, (post.commentCount || 0) - 1);
          if (state.view === 'feed') refreshFeedPost(pid, post);
        }
      }
    }
  });
}

// ---------- Groups admin ----------
function openGroupsAdmin() {
  // Any groups management permission opens the manager; per-action buttons inside are
  // gated individually. Matches the groups RLS (network scope stays superadmin-only).
  if (!can.manageGroups() && !can.editGroups() && !can.deleteGroups()) {
    alert('You don\'t have permission to manage groups.'); return;
  }
  renderGroupsAdminModal();
  openModal('modalGroupsAdmin');
}

function renderGroupsAdminModal() {
  const body = document.getElementById('groupsAdminBody');
  if (!body) return;
  if (state.groups.length === 0) {
    body.innerHTML = `<div style="font-size:13px;color:var(--grey-500);padding:8px 0;">No groups yet.</div>`;
  } else {
    body.innerHTML = state.groups.map(g => {
      const members = resolveGroupMembers(g);
      return `<div style="background:var(--white);border:1px solid var(--grey-200);border-radius:var(--r-md);padding:12px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;">${escapeHtml(g.name)}</div>
            ${g.description ? `<div style="font-size:11px;color:var(--grey-500);">${escapeHtml(g.description)}</div>` : ''}
            <div style="font-size:11px;margin-top:4px;">
              ${g.rules?.length ? `<span style="color:var(--ok);font-weight:700;">${g.rules.length} rule${g.rules.length>1?'s':''}</span> · ` : ''}
              <span>${members.length} member${members.length!==1?'s':''}</span>
              ${g.school_id === null ? ' · <span style="color:var(--red);font-size:10px;font-weight:700;">NETWORK</span>' : ''}
            </div>
          </div>
          ${((g.school_id === null) ? can.switchAnySchool() : can.editGroups()) ? `<button class="btn btn-sm" onclick="openGroupEditor('${g.id}')">Edit</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }
}

function openGroupEditor(groupId) {
  const existing = groupId ? state.groups.find(g => g.id === groupId) : null;
  // Network groups (school_id null) → superadmin; school groups → groups add/edit perm.
  const allowed = groupId
    ? ((existing && existing.school_id === null) ? can.switchAnySchool() : can.editGroups())
    : can.manageGroups();
  if (!allowed) { alert("You don't have permission to do that."); return; }
  state.editingGroupId = groupId || null;
  _editingRules = existing?.rules ? JSON.parse(JSON.stringify(existing.rules)) : [];
  // Load STATIC picks only (source 'static'), normalising each to the instructor's uid so
  // that saving writes uids (which the feed RLS matches). Legacy slug rows map through the pool.
  const isNet = !!(existing && existing.school_id === null);
  const pool = isNet ? allInstructorsAllSchools()
    : allInstructors().map(i => ({ ...i, schoolId: existing?.school_id || state.schoolId }));
  _editingStaticMembers = ((existing && existing.members) || [])
    .filter(m => (m.source || 'static') === 'static')
    .map(m => {
      const mid = m.user_id || m.userId, sch = m.school_id || m.schoolId;
      const instr = pool.find(i => i.id === mid || i.uid === mid);
      return { user_id: (instr && instr.uid) || mid, school_id: (instr && instr.schoolId) || sch || state.schoolId };
    });
  document.getElementById('groupEditorTitle').textContent = existing ? 'Edit group' : 'New group';
  document.getElementById('groupName').value = existing?.name || '';
  document.getElementById('groupDesc').value = existing?.description || '';
  document.getElementById('groupIsNetwork').checked = existing?.school_id === null;
  // Hide network option for non-superadmins
  document.getElementById('groupIsNetwork').closest('label').style.display = can.switchAnySchool() ? '' : 'none';
  // Toggling network scope swaps the member pool between this school and all schools.
  document.getElementById('groupIsNetwork').onchange = () => renderGroupStaticMembers(_editingStaticMembers);
  const canDel = existing && ((existing.school_id === null) ? can.switchAnySchool() : can.deleteGroups());
  document.getElementById('groupDeleteBtn').style.display = canDel ? 'block' : 'none';
  renderGroupRules(_editingRules);
  renderGroupStaticMembers(_editingStaticMembers);
  openModal('modalGroupEditor');
}

function groupRuleValueOptions(field, selected) {
  let opts = [];
  if (field === 'role') {
    opts = ((state.roleConfig && state.roleConfig.roles && state.roleConfig.roles.length)
      ? state.roleConfig.roles.map(r => [r.key, r.label])
      : [['superadmin','Superadmin'],['admin','Admin'],['instructor','Instructor'],['junior','Junior']]);
  } else if (field === 'state') {
    opts = [...new Set(KRMAS_SCHOOLS.map(s => s.state).filter(Boolean))].sort().map(s => [s, s]);
  } else if (field === 'school') {
    opts = KRMAS_SCHOOLS.map(s => [s.id, s.name]);
  } else if (field === 'syllabus') {
    opts = Object.entries(GRADING_SYLLABI).map(([k, v]) => [k, v.label || v.name || k]);
  }
  let html = `<option value=""${!selected ? ' selected' : ''}>— choose —</option>`;
  html += opts.map(([val, lbl]) => `<option value="${escapeHtml(val)}"${String(selected) === String(val) ? ' selected' : ''}>${escapeHtml(lbl)}</option>`).join('');
  return html;
}

function renderGroupRules(rules) {
  const container = document.getElementById('groupRulesContainer');
  if (!container) return;
  container.innerHTML = rules.map((r, i) => {
    const isSyllabus = r.field === 'syllabus';
    return `
    <div style="display:grid;grid-template-columns:1fr 80px 1fr auto;gap:6px;margin-bottom:6px;align-items:center;">
      <select onchange="groupRuleUpdate(${i},'field',this.value)" style="padding:5px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:12px;">
        ${[['role','Role'],['state','State'],['school','School'],['syllabus','Syllabus']].map(([f,lbl]) => `<option value="${f}"${r.field===f?' selected':''}>${lbl}</option>`).join('')}
      </select>
      <select onchange="groupRuleUpdate(${i},'op',this.value)" style="padding:5px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:12px;">
        ${isSyllabus
          ? `<option value="in"${r.op==='in'?' selected':''}>has</option>`
          : `<option value="eq"${r.op==='eq'?' selected':''}>is</option><option value="neq"${r.op==='neq'?' selected':''}>is not</option>`}
      </select>
      <select onchange="groupRuleUpdate(${i},'value',this.value)" style="padding:5px 8px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:12px;">
        ${groupRuleValueOptions(r.field, r.value)}
      </select>
      <button onclick="groupRuleRemove(${i})" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--grey-400);">×</button>
    </div>`;
  }).join('');
}

// Temp storage for rules being edited
let _editingRules = [];
let _editingStaticMembers = [];

function openGroupEditorReset() {
  _editingRules = [];
  _editingStaticMembers = [];
}

function groupRuleAdd() {
  _editingRules.push({ field: 'role', op: 'eq', value: '' });
  renderGroupRules(_editingRules);
}

function groupRuleUpdate(idx, field, value) {
  if (!_editingRules[idx]) return;
  _editingRules[idx][field] = value;
  if (field === 'field') {
    // Switching field resets value + picks the right operator (syllabus → "in")
    _editingRules[idx].value = '';
    _editingRules[idx].op = value === 'syllabus' ? 'in' : 'eq';
    renderGroupRules(_editingRules);
  }
}

function groupRuleRemove(idx) {
  _editingRules.splice(idx, 1);
  renderGroupRules(_editingRules);
}

function renderGroupStaticMembers(members) {
  _editingStaticMembers = [...members];
  const container = document.getElementById('groupMembersContainer');
  if (!container) return;
  const isMember = i => _editingStaticMembers.some(m => {
    const mid = m.user_id || m.userId;
    return (mid === (i.uid || i.id) || mid === i.id) && ((m.school_id || m.schoolId || state.schoolId) === i.schoolId);
  });
  const netToggle = document.getElementById('groupIsNetwork');
  const isNetwork = !!(netToggle && netToggle.checked && can.switchAnySchool());

  const row = (i, withSchool) => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;cursor:pointer;">
      <input type="checkbox" ${isMember(i) ? 'checked' : ''} onchange="groupMemberToggle('${i.uid || i.id}',this.checked,'${i.schoolId}')" style="width:16px;height:16px;accent-color:var(--red);">
      ${escapeHtml(i.name)} ${roleBadge(i.role)}${withSchool ? ` <span style="font-size:10px;color:var(--grey-500);">· ${escapeHtml(i.schoolName)}</span>` : ''}
    </label>`;

  let html = `<div style="font-size:11px;color:var(--grey-500);margin-bottom:6px;">Static members (always in this group regardless of rules):</div>`;
  if (isNetwork) {
    const all = allInstructorsAllSchools();
    const bySchool = {};
    for (const i of all) (bySchool[i.schoolName] = bySchool[i.schoolName] || []).push(i);
    for (const sname of Object.keys(bySchool).sort()) {
      html += `<div style="font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--grey-500);margin:8px 0 2px;">${escapeHtml(sname)}</div>`;
      html += bySchool[sname].map(i => row(i, false)).join('');
    }
  } else {
    const instrs = allInstructors().map(i => ({ ...i, schoolId: state.schoolId }));
    html += instrs.map(i => row(i, false)).join('');
  }
  container.innerHTML = html;
}

function groupMemberToggle(userId, checked, schoolId) {
  schoolId = schoolId || state.schoolId;
  const matches = m => (m.user_id || m.userId) === userId && (m.school_id || m.schoolId || state.schoolId) === schoolId;
  if (checked) {
    if (!_editingStaticMembers.find(matches)) _editingStaticMembers.push({ user_id: userId, school_id: schoolId });
  } else {
    _editingStaticMembers = _editingStaticMembers.filter(m => !matches(m));
  }
}

// Compute a group's full membership (static picks + rule-matched instructors) and write it
// to group_members as UID rows. The feed RLS only sees group_members, and rules reference
// attributes (state/syllabus) that don't exist server-side — so the client materialises here.
// staticPicks: [{user_id, school_id}] (uid preferred; legacy slugs are mapped through the pool).
async function materializeGroupMembership(group, staticPicks) {
  if (!DB.isSupabase) return false;
  const pool = (group.school_id === null)
    ? allInstructorsAllSchools()
    : allInstructors().map(i => ({ ...i, schoolId: group.school_id || state.schoolId }));
  const staticRows = (staticPicks || []).map(m => {
    const mid = m.user_id || m.userId, sch = m.school_id || m.schoolId;
    const instr = pool.find(i => i.id === mid || i.uid === mid);
    return { user_id: (instr && instr.uid) || mid, school_id: (instr && instr.schoolId) || sch || state.schoolId, source: 'static', added_by: state.user?.name || 'system' };
  });
  const staticUids = new Set(staticRows.map(r => r.user_id));
  const ruleRows = (group.rules && group.rules.length ? pool.filter(i => instrMatchesRules(i, group.rules)) : [])
    .filter(i => i.uid && !staticUids.has(i.uid))           // don't duplicate a static pick
    .map(i => ({ user_id: i.uid, school_id: i.schoolId, source: 'rule', added_by: state.user?.name || 'system' }));
  return DB.syncGroupMembers(group.id, [...staticRows, ...ruleRows]);
}

// Re-materialise every loaded group. Used as the one-time migration (converts legacy slug
// rows → uids and writes rule members) and whenever an instructor's role/school changes.
async function resyncAllGroups() {
  if (!DB.isSupabase) return 0;
  let ok = 0;
  for (const group of state.groups) {
    const staticPicks = (group.members || []).filter(m => (m.source || 'static') === 'static');
    if (await materializeGroupMembership(group, staticPicks)) ok++;
  }
  return ok;
}

// Manual trigger (Admin → Groups): runs the one-time migration + a safety re-sync.
async function resyncGroupsManual() {
  if (blockedByImpersonation()) return;
  if (!can.manageGroups() && !can.editGroups() && !can.deleteGroups()) { alert('Admin access required.'); return; }
  const n = await resyncAllGroups();
  alert('Re-synced ' + n + ' group' + (n === 1 ? '' : 's') + '. Group-targeted posts will now reach the right people.');
}

async function saveGroup() {
  if (blockedByImpersonation()) return;
  const name = document.getElementById('groupName').value.trim();
  if (!name) { alert('Enter a group name.'); return; }
  const isNetwork = document.getElementById('groupIsNetwork').checked && can.switchAnySchool();
  // Network groups → superadmin; school groups → groups edit (existing) or add (new).
  const allowed = isNetwork ? can.switchAnySchool()
    : (state.editingGroupId ? can.editGroups() : can.manageGroups());
  if (!allowed) { alert("You don't have permission to do that."); return; }
  const id = state.editingGroupId || ('GRP-' + Date.now().toString(36).toUpperCase());
  const existing = state.editingGroupId ? state.groups.find(g => g.id === id) : null;

  // Read rules from _editingRules (populated by rule UI interactions)
  const group = {
    id,
    school_id:   isNetwork ? null : state.schoolId,
    name,
    description: document.getElementById('groupDesc').value.trim(),
    rules:       _editingRules.filter(r => r.value.trim()),
    members:     _editingStaticMembers,
    created_by:  state.user?.name,
    created_at:  existing?.created_at || new Date().toISOString(),
    updated_at:  new Date().toISOString(),
  };

  const idx = state.groups.findIndex(g => g.id === id);
  if (idx !== -1) state.groups[idx] = group;
  else state.groups.push(group);

  await DB.saveGroup(group);
  // Materialise the full membership (static picks + rule matches) into group_members as
  // UIDs, so group-targeted feed posts reach everyone the RLS can see.
  await materializeGroupMembership(group, _editingStaticMembers);

  closeModal('modalGroupEditor');
  renderGroupsAdminModal();
}

async function deleteGroup() {
  if (blockedByImpersonation()) return;
  const id = state.editingGroupId;
  if (!id) return;
  const g = state.groups.find(g => g.id === id);
  const allowed = g && ((g.school_id === null) ? can.switchAnySchool() : can.deleteGroups());
  if (!allowed) { alert("You don't have permission to delete this group."); return; }
  if (!confirm(`Delete group "${g?.name || id}"?`)) return;
  state.groups = state.groups.filter(g => g.id !== id);
  await DB.deleteGroup(id);
  closeModal('modalGroupEditor');
  renderGroupsAdminModal();
}

// ---------- Class assignments ----------
function openClassAssignments() {
  if (!requireRole('admin')) return;
  renderClassAssignmentsModal();
  openModal('modalClassAssignments');
}

function renderClassAssignmentsModal() {
  const body = document.getElementById('classAssignmentsBody');
  if (!body) return;
  const schedule = currentSchedule();
  if (schedule.length === 0) {
    body.innerHTML = `<div style="font-size:13px;color:var(--grey-500);">No schedule configured for this school.</div>`;
    return;
  }

  const instrs = currentInstructors();
  const instrOpts = `<option value="">— Unassigned —</option>` +
    instrs.map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');

  // Group by day
  const byDay = {};
  for (const c of schedule) {
    if (!byDay[c.day]) byDay[c.day] = [];
    byDay[c.day].push(c);
  }

  let html = '';
  for (const [dow, classes] of Object.entries(byDay).sort((a,b) => a[0]-b[0])) {
    html += `<div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--grey-500);padding:8px 0 4px;">${DAY_NAMES[dow]}</div>`;
    for (const c of classes.sort((a,b) => a.start.localeCompare(b.start))) {
      const slotKey = `${c.day}-${c.start}-${c.type}`;
      const meta = CLASS_TYPES[c.type] || {};
      const getAssigned = (role) => (state.classAssignments.find(a => a.slot_key === slotKey && a.role === role)?.instructor_id || '');

      html += `<div style="background:var(--white);border:1px solid var(--grey-200);border-left:3px solid var(${meta.colour||'--grey-300'});border-radius:var(--r-md);padding:10px 12px;margin-bottom:6px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:8px;">${c.start}–${c.end} · ${escapeHtml(meta.name||c.type)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          ${['lead','assist','junior','backup'].map(role => `
            <div>
              <div style="font-size:10px;font-weight:700;color:var(--grey-500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">${role}</div>
              <select onchange="saveClassAssignment('${slotKey}','${role}',this.value)"
                style="width:100%;padding:5px 6px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:12px;">
                ${instrs.map(i => `<option value="${i.id}"${i.id === getAssigned(role) ? ' selected' : ''}>${escapeHtml(i.name)}</option>`).join('')}
              <option value=""${!getAssigned(role) ? ' selected' : ''}>— Unassigned —</option>
              </select>
            </div>`).join('')}
        </div>
      </div>`;
    }
  }
  body.innerHTML = html;
}

async function saveClassAssignment(slotKey, role, instructorId) {
  // Update local state
  const idx = state.classAssignments.findIndex(a => a.slot_key === slotKey && a.role === role);
  if (instructorId) {
    const row = { school_id: state.schoolId, slot_key: slotKey, instructor_id: instructorId, role };
    if (idx !== -1) state.classAssignments[idx] = row;
    else state.classAssignments.push(row);
    await DB.saveClassAssignment(state.schoolId, slotKey, instructorId, role);
  } else {
    if (idx !== -1) state.classAssignments.splice(idx, 1);
    await DB.deleteClassAssignment(state.schoolId, slotKey, role);
  }
  // Apply to defaults so roster picks it up
  applyClassAssignmentsToDefaults();
}

function applyClassAssignmentsToDefaults() {
  // Merge classAssignments into the school's defaults so rosterForDay uses them
  if (!state.customSchools[state.schoolId]) {
    state.customSchools[state.schoolId] = {
      instructors: currentInstructors(),
      schedule: [],
      defaults: {},
      contact: {}
    };
  }
  const defaults = state.customSchools[state.schoolId].defaults || {};
  for (const a of state.classAssignments) {
    // slot_key format: "{dow}-{HH:MM}-{type-may-have-dashes}"
    // e.g. "1-16:00-little-ninjas"
    const m = a.slot_key.match(/^(\d+)-(\d{1,2}:\d{2})-(.+)$/);
    if (!m) continue;
    const dow = m[1], start = m[2], type = m[3];
    const key = `${dow}-${start}-${type}`;
    if (!defaults[key]) defaults[key] = { lead: null, assist: null, junior: null, backup: null };
    defaults[key][a.role] = a.instructor_id;
  }
  state.customSchools[state.schoolId].defaults = defaults;
  saveCustomSchools();
}

// ---------- Admin Panel ----------
// ---------- Bulk User Import ----------
function openBulkImport() {
  if (!requireRole('admin')) return;
  document.getElementById('bulkImportStatus').textContent = '';
  document.getElementById('bulkImportPreview').innerHTML = '';
  document.getElementById('bulkImportFile').value = '';
  const hint = document.getElementById('bulkImportRoleHint');
  if (hint) {
    const custom = ((state.roleConfig && state.roleConfig.roles) || []).filter(r => !r.builtin).map(r => r.key);
    hint.innerHTML = custom.length
      ? `<strong>Your custom roles:</strong> ${custom.map(escapeHtml).join(', ')}<br>`
      : '';
  }
  openModal('modalBulkImport');
}

function downloadImportTemplate() {
  // CSV template
  const headers = ['name','role','pin','status','email'];
  const examples = [
    ['Sensei John Smith','instructor','1234','active','john@example.com'],
    ['Senpai Jane Doe','junior','0000','active','jane@example.com'],
    ['Sensei Bob Admin','admin','5678','active','bob@example.com'],
  ];
  const csv = [headers, ...examples].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'KRMAS_Instructor_Import_Template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleBulkImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const status = document.getElementById('bulkImportStatus');
  status.textContent = 'Reading file…';

  if (ext === 'csv' || ext === 'txt') {
    const reader = new FileReader();
    reader.onload = e => parseBulkCSV(e.target.result);
    reader.readAsText(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    const reader = new FileReader();
    reader.onload = e => parseBulkXLSX(e.target.result);
    reader.readAsArrayBuffer(file);
  } else {
    status.textContent = 'Unsupported file type. Use CSV or XLSX.';
  }
}

// Proper RFC-4180-style CSV parser: handles quoted fields, embedded commas and
// newlines, escaped "" quotes, a leading UTF-8 BOM, and CRLF/CR line endings.
// Returns an array of row arrays.
function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');          // strip BOM (Excel exports)
  const rows = [];
  let row = [], field = '', inQuotes = false, i = 0;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }  // escaped quote
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { endField(); i++; continue; }
    if (c === '\r') { i++; continue; }                  // ignore CR (CRLF handled by the \n)
    if (c === '\n') { endRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) endRow();             // flush trailing field/row
  return rows;
}

function parseBulkCSV(text) {
  // Drop fully-blank rows (e.g. trailing newline), keep everything else intact.
  const matrix = parseCSV(text).filter(r => r.some(c => String(c).trim() !== ''));
  if (matrix.length < 2) {
    document.getElementById('bulkImportStatus').textContent = 'File appears empty or has no data rows.';
    return;
  }
  const headers = matrix[0].map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
  const rows = matrix.slice(1).map(vals => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = (vals[i] != null ? String(vals[i]).trim() : ''));
    return obj;
  }).filter(r => r.name);
  previewBulkImport(rows);
}

function parseBulkXLSX(buffer) {
  // Use SheetJS if available, otherwise show error
  if (typeof XLSX === 'undefined') {
    document.getElementById('bulkImportStatus').textContent = 'XLSX parsing requires the SheetJS library. Please use CSV format instead.';
    return;
  }
  try {
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    // Normalise keys
    const norm = rows.map(r => {
      const o = {};
      for (const [k,v] of Object.entries(r)) o[k.toLowerCase().trim().replace(/\s+/g,'')] = String(v).trim();
      return o;
    }).filter(r => r.name);
    previewBulkImport(norm);
  } catch(e) {
    document.getElementById('bulkImportStatus').textContent = 'Failed to parse XLSX: ' + e.message;
  }
}

function previewBulkImport(rows) {
  const status = document.getElementById('bulkImportStatus');
  const preview = document.getElementById('bulkImportPreview');

  // Validate and normalise each row
  const isSuperAdmin = can.switchAnySchool();
  // Valid assignable roles = the builtins plus any custom roles the superadmin defined.
  const validRoles = new Set(['superadmin', 'admin', 'instructor', 'junior']
    .concat(((state.roleConfig && state.roleConfig.roles) || []).map(r => r.key)));
  const results = rows.map((r, i) => {
    const name = r.name?.trim();
    let role = (r.role?.toLowerCase() || 'instructor');
    // Admins (non-superadmin) can only import roles below admin.
    if (!isSuperAdmin && ['superadmin', 'admin'].includes(role)) role = 'instructor';
    if (!validRoles.has(role)) role = 'instructor';
    const pin  = /^\d{4}$/.test(r.pin?.trim()) ? r.pin.trim() : '0000';
    const status_val = ['active','inactive','leave'].includes(r.status?.toLowerCase()) ? r.status.toLowerCase() : 'active';
    const errors = [];
    if (!name) errors.push('missing name');
    const existing = allInstructors().find(i => i.name.toLowerCase() === name?.toLowerCase());
    return { name, role, pin, status: status_val, email: r.email||'', errors, existing, row: i+2 };
  });

  const valid = results.filter(r => r.errors.length === 0);
  const invalid = results.filter(r => r.errors.length > 0);

  status.textContent = `${valid.length} ready to import${invalid.length ? `, ${invalid.length} with issues` : ''}`;

  if (results.length === 0) { preview.innerHTML = '<div style="font-size:13px;color:var(--grey-500);">No valid rows found.</div>'; return; }

  preview.innerHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse;">
    <thead><tr style="background:var(--off-white);">
      <th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--grey-200);">Row</th>
      <th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--grey-200);">Name</th>
      <th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--grey-200);">Role</th>
      <th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--grey-200);">Status</th>
    </tr></thead>
    <tbody>
      ${results.map(r => `<tr style="${r.errors.length ? 'background:#fff5f5;' : r.existing ? 'background:#fffbeb;' : ''}">
        <td style="padding:4px 8px;border-bottom:1px solid var(--grey-100);color:var(--grey-400);">${r.row}</td>
        <td style="padding:4px 8px;border-bottom:1px solid var(--grey-100);font-weight:600;">
          ${escapeHtml(r.name || '—')}
          ${r.existing ? '<span style="font-size:9px;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:999px;margin-left:4px;">exists</span>' : ''}
          ${r.errors.length ? `<span style="font-size:9px;color:var(--red);">${r.errors.join(', ')}</span>` : ''}
        </td>
        <td style="padding:4px 8px;border-bottom:1px solid var(--grey-100);">${roleBadge(r.role)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid var(--grey-100);">${escapeHtml(r.status)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;

  // Store for confirm import
  window._bulkImportRows = results;
}

async function confirmBulkImport() {
  const rows = window._bulkImportRows;
  if (!rows || rows.length === 0) { alert('No data to import. Upload a file first.'); return; }
  const valid = rows.filter(r => r.errors.length === 0);
  if (valid.length === 0) { alert('No valid rows to import.'); return; }
  const schoolName = KRMAS_SCHOOLS.find(s => s.id === state.schoolId)?.name || state.schoolId;
  const withEmail = valid.filter(r => r.email).length;
  if (!confirm(`Import ${valid.length} instructor${valid.length === 1 ? '' : 's'} into ${schoolName}?\n\n${withEmail} with an email will also get a login account (a temporary password is shown after import for you to share). Existing names are updated.`)) return;

  // Roster side (custom-schools overlay) — no PINs anymore.
  if (!state.customSchools[state.schoolId]) {
    const seed = SCHOOL_DATA_SEED[state.schoolId];
    state.customSchools[state.schoolId] = {
      instructors: JSON.parse(JSON.stringify(seed?.instructors || [])),
      schedule: [], defaults: {}, contact: seed?.contact || {}
    };
  }
  const instrs = state.customSchools[state.schoolId].instructors;

  let added = 0, updated = 0; const newNames = [];
  for (const r of valid) {
    const existing = instrs.find(i => i.name.toLowerCase() === r.name.toLowerCase());
    if (existing) {
      existing.role = r.role; existing.status = r.status; existing.active = r.status === 'active';
      if (r.email) existing.email = r.email;
      updated++;
    } else {
      const id = 'USR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
      instrs.push({ id, name: r.name, short: r.name.split(' ')[0], role: r.role, status: r.status, active: r.status === 'active', email: r.email || '' });
      newNames.push(r.name); added++;
    }
  }
  await saveCustomSchools();

  for (const name of newNames) {
    const ni = instrs.find(i => i.name.toLowerCase() === name.toLowerCase());
    if (ni) { try { await createOnboardingForInstructor(ni.id); } catch (e) {} }
  }

  // Login accounts — created server-side via the manage-users Edge Function.
  const creds = []; const loginErrors = [];
  document.getElementById('bulkImportStatus').textContent = 'Creating login accounts…';
  for (const r of valid) {
    if (!r.email) continue;
    try {
      const res = await DB.users.invite(r.email, r.role, state.schoolId, r.name);
      if (res && res.uid) { const ti = instrs.find(i => i.name.toLowerCase() === r.name.toLowerCase()); if (ti) ti.uid = res.uid; }
      if (res && res.tempPassword) creds.push({ name: r.name, email: r.email, pw: res.tempPassword });
    } catch (e) {
      loginErrors.push(r.email + ' — ' + ((e && e.message) || 'failed'));
    }
  }
  await saveCustomSchools(); // persist uid links

  window._bulkImportRows = null;
  renderBulkImportResult(added, updated, creds, loginErrors);
  document.getElementById('bulkImportFile').value = '';
  const mgr = document.getElementById('instrManagerBody');
  if (mgr) renderInstructorManagerModal();
}

// Show import summary + any new temp passwords for the admin to distribute.
function renderBulkImportResult(added, updated, creds, loginErrors) {
  const status = document.getElementById('bulkImportStatus');
  const preview = document.getElementById('bulkImportPreview');
  if (status) status.textContent = `✓ Roster: ${added} added, ${updated} updated. Logins created: ${creds.length}.`;
  if (!preview) return;
  let html = '';
  if (creds.length) {
    html += `<div style="margin-top:10px;padding:10px;border:1px solid var(--grey-200);border-radius:var(--r-sm);background:var(--off-white);">
      <div style="font-weight:700;margin-bottom:6px;">New login accounts — copy these now and share them privately. They won't be shown again.</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr><th style="text-align:left;padding:3px 6px;">Name</th><th style="text-align:left;padding:3px 6px;">Email</th><th style="text-align:left;padding:3px 6px;">Temporary password</th></tr></thead>
        <tbody>${creds.map(c => `<tr>
          <td style="padding:3px 6px;">${escapeHtml(c.name)}</td>
          <td style="padding:3px 6px;">${escapeHtml(c.email)}</td>
          <td style="padding:3px 6px;font-family:'JetBrains Mono',monospace;font-weight:700;">${escapeHtml(c.pw)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  }
  if (loginErrors.length) {
    html += `<div style="margin-top:8px;font-size:12px;color:var(--grey-500);">Some logins were skipped (often because the email already has an account):<br>${loginErrors.map(escapeHtml).join('<br>')}</div>`;
  }
  preview.innerHTML = html;
}

// ---------- Composer attachments ----------
function composerPickFiles() { document.getElementById('composerFileInput').click(); }

async function handleComposerFiles(input) {
  const files = [...(input.files || [])];
  for (const file of files) {
    if (_pendingAttachments.length >= 4) { alert('Maximum 4 attachments per post.'); break; }
    if (file.type.startsWith('image/')) {
      const att = await resizeImageToAttachment(file);
      if (att) _pendingAttachments.push(att);
    } else {
      if (file.size > 1.5 * 1024 * 1024) { alert(file.name + ' is too large (max 1.5MB for non-image files).'); continue; }
      try {
        const dataUrl = await fileToDataUrl(file);
        _pendingAttachments.push({ type: 'file', name: file.name, size: file.size, dataUrl });
      } catch (e) {
        alert('Could not read ' + file.name);
      }
    }
  }
  input.value = '';
  renderComposerAttachments();
}

function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

// Centre-crop an image to a square and downscale to `size`px (default 256) — used for profile pictures.
function resizeImageSquare(file, size = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) { reject(new Error('Not an image file')); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

function resizeImageToAttachment(file) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1280;
      let w = img.width, h = img.height;
      if (Math.max(w, h) > MAX) {
        const s = MAX / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      resolve({ type: 'image', name: file.name, size: Math.round(dataUrl.length * 0.75), dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('Could not read image: ' + file.name); resolve(null); };
    img.src = url;
  });
}

function renderComposerAttachments() {
  const strip = document.getElementById('composerAttachStrip');
  if (!strip) return;
  if (_pendingAttachments.length === 0) { strip.innerHTML = ''; return; }
  strip.innerHTML = _pendingAttachments.map((a, i) =>
    a.type === 'image'
      ? `<div class="composer-att"><img src="${a.dataUrl}"><button onclick="removeComposerAttachment(${i})">×</button></div>`
      : `<div class="composer-att file"><span>📄 ${escapeHtml(a.name)}</span><button onclick="removeComposerAttachment(${i})">×</button></div>`
  ).join('');
}

function removeComposerAttachment(i) {
  _pendingAttachments.splice(i, 1);
  renderComposerAttachments();
}

function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

// ---------- Image lightbox ----------
function openLightbox(postId, imgIdx) {
  const post = state.feed.find(p => p.id === postId);
  const images = (post?.mediaUrls || []).filter(m => m && m.type === 'image');
  const img = images[imgIdx];
  if (!img) return;
  const lb = document.getElementById('imgLightbox');
  lb.querySelector('img').src = img.dataUrl;
  lb.style.display = 'flex';
}

function closeLightbox() {
  document.getElementById('imgLightbox').style.display = 'none';
}

// ---------- Required reading acknowledgements ----------
async function acknowledgePost(postId) {
  if (!state.user) { openLogin(); return; }
  if (blockedByImpersonation()) return;
  if (state.myAcks.has(postId)) return;
  state.myAcks.add(postId);
  const post = state.feed.find(p => p.id === postId);
  if (post) {
    if (!post._acks) post._acks = [];
    post._acks.push({ userId: state.user.id, userName: state.user.name, ackedAt: new Date().toISOString() });
    refreshFeedPost(postId, post);
  }
  updateFeedBadge();
  await DB.saveAck(postId, state.user.id, state.user.name);
}

function openAckList(postId) {
  const post = state.feed.find(p => p.id === postId);
  if (!post) return;
  const acks = post._acks || [];
  const ackedIds = new Set(acks.map(a => a.userId || a.user_id));
  // Audience: targeted set or all active instructors at this school
  const audience = resolveTargetAudience(post);
  const everyone = currentInstructors();
  const expected = audience === null ? everyone : everyone.filter(i => audience.has(i.id));
  const pending = expected.filter(i => !ackedIds.has(i.id));

  document.getElementById('ackListBody').innerHTML = `
    <div class="section-sub" style="margin-top:0;">Read (${acks.length})</div>
    ${acks.length === 0 ? '<div style="font-size:12px;color:var(--grey-500);padding:4px 0 8px;">No one yet.</div>'
      : acks.map(a => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--grey-100);font-size:13px;">
          <span style="font-weight:600;">✓ ${escapeHtml(a.userName || a.user_name || a.userId || '')}</span>
          <span style="font-size:11px;color:var(--grey-400);">${timeAgo(a.ackedAt || a.acked_at)}</span>
        </div>`).join('')}
    <div class="section-sub">Not yet read (${pending.length})</div>
    ${pending.length === 0 ? '<div style="font-size:12px;color:var(--ok);font-weight:700;padding:4px 0;">✓ Everyone has read this.</div>'
      : pending.map(i => `<div style="padding:5px 0;border-bottom:1px solid var(--grey-100);font-size:13px;color:var(--grey-500);">○ ${escapeHtml(i.name)}</div>`).join('')}
    ${post.targetScope === 'network' ? `<div style="font-size:10px;color:var(--grey-400);margin-top:8px;">Showing this school's instructors only.</div>` : ''}
  `;
  openModal('modalAckList');
}

// ---------- Feed nav badge (unread required posts) ----------
function updateFeedBadge() {
  const btn = document.querySelector('[data-view="feed"]');
  if (!btn) return;
  const existing = btn.querySelector('.nav-badge');
  if (existing) existing.remove();
  if (!state.user) return;
  const count = (state.feed || []).filter(p =>
    p.requiredReading && canSeePost(p) && !state.myAcks.has(p.id)
  ).length;
  if (count > 0) {
    const b = document.createElement('span');
    b.className = 'nav-badge';
    b.textContent = count > 9 ? '9+' : count;
    btn.appendChild(b);
  }
}

// ====================================================================
// Calendar — per-school events + head-office network events
// ====================================================================

async function loadCalendarData() {
  state.calendarEvents = await DB.loadCalendarEvents(state.schoolId);
  state.eventTypes = await DB.loadEventTypes(state.schoolId);
}

// ---------- Date helpers ----------
function calAddDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function fmtEvDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtEvRange(ev) {
  if (!ev.endDate || ev.endDate === ev.startDate) return fmtEvDate(ev.startDate);
  return fmtEvDate(ev.startDate) + ' – ' + fmtEvDate(ev.endDate);
}

function eventTypeOf(ev) {
  return state.eventTypes.find(t => t.id === ev.typeId) || null;
}

function eventsOnDay(iso) {
  return state.calendarEvents.filter(ev =>
    ev.startDate <= iso && (ev.endDate || ev.startDate) >= iso
  );
}

function upcomingEvents(limit) {
  const today = isoDate(new Date());
  return state.calendarEvents
    .filter(ev => (ev.endDate || ev.startDate) >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime || '').localeCompare(b.startTime || ''))
    .slice(0, limit || 999);
}

// ---------- Feed strip ----------
function renderUpcomingStrip() {
  const ups = upcomingEvents(3);
  if (ups.length === 0) return '';
  let html = `<div style="background:var(--white);border:1px solid var(--grey-200);border-radius:var(--r-md);padding:10px 12px;margin-bottom:10px;box-shadow:var(--shadow);">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="font-family:'Oswald',sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--grey-500);">📅 Upcoming events</span>
      <span onclick="setView('calendar')" style="font-size:11px;font-weight:700;color:var(--red);cursor:pointer;">View all ›</span>
    </div>`;
  for (const ev of ups) {
    const t = eventTypeOf(ev);
    html += `<div onclick="setView('calendar')" style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:1px solid var(--grey-100);">
      <span style="width:8px;height:8px;border-radius:50%;background:${t?.colour || 'var(--grey-300)'};flex-shrink:0;"></span>
      <span style="flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(ev.title)}</span>
      ${ev.schoolId === null ? '<span class="fp-tag" style="background:var(--red);flex-shrink:0;">Network</span>' : ''}
      <span style="font-size:11px;color:var(--grey-500);flex-shrink:0;">${fmtEvDate(ev.startDate)}</span>
    </div>`;
  }
  html += `</div>`;
  return html;
}

// ---------- Calendar view ----------
function renderCalendar() {
  hideDayHead();
  const nb = document.getElementById('noticeBanners');
  if (nb) nb.innerHTML = '';
  const main = document.getElementById('mainContent');

  if (!state.calMonth) state.calMonth = new Date();
  const y = state.calMonth.getFullYear();
  const m = state.calMonth.getMonth();
  const monthName = state.calMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  const today = isoDate(new Date());
  const isAdmin = can.manageCalendar();

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
    <h1 class="section-head" style="margin:0;">Calendar</h1>
    ${isAdmin ? `<button class="btn btn-primary" onclick="openEventEditor(null)" style="padding:8px 14px;">+ Event</button>` : ''}
  </div>`;

  // Admin in-view shortcuts (change 8)
  if (isAdmin) {
    html += `<div style="display:flex;gap:8px;margin-bottom:10px;">
      <button class="btn btn-sm" style="flex:1;" onclick="openEventTypes()">🎨 Categories</button>
      <button class="btn btn-sm" style="flex:1;" onclick="openEventImport()">📥 Import</button>
      ${state.calendarEvents.length > 0 ? `<button class="btn btn-sm" style="flex:1;" onclick="downloadCalendarIcs()">⬇ .ics</button>` : ''}
    </div>`;
  }

  // Month navigation
  html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
    <button class="btn btn-sm" onclick="calMonthShift(-1)" style="padding:6px 14px;">‹</button>
    <span style="font-family:'Oswald',sans-serif;font-weight:700;font-size:15px;text-transform:uppercase;letter-spacing:.04em;">${monthName}</span>
    <button class="btn btn-sm" onclick="calMonthShift(1)" style="padding:6px 14px;">›</button>
  </div>`;

  // Grid header — Monday first (AU)
  html += `<div class="cal-grid" style="margin-bottom:2px;">` +
    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d =>
      `<div style="text-align:center;font-size:10px;font-weight:700;color:var(--grey-400);text-transform:uppercase;padding:2px 0;">${d}</div>`
    ).join('') + `</div>`;

  // Grid cells
  const firstOfMonth = new Date(y, m, 1);
  const lead = (firstOfMonth.getDay() + 6) % 7; // Monday-first offset
  const gridStart = new Date(y, m, 1 - lead);
  html += `<div class="cal-grid" style="margin-bottom:14px;">`;
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = isoDate(d);
    const inMonth = d.getMonth() === m;
    const evs = eventsOnDay(iso);
    const isToday = iso === today;
    const isSel = iso === state.calSelectedDate;
    // Title chips (change 8): show up to 2 event titles, colour-coded, then a "+N" overflow
    let chips = '';
    if (evs.length > 0) {
      chips = `<div class="cal-chips">` +
        evs.slice(0, 2).map(ev => {
          const col = eventTypeOf(ev)?.colour || 'var(--grey-400)';
          return `<span class="cal-chip" style="background:${col};" title="${escapeHtml(ev.title)}">${escapeHtml(ev.title)}</span>`;
        }).join('') +
        (evs.length > 2 ? `<span class="cal-chip-more">+${evs.length - 2} more</span>` : '') +
        `</div>`;
    }
    html += `<div class="cal-cell${inMonth ? '' : ' other'}${isToday ? ' today' : ''}${isSel ? ' selected' : ''}" onclick="calSelectDate('${iso}')">
      <span>${d.getDate()}</span>${chips}
    </div>`;
  }
  html += `</div>`;

  // Agenda
  const today_ = isoDate(new Date());
  let agendaEvents, agendaTitle;
  if (state.calSelectedDate) {
    agendaEvents = eventsOnDay(state.calSelectedDate)
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    agendaTitle = fmtEvDate(state.calSelectedDate);
  } else {
    agendaEvents = upcomingEvents(15);
    agendaTitle = 'Upcoming';
  }

  html += `<div class="section-sub" style="display:flex;align-items:center;justify-content:space-between;">
    <span>${agendaTitle}</span>
    <span style="display:flex;gap:10px;">
      ${state.calSelectedDate ? `<span onclick="calSelectDate(null)" style="font-size:11px;font-weight:700;color:var(--red);cursor:pointer;">Show upcoming</span>` : ''}
      ${state.calendarEvents.length > 0 ? `<span onclick="downloadCalendarIcs()" style="font-size:11px;font-weight:700;color:var(--grey-500);cursor:pointer;">⬇ .ics all</span>` : ''}
    </span>
  </div>`;

  if (agendaEvents.length === 0) {
    html += `<div style="font-size:13px;color:var(--grey-500);padding:8px 0 16px;">No events${state.calSelectedDate ? ' on this day' : ' coming up'}.${isAdmin ? ' Tap + Event to add one.' : ''}</div>`;
  } else {
    for (const ev of agendaEvents) html += renderEventCard(ev);
  }

  main.innerHTML = html;
}

function renderEventCard(ev) {
  const t = eventTypeOf(ev);
  const colour = t?.colour || 'var(--grey-300)';
  // School events: gated by the calendar 'edit' permission. Network events (school_id
  // null) require superadmin, matching the RLS update policy.
  const canEdit = (ev.schoolId === null) ? can.switchAnySchool() : can.editCalendar();
  const time = ev.startTime ? (ev.startTime + (ev.endTime ? '–' + ev.endTime : '')) : 'All day';
  const mapsUrl = ev.location ? 'https://maps.google.com/?q=' + encodeURIComponent(ev.location) : null;

  const isGrading = t && /grad/i.test(t.name || '');
  return `<div class="ev-card" style="border-left:4px solid ${colour};">
    <div style="display:flex;align-items:flex-start;gap:8px;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-weight:700;font-size:14px;">${escapeHtml(ev.title)}</span>
          ${t ? (isGrading
            ? `<button class="fp-tag" style="background:${colour};border:none;cursor:pointer;font:inherit;" onclick="openGradingFromEvent('${ev.id}')" title="Open the connected grading board">${escapeHtml(t.name)} ›</button>`
            : `<span class="fp-tag" style="background:${colour};">${escapeHtml(t.name)}</span>`) : ''}
          ${ev.schoolId === null ? '<span class="fp-tag" style="background:var(--red);">Network</span>' : ''}
        </div>
        <div style="font-size:12px;color:var(--grey-500);margin-top:3px;">${fmtEvRange(ev)} · ${time}</div>
        ${ev.location ? `<a href="${mapsUrl}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--red);font-weight:600;margin-top:4px;text-decoration:none;">📍 ${escapeHtml(ev.location)}</a>` : ''}
        ${ev.description ? `<div style="font-size:12px;color:var(--grey-500);margin-top:4px;line-height:1.4;">${escapeHtml(ev.description)}</div>` : ''}
      </div>
    </div>
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
      <button class="btn btn-sm" onclick="downloadEventIcs('${ev.id}')">⬇ Add to my calendar</button>
      ${isGrading ? `<button class="btn btn-sm" onclick="openGradingFromEvent('${ev.id}')">🎯 Open connected grading</button>` : ''}
      ${canEdit ? `<button class="btn btn-sm" onclick="openEventEditor('${ev.id}')">Edit</button>` : ''}
    </div>
  </div>`;
}

// Jump from a calendar event to its connected grading session (created on import).
function openGradingFromEvent(eventId) {
  const session = Object.values(state.grading || {}).find(g => g.fromEvent === eventId);
  state.gradingView = 'sessions';
  if (session) state.gradingSessionId = session.id;
  setView('grading');
  if (session) {
    setTimeout(() => {
      const el = document.getElementById('open-session-' + session.id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 120);
  }
}

function calMonthShift(delta) {
  state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + delta, 1);
  state.calSelectedDate = null;
  renderCalendar();
}

function calSelectDate(iso) {
  state.calSelectedDate = iso;
  renderCalendar();
}

// ---------- Event editor ----------
function openEventEditor(eventId) {
  const existing = eventId ? state.calendarEvents.find(e => e.id === eventId) : null;
  // Network events (school_id null) are superadmin-only; school events follow the
  // calendar add/edit permissions. Matches the calendar_events RLS policies.
  const allowed = eventId
    ? ((existing && existing.schoolId === null) ? can.switchAnySchool() : can.editCalendar())
    : can.manageCalendar();
  if (!allowed) { alert("You don't have permission to manage events."); return; }
  state.editingEventId = eventId || null;

  document.getElementById('evEditorTitle').textContent = existing ? 'Edit event' : 'New event';
  document.getElementById('evTitle').value = existing?.title || '';
  document.getElementById('evLocation').value = existing?.location || '';
  document.getElementById('evDesc').value = existing?.description || '';
  const defDate = state.calSelectedDate || isoDate(new Date());
  document.getElementById('evStart').value = existing?.startDate || defDate;
  document.getElementById('evEnd').value = existing?.endDate || existing?.startDate || defDate;
  const allDay = existing ? !existing.startTime : true;
  document.getElementById('evAllDay').checked = allDay;
  document.getElementById('evStartTime').value = existing?.startTime || '';
  document.getElementById('evEndTime').value = existing?.endTime || '';
  evAllDayToggled();

  // Type options
  const typeSel = document.getElementById('evType');
  typeSel.innerHTML = `<option value="">— No type —</option>` +
    state.eventTypes.map(t => `<option value="${t.id}">${escapeHtml(t.name)}${t.schoolId === null ? ' (network)' : ''}</option>`).join('');
  typeSel.value = existing?.typeId || '';

  // Scope — superadmin can post network-wide
  const scopeRow = document.getElementById('evScopeRow');
  scopeRow.style.display = can.switchAnySchool() ? 'block' : 'none';
  document.getElementById('evScope').value = existing ? (existing.schoolId === null ? 'network' : 'school') : 'school';

  // Recurrence — only when creating new events
  document.getElementById('evRepeatRow').style.display = existing ? 'none' : 'grid';
  document.getElementById('evRepeat').value = '';
  document.getElementById('evRepeatUntil').value = '';

  // Delete is only offered when editing AND the user may delete this event
  // (network events → superadmin; school events → calendar 'delete' permission).
  const canDelete = existing && ((existing.schoolId === null) ? can.switchAnySchool() : can.deleteCalendar());
  document.getElementById('evDeleteBtn').style.display = canDelete ? 'block' : 'none';
  openModal('modalEventEditor');
}

function evAllDayToggled() {
  const allDay = document.getElementById('evAllDay').checked;
  document.getElementById('evTimesRow').style.display = allDay ? 'none' : 'grid';
}

async function saveEvent() {
  if (blockedByImpersonation()) return;
  const title = document.getElementById('evTitle').value.trim();
  if (!title) { alert('Enter an event title.'); return; }
  let startDate = document.getElementById('evStart').value;
  let endDate = document.getElementById('evEnd').value || startDate;
  if (!startDate) { alert('Pick a start date.'); return; }
  if (endDate < startDate) { alert('End date is before start date.'); return; }
  const allDay = document.getElementById('evAllDay').checked;
  let startTime = allDay ? null : (document.getElementById('evStartTime').value || null);
  let endTime = allDay ? null : (document.getElementById('evEndTime').value || null);
  if (!allDay && !startTime) { alert('Pick a start time or mark the event all-day.'); return; }

  const isNetwork = can.switchAnySchool() && document.getElementById('evScope').value === 'network';
  const existing = state.editingEventId ? state.calendarEvents.find(e => e.id === state.editingEventId) : null;

  // Final permission gate (defence-in-depth alongside RLS): network scope needs
  // superadmin; otherwise editing an event needs calendar 'edit', creating needs 'add'.
  const allowedToSave = isNetwork ? can.switchAnySchool()
    : existing ? can.editCalendar() : can.manageCalendar();
  if (!allowedToSave) { alert("You don't have permission to save this event."); return; }

  const ev = {
    id:          existing?.id || ('EVT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase()),
    schoolId:    isNetwork ? null : state.schoolId,
    title,
    description: document.getElementById('evDesc').value.trim(),
    location:    document.getElementById('evLocation').value.trim(),
    startDate, endDate, startTime, endTime,
    typeId:      document.getElementById('evType').value || null,
    createdBy:   state.user?.name || null,
    createdAt:   existing?.createdAt || new Date().toISOString(),
  };

  // Recurrence (new events only): expand into individual events
  const repeat = !existing ? document.getElementById('evRepeat').value : '';
  const repeatUntil = document.getElementById('evRepeatUntil').value;
  const occurrences = [ev];
  if (repeat) {
    if (!repeatUntil) { alert('Pick an "until" date for the repeat.'); return; }
    if (repeatUntil < startDate) { alert('"Until" date is before the start date.'); return; }
    const spanDays = Math.round((new Date(endDate + 'T00:00:00') - new Date(startDate + 'T00:00:00')) / 86400000);
    let next = startDate;
    while (occurrences.length < 52) {
      next = repeat === 'weekly' ? calAddDays(next, 7)
           : repeat === 'fortnightly' ? calAddDays(next, 14)
           : calAddMonths(next, 1);
      if (next > repeatUntil) break;
      occurrences.push({
        ...ev,
        id: 'EVT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
        startDate: next,
        endDate: calAddDays(next, spanDays),
      });
    }
  }

  for (const o of occurrences) {
    const idx = state.calendarEvents.findIndex(e => e.id === o.id);
    if (idx !== -1) state.calendarEvents[idx] = o;
    else state.calendarEvents.push(o);
  }

  closeModal('modalEventEditor');
  if (state.view === 'calendar') renderCalendar();
  else if (state.view === 'feed') renderFeed();
  for (const o of occurrences) await DB.saveCalendarEvent(o);
  if (occurrences.length > 1) {
    setTimeout(() => alert(occurrences.length + ' events created (' + repeat + ' until ' + repeatUntil + ').'), 100);
  }
}

async function deleteEvent() {
  if (blockedByImpersonation()) return;
  const id = state.editingEventId;
  if (!id) return;
  const ev = state.calendarEvents.find(e => e.id === id);
  // Network events → superadmin; school events → calendar 'delete' permission.
  const allowedToDelete = ev && ((ev.schoolId === null) ? can.switchAnySchool() : can.deleteCalendar());
  if (!allowedToDelete) { alert("You don't have permission to delete this event."); return; }
  if (!confirm(`Delete "${ev?.title || 'this event'}"?`)) return;
  state.calendarEvents = state.calendarEvents.filter(e => e.id !== id);
  closeModal('modalEventEditor');
  if (state.view === 'calendar') renderCalendar();
  await DB.deleteCalendarEvent(id, ev?.schoolId);
}

// ---------- Event types manager ----------
function openEventTypes() {
  if (!requireRole('admin')) return;
  document.getElementById('etName').value = '';
  document.getElementById('etColour').value = '#3b82f6';
  const netRow = document.getElementById('etNetworkRow');
  netRow.style.display = can.switchAnySchool() ? 'flex' : 'none';
  document.getElementById('etNetwork').checked = false;
  renderEventTypesList();
  openModal('modalEventTypes');
}

function renderEventTypesList() {
  const list = document.getElementById('etList');
  if (!list) return;
  if (state.eventTypes.length === 0) {
    list.innerHTML = `<div style="font-size:13px;color:var(--grey-500);padding:6px 0;">No event types yet. Add one above — e.g. Grading, Tournament, Social.</div>`;
    return;
  }
  list.innerHTML = state.eventTypes.map(t => {
    const canDel = can.manageInstructors() && (t.schoolId !== null || can.switchAnySchool());
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--grey-100);">
      <span style="width:18px;height:18px;border-radius:5px;background:${t.colour};flex-shrink:0;border:1px solid rgba(0,0,0,.1);"></span>
      <span style="flex:1;font-size:14px;font-weight:600;">${escapeHtml(t.name)}</span>
      ${t.schoolId === null ? '<span class="fp-tag" style="background:var(--red);">Network</span>' : ''}
      ${canDel ? `<button onclick="removeEventType('${t.id}')" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--grey-400);padding:0 4px;">×</button>` : ''}
    </div>`;
  }).join('');
}

async function addEventType() {
  const name = document.getElementById('etName').value.trim();
  if (!name) { alert('Enter a type name.'); return; }
  if (state.eventTypes.find(t => t.name.toLowerCase() === name.toLowerCase())) {
    alert('A type with that name already exists.'); return;
  }
  const isNetwork = can.switchAnySchool() && document.getElementById('etNetwork').checked;
  const t = {
    id:       'ETY-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(),
    schoolId: isNetwork ? null : state.schoolId,
    name,
    colour:   document.getElementById('etColour').value || '#3b82f6',
    createdBy: state.user?.name || null,
  };
  state.eventTypes.push(t);
  document.getElementById('etName').value = '';
  renderEventTypesList();
  await DB.saveEventType(t);
}

async function removeEventType(id) {
  const t = state.eventTypes.find(x => x.id === id);
  if (!confirm(`Delete type "${t?.name}"? Events using it keep their data but lose the colour.`)) return;
  state.eventTypes = state.eventTypes.filter(x => x.id !== id);
  renderEventTypesList();
  await DB.deleteEventType(id, t?.schoolId);
}

// ---------- ICS generation ----------
function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsForEvents(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KRMAS//InstructorApp//EN', 'CALSCALE:GREGORIAN'];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + ev.id + '@krmas');
    lines.push('DTSTAMP:' + icsStamp(new Date()));
    const endDate = ev.endDate || ev.startDate;
    if (ev.startTime) {
      lines.push('DTSTART:' + ev.startDate.replace(/-/g, '') + 'T' + ev.startTime.replace(':', '') + '00');
      lines.push('DTEND:' + endDate.replace(/-/g, '') + 'T' + (ev.endTime || ev.startTime).replace(':', '') + '00');
    } else {
      // All-day: DTEND is exclusive, so +1 day past the inclusive end
      lines.push('DTSTART;VALUE=DATE:' + ev.startDate.replace(/-/g, ''));
      lines.push('DTEND;VALUE=DATE:' + calAddDays(endDate, 1).replace(/-/g, ''));
    }
    lines.push('SUMMARY:' + icsEscape(ev.title));
    if (ev.location) lines.push('LOCATION:' + icsEscape(ev.location));
    if (ev.description) lines.push('DESCRIPTION:' + icsEscape(ev.description));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadEventIcs(eventId) {
  const ev = state.calendarEvents.find(e => e.id === eventId);
  if (!ev) return;
  const safe = ev.title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 40);
  downloadBlob('KRMAS_' + safe + '.ics', icsForEvents([ev]), 'text/calendar');
}

function downloadCalendarIcs() {
  if (state.calendarEvents.length === 0) return;
  downloadBlob('KRMAS_Calendar.ics', icsForEvents(state.calendarEvents), 'text/calendar');
}

// ---------- Bulk event import ----------
function openEventImport() {
  if (!requireRole('admin')) return;
  document.getElementById('eventImportStatus').textContent = '';
  document.getElementById('eventImportPreview').innerHTML = '';
  document.getElementById('eventImportFile').value = '';
  window._eventImportRows = null;
  openModal('modalEventImport');
}

function downloadEventTemplate() {
  const csv = [
    'title,type,start_date,end_date,start_time,end_time,location,description,school',
    'Winter Grading,Grading,2026-07-18,2026-07-18,09:00,13:00,"Edgeworth Sports Hall, 123 Main Rd, Edgeworth NSW",Bring full uniform,edgeworth',
    'KRMAS National Camp,Camp,2026-09-25,2026-09-27,,,"Myuna Bay Sport & Rec, Morisset NSW",3-day camp — all schools welcome,network',
    'Parents Night,Social,2026-08-07,2026-08-07,18:00,20:00,Dojo,Family open night,edgeworth',
  ].join('\n');
  downloadBlob('KRMAS_Event_Import_Template.csv', csv, 'text/csv');
}

function parseCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function normaliseImportDate(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // AU format DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return null;
}

function normaliseImportTime(s) {
  if (!s) return null;
  s = String(s).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return m[1].padStart(2, '0') + ':' + m[2];
  return null;
}

function handleEventImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const status = document.getElementById('eventImportStatus');
  status.textContent = 'Reading file…';
  if (ext === 'csv' || ext === 'txt') {
    const reader = new FileReader();
    reader.onload = e => parseEventCSV(e.target.result);
    reader.readAsText(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    const reader = new FileReader();
    reader.onload = e => parseEventXLSX(e.target.result);
    reader.readAsArrayBuffer(file);
  } else {
    status.textContent = 'Unsupported file type. Use CSV or XLSX.';
  }
}

function parseEventCSV(text) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (lines.length < 2) {
    document.getElementById('eventImportStatus').textContent = 'File appears empty or has no data rows.';
    return;
  }
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const rows = lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] || '');
    return obj;
  }).filter(r => r.title);
  previewEventImport(rows);
}

function parseEventXLSX(buffer) {
  if (typeof XLSX === 'undefined') {
    document.getElementById('eventImportStatus').textContent = 'XLSX library not loaded. Use CSV instead.';
    return;
  }
  try {
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    const norm = rows.map(r => {
      const o = {};
      for (const [k, v] of Object.entries(r)) o[k.toLowerCase().trim().replace(/\s+/g, '_')] = String(v).trim();
      return o;
    }).filter(r => r.title);
    previewEventImport(norm);
  } catch (e) {
    document.getElementById('eventImportStatus').textContent = 'Failed to parse XLSX: ' + e.message;
  }
}

function resolveImportSchool(s) {
  // Returns { schoolId } where null = network, undefined = invalid
  if (!s) return { schoolId: state.schoolId };
  const v = String(s).trim().toLowerCase();
  if (v === 'network' || v === 'head office' || v === 'headoffice' || v === 'all') return { schoolId: null };
  const match = KRMAS_SCHOOLS.find(sc => sc.id.toLowerCase() === v || sc.name.toLowerCase() === v);
  if (match) return { schoolId: match.id };
  return { schoolId: undefined };
}

function previewEventImport(rows) {
  const status = document.getElementById('eventImportStatus');
  const preview = document.getElementById('eventImportPreview');
  const isSuperAdmin = can.switchAnySchool();

  const results = rows.map((r, i) => {
    const errors = [];
    const title = (r.title || '').trim();
    if (!title) errors.push('missing title');

    const startDate = normaliseImportDate(r.start_date);
    if (!startDate) errors.push('bad start_date');
    let endDate = normaliseImportDate(r.end_date) || startDate;
    if (startDate && endDate && endDate < startDate) errors.push('end before start');

    const startTime = normaliseImportTime(r.start_time);
    const endTime = normaliseImportTime(r.end_time);
    if (r.start_time && !startTime) errors.push('bad start_time (use HH:MM)');

    // School resolution + permission enforcement
    let { schoolId } = resolveImportSchool(r.school);
    if (schoolId === undefined) errors.push('unknown school "' + r.school + '"');
    if (!isSuperAdmin) {
      // Admins: rows forced to their own school; network rows rejected
      if (schoolId === null) errors.push('network events need superadmin');
      else schoolId = state.schoolId;
    }

    // Type: match existing (school or network), else flag as new (auto-created on import)
    const typeName = (r.type || '').trim();
    let typeId = null, newType = false;
    if (typeName) {
      const t = state.eventTypes.find(t => t.name.toLowerCase() === typeName.toLowerCase());
      if (t) typeId = t.id;
      else newType = true;
    }

    return {
      row: i + 2, title, startDate, endDate, startTime, endTime,
      location: (r.location || '').trim(), description: (r.description || '').trim(),
      schoolId, typeName, typeId, newType, errors,
    };
  });

  const valid = results.filter(r => r.errors.length === 0);
  status.textContent = `${valid.length} ready to import${results.length - valid.length ? `, ${results.length - valid.length} with issues` : ''}`;

  if (results.length === 0) {
    preview.innerHTML = '<div style="font-size:13px;color:var(--grey-500);">No valid rows found.</div>';
    return;
  }

  preview.innerHTML = `<table style="width:100%;font-size:11px;border-collapse:collapse;">
    <thead><tr style="background:var(--off-white);">
      <th style="padding:5px 6px;text-align:left;border-bottom:1px solid var(--grey-200);">Row</th>
      <th style="padding:5px 6px;text-align:left;border-bottom:1px solid var(--grey-200);">Title</th>
      <th style="padding:5px 6px;text-align:left;border-bottom:1px solid var(--grey-200);">When</th>
      <th style="padding:5px 6px;text-align:left;border-bottom:1px solid var(--grey-200);">Type</th>
      <th style="padding:5px 6px;text-align:left;border-bottom:1px solid var(--grey-200);">School</th>
    </tr></thead>
    <tbody>
      ${results.map(r => `<tr style="${r.errors.length ? 'background:#fff5f5;' : ''}">
        <td style="padding:4px 6px;border-bottom:1px solid var(--grey-100);color:var(--grey-400);">${r.row}</td>
        <td style="padding:4px 6px;border-bottom:1px solid var(--grey-100);font-weight:600;">
          ${escapeHtml(r.title || '—')}
          ${r.errors.length ? `<div style="font-size:9px;color:var(--red);">${r.errors.join(', ')}</div>` : ''}
        </td>
        <td style="padding:4px 6px;border-bottom:1px solid var(--grey-100);">${r.startDate || '?'}${r.endDate && r.endDate !== r.startDate ? '→' + r.endDate : ''}${r.startTime ? '<br>' + r.startTime + (r.endTime ? '–' + r.endTime : '') : ''}</td>
        <td style="padding:4px 6px;border-bottom:1px solid var(--grey-100);">${escapeHtml(r.typeName || '—')}${r.newType ? ' <span style="font-size:8px;background:#fef3c7;color:#92400e;padding:1px 4px;border-radius:999px;">new</span>' : ''}</td>
        <td style="padding:4px 6px;border-bottom:1px solid var(--grey-100);">${r.schoolId === null ? '<span style="color:var(--red);font-weight:700;">Network</span>' : escapeHtml(KRMAS_SCHOOLS.find(s => s.id === r.schoolId)?.name || r.schoolId || '?')}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;

  window._eventImportRows = results;
}

async function confirmEventImport() {
  const rows = window._eventImportRows;
  if (!rows || rows.length === 0) { alert('No data to import. Upload a file first.'); return; }
  const valid = rows.filter(r => r.errors.length === 0);
  if (valid.length === 0) { alert('No valid rows to import.'); return; }
  if (!confirm(`Import ${valid.length} event${valid.length === 1 ? '' : 's'}?`)) return;

  // Auto-create any new types first (deduplicated by name)
  const newTypeNames = [...new Set(valid.filter(r => r.newType).map(r => r.typeName.toLowerCase()))];
  const createdTypes = {};
  for (const lower of newTypeNames) {
    const displayName = valid.find(r => r.typeName.toLowerCase() === lower).typeName;
    const t = {
      id: 'ETY-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(),
      schoolId: state.schoolId,
      name: displayName,
      colour: '#6b7280',
      createdBy: state.user?.name || null,
    };
    state.eventTypes.push(t);
    createdTypes[lower] = t.id;
    await DB.saveEventType(t);
  }

  let imported = 0;
  const gradingEventsForSession = [];
  for (const r of valid) {
    const typeId = r.typeId || (r.newType ? createdTypes[r.typeName.toLowerCase()] : null);
    const ev = {
      id: 'EVT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(),
      schoolId: r.schoolId,
      title: r.title,
      description: r.description,
      location: r.location,
      startDate: r.startDate,
      endDate: r.endDate,
      startTime: r.startTime,
      endTime: r.endTime,
      typeId,
      createdBy: state.user?.name || null,
      createdAt: new Date().toISOString(),
    };
    state.calendarEvents.push(ev);
    await DB.saveCalendarEvent(ev);
    imported++;
    // Flag grading-category events (by type name) for session creation
    if (/grad/i.test(r.typeName || '')) gradingEventsForSession.push(ev);
  }

  // Auto-create a grading session for each imported "grading" event (de-duplicated by date+location)
  let gradingsCreated = 0;
  if (gradingEventsForSession.length > 0) {
    if (!state.grading || typeof state.grading !== 'object') state.grading = {};
    const defaultSyl = Object.keys(GRADING_SYLLABI)[0] || 'ln';
    for (const ev of gradingEventsForSession) {
      const dupe = Object.values(state.grading).some(g => g.date === ev.startDate && (g.location || '') === (ev.location || ''));
      if (dupe) continue;
      const id = 'GS-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
      state.grading[id] = {
        id,
        syllabus: defaultSyl,
        date: ev.startDate,
        location: ev.location || ev.title || '',
        candidates: [],
        fromEvent: ev.id,
      };
      gradingsCreated++;
    }
    if (gradingsCreated > 0) await saveGrading();
  }

  window._eventImportRows = null;
  document.getElementById('eventImportStatus').textContent = `✓ Done: ${imported} event${imported === 1 ? '' : 's'} imported${newTypeNames.length ? ', ' + newTypeNames.length + ' new type' + (newTypeNames.length === 1 ? '' : 's') + ' created' : ''}${gradingsCreated ? ', ' + gradingsCreated + ' grading session' + (gradingsCreated === 1 ? '' : 's') + ' created — set the syllabus for each' : ''}.`;
  document.getElementById('eventImportPreview').innerHTML = '';
  document.getElementById('eventImportFile').value = '';
  if (state.view === 'calendar') renderCalendar();
}

// ---------- Misc helpers (v27) ----------
function calAddMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const targetM = m - 1 + n;
  const ty = y + Math.floor(targetM / 12);
  const tm = ((targetM % 12) + 12) % 12;
  const lastDay = new Date(ty, tm + 1, 0).getDate();
  const td = Math.min(d, lastDay);
  return ty + '-' + String(tm + 1).padStart(2, '0') + '-' + String(td).padStart(2, '0');
}

async function recordLastLogin(userId) {
  try {
    const map = (await DB.loadLastLogins(state.schoolId)) || {};
    map[userId] = new Date().toISOString();
    state.lastLogins = map;
    await DB.saveLastLogins(state.schoolId, map);
  } catch (e) { /* non-critical */ }
}

// ====================================================================
// Document Library — superadmin upload, all roles view/download
// ====================================================================

const DOC_CATEGORIES = ['Syllabus', 'Policy', 'Procedure', 'Form', 'Reference', 'Other'];
const PDF_TYPES = ['application/pdf', 'application/x-pdf', 'application/acrobat', 'application/vnd.pdf', 'text/pdf', 'text/x-pdf'];
const MAX_DOC_SIZE = 5 * 1024 * 1024; // 5 MB

// Accept PDFs and images (change 6 allows certificates/photos as personal docs)
function isAllowedDocFile(file) {
  if (!file) return false;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf' || PDF_TYPES.includes(file.type)) return true;
  if ((file.type || '').startsWith('image/')) return true;
  return ['png','jpg','jpeg','gif','webp','heic'].includes(ext);
}

// ---------- Document library (view — all roles) ----------
function openDocLibrary() {
  renderDocLibrary();
  openModal('modalDocLibrary');
}

function renderDocLibrary() {
  const body = document.getElementById('docLibraryBody');
  if (!body) return;
  const docs = state.documents || [];
  const isSuperAdmin = can.switchAnySchool();

  if (docs.length === 0) {
    body.innerHTML = `<div style="text-align:center;padding:20px 0;color:var(--grey-500);">
      <div style="font-size:28px;margin-bottom:8px;">📚</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:4px;">No documents yet</div>
      <div style="font-size:12px;">${isSuperAdmin ? 'Use the Admin panel → Upload documents to add syllabuses, policies, and reference material.' : 'Documents uploaded by head office will appear here.'}</div>
    </div>`;
    return;
  }

  // Group by category
  const byCategory = {};
  for (const doc of docs) {
    const cat = doc.category || 'Uncategorised';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(doc);
  }

  let html = '';
  for (const [cat, catDocs] of Object.entries(byCategory).sort((a, b) => a[0].localeCompare(b[0]))) {
    html += `<div class="section-sub" style="display:flex;align-items:center;justify-content:space-between;">
      <span>${escapeHtml(cat)}</span>
      <span style="font-size:10px;color:var(--grey-400);">${catDocs.length} doc${catDocs.length !== 1 ? 's' : ''}</span>
    </div>`;
    for (const doc of catDocs.sort((a, b) => a.title.localeCompare(b.title))) {
      html += `<div class="ev-card" style="border-left:4px solid var(--red);display:flex;align-items:center;gap:10px;">
        <span style="font-size:24px;flex-shrink:0;">📄</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14px;">${escapeHtml(doc.title)}</div>
          ${doc.description ? `<div style="font-size:12px;color:var(--grey-500);margin-top:2px;">${escapeHtml(doc.description)}</div>` : ''}
          <div style="font-size:11px;color:var(--grey-400);margin-top:3px;">
            ${escapeHtml(doc.filename)} · ${fmtBytes(doc.fileSize)}
            ${doc.uploadedBy ? ' · Uploaded by ' + escapeHtml(doc.uploadedBy) : ''}
            ${doc.schoolId === null ? ' · <span style="color:var(--red);font-weight:700;">All schools</span>' : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
          <button class="btn btn-sm btn-primary" onclick="viewDocument('${doc.id}')">Open</button>
          ${isSuperAdmin ? `<button class="btn btn-sm" onclick="deleteDocConfirm('${doc.id}')" style="color:var(--red);font-size:11px;">Delete</button>` : ''}
        </div>
      </div>`;
    }
  }
  body.innerHTML = html;
}

function findDocById(docId) {
  return (state.documents || []).find(d => d.id === docId)
      || (state.personalDocsList || []).find(d => d.id === docId)
      || (state.myDocuments || []).find(d => d.id === docId)
      || null;
}

function downloadDocument(docId) {
  const doc = findDocById(docId);
  if (!doc || !doc.fileData) { alert('Document data not available.'); return; }
  const link = document.createElement('a');
  link.href = doc.fileData;
  link.download = doc.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function viewDocument(docId) {
  const doc = findDocById(docId);
  if (!doc || !doc.fileData) { alert('Document data not available.'); return; }
  document.getElementById('pdfViewerTitle').textContent = doc.title || doc.filename;
  document.getElementById('pdfViewerFrame').src = doc.fileData; // browsers render image/* and PDFs inline
  const dlBtn = document.getElementById('pdfDownloadBtn');
  dlBtn.onclick = () => downloadDocument(docId);
  openModal('modalPdfViewer');
}

async function deleteDocConfirm(docId) {
  const doc = (state.documents || []).find(d => d.id === docId);
  if (!doc) return;
  if (!confirm(`Delete "${doc.title}"?\n\nThis removes the document for all users.`)) return;
  state.documents = state.documents.filter(d => d.id !== docId);
  await DB.deleteDocument(docId, doc.schoolId);
  renderDocLibrary();
}

// ---------- Document upload ----------
// Org docs (superadmin) vs personal/instructor docs (self or admin-for-instructor).
let _docUploadTarget = null; // null = org; { instructorId } = personal

function openDocUpload() {
  if (!can.manageDocuments()) { alert("You don't have permission to upload documents."); return; }
  _docUploadTarget = null;
  document.getElementById('docUpHeading').textContent = '📄 Upload document';
  document.getElementById('docUpSub').textContent = 'Upload a PDF or image for instructors to view. Maximum 5 MB.';
  document.getElementById('docUpScopeRow').style.display = '';
  document.getElementById('docUpTitle').value = '';
  document.getElementById('docUpDesc').value = '';
  document.getElementById('docUpCategory').value = 'Syllabus';
  document.getElementById('docUpFile').value = '';
  document.getElementById('docUpStatus').textContent = '';
  populateDocScopeOptions();
  openModal('modalDocUpload');
}

// Scope dropdown for the current role: superadmin → network + this school + any group;
// admin → this school + their school's groups (no network). A group can be a few people
// or a whole school (school-rule group), so it covers "any number of users or all of a school".
function populateDocScopeOptions() {
  const sel = document.getElementById('docUpScope');
  if (!sel) return;
  const isSuper = can.switchAnySchool();
  const groups = (state.groups || []).filter(g => isSuper || (g.school_id || null) === state.schoolId);
  let opts = '';
  if (isSuper) opts += '<option value="network">All schools (network)</option>';
  opts += '<option value="school">This school only</option>';
  if (groups.length) opts += '<option value="group">A group…</option>';
  sel.innerHTML = opts;
  sel.value = isSuper ? 'network' : 'school';
  docUpScopeChanged();
}

// Show/populate the group picker only when "A group…" is selected.
function docUpScopeChanged() {
  const scope = (document.getElementById('docUpScope') || {}).value;
  const row = document.getElementById('docUpGroupRow');
  if (!row) return;
  if (scope === 'group') {
    const isSuper = can.switchAnySchool();
    const groups = (state.groups || []).filter(g => isSuper || (g.school_id || null) === state.schoolId);
    document.getElementById('docUpGroup').innerHTML = groups.map(g =>
      `<option value="${g.id}">${(g.school_id === null ? '🌐 ' : '') + escapeHtml(g.name || 'Group')}</option>`).join('');
    row.style.display = '';
  } else {
    row.style.display = 'none';
  }
}

// Open the uploader targeting a person's personal documents (defaults to self).
function openDocUploadFor(instructorId) {
  const target = instructorId || state.personalDocsTarget || state.user?.id;
  if (!target) { alert('Sign in first.'); return; }
  if (target !== state.user?.id && !can.manageInstructors()) { alert('Admin access required to add documents for another user.'); return; }
  _docUploadTarget = { instructorId: target };
  const who = allInstructors().find(i => i.id === target);
  document.getElementById('docUpHeading').textContent = '📄 Upload personal document';
  document.getElementById('docUpSub').textContent = (target === state.user?.id ? 'Upload a PDF or image (certificate, WWC, etc.).' : 'Upload for ' + (who?.name || target) + '.') + ' Maximum 5 MB.';
  document.getElementById('docUpScopeRow').style.display = 'none';
  document.getElementById('docUpTitle').value = '';
  document.getElementById('docUpDesc').value = '';
  document.getElementById('docUpCategory').value = 'Compliance';
  document.getElementById('docUpFile').value = '';
  document.getElementById('docUpStatus').textContent = '';
  openModal('modalDocUpload');
}

function handleDocFile(input) {
  const file = input.files[0];
  if (!file) return;
  const status = document.getElementById('docUpStatus');
  if (!isAllowedDocFile(file)) {
    status.textContent = '⚠ Only PDF or image files are accepted.';
    status.style.color = 'var(--red)';
    input.value = '';
    return;
  }
  if (file.size > MAX_DOC_SIZE) {
    status.textContent = `⚠ File too large (${fmtBytes(file.size)}). Maximum is ${fmtBytes(MAX_DOC_SIZE)}.`;
    status.style.color = 'var(--red)';
    input.value = '';
    return;
  }
  status.textContent = `✓ ${file.name} (${fmtBytes(file.size)}) — ready to upload`;
  status.style.color = 'var(--ok)';
  const titleInput = document.getElementById('docUpTitle');
  if (!titleInput.value.trim()) {
    titleInput.value = file.name.replace(/\.[^.]+$/i, '').replace(/[_-]/g, ' ');
  }
}

async function submitDocUpload() {
  const personal = !!_docUploadTarget;
  if (blockedByImpersonation()) return;
  if (personal) {
    const tgt = _docUploadTarget.instructorId;
    if (tgt !== state.user?.id && !can.manageInstructors()) { alert('Admin access required.'); return; }
  } else if (!can.manageDocuments()) {
    alert("You don't have permission to upload documents."); return;
  }

  const title = document.getElementById('docUpTitle').value.trim();
  if (!title) { alert('Enter a document title.'); return; }
  const fileInput = document.getElementById('docUpFile');
  const file = fileInput.files[0];
  if (!file) { alert('Select a PDF or image file first.'); return; }
  if (!isAllowedDocFile(file)) { alert('Only PDF or image files are accepted.'); return; }
  if (file.size > MAX_DOC_SIZE) { alert('File too large. Maximum is ' + fmtBytes(MAX_DOC_SIZE) + '.'); return; }

  // Resolve the chosen scope → (schoolId, targetScope, targetIds).
  let docSchoolId = state.schoolId, targetScope = 'school', targetIds = [];
  if (!personal) {
    const scopeVal = (document.getElementById('docUpScope') || {}).value || 'school';
    if (scopeVal === 'network') {
      if (!can.switchAnySchool()) { alert('Only a superadmin can post to the whole network.'); return; }
      docSchoolId = null; targetScope = 'network';
    } else if (scopeVal === 'group') {
      const gid = (document.getElementById('docUpGroup') || {}).value;
      const g = (state.groups || []).find(x => x.id === gid);
      if (!g) { alert('Pick a group to send this document to.'); return; }
      docSchoolId = g.school_id || null; targetScope = 'group'; targetIds = [g.id];
    } else {
      docSchoolId = state.schoolId; targetScope = 'school';
    }
  }

  const status = document.getElementById('docUpStatus');
  status.textContent = 'Uploading…';
  status.style.color = 'var(--grey-500)';

  try {
    const dataUrl = await fileToDataUrl(file);
    const doc = {
      id: 'DOC-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(),
      schoolId: personal ? state.schoolId : docSchoolId,
      instructorId: personal ? _docUploadTarget.instructorId : null,
      title,
      description: document.getElementById('docUpDesc').value.trim(),
      category: document.getElementById('docUpCategory').value || 'Other',
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
      fileData: dataUrl,
      uploadedBy: state.user?.name || null,
      targetScope: personal ? 'school' : targetScope,
      targetIds: personal ? [] : targetIds,
      createdAt: new Date().toISOString(),
    };

    await DB.saveDocument(doc);

    if (personal) {
      if (doc.instructorId === state.user?.id) state.myDocuments = [doc, ...(state.myDocuments || [])];
      state.personalDocsList = [doc, ...(state.personalDocsList || [])];
      if (document.getElementById('personalDocsBody')) renderPersonalDocs();
    } else {
      state.documents.push(doc);
      const libBody = document.getElementById('docLibraryBody');
      if (libBody) renderDocLibrary();
      if (state.view === 'docs') renderDocuments();
    }

    status.textContent = '✓ Uploaded successfully.';
    status.style.color = 'var(--ok)';
    closeModal('modalDocUpload');
  } catch (e) {
    status.textContent = '⚠ Upload failed: ' + e.message;
    status.style.color = 'var(--red)';
  }
}

// ---------- Personal documents (My Documents + admin viewer) ----------
async function openMyDocuments() {
  if (!state.user) { openLogin(); return; }
  state.personalDocsTarget = state.user.id;
  state.personalDocsList = await DB.loadInstructorDocuments(state.user.id);
  state.myDocuments = state.personalDocsList;
  document.getElementById('personalDocsTitle').textContent = 'My documents';
  document.getElementById('personalDocsSub').textContent = 'Personal documents — WWC, First Aid certificates, etc. Visible to you and your admins.';
  document.getElementById('personalDocsUploadBtn').style.display = '';
  renderPersonalDocs();
  openModal('modalPersonalDocs');
}

async function openInstrDocsViewer(instructorId) {
  if (!requireRole('admin')) return;
  const who = allInstructors().find(i => i.id === instructorId);
  state.personalDocsTarget = instructorId;
  state.personalDocsList = await DB.loadInstructorDocuments(instructorId);
  document.getElementById('personalDocsTitle').textContent = (who?.name || 'User') + ' — documents';
  document.getElementById('personalDocsSub').textContent = 'Personal documents uploaded by or for this user.';
  document.getElementById('personalDocsUploadBtn').style.display = '';
  renderPersonalDocs();
  openModal('modalPersonalDocs');
}

function renderPersonalDocs() {
  const body = document.getElementById('personalDocsBody');
  if (!body) return;
  const docs = state.personalDocsList || [];
  const canManage = state.personalDocsTarget === state.user?.id || can.manageInstructors();
  if (docs.length === 0) {
    body.innerHTML = `<div style="text-align:center;padding:18px 0;color:var(--grey-500);">
      <div style="font-size:26px;margin-bottom:8px;">📄</div>
      <div style="font-size:13px;">No personal documents yet.</div>
    </div>`;
    return;
  }
  body.innerHTML = docs.map(doc => `
    <div class="ev-card" style="border-left:4px solid var(--red);display:flex;align-items:center;gap:10px;">
      <span style="font-size:22px;flex-shrink:0;">${(doc.mimeType||'').startsWith('image/') ? '🖼' : '📄'}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:14px;">${escapeHtml(doc.title)}</div>
        ${doc.description ? `<div style="font-size:12px;color:var(--grey-500);margin-top:2px;">${escapeHtml(doc.description)}</div>` : ''}
        <div style="font-size:11px;color:var(--grey-400);margin-top:3px;">${escapeHtml(doc.category || '')} · ${escapeHtml(doc.filename)} · ${fmtBytes(doc.fileSize)}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
        <button class="btn btn-sm btn-primary" onclick="viewDocument('${doc.id}', true)">Open</button>
        ${canManage ? `<button class="btn btn-sm" onclick="deletePersonalDoc('${doc.id}')" style="color:var(--red);font-size:11px;">Delete</button>` : ''}
      </div>
    </div>`).join('');
}

async function deletePersonalDoc(docId) {
  const docs = state.personalDocsList || [];
  const doc = docs.find(d => d.id === docId);
  if (!doc) return;
  if (!confirm(`Delete "${doc.title}"?`)) return;
  await DB.deleteDocument(docId, doc.schoolId, doc.instructorId);
  state.personalDocsList = docs.filter(d => d.id !== docId);
  if (doc.instructorId === state.user?.id) state.myDocuments = (state.myDocuments || []).filter(d => d.id !== docId);
  renderPersonalDocs();
}

// ---------- Dark mode ----------
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  try { localStorage.setItem('krmas-dark-mode', isDark ? '1' : '0'); } catch(e) {}
  // Update meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = isDark ? '#0f0f23' : '#000000';
  if (state.view === 'me') renderMe();
}

function initDarkMode() {
  try {
    const pref = localStorage.getItem('krmas-dark-mode');
    if (pref === '1') {
      document.body.classList.add('dark-mode');
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = '#0f0f23';
    }
  } catch(e) {}
}
initDarkMode();

// ====================================================================
// Instructor Compliance
// ====================================================================

const COMPLIANCE_STATUS = {
  valid:       { label: 'Valid',       colour: '#10b981', icon: '✓' },
  expired:     { label: 'Expired',     colour: '#ef4444', icon: '✕' },
  pending:     { label: 'Pending',     colour: '#f59e0b', icon: '⏳' },
  exempt:      { label: 'Exempt',      colour: '#6b7280', icon: '—' },
  not_started: { label: 'Not started', colour: '#d1d5db', icon: '○' },
};

function getComplianceStatus(rec, req) {
  if (!rec) return 'not_started';
  if (rec.status === 'exempt') return 'exempt';
  if (req.hasExpiry && rec.expiryDate) {
    if (rec.expiryDate < isoDate(new Date())) return 'expired';
  }
  return rec.status || 'not_started';
}

function openComplianceDashboard() {
  if (!requireRole('admin')) return;
  renderComplianceDashboard();
  openModal('modalCompliance');
}

function renderComplianceDashboard() {
  const body = document.getElementById('complianceBody');
  if (!body) return;
  const reqs = state.complianceReqs;
  const instrs = currentInstructors();
  const isSuperAdmin = can.switchAnySchool();
  const today = isoDate(new Date());

  if (reqs.length === 0) {
    body.innerHTML = `<div style="text-align:center;padding:20px 0;color:var(--grey-500);">
      <div style="font-size:28px;margin-bottom:8px;">🛡</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:4px;">No compliance requirements set up</div>
      <div style="font-size:12px;">Add requirements like Working With Children Check, First Aid Certificate, etc.</div>
      <button class="btn btn-primary" style="margin-top:12px;" onclick="openComplianceReqManager()">Set up requirements</button>
    </div>`;
    return;
  }

  // Summary counts
  let expired = 0, expiringSoon = 0, valid = 0, total = 0;
  const thirtyDays = calAddDays(today, 30);
  for (const instr of instrs) {
    for (const req of reqs) {
      total++;
      const rec = state.complianceRecords.find(r => r.instructorId === instr.id && r.requirementId === req.id);
      const st = getComplianceStatus(rec, req);
      if (st === 'expired') expired++;
      else if (st === 'valid' && req.hasExpiry && rec?.expiryDate && rec.expiryDate <= thirtyDays) expiringSoon++;
      else if (st === 'valid') valid++;
    }
  }

  let html = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;">
    <div style="text-align:center;padding:10px;background:${expired ? '#fff1f2' : 'var(--off-white)'};border-radius:var(--r-sm);border:1px solid ${expired ? '#fca5a5' : 'var(--grey-200)'};">
      <div style="font-size:22px;font-weight:700;color:${expired ? '#ef4444' : 'var(--grey-400)'};">${expired}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--grey-500);">Expired</div>
    </div>
    <div style="text-align:center;padding:10px;background:${expiringSoon ? '#fffbeb' : 'var(--off-white)'};border-radius:var(--r-sm);border:1px solid ${expiringSoon ? '#fde68a' : 'var(--grey-200)'};">
      <div style="font-size:22px;font-weight:700;color:${expiringSoon ? '#f59e0b' : 'var(--grey-400)'};">${expiringSoon}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--grey-500);">Expiring ≤30d</div>
    </div>
    <div style="text-align:center;padding:10px;background:var(--off-white);border-radius:var(--r-sm);border:1px solid var(--grey-200);">
      <div style="font-size:22px;font-weight:700;color:#10b981;">${valid}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--grey-500);">Valid</div>
    </div>
  </div>`;

  html += `<button class="btn btn-sm" onclick="openComplianceReqManager()" style="margin-bottom:12px;">⚙ Manage requirements</button>`;

  // Per-instructor grid
  for (const instr of instrs) {
    html += `<div style="background:var(--white);border:1px solid var(--grey-200);border-radius:var(--r-md);padding:10px 12px;margin-bottom:8px;">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;display:flex;align-items:center;gap:6px;">${escapeHtml(instr.name)} ${roleBadge(instr.role)}</div>`;
    for (const req of reqs) {
      const rec = state.complianceRecords.find(r => r.instructorId === instr.id && r.requirementId === req.id);
      const st = getComplianceStatus(rec, req);
      const s = COMPLIANCE_STATUS[st];
      const expiring = st === 'valid' && req.hasExpiry && rec?.expiryDate && rec.expiryDate <= thirtyDays;
      html += `<div onclick="openComplianceEditor('${instr.id}','${req.id}')" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--grey-100);cursor:pointer;">
        <span style="width:22px;height:22px;border-radius:50%;background:${s.colour};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${s.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${escapeHtml(req.name)}</div>
          ${rec?.expiryDate ? `<div style="font-size:11px;color:${expiring ? '#f59e0b' : st==='expired' ? '#ef4444' : 'var(--grey-400)'};">${st === 'expired' ? 'Expired' : expiring ? 'Expires' : 'Valid until'} ${rec.expiryDate}${rec.referenceNumber ? ' · #' + escapeHtml(rec.referenceNumber) : ''}</div>` : ''}
        </div>
        <span style="font-size:11px;color:var(--grey-400);">›</span>
      </div>`;
    }
    html += `</div>`;
  }

  body.innerHTML = html;
}

// ── Requirements manager ──
function openComplianceReqManager() {
  renderComplianceReqList();
  openModal('modalComplianceReqs');
}

function renderComplianceReqList() {
  const body = document.getElementById('compReqsBody');
  if (!body) return;
  if (state.complianceReqs.length === 0) {
    body.innerHTML = `<div style="font-size:13px;color:var(--grey-500);padding:8px 0;">No requirements defined yet. Add common ones like Working With Children Check, First Aid, etc.</div>`;
    return;
  }
  body.innerHTML = state.complianceReqs.map(req => {
    const canDel = can.manageInstructors() && (req.schoolId !== null || can.switchAnySchool());
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--grey-100);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:14px;">${escapeHtml(req.name)}</div>
        <div style="font-size:11px;color:var(--grey-400);">${req.hasExpiry ? 'Has expiry date' : 'No expiry'}${req.schoolId === null ? ' · Network' : ''}</div>
      </div>
      ${canDel ? `<button onclick="deleteComplianceReq('${req.id}')" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--grey-400);">×</button>` : ''}
    </div>`;
  }).join('');
}

async function addComplianceReq() {
  const name = document.getElementById('compReqName').value.trim();
  if (!name) { alert('Enter a requirement name.'); return; }
  const hasExpiry = document.getElementById('compReqExpiry').checked;
  const isNetwork = can.switchAnySchool() && document.getElementById('compReqNetwork').checked;
  const req = {
    id: 'CRQ-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(),
    schoolId: isNetwork ? null : state.schoolId,
    name,
    hasExpiry,
    description: '',
    createdBy: state.user?.name || null,
  };
  state.complianceReqs.push(req);
  document.getElementById('compReqName').value = '';
  renderComplianceReqList();
  await DB.saveComplianceRequirement(req);
}

async function deleteComplianceReq(id) {
  const req = state.complianceReqs.find(r => r.id === id);
  if (!confirm(`Delete requirement "${req?.name}"?\n\nExisting compliance records for this requirement will be orphaned.`)) return;
  state.complianceReqs = state.complianceReqs.filter(r => r.id !== id);
  await DB.deleteComplianceRequirement(id, req?.schoolId);
  renderComplianceReqList();
}

// ── Per-instructor compliance editor ──
function openComplianceEditor(instrId, reqId) {
  const instr = allInstructors().find(i => i.id === instrId);
  const req = state.complianceReqs.find(r => r.id === reqId);
  if (!instr || !req) return;
  const rec = state.complianceRecords.find(r => r.instructorId === instrId && r.requirementId === reqId);

  document.getElementById('compEdTitle').textContent = `${instr.name} — ${req.name}`;
  document.getElementById('compEdInstrId').value = instrId;
  document.getElementById('compEdReqId').value = reqId;
  document.getElementById('compEdStatus').value = rec?.status || 'not_started';

  const expiryRow = document.getElementById('compEdExpiryRow');
  expiryRow.style.display = req.hasExpiry ? 'block' : 'none';
  document.getElementById('compEdExpiry').value = rec?.expiryDate || '';
  document.getElementById('compEdRef').value = rec?.referenceNumber || '';
  document.getElementById('compEdNotes').value = rec?.notes || '';

  openModal('modalComplianceEditor');
}

async function saveComplianceRecord() {
  const instrId = document.getElementById('compEdInstrId').value;
  const reqId = document.getElementById('compEdReqId').value;
  const rec = {
    id: 'CMP-' + instrId + '-' + reqId,
    schoolId: state.schoolId,
    instructorId: instrId,
    requirementId: reqId,
    status: document.getElementById('compEdStatus').value,
    expiryDate: document.getElementById('compEdExpiry').value || null,
    referenceNumber: document.getElementById('compEdRef').value.trim(),
    notes: document.getElementById('compEdNotes').value.trim(),
    updatedBy: state.user?.name || null,
  };
  const idx = state.complianceRecords.findIndex(r => r.instructorId === instrId && r.requirementId === reqId);
  if (idx !== -1) state.complianceRecords[idx] = rec;
  else state.complianceRecords.push(rec);
  closeModal('modalComplianceEditor');
  renderComplianceDashboard();
  await DB.saveInstructorCompliance(rec);
}

// ====================================================================
// Push Notifications
// ====================================================================
// Requires VAPID keys. Generate with: npx web-push generate-vapid-keys
// Set window.VAPID_PUBLIC_KEY in index.html before db.js loads.

async function requestPushPermission() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Push notifications are not supported on this device/browser.');
    return;
  }
  if (!state.user) { openLogin(); return; }
  if (!window.VAPID_PUBLIC_KEY) {
    alert('Push notifications are not configured yet. A VAPID key needs to be set up.');
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Notification permission denied. You can change this in your browser settings.');
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(window.VAPID_PUBLIC_KEY),
      });
    }

    const saved = await DB.savePushSubscription(state.user.id, state.schoolId, sub);
    if (saved) {
      alert('Push notifications enabled! You\'ll be notified about required-reading posts, urgent notices, and cover requests.');
    } else {
      alert('Subscription saved locally but couldn\'t sync to Supabase. Notifications may only work on this device.');
    }
    if (state.view === 'me') renderMe();
  } catch (e) {
    alert('Failed to set up notifications: ' + e.message);
  }
}

async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await DB.removePushSubscription(sub.endpoint);
      await sub.unsubscribe();
    }
    alert('Push notifications disabled.');
    if (state.view === 'me') renderMe();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function isPushEnabled() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch (e) { return false; }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

// Send a push to your own device(s) to confirm the pipeline end-to-end.
// Targets only the current user and does NOT exclude them (it's a self-test).
async function sendTestNotification() {
  if (!state.user) { openLogin(); return; }
  if (!('PushManager' in window)) { alert('Push notifications are not supported on this device/browser.'); return; }
  const enabled = await isPushEnabled();
  if (!enabled) { alert('Turn on “Enable notifications” first, then send a test.'); return; }
  const res = await DB.sendPushNotification({
    title: '🔔 KRMAS test',
    body: 'Push notifications are working on this device.',
    tag: 'krmas-test-' + Date.now(),
    url: './',
    targetUserIds: [state.user.id], // just you
    excludeUserId: null,            // include yourself — this is a self-test
  });
  if (res && typeof res === 'object' && typeof res.sent === 'number') {
    if (res.sent > 0) {
      alert(`Test sent to ${res.sent} device${res.sent === 1 ? '' : 's'}. It should arrive in a few seconds.`);
    } else {
      alert('No active subscriptions were found for your account on the server. Try disabling and re-enabling notifications, then test again.');
    }
  } else if (res) {
    alert('Test request sent. If nothing arrives, confirm the send-push-notification Edge Function is deployed with the VAPID secrets set.');
  } else {
    alert('Couldn’t reach the push service. Make sure the send-push-notification Edge Function is deployed and Supabase is reachable.');
  }
}

// ====================================================================
// Admin view — dedicated tab for admin/superadmin
// ====================================================================



// ====================================================================
// Admin view — full page (admin/superadmin only, nav tab)
// ====================================================================
// ====================================================================
// Superadmin — All-Schools overview (cross-school oversight)
// ====================================================================
async function openAllSchoolsOverview() {
  if (!requireRole('superadmin')) return;
  const body = document.getElementById('allSchoolsBody');
  if (body) body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--grey-500);">Loading every school…</div>`;
  openModal('modalAllSchools');

  const ids = [...new Set([...KRMAS_SCHOOLS.map(s => s.id), ...Object.keys(state.customSchools || {})])];
  const perSchool = [];
  const allIncidents = [];
  const allGradings = [];

  for (const id of ids) {
    const name = KRMAS_SCHOOLS.find(s => s.id === id)?.name || id;
    let inc = {}, grad = {};
    try { inc = (await DB.loadIncidents(id)) || {}; } catch (e) {}
    try { grad = (await DB.loadGrading(id)) || {}; } catch (e) {}
    const incList = Object.entries(inc).map(([iid, v]) => ({ ...v, id: iid, schoolId: id, schoolName: name }));
    const gradList = Object.values(grad).map(g => ({ ...g, schoolId: id, schoolName: name }));
    const seeded = !!(state.customSchools?.[id] || SCHOOL_DATA_SEED[id]);
    if (!incList.length && !gradList.length && !seeded) continue;
    perSchool.push({
      id, name,
      incidents: incList.length,
      gradings: gradList.length,
      openGradings: gradList.filter(g => (g.candidates || []).some(c => !candidateFinalised(c))).length,
    });
    allIncidents.push(...incList);
    allGradings.push(...gradList);
  }
  renderAllSchoolsData(perSchool, allIncidents, allGradings);
}

function renderAllSchoolsData(perSchool, allIncidents, allGradings) {
  const body = document.getElementById('allSchoolsBody');
  if (!body) return;
  perSchool.sort((a, b) => a.name.localeCompare(b.name));
  const totIncidents = allIncidents.length;
  const totGradings = allGradings.length;
  const totOpenGradings = allGradings.filter(g => (g.candidates || []).some(c => !candidateFinalised(c))).length;

  // Recent incidents across all schools
  const recentIncidents = [...allIncidents].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 12);
  // Gradings sorted by date (upcoming + recent)
  const sortedGradings = [...allGradings].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 12);

  let html = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;">
    ${[['Schools', perSchool.length], ['Incidents', totIncidents], ['Gradings', totGradings]].map(([l, n]) => `
      <div style="background:var(--white);border:1px solid var(--grey-200);border-radius:var(--r-md);padding:12px;text-align:center;box-shadow:var(--shadow);">
        <div style="font-family:'Oswald',sans-serif;font-size:26px;font-weight:700;">${n}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--grey-500);font-weight:700;">${l}</div>
      </div>`).join('')}
  </div>`;

  // Per-school breakdown
  html += `<div class="section-sub">By school</div>`;
  if (perSchool.length === 0) {
    html += `<div style="font-size:13px;color:var(--grey-500);padding:6px 4px;">No school data found yet.</div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">`;
    for (const s of perSchool) {
      html += `<div style="display:flex;align-items:center;gap:10px;background:var(--white);border:1px solid var(--grey-200);border-radius:var(--r-sm);padding:10px 12px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;">${escapeHtml(s.name)}</div>
          <div style="font-size:11px;color:var(--grey-500);margin-top:2px;">${s.incidents} incident${s.incidents === 1 ? '' : 's'} · ${s.gradings} grading${s.gradings === 1 ? '' : 's'}${s.openGradings ? ` · <span style="color:var(--warn);font-weight:700;">${s.openGradings} open</span>` : ''}</div>
        </div>
        <button class="btn btn-sm" onclick="gotoSchoolFromOverview('${s.id}')">Open ›</button>
      </div>`;
    }
    html += `</div>`;
  }

  // Recent incidents network-wide
  html += `<div class="section-sub">Recent incidents (all schools)</div>`;
  if (recentIncidents.length === 0) {
    html += `<div style="font-size:13px;color:var(--grey-500);padding:6px 4px;">No incidents on record.</div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">`;
    for (const inc of recentIncidents) {
      const dateStr = inc.date ? formatDateShort(new Date(inc.date + 'T00:00:00')) : '—';
      html += `<div class="ir-saved-item ${inc.severity || ''}" onclick="gotoSchoolFromOverview('${inc.schoolId}','incidents')" style="cursor:pointer;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;">${escapeHtml(inc.personName || '—')} · <span style="color:var(--grey-500);font-weight:400;">${escapeHtml(inc.schoolName)}</span></div>
          <div class="meta">${dateStr} · ${(inc.type || 'incident').replace(/-/g, ' ')} · ${(inc.severity || '').toUpperCase()}</div>
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  // Gradings network-wide
  html += `<div class="section-sub">Gradings (all schools)</div>`;
  if (sortedGradings.length === 0) {
    html += `<div style="font-size:13px;color:var(--grey-500);padding:6px 4px;">No grading sessions.</div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:6px;">`;
    for (const g of sortedGradings) {
      const syl = GRADING_SYLLABI[g.syllabus];
      const cands = g.candidates || [];
      const graded = cands.filter(candidateFinalised).length;
      html += `<div style="display:flex;align-items:center;gap:10px;background:var(--white);border:1px solid var(--grey-200);border-left:4px solid ${syl?.colour || '#999'};border-radius:var(--r-sm);padding:10px 12px;cursor:pointer;" onclick="gotoSchoolFromOverview('${g.schoolId}','grading')">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;">${escapeHtml(syl?.label || g.syllabus)} · <span style="color:var(--grey-500);font-weight:400;">${escapeHtml(g.schoolName)}</span></div>
          <div style="font-size:11px;color:var(--grey-500);margin-top:2px;">${escapeHtml(g.date || '—')} · ${cands.length} candidate${cands.length === 1 ? '' : 's'} · ${graded} graded</div>
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  body.innerHTML = html;
}

function gotoSchoolFromOverview(schoolId, view) {
  closeModal('modalAllSchools');
  if (view) state.view = view;
  selectSchool(schoolId);
}

function renderAdmin() {
  hideDayHead();
  const nb = document.getElementById('noticeBanners');
  if (nb) nb.innerHTML = '';
  const main = document.getElementById('mainContent');

  if (!state.user || !can.manageInstructors()) {
    main.innerHTML = `<div class="empty" style="padding-top:30px;">
      <h2>Admin access required</h2>
      <p style="margin-bottom:16px;">This section is for admins and superadmins only.</p>
      ${!state.user ? `<button class="btn btn-primary" onclick="openLogin()">Sign in</button>` : ''}
    </div>`;
    return;
  }

  const isSuperAdmin = can.switchAnySchool();
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);

  let html = `<h1 class="section-head">Admin</h1>`;

  // Admin tools grid
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">`;
  const btns = [
    { icon: '📊', label: 'Dashboard',           fn: 'openDashboard()' },
    { icon: '📋', label: 'Reports',             fn: 'openReports()' },
    { icon: '🎓', label: 'Onboarding',          fn: 'openOnboardingAdmin()' },
    { icon: '🏫', label: 'Schools / locations', fn: 'openSchoolManager()' },
    { icon: '👥', label: 'User management',      fn: 'openInstructorManager()' },
    { icon: '📥', label: 'Import users',        fn: 'openBulkImport()' },
    { icon: '🏷', label: 'Groups',              fn: 'openGroupsAdmin()' },
    { icon: '📋', label: 'Class assignments',   fn: 'openClassAssignments()' },
    { icon: '🎯', label: 'Class type mapping',  fn: 'openClassTypeMapper()' },
    { icon: '🎨', label: 'Event types',         fn: 'openEventTypes()' },
    { icon: '📅', label: 'Import events',       fn: 'openEventImport()' },
    { icon: '🛡', label: 'Compliance',          fn: 'openComplianceDashboard()' },
    { icon: '📝', label: 'Audit log',           fn: 'openAuditLog()' },
    { icon: '📤', label: 'Export roster',       fn: 'exportWeekRoster()' },
    { icon: '📢', label: 'Notices board',       fn: 'openNoticesBoard()' },
  ];
  if (isSuperAdmin) {
    btns.unshift({ icon: '🔑', label: 'Roles & permissions', fn: 'openRolesMatrix()' });
    btns.unshift({ icon: '🌐', label: 'All schools overview', fn: 'openAllSchoolsOverview()' });
    btns.push({ icon: '📄', label: 'Upload docs', fn: 'openDocUpload()' });
    if (!DB.isSupabase) btns.push({ icon: '☁', label: 'Migrate to Supabase', fn: 'runMigration()' });
  }
  for (const b of btns) {
    html += `<button class="btn" onclick="${b.fn}" style="width:100%;display:flex;align-items:center;gap:8px;justify-content:flex-start;padding:12px 14px;font-size:13px;">
      <span style="font-size:18px;">${b.icon}</span>
      <span>${b.label}</span>
    </button>`;
  }
  html += `</div>`;

  // Team hours
  const currentWeekMonday = startOfWeek(new Date());
  html += `<div class="section-sub">Team hours this week</div>`;
  try { html += renderTeamHours(currentWeekMonday); }
  catch(e) { html += `<div style="font-size:13px;color:var(--grey-500);">Could not load team hours.</div>`; }

  main.innerHTML = html;
}

// ====================================================================
// Roles & permissions matrix — superadmin defines what each below-admin role can do.
// The database (has_perm) is the real gate; this UI just edits role_permissions.
// Only sections genuinely enforced via has_perm are shown, so every toggle is real.
// ====================================================================
const MATRIX_SECTIONS = [
  { key:'students',   label:'Students',          actions:['view','add','edit','delete'] },
  { key:'incidents',  label:'Incidents',         actions:['view','add','edit','delete'] },
  { key:'feed',       label:'Feed — post',       actions:['add'] },
  { key:'notices',    label:'Notices',           actions:['view','add','edit','delete'] },
  { key:'calendar',   label:'Calendar & events', actions:['view','add','edit','delete'] },
  { key:'documents',  label:'Documents',         actions:['view','add','edit','delete'] },
  { key:'compliance', label:'Compliance',        actions:['view','add','edit','delete'] },
  { key:'groups',     label:'Groups',            actions:['view','add','edit','delete'] },
];
const STRUCTURAL_DISPLAY = [
  'Timetable / classes',
  'School details & location',
  'Roster people (add / edit / remove)',
  'Logins (invite / reset / assign role)',
];

async function openRolesMatrix() {
  if (!can.manageRoles()) { alert('Only superadmins can edit roles.'); return; }
  try { state.roleConfig = await DB.roles.loadConfig(); } catch (e) { console.warn('roles load:', e && e.message); }
  const below = (state.roleConfig.roles || []).filter(r => r.rank < 3)
                  .sort((a,b) => (b.rank - a.rank) || a.label.localeCompare(b.label));
  state._rolesEditingRole = (below[0] && below[0].key) || 'instructor';
  renderRolesMatrix();
  openModal('modalRolesMatrix');
}

function renderRolesMatrix() {
  const body = document.getElementById('rolesMatrixBody');
  if (!body) return;
  const roles = (state.roleConfig.roles || []).filter(r => r.rank < 3)
                  .sort((a,b) => (b.rank - a.rank) || a.label.localeCompare(b.label));
  const sel = state._rolesEditingRole;
  const perms = (state.roleConfig.perms && state.roleConfig.perms[sel]) || {};

  let html = `<div style="font-size:12px;color:var(--grey-500);margin-bottom:10px;line-height:1.4;">
    Superadmins set what each role can do; admins assign roles to people in User management.
    Structural rows are locked to admins and can't be granted here.</div>`;

  html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">`;
  for (const r of roles) {
    const active = r.key === sel;
    html += `<button class="btn btn-sm" onclick="selectMatrixRole('${escapeHtml(r.key)}')"
      style="${active ? 'background:var(--red);color:#fff;border-color:var(--red);' : ''}">${escapeHtml(r.label)}</button>`;
  }
  html += `<button class="btn btn-sm" onclick="createCustomRole()">+ New role</button></div>`;

  const selRole = roles.find(r => r.key === sel);
  if (selRole && !selRole.builtin) {
    html += `<div style="margin-bottom:8px;"><button class="btn btn-sm" onclick="deleteCustomRole('${escapeHtml(sel)}')"
      style="color:var(--red);">Delete &ldquo;${escapeHtml(selRole.label)}&rdquo;</button></div>`;
  }

  html += `<table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead><tr style="border-bottom:1px solid var(--grey-200);">
      <th style="text-align:left;padding:5px 4px;">Section</th>
      <th style="padding:5px 4px;width:46px;">View</th><th style="padding:5px 4px;width:46px;">Add</th>
      <th style="padding:5px 4px;width:46px;">Edit</th><th style="padding:5px 4px;width:52px;">Delete</th>
    </tr></thead><tbody>`;
  for (const s of MATRIX_SECTIONS) {
    html += `<tr style="border-bottom:1px solid var(--grey-100);"><td style="padding:5px 4px;font-weight:600;">${escapeHtml(s.label)}</td>`;
    for (const act of ['view','add','edit','delete']) {
      if (s.actions.indexOf(act) === -1) { html += `<td style="text-align:center;color:var(--grey-300);">—</td>`; continue; }
      const on = !!(perms[s.key] && perms[s.key][act]);
      html += `<td style="text-align:center;padding:5px 4px;">
        <input type="checkbox" ${on ? 'checked' : ''}
          onchange="toggleRolePerm('${escapeHtml(sel)}','${s.key}','${act}',this.checked)"
          style="width:16px;height:16px;cursor:pointer;"></td>`;
    }
    html += `</tr>`;
  }
  for (const label of STRUCTURAL_DISPLAY) {
    html += `<tr style="opacity:.55;"><td style="padding:5px 4px;">${escapeHtml(label)} <span style="font-size:10px;">🔒</span></td>
      <td colspan="4" style="text-align:center;font-size:11px;color:var(--grey-400);">Admins only</td></tr>`;
  }
  html += `</tbody></table>`;
  html += `<div style="font-size:11px;color:var(--grey-400);margin-top:8px;line-height:1.4;">
    Grading, lesson plans and roster view are still governed by rank and will join the matrix later.</div>`;
  body.innerHTML = html;
}

function selectMatrixRole(key) { state._rolesEditingRole = key; renderRolesMatrix(); }

async function toggleRolePerm(roleKey, section, action, allowed) {
  const r = await DB.roles.setPermission(roleKey, section, action, allowed);
  if (r.error) { alert('Could not save: ' + r.error); renderRolesMatrix(); return; }
  if (!state.roleConfig.perms[roleKey]) state.roleConfig.perms[roleKey] = {};
  if (!state.roleConfig.perms[roleKey][section]) state.roleConfig.perms[roleKey][section] = {};
  if (allowed) state.roleConfig.perms[roleKey][section][action] = true;
  else delete state.roleConfig.perms[roleKey][section][action];
}

async function createCustomRole() {
  const label = prompt('Name for the new role (e.g. "Senior Instructor"):');
  if (!label || !label.trim()) return;
  const key = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!key) { alert('Please use a name with letters or numbers.'); return; }
  const r = await DB.roles.createRole(key, label.trim(), 2);
  if (r.error) { alert('Could not create role: ' + r.error); return; }
  state.roleConfig = await DB.roles.loadConfig();
  state._rolesEditingRole = key;
  renderRolesMatrix();
}

async function deleteCustomRole(key) {
  if (!confirm('Delete this role? Anyone assigned to it keeps their login but will need a new role.')) return;
  const r = await DB.roles.deleteRole(key);
  if (r.error) { alert('Could not delete role: ' + r.error); return; }
  state.roleConfig = await DB.roles.loadConfig();
  const below = (state.roleConfig.roles || []).filter(x => x.rank < 3);
  state._rolesEditingRole = (below[0] && below[0].key) || 'instructor';
  renderRolesMatrix();
}
function renderDocStrip() {
  const docs = state.documents || [];
  if (docs.length === 0) return '';
  const recent = docs.slice(0, 4);
  let html = `<div style="background:var(--white);border:1px solid var(--grey-200);border-radius:var(--r-md);padding:10px 12px;margin-bottom:10px;box-shadow:var(--shadow);">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="font-family:'Oswald',sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--grey-500);">📚 Documents</span>
      <span onclick="openDocLibrary()" style="font-size:11px;font-weight:700;color:var(--red);cursor:pointer;">View all ›</span>
    </div>`;
  for (const doc of recent) {
    html += `<div onclick="viewDocument('${doc.id}')" style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:1px solid var(--grey-100);">
      <span style="font-size:16px;flex-shrink:0;">📄</span>
      <span style="flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(doc.title)}</span>
      <span style="font-size:10px;color:var(--grey-400);flex-shrink:0;">${escapeHtml(doc.category || '')}</span>
    </div>`;
  }
  html += `</div>`;
  return html;
}

// ====================================================================
// Class Type Mapper — admin tool to override guessClassType per label
// ====================================================================

function openClassTypeMapper() {
  if (!requireRole('admin')) return;
  renderClassTypeMapper();
  openModal('modalClassTypeMapper');
}

function renderClassTypeMapper() {
  const body = document.getElementById('classTypeMapperBody');
  if (!body) return;
  const schedule = currentSchedule();

  // Get unique labels from the schedule
  const labels = [...new Set(schedule.filter(c => c.label).map(c => c.label))].sort();
  if (labels.length === 0) {
    body.innerHTML = `<div style="font-size:13px;color:var(--grey-500);padding:8px 0;">
      This school uses standard class types — no label mapping needed.
      <br><br>Schools with custom timetable labels (e.g. "Little Ninjas Karate 5-12yrs") can be mapped to a colour-coded class type here.
    </div>`;
    return;
  }

  const typeOptions = Object.entries(CLASS_TYPES).map(([key, meta]) =>
    `<option value="${key}">${escapeHtml(meta.name)}</option>`
  ).join('');

  body.innerHTML = `<div style="font-size:12px;color:var(--grey-500);margin-bottom:10px;">
    Each class label from the timetable is mapped to a type for colour coding. The app guesses automatically — fix any wrong ones here.
  </div>` + labels.map(label => {
    const guessed = guessClassType(label);
    const override = state.classTypeOverrides[label];
    const effective = override || guessed;
    const meta = CLASS_TYPES[effective];
    const isOverridden = !!override;

    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--grey-100);">
      <span style="width:12px;height:12px;border-radius:3px;background:var(${meta?.colour || '--grey-300'});flex-shrink:0;"></span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(label)}</div>
        ${!isOverridden ? `<div style="font-size:10px;color:var(--grey-400);">auto-detected</div>` : `<div style="font-size:10px;color:var(--ok);font-weight:600;">manually set</div>`}
      </div>
      <select onchange="setClassTypeOverride('${escapeHtml(label).replace(/'/g, "\\'")}', this.value)" style="padding:5px 6px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:12px;max-width:140px;">
        ${Object.entries(CLASS_TYPES).map(([key, m]) =>
          `<option value="${key}"${key === effective ? ' selected' : ''}>${escapeHtml(m.name)}</option>`
        ).join('')}
      </select>
      ${isOverridden ? `<button onclick="clearClassTypeOverride('${escapeHtml(label).replace(/'/g, "\\'")}')" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--grey-400);padding:0 4px;" title="Reset to auto">↺</button>` : ''}
    </div>`;
  }).join('');
}

async function setClassTypeOverride(label, typeKey) {
  state.classTypeOverrides[label] = typeKey;
  await DB.saveClassTypeOverrides(state.schoolId, state.classTypeOverrides);
  renderClassTypeMapper();
  // Re-render roster if visible
  if (state.view === 'roster') renderDay();
}

async function clearClassTypeOverride(label) {
  delete state.classTypeOverrides[label];
  await DB.saveClassTypeOverrides(state.schoolId, state.classTypeOverrides);
  renderClassTypeMapper();
  if (state.view === 'roster') renderDay();
}

// ====================================================================
// Documents view — full page (nav tab, all users)
// ====================================================================
function renderDocuments() {
  hideDayHead();
  const nb = document.getElementById('noticeBanners');
  if (nb) nb.innerHTML = '';
  const main = document.getElementById('mainContent');
  const docs = state.documents || [];
  const isSuperAdmin = can.switchAnySchool();
  const canUpload = can.manageDocuments();

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <h1 class="section-head" style="margin:0;">Documents</h1>
    ${canUpload ? `<button class="btn btn-primary" onclick="openDocUpload()" style="padding:8px 14px;">+ Upload</button>` : ''}
  </div>`;

  if (docs.length === 0) {
    html += `<div style="text-align:center;padding:28px 0;color:var(--grey-500);">
      <div style="font-size:32px;margin-bottom:10px;">📚</div>
      <div style="font-weight:700;font-size:15px;margin-bottom:6px;">No documents yet</div>
      <div style="font-size:13px;">${canUpload ? 'Tap + Upload to add syllabuses, policies, and reference material.' : 'Documents uploaded by head office will appear here.'}</div>
    </div>`;
    main.innerHTML = html;
    return;
  }

  // Group by category
  const byCategory = {};
  for (const doc of docs) {
    const cat = doc.category || 'Uncategorised';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(doc);
  }

  for (const [cat, catDocs] of Object.entries(byCategory).sort((a, b) => a[0].localeCompare(b[0]))) {
    html += `<div class="section-sub">${escapeHtml(cat)} <span style="font-size:10px;color:var(--grey-400);font-weight:400;">(${catDocs.length})</span></div>`;
    for (const doc of catDocs.sort((a, b) => a.title.localeCompare(b.title))) {
      let scopeBadge = '';
      if (doc.targetScope === 'group') {
        const g = (state.groups || []).find(x => x.id === (doc.targetIds || [])[0]);
        scopeBadge = ` · <span style="color:var(--red);font-weight:700;">👥 ${escapeHtml(g ? g.name : 'Group')}</span>`;
      } else if (doc.schoolId === null || doc.targetScope === 'network') {
        scopeBadge = ` · <span style="color:var(--red);font-weight:700;">All schools</span>`;
      }
      const canDeleteThis = (doc.schoolId === null)
        ? isSuperAdmin
        : (isSuperAdmin || (hasPerm('documents', 'delete') && doc.schoolId === state.schoolId));
      html += `<div onclick="viewDocument('${doc.id}')" class="ev-card" style="border-left:4px solid var(--red);cursor:pointer;display:flex;align-items:center;gap:10px;">
        <span style="font-size:24px;flex-shrink:0;">📄</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14px;">${escapeHtml(doc.title)}</div>
          ${doc.description ? `<div style="font-size:12px;color:var(--grey-500);margin-top:2px;">${escapeHtml(doc.description)}</div>` : ''}
          <div style="font-size:11px;color:var(--grey-400);margin-top:3px;">
            ${escapeHtml(doc.filename)} · ${fmtBytes(doc.fileSize)}
            ${doc.uploadedBy ? ' · ' + escapeHtml(doc.uploadedBy) : ''}
            ${scopeBadge}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
          <span style="font-size:12px;color:var(--red);font-weight:700;">Open ›</span>
          ${canDeleteThis ? `<button class="btn btn-sm" onclick="event.stopPropagation();deleteDocConfirm('${doc.id}')" style="color:var(--red);font-size:10px;">Delete</button>` : ''}
        </div>
      </div>`;
    }
  }

  main.innerHTML = html;
}

// ====================================================================
// School Manager — superadmin only
// ====================================================================

function openSchoolManager() {
  if (!requireRole('admin')) return;
  renderSchoolManager();
  openModal('modalSchoolManager');
}

function renderSchoolManager() {
  const body = document.getElementById('schoolManagerBody');
  if (!body) return;
  const all = can.switchAnySchool();
  const schools = all ? KRMAS_SCHOOLS : KRMAS_SCHOOLS.filter(s => s.id === state.schoolId);
  // "+ Add new school" is a superadmin action only.
  const addBtn = document.getElementById('addSchoolBtn');
  if (addBtn) addBtn.style.display = all ? '' : 'none';
  body.innerHTML = (all ? '' : `<div style="font-size:12px;color:var(--grey-500);margin-bottom:8px;">You can manage your own school here. Other schools are managed by a superadmin.</div>`) +
    schools.map(s => {
    const custom = state.customSchools[s.id];
    const instrCount = custom?.instructors?.length || SCHOOL_DATA_SEED[s.id]?.instructors?.length || 0;
    const schedCount = (custom?.schedule || SCHOOL_DATA_SEED[s.id]?.schedule || []).length;
    return `<div class="ev-card" style="border-left:4px solid ${s.id === state.schoolId ? 'var(--red)' : 'var(--grey-300)'};">
      <div style="display:flex;align-items:flex-start;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14px;">${escapeHtml(s.name)}</div>
          <div style="font-size:12px;color:var(--grey-500);margin-top:2px;">${escapeHtml(s.state || '')}${s.address ? ' · ' + escapeHtml(s.address).slice(0,40) : ''}</div>
          <div style="font-size:11px;color:var(--grey-400);margin-top:3px;">${instrCount} instructor${instrCount!==1?'s':''} · ${schedCount} class${schedCount!==1?'es':''}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
          <button class="btn btn-sm" onclick="openSchoolEditor('${s.id}')">Edit</button>
          <button class="btn btn-sm" onclick="openScheduleEditor('${s.id}')" style="font-size:11px;">Timetable</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openSchoolEditor(schoolId) {
  if (!requireRole('admin')) return;
  if (!can.switchAnySchool() && (!schoolId || schoolId !== state.schoolId)) { alert('You can only edit your own school.'); return; }
  const school = KRMAS_SCHOOLS.find(s => s.id === schoolId);
  const isNew = !schoolId;
  const custom = schoolId ? (state.customSchools[schoolId] || {}) : {};

  document.getElementById('schoolEdTitle').textContent = isNew ? 'Add new school' : `Edit: ${school?.name || schoolId}`;
  document.getElementById('schoolEdId').value = schoolId || '';
  document.getElementById('schoolEdName').value = school?.name || '';
  document.getElementById('schoolEdState').value = school?.state || 'NSW';
  document.getElementById('schoolEdAddress').value = school?.address || '';
  document.getElementById('schoolEdPhone').value = school?.phone || '';
  document.getElementById('schoolEdEmail').value = school?.email || custom?.contact?.adminEmail || '';
  document.getElementById('schoolEdIdRow').style.display = isNew ? 'block' : 'none';
  document.getElementById('schoolEdNewId').value = '';

  // Active days checkboxes
  const activeDays = school?.activeDays || [1,2,3,4,5];
  [0,1,2,3,4,5,6].forEach(d => {
    const cb = document.getElementById('schoolEdDay' + d);
    if (cb) cb.checked = activeDays.includes(d);
  });

  document.getElementById('schoolEdDeleteBtn').style.display = isNew ? 'none' : 'block';
  openModal('modalSchoolEditor');
}

async function saveSchoolDetails() {
  let schoolId = document.getElementById('schoolEdId').value;
  const isNew = !schoolId;

  if (isNew) {
    const newId = document.getElementById('schoolEdNewId').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!newId || newId.length < 2) { alert('Enter a valid school ID (lowercase, min 2 chars).'); return; }
    if (KRMAS_SCHOOLS.find(s => s.id === newId)) { alert('A school with that ID already exists.'); return; }
    schoolId = newId;
  }

  if (isNew ? !can.switchAnySchool() : !canEditSchool(schoolId)) { alert('You can only edit your own school.'); return; }
  const name = document.getElementById('schoolEdName').value.trim();
  if (!name) { alert('Enter a school name.'); return; }

  const activeDays = [0,1,2,3,4,5,6].filter(d => document.getElementById('schoolEdDay' + d)?.checked);
  if (activeDays.length === 0) { alert('Select at least one active day.'); return; }

  const details = {
    name,
    state: document.getElementById('schoolEdState').value.trim(),
    address: document.getElementById('schoolEdAddress').value.trim(),
    phone: document.getElementById('schoolEdPhone').value.trim(),
    email: document.getElementById('schoolEdEmail').value.trim(),
    activeDays,
  };

  if (isNew) {
    // Add to KRMAS_SCHOOLS runtime array
    KRMAS_SCHOOLS.push({
      id: schoolId, name: details.name, state: details.state,
      address: details.address, phone: details.phone, email: details.email,
      activeDays: details.activeDays,
      contact: { adminEmail: details.email, adminName: '', locationLabel: details.name },
    });
    // Init customSchools for it
    state.customSchools[schoolId] = {
      instructors: [], schedule: [], defaults: {},
      contact: { adminEmail: details.email, adminName: '', locationLabel: details.name },
    };
  } else {
    // Update KRMAS_SCHOOLS entry
    const school = KRMAS_SCHOOLS.find(s => s.id === schoolId);
    if (school) {
      school.name = details.name;
      school.state = details.state;
      school.address = details.address;
      school.phone = details.phone;
      school.email = details.email;
      school.activeDays = details.activeDays;
    }
    // Update customSchools overlay
    if (!state.customSchools[schoolId]) {
      const seed = SCHOOL_DATA_SEED[schoolId];
      state.customSchools[schoolId] = {
        instructors: JSON.parse(JSON.stringify(seed?.instructors || [])),
        schedule: JSON.parse(JSON.stringify(seed?.schedule || [])),
        defaults: {}, contact: {},
      };
    }
    state.customSchools[schoolId].contact = {
      adminEmail: details.email, adminName: '', locationLabel: details.name,
    };
    // Store activeDays in custom overlay
    state.customSchools[schoolId].activeDays = details.activeDays;
  }

  await saveCustomSchools(schoolId);
  closeModal('modalSchoolEditor');
  renderSchoolManager();
  // Update school pill if editing current school
  if (schoolId === state.schoolId) {
    document.getElementById('schoolName').textContent = details.name;
  }
}

async function deleteSchool(schoolId) {
  if (!schoolId) return;
  const school = KRMAS_SCHOOLS.find(s => s.id === schoolId);
  if (!confirm(`Delete school "${school?.name || schoolId}"?\n\nThis removes it from the school picker. Data in Supabase is not deleted.`)) return;
  const idx = KRMAS_SCHOOLS.findIndex(s => s.id === schoolId);
  if (idx !== -1) KRMAS_SCHOOLS.splice(idx, 1);
  delete state.customSchools[schoolId];
  await saveCustomSchools(schoolId);
  closeModal('modalSchoolEditor');
  renderSchoolManager();
  if (schoolId === state.schoolId && KRMAS_SCHOOLS.length > 0) {
    selectSchool(KRMAS_SCHOOLS[0].id);
  }
}

// ── Schedule editor ──
function openScheduleEditor(schoolId) {
  if (!requireRole('admin')) return;
  if (!can.switchAnySchool() && schoolId !== state.schoolId) { alert('You can only edit your own school\u2019s timetable.'); return; }
  state._editingScheduleSchool = schoolId;
  renderScheduleEditor();
  openModal('modalScheduleEditor');
}

function renderScheduleEditor() {
  const body = document.getElementById('scheduleEdBody');
  if (!body) return;
  const schoolId = state._editingScheduleSchool;
  const school = KRMAS_SCHOOLS.find(s => s.id === schoolId);
  const custom = state.customSchools[schoolId];
  const schedule = custom?.schedule || SCHOOL_DATA_SEED[schoolId]?.schedule || [];

  const byDay = {};
  for (const c of schedule) {
    if (!byDay[c.day]) byDay[c.day] = [];
    byDay[c.day].push(c);
  }

  let html = `<div style="font-size:12px;color:var(--grey-500);margin-bottom:10px;">${escapeHtml(school?.name || schoolId)} · ${schedule.length} classes</div>`;

  for (const dow of [0,1,2,3,4,5,6]) {
    const classes = (byDay[dow] || []).sort((a,b) => a.start.localeCompare(b.start));
    if (classes.length === 0 && !(school?.activeDays || []).includes(dow)) continue;
    html += `<div class="section-sub" style="display:flex;align-items:center;justify-content:space-between;">
      <span>${DAY_NAMES[dow]}</span>
      <button class="btn btn-sm" onclick="addScheduleSlot(${dow})">+ Class</button>
    </div>`;
    if (classes.length === 0) {
      html += `<div style="font-size:12px;color:var(--grey-400);padding:4px 0 8px;">No classes.</div>`;
    }
    for (let i = 0; i < classes.length; i++) {
      const c = classes[i];
      const meta = CLASS_TYPES[c.type];
      html += `<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--grey-100);">
        <span style="width:10px;height:10px;border-radius:3px;background:var(${meta?.colour || '--grey-300'});flex-shrink:0;"></span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:12px;flex-shrink:0;">${c.start}-${c.end}</span>
        <span style="flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.label || meta?.name || c.type)}</span>
        <button class="btn btn-sm" onclick="editScheduleSlot(${dow},${i})" style="padding:3px 8px;font-size:11px;">Edit</button>
        <button onclick="removeScheduleSlot(${dow},${i})" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--grey-400);">×</button>
      </div>`;
    }
  }
  body.innerHTML = html;
}

function addScheduleSlot(dow) {
  document.getElementById('slotEdTitle').textContent = 'Add class — ' + DAY_NAMES[dow];
  document.getElementById('slotEdDow').value = dow;
  document.getElementById('slotEdIdx').value = '-1';
  document.getElementById('slotEdStart').value = '16:00';
  document.getElementById('slotEdEnd').value = '17:00';
  document.getElementById('slotEdLabel').value = '';
  document.getElementById('slotEdType').value = 'karate';
  openModal('modalSlotEditor');
}

function editScheduleSlot(dow, idx) {
  const schoolId = state._editingScheduleSchool;
  const custom = state.customSchools[schoolId];
  const schedule = custom?.schedule || SCHOOL_DATA_SEED[schoolId]?.schedule || [];
  const dayClasses = schedule.filter(c => c.day === dow).sort((a,b) => a.start.localeCompare(b.start));
  const c = dayClasses[idx];
  if (!c) return;

  document.getElementById('slotEdTitle').textContent = 'Edit class — ' + DAY_NAMES[dow];
  document.getElementById('slotEdDow').value = dow;
  document.getElementById('slotEdIdx').value = idx;
  document.getElementById('slotEdStart').value = c.start;
  document.getElementById('slotEdEnd').value = c.end;
  document.getElementById('slotEdLabel').value = c.label || '';
  document.getElementById('slotEdType').value = c.type;
  openModal('modalSlotEditor');
}

async function saveScheduleSlot() {
  if (blockedByImpersonation()) return;
  const schoolId = state._editingScheduleSchool;
  if (!canEditSchool(schoolId)) { alert('You can only edit your own school.'); return; }
  const dow = parseInt(document.getElementById('slotEdDow').value);
  const idx = parseInt(document.getElementById('slotEdIdx').value);
  const start = document.getElementById('slotEdStart').value;
  const end = document.getElementById('slotEdEnd').value;
  const label = document.getElementById('slotEdLabel').value.trim();
  const type = document.getElementById('slotEdType').value;
  if (!start || !end) { alert('Set start and end times.'); return; }

  // Ensure customSchools overlay exists
  if (!state.customSchools[schoolId]) {
    const seed = SCHOOL_DATA_SEED[schoolId];
    state.customSchools[schoolId] = {
      instructors: JSON.parse(JSON.stringify(seed?.instructors || [])),
      schedule: JSON.parse(JSON.stringify(seed?.schedule || [])),
      defaults: {}, contact: seed?.contact || {},
    };
  }
  const schedule = state.customSchools[schoolId].schedule;

  const slot = { day: dow, start, end, type, label: label || null };

  if (idx === -1) {
    // Add new
    schedule.push(slot);
  } else {
    // Edit existing — find the right slot
    const dayClasses = schedule.filter(c => c.day === dow).sort((a,b) => a.start.localeCompare(b.start));
    const existing = dayClasses[idx];
    if (existing) {
      const realIdx = schedule.indexOf(existing);
      if (realIdx !== -1) schedule[realIdx] = slot;
    }
  }

  await saveCustomSchools(schoolId);
  closeModal('modalSlotEditor');
  renderScheduleEditor();
}

async function removeScheduleSlot(dow, idx) {
  const schoolId = state._editingScheduleSchool;
  if (!canEditSchool(schoolId)) { alert('You can only edit your own school.'); return; }
  if (!confirm('Remove this class from the timetable?')) return;

  if (!state.customSchools[schoolId]) {
    const seed = SCHOOL_DATA_SEED[schoolId];
    state.customSchools[schoolId] = {
      instructors: JSON.parse(JSON.stringify(seed?.instructors || [])),
      schedule: JSON.parse(JSON.stringify(seed?.schedule || [])),
      defaults: {}, contact: seed?.contact || {},
    };
  }
  const schedule = state.customSchools[schoolId].schedule;
  const dayClasses = schedule.filter(c => c.day === dow).sort((a,b) => a.start.localeCompare(b.start));
  const target = dayClasses[idx];
  if (target) {
    const realIdx = schedule.indexOf(target);
    if (realIdx !== -1) schedule.splice(realIdx, 1);
  }

  await saveCustomSchools(schoolId);
  renderScheduleEditor();
}

// ====================================================================
// Dashboard — superadmin network overview
// ====================================================================

function openDashboard() {
  if (!requireRole('admin')) return;
  renderDashboard();
  openModal('modalDashboard');
}

function renderDashboard() {
  const body = document.getElementById('dashboardBody');
  if (!body) return;
  const isSuperAdmin = can.switchAnySchool();
  const today = isoDate(new Date());
  const thirtyDays = calAddDays(today, 30);

  // ── Network stats ──
  const totalSchools = KRMAS_SCHOOLS.length;
  let totalInstructors = 0, totalActive = 0, totalOnLeave = 0;
  const schoolStats = [];

  for (const school of KRMAS_SCHOOLS) {
    const custom = state.customSchools[school.id];
    const seed = SCHOOL_DATA_SEED[school.id];
    const instrs = custom?.instructors || seed?.instructors || [];
    const active = instrs.filter(i => i.active !== false && i.status !== 'leave' && i.status !== 'inactive');
    const leave = instrs.filter(i => i.status === 'leave');
    const schedCount = (custom?.schedule || seed?.schedule || []).length;
    totalInstructors += instrs.length;
    totalActive += active.length;
    totalOnLeave += leave.length;
    schoolStats.push({ school, instrs: instrs.length, active: active.length, leave: leave.length, classes: schedCount });
  }

  // ── Compliance ──
  const reqs = state.complianceReqs;
  let compExpired = 0, compExpiring = 0, compValid = 0, compTotal = 0;
  const instrsHere = currentInstructors();
  for (const instr of instrsHere) {
    for (const req of reqs) {
      compTotal++;
      const rec = state.complianceRecords.find(r => r.instructorId === instr.id && r.requirementId === req.id);
      const st = getComplianceStatus(rec, req);
      if (st === 'expired') compExpired++;
      else if (st === 'valid' && req.hasExpiry && rec?.expiryDate && rec.expiryDate <= thirtyDays) compExpiring++;
      else if (st === 'valid') compValid++;
    }
  }

  // ── Events ──
  const upcomingEvts = upcomingEvents(5);

  // ── Feed ──
  const unreadRequired = (state.feed || []).filter(p => p.requiredReading && !state.myAcks.has(p.id) && canSeePost(p)).length;

  // ── Cover ──
  let coverGaps = 0;
  try {
    for (let i = 0; i < 7; i++) {
      const d = addDays(new Date(), i);
      const classes = rosterForDay(d);
      for (const c of classes) {
        if (!c.lead && !c.assist) coverGaps++;
      }
    }
  } catch(e) {}

  let html = '';

  // Summary cards row
  html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;">
    <div style="text-align:center;padding:12px 8px;background:var(--off-white);border-radius:var(--r-sm);border:1px solid var(--grey-200);">
      <div style="font-size:24px;font-weight:700;">${totalSchools}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--grey-500);">Schools</div>
    </div>
    <div style="text-align:center;padding:12px 8px;background:var(--off-white);border-radius:var(--r-sm);border:1px solid var(--grey-200);">
      <div style="font-size:24px;font-weight:700;">${totalActive}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--grey-500);">Active instructors</div>
    </div>
    <div style="text-align:center;padding:12px 8px;background:var(--off-white);border-radius:var(--r-sm);border:1px solid var(--grey-200);">
      <div style="font-size:24px;font-weight:700;color:${totalOnLeave ? '#f59e0b' : 'var(--grey-400)'};">${totalOnLeave}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--grey-500);">On leave</div>
    </div>
  </div>`;

  // Alerts
  const alerts = [];
  if (compExpired > 0) alerts.push({ icon: '🚨', text: `${compExpired} expired compliance item${compExpired!==1?'s':''}`, colour: '#ef4444' });
  if (compExpiring > 0) alerts.push({ icon: '⚠', text: `${compExpiring} compliance expiring within 30 days`, colour: '#f59e0b' });
  if (unreadRequired > 0) alerts.push({ icon: '📢', text: `${unreadRequired} unread required-reading post${unreadRequired!==1?'s':''}`, colour: '#3b82f6' });
  const incompleteOnboarding = (state.onboardingChecklists || []).filter(c => c.status !== 'complete').length;
  if (incompleteOnboarding > 0) alerts.push({ icon: '🎓', text: incompleteOnboarding + ' instructor' + (incompleteOnboarding!==1?'s':'') + ' with incomplete onboarding', colour: '#6b7280' });
  if (coverGaps > 0) alerts.push({ icon: '🕳', text: `${coverGaps} unstaffed class${coverGaps!==1?'es':''} this week`, colour: '#f59e0b' });

  if (alerts.length > 0) {
    html += `<div class="section-sub">Needs attention</div>`;
    for (const a of alerts) {
      html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${a.colour}11;border:1px solid ${a.colour}33;border-left:4px solid ${a.colour};border-radius:var(--r-sm);margin-bottom:6px;font-size:13px;font-weight:600;">
        <span>${a.icon}</span><span>${a.text}</span>
      </div>`;
    }
  } else {
    html += `<div style="text-align:center;padding:10px;font-size:13px;color:var(--ok);font-weight:700;margin-bottom:8px;">✓ Everything looks good</div>`;
  }

  // Compliance summary
  if (reqs.length > 0) {
    html += `<div class="section-sub">Compliance — ${escapeHtml(KRMAS_SCHOOLS.find(s=>s.id===state.schoolId)?.name||'')}</div>`;
    html += `<div style="display:flex;gap:6px;margin-bottom:10px;">
      <span style="font-size:12px;padding:3px 8px;border-radius:999px;background:#d1fae5;color:#065f46;font-weight:700;">${compValid} valid</span>
      <span style="font-size:12px;padding:3px 8px;border-radius:999px;background:#fef3c7;color:#92400e;font-weight:700;">${compExpiring} expiring</span>
      <span style="font-size:12px;padding:3px 8px;border-radius:999px;background:#fff1f2;color:#9f1239;font-weight:700;">${compExpired} expired</span>
      <span style="font-size:12px;padding:3px 8px;border-radius:999px;background:var(--off-white);color:var(--grey-500);font-weight:700;">${compTotal - compValid - compExpiring - compExpired} other</span>
    </div>`;
  }

  // Upcoming events
  if (upcomingEvts.length > 0) {
    html += `<div class="section-sub">Upcoming events</div>`;
    for (const ev of upcomingEvts) {
      const t = eventTypeOf(ev);
      html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--grey-100);font-size:13px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${t?.colour || 'var(--grey-300)'};flex-shrink:0;"></span>
        <span style="flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(ev.title)}</span>
        <span style="font-size:11px;color:var(--grey-400);flex-shrink:0;">${fmtEvDate(ev.startDate)}</span>
      </div>`;
    }
  }

  // School breakdown (superadmin)
  if (isSuperAdmin) {
    html += `<div class="section-sub" style="margin-top:12px;">Schools breakdown</div>`;
    html += `<table style="width:100%;font-size:12px;border-collapse:collapse;">
      <thead><tr style="background:var(--off-white);">
        <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--grey-500);">School</th>
        <th style="padding:6px 8px;text-align:right;font-size:10px;text-transform:uppercase;color:var(--grey-500);">Instructors</th>
        <th style="padding:6px 8px;text-align:right;font-size:10px;text-transform:uppercase;color:var(--grey-500);">Classes</th>
      </tr></thead><tbody>`;
    for (const s of schoolStats.sort((a,b) => b.instrs - a.instrs)) {
      html += `<tr style="border-bottom:1px solid var(--grey-100);">
        <td style="padding:5px 8px;font-weight:600;">${escapeHtml(s.school.name)}</td>
        <td style="padding:5px 8px;text-align:right;">${s.active}${s.leave ? `<span style="color:#f59e0b;"> +${s.leave} leave</span>` : ''}</td>
        <td style="padding:5px 8px;text-align:right;">${s.classes}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }

  body.innerHTML = html;
}

// ====================================================================
// Reports — downloadable compliance & instructor reports
// ====================================================================

function openReports() {
  if (!requireRole('admin')) return;
  openModal('modalReports');
}

function generateComplianceReport() {
  const reqs = state.complianceReqs;
  const instrs = currentInstructors();
  const today = isoDate(new Date());
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);

  const lines = [
    'KRMAS Instructor App — Compliance Report',
    'School: ' + (school?.name || state.schoolId),
    'Generated: ' + new Date().toLocaleString('en-AU'),
    '',
    ['Instructor', ...reqs.map(r => r.name), 'Status Summary'].join(','),
  ];

  for (const instr of instrs) {
    const cols = [instr.name];
    let expired = 0, valid = 0, pending = 0;
    for (const req of reqs) {
      const rec = state.complianceRecords.find(r => r.instructorId === instr.id && r.requirementId === req.id);
      const st = getComplianceStatus(rec, req);
      const detail = rec?.expiryDate ? st + ' (' + rec.expiryDate + ')' : st;
      cols.push(detail);
      if (st === 'expired') expired++;
      else if (st === 'valid') valid++;
      else if (st === 'pending') pending++;
    }
    cols.push(expired ? expired + ' EXPIRED' : valid === reqs.length ? 'All valid' : pending + ' pending');
    lines.push(cols.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(','));
  }

  downloadBlob('KRMAS_Compliance_Report_' + state.schoolId + '.csv', lines.join('\n'), 'text/csv');
}

function generateInstructorReport() {
  const instrs = allInstructors();
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
  const weekMonday = startOfWeek(new Date());

  const lines = [
    'KRMAS Instructor App — Instructor Report',
    'School: ' + (school?.name || state.schoolId),
    'Generated: ' + new Date().toLocaleString('en-AU'),
    '',
    'Name,Role,Status,Last Login,Weekly Hours,Email',
  ];

  for (const instr of instrs) {
    const lastLogin = state.lastLogins[instr.id] ? new Date(state.lastLogins[instr.id]).toLocaleString('en-AU') : 'Never';
    let weeklyMins = 0;
    try {
      const hrs = instructorWeekHours(instr.id, weekMonday);
      weeklyMins = hrs.totalMins;
    } catch(e) {}
    const hours = (weeklyMins / 60).toFixed(1);
    lines.push([
      '"' + instr.name + '"',
      instr.role,
      instr.status || 'active',
      lastLogin,
      hours + 'h',
      instr.email || '',
    ].join(','));
  }

  downloadBlob('KRMAS_Instructor_Report_' + state.schoolId + '.csv', lines.join('\n'), 'text/csv');
}

function generateRosterReport() {
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
  const lines = [
    'KRMAS Instructor App — Weekly Roster Report',
    'School: ' + (school?.name || state.schoolId),
    'Week of: ' + isoDate(state.currentDate),
    'Generated: ' + new Date().toLocaleString('en-AU'),
    '',
    'Day,Time,Class,Lead,Assist,Junior,Backup,Status',
  ];

  for (let i = 0; i < 7; i++) {
    const d = addDays(state.currentDate, i);
    const dow = d.getDay();
    if (!getActiveDays().includes(dow)) continue;
    const classes = rosterForDay(d);
    for (const c of classes) {
      lines.push([
        DAY_NAMES[dow],
        c.start + '-' + c.end,
        '"' + (c.label || c.meta?.name || c.type) + '"',
        getInstructor(c.lead)?.name || '',
        getInstructor(c.assist)?.name || '',
        getInstructor(c.junior)?.name || '',
        getInstructor(c.backup)?.name || '',
        c.status || 'confirmed',
      ].join(','));
    }
  }

  downloadBlob('KRMAS_Roster_Report_' + state.schoolId + '.csv', lines.join('\n'), 'text/csv');
}

function generateEventReport() {
  const school = KRMAS_SCHOOLS.find(s => s.id === state.schoolId);
  const lines = [
    'KRMAS Instructor App — Events Report',
    'School: ' + (school?.name || state.schoolId),
    'Generated: ' + new Date().toLocaleString('en-AU'),
    '',
    'Title,Type,Start Date,End Date,Start Time,End Time,Location,Scope',
  ];

  for (const ev of state.calendarEvents) {
    const t = eventTypeOf(ev);
    lines.push([
      '"' + (ev.title || '').replace(/"/g, '""') + '"',
      t?.name || '',
      ev.startDate,
      ev.endDate || ev.startDate,
      ev.startTime || 'All day',
      ev.endTime || '',
      '"' + (ev.location || '').replace(/"/g, '""') + '"',
      ev.schoolId === null ? 'Network' : 'School',
    ].join(','));
  }

  downloadBlob('KRMAS_Events_Report_' + state.schoolId + '.csv', lines.join('\n'), 'text/csv');
}

// ====================================================================
// Instructor Onboarding
// ====================================================================

const DEFAULT_ONBOARDING_ITEMS = [
  { key: 'pin',        label: 'Change default PIN',                          required: true,  action: 'pin' },
  { key: 'docs',       label: 'Read all required documents',                 required: true,  action: 'docs' },
  { key: 'compliance', label: 'Submit compliance documents (WWC, First Aid)', required: true,  action: 'compliance' },
  { key: 'coc',        label: 'Acknowledge code of conduct',                 required: true,  action: 'docs' },
  { key: 'profile',    label: 'Review class assignments',                    required: false, action: 'me' },
];

// Where each onboarding task links to (change 10)
function onboardingItemGo(action) {
  closeModal('modalOnboardingDetail');
  closeModal('modalOnboarding');
  switch (action) {
    case 'pin':        openChangePin(); break;
    case 'docs':       setView('docs'); break;
    case 'compliance': openMyDocuments(); break;
    case 'me':         setView('me'); break;
    default:           setView('me');
  }
}

function getOnboardingForInstructor(instructorId) {
  return (state.onboardingChecklists || []).find(c => c.instructorId === instructorId) || null;
}

function onboardingProgress(checklist) {
  if (!checklist || !checklist.items?.length) return { done: 0, total: 0, pct: 0 };
  const done = checklist.items.filter(i => i.completed).length;
  return { done, total: checklist.items.length, pct: Math.round(done / checklist.items.length * 100) };
}

// Returns the active onboarding task list: the school's custom template if one
// has been set up, otherwise the built-in defaults.
function effectiveOnboardingItems() {
  const t = state.onboardingTemplate;
  if (Array.isArray(t) && t.length) {
    return t.map(it => ({
      key: it.key || ('item-' + Math.random().toString(36).slice(2, 7)),
      label: it.label || 'Task',
      required: it.required !== false,
      action: it.action || 'me',
    }));
  }
  return DEFAULT_ONBOARDING_ITEMS;
}

async function createOnboardingForInstructor(instructorId) {
  const existing = getOnboardingForInstructor(instructorId);
  if (existing) return existing;
  const checklist = {
    id: 'ONB-' + instructorId + '-' + state.schoolId,
    schoolId: state.schoolId,
    instructorId,
    items: effectiveOnboardingItems().map(item => ({
      ...item, completed: false, completedAt: null,
    })),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  state.onboardingChecklists.push(checklist);
  await DB.saveOnboardingChecklist(checklist);
  return checklist;
}

// ── Custom onboarding template editor ──
const ONBOARDING_ACTIONS = [
  { v: 'pin',        label: 'Open: Change PIN' },
  { v: 'docs',       label: 'Open: Documents' },
  { v: 'compliance', label: 'Open: My documents (compliance)' },
  { v: 'me',         label: 'Open: My profile / classes' },
  { v: 'none',       label: 'No link (just tick off)' },
];
let _onbTemplateDraft = [];

function openOnboardingTemplate() {
  if (!requireRole('admin')) return;
  const src = (Array.isArray(state.onboardingTemplate) && state.onboardingTemplate.length)
    ? state.onboardingTemplate
    : DEFAULT_ONBOARDING_ITEMS;
  _onbTemplateDraft = src.map(it => ({
    key: it.key || ('item-' + Math.random().toString(36).slice(2, 7)),
    label: it.label || '',
    required: it.required !== false,
    action: it.action || 'me',
  }));
  renderOnboardingTemplate();
  openModal('modalOnboardingTemplate');
}

function renderOnboardingTemplate() {
  const body = document.getElementById('onbTemplateBody');
  if (!body) return;
  if (_onbTemplateDraft.length === 0) {
    body.innerHTML = `<div style="font-size:13px;color:var(--grey-500);padding:8px 0;">No tasks yet. Add one below.</div>`;
    return;
  }
  body.innerHTML = _onbTemplateDraft.map((it, i) => `
    <div style="border:1px solid var(--grey-200);border-radius:var(--r-sm);padding:10px;margin-bottom:8px;">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
        <input type="text" value="${escapeHtml(it.label)}" placeholder="Task description" oninput="onbTemplateEdit(${i},'label',this.value)" style="flex:1;padding:7px 9px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:13px;">
        <button class="btn btn-sm" onclick="onbTemplateMove(${i},-1)" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
        <button class="btn btn-sm" onclick="onbTemplateMove(${i},1)" ${i === _onbTemplateDraft.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
        <button class="btn btn-sm" style="color:var(--red);" onclick="onbTemplateRemove(${i})" title="Remove">✕</button>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <select onchange="onbTemplateEdit(${i},'action',this.value)" style="padding:6px;border:1px solid var(--grey-200);border-radius:var(--r-sm);font-size:12px;">
          ${ONBOARDING_ACTIONS.map(a => `<option value="${a.v}"${it.action === a.v ? ' selected' : ''}>${a.label}</option>`).join('')}
        </select>
        <label style="font-size:12px;display:flex;align-items:center;gap:5px;"><input type="checkbox" ${it.required ? 'checked' : ''} onchange="onbTemplateEdit(${i},'required',this.checked)"> Required</label>
      </div>
    </div>`).join('');
}

function onbTemplateEdit(i, field, val) { if (_onbTemplateDraft[i]) _onbTemplateDraft[i][field] = val; }
function onbTemplateRemove(i) { _onbTemplateDraft.splice(i, 1); renderOnboardingTemplate(); }
function onbTemplateMove(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= _onbTemplateDraft.length) return;
  [_onbTemplateDraft[i], _onbTemplateDraft[j]] = [_onbTemplateDraft[j], _onbTemplateDraft[i]];
  renderOnboardingTemplate();
}
function onbTemplateAdd() {
  _onbTemplateDraft.push({ key: 'item-' + Math.random().toString(36).slice(2, 7), label: '', required: true, action: 'me' });
  renderOnboardingTemplate();
}

async function saveOnboardingTemplate() {
  const items = _onbTemplateDraft.map(it => ({ ...it, label: (it.label || '').trim() })).filter(it => it.label);
  if (items.length === 0) { alert('Add at least one task with a description.'); return; }
  state.onboardingTemplate = items;
  await DB.saveOnboardingTemplate(state.schoolId, items);
  closeModal('modalOnboardingTemplate');
  renderOnboardingAdmin();
  alert('Custom onboarding saved. New checklists will use these tasks.');
}

async function resetOnboardingTemplate() {
  if (!confirm('Reset to the built-in default onboarding tasks? Your custom list will be removed.')) return;
  state.onboardingTemplate = null;
  await DB.saveOnboardingTemplate(state.schoolId, null);
  closeModal('modalOnboardingTemplate');
  renderOnboardingAdmin();
}

// ── Admin: onboarding overview ──
function openOnboardingAdmin() {
  if (!requireRole('admin')) return;
  renderOnboardingAdmin();
  openModal('modalOnboarding');
}

function renderOnboardingAdmin() {
  const body = document.getElementById('onboardingBody');
  if (!body) return;
  const instrs = currentInstructors();

  let html = `<div style="display:flex;gap:8px;margin-bottom:12px;">
    <button class="btn btn-primary" style="flex:1;" onclick="initAllOnboarding()">Start for all instructors</button>
    <button class="btn btn-black" style="flex:1;" onclick="openOnboardingTemplate()">⚙ Customise tasks</button>
  </div>
  <div style="font-size:11px;color:var(--grey-500);margin-bottom:10px;">${Array.isArray(state.onboardingTemplate) && state.onboardingTemplate.length ? `Using a custom onboarding checklist (${state.onboardingTemplate.length} task${state.onboardingTemplate.length === 1 ? '' : 's'}).` : 'Using the built-in default checklist. Tap "Customise tasks" to set your own.'}</div>`;

  const withChecklist = instrs.map(instr => {
    const cl = getOnboardingForInstructor(instr.id);
    const prog = cl ? onboardingProgress(cl) : null;
    return { instr, cl, prog };
  }).sort((a, b) => {
    // Incomplete first, then by progress
    if (!a.cl && !b.cl) return 0;
    if (!a.cl) return 1;
    if (!b.cl) return -1;
    if (a.cl.status === 'complete' && b.cl.status !== 'complete') return 1;
    if (b.cl.status === 'complete' && a.cl.status !== 'complete') return -1;
    return (a.prog?.pct || 0) - (b.prog?.pct || 0);
  });

  for (const { instr, cl, prog } of withChecklist) {
    if (!cl) {
      html += `<div class="ev-card" style="border-left:4px solid var(--grey-300);display:flex;align-items:center;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14px;">${escapeHtml(instr.name)}</div>
          <div style="font-size:11px;color:var(--grey-400);">No onboarding created</div>
        </div>
        <button class="btn btn-sm" onclick="initOnboarding('${instr.id}')">Start</button>
      </div>`;
    } else {
      const colour = cl.status === 'complete' ? '#10b981' : prog.pct > 0 ? '#f59e0b' : 'var(--grey-300)';
      html += `<div class="ev-card" style="border-left:4px solid ${colour};cursor:pointer;" onclick="openOnboardingDetail('${instr.id}')">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:14px;">${escapeHtml(instr.name)} ${roleBadge(instr.role)}</div>
            <div style="font-size:12px;color:var(--grey-500);margin-top:2px;">${prog.done}/${prog.total} complete · ${prog.pct}%</div>
          </div>
          <span style="font-size:12px;padding:3px 8px;border-radius:999px;font-weight:700;background:${colour}22;color:${colour};">${cl.status === 'complete' ? '✓ Done' : prog.pct + '%'}</span>
        </div>
        <div style="margin-top:6px;height:6px;background:var(--grey-200);border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${prog.pct}%;background:${colour};border-radius:999px;transition:width .3s;"></div>
        </div>
      </div>`;
    }
  }

  body.innerHTML = html;
}

async function initOnboarding(instructorId) {
  await createOnboardingForInstructor(instructorId);
  renderOnboardingAdmin();
}

async function initAllOnboarding() {
  const instrs = currentInstructors();
  let created = 0;
  for (const instr of instrs) {
    if (!getOnboardingForInstructor(instr.id)) {
      await createOnboardingForInstructor(instr.id);
      created++;
    }
  }
  alert(created ? `Onboarding created for ${created} instructor${created!==1?'s':''}.` : 'All instructors already have onboarding checklists.');
  renderOnboardingAdmin();
}

// ── Detail: view/edit individual checklist ──
function openOnboardingDetail(instructorId) {
  const instr = allInstructors().find(i => i.id === instructorId);
  const cl = getOnboardingForInstructor(instructorId);
  if (!instr || !cl) return;

  const isAdmin = can.manageInstructors();
  const isSelf = state.user?.id === instructorId;
  const prog = onboardingProgress(cl);

  const body = document.getElementById('onboardingDetailBody');
  document.getElementById('onboardingDetailTitle').textContent = instr.name + ' — Onboarding';

  let html = `<div style="margin-bottom:12px;">
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--grey-500);margin-bottom:4px;">
      <span>${prog.done}/${prog.total} items complete</span>
      <span>${prog.pct}%</span>
    </div>
    <div style="height:8px;background:var(--grey-200);border-radius:999px;overflow:hidden;">
      <div style="height:100%;width:${prog.pct}%;background:${cl.status==='complete'?'#10b981':'#f59e0b'};border-radius:999px;transition:width .3s;"></div>
    </div>
  </div>`;

  for (let i = 0; i < cl.items.length; i++) {
    const item = cl.items[i];
    const canToggle = isAdmin || isSelf;
    const action = item.action || (DEFAULT_ONBOARDING_ITEMS.find(d => d.key === item.key)?.action);
    const labelHtml = action
      ? `<a href="#" onclick="onboardingItemGo('${action}');return false;" style="font-size:14px;font-weight:${item.completed ? '400' : '600'};${item.completed ? 'text-decoration:line-through;color:var(--grey-400);' : 'color:var(--red);'}">${escapeHtml(item.label)} ›</a>`
      : `<div style="font-size:14px;font-weight:${item.completed ? '400' : '600'};${item.completed ? 'text-decoration:line-through;color:var(--grey-400);' : ''}">${escapeHtml(item.label)}</div>`;
    html += `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--grey-100);">
      ${canToggle
        ? `<input type="checkbox" ${item.completed ? 'checked' : ''} onchange="toggleOnboardingItem('${instructorId}',${i},this.checked)" style="width:20px;height:20px;accent-color:var(--red);flex-shrink:0;cursor:pointer;">`
        : `<span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;">${item.completed ? '✓' : '○'}</span>`
      }
      <div style="flex:1;min-width:0;">
        ${labelHtml}
        ${item.completedAt ? `<div style="font-size:10px;color:var(--grey-400);">Completed ${timeAgo(item.completedAt)}</div>` : ''}
        ${item.required ? `<span style="font-size:9px;color:var(--red);font-weight:700;">REQUIRED</span>` : ''}
      </div>
    </div>`;
  }

  if (isAdmin) {
    html += `<div style="margin-top:12px;">
      <button class="btn btn-sm" onclick="resetOnboarding('${instructorId}')">Reset checklist</button>
    </div>`;
  }

  body.innerHTML = html;
  openModal('modalOnboardingDetail');
}

async function toggleOnboardingItem(instructorId, itemIdx, checked) {
  if (blockedByImpersonation()) return;
  const cl = getOnboardingForInstructor(instructorId);
  if (!cl || !cl.items[itemIdx]) return;
  cl.items[itemIdx].completed = checked;
  cl.items[itemIdx].completedAt = checked ? new Date().toISOString() : null;

  // Update status
  const prog = onboardingProgress(cl);
  cl.status = prog.pct === 100 ? 'complete' : prog.pct > 0 ? 'in_progress' : 'pending';

  await DB.saveOnboardingChecklist(cl);
  openOnboardingDetail(instructorId); // re-render
}

async function resetOnboarding(instructorId) {
  if (!confirm('Reset all onboarding items to incomplete?')) return;
  const cl = getOnboardingForInstructor(instructorId);
  if (!cl) return;
  for (const item of cl.items) {
    item.completed = false;
    item.completedAt = null;
  }
  cl.status = 'pending';
  await DB.saveOnboardingChecklist(cl);
  openOnboardingDetail(instructorId);
}

// ── Me tab: show own onboarding if incomplete ──
function renderMyOnboarding() {
  if (!state.user) return '';
  const cl = getOnboardingForInstructor(state.user.id);
  if (!cl || cl.status === 'complete') return '';
  const prog = onboardingProgress(cl);
  return `<div onclick="openOnboardingDetail('${state.user.id}')" style="cursor:pointer;background:#fffbeb;border:1px solid #fde68a;border-radius:var(--r-md);padding:12px;margin-bottom:12px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="font-weight:700;font-size:14px;">🎓 Complete your onboarding</span>
      <span style="font-size:12px;font-weight:700;color:#f59e0b;">${prog.pct}%</span>
    </div>
    <div style="height:6px;background:#fde68a;border-radius:999px;overflow:hidden;">
      <div style="height:100%;width:${prog.pct}%;background:#f59e0b;border-radius:999px;"></div>
    </div>
    <div style="font-size:12px;color:#92400e;margin-top:6px;">${prog.done}/${prog.total} items done — tap to continue</div>
  </div>`;
}
