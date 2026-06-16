/* ====================================================================
   KRMAS Roster — Storage adapter v2 (Supabase + localStorage fallback)
   --------------------------------------------------------------------
   To enable Supabase, add to index.html BEFORE db.js loads:
     <script>
       window.SUPABASE_URL  = 'https://your-project.supabase.co';
       window.SUPABASE_ANON = 'your-anon-key';
     </script>
   Without those values the app silently uses localStorage.
   ==================================================================== */

const DB = (() => {

  // ── Supabase client (lazy-initialised) ──────────────────────────
  let _sb = null;
  let _uid = null;
  function sbClient() {
    if (_sb) return _sb;
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON) return null;
    if (typeof supabase === 'undefined' || !supabase.createClient) return null;
    _sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
    });
    _sb.auth.getUser().then(({ data }) => { _uid = data && data.user ? data.user.id : null; }).catch(() => {});
    _sb.auth.onAuthStateChange((_e, session) => { _uid = session && session.user ? session.user.id : null; });
    console.log('[DB] Supabase connected to', window.SUPABASE_URL);
    return _sb;
  }
  function isSB() { return !!sbClient(); }

  // ── Hashing for the optional on-device PIN lock (uid acts as salt) ──
  async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Normalized table <-> {id: record} map, written with minimal diffs ──
  // students & incidents are real tables now (RLS per row). The app still hands
  // us whole {id: record} maps; we diff against the last-loaded snapshot and issue
  // only the rows that actually changed, so each write lands on the right RLS policy
  // (e.g. a junior filing one incident does a single INSERT, not an UPDATE of all).
  let _snap = {};
  function _snapshot(map) { const o = {}; for (const id in map) o[id] = JSON.stringify(map[id]); return o; }
  function _rowToRec(table, r) {
    if (table === 'students')
      return { id: r.id, name: r.name, dob: r.dob, memberNum: r.member_num, source: r.source, schoolId: r.school_id };
    return Object.assign({}, r.data || {}, { id: r.id, schoolId: r.school_id }); // incidents
  }
  function _recToRow(table, id, rec, schoolId) {
    if (table === 'students')
      return { id, school_id: schoolId, name: rec.name || '', dob: rec.dob || null, member_num: rec.memberNum || null, source: rec.source || null };
    const data = Object.assign({}, rec); delete data.schoolId; // incidents: whole object in jsonb
    const row = { id, school_id: schoolId, data };
    if (_uid) row.created_by = _uid; // required by RLS on INSERT
    return row;
  }
  async function sbLoadTableMap(table, schoolId) {
    const sb = sbClient(); const lk = table + ':' + schoolId;
    if (!sb) { const m = (await lGet(lk)) || {}; _snap[lk] = _snapshot(m); return m; }
    const { data, error } = await sb.from(table).select('*');
    if (error) { console.warn('[DB] load ' + table + ' fallback:', error.message); const m = (await lGet(lk)) || {}; _snap[lk] = _snapshot(m); return m; }
    const map = {}; (data || []).forEach(r => { map[r.id] = _rowToRec(table, r); });
    _snap[lk] = _snapshot(map); lSet(lk, map); return map;
  }
  async function sbSaveTableMap(table, schoolId, map) {
    const sb = sbClient(); const lk = table + ':' + schoolId; map = map || {};
    if (!sb) { _snap[lk] = _snapshot(map); return lSet(lk, map); }
    const prev = _snap[lk] || {}; const cur = _snapshot(map);
    for (const id in cur) if (prev[id] !== cur[id]) {
      const { error } = await sb.from(table).upsert(_recToRow(table, id, map[id], schoolId), { onConflict: 'id' });
      if (error) console.warn('[DB] save ' + table + ' ' + id + ':', error.message);
    }
    for (const id in prev) if (!(id in cur)) {
      const { error } = await sb.from(table).delete().eq('id', id);
      if (error) console.warn('[DB] delete ' + table + ' ' + id + ':', error.message);
    }
    _snap[lk] = cur; lSet(lk, map); return true;
  }
  async function sbDeleteRow(table, id) {
    const sb = sbClient();
    if (sb) { const { error } = await sb.from(table).delete().eq('id', id); if (error) console.warn('[DB] delete ' + table + ':', error.message); }
    return true;
  }

  // Invoke an Edge Function and surface its JSON {error} body (supabase-js otherwise
  // hides the message behind a generic non-2xx error).
  async function invokeFn(name, body) {
    const sb = sbClient(); if (!sb) throw new Error('Supabase unavailable');
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let msg = (error && error.message) || 'Request failed';
      try { if (error.context && error.context.json) { const j = await error.context.json(); if (j && j.error) msg = j.error; } } catch (e) {}
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  // ── localStorage helpers ─────────────────────────────────────────
  async function lGet(key) {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }
    catch (e) { return null; }
  }
  async function lSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { console.warn('[DB] localStorage write failed:', key); return false; }
  }

  // ── Supabase kv_store (blob storage per school) ──────────────────
  // Key format going in: "namespace:schoolId" — we split on last colon.
  // User session is always localStorage (device-local by design).
  const LOCAL_ONLY_KEYS = ['roster-user:session'];

  // ── Outbound sync queue ──────────────────────────────────────────
  // When a Supabase write fails (offline or transient error) we still write
  // locally AND buffer the operation here, keyed by school|key so only the
  // latest value per record is retained (last-write-wins, bounded size).
  // window 'online' triggers flushQueue() which replays buffered writes.
  const QUEUE_KEY = 'krmas_outbound_queue';
  function loadQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}'); } catch (e) { return {}; } }
  function saveQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) {} }
  function enqueue(schoolId, key, value) {
    const q = loadQueue();
    q[schoolId + '|' + key] = { schoolId, key, value, ts: Date.now() };
    saveQueue(q);
  }
  function pendingCount() { return Object.keys(loadQueue()).length; }

  async function _rawSbSet(schoolId, key, value) {
    const sb = sbClient();
    if (!sb) throw new Error('no-supabase');
    const { error } = await sb.rpc('upsert_kv', { p_school_id: schoolId, p_key: key, p_value: value, p_updated_by: null });
    if (error) throw error;
    return true;
  }

  // Replay any buffered writes. Stops on the first still-failing item so order
  // and connectivity problems don't spin. Returns the number flushed.
  async function flushQueue() {
    if (!sbClient()) return 0;
    const q = loadQueue();
    const keys = Object.keys(q);
    let flushed = 0;
    for (const k of keys) {
      const item = q[k];
      try { await _rawSbSet(item.schoolId, item.key, item.value); delete q[k]; flushed++; }
      catch (e) { break; } // still offline / failing — keep remaining buffered
    }
    saveQueue(q);
    return flushed;
  }

  async function sbGet(schoolId, key) {
    const sb = sbClient();
    if (!sb) return null;
    try {
      const { data, error } = await sb
        .from('kv_store')
        .select('value')
        .eq('school_id', schoolId)
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;
      return data?.value ?? null;
    } catch (e) {
      console.warn('[DB] sbGet fallback:', key, e.message);
      return lGet(schoolId + ':' + key);
    }
  }

  async function sbSet(schoolId, key, value) {
    const sb = sbClient();
    if (!sb) return lSet(schoolId + ':' + key, value); // pure local mode — nothing to sync to
    try {
      await _rawSbSet(schoolId, key, value);
      return true;
    } catch (e) {
      console.warn('[DB] sbSet buffered (will sync when online):', key, e.message);
      lSet(schoolId + ':' + key, value);
      enqueue(schoolId, key, value);
      return true;
    }
  }

  // Route get/set — split "namespace:schoolId" on LAST colon
  async function get(fullKey) {
    if (LOCAL_ONLY_KEYS.includes(fullKey)) return lGet(fullKey);
    const i = fullKey.lastIndexOf(':');
    if (isSB() && i > 0) {
      return sbGet(fullKey.slice(i + 1), fullKey.slice(0, i));
    }
    return lGet(fullKey);
  }

  async function set(fullKey, value) {
    if (LOCAL_ONLY_KEYS.includes(fullKey)) return lSet(fullKey, value);
    const i = fullKey.lastIndexOf(':');
    if (isSB() && i > 0) {
      return sbSet(fullKey.slice(i + 1), fullKey.slice(0, i), value);
    }
    return lSet(fullKey, value);
  }

  // ── Notices ──────────────────────────────────────────────────────
  // Stored in dedicated `notices` table for realtime support.
  // Local fallback uses a simple array per key.

  async function _noticesLocal(schoolId) {
    return (await lGet('notices:' + schoolId)) || [];
  }

  async function loadNotices(schoolId) {
    if (!isSB()) return _noticesLocal(schoolId);
    try {
      const { data, error } = await sbClient()
        .from('notices').select('*')
        .eq('school_id', schoolId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(normaliseNotice);
    } catch (e) {
      console.warn('[DB] loadNotices fallback:', e.message);
      return _noticesLocal(schoolId);
    }
  }

  async function loadNetworkNotices() {
    if (!isSB()) return (await lGet('notices:network')) || [];
    try {
      const { data, error } = await sbClient()
        .from('notices').select('*')
        .is('school_id', null)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(normaliseNotice);
    } catch (e) {
      console.warn('[DB] loadNetworkNotices fallback:', e.message);
      return (await lGet('notices:network')) || [];
    }
  }

  // Convert snake_case DB row → camelCase app object
  function normaliseNotice(row) {
    return {
      id:         row.id,
      type:       row.type,
      title:      row.title,
      body:       row.body || '',
      expiresAt:  row.expires_at || null,
      pinned:     row.pinned || false,
      schoolId:   row.school_id || null,
      createdBy:  row.created_by || null,
      createdAt:  row.created_at,
      updatedAt:  row.updated_at,
    };
  }

  async function saveNotice(notice) {
    const row = {
      id:         notice.id,
      school_id:  notice.schoolId || null,
      type:       notice.type,
      title:      notice.title,
      body:       notice.body || null,
      expires_at: notice.expiresAt || null,
      pinned:     !!notice.pinned,
      created_by: notice.createdBy || null,
      created_at: notice.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (!isSB()) {
      const key = 'notices:' + (notice.schoolId || 'network');
      const arr = await lGet(key) || [];
      const idx = arr.findIndex(n => n.id === notice.id);
      if (idx !== -1) arr[idx] = notice; else arr.unshift(notice);
      return lSet(key, arr);
    }
    try {
      const { error } = await sbClient().from('notices').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      return true;
    } catch (e) {
      console.warn('[DB] saveNotice failed:', e.message);
      return false;
    }
  }

  async function deleteNotice(id, schoolId) {
    if (!isSB()) {
      const key = 'notices:' + (schoolId || 'network');
      const arr = ((await lGet(key)) || []).filter(n => n.id !== id);
      return lSet(key, arr);
    }
    try {
      const { error } = await sbClient().from('notices').delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch (e) {
      console.warn('[DB] deleteNotice failed:', e.message);
      return false;
    }
  }

  // ── Feed posts ───────────────────────────────────────────────────
  async function loadFeedPosts(schoolId, limit = 50, before = null) {
    if (!isSB()) return (await lGet('feed:' + schoolId)) || [];
    try {
      // Load school posts + network-wide posts
      let q = sbClient()
        .from('feed_posts')
        .select(`
          id, school_id, author_id, author_name, author_role,
          body, media_urls, target_scope, target_ids,
          like_count, comment_count, pinned, edited,
          notice_type, required_reading, expires_at,
          created_at, updated_at
        `)
        .or(`school_id.eq.${schoolId},target_scope.eq.network`)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (before) q = q.lt('created_at', before);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map(normalisePost);
    } catch (e) {
      console.warn('[DB] loadFeedPosts fallback:', e.message);
      return (await lGet('feed:' + schoolId)) || [];
    }
  }

  function normalisePost(row) {
    return {
      id:           row.id,
      schoolId:     row.school_id,
      authorId:     row.author_id,
      authorName:   row.author_name,
      authorRole:   row.author_role,
      body:         row.body,
      mediaUrls:    row.media_urls || [],
      targetScope:  row.target_scope,
      targetIds:    row.target_ids || [],
      likeCount:    row.like_count || 0,
      commentCount: row.comment_count || 0,
      noticeType:      row.notice_type || null,
      requiredReading: row.required_reading || false,
      expiresAt:       row.expires_at || null,
      pinned:       row.pinned || false,
      edited:       row.edited || false,
      createdAt:    row.created_at,
      updatedAt:    row.updated_at,
    };
  }

  async function saveFeedPost(post) {
    const row = {
      id:           post.id,
      school_id:    post.schoolId || null,
      author_id:    post.authorId,
      author_name:  post.authorName,
      author_role:  post.authorRole || null,
      body:         post.body,
      media_urls:   post.mediaUrls || [],
      target_scope: post.targetScope || 'school',
      target_ids:   post.targetIds || [],
      notice_type:      post.noticeType || null,
      required_reading: post.requiredReading || false,
      expires_at:       post.expiresAt || null,
      pinned:       post.pinned || false,
      edited:       post.edited || false,
      created_at:   post.createdAt || new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    };
    if (!isSB()) {
      const key = 'feed:' + (post.schoolId || 'network');
      const arr = (await lGet(key)) || [];
      const idx = arr.findIndex(p => p.id === post.id);
      if (idx !== -1) arr[idx] = post; else arr.unshift(post);
      return lSet(key, arr);
    }
    try {
      const { error } = await sbClient().from('feed_posts').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      return true;
    } catch (e) {
      console.warn('[DB] saveFeedPost failed:', e.message);
      return false;
    }
  }

  async function deleteFeedPost(id) {
    if (!isSB()) return false; // can't easily delete from local array without schoolId
    try {
      const { error } = await sbClient().from('feed_posts').delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch (e) { return false; }
  }

  // ── Comments ─────────────────────────────────────────────────────
  async function loadComments(postId) {
    if (!isSB()) return (await lGet('comments:' + postId)) || [];
    try {
      const { data, error } = await sbClient()
        .from('feed_comments').select('*')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []).map(r => ({
        id:         r.id,
        postId:     r.post_id,
        authorId:   r.author_id,
        authorName: r.author_name,
        authorRole: r.author_role,
        body:       r.body,
        edited:     r.edited,
        createdAt:  r.created_at,
      }));
    } catch (e) {
      console.warn('[DB] loadComments fallback:', e.message);
      return (await lGet('comments:' + postId)) || [];
    }
  }

  async function saveComment(comment) {
    const row = {
      id:          comment.id,
      post_id:     comment.postId,
      author_id:   comment.authorId,
      author_name: comment.authorName,
      author_role: comment.authorRole || null,
      body:        comment.body,
      edited:      comment.edited || false,
      created_at:  comment.createdAt || new Date().toISOString(),
    };
    if (!isSB()) {
      const arr = (await lGet('comments:' + comment.postId)) || [];
      const idx = arr.findIndex(c => c.id === comment.id);
      if (idx !== -1) arr[idx] = comment; else arr.push(comment);
      return lSet('comments:' + comment.postId, arr);
    }
    try {
      const { error } = await sbClient().from('feed_comments').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      // Refresh comment count (ignore error — non-critical)
      const { count } = await sbClient()
        .from('feed_comments').select('*', { count: 'exact', head: true })
        .eq('post_id', comment.postId);
      await sbClient().from('feed_posts').update({ comment_count: count || 0 }).eq('id', comment.postId);
      return true;
    } catch (e) {
      console.warn('[DB] saveComment failed:', e.message);
      return false;
    }
  }

  async function deleteComment(id, postId) {
    if (!isSB()) {
      const arr = ((await lGet('comments:' + postId)) || []).filter(c => c.id !== id);
      return lSet('comments:' + postId, arr);
    }
    try {
      const { error } = await sbClient().from('feed_comments').delete().eq('id', id);
      if (error) throw error;
      // Refresh comment count
      const { count } = await sbClient()
        .from('feed_comments').select('*', { count: 'exact', head: true }).eq('post_id', postId);
      await sbClient().from('feed_posts').update({ comment_count: count || 0 }).eq('id', postId);
      return true;
    } catch (e) { return false; }
  }

  // ── Likes ────────────────────────────────────────────────────────
  async function toggleLike(postId, userId, liked) {
    if (!isSB()) {
      // Local: store liked post IDs per user
      const key = 'likes:' + userId;
      const liked_ids = (await lGet(key)) || [];
      if (liked) { if (!liked_ids.includes(postId)) liked_ids.push(postId); }
      else { const i = liked_ids.indexOf(postId); if (i !== -1) liked_ids.splice(i, 1); }
      await lSet(key, liked_ids);
      return liked_ids.length; // approximate
    }
    try {
      const sb = sbClient();
      if (liked) {
        await sb.from('feed_likes').upsert(
          { post_id: postId, user_id: userId },
          { onConflict: 'post_id,user_id' }
        );
      } else {
        await sb.from('feed_likes').delete().eq('post_id', postId).eq('user_id', userId);
      }
      const { count } = await sb.from('feed_likes')
        .select('*', { count: 'exact', head: true }).eq('post_id', postId);
      const newCount = count || 0;
      await sb.from('feed_posts').update({ like_count: newCount }).eq('id', postId);
      return newCount;
    } catch (e) {
      console.warn('[DB] toggleLike failed:', e.message);
      return null;
    }
  }

  async function loadMyLikes(userId, postIds) {
    if (!isSB()) {
      const liked_ids = (await lGet('likes:' + userId)) || [];
      return new Set(liked_ids.filter(id => postIds.includes(id)));
    }
    try {
      const { data } = await sbClient()
        .from('feed_likes').select('post_id')
        .eq('user_id', userId).in('post_id', postIds);
      return new Set((data || []).map(r => r.post_id));
    } catch (e) { return new Set(); }
  }

  // ── Required-reading acknowledgements ────────────────────────────
  async function loadAcksForPosts(postIds) {
    if (!postIds || postIds.length === 0) return {};
    if (!isSB()) {
      const map = {};
      for (const pid of postIds) {
        map[pid] = (await lGet('acks:' + pid)) || [];
      }
      return map;
    }
    try {
      const { data, error } = await sbClient()
        .from('post_acks').select('*').in('post_id', postIds);
      if (error) throw error;
      const map = {};
      for (const r of (data || [])) {
        if (!map[r.post_id]) map[r.post_id] = [];
        map[r.post_id].push({ userId: r.user_id, userName: r.user_name, ackedAt: r.acked_at });
      }
      return map;
    } catch (e) {
      console.warn('[DB] loadAcksForPosts failed:', e.message);
      return {};
    }
  }

  async function saveAck(postId, userId, userName) {
    if (!isSB()) {
      const arr = (await lGet('acks:' + postId)) || [];
      if (!arr.find(a => (a.userId || a.user_id) === userId)) {
        arr.push({ userId, userName, ackedAt: new Date().toISOString() });
      }
      return lSet('acks:' + postId, arr);
    }
    try {
      const { error } = await sbClient().from('post_acks').upsert(
        { post_id: postId, user_id: userId, user_name: userName },
        { onConflict: 'post_id,user_id' }
      );
      return !error;
    } catch (e) { return false; }
  }

  async function loadMyAcks(userId, postIds) {
    if (!userId || !postIds || postIds.length === 0) return new Set();
    if (!isSB()) {
      const out = new Set();
      for (const pid of postIds) {
        const arr = (await lGet('acks:' + pid)) || [];
        if (arr.find(a => (a.userId || a.user_id) === userId)) out.add(pid);
      }
      return out;
    }
    try {
      const { data } = await sbClient().from('post_acks')
        .select('post_id').eq('user_id', userId).in('post_id', postIds);
      return new Set((data || []).map(r => r.post_id));
    } catch (e) { return new Set(); }
  }

  // ── Groups ────────────────────────────────────────────────────────
  async function loadGroups(schoolId) {
    if (!isSB()) return (await lGet('groups:' + schoolId)) || [];
    try {
      const { data, error } = await sbClient()
        .from('groups')
        .select('*, members:group_members(user_id, school_id)')
        .or(`school_id.eq.${schoolId},school_id.is.null`)
        .order('name');
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('[DB] loadGroups fallback:', e.message);
      return (await lGet('groups:' + schoolId)) || [];
    }
  }

  async function saveGroup(group) {
    if (!isSB()) {
      const key = 'groups:' + (group.school_id || 'network');
      const arr = (await lGet(key)) || [];
      const idx = arr.findIndex(g => g.id === group.id);
      if (idx !== -1) arr[idx] = group; else arr.push(group);
      return lSet(key, arr);
    }
    try {
      const { error } = await sbClient().from('groups').upsert(group, { onConflict: 'id' });
      if (error) throw error;
      return true;
    } catch (e) { console.warn('[DB] saveGroup:', e.message); return false; }
  }

  async function deleteGroup(id) {
    if (!isSB()) return false;
    try {
      const { error } = await sbClient().from('groups').delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch (e) { return false; }
  }

  async function saveGroupMember(groupId, userId, schoolId, addedBy) {
    if (!isSB()) return false;
    try {
      const { error } = await sbClient().from('group_members').upsert(
        { group_id: groupId, user_id: userId, school_id: schoolId, added_by: addedBy },
        { onConflict: 'group_id,user_id' }
      );
      return !error;
    } catch (e) { return false; }
  }

  async function removeGroupMember(groupId, userId) {
    if (!isSB()) return false;
    try {
      const { error } = await sbClient().from('group_members')
        .delete().eq('group_id', groupId).eq('user_id', userId);
      return !error;
    } catch (e) { return false; }
  }

  // ── Class assignments ─────────────────────────────────────────────
  async function loadClassAssignments(schoolId) {
    if (!isSB()) return (await lGet('class-assignments:' + schoolId)) || [];
    try {
      const { data, error } = await sbClient()
        .from('class_assignments').select('*').eq('school_id', schoolId);
      if (error) throw error;
      return data || [];
    } catch (e) {
      return (await lGet('class-assignments:' + schoolId)) || [];
    }
  }

  async function saveClassAssignment(schoolId, slotKey, instructorId, role) {
    if (!isSB()) {
      const arr = (await lGet('class-assignments:' + schoolId)) || [];
      const idx = arr.findIndex(a => a.slot_key === slotKey && a.role === role);
      const row = { school_id: schoolId, slot_key: slotKey, instructor_id: instructorId, role };
      if (idx !== -1) arr[idx] = row; else arr.push(row);
      return lSet('class-assignments:' + schoolId, arr);
    }
    try {
      const { error } = await sbClient().from('class_assignments').upsert(
        { school_id: schoolId, slot_key: slotKey, instructor_id: instructorId, role },
        { onConflict: 'school_id,slot_key,role' }
      );
      return !error;
    } catch (e) { return false; }
  }

  async function deleteClassAssignment(schoolId, slotKey, role) {
    if (!isSB()) return false;
    try {
      const { error } = await sbClient().from('class_assignments').delete()
        .eq('school_id', schoolId).eq('slot_key', slotKey).eq('role', role);
      return !error;
    } catch (e) { return false; }
  }

  // ── Calendar events ───────────────────────────────────────────────
  function normaliseCalEvent(row) {
    return {
      id:          row.id,
      schoolId:    row.school_id ?? null,
      title:       row.title,
      description: row.description || '',
      location:    row.location || '',
      startDate:   row.start_date,
      endDate:     row.end_date,
      startTime:   row.start_time || null,
      endTime:     row.end_time || null,
      typeId:      row.type_id || null,
      createdBy:   row.created_by || null,
      createdAt:   row.created_at,
    };
  }

  async function loadCalendarEvents(schoolId) {
    if (!isSB()) {
      const school = (await lGet('calendar:' + schoolId)) || [];
      const network = (await lGet('calendar:network')) || [];
      return [...school, ...network];
    }
    try {
      const { data, error } = await sbClient()
        .from('calendar_events').select('*')
        .or(`school_id.eq.${schoolId},school_id.is.null`)
        .order('start_date', { ascending: true });
      if (error) throw error;
      return (data || []).map(normaliseCalEvent);
    } catch (e) {
      console.warn('[DB] loadCalendarEvents fallback:', e.message);
      const school = (await lGet('calendar:' + schoolId)) || [];
      const network = (await lGet('calendar:network')) || [];
      return [...school, ...network];
    }
  }

  async function saveCalendarEvent(ev) {
    if (!isSB()) {
      const key = 'calendar:' + (ev.schoolId || 'network');
      const arr = (await lGet(key)) || [];
      const idx = arr.findIndex(e => e.id === ev.id);
      if (idx !== -1) arr[idx] = ev; else arr.push(ev);
      return lSet(key, arr);
    }
    try {
      const row = {
        id:          ev.id,
        school_id:   ev.schoolId || null,
        title:       ev.title,
        description: ev.description || null,
        location:    ev.location || null,
        start_date:  ev.startDate,
        end_date:    ev.endDate,
        start_time:  ev.startTime || null,
        end_time:    ev.endTime || null,
        type_id:     ev.typeId || null,
        created_by:  ev.createdBy || null,
        created_at:  ev.createdAt || new Date().toISOString(),
        updated_at:  new Date().toISOString(),
      };
      const { error } = await sbClient().from('calendar_events').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      return true;
    } catch (e) { console.warn('[DB] saveCalendarEvent:', e.message); return false; }
  }

  async function deleteCalendarEvent(id, schoolId) {
    if (!isSB()) {
      for (const key of ['calendar:' + (schoolId || 'network'), 'calendar:network']) {
        const arr = (await lGet(key)) || [];
        const filtered = arr.filter(e => e.id !== id);
        if (filtered.length !== arr.length) await lSet(key, filtered);
      }
      return true;
    }
    try {
      const { error } = await sbClient().from('calendar_events').delete().eq('id', id);
      return !error;
    } catch (e) { return false; }
  }

  // ── Event types ───────────────────────────────────────────────────
  async function loadEventTypes(schoolId) {
    if (!isSB()) {
      const school = (await lGet('event-types:' + schoolId)) || [];
      const network = (await lGet('event-types:network')) || [];
      return [...network, ...school];
    }
    try {
      const { data, error } = await sbClient()
        .from('event_types').select('*')
        .or(`school_id.eq.${schoolId},school_id.is.null`)
        .order('name');
      if (error) throw error;
      return (data || []).map(r => ({
        id: r.id, schoolId: r.school_id ?? null, name: r.name,
        colour: r.colour || '#3b82f6', createdBy: r.created_by || null,
      }));
    } catch (e) {
      console.warn('[DB] loadEventTypes fallback:', e.message);
      const school = (await lGet('event-types:' + schoolId)) || [];
      const network = (await lGet('event-types:network')) || [];
      return [...network, ...school];
    }
  }

  async function saveEventType(t) {
    if (!isSB()) {
      const key = 'event-types:' + (t.schoolId || 'network');
      const arr = (await lGet(key)) || [];
      const idx = arr.findIndex(x => x.id === t.id);
      if (idx !== -1) arr[idx] = t; else arr.push(t);
      return lSet(key, arr);
    }
    try {
      const row = {
        id: t.id, school_id: t.schoolId || null, name: t.name,
        colour: t.colour || '#3b82f6', created_by: t.createdBy || null,
      };
      const { error } = await sbClient().from('event_types').upsert(row, { onConflict: 'id' });
      return !error;
    } catch (e) { return false; }
  }

  async function deleteEventType(id, schoolId) {
    if (!isSB()) {
      for (const key of ['event-types:' + (schoolId || 'network'), 'event-types:network']) {
        const arr = (await lGet(key)) || [];
        const filtered = arr.filter(t => t.id !== id);
        if (filtered.length !== arr.length) await lSet(key, filtered);
      }
      return true;
    }
    try {
      const { error } = await sbClient().from('event_types').delete().eq('id', id);
      return !error;
    } catch (e) { return false; }
  }

  // ── Document library ──────────────────────────────────────────────
  function normaliseDocument(r) {
    return {
      id:           r.id,
      schoolId:     r.school_id ?? null,
      instructorId: r.instructor_id ?? null,
      title:        r.title,
      description:  r.description || '',
      category:     r.category || '',
      filename:     r.filename,
      mimeType:     r.mime_type,
      fileSize:     r.file_size || 0,
      fileData:     r.file_data || null,
      uploadedBy:   r.uploaded_by || null,
      createdAt:    r.created_at,
    };
  }

  // Organisation docs only (network + school). Personal (instructor-scoped) docs are excluded.
  async function loadDocuments(schoolId) {
    if (!isSB()) {
      const school  = ((await lGet('documents:' + schoolId)) || []).filter(d => !d.instructorId);
      const network = ((await lGet('documents:network')) || []).filter(d => !d.instructorId);
      return [...network, ...school];
    }
    try {
      const { data, error } = await sbClient()
        .from('documents').select('*')
        .or(`school_id.eq.${schoolId},school_id.is.null`)
        .is('instructor_id', null)
        .order('category').order('title');
      if (error) throw error;
      return (data || []).map(normaliseDocument);
    } catch (e) {
      console.warn('[DB] loadDocuments fallback:', e.message);
      const school  = ((await lGet('documents:' + schoolId)) || []).filter(d => !d.instructorId);
      const network = ((await lGet('documents:network')) || []).filter(d => !d.instructorId);
      return [...network, ...school];
    }
  }

  // Personal documents for one instructor (My Documents + admin viewer).
  async function loadInstructorDocuments(instructorId) {
    if (!instructorId) return [];
    if (!isSB()) return (await lGet('idocs:' + instructorId)) || [];
    try {
      const { data, error } = await sbClient()
        .from('documents').select('*')
        .eq('instructor_id', instructorId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(normaliseDocument);
    } catch (e) {
      console.warn('[DB] loadInstructorDocuments fallback:', e.message);
      return (await lGet('idocs:' + instructorId)) || [];
    }
  }

  async function saveDocument(doc) {
    if (!isSB()) {
      const key = doc.instructorId ? ('idocs:' + doc.instructorId)
                                   : ('documents:' + (doc.schoolId || 'network'));
      const arr = (await lGet(key)) || [];
      const idx = arr.findIndex(d => d.id === doc.id);
      if (idx !== -1) arr[idx] = doc; else arr.push(doc);
      return lSet(key, arr);
    }
    try {
      const row = {
        id:            doc.id,
        school_id:     doc.schoolId || null,
        instructor_id: doc.instructorId || null,
        title:         doc.title,
        description:   doc.description || null,
        category:      doc.category || null,
        filename:      doc.filename,
        mime_type:     doc.mimeType,
        file_size:     doc.fileSize || 0,
        file_data:     doc.fileData || null,
        uploaded_by:   doc.uploadedBy || null,
        created_at:    doc.createdAt || new Date().toISOString(),
        updated_at:    new Date().toISOString(),
      };
      const { error } = await sbClient().from('documents').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      return true;
    } catch (e) { console.warn('[DB] saveDocument:', e.message); return false; }
  }

  async function deleteDocument(id, schoolId, instructorId) {
    if (!isSB()) {
      const keys = instructorId
        ? ['idocs:' + instructorId]
        : ['documents:' + (schoolId || 'network'), 'documents:network'];
      for (const key of keys) {
        const arr = (await lGet(key)) || [];
        const filtered = arr.filter(d => d.id !== id);
        if (filtered.length !== arr.length) await lSet(key, filtered);
      }
      return true;
    }
    try {
      const { error } = await sbClient().from('documents').delete().eq('id', id);
      return !error;
    } catch (e) { return false; }
  }

  // ── Instructor compliance ──────────────────────────────────────────
  async function loadComplianceRequirements(schoolId) {
    if (!isSB()) {
      const school = (await lGet('comp-reqs:' + schoolId)) || [];
      const network = (await lGet('comp-reqs:network')) || [];
      return [...network, ...school];
    }
    try {
      const { data, error } = await sbClient()
        .from('compliance_requirements').select('*')
        .or(`school_id.eq.${schoolId},school_id.is.null`)
        .order('name');
      if (error) throw error;
      return (data || []).map(r => ({
        id: r.id, schoolId: r.school_id ?? null, name: r.name,
        hasExpiry: r.has_expiry, description: r.description || '',
        createdBy: r.created_by || null,
      }));
    } catch (e) {
      const school = (await lGet('comp-reqs:' + schoolId)) || [];
      const network = (await lGet('comp-reqs:network')) || [];
      return [...network, ...school];
    }
  }

  async function saveComplianceRequirement(req) {
    if (!isSB()) {
      const key = 'comp-reqs:' + (req.schoolId || 'network');
      const arr = (await lGet(key)) || [];
      const idx = arr.findIndex(r => r.id === req.id);
      if (idx !== -1) arr[idx] = req; else arr.push(req);
      return lSet(key, arr);
    }
    try {
      const { error } = await sbClient().from('compliance_requirements').upsert({
        id: req.id, school_id: req.schoolId || null, name: req.name,
        has_expiry: req.hasExpiry, description: req.description || null,
        created_by: req.createdBy || null,
      }, { onConflict: 'id' });
      return !error;
    } catch (e) { return false; }
  }

  async function deleteComplianceRequirement(id, schoolId) {
    if (!isSB()) {
      for (const key of ['comp-reqs:' + (schoolId || 'network'), 'comp-reqs:network']) {
        const arr = (await lGet(key)) || [];
        const filtered = arr.filter(r => r.id !== id);
        if (filtered.length !== arr.length) await lSet(key, filtered);
      }
      return true;
    }
    try {
      const { error } = await sbClient().from('compliance_requirements').delete().eq('id', id);
      return !error;
    } catch (e) { return false; }
  }

  async function loadInstructorCompliance(schoolId) {
    if (!isSB()) return (await lGet('compliance:' + schoolId)) || [];
    try {
      const { data, error } = await sbClient()
        .from('instructor_compliance').select('*').eq('school_id', schoolId);
      if (error) throw error;
      return (data || []).map(r => ({
        id: r.id, schoolId: r.school_id, instructorId: r.instructor_id,
        requirementId: r.requirement_id, status: r.status,
        expiryDate: r.expiry_date || null, referenceNumber: r.reference_number || '',
        notes: r.notes || '', updatedBy: r.updated_by || null,
      }));
    } catch (e) { return (await lGet('compliance:' + schoolId)) || []; }
  }

  async function saveInstructorCompliance(rec) {
    if (!isSB()) {
      const key = 'compliance:' + rec.schoolId;
      const arr = (await lGet(key)) || [];
      const idx = arr.findIndex(r => r.id === rec.id);
      if (idx !== -1) arr[idx] = rec; else arr.push(rec);
      return lSet(key, arr);
    }
    try {
      const { error } = await sbClient().from('instructor_compliance').upsert({
        id: rec.id, school_id: rec.schoolId, instructor_id: rec.instructorId,
        requirement_id: rec.requirementId, status: rec.status,
        expiry_date: rec.expiryDate || null, reference_number: rec.referenceNumber || null,
        notes: rec.notes || null, updated_by: rec.updatedBy || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'school_id,instructor_id,requirement_id' });
      return !error;
    } catch (e) { return false; }
  }

  // ── Push subscriptions ────────────────────────────────────────────
  async function savePushSubscription(userId, schoolId, subscription) {
    if (!isSB()) return false;
    try {
      const keys = subscription.toJSON().keys;
      const { error } = await sbClient().from('push_subscriptions').upsert({
        user_id: userId, school_id: schoolId,
        endpoint: subscription.endpoint,
        keys_p256dh: keys.p256dh, keys_auth: keys.auth,
      }, { onConflict: 'endpoint' });
      return !error;
    } catch (e) { return false; }
  }

  async function removePushSubscription(endpoint) {
    if (!isSB()) return false;
    try {
      const { error } = await sbClient().from('push_subscriptions').delete().eq('endpoint', endpoint);
      return !error;
    } catch (e) { return false; }
  }

  // Trigger a push to subscribed devices via the send-push-notification Edge
  // Function. Best-effort and non-blocking — never throws into the caller.
  // payload: { title, body, tag, url, schoolId, targetUserIds, excludeUserId }
  async function sendPushNotification(payload) {
    if (!isSB()) return false;
    try {
      const { data, error } = await sbClient().functions.invoke('send-push-notification', { body: payload });
      if (error) { console.warn('[DB] push invoke failed:', error.message); return false; }
      return data || true;
    } catch (e) { console.warn('[DB] push invoke error:', e.message); return false; }
  }

  // ── Onboarding ───────────────────────────────────────────────────
  async function loadOnboardingChecklists(schoolId) {
    if (!isSB()) return (await lGet('onboarding:' + schoolId)) || [];
    try {
      const { data, error } = await sbClient()
        .from('onboarding_checklists').select('*').eq('school_id', schoolId);
      if (error) throw error;
      return (data || []).map(r => ({
        id: r.id, schoolId: r.school_id, instructorId: r.instructor_id,
        items: r.items || [], status: r.status, createdAt: r.created_at,
      }));
    } catch (e) { return (await lGet('onboarding:' + schoolId)) || []; }
  }

  async function saveOnboardingChecklist(rec) {
    if (!isSB()) {
      const key = 'onboarding:' + rec.schoolId;
      const arr = (await lGet(key)) || [];
      const idx = arr.findIndex(r => r.id === rec.id);
      if (idx !== -1) arr[idx] = rec; else arr.push(rec);
      return lSet(key, arr);
    }
    try {
      const { error } = await sbClient().from('onboarding_checklists').upsert({
        id: rec.id, school_id: rec.schoolId, instructor_id: rec.instructorId,
        items: rec.items, status: rec.status,
        created_at: rec.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'school_id,instructor_id' });
      return !error;
    } catch (e) { return false; }
  }

  // ── Realtime ──────────────────────────────────────────────────────
  function subscribeFeed(schoolId, onEvent) {
    const sb = sbClient();
    if (!sb) return null;
    return sb.channel('feed:' + schoolId)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'feed_posts',
        filter: `school_id=eq.${schoolId}`
      }, payload => onEvent('post', payload))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'feed_comments',
      }, payload => onEvent('comment', payload))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'feed_likes',
      }, payload => onEvent('like', payload))
      .subscribe();
  }

  function subscribeNotices(schoolId, onNotice) {
    const sb = sbClient();
    if (!sb) return null;
    return sb.channel('notices:' + schoolId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notices' },
        payload => onNotice(payload))
      .subscribe();
  }

  function unsubscribe(channel) {
    const sb = sbClient();
    if (sb && channel) sb.removeChannel(channel);
  }

  // ── Migration: copy localStorage data into Supabase ──────────────
  // Call once from the admin panel after wiring Supabase.
  async function migrateLocalToSupabase(schoolId) {
    const sb = sbClient();
    if (!sb) throw new Error('Supabase not configured');
    const keys = [
      ['roster-edits:' + schoolId,   'roster-edits',   schoolId],
      ['lesson-plans:' + schoolId,   'lesson-plans',   schoolId],
      ['incidents:' + schoolId,      'incidents',      schoolId],
      ['students:' + schoolId,       'students',       schoolId],
      ['progressions:' + schoolId,   'progressions',   schoolId],
      ['pathways:' + schoolId,       'pathways',       schoolId],
      ['pin-overrides:' + schoolId,  'pin-overrides',  schoolId],
      ['grading:' + schoolId,        'grading',        schoolId],
      ['custom-schools:global',      'custom-schools', 'global'],
    ];
    let migrated = 0;
    for (const [localKey, namespace, sid] of keys) {
      const val = await lGet(localKey);
      if (val !== null) {
        await sbSet(sid, namespace, val);
        migrated++;
      }
    }
    return migrated;
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    get isSupabase() { return isSB(); },

    // ── Auth (Supabase session is the real boundary) ──
    auth: {
      async getSession() { const sb = sbClient(); if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session; },
      async signInWithPassword(email, password) { const sb = sbClient(); if (!sb) throw new Error('Supabase unavailable'); return sb.auth.signInWithPassword({ email, password }); },
      async signInWithEmail(email) {
        const sb = sbClient(); if (!sb) throw new Error('Supabase unavailable');
        return sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      },
      async signOut() { const sb = sbClient(); if (sb) await sb.auth.signOut(); _uid = null; },
      onChange(cb) {
        const sb = sbClient(); if (!sb) return;
        // Defer outside the auth callback: calling Supabase auth methods *inside* the
        // onAuthStateChange callback deadlocks against its internal lock (hangs sign-in).
        sb.auth.onAuthStateChange((_e, session) => { setTimeout(() => cb(session), 0); });
      },
      currentUid() { return _uid; },
      async myProfile() {
        const sb = sbClient(); if (!sb) return null;
        let uid = _uid;
        if (!uid) { try { const { data: u } = await sb.auth.getUser(); uid = u && u.user ? u.user.id : null; } catch (e) { uid = null; } }
        if (!uid) return null;
        const { data, error } = await sb.from('profiles').select('*').eq('id', uid).single();
        if (error) { console.warn('[DB] profile:', error.message); return null; }
        return data;
      },
      async setPin(pin) { const sb = sbClient(); if (!sb || !_uid) return false; const h = await sha256Hex(_uid + ':' + pin); const { error } = await sb.from('profiles').update({ pin_hash: h }).eq('id', _uid); return !error; },
      async checkPin(pin) { const sb = sbClient(); if (!sb || !_uid) return false; const h = await sha256Hex(_uid + ':' + pin); const { data } = await sb.from('profiles').select('pin_hash').eq('id', _uid).single(); return !!(data && data.pin_hash === h); },
      async hasPin() { const sb = sbClient(); if (!sb || !_uid) return false; const { data } = await sb.from('profiles').select('pin_hash').eq('id', _uid).single(); return !!(data && data.pin_hash); },
    },

    // Privileged CSV import → Edge Function (service role stays server-side)
    bulkImportStudents: (schoolId, students) => invokeFn('bulk-import', { schoolId, students }),

    // Login-user administration (profiles). Reads are RLS-gated and direct; create /
    // delete go through the service-role manage-users Edge Function.
    users: {
      async list() {
        const sb = sbClient(); if (!sb) return [];
        const { data, error } = await sb.from('profiles').select('id,display_name,email,role,school_id').order('display_name');
        if (error) { console.warn('[DB] users.list:', error.message); return []; }
        return data || [];
      },
      invite: (email, role, schoolId, name) => invokeFn('manage-users', { action: 'invite', email, role, school_id: schoolId, name }),
      setRole: (uid, role, schoolId) => invokeFn('manage-users', { action: 'setRole', uid, role, school_id: schoolId }),
      remove: (uid) => invokeFn('manage-users', { action: 'remove', uid }),
    },

    // KV data (per-school blobs)
    loadEdits:        (schoolId) => get('roster-edits:' + schoolId),
    saveEdits:        (schoolId, d) => set('roster-edits:' + schoolId, d),
    loadPlans:        (schoolId) => get('lesson-plans:' + schoolId),
    savePlans:        (schoolId, d) => set('lesson-plans:' + schoolId, d),
    loadNetworkPlans: () => get('lesson-plans:network'),
    saveNetworkPlans: (d) => set('lesson-plans:network', d),
    loadIncidents:    (schoolId) => sbLoadTableMap('incidents', schoolId),
    saveIncidents:    (schoolId, d) => sbSaveTableMap('incidents', schoolId, d),
    deleteIncident:   (schoolId, id) => sbDeleteRow('incidents', id),
    loadStudents:     (schoolId) => sbLoadTableMap('students', schoolId),
    saveStudents:     (schoolId, d) => sbSaveTableMap('students', schoolId, d),
    deleteStudent:    (schoolId, id) => sbDeleteRow('students', id),
    loadProgressions: (schoolId) => get('progressions:' + schoolId),
    saveProgressions: (schoolId, d) => set('progressions:' + schoolId, d),
    loadPathways:     (schoolId) => get('pathways:' + schoolId),
    savePathways:     (schoolId, d) => set('pathways:' + schoolId, d),
    loadClassTypeOverrides: (schoolId) => get('class-type-overrides:' + schoolId),
    saveClassTypeOverrides: (schoolId, d) => set('class-type-overrides:' + schoolId, d),
    loadPinOverrides: (schoolId) => get('pin-overrides:' + schoolId),
    savePinOverrides: (schoolId, d) => set('pin-overrides:' + schoolId, d),
    loadLastLogins:   (schoolId) => get('last-login:' + schoolId),
    saveLastLogins:   (schoolId, d) => set('last-login:' + schoolId, d),
    loadGrading:      (schoolId) => get('grading:' + schoolId),
    saveGrading:      (schoolId, d) => set('grading:' + schoolId, d),
    loadOnboardingTemplate: (schoolId) => get('onboarding-template:' + schoolId),
    saveOnboardingTemplate: (schoolId, d) => set('onboarding-template:' + schoolId, d),

    // Outbound sync queue (offline → online)
    flushQueue, pendingCount,

    // Global / device-local
    loadCustomSchools: () => get('custom-schools:global'),
    saveCustomSchools: (d) => set('custom-schools:global', d),
    loadUser:  () => lGet('roster-user:session'),   // always local — device session
    saveUser:  (d) => lSet('roster-user:session', d),

    // Notices (dedicated table)
    loadNotices, loadNetworkNotices,
    saveNotice, deleteNotice,

    // Feed
    loadFeedPosts, saveFeedPost, deleteFeedPost,
    loadComments, saveComment, deleteComment,
    toggleLike, loadMyLikes,
    loadAcksForPosts, saveAck, loadMyAcks,

    // Groups
    loadGroups, saveGroup, deleteGroup,
    saveGroupMember, removeGroupMember,

    // Class assignments
    loadClassAssignments, saveClassAssignment, deleteClassAssignment,

    // Calendar
    loadCalendarEvents, saveCalendarEvent, deleteCalendarEvent,
    loadEventTypes, saveEventType, deleteEventType,

    // Documents
    loadDocuments, loadInstructorDocuments, saveDocument, deleteDocument,

    // Compliance
    loadComplianceRequirements, saveComplianceRequirement, deleteComplianceRequirement,
    loadInstructorCompliance, saveInstructorCompliance,

    // Onboarding
    loadOnboardingChecklists, saveOnboardingChecklist,

    // Push
    savePushSubscription, removePushSubscription, sendPushNotification,

    // Realtime
    subscribeFeed, subscribeNotices, unsubscribe,

    // Migration
    migrateLocalToSupabase,
  };
})();
